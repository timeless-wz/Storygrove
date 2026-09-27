import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { ProjectCoreRepository } from '../project-core-repository'
import { PlotCanvasRepository } from '../plot-canvas-repository'
import { ChapterCanvasRepository } from '../chapter-canvas-repository'
import {
  PLOT_CANVAS_NODE_KINDS,
  createPlotCanvasEdgeId,
  createPlotCanvasNodeId,
  resolvePlotCanvasNodeKind,
} from '../../../src/shared/plot-canvas'

let projectRoot = ''
const testRoot = path.join(os.tmpdir(), 'ai-novel-writer-canvas-repositories-tests')

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
  ProjectCoreRepository.init('Canvas novel', 'zh-CN')
})

afterEach(() => {
  closeProjectDatabase()
  fs.rmSync(projectRoot, { recursive: true, force: true })
})

/**
 * 在项目目录里预建 d9575c9 时期的剧情画布旧表结构（没有 description /
 * kind / tags / entity_refs），用于真实触发打开项目时的幂等增量迁移。
 */
function seedLegacyPlotCanvasSchema(projectPath: string): void {
  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE plot_canvases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_canvas_id TEXT DEFAULT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      viewport_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE plot_canvas_nodes (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      color_key TEXT NOT NULL DEFAULT 'default',
      chapter_refs TEXT NOT NULL DEFAULT '[]',
      plan_id INTEGER DEFAULT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE plot_canvas_edges (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  legacy.prepare(`
    INSERT INTO plot_canvases (id, name, parent_canvas_id, sort_order) VALUES (?, ?, NULL, 1)
  `).run('pca-aaaaaaaa-0000-4000-8000-000000000001', '旧卷主线')
  legacy.prepare(`
    INSERT INTO plot_canvas_nodes
      (id, canvas_id, title, summary, color_key, chapter_refs, plan_id, x, y)
    VALUES (?, ?, ?, ?, 'accent', ?, NULL, 12, 34)
  `).run(
    'pcn-bbbbbbbb-0000-4000-8000-000000000001',
    'pca-aaaaaaaa-0000-4000-8000-000000000001',
    '旧节点：发现刻痕',
    '旧摘要',
    JSON.stringify([2, 5]),
  )
  legacy.close()
}

function plotCanvasColumns(dbPath: string, table: string): Set<string> {
  const raw = new Database(dbPath)
  try {
    return new Set((raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map(column => column.name))
  } finally {
    raw.close()
  }
}

describe('PlotCanvasRepository', () => {
  it('创建、列表、重命名、排序画布', () => {
    const canvas = PlotCanvasRepository.create('第一卷主线', null)
    expect(canvas.name).toBe('第一卷主线')
    expect(canvas.parentCanvasId).toBeNull()
    const sub = PlotCanvasRepository.create('子画布', canvas.id)
    expect(sub.parentCanvasId).toBe(canvas.id)

    const renamed = PlotCanvasRepository.rename(canvas.id, '主线·修订')
    expect(renamed.name).toBe('主线·修订')

    PlotCanvasRepository.reorder([sub.id, canvas.id])
    const list = PlotCanvasRepository.list()
    expect(list.find(item => item.id === sub.id)?.sortOrder).toBe(1)

    expect(() => PlotCanvasRepository.create('', null)).toThrow('剧情画布名称不能为空')
  })

  it('move 拒绝把画布移进自己的子树', () => {
    const root = PlotCanvasRepository.create('根', null)
    const child = PlotCanvasRepository.create('子', root.id)
    expect(() => PlotCanvasRepository.move(root.id, child.id)).toThrow('剧情画布层级不能形成环')
    expect(() => PlotCanvasRepository.move(root.id, root.id)).toThrow('剧情画布不能以自己为父画布')
  })

  it('节点增改与校验', () => {
    const canvas = PlotCanvasRepository.create('画布', null)
    const node = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id,
      title: '  发现刻痕  ',
      summary: '林岚在门框上发现第二道刻痕。',
      colorKey: 'warning',
      chapterRefs: [2, 1],
      planId: null,
      x: 10.6,
      y: -3.2,
    })
    expect(node.title).toBe('发现刻痕')
    expect(node.chapterRefs).toEqual([1, 2])
    expect(node.colorKey).toBe('warning')
    expect(node.subCanvasId).toBeNull()

    const updated = PlotCanvasRepository.nodeUpsert({
      id: node.id,
      canvasId: canvas.id,
      title: '发现第三道刻痕',
      summary: '',
      chapterRefs: [2],
      planId: 5,
      x: 20,
      y: 30,
    })
    expect(updated.title).toBe('发现第三道刻痕')
    expect(updated.planId).toBe(5)

    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: '', summary: '', x: 0, y: 0,
    })).toThrow('剧情事件标题不能为空')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '', chapterRefs: [0], x: 0, y: 0,
    })).toThrow('剧情画布节点章节引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '', chapterRefs: [1, 1], x: 0, y: 0,
    })).toThrow('剧情画布节点章节引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: 'pca-00000000-1111-4222-8333-444444444444', title: 'x', summary: '', x: 0, y: 0,
    })).toThrow('剧情画布不存在')
  })

  it('subCanvasId 必须指向存在的其他画布', () => {
    const canvas = PlotCanvasRepository.create('主画布', null)
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '', subCanvasId: canvas.id, x: 0, y: 0,
    })).toThrow('剧情事件不能以所属画布为子画布')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      subCanvasId: 'pca-00000000-1111-4222-8333-444444444444', x: 0, y: 0,
    })).toThrow('子画布不存在')
  })

  it('连线：端点必须存在、禁自环、无向去重、标签与种类校验', () => {
    const canvas = PlotCanvasRepository.create('画布', null)
    const a = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'A', summary: '', x: 0, y: 0 })
    const b = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'B', summary: '', x: 300, y: 0 })

    const edge = PlotCanvasRepository.edgeUpsert({
      canvasId: canvas.id, sourceNodeId: a.id, targetNodeId: b.id, label: '承接', kind: 'main',
    })
    expect(edge.label).toBe('承接')

    // 反方向再连一条也视为重复（无向 pair 去重，参考项目语义）。
    expect(() => PlotCanvasRepository.edgeUpsert({
      canvasId: canvas.id, sourceNodeId: b.id, targetNodeId: a.id, label: '', kind: 'main',
    })).toThrow('两个剧情事件之间已存在连线')

    // 更新标签与种类。
    const updated = PlotCanvasRepository.edgeUpsert({
      id: edge.id, canvasId: canvas.id, sourceNodeId: a.id, targetNodeId: b.id, label: '埋下', kind: 'aux',
    })
    expect(updated.label).toBe('埋下')
    expect(updated.kind).toBe('aux')

    expect(() => PlotCanvasRepository.edgeUpsert({
      canvasId: canvas.id, sourceNodeId: a.id, targetNodeId: a.id, label: '', kind: 'main',
    })).toThrow('剧情画布连线不能连接自身')
    expect(() => PlotCanvasRepository.edgeUpsert({
      canvasId: canvas.id, sourceNodeId: 'pcn-00000000-1111-4222-8333-444444444444', targetNodeId: b.id, label: '', kind: 'main',
    })).toThrow('剧情画布连线端点节点不存在')
    expect(() => PlotCanvasRepository.edgeUpsert({
      id: edge.id, canvasId: canvas.id, sourceNodeId: b.id, targetNodeId: a.id, label: '', kind: 'main',
    })).toThrow('剧情连线端点不可变更，请删除后重新连接')
  })

  it('删除节点在同一事务中清掉相邻连线', () => {
    const canvas = PlotCanvasRepository.create('画布', null)
    const a = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'A', summary: '', x: 0, y: 0 })
    const b = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'B', summary: '', x: 300, y: 0 })
    const c = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'C', summary: '', x: 600, y: 0 })
    PlotCanvasRepository.edgeUpsert({ canvasId: canvas.id, sourceNodeId: a.id, targetNodeId: b.id, label: '', kind: 'main' })
    PlotCanvasRepository.edgeUpsert({ canvasId: canvas.id, sourceNodeId: b.id, targetNodeId: c.id, label: '', kind: 'main' })

    PlotCanvasRepository.nodeDelete(canvas.id, b.id)
    const graph = PlotCanvasRepository.getGraph(canvas.id)
    expect(graph.nodes.map(node => node.id)).toEqual([a.id, c.id])
    expect(graph.edges).toEqual([])
  })

  it('批量坐标回写与视口保存', () => {
    const canvas = PlotCanvasRepository.create('画布', null)
    const a = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'A', summary: '', x: 0, y: 0 })
    PlotCanvasRepository.nodeReposition(canvas.id, [{ nodeId: a.id, x: 111, y: 222 }])
    expect(PlotCanvasRepository.getGraph(canvas.id).nodes[0]?.x).toBe(111)

    PlotCanvasRepository.saveViewport(canvas.id, { x: 12, y: 34, zoom: 0.8 })
    expect(PlotCanvasRepository.getViewport(canvas.id)).toEqual({ x: 12, y: 34, zoom: 0.8 })
    expect(PlotCanvasRepository.getGraph(canvas.id).viewport).toEqual({ x: 12, y: 34, zoom: 0.8 })
    expect(() => PlotCanvasRepository.saveViewport(canvas.id, { x: 0, y: 0, zoom: 9 })).toThrow('剧情画布视口无效')
  })

  it('合并节点：章节引用并集、外部连线按原方向改接、源节点删除', () => {
    const canvas = PlotCanvasRepository.create('画布', null)
    const a = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'A', summary: '第一段', chapterRefs: [1], x: 0, y: 0 })
    const b = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'B', summary: '第二段', chapterRefs: [2], x: 300, y: 0 })
    const external = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: '外', summary: '', chapterRefs: [3], x: 600, y: 300 })
    PlotCanvasRepository.edgeUpsert({ canvasId: canvas.id, sourceNodeId: a.id, targetNodeId: b.id, label: '内部', kind: 'main' })
    PlotCanvasRepository.edgeUpsert({ canvasId: canvas.id, sourceNodeId: external.id, targetNodeId: a.id, label: '外部', kind: 'aux' })

    const merged = PlotCanvasRepository.mergeNodes({
      canvasId: canvas.id,
      sourceNodeIds: [a.id, b.id],
      title: '合并事件',
      summary: '第一段\n\n第二段',
    })
    const graph = PlotCanvasRepository.getGraph(canvas.id)
    expect(graph.nodes.map(node => node.id)).toEqual([external.id, merged.id])
    expect(merged.chapterRefs).toEqual([1, 2])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]?.sourceNodeId).toBe(external.id)
    expect(graph.edges[0]?.targetNodeId).toBe(merged.id)
    expect(graph.edges[0]?.label).toBe('外部')

    expect(() => PlotCanvasRepository.mergeNodes({
      canvasId: canvas.id, sourceNodeIds: [merged.id], title: 'x', summary: '',
    })).toThrow('合并至少需要两个剧情事件')
  })

  it('删除画布：promote-children 保留子画布，cascade 连子树一起删', () => {
    const root = PlotCanvasRepository.create('根', null)
    const child = PlotCanvasRepository.create('子', root.id)
    PlotCanvasRepository.nodeUpsert({
      canvasId: root.id, title: '入口', summary: '', subCanvasId: child.id, x: 0, y: 0,
    })

    const promote = PlotCanvasRepository.delete(root.id, 'promote-children')
    expect(promote.removedCanvasIds).toEqual([root.id])
    const afterPromote = PlotCanvasRepository.list()
    expect(afterPromote.map(canvas => canvas.id)).toContain(child.id)
    // 子画布仍然存在，指向它的入口节点已随根画布删除。
    expect(afterPromote.find(canvas => canvas.id === child.id)?.parentCanvasId).toBeNull()

    const root2 = PlotCanvasRepository.create('根2', null)
    const child2 = PlotCanvasRepository.create('子2', root2.id)
    const cascade = PlotCanvasRepository.delete(root2.id, 'cascade')
    expect(cascade.removedCanvasIds.sort()).toEqual([root2.id, child2.id].sort())
    expect(PlotCanvasRepository.list().map(canvas => canvas.id)).toEqual([child.id])
  })

  it('删除被引用的子画布后，指向它的节点 subCanvasId 被置空', () => {
    const root = PlotCanvasRepository.create('根', null)
    const sub = PlotCanvasRepository.create('子', root.id)
    const node = PlotCanvasRepository.nodeUpsert({
      canvasId: root.id, title: '入口', summary: '', subCanvasId: sub.id, x: 0, y: 0,
    })
    PlotCanvasRepository.delete(sub.id, 'promote-children')
    const graph = PlotCanvasRepository.getGraph(root.id)
    expect(graph.nodes.find(item => item.id === node.id)?.subCanvasId).toBeNull()
  })

  it('渲染层生成的 id 可以直接 upsert（幂等重试语义）', () => {
    const canvas = PlotCanvasRepository.create('画布', null)
    const id = createPlotCanvasNodeId()
    PlotCanvasRepository.nodeUpsert({ id, canvasId: canvas.id, title: 'A', summary: '', x: 1, y: 2 })
    PlotCanvasRepository.nodeUpsert({ id, canvasId: canvas.id, title: 'A2', summary: '', x: 3, y: 4 })
    const graph = PlotCanvasRepository.getGraph(canvas.id)
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]?.title).toBe('A2')
  })

  it('AI 预览整图提交在一个事务中完成，旧基线和无效连线均不写入', () => {
    const canvas = PlotCanvasRepository.create('AI 画布', null)
    const first = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: '开端', summary: '', x: 0, y: 0 })
    const baseline = PlotCanvasRepository.getGraph(canvas.id)
    const second = { ...first, id: createPlotCanvasNodeId(), title: '转折', x: 320 }
    const edge = {
      id: createPlotCanvasEdgeId(), canvasId: canvas.id,
      sourceNodeId: first.id, targetNodeId: second.id, label: '导致', kind: 'main' as const,
    }
    const applied = PlotCanvasRepository.applyGraph({
      canvasId: canvas.id,
      expectedNodes: baseline.nodes, expectedEdges: baseline.edges,
      desiredNodes: [first, second], desiredEdges: [edge],
    })
    expect(applied.nodes.map(node => node.title)).toEqual(['开端', '转折'])
    expect(applied.edges[0]?.label).toBe('导致')

    expect(() => PlotCanvasRepository.applyGraph({
      canvasId: canvas.id,
      expectedNodes: baseline.nodes, expectedEdges: baseline.edges,
      desiredNodes: [first], desiredEdges: [],
    })).toThrow('画布在生成候选后发生了变化')

    const current = PlotCanvasRepository.getGraph(canvas.id)
    const third = { ...first, id: createPlotCanvasNodeId(), title: '尾声', x: 640 }
    expect(() => PlotCanvasRepository.applyGraph({
      canvasId: canvas.id,
      expectedNodes: current.nodes, expectedEdges: current.edges,
      desiredNodes: [...current.nodes, third],
      desiredEdges: [...current.edges, {
        id: createPlotCanvasEdgeId(), canvasId: canvas.id,
        sourceNodeId: third.id, targetNodeId: third.id, label: '', kind: 'main',
      }],
    })).toThrow('剧情画布连线不能连接自身')
    expect(PlotCanvasRepository.getGraph(canvas.id).nodes).toHaveLength(2)
    expect(PlotCanvasRepository.getGraph(canvas.id).edges).toHaveLength(1)
  })
})

describe('ChapterCanvasRepository', () => {
  it('空章返回 null 画布；节点保存惰性建画布', () => {
    expect(ChapterCanvasRepository.get(3).canvas).toBeNull()
    const node = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 3, type: 'scene', title: '开场', summary: '', role: '建置', order: 1, x: 100, y: 300,
    })
    expect(node.canvasId).toBe('cha-3')
    const graph = ChapterCanvasRepository.get(3)
    expect(graph.canvas?.chapterNumber).toBe(3)
    expect(graph.nodes).toHaveLength(1)
  })

  it('场景与辅助节点的字段校验', () => {
    expect(() => ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'scene', title: 'x', summary: '', role: '不存在的定位', order: 1, x: 0, y: 0,
    })).toThrow('章节画布场景定位无效')
    expect(() => ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'scene', title: 'x', summary: '', role: '', order: 0, x: 0, y: 0,
    })).toThrow('章节画布场景顺序无效')
    expect(() => ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'character', title: 'x', summary: '', refs: { characterName: 'a'.repeat(90) }, x: 0, y: 0,
    })).toThrow('章节画布角色引用无效')
    const ok = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'scene', title: '场景', summary: '要点', role: '高潮', order: 2, x: 5, y: 6,
    })
    expect(ok.order).toBe(2)
  })

  it('场景↔场景连线被禁止；辅助连线无向去重', () => {
    const s1 = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'scene', title: 'S1', summary: '', role: '', order: 1, x: 0, y: 300,
    })
    const s2 = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'scene', title: 'S2', summary: '', role: '', order: 2, x: 460, y: 300,
    })
    const c = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 1, type: 'character', title: '角色', summary: '', refs: { characterName: '林岚' }, x: 200, y: 0,
    })
    expect(() => ChapterCanvasRepository.edgeUpsert({
      chapterNumber: 1, sourceNodeId: s1.id, targetNodeId: s2.id, label: '', kind: 'main',
    })).toThrow('场景之间不需要连线')

    const edge = ChapterCanvasRepository.edgeUpsert({
      chapterNumber: 1, sourceNodeId: s1.id, targetNodeId: c.id, label: '出场', kind: 'aux',
    })
    expect(edge.label).toBe('出场')
    expect(() => ChapterCanvasRepository.edgeUpsert({
      chapterNumber: 1, sourceNodeId: c.id, targetNodeId: s1.id, label: '', kind: 'aux',
    })).toThrow('两个画布节点之间已存在连线')
  })

  it('节点删除连带连线；deleteByChapter 幂等清理', () => {
    const s1 = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 7, type: 'scene', title: 'S1', summary: '', role: '', order: 1, x: 0, y: 0,
    })
    const c = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 7, type: 'idea', title: '灵感', summary: '', x: 100, y: 0,
    })
    ChapterCanvasRepository.edgeUpsert({
      chapterNumber: 7, sourceNodeId: s1.id, targetNodeId: c.id, label: '', kind: 'aux',
    })
    ChapterCanvasRepository.nodeDelete(7, c.id)
    expect(ChapterCanvasRepository.get(7).edges).toEqual([])

    ChapterCanvasRepository.saveViewport(7, { x: 1, y: 2, zoom: 0.9 })
    ChapterCanvasRepository.deleteByChapter(7)
    expect(ChapterCanvasRepository.get(7).canvas).toBeNull()
    expect(() => ChapterCanvasRepository.deleteByChapter(7)).not.toThrow()
  })

  it('批量坐标与视口', () => {
    const s1 = ChapterCanvasRepository.nodeUpsert({
      chapterNumber: 2, type: 'scene', title: 'S1', summary: '', role: '', order: 1, x: 0, y: 0,
    })
    ChapterCanvasRepository.nodeReposition(2, [{ nodeId: s1.id, x: 460, y: 300 }])
    expect(ChapterCanvasRepository.get(2).nodes[0]?.x).toBe(460)
    ChapterCanvasRepository.saveViewport(2, { x: 0, y: 0, zoom: 0.75 })
    expect(ChapterCanvasRepository.get(2).canvas?.viewport).toEqual({ x: 0, y: 0, zoom: 0.75 })
  })
})

describe('PlotCanvasRepository 旧库升级与新增数据字段', () => {
  it('d9575c9 旧库打开时幂等迁移：补列、旧画布与旧节点一行不丢、缺省回落', () => {
    closeProjectDatabase()
    fs.rmSync(projectRoot, { recursive: true, force: true })
    projectRoot = fs.mkdtempSync(path.join(testRoot, 'legacy-'))
    const legacyCanvasId = 'pca-aaaaaaaa-0000-4000-8000-000000000001'
    const legacyNodeId = 'pcn-bbbbbbbb-0000-4000-8000-000000000001'
    seedLegacyPlotCanvasSchema(projectRoot)
    const dbPath = path.join(projectRoot, '.vela', 'vela.db')

    // 迁移前：旧结构，没有 description / kind / tags / entity_refs。
    expect(plotCanvasColumns(dbPath, 'plot_canvases').has('description')).toBe(false)
    expect(plotCanvasColumns(dbPath, 'plot_canvas_nodes').has('kind')).toBe(false)
    expect(plotCanvasColumns(dbPath, 'plot_canvas_nodes').has('tags')).toBe(false)
    expect(plotCanvasColumns(dbPath, 'plot_canvas_nodes').has('entity_refs')).toBe(false)

    initProjectDatabase(projectRoot)
    ProjectCoreRepository.init('旧库升级', 'zh-CN')

    // 迁移后：列存在。
    expect(plotCanvasColumns(dbPath, 'plot_canvases').has('description')).toBe(true)
    expect(plotCanvasColumns(dbPath, 'plot_canvas_nodes').has('kind')).toBe(true)
    expect(plotCanvasColumns(dbPath, 'plot_canvas_nodes').has('tags')).toBe(true)
    expect(plotCanvasColumns(dbPath, 'plot_canvas_nodes').has('entity_refs')).toBe(true)

    // 旧画布与旧节点一行不丢，缺省回落迁移默认值。
    const canvases = PlotCanvasRepository.list()
    expect(canvases.map(canvas => canvas.id)).toEqual([legacyCanvasId])
    expect(canvases[0]?.name).toBe('旧卷主线')
    expect(canvases[0]?.description).toBe('')
    const graph = PlotCanvasRepository.getGraph(legacyCanvasId)
    expect(graph.nodes.map(node => node.id)).toEqual([legacyNodeId])
    const legacyNode = graph.nodes[0]
    expect(legacyNode?.title).toBe('旧节点：发现刻痕')
    expect(legacyNode?.chapterRefs).toEqual([2, 5])
    expect(resolvePlotCanvasNodeKind(legacyNode)).toBe('plot')
    expect(legacyNode?.tags).toEqual([])
    expect(legacyNode?.entityRefs).toEqual([])

    // 再次打开项目：迁移幂等，数据仍完好。
    closeProjectDatabase()
    initProjectDatabase(projectRoot)
    expect(plotCanvasColumns(dbPath, 'plot_canvases').has('description')).toBe(true)
    expect(PlotCanvasRepository.list().map(canvas => canvas.id)).toEqual([legacyCanvasId])
    expect(PlotCanvasRepository.getGraph(legacyCanvasId).nodes).toHaveLength(1)
  })

  it('旧调用方（不带 kind / tags / entityRefs）更新旧节点不丢新字段', () => {
    const canvas = PlotCanvasRepository.create('主线', null)
    const node = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id,
      title: '伏笔节点',
      summary: '',
      kind: 'foreshadow',
      tags: ['第一卷'],
      entityRefs: [{ entityType: 'foreshadowing', entityId: 'fsh-1' }],
      x: 0,
      y: 0,
    })
    // 模拟旧 UI 的整体更新载荷：不含任何新字段。
    const updated = PlotCanvasRepository.nodeUpsert({
      id: node.id,
      canvasId: canvas.id,
      title: '伏笔节点（改动）',
      summary: '新摘要',
      x: 10,
      y: 20,
    })
    expect(updated.title).toBe('伏笔节点（改动）')
    expect(resolvePlotCanvasNodeKind(updated)).toBe('foreshadow')
    expect(updated.tags).toEqual(['第一卷'])
    expect(updated.entityRefs).toEqual([{ entityType: 'foreshadowing', entityId: 'fsh-1' }])
  })
})

describe('PlotCanvasRepository 画布说明（description）', () => {
  it('创建带说明、缺省为空、list / graph 可读', () => {
    const withDescription = PlotCanvasRepository.create('带说明', null, '  第一卷的推进主线。  ')
    expect(withDescription.description).toBe('第一卷的推进主线。')
    expect(PlotCanvasRepository.list().find(canvas => canvas.id === withDescription.id)?.description)
      .toBe('第一卷的推进主线。')
    expect(PlotCanvasRepository.getGraph(withDescription.id).canvas.description).toBe('第一卷的推进主线。')

    const withoutDescription = PlotCanvasRepository.create('不带说明', null)
    expect(withoutDescription.description).toBe('')
  })

  it('update 部分更新：改说明不改名、改名不改说明、空串清空说明', () => {
    const canvas = PlotCanvasRepository.create('主线', null, '初始说明')
    const descriptionOnly = PlotCanvasRepository.update({ canvasId: canvas.id, description: '只改说明' })
    expect(descriptionOnly.description).toBe('只改说明')
    expect(descriptionOnly.name).toBe('主线')

    const nameOnly = PlotCanvasRepository.update({ canvasId: canvas.id, name: ' 主线·修订 ' })
    expect(nameOnly.name).toBe('主线·修订')
    expect(nameOnly.description).toBe('只改说明')

    const cleared = PlotCanvasRepository.update({ canvasId: canvas.id, description: '' })
    expect(cleared.description).toBe('')

    const both = PlotCanvasRepository.update({ canvasId: canvas.id, name: '终稿', description: '最终说明' })
    expect(both.name).toBe('终稿')
    expect(both.description).toBe('最终说明')

    // 缺省载荷 = 不变更。
    const untouched = PlotCanvasRepository.update({ canvasId: canvas.id })
    expect(untouched.name).toBe('终稿')
    expect(untouched.description).toBe('最终说明')

    // rename 通道继续可用且不触碰说明。
    const renamed = PlotCanvasRepository.rename(canvas.id, '只改名')
    expect(renamed.name).toBe('只改名')
    expect(renamed.description).toBe('最终说明')
  })

  it('说明超长被拒绝，画布保持原值', () => {
    const canvas = PlotCanvasRepository.create('主线', null, '原始')
    const tooLong = '超'.repeat(2001)
    expect(() => PlotCanvasRepository.create('另一块', null, tooLong))
      .toThrow('剧情画布说明超出 2000 字上限')
    expect(() => PlotCanvasRepository.update({ canvasId: canvas.id, description: tooLong }))
      .toThrow('剧情画布说明超出 2000 字上限')
    expect(PlotCanvasRepository.list().find(item => item.id === canvas.id)?.description).toBe('原始')
  })
})

describe('PlotCanvasRepository 节点 kind（十种）', () => {
  it('十种 kind 全部可创建并原样读回；缺省为 plot', () => {
    const canvas = PlotCanvasRepository.create('种类演练', null)
    const kinds = [...PLOT_CANVAS_NODE_KINDS]
    expect(kinds).toHaveLength(10)
    const created = kinds.map((kind, index) => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id,
      kind,
      title: `节点-${kind}`,
      summary: '',
      x: index * 100,
      y: 0,
    }))
    const graph = PlotCanvasRepository.getGraph(canvas.id)
    for (const [index, node] of graph.nodes.entries()) {
      expect(node.id).toBe(created[index]?.id)
      expect(resolvePlotCanvasNodeKind(node)).toBe(kinds[index])
      expect(node.kind).toBe(kinds[index])
    }
    // 缺省 kind：新建回落 plot。
    const fallback = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: '缺省种类', summary: '', x: 0, y: 999,
    })
    expect(resolvePlotCanvasNodeKind(fallback)).toBe('plot')
  })

  it('非法 kind 在写入时被拒绝（upsert 与 merge 均如此）', () => {
    const canvas = PlotCanvasRepository.create('非法种类', null)
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, kind: 'dragon', title: 'x', summary: '', x: 0, y: 0,
    })).toThrow('剧情画布节点种类无效')
    const a = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'A', summary: '', x: 0, y: 0 })
    const b = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, title: 'B', summary: '', x: 100, y: 0 })
    expect(() => PlotCanvasRepository.mergeNodes({
      canvasId: canvas.id, sourceNodeIds: [a.id, b.id],
      title: '合并', summary: '', kind: 'creature',
    })).toThrow('剧情画布节点种类无效')
    // 非法写入没有留下任何节点。
    expect(PlotCanvasRepository.getGraph(canvas.id).nodes).toHaveLength(2)
  })

  it('合并节点：kind 取载荷或首源，标签与实体引用取并集', () => {
    const canvas = PlotCanvasRepository.create('合并演练', null)
    const a = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, kind: 'idea', title: 'A', summary: '甲',
      tags: ['伏笔', '第一卷'],
      entityRefs: [{ entityType: 'foreshadowing', entityId: 'fsh-1' }],
      x: 0, y: 0,
    })
    const b = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, kind: 'note', title: 'B', summary: '乙',
      tags: ['第一卷', '回收'],
      entityRefs: [
        { entityType: 'foreshadowing', entityId: 'fsh-1' },
        { entityType: 'world-map-node', entityId: 'node-map-1' },
      ],
      x: 200, y: 0,
    })
    const merged = PlotCanvasRepository.mergeNodes({
      canvasId: canvas.id, sourceNodeIds: [a.id, b.id], title: '合并', summary: '甲乙',
    })
    expect(resolvePlotCanvasNodeKind(merged)).toBe('idea')
    expect(merged.tags).toEqual(['伏笔', '第一卷', '回收'])
    expect(merged.entityRefs).toEqual([
      { entityType: 'foreshadowing', entityId: 'fsh-1' },
      { entityType: 'world-map-node', entityId: 'node-map-1' },
    ])
    // 载荷显式覆盖 kind。
    const c = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, kind: 'item', title: 'C', summary: '', x: 400, y: 0 })
    const d = PlotCanvasRepository.nodeUpsert({ canvasId: canvas.id, kind: 'skill', title: 'D', summary: '', x: 600, y: 0 })
    const overridden = PlotCanvasRepository.mergeNodes({
      canvasId: canvas.id, sourceNodeIds: [c.id, d.id], title: '再合并', summary: '', kind: 'faction',
    })
    expect(resolvePlotCanvasNodeKind(overridden)).toBe('faction')
  })
})

describe('PlotCanvasRepository 节点标签与实体引用', () => {
  it('标签：修剪、去空、去重并保持顺序；超限被拒绝', () => {
    const canvas = PlotCanvasRepository.create('标签演练', null)
    const node = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'T', summary: '',
      tags: [' 伏笔 ', '高潮', '', '伏笔', '高潮 '],
      x: 0, y: 0,
    })
    expect(node.tags).toEqual(['伏笔', '高潮'])
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'T2', summary: '', tags: ['超'.repeat(41)], x: 0, y: 0,
    })).toThrow('剧情画布节点标签无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'T3', summary: '',
      tags: Array.from({ length: 33 }, (_, index) => `t${index}`), x: 0, y: 0,
    })).toThrow('剧情画布节点标签无效')
    // 显式空数组清空标签；undefined 保留。
    const cleared = PlotCanvasRepository.nodeUpsert({
      id: node.id, canvasId: canvas.id, title: 'T', summary: '', tags: [], x: 0, y: 0,
    })
    expect(cleared.tags).toEqual([])
  })

  it('四种真实实体引用往返：伏笔 / 地图地点 / 时间线事件 / 正文草稿', () => {
    const canvas = PlotCanvasRepository.create('引用演练', null)
    const node = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: '引用节点', summary: '',
      entityRefs: [
        { entityType: 'foreshadowing', entityId: 'fsh-1758000000000-ab12cd34' },
        { entityType: 'world-map-node', entityId: 'node-00000000-1111-4000-8000-000000000000' },
        { entityType: 'timeline-event', entityId: 'tle-00000000-1111-4000-8000-000000000000' },
        { entityType: 'draft', entityId: 42 },
      ],
      x: 0, y: 0,
    })
    expect(node.entityRefs).toEqual([
      { entityType: 'foreshadowing', entityId: 'fsh-1758000000000-ab12cd34' },
      { entityType: 'world-map-node', entityId: 'node-00000000-1111-4000-8000-000000000000' },
      { entityType: 'timeline-event', entityId: 'tle-00000000-1111-4000-8000-000000000000' },
      { entityType: 'draft', entityId: 42 },
    ])
    expect(PlotCanvasRepository.getGraph(canvas.id).nodes[0]?.entityRefs).toHaveLength(4)
  })

  it('悬挂引用原样保留（引用失效由画布侧展示，写入不校验存在性）', () => {
    const canvas = PlotCanvasRepository.create('悬挂引用', null)
    // 两个 ID 都不指向任何真实记录：仍必须可写、可读。
    const node = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: '失效演练', summary: '',
      entityRefs: [
        { entityType: 'foreshadowing', entityId: 'fsh-gone' },
        { entityType: 'world-map-node', entityId: 'node-gone' },
      ],
      x: 0, y: 0,
    })
    const reread = PlotCanvasRepository.getGraph(canvas.id).nodes[0]
    expect(reread?.entityRefs).toEqual(node.entityRefs)
    // 更新别的字段，悬挂引用不被静默清除。
    const touched = PlotCanvasRepository.nodeUpsert({
      id: node.id, canvasId: canvas.id, title: '失效演练·改', summary: '', x: 5, y: 5,
    })
    expect(touched.entityRefs).toEqual(node.entityRefs)
  })

  it('空引用与非法引用：空数组合法，未知类型 / 空 ID / 非法 draft ID 被拒绝', () => {
    const canvas = PlotCanvasRepository.create('引用校验', null)
    const empty = PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: '空引用', summary: '', entityRefs: [], x: 0, y: 0,
    })
    expect(empty.entityRefs).toEqual([])

    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      entityRefs: [{ entityType: 'character', entityId: 'whoever' }], x: 0, y: 0,
    })).toThrow('剧情画布节点实体引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      entityRefs: [{ entityType: 'foreshadowing', entityId: '   ' }], x: 0, y: 0,
    })).toThrow('剧情画布节点实体引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      entityRefs: [{ entityType: 'draft', entityId: 0 }], x: 0, y: 0,
    })).toThrow('剧情画布节点实体引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      entityRefs: [{ entityType: 'draft', entityId: 1.5 }], x: 0, y: 0,
    })).toThrow('剧情画布节点实体引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      entityRefs: [{ entityType: 'foreshadowing', entityId: '长'.repeat(121) }], x: 0, y: 0,
    })).toThrow('剧情画布节点实体引用无效')
    expect(() => PlotCanvasRepository.nodeUpsert({
      canvasId: canvas.id, title: 'x', summary: '',
      entityRefs: Array.from({ length: 33 }, (_, index) => (
        { entityType: 'foreshadowing', entityId: `fsh-${index}` })), x: 0, y: 0,
    })).toThrow('剧情画布节点实体引用无效')
    // 以上非法写入全部未落行。
    expect(PlotCanvasRepository.getGraph(canvas.id).nodes.map(node => node.title))
      .toEqual(['空引用'])
  })
})
