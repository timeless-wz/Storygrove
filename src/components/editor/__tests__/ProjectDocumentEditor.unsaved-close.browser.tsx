import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectDocumentsStore } from '../../../stores/project-documents-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import EditorArea from '../../panels/EditorArea'

const PROJECT_PATH = 'C:\\novels\\close-document'
const PROJECT_SESSION = {
  projectId: 'close-document',
  leaseId: 'close-document-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Close document',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '', subGenre: '', targetAudience: '', totalChapters: 4, wordsPerChapter: 2500,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '',
    worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const TAB_ID = 'project-document:close'
const DOCUMENT_PATH = '卷纲.md'
const SAVED = '# 卷纲\n'
const DRAFT = '# 卷纲\n\n作者新写的段落\n'

const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalDocumentsState = useProjectDocumentsStore.getState()

function createInvokeHandler(options: { writeFails?: boolean } = {}) {
  return async (channel: string) => {
    if (channel === 'docs:write') {
      return options.writeFails
        ? { success: false, error: '磁盘写入失败' }
        : { success: true, commitState: 'committed' }
    }
    // 编辑器区域会同时渲染项目总览，它的数据读取必须返回合法形状。
    if (channel === 'db:timeline-get-all') return { settings: {}, events: [] }
    if (channel === 'db:blueprint-get-all') return []
    if (channel === 'db:map-get-all') return { nodes: [], edges: [] }
    if (channel === 'db:draft-list-all' || channel === 'fs:list-dir') return []
    return { success: false, error: `unexpected channel ${channel}` }
  }
}

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1, loading: false })
  useLayoutStore.setState({ sidebarView: 'documents', activeRailItem: 'project' })
  useProjectDocumentsStore.setState({
    documents: [],
    dataProjectKey: PROJECT_PATH,
    loading: false,
    loadingProjectKey: null,
    lastError: null,
    knowledgeIndex: {},
    knowledgeLoading: false,
    knowledgeBusyDocumentPath: null,
    knowledgeError: null,
  })
  // 编辑器区域会同时渲染项目总览，这里把它的数据源也放到确定状态。
  useStoryTimelineStore.setState({ events: [] })
  useEditorStore.setState({
    tabs: [{
      id: TAB_ID,
      name: DOCUMENT_PATH,
      type: 'project-document',
      filePath: DOCUMENT_PATH,
      content: DRAFT,
      savedContent: SAVED,
      dirty: true,
      projectKey: PROJECT_PATH,
    }],
    activeTabId: TAB_ID,
    draftLedgers: {},
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(createInvokeHandler())
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
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
  useEditorStore.setState(originalEditorState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useProjectDocumentsStore.setState(originalDocumentsState)
  vi.restoreAllMocks()
})

function buttonWithLabel(label: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('button'))
    .find(button => (button.textContent ?? '').trim() === label)
}

/** 项目总览也是编辑器区域的一部分；断言只针对那份未保存的项目文档。 */
function documentTabs() {
  return useEditorStore.getState().tabs.filter(tab => tab.type === 'project-document')
}

async function openCloseDialog(): Promise<void> {
  await act(async () => {
    root.render(<EditorArea onNewProject={() => {}} />)
  })
  // 让这份文档成为当前标签页，确保关闭确认针对它。
  await act(async () => {
    useEditorStore.getState().setActiveTab(TAB_ID)
  })
  const closeButton = container.querySelector<HTMLElement>(
    `.writer-tab-close[title="有未保存的修改，点击关闭"]`,
  )
  expect(closeButton).not.toBeNull()
  await act(async () => {
    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('closing an unsaved project document', () => {
  it('offers save, discard and cancel', async () => {
    await openCloseDialog()

    expect(buttonWithLabel('取消')).toBeDefined()
    expect(buttonWithLabel('放弃修改')).toBeDefined()
    expect(buttonWithLabel('保存并关闭')).toBeDefined()
  })

  it('saves the raw markdown and then closes the tab', async () => {
    await openCloseDialog()

    await act(async () => {
      buttonWithLabel('保存并关闭')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.waitFor(() => expect(documentTabs()).toHaveLength(0))
    })

    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === 'docs:write')
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0][1]).toBe(DOCUMENT_PATH)
    expect(writeCalls[0][2]).toBe(DRAFT)
  })

  it('keeps the document open and unsaved when the save fails', async () => {
    invoke.mockImplementation(createInvokeHandler({ writeFails: true }))
    await openCloseDialog()

    await act(async () => {
      buttonWithLabel('保存并关闭')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.waitFor(() => expect(
        invoke.mock.calls.filter(([channel]) => channel === 'docs:write'),
      ).toHaveLength(1))
    })

    // 保存失败绝不能当作“已放弃”：文档保持打开且仍是未保存状态。
    const remaining = documentTabs()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].dirty).toBe(true)
    expect(remaining[0].content).toBe(DRAFT)
  })

  it('discards on explicit author confirmation without writing', async () => {
    await openCloseDialog()

    await act(async () => {
      buttonWithLabel('放弃修改')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(documentTabs()).toHaveLength(0)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'docs:write')).toHaveLength(0)
  })

  it('cancels without closing or writing', async () => {
    await openCloseDialog()

    await act(async () => {
      buttonWithLabel('取消')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(documentTabs()).toHaveLength(1)
    expect(documentTabs()[0].dirty).toBe(true)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'docs:write')).toHaveLength(0)
  })
})
