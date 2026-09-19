import { useEffect, useRef, useState } from 'react'
import { Check, Compass, Flag, Milestone, X } from 'lucide-react'
import type { StoryTimelineEvent, StoryTimelineSettings } from '../../shared/story-timeline'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { toast } from '../ui/Toast'

export interface TimelineRangeModalProps {
  open: boolean
  settings: StoryTimelineSettings
  events: StoryTimelineEvent[]
  initialFocusField?: 'start' | 'end' | 'general'
  onClose: () => void
  onSave: (newSettings: StoryTimelineSettings) => Promise<boolean | void>
}

export function TimelineRangeModal({
  open,
  settings,
  events,
  initialFocusField = 'general',
  onClose,
  onSave,
}: TimelineRangeModalProps) {
  const text = useLocaleStore(s => s.text)

  const [title, setTitle] = useState(settings.title)
  const [rulerLabel, setRulerLabel] = useState(settings.rulerLabel)
  const [rulerUnit, setRulerUnit] = useState(settings.rulerUnit)
  const [startLabel, setStartLabel] = useState(settings.startLabel || '故事开端')
  const [startTimeLabel, setStartTimeLabel] = useState(settings.startTimeLabel || '')
  const [startOrder, setStartOrder] = useState(String(settings.startOrder ?? 0))
  const [endLabel, setEndLabel] = useState(settings.endLabel || '故事结束')
  const [endTimeLabel, setEndTimeLabel] = useState(settings.endTimeLabel || '')
  const [endOrder, setEndOrder] = useState(String(settings.endOrder ?? 100))
  const [saving, setSaving] = useState(false)

  const startInputRef = useRef<HTMLInputElement>(null)
  const endInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle(settings.title)
    setRulerLabel(settings.rulerLabel)
    setRulerUnit(settings.rulerUnit)
    setStartLabel(settings.startLabel || '故事开端')
    setStartTimeLabel(settings.startTimeLabel || '')
    setStartOrder(String(settings.startOrder ?? 0))
    setEndLabel(settings.endLabel || '故事结束')
    setEndTimeLabel(settings.endTimeLabel || '')
    setEndOrder(String(settings.endOrder ?? 100))

    const timer = setTimeout(() => {
      if (initialFocusField === 'start') {
        startInputRef.current?.focus()
      } else if (initialFocusField === 'end') {
        endInputRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [open, settings, initialFocusField])

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

  const handleFormSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    const sOrder = Number(startOrder)
    const eOrder = Number(endOrder)

    if (!Number.isFinite(sOrder) || !Number.isFinite(eOrder)) {
      toast.error(text('开端与结束刻度必须为有效数字', 'Start and end order must be valid numbers'))
      return
    }

    if (sOrder >= eOrder) {
      toast.error(text('故事开端的刻度必须小于故事结束的刻度', 'Start order must be less than end order'))
      return
    }

    // 检查是否有已有事件越界
    const outOfBounds = events.some(event => event.sortOrder < sOrder || event.sortOrder > eOrder)
    if (outOfBounds) {
      toast.error(text(
        '已有事件的刻度超出所设范围，请调整故事开端或结束刻度以容纳现有事件',
        'Existing events fall outside this range. Please adjust start or end order.',
      ))
      return
    }

    setSaving(true)
    try {
      await onSave({
        title: title.trim() || settings.title,
        rulerLabel: rulerLabel.trim(),
        rulerUnit: rulerUnit.trim(),
        startLabel: startLabel.trim() || '故事开端',
        startTimeLabel: startTimeLabel.trim(),
        startOrder: sOrder,
        endLabel: endLabel.trim() || '故事结束',
        endTimeLabel: endTimeLabel.trim(),
        endOrder: eOrder,
        hasCustomRange: true,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="writer-timeline-modal-backdrop"
      data-testid="timeline-range-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="writer-timeline-modal max-w-[540px]"
        role="dialog"
        aria-modal="true"
        aria-label={text('设置故事范围与刻度', 'Configure Story Range & Ruler')}
        data-testid="timeline-range-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="writer-timeline-modal-header">
          <div>
            <div className="writer-timeline-modal-subtitle flex items-center gap-1.5">
              <Compass size={13} className="text-blue-600" />
              <span>{text('主干范围锚点 · 故事界限', 'Trunk Range Anchors')}</span>
            </div>
            <h2>{text('设置故事范围与刻度', 'Configure Story Range & Ruler')}</h2>
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

        <form onSubmit={handleFormSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="writer-timeline-modal-body gap-4">
            {/* 时间线整体信息 */}
            <div className="flex flex-col gap-2">
              <label className="writer-timeline-field">
                <span>{text('时间线名称', 'Timeline name')}</span>
                <Input
                  value={title}
                  placeholder={text('例如：故事主线脉络', 'Story timeline')}
                  onChange={e => setTitle(e.target.value)}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="writer-timeline-field">
                  <span>{text('刻度标题', 'Ruler title')}</span>
                  <Input
                    value={rulerLabel}
                    placeholder={text('例如：大荒纪年、卷次', 'e.g. Era')}
                    onChange={e => setRulerLabel(e.target.value)}
                  />
                </label>
                <label className="writer-timeline-field">
                  <span>{text('刻度单位', 'Ruler unit')}</span>
                  <Input
                    value={rulerUnit}
                    placeholder={text('例如：年、日、章', 'e.g. year, day')}
                    onChange={e => setRulerUnit(e.target.value)}
                  />
                </label>
              </div>
            </div>

            {/* 故事开端锚点配置 */}
            <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                <Milestone size={14} />
                <span>{text('左侧锚点：故事开端', 'Left Anchor: Story Start')}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="writer-timeline-field col-span-1">
                  <span>{text('锚点名称', 'Name')}</span>
                  <Input
                    ref={startInputRef}
                    value={startLabel}
                    placeholder="故事开端"
                    onChange={e => setStartLabel(e.target.value)}
                  />
                </label>
                <label className="writer-timeline-field col-span-1">
                  <span>{text('时间标签', 'Time label')}</span>
                  <Input
                    value={startTimeLabel}
                    placeholder={text('例如：元年、开篇', 'Year 1')}
                    onChange={e => setStartTimeLabel(e.target.value)}
                  />
                </label>
                <label className="writer-timeline-field col-span-1">
                  <span>{text('对应刻度', 'Order tick')}</span>
                  <Input
                    type="number"
                    value={startOrder}
                    onChange={e => setStartOrder(e.target.value)}
                  />
                </label>
              </div>
            </div>

            {/* 故事结束锚点配置 */}
            <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                <Flag size={14} />
                <span>{text('右侧锚点：故事结束', 'Right Anchor: Story End')}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="writer-timeline-field col-span-1">
                  <span>{text('锚点名称', 'Name')}</span>
                  <Input
                    ref={endInputRef}
                    value={endLabel}
                    placeholder="故事结束"
                    onChange={e => setEndLabel(e.target.value)}
                  />
                </label>
                <label className="writer-timeline-field col-span-1">
                  <span>{text('时间标签', 'Time label')}</span>
                  <Input
                    value={endTimeLabel}
                    placeholder={text('例如：末章、决战', 'Final chapter')}
                    onChange={e => setEndTimeLabel(e.target.value)}
                  />
                </label>
                <label className="writer-timeline-field col-span-1">
                  <span>{text('对应刻度', 'Order tick')}</span>
                  <Input
                    type="number"
                    value={endOrder}
                    onChange={e => setEndOrder(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <p className="text-xs text-[var(--color-text-muted)] m-0 leading-relaxed">
              {text(
                '主干两端锚点界定故事范围，所有事件必须位于开端与结束之间。保存后画布自动计算主干跨度与事件位置。',
                'Anchors define the story range. All events must fall between Start and End.',
              )}
            </p>
          </div>

          <div className="writer-timeline-modal-footer">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              {text('取消', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              <Check size={14} />
              {text('保存刻度', 'Save ruler')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
