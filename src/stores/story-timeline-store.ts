import { create } from 'zustand'
import type {
  StoryTimelineBranch,
  StoryTimelineDeleteCommitResult,
  StoryTimelineDeletePreviewResult,
  StoryTimelineEvent,
  StoryTimelineSettings,
} from '../shared/story-timeline'
import { DEFAULT_TIMELINE_SETTINGS, STORY_TIMELINE_MAIN_BRANCH_ID } from '../shared/story-timeline'
import type { TimelineBranchCommit, TimelineUiResult } from '../components/timeline/timeline-ui-contract'
import { ipc } from '../services/ipc-client'
import { toast } from '../components/ui/Toast'
import { captureProjectSession, isProjectSessionCurrent } from '../components/project-session-gate'
import { useProjectStore } from './project-store'

interface StoryTimelineState {
  settings: StoryTimelineSettings
  branches: StoryTimelineBranch[]
  events: StoryTimelineEvent[]
  expandedBranchIds: string[]
  loading: boolean
  dataProjectKey: string | null
  loadAll: (projectPath: string) => Promise<void>
  saveSettings: (settings: StoryTimelineSettings) => Promise<boolean>
  /** 兼容接口：布尔结果。需要错误详情的调用方使用 upsertEventResult。 */
  upsertEvent: (event: StoryTimelineEvent) => Promise<boolean>
  upsertEventResult: (event: StoryTimelineEvent) => Promise<TimelineUiResult>
  deleteEvent: (id: string) => Promise<boolean>
  reorderEvents: (orderedIds: string[]) => Promise<boolean>
  upsertBranch: (branch: StoryTimelineBranch) => Promise<boolean>
  /** 原子创建支线与其首事件：同一事务提交，绝不留下空支线。 */
  createBranchWithEvent: (branch: StoryTimelineBranch, event: StoryTimelineEvent) => Promise<TimelineBranchCommit>
  deleteBranch: (id: string) => Promise<boolean>
  /** 删除影响预览：目标、被删事件/支线 ID 与计数，以及确认删除所需的指纹。 */
  previewEventDelete: (eventId: string) => Promise<StoryTimelineDeletePreviewResult>
  previewBranchDelete: (branchId: string) => Promise<StoryTimelineDeletePreviewResult>
  /**
   * 确认删除事件：回传预览指纹，影响集合已变化时返回 needsReconfirmation
   * 与最新预览，不删除任何数据；UI 应基于新预览重新确认后重试。
   */
  deleteEventConfirmed: (eventId: string, fingerprint: string) => Promise<StoryTimelineDeleteCommitResult>
  deleteBranchConfirmed: (branchId: string, fingerprint: string) => Promise<StoryTimelineDeleteCommitResult>
  /** 确认删除成功后按主进程返回的精确 ID 集合清理本地状态。 */
  pruneAfterConfirmedDelete: (deletedEventIds: string[], deletedBranchIds: string[]) => void
  toggleBranchExpanded: (branchId: string) => void
  setBranchExpanded: (branchId: string, expanded: boolean) => void
}

const DEFAULT_MAIN_BRANCH: StoryTimelineBranch = {
  id: STORY_TIMELINE_MAIN_BRANCH_ID,
  name: '主时间轴',
  sourceEventId: null,
  sortOrder: 0,
}

export const useStoryTimelineStore = create<StoryTimelineState>((set, get) => ({
  settings: DEFAULT_TIMELINE_SETTINGS,
  branches: [DEFAULT_MAIN_BRANCH],
  events: [],
  // 支线默认折叠：初始仅主时间轴展开
  expandedBranchIds: [STORY_TIMELINE_MAIN_BRANCH_ID],
  loading: false,
  dataProjectKey: null,

  toggleBranchExpanded: (branchId: string) => {
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) return
    const current = get().expandedBranchIds
    const next = current.includes(branchId)
      ? current.filter(id => id !== branchId)
      : [...current, branchId]
    set({ expandedBranchIds: next })
  },

  setBranchExpanded: (branchId: string, expanded: boolean) => {
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) return
    const current = get().expandedBranchIds
    if (expanded && !current.includes(branchId)) {
      set({ expandedBranchIds: [...current, branchId] })
    } else if (!expanded && current.includes(branchId)) {
      set({ expandedBranchIds: current.filter(id => id !== branchId) })
    }
  },

  loadAll: async (projectPath) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return
    set({ loading: true })
    try {
      const snapshot = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      const branches = snapshot.branches && snapshot.branches.length > 0
        ? snapshot.branches
        : [DEFAULT_MAIN_BRANCH]
      if (!branches.some((b: StoryTimelineBranch) => b.id === STORY_TIMELINE_MAIN_BRANCH_ID)) {
        branches.unshift(DEFAULT_MAIN_BRANCH)
      }
      set({
        settings: snapshot.settings,
        branches,
        events: snapshot.events,
        dataProjectKey: projectPath,
      })
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`读取故事时间线失败：${String(error)}`)
    } finally {
      if (isProjectSessionCurrent(projectSession)) set({ loading: false })
    }
  },

  saveSettings: async (settings) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-settings-save', settings, projectSession.projectPath)
      if (!result.success || !result.settings) throw new Error(result.error || '保存失败')
      if (!isProjectSessionCurrent(projectSession)) return false
      set({ settings: result.settings })
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`保存时间线设置失败：${String(error)}`)
      return false
    }
  },

  upsertBranch: async (branch) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-branch-upsert', branch, projectSession.projectPath)
      if (!result.success || !result.branch) throw new Error(result.error || '保存分支失败')
      if (!isProjectSessionCurrent(projectSession)) return false
      const branches = get().branches.filter(item => item.id !== result.branch!.id)
      branches.push(result.branch)
      branches.sort((a, b) => a.sortOrder - b.sortOrder)
      // 新建分支时默认展开该新分支，方便作者立即查看与录入
      const expandedBranchIds = get().expandedBranchIds.includes(result.branch.id)
        ? get().expandedBranchIds
        : [...get().expandedBranchIds, result.branch.id]
      set({ branches, expandedBranchIds })
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`保存分支失败：${String(error)}`)
      return false
    }
  },

  deleteBranch: async (id) => {
    if (id === STORY_TIMELINE_MAIN_BRANCH_ID) {
      toast.error('主时间轴不可删除')
      return false
    }
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-branch-delete', id, projectSession.projectPath)
      if (!result.success) throw new Error(result.error || '删除分支失败')
      if (!isProjectSessionCurrent(projectSession)) return false
      // 删除本身已成功；随后的快照刷新是尽力同步，失败不把成功删除误报为失败。
      try {
        const snapshot = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectSession.projectPath)
        if (isProjectSessionCurrent(projectSession) && snapshot) {
          set({
            branches: snapshot.branches || [DEFAULT_MAIN_BRANCH],
            events: snapshot.events || [],
            expandedBranchIds: get().expandedBranchIds.filter(bid => bid !== id),
          })
        }
      } catch { /* 快照刷新失败时保留现有 state，数据库事实源已正确 */ }
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`删除分支失败：${String(error)}`)
      return false
    }
  },

  upsertEvent: async (event) => {
    const result = await get().upsertEventResult(event)
    return result.success
  },

  upsertEventResult: async (event) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return { success: false, error: '没有打开的项目会话' }
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-event-upsert', event, projectSession.projectPath)
      if (!result.success || !result.event) throw new Error(result.error || '保存失败')
      if (!isProjectSessionCurrent(projectSession)) return { success: false, error: '项目会话已切换' }
      const events = get().events.filter(item => item.id !== result.event!.id)
      events.push(result.event)
      events.sort((a, b) => a.sortOrder - b.sortOrder)
      set({ events })
      return { success: true }
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`保存时间线事件失败：${String(error)}`)
      return { success: false, error: String(error) }
    }
  },

  createBranchWithEvent: async (branch, event) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return { success: false, error: '没有打开的项目会话' }
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:timeline-branch-create-with-event',
        branch,
        event,
        projectSession.projectPath,
      )
      if (!result.success || !result.branch || !result.event) throw new Error(result.error || '创建支线失败')
      if (!isProjectSessionCurrent(projectSession)) return { success: false, error: '项目会话已切换' }
      const branches = get().branches.filter(item => item.id !== result.branch!.id)
      branches.push(result.branch)
      branches.sort((a, b) => a.sortOrder - b.sortOrder)
      const events = get().events.filter(item => item.id !== result.event!.id)
      events.push(result.event)
      events.sort((a, b) => a.sortOrder - b.sortOrder)
      // 新支线默认展开，保证创建后立即可见、可继续录入
      const expandedBranchIds = get().expandedBranchIds.includes(result.branch.id)
        ? get().expandedBranchIds
        : [...get().expandedBranchIds, result.branch.id]
      set({ branches, events, expandedBranchIds })
      return { success: true, branch: result.branch, event: result.event }
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`创建支线失败：${String(error)}`)
      return { success: false, error: String(error) }
    }
  },

  deleteEvent: async (id) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-event-delete', id, projectSession.projectPath)
      if (!result.success) throw new Error(result.error || '删除失败')
      // 会话已切换时绝不再触碰当前 state：旧会话的删除结果不允许污染新项目。
      if (!isProjectSessionCurrent(projectSession)) return false
      // 删除本身已成功；随后的快照刷新是尽力同步，失败不把成功删除误报为失败。
      try {
        const snapshot = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectSession.projectPath)
        if (isProjectSessionCurrent(projectSession) && snapshot) {
          set({
            branches: snapshot.branches || [DEFAULT_MAIN_BRANCH],
            events: snapshot.events || [],
            expandedBranchIds: get().expandedBranchIds,
          })
        }
      } catch { /* 快照刷新失败时保留现有 state，数据库事实源已正确 */ }
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`删除时间线事件失败：${String(error)}`)
      return false
    }
  },

  previewEventDelete: async (eventId) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return { success: false, error: '没有打开的项目会话' }
    try {
      return await ipc.invokeWithProjectSession(projectSession, 'db:timeline-event-delete-preview', eventId, projectSession.projectPath)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },

  previewBranchDelete: async (branchId) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return { success: false, error: '没有打开的项目会话' }
    try {
      return await ipc.invokeWithProjectSession(projectSession, 'db:timeline-branch-delete-preview', branchId, projectSession.projectPath)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  },

  deleteEventConfirmed: async (eventId, fingerprint) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return { success: false, error: '没有打开的项目会话' }
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-event-delete-confirmed', eventId, fingerprint, projectSession.projectPath)
      if (!result.success) {
        // needsReconfirmation 是可重试的预期状态，由 UI 重新弹确认，不在这里报错打扰。
        if (!result.needsReconfirmation && isProjectSessionCurrent(projectSession)) {
          toast.error(`删除时间线事件失败：${result.error}`)
        }
        return result
      }
      if (!isProjectSessionCurrent(projectSession)) return { success: false, error: '项目会话已切换' }
      get().pruneAfterConfirmedDelete(result.deletedEventIds, result.deletedBranchIds)
      return result
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`删除时间线事件失败：${String(error)}`)
      return { success: false, error: String(error) }
    }
  },

  deleteBranchConfirmed: async (branchId, fingerprint) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return { success: false, error: '没有打开的项目会话' }
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-branch-delete-confirmed', branchId, fingerprint, projectSession.projectPath)
      if (!result.success) {
        if (!result.needsReconfirmation && isProjectSessionCurrent(projectSession)) {
          toast.error(`删除支线失败：${result.error}`)
        }
        return result
      }
      if (!isProjectSessionCurrent(projectSession)) return { success: false, error: '项目会话已切换' }
      get().pruneAfterConfirmedDelete(result.deletedEventIds, result.deletedBranchIds)
      return result
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`删除支线失败：${String(error)}`)
      return { success: false, error: String(error) }
    }
  },

  /** 确认删除成功后按主进程返回的精确 ID 集合清理本地状态，不做整页重读。 */
  pruneAfterConfirmedDelete: (deletedEventIds, deletedBranchIds) => {
    const deletedEvents = new Set(deletedEventIds)
    const deletedBranches = new Set(deletedBranchIds)
    set({
      events: get().events.filter(event => !deletedEvents.has(event.id)),
      branches: get().branches.filter(branch => !deletedBranches.has(branch.id)),
      expandedBranchIds: get().expandedBranchIds.filter(branchId => !deletedBranches.has(branchId)),
    })
  },

  reorderEvents: async (orderedIds) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-events-reorder', orderedIds, projectSession.projectPath)
      if (!result.success) throw new Error(result.error || '排序失败')
      if (!isProjectSessionCurrent(projectSession)) return false
      const positions = new Map(orderedIds.map((id, index) => [id, index + 1]))
      set({ events: get().events.map(event => ({ ...event, sortOrder: positions.get(event.id) ?? event.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder) })
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`调整时间线顺序失败：${String(error)}`)
      return false
    }
  },
}))
