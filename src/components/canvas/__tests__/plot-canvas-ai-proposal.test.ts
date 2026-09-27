import { describe, expect, it } from 'vitest'

import { createPlotCanvasId, createPlotCanvasNodeId, type PlotCanvasGraph } from '../../../shared/plot-canvas'
import { buildPlotCanvasAIProposal } from '../plot-canvas-ai-proposal'

function graph(): PlotCanvasGraph {
  const canvasId = createPlotCanvasId()
  return {
    canvas: { id: canvasId, name: '主线', description: '', parentCanvasId: null, sortOrder: 1 },
    viewport: null,
    nodes: [{
      id: createPlotCanvasNodeId(), canvasId, title: '旧事件', summary: '', kind: 'plot',
      colorKey: 'default', tags: [], entityRefs: [], chapterRefs: [1],
      planId: null, subCanvasId: null, x: 80, y: 80,
    }],
    edges: [],
  }
}

describe('plot canvas AI proposal', () => {
  it('turns a model proposal into a preview without changing the original graph', () => {
    const current = graph()
    const proposal = buildPlotCanvasAIProposal(JSON.stringify({
      explanation: '加强因果关系',
      operations: [
        { action: 'update_node', id: current.nodes[0].id, title: '发现铜牌' },
        { action: 'add_node', key: 'n2', title: '追查来历', chapterRefs: [2], kind: 'foreshadow' },
        { action: 'add_edge', source: current.nodes[0].id, target: 'n2', label: '引发' },
      ],
    }), current, 'discuss', [1, 2])
    expect(proposal.changedNodes).toBe(1)
    expect(proposal.addedNodes).toBe(1)
    expect(proposal.addedEdges).toBe(1)
    expect(proposal.desiredEdges[0]?.targetNodeId).toBe(proposal.desiredNodes[1]?.id)
    expect(current.nodes[0].title).toBe('旧事件')
    expect(current.edges).toEqual([])
  })

  it('rejects invented references and destructive initialization output', () => {
    const current = graph()
    expect(() => buildPlotCanvasAIProposal(JSON.stringify({ operations: [
      { action: 'add_node', key: 'n1', title: '错误章节', chapterRefs: [99] },
    ] }), current, 'initialize', [1])).toThrow('不存在的章节引用')
    expect(() => buildPlotCanvasAIProposal(JSON.stringify({ operations: [
      { action: 'delete_node', id: current.nodes[0].id },
    ] }), current, 'initialize', [1])).toThrow('初始化只能追加')
    expect(() => buildPlotCanvasAIProposal(JSON.stringify({ operations: [
      { action: 'update_node', id: createPlotCanvasNodeId(), title: '凭空修改' },
    ] }), current, 'discuss', [1])).toThrow('不存在的事件')
  })

  it('removes adjacent links when an approved conversation deletes an event', () => {
    const current = graph()
    const second = { ...current.nodes[0], id: createPlotCanvasNodeId(), title: '第二事件', x: 400 }
    current.nodes.push(second)
    current.edges.push({
      id: 'pce-10000000-0000-4000-8000-000000000001', canvasId: current.canvas.id,
      sourceNodeId: current.nodes[0].id, targetNodeId: second.id, label: '', kind: 'main',
    })
    const proposal = buildPlotCanvasAIProposal(JSON.stringify({ operations: [
      { action: 'delete_node', id: second.id },
    ] }), current, 'discuss', [1])
    expect(proposal.removedNodes).toBe(1)
    expect(proposal.removedEdges).toBe(1)
    expect(proposal.desiredNodes.map(node => node.id)).toEqual([current.nodes[0].id])
    expect(proposal.desiredEdges).toEqual([])
  })
})
