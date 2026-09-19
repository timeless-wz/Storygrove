import { create } from 'zustand'
import type {
  StoryTimelineBranch,
  StoryTimelineEvent,
  StoryTimelineSettings,
} from '../shared/story-timeline'
import { STORY_TIMELINE_MAIN_BRANCH_ID } from '../shared/story-timeline'
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
  upsertEvent: (event: StoryTimelineEvent) => Promise<boolean>
  deleteEvent: (id: string) => Promise<boolean>
  reorderEvents: (orderedIds: string[]) => Promise<boolean>
  upsertBranch: (branch: StoryTimelineBranch) => Promise<boolean>
  deleteBranch: (id: string) => Promise<boolean>
  toggleBranchExpanded: (branchId: string) => void
  setBranchExpanded: (branchId: string, expanded: boolean) => void
}

const DEFAULT_SETTINGS: StoryTimelineSettings = {
  title: '故事时间线',
  rulerLabel: '故事时间',
  rulerUnit: '刻度',
}

const DEFAULT_MAIN_BRANCH: StoryTimelineBranch = {
  id: STORY_TIMELINE_MAIN_BRANCH_ID,
  name: '主时间轴',
  sourceEventId: null,
  sortOrder: 0,
}

export const useStoryTimelineStore = create<StoryTimelineState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
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
      // 刷新数据以获取级联清理后的分支与事件
      const snapshot = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectSession.projectPath)
      if (isProjectSessionCurrent(projectSession) && snapshot) {
        set({
          branches: snapshot.branches || [DEFAULT_MAIN_BRANCH],
          events: snapshot.events || [],
          expandedBranchIds: get().expandedBranchIds.filter(bid => bid !== id),
        })
      }
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`删除分支失败：${String(error)}`)
      return false
    }
  },

  upsertEvent: async (event) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-event-upsert', event, projectSession.projectPath)
      if (!result.success || !result.event) throw new Error(result.error || '保存失败')
      if (!isProjectSessionCurrent(projectSession)) return false
      const events = get().events.filter(item => item.id !== result.event!.id)
      events.push(result.event)
      events.sort((a, b) => a.sortOrder - b.sortOrder)
      set({ events })
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`保存时间线事件失败：${String(error)}`)
      return false
    }
  },

  deleteEvent: async (id) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return false
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-event-delete', id, projectSession.projectPath)
      if (!result.success) throw new Error(result.error || '删除失败')
      if (!isProjectSessionCurrent(projectSession)) return false
      // 重新读取 snapshot 保证级联清理后的子支线也同步移除
      const snapshot = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectSession.projectPath)
      if (isProjectSessionCurrent(projectSession) && snapshot) {
        set({
          branches: snapshot.branches || [DEFAULT_MAIN_BRANCH],
          events: snapshot.events || [],
        })
      } else {
        set({ events: get().events.filter(event => event.id !== id) })
      }
      return true
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(`删除时间线事件失败：${String(error)}`)
      return false
    }
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
