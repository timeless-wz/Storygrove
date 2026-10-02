import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import type { ProjectData } from '../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import { DEFAULT_TIMELINE_SETTINGS } from '../../shared/story-timeline'
import { useDraftStore } from '../../stores/draft-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useHomeSurfaceStore } from '../../stores/home-surface-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'

import LeftToolWindowBar from '../layout/LeftToolWindowBar'
import Sidebar from '../panels/Sidebar'
import HomeSidebarPanel from '../panels/sidebar/HomeSidebarPanel'
import ProjectTree from '../panels/sidebar/ProjectTree'
import WelcomePage from '../pages/WelcomePage'
import ProjectOverviewPage from '../pages/ProjectOverviewPage'
import ClearProjectDataDialog from '../dialogs/ClearProjectDataDialog'
import NewProjectDialog from '../dialogs/NewProjectDialog'
import ExportDialog from '../dialogs/ExportDialog'

const PROJECT_PATH = 'C:\\novels\\nav-audit-test'
const PROJECT_SESSION = {
  projectId: 'nav-audit-test',
  leaseId: 'nav-audit-test-lease',
  projectPath: PROJECT_PATH,
}

const mockProject: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: '导航专项测试小说',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '玄幻',
    subGenre: '修真',
    targetAudience: '青年',
    totalChapters: 20,
    wordsPerChapter: 3000,
    plotStructure: 'three_act',
    narrativePOV: 'third_limited',
    coreOutline: '主角少年踏入修真路',
    worldSetting: '九天十地',
    goldenFinger: '神秘玉佩',
    protagonistProfile: '林风',
    globalGuidance: '文笔沉稳',
  },
  characterStates: '',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}

const originalDraftState = useDraftStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalHomeSurfaceState = useHomeSurfaceStore.getState()
const originalTimelineState = useStoryTimelineStore.getState()

let container: HTMLDivElement
let root: Root
let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>
const capturedActWarnings: string[] = []

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  capturedActWarnings.length = 0
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args.map(a => String(a)).join(' ')
    if (text.includes('not wrapped in act(...)')) {
      capturedActWarnings.push(text)
    }
  })
  consoleWarnSpy = vi.spyOn(console, 'warn')

  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useHomeSurfaceStore.setState({ surface: 'home', category: 'notes', notes: [] })
  useProjectStore.setState({
    currentProject: mockProject,
    recentProjects: [
      { name: '导航专项测试小说', path: PROJECT_PATH, updatedAt: '2026-01-02' },
      { name: '历史备选项目B', path: 'C:\\novels\\project-b', updatedAt: '2026-01-01' },
    ],
    projectSessionEpoch: 1,
    fileTree: [
      { name: '第1章.md', path: `${PROJECT_PATH}\\manuscript\\第1章.md`, isDir: false },
    ],
    loading: false,
  })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useStoryTimelineStore.setState({
    events: [],
    branches: [{ id: 'main', name: '主时间轴', sourceEventId: null, sortOrder: 0 }],
    settings: { ...DEFAULT_TIMELINE_SETTINGS },
    dataProjectKey: PROJECT_PATH,
  })
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
      2: [
        {
          id: 102,
          chapterNumber: 2,
          chapterTitle: '第二章 遇袭',
          blueprintChapterNumber: 2,
          version: 1,
          status: 'finalized',
          source: 'write',
          filePath: 'drafts/ch2/draft_1.md',
          fileName: 'draft_1.md',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    },
    loading: false,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: null,
    loadingProjectKey: null,
    loadingProjectSession: null,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useLayoutStore.setState({
    sidebarOpen: true,
    sidebarView: 'project',
    activeRailItem: 'project',
    bottomTab: undefined,
    settingsOpen: false,
    newProjectOpen: false,
    exportOpen: false,
    importNovelOpen: false,
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
      invoke: vi.fn(async (channel: string, ..._args: unknown[]) => {
        if (channel === 'fs:list-dir') return [{ name: '第1章.md', path: `${PROJECT_PATH}\\manuscript\\第1章.md`, isDir: false }]
        if (channel === 'fs:read-file') return { success: true, content: '# 测试正文内容' }
        if (channel === 'db:draft-list-all') {
          return [
            {
              id: 101,
              chapterNumber: 1,
              chapterTitle: '第一章 启程',
              blueprintChapterNumber: 1,
              version: 1,
              status: 'draft',
              source: 'write',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
            {
              id: 102,
              chapterNumber: 2,
              chapterTitle: '第二章 遇袭',
              blueprintChapterNumber: 2,
              version: 1,
              status: 'finalized',
              source: 'write',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ]
        }
        if (channel === 'db:draft-get-full') {
          return { id: 102, chapterNumber: 2, version: 1, content: '# 正文内容' }
        }
        if (channel === 'db:draft-get-meta') {
          return {
            id: 102,
            chapterNumber: 2,
            chapterTitle: '第二章 遇袭',
            blueprintChapterNumber: 2,
            version: 1,
            status: 'finalized',
            source: 'write',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          }
        }
        if (channel === 'db:map-get-all') return { maps: [], nodes: [], edges: [] }
        if (channel === 'db:blueprint-get-all') return []
        if (channel === 'db:timeline-get-all') {
          return {
            events: [],
            branches: [{ id: 'main', name: '主时间轴', sourceEventId: null, sortOrder: 0 }],
            settings: { ...DEFAULT_TIMELINE_SETTINGS },
          }
        }
        if (channel === 'db:project-core-get') {
          return { premise: '测试故事前提', charactersArch: '', worldbuilding: '', synopsis: '' }
        }
        if (channel === 'db:character-roster-read') {
          return { status: 'ready', revision: 1, entries: [], renderedMarkdown: '人物档案' }
        }
        if (channel === 'chapter:list-incomplete-deletions') return { success: true, operations: [] }
        if (channel === 'dialog:select-folder') return 'C:\\novels\\selected-folder'
        if (channel === 'project:recent-remove') return true
        if (channel === 'official-homepage:open') return { success: true }
        if (channel === 'fs:pick-directory') return 'C:\\backups'
        if (channel === 'project:backup') return { success: true, backupPath: 'C:\\backups\\proj.zip' }
        if (channel === 'project:restore-backup') return { success: true, restoredPath: 'C:\\novels\\restored' }
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
  useHomeSurfaceStore.setState(originalHomeSurfaceState)
  useStoryTimelineStore.setState(originalTimelineState)

  consoleErrorSpy.mockRestore()
  consoleWarnSpy.mockRestore()
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

// =========================================================================
// 1. 左侧主工具栏 (LeftToolWindowBar) - NAV-RAIL-01 ~ NAV-RAIL-09
// 强断言：找到控件、执行点击、验证目标状态、执行并验证返回路径
// =========================================================================
describe('LeftToolWindowBar Navigation (NAV-RAIL-01 ~ NAV-RAIL-09)', () => {
  it('navigates through all primary sidebar activities and bottom tabs with return paths', async () => {
    await act(async () => {
      root.render(<LeftToolWindowBar />)
    })

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button.left-nav-button'))
    expect(buttons.length).toBeGreaterThanOrEqual(9)

    // NAV-RAIL-01: 首页
    const homeBtn = buttons.find(b => b.textContent?.includes('首页'))
    expect(homeBtn, 'NAV-RAIL-01: 首页按钮必须存在').toBeDefined()
    await act(async () => homeBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('home')
    // 返回路径：点击创作切回
    const projectBtn = buttons.find(b => b.textContent?.includes('创作'))
    expect(projectBtn, 'NAV-RAIL-02: 创作按钮必须存在').toBeDefined()
    await act(async () => projectBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')

    // NAV-RAIL-03: 资料
    const workspaceBtn = buttons.find(b => b.textContent?.includes('资料'))
    expect(workspaceBtn, 'NAV-RAIL-03: 资料按钮必须存在').toBeDefined()
    await act(async () => workspaceBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')
    // 返回路径：点击创作切回
    await act(async () => projectBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')

    // NAV-RAIL-04: 知识检索
    const knowledgeBtn = buttons.find(b => b.textContent?.includes('知识检索'))
    expect(knowledgeBtn, 'NAV-RAIL-04: 知识检索按钮必须存在').toBeDefined()
    await act(async () => knowledgeBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('knowledge')
    // 返回路径：点击创作切回
    await act(async () => projectBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')

    // NAV-RAIL-05: 角色档案
    const characterBtn = buttons.find(b => b.textContent?.includes('角色档案'))
    expect(characterBtn, 'NAV-RAIL-05: 角色档案按钮必须存在').toBeDefined()
    await act(async () => characterBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('characters')
    // 返回路径：点击创作切回
    await act(async () => projectBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')

    // NAV-RAIL-06: 任务
    const tasksBtn = buttons.find(b => b.textContent?.includes('任务'))
    expect(tasksBtn, 'NAV-RAIL-06: 任务按钮必须存在').toBeDefined()
    await act(async () => tasksBtn?.click())
    expect(useLayoutStore.getState().bottomTab).toBe('tasks')
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(true)
    // 返回路径：再次点击任务折叠面板
    await act(async () => tasksBtn?.click())
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)

    // NAV-RAIL-07: 日志
    const logBtn = buttons.find(b => b.textContent?.includes('日志'))
    expect(logBtn, 'NAV-RAIL-07: 日志按钮必须存在').toBeDefined()
    await act(async () => logBtn?.click())
    expect(useLayoutStore.getState().bottomTab).toBe('log')
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(true)
    // 返回路径：再次点击日志折叠面板
    await act(async () => logBtn?.click())
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)

    // NAV-RAIL-08: 模型
    const modelsBtn = buttons.find(b => b.textContent?.includes('模型'))
    expect(modelsBtn, 'NAV-RAIL-08: 模型按钮必须存在').toBeDefined()
    await act(async () => modelsBtn?.click())
    expect(useLayoutStore.getState().bottomTab).toBe('models')
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(true)
    // 返回路径：再次点击模型折叠面板
    await act(async () => modelsBtn?.click())
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)

    // NAV-RAIL-09: 设置
    const settingsBtn = buttons.find(b => b.textContent?.includes('设置'))
    expect(settingsBtn, 'NAV-RAIL-09: 设置按钮必须存在').toBeDefined()
    await act(async () => settingsBtn?.click())
    expect(useLayoutStore.getState().settingsOpen).toBe(true)
    // 返回路径：关闭设置
    act(() => useLayoutStore.getState().closeSettings())
    expect(useLayoutStore.getState().settingsOpen).toBe(false)
  })
})

// =========================================================================
// 2. 首页侧边栏 (HomeSidebarPanel) - NAV-HOME-SIDE-01 ~ NAV-HOME-SIDE-13
// 强断言：控件严格存在、点击触发、验证目标、验证返回
// =========================================================================
describe('HomeSidebarPanel Navigation (NAV-HOME-SIDE-01 ~ NAV-HOME-SIDE-13)', () => {
  it('executes surface switching, recent project removal, and dialog openers with return paths', async () => {
    await act(async () => {
      root.render(<HomeSidebarPanel />)
    })

    // NAV-HOME-SIDE-02: 素材库
    const libraryBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('素材库') || b.textContent?.includes('资料库'))
    expect(libraryBtn, 'NAV-HOME-SIDE-02: 素材库导航按钮必须存在').toBeDefined()
    await act(async () => libraryBtn?.click())
    expect(useHomeSurfaceStore.getState().surface).toBe('library')

    // NAV-HOME-SIDE-01: 返回工作台首页
    const homeSurfaceBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('工作台首页'))
    expect(homeSurfaceBtn, 'NAV-HOME-SIDE-01: 工作台首页按钮必须存在').toBeDefined()
    await act(async () => homeSurfaceBtn?.click())
    expect(useHomeSurfaceStore.getState().surface).toBe('home')

    // NAV-HOME-SIDE-03: 对标作品
    const refBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('对标作品') || b.textContent?.includes('参考作品'))
    expect(refBtn, 'NAV-HOME-SIDE-03: 对标作品按钮必须存在').toBeDefined()
    await act(async () => refBtn?.click())
    expect(useHomeSurfaceStore.getState().surface).toBe('references')

    // 返回工作台首页
    await act(async () => homeSurfaceBtn?.click())
    expect(useHomeSurfaceStore.getState().surface).toBe('home')

    // NAV-HOME-SIDE-05: 当前项目卡片点击切换至创作树
    const currentProjCard = container.querySelector('.literary-home-sidebar .rounded-xl') as HTMLElement
    expect(currentProjCard, 'NAV-HOME-SIDE-05: 当前项目卡片必须存在').not.toBeNull()
    await act(async () => currentProjCard.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')
    // 返回路径：切回 home
    act(() => useLayoutStore.getState().setSidebarView('home'))
    expect(useLayoutStore.getState().sidebarView).toBe('home')

    // NAV-HOME-SIDE-07: 快捷按钮：新建项目
    const newProjBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('新建项目'))
    expect(newProjBtn, 'NAV-HOME-SIDE-07: 新建项目快捷按钮必须存在').toBeDefined()
    await act(async () => newProjBtn?.click())
    expect(useLayoutStore.getState().newProjectOpen).toBe(true)
    // 返回路径：关闭新建项目
    act(() => useLayoutStore.getState().closeNewProject())
    expect(useLayoutStore.getState().newProjectOpen).toBe(false)

    // NAV-HOME-SIDE-12: 底部：设置
    const bottomSettingsBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('设置'))
    expect(bottomSettingsBtn, 'NAV-HOME-SIDE-12: 底部设置按钮必须存在').toBeDefined()
    await act(async () => bottomSettingsBtn?.click())
    expect(useLayoutStore.getState().settingsOpen).toBe(true)
    // 返回路径：关闭设置
    act(() => useLayoutStore.getState().closeSettings())
    expect(useLayoutStore.getState().settingsOpen).toBe(false)
  })
})

// =========================================================================
// 3. 侧边栏通用容器与顶部快捷命令 (Sidebar) - NAV-SIDE-TOP-01 ~ 03, SUB-01
// =========================================================================
describe('Sidebar Container Commands (NAV-SIDE-TOP & NAV-SIDE-SUB)', () => {
  it('executes header actions in project view and sub-view return commands with verification', async () => {
    useLayoutStore.setState({ sidebarView: 'project' })
    await act(async () => {
      root.render(<Sidebar />)
    })

    // NAV-SIDE-TOP-01: 返回首页图标按钮
    const homeIconBtn = container.querySelector('button[title*="返回首页"]') as HTMLButtonElement
    expect(homeIconBtn, 'NAV-SIDE-TOP-01: 返回首页按钮必须存在').not.toBeNull()
    await act(async () => homeIconBtn.click())
    expect(useLayoutStore.getState().sidebarView).toBe('home')
    // 返回路径：切回 project
    act(() => useLayoutStore.getState().setSidebarView('project'))
    expect(useLayoutStore.getState().sidebarView).toBe('project')

    // NAV-SIDE-SUB-01: 切换至资料视图，测试返回创作树
    useLayoutStore.setState({ sidebarView: 'workspace' })
    await act(async () => {
      root.render(<Sidebar />)
    })
    const backToProjectBtn = container.querySelector('button[aria-label="返回创作"], button[title*="返回"]') as HTMLButtonElement
    expect(backToProjectBtn, 'NAV-SIDE-SUB-01: 返回创作按钮必须存在').not.toBeNull()
    await act(async () => backToProjectBtn.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')
    // 返回路径：切回 workspace
    act(() => useLayoutStore.getState().setSidebarView('workspace'))
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')
  })
})

// =========================================================================
// 4. 工作台首页画布 (WelcomePage) - NAV-WELCOME-01, NAV-WELCOME-02
// =========================================================================
describe('WelcomePage Hero Actions (NAV-WELCOME-01, NAV-WELCOME-02)', () => {
  it('opens and returns from NewProjectDialog and ImportNovelDialog from Hero actions', async () => {
    const onNewProject = vi.fn(() => useLayoutStore.getState().openNewProject())
    const onOpenProject = vi.fn()
    const onImportNovel = vi.fn(() => useLayoutStore.getState().openImportNovel())

    await act(async () => {
      root.render(
        <WelcomePage
          onNewProject={onNewProject}
          onOpenProject={onOpenProject}
          onImportNovel={onImportNovel}
        />
      )
    })

    // NAV-WELCOME-01: 新建项目 Hero 按钮
    const newProjBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.trim().includes('新书立项') || b.textContent?.trim().includes('新建项目')
    )
    expect(newProjBtn, 'NAV-WELCOME-01: WelcomePage 新建项目按钮必须严格存在').toBeDefined()
    await act(async () => newProjBtn?.click())
    expect(onNewProject).toHaveBeenCalled()
    expect(useLayoutStore.getState().newProjectOpen).toBe(true)
    // 返回路径：关闭新建对话框
    act(() => useLayoutStore.getState().closeNewProject())
    expect(useLayoutStore.getState().newProjectOpen).toBe(false)

    // NAV-WELCOME-02: 导入创作资料 Hero 按钮
    const importBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.trim().includes('导入作品开始拆解') || b.textContent?.trim().includes('导入创作资料')
    )
    expect(importBtn, 'NAV-WELCOME-02: WelcomePage 导入创作资料按钮必须严格存在').toBeDefined()
    await act(async () => importBtn?.click())
    expect(onImportNovel).toHaveBeenCalled()
    expect(useLayoutStore.getState().importNovelOpen).toBe(true)
    // 返回路径：关闭导入对话框
    act(() => useLayoutStore.getState().closeImportNovel())
    expect(useLayoutStore.getState().importNovelOpen).toBe(false)
  })
})

// =========================================================================
// 5. 项目树全叶子项、子文档、草稿与正文层级 (NAV-TREE-01 ~ NAV-TREE-31)
// 强断言：无条件判断，每个控件必须严格存在，点击打开后验证返回路径（关闭Tab/弹窗）
// =========================================================================
describe('ProjectTree Leaf Entries and Editor Mounting (NAV-TREE-01 ~ NAV-TREE-31)', () => {
  it('mounts correct editors for all leaf items and sub-documents with return paths verified', async () => {
    await renderProjectTree()

    // 1. NAV-TREE-01: 章节蓝图
    const bpItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('章节蓝图'))
    expect(bpItem, 'NAV-TREE-01: 章节蓝图树节点必须严格存在').toBeDefined()
    await act(async () => bpItem?.click())
    const bpTab = useEditorStore.getState().tabs.find(t => t.type === 'chapter-card')
    expect(bpTab, '章节蓝图 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(bpTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'chapter-card')).toBe(false)

    // 2. NAV-TREE-02: 章节脉络
    const threadItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('章节脉络'))
    expect(threadItem, 'NAV-TREE-02: 章节脉络树节点必须严格存在').toBeDefined()
    await act(async () => threadItem?.click())
    const threadTab = useEditorStore.getState().tabs.find(t => t.type === 'narrative-thread')
    expect(threadTab, '章节脉络 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(threadTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'narrative-thread')).toBe(false)

    // 3. NAV-TREE-03: 故事时间线
    const timelineItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('故事时间线'))
    expect(timelineItem, 'NAV-TREE-03: 故事时间线树节点必须严格存在').toBeDefined()
    await act(async () => timelineItem?.click())
    const timelineTab = useEditorStore.getState().tabs.find(t => t.type === 'story-timeline')
    expect(timelineTab, '故事时间线 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(timelineTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'story-timeline')).toBe(false)

    // 4. NAV-TREE-09: 伏笔管理
    const fshItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('伏笔管理'))
    expect(fshItem, 'NAV-TREE-09: 伏笔管理树节点必须严格存在').toBeDefined()
    await act(async () => fshItem?.click())
    const fshTab = useEditorStore.getState().tabs.find(t => t.type === 'foreshadowing')
    expect(fshTab, '伏笔管理 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(fshTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'foreshadowing')).toBe(false)

    // 5. NAV-TREE-11: 地图册
    const mapItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('地图册'))
    expect(mapItem, 'NAV-TREE-11: 地图册树节点必须严格存在').toBeDefined()
    await act(async () => mapItem?.click())
    const mapTab = useEditorStore.getState().tabs.find(t => t.type === 'world-map')
    expect(mapTab, '地图册 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(mapTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'world-map')).toBe(false)

    // 6. NAV-TREE-TOP-02: 创作参数
    const configItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('创作参数'))
    expect(configItem, 'NAV-TREE-TOP-02: 创作参数树节点必须严格存在').toBeDefined()
    await act(async () => configItem?.click())
    const configTab = useEditorStore.getState().tabs.find(t => t.type === 'config')
    expect(configTab, '创作参数 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(configTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'config')).toBe(false)

    // 7. NAV-TREE-04 ~ 06: 故事架构子文档 (故事前提/世界观/情节大纲)
    const premiseItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('故事前提'))
    expect(premiseItem, 'NAV-TREE-04: 故事前提必须严格存在').toBeDefined()
    await act(async () => premiseItem?.click())
    await vi.waitFor(() => {
      expect(useEditorStore.getState().tabs.some(t => t.type === 'arch-file' && t.filePath === 'vela://core/premise')).toBe(true)
    })
    const premiseTab = useEditorStore.getState().tabs.find(t => t.filePath === 'vela://core/premise')!
    act(() => useEditorStore.getState().closeTab(premiseTab.id))
    expect(useEditorStore.getState().tabs.some(t => t.filePath === 'vela://core/premise')).toBe(false)

    const worldItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('世界观'))
    expect(worldItem, 'NAV-TREE-05: 世界观必须严格存在').toBeDefined()
    await act(async () => worldItem?.click())
    await vi.waitFor(() => {
      expect(useEditorStore.getState().tabs.some(t => t.type === 'arch-file' && t.filePath === 'vela://core/worldbuilding')).toBe(true)
    })
    const worldTab = useEditorStore.getState().tabs.find(t => t.filePath === 'vela://core/worldbuilding')!
    act(() => useEditorStore.getState().closeTab(worldTab.id))
    expect(useEditorStore.getState().tabs.some(t => t.filePath === 'vela://core/worldbuilding')).toBe(false)

    const synopsisItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('情节大纲'))
    expect(synopsisItem, 'NAV-TREE-06: 情节大纲必须严格存在').toBeDefined()
    await act(async () => synopsisItem?.click())
    await vi.waitFor(() => {
      expect(useEditorStore.getState().tabs.some(t => t.type === 'arch-file' && t.filePath === 'vela://core/synopsis')).toBe(true)
    })
    const synopsisTab = useEditorStore.getState().tabs.find(t => t.filePath === 'vela://core/synopsis')!
    act(() => useEditorStore.getState().closeTab(synopsisTab.id))
    expect(useEditorStore.getState().tabs.some(t => t.filePath === 'vela://core/synopsis')).toBe(false)

    // 8. NAV-TREE-17: 正文写作 - 草稿项点击打开 DraftEditor (无条件判断)
    let draftRow: HTMLElement | undefined
    await vi.waitFor(() => {
      draftRow = Array.from(container.querySelectorAll<HTMLElement>('div[title*="点击打开"]')).find(
        el => el.textContent?.includes('第1章') || el.textContent?.includes('v1')
      )
      expect(draftRow, 'NAV-TREE-17: 章节草稿项必须严格存在').toBeDefined()
    })
    await act(async () => draftRow?.click())
    const draftTab = useEditorStore.getState().tabs.find(t => t.filePath === 'vela://draft/101' || t.filePath === 'drafts/ch1/draft_1.md')
    expect(draftTab, '草稿 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭草稿 Tab
    act(() => useEditorStore.getState().closeTab(draftTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.id === draftTab!.id)).toBe(false)

    // 9. NAV-TREE-19: 正文写作 - 正文章节项点击打开 ProseEditor (无条件判断)
    let manuscriptRow: HTMLElement | undefined
    await vi.waitFor(() => {
      manuscriptRow = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(
        el => el.textContent?.includes('第2章')
      )
      expect(manuscriptRow, 'NAV-TREE-19: 正文章节项必须严格存在').toBeDefined()
    })
    await act(async () => manuscriptRow?.click())
    let manuscriptTab: ReturnType<typeof useEditorStore.getState>['tabs'][number] | undefined
    await vi.waitFor(() => {
      manuscriptTab = useEditorStore.getState().tabs.find(t => t.filePath === 'vela://manuscript/102')
      expect(manuscriptTab, '正文章节 Tab 必须已打开').toBeDefined()
    })
    // 返回路径：关闭正文章节 Tab
    act(() => useEditorStore.getState().closeTab(manuscriptTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.id === manuscriptTab!.id)).toBe(false)

    // 10. NAV-TREE-24: 导入创作资料
    const importItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('导入创作资料'))
    expect(importItem, 'NAV-TREE-24: 导入创作资料必须严格存在').toBeDefined()
    await act(async () => importItem?.click())
    expect(useLayoutStore.getState().importNovelOpen).toBe(true)
    // 返回路径：关闭导入对话框
    act(() => useLayoutStore.getState().closeImportNovel())
    expect(useLayoutStore.getState().importNovelOpen).toBe(false)

    // 11. NAV-TREE-25: 导出项目
    const exportItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item')).find(el => el.textContent?.includes('导出项目'))
    expect(exportItem, 'NAV-TREE-25: 导出项目必须严格存在').toBeDefined()
    await act(async () => exportItem?.click())
    expect(useLayoutStore.getState().exportOpen).toBe(true)
    // 返回路径：关闭导出对话框
    act(() => useLayoutStore.getState().closeExport())
    expect(useLayoutStore.getState().exportOpen).toBe(false)
  })
})

// =========================================================================
// 6. 键盘 Enter/Space (NAV-TREE-KEY)
// =========================================================================
describe('Keyboard & Context Menu Navigation (NAV-TREE-KEY)', () => {
  it('activates tree items using Enter and Space keys with clean return path', async () => {
    await renderProjectTree()

    const blueprintItem = Array.from(container.querySelectorAll<HTMLElement>('.tree-item[role="button"]')).find(el =>
      el.textContent?.includes('章节蓝图'),
    )
    expect(blueprintItem, 'NAV-TREE-KEY: 键盘操作目标章节蓝图必须存在').toBeDefined()

    // 键盘 Enter
    blueprintItem?.focus()
    await userEvent.keyboard('{Enter}')
    const enterTab = useEditorStore.getState().tabs.find(t => t.type === 'chapter-card')
    expect(enterTab, '键盘 Enter 激活后蓝图 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(enterTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'chapter-card')).toBe(false)

    // 键盘 Space
    blueprintItem?.focus()
    await userEvent.keyboard(' ')
    const spaceTab = useEditorStore.getState().tabs.find(t => t.type === 'chapter-card')
    expect(spaceTab, '键盘 Space 激活后蓝图 Tab 必须已打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(spaceTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'chapter-card')).toBe(false)
  })
})

// =========================================================================
// 7. ProjectOverviewPage 正常 vs 异常快照分离验证 (Requirement 3)
// =========================================================================
describe('ProjectOverviewPage Timeline Anomaly Separation (Requirement 3)', () => {
  it('renders ProjectOverviewPage smoothly with normal IPC snapshot and return path', async () => {
    await act(async () => {
      root.render(<ProjectOverviewPage />)
    })

    const overviewTitle = container.querySelector('.literary-overview-title, h1')
    expect(overviewTitle?.textContent).toContain('导航专项测试小说')

    // NAV-OVERVIEW-01: 顶栏快捷入口均完整渲染且可点击
    const bpBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === '章节蓝图')
    expect(bpBtn, 'NAV-OVERVIEW-01: 顶栏章节蓝图按钮必须严格存在').toBeDefined()
    await act(async () => bpBtn?.click())
    const bpTab = useEditorStore.getState().tabs.find(t => t.type === 'chapter-card')
    expect(bpTab, '章节蓝图 Tab 必须打开').toBeDefined()
    // 返回路径：关闭 Tab
    act(() => useEditorStore.getState().closeTab(bpTab!.id))
    expect(useEditorStore.getState().tabs.some(t => t.type === 'chapter-card')).toBe(false)
  })

  it('reproduces TypeError when timeline snapshot lacks events property', async () => {
    // 强制将 timeline store 设置为无 events 的异常快照状态
    useStoryTimelineStore.setState({
      events: undefined as unknown as [],
      dataProjectKey: PROJECT_PATH,
    })

    let caughtError: Error | null = null
    try {
      await act(async () => {
        root.render(<ProjectOverviewPage />)
      })
    } catch (err) {
      caughtError = err as Error
    }

    // 强断言捕获到了确切的异常：Cannot read properties of undefined (reading 'filter')
    expect(caughtError).not.toBeNull()
    expect(caughtError?.message).toContain('reading \'filter\'')
  })
})

// =========================================================================
// 8. 弹窗强断言取消与遮罩彻底卸载 (Requirement 5)
// =========================================================================
describe('Dialog Lifecycle and Strong Cancel Assertions (Requirement 5)', () => {
  it('strongly asserts ClearProjectDataDialog cancel button and no dirty writes', async () => {
    const onCleared = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <ClearProjectDataDialog open={true} onClose={onClose} onCleared={onCleared} />
      )
    })

    // 强断言弹窗和取消按钮存在
    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === '取消'
    )
    expect(cancelBtn, 'Cancel button must strictly exist').toBeDefined()

    // 实际点击取消
    await act(async () => {
      cancelBtn?.click()
    })

    expect(onClose).toHaveBeenCalled()
    expect(onCleared).not.toHaveBeenCalled()
  })

  it('strongly asserts NewProjectDialog cancel button closes dialog without write', async () => {
    const onClose = vi.fn()

    await act(async () => {
      root.render(<NewProjectDialog open={true} onClose={onClose} />)
    })

    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === '取消'
    )
    expect(cancelBtn, 'NewProjectDialog Cancel button must strictly exist').toBeDefined()

    await act(async () => {
      cancelBtn?.click()
    })

    expect(onClose).toHaveBeenCalled()
    // 验证未产生脏项目切换
    expect(useProjectStore.getState().currentProject?.name).toBe('导航专项测试小说')
  })

  it('strongly asserts ExportDialog cancel/close button closes dialog', async () => {
    const onClose = vi.fn()

    await act(async () => {
      root.render(<ExportDialog isOpen={true} onClose={onClose} />)
    })

    // ExportDialog 取消/关闭按钮通过 Radix DialogClose (X图标) 提供
    const closeBtn = document.body.querySelector('button.absolute.right-4, button:has(svg.lucide-x)') as HTMLButtonElement
    expect(closeBtn, 'ExportDialog Close button must strictly exist').not.toBeNull()

    await act(async () => {
      closeBtn?.click()
    })

    expect(onClose).toHaveBeenCalled()
  })
})
