/**
 * TimelineEventForm — 时间线事件表单的唯一实现（任务 B）。
 *
 * 创建弹窗（TimelineEventModal）与事件浮窗的编辑态共用同一组字段、
 * 同一套初值与同一套校验，保证两条入口不会长成两种数据。
 * 组件本身完全受控：值由父级持有，校验结果由父级提交时取得。
 *
 * 数据边界：
 * - 更新载荷基于 initialEvent 合并：表单未展示的兼容字段
 *   （isHistorical、outcome、aftermath）原样带回，绝不因保存被清空；
 * - 章节与人物关联交给 TimelineAssociationPicker，旧的手写值与
 *   无效旧关联在值数组里原样保留；
 * - 校验错误以中文为基准值流转，展示前按当前语言本地化。
 */

/* eslint-disable react-refresh/only-export-components -- 初值/校验助手必须与表单字段同源，拆文件反而容易漂移 */

import { useMemo } from 'react'
import { Link2, User } from 'lucide-react'
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
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { TimelineChapterPicker, TimelineCharacterPicker } from './TimelineAssociationPicker'

export type TimelineEventFormMode = 'create-main' | 'create-next' | 'create-branch' | 'edit'

export interface TimelineEventFormValues {
  id: string
  branchId: string
  newBranchName: string
  title: string
  timeLabel: string
  sortOrder: string
  precision: StoryTimelinePrecision
  rangeEndLabel: string
  description: string
  chapterNumbers: number[]
  characterNames: string[]
  locationNodeIds: string[]
  status: StoryTimelineEventStatus
}

export interface TimelineEventFormStoryRange {
  startOrder: number
  endOrder: number
}

export function createTimelineEventId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 按表单模式构造初值；分支首事件会预填源事件的时间与下一刻度。 */
export function createTimelineEventFormValues(
  mode: TimelineEventFormMode,
  options: {
    initialEvent?: StoryTimelineEvent | null
    sourceEvent?: StoryTimelineEvent | null
    nextSortOrder?: number
    initialSortOrder?: number
  } = {},
): TimelineEventFormValues {
  const { initialEvent, sourceEvent, nextSortOrder = 1, initialSortOrder } = options

  if (mode === 'edit' && initialEvent) {
    return {
      id: initialEvent.id,
      branchId: initialEvent.branchId || STORY_TIMELINE_MAIN_BRANCH_ID,
      newBranchName: '',
      title: initialEvent.title,
      timeLabel: initialEvent.timeLabel,
      sortOrder: String(initialEvent.sortOrder),
      precision: initialEvent.precision,
      rangeEndLabel: initialEvent.rangeEndLabel ?? '',
      description: initialEvent.description,
      // 旧值原样保留（含候选之外的章号/手写名），由选择器标注“未找到”。
      chapterNumbers: [...initialEvent.chapterNumbers],
      characterNames: [...initialEvent.characterNames],
      locationNodeIds: [...initialEvent.locationNodeIds],
      status: initialEvent.status,
    }
  }

  if (mode === 'create-branch' && sourceEvent) {
    return {
      id: createTimelineEventId(),
      branchId: `branch-${Date.now()}`,
      // 支线名称必填：不预填、不静默兜底，提交前由共享校验拦截。
      newBranchName: '',
      title: '',
      timeLabel: sourceEvent.timeLabel,
      sortOrder: String(Number(sourceEvent.sortOrder) + 1),
      precision: 'exact',
      rangeEndLabel: '',
      description: '',
      chapterNumbers: [],
      characterNames: [],
      locationNodeIds: [],
      status: 'planned',
    }
  }

  if (mode === 'create-next' && sourceEvent) {
    return {
      id: createTimelineEventId(),
      branchId: sourceEvent.branchId || STORY_TIMELINE_MAIN_BRANCH_ID,
      newBranchName: '',
      title: '',
      timeLabel: sourceEvent.timeLabel,
      sortOrder: String(Number(sourceEvent.sortOrder) + 1),
      precision: 'exact',
      rangeEndLabel: '',
      description: '',
      chapterNumbers: [],
      characterNames: [],
      locationNodeIds: [],
      status: 'planned',
    }
  }

  // create-main
  return {
    id: createTimelineEventId(),
    branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
    newBranchName: '',
    title: '',
    timeLabel: '',
    sortOrder: String(initialSortOrder !== undefined ? initialSortOrder : nextSortOrder),
    precision: 'exact',
    rangeEndLabel: '',
    description: '',
    chapterNumbers: [],
    characterNames: [],
    locationNodeIds: [],
    status: 'planned',
  }
}

/** 提交校验与事件构建；rangeEndLabel 只在 range 精度下保留。 */
export function buildTimelineEventSubmission(
  values: TimelineEventFormValues,
  mode: TimelineEventFormMode,
  options: {
    initialEvent?: StoryTimelineEvent | null
    sourceEvent?: StoryTimelineEvent | null
    storyRange?: TimelineEventFormStoryRange | null
  } = {},
): { ok: true; event: StoryTimelineEvent } | { ok: false; error: string } {
  const { initialEvent, sourceEvent, storyRange } = options
  const orderNum = Number(values.sortOrder)

  if (mode === 'create-branch' && !values.newBranchName.trim()) {
    return { ok: false, error: '请填写支线名称' }
  }
  if (!values.title.trim() || !values.timeLabel.trim() || !Number.isFinite(orderNum)) {
    return { ok: false, error: '请填写完整的事件标题、时间与排序刻度' }
  }
  if (storyRange && (orderNum < storyRange.startOrder || orderNum > storyRange.endOrder)) {
    return { ok: false, error: '排列位置超出故事范围，请调整数值，或先在「设置故事范围」中修改' }
  }

  return {
    ok: true,
    event: {
      id: values.id,
      branchId: mode === 'create-branch'
        ? values.branchId
        : (initialEvent?.branchId || values.branchId),
      parentEventId: mode === 'create-branch'
        ? (sourceEvent?.id ?? null)
        : (initialEvent?.parentEventId ?? null),
      title: values.title.trim(),
      timeLabel: values.timeLabel.trim(),
      sortOrder: orderNum,
      precision: values.precision,
      rangeEndLabel: values.precision === 'range' ? values.rangeEndLabel.trim() : undefined,
      description: values.description.trim(),
      // 旧关联原样保留（含候选之外的值），只做去重；删除必须由作者显式操作。
      chapterNumbers: [...new Set(values.chapterNumbers)],
      characterNames: [...new Set(values.characterNames.map(name => name.trim()).filter(Boolean))],
      locationNodeIds: [...values.locationNodeIds],
      status: values.status,
      // 表单未展示的兼容字段基于原记录合并回填，保存绝不覆盖为空值。
      ...(initialEvent
        ? {
            isHistorical: initialEvent.isHistorical,
            outcome: initialEvent.outcome,
            aftermath: initialEvent.aftermath,
          }
        : {}),
      createdAt: initialEvent?.createdAt,
    },
  }
}

type LocaleText = (zh: string, en: string) => string

const TIMELINE_FORM_ERROR_EN: Array<{ match: string; en: string }> = [
  { match: '排列位置超出故事范围', en: 'Ruler position is outside the story range; adjust it or edit the story range first' },
  { match: '请填写支线名称', en: 'Please name the new branch' },
  { match: '请填写完整的事件标题', en: 'Please fill in title, custom time and ruler position' },
]

/** 校验错误以中文为基准值流转，展示前按当前语言本地化。 */
export function localizeTimelineFormError(error: string, text: LocaleText): string {
  const entry = TIMELINE_FORM_ERROR_EN.find(item => error.includes(item.match))
  return entry ? text(error, entry.en) : error
}

export interface TimelineEventFormProps {
  mode: TimelineEventFormMode
  values: TimelineEventFormValues
  onChange: (values: TimelineEventFormValues) => void
  storyRange?: TimelineEventFormStoryRange | null
  sourceEvent?: StoryTimelineEvent | null
  currentBranchName?: string
  /**
   * 编辑开始时的原始事件：选择器据此给候选缺失的旧关联标注“未找到”，
   * 提交时也据此回填表单未展示的兼容字段。
   */
  initialEvent?: StoryTimelineEvent | null
  onNavigateMention?: (mention: StoryTimelineMention) => void
}

/** 事件字段集合：分支名（仅创建支线）、标题、时间/刻度、精度/状态、描述与关联。 */
export function TimelineEventForm({
  mode,
  values,
  onChange,
  storyRange,
  sourceEvent,
  currentBranchName,
  initialEvent,
  onNavigateMention,
}: TimelineEventFormProps) {
  const text = useLocaleStore(s => s.text)
  const nodes = useWorldMapStore(s => s.nodes)
  const mentions = useMemo(() => parseStoryTimelineMentions(values.description), [values.description])

  const patch = (partial: Partial<TimelineEventFormValues>) => onChange({ ...values, ...partial })

  const handleMentionClick = (mention: StoryTimelineMention) => {
    if (onNavigateMention) {
      onNavigateMention(mention)
    } else {
      // 没有导航器的宿主只提示意图，不静默吞掉点击。
      toast.info(text(`已定位角色引用：${mention.name}（导航意图）`, `Character mention target: ${mention.name}`))
    }
  }

  return (
    <>
      {mode === 'create-branch' && (
        <label className="writer-timeline-field">
          <span>{text('支线名称', 'Branch name')} *</span>
          <Input
            value={values.newBranchName}
            placeholder={text('例如：西征秘辛、雾港暗线', 'e.g. Western Expedition')}
            onChange={e => patch({ newBranchName: e.target.value })}
            autoFocus
          />
        </label>
      )}

      <label className="writer-timeline-field">
        <span>{text('事件标题', 'Event title')} *</span>
        <Input
          value={values.title}
          placeholder={text('例如：许渡抵达雾港', 'e.g. Arrival at the port')}
          onChange={e => patch({ title: e.target.value })}
          autoFocus={mode !== 'create-branch'}
        />
      </label>

      <div className="writer-timeline-field-grid">
        <label className="writer-timeline-field">
          <span>{text('自定义时间', 'Custom time')} *</span>
          <Input
            value={values.timeLabel}
            placeholder={text('例如：大荒历 317 年冬', 'e.g. Winter, 317')}
            onChange={e => patch({ timeLabel: e.target.value })}
          />
        </label>
        <label className="writer-timeline-field">
          <span>{text('排列位置', 'Ruler position')} *</span>
          <Input
            type="number"
            step="0.1"
            value={values.sortOrder}
            onChange={e => patch({ sortOrder: e.target.value })}
          />
          <small className="text-xs text-[var(--color-text-muted)]">
            {text(
              '数字越小越靠前；同一位置可并存多个事件，可手动微调。',
              'Lower numbers appear earlier; several events may share one tick.',
            )}
          </small>
        </label>
      </div>

      <div className="writer-timeline-field-grid">
        <label className="writer-timeline-field">
          <span>{text('时间精度', 'Time precision')}</span>
          <select
            value={values.precision}
            onChange={e => patch({ precision: e.target.value as StoryTimelinePrecision })}
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
            value={values.status}
            onChange={e => patch({ status: e.target.value as StoryTimelineEventStatus })}
            className="writer-timeline-select"
          >
            {Object.entries(STORY_TIMELINE_STATUS_LABELS).map(([val, lbl]) => (
              <option key={val} value={val}>{text(lbl.zh, lbl.en)}</option>
            ))}
          </select>
        </label>
      </div>

      {values.precision === 'range' && (
        <label className="writer-timeline-field">
          <span>{text('结束时间', 'End time')}</span>
          <Input
            value={values.rangeEndLabel}
            placeholder={text('范围结束的自定义时间', 'Custom end time')}
            onChange={e => patch({ rangeEndLabel: e.target.value })}
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
          value={values.description}
          placeholder={text('写下事件详情，例如：@许渡 潜入暗河，寻找 [[沈砚]] 的线索。', 'Describe the event...')}
          onChange={e => patch({ description: e.target.value })}
        />
      </label>

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

      <TimelineChapterPicker
        value={values.chapterNumbers}
        onChange={chapterNumbers => patch({ chapterNumbers })}
        initial={initialEvent?.chapterNumbers ?? []}
      />

      <TimelineCharacterPicker
        value={values.characterNames}
        onChange={characterNames => patch({ characterNames })}
        initial={initialEvent?.characterNames ?? []}
      />

      <label className="writer-timeline-field">
        <span>{text('关联地点', 'Linked locations')}</span>
        <select
          multiple
          value={values.locationNodeIds}
          onChange={e => patch({ locationNodeIds: Array.from(e.currentTarget.selectedOptions, opt => opt.value) })}
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

      {mode === 'edit' && currentBranchName && (
        <small className="text-xs text-[var(--color-text-muted)]">
          {text('所属线路：', 'Line: ')}{currentBranchName}
        </small>
      )}
      {mode === 'create-branch' && sourceEvent && (
        <small className="text-xs text-[var(--color-text-muted)]">
          {text('分叉自事件：', 'Branched from: ')}{sourceEvent.title}
        </small>
      )}
      {storyRange && (
        <small className="text-xs text-[var(--color-text-muted)]">
          {text(`故事范围刻度：${storyRange.startOrder} ~ ${storyRange.endOrder}`, `Story range: ${storyRange.startOrder} ~ ${storyRange.endOrder}`)}
        </small>
      )}
    </>
  )
}
