import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { countDraftUnits } from '../../../shared/draft-units'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { useLocaleStore } from '../../../stores/locale-store'
import DraftEditor from '../DraftEditor'

const mockConfirm = vi.fn<(message?: string, options?: unknown) => Promise<boolean>>(async () => true)
vi.mock('../../ui/Confirm', () => ({
  confirm: (message?: string, options?: unknown) => mockConfirm(message, options),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\vditor-integration'
const PROJECT_SESSION = Object.freeze({
  projectId: 'vditor-integration-project',
  leaseId: 'vditor-integration-lease',
  projectPath: PROJECT_PATH,
})
const TAB_ID = 'tab-vditor-integration'
const FILE_PATH = 'vela://draft/10'
const INITIAL_CONTENT = '# 第二章 风暴降临\n\n海风呼啸着卷过港口。'
const READY_TIMEOUT = 20000

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
let startWorkflow: ReturnType<typeof vi.fn>
const originalLocaleState = useLocaleStore.getState()
const originalEditorState = useEditorStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()

async function waitForVditorReady(): Promise<HTMLElement> {
  await act(async () => {
    await vi.waitFor(
      () => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(),
      { timeout: READY_TIMEOUT },
    )
  })
  const prose = container.querySelector('.vditor-ir pre.vditor-reset')
  expect(prose).not.toBeNull()
  return prose as HTMLElement
}

async function typeIntoProse(textToInsert: string): Promise<void> {
  const prose = await waitForVditorReady()
  await act(async () => {
    prose.focus()
    const range = document.createRange()
    range.selectNodeContents(prose.lastElementChild ?? prose)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.execCommand('insertText', false, textToInsert)
  })
}

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  mockConfirm.mockClear()
  mockConfirm.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:draft-get-meta') {
      const draftId = args[0] === 11 ? 11 : 10
      return {
        id: draftId,
        chapterNumber: draftId === 11 ? 3 : 2,
        version: 1,
        status: 'draft',
        source: 'write',
        contentId: 100,
        wordCount: INITIAL_CONTENT.length,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
      }
    }
    if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 2, title: '风暴降临' }]
    if (channel === 'db:draft-list') return [{ id: 10, version: 1 }]
    if (channel === 'db:foreshadowing-list-by-draft') return []
    if (channel === 'db:draft-get-latest') return args[0] === 3
      ? { id: 11, chapterNumber: 3, version: 1, status: 'draft' }
      : null
    if (channel === 'db:draft-get-full') return args[0] === 11
      ? { content: '# 第三章 雨夜' }
      : { content: INITIAL_CONTENT }
    if (channel === 'db:revision-get-pending' || channel === 'db:review-list') return []
    if (channel === 'db:draft-update-content') return { success: true }
    if (channel === 'publication:publish') {
      return { success: true, committed: true, finalizationId: 'publication-10', publicationStatus: 'published' }
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

  useProjectStore.setState({
    currentProject: {
      id: PROJECT_SESSION.projectId,
      name: 'Vditor integration novel',
      path: PROJECT_PATH,
      sessionLease: PROJECT_SESSION.leaseId,
      novelConfig: {
        writingLanguage: 'zh-CN',
        genre: 'fantasy',
        subGenre: '',
        targetAudience: 'all',
        totalChapters: 10,
        wordsPerChapter: 3000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
      },
      characterStates: '',
      createdAt: '',
      updatedAt: '',
    },
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  useEditorStore.setState({
    tabs: [{
      id: TAB_ID,
      name: 'Chapter 2',
      type: 'chapter',
      filePath: FILE_PATH,
      content: INITIAL_CONTENT,
      savedContent: INITIAL_CONTENT,
      dirty: false,
      draftId: 10,
      draftStatus: 'draft',
      chapterNumber: 2,
      projectKey: PROJECT_PATH,
      projectSessionLease: PROJECT_SESSION.leaseId,
      contentRevision: 0,
    }],
    activeTabId: TAB_ID,
  })
  startWorkflow = vi.fn(async () => 'mock-workflow-run')
  useWorkflowStore.setState({
    activeRuns: [],
    startWorkflow: startWorkflow as never,
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLocaleStore.setState(originalLocaleState)
  useEditorStore.setState(originalEditorState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  setActiveProjectSessionContext(null)
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('DraftEditor Vditor integration', () => {
  it('loads draft in Vditor, tracks dirty state on edit, clears dirty on save, and retains AI review without refine/merge', async () => {
    await act(async () => root.render(
      <DraftEditor
        tabId={TAB_ID}
        filePath={FILE_PATH}
        content={INITIAL_CONTENT}
        projectKey={PROJECT_PATH}
      />,
    ))

    // 1. 草稿正文以 Vditor 打开，处于即时渲染（IR）模式
    const prose = await waitForVditorReady()
    expect(container.querySelector('[data-vditor-prose-editor="true"]')).not.toBeNull()
    expect(prose.textContent).toContain('海风呼啸着卷过港口。')
    expect(prose.getAttribute('contenteditable')).toBe('true')

    // 5 & 6. AI 审稿入口存在；严格不存在“AI 修稿”、“待合并”、“自动合并”入口
    await expect.element(page.getByRole('button', { name: 'AI 审稿' })).toBeVisible()
    expect(container.textContent).not.toContain('AI 修稿')
    expect(container.textContent).not.toContain('待合并')
    expect(container.textContent).not.toContain('自动合并')

    // 点击 AI 审稿应能打开审核确认弹窗
    await act(async () => page.getByRole('button', { name: 'AI 审稿' }).click())
    await expect.element(page.getByRole('button', { name: '开始一致性审核' })).toBeVisible()
    // 取消弹窗
    await act(async () => page.getByRole('button', { name: '取消' }).click())

    // 2. 输入正文后草稿标签被标记为 dirty
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
    const appendText = '\n\n浪涛拍打着防波堤。'
    await typeIntoProse(appendText)

    await act(async () => {
      await vi.waitFor(() => {
        expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
      })
    })
    const tabAfterTyping = useEditorStore.getState().tabs[0]
    expect(tabAfterTyping.content).toContain('浪涛拍打着防波堤。')

    // 3. 保存后 dirty 被清除，并且通过 IPC 写入数据库
    const saveButton = page.getByRole('button', { name: '保存' })
    await expect.element(saveButton).toBeVisible()
    await act(async () => saveButton.click())

    await act(async () => {
      await vi.waitFor(() => {
        expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
      })
    })
    expect(invoke.mock.calls).toContainEqual([
      'db:draft-update-content',
      10,
      tabAfterTyping.content,
      countDraftUnits(tabAfterTyping.content ?? ''),
      PROJECT_PATH,
      PROJECT_SESSION,
    ])
  })

  it('keeps a published chapter editable and displays its published status', async () => {
    // 发布到正文后依旧是作者可修改的正文。
    useEditorStore.setState({
      tabs: [{
        id: TAB_ID,
        name: 'Chapter 2',
        type: 'chapter',
        filePath: FILE_PATH,
        content: INITIAL_CONTENT,
        savedContent: INITIAL_CONTENT,
        dirty: false,
        draftId: 10,
        draftStatus: 'finalized',
        chapterNumber: 2,
        projectKey: PROJECT_PATH,
        projectSessionLease: PROJECT_SESSION.leaseId,
        contentRevision: 0,
      }],
      activeTabId: TAB_ID,
    })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-meta') {
        return {
          id: 10,
          chapterNumber: 2,
          version: 1,
          status: 'finalized',
          source: 'write',
          contentId: 100,
          wordCount: INITIAL_CONTENT.length,
          createdAt: '2026-09-06T00:00:00.000Z',
          updatedAt: '2026-09-06T00:00:00.000Z',
        }
      }
      if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 2, title: '风暴降临' }]
      if (channel === 'db:draft-list') return [{ id: 10, version: 1 }]
      if (channel === 'db:revision-get-pending' || channel === 'db:review-list') return []
      return { success: true }
    })

    await act(async () => root.render(
      <DraftEditor
        tabId={TAB_ID}
        filePath={FILE_PATH}
        content={INITIAL_CONTENT}
        projectKey={PROJECT_PATH}
      />,
    ))

    const prose = await waitForVditorReady()
    expect(prose.getAttribute('contenteditable')).toBe('true')
    expect(container.textContent).toContain('已发布')
    expect(container.textContent).not.toContain('只读')
    expect(container.querySelector('.vditor-toolbar button[data-type="bold"]')?.classList.contains('vditor-menu--disabled')).toBe(false)
    expect(container.querySelector('.vditor-toolbar button[data-type="edit-mode"]')?.classList.contains('vditor-menu--disabled')).toBe(false)

    await typeIntoProse('继续修改')
    const saveButton = page.getByRole('button', { name: '保存' })
    await act(async () => saveButton.click())
    await act(async () => {
      await vi.waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === 'publication:publish')).toBe(true))
    })
  })

  it('saves dirty prose before opening the next chapter', async () => {
    await act(async () => root.render(
      <DraftEditor
        tabId={TAB_ID}
        filePath={FILE_PATH}
        content={INITIAL_CONTENT}
        projectKey={PROJECT_PATH}
      />,
    ))
    await typeIntoProse('\n\n新的结尾。')
    await act(async () => {
      await vi.waitFor(() => expect(useEditorStore.getState().tabs[0].dirty).toBe(true))
    })

    await act(async () => page.getByRole('button', { name: '下一章' }).click())
    await act(async () => {
      await vi.waitFor(() => {
        const state = useEditorStore.getState()
        expect(state.tabs.find(tab => tab.id === state.activeTabId)?.filePath).toBe('vela://draft/11')
      })
    })
    const channels = invoke.mock.calls.map(([channel]) => channel)
    expect(channels.indexOf('db:draft-update-content')).toBeGreaterThanOrEqual(0)
    expect(channels.indexOf('db:draft-get-latest')).toBeGreaterThan(channels.indexOf('db:draft-update-content'))
    expect(useEditorStore.getState().tabs.find(tab => tab.id === TAB_ID)?.dirty).toBe(false)
  })

  it('publishes a draft directly to the manuscript without starting the finalization workflow', async () => {
    await act(async () => root.render(
      <DraftEditor
        tabId={TAB_ID}
        filePath={FILE_PATH}
        content={INITIAL_CONTENT}
        projectKey={PROJECT_PATH}
      />,
    ))
    await waitForVditorReady()

    const publishButton = page.getByRole('button', { name: '发布到正文' })
    await expect.element(publishButton).toBeVisible()
    await act(async () => publishButton.click())

    expect(mockConfirm).toHaveBeenCalled()
    await act(async () => {
      await vi.waitFor(() => expect(invoke.mock.calls.some(([channel]) => channel === 'publication:publish')).toBe(true))
    })
    expect(useEditorStore.getState().tabs[0]?.draftStatus).toBe('finalized')
    expect(startWorkflow).not.toHaveBeenCalled()
  })
})
