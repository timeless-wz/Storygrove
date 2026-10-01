import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import '../../../index.css'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { registerEditorExitSaveHandler, useEditorStore, type EditorTab } from '../../../stores/editor-store'
import { openBuiltinEditor, openChapterFile } from '../../panels/sidebar/sidebar-file-openers'
import ChapterOutlineSidebar from '../ChapterOutlineSidebar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn(async (channel: string) => {
  if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第一卷', sortOrder: 1 }]
  if (channel === 'db:blueprint-list-summary') return [
    { chapterNumber: 1, volumeId: 'volume-1', title: '雨夜' },
    { chapterNumber: 2, volumeId: 'volume-1', title: '回声' },
  ]
  if (channel === 'db:blueprint-v2-summary-list') return [{
    chapterNumber: 1, revision: 1, contentHash: 'a'.repeat(64), origin: 'import', updatedAt: '',
    sceneCount: 4, sceneTitles: ['雨夜开场', '青石村旧屋', '离村'], wordBudget: 3000,
  }]
  if (channel === 'db:draft-list-all') return [
    { id: 1, chapterNumber: 1, blueprintChapterNumber: 1, version: 1, status: 'draft' },
    { id: 2, chapterNumber: 1, blueprintChapterNumber: 1, version: 2, status: 'finalized' },
  ]
  return null
})

vi.mock('../../panels/sidebar/sidebar-file-openers', () => ({
  openChapterFile: vi.fn(async () => {}),
  openBuiltinEditor: vi.fn(),
}))

vi.mock('../../ui/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}))

const projectPath = 'D:/novels/outline-test'
const session = { projectId: 'outline-test', leaseId: 'lease-1', projectPath }
const tab: EditorTab = {
  id: 'current-tab', name: '雨夜', type: 'chapter', filePath: 'vela://draft/1',
  projectKey: projectPath, content: '', savedContent: '', dirty: false,
}
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: {
    id: session.projectId, sessionLease: session.leaseId, path: projectPath,
    name: '测试项目', novelConfig: {},
  } as never })
  setActiveProjectSessionContext(session)
  useEditorStore.setState({ tabs: [{ ...tab }], activeTabId: tab.id })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  setActiveProjectSessionContext(null)
  useEditorStore.getState().clearTabs()
  Reflect.deleteProperty(window, 'velaAPI')
  vi.clearAllMocks()
})

describe('chapter outline sidebar', () => {
  async function renderExpanded() {
    await act(async () => root.render(<ChapterOutlineSidebar tab={tab} />))
    const expand = container.querySelector<HTMLButtonElement>('.chapter-outline-toggle')
    expect(expand).toBeTruthy()
    if (expand?.getAttribute('aria-label') === '展开卷章目录') {
      await act(async () => expand.click())
    }
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
    })
  }

  it('shows the volume and opens published prose separately from its draft', async () => {
    await renderExpanded()
    expect(container.textContent).toContain('第 1 章')
    expect(container.textContent).toContain('草稿 v1')
    const manuscript = [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-target')]
      .find(button => button.textContent?.includes('正文 v2'))
    expect(manuscript).toBeTruthy()
    await act(async () => manuscript?.click())
    expect(openChapterFile).toHaveBeenCalledWith('vela://manuscript/2', expect.stringContaining('第 1 章'))
  })

  it('keeps the current chapter open when saving unsaved changes fails', async () => {
    useEditorStore.setState({ tabs: [{ ...tab, dirty: true }] })
    const unregister = registerEditorExitSaveHandler({
      tabId: tab.id, type: 'chapter', projectKey: projectPath,
      save: async () => { throw new Error('save failed') },
    })
    try {
      await renderExpanded()
      const manuscript = [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-target')]
        .find(button => button.textContent?.includes('正文 v2'))
      await act(async () => manuscript?.click())
      expect(openChapterFile).not.toHaveBeenCalled()
      expect(useEditorStore.getState().activeTabId).toBe(tab.id)
    } finally {
      unregister()
    }
  })

  it('opens a planned chapter in its blueprint', async () => {
    await renderExpanded()
    const planned = [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-chapter-button')]
      .find(button => button.textContent?.includes('第 2 章'))
    expect(planned).toBeTruthy()
    await act(async () => planned?.click())
    expect(openBuiltinEditor).toHaveBeenCalledWith(
      'chapter-card-editor', '章节蓝图', 'chapter-card', undefined, 2,
    )
  })

  it('keeps the outline beside prose on desktop and opens a drawer on narrow screens', async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    container.style.cssText = 'height:500px;display:flex;position:relative;overflow:hidden'
    await page.viewport(1440, 900)
    await renderExpanded()
    const sidebar = container.querySelector<HTMLElement>('.chapter-outline-sidebar')!
    expect(getComputedStyle(sidebar).position).not.toBe('absolute')
    expect(Math.round(sidebar.getBoundingClientRect().width)).toBe(238)
    await page.screenshot({ path: '../../../../output/playwright/chapter-outline-restored-desktop.png' })
    await act(async () => {
      await page.viewport(800, 700)
      await vi.waitFor(() => {
        window.dispatchEvent(new Event('resize'))
        expect(window.innerWidth).toBeLessThan(1024)
      })
    })
    expect(sidebar.classList.contains('is-narrow')).toBe(true)
    expect(getComputedStyle(sidebar).position).toBe('absolute')
    await page.screenshot({ path: '../../../../output/playwright/chapter-outline-restored-narrow.png' })
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-toggle')?.click())
    expect(sidebar.classList.contains('is-collapsed')).toBe(true)
    expect(container.querySelector('.chapter-outline-backdrop')).toBeNull()
  })
})
