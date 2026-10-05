import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useEditorStore } from '../../../../stores/editor-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectDocumentsStore } from '../../../../stores/project-documents-store'
import { useProjectStore } from '../../../../stores/project-store'
import ProjectDocumentsView from '../ProjectDocumentsView'

const PROJECT_A = 'C:\\novels\\document-a'
const PROJECT_B = 'C:\\novels\\document-b'

function project(name: string, path: string): ProjectData {
  return {
    id: name,
    sessionLease: `${name}-lease`,
    name,
    path,
    novelConfig: {
      genre: '', subGenre: '', targetAudience: '', totalChapters: 4, wordsPerChapter: 2500,
      plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '',
      worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
    },
    characterStates: '',
    createdAt: '',
    updatedAt: '',
  }
}

/** 会话身份必须与 ProjectData 的 id + sessionLease 完全一致。 */
function session(name: string, projectPath: string, leaseId: string) {
  return { projectId: name, leaseId, projectPath }
}

const originalEditorState = useEditorStore.getState()
const originalDocumentsState = useProjectDocumentsStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 每个项目返回各自的文档列表，让“切换项目后严格隔离”成为可观测行为。 */
function documentsFor(projectPath: string) {
  if (projectPath === PROJECT_A) {
    return [{
      relativePath: '.vela/documents/A-卷纲.md',
      documentPath: 'A-卷纲.md',
      fileName: 'A-卷纲.md',
      title: 'A-卷纲',
      size: 10,
      modifiedAt: '2026-01-01T00:00:00.000Z',
    }]
  }
  return [{
    relativePath: '.vela/documents/B-灵感.md',
    documentPath: 'B-灵感.md',
    fileName: 'B-灵感.md',
    title: 'B-灵感',
    size: 10,
    modifiedAt: '2026-01-01T00:00:00.000Z',
  }]
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project('A', PROJECT_A), projectSessionEpoch: 1 })
  useEditorStore.setState({ tabs: [], activeTabId: null })
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
  setActiveProjectSessionContext(session('A', PROJECT_A, 'A-lease'))

  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'docs:list') {
      return { success: true, documents: documentsFor(String(args[0])) }
    }
    if (channel === 'docs:read') {
      return { success: true, content: `内容 for ${String(args[0])}` }
    }
    if (channel === 'kb:list-documents') return []
    if (channel === 'kb:stats') return { documentCount: 0, totalChunks: 0, vectorDimension: 0 }
    if (channel === 'kb:import-text') {
      return { success: true, docId: 'doc-1', chunkCount: 3 }
    }
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

function rowFor(title: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
    .find(element => (element.textContent ?? '').includes(title))
}

async function waitForDocument(title: string): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(rowFor(title)).toBeDefined())
  })
}

describe('ProjectDocumentsView', () => {
  it('lists only the documents of the current project', async () => {
    await act(async () => root.render(<ProjectDocumentsView />))
    await waitForDocument('A-卷纲')

    expect(container.textContent).toContain('A-卷纲')
    expect(container.textContent).not.toContain('B-灵感')
  })

  it('swaps the list when the project switches and never shows another project’s documents', async () => {
    await act(async () => root.render(<ProjectDocumentsView />))
    await waitForDocument('A-卷纲')

    await act(async () => {
      setActiveProjectSessionContext(session('B', PROJECT_B, 'B-lease'))
      useProjectStore.setState({
        currentProject: project('B', PROJECT_B),
        projectSessionEpoch: 2,
      })
    })
    await waitForDocument('B-灵感')

    expect(container.textContent).toContain('B-灵感')
    expect(container.textContent).not.toContain('A-卷纲')

    const listCalls = invoke.mock.calls.filter(([channel]) => channel === 'docs:list')
    expect(listCalls.map(call => call[1])).toEqual([PROJECT_A, PROJECT_B])
  })

  it('adds a document to knowledge retrieval only after an explicit author action', async () => {
    await act(async () => root.render(<ProjectDocumentsView />))
    await waitForDocument('A-卷纲')

    // 仅仅加载列表不会自动索引任何项目文档。
    expect(invoke.mock.calls.filter(([channel]) => channel === 'kb:import-text')).toHaveLength(0)

    const addButton = container.querySelector<HTMLElement>(
      '[aria-label="加入知识检索"]',
    )
    expect(addButton).not.toBeNull()
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const importCalls = invoke.mock.calls.filter(([channel]) => channel === 'kb:import-text')
    expect(importCalls).toHaveLength(1)
    expect(importCalls[0][1]).toBe('内容 for A-卷纲.md')
    expect(importCalls[0][2]).toBe('A-卷纲.md')
    expect(importCalls[0][3]).toBe(PROJECT_A)

    // 加入后状态可见，并且可以取消索引。
    expect(container.textContent).toContain('已加入知识检索')
    const removeButton = container.querySelector<HTMLElement>('[aria-label="取消知识检索索引"]')
    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'kb:remove-document')).toHaveLength(1)
  })

  it('opens a document from the whole row, not from a tiny button', async () => {
    await act(async () => root.render(<ProjectDocumentsView />))
    await waitForDocument('A-卷纲')

    await act(async () => {
      rowFor('A-卷纲')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(useEditorStore.getState().tabs).toHaveLength(1))
    })
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.type).toBe('project-document')
    expect(tab.filePath).toBe('A-卷纲.md')
    expect(tab.projectKey).toBe(PROJECT_A)
    expect(tab.content).toBe('内容 for A-卷纲.md')
  })

  it('offers new/import actions in the empty state', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'docs:list') return { success: true, documents: [] }
      if (channel === 'kb:list-documents') return []
      if (channel === 'kb:stats') return { documentCount: 0, totalChunks: 0, vectorDimension: 0 }
      return { success: false }
    })

    await act(async () => root.render(<ProjectDocumentsView />))
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('还没有项目文档'))
    })
    expect(container.textContent).toContain('新建文档')
    expect(container.textContent).toContain('导入为项目文档')
    expect(container.textContent).toContain('.vela/documents')
  })
})
