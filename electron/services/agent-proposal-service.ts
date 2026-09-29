import { getProjectDb } from '../database'

export interface AgentProposalSummary { proposalId: string; projectId: string; proposalType: string; status: 'pending' | 'approved' | 'rejected' | 'committed'; baseRevision: string; createdAt: string }
export interface AgentProposalReview extends AgentProposalSummary { payload: Record<string, unknown>; approvable: boolean }
export interface AgentProposalCommitReceipt {
  proposalId: string
  projectId: string
  resource: 'blueprint' | 'draft'
  chapterNumber?: number
  draftId?: number
  revision: string
  wordCount?: number
  committedAt: string
}
export interface AgentProposalCommitState {
  proposalId: string
  projectId: string
  proposalType: string
  status: AgentProposalSummary['status']
  /** The MCP session that owns this proposal; commits are impossible once it expires. */
  sessionExpiresAt: string | null
  /** Computed inside SQLite so the comparison shares its UTC clock. */
  sessionLive: boolean
  committedAt: string | null
  receipt: AgentProposalCommitReceipt | null
}

export function approveAgentProposal(projectId: string, proposalId: string, approvedBy: string): AgentProposalSummary {
  if (!projectId.trim() || !proposalId.trim() || !approvedBy.trim()) throw new Error('提案确认需要项目、提案和确认人')
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const proposal = db.prepare('SELECT proposal_type, session_id FROM agent_proposals WHERE proposal_id = ? AND project_id = ? AND status = ?')
    .get(proposalId, projectId, 'pending') as { proposal_type: string; session_id: string } | undefined
  if (!proposal) throw new Error('提案不存在、已处理或不属于当前项目')
  if (!['propose_blueprint_update', 'propose_draft_update'].includes(proposal.proposal_type)) {
    throw new Error('此提案类型尚不支持提交')
  }
  const liveSession = db.prepare("SELECT 1 FROM agent_sessions WHERE session_id = ? AND project_id = ? AND expires_at > datetime('now')")
    .get(proposal.session_id, projectId)
  if (!liveSession) throw new Error('提案会话已过期，请外部 Agent 重新提案')
  const result = db.prepare("UPDATE agent_proposals SET status = 'approved', reviewed_at = datetime('now'), approved_by = ? WHERE proposal_id = ? AND project_id = ? AND status = 'pending'").run(approvedBy.trim(), proposalId, projectId)
  if (result.changes !== 1) throw new Error('提案不存在、已处理或不属于当前项目')
  const row = db.prepare('SELECT proposal_id,project_id,proposal_type,status,base_revision,created_at FROM agent_proposals WHERE proposal_id = ? AND project_id = ?').get(proposalId, projectId) as Record<string, unknown>
  return { proposalId: String(row.proposal_id), projectId: String(row.project_id), proposalType: String(row.proposal_type), status: row.status as AgentProposalSummary['status'], baseRevision: String(row.base_revision), createdAt: String(row.created_at) }
}

export function rejectAgentProposal(projectId: string, proposalId: string): void {
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const result = db.prepare("UPDATE agent_proposals SET status = 'rejected', reviewed_at = datetime('now') WHERE proposal_id = ? AND project_id = ? AND status = 'pending'")
    .run(proposalId, projectId)
  if (result.changes !== 1) throw new Error('提案不存在、已处理或不属于当前项目')
}

export function listPendingAgentProposals(projectId: string): AgentProposalReview[] {
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const rows = db.prepare(`SELECT proposals.proposal_id, proposals.project_id, proposals.proposal_type, proposals.status,
    proposals.base_revision, proposals.payload_json, proposals.created_at,
    (sessions.expires_at > datetime('now')) AS approvable
    FROM agent_proposals proposals LEFT JOIN agent_sessions sessions ON sessions.session_id = proposals.session_id
    WHERE proposals.project_id = ? AND proposals.status = 'pending' ORDER BY proposals.created_at DESC`)
    .all(projectId) as Array<{ proposal_id: string; project_id: string; proposal_type: string; status: 'pending'; base_revision: string; payload_json: string; created_at: string; approvable: number | null }>
  return rows.map(row => ({
    proposalId: row.proposal_id,
    projectId: row.project_id,
    proposalType: row.proposal_type,
    status: row.status,
    baseRevision: row.base_revision,
    createdAt: row.created_at,
    approvable: row.approvable === 1,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  }))
}

export function getAgentProposalCommitState(projectId: string, proposalId: string): AgentProposalCommitState | null {
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const row = db.prepare(`
    SELECT proposals.proposal_id, proposals.proposal_type, proposals.status, proposals.committed_at,
      proposals.commit_receipt_json, sessions.expires_at AS session_expires_at,
      (sessions.expires_at > datetime('now')) AS session_live
    FROM agent_proposals proposals LEFT JOIN agent_sessions sessions ON sessions.session_id = proposals.session_id
    WHERE proposals.proposal_id = ? AND proposals.project_id = ?`)
    .get(proposalId, projectId) as {
      proposal_id: string; proposal_type: string; status: AgentProposalSummary['status'];
      committed_at: string | null; commit_receipt_json: string | null;
      session_expires_at: string | null; session_live: number | null
    } | undefined
  if (!row) return null
  let receipt: AgentProposalCommitReceipt | null = null
  if (row.commit_receipt_json) {
    const parsed = JSON.parse(row.commit_receipt_json) as Partial<AgentProposalCommitReceipt> & { resource?: string }
    receipt = {
      proposalId: row.proposal_id,
      projectId,
      resource: parsed.resource === 'draft' ? 'draft' : 'blueprint',
      ...(parsed.chapterNumber !== undefined ? { chapterNumber: parsed.chapterNumber } : {}),
      ...(parsed.draftId !== undefined ? { draftId: parsed.draftId } : {}),
      revision: String(parsed.revision ?? ''),
      ...(parsed.wordCount !== undefined ? { wordCount: parsed.wordCount } : {}),
      committedAt: row.committed_at ?? '',
    }
  }
  return {
    proposalId: row.proposal_id,
    projectId,
    proposalType: row.proposal_type,
    status: row.status,
    sessionExpiresAt: row.session_expires_at,
    sessionLive: row.session_live === 1,
    committedAt: row.committed_at,
    receipt,
  }
}

export function listAgentProposals(projectId: string, status?: AgentProposalSummary['status']): AgentProposalSummary[] {
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const rows = (status ? db.prepare('SELECT proposal_id,project_id,proposal_type,status,base_revision,created_at FROM agent_proposals WHERE project_id = ? AND status = ? ORDER BY created_at DESC').all(projectId, status) : db.prepare('SELECT proposal_id,project_id,proposal_type,status,base_revision,created_at FROM agent_proposals WHERE project_id = ? ORDER BY created_at DESC').all(projectId)) as Array<Record<string, unknown>>
  return rows.map(row => ({ proposalId: String(row.proposal_id), projectId: String(row.project_id), proposalType: String(row.proposal_type), status: row.status as AgentProposalSummary['status'], baseRevision: String(row.base_revision), createdAt: String(row.created_at) }))
}
