import { useEffect, useRef } from 'react'
import {
  Compass,
  Flag,
  Milestone,
  Plus,
} from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import type {
  TimelineCanvasBounds,
  TimelineScreenPoint,
} from './timeline-ui-contract'

/**
 * 画布空白处与起止锚点的右键菜单（任务 B）。
 *
 * 事件本身的详情与操作由 TimelineEventFloat 负责；这里只处理
 * 「在此创建事件」与「设置故事范围」两类画布级动作，并始终完整地
 * 钳制在画布容器边界内，而不是按整个窗口避让。
 */

export interface TimelineContextMenuProps {
  point: TimelineScreenPoint
  bounds: TimelineCanvasBounds
  targetAnchor?: 'start' | 'end' | null
  suggestedOrder?: number | null
  canCreateEventAtPosition?: boolean
  onClose: () => void
  onCreateMainEvent: (suggestedOrder?: number) => void
  onOpenRangeSettings?: (focusField?: 'start' | 'end' | 'general') => void
}

const MENU_MARGIN = 12
const MENU_WIDTH = 220

export function TimelineContextMenu({
  point,
  bounds,
  targetAnchor,
  suggestedOrder,
  canCreateEventAtPosition = true,
  onClose,
  onCreateMainEvent,
  onOpenRangeSettings,
}: TimelineContextMenuProps) {
  const text = useLocaleStore(s => s.text)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const menuHeight = targetAnchor ? 92 : (canCreateEventAtPosition ? 84 : 48)
  // 菜单渲染在画布容器内（absolute），先把 client 坐标换算成容器坐标再钳制。
  const safeX = Math.max(
    MENU_MARGIN,
    Math.min(point.clientX - bounds.left, bounds.width - MENU_WIDTH - MENU_MARGIN),
  )
  const safeY = Math.max(
    MENU_MARGIN,
    Math.min(point.clientY - bounds.top, bounds.height - menuHeight - MENU_MARGIN),
  )

  return (
    <div
      ref={menuRef}
      role="menu"
      className="writer-timeline-context-menu"
      data-testid="timeline-context-menu"
      style={{ left: safeX, top: safeY }}
    >
      {targetAnchor === 'start' ? (
        // 右键开端锚点
        <>
          <button
            type="button"
            role="menuitem"
            className="writer-timeline-context-item"
            onClick={() => {
              onOpenRangeSettings?.('start')
              onClose()
            }}
          >
            <Milestone size={14} className="text-[var(--color-accent-text)]" />
            <span>{text('编辑故事开端', 'Edit Story Start')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="writer-timeline-context-item"
            onClick={() => {
              onOpenRangeSettings?.('general')
              onClose()
            }}
          >
            <Compass size={14} />
            <span>{text('设置故事范围', 'Set story range')}</span>
          </button>
        </>
      ) : targetAnchor === 'end' ? (
        // 右键结束锚点
        <>
          <button
            type="button"
            role="menuitem"
            className="writer-timeline-context-item"
            onClick={() => {
              onOpenRangeSettings?.('end')
              onClose()
            }}
          >
            <Flag size={14} className="text-[var(--color-success-text)]" />
            <span>{text('编辑故事结束', 'Edit Story End')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="writer-timeline-context-item"
            onClick={() => {
              onOpenRangeSettings?.('general')
              onClose()
            }}
          >
            <Compass size={14} />
            <span>{text('设置故事范围', 'Set story range')}</span>
          </button>
        </>
      ) : (
        // 右键空白画布或主干
        <>
          {canCreateEventAtPosition && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item"
              onClick={() => {
                onCreateMainEvent(suggestedOrder ?? undefined)
                onClose()
              }}
            >
              <Plus size={14} />
              <span>
                {suggestedOrder !== null && suggestedOrder !== undefined
                  ? text(`在此创建事件（刻度: ${suggestedOrder}）`, `Create event here (tick: ${suggestedOrder})`)
                  : text('新建主线事件', 'New main event')}
              </span>
            </button>
          )}

          {onOpenRangeSettings && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item"
              onClick={() => {
                onOpenRangeSettings('general')
                onClose()
              }}
            >
              <Compass size={14} />
              <span>{text('设置故事范围', 'Set story range')}</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
