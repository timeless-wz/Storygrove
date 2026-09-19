import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  GitBranch,
  Maximize2,
  Settings2,
} from 'lucide-react'
import type {
  StoryTimelineEvent,
  StoryTimelineEventStatus,
  StoryTimelineMention,
} from '../../shared/story-timeline'
import { STORY_TIMELINE_MAIN_BRANCH_ID } from '../../shared/story-timeline'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useCharacterStore } from '../../stores/character-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import {
  buildStoryTimelineLayout,
  sortTimelineEvents,
  type StoryTimelineLabelSide,
} from './story-timeline-layout'
import { TimelineContextMenu } from './TimelineContextMenu'
import { TimelineEventModal } from './TimelineEventModal'
import { TimelineRangeModal } from './TimelineRangeModal'

const TIMELINE_AXIS_NODE_ID = 'timeline-axis'

type TimelineNodeData = Record<string, unknown> & {
  handles?: Array<{ id: string; offsetX: number }>
  eventId?: string
  branchId?: string
  title?: string
  timeText?: string
  side?: StoryTimelineLabelSide
  staggerLevel?: number
  width?: number
  status?: StoryTimelineEventStatus
  childBranchCount?: number
  isExpanded?: boolean
  label?: string
  timeLabel?: string
  order?: number
  anchorType?: 'start' | 'end'
  onEdit?: (anchorType: 'start' | 'end') => void
  onToggleExpand?: (eventId: string) => void
  onSelect?: (eventId: string) => void
  onDoubleClick?: (eventId: string) => void
}

type TimelineNode = Node<TimelineNodeData, 'timeline-axis' | 'timeline-event' | 'timeline-anchor'>

type TimelineEdgeData = Record<string, unknown> & {
  color?: string
}

type TimelineEdge = Edge<TimelineEdgeData, 'timeline-connector' | 'timeline-trunk' | 'timeline-branch'>

/**
 * 主轴：一条水平连续线，并为每个事件暴露引出点。
 */
function TimelineAxisNodeView({ data }: NodeProps<TimelineNode>) {
  return (
    <div className="writer-timeline-axis" data-testid="timeline-axis">
      <div className="writer-timeline-axis-line" aria-hidden="true" />
      {data.handles?.map(handle => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={Position.Top}
          isConnectable={false}
          className="writer-timeline-axis-handle"
          style={{ left: handle.offsetX, top: 0, transform: 'translate(-50%, -50%)' }}
        />
      ))}
    </div>
  )
}

/**
 * 事件节点卡片：
 * 包含时间、标题、状态指示点、以及支线折叠/展开徽标（有支线时展示）。
 */
function TimelineEventNodeView({ data, selected }: NodeProps<TimelineNode>) {
  return (
    <div
      className={`writer-timeline-label is-${data.side}${selected ? ' is-selected' : ''}`}
      data-testid="timeline-event-label"
      data-event-id={data.eventId}
      data-side={data.side}
      data-stagger-level={data.staggerLevel}
      style={{ width: data.width }}
      title={data.title}
      onClick={() => {
        if (data.eventId) data.onSelect?.(data.eventId)
      }}
      onDoubleClick={() => {
        if (data.eventId) data.onDoubleClick?.(data.eventId)
      }}
    >
      {/* 针对从主轴引出线的接收 handle */}
      <Handle
        id="event-in"
        type="target"
        position={data.side === 'above' ? Position.Bottom : Position.Top}
        isConnectable={false}
        className="writer-timeline-label-handle"
      />
      {/* 针对横向主干与支线贝塞尔的接收与引出 handle */}
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

      <div className="writer-timeline-label-header">
        <span className="writer-timeline-label-time">{data.timeText}</span>
        <span
          className={`writer-timeline-status-dot is-${data.status}`}
          data-testid="timeline-status-dot"
          aria-label={data.status}
        />
      </div>

      <strong className="writer-timeline-label-title">{data.title}</strong>

      {(data.childBranchCount ?? 0) > 0 && (
        <button
          type="button"
          className="writer-timeline-branch-badge"
          data-testid="timeline-branch-badge"
          onClick={(event) => {
            event.stopPropagation()
            if (data.eventId) data.onToggleExpand?.(data.eventId)
          }}
          title={data.isExpanded ? '点击折叠该支线' : '点击展开该支线'}
        >
          <GitBranch size={10} />
          <span>{data.childBranchCount} 支线</span>
          {data.isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}
    </div>
  )
}

/** 主轴到事件标注的竖向连接线 */
function TimelineConnectorEdgeView({ sourceX, sourceY, targetX, targetY, selected }: EdgeProps<TimelineEdge>) {
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  return (
    <BaseEdge
      path={path}
      className={`writer-timeline-connector${selected ? ' is-selected' : ''}`}
      style={{ stroke: 'var(--color-border-strong, var(--color-border))', strokeWidth: 1.2 }}
    />
  )
}

/** 支线内部事件顺延连接线 */
function TimelineTrunkEdgeView({ sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<TimelineEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    borderRadius: 6,
  })
  return (
    <BaseEdge
      path={path}
      className={`writer-timeline-trunk-edge${selected ? ' is-selected' : ''}`}
      style={{
        stroke: data?.color || 'var(--color-border-strong, var(--color-border))',
        strokeWidth: 1.6,
      }}
    />
  )
}

/** 分叉源到支线首节点的平滑贝塞尔曲线 */
function TimelineBranchEdgeView({ sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<TimelineEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    curvature: 0.35,
  })
  return (
    <BaseEdge
      path={path}
      className={`writer-timeline-branch-edge${selected ? ' is-selected' : ''}`}
      style={{
        stroke: data?.color || '#10b981',
        strokeWidth: 1.8,
      }}
    />
  )
}

/**
 * 故事开端与结束锚点卡片：界定故事范围，不可删除、不可分叉，可点击或右键编辑
 */
function TimelineAnchorNodeView({ data }: NodeProps<TimelineNode>) {
  return (
    <div
      className={`writer-timeline-anchor is-${data.anchorType}`}
      data-testid={`timeline-anchor-${data.anchorType}`}
      title={data.timeLabel ? `${data.label} (${data.timeLabel})` : data.label}
      onClick={(e) => {
        e.stopPropagation()
        data.onEdit?.(data.anchorType!)
      }}
    >
      <span className="writer-timeline-anchor-title">{data.label}</span>
      <span className="writer-timeline-anchor-meta">
        [{data.order}]{data.timeLabel ? ` · ${data.timeLabel}` : ''}
      </span>
    </div>
  )
}

const nodeTypes = {
  'timeline-axis': TimelineAxisNodeView,
  'timeline-event': TimelineEventNodeView,
  'timeline-anchor': TimelineAnchorNodeView,
}

const edgeTypes = {
  'timeline-connector': TimelineConnectorEdgeView,
  'timeline-trunk': TimelineTrunkEdgeView,
  'timeline-branch': TimelineBranchEdgeView,
}

interface ModalState {
  open: boolean
  mode: 'create-main' | 'create-next' | 'create-branch' | 'edit'
  initialEvent?: StoryTimelineEvent | null
  sourceEvent?: StoryTimelineEvent | null
  initialSortOrder?: number
}

interface ContextMenuState {
  x: number
  y: number
  targetEventId: string | null
  targetAnchor: 'start' | 'end' | null
  suggestedOrder: number | null
  canCreateEventAtPosition: boolean
}

export default function StoryTimelineView({
  projectKey,
  onNavigateMention,
}: {
  projectKey: string
  onNavigateMention?: (mention: StoryTimelineMention) => void
}) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const settings = useStoryTimelineStore(s => s.settings)
  const branches = useStoryTimelineStore(s => s.branches)
  const events = useStoryTimelineStore(s => s.events)
  const expandedBranchIds = useStoryTimelineStore(s => s.expandedBranchIds)
  const loading = useStoryTimelineStore(s => s.loading)
  const dataProjectKey = useStoryTimelineStore(s => s.dataProjectKey)
  const loadAll = useStoryTimelineStore(s => s.loadAll)
  const saveSettings = useStoryTimelineStore(s => s.saveSettings)
  const upsertEvent = useStoryTimelineStore(s => s.upsertEvent)
  const deleteEvent = useStoryTimelineStore(s => s.deleteEvent)
  const upsertBranch = useStoryTimelineStore(s => s.upsertBranch)
  const setBranchExpanded = useStoryTimelineStore(s => s.setBranchExpanded)
  const loadWorldMap = useWorldMapStore(s => s.loadAll)

  const flowInstanceRef = useRef<ReactFlowInstance<TimelineNode, TimelineEdge> | null>(null)
  const [rangeModalOpen, setRangeModalOpen] = useState(false)
  const [rangeModalFocus, setRangeModalFocus] = useState<'start' | 'end' | 'general'>('general')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 浮层上下文菜单与编辑弹窗状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [modalState, setModalState] = useState<ModalState>({ open: false, mode: 'create-main' })

  /**
   * 提及只是一条导航入口，不能凭空创建人物或写入人物事实。若调用者没有
   * 自定义导航器，则在当前项目的已加载角色名单中定位同名角色并打开概览。
   */
  const handleNavigateMention = useCallback((mention: StoryTimelineMention) => {
    if (onNavigateMention) {
      onNavigateMention(mention)
      return
    }
    if (currentProject?.path !== projectKey) return

    const target = useCharacterStore.getState().characters
      .find(character => character.name === mention.name)
    if (!target) {
      toast.warning(text(
        `未找到「${mention.name}」的人物卡片，无法跳转。`,
        `No character card found for “${mention.name}”.`,
      ))
      return
    }

    useCharacterStore.getState().setSelectedName(target.name)
    useLayoutStore.getState().openCharacterProfile('overview')
  }, [currentProject?.path, onNavigateMention, projectKey, text])

  useEffect(() => {
    void loadAll(projectKey)
    void loadWorldMap(projectKey)
  }, [projectKey, loadAll, loadWorldMap])

  const orderedEvents = useMemo(() => sortTimelineEvents(events), [events])
  const nextMainOrder = useMemo(() => {
    const mainEvents = orderedEvents.filter(e => (e.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID)
    return mainEvents.length > 0
      ? Math.max(...mainEvents.map(e => e.sortOrder)) + 1
      : 1
  }, [orderedEvents])

  // 处理源事件上的分支展开/折叠
  const handleToggleEventBranch = useCallback((eventId: string) => {
    const childBranches = branches.filter(b => b.sourceEventId === eventId)
    if (childBranches.length === 0) return
    const isAnyExpanded = childBranches.some(b => expandedBranchIds.includes(b.id))
    childBranches.forEach(b => {
      setBranchExpanded(b.id, !isAnyExpanded)
    })
  }, [branches, expandedBranchIds, setBranchExpanded])

  // 纯函数推导时间树布局
  const layout = useMemo(() => {
    return buildStoryTimelineLayout(events, branches, expandedBranchIds, settings)
  }, [events, branches, expandedBranchIds, settings])

  const flowNodes = useMemo<TimelineNode[]>(() => {
    const startAnchorNode: TimelineNode = {
      id: layout.startAnchor.id,
      type: 'timeline-anchor',
      position: { x: layout.startAnchor.x, y: layout.startAnchor.y },
      style: { width: layout.startAnchor.width, height: layout.startAnchor.height },
      selectable: false,
      draggable: false,
      data: {
        label: layout.startAnchor.label,
        timeLabel: layout.startAnchor.timeLabel,
        order: layout.startAnchor.order,
        anchorType: 'start',
        onEdit: () => {
          setRangeModalFocus('start')
          setRangeModalOpen(true)
        },
      },
    }

    const endAnchorNode: TimelineNode = {
      id: layout.endAnchor.id,
      type: 'timeline-anchor',
      position: { x: layout.endAnchor.x, y: layout.endAnchor.y },
      style: { width: layout.endAnchor.width, height: layout.endAnchor.height },
      selectable: false,
      draggable: false,
      data: {
        label: layout.endAnchor.label,
        timeLabel: layout.endAnchor.timeLabel,
        order: layout.endAnchor.order,
        anchorType: 'end',
        onEdit: () => {
          setRangeModalFocus('end')
          setRangeModalOpen(true)
        },
      },
    }

    const axis: TimelineNode = {
      id: TIMELINE_AXIS_NODE_ID,
      type: 'timeline-axis',
      position: { x: layout.axis.x, y: layout.axis.y },
      style: { width: layout.axis.width, height: layout.axis.height },
      selectable: false,
      draggable: false,
      focusable: false,
      data: {
        handles: layout.events
          .filter(e => e.branchId === STORY_TIMELINE_MAIN_BRANCH_ID)
          .map((event, index) => ({
            id: `axis-out-${index}`,
            offsetX: (event.x + event.width / 2) - layout.axis.x,
          })),
        eventId: '',
        branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
        title: '',
        timeText: '',
        side: 'above',
        staggerLevel: 0,
        width: layout.axis.width,
        status: 'planned',
        childBranchCount: 0,
        isExpanded: false,
      },
    }

    const eventNodes = layout.events.map<TimelineNode>((event, index) => ({
      id: event.id,
      type: 'timeline-event',
      position: { x: event.x, y: event.y },
      draggable: false,
      selected: event.id === selectedId,
      data: {
        handles: [{ id: `axis-out-${index}`, offsetX: 0 }],
        eventId: event.id,
        branchId: event.branchId,
        title: event.title,
        timeText: event.timeText,
        side: event.side,
        staggerLevel: event.staggerLevel,
        width: event.width,
        status: event.status,
        childBranchCount: event.childBranchCount,
        isExpanded: event.isExpanded,
        onToggleExpand: handleToggleEventBranch,
        onSelect: (id: string) => setSelectedId(id),
        onDoubleClick: (id: string) => {
          const target = events.find(e => e.id === id)
          if (target) {
            setModalState({ open: true, mode: 'edit', initialEvent: target })
          }
        },
      },
    }))

    return [axis, startAnchorNode, endAnchorNode, ...eventNodes]
  }, [layout, selectedId, events, handleToggleEventBranch])

  const flowEdges = useMemo<TimelineEdge[]>(() => {
    // 1. 主轴到主轴事件的垂直接线
    const mainPlaced = layout.events.filter(e => e.branchId === STORY_TIMELINE_MAIN_BRANCH_ID)
    const connectors = mainPlaced.map((event, index) => ({
      id: `connector-${event.id}`,
      type: 'timeline-connector' as const,
      source: TIMELINE_AXIS_NODE_ID,
      sourceHandle: `axis-out-${index}`,
      target: event.id,
      targetHandle: 'event-in',
      selectable: false,
      focusable: false,
      data: {},
    }))

    // 2. 布局中生成的树状连线（主干/支线平滑贝塞尔）
    const treeEdges = layout.edges.map(edge => ({
      id: edge.id,
      type: edge.type,
      source: edge.source,
      sourceHandle: 'tree-out',
      target: edge.target,
      targetHandle: 'tree-in',
      selectable: false,
      focusable: false,
      data: { color: edge.color },
    }))

    return [...connectors, ...treeEdges]
  }, [layout])

  // 浮层表单保存回调
  const handleModalSave = async ({
    event,
    newBranchName,
  }: {
    event: StoryTimelineEvent
    newBranchName?: string
  }) => {
    if (newBranchName && modalState.mode === 'create-branch' && modalState.sourceEvent) {
      // 先持久化新分支
      const branchCreated = await upsertBranch({
        id: event.branchId!,
        name: newBranchName,
        sourceEventId: modalState.sourceEvent.id,
        sortOrder: branches.length + 1,
      })
      if (!branchCreated) return
    }

    const saved = await upsertEvent(event)
    if (saved) {
      setSelectedId(event.id)
    }
  }

  // 画布右键：弹出空白处/主干上下文菜单，并换算鼠标对应刻度
  const handlePaneContextMenu = (e: MouseEvent | React.MouseEvent) => {
    e.preventDefault()
    let suggestedOrder: number | null = null
    let canCreate = true

    if (flowInstanceRef.current) {
      const flowPos = flowInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const startAnchorX = layout.startAnchor.x
      const endAnchorX = layout.endAnchor.x + layout.endAnchor.width

      // 必须在“故事开端”和“故事结束”之间右键才能创建事件
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

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetEventId: null,
      targetAnchor: null,
      suggestedOrder,
      canCreateEventAtPosition: canCreate,
    })
  }

  // 节点右键：弹出节点上下文菜单
  const handleNodeContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    e.stopPropagation()
    if (node.type === 'timeline-event') {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetEventId: (node.data as any).eventId,
        targetAnchor: null,
        suggestedOrder: null,
        canCreateEventAtPosition: false,
      })
    } else if (node.type === 'timeline-anchor') {
      const anchorType = (node.data as any).anchorType as 'start' | 'end'
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetEventId: null,
        targetAnchor: anchorType,
        suggestedOrder: null,
        canCreateEventAtPosition: false,
      })
    }
  }

  const contextTargetEvent = contextMenu?.targetEventId
    ? events.find(e => e.id === contextMenu.targetEventId)
    : null
  const targetChildBranches = contextTargetEvent
    ? branches.filter(b => b.sourceEventId === contextTargetEvent.id)
    : []
  const hasChildBranches = targetChildBranches.length > 0
  const isBranchExpanded = hasChildBranches && targetChildBranches.some(b => expandedBranchIds.includes(b.id))

  const isDataReady = dataProjectKey === projectKey

  return (
    <div
      className="writer-timeline h-full overflow-hidden flex flex-col"
      style={{ backgroundColor: 'var(--color-editor-bg)', color: 'var(--color-text)' }}
    >
      <div className="writer-timeline-shell flex-1 flex flex-col min-h-0">
        <header className="writer-timeline-header">
          <div>
            <div className="writer-timeline-eyebrow">
              <Clock3 size={14} /> {text('创作规划 / 故事时间树', 'Story Timeline Tree')}
            </div>
            <h1>{settings.title}</h1>
            <p>
              {text(
                '记录小说重大事件与多重分支。主轴向右推进，锚点界定故事范围；右键空白处或事件可快捷新增。',
                'Track major events and branches. Anchors define story range; right-click to add.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRangeModalFocus('general')
                setRangeModalOpen(true)
              }}
            >
              <Settings2 size={13} /> {text('刻度设置', 'Ruler settings')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                flowInstanceRef.current?.fitView({ padding: 0.2, duration: 250 })
              }}
            >
              <Maximize2 size={13} /> {text('适应视图', 'Fit view')}
            </Button>
          </div>
        </header>

        <div className="writer-timeline-workspace flex-1 flex flex-col min-h-0">
          <section
            className="writer-timeline-canvas flex-1 flex flex-col min-h-0"
            aria-label={text('故事时间轴', 'Story timeline')}
          >
            <div className="writer-timeline-ruler-heading">
              <span>{settings.rulerLabel}</span>
              <small>{settings.rulerUnit}</small>
              <small className="writer-timeline-ruler-hint">
                {text(
                  '拖动平移，滚轮缩放；右键主干或节点添加事件与分支。',
                  'Drag to pan, scroll to zoom; right-click to add events.',
                )}
              </small>
            </div>

            {loading && !isDataReady ? (
              <div className="writer-timeline-empty">
                {text('正在读取项目时间线…', 'Loading project timeline…')}
              </div>
            ) : (
              <div
                className="writer-timeline-flow w-full flex-1 min-h-0 relative"
                data-testid="timeline-flow"
                onContextMenu={handlePaneContextMenu}
              >
                <ReactFlow<TimelineNode, TimelineEdge>
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onInit={(instance) => {
                    flowInstanceRef.current = instance
                    instance.fitView({ padding: 0.2 })
                  }}
                  onPaneContextMenu={handlePaneContextMenu}
                  onNodeContextMenu={handleNodeContextMenu}
                  onNodeClick={(_event, node) => {
                    if (node.type === 'timeline-event') {
                      setSelectedId((node.data as any).eventId)
                    }
                  }}
                  onNodeDoubleClick={(_event, node) => {
                    if (node.type === 'timeline-event') {
                      const target = events.find(e => e.id === (node.data as any).eventId)
                      if (target) {
                        setModalState({ open: true, mode: 'edit', initialEvent: target })
                      }
                    } else if (node.type === 'timeline-anchor') {
                      setRangeModalFocus((node.data as any).anchorType)
                      setRangeModalOpen(true)
                    }
                  }}
                  minZoom={0.2}
                  maxZoom={2.0}
                  panOnDrag={true}
                  zoomOnScroll={true}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                  className="bg-[var(--color-editor-bg)]"
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={18}
                    size={1}
                    color="var(--color-border-subtle, #d1d5db)"
                  />
                  <Controls showInteractive={false} position="bottom-right" />
                </ReactFlow>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 画布右键浮层菜单 */}
      {contextMenu && (
        <TimelineContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetEventId={contextMenu.targetEventId}
          targetAnchor={contextMenu.targetAnchor}
          suggestedOrder={contextMenu.suggestedOrder}
          canCreateEventAtPosition={contextMenu.canCreateEventAtPosition}
          hasChildBranches={hasChildBranches}
          isBranchExpanded={isBranchExpanded}
          onClose={() => setContextMenu(null)}
          onOpenRangeSettings={(focusField) => {
            setRangeModalFocus(focusField || 'general')
            setRangeModalOpen(true)
          }}
          onCreateMainEvent={(suggestedOrder) => {
            setSelectedId(null)
            setModalState({
              open: true,
              mode: 'create-main',
              initialSortOrder: suggestedOrder,
            })
          }}
          onCreateNextEvent={() => {
            if (contextTargetEvent) {
              setModalState({
                open: true,
                mode: 'create-next',
                sourceEvent: contextTargetEvent,
              })
            }
          }}
          onCreateBranch={() => {
            if (contextTargetEvent) {
              setModalState({
                open: true,
                mode: 'create-branch',
                sourceEvent: contextTargetEvent,
              })
            }
          }}
          onToggleExpand={() => {
            if (contextTargetEvent) {
              handleToggleEventBranch(contextTargetEvent.id)
            }
          }}
          onEditEvent={() => {
            if (contextTargetEvent) {
              setModalState({
                open: true,
                mode: 'edit',
                initialEvent: contextTargetEvent,
              })
            }
          }}
          onDeleteEvent={async () => {
            if (contextTargetEvent) {
              await deleteEvent(contextTargetEvent.id)
            }
          }}
        />
      )}

      {/* 浮层事件编辑弹窗 */}
      <TimelineEventModal
        open={modalState.open}
        mode={modalState.mode}
        initialEvent={modalState.initialEvent}
        sourceEvent={modalState.sourceEvent}
        currentBranchName={
          modalState.initialEvent
            ? branches.find(b => b.id === (modalState.initialEvent?.branchId || STORY_TIMELINE_MAIN_BRANCH_ID))?.name
            : undefined
        }
        nextSortOrder={nextMainOrder}
        initialSortOrder={modalState.initialSortOrder}
        storyRange={{
          startOrder: layout.range.startOrder,
          endOrder: layout.range.endOrder,
        }}
        onClose={() => setModalState({ open: false, mode: 'create-main' })}
        onSave={handleModalSave}
        onDelete={async (id) => {
          await deleteEvent(id)
        }}
        onNavigateMention={handleNavigateMention}
      />

      {/* 故事范围与刻度设置弹窗 */}
      <TimelineRangeModal
        open={rangeModalOpen}
        settings={settings}
        events={events}
        initialFocusField={rangeModalFocus}
        onClose={() => setRangeModalOpen(false)}
        onSave={async (newSettings) => {
          await saveSettings(newSettings)
        }}
      />
    </div>
  )
}
