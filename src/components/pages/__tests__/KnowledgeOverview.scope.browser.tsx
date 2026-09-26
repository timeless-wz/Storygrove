import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeOverview from '../KnowledgeOverview'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useProjectDocumentsStore } from '../../../stores/project-documents-store'
import { useLayoutStore } from '../../../stores/layout-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const projectSession = {
  projectId: 'scope-project',
  leaseId: 'scope-lease',
  projectPath: 'C:/novels/scope-project',
}

const chapterDocument = {
  id: 'doc-chapter',
  fileName: '第12章 雾港.md',
  importedAt: '2026-02-01T00:00:00.000Z',
  chunkCount: 6,
  filePath: '',
  corpusKind: 'project-knowledge',
}
const projectDocumentIndex = {
  id: 'doc-project-document',
  fileName: '卷一/设定.md',
  importedAt: '2026-02-02T00:00:00.000Z',
  chunkCount: 3,
  filePath: '',
  corpusKind: 'project-knowledge',
}
const referenceDocument = {
  id: 'doc-reference',
  fileName: '素材/参考.md',
  importedAt: '2026-02-03T00:00:00.000Z',
  chunkCount: 1,
  filePath: '',
  corpusKind: 'reference',
}

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalDocumentsState = useProjectDocumentsStore.getState()
const originalVelaAPI = Object.getOwnPropertyDescriptor(window, 'velaAPI')

beforeEach(async () => {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'kb:list-documents') return [chapterDocument, projectDocumentIndex, referenceDocument]
    if (channel === 'kb:stats') return { documentCount: 3, totalChunks: 10, vectorDimension: 0 }
    if (channel === 'kb:get-vector-rebuild-status') {
      return { embeddingConfigured: false, canRebuild: false, totalChunks: 10, vectorlessCount: 0, activeVectorDimension: 0 }
    }
    if (channel === 'docs:list') {
      return {
        success: true,
        documents: [
          {
            relativePath: '.vela/documents/卷一/设定.md',
            documentPath: '卷一/设定.md',
            fileName: '设定.md',
            title: '设定',
            size: 12,
            modifiedAt: '2026-02-02T00:00:00.000Z',
          },
        ],
      }
    }
    throw new Error(`Unexpected IPC channel: ${channel}`)
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: () => () => {}, once: () => {}, send: () => {} },
  })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useLayoutStore.setState({ sidebarView: 'knowledge' })
  useProjectDocumentsStore.setState({ documents: [], dataProjectKey: null, knowledgeIndex: {} })
  useProjectStore.setState({
    currentProject: {
      id: projectSession.projectId,
      name: 'Scope project',
      path: projectSession.projectPath,
      sessionLease: projectSession.leaseId,
    } as never,
  })

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<KnowledgeOverview />))
  await vi.waitFor(() => expect(container.textContent).toContain('已收录语料'))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useProjectStore.setState(originalProjectState)
  useLocaleStore.setState(originalLocaleState)
  useProjectDocumentsStore.setState(originalDocumentsState)
  useLayoutStore.setState({ sidebarView: 'project' })
  if (originalVelaAPI) Object.defineProperty(window, 'velaAPI', originalVelaAPI)
  else Reflect.deleteProperty(window, 'velaAPI')
})

describe('KnowledgeOverview indexed scope and provenance', () => {
  it('states which corpora are indexed and which project surfaces are not searchable', () => {
    const text = container.textContent ?? ''
    expect(text).toContain('收录范围')
    expect(text).toContain('定稿章节正文')
    expect(text).toContain('作者导入的创作资料')
    expect(text).toContain('作者加入知识检索的项目文档')
    expect(text).toContain('蓝图、大纲、角色档案等数据库对象不会自动进入检索')
    expect(text).toContain('参考素材语料可以在此检索')
    // 分布来自文档真实携带的 corpusKind
    expect(text).toContain('项目语料 2')
    expect(text).toContain('参考素材 1')
  })

  it('lists the indexed corpora and offers a document jump only for a real project document', () => {
    expect(container.textContent).toContain('第12章 雾港.md')
    expect(container.textContent).toContain('卷一/设定.md')

    const openButtons = [...container.querySelectorAll('button')]
      .filter(button => button.textContent?.includes('打开文档'))
    // 只有与 docs:list 中真实存在的项目文档路径同名的语料才能打开
    expect(openButtons).toHaveLength(1)
    expect(container.textContent).toContain('无来源文件')
  })

  it('never renders search results before a search has been run', () => {
    expect(container.textContent).not.toContain('检索结果（')
    expect(container.querySelector('[data-testid="knowledge-search-no-hit"]')).toBeNull()
  })

  it('reports a miss as a miss after a real search instead of fabricating rows', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'kb:search') return []
      if (channel === 'kb:list-documents') return [chapterDocument, projectDocumentIndex, referenceDocument]
      if (channel === 'kb:stats') return { documentCount: 3, totalChunks: 10, vectorDimension: 0 }
      if (channel === 'kb:get-vector-rebuild-status') {
        return { embeddingConfigured: false, canRebuild: false, totalChunks: 10, vectorlessCount: 0, activeVectorDimension: 0 }
      }
      if (channel === 'docs:list') return { success: true, documents: [] }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    })

    const input = container.querySelector('input[aria-label="检索内容"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '不存在的词')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const searchButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === '检索')!
    await act(async () => searchButton.click())
    await vi.waitFor(() => expect(container.querySelector('[data-testid="knowledge-search-no-hit"]')).not.toBeNull())

    const noHit = container.querySelector('[data-testid="knowledge-search-no-hit"]')!
    expect(noHit.textContent).toContain('不存在的词')
    expect(noHit.textContent).toContain('没有命中任何已收录语料')
    expect(noHit.textContent).toContain('只有已入库的正文与资料参与检索')
    expect(noHit.textContent).toContain('未入库正文、蓝图与角色档案不会自动参与')
  })
})
