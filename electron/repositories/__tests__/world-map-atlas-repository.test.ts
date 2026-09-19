import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase, getProjectDb } from '../../database'
import { WorldMapRepository } from '../world-map-repository'
import { buildWorldMapTree, getWorldMapBreadcrumb, type WorldMap } from '../../../src/shared/world-map'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/world-map-atlas-repository-tests')

const WORLD_MAP_ID = 'map-aaaaaaa1-1111-4111-8111-111111111111'
const ASTRAL_MAP_ID = 'map-aaaaaaa2-2222-4222-8222-222222222222'
const NORTH_MAP_ID = 'map-aaaaaaa3-3333-4333-8333-333333333333'
const SILVER_MAP_ID = 'map-aaaaaaa4-4444-4444-8444-444444444444'

/**
 * 需求中的示例层级：
 *   世界总图 ├─ 苍穹星地图 ├─ 北境大陆地图
 *                            └─ 白银城地图
 */
function createAtlas(): void {
  const now = new Date().toISOString()
  const insert = getProjectDb()!.prepare(`
    INSERT INTO world_maps (id, name, parent_map_id, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  insert.run(WORLD_MAP_ID, '世界总图', null, 1, now, now)
  insert.run(ASTRAL_MAP_ID, '苍穹星地图', WORLD_MAP_ID, 1, now, now)
  insert.run(NORTH_MAP_ID, '北境大陆地图', ASTRAL_MAP_ID, 1, now, now)
  insert.run(SILVER_MAP_ID, '白银城地图', ASTRAL_MAP_ID, 2, now, now)
}

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
  createAtlas()
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

describe('world map atlas tree', () => {
  it('keeps each map as its own entity with its own parent link', () => {
    const maps = WorldMapRepository.getAll().maps
    expect(maps.map(map => map.name)).toEqual(['世界总图', '苍穹星地图', '北境大陆地图', '白银城地图'])
    expect(maps.find(map => map.id === SILVER_MAP_ID)?.parentMapId).toBe(ASTRAL_MAP_ID)
    expect(maps.find(map => map.id === WORLD_MAP_ID)?.parentMapId).toBeNull()
  })

  it('projects the tree and the breadcrumb trail from the stored hierarchy', () => {
    const maps = WorldMapRepository.getAll().maps
    const tree = buildWorldMapTree(maps)

    expect(tree).toHaveLength(1)
    expect(tree[0].map.name).toBe('世界总图')
    expect(tree[0].children[0].map.name).toBe('苍穹星地图')
    expect(tree[0].children[0].children.map(node => node.map.name)).toEqual(['北境大陆地图', '白银城地图'])
    expect(tree[0].children[0].children[0].depth).toBe(2)

    expect(getWorldMapBreadcrumb(maps, SILVER_MAP_ID).map(map => map.name))
      .toEqual(['世界总图', '苍穹星地图', '白银城地图'])
    expect(getWorldMapBreadcrumb(maps, null)).toEqual([])
  })

  it('stores one imported image per map without touching the others', () => {
    WorldMapRepository.saveMapImage(WORLD_MAP_ID, {
      fileName: 'map-bbbbbbb1-1111-4111-8111-111111111111.png',
      mimeType: 'image/png',
      bytes: 11,
      updatedAt: '2026-09-19T00:00:00.000Z',
    })
    WorldMapRepository.saveMapImage(SILVER_MAP_ID, {
      fileName: 'map-bbbbbbb2-2222-4222-8222-222222222222.webp',
      mimeType: 'image/webp',
      bytes: 22,
      updatedAt: '2026-09-19T00:00:00.000Z',
    })

    const byId = new Map(WorldMapRepository.getAll().maps.map(map => [map.id, map]))
    expect(byId.get(WORLD_MAP_ID)?.image?.fileName).toBe('map-bbbbbbb1-1111-4111-8111-111111111111.png')
    expect(byId.get(SILVER_MAP_ID)?.image?.fileName).toBe('map-bbbbbbb2-2222-4222-8222-222222222222.webp')
    // 没有导入图片的地图保持为空，绝不复用别的地图的图片。
    expect(byId.get(ASTRAL_MAP_ID)?.image).toBeNull()
    expect(byId.get(NORTH_MAP_ID)?.image).toBeNull()

    // 替换一张地图的图片不会影响其他地图。
    WorldMapRepository.saveMapImage(WORLD_MAP_ID, {
      fileName: 'map-bbbbbbb3-3333-4333-8333-333333333333.jpg',
      mimeType: 'image/jpeg',
      bytes: 33,
      updatedAt: '2026-09-19T01:00:00.000Z',
    })
    const after = new Map(WorldMapRepository.getAll().maps.map(map => [map.id, map]))
    expect(after.get(WORLD_MAP_ID)?.image?.fileName).toBe('map-bbbbbbb3-3333-4333-8333-333333333333.jpg')
    expect(after.get(SILVER_MAP_ID)?.image?.fileName).toBe('map-bbbbbbb2-2222-4222-8222-222222222222.webp')

    // 移除一张地图的图片只清空这张地图。
    WorldMapRepository.saveMapImage(WORLD_MAP_ID, null)
    const cleared = new Map(WorldMapRepository.getAll().maps.map(map => [map.id, map]))
    expect(cleared.get(WORLD_MAP_ID)?.image).toBeNull()
    expect(cleared.get(SILVER_MAP_ID)?.image?.fileName).toBe('map-bbbbbbb2-2222-4222-8222-222222222222.webp')
  })

  it('renames and reorders sibling maps without changing their hierarchy', () => {
    const silver = WorldMapRepository.getAll().maps.find(map => map.id === SILVER_MAP_ID) as WorldMap
    WorldMapRepository.upsertMap({ ...silver, name: '白银之城地图' })
    expect(WorldMapRepository.getAll().maps.find(map => map.id === SILVER_MAP_ID)?.name).toBe('白银之城地图')

    WorldMapRepository.reorderMaps([SILVER_MAP_ID, NORTH_MAP_ID])
    const siblings = buildWorldMapTree(WorldMapRepository.getAll().maps)
    expect(siblings[0].children[0].children.map(node => node.map.name))
      .toEqual(['白银之城地图', '北境大陆地图'])
  })

  it('clears an image when the map image is removed through the repository', () => {
    WorldMapRepository.saveMapImage(NORTH_MAP_ID, {
      fileName: 'map-bbbbbbb4-4444-4444-8444-444444444444.png',
      mimeType: 'image/png',
      bytes: 44,
      updatedAt: '2026-09-19T00:00:00.000Z',
    })
    expect(WorldMapRepository.getAll().maps.find(map => map.id === NORTH_MAP_ID)?.image).not.toBeNull()
    WorldMapRepository.saveMapImage(NORTH_MAP_ID, null)
    expect(WorldMapRepository.getAll().maps.find(map => map.id === NORTH_MAP_ID)?.image).toBeNull()
  })
})
