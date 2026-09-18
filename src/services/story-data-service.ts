import { ipc } from './ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  StoryCandidateReviewStatus,
  StoryEntityType,
  StoryFact,
  StoryFactCandidate,
  StoryFactCandidateInput,
  StoryFactImpact,
  StoryFactRelation,
  StoryFactRelationInput,
  StoryFactVersion,
  StoryFactVersionCommitInput,
  StoryRecordStatus,
} from '../shared/story-domain'
import type { StoryDataApprovalRequest, StoryDataApprovalResult } from '../shared/story-data-approval'
import type { StoryChangeProposal } from '../shared/story-candidate'

export const storyDataService = {
  persistProposal(session: ProjectSessionContext, proposal: StoryChangeProposal) {
    return ipc.invokeWithProjectSession(session, 'story-data:persist-proposal', proposal, session.projectPath)
  },
  createCandidate(session: ProjectSessionContext, input: StoryFactCandidateInput) {
    return ipc.invokeWithProjectSession(session, 'story-data:create-candidate', input, session.projectPath)
  },
  extractFinalizedDraft(session: ProjectSessionContext, draftId: number) {
    return ipc.invokeWithProjectSession(session, 'story-data:extract-finalized-draft', draftId, session.projectPath)
  },
  listCandidates(session: ProjectSessionContext, entityType?: StoryEntityType, reviewStatus?: StoryCandidateReviewStatus) {
    return ipc.invokeWithProjectSession(session, 'story-data:list-candidates', entityType, reviewStatus, session.projectPath)
  },
  listFacts(session: ProjectSessionContext, status?: StoryRecordStatus, entityType?: StoryEntityType) {
    return ipc.invokeWithProjectSession(session, 'story-data:list-facts', status, entityType, session.projectPath)
  },
  listVersions(session: ProjectSessionContext, factId: string): Promise<StoryFactVersion[]> {
    return ipc.invokeWithProjectSession(session, 'story-data:list-versions', factId, session.projectPath)
  },
  commitFactVersion(session: ProjectSessionContext, input: StoryFactVersionCommitInput) {
    return ipc.invokeWithProjectSession(session, 'story-data:commit-fact-version', input, session.projectPath)
  },
  listRelations(session: ProjectSessionContext, factId?: string): Promise<StoryFactRelation[]> {
    return ipc.invokeWithProjectSession(session, 'story-data:list-relations', factId, session.projectPath)
  },
  addRelation(session: ProjectSessionContext, input: StoryFactRelationInput) {
    return ipc.invokeWithProjectSession(session, 'story-data:add-relation', input, session.projectPath)
  },
  listImpacts(session: ProjectSessionContext, factId?: string): Promise<StoryFactImpact[]> {
    return ipc.invokeWithProjectSession(session, 'story-data:list-impacts', factId, session.projectPath)
  },
  approveCandidate(session: ProjectSessionContext, request: StoryDataApprovalRequest): Promise<StoryDataApprovalResult> {
    return ipc.invokeWithProjectSession(session, 'story-data:approve-candidate', request, session.projectPath)
  },
  rejectCandidate(session: ProjectSessionContext, candidateId: string) {
    return ipc.invokeWithProjectSession(session, 'story-data:reject-candidate', candidateId, session.projectPath)
  },
  approveAgentProposal(session: ProjectSessionContext, proposalId: string, approvedBy: string) {
    return ipc.invokeWithProjectSession(session, 'story-data:approve-agent-proposal', proposalId, approvedBy, session.projectPath)
  },
}

export type StoryDataServiceFact = StoryFact
export type StoryDataServiceCandidate = StoryFactCandidate
