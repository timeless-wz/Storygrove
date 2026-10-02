/**
 * planning-visual-fixtures.tsx
 *
 * 创作规划区域视觉验证的共享夹具：项目数据、时间线 / 地图 / 伏笔 / 蓝图示例、
 * 统一的 IPC 桩，以及挂载与断言辅助。结构断言
 * （planning-area-visual.browser.tsx）与截图采集
 * （planning-area-screenshots.visual.tsx）共用这一份，避免两处漂移。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, vi } from 'vitest'

import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { StoryTimelineEvent, StoryTimelineSettings } from '../../../shared/story-timeline'
import type { WorldMap, WorldMapEdge, WorldMapNode } from '../../../shared/world-map'
import { useCharacterStore } from '../../../stores/character-store'
import { useDraftStore, type DraftsByChapter } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { useWorkflowStore } from '../../../stores/workflow-store'







export const PROJECT_PATH = 'C:\\novels\\planning-visual'
const PROJECT_SESSION = {
  projectId: 'planning-visual',
  leaseId: 'planning-visual-lease',
  projectPath: PROJECT_PATH,
}

const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: '潮汐纪年',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '玄幻', subGenre: '东方', targetAudience: '全龄', totalChapters: 24, wordsPerChapter: 3000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '灰潮吞没七座港城。',
    worldSetting: '', goldenFinger: '', protagonistProfile: '沈砚', globalGuidance: '',
  },
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const timelineSettings: StoryTimelineSettings = {
  title: '潮汐纪年 · 故事时间线',
  rulerLabel: '大潮历',
  rulerUnit: '年',
  // 作者已经设好故事范围：刻度 1–4 年，主轴宽度落在可读范围内。
  hasCustomRange: true,
  startOrder: 1,
  endOrder: 4,
  startLabel: '故事开端',
  endLabel: '故事结束',
  startTimeLabel: '大潮历 308 年',
  endTimeLabel: '大潮历 318 年',
}

function timelineEvent(
  overrides: Partial<StoryTimelineEvent> & { id: string; sortOrder: number },
): StoryTimelineEvent {
  return {
    title: overrides.id,
    timeLabel: '时间',
    precision: 'exact',
    description: '',
    chapterNumbers: [],
    characterNames: [],
    locationNodeIds: [],
    status: 'planned',
    ...overrides,
  }
}

export const TIMELINE_EVENTS: StoryTimelineEvent[] = [
  timelineEvent({
    id: 't1', sortOrder: 1, title: '灰潮初现', timeLabel: '大潮历 310 年', status: 'finalized',
    chapterNumbers: [1], description: '第一座港城的灯火熄灭。', characterNames: ['沈砚'],
  }),
  timelineEvent({
    id: 't2', sortOrder: 2, title: '雾港调查', timeLabel: '大潮历 312 年', status: 'drafted',
    chapterNumbers: [3, 4], description: '沈砚在雾港找到名册。',
  }),
  timelineEvent({ id: 't3', sortOrder: 3, title: '灯塔停摆', timeLabel: '大潮历 315 年' }),
]

const WORLD_MAP_ID = 'map-planning-0001'
const HARBOR_MAP_ID = 'map-planning-0002'

export const WORLD_MAPS: WorldMap[] = [
  { id: WORLD_MAP_ID, name: '潮汐世界总图', parentMapId: null, sortOrder: 1, image: null },
  { id: HARBOR_MAP_ID, name: '雾港城地图', parentMapId: WORLD_MAP_ID, sortOrder: 1, image: null },
]

export const WORLD_NODES: WorldMapNode[] = [
  { id: 'n1', name: '灰潮之眼', type: 'world', description: '海图中央的空白处。', parentId: null, mapId: WORLD_MAP_ID, x: 320, y: 260, sourceRefs: [] },
  { id: 'n2', name: '雾港', type: 'city', description: '', parentId: null, mapId: WORLD_MAP_ID, x: 520, y: 360, sourceRefs: [] },
  { id: 'n3', name: '灯塔', type: 'landmark', description: '已经停摆。', parentId: 'n2', mapId: WORLD_MAP_ID, x: 640, y: 300, sourceRefs: [] },
]

const WORLD_EDGES: WorldMapEdge[] = [
  { id: 'e1', fromNodeId: 'n2', toNodeId: 'n3', type: 'subordinate', description: '城内连接', status: 'active', mapId: WORLD_MAP_ID },
]

export const FORESHADOWING_ITEMS = [
  {
    id: 'f1', draftId: 1, chapterNumber: 1, selectedText: '一枚生锈的铜哨', startOffset: 12, endOffset: 20,
    contextBefore: '船头的木箱里放着', contextAfter: '，已经吹不响了。', note: '第三章揭示铜哨的来历',
    markerType: 'foreshadowing', color: 'blue', completed: false,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', completedAt: null,
  },
  {
    id: 'f2', draftId: 1, chapterNumber: 1, selectedText: '灯塔守夜人的名册', startOffset: 40, endOffset: 48,
    contextBefore: '她把', contextAfter: '折进怀里。', note: '名册上的第七个名字是空的',
    markerType: 'deepen', color: 'purple', completed: true,
    createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-03T00:00:00.000Z',
  },
]

export const BLUEPRINTS = [
  { chapterNumber: 1, volumeId: 'volume-1', title: '灰潮初现', role: '建置', purpose: '让沈砚确认灰潮正在逼近。', keyEvents: '港城熄灯。', characters: ['沈砚'], suspenseHook: '铜哨吹不响。', userGuidance: '', notes: '', notesUpdatedAt: '' },
  { chapterNumber: 2, volumeId: 'volume-1', title: '雾港的门槛', role: '发展', purpose: '登船。', keyEvents: '登船。', characters: [], suspenseHook: '', userGuidance: '让反派提前露面', notes: '', notesUpdatedAt: '' },
  { chapterNumber: 3, volumeId: 'volume-1', title: '灯塔停摆', role: '冲突', purpose: '争夺名册。', keyEvents: '灯塔失效。', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' },
]

export const DRAFTS_BY_CHAPTER: DraftsByChapter = {
  1: [{
    id: 1, chapterNumber: 1, chapterTitle: '第一章 灰潮初现', blueprintChapterNumber: 1, version: 1,
    status: 'draft', source: 'write', filePath: 'drafts/ch1/draft_1.md', fileName: 'draft_1.md',
    createdAt: '2026-09-01', updatedAt: '2026-09-01',
  }],
}

const originalStates = {
  draft: useDraftStore.getState(),
  editor: useEditorStore.getState(),
  layout: useLayoutStore.getState(),
  locale: useLocaleStore.getState(),
  project: useProjectStore.getState(),
  workflow: useWorkflowStore.getState(),
  timeline: useStoryTimelineStore.getState(),
  worldMap: useWorldMapStore.getState(),
  character: useCharacterStore.getState(),
}

let container: HTMLDivElement
let root: Root

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 统一的项目 IPC 桩：既能给出空数据，也能给出真实形状的示例数据。 */
export function installApi({ withData }: { withData: boolean }): void {
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string) => {
        switch (channel) {
          case 'fs:list-dir':
            return []
          case 'db:draft-list-all':
            return withData ? Object.values(DRAFTS_BY_CHAPTER).flat() : []
          case 'db:blueprint-get-all':
          case 'db:blueprint-list-summary':
            return withData ? BLUEPRINTS : []
          case 'db:blueprint-v2-summary-list':
            return []
          case 'db:blueprint-v2-get':
            return null
          case 'db:blueprint-volume-list':
            return withData ? [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }] : []
          case 'db:project-core-get':
            // 架构状态以「长度 > 50」判定是否已生成，夹具要与真实数据同量级。
            return {
              premise: '灰潮正在吞没七座港城，沈砚必须在所有灯塔停摆之前找到灰潮之眼的坐标，否则整片海域将失去潮位参照。',
              charactersArch: '',
              worldbuilding: '潮汐历法与灯塔体系：每座港城由一座灯塔标记潮位，潮位决定船只能否出港，灯塔熄灭意味着航线与补给同时中断。',
              synopsis: '三幕结构：第一幕灯塔逐座熄灭，第二幕名册与铜哨争夺，第三幕在灰潮之眼完成逆转，主角以旧名册换回航路。',
            }
          case 'db:character-roster-read':
            return { status: 'ready', revision: 1, entries: [], renderedMarkdown: '角色名单' }
          case 'chapter:list-incomplete-deletions':
            return { success: true, operations: [] }
          case 'db:map-get-all':
            return withData
              ? { maps: WORLD_MAPS, nodes: WORLD_NODES, edges: WORLD_EDGES, migration: null }
              : { maps: [], nodes: [], edges: [], migration: null }
          case 'db:map-candidates-get':
            return []
          case 'world-map-image:get':
            return { success: true, image: null, dataUrl: null }
          case 'db:timeline-get-all':
            return withData
              ? { settings: timelineSettings, branches: [], events: TIMELINE_EVENTS }
              : { settings: timelineSettings, branches: [], events: [] }
          case 'db:foreshadowing-list':
            return withData ? FORESHADOWING_ITEMS : []
          case 'db:draft-get-full':
            return { id: 1, content: '船头的木箱里放着一枚生锈的铜哨，已经吹不响了。' }
          case 'db:plot-tree-read':
            return withData
              ? {
                  snapshot: null,
                  sourceRevision: 'a'.repeat(64),
                  storedSnapshotInvalid: false,
                  blueprints: BLUEPRINTS.map(blueprint => ({
                    chapterNumber: blueprint.chapterNumber,
                    title: blueprint.title,
                  })),
                  finalizedChapters: [],
                  narrativeThreads: [],
                }
              : {
                  snapshot: null,
                  sourceRevision: '',
                  storedSnapshotInvalid: false,
                  blueprints: [],
                  finalizedChapters: [],
                  narrativeThreads: [],
                }
          case 'db:narrative-thread-list':
            return withData
              ? [
                  {
                    id: 9, title: '铜哨的来历', type: '伏笔', targetStartChapter: 1, targetEndChapter: 8,
                    authorIntent: '让读者先记住这枚哨子，再在第八章解释它属于谁。',
                    status: 'progressing', dormantChapters: 2, overdue: false, createdAt: '', updatedAt: '',
                    events: [{
                      id: 91, planId: 9, draftId: 1, chapterNumber: 1, chapterTitle: '灰潮初现',
                      type: 'planted', evidence: '一枚生锈的铜哨', reason: '第一章已经埋下。', createdAt: '',
                    }],
                  },
                ]
              : []
          case 'db:draft-authority-sequence':
            return {
              status: 'empty',
              lastChapterNumber: 0,
              nextChapterNumber: 1,
              duplicateChapterNumbers: [],
              authorityFingerprint: 'a'.repeat(64),
            }
          default:
            return []
        }
      }),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      setZoomLevel: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
  })
}

export function registerPlanningVisualHooks(): void {
  beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1, fileTree: [], loading: false })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useDraftStore.setState({
    draftsByChapter: {},
    loading: false,
    dataProjectKey: null,
    dataProjectSession: null,
    loadingProjectKey: null,
    loadingProjectSession: null,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useLayoutStore.setState({
    sidebarOpen: true,
    sidebarView: 'project',
    activeRailItem: 'project',
    characterViewRequest: null,
    projectTreeGroupOpen: { plan: true, setting: true, library: true, management: true, manuscript: true },
  })
  useStoryTimelineStore.setState({
    ...originalStates.timeline,
    settings: timelineSettings, branches: [], events: [], expandedBranchIds: [],
    loading: false, dataProjectKey: null,
  })
  useWorldMapStore.setState({
    ...originalStates.worldMap,
    maps: [], nodes: [], edges: [], candidates: [], migration: null,
    selectedMapId: null, selectedNodeId: null, selectedEdgeId: null,
    viewMode: 'canvas', loading: false, candidatesLoading: false,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  // 容器严格贴合浏览器视口，截图才能 1:1 反映真实布局，不会因溢出被裁切。
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  document.body.style.margin = '0'
  document.body.style.padding = '0'
  document.body.style.width = `${viewportWidth}px`
  document.body.style.height = `${viewportHeight}px`
  document.body.style.overflow = 'hidden'

  container = document.createElement('div')
  container.style.width = `${viewportWidth}px`
  container.style.height = `${viewportHeight}px`
  container.style.display = 'flex'
  container.style.flexDirection = 'column'
  container.style.overflow = 'hidden'
  container.style.background = 'var(--color-bg)'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  // 组件卸载后仍可能有 in-flight 的项目 IPC（世界地图图片、剧情树资料等）。
  // 先让它们结算，再恢复 store，避免把状态泄漏给同一次运行里的下一个测试文件。
  await act(async () => {
    await new Promise<void>(resolve => { setTimeout(resolve, 250) })
  })
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useDraftStore.setState(originalStates.draft)
  useEditorStore.setState(originalStates.editor)
  useLayoutStore.setState(originalStates.layout)
  useLocaleStore.setState(originalStates.locale)
  useProjectStore.setState(originalStates.project)
  useWorkflowStore.setState(originalStates.workflow)
  useStoryTimelineStore.setState(originalStates.timeline)
  useWorldMapStore.setState(originalStates.worldMap)
  useCharacterStore.setState(originalStates.character)
  vi.restoreAllMocks()
})
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function mountInto(node: React.ReactNode): Promise<void> {
  await act(async () => { root.render(node) })
  await settle()
}

export function pageText(): string {
  return container.textContent ?? ''
}

/** 五个规划页面共用的返回路径：项目总览 › 创作规划 › 当前页面。 */
export function expectSharedChrome(currentLabel: string): void {
  const crumb = container.querySelector('nav[aria-label="返回路径"]')
  expect(crumb, 'every planning page must expose the same breadcrumb').not.toBeNull()
  const crumbItems = Array.from(crumb?.querySelectorAll('.planning-page__crumb') ?? [])
    .map(item => item.textContent?.trim())
  expect(crumbItems).toEqual(['项目总览', '创作规划', currentLabel])
  expect(container.querySelector('h1')?.textContent?.trim()).toBeTruthy()
}



/**
 * 返回页面级辅助（挂载 / 取文本 / 共用外壳断言）。
 * 钩子本身由 registerPlanningVisualHooks() 在测试文件里注册。
 */
export function planningVisualHarness() {
  return {
    mount: mountInto,
    pageText,
    expectSharedChrome,
    container: (): HTMLDivElement => container,
  }
}
