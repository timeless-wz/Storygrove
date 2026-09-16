import type { StoryEventRecord } from './story-ledger'
export interface PhaseRagSearchHit { text: string; score: number; fileName: string; chapterNumber?: number; authorityStatus: 'confirmed' | 'candidate' | 'deprecated' | 'unknown'; source?: Record<string, unknown> }
export interface PhaseAuditFinding { findingId: string; runId: string; projectId: string; severity: 'error' | 'high' | 'warning' | 'info'; ruleCode: string; status: 'open' | 'resolved' | 'waived' | 'dismissed'; location: Record<string, unknown>; evidence: Array<Record<string, unknown>>; explanation: string; suggestion: string; createdAt: string }
export interface PhaseRagSearchResult { mode: 'fts' | 'hybrid'; degraded: boolean; degradationReason?: 'embedding-unconfigured'; hits: PhaseRagSearchHit[] }
export interface PhaseAuditResult { runId: string; findings: PhaseAuditFinding[] }
export interface Phase38Channels {
  'phase:rag-search': { args: [query: string, topK?: number, expectedProjectPath?: string]; return: PhaseRagSearchResult }
  'phase:audit-chapter': { args: [chapterNumber: number, content: string, expectedProjectPath?: string]; return: PhaseAuditResult }
  'phase:list-audit-findings': { args: [runId?: string, expectedProjectPath?: string]; return: PhaseAuditFinding[] }
  'phase:list-events': { args: [chapterNumber?: number, expectedProjectPath?: string]; return: StoryEventRecord[] }
  'phase:save-event': { args: [event: Omit<StoryEventRecord, 'eventId'> & { eventId?: string }, expectedProjectPath?: string]; return: StoryEventRecord }
}
