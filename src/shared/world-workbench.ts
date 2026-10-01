/**
 * 多世界资料管理（World Workbench）共享契约。
 *
 * 事实源规则：
 * - 所有世界资料只存在于 SQLite（`.vela/vela.db`），本文件只是跨进程数据形状。
 * - 「世界」是小说设定实体，「地图」是世界中某一层空间的展示。两者不是同一个
 *   ID，也不是一对一关系：一个世界可以没有地图，也可以有多张地图；一张地图
 *   最多归属一个世界，旧地图允许暂未关联世界。
 * - 地点继续复用既有 `world_map_nodes`，通过地图归属推导所属世界，绝不重建
 *   第二套同名地点事实。
 * - 人物 ID 复用 `character_identities.character_id`，地点 ID 复用
 *   `world_map_nodes.id`，事件 ID 复用 `story_timeline_events.id`。
 */
import type { StoryTimelinePrecision } from './story-timeline'

export const WORLD_WORKBENCH_SCHEMA_VERSION = 1 as const

const ENTITY_ID = /^[a-z]+-[0-9a-f-]{36}$/iu

/** 世界实体 ID 直接参与引用校验，写入前必须通过严格格式校验。 */
export function isSafeWorldEntityId(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}-[0-9a-f-]{36}$`, 'iu').test(value)
}

function randomUuidV4(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type WorldEntityKind =
  | 'world'
  | 'faction'
  | 'relic'
  | 'portal'
  | 'rule'
  | 'trail'
  | 'character-link'
  | 'character-location'
  | 'event-link'

const ID_PREFIX: Record<WorldEntityKind, string> = {
  world: 'world',
  faction: 'wfact',
  relic: 'wrelic',
  portal: 'wportal',
  rule: 'wrule',
  trail: 'wtrail',
  'character-link': 'wchlink',
  'character-location': 'wchloc',
  'event-link': 'wevlink',
}

export function createWorldEntityId(kind: WorldEntityKind): string {
  return `${ID_PREFIX[kind]}-${randomUuidV4()}`
}

export function isSafeEntityIdOfKind(value: unknown, kind: WorldEntityKind): value is string {
  return isSafeWorldEntityId(value, ID_PREFIX[kind])
}

/** 关系表的行 ID 也使用稳定 ID，便于删除与审计。 */
export function createWorldRelationId(prefix: string): string {
  return `${prefix}-${randomUuidV4()}`
}

export function isSafeRelationId(value: unknown, prefix: string): value is string {
  return isSafeWorldEntityId(value, prefix)
}

export { ENTITY_ID as WORLD_ENTITY_ID_PATTERN }

// ============================================================
// 5.1 世界
// ============================================================

export interface WorldRecord {
  id: string
  name: string
  summary: string
  background: string
  notes: string
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

// ============================================================
// 4. 世界 ↔ 地图归属
// ============================================================

/**
 * 地图的世界归属。一张地图最多归属一个世界；未关联世界的地图不会出现在这里。
 * 归属变更必须经过 `planMapWorldAssignment` 的影响预览，不得静默搬移。
 */
export interface WorldMapWorldLink {
  mapId: string
  worldId: string
  updatedAt?: string
}

/** 地图归属变更的影响预览：blockers 非空时仓库拒绝写入。 */
export interface WorldMapAssignmentPlan {
  mapId: string
  /** null 表示解除归属。 */
  nextWorldId: string | null
  /** 随本次归属变更一起改归属的子孙地图（同一次显式操作，绝不静默）。 */
  descendantMapIds: string[]
  blockers: WorldDeleteBlocker[]
}

// ============================================================
// 5.2 势力
// ============================================================

export const WORLD_FACTION_RELATIONS = ['ally', 'hostile', 'subordinate', 'branch', 'custom'] as const
export type WorldFactionRelationKind = typeof WORLD_FACTION_RELATIONS[number]

/** 对称关系只存一次；有向关系保存方向。 */
export const WORLD_FACTION_SYMMETRIC_RELATIONS: ReadonlySet<string> = new Set(['ally', 'hostile'])

export const WORLD_FACTION_RELATION_LABELS: Record<WorldFactionRelationKind, { zh: string; en: string }> = {
  ally: { zh: '结盟', en: 'Alliance' },
  hostile: { zh: '敌对', en: 'Hostility' },
  subordinate: { zh: '附属', en: 'Subordinate' },
  branch: { zh: '分支', en: 'Branch' },
  custom: { zh: '自定义', en: 'Custom' },
}

export interface WorldFaction {
  id: string
  /** 势力默认只有一个所属世界。 */
  worldId: string
  name: string
  /** 宗门 / 家族 / 国家 / 组织 等，可自定义。 */
  type: string
  summary: string
  description: string
  /** 驻地（文字描述）。 */
  seat: string
  /** 控制范围的文字说明；控制地点集合是结构化字段。 */
  domainNote: string
  notes: string
  createdAt?: string
  updatedAt?: string
}

/** 势力控制/驻地地点；地点必须归属该势力所属世界的地图。 */
export interface WorldFactionPlace {
  id: string
  factionId: string
  nodeId: string
  note: string
  createdAt?: string
}

export interface WorldFactionRelation {
  id: string
  /** 归属世界取 fromFaction 的所属世界，用于世界内列表过滤。 */
  worldId: string
  fromFactionId: string
  toFactionId: string
  relation: WorldFactionRelationKind
  /** relation 为 custom 时的展示文本。 */
  customLabel: string
  directed: boolean
  note: string
  createdAt?: string
  updatedAt?: string
}

/** 势力 ↔ 人物的身份关系，如宗主 / 成员 / 弟子 / 叛徒。 */
export interface WorldFactionCharacter {
  id: string
  factionId: string
  /** 稳定人物 ID（character_identities.character_id）。 */
  characterId: string
  relation: string
  /** 任职时间说明；允许未设定。 */
  tenureNote: string
  note: string
  createdAt?: string
}

// ============================================================
// 5.3 秘境
// ============================================================

export const WORLD_RELIC_STATUSES = ['undiscovered', 'sealed', 'opening', 'open', 'collapsed', 'custom'] as const
export type WorldRelicStatus = typeof WORLD_RELIC_STATUSES[number]

export const WORLD_RELIC_STATUS_LABELS: Record<WorldRelicStatus, { zh: string; en: string }> = {
  undiscovered: { zh: '未发现', en: 'Undiscovered' },
  sealed: { zh: '封闭', en: 'Sealed' },
  opening: { zh: '即将开启', en: 'Opening soon' },
  open: { zh: '开放', en: 'Open' },
  collapsed: { zh: '崩毁', en: 'Collapsed' },
  custom: { zh: '自定义', en: 'Custom' },
}

export interface WorldRelic {
  id: string
  /** 秘境默认只有一个所属世界。 */
  worldId: string
  name: string
  type: string
  summary: string
  description: string
  /** 位置说明（文字）。 */
  locationNote: string
  /** 秘境本体所在的地图地点（可选）。 */
  nodeId: string | null
  /** 入口地点（可选，可与本体地点不同）。 */
  entranceNodeId: string | null
  entryCondition: string
  danger: string
  rewards: string
  /** 开放时间说明：作者维护的设定，不按电脑时间自动开启或关闭。 */
  availabilityNote: string
  status: WorldRelicStatus
  customStatusLabel: string
  notes: string
  createdAt?: string
  updatedAt?: string
}

export const WORLD_RELIC_FACTION_RELATIONS = ['control', 'contest', 'guard', 'discover', 'visited', 'custom'] as const
export type WorldRelicFactionRelation = typeof WORLD_RELIC_FACTION_RELATIONS[number]

export const WORLD_RELIC_FACTION_RELATION_LABELS: Record<WorldRelicFactionRelation, { zh: string; en: string }> = {
  control: { zh: '掌控', en: 'Controls' },
  contest: { zh: '争夺', en: 'Contests' },
  guard: { zh: '守护', en: 'Guards' },
  discover: { zh: '发现', en: 'Discovered' },
  visited: { zh: '曾进入', en: 'Has entered' },
  custom: { zh: '自定义', en: 'Custom' },
}

export interface WorldRelicFaction {
  id: string
  relicId: string
  factionId: string
  relation: WorldRelicFactionRelation
  customLabel: string
  note: string
  createdAt?: string
}

export const WORLD_RELIC_CHARACTER_RELATIONS = ['guard', 'discover', 'visited', 'control', 'custom'] as const
export type WorldRelicCharacterRelation = typeof WORLD_RELIC_CHARACTER_RELATIONS[number]

export const WORLD_RELIC_CHARACTER_RELATION_LABELS: Record<WorldRelicCharacterRelation, { zh: string; en: string }> = {
  guard: { zh: '守护', en: 'Guards' },
  discover: { zh: '发现', en: 'Discovered' },
  visited: { zh: '曾进入', en: 'Has entered' },
  control: { zh: '掌控', en: 'Controls' },
  custom: { zh: '自定义', en: 'Custom' },
}

export interface WorldRelicCharacter {
  id: string
  relicId: string
  characterId: string
  relation: WorldRelicCharacterRelation
  customLabel: string
  note: string
  createdAt?: string
}

// ============================================================
// 5.6 世界之间的通道
// ============================================================

export const WORLD_PORTAL_TYPES = ['teleport', 'ascension', 'rift', 'custom'] as const
export type WorldPortalType = typeof WORLD_PORTAL_TYPES[number]

export const WORLD_PORTAL_TYPE_LABELS: Record<WorldPortalType, { zh: string; en: string }> = {
  teleport: { zh: '传送阵', en: 'Teleport array' },
  ascension: { zh: '飞升通道', en: 'Ascension passage' },
  rift: { zh: '裂隙', en: 'Rift' },
  custom: { zh: '自定义', en: 'Custom' },
}

export const WORLD_PORTAL_STATUSES = ['active', 'sealed', 'unstable', 'destroyed', 'custom'] as const
export type WorldPortalStatus = typeof WORLD_PORTAL_STATUSES[number]

export const WORLD_PORTAL_STATUS_LABELS: Record<WorldPortalStatus, { zh: string; en: string }> = {
  active: { zh: '通行', en: 'Passable' },
  sealed: { zh: '封闭', en: 'Sealed' },
  unstable: { zh: '不稳定', en: 'Unstable' },
  destroyed: { zh: '已毁', en: 'Destroyed' },
  custom: { zh: '自定义', en: 'Custom' },
}

/**
 * 世界之间的通道。它是独立业务实体，绝不通过放开 WorldMapEdge 的跨地图限制实现。
 * 两个端点世界必须不同；端点地点必须归属各自选定的世界。
 */
export interface WorldPortal {
  id: string
  name: string
  type: WorldPortalType
  customTypeLabel: string
  fromWorldId: string
  toWorldId: string
  /** 起点世界的入口地点；未设定时表示世界级通道。 */
  fromNodeId: string | null
  /** 终点世界的出口地点；未设定时表示世界级通道。 */
  toNodeId: string | null
  /** false 表示单向通道：只有 from → to 可通行。 */
  bidirectional: boolean
  condition: string
  cost: string
  scheduleNote: string
  status: WorldPortalStatus
  customStatusLabel: string
  description: string
  notes: string
  createdAt?: string
  updatedAt?: string
}

export const WORLD_PORTAL_FACTION_RELATIONS = ['control', 'guard', 'contest', 'custom'] as const
export type WorldPortalFactionRelation = typeof WORLD_PORTAL_FACTION_RELATIONS[number]

export const WORLD_PORTAL_FACTION_RELATION_LABELS: Record<WorldPortalFactionRelation, { zh: string; en: string }> = {
  control: { zh: '控制', en: 'Controls' },
  guard: { zh: '守护', en: 'Guards' },
  contest: { zh: '争夺', en: 'Contests' },
  custom: { zh: '自定义', en: 'Custom' },
}

export interface WorldPortalFaction {
  id: string
  portalId: string
  factionId: string
  relation: WorldPortalFactionRelation
  customLabel: string
  note: string
  createdAt?: string
}

export const WORLD_PORTAL_CHARACTER_RELATIONS = ['guard', 'control', 'creator', 'custom'] as const
export type WorldPortalCharacterRelation = typeof WORLD_PORTAL_CHARACTER_RELATIONS[number]

export const WORLD_PORTAL_CHARACTER_RELATION_LABELS: Record<WorldPortalCharacterRelation, { zh: string; en: string }> = {
  guard: { zh: '守护者', en: 'Guardian' },
  control: { zh: '控制者', en: 'Controller' },
  creator: { zh: '开辟者', en: 'Creator' },
  custom: { zh: '自定义', en: 'Custom' },
}

export interface WorldPortalCharacter {
  id: string
  portalId: string
  characterId: string
  relation: WorldPortalCharacterRelation
  customLabel: string
  note: string
  createdAt?: string
}

// ============================================================
// 5.7 世界规则
// ============================================================

export const WORLD_RULE_CATEGORIES = ['cultivation', 'power-cap', 'nature', 'time', 'taboo', 'custom'] as const
export type WorldRuleCategory = typeof WORLD_RULE_CATEGORIES[number]

export const WORLD_RULE_CATEGORY_LABELS: Record<WorldRuleCategory, { zh: string; en: string }> = {
  cultivation: { zh: '修炼体系', en: 'Cultivation system' },
  'power-cap': { zh: '力量上限', en: 'Power ceiling' },
  nature: { zh: '自然规律', en: 'Natural law' },
  time: { zh: '时间规律', en: 'Temporal law' },
  taboo: { zh: '禁忌', en: 'Taboo' },
  custom: { zh: '自定义', en: 'Custom' },
}

/**
 * 规则来源。作者手写的规则是 author；引用已有审核规则或 story_facts 时
 * 保留原事实 ID 与来源状态，绝不为了填写来源字段伪造文件、快照或确认记录。
 */
export type WorldRuleSourceKind = 'author' | 'setting-rule' | 'story-fact'

export interface WorldRule {
  id: string
  worldId: string
  name: string
  category: WorldRuleCategory
  customCategoryLabel: string
  content: string
  /** 适用范围的文字说明；结构化范围见 WorldRuleTarget。 */
  scopeNote: string
  restriction: string
  consequence: string
  notes: string
  sourceKind: WorldRuleSourceKind
  /** 引用已有事实时的原事实 ID；author 来源为空。 */
  sourceRefId: string
  /** 引用事实的来源状态原文（如 confirmed / candidate）。 */
  sourceStatus: string
  createdAt?: string
  updatedAt?: string
}

/** 规则的适用目标与例外目标；目标必须是该世界内的地点或秘境。 */
export type WorldRuleTargetKind = 'node' | 'relic'
export type WorldRuleTargetRole = 'scope' | 'exception'

export interface WorldRuleTarget {
  id: string
  ruleId: string
  role: WorldRuleTargetRole
  targetKind: WorldRuleTargetKind
  targetId: string
  /** 例外范围与内容说明；role 为 exception 时使用。 */
  note: string
  createdAt?: string
}

// ============================================================
// 5.4 / 5.5 人物关联与位置
// ============================================================

export interface WorldCharacterLink {
  id: string
  worldId: string
  /** 稳定人物 ID。多个世界引用同一个人物 ID。 */
  characterId: string
  /** 出生于此 / 居住于此 / 曾经活动 / 外来者 等。 */
  relation: string
  note: string
  createdAt?: string
  updatedAt?: string
}

export type WorldCharacterLocationKind = 'birth' | 'current'

/**
 * 人物的出生地与目前所在地。
 *
 * 出生地是可编辑的背景信息，与当前位置互不覆盖。
 * 结构化当前位置是同一角色位置事实的扩展：它必须通过角色名单业务提交写入
 * `characters.cs_location`，并在这里记录绑定时的原文与来源，用来检测角色页
 * 被绕过修改的情形——一旦文字不再匹配，界面不得继续把旧地图地点显示为
 * 当前已确认位置。
 */
export interface WorldCharacterLocation {
  id: string
  characterId: string
  kind: WorldCharacterLocationKind
  /** 未设定时为 null（保留“未知/未设定”状态）。 */
  worldId: string | null
  nodeId: string | null
  note: string
  /** 仅 current：剧情时间文字。 */
  storyTimeLabel: string
  timePrecision: StoryTimelinePrecision
  chapterNumber: number | null
  /** 仅 current：绑定时 characters.cs_location 的原文。 */
  boundLocationText: string
  /** 仅 current：绑定时 cs_location 字段的来源种类（author / derived / legacy / ''）。 */
  boundProvenanceKind: string
  boundAt: string
  createdAt?: string
  updatedAt?: string
}

/** 绑定失效原因：角色位置被角色页或定稿后处理改成了别的内容。 */
export type WorldLocationBindingState = 'unset' | 'bound' | 'stale'

/**
 * 读模型：把绑定行与 characters 当前值对照后给出的可执行状态。
 * stale 时保留旧文字与旧来源证据，但界面不得再把它呈现为当前有效位置。
 */
export interface WorldCharacterLocationView {
  characterId: string
  /** 展示名；随改名更新。 */
  characterName: string
  birth: WorldCharacterLocation | null
  current: WorldCharacterLocation | null
  currentState: 'unset' | 'bound' | 'stale'
  /** characters.cs_location 的当前原文（旧文字位置原样保留）。 */
  locationText: string
  /** cs_location 字段当前来源种类。 */
  locationProvenanceKind: string
}

// ============================================================
// 5.9 人物行踪
// ============================================================

export interface WorldCharacterTrail {
  id: string
  characterId: string
  worldId: string
  nodeId: string | null
  note: string
  arrivedLabel: string
  departedLabel: string
  timePrecision: StoryTimelinePrecision
  /** 独立排序刻度；只有存在可靠可比较刻度时才校验离开不早于到达。 */
  sortOrder: number
  reason: string
  chapterNumber: number | null
  notes: string
  /** 关联经过的通道（可选）。 */
  portalId: string | null
  /** 关联参与的事件（可选）。 */
  eventId: string | null
  createdAt?: string
  updatedAt?: string
}

// ============================================================
// 5.8 重要历史事件（扩展 story_timeline_events）
// ============================================================

/** story_timeline_events 的世界关联。各世界历史页显示同一个事件。 */
export interface WorldEventWorld {
  eventId: string
  worldId: string
}

export const WORLD_EVENT_TARGET_KINDS = ['faction', 'relic', 'portal', 'character', 'node', 'rule'] as const
export type WorldEventTargetKind = typeof WORLD_EVENT_TARGET_KINDS[number]

export const WORLD_EVENT_TARGET_KIND_LABELS: Record<WorldEventTargetKind, { zh: string; en: string }> = {
  faction: { zh: '势力', en: 'Faction' },
  relic: { zh: '秘境', en: 'Relic' },
  portal: { zh: '通道', en: 'Portal' },
  character: { zh: '人物', en: 'Character' },
  node: { zh: '地点', en: 'Location' },
  rule: { zh: '规则', en: 'Rule' },
}

export interface WorldEventLink {
  id: string
  eventId: string
  targetKind: WorldEventTargetKind
  targetId: string
  /** 目标所属世界（人物可为 null，因为它可跨世界）。 */
  worldId: string | null
  relation: string
  note: string
  createdAt?: string
}

// ============================================================
// 删除影响预览
// ============================================================

export interface WorldDeleteBlocker {
  /** 引用种类，用于界面分组与跳转。 */
  kind: string
  label: string
  count: number
  /** 前若干条引用对象的稳定 ID，供界面显示与跳转。 */
  ids: string[]
}

/**
 * 删除实体的影响预览。blockers 非空时仓库默认拒绝删除，要求先解除依赖。
 * 本轮不提供一键级联删除整个世界。
 */
export interface WorldDeletePlan {
  entityKind: WorldEntityKind
  entityId: string
  entityName: string
  /** 阻止删除的引用；为空才允许继续。 */
  blockers: WorldDeleteBlocker[]
  /** 随实体一起删除的从属关系行数（关系是实体的一部分，不是独立实体）。 */
  cascadedRelationCount: number
  /** 真正会被删除的行数量（实体自身 + 从属关系）。 */
  removedRowCount: number
}

// ============================================================
// 读模型
// ============================================================

/** 人物摘要：来自 characters + character_identities 的投影，不是第二份人物事实。 */
export interface WorldCharacterRef {
  id: string
  name: string
  role: string
  locationText: string
}

export interface WorldWorkbenchMigrationReport {
  appliedAt: string
  schemaVersion: number
  /** 新建的默认世界数量：幂等迁移绝不制造多个默认世界，因此恒为 0 或 1。 */
  defaultWorldCount: number
  /** 旧地图被自动关联到世界的数量：恒为 0，旧地图归属必须由作者显式操作。 */
  autoLinkedMapCount: number
  /** 已经存在的表数量，用于说明迁移是重复执行的。 */
  existingTableCount: number
}

export interface WorldWorkbenchSnapshot {
  worlds: WorldRecord[]
  mapWorldLinks: WorldMapWorldLink[]
  factions: WorldFaction[]
  factionPlaces: WorldFactionPlace[]
  factionRelations: WorldFactionRelation[]
  factionCharacters: WorldFactionCharacter[]
  relics: WorldRelic[]
  relicFactions: WorldRelicFaction[]
  relicCharacters: WorldRelicCharacter[]
  portals: WorldPortal[]
  portalFactions: WorldPortalFaction[]
  portalCharacters: WorldPortalCharacter[]
  rules: WorldRule[]
  ruleTargets: WorldRuleTarget[]
  characterLinks: WorldCharacterLink[]
  characterLocations: WorldCharacterLocation[]
  characterLocationViews: WorldCharacterLocationView[]
  trails: WorldCharacterTrail[]
  eventWorlds: WorldEventWorld[]
  eventLinks: WorldEventLink[]
  /** 人物摘要投影，供世界人物页展示既有角色资料。 */
  characterRefs: WorldCharacterRef[]
  migration: WorldWorkbenchMigrationReport | null
}

// ============================================================
// 保存请求
// ============================================================

/** 设置结构化目前所在地时的可选联动。 */
export interface WorldCurrentLocationCommitOptions {
  /** 剧情时间文字与精度，写入结构化绑定。 */
  storyTimeLabel?: string
  timePrecision?: StoryTimelinePrecision
  chapterNumber?: number | null
  /** 作者可覆盖写入 cs_location 的展示文字；缺省时由世界/地点名生成。 */
  locationText?: string
}

export interface WorldLocationCommitResult {
  success: boolean
  /** 写入 characters.cs_location 的最终文字。 */
  locationText?: string
  /** 角色名单提交后的 revision；证明走的是同一业务提交。 */
  rosterRevision?: number
  error?: string
}

/**
 * 人物行踪保存请求。默认不改变目前所在地；勾选 `alsoSetCurrentLocation` 时，
 * 行踪保存与位置更新必须在同一事务内成功或回滚。
 */
export interface WorldTrailCommitRequest {
  trail: WorldCharacterTrail
  alsoSetCurrentLocation: boolean
  /** alsoSetCurrentLocation 为 true 时使用。 */
  currentLocation?: WorldCurrentLocationCommitOptions
}

export interface WorldTrailCommitResult {
  success: boolean
  trail?: WorldCharacterTrail
  /** 同步更新目前所在地后的角色名单 revision。 */
  rosterRevision?: number
  error?: string
}
