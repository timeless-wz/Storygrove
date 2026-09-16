import { getProjectDb } from '../database'

export interface AgentProposalSummary { proposalId: string; projectId: string; proposalType: string; status: 'pending' | 'approved' | 'rejected' | 'committed'; baseRevision: string; createdAt: string }

export function approveAgentProposal(projectId: string, proposalId: string, approvedBy: string): AgentProposalSummary {
  if (!projectId.trim() || !proposalId.trim() || !approvedBy.trim()) throw new Error('提案确认需要项目、提案和确认人')
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const result = db.prepare("UPDATE agent_proposals SET status = 'approved', reviewed_at = datetime('now'), approved_by = ? WHERE proposal_id = ? AND project_id = ? AND status = 'pending'").run(approvedBy.trim(), proposalId, projectId)
  if (result.changes !== 1) throw new Error('提案不存在、已处理或不属于当前项目')
  const row = db.prepare('SELECT proposal_id,project_id,proposal_type,status,base_revision,created_at FROM agent_proposals WHERE proposal_id = ? AND project_id = ?').get(proposalId, projectId) as Record<string, unknown>
  return { proposalId: String(row.proposal_id), projectId: String(row.project_id), proposalType: String(row.proposal_type), status: row.status as AgentProposalSummary['status'], baseRevision: String(row.base_revision), createdAt: String(row.created_at) }
}

export function listAgentProposals(projectId: string, status?: AgentProposalSummary['status']): AgentProposalSummary[] {
  const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开')
  const rows = (status ? db.prepare('SELECT proposal_id,project_id,proposal_type,status,base_revision,created_at FROM agent_proposals WHERE project_id = ? AND status = ? ORDER BY created_at DESC').all(projectId, status) : db.prepare('SELECT proposal_id,project_id,proposal_type,status,base_revision,created_at FROM agent_proposals WHERE project_id = ? ORDER BY created_at DESC').all(projectId)) as Array<Record<string, unknown>>
  return rows.map(row => ({ proposalId: String(row.proposal_id), projectId: String(row.project_id), proposalType: String(row.proposal_type), status: row.status as AgentProposalSummary['status'], baseRevision: String(row.base_revision), createdAt: String(row.created_at) }))
}
