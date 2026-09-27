/**
 * CreatePlotCanvasDialog — 新建剧情画布对话框（纯展示）。
 *
 * 标题必填（空值禁用提交并给出提示），描述选填；打开时自动聚焦并全选
 * 标题输入框，Enter 提交、Escape/取消关闭，提交只调用 `onSubmit` 由外部
 * 完成创建（含关闭时机的决定权），本组件不触达任何持久层。
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { useLocaleStore } from '../../../stores/locale-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../ui/Dialog'
import type { PlotCanvasDraftValues } from './types'
import { MAX_PLOT_CANVAS_DESCRIPTION_LENGTH, MAX_PLOT_CANVAS_NAME_LENGTH } from '../../../shared/plot-canvas'
import './plot-shell.css'

export interface CreatePlotCanvasDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开时的初始标题（重命名场景复用同一组件）。 */
  initialTitle?: string
  /** 打开时的初始描述。 */
  initialDescription?: string
  /** 提交进行中：禁用提交按钮，防止重复提交。 */
  submitting?: boolean
  /** 对话框标题（默认“新增剧情画布”）；重命名等场景由集成方传入已本地化文案。 */
  heading?: string
  /** 提交按钮文案（默认“创建”）。 */
  submitLabel?: string
  /** 提交回调；values.title 保证非空 trim，description 为 trim 后文本（可为空串）。 */
  onSubmit: (values: PlotCanvasDraftValues) => void | Promise<void>
  className?: string
}

export function CreatePlotCanvasDialog({
  open,
  onOpenChange,
  initialTitle = '',
  initialDescription = '',
  submitting,
  heading,
  submitLabel,
  onSubmit,
  className,
}: CreatePlotCanvasDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <CreatePlotCanvasDialogContent
          key={JSON.stringify([initialTitle, initialDescription])}
          onOpenChange={onOpenChange}
          initialTitle={initialTitle}
          initialDescription={initialDescription}
          submitting={submitting}
          heading={heading}
          submitLabel={submitLabel}
          onSubmit={onSubmit}
          className={className}
        />
      )}
    </Dialog>
  )
}

function CreatePlotCanvasDialogContent({
  onOpenChange,
  initialTitle = '',
  initialDescription = '',
  submitting,
  heading,
  submitLabel,
  onSubmit,
  className,
}: Omit<CreatePlotCanvasDialogProps, 'open'>) {
  const text = useLocaleStore(s => s.text)
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const titleRef = useRef<HTMLInputElement | null>(null)

  // The body mounts for each opening, so its initial state matches the draft.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const node = titleRef.current
      if (!node) return
      node.focus()
      node.select()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [])

  const trimmedTitle = title.trim()
  const canSubmit = trimmedTitle.length > 0 && !submitting

  const submit = () => {
    if (!canSubmit) return
    void onSubmit({ title: trimmedTitle, description: description.trim() })
  }

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit()
  }

  // Escape 交给 Radix Dialog 处理（会触发 onOpenChange(false)）；这里只
  // 补充 Shift+Enter 换行、Enter 直提的文本域例外。
  const handleDescriptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
      <DialogContent
        className={className}
        style={{ maxWidth: 420 }}
        onInteractOutside={event => { event.preventDefault() }}
        data-testid="plot-canvas-create-dialog"
      >
        <DialogHeader className="!py-3">
          <DialogTitle>{heading ?? text('新增剧情画布', 'New plot canvas')}</DialogTitle>
          <DialogDescription>
            {text('画布标题用于左侧目录与顶部选择器；描述可选。', 'The canvas title appears in the sidebar and top picker; the description is optional.')}
          </DialogDescription>
        </DialogHeader>
        <form className="plot-canvas-create-form px-6 pb-5" onSubmit={handleFormSubmit}>
          <div className="plot-canvas-create-form__field">
            <label className="plot-canvas-create-form__label" htmlFor="plot-canvas-create-title">
              {text('画布标题', 'Canvas title')}
              <span className="plot-canvas-create-form__label-mark" aria-hidden="true"> *</span>
            </label>
            <input
              id="plot-canvas-create-title"
              ref={titleRef}
              className="plot-canvas-create-form__input"
              type="text"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder={text('例如：第一卷主线', 'e.g. Volume 1 main line')}
              maxLength={MAX_PLOT_CANVAS_NAME_LENGTH}
              aria-required="true"
              aria-invalid={title.length > 0 && trimmedTitle.length === 0 ? 'true' : undefined}
              data-testid="plot-canvas-create-title-input"
            />
            {trimmedTitle.length === 0 ? (
              <span className="plot-canvas-create-form__hint" data-testid="plot-canvas-create-title-hint">
                {text('请填写画布标题。', 'A canvas title is required.')}
              </span>
            ) : null}
          </div>
          <div className="plot-canvas-create-form__field">
            <label className="plot-canvas-create-form__label" htmlFor="plot-canvas-create-description">
              {text('描述（选填）', 'Description (optional)')}
            </label>
            <textarea
              id="plot-canvas-create-description"
              className="plot-canvas-create-form__textarea"
              rows={3}
              maxLength={MAX_PLOT_CANVAS_DESCRIPTION_LENGTH}
              value={description}
              onChange={event => setDescription(event.target.value)}
              onKeyDown={handleDescriptionKeyDown}
              placeholder={text('一句话说明这条剧情线的走向…', 'One line about where this plot line is heading…')}
              data-testid="plot-canvas-create-description-input"
            />
          </div>
          <div className="plot-canvas-create-form__footer">
            <button
              type="button"
              className="plot-canvas-create-form__btn"
              onClick={() => onOpenChange(false)}
              data-testid="plot-canvas-create-cancel"
            >
              {text('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              className="plot-canvas-create-form__btn plot-canvas-create-form__btn--primary"
              disabled={!canSubmit}
              data-testid="plot-canvas-create-submit"
            >
              {submitLabel ?? text('创建', 'Create')}
            </button>
          </div>
        </form>
      </DialogContent>
  )
}
