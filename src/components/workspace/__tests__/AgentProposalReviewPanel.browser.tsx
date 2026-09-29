import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentProposalReviewPanel } from '../AgentProposalReviewPanel'
import { ipc } from '../../../services/ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import type { ProjectData } from '../../../shared/ipc-channels'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()
let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
  useProjectStore.setState(originalProjectState, true)
  useLocaleStore.setState(originalLocaleState, true)
})

describe('external AI proposal review', () => {
  it('shows both versions before the author can approve', async () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as ProjectData })
    const proposal = {
      proposalId: 'proposal-1', projectId: 'main', proposalType: 'propose_blueprint_update',
      status: 'pending', baseRevision: 'old', createdAt: '2026-09-28 00:00:00', approvable: true,
      payload: { chapterNumber: 1, blueprint: { chapterNumber: 1, title: '新标题' } },
    }
    const invoke = vi.spyOn(ipc, 'invokeWithProjectSession').mockImplementation((async (...args: unknown[]) => {
      const channel = args[1]
      if (channel === 'story-data:list-agent-proposals') return [proposal]
      if (channel === 'db:blueprint-get') return { chapterNumber: 1, title: '旧标题' }
      if (channel === 'story-data:approve-agent-proposal') return { success: true, proposalId: 'proposal-1' }
      throw new Error(`Unexpected channel: ${String(channel)}`)
    }) as typeof ipc.invokeWithProjectSession)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<AgentProposalReviewPanel />))
    await vi.waitFor(() => expect(container?.textContent).toContain('第 1 章蓝图'))
    await act(async () => {
      [...container!.querySelectorAll('button')].find(button => button.textContent?.includes('第 1 章蓝图'))?.click()
    })
    await vi.waitFor(() => expect(container?.textContent).toContain('旧标题'))
    expect(container.textContent).toContain('新标题')
    const approve = [...container.querySelectorAll('button')].find(button => button.textContent === '批准')
    expect(approve?.disabled).toBe(false)
    await act(async () => approve?.click())
    expect(invoke).toHaveBeenCalledWith(expect.any(Object), 'story-data:approve-agent-proposal', 'proposal-1', 'author', 'C:\\novel')
  })

  it('disables approval for a proposal whose MCP session expired', async () => {
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as ProjectData })
    const proposal = {
      proposalId: 'proposal-2', projectId: 'main', proposalType: 'propose_draft_update',
      status: 'pending', baseRevision: 'rev-1', createdAt: '2026-09-28 00:00:00', approvable: false,
      payload: { draftId: 7, content: '提案新稿' },
    }
    vi.spyOn(ipc, 'invokeWithProjectSession').mockImplementation((async (...args: unknown[]) => {
      const channel = args[1]
      if (channel === 'story-data:list-agent-proposals') return [proposal]
      if (channel === 'db:draft-get-full') return { content: '当前草稿内容' }
      throw new Error(`Unexpected channel: ${String(channel)}`)
    }) as typeof ipc.invokeWithProjectSession)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<AgentProposalReviewPanel />))
    await vi.waitFor(() => expect(container?.textContent).toContain('草稿 #7'))
    await act(async () => {
      [...container!.querySelectorAll('button')].find(button => button.textContent?.includes('草稿 #7'))?.click()
    })
    await vi.waitFor(() => expect(container?.textContent).toContain('当前草稿内容'))
    expect(container.textContent).toContain('提案会话已过期，请外部 Agent 重新提交')
    const approve = [...container.querySelectorAll('button')].find(button => button.textContent === '批准')
    expect(approve?.disabled).toBe(true)
  })
})
