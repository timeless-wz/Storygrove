import type { StoryEntityType, StoryFactImpact, StoryFactVersion } from './story-domain'

export type StoryDataVersion = StoryFactVersion
export type StoryDataImpact = StoryFactImpact
export type StoryDataImpactType = StoryFactImpact['impactType']

export interface StoryDataApprovalResult {
  success: boolean
  idempotent?: boolean
  factId?: string
  versionId?: string
  version?: StoryDataVersion
  impacts?: StoryDataImpact[]
  error?: string
}

export interface StoryDataApprovalRequest {
  projectId: string
  candidateId: string
  approvedBy: string
}

export interface StoryDataImpactQuery {
  projectId: string
  factId?: string
  entityType?: StoryEntityType
}
