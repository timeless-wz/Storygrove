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
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import type {
  StoryTimelineEvent,
  StoryTimelineEventStatus,
  StoryTimelineMention,
} from '../../shared/story-timeline'
import { STORY_TIMELINE_MAIN_BRANCH_ID, STORY_TIMELINE_STATUS_LABELS } from '../../shared/story-timeline'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useCharacterStore } from '../../stores/character-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import {
  PlanningPageShell,
  PlanningPane,
  PlanningSearch,
  PlanningChipGroup,
  PlanningListRow,
  PlanningEmptyState,
} from '../planning/PlanningPageShell'
import { usePlanningBackPath } from '../planning/planning-navigation'
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
  onCreateBranch?: (eventId: string) => void
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

      {/* 选中事件后直接给出分叉入口，避免把核心创作动作藏在右键菜单中。 */}
      {selected && (
        <button
          type="button"
          className="writer-timeline-create-branch"
          data-testid="timeline-create-branch"
          onClick={(event) => {
            event.stopPropagation()
            if (data.eventId) data.onCreateBranch?.(data.eventId)
          }}
          title="从此事件创建一条向后发展的支线"
        >
          <GitBranch size={10} />
          <span>创建支线</span>
        </button>
      )}

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
  const backPath = usePlanningBackPath()
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
  const worldMapNodes = useWorldMapStore(s => s.nodes)

  const flowInstanceRef = useRef<ReactFlowInstance<TimelineNode, TimelineEdge> | null>(null)
  const [rangeModalOpen, setRangeModalOpen] = useState(false)
  const [rangeModalFocus, setRangeModalFocus] = useState<'start' | 'end' | 'general'>('general')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 清单请求把画布视线移到某个事件；nonce 让同一事件被重复点击时也会再次定位。 */
  const [centerRequest, setCenterRequest] = useState<{ eventId: string | null; nonce: number }>({ eventId: null, nonce: 0 })

  // 浮层上下文菜单与编辑弹窗状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [modalState, setModalState] = useState<ModalState>({ open: false, mode: 'create-main' })

  // 左侧事件清单：搜索与按状态 / 主线支线筛选
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StoryTimelineEventStatus>('all')
  const [branchFilter, setBranchFilter] = useState<string>('all')

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

  const handleCreateBranchFromEvent = useCallback((eventId: string) => {
    const sourceEvent = events.find(event => event.id === eventId)
    if (!sourceEvent) return
    setSelectedId(eventId)
    setModalState({ open: true, mode: 'create-branch', sourceEvent })
  }, [events])

  // 纯函数推导时间树布局
  const layout = useMemo(() => {
    return buildStoryTimelineLayout(events, branches, expandedBranchIds, settings)
  }, [events, branches, expandedBranchIds, settings])

  const branchNameById = useMemo(() => {
    const names = new Map<string, string>()
    for (const branch of branches) names.set(branch.id, branch.name)
    return names
  }, [branches])

  const statusLabel = useCallback((status: StoryTimelineEventStatus) => {
    const label = STORY_TIMELINE_STATUS_LABELS[status]
    return text(label.zh, label.en)
  }, [text])

  /** 左侧清单：搜索 + 状态筛选 + 主线/支线筛选，三者都作用在自己的数据上。 */
  const listedEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return orderedEvents.filter(event => {
      const branchId = event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID
      if (branchFilter !== 'all' && branchId !== branchFilter) return false
      if (statusFilter !== 'all' && event.status !== statusFilter) return false
      if (query && !(
        event.title.toLowerCase().includes(query)
        || event.timeLabel.toLowerCase().includes(query)
      )) return false
      return true
    })
  }, [orderedEvents, branchFilter, statusFilter, searchQuery])

  /** 按主线 / 支线分组，只保留筛选后仍有事件的分组。 */
  const listedEventGroups = useMemo(() => {
    const groups: Array<{ id: string; name: string; events: StoryTimelineEvent[] }> = []
    const mainEvents = listedEvents.filter(
      event => (event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID,
    )
    if (mainEvents.length > 0) {
      groups.push({ id: STORY_TIMELINE_MAIN_BRANCH_ID, name: text('主轴事件', 'Main axis'), events: mainEvents })
    }
    for (const branch of branches) {
      if (branch.id === STORY_TIMELINE_MAIN_BRANCH_ID) continue
      const branchEvents = listedEvents.filter(event => event.branchId === branch.id)
      if (branchEvents.length === 0) continue
      groups.push({ id: branch.id, name: branch.name, events: branchEvents })
    }
    return groups
  }, [listedEvents, branches, text])

  const selectedEvent = useMemo(
    () => events.find(event => event.id === selectedId) ?? null,
    [events, selectedId],
  )

  const listFilterActive = statusFilter !== 'all' || branchFilter !== 'all' || searchQuery.trim() !== ''

  /**
   * 在清单里选中事件：同时展开它所在的支线，并请求画布把视线移到它上面。
   *
   * 这里只记录「本次要定位的事件 id」；真正的视口移动放在 effect 里、拿到
   * React Flow 实例之后再执行，事件回调本身不读取 ref。
   */
  const focusEventFromList = useCallback((eventId: string) => {
    setSelectedId(eventId)
    const event = events.find(item => item.id === eventId)
    if (!event) return
    const branchId = event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID
    if (branchId !== STORY_TIMELINE_MAIN_BRANCH_ID && !expandedBranchIds.includes(branchId)) {
      setBranchExpanded(branchId, true)
    }
    setCenterRequest(current => ({ eventId, nonce: current.nonce + 1 }))
  }, [events, expandedBranchIds, setBranchExpanded])

  useEffect(() => {
    if (!centerRequest.eventId) return
    const placed = layout.events.find(item => item.id === centerRequest.eventId)
    const instance = flowInstanceRef.current
    if (!placed || !instance) return
    instance.setCenter(
      placed.x + placed.width / 2,
      placed.y + placed.height / 2,
      { zoom: instance.getZoom(), duration: 250 },
    )
  }, [centerRequest, layout])

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
        onCreateBranch: handleCreateBranchFromEvent,
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
  }, [layout, selectedId, events, handleToggleEventBranch, handleCreateBranchFromEvent])

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
    // React Flow 初次初始化时只有两个范围锚点。首个普通事件加入后，节点
    // 尺寸与连线会在下一帧才完成测量；此时只校正一次视口，避免窗口落在
    // 旧的空白坐标上。后续创建/编辑绝不自动重置作者已调整过的视角。
    const isFirstTimelineEvent = events.length === 0

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
      if (isFirstTimelineEvent) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            flowInstanceRef.current?.fitView({ padding: 0.2, duration: 0 })
          })
        })
      }
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
  const handleNodeContextMenu = (e: React.MouseEvent, node: TimelineNode) => {
    e.preventDefault()
    e.stopPropagation()
    if (node.type === 'timeline-event') {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetEventId: node.data.eventId ?? null,
        targetAnchor: null,
        suggestedOrder: null,
        canCreateEventAtPosition: false,
      })
    } else if (node.type === 'timeline-anchor') {
      const anchorType = node.data.anchorType
      if (!anchorType) return
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
    <>
      <PlanningPageShell
        breadcrumb={[
          { label: backPath.overviewLabel, onClick: backPath.openOverview },
          { label: backPath.planLabel, onClick: backPath.revealWritingPlan },
          { label: text('故事时间线', 'Story timeline') },
        ]}
        icon={<Clock3 size={15} />}
        title={settings.title}
        description={text(
          '作者手动排布的故事时间轴：刻度、自定义时间与事件都由你填写，不依赖蓝图或 AI。主轴向右推进，锚点界定故事范围。',
          'A story timeline arranged by the author: ruler, custom time labels, and events are all entered by hand, independent of blueprints or AI. The axis advances rightwards while anchors bound the story range.',
        )}
        meta={text(
          `${events.length} 个事件 · ${branches.length} 条支线`,
          `${events.length} events · ${branches.length} branches`,
        )}
        actions={
          <>
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
          </>
        }
      >
        <PlanningPane
          title={text('事件与支线', 'Events & branches')}
          icon={<GitBranch size={12} />}
          width={250}
          actions={
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                setSelectedId(null)
                setModalState({ open: true, mode: 'create-main', initialSortOrder: nextMainOrder })
              }}
              title={text('新建主轴事件', 'New main-axis event')}
              aria-label={text('新建主轴事件', 'New main-axis event')}
            >
              <Plus size={13} />
            </Button>
          }
          filters={
            <>
              <PlanningSearch
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={text('搜索标题或时间…', 'Search title or time…')}
              />
              <PlanningChipGroup
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel={text('事件状态筛选', 'Event status filter')}
                options={[
                  { value: 'all', label: text('全部', 'All') },
                  { value: 'planned', label: statusLabel('planned') },
                  { value: 'drafted', label: statusLabel('drafted') },
                  { value: 'finalized', label: statusLabel('finalized') },
                ]}
              />
              {branches.length > 0 && (
                <PlanningChipGroup
                  value={branchFilter}
                  onChange={setBranchFilter}
                  ariaLabel={text('主线与支线筛选', 'Main line and branch filter')}
                  options={[
                    { value: 'all', label: text('全部线路', 'All lines') },
                    { value: STORY_TIMELINE_MAIN_BRANCH_ID, label: text('仅主轴', 'Main axis') },
                    ...branches
                      .filter(branch => branch.id !== STORY_TIMELINE_MAIN_BRANCH_ID)
                      .map(branch => ({ value: branch.id, label: branch.name })),
                  ]}
                />
              )}
            </>
          }
          footer={text(
            `显示 ${listedEvents.length} / ${events.length} 个事件`,
            `Showing ${listedEvents.length} of ${events.length} events`,
          )}
        >
          {listedEventGroups.length === 0 ? (
            <PlanningEmptyState
              icon={<Clock3 size={20} />}
              title={events.length === 0
                ? text('时间线上还没有事件', 'No timeline events yet')
                : text('没有符合筛选的事件', 'No events match the filters')}
              description={events.length === 0
                ? text(
                    '时间线只记录你自己排布的剧情时间，画布上不会预置任何占位事件。',
                    'The timeline only holds events you arrange; no placeholder events are pre-filled.',
                  )
                : text('可以调整搜索词，或切换状态与线路筛选。', 'Adjust the search term, or switch the status and line filters.')}
              steps={events.length === 0 ? [
                text('先在「刻度设置」里确定故事开端与结束，界定时间范围；', 'Set the story start and end in “Ruler settings” to bound the range.'),
                text('再在画布右键主干选择「添加事件」，或点下方「新建事件」。', 'Right-click the trunk in the canvas to add an event, or use “New event” below.'),
              ] : undefined}
              actions={events.length === 0 ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setSelectedId(null)
                    setModalState({ open: true, mode: 'create-main', initialSortOrder: nextMainOrder })
                  }}
                >
                  <Plus size={13} /> {text('新建事件', 'New event')}
                </Button>
              ) : listFilterActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                    setBranchFilter('all')
                  }}
                >
                  {text('清除筛选', 'Clear filters')}
                </Button>
              ) : undefined}
            />
          ) : listedEventGroups.map(group => (
            <div key={group.id}>
              <div className="planning-pane__group-label">{group.name}</div>
              {group.events.map(event => (
                <PlanningListRow
                  key={event.id}
                  selected={selectedId === event.id}
                  onSelect={() => focusEventFromList(event.id)}
                  onDoubleClick={() => setModalState({ open: true, mode: 'edit', initialEvent: event })}
                  icon={<span className={`writer-timeline-status-dot is-${event.status}`} aria-hidden="true" />}
                  title={event.title || text('未命名事件', 'Untitled event')}
                  subtitle={event.timeLabel || text('未填写时间', 'No time label')}
                  titleAttr={text('单击定位到画布，双击编辑事件', 'Click to locate on the canvas, double-click to edit')}
                  trailing={<span className="planning-tag">{statusLabel(event.status)}</span>}
                />
              ))}
            </div>
          ))}
        </PlanningPane>

        <main className="planning-page__main">
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
                      setSelectedId(node.data.eventId ?? null)
                    }
                  }}
                  onNodeDoubleClick={(_event, node) => {
                    if (node.type === 'timeline-event') {
                      const target = events.find(e => e.id === node.data.eventId)
                      if (target) {
                        setModalState({ open: true, mode: 'edit', initialEvent: target })
                      }
                    } else if (node.type === 'timeline-anchor') {
                      if (!node.data.anchorType) return
                      setRangeModalFocus(node.data.anchorType)
                      setRangeModalOpen(true)
                    }
                  }}
                  // 时间轴按刻度 160px 展开，故事范围大时总宽可达数千像素；
                  // 允许缩到 0.05 才能把整条主轴框进视口。
                  minZoom={0.05}
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
                    color="var(--color-border)"
                  />
                  <Controls showInteractive={false} position="bottom-right" />
                </ReactFlow>
              </div>
            )}
          </section>

          {selectedEvent && (
            <aside className="planning-timeline-detail" data-testid="timeline-event-detail">
              <div className="planning-pane__header">
                <span className="planning-pane__title">
                  <span className={`writer-timeline-status-dot is-${selectedEvent.status}`} aria-hidden="true" />
                  {text('事件详情', 'Event detail')}
                </span>
                <span className="planning-pane__actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setModalState({ open: true, mode: 'edit', initialEvent: selectedEvent })}
                    title={text('编辑事件', 'Edit event')}
                    aria-label={text('编辑事件', 'Edit event')}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => { void deleteEvent(selectedEvent.id) }}
                    title={text('删除事件', 'Delete event')}
                    aria-label={text('删除事件', 'Delete event')}
                  >
                    <Trash2 size={13} />
                  </Button>
                </span>
              </div>
              <div className="planning-timeline-detail__body">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {selectedEvent.title || text('未命名事件', 'Untitled event')}
                </h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-accent)' }}>
                  {selectedEvent.timeLabel || text('未填写时间', 'No time label')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="planning-tag">{statusLabel(selectedEvent.status)}</span>
                  <span className="planning-tag is-muted">
                    {(selectedEvent.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID
                      ? text('主轴', 'Main axis')
                      : branchNameById.get(selectedEvent.branchId!) ?? text('支线', 'Branch')}
                  </span>
                </div>
                {selectedEvent.description
                  ? (
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {selectedEvent.description}
                    </p>
                  )
                  : (
                    <p className="mt-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {text('这条事件还没有描述。双击画布标注或点上方铅笔补充。', 'This event has no description yet. Double-click its label on the canvas, or use the pencil above.')}
                    </p>
                  )}
                <dl className="mt-4 space-y-1.5 text-[11px]">
                  <div className="flex gap-2">
                    <dt style={{ color: 'var(--color-text-muted)' }}>{text('关联章节', 'Chapters')}</dt>
                    <dd style={{ color: 'var(--color-text)' }}>
                      {selectedEvent.chapterNumbers.length > 0
                        ? selectedEvent.chapterNumbers.map(number => text(`第${number}章`, `Ch.${number}`)).join('、')
                        : text('未关联', 'None')}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt style={{ color: 'var(--color-text-muted)' }}>{text('涉及角色', 'Characters')}</dt>
                    <dd style={{ color: 'var(--color-text)' }}>
                      {selectedEvent.characterNames.length > 0
                        ? selectedEvent.characterNames.join('、')
                        : text('未关联', 'None')}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt style={{ color: 'var(--color-text-muted)' }}>{text('涉及地点', 'Locations')}</dt>
                    <dd style={{ color: 'var(--color-text)' }}>
                      {selectedEvent.locationNodeIds.length > 0
                        ? selectedEvent.locationNodeIds
                            .map(id => worldMapNodes.find(node => node.id === id)?.name ?? id)
                            .join('、')
                        : text('未关联', 'None')}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCreateBranchFromEvent(selectedEvent.id)}
                  >
                    <GitBranch size={13} /> {text('创建支线', 'Create branch')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalState({ open: true, mode: 'create-next', sourceEvent: selectedEvent })}
                  >
                    <Plus size={13} /> {text('在此后添加事件', 'Add event after')}
                  </Button>
                </div>
              </div>
            </aside>
          )}
        </main>
      </PlanningPageShell>

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
              handleCreateBranchFromEvent(contextTargetEvent.id)
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
    </>
  )
}
