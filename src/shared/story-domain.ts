/**
 * 第二阶段故事资料管理中心的跨进程领域契约。
 *
 * 候选资料与正式资料是两条不同的生命周期：模型只能创建候选，
 * 作者确认后由仓库在事务中提交正式资料和版本。
 */

export const STORY_ENTITY_TYPES = [
  'character',
  'relationship',
  'world_rule',
  'place',
  'organization',
  'faction',
  'item',
  'civilization',
  'power_system',
  'timeline_event',
  'narrative_thread',
  'mystery',
  'foreshadowing',
  'outline',
] as const

export type StoryEntityType = typeof STORY_ENTITY_TYPES[number]

/** 正式资料只能处于这三种权威状态。 */
export const STORY_RECORD_STATUSES = ['confirmed', 'candidate', 'deprecated'] as const
export type StoryRecordStatus = typeof STORY_RECORD_STATUSES[number]

export type StoryCandidateReviewStatus = 'pending' | 'approved' | 'rejected'

export interface StoryProvenance {
  sourceId: string
  sourceSnapshotId: string
  sourceFragmentId: string
  sourceFile: string
  sourceHeadingPath: string
  startLine: number
  endLine: number
  contentHash: string
}

export interface StoryFactCandidateInput {
  projectId: string
  entityType: StoryEntityType
  canonicalName: string
  summary: string
  payload: Record<string, unknown>
  confidence: number
  provenance: StoryProvenance
  possibleConflicts?: readonly string[]
}

export interface StoryFactCandidate extends StoryFactCandidateInput {
  candidateId: string
  authorityStatus: 'candidate'
  reviewStatus: StoryCandidateReviewStatus
  createdAt: string
  actionedAt?: string
}

export interface StoryFact {
  factId: string
  projectId: string
  entityType: StoryEntityType
  canonicalName: string
  summary: string
  payload: Record<string, unknown>
  status: StoryRecordStatus
  confidence: number
  revision: number
  provenance: StoryProvenance
  createdAt: string
  updatedAt: string
  confirmedAt?: string
  confirmedBy?: string
}

export interface StoryFactVersion {
  versionId: string
  factId: string
  projectId: string
  version: number
  summary: string
  payload: Record<string, unknown>
  status: StoryRecordStatus
  changedBy: string
  provenance: StoryProvenance
  createdAt: string
}

export interface StoryFactVersionCommitInput {
  projectId: string
  factId: string
  summary: string
  payload: Record<string, unknown>
  status: StoryRecordStatus
  confidence: number
  provenance: StoryProvenance
  changedBy: string
}

export interface StoryFactRelationInput {
  projectId: string
  fromFactId: string
  toFactId: string
  relationType: string
  status?: StoryRecordStatus
  provenance: StoryProvenance
}

export interface StoryFactRelation extends StoryFactRelationInput {
  relationId: string
  status: StoryRecordStatus
  createdAt: string
}

export interface StoryFactImpactInput {
  projectId: string
  factId: string
  chapterNumber: number
  impactType: 'appears' | 'depends_on' | 'contradicts' | 'resolves' | 'mentions'
  narrativeLine?: string
}

export interface StoryFactImpact extends StoryFactImpactInput {
  impactId: string
  createdAt: string
}
