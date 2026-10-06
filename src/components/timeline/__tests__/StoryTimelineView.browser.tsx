import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 画布几何断言（浮窗钳制、侧栏折叠保持缩放）需要真实的高度链：
// 全局样式（Tailwind 工具类 + 主题 token）必须与组件样式一起加载。
import '../../../index.css'
import '../../../styles/literary-themes.css'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { StoryTimelineEvent, StoryTimelineSettings } from '../../../shared/story-timeline'
import { EMPTY_CARD, useCharacterStore } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import StoryTimelineView from '../StoryTimelineView'
import { readTimelineUiPrefs, writeTimelineUiPrefs } from '../timeline-ui-prefs'

const PROJECT_PATH = 'C:\\novels\\story-timeline'
const PROJECT_SESSION = {
  projectId: 'story-timeline',
  leaseId: 'story-timeline-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Story timeline',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '', subGenre: '', targetAudience: '', totalChapters: 4, wordsPerChapter: 2500,
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

/** 故意打乱输入顺序：横轴顺序必须只由 sortOrder 决定。 */
const timelineEvents: StoryTimelineEvent[] = [
  makeEvent({
    id: 'e4', sortOrder: 40, title: '许渡归来', timeLabel: '大荒历 318 年',
    status: 'finalized',
  }),
  makeEvent({ id: 'e1', sortOrder: 10, title: '末班车驶出地图', timeLabel: '大荒历 310 年' }),
  makeEvent({
    id: 'e3', sortOrder: 30, title: '隧道封锁期', timeLabel: '大荒历 313 年',
    precision: 'range', rangeEndLabel: '大荒历 315 年',
  }),
  makeEvent({
    id: 'e2', sortOrder: 20, title: '雾港调查', timeLabel: '大荒历 312 年',
    description: '仅在详情浮窗可见的完整描述',
    chapterNumbers: [3, 4],
    // 角色名刻意不与任何标题重叠，便于断言时间轴上不出现关联角色。
    characterNames: ['沈砚'],
    locationNodeIds: ['loc-1'],
    status: 'drafted',
  }),
  makeEvent({ id: 'e5', sortOrder: 50, title: '终局对峙', timeLabel: '大荒历 320 年' }),
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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function labels(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="timeline-event-label"]'))
}

function labelFor(eventId: string): HTMLElement {
  const element = labels().find(label => label.dataset.eventId === eventId)
  if (!element) throw new Error(`timeline label for ${eventId} is missing`)
  return element
}

/** 依据 sortOrder 排序后的标注元素，用于验证横轴左右关系。 */
function labelsInSortOrder(): Array<{ eventId: string; element: HTMLElement; sortOrder: number }> {
  return timelineEvents
    .map(event => ({ eventId: event.id, element: labelFor(event.id), sortOrder: event.sortOrder }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
}

/** 当前画布缩放：从 React Flow 视口元素的 transform 里读真实值。 */
function canvasZoom(): number {
  const element = container.querySelector<HTMLElement>('.react-flow__viewport')
  const match = /scale\(\s*([\d.]+)\s*\)/.exec(element?.style.transform ?? '')
  return match ? Number(match[1]) : Number.NaN
}

/** 画布视口的完整 transform：用来证明普通状态更新没有移动画布。 */
function canvasTransform(): string {
  return container.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
}

/**
 * 等画布视口真正落定：Scene 的适配/定位都排在 requestAnimationFrame 之后，
 * 定位动画还有 250ms。不先等它落定就读 zoom，量到的是动画中间值。
 */
async function settleCanvas(ms = 320): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.setTimeout(resolve, ms)
      }))
    })
  })
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {  const nativeSet = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  nativeSet?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function formField(labelText: string): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(container.querySelectorAll('.writer-timeline-field'))
    .find(node => (node.querySelector('span')?.textContent ?? '').includes(labelText))
  const field = label?.querySelector('input, textarea')
  if (!field) throw new Error(`form field ${labelText} is missing`)
  return field as HTMLInputElement | HTMLTextAreaElement
}

async function clickLabel(eventId: string): Promise<void> {
  const element = labelFor(eventId)
  const node = (element.closest('.react-flow__node') as HTMLElement | null) ?? element
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * 画布空白右键必须在 React Flow 的 pane 上触发；事件浮窗与画布菜单都
 * 钳制在画布矩形内，pane 的矩形中心既与清单宽度无关，又始终落在故事
 * 起止锚点之间的主干区域内。
 */
async function rightClickCanvas(): Promise<void> {
  const pane = container.querySelector<HTMLElement>('.react-flow__pane')
  if (!pane) throw new Error('react flow pane is missing')
  const rect = pane.getBoundingClientRect()
  await act(async () => {
    pane.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }))
  })
}

async function rightClickLabel(eventId: string): Promise<void> {
  const element = labelFor(eventId)
  const node = (element.closest('.react-flow__node') as HTMLElement | null) ?? element
  await act(async () => {
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))
  })
}

/** 右键事件 → 详情浮窗 → 「编辑事件」按钮，进入浮窗内编辑态。 */
async function openEditFloat(eventId: string): Promise<HTMLElement> {
  await rightClickLabel(eventId)
  const float = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')
  expect(float).not.toBeNull()
  const editButton = float!.querySelector<HTMLButtonElement>('[data-testid="timeline-float-edit"]')
  await act(async () => {
    editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  const editFloat = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')
  expect(editFloat?.dataset.floatMode).toBe('edit')
  return editFloat!
}

async function renderTimeline(): Promise<void> {
  await act(async () => {
    root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
  })
  await act(async () => {
    await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
  })
  // 初始适配同样在 rAF 之后；先让它落定，后面的断言才量的是稳定视口。
  await settleCanvas(120)
}

beforeEach(() => {
  // 时间线的界面偏好按项目存在 localStorage 里：测试之间必须清空，
  // 否则上一个用例保存的视口会被下一个用例当成“恢复视口”加载。
  window.localStorage.clear()
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1 })
  useCharacterStore.setState({
    ...originalCharacterState,
    characters: [{ ...EMPTY_CARD, name: '许渡' }],
    selectedName: null,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    loadingProjectKey: null,
    loadingProjectSession: null,
    lastError: null,
  })
  useLayoutStore.setState({ ...originalLayoutState, sidebarView: 'project', characterViewRequest: null })
  useStoryTimelineStore.setState({ ...originalTimelineState, events: [], settings, dataProjectKey: null, loading: false })
  useWorldMapStore.setState({ ...originalWorldMapState, maps: [], nodes: [], edges: [], migration: null, loading: false })
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:timeline-get-all') return { settings, events: timelineEvents }
    if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
    // setLocale 会持久化语言偏好；这里只需成功，避免切换被回滚。
    if (channel === 'config:set') return { success: true }
    return { success: false, error: `unexpected channel ${channel}` }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })

  container = document.createElement('div')
  // React Flow 需要可测量的视口尺寸。
  container.style.width = '1200px'
  container.style.height = '900px'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
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

describe('story timeline horizontal axis', () => {
  it('lays events out from left to right by sortOrder on a continuous axis', async () => {
    await renderTimeline()

    const ordered = labelsInSortOrder()
    const lefts = ordered.map(entry => entry.element.getBoundingClientRect().left)
    for (let index = 1; index < lefts.length; index++) {
      expect(lefts[index], `${ordered[index].eventId} must sit right of ${ordered[index - 1].eventId}`)
        .toBeGreaterThan(lefts[index - 1])
    }

    const axis = container.querySelector('[data-testid="timeline-axis"]')
    expect(axis).not.toBeNull()
    const axisRect = axis!.getBoundingClientRect()
    expect(axisRect.width).toBeGreaterThan(0)
    // 每个主轴事件都有轴点与竖直短茎。
    expect(container.querySelectorAll('[data-testid="timeline-axis-dot"]').length).toBe(timelineEvents.length)
    expect(container.querySelectorAll('.writer-timeline-connector').length).toBe(timelineEvents.length)
  })

  it('alternates event labels above and below the axis and staggers dense same-side labels', async () => {
    await renderTimeline()

    const ordered = labelsInSortOrder()
    expect(ordered.map(entry => entry.element.dataset.side))
      .toEqual(['above', 'below', 'above', 'below', 'above'])

    const axisRect = container.querySelector('[data-testid="timeline-axis"]')!.getBoundingClientRect()
    const above = ordered.filter(entry => entry.element.dataset.side === 'above')
    const below = ordered.filter(entry => entry.element.dataset.side === 'below')
    for (const entry of above) expect(entry.element.getBoundingClientRect().top).toBeLessThan(axisRect.top)
    for (const entry of below) expect(entry.element.getBoundingClientRect().top).toBeGreaterThan(axisRect.top)

    // 本组刻度间隔足够，不产生错开层。
    expect(ordered.map(entry => entry.element.dataset.staggerLevel)).toEqual(['0', '0', '0', '0', '0'])
  })

  it('shows time, title, two-line description and chapter meta on nodes, but never characters', async () => {
    await renderTimeline()

    const range = labelFor('e3')
    expect(range.querySelector('.writer-timeline-label-time')?.textContent)
      .toBe('大荒历 313 年 — 大荒历 315 年')
    expect(range.querySelector('.writer-timeline-label-title')?.textContent).toBe('隧道封锁期')

    // 画布节点显示描述（浮窗看全文）与关联章节；角色/地点只留在浮窗里。
    const axisText = labels().map(label => label.textContent ?? '').join(' | ')
    expect(axisText).toContain('仅在详情浮窗可见的完整描述')
    expect(axisText).toContain('第3、4章')
    expect(axisText).not.toContain('沈砚')
    expect(axisText).not.toContain('loc-1')
    // 自定义时间与标题本身必须显示。
    expect(axisText).toContain('大荒历 312 年')
    expect(axisText).toContain('雾港调查')
    expect(axisText).toContain('许渡归来')
    // 统计不把主线误算为支线。
    expect(container.textContent).toContain('5 个事件 · 0 条支线')
  })

  it('selects an event on click and opens the in-canvas float editor for details', async () => {
    await renderTimeline()

    await clickLabel('e2')
    expect(labelFor('e2').className).toContain('is-selected')

    await clickLabel('e5')
    expect(labelFor('e5').className).toContain('is-selected')
    expect(labelFor('e2').className).not.toContain('is-selected')

    // 右键详情浮窗 → 「编辑事件」进入浮窗内编辑态
    await openEditFloat('e2')
    expect((formField('自定义时间') as HTMLInputElement).value).toBe('大荒历 312 年')
    expect((formField('排列位置') as HTMLInputElement).value).toBe('20')
    expect((formField('事件描述') as HTMLTextAreaElement).value).toBe('仅在详情浮窗可见的完整描述')
    // 关联章节与角色改用结构化选择器：已保存的真实关联以 chip 呈现
    expect(Array.from(container.querySelectorAll(
      '[data-testid="timeline-chapter-chip"] .writer-timeline-assoc-chip-label',
    )).map(node => node.textContent)).toEqual(['第3章', '第4章'])
    expect(Array.from(container.querySelectorAll(
      '[data-testid="timeline-character-chip"] .writer-timeline-assoc-chip-label',
    )).map(node => node.textContent)).toEqual(['沈砚'])

    // 点击关闭按钮关闭浮窗
    const closeBtn = container.querySelector('.writer-timeline-float-close')
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()
  })

  it('keeps events non-draggable while the axis itself can pan and zoom', async () => {
    await renderTimeline()

    // 位置永远由 sortOrder 计算，事件不可自由拖动。
    for (const node of container.querySelectorAll('.react-flow__node')) {
      expect(node.className).not.toContain('draggable')
    }
    // 画布本身保留平移与缩放表面。
    expect(container.querySelector('.react-flow__viewport')).not.toBeNull()
    expect(container.querySelector('.react-flow__controls')).not.toBeNull()

    // 标注位置没有被写回事件事实。
    for (const event of useStoryTimelineStore.getState().events) {
      expect(Object.keys(event)).not.toContain('position')
      expect(Object.keys(event)).not.toContain('side')
    }
  })

  it('opens the details float with real actions on right click of an event', async () => {
    await renderTimeline()

    await rightClickLabel('e1')
    const float = container.querySelector('[data-testid="timeline-event-float"]')
    expect(float).not.toBeNull()
    // 详情与真实操作入口都在浮窗内；单击选中绝不自动弹出浮窗。
    expect(float?.textContent).toContain('末班车驶出地图')
    expect(float?.textContent).toContain('编辑事件')
    expect(float?.textContent).toContain('创建支线')
    expect(float?.textContent).toContain('添加后续事件')
    expect(float?.textContent).toContain('删除事件')

    // 在此创建支线 -> 打开分叉支线模态窗
    const branchButton = float!.querySelector<HTMLButtonElement>('[data-testid="timeline-float-create-branch"]')
    await act(async () => {
      branchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('创建新支线事件')
    // 支线名称必填且不预填：不允许静默兜底成「支线」
    expect((formField('支线名称') as HTMLInputElement).value).toBe('')

    // 关闭弹窗
    const closeBtn = container.querySelector('.writer-timeline-modal-close')
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
  })

  it('creates a branch atomically from the float and shows it immediately', async () => {
    const savedEvents = [...timelineEvents]
    const savedBranches: Array<Record<string, unknown>> = []
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:timeline-get-all') return { settings, branches: savedBranches, events: savedEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-branch-create-with-event') {
        const [branch, event] = args as [Record<string, unknown>, StoryTimelineEvent]
        savedBranches.push(branch)
        savedEvents.push(event)
        return { success: true, branch, event }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })

    await renderTimeline()
    await rightClickLabel('e1')
    const branchButton = container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-create-branch"]')
    await act(async () => {
      branchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('创建新支线事件')
    await act(async () => {
      setInputValue(formField('支线名称'), '雾港暗线')
      setInputValue(formField('事件标题'), '反派潜入雾港')
    })
    const saveButton = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(button => button.textContent?.includes('保存事件'))
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(savedBranches).toHaveLength(1))
      await vi.waitFor(() => expect(useStoryTimelineStore.getState().events.some(event => event.title === '反派潜入雾港')).toBe(true))
    })
    // 支线与首事件必须是一次原子提交到达同一个通道。
    expect(savedBranches[0].sourceEventId).toBe('e1')
    expect(savedBranches[0].name).toBe('雾港暗线')
    expect(labels().some(label => label.textContent?.includes('反派潜入雾港'))).toBe(true)
    // 统计把新支线计入支线数。
    await vi.waitFor(() => expect(container.textContent).toContain('6 个事件 · 1 条支线'))
  })

  it('renders mention chips inside the float editor when description contains mentions', async () => {
    const eventWithMentions = makeEvent({
      id: 'e-mention',
      sortOrder: 15,
      title: '暗河密会',
      timeLabel: '大荒历 311 年',
      description: '@许渡 正在调查 [[雾港]] 的暗线',
    })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return { settings, events: [...timelineEvents, eventWithMentions] }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({
      events: [...timelineEvents, eventWithMentions],
    })
    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().some(l => l.dataset.eventId === 'e-mention')).toBe(true))
    })

    await openEditFloat('e-mention')
    const mentionBar = container.querySelector('[data-testid="timeline-mentions-bar"]')
    expect(mentionBar).not.toBeNull()
    const tags = Array.from(container.querySelectorAll('[data-testid="timeline-mention-tag"]'))
    expect(tags.map(t => t.textContent?.trim())).toEqual(expect.arrayContaining(['@许渡', '[[雾港]]']))

    const xuDu = tags.find(tag => tag.textContent?.includes('@许渡')) as HTMLButtonElement | undefined
    expect(xuDu).toBeDefined()
    expect(useProjectStore.getState().currentProject?.path).toBe(PROJECT_PATH)
    expect(useCharacterStore.getState().characters.map(character => character.name)).toContain('许渡')
    await act(async () => {
      xuDu?.click()
    })
    expect(useCharacterStore.getState().selectedName).toBe('许渡')
    expect(useLayoutStore.getState().sidebarView).toBe('characters')
    expect(useLayoutStore.getState().characterViewRequest?.view).toBe('edit')

    // 关闭浮窗
    const closeBtn = container.querySelector('.writer-timeline-float-close')
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  })

  it('supports branch expansion toggle via branch badge', async () => {
    // 注入一条带有支线的数据
    const branchEvent = makeEvent({
      id: 'e-sub-1',
      branchId: 'branch-test-1',
      parentEventId: 'e2',
      sortOrder: 25,
      title: '支线：暗河密会',
      timeLabel: '大荒历 312 年冬',
    })
    const branchData = {
      settings,
      events: [...timelineEvents, branchEvent],
      branches: [
        { id: 'branch-test-1', name: '暗河支线', sourceEventId: 'e2', sortOrder: 1 },
      ],
    }
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({
      branches: branchData.branches,
      events: branchData.events,
      expandedBranchIds: [],
    })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
    })

    // 默认折叠：只显示主干 5 个事件，不显示支线事件
    expect(labels().some(l => l.dataset.eventId === 'e-sub-1')).toBe(false)

    // 存在分支徽标
    const badge = container.querySelector('[data-testid="timeline-branch-badge"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.textContent).toContain('1 支线')

    // 点击徽标展开
    await act(async () => {
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(useStoryTimelineStore.getState().expandedBranchIds).toContain('branch-test-1')
    await act(async () => {
      await vi.waitFor(() => expect(labels().some(l => l.dataset.eventId === 'e-sub-1')).toBe(true))
    })
  })

  it('previews cascade impact before deleting an event with downstream branches', async () => {
    const branchEvent = makeEvent({
      id: 'e-sub-1',
      branchId: 'branch-test-1',
      parentEventId: 'e2',
      sortOrder: 25,
      title: '支线：暗河密会',
      timeLabel: '大荒历 312 年冬',
    })
    const branchData = {
      settings,
      events: [...timelineEvents, branchEvent],
      branches: [
        { id: 'branch-test-1', name: '暗河支线', sourceEventId: 'e2', sortOrder: 1 },
      ],
    }
    // 权威影响来自主进程：这里用与主进程同形的载荷，验证页面确实消费它，
    // 并且提交删除时回传的是这份预览的指纹。
    const preview = {
      kind: 'event' as const,
      targetId: 'e2',
      targetLabel: '雾港调查',
      eventIds: ['e2', 'e-sub-1'],
      branchIds: ['branch-test-1'],
      branchNames: ['暗河支线'],
      eventCount: 2,
      branchCount: 1,
      fingerprint: 'fp-event-e2',
    }
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-event-delete-preview') return { success: true, preview }
      if (channel === 'db:timeline-event-delete-confirmed') {
        return { success: true, deletedEventIds: preview.eventIds, deletedBranchIds: preview.branchIds }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({
      branches: branchData.branches,
      events: branchData.events,
      expandedBranchIds: ['branch-test-1'],
    })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().some(l => l.dataset.eventId === 'e-sub-1')).toBe(true))
    })

    await rightClickLabel('e2')
    // 浮窗一打开就取权威预览，展示的必须是与主进程一致的级联结果。
    await act(async () => {
      await vi.waitFor(() => expect(
        invoke.mock.calls.some(call => call[0] === 'db:timeline-event-delete-preview'),
      ).toBe(true))
    })
    const deleteButton = container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-delete"]')
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 删除前给出完整级联影响：支线与其事件都会被连带删除。
    const confirm = container.querySelector('[data-testid="timeline-float-delete-confirm"]')
    expect(confirm?.textContent).toContain('暗河支线')

    // 取消不删除
    const cancel = Array.from(confirm!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('取消'))
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(invoke.mock.calls.some(call => call[0] === 'db:timeline-event-delete-confirmed')).toBe(false)

    // 确认后按指纹删除，并按返回的 ID 集合就地清理（不整页重读）
    const deleteAgain = container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-delete"]')
    await act(async () => {
      deleteAgain?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const confirmBlock = container.querySelector('[data-testid="timeline-float-delete-confirm"]')
    expect(confirmBlock).not.toBeNull()
    const confirmDelete = Array.from(confirmBlock!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认删除'))
    await act(async () => {
      confirmDelete?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(labels().some(l => l.dataset.eventId === 'e2')).toBe(false))
    })
    expect(labels().some(l => l.dataset.eventId === 'e-sub-1')).toBe(false)
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()
    const confirmedCall = invoke.mock.calls.find(call => call[0] === 'db:timeline-event-delete-confirmed')
    expect(confirmedCall?.[1]).toBe('e2')
    expect(confirmedCall?.[2]).toBe('fp-event-e2')
  })

  it('keeps the existing loading and renders canvas-centric empty-timeline states with anchors', async () => {
    useStoryTimelineStore.setState({ events: [], dataProjectKey: null, loading: true })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return new Promise(() => {})
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      return { success: false, error: `unexpected channel ${channel}` }
    })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    expect(container.textContent).toContain('正在读取项目时间线')

    useStoryTimelineStore.setState({ events: [], dataProjectKey: PROJECT_PATH, loading: false })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-flow"]')).not.toBeNull())
    })
    expect(labels().length).toBe(0)
    // 呈现纸面画布与故事开端、结束锚点，没有大号占位按钮
    expect(container.querySelector('[data-testid="timeline-anchor-start"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-anchor-end"]')).not.toBeNull()
    expect(container.textContent).toContain('故事开端')
    expect(container.textContent).toContain('故事结束')
    expect(container.textContent).not.toContain('从第一个故事事件开始')
    // 刻度设置与查看全部入口始终可用
    expect(container.textContent).toContain('刻度设置')
    expect(container.textContent).toContain('查看全部')
  })

  it('closes the event float cleanly and guards unsaved edits from silent loss', async () => {
    await renderTimeline()

    // 1. 详情浮窗：Escape 关闭并把焦点还给节点
    await rightClickLabel('e2')
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()

    // 2. 点击浮窗外关闭
    await rightClickLabel('e5')
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()

    // 3. 编辑态有修改时，Escape 先给“继续编辑 / 放弃修改”，不静默丢弃
    await openEditFloat('e2')
    await act(async () => {
      setInputValue(formField('事件标题'), '改名后的雾港调查')
    })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const discard = container.querySelector('[data-testid="timeline-float-discard-confirm"]')
    expect(discard).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()

    // 继续编辑：确认条消失，输入仍在
    const keepEditing = Array.from(discard!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('继续编辑'))
    await act(async () => {
      keepEditing?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-float-discard-confirm"]')).toBeNull()
    expect((formField('事件标题') as HTMLInputElement).value).toBe('改名后的雾港调查')

    // 放弃修改：浮窗关闭，事件数据不变
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    const discardAgain = container.querySelector('[data-testid="timeline-float-discard-confirm"]')
    const discardButton = Array.from(discardAgain!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('放弃修改'))
    await act(async () => {
      discardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()
    expect(useStoryTimelineStore.getState().events.find(event => event.id === 'e2')?.title).toBe('雾港调查')
  })

  it('keeps the float open with the error visible when saving fails', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return { settings, events: timelineEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-event-upsert') return { success: false, error: '数据库写入失败' }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    await renderTimeline()

    await openEditFloat('e2')
    await act(async () => {
      setInputValue(formField('事件标题'), '写入必须失败')
    })
    const saveButton = container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-save"]')
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 失败：浮窗仍在编辑态、输入保留、错误可见
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()
    expect((container.querySelector('[data-testid="timeline-event-float"]') as HTMLElement)?.dataset.floatMode).toBe('edit')
    expect((formField('事件标题') as HTMLInputElement).value).toBe('写入必须失败')
    expect(container.querySelector('.writer-timeline-field-error')?.textContent).toContain('数据库写入失败')
    expect(useStoryTimelineStore.getState().events.find(event => event.id === 'e2')?.title).toBe('雾港调查')
  })

  it('supports right clicking blank canvas to create event with prefilled sortOrder', async () => {
    await renderTimeline()

    await rightClickCanvas()

    const menu = container.querySelector('.writer-timeline-context-menu')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('在此创建事件')

    const createItem = Array.from(menu!.querySelectorAll('.writer-timeline-context-item'))
      .find(el => el.textContent?.includes('在此创建事件'))
    await act(async () => {
      createItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const modal = container.querySelector('.writer-timeline-modal')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('新建主线事件')
    const sortOrderInput = formField('排列位置') as HTMLInputElement
    expect(sortOrderInput.value).toBeTruthy()

    // 取消关闭
    const cancelBtn = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(b => b.textContent?.includes('取消'))
    await act(async () => {
      cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
  })

  it('keeps newly appended events inside the visible canvas', async () => {
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:timeline-get-all') return { settings, events: timelineEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-event-upsert') return { success: true, event: args[0] }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    await renderTimeline()
    let source = 'e2'
    for (let index = 0; index < 3; index++) {
      await rightClickLabel(source)
      await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-create-next"]')!.click())
      await act(async () => setInputValue(formField('事件标题'), `后续事件 ${index}`))
      const save = Array.from(container.querySelectorAll<HTMLButtonElement>('.writer-timeline-modal button')).find(button => button.textContent?.includes('保存事件'))!
      await act(async () => save.click())
      await act(async () => { await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length + index + 1)) })
      await settleCanvas(400)
      const event = useStoryTimelineStore.getState().events.find(item => item.title === `后续事件 ${index}`)!
      source = event.id
      const rect = labelFor(source).getBoundingClientRect()
      const pane = container.querySelector<HTMLElement>('.react-flow__pane')!.getBoundingClientRect()
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.right).toBeGreaterThan(pane.left)
      expect(rect.left).toBeLessThan(pane.right)
      expect(rect.bottom).toBeGreaterThan(pane.top)
      expect(rect.top).toBeLessThan(pane.bottom)
      expect(container.querySelector('.react-flow__viewport')?.getAttribute('style')).not.toMatch(/NaN|Infinity/)
    }
  })

  it('keeps the canvas and its anchors visible after saving the first event from an empty timeline', async () => {
    const savedEvents: StoryTimelineEvent[] = []
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:timeline-get-all') return { settings, branches: [], events: savedEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-event-upsert') {
        savedEvents.push(args[0] as StoryTimelineEvent)
        return { success: true, event: args[0] }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({
      events: [],
      branches: [],
      settings,
      dataProjectKey: PROJECT_PATH,
      loading: false,
    })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-anchor-start"]')).not.toBeNull())
    })

    await rightClickCanvas()
    const createItem = Array.from(container.querySelectorAll('.writer-timeline-context-item'))
      .find(element => element.textContent?.includes('在此创建事件'))
    await act(async () => {
      createItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      setInputValue(formField('事件标题'), '第一次相遇')
      setInputValue(formField('自定义时间'), '第 1 年')
    })
    const saveButton = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(button => button.textContent?.includes('保存事件'))
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(1))
    })
    const flow = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')
    const startAnchor = container.querySelector<HTMLElement>('[data-testid="timeline-anchor-start"]')
    const endAnchor = container.querySelector<HTMLElement>('[data-testid="timeline-anchor-end"]')
    const eventLabel = labels()[0]

    expect(flow).not.toBeNull()
    expect(startAnchor).not.toBeNull()
    expect(endAnchor).not.toBeNull()
    // 回归保护：不只检查 DOM 仍存在；节点必须完成实际浏览器布局，不能
    // 因为保存后视口或节点测量失步而落入一整片空白画布。
    expect(startAnchor!.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(endAnchor!.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(eventLabel.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(eventLabel.getBoundingClientRect().height).toBeGreaterThan(0)
  })

  it('opens the float editor via keyboard: Enter for details, Escape returns focus', async () => {
    await renderTimeline()

    const label = labelFor('e2')
    label.focus()
    await act(async () => {
      label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    const float = container.querySelector('[data-testid="timeline-event-float"]')
    expect(float).not.toBeNull()
    expect(float?.getAttribute('data-float-mode')).toBe('details')

    // Shift+F10 同样打开操作浮窗（先关掉前一个）
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()

    await act(async () => {
      label.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()

    // Escape 关闭后焦点回到触发节点
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()
    expect(document.activeElement?.getAttribute('data-event-id')).toBe('e2')
  })

  it('collapses the events sidebar and brings it back with an always-visible expand button', async () => {
    await renderTimeline()

    expect(container.querySelector('.planning-pane')).not.toBeNull()
    // 默认展开：收起按钮就是真实入口
    const collapse = container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-collapse"]')
    expect(collapse).not.toBeNull()

    // 先选中一个事件并写下筛选，收起后这些状态都不能丢
    await clickLabel('e2')
    const search = container.querySelector<HTMLInputElement>('.planning-pane__search input')
    await act(async () => {
      setInputValue(search!, '雾港')
    })
    const widthBefore = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')!.getBoundingClientRect().width
    const zoomBefore = canvasZoom()
    expect(Number.isFinite(zoomBefore)).toBe(true)

    await act(async () => {
      collapse?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleCanvas(160)

    // 收起后清单消失、画布仍在并吃掉释放出来的宽度，展开按钮可见
    expect(container.querySelector('.planning-pane')).toBeNull()
    const expand = container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-expand"]')
    expect(expand).not.toBeNull()
    const flow = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')!
    expect(flow).not.toBeNull()
    expect(flow.getBoundingClientRect().width).toBeGreaterThan(widthBefore)
    // 收起侧栏只改变可用宽度，绝不重新适配或把画布跳回原点
    expect(canvasZoom()).toBeCloseTo(zoomBefore, 2)
    // 展开按钮悬浮在画布上，不是占据布局宽度的空白列
    expect(expand!.parentElement?.className).toContain('timeline-workbench__canvas-shell')
    expect(labelFor('e2').className).toContain('is-selected')

    await act(async () => {
      expand?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.planning-pane')).not.toBeNull()
    // 筛选与选中在收起/展开之间保持
    expect(container.querySelector<HTMLInputElement>('.planning-pane__search input')?.value).toBe('雾港')
    expect(labelFor('e2').className).toContain('is-selected')

    // 折叠状态按项目持久化
    expect(readTimelineUiPrefs(PROJECT_PATH)?.sidebarCollapsed).toBe(false)
  })

  it('renders story start and end anchors and allows opening range modal on right click', async () => {
    await renderTimeline()

    const startAnchor = container.querySelector('[data-testid="timeline-anchor-start"]') as HTMLElement
    const endAnchor = container.querySelector('[data-testid="timeline-anchor-end"]') as HTMLElement
    expect(startAnchor).not.toBeNull()
    expect(endAnchor).not.toBeNull()
    expect(startAnchor.textContent).toContain('故事开端')
    expect(endAnchor.textContent).toContain('故事结束')
    // 不再展示开发式 [刻度] 标签
    expect(startAnchor.textContent).not.toContain('[0]')

    // 右键开端锚点
    await act(async () => {
      startAnchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    })
    const menu = container.querySelector('.writer-timeline-context-menu')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('编辑故事开端')
    expect(menu?.textContent).toContain('设置故事范围')

    // 点击设置故事范围
    const rangeOption = Array.from(menu!.querySelectorAll('.writer-timeline-context-item'))
      .find(el => el.textContent?.includes('设置故事范围'))
    await act(async () => {
      rangeOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('设置故事范围与刻度')
    const startInput = container.querySelector('input[placeholder="故事开端"]') as HTMLInputElement
    const endInput = container.querySelector('input[placeholder="故事结束"]') as HTMLInputElement
    expect(startInput.value).toBe('故事开端')
    expect(endInput.value).toBe('故事结束')

    // 关闭范围弹窗
    const closeBtn = container.querySelector('.writer-timeline-modal-close')
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
  })

  it('keeps the toolbar entries real and only enables locating when something is selected', async () => {
    await renderTimeline()

    const newEvent = container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-new-event"]')
    const locate = container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-focus-selected"]')
    const viewAll = container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-fit-all"]')
    const ruler = container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-ruler"]')
    expect(newEvent).not.toBeNull()
    expect(locate).not.toBeNull()
    expect(viewAll).not.toBeNull()
    expect(ruler).not.toBeNull()
    // 没有选中时「定位选中」必须禁用，而不是假装可用
    expect(locate!.disabled).toBe(true)

    await clickLabel('e3')
    expect(container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-focus-selected"]')!.disabled).toBe(false)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-fit-all"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(labelFor('e3').className).toContain('is-selected')
  })

  it('groups the sidebar by main line and branches, showing empty branches and protecting main', async () => {
    const nestedEvent = makeEvent({ id: 'n1', branchId: 'branch-child', sortOrder: 26, title: '嵌套支线事件' })
    const branchData = {
      settings,
      events: [...timelineEvents, nestedEvent],
      branches: [
        { id: 'branch-empty', name: '空支线', sourceEventId: 'e1', sortOrder: 1 },
        { id: 'branch-child', name: '嵌套支线', sourceEventId: 'e2', sortOrder: 2 },
      ],
    }
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ branches: branchData.branches, events: branchData.events, expandedBranchIds: ['main'] })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
    })

    const groups = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="timeline-branch-group"]'))
    expect(groups.map(group => group.dataset.branchId)).toEqual(['main', 'branch-empty', 'branch-child'])

    // 主线是核心基准：没有重命名/删除入口
    const mainGroup = groups[0]
    expect(mainGroup.querySelector('[data-testid="timeline-branch-rename"]')).toBeNull()
    expect(mainGroup.querySelector('[data-testid="timeline-branch-delete"]')).toBeNull()

    // 真实存在但没有事件的支线仍然可见，并有真实的支线操作入口
    const emptyGroup = groups[1]
    expect(emptyGroup.querySelector('[data-testid="timeline-branch-empty"]')).not.toBeNull()
    expect(emptyGroup.querySelector('[data-testid="timeline-branch-rename"]')).not.toBeNull()
    expect(emptyGroup.querySelector('[data-testid="timeline-branch-add-event"]')).not.toBeNull()
    expect(emptyGroup.querySelector('[data-testid="timeline-branch-delete"]')).not.toBeNull()

    // 统计口径与筛选说明都写在侧栏里
    expect(container.textContent).toContain('2 条支线')
    expect(container.textContent).toContain('显示 6 / 6 个事件')
    expect(container.querySelector('[data-testid="timeline-filter-scope-note"]')?.textContent)
      .toContain('画布始终显示全部事件')

    // 筛选只作用列表：按状态筛掉全部后，画布上的事件一个都不少
    const plannedChip = Array.from(container.querySelectorAll<HTMLButtonElement>('.planning-chip'))
      .find(chip => chip.textContent?.includes('已定稿'))
    await act(async () => {
      plannedChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('显示 1 / 6 个事件')
    expect(labels().length).toBe(timelineEvents.length)
  })

  it('locates a nested event by expanding every ancestor branch, not only its own', async () => {
    const parentEvent = makeEvent({ id: 'a1', branchId: 'branch-parent', parentEventId: 'e2', sortOrder: 21, title: '父支线事件' })
    const childEvent = makeEvent({ id: 'b1', branchId: 'branch-child', parentEventId: 'a1', sortOrder: 22, title: '子支线事件' })
    const branchData = {
      settings,
      events: [...timelineEvents, parentEvent, childEvent],
      branches: [
        { id: 'branch-parent', name: '父支线', sourceEventId: 'e2', sortOrder: 1 },
        { id: 'branch-child', name: '子支线', sourceEventId: 'a1', sortOrder: 2 },
      ],
    }
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ branches: branchData.branches, events: branchData.events, expandedBranchIds: ['main'] })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
    })
    // 两层支线都折叠时，画布上只有主线事件
    expect(labels().some(label => label.dataset.eventId === 'b1')).toBe(false)

    const row = container.querySelector<HTMLButtonElement>('[data-testid="timeline-event-row:b1"]')
    expect(row).not.toBeNull()
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 目标自身与全部祖先都被展开
    await act(async () => {
      await vi.waitFor(() => expect(labels().some(label => label.dataset.eventId === 'b1')).toBe(true))
    })
    // 等定位动画结束再量缩放
    await settleCanvas(320)
    expect(useStoryTimelineStore.getState().expandedBranchIds).toEqual(
      expect.arrayContaining(['branch-parent', 'branch-child']),
    )
    expect(labelFor('b1').className).toContain('is-selected')
    // 定位必须落在可读比例上，不能在极小缩放下停在看着像空白的位置
    expect(canvasZoom()).toBeGreaterThanOrEqual(0.85)
  })

  it('renames a branch through the real store while keeping its fork source', async () => {
    const branchData = {
      settings,
      events: timelineEvents,
      branches: [{ id: 'branch-rename', name: '旧名字', sourceEventId: 'e2', sortOrder: 1 }],
    }
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-branch-upsert') {
        const branch = args[0] as Record<string, unknown>
        return { success: true, branch }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ branches: branchData.branches, events: branchData.events, expandedBranchIds: ['main'] })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
    })

    const renameButton = container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-rename"]')
    await act(async () => {
      renameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = container.querySelector<HTMLInputElement>('[data-testid="timeline-branch-rename-input"]')
    expect(input?.value).toBe('旧名字')
    await act(async () => {
      setInputValue(input!, '新名字')
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-rename-save"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(
        useStoryTimelineStore.getState().branches.find(branch => branch.id === 'branch-rename')?.name,
      ).toBe('新名字'))
    })
    // 重命名必须带上真实的分叉来源，不能把支线变回主线
    const upsert = invoke.mock.calls.find(call => call[0] === 'db:timeline-branch-upsert')
    expect((upsert?.[1] as Record<string, unknown>).sourceEventId).toBe('e2')
    expect((upsert?.[1] as Record<string, unknown>).id).toBe('branch-rename')
  })

  it('previews the cascade impact before deleting a branch and keeps context on failure', async () => {
    const parentEvent = makeEvent({ id: 'a1', branchId: 'branch-parent', parentEventId: 'e2', sortOrder: 21, title: '父支线事件' })
    const childEvent = makeEvent({ id: 'b1', branchId: 'branch-child', parentEventId: 'a1', sortOrder: 22, title: '子支线事件' })
    const branchData = {
      settings,
      events: [...timelineEvents, parentEvent, childEvent],
      branches: [
        { id: 'branch-parent', name: '父支线', sourceEventId: 'e2', sortOrder: 1 },
        { id: 'branch-child', name: '子支线', sourceEventId: 'a1', sortOrder: 2 },
      ],
    }
    const preview = {
      kind: 'branch' as const,
      targetId: 'branch-parent',
      targetLabel: '父支线',
      eventIds: ['a1', 'b1'],
      branchIds: ['branch-parent', 'branch-child'],
      branchNames: ['父支线', '子支线'],
      eventCount: 2,
      branchCount: 2,
      fingerprint: 'fp-branch-parent',
    }
    // 第一次确认：主进程报告影响集合已经变化，必须重新确认；
    // 第二次确认才真的删除。
    let confirmAttempts = 0
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-branch-delete-preview') return { success: true, preview }
      if (channel === 'db:timeline-branch-delete-confirmed') {
        confirmAttempts += 1
        if (confirmAttempts === 1) {
          return {
            success: false,
            error: 'need reconfirmation',
            needsReconfirmation: true,
            preview: { ...preview, eventCount: 3, branchCount: 2, fingerprint: 'fp-branch-parent-v2' },
          }
        }
        return { success: true, deletedEventIds: preview.eventIds, deletedBranchIds: preview.branchIds }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ branches: branchData.branches, events: branchData.events, expandedBranchIds: ['main'] })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
    })

    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="timeline-branch-delete"]'))
      .find(button => button.dataset.branchId === 'branch-parent')
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-branch-delete-impact"]')).not.toBeNull())
    })

    // 影响预览必须是主进程的精确计数，且包含嵌套支线
    const impact = container.querySelector('[data-testid="timeline-branch-delete-impact"]')
    expect(impact?.textContent).toContain('将删除 2 个事件、2 条支线')
    expect(impact?.textContent).toContain('父支线')
    expect(impact?.textContent).toContain('子支线')

    // 取消：零写入
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-delete-cancel"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(invoke.mock.calls.some(call => call[0] === 'db:timeline-branch-delete-confirmed')).toBe(false)

    // 第一次确认：影响集合已变化 -> 保留确认区、换成最新影响重新确认，绝不静默扩大范围
    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-branch-delete-impact"]')).not.toBeNull())
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-delete-confirm-button"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(
        container.querySelector('[data-testid="timeline-branch-delete-impact"]')?.textContent,
      ).toContain('将删除 3 个事件、2 条支线'))
    })
    expect(container.querySelector('[data-testid="timeline-branch-delete-confirm"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-branch-delete-error"]')?.textContent)
      .toContain('请重新确认')
    expect(useStoryTimelineStore.getState().branches.some(branch => branch.id === 'branch-parent')).toBe(true)

    // 第二次确认：真删除，并按返回的 ID 集合就地清理
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-delete-confirm-button"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(
        useStoryTimelineStore.getState().branches.some(branch => branch.id === 'branch-parent'),
      ).toBe(false))
    })
    expect(useStoryTimelineStore.getState().branches.some(branch => branch.id === 'branch-child')).toBe(false)
    expect(useStoryTimelineStore.getState().events.some(event => event.id === 'a1')).toBe(false)
    // 确认成功后再取一次预览时用的仍是最新指纹
    expect(invoke.mock.calls.filter(call => call[0] === 'db:timeline-branch-delete-confirmed')[1]?.[2])
      .toBe('fp-branch-parent-v2')
  })

  it('keeps the branch delete confirmation open with the error when the preview fails', async () => {
    const branchData = {
      settings,
      events: timelineEvents,
      branches: [{ id: 'branch-broken', name: '受影响支线', sourceEventId: 'e2', sortOrder: 1 }],
    }
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') return branchData
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-branch-delete-preview') return { success: false, error: '数据库忙' }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ branches: branchData.branches, events: branchData.events, expandedBranchIds: ['main'] })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-delete"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-branch-delete-error"]')).not.toBeNull())
    })
    expect(container.querySelector('[data-testid="timeline-branch-delete-error"]')?.textContent).toContain('数据库忙')
    // 拿不到权威影响时不给确认按钮：绝不用猜出来的数字删数据
    expect(container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-delete-confirm-button"]')?.disabled)
      .toBe(true)
  })

  it('adds the first event to an empty branch through the real create form', async () => {
    const emptyBranch = { id: 'branch-empty', name: '空支线', sourceEventId: 'e2', sortOrder: 1 }
    const savedEvents = [...timelineEvents]
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:timeline-get-all') return { settings, branches: [emptyBranch], events: savedEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-event-upsert') {
        savedEvents.push(args[0] as StoryTimelineEvent)
        return { success: true, event: args[0] }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ branches: [emptyBranch], events: savedEvents, expandedBranchIds: ['main'] })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-branch-empty"]')).not.toBeNull())
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-branch-add-event"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('添加后续事件')
    await act(async () => {
      setInputValue(formField('事件标题'), '空支线的第一个事件')
      setInputValue(formField('自定义时间'), '大荒历 313 年')
    })
    const saveButton = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(button => button.textContent?.includes('保存事件'))
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      await vi.waitFor(() => expect(
        useStoryTimelineStore.getState().events.some(event => event.title === '空支线的第一个事件'),
      ).toBe(true))
    })
    // 新事件必须真的落在空支线上，而不是被悄悄塞回主线
    const created = useStoryTimelineStore.getState().events.find(event => event.title === '空支线的第一个事件')
    expect(created?.branchId).toBe('branch-empty')
  })

  it('restores the saved per-project viewport and sidebar state instead of re-fitting', async () => {
    writeTimelineUiPrefs(PROJECT_PATH, {
      sidebarCollapsed: true,
      selectedEventId: 'e2',
      canvas: { x: -140, y: 60, zoom: 1.3 },
    })

    await renderTimeline()

    // 画布停在保存的视口上，没有被初始适配覆盖
    const viewport = container.querySelector<HTMLElement>('.react-flow__viewport')
    expect(viewport?.style.transform).toContain('scale(1.3)')
    // 侧栏折叠与选中也按项目偏好恢复
    expect(container.querySelector('.planning-pane')).toBeNull()
    expect(container.querySelector('[data-testid="timeline-sidebar-expand"]')).not.toBeNull()
    expect(labelFor('e2').className).toContain('is-selected')
    // 浮窗绝不跨会话复用
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()

    const other = readTimelineUiPrefs('C:\\novels\\another-project')
    expect(other).toBeNull()
  })

  it('keeps the canvas on the approved visual language, not a wall of white cards', async () => {
    await renderTimeline()

    const label = labelFor('e1')
    const style = getComputedStyle(label)
    // 事件是轻量文字块：常态没有白色卡片底，也没有厚阴影
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(style.backgroundColor)
    expect(style.boxShadow).toBe('none')
    // 排版层级真实存在：时间 12–13px、标题 16–18px
    const timeSize = Number.parseFloat(getComputedStyle(label.querySelector('.writer-timeline-label-time')!).fontSize)
    const titleSize = Number.parseFloat(getComputedStyle(label.querySelector('.writer-timeline-label-title')!).fontSize)
    expect(timeSize).toBeGreaterThanOrEqual(12)
    expect(timeSize).toBeLessThanOrEqual(13.5)
    expect(titleSize).toBeGreaterThanOrEqual(15.5)
    expect(titleSize).toBeLessThanOrEqual(18.5)

    // 主轴是墨绿连续线，不是渐变或虚线
    const axisLine = container.querySelector<HTMLElement>('.writer-timeline-axis-line')!
    expect(getComputedStyle(axisLine).backgroundImage).toBe('none')
    expect(getComputedStyle(axisLine).borderStyle).not.toContain('dashed')

    // 选中态换底而不是加亮蓝外框
    await clickLabel('e1')
    const selected = getComputedStyle(labelFor('e1'))
    expect(selected.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(selected.outlineColor).not.toContain('0, 0, 255')

    // 画布是主题纸色，不是固定纯白
    const flow = getComputedStyle(container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')!)
    expect(flow.backgroundColor).not.toBe('rgb(255, 255, 255)')
    expect(flow.minWidth).toBe('0px')
  })

  it('never keeps a bottom detail panel or a second selection source', async () => {
    await renderTimeline()

    // 底部常驻详情：DOM 里没有任何底部详情容器，也不存在第二套选中状态
    expect(container.querySelector('.writer-timeline-detail')).toBeNull()
    expect(container.querySelector('[data-testid="timeline-bottom-detail"]')).toBeNull()
    await clickLabel('e2')
    expect(container.querySelectorAll('.writer-timeline-label.is-selected').length).toBe(1)

    // 只有一个画布实现（一套 React Flow），浮窗挂在画布内而不是全屏遮罩
    expect(container.querySelectorAll('.react-flow').length).toBe(1)
    await rightClickLabel('e2')
    const float = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')!
    expect(float.closest('[data-testid="timeline-flow"]')).not.toBeNull()
    // 浮窗不是模态遮罩：画布其它节点仍然可交互、可聚焦
    expect(float.getAttribute('aria-modal')).toBeNull()
    expect(container.querySelectorAll('.writer-timeline-label[tabindex="0"]').length).toBeGreaterThan(1)
  })

  it('rejects corrupted viewport preferences instead of injecting them', () => {
    window.localStorage.setItem('ai-novel-writer-timeline-ui-prefs', JSON.stringify({
      version: 1,
      projects: {
        [PROJECT_PATH]: {
          sidebarCollapsed: 'yes',
          selectedEventId: 42,
          canvas: { x: 'left', y: Number.NaN, zoom: 99 },
        },
      },
    }))
    const prefs = readTimelineUiPrefs(PROJECT_PATH)
    expect(prefs).not.toBeNull()
    expect(prefs?.sidebarCollapsed).toBe(false)
    expect(prefs?.selectedEventId).toBeNull()
    expect(prefs?.canvas).toBeNull()

    // 非法 zoom（超出 Scene 的 0.05–2 边界）同样被拒绝
    window.localStorage.setItem('ai-novel-writer-timeline-ui-prefs', JSON.stringify({
      version: 1,
      projects: { [PROJECT_PATH]: { sidebarCollapsed: true, selectedEventId: 'e2', canvas: { x: 0, y: 0, zoom: 0.001 } } },
    }))
    expect(readTimelineUiPrefs(PROJECT_PATH)?.canvas).toBeNull()
    expect(readTimelineUiPrefs(PROJECT_PATH)?.sidebarCollapsed).toBe(true)

    // 损坏的 JSON 不会让页面崩溃
    window.localStorage.setItem('ai-novel-writer-timeline-ui-prefs', '{not-json')
    expect(readTimelineUiPrefs(PROJECT_PATH)).toBeNull()
  })

  it('shows a retryable read failure instead of pretending the timeline is empty', async () => {
    let firstAttempt = true
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:timeline-get-all') {
        if (firstAttempt) {
          firstAttempt = false
          throw new Error('数据库暂时不可用')
        }
        return { settings, branches: [], events: [] }
      }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    useStoryTimelineStore.setState({ events: [], branches: [], dataProjectKey: null, loading: false })

    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-read-error"]')).not.toBeNull())
    })
    // 明确说明这不是空项目，并给出真实重试入口
    expect(container.textContent).toContain('读取故事时间线失败')
    expect(container.textContent).toContain('不代表你的时间线是空的')
    expect(container.textContent).not.toContain('时间线上还没有事件')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-read-retry"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-testid="timeline-flow"]')).not.toBeNull())
    })
    expect(container.querySelector('[data-testid="timeline-read-error"]')).toBeNull()
    expect(container.textContent).toContain('时间线上还没有事件')
  })

  it('never re-fits the canvas because of selection, filter or sidebar updates', async () => {
    await renderTimeline()

    await clickLabel('e2')
    await settleCanvas(120)
    const restingTransform = canvasTransform()
    expect(restingTransform).toContain('scale(')

    // 换选中：只换选中态，画布不动
    await clickLabel('e5')
    await settleCanvas(120)
    expect(labelFor('e5').className).toContain('is-selected')
    expect(canvasTransform()).toBe(restingTransform)

    // 改筛选：只影响列表
    const search = container.querySelector<HTMLInputElement>('.planning-pane__search input')
    await act(async () => {
      setInputValue(search!, '雾港')
    })
    await settleCanvas(120)
    expect(canvasTransform()).toBe(restingTransform)

    // 收起/展开侧栏：保持中心与 zoom，不跳回原点
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-collapse"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleCanvas(160)
    expect(canvasZoom()).toBeCloseTo(Number(/scale\(\s*([\d.]+)\s*\)/.exec(restingTransform)?.[1]), 2)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-expand"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleCanvas(160)
    expect(canvasZoom()).toBeCloseTo(Number(/scale\(\s*([\d.]+)\s*\)/.exec(restingTransform)?.[1]), 2)
  })

  it('provides fit view button and maintains canvas responsiveness without unexpected viewport resets', async () => {
    await renderTimeline()

    const fitBtn = container.querySelector<HTMLButtonElement>('[data-testid="timeline-toolbar-fit-all"]')
    expect(fitBtn).toBeDefined()
    await act(async () => {
      fitBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 画布与节点依然响应
    await clickLabel('e3')
    expect(labelFor('e3').className).toContain('is-selected')
  })

  it('renders the ruler settings section in both locales', async () => {
    await act(async () => {
      root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('刻度设置'))
    })

    const settingsButton = Array.from(container.querySelectorAll('button'))
      .find(button => (button.textContent ?? '').includes('刻度设置'))
    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('时间线名称')
    expect(container.textContent).toContain('刻度单位')
    expect(container.textContent).toContain('保存刻度')

    await act(async () => {
      // 真实的语言切换会刷新 locale readers，从而触发已挂载组件重渲染。
      await useLocaleStore.getState().setLocale('en-US')
    })
    expect(container.textContent).toContain('Timeline name')
    expect(container.textContent).toContain('Ruler unit')
    expect(container.textContent).toContain('Save ruler')
    expect(container.textContent).not.toContain('时间线名称')
  })
})

/**
 * 最终验收矩阵（交互与数据 1–10）中尚未覆盖的三项：
 * 浮窗四角钳制与浮窗内滚动不缩放、侧栏折叠保留筛选与缩放、保存后退重进一致。
 */
describe('story timeline final acceptance interactions', () => {
  /**
   * 从 .react-flow__viewport 读出 zoom 与流坐标中心。
   * 侧栏伸缩的正确行为是：zoom 与画布中心（流坐标）都不变，
   * translate x 随容器宽度做半差补偿——所以不能直接比较 transform 字符串。
   */
  function canvasViewportState(): { zoom: number; centerX: number; centerY: number } {
    const flow = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')
    const viewport = container.querySelector<HTMLElement>('.react-flow__viewport')
    expect(flow).not.toBeNull()
    expect(viewport).not.toBeNull()
    const rect = flow!.getBoundingClientRect()
    const matrix = new DOMMatrix(getComputedStyle(viewport!).transform)
    return {
      zoom: matrix.a,
      centerX: (rect.width / 2 - matrix.e) / matrix.a,
      centerY: (rect.height / 2 - matrix.f) / matrix.a,
    }
  }

  function floatRect(): DOMRect {
    const float = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')
    expect(float).not.toBeNull()
    return float!.getBoundingClientRect()
  }

  async function openFloatAt(clientX: number, clientY: number): Promise<void> {
    const node = labelFor('e1').closest('.react-flow__node') as HTMLElement
    await act(async () => {
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()
  }

  async function closeFloat(): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).toBeNull()
  }

  it('keeps the float inside the canvas at all four corners; scrolling inside never zooms the canvas', async () => {
    await renderTimeline()
    const flow = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')
    expect(flow).not.toBeNull()
    const flowRect = flow!.getBoundingClientRect()
    const zoomBefore = canvasViewportState().zoom

    const corners: Array<[number, number]> = [
      [flowRect.left + 2, flowRect.top + 2],
      [flowRect.right - 2, flowRect.top + 2],
      [flowRect.left + 2, flowRect.bottom - 2],
      [flowRect.right - 2, flowRect.bottom - 2],
    ]
    for (const [clientX, clientY] of corners) {
      await openFloatAt(clientX, clientY)
      const rect = floatRect()
      // 浮窗必须完整落在画布边界内（允许半像素舍入）。
      expect(rect.left).toBeGreaterThanOrEqual(flowRect.left - 0.5)
      expect(rect.top).toBeGreaterThanOrEqual(flowRect.top - 0.5)
      expect(rect.right).toBeLessThanOrEqual(flowRect.right + 0.5)
      expect(rect.bottom).toBeLessThanOrEqual(flowRect.bottom + 0.5)
      await closeFloat()
    }

    // 浮窗内滚动：画布 zoom 不变，浮窗保持打开
    await rightClickLabel('e2')
    const zoomBeforeScroll = canvasViewportState().zoom
    const float = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')!
    const rect = float.getBoundingClientRect()
    await act(async () => {
      float.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -240,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + rect.height / 2),
      }))
    })
    expect(container.querySelector('[data-testid="timeline-event-float"]')).not.toBeNull()
    expect(canvasViewportState().zoom).toBe(zoomBeforeScroll)
    await closeFloat()
    expect(canvasViewportState().zoom).toBe(zoomBefore)
  })

  it('preserves filters and canvas zoom across sidebar collapse and expand', async () => {
    await renderTimeline()
    const before = canvasViewportState()

    // 打开「已起草」状态筛选
    const draftedChip = Array.from(container.querySelectorAll<HTMLButtonElement>('button.planning-chip'))
      .find(button => button.textContent?.includes('已起草'))
    expect(draftedChip).toBeDefined()
    await act(async () => {
      draftedChip!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-sidebar-count"]')?.textContent ?? container.querySelector('.planning-pane__footer')?.textContent)
      .toContain('1')

    // 收起侧栏：zoom 与画布中心（流坐标）保持，没有跳回原点。
    // ResizeObserver 的中心补偿在布局后的下一帧执行，先等它落定再断言。
    const collapse = container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-collapse"]')
    await act(async () => {
      collapse?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleCanvas(240)
    expect(container.querySelector('[data-testid="timeline-event-sidebar"]')).toBeNull()
    const collapsed = canvasViewportState()
    expect(collapsed.zoom).toBe(before.zoom)
    expect(Math.abs(collapsed.centerX - before.centerX)).toBeLessThan(0.5)
    expect(Math.abs(collapsed.centerY - before.centerY)).toBeLessThan(0.5)

    // 展开：筛选与缩放都还在
    const expand = container.querySelector<HTMLButtonElement>('[data-testid="timeline-sidebar-expand"]')
    await act(async () => {
      expand?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settleCanvas(240)
    expect(container.querySelector('[data-testid="timeline-event-sidebar"]')).not.toBeNull()
    const expanded = canvasViewportState()
    expect(expanded.zoom).toBe(before.zoom)
    expect(Math.abs(expanded.centerX - before.centerX)).toBeLessThan(0.5)
    const activeChip = Array.from(container.querySelectorAll<HTMLButtonElement>('button.planning-chip'))
      .find(button => button.textContent?.includes('已起草'))
    expect(activeChip?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="timeline-sidebar-count"]')?.textContent ?? container.querySelector('.planning-pane__footer')?.textContent)
      .toContain('1')
  })

  it('keeps saved edits consistent after leaving and re-entering the timeline', async () => {
    const savedEvents: StoryTimelineEvent[] = timelineEvents.map(event => ({ ...event }))
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:timeline-get-all') return { settings, events: savedEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:blueprint-list-summary') return { volumes: [], chapterSummaries: [] }
      if (channel === 'db:timeline-event-upsert') {
        const incoming = args[0] as StoryTimelineEvent
        const index = savedEvents.findIndex(event => event.id === incoming.id)
        if (index >= 0) savedEvents[index] = incoming
        return { success: true, event: incoming }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })
    await renderTimeline()

    await openEditFloat('e2')
    // 旧关联在章节 picker 中保持（第3、4章），再通过搜索框补第 9 章
    const chapterChips = () => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="timeline-chapter-chip"]'))
      .map(chip => chip.textContent?.trim())
    expect(chapterChips()).toEqual(expect.arrayContaining(['第3章', '第4章']))
    const chapterSearch = container.querySelector<HTMLInputElement>('input[data-testid="timeline-chapter-search"]')
    expect(chapterSearch).toBeDefined()
    await act(async () => {
      setInputValue(chapterSearch!, '9')
      chapterSearch!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(chapterChips()).toEqual(expect.arrayContaining(['第3章', '第4章', '第9章']))
    await act(async () => {
      setInputValue(formField('事件标题'), '雾港调查（修订）')
    })
    const saveButton = container.querySelector<HTMLButtonElement>('[data-testid="timeline-float-save"]')
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 保存成功回到详情且保留在该事件上
    expect((container.querySelector('[data-testid="timeline-event-float"]') as HTMLElement)?.dataset.floatMode).toBe('details')
    expect(container.querySelector('[data-testid="timeline-event-float"]')?.textContent).toContain('雾港调查（修订）')

    // 退出重进：重新读取的数据与保存一致
    await act(async () => root.unmount())
    useStoryTimelineStore.setState({ ...originalTimelineState, events: [], settings, dataProjectKey: null, loading: false })
    root = createRoot(container)
    await renderTimeline()
    expect(labels().some(label => label.textContent?.includes('雾港调查（修订）'))).toBe(true)
    await openEditFloat('e2')
    expect((formField('事件标题') as HTMLInputElement).value).toBe('雾港调查（修订）')
    expect(chapterChips()).toEqual(expect.arrayContaining(['第3章', '第4章', '第9章']))
  })
})
