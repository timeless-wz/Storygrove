import { create } from 'zustand'
import type {
  StoryTimelineEvent,
  StoryTimelineSettings,
} from '../shared/story-timeline'
import { ipc } from '../services/ipc-client'
import { toast } from '../components/ui/Toast'
import { captureProjectSession, isProjectSessionCurrent } from '../components/project-session-gate'
import { useProjectStore } from './project-store'

interface StoryTimelineState {
  settings: StoryTimelineSettings
  events: StoryTimelineEvent[]
  loading: boolean
  dataProjectKey: string | null
  loadAll: (projectPath: string) => Promise<void>
  saveSettings: (settings: StoryTimelineSettings) => Promise<boolean>
  upsertEvent: (event: StoryTimelineEvent) => Promise<boolean>
  deleteEvent: (id: string) => Promise<boolean>
  reorderEvents: (orderedIds: string[]) => Promise<boolean>
}

const DEFAULT_SETTINGS: StoryTimelineSettings = {
  title: '故事时间线',
  rulerLabel: '故事时间',
  rulerUnit: '刻度',
}

export const useStoryTimelineStore = create<StoryTimelineState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  events: [],
  loading: false,
  dataProjectKey: null,

  loadAll: async (projectPath) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return
    set({ loading: true })
    try {
      const snapshot = await ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      set({
        settings: snapshot.settings,
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
      set({ events: get().events.filter(event => event.id !== id) })
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
