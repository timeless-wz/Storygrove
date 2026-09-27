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

/**
 * 节点种类，对应参考页节点类型词表（剧情、灵感、伏笔、人物、地点、物品、
 * 势力、技能、章节、便签）。种类只决定展示与行为倾向，不改变存储形态；
 * 旧库节点统一回落 'plot'。
 */
export const PLOT_CANVAS_NODE_KINDS = [
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

export type PlotCanvasNodeKind = (typeof PLOT_CANVAS_NODE_KINDS)[number]

export function isPlotCanvasNodeKind(value: unknown): value is PlotCanvasNodeKind {
  return typeof value === 'string' && (PLOT_CANVAS_NODE_KINDS as readonly string[]).includes(value)
}

export const PLOT_CANVAS_NODE_KIND_LABELS: Record<PlotCanvasNodeKind, { zh: string; en: string }> = {
  plot: { zh: '剧情', en: 'Plot' },
  idea: { zh: '灵感', en: 'Idea' },
  foreshadow: { zh: '伏笔', en: 'Foreshadowing' },
  character: { zh: '人物', en: 'Character' },
  location: { zh: '地点', en: 'Location' },
  item: { zh: '物品', en: 'Item' },
  faction: { zh: '势力', en: 'Faction' },
  skill: { zh: '技能', en: 'Skill' },
  chapter: { zh: '章节', en: 'Chapter' },
  note: { zh: '便签', en: 'Note' },
}

/**
 * 节点可选的实体引用：只允许指向本项目**真实存在且带稳定 ID** 的实体。
 * 伏笔记录（foreshadowings.id，TEXT）、世界地图地点（world_map_nodes.id，
 * TEXT）、故事时间线事件（story_timeline_events.id，TEXT）与正文草稿
 * （drafts.id，INTEGER）都是权威来源；人物 / 物品 / 势力 / 技能没有稳定
 * ID 权威表，对应 kind 的节点保持普通本地卡片，不捏造关联记录。
 *
 * 引用是**链接而不是拷贝**：实体被删除后引用悬挂，画布侧显示“引用失效”，
 * 因此写入只做结构校验（类型合法 + ID 非空），读取原样返回悬挂引用，
 * 由渲染层负责失效展示。绝不因建引用而在其他表插入记录。
 */
export type PlotCanvasNodeEntityRef =
  | { entityType: 'foreshadowing'; entityId: string }
  | { entityType: 'world-map-node'; entityId: string }
  | { entityType: 'timeline-event'; entityId: string }
  | { entityType: 'draft'; entityId: number }

export const PLOT_CANVAS_ENTITY_REF_TYPES = [
  'foreshadowing',
  'world-map-node',
  'timeline-event',
  'draft',
] as const

export type PlotCanvasNodeEntityRefType = (typeof PLOT_CANVAS_ENTITY_REF_TYPES)[number]

export function isPlotCanvasNodeEntityRefType(value: unknown): value is PlotCanvasNodeEntityRefType {
  return typeof value === 'string' && (PLOT_CANVAS_ENTITY_REF_TYPES as readonly string[]).includes(value)
}

export interface PlotCanvasSummary {
  id: string
  name: string
  /** 画布说明（对应参考项目 board.summary）；旧库迁移后为空字符串。 */
  description: string
  /** 子画布归属；null 表示顶层画布。层级树不允许成环。 */
  parentCanvasId: string | null
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

export interface PlotCanvasNodeData {
  id: string
  canvasId: string
  /**
   * 节点种类。可选是为兼容既有渲染层调用方：缺省（含旧库旧行、旧调用方
   * 构造的节点）一律按 'plot' 解释；写入路径上显式提供的 kind 必须属于
   * PLOT_CANVAS_NODE_KINDS，非法值在仓储层被拒绝。读取统一走
   * resolvePlotCanvasNodeKind。
   */
  kind?: PlotCanvasNodeKind
  title: string
  summary: string
  colorKey: PlotCanvasColorKey
  /** 作者标签（保持作者输入顺序，去重）；缺省（旧数据）视为空数组。 */
  tags?: string[]
  /**
   * 可选实体引用（结构合法的链接）；缺省（旧数据）视为空数组。悬挂引用
   * 原样保留，由渲染层显示失效状态。
   */
  entityRefs?: PlotCanvasNodeEntityRef[]
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

/** 读取侧的 kind 解析：缺省（旧库旧行 / 旧调用方）回落 'plot'。 */
export function resolvePlotCanvasNodeKind(node: { kind?: PlotCanvasNodeKind } | null | undefined): PlotCanvasNodeKind {
  return node?.kind ?? 'plot'
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

/**
 * IPC 载荷：部分更新画布元数据（名称 / 说明）。省略的字段保持原值；
 * 名称更新与既有 db:plot-canvas-rename 的校验完全一致。
 */
export interface PlotCanvasUpdatePayload {
  canvasId: string
  name?: string
  description?: string
}

/** IPC 载荷：新建或整体更新一个剧情事件节点。 */
export interface PlotCanvasNodeUpsertPayload {
  id?: string
  canvasId: string
  /** 省略时新建回落 'plot'，更新保留原值（旧调用方不丢 kind）。 */
  kind?: PlotCanvasNodeKind
  title: string
  summary: string
  colorKey?: PlotCanvasColorKey
  /** 省略时新建为空数组，更新保留原值（旧调用方不丢标签）。 */
  tags?: string[]
  /** 省略时新建为空数组，更新保留原值（旧调用方不丢引用）。 */
  entityRefs?: PlotCanvasNodeEntityRef[]
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
  kind?: PlotCanvasNodeKind
  tags?: string[]
  entityRefs?: PlotCanvasNodeEntityRef[]
}

export const MAX_PLOT_CANVAS_NAME_LENGTH = 120
export const MAX_PLOT_CANVAS_DESCRIPTION_LENGTH = 2000
export const MAX_PLOT_CANVAS_TITLE_LENGTH = 200
export const MAX_PLOT_CANVAS_SUMMARY_LENGTH = 4000
export const MAX_PLOT_CANVAS_EDGE_LABEL_LENGTH = 100
export const MAX_PLOT_CANVAS_NODES = 500
export const MAX_PLOT_CANVAS_CHAPTER_REFS = 64
export const MAX_PLOT_CANVAS_NODE_TAGS = 32
export const MAX_PLOT_CANVAS_NODE_TAG_LENGTH = 40
export const MAX_PLOT_CANVAS_NODE_ENTITY_REFS = 32
export const MAX_PLOT_CANVAS_ENTITY_REF_ID_LENGTH = 120

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

/**
 * 归一化作者标签：修剪空白、丢弃空项并去重（保留首次出现顺序）。
 * 整体非法（非数组、超上限、单项超长）返回 null，由调用方拒绝写入。
 */
export function normalizePlotCanvasTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLOT_CANVAS_NODE_TAGS) return null
  const tags: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return null
    const tag = item.trim()
    if (!tag) continue
    if (tag.length > MAX_PLOT_CANVAS_NODE_TAG_LENGTH) return null
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

/**
 * 归一化实体引用：只做结构校验（类型白名单 + ID 非空 / 正整数）与去重，
 * 不要求实体当前存在——悬挂引用必须原样保留，渲染层显示失效状态。
 * 整体非法返回 null，由调用方拒绝写入。
 */
export function normalizePlotCanvasEntityRefs(value: unknown): PlotCanvasNodeEntityRef[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLOT_CANVAS_NODE_ENTITY_REFS) return null
  const refs: PlotCanvasNodeEntityRef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    const entityType = record.entityType
    if (!isPlotCanvasNodeEntityRefType(entityType)) return null
    let entityId: string | number
    if (entityType === 'draft') {
      if (!Number.isSafeInteger(record.entityId) || (record.entityId as number) < 1) return null
      entityId = record.entityId as number
    } else {
      if (typeof record.entityId !== 'string' || !record.entityId.trim()) return null
      entityId = record.entityId.trim()
      if (entityId.length > MAX_PLOT_CANVAS_ENTITY_REF_ID_LENGTH) return null
    }
    const key = `${entityType}::${entityId}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ entityType, entityId } as PlotCanvasNodeEntityRef)
  }
  return refs
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
  // kind / tags / entityRefs 是增量迁移字段：缺失时回落迁移默认值，
  // 保证旧库旧行原样可读。
  const kind = record.kind === undefined || record.kind === null
    ? 'plot'
    : record.kind
  if (!isPlotCanvasNodeKind(kind)) throw new Error('剧情画布节点种类无效')
  const tags = normalizePlotCanvasTags(record.tags ?? [])
  if (!tags) throw new Error('剧情画布节点标签无效')
  const entityRefs = normalizePlotCanvasEntityRefs(record.entityRefs ?? [])
  if (!entityRefs) throw new Error('剧情画布节点实体引用无效')
  return {
    id: record.id,
    canvasId: record.canvasId,
    kind,
    title: text.title,
    summary: text.summary,
    colorKey,
    tags,
    entityRefs,
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
  // description 是增量迁移字段：缺失回落空字符串，保证旧库旧行原样可读。
  if (record.description !== undefined && record.description !== null
    && typeof record.description !== 'string') {
    throw new Error('剧情画布说明无效')
  }
  const description = typeof record.description === 'string' ? record.description : ''
  if (description.length > MAX_PLOT_CANVAS_DESCRIPTION_LENGTH) {
    throw new Error(`剧情画布说明超出 ${MAX_PLOT_CANVAS_DESCRIPTION_LENGTH} 字上限`)
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
    description,
    parentCanvasId,
    sortOrder: record.sortOrder as number,
    ...(record.createdAt === undefined ? {} : { createdAt: String(record.createdAt) }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: String(record.updatedAt) }),
  }
}

/**
 * 归一化画布说明：修剪首尾空白；空串合法（清空说明）。
 * 超出上限返回 null，由调用方拒绝写入。
 */
export function normalizePlotCanvasDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const description = value.trim()
  if (description.length > MAX_PLOT_CANVAS_DESCRIPTION_LENGTH) return null
  return description
}
