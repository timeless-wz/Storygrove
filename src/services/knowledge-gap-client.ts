/**
 * 信息与揭露 / 人物行动线 / 正文反向修纲 客户端服务。
 * 会话上下文由 ipc-client 自动附加；写失败统一经 requireIpcSuccess 转为异常。
 */

import { ipc } from './ipc-client'
import { requireIpcSuccess } from './ipc-result'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  InfoEntry,
  InfoEntrySaveInput,
  InfoTruthStatus,
  InfoTruthVersion,
  KnowledgeRecord,
  KnowledgeRecordSaveInput,
} from '../shared/knowledge-gap'
import type { CharacterActionSaveInput, CharacterActionView } from '../shared/character-action'
import type {
  OutlineSyncAffected,
  OutlineSyncCandidate,
  OutlineSyncCandidateStatus,
  OutlineSyncCreateCandidateInput,
} from '../shared/outline-sync'
import type {
  KnowledgeCheckKind,
  KnowledgeCheckReport,
  KnowledgeCheckReportInput,
} from '../shared/knowledge-check'
import type { ThreadMarkerLink, ThreadMarkerLinkInput } from '../shared/thread-marker-link'

/** 会话上下文：由组件经 captureProjectSession 冻结后传入。 */
type Session = ProjectSessionContext

export async function listInfoEntries(
  session: Session,
  filter?: { truthStatus?: InfoTruthStatus; query?: string; chapterNumber?: number },
): Promise<InfoEntry[]> {
  return ipc.invokeWithProjectSession(session, 'db:info-entry-list', filter, session.projectPath) as Promise<InfoEntry[]>
}

export async function getInfoEntry(session: Session, id: string): Promise<InfoEntry | null> {
  return ipc.invokeWithProjectSession(session, 'db:info-entry-get', id, session.projectPath) as Promise<InfoEntry | null>
}

export async function saveInfoEntry(
  session: Session,
  input: InfoEntrySaveInput,
): Promise<{ id: string; revision: number; knowledgeRecordsAffected: number }> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:info-entry-save', input, session.projectPath,
  ), '保存信息条目')
  return {
    id: result.id ?? '',
    revision: result.revision ?? 1,
    knowledgeRecordsAffected: result.knowledgeRecordsAffected ?? 0,
  }
}

export async function deleteInfoEntry(
  session: Session,
  id: string,
): Promise<{ deletedRecords: number }> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:info-entry-delete', id, session.projectPath,
  ), '删除信息条目')
  return { deletedRecords: result.deletedRecords ?? 0 }
}

export async function listTruthHistory(session: Session, id: string): Promise<InfoTruthVersion[]> {
  return ipc.invokeWithProjectSession(session, 'db:info-entry-truth-history', id, session.projectPath) as Promise<InfoTruthVersion[]>
}

export async function listKnowledgeRecords(
  session: Session,
  query?: { infoId?: string; characterId?: string; chapterNumber?: number },
): Promise<KnowledgeRecord[]> {
  return ipc.invokeWithProjectSession(session, 'db:knowledge-record-list', query, session.projectPath) as Promise<KnowledgeRecord[]>
}

export async function saveKnowledgeRecord(
  session: Session,
  input: KnowledgeRecordSaveInput,
): Promise<{ id: string; revision: number }> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:knowledge-record-save', input, session.projectPath,
  ), '保存知情记录')
  return { id: result.id ?? '', revision: result.revision ?? 1 }
}

export async function deleteKnowledgeRecord(session: Session, id: string): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:knowledge-record-delete', id, session.projectPath,
  ), '删除知情记录')
}

// ===== 人物行动线 =====

export async function listCharacterActions(
  session: Session,
  query?: { characterId?: string; chapterNumber?: number },
): Promise<CharacterActionView[]> {
  return ipc.invokeWithProjectSession(session, 'db:character-action-list', query, session.projectPath) as Promise<CharacterActionView[]>
}

export async function saveCharacterAction(
  session: Session,
  input: CharacterActionSaveInput,
): Promise<{ id: string; revision: number }> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:character-action-save', input, session.projectPath,
  ), '保存行动记录')
  return { id: result.id ?? '', revision: result.revision ?? 1 }
}

export async function deleteCharacterAction(session: Session, id: string): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:character-action-delete', id, session.projectPath,
  ), '删除行动记录')
}

export async function promoteActionToTimeline(
  session: Session,
  id: string,
  characterName: string,
): Promise<{ eventId: string; alreadyLinked: boolean }> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:character-action-promote-to-timeline', id, characterName, session.projectPath,
  ), '加入故事时间线')
  return { eventId: result.eventId ?? '', alreadyLinked: result.alreadyLinked ?? false }
}

// ===== 正文反向修纲 =====

export async function markOutlineSyncPending(
  session: Session,
  input: { chapterNumber: number; draftId: number; proseHash: string },
): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:outline-sync-mark-pending', input, session.projectPath,
  ), '标记细纲待核对')
}

export async function clearOutlineSyncPending(session: Session, chapterNumber: number): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:outline-sync-clear-pending', chapterNumber, session.projectPath,
  ), '清除细纲待核对标记')
}

export async function listOutlineSyncPending(
  session: Session,
): Promise<Array<{ chapterNumber: number; draftId: number; proseHash: string; markedAt: string }>> {
  return ipc.invokeWithProjectSession(session, 'db:outline-sync-list-pending', session.projectPath) as Promise<Array<{ chapterNumber: number; draftId: number; proseHash: string; markedAt: string }>>
}

export async function createOutlineSyncCandidate(
  session: Session,
  input: OutlineSyncCreateCandidateInput,
): Promise<{ candidate: OutlineSyncCandidate; rejectedItems: Array<{ id: string; reason: string }> }> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:outline-sync-create-candidate', input, session.projectPath,
  ), '创建同步候选')
  if (!result.candidate) throw new Error('同步候选创建结果缺失')
  return { candidate: result.candidate, rejectedItems: result.rejectedItems ?? [] }
}

export async function getOutlineSyncCandidate(session: Session, id: string): Promise<OutlineSyncCandidate | null> {
  return ipc.invokeWithProjectSession(session, 'db:outline-sync-get-candidate', id, session.projectPath) as Promise<OutlineSyncCandidate | null>
}

export async function listOutlineSyncCandidates(
  session: Session,
  query?: { chapterNumber?: number; status?: OutlineSyncCandidateStatus },
): Promise<OutlineSyncCandidate[]> {
  return ipc.invokeWithProjectSession(session, 'db:outline-sync-list-candidates', query, session.projectPath) as Promise<OutlineSyncCandidate[]>
}

export async function discardOutlineSyncCandidate(session: Session, id: string): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:outline-sync-discard-candidate', id, session.projectPath,
  ), '放弃同步候选')
}

export async function commitOutlineSyncCandidate(
  session: Session,
  input: { candidateId: string; acceptedItemIds: string[] },
): Promise<{
  revision?: number
  contentHash?: string
  alreadyCommitted?: boolean
  affected?: OutlineSyncAffected
}> {
  const result = await ipc.invokeWithProjectSession(
    session, 'db:outline-sync-commit', input, session.projectPath,
  ) as {
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
  if (result.needsRecompare) {
    const error = new Error(result.reason ?? '正文或细纲已变化，请重新核对') as Error & { needsRecompare?: boolean }
    error.needsRecompare = true
    throw error
  }
  requireIpcSuccess(result, '提交细纲同步')
  return {
    revision: result.revision,
    contentHash: result.contentHash,
    alreadyCommitted: result.alreadyCommitted,
    affected: result.affected,
  }
}

export async function previewOutlineSyncAffected(session: Session, chapterNumber: number): Promise<OutlineSyncAffected> {
  return ipc.invokeWithProjectSession(session, 'db:outline-sync-affected-preview', chapterNumber, session.projectPath) as Promise<OutlineSyncAffected>
}

// ===== 检查报告 =====

export async function saveKnowledgeCheckReport(
  session: Session,
  report: KnowledgeCheckReportInput,
): Promise<KnowledgeCheckReport> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:knowledge-check-report-save', report, session.projectPath,
  ), '保存检查报告')
  if (!result.report) throw new Error('检查报告保存结果缺失')
  return result.report
}

export async function listKnowledgeCheckReports(
  session: Session,
  query?: { kind?: KnowledgeCheckKind; scope?: string },
): Promise<KnowledgeCheckReport[]> {
  return ipc.invokeWithProjectSession(session, 'db:knowledge-check-report-list', query, session.projectPath) as Promise<KnowledgeCheckReport[]>
}

export async function deleteKnowledgeCheckReport(session: Session, id: string): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:knowledge-check-report-delete', id, session.projectPath,
  ), '删除检查报告')
}

// ===== 伏笔↔脉络关系 =====

export async function listThreadMarkerLinks(
  session: Session,
  query?: { threadPlanId?: number; foreshadowingId?: string },
): Promise<ThreadMarkerLink[]> {
  return ipc.invokeWithProjectSession(session, 'db:thread-marker-link-list', query, session.projectPath) as Promise<ThreadMarkerLink[]>
}

export async function linkThreadMarker(session: Session, input: ThreadMarkerLinkInput): Promise<ThreadMarkerLink> {
  const result = requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:thread-marker-link', input, session.projectPath,
  ), '关联长线计划')
  if (!result.link) throw new Error('关联结果缺失')
  return result.link
}

export async function unlinkThreadMarker(session: Session, id: string): Promise<void> {
  requireIpcSuccess(await ipc.invokeWithProjectSession(
    session, 'db:thread-marker-unlink', id, session.projectPath,
  ), '解除长线计划关联')
}
