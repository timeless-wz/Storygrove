/**
 * TimelineEventFloat — 画布内的事件详情/操作/编辑浮窗（任务 B）。
 *
 * - 右键事件在鼠标附近打开详情；双击直接进入浮窗内编辑态；
 * - 详情模式提供编辑、创建支线、添加后续事件、展开/折叠支线、删除的真实入口；
 * - 浮窗钳制在画布边界内，内容超高时内部滚动，绝不遮罩整个应用；
 * - 编辑保存失败时保留输入与焦点并显示错误；只有 success 才结束本次编辑
 *   （成功后由页面切回详情模式，保持视角不跳回全局适应）；
 * - 有未保存修改时 Escape/点外部不会静默丢弃，而是显示“继续编辑/放弃修改”。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CalendarPlus,
  Check,
  Edit3,
  FolderMinus,
  FolderPlus,
  GitBranch,
  Trash2,
  X,
} from 'lucide-react'
import type { StoryTimelineEvent } from '../../shared/story-timeline'
import { useLocaleStore } from '../../stores/locale-store'
import type {
  TimelineCanvasBounds,
  TimelineCascadePreview,
  TimelineEventFloatCallbacks,
  TimelineScreenPoint,
} from './timeline-ui-contract'
import {
  buildTimelineEventSubmission,
  createTimelineEventFormValues,
  localizeTimelineFormError,
  TimelineEventForm,
  type TimelineEventFormStoryRange,
  type TimelineEventFormValues,
} from './TimelineEventForm'
import '../ui/feedback-surface.css'

const FLOAT_MARGIN = 12
const DETAILS_WIDTH = 300
const EDIT_WIDTH = 400

export interface TimelineEventFloatProps {
  eventId: string
  point: TimelineScreenPoint
  mode: 'details' | 'edit'
  bounds: TimelineCanvasBounds
  event: StoryTimelineEvent
  branchName: string | null
  statusLabel: string
  chapterText: string | null
  characterNames: string[]
  locationNames: string[]
  childBranches: Array<{ id: string; name: string }>
  isExpanded: boolean
  cascade: TimelineCascadePreview
  callbacks: TimelineEventFloatCallbacks
  /** 故事范围（可选）：提供时保存超出范围会给出修正提示，绝不自动扩写范围。 */
  storyRange?: TimelineEventFormStoryRange | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function TimelineEventFloat({
  eventId,
  point,
  mode,
  bounds,
  event,
  branchName,
  statusLabel,
  chapterText,
  characterNames,
  locationNames,
  childBranches,
  isExpanded,
  cascade,
  callbacks,
  storyRange,
}: TimelineEventFloatProps) {
  const text = useLocaleStore(s => s.text)
  const panelRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /** 编辑态有改动时，Escape/点外部先进入这个确认态，绝不静默丢弃。 */
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** 编辑基线：整个编辑会话固定为打开时的记录，兼容字段据此回填。 */
  const [editBase] = useState<StoryTimelineEvent>(() => event)
  const [initialValues] = useState<TimelineEventFormValues>(
    () => createTimelineEventFormValues('edit', { initialEvent: editBase }),
  )
  const [values, setValues] = useState<TimelineEventFormValues>(initialValues)

  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues)

  /**
   * 画布容器的实时矩形：侧栏折叠、窗口缩放等尺寸变化时据此重新钳制，
   * 浮窗始终留在画布内。bounds prop 只是打开时刻的快照兜底。
   */
  const [liveBounds, setLiveBounds] = useState<TimelineCanvasBounds | null>(null)
  useEffect(() => {
    const container = panelRef.current?.parentElement
    if (!container || typeof ResizeObserver === 'undefined') return
    let frame: number | null = null
    const measure = () => {
      const rect = container.getBoundingClientRect()
      setLiveBounds(previous => previous && previous.left === rect.left && previous.top === rect.top
        && previous.width === rect.width && previous.height === rect.height
        ? previous : { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    const update = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        measure()
      })
    }
    measure()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
    }
  }, [])
  const activeBounds = liveBounds ?? bounds

  // 定位：优先鼠标右下，放不下翻转/钳制；高度受画布约束，内容内部滚动。
  const [layout, setLayout] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const computeLayout = useCallback((panelHeight: number) => {
    const width = Math.min(mode === 'edit' ? EDIT_WIDTH : DETAILS_WIDTH, activeBounds.width - FLOAT_MARGIN * 2)
    const maxHeight = Math.max(160, activeBounds.height - FLOAT_MARGIN * 2)
    const height = Math.min(panelHeight, maxHeight)
    const rawLeft = point.clientX - activeBounds.left + 14
    const rawTop = point.clientY - activeBounds.top + 14
    const flippedLeft = point.clientX - activeBounds.left - width - 14
    const flippedTop = point.clientY - activeBounds.top - height - 14
    const left = clamp(
      rawLeft + width <= activeBounds.width - FLOAT_MARGIN ? rawLeft : flippedLeft,
      FLOAT_MARGIN,
      activeBounds.width - width - FLOAT_MARGIN,
    )
    const top = clamp(
      rawTop + height <= activeBounds.height - FLOAT_MARGIN ? rawTop : flippedTop,
      FLOAT_MARGIN,
      activeBounds.height - height - FLOAT_MARGIN,
    )
    return { left, top, width, maxHeight }
  }, [activeBounds, mode, point])

  useLayoutEffect(() => {
    const measure = () => {
      const panel = panelRef.current
      // 用真实矩形高度并向上取整加 1px 余量：offsetHeight 会取整，
      // 小数高度会让钳制后的底/右边缘越出 12px 安全边距。
      const height = panel ? Math.ceil(panel.getBoundingClientRect().height) + 1 : 220
      setLayout(computeLayout(height))
    }
    measure()
  }, [computeLayout, mode, confirmingDelete, confirmDiscard, error])

  const requestClose = useCallback((viaEscape: boolean) => {
    if (confirmingDelete) {
      setConfirmingDelete(false)
      return
    }
    if (mode === 'edit' && isDirty && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    callbacks.onClose(viaEscape ? { viaEscape: true } : undefined)
  }, [callbacks, confirmDiscard, confirmingDelete, isDirty, mode])

  // Escape 关闭（带回焦语义）；Tab 在浮窗内循环，焦点不逃逸到页面底部；
  // 点击浮窗外关闭；右键在浮窗上不冒泡成画布菜单。
  useEffect(() => {
    const focusableIn = (panel: HTMLElement): HTMLElement[] => Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(element => element.offsetParent !== null || element === document.activeElement)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose(true)
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = focusableIn(panelRef.current)
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const current = document.activeElement
        if (!panelRef.current.contains(current)) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && current === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && current === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    const handlePointerDown = (e: PointerEvent) => {
      // window 上可能收到非 Node 目标的事件（如直接派发到 window），防御处理。
      if (!(e.target instanceof Node)) return
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        requestClose(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [requestClose])

  useEffect(() => {
    // 挂载即聚焦，让 Escape 立即可用；焦点留在浮窗内不触发画布平移。
    panelRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    if (saving) return
    const submission = buildTimelineEventSubmission(values, 'edit', { initialEvent: editBase, storyRange: storyRange ?? null })
    if (!submission.ok) {
      setError(localizeTimelineFormError(submission.error, text))
      return
    }
    setSaving(true)
    setError(null)
    try {
      // 成功时页面会把浮窗切回详情模式；失败则停留在此保留输入。
      const result = await callbacks.onSaveEvent(submission.event)
      if (!result.success) {
        setError(result.error)
        return
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await callbacks.onDeleteEvent(event.id)
      if (!result.success) {
        setError(result.error)
        setConfirmingDelete(false)
        return
      }
      callbacks.onClose()
    } finally {
      setSaving(false)
    }
  }

  const metaParts = [
    branchName ?? text('主轴', 'Main axis'),
    chapterText,
  ].filter(Boolean) as string[]

  return (
    <div
      ref={panelRef}
      className={`writer-timeline-float vela-feedback-panel is-${mode}`}
      data-testid="timeline-event-float"
      data-float-event-id={eventId}
      data-float-mode={mode}
      role="dialog"
      aria-label={mode === 'edit' ? text('编辑事件', 'Edit event') : text('事件详情', 'Event detail')}
      tabIndex={-1}
      style={{
        left: layout?.left ?? -9999,
        top: layout?.top ?? -9999,
        width: layout?.width,
        maxHeight: layout?.maxHeight,
      }}
      onContextMenu={e => e.preventDefault()}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <button
        type="button"
        className="writer-timeline-float-close"
        onClick={() => requestClose(false)}
        aria-label={text('关闭', 'Close')}
      >
        <X size={13} />
      </button>

      {mode === 'details' ? (
        <div className="writer-timeline-float-body">
          <h3 className="writer-timeline-float-title">{event.title || text('未命名事件', 'Untitled event')}</h3>
          {metaParts.length > 0 && (
            <p className="writer-timeline-float-meta">{metaParts.join(' · ')}</p>
          )}
          {event.timeLabel && (
            <p className="writer-timeline-float-time">{event.timeLabel}</p>
          )}
          <p className="writer-timeline-float-status">
            <span className={`writer-timeline-status-dot is-${event.status}`} aria-hidden="true" />
            <span>{statusLabel}</span>
          </p>
          {event.description
            ? <p className="writer-timeline-float-desc">{event.description}</p>
            : (
                <p className="writer-timeline-float-desc is-empty">
                  {text('这条事件还没有描述。', 'This event has no description yet.')}
                </p>
              )}

          {(characterNames.length > 0 || locationNames.length > 0) && (
            <dl className="writer-timeline-float-facts">
              {characterNames.length > 0 && (
                <div>
                  <dt>{text('角色', 'Characters')}</dt>
                  <dd>{characterNames.join('、')}</dd>
                </div>
              )}
              {locationNames.length > 0 && (
                <div>
                  <dt>{text('地点', 'Locations')}</dt>
                  <dd>{locationNames.join('、')}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="writer-timeline-float-divider" aria-hidden="true" />

          {confirmingDelete ? (
            <div className="writer-timeline-float-confirm" data-testid="timeline-float-delete-confirm">
              <p>
                {text('确定删除这条事件？', 'Delete this event?')}
                {cascade.branchNames.length > 0
                  ? text(
                      `将同时删除支线「${cascade.branchNames.join('」「')}」及其中 ${cascade.eventCount - 1} 个事件。`,
                      `Branches ${cascade.branchNames.join(', ')} and ${cascade.eventCount - 1} events will be removed too.`,
                    )
                  : text('它没有下游支线，只删除事件本身。', 'It has no downstream branches; only this event is removed.')}
              </p>
              <div className="writer-timeline-float-confirm-actions">
                <button
                  type="button"
                  className="writer-timeline-float-action is-danger"
                  disabled={saving}
                  onClick={() => void handleDelete()}
                >
                  <Trash2 size={13} />
                  <span>{saving ? text('删除中…', 'Deleting…') : text('确认删除', 'Confirm delete')}</span>
                </button>
                <button
                  type="button"
                  className="writer-timeline-float-action"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {text('取消', 'Cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="writer-timeline-float-actions">
              <button
                type="button"
                className="writer-timeline-float-action"
                data-testid="timeline-float-edit"
                onClick={callbacks.onSwitchToEdit}
              >
                <Edit3 size={13} />
                <span>{text('编辑事件', 'Edit event')}</span>
              </button>
              <button
                type="button"
                className="writer-timeline-float-action"
                data-testid="timeline-float-create-branch"
                onClick={() => callbacks.onCreateBranch(eventId)}
              >
                <GitBranch size={13} />
                <span>{text('创建支线', 'Create branch')}</span>
              </button>
              <button
                type="button"
                className="writer-timeline-float-action"
                data-testid="timeline-float-create-next"
                onClick={() => callbacks.onCreateNext(eventId)}
              >
                <CalendarPlus size={13} />
                <span>{text('添加后续事件', 'Add next event')}</span>
              </button>
              {childBranches.length > 0 && (
                <button
                  type="button"
                  className="writer-timeline-float-action"
                  data-testid="timeline-float-toggle-branches"
                  onClick={() => callbacks.onToggleBranches(eventId)}
                >
                  {isExpanded ? <FolderMinus size={13} /> : <FolderPlus size={13} />}
                  <span>
                    {isExpanded
                      ? text('折叠支线', 'Collapse branches')
                      : text('展开支线', 'Expand branches')}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="writer-timeline-float-action is-danger"
                data-testid="timeline-float-delete"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={13} />
                <span>{text('删除事件', 'Delete event')}</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="writer-timeline-float-body is-form">
          {confirmDiscard && (
            <div className="writer-timeline-float-confirm" role="alert" data-testid="timeline-float-discard-confirm">
              <p>{text('有尚未保存的修改。', 'You have unsaved changes.')}</p>
              <div className="writer-timeline-float-confirm-actions">
                <button
                  type="button"
                  className="writer-timeline-float-action"
                  onClick={() => setConfirmDiscard(false)}
                >
                  {text('继续编辑', 'Keep editing')}
                </button>
                <button
                  type="button"
                  className="writer-timeline-float-action is-danger"
                  onClick={() => callbacks.onClose()}
                >
                  {text('放弃修改', 'Discard changes')}
                </button>
              </div>
            </div>
          )}

          <div className="writer-timeline-float-scroll">
            <TimelineEventForm
              mode="edit"
              values={values}
              onChange={(next) => {
                setValues(next)
                setConfirmDiscard(false)
                setError(null)
              }}
              initialEvent={editBase}
              storyRange={storyRange ?? null}
              currentBranchName={branchName ?? text('主轴', 'Main axis')}
              onNavigateMention={callbacks.onNavigateMention}
            />
          </div>

          {error && (
            <p className="writer-timeline-field-error" role="alert">{error}</p>
          )}

          <div className="writer-timeline-float-footer">
            <button
              type="button"
              className="writer-timeline-float-cancel"
              onClick={() => requestClose(false)}
              disabled={saving}
            >
              {text('取消', 'Cancel')}
            </button>
            <button
              type="button"
              className="writer-timeline-float-save"
              data-testid="timeline-float-save"
              disabled={saving || !values.title.trim() || !values.timeLabel.trim() || !Number.isFinite(Number(values.sortOrder))}
              onClick={() => void handleSubmit()}
            >
              <Check size={13} />
              <span>{saving ? text('保存中…', 'Saving…') : text('保存事件', 'Save event')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
