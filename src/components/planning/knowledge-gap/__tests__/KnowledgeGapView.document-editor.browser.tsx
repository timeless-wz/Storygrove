import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import type { ProjectData, ProjectSessionContext } from '../../../../shared/ipc-channels'
import type { InfoEntry, InfoEntrySaveInput } from '../../../../shared/knowledge-gap'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useCharacterStore } from '../../../../stores/character-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectStore } from '../../../../stores/project-store'
import { useWorkflowStore } from '../../../../stores/workflow-store'
import '../../../../index.css'
import '../../../../styles/literary-themes.css'
import KnowledgeGapView from '../KnowledgeGapView'

const PROJECT_PATH = 'C:\\fixtures\\document-editor-pages\\knowledge-gap'
const session: ProjectSessionContext = {
  projectId: 'knowledge-gap-document-editor-test',
  leaseId: 'knowledge-gap-document-editor-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: session.projectId,
  sessionLease: session.leaseId,
  path: PROJECT_PATH,
  name: 'Isolated knowledge gap browser fixture',
  novelConfig: {
    genre: '悬疑', subGenre: '', targetAudience: '成年读者', totalChapters: 12,
    wordsPerChapter: 2400, plotStructure: 'three_act', narrativePOV: 'third_limited',
    coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '', createdAt: '', updatedAt: '',
}

const originalProject = useProjectStore.getState()
const originalCharacter = useCharacterStore.getState()
const originalLocale = useLocaleStore.getState()
const originalWorkflow = useWorkflowStore.getState()
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
let entries: InfoEntry[]
let saveInputs: InfoEntrySaveInput[]
let rejectNextSave = false

async function typeAtEndOfMarkdown(scopeSelector: string, text: string): Promise<void> {
  const scope = container?.querySelector<HTMLElement>(scopeSelector)
  const prose = scope?.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')
  expect(scope).not.toBeNull()
  expect(prose).not.toBeNull()
  await act(async () => {
    prose!.focus()
    const range = document.createRange()
    range.selectNodeContents(prose!.lastElementChild ?? prose!)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    await userEvent.keyboard(text)
  })
}

function makeEntry(id: string, title: string, truth: string): InfoEntry {
  return {
    id,
    title,
    summary: '测试条目摘要',
    truth,
    truthStatus: 'confirmed',
    sourceRefs: [],
    relatedThreadPlanIds: [],
    revision: 1,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  }
}

function resetEntries(): void {
  entries = [
    makeEntry('info-alpha', '档案甲', '# 真相甲\n\n甲条目正文'),
    makeEntry('info-beta', '档案乙', '# 真相乙\n\n乙条目正文'),
  ]
  saveInputs = []
  rejectNextSave = false
}

function createInvokeMock() {
  return vi.fn(async (channel: string, ...args: unknown[]): Promise<unknown> => {
    switch (channel) {
      case 'db:info-entry-list':
        return entries
      case 'db:knowledge-check-report-list':
      case 'db:narrative-thread-list':
      case 'db:thread-marker-link-list':
      case 'db:knowledge-record-list':
      case 'db:info-entry-truth-history':
        return []
      case 'db:timeline-get-all':
        return null
      case 'db:info-entry-save': {
        const input = args[0] as InfoEntrySaveInput
        saveInputs.push(input)
        if (rejectNextSave) {
          rejectNextSave = false
          return { success: false, error: '模拟保存失败' }
        }
        const prior = input.id ? entries.find(entry => entry.id === input.id) : undefined
        const id = input.id ?? 'info-created'
        const saved: InfoEntry = {
          id,
          title: input.title,
          summary: input.summary,
          truth: input.truth,
          truthStatus: input.truthStatus,
          sourceRefs: input.sourceRefs,
          relatedThreadPlanIds: input.relatedThreadPlanIds,
          revision: (prior?.revision ?? 0) + 1,
          createdAt: prior?.createdAt ?? '2026-10-05T00:00:00.000Z',
          updatedAt: '2026-10-05T00:01:00.000Z',
        }
        entries = prior
          ? entries.map(entry => entry.id === id ? saved : entry)
          : [...entries, saved]
        return { success: true, id, revision: saved.revision, knowledgeRecordsAffected: 0 }
      }
      default:
        throw new Error('Unexpected mocked IPC channel: ' + channel)
    }
  })
}

async function renderPage(): Promise<void> {
  await act(async () => {
    root?.render(<KnowledgeGapView projectKey={PROJECT_PATH} />)
  })
  await act(async () => {
    await expect.element(page.getByRole('heading', { name: '信息与揭露', exact: true })).toBeVisible()
    await vi.waitFor(() => {
      expect(container?.querySelector(
        '[data-testid="info-entry-truth-view"] [data-vditor-prose-editor][data-vditor-ready="true"]',
      )).not.toBeNull()
    }, { timeout: 20_000 })
  })
}

beforeEach(async () => {
  await page.viewport(1280, 920)
  setActiveProjectSessionContext(session)
  resetEntries()
  useProjectStore.setState({
    ...originalProject,
    currentProject: project,
    fileTree: [],
    loading: false,
    projectSessionEpoch: 1,
  })
  useCharacterStore.setState({
    ...originalCharacter,
    characters: [],
    characterIdentities: {},
  })
  useLocaleStore.setState({ ...originalLocale, locale: 'zh-CN', initialized: true })

  const invoke = createInvokeMock()
  ;(window as unknown as { velaAPI: unknown }).velaAPI = {
    invoke,
    on: () => () => {},
    once: () => {},
    send: () => {},
    setZoomLevel: () => {},
    setZoomFactor: () => {},
    getZoomLevel: () => 0,
  }

  container = document.createElement('div')
  container.style.height = '900px'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  setActiveProjectSessionContext(null)
  useProjectStore.setState(originalProject)
  useCharacterStore.setState(originalCharacter)
  useLocaleStore.setState(originalLocale)
  useWorkflowStore.setState(originalWorkflow)
  Reflect.deleteProperty(window, 'velaAPI')
  document.getElementById('vditorIconScript')?.remove()
})

describe('KnowledgeGapView shared Markdown surface', () => {
  it('isolates truth documents by entry, keeps cancel local, and saves edits through the page IPC', async () => {
    await renderPage()

    const firstHost = container?.querySelector(
      '[data-testid="info-entry-truth-view"] [data-vditor-prose-editor]',
    )
    expect(firstHost).not.toBeNull()
    expect(container?.querySelector(
      '[data-testid="info-entry-truth-view"] [data-document-layout="long-document"][data-heading-toc="enabled"]',
    )).not.toBeNull()

    await page.getByTestId('info-entry-info-beta').click()
    await vi.waitFor(() => {
      expect(container?.querySelector('[data-testid="info-entry-truth-view"] .vditor-ir pre.vditor-reset')?.textContent)
        .toContain('真相乙')
    })
    const secondHost = container?.querySelector(
      '[data-testid="info-entry-truth-view"] [data-vditor-prose-editor]',
    )
    expect(secondHost).not.toBe(firstHost)

    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await vi.waitFor(() => {
      expect(container?.querySelector(
        '[data-testid="info-entry-truth-edit"] [data-vditor-prose-editor][data-vditor-ready="true"]',
      )).not.toBeNull()
    })
    expect(container?.querySelector(
      '[data-testid="info-entry-truth-edit"] [data-document-layout="long-document"][data-heading-toc="enabled"]',
    )).not.toBeNull()

    await typeAtEndOfMarkdown('[data-testid="info-entry-truth-edit"]', ' 临时真相，取消时丢弃')
    expect(container?.querySelector('[data-testid="info-entry-truth-edit"] .vditor-ir pre.vditor-reset')?.textContent)
      .toContain('取消时丢弃')

    await page.getByRole('button', { name: '取消', exact: true }).click()
    await vi.waitFor(() => {
      expect(container?.querySelector('[data-testid="info-entry-truth-view"] .vditor-ir pre.vditor-reset')?.textContent)
        .toContain('乙条目正文')
    })
    expect(saveInputs).toHaveLength(0)

    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await vi.waitFor(() => {
      expect(container?.querySelector(
        '[data-testid="info-entry-truth-edit"] [data-vditor-prose-editor][data-vditor-ready="true"]',
      )).not.toBeNull()
    })
    await typeAtEndOfMarkdown('[data-testid="info-entry-truth-edit"]', ' 保存失败后仍保留')
    rejectNextSave = true
    await page.getByTestId('info-entry-update-save').click()
    await vi.waitFor(() => {
      expect(saveInputs).toHaveLength(1)
      expect(container?.querySelector('[data-testid="info-entry-truth-edit"] .vditor-ir pre.vditor-reset')?.textContent)
        .toContain('保存失败后仍保留')
    })
    expect(entries.find(entry => entry.id === 'info-beta')?.truth).toBe('# 真相乙\n\n乙条目正文')
    expect(saveInputs[0]?.truth).toContain('保存失败后仍保留')

    await page.getByRole('button', { name: '取消', exact: true }).click()
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="info-entry-truth-view"] .vditor-ir pre.vditor-reset')?.textContent)
      .toContain('乙条目正文'))
    expect(entries.find(entry => entry.id === 'info-beta')?.truth).toBe('# 真相乙\n\n乙条目正文')

    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await vi.waitFor(() => {
      expect(container?.querySelector(
        '[data-testid="info-entry-truth-edit"] [data-vditor-prose-editor][data-vditor-ready="true"]',
      )).not.toBeNull()
    })
    await typeAtEndOfMarkdown('[data-testid="info-entry-truth-edit"]', ' 更新后的真相，新证据')
    expect(container?.querySelector('[data-testid="info-entry-truth-edit"] .vditor-ir pre.vditor-reset')?.textContent)
      .toContain('更新后的真相')

    await page.getByTestId('info-entry-update-save').click()
    await vi.waitFor(() => expect(saveInputs).toHaveLength(2))
    expect(saveInputs[1]?.truth).toContain('更新后的真相')
    await vi.waitFor(() => {
      expect(container?.querySelector('[data-testid="info-entry-truth-view"] .vditor-ir pre.vditor-reset')?.textContent)
        .toContain('更新后的真相')
    })
    expect(saveInputs).toHaveLength(2)
    expect(saveInputs[1]).toMatchObject({
      id: 'info-beta',
      baseRevision: 1,
    })
    expect(saveInputs[1].truth).toContain('更新后的真相')
  })
})
