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
import { useWorkflowStore } from '../../../stores/workflow-store'
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
  creativeDirectionMarkdown: '已有创作方向',
  writingRulesMarkdown: '已有写作规范',
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

async function setMarkdownEditor(index: number, markdown: string): Promise<void> {
  const hosts = container.querySelectorAll<HTMLElement>('[data-vditor-prose-editor="true"]')
  await vi.waitFor(() => expect(hosts.length).toBe(3))
  const host = hosts.item(index)
  await vi.waitFor(() => expect(host.getAttribute('data-vditor-ready')).toBe('true'))
  const sourceMode = host.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-mode="sv"]')
  expect(sourceMode).not.toBeNull()
  await act(async () => sourceMode?.click())
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
  expect(textarea).not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, markdown)
    textarea?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('NovelConfigEditor page sections', () => {
  it('edits and saves creative direction, references, prose rules, and compact writing parameters independently', async () => {
    await renderEditor()

    await expect.element(page.getByRole('heading', { name: '创作方向', exact: true }).first()).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: '创作方向分区' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '定位与参数' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '创作原则' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: '写作规范' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '生成初始构想' })).toBeVisible()
    expect(container.querySelector<HTMLDetailsElement>('details.novel-config-page__advanced')?.open).toBe(false)
    expect(container.querySelectorAll('[data-vditor-prose-editor="true"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-document-layout="business-field"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-heading-toc="enabled"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-heading-toc="disabled"]')).toHaveLength(3)
    await vi.waitFor(() => expect(container.querySelectorAll('[data-vditor-prose-editor="true"][data-vditor-ready="true"]')).toHaveLength(3))
    for (const surface of container.querySelectorAll<HTMLElement>('[data-document-layout="business-field"]')) {
      expect(surface.querySelector('nav[aria-label="文档目录"]')).toBeNull()
      expect(getComputedStyle(surface.querySelector('.vditor-toolbar')!).display).toBe('none')
    }
    expect(container.querySelector('.novel-config-page__content')?.classList.contains('max-w-6xl')).toBe(true)
    await page.viewport(462, 1000)
    await page.screenshot({ path: '../../../../output/playwright/novel-config-fields-narrow.png', fullPage: true } as Parameters<typeof page.screenshot>[0])
    await page.viewport(1280, 1000)
    await page.screenshot({ path: '../../../../output/playwright/novel-config-fields.png', fullPage: true } as Parameters<typeof page.screenshot>[0])
    await act(async () => { await page.getByRole('link', { name: '写作规范' }).click() })
    await page.screenshot({ path: '../../../../output/playwright/novel-config-writing-rules.png' })
    await page.viewport(462, 1000)
    await page.screenshot({ path: '../../../../output/playwright/novel-config-writing-rules-narrow.png', fullPage: true } as Parameters<typeof page.screenshot>[0])

    const direction = '# 阅读体验\n\n- 让读者感到辽阔\n- 保持人物选择有代价'
    const references = '| 作品 | 借鉴 |\n| --- | --- |\n| 参考文本甲 | 叙事节奏；不复用情节 |'
    const rules = '> 叙述视角跟随当前场景人物。\n\n正文使用简体中文，避免替人物补充未确认的真相。'
    await setMarkdownEditor(0, direction)
    await setMarkdownEditor(1, references)
    await act(async () => page.getByRole('link', { name: '写作规范' }).click())
    await setMarkdownEditor(2, rules)
    await act(async () => {
      await page.getByRole('combobox', { name: '叙述视角' }).selectOptions('first_person')
      const advanced = container.querySelectorAll<HTMLDetailsElement>('details.novel-config-page__advanced')[1]
      advanced?.querySelector('summary')?.click()
      await page.getByRole('combobox', { name: '情节组织方式' }).selectOptions('freeform')
    })

    const current = useProjectStore.getState().currentProject?.novelConfig
    expect(current?.creativeDirectionMarkdown).toContain('阅读体验')
    expect(current?.referenceWorks).toContain('参考文本甲')
    expect(current?.writingRulesMarkdown).toContain('未确认的真相')
    expect(current?.narrativePOV).toBe('first_person')
    expect(current?.totalChapters).toBe(80)
    expect(current?.wordsPerChapter).toBe(3200)
    expect(container.textContent).toContain('目标字数：256,000 字')
    expect(container.querySelector('input[aria-label="沉寂提醒阈值（章）"]')).toBeNull()

    await act(async () => page.getByRole('button', { name: '保存', exact: true }).click())
    const saved = savedProjectData?.novelConfig
    expect(saved?.creativeDirectionMarkdown).toContain('让读者感到辽阔')
    expect(saved?.referenceWorks).toContain('不复用情节')
    expect(saved?.writingRulesMarkdown).toContain('简体中文')
    expect(saved?.narrativePOV).toBe('first_person')
    expect(saved?.plotStructure).toBe('freeform')
    expect(saved?.coreOutline).toBe(BASE_CONFIG.coreOutline)
    expect(saved?.worldSetting).toBe(BASE_CONFIG.worldSetting)
  })

  it('keeps old config text in its traceable legacy entry and opens the dedicated organizer', async () => {
    await renderEditor()
    expect(container.querySelector('textarea[aria-label="故事构想"]')).toBeNull()
    const legacy = container.querySelector<HTMLDetailsElement>('#novel-config-legacy')!
    expect(legacy.open).toBe(false)
    await act(async () => legacy.querySelector('summary')?.click())
    await expect.element(page.getByText(/旧故事构想、背景构想、主角优势/)).toBeVisible()
    await act(async () => page.getByRole('button', { name: '查看待整理旧内容' }).click())
    expect(useEditorStore.getState().tabs.some(tab => (
      tab.type === 'creative-materials' && tab.creativeMaterialsView === 'legacy'
    ))).toBe(true)
  })

  it('shows the new section and responsibility labels in English', async () => {
    useLocaleStore.setState({ locale: 'en-US', initialized: true })
    await renderEditor()

    await expect.element(page.getByRole('heading', { name: 'Creative direction', exact: true }).first()).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Reading experience and creative principles' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Writing rules' })).toBeVisible()
    await expect.element(page.getByText(/Story facts, characters, world rules, and plot plans live in their dedicated pages/)).toBeVisible()
  })

  it('keeps newly entered Markdown visible when saving fails', async () => {
    const failedSave = vi.fn(async () => false)
    useProjectStore.setState({ currentProject: makeProject(), saveProject: failedSave as never })
    useWorkflowStore.setState({ globalLogs: [] })
    await renderEditor()
    await setMarkdownEditor(2, '失败后保留的正文规范')

    await act(async () => page.getByRole('button', { name: '保存', exact: true }).click())
    await vi.waitFor(() => expect(useWorkflowStore.getState().globalLogs.at(-1)?.message).toContain('保存失败'))
    expect(failedSave).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().activeTabId).toBe(CONFIG_TAB_ID)
    expect(useProjectStore.getState().currentProject?.novelConfig.writingRulesMarkdown).toContain('失败后保留的正文规范')
    expect(container.querySelectorAll('[data-vditor-prose-editor="true"]')[2]?.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')?.value).toContain('失败后保留的正文规范')
  })
})
