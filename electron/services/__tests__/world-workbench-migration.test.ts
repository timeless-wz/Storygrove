import fs from 'node:fs'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { ensureWorldWorkbenchSchema, tableColumns, tableExists } from '../world-workbench-schema'

const testRoot = path.resolve('.runtime/.cache/world-workbench-migration-tests')

/** 只读母稿目录里的真实旧项目；只读取副本，绝不打开或修改原库。 */
const REAL_LEGACY_PROJECT_DB = 'D:\\Desktop\\小说\\未竟之书\\.vela\\vela.db'
const REAL_LEGACY_AVAILABLE = fs.existsSync(REAL_LEGACY_PROJECT_DB)

let projectRoot = ''

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

afterEach(() => {
  closeProjectDatabase()
  try {
    fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows 上 WAL 句柄释放有延迟；这只是 .runtime 下的可再生测试缓存。
  }
})

/**
 * 把当前结构的库退回到「升级前」的形态：去掉世界资料表、地图上的 world_id、
 * 事件上的历史字段。这样可以在不伪造表结构的前提下得到一个真实的旧库。
 */
function downgradeToLegacyShape(root: string): void {
  const dbPath = path.join(root, '.vela', 'vela.db')
  const db = new BetterSqlite3(dbPath)
  db.pragma('foreign_keys = OFF')
  // 先取掉新列（连同它们的索引），再删除它们引用的世界资料表：否则 DROP COLUMN
  // 会因为外键指向的表已经不在了而被 SQLite 拒绝。
  db.exec('DROP INDEX IF EXISTS idx_world_maps_world')
  db.exec('DROP INDEX IF EXISTS idx_story_timeline_events_branch')
  if (tableHasColumn(db, 'world_maps', 'world_id')) db.exec('ALTER TABLE world_maps DROP COLUMN world_id')
  for (const column of ['is_historical', 'outcome', 'aftermath']) {
    if (tableHasColumn(db, 'story_timeline_events', column)) {
      db.exec(`ALTER TABLE story_timeline_events DROP COLUMN ${column}`)
    }
  }
  const worldTables = (db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'world%'
  `).all() as Array<{ name: string }>).map(row => row.name)
  for (const name of worldTables) {
    if (name === 'world_maps' || name === 'world_map_nodes' || name === 'world_map_edges') continue
    // 地图册升级（world_map_atlas_migration）先于本次功能存在，旧项目早已完成；
    // 保留它才能得到「地图册已升级、世界资料尚未升级」的真实旧项目形态。
    if (name === 'world_map_atlas_migration') continue
    db.exec(`DROP TABLE IF EXISTS ${name}`)
  }
  db.close()
}

/**
 * 逐文件递归复制。刻意不用 fs.cpSync：在本环境的 vitest worker 里它会直接让
 * 进程退出（逐文件 copyFileSync 正常），因此这里不依赖该 API。
 */
function copyTreeSync(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyTreeSync(source, target)
    else fs.copyFileSync(source, target)
  }
}

/** 在受控目录里按文件名找托管副本；目录布局会随迁移版本变化，因此按名字找。 */
function findFile(root: string, fileName: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || !fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name === fileName) found.push(full)
    }
  }
  walk(root, 0)
  return found
}

function tableHasColumn(db: BetterSqlite3.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some(row => row.name === column)
}

function seedLegacyContent(): void {
  const db = getProjectDb()
  if (!db) throw new Error('测试数据库未打开')
  const now = '2026-01-01T00:00:00.000Z'
  db.prepare(`
    INSERT INTO world_maps (id, name, parent_map_id, sort_order, image_file_name, image_mime_type, image_bytes, created_at, updated_at)
    VALUES ('map-11111111-1111-4111-8111-111111111111', '世界总图', NULL, 1, 'map-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', 'image/png', 4096, ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO world_maps (id, name, parent_map_id, sort_order, created_at, updated_at)
    VALUES ('map-22222222-2222-4222-8222-222222222222', '大陆图', 'map-11111111-1111-4111-8111-111111111111', 2, ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO world_map_nodes (id, name, type, description, parent_id, map_id, x, y, source_refs, created_at, updated_at)
    VALUES ('node-legacy-1', '旧城', 'city', '既有地点', NULL, 'map-11111111-1111-4111-8111-111111111111', 10, 20, '["源文件.md"]', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO world_map_edges (id, from_node_id, to_node_id, type, description, status, map_id, created_at, updated_at)
    VALUES ('edge-legacy-1', 'node-legacy-1', 'node-legacy-1', 'route', '旧连线', 'active', 'map-11111111-1111-4111-8111-111111111111', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO characters (
      name, role, gender, age, appearance, personality, background,
      abilities, motivation, relationships, arc, notes,
      cs_location, cs_power_level, cs_physical_state, cs_mental_state,
      cs_key_items, cs_recent_events, cs_updated_at_chapter, cs_provenance, cultivation_level_id
    ) VALUES ('旧角色', 'protagonist', '', '', '', '', '', '', '', '[]', '', '',
      '旧世界的山里', '元婴', '', '', '', '', 7, '{}', NULL)
  `).run()
  db.prepare(`
    INSERT INTO story_timeline_events (
      id, branch_id, parent_event_id, title, time_label, sort_order, precision, range_end_label, description,
      chapter_numbers, character_names, location_node_ids, status, created_at, updated_at
    ) VALUES ('evt-legacy-1', 'main', NULL, '旧事件', '大荒历 200 年', 42, 'range', '大荒历 205 年', '既有事件',
      '[3]', '["旧角色"]', '["node-legacy-1"]', 'planned', ?, ?)
  `).run(now, now)
}

describe('旧项目迁移', () => {
  it('creates the world schema without touching legacy maps, nodes, edges, images, characters or timeline', () => {
    projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
    initProjectDatabase(projectRoot)
    seedLegacyContent()
    closeProjectDatabase()
    downgradeToLegacyShape(projectRoot)

    // 确认素材确实是「升级前」形态。
    const before = new BetterSqlite3(path.join(projectRoot, '.vela', 'vela.db'))
    expect(tableHasColumn(before, 'world_maps', 'world_id')).toBe(false)
    expect(tableHasColumn(before, 'story_timeline_events', 'is_historical')).toBe(false)
    expect(tableExists(before, 'worlds')).toBe(false)
    before.close()

    initProjectDatabase(projectRoot)

    const db = getProjectDb()
    if (!db) throw new Error('测试数据库未打开')
    expect(tableExists(db, 'worlds')).toBe(true)
    expect(tableColumns(db, 'world_maps').has('world_id')).toBe(true)
    expect(tableColumns(db, 'story_timeline_events').has('is_historical')).toBe(true)

    // 旧地图、地点、连线与图片元数据完整保留。
    const maps = db.prepare('SELECT id, name, parent_map_id, sort_order, image_file_name, image_bytes, world_id FROM world_maps ORDER BY sort_order').all() as
      Array<{ id: string; name: string; parent_map_id: string | null; sort_order: number; image_file_name: string | null; image_bytes: number | null; world_id: string | null }>
    expect(maps).toHaveLength(2)
    expect(maps[0].image_file_name).toBe('map-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png')
    expect(maps[0].image_bytes).toBe(4096)
    expect(maps[1].parent_map_id).toBe(maps[0].id)
    // 关键：不按名称/父地图推断归属，旧地图保持未关联。
    expect(maps.every(map => map.world_id === null)).toBe(true)

    const nodes = db.prepare('SELECT id, name, source_refs FROM world_map_nodes').all() as Array<{ id: string; name: string; source_refs: string }>
    expect(nodes).toEqual([{ id: 'node-legacy-1', name: '旧城', source_refs: '["源文件.md"]' }])
    expect((db.prepare('SELECT COUNT(*) AS count FROM world_map_edges').get() as { count: number }).count).toBe(1)

    // 角色与旧文字位置原样保留，来源仍是未知（不被升级成作者确认）。
    const character = db.prepare('SELECT cs_location, cs_power_level, cs_updated_at_chapter, cs_provenance FROM characters WHERE name = ?')
      .get('旧角色') as { cs_location: string; cs_power_level: string; cs_updated_at_chapter: number; cs_provenance: string }
    expect(character.cs_location).toBe('旧世界的山里')
    expect(character.cs_power_level).toBe('元婴')
    expect(character.cs_updated_at_chapter).toBe(7)
    expect(character.cs_provenance).toBe('{}')

    // 时间线排序与内容不变，新字段全部为「非历史」默认值。
    const event = db.prepare('SELECT title, sort_order, precision, chapter_numbers, is_historical, outcome, aftermath FROM story_timeline_events WHERE id = ?')
      .get('evt-legacy-1') as { title: string; sort_order: number; precision: string; chapter_numbers: string; is_historical: number; outcome: string; aftermath: string }
    expect(event.sort_order).toBe(42)
    expect(event.precision).toBe('range')
    expect(event.chapter_numbers).toBe('[3]')
    expect(event.is_historical).toBe(0)
    expect(event.outcome).toBe('')
    expect(event.aftermath).toBe('')

    // 没有默认世界，也没有被自动关联的地图。
    expect((db.prepare('SELECT COUNT(*) AS count FROM worlds').get() as { count: number }).count).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS count FROM world_character_locations').get() as { count: number }).count).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS count FROM world_faction_places').get() as { count: number }).count).toBe(0)
  })

  it('is idempotent: running the migration repeatedly changes nothing and never adds a default world', () => {
    projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
    initProjectDatabase(projectRoot)
    seedLegacyContent()
    closeProjectDatabase()
    downgradeToLegacyShape(projectRoot)

    for (let round = 0; round < 4; round += 1) {
      initProjectDatabase(projectRoot)
      const db = getProjectDb()
      if (!db) throw new Error('测试数据库未打开')
      ensureWorldWorkbenchSchema(db)
      ensureWorldWorkbenchSchema(db)
      expect((db.prepare('SELECT COUNT(*) AS count FROM worlds').get() as { count: number }).count).toBe(0)
      expect((db.prepare('SELECT COUNT(*) AS count FROM world_maps').get() as { count: number }).count).toBe(2)
      expect((db.prepare('SELECT COUNT(*) AS count FROM characters').get() as { count: number }).count).toBe(1)
      expect((db.prepare('SELECT COUNT(*) AS count FROM story_timeline_events').get() as { count: number }).count).toBe(1)
      expect((db.prepare('SELECT cs_location FROM characters WHERE name = ?').get('旧角色') as { cs_location: string }).cs_location)
        .toBe('旧世界的山里')
      // 迁移审计只有一行，重复执行是幂等更新而不是堆积。
      expect((db.prepare('SELECT COUNT(*) AS count FROM world_workbench_migrations').get() as { count: number }).count).toBe(1)
      closeProjectDatabase()
    }
  })

  it('keeps legacy candidate material out of confirmed state: no world rules are fabricated', () => {
    projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
    initProjectDatabase(projectRoot)
    const db = getProjectDb()
    if (!db) throw new Error('测试数据库未打开')
    db.prepare(`
      INSERT INTO setting_rules (rule_id, project_id, title, content, status, origin_type)
      VALUES ('rule-candidate-1', 'main', '候选规则', '候选内容', 'candidate', 'scan')
    `).run()

    closeProjectDatabase()
    initProjectDatabase(projectRoot)

    const current = getProjectDb()
    if (!current) throw new Error('测试数据库未打开')
    // 现有资料审核规则保持原状，也没有被静默合并成世界规则。
    const rule = current.prepare('SELECT status, origin_type FROM setting_rules WHERE rule_id = ?')
      .get('rule-candidate-1') as { status: string; origin_type: string }
    expect(rule.status).toBe('candidate')
    expect(rule.origin_type).toBe('scan')
    expect((current.prepare('SELECT COUNT(*) AS count FROM world_rules').get() as { count: number }).count).toBe(0)
  })

  it.runIf(REAL_LEGACY_AVAILABLE)(
    'migrates a real copy of the legacy project twice without losing any content',
    () => {
      projectRoot = fs.mkdtempSync(path.join(testRoot, 'real-'))
      fs.mkdirSync(path.join(projectRoot, '.vela'), { recursive: true })
      // 只读取副本：母稿目录保持只读，绝不被打开为可写数据库。
      fs.copyFileSync(REAL_LEGACY_PROJECT_DB, path.join(projectRoot, '.vela', 'vela.db'))
      copyTreeSync(
        path.join(path.dirname(REAL_LEGACY_PROJECT_DB), 'world-maps'),
        path.join(projectRoot, '.vela', 'world-maps'),
      )

      const snapshot = (): Record<string, number> => {
        const db = getProjectDb()
        if (!db) throw new Error('测试数据库未打开')
        const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
        return {
          maps: count('world_maps'),
          nodes: count('world_map_nodes'),
          edges: count('world_map_edges'),
          drafts: count('drafts'),
          contents: count('contents'),
          events: count('story_timeline_events'),
          worlds: count('worlds'),
          factions: count('world_factions'),
          characterLocations: count('world_character_locations'),
        }
      }

      const legacyShape = new BetterSqlite3(path.join(projectRoot, '.vela', 'vela.db'), { readonly: true })
      const legacyMaps = legacyShape.prepare('SELECT id, name, image_file_name FROM world_maps ORDER BY sort_order').all() as
        Array<{ id: string; name: string; image_file_name: string | null }>
      const preUpgradeColumns = tableColumns(legacyShape, 'world_maps')
      legacyShape.close()
      expect(preUpgradeColumns.has('world_id')).toBe(false)

      initProjectDatabase(projectRoot)
      const first = snapshot()
      closeProjectDatabase()
      initProjectDatabase(projectRoot)
      const second = snapshot()
      closeProjectDatabase()
      initProjectDatabase(projectRoot)
      const third = snapshot()

      expect(second).toEqual(first)
      expect(third).toEqual(first)
      expect(third.worlds).toBe(0)
      expect(third.factions).toBe(0)
      expect(third.characterLocations).toBe(0)

      const db = getProjectDb()
      if (!db) throw new Error('测试数据库未打开')
      const after = db.prepare('SELECT id, name, image_file_name, world_id FROM world_maps ORDER BY sort_order').all() as
        Array<{ id: string; name: string; image_file_name: string | null; world_id: string | null }>
      expect(after).toEqual(legacyMaps.map(map => ({ ...map, world_id: null })))
      // 旧连线保持原样（该项目的旧连线在此前的多地图迁移里已被隔离，行仍保留）。
      expect((db.prepare('SELECT COUNT(*) AS count FROM world_map_edges').get() as { count: number }).count).toBe(second.edges)
      expect((db.prepare('SELECT COUNT(*) AS count FROM world_workbench_migrations').get() as { count: number }).count).toBe(1)
      // 图片副本仍留在项目内（沿用该项目升级后的托管位置），元数据未被改写。
      for (const map of legacyMaps) {
        if (!map.image_file_name) continue
        const matches = findFile(path.join(projectRoot, '.vela'), map.image_file_name)
        expect(matches.length, `地图 ${map.name} 的图片副本必须仍然存在`).toBeGreaterThan(0)
      }
    },
  )
})
