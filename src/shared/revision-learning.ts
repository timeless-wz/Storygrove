import {
  inspectWritingSkillMarkdown,
  type WritingSkillLanguage,
} from './writing-skills'
import type { WritingLanguage } from './writing-language'

export const REVISION_LEARNING_SCHEMA_VERSION = 1
export const REVISION_LEARNING_PROMPT_VERSION = 'revision-learning-v1'
export const REVISION_LEARNING_MAX_TEXT_CHARS = 250_000
export const REVISION_LEARNING_MAX_CHANGES = 4_000
export const REVISION_LEARNING_MAX_REASON_CHARS = 2_000

export type RevisionLearningSourceKind = 'saved-draft' | 'editor-snapshot'
export type RevisionLearningChangeKind = 'added' | 'removed' | 'replaced'
export type RevisionLearningReasonSource = 'author_explicit' | 'model_inferred' | 'mixed'
export type RevisionLearningAttemptStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface RevisionLearningSnapshot {
  sourceKind: RevisionLearningSourceKind
  draftId: number
  logicalChapterIdentity: string
  chapterNumber: number
  displayNumber?: number
  title: string
  version: number
  status: string
  content: string
  contentHash: string
  capturedAt: string
  tabId?: string
  editGeneration?: number
}

export interface RevisionLearningChange {
  id: string
  kind: RevisionLearningChangeKind
  beforeStartParagraph: number
  afterStartParagraph: number
  beforeEndParagraph: number
  afterEndParagraph: number
  beforeText: string
  afterText: string
  contextBefore: string
  contextAfter: string
  coarse: boolean
  included: boolean
  authorReason: string
}

export interface RevisionLearningRule {
  id: string
  title: string
  guidance: string
  appliesWhen: string
  exceptions: string
  evidenceChangeIds: string[]
  reasonSource: RevisionLearningReasonSource
  limitations: string
}

export interface RevisionLearningResult {
  summary: string
  rules: RevisionLearningRule[]
  nonGeneralizableChanges: Array<{ changeIds: string[]; reason: string }>
  suggestedSkill: { displayName: string; description: string }
}

export interface RevisionLearningReviewRule extends RevisionLearningRule {
  selected: boolean
}

export interface RevisionLearningReviewDraft {
  resultAttemptId: string
  resultInputHash: string
  rules: RevisionLearningReviewRule[]
  skillDisplayName: string
  skillDescription: string
  skillDraftRevision: number
  skillContentHash: string | null
  confirmedAt: string | null
  confirmedWritingLanguage?: WritingLanguage | null
}

export interface RevisionLearningAttempt {
  id: string
  inputRevision: number
  inputHash: string
  promptVersion: string
  modelId: string | null
  status: RevisionLearningAttemptStatus
  errorSummary: string | null
  result: RevisionLearningResult | null
  generationReceipt: unknown | null
  createdAt: string
  completedAt: string | null
}

export interface RevisionLearningPublishReceipt {
  idempotencyKey: string
  skillId: string
  relativePath: string
  contentHash: string
  publishedAt: string
}

export interface RevisionLearningRecordSummary {
  id: string
  projectId: string
  schemaVersion: number
  revision: number
  inputRevision: number
  inputHash: string
  createdAt: string
  updatedAt: string
  beforeSnapshot: Omit<RevisionLearningSnapshot, 'content'>
  afterSnapshot: Omit<RevisionLearningSnapshot, 'content'> | null
  changeCount: number
  latestAttempt: Pick<RevisionLearningAttempt, 'id' | 'status' | 'createdAt' | 'completedAt'> | null
  publishCount: number
}

export interface RevisionLearningRecord extends RevisionLearningRecordSummary {
  beforeSnapshot: RevisionLearningSnapshot
  afterSnapshot: RevisionLearningSnapshot | null
  changes: RevisionLearningChange[]
  overallReason: string
  attempts: RevisionLearningAttempt[]
  review: RevisionLearningReviewDraft | null
  publishReceipts: RevisionLearningPublishReceipt[]
}

export interface RevisionLearningSourceDraft {
  id: number
  chapterNumber: number
  displayNumber?: number
  title: string
  version: number
  status: string
  updatedAt: string
}

export interface RevisionLearningEditorSnapshotInput {
  draftId: number
  tabId: string
  editGeneration: number
  content: string
}

export interface RevisionLearningAfterSnapshotInput extends RevisionLearningEditorSnapshotInput {
  recordId: string
  expectedRevision: number
}

export interface RevisionLearningCreateFromVersionsInput {
  beforeDraftId: number
  afterDraftId: number
}

export interface RevisionLearningSaveInput {
  recordId: string
  expectedRevision: number
  changes: ReadonlyArray<Pick<RevisionLearningChange, 'id' | 'included' | 'authorReason'>>
  overallReason: string
}

export interface RevisionLearningAttemptStartInput {
  recordId: string
  inputRevision: number
  inputHash: string
  modelId: string | null
}

export interface RevisionLearningAttemptFinishInput {
  recordId: string
  attemptId: string
  status: 'completed' | 'failed' | 'cancelled'
  result?: RevisionLearningResult
  generationReceipt?: unknown
  errorSummary?: string | null
}

export interface RevisionLearningReviewSaveInput {
  recordId: string
  expectedRevision: number
  resultAttemptId: string
  resultInputHash: string
  rules: readonly RevisionLearningReviewRule[]
  skillDisplayName: string
  skillDescription: string
}

export interface RevisionLearningReviewConfirmInput {
  recordId: string
  expectedRevision: number
  expectedContentHash: string
  writingLanguage: WritingLanguage
}

export interface RevisionLearningPublishInput {
  recordId: string
  expectedRevision: number
  expectedContentHash: string
}

export interface RevisionLearningBindInput {
  recordId: string
  skillId: string
  expectedCurrentSkillId: string | null
  mode: 'only-if-unbound' | 'replace'
}

export interface RevisionLearningBindingCasInput {
  stage: string
  skillId: string | null
  expectedCurrentSkillId: string | null
}

export interface RevisionLearningPublicationStatus {
  refinementSkillId: string | null
  skills: RevisionLearningFileStatus[]
}

export interface RevisionLearningFileStatus {
  skillId: string
  exists: boolean
  compatible: boolean
  contentHash: string | null
  matchesPublishedHash: boolean
  boundToRefinement: boolean
  actualRefinementSkillId: string | null
}

export interface RevisionLearningParsedResult {
  result: RevisionLearningResult
  error?: never
}

function boundedText(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new Error(`${label}无效或超过长度限制`)
  }
  return value.trim()
}

function stringArray(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}结构无效`)
  const result = value.map((item) => boundedText(item, label, 160))
  if (new Set(result).size !== result.length) throw new Error(`${label}存在重复项`)
  return result
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回完整 JSON；本次分析未保存')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的 JSON 无法解析；本次分析未保存')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型返回的数据结构无效；本次分析未保存')
  }
  return parsed as Record<string, unknown>
}

/** Parse and validate model-authored content against the frozen, included evidence. */
export function parseRevisionLearningResult(
  raw: string,
  changes: readonly RevisionLearningChange[],
  overallReason: string,
): RevisionLearningResult {
  const source = parseJsonObject(raw)
  const included = new Set(changes.filter(change => change.included).map(change => change.id))
  const allChangeIds = new Set(included)
  if (!Array.isArray(source.rules) || source.rules.length > 24) throw new Error('候选规则数量无效')
  if (!Array.isArray(source.nonGeneralizableChanges) || source.nonGeneralizableChanges.length > 40) {
    throw new Error('个例清单结构无效')
  }

  const authorReasonIds = new Set(changes
    .filter(change => change.included && change.authorReason.trim())
    .map(change => change.id))
  const hasExplicitOverallReason = overallReason.trim().length > 0
  const rules = source.rules.map((rawRule, index): RevisionLearningRule => {
    if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) throw new Error(`候选规则 ${index + 1} 无效`)
    const rule = rawRule as Record<string, unknown>
    const id = boundedText(rule.id, `候选规则 ${index + 1} ID`, 80)
    const evidenceChangeIds = stringArray(rule.evidenceChangeIds, '候选规则证据', 24)
    if (evidenceChangeIds.length === 0 || evidenceChangeIds.some(changeId => !included.has(changeId))) {
      throw new Error(`候选规则「${id}」引用了未纳入或不存在的证据`)
    }
    const reasonSource = rule.reasonSource
    if (!['author_explicit', 'model_inferred', 'mixed'].includes(String(reasonSource))) {
      throw new Error(`候选规则「${id}」的理由来源无效`)
    }
    const hasAuthorEvidence = hasExplicitOverallReason || evidenceChangeIds.some(changeId => authorReasonIds.has(changeId))
    if ((reasonSource === 'author_explicit' || reasonSource === 'mixed') && !hasAuthorEvidence) {
      throw new Error(`候选规则「${id}」声称有明确理由，但对应证据没有作者理由`)
    }
    return {
      id,
      title: boundedText(rule.title, `候选规则 ${index + 1} 标题`, 100),
      guidance: boundedText(rule.guidance, `候选规则 ${index + 1} 正文`, 2_500),
      appliesWhen: boundedText(rule.appliesWhen, `候选规则 ${index + 1} 适用场景`, 800, true),
      exceptions: boundedText(rule.exceptions, `候选规则 ${index + 1} 例外`, 1_000, true),
      evidenceChangeIds,
      reasonSource: reasonSource as RevisionLearningReasonSource,
      limitations: boundedText(rule.limitations, `候选规则 ${index + 1} 风险`, 1_000, true),
    }
  })
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('候选规则 ID 重复')

  const nonGeneralizableChanges = source.nonGeneralizableChanges.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error(`个例 ${index + 1} 无效`)
    const item = rawItem as Record<string, unknown>
    const changeIds = stringArray(item.changeIds, `个例 ${index + 1} 证据`, 80)
    if (changeIds.length === 0 || changeIds.some(changeId => !allChangeIds.has(changeId))) {
      throw new Error(`个例 ${index + 1} 引用了不存在的差异`)
    }
    return {
      changeIds,
      reason: boundedText(item.reason, `个例 ${index + 1} 说明`, 800),
    }
  })
  if (new Set(nonGeneralizableChanges.flatMap(item => item.changeIds)).size !== nonGeneralizableChanges.flatMap(item => item.changeIds).length) {
    throw new Error('个例清单重复引用了差异')
  }

  if (!source.suggestedSkill || typeof source.suggestedSkill !== 'object' || Array.isArray(source.suggestedSkill)) {
    throw new Error('建议技能元数据无效')
  }
  const suggestedSkill = source.suggestedSkill as Record<string, unknown>
  return {
    summary: boundedText(source.summary, '修改概览', 3_000),
    rules,
    nonGeneralizableChanges,
    suggestedSkill: {
      displayName: boundedText(suggestedSkill.displayName, '技能名称', 80),
      description: boundedText(suggestedSkill.description, '技能简介', 280),
    },
  }
}

export function createInitialRevisionLearningReview(
  result: RevisionLearningResult,
  attempt: Pick<RevisionLearningAttempt, 'id' | 'inputHash'>,
): RevisionLearningReviewDraft {
  return {
    resultAttemptId: attempt.id,
    resultInputHash: attempt.inputHash,
    rules: result.rules.map(rule => ({ ...rule, evidenceChangeIds: [...rule.evidenceChangeIds], selected: false })),
    skillDisplayName: result.suggestedSkill.displayName,
    skillDescription: result.suggestedSkill.description,
    skillDraftRevision: 1,
    skillContentHash: null,
    confirmedAt: null,
  }
}

function stripControlCharacters(value: string, replacement = ''): string {
  return Array.from(value, character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? replacement : character
  }).join('')
}

function metadataScalar(value: string, maxLength: number): string {
  return stripControlCharacters(value.normalize('NFC').replace(/[\r\n\t]+/g, ' '))
    .replace(/[`<>]/g, '')
    .trim()
    .slice(0, maxLength)
}

function markdownText(value: string, maxLength: number): string {
  return stripControlCharacters(value.normalize('NFC'))
    .trim()
    .slice(0, maxLength)
}

export function revisionLearningSkillName(recordId: string, revision: number): string {
  const safeId = recordId.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  if (safeId.length < 12 || !Number.isSafeInteger(revision) || revision < 1) throw new Error('修订学习技能身份无效')
  return `revision-${safeId.slice(0, 24)}-r${revision.toString(36)}`
}

/** Deterministically build a prompt-only, self-contained project skill from author-edited rules. */
export function buildRevisionLearningSkillMarkdown(
  recordId: string,
  review: RevisionLearningReviewDraft,
  writingLanguage: WritingLanguage,
): string {
  const selected = review.rules.filter(rule => rule.selected)
  if (selected.length === 0) throw new Error('请至少选择一条候选规则')
  if (selected.length > 24) throw new Error('选中的候选规则过多')
  const name = revisionLearningSkillName(recordId, review.skillDraftRevision)
  const displayName = metadataScalar(review.skillDisplayName, 80)
  const description = metadataScalar(review.skillDescription, 280)
  if (!displayName || !description) throw new Error('请填写技能名称和简介')
  const language: WritingSkillLanguage = writingLanguage === 'zh-CN' ? 'zh-CN' : 'en-US'
  const zh = writingLanguage === 'zh-CN'
  const lines = [
    '---',
    `name: ${name}`,
    `display_name: ${displayName}`,
    `description: ${description}`,
    'version: 1.0.0',
    `language: ${language}`,
    'stage: refinement',
    '---',
    '',
    `# ${displayName}`,
    '',
    description,
    '',
    zh ? '## 适用方式' : '## When to apply',
    zh
      ? '仅在项目作者要求修稿或定稿前润色时，将以下规则作为补充方法。作者事实、项目写作语言、当前修稿要求、已确认审稿范围和输出格式始终优先。'
      : 'Use these rules only as supplemental methods when the author requests revision or pre-final polish. Author facts, project language, the current revision request, confirmed review scope, and output format always take priority.',
    '',
    zh ? '## 修订规则' : '## Revision guidance',
  ]
  selected.forEach((rule, index) => {
    const title = markdownText(rule.title, 100).replace(/^#+\s*/, '')
    const guidance = markdownText(rule.guidance, 2_500)
    if (!title || !guidance) throw new Error('已选规则缺少标题或正文')
    lines.push('', `### ${index + 1}. ${title}`, '', guidance)
    if (rule.appliesWhen.trim()) lines.push('', `**${zh ? '适用场景' : 'Apply when'}:** ${markdownText(rule.appliesWhen, 800)}`)
    if (rule.exceptions.trim()) lines.push('', `**${zh ? '例外' : 'Exceptions'}:** ${markdownText(rule.exceptions, 1_000)}`)
    if (rule.limitations.trim()) lines.push('', `**${zh ? '边界' : 'Limits'}:** ${markdownText(rule.limitations, 1_000)}`)
  })
  lines.push(
    '',
    zh ? '## 修稿自检' : '## Revision check',
    '',
    zh ? '- 是否遵守当前修稿要求并保留作者确认的事实？' : '- Does the revision follow the current request and preserve confirmed author facts?',
    zh ? '- 是否只在规则说明的适用场景中使用这些方法？' : '- Are these methods applied only in their stated situations?',
    zh ? '- 是否保留了人物视角、叙事功能、节奏与情绪所需的表达？' : '- Does the prose retain what viewpoint, narrative function, pacing, and emotion require?',
    '',
  )
  const content = lines.join('\n')
  const inspection = inspectWritingSkillMarkdown(content)
  if (!inspection.compatible || inspection.metadata.stage !== 'refinement') {
    throw new Error(`生成的技能不兼容：${inspection.reasons.join(', ') || 'stage mismatch'}`)
  }
  return content
}

export async function sha256Text(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境不支持 SHA-256，无法确认技能内容')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
