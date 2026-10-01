/**
 * world-workbench 幂等 schema 服务。
 *
 * 规则：
 * - 只新增表与可空列，绝不删除或重写既有行；重复执行不丢内容。
 * - 旧地图、节点、连线、图片、角色、时间线、文字位置全部原样保留。
 * - 未归属资料保持未关联：迁移不猜测归属、不创建默认世界、不升级候选状态。
 */
import type BetterSqlite3 from 'better-sqlite3'

import { WORLD_WORKBENCH_SCHEMA_VERSION } from '../../src/shared/world-workbench'

const MIGRATION_ID = 'world-workbench-v1'

interface TableInfoRow {
  name: string
}

export function tableExists(db: BetterSqlite3.Database, tableName: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName),
  )
}

export function tableColumns(db: BetterSqlite3.Database, tableName: string): Set<string> {
  if (!tableExists(db, tableName)) return new Set()
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[]).map(row => row.name),
  )
}

/** 只在列确实缺失时补列；旧库补列后既有行保持原值（NULL）。 */
function addColumnIfMissing(
  db: BetterSqlite3.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  if (!tableExists(db, tableName)) return
  if (tableColumns(db, tableName).has(columnName)) return
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}

/**
 * 世界资料 schema。表名与列名都以作者资料为主：
 * - world_*       世界本体、势力、秘境、通道、规则、行踪
 * - world_*_links 各类显式关系表（关系也是实体，拥有稳定 ID）
 * 关系表引用 world_map_nodes / character_identities / story_timeline_events 时
 * 使用兼容外键：既有表的主键已存在，因此这些外键是真实可用的。
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    background TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_worlds_order ON worlds(sort_order, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_worlds_name ON worlds(name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS world_factions (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    seat TEXT NOT NULL DEFAULT '',
    domain_note TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_factions_world ON world_factions(world_id, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_factions_world_name
    ON world_factions(world_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS world_faction_places (
    id TEXT PRIMARY KEY,
    faction_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (faction_id) REFERENCES world_factions(id) ON DELETE CASCADE,
    -- 地点被删除时只解除引用（作者显式确认后才会走到这里），资料本身保留。
    FOREIGN KEY (node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_faction_places_pair
    ON world_faction_places(faction_id, node_id);
  CREATE INDEX IF NOT EXISTS idx_world_faction_places_node ON world_faction_places(node_id);

  CREATE TABLE IF NOT EXISTS world_faction_relations (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    from_faction_id TEXT NOT NULL,
    to_faction_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    custom_label TEXT NOT NULL DEFAULT '',
    directed INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_faction_id) REFERENCES world_factions(id) ON DELETE CASCADE,
    FOREIGN KEY (to_faction_id) REFERENCES world_factions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_world_faction_relations_world ON world_faction_relations(world_id);
  CREATE INDEX IF NOT EXISTS idx_world_faction_relations_from ON world_faction_relations(from_faction_id);
  CREATE INDEX IF NOT EXISTS idx_world_faction_relations_to ON world_faction_relations(to_faction_id);

  CREATE TABLE IF NOT EXISTS world_faction_characters (
    id TEXT PRIMARY KEY,
    faction_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    tenure_note TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (faction_id) REFERENCES world_factions(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_faction_characters_faction ON world_faction_characters(faction_id);
  CREATE INDEX IF NOT EXISTS idx_world_faction_characters_character ON world_faction_characters(character_id);

  CREATE TABLE IF NOT EXISTS world_relics (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    location_note TEXT NOT NULL DEFAULT '',
    node_id TEXT DEFAULT NULL,
    entrance_node_id TEXT DEFAULT NULL,
    entry_condition TEXT NOT NULL DEFAULT '',
    danger TEXT NOT NULL DEFAULT '',
    rewards TEXT NOT NULL DEFAULT '',
    availability_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'undiscovered',
    custom_status_label TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id),
    FOREIGN KEY (node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL,
    FOREIGN KEY (entrance_node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_world_relics_world ON world_relics(world_id, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_relics_world_name
    ON world_relics(world_id, name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_world_relics_node ON world_relics(node_id);
  CREATE INDEX IF NOT EXISTS idx_world_relics_entrance ON world_relics(entrance_node_id);

  CREATE TABLE IF NOT EXISTS world_relic_factions (
    id TEXT PRIMARY KEY,
    relic_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    custom_label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (relic_id) REFERENCES world_relics(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES world_factions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_world_relic_factions_relic ON world_relic_factions(relic_id);
  CREATE INDEX IF NOT EXISTS idx_world_relic_factions_faction ON world_relic_factions(faction_id);

  CREATE TABLE IF NOT EXISTS world_relic_characters (
    id TEXT PRIMARY KEY,
    relic_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    custom_label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (relic_id) REFERENCES world_relics(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_relic_characters_relic ON world_relic_characters(relic_id);
  CREATE INDEX IF NOT EXISTS idx_world_relic_characters_character ON world_relic_characters(character_id);

  CREATE TABLE IF NOT EXISTS world_portals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'teleport',
    custom_type_label TEXT NOT NULL DEFAULT '',
    from_world_id TEXT NOT NULL,
    to_world_id TEXT NOT NULL,
    from_node_id TEXT DEFAULT NULL,
    to_node_id TEXT DEFAULT NULL,
    bidirectional INTEGER NOT NULL DEFAULT 1,
    condition TEXT NOT NULL DEFAULT '',
    cost TEXT NOT NULL DEFAULT '',
    schedule_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    custom_status_label TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_world_id) REFERENCES worlds(id),
    FOREIGN KEY (to_world_id) REFERENCES worlds(id),
    FOREIGN KEY (from_node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL,
    FOREIGN KEY (to_node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_world_portals_from_world ON world_portals(from_world_id);
  CREATE INDEX IF NOT EXISTS idx_world_portals_to_world ON world_portals(to_world_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_portals_name ON world_portals(name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS world_portal_factions (
    id TEXT PRIMARY KEY,
    portal_id TEXT NOT NULL,
    faction_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    custom_label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (portal_id) REFERENCES world_portals(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES world_factions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_world_portal_factions_portal ON world_portal_factions(portal_id);

  CREATE TABLE IF NOT EXISTS world_portal_characters (
    id TEXT PRIMARY KEY,
    portal_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    custom_label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (portal_id) REFERENCES world_portals(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_portal_characters_portal ON world_portal_characters(portal_id);
  CREATE INDEX IF NOT EXISTS idx_world_portal_characters_character ON world_portal_characters(character_id);

  CREATE TABLE IF NOT EXISTS world_rules (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'custom',
    custom_category_label TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    scope_note TEXT NOT NULL DEFAULT '',
    restriction TEXT NOT NULL DEFAULT '',
    consequence TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL DEFAULT 'author' CHECK(source_kind IN ('author', 'setting-rule', 'story-fact')),
    source_ref_id TEXT NOT NULL DEFAULT '',
    source_status TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_rules_world ON world_rules(world_id, category);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_rules_world_name
    ON world_rules(world_id, name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS world_rule_targets (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('scope', 'exception')),
    target_kind TEXT NOT NULL CHECK(target_kind IN ('node', 'relic')),
    target_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (rule_id) REFERENCES world_rules(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_world_rule_targets_rule ON world_rule_targets(rule_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_rule_targets_unique
    ON world_rule_targets(rule_id, role, target_kind, target_id);

  CREATE TABLE IF NOT EXISTS world_character_links (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (world_id) REFERENCES worlds(id),
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_character_links_world ON world_character_links(world_id);
  CREATE INDEX IF NOT EXISTS idx_world_character_links_character ON world_character_links(character_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_character_links_pair
    ON world_character_links(world_id, character_id);

  -- 出生地(birth) 与 目前所在地(current)：同一人物各一行。
  -- current 行额外记录绑定时 characters.cs_location 的原文与来源，用来检测
  -- 角色页或定稿后处理绕过本模块直接改位置的情形。
  CREATE TABLE IF NOT EXISTS world_character_locations (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('birth', 'current')),
    world_id TEXT DEFAULT NULL,
    node_id TEXT DEFAULT NULL,
    note TEXT NOT NULL DEFAULT '',
    story_time_label TEXT NOT NULL DEFAULT '',
    time_precision TEXT NOT NULL DEFAULT 'unknown'
      CHECK(time_precision IN ('exact', 'range', 'relative', 'unknown')),
    chapter_number INTEGER DEFAULT NULL,
    bound_location_text TEXT NOT NULL DEFAULT '',
    bound_provenance_kind TEXT NOT NULL DEFAULT '',
    bound_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id),
    FOREIGN KEY (world_id) REFERENCES worlds(id),
    FOREIGN KEY (node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_world_character_locations_pair
    ON world_character_locations(character_id, kind);
  CREATE INDEX IF NOT EXISTS idx_world_character_locations_world ON world_character_locations(world_id, kind);

  CREATE TABLE IF NOT EXISTS world_trails (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    node_id TEXT DEFAULT NULL,
    note TEXT NOT NULL DEFAULT '',
    arrived_label TEXT NOT NULL DEFAULT '',
    departed_label TEXT NOT NULL DEFAULT '',
    time_precision TEXT NOT NULL DEFAULT 'unknown'
      CHECK(time_precision IN ('exact', 'range', 'relative', 'unknown')),
    sort_order REAL NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    chapter_number INTEGER DEFAULT NULL,
    notes TEXT NOT NULL DEFAULT '',
    portal_id TEXT DEFAULT NULL,
    event_id TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id),
    FOREIGN KEY (world_id) REFERENCES worlds(id),
    FOREIGN KEY (node_id) REFERENCES world_map_nodes(id) ON DELETE SET NULL,
    FOREIGN KEY (portal_id) REFERENCES world_portals(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES story_timeline_events(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_world_trails_character ON world_trails(character_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_world_trails_world ON world_trails(world_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_world_trails_node ON world_trails(node_id);

  CREATE TABLE IF NOT EXISTS world_event_worlds (
    event_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, world_id),
    FOREIGN KEY (event_id) REFERENCES story_timeline_events(id) ON DELETE CASCADE,
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_event_worlds_world ON world_event_worlds(world_id);

  CREATE TABLE IF NOT EXISTS world_event_links (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    target_kind TEXT NOT NULL
      CHECK(target_kind IN ('faction', 'relic', 'portal', 'character', 'node', 'rule')),
    target_id TEXT NOT NULL,
    world_id TEXT DEFAULT NULL,
    relation TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES story_timeline_events(id) ON DELETE CASCADE,
    FOREIGN KEY (world_id) REFERENCES worlds(id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_event_links_event ON world_event_links(event_id);
  CREATE INDEX IF NOT EXISTS idx_world_event_links_target ON world_event_links(target_kind, target_id);

  CREATE TABLE IF NOT EXISTS world_workbench_migrations (
    migration_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    report_json TEXT NOT NULL DEFAULT '{}',
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 每条行进记录是否被显式设为目前所在地；行踪是行踪，绑定是绑定。
  CREATE TABLE IF NOT EXISTS world_trail_current_bindings (
    trail_id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (trail_id) REFERENCES world_trails(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES character_identities(character_id)
  );
  CREATE INDEX IF NOT EXISTS idx_world_trail_bindings_character
    ON world_trail_current_bindings(character_id);
`

/**
 * 幂等入口。可安全地在每次打开项目时调用。
 *
 * 迁移刻意**不**做以下事情：
 * - 不创建默认世界（作者的第一个世界是显式操作）。
 * - 不把旧地图按名称/根节点类型/父地图推断归属世界。
 * - 不把 relic 类型地图节点自动升级为秘境资料。
 * - 不把候选资料升级为已确认事实。
 */
export function ensureWorldWorkbenchSchema(db: BetterSqlite3.Database): void {
  const tablesBefore = countWorldTables(db)
  db.exec(SCHEMA_SQL)

  // 地图归属世界：可空列，旧地图保持未关联。SQLite 的 ADD COLUMN 允许带
  // REFERENCES，前提是默认值为 NULL，因此旧库也能拿到真实外键。
  addColumnIfMissing(db, 'world_maps', 'world_id', 'TEXT DEFAULT NULL REFERENCES worlds(id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_world_maps_world ON world_maps(world_id)')

  // 历史事件标识、结果与后续影响：既有事件默认 0 / 空串，绝不改动原排序与范围。
  addColumnIfMissing(db, 'story_timeline_events', 'is_historical', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'story_timeline_events', 'outcome', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing(db, 'story_timeline_events', 'aftermath', "TEXT NOT NULL DEFAULT ''")

  const report = {
    appliedAt: new Date().toISOString(),
    schemaVersion: WORLD_WORKBENCH_SCHEMA_VERSION,
    defaultWorldCount: 0,
    autoLinkedMapCount: 0,
    existingTableCount: tablesBefore,
  }
  db.prepare(`
    INSERT INTO world_workbench_migrations (migration_id, schema_version, report_json)
    VALUES (?, ?, ?)
    ON CONFLICT(migration_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      report_json = excluded.report_json
  `).run(MIGRATION_ID, WORLD_WORKBENCH_SCHEMA_VERSION, JSON.stringify(report))
}

const WORLD_TABLE_NAMES = [
  'worlds',
  'world_factions',
  'world_faction_places',
  'world_faction_relations',
  'world_faction_characters',
  'world_relics',
  'world_relic_factions',
  'world_relic_characters',
  'world_portals',
  'world_portal_factions',
  'world_portal_characters',
  'world_rules',
  'world_rule_targets',
  'world_character_links',
  'world_character_locations',
  'world_trails',
  'world_event_worlds',
  'world_event_links',
] as const

function countWorldTables(db: BetterSqlite3.Database): number {
  let count = 0
  for (const name of WORLD_TABLE_NAMES) {
    if (tableExists(db, name)) count += 1
  }
  return count
}

/**
 * 删除项目角色时的新关联清理。
 *
 * 只清理属于该角色自己的资料（势力身份、秘境身份、通道身份、世界关联、
 * 出生地、结构化目前所在地与人物行踪），共享的世界、势力、秘境、通道与
 * 历史事件一律保留。事件里的历史人物证据保留，但显式标注角色已删除，
 * 界面据此禁止跳转到不存在的对象。
 *
 * 放在 schema 服务里是为了让角色仓库能直接调用而不产生仓库间循环依赖。
 */
export function detachWorldReferencesForCharacter(db: BetterSqlite3.Database, characterId: string): void {
  if (!characterId || !tableExists(db, 'worlds')) return
  db.transaction(() => {
    db.prepare('DELETE FROM world_faction_characters WHERE character_id = ?').run(characterId)
    db.prepare('DELETE FROM world_relic_characters WHERE character_id = ?').run(characterId)
    db.prepare('DELETE FROM world_portal_characters WHERE character_id = ?').run(characterId)
    db.prepare('DELETE FROM world_character_links WHERE character_id = ?').run(characterId)
    db.prepare('DELETE FROM world_trail_current_bindings WHERE character_id = ?').run(characterId)
    db.prepare('DELETE FROM world_trails WHERE character_id = ?').run(characterId)
    db.prepare('DELETE FROM world_character_locations WHERE character_id = ?').run(characterId)
    db.prepare(`
      UPDATE world_event_links
      SET relation = CASE WHEN relation = '' THEN '角色已删除' ELSE relation || '（角色已删除）' END
      WHERE target_kind = 'character' AND target_id = ?
    `).run(characterId)
  })()
}

/** 供地图/地点删除复用：世界资料表与新列是否都已就位。 */
export function hasWorldWorkbenchTables(db: BetterSqlite3.Database): boolean {
  return tableExists(db, 'worlds') && tableColumns(db, 'world_maps').has('world_id')
}
