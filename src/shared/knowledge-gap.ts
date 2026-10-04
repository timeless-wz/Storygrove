/**
 * 信息与揭露（信息差）— 跨模块唯一权威类型模块（knowledge-action-outline-sync-contract §3）。
 *
 * 权威边界（冻结）：
 * - 信息条目只存「作者层面的真相与确定状态」；它不是世界/角色正式资料，也不是剧情事实库；
 * - 知情记录是人物的主观认知（确信 ≠ 正确）；读者记录是作者预期的读者理解，不是对真实读者的断言；
 * - 故事位置（storyPosition）与叙事位置（narrativePosition）互相独立，禁止用章号互相推断。
 */

import { randomCanvasUuid } from './canvas-ids'
import type { NarrativePosition, ProseAnchor, StoryPosition } from './prose-anchor'

export const KNOWLEDGE_GAP_SCHEMA_VERSION = 1

export const INFO_ENTRY_ID_PREFIX = 'info'
export const KNOWLEDGE_RECORD_ID_PREFIX = 'knw'

/** 信息条目标题/说明上限（防失控，不限制正常内容）。 */
export const MAX_INFO_ENTRY_TITLE = 120
export const MAX_INFO_ENTRY_SUMMARY = 2000
export const MAX_INFO_ENTRY_TRUTH = 8000
export const MAX_KNOWN_CONTENT = 4000
export const MAX_BELIEVED_STATEMENT = 2000
export const MAX_CHANNEL_NOTE = 500

/** 作者确定状态：与任何"揭露状态"独立——未决定真相 ≠ 已决定但尚未揭露。 */
export type InfoTruthStatus = 'confirmed' | 'undecided' | 'retired'

export const INFO_TRUTH_STATUS_LABEL: Record<InfoTruthStatus, { zh: string; en: string }> = {
  confirmed: { zh: '已确认', en: 'Confirmed' },
  undecided: { zh: '待定', en: 'Undecided' },
  retired: { zh: '已废止', en: 'Retired' },
}

export type InfoSourceRef =
  | { kind: 'document'; documentId: string; note?: string }
  | { kind: 'character'; characterId: string; note?: string }
  | { kind: 'chapter'; chapterNumber: number; note?: string }
  | { kind: 'note'; text: string }

export interface InfoEntry {
  id: string                 // info-<uuid>
  title: string
  summary: string            // 主题说明
  truth: string              // 实际真相；undecided 时允许为空
  truthStatus: InfoTruthStatus
  sourceRefs: InfoSourceRef[]
  /** 可选关联的章节脉络计划 id；计划状态以脉络模块为准。 */
  relatedThreadPlanIds: number[]
  revision: number
  createdAt: string
  updatedAt: string
}

/** 真相版本历史（每次 truth/truthStatus 成功修改追加一行，永不改写旧行）。 */
export interface InfoTruthVersion {
  entryId: string
  revision: number
  truth: string
  truthStatus: InfoTruthStatus
  note: string
  createdAt: string
}

/** 新建/更新条目时的作者输入（revision 由服务端维护）。 */
export interface InfoEntryDraft {
  title: string
  summary: string
  truth: string
  truthStatus: InfoTruthStatus
  sourceRefs: InfoSourceRef[]
  relatedThreadPlanIds: number[]
  /** 仅更新时使用：本次真相修改的备注（写入版本历史）。 */
  truthChangeNote?: string
}

// ===== 主体知情记录 =====

export type KnowledgeSubjectKind = 'character' | 'reader'

/**
 * 认知状态词表：只描述人物的主观状态，不保证正确。
 * unknown=未知 heard=听闻 suspected=怀疑 partial=部分掌握 confident=确信
 */
export type KnowledgeCognition = 'unknown' | 'heard' | 'suspected' | 'partial' | 'confident'

export const KNOWLEDGE_COGNITION_LABEL: Record<KnowledgeCognition, { zh: string; en: string }> = {
  unknown: { zh: '未知', en: 'Unknown' },
  heard: { zh: '听闻', en: 'Heard of' },
  suspected: { zh: '怀疑', en: 'Suspects' },
  partial: { zh: '部分掌握', en: 'Partial' },
  confident: { zh: '确信', en: 'Confident' },
}

/** 人物相信的说法与作者真相的关系；作者真相未定时只允许 undetermined。 */
export type KnowledgeTruthRelation = 'consistent' | 'partial' | 'misconstrued' | 'undetermined'

export const KNOWLEDGE_TRUTH_RELATION_LABEL: Record<KnowledgeTruthRelation, { zh: string; en: string }> = {
  consistent: { zh: '一致', en: 'Consistent' },
  partial: { zh: '部分一致', en: 'Partially consistent' },
  misconstrued: { zh: '误解', en: 'Misconstrued' },
  undetermined: { zh: '尚无法判断', en: 'Undetermined' },
}

/** 记录依据：计划（作者规划）或经作者确认的正文依据（必须带锚点）。 */
export type KnowledgeBasis = 'plan' | 'prose'

export interface KnowledgeConcealment {
  /** 向谁隐瞒（稳定人物 ID 列表）。隐瞒与误解不互斥。 */
  fromCharacterIds: string[]
  /** 公开说法。 */
  publicStatement: string
}

/** 读者记录：读者是单独主体，只记录作者已展示的证据与预期的读者理解。 */
export interface KnowledgeReaderRecord {
  /** 已展示给读者的证据。 */
  shownEvidence: string
  /** 作者预期的读者理解（不是断言真实读者猜到什么）。 */
  expectedUnderstanding: string
  /** 计划揭露位置说明。 */
  revealPlanNote: string
}

export interface KnowledgeRecord {
  id: string                       // knw-<uuid>
  infoId: string
  subjectKind: KnowledgeSubjectKind
  /** subjectKind='character' 必填；稳定人物 ID，人物改名不受影响。 */
  characterId?: string
  /** 知道的具体内容/部分（不是一个"知道"勾选）。 */
  knownContent: string
  cognition: KnowledgeCognition
  /** 人物相信的说法。 */
  believedStatement: string
  truthRelation: KnowledgeTruthRelation
  /** 获知途径：亲历/他人告知/调查/推断…（自由文本）。 */
  learningChannel: string
  /** 途径来源说明（事件/章节/人物）。 */
  channelSourceNote: string
  storyPosition: StoryPosition
  narrativePosition: NarrativePosition
  concealment?: KnowledgeConcealment | null
  basis: KnowledgeBasis
  /** basis='prose' 时必填：来源版本与片段锚点。 */
  proseAnchor?: ProseAnchor
  reader?: KnowledgeReaderRecord | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeRecordDraft {
  infoId: string
  subjectKind: KnowledgeSubjectKind
  characterId?: string
  knownContent: string
  cognition: KnowledgeCognition
  believedStatement: string
  truthRelation: KnowledgeTruthRelation
  learningChannel: string
  channelSourceNote: string
  storyPosition: StoryPosition
  narrativePosition: NarrativePosition
  concealment?: KnowledgeConcealment | null
  basis: KnowledgeBasis
  proseAnchor?: ProseAnchor
  reader?: KnowledgeReaderRecord | null
}

export function createInfoEntryId(): string {
  return `${INFO_ENTRY_ID_PREFIX}-${randomCanvasUuid()}`
}

export function createKnowledgeRecordId(): string {
  return `${KNOWLEDGE_RECORD_ID_PREFIX}-${randomCanvasUuid()}`
}

/** 新建/更新条目的完整输入（id 缺省 = 新建；baseRevision 用于乐观并发）。 */
export interface InfoEntrySaveInput extends InfoEntryDraft {
  id?: string
  baseRevision?: number
}

export interface KnowledgeRecordSaveInput extends KnowledgeRecordDraft {
  id?: string
  baseRevision?: number
}

// ===== 校验（保存前防线：超限/类型错零写入；未知状态不虚构默认值） =====

export function assertValidInfoSourceRef(ref: unknown): void {
  if (!ref || typeof ref !== 'object') throw new Error('信息来源引用无效')
  const candidate = ref as Record<string, unknown>
  if (candidate.kind === 'document') {
    if (typeof candidate.documentId !== 'string' || !candidate.documentId.trim()) {
      throw new Error('来源文档引用缺少文档 ID')
    }
  } else if (candidate.kind === 'character') {
    if (typeof candidate.characterId !== 'string' || !candidate.characterId.trim()) {
      throw new Error('来源人物引用缺少人物 ID')
    }
  } else if (candidate.kind === 'chapter') {
    if (!Number.isSafeInteger(candidate.chapterNumber) || (candidate.chapterNumber as number) < 1) {
      throw new Error('来源章节引用的章节号无效')
    }
  } else if (candidate.kind === 'note') {
    if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
      throw new Error('来源说明引用缺少内容')
    }
  } else {
    throw new Error(`未知的来源引用类型：${String(candidate.kind)}`)
  }
}

export function assertValidInfoEntryDraft(draft: InfoEntryDraft): void {
  if (!draft || typeof draft !== 'object') throw new Error('信息条目无效')
  if (typeof draft.title !== 'string' || !draft.title.trim()) throw new Error('信息条目缺少名称')
  if (draft.title.length > MAX_INFO_ENTRY_TITLE) throw new Error(`信息条目名称超限（≤${MAX_INFO_ENTRY_TITLE} 字符）`)
  if (typeof draft.summary !== 'string' || draft.summary.length > MAX_INFO_ENTRY_SUMMARY) {
    throw new Error(`主题说明超限（≤${MAX_INFO_ENTRY_SUMMARY} 字符）`)
  }
  if (typeof draft.truth !== 'string' || draft.truth.length > MAX_INFO_ENTRY_TRUTH) {
    throw new Error(`实际真相超限（≤${MAX_INFO_ENTRY_TRUTH} 字符）`)
  }
  if (draft.truthStatus !== 'confirmed' && draft.truthStatus !== 'undecided' && draft.truthStatus !== 'retired') {
    throw new Error(`未知的真相确定状态：${String(draft.truthStatus)}`)
  }
  if (draft.truthStatus === 'confirmed' && !draft.truth.trim()) {
    throw new Error('已确认的条目必须填写实际真相（不确定请使用「待定」状态）')
  }
  if (!Array.isArray(draft.sourceRefs)) throw new Error('来源引用列表无效')
  for (const ref of draft.sourceRefs) assertValidInfoSourceRef(ref)
  if (!Array.isArray(draft.relatedThreadPlanIds)
    || draft.relatedThreadPlanIds.some(id => !Number.isSafeInteger(id))) {
    throw new Error('关联脉络计划列表无效')
  }
}

function assertValidStoryPosition(position: StoryPosition): void {
  if (!position || typeof position !== 'object') throw new Error('故事位置无效')
  if (position.kind === 'timeline-event') {
    if (typeof position.eventId !== 'string' || !position.eventId.trim()) {
      throw new Error('故事位置缺少时间线事件 ID')
    }
  } else if (position.kind === 'manual') {
    if (!Number.isSafeInteger(position.sortOrder)) throw new Error('自定义故事位置缺少顺序值')
    if (typeof position.label !== 'string') throw new Error('自定义故事位置缺少说明')
  } else if (position.kind !== 'unplaced') {
    throw new Error(`未知的故事位置类型：${String((position as { kind?: unknown }).kind)}`)
  }
}

function assertValidNarrativePosition(position: NarrativePosition): void {
  if (!position || typeof position !== 'object') throw new Error('叙事位置无效')
  if (position.kind === 'chapter-scene') {
    if (!Number.isSafeInteger(position.chapterNumber) || position.chapterNumber < 1) {
      throw new Error('叙事位置的章节号无效')
    }
  } else if (position.kind !== 'unplaced') {
    throw new Error(`未知的叙事位置类型：${String((position as { kind?: unknown }).kind)}`)
  }
}

export function assertValidKnowledgeRecordDraft(draft: KnowledgeRecordDraft): void {
  if (!draft || typeof draft !== 'object') throw new Error('知情记录无效')
  if (typeof draft.infoId !== 'string' || !draft.infoId.trim()) throw new Error('知情记录缺少信息条目')
  if (draft.subjectKind !== 'character' && draft.subjectKind !== 'reader') {
    throw new Error(`未知的主体类型：${String(draft.subjectKind)}`)
  }
  if (draft.subjectKind === 'character' && (!draft.characterId || !draft.characterId.trim())) {
    throw new Error('人物知情记录必须关联稳定人物 ID')
  }
  if (typeof draft.knownContent !== 'string' || draft.knownContent.length > MAX_KNOWN_CONTENT) {
    throw new Error(`已知内容超限（≤${MAX_KNOWN_CONTENT} 字符）`)
  }
  if (!(draft.cognition in KNOWLEDGE_COGNITION_LABEL)) {
    throw new Error(`未知的认知状态：${String(draft.cognition)}`)
  }
  if (typeof draft.believedStatement !== 'string' || draft.believedStatement.length > MAX_BELIEVED_STATEMENT) {
    throw new Error(`人物相信的说法超限（≤${MAX_BELIEVED_STATEMENT} 字符）`)
  }
  if (!(draft.truthRelation in KNOWLEDGE_TRUTH_RELATION_LABEL)) {
    throw new Error(`未知的真相关系：${String(draft.truthRelation)}`)
  }
  if (typeof draft.learningChannel !== 'string' || draft.learningChannel.length > 120) {
    throw new Error('获知途径无效或超限')
  }
  if (typeof draft.channelSourceNote !== 'string' || draft.channelSourceNote.length > MAX_CHANNEL_NOTE) {
    throw new Error(`途径来源说明超限（≤${MAX_CHANNEL_NOTE} 字符）`)
  }
  assertValidStoryPosition(draft.storyPosition)
  assertValidNarrativePosition(draft.narrativePosition)
  if (draft.concealment !== null && draft.concealment !== undefined) {
    if (!Array.isArray(draft.concealment.fromCharacterIds)) throw new Error('隐瞒对象列表无效')
    if (typeof draft.concealment.publicStatement !== 'string' || draft.concealment.publicStatement.length > 1000) {
      throw new Error('公开说法超限（≤1000 字符）')
    }
  }
  if (draft.basis !== 'plan' && draft.basis !== 'prose') {
    throw new Error(`未知的记录依据：${String(draft.basis)}`)
  }
  if (draft.basis === 'prose' && !draft.proseAnchor) {
    throw new Error('正文依据的记录必须携带正文锚点')
  }
  if (draft.subjectKind === 'reader' && draft.reader !== null && draft.reader !== undefined) {
    if (typeof draft.reader.shownEvidence !== 'string' || draft.reader.shownEvidence.length > MAX_KNOWN_CONTENT) {
      throw new Error(`读者已见证据超限（≤${MAX_KNOWN_CONTENT} 字符）`)
    }
  }
}
