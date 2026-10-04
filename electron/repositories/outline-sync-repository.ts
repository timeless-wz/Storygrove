/**
 * 正文反向修纲仓库（knowledge-action-outline-sync-contract §5）。
 *
 * 语义冻结：
 * - 候选创建时冻结正文（draftId/version/contentHash）与蓝图（chapterNumber/revision/contentHash）；
 *   使用显式 drafts.blueprint_chapter_number 定位目标，不用正文章号猜蓝图章号。
 * - 提交在单事务内复核全部版本（正文哈希、蓝图 revision/contentHash、绑定关系），
 *   任一变化 → needsRecompare，候选原样保留；全部通过 → 应用补丁、保存 v2、写审计行。
 * - 重复提交同一候选幂等返回，不双写。
 */

import { getProjectDb } from '../database'
import { ensureOutlineSyncSchema } from '../services/outline-sync-schema'
import { DraftRepository } from './draft-repository'
import { BlueprintDetailRepository } from './blueprint-detail-repository'
import { FinalizationRepository } from './finalization-repository'
import { NarrativeThreadRepository } from './narrative-thread-repository'
import { ForeshadowingRepository } from './foreshadowing-repository'
import { KnowledgeGapRepository } from './knowledge-gap-repository'
import { CharacterActionRepository } from './character-action-repository'
import {
  applyOutlineSyncPatchItems,
  buildOutlineSyncIdMap,
  OUTLINE_SYNC_CANDIDATE_ID_PREFIX,
  type OutlineSyncAffected,
  type OutlineSyncCandidate,
  type OutlineSyncCandidateStatus,
  type OutlineSyncCreateCandidateInput,
  type OutlineSyncPatchItem,
  type OutlineSyncProseSource,
} from '../../src/shared/outline-sync'
import { randomCanvasUuid } from '../../src/shared/canvas-ids'
import { computeProseContentHash } from '../../src/shared/prose-anchor'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

function requireDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

interface CandidateRow {
  id: string
  chapter_number: number
  draft_id: number
  prose_version: number
  prose_status: string
  finalization_id: string | null
  prose_hash: string
  unfinished_draft: number
  blueprint_revision: number
  blueprint_hash: string
  payload: string
  no_substantive_change: number
  status: string
  created_at: string
  updated_at: string
}

function rowToCandidate(row: CandidateRow): OutlineSyncCandidate {
  const payload = JSON.parse(row.payload) as { items?: OutlineSyncPatchItem[]; summaryNote?: string }
  const prose: OutlineSyncProseSource = {
    draftId: row.draft_id,
    version: row.prose_version,
    status: row.prose_status as OutlineSyncProseSource['status'],
    ...(row.finalization_id ? { finalizationId: row.finalization_id } : {}),
    contentHash: row.prose_hash,
    unfinishedDraft: row.unfinished_draft === 1,
  }
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    prose,
    blueprint: { chapterNumber: row.chapter_number, revision: row.blueprint_revision, contentHash: row.blueprint_hash },
    items: payload.items ?? [],
    noSubstantiveChange: row.no_substantive_change === 1,
    summaryNote: payload.summaryNote ?? '',
    status: row.status as OutlineSyncCandidateStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CreateCandidateResult {
  success: boolean
  candidate?: OutlineSyncCandidate
  /** 创建时被拒收的条目（引用了不存在的条目 / beforeMarkdown 过期）。 */
  rejectedItems?: Array<{ id: string; reason: string }>
  error?: string
}

export interface CommitCandidateInput {
  candidateId: string
  acceptedItemIds: string[]
}

export interface CommitCandidateResult {
  success: boolean
  revision?: number
  contentHash?: string
  committed?: boolean
  alreadyCommitted?: boolean
  needsRecompare?: boolean
  reason?: string
  affected?: OutlineSyncAffected
  error?: string
}

export class OutlineSyncRepository {
  static ensureSchema(db: ProjectDatabase): void {
    ensureOutlineSyncSchema(db)
  }

  // ===== 「细纲待核对」标记 =====

  static markPending(input: { chapterNumber: number; draftId: number; proseHash: string }): { success: boolean; error?: string } {
    const db = requireDb()
    db.prepare(`
      INSERT INTO outline_sync_pending (chapter_number, draft_id, prose_hash, marked_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(chapter_number) DO UPDATE SET draft_id = excluded.draft_id, prose_hash = excluded.prose_hash, marked_at = excluded.marked_at
    `).run(input.chapterNumber, input.draftId, input.proseHash)
    return { success: true }
  }

  static clearPending(chapterNumber: number): { success: boolean; error?: string } {
    const db = requireDb()
    db.prepare('DELETE FROM outline_sync_pending WHERE chapter_number = ?').run(chapterNumber)
    return { success: true }
  }

  static listPending(): Array<{ chapterNumber: number; draftId: number; proseHash: string; markedAt: string }> {
    const db = requireDb()
    return (db.prepare('SELECT chapter_number, draft_id, prose_hash, marked_at FROM outline_sync_pending ORDER BY chapter_number')
      .all() as Array<{ chapter_number: number; draft_id: number; prose_hash: string; marked_at: string }>)
      .map(row => ({ chapterNumber: row.chapter_number, draftId: row.draft_id, proseHash: row.prose_hash, markedAt: row.marked_at }))
  }

  // ===== 候选 =====

  static createCandidate(input: OutlineSyncCreateCandidateInput): CreateCandidateResult {
    const db = requireDb()
    // 1) 绑定关系：显式 drafts.blueprint_chapter_number，不用正文章号猜。
    const draft = DraftRepository.getMeta(input.draftId)
    if (!draft) return { success: false, error: `草稿不存在：${input.draftId}` }
    if (draft.blueprintChapterNumber !== input.chapterNumber) {
      return { success: false, error: `草稿 ${input.draftId} 未绑定到第 ${input.chapterNumber} 章蓝图，已拒绝创建同步候选` }
    }
    // 2) 冻结正文哈希（先保存成功后才可能到达这里；这里重新读全文计算）。
    const full = DraftRepository.getFull(input.draftId)
    if (!full) return { success: false, error: `草稿正文不存在：${input.draftId}` }
    const proseHash = computeProseContentHash(full.content)
    const proseStatus: OutlineSyncProseSource['status'] = draft.status === 'finalized' ? 'finalized' : 'draft'
    const finalizationId = proseStatus === 'finalized'
      ? (FinalizationRepository.getByDraftId(input.draftId)?.finalizationId ?? undefined)
      : undefined
    // 3) 冻结蓝图版本；无 v2 细纲时无法同步（先在蓝图编辑器建立细纲）。
    const detail = BlueprintDetailRepository.get(input.chapterNumber)
    if (!detail) return { success: false, error: `第 ${input.chapterNumber} 章暂无 v2 细纲` }
    if (detail.readStatus) {
      return { success: false, error: `第 ${input.chapterNumber} 章细纲读取异常（${detail.readStatus}），已阻止同步` }
    }
    // 4) 条目校验：引用的 ID 必须存在于冻结蓝图，beforeMarkdown 必须与当前内容相等。
    const idMap = buildOutlineSyncIdMap(detail)
    const knownItemIds = new Set(idMap.flatMap(section => section.items.map(item => item.id)))
    const currentMarkdownById = new Map(
      idMap.flatMap(section => section.items.map(item => [item.id, item.markdown] as const)),
    )
    const rejectedItems: Array<{ id: string; reason: string }> = []
    const acceptedItems: OutlineSyncPatchItem[] = []
    for (const item of input.items) {
      const op = item.op
      if (op.kind === 'replace-item' || op.kind === 'remove-item') {
        if (!knownItemIds.has(op.itemId)) {
          rejectedItems.push({ id: item.id, reason: `条目 ${op.itemId} 不在第 ${input.chapterNumber} 章细纲中` })
          continue
        }
        const expected = currentMarkdownById.get(op.itemId)
        if (expected !== op.beforeMarkdown) {
          rejectedItems.push({ id: item.id, reason: `条目 ${op.itemId} 的原文快照与当前细纲不一致` })
          continue
        }
      } else if (op.kind === 'reorder-scenes') {
        if (op.orderedSceneIds.some(id => !knownItemIds.has(id))) {
          rejectedItems.push({ id: item.id, reason: '分镜顺序列表引用了不存在的分镜 ID' })
          continue
        }
      } else if (op.kind === 'add-scene' && op.afterSceneId && !knownItemIds.has(op.afterSceneId)) {
        rejectedItems.push({ id: item.id, reason: `插入锚点 ${op.afterSceneId} 不存在` })
        continue
      }
      acceptedItems.push(item)
    }
    const tx = db.transaction((): CreateCandidateResult => {
      const now = new Date().toISOString()
      const id = `${OUTLINE_SYNC_CANDIDATE_ID_PREFIX}-${randomCanvasUuid()}`
      db.prepare(`
        INSERT INTO outline_sync_candidates (
          id, chapter_number, draft_id, prose_version, prose_status, finalization_id, prose_hash,
          unfinished_draft, blueprint_revision, blueprint_hash, payload, no_substantive_change, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        id, input.chapterNumber, input.draftId, draft.version, proseStatus,
        finalizationId ?? null,
        proseHash, input.unfinishedDraft ? 1 : 0,
        detail.revision, detail.contentHash,
        JSON.stringify({ items: acceptedItems, summaryNote: input.summaryNote }),
        input.noSubstantiveChange ? 1 : 0,
        now, now,
      )
      const row = db.prepare('SELECT * FROM outline_sync_candidates WHERE id = ?').get(id) as CandidateRow
      return { success: true, candidate: rowToCandidate(row), rejectedItems }
    })
    return tx()
  }

  static getCandidate(id: string): OutlineSyncCandidate | null {
    const db = requireDb()
    const row = db.prepare('SELECT * FROM outline_sync_candidates WHERE id = ?').get(id) as CandidateRow | undefined
    return row ? rowToCandidate(row) : null
  }

  static listCandidates(query: { chapterNumber?: number; status?: OutlineSyncCandidateStatus } = {}): OutlineSyncCandidate[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM outline_sync_candidates ORDER BY updated_at DESC, id').all() as CandidateRow[]
    let candidates = rows.map(rowToCandidate)
    if (query.chapterNumber !== undefined) candidates = candidates.filter(c => c.chapterNumber === query.chapterNumber)
    if (query.status) candidates = candidates.filter(c => c.status === query.status)
    return candidates
  }

  static discardCandidate(id: string): { success: boolean; error?: string } {
    const db = requireDb()
    const result = db.prepare("UPDATE outline_sync_candidates SET status = 'discarded', updated_at = datetime('now') WHERE id = ? AND status = 'pending'").run(id)
    if (result.changes === 0) return { success: false, error: '候选不存在或已不在待定状态' }
    return { success: true }
  }

  // ===== 提交（事务内全版本复核） =====

  static commitCandidate(input: CommitCandidateInput): CommitCandidateResult {
    const db = requireDb()
    const candidate = OutlineSyncRepository.getCandidate(input.candidateId)
    if (!candidate) return { success: false, error: `同步候选不存在：${input.candidateId}` }
    if (candidate.status === 'committed') {
      return { success: true, committed: true, alreadyCommitted: true }
    }
    if (candidate.status !== 'pending') {
      return { success: false, needsRecompare: true, reason: `候选当前状态为 ${candidate.status}，已阻止提交` }
    }
    // 复核 1：正文仍然逐字相同（保存过新内容 → 需要重新核对）。
    const full = DraftRepository.getFull(candidate.prose.draftId)
    if (!full) return { success: false, needsRecompare: true, reason: '同步来源草稿已不存在，候选已保留' }
    const currentProseHash = computeProseContentHash(full.content)
    if (currentProseHash !== candidate.prose.contentHash) {
      return { success: false, needsRecompare: true, reason: '正文在候选创建后又有修改，请重新核对' }
    }
    // 复核 2：绑定关系未变。
    const draftMeta = DraftRepository.getMeta(candidate.prose.draftId)
    if (!draftMeta || draftMeta.blueprintChapterNumber !== candidate.chapterNumber) {
      return { success: false, needsRecompare: true, reason: '草稿与蓝图的绑定关系已变化，请重新核对' }
    }
    // 复核 3：蓝图 revision/contentHash 未变。
    const detail = BlueprintDetailRepository.get(candidate.chapterNumber)
    if (!detail) return { success: false, needsRecompare: true, reason: '目标章节细纲已不存在' }
    if (detail.readStatus) return { success: false, needsRecompare: true, reason: `目标章节细纲读取异常（${detail.readStatus}）` }
    if (detail.revision !== candidate.blueprint.revision || detail.contentHash !== candidate.blueprint.contentHash) {
      return { success: false, needsRecompare: true, reason: '章节细纲在候选创建后又被修改过，请重新核对' }
    }
    // 复核 4：被接受的条目原文快照全部仍然相等（部分失效 → 整体阻止，避免半应用）。
    const acceptedItems = candidate.items.filter(item => input.acceptedItemIds.includes(item.id))
    const staleItemIds = acceptedItems
      .filter(item => (item.op.kind === 'replace-item' || item.op.kind === 'remove-item'))
      .filter(item => {
        const op = item.op as Extract<OutlineSyncPatchItem['op'], { kind: 'replace-item' | 'remove-item' }>
        const section = detail.sections.find(sec => sec.kind === 'canonical' && sec.id === op.sectionId)
        const entry = section && section.kind === 'canonical'
          ? section.items.find(it => it.id === op.itemId)
          : undefined
        return !entry || entry.markdown !== op.beforeMarkdown
      })
    if (staleItemIds.length > 0) {
      return { success: false, needsRecompare: true, reason: `以下补丁条目的细纲原文快照已过期：${staleItemIds.map(item => item.id).join('、')}` }
    }
    // 应用 + 保存 + 审计：单事务。
    const application = applyOutlineSyncPatchItems(detail, acceptedItems, input.acceptedItemIds)
    if (application.skipped.length > 0 || application.appliedItemIds.length !== acceptedItems.length) {
      return {
        success: false,
        needsRecompare: true,
        reason: `部分补丁条目无法应用（${application.skipped.map(s => `${s.itemId}：${s.reason}`).join('；')}），候选已保留`,
      }
    }
    const save = BlueprintDetailRepository.save({
      chapterNumber: candidate.chapterNumber,
      baseRevision: candidate.blueprint.revision,
      content: application.content,
    })
    if (!save.success || save.conflict) {
      return { success: false, needsRecompare: true, reason: save.error ?? '细纲保存冲突，请重新核对' }
    }
    const affected = OutlineSyncRepository.buildAffected(candidate, full.content)
    const tx = db.transaction((): CommitCandidateResult => {
      db.prepare("UPDATE outline_sync_candidates SET status = 'committed', updated_at = datetime('now') WHERE id = ?")
        .run(candidate.id)
      db.prepare('DELETE FROM outline_sync_pending WHERE chapter_number = ?').run(candidate.chapterNumber)
      db.prepare(`
        INSERT INTO outline_sync_commits (
          candidate_id, chapter_number, accepted_item_ids, skipped_items, prose_source,
          blueprint_revision_before, blueprint_revision_after, blueprint_hash_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidate.id, candidate.chapterNumber,
        JSON.stringify(application.appliedItemIds),
        JSON.stringify(application.skipped),
        JSON.stringify(candidate.prose),
        candidate.blueprint.revision, save.revision ?? candidate.blueprint.revision + 1,
        save.contentHash ?? '',
      )
      return {
        success: true,
        committed: true,
        revision: save.revision,
        contentHash: save.contentHash,
        affected,
      }
    })
    return tx()
  }

  /** 下游影响提示：只查询不改写（契约 §5.2/§6 下游影响）。 */
  static buildAffected(candidate: OutlineSyncCandidate, currentProseContent: string): OutlineSyncAffected {
    const chapterNumber = candidate.chapterNumber
    const threadPlanIds = NarrativeThreadRepository.list()
      .filter(plan => plan.targetEndChapter >= chapterNumber)
      .map(plan => plan.id)
    const records = KnowledgeGapRepository.listKnowledgeRecords({})
    const anchoredRecordIds = records
      .filter(record => record.proseAnchor?.draftId === candidate.prose.draftId)
      .map(record => record.id)
    const knowledgeRecordIds = records
      .filter(record => (
        (record.narrativePosition.kind === 'chapter-scene' && record.narrativePosition.chapterNumber >= chapterNumber)
        || anchoredRecordIds.includes(record.id)
      ))
      .map(record => record.id)
    const staleProseAnchorRecordIds = anchoredRecordIds.filter(recordId => (
      KnowledgeGapRepository.checkProseAnchor(recordId, currentProseContent) === 'stale'
    ))
    const actionIds = CharacterActionRepository.listActions()
      .filter(action => (
        action.relatedChapterNumbers.includes(chapterNumber)
        || (action.narrativePosition.kind === 'chapter-scene' && action.narrativePosition.chapterNumber >= chapterNumber)
        || action.proseAnchor?.draftId === candidate.prose.draftId
      ))
      .map(action => action.id)
    const foreshadowingIds = ForeshadowingRepository.listAll()
      .filter(marker => marker.chapterNumber === chapterNumber)
      .map(marker => marker.id)
    return { threadPlanIds, knowledgeRecordIds, actionIds, foreshadowingIds, staleProseAnchorRecordIds }
  }

  static affectedPreview(chapterNumber: number): OutlineSyncAffected {
    const db = requireDb()
    const latestDraft = DraftRepository.getLatestByChapter(chapterNumber)
    const currentProseContent = latestDraft ? DraftRepository.getFull(latestDraft.id)?.content ?? '' : ''
    const pendingRow = db.prepare('SELECT draft_id FROM outline_sync_candidates WHERE chapter_number = ? AND status = \'pending\' LIMIT 1').get(chapterNumber) as { draft_id: number } | undefined
    void pendingRow
    const probe: OutlineSyncCandidate = {
      id: '',
      chapterNumber,
      prose: { draftId: latestDraft?.id ?? 0, version: latestDraft?.version ?? 0, status: 'draft', contentHash: '', unfinishedDraft: false },
      blueprint: { chapterNumber, revision: 0, contentHash: '' },
      items: [],
      noSubstantiveChange: true,
      summaryNote: '',
      status: 'pending',
      createdAt: '',
      updatedAt: '',
    }
    return OutlineSyncRepository.buildAffected(probe, currentProseContent)
  }

  static listCommits(chapterNumber?: number): Array<{
    id: number
    candidateId: string
    chapterNumber: number
    acceptedItemIds: string[]
    skippedItems: string
    proseSource: string
    blueprintRevisionBefore: number
    blueprintRevisionAfter: number
    blueprintHashAfter: string
    createdAt: string
  }> {
    const db = requireDb()
    const rows = (chapterNumber !== undefined
      ? db.prepare('SELECT * FROM outline_sync_commits WHERE chapter_number = ? ORDER BY id DESC').all(chapterNumber)
      : db.prepare('SELECT * FROM outline_sync_commits ORDER BY id DESC').all()) as Array<Record<string, unknown>>
    return rows.map(row => ({
      id: row.id as number,
      candidateId: row.candidate_id as string,
      chapterNumber: row.chapter_number as number,
      acceptedItemIds: JSON.parse(row.accepted_item_ids as string) as string[],
      skippedItems: String(row.skipped_items ?? '[]'),
      proseSource: String(row.prose_source ?? '{}'),
      blueprintRevisionBefore: row.blueprint_revision_before as number,
      blueprintRevisionAfter: row.blueprint_revision_after as number,
      blueprintHashAfter: String(row.blueprint_hash_after ?? ''),
      createdAt: String(row.created_at ?? ''),
    }))
  }
}
