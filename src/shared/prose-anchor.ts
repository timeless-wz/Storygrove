/**
 * 正文片段锚点 — 全项目唯一的正文定位类型（knowledge-action-outline-sync-contract §2）。
 *
 * 信息知情记录、人物行动线、未来的其他模块都以它引用"某条正文里的某个片段"，
 * 防止每个模块发明一套正文定位。锚点自带冻结时的版本与内容哈希：它只证明
 * 「曾经锚定在该版本」，重定位以 excerpt 为准，绝不悄悄替换成相似句。
 */

import { computeBlueprintV2TextHash } from './blueprint-v2'

export interface ProseAnchor {
  draftId: number
  /** 草稿版本号（drafts.version）；定稿后不变。 */
  version: number
  status: 'draft' | 'finalized'
  /** status='finalized' 时的定稿身份；未定稿缺省。 */
  finalizationId?: string
  /** 锚定时的正文 sha256；校验依据，非权威字段。 */
  contentHash: string
  /** 原文片段（建议 ≤600 字符），重定位依据。 */
  excerpt: string
  /** 锚定时偏移；仅提示用。 */
  startOffset?: number
  endOffset?: number
  sourceType?: 'draft' | 'manuscript'
}

export type ProseAnchorValidity = 'intact' | 'stale'

/** CRLF→LF 归一 + 空白压缩，容忍排版差异但不容忍改写。 */
function normalizeForMatch(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim()
}

/**
 * 校验锚点在当前正文中是否仍然有效。
 * - 'intact'：excerpt（空白归一后）仍在当前正文里；
 * - 'stale'：找不到 → UI 显示「需重新定位」，保留原引用。
 */
export function validateProseAnchor(anchor: ProseAnchor, currentContent: string): ProseAnchorValidity {
  const excerpt = normalizeForMatch(anchor.excerpt)
  if (!excerpt) return 'stale'
  return normalizeForMatch(currentContent).includes(excerpt) ? 'intact' : 'stale'
}

/** 对正文全文计算冻结哈希（与蓝图 v2 同一纯 TS sha256 实现）。 */
export function computeProseContentHash(content: string): string {
  return computeBlueprintV2TextHash(content)
}

// ===== 故事位置与叙事位置（契约 §2：两者独立，禁止用章号互相推断） =====

/**
 * 故事位置：信息生效/行动发生的剧情内时点。
 * 优先引用时间线事件；无法定位时 unplaced，绝不猜（不用录入时间或今天日期顶替故事时间）。
 */
export type StoryPosition =
  | { kind: 'timeline-event'; eventId: string }
  | { kind: 'manual'; sortOrder: number; label: string }   // 作者自定义顺序（小者在前）
  | { kind: 'unplaced' }

/**
 * 叙事位置：读者看到它的章节/分镜。
 * chapterNumber + 可选 v2 分镜 ID / 作者序；缺章时 unplaced。
 */
export type NarrativePosition =
  | { kind: 'chapter-scene'; chapterNumber: number; sceneId?: string; authorOrdinal?: number }
  | { kind: 'unplaced' }

export const UNPLACED_STORY_POSITION: StoryPosition = { kind: 'unplaced' }
export const UNPLACED_NARRATIVE_POSITION: NarrativePosition = { kind: 'unplaced' }

/** 比较故事位置与某个时间线事件的先后：-1 = 在此之前，0 = 同一事件，1 = 之后，null = 无法比较。 */
export function compareStoryPositionToEvent(
  position: StoryPosition,
  eventOrderById: Map<string, number>,
  targetEventId: string,
): -1 | 0 | 1 | null {
  const targetOrder = eventOrderById.get(targetEventId)
  if (targetOrder === undefined) return null
  if (position.kind === 'timeline-event') {
    const order = eventOrderById.get(position.eventId)
    if (order === undefined) return null
    if (order === targetOrder && position.eventId === targetEventId) return 0
    return order < targetOrder ? -1 : 1
  }
  if (position.kind === 'manual') return position.sortOrder <= targetOrder ? -1 : 1
  return null
}

const MAX_ANCHOR_EXCERPT = 600

/** 截取锚点片段：中点前后扩展，超限截断并保留省略语义（只在创建锚点时使用）。 */
export function buildProseAnchorExcerpt(content: string, startOffset: number, endOffset: number): string {
  const safeStart = Math.max(0, Math.min(startOffset, content.length))
  const safeEnd = Math.max(safeStart, Math.min(endOffset, content.length))
  const excerpt = content.slice(safeStart, safeEnd).trim()
  if (excerpt.length <= MAX_ANCHOR_EXCERPT) return excerpt
  return `${excerpt.slice(0, MAX_ANCHOR_EXCERPT)}…`
}
