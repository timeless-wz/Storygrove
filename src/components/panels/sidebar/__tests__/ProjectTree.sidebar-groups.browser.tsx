import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import type { ProjectData } from '../../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useDraftStore } from '../../../../stores/draft-store'
import { useEditorStore } from '../../../../stores/editor-store'
import { useLayoutStore } from '../../../../stores/layout-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectStore } from '../../../../stores/project-store'
import { useWorkflowStore } from '../../../../stores/workflow-store'
import ProjectTree from '../ProjectTree'

const PROJECT_PATH = 'C:\\novels\\sidebar-groups-test'
const PROJECT_SESSION = {
  projectId: 'sidebar-groups-test',
  leaseId: 'sidebar-groups-test-lease',
  projectPath: PROJECT_PATH,
}

const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Sidebar Groups Test',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '', subGenre: '', targetAudience: '', totalChapters: 10, wordsPerChapter: 3000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: 'Configured outline',
    worldSetting: '', goldenFinger: '', protagonistProfile: 'Hero', globalGuidance: '',
  },
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const originalDraftState = useDraftStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalLayoutState = useLayoutStore.getState()

let container: HTMLDivElement
let root: Root
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error')
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({
    currentProject: project,
    projectSessionEpoch: 1,
    fileTree: [],
    loading: false,
  })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useDraftStore.setState({
    draftsByChapter: {
      1: [
        {
          id: 101,
          chapterNumber: 1,
          chapterTitle: '第一章 启程',
          blueprintChapterNumber: 1,
          version: 1,
          status: 'draft',
          source: 'write',
          filePath: 'drafts/ch1/draft_1.md',
          fileName: 'draft_1.md',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    },
    loading: false,
    dataProjectKey: null,
    dataProjectSession: null,
    loadingProjectKey: null,
    loadingProjectSession: null,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useLayoutStore.setState({
    sidebarOpen: true,
    sidebarView: 'project',
    activeRailItem: 'project',
    characterViewRequest: null,
    projectTreeGroupOpen: {
      plan: true,
      setting: true,
      library: true,
      management: true,
      manuscript: true,
    },
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'fs:list-dir' || channel === 'db:draft-list-all' || channel === 'db:map-get-all') return []
        if (channel === 'db:blueprint-get-all') return []
        if (channel === 'db:project-core-get') {
          return { premise: 'Premise content', charactersArch: '', worldbuilding: '', synopsis: '' }
        }
        if (channel === 'db:character-roster-read') {
          return { status: 'ready', revision: 1, entries: [], renderedMarkdown: 'Character roster' }
        }
        if (channel === 'chapter:list-incomplete-deletions') return { success: true, operations: [] }
        return []
      }),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
    },
  })

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useDraftStore.setState(originalDraftState)
  useEditorStore.setState(originalEditorState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  useLayoutStore.setState(originalLayoutState)

  // 严格断言：测试执行过程无任何未处理的 IPC 控制台错误
  const ipcErrors = consoleErrorSpy.mock.calls.filter((args: unknown[]) =>
    args.some((arg: unknown) =>
      typeof arg === 'string'
      && (arg.includes('IPC') || arg.includes('Unexpected IPC') || arg.includes('loadAll error') || arg.includes('Error:'))
    )
  )
  expect(ipcErrors, 'There should be no unhandled IPC or general error calls in console.error').toEqual([])

  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

async function renderProjectTree(): Promise<void> {
  await act(async () => {
    root.render(<ProjectTree />)
  })
  await act(async () => {
    await vi.waitFor(() => {
      expect(container.querySelector('[data-group-id="plan"]')).not.toBeNull()
    })
  })
}

describe('ProjectTree shadcn/ui collapsible groups', () => {
  it('renders exactly 5 level-1 collapsible groups with icon, title, chevron arrow, and NO "+" button on headers', async () => {
    await renderProjectTree()

    const expectedGroups = [
      { id: 'setting', title: '故事设定' },
      { id: 'plan', title: '创作规划' },
      { id: 'manuscript', title: '正文写作' },
      { id: 'library', title: '资料库' },
      { id: 'management', title: '项目管理' },
    ]

    expect(container.querySelectorAll('[data-group-id]')).toHaveLength(expectedGroups.length)

    for (const group of expectedGroups) {
      const groupEl = container.querySelector(`[data-group-id="${group.id}"]`)
      expect(groupEl, `Group ${group.id} should exist`).not.toBeNull()

      const triggerBtn = groupEl?.querySelector('button[aria-expanded]') as HTMLButtonElement | null
      expect(triggerBtn, `Group ${group.id} trigger button should exist`).not.toBeNull()
      expect(triggerBtn?.getAttribute('aria-expanded')).toBe('true')
      expect(triggerBtn?.textContent).toContain(group.title)

      // 验证包含至少两个 svg 图标（左侧分组图标 + 右侧 Chevron 折叠箭头）
      const svgs = triggerBtn?.querySelectorAll('svg')
      expect(svgs?.length, `Group ${group.id} should have group icon and chevron icon`).toBeGreaterThanOrEqual(2)

      // 严格要求：一级分组标题栏内绝对不包含 "+" 按钮或新建操作按钮
      const plusButtons = Array.from(triggerBtn?.querySelectorAll('button') ?? [])
      expect(plusButtons.length, `Group ${group.id} header should not have nested buttons`).toBe(0)
      expect(triggerBtn?.textContent).not.toContain('+')
      expect(triggerBtn?.textContent).not.toContain('新建')
    }
  })

  it('renders the required author-task order: overview pinned on top, then setup, plan, drafting, library, management', async () => {
    await renderProjectTree()

    // 五个一级分组在 DOM 中严格按「故事设定 → 创作规划 → 正文写作 → 资料库 → 项目管理」排列
    const orderedIds = Array.from(container.querySelectorAll('[data-group-id]'))
      .map(groupEl => groupEl.getAttribute('data-group-id'))
    expect(orderedIds).toEqual(['setting', 'plan', 'manuscript', 'library', 'management'])

    // 「项目总览」固定在项目树最上方，先于所有分组出现
    const overviewRow = Array.from(container.querySelectorAll<HTMLElement>('.tree-item, .writer-tree-item'))
      .find(el => el.textContent?.includes('项目总览'))
    expect(overviewRow, 'Project overview entry should exist').toBeDefined()
    const firstGroup = container.querySelector('[data-group-id="setting"]')!
    expect(
      overviewRow!.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
      'Project overview must precede every collapsible group',
    ).toBeTruthy()
  })

  it('keeps only draft and manuscript entrances in the main tree and opens their second-level directories', async () => {
    await renderProjectTree()
    const manuscript = container.querySelector('[data-group-id="manuscript"]')!
    expect(manuscript.textContent).not.toContain('新建草稿')
    expect(manuscript.textContent).not.toContain('新建章节')
    const entrances = [...manuscript.querySelectorAll<HTMLElement>('[role="button"]')]
    const drafts = entrances.find(item => item.textContent === '草稿箱')!
    const prose = entrances.find(item => item.textContent === '正文章节')!
    expect(drafts).toBeTruthy()
    expect(prose).toBeTruthy()
    await act(async () => drafts.click())
    expect(useEditorStore.getState().tabs.find(tab => tab.id === useEditorStore.getState().activeTabId)).toMatchObject({ type: 'chapter-directory', proseDirectoryKind: 'draft', projectKey: PROJECT_SESSION.projectPath })
    await act(async () => prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(useEditorStore.getState().tabs.find(tab => tab.id === useEditorStore.getState().activeTabId)).toMatchObject({ type: 'chapter-directory', proseDirectoryKind: 'manuscript', projectKey: PROJECT_SESSION.projectPath })
  })

  it('toggles collapse/expand when group header is clicked and updates aria-expanded and store state', async () => {
    await renderProjectTree()

    const planGroup = container.querySelector('[data-group-id="plan"]')!
    const triggerBtn = planGroup.querySelector('button[aria-expanded]') as HTMLButtonElement

    // 展开状态：子项（如多地图地图册、章节蓝图）可见
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('true')
    expect(planGroup.textContent).toContain('多地图地图册')
    expect(planGroup.textContent).toContain('章节蓝图')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(true)

    // 点击折叠
    await act(async () => {
      triggerBtn.click()
    })

    // 收起状态：aria-expanded 更新为 false，store 同步，子项不再渲染
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('false')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(false)
    expect(planGroup.textContent).not.toContain('多地图地图册')
    expect(planGroup.textContent).not.toContain('章节蓝图')

    // 再次点击展开
    await act(async () => {
      triggerBtn.click()
    })

    // 恢复展开
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('true')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(true)
    expect(planGroup.textContent).toContain('多地图地图册')
    expect(planGroup.textContent).toContain('章节蓝图')
  })

  it('allows navigating items in other expanded groups when one group is collapsed', async () => {
    await renderProjectTree()

    // 先折叠「创作规划」
    const planTrigger = container.querySelector('[data-group-id="plan"] button[aria-expanded]') as HTMLButtonElement
    await act(async () => {
      planTrigger.click()
    })
    expect(planTrigger.getAttribute('aria-expanded')).toBe('false')

    // 验证「故事设定」中的「创作参数」仍可点击打开编辑器
    const settingGroup = container.querySelector('[data-group-id="setting"]')!
    const configRow = Array.from(settingGroup.querySelectorAll<HTMLElement>('.tree-item, .writer-tree-item'))
      .find(el => el.textContent?.includes('创作参数'))
    expect(configRow, 'Creative parameters item should be accessible').toBeDefined()

    await act(async () => {
      configRow?.click()
    })
    expect(useEditorStore.getState().tabs.some(t => t.type === 'config')).toBe(true)

    // 验证「故事设定」中的「角色档案」仍可点击切换视图
    const characterRow = Array.from(settingGroup.querySelectorAll<HTMLElement>('.tree-item, .writer-tree-item'))
      .find(el => el.textContent?.includes('角色档案'))
    expect(characterRow, 'Character profile item should be accessible').toBeDefined()

    await act(async () => {
      characterRow?.click()
    })
    expect(useLayoutStore.getState().sidebarView).toBe('characters')

    // 验证「资料库」中的「项目文档」可点击切换视图
    const libraryGroup = container.querySelector('[data-group-id="library"]')!
    const docsRow = Array.from(libraryGroup.querySelectorAll<HTMLElement>('.tree-item, .writer-tree-item'))
      .find(el => el.textContent?.includes('项目文档'))
    expect(docsRow, 'Project documents item should be accessible').toBeDefined()

    await act(async () => {
      docsRow?.click()
    })
    expect(useLayoutStore.getState().sidebarView).toBe('documents')
  })

  it('supports real browser keyboard operation on group header (focus, Enter, Space with single toggle each time)', async () => {
    await renderProjectTree()

    const planGroup = container.querySelector('[data-group-id="plan"]')!
    const triggerBtn = planGroup.querySelector('button[aria-expanded]') as HTMLButtonElement

    // 验证初始状态：展开
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('true')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(true)

    // 验证具备可见焦点环与 outline 无障碍样式类
    expect(triggerBtn.className).toContain('focus-visible:ring-2')
    expect(triggerBtn.className).toContain('focus-visible:outline-none')

    // 1. 先 focus 分组标题
    triggerBtn.focus()
    expect(document.activeElement).toBe(triggerBtn)

    // 2. 真实按 Enter；断言由展开变收起，每次操作后只发生一次状态改变，aria-expanded 与 projectTreeGroupOpen.plan 一致
    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('false')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(false)
    expect(planGroup.textContent).not.toContain('多地图地图册')

    // 3. 再次真实按 Enter；断言由收起变展开，只发生一次改变
    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('true')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(true)
    expect(planGroup.textContent).toContain('多地图地图册')

    // 4. 真实按 Space；断言由展开变收起，只发生一次改变
    await act(async () => {
      await userEvent.keyboard('{Space}')
    })
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('false')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(false)
    expect(planGroup.textContent).not.toContain('多地图地图册')

    // 5. 再次真实按 Space；断言由收起变展开，只发生一次改变
    await act(async () => {
      await userEvent.keyboard('{Space}')
    })
    expect(triggerBtn.getAttribute('aria-expanded')).toBe('true')
    expect(useLayoutStore.getState().projectTreeGroupOpen.plan).toBe(true)
    expect(planGroup.textContent).toContain('多地图地图册')
  })

  it('supports real browser keyboard operation on leaf items (focus and Enter activates item)', async () => {
    await renderProjectTree()

    const settingGroup = container.querySelector('[data-group-id="setting"]')!
    const characterRow = Array.from(settingGroup.querySelectorAll<HTMLElement>('.tree-item, .writer-tree-item'))
      .find(el => el.textContent?.includes('角色档案'))!

    expect(characterRow.getAttribute('role')).toBe('button')
    expect(characterRow.getAttribute('tabindex')).toBe('0')
    expect(characterRow.className).toContain('focus-visible:ring-2')

    // 真实 focus 并按 Enter 键触发激活
    characterRow.focus()
    expect(document.activeElement).toBe(characterRow)
    await act(async () => {
      await userEvent.keyboard('{Enter}')
    })
    expect(useLayoutStore.getState().sidebarView).toBe('characters')
  })

  it('executes cleanly without any unhandled IPC console errors', async () => {
    await renderProjectTree()
    const ipcErrors = consoleErrorSpy.mock.calls.filter((args: unknown[]) =>
      args.some((arg: unknown) =>
        typeof arg === 'string'
        && (arg.includes('IPC') || arg.includes('Unexpected IPC') || arg.includes('loadAll error'))
      )
    )
    expect(ipcErrors).toHaveLength(0)
  })
})
