import { useMemo, useState } from 'react'
import { Link2, PencilLine, Trash2 } from 'lucide-react'
import type { CharacterCard } from '../../../stores/character-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import RelationshipModal from '../RelationshipModal'
import {
  otherCharacterIdInRelationship,
  otherCharacterNameInRelationship,
  type CharacterSharedRelationship,
} from '../../../shared/character-relationship'
import { classifyRelationshipStorage } from '../../../shared/relationship-presentation'

interface CharacterRelationshipsFieldProps {
  card: CharacterCard
  characters: readonly CharacterCard[]
  /** 本角色的稳定 ID；没有 ID（尚未落盘）时不能建立关系。 */
  characterId: string
  /** 与关系画布同源：共享关系表中涉及本角色的记录。 */
  sharedRelationships: readonly CharacterSharedRelationship[]
}

interface ModalState {
  open: boolean
  targetId: string
  targetName: string
  existing: CharacterSharedRelationship | null
}

const CLOSED_MODAL: ModalState = { open: false, targetId: '', targetName: '', existing: null }

/**
 * 编辑档案里的关系入口。
 *
 * 与关系画布读写同一份共享关系表：这里新增、修改、删除都会立刻反映到画布，
 * 不再编辑角色卡里的第二套 relationships JSON。旧字段只作为历史证据展示，
 * 其中的自由文本保持原样，不会被猜测成关系。
 */
export default function CharacterRelationshipsField({
  card,
  characters,
  characterId,
  sharedRelationships,
}: CharacterRelationshipsFieldProps) {
  const text = useLocaleStore(state => state.text)
  const upsertRelationship = useCharacterStore(state => state.upsertRelationship)
  const deleteRelationship = useCharacterStore(state => state.deleteRelationship)
  const [targetName, setTargetName] = useState('')
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL)
  const [busy, setBusy] = useState(false)

  const legacyRelationshipText = classifyRelationshipStorage(card.relationships) === 'legacy'
    ? card.relationships
    : ''

  const rows = useMemo(
    () => sharedRelationships.map(rel => ({
      id: rel.id,
      targetId: otherCharacterIdInRelationship(rel, characterId),
      targetName: otherCharacterNameInRelationship(rel, characterId).trim(),
      relation: rel.relation,
      description: rel.description,
      relationship: rel,
    })),
    [characterId, sharedRelationships],
  )

  const otherCharacters = useMemo(
    () => characters.filter(character => (
      character.name.trim() && character.name.trim() !== card.name.trim()
    )),
    [card.name, characters],
  )

  const resolveCharacterId = (name: string): string => (
    useCharacterStore.getState().characterIdentities[name.trim()] ?? ''
  )

  const openCreateModal = () => {
    const target = otherCharacters.find(character => character.name.trim() === targetName)
    if (!target) return
    // 同一对人物只有一条关系：已有关系时打开编辑，而不是新增重复连线。
    const existing = rows.find(row => row.targetName === target.name.trim())?.relationship ?? null
    setModal({
      open: true,
      targetId: resolveCharacterId(target.name),
      targetName: target.name.trim(),
      existing,
    })
  }

  const handleSave = async (data: { relation: string; description?: string }) => {
    if (!characterId) return
    const targetId = modal.existing
      ? otherCharacterIdInRelationship(modal.existing, characterId)
      : resolveCharacterId(modal.targetName)
    if (!targetId) return
    setBusy(true)
    try {
      await upsertRelationship({
        id: modal.existing?.id,
        character1Id: characterId,
        character2Id: targetId,
        relation: data.relation,
        description: data.description,
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!modal.existing?.id) return
    setBusy(true)
    try {
      await deleteRelationship(modal.existing.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="shared-relationships-field">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {text(`共 ${rows.length} 条关系`, `${rows.length} relationships`)}
        </span>
        <div className="flex items-center gap-1.5">
          <NativeSelect
            value={targetName}
            aria-label={text('关系目标', 'Relationship target')}
            className="h-6 w-32 text-[11px]"
            onChange={event => setTargetName(event.target.value)}
          >
            <option value="">{text('选择角色…', 'Select a character…')}</option>
            {otherCharacters.map(character => (
              <option key={character.name} value={character.name}>{character.name}</option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            disabled={!targetName || !characterId}
            data-testid="shared-relationship-create"
            onClick={openCreateModal}
          >
            <Link2 size={12} /> {text('建立关系', 'Connect')}
          </Button>
        </div>
      </div>

      {!characterId && (
        <p className="text-[11px]" style={{ color: 'var(--color-warning-text)' }}>
          {text('该角色尚未保存，保存后才能建立关系。', 'Save this character before creating relationships.')}
        </p>
      )}

      {rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed px-2.5 py-3 text-center text-[11px] text-[var(--color-text-muted)]"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {text(
            '暂无关系，可在上方选择角色建立，或直接到关系画布连线',
            'No relationships yet. Pick a character above, or connect them on the canvas.',
          )}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(row => (
            <li
              key={row.id}
              data-testid="shared-relationship-row"
              data-target-name={row.targetName}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span className="min-w-0 flex-shrink-0 text-xs font-medium text-[var(--color-text)]">
                {row.targetName || text('未知人物', 'Unknown character')}
              </span>
              <span
                data-testid="shared-relationship-chip"
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                {row.relation}
              </span>
              {row.description && (
                <span
                  className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-muted)]"
                  title={row.description}
                >
                  {row.description}
                </span>
              )}
              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={text('编辑关系', 'Edit relationship')}
                  title={text('编辑关系', 'Edit relationship')}
                  disabled={busy}
                  onClick={() => setModal({
                    open: true,
                    targetId: row.targetId,
                    targetName: row.targetName,
                    existing: row.relationship,
                  })}
                >
                  <PencilLine size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={text('删除关系', 'Remove relationship')}
                  title={text('删除关系', 'Remove relationship')}
                  disabled={busy}
                  onClick={() => { void deleteRelationship(row.id) }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {legacyRelationshipText && (
        <div className="space-y-1.5" data-testid="legacy-relationships">
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {text(
              '旧版关系文本（历史证据，不参与图谱与关系事实）：',
              'Legacy relationship text (historical evidence only; not part of the graph):',
            )}
          </p>
          <Textarea
            value={legacyRelationshipText}
            rows={3}
            readOnly
            aria-label={text('旧版关系文本', 'Legacy relationship text')}
          />
        </div>
      )}

      <RelationshipModal
        open={modal.open}
        character1={{ id: characterId, name: card.name }}
        character2={{ id: modal.targetId, name: modal.targetName }}
        initialRelationship={modal.existing}
        onClose={() => setModal(CLOSED_MODAL)}
        onSave={handleSave}
        onDelete={modal.existing?.id ? handleDelete : undefined}
      />
    </div>
  )
}

export { CharacterRelationshipsField }
export type { CharacterRelationshipsFieldProps }
