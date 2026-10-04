/* eslint-disable react-refresh/only-export-components */
/**
 * Vela ActionToast — 带操作按钮的增强通知
 *
 * 用于 AI 工作流完成后弹出带操作按钮的通知（如「打开查看」「忽略」）。
 * 基于独立的 React Portal 渲染，不依赖 Toast.tsx 的容器。
 *
 * 使用 CSS 动画类（action-toast-enter / action-toast-exit）统一进出场效果。
 *
 * 用法：
 *   import { actionToast } from '@/components/ui/ActionToast'
 *   actionToast.show({
 *     type: 'success',
 *     message: '✅ 草稿已生成',
 *     actions: [
 *       { label: '打开查看', onClick: () => openDraft() },
 *     ],
 *   })
 */

import { createRoot } from 'react-dom/client'
import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle2, AlertTriangle, Info, Sparkles } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import './feedback-surface.css'

// ===== 类型定义 =====

export type ActionToastType = 'success' | 'info' | 'warning' | 'ai'

export interface ActionToastAction {
  /** 按钮文案 */
  label: string
  /** 点击回调（点击后 Toast 自动关闭） */
  onClick?: () => void | Promise<void>
  /** 按钮风格：主色('primary') 或灰色('ghost') */
  variant?: 'primary' | 'ghost'
}

export interface ActionToastOptions {
  /** 通知类型（决定图标和左边框颜色） */
  type?: ActionToastType
  /** 通知消息 */
  message: string
  /** 操作按钮列表（最多 2 个） */
  actions?: ActionToastAction[]
  /** 自动消失时间（毫秒），设 0 表示不自动消失。默认 8000 */
  duration?: number
}

interface ActionToastItem extends ActionToastOptions {
  id: number
}

// ===== 全局状态 =====

let _counter = 0
let _addItem: ((item: ActionToastItem) => void) | null = null
let _removeItem: ((id: number) => void) | null = null
let _pendingItems: ActionToastItem[] = []
const _dismissedItems = new Set<number>()

function dismissItem(id: number) {
  _dismissedItems.add(id)
  _pendingItems = _pendingItems.filter(item => item.id !== id)
  _removeItem?.(id)
}

/** 挂载 ActionToast 容器到 DOM */
function ensureContainer() {
  if (document.getElementById('vela-action-toast-root')) return
  const container = document.createElement('div')
  container.id = 'vela-action-toast-root'
  document.body.appendChild(container)
  createRoot(container).render(<ActionToastContainer />)
}

// ===== 容器组件 =====

function ActionToastContainer() {
  const [items, setItems] = useState<ActionToastItem[]>(() => {
    const pending = _pendingItems
    _pendingItems = []
    return pending
  })

  useEffect(() => {
    _addItem = (item) => {
      setItems(prev => [...prev, item])
    }
    _removeItem = (id) => {
      _dismissedItems.delete(id)
      setItems(prev => prev.filter(item => item.id !== id))
    }
    if (_pendingItems.length > 0) {
      const pending = _pendingItems
      _pendingItems = []
      queueMicrotask(() => pending.forEach(item => _addItem?.(item)))
    }
    if (_dismissedItems.size > 0) {
      const dismissed = [..._dismissedItems]
      queueMicrotask(() => dismissed.forEach(id => _removeItem?.(id)))
    }
    return () => {
      _addItem = null
      _removeItem = null
    }
  }, [])

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 48,
        right: 20,
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {items.map(item => (
        <ActionToastCard key={item.id} item={item} onRemove={remove} />
      ))}
    </div>
  )
}

// ===== 单条 ActionToast =====

/** 类型→视觉映射 */
const TYPE_STYLE: Record<ActionToastType, { accent: string; icon: React.ReactNode }> = {
  success: {
    accent: 'var(--color-success)',
    icon: <CheckCircle2 size={16} />,
  },
  info: {
    accent: 'var(--color-info)',
    icon: <Info size={16} />,
  },
  warning: {
    accent: 'var(--color-warning)',
    icon: <AlertTriangle size={16} />,
  },
  ai: {
    accent: 'var(--color-accent)',
    icon: <Sparkles size={16} />,
  },
}

function ActionToastCard({ item, onRemove }: { item: ActionToastItem; onRemove: (id: number) => void }) {
  const text = useLocaleStore(s => s.text)
  const [isExiting, setIsExiting] = useState(false)
  const duration = item.duration ?? 8000

  useEffect(() => {
    let t2: ReturnType<typeof setTimeout>
    let t3: ReturnType<typeof setTimeout>
    if (duration > 0) {
      // 退场动画
      t2 = setTimeout(() => setIsExiting(true), duration - 300)
      t3 = setTimeout(() => onRemove(item.id), duration)
    }
    return () => {
      if (t2) clearTimeout(t2)
      if (t3) clearTimeout(t3)
    }
  }, [item.id, duration, onRemove])

  const dismiss = () => {
    setIsExiting(true)
    setTimeout(() => onRemove(item.id), 250)
  }

  const handleAction = async (action: ActionToastAction) => {
    if (action.onClick) {
      await action.onClick()
    }
    dismiss()
  }

  const { accent, icon } = TYPE_STYLE[item.type || 'info']

  return (
    <div className="vela-toast-card vela-action-toast" data-exiting={isExiting} style={{ '--toast-accent': accent } as React.CSSProperties} role="status">
      {/* 第一行：图标 + 消息 + 关闭 */}
      <div className="vela-action-toast-row">
        <span className="vela-toast-icon">{icon}</span>
        <span className="vela-toast-message">{item.message}</span>
        <button
          onClick={dismiss}
          className="vela-feedback-close"
          aria-label={text('关闭提示', 'Dismiss notification')}
        >
          <X size={12} />
        </button>
      </div>

      {/* 第二行：操作按钮 */}
      {item.actions && item.actions.length > 0 && (
        <div className="vela-action-toast-actions">
          {item.actions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleAction(action)}
              data-variant={action.variant || 'primary'}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 公共 API =====

export const actionToast = {
  /**
   * 显示带操作按钮的 Toast 通知
   */
  show: (options: ActionToastOptions) => {
    ensureContainer()
    const item: ActionToastItem = { id: ++_counter, ...options }
    if (_addItem) _addItem(item)
    else _pendingItems.push(item)
    return () => dismissItem(item.id)
  },

  /** 工作流完成快捷方法 */
  workflowComplete: (
    message: string,
    openAction?: () => void | Promise<void>,
    openActionLabel?: string,
  ) => {
    ensureContainer()
    const actions: ActionToastAction[] = []
    if (openAction) {
      const text = useLocaleStore.getState().text
      actions.push({ label: openActionLabel ?? text('打开查看', 'Open'), onClick: openAction })
      actions.push({ label: text('忽略', 'Dismiss'), variant: 'ghost' })
    }
    const item: ActionToastItem = {
      id: ++_counter,
      type: 'ai',
      message,
      actions,
      duration: openAction ? 10000 : 6000,
    }
    if (_addItem) _addItem(item)
    else _pendingItems.push(item)
  },
}
