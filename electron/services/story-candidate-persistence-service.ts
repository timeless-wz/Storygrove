import { StoryDomainRepository } from '../repositories/story-domain-repository'
import type { StoryChangeProposal, StoryCandidate, StoryCandidateType } from '../../src/shared/story-candidate'
import type { StoryEntityType, StoryFactCandidate } from '../../src/shared/story-domain'

const typeMap: Record<StoryCandidateType, StoryEntityType> = {
  character: 'character', relationship: 'relationship', setting: 'world_rule', location: 'place',
  organization: 'organization', faction: 'faction', item: 'item', civilization: 'civilization',
  ability: 'power_system', event: 'timeline_event', timeline_event: 'timeline_event',
  narrative_thread: 'narrative_thread', mystery: 'mystery', foreshadowing: 'foreshadowing', outline: 'outline',
}

function requiredProjectId(projectId: string): string {
  const normalized = projectId.trim()
  if (!normalized) throw new Error('必须提供显式 projectId')
  return normalized
}

function provenance(candidate: StoryCandidate) {
  return {
    sourceId: candidate.source.sourceId,
    sourceSnapshotId: candidate.source.snapshotId,
    sourceFragmentId: candidate.source.fragmentId,
    sourceFile: candidate.source.relativePath,
    sourceHeadingPath: candidate.source.headingPath,
    startLine: candidate.source.startLine,
    endLine: candidate.source.endLine,
    contentHash: candidate.source.fragmentHash,
  }
}

function persistOne(projectId: string, candidate: StoryCandidate): StoryFactCandidate {
  if (candidate.projectId !== projectId) throw new Error('候选提案 projectId 与当前项目会话不一致')
  const canonicalName = candidate.subject.trim()
  if (!canonicalName) throw new Error('候选提案缺少资料名称')
  const existing = StoryDomainRepository.listCandidates(projectId, typeMap[candidate.candidateType])
    .find(item => item.canonicalName === canonicalName
      && item.provenance.sourceFragmentId === candidate.source.fragmentId
      && item.provenance.contentHash === candidate.source.fragmentHash)
  if (existing) return existing
  return StoryDomainRepository.createCandidate({
    projectId,
    entityType: typeMap[candidate.candidateType],
    canonicalName,
    summary: candidate.source.evidence,
    payload: candidate.proposedData,
    confidence: candidate.confidence,
    provenance: provenance(candidate),
    possibleConflicts: candidate.conflicts,
  })
}

export class StoryCandidatePersistenceService {
  static persistProposal(projectId: string, proposal: StoryChangeProposal): StoryFactCandidate[] {
    const normalizedProject = requiredProjectId(projectId)
    if (proposal.projectId !== normalizedProject) throw new Error('提案 projectId 与当前项目会话不一致')
    if (proposal.status !== 'pending') throw new Error('只能持久化 pending 提案')
    return proposal.candidates.map(candidate => persistOne(normalizedProject, candidate))
  }
}
