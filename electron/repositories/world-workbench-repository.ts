/**
 * WorldWorkbenchRepository — 多世界资料的事实源。
 *
 * 设计要点：
 * - 一切校验都在主进程完成：所属世界、关系端点、引用对象、地点世界一致性。
 *   前端下拉框只是便利，不是约束。
 * - 人物 ID 复用 character_identities.character_id，地点 ID 复用
 *   world_map_nodes.id，事件 ID 复用 story_timeline_events.id。
 * - 结构化「目前所在地」是 characters.cs_location 的扩展，必须通过角色名单的
 *   同一业务提交写入，并记录绑定时的原文与来源，用来检测绕过本模块的修改。
 * - 删除默认保守：先给出影响预览，blockers 非空则拒绝，要求先解除依赖。
 */
import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

import {
  createWorldEntityId,
  isSafeEntityIdOfKind,
  isSafeRelationId,
  isSafeWorldEntityId,
  WORLD_FACTION_RELATIONS,
  WORLD_FACTION_SYMMETRIC_RELATIONS,
  WORLD_PORTAL_CHARACTER_RELATIONS,
  WORLD_PORTAL_FACTION_RELATIONS,
  WORLD_PORTAL_STATUSES,
  WORLD_PORTAL_TYPES,
  WORLD_RELIC_CHARACTER_RELATIONS,
  WORLD_RELIC_FACTION_RELATIONS,
  WORLD_RELIC_STATUSES,
  WORLD_RULE_CATEGORIES,
  WORLD_WORKBENCH_SCHEMA_VERSION,
  type WorldCharacterLink,
  type WorldCharacterLocation,
  type WorldCharacterLocationKind,
  type WorldCharacterLocationView,
  type WorldCharacterRef,
  type WorldCharacterTrail,
  type WorldCurrentLocationCommitOptions,
  type WorldDeleteBlocker,
  type WorldDeletePlan,
  type WorldEntityKind,
  type WorldEventLink,
  type WorldEventTargetKind,
  type WorldEventWorld,
  type WorldFaction,
  type WorldFactionCharacter,
  type WorldFactionPlace,
  type WorldFactionRelation,
  type WorldFactionRelationKind,
  type WorldLocationCommitResult,
  type WorldMapAssignmentPlan,
  type WorldMapWorldLink,
  type WorldPortal,
  type WorldPortalCharacter,
  type WorldPortalCharacterRelation,
  type WorldPortalFaction,
  type WorldPortalFactionRelation,
  type WorldPortalStatus,
  type WorldPortalType,
  type WorldRecord,
  type WorldRelic,
  type WorldRelicCharacter,
  type WorldRelicCharacterRelation,
  type WorldRelicFaction,
  type WorldRelicFactionRelation,
  type WorldRelicStatus,
  type WorldRule,
  type WorldRuleCategory,
  type WorldRuleSourceKind,
  type WorldRuleTarget,
  type WorldRuleTargetKind,
  type WorldRuleTargetRole,
  type WorldTrailCommitRequest,
  type WorldTrailCommitResult,
  type WorldWorkbenchMigrationReport,
  type WorldWorkbenchSnapshot,
} from '../../src/shared/world-workbench'
import {
  CHARACTER_ROSTER_SCHEMA_VERSION,
  type CharacterRosterEntry,
} from '../../src/shared/character-roster'
import type { StoryTimelinePrecision } from '../../src/shared/story-timeline'
import { getProjectDb } from '../database'
import {
  detachWorldReferencesForCharacter,
  ensureWorldWorkbenchSchema,
  hasWorldWorkbenchTables,
  tableExists,
} from '../services/world-workbench-schema'
import { CharacterRosterRepository } from './character-roster-repository'

const MIGRATION_ID = 'world-workbench-v1'

function requireDb(): BetterSqlite3.Database {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

/** 读路径也要保证 schema 就位：旧项目可能在本次升级前从未写过世界资料。 */
function readyDb(): BetterSqlite3.Database {
  const db = requireDb()
  ensureWorldWorkbenchSchema(db)
  return db
}

function nowIso(): string {
  return new Date().toISOString()
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value.trim()
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字`)
  return value
}

function optionalInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}必须是正整数`)
  }
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requirePrecision(value: unknown, label: string): StoryTimelinePrecision {
  if (value === undefined || value === null || value === '') return 'unknown'
  if (value === 'exact' || value === 'range' || value === 'relative' || value === 'unknown') return value
  throw new Error(`${label}精度无效`)
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new Error(`${label}无效`)
}

interface WorldNameRow {
  id: string
  name: string
}

/** 世界必须存在；返回 id 与名称，避免调用方再次查询。 */
function requireWorld(db: BetterSqlite3.Database, worldId: unknown): WorldNameRow {
  if (!isSafeWorldEntityId(worldId, 'world')) throw new Error('所属世界标识无效')
  const row = db.prepare('SELECT id, name FROM worlds WHERE id = ?').get(worldId) as WorldNameRow | undefined
  if (!row) throw new Error('所属世界不存在或已删除')
  return row
}

interface NodeRow {
  id: string
  name: string
  map_id: string
}

function requireNode(db: BetterSqlite3.Database, nodeId: unknown, label: string): NodeRow {
  if (typeof nodeId !== 'string' || !nodeId) throw new Error(`${label}标识无效`)
  const row = db.prepare('SELECT id, name, map_id FROM world_map_nodes WHERE id = ?').get(nodeId) as NodeRow | undefined
  if (!row) throw new Error(`${label}不存在或已删除`)
  return row
}

/** 地点的所属世界由地图归属推导；地图未关联世界时返回 null。 */
function worldOfNode(db: BetterSqlite3.Database, nodeId: string): string | null {
  const row = db.prepare(`
    SELECT m.world_id AS world_id
    FROM world_map_nodes n
    JOIN world_maps m ON m.id = n.map_id
    WHERE n.id = ?
  `).get(nodeId) as { world_id: string | null } | undefined
  return row?.world_id ?? null
}

/**
 * 引用地点的资料必须与所选世界一致。地图未关联世界时同样拒绝：
 * 否则“所属世界”就是不可验证的猜测。
 */
function requireNodeInWorld(
  db: BetterSqlite3.Database,
  nodeId: unknown,
  worldId: unknown,
  label: string,
): NodeRow | null {
  if (nodeId === null || nodeId === undefined || nodeId === '') return null
  const node = requireNode(db, nodeId, label)
  const ownerWorld = worldOfNode(db, node.id)
  if (!ownerWorld) {
    throw new Error(`${label}「${node.name}」所在的地图尚未关联世界，无法作为「${worldLabelOf(db, worldId)}」的资料引用`)
  }
  if (ownerWorld !== worldId) {
    throw new Error(`${label}「${node.name}」不属于当前世界，已拒绝跨世界引用`)
  }
  return node
}

function worldLabelOf(db: BetterSqlite3.Database, worldId: unknown): string {
  if (typeof worldId !== 'string') return '未知世界'
  const row = db.prepare('SELECT name FROM worlds WHERE id = ?').get(worldId) as { name: string } | undefined
  return row?.name ?? '未知世界'
}

function requireCharacter(db: BetterSqlite3.Database, characterId: unknown, label: string): { character_id: string; name: string } {
  if (typeof characterId !== 'string' || !characterId.trim()) throw new Error(`${label}未选择人物`)
  const row = db.prepare('SELECT character_id, name FROM character_identities WHERE character_id = ?')
    .get(characterId.trim()) as { character_id: string; name: string } | undefined
  if (!row) throw new Error(`${label}对应的项目角色不存在或已删除`)
  return row
}

function requireEntityRow(
  db: BetterSqlite3.Database,
  table: string,
  id: unknown,
  kind: WorldEntityKind,
  label: string,
): { id: string; name: string } {
  if (!isSafeEntityIdOfKind(id, kind)) throw new Error(`${label}标识无效`)
  const row = db.prepare(`SELECT id, name FROM ${table} WHERE id = ?`).get(id) as { id: string; name: string } | undefined
  if (!row) throw new Error(`${label}不存在或已删除`)
  return row
}

// ============================================================
// 地点世界引用收集（供地图删除 / 归属变更复用）
// ============================================================

export interface NodeWorldReference {
  kind: string
  label: string
  /** 引用方所属世界；null 表示引用方没有可比较的世界归属。 */
  worldId: string | null
  ids: string[]
}

function groupReferences(
  rows: Array<{ kind: string; label: string; worldId: string | null; id: string }>,
): NodeWorldReference[] {
  const byKind = new Map<string, NodeWorldReference>()
  for (const row of rows) {
    const bucket = byKind.get(row.kind)
    if (bucket) {
      if (bucket.worldId !== row.worldId && bucket.worldId !== null) bucket.worldId = null
      bucket.ids.push(row.id)
    } else {
      byKind.set(row.kind, { kind: row.kind, label: row.label, worldId: row.worldId, ids: [row.id] })
    }
  }
  return [...byKind.values()]
}

const NODE_REFERENCE_QUERIES: Array<{
  kind: string
  label: string
  sql: string
  worldColumn: string | null
  worldKind: 'faction' | 'relic' | 'portal' | 'trail' | 'rule' | 'location' | null
}> = [
  {
    kind: 'faction-place',
    label: '势力驻地 / 控制地点',
    sql: `SELECT fp.id AS id, fp.faction_id AS owner, f.name AS owner_name FROM world_faction_places fp
          JOIN world_factions f ON f.id = fp.faction_id WHERE fp.node_id IN `,
    worldColumn: 'world_id',
    worldKind: 'faction',
  },
  {
    kind: 'relic-node',
    label: '秘境位置',
    sql: `SELECT r.id AS id, r.world_id AS owner, r.name AS owner_name FROM world_relics r WHERE r.node_id IN `,
    worldColumn: 'world_id',
    worldKind: 'relic',
  },
  {
    kind: 'relic-entrance',
    label: '秘境入口',
    sql: `SELECT r.id AS id, r.world_id AS owner, r.name AS owner_name FROM world_relics r WHERE r.entrance_node_id IN `,
    worldColumn: 'world_id',
    worldKind: 'relic',
  },
  {
    kind: 'character-location',
    label: '人物出生地 / 目前所在地',
    sql: `SELECT l.id AS id, COALESCE(i.name, l.character_id) AS owner_name, l.world_id AS owner
          FROM world_character_locations l
          LEFT JOIN character_identities i ON i.character_id = l.character_id
          WHERE l.node_id IN `,
    worldColumn: 'world_id',
    worldKind: 'location',
  },
  {
    kind: 'portal-node',
    label: '世界通道入口地点',
    sql: `SELECT p.id AS id, p.from_world_id AS owner, p.name AS owner_name FROM world_portals p WHERE p.from_node_id IN `,
    worldColumn: 'from_world_id',
    worldKind: 'portal',
  },
  {
    kind: 'portal-endpoint',
    label: '世界通道出口地点',
    sql: `SELECT p.id AS id, p.to_world_id AS owner, p.name AS owner_name FROM world_portals p WHERE p.to_node_id IN `,
    worldColumn: 'to_world_id',
    worldKind: 'portal',
  },
  {
    kind: 'trail',
    label: '人物行踪',
    sql: `SELECT t.id AS id, t.world_id AS owner, COALESCE(i.name, t.character_id) AS owner_name
          FROM world_trails t
          LEFT JOIN character_identities i ON i.character_id = t.character_id
          WHERE t.node_id IN `,
    worldColumn: 'world_id',
    worldKind: 'trail',
  },
  {
    kind: 'rule-target',
    label: '规则适用范围 / 例外',
    sql: `SELECT rt.id AS id, r.world_id AS owner, r.name AS owner_name FROM world_rule_targets rt
          JOIN world_rules r ON r.id = rt.rule_id
          WHERE rt.target_kind = 'node' AND rt.target_id IN `,
    worldColumn: 'world_id',
    worldKind: 'rule',
  },
]

/**
 * 收集所有引用这些地点的世界资料。地图删除与地图归属变更都依赖它：
 * 前者把全部引用视为 blockers，后者只把「世界不一致」视为 blockers。
 */
export function collectNodeWorldReferences(db: BetterSqlite3.Database, nodeIds: readonly string[]): NodeWorldReference[] {
  const unique = [...new Set(nodeIds.filter(Boolean))]
  if (unique.length === 0) return []
  if (!tableExists(db, 'worlds')) return []
  const placeholders = unique.map(() => '?').join(', ')
  const rows: Array<{ kind: string; label: string; worldId: string | null; id: string }> = []
  for (const query of NODE_REFERENCE_QUERIES) {
    let found: Array<{ id: string; owner: string | null; owner_name: string }>
    try {
      found = db.prepare(`${query.sql}(${placeholders})`).all(...unique) as typeof found
    } catch {
      // 旧库可能缺少某张世界资料表：缺失即无引用，不当作错误。
      continue
    }
    for (const row of found) {
      rows.push({ kind: query.kind, label: `${query.label}「${row.owner_name}」`, worldId: row.owner ?? null, id: row.id })
    }
  }
  return groupReferences(rows)
}

/** 删除地图 / 地点前的世界资料引用清单。 */
export function collectMapWorldBlockers(db: BetterSqlite3.Database, mapIds: readonly string[]): WorldDeleteBlocker[] {
  if (!tableExists(db, 'world_map_nodes') || !tableExists(db, 'worlds')) return []
  const unique = [...new Set(mapIds.filter(Boolean))]
  if (unique.length === 0) return []
  const placeholders = unique.map(() => '?').join(', ')
  const nodeIds = (db.prepare(`SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders})`).all(...unique) as Array<{ id: string }>)
    .map(row => row.id)
  return collectNodeWorldReferences(db, nodeIds).map(reference => ({
    kind: reference.kind,
    label: reference.label,
    count: reference.ids.length,
    ids: reference.ids,
  }))
}

// ============================================================
// 行映射
// ============================================================

interface Row {
  [key: string]: unknown
}

function mapWorld(row: Row): WorldRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    summary: String(row.summary ?? ''),
    background: String(row.background ?? ''),
    notes: String(row.notes ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapFaction(row: Row): WorldFaction {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    name: String(row.name),
    type: String(row.type ?? ''),
    summary: String(row.summary ?? ''),
    description: String(row.description ?? ''),
    seat: String(row.seat ?? ''),
    domainNote: String(row.domain_note ?? ''),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapFactionPlace(row: Row): WorldFactionPlace {
  return {
    id: String(row.id),
    factionId: String(row.faction_id),
    nodeId: String(row.node_id),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapFactionRelation(row: Row): WorldFactionRelation {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    fromFactionId: String(row.from_faction_id),
    toFactionId: String(row.to_faction_id),
    relation: String(row.relation) as WorldFactionRelationKind,
    customLabel: String(row.custom_label ?? ''),
    directed: Boolean(row.directed),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapFactionCharacter(row: Row): WorldFactionCharacter {
  return {
    id: String(row.id),
    factionId: String(row.faction_id),
    characterId: String(row.character_id),
    relation: String(row.relation ?? ''),
    tenureNote: String(row.tenure_note ?? ''),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapRelic(row: Row): WorldRelic {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    name: String(row.name),
    type: String(row.type ?? ''),
    summary: String(row.summary ?? ''),
    description: String(row.description ?? ''),
    locationNote: String(row.location_note ?? ''),
    nodeId: row.node_id ? String(row.node_id) : null,
    entranceNodeId: row.entrance_node_id ? String(row.entrance_node_id) : null,
    entryCondition: String(row.entry_condition ?? ''),
    danger: String(row.danger ?? ''),
    rewards: String(row.rewards ?? ''),
    availabilityNote: String(row.availability_note ?? ''),
    status: String(row.status) as WorldRelicStatus,
    customStatusLabel: String(row.custom_status_label ?? ''),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapRelicFaction(row: Row): WorldRelicFaction {
  return {
    id: String(row.id),
    relicId: String(row.relic_id),
    factionId: String(row.faction_id),
    relation: String(row.relation) as WorldRelicFactionRelation,
    customLabel: String(row.custom_label ?? ''),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapRelicCharacter(row: Row): WorldRelicCharacter {
  return {
    id: String(row.id),
    relicId: String(row.relic_id),
    characterId: String(row.character_id),
    relation: String(row.relation) as WorldRelicCharacterRelation,
    customLabel: String(row.custom_label ?? ''),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapPortal(row: Row): WorldPortal {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as WorldPortalType,
    customTypeLabel: String(row.custom_type_label ?? ''),
    fromWorldId: String(row.from_world_id),
    toWorldId: String(row.to_world_id),
    fromNodeId: row.from_node_id ? String(row.from_node_id) : null,
    toNodeId: row.to_node_id ? String(row.to_node_id) : null,
    bidirectional: Boolean(row.bidirectional),
    condition: String(row.condition ?? ''),
    cost: String(row.cost ?? ''),
    scheduleNote: String(row.schedule_note ?? ''),
    status: String(row.status) as WorldPortalStatus,
    customStatusLabel: String(row.custom_status_label ?? ''),
    description: String(row.description ?? ''),
    notes: String(row.notes ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapPortalFaction(row: Row): WorldPortalFaction {
  return {
    id: String(row.id),
    portalId: String(row.portal_id),
    factionId: String(row.faction_id),
    relation: String(row.relation) as WorldPortalFactionRelation,
    customLabel: String(row.custom_label ?? ''),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapPortalCharacter(row: Row): WorldPortalCharacter {
  return {
    id: String(row.id),
    portalId: String(row.portal_id),
    characterId: String(row.character_id),
    relation: String(row.relation) as WorldPortalCharacterRelation,
    customLabel: String(row.custom_label ?? ''),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapRule(row: Row): WorldRule {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    name: String(row.name),
    category: String(row.category) as WorldRuleCategory,
    customCategoryLabel: String(row.custom_category_label ?? ''),
    content: String(row.content ?? ''),
    scopeNote: String(row.scope_note ?? ''),
    restriction: String(row.restriction ?? ''),
    consequence: String(row.consequence ?? ''),
    notes: String(row.notes ?? ''),
    sourceKind: String(row.source_kind ?? 'author') as WorldRuleSourceKind,
    sourceRefId: String(row.source_ref_id ?? ''),
    sourceStatus: String(row.source_status ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapRuleTarget(row: Row): WorldRuleTarget {
  return {
    id: String(row.id),
    ruleId: String(row.rule_id),
    role: String(row.role) as WorldRuleTargetRole,
    targetKind: String(row.target_kind) as WorldRuleTargetKind,
    targetId: String(row.target_id),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

function mapCharacterLink(row: Row): WorldCharacterLink {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    characterId: String(row.character_id),
    relation: String(row.relation ?? ''),
    note: String(row.note ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapCharacterLocation(row: Row): WorldCharacterLocation {
  return {
    id: String(row.id),
    characterId: String(row.character_id),
    kind: String(row.kind) as WorldCharacterLocationKind,
    worldId: row.world_id ? String(row.world_id) : null,
    nodeId: row.node_id ? String(row.node_id) : null,
    note: String(row.note ?? ''),
    storyTimeLabel: String(row.story_time_label ?? ''),
    timePrecision: String(row.time_precision ?? 'unknown') as StoryTimelinePrecision,
    chapterNumber: typeof row.chapter_number === 'number' ? row.chapter_number : null,
    boundLocationText: String(row.bound_location_text ?? ''),
    boundProvenanceKind: String(row.bound_provenance_kind ?? ''),
    boundAt: String(row.bound_at ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

function mapTrail(row: Row): WorldCharacterTrail {
  return {
    id: String(row.id),
    characterId: String(row.character_id),
    worldId: String(row.world_id),
    nodeId: row.node_id ? String(row.node_id) : null,
    note: String(row.note ?? ''),
    arrivedLabel: String(row.arrived_label ?? ''),
    departedLabel: String(row.departed_label ?? ''),
    timePrecision: String(row.time_precision ?? 'unknown') as StoryTimelinePrecision,
    sortOrder: Number(row.sort_order ?? 0),
    reason: String(row.reason ?? ''),
    chapterNumber: typeof row.chapter_number === 'number' ? row.chapter_number : null,
    notes: String(row.notes ?? ''),
    portalId: row.portal_id ? String(row.portal_id) : null,
    eventId: row.event_id ? String(row.event_id) : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

// ============================================================
// 位置一致性
// ============================================================

interface CharacterStateSnapshot {
  name: string
  location: string
  updatedAtChapter: number | null
  provenanceKind: string
}

function readCharacterStates(db: BetterSqlite3.Database): Map<string, CharacterStateSnapshot> {
  const result = new Map<string, CharacterStateSnapshot>()
  if (!tableExists(db, 'characters')) return result
  const rows = db.prepare(`
    SELECT name, cs_location, cs_updated_at_chapter, cs_provenance
    FROM characters
  `).all() as Array<{ name: string; cs_location: string | null; cs_updated_at_chapter: number | null; cs_provenance: string | null }>
  for (const row of rows) {
    result.set(row.name, {
      name: row.name,
      location: row.cs_location ?? '',
      updatedAtChapter: typeof row.cs_updated_at_chapter === 'number' ? row.cs_updated_at_chapter : null,
      provenanceKind: effectiveLocationProvenanceKind(row.cs_location, row.cs_provenance),
    })
  }
  return result
}

/**
 * 位置的「有效来源种类」。
 *
 * 与角色名单的 normalizeState 采用同一规则：字段有值但没有任何来源记录时，
 * 它就是一个来源未知的旧值（legacy），不是作者确认。这样世界页与角色页
 * 对同一份事实给出同一个来源判断。
 */
function effectiveLocationProvenanceKind(locationText: string | null, raw: string | null): string {
  const recorded = readLocationProvenanceKind(raw)
  if (recorded) return recorded
  return (locationText ?? '').trim() ? 'legacy' : ''
}

function readLocationProvenanceKind(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return ''
    const location = parsed.location
    if (!isObject(location)) return ''
    return typeof location.kind === 'string' ? location.kind : ''
  } catch {
    return ''
  }
}

/**
 * 结构化当前位置的有效性判定。
 *
 * - unset：没有绑定行，界面显示「未设定」。
 * - bound：绑定行的原文与 characters.cs_location 当前值一致。
 * - stale：角色页或定稿后处理把位置改成了别的内容。旧文字与旧来源证据保留，
 *   但界面不得再把旧地图地点呈现为当前已确认位置。
 */
function computeLocationViewState(
  binding: WorldCharacterLocation | null,
  state: CharacterStateSnapshot | undefined,
): WorldCharacterLocationView['currentState'] {
  if (!binding) return 'unset'
  // 绑定被显式解除后 boundLocationText 为空：这是「未设定，需要重新确认」，
  // 不是「失效」。不得因为 characters 里还留着旧文字就继续冒充当前地点。
  if (!binding.boundLocationText) return 'unset'
  const text = state?.location ?? ''
  if (binding.boundLocationText !== text) return 'stale'
  if (binding.boundProvenanceKind && (state?.provenanceKind ?? '') !== binding.boundProvenanceKind) return 'stale'
  return 'bound'
}

// ============================================================
// 时间可比较刻度
// ============================================================

/**
 * 只有纯数字的到达/离开标签才是可靠可比较的刻度。
 * 虚构纪年、相对时间与未知时间一律跳过校验，绝不把文字强行解析为真实日期。
 */
export function parseComparableTick(label: string): number | null {
  const text = label.trim()
  if (!text) return null
  if (!/^-?\d+(?:\.\d+)?$/u.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

// ============================================================
// 仓库
// ============================================================

export class WorldWorkbenchRepository {
  // ---------- 读 ----------

  static getAll(): WorldWorkbenchSnapshot {
    const db = readyDb()
    const select = <T>(sql: string, mapper: (row: Row) => T): T[] =>
      (db.prepare(sql).all() as Row[]).map(mapper)

    const worlds = select('SELECT * FROM worlds ORDER BY sort_order ASC, created_at ASC', mapWorld)
    const factions = select('SELECT * FROM world_factions ORDER BY name COLLATE NOCASE ASC', mapFaction)
    const relics = select('SELECT * FROM world_relics ORDER BY name COLLATE NOCASE ASC', mapRelic)
    const portals = select('SELECT * FROM world_portals ORDER BY name COLLATE NOCASE ASC', mapPortal)
    const rules = select('SELECT * FROM world_rules ORDER BY category ASC, name COLLATE NOCASE ASC', mapRule)

    const characterLocations = select(
      'SELECT * FROM world_character_locations ORDER BY kind ASC, created_at ASC',
      mapCharacterLocation,
    )
    const identities = new Map(
      (db.prepare('SELECT character_id, name FROM character_identities').all() as Array<{ character_id: string; name: string }>)
        .map(row => [row.character_id, row.name]),
    )
    const states = readCharacterStates(db)

    const views: WorldCharacterLocationView[] = [...identities.entries()].map(([characterId, characterName]) => {
      const birth = characterLocations.find(row => row.characterId === characterId && row.kind === 'birth') ?? null
      const current = characterLocations.find(row => row.characterId === characterId && row.kind === 'current') ?? null
      const state = states.get(characterName)
      return {
        characterId,
        characterName,
        birth,
        current,
        currentState: computeLocationViewState(current, state),
        locationText: state?.location ?? '',
        locationProvenanceKind: state?.provenanceKind ?? '',
      }
    })

    const identityIdByName = new Map([...identities.entries()].map(([id, name]) => [name, id]))
    const characterRefs: WorldCharacterRef[] = tableExists(db, 'characters')
      ? (db.prepare('SELECT name, role, cs_location FROM characters').all() as Array<{ name: string; role: string; cs_location: string | null }>)
          .map(row => ({
            id: identityIdByName.get(row.name) ?? '',
            name: row.name,
            role: String(row.role ?? ''),
            locationText: row.cs_location ?? '',
          }))
          .filter(ref => Boolean(ref.id))
      : []

    const mapWorldLinks: WorldMapWorldLink[] = (db.prepare(`
      SELECT id, world_id, updated_at FROM world_maps WHERE world_id IS NOT NULL AND world_id <> ''
    `).all() as Array<{ id: string; world_id: string; updated_at: string }>)
      .map(row => ({ mapId: row.id, worldId: row.world_id, updatedAt: row.updated_at }))

    return {
      worlds,
      mapWorldLinks,
      factions,
      factionPlaces: select('SELECT * FROM world_faction_places ORDER BY created_at ASC', mapFactionPlace),
      factionRelations: select('SELECT * FROM world_faction_relations ORDER BY created_at ASC', mapFactionRelation),
      factionCharacters: select('SELECT * FROM world_faction_characters ORDER BY created_at ASC', mapFactionCharacter),
      relics,
      relicFactions: select('SELECT * FROM world_relic_factions ORDER BY created_at ASC', mapRelicFaction),
      relicCharacters: select('SELECT * FROM world_relic_characters ORDER BY created_at ASC', mapRelicCharacter),
      portals,
      portalFactions: select('SELECT * FROM world_portal_factions ORDER BY created_at ASC', mapPortalFaction),
      portalCharacters: select('SELECT * FROM world_portal_characters ORDER BY created_at ASC', mapPortalCharacter),
      rules,
      ruleTargets: select('SELECT * FROM world_rule_targets ORDER BY created_at ASC', mapRuleTarget),
      characterLinks: select('SELECT * FROM world_character_links ORDER BY created_at ASC', mapCharacterLink),
      characterLocations,
      characterLocationViews: views.sort((a, b) => a.characterName.localeCompare(b.characterName)),
      trails: select('SELECT * FROM world_trails ORDER BY sort_order ASC, created_at ASC', mapTrail),
      eventWorlds: (db.prepare('SELECT event_id, world_id FROM world_event_worlds').all() as Array<{ event_id: string; world_id: string }>)
        .map((row): WorldEventWorld => ({ eventId: row.event_id, worldId: row.world_id })),
      eventLinks: select('SELECT * FROM world_event_links ORDER BY created_at ASC', row => ({
        id: String(row.id),
        eventId: String(row.event_id),
        targetKind: String(row.target_kind) as WorldEventTargetKind,
        targetId: String(row.target_id),
        worldId: row.world_id ? String(row.world_id) : null,
        relation: String(row.relation ?? ''),
        note: String(row.note ?? ''),
        createdAt: String(row.created_at ?? ''),
      })),
      characterRefs,
      migration: WorldWorkbenchRepository.getMigrationReport(),
    }
  }

  static getMigrationReport(): WorldWorkbenchMigrationReport | null {
    const db = requireDb()
    if (!tableExists(db, 'world_workbench_migrations')) return null
    const row = db.prepare('SELECT report_json, applied_at FROM world_workbench_migrations WHERE migration_id = ?')
      .get(MIGRATION_ID) as { report_json: string; applied_at: string } | undefined
    if (!row) return null
    try {
      const parsed = JSON.parse(row.report_json) as Partial<WorldWorkbenchMigrationReport>
      return {
        appliedAt: parsed.appliedAt ?? row.applied_at,
        schemaVersion: parsed.schemaVersion ?? WORLD_WORKBENCH_SCHEMA_VERSION,
        defaultWorldCount: parsed.defaultWorldCount ?? 0,
        autoLinkedMapCount: parsed.autoLinkedMapCount ?? 0,
        existingTableCount: parsed.existingTableCount ?? 0,
      }
    } catch {
      return null
    }
  }

  // ---------- 5.1 世界 ----------

  static upsertWorld(world: WorldRecord): WorldRecord {
    const db = readyDb()
    const isNew = !isSafeEntityIdOfKind(world?.id, 'world')
    const id = isNew ? createWorldEntityId('world') : world.id
    const name = requireText(world?.name, '世界名称')
    const sortOrder = world?.sortOrder === undefined ? 0 : requireFiniteNumber(world.sortOrder, '世界排序')
    const duplicate = db.prepare('SELECT id FROM worlds WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(name, id) as { id: string } | undefined
    if (duplicate) throw new Error(`已存在同名世界「${name}」`)
    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM worlds WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO worlds (id, name, summary, background, notes, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        summary = excluded.summary,
        background = excluded.background,
        notes = excluded.notes,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(
      id,
      name,
      optionalText(world.summary),
      optionalText(world.background),
      optionalText(world.notes),
      sortOrder,
      existing?.created_at ?? now,
      now,
    )
    const row = db.prepare('SELECT * FROM worlds WHERE id = ?').get(id) as Row
    return mapWorld(row)
  }

  static deleteWorld(worldId: string): void {
    const db = readyDb()
    const world = requireWorld(db, worldId)
    const plan = WorldWorkbenchRepository.planDelete('world', worldId)
    if (plan.blockers.length > 0) {
      throw new Error(
        `世界「${world.name}」仍被 ${plan.blockers.reduce((sum, item) => sum + item.count, 0)} 项资料引用，`
        + '请先解除依赖后再删除',
      )
    }
    db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId)
  }

  // ---------- 4. 地图世界归属 ----------

  /** 地图归属变更的影响预览：只把「会造成世界不一致」的引用算作 blockers。 */
  static planMapWorldAssignment(mapId: string, nextWorldId: string | null): WorldMapAssignmentPlan {
    const db = readyDb()
    if (!isSafeWorldEntityId(mapId, 'map')) throw new Error('地图标识无效')
    const map = db.prepare('SELECT id, name FROM world_maps WHERE id = ?').get(mapId) as { id: string; name: string } | undefined
    if (!map) throw new Error('要修改归属的地图不存在')
    if (nextWorldId !== null) requireWorld(db, nextWorldId)

    const maps = db.prepare('SELECT id, parent_map_id FROM world_maps').all() as Array<{ id: string; parent_map_id: string | null }>
    const childrenByParent = new Map<string, string[]>()
    for (const row of maps) {
      if (!row.parent_map_id) continue
      const bucket = childrenByParent.get(row.parent_map_id)
      if (bucket) bucket.push(row.id)
      else childrenByParent.set(row.parent_map_id, [row.id])
    }
    const descendants: string[] = []
    const queue = [...(childrenByParent.get(mapId) ?? [])]
    while (queue.length > 0) {
      const current = queue.shift() as string
      if (descendants.includes(current)) continue
      descendants.push(current)
      queue.push(...(childrenByParent.get(current) ?? []))
    }
    // 已绑定世界的父子地图树不允许跨世界混挂：子孙里已经属于其他世界的先拦下。
    const affected = [mapId, ...descendants]
    const placeholders = affected.map(() => '?').join(', ')
    const conflictingChildren = (db.prepare(`
      SELECT id, name, world_id FROM world_maps
      WHERE id IN (${placeholders}) AND world_id IS NOT NULL AND world_id <> ''
        AND (? IS NULL OR world_id <> ?)
    `).all(...affected, nextWorldId, nextWorldId) as Array<{ id: string; name: string; world_id: string }>)

    const blockers: WorldDeleteBlocker[] = conflictingChildren.map(row => ({
      kind: 'child-map',
      label: `子地图「${row.name}」已归属其他世界（${worldLabelOf(db, row.world_id)}）`,
      count: 1,
      ids: [row.id],
    }))

    const nodeIds = (db.prepare(`SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders})`).all(...affected) as Array<{ id: string }>)
      .map(row => row.id)
    for (const reference of collectNodeWorldReferences(db, nodeIds)) {
      if (reference.worldId === nextWorldId) continue
      blockers.push({
        kind: reference.kind,
        label: reference.label,
        count: reference.ids.length,
        ids: reference.ids,
      })
    }

    return { mapId, nextWorldId, descendantMapIds: descendants, blockers }
  }

  /**
   * 应用地图世界归属变更。blockers 非空时拒绝，绝不静默搬移整批实体。
   * 子孙地图随本次显式操作一起改归属（预览里已列出）。
   */
  static applyMapWorldAssignment(mapId: string, nextWorldId: string | null): WorldMapAssignmentPlan {
    const db = readyDb()
    const plan = WorldWorkbenchRepository.planMapWorldAssignment(mapId, nextWorldId)
    if (plan.blockers.length > 0) {
      const total = plan.blockers.reduce((sum, item) => sum + item.count, 0)
      throw new Error(`有 ${total} 项资料与目标世界不一致，已拒绝修改地图归属；请先处理这些引用`)
    }
    const now = nowIso()
    const tx = db.transaction(() => {
      const update = db.prepare('UPDATE world_maps SET world_id = ?, updated_at = ? WHERE id = ?')
      for (const id of [plan.mapId, ...plan.descendantMapIds]) update.run(nextWorldId, now, id)
    })
    tx()
    return plan
  }

  // ---------- 5.2 势力 ----------

  static upsertFaction(faction: WorldFaction): WorldFaction {
    const db = readyDb()
    const isNew = !isSafeEntityIdOfKind(faction?.id, 'faction')
    const id = isNew ? createWorldEntityId('faction') : faction.id
    const world = requireWorld(db, faction?.worldId)
    const name = requireText(faction?.name, '势力名称')
    const duplicate = db.prepare('SELECT id FROM world_factions WHERE world_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
      .get(world.id, name, id) as { id: string } | undefined
    if (duplicate) throw new Error(`「${world.name}」中已存在同名势力「${name}」`)
    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_factions WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_factions (id, world_id, name, type, summary, description, seat, domain_note, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id,
        name = excluded.name,
        type = excluded.type,
        summary = excluded.summary,
        description = excluded.description,
        seat = excluded.seat,
        domain_note = excluded.domain_note,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(
      id, world.id, name,
      optionalText(faction.type), optionalText(faction.summary), optionalText(faction.description),
      optionalText(faction.seat), optionalText(faction.domainNote), optionalText(faction.notes),
      existing?.created_at ?? now, now,
    )
    return mapFaction(db.prepare('SELECT * FROM world_factions WHERE id = ?').get(id) as Row)
  }

  static upsertFactionPlace(place: WorldFactionPlace): WorldFactionPlace {
    const db = readyDb()
    const faction = requireEntityRow(db, 'world_factions', place?.factionId, 'faction', '势力')
    const factionWorld = (db.prepare('SELECT world_id FROM world_factions WHERE id = ?').get(faction.id) as { world_id: string }).world_id
    requireNodeInWorld(db, place?.nodeId, factionWorld, '势力地点')
    const id = isSafeRelationId(place?.id, 'wfacpl') ? place.id : `wfacpl-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_faction_places WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_faction_places (id, faction_id, node_id, note, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        faction_id = excluded.faction_id,
        node_id = excluded.node_id,
        note = excluded.note
    `).run(id, faction.id, place.nodeId, optionalText(place.note), existing?.created_at ?? nowIso())
    return mapFactionPlace(db.prepare('SELECT * FROM world_faction_places WHERE id = ?').get(id) as Row)
  }

  static upsertFactionRelation(relation: WorldFactionRelation): WorldFactionRelation {
    const db = readyDb()
    const from = requireEntityRow(db, 'world_factions', relation?.fromFactionId, 'faction', '势力')
    const to = requireEntityRow(db, 'world_factions', relation?.toFactionId, 'faction', '势力')
    if (from.id === to.id) throw new Error('势力不能与自身建立关系')
    const kind = requireEnum(relation?.relation, WORLD_FACTION_RELATIONS, '势力关系类型')
    const customLabel = optionalText(relation.customLabel)
    if (kind === 'custom' && !customLabel) throw new Error('自定义势力关系必须填写关系名称')
    const fromWorld = (db.prepare('SELECT world_id FROM world_factions WHERE id = ?').get(from.id) as { world_id: string }).world_id
    const symmetric = WORLD_FACTION_SYMMETRIC_RELATIONS.has(kind)
    const directed = symmetric ? false : true

    const id = isSafeRelationId(relation?.id, 'wfrel') ? relation.id : `wfrel-${randomUUID()}`
    // 对称关系只存一次，因此两个方向都算重复；有向关系按方向判定。
    const duplicate = symmetric
      ? db.prepare(`
          SELECT id FROM world_faction_relations
          WHERE relation = ? AND custom_label = ?
            AND ((from_faction_id = ? AND to_faction_id = ?) OR (from_faction_id = ? AND to_faction_id = ?))
            AND id <> ?
        `).get(kind, customLabel, from.id, to.id, to.id, from.id, id)
      : db.prepare(`
          SELECT id FROM world_faction_relations
          WHERE relation = ? AND custom_label = ? AND from_faction_id = ? AND to_faction_id = ? AND id <> ?
        `).get(kind, customLabel, from.id, to.id, id)
    if (duplicate) throw new Error(`势力关系「${from.name} → ${to.name}」已存在，未重复保存`)

    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_faction_relations WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_faction_relations (
        id, world_id, from_faction_id, to_faction_id, relation, custom_label, directed, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id,
        from_faction_id = excluded.from_faction_id,
        to_faction_id = excluded.to_faction_id,
        relation = excluded.relation,
        custom_label = excluded.custom_label,
        directed = excluded.directed,
        note = excluded.note,
        updated_at = excluded.updated_at
    `).run(
      id, fromWorld, from.id, to.id, kind, customLabel, directed ? 1 : 0,
      optionalText(relation.note), existing?.created_at ?? now, now,
    )
    return mapFactionRelation(db.prepare('SELECT * FROM world_faction_relations WHERE id = ?').get(id) as Row)
  }

  static upsertFactionCharacter(link: WorldFactionCharacter): WorldFactionCharacter {
    const db = readyDb()
    const faction = requireEntityRow(db, 'world_factions', link?.factionId, 'faction', '势力')
    requireCharacter(db, link?.characterId, '势力成员')
    const relation = requireText(link?.relation, '势力中的身份/关系')
    const id = isSafeRelationId(link?.id, 'wfacch') ? link.id : `wfacch-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_faction_characters WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_faction_characters (id, faction_id, character_id, relation, tenure_note, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        faction_id = excluded.faction_id,
        character_id = excluded.character_id,
        relation = excluded.relation,
        tenure_note = excluded.tenure_note,
        note = excluded.note
    `).run(
      id, faction.id, link.characterId.trim(), relation,
      optionalText(link.tenureNote), optionalText(link.note), existing?.created_at ?? nowIso(),
    )
    return mapFactionCharacter(db.prepare('SELECT * FROM world_faction_characters WHERE id = ?').get(id) as Row)
  }

  // ---------- 5.3 秘境 ----------

  static upsertRelic(relic: WorldRelic): WorldRelic {
    const db = readyDb()
    const isNew = !isSafeEntityIdOfKind(relic?.id, 'relic')
    const id = isNew ? createWorldEntityId('relic') : relic.id
    const world = requireWorld(db, relic?.worldId)
    const name = requireText(relic?.name, '秘境名称')
    const status = requireEnum(relic?.status ?? 'undiscovered', WORLD_RELIC_STATUSES, '秘境状态')
    const customStatusLabel = optionalText(relic.customStatusLabel)
    if (status === 'custom' && !customStatusLabel) throw new Error('自定义秘境状态必须填写状态名称')
    requireNodeInWorld(db, relic?.nodeId ?? null, world.id, '秘境位置')
    requireNodeInWorld(db, relic?.entranceNodeId ?? null, world.id, '秘境入口')
    const duplicate = db.prepare('SELECT id FROM world_relics WHERE world_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
      .get(world.id, name, id) as { id: string } | undefined
    if (duplicate) throw new Error(`「${world.name}」中已存在同名秘境「${name}」`)

    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_relics WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_relics (
        id, world_id, name, type, summary, description, location_note, node_id, entrance_node_id,
        entry_condition, danger, rewards, availability_note, status, custom_status_label, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id, name = excluded.name, type = excluded.type,
        summary = excluded.summary, description = excluded.description,
        location_note = excluded.location_note, node_id = excluded.node_id,
        entrance_node_id = excluded.entrance_node_id, entry_condition = excluded.entry_condition,
        danger = excluded.danger, rewards = excluded.rewards,
        availability_note = excluded.availability_note, status = excluded.status,
        custom_status_label = excluded.custom_status_label, notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(
      id, world.id, name, optionalText(relic.type), optionalText(relic.summary), optionalText(relic.description),
      optionalText(relic.locationNote), relic.nodeId ?? null, relic.entranceNodeId ?? null,
      optionalText(relic.entryCondition), optionalText(relic.danger), optionalText(relic.rewards),
      optionalText(relic.availabilityNote), status, customStatusLabel, optionalText(relic.notes),
      existing?.created_at ?? now, now,
    )
    return mapRelic(db.prepare('SELECT * FROM world_relics WHERE id = ?').get(id) as Row)
  }

  static upsertRelicFaction(link: WorldRelicFaction): WorldRelicFaction {
    const db = readyDb()
    const relic = requireEntityRow(db, 'world_relics', link?.relicId, 'relic', '秘境')
    const faction = requireEntityRow(db, 'world_factions', link?.factionId, 'faction', '势力')
    const relation = requireEnum(link?.relation, WORLD_RELIC_FACTION_RELATIONS, '秘境势力关系')
    if (relation === 'custom' && !optionalText(link.customLabel)) throw new Error('自定义关系必须填写关系名称')
    const id = isSafeRelationId(link?.id, 'wrelfa') ? link.id : `wrelfa-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_relic_factions WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_relic_factions (id, relic_id, faction_id, relation, custom_label, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        relic_id = excluded.relic_id, faction_id = excluded.faction_id,
        relation = excluded.relation, custom_label = excluded.custom_label, note = excluded.note
    `).run(
      id, relic.id, faction.id, relation, optionalText(link.customLabel),
      optionalText(link.note), existing?.created_at ?? nowIso(),
    )
    return mapRelicFaction(db.prepare('SELECT * FROM world_relic_factions WHERE id = ?').get(id) as Row)
  }

  static upsertRelicCharacter(link: WorldRelicCharacter): WorldRelicCharacter {
    const db = readyDb()
    const relic = requireEntityRow(db, 'world_relics', link?.relicId, 'relic', '秘境')
    requireCharacter(db, link?.characterId, '秘境关联人物')
    const relation = requireEnum(link?.relation, WORLD_RELIC_CHARACTER_RELATIONS, '秘境人物关系')
    if (relation === 'custom' && !optionalText(link.customLabel)) throw new Error('自定义关系必须填写关系名称')
    const id = isSafeRelationId(link?.id, 'wrelch') ? link.id : `wrelch-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_relic_characters WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_relic_characters (id, relic_id, character_id, relation, custom_label, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        relic_id = excluded.relic_id, character_id = excluded.character_id,
        relation = excluded.relation, custom_label = excluded.custom_label, note = excluded.note
    `).run(
      id, relic.id, link.characterId.trim(), relation, optionalText(link.customLabel),
      optionalText(link.note), existing?.created_at ?? nowIso(),
    )
    return mapRelicCharacter(db.prepare('SELECT * FROM world_relic_characters WHERE id = ?').get(id) as Row)
  }

  // ---------- 5.6 通道 ----------

  static upsertPortal(portal: WorldPortal): WorldPortal {
    const db = readyDb()
    const isNew = !isSafeEntityIdOfKind(portal?.id, 'portal')
    const id = isNew ? createWorldEntityId('portal') : portal.id
    const name = requireText(portal?.name, '通道名称')
    const fromWorld = requireWorld(db, portal?.fromWorldId)
    const toWorld = requireWorld(db, portal?.toWorldId)
    if (fromWorld.id === toWorld.id) throw new Error('世界通道的两端必须是不同的世界')
    const type = requireEnum(portal?.type ?? 'teleport', WORLD_PORTAL_TYPES, '通道类型')
    const customTypeLabel = optionalText(portal.customTypeLabel)
    if (type === 'custom' && !customTypeLabel) throw new Error('自定义通道类型必须填写类型名称')
    const status = requireEnum(portal?.status ?? 'active', WORLD_PORTAL_STATUSES, '通道状态')
    const customStatusLabel = optionalText(portal.customStatusLabel)
    if (status === 'custom' && !customStatusLabel) throw new Error('自定义通道状态必须填写状态名称')
    // 未设具体地点时保存为世界级通道；设了就必须归属对应世界。
    requireNodeInWorld(db, portal?.fromNodeId ?? null, fromWorld.id, '起点入口地点')
    requireNodeInWorld(db, portal?.toNodeId ?? null, toWorld.id, '终点出口地点')
    const duplicate = db.prepare('SELECT id FROM world_portals WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(name, id) as { id: string } | undefined
    if (duplicate) throw new Error(`已存在同名通道「${name}」`)

    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_portals WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_portals (
        id, name, type, custom_type_label, from_world_id, to_world_id, from_node_id, to_node_id,
        bidirectional, condition, cost, schedule_note, status, custom_status_label, description, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type, custom_type_label = excluded.custom_type_label,
        from_world_id = excluded.from_world_id, to_world_id = excluded.to_world_id,
        from_node_id = excluded.from_node_id, to_node_id = excluded.to_node_id,
        bidirectional = excluded.bidirectional, condition = excluded.condition, cost = excluded.cost,
        schedule_note = excluded.schedule_note, status = excluded.status,
        custom_status_label = excluded.custom_status_label, description = excluded.description,
        notes = excluded.notes, updated_at = excluded.updated_at
    `).run(
      id, name, type, customTypeLabel, fromWorld.id, toWorld.id,
      portal.fromNodeId ?? null, portal.toNodeId ?? null,
      portal.bidirectional === false ? 0 : 1,
      optionalText(portal.condition), optionalText(portal.cost), optionalText(portal.scheduleNote),
      status, customStatusLabel, optionalText(portal.description), optionalText(portal.notes),
      existing?.created_at ?? now, now,
    )
    return mapPortal(db.prepare('SELECT * FROM world_portals WHERE id = ?').get(id) as Row)
  }

  static upsertPortalFaction(link: WorldPortalFaction): WorldPortalFaction {
    const db = readyDb()
    const portal = requireEntityRow(db, 'world_portals', link?.portalId, 'portal', '世界通道')
    const faction = requireEntityRow(db, 'world_factions', link?.factionId, 'faction', '势力')
    const relation = requireEnum(link?.relation, WORLD_PORTAL_FACTION_RELATIONS, '通道势力关系')
    if (relation === 'custom' && !optionalText(link.customLabel)) throw new Error('自定义关系必须填写关系名称')
    const id = isSafeRelationId(link?.id, 'wporfa') ? link.id : `wporfa-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_portal_factions WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_portal_factions (id, portal_id, faction_id, relation, custom_label, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        portal_id = excluded.portal_id, faction_id = excluded.faction_id,
        relation = excluded.relation, custom_label = excluded.custom_label, note = excluded.note
    `).run(id, portal.id, faction.id, relation, optionalText(link.customLabel), optionalText(link.note), existing?.created_at ?? nowIso())
    return mapPortalFaction(db.prepare('SELECT * FROM world_portal_factions WHERE id = ?').get(id) as Row)
  }

  static upsertPortalCharacter(link: WorldPortalCharacter): WorldPortalCharacter {
    const db = readyDb()
    const portal = requireEntityRow(db, 'world_portals', link?.portalId, 'portal', '世界通道')
    requireCharacter(db, link?.characterId, '通道关联人物')
    const relation = requireEnum(link?.relation, WORLD_PORTAL_CHARACTER_RELATIONS, '通道人物关系')
    if (relation === 'custom' && !optionalText(link.customLabel)) throw new Error('自定义关系必须填写关系名称')
    const id = isSafeRelationId(link?.id, 'wporch') ? link.id : `wporch-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_portal_characters WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_portal_characters (id, portal_id, character_id, relation, custom_label, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        portal_id = excluded.portal_id, character_id = excluded.character_id,
        relation = excluded.relation, custom_label = excluded.custom_label, note = excluded.note
    `).run(id, portal.id, link.characterId.trim(), relation, optionalText(link.customLabel), optionalText(link.note), existing?.created_at ?? nowIso())
    return mapPortalCharacter(db.prepare('SELECT * FROM world_portal_characters WHERE id = ?').get(id) as Row)
  }

  // ---------- 5.7 世界规则 ----------

  static upsertRule(rule: WorldRule): WorldRule {
    const db = readyDb()
    const isNew = !isSafeEntityIdOfKind(rule?.id, 'rule')
    const id = isNew ? createWorldEntityId('rule') : rule.id
    const world = requireWorld(db, rule?.worldId)
    const name = requireText(rule?.name, '规则名称')
    const category = requireEnum(rule?.category ?? 'custom', WORLD_RULE_CATEGORIES, '规则分类')
    const customCategoryLabel = optionalText(rule.customCategoryLabel)
    if (category === 'custom' && !customCategoryLabel) throw new Error('自定义规则分类必须填写分类名称')
    const sourceKind = (rule?.sourceKind ?? 'author')
    if (sourceKind !== 'author' && sourceKind !== 'setting-rule' && sourceKind !== 'story-fact') {
      throw new Error('规则来源类型无效')
    }
    // 引用已有事实时必须保留原事实 ID；不得为了填写来源字段伪造来源。
    const sourceRefId = optionalText(rule.sourceRefId)
    if (sourceKind !== 'author' && !sourceRefId) {
      throw new Error('引用已有事实的规则必须保留原事实 ID，不能伪造来源')
    }
    if (sourceKind === 'author' && sourceRefId) {
      throw new Error('作者手写规则不能携带外部事实 ID')
    }
    const duplicate = db.prepare('SELECT id FROM world_rules WHERE world_id = ? AND name = ? COLLATE NOCASE AND id <> ?')
      .get(world.id, name, id) as { id: string } | undefined
    if (duplicate) throw new Error(`「${world.name}」中已存在同名规则「${name}」`)

    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_rules WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_rules (
        id, world_id, name, category, custom_category_label, content, scope_note,
        restriction, consequence, notes, source_kind, source_ref_id, source_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id, name = excluded.name, category = excluded.category,
        custom_category_label = excluded.custom_category_label, content = excluded.content,
        scope_note = excluded.scope_note, restriction = excluded.restriction,
        consequence = excluded.consequence, notes = excluded.notes,
        source_kind = excluded.source_kind, source_ref_id = excluded.source_ref_id,
        source_status = excluded.source_status, updated_at = excluded.updated_at
    `).run(
      id, world.id, name, category, customCategoryLabel, optionalText(rule.content),
      optionalText(rule.scopeNote), optionalText(rule.restriction), optionalText(rule.consequence),
      optionalText(rule.notes), sourceKind, sourceRefId,
      sourceKind === 'author' ? '' : optionalText(rule.sourceStatus),
      existing?.created_at ?? now, now,
    )
    return mapRule(db.prepare('SELECT * FROM world_rules WHERE id = ?').get(id) as Row)
  }

  /** 规则的适用/例外目标必须属于规则所属世界，否则拒绝。 */
  static upsertRuleTarget(target: WorldRuleTarget): WorldRuleTarget {
    const db = readyDb()
    const rule = requireEntityRow(db, 'world_rules', target?.ruleId, 'rule', '规则')
    const ruleWorld = (db.prepare('SELECT world_id FROM world_rules WHERE id = ?').get(rule.id) as { world_id: string }).world_id
    const role = requireEnum(target?.role, ['scope', 'exception'] as const, '规则目标类型')
    const targetKind = requireEnum(target?.targetKind, ['node', 'relic'] as const, '规则目标种类')
    if (targetKind === 'node') {
      requireNodeInWorld(db, target?.targetId, ruleWorld, role === 'exception' ? '规则例外地点' : '规则适用范围地点')
    } else {
      const relic = requireEntityRow(db, 'world_relics', target?.targetId, 'relic', '秘境')
      const relicWorld = (db.prepare('SELECT world_id FROM world_relics WHERE id = ?').get(relic.id) as { world_id: string }).world_id
      if (relicWorld !== ruleWorld) {
        throw new Error(`秘境「${relic.name}」不属于规则「${rule.name}」所在的世界，已拒绝跨世界引用`)
      }
    }
    const id = isSafeRelationId(target?.id, 'wrltgt') ? target.id : `wrltgt-${randomUUID()}`
    const existing = db.prepare('SELECT created_at FROM world_rule_targets WHERE id = ?').get(id) as { created_at: string } | undefined
    db.prepare(`
      INSERT INTO world_rule_targets (id, rule_id, role, target_kind, target_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rule_id = excluded.rule_id, role = excluded.role, target_kind = excluded.target_kind,
        target_id = excluded.target_id, note = excluded.note
    `).run(id, rule.id, role, targetKind, String(target.targetId), optionalText(target.note), existing?.created_at ?? nowIso())
    return mapRuleTarget(db.prepare('SELECT * FROM world_rule_targets WHERE id = ?').get(id) as Row)
  }

  // ---------- 5.4 人物 ↔ 世界 ----------

  static upsertCharacterLink(link: WorldCharacterLink): WorldCharacterLink {
    const db = readyDb()
    const world = requireWorld(db, link?.worldId)
    requireCharacter(db, link?.characterId, '世界人物关联')
    const id = isSafeRelationId(link?.id, 'wchlink') ? link.id : `wchlink-${randomUUID()}`
    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_character_links WHERE id = ?').get(id) as { created_at: string } | undefined
    // 同一人物在同一世界只保留一条关联：重复保存即更新关系说明，不产生两份矛盾数据。
    const conflict = db.prepare('SELECT id FROM world_character_links WHERE world_id = ? AND character_id = ? AND id <> ?')
      .get(world.id, link.characterId.trim(), id) as { id: string } | undefined
    if (conflict) {
      db.prepare(`
        UPDATE world_character_links SET relation = ?, note = ?, updated_at = ? WHERE id = ?
      `).run(optionalText(link.relation), optionalText(link.note), now, conflict.id)
      return mapCharacterLink(db.prepare('SELECT * FROM world_character_links WHERE id = ?').get(conflict.id) as Row)
    }
    db.prepare(`
      INSERT INTO world_character_links (id, world_id, character_id, relation, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id, character_id = excluded.character_id,
        relation = excluded.relation, note = excluded.note, updated_at = excluded.updated_at
    `).run(
      id, world.id, link.characterId.trim(), optionalText(link.relation), optionalText(link.note),
      existing?.created_at ?? now, now,
    )
    return mapCharacterLink(db.prepare('SELECT * FROM world_character_links WHERE id = ?').get(id) as Row)
  }

  // ---------- 5.5 出生地 ----------

  /**
   * 出生地是纯背景信息：它与目前所在地互不覆盖，也绝不触碰
   * characters.cs_location 或任何动态状态。
   */
  static saveBirthLocation(location: WorldCharacterLocation): WorldCharacterLocation {
    const db = readyDb()
    requireCharacter(db, location?.characterId, '出生地关联')
    const worldId = location?.worldId ? requireWorld(db, location.worldId).id : null
    const node = nodeForLocation(db, location?.nodeId ?? null, worldId, '出生地地点')
    const id = isSafeRelationId(location?.id, 'wchloc') ? location.id : `wchloc-${randomUUID()}`
    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_character_locations WHERE id = ?').get(id) as { created_at: string } | undefined
    const conflict = db.prepare(`SELECT id FROM world_character_locations WHERE character_id = ? AND kind = 'birth' AND id <> ?`)
      .get(location.characterId.trim(), id) as { id: string } | undefined
    const targetId = conflict?.id ?? id
    db.prepare(`
      INSERT INTO world_character_locations (
        id, character_id, kind, world_id, node_id, note, story_time_label, time_precision,
        chapter_number, bound_location_text, bound_provenance_kind, bound_at, created_at, updated_at
      ) VALUES (?, ?, 'birth', ?, ?, ?, '', 'unknown', NULL, '', '', '', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id, node_id = excluded.node_id, note = excluded.note,
        updated_at = excluded.updated_at
    `).run(
      targetId, location.characterId.trim(), worldId, node?.id ?? null, optionalText(location.note),
      existing?.created_at ?? now, now,
    )
    return mapCharacterLocation(db.prepare('SELECT * FROM world_character_locations WHERE id = ?').get(targetId) as Row)
  }

  // ---------- 5.5 目前所在地 ----------

  /**
   * 显式设置结构化目前所在地。
   *
   * 这是作者对「角色当前位置」的一次真实业务提交，因此：
   * 1. 在同一个事务里通过 CharacterRosterRepository.commit（intent=manual_edit）
   *    写入 characters.cs_location 与字段级来源 author，维持 revision/投影一致；
   * 2. 事务内同时写结构化绑定行，记录绑定时的文字与来源，供后续检测失效；
   * 3. 只改 location 与它的来源，其他动态状态原样保留。
   */
  static commitCurrentLocation(
    characterId: string,
    worldId: string | null,
    nodeId: string | null,
    options: WorldCurrentLocationCommitOptions = {},
  ): WorldLocationCommitResult {
    const db = readyDb()
    const character = requireCharacter(db, characterId, '目前所在地')
    const resolvedWorldId = worldId ? requireWorld(db, worldId).id : null
    const node = nodeForLocation(db, nodeId, resolvedWorldId, '目前所在地地点')

    const derivedText = options.locationText?.trim()
      || describeLocation(db, resolvedWorldId, node?.id ?? null, node?.name ?? null)
    if (!derivedText) {
      throw new Error('请至少选择世界或地点，或填写位置说明，才能设定目前所在地')
    }

    return db.transaction(() => {
      const snapshot = adoptLegacyRosterIfNeeded()
      const target = snapshot.entries.find(entry => entry.name === character.name)
      if (!target) {
        throw new Error(`角色「${character.name}」尚未进入角色名单，无法写入结构化位置；请先保存角色资料`)
      }
      const requestedChapter = optionalInteger(options.chapterNumber ?? null, '关联章节')
      const effectiveChapter = requestedChapter ?? target.currentState?.updatedAtChapter ?? 0
      const nextState = withAuthorLocation(target, derivedText, effectiveChapter)
      const entries = snapshot.entries.map(entry => (
        entry.name === character.name ? { ...entry, currentState: nextState } : entry
      ))
      const receipt = CharacterRosterRepository.commit({
        operationId: `world-current-location-${randomUUID()}`,
        expectedRevision: snapshot.revision,
        schemaVersion: CHARACTER_ROSTER_SCHEMA_VERSION,
        entries,
        intent: 'manual_edit',
      })
      WorldWorkbenchRepository.writeCurrentBinding(db, {
        characterId: character.character_id,
        worldId: resolvedWorldId,
        nodeId: node?.id ?? null,
        note: options.locationText?.trim() ?? '',
        storyTimeLabel: optionalText(options.storyTimeLabel),
        timePrecision: requirePrecision(options.timePrecision, '剧情时间'),
        chapterNumber: requestedChapter,
        boundLocationText: derivedText,
        boundProvenanceKind: 'author',
      })
      return { success: true, locationText: derivedText, rosterRevision: receipt.revision }
    })()
  }

  /**
   * 取消结构化目前所在地绑定。
   * 明确不修改 characters.cs_location：旧文字位置原样保留，只把结构化绑定解绑，
   * 界面据此显示「未设定，需要重新确认」。
   */
  static clearCurrentLocationBinding(characterId: string): void {
    const db = readyDb()
    const character = requireCharacter(db, characterId, '目前所在地')
    db.prepare(`
      UPDATE world_character_locations
      SET world_id = NULL, node_id = NULL, story_time_label = '', time_precision = 'unknown',
          chapter_number = NULL, bound_location_text = '', bound_provenance_kind = '', bound_at = '',
          updated_at = ?
      WHERE character_id = ? AND kind = 'current'
    `).run(nowIso(), character.character_id)
  }

  private static writeCurrentBinding(
    db: BetterSqlite3.Database,
    binding: {
      characterId: string
      worldId: string | null
      nodeId: string | null
      note: string
      storyTimeLabel: string
      timePrecision: StoryTimelinePrecision
      chapterNumber: number | null
      boundLocationText: string
      boundProvenanceKind: string
    },
  ): void {
    const now = nowIso()
    const existing = db.prepare(`SELECT id, created_at FROM world_character_locations WHERE character_id = ? AND kind = 'current'`)
      .get(binding.characterId) as { id: string; created_at: string } | undefined
    const id = existing?.id ?? `wchloc-${randomUUID()}`
    db.prepare(`
      INSERT INTO world_character_locations (
        id, character_id, kind, world_id, node_id, note, story_time_label, time_precision,
        chapter_number, bound_location_text, bound_provenance_kind, bound_at, created_at, updated_at
      ) VALUES (?, ?, 'current', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        world_id = excluded.world_id, node_id = excluded.node_id, note = excluded.note,
        story_time_label = excluded.story_time_label, time_precision = excluded.time_precision,
        chapter_number = excluded.chapter_number, bound_location_text = excluded.bound_location_text,
        bound_provenance_kind = excluded.bound_provenance_kind, bound_at = excluded.bound_at,
        updated_at = excluded.updated_at
    `).run(
      id, binding.characterId, binding.worldId, binding.nodeId, binding.note,
      binding.storyTimeLabel, binding.timePrecision, binding.chapterNumber,
      binding.boundLocationText, binding.boundProvenanceKind, now,
      existing?.created_at ?? now, now,
    )
  }

  // ---------- 5.9 人物行踪 ----------

  /**
   * 保存行踪。默认不改变目前所在地；勾选 alsoSetCurrentLocation 时，
   * 行踪写入与位置更新在**同一个事务**里成功或回滚。
   */
  static commitTrail(request: WorldTrailCommitRequest): WorldTrailCommitResult {
    const db = readyDb()
    const trail = request?.trail
    const character = requireCharacter(db, trail?.characterId, '行踪人物')
    const world = requireWorld(db, trail?.worldId)
    const node = nodeForLocation(db, trail?.nodeId ?? null, world.id, '行踪地点')
    const timePrecision = requirePrecision(trail?.timePrecision, '行踪时间')
    const arrivedLabel = optionalText(trail.arrivedLabel)
    const departedLabel = optionalText(trail.departedLabel)
    validateTrailTimeRange(arrivedLabel, departedLabel, timePrecision)

    const portalId = trail?.portalId ? requirePortalForTrail(db, trail.portalId, world.id, node?.id ?? null) : null
    const eventId = trail?.eventId ? requireTimelineEvent(db, trail.eventId) : null

    const id = isSafeEntityIdOfKind(trail?.id, 'trail') ? trail.id : createWorldEntityId('trail')
    const now = nowIso()
    const existing = db.prepare('SELECT created_at FROM world_trails WHERE id = ?').get(id) as { created_at: string } | undefined
    const sortOrder = trail?.sortOrder === undefined ? 0 : requireFiniteNumber(trail.sortOrder, '行踪排序刻度')
    const chapterNumber = optionalInteger(trail?.chapterNumber ?? null, '关联章节')

    return db.transaction(() => {
      db.prepare(`
        INSERT INTO world_trails (
          id, character_id, world_id, node_id, note, arrived_label, departed_label, time_precision,
          sort_order, reason, chapter_number, notes, portal_id, event_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          character_id = excluded.character_id, world_id = excluded.world_id, node_id = excluded.node_id,
          note = excluded.note, arrived_label = excluded.arrived_label,
          departed_label = excluded.departed_label, time_precision = excluded.time_precision,
          sort_order = excluded.sort_order, reason = excluded.reason,
          chapter_number = excluded.chapter_number, notes = excluded.notes,
          portal_id = excluded.portal_id, event_id = excluded.event_id,
          updated_at = excluded.updated_at
      `).run(
        id, character.character_id, world.id, node?.id ?? null, optionalText(trail.note),
        arrivedLabel, departedLabel, timePrecision, sortOrder, optionalText(trail.reason),
        chapterNumber, optionalText(trail.notes), portalId, eventId,
        existing?.created_at ?? now, now,
      )

      let rosterRevision: number | undefined
      if (request.alsoSetCurrentLocation) {
        const options = request.currentLocation ?? {}
        const result = WorldWorkbenchRepository.commitCurrentLocation(
          character.character_id,
          world.id,
          node?.id ?? null,
          options,
        )
        if (!result.success) throw new Error(result.error || '同步目前所在地失败')
        rosterRevision = result.rosterRevision
      }
      // 只有显式勾选时才登记「这条行踪就是当前位置」的依赖关系。
      const wasBound = Boolean(db.prepare('SELECT 1 FROM world_trail_current_bindings WHERE trail_id = ?').get(id))
      if (request.alsoSetCurrentLocation && !wasBound) {
        db.prepare('INSERT INTO world_trail_current_bindings (trail_id, character_id) VALUES (?, ?)')
          .run(id, character.character_id)
      } else if (!request.alsoSetCurrentLocation && wasBound) {
        // 取消勾选即显式解除该行踪与当前位置的依赖。
        db.prepare('DELETE FROM world_trail_current_bindings WHERE trail_id = ?').run(id)
      }
      const saved = mapTrail(db.prepare('SELECT * FROM world_trails WHERE id = ?').get(id) as Row)
      return { success: true, trail: saved, rosterRevision }
    })()
  }

  /** 行踪与当前位置的依赖情况（用于编辑/删除前的显式确认）。 */
  static getTrailBinding(trailId: string): { bound: boolean; characterId: string | null } {
    const db = readyDb()
    const row = db.prepare('SELECT character_id FROM world_trail_current_bindings WHERE trail_id = ?')
      .get(trailId) as { character_id: string } | undefined
    return { bound: Boolean(row), characterId: row?.character_id ?? null }
  }

  // ---------- 5.8 事件关联 ----------

  /**
   * 原子替换一个时间线事件的世界关联与实体关联。
   * 事件本体仍由 story_timeline_events 拥有；这里只维护关系，绝不复制事件内容。
   */
  static saveEventLinks(eventId: string, worldIds: readonly string[], links: readonly WorldEventLink[]): void {
    const db = readyDb()
    const event = requireTimelineEvent(db, eventId)
    const uniqueWorldIds = [...new Set(worldIds.filter(Boolean))]
    for (const worldId of uniqueWorldIds) requireWorld(db, worldId)
    const normalizedLinks = links.map((link, index) => normalizeEventLink(db, link, `事件关联 #${index + 1}`))
    const now = nowIso()

    db.transaction(() => {
      db.prepare('DELETE FROM world_event_worlds WHERE event_id = ?').run(event)
      const insertWorld = db.prepare('INSERT INTO world_event_worlds (event_id, world_id) VALUES (?, ?)')
      for (const worldId of uniqueWorldIds) insertWorld.run(event, worldId)

      db.prepare('DELETE FROM world_event_links WHERE event_id = ?').run(event)
      const insertLink = db.prepare(`
        INSERT INTO world_event_links (id, event_id, target_kind, target_id, world_id, relation, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const seen = new Set<string>()
      for (const link of normalizedLinks) {
        const key = `${link.targetKind}:${link.targetId}`
        if (seen.has(key)) continue
        seen.add(key)
        insertLink.run(
          isSafeRelationId(link.id, 'wevlink') ? link.id : `wevlink-${randomUUID()}`,
          event, link.targetKind, link.targetId, link.worldId, link.relation, link.note, now,
        )
      }
    })()
  }

  // ---------- 删除影响预览与删除 ----------

  static planDelete(kind: WorldEntityKind, entityId: string): WorldDeletePlan {
    const db = readyDb()
    const blockers: WorldDeleteBlocker[] = []
    let entityName = ''
    let cascadedRelationCount = 0

    if (kind === 'world') {
      const world = requireWorld(db, entityId)
      entityName = world.name
      const pushByWorld = (table: string, idColumn: string, label: string) => {
        const rows = db.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE world_id = ?`).all(entityId) as Array<{ id: string }>
        if (rows.length > 0) {
          blockers.push({ kind: label, label, count: rows.length, ids: rows.slice(0, 50).map(row => row.id) })
        }
      }
      pushByWorld('world_factions', 'id', '势力')
      pushByWorld('world_relics', 'id', '秘境')
      pushByWorld('world_rules', 'id', '规则')
      pushByWorld('world_character_links', 'id', '人物关联')
      pushByWorld('world_trails', 'id', '人物行踪')
      pushByWorld('world_character_locations', 'id', '人物位置')
      // world_event_worlds 是世界 ↔ 事件的复合主键表，没有自己的 id 列。
      pushByWorld('world_event_worlds', 'event_id', '历史事件')
      pushByWorld('world_maps', 'id', '关联地图')
      const portals = db.prepare('SELECT id FROM world_portals WHERE from_world_id = ? OR to_world_id = ?')
        .all(entityId, entityId) as Array<{ id: string }>
      if (portals.length > 0) {
        blockers.push({ kind: 'portal', label: '世界通道', count: portals.length, ids: portals.map(row => row.id) })
      }
      return {
        entityKind: kind,
        entityId,
        entityName,
        blockers,
        cascadedRelationCount: 0,
        removedRowCount: 1,
      }
    }

    if (kind === 'faction') {
      const faction = requireEntityRow(db, 'world_factions', entityId, kind, '势力')
      entityName = faction.name
      cascadedRelationCount = countRows(db, [
        ['world_faction_places', 'faction_id = ?'],
        ['world_faction_relations', 'from_faction_id = ? OR to_faction_id = ?'],
        ['world_faction_characters', 'faction_id = ?'],
        ['world_relic_factions', 'faction_id = ?'],
        ['world_portal_factions', 'faction_id = ?'],
      ], entityId)
      pushBlockers(blockers, db, 'world_event_links', 'target_kind = ? AND target_id = ?', ['faction', entityId], '历史事件引用')
    } else if (kind === 'relic') {
      const relic = requireEntityRow(db, 'world_relics', entityId, kind, '秘境')
      entityName = relic.name
      cascadedRelationCount = countRows(db, [
        ['world_relic_factions', 'relic_id = ?'],
        ['world_relic_characters', 'relic_id = ?'],
      ], entityId)
      pushBlockers(blockers, db, 'world_event_links', 'target_kind = ? AND target_id = ?', ['relic', entityId], '历史事件引用')
      pushBlockers(blockers, db, 'world_rule_targets', "role = 'exception' AND target_kind = 'relic' AND target_id = ?", [entityId], '规则例外引用')
      pushBlockers(blockers, db, 'world_rule_targets', "role = 'scope' AND target_kind = 'relic' AND target_id = ?", [entityId], '规则适用范围引用')
    } else if (kind === 'portal') {
      const portal = requireEntityRow(db, 'world_portals', entityId, kind, '世界通道')
      entityName = portal.name
      cascadedRelationCount = countRows(db, [
        ['world_portal_factions', 'portal_id = ?'],
        ['world_portal_characters', 'portal_id = ?'],
      ], entityId)
      pushBlockers(blockers, db, 'world_trails', 'portal_id = ?', [entityId], '人物行踪引用')
      pushBlockers(blockers, db, 'world_event_links', 'target_kind = ? AND target_id = ?', ['portal', entityId], '历史事件引用')
    } else if (kind === 'rule') {
      const rule = requireEntityRow(db, 'world_rules', entityId, kind, '规则')
      entityName = rule.name
      cascadedRelationCount = countRows(db, [['world_rule_targets', 'rule_id = ?']], entityId)
      pushBlockers(blockers, db, 'world_event_links', 'target_kind = ? AND target_id = ?', ['rule', entityId], '历史事件引用')
    } else if (kind === 'trail') {
      const trailRow = db.prepare('SELECT * FROM world_trails WHERE id = ?').get(entityId) as Row | undefined
      if (!trailRow) throw new Error('人物行踪不存在或已删除')
      const trail = mapTrail(trailRow)
      const character = db.prepare('SELECT name FROM character_identities WHERE character_id = ?')
        .get(trail.characterId) as { name: string } | undefined
      entityName = `${character?.name ?? trail.characterId} @ ${trail.arrivedLabel || trail.sortOrder}`
      // 被用于目前所在地的行踪删掉后，位置就需要作者重新确认；必须显式处理。
      const bound = db.prepare('SELECT 1 FROM world_trail_current_bindings WHERE trail_id = ?').get(entityId)
      if (bound) {
        blockers.push({
          kind: 'current-location-binding',
          label: '该行踪被设为目前所在地',
          count: 1,
          ids: [entityId],
        })
      }
    } else {
      throw new Error('该实体类型不支持删除影响预览')
    }

    return {
      entityKind: kind,
      entityId,
      entityName,
      blockers,
      cascadedRelationCount,
      removedRowCount: 1 + cascadedRelationCount,
    }
  }

  /**
   * 删除实体。blockers 非空时默认拒绝；
   * `options.releaseCurrentLocation` 用于显式确认解除行踪与目前所在地的绑定。
   * 删除关系永远不删除目标实体：删除势力不删人物，删除地点不删秘境资料。
   */
  static deleteEntity(
    kind: WorldEntityKind,
    entityId: string,
    options: { releaseCurrentLocation?: boolean; detachEventLinks?: boolean } = {},
  ): WorldDeletePlan {
    const db = readyDb()
    const plan = WorldWorkbenchRepository.planDelete(kind, entityId)
    const remaining = options.releaseCurrentLocation
      ? plan.blockers.filter(blocker => blocker.kind !== 'current-location-binding')
      : plan.blockers
    const eventOnly = options.detachEventLinks
      ? remaining.filter(blocker => blocker.kind !== '历史事件引用')
      : remaining
    if (eventOnly.length > 0) {
      const total = eventOnly.reduce((sum, item) => sum + item.count, 0)
      throw new Error(`「${plan.entityName}」仍被 ${total} 项资料引用，请先解除依赖后再删除`)
    }

    db.transaction(() => {
      if (options.releaseCurrentLocation && kind === 'trail') {
        const characterId = (db.prepare('SELECT character_id FROM world_trail_current_bindings WHERE trail_id = ?')
          .get(entityId) as { character_id: string } | undefined)?.character_id
        db.prepare('DELETE FROM world_trail_current_bindings WHERE trail_id = ?').run(entityId)
        if (characterId) WorldWorkbenchRepository.clearCurrentLocationBinding(characterId)
      }
      if (options.detachEventLinks) {
        db.prepare('DELETE FROM world_event_links WHERE target_kind = ? AND target_id = ?')
          .run(kind === 'world' ? 'world' : kind, entityId)
      }
      const table = ENTITY_TABLE[kind]
      if (!table) throw new Error('该实体类型不支持删除')
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(entityId)
    })()
    return plan
  }

  static deleteRelation(table: string, id: string): void {
    const db = readyDb()
    if (!RELATION_TABLES.has(table)) throw new Error('未知的关系表')
    if (!id) throw new Error('缺少关系标识')
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    if (result.changes === 0) throw new Error('要解除的关联不存在或已被解除')
  }
}

const ENTITY_TABLE: Partial<Record<WorldEntityKind, string>> = {
  world: 'worlds',
  faction: 'world_factions',
  relic: 'world_relics',
  portal: 'world_portals',
  rule: 'world_rules',
  trail: 'world_trails',
}

const RELATION_TABLES = new Set([
  'world_faction_places',
  'world_faction_relations',
  'world_faction_characters',
  'world_relic_factions',
  'world_relic_characters',
  'world_portal_factions',
  'world_portal_characters',
  'world_rule_targets',
  'world_character_links',
  'world_event_links',
])

function countRows(
  db: BetterSqlite3.Database,
  queries: Array<[table: string, where: string]>,
  entityId: string,
): number {
  let total = 0
  for (const [table, where] of queries) {
    const params = where.includes(' OR ') ? [entityId, entityId] : [entityId]
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params) as { count: number }
    total += row.count
  }
  return total
}

function pushBlockers(
  target: WorldDeleteBlocker[],
  db: BetterSqlite3.Database,
  table: string,
  where: string,
  params: unknown[],
  label: string,
): void {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...params) as Array<{ id: string }>
  if (rows.length > 0) {
    target.push({ kind: label, label, count: rows.length, ids: rows.slice(0, 50).map(row => row.id) })
  }
}

function nodeForLocation(
  db: BetterSqlite3.Database,
  nodeId: string | null | undefined,
  worldId: string | null,
  label: string,
): NodeRow | null {
  if (!nodeId) return null
  if (!worldId) throw new Error(`选择了${label}就必须同时选择所属世界`)
  return requireNodeInWorld(db, nodeId, worldId, label)
}

/**
 * 结构化位置必须走角色名单的同一业务提交，不能绕过 revision / 投影一致性。
 *
 * 旧项目（已有角色卡但名单还没有确定性投影）在迁移后处于
 * `legacy_cards_preserved`：这是升级后第一次写入的正常状态，而不是损坏。
 * 这里按既有 cultivation-repository 的同一做法，用角色名单自己的
 * `legacy_cards_adoption` 显式重建只读投影——它只重算已存在角色卡的投影，
 * 绝不改写卡片内容、也不新增任何事实。之后的实际位置写入仍然是一次
 * `manual_edit` 业务提交。
 *
 * 其它不可写状态（投影哈希不匹配、需要旧图谱修复）意味着有绕过名单的写入，
 * 属于真正需要作者处理的情形，直接拒绝并给出可操作的说明。
 */
function adoptLegacyRosterIfNeeded(): ReturnType<typeof CharacterRosterRepository.read> {
  const snapshot = CharacterRosterRepository.read()
  if (snapshot.migrationState === 'legacy_cards_preserved' && snapshot.status === 'inconsistent') {
    const receipt = CharacterRosterRepository.commit({
      operationId: `world-roster-adoption-${randomUUID()}`,
      expectedRevision: snapshot.revision,
      schemaVersion: CHARACTER_ROSTER_SCHEMA_VERSION,
      entries: snapshot.entries,
      intent: 'legacy_cards_adoption',
      // 采用已有卡片必须回传它读到的旧图谱证据，否则等于允许把过期的
      // 修复结果写进之后已经变化的项目。
      expectedLegacyMarkdown: snapshot.legacyMarkdown ?? '',
    })
    return receipt.snapshot
  }
  if (snapshot.status === 'inconsistent' || snapshot.status === 'legacy_repair_required') {
    throw new Error('角色名单处于需要修复的状态，已拒绝写入当前位置；请先在角色管理中保存一次角色名单')
  }
  return snapshot
}

/** 位置展示文字：世界名 +（可选）地点名 +（可选）作者补充说明。 */
function describeLocation(
  db: BetterSqlite3.Database,
  worldId: string | null,
  nodeId: string | null,
  nodeName: string | null,
): string {
  const parts: string[] = []
  if (worldId) parts.push(worldLabelOf(db, worldId))
  if (nodeId && nodeName) parts.push(nodeName)
  return parts.join(' · ')
}

/** 只改 location 与它的字段级来源，其他动态状态与已有来源原样保留。 */
function withAuthorLocation(
  entry: CharacterRosterEntry,
  locationText: string,
  chapterNumber: number,
): NonNullable<CharacterRosterEntry['currentState']> {
  const previous = entry.currentState
  const provenance = { ...(previous?.provenance ?? {}) }
  provenance.location = { kind: 'author', chapterNumber }
  return {
    location: locationText,
    powerLevel: previous?.powerLevel ?? '',
    physicalState: previous?.physicalState ?? '',
    mentalState: previous?.mentalState ?? '',
    keyItems: previous?.keyItems ?? '',
    recentEvents: previous?.recentEvents ?? '',
    updatedAtChapter: previous?.updatedAtChapter ?? chapterNumber,
    provenance,
  }
}

function requireTimelineEvent(db: BetterSqlite3.Database, eventId: unknown): string {
  if (typeof eventId !== 'string' || !eventId.trim()) throw new Error('关联事件标识无效')
  const row = db.prepare('SELECT id FROM story_timeline_events WHERE id = ?').get(eventId.trim()) as { id: string } | undefined
  if (!row) throw new Error('关联的时间线事件不存在或已删除')
  return row.id
}

/**
 * 行踪关联通道时的世界/地点一致性：
 * - 行踪世界必须是通道的某一端世界；
 * - 若通道在那一端设了具体入口地点，行踪地点必须与之相同；
 * - 通道那一端未设地点（世界级）时，允许同世界的任意地点或未设地点。
 */
function requirePortalForTrail(
  db: BetterSqlite3.Database,
  portalId: unknown,
  trailWorldId: string,
  trailNodeId: string | null,
): string {
  if (!isSafeEntityIdOfKind(portalId, 'portal')) throw new Error('关联通道标识无效')
  const portal = db.prepare('SELECT id, name, from_world_id, to_world_id, from_node_id, to_node_id FROM world_portals WHERE id = ?')
    .get(portalId) as {
      id: string
      name: string
      from_world_id: string
      to_world_id: string
      from_node_id: string | null
      to_node_id: string | null
    } | undefined
  if (!portal) throw new Error('关联的世界通道不存在或已删除')
  const isFrom = portal.from_world_id === trailWorldId
  const isTo = portal.to_world_id === trailWorldId
  if (!isFrom && !isTo) {
    throw new Error(`通道「${portal.name}」的两端都不是「${worldLabelOf(db, trailWorldId)}」，行踪世界与通道不匹配`)
  }
  const endpointNode = isFrom ? portal.from_node_id : portal.to_node_id
  if (endpointNode && trailNodeId && endpointNode !== trailNodeId) {
    throw new Error(`行踪地点与通道「${portal.name}」在该世界的入口地点不一致`)
  }
  return portal.id
}

/**
 * 只有在到达/离开都是纯数字（可靠可比较刻度）时才校验先后顺序。
 * 未知与相对时间直接放行，绝不把虚构纪年强行解析为真实日期。
 */
function validateTrailTimeRange(
  arrivedLabel: string,
  departedLabel: string,
  precision: StoryTimelinePrecision,
): void {
  if (precision === 'unknown' || precision === 'relative') return
  const arrived = parseComparableTick(arrivedLabel)
  const departed = parseComparableTick(departedLabel)
  if (arrived === null || departed === null) return
  if (departed < arrived) throw new Error('离开时间不能早于到达时间')
}

function normalizeEventLink(
  db: BetterSqlite3.Database,
  link: WorldEventLink,
  label: string,
): WorldEventLink {
  const targetKind = requireEnum(link?.targetKind, ['faction', 'relic', 'portal', 'character', 'node', 'rule'] as const, `${label}种类`)
  const targetId = requireText(link?.targetId, `${label}目标`)
  let worldId: string | null
  switch (targetKind) {
    case 'faction': {
      const row = requireEntityRow(db, 'world_factions', targetId, 'faction', '势力')
      worldId = (db.prepare('SELECT world_id FROM world_factions WHERE id = ?').get(row.id) as { world_id: string }).world_id
      break
    }
    case 'relic': {
      const row = requireEntityRow(db, 'world_relics', targetId, 'relic', '秘境')
      worldId = (db.prepare('SELECT world_id FROM world_relics WHERE id = ?').get(row.id) as { world_id: string }).world_id
      break
    }
    case 'portal': {
      requireEntityRow(db, 'world_portals', targetId, 'portal', '世界通道')
      // 通道横跨两个世界，因此没有单一世界归属。
      worldId = null
      break
    }
    case 'rule': {
      const row = requireEntityRow(db, 'world_rules', targetId, 'rule', '规则')
      worldId = (db.prepare('SELECT world_id FROM world_rules WHERE id = ?').get(row.id) as { world_id: string }).world_id
      break
    }
    case 'node': {
      const node = requireNode(db, targetId, '事件地点')
      worldId = worldOfNode(db, node.id)
      break
    }
    default: {
      // 人物可以关联多个世界，因此世界归属由调用方给出的链接世界决定。
      requireCharacter(db, targetId, `${label}人物`)
      worldId = link.worldId ? requireWorld(db, link.worldId).id : null
      break
    }
  }
  return {
    id: isSafeRelationId(link.id, 'wevlink') ? link.id : `wevlink-${randomUUID()}`,
    eventId: link.eventId,
    targetKind,
    targetId,
    worldId,
    relation: optionalText(link.relation),
    note: optionalText(link.note),
    createdAt: link.createdAt,
  }
}

export { detachWorldReferencesForCharacter, hasWorldWorkbenchTables }
