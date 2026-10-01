import CharacterCultivationField from './CharacterCultivationField'
import { ChevronDown } from 'lucide-react'
import type { CharacterCard } from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { getCharacterRoleLabels } from '../../../shared/character-role'
import { CHARACTER_STATE_TEXT_FIELDS } from '../../../shared/character-roster'
import {
  CHARACTER_PROFILE_PROVENANCE_LABELS,
  CHARACTER_STATE_FIELD_LABELS,
  characterProfileDetailSections,
  characterProfileSummaryFacts,
  characterStateProvenanceKind,
  type CharacterProfileDetailSectionId,
} from '../../../shared/character-profile-presentation'
import {
  otherCharacterIdInRelationship,
  otherCharacterNameInRelationship,
  type CharacterSharedRelationship,
} from '../../../shared/character-relationship'
import { classifyRelationshipStorage } from '../../../shared/relationship-presentation'

interface CharacterProfileOverviewProps {
  card: CharacterCard
  characters: readonly CharacterCard[]
  /** 本角色的稳定 ID；关系画布与这里读写同一份共享关系表。 */
  characterId: string
  sharedRelationships: readonly CharacterSharedRelationship[]
  onOpenCharacter: (name: string) => void
}

const DETAIL_SECTION_LABELS: Readonly<Record<CharacterProfileDetailSectionId, [string, string]>> = {
  appearance: ['外貌描写', 'Appearance'],
  abilities: ['能力/技能', 'Abilities and skills'],
  background: ['背景故事', 'Background'],
  arc: ['成长轨迹', 'Character arc'],
  notes: ['备注', 'Notes'],
}

/**
 * 概览优先的人物档案：先给可读摘要，完整字段保留在显式编辑模式里。
 * 关系只呈现角色已持久化的事实，不在这里生成任何新的关系数据。
 */
export default function CharacterProfileOverview({
  card,
  characters,
  characterId,
  sharedRelationships,
  onOpenCharacter,
}: CharacterProfileOverviewProps) {
  const text = useLocaleStore(state => state.text)
  const roleLabels = getCharacterRoleLabels(card.role)
  const summary = characterProfileSummaryFacts(card)
  const knownNames = new Set(characters.map(character => character.name.trim()))
  /*
   * 关系只来自共享关系表。角色卡里的旧 relationships 字段仅剩历史证据：
   * 无法解析的自由文本原样展示，解析得出的关系一律不再当作第二条事实源。
   */
  const relatedCharacters = sharedRelationships.map(rel => {
    const targetName = otherCharacterNameInRelationship(rel, characterId).trim()
    return {
      id: otherCharacterIdInRelationship(rel, characterId),
      targetName,
      relation: rel.relation,
      description: rel.description,
      resolvable: Boolean(targetName) && knownNames.has(targetName),
    }
  })
  const hasSharedRelationships = relatedCharacters.length > 0
  const legacyRelationshipText = classifyRelationshipStorage(card.relationships) === 'legacy'
    ? card.relationships.trim()
    : ''
  const stateFields = CHARACTER_STATE_TEXT_FIELDS
    .map(field => ({ field, value: card.currentState?.[field]?.trim() ?? '' }))
    .filter(entry => entry.value)

  return (
    <div className="max-w-2xl mx-auto px-6 py-4 space-y-4">
      <header
        className="rounded-lg border px-3 py-2.5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
        data-testid="character-summary"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-bold text-[var(--color-text)]">
            {card.name || text('未命名角色', 'Untitled character')}
          </h3>
        </div>
        <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <dt className="text-[var(--color-text-muted)]">{text('定位', 'Role')}</dt>
            <dd className="font-medium text-[var(--color-accent)]">{text(roleLabels.zhCN, roleLabels.enUS)}</dd>
          </div>
          {summary.facts.map(fact => (
            <div key={fact.id} className="flex items-center gap-1.5">
              <dt className="text-[var(--color-text-muted)]">
                {fact.id === 'gender' ? text('性别', 'Gender') : text('年龄', 'Age')}
              </dt>
              <dd className="text-[var(--color-text)]">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <CharacterCultivationField card={card} />

      <ProfileSection title={text('核心动机', 'Core motivation')}>
        {card.motivation.trim()
          ? <p className="whitespace-pre-wrap">{card.motivation}</p>
          : <MissingValue />}
      </ProfileSection>

      <ProfileSection title={text('性格特征与弱点', 'Personality and weaknesses')}>
        {card.personality.trim()
          ? <p className="whitespace-pre-wrap">{card.personality}</p>
          : <MissingValue />}
      </ProfileSection>

      <ProfileSection
        title={text('当前状态', 'Current state')}
        aside={card.currentState && card.currentState.updatedAtChapter > 0
          ? text(`第 ${card.currentState.updatedAtChapter} 章更新`, `Updated in chapter ${card.currentState.updatedAtChapter}`)
          : undefined}
      >
        {stateFields.length > 0 ? (
          <dl className="space-y-1.5">
            {stateFields.map(({ field, value }) => {
              const labels = CHARACTER_STATE_FIELD_LABELS[field]
              const provenance = CHARACTER_PROFILE_PROVENANCE_LABELS[
                characterStateProvenanceKind(card.currentState?.provenance?.[field])
              ]
              return (
                <div key={field} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-[var(--color-text-muted)]">{text(labels.zhCN, labels.enUS)}</dt>
                  <dd className="min-w-0 flex-1 whitespace-pre-wrap">{value}</dd>
                  <span
                    className="rounded border px-1 py-0.5 text-[0.65rem] text-[var(--color-text-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    {text(provenance.zhCN, provenance.enUS)}
                  </span>
                </div>
              )
            })}
          </dl>
        ) : (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {text(
              '当前状态档案将在章节定稿后由 AI 自动更新，也可在编辑档案里手动填写。',
              'This profile updates automatically after a chapter is finalized. You can also fill it in via Edit profile.',
            )}
          </p>
        )}
      </ProfileSection>

      <ProfileSection
        title={text('关系', 'Relationships')}
        aside={hasSharedRelationships
          ? text(`${relatedCharacters.length} 位关联人物`, `${relatedCharacters.length} associated characters`)
          : undefined}
      >
        {!hasSharedRelationships && !legacyRelationshipText && (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {text('尚未填写关系，可在关系画布或编辑档案里补充。', 'No relationships yet. Add them in relationship canvas or Edit profile.')}
          </p>
        )}
        {hasSharedRelationships && (
          <ul className="space-y-2">
            {relatedCharacters.map(row => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {row.resolvable ? (
                  <button
                    type="button"
                    data-testid="relationship-target"
                    className="rounded font-semibold text-[var(--color-accent)] underline-offset-2 hover:underline"
                    title={text(`打开「${row.targetName}」的人物卡`, `Open the character card for “${row.targetName}”`)}
                    onClick={() => onOpenCharacter(row.targetName)}
                  >
                    {row.targetName}
                  </button>
                ) : (
                  <span className="font-medium" style={{ color: 'var(--color-warning-text)' }}>
                    {row.targetName || text('未知人物', 'Unknown character')}
                    <span className="ml-1 text-[0.65rem] font-normal">
                      {text('（不在名单中）', '(not in roster)')}
                    </span>
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span
                    data-testid="relationship-chip"
                    className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-hover)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {row.relation}
                  </span>
                  {row.description && (
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      {row.description}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {legacyRelationshipText && (
          <div className={hasSharedRelationships ? 'mt-2 space-y-1.5' : 'space-y-1.5'} data-testid="overview-legacy-relationships">
            <p className="text-[11px] text-[var(--color-text-muted)]">
              {text(
                '旧版关系文本，未解析，已按原样保留。',
                'Legacy relationship text, unparsed and preserved verbatim.',
              )}
            </p>
            <pre
              className="overflow-x-auto whitespace-pre-wrap rounded-md border px-2.5 py-2 text-[11px]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {legacyRelationshipText}
            </pre>
          </div>
        )}
      </ProfileSection>

      <div className="space-y-1.5">
        {characterProfileDetailSections(card).map((section) => {
          const [zhCN, enUS] = DETAIL_SECTION_LABELS[section.id]
          const value = section.value.trim()
          return (
            <details
              key={section.id}
              data-testid="profile-detail-section"
              data-section={section.id}
              className="group rounded-lg border"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <summary
                data-testid="profile-detail-summary"
                className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-text)]"
              >
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className="flex-shrink-0 transition-transform duration-150 group-open:rotate-180"
                />
                <span className="min-w-0 flex-1 break-words">{text(zhCN, enUS)}</span>
                {/*
                 * 折叠行只报告“有没有内容”，正文一律留在标题下方，
                 * 避免同一段文字在标题右侧和正文里各出现一次。
                 */}
                {!value && (
                  <span className="flex-shrink-0 text-[11px] font-normal text-[var(--color-text-muted)]">
                    {text('未填写', 'Not filled in')}
                  </span>
                )}
              </summary>
              <div
                data-testid="profile-detail-body"
                className="min-w-0 px-3 pb-3 text-xs text-[var(--color-text-secondary)]"
              >
                {value ? (
                  /*
                   * 换行必须由容器负责：长文本（含无空格长串）在卡片内换行，
                   * 不产生横向溢出，也不与标题行混排。这里用内联样式而不是
                   * 工具类，保证正文的换行行为不依赖样式表是否加载。
                   */
                  <p
                    data-testid="profile-detail-text"
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, minWidth: 0 }}
                  >
                    {value}
                  </p>
                ) : (
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {text('未填写', 'Not filled in')}
                  </p>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function ProfileSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-[var(--color-text)]">{title}</h4>
        {aside && <span className="text-[0.65rem] text-[var(--color-text-muted)]">{aside}</span>}
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">{children}</div>
    </section>
  )
}

function MissingValue() {
  const text = useLocaleStore(state => state.text)
  return (
    <p className="text-[11px] text-[var(--color-text-muted)]">
      {text('未填写，可在编辑档案里补充。', 'Not filled in yet. Add it via Edit profile.')}
    </p>
  )
}
