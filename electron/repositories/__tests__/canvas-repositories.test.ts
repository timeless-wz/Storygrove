import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { ProjectCoreRepository } from '../project-core-repository'
import { PlotCanvasRepository } from '../plot-canvas-repository'
import { ChapterCanvasRepository } from '../chapter-canvas-repository'
import { createPlotCanvasNodeId } from '../../../src/shared/plot-canvas'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/canvas-repositories-tests')

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
