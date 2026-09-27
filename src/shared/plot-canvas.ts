/**
 * 剧情画布（跨章节剧情组织）共享契约。
 *
 * 与 PlotTreeSnapshot 的关系必须分清：
 * - `plot-tree.ts` 的 tracks/events/sources 是从蓝图、定稿与叙事线索确定性
 *   投影出来的**只读事实**，作者不可编辑；
 * - 本文件的画布 / 节点 / 连线是作者的**自由编排数据**，可拖拽、连线、拆合，
 *   独立持久化在独立的表里，绝不写回 plot_tree_snapshot，也不借用
 *   db:plot-tree-save 通道。
 *
 * 画布节点到权威资料的引用（章节号、叙事计划 ID）是**链接而不是拷贝**：
 * 删除画布节点绝不影响蓝图、定稿或计划本身；被引用对象消失时画布侧显示
 * “引用失效”状态，由作者自行处理。
 */

import { isCanvasIdWithPrefix, randomCanvasUuid } from './canvas-ids'
import { MAX_PLOT_TREE_CHAPTER_NUMBER } from './plot-tree'

export const PLOT_CANVAS_ID_PREFIX = 'pca'
export const PLOT_CANVAS_NODE_ID_PREFIX = 'pcn'
export const PLOT_CANVAS_EDGE_ID_PREFIX = 'pce'

export function createPlotCanvasId(): string {
  return `${PLOT_CANVAS_ID_PREFIX}-${randomCanvasUuid()}`
}
export function createPlotCanvasNodeId(): string {
  return `${PLOT_CANVAS_NODE_ID_PREFIX}-${randomCanvasUuid()}`
}
export function createPlotCanvasEdgeId(): string {
  return `${PLOT_CANVAS_EDGE_ID_PREFIX}-${randomCanvasUuid()}`
}

/**
 * 节点颜色只用语义键，渲染层映射到主题变量；绝不存原始色值，
 * 否则 18 套主题与 starlight 深浅外壳下会出现对比度事故。
 */
export type PlotCanvasColorKey = 'default' | 'accent' | 'success' | 'warning' | 'danger'

/** 连线种类：主线（实线）与次要（虚线），对应参考项目的主/次关系连线。 */
export type PlotCanvasEdgeKind = 'main' | 'aux'

export interface PlotCanvasSummary {
  id: string
  name: string
  /** 子画布归属；null 表示顶层画布。层级树不允许成环。 */
  parentCanvasId: string | null
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

export interface PlotCanvasNodeData {
  id: string
  canvasId: string
  title: string
  summary: string
  colorKey: PlotCanvasColorKey
  /** 关联章节号（蓝图 / 定稿共用章节号命名空间），升序去重。 */
  chapterRefs: number[]
  /** 关联的叙事线索计划 ID（稳定 ID，不是标题匹配）；null 表示未关联。 */
  planId: number | null
  /**
   * 关联子画布（对应参考项目节点上的 linkedBoardId）；null 表示没有。
   * 渲染层据此显示“进入子画布”角标；子画布被删除时由仓库清空回写。
   */
  subCanvasId: string | null
  x: number
  y: number
  createdAt?: string
  updatedAt?: string
}

export interface PlotCanvasEdgeData {
  id: string
  canvasId: string
  sourceNodeId: string
  targetNodeId: string
  label: string
  kind: PlotCanvasEdgeKind
  createdAt?: string
  updatedAt?: string
}

export interface PlotCanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface PlotCanvasGraph {
  canvas: PlotCanvasSummary
  /** 上次保存的视口；没有保存过时为 null（渲染层再走适应视图）。 */
  viewport: PlotCanvasViewport | null
  nodes: PlotCanvasNodeData[]
  edges: PlotCanvasEdgeData[]
}

/** IPC 载荷：新建或整体更新一个剧情事件节点。 */
export interface PlotCanvasNodeUpsertPayload {
  id?: string
  canvasId: string
  title: string
  summary: string
  colorKey?: PlotCanvasColorKey
  chapterRefs?: number[]
  planId?: number | null
  subCanvasId?: string | null
  x: number
  y: number
}

/** IPC 载荷：新建或更新一条剧情连线（端点不可变更）。 */
export interface PlotCanvasEdgeUpsertPayload {
  id?: string
  canvasId: string
  sourceNodeId: string
  targetNodeId: string
  label: string
  kind?: PlotCanvasEdgeKind
}

/** IPC 载荷：把多个剧情事件合并为一个新事件（事务）。 */
export interface PlotCanvasNodesMergePayload {
  canvasId: string
  sourceNodeIds: string[]
  title: string
  summary: string
  colorKey?: PlotCanvasColorKey
}

export const MAX_PLOT_CANVAS_NAME_LENGTH = 120
export const MAX_PLOT_CANVAS_TITLE_LENGTH = 200
export const MAX_PLOT_CANVAS_SUMMARY_LENGTH = 4000
export const MAX_PLOT_CANVAS_EDGE_LABEL_LENGTH = 100
export const MAX_PLOT_CANVAS_NODES = 500
export const MAX_PLOT_CANVAS_CHAPTER_REFS = 64

export function isPlotCanvasColorKey(value: unknown): value is PlotCanvasColorKey {
  return typeof value === 'string'
    && ['default', 'accent', 'success', 'warning', 'danger'].includes(value)
}

export function isPlotCanvasEdgeKind(value: unknown): value is PlotCanvasEdgeKind {
  return typeof value === 'string' && ['main', 'aux'].includes(value)
}

export function isValidPlotCanvasChapterRef(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 1
    && (value as number) <= MAX_PLOT_TREE_CHAPTER_NUMBER
}

/** 归一化章节引用：非法值整体拒绝（而不是静默丢弃），保证持久化前可见。 */
export function normalizePlotCanvasChapterRefs(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLOT_CANVAS_CHAPTER_REFS) return null
  const seen = new Set<number>()
  for (const item of value) {
    if (!isValidPlotCanvasChapterRef(item) || seen.has(item)) return null
    seen.add(item)
  }
  return [...seen].sort((left, right) => left - right)
}

export function createPlotCanvasViewport(x = 0, y = 0, zoom = 1): PlotCanvasViewport {
  return { x, y, zoom }
}

/** 画布视口必须可解析且缩放在 React Flow 的合法区间内，否则回退默认值。 */
export function parsePlotCanvasViewport(value: unknown): PlotCanvasViewport | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const { x, y, zoom } = record
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null
  if ((zoom as number) < 0.05 || (zoom as number) > 4) return null
  return { x: x as number, y: y as number, zoom: zoom as number }
}

interface ParsedText {
  title: string
  summary: string
}

/**
 * 共享的节点文本校验：标题必填（画布上必须可见），摘要可选。
 * 抛出的错误消息面向主进程返回值，同时被渲染层用于表单提示。
 */
export function parsePlotCanvasNodeText(input: {
  title: unknown
  summary: unknown
  titleLimit?: number
  summaryLimit?: number
}): ParsedText {
  const titleLimit = input.titleLimit ?? MAX_PLOT_CANVAS_TITLE_LENGTH
  const summaryLimit = input.summaryLimit ?? MAX_PLOT_CANVAS_SUMMARY_LENGTH
  if (typeof input.title !== 'string' || !input.title.trim()) {
    throw new Error('剧情事件标题不能为空')
  }
  const title = input.title.trim()
  if (title.length > titleLimit) throw new Error(`剧情事件标题超出 ${titleLimit} 字上限`)
  if (typeof input.summary !== 'string') throw new Error('剧情事件摘要无效')
  const summary = input.summary.trim()
  if (summary.length > summaryLimit) throw new Error(`剧情事件摘要超出 ${summaryLimit} 字上限`)
  return { title, summary }
}

export function parsePlotCanvasPosition(value: unknown): { x: number; y: number } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return null
  return { x: record.x as number, y: record.y as number }
}

/** 供存储层把任意 JSON 行还原成强类型节点；坏行抛错并被上层隔离报告。 */
export function parsePlotCanvasNodeRow(value: unknown): PlotCanvasNodeData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('剧情画布节点无效')
  }
  const record = value as Record<string, unknown>
  if (!isCanvasIdWithPrefix(PLOT_CANVAS_NODE_ID_PREFIX, record.id)) {
    throw new Error('剧情画布节点 ID 无效')
  }
  if (typeof record.canvasId !== 'string' || !record.canvasId) {
    throw new Error('剧情画布节点归属无效')
  }
  const text = parsePlotCanvasNodeText({ title: record.title, summary: record.summary })
  const colorKey = record.colorKey === undefined || record.colorKey === null
    ? 'default'
    : record.colorKey
  if (!isPlotCanvasColorKey(colorKey)) throw new Error('剧情画布节点颜色无效')
  const chapterRefs = normalizePlotCanvasChapterRefs(record.chapterRefs ?? [])
  if (!chapterRefs) throw new Error('剧情画布节点章节引用无效')
  let planId: number | null = null
  if (record.planId !== undefined && record.planId !== null) {
    if (!Number.isSafeInteger(record.planId) || (record.planId as number) < 1) {
      throw new Error('剧情画布节点计划引用无效')
    }
    planId = record.planId as number
  }
  const position = parsePlotCanvasPosition({ x: record.x, y: record.y })
  if (!position) throw new Error('剧情画布节点坐标无效')
  const subCanvasId = record.subCanvasId === undefined || record.subCanvasId === null
    ? null
    : record.subCanvasId
  if (subCanvasId !== null && !isCanvasIdWithPrefix(PLOT_CANVAS_ID_PREFIX, subCanvasId)) {
    throw new Error('剧情画布节点子画布引用无效')
  }
  return {
    id: record.id,
    canvasId: record.canvasId,
    title: text.title,
    summary: text.summary,
    colorKey,
    chapterRefs,
    planId,
    subCanvasId,
    x: position.x,
    y: position.y,
    ...(record.createdAt === undefined ? {} : { createdAt: String(record.createdAt) }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: String(record.updatedAt) }),
  }
}

export function parsePlotCanvasEdgeRow(value: unknown): PlotCanvasEdgeData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('剧情画布连线无效')
  }
  const record = value as Record<string, unknown>
  if (!isCanvasIdWithPrefix(PLOT_CANVAS_EDGE_ID_PREFIX, record.id)) {
    throw new Error('剧情画布连线 ID 无效')
  }
  if (typeof record.canvasId !== 'string' || !record.canvasId) {
    throw new Error('剧情画布连线归属无效')
  }
  if (typeof record.sourceNodeId !== 'string' || typeof record.targetNodeId !== 'string'
    || !record.sourceNodeId || !record.targetNodeId) {
    throw new Error('剧情画布连线端点无效')
  }
  if (record.sourceNodeId === record.targetNodeId) throw new Error('剧情画布连线不能连接自身')
  if (typeof record.label !== 'string' || record.label.length > MAX_PLOT_CANVAS_EDGE_LABEL_LENGTH) {
    throw new Error('剧情画布连线标签无效')
  }
  const kind = record.kind === undefined || record.kind === null ? 'main' : record.kind
  if (!isPlotCanvasEdgeKind(kind)) throw new Error('剧情画布连线种类无效')
  return {
    id: record.id,
    canvasId: record.canvasId,
    sourceNodeId: record.sourceNodeId,
    targetNodeId: record.targetNodeId,
    label: record.label,
    kind,
    ...(record.createdAt === undefined ? {} : { createdAt: String(record.createdAt) }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: String(record.updatedAt) }),
  }
}

export function parsePlotCanvasSummaryRow(value: unknown): PlotCanvasSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('剧情画布无效')
  }
  const record = value as Record<string, unknown>
  if (!isCanvasIdWithPrefix(PLOT_CANVAS_ID_PREFIX, record.id)) throw new Error('剧情画布 ID 无效')
  if (typeof record.name !== 'string' || !record.name.trim()) throw new Error('剧情画布名称不能为空')
  if (record.name.trim().length > MAX_PLOT_CANVAS_NAME_LENGTH) {
    throw new Error(`剧情画布名称超出 ${MAX_PLOT_CANVAS_NAME_LENGTH} 字上限`)
  }
  const parentCanvasId = record.parentCanvasId === undefined || record.parentCanvasId === null
    ? null
    : record.parentCanvasId
  if (parentCanvasId !== null && !isCanvasIdWithPrefix(PLOT_CANVAS_ID_PREFIX, parentCanvasId)) {
    throw new Error('剧情画布父画布无效')
  }
  if (!Number.isFinite(record.sortOrder)) throw new Error('剧情画布排序无效')
  return {
    id: record.id,
    name: record.name.trim(),
    parentCanvasId,
    sortOrder: record.sortOrder as number,
    ...(record.createdAt === undefined ? {} : { createdAt: String(record.createdAt) }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: String(record.updatedAt) }),
  }
}
