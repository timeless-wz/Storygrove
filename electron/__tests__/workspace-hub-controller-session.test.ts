import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  currentProjectPath: 'C:/projects/A',
  handlers: new Map<string, IpcHandler>(),
  assertCurrentProjectContext: vi.fn(),
  getStatus: vi.fn(() => ({
    externalWorkspacePath: 'C:/fake/novel',
    lastScannedAt: '2026-09-14',
    totalFiles: 5,
    recognizedFiles: 5,
    missingFiles: 0,
    changedFiles: 0,
    pendingCandidates: 0,
    confirmedRulesCount: 2,
  })),
  getBoundWorkspacePath: vi.fn(() => 'C:/fake/novel'),
  bindWorkspaceDirectory: vi.fn(),
  unbindWorkspaceDirectory: vi.fn(),
  listSources: vi.fn(() => []),
  getSourceDetail: vi.fn(() => ({ source: null, fragments: [] })),
  listRules: vi.fn(() => []),
  upsertRule: vi.fn(),
  updateRuleStatus: vi.fn(),
  deleteRule: vi.fn(),
  listCandidates: vi.fn(() => []),
  approveCandidate: vi.fn(() => ({ success: true })),
  rejectCandidate: vi.fn(() => ({ success: true })),
  saveChapterContextSnapshot: vi.fn(() => ({ success: true, snapshotId: 'snap-123' })),
  scanDirectory: vi.fn(async () => ({ success: true, scannedCount: 5, recognizedCount: 5 })),
  resolveGrant: vi.fn(() => ({ rootPath: 'C:/fake/novel', relativePath: '', rootIdentity: {}, scope: 'directory' })),
  issueGrant: vi.fn(() => ({ grantId: 'grant-valid-123', expiresAt: Date.now() + 600000 })),
  validateWorkspacePath: vi.fn(() => ({ valid: true, canonicalPath: 'C:/fake/novel' })),
  assemble: vi.fn(() => ({
    chapterNumber: 1,
    blocks: [],
    omissions: [],
    staleWarnings: [],
    candidateWarnings: [],
    excludedDeprecatedCount: 0,
    totalCharCount: 100,
    estimatedTokens: 75,
    fullAssembledText: 'context',
    isOverBudget: false,
    exceededChars: 0,
  })),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/fake/novel'] })),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../database', () => ({
  getCurrentProjectPath: () => mocks.currentProjectPath,
  getProjectDb: () => ({
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    })),
  }),
}))

vi.mock('../services/project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext: mocks.assertCurrentProjectContext,
  },
}))

vi.mock('../services/external-file-grant-service', () => ({
  externalFileGrants: {
    resolve: mocks.resolveGrant,
    issueDirectory: mocks.issueGrant,
  },
}))

vi.mock('../repositories/workspace-hub-repository', () => ({
  WorkspaceHubRepository: {
    getStatus: mocks.getStatus,
    getBoundWorkspacePath: mocks.getBoundWorkspacePath,
    bindWorkspaceDirectory: mocks.bindWorkspaceDirectory,
    unbindWorkspaceDirectory: mocks.unbindWorkspaceDirectory,
    listSources: mocks.listSources,
    getSourceDetail: mocks.getSourceDetail,
    listRules: mocks.listRules,
    upsertRule: mocks.upsertRule,
    updateRuleStatus: mocks.updateRuleStatus,
    deleteRule: mocks.deleteRule,
    listCandidates: mocks.listCandidates,
    approveCandidate: mocks.approveCandidate,
    rejectCandidate: mocks.rejectCandidate,
    saveChapterContextSnapshot: mocks.saveChapterContextSnapshot,
  },
}))

vi.mock('../services/workspace-scanner-service', () => ({
  validateWorkspacePath: mocks.validateWorkspacePath,
  WorkspaceScannerService: {
    validateWorkspacePath: mocks.validateWorkspacePath,
    scanDirectory: mocks.scanDirectory,
    registerScanTask: vi.fn(),
    cancelScanTask: vi.fn(() => true),
    cancelAllForProject: vi.fn(),
  },
}))

vi.mock('../services/chapter-context-assembler', () => ({
  ChapterContextAssembler: {
    assemble: mocks.assemble,
  },
}))

import { registerWorkspaceHubController } from '../controllers/workspace-hub-controller'

describe('Workspace Hub IPC Controller Project Session Isolation & Grant Flow', () => {
  beforeAll(() => {
    registerWorkspaceHubController()
  })

  beforeEach(() => {
    mocks.currentProjectPath = 'C:/projects/A'
    vi.clearAllMocks()

    mocks.assertCurrentProjectContext.mockImplementation((context, currentProjectPath) => {
      if (!context?.projectId || !context?.leaseId || !context?.projectPath) {
        throw new Error('缺少项目会话上下文，已拒绝操作')
      }
      if (context.projectPath !== currentProjectPath) {
        throw new Error('项目会话与当前数据库不匹配，已拒绝操作')
      }
      return { projectId: context.projectId, rootPath: currentProjectPath, leaseId: context.leaseId }
    })
  })

  function handler(channel: string): IpcHandler {
    const fn = mocks.handlers.get(channel)
    if (!fn) throw new Error(`Handler not registered: ${channel}`)
    return fn
  }

  const validSession = {
    projectId: 'proj-A',
    leaseId: 'lease-A',
    projectPath: 'C:/projects/A',
  }

  it('rejects read query workspace:get-status when session is missing', async () => {
    await expect(handler('workspace:get-status')({})).rejects.toThrow('缺少项目会话上下文，已拒绝操作')
  })

  it('rejects mutating workspace:bind-directory when session is missing and returns failure', async () => {
    const res = await handler('workspace:bind-directory')({}, 'grant-123')
    expect(res).toEqual({
      success: false,
      error: expect.stringContaining('缺少项目会话上下文'),
    })
  })

  it('rejects workspace:get-status when project session is switched to another project', async () => {
    const wrongSession = {
      projectId: 'proj-B',
      leaseId: 'lease-B',
      projectPath: 'C:/projects/B',
    }
    await expect(handler('workspace:get-status')({}, wrongSession)).rejects.toThrow('项目会话与当前数据库不匹配，已拒绝操作')
  })

  it('successfully executes workspace:get-status with valid project session', async () => {
    const res = await handler('workspace:get-status')({}, validSession)
    expect(res).toBeDefined()
    expect(mocks.getStatus).toHaveBeenCalledWith('proj-A')
  })

  it('issues grant via workspace:select-directory', async () => {
    const res = await handler('workspace:select-directory')({ sender: { id: 1 } }, validSession)
    expect(res).toEqual({
      grantId: 'grant-valid-123',
      displayName: 'novel',
    })
    expect(mocks.issueGrant).toHaveBeenCalled()
  })

  it('successfully resolves grant and binds directory via workspace:bind-directory', async () => {
    const res = await handler('workspace:bind-directory')({ sender: { id: 1 } }, 'grant-valid-123', validSession)
    expect(res).toEqual({
      success: true,
      scannedCount: 5,
      recognizedCount: 5,
    })
    expect(mocks.resolveGrant).toHaveBeenCalledWith({
      grantId: 'grant-valid-123',
      webContentsId: 1,
      operation: 'list',
    })
    expect(mocks.bindWorkspaceDirectory).toHaveBeenCalledWith('C:/fake/novel', 'proj-A')
  })

  it('rejects workspace:bind-directory when grant resolution throws (forged grant)', async () => {
    mocks.resolveGrant.mockImplementationOnce(() => {
      throw new Error('外部文件授权不存在或已失效')
    })
    const res = await handler('workspace:bind-directory')({ sender: { id: 1 } }, 'forged-grant', validSession)
    expect(res).toEqual({
      success: false,
      error: expect.stringContaining('外部文件授权不存在或已失效'),
    })
  })

  it('rescans strictly from bound database path via workspace:scan', async () => {
    const res = await handler('workspace:scan')({ sender: { id: 1 } }, validSession)
    expect(res).toEqual({
      success: true,
      scannedCount: 5,
      recognizedCount: 5,
    })
    expect(mocks.getBoundWorkspacePath).toHaveBeenCalledWith('proj-A')
    expect(mocks.scanDirectory).toHaveBeenCalledWith('C:/fake/novel', 'proj-A', expect.anything())
  })

  it('successfully executes workspace:save-chapter-context-snapshot and routes to repository snapshot method', async () => {
    const snapshot = {
      id: 'snap-1',
      projectId: 'proj-A',
      chapterNumber: 1,
      totalChars: 100,
      estimatedTokens: 75,
      bundleText: 'context bundle',
      sourcesJson: '[]',
      blocksJson: '[]',
      staleWarningsJson: '[]',
      candidateWarningsJson: '[]',
      omissionsJson: '[]',
      excludedDeprecatedCount: 0,
      isOverBudget: false,
    }
    const res = await handler('workspace:save-chapter-context-snapshot')({}, snapshot, validSession)
    expect(res).toEqual({
      success: true,
      snapshotId: 'snap-123',
    })
    expect(mocks.saveChapterContextSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'snap-1',
        projectId: 'proj-A',
        chapterNumber: 1,
      }),
    )
  })
})
