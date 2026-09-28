import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import ExportDialog from '../ExportDialog'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session = { projectId: 'isolated-volume-project', leaseId: 'lease-volume', projectPath: 'C:\\temporary\\isolated-volume' }
const project = {
  id: session.projectId, sessionLease: session.leaseId, path: session.projectPath, name: '隔离卷导出测试',
  novelConfig: { genre: '测试', targetAudience: '测试', writingLanguage: 'zh-CN' },
}
const selectedBodies = new Map<number, { chapterNumber: number; version: number; title: string; content: string; kind: 'draft' | 'finalized'; status: string; finalizationId: string | null; contentHash: string; titleHash: string }>([
  [102, { chapterNumber: 1, version: 2, title: '跨海', content: '草稿版本二\r\n第二行', kind: 'draft', status: 'reviewed', finalizationId: null, contentHash: 'a'.repeat(64), titleHash: 'b'.repeat(64) }],
  [203, { chapterNumber: 2, version: 1, title: '回声', content: '当前正文 v1', kind: 'finalized', status: 'finalized', finalizationId: 'final-203', contentHash: 'c'.repeat(64), titleHash: 'd'.repeat(64) }],
])

let root: Root | undefined
let container: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn>
let writes: Array<{ path: string; content: string }>
let includeUnassignedProse = false
let includeBlueprintWithoutVersion = false

function meta(id: number, chapterNumber: number, version: number, status: string, chapterTitle: string) {
  return { id, chapterNumber, version, status, chapterTitle, source: 'write', contentId: id, wordCount: 3, sourceDependencies: [], dependenciesStale: false, createdAt: '', updatedAt: '' }
}

function selectionSnapshot(selection: Array<{ draftId: number; kind: 'draft' | 'finalized' }>) {
  const chapters = selection.map(item => {
    const saved = selectedBodies.get(item.draftId)
    if (!saved) throw new Error(`Missing fixture ${item.draftId}`)
    return { draftId: item.draftId, ...saved }
  }).sort((left, right) => left.chapterNumber - right.chapterNumber)
  return {
    chapters,
    receipt: chapters.map(({ draftId, kind, chapterNumber, version, status, contentHash, titleHash, finalizationId }) => ({
      draftId, kind, chapterNumber, version, status, contentHash, titleHash, finalizationId,
    })),
  }
}

async function mount() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<ExportDialog isOpen onClose={() => {}} />))
}

async function chooseSelect(index: number, value: string) {
  const select = document.querySelectorAll('select').item(index)
  if (!(select instanceof HTMLSelectElement)) throw new Error(`Missing select ${index}`)
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  writes = []
  includeUnassignedProse = false
  includeBlueprintWithoutVersion = false
  useLocaleStore.setState({ locale: 'zh-CN' })
  useProjectStore.setState({ currentProject: project as never })
  setActiveProjectSessionContext(session)
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'dialog:select-export-directory') return { grantId: 'isolated-export-grant', displayName: '测试导出目录' }
    if (channel === 'fs:grant-mkdir') return { success: true }
    if (channel === 'fs:grant-write-file') {
      writes.push({ path: String(args[1]), content: String(args[2]) })
      return { success: true, commitState: 'committed' }
    }
    if (channel === 'db:draft-list-all') return [
      meta(101, 1, 1, 'draft', '跨海'), meta(102, 1, 2, 'reviewed', '跨海'),
      ...(includeUnassignedProse ? [meta(304, 3, 1, 'draft', '未归卷章节')] : []),
    ]
    if (channel === 'db:blueprint-get-all') return [
      { chapterNumber: 1, volumeId: 'volume-a', title: '跨海' },
      { chapterNumber: 2, volumeId: 'volume-a', title: '回声' },
      ...(includeBlueprintWithoutVersion ? [{ chapterNumber: 3, volumeId: 'volume-a', title: '尚无版本' }] : []),
    ]
    if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-a', name: '第一卷', sortOrder: 1 }]
    if (channel === 'db:draft-export-snapshot') return [{
      draftId: 203, chapterNumber: 2, version: 1, title: '回声', content: '当前正文 v1', finalizationId: 'final-203', contentHash: 'c'.repeat(64),
    }]
    if (channel === 'db:draft-export-selection') return selectionSnapshot(args[0] as Array<{ draftId: number; kind: 'draft' | 'finalized' }>)
    if (channel === 'db:draft-export-selection-current') return true
    throw new Error(`Unexpected IPC: ${channel}`)
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

describe('Markdown chapter and volume export browser flow', () => {
  it('selects one version per volume chapter, previews those exact bodies, then exports the merged Markdown', async () => {
    await mount()
    await act(async () => page.getByRole('button', { name: '单卷' }).click())
    await chooseSelect(0, 'volume-a')
    await chooseSelect(1, 'draft:102')
    await chooseSelect(2, 'finalized:203')
    await act(async () => page.getByRole('button', { name: '刷新实际导出预览' }).click())

    await expect.element(page.getByText('草稿版本二')).toBeVisible()
    await expect.element(page.getByText('第 2 章 · 正文 v1')).toBeVisible()
    await act(async () => page.getByRole('button', { name: '选择目录并导出' }).click())
    await expect.element(page.getByText(/已导出到/u)).toBeVisible()

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toMatch(/第一卷\.md$/u)
    expect(writes[0]?.content).toContain('草稿版本二\r\n第二行')
    expect(writes[0]?.content).toContain('当前正文 v1')
    expect(writes[0]?.content).toContain('# 第1章 跨海')
    expect(writes[0]?.content).toContain('# 第2章 回声')
  })

  it('reports prose without a blueprint or volume instead of silently adding it to a volume', async () => {
    includeUnassignedProse = true
    await mount()
    await act(async () => page.getByRole('button', { name: '单卷' }).click())
    await chooseSelect(0, 'volume-a')

    await expect.element(page.getByText(/正文章节未绑定蓝图／卷归属：第3章/u)).toBeVisible()
    await expect.element(page.getByText(/不会被自动塞入本卷/u)).toBeVisible()
    expect(writes).toHaveLength(0)
  })

  it('blocks volume export while a blueprint chapter has no selectable version', async () => {
    includeBlueprintWithoutVersion = true
    await mount()
    await act(async () => page.getByRole('button', { name: '单卷' }).click())
    await chooseSelect(0, 'volume-a')

    expect(document.body.textContent).toContain('缺少可导出版本')
    await expect.element(page.getByText('已明确选择 0/3 章；缺少 3 章。')).toBeVisible()
    await expect.element(page.getByRole('button', { name: '选择目录并导出' })).toBeDisabled()
    expect(writes).toHaveLength(0)
  })
})
