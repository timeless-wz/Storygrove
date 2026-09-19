import type { CharacterCard, CharacterCurrentState } from '../../../stores/character-store'
import { EMPTY_STATE } from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { Input } from '../../ui/Input'
import { Label } from '../../ui/Label'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import { CHARACTER_ROLES, getCharacterRoleLabels } from '../../../shared/character-role'
import { CHARACTER_STATE_TEXT_FIELDS } from '../../../shared/character-roster'
import {
  CHARACTER_PROFILE_PROVENANCE_LABELS,
  CHARACTER_STATE_FIELD_LABELS,
  characterStateProvenanceKind,
} from '../../../shared/character-profile-presentation'
import CharacterRelationshipsField from './CharacterRelationshipsField'

type CharacterEditableField = Exclude<keyof CharacterCard, 'name'>

interface CharacterProfileFormProps {
  card: CharacterCard
  characters: readonly CharacterCard[]
  identityBusy: boolean
  onRename: (name: string) => void
  onUpdateField: <K extends CharacterEditableField>(key: K, value: CharacterCard[K]) => void
}

/**
 * 完整档案编辑模式：覆盖角色卡的全部原有字段（基础资料、结构化关系与
 * currentState），保存路径与概览完全一致。
 */
export default function CharacterProfileForm({
  card,
  characters,
  identityBusy,
  onRename,
  onUpdateField,
}: CharacterProfileFormProps) {
  const text = useLocaleStore(state => state.text)
  const roleLabel = (role: CharacterCard['role']) => {
    const { zhCN, enUS } = getCharacterRoleLabels(role)
    return text(zhCN, enUS)
  }

  const updateCurrentStateField = (field: typeof CHARACTER_STATE_TEXT_FIELDS[number], value: string) => {
    const nextState: CharacterCurrentState = {
      ...(card.currentState ?? EMPTY_STATE),
      [field]: value,
      provenance: {
        ...card.currentState?.provenance,
        [field]: {
          kind: 'author',
          chapterNumber: card.currentState?.updatedAtChapter ?? 0,
        },
      },
    }
    onUpdateField('currentState', nextState)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-4 space-y-3" data-testid="character-profile-form">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>{text('姓名', 'Name')}</Label>
          <Input value={card.name} disabled={identityBusy} onChange={(event) => onRename(event.target.value)} />
        </div>
        <div>
          <Label>{text('性别', 'Gender')}</Label>
          <Input value={card.gender} onChange={(event) => onUpdateField('gender', event.target.value)} />
        </div>
        <div>
          <Label>{text('年龄', 'Age')}</Label>
          <Input value={card.age} onChange={(event) => onUpdateField('age', event.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{text('定位', 'Role')}</Label>
          <NativeSelect value={card.role} onChange={(event) => onUpdateField('role', event.target.value as CharacterCard['role'])}>
            {CHARACTER_ROLES.map(role => (
              <option key={role} value={role}>{roleLabel(role)}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div>
        <Label>{text('外貌描写', 'Appearance')}</Label>
        <Textarea value={card.appearance} onChange={(event) => onUpdateField('appearance', event.target.value)} rows={3} placeholder={text('输入外貌描写...', 'Describe appearance...')} />
      </div>
      <div>
        <Label>{text('性格特征', 'Personality')}</Label>
        <Textarea value={card.personality} onChange={(event) => onUpdateField('personality', event.target.value)} rows={3} placeholder={text('输入性格特征...', 'Describe personality...')} />
      </div>
      <div>
        <Label>{text('背景故事', 'Background')}</Label>
        <Textarea value={card.background} onChange={(event) => onUpdateField('background', event.target.value)} rows={4} placeholder={text('输入背景故事...', 'Describe background...')} />
      </div>
      <div>
        <Label>{text('能力/技能', 'Abilities / skills')}</Label>
        <Textarea value={card.abilities} onChange={(event) => onUpdateField('abilities', event.target.value)} rows={3} placeholder={text('输入能力/技能...', 'Describe abilities or skills...')} />
      </div>
      <div>
        <Label>{text('核心动机', 'Core motivation')}</Label>
        <Textarea value={card.motivation} onChange={(event) => onUpdateField('motivation', event.target.value)} rows={2} placeholder={text('输入核心动机...', 'Describe core motivation...')} />
      </div>
      <div>
        <Label>{text('关系网', 'Relationships')}</Label>
        <CharacterRelationshipsField
          key={card.name}
          card={card}
          characters={characters}
          onStorageChange={(storage) => onUpdateField('relationships', storage)}
        />
      </div>
      <div>
        <Label>{text('成长轨迹', 'Character arc')}</Label>
        <Textarea value={card.arc} onChange={(event) => onUpdateField('arc', event.target.value)} rows={3} placeholder={text('输入成长轨迹...', 'Describe the character arc...')} />
      </div>
      <div>
        <Label>{text('备注', 'Notes')}</Label>
        <Textarea value={card.notes} onChange={(event) => onUpdateField('notes', event.target.value)} rows={2} placeholder={text('输入备注...', 'Enter notes...')} />
      </div>

      <section
        className="space-y-3 rounded-lg border px-3 py-3"
        style={{ borderColor: 'var(--color-border)' }}
        aria-label={text('当前状态档案', 'Current state profile')}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {text('当前状态档案', 'Current state profile')}
          </h4>
          <span className="text-[0.65rem] text-[var(--color-text-muted)]">
            {text(
              `最后更新：第 ${card.currentState?.updatedAtChapter ?? 0} 章`,
              `Last updated: Chapter ${card.currentState?.updatedAtChapter ?? 0}`,
            )}
          </span>
        </div>
        {CHARACTER_STATE_TEXT_FIELDS.map((field) => {
          const labels = CHARACTER_STATE_FIELD_LABELS[field]
          const provenance = CHARACTER_PROFILE_PROVENANCE_LABELS[
            characterStateProvenanceKind(card.currentState?.provenance?.[field])
          ]
          return (
            <div key={field}>
              <Label>
                {text(labels.zhCN, labels.enUS)}
                <span className="ml-2 text-[0.65rem] font-normal text-[var(--color-text-secondary)]">
                  {text(provenance.zhCN, provenance.enUS)}
                </span>
              </Label>
              <Textarea
                value={card.currentState?.[field]?.toString() ?? ''}
                onChange={(event) => updateCurrentStateField(field, event.target.value)}
                rows={2}
                aria-label={text(labels.zhCN, labels.enUS)}
                placeholder={`${text(labels.zhCN, labels.enUS)}...`}
              />
            </div>
          )
        })}
        {!card.currentState && (
          <div className="rounded-lg p-3 text-[11px] text-[var(--color-text-secondary)]" style={{ backgroundColor: 'var(--color-hover)' }}>
            {text(
              '当前状态档案会在章节定稿后由 AI 自动更新，也可在这里手动填写初始状态。',
              'AI updates this profile after a chapter is finalized. You can also enter an initial state manually.',
            )}
          </div>
        )}
      </section>
    </div>
  )
}
