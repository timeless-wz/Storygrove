import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NovelConfig, ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore, createProjectScopedEditorTabId } from '../../../stores/editor-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore, type WorkflowDefinition } from '../../../stores/workflow-store'
import '../../../index.css'
import NovelConfigEditor from '../NovelConfigEditor'

const PROJECT_PATH = 'C:\\novels\\creative-direction-sections'
const PROJECT_SESSION = {
  projectId: 'creative-direction-sections',
  leaseId: 'creative-direction-sections-lease',
  projectPath: PROJECT_PATH,
}
const CONFIG_TAB_ID = createProjectScopedEditorTabId('config', 'config', PROJECT_PATH)

const BASE_CONFIG: NovelConfig = {
  writingLanguage: 'zh-CN',
  creativeStrategy: 'consistency-first',
  narrativeThreadDormantChapterThreshold: 7,
  genre: '仙侠',
  subGenre: '山海异闻',
  targetAudience: '男频',
  totalChapters: 80,
  wordsPerChapter: 3200,
  plotStructure: 'multi_thread',
  narrativePOV: 'third_limited',
  coreOutline: '原故事构想',
  worldSetting: '原背景构想',
  goldenFinger: '原主角优势',
  protagonistProfile: '原主角构想',
  globalGuidance: '原全局要求',
  writingStyle: '原文风',
  referenceWorks: '原参考作品',
}

const originalProjectState = useProjectStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalLlmState = useLLMStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
let savedProjectData: ProjectData | null

function makeProject(): ProjectData {
  return {
    id: PROJECT_SESSION.projectId,
    sessionLease: PROJECT_SESSION.leaseId,
    name: 'Creative direction test',
    path: PROJECT_PATH,
    novelConfig: { ...BASE_CONFIG },
    characterStates: 'existing character data',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  }
}

async function renderEditor(projectKey = PROJECT_PATH): Promise<void> {
  await act(async () => {
    root.render(<NovelConfigEditor projectKey={projectKey} />)
  })
}

function installVelaApi(saveSuccess = true): void {
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'config:set') return { success: true }
    if (channel === 'project:save') {
      savedProjectData = args[1] as ProjectData
      return { success: saveSuccess }
    }
    if (channel === 'db:project-core-get') {
      return { premise: '正式前提', worldbuilding: '正式世界观总纲', synopsis: '正式情节大纲' }
    }
    throw new Error(`Unexpected IPC channel: ${channel}`)
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
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  savedProjectData = null
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: makeProject(), projectSessionEpoch: 1 })
  useEditorStore.setState({
    tabs: [{
      id: CONFIG_TAB_ID,
      name: '创作方向',
      type: 'config',
      projectKey: PROJECT_PATH,
      dirty: false,
    }],
    activeTabId: CONFIG_TAB_ID,
    draftLedgers: {},
  })
  useWorkflowStore.setState({
    activeRuns: [], history: [], globalLogs: [], waitingRuns: {}, currentRun: null,
    waitingForConfirm: false, waitingAfterStepIndex: -1,
  })
  useLLMStore.setState({ defaultModelId: null })
  setActiveProjectSessionContext(PROJECT_SESSION)
  installVelaApi()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useProjectStore.setState(originalProjectState)
  useEditorStore.setState(originalEditorState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState(originalLocaleState)
  useWorkflowStore.setState(originalWorkflowState)
  useLLMStore.setState(originalLlmState)
  vi.restoreAllMocks()
})

describe('NovelConfigEditor page sections', () => {
  it('keeps all fields independent across section navigation and the collapsed advanced options, then saves the same config keys', async () => {
    await renderEditor()

    await expect.element(page.getByRole('heading', { name: '创作方向' })).toBeVisible()
    await expect.element(page.getByText(/核心构想中的故事、背景、主角优势和主角构想仍会用于 AI 生成与正文写作/)).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: '创作方向分区' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '基础信息' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '核心构想' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '写作要求' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'AI 填充配置' })).toBeVisible()
    await page.screenshot({ path: '../../../../screenshots/creative-direction-core-ideas.png' })
    await page.viewport(1280, 1000)
    await act(async () => {
      await page.getByRole('link', { name: '核心构想' }).click()
    })
    await page.screenshot({ path: '../../../../screenshots/creative-direction-core-ideas-fields.png' })

    const advanced = container.querySelector<HTMLDetailsElement>('.novel-config-page__advanced')
    expect(advanced?.open).toBe(false)

    await act(async () => {
      await page.getByRole('link', { name: '核心构想' }).click()
      await page.getByRole('textbox', { name: '故事构想' }).fill('新故事构想')
      await page.getByRole('textbox', { name: '背景构想' }).fill('新背景构想')
      await page.getByRole('textbox', { name: '主角优势 / 核心卖点' }).fill('新主角优势')
      await page.getByRole('textbox', { name: '主角构想' }).fill('新主角构想')
      await page.getByRole('link', { name: '写作要求' }).click()
      await page.getByRole('textbox', { name: '全局写作要求' }).fill('新的独立全局要求')
      await page.getByRole('textbox', { name: '文风配置' }).fill('新的独立文风')
      await page.getByRole('textbox', { name: '参考作品' }).fill('新的独立参考作品')
      await page.getByText('高级选项', { exact: true }).click()
      await page.getByRole('combobox', { name: '情节组织方式' }).selectOptions('freeform')
      await page.getByRole('spinbutton', { name: '沉寂提醒阈值（章）' }).fill('12')
    })

    expect(advanced?.open).toBe(true)
    const expectedConfig: NovelConfig = {
      ...BASE_CONFIG,
      coreOutline: '新故事构想',
      worldSetting: '新背景构想',
      goldenFinger: '新主角优势',
      protagonistProfile: '新主角构想',
      globalGuidance: '新的独立全局要求',
      writingStyle: '新的独立文风',
      referenceWorks: '新的独立参考作品',
      plotStructure: 'freeform',
      narrativeThreadDormantChapterThreshold: 12,
    }
    expect(useProjectStore.getState().currentProject?.novelConfig).toEqual(expectedConfig)

    await act(async () => page.getByRole('button', { name: '保存', exact: true }).click())
    await vi.waitFor(() => expect(savedProjectData?.novelConfig).toEqual(expectedConfig))
    expect(useEditorStore.getState().draftLedgers.config).toBe(JSON.stringify({ version: 1, projects: [] }))
  })

  it('keeps a single field generation visibly running until its tracked workflow reaches a terminal state', async () => {
    useLLMStore.setState({ defaultModelId: 'model-field-test' })
    let finishRun!: () => void
    const startWorkflow = vi.fn((_definition: WorkflowDefinition) => {
      const runId = 'creative-direction-field-run'
      const step = {
        id: 'creative-direction-field-step',
        name: '故事构想',
        description: 'only this field',
        status: 'running',
        logs: [],
      }
      const run = {
        id: runId,
        projectPath: PROJECT_PATH,
        projectSession: PROJECT_SESSION,
        generationModelId: 'model-field-test',
        writingLanguage: 'zh-CN',
        uiLocale: 'zh-CN',
        type: 'config_generation',
        title: '创作方向：故事构想',
        status: 'running',
        steps: [step],
        currentStepIndex: 0,
        createdAt: new Date().toISOString(),
        resourceKeys: ['novel-config'],
      }
      act(() => useWorkflowStore.setState({ activeRuns: [run] as never }))
      return new Promise<string>((resolve) => {
        finishRun = () => {
          useProjectStore.setState(state => ({
            currentProject: state.currentProject
              ? { ...state.currentProject, novelConfig: { ...state.currentProject.novelConfig, coreOutline: '工作流生成的构想' } }
              : null,
          }))
          useWorkflowStore.setState({
            activeRuns: [],
            history: [{
              ...run,
              status: 'completed',
              steps: [{ ...step, status: 'completed', progress: 100, result: '工作流生成的构想' }],
            }] as never,
          })
          resolve(runId)
        }
      })
    })
    useWorkflowStore.setState({ startWorkflow: startWorkflow as never })
    await renderEditor()

    await act(async () => {
      await page.getByRole('button', { name: 'AI 生成' }).first().click()
    })

    await vi.waitFor(() => expect(startWorkflow).toHaveBeenCalledOnce())
    const definition = startWorkflow.mock.calls[0]![0]
    expect(definition).toMatchObject({
      type: 'config_generation',
      title: '创作方向：故事构想',
      projectPath: PROJECT_PATH,
      projectSession: PROJECT_SESSION,
      generationModelId: 'model-field-test',
      resourceKeys: ['novel-config'],
      steps: [{ name: '故事构想' }],
    })
    expect(definition.steps).toHaveLength(1)
    await expect.element(page.getByRole('button', { name: '生成中...' })).toBeDisabled()
    expect(useProjectStore.getState().currentProject?.novelConfig.coreOutline).toBe('原故事构想')

    await act(async () => finishRun())
    await expect.element(page.getByRole('textbox', { name: '故事构想' })).toHaveValue('工作流生成的构想')
    await expect.element(page.getByRole('button', { name: 'AI 生成' }).first()).toBeEnabled()
  })

  it('explains in English that all four idea fields still inform generation and prose', async () => {
    useLocaleStore.setState({ locale: 'en-US', initialized: true })
    await renderEditor()

    await expect.element(page.getByRole('heading', { name: 'Core ideas' })).toBeVisible()
    await expect.element(page.getByText(/continue to inform AI generation and prose writing/)).toBeVisible()
    await expect.element(page.getByText(/Changes do not automatically sync the story premise/)).toBeVisible()
  })

  it('saves the project config before opening the original worldbuilding overview tab', async () => {
    await renderEditor()
    await act(async () => {
      await page.getByRole('textbox', { name: '背景构想' }).fill('保存后去世界观总纲')
      await page.getByRole('button', { name: '打开世界观总纲' }).click()
    })

    await vi.waitFor(() => expect(useEditorStore.getState().tabs.some(tab => (
      tab.type === 'arch-file' && tab.filePath === 'vela://core/worldbuilding'
    ))).toBe(true))
    expect(savedProjectData?.novelConfig).toMatchObject({
      worldSetting: '保存后去世界观总纲',
      coreOutline: BASE_CONFIG.coreOutline,
      protagonistProfile: BASE_CONFIG.protagonistProfile,
      globalGuidance: BASE_CONFIG.globalGuidance,
      writingStyle: BASE_CONFIG.writingStyle,
      referenceWorks: BASE_CONFIG.referenceWorks,
      creativeStrategy: BASE_CONFIG.creativeStrategy,
    })
    const worldbuildingTab = useEditorStore.getState().tabs.find(tab => (
      tab.type === 'arch-file' && tab.filePath === 'vela://core/worldbuilding'
    ))
    expect(worldbuildingTab).toMatchObject({
      content: '正式世界观总纲',
      projectKey: PROJECT_PATH,
    })
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['project:save', 'db:project-core-get'])
    expect(useProjectStore.getState().currentProject?.novelConfig.worldSetting).toBe('保存后去世界观总纲')
  })

  it('saves the protagonist concept before opening the existing character profile in edit view', async () => {
    await renderEditor()
    await act(async () => {
      await page.getByRole('textbox', { name: '主角构想' }).fill('保存后去角色档案')
      await page.getByRole('button', { name: '打开角色档案' }).click()
    })

    await vi.waitFor(() => expect(savedProjectData?.novelConfig.protagonistProfile).toBe('保存后去角色档案'))
    expect(useLayoutStore.getState().sidebarView).toBe('characters')
    expect(useLayoutStore.getState().characterViewRequest?.view).toBe('edit')
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'character')).toBe(false)
    expect(useProjectStore.getState().currentProject?.novelConfig.protagonistProfile).toBe('保存后去角色档案')
  })

  it('stays on the current page and keeps input when saving before a linked page fails', async () => {
    const currentProject = makeProject()
    const failedSave = vi.fn(async () => false)
    useProjectStore.setState({ currentProject, saveProject: failedSave as never })
    useWorkflowStore.setState({ globalLogs: [] })
    await renderEditor()

    await act(async () => {
      await page.getByRole('textbox', { name: '背景构想' }).fill('保存失败后保留的草稿')
      await page.getByRole('button', { name: '打开世界观总纲' }).click()
    })

    await vi.waitFor(() => expect(useWorkflowStore.getState().globalLogs.at(-1)?.message).toContain('保存失败'))
    expect(failedSave).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().activeTabId).toBe(CONFIG_TAB_ID)
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'arch-file')).toBe(false)
    expect(useProjectStore.getState().currentProject?.novelConfig.worldSetting).toBe('保存失败后保留的草稿')
    await expect.element(page.getByRole('textbox', { name: '背景构想' })).toHaveValue('保存失败后保留的草稿')
  })
})
