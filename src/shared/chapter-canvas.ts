/**
 * 章节画布（章内场景编排）共享契约。
 *
 * 每一章至多一张画布，画布 ID 由章节号确定性推导（`cha-<n>`），因此章节
 * 删除时可以精确清理画布数据；章节号是项目已有的稳定标识。
 *
 * 引用权威资料的红线：
 * - 角色节点引用角色名单（roster）的**名称**（roster 本身以名称为临时稳定
 *   标识）；名单改名或删除后，画布节点显示“引用失效”，绝不反向改写名单。
 * - 伏笔节点引用伏笔记录 ID；伏笔被删除后同样只显示失效状态。
 * - 场景卡是编排单元，不持有正文；正文权威仍在草稿/定稿。
 */

import { isCanvasIdWithPrefix, randomCanvasUuid } from './canvas-ids'
import { parsePlotCanvasNodeText, parsePlotCanvasPosition } from './plot-canvas'

export const CHAPTER_CANVAS_ID_PREFIX = 'cha'
export const CHAPTER_CANVAS_NODE_ID_PREFIX = 'ccn'
export const CHAPTER_CANVAS_EDGE_ID_PREFIX = 'cce'

export function chapterCanvasId(chapterNumber: number): string {
  return `${CHAPTER_CANVAS_ID_PREFIX}-${chapterNumber}`
}
export function createChapterCanvasNodeId(): string {
  return `${CHAPTER_CANVAS_NODE_ID_PREFIX}-${randomCanvasUuid()}`
}
export function createChapterCanvasEdgeId(): string {
  return `${CHAPTER_CANVAS_EDGE_ID_PREFIX}-${randomCanvasUuid()}`
}

export type ChapterCanvasNodeType = 'scene' | 'character' | 'foreshadow' | 'idea' | 'snippet'

/** 连线种类：主线推进（实线）与辅助关系（虚线）。 */
export type ChapterCanvasEdgeKind = 'main' | 'aux'

/** 场景颜色沿用节点语义键；辅助节点固定用类型色，不单独存颜色。 */
export type ChapterCanvasColorKey = 'default' | 'accent' | 'success' | 'warning' | 'danger'

export interface ChapterCanvasNodeRefs {
  /** 角色节点：角色名单中的名称（roster 的临时稳定标识）。 */
  characterName?: string
  /** 伏笔节点：伏笔记录 ID。 */
  foreshadowingId?: string
  /**
   * 蓝图 v2 分镜 ID（bps-…，≤80 字符不透明串；blueprint-v2-contract §8.1）。
   * 悬空（分镜已删除）时画布只显示「引用失效」，绝不自动清除或反向改写蓝图。
   */
  sceneId?: string
}

export interface ChapterCanvasMeta {
  id: string
  chapterNumber: number
  viewport: { x: number; y: number; zoom: number } | null
  createdAt?: string
  updatedAt?: string
}

export interface ChapterCanvasNodeData {
  id: string
  canvasId: string
  type: ChapterCanvasNodeType
  title: string
  summary: string
  colorKey: ChapterCanvasColorKey
  /** 场景卡角色定位，沿用章节蓝图的 ROLES 词表；辅助节点为空串。 */
  role: string
  /** 场景主线顺序（1 起）；辅助节点为 null。顺序与连线相互独立。 */
  order: number | null
  refs: ChapterCanvasNodeRefs
  x: number
  y: number
  createdAt?: string
  updatedAt?: string
}

export interface ChapterCanvasEdgeData {
  id: string
  canvasId: string
  sourceNodeId: string
  targetNodeId: string
  label: string
  kind: ChapterCanvasEdgeKind
  createdAt?: string
  updatedAt?: string
}

export interface ChapterCanvasGraph {
  canvas: ChapterCanvasMeta
  nodes: ChapterCanvasNodeData[]
  edges: ChapterCanvasEdgeData[]
}

/** IPC 载荷：新建或整体更新一个章节画布节点。 */
export interface ChapterCanvasNodeUpsertPayload {
  id?: string
  chapterNumber: number
  type: ChapterCanvasNodeType
  title: string
  summary: string
  colorKey?: ChapterCanvasColorKey
  role?: string
  order?: number | null
  refs?: ChapterCanvasNodeRefs
  x: number
  y: number
}

/** IPC 载荷：新建或更新一条章节画布连线（端点不可变更）。 */
export interface ChapterCanvasEdgeUpsertPayload {
  id?: string
  chapterNumber: number
  sourceNodeId: string
  targetNodeId: string
  label: string
  kind?: ChapterCanvasEdgeKind
}

export const MAX_CHAPTER_CANVAS_TITLE_LENGTH = 160
export const MAX_CHAPTER_CANVAS_SUMMARY_LENGTH = 2000
export const MAX_CHAPTER_CANVAS_EDGE_LABEL_LENGTH = 60
export const MAX_CHAPTER_CANVAS_NODES = 200
/** 章节蓝图已有的场景定位词表（与 ChapterCardEditor 的 ROLES 一致）。 */
export const CHAPTER_CANVAS_SCENE_ROLES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾'] as const

export const CHAPTER_CANVAS_NODE_TYPE_LABELS: Record<ChapterCanvasNodeType, { zh: string; en: string }> = {
  scene: { zh: '场景', en: 'Scene' },
  character: { zh: '角色', en: 'Character' },
  foreshadow: { zh: '伏笔', en: 'Foreshadowing' },
  idea: { zh: '灵感', en: 'Idea' },
  snippet: { zh: '片段', en: 'Snippet' },
}

export function isChapterCanvasNodeType(value: unknown): value is ChapterCanvasNodeType {
  return typeof value === 'string'
    && ['scene', 'character', 'foreshadow', 'idea', 'snippet'].includes(value)
}

export function isChapterCanvasEdgeKind(value: unknown): value is ChapterCanvasEdgeKind {
  return typeof value === 'string' && ['main', 'aux'].includes(value)
}

export function isChapterCanvasSceneRole(value: unknown): value is string {
  return typeof value === 'string'
    && (value === '' || (CHAPTER_CANVAS_SCENE_ROLES as readonly string[]).includes(value))
}

export function parseChapterCanvasNodeRefs(value: unknown): ChapterCanvasNodeRefs {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('章节画布节点引用无效')
  const record = value as Record<string, unknown>
  const refs: ChapterCanvasNodeRefs = {}
  if (record.characterName !== undefined && record.characterName !== null) {
    if (typeof record.characterName !== 'string' || record.characterName.length > 80) {
      throw new Error('章节画布角色引用无效')
    }
    if (record.characterName) refs.characterName = record.characterName
  }
  if (record.foreshadowingId !== undefined && record.foreshadowingId !== null) {
    if (typeof record.foreshadowingId !== 'string' || record.foreshadowingId.length > 80) {
      throw new Error('章节画布伏笔引用无效')
    }
    if (record.foreshadowingId) refs.foreshadowingId = record.foreshadowingId
  }
  // 蓝图 v2 分镜引用（契约 §8.1）：≤80 字符的不透明串；缺失/为空等价于未绑定。
  // 显式解析该字段，绝不依赖「未知 refs 字段被静默丢弃」的行为（契约缺口 §13.3）。
  if (record.sceneId !== undefined && record.sceneId !== null) {
    if (typeof record.sceneId !== 'string' || record.sceneId.length === 0 || record.sceneId.length > 80) {
      throw new Error('章节画布分镜引用无效')
    }
    refs.sceneId = record.sceneId
  }
  return refs
}

export function parseChapterCanvasNodeRow(value: unknown): ChapterCanvasNodeData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('章节画布节点无效')
  }
  const record = value as Record<string, unknown>
  if (!isCanvasIdWithPrefix(CHAPTER_CANVAS_NODE_ID_PREFIX, record.id)) {
    throw new Error('章节画布节点 ID 无效')
  }
  if (typeof record.canvasId !== 'string' || !record.canvasId) {
    throw new Error('章节画布节点归属无效')
  }
  if (!isChapterCanvasNodeType(record.type)) throw new Error('章节画布节点类型无效')
  const text = parsePlotCanvasNodeText({
    title: record.title,
    summary: record.summary,
    titleLimit: MAX_CHAPTER_CANVAS_TITLE_LENGTH,
    summaryLimit: MAX_CHAPTER_CANVAS_SUMMARY_LENGTH,
  })
  const colorKey = record.colorKey === undefined || record.colorKey === null
    ? 'default'
    : record.colorKey
  if (typeof colorKey !== 'string'
    || !['default', 'accent', 'success', 'warning', 'danger'].includes(colorKey)) {
    throw new Error('章节画布节点颜色无效')
  }
  if (!isChapterCanvasSceneRole(record.role)) throw new Error('章节画布场景定位无效')
  let order: number | null = null
  if (record.order !== undefined && record.order !== null) {
    if (!Number.isSafeInteger(record.order) || (record.order as number) < 1) {
      throw new Error('章节画布场景顺序无效')
    }
    order = record.order as number
  }
  const refs = parseChapterCanvasNodeRefs(record.refs)
  const position = parsePlotCanvasPosition({ x: record.x, y: record.y })
  if (!position) throw new Error('章节画布节点坐标无效')
  return {
    id: record.id,
    canvasId: record.canvasId,
    type: record.type,
    title: text.title,
    summary: text.summary,
    colorKey: colorKey as ChapterCanvasColorKey,
    role: record.role as string,
    order,
    refs,
    x: position.x,
    y: position.y,
    ...(record.createdAt === undefined ? {} : { createdAt: String(record.createdAt) }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: String(record.updatedAt) }),
  }
}

export function parseChapterCanvasEdgeRow(value: unknown): ChapterCanvasEdgeData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('章节画布连线无效')
  }
  const record = value as Record<string, unknown>
  if (!isCanvasIdWithPrefix(CHAPTER_CANVAS_EDGE_ID_PREFIX, record.id)) {
    throw new Error('章节画布连线 ID 无效')
  }
  if (typeof record.canvasId !== 'string' || !record.canvasId) {
    throw new Error('章节画布连线归属无效')
  }
  if (typeof record.sourceNodeId !== 'string' || typeof record.targetNodeId !== 'string'
    || !record.sourceNodeId || !record.targetNodeId) {
    throw new Error('章节画布连线端点无效')
  }
  if (record.sourceNodeId === record.targetNodeId) throw new Error('章节画布连线不能连接自身')
  if (typeof record.label !== 'string' || record.label.length > MAX_CHAPTER_CANVAS_EDGE_LABEL_LENGTH) {
    throw new Error('章节画布连线标签无效')
  }
  const kind = record.kind === undefined || record.kind === null ? 'main' : record.kind
  if (!isChapterCanvasEdgeKind(kind)) throw new Error('章节画布连线种类无效')
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

export function parseChapterCanvasMetaRow(value: unknown): ChapterCanvasMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('章节画布无效')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) throw new Error('章节画布 ID 无效')
  if (!Number.isSafeInteger(record.chapterNumber) || (record.chapterNumber as number) < 1) {
    throw new Error('章节画布章节号无效')
  }
  let viewport: ChapterCanvasMeta['viewport'] = null
  if (record.viewport !== undefined && record.viewport !== null) {
    if (typeof record.viewport !== 'object' || Array.isArray(record.viewport)) {
      throw new Error('章节画布视口无效')
    }
    const vp = record.viewport as Record<string, unknown>
    if (!Number.isFinite(vp.x) || !Number.isFinite(vp.y) || !Number.isFinite(vp.zoom)) {
      throw new Error('章节画布视口无效')
    }
    viewport = { x: vp.x as number, y: vp.y as number, zoom: vp.zoom as number }
  }
  return {
    id: record.id,
    chapterNumber: record.chapterNumber as number,
    viewport,
    ...(record.createdAt === undefined ? {} : { createdAt: String(record.createdAt) }),
    ...(record.updatedAt === undefined ? {} : { updatedAt: String(record.updatedAt) }),
  }
}
