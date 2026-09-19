import { useEffect, useState } from 'react'
import {
  Check,
  GitBranch,
  Link2,
  Trash2,
  User,
  X,
} from 'lucide-react'
import type {
  StoryTimelineEvent,
  StoryTimelineEventStatus,
  StoryTimelineMention,
  StoryTimelinePrecision,
} from '../../shared/story-timeline'
import {
  parseStoryTimelineMentions,
  STORY_TIMELINE_MAIN_BRANCH_ID,
  STORY_TIMELINE_PRECISION_LABELS,
  STORY_TIMELINE_STATUS_LABELS,
} from '../../shared/story-timeline'
import { useLocaleStore } from '../../stores/locale-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { toast } from '../ui/Toast'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'

export interface TimelineEventModalProps {
  open: boolean
  mode: 'create-main' | 'create-next' | 'create-branch' | 'edit'
  initialEvent?: StoryTimelineEvent | null
  sourceEvent?: StoryTimelineEvent | null
  currentBranchName?: string
  nextSortOrder?: number
  initialSortOrder?: number
  storyRange?: { startOrder: number; endOrder: number }
  onClose: () => void
  onSave: (data: {
    event: StoryTimelineEvent
    newBranchName?: string
  }) => Promise<void>
  onDelete?: (eventId: string) => Promise<void>
  onNavigateMention?: (mention: StoryTimelineMention) => void
}

function parseCommaList(value: string): string[] {
  return [...new Set(value.split(/[，,]/).map(item => item.trim()).filter(Boolean))]
}

function parseChapterNumbers(value: string): number[] {
  return parseCommaList(value)
    .map(item => Number(item.replace(/^第\s*|\s*章$/g, '')))
    .filter(item => Number.isInteger(item) && item > 0)
}

function createEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function TimelineEventModal({
  open,
  mode,
  initialEvent,
  sourceEvent,
  currentBranchName,
  nextSortOrder = 1,
  initialSortOrder,
  storyRange,
  onClose,
  onSave,
  onDelete,
  onNavigateMention,
}: TimelineEventModalProps) {
  const text = useLocaleStore(s => s.text)
  const nodes = useWorldMapStore(s => s.nodes)

  const [id, setId] = useState('')
  const [branchId, setBranchId] = useState(STORY_TIMELINE_MAIN_BRANCH_ID)
  const [newBranchName, setNewBranchName] = useState('')
  const [title, setTitle] = useState('')
  const [timeLabel, setTimeLabel] = useState('')
  const [sortOrder, setSortOrder] = useState('1')
  const [precision, setPrecision] = useState<StoryTimelinePrecision>('exact')
  const [rangeEndLabel, setRangeEndLabel] = useState('')
  const [description, setDescription] = useState('')
  const [chapterNumbers, setChapterNumbers] = useState('')
  const [characterNames, setCharacterNames] = useState('')
  const [locationNodeIds, setLocationNodeIds] = useState<string[]>([])
  const [status, setStatus] = useState<StoryTimelineEventStatus>('planned')
  const [saving, setSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  // 当弹窗打开时初始化表单状态
  useEffect(() => {
    if (!open) return
    setOrderError(null)

    if (mode === 'edit' && initialEvent) {
      setId(initialEvent.id)
      setBranchId(initialEvent.branchId || STORY_TIMELINE_MAIN_BRANCH_ID)
      setNewBranchName('')
      setTitle(initialEvent.title)
      setTimeLabel(initialEvent.timeLabel)
      setSortOrder(String(initialEvent.sortOrder))
      setPrecision(initialEvent.precision)
      setRangeEndLabel(initialEvent.rangeEndLabel ?? '')
      setDescription(initialEvent.description)
      setChapterNumbers(initialEvent.chapterNumbers.join(', '))
      setCharacterNames(initialEvent.characterNames.join(', '))
      setLocationNodeIds(initialEvent.locationNodeIds)
      setStatus(initialEvent.status)
    } else if (mode === 'create-branch' && sourceEvent) {
      setId(createEventId())
      setBranchId(`branch-${Date.now()}`)
      setNewBranchName(`${sourceEvent.title} · 支线`)
      setTitle('')
      setTimeLabel(sourceEvent.timeLabel)
      setSortOrder(String(Number(sourceEvent.sortOrder) + 1))
      setPrecision('exact')
      setRangeEndLabel('')
      setDescription('')
      setChapterNumbers('')
      setCharacterNames('')
      setLocationNodeIds([])
      setStatus('planned')
    } else if (mode === 'create-next' && sourceEvent) {
      setId(createEventId())
      setBranchId(sourceEvent.branchId || STORY_TIMELINE_MAIN_BRANCH_ID)
      setNewBranchName('')
      setTitle('')
      setTimeLabel(sourceEvent.timeLabel)
      setSortOrder(String(Number(sourceEvent.sortOrder) + 1))
      setPrecision('exact')
      setRangeEndLabel('')
      setDescription('')
      setChapterNumbers('')
      setCharacterNames('')
      setLocationNodeIds([])
      setStatus('planned')
    } else {
      // create-main
      setId(createEventId())
      setBranchId(STORY_TIMELINE_MAIN_BRANCH_ID)
      setNewBranchName('')
      setTitle('')
      setTimeLabel('')
      const defaultOrder = initialSortOrder !== undefined
        ? initialSortOrder
        : nextSortOrder
      setSortOrder(String(defaultOrder))
      setPrecision('exact')
      setRangeEndLabel('')
      setDescription('')
      setChapterNumbers('')
      setCharacterNames('')
      setLocationNodeIds([])
      setStatus('planned')
    }
  }, [open, mode, initialEvent, sourceEvent, nextSortOrder, initialSortOrder])

  // 监听 Esc 键关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const mentions = parseStoryTimelineMentions(description)

  const handleMentionClick = (mention: StoryTimelineMention) => {
    if (onNavigateMention) {
      onNavigateMention(mention)
    } else {
      toast.info(text(`已定位角色引用：${mention.name}（导航意图）`, `Character mention target: ${mention.name}`))
    }
  }

  const handleSubmit = async () => {
    const orderNum = Number(sortOrder)
    if (!title.trim() || !timeLabel.trim() || !Number.isFinite(orderNum)) {
      toast.error(text('请填写完整的事件标题、时间与排序刻度', 'Please fill in title, custom time and ruler position'))
      return
    }

    if (storyRange) {
      if (orderNum < storyRange.startOrder || orderNum > storyRange.endOrder) {
        const msg = text('请先编辑故事开端或故事结束', 'Please edit Story Start or Story End first')
        setOrderError(msg)
        toast.error(msg)
        return
      }
    }

    setSaving(true)
    try {
      const event: StoryTimelineEvent = {
        id,
        branchId: mode === 'create-branch' ? branchId : (initialEvent?.branchId || branchId),
        parentEventId: mode === 'create-branch' ? (sourceEvent?.id ?? null) : (initialEvent?.parentEventId ?? null),
        title: title.trim(),
        timeLabel: timeLabel.trim(),
        sortOrder: orderNum,
        precision,
        rangeEndLabel: precision === 'range' ? rangeEndLabel.trim() : undefined,
        description: description.trim(),
        chapterNumbers: parseChapterNumbers(chapterNumbers),
        characterNames: parseCommaList(characterNames),
        locationNodeIds,
        status,
        createdAt: initialEvent?.createdAt,
      }

      await onSave({
        event,
        newBranchName: mode === 'create-branch' ? (newBranchName.trim() || '支线') : undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const getModalTitle = () => {
    switch (mode) {
      case 'create-branch':
        return text('创建新支线事件', 'Create branch event')
      case 'create-next':
        return text('添加后续事件', 'Add next event')
      case 'edit':
        return text('编辑事件', 'Edit event')
      default:
        return text('新建主线事件', 'New main timeline event')
    }
  }

  return (
    <div
      className="writer-timeline-modal-backdrop"
      data-testid="timeline-event-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="writer-timeline-modal"
        role="dialog"
        aria-modal="true"
        aria-label={getModalTitle()}
        data-testid="timeline-event-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="writer-timeline-modal-header">
          <div>
            <div className="writer-timeline-modal-subtitle flex items-center gap-1.5">
              {mode === 'create-branch' ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <GitBranch size={13} />
                  {text('分叉自事件：', 'Branched from: ')} {sourceEvent?.title}
                </span>
              ) : currentBranchName ? (
                <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 font-medium">
                  <GitBranch size={13} />
                  {currentBranchName}
                </span>
              ) : (
                <span>{text('故事时间线 · 重大事件', 'Story Timeline · Major event')}</span>
              )}
            </div>
            <h2>{getModalTitle()}</h2>
          </div>
          <button
            type="button"
            className="writer-timeline-modal-close"
            onClick={onClose}
            aria-label={text('关闭', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="writer-timeline-modal-body">
          {mode === 'create-branch' && (
            <label className="writer-timeline-field">
              <span>{text('支线名称', 'Branch name')} *</span>
              <Input
                value={newBranchName}
                placeholder={text('例如：西征秘辛、雾港暗线', 'e.g. Western Expedition')}
                onChange={e => setNewBranchName(e.target.value)}
                autoFocus
              />
            </label>
          )}

          <label className="writer-timeline-field">
            <span>{text('事件标题', 'Event title')} *</span>
            <Input
              value={title}
              placeholder={text('例如：许渡抵达雾港', 'e.g. Arrival at the port')}
              onChange={e => setTitle(e.target.value)}
              autoFocus={mode !== 'create-branch'}
            />
          </label>

          <div className="writer-timeline-field-grid">
            <label className="writer-timeline-field">
              <span>{text('自定义时间', 'Custom time')} *</span>
              <Input
                value={timeLabel}
                placeholder={text('例如：大荒历 317 年冬', 'e.g. Winter, 317')}
                onChange={e => setTimeLabel(e.target.value)}
              />
            </label>
            <label className="writer-timeline-field">
              <span>{text('排序刻度', 'Ruler position')} *</span>
              <Input
                type="number"
                step="0.1"
                value={sortOrder}
                onChange={e => {
                  setSortOrder(e.target.value)
                  setOrderError(null)
                }}
              />
              {orderError && (
                <div className="writer-timeline-field-error text-xs text-rose-500 mt-1" role="alert">
                  {orderError}
                </div>
              )}
            </label>
          </div>

          <div className="writer-timeline-field-grid">
            <label className="writer-timeline-field">
              <span>{text('时间精度', 'Time precision')}</span>
              <select
                value={precision}
                onChange={e => setPrecision(e.target.value as StoryTimelinePrecision)}
                className="writer-timeline-select"
              >
                {Object.entries(STORY_TIMELINE_PRECISION_LABELS).map(([val, lbl]) => (
                  <option key={val} value={val}>{text(lbl.zh, lbl.en)}</option>
                ))}
              </select>
            </label>
            <label className="writer-timeline-field">
              <span>{text('状态', 'Status')}</span>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as StoryTimelineEventStatus)}
                className="writer-timeline-select"
              >
                {Object.entries(STORY_TIMELINE_STATUS_LABELS).map(([val, lbl]) => (
                  <option key={val} value={val}>{text(lbl.zh, lbl.en)}</option>
                ))}
              </select>
            </label>
          </div>

          {precision === 'range' && (
            <label className="writer-timeline-field">
              <span>{text('结束时间', 'End time')}</span>
              <Input
                value={rangeEndLabel}
                placeholder={text('范围结束的自定义时间', 'Custom end time')}
                onChange={e => setRangeEndLabel(e.target.value)}
              />
            </label>
          )}

          <label className="writer-timeline-field">
            <div className="flex items-center justify-between">
              <span>{text('事件描述', 'Description')}</span>
              <small className="text-xs text-[var(--color-text-muted)]">
                {text('支持 @人物 或 [[人物]] 语法', 'Supports @character or [[character]]')}
              </small>
            </div>
            <Textarea
              rows={3}
              value={description}
              placeholder={text('写下事件详情，例如：@许渡 潜入暗河，寻找 [[沈砚]] 的线索。', 'Describe the event...')}
              onChange={e => setDescription(e.target.value)}
            />
          </label>

          {/* 提及展示 Chip 栏 */}
          {mentions.length > 0 && (
            <div className="writer-timeline-mentions-bar" data-testid="timeline-mentions-bar">
              <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                <User size={12} /> {text('检测到实体提及：', 'Mentions:')}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {mentions.map((m, idx) => (
                  <button
                    key={`${m.raw}-${idx}`}
                    type="button"
                    className="writer-timeline-mention-tag"
                    data-testid="timeline-mention-tag"
                    data-mention-name={m.name}
                    onClick={() => handleMentionClick(m)}
                    title={text(`点击触发导航意图：${m.name}`, `Click to navigate: ${m.name}`)}
                  >
                    <Link2 size={10} />
                    <span>{m.raw}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="writer-timeline-field-grid">
            <label className="writer-timeline-field">
              <span>{text('关联章节', 'Linked chapters')}</span>
              <Input
                value={chapterNumbers}
                placeholder={text('例如：3, 4', 'e.g. 3, 4')}
                onChange={e => setChapterNumbers(e.target.value)}
              />
            </label>
            <label className="writer-timeline-field">
              <span>{text('涉及角色', 'Characters')}</span>
              <Input
                value={characterNames}
                placeholder={text('逗号分隔角色名', 'Comma-separated names')}
                onChange={e => setCharacterNames(e.target.value)}
              />
            </label>
          </div>

          <label className="writer-timeline-field">
            <span>{text('关联地点', 'Linked locations')}</span>
            <select
              multiple
              value={locationNodeIds}
              onChange={e => setLocationNodeIds(Array.from(e.currentTarget.selectedOptions, opt => opt.value))}
              className="writer-timeline-location-select"
            >
              {nodes.length === 0 ? (
                <option disabled>{text('地图册中尚无地点', 'No map locations yet')}</option>
              ) : (
                nodes.map(node => (
                  <option key={node.id} value={node.id}>{node.name}</option>
                ))
              )}
            </select>
            <small className="text-xs text-[var(--color-text-muted)]">
              {text('按 Ctrl/⌘ 可多选', 'Ctrl/⌘ to select multiple')}
            </small>
          </label>
        </div>

        {/* Footer */}
        <div className="writer-timeline-modal-footer">
          {mode === 'edit' && onDelete && initialEvent && (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 dark:text-red-400 mr-auto"
              onClick={async () => {
                await onDelete(initialEvent.id)
                onClose()
              }}
            >
              <Trash2 size={13} />
              <span>{text('删除', 'Delete')}</span>
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {text('取消', 'Cancel')}
          </Button>

          <Button
            size="sm"
            disabled={saving || !title.trim() || !timeLabel.trim() || !Number.isFinite(Number(sortOrder))}
            onClick={() => void handleSubmit()}
          >
            <Check size={13} />
            <span>{saving ? text('保存中…', 'Saving…') : text('保存事件', 'Save event')}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
