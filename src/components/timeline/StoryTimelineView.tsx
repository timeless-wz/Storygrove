import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
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
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import type {
  StoryTimelineEvent,
  StoryTimelineEventStatus,
  StoryTimelinePrecision,
} from '../../shared/story-timeline'
import {
  STORY_TIMELINE_PRECISION_LABELS,
  STORY_TIMELINE_STATUS_LABELS,
} from '../../shared/story-timeline'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import {
  buildStoryTimelineLayout,
  sortTimelineEvents,
  type StoryTimelineLabelSide,
} from './story-timeline-layout'

interface TimelineFormState {
  id: string
  title: string
  timeLabel: string
  sortOrder: string
  precision: StoryTimelinePrecision
  rangeEndLabel: string
  description: string
  chapterNumbers: string
  characterNames: string
  locationNodeIds: string[]
  status: StoryTimelineEventStatus
}

const TIMELINE_AXIS_NODE_ID = 'timeline-axis'

type TimelineNodeData = Record<string, unknown> & {
  handles: Array<{ id: string; offsetX: number }>
  eventId: string
  title: string
  timeText: string
  side: StoryTimelineLabelSide
  staggerLevel: number
  width: number
}

type TimelineNode = Node<TimelineNodeData, 'timeline-axis' | 'timeline-event'>
type TimelineEdge = Edge<Record<string, unknown>, 'timeline-connector'>

function createEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseCommaList(value: string): string[] {
  return [...new Set(value.split(/[，,]/).map(item => item.trim()).filter(Boolean))]
}

function parseChapterNumbers(value: string): number[] {
  return parseCommaList(value)
    .map(item => Number(item.replace(/^第\s*|\s*章$/g, '')))
    .filter(item => Number.isInteger(item) && item > 0)
}

function makeEmptyForm(nextOrder: number): TimelineFormState {
  return {
    id: createEventId(),
    title: '',
    timeLabel: '',
    sortOrder: String(nextOrder),
    precision: 'exact',
    rangeEndLabel: '',
    description: '',
    chapterNumbers: '',
    characterNames: '',
    locationNodeIds: [],
    status: 'planned',
  }
}

function eventToForm(event: StoryTimelineEvent): TimelineFormState {
  return {
    id: event.id,
    title: event.title,
    timeLabel: event.timeLabel,
    sortOrder: String(event.sortOrder),
    precision: event.precision,
    rangeEndLabel: event.rangeEndLabel ?? '',
    description: event.description,
    chapterNumbers: event.chapterNumbers.join(', '),
    characterNames: event.characterNames.join(', '),
    locationNodeIds: event.locationNodeIds,
    status: event.status,
  }
}

/**
 * 主轴：一条连续横线，并为每个事件暴露一个引出点。事件标注只展示自定义时间与
 * 标题，状态/描述/章节/角色/地点一律留在右侧详情面板。
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
    >
      <Handle
        id="event-in"
        type="target"
        position={data.side === 'above' ? Position.Bottom : Position.Top}
        isConnectable={false}
        className="writer-timeline-label-handle"
      />
      <span className="writer-timeline-label-time">{data.timeText}</span>
      <strong className="writer-timeline-label-title">{data.title}</strong>
    </div>
  )
}

/** 主轴到事件标注的连接线：两端 x 相同，因此是一条竖直引出线。 */
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

const nodeTypes = { 'timeline-axis': TimelineAxisNodeView, 'timeline-event': TimelineEventNodeView }
const edgeTypes = { 'timeline-connector': TimelineConnectorEdgeView }

export default function StoryTimelineView({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(s => s.text)
  const settings = useStoryTimelineStore(s => s.settings)
  const events = useStoryTimelineStore(s => s.events)
  const loading = useStoryTimelineStore(s => s.loading)
  const dataProjectKey = useStoryTimelineStore(s => s.dataProjectKey)
  const loadAll = useStoryTimelineStore(s => s.loadAll)
  const saveSettings = useStoryTimelineStore(s => s.saveSettings)
  const upsertEvent = useStoryTimelineStore(s => s.upsertEvent)
  const deleteEvent = useStoryTimelineStore(s => s.deleteEvent)
  const reorderEvents = useStoryTimelineStore(s => s.reorderEvents)
  const nodes = useWorldMapStore(s => s.nodes)
  const loadWorldMap = useWorldMapStore(s => s.loadAll)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [title, setTitle] = useState(settings.title)
  const [rulerLabel, setRulerLabel] = useState(settings.rulerLabel)
  const [rulerUnit, setRulerUnit] = useState(settings.rulerUnit)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<TimelineFormState>(() => makeEmptyForm(1))

  useEffect(() => {
    void loadAll(projectKey)
    void loadWorldMap(projectKey)
  }, [projectKey, loadAll, loadWorldMap])

  useEffect(() => {
    // 设置由异步加载更新时，在下一帧同步本地表单草稿，避免 effect 内级联渲染。
    const frame = requestAnimationFrame(() => {
      setTitle(settings.title)
      setRulerLabel(settings.rulerLabel)
      setRulerUnit(settings.rulerUnit)
    })
    return () => cancelAnimationFrame(frame)
  }, [settings])

  const orderedEvents = useMemo(() => sortTimelineEvents(events), [events])
  const nextOrder = orderedEvents.length > 0
    ? Math.max(...orderedEvents.map(event => event.sortOrder)) + 1
    : 1
  const selectedEvent = selectedId ? orderedEvents.find(event => event.id === selectedId) : undefined

  // 坐标每一次都由 sortOrder 现算：没有任何拖拽结果被写回事件或持久化。
  const layout = useMemo(() => buildStoryTimelineLayout(orderedEvents), [orderedEvents])
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
        handles: layout.events.map((event, index) => ({
          id: `axis-out-${index}`,
          offsetX: event.x - layout.axis.x,
        })),
        eventId: '',
        title: '',
        timeText: '',
        side: 'above',
        staggerLevel: 0,
        width: layout.axis.width,
      },
    }
    return [
      axis,
      ...layout.events.map<TimelineNode>((event, index) => ({
        id: event.id,
        type: 'timeline-event',
        position: { x: event.x, y: event.y },
        draggable: false,
        selected: event.id === selectedId,
        data: {
          handles: [{ id: `axis-out-${index}`, offsetX: 0 }],
          eventId: event.id,
          title: event.title,
          timeText: event.timeText,
          side: event.side,
          staggerLevel: event.staggerLevel,
          width: event.width,
        },
      })),
    ]
  }, [layout, selectedId])

  const flowEdges = useMemo<TimelineEdge[]>(() => layout.events.map((event, index) => ({
    id: `connector-${event.id}`,
    type: 'timeline-connector',
    source: TIMELINE_AXIS_NODE_ID,
    sourceHandle: `axis-out-${index}`,
    target: event.id,
    targetHandle: 'event-in',
    selectable: false,
    focusable: false,
    data: {},
  })), [layout])

  const selectEvent = (event: StoryTimelineEvent) => {
    setSelectedId(event.id)
    setForm(eventToForm(event))
  }

  const startNewEvent = () => {
    setSelectedId(null)
    setForm(makeEmptyForm(nextOrder))
  }

  const handleSaveSettings = async () => {
    const saved = await saveSettings({ title, rulerLabel, rulerUnit })
    if (saved) setSettingsOpen(false)
  }

  const handleSaveEvent = async () => {
    const event: StoryTimelineEvent = {
      id: form.id,
      title: form.title,
      timeLabel: form.timeLabel,
      sortOrder: Number(form.sortOrder),
      precision: form.precision,
      rangeEndLabel: form.rangeEndLabel,
      description: form.description,
      chapterNumbers: parseChapterNumbers(form.chapterNumbers),
      characterNames: parseCommaList(form.characterNames),
      locationNodeIds: form.locationNodeIds,
      status: form.status,
      createdAt: selectedEvent?.createdAt,
    }
    const saved = await upsertEvent(event)
    if (saved) {
      setSelectedId(event.id)
      setForm(eventToForm({ ...event, createdAt: selectedEvent?.createdAt }))
    }
  }

  const handleDelete = async () => {
    if (!selectedEvent) return
    const deleted = await deleteEvent(selectedEvent.id)
    if (deleted) startNewEvent()
  }

  const moveEvent = useCallback(async (id: string, offset: -1 | 1) => {
    const index = orderedEvents.findIndex(event => event.id === id)
    const targetIndex = index + offset
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedEvents.length) return
    const ids = orderedEvents.map(event => event.id)
    ;[ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]]
    await reorderEvents(ids)
  }, [orderedEvents, reorderEvents])

  const selectedIndex = selectedEvent
    ? orderedEvents.findIndex(event => event.id === selectedEvent.id)
    : -1

  const updateForm = <K extends keyof TimelineFormState>(key: K, value: TimelineFormState[K]) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  const isDataReady = dataProjectKey === projectKey

  return (
    <div className="writer-timeline h-full overflow-y-auto" style={{ backgroundColor: 'var(--color-editor-bg)', color: 'var(--color-text)' }}>
      <div className="writer-timeline-shell">
        <header className="writer-timeline-header">
          <div>
            <div className="writer-timeline-eyebrow"><Clock3 size={14} /> {text('创作规划 / 手动维护', 'Writing plan / Manual')}</div>
            <h1>{settings.title}</h1>
            <p>{text('按故事内发生顺序记录事件；章节顺序与时间顺序可以不同。', 'Record events in story order; chapter order and time order may differ.')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(value => !value)}>
              <Settings2 size={13} /> {text('刻度设置', 'Ruler settings')}
            </Button>
            <Button size="sm" onClick={startNewEvent}>
              <Plus size={13} /> {text('添加事件', 'Add event')}
            </Button>
          </div>
        </header>

        {settingsOpen && (
          <section className="writer-timeline-settings" aria-label={text('时间线刻度设置', 'Timeline ruler settings')}>
            <div className="writer-timeline-settings-grid">
              <label><span>{text('时间线名称', 'Timeline name')}</span><Input value={title} onChange={event => setTitle(event.target.value)} /></label>
              <label><span>{text('刻度标题', 'Ruler title')}</span><Input value={rulerLabel} placeholder={text('例如：大荒纪年', 'Example: Era')} onChange={event => setRulerLabel(event.target.value)} /></label>
              <label><span>{text('刻度单位', 'Ruler unit')}</span><Input value={rulerUnit} placeholder={text('例如：年、日、幕', 'Example: year, day, act')} onChange={event => setRulerUnit(event.target.value)} /></label>
            </div>
            <div className="writer-timeline-settings-actions"><Button size="sm" onClick={() => void handleSaveSettings()}><Check size={13} />{text('保存刻度', 'Save ruler')}</Button></div>
          </section>
        )}

        <div className="writer-timeline-workspace">
          <section className="writer-timeline-canvas" aria-label={text('故事时间轴', 'Story timeline')}>
            <div className="writer-timeline-ruler-heading">
              <span>{settings.rulerLabel}</span>
              <small>{settings.rulerUnit}</small>
              {orderedEvents.length > 0 && (
                <small className="writer-timeline-ruler-hint">
                  {text('拖动平移，滚轮缩放；顺序由排序刻度决定。', 'Drag to pan, scroll to zoom; order follows the ruler position.')}
                </small>
              )}
            </div>
            {loading && !isDataReady ? (
              <div className="writer-timeline-empty">{text('正在读取项目时间线…', 'Loading project timeline…')}</div>
            ) : orderedEvents.length === 0 ? (
              <button type="button" className="writer-timeline-empty writer-timeline-empty-button" onClick={startNewEvent}>
                <CalendarClock size={26} />
                <strong>{text('从第一个故事事件开始', 'Start with the first story event')}</strong>
                <span>{text('设置自定义时间与刻度；以后可随时调整顺序。', 'Set a custom time and ruler position; you can reorder later.')}</span>
              </button>
            ) : (
              <div className="writer-timeline-flow" data-testid="timeline-flow">
                <ReactFlow<TimelineNode, TimelineEdge>
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodeClick={(_event, node) => {
                    if (node.type !== 'timeline-event') return
                    const target = orderedEvents.find(event => event.id === node.data.eventId)
                    if (target) selectEvent(target)
                  }}
                  fitView
                  minZoom={0.3}
                  maxZoom={1.8}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  proOptions={{ hideAttribution: true }}
                  className="bg-[var(--color-editor-bg)]"
                >
                  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border)" />
                  <Controls showInteractive={false} position="bottom-right" />
                </ReactFlow>
              </div>
            )}
          </section>

          <aside className="writer-timeline-editor" aria-label={selectedEvent ? text('编辑时间线事件', 'Edit timeline event') : text('新增时间线事件', 'New timeline event')}>
            <div className="writer-timeline-editor-title">
              <div><span>{selectedEvent ? text('事件详情', 'Event details') : text('新事件', 'New event')}</span><strong>{selectedEvent ? selectedEvent.title : text('手动添加故事事件', 'Add a story event manually')}</strong></div>
              <div className="writer-timeline-editor-title-actions">
                {selectedEvent && (
                  <div className="writer-timeline-reorder" aria-label={text('调整事件顺序', 'Reorder event')}>
                    <button type="button" disabled={selectedIndex <= 0} onClick={() => void moveEvent(selectedEvent.id, -1)} aria-label={text('向前移动', 'Move earlier')} title={text('向前移动', 'Move earlier')}><ChevronLeft size={14} /></button>
                    <button type="button" disabled={selectedIndex >= orderedEvents.length - 1} onClick={() => void moveEvent(selectedEvent.id, 1)} aria-label={text('向后移动', 'Move later')} title={text('向后移动', 'Move later')}><ChevronRight size={14} /></button>
                  </div>
                )}
                {selectedEvent && <Button variant="ghost" size="icon" title={text('删除事件', 'Delete event')} onClick={() => void handleDelete()}><Trash2 size={14} /></Button>}
              </div>
            </div>
            <div className="writer-timeline-form">
              <label><span>{text('事件标题', 'Event title')} *</span><Input value={form.title} placeholder={text('例如：许渡抵达雾港', 'Example: Arrival at the port')} onChange={event => updateForm('title', event.target.value)} /></label>
              <div className="writer-timeline-form-grid">
                <label><span>{text('自定义时间', 'Custom time')} *</span><Input value={form.timeLabel} placeholder={text('例如：大荒历 317 年冬', 'Example: Winter, 317')} onChange={event => updateForm('timeLabel', event.target.value)} /></label>
                <label><span>{text('排序刻度', 'Ruler position')} *</span><Input type="number" min="1" step="0.1" value={form.sortOrder} onChange={event => updateForm('sortOrder', event.target.value)} /></label>
              </div>
              <div className="writer-timeline-form-grid">
                <label><span>{text('时间精度', 'Time precision')}</span><select value={form.precision} onChange={event => updateForm('precision', event.target.value as StoryTimelinePrecision)}>{Object.entries(STORY_TIMELINE_PRECISION_LABELS).map(([value, label]) => <option key={value} value={value}>{text(label.zh, label.en)}</option>)}</select></label>
                <label><span>{text('状态', 'Status')}</span><select value={form.status} onChange={event => updateForm('status', event.target.value as StoryTimelineEventStatus)}>{Object.entries(STORY_TIMELINE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{text(label.zh, label.en)}</option>)}</select></label>
              </div>
              {form.precision === 'range' && <label><span>{text('结束时间', 'End time')}</span><Input value={form.rangeEndLabel} placeholder={text('范围结束的自定义时间', 'Custom end time')} onChange={event => updateForm('rangeEndLabel', event.target.value)} /></label>}
              <label><span>{text('事件描述', 'Description')}</span><Textarea value={form.description} placeholder={text('写下这件事造成的变化、前因或后果。', 'Describe the change, cause, or consequence.')} onChange={event => updateForm('description', event.target.value)} /></label>
              <label><span>{text('关联章节', 'Linked chapters')}</span><Input value={form.chapterNumbers} placeholder={text('例如：3, 4（可留空）', 'Example: 3, 4 (optional)')} onChange={event => updateForm('chapterNumbers', event.target.value)} /></label>
              <label><span>{text('涉及角色', 'Characters')}</span><Input value={form.characterNames} placeholder={text('用逗号分隔角色名（可留空）', 'Comma-separated names (optional)')} onChange={event => updateForm('characterNames', event.target.value)} /></label>
              <label><span>{text('关联地点', 'Linked locations')}</span><select multiple value={form.locationNodeIds} onChange={event => updateForm('locationNodeIds', Array.from(event.currentTarget.selectedOptions, option => option.value))} className="writer-timeline-location-select">{nodes.length === 0 ? <option disabled>{text('先在地图册中创建地点', 'Create map locations first')}</option> : nodes.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select><small>{text('按 Ctrl/⌘ 可多选；地图为空时也可先保存事件。', 'Use Ctrl/⌘ for multiple; you may save before creating map locations.')}</small></label>
              <div className="writer-timeline-form-actions"><Button variant="outline" size="sm" onClick={startNewEvent}>{text('新建空白事件', 'New blank event')}</Button><Button size="sm" disabled={!form.title.trim() || !form.timeLabel.trim() || !Number.isFinite(Number(form.sortOrder))} onClick={() => void handleSaveEvent()}><Check size={13} />{text('保存事件', 'Save event')}</Button></div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
