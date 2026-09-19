import { useCallback, useEffect, useMemo, useState } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  GitBranch,
  Plus,
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
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  buildStoryTimelineLayout,
  sortTimelineEvents,
  type StoryTimelineLabelSide,
} from './story-timeline-layout'
import { TimelineContextMenu } from './TimelineContextMenu'
import { TimelineEventModal } from './TimelineEventModal'

const TIMELINE_AXIS_NODE_ID = 'timeline-axis'

type TimelineNodeData = Record<string, unknown> & {
  handles: Array<{ id: string; offsetX: number }>
  eventId: string
  branchId: string
  title: string
  timeText: string
  side: StoryTimelineLabelSide
  staggerLevel: number
  width: number
  status: StoryTimelineEventStatus
  childBranchCount: number
  isExpanded: boolean
  onToggleExpand?: (eventId: string) => void
  onSelect?: (eventId: string) => void
  onDoubleClick?: (eventId: string) => void
}

type TimelineNode = Node<TimelineNodeData, 'timeline-axis' | 'timeline-event'>

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
      {data.handles.map(handle => (
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
      onClick={() => data.onSelect?.(data.eventId)}
      onDoubleClick={() => data.onDoubleClick?.(data.eventId)}
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

      {data.childBranchCount > 0 && (
        <button
          type="button"
          className="writer-timeline-branch-badge"
          data-testid="timeline-branch-badge"
          onClick={(event) => {
            event.stopPropagation()
            data.onToggleExpand?.(data.eventId)
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

const nodeTypes = {
  'timeline-axis': TimelineAxisNodeView,
  'timeline-event': TimelineEventNodeView,
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
}

interface ContextMenuState {
  x: number
  y: number
  targetEventId: string | null
}

export default function StoryTimelineView({
  projectKey,
  onNavigateMention,
}: {
  projectKey: string
  onNavigateMention?: (mention: StoryTimelineMention) => void
}) {
  const text = useLocaleStore(s => s.text)
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

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [title, setTitle] = useState(settings.title)
  const [rulerLabel, setRulerLabel] = useState(settings.rulerLabel)
  const [rulerUnit, setRulerUnit] = useState(settings.rulerUnit)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 浮层上下文菜单与编辑弹窗状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [modalState, setModalState] = useState<ModalState>({ open: false, mode: 'create-main' })

  useEffect(() => {
    void loadAll(projectKey)
    void loadWorldMap(projectKey)
  }, [projectKey, loadAll, loadWorldMap])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTitle(settings.title)
      setRulerLabel(settings.rulerLabel)
      setRulerUnit(settings.rulerUnit)
    })
    return () => cancelAnimationFrame(frame)
  }, [settings])

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
    return buildStoryTimelineLayout(events, branches, expandedBranchIds)
  }, [events, branches, expandedBranchIds])

  const flowNodes = useMemo<TimelineNode[]>(() => {
    if (layout.events.length === 0) return []
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
            offsetX: event.x - layout.axis.x,
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

    return [axis, ...eventNodes]
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

  const handleSaveSettings = async () => {
    const saved = await saveSettings({ title, rulerLabel, rulerUnit })
    if (saved) setSettingsOpen(false)
  }

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

  // 画布右键：弹出空白处菜单
  const handlePaneContextMenu = (e: MouseEvent | React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetEventId: null,
    })
  }

  // 节点右键：弹出节点上下文菜单
  const handleNodeContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    if (node.type !== 'timeline-event') return
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetEventId: (node.data as TimelineNodeData).eventId,
    })
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
                '记录小说重大事件与多重分支。主轴向右发展，支线可分叉折叠；右键画布或事件可快捷新增。',
                'Track major events and branches. Main axis moves left-to-right; right-click to add.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(v => !v)}>
              <Settings2 size={13} /> {text('刻度设置', 'Ruler settings')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSelectedId(null)
                setModalState({ open: true, mode: 'create-main' })
              }}
            >
              <Plus size={13} /> {text('新建主线事件', 'New main event')}
            </Button>
          </div>
        </header>

        {settingsOpen && (
          <section
            className="writer-timeline-settings"
            aria-label={text('时间线刻度设置', 'Timeline ruler settings')}
            data-testid="timeline-settings"
          >
            <div className="writer-timeline-settings-grid">
              <label>
                <span>{text('时间线名称', 'Timeline name')}</span>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
              </label>
              <label>
                <span>{text('刻度标题', 'Ruler title')}</span>
                <Input
                  value={rulerLabel}
                  placeholder={text('例如：大荒纪年', 'Era')}
                  onChange={e => setRulerLabel(e.target.value)}
                />
              </label>
              <label>
                <span>{text('刻度单位', 'Ruler unit')}</span>
                <Input
                  value={rulerUnit}
                  placeholder={text('例如：年、日、幕', 'year, day')}
                  onChange={e => setRulerUnit(e.target.value)}
                />
              </label>
            </div>
            <div className="writer-timeline-settings-actions">
              <Button size="sm" onClick={() => void handleSaveSettings()}>
                <Check size={13} />
                {text('保存刻度', 'Save ruler')}
              </Button>
            </div>
          </section>
        )}

        <div className="writer-timeline-workspace flex-1 flex flex-col min-h-0">
          <section
            className="writer-timeline-canvas flex-1 flex flex-col min-h-0"
            aria-label={text('故事时间轴', 'Story timeline')}
          >
            <div className="writer-timeline-ruler-heading">
              <span>{settings.rulerLabel}</span>
              <small>{settings.rulerUnit}</small>
              {orderedEvents.length > 0 && (
                <small className="writer-timeline-ruler-hint">
                  {text(
                    '拖动平移，滚轮缩放；右键节点分叉支线，点击徽标展开/折叠。',
                    'Drag to pan, scroll to zoom; right click for branch menu.',
                  )}
                </small>
              )}
            </div>

            {loading && !isDataReady ? (
              <div className="writer-timeline-empty">
                {text('正在读取项目时间线…', 'Loading project timeline…')}
              </div>
            ) : orderedEvents.length === 0 ? (
              <button
                type="button"
                className="writer-timeline-empty writer-timeline-empty-button"
                onClick={() => setModalState({ open: true, mode: 'create-main' })}
              >
                <CalendarClock size={26} />
                <strong>{text('从第一个故事事件开始', 'Start with the first story event')}</strong>
                <span>
                  {text(
                    '设置自定义时间与刻度；可在事件上右键分叉支线。',
                    'Set custom time and ruler position; right click to branch.',
                  )}
                </span>
              </button>
            ) : (
              <div className="writer-timeline-flow" data-testid="timeline-flow">
                <ReactFlow<TimelineNode, TimelineEdge>
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onPaneContextMenu={handlePaneContextMenu}
                  onNodeContextMenu={handleNodeContextMenu}
                  onNodeClick={(_event, node) => {
                    if (node.type !== 'timeline-event') return
                    setSelectedId(node.data.eventId)
                  }}
                  onNodeDoubleClick={(_event, node) => {
                    if (node.type !== 'timeline-event') return
                    const target = events.find(e => e.id === node.data.eventId)
                    if (target) {
                      setModalState({ open: true, mode: 'edit', initialEvent: target })
                    }
                  }}
                  fitView
                  minZoom={0.25}
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
          hasChildBranches={hasChildBranches}
          isBranchExpanded={isBranchExpanded}
          onClose={() => setContextMenu(null)}
          onCreateMainEvent={() => {
            setModalState({ open: true, mode: 'create-main' })
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
        onClose={() => setModalState({ open: false, mode: 'create-main' })}
        onSave={handleModalSave}
        onDelete={async (id) => {
          await deleteEvent(id)
        }}
        onNavigateMention={onNavigateMention}
      />
    </div>
  )
}
