import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../../shared/ipc-channels'
import type { ProjectDocumentEntry } from '../../../../shared/project-documents'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useEditorStore } from '../../../../stores/editor-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectDocumentsStore } from '../../../../stores/project-documents-store'
import { useProjectStore } from '../../../../stores/project-store'
import ProjectDocumentsView from '../ProjectDocumentsView'

const PROJECT_PATH = 'C:\\novels\\boundaries'
const PROJECT_SESSION = {
  projectId: 'boundaries',
  leaseId: 'boundaries-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Boundaries',
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

function documentEntry(documentPath: string): ProjectDocumentEntry {
  const fileName = documentPath.split('/').pop() ?? documentPath
  return {
    relativePath: `.vela/documents/${documentPath}`,
    documentPath,
    fileName,
    title: fileName.replace(/\.md$/, ''),
    size: 10,
    modifiedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** 两份同名文档，位于不同子目录。 */
const FIRST = documentEntry('卷一/设定.md')
const SECOND = documentEntry('卷二/设定.md')

const originalDocumentsState = useProjectDocumentsStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>
/** 模拟知识库自身状态：docId → 索引名称。 */
let knowledgeDocs: Array<{ id: string; fileName: string }>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createInvokeHandler(options: {
  documents?: ProjectDocumentEntry[]
  renameFails?: { error: string; createdDocumentPath?: string }
} = {}) {
  return async (channel: string, ...args: unknown[]) => {
    if (channel === 'docs:list') {
      return { success: true, documents: options.documents ?? [FIRST, SECOND] }
    }
    if (channel === 'docs:read') {
      const documentPath = String(args[0])
      return { success: true, content: `内容 of ${documentPath}` }
    }
    if (channel === 'docs:rename') {
      return options.renameFails
        ? { success: false, ...options.renameFails }
        : { success: true, documentPath: '新标题.md' }
    }
    if (channel === 'kb:list-documents') {
      return knowledgeDocs.map(document => ({
        id: document.id,
        fileName: document.fileName,
        importedAt: '2026-01-01T00:00:00.000Z',
        chunkCount: 1,
        filePath: '',
      }))
    }
    if (channel === 'kb:stats') return { documentCount: knowledgeDocs.length, totalChunks: 1, vectorDimension: 0 }
    if (channel === 'kb:import-text') {
      const fileName = String(args[1])
      knowledgeDocs = knowledgeDocs.filter(document => document.fileName !== fileName)
      knowledgeDocs.push({ id: `doc-${fileName}`, fileName })
      return { success: true, docId: `doc-${fileName}`, chunkCount: 1 }
    }
    if (channel === 'kb:remove-document') {
      knowledgeDocs = knowledgeDocs.filter(document => document.id !== String(args[0]))
      return { success: true }
    }
    return { success: false, error: `unexpected channel ${channel}` }
  }
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1 })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useProjectDocumentsStore.setState({
    documents: [],
    dataProjectKey: null,
    loading: false,
    loadingProjectKey: null,
    lastError: null,
    knowledgeIndex: {},
    knowledgeLoading: false,
    knowledgeBusyDocumentPath: null,
    knowledgeError: null,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  knowledgeDocs = []

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
  useProjectDocumentsStore.setState(originalDocumentsState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  vi.restoreAllMocks()
})

/** 文档行带有稳定的 documentPath 标记，因此同名文档也能精确定位。 */
function rowFor(documentPath: string): HTMLElement | undefined {
  return container.querySelector<HTMLElement>(`[data-project-document-row="${documentPath}"]`) ?? undefined
}

async function renderView(): Promise<void> {
  await act(async () => root.render(<ProjectDocumentsView />))
  await act(async () => {
    await vi.waitFor(() => expect(rowFor(FIRST.documentPath)).toBeDefined())
  })
}

/** 指定文档行内的知识检索按钮。 */
function knowledgeButtonFor(documentPath: string): HTMLElement | undefined {
  return rowFor(documentPath)
    ?.querySelector<HTMLElement>('[aria-label="加入知识检索"], [aria-label="取消知识检索索引"]') ?? undefined
}

async function click(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('project documents same-name knowledge indexing', () => {
  it('indexes 卷一/设定.md and 卷二/设定.md independently', async () => {
    await renderView()

    await click(knowledgeButtonFor(FIRST.documentPath))
    await act(async () => {
      await vi.waitFor(() => expect(
        invoke.mock.calls.filter(([channel]) => channel === 'kb:import-text'),
      ).toHaveLength(1))
    })

    await click(knowledgeButtonFor(SECOND.documentPath))
    await act(async () => {
      await vi.waitFor(() => expect(
        invoke.mock.calls.filter(([channel]) => channel === 'kb:import-text'),
      ).toHaveLength(2))
    })

    const importNames = invoke.mock.calls
      .filter(([channel]) => channel === 'kb:import-text')
      .map(call => call[2])
    expect(importNames).toEqual([FIRST.documentPath, SECOND.documentPath])
    expect(new Set(importNames).size).toBe(2)

    // 两份都进入索引状态，互不覆盖。
    await act(async () => {
      await vi.waitFor(() => expect(knowledgeDocs).toHaveLength(2))
    })
    expect(knowledgeDocs.map(document => document.fileName).sort())
      .toEqual(['卷一/设定.md', '卷二/设定.md'])
    expect(useProjectDocumentsStore.getState().knowledgeIndex[FIRST.documentPath]?.docId)
      .toBe('doc-卷一/设定.md')
    expect(useProjectDocumentsStore.getState().knowledgeIndex[SECOND.documentPath]?.docId)
      .toBe('doc-卷二/设定.md')
  })

  it('keeps the other same-name document indexed after one is removed', async () => {
    await renderView()

    await click(knowledgeButtonFor(FIRST.documentPath))
    await click(knowledgeButtonFor(SECOND.documentPath))
    await act(async () => {
      await vi.waitFor(() => expect(knowledgeDocs).toHaveLength(2))
    })
    await act(async () => {
      await vi.waitFor(() => expect(
        container.querySelector('[aria-label="取消知识检索索引"]'),
      ).not.toBeNull())
    })

    // 取消卷一那份。
    await click(knowledgeButtonFor(FIRST.documentPath))
    await act(async () => {
      await vi.waitFor(() => expect(knowledgeDocs).toHaveLength(1))
    })

    const removeCalls = invoke.mock.calls.filter(([channel]) => channel === 'kb:remove-document')
    expect(removeCalls).toHaveLength(1)
    expect(removeCalls[0][1]).toBe('doc-卷一/设定.md')

    // 卷二那份仍然保持索引状态。
    expect(knowledgeDocs.map(document => document.fileName)).toEqual(['卷二/设定.md'])
    const index = useProjectDocumentsStore.getState().knowledgeIndex
    expect(index[FIRST.documentPath]).toBeUndefined()
    expect(index[SECOND.documentPath]?.docId).toBe('doc-卷二/设定.md')
    expect(container.textContent).toContain('已加入知识检索')
  })

  it('restores both index states from the knowledge base after a reload', async () => {
    knowledgeDocs = [
      { id: 'doc-卷一/设定.md', fileName: '卷一/设定.md' },
      { id: 'doc-卷二/设定.md', fileName: '卷二/设定.md' },
    ]
    await renderView()

    await act(async () => {
      await vi.waitFor(() => {
        const index = useProjectDocumentsStore.getState().knowledgeIndex
        expect(Object.keys(index).sort()).toEqual([FIRST.documentPath, SECOND.documentPath])
      })
    })
    // 两份文档都显示为已索引。
    expect(container.querySelectorAll('[aria-label="取消知识检索索引"]')).toHaveLength(2)
  })
})

describe('project documents rename boundary in the UI', () => {
  async function startRename(documentPath: string, nextTitle: string): Promise<void> {
    const renameButton = rowFor(documentPath)?.querySelector<HTMLElement>('[aria-label="重命名"]') ?? undefined
    expect(renameButton).toBeDefined()
    await click(renameButton)

    const input = container.querySelector<HTMLInputElement>('input[aria-label="文档名称"]')
    expect(input).not.toBeNull()
    await act(async () => {
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(input, nextTitle)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }

  it('keeps the unfinished state and tells the author when the project session changed', async () => {
    invoke = vi.fn(createInvokeHandler({
      renameFails: {
        error: '项目会话或租约已失效，重命名未完成。原文件保持不变；新名称副本已写入受控目录，请刷新文档列表后自行处理。',
        createdDocumentPath: '卷一/新标题.md',
      },
    }))
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
    })

    // 该文档已经作为标签页打开且处于未保存状态。
    useEditorStore.setState({
      tabs: [{
        id: 'project-document-open',
        name: '设定.md',
        type: 'project-document',
        filePath: FIRST.documentPath,
        content: '草稿内容',
        savedContent: '已保存内容',
        dirty: true,
        projectKey: PROJECT_PATH,
      }],
      activeTabId: 'project-document-open',
      draftLedgers: {},
    })

    await renderView()
    await startRename(FIRST.documentPath, '新标题')

    // 1) 明确提示未完成，并说明新副本已经存在。
    const alert = container.querySelector('[data-project-document-rename-issue]')
    await act(async () => {
      await vi.waitFor(() => expect(alert).not.toBeNull())
    })
    expect(container.textContent).toContain('重命名未完成')
    expect(container.textContent).toContain('卷一/新标题.md')
    expect(container.textContent).toContain('原文件仍保留')

    // 2) 未完成状态被保留：标签页仍指向旧路径，且仍是未保存状态。
    const tabs = useEditorStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].filePath).toBe(FIRST.documentPath)
    expect(tabs[0].dirty).toBe(true)

    // 3) 列表按真实情况刷新：旧文档仍然存在，不会假装已经改名。
    expect(rowFor(FIRST.documentPath)).toBeDefined()
    expect(useProjectDocumentsStore.getState().documents.map(entry => entry.documentPath))
      .toEqual([FIRST.documentPath, SECOND.documentPath])
  })

  it('closes and retargets the open tab only on a successful rename', async () => {
    await renderView()
    useEditorStore.setState({
      tabs: [{
        id: 'project-document-open',
        name: '设定.md',
        type: 'project-document',
        filePath: FIRST.documentPath,
        content: '内容',
        savedContent: '内容',
        dirty: false,
        projectKey: PROJECT_PATH,
      }],
      activeTabId: 'project-document-open',
      draftLedgers: {},
    })

    await startRename(FIRST.documentPath, '新标题')
    await act(async () => {
      await vi.waitFor(() => expect(
        invoke.mock.calls.filter(([channel]) => channel === 'docs:rename'),
      ).toHaveLength(1))
    })
    expect(container.querySelector('[data-project-document-rename-issue]')).toBeNull()
    // 成功路径重建标签页：旧的已关闭，新路径被重新打开。
    expect(useEditorStore.getState().tabs.map(tab => tab.filePath)).toEqual(['新标题.md'])
    expect(invoke.mock.calls
      .filter(([channel]) => channel === 'docs:read')
      .map(call => call[1])).toContain('新标题.md')
  })
})
