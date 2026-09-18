import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => Promise<unknown>
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  currentProjectPath: 'C:/projects/A',
  assertSession: vi.fn(),
  listCandidates: vi.fn(() => []),
  listFacts: vi.fn(() => []),
  listVersions: vi.fn(() => []),
  listRelations: vi.fn(() => []),
  listImpacts: vi.fn(() => []),
  createCandidate: vi.fn(() => ({ candidateId: 'candidate-1' })),
  approve: vi.fn(() => ({ success: true, factId: 'fact-1' })),
  reject: vi.fn(() => ({ success: true })),
  getFact: vi.fn(),
  commitFactVersion: vi.fn(),
  scheduleKnowledgeIndexQueue: vi.fn(),
  synchronizeConfirmedFactKnowledge: vi.fn(),
  markFactKnowledgeStale: vi.fn(),
}))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((channel: string, handler: Handler) => mocks.handlers.set(channel, handler)) } }))
vi.mock('../../database', () => ({ getCurrentProjectPath: () => mocks.currentProjectPath }))
vi.mock('../../services/project-access', () => ({ projectAccess: { assertCurrentProjectContext: mocks.assertSession } }))
vi.mock('../../repositories/story-domain-repository', () => ({ StoryDomainRepository: {
  createCandidate: mocks.createCandidate,
  listCandidates: mocks.listCandidates,
  listFacts: mocks.listFacts,
  listVersions: mocks.listVersions,
  listRelations: mocks.listRelations,
  getFact: mocks.getFact,
  commitFactVersion: mocks.commitFactVersion,
} }))
vi.mock('../../services/rag-context-service', () => ({
  scheduleKnowledgeIndexQueue: mocks.scheduleKnowledgeIndexQueue,
  synchronizeConfirmedFactKnowledge: mocks.synchronizeConfirmedFactKnowledge,
  markFactKnowledgeStale: mocks.markFactKnowledgeStale,
}))
vi.mock('../../services/story-data-approval-service', () => ({ StoryDataApprovalService: {
  listImpacts: mocks.listImpacts,
  approve: mocks.approve,
  reject: mocks.reject,
} }))

import { registerStoryDataController } from '../story-data-controller'

describe('story data controller project boundary', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
    mocks.assertSession.mockImplementation((context: unknown, currentPath: string) => {
      const session = context as { projectId?: string; projectPath?: string }
      if (!session?.projectId || session.projectPath !== currentPath) throw new Error('缺少或不匹配的项目会话')
      return { projectId: session.projectId, rootPath: currentPath, leaseId: 'lease' }
    })
    registerStoryDataController()
  })

  const session = { projectId: 'project-a', leaseId: 'lease-a', projectPath: 'C:/projects/A' }
  const handler = (name: string) => mocks.handlers.get(name)!

  it('fails closed for reads without a project session', async () => {
    await expect(handler('story-data:list-facts')({})).rejects.toThrow('缺少或不匹配')
  })

  it('scopes reads to the authenticated project', async () => {
    await handler('story-data:list-facts')({}, session)
    expect(mocks.listFacts).toHaveBeenCalledWith('project-a', undefined, undefined)
  })

  it('never accepts a candidate or approval request for another project', async () => {
    const candidateResult = await handler('story-data:create-candidate')({}, { projectId: 'project-b' }, session)
    expect(candidateResult).toEqual({ success: false, error: expect.stringContaining('projectId') })
    const approvalResult = await handler('story-data:approve-candidate')({}, { projectId: 'project-b', candidateId: 'c', approvedBy: 'author' }, session)
    expect(approvalResult).toEqual({ success: false, error: expect.stringContaining('projectId') })
  })

  it('requeues only author-confirmed fact versions and retires deprecated projections', async () => {
    mocks.commitFactVersion.mockReturnValue({ versionId: 'version-2' })
    mocks.getFact.mockReturnValue({ factId: 'fact-1', projectId: 'project-a', status: 'confirmed' })
    await handler('story-data:commit-fact-version')({}, { projectId: 'project-a', factId: 'fact-1' }, session)
    expect(mocks.synchronizeConfirmedFactKnowledge).toHaveBeenCalledWith(expect.objectContaining({ factId: 'fact-1' }), 'version-2')
    expect(mocks.scheduleKnowledgeIndexQueue).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-a', projectPath: 'C:/projects/A' }))

    mocks.getFact.mockReturnValue({ factId: 'fact-1', projectId: 'project-a', status: 'deprecated' })
    await handler('story-data:commit-fact-version')({}, { projectId: 'project-a', factId: 'fact-1' }, session)
    expect(mocks.markFactKnowledgeStale).toHaveBeenCalledWith('project-a', 'fact-1')
  })
})
