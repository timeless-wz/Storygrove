/**
 * TimelineEventModal — 新建主轴事件 / 添加后续事件 / 创建支线的全屏表单弹窗。
 *
 * 事件编辑已移入画布浮窗（TimelineEventFloat），这里只保留创建入口。
 * onSave 统一返回 TimelineUiResult：失败时弹窗保留输入并显示错误，
 * 绝不静默关闭；创建支线由页面通过 store 的原子操作一次事务提交。
 */

import { useEffect, useState } from 'react'
import { Check, GitBranch, X } from 'lucide-react'
import type { StoryTimelineEvent } from '../../shared/story-timeline'
import { useLocaleStore } from '../../stores/locale-store'
import type { TimelineUiResult } from './timeline-ui-contract'
import {
  buildTimelineEventSubmission,
  createTimelineEventFormValues,
  localizeTimelineFormError,
  TimelineEventForm,
  type TimelineEventFormMode,
  type TimelineEventFormStoryRange,
  type TimelineEventFormValues,
} from './TimelineEventForm'
import { Button } from '../ui/Button'
import '../ui/feedback-surface.css'

export interface TimelineEventModalProps {
  open: boolean
  mode: Exclude<TimelineEventFormMode, 'edit'>
  sourceEvent?: StoryTimelineEvent | null
  currentBranchName?: string
  nextSortOrder?: number
  initialSortOrder?: number
  storyRange?: TimelineEventFormStoryRange
  onClose: () => void
  onSave: (data: { event: StoryTimelineEvent; newBranchName?: string }) => Promise<TimelineUiResult>
}

export function TimelineEventModal({
  open,
  mode,
  sourceEvent,
  currentBranchName,
  nextSortOrder = 1,
  initialSortOrder,
  storyRange,
  onClose,
  onSave,
}: TimelineEventModalProps) {
  const text = useLocaleStore(s => s.text)

  const [values, setValues] = useState<TimelineEventFormValues>(
    () => createTimelineEventFormValues(mode, { sourceEvent, nextSortOrder, initialSortOrder }),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 每次打开（或目标变化）都重置表单：用「渲染期调整状态」模式替代 effect，
  // 避免多一轮级联渲染，也保证关闭期间不会残留上一次的输入。
  const [renderedKey, setRenderedKey] = useState<string | null>(null)
  const formKey = open
    ? `${mode}:${sourceEvent?.id ?? ''}:${initialSortOrder ?? ''}:${nextSortOrder}`
    : null
  if (formKey === null) {
    // 关闭时清掉已渲染标记，保证同样的表单再次打开时也会重置。
    if (renderedKey !== null) setRenderedKey(null)
  } else if (renderedKey !== formKey) {
    setRenderedKey(formKey)
    setValues(createTimelineEventFormValues(mode, { sourceEvent, nextSortOrder, initialSortOrder }))
    setError(null)
    setSaving(false)
  }

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

  const getModalTitle = () => {
    switch (mode) {
      case 'create-branch':
        return text('创建新支线事件', 'Create branch event')
      case 'create-next':
        return text('添加后续事件', 'Add next event')
      default:
        return text('新建主线事件', 'New main timeline event')
    }
  }

  const handleSubmit = async () => {
    if (saving) return
    const submission = buildTimelineEventSubmission(values, mode, {
      sourceEvent,
      storyRange: storyRange ?? null,
    })
    if (!submission.ok) {
      setError(localizeTimelineFormError(submission.error, text))
      return
    }

    setSaving(true)
    setError(null)
    try {
      // 支线名称必填：为空时共享校验已在此前拦截，这里绝不静默兜底成“支线”。
      const result = await onSave({
        event: submission.event,
        newBranchName: mode === 'create-branch' ? values.newBranchName.trim() : undefined,
      })
      if (!result.success) {
        setError(localizeTimelineFormError(result.error, text))
        return
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="writer-timeline-modal-backdrop vela-feedback-overlay"
      data-testid="timeline-event-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="writer-timeline-modal vela-feedback-panel"
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
                <span className="inline-flex items-center gap-1 text-[var(--color-success-text)] font-medium">
                  <GitBranch size={13} />
                  {text('分叉自事件：', 'Branched from: ')} {sourceEvent?.title}
                </span>
              ) : currentBranchName ? (
                <span className="inline-flex items-center gap-1 text-[var(--color-accent-text)] font-medium">
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
          <TimelineEventForm
            mode={mode}
            values={values}
            onChange={(next) => {
              setValues(next)
              setError(null)
            }}
            sourceEvent={sourceEvent}
            currentBranchName={mode === 'create-next' ? currentBranchName : undefined}
            storyRange={storyRange ?? null}
          />

          {error && (
            <div className="writer-timeline-field-error text-xs text-[var(--color-error-text)]" role="alert">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="writer-timeline-modal-footer">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {text('取消', 'Cancel')}
          </Button>

          <Button
            size="sm"
            disabled={
              saving
              || !values.title.trim()
              || !values.timeLabel.trim()
              || !Number.isFinite(Number(values.sortOrder))
              || (mode === 'create-branch' && !values.newBranchName.trim())
            }
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
