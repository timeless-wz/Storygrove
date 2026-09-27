import {
  createPlotCanvasEdgeId,
  createPlotCanvasNodeId,
  isPlotCanvasNodeKind,
  MAX_PLOT_CANVAS_EDGE_LABEL_LENGTH,
  MAX_PLOT_CANVAS_NODES,
  MAX_PLOT_CANVAS_SUMMARY_LENGTH,
  MAX_PLOT_CANVAS_TITLE_LENGTH,
  normalizePlotCanvasTags,
  type PlotCanvasEdgeData,
  type PlotCanvasGraph,
  type PlotCanvasNodeData,
} from '../../shared/plot-canvas'

export type PlotCanvasAIMode = 'initialize' | 'discuss'

export interface PlotCanvasAIProposal {
  explanation: string
  expectedNodes: PlotCanvasNodeData[]
  expectedEdges: PlotCanvasEdgeData[]
  desiredNodes: PlotCanvasNodeData[]
  desiredEdges: PlotCanvasEdgeData[]
  addedNodes: number
  changedNodes: number
  removedNodes: number
  addedEdges: number
  changedEdges: number
  removedEdges: number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 返回的操作格式无效')
  return value as Record<string, unknown>
}

function requiredText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw new Error(`AI 返回的${field}为空或过长`)
  }
  return value.trim()
}

function optionalText(value: unknown, field: string, limit: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.trim().length > limit) throw new Error(`AI 返回的${field}无效`)
  return value.trim()
}

function parseTags(value: unknown): string[] {
  if (value === undefined) return []
  const tags = normalizePlotCanvasTags(value)
  if (!tags) throw new Error('AI 返回的节点标签无效')
  return tags
}

function parseChapters(value: unknown, allowed: ReadonlySet<number>): number[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 64 || value.some(chapter =>
    !Number.isSafeInteger(chapter) || !allowed.has(chapter as number))) {
    throw new Error('AI 返回了项目中不存在的章节引用')
  }
  return [...new Set(value as number[])].sort((a, b) => a - b)
}

function parseKind(value: unknown): NonNullable<PlotCanvasNodeData['kind']> {
  if (value === undefined) return 'plot'
  if (!isPlotCanvasNodeKind(value)) throw new Error('AI 返回了不支持的事件类型')
  return value
}

function parseEdgeKind(value: unknown): PlotCanvasEdgeData['kind'] {
  if (value === undefined) return 'main'
  if (value !== 'main' && value !== 'aux') throw new Error('AI 返回了不支持的连线类型')
  return value
}

/** 模型只提交候选操作；这里先校验、推演预览，绝不写数据库。 */
export function buildPlotCanvasAIProposal(
  content: string,
  graph: PlotCanvasGraph,
  mode: PlotCanvasAIMode,
  availableChapters: readonly number[],
): PlotCanvasAIProposal {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let root: Record<string, unknown>
  try {
    root = record(JSON.parse(clean))
  } catch {
    throw new Error('AI 未返回有效 JSON，请重试或切换模型')
  }
  const operations = root.operations
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 50) {
    throw new Error('AI 候选必须包含 1–50 个操作')
  }
  const explanation = optionalText(root.explanation, '变更说明', 500)
  const nodes = graph.nodes.map(node => ({ ...node }))
  let edges = graph.edges.map(edge => ({ ...edge }))
  const keys = new Map<string, string>()
  const allowed = new Set(availableChapters)
  let addedNodeIndex = 0
  const originX = graph.nodes.length ? Math.max(...graph.nodes.map(node => node.x)) + 320 : 80

  for (const raw of operations) {
    const op = record(raw)
    if (mode === 'initialize' && op.action !== 'add_node' && op.action !== 'add_edge') {
      throw new Error('初始化只能追加事件和连线')
    }
    if (op.action === 'add_node') {
      const key = requiredText(op.key, '临时标识', 60)
      if (keys.has(key) || graph.nodes.some(node => node.id === key)) throw new Error('AI 返回了重复的事件标识')
      const id = createPlotCanvasNodeId()
      keys.set(key, id)
      const col = addedNodeIndex % 3
      const row = Math.floor(addedNodeIndex / 3)
      nodes.push({
        id, canvasId: graph.canvas.id,
        kind: parseKind(op.kind),
        title: requiredText(op.title, '事件标题', MAX_PLOT_CANVAS_TITLE_LENGTH),
        summary: optionalText(op.summary, '事件摘要', MAX_PLOT_CANVAS_SUMMARY_LENGTH),
        colorKey: 'default',
        tags: parseTags(op.tags),
        entityRefs: [],
        chapterRefs: parseChapters(op.chapterRefs, allowed),
        planId: null,
        subCanvasId: null,
        x: originX + col * 320,
        y: 80 + row * 220,
      })
      addedNodeIndex += 1
    } else if (op.action === 'update_node' || op.action === 'delete_node') {
      const id = requiredText(op.id, '事件 ID', 100)
      const index = nodes.findIndex(node => node.id === id && graph.nodes.some(old => old.id === id))
      if (index < 0) throw new Error('AI 试图修改不存在的事件')
      if (op.action === 'delete_node') {
        nodes.splice(index, 1)
        edges = edges.filter(edge => edge.sourceNodeId !== id && edge.targetNodeId !== id)
      } else {
        const previous = nodes[index]
        nodes[index] = {
          ...previous,
          title: op.title === undefined ? previous.title : requiredText(op.title, '事件标题', MAX_PLOT_CANVAS_TITLE_LENGTH),
          summary: op.summary === undefined ? previous.summary : optionalText(op.summary, '事件摘要', MAX_PLOT_CANVAS_SUMMARY_LENGTH),
          kind: op.kind === undefined ? previous.kind : parseKind(op.kind),
          tags: op.tags === undefined ? previous.tags : parseTags(op.tags),
          chapterRefs: op.chapterRefs === undefined ? previous.chapterRefs : parseChapters(op.chapterRefs, allowed),
        }
      }
    } else if (op.action !== 'add_edge' && op.action !== 'update_edge' && op.action !== 'delete_edge') {
      throw new Error('AI 返回了不支持的画布操作')
    }
  }

  if (nodes.length > MAX_PLOT_CANVAS_NODES) throw new Error('AI 候选超过画布节点上限')
  for (const raw of operations) {
    const op = record(raw)
    if (op.action === 'add_edge') {
      const sourceKey = requiredText(op.source, '连线起点', 100)
      const targetKey = requiredText(op.target, '连线终点', 100)
      const source = keys.get(sourceKey) ?? sourceKey
      const target = keys.get(targetKey) ?? targetKey
      if (source === target || !nodes.some(node => node.id === source) || !nodes.some(node => node.id === target)) {
        throw new Error('AI 返回了无效的连线端点')
      }
      if (edges.some(edge =>
        (edge.sourceNodeId === source && edge.targetNodeId === target)
        || (edge.sourceNodeId === target && edge.targetNodeId === source))) {
        throw new Error('AI 返回了重复连线')
      }
      edges.push({
        id: createPlotCanvasEdgeId(), canvasId: graph.canvas.id,
        sourceNodeId: source, targetNodeId: target,
        label: optionalText(op.label, '连线标签', MAX_PLOT_CANVAS_EDGE_LABEL_LENGTH),
        kind: parseEdgeKind(op.kind),
      })
    } else if (op.action === 'update_edge' || op.action === 'delete_edge') {
      const id = requiredText(op.id, '连线 ID', 100)
      const index = edges.findIndex(edge => edge.id === id && graph.edges.some(old => old.id === id))
      if (index < 0) throw new Error('AI 试图修改不存在的连线')
      if (op.action === 'delete_edge') edges.splice(index, 1)
      else {
        edges[index] = {
          ...edges[index],
          label: op.label === undefined ? edges[index].label : optionalText(op.label, '连线标签', MAX_PLOT_CANVAS_EDGE_LABEL_LENGTH),
          kind: op.kind === undefined ? edges[index].kind : parseEdgeKind(op.kind),
        }
      }
    }
  }

  const oldNodes = new Map(graph.nodes.map(node => [node.id, node]))
  const oldEdges = new Map(graph.edges.map(edge => [edge.id, edge]))
  const addedNodes = nodes.filter(node => !oldNodes.has(node.id)).length
  const removedNodes = graph.nodes.filter(node => !nodes.some(next => next.id === node.id)).length
  const changedNodes = nodes.filter(node => oldNodes.has(node.id) && JSON.stringify(node) !== JSON.stringify(oldNodes.get(node.id))).length
  const addedEdges = edges.filter(edge => !oldEdges.has(edge.id)).length
  const removedEdges = graph.edges.filter(edge => !edges.some(next => next.id === edge.id)).length
  const changedEdges = edges.filter(edge => oldEdges.has(edge.id) && JSON.stringify(edge) !== JSON.stringify(oldEdges.get(edge.id))).length
  if (addedNodes + removedNodes + changedNodes + addedEdges + removedEdges + changedEdges === 0) {
    throw new Error('AI 未提出实际画布变更')
  }
  return {
    explanation,
    expectedNodes: graph.nodes,
    expectedEdges: graph.edges,
    desiredNodes: nodes,
    desiredEdges: edges,
    addedNodes, changedNodes, removedNodes,
    addedEdges, changedEdges, removedEdges,
  }
}
