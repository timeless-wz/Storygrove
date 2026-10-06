/**
 * StoryTimelineScene — 故事时间线的纯渲染/视口组件（任务 A）。
 *
 * 只负责把布局结果画到 React Flow 上：事件节点、主轴与轴点、支线曲线、
 * 起止锚点与支线名标签，以及画布自身的平移/缩放/右键/键盘交互。
 * 不接触数据库、不持有 selection/浮层状态——这些由页面通过回调和
 * selectedId 注入。视口移动只响应 TimelineViewportIntent。
 *
 * 视口契约（供 D 接入）：
 * - 初始进入：以事件内容范围确定阅读视角，缩放不低于 INITIAL_MIN_ZOOM；
 *   内容超出视口时保持可读缩放、允许平移，绝不被远端锚点缩成蚂蚁。
 * - 「查看全部」（fit-all 意图）可缩小显示整个范围。
 * - 容器尺寸变化（如侧栏伸缩）时保持原画布中心与 zoom，绝不触发 fitView。
 * - onInteractStart：用户开始平移/缩放时通知宿主关闭清洁浮窗；
 *   脏编辑浮窗的数据安全由浮窗自身的关闭守卫负责。
 * - initialViewport / onViewportChange：卸载重入时由宿主保存/恢复视口。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  BaseEdge,
  Controls,
  getBezierPath,
  getSmoothStepPath,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './story-timeline-scene.css'
import { ChevronDown, ChevronUp, GitBranch } from 'lucide-react'
import type {
  StoryTimelineEventStatus,
} from '../../shared/story-timeline'
import {
  STORY_TIMELINE_MAIN_BRANCH_ID,
  STORY_TIMELINE_STATUS_LABELS,
} from '../../shared/story-timeline'
import { useLocaleStore } from '../../stores/locale-store'
import type {
  StoryTimelineLabelSide,
  StoryTimelineLayout,
} from './story-timeline-layout'
import type {
  TimelineScreenPoint,
  TimelineViewportIntent,
} from './timeline-ui-contract'

const AXIS_NODE_ID = 'timeline-axis'
/** 「查看全部」之外的一切适配都不得超过该缩放，事件始终保持可读大小。 */
const FIT_MAX_ZOOM = 1
const FOCUS_MIN_ZOOM = 0.85
/** 初始阅读视角的下限：低于此缩放宁可平移，也不把事件缩成蚂蚁。 */
const INITIAL_MIN_ZOOM = 0.75
const INITIAL_FIT_PADDING = 0.18

type SceneNodeData = Record<string, unknown> & {
  // 事件节点
  eventId?: string
  title?: string
  timeText?: string
  description?: string
  metaText?: string
  side?: StoryTimelineLabelSide
  staggerLevel?: number
  width?: number
  status?: StoryTimelineEventStatus
  childBranchCount?: number
  isExpanded?: boolean
  // 主轴节点
  dots?: Array<{ eventId: string; offsetX: number; selected: boolean }>
  // 锚点节点
  anchorType?: 'start' | 'end'
  label?: string
  timeLabel?: string
  // 支线名标签节点
  branchName?: string
  color?: string
  // 回调（由 Scene 注入，经 ref 转发保持最新）
  onSelect?: (eventId: string) => void
  onOpenFloat?: (eventId: string, point: TimelineScreenPoint, mode: 'details' | 'edit') => void
  onToggleExpand?: (eventId: string) => void
  onAnchorActivate?: (anchor: 'start' | 'end') => void
}

type SceneNode = Node<SceneNodeData, 'timeline-axis' | 'timeline-event' | 'timeline-anchor' | 'timeline-branch-label'>

type SceneEdgeData = Record<string, unknown> & {
  color?: string
  direction?: 'up' | 'down'
}

type SceneEdge = Edge<SceneEdgeData, 'timeline-stem' | 'timeline-trunk' | 'timeline-branch'>

export interface TimelineSceneCallbacks {
  /** 单击事件：仅选中，不打开任何浮层。 */
  onSelectEvent: (eventId: string | null) => void
  /** 右键/双击/键盘打开事件浮窗。 */
  onOpenEventFloat: (eventId: string, point: TimelineScreenPoint, mode: 'details' | 'edit') => void
  /** 展开/折叠某事件派生的支线。 */
  onToggleBranch: (eventId: string) => void
  /** 画布空白右键，hint 由场景根据流坐标换算。 */
  onCanvasContextMenu: (point: TimelineScreenPoint, hint: { suggestedOrder: number | null; canCreate: boolean }) => void
  /** 锚点右键。 */
  onAnchorContextMenu: (anchor: 'start' | 'end', point: TimelineScreenPoint) => void
  /** 单击/双击锚点打开范围设置。 */
  onOpenRangeEditor: (anchor: 'start' | 'end') => void
  /** 用户开始平移/缩放：宿主借此关闭清洁浮窗（脏编辑由浮窗自行守卫）。 */
  onInteractStart?: () => void
  /** 视口变化结束（含程序化移动）：宿主可保存以便卸载重入恢复。 */
  onViewportChange?: (viewport: Viewport) => void
}

export interface TimelineSceneProps {
  layout: StoryTimelineLayout
  selectedId: string | null
  /** 数据就绪（dataProjectKey 与当前项目一致）后才允许移动视口。 */
  contentReady: boolean
  viewportIntent: TimelineViewportIntent
  /** 卸载重入时恢复视口（可选，由宿主保存/提供）。 */
  initialViewport?: Viewport
  callbacks: TimelineSceneCallbacks
}

/** 主轴：一条连续水平线，每个主轴事件一枚圆点。 */
function TimelineAxisNodeView({ data }: NodeProps<SceneNode>) {
  return (
    <div className="writer-timeline-axis" data-testid="timeline-axis">
      <div className="writer-timeline-axis-line" aria-hidden="true" />
      {(data.dots ?? []).map(dot => (
        <span
          key={dot.eventId}
          className={`writer-timeline-axis-dot${dot.selected ? ' is-selected' : ''}`}
          data-testid="timeline-axis-dot"
          data-event-id={dot.eventId}
          style={{ left: dot.offsetX }}
          aria-hidden="true"
        />
      ))}
      {(data.dots ?? []).map(dot => (
        <Handle
          key={`handle-${dot.eventId}`}
          id={`dot-${dot.eventId}`}
          type="source"
          position={Position.Top}
          isConnectable={false}
          className="writer-timeline-axis-handle"
          style={{ left: dot.offsetX, top: '50%', transform: 'translate(-50%, -50%)' }}
        />
      ))}
    </div>
  )
}

/**
 * 事件节点：轻量文字块（时间 / 标题 / 元信息 / 描述），不再是有阴影的白卡片；
 * 与轴上圆点通过竖直短茎视觉相连。键盘：Enter 打开详情，Shift+F10/菜单键打开操作。
 */
function TimelineEventNodeView({ data, selected }: NodeProps<SceneNode>) {
  const text = useLocaleStore(s => s.text)
  const statusLabel = data.status
    ? text(STORY_TIMELINE_STATUS_LABELS[data.status].zh, STORY_TIMELINE_STATUS_LABELS[data.status].en)
    : ''

  const openFloat = useCallback((mode: 'details' | 'edit', e: React.MouseEvent) => {
    if (!data.eventId) return
    const rect = (e.currentTarget as HTMLElement).closest('.writer-timeline-label')?.getBoundingClientRect()
    const point: TimelineScreenPoint = rect
      ? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
      : { clientX: e.clientX, clientY: e.clientY }
    data.onOpenFloat?.(data.eventId, point, mode)
  }, [data])

  return (
    <div
      className={`writer-timeline-label is-${data.side}${selected ? ' is-selected' : ''}`}
      data-testid="timeline-event-label"
      data-event-id={data.eventId}
      data-side={data.side}
      data-stagger-level={data.staggerLevel}
      style={{ width: data.width }}
      title={data.title}
      tabIndex={0}
      role="button"
      aria-label={data.title}
      onClick={(event) => {
        event.stopPropagation()
        if (data.eventId) data.onSelect?.(data.eventId)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        openFloat('edit', event)
      }}
      onKeyDown={(event) => {
        if (!data.eventId) return
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          data.onOpenFloat?.(data.eventId, pointFromElement(event.currentTarget), 'details')
        } else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
          event.preventDefault()
          data.onOpenFloat?.(data.eventId, pointFromElement(event.currentTarget), 'details')
        }
      }}
    >
      {/* 面向主轴的接收 handle：竖直短茎 */}
      <Handle
        id="event-in"
        type="target"
        position={data.side === 'above' ? Position.Bottom : Position.Top}
        isConnectable={false}
        className="writer-timeline-label-handle"
      />
      {/* 支线曲线与支线内部顺延线的接收/引出 handle */}
      <Handle
        id="tree-in"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="writer-timeline-label-handle"
      />
      <Handle
        id="tree-out"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="writer-timeline-label-handle"
      />

      <div className="writer-timeline-label-time-row">
        <span className="writer-timeline-label-time">{data.timeText}</span>
        <span
          className={`writer-timeline-status-dot is-${data.status}`}
          data-testid="timeline-status-dot"
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        />
      </div>

      <span className="writer-timeline-label-title">{data.title}</span>

      {data.metaText && <span className="writer-timeline-label-meta">{data.metaText}</span>}

      {data.description && <p className="writer-timeline-label-desc">{data.description}</p>}

      {(data.childBranchCount ?? 0) > 0 && (
        <button
          type="button"
          className="writer-timeline-branch-badge"
          data-testid="timeline-branch-badge"
          onClick={(event) => {
            event.stopPropagation()
            if (data.eventId) data.onToggleExpand?.(data.eventId)
          }}
          onKeyDown={(event) => event.stopPropagation()}
          title={data.isExpanded ? text('点击折叠该支线', 'Click to collapse this branch') : text('点击展开该支线', 'Click to expand this branch')}
        >
          <GitBranch size={10} />
          <span>{text(`${data.childBranchCount} 支线`, `${data.childBranchCount} ${data.childBranchCount === 1 ? 'branch' : 'branches'}`)}</span>
          {data.isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}
    </div>
  )
}

function pointFromElement(element: HTMLElement): TimelineScreenPoint {
  const rect = element.getBoundingClientRect()
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }
}

/** 故事开端/结束锚点：轻量端点 + 名称，不再展示开发式 [刻度] 标签。 */
function TimelineAnchorNodeView({ data }: NodeProps<SceneNode>) {
  return (
    <div
      className={`writer-timeline-anchor is-${data.anchorType}`}
      data-testid={`timeline-anchor-${data.anchorType}`}
      title={data.timeLabel ? `${data.label} (${data.timeLabel})` : data.label}
      onClick={(e) => {
        e.stopPropagation()
        if (data.anchorType) data.onAnchorActivate?.(data.anchorType)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span className="writer-timeline-anchor-dot" aria-hidden="true" />
      <span className="writer-timeline-anchor-text">
        <span className="writer-timeline-anchor-title">{data.label}</span>
        {data.timeLabel && <span className="writer-timeline-anchor-time">{data.timeLabel}</span>}
      </span>
    </div>
  )
}

/** 支线名标签：贴着支线路径，标示这条泳道属于哪条支线。 */
function TimelineBranchLabelNodeView({ data }: NodeProps<SceneNode>) {
  return (
    <div className="writer-timeline-branch-label" style={{ color: data.color || undefined }}>
      {data.branchName}
    </div>
  )
}

const nodeTypes = {
  'timeline-axis': TimelineAxisNodeView,
  'timeline-event': TimelineEventNodeView,
  'timeline-anchor': TimelineAnchorNodeView,
  'timeline-branch-label': TimelineBranchLabelNodeView,
}

/** 主轴圆点到事件标注的竖直短茎。 */
function TimelineStemEdgeView({ sourceX, sourceY, targetX, targetY }: EdgeProps<SceneEdge>) {
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  return <BaseEdge path={path} className="writer-timeline-connector" />
}

/** 支线内部事件顺延连接线。 */
function TimelineTrunkEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<SceneEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    borderRadius: 8,
  })
  return (
    <BaseEdge
      path={path}
      className="writer-timeline-trunk-edge"
      style={{ stroke: data?.color || 'var(--tl-sage)', strokeWidth: 1.5 }}
    />
  )
}

/** 分叉源到支线首事件的平滑贝塞尔曲线，从轴点自然分叉。 */
function TimelineBranchEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<SceneEdge>) {
  const sourcePosition = data?.direction === 'down' ? Position.Bottom : Position.Top
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition: Position.Left,
    curvature: 0.45,
  })
  return (
    <BaseEdge
      path={path}
      className="writer-timeline-branch-edge"
      style={{ stroke: data?.color || 'var(--tl-sage)', strokeWidth: 1.5 }}
    />
  )
}

const edgeTypes = {
  'timeline-stem': TimelineStemEdgeView,
  'timeline-trunk': TimelineTrunkEdgeView,
  'timeline-branch': TimelineBranchEdgeView,
}

/** 事件内容的流坐标包围盒（不含锚点，避免远端锚点把初始视角拉扁）。 */
function eventContentBounds(layout: StoryTimelineLayout) {
  const events = layout.events
  if (events.length === 0) return null
  return {
    minX: Math.min(...events.map(event => event.x)),
    maxX: Math.max(...events.map(event => event.x + event.width)),
    minY: Math.min(...events.map(event => event.y)),
    maxY: Math.max(...events.map(event => event.y + event.height)),
  }
}

export function StoryTimelineScene({
  layout,
  selectedId,
  contentReady,
  viewportIntent,
  initialViewport,
  callbacks,
}: TimelineSceneProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReactFlowInstance<SceneNode, SceneEdge> | null>(null)
  const handledNonceRef = useRef<number>(-1)
  const viewportFrameRef = useRef<number | null>(null)
  const callbacksRef = useRef(callbacks)
  const viewportStateRef = useRef({ intent: viewportIntent, layout, ready: contentReady })

  // ref 的最新值在 effect 里回填；effect 按声明顺序执行，
  // 因此下面 tryApplyViewport 的 effect 读到的一定是本帧的状态。
  useEffect(() => {
    callbacksRef.current = callbacks
    viewportStateRef.current = { intent: viewportIntent, layout, ready: contentReady }
  })

  /** 视口意图统一在这里消费；同一 nonce 只执行一次。 */
  const tryApplyViewport = useCallback(() => {
    if (viewportFrameRef.current !== null) cancelAnimationFrame(viewportFrameRef.current)
    // Read the latest committed layout in the frame, rather than capturing a stale
    // layout before newly saved events / expanded branches have been rendered.
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = null
      const instance = instanceRef.current
      const { intent, layout: currentLayout, ready } = viewportStateRef.current
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (!instance || !ready || !rect || rect.width <= 0 || rect.height <= 0
        || handledNonceRef.current === intent.nonce) return
      const target = intent.kind === 'focus-event'
        ? currentLayout.events.find(item => item.id === intent.eventId)
        : null
      // A pending focus request must survive until its node becomes visible.
      if (intent.kind === 'focus-event' && (!target || ![
        target.x, target.y, target.width, target.height,
      ].every(Number.isFinite))) return
      handledNonceRef.current = intent.nonce
      if (intent.kind === 'fit-all') {
        void instance.fitView({ padding: 0.2, minZoom: 0.05, maxZoom: FIT_MAX_ZOOM, duration: 250 })
        return
      }
      if (intent.kind === 'focus-event' && intent.eventId) {
        const placed = target!
        const currentZoom = instance.getZoom()
        const zoom = Number.isFinite(currentZoom)
          ? Math.min(2, Math.max(currentZoom, FOCUS_MIN_ZOOM)) : FOCUS_MIN_ZOOM
        instance.setCenter(
          placed.x + placed.width / 2,
          placed.y + placed.height / 2,
          { zoom, duration: 250, interpolate: 'linear' },
        )
        return
      }
      // initial：以事件内容范围确定阅读视角。
      const bounds = eventContentBounds(currentLayout)
      if (!bounds) {
        void instance.fitView({ padding: 0.2, minZoom: 0.05, maxZoom: FIT_MAX_ZOOM, duration: 0 })
        return
      }
      const viewWidth = rect.width
      const viewHeight = rect.height
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
      const usableWidth = viewWidth * (1 - INITIAL_FIT_PADDING * 2)
      const usableHeight = viewHeight * (1 - INITIAL_FIT_PADDING * 2)
      const fitZoom = Math.min(
        FIT_MAX_ZOOM,
        Math.max(0.05, Math.min(usableWidth / contentWidth, usableHeight / contentHeight)),
      )
      if (fitZoom >= INITIAL_MIN_ZOOM) {
        // 内容装得下：整体适配，四周留白。
        void instance.fitView({
          nodes: currentLayout.events.map(event => ({ id: event.id })),
          padding: INITIAL_FIT_PADDING,
          minZoom: 0.05,
          maxZoom: FIT_MAX_ZOOM,
          duration: 0,
        })
      } else {
        // 内容装不下：保持可读缩放，从故事开头开始阅读，其余交给平移。
        const zoom = INITIAL_MIN_ZOOM
        const centerX = bounds.minX + viewWidth / (2 * zoom) - 40
        instance.setCenter(centerX, (bounds.minY + bounds.maxY) / 2, { zoom, duration: 0 })
      }
    })
  }, [])

  useEffect(() => {
    tryApplyViewport()
  }, [viewportIntent, layout, contentReady, tryApplyViewport])

  useEffect(() => () => {
    if (viewportFrameRef.current !== null) cancelAnimationFrame(viewportFrameRef.current)
  }, [])

  // Defer viewport writes outside ResizeObserver delivery. Ignore hidden/zero-size
  // containers so a transient resize cannot move the entire graph off screen.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.getBoundingClientRect()
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const instance = instanceRef.current
        if (!instance) return
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        if (rect.width !== last.width || rect.height !== last.height) {
          const viewport = instance.getViewport()
          if (last.width > 0 && last.height > 0 && viewport.zoom > 0
            && [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite)) {
            void instance.setViewport({
              x: viewport.x + (rect.width - last.width) / 2,
              y: viewport.y + (rect.height - last.height) / 2,
              zoom: viewport.zoom,
            })
          }
          last = rect
        }
        tryApplyViewport()
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [tryApplyViewport])

  /** 画布空白右键：换算鼠标位置的刻度，供「在此创建事件」预填。 */
  const handlePaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault()
    let suggestedOrder: number | null = null
    let canCreate = true
    const instance = instanceRef.current

    if (instance) {
      const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const startAnchorX = layout.startAnchor.x
      const endAnchorX = layout.endAnchor.x + layout.endAnchor.width

      if (flowPos.x < startAnchorX - 20 || flowPos.x > endAnchorX + 20) {
        canCreate = false
      } else {
        const trunkEventStartX = layout.startAnchor.x + layout.startAnchor.width + 30
        const trunkEventEndX = layout.endAnchor.x - 30
        const span = Math.max(1, trunkEventEndX - trunkEventStartX)
        const t = Math.max(0, Math.min(1, (flowPos.x - trunkEventStartX) / span))
        const rawOrder = Math.round(layout.range.startOrder + t * (layout.range.endOrder - layout.range.startOrder))
        suggestedOrder = Math.max(layout.range.startOrder, Math.min(layout.range.endOrder, rawOrder))
      }
    }

    callbacksRef.current.onCanvasContextMenu(
      { clientX: e.clientX, clientY: e.clientY },
      { suggestedOrder, canCreate },
    )
  }, [layout])

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: SceneNode) => {
    e.preventDefault()
    e.stopPropagation()
    const point: TimelineScreenPoint = { clientX: e.clientX, clientY: e.clientY }
    if (node.type === 'timeline-event' && node.data.eventId) {
      callbacksRef.current.onOpenEventFloat(node.data.eventId, point, 'details')
    } else if (node.type === 'timeline-anchor' && node.data.anchorType) {
      callbacksRef.current.onAnchorContextMenu(node.data.anchorType, point)
    }
  }, [])

  const flowNodes = useMemo<SceneNode[]>(() => {
    const startAnchorNode: SceneNode = {
      id: layout.startAnchor.id,
      type: 'timeline-anchor',
      position: { x: layout.startAnchor.x, y: layout.startAnchor.y },
      style: { width: layout.startAnchor.width, height: layout.startAnchor.height },
      selectable: false,
      draggable: false,
      data: {
        label: layout.startAnchor.label,
        timeLabel: layout.startAnchor.timeLabel,
        anchorType: 'start',
        onAnchorActivate: (anchor: 'start' | 'end') => callbacksRef.current.onOpenRangeEditor(anchor),
      },
    }

    const endAnchorNode: SceneNode = {
      id: layout.endAnchor.id,
      type: 'timeline-anchor',
      position: { x: layout.endAnchor.x, y: layout.endAnchor.y },
      style: { width: layout.endAnchor.width, height: layout.endAnchor.height },
      selectable: false,
      draggable: false,
      data: {
        label: layout.endAnchor.label,
        timeLabel: layout.endAnchor.timeLabel,
        anchorType: 'end',
        onAnchorActivate: (anchor: 'start' | 'end') => callbacksRef.current.onOpenRangeEditor(anchor),
      },
    }

    const axis: SceneNode = {
      id: AXIS_NODE_ID,
      type: 'timeline-axis',
      position: { x: layout.axis.x, y: layout.axis.y },
      style: { width: layout.axis.width, height: layout.axis.height },
      selectable: false,
      draggable: false,
      focusable: false,
      data: {
        dots: layout.axisDots.map(dot => ({
          eventId: dot.eventId,
          offsetX: dot.x - layout.axis.x,
          selected: dot.eventId === selectedId,
        })),
      },
    }

    const eventNodes = layout.events.map<SceneNode>(event => ({
      id: event.id,
      type: 'timeline-event',
      position: { x: event.x, y: event.y },
      draggable: false,
      selected: event.id === selectedId,
      data: {
        eventId: event.id,
        title: event.title,
        timeText: event.timeText,
        description: event.description,
        metaText: event.metaText,
        side: event.side,
        staggerLevel: event.staggerLevel,
        width: event.width,
        status: event.status,
        childBranchCount: event.childBranchCount,
        isExpanded: event.isExpanded,
        onToggleExpand: (eventId: string) => callbacksRef.current.onToggleBranch(eventId),
        onSelect: (eventId: string) => callbacksRef.current.onSelectEvent(eventId),
        onOpenFloat: (eventId: string, point: TimelineScreenPoint, mode: 'details' | 'edit') => {
          callbacksRef.current.onOpenEventFloat(eventId, point, mode)
        },
      },
    }))

    const branchLabelNodes = layout.branchLabels.map<SceneNode>(label => ({
      id: `branch-label-${label.branchId}`,
      type: 'timeline-branch-label',
      position: { x: label.x, y: label.y },
      selectable: false,
      draggable: false,
      focusable: false,
      data: { branchName: label.name, color: label.color },
    }))

    return [axis, startAnchorNode, endAnchorNode, ...branchLabelNodes, ...eventNodes]
  }, [layout, selectedId])

  const flowEdges = useMemo<SceneEdge[]>(() => {
    const eventById = new Map(layout.events.map(event => [event.id, event]))

    // 1. 主轴圆点 → 事件标注的竖直短茎
    const stems = layout.events
      .filter(event => event.branchId === STORY_TIMELINE_MAIN_BRANCH_ID)
      .map<SceneEdge>(event => ({
        id: `stem-${event.id}`,
        type: 'timeline-stem',
        source: AXIS_NODE_ID,
        sourceHandle: `dot-${event.id}`,
        target: event.id,
        targetHandle: 'event-in',
        selectable: false,
        focusable: false,
        data: {},
      }))

    // 2. 支线曲线与支线内部顺延线：主线来源从轴点出发，嵌套来源从源事件出发
    const treeEdges = layout.edges.map<SceneEdge>((edge) => {
      const sourceEvent = eventById.get(edge.source)
      const fromAxis = sourceEvent?.branchId === STORY_TIMELINE_MAIN_BRANCH_ID
      return {
        id: edge.id,
        type: edge.type,
        source: fromAxis ? AXIS_NODE_ID : edge.source,
        sourceHandle: fromAxis ? `dot-${edge.source}` : 'tree-out',
        target: edge.target,
        targetHandle: 'tree-in',
        selectable: false,
        focusable: false,
        data: { color: edge.color, direction: edge.direction },
      }
    })

    return [...stems, ...treeEdges]
  }, [layout])

  return (
    <div ref={wrapperRef} className="writer-timeline-flow-surface">
      <ReactFlow<SceneNode, SceneEdge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={initialViewport}
        onInit={(instance) => {
          instanceRef.current = instance
          tryApplyViewport()
        }}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        onMoveStart={() => callbacksRef.current.onInteractStart?.()}
        onMoveEnd={(_event, viewport) => callbacksRef.current.onViewportChange?.(viewport)}
        onNodeClick={(_event, node) => {
          if (node.type === 'timeline-event' && node.data.eventId) {
            callbacksRef.current.onSelectEvent(node.data.eventId)
          }
        }}
        onNodeDoubleClick={(_event, node) => {
          if (node.type === 'timeline-event' && node.data.eventId) {
            callbacksRef.current.onOpenEventFloat(
              node.data.eventId,
              pointFromElement(nodeWrapper(node.id)),
              'edit',
            )
          } else if (node.type === 'timeline-anchor' && node.data.anchorType) {
            callbacksRef.current.onOpenRangeEditor(node.data.anchorType)
          }
        }}
        onPaneClick={() => callbacksRef.current.onSelectEvent(null)}
        // 时间轴按刻度 160px 展开，故事范围大时总宽可达数千像素；
        // 允许缩到 0.05 才能把整条主轴框进视口。
        minZoom={0.05}
        maxZoom={2}
        panOnDrag
        zoomOnScroll
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        className="writer-timeline-reactflow"
      >
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}

/** 双击事件的定位点：优先取节点包装元素的真实位置。 */
function nodeWrapper(nodeId: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
    ?? document.body
}
