import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useWorkspaceHubStore } from '../workspace-hub-store'
import { workspaceHubService } from '../../services/workspace-hub-service'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ChapterContextBundle, WorkspaceScanResult } from '../../shared/workspace-hub'

const TEST_SESSION = {
  projectId: 'main',
  leaseId: 'lease-1',
  projectPath: '/test/path',
}

vi.mock('../../services/workspace-hub-service', () => ({
  workspaceHubService: {
    getStatus: vi.fn(),
    selectDirectory: vi.fn(),
    bindDirectory: vi.fn(),
    unbindDirectory: vi.fn(),
    rescan: vi.fn(),
    cancelScan: vi.fn(),
    approveSource: vi.fn(),
    approveAllSources: vi.fn(),
    listSources: vi.fn(),
    getSourceDetail: vi.fn(),
    listRules: vi.fn(),
    upsertRule: vi.fn(),
    updateRuleStatus: vi.fn(),
    deleteRule: vi.fn(),
    listCandidates: vi.fn(),
    actionCandidate: vi.fn(),
    assembleChapterContext: vi.fn(),
    saveChapterContextSnapshot: vi.fn(),
  },
}))

describe('workspaceHubStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActiveProjectSessionContext(TEST_SESSION)
    useWorkspaceHubStore.getState().reset()
    useWorkspaceHubStore.setState({
      budgetChars: 16000,
      targetChapterNumber: 1,
      includeCandidates: false,
      activeTab: 'sources',
      ruleFilterStatus: 'all',
      candidateFilterStatus: 'all',
    })
  })

  it('initializes with default hub state and candidate preview disabled by default', () => {
    const state = useWorkspaceHubStore.getState()
    expect(state.activeTab).toBe('sources')
    expect(state.ruleFilterStatus).toBe('all')
    expect(state.candidateFilterStatus).toBe('all')
    expect(state.budgetChars).toBe(16000)
    expect(state.targetChapterNumber).toBe(1)
    expect(state.includeCandidates).toBe(false)
    expect(state.sources).toEqual([])
    expect(state.rules).toEqual([])
    expect(state.candidates).toEqual([])
    expect(state.chapterContextBundle).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('updates tabs, filter statuses and candidate toggle', () => {
    const store = useWorkspaceHubStore.getState()

    store.setActiveTab('rules')
    expect(useWorkspaceHubStore.getState().activeTab).toBe('rules')

    store.setActiveTab('context')
    expect(useWorkspaceHubStore.getState().activeTab).toBe('context')

    store.setRuleFilterStatus('confirmed')
    expect(useWorkspaceHubStore.getState().ruleFilterStatus).toBe('confirmed')

    store.setCandidateFilterStatus('approved')
    expect(useWorkspaceHubStore.getState().candidateFilterStatus).toBe('approved')

    store.setIncludeCandidates(true)
    expect(useWorkspaceHubStore.getState().includeCandidates).toBe(true)
  })

  it('clamps target chapter number to minimum 1 and budget chars to minimum 1000', () => {
    const store = useWorkspaceHubStore.getState()

    store.setTargetChapterNumber(-5)
    expect(useWorkspaceHubStore.getState().targetChapterNumber).toBe(1)

    store.setTargetChapterNumber(42)
    expect(useWorkspaceHubStore.getState().targetChapterNumber).toBe(42)

    store.setBudgetChars(500)
    expect(useWorkspaceHubStore.getState().budgetChars).toBe(1000)

    store.setBudgetChars(20000)
    expect(useWorkspaceHubStore.getState().budgetChars).toBe(20000)
  })

  it('calls assembleChapterContext with default includeCandidates false', async () => {
    const fakeBundle = {
      projectId: 'main',
      chapterNumber: 3,
      totalCharCount: 500,
      estimatedTokens: 375,
      blocks: [],
      fullAssembledText: '## 创作总则\n测试',
      omissions: [],
      staleWarnings: [],
      candidateWarnings: [],
      excludedDeprecatedCount: 0,
      isOverBudget: false,
      exceededChars: 0,
    }
    vi.mocked(workspaceHubService.assembleChapterContext).mockResolvedValue(fakeBundle as unknown as ChapterContextBundle)

    const store = useWorkspaceHubStore.getState()
    await store.assembleChapterContext(3)

    expect(workspaceHubService.assembleChapterContext).toHaveBeenCalledWith(TEST_SESSION, 3, 16000, false)
    expect(useWorkspaceHubStore.getState().chapterContextBundle).toEqual(fakeBundle)
    expect(useWorkspaceHubStore.getState().loading).toBe(false)
  })

  it('approves a candidate and triggers full refresh', async () => {
    vi.mocked(workspaceHubService.actionCandidate).mockResolvedValue({ success: true })
    vi.mocked(workspaceHubService.getStatus).mockResolvedValue({
      externalWorkspacePath: '/test/novel',
      lastScannedAt: 'now',
      totalFiles: 5,
      recognizedFiles: 4,
      missingFiles: 0,
      changedFiles: 0,
      pendingCandidates: 2,
      confirmedRulesCount: 3,
    })
    vi.mocked(workspaceHubService.listSources).mockResolvedValue([])
    vi.mocked(workspaceHubService.listRules).mockResolvedValue([])
    vi.mocked(workspaceHubService.listCandidates).mockResolvedValue([])

    const store = useWorkspaceHubStore.getState()
    const result = await store.actionCandidate('cand-1', 'approve')

    expect(result).toBe(true)
    expect(workspaceHubService.actionCandidate).toHaveBeenCalledWith(TEST_SESSION, 'cand-1', 'approve')
    expect(workspaceHubService.getStatus).toHaveBeenCalledWith(TEST_SESSION)
  })

  it('discards async results when project session has changed mid-flight', async () => {
    let resolveScan!: (val: WorkspaceScanResult) => void
    vi.mocked(workspaceHubService.bindDirectory).mockReturnValue(
      new Promise(resolve => { resolveScan = resolve }),
    )

    const store = useWorkspaceHubStore.getState()
    const promise = store.bindDirectory('grant-fake-123')

    // Simulate switching project session while scan is in flight
    setActiveProjectSessionContext({
      projectId: 'other-project',
      leaseId: 'lease-2',
      projectPath: '/other/path',
    })

    resolveScan({
      success: true,
      scannedCount: 1,
      recognizedCount: 1,
      enumerationComplete: true,
      truncated: false,
    })
    const result = await promise

    expect(result).toBe(false)
  })

  it('cancels the scan for the current project session and restores an actionable state', async () => {
    vi.mocked(workspaceHubService.cancelScan).mockResolvedValue({ success: true })
    useWorkspaceHubStore.setState({ scanning: true, error: null })

    const result = await useWorkspaceHubStore.getState().cancelScan()

    expect(result).toBe(true)
    expect(workspaceHubService.cancelScan).toHaveBeenCalledWith(TEST_SESSION)
    expect(useWorkspaceHubStore.getState().scanning).toBe(false)
    expect(useWorkspaceHubStore.getState().error).toBe('扫描已取消')
  })

  it('keeps cancelling=true and blocks secondary operations until original in-flight bindDirectory finishes', async () => {
    let resolveBindScan!: (val: WorkspaceScanResult) => void
    vi.mocked(workspaceHubService.bindDirectory).mockReturnValue(
      new Promise(resolve => { resolveBindScan = resolve }),
    )
    vi.mocked(workspaceHubService.cancelScan).mockResolvedValue({ success: true })

    const store = useWorkspaceHubStore.getState()
    const bindPromise = store.bindDirectory('grant-abc')

    // Bind scan is now in flight
    expect(useWorkspaceHubStore.getState().scanning).toBe(true)
    expect(useWorkspaceHubStore.getState().cancelling).toBe(false)

    // User requests cancellation
    const cancelPromise = store.cancelScan()
    const cancelResult = await cancelPromise
    expect(cancelResult).toBe(true)

    // After cancel IPC resolves, cancelling must stay true while original scan promise is still pending
    expect(useWorkspaceHubStore.getState().cancelling).toBe(true)
    expect(useWorkspaceHubStore.getState().scanning).toBe(true)

    // Secondary operations must all be blocked while cancelling
    const secondBind = await store.bindDirectory('grant-xyz')
    expect(secondBind).toBe(false)
    const secondRescan = await store.rescan()
    expect(secondRescan).toBe(false)
    const secondUnbind = await store.unbindDirectory()
    expect(secondUnbind).toBe(false)
    const secondSelect = await store.selectDirectory()
    expect(secondSelect).toBeNull()

    // Service methods for secondary ops must not have been invoked
    expect(workspaceHubService.bindDirectory).toHaveBeenCalledTimes(1)
    expect(workspaceHubService.rescan).not.toHaveBeenCalled()
    expect(workspaceHubService.unbindDirectory).not.toHaveBeenCalled()
    expect(workspaceHubService.selectDirectory).not.toHaveBeenCalled()

    // Original scan promise resolves with aborted result
    resolveBindScan({ success: false, error: '扫描已取消' })
    const bindResult = await bindPromise
    expect(bindResult).toBe(false)

    // State is fully reset to actionable state
    const stateAfter = useWorkspaceHubStore.getState()
    expect(stateAfter.scanning).toBe(false)
    expect(stateAfter.cancelling).toBe(false)
    expect(stateAfter.error).toBe('扫描已取消')
  })

  it('keeps cancelling=true and blocks secondary operations until original in-flight rescan finishes', async () => {
    let resolveRescan!: (val: WorkspaceScanResult) => void
    vi.mocked(workspaceHubService.rescan).mockReturnValue(
      new Promise(resolve => { resolveRescan = resolve }),
    )
    vi.mocked(workspaceHubService.cancelScan).mockResolvedValue({ success: true })

    const store = useWorkspaceHubStore.getState()
    const rescanPromise = store.rescan()

    expect(useWorkspaceHubStore.getState().scanning).toBe(true)
    expect(useWorkspaceHubStore.getState().cancelling).toBe(false)

    const cancelPromise = store.cancelScan()
    const cancelResult = await cancelPromise
    expect(cancelResult).toBe(true)

    // Cancelling must stay true while rescan promise is still in flight
    expect(useWorkspaceHubStore.getState().cancelling).toBe(true)

    // Block secondary attempts
    expect(await store.rescan()).toBe(false)
    expect(await store.bindDirectory('grant-123')).toBe(false)
    expect(await store.unbindDirectory()).toBe(false)
    expect(await store.selectDirectory()).toBeNull()

    // Rescan resolves with abort error
    resolveRescan({ success: false, error: 'SCAN_ABORTED' })
    const finalRescanResult = await rescanPromise
    expect(finalRescanResult).toBe(false)

    const state = useWorkspaceHubStore.getState()
    expect(state.scanning).toBe(false)
    expect(state.cancelling).toBe(false)
    expect(state.error).toBe('扫描已取消')
  })

  it('discards a late cancel response after switching projects', async () => {
    let resolveCancel!: (value: { success: boolean }) => void
    vi.mocked(workspaceHubService.cancelScan).mockReturnValue(new Promise(resolve => {
      resolveCancel = resolve
    }))
    useWorkspaceHubStore.setState({ scanning: true, error: null })

    const pending = useWorkspaceHubStore.getState().cancelScan()
    setActiveProjectSessionContext({
      projectId: 'other-project',
      leaseId: 'lease-2',
      projectPath: '/other/path',
    })
    useWorkspaceHubStore.setState({ scanning: true, error: 'new-project-state' })
    resolveCancel({ success: true })

    expect(await pending).toBe(false)
    expect(useWorkspaceHubStore.getState().scanning).toBe(true)
    expect(useWorkspaceHubStore.getState().error).toBe('new-project-state')
  })

  it('discards late scan completion after project switch via reset() without corrupting new project state', async () => {
    let resolveScan!: (val: WorkspaceScanResult) => void
    vi.mocked(workspaceHubService.bindDirectory).mockReturnValue(
      new Promise(resolve => { resolveScan = resolve }),
    )
    vi.mocked(workspaceHubService.getStatus).mockResolvedValue({
      externalWorkspacePath: '/old/path',
      lastScannedAt: 'old-time',
      totalFiles: 10,
      recognizedFiles: 10,
      missingFiles: 0,
      changedFiles: 0,
      pendingCandidates: 0,
      confirmedRulesCount: 0,
    })

    const store = useWorkspaceHubStore.getState()
    const oldScanPromise = store.bindDirectory('old-grant')

    // Project switch occurs: reset store and set active session to new project
    store.reset()
    const NEW_SESSION = {
      projectId: 'new-project-id',
      leaseId: 'lease-new',
      projectPath: '/new/project/path',
    }
    setActiveProjectSessionContext(NEW_SESSION)
    useWorkspaceHubStore.setState({
      status: {
        externalWorkspacePath: '/new/project/workspace',
        lastScannedAt: 'new-time',
        totalFiles: 1,
        recognizedFiles: 1,
        missingFiles: 0,
        changedFiles: 0,
        pendingCandidates: 0,
        confirmedRulesCount: 0,
      },
      error: 'initial-new-state',
    })

    // Now late scan from old project finishes
    resolveScan({
      success: true,
      scannedCount: 10,
      recognizedCount: 10,
      enumerationComplete: true,
      truncated: false,
    })
    const oldScanResult = await oldScanPromise
    expect(oldScanResult).toBe(false)

    // Verify new project state was NOT overwritten by old scan
    const currentState = useWorkspaceHubStore.getState()
    expect(currentState.status?.externalWorkspacePath).toBe('/new/project/workspace')
    expect(currentState.error).toBe('initial-new-state')
    expect(currentState.lastScanResult).toBeNull()
  })

  it('prevents project A late finally from clearing project B cancelling/scanning state during cross-project cancellation', async () => {
    // 1. Setup Project A and start a scan that remains in-flight
    const SESSION_A = {
      projectId: 'project-A',
      leaseId: 'lease-A',
      projectPath: '/project/A',
    }
    setActiveProjectSessionContext(SESSION_A)

    let resolveScanA!: (val: WorkspaceScanResult) => void
    let resolveScanB!: (val: WorkspaceScanResult) => void

    vi.mocked(workspaceHubService.bindDirectory).mockImplementation((session) => {
      if (session.projectId === 'project-A') {
        return new Promise(resolve => { resolveScanA = resolve })
      }
      return new Promise(resolve => { resolveScanB = resolve })
    })
    vi.mocked(workspaceHubService.cancelScan).mockResolvedValue({ success: true })

    const store = useWorkspaceHubStore.getState()
    const scanAPromise = store.bindDirectory('grant-A')
    expect(useWorkspaceHubStore.getState().scanning).toBe(true)

    // 2. Switch to Project B
    const SESSION_B = {
      projectId: 'project-B',
      leaseId: 'lease-B',
      projectPath: '/project/B',
    }
    setActiveProjectSessionContext(SESSION_B)
    store.reset()

    // 3. Project B starts its scan and requests cancellation
    const scanBPromise = store.bindDirectory('grant-B')
    expect(useWorkspaceHubStore.getState().scanning).toBe(true)
    expect(useWorkspaceHubStore.getState().cancelling).toBe(false)

    // Project B user triggers cancelScan
    const cancelBPromise = store.cancelScan()
    const cancelBResult = await cancelBPromise
    expect(cancelBResult).toBe(true)

    // While Project B scan promise is still pending, cancelling must be true
    expect(useWorkspaceHubStore.getState().cancelling).toBe(true)
    expect(useWorkspaceHubStore.getState().scanning).toBe(true)

    // 4. Now, Project A's late scan finally completes and executes finally block!
    resolveScanA({
      success: true,
      scannedCount: 5,
      recognizedCount: 5,
      enumerationComplete: true,
      truncated: false,
    })
    const scanAResult = await scanAPromise
    expect(scanAResult).toBe(false)

    // CRITICAL ASSERTION: Project A's late finally must NOT clear Project B's state!
    const stateWhileBStillInFlight = useWorkspaceHubStore.getState()
    expect(stateWhileBStillInFlight.cancelling).toBe(true)
    expect(stateWhileBStillInFlight.scanning).toBe(true)

    // Secondary operations for Project B must still be blocked
    expect(await store.bindDirectory('grant-B2')).toBe(false)
    expect(await store.rescan()).toBe(false)

    // 5. Finally, Project B's own scan completes with cancellation
    resolveScanB({
      success: false,
      error: '扫描已取消',
    })
    const scanBResult = await scanBPromise
    expect(scanBResult).toBe(false)

    // Now Project B state is properly reset
    const finalState = useWorkspaceHubStore.getState()
    expect(finalState.cancelling).toBe(false)
    expect(finalState.scanning).toBe(false)
    expect(finalState.error).toBe('扫描已取消')
  })

  it('fails close and marks scan as truncated when successful scan result lacks enumerationComplete', async () => {
    vi.mocked(workspaceHubService.bindDirectory).mockResolvedValue({
      success: true,
      scannedCount: 3,
      recognizedCount: 3,
    } as unknown as WorkspaceScanResult)
    vi.mocked(workspaceHubService.getStatus).mockResolvedValue({
      externalWorkspacePath: '/test/path',
      lastScannedAt: 'now',
      totalFiles: 3,
      recognizedFiles: 3,
      missingFiles: 0,
      changedFiles: 0,
      pendingCandidates: 0,
      confirmedRulesCount: 0,
    })
    vi.mocked(workspaceHubService.listSources).mockResolvedValue([])
    vi.mocked(workspaceHubService.listRules).mockResolvedValue([])
    vi.mocked(workspaceHubService.listCandidates).mockResolvedValue([])

    const store = useWorkspaceHubStore.getState()
    const ok = await store.bindDirectory('grant-1')
    expect(ok).toBe(true)

    const lastScan = useWorkspaceHubStore.getState().lastScanResult
    expect(lastScan?.enumerationComplete).toBe(false)
    expect(lastScan?.truncated).toBe(true)
    expect(lastScan?.truncationReason).toBe('unknown')
  })

  it('resets all workspace hub state and filters completely on reset()', () => {
    const store = useWorkspaceHubStore.getState()
    store.setActiveTab('context')
    store.setRuleFilterStatus('confirmed')
    store.setCandidateFilterStatus('pending')
    store.setTargetChapterNumber(12)
    store.setBudgetChars(30000)
    store.setIncludeCandidates(true)

    store.reset()

    const state = useWorkspaceHubStore.getState()
    expect(state.activeTab).toBe('sources')
    expect(state.ruleFilterStatus).toBe('all')
    expect(state.candidateFilterStatus).toBe('all')
    expect(state.targetChapterNumber).toBe(1)
    expect(state.budgetChars).toBe(16000)
    expect(state.includeCandidates).toBe(false)
    expect(state.chapterContextBundle).toBeNull()
  })
})
