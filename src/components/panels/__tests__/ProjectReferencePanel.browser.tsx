import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectReferencePanel from '../ProjectReferencePanel'
import { useCharacterStore } from '../../../stores/character-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import LeftToolWindowBar from '../../layout/LeftToolWindowBar'
import ProjectTree from '../sidebar/ProjectTree'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\reference-project'
const PROJECT_SESSION = Object.freeze({
  projectId: 'reference-project',
  leaseId: 'reference-lease',
  projectPath: PROJECT_PATH,
})

const originalCharacterState = useCharacterStore.getState()
const originalDraftState = useDraftStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalWorldMapState = useWorldMapStore.getState()

let root: Root
let container: HTMLDivElement

function findButton(label: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.includes(label))
}

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({
    currentProject: {
      id: PROJECT_SESSION.projectId,
      sessionLease: PROJECT_SESSION.leaseId,
      name: '星辰之下',
      path: PROJECT_PATH,
      novelConfig: { totalChapters: 24, coreOutline: '林默的逆天之路' },
    } as never,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  useCharacterStore.setState({
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    loadingProjectSession: null,
    lastError: null,
    characters: [{ name: '林默', role: 'protagonist', age: '17' }] as never,
    selectedName: null,
  })
  useWorldMapStore.setState({
    maps: [{ id: 'map-1', name: '云荒大陆', projectId: PROJECT_SESSION.projectId, createdAt: '', updatedAt: '' } as never],
    nodes: [{
      id: 'node-1',
      mapId: 'map-1',
      name: '青石村',
      type: 'village',
      description: '林默出生的偏僻山村',
      x: 100,
      y: 100,
    } as never],
    selectedNodeId: null,
  })
  useDraftStore.setState({
    draftsByChapter: {},
    loading: false,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    loadingProjectKey: null,
    loadingProjectSession: null,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useWorkflowStore.setState({ activeRuns: [] })
  useLayoutStore.setState({
    sidebarOpen: true,
    sidebarView: 'project',
    activeRailItem: 'project',
    aiPanelOpen: false,
    rightView: 'agent',
    referencePanelOpen: true,
    focusMode: false,
  })

  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:blueprint-get') {
      const chapterNumber = args[0]
      return {
        chapterNumber,
        title: '第一章 逆境崛起',
        purpose: '交代林默身世与离开青石村的动机',
        keyEvents: '林默偶得青石残印，离开青石村前往玄剑宗',
        userGuidance: '着重刻画青石村的环境与清晨出发的气氛',
        characters: ['林默'],
      }
    }
    if (channel === 'db:review-get-latest') {
      return {
        id: 99,
        draftId: args[0],
        chapterNumber: 1,
        content: '一致性审核良好，无设定冲突。',
      }
    }
    if (channel === 'db:foreshadowing-list-by-draft') {
      return [
        {
          id: 1,
          draftId: args[0],
          chapterNumber: 1,
          selectedText: '青石残印上的云纹',
          startOffset: 12,
          endOffset: 20,
          contextBefore: '',
          contextAfter: '',
          title: '残印云纹',
          description: '上古宗门传承信物',
          status: 'active',
          completed: false,
          createdAt: '',
          updatedAt: '',
        },
      ]
    }
    if (channel === 'db:map-get-all') {
      return {
        maps: [{ id: 'map-1', name: '云荒大陆', projectId: PROJECT_SESSION.projectId, createdAt: '', updatedAt: '' }],
        nodes: [{
          id: 'node-1',
          mapId: 'map-1',
          name: '青石村',
          type: 'village',
          description: '林默出生的偏僻山村',
          x: 100,
          y: 100,
        }],
        edges: [],
      }
    }
    if (channel === 'fs:list-dir' || channel === 'db:draft-list-all') return []
    if (channel === 'db:blueprint-get-all') return []
    if (channel === 'db:project-core-get') {
      return { premise: 'P'.repeat(60), charactersArch: '', worldbuilding: '', synopsis: '' }
    }
    if (channel === 'db:character-roster-read') {
      return { status: 'ready', revision: 1, entries: [], renderedMarkdown: 'Character roster' }
    }
    if (channel === 'chapter:list-incomplete-deletions') return { success: true, operations: [] }
    return null
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      setZoomLevel: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
  })

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ProjectReferencePanel />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useCharacterStore.setState(originalCharacterState, true)
  useDraftStore.setState(originalDraftState, true)
  useEditorStore.setState(originalEditorState, true)
  useLayoutStore.setState(originalLayoutState, true)
  useLocaleStore.setState(originalLocaleState, true)
  useProjectStore.setState(originalProjectState, true)
  useWorkflowStore.setState(originalWorkflowState, true)
  useWorldMapStore.setState(originalWorldMapState, true)
})

describe('ProjectReferencePanel writer desktop workbench', () => {
  it('renders real character data and routes reference links to existing domain tools', async () => {
    expect(container.textContent).toContain('上下文')
    expect(container.textContent).toContain('项目设定')
    expect(container.textContent).toContain('林默')
    expect(container.textContent).toContain('17')

    const configuration = findButton('小说配置')
    expect(configuration).toBeDefined()
    await act(async () => configuration?.click())
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ type: 'config', projectKey: 'C:\\novels\\reference-project' })

    const blueprint = findButton('卷纲与章节细纲')
    expect(blueprint).toBeDefined()
    await act(async () => blueprint?.click())
    const tabs = useEditorStore.getState().tabs
    expect(tabs[tabs.length - 1]).toMatchObject({ type: 'chapter-card', projectKey: 'C:\\novels\\reference-project' })

    const workspace = findButton('创作资料中枢')
    expect(workspace).toBeDefined()
    await act(async () => workspace?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')
  })

  it('opens the existing AI agent and lets the compact reference rail be collapsed', async () => {
    const aiAssistant = findButton('打开 AI 助手')
    expect(aiAssistant).toBeDefined()
    await act(async () => aiAssistant?.click())
    expect(useLayoutStore.getState()).toMatchObject({ aiPanelOpen: true, rightView: 'agent' })

    const collapse = container.querySelector('[aria-label="收起上下文"]') as HTMLButtonElement | null
    expect(collapse).not.toBeNull()
    await act(async () => collapse?.click())
    expect(useLayoutStore.getState().referencePanelOpen).toBe(false)
  })

  it('selects the clicked character and keeps the full character roster open', async () => {
    const character = container.querySelector('.writer-reference-character') as HTMLButtonElement | null
    expect(character).not.toBeNull()
    await act(async () => character?.click())
    expect(useCharacterStore.getState().selectedName).toBe('林默')
    expect(useLayoutStore.getState()).toMatchObject({ sidebarView: 'characters', sidebarOpen: true })

    // 点击“查看全部角色”时，即使已在角色页，也不能把左栏意外收起。
    useLayoutStore.setState({ sidebarOpen: false })
    const viewAll = findButton('查看全部角色')
    expect(viewAll).toBeDefined()
    await act(async () => viewAll?.click())
    expect(useLayoutStore.getState()).toMatchObject({ sidebarView: 'characters', sidebarOpen: true })
  })

  it('hides 2 global groups (6 items) and keeps chapter guidance, map nodes, audit, and characters when editing a draft', async () => {
    const draftTab = {
      id: 'draft-tab-1',
      name: '第 1 章：初入江湖',
      type: 'chapter' as const,
      filePath: 'vela://draft/1',
      draftId: 1,
      chapterNumber: 1,
      content: '林默走在青石村的石阶上，怀揣着青石残印上的云纹...',
      projectKey: PROJECT_PATH,
    }

    await act(async () => {
      useEditorStore.setState({ tabs: [draftTab], activeTabId: 'draft-tab-1' })
    })

    // 等待异步查询加载完成
    await vi.waitFor(() => {
      expect(container.textContent).toContain('第 1 章蓝图与创作指导')
    })

    // 1. 验证隐藏 2 个全局分组（共 6 项）
    const hiddenItems = [
      '项目设定',
      '小说配置',
      '故事架构与世界观',
      '创作资料',
      '创作资料中枢',
      '本地知识库',
    ]
    for (const item of hiddenItems) {
      expect(container.textContent).not.toContain(item)
      expect(findButton(item)).toBeUndefined()
    }

    // 2. 验证保留与当前章节直接相关的内容
    expect(container.textContent).toContain('第 1 章蓝图与创作指导')
    expect(container.textContent).toContain('叙事目的：')
    expect(container.textContent).toContain('交代林默身世与离开青石村的动机')
    expect(container.textContent).toContain('关键事件')
    expect(container.textContent).toContain('林默偶得青石残印，离开青石村前往玄剑宗')
    expect(container.textContent).toContain('创作指导与细纲 (user_guidance)')
    expect(container.textContent).toContain('着重刻画青石村的环境与清晨出发的气氛')
    expect(container.textContent).toContain('关联地图节点')
    expect(container.textContent).toContain('青石村')
    expect(container.textContent).toContain('一致性审核发现')
    expect(container.textContent).toContain('一致性审核良好，无设定冲突。')
    expect(container.textContent).toContain('本章伏笔与回收状态')
    expect(container.textContent).toContain('青石残印上的云纹')
    expect(container.textContent).toContain('待回收')
    expect(container.textContent).toContain('当前章节相关角色')
    expect(container.textContent).toContain('林默')
    expect(container.textContent).toContain('卷纲与章节细纲')
    expect(container.textContent).toContain('伏笔与叙事线索')
    expect(container.textContent).toContain('任务')
    expect(container.textContent).toContain('只读审核助手')
  })

  it('hides 2 global groups (6 items) and keeps chapter-relevant items when editing a manuscript chapter', async () => {
    const manuscriptTab = {
      id: 'manuscript-tab-1',
      name: '第 1 章：初入江湖（正文）',
      type: 'chapter' as const,
      filePath: 'vela://manuscript/1',
      draftId: 1,
      chapterNumber: 1,
      content: '林默走在青石村的石阶上，怀揣着青石残印上的云纹...',
      projectKey: PROJECT_PATH,
    }

    await act(async () => {
      useEditorStore.setState({ tabs: [manuscriptTab], activeTabId: 'manuscript-tab-1' })
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('第 1 章蓝图与创作指导')
    })

    // 1. 验证隐藏 2 个全局分组（共 6 项）
    const hiddenItems = [
      '项目设定',
      '小说配置',
      '故事架构与世界观',
      '创作资料',
      '创作资料中枢',
      '本地知识库',
    ]
    for (const item of hiddenItems) {
      expect(container.textContent).not.toContain(item)
      expect(findButton(item)).toBeUndefined()
    }

    // 2. 验证保留章节直接相关内容
    expect(container.textContent).toContain('第 1 章蓝图与创作指导')
    expect(container.textContent).toContain('创作指导与细纲 (user_guidance)')
    expect(container.textContent).toContain('关联地图节点')
    expect(container.textContent).toContain('青石村')
    expect(container.textContent).toContain('一致性审核发现')
    expect(container.textContent).toContain('本章伏笔与回收状态')
    expect(container.textContent).toContain('青石残印上的云纹')
    expect(container.textContent).toContain('当前章节相关角色')
    expect(container.textContent).toContain('林默')
    expect(container.textContent).toContain('卷纲与章节细纲')
    expect(container.textContent).toContain('伏笔与叙事线索')
    expect(container.textContent).toContain('任务')
    expect(container.textContent).toContain('只读审核助手')
  })

  it('retains all original global groups and items when viewing non-chapter pages', async () => {
    const overviewTab = {
      id: 'overview-tab',
      name: '项目总览',
      type: 'overview' as const,
      filePath: 'vela://overview',
    }

    await act(async () => {
      useEditorStore.setState({ tabs: [overviewTab], activeTabId: 'overview-tab' })
    })

    // 1. 全局参考组正常展示
    const globalItems = [
      '项目设定',
      '小说配置',
      '故事架构与世界观',
      '创作资料',
      '创作资料中枢',
      '本地知识库',
    ]
    for (const item of globalItems) {
      expect(container.textContent).toContain(item)
      expect(findButton(item)).toBeDefined()
    }

    // 2. 不展示针对特定章节的细纲与审核
    expect(container.textContent).not.toContain('蓝图与创作指导')
    expect(container.textContent).toContain('角色')
    expect(container.textContent).not.toContain('当前章节相关角色')
  })

  it('ensures left sidebar navigation entries for configuration, world building, creative materials, and knowledge base exist and open properly', async () => {
    // 1. 测试左侧主导航栏 LeftToolWindowBar
    const barContainer = document.createElement('div')
    document.body.append(barContainer)
    const barRoot = createRoot(barContainer)
    await act(async () => barRoot.render(<LeftToolWindowBar />))

    const findRailButton = (label: string) =>
      [...barContainer.querySelectorAll('button')].find(b => b.textContent?.trim() === label)

    const writingRailBtn = findRailButton('创作')
    const sourcesRailBtn = findRailButton('资料')
    const kbRailBtn = findRailButton('知识检索')

    expect(writingRailBtn).toBeDefined()
    expect(sourcesRailBtn).toBeDefined()
    expect(kbRailBtn).toBeDefined()

    // 点击资料（工作区/资料中枢）
    await act(async () => sourcesRailBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')

    // 点击知识检索
    await act(async () => kbRailBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('knowledge')

    // 点击创作切回项目树
    await act(async () => writingRailBtn?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('project')

    await act(async () => barRoot.unmount())
    barContainer.remove()

    // 2. 测试左侧项目树 ProjectTree 内部的各入口
    const treeContainer = document.createElement('div')
    document.body.append(treeContainer)
    const treeRoot = createRoot(treeContainer)
    await act(async () => treeRoot.render(<ProjectTree />))

    const findTreeItem = (label: string) =>
      [...treeContainer.querySelectorAll('.writer-tree-item, .tree-item, button')].find(
        el => el.textContent?.includes(label)
      )

    // 小说配置入口（创作参数）
    const configItem = findTreeItem('创作参数')
    expect(configItem).toBeDefined()
    await act(async () => (configItem as HTMLElement)?.click())
    expect(useEditorStore.getState().tabs.some(t => t.type === 'config')).toBe(true)

    // 故事架构入口
    const worldOverviewBtn = treeContainer.querySelector('[aria-label="打开架构总览"]') as HTMLButtonElement | null
    expect(worldOverviewBtn).not.toBeNull()
    await act(async () => worldOverviewBtn?.click())
    expect(useEditorStore.getState().tabs.some(t => t.type === 'world-building')).toBe(true)

    // 创作资料入口（资料来源与审核）
    const sourcesItem = findTreeItem('资料来源与审核')
    expect(sourcesItem).toBeDefined()
    await act(async () => (sourcesItem as HTMLElement)?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')

    // 知识检索入口
    const kbItem = findTreeItem('知识检索')
    expect(kbItem).toBeDefined()
    await act(async () => (kbItem as HTMLElement)?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('knowledge')

    await act(async () => treeRoot.unmount())
    treeContainer.remove()
  })
})
