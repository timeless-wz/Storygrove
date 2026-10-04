/**
 * 信息与揭露（信息差）仓库（knowledge-action-outline-sync-contract §3）。
 *
 * 语义冻结：
 * - 信息条目 save 携带 baseRevision 乐观并发；truth/truthStatus 每次成功修改在同一事务内
 *   追加版本历史行，并返回受影响的知情记录数供 UI 提示检查——绝不批量改写人物认知。
 * - 知情记录按稳定 characterId 关联；人物改名/删除不触碰记录，悬空由渲染层提示。
 * - 删除信息条目只删条目 + 版本历史 + 该条目的知情记录，绝不级联到人物/时间线/正文。
 */

import { getProjectDb } from '../database'
import { ensureKnowledgeGapSchema } from '../services/knowledge-gap-schema'
import {
  assertValidInfoEntryDraft,
  assertValidKnowledgeRecordDraft,
  createInfoEntryId,
  createKnowledgeRecordId,
  type InfoEntry,
  type InfoEntrySaveInput,
  type InfoSourceRef,
  type InfoTruthStatus,
  type InfoTruthVersion,
  type KnowledgeCognition,
  type KnowledgeRecord,
  type KnowledgeRecordSaveInput,
} from '../../src/shared/knowledge-gap'
import { computeProseContentHash, validateProseAnchor } from '../../src/shared/prose-anchor'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

function requireDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

interface InfoEntryRow {
  id: string
  title: string
  summary: string
  truth: string
  truth_status: string
  source_refs: string
  related_thread_plan_ids: string
  revision: number
  created_at: string
  updated_at: string
}

interface KnowledgeRecordRow {
  id: string
  info_id: string
  subject_kind: string
  character_id: string | null
  payload: string
  cognition: string
  basis: string
  revision: number
  created_at: string
  updated_at: string
}

function parseJsonArray<T>(text: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? parsed as T[] : fallback
  } catch {
    return fallback
  }
}

function rowToInfoEntry(row: InfoEntryRow): InfoEntry {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    truth: row.truth,
    truthStatus: row.truth_status as InfoTruthStatus,
    sourceRefs: parseJsonArray<InfoSourceRef>(row.source_refs, []),
    relatedThreadPlanIds: parseJsonArray<number>(row.related_thread_plan_ids, []),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToKnowledgeRecord(row: KnowledgeRecordRow): KnowledgeRecord {
  const payload = JSON.parse(row.payload) as Partial<KnowledgeRecord>
  return {
    id: row.id,
    infoId: row.info_id,
    subjectKind: row.subject_kind as KnowledgeRecord['subjectKind'],
    ...(row.character_id ? { characterId: row.character_id } : {}),
    knownContent: payload.knownContent ?? '',
    cognition: payload.cognition ?? 'unknown',
    believedStatement: payload.believedStatement ?? '',
    truthRelation: payload.truthRelation ?? 'undetermined',
    learningChannel: payload.learningChannel ?? '',
    channelSourceNote: payload.channelSourceNote ?? '',
    storyPosition: payload.storyPosition ?? { kind: 'unplaced' },
    narrativePosition: payload.narrativePosition ?? { kind: 'unplaced' },
    concealment: payload.concealment ?? null,
    basis: row.basis as KnowledgeRecord['basis'],
    ...(payload.proseAnchor ? { proseAnchor: payload.proseAnchor } : {}),
    reader: payload.reader ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 认知状态提升排序（unknown 最低）；用于展示排序，不参与筛选语义。 */
const COGNITION_ORDER: Record<KnowledgeCognition, number> = {
  unknown: 0, heard: 1, suspected: 2, partial: 3, confident: 4,
}

export interface InfoEntrySaveResult {
  success: boolean
  id?: string
  revision?: number
  conflict?: boolean
  currentRevision?: number
  knowledgeRecordsAffected?: number
  error?: string
}

export interface KnowledgeRecordSaveResult {
  success: boolean
  id?: string
  revision?: number
  conflict?: boolean
  currentRevision?: number
  error?: string
}

export interface InfoEntryFilter {
  truthStatus?: InfoTruthStatus
  query?: string
  /** 章节过滤：条目的来源引用或其任一知情记录的叙事位置命中该章。 */
  chapterNumber?: number
}

export interface KnowledgeRecordQuery {
  infoId?: string
  characterId?: string
  /** 叙事位置章节号等于该章的记录。 */
  chapterNumber?: number
}

export class KnowledgeGapRepository {
  static ensureSchema(db: ProjectDatabase): void {
    ensureKnowledgeGapSchema(db)
  }

  // ===== 信息条目 =====

  static listInfoEntries(filter: InfoEntryFilter = {}): InfoEntry[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM info_entries ORDER BY updated_at DESC, id').all() as InfoEntryRow[]
    let entries = rows.map(rowToInfoEntry)
    if (filter.truthStatus) entries = entries.filter(entry => entry.truthStatus === filter.truthStatus)
    if (filter.query && filter.query.trim()) {
      const needle = filter.query.trim().toLowerCase()
      entries = entries.filter(entry => (
        entry.title.toLowerCase().includes(needle)
        || entry.summary.toLowerCase().includes(needle)
        || entry.truth.toLowerCase().includes(needle)
      ))
    }
    if (filter.chapterNumber !== undefined) {
      const chapter = filter.chapterNumber
      const records = KnowledgeGapRepository.listKnowledgeRecords({})
      const infoIdsAtChapter = new Set(records
        .filter(record => record.narrativePosition.kind === 'chapter-scene'
          && record.narrativePosition.chapterNumber === chapter)
        .map(record => record.infoId))
      entries = entries.filter(entry => (
        infoIdsAtChapter.has(entry.id)
        || entry.sourceRefs.some(ref => ref.kind === 'chapter' && ref.chapterNumber === chapter)
      ))
    }
    return entries
  }

  static getInfoEntry(id: string): InfoEntry | null {
    const db = requireDb()
    const row = db.prepare('SELECT * FROM info_entries WHERE id = ?').get(id) as InfoEntryRow | undefined
    return row ? rowToInfoEntry(row) : null
  }

  static listTruthHistory(id: string): InfoTruthVersion[] {
    const db = requireDb()
    return db.prepare(
      'SELECT entry_id, revision, truth, truth_status, note, created_at FROM info_truth_versions WHERE entry_id = ? ORDER BY revision DESC, id DESC',
    ).all(id) as unknown as InfoTruthVersion[]
  }

  static saveInfoEntry(input: InfoEntrySaveInput): InfoEntrySaveResult {
    assertValidInfoEntryDraft(input)
    const db = requireDb()
    const tx = db.transaction((): InfoEntrySaveResult => {
      const now = new Date().toISOString()
      if (input.id) {
        const currentRow = db.prepare('SELECT * FROM info_entries WHERE id = ?').get(input.id) as InfoEntryRow | undefined
        if (!currentRow) return { success: false, error: `信息条目不存在：${input.id}` }
        const currentRevision = currentRow.revision
        const baseRevision = input.baseRevision ?? currentRevision
        if (baseRevision !== currentRevision) {
          return { success: false, conflict: true, currentRevision }
        }
        const nextRevision = currentRevision + 1
        db.prepare(`
          UPDATE info_entries
          SET title = ?, summary = ?, truth = ?, truth_status = ?, source_refs = ?,
              related_thread_plan_ids = ?, revision = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.title, input.summary, input.truth, input.truthStatus,
          JSON.stringify(input.sourceRefs), JSON.stringify(input.relatedThreadPlanIds),
          nextRevision, now, input.id,
        )
        // 真相或确定状态变化 → 追加版本历史（永不改写旧行）。
        if (currentRow.truth !== input.truth || currentRow.truth_status !== input.truthStatus) {
          db.prepare(`
            INSERT INTO info_truth_versions (entry_id, revision, truth, truth_status, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(input.id, nextRevision, input.truth, input.truthStatus, input.truthChangeNote ?? '', now)
        }
        const affected = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_records WHERE info_id = ?')
          .get(input.id) as { n: number }).n
        return { success: true, id: input.id, revision: nextRevision, knowledgeRecordsAffected: affected }
      }
      const id = createInfoEntryId()
      db.prepare(`
        INSERT INTO info_entries (id, title, summary, truth, truth_status, source_refs, related_thread_plan_ids, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id, input.title, input.summary, input.truth, input.truthStatus,
        JSON.stringify(input.sourceRefs), JSON.stringify(input.relatedThreadPlanIds), now, now,
      )
      db.prepare(`
        INSERT INTO info_truth_versions (entry_id, revision, truth, truth_status, note, created_at)
        VALUES (?, 1, ?, ?, ?, ?)
      `).run(id, input.truth, input.truthStatus, input.truthChangeNote ?? '', now)
      return { success: true, id, revision: 1, knowledgeRecordsAffected: 0 }
    })
    return tx()
  }

  static deleteInfoEntry(id: string): { success: boolean; deletedRecords?: number; error?: string } {
    const db = requireDb()
    const tx = db.transaction((): { success: boolean; deletedRecords?: number } => {
      const deletedRecords = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_records WHERE info_id = ?')
        .get(id) as { n: number }).n
      db.prepare('DELETE FROM knowledge_records WHERE info_id = ?').run(id)
      db.prepare('DELETE FROM info_truth_versions WHERE entry_id = ?').run(id)
      db.prepare('DELETE FROM info_entries WHERE id = ?').run(id)
      return { success: true, deletedRecords }
    })
    return tx()
  }

  // ===== 知情记录 =====

  static listKnowledgeRecords(query: KnowledgeRecordQuery = {}): KnowledgeRecord[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM knowledge_records ORDER BY updated_at DESC, id').all() as KnowledgeRecordRow[]
    let records = rows.map(rowToKnowledgeRecord)
    if (query.infoId) records = records.filter(record => record.infoId === query.infoId)
    if (query.characterId) records = records.filter(record => record.characterId === query.characterId)
    if (query.chapterNumber !== undefined) {
      records = records.filter(record => (
        record.narrativePosition.kind === 'chapter-scene'
        && record.narrativePosition.chapterNumber === query.chapterNumber
      ))
    }
    // 同一条目下认知状态高的在前，便于阅读；不做语义筛选。
    records.sort((left, right) => (
      (COGNITION_ORDER[right.cognition] ?? 0) - (COGNITION_ORDER[left.cognition] ?? 0)
    ))
    return records
  }

  static getKnowledgeRecord(id: string): KnowledgeRecord | null {
    const db = requireDb()
    const row = db.prepare('SELECT * FROM knowledge_records WHERE id = ?').get(id) as KnowledgeRecordRow | undefined
    return row ? rowToKnowledgeRecord(row) : null
  }

  static saveKnowledgeRecord(input: KnowledgeRecordSaveInput): KnowledgeRecordSaveResult {
    assertValidKnowledgeRecordDraft(input)
    if (input.basis === 'prose' && input.proseAnchor) {
      // 锚点冻结哈希缺失时补算（导入手工构造的锚点可能没有）。
      if (!input.proseAnchor.contentHash) {
        input.proseAnchor.contentHash = computeProseContentHash(input.proseAnchor.excerpt)
      }
    }
    const db = requireDb()
    const tx = db.transaction((): KnowledgeRecordSaveResult => {
      const now = new Date().toISOString()
      const payload = JSON.stringify({
        knownContent: input.knownContent,
        cognition: input.cognition,
        believedStatement: input.believedStatement,
        truthRelation: input.truthRelation,
        learningChannel: input.learningChannel,
        channelSourceNote: input.channelSourceNote,
        storyPosition: input.storyPosition,
        narrativePosition: input.narrativePosition,
        concealment: input.concealment ?? null,
        ...(input.proseAnchor ? { proseAnchor: input.proseAnchor } : {}),
        reader: input.reader ?? null,
      })
      if (input.id) {
        const currentRow = db.prepare('SELECT * FROM knowledge_records WHERE id = ?').get(input.id) as KnowledgeRecordRow | undefined
        if (!currentRow) return { success: false, error: `知情记录不存在：${input.id}` }
        const currentRevision = currentRow.revision
        const baseRevision = input.baseRevision ?? currentRevision
        if (baseRevision !== currentRevision) {
          return { success: false, conflict: true, currentRevision }
        }
        db.prepare(`
          UPDATE knowledge_records
          SET info_id = ?, subject_kind = ?, character_id = ?, payload = ?, cognition = ?, basis = ?, revision = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.infoId, input.subjectKind, input.characterId ?? null, payload,
          input.cognition, input.basis, currentRevision + 1, now, input.id,
        )
        return { success: true, id: input.id, revision: currentRevision + 1 }
      }
      const id = createKnowledgeRecordId()
      db.prepare(`
        INSERT INTO knowledge_records (id, info_id, subject_kind, character_id, payload, cognition, basis, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id, input.infoId, input.subjectKind, input.characterId ?? null, payload,
        input.cognition, input.basis, now, now,
      )
      return { success: true, id, revision: 1 }
    })
    return tx()
  }

  static deleteKnowledgeRecord(id: string): { success: boolean; error?: string } {
    const db = requireDb()
    db.prepare('DELETE FROM knowledge_records WHERE id = ?').run(id)
    return { success: true }
  }

  // ===== 写作材料支撑（C 消费；只读，不做语义判断） =====

  /**
   * 校验某条知情记录的正文锚点在给定正文里是否仍有效。
   * 失效时调用方展示「需重新定位」，绝不改写锚点本体。
   */
  static checkProseAnchor(recordId: string, currentContent: string): 'intact' | 'stale' | 'no-anchor' {
    const record = KnowledgeGapRepository.getKnowledgeRecord(recordId)
    if (!record?.proseAnchor) return 'no-anchor'
    return validateProseAnchor(record.proseAnchor, currentContent)
  }
}
