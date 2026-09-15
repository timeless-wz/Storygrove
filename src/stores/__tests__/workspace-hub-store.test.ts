import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useWorkspaceHubStore } from '../workspace-hub-store'
import { workspaceHubService } from '../../services/workspace-hub-service'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ChapterContextBundle } from '../../shared/workspace-hub'

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
    let resolveScan!: (val: { success: boolean }) => void
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

    resolveScan({ success: true })
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
