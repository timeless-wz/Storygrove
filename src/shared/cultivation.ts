import type { CharacterRosterSnapshot } from './character-roster'

export interface CultivationStage { id: string; name: string }
export interface CultivationRealm {
  id: string
  name: string
  /** Stable identity of the complete realm when it has no stages. */
  levelId: string
  stages: CultivationStage[]
}
export interface CultivationSystem { revision: number; realms: CultivationRealm[]; markdown?: string }
export interface CultivationLevel { id: string; realmId: string; stageId: string | null; name: string; number: number }
export interface CultivationSaveRequest {
  expectedRevision: number
  expectedRosterRevision: number
  realms: CultivationRealm[]
  /** Shared power rules and limits in Markdown; optional for old clients. */
  markdown?: string
  /** Missing means unresolved, null means an explicit author-approved unbinding. */
  resolutions: Record<string, string | null>
}
export interface CultivationSaveResult { system: CultivationSystem; roster: CharacterRosterSnapshot }
export const CULTIVATION_PRESETS = [
  { zh: '一到九层', en: 'Layers one to nine', names: ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层'] },
  { zh: '初期到圆满', en: 'Early to perfection', names: ['初期', '中期', '后期', '圆满'] },
  { zh: '入门到圆满', en: 'Entry to perfection', names: ['入门', '小成', '大成', '圆满'] },
  { zh: '无小境界', en: 'No stages', names: [] },
] as const

export function cultivationFullName(realm: string, stage?: string | null): string {
  return stage ? `${realm}·${stage}` : realm
}

export function cultivationLevels(realms: readonly CultivationRealm[]): CultivationLevel[] {
  const levels: CultivationLevel[] = []
  for (const realm of realms) {
    const stages = realm.stages.length ? realm.stages : [{ id: realm.levelId, name: '' }]
    for (const stage of stages) levels.push({
      id: stage.id, realmId: realm.id, stageId: realm.stages.length ? stage.id : null,
      name: cultivationFullName(realm.name, stage.name), number: levels.length + 1,
    })
  }
  return levels
}

export function cultivationLevelAt(realms: readonly CultivationRealm[], input: string): CultivationLevel | undefined {
  if (!/^[1-9]\d*$/.test(input)) return undefined
  const number = Number(input)
  return Number.isSafeInteger(number) ? cultivationLevels(realms)[number - 1] : undefined
}

export function validateCultivationRealms(value: unknown): asserts value is CultivationRealm[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid cultivation realms / 大境界列表无效')
  const identities = new Set<string>()
  const checkId = (id: unknown) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || identities.has(id)) throw new Error('Invalid or duplicate cultivation ID / 等级标识无效或重复')
    identities.add(id)
  }
  const checkName = (name: unknown) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('Realm names must be nonempty / 境界名称不能为空')
  }
  for (const realm of value) {
    if (!realm || typeof realm !== 'object') throw new Error('Invalid realm / 大境界无效')
    checkId(realm.id); checkId(realm.levelId); checkName(realm.name)
    if (!Array.isArray(realm.stages) || realm.stages.length > 500) throw new Error('Invalid stages / 小境界列表无效')
    for (const stage of realm.stages) { checkId(stage?.id); checkName(stage?.name) }
  }
}

export function resolvedCultivationName(character: { cultivationLevelId?: string | null; currentState?: { powerLevel: string } }, realms: readonly CultivationRealm[]): string {
  // An explicit binding is authoritative. If it is dangling or cannot be
  // resolved, never present the legacy free text as the current realm.
  if (character.cultivationLevelId) {
    return cultivationLevels(realms).find(level => level.id === character.cultivationLevelId)?.name ?? ''
  }
  return character.currentState?.powerLevel ?? ''
}
