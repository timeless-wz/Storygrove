import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { WorldMapRepository } from '../../repositories/world-map-repository'
import { migrateWorldMapAtlas } from '../world-map-atlas-migration'
import {
  nodeWorldMapImageFileSystem,
  readMapImageDataUrl,
  type WorldMapImageFileSystem,
} from '../world-map-image-store'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/world-map-atlas-migration-tests')

const LEGACY_IMAGE_FILE = 'map-cccccccc-1111-4111-8111-111111111111.png'
const LEGACY_IMAGE_BYTES = Buffer.from('legacy-project-base-map-bytes')

/**
 * 旧版本只有「一张项目底图 + 图层筛选」：world_map_layers 定义筛选层，
 * world_map_nodes.map_layer 是裸字符串，world_map_image 是单例底图。
 */
function createLegacyProject(imageBytes = LEGACY_IMAGE_BYTES): void {
  const velaDirectory = path.join(projectRoot, '.vela')
  fs.mkdirSync(path.join(velaDirectory, 'world-map'), { recursive: true })
  fs.writeFileSync(path.join(velaDirectory, 'world-map', LEGACY_IMAGE_FILE), imageBytes)

  const db = new Database(path.join(velaDirectory, 'vela.db'))
  db.exec(`
    CREATE TABLE world_map_layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE world_map_image (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE world_map_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      parent_id TEXT DEFAULT NULL,
      map_layer TEXT NOT NULL DEFAULT 'surface',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      source_refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE world_map_edges (
      id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_node_id) REFERENCES world_map_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES world_map_nodes(id) ON DELETE CASCADE
    );
  `)

  const insertLayer = db.prepare('INSERT INTO world_map_layers (id, name, sort_order) VALUES (?, ?, ?)')
  insertLayer.run('surface', '主世界', 1)
  insertLayer.run('underground', '里世界', 2)

  const insertNode = db.prepare(`
    INSERT INTO world_map_nodes (id, name, type, description, parent_id, map_layer, x, y, source_refs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // surface 层：父地点与子地点，坐标必须原样保留。
  insertNode.run('n-silver', '白银之城', 'city', '北境最大的人类城邦', null, 'surface', 111, 222, '["01_设定.md"]')
  insertNode.run('n-tower', '观星塔', 'landmark', '位于城中央', 'n-silver', 'surface', 333, 444, '[]')
  // underground 层
  insertNode.run('n-abyss', '深渊回廊', 'relic', '深层遗迹', null, 'underground', 555, 666, '[]')
  // 旧库里还残留了没有对应图层行的字符串：绝不能因此丢失地点。
  insertNode.run('n-dream', '月眠门', 'landmark', '梦境边界', null, 'dream', 777, 888, '[]')

  const insertEdge = db.prepare(`
    INSERT INTO world_map_edges (id, from_node_id, to_node_id, type, description, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  // 两端同属 surface：迁移后必须保留可见。
  insertEdge.run('e-same-map', 'n-silver', 'n-tower', 'subordinate', '城内关系', 'active')
  // 两端分属 surface / underground：迁移后必须被隔离，且原始行仍然存在。
  insertEdge.run('e-cross-map', 'n-silver', 'n-abyss', 'portal', '界隙通道', 'active')

  db.prepare(`
    INSERT INTO world_map_image (singleton_id, file_name, mime_type, bytes, updated_at)
    VALUES (1, ?, 'image/png', ?, '2026-09-19T00:00:00.000Z')
  `).run(LEGACY_IMAGE_FILE, imageBytes.length)

  db.close()
}

function rawRows(table: string): Array<Record<string, unknown>> {
  return getProjectDb()!.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
}

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
})

afterEach(() => {
  closeProjectDatabase()
  // SQLite WAL 句柄在 Windows 上可能直到进程退出才释放；这些目录只是 .runtime 下的
  // 可再生测试缓存，清理失败不应把测试判为失败。
  try {
    fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // 交由下一次干净运行或进程退出时回收。
  }
})

describe('legacy single-image / layer structure migration', () => {
  it('turns each legacy layer into a same-named map and keeps every location', () => {
    createLegacyProject()
    initProjectDatabase(projectRoot)

    const data = WorldMapRepository.getAll()
    const names = data.maps.map(map => map.name)
    expect(names).toContain('主世界')
    expect(names).toContain('里世界')
    // 地点上残留的未知图层字符串同样被保留为地图，否则这些地点会失去归属。
    expect(names).toContain('dream')
    // 旧底图属于整个项目，迁移后由一张新的根地图持有，旧图层地图成为它的子地图。
    expect(names).toContain('世界总图')

    const root = data.maps.find(map => map.name === '世界总图')!
    const surfaceMap = data.maps.find(map => map.name === '主世界')!
    const undergroundMap = data.maps.find(map => map.name === '里世界')!
    expect(surfaceMap.parentMapId).toBe(root.id)
    expect(undergroundMap.parentMapId).toBe(root.id)

    // 全部四个地点都在，坐标与父级关系不变。
    expect(data.nodes).toHaveLength(4)
    const byId = new Map(data.nodes.map(node => [node.id, node]))
    expect(byId.get('n-silver')).toMatchObject({ x: 111, y: 222, mapId: surfaceMap.id, parentId: null })
    expect(byId.get('n-tower')).toMatchObject({ x: 333, y: 444, mapId: surfaceMap.id, parentId: 'n-silver' })
    expect(byId.get('n-abyss')).toMatchObject({ x: 555, y: 666, mapId: undergroundMap.id })
    expect(byId.get('n-dream')?.mapId).toBe(data.maps.find(map => map.name === 'dream')!.id)

    // 旧图层行本身绝不删除，仅供追溯。
    expect(rawRows('world_map_layers').map(row => row.id)).toEqual(['surface', 'underground'])
  })

  it('keeps same-map connections and quarantines cross-map connections without deleting them', () => {
    createLegacyProject()
    initProjectDatabase(projectRoot)

    const visible = WorldMapRepository.getAll().edges
    expect(visible.map(edge => edge.id)).toEqual(['e-same-map'])
    expect(visible[0].mapId).toBe(WorldMapRepository.getAll().maps.find(map => map.name === '主世界')!.id)

    // 跨地图旧连接绝不出现在任何地图上，但原始行仍然保留，只是 map_id 被置空。
    const rawEdges = rawRows('world_map_edges')
    expect(rawEdges.map(row => row.id).sort()).toEqual(['e-cross-map', 'e-same-map'])
    const quarantined = rawEdges.find(row => row.id === 'e-cross-map')!
    expect(quarantined.map_id).toBeNull()
    expect(quarantined.description).toBe('界隙通道')
  })

  it('moves the legacy managed image into the owning map directory and reports the migration', () => {
    createLegacyProject()
    initProjectDatabase(projectRoot)

    const report = WorldMapRepository.getMigrationReport()
    expect(report).not.toBeNull()
    expect(report!.mapCount).toBe(4)
    expect(report!.nodeCount).toBe(4)
    expect(report!.isolatedEdgeCount).toBe(1)
    expect(report!.imageMigrated).toBe(true)
    expect(report!.acknowledged).toBe(false)
    expect(report!.legacyLayerNames).toEqual(expect.arrayContaining(['主世界', '里世界']))

    const root = WorldMapRepository.getAll().maps.find(map => map.name === '世界总图')!
    expect(root.image).toEqual({
      fileName: LEGACY_IMAGE_FILE,
      mimeType: 'image/png',
      bytes: LEGACY_IMAGE_BYTES.length,
      updatedAt: '2026-09-19T00:00:00.000Z',
    })
    // 只有这张根地图持有旧底图，其他地图保持无图。
    expect(WorldMapRepository.getAll().maps.filter(map => map.image)).toHaveLength(1)

    const managedCopy = path.join(projectRoot, '.vela', 'world-maps', root.id, LEGACY_IMAGE_FILE)
    expect(fs.existsSync(managedCopy)).toBe(true)
    expect(fs.readFileSync(managedCopy)).toEqual(LEGACY_IMAGE_BYTES)
    // 旧扁平目录中的托管副本已被搬走（它只是项目内的副本，与用户原始图片无关）。
    expect(fs.existsSync(path.join(projectRoot, '.vela', 'world-map', LEGACY_IMAGE_FILE))).toBe(false)

    // 单例底图表随实现一起废除；它唯一的一行已转入 world_maps。
    const hasSingletonTable = getProjectDb()!.prepare(
      `SELECT 1 AS value FROM sqlite_master WHERE type = 'table' AND name = 'world_map_image'`,
    ).get()
    expect(hasSingletonTable).toBeUndefined()
  })

  it('acknowledges the migration report on request', () => {
    createLegacyProject()
    initProjectDatabase(projectRoot)
    expect(WorldMapRepository.getMigrationReport()?.acknowledged).toBe(false)
    WorldMapRepository.acknowledgeMigration()
    expect(WorldMapRepository.getMigrationReport()?.acknowledged).toBe(true)
  })

  it('runs once and never re-imports after maps are managed by the author', () => {
    createLegacyProject()
    initProjectDatabase(projectRoot)

    const firstRun = WorldMapRepository.getAll().maps
    expect(firstRun).toHaveLength(4)

    // 作者删除全部地图后重开项目：迁移绝不能再次把旧图层灌回来。
    const topLevel = firstRun.filter(map => map.parentMapId === null)
    for (const map of topLevel) WorldMapRepository.deleteMap(map.id, 'cascade')
    expect(WorldMapRepository.getAll().maps).toHaveLength(0)

    closeProjectDatabase()
    initProjectDatabase(projectRoot)
    expect(WorldMapRepository.getAll().maps).toHaveLength(0)
  })

  it('does not migrate anything for a project that has no legacy map data', () => {
    initProjectDatabase(projectRoot)
    expect(WorldMapRepository.getAll().maps).toEqual([])
    expect(WorldMapRepository.getMigrationReport()).toBeNull()

    closeProjectDatabase()
    initProjectDatabase(projectRoot)
    expect(WorldMapRepository.getAll().maps).toEqual([])
  })
})

/**
 * 在已经打开的数据库上还原旧「单底图 + 图层」结构。
 *
 * 与 createLegacyProject 的区别：这里走的是「旧库被新版程序打开过一次」之后的真实状态
 * （节点仍带 map_layer 旧列，并已补上可空 map_id），因此可以直接对 migrateWorldMapAtlas
 * 注入文件系统失败，而不必先让它成功跑一遍。
 */
function installLegacyAtlasShape(): void {
  const db = getProjectDb()!
  db.prepare('DELETE FROM world_map_atlas_migration').run()
  db.exec(`
    ALTER TABLE world_map_nodes ADD COLUMN map_layer TEXT NOT NULL DEFAULT 'surface';
    CREATE TABLE world_map_layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE world_map_image (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const insertLayer = db.prepare('INSERT INTO world_map_layers (id, name, sort_order) VALUES (?, ?, ?)')
  insertLayer.run('surface', '主世界', 1)
  insertLayer.run('underground', '里世界', 2)

  const insertNode = db.prepare(`
    INSERT INTO world_map_nodes (id, name, type, description, parent_id, map_id, map_layer, x, y, source_refs)
    VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)
  `)
  insertNode.run('n-silver', '白银之城', 'city', '北境最大的人类城邦', null, 'surface', 111, 222, '["01_设定.md"]')
  insertNode.run('n-tower', '观星塔', 'landmark', '位于城中央', 'n-silver', 'surface', 333, 444, '[]')
  insertNode.run('n-abyss', '深渊回廊', 'relic', '深层遗迹', null, 'underground', 555, 666, '[]')
  insertNode.run('n-dream', '月眠门', 'landmark', '梦境边界', null, 'dream', 777, 888, '[]')

  const insertEdge = db.prepare(`
    INSERT INTO world_map_edges (id, from_node_id, to_node_id, type, description, status, map_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `)
  insertEdge.run('e-same-map', 'n-silver', 'n-tower', 'subordinate', '城内关系', 'active')
  insertEdge.run('e-cross-map', 'n-silver', 'n-abyss', 'portal', '界隙通道', 'active')

  const legacyDirectory = path.join(projectRoot, '.vela', 'world-map')
  fs.mkdirSync(legacyDirectory, { recursive: true })
  fs.writeFileSync(path.join(legacyDirectory, LEGACY_IMAGE_FILE), LEGACY_IMAGE_BYTES)
  db.prepare(`
    INSERT INTO world_map_image (singleton_id, file_name, mime_type, bytes, updated_at)
    VALUES (1, ?, 'image/png', ?, '2026-09-19T00:00:00.000Z')
  `).run(LEGACY_IMAGE_FILE, LEGACY_IMAGE_BYTES.length)
}

function openProjectWithLegacyAtlas(): void {
  initProjectDatabase(projectRoot)
  installLegacyAtlasShape()
}

function runAtlasMigration(fileSystem?: WorldMapImageFileSystem): void {
  migrateWorldMapAtlas(getProjectDb()!, projectRoot, fileSystem)
}

function legacyImagePath(): string {
  return path.join(projectRoot, '.vela', 'world-map', LEGACY_IMAGE_FILE)
}

function filesUnder(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(entryPath)
    return [entryPath]
  })
}

function managedCopies(): string[] {
  return filesUnder(path.join(projectRoot, '.vela', 'world-maps'))
}

function trashCopies(): string[] {
  return filesUnder(path.join(projectRoot, '.vela', 'trash'))
}

function legacySingletonTableExists(): boolean {
  return Boolean(getProjectDb()!.prepare(
    `SELECT 1 AS value FROM sqlite_master WHERE type = 'table' AND name = 'world_map_image'`,
  ).get())
}

/** 每张持有图片的地图都必须有一个存在且字节数匹配的受控副本。 */
function assertNoDanglingImageMetadata(): void {
  for (const map of WorldMapRepository.getAll().maps) {
    if (!map.image) continue
    expect(readMapImageDataUrl(projectRoot, map.id, map.image)).not.toBeNull()
  }
}

describe('atlas migration image failure handling', () => {
  it('copy failure keeps the legacy record, the legacy file, and stays retryable', () => {
    openProjectWithLegacyAtlas()
    const failingFileSystem: WorldMapImageFileSystem = {
      ...nodeWorldMapImageFileSystem,
      copyFileSync: () => { throw new Error('simulated copy failure') },
    }

    runAtlasMigration(failingFileSystem)

    // 整次迁移没有提交：没有地图、没有完成记录，旧记录与旧文件都在。
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM world_maps').get()).toEqual({ count: 0 })
    expect(WorldMapRepository.getMigrationReport()).toBeNull()
    expect(rawRows('world_map_atlas_migration')).toEqual([])
    expect(legacySingletonTableExists()).toBe(true)
    expect(rawRows('world_map_image')).toHaveLength(1)
    expect(fs.readFileSync(legacyImagePath())).toEqual(LEGACY_IMAGE_BYTES)
    // 没有留下任何无记录的图片文件或空目录。
    expect(managedCopies()).toEqual([])

    // 故障排除后再次打开项目即可安全重试，结果与一次成功迁移完全一致。
    runAtlasMigration()
    const report = WorldMapRepository.getMigrationReport()
    expect(report?.imageMigrated).toBe(true)
    expect(report?.mapCount).toBe(4)
    expect(report?.nodeCount).toBe(4)
    expect(report?.isolatedEdgeCount).toBe(1)
    expect(legacySingletonTableExists()).toBe(false)
    expect(managedCopies()).toHaveLength(1)
    assertNoDanglingImageMetadata()
  })

  it('byte-size verification failure aborts before any metadata is written', () => {
    openProjectWithLegacyAtlas()
    const managedSegment = `${path.sep}world-maps${path.sep}`
    const failingFileSystem: WorldMapImageFileSystem = {
      ...nodeWorldMapImageFileSystem,
      // 复制后的副本字节数与原文件不一致：即「新副本校验失败」。
      statSync: (targetPath: string) => {
        const stats = nodeWorldMapImageFileSystem.statSync(targetPath)
        if (!targetPath.includes(managedSegment)) return stats
        return { isFile: () => true, size: stats.size + 5 }
      },
    }

    runAtlasMigration(failingFileSystem)

    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM world_maps').get()).toEqual({ count: 0 })
    expect(WorldMapRepository.getMigrationReport()).toBeNull()
    expect(rawRows('world_map_image')).toHaveLength(1)
    expect(fs.existsSync(legacyImagePath())).toBe(true)
    // 校验失败的副本已被丢弃，不会成为无记录文件。
    expect(managedCopies()).toEqual([])

    runAtlasMigration()
    expect(WorldMapRepository.getMigrationReport()?.imageMigrated).toBe(true)
    expect(managedCopies()).toHaveLength(1)
    assertNoDanglingImageMetadata()
  })

  it('a failing migration audit write rolls everything back without moving the image', () => {
    openProjectWithLegacyAtlas()
    getProjectDb()!.exec(`
      CREATE TRIGGER atlas_audit_write_failure BEFORE INSERT ON world_map_atlas_migration
      BEGIN SELECT RAISE(ABORT, 'simulated audit write failure'); END;
    `)

    runAtlasMigration()

    // SQL 回滚后不得出现「文件已移动、数据库未迁移」：地图树与地点归属都没有提交。
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM world_maps').get()).toEqual({ count: 0 })
    expect(rawRows('world_map_nodes').every(row => row.map_id === '')).toBe(true)
    expect(rawRows('world_map_atlas_migration')).toEqual([])
    expect(WorldMapRepository.getMigrationReport()).toBeNull()
    // 旧记录、旧文件都在，而且阶段一写下的副本已被丢弃。
    expect(legacySingletonTableExists()).toBe(true)
    expect(rawRows('world_map_image')).toHaveLength(1)
    expect(fs.readFileSync(legacyImagePath())).toEqual(LEGACY_IMAGE_BYTES)
    expect(managedCopies()).toEqual([])

    getProjectDb()!.exec('DROP TRIGGER atlas_audit_write_failure')
    runAtlasMigration()

    const report = WorldMapRepository.getMigrationReport()
    expect(report?.imageMigrated).toBe(true)
    expect(report?.legacyImageCopyRetained).toBeUndefined()
    expect(managedCopies()).toHaveLength(1)
    assertNoDanglingImageMetadata()
  })

  it('keeps both copies when the legacy copy cannot be renamed away', () => {
    openProjectWithLegacyAtlas()
    const failingFileSystem: WorldMapImageFileSystem = {
      ...nodeWorldMapImageFileSystem,
      renameSync: () => { throw new Error('simulated rename failure') },
    }

    runAtlasMigration(failingFileSystem)

    // 迁移本身成功：地图、地点归属、连接隔离与一次成功迁移保持一致。
    expect(WorldMapRepository.getAll().maps).toHaveLength(4)
    expect(rawRows('world_map_nodes').every(row => row.map_id !== '')).toBe(true)
    expect(WorldMapRepository.getAll().edges.map(edge => edge.id)).toEqual(['e-same-map'])
    const report = WorldMapRepository.getMigrationReport()
    expect(report?.imageMigrated).toBe(true)
    expect(report?.legacyImageCopyRetained).toBe(true)
    expect(managedCopies()).toHaveLength(1)
    // 两份文件都被保留，没有任何图片丢失。
    expect(fs.readFileSync(legacyImagePath())).toEqual(LEGACY_IMAGE_BYTES)
    assertNoDanglingImageMetadata()
  })

  it('keeps a recoverable copy in the project when the legacy copy cannot be deleted', () => {
    openProjectWithLegacyAtlas()
    const failingFileSystem: WorldMapImageFileSystem = {
      ...nodeWorldMapImageFileSystem,
      unlinkSync: () => { throw new Error('simulated unlink failure') },
    }

    runAtlasMigration(failingFileSystem)

    expect(WorldMapRepository.getAll().maps).toHaveLength(4)
    const report = WorldMapRepository.getMigrationReport()
    expect(report?.imageMigrated).toBe(true)
    expect(report?.legacyImageCopyRetained).toBe(true)
    expect(typeof report?.legacyImageCleanupError).toBe('string')
    // 旧副本已经离开旧目录，但仍在项目内的恢复目录里，可人工找回。
    expect(fs.existsSync(legacyImagePath())).toBe(false)
    // 暂存名字是唯一的（序号 + UUID + 原扩展名），因此用内容确认留下的正是旧底图。
    expect(trashCopies()).toHaveLength(1)
    expect(trashCopies()[0].endsWith('.png')).toBe(true)
    expect(fs.readFileSync(trashCopies()[0])).toEqual(LEGACY_IMAGE_BYTES)
    expect(managedCopies()).toHaveLength(1)
    assertNoDanglingImageMetadata()
  })
})
