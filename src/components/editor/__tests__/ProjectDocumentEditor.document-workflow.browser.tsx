import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { saveEditorTabBeforeClose, useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectDocumentsStore } from '../../../stores/project-documents-store'
import { useProjectStore } from '../../../stores/project-store'
import ProjectDocumentEditor from '../ProjectDocumentEditor'

const PROJECT_PATH = 'C:\\novels\\document-workflow'
const PROJECT_SESSION = {
  projectId: 'document-workflow',
  leaseId: 'document-workflow-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Document workflow',
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

const TAB_ID = 'project-document-tab'
const DOCUMENT_PATH = 'notes/卷纲.md'
const SAVED = '# 第一卷\n\n| 章 | 状态 |\n| --- | --- |\n| 1 | 已定稿 |\n\n- [x] 完成卷纲\n'
const DRAFT = `${SAVED}\n## 待办\n\n- [ ] 补写灵感\n`

const originalEditorState = useEditorStore.getState()
const originalDocumentsState = useProjectDocumentsStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY_TIMEOUT = 20000

async function waitForReady(): Promise<void> {
  await act(async () => {
    await vi.waitFor(
      () => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(),
      { timeout: READY_TIMEOUT },
    )
  })
}

async function renderDraft(): Promise<void> {
  await act(async () => {
    root.render(
      <ProjectDocumentEditor
        tabId={TAB_ID}
        documentPath={DOCUMENT_PATH}
        projectKey={PROJECT_PATH}
        content={DRAFT}
        savedContent={SAVED}
      />,
    )
  })
  await waitForReady()
}

function buttonWithLabel(label: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('button'))
    .find(button => (button.textContent ?? '').includes(label))
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1 })
  useEditorStore.setState({
    tabs: [{
      id: TAB_ID,
      name: '卷纲.md',
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
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(async (channel: string) => {
    if (channel === 'docs:write') return { success: true, commitState: 'committed' }
    if (channel === 'kb:import-text') return { success: true, docId: 'doc-1', chunkCount: 2 }
    if (channel === 'kb:remove-document') return { success: true }
    return { success: false, error: `unexpected channel ${channel}` }
  })
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
  useProjectDocumentsStore.setState(originalDocumentsState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  vi.restoreAllMocks()
})

describe('ProjectDocumentEditor', () => {
  it('renders with unified Vditor editor in instant rendering (IR) mode by default', async () => {
    await renderDraft()

    // 默认即时渲染：Vditor 宿主与 IR 编辑区域存在
    expect(container.querySelector('[data-vditor-prose-editor="true"]')).not.toBeNull()
    const irPre = container.querySelector('.vditor-ir pre.vditor-reset')
    expect(irPre).not.toBeNull()
    expect(irPre?.textContent).toContain('第一卷')

    // 旧的 CodeMirror 和旧项目文档双栏预览已彻底移除
    expect(container.querySelector('.cm-content')).toBeNull()
    expect(container.querySelector('[data-project-document-preview]')).toBeNull()
  })

  it('builds a clickable outline from the markdown headings', async () => {
    await renderDraft()

    const outline = container.querySelector('nav[aria-label="文档目录"]')
    expect(outline).not.toBeNull()
    const entries = Array.from(outline?.querySelectorAll('button') ?? [])
    expect(entries.map(entry => entry.textContent)).toEqual(['第一卷', '待办'])

    await act(async () => {
      entries[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 跳转不应破坏文档或抛出错误，Vditor 宿主保持正常。
    expect(container.querySelector('[data-vditor-prose-editor="true"]')).not.toBeNull()
  })

  it('shows the unsaved state and saves the raw markdown on demand', async () => {
    await renderDraft()

    // 未保存状态在标签页与工具栏都可见，且保存按钮可用。
    expect(container.querySelector('[title="有未保存的修改"]')).not.toBeNull()
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
    const saveButton = buttonWithLabel('保存')
    expect(saveButton).not.toBeNull()
    expect((saveButton as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === 'docs:write')
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0][1]).toBe(DOCUMENT_PATH)
    // 保存的是原始 Markdown 文本，预览解析结果绝不回写文件。
    expect(writeCalls[0][2]).toBe(DRAFT)
    expect(writeCalls[0][3]).toBe(PROJECT_PATH)
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
  })

  it('can save an unsaved document before closing it', async () => {
    await renderDraft()

    await act(async () => {
      await saveEditorTabBeforeClose(TAB_ID)
    })

    const writeCalls = invoke.mock.calls.filter(([channel]) => channel === 'docs:write')
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0][2]).toBe(DRAFT)
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
  })

  it('keeps the document open and dirty when saving fails', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'docs:write') return { success: false, error: '磁盘写入失败' }
      return { success: false }
    })
    await renderDraft()

    await act(async () => {
      await expect(saveEditorTabBeforeClose(TAB_ID)).rejects.toThrow()
    })
    expect(useEditorStore.getState().tabs).toHaveLength(1)
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
  })

  it('adds the document to knowledge retrieval only on an explicit click', async () => {
    await renderDraft()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'kb:import-text')).toHaveLength(0)

    const knowledgeButton = buttonWithLabel('加入知识检索')
    expect(knowledgeButton).not.toBeNull()
    await act(async () => {
      knowledgeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const importCalls = invoke.mock.calls.filter(([channel]) => channel === 'kb:import-text')
    expect(importCalls).toHaveLength(1)
    expect(importCalls[0][1]).toBe(DRAFT)
    // 索引名称是受控目录内的文档路径，因此不同目录下的同名文档互不覆盖。
    expect(importCalls[0][2]).toBe(DOCUMENT_PATH)
    expect(importCalls[0][3]).toBe(PROJECT_PATH)
  })

  it('reports an unclosed code fence without breaking the editor', async () => {
    await act(async () => {
      root.render(
        <ProjectDocumentEditor
          tabId={TAB_ID}
          documentPath={DOCUMENT_PATH}
          projectKey={PROJECT_PATH}
          content={'# 标题\n\n```\n未闭合\n'}
          savedContent={'# 标题\n\n```\n未闭合\n'}
        />,
      )
    })
    await waitForReady()

    expect(container.textContent).toContain('未闭合')
    expect(container.querySelector('[data-vditor-prose-editor="true"]')).not.toBeNull()
  })
})
