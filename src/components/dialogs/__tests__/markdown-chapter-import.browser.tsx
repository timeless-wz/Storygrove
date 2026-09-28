import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import ImportChapterDraftDialog from '../ImportChapterDraftDialog'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionA = { projectId: 'isolated-import-A', leaseId: 'lease-A', projectPath: 'C:\\temporary\\isolated-A' }
const sessionB = { projectId: 'isolated-import-B', leaseId: 'lease-B', projectPath: 'C:\\temporary\\isolated-B' }
const projectA = {
  id: sessionA.projectId, sessionLease: sessionA.leaseId, path: sessionA.projectPath, name: '隔离导入项目A',
  novelConfig: {},
}
const importedBody = '章节正文 Body'

let root: Root | undefined
let container: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn>

async function mount() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<ImportChapterDraftDialog open onClose={() => {}} />))
}

function setProject(project: typeof projectA, session: typeof sessionA) {
  useProjectStore.setState({ currentProject: project as never })
  setActiveProjectSessionContext(session)
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN' })
  setProject(projectA, sessionA)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'dialog:select-chapter-markdown-files') return {
      inspectionId: 'isolated-markdown-inspection',
      sourceNames: ['第7章-回声.md'],
      totalBytes: 50,
      chapters: [{ number: 7, title: '回声', wordCount: importedBody.length, contentLength: importedBody.length }],
    }
    if (channel === 'db:draft-list-all') return [{
      id: 70, chapterNumber: 7, version: 1, status: 'finalized', chapterTitle: '旧正文', contentId: 700,
      wordCount: 4, source: 'write', sourceDependencies: [], dependenciesStale: false, createdAt: '', updatedAt: '',
    }]
    if (channel === 'db:draft-import-markdown') return { success: true, created: [{ id: 72, chapterNumber: 7, version: 2 }] }
    if (channel === 'db:draft-get-full') return {
      id: 72, chapterNumber: 7, version: 2, status: 'draft', chapterTitle: '回声', contentId: 702,
      wordCount: importedBody.length, source: 'write', sourceDependencies: [], dependenciesStale: false,
      createdAt: '', updatedAt: '', content: importedBody,
    }
    return { success: true }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn(),
      setZoomLevel: vi.fn(), setZoomFactor: vi.fn(), getZoomLevel: vi.fn(() => 0),
    },
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useProjectStore.setState({ currentProject: null })
  setActiveProjectSessionContext(null)
})

describe('Markdown chapter draft import browser flow', () => {
  it('previews target conflicts, appends a new draft, then reads the created body back', async () => {
    await mount()
    await act(async () => page.getByRole('button', { name: '选择 .md / .markdown 文件' }).click())
    await expect.element(page.getByText('第 7 章')).toBeVisible()
    await expect.element(page.getByText('已有 1 个版本；将新增 v2')).toBeVisible()
    await expect.element(page.getByText('旧正文')).toBeVisible()

    await act(async () => page.getByRole('button', { name: '确认新增草稿版本' }).click())
    await expect.element(page.getByText(/已创建 1 个新草稿版本/u)).toBeVisible()
    expect(invoke).toHaveBeenCalledWith('db:draft-import-markdown', 'isolated-markdown-inspection', sessionA, sessionA.projectPath, sessionA)
    expect(invoke).toHaveBeenCalledWith('db:draft-get-full', 72, sessionA.projectPath, sessionA)
  })

  it('does not submit when the author cancels the confirmation preview', async () => {
    await mount()
    await act(async () => page.getByRole('button', { name: '选择 .md / .markdown 文件' }).click())
    await act(async () => page.getByRole('button', { name: '取消' }).click())
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('db:draft-import-markdown')
  })

  it('invalidates an open preview when the active project session changes', async () => {
    await mount()
    await act(async () => page.getByRole('button', { name: '选择 .md / .markdown 文件' }).click())
    await act(async () => setProject({ ...projectA, id: sessionB.projectId, path: sessionB.projectPath, sessionLease: sessionB.leaseId }, sessionB))
    await expect.element(page.getByRole('alert')).toHaveTextContent('项目会话已切换')
    expect(document.body.textContent).not.toContain('确认新增草稿版本')
    expect(invoke.mock.calls.map(([channel]) => channel)).not.toContain('db:draft-import-markdown')
  })
})
