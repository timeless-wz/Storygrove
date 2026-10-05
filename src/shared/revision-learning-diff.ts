import DiffMatchPatch from 'diff-match-patch'
import {
  REVISION_LEARNING_MAX_CHANGES,
  type RevisionLearningChange,
  type RevisionLearningChangeKind,
} from './revision-learning'

const MAX_EXACT_DIFF_CHARACTERS = 500_000
const MAX_EXACT_PARAGRAPHS = 30_000
const EXACT_DIFF_TIME_LIMIT_MS = 750

interface Paragraph {
  text: string
  start: number
  end: number
}

function paragraphsOf(text: string): Paragraph[] {
  if (!text) return []
  const paragraphs: Paragraph[] = []
  const separator = /\r?\n[ \t]*\r?\n+/gu
  let cursor = 0
  for (const match of text.matchAll(separator)) {
    const end = (match.index ?? 0) + match[0].length
    paragraphs.push({ text: text.slice(cursor, end), start: cursor, end })
    cursor = end
  }
  if (cursor < text.length) paragraphs.push({ text: text.slice(cursor), start: cursor, end: text.length })
  return paragraphs
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function classify(beforeText: string, afterText: string): RevisionLearningChangeKind {
  if (!beforeText) return 'added'
  if (!afterText) return 'removed'
  return 'replaced'
}

function coarseChange(beforeText: string, afterText: string): RevisionLearningChange[] {
  if (beforeText === afterText || (!beforeText && !afterText)) return []
  return [{
    id: `change-coarse-${stableHash(`${beforeText}\u0000${afterText}`)}`,
    kind: classify(beforeText, afterText),
    beforeStartParagraph: beforeText ? 1 : 0,
    afterStartParagraph: afterText ? 1 : 0,
    beforeEndParagraph: beforeText ? Math.max(1, paragraphsOf(beforeText).length) : 0,
    afterEndParagraph: afterText ? Math.max(1, paragraphsOf(afterText).length) : 0,
    beforeText,
    afterText,
    contextBefore: '',
    contextAfter: '',
    coarse: true,
    included: true,
    authorReason: '',
  }]
}

function exactEvidenceKey(change: Pick<RevisionLearningChange, 'beforeText' | 'afterText' | 'beforeStartParagraph' | 'afterStartParagraph'>): string {
  return JSON.stringify([change.beforeText, change.afterText, change.beforeStartParagraph, change.afterStartParagraph])
}

/**
 * Paragraph-level diff with a bounded DMP pass. If the input or runtime is too
 * expensive, return one explicitly coarse replacement rather than implying a
 * precise alignment.
 */
export function computeRevisionLearningDiff(
  beforeText: string,
  afterText: string,
  previous: readonly RevisionLearningChange[] = [],
): RevisionLearningChange[] {
  if (beforeText === afterText || (!beforeText && !afterText)) return []
  if (beforeText.length + afterText.length > MAX_EXACT_DIFF_CHARACTERS) return coarseChange(beforeText, afterText)

  const before = paragraphsOf(beforeText)
  const after = paragraphsOf(afterText)
  const unique = new Map<string, number>()
  for (const part of [...before, ...after]) {
    if (!unique.has(part.text)) unique.set(part.text, unique.size)
  }
  if (before.length + after.length > MAX_EXACT_PARAGRAPHS || unique.size > 0xD7FF) {
    return coarseChange(beforeText, afterText)
  }

  const encoded = (paragraphs: Paragraph[]) => paragraphs
    .map(part => String.fromCharCode(unique.get(part.text)!))
    .join('')
  const differ = new DiffMatchPatch()
  differ.Diff_Timeout = 0.7
  const startedAt = Date.now()
  const diffs = differ.diff_main(encoded(before), encoded(after), false)
  differ.diff_cleanupSemantic(diffs)
  if (Date.now() - startedAt > EXACT_DIFF_TIME_LIMIT_MS) return coarseChange(beforeText, afterText)

  const raw: RevisionLearningChange[] = []
  let beforeIndex = 0
  let afterIndex = 0
  let group: { beforeStart: number; afterStart: number; before: number[]; after: number[] } | null = null
  const flush = () => {
    if (!group) return
    const oldStart = group.before.length ? group.beforeStart : 0
    const newStart = group.after.length ? group.afterStart : 0
    const beforePart = group.before.map(index => before[index]!.text).join('')
    const afterPart = group.after.map(index => after[index]!.text).join('')
    const beforeEnd = group.before.length ? group.before[group.before.length - 1]! + 1 : 0
    const afterEnd = group.after.length ? group.after[group.after.length - 1]! + 1 : 0
    const priorParagraph = group.before.length ? before[group.before[0]! - 1]?.text ?? '' : ''
    const nextParagraph = group.after.length ? after[group.after[group.after.length - 1]! + 1]?.text ?? '' : ''
    raw.push({
      id: '',
      kind: classify(beforePart, afterPart),
      beforeStartParagraph: oldStart,
      afterStartParagraph: newStart,
      beforeEndParagraph: beforeEnd,
      afterEndParagraph: afterEnd,
      beforeText: beforePart,
      afterText: afterPart,
      contextBefore: priorParagraph,
      contextAfter: nextParagraph,
      coarse: false,
      included: true,
      authorReason: '',
    })
    group = null
  }

  for (const [operation, value] of diffs) {
    if (operation === DiffMatchPatch.DIFF_EQUAL) {
      flush()
      beforeIndex += value.length
      afterIndex += value.length
      continue
    }
    group ??= { beforeStart: beforeIndex + 1, afterStart: afterIndex + 1, before: [], after: [] }
    if (operation === DiffMatchPatch.DIFF_DELETE) {
      for (let offset = 0; offset < value.length; offset++) group.before.push(beforeIndex++)
    } else if (operation === DiffMatchPatch.DIFF_INSERT) {
      for (let offset = 0; offset < value.length; offset++) group.after.push(afterIndex++)
    }
  }
  flush()
  if (raw.length > REVISION_LEARNING_MAX_CHANGES) return coarseChange(beforeText, afterText)

  const previousCounts = new Map<string, number>()
  const previousByKey = new Map<string, RevisionLearningChange>()
  for (const change of previous) {
    const key = exactEvidenceKey(change)
    previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1)
    previousByKey.set(key, change)
  }
  const nextCounts = new Map<string, number>()
  for (const change of raw) {
    const key = exactEvidenceKey(change)
    nextCounts.set(key, (nextCounts.get(key) ?? 0) + 1)
  }

  return raw.map(change => {
    const key = exactEvidenceKey(change)
    const previousMatch = previousByKey.get(key)
    const canRetain = previousMatch
      && previousCounts.get(key) === 1
      && nextCounts.get(key) === 1
      && previousMatch.beforeText === change.beforeText
      && previousMatch.afterText === change.afterText
    const id = `change-${stableHash(key)}`
    return {
      ...change,
      id,
      ...(canRetain ? { included: previousMatch.included, authorReason: previousMatch.authorReason } : {}),
    }
  })
}
