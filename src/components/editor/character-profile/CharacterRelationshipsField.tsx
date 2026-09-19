import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import type { CharacterCard } from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import {
  classifyRelationshipStorage,
  relationshipRepairGuidance,
  relationshipStorageFromEditor,
  relationshipStorageFromRows,
  structuredRelationshipRows,
} from '../../../shared/relationship-presentation'
import {
  persistableRelationshipEdges,
  validateCharacterRelationshipRows,
  type CharacterRelationshipRowDraft,
  type CharacterRelationshipRowIssue,
} from '../../../shared/character-profile-presentation'

interface RelationshipRowDraft extends CharacterRelationshipRowDraft {
  id: string
}

interface CharacterRelationshipsFieldProps {
  card: CharacterCard
  characters: readonly CharacterCard[]
  onStorageChange: (storage: string) => void
}

let relationshipRowSequence = 0

function nextRelationshipRowId(): string {
  relationshipRowSequence += 1
  return `relationship-row-${relationshipRowSequence}`
}

/** 旧文本不在这里解析：它始终走只读文本通道，直到作者显式转换。 */
function structuredRowsFromStorage(value: string): RelationshipRowDraft[] {
  if (classifyRelationshipStorage(value) === 'legacy') return []
  return (structuredRelationshipRows(value) ?? []).map(row => ({ id: nextRelationshipRowId(), ...row }))
}

/**
 * 关系行编辑器。
 *
 * 只有“目标 + 说明”都完整、且不自指/不重复的行才会写回存储，因为角色名单
 * 事务会整体拒绝这类残行。无法解析的旧关系文本不做任何猜测，原样保留在
 * 文本通道里，并提供一次显式的“转为关系行”动作。
 */
export default function CharacterRelationshipsField({
  card,
  characters,
  onStorageChange,
}: CharacterRelationshipsFieldProps) {
  const text = useLocaleStore(state => state.text)
  const locale = useLocaleStore(state => state.locale)
  const legacy = classifyRelationshipStorage(card.relationships) === 'legacy'
  const [rows, setRows] = useState<RelationshipRowDraft[]>(
    () => structuredRowsFromStorage(card.relationships),
  )
  const lastWrittenRef = useRef(card.relationships)

  // 项目重新加载、草稿回滚等外部变更必须以存储为准，避免本地草稿覆盖事实。
  useEffect(() => {
    if (card.relationships === lastWrittenRef.current) return
    lastWrittenRef.current = card.relationships
    setRows(structuredRowsFromStorage(card.relationships))
  }, [card.relationships])

  const knownNames = useMemo(
    () => characters
      .map(character => character.name.trim())
      .filter(name => name && name !== card.name),
    [card.name, characters],
  )
  const knownNameSet = useMemo(() => new Set(knownNames), [knownNames])

  const validations = validateCharacterRelationshipRows(rows, { selfName: card.name })
  const persistableCount = persistableRelationshipEdges(rows, { selfName: card.name }).length

  const commit = (nextRows: RelationshipRowDraft[]) => {
    setRows(nextRows)
    const storage = relationshipStorageFromRows(
      persistableRelationshipEdges(nextRows, { selfName: card.name }),
    )
    lastWrittenRef.current = storage
    if (storage !== card.relationships) onStorageChange(storage)
  }

  const updateRow = (id: string, patch: Partial<CharacterRelationshipRowDraft>) => {
    commit(rows.map(row => (row.id === id ? { ...row, ...patch } : row)))
  }

  const convertedStorage = legacy
    ? relationshipStorageFromEditor(card.relationships, { knownNames, selfName: card.name })
    : card.relationships
  const canConvertLegacy = legacy && convertedStorage !== card.relationships

  const convertLegacy = () => {
    if (!canConvertLegacy) return
    setRows(structuredRowsFromStorage(convertedStorage))
    lastWrittenRef.current = convertedStorage
    onStorageChange(convertedStorage)
  }

  const issueMessage = (issue: CharacterRelationshipRowIssue): string => {
    if (issue === 'missingTarget') return text('请选择关系目标', 'Choose a relationship target')
    if (issue === 'missingRelation') return text('请填写关系说明', 'Describe the relationship')
    if (issue === 'selfTarget') return text('不能与自己建立关系', 'A character cannot relate to itself')
    return text('与上面某一行完全重复，不会保存', 'Identical to another row and will not be saved')
  }

  if (legacy) {
    return (
      <div className="space-y-1.5" data-testid="legacy-relationships">
        <div
          className="rounded-md border px-2.5 py-2 text-[11px] leading-relaxed"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-hover)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {text(
            '这段关系是旧项目里的自由文本，无法解析为结构化关系，将按原样保存。',
            'These relationships are free-form text from an older project. They cannot be parsed as structured relationships and are saved verbatim.',
          )}
        </div>
        <Textarea
          value={card.relationships}
          onChange={(event) => {
            lastWrittenRef.current = event.target.value
            onStorageChange(event.target.value)
          }}
          rows={4}
          aria-label={text('旧版关系文本', 'Legacy relationship text')}
          placeholder={text('原样保留的关系文本', 'Relationship text kept verbatim')}
        />
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {relationshipRepairGuidance(locale)}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!canConvertLegacy}
          onClick={convertLegacy}
          title={canConvertLegacy
            ? text('把“角色：关系”逐行文本转为可编辑的关系行', 'Turn “Character: relationship” lines into editable rows')
            : text('需要每行都是“角色：关系”，且角色名在名单中', 'Every line must read “Character: relationship” with a name from the roster')}
        >
          <Wand2 size={12} /> {text('转为关系行', 'Convert to relationship rows')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {text(`共 ${persistableCount} 条关系`, `${persistableCount} relationships`)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => commit([...rows, { id: nextRelationshipRowId(), target: '', relation: '' }])}
        >
          <Plus size={12} /> {text('添加关系', 'Add relationship')}
        </Button>
      </div>
      {rows.length === 0 && (
        <div className="rounded-md border border-dashed px-2.5 py-3 text-center text-[11px] text-[var(--color-text-muted)]" style={{ borderColor: 'var(--color-border)' }}>
          {text('暂无关系，点击“添加关系”补充', 'No relationships yet. Use “Add relationship”.')}
        </div>
      )}
      {rows.map((row, index) => {
        const validation = validations[index]
        const targetUnknown = Boolean(row.target.trim()) && !knownNameSet.has(row.target.trim())
        return (
          <div key={row.id} className="space-y-1" data-testid="relationship-row">
            <div className="flex items-start gap-1.5">
              <NativeSelect
                value={row.target}
                aria-label={text('关系目标', 'Relationship target')}
                onChange={(event) => updateRow(row.id, { target: event.target.value })}
              >
                <option value="">{text('选择角色…', 'Select a character…')}</option>
                {knownNames.map(name => <option key={name} value={name}>{name}</option>)}
                {row.target.trim() && !knownNameSet.has(row.target.trim()) && (
                  <option value={row.target}>
                    {text(`${row.target}（不在名单中）`, `${row.target} (not in roster)`)}
                  </option>
                )}
              </NativeSelect>
              <Input
                value={row.relation}
                aria-label={text('关系说明', 'Relationship description')}
                placeholder={text('关系说明，例如：竞争对手', 'Description, e.g. rival')}
                onChange={(event) => updateRow(row.id, { relation: event.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                aria-label={text('删除关系', 'Remove relationship')}
                title={text('删除关系', 'Remove relationship')}
                onClick={() => commit(rows.filter(candidate => candidate.id !== row.id))}
              >
                <Trash2 size={13} />
              </Button>
            </div>
            {(validation?.issues.length ?? 0) > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--color-warning-text)' }}>
                {validation!.issues.map(issueMessage).join('；')}
              </p>
            )}
            {targetUnknown && (validation?.issues.length ?? 0) === 0 && (
              <p className="text-[11px]" style={{ color: 'var(--color-warning-text)' }}>
                {text(
                  '该角色不在当前名单中，保存会被角色名单事务拒绝。',
                  'This name is not in the roster; the roster transaction will reject the save.',
                )}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { CharacterRelationshipsField }
export type { CharacterRelationshipsFieldProps }
