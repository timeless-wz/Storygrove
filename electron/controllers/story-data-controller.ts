import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { getCurrentProjectPath } from '../database'
import { StoryDomainRepository } from '../repositories/story-domain-repository'
import { StoryDataApprovalService } from '../services/story-data-approval-service'
import { StoryCandidatePersistenceService } from '../services/story-candidate-persistence-service'
import { extractFinalizedDraftFactCandidates } from '../services/finalized-fact-extraction-service'
import { markFactKnowledgeStale, scheduleKnowledgeIndexQueue, synchronizeConfirmedFactKnowledge } from '../services/rag-context-service'
import { readJsonFile, DEFAULT_GLOBAL_CONFIG, GLOBAL_CONFIG_PATH, MODELS_CONFIG_PATH } from '../utils/config-utils'
import type { GlobalConfig, ModelProfile } from '../../src/shared/ipc-channels'
import { approveAgentProposal, listPendingAgentProposals, rejectAgentProposal } from '../services/agent-proposal-service'
import { watchAgentProposalCommit } from '../services/agent-commit-watch-service'
import { projectAccess } from '../services/project-access'
import { assertRequiredExpectedProjectPath } from '../utils/project-context'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import type {
  StoryCandidateReviewStatus,
  StoryEntityType,
  StoryFactCandidateInput,
  StoryFactVersionCommitInput,
  StoryFactRelationInput,
  StoryRecordStatus,
} from '../../src/shared/story-domain'
import type { StoryChangeProposal } from '../../src/shared/story-candidate'
import type { StoryDataApprovalRequest } from '../../src/shared/story-data-approval'

const MUTATING_CHANNELS = new Set([
  'story-data:create-candidate',
  'story-data:extract-finalized-draft',
  'story-data:persist-proposal',
  'story-data:approve-candidate',
  'story-data:reject-candidate',
  'story-data:approve-agent-proposal',
  'story-data:reject-agent-proposal',
  'story-data:commit-fact-version',
  'story-data:add-relation',
])

type Handler = (event: IpcMainInvokeEvent, projectId: string, ...args: unknown[]) => unknown

function currentEmbeddingConfig() {
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const modelId = config.defaultEmbeddingModelId || config.defaultModelId
  if (!modelId) return undefined
  const model = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, []).find(candidate => candidate.id === modelId)
  if (!model || !model.baseUrl.trim() || !model.apiKey.trim() || (model.protocol !== 'openai' && model.protocol !== 'gemini')) return undefined
  return { protocol: model.protocol, model: { baseUrl: model.baseUrl, apiKey: model.apiKey, modelName: model.modelName, embeddingOptions: model.embeddingOptions } } as const
}

function registerHandler(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const candidate = args.at(-1)
    const context = isProjectSessionContext(candidate) ? candidate : undefined
    if (context) args.pop()
    const expectedPath = context?.projectPath
      ?? (typeof args.at(-1) === 'string' ? String(args.at(-1)) : undefined)
    try {
      const currentPath = getCurrentProjectPath()
      const session = projectAccess.assertCurrentProjectContext(context, currentPath)
      assertRequiredExpectedProjectPath(currentPath, expectedPath)
      const result = await handler(event, session.projectId, ...args)
      if (channel === 'story-data:approve-agent-proposal' && typeof (result as { proposalId?: unknown })?.proposalId === 'string') {
        // 作者批准后，外部 MCP 进程可能随时提交；主进程开始轮询回执并通知界面。
        watchAgentProposalCommit(String((result as { proposalId: string }).proposalId), session)
      }
      if (channel === 'story-data:approve-candidate' && !(typeof result === 'object' && result && 'success' in result && (result as { success?: unknown }).success === false)) {
        scheduleKnowledgeIndexQueue({ projectId: session.projectId, projectPath: session.rootPath, embedding: currentEmbeddingConfig() })
      }
      if (channel === 'story-data:commit-fact-version' && result && typeof result === 'object' && 'versionId' in result) {
        const input = args[0] as StoryFactVersionCommitInput
        const fact = StoryDomainRepository.getFact(session.projectId, input.factId)
        if (fact?.status === 'confirmed') synchronizeConfirmedFactKnowledge(fact, String((result as { versionId: unknown }).versionId))
        else markFactKnowledgeStale(session.projectId, input.factId)
        scheduleKnowledgeIndexQueue({ projectId: session.projectId, projectPath: session.rootPath, embedding: currentEmbeddingConfig() })
      }
      return result
    } catch (error) {
      if (MUTATING_CHANNELS.has(channel)) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      throw error
    }
  })
}

function optionalEntityType(value: unknown): StoryEntityType | undefined {
  const allowed = ['character', 'relationship', 'world_rule', 'place', 'organization', 'faction', 'item', 'civilization', 'power_system', 'timeline_event', 'narrative_thread', 'mystery', 'foreshadowing', 'outline']
  return allowed.includes(String(value)) ? String(value) as StoryEntityType : undefined
}

function optionalRecordStatus(value: unknown): StoryRecordStatus | undefined {
  return ['confirmed', 'candidate', 'deprecated'].includes(String(value))
    ? String(value) as StoryRecordStatus
    : undefined
}

function optionalReviewStatus(value: unknown): StoryCandidateReviewStatus | undefined {
  return ['pending', 'approved', 'rejected'].includes(String(value))
    ? String(value) as StoryCandidateReviewStatus
    : undefined
}

export function registerStoryDataController(): void {
  registerHandler('story-data:persist-proposal', (_event, projectId, ...args) => {
    const proposal = args[0] as StoryChangeProposal
    if (!proposal || proposal.projectId !== projectId) {
      return { success: false, error: '提案 projectId 与当前项目会话不一致' }
    }
    return StoryCandidatePersistenceService.persistProposal(projectId, proposal)
  })

  registerHandler('story-data:create-candidate', (_event, projectId, ...args) => {
    const input = args[0] as StoryFactCandidateInput
    if (!input || input.projectId !== projectId) {
      return { success: false, error: '候选资料 projectId 与当前项目会话不一致' }
    }
    return StoryDomainRepository.createCandidate(input)
  })

  registerHandler('story-data:extract-finalized-draft', (_event, projectId, ...args) => {
    return extractFinalizedDraftFactCandidates(projectId, Number(args[0]))
  })

  registerHandler('story-data:list-candidates', (_event, projectId, ...args) => {
    const entityType = optionalEntityType(args[0])
    const reviewStatus = optionalReviewStatus(args[1])
    return StoryDomainRepository.listCandidates(projectId, entityType)
      .filter(candidate => !reviewStatus || candidate.reviewStatus === reviewStatus)
  })

  registerHandler('story-data:list-facts', (_event, projectId, ...args) => {
    return StoryDomainRepository.listFacts(projectId, optionalRecordStatus(args[0]), optionalEntityType(args[1]))
  })

  registerHandler('story-data:list-versions', (_event, projectId, ...args) => {
    return StoryDomainRepository.listVersions(projectId, String(args[0] || ''))
  })

  registerHandler('story-data:commit-fact-version', (_event, projectId, ...args) => {
    const input = args[0] as StoryFactVersionCommitInput
    if (!input || input.projectId !== projectId) {
      return { success: false, error: '版本提交 projectId 与当前项目会话不一致' }
    }
    return StoryDomainRepository.commitFactVersion(input)
  })

  registerHandler('story-data:list-relations', (_event, projectId, ...args) => {
    return StoryDomainRepository.listRelations(projectId, args[0] ? String(args[0]) : undefined)
  })

  registerHandler('story-data:add-relation', (_event, projectId, ...args) => {
    const input = args[0] as StoryFactRelationInput
    if (!input || input.projectId !== projectId) {
      return { success: false, error: '关系提交 projectId 与当前项目会话不一致' }
    }
    return StoryDomainRepository.addRelation(input)
  })

  registerHandler('story-data:list-impacts', (_event, projectId, ...args) => {
    return StoryDataApprovalService.listImpacts(projectId, args[0] ? String(args[0]) : undefined)
  })

  registerHandler('story-data:approve-candidate', (_event, projectId, ...args) => {
    const request = args[0] as StoryDataApprovalRequest
    if (!request || request.projectId !== projectId) {
      return { success: false, error: '确认请求 projectId 与当前项目会话不一致' }
    }
    return StoryDataApprovalService.approve(request)
  })

  registerHandler('story-data:reject-candidate', (_event, projectId, ...args) => {
    return StoryDataApprovalService.reject(projectId, String(args[0] || ''))
  })

  registerHandler('story-data:approve-agent-proposal', (_event, projectId, ...args) => {
    const proposal = approveAgentProposal(projectId, String(args[0] || ''), String(args[1] || ''))
    return { success: true, proposalId: proposal.proposalId }
  })
  registerHandler('story-data:reject-agent-proposal', (_event, projectId, ...args) => {
    rejectAgentProposal(projectId, String(args[0] || ''))
    return { success: true }
  })
  registerHandler('story-data:list-agent-proposals', (_event, projectId) => listPendingAgentProposals(projectId))
}
