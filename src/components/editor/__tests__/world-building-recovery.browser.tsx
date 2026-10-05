import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import '../../../index.css'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { createProjectArchTabId } from '../arch-file-refresh-policy'
import { createProjectScopedEditorTabId, useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { launchCreativeWorkflow } from '../../../services/workflows/creative-workflow-launcher'
import { synopsisFactsFingerprint } from '../../../services/workflows/commands/architecture.command'
import WorldBuildingEditor from '../WorldBuildingEditor'

vi.mock('../../../services/workflows/creative-workflow-launcher', () => ({
  launchCreativeWorkflow: vi.fn(async () => undefined),
}))

const projectPath = 'C:\\novels\\世界观候选界面测试'
const projectSession = {
  projectId: 'world-ui-test',
  leaseId: 'world-ui-test-lease',
  projectPath,
}
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()

let container: HTMLDivElement
let root: Root
let partialFile: Record<string, unknown>
let coreContent: {
  premise: string
  worldbuilding: string
  synopsis: string
  totalChapters: number
  [key: string]: unknown
}
let rosterSnapshot: Record<string, unknown>
let previousBodyMargin: string
let previousDocumentClassName: string
let previousDocumentTheme: string | null

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  partialFile = {}
  vi.mocked(launchCreativeWorkflow).mockClear()
  coreContent = { premise: '故事前提'.repeat(20), worldbuilding: '', synopsis: '', totalChapters: 20 }
  rosterSnapshot = { status: 'empty', revision: 0, entries: [], renderedMarkdown: '' }
  previousBodyMargin = document.body.style.margin
  previousDocumentClassName = document.documentElement.className
  previousDocumentTheme = document.documentElement.getAttribute('data-theme')
  document.body.style.margin = '0'
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useLayoutStore.setState({
    aiPanelOpen: false,
    rightView: 'agent',
    sidebarView: 'project',
    characterViewRequest: null,
  })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({
    currentProject: {
      id: projectSession.projectId,
      sessionLease: projectSession.leaseId,
      name: '世界观候选界面测试',
      path: projectPath,
      novelConfig: {
        writingLanguage: 'zh-CN',
        genre: '东方奇幻',
        subGenre: '',
        targetAudience: '成年读者',
        totalChapters: 20,
        wordsPerChapter: 3000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '倒悬古城的记忆税危机。',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
      },
    } as never,
  })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  setActiveProjectSessionContext(projectSession)

  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'db:project-core-get') {
          return structuredClone(coreContent)
        }
        if (channel === 'db:cultivation-read') return { revision: 0, realms: [], markdown: '' }
        if (channel === 'db:map-get-all') return { maps: [], nodes: [], connections: [] }
        if (channel === 'db:info-entry-list' || channel === 'db:creative-material-list' || channel === 'db:creative-legacy-list') return []
        if (channel === 'fs:read-json') return { success: true, data: structuredClone(partialFile) }
        if (channel === 'db:character-roster-read') {
          return structuredClone(rosterSnapshot)
        }
        if (channel === 'config:set') return { success: true }
        throw new Error(`未预期的 IPC 通道：${channel}`)
      }),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      setZoomLevel: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomLevel: vi.fn(),
    },
  })

  container = document.createElement('div')
  container.className = 'app-skin-root'
  container.dataset.skin = 'classic'
  container.dataset.theme = 'light'
  container.style.width = '100%'
  container.style.height = '100vh'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  useEditorStore.setState(originalEditorState)
  useLayoutStore.setState(originalLayoutState)
  document.body.style.margin = previousBodyMargin
  document.documentElement.className = previousDocumentClassName
  if (previousDocumentTheme === null) document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', previousDocumentTheme)
  vi.restoreAllMocks()
})

describe('WorldBuildingEditor 基础设定总览', () => {
  it('显示全部专用资料入口，状态按实际内容呈现；打开批量选择器不启动生成', async () => {
    coreContent.premise = '短'
    await act(async () => root.render(<WorldBuildingEditor projectKey={projectPath} />))
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-overview-entry="premise"]')?.textContent).toContain('有内容'))
    })

    expect(container.textContent).toContain('基础设定总览')
    expect(container.querySelectorAll('[data-overview-entry]')).toHaveLength(13)
    expect(container.textContent).toContain('创作方向')
    expect(container.textContent).toContain('故事前提')
    expect(container.textContent).toContain('人物与关系')
    expect(container.textContent).toContain('世界设定')
    expect(container.textContent).toContain('全书总纲')
    expect(container.textContent).toContain('写作规范')
    expect(container.textContent).toContain('力量体系')
    expect(container.textContent).toContain('地点与区域')
    expect(container.textContent).toContain('素材与候选')
    expect(container.textContent).toContain('待整理旧内容')
    expect(container.querySelector('[data-overview-entry="premise"]')?.textContent).toContain('有内容')
    expect(container.querySelector('[data-overview-entry="worldbuilding"]')?.textContent).toContain('待填写')
    expect(container.querySelector('[data-overview-entry="characters"]')?.textContent).toContain('名单尚未建立')
    expect(container.querySelector('[data-overview-entry="characters"]')?.textContent).toContain('0 个角色')
    expect(container.querySelector('[data-overview-entry="premise"]')?.textContent).toContain('1 字符')
    expect(container.textContent).not.toContain('3/3')
    expect(container.textContent).not.toContain('已确认')
    expect(container.textContent).not.toContain('已生成')
    expect(useWorkflowStore.getState().activeRuns).toHaveLength(0)

    const batchButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('批量生成设定'))
    expect(batchButton).toBeTruthy()
    await act(async () => batchButton?.click())
    await act(async () => {
      await vi.waitFor(() => expect(document.body.textContent).toContain('确认生成'))
    })
    expect(useWorkflowStore.getState().activeRuns).toHaveLength(0)
  })

  it('单项续批明确加入的依赖步骤会保留在启动 payload 中', async () => {
    const synopsisBody = '第 1–10 章：已确认的调查推进与人物选择。'.repeat(20)
    const coveredTo = 10
    const synopsis = `# 情节大纲\n\n${synopsisBody}\n\n> 本大纲已覆盖至第 ${coveredTo} 章（全书 20 章），其余章节将在后续批次继续生成。`
    coreContent = { ...coreContent, synopsis }
    partialFile = {
      synopsis_result: synopsisBody,
      synopsis_incomplete: false,
      synopsis_covered_to: coveredTo,
      synopsis_range: { from: 1, to: coveredTo },
      synopsis_db_hash: synopsisFactsFingerprint([synopsis]),
      synopsis_body_hash: synopsisFactsFingerprint([synopsisBody]),
    }

    await act(async () => root.render(<WorldBuildingEditor projectKey={projectPath} />))
    const continueButton = await vi.waitFor(() => {
      const button = Array.from(container.querySelectorAll('button'))
        .find(item => item.textContent?.includes('续批（第 11 章起）'))
      expect(button).toBeTruthy()
      return button!
    })
    await act(async () => continueButton.click())
    await act(async () => {
      await vi.waitFor(() => expect(document.body.textContent).toContain('确认生成（1/4）'))
    })

    const includePrerequisites = Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('加入所需生成步骤'))
    expect(includePrerequisites).toBeTruthy()
    await act(async () => includePrerequisites?.click())
    await act(async () => {
      await vi.waitFor(() => expect(document.body.textContent).toContain('确认生成（3/4）'))
    })

    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认生成（3/4）'))
    expect(confirm).toBeTruthy()
    await act(async () => confirm?.click())
    await act(async () => {
      await vi.waitFor(() => expect(launchCreativeWorkflow).toHaveBeenCalledTimes(1))
    })
    expect(launchCreativeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'generate_architecture',
        selectedSteps: ['characters', 'worldbuilding', 'synopsis'],
        synopsisRange: { from: 11, to: 20 },
      }),
      expect.objectContaining({ projectPath }),
    )
  })

  it('routes each card to its existing editable source and exposes the workflow panel', async () => {
    const configTabId = createProjectScopedEditorTabId('config', 'config', projectPath)
    const premiseTabId = createProjectArchTabId(projectPath, 'vela://core/premise')
    useEditorStore.setState({
      tabs: [
        { id: configTabId, name: '旧创作方向名称', type: 'config', projectKey: projectPath, dirty: true } as never,
        { id: premiseTabId, name: '故事前提', type: 'arch-file', filePath: 'vela://core/premise', projectKey: projectPath, content: '尚未保存的手写前提', savedContent: '旧内容', dirty: true } as never,
      ],
      activeTabId: premiseTabId,
    })
    await act(async () => root.render(<WorldBuildingEditor projectKey={projectPath} />))
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelectorAll('[data-overview-entry]')).toHaveLength(13))
    })

    const clickEntry = async (key: string) => {
      const button = container.querySelector<HTMLButtonElement>(`[data-overview-entry="${key}"] .world-building-overview__card-main`)
      expect(button).toBeTruthy()
      await act(async () => button?.click())
    }

    await clickEntry('creative-direction')
    expect(useEditorStore.getState().tabs.find(tab => tab.type === 'config')).toMatchObject({
      id: configTabId,
      name: '创作方向',
      dirty: true,
    })
    await clickEntry('writing-rules')
    expect(useEditorStore.getState().tabs.filter(tab => tab.type === 'config')).toHaveLength(1)
    await clickEntry('premise')
    await act(async () => {
      await vi.waitFor(() => expect(useEditorStore.getState().tabs.some(tab => tab.filePath === 'vela://core/premise')).toBe(true))
    })
    expect(useEditorStore.getState().tabs.find(tab => tab.filePath === 'vela://core/premise')?.id)
      .toBe(premiseTabId)
    expect(useEditorStore.getState().tabs.find(tab => tab.id === premiseTabId)).toMatchObject({
      content: '尚未保存的手写前提',
      savedContent: '旧内容',
      dirty: true,
    })
    await clickEntry('worldbuilding')
    await act(async () => {
      await vi.waitFor(() => expect(useEditorStore.getState().tabs.some(tab => tab.filePath === 'vela://core/worldbuilding')).toBe(true))
    })
    await clickEntry('plot-planning')
    await act(async () => {
      await vi.waitFor(() => expect(useEditorStore.getState().tabs.some(tab => tab.type === 'chapter-card')).toBe(true))
    })
    expect(useEditorStore.getState().tabs.find(tab => tab.type === 'chapter-card')?.blueprintPlanningSelection)
      .toEqual({ kind: 'book' })
    await clickEntry('characters')
    expect(useLayoutStore.getState().characterViewRequest?.view).toBe('edit')
    await clickEntry('power-system')
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'cultivation')).toBe(true)
    await clickEntry('locations')
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'locations')).toBe(true)
    await clickEntry('information-reveal')
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'knowledge-gap')).toBe(true)
    await clickEntry('materials')
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'creative-materials')).toBe(true)

    const manageWorlds = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('管理各个世界'))
    expect(manageWorlds).toBeTruthy()
    await act(async () => manageWorlds?.click())
    expect(useEditorStore.getState().tabs.find(tab => tab.type === 'world')).toMatchObject({
      id: createProjectScopedEditorTabId('world-workbench', 'world', projectPath),
      name: '世界管理',
    })

    const workflowButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('查看 AI 工作流'))
    await act(async () => workflowButton?.click())
    expect(useLayoutStore.getState()).toMatchObject({ aiPanelOpen: true, rightView: 'ai-output' })
  })

  it('仅呈现当前项目会话的生成中和失败状态', async () => {
    await act(async () => root.render(<WorldBuildingEditor projectKey={projectPath} />))
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('基础设定总览'))
    })

    const architectureRun = {
      id: 'active-story-setup-run',
      type: 'architecture_generation',
      projectPath,
      projectSession,
      status: 'running',
      steps: [],
      currentStepIndex: 0,
    }
    await act(async () => useWorkflowStore.setState({ activeRuns: [architectureRun as never] }))
    expect(container.textContent).toContain('基础设定生成中')

    await act(async () => useWorkflowStore.setState({
      activeRuns: [],
      history: [{
        ...architectureRun,
        id: 'failed-story-setup-run',
        status: 'failed',
        error: '模型请求失败',
      } as never],
    }))
    expect(container.textContent).toContain('上次基础设定生成失败')
    expect(container.textContent).toContain('模型请求失败')
  })

  it('已打开页面会在架构工作流失败终态后刷新并显示候选入口', async () => {
    await page.viewport(1280, 1400)
    await act(async () => root.render(<WorldBuildingEditor projectKey={projectPath} />))
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('基础设定总览'))
    })
    expect(container.textContent).not.toContain('未完成候选 · 未写入正式内容')

    partialFile = {
      world_building_partial_result: '倒悬古城依靠记忆结晶运转，王庭通过税令控制流通。',
      world_building_incomplete: true,
      world_building_facts_fingerprint: 'facts',
      world_building_db_hash: 'db',
      world_building_step_guidance: '',
    }
    await act(async () => useWorkflowStore.setState({
      history: [{
        id: 'failed-world-run',
        type: 'architecture_generation',
        title: '生成故事架构',
        projectPath,
        projectSession,
        status: 'failed',
        steps: [],
        currentStepIndex: 0,
        logs: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        uiLocale: 'zh-CN',
      } as never],
    }))

    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('未完成候选 · 未写入正式内容'))
    })
    const viewButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('查看候选'))
    expect(viewButton).toBeTruthy()
    await act(async () => viewButton?.click())
    expect(container.textContent).toContain('不会自动写入正式世界观')
    expect(container.textContent).toContain('倒悬古城依靠记忆结晶运转')
    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>('#vela-toast-root .vela-feedback-close').forEach(button => button.click())
    })
    await page.screenshot({ path: '../../../../screenshots/basic-settings-overview-candidate.png' })
  })

  it('renders responsive English and dark-theme content, preserving keyboard focus and long summaries', async () => {
    coreContent = {
      ...coreContent,
      creativeDirectionMarkdown: '作品定位：以人物选择推动奇幻悬疑故事。',
      writingRulesMarkdown: '正文规范：保持贴近主角的有限视角，避免替人物解释情绪。'.repeat(12),
      genre: '东方奇幻',
      targetAudience: '成年读者',
      referenceWorks: '参考作品仅借鉴悬念节奏，不复用设定。',
      worldbuilding: '世界共同规则：记忆晶体可以记录，但不能恢复完整人生。',
      synopsis: '全书总纲：主角追查记忆税的来源，并选择公开真相。',
    }
    rosterSnapshot = {
      status: 'ready',
      revision: 4,
      entries: [{ name: '闻灯', role: 'protagonist' }, { name: '长夜', role: 'supporting' }],
      renderedMarkdown: '闻灯\n长夜',
    }
    await page.viewport(1280, 1150)
    await act(async () => root.render(<WorldBuildingEditor projectKey={projectPath} />))
    await act(async () => {
      await vi.waitFor(() => {
        expect(container.querySelector('[data-overview-entry="characters"]')?.textContent).toContain('2 个角色')
        expect(container.querySelector('[data-overview-entry="creative-direction"] .world-building-overview__status')?.textContent).toContain('有内容')
        expect(container.querySelector('[data-overview-entry="writing-rules"] .world-building-overview__status')?.textContent).toContain('有内容')
      })
    })
    expect(container.querySelectorAll('.world-building-overview__group')).toHaveLength(4)
    expect(Array.from(container.querySelectorAll('.world-building-overview__group')).map(group => group.querySelector('h2')?.textContent))
      .toEqual(['创作基础', '故事资料', '剧情规划', '资料整理'])
    expect(container.querySelector('[data-overview-entry="creative-direction"] .world-building-overview__status')?.textContent).not.toContain('查看与编辑')
    const entryGrid = container.querySelector<HTMLElement>('.world-building-overview__entries')!
    const visibleColumnCount = () => getComputedStyle(entryGrid).gridTemplateColumns.split(' ').filter(Boolean).length
    expect(visibleColumnCount()).toBe(3)
    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>('#vela-toast-root .vela-feedback-close').forEach(button => button.click())
    })
    await page.screenshot({ path: '../../../../screenshots/basic-settings-overview.png' })

    await page.viewport(1280, 640)
    const scrollArea = container.querySelector<HTMLElement>('.world-building-overview__body')!
    const header = container.querySelector<HTMLElement>('.world-building-overview__header')!
    const headerTop = header.getBoundingClientRect().top
    expect(scrollArea.scrollHeight).toBeGreaterThan(scrollArea.clientHeight)
    scrollArea.scrollTop = scrollArea.scrollHeight
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(scrollArea.scrollTop).toBeGreaterThan(0)
    expect(header.getBoundingClientRect().top).toBe(headerTop)
    const lastEntry = container.querySelector<HTMLElement>('[data-overview-entry="legacy"]')!
    expect(lastEntry.getBoundingClientRect().bottom).toBeLessThanOrEqual(scrollArea.getBoundingClientRect().bottom + 1)
    await page.viewport(1280, 1150)

    const lightPanelToken = getComputedStyle(container).getPropertyValue('--color-panel').trim()
    const lightAccentToken = getComputedStyle(container).getPropertyValue('--color-accent').trim()
    document.documentElement.setAttribute('data-theme', 'verdant')
    container.dataset.theme = 'verdant'
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(getComputedStyle(container).getPropertyValue('--color-accent').trim()).not.toBe(lightAccentToken)
    await page.screenshot({ path: '../../../../screenshots/basic-settings-overview-verdant.png' })

    document.documentElement.removeAttribute('data-theme')
    container.dataset.theme = 'light'
    await act(async () => { await useLocaleStore.getState().setLocale('en-US') })
    document.documentElement.classList.add('dark')
    container.classList.add('dark')
    container.dataset.theme = 'dark'
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(container.textContent).toContain('Basic settings overview')
    expect(container.textContent).toContain('View AI workflow')
    expect(getComputedStyle(container).getPropertyValue('--color-panel').trim()).not.toBe(lightPanelToken)
    await page.screenshot({ path: '../../../../screenshots/basic-settings-overview-dark.png' })

    const config = useProjectStore.getState().currentProject!
    useProjectStore.setState({
      currentProject: {
        ...config,
        novelConfig: {
          ...config.novelConfig,
          genre: 'Long fiction category '.repeat(10),
        },
      },
    })
    await page.viewport(820, 850)
    await act(async () => { await Promise.resolve() })
    expect(visibleColumnCount()).toBe(2)
    await page.viewport(560, 850)
    await act(async () => { await Promise.resolve() })
    expect(visibleColumnCount()).toBe(1)
    await page.viewport(380, 850)
    await act(async () => { await Promise.resolve() })
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(380)
    const longSummary = container.querySelector<HTMLElement>('[data-overview-entry="creative-direction"] .world-building-overview__summary-value')!
    expect(longSummary.scrollWidth).toBeLessThanOrEqual(longSummary.clientWidth)

    const firstCard = container.querySelector<HTMLButtonElement>('[data-overview-entry="creative-direction"] .world-building-overview__card-main')!
    firstCard.focus()
    expect(document.activeElement).toBe(firstCard)
    expect(getComputedStyle(firstCard).outlineStyle).not.toBe('none')
    document.documentElement.classList.remove('dark')
    container.classList.remove('dark')
  })
})
