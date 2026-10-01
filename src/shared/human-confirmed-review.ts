import { writingLanguageText, type WritingLanguage } from './writing-language'
import type { ExpectedDraftSource } from './ipc-channels'
import { parseChapterGoalReview, type ChapterGoalReview } from './chapter-goal-review'
import {
  parseBlueprintReviewEvidence,
  parseChapterBlueprintReview,
  type BlueprintReviewEvidence,
  type ChapterBlueprintReview,
} from './chapter-blueprint-review'
import type { BlueprintV2CheckMode } from './blueprint-v2'

/**
 * Immutable, user-confirmed review snapshot persisted in the existing
 * `reviews.content` JSON field. The source AI review remains a separate,
 * unchanged review record; `sourceReviewId` points back to it.
 */
export const HUMAN_CONFIRMED_REVIEW_KIND = 'human-confirmed-review' as const
export const HUMAN_CONFIRMED_REVIEW_SCHEMA_VERSION = 1 as const

export type HumanConfirmedReviewDecision = 'apply' | 'ignore'
export type HumanConfirmedReviewOrigin = 'ai' | 'author'

export interface HumanConfirmedReviewItem {
  category: string
  severity: string
  description: string
  quote?: string
  stableFactKey?: string
  sourceChapter?: number
  goalId?: string
  sceneId?: string
  checkId?: string
  checkMode?: BlueprintV2CheckMode
  decision: HumanConfirmedReviewDecision
  origin: HumanConfirmedReviewOrigin
}

export interface HumanConfirmedReviewSnapshot {
  kind: typeof HUMAN_CONFIRMED_REVIEW_KIND
  schemaVersion: typeof HUMAN_CONFIRMED_REVIEW_SCHEMA_VERSION
  /** The immutable original AI-review row; never the confirmation row itself. */
  sourceReviewId: number
  /** AI review generation source. Missing only on legacy confirmations, which must fail closed. */
  sourceDraft?: Readonly<ExpectedDraftSource>
  summary: string
  authorGuidance: string
  items: readonly HumanConfirmedReviewItem[]
  goalReview?: ChapterGoalReview
  blueprintEvidence?: BlueprintReviewEvidence
  blueprintReview?: ChapterBlueprintReview
}

export interface HumanConfirmedReviewSnapshotInput {
  sourceReviewId: number
  sourceDraft: Readonly<ExpectedDraftSource>
  summary: string
  authorGuidance: string
  items: readonly HumanConfirmedReviewItem[]
  goalReview?: ChapterGoalReview
  blueprintEvidence?: BlueprintReviewEvidence
  blueprintReview?: ChapterBlueprintReview
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function parseSourceDraft(value: unknown): Readonly<ExpectedDraftSource> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (
    !positiveSafeInteger(source.id)
    || !positiveSafeInteger(source.chapterNumber)
    || !positiveSafeInteger(source.version)
    || !['draft', 'revised', 'reviewed', 'finalized', 'archived'].includes(String(source.status))
    || typeof source.content !== 'string'
  ) return null
  return Object.freeze({
    id: source.id,
    chapterNumber: source.chapterNumber,
    version: source.version,
    status: source.status as ExpectedDraftSource['status'],
    content: source.content,
  })
}

function parseItem(value: unknown): HumanConfirmedReviewItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const category = nonEmptyString(record.category)
  const severity = nonEmptyString(record.severity)
  const description = nonEmptyString(record.description)
  const quote = record.quote === undefined ? undefined : stringValue(record.quote)
  const stableFactKey = record.stableFactKey === undefined ? undefined : nonEmptyString(record.stableFactKey)
  const sourceChapter = record.sourceChapter
  const goalId = record.goalId === undefined ? undefined : nonEmptyString(record.goalId)
  const sceneId = record.sceneId === undefined ? undefined : nonEmptyString(record.sceneId)
  const checkId = record.checkId === undefined ? undefined : nonEmptyString(record.checkId)
  const checkMode = record.checkMode
  const decision = record.decision
  const origin = record.origin

  if (
    !category
    || !severity
    || !description
    || (decision !== 'apply' && decision !== 'ignore')
    || (origin !== 'ai' && origin !== 'author')
  ) return null
  if (quote === null) return null
  if (stableFactKey === null) return null
  if (goalId === null) return null
  if (sceneId === null) return null
  if (checkId === null) return null
  if (checkMode !== undefined && checkMode !== 'must' && checkMode !== 'reference' && checkMode !== 'forbid') return null
  if (sourceChapter !== undefined && !positiveSafeInteger(sourceChapter)) return null

  return Object.freeze({
    category,
    severity,
    description,
    ...(quote === undefined ? {} : { quote }),
    ...(stableFactKey === undefined ? {} : { stableFactKey }),
    ...(sourceChapter === undefined ? {} : { sourceChapter }),
    ...(goalId === undefined ? {} : { goalId }),
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(checkId === undefined ? {} : { checkId }),
    ...(checkMode === undefined ? {} : { checkMode }),
    decision,
    origin,
  })
}

/**
 * Validates an in-memory candidate and returns a canonical frozen snapshot.
 * Invalid or historical review values return null instead of throwing.
 */
export function validateHumanConfirmedReviewSnapshot(
  value: unknown,
): HumanConfirmedReviewSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    record.kind !== HUMAN_CONFIRMED_REVIEW_KIND
    || record.schemaVersion !== HUMAN_CONFIRMED_REVIEW_SCHEMA_VERSION
    || !positiveSafeInteger(record.sourceReviewId)
    || !Array.isArray(record.items)
  ) return null

  const summary = stringValue(record.summary)
  const authorGuidance = stringValue(record.authorGuidance)
  if (summary === null || authorGuidance === null) return null
  const sourceDraft = record.sourceDraft === undefined ? undefined : parseSourceDraft(record.sourceDraft)
  if (sourceDraft === null) return null
  const goalReview = record.goalReview === undefined ? undefined : parseChapterGoalReview(record.goalReview)
  if (goalReview === null) return null
  const blueprintEvidence = record.blueprintEvidence === undefined
    ? undefined
    : parseBlueprintReviewEvidence(record.blueprintEvidence)
  if (blueprintEvidence === null) return null
  const blueprintReview = record.blueprintReview === undefined
    ? undefined
    : parseChapterBlueprintReview(record.blueprintReview)
  if (blueprintReview === null) return null
  if (blueprintEvidence && blueprintReview && (
    blueprintEvidence.chapterNumber !== blueprintReview.evidence.chapterNumber
    || blueprintEvidence.revision !== blueprintReview.evidence.revision
    || blueprintEvidence.contentHash !== blueprintReview.evidence.contentHash
  )) return null

  const items = record.items.map(parseItem)
  if (items.some(item => item === null)) return null

  return Object.freeze({
    kind: HUMAN_CONFIRMED_REVIEW_KIND,
    schemaVersion: HUMAN_CONFIRMED_REVIEW_SCHEMA_VERSION,
    sourceReviewId: record.sourceReviewId,
    ...(sourceDraft ? { sourceDraft } : {}),
    ...(goalReview ? { goalReview: Object.freeze({
      ...goalReview,
      items: Object.freeze(goalReview.items.map(item => Object.freeze({
        ...item,
        evidence: Object.freeze(item.evidence.map(evidence => Object.freeze({ ...evidence }))),
      }))),
    }) } : {}),
    ...(blueprintEvidence ? { blueprintEvidence: Object.freeze({ ...blueprintEvidence }) } : {}),
    ...(blueprintReview ? { blueprintReview: Object.freeze({
      evidence: Object.freeze({ ...blueprintReview.evidence }),
      scenes: Object.freeze(blueprintReview.scenes.map(scene => Object.freeze({
        ...scene,
        evidence: Object.freeze(scene.evidence.map(item => Object.freeze({ ...item }))),
        searchRange: Object.freeze({ ...scene.searchRange }),
      }))),
      checks: Object.freeze(blueprintReview.checks.map(check => Object.freeze({
        ...check,
        evidence: Object.freeze(check.evidence.map(item => Object.freeze({ ...item }))),
        searchRange: Object.freeze({ ...check.searchRange }),
      }))),
      chapterHook: Object.freeze({
        ...blueprintReview.chapterHook,
        evidence: Object.freeze(blueprintReview.chapterHook.evidence.map(item => Object.freeze({ ...item }))),
        searchRange: Object.freeze({ ...blueprintReview.chapterHook.searchRange }),
      }),
      blueprintIssues: Object.freeze([...blueprintReview.blueprintIssues]),
    }) } : {}),
    summary,
    authorGuidance,
    items: Object.freeze(items as HumanConfirmedReviewItem[]),
  })
}

/** Returns null for raw AI reports, malformed JSON, and unsupported schemas. */
export function parseHumanConfirmedReviewSnapshot(
  content: string,
): HumanConfirmedReviewSnapshot | null {
  try {
    return validateHumanConfirmedReviewSnapshot(JSON.parse(content) as unknown)
  } catch {
    return null
  }
}

/** Constructs a canonical snapshot that can be persisted without mutating its source AI review. */
export function createHumanConfirmedReviewSnapshot(
  input: HumanConfirmedReviewSnapshotInput,
): HumanConfirmedReviewSnapshot | null {
  return validateHumanConfirmedReviewSnapshot({
    kind: HUMAN_CONFIRMED_REVIEW_KIND,
    schemaVersion: HUMAN_CONFIRMED_REVIEW_SCHEMA_VERSION,
    ...input,
  })
}

export function serializeHumanConfirmedReviewSnapshot(
  snapshot: HumanConfirmedReviewSnapshot,
): string {
  return JSON.stringify(snapshot, null, 2)
}

/** True when the author explicitly selected at least one review item for repair. */
export function hasIncludedReviewItems(snapshot: HumanConfirmedReviewSnapshot): boolean {
  return snapshot.items.some(item => item.decision === 'apply')
}

/** Author guidance is also explicit confirmed work, even when no AI item is selected. */
export function hasIncludedReviewWork(snapshot: HumanConfirmedReviewSnapshot): boolean {
  return hasIncludedReviewItems(snapshot) || Boolean(snapshot.authorGuidance.trim())
}

/**
 * The only review material passed to the refiner: selected items and explicit
 * author guidance. It intentionally omits ignored items, the raw AI report,
 * and the AI-produced summary.
 */
export function renderHumanConfirmedReviewBrief(
  snapshot: HumanConfirmedReviewSnapshot,
  writingLanguage: WritingLanguage,
): string {
  const appliedItems = snapshot.items.filter(item => item.decision === 'apply')
  const sections: string[] = []
  const authorGuidance = snapshot.authorGuidance.trim()

  if (snapshot.blueprintEvidence && (appliedItems.length > 0 || authorGuidance)) {
    sections.push(writingLanguageText(
      writingLanguage,
      `【已确认审查依据】第 ${snapshot.blueprintEvidence.chapterNumber} 章蓝图 v2 r${snapshot.blueprintEvidence.revision}，内容哈希 ${snapshot.blueprintEvidence.contentHash}。纳入项仅针对这版蓝图与冻结源稿。`,
      `[Confirmed review basis] Chapter ${snapshot.blueprintEvidence.chapterNumber} blueprint v2 r${snapshot.blueprintEvidence.revision}, content hash ${snapshot.blueprintEvidence.contentHash}. Included items apply only to this blueprint version and frozen source draft.`,
    ))
  }

  if (appliedItems.some(item => item.severity === 'unknown')) {
    sections.push(writingLanguageText(
      writingLanguage,
      '【待核实项处理边界】作者纳入待核实项不等于确认其为错误。不得据此编造缺失前史或事实；仅按作者已有指导及正文证据处理，证据不足时保留不确定性。',
      '[Unverified item boundary] Including an unverified item does not confirm an error. Do not invent missing history or facts; follow existing author guidance and draft evidence, retaining uncertainty when evidence is insufficient.',
    ))
  }

  if (appliedItems.length > 0) {
    sections.push([
      writingLanguageText(
        writingLanguage,
        '【已确认纳入本次修稿的审稿项】',
        '[Confirmed review items included in this revision]',
      ),
      ...appliedItems.map((item, index) => {
        const quote = item.quote?.trim()
          ? writingLanguageText(
              writingLanguage,
              `\n  相关原文：${item.quote.trim()}`,
              `\n  Source excerpt: ${item.quote.trim()}`,
            )
          : ''
        const identity = item.sceneId
          ? ` [sceneId=${item.sceneId}]`
          : item.checkId
            ? ` [checkId=${item.checkId}${item.checkMode ? `; mode=${item.checkMode}` : ''}]`
            : ''
        return `${index + 1}. [${item.category} / ${item.severity}]${identity} ${item.description}${quote}`
      }),
    ].join('\n'))
  }

  if (authorGuidance) {
    sections.push(writingLanguageText(
      writingLanguage,
      `【作者补充修稿指导】\n${authorGuidance}`,
      `[Confirmed author guidance]\n${authorGuidance}`,
    ))
  }

  return sections.join('\n\n')
}
