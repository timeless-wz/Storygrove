import { useEffect, useRef } from 'react'
import {
  Edit3,
  FolderMinus,
  FolderPlus,
  GitBranch,
  Plus,
  Trash2,
} from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'

export interface TimelineContextMenuProps {
  x: number
  y: number
  targetEventId?: string | null
  hasChildBranches?: boolean
  isBranchExpanded?: boolean
  onClose: () => void
  onCreateMainEvent: () => void
  onCreateNextEvent?: () => void
  onCreateBranch?: () => void
  onToggleExpand?: () => void
  onEditEvent?: () => void
  onDeleteEvent?: () => void
}

export function TimelineContextMenu({
  x,
  y,
  targetEventId,
  hasChildBranches,
  isBranchExpanded,
  onClose,
  onCreateMainEvent,
  onCreateNextEvent,
  onCreateBranch,
  onToggleExpand,
  onEditEvent,
  onDeleteEvent,
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
  const menuWidth = 190
  const menuHeight = targetEventId ? 220 : 60
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
      {!targetEventId ? (
        // 右键空白画布
        <button
          type="button"
          role="menuitem"
          className="writer-timeline-context-item"
          onClick={() => {
            onCreateMainEvent()
            onClose()
          }}
        >
          <Plus size={14} />
          <span>{text('新建主线事件', 'New main event')}</span>
        </button>
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
