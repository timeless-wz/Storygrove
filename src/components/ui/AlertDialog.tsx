/* eslint-disable react-refresh/only-export-components */
/**
 * Vela 弹窗报错组件 — JetBrains / VSCode 风格
 *
 * 用于需要用户明确知晓的关键错误（如项目加载失败、文件读写错误等）。
 * 完全使用项目 CSS 变量，自动适配深色 / 浅色主题。
 *
 * 使用 CSS 动画（dialog-enter / dialog-exit / backdrop-enter）统一进出场效果。
 *
 * 用法：
 *   import { alertError } from '@/components/ui/AlertDialog'
 *   alertError('不是有效的 Vela 项目目录', { title: '打开项目失败' })
 */

import { createRoot } from 'react-dom/client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from './Button'
import { useLocaleStore } from '../../stores/locale-store'
import './feedback-surface.css'

// ===== 类型定义 =====

interface AlertOptions {
  /** 弹窗标题，默认「发生错误」 */
  title?: string
  /** 确认按钮文字，默认「确定」 */
  confirmText?: string
}

interface AlertDialogProps extends AlertOptions {
  message: string
  onClose: () => void
}

// ===== 弹窗组件 =====

function AlertDialog({
  title,
  message,
  confirmText,
  onClose,
}: AlertDialogProps) {
  const text = useLocaleStore(s => s.text)
  const resolvedTitle = title ?? text('发生错误', 'Error')
  const resolvedConfirmText = confirmText ?? text('确定', 'OK')
  const [isExiting, setIsExiting] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleClose = useCallback(() => {
    setIsExiting(true)
    setTimeout(onClose, 200)
  }, [onClose])

  // 进场聚焦确认按钮
  useEffect(() => {
    btnRef.current?.focus()
  }, [])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  return (
    <div className="vela-feedback-overlay" data-exiting={isExiting} onClick={handleClose}>
      {/* 弹窗主体 */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-title"
        aria-describedby="alert-message"
        className="vela-feedback-panel vela-feedback-content"
        data-exiting={isExiting}
        onClick={e => e.stopPropagation()}
      >
        <div className="vela-feedback-header">
          <AlertCircle
            size={18}
            style={{ color: 'var(--color-error)', flexShrink: 0 }}
          />
          <h2 id="alert-title" className="vela-feedback-title">{resolvedTitle}</h2>
        </div>

        <div id="alert-message" className="vela-feedback-message">{message}</div>

        <div className="vela-feedback-actions">
          <Button
            ref={btnRef}
            variant="default"
            size="sm"
            onClick={handleClose}
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
 * 显示弹窗报错，返回 Promise（用户确认后 resolve）。
 * 也可以不 await，fire-and-forget。
 *
 * @example
 * await alertError('不是有效的 Vela 项目目录', { title: '打开项目失败' })
 * alertError('写入失败，请检查磁盘权限。')
 */
export function alertError(
  message: string,
  options?: AlertOptions,
): Promise<void> {
  return new Promise(resolve => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)
    const cleanup = () => {
      root.unmount()
      document.body.removeChild(container)
      resolve()
    }

    root.render(
      <AlertDialog
        message={message}
        title={options?.title}
        confirmText={options?.confirmText}
        onClose={cleanup}
      />
    )
  })
}
