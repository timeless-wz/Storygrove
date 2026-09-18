/**
 * 第二阶段故事资料提取契约。
 *
 * 提取器只产生候选提案。候选记录本身永远以 pending 产出；作者审批和
 * 正式资料库提交由后续工作流负责，模型或提取器不得绕过该边界。
 */

export const STORY_CANDIDATE_TYPES = [
  'character',
  'relationship',
  'setting',
  'location',
  'organization',
  'faction',
  'item',
  'civilization',
  'ability',
  'event',
  'timeline_event',
  'narrative_thread',
  'mystery',
  'foreshadowing',
  'outline',
] as const

export type StoryCandidateType = typeof STORY_CANDIDATE_TYPES[number]
export type StoryProposalStatus = 'pending' | 'approved' | 'rejected'

export interface StoryCandidateSource {
  projectId: string
  sourceId: string
  snapshotId: string
  fragmentId: string
  relativePath: string
  headingPath: string
  startLine: number
  endLine: number
  fragmentHash: string
  /** Exact excerpt from the frozen fragment that supports this candidate. */
  evidence: string
  evidenceStartLine: number
  evidenceEndLine: number
  evidenceHash: string
}

export interface StoryCandidate {
  candidateId: string
  projectId: string
  candidateType: StoryCandidateType
  /** Stable display name, when one can be identified. */
  subject: string
  /** Structured but deliberately schema-light payload for the approval UI. */
  proposedData: Record<string, unknown>
  source: StoryCandidateSource
  confidence: number
  conflicts: string[]
  status: 'pending'
}

export interface StoryChangeProposal {
  proposalId: string
  projectId: string
  status: 'pending'
  candidates: StoryCandidate[]
  conflicts: string[]
  createdAt: string
}
