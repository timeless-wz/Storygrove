/**
 * 剧情画布图层（Plot Graph）独立类型定义与契约。
 *
 * 遵循隔离原则：
 * - 纯前台 View Model，不侵入项目持久化 schema；
 * - 兼顾兼容旧版 PlotEventCardNodeData 字段；
 * - 支持 10 种节点种类（kind）的视觉与层级表征；
 * - 为集成者提供无缝接入 @xyflow/react 的节点与纯函数接口。
 */

import type { Node, Edge } from '@xyflow/react'
import type { PlotCanvasColorKey, PlotCanvasEdgeKind } from '../../../shared/plot-canvas'

/**
 * 剧情画布支持的 10 种节点类别：
 * 1. plot: 剧情事件（主线/支线事件）
 * 2. idea: 灵感（突发构思/闪念）
 * 3. foreshadow: 伏笔（埋设/揭示暗线）
 * 4. character: 角色（人物出场/动机）
 * 5. location: 地点（地理/空间场景）
 * 6. item: 物品（关键道具/宝物）
 * 7. faction: 势力（组织/门派/阵营）
 * 8. skill: 功法（技能/秘术/异能）
 * 9. chapter: 章节（章节卡/规划引用）
 * 10. note: 便签（备忘/作者说明）
 */
export type PlotNodeKind =
  | 'plot'
  | 'idea'
  | 'foreshadow'
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'skill'
  | 'chapter'
  | 'note'

export const ALL_PLOT_NODE_KINDS: readonly PlotNodeKind[] = [
  'plot',
  'idea',
  'foreshadow',
  'character',
  'location',
  'item',
  'faction',
  'skill',
  'chapter',
  'note',
] as const

/** 关联实体描述（用于角色/设定/世界观跳转，纯只读信息） */
export interface EntitySourceRef {
  type: 'character' | 'location' | 'item' | 'faction' | 'skill' | 'chapter' | 'world-entry' | string
  id: string | number
  name?: string
  extra?: string
}

/**
 * 剧情图节点数据接口（用于 React Flow Node.data）。
 * 既兼容现有 PlotEventCardNodeData 的全部字段，又扩展了 kind、tags、entityRef 等。
 */
export type PlotGraphNodeData = {
  /** 节点种类，缺省时默认为 'plot' */
  kind?: PlotNodeKind
  /** 标题 */
  title: string
  /** 摘要/详细说明（可选，空时不编造） */
  summary?: string
  /** 标签列表（可选） */
  tags?: string[]
  /** 语义颜色键，映射至主题调色板（default | accent | success | warning | danger） */
  colorKey?: PlotCanvasColorKey
  /** 关联章节列表（升序数字） */
  chapterRefs?: number[]
  /** 是否关联线索计划 */
  hasPlan?: boolean
  /** 关联的线索计划 ID */
  planId?: number | null
  /** 关联子画布名称（若有，显示进入按钮） */
  subCanvasTitle?: string | null
  /** 关联子画布 ID */
  subCanvasId?: string | null
  /** 关联实体来源（如关联角色、世界观词条等） */
  entityRef?: EntitySourceRef | null
  /** 搜索命中高亮标志 */
  searchHit?: boolean
  /** 搜索或筛选时的灰显/变淡标志 */
  dimmed?: boolean
  /** 筛选隐藏标志（true 时节点在画布不可见） */
  hidden?: boolean
  /** 节点交互回调 */
  onDelete?: (nodeId: string) => void
  onSplit?: (nodeId: string) => void
  onEnterSubCanvas?: (nodeId: string, subCanvasId?: string) => void
  onEdit?: (nodeId: string) => void
  onNavigateEntity?: (entity: EntitySourceRef) => void
  onOpenPlan?: (planId: number) => void
}

/** 符合 @xyflow/react 规范的节点类型 */
export type PlotGraphNode = Node<PlotGraphNodeData, 'plot-graph-card'>

/** 边数据（遵循无害连线显示规则） */
export interface PlotGraphEdgeData {
  id: string
  source: string
  target: string
  label?: string
  kind?: PlotCanvasEdgeKind
  dimmed?: boolean
  hidden?: boolean
}

export type PlotGraphEdge = Edge<{
  label?: string
  kind?: PlotCanvasEdgeKind
  dimmed?: boolean
  hidden?: boolean
}>

/** 筛选过滤状态 */
export interface PlotGraphFilterState {
  /** 搜索关键词（匹配 title、summary、tags） */
  searchQuery: string
  /** 选中的节点种类集合（若为空则默认显示全部） */
  selectedKinds: Set<PlotNodeKind>
}

/** 画布交互模式 */
export type CanvasInteractionMode = 'pan' | 'select'

/** 工具栏状态配置 */
export interface PlotGraphToolbarState {
  interactionMode: CanvasInteractionMode
  showGrid: boolean
  isCollapsed?: boolean
}
