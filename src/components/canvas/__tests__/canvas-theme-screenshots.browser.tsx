import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { chapterCanvasId } from '../../../shared/chapter-canvas'
import type { PlotCanvasGraph, PlotCanvasNodeData, PlotCanvasSummary } from '../../../shared/plot-canvas'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import PlotCanvasWorkbench from '../PlotCanvasWorkbench'
import ChapterCanvasWorkbench from '../ChapterCanvasWorkbench'

// Import all styling
import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\canvas-theme-capture'
const PROJECT_SESSION = Object.freeze({
  projectId: 'canvas-theme-capture-project',
  leaseId: 'canvas-theme-capture-lease',
  projectPath: PROJECT_PATH,
})

const CANVAS_ID = 'pca-10000000-0000-4000-8000-000000000001'
const SUB_CANVAS_ID = 'pca-10000000-0000-4000-8000-000000000002'

let root: Root
let container: HTMLDivElement

function node(id: string, title: string, summary: string, x: number, y: number, extra: Partial<PlotCanvasNodeData> = {}): PlotCanvasNodeData {
  return {
    id: `pcn-${id}`,
    canvasId: CANVAS_ID,
    title,
    summary,
    colorKey: 'default',
    chapterRefs: [],
    planId: null,
    subCanvasId: null,
    x,
    y,
    ...extra,
  }
}

function plotGraphFixture(): PlotCanvasGraph {
  return {
    canvas: { id: CANVAS_ID, name: '第一卷 · 归墟主线', description: '', parentCanvasId: null, sortOrder: 1 } satisfies PlotCanvasSummary,
    viewport: null,
    nodes: [
      node('a1000000-0000-4000-8000-000000000001', '渔村灭门', '苏砚回到渔村，全家被灭，只留一枚刻着归墟二字的铜牌。', 80, 240, { colorKey: 'danger', chapterRefs: [1] }),
      node('a1000000-0000-4000-8000-000000000002', '拜入观澜楼', '为查灭门真相，苏砚以废灵根之身拜入观澜楼外门。', 430, 200, { colorKey: 'accent', chapterRefs: [2, 3], planId: 3 }),
      node('a1000000-0000-4000-8000-000000000003', '藏书阁夜遇', '夜探藏书阁，遇见同样在查旧案的白衣少女。', 800, 250, { colorKey: 'warning', chapterRefs: [4] }),
      node('a1000000-0000-4000-8000-000000000004', '外门大比', '外门大比连破三关，铜牌在灵气激发下显出潮纹。', 1150, 210, { colorKey: 'success', chapterRefs: [5] }),
    ],
    edges: [
      { id: 'pce-20000000-0000-4000-8000-000000000001', canvasId: CANVAS_ID, sourceNodeId: 'pcn-a1000000-0000-4000-8000-000000000001', targetNodeId: 'pcn-a1000000-0000-4000-8000-000000000002', label: '承接', kind: 'main' },
      { id: 'pce-20000000-0000-4000-8000-000000000002', canvasId: CANVAS_ID, sourceNodeId: 'pcn-a1000000-0000-4000-8000-000000000002', targetNodeId: 'pcn-a1000000-0000-4000-8000-000000000003', label: '', kind: 'main' },
      { id: 'pce-20000000-0000-4000-8000-000000000003', canvasId: CANVAS_ID, sourceNodeId: 'pcn-a1000000-0000-4000-8000-000000000003', targetNodeId: 'pcn-a1000000-0000-4000-8000-000000000004', label: '铜牌异动', kind: 'aux' },
    ],
  }
}

function seedIpc() {
  return vi.fn(async (channel: string, ...args: unknown[]) => {
    switch (channel) {
      case 'db:plot-canvas-list':
        return [
          { id: CANVAS_ID, name: '第一卷 · 归墟主线', parentCanvasId: null, sortOrder: 1 },
          { id: SUB_CANVAS_ID, name: '藏书阁夜遇 · 子画布', parentCanvasId: CANVAS_ID, sortOrder: 2 },
        ]
      case 'db:plot-canvas-graph-get': {
        const [canvasId] = args as [string]
        if (canvasId === SUB_CANVAS_ID) {
          return {
            canvas: { id: SUB_CANVAS_ID, name: '藏书阁夜遇 · 子画布', description: '', parentCanvasId: CANVAS_ID, sortOrder: 2 },
            viewport: null,
            nodes: [node('b1000000-0000-4000-8000-000000000001', '白衣少女的身份', '她袖口的潮纹与铜牌同源。', 200, 200, { colorKey: 'accent' })],
            edges: [],
          } satisfies PlotCanvasGraph
        }
        return plotGraphFixture()
      }
      case 'db:blueprint-get-all':
        return [1, 2, 3, 4, 5].map(chapterNumber => ({
          chapterNumber, title: `第${chapterNumber}章蓝图`, role: '发展', purpose: '', keyEvents: '',
          characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '',
        }))
      case 'db:draft-list-all':
        return [{ id: 11, chapterNumber: 1, version: 1, status: 'finalized', source: 'write', contentId: 1, wordCount: 800, createdAt: '', updatedAt: '' }]
      case 'db:narrative-thread-list':
        return [{ id: 3, title: '铜牌与归墟', type: 'mystery', targetStartChapter: 1, targetEndChapter: 12, authorIntent: '', status: 'planned', dormantChapters: 0, overdue: false, events: [], createdAt: '', updatedAt: '' }]
      case 'db:plot-tree-read':
        return {
          writingLanguage: 'zh-CN', synopsis: { content: '' }, blueprints: [], finalizedChapters: [], narrativeThreads: [],
          sourceRevision: 'b'.repeat(64),
          snapshot: {
            version: 1, generatedAt: '2026-09-20T08:00:00.000Z', writingLanguage: 'zh-CN', sourceRevision: 'a'.repeat(64),
            tracks: [{
              id: 'main-projection', title: '归墟主线投影', role: 'main', startChapter: 1, endChapter: 5, summary: '铜牌指引的归墟之门。',
              events: [
                { status: 'occurred', chapterNumber: 1, summary: '渔村灭门（定稿）', sources: [{ type: 'finalized-chapter', draftId: 11, chapterNumber: 1 }] },
                { status: 'planned', chapterNumber: 3, summary: '藏书阁的潮纹线索（蓝图）', sources: [{ type: 'blueprint', chapterNumber: 3 }] },
              ],
            }],
          },
        }
      case 'db:chapter-canvas-get': {
        const [chapterNumber] = args as [number]
        return {
          canvas: { id: chapterCanvasId(chapterNumber), chapterNumber, viewport: null },
          nodes: [
            { id: 'ccn-30000000-0000-4000-8000-000000000001', canvasId: chapterCanvasId(chapterNumber), type: 'scene', title: '开局：雾夜叩门', summary: '苏砚冒雨回到观澜楼，途中被黑衣人盯上。', colorKey: 'default', role: '建置', order: 1, refs: {}, x: 100, y: 260 },
            { id: 'ccn-30000000-0000-4000-8000-000000000002', canvasId: chapterCanvasId(chapterNumber), type: 'scene', title: '发展：验牌', summary: '执事验看铜牌，潮纹泛起，暗中记下一笔。', colorKey: 'default', role: '冲突', order: 2, refs: {}, x: 560, y: 260 },
            { id: 'ccn-30000000-0000-4000-8000-000000000003', canvasId: chapterCanvasId(chapterNumber), type: 'scene', title: '高潮：夜袭', summary: '黑衣人夜袭观澜楼，苏砚以铜牌引动潮音退敌。', colorKey: 'default', role: '高潮', order: 3, refs: {}, x: 1020, y: 260 },
            { id: 'ccn-30000000-0000-4000-8000-000000000004', canvasId: chapterCanvasId(chapterNumber), type: 'character', title: '苏砚', summary: '废灵根，性坚韧。', colorKey: 'default', role: '', order: null, refs: { characterName: '苏砚' }, x: 320, y: 40 },
            { id: 'ccn-30000000-0000-4000-8000-000000000005', canvasId: chapterCanvasId(chapterNumber), type: 'foreshadow', title: '潮纹铜牌', summary: '铜牌会在灵气激荡时显出潮纹。', colorKey: 'default', role: '', order: null, refs: { foreshadowingId: 'fs-1' }, x: 760, y: 40 },
            { id: 'ccn-30000000-0000-4000-8000-000000000006', canvasId: chapterCanvasId(chapterNumber), type: 'idea', title: '对白备注', summary: '执事的语气要官而不僵。', colorKey: 'default', role: '', order: null, refs: {}, x: 1120, y: 30 },
          ],
          edges: [
            { id: 'cce-40000000-0000-4000-8000-000000000001', canvasId: chapterCanvasId(chapterNumber), sourceNodeId: 'ccn-30000000-0000-4000-8000-000000000001', targetNodeId: 'ccn-30000000-0000-4000-8000-000000000004', label: '出场', kind: 'aux' },
            { id: 'cce-40000000-0000-4000-8000-000000000002', canvasId: chapterCanvasId(chapterNumber), sourceNodeId: 'ccn-30000000-0000-4000-8000-000000000005', targetNodeId: 'ccn-30000000-0000-4000-8000-000000000003', label: '回收', kind: 'aux' },
          ],
        }
      }
      case 'db:character-roster-read':
        return {
          schemaVersion: 1, revision: 1, migrationState: {}, status: 'ready',
          entries: [{ name: '苏砚', role: 'protagonist', gender: '', age: '', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '' }],
          renderedMarkdown: '', projectionHash: '', factHash: '',
        }
      case 'db:foreshadowing-list':
        return [{ id: 'fs-1', draftId: 11, chapterNumber: 1, selectedText: '铜牌', startOffset: 0, endOffset: 2, contextBefore: '', contextAfter: '', note: '潮纹铜牌的来历', markerType: 'foreshadowing', color: 'blue', completed: false, createdAt: '', updatedAt: '', completedAt: null }]
      case 'db:plot-canvas-node-upsert':
      case 'db:plot-canvas-node-delete':
      case 'db:plot-canvas-nodes-reposition':
      case 'db:plot-canvas-edge-upsert':
      case 'db:plot-canvas-edge-delete':
      case 'db:plot-canvas-viewport-save':
      case 'db:chapter-canvas-node-upsert':
      case 'db:chapter-canvas-node-delete':
      case 'db:chapter-canvas-nodes-reposition':
      case 'db:chapter-canvas-edge-upsert':
      case 'db:chapter-canvas-edge-delete':
      case 'db:chapter-canvas-viewport-save':
        return { success: true }
      default:
        throw new Error(`unexpected IPC ${channel}`)
    }
  })
}

beforeEach(async () => {
  await page.viewport(1440, 900)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  container.style.width = '100vw'
  container.style.height = '100vh'
  container.style.position = 'relative'
  container.style.overflow = 'hidden'
  document.body.style.margin = '0'
  document.body.style.width = '100vw'
  document.body.style.height = '100vh'
  document.body.style.overflow = 'hidden'
  document.body.append(container)
  root = createRoot(container)

  const project: ProjectData = {
    id: PROJECT_SESSION.projectId, sessionLease: PROJECT_SESSION.leaseId, name: '主题截图', path: PROJECT_PATH,
    novelConfig: { genre: '', subGenre: '', targetAudience: '', totalChapters: 12, wordsPerChapter: 2000, plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '' },
    characterStates: '', createdAt: '', updatedAt: '',
  }
  useProjectStore.setState({ currentProject: project, fileTree: [], loading: false })
  setActiveProjectSessionContext(PROJECT_SESSION)
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke: seedIpc(), on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})

async function waitPlotCanvasReady() {
  await vi.waitFor(() => {
    if (container.querySelectorAll('[data-testid="plot-canvas-node"]').length < 4) throw new Error('nodes not ready')
  }, { timeout: 15000 })
  await new Promise(resolve => setTimeout(resolve, 700))
}

async function waitChapterCanvasReady() {
  await vi.waitFor(() => {
    if (container.querySelectorAll('[data-testid="chapter-canvas-scene"]').length < 3) throw new Error('scenes not ready')
  }, { timeout: 15000 })
  await new Promise(resolve => setTimeout(resolve, 700))
}

describe('canvas theme screenshots capture', () => {
  it('captures plot canvas in light theme', async () => {
    document.documentElement.setAttribute('data-theme', 'storyforge')
    document.documentElement.className = ''
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await waitPlotCanvasReady()
    await page.screenshot({ path: 'screenshots/canvas-plot-light.png' })
  })

  it('captures plot canvas in dark theme', async () => {
    document.documentElement.setAttribute('data-theme', 'ember')
    document.documentElement.className = 'dark'
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await waitPlotCanvasReady()
    await page.screenshot({ path: 'screenshots/canvas-plot-dark.png' })
  })

  it('captures plot canvas in starlight theme', async () => {
    document.documentElement.setAttribute('data-theme', 'starlight')
    document.documentElement.className = 'dark'
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await waitPlotCanvasReady()
    await page.screenshot({ path: 'screenshots/canvas-plot-starlight.png' })
  })

  it('captures chapter canvas in light theme', async () => {
    document.documentElement.setAttribute('data-theme', 'storyforge')
    document.documentElement.className = ''
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
    await waitChapterCanvasReady()
    await page.screenshot({ path: 'screenshots/canvas-chapter-light.png' })
  })

  it('captures chapter canvas in dark theme', async () => {
    document.documentElement.setAttribute('data-theme', 'ember')
    document.documentElement.className = 'dark'
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
    await waitChapterCanvasReady()
    await page.screenshot({ path: 'screenshots/canvas-chapter-dark.png' })
  })

  it('captures chapter canvas in starlight theme', async () => {
    document.documentElement.setAttribute('data-theme', 'starlight')
    document.documentElement.className = 'dark'
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
    await waitChapterCanvasReady()
    await page.screenshot({ path: 'screenshots/canvas-chapter-starlight.png' })
  })
})
