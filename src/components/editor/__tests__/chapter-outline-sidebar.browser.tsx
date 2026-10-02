import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import '../../../index.css'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { registerEditorExitSaveHandler, useEditorStore, type EditorTab } from '../../../stores/editor-store'
import { openChapterFile } from '../../panels/sidebar/sidebar-file-openers'
import ChapterOutlineSidebar from '../ChapterOutlineSidebar'
import { confirm } from '../../ui/Confirm'
import { deleteFinalizedChapter } from '../../panels/sidebar/finalized-chapter-deletion'
import { useDraftStore } from '../../../stores/draft-store'
import { globalEventBus } from '../../../shared/event-bus'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(async (channel: string) => {
  if (channel === 'db:prose-volume-list') return [{ id: 'volume-1', name: '第一卷', sortOrder: 1 }]
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

vi.mock('../../ui/Confirm', () => ({ confirm: vi.fn(async () => true) }))
vi.mock('../../panels/sidebar/finalized-chapter-deletion', () => ({ deleteFinalizedChapter: vi.fn(async () => null) }))

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
  async function renderExpanded(kind: 'draft' | 'manuscript' = 'draft') {
    await act(async () => root.render(<ChapterOutlineSidebar tab={{ ...tab, proseDirectoryKind: kind }} />))
    const expand = container.querySelector<HTMLButtonElement>('.chapter-outline-toggle')
    expect(expand).toBeTruthy()
    if (expand?.getAttribute('aria-label') === '展开卷章目录') {
      await act(async () => expand.click())
    }
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
    })
    const arrow = container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')
    if (arrow?.getAttribute('aria-expanded') === 'false') await act(async () => arrow.click())
  }

  it('opens published prose from its own directory without mixing draft entries', async () => {
    await renderExpanded('manuscript')
    expect(container.textContent).toContain('第 1 章')
    expect(container.textContent).not.toContain('草稿 v1')
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
      await renderExpanded('manuscript')
      const manuscript = [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-target')]
        .find(button => button.textContent?.includes('正文 v2'))
      await act(async () => manuscript?.click())
      expect(openChapterFile).not.toHaveBeenCalled()
      expect(useEditorStore.getState().activeTabId).toBe(tab.id)
    } finally {
      unregister()
    }
  })

  it('omits blueprint-only chapters and scene badges from the prose directory', async () => {
    await renderExpanded()
    const planned = [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-chapter-button')]
      .find(button => button.textContent?.includes('第 2 章'))
    expect(planned).toBeUndefined()
    expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(1)
    expect(container.querySelector('.chapter-outline-volume-button small')?.textContent).toBe('1')
    expect(container.textContent).not.toContain('章节蓝图')
    expect(container.querySelector('.chapter-outline-scene-count')).toBeNull()
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-v2-summary-list')).toBe(false)
  })

  it('shows a prose empty state when only blueprints exist', async () => {
    invoke.mockImplementationOnce(async () => [{ id: 'volume-1', name: '第一卷', sortOrder: 1 }])
      .mockImplementationOnce(async () => [{ chapterNumber: 1, volumeId: 'volume-1', title: '只有细纲' }])
      .mockImplementationOnce(async () => [])
    await act(async () => root.render(<ChapterOutlineSidebar tab={tab} />))
    const toggle = container.querySelector<HTMLButtonElement>('.chapter-outline-toggle')!
    if (toggle.getAttribute('aria-label') === '展开卷章目录') await act(async () => toggle.click())
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
    })
    expect(container.querySelector('.chapter-outline-volume')).not.toBeNull()
    expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(0)
  })

  it('refreshes actual prose records after creation without adding blueprint-only rows', async () => {
    await renderExpanded()
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async channel => channel === 'db:draft-list-all'
      ? [{ id: 3, chapterNumber: 2, blueprintChapterNumber: 2, version: 1, status: 'draft' }]
      : original(channel))
    try {
      await act(async () => {
        globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'], projectPath, projectSession: session })
      })
      await vi.waitFor(() => expect(container.textContent).toContain('第 2 章'))
      expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(1)
      expect(container.querySelector('.chapter-outline-volume-button small')?.textContent).toBe('1')
    } finally {
      invoke.mockImplementation(original)
    }
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

  it('keeps prose accessible when supplementary volume information fails, then recovers on refresh', async () => {
    await renderExpanded('manuscript')
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async channel => {
      if (channel === 'db:blueprint-list-summary') throw new Error('summary unavailable')
      return original(channel)
    })
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-refresh')!.click())
      await vi.waitFor(() => expect(container.textContent).toContain('卷信息读取失败'))
      expect(container.textContent).toContain('未归卷')
      await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
      const manuscript = [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-target')]
        .find(button => button.textContent?.includes('正文 v2'))!
      await act(async () => manuscript.click())
      expect(openChapterFile).toHaveBeenCalledWith('vela://manuscript/2', expect.any(String))
      invoke.mockImplementation(original)
      if (!container.querySelector('.chapter-outline-refresh')) {
        await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-toggle')!.click())
      }
      await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-refresh')!.click())
      await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
      expect(container.textContent).not.toContain('卷信息读取失败')
    } finally {
      invoke.mockImplementation(original)
    }
  })

  it('ignores an older refresh result arriving after a newly created prose record', async () => {
    await renderExpanded()
    const original = invoke.getMockImplementation()!
    let releaseOld!: (value: Awaited<ReturnType<typeof original>>) => void
    const oldResponse = new Promise<Awaited<ReturnType<typeof original>>>(resolve => { releaseOld = resolve })
    let reads = 0
    invoke.mockImplementation(async channel => {
      if (channel !== 'db:draft-list-all') return original(channel)
      if (++reads === 1) return oldResponse
      return [{ id: 3, chapterNumber: 2, blueprintChapterNumber: 2, version: 1, status: 'draft' }]
    })
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-refresh')!.click())
      await act(async () => {
        globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'], projectPath, projectSession: session })
      })
      await vi.waitFor(() => expect(container.textContent).toContain('第 2 章'))
      await act(async () => releaseOld(await original('db:draft-list-all')))
      expect(container.textContent).toContain('第 2 章')
      expect(container.textContent).not.toContain('第 1 章')
      expect(container.querySelector('.chapter-outline-volume-button small')?.textContent).toBe('1')
    } finally {
      invoke.mockImplementation(original)
    }
  })
})

describe('two-level prose directory', () => {
  async function renderDirectory(kind: 'draft' | 'manuscript') {
    await act(async () => root.render(<ChapterOutlineSidebar tab={{ ...tab, type: 'chapter-directory', proseDirectoryKind: kind }} />))
    await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
  }
  it('starts with collapsed volumes, selects by name, expands only by arrow and filters prose states', async () => {
    await renderDirectory('draft')
    expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(0)
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-volume-button')!.click())
    expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(0)
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
    expect(container.textContent).toContain('草稿 v1')
    expect(container.textContent).not.toContain('正文 v2')
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
    expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(0)
  })
  it('shows finalized chapters only in the manuscript entrance', async () => {
    await renderDirectory('manuscript')
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
    expect(container.textContent).toContain('正文 v2')
    expect(container.textContent).not.toContain('草稿 v1')
  })
  it('adds an empty volume and creates an unbound chapter in the selected volume', async () => {
    const original = invoke.getMockImplementation()!
    const calls: Array<[string, unknown[]]> = []
    const volumes = [{ id: 'volume-1', name: '第一卷', sortOrder: 1 }]
    const loadDrafts = vi.spyOn(useDraftStore.getState(), 'loadChapterDrafts').mockResolvedValue(undefined)
    invoke.mockImplementation(async (channel, ...args: unknown[]) => {
      calls.push([channel, args])
      if (channel === 'db:prose-volume-list') return volumes
      if (channel === 'db:blueprint-volume-upsert') { volumes.push(args[0] as typeof volumes[0]); return { success: true } }
      if (channel === 'db:draft-next-version') return 1
      if (channel === 'db:draft-create') return { success: true, id: 9 }
      return original(channel)
    })
    try {
      await renderDirectory('draft')
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.chapter-outline-actions button')].find(item => item.textContent === '添加卷')!.click())
      await page.getByRole('textbox', { name: '卷名称（留空自动编号）' }).fill('第2卷')
      await page.getByRole('button', { name: '创建卷', exact: true }).click()
      await vi.waitFor(() => expect(container.textContent).toContain('第2卷'))
      const volume = [...container.querySelectorAll<HTMLElement>('.chapter-outline-volume')].find(item => item.textContent?.includes('第2卷'))!
      expect(volume.querySelectorAll('.chapter-outline-chapter')).toHaveLength(0)
      await act(async () => volume.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
      expect(volume.textContent).toContain('暂无章节')
      await act(async () => volume.querySelector<HTMLButtonElement>('button[aria-label="向第2卷添加章节"]')!.click())
      expect(document.body.textContent).toContain('所属卷：第2卷')
      await page.getByRole('textbox', { name: '章节名称' }).fill('新增章节名称')
      await page.getByRole('button', { name: '创建并开始写作' }).click()
      await vi.waitFor(() => expect(calls.some(([channel]) => channel === 'db:draft-create')).toBe(true))
      const created = calls.find(([channel]) => channel === 'db:draft-create')![1][0] as Record<string, unknown>
      expect(created).toMatchObject({ chapterNumber: 2, volumeId: volumes[1].id, chapterTitle: '新增章节名称', source: 'write' })
      expect(created).not.toHaveProperty('blueprintChapterNumber')
      expect(useEditorStore.getState().tabs.find(item => item.draftId === 9)).toMatchObject({ type: 'chapter', proseDirectoryKind: 'draft' })
    } finally { invoke.mockImplementation(original); loadDrafts.mockRestore() }
  })
  it('moves a chapter through the explicit assignment channel and preserves the dialog after failure', async () => {
    const original = invoke.getMockImplementation()!
    const calls: unknown[][] = []
    let refuse = true
    invoke.mockImplementation(async (channel, ...args: unknown[]) => {
      if (channel === 'db:chapter-volume-set') { calls.push(args); return refuse ? { success: false, error: '移动失败' } : { success: true } }
      return original(channel)
    })
    try {
      await renderDirectory('draft')
      await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
      await page.getByRole('button', { name: '移动第 1 章到卷' }).click()
      await page.getByRole('combobox', { name: '目标卷' }).selectOptions('')
      await page.getByRole('button', { name: '确认移动' }).click()
      expect(document.querySelector('#prose-move-volume')).not.toBeNull()
      refuse = false
      await page.getByRole('button', { name: '确认移动' }).click()
      await vi.waitFor(() => expect(document.querySelector('#prose-move-volume')).toBeNull())
      expect(calls[0].slice(0, 3)).toEqual([1, null, projectPath])
    } finally { invoke.mockImplementation(original) }
  })
})

it('captures the second-level directory on desktop and narrow screens with usable creation controls', async () => {
  document.documentElement.setAttribute('data-theme', 'light')
  container.style.cssText = 'height:600px;display:flex;position:relative;overflow:hidden;background:var(--color-bg)'
  await page.viewport(1280, 820)
  await act(async () => root.render(<><ChapterOutlineSidebar tab={{ ...tab, type: 'chapter-directory', proseDirectoryKind: 'draft' }} /><div className="chapter-directory-empty" style={{ flex: 1 }}>展开左侧的卷，选择章节开始写作；也可以添加卷或章节。</div></>))
  await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
  await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
  expect(container.textContent).toContain('添加章节')
  await page.screenshot({ path: '../../../../output/playwright/prose-directory-desktop.png' })
  await act(async () => {
    await page.viewport(800, 700)
    window.dispatchEvent(new Event('resize'))
  })
  await vi.waitFor(() => expect(container.querySelector('.chapter-outline-sidebar.is-narrow')).not.toBeNull())
  await page.screenshot({ path: '../../../../output/playwright/prose-directory-narrow.png' })
})

it('places chapter creation inside a selected volume and retains volume/draft deletion actions', async () => {
  const original = invoke.getMockImplementation()!
  const calls: string[] = []
  const loadDrafts = vi.spyOn(useDraftStore.getState(), 'loadChapterDrafts').mockResolvedValue(undefined)
  invoke.mockImplementation(async (channel, ...args: unknown[]) => {
    calls.push(channel)
    if (channel === 'db:draft-delete' || channel === 'db:prose-volume-delete') return { success: true }
    return original(channel, ...args)
  })
  try {
    await act(async () => root.render(<ChapterOutlineSidebar tab={{ ...tab, type: 'chapter-directory', proseDirectoryKind: 'draft' }} />))
    await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
    expect(container.querySelector('.chapter-outline-actions')?.textContent).not.toContain('添加章节')
    expect(container.querySelector('.chapter-outline-volume-actions')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-volume-button')!.click())
    expect(container.querySelector('.chapter-outline-volume-actions')?.textContent).toContain('添加章节')
    expect(container.querySelectorAll('.chapter-outline-chapter')).toHaveLength(0)
    await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
    await page.getByRole('button', { name: '删除第 1 章草稿 v1' }).click()
    await vi.waitFor(() => expect(calls).toContain('db:draft-delete'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('这一稿'), expect.objectContaining({ danger: true }))
    await page.getByRole('button', { name: '删除第一卷', exact: true }).click()
    await vi.waitFor(() => expect(calls).toContain('db:prose-volume-delete'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('未归卷'), expect.objectContaining({ danger: true }))
  } finally { invoke.mockImplementation(original); loadDrafts.mockRestore() }
})

it('routes finalized prose deletion through the existing publication cleanup action', async () => {
  await act(async () => root.render(<ChapterOutlineSidebar tab={{ ...tab, type: 'chapter-directory', proseDirectoryKind: 'manuscript' }} />))
  await vi.waitFor(() => expect(container.textContent).toContain('第一卷'))
  await act(async () => container.querySelector<HTMLButtonElement>('.chapter-outline-arrow[aria-expanded]')!.click())
  await page.getByRole('button', { name: '删除第 1 章正文 v2' }).click()
  expect(deleteFinalizedChapter).toHaveBeenCalledWith(expect.objectContaining({ draftId: 2, chapterNumber: 1, surface: 'manuscript', projectPath }))
  expect(invoke.mock.calls.some(([channel]) => channel === 'db:draft-delete')).toBe(false)
})
