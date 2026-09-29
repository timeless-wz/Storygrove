/* eslint-disable react-refresh/only-export-components */
/**
 * Vela 全局 Toast 通知系统
 *
 * 用于轻量、非阻塞的操作反馈（成功、警告，普通信息）。
 * 关键错误请使用 alertError() — 见 AlertDialog.tsx。
 *
 * 使用 CSS 动画类替代 inline-style，统一与 index.css 中的 keyframes 对齐。
 *
 * 用法：
 *   import { toast } from '@/components/ui/Toast'
 *   toast.success('保存成功')
 *   toast.warning('字数超出限制')
 *   toast.info('提示信息')
 */

import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import './feedback-surface.css'

// ===== 类型定义 =====

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

// ===== 全局状态 =====

let _toastCounter = 0
let _addToast: ((item: ToastItem) => void) | null = null
let _pendingToasts: ToastItem[] = []

/** 挂载 Toast 容器到 DOM */
function ensureContainer() {
  if (document.getElementById('vela-toast-root')) return
  const container = document.createElement('div')
  container.id = 'vela-toast-root'
  document.body.appendChild(container)
  createRoot(container).render(<ToastContainer />)
}

// ===== Toast 容器组件 =====

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    _addToast = (item) => {
      setToasts(prev => [...prev, item])
    }
    const pending = _pendingToasts
    _pendingToasts = []
    queueMicrotask(() => pending.forEach(item => _addToast?.(item)))
    return () => { _addToast = null }
  }, [])

  const remove = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div
      className="fixed bottom-10 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map(t => (
        <ToastItemView key={t.id} item={t} onRemove={remove} />
      ))}
    </div>
  )
}

// ===== 单条 Toast =====

/** 类型只改变语义图标与点缀色，通知表面保持一致。 */
const TOAST_STYLE: Record<ToastType, { accent: string; icon: React.ReactNode }> = {
  success: {
    accent: 'var(--color-success)',
    icon: <CheckCircle2 size={15} />
  },
  error: {
    accent: 'var(--color-error)',
    icon: <AlertTriangle size={15} />
  },
  warning: {
    accent: 'var(--color-warning)',
    icon: <AlertTriangle size={15} />
  },
  info: {
    accent: 'var(--color-accent)',
    icon: <Info size={15} />
  },
}

function ToastItemView({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const text = useLocaleStore(s => s.text)
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    // 退场动画 - 提前 300ms 开始
    const t2 = setTimeout(() => setIsExiting(true), item.duration - 300)
    // 移除 DOM
    const t3 = setTimeout(() => onRemove(item.id), item.duration)
    return () => { clearTimeout(t2); clearTimeout(t3) }
  }, [item.id, item.duration, onRemove])

  const { accent, icon } = TOAST_STYLE[item.type]

  return (
    <div className="vela-toast-card pointer-events-auto" data-exiting={isExiting} style={{ '--toast-accent': accent } as React.CSSProperties} role={item.type === 'error' ? 'alert' : 'status'}>
      <span className="vela-toast-icon">{icon}</span>
      <span className="vela-toast-message">{item.message}</span>
      <button
        onClick={() => onRemove(item.id)}
        className="vela-feedback-close"
        aria-label={text('关闭提示', 'Dismiss notification')}
      >
        <X size={13} />
      </button>
    </div>
  )
}

// ===== 公共 API =====

function show(message: string, type: ToastType = 'info', duration = 4000) {
  ensureContainer()
  const item: ToastItem = { id: ++_toastCounter, type, message, duration }
  if (_addToast) _addToast(item)
  else _pendingToasts.push(item)
}

export const toast = {
  success: (msg: string, duration = 3500) => show(msg, 'success', duration),
  error:   (msg: string, duration = 5000) => show(msg, 'error', duration),
  warning: (msg: string, duration = 4500) => show(msg, 'warning', duration),
  info:    (msg: string, duration = 4000) => show(msg, 'info', duration),
}
