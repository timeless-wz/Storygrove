/**
 * project-overview-resume.browser.tsx — 「回到上次创作位置」真实路径验收。
 *
 * 覆盖：真实画布保存 → 退出视图 → 项目概览出现记录卡（类型/章节/时间）→
 * 点击直达章节场景画布；正文记录点击直达草稿编辑器 Tab；记录失效
 * （章节被删 / 草稿归档 / 跨项目 / 损坏）时不显示卡片，既有
 * 「继续写正文」入口保持不变。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { recordLastCreationLocation, readLastCreationLocation } from '../../../services/last-creation-location'
import { useCharacterStore } from '../../../stores/character-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import ChapterCanvasWorkbench from '../../canvas/ChapterCanvasWorkbench'
import ProjectOverviewPage from '../ProjectOverviewPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'D:/novels/resume-book'
const SESSION = { projectId: 'proj-resume', leaseId: 'lease-resume-1', projectPath: PROJECT_PATH }

let root: Root
let container: HTMLDivElement

const PROJECT: ProjectData = {
  id: SESSION.projectId,
  sessionLease: SESSION.leaseId,
  name: '回归之书',
  path: PROJECT_PATH,
  characterStates: '',
  createdAt: '2026-09-25T08:00:00Z',
  updatedAt: '2026-09-27T08:00:00Z',
  novelConfig: {
    genre: '东方玄幻', subGenre: '', targetAudience: '', totalChapters: 12, wordsPerChapter: 2000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '',
    goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
}

function seedOverviewStores() {
  useDraftStore.setState({
    dataProjectKey: PROJECT_PATH,
    draftsByChapter: {
      2: [{
        id: 7, chapterNumber: 2, version: 1, status: 'draft', source: 'write',
        wordCount: 900, createdAt: '2026-09-26T09:00:00Z', updatedAt: '2026-09-26T09:00:00Z',
        fileName: 'draft_v1.md', filePath: 'vela://draft/7',
      }],
    },
  })
  useWorldMapStore.setState({ maps: [], nodes: [], edges: [], loadAll: vi.fn(async () => {}) })
  useStoryTimelineStore.setState({ dataProjectKey: PROJECT_PATH, events: [] })
  useCharacterStore.setState({ characters: [], loadCharacters: vi.fn(async () => {}) })
}

beforeEach(() => {
  window.localStorage.clear()
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  document.documentElement.setAttribute('data-theme', 'storyforge')
  document.documentElement.className = ''
  document.body.style.margin = '0'
  container = document.createElement('div')
  container.style.width = '100vw'
  container.style.height = '100vh'
  container.style.position = 'relative'
  container.style.overflow = 'hidden'
  document.body.append(container)
  root = createRoot(container)

  useProjectStore.setState({ currentProject: PROJECT, fileTree: [], loading: false })
  setActiveProjectSessionContext(SESSION)
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
  setActiveProjectSessionContext(null)
  vi.restoreAllMocks()
})

async function clickButton(matcher: (button: HTMLButtonElement) => boolean) {
  const button = await vi.waitFor(() => {
    const found = Array.from(document.body.querySelectorAll('button')).find(matcher)
    if (!found) throw new Error('button not found')
    return found
  })
  await act(async () => { button.click() })
}

function findButton(label: string) {
  return (button: HTMLButtonElement) => button.textContent?.includes(label) ?? false
}

describe('回到上次创作位置（真实路径）', () => {
  it('画布真实保存 → 退出视图 → 概览出现记录卡 → 点击直达该章场景画布', async () => {
    // ===== 真实创作行为：在章节画布中新增一个场景卡（走真实持久化队列） =====
    const invoke = vi.fn(async (channel: string) => {
      switch (channel) {
        case 'db:chapter-canvas-get':
          return { canvas: null, nodes: [], edges: [] }
        case 'db:chapter-canvas-node-upsert':
        case 'db:chapter-canvas-edge-upsert':
        case 'db:chapter-canvas-nodes-reposition':
        case 'db:chapter-canvas-viewport-save':
          return { success: true }
        case 'db:blueprint-get-all':
          return [{ chapterNumber: 2, title: '验牌与夜袭', role: '发展', purpose: '', keyEvents: '', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' }]
        case 'db:draft-list-all':
          return []
        case 'db:narrative-thread-list':
          return []
        case 'db:character-roster-read':
          return { schemaVersion: 1, revision: 1, migrationState: {}, status: 'ready', entries: [], renderedMarkdown: '', projectionHash: '', factHash: '' }
        case 'db:foreshadowing-list':
          return []
        default:
          return { success: true }
      }
    })
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
    })

    await act(async () => {
      root.render(
        <ChapterCanvasWorkbench
          projectKey={PROJECT_PATH}
          chapterNumber={2}
          chapterTitle="验牌与夜袭"
          canOpenDraft
          openDraftLabel="打开第2章正文"
          onOpenDraft={() => {}}
        />,
      )
    })
    await vi.waitFor(() => expect(container.textContent).toContain('第 2 章'))

    await clickButton(findButton('新增场景'))
    await vi.waitFor(() => {
      const input = document.body.querySelector<HTMLInputElement>('#chapter-create-title')
      if (!input) throw new Error('title input missing')
      return input
    })
    await act(async () => {
      const input = document.body.querySelector<HTMLInputElement>('#chapter-create-title')!
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, '雾夜叩门')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(1))

    // 持久化队列冲刷成功 → 真实保存记录写入（且只写了本项目）。
    await vi.waitFor(() => {
      const record = readLastCreationLocation(PROJECT_PATH)
      if (!record) throw new Error('record not written yet')
      expect(record.kind).toBe('chapter-canvas')
      expect(record.chapterNumber).toBe(2)
      expect(record.title).toBe('验牌与夜袭')
    })

    // ===== 退出当前视图 =====
    await act(async () => root.unmount())
    root = createRoot(container)

    // ===== 从项目概览返回 =====
    seedOverviewStores()
    await act(async () => { root.render(<ProjectOverviewPage />) })
    const resumeCard = await vi.waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>('[data-testid="overview-resume-location"]')
      if (!found) throw new Error('resume card missing')
      return found
    })
    expect(resumeCard.textContent).toContain('回到上次创作位置')
    expect(resumeCard.textContent).toContain('场景画布')
    expect(resumeCard.textContent).toContain('第 2 章')
    expect(resumeCard.textContent).toContain('验牌与夜袭')
    await page.screenshot({ path: 'output/resume-location-card.png' })

    await act(async () => { resumeCard.click() })

    // 直达章节蓝图编辑器并落在该章的场景画布视图。
    await vi.waitFor(() => {
      const tab = useEditorStore.getState().tabs.find(t => t.type === 'chapter-card')
      expect(tab).toBeTruthy()
      expect(tab?.chapterNumber).toBe(2)
      expect(tab?.chapterView).toBe('canvas')
      expect(useEditorStore.getState().activeTabId).toBe(tab?.id)
    })
  })

  it('正文记录点击直达草稿编辑器 Tab（读取权威正文后再挂编辑器）', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'db:draft-get-full') return { content: '# 第七章\n已保存正文' }
      if (channel === 'db:draft-get-meta') return { id: 7, chapterNumber: 7, version: 1, status: 'draft' }
      if (channel === 'db:blueprint-get-all') return []
      return { success: true }
    })
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
    })

    recordLastCreationLocation(PROJECT_PATH, {
      kind: 'draft',
      chapterNumber: 7,
      title: '风起云涌',
      savedAt: new Date().toISOString(),
      draftId: 7,
    })

    seedOverviewStores()
    await act(async () => { root.render(<ProjectOverviewPage />) })
    const resumeCard = await vi.waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>('[data-testid="overview-resume-location"]')
      if (!found) throw new Error('resume card missing')
      return found
    })
    expect(resumeCard.textContent).toContain('正文')
    expect(resumeCard.textContent).toContain('第 7 章')

    await act(async () => { resumeCard.click() })
    await vi.waitFor(() => {
      const tab = useEditorStore.getState().tabs.find(t => t.type === 'chapter' && t.draftId === 7)
      expect(tab).toBeTruthy()
      expect(useEditorStore.getState().activeTabId).toBe(tab?.id)
    })
  })

  it('记录失效时不显示卡片，既有「继续写正文」入口保持不变', async () => {
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string) => channel === 'db:blueprint-get-all' ? [] : { success: true }),
        on: vi.fn(() => () => {}),
        once: vi.fn(),
        send: vi.fn(),
      },
    })
    seedOverviewStores()

    // 第 2 章仍有草稿，但蓝图已经删除；不能把草稿误当成蓝图目标。
    recordLastCreationLocation(PROJECT_PATH, {
      kind: 'chapter-canvas', chapterNumber: 2, title: '已删除蓝图', savedAt: new Date().toISOString(),
    })
    await act(async () => { root.render(<ProjectOverviewPage />) })
    await vi.waitFor(() => expect(container.textContent).toContain('继续写正文'))
    await vi.waitFor(() => expect(useDraftStore.getState().dataProjectKey).toBe(PROJECT_PATH))
    expect(container.querySelector('[data-testid="overview-resume-location"]')).toBeNull()

    // 章节已被删除：蓝图与草稿里都没有第 99 章。
    recordLastCreationLocation(PROJECT_PATH, {
      kind: 'blueprint', chapterNumber: 99, title: '不存在的章', savedAt: new Date().toISOString(),
    })
    // 目标草稿已归档：不适合作为回到的创作位置。
    recordLastCreationLocation(PROJECT_PATH, {
      kind: 'draft', chapterNumber: 8, title: '归档章', savedAt: new Date().toISOString(), draftId: 88,
    })
    useDraftStore.setState({
      dataProjectKey: PROJECT_PATH,
      draftsByChapter: {
        ...useDraftStore.getState().draftsByChapter,
        8: [{
          id: 88, chapterNumber: 8, version: 1, status: 'archived', source: 'write',
          wordCount: 10, createdAt: '', updatedAt: '', fileName: '', filePath: 'vela://draft/88',
        }],
      },
    })

    await act(async () => { root.render(<ProjectOverviewPage />) })
    await vi.waitFor(() => expect(container.textContent).toContain('继续写正文'))
    expect(container.querySelector('[data-testid="overview-resume-location"]')).toBeNull()

    // 跨项目隔离：另一个项目写入的记录不影响本项目。
    recordLastCreationLocation('D:/novels/another-book', {
      kind: 'draft', chapterNumber: 1, title: '另一个项目', savedAt: new Date().toISOString(), draftId: 1,
    })
    // 损坏记录：静默视为无记录。
    window.localStorage.setItem('vela:last-creation-location:' + PROJECT_PATH, '{broken')

    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => { root.render(<ProjectOverviewPage />) })
    await vi.waitFor(() => expect(container.textContent).toContain('继续写正文'))
    expect(container.querySelector('[data-testid="overview-resume-location"]')).toBeNull()
  })
})
