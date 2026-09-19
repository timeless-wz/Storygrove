export const CHARACTER_ROLES = [
  'protagonist',
  'antagonist',
  'supporting',
  'minor',
  /**
   * 尚未决定定位。它是显式的持久化值，专门用来避免“没选定位就等于配角”：
   * 新建角色默认落在这里，历史数据里的 supporting 不会被改写。
   */
  'unassigned',
] as const

export type CharacterRole = typeof CHARACTER_ROLES[number]

export interface CharacterRoleLabels {
  zhCN: string
  enUS: string
}

/**
 * 定位标签的唯一来源。`minor` 的持久化键保持不变（历史数据原样可读），
 * 展示文案统一为“其他”，与新建浮层给出的五个选项一一对应。
 */
export const CHARACTER_ROLE_LABELS: Readonly<Record<CharacterRole, CharacterRoleLabels>> = {
  protagonist: { zhCN: '主角', enUS: 'Protagonist' },
  antagonist: { zhCN: '反派', enUS: 'Antagonist' },
  supporting: { zhCN: '配角', enUS: 'Supporting character' },
  minor: { zhCN: '其他', enUS: 'Other' },
  unassigned: { zhCN: '暂未设定', enUS: 'Not set yet' },
}

/** 新建角色在作者未选择定位时使用的值；绝不能默认成配角。 */
export const DEFAULT_CHARACTER_CREATION_ROLE: CharacterRole = 'unassigned'

const CHARACTER_ROLE_ALIASES: Readonly<Record<string, CharacterRole>> = {
  protagonist: 'protagonist',
  main: 'protagonist',
  主角: 'protagonist',
  男主: 'protagonist',
  女主: 'protagonist',
  核心主角: 'protagonist',
  antagonist: 'antagonist',
  villain: 'antagonist',
  反派: 'antagonist',
  对手: 'antagonist',
  敌人: 'antagonist',
  supporting: 'supporting',
  support: 'supporting',
  配角: 'supporting',
  重要配角: 'supporting',
  核心配角: 'supporting',
  minor: 'minor',
  龙套: 'minor',
  次要角色: 'minor',
  其他: 'minor',
  其它: 'minor',
  unassigned: 'unassigned',
  暂未设定: 'unassigned',
  未设定: 'unassigned',
  待定: 'unassigned',
}

/**
 * Normalize persisted or external role values before they enter application state.
 * Unknown legacy values deliberately fall back to the least surprising editable role.
 */
export function normalizeCharacterRole(value: unknown): CharacterRole {
  if (typeof value !== 'string') return 'supporting'
  const candidate = value.trim()
  return CHARACTER_ROLE_ALIASES[candidate]
    ?? CHARACTER_ROLE_ALIASES[candidate.toLowerCase()]
    ?? 'supporting'
}

/** Locale-neutral display data for renderer consumers. */
export function getCharacterRoleLabels(value: unknown): CharacterRoleLabels {
  return CHARACTER_ROLE_LABELS[normalizeCharacterRole(value)]
}
