import { create } from 'zustand'
import { workspaceHubService } from '../services/workspace-hub-service'
import { useProjectStore } from './project-store'
import {
  getActiveProjectSessionContext,
  sameProjectSessionContext,
} from '../shared/project-session-context'
import type {
  WorkspaceHubStatus,
  WorkspaceSource,
  WorkspaceSourceFragment,
  SettingRule,
  SettingRuleStatus,
  WorkspaceImportCandidate,
  WorkspaceImportCandidateType,
  WorkspaceImportCandidateStatus,
  ChapterContextBundle,
  ChapterContextSnapshot,
} from '../shared/workspace-hub'

// Phase 1 views share this store with the Phase 2–8 authoring surfaces.
// Keep the richer tab set while retaining the Phase 1 scan and provenance state.
export type WorkspaceHubTab =
  | 'sources'
  | 'rules'
  | 'context'
  | 'story-data'
  | 'workbench'
  | 'control'
  | 'audit'
  | 'revision'

interface WorkspaceHubState {
  status: WorkspaceHubStatus | null
  sources: WorkspaceSource[]
  selectedSourceId: string | null
  selectedSnapshotId: string | null
  selectedFragmentId: string | null
  selectedSourceDetail: {
    source: WorkspaceSource | null
    fragments: WorkspaceSourceFragment[]
    targetSnapshotId?: string | null
    provenanceStatus?: 'found' | 'provenance-missing'
  } | null
  provenanceStatus: 'found' | 'provenance-missing' | null
  rules: SettingRule[]
  candidates: WorkspaceImportCandidate[]
  ruleFilterStatus: SettingRuleStatus | 'all'
  candidateFilterStatus: WorkspaceImportCandidateStatus | 'all'
  chapterContextBundle: ChapterContextBundle | null
  targetChapterNumber: number
  budgetChars: number
  includeCandidates: boolean
  loading: boolean
  scanning: boolean
  cancelling: boolean
  scanRunId: number
  actioningCandidateId: string | null
  error: string | null
  activeTab: WorkspaceHubTab

  // Actions
  loadAll: () => Promise<void>
  selectDirectory: () => Promise<{ grantId: string; displayName: string } | null>
  bindDirectory: (grantId: string) => Promise<boolean>
  unbindDirectory: () => Promise<boolean>
  rescan: () => Promise<boolean>
  cancelScan: () => Promise<boolean>
  approveSource: (sourceId: string) => Promise<boolean>
  approveAllSources: () => Promise<boolean>
  selectSource: (
    sourceId: string | null,
    optionsOrSnapshotId?: string | { snapshotId?: string | null; fragmentId?: string | null; projectId?: string } | null,
    fragmentId?: string | null,
  ) => Promise<void>
  loadRules: (status?: SettingRuleStatus) => Promise<void>
  updateRuleStatus: (ruleId: string, status: SettingRuleStatus) => Promise<boolean>
  deleteRule: (ruleId: string) => Promise<boolean>
  loadCandidates: (type?: WorkspaceImportCandidateType, status?: WorkspaceImportCandidateStatus) => Promise<void>
  actionCandidate: (candidateId: string, action: 'approve' | 'reject') => Promise<boolean>
  setTargetChapterNumber: (num: number) => void
  setBudgetChars: (chars: number) => void
  setIncludeCandidates: (include: boolean) => void
  assembleChapterContext: (chapterNumber?: number) => Promise<void>
  saveChapterContextSnapshot: () => Promise<boolean>
  setActiveTab: (tab: WorkspaceHubTab) => void
  setRuleFilterStatus: (status: SettingRuleStatus | 'all') => void
  setCandidateFilterStatus: (status: WorkspaceImportCandidateStatus | 'all') => void
  reset: () => void
}

export const useWorkspaceHubStore = create<WorkspaceHubState>((set, get) => ({
  status: null,
  sources: [],
  selectedSourceId: null,
  selectedSnapshotId: null,
  selectedFragmentId: null,
  selectedSourceDetail: null,
  provenanceStatus: null,
  rules: [],
  candidates: [],
  ruleFilterStatus: 'all',
  candidateFilterStatus: 'all',
  chapterContextBundle: null,
  targetChapterNumber: 1,
  budgetChars: 16000,
  includeCandidates: false,
  loading: false,
  scanning: false,
  cancelling: false,
  scanRunId: 0,
  actioningCandidateId: null,
  error: null,
  activeTab: 'sources',

  loadAll: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) {
      set({ loading: false })
      return
    }
    set({ loading: true, error: null })
    try {
      const [status, sources, rules, candidates] = await Promise.all([
        workspaceHubService.getStatus(session),
        workspaceHubService.listSources(session),
        workspaceHubService.listRules(session),
        workspaceHubService.listCandidates(session),
      ])
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({
        status,
        sources,
        rules,
        candidates,
        loading: false,
      })
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  selectDirectory: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) return null
    try {
      return await workspaceHubService.selectDirectory(session)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  bindDirectory: async (grantId: string) => {
    const session = getActiveProjectSessionContext()
    if (!session) {
      set({ error: '缺少当前项目会话' })
      return false
    }
    const runId = get().scanRunId + 1
    set({ scanning: true, cancelling: false, scanRunId: runId, error: null })
    try {
      const res = await workspaceHubService.bindDirectory(session, grantId)
      if (get().scanRunId !== runId) return false
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (get().cancelling) {
        set({ scanning: false, cancelling: false })
        return false
      }
      if (!res.success) {
        const isCancelled = res.error?.includes('取消') || res.error === 'SCAN_ABORTED'
        set({
          scanning: false,
          cancelling: false,
          error: isCancelled ? '扫描已取消' : (res.error || '扫描失败'),
        })
        return false
      }
      await get().loadAll()
      if (get().scanRunId !== runId) return false
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({ scanning: false, cancelling: false, error: null })
      return true
    } catch (err) {
      if (get().scanRunId !== runId) return false
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        scanning: false,
        cancelling: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  unbindDirectory: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    set({ loading: true, error: null })
    try {
      const res = await workspaceHubService.unbindDirectory(session)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        status: null,
        sources: [],
        selectedSourceId: null,
        selectedSourceDetail: null,
        chapterContextBundle: null,
        loading: false,
      })
      await get().loadAll()
      return res.success
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  rescan: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    const runId = get().scanRunId + 1
    set({ scanning: true, cancelling: false, scanRunId: runId, error: null })
    try {
      const res = await workspaceHubService.rescan(session)
      if (get().scanRunId !== runId) return false
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (get().cancelling) {
        set({ scanning: false, cancelling: false })
        return false
      }
      if (!res.success) {
        const isCancelled = res.error?.includes('取消') || res.error === 'SCAN_ABORTED'
        set({
          scanning: false,
          cancelling: false,
          error: isCancelled ? '扫描已取消' : (res.error || '扫描失败'),
        })
        return false
      }
      await get().loadAll()
      if (get().scanRunId !== runId) return false
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({ scanning: false, cancelling: false, error: null })
      return true
    } catch (err) {
      if (get().scanRunId !== runId) return false
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        scanning: false,
        cancelling: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  cancelScan: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    set({ cancelling: true })
    try {
      const res = await workspaceHubService.cancelScan(session)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        scanning: false,
        cancelling: false,
        error: res.success ? '扫描已取消' : (res.error || '取消扫描失败'),
      })
      return res.success
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        scanning: false,
        cancelling: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  approveSource: async (sourceId: string) => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const res = await workspaceHubService.approveSource(session, sourceId)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (res.success) {
        await get().loadAll()
        if (get().selectedSourceId === sourceId) {
          await get().selectSource(sourceId)
        }
        return true
      }
      set({ error: res.error || '批准失败' })
      return false
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  approveAllSources: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const res = await workspaceHubService.approveAllSources(session)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (res.success) {
        await get().loadAll()
        return true
      }
      set({ error: res.error || '批量批准失败' })
      return false
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  selectSource: async (
    sourceId: string | null,
    optionsOrSnapshotId?: string | { snapshotId?: string | null; fragmentId?: string | null; projectId?: string } | null,
    fragmentId?: string | null,
  ) => {
    if (!sourceId) {
      set({
        selectedSourceId: null,
        selectedSnapshotId: null,
        selectedFragmentId: null,
        selectedSourceDetail: null,
        provenanceStatus: null,
      })
      return
    }
    const session = getActiveProjectSessionContext()
    if (!session) return

    let targetSnapshotId: string | null | undefined
    let targetFragmentId: string | null | undefined

    if (typeof optionsOrSnapshotId === 'object' && optionsOrSnapshotId !== null) {
      targetSnapshotId = optionsOrSnapshotId.snapshotId
      targetFragmentId = optionsOrSnapshotId.fragmentId
    } else {
      targetSnapshotId = optionsOrSnapshotId
      targetFragmentId = fragmentId
    }

    set({
      selectedSourceId: sourceId,
      selectedSnapshotId: targetSnapshotId || null,
      selectedFragmentId: targetFragmentId || null,
    })

    try {
      const detail = await workspaceHubService.getSourceDetail(
        session,
        sourceId,
        targetSnapshotId,
        targetFragmentId,
      )
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return

      const status = detail.provenanceStatus || (
        targetFragmentId && !detail.fragments.some(f => f.fragmentId === targetFragmentId)
          ? 'provenance-missing'
          : 'found'
      )

      set({
        selectedSourceDetail: detail,
        provenanceStatus: status,
        selectedSnapshotId: detail.targetSnapshotId || targetSnapshotId || detail.source?.approvedSnapshotId || null,
      })
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({
        error: err instanceof Error ? err.message : String(err),
        provenanceStatus: 'provenance-missing',
      })
    }
  },

  loadRules: async (status?: SettingRuleStatus) => {
    const session = getActiveProjectSessionContext()
    if (!session) return
    try {
      const rules = await workspaceHubService.listRules(session, status)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ rules })
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  updateRuleStatus: async (ruleId: string, status: SettingRuleStatus) => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const res = await workspaceHubService.updateRuleStatus(session, ruleId, status)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (res.success) {
        const filter = get().ruleFilterStatus
        const rules = await workspaceHubService.listRules(
          session,
          filter === 'all' ? undefined : filter,
        )
        const updatedStatus = await workspaceHubService.getStatus(session)
        if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
        set({ rules, status: updatedStatus })
        return true
      }
      return false
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  deleteRule: async (ruleId: string) => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    try {
      const res = await workspaceHubService.deleteRule(session, ruleId)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (res.success) {
        const filter = get().ruleFilterStatus
        const rules = await workspaceHubService.listRules(
          session,
          filter === 'all' ? undefined : filter,
        )
        if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
        set({ rules })
        return true
      }
      return false
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  loadCandidates: async (type?: WorkspaceImportCandidateType, status?: WorkspaceImportCandidateStatus) => {
    const session = getActiveProjectSessionContext()
    if (!session) return
    try {
      const candidates = await workspaceHubService.listCandidates(session, type, status)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ candidates })
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  actionCandidate: async (candidateId: string, action: 'approve' | 'reject') => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    set({ actioningCandidateId: candidateId })
    try {
      const res = await workspaceHubService.actionCandidate(session, candidateId, action)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      if (res.success) {
        await get().loadAll()
        if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
        set({ actioningCandidateId: null })
        return true
      }
      set({ actioningCandidateId: null, error: res.error || '操作失败' })
      return false
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        actioningCandidateId: null,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  setTargetChapterNumber: (num: number) => {
    set({ targetChapterNumber: Math.max(1, num) })
  },

  setBudgetChars: (chars: number) => {
    set({ budgetChars: Math.max(1000, chars) })
  },

  setIncludeCandidates: (include: boolean) => {
    set({ includeCandidates: include })
  },

  assembleChapterContext: async (chNumber?: number) => {
    const session = getActiveProjectSessionContext()
    if (!session) return
    const chapterNum = chNumber ?? get().targetChapterNumber
    set({ loading: true, error: null })
    try {
      const bundle = await workspaceHubService.assembleChapterContext(
        session,
        chapterNum,
        get().budgetChars,
        get().includeCandidates,
      )
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({ chapterContextBundle: bundle, loading: false })
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  saveChapterContextSnapshot: async () => {
    const session = getActiveProjectSessionContext()
    if (!session) return false
    const bundle = get().chapterContextBundle
    if (!bundle) return false
    set({ loading: true, error: null })
    try {
      const snapshot: ChapterContextSnapshot = {
        id: `snap-${bundle.chapterNumber}-${crypto.randomUUID()}`,
        projectId: session.projectId,
        chapterNumber: bundle.chapterNumber,
        totalChars: bundle.totalCharCount,
        estimatedTokens: bundle.estimatedTokens,
        bundleText: bundle.fullAssembledText,
        sourcesJson: JSON.stringify(bundle.blocks.flatMap(b => b.sources || [])),
        blocksJson: JSON.stringify(bundle.blocks),
        staleWarningsJson: JSON.stringify(bundle.staleWarnings),
        candidateWarningsJson: JSON.stringify(bundle.candidateWarnings),
        omissionsJson: JSON.stringify(bundle.omissions),
        excludedDeprecatedCount: bundle.excludedDeprecatedCount,
        isOverBudget: bundle.isOverBudget,
      }
      const res = await workspaceHubService.saveChapterContextSnapshot(session, snapshot)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({ loading: false })
      return res.success
    } catch (err) {
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return false
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  setActiveTab: (tab: WorkspaceHubTab) => set({ activeTab: tab }),
  setRuleFilterStatus: (status) => set({ ruleFilterStatus: status }),
  setCandidateFilterStatus: (status) => set({ candidateFilterStatus: status }),
  reset: () => set({
    status: null,
    sources: [],
    selectedSourceId: null,
    selectedSnapshotId: null,
    selectedFragmentId: null,
    selectedSourceDetail: null,
    provenanceStatus: null,
    rules: [],
    candidates: [],
    ruleFilterStatus: 'all',
    candidateFilterStatus: 'all',
    chapterContextBundle: null,
    targetChapterNumber: 1,
    budgetChars: 16000,
    includeCandidates: false,
    loading: false,
    scanning: false,
    cancelling: false,
    scanRunId: 0,
    actioningCandidateId: null,
    error: null,
    activeTab: 'sources',
  }),
}))

let lastTrackedProjectId: string | null = null
useProjectStore.subscribe((state) => {
  const currentId = state.currentProject?.id ?? null
  if (currentId !== lastTrackedProjectId) {
    lastTrackedProjectId = currentId
    useWorkspaceHubStore.getState().reset()
    if (currentId) {
      void useWorkspaceHubStore.getState().loadAll()
    }
  }
})
