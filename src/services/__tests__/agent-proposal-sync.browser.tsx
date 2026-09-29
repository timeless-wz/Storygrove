import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerAgentProposalCommitSync } from '../agent-proposal-sync'
import { toast } from '../../components/ui/Toast'
import { globalEventBus, type EventPayloadMap } from '../../shared/event-bus'
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'

interface Harness {
  velaAPI: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void
    once: (channel: string, callback: (...args: unknown[]) => void) => () => void
    send: (channel: string, ...args: unknown[]) => void
  }
}

const originalEditorState = useEditorStore.getState()
const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()

afterEach(() => {
  vi.restoreAllMocks()
  useEditorStore.setState(originalEditorState, true)
  useProjectStore.setState(originalProjectState, true)
  useLocaleStore.setState(originalLocaleState, true)
  delete (window as Partial<Harness>).velaAPI
  document.body.textContent = ''
})

describe('external commit view sync', () => {
  it('preserves typing that starts while the committed draft is being read', async () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
    const handlers = new Map<string, (...args: unknown[]) => void>()
    let resolveRead: (value: { content: string }) => void = () => {}
    const pendingRead = new Promise<{ content: string }>(resolve => { resolveRead = resolve })
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: {
        invoke: (channel: string) => {
          if (channel === 'db:draft-get-full') return pendingRead
          throw new Error(`Unexpected channel: ${channel}`)
        },
        on: (channel: string, callback: (...args: unknown[]) => void) => {
          handlers.set(channel, callback)
          return () => handlers.delete(channel)
        },
        once: () => () => {},
        send: () => {},
      },
    })
    useEditorStore.setState(s => ({
      tabs: [
        ...s.tabs,
        { id: 'tab-becomes-dirty', name: '第 1 章', type: 'chapter', projectKey: 'C:\\novel', filePath: 'vela://draft/7', content: '旧正文', dirty: false },
      ],
    }))
    const warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => {})
    const unsubscribeSync = registerAgentProposalCommitSync()
    handlers.get('story-data:agent-proposal-committed')?.({
      proposalId: 'proposal-1',
      projectId: 'main',
      proposalType: 'propose_draft_update',
      receipt: { proposalId: 'proposal-1', projectId: 'main', resource: 'draft', draftId: 7, revision: 'a'.repeat(64), committedAt: '2026-09-29 00:00:00' },
      projectPath: 'C:\\novel',
      projectSession: { projectId: 'main', leaseId: 'lease-1', projectPath: 'C:\\novel' },
    })
    useEditorStore.getState().updateTabContent('tab-becomes-dirty', '作者刚输入的正文')
    resolveRead({ content: '外部提交后的正文' })
    await vi.waitFor(() => expect(warningSpy).toHaveBeenCalled())
    const tab = useEditorStore.getState().tabs.find(item => item.id === 'tab-becomes-dirty')
    expect(tab?.content).toBe('作者刚输入的正文')
    expect(tab?.dirty).toBe(true)
    unsubscribeSync()
  })

  it('refreshes resources, syncs clean tabs, and never overwrites dirty tabs', async () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
    const handlers = new Map<string, (...args: unknown[]) => void>()
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: {
        invoke: async (channel: string) => {
          if (channel === 'db:draft-get-full') return { content: '外部提交后的正文' }
          throw new Error(`Unexpected channel: ${channel}`)
        },
        on: (channel: string, callback: (...args: unknown[]) => void) => {
          handlers.set(channel, callback)
          return () => handlers.delete(channel)
        },
        once: (channel: string, callback: (...args: unknown[]) => void) => {
          handlers.set(channel, callback)
          return () => handlers.delete(channel)
        },
        send: () => {},
      },
    })
    useEditorStore.setState(s => ({
      tabs: [
        ...s.tabs,
        { id: 'tab-clean', name: '第 1 章', type: 'chapter', projectKey: 'C:\\novel', filePath: 'vela://draft/7', content: '打开时的旧正文', dirty: false },
        { id: 'tab-dirty', name: '第 2 章', type: 'chapter', projectKey: 'C:\\novel', filePath: 'vela://manuscript/7', content: '作者的未保存正文', dirty: true },
      ],
    }))

    const refreshEvents: Array<EventPayloadMap['REFRESH_RESOURCE']> = []
    const unsubscribeRefresh = globalEventBus.on('REFRESH_RESOURCE', payload => refreshEvents.push(payload))
    const warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => {})
    const unsubscribeSync = registerAgentProposalCommitSync()

    const dispatch = handlers.get('story-data:agent-proposal-committed')
    expect(dispatch).toBeTruthy()
    const projectSession = { projectId: 'main', leaseId: 'lease-1', projectPath: 'C:\\novel' }
    dispatch?.({
      proposalId: 'proposal-1',
      projectId: 'main',
      proposalType: 'propose_draft_update',
      receipt: { proposalId: 'proposal-1', projectId: 'main', resource: 'draft', draftId: 7, revision: 'a'.repeat(64), committedAt: '2026-09-29 00:00:00' },
      projectPath: 'C:\\novel',
      projectSession,
    })
    await vi.waitFor(() => {
      const cleanTab = useEditorStore.getState().tabs.find(tab => tab.id === 'tab-clean')
      expect(cleanTab?.content).toBe('外部提交后的正文')
    })

    const dirtyTab = useEditorStore.getState().tabs.find(tab => tab.id === 'tab-dirty')
    expect(dirtyTab?.content).toBe('作者的未保存正文')
    expect(dirtyTab?.dirty).toBe(true)
    expect(warningSpy).toHaveBeenCalledWith(expect.stringContaining('未被覆盖'))
    expect(refreshEvents).toEqual([expect.objectContaining({
      resources: ['drafts', 'fileTree'],
      projectPath: 'C:\\novel',
      projectSession,
    })])
    unsubscribeSync()
    unsubscribeRefresh()
  })

  it('drops commit events from a stale project session', async () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-2' } as never })
    const handlers = new Map<string, (...args: unknown[]) => void>()
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: {
        invoke: async () => { throw new Error('must not be called') },
        on: (channel: string, callback: (...args: unknown[]) => void) => {
          handlers.set(channel, callback)
          return () => handlers.delete(channel)
        },
        once: (channel: string, callback: (...args: unknown[]) => void) => {
          handlers.set(channel, callback)
          return () => handlers.delete(channel)
        },
        send: () => {},
      },
    })
    useEditorStore.setState(s => ({
      tabs: [
        ...s.tabs,
        { id: 'tab-stale', name: '第 1 章', type: 'chapter', projectKey: 'C:\\novel', filePath: 'vela://draft/7', content: '本地正文', dirty: false },
      ],
    }))

    const refreshEvents: Array<EventPayloadMap['REFRESH_RESOURCE']> = []
    const unsubscribeRefresh = globalEventBus.on('REFRESH_RESOURCE', payload => refreshEvents.push(payload))
    const warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => {})
    const unsubscribeSync = registerAgentProposalCommitSync()

    handlers.get('story-data:agent-proposal-committed')?.({
      proposalId: 'proposal-9',
      projectId: 'main',
      proposalType: 'propose_draft_update',
      receipt: { proposalId: 'proposal-9', projectId: 'main', resource: 'draft', draftId: 7, revision: 'a'.repeat(64), committedAt: '2026-09-29 00:00:00' },
      projectPath: 'C:\\novel',
      projectSession: { projectId: 'main', leaseId: 'old-lease', projectPath: 'C:\\novel' },
    })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(refreshEvents).toEqual([])
    expect(warningSpy).not.toHaveBeenCalled()
    expect(useEditorStore.getState().tabs.find(tab => tab.id === 'tab-stale')?.content).toBe('本地正文')
    unsubscribeSync()
    unsubscribeRefresh()
  })
})
