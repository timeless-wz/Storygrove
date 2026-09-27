/**
 * 剧情画布搜索与筛选的纯函数库。
 *
 * 核心设计原则：
 * 1. 纯计算无副作用：筛选和搜索仅作用于视图展示，绝不更改或删除节点/边持久化数据；
 * 2. 连线显示规则明确且一致：
 *    - 当且仅当连线的两端节点（source 与 target）均在当前筛选视图中可见时，该连线才可见；
 *    - 只要任一端节点被筛选隐藏，连线立即隐藏（hidden: true），绝不残留悬空虚线；
 * 3. 搜索高亮与灰显规则：
 *    - 支持按标题（title）、摘要（summary）及标签（tags）进行不区分大小写匹配；
 *    - 有搜索关键词时，命中的可见节点 searchHit 为 true，其余可见节点 dimmed 为 true；
 *    - 连线若连接了至少一个搜索命中节点，则保持高亮，否则连线也灰显。
 */

import type { PlotGraphEdgeData, PlotGraphFilterState, PlotGraphNodeData, PlotNodeKind } from './types'
import { ALL_PLOT_NODE_KINDS } from './types'

export interface FilterResult<TNode = PlotGraphNodeData> {
  /** 处理后的全量节点（保持原引用或更新视图标志） */
  processedNodes: TNode[]
  /** 当前可见的节点列表（未被 kind 筛选隐藏） */
  visibleNodes: TNode[]
  /** 搜索命中且可见的节点列表 */
  searchHits: TNode[]
  /** 画布上各 kind 节点的数量分布 */
  kindCounts: Record<PlotNodeKind, number>
  /** 匹配结果总数 */
  matchCount: number
}

/**
 * 校验节点是否命中搜索词（检索 title, summary, tags）
 */
export function checkNodeSearchHit(node: PlotGraphNodeData, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false

  if (node.title && node.title.toLowerCase().includes(q)) return true
  if (node.summary && node.summary.toLowerCase().includes(q)) return true
  if (node.tags && node.tags.some(tag => tag.toLowerCase().includes(q))) return true

  return false
}

/**
 * 计算节点筛选与搜索状态
 */
export function filterPlotGraphNodes<TNode extends { id: string; data: PlotGraphNodeData }>(
  nodes: TNode[],
  filter: PlotGraphFilterState
): FilterResult<TNode> {
  const query = filter.searchQuery.trim().toLowerCase()
  const isSearchActive = query.length > 0
  const selectedKinds = filter.selectedKinds

  // 初始化各类别的计数器
  const kindCounts: Record<PlotNodeKind, number> = {
    plot: 0,
    idea: 0,
    foreshadow: 0,
    character: 0,
    location: 0,
    item: 0,
    faction: 0,
    skill: 0,
    chapter: 0,
    note: 0,
  }

  // 统计全量节点在各 kind 下的分布
  for (const node of nodes) {
    const kind = node.data.kind ?? 'plot'
    if (kind in kindCounts) {
      kindCounts[kind]++
    } else {
      kindCounts.plot++
    }
  }

  const processedNodes: TNode[] = []
  const visibleNodes: TNode[] = []
  const searchHits: TNode[] = []

  // 判断是否启用了特定种类筛选（若选了全部 10 种或空选，均视为全显）
  const isKindFilterActive = selectedKinds.size > 0 && selectedKinds.size < ALL_PLOT_NODE_KINDS.length

  for (const node of nodes) {
    const kind = node.data.kind ?? 'plot'
    const isKindVisible = !isKindFilterActive || selectedKinds.has(kind)

    if (!isKindVisible) {
      // 被 kind 筛选隐藏
      processedNodes.push({
        ...node,
        data: {
          ...node.data,
          hidden: true,
          dimmed: false,
          searchHit: false,
        },
      })
      continue
    }

    // 种类可见，进一步计算搜索命中与灰显
    const hit = isSearchActive ? checkNodeSearchHit(node.data, query) : false
    const dimmed = isSearchActive && !hit

    const updatedNode: TNode = {
      ...node,
      data: {
        ...node.data,
        hidden: false,
        dimmed,
        searchHit: hit,
      },
    }

    processedNodes.push(updatedNode)
    visibleNodes.push(updatedNode)
    if (hit) {
      searchHits.push(updatedNode)
    }
  }

  return {
    processedNodes,
    visibleNodes,
    searchHits,
    kindCounts,
    matchCount: isSearchActive ? searchHits.length : visibleNodes.length,
  }
}

/**
 * 纯函数：根据当前可见节点集合，确定连线的可见性与灰显状态。
 *
 * 显隐铁律：
 * - 当且仅当 source 与 target 两个节点 ID 都在 visibleNodeIdSet 中时，边才可见 (hidden: false)。
 * - 只要任意一端节点不存在或不可见，该边必须 hidden: true。
 * - 当有活跃搜索时，若边的任一端节点命中搜索，则该边保持清晰 (dimmed: false)；否则 dimmed: true。
 */
export function resolvePlotGraphEdgeVisibility<TEdge extends PlotGraphEdgeData>(
  edges: TEdge[],
  visibleNodeIdSet: Set<string>,
  searchHitNodeIdSet: Set<string>,
  isSearchActive: boolean
): TEdge[] {
  return edges.map(edge => {
    const sourceVisible = visibleNodeIdSet.has(edge.source)
    const targetVisible = visibleNodeIdSet.has(edge.target)
    const isVisible = sourceVisible && targetVisible

    if (!isVisible) {
      return {
        ...edge,
        hidden: true,
        dimmed: false,
      }
    }

    const connectedToSearchHit = isSearchActive
      ? searchHitNodeIdSet.has(edge.source) || searchHitNodeIdSet.has(edge.target)
      : true

    return {
      ...edge,
      hidden: false,
      dimmed: isSearchActive && !connectedToSearchHit,
    }
  })
}
