import { ipc } from './ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type { PhaseAuditResult, PhaseAuditFinding, PhaseRagSearchResult } from '../shared/phase3-8'
import type { StoryEventRecord } from '../shared/story-ledger'

export const phase3To8Service = {
  search(session: ProjectSessionContext, query: string, topK = 10): Promise<PhaseRagSearchResult> { return ipc.invokeWithProjectSession(session, 'phase:rag-search', query, topK, session.projectPath) },
  auditChapter(session: ProjectSessionContext, chapterNumber: number, content: string): Promise<PhaseAuditResult> { return ipc.invokeWithProjectSession(session, 'phase:audit-chapter', chapterNumber, content, session.projectPath) },
  listAuditFindings(session: ProjectSessionContext, runId?: string): Promise<PhaseAuditFinding[]> { return ipc.invokeWithProjectSession(session, 'phase:list-audit-findings', runId, session.projectPath) },
  listEvents(session: ProjectSessionContext, chapterNumber?: number): Promise<StoryEventRecord[]> { return ipc.invokeWithProjectSession(session, 'phase:list-events', chapterNumber, session.projectPath) },
  saveEvent(session: ProjectSessionContext, event: Omit<StoryEventRecord, 'eventId'> & { eventId?: string }): Promise<StoryEventRecord> { return ipc.invokeWithProjectSession(session, 'phase:save-event', event, session.projectPath) },
}
