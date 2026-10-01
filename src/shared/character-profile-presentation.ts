/**
 * 角色档案的展示模型。
 *
 * 只把已持久化的角色事实投影成概览、列表和表单需要的形状：不新增任何持久化
 * 字段，也不改写 relationships / currentState 的存储形式。无法解析的旧关系
 * 文本一律原样返回，由界面以只读方式呈现，避免静默丢失或错误转换。
 */
import type { CharacterRole } from './character-role'
import type {
  CharacterRosterCharacterState,
  CharacterStateFieldProvenance,
  CharacterStateTextField,
} from './character-roster'
import {
  classifyRelationshipStorage,
  structuredRelationshipRows,
  type RelationshipEdge,
} from './relationship-presentation'

export interface CharacterProfileFieldLabels {
  zhCN: string
  enUS: string
  /** 侧栏等窄空间的短标签。 */
  shortZhCN: string
  shortEnUS: string
}

/** currentState 六个文本字段的唯一文案来源。 */
export const CHARACTER_STATE_FIELD_LABELS: Readonly<
  Record<CharacterStateTextField, CharacterProfileFieldLabels>
> = {
  location: {
    zhCN: '当前位置/阵营',
    enUS: 'Location / faction',
    shortZhCN: '位置',
    shortEnUS: 'Location',
  },
  powerLevel: {
    zhCN: '修为描述（自由文本）',
    enUS: 'Power description (free text)',
    shortZhCN: '修为描述',
    shortEnUS: 'Power description',
  },
  physicalState: {
    zhCN: '身体状态（伤势/BUFF/外貌）',
    enUS: 'Physical state (injuries, effects, appearance)',
    shortZhCN: '身体状态',
    shortEnUS: 'Physical state',
  },
  mentalState: {
    zhCN: '心理状态（愿望/恐惧/心态）',
    enUS: 'Mental state (goals, fears, mindset)',
    shortZhCN: '心理状态',
    shortEnUS: 'Mental state',
  },
  keyItems: {
    zhCN: '关键道具/资源',
    enUS: 'Key items / resources',
    shortZhCN: '关键道具',
    shortEnUS: 'Key items',
  },
  recentEvents: {
    zhCN: '最近重要事件',
    enUS: 'Recent important events',
    shortZhCN: '最近事件',
    shortEnUS: 'Recent events',
  },
}

export type CharacterProfileProvenanceKind = CharacterStateFieldProvenance['kind'] | 'unknown'

export const CHARACTER_PROFILE_PROVENANCE_LABELS: Readonly<
  Record<CharacterProfileProvenanceKind, { zhCN: string; enUS: string }>
> = {
  author: { zhCN: '作者输入', enUS: 'Author input' },
  derived: { zhCN: '定稿派生', enUS: 'Derived from finalized prose' },
  legacy: { zhCN: '旧数据来源', enUS: 'Legacy value' },
  unknown: { zhCN: '来源未知', enUS: 'Unknown source' },
}

/** 字段来源只来自持久化的 provenance；缺失时统一按“来源未知”呈现。 */
export function characterStateProvenanceKind(
  provenance?: CharacterStateFieldProvenance,
): CharacterProfileProvenanceKind {
  return provenance?.kind ?? 'unknown'
}

export interface CharacterProfileSummaryFacts {
  role: CharacterRole
  /** 只包含真正填写过的字面事实；性别/年龄留空时不会出现在摘要里。 */
  facts: Array<{ id: 'gender' | 'age'; value: string }>
}

/**
 * 顶部摘要的字段集合。刻意只读取角色卡已有的 role/gender/age：
 * 正式 faction 字段尚不存在，这里不会凭空造一个。
 */
export function characterProfileSummaryFacts(card: {
  role: CharacterRole
  gender: string
  age: string
}): CharacterProfileSummaryFacts {
  const facts: CharacterProfileSummaryFacts['facts'] = []
  const gender = card.gender.trim()
  const age = card.age.trim()
  if (gender) facts.push({ id: 'gender', value: gender })
  if (age) facts.push({ id: 'age', value: age })
  return { role: card.role, facts }
}

export const CHARACTER_PROFILE_DETAIL_SECTIONS = [
  'appearance',
  'abilities',
  'background',
  'arc',
  'notes',
] as const

export type CharacterProfileDetailSectionId = typeof CHARACTER_PROFILE_DETAIL_SECTIONS[number]

export interface CharacterProfileDetailSection {
  id: CharacterProfileDetailSectionId
  value: string
}

/** 概览里默认折叠的次要字段，顺序即展示顺序。 */
export function characterProfileDetailSections(card: {
  appearance: string
  abilities: string
  background: string
  arc: string
  notes: string
}): CharacterProfileDetailSection[] {
  return CHARACTER_PROFILE_DETAIL_SECTIONS.map(id => ({ id, value: card[id] }))
}

export interface CharacterStateSummary {
  field: CharacterStateTextField
  value: string
}

/**
 * 侧栏列表的一行有用摘要。优先讲“人物现在在哪、刚发生什么”，
 * 而不是只报一个更新章节号。
 */
const CHARACTER_STATE_SUMMARY_PRIORITY: readonly CharacterStateTextField[] = [
  'location',
  'recentEvents',
  'mentalState',
  'physicalState',
  'powerLevel',
  'keyItems',
]

export function selectCharacterStateSummary(
  state?: CharacterRosterCharacterState | null,
): CharacterStateSummary | null {
  if (!state) return null
  for (const field of CHARACTER_STATE_SUMMARY_PRIORITY) {
    const value = state[field]?.trim()
    if (value) return { field, value }
  }
  return null
}

export function truncateProfileText(value: string, maxCharacters = 42): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const characters = Array.from(normalized)
  return characters.length > maxCharacters
    ? `${characters.slice(0, maxCharacters).join('')}…`
    : normalized
}

export interface CharacterRelationshipGroup {
  target: string
  relations: string[]
  /** 目标是否仍能在当前角色名单里解析成一张角色卡。 */
  resolvable: boolean
}

export type CharacterRelationshipPresentation =
  | { kind: 'empty' }
  | { kind: 'structured'; groups: CharacterRelationshipGroup[] }
  /** 无法解析的旧关系文本：原样保留，界面只做只读呈现。 */
  | { kind: 'legacy'; text: string }

export interface CharacterRelationshipPresentationOptions {
  knownNames?: readonly string[]
  selfName?: string
}

/**
 * 把持久化关系投影成“目标人物 + 关系说明”的分组。结构化数据按目标聚合；
 * 旧文本不做任何猜测或转换，整段原样返回。
 */
export function characterRelationshipPresentation(
  value: string,
  options: CharacterRelationshipPresentationOptions = {},
): CharacterRelationshipPresentation {
  if (classifyRelationshipStorage(value) === 'empty') return { kind: 'empty' }
  const rows = structuredRelationshipRows(value)
  if (rows === null) return { kind: 'legacy', text: value }

  // 传入了名单就以名单为准：空名单意味着没有任何可跳转的目标，
  // 而不是“未知所以都可跳转”。
  const knownNames = options.knownNames
    ? new Set(options.knownNames.map(name => name.trim()).filter(Boolean))
    : null
  const selfName = options.selfName?.trim()
  const groups: CharacterRelationshipGroup[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const target = row.target.trim()
    const relation = row.relation.trim()
    const key = `${target}\u0000${relation}`
    if (seen.has(key)) continue
    seen.add(key)
    const existing = groups.find(group => group.target === target)
    if (existing) existing.relations.push(relation)
    else groups.push({
      target,
      relations: [relation],
      resolvable: target !== selfName && (!knownNames || knownNames.has(target)),
    })
  }
  return groups.length > 0 ? { kind: 'structured', groups } : { kind: 'empty' }
}

export interface CharacterRelationshipRowDraft {
  target: string
  relation: string
}

export type CharacterRelationshipRowIssue = 'missingTarget' | 'missingRelation' | 'selfTarget' | 'duplicate'

export interface CharacterRelationshipRowValidation {
  row: CharacterRelationshipRowDraft
  issues: CharacterRelationshipRowIssue[]
  /** 可以把这一行安全提交给角色名单事务。 */
  persistable: boolean
}

/**
 * 行编辑器的校验：角色名单事务会拒绝空目标/空说明、自指与完全重复的关系，
 * 所以这里必须先把不可提交的行筛出来，否则一次保存会整体失败。
 */
export function validateCharacterRelationshipRows(
  rows: readonly CharacterRelationshipRowDraft[],
  options: CharacterRelationshipPresentationOptions = {},
): CharacterRelationshipRowValidation[] {
  const seen = new Set<string>()
  const selfName = options.selfName?.trim()
  return rows.map((row) => {
    const target = row.target.trim()
    const relation = row.relation.trim()
    const issues: CharacterRelationshipRowIssue[] = []
    if (!target) issues.push('missingTarget')
    if (!relation) issues.push('missingRelation')
    if (target && target === selfName) issues.push('selfTarget')
    const key = `${target}\u0000${relation}`
    if (target && relation) {
      if (seen.has(key)) issues.push('duplicate')
      else seen.add(key)
    }
    return { row, issues, persistable: issues.length === 0 }
  })
}

/** 只保留可提交的行；空行是编辑过程中的正常中间态，不会被当成关系提交。 */
export function persistableRelationshipEdges(
  rows: readonly CharacterRelationshipRowDraft[],
  options: CharacterRelationshipPresentationOptions = {},
): RelationshipEdge[] {
  return validateCharacterRelationshipRows(rows, options)
    .filter(validation => validation.persistable)
    .map(validation => ({
      target: validation.row.target.trim(),
      relation: validation.row.relation.trim(),
    }))
}
