import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const handlers = new Map<string, IpcHandler>()

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
  },
}))

import {
  initProjectDatabase,
  closeProjectDatabase,
  getProjectDb,
} from '../database'
import { projectAccess } from '../services/project-access'
import { externalFileGrants } from '../services/external-file-grant-service'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { WorkspaceScannerService } from '../services/workspace-scanner-service'
import { registerWorkspaceHubController } from '../controllers/workspace-hub-controller'

describe('Workspace Hub Controller Real UUID Integration Tests', () => {
  const testDirs: string[] = []
  let parentDirectory: string
  let projectRoot: string
  let projectSession: { projectId: string; leaseId: string; projectPath: string }
  const mockSenderEvent = { sender: { id: 1 } }

  function createDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    testDirs.push(dir)
    return dir
  }

  function getCanonical(p: string): string {
    return fs.realpathSync.native(p)
  }

  function invokeHandler(channel: string, event: unknown, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`IPC Handler not registered for channel: ${channel}`)
    return handler(event, ...args)
  }

  beforeAll(() => {
    registerWorkspaceHubController()
  })

  beforeEach(() => {
    parentDirectory = createDir('ai-novel-hub-real-parent-')
    const project = projectAccess.createProject(parentDirectory, 'novel-integration')
    const lease = projectAccess.beginSession(project)
    projectRoot = lease.rootPath
    projectSession = {
      projectId: lease.projectId,
      leaseId: lease.leaseId,
      projectPath: lease.rootPath,
    }
    initProjectDatabase(projectRoot)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeProjectDatabase()
    for (const d of testDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true })
      } catch {
        // ignore cleanup error
      }
    }
    testDirs.length = 0
  })

  it('1. Initial bindDirectory can be cancelled mid-flight without polluting DB or leaving orphaned bindings', async () => {
    const dirA = createDir('ext-dir-a-')
    fs.writeFileSync(path.join(dirA, '01_设定.md'), '# 设定\n世界观设定内容\n', 'utf8')
    fs.writeFileSync(path.join(dirA, '02_角色.md'), '# 角色\n主角苏晨\n', 'utf8')

    const grant = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    // Hook readdir so that during the scan of dirA, cancelScan is triggered mid-flight
    let cancelTriggered = false
    const origReaddir = fs.promises.readdir
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
      const p = String(dir)
      if (p.includes(path.basename(dirA)) && !cancelTriggered) {
        cancelTriggered = true
        // Trigger real cancel-scan IPC handler with current project UUID session
        const cancelRes = (await invokeHandler('workspace:cancel-scan', mockSenderEvent, projectSession)) as { success: boolean }
        expect(cancelRes.success).toBe(true)
      }
      return (origReaddir as any)(dir, opts)
    })

    const bindResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grant.grantId,
      projectSession,
    )) as { success: boolean; error?: string }

    expect(bindResult.success).toBe(false)
    expect(bindResult.error).toBe('扫描已取消')

    // Verify DB state: no directory bound, no sources inserted
    const boundPath = WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)
    expect(boundPath).toBe('')

    const sources = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(sources).toEqual([])

    const db = getProjectDb()!
    const snapshots = db.prepare('SELECT count(*) as cnt FROM workspace_source_snapshots').get() as { cnt: number }
    expect(snapshots.cnt).toBe(0)
  })

  it('2. Rescan can be cancelled mid-flight without corrupting existing bound directory or approved sources', async () => {
    const dirA = createDir('ext-dir-rescan-')
    fs.writeFileSync(path.join(dirA, '01_设定.md'), '# 设定\n初始世界观设定内容\n', 'utf8')

    const grant = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    // First, complete the initial bind successfully
    const bindResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grant.grantId,
      projectSession,
    )) as { success: boolean }
    expect(bindResult.success).toBe(true)

    const initialSources = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(initialSources.length).toBe(1)
    const sourceId = initialSources[0].id

    // Approve the source
    const approveRes = (await invokeHandler(
      'workspace:approve-source',
      mockSenderEvent,
      sourceId,
      projectSession,
    )) as { success: boolean }
    expect(approveRes.success).toBe(true)

    // Now trigger rescan and cancel it mid-flight
    let cancelTriggered = false
    const origReaddir = fs.promises.readdir
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
      const p = String(dir)
      if (p.includes(path.basename(dirA)) && !cancelTriggered) {
        cancelTriggered = true
        const cancelRes = (await invokeHandler('workspace:cancel-scan', mockSenderEvent, projectSession)) as { success: boolean }
        expect(cancelRes.success).toBe(true)
      }
      return (origReaddir as any)(dir, opts)
    })

    const rescanResult = (await invokeHandler(
      'workspace:scan',
      mockSenderEvent,
      projectSession,
    )) as { success: boolean; error?: string }

    expect(rescanResult.success).toBe(false)
    expect(rescanResult.error).toBe('扫描已取消')

    // Verify DB state: bound directory is preserved, source remains healthy and approved
    const boundPath = WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)
    expect(boundPath).toBe(getCanonical(dirA))

    const sourcesAfter = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(sourcesAfter.length).toBe(1)
    expect(sourcesAfter[0].id).toBe(sourceId)
    expect(sourcesAfter[0].importStatus).toBe('imported')
    expect(sourcesAfter[0].isMissing).toBe(false)
  })

  it('3. When switching directory, a scan failure preserves previous directory binding and avoids hybrid state', async () => {
    // Phase 1: Bind Directory A successfully
    const dirA = createDir('ext-dir-switch-a-')
    fs.writeFileSync(path.join(dirA, 'fileA.md'), '# 目录A文件\n内容A\n', 'utf8')

    const grantA = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    const bindAResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grantA.grantId,
      projectSession,
    )) as { success: boolean }
    expect(bindAResult.success).toBe(true)

    const canonicalA = getCanonical(dirA)
    expect(WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)).toBe(canonicalA)
    const sourcesA = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(sourcesA.length).toBe(1)
    expect(sourcesA[0].relativePath).toBe('fileA.md')

    // Phase 2: Attempt to switch to Directory B, but Directory B scan fails at root readdir
    const dirB = createDir('ext-dir-switch-b-')
    fs.writeFileSync(path.join(dirB, 'fileB.md'), '# 目录B文件\n内容B\n', 'utf8')

    const grantB = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirB,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    const origReaddir = fs.promises.readdir
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
      const p = String(dir)
      if (p.includes(path.basename(dirB))) {
        throw new Error('EACCES: permission denied, scandir')
      }
      return (origReaddir as any)(dir, opts)
    })

    const bindBResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grantB.grantId,
      projectSession,
    )) as { success: boolean; error?: string }

    expect(bindBResult.success).toBe(false)
    expect(bindBResult.error).toContain('无法读取工作区根目录')

    // CRITICAL ASSERTION:
    // Bound path MUST STILL BE Directory A, NOT Directory B!
    const currentBound = WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)
    expect(currentBound).toBe(canonicalA)
    expect(currentBound).not.toBe(getCanonical(dirB))

    // Sources MUST still ONLY contain fileA, NEVER fileB, and fileA must not be marked missing!
    const currentSources = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(currentSources.length).toBe(1)
    expect(currentSources[0].relativePath).toBe('fileA.md')
    expect(currentSources[0].isMissing).toBe(false)
  })

  it('4. When switching directory, a scan cancellation preserves previous directory binding and avoids hybrid state', async () => {
    // Phase 1: Bind Directory A successfully
    const dirA = createDir('ext-dir-cancel-switch-a-')
    fs.writeFileSync(path.join(dirA, 'fileA.md'), '# 目录A文件\n内容A\n', 'utf8')

    const grantA = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    const bindAResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grantA.grantId,
      projectSession,
    )) as { success: boolean }
    expect(bindAResult.success).toBe(true)

    const canonicalA = getCanonical(dirA)
    expect(WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)).toBe(canonicalA)

    // Phase 2: Attempt to switch to Directory B, but cancel mid-flight
    const dirB = createDir('ext-dir-cancel-switch-b-')
    fs.writeFileSync(path.join(dirB, 'fileB.md'), '# 目录B文件\n内容B\n', 'utf8')

    const grantB = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirB,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    let cancelTriggered = false
    const origReaddir = fs.promises.readdir
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
      const p = String(dir)
      if (p.includes(path.basename(dirB)) && !cancelTriggered) {
        cancelTriggered = true
        const cancelRes = (await invokeHandler('workspace:cancel-scan', mockSenderEvent, projectSession)) as { success: boolean }
        expect(cancelRes.success).toBe(true)
      }
      return (origReaddir as any)(dir, opts)
    })

    const bindBResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grantB.grantId,
      projectSession,
    )) as { success: boolean; error?: string }

    expect(bindBResult.success).toBe(false)
    expect(bindBResult.error).toBe('扫描已取消')

    // CRITICAL ASSERTION:
    // Bound path MUST STILL BE Directory A, NOT Directory B!
    const currentBound = WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)
    expect(currentBound).toBe(canonicalA)
    expect(currentBound).not.toBe(getCanonical(dirB))

    // Sources MUST still ONLY contain fileA, NEVER fileB!
    const currentSources = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(currentSources.length).toBe(1)
    expect(currentSources[0].relativePath).toBe('fileA.md')
    expect(currentSources[0].isMissing).toBe(false)
  })

  it('5. Successful directory switch atomically replaces bound directory and updates sources', async () => {
    const dirA = createDir('ext-dir-clean-a-')
    fs.writeFileSync(path.join(dirA, 'fileA.md'), '# 目录A文件\n内容A\n', 'utf8')

    const grantA = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    await invokeHandler('workspace:bind-directory', mockSenderEvent, grantA.grantId, projectSession)
    expect(WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)).toBe(getCanonical(dirA))

    // Now switch to Directory B cleanly
    const dirB = createDir('ext-dir-clean-b-')
    fs.writeFileSync(path.join(dirB, 'fileB.md'), '# 目录B文件\n内容B\n', 'utf8')

    const grantB = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirB,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    const switchResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grantB.grantId,
      projectSession,
    )) as { success: boolean }
    expect(switchResult.success).toBe(true)

    // Verification: Now bound to dirB
    expect(WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)).toBe(getCanonical(dirB))

    const sourcesAfter = WorkspaceHubRepository.listSources(projectSession.projectId)
    const fileBSource = sourcesAfter.find(s => s.relativePath === 'fileB.md')
    expect(fileBSource).toBeDefined()
    expect(fileBSource?.isMissing).toBe(false)
  })

  it('6. Blocks second bind, rescan, unbind, and select-directory while cancellation is resolving before scan Promise ends', async () => {
    const dirA = createDir('ext-dir-block-a-')
    fs.writeFileSync(path.join(dirA, 'fileA.md'), '# 文件A\n内容A\n', 'utf8')

    const grantA = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    let releaseReaddir!: () => void
    const pausePromise = new Promise<void>(resolve => { releaseReaddir = resolve })

    const origReaddir = fs.promises.readdir
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
      const p = String(dir)
      if (p.includes(path.basename(dirA))) {
        // Pause scan execution to deterministically simulate in-flight scan
        await pausePromise
      }
      return (origReaddir as any)(dir, opts)
    })

    // Start bind-directory (will pause inside readdir)
    const bindPromise = invokeHandler('workspace:bind-directory', mockSenderEvent, grantA.grantId, projectSession)

    // Trigger cancel-scan IPC handler: should return true
    const cancelRes = (await invokeHandler('workspace:cancel-scan', mockSenderEvent, projectSession)) as { success: boolean }
    expect(cancelRes.success).toBe(true)

    // While original scan Promise is STILL pending:
    // 1. Attempt second bind-directory: MUST be rejected
    const secondBind = (await invokeHandler('workspace:bind-directory', mockSenderEvent, grantA.grantId, projectSession)) as { success: boolean; error?: string }
    expect(secondBind.success).toBe(false)
    expect(secondBind.error).toContain('正在进行或正在取消')

    // 2. Attempt rescan: MUST be rejected
    const secondRescan = (await invokeHandler('workspace:scan', mockSenderEvent, projectSession)) as { success: boolean; error?: string }
    expect(secondRescan.success).toBe(false)
    expect(secondRescan.error).toContain('正在进行或正在取消')

    // 3. Attempt unbind: MUST be rejected
    const secondUnbind = (await invokeHandler('workspace:unbind-directory', mockSenderEvent, projectSession)) as { success: boolean; error?: string }
    expect(secondUnbind.success).toBe(false)
    expect(secondUnbind.error).toContain('正在进行或正在取消')

    // 4. Attempt select-directory: MUST be rejected
    await expect(invokeHandler('workspace:select-directory', mockSenderEvent, projectSession)).rejects.toThrow('正在进行或正在取消')

    // Now release the paused scan
    releaseReaddir()

    // Original scan terminates with cancelled result
    const bindResult = (await bindPromise) as { success: boolean; error?: string }
    expect(bindResult.success).toBe(false)
    expect(bindResult.error).toBe('扫描已取消')

    // After original scan completely settles, lifecycle is released and subsequent operations succeed
    const unbindAfter = (await invokeHandler('workspace:unbind-directory', mockSenderEvent, projectSession)) as { success: boolean }
    expect(unbindAfter.success).toBe(true)
  })

  it('7. When the post-commit bind confirmation fails, compensation restores the previous directory and never leaves hybrid state', async () => {
    // Phase 1: Bind Directory A successfully
    const dirA = createDir('ext-dir-comp-a-')
    fs.writeFileSync(path.join(dirA, 'fileA.md'), '# 目录A文件\n内容A\n', 'utf8')

    const grantA = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    await invokeHandler('workspace:bind-directory', mockSenderEvent, grantA.grantId, projectSession)
    const canonicalA = getCanonical(dirA)
    expect(WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)).toBe(canonicalA)
    const sourcesA = WorkspaceHubRepository.listSources(projectSession.projectId)
    expect(sourcesA.length).toBe(1)
    const sourceAId = sourcesA[0].id
    expect(sourcesA[0].relativePath).toBe('fileA.md')

    // Phase 2: Switch to Directory B. The scan snapshot transaction (including its own
    // atomic autoBindPath) MUST commit successfully; only the controller's subsequent
    // explicit bind confirmation fails, which is what triggers the compensation path.
    const dirB = createDir('ext-dir-comp-b-')
    fs.writeFileSync(path.join(dirB, 'fileB.md'), '# 目录B文件\n内容B\n', 'utf8')

    const grantB = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirB,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    const origBind = WorkspaceHubRepository.bindWorkspaceDirectory
    let bindCallCount = 0
    let directoryBBindAttempts = 0
    const committedBindPaths: string[] = []
    vi.spyOn(WorkspaceHubRepository, 'bindWorkspaceDirectory').mockImplementation((extPath, projId) => {
      bindCallCount += 1
      committedBindPaths.push(extPath)
      if (extPath === getCanonical(dirB)) {
        directoryBBindAttempts += 1
        // Attempt #1 is the atomic autoBindPath inside the scan transaction: it MUST succeed,
        // so the scan snapshot (and B's sources) are genuinely committed before compensation.
        if (directoryBBindAttempts === 1) {
          return origBind(extPath, projId)
        }
        // Attempt #2 is the controller's post-commit bind confirmation: it fails here.
        throw new Error('Simulated database constraint failure on directory bind')
      }
      // Compensation re-binding the previous directory must be allowed to succeed.
      return origBind(extPath, projId)
    })

    const bindBResult = (await invokeHandler(
      'workspace:bind-directory',
      mockSenderEvent,
      grantB.grantId,
      projectSession,
    )) as { success: boolean; error?: string }

    expect(bindBResult.success).toBe(false)
    expect(bindBResult.error).toContain('Simulated database constraint failure')
    // Proves the failure happened AFTER the transactional bind, not inside it.
    expect(directoryBBindAttempts).toBeGreaterThanOrEqual(2)
    expect(committedBindPaths[0]).toBe(getCanonical(dirB))

    // CRITICAL ASSERTIONS: no Directory B binding, no A/B hybrid state.
    const boundAfterFailure = WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)
    expect(boundAfterFailure).not.toBe(getCanonical(dirB))
    expect(boundAfterFailure).toBe(canonicalA)

    // Directory A binding and sources must remain healthy.
    const sourcesAfterFailure = WorkspaceHubRepository.listSources(projectSession.projectId)
    const fileASource = sourcesAfterFailure.find(s => s.id === sourceAId)
    expect(fileASource).toBeDefined()
    expect(fileASource?.relativePath).toBe('fileA.md')
    expect(fileASource?.isMissing).toBe(false)
    expect(fileASource?.importStatus).not.toBe('missing')

    // Directory B must not contribute any effective (healthy) source.
    const effectiveSources = sourcesAfterFailure.filter(s => !s.isMissing && s.importStatus !== 'missing')
    expect(effectiveSources.map(s => s.relativePath)).toEqual(['fileA.md'])
    const fileBSource = sourcesAfterFailure.find(s => s.relativePath === 'fileB.md')
    if (fileBSource) {
      expect(fileBSource.isMissing).toBe(true)
      expect(fileBSource.importStatus).toBe('missing')
    }
  })

  it('8. Compensation scan is cancellable and holds the lifecycle lock until it fully exits', async () => {
    // Phase 1: Bind Directory A successfully
    const dirA = createDir('ext-dir-cancel-comp-a-')
    fs.writeFileSync(path.join(dirA, 'fileA.md'), '# 目录A文件\n内容A\n', 'utf8')

    const grantA = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirA,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })
    await invokeHandler('workspace:bind-directory', mockSenderEvent, grantA.grantId, projectSession)
    const canonicalA = getCanonical(dirA)
    expect(WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)).toBe(canonicalA)

    // Phase 2: Directory B scan commits (atomic autoBind succeeds), controller bind confirmation fails.
    const dirB = createDir('ext-dir-cancel-comp-b-')
    fs.writeFileSync(path.join(dirB, 'fileB.md'), '# 目录B文件\n内容B\n', 'utf8')

    const grantB = externalFileGrants.issueDirectory({
      webContentsId: 1,
      directoryPath: dirB,
      operations: ['list', 'read'],
      ttlMs: 600_000,
      maxUses: 10,
    })

    const origBind = WorkspaceHubRepository.bindWorkspaceDirectory
    let directoryBBindAttempts = 0
    vi.spyOn(WorkspaceHubRepository, 'bindWorkspaceDirectory').mockImplementation((extPath, projId) => {
      if (extPath === getCanonical(dirB)) {
        directoryBBindAttempts += 1
        // Transactional autoBind for B succeeds; the controller's post-commit confirmation fails.
        if (directoryBBindAttempts === 1) return origBind(extPath, projId)
        throw new Error('Simulated bind confirmation failure')
      }
      return origBind(extPath, projId)
    })

    // Pause the compensation scan of Directory A so we can deterministically act mid-compensation.
    let releaseCompensationScan!: () => void
    const compensationPaused = new Promise<void>(resolve => { releaseCompensationScan = resolve })
    let compensationScanStarted = false
    let compensationReaddirCalls = 0

    const origReaddir = fs.promises.readdir
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
      const p = String(dir)
      // The original successful scan of A already ran before the switch, so any readdir of A
      // from here on belongs to the compensation scan.
      if (p.includes(path.basename(dirA))) {
        compensationReaddirCalls += 1
        compensationScanStarted = true
        await compensationPaused
      }
      return (origReaddir as any)(dir, opts)
    })

    // Commit-phase marker: an aborted scan must never reach the transactional commit.
    const origCommit = WorkspaceHubRepository.commitScanPayload
    let commitCalls = 0
    vi.spyOn(WorkspaceHubRepository, 'commitScanPayload').mockImplementation(payload => {
      commitCalls += 1
      return origCommit(payload)
    })

    // The compensation scan must register its own cancellable lifecycle task so that
    // workspace:cancel-scan can actually reach and abort it.
    const origRegisterTask = WorkspaceScannerService.registerScanTask.bind(WorkspaceScannerService)
    const registeredTaskIds: string[] = []
    vi.spyOn(WorkspaceScannerService, 'registerScanTask').mockImplementation((taskId, projectId, controller, promise) => {
      registeredTaskIds.push(taskId)
      return origRegisterTask(taskId, projectId, controller, promise)
    })
    const cancelledTaskIds: string[] = []
    const origCancelTask = WorkspaceScannerService.cancelScanTask.bind(WorkspaceScannerService)
    vi.spyOn(WorkspaceScannerService, 'cancelScanTask').mockImplementation(taskId => {
      cancelledTaskIds.push(taskId)
      return origCancelTask(taskId)
    })
    const cleanedUpTaskIds: string[] = []
    const origCleanupTask = WorkspaceScannerService.cleanupScanTask.bind(WorkspaceScannerService)
    vi.spyOn(WorkspaceScannerService, 'cleanupScanTask').mockImplementation(taskId => {
      cleanedUpTaskIds.push(taskId)
      return origCleanupTask(taskId)
    })

    const bindBPromise = invokeHandler('workspace:bind-directory', mockSenderEvent, grantB.grantId, projectSession)

    // Wait until the compensation scan is genuinely in flight.
    while (!compensationScanStarted) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(compensationScanStarted).toBe(true)
    const commitsBeforeCancel = commitCalls
    // A separate lifecycle task exists for the compensation scan, distinct from the original scan.
    expect(registeredTaskIds.length).toBe(2)
    expect(registeredTaskIds[1]).not.toBe(registeredTaskIds[0])

    // While compensation is running the lifecycle lock MUST still reject every mutating channel.
    const blockedBind = (await invokeHandler('workspace:bind-directory', mockSenderEvent, grantA.grantId, projectSession)) as { success: boolean; error?: string }
    expect(blockedBind.success).toBe(false)
    expect(blockedBind.error).toContain('正在进行或正在取消')

    const blockedScan = (await invokeHandler('workspace:scan', mockSenderEvent, projectSession)) as { success: boolean; error?: string }
    expect(blockedScan.success).toBe(false)
    expect(blockedScan.error).toContain('正在进行或正在取消')

    const blockedUnbind = (await invokeHandler('workspace:unbind-directory', mockSenderEvent, projectSession)) as { success: boolean; error?: string }
    expect(blockedUnbind.success).toBe(false)
    expect(blockedUnbind.error).toContain('正在进行或正在取消')

    await expect(invokeHandler('workspace:select-directory', mockSenderEvent, projectSession)).rejects.toThrow('正在进行或正在取消')

    // Cancel during compensation: the compensation scan itself must actually abort.
    const cancelRes = (await invokeHandler('workspace:cancel-scan', mockSenderEvent, projectSession)) as { success: boolean }
    expect(cancelRes.success).toBe(true)

    // Release the paused readdir so the aborted compensation scan can unwind for real.
    releaseCompensationScan()

    const bindBResult = (await bindBPromise) as { success: boolean; error?: string }
    expect(bindBResult.success).toBe(false)
    expect(bindBResult.error).toContain('Simulated bind confirmation failure')
    // The compensation scan really stopped: its enumeration began but the aborted scan never
    // reached the transactional commit phase, so nothing was written back.
    expect(compensationReaddirCalls).toBe(1)
    expect(commitCalls).toBe(commitsBeforeCancel)
    // The compensation lifecycle task was registered separately and then cleaned up on exit,
    // so no orphaned cancellable task survives the cancelled compensation.
    expect(cleanedUpTaskIds).toContain(registeredTaskIds[1])
    expect(registeredTaskIds[1]).not.toBe(registeredTaskIds[0])

    // Database must remain consistent: no Directory B binding and no hybrid effective sources.
    const finalBound = WorkspaceHubRepository.getBoundWorkspacePath(projectSession.projectId)
    expect(finalBound).toBe('')
    expect(finalBound).not.toBe(getCanonical(dirB))

    const finalSources = WorkspaceHubRepository.listSources(projectSession.projectId)
    const effectiveFinal = finalSources.filter(s => !s.isMissing && s.importStatus !== 'missing')
    if (finalBound === '') {
      expect(finalSources).toEqual([])
    } else {
      expect(finalBound).toBe(canonicalA)
      expect(effectiveFinal.map(s => s.relativePath)).toEqual(['fileA.md'])
    }

    // Lifecycle lock must be released after the aborted compensation fully exits.
    const unbindAfter = (await invokeHandler('workspace:unbind-directory', mockSenderEvent, projectSession)) as { success: boolean }
    expect(unbindAfter.success).toBe(true)
  })
})
