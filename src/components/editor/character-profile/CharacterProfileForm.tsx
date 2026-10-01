import CharacterCultivationField from './CharacterCultivationField'
import { Sparkles, BookOpen, Users, Activity } from 'lucide-react'
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
import type { CharacterSharedRelationship } from '../../../shared/character-relationship'
import { characterRoleColors } from '../../characters/character-role-colors'

type CharacterEditableField = Exclude<keyof CharacterCard, 'name'>

interface CharacterProfileFormProps {
  card: CharacterCard
  characters: readonly CharacterCard[]
  /** 本角色的稳定 ID 与共享关系：关系入口与画布同源。 */
  characterId: string
  sharedRelationships: readonly CharacterSharedRelationship[]
  identityBusy: boolean
  onRename: (name: string) => void
  onUpdateField: <K extends CharacterEditableField>(key: K, value: CharacterCard[K]) => void
}

/**
 * 完整档案编辑模式：按模块化 Bento 卡片组织，覆盖角色卡的全部字段
 * （基础资料、人物特质、生平背景、结构化关系与 currentState）。
 */
export default function CharacterProfileForm({
  card,
  characters,
  characterId,
  sharedRelationships,
  identityBusy,
  onRename,
  onUpdateField,
}: CharacterProfileFormProps) {
  const text = useLocaleStore(state => state.text)
  const roleLabel = (role: CharacterCard['role']) => {
    const { zhCN, enUS } = getCharacterRoleLabels(role)
    return text(zhCN, enUS)
  }

  const roleStyle = characterRoleColors(card.role)
  const initialLetter = card.name?.trim() ? card.name.trim().charAt(0) : '?'

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
    <div className="max-w-4xl mx-auto px-6 py-5 space-y-4" data-testid="character-profile-form">
      <CharacterCultivationField card={card} onChange={id => onUpdateField('cultivationLevelId', id)} />
      {/* 基础身份卡片 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-editor-bg)]/80 p-4 space-y-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base border flex-shrink-0 select-none shadow-xs"
            style={roleStyle}
          >
            {initialLetter}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {card.name || text('未命名角色', 'Untitled Character')}
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border" style={roleStyle}>
                {roleLabel(card.role)}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              {text('基础身份信息与角色定位设定', 'Basic identity information and character role settings')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label htmlFor="character-profile-name">{text('姓名', 'Name')}</Label>
            <Input
              id="character-profile-name"
              value={card.name}
              disabled={identityBusy}
              aria-label={text('姓名', 'Name')}
              onChange={(event) => onRename(event.target.value)}
              placeholder={text('角色姓名...', 'Character name...')}
            />
          </div>
          <div>
            <Label htmlFor="character-profile-role">{text('定位', 'Role')}</Label>
            <NativeSelect
              id="character-profile-role"
              value={card.role}
              aria-label={text('定位', 'Role')}
              onChange={(event) => onUpdateField('role', event.target.value as CharacterCard['role'])}
            >
              {CHARACTER_ROLES.map(role => (
                <option key={role} value={role}>{roleLabel(role)}</option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="character-profile-gender">{text('性别', 'Gender')}</Label>
            <Input
              id="character-profile-gender"
              value={card.gender}
              aria-label={text('性别', 'Gender')}
              onChange={(event) => onUpdateField('gender', event.target.value)}
              placeholder={text('如：男/女/未知', 'e.g. Male / Female')}
            />
          </div>
          <div>
            <Label htmlFor="character-profile-age">{text('年龄', 'Age')}</Label>
            <Input
              id="character-profile-age"
              value={card.age}
              aria-label={text('年龄', 'Age')}
              onChange={(event) => onUpdateField('age', event.target.value)}
              placeholder={text('如：24岁', 'e.g. 24')}
            />
          </div>
        </div>
      </div>

      {/* 人物特质与动机 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-editor-bg)]/80 p-4 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
          <Sparkles size={14} className="text-[var(--color-warning-text)]" />
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {text('特质与动机', 'Traits and Motivation')}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label htmlFor="character-profile-appearance">{text('外貌描写', 'Appearance')}</Label>
              <Textarea
                id="character-profile-appearance"
                aria-label={text('外貌描写', 'Appearance')}
                value={card.appearance}
                onChange={(event) => onUpdateField('appearance', event.target.value)}
                rows={3}
                placeholder={text('输入外貌特征、衣着神态、特殊体貌...', 'Describe appearance, clothing, mannerisms...')}
              />
            </div>
            <div>
              <Label htmlFor="character-profile-personality">{text('性格特征', 'Personality')}</Label>
              <Textarea
                id="character-profile-personality"
                aria-label={text('性格特征', 'Personality')}
                value={card.personality}
                onChange={(event) => onUpdateField('personality', event.target.value)}
                rows={3}
                placeholder={text('输入性格特质、处事风格、行为倾向...', 'Describe personality traits, behavior style...')}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="character-profile-motivation">{text('核心动机', 'Core motivation')}</Label>
              <Textarea
                id="character-profile-motivation"
                aria-label={text('核心动机', 'Core motivation')}
                value={card.motivation}
                onChange={(event) => onUpdateField('motivation', event.target.value)}
                rows={3}
                placeholder={text('推动角色行动的根本动力与核心诉求...', 'What drives this character...')}
              />
            </div>
            <div>
              <Label htmlFor="character-profile-arc">{text('成长轨迹', 'Character arc')}</Label>
              <Textarea
                id="character-profile-arc"
                aria-label={text('成长轨迹', 'Character arc')}
                value={card.arc}
                onChange={(event) => onUpdateField('arc', event.target.value)}
                rows={3}
                placeholder={text('输入心路历程、人物转变与成长弧光...', 'Describe the character arc, transformation...')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 生平与能力 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-editor-bg)]/80 p-4 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
          <BookOpen size={14} className="text-[var(--color-info)]" />
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {text('生平与能力', 'Lore and Abilities')}
          </h4>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="character-profile-background">{text('背景故事', 'Background')}</Label>
            <Textarea
              id="character-profile-background"
              aria-label={text('背景故事', 'Background')}
              value={card.background}
              onChange={(event) => onUpdateField('background', event.target.value)}
              rows={4}
              placeholder={text('输入背景出身、过往经历、关键过往事件...', 'Describe background story, origins, history...')}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="character-profile-abilities">{text('能力/技能', 'Abilities / skills')}</Label>
              <Textarea
                id="character-profile-abilities"
                aria-label={text('能力/技能', 'Abilities and skills')}
                value={card.abilities}
                onChange={(event) => onUpdateField('abilities', event.target.value)}
                rows={3}
                placeholder={text('输入功法、技能、超能力或专长...', 'Describe abilities, martial arts, skills...')}
              />
            </div>
            <div>
              <Label htmlFor="character-profile-notes">{text('备注', 'Notes')}</Label>
              <Textarea
                id="character-profile-notes"
                aria-label={text('备注', 'Notes')}
                value={card.notes}
                onChange={(event) => onUpdateField('notes', event.target.value)}
                rows={3}
                placeholder={text('作者私人创作备忘、伏笔、隐藏线索...', 'Author notes, foreshadowing, hints...')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 关系网 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-editor-bg)]/80 p-4 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
          <Users size={14} className="text-[var(--color-accent-text)]" />
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {text('人际关系网', 'Relationships')}
          </h4>
        </div>
        <CharacterRelationshipsField
          card={card}
          characters={characters}
          characterId={characterId}
          sharedRelationships={sharedRelationships}
        />
      </div>

      {/* 动态当前状态档案 */}
      <section
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-editor-bg)]/80 p-4 space-y-4 shadow-xs"
        aria-label={text('当前状态档案', 'Current state profile')}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-[var(--color-success-text)]" />
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {text('当前状态档案', 'Current state profile')}
            </h4>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
            {text(
              `最后更新：第 ${card.currentState?.updatedAtChapter ?? 0} 章`,
              `Last updated: Chapter ${card.currentState?.updatedAtChapter ?? 0}`,
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CHARACTER_STATE_TEXT_FIELDS.map((field) => {
            const labels = CHARACTER_STATE_FIELD_LABELS[field]
            const provenance = CHARACTER_PROFILE_PROVENANCE_LABELS[
              characterStateProvenanceKind(card.currentState?.provenance?.[field])
            ]
            return (
              <div key={field} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    {text(labels.zhCN, labels.enUS)}
                  </Label>
                  <span className="text-[10px] text-[var(--color-text-secondary)] font-normal">
                    {text(provenance.zhCN, provenance.enUS)}
                  </span>
                </div>
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
        </div>

        {!card.currentState && (
          <div className="rounded-lg p-3 text-xs text-[var(--color-text-secondary)] border border-dashed border-[var(--color-border)]" style={{ backgroundColor: 'var(--color-hover)' }}>
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
