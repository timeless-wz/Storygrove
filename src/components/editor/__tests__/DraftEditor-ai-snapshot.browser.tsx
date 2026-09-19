import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { countDraftUnits } from '../../../shared/draft-units'
import { ReviewChapterCommand } from '../../../services/workflows/commands/review-chapter.command'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore, type WorkflowDefinition } from '../../../stores/workflow-store'
import DraftEditor from '../DraftEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\draft-ai-snapshot'
const PROJECT_SESSION = Object.freeze({
  projectId: 'draft-ai-snapshot-project',
  leaseId: 'draft-ai-snapshot-lease',
  projectPath: PROJECT_PATH,
})
const TAB_ID = 'draft-ai-snapshot-tab'
const FILE_PATH = 'vela://draft/7'
const SAVED_BODY = '数据库中的旧稿正文'
const SCREEN_BODY = '屏幕上的未保存正文'
/** Vditor 会把正文归一化为 Markdown，正文本身仍必须包含作者输入的内容。 */
const READY_TIMEOUT = 20000

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
let startWorkflow: ReturnType<typeof vi.fn>
let reviewExecute: ReturnType<typeof vi.spyOn>
let screenBody: string
const originalEditorState = useEditorStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()

/** 等 Vditor 载入本地解析器并渲染出可编辑正文。 */
async function readyProse(): Promise<HTMLElement> {
  await act(async () => {
    await vi.waitFor(
      () => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(),
      { timeout: READY_TIMEOUT },
    )
  })
  return container.querySelector('.vditor-ir pre.vditor-reset') as HTMLElement
}

/** 用浏览器原生输入替换（replace=true）或追加正文，走完整的 Vditor input 事件链。 */
async function typeIntoProse(value: string, replace: boolean): Promise<void> {
  const prose = await readyProse()
  await act(async () => {
    prose.focus()
    const range = document.createRange()
    range.selectNodeContents(prose)
    if (!replace) range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.execCommand('insertText', false, value)
  })
}

beforeEach(async () => {
  reviewExecute = vi.spyOn(ReviewChapterCommand.prototype, 'execute').mockResolvedValue('')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:draft-get-meta') {
      return {
        id: 7,
        chapterNumber: 1,
        version: 1,
        status: 'draft',
        source: 'write',
        contentId: 70,
        wordCount: SAVED_BODY.length,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
      }
    }
    if (channel === 'db:blueprint-get-all') return []
    if (channel === 'db:draft-list') return [{ id: 7, version: 1 }]
    if (channel === 'db:revision-get-pending' || channel === 'db:review-list') return []
    if (channel === 'db:draft-update-content') return { success: true }
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
      name: 'Draft AI snapshot',
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
      name: 'Chapter 1',
      type: 'chapter',
      filePath: FILE_PATH,
      content: SAVED_BODY,
      savedContent: SAVED_BODY,
      dirty: false,
      draftId: 7,
      draftStatus: 'draft',
      chapterNumber: 1,
      projectKey: PROJECT_PATH,
      projectSessionLease: PROJECT_SESSION.leaseId,
      contentRevision: 0,
    }],
    activeTabId: TAB_ID,
  })
  startWorkflow = vi.fn(async () => 'captured-workflow')
  useWorkflowStore.setState({
    activeRuns: [],
    startWorkflow: startWorkflow as never,
  })

  await act(async () => root.render(
    <DraftEditor
      tabId={TAB_ID}
      filePath={FILE_PATH}
      content={SAVED_BODY}
      projectKey={PROJECT_PATH}
    />,
  ))
  await readyProse()
  await expect.element(page.getByRole('button', { name: 'AI 审稿' })).toBeVisible()

  await typeIntoProse(SCREEN_BODY, true)
  await act(async () => {
    await vi.waitFor(() => {
      expect(useEditorStore.getState().tabs[0]).toMatchObject({ dirty: true })
    })
  })
  const tab = useEditorStore.getState().tabs[0]
  expect(tab.content).toContain(SCREEN_BODY)
  expect(tab.content).not.toContain(SAVED_BODY)
  screenBody = tab.content ?? ''
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useEditorStore.setState(originalEditorState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  reviewExecute.mockRestore()
  setActiveProjectSessionContext(null)
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('DraftEditor AI source snapshot', () => {
  it('freezes the dirty screen body before starting AI review and verifies automated refine entry is absent', async () => {
    // 确认不存在自动修稿与待合并入口
    expect(container.textContent).not.toContain('AI 修稿')
    expect(container.textContent).not.toContain('待合并')
    expect(container.textContent).not.toContain('自动修稿')

    await act(async () => page.getByRole('button', { name: 'AI 审稿' }).click())
    await expect.element(page.getByRole('button', { name: '开始一致性审核' })).toBeVisible()
    await act(async () => page.getByRole('button', { name: '开始一致性审核' }).click())

    await act(async () => {
      await vi.waitFor(() => expect(startWorkflow).toHaveBeenCalled())
    })
    const definition = startWorkflow.mock.calls[0]?.[0] as WorkflowDefinition
    await definition.steps[0].executor({} as never, {} as never, {} as never)
    const instance = reviewExecute.mock.instances[0] as unknown as {
      params: {
        draftContent: string
        sourceDraft: { id: number; chapterNumber: number; version: number; status: string; contentRevision: number }
      }
    }
    expect(instance.params.draftContent).toBe(screenBody)
    expect(instance.params.sourceDraft).toEqual({
      id: 7,
      chapterNumber: 1,
      version: 1,
      status: 'draft',
      contentRevision: 1,
    })
    expect(invoke.mock.calls).toContainEqual([
      'db:draft-update-content',
      7,
      screenBody,
      countDraftUnits(screenBody),
      PROJECT_PATH,
      PROJECT_SESSION,
    ])
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:draft-get-full')).toBe(false)
    // 审核后正文未被自动改写
    expect(useEditorStore.getState().tabs[0].content).toBe(screenBody)
  })

  it('does not start AI review when the author keeps typing while the frozen source is being verified', async () => {
    const originalInvoke = invoke.getMockImplementation() as
      | ((channel: string, ...args: unknown[]) => unknown)
      | undefined
    if (!originalInvoke) throw new Error('missing IPC fixture')
    let releaseDraftSave!: () => void
    const draftSaveGate = new Promise<void>((resolve) => {
      releaseDraftSave = resolve
    })
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:draft-update-content') await draftSaveGate
      return originalInvoke(channel, ...args)
    })

    await act(async () => page.getByRole('button', { name: 'AI 审稿' }).click())
    await expect.element(page.getByRole('button', { name: '开始一致性审核' })).toBeVisible()
    await act(async () => page.getByRole('button', { name: '开始一致性审核' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(
        invoke.mock.calls.some(([channel]) => channel === 'db:draft-update-content'),
      ).toBe(true))
    })

    const bodyAfterConfirmation = `${SCREEN_BODY}，确认后继续输入。`
    await typeIntoProse('，确认后继续输入。', false)
    const tabAfterTyping = await act(async () => vi.waitFor(() => {
      const current = useEditorStore.getState().tabs[0]
      expect(current).toMatchObject({
        contentRevision: 2,
        dirty: true,
      })
      return current
    }))
    expect(tabAfterTyping.content).toContain(bodyAfterConfirmation)

    releaseDraftSave()
    await act(async () => {
      await draftSaveGate
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(startWorkflow).not.toHaveBeenCalled()
  })
})
