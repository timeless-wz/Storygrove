import { useEffect, useState } from 'react'
import { Trash2, Users, X } from 'lucide-react'
import type { CharacterSharedRelationship } from '../../shared/character-relationship'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import '../ui/feedback-surface.css'

/** 弹窗只按稳定人物 ID 提交关系；姓名仅用于标题展示。 */
export interface RelationshipModalCharacter {
  id: string
  name: string
}

export interface RelationshipModalProps {
  open: boolean
  character1: RelationshipModalCharacter
  character2: RelationshipModalCharacter
  initialRelationship?: CharacterSharedRelationship | null
  onClose: () => void
  onSave: (data: { relation: string; description?: string }) => Promise<void>
  onDelete?: () => Promise<void>
}

export default function RelationshipModal({
  open,
  character1,
  character2,
  initialRelationship,
  onClose,
  onSave,
  onDelete,
}: RelationshipModalProps) {
  const text = useLocaleStore(s => s.text)
  const [relation, setRelation] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRelation(initialRelationship?.relation ?? '')
    setDescription(initialRelationship?.description ?? '')
    setError(null)
    setSaving(false)
    setDeleting(false)
  }, [open, initialRelationship])

  if (!open) return null

  const isEdit = Boolean(initialRelationship)

  const handleSave = async () => {
    const trimmedRelation = relation.trim()
    if (!trimmedRelation) {
      setError(text('请填写关系名称', 'Please enter a relationship name'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        relation: trimmedRelation,
        description: description.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="vela-feedback-overlay"
      data-testid="relationship-modal-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? text('编辑人物关系', 'Edit Relationship') : text('建立人物关系', 'Create Relationship')}
        data-testid="relationship-modal"
        className="vela-feedback-panel w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b pb-3 mb-4" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)] mb-1">
              <Users size={14} />
              <span>{character1.name} ↔ {character2.name}</span>
            </div>
            <h3 className="text-base font-bold text-[var(--color-text)]">
              {isEdit ? text('编辑人物关系', 'Edit Relationship') : text('建立人物关系', 'Create Relationship')}
            </h3>
          </div>
          <button
            type="button"
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
            onClick={onClose}
            aria-label={text('关闭', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              <span>{text('关系名称', 'Relationship Name')}</span>
              <span className="ml-0.5" style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <Input
              data-testid="relationship-name-input"
              value={relation}
              onChange={e => {
                setRelation(e.target.value)
                if (error) setError(null)
              }}
              placeholder={text('例如：师徒、盟友、竞争对手、宿敌', 'e.g. Mentor/Apprentice, Ally, Rival')}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSave()
                }
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              <span>{text('关系说明（可选）', 'Description (Optional)')}</span>
            </label>
            <Textarea
              data-testid="relationship-description-input"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={text('补充关系的详细背景或互动脉络...', 'Additional details or background...')}
            />
          </div>

          {error && (
            <div
              data-testid="relationship-error"
              className="rounded-md border px-3 py-2 text-xs"
              style={{
                borderColor: 'var(--color-danger, #ef4444)',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                color: 'var(--color-danger, #ef4444)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-4 mt-5" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            {isEdit && onDelete && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="relationship-delete-button"
                disabled={saving || deleting}
                onClick={() => void handleDelete()}
                className="gap-1 hover:bg-[var(--color-error)]/10"
              >
                <Trash2 size={13} />
                <span>{deleting ? text('删除中...', 'Deleting...') : text('删除关系', 'Delete')}</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="relationship-cancel-button"
              disabled={saving || deleting}
              onClick={onClose}
            >
              {text('取消', 'Cancel')}
            </Button>
            <Button
              variant="default"
              size="sm"
              data-testid="relationship-save-button"
              disabled={saving || deleting || !relation.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
