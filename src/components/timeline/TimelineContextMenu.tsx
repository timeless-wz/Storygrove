import { useEffect, useRef } from 'react'
import {
  Compass,
  Edit3,
  Flag,
  FolderMinus,
  FolderPlus,
  GitBranch,
  Milestone,
  Plus,
  Trash2,
} from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'

export interface TimelineContextMenuProps {
  x: number
  y: number
  targetEventId?: string | null
  targetAnchor?: 'start' | 'end' | null
  suggestedOrder?: number | null
  canCreateEventAtPosition?: boolean
  hasChildBranches?: boolean
  isBranchExpanded?: boolean
  onClose: () => void
  onCreateMainEvent: (suggestedOrder?: number) => void
  onCreateNextEvent?: () => void
  onCreateBranch?: () => void
  onToggleExpand?: () => void
  onEditEvent?: () => void
  onDeleteEvent?: () => void
  onOpenRangeSettings?: (focusField?: 'start' | 'end' | 'general') => void
}

export function TimelineContextMenu({
  x,
  y,
  targetEventId,
  targetAnchor,
  suggestedOrder,
  canCreateEventAtPosition = true,
  hasChildBranches,
  isBranchExpanded,
  onClose,
  onCreateMainEvent,
  onCreateNextEvent,
  onCreateBranch,
  onToggleExpand,
  onEditEvent,
  onDeleteEvent,
  onOpenRangeSettings,
}: TimelineContextMenuProps) {
  const text = useLocaleStore(s => s.text)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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

  // 边界保护：确保菜单不超出视口边界
  const menuWidth = 200
  const menuHeight = targetEventId ? 220 : 100
  const safeX = Math.max(12, Math.min(x, window.innerWidth - menuWidth - 16))
  const safeY = Math.max(12, Math.min(y, window.innerHeight - menuHeight - 16))

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
            <Milestone size={14} className="text-blue-600" />
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
            <Flag size={14} className="text-emerald-600" />
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
      ) : !targetEventId ? (
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
      ) : (
        // 右键特定事件
        <>
          {onCreateNextEvent && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item"
              onClick={() => {
                onCreateNextEvent()
                onClose()
              }}
            >
              <Plus size={14} />
              <span>{text('在此后添加事件', 'Add next event')}</span>
            </button>
          )}

          {onCreateBranch && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item text-emerald-600 dark:text-emerald-400"
              onClick={() => {
                onCreateBranch()
                onClose()
              }}
            >
              <GitBranch size={14} />
              <span>{text('在此创建支线', 'Branch off from here')}</span>
            </button>
          )}

          {hasChildBranches && onToggleExpand && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item"
              onClick={() => {
                onToggleExpand()
                onClose()
              }}
            >
              {isBranchExpanded ? <FolderMinus size={14} /> : <FolderPlus size={14} />}
              <span>
                {isBranchExpanded
                  ? text('折叠支线', 'Collapse branch')
                  : text('展开支线', 'Expand branch')}
              </span>
            </button>
          )}

          <div className="writer-timeline-context-divider" />

          {onEditEvent && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item"
              onClick={() => {
                onEditEvent()
                onClose()
              }}
            >
              <Edit3 size={14} />
              <span>{text('编辑事件', 'Edit event')}</span>
            </button>
          )}

          {onDeleteEvent && (
            <button
              type="button"
              role="menuitem"
              className="writer-timeline-context-item text-red-600 dark:text-red-400"
              onClick={() => {
                onDeleteEvent()
                onClose()
              }}
            >
              <Trash2 size={14} />
              <span>{text('删除事件', 'Delete event')}</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}

