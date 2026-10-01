import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase, getProjectDb } from '../../database'
import { WorldMapRepository } from '../world-map-repository'
import { ProjectCoreRepository } from '../project-core-repository'
import type { WorldMap, WorldMapNode, WorldMapMarkerIcon } from '../../../src/shared/world-map'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/world-map-repository-tests')

const ROOT_MAP_ID = 'map-11111111-1111-4111-8111-111111111111'
const CITY_MAP_ID = 'map-22222222-2222-4222-8222-222222222222'

function seedMaps(): void {
  const now = new Date().toISOString()
  const db = getProjectDb()!
  const insert = db.prepare(`
    INSERT INTO world_maps (id, name, parent_map_id, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  insert.run(ROOT_MAP_ID, '世界总图', null, 1, now, now)
  insert.run(CITY_MAP_ID, '白银城地图', ROOT_MAP_ID, 1, now, now)
}

function node(overrides: Partial<WorldMapNode> & Pick<WorldMapNode, 'id' | 'name'>): WorldMapNode {
  return {
    type: 'city',
    description: '',
    parentId: null,
    mapId: ROOT_MAP_ID,
    x: 0,
    y: 0,
    sourceRefs: [],
    ...overrides,
  }
}

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
  ProjectCoreRepository.init('World Map Test Novel', 'zh-CN')
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

describe('WorldMapRepository on a fresh project', () => {
  it('starts empty and exposes no migration notice', () => {
    const data = WorldMapRepository.getAll()
    expect(data.maps).toEqual([])
    expect(data.nodes).toEqual([])
    expect(data.edges).toEqual([])
    expect(data.migration).toBeNull()
  })
})

describe('WorldMapRepository', () => {
  beforeEach(seedMaps)

  it('persists building markers across reopening, coordinate edits and resetting to auto', () => {
    WorldMapRepository.upsertNode(node({ id: 'node-temple', name: '白塔神殿', markerIcon: 'temple' }))
    closeProjectDatabase()
    initProjectDatabase(projectRoot)
    expect(WorldMapRepository.getAll().nodes[0].markerIcon).toBe('temple')

    // 兼容未携带新字段的旧调用方，拖动不能丢失已选标识。
    WorldMapRepository.upsertNode(node({ id: 'node-temple', name: '白塔神殿', x: 120, y: 80 }))
    expect(WorldMapRepository.getAll().nodes[0]).toMatchObject({ markerIcon: 'temple', x: 120, y: 80 })
    WorldMapRepository.upsertNode(node({ id: 'node-temple', name: '白塔神殿', markerIcon: null }))
    expect(WorldMapRepository.getAll().nodes[0].markerIcon).toBeNull()
  })

  it('adds the marker column to an existing map database without changing its locations', () => {
    WorldMapRepository.upsertNode(node({ id: 'node-old', name: '旧城', x: 18, y: 36 }))
    getProjectDb()!.exec('ALTER TABLE world_map_nodes DROP COLUMN marker_icon')
    closeProjectDatabase()
    initProjectDatabase(projectRoot)
    expect(WorldMapRepository.getAll().nodes[0]).toMatchObject({ id: 'node-old', x: 18, y: 36, markerIcon: null })
  })

  it('rejects unknown building icons without replacing a saved marker', () => {
    const location = node({ id: 'node-castle', name: '北境要塞', markerIcon: 'castle' })
    WorldMapRepository.upsertNode(location)
    expect(() => WorldMapRepository.upsertNode({ ...location, markerIcon: 'unknown' as WorldMapMarkerIcon })).toThrow('图标无效')
    expect(WorldMapRepository.getAll().nodes[0].markerIcon).toBe('castle')
  })

  it('creates map trees and keeps the parent/child hierarchy', () => {
    const maps = WorldMapRepository.getAll().maps
    expect(maps.map(map => map.id)).toEqual([ROOT_MAP_ID, CITY_MAP_ID])
    expect(maps.find(map => map.id === CITY_MAP_ID)?.parentMapId).toBe(ROOT_MAP_ID)
  })

  it('refuses a map cycle and a self parent', () => {
    const now = new Date().toISOString()
    const grandChild: WorldMap = {
      id: 'map-33333333-3333-4333-8333-333333333333',
      name: '北境大陆地图',
      parentMapId: CITY_MAP_ID,
      sortOrder: 1,
      image: null,
      createdAt: now,
    }
    WorldMapRepository.upsertMap(grandChild)

    expect(() => WorldMapRepository.upsertMap({ ...grandChild, parentMapId: grandChild.id })).toThrow('不能以自己为父地图')
    // 把根地图挂到自己的后代下会形成环，必须拒绝。
    expect(() => WorldMapRepository.upsertMap({
      ...WorldMapRepository.getAll().maps.find(map => map.id === ROOT_MAP_ID)!,
      parentMapId: grandChild.id,
    })).toThrow('地图层级不能形成环')
  })

  it('rejects a map id that could escape the managed directory layout', () => {
    expect(() => WorldMapRepository.upsertMap({
      id: '../../etc',
      name: '越界地图',
      parentMapId: null,
      sortOrder: 1,
      image: null,
    })).toThrow('地图标识无效')
  })

  it('binds every location to exactly one existing map', () => {
    WorldMapRepository.upsertNode(node({ id: 'node-city-1', name: '白银之城', x: 100, y: 200 }))

    const saved = WorldMapRepository.getAll().nodes
    expect(saved).toHaveLength(1)
    expect(saved[0].mapId).toBe(ROOT_MAP_ID)

    // 每个地点行只携带一个 map_id：结构上不可能同时属于多张地图。
    const rows = getProjectDb()!.prepare('SELECT id, map_id FROM world_map_nodes').all() as Array<{ id: string; map_id: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].map_id).toBe(ROOT_MAP_ID)

    // 归属地图必须真实存在，指向未知地图的地点会被拒绝。
    expect(() => WorldMapRepository.upsertNode(node({
      id: 'node-orphan',
      name: '无主地点',
      mapId: 'map-99999999-9999-4999-8999-999999999999',
    }))).toThrow('地点必须绑定一张存在的地图')
  })

  it('rejects a parent location from another map', () => {
    WorldMapRepository.upsertNode(node({ id: 'node-a', name: '世界总图地点' }))
    WorldMapRepository.upsertNode(node({ id: 'node-b', name: '白银城地点', mapId: CITY_MAP_ID }))

    expect(() => WorldMapRepository.upsertNode(node({
      id: 'node-c',
      name: '跨地图子地点',
      parentId: 'node-b',
      mapId: ROOT_MAP_ID,
    }))).toThrow('父地点必须与当前地点属于同一张地图')
  })

  it('rejects connections whose endpoints live on different maps', () => {
    WorldMapRepository.upsertNode(node({ id: 'node-a', name: '白银之城' }))
    WorldMapRepository.upsertNode(node({ id: 'node-b', name: '苍穹星港', mapId: CITY_MAP_ID }))

    expect(() => WorldMapRepository.upsertEdge({
      id: 'edge-cross',
      fromNodeId: 'node-a',
      toNodeId: 'node-b',
      type: 'route',
      description: '',
      status: 'active',
    })).toThrow('禁止跨地图连接')

    expect(WorldMapRepository.getAll().edges).toHaveLength(0)
  })

  it('derives the owning map for a connection from its endpoints', () => {
    WorldMapRepository.upsertNode(node({ id: 'node-a', name: '东港', mapId: CITY_MAP_ID }))
    WorldMapRepository.upsertNode(node({ id: 'node-b', name: '西渊', mapId: CITY_MAP_ID }))

    WorldMapRepository.upsertEdge({
      id: 'edge-1',
      fromNodeId: 'node-a',
      toNodeId: 'node-b',
      type: 'subordinate',
      description: '白银城内部航路',
      status: 'active',
      // 调用方无法伪造归属地图：仓库层以两端点的地图为准。
      mapId: ROOT_MAP_ID,
    })

    expect(WorldMapRepository.getAll().edges[0].mapId).toBe(CITY_MAP_ID)

    WorldMapRepository.deleteEdge('edge-1')
    expect(WorldMapRepository.getAll().edges).toHaveLength(0)
  })

  it('cascades connected edges and resets children when a location is deleted', () => {
    WorldMapRepository.upsertNode(node({ id: 'parent-region', name: '苍暮大裂谷', type: 'region' }))
    WorldMapRepository.upsertNode(node({ id: 'child-relic', name: '裂谷深渊遗迹', type: 'relic', parentId: 'parent-region' }))
    WorldMapRepository.upsertEdge({
      id: 'edge-rel',
      fromNodeId: 'parent-region',
      toNodeId: 'child-relic',
      type: 'subordinate',
      description: '',
      status: 'active',
    })

    WorldMapRepository.deleteNode('parent-region')

    const data = WorldMapRepository.getAll()
    expect(data.nodes).toHaveLength(1)
    expect(data.nodes[0].id).toBe('child-relic')
    expect(data.nodes[0].parentId).toBeNull()
    expect(data.edges).toHaveLength(0)
  })

  it('promotes child maps and deletes only the removed map internals', () => {
    WorldMapRepository.upsertNode(node({ id: 'root-node', name: '世界总图地点' }))
    WorldMapRepository.upsertNode(node({ id: 'city-node', name: '白银城地点', mapId: CITY_MAP_ID }))

    const plan = WorldMapRepository.deleteMap(ROOT_MAP_ID, 'promote-children')
    expect(plan.mapIds).toEqual([ROOT_MAP_ID])
    expect(plan.childMapIds).toEqual([CITY_MAP_ID])
    expect(plan.nodeCount).toBe(1)

    const data = WorldMapRepository.getAll()
    // 子地图及其地点被完整保留，并改挂到顶层。
    expect(data.maps.map(map => map.id)).toEqual([CITY_MAP_ID])
    expect(data.maps[0].parentMapId).toBeNull()
    expect(data.nodes.map(node => node.id)).toEqual(['city-node'])
  })

  it('deletes the whole subtree only when cascade is requested', () => {
    WorldMapRepository.upsertNode(node({ id: 'root-node', name: '世界总图地点' }))
    WorldMapRepository.upsertNode(node({ id: 'city-node', name: '白银城地点', mapId: CITY_MAP_ID }))

    const plan = WorldMapRepository.deleteMap(ROOT_MAP_ID, 'cascade')
    expect(plan.mapIds.sort()).toEqual([ROOT_MAP_ID, CITY_MAP_ID].sort())
    expect(plan.nodeCount).toBe(2)

    const data = WorldMapRepository.getAll()
    expect(data.maps).toHaveLength(0)
    expect(data.nodes).toHaveLength(0)
    expect(data.edges).toHaveLength(0)
  })

  it('requires an explicit child-map strategy for deletion', () => {
    expect(() => WorldMapRepository.deleteMap(ROOT_MAP_ID, 'silent' as unknown as 'cascade'))
      .toThrow('删除地图必须显式指定对子地图的处理方式')
    expect(WorldMapRepository.getAll().maps).toHaveLength(2)
  })

  it('reports the managed image copies that a deletion must clean up', () => {
    WorldMapRepository.saveMapImage(CITY_MAP_ID, {
      fileName: 'map-33333333-3333-4333-8333-333333333333.png',
      mimeType: 'image/png',
      bytes: 128,
      updatedAt: new Date().toISOString(),
    })

    const plan = WorldMapRepository.planMapDelete(ROOT_MAP_ID, 'cascade')
    expect(plan.images).toEqual([{
      mapId: CITY_MAP_ID,
      fileName: 'map-33333333-3333-4333-8333-333333333333.png',
    }])
  })

  it('reorders maps without touching their hierarchy', () => {
    const now = new Date().toISOString()
    WorldMapRepository.upsertMap({
      id: 'map-44444444-4444-4444-8444-444444444444',
      name: '里世界地图',
      parentMapId: null,
      sortOrder: 2,
      image: null,
      createdAt: now,
    })

    WorldMapRepository.reorderMaps(['map-44444444-4444-4444-8444-444444444444', ROOT_MAP_ID])

    const ordered = WorldMapRepository.getAll().maps.map(map => map.id)
    expect(ordered.indexOf('map-44444444-4444-4444-8444-444444444444')).toBeLessThan(ordered.indexOf(ROOT_MAP_ID))
    // 排序只影响同层显示顺序，父子关系不受影响。
    expect(WorldMapRepository.getAll().maps.find(map => map.id === CITY_MAP_ID)?.parentMapId).toBe(ROOT_MAP_ID)
    expect(WorldMapRepository.getAll().maps).toHaveLength(3)
  })

  it('extracts candidate locations from worldbuilding text without committing them', () => {
    const db = getProjectDb()!
    db.prepare(`UPDATE project_core SET worldbuilding = ? WHERE id = 'main'`).run(`
# 核心地理概貌
## 苍穹之塔
高耸入云的古老观星塔，位于大陆中央。
## 迷雾群岛
常年被灰色魔雾遮蔽的神秘岛链，航路极为险恶。
## 黑曜石巨城
魔导工坊聚集的重装都市。
    `)

    const candidates = WorldMapRepository.extractCandidates()
    const names = candidates.map(candidate => candidate.name)
    expect(names).toContain('苍穹之塔')
    expect(names).toContain('迷雾群岛')
    expect(names).toContain('黑曜石巨城')

    // 候选绝不自动成为正式地点。
    expect(WorldMapRepository.getAll().nodes).toHaveLength(0)
  })
})
