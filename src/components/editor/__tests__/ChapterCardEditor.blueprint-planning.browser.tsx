import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import type { BlueprintPlanningCandidateRecord, BlueprintPlanningCheckRecord } from '../../../shared/blueprint-planning'
import type { ChapterBlueprint } from '../../../services/workflows/directory-workflow'
import { buildBlueprintV2MigrationContent } from '../../../shared/blueprint-v2'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import '../../../index.css'
import '../../../styles/literary-themes.css'
import ChapterCardEditor from '../ChapterCardEditor'

const PROJECT_PATH = 'C:\\novels\\blueprint-planning-ui'
const PROJECT_ID = 'blueprint-planning-ui'
const originalProject = useProjectStore.getState()
const originalEditor = useEditorStore.getState()
const originalLayout = useLayoutStore.getState()
const originalDrafts = useDraftStore.getState()
const originalLocale = useLocaleStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

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

function makeProject(): ProjectData {
  return {
    id: PROJECT_ID,
    sessionLease: 'blueprint-planning-ui-lease',
    path: PROJECT_PATH,
    name: '三级规划 UI 验收项目',
    novelConfig: {
      genre: '悬疑', subGenre: '都市', targetAudience: '通用', totalChapters: 90,
      wordsPerChapter: 3000, plotStructure: 'three_act', narrativePOV: 'third_limited',
      coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
    },
    characterStates: '', createdAt: '', updatedAt: '',
  }
}

function blueprint(chapterNumber: number, title: string, purpose: string, keyEvents: string): ChapterBlueprint {
  return {
    chapterNumber, volumeId: 'volume-1', title, role: '推进', purpose, keyEvents,
    characters: ['林澈'], suspenseHook: '门外响起第二次敲门声。',
    userGuidance: '对话克制，线索可回溯。', notes: '', notesUpdatedAt: '',
  }
}

const chapters = [
  blueprint(7, '凌晨档案', '取回被改写的值班记录。', '档案编号与监控时间相差十七分钟。'),
  blueprint(8, '空白证词', '查明证词缺失的原因。', '证人认出自己的签名，却不记得落笔。'),
]
const volumeMarkdown = [
  '# 第一卷：失名档案',
  '',
  '## 本卷定位与承担的全书任务',
  '揭开城市档案被替换的原因，让主角发现自己的身份也进入了缺失名单。',
  '',
  '## 预计篇幅、章节安排与作者指导',
  '预计章节数：18 章。',
].join('\n')
const volumeOutline = {
  volumeId: 'volume-1', schemaVersion: 1, markdown: volumeMarkdown, revision: 2,
  contentHash: 'a'.repeat(64), origin: 'ai' as const, sourceSnapshotId: 'volume-source-snapshot',
  createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
}

function volumeCandidate(): BlueprintPlanningCandidateRecord {
  return {
    operationId: 'volume-outline-candidate', kind: 'volume-outline',
    scope: { kind: 'volume', volumeId: 'volume-1' }, state: 'candidate', schemaVersion: 1,
    payloadHash: 'b'.repeat(64),
    candidate: {
      volumeId: 'volume-1', expectedRevision: 2,
      markdown: `${volumeMarkdown}\n\n## 卷末状态与下一卷衔接\n林澈确认档案系统提前写入了自己的失踪日期。`,
    },
    sourceSnapshot: {
      snapshotId: 'volume-candidate-snapshot', targetKind: 'volume', targetId: 'volume-1',
      targetRevision: 2, targetHash: volumeOutline.contentHash,
      sources: [
        { kind: 'synopsis', targetId: 'main', contentHash: 'c'.repeat(64), label: '全书总纲' },
        { kind: 'volume-outline', targetId: 'volume-1', volumeId: 'volume-1', revision: 2, contentHash: volumeOutline.contentHash },
      ],
    },
    createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
    committedAt: null, commitReceipt: null,
  }
}

function volumeCheck(): BlueprintPlanningCheckRecord {
  return {
    checkId: 'volume-chapter-check', kind: 'volume-chapters', targetKind: 'volume', targetId: 'volume-1',
    targetRevision: 2, targetHash: volumeOutline.contentHash,
    sourceSnapshot: {
      snapshotId: 'volume-check-snapshot', targetKind: 'volume', targetId: 'volume-1',
      targetRevision: 2, targetHash: volumeOutline.contentHash,
      sources: [{ kind: 'synopsis', targetId: 'main', contentHash: 'c'.repeat(64), label: '全书总纲' }],
    },
    deterministic: [{ code: 'SOURCE_CHANGED', severity: 'warning', message: '全书总纲版本已变化，建议重新检查。', volumeId: 'volume-1', citation: '总纲 hash 前缀 8c2d…' }],
    aiSuggestions: [{ code: 'ENDING_HANDOFF', severity: 'suggestion', message: '让卷末发现直接触发下一卷的调查目标。', volumeId: 'volume-1', citation: '卷纲：卷末状态与下一卷衔接' }],
    createdAt: '2026-10-03T00:00:00.000Z', currentState: 'stale',
  }
}

function detailFor(chapter: ChapterBlueprint) {
  return {
    ...buildBlueprintV2MigrationContent(chapter),
    planning: {
      volumeTask: '揭示档案篡改的执行者，同时保留主角身份疑点。',
      handoff: '承接上一章的时间戳矛盾；将线索交给证词核验。',
      expectedEndChange: '主角获得一份带有未来日期的失踪记录。',
    },
    revision: 3,
    contentHash: 'd'.repeat(64),
    rawMarkdown: '# 第7章｜凌晨档案\n\n## 分镜\n\n### 档案室\n原始场景正文。',
  }
}

function installIpc() {
  const candidate = volumeCandidate()
  const report = volumeCheck()
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    switch (channel) {
      case 'db:blueprint-get-all': return chapters
      case 'db:blueprint-volume-list': return [
        { id: 'volume-1', name: '第一卷：失名档案', sortOrder: 1 },
        { id: 'volume-2', name: '第二卷：回声证词', sortOrder: 2 },
      ]
      case 'db:blueprint-v2-get': return Number(args[0]) === 7 ? detailFor(chapters[0]) : null
      case 'db:draft-list': return []
      case 'db:draft-authority-sequence': return {
        status: 'continuous', lastChapterNumber: 6, nextChapterNumber: 7,
        duplicateChapterNumbers: [], authorityFingerprint: 'e'.repeat(64),
      }
      case 'db:project-core-get': return { synopsis: '林澈受命核查失名档案，逐渐发现档案系统把未来事件写入过去。' }
      case 'db:blueprint-volume-outline-list-summaries': return [{
        volumeId: 'volume-1', revision: 2, contentHash: volumeOutline.contentHash, origin: 'ai',
        updatedAt: volumeOutline.updatedAt, summary: volumeMarkdown.slice(0, 240),
      }]
      case 'db:blueprint-volume-outline-get': return args[0] === 'volume-1' ? volumeOutline : null
      case 'db:blueprint-volume-outline-save': return {
        success: false, code: 'REVISION_CONFLICT',
        error: '卷纲版本已被其他窗口修改；本地编辑仍保留。', current: volumeOutline,
      }
      case 'db:blueprint-planning-candidate-list': {
        const scope = args[0] as { selection?: { kind?: string; volumeId?: string } }
        return scope.selection?.kind === 'volume' && scope.selection.volumeId === 'volume-1' ? [candidate] : []
      }
      case 'db:blueprint-planning-check-list': {
        const scope = args[0] as { selection?: { kind?: string; volumeId?: string } }
        return scope.selection?.kind === 'volume' && scope.selection.volumeId === 'volume-1' ? [report] : []
      }
      case 'db:blueprint-planning-source-status':
        return (args[0] as string[]).map(snapshotId => ({ snapshotId, state: 'stale' }))
      case 'db:blueprint-planning-target-source-status':
        return (args[0] as Array<{ targetKind: string; targetId: string }>).map(target => ({
          ...target, snapshotId: 'chapter-source-snapshot', operationId: 'chapter-plan-operation',
          state: target.targetId === '7' ? 'stale' : 'unlinked',
        }))
      case 'db:blueprint-list-summary': return chapters.map(item => ({
        chapterNumber: item.chapterNumber, volumeId: item.volumeId, title: item.title,
        purpose: item.purpose, keyEvents: item.keyEvents,
      }))
      case 'db:draft-get-finalized': return null
      case 'db:blueprint-v2-summary-list': return []
      case 'fs:list-dir': return []
      default: throw new Error(`unexpected IPC ${channel}`)
    }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn(),
      setZoomLevel: vi.fn(), setZoomFactor: vi.fn(), getZoomLevel: vi.fn(() => 0),
    },
  })
  return invoke
}

async function renderWorkspace() {
  await act(async () => {
    root?.render(<ChapterCardEditor
      projectKey={PROJECT_PATH}
      initialPlanningSelection={{ kind: 'volume', volumeId: 'volume-1' }}
    />)
  })
}

beforeEach(() => {
  document.body.style.margin = '0'
  localStorage.removeItem(`blueprint-planning-selection:${PROJECT_ID}`)
  useProjectStore.setState({ currentProject: makeProject(), fileTree: [], loading: false })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useLayoutStore.setState({ chapterCreationOpen: false, chapterCreationPrefill: null })
  useDraftStore.setState({ draftsByChapter: {} })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  container.style.minHeight = '100vh'
  document.body.append(container)
  root = createRoot(container)
  installIpc()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  Reflect.deleteProperty(window, 'velaAPI')
  useProjectStore.setState(originalProject)
  useEditorStore.setState(originalEditor)
  useLayoutStore.setState(originalLayout)
  useDraftStore.setState(originalDrafts)
  useLocaleStore.setState(originalLocale)
  localStorage.removeItem(`blueprint-planning-selection:${PROJECT_ID}`)
})

describe('ChapterCardEditor three-level planning workspace', () => {
  it('shows a volume candidate preview, source warning, actual/planned counts, then the chapter planning fields', async () => {
    await page.viewport(1440, 1000)
    await renderWorkspace()

    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-volume-outline-editor"]')).toBeTruthy())
    expect(container?.textContent).toContain('实际章节')
    expect(container?.textContent).toContain('预计章节')
    expect(container?.textContent).toContain('18')
    expect(container?.textContent).toContain('上层已变化，建议检查')

    const showCandidates = Array.from(container!.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('候选（1）'))
    await act(async () => showCandidates?.click())
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-planning-outline-comparison"]')).toBeTruthy())
    expect(container?.querySelector('[data-testid="blueprint-planning-current-outline"]')?.textContent)
      .toContain('第一卷：失名档案')
    expect(container?.querySelector('[data-testid="blueprint-planning-candidate-outline"]')?.textContent)
      .toContain('自己的失踪日期')
    const comparison = container?.querySelector<HTMLElement>('[data-testid="blueprint-planning-outline-comparison"]')
    comparison?.scrollIntoView({ block: 'center' })
    await page.screenshot({ path: '../../../../screenshots/blueprint-planning-volume-candidate.png' })

    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-volume-outline-markdown"] [data-vditor-prose-editor="true"][data-vditor-ready="true"]')).toBeTruthy())
    expect(container?.querySelector('[data-testid="blueprint-volume-outline-markdown"] [data-document-layout="long-document"][data-heading-toc="enabled"]')).toBeTruthy()
    await typeAtEndOfMarkdown('[data-testid="blueprint-volume-outline-markdown"]', ' 本地并发编辑保留。')
    await typeAtEndOfMarkdown('[data-testid="blueprint-volume-outline-markdown"]', '\n\n## 当前未保存的卷纲标题')
    expect(container?.querySelector('[data-testid="blueprint-volume-outline-markdown"] .vditor-ir pre.vditor-reset')?.textContent)
      .toContain('本地并发编辑保留')
    expect(Array.from(container?.querySelectorAll('[data-testid="blueprint-volume-outline-markdown"] .vditor-ir h2') ?? [])
      .some(heading => heading.textContent?.includes('当前未保存的卷纲标题'))).toBe(true)
    expect(container?.querySelector('[data-testid="blueprint-volume-outline-markdown"] [data-heading-toc="enabled"]')).not.toBeNull()
    await act(async () => {
      await vi.waitFor(() => expect(
        (container?.querySelector('[data-testid="blueprint-volume-outline-save"]') as HTMLButtonElement | null)?.disabled,
      ).toBe(false), { timeout: 5_000 })
    })
    await act(async () => page.getByTestId('blueprint-volume-outline-save').click())
    await vi.waitFor(() => expect(container?.querySelector('[role="alert"]')?.textContent)
      .toContain('本地编辑仍保留'))
    expect(container?.querySelector('[data-testid="blueprint-volume-outline-markdown"] .vditor-ir pre.vditor-reset')?.textContent)
      .toContain('本地并发编辑保留')
    container?.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView({ block: 'center' })
    await page.screenshot({ path: '../../../../screenshots/blueprint-planning-volume-conflict.png' })
    await act(async () => page.getByRole('button', { name: '放弃修改' }).click())

    const chapterButton = container?.querySelector<HTMLButtonElement>('[data-testid="blueprint-planning-select-chapter-7"]')
    await act(async () => chapterButton?.click())
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-v2-view"]')).toBeTruthy())
    expect(container?.querySelector('[data-testid="blueprint-v2-planning"]')?.textContent)
      .toContain('揭示档案篡改的执行者')
    expect(container?.querySelector('[aria-label="规划过期"]')).toBeTruthy()
    container?.querySelector<HTMLElement>('[data-testid="blueprint-v2-planning"]')?.scrollIntoView({ block: 'center' })
    await page.screenshot({ path: '../../../../screenshots/blueprint-planning-chapter-fields-stale.png' })

    const bookButton = container?.querySelector<HTMLButtonElement>('[data-testid="blueprint-planning-select-book"]')
    await act(async () => bookButton?.click())
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-book-outline-editor"]')).toBeTruthy())
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-book-outline-markdown"] [data-vditor-prose-editor="true"][data-vditor-ready="true"]')).toBeTruthy())
    expect(container?.querySelector('[data-testid="blueprint-book-outline-markdown"] [data-document-layout="long-document"][data-heading-toc="enabled"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="blueprint-book-outline-markdown"] .vditor-ir pre.vditor-reset')?.textContent)
      .toContain('林澈受命核查失名档案')
    await typeAtEndOfMarkdown('[data-testid="blueprint-book-outline-markdown"]', '\n\n## 当前未保存的全书总纲标题\n\n总纲新增目录标题。')
    expect(Array.from(container?.querySelectorAll('[data-testid="blueprint-book-outline-markdown"] .vditor-ir h2') ?? [])
      .some(heading => heading.textContent?.includes('当前未保存的全书总纲标题'))).toBe(true)
    await vi.waitFor(() => expect(
      Array.from(container?.querySelectorAll('[data-testid="blueprint-book-outline-markdown"] .document-editing-surface__heading') ?? [])
        .some(heading => heading.textContent?.includes('当前未保存的全书总纲标题')),
    ).toBe(true), { timeout: 5_000 })
    container?.querySelector<HTMLElement>('[data-testid="blueprint-book-outline-editor"]')?.scrollIntoView({ block: 'start' })
    const dismissButton = document.querySelector<HTMLButtonElement>(
      '#vela-toast-root button[aria-label="关闭提示"], #vela-toast-root button[aria-label="Dismiss notification"], '
      + '#vela-action-toast-root button[aria-label="关闭提示"], #vela-action-toast-root button[aria-label="Dismiss notification"]',
    )
    if (dismissButton) await act(async () => dismissButton.click())
    await page.screenshot({ path: '../../../../screenshots/blueprint-planning-book-outline.png' })
  })
})
