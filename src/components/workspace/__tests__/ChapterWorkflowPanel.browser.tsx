import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChapterWorkflowPanel from '../ChapterWorkflowPanel'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkspaceHubStore } from '../../../stores/workspace-hub-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const originalLocale = useLocaleStore.getState(); const originalProject = useProjectStore.getState(); const originalHub = useWorkspaceHubStore.getState()
let root: Root; let container: HTMLDivElement; let invoke: ReturnType<typeof vi.fn>

beforeEach(async () => {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 31, title: '第31章 归来', purpose: '推进主线', keyEvents: '抵达遗迹；发现线索' }]
    if (channel === 'db:draft-list') return [{ id: 7, chapterNumber: 31, version: 1, status: 'finalized', source: 'write', contentId: 2, wordCount: 100, createdAt: '', updatedAt: '' }]
    if (channel === 'story-data:extract-finalized-draft') return [{ candidateId: 'c1' }]
    return []
  })
  Object.defineProperty(window, 'velaAPI', { configurable: true, value: { invoke } })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: { id: 'main', name: '测试', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
  useWorkspaceHubStore.setState({ targetChapterNumber: 31, activeTab: 'workbench' })
  setActiveProjectSessionContext({ projectId: 'main', leaseId: 'lease-1', projectPath: 'C:\\novel' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<ChapterWorkflowPanel />))
})

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); setActiveProjectSessionContext(null)
  useLocaleStore.setState(originalLocale, true); useProjectStore.setState(originalProject, true); useWorkspaceHubStore.setState(originalHub, true)
})

describe('ChapterWorkflowPanel browser acceptance', () => {
  it('presents the outline-to-finalization flow and extracts candidates from finalized prose only', async () => {
    expect(container.textContent).toContain('章节创作工作台')
    expect(container.textContent).toContain('上下文装配')
    expect(container.textContent).toContain('正文、审核、修订与定稿')
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('提取候选资料'))
    expect(button).toBeTruthy()
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(invoke.mock.calls.some(([channel]) => channel === 'story-data:extract-finalized-draft')).toBe(true)
    expect(container.textContent).toContain('等待作者确认')
  })
})
