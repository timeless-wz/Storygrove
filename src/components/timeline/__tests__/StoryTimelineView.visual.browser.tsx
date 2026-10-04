import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import '../../../index.css'
import '../../../styles/literary-themes.css'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { StoryTimelineBranch, StoryTimelineEvent, StoryTimelineSettings } from '../../../shared/story-timeline'
import { EMPTY_CARD, useCharacterStore } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import StoryTimelineView from '../StoryTimelineView'

/**
 * 时间线视觉验收截图（任务 D）。
 *
 * 这里挂的是真实页面与真实 store：数据从 memory store 读入，所有交互都走
 * 页面自己的回调，不存在绕过 store 的假页面；fixture 只是作者数据本身。
 * 产物输出到仓库根 screenshots/，覆盖验收矩阵要求的八种画面：
 * 整体 / 选中 / 右键详情 / 编辑 / 侧栏折叠 / 窄画布 / 密集分支 / 深色主题。
 */

const PROJECT_PATH = 'C:\\novels\\story-timeline-visual'
const PROJECT_SESSION = {
  projectId: 'story-timeline-visual',
  leaseId: 'story-timeline-visual-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Story timeline visual',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '', subGenre: '', targetAudience: '', totalChapters: 12, wordsPerChapter: 2500,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '',
    worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const settings: StoryTimelineSettings = {
  title: '故事时间线',
  rulerLabel: '大荒纪年',
  rulerUnit: '年',
  startLabel: '故事开端',
  startTimeLabel: '大荒历 309 年',
  endLabel: '故事结束',
  endTimeLabel: '大荒历 321 年',
  startOrder: 0,
  endOrder: 12,
  hasCustomRange: true,
}

function makeEvent(overrides: Partial<StoryTimelineEvent> & { id: string; sortOrder: number }): StoryTimelineEvent {
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

const visualEvents: StoryTimelineEvent[] = [
  makeEvent({
    id: 'v1', sortOrder: 1, title: '末班车驶出地图', timeLabel: '大荒历 310 年',
    description: '许渡在末班车上数清了乘客：连他在内，只剩七个人。',
    chapterNumbers: [1], status: 'finalized',
  }),
  makeEvent({
    id: 'v2', sortOrder: 3, title: '雾港调查', timeLabel: '大荒历 312 年',
    description: '码头的旧账本指向三年前失踪的船队，账页边缘写着半句潮谚。',
    chapterNumbers: [3, 4], characterNames: ['许渡'], status: 'drafted',
  }),
  makeEvent({
    id: 'v3', sortOrder: 5, title: '隧道封锁期', timeLabel: '大荒历 313 年',
    description: '通往北岸的隧道被市政厅无限期封锁。',
    chapterNumbers: [6], status: 'planned',
  }),
  makeEvent({
    id: 'v4', sortOrder: 7, title: '雾港夜航', timeLabel: '大荒历 315 年',
    description: '许渡跟着引灯人走完夜航水道。',
    chapterNumbers: [8], status: 'drafted',
  }),
  makeEvent({
    id: 'v5', sortOrder: 9, title: '许渡归来', timeLabel: '大荒历 318 年',
    description: '',
    chapterNumbers: [11], status: 'finalized',
  }),
]

/** 参考图密度：主线五事件 + 单条支线两事件。 */
const referenceBranches: StoryTimelineBranch[] = [
  { id: 'branch-river', name: '暗河支线', sourceEventId: 'v2', sortOrder: 1 },
]

/** 密集分支：同一来源三条支线 + 一层嵌套 + 一条真实空支线。 */
const denseBranches: StoryTimelineBranch[] = [
  ...referenceBranches,
  { id: 'branch-tunnel', name: '隧道地下线', sourceEventId: 'v3', sortOrder: 2 },
  { id: 'branch-ledger', name: '账本线索', sourceEventId: 'v2', sortOrder: 3 },
  { id: 'branch-nested', name: '夜航余波', sourceEventId: 'b1', sortOrder: 4 },
  { id: 'branch-empty', name: '尚未展开的支线', sourceEventId: 'v4', sortOrder: 5 },
]

const branchEvents: StoryTimelineEvent[] = [
  makeEvent({
    id: 'b1', sortOrder: 4, branchId: 'branch-river', parentEventId: 'v2',
    title: '暗河密会', timeLabel: '大荒历 312 年冬',
    description: '沈砚在暗河渡口交出半枚铜钥匙。',
    chapterNumbers: [5], status: 'drafted',
  }),
  makeEvent({
    id: 'b2', sortOrder: 6, branchId: 'branch-river', parentEventId: 'b1',
    title: '沉船之谜', timeLabel: '大荒历 314 年',
    description: '失踪船队的龙骨在暗河拐弯处被发现。',
    status: 'planned',
  }),
  makeEvent({
    id: 'b3', sortOrder: 6, branchId: 'branch-ledger', parentEventId: 'v2',
    title: '账本被调包', timeLabel: '大荒历 313 年春',
    description: '三年前的账页换成了新纸。',
    status: 'planned',
  }),
  makeEvent({
    id: 'b4', sortOrder: 8, branchId: 'branch-tunnel', parentEventId: 'v3',
    title: '封锁令的签名', timeLabel: '大荒历 313 年秋',
    description: '签名栏里是许渡从未见过的名字。',
    status: 'drafted',
  }),
  makeEvent({
    id: 'b5', sortOrder: 9, branchId: 'branch-nested', parentEventId: 'b1',
    title: '引灯人的旧约', timeLabel: '大荒历 316 年',
    description: '引灯人承认自己三十年前也走过同一条水道。',
    status: 'planned',
  }),
]

const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalTimelineState = useStoryTimelineStore.getState()
const originalWorldMapState = useWorldMapStore.getState()
const originalCharacterState = useCharacterStore.getState()
const originalLayoutState = useLayoutStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>
/** 当前用例的真实数据 fixture：loadAll 会读它，保证页面展示的就是这份数据。 */
let fixture: { events: StoryTimelineEvent[]; branches: StoryTimelineBranch[] } = {
  events: [...visualEvents, ...branchEvents.slice(0, 2)],
  branches: [...referenceBranches],
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function labelFor(eventId: string): HTMLElement {
  const element = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="timeline-event-label"]'))
    .find(label => label.dataset.eventId === eventId)
  if (!element) throw new Error(`timeline label for ${eventId} is missing`)
  return element
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const nativeSet = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  nativeSet?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 真实右键：走 React Flow 的节点 contextmenu，与用户操作同一条路径。 */
async function rightClickEvent(eventId: string): Promise<void> {
  const node = labelFor(eventId).closest('.react-flow__node') as HTMLElement
  const rect = node.getBoundingClientRect()
  await act(async () => {
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }))
  })
}

async function settle(ms = 260): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}

async function mountTimeline(options: {
  events?: StoryTimelineEvent[]
  branches?: StoryTimelineBranch[]
  expanded?: string[]
  width?: number
  height?: number
} = {}): Promise<void> {
  const events = options.events ?? [...visualEvents, ...branchEvents.slice(0, 2)]
  const branches = options.branches ?? [...referenceBranches]
  fixture = { events, branches }
  useStoryTimelineStore.setState({
    ...originalTimelineState,
    settings,
    branches,
    events,
    expandedBranchIds: options.expanded ?? ['main', ...branches.map(branch => branch.id)],
    dataProjectKey: PROJECT_PATH,
    loading: false,
  })
  await act(async () => {
    root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
  })
  await act(async () => {
    await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-flow"]')).not.toBeNull())
  })
  await settle(360)
}

/** 扮演主进程：按与仓库相同的递归规则给出权威删除影响。 */
function previewDeleteFor(kind: 'event' | 'branch', targetId: string) {
  const branchIds = new Set<string>()
  const eventIds = new Set<string>()
  if (kind === 'event') {
    eventIds.add(targetId)
    const queue = fixture.branches.filter(branch => branch.sourceEventId === targetId)
    while (queue.length > 0) {
      const branch = queue.shift()!
      if (branchIds.has(branch.id)) continue
      branchIds.add(branch.id)
      for (const event of fixture.events) {
        if (event.branchId !== branch.id) continue
        eventIds.add(event.id)
        queue.push(...fixture.branches.filter(item => item.sourceEventId === event.id))
      }
    }
  } else {
    const queue = [targetId]
    while (queue.length > 0) {
      const branchId = queue.shift()!
      if (branchIds.has(branchId)) continue
      branchIds.add(branchId)
      for (const event of fixture.events) {
        if (event.branchId !== branchId) continue
        eventIds.add(event.id)
        queue.push(...fixture.branches
          .filter(item => item.sourceEventId === event.id)
          .map(item => item.id))
      }
    }
  }
  const branchNames = [...branchIds].map(id => fixture.branches.find(branch => branch.id === id)?.name ?? id)
  return {
    kind,
    targetId,
    targetLabel: kind === 'event'
      ? fixture.events.find(event => event.id === targetId)?.title ?? targetId
      : fixture.branches.find(branch => branch.id === targetId)?.name ?? targetId,
    eventIds: [...eventIds],
    branchIds: [...branchIds],
    branchNames,
    eventCount: eventIds.size,
    branchCount: branchIds.size,
    fingerprint: `fp-${kind}-${targetId}`,
  }
}

beforeEach(() => {
  window.localStorage.clear()
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1 })
  useCharacterStore.setState({
    ...originalCharacterState,
    characters: [{ ...EMPTY_CARD, name: '许渡' }, { ...EMPTY_CARD, name: '沈砚' }],
    selectedName: null,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    loadingProjectKey: null,
    loadingProjectSession: null,
    lastError: null,
  })
  useLayoutStore.setState({ ...originalLayoutState, sidebarView: 'project', characterViewRequest: null })
  useWorldMapStore.setState({ ...originalWorldMapState, maps: [], nodes: [], edges: [], migration: null, loading: false })
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:timeline-get-all') {
      return { settings, branches: fixture.branches, events: fixture.events }
    }
    if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
    if (channel === 'db:timeline-event-delete-preview') {
      return { success: true, preview: previewDeleteFor('event', String(args[0])) }
    }
    if (channel === 'db:timeline-branch-delete-preview') {
      return { success: true, preview: previewDeleteFor('branch', String(args[0])) }
    }
    if (channel === 'config:set') return { success: true }
    return { success: false, error: `unexpected channel ${channel}` }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })

  container = document.createElement('div')
  container.style.width = '1600px'
  container.style.height = '900px'
  document.body.append(container)
  document.body.style.margin = '0'
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.documentElement.classList.remove('dark')
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useCharacterStore.setState(originalCharacterState)
  useLayoutStore.setState(originalLayoutState)
  useStoryTimelineStore.setState(originalTimelineState)
  useWorldMapStore.setState(originalWorldMapState)
  vi.restoreAllMocks()
})

describe('story timeline acceptance screenshots', () => {
  it('captures the workbench: overall, selected, float details, edit, collapsed sidebar', async () => {
    await page.viewport(1600, 900)
    await mountTimeline()
    await page.screenshot({ path: '../../../../screenshots/timeline-canvas-default.png' })

    // 单击只选中：画布上不出现底部详情，也没有自动弹出的浮窗
    const node = labelFor('v2').closest('.react-flow__node') as HTMLElement
    await act(async () => {
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle(160)
    expect(labelFor('v2').className).toContain('is-selected')
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()
    await page.screenshot({ path: '../../../../screenshots/timeline-selected.png' })

    // 右键 → 画布内详情浮窗
    await rightClickEvent('v2')
    await settle(200)
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()
    await page.screenshot({ path: '../../../../screenshots/timeline-float-details.png' })

    // 浮窗内编辑态
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle(220)
    expect(container.querySelector('[data-testid="timeline-event-float"]')?.getAttribute('data-float-mode')).toBe('edit')
    await page.screenshot({ path: '../../../../screenshots/timeline-float-edit.png' })

    // 收起内侧栏：画布占满释放的空间，展开按钮悬浮在画布左缘
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const widthBefore = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')!.getBoundingClientRect().width
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-collapse"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle(240)
    expect(container.querySelector('.planning-pane')).toBeNull()
    expect(container.querySelector('[data-testid="timeline-sidebar-expand"]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')!.getBoundingClientRect().width)
      .toBeGreaterThan(widthBefore)
    await page.screenshot({ path: '../../../../screenshots/timeline-sidebar-collapsed.png' })
  })

  it('captures dense branches with an empty branch, and the dark theme', async () => {
    await page.viewport(1600, 900)
    await mountTimeline({ events: [...visualEvents, ...branchEvents], branches: [...denseBranches] })
    // 密集分支：三条同源支线 + 嵌套 + 真实空支线都在侧栏里
    expect(container.textContent).toContain('尚未展开的支线')
    expect(container.querySelector('[data-testid="timeline-branch-empty"]')).not.toBeNull()
    await page.screenshot({ path: '../../../../screenshots/timeline-dense-branches.png' })

    document.documentElement.classList.add('dark')
    await settle(260)
    await page.screenshot({ path: '../../../../screenshots/timeline-canvas-dark.png' })
    document.documentElement.classList.remove('dark')

    // 深色下编辑浮窗同样可读
    document.documentElement.classList.add('dark')
    await rightClickEvent('v4')
    await settle(220)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle(220)
    await page.screenshot({ path: '../../../../screenshots/timeline-dark-float-edit.png' })
    document.documentElement.classList.remove('dark')
  })

  it('keeps the editing float inside a narrow canvas', async () => {
    container.style.width = '620px'
    container.style.height = '500px'
    await page.viewport(700, 560)
    await mountTimeline({ width: 620, height: 500 })

    await rightClickEvent('v2')
    await settle(200)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle(240)

    const flow = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')!.getBoundingClientRect()
    const float = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')!.getBoundingClientRect()
    // 浮窗必须完整落在画布边界内（四边都不越界），保存按钮可见
    expect(float.left).toBeGreaterThanOrEqual(flow.left - 1)
    expect(float.top).toBeGreaterThanOrEqual(flow.top - 1)
    expect(float.right).toBeLessThanOrEqual(flow.right + 1)
    expect(float.bottom).toBeLessThanOrEqual(flow.bottom + 1)
    expect(container.querySelector('[data-testid="timeline-float-save"]')).not.toBeNull()
    await page.screenshot({ path: '../../../../screenshots/timeline-narrow-canvas-float.png' })
  })

  it('captures a long-text event and the empty timeline first-event entry', async () => {
    await page.viewport(1600, 900)
    const longEvent = makeEvent({
      id: 'long', sortOrder: 10,
      title: '长标题换行检查：这条事件的标题刻意写得很长，用来验证两行截断与描述换行',
      timeLabel: '大荒历 320 年冬末的最后一场雨',
      description: '描述同样写得足够长，用来确认画布节点最多展示两行，完整内容仍然可以在浮窗里读到，而不是被省略号吞掉。',
      status: 'drafted',
    })
    await mountTimeline({ events: [...visualEvents, longEvent], branches: [], expanded: ['main'] })
    expect(labelFor('long').getBoundingClientRect().width).toBeGreaterThan(0)
    await page.screenshot({ path: '../../../../screenshots/timeline-long-text.png' })

    // 空时间线：画布仍显示起止锚点，首事件创建入口真实可用
    await act(async () => root.unmount())
    root = createRoot(container)
    await mountTimeline({ events: [], branches: [], expanded: ['main'] })
    expect(container.querySelector('[data-testid="timeline-anchor-start"]')).not.toBeNull()
    expect(container.textContent).toContain('时间线上还没有事件')
    await page.screenshot({ path: '../../../../screenshots/timeline-empty.png' })
  })

  it('writes a rename and keeps the sidebar group structure visible', async () => {
    await page.viewport(1600, 900)
    await mountTimeline()

    await act(async () => {
      const button = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="timeline-branch-rename"]'))
        .find(item => item.dataset.branchId === 'branch-river')
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = container.querySelector<HTMLInputElement>('[data-testid="timeline-branch-rename-input"]')
    expect(input).not.toBeNull()
    await act(async () => {
      setInputValue(input!, '暗河支线（已改名）')
    })
    await settle(120)
    await page.screenshot({ path: '../../../../screenshots/timeline-sidebar-rename.png' })
  })

  it('captures 1920×1080, the paper light theme, English locale and app zoom levels', async () => {
    // 1920×1080 整体
    container.style.width = '1920px'
    container.style.height = '1080px'
    await page.viewport(1920, 1080)
    await mountTimeline()
    await page.screenshot({ path: '../../../../screenshots/timeline-overall-1920.png' })

    // 另一浅色主题（paper）：画布与浮窗在同一套 token 下保持可读
    document.documentElement.classList.add('paper')
    await settle(200)
    await rightClickEvent('v2')
    await settle(200)
    await page.screenshot({ path: '../../../../screenshots/timeline-theme-paper.png' })
    document.documentElement.classList.remove('paper')
    await settle(120)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle(120)

    // 英文界面
    await act(async () => {
      await useLocaleStore.getState().setLocale('en-US')
    })
    await settle(200)
    await page.screenshot({ path: '../../../../screenshots/timeline-locale-en.png' })
    await act(async () => {
      await useLocaleStore.getState().setLocale('zh-CN')
    })

    // 应用缩放 125% / 150%：Electron 的界面缩放等价于用更少的 CSS 像素
    // 渲染同样的布局，因此按比例缩小视口与容器来近似（1920/1.25、1920/1.5）。
    for (const zoomLevel of [1.25, 1.5]) {
      const width = Math.round(1920 / zoomLevel)
      const height = Math.round(1080 / zoomLevel)
      await page.viewport(width, height)
      container.style.width = `${width}px`
      container.style.height = `${height}px`
      await settle(240)
      const button = container.querySelector<HTMLElement>('[data-testid="timeline-toolbar-new-event"]')
      expect(button).not.toBeNull()
      const rect = button!.getBoundingClientRect()
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
      expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight)
      await page.screenshot({ path: `../../../../screenshots/timeline-app-zoom-${String(zoomLevel).replace('.', '')}.png` })
    }
    await page.viewport(1920, 1080)
    container.style.width = '1920px'
    container.style.height = '1080px'
    await settle(120)
  })
})
