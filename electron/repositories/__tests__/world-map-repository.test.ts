import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase, getProjectDb } from '../../database'
import { WorldMapRepository } from '../world-map-repository'
import { ProjectCoreRepository } from '../project-core-repository'
import type { WorldMapNode, WorldMapEdge } from '../../../src/shared/world-map'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/world-map-repository-tests')

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
  fs.rmSync(projectRoot, { recursive: true, force: true })
})

describe('WorldMapRepository', () => {
  it('returns empty nodes and edges initially', () => {
    const data = WorldMapRepository.getAll()
    expect(data.nodes).toEqual([])
    expect(data.edges).toEqual([])
  })

  it('can upsert and retrieve map nodes', () => {
    const node1: WorldMapNode = {
      id: 'node-city-1',
      name: '白银之城',
      type: 'city',
      description: '北境最大的人类城邦',
      parentId: null,
      mapLayer: 'surface',
      x: 100,
      y: 200,
      sourceRefs: ['01_已确认设定清单.md'],
    }

    const saved = WorldMapRepository.upsertNode(node1)
    expect(saved.id).toBe('node-city-1')
    expect(saved.name).toBe('白银之城')

    const data = WorldMapRepository.getAll()
    expect(data.nodes).toHaveLength(1)
    expect(data.nodes[0].name).toBe('白银之城')
    expect(data.nodes[0].type).toBe('city')
    expect(data.nodes[0].x).toBe(100)
    expect(data.nodes[0].sourceRefs).toEqual(['01_已确认设定清单.md'])
  })

  it('can update existing map nodes', () => {
    const node: WorldMapNode = {
      id: 'node-relic-1',
      name: '永夜回廊',
      type: 'relic',
      description: '初版描述',
      parentId: null,
      mapLayer: 'underground',
      x: 50,
      y: 80,
      sourceRefs: [],
    }
    WorldMapRepository.upsertNode(node)

    // Update
    WorldMapRepository.upsertNode({
      ...node,
      description: '更新后的描述：充满虚空暗影的遗迹',
      x: 60,
    })

    const data = WorldMapRepository.getAll()
    expect(data.nodes).toHaveLength(1)
    expect(data.nodes[0].description).toBe('更新后的描述：充满虚空暗影的遗迹')
    expect(data.nodes[0].x).toBe(60)
  })

  it('can upsert, retrieve and delete edges between nodes', () => {
    const nodeA: WorldMapNode = {
      id: 'node-a',
      name: '东港',
      type: 'city',
      description: '',
      parentId: null,
      mapLayer: 'surface',
      x: 0,
      y: 0,
      sourceRefs: [],
    }
    const nodeB: WorldMapNode = {
      id: 'node-b',
      name: '西渊',
      type: 'relic',
      description: '',
      parentId: null,
      mapLayer: 'surface',
      x: 100,
      y: 100,
      sourceRefs: [],
    }
    WorldMapRepository.upsertNode(nodeA)
    WorldMapRepository.upsertNode(nodeB)

    const edge: WorldMapEdge = {
      id: 'edge-1',
      fromNodeId: 'node-a',
      toNodeId: 'node-b',
      type: 'route',
      description: '东海主航路',
      status: 'active',
    }
    WorldMapRepository.upsertEdge(edge)

    let data = WorldMapRepository.getAll()
    expect(data.edges).toHaveLength(1)
    expect(data.edges[0].type).toBe('route')
    expect(data.edges[0].fromNodeId).toBe('node-a')
    expect(data.edges[0].toNodeId).toBe('node-b')

    // Delete edge
    WorldMapRepository.deleteEdge('edge-1')
    data = WorldMapRepository.getAll()
    expect(data.edges).toHaveLength(0)
  })

  it('cascades connected edges and resets children parentId when a node is deleted', () => {
    const parent: WorldMapNode = {
      id: 'parent-region',
      name: '苍暮大裂谷',
      type: 'region',
      description: '',
      parentId: null,
      mapLayer: 'surface',
      x: 0,
      y: 0,
      sourceRefs: [],
    }
    const child: WorldMapNode = {
      id: 'child-relic',
      name: '裂谷深渊遗迹',
      type: 'relic',
      description: '',
      parentId: 'parent-region',
      mapLayer: 'underground',
      x: 10,
      y: 10,
      sourceRefs: [],
    }
    WorldMapRepository.upsertNode(parent)
    WorldMapRepository.upsertNode(child)

    WorldMapRepository.upsertEdge({
      id: 'edge-rel',
      fromNodeId: 'parent-region',
      toNodeId: 'child-relic',
      type: 'subordinate',
      description: '',
      status: 'active',
    })

    expect(WorldMapRepository.getAll().edges).toHaveLength(1)

    // Delete parent
    WorldMapRepository.deleteNode('parent-region')

    const data = WorldMapRepository.getAll()
    expect(data.nodes).toHaveLength(1)
    expect(data.nodes[0].id).toBe('child-relic')
    expect(data.nodes[0].parentId).toBeNull()
    expect(data.edges).toHaveLength(0)
  })

  it('extracts candidate nodes from worldbuilding text without committing them', () => {
    // Set worldbuilding text in project_core
    const db = getProjectDb()!
    db.prepare(`
      UPDATE project_core SET worldbuilding = ? WHERE id = 'main'
    `).run(`
# 核心地理概貌
## 苍穹之塔
高耸入云的古老观星塔，位于大陆中央。
## 迷雾群岛
常年被灰色魔雾遮蔽的神秘岛链，航路极为险恶。
## 黑曜石巨城
魔导工坊聚集的重装都市。
    `)

    const candidates = WorldMapRepository.extractCandidates()
    expect(candidates.length).toBeGreaterThanOrEqual(3)

    const names = candidates.map(c => c.name)
    expect(names).toContain('苍穹之塔')
    expect(names).toContain('迷雾群岛')
    expect(names).toContain('黑曜石巨城')

    // Verify candidates are NOT in formal nodes table!
    const formalData = WorldMapRepository.getAll()
    expect(formalData.nodes).toHaveLength(0)
  })
})
