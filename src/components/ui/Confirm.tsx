/* eslint-disable react-refresh/only-export-components */
/**
 * Vela 异步确认对话框
 *
 * 替代所有 window.confirm() 调用，返回 Promise<boolean>
 * 使用 CSS 动画（dialog-enter / dialog-exit / backdrop-enter）统一进出场效果。
 *
 * 用法：
 *   import { confirm } from '@/components/ui/Confirm'
 *   const ok = await confirm('确定要归档吗？', '归档后可在列表中恢复查看。')
 *   if (ok) { ... }
 */

import { createRoot } from 'react-dom/client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from './Button'
import { useLocaleStore } from '../../stores/locale-store'
import './feedback-surface.css'

// ===== 内部组件 =====

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmDialogProps extends ConfirmOptions {
  onResolve: (value: boolean) => void
}

function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onResolve,
}: ConfirmDialogProps) {
  const text = useLocaleStore(s => s.text)
  const resolvedTitle = title ?? text('确认操作', 'Confirm action')
  const resolvedConfirmText = confirmText ?? text('确认', 'Confirm')
  const resolvedCancelText = cancelText ?? text('取消', 'Cancel')
  const [isExiting, setIsExiting] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = () => {
    setIsExiting(true)
    setTimeout(() => onResolve(true), 200)
  }

  const handleCancel = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => onResolve(false), 200)
  }, [onResolve])

  // 进场聚焦确认按钮
  useEffect(() => {
    confirmBtnRef.current?.focus()
  }, [])

  // ESC 关闭（等同取消）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleCancel])

  return (
    <div className="vela-feedback-overlay" data-exiting={isExiting} onClick={handleCancel}>
      {/* 弹窗主体 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="vela-feedback-panel vela-feedback-content"
        data-exiting={isExiting}
        onClick={e => e.stopPropagation()}
      >
        <div className="vela-feedback-header">
          <h2 id="confirm-dialog-title" className="vela-feedback-title">{resolvedTitle}</h2>
        </div>

        <div id="confirm-dialog-message" className="vela-feedback-message">{message}</div>

        <div className="vela-feedback-actions">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            {resolvedCancelText}
          </Button>
          <Button
            ref={confirmBtnRef}
            variant={danger ? 'destructive' : 'default'}
            size="sm"
            onClick={handleConfirm}
          >
            {resolvedConfirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ===== 公共 API =====

/**
 * 显示确认对话框，返回 Promise<boolean>
 *
 * @example
 * const ok = await confirm('确定要删除此草稿吗？', { danger: true })
 */
export function confirm(
  message: string,
  options?: Partial<Omit<ConfirmOptions, 'message'>>,
): Promise<boolean> {
  return new Promise(resolve => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)
    const cleanup = (value: boolean) => {
      root.unmount()
      document.body.removeChild(container)
      resolve(value)
    }

    root.render(
      <ConfirmDialog
        message={message}
        title={options?.title}
        confirmText={options?.confirmText}
        cancelText={options?.cancelText}
        danger={options?.danger}
        onResolve={cleanup}
      />
    )
  })
}
