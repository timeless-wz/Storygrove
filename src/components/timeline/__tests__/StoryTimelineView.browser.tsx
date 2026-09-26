import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    description: '仅在详情面板可见的描述',
    chapterNumbers: [3, 4],
    // 角色名刻意不与任何标题重叠，便于断言时间轴上不出现关联信息。
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

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const nativeSet = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set
  nativeSet?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function formField(labelText: string): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(container.querySelectorAll('.writer-timeline-field, .writer-timeline-settings label'))
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
 * 画布右键必须按画布自身的矩形定位。
 *
 * 页面左侧现在是事件与支线清单，画布原点不再贴着窗口左边；写死的 clientX
 * 会落到清单上，触发不了画布上下文菜单。用矩形中心既与清单宽度无关，
 * 又始终落在故事起止锚点之间的主干区域内。
 */
async function rightClickCanvas(): Promise<void> {
  const flow = container.querySelector<HTMLElement>('[data-testid="timeline-flow"]')
  if (!flow) throw new Error('timeline flow is missing')
  const rect = flow.getBoundingClientRect()
  await act(async () => {
    flow.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }))
  })
}

async function rightClickLabel(eventId: string): Promise<void> {
  const element = labelFor(eventId)
  const node = (element.closest('.react-flow__node') as HTMLElement | null) ?? element
  await act(async () => {
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
  })
}

async function openEditModal(eventId: string): Promise<void> {
  await rightClickLabel(eventId)
  const menu = container.querySelector('.writer-timeline-context-menu')
  const editOption = Array.from(menu?.querySelectorAll('.writer-timeline-context-item') ?? [])
    .find(el => el.textContent?.includes('编辑事件'))
  await act(async () => {
    editOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function renderTimeline(): Promise<void> {
  await act(async () => {
    root.render(<StoryTimelineView projectKey={PROJECT_PATH} />)
  })
  await act(async () => {
    await vi.waitFor(() => expect(labels().length).toBe(timelineEvents.length))
  })
}

beforeEach(() => {
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
    // 每个事件都从主轴引出一条连接线。
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

  it('shows only the custom time and title on the axis, with start and end for range events', async () => {
    await renderTimeline()

    const range = labelFor('e3')
    expect(range.querySelector('.writer-timeline-label-time')?.textContent)
      .toBe('大荒历 313 年 — 大荒历 315 年')
    expect(range.querySelector('.writer-timeline-label-title')?.textContent).toBe('隧道封锁期')

    // 状态/描述/章节/角色/地点一律不出现在时间轴标注上。
    const axisText = labels().map(label => label.textContent ?? '').join(' | ')
    expect(axisText).not.toContain('仅在详情面板可见的描述')
    expect(axisText).not.toContain('已起草')
    expect(axisText).not.toContain('第3章')
    expect(axisText).not.toContain('沈砚')
    expect(axisText).not.toContain('loc-1')
    // 自定义时间与标题本身必须显示。
    expect(axisText).toContain('大荒历 312 年')
    expect(axisText).toContain('雾港调查')
    expect(axisText).toContain('许渡归来')
  })

  it('selects an event on click and opens floating modal editor to edit details', async () => {
    await renderTimeline()

    await clickLabel('e2')
    expect(labelFor('e2').className).toContain('is-selected')

    await clickLabel('e5')
    expect(labelFor('e5').className).toContain('is-selected')
    expect(labelFor('e2').className).not.toContain('is-selected')

    // 打开浮层编辑模态窗
    await openEditModal('e2')
    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('编辑事件')
    expect((formField('自定义时间') as HTMLInputElement).value).toBe('大荒历 312 年')
    expect((formField('排序刻度') as HTMLInputElement).value).toBe('20')
    expect((formField('事件描述') as HTMLTextAreaElement).value).toBe('仅在详情面板可见的描述')
    expect((formField('关联章节') as HTMLInputElement).value).toBe('3, 4')
    expect((formField('涉及角色') as HTMLInputElement).value).toBe('沈砚')

    // 点击关闭按钮关闭浮层
    const closeBtn = container.querySelector('.writer-timeline-modal-close')
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
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

  it('shows floating context menu on right click of node and canvas', async () => {
    await renderTimeline()

    // 节点右键
    await rightClickLabel('e1')
    const menu = container.querySelector('.writer-timeline-context-menu')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('在此后添加事件')
    expect(menu?.textContent).toContain('在此创建支线')
    expect(menu?.textContent).toContain('编辑事件')
    expect(menu?.textContent).toContain('删除事件')

    // 在此创建支线 -> 打开分叉支线模态窗
    const branchOption = Array.from(menu!.querySelectorAll('.writer-timeline-context-item'))
      .find(el => el.textContent?.includes('在此创建支线'))
    await act(async () => {
      branchOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('创建新支线事件')
    expect((formField('支线名称') as HTMLInputElement).value).toBe('末班车驶出地图 · 支线')

    // 关闭弹窗
    const closeBtn = container.querySelector('.writer-timeline-modal-close')
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
  })

  it('creates and immediately displays a branch from the selected event card', async () => {
    const savedEvents = [...timelineEvents]
    const savedBranches: Array<{ id: string; name: string; sourceEventId: string | null; sortOrder: number }> = []
    invoke.mockImplementation(async (channel: string, payload?: StoryTimelineEvent & { sourceEventId?: string }) => {
      if (channel === 'db:timeline-get-all') return { settings, branches: savedBranches, events: savedEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-branch-upsert' && payload) {
        savedBranches.push(payload as unknown as { id: string; name: string; sourceEventId: string | null; sortOrder: number })
        return { success: true, branch: payload }
      }
      if (channel === 'db:timeline-event-upsert' && payload) {
        savedEvents.push(payload)
        return { success: true, event: payload }
      }
      return { success: false, error: `unexpected channel ${channel}` }
    })

    await renderTimeline()
    await clickLabel('e1')
    const createBranch = labelFor('e1').querySelector<HTMLButtonElement>('[data-testid="timeline-create-branch"]')
    expect(createBranch?.textContent).toContain('创建支线')
    await act(async () => {
      createBranch?.click()
    })

    expect(container.querySelector('.writer-timeline-modal h2')?.textContent).toContain('创建新支线事件')
    await act(async () => {
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
    expect(savedBranches[0].sourceEventId).toBe('e1')
    expect(labels().some(label => label.textContent?.includes('反派潜入雾港'))).toBe(true)
  })

  it('renders mention chips inside modal when description contains mentions', async () => {
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

    await openEditModal('e-mention')
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
    expect(useLayoutStore.getState().characterViewRequest?.view).toBe('overview')

    // 关闭弹窗
    const closeBtn = container.querySelector('.writer-timeline-modal-close')
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
    // 呈现点状画布与故事开端、结束锚点，没有大号占位按钮
    expect(container.querySelector('[data-testid="timeline-anchor-start"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="timeline-anchor-end"]')).not.toBeNull()
    expect(container.textContent).toContain('故事开端')
    expect(container.textContent).toContain('故事结束')
    expect(container.textContent).not.toContain('从第一个故事事件开始')
    // 刻度设置与适应视图入口始终可用
    expect(container.textContent).toContain('刻度设置')
    expect(container.textContent).toContain('适应视图')
  })

  it('closes event modal cleanly on backdrop click, cancel click, and Escape key without freezing UI', async () => {
    await renderTimeline()

    // 1. 打开弹窗，通过遮罩点击关闭
    await openEditModal('e2')
    expect(container.querySelector('.writer-timeline-modal')).not.toBeNull()
    const backdrop = container.querySelector('.writer-timeline-modal-backdrop') as HTMLElement
    expect(backdrop).not.toBeNull()
    await act(async () => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()

    // 2. 再次打开，通过取消按钮关闭
    await openEditModal('e2')
    expect(container.querySelector('.writer-timeline-modal')).not.toBeNull()
    const cancelBtn = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(b => b.textContent?.includes('取消'))
    await act(async () => {
      cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()

    // 3. 再次打开，通过 Escape 键关闭
    await openEditModal('e2')
    expect(container.querySelector('.writer-timeline-modal')).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()

    // 4. 验证界面完全响应：可继续选择节点
    await clickLabel('e1')
    expect(labelFor('e1').className).toContain('is-selected')
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
    const sortOrderInput = formField('排序刻度') as HTMLInputElement
    expect(sortOrderInput.value).toBeTruthy()

    // 取消关闭
    const cancelBtn = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(b => b.textContent?.includes('取消'))
    await act(async () => {
      cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
  })

  it('keeps the canvas and its anchors visible after saving the first event from an empty timeline', async () => {
    const savedEvents: StoryTimelineEvent[] = []
    invoke.mockImplementation(async (channel: string, payload?: StoryTimelineEvent) => {
      if (channel === 'db:timeline-get-all') return { settings, branches: [], events: savedEvents }
      if (channel === 'db:map-get-all') return { nodes: [], edges: [], layers: [] }
      if (channel === 'db:timeline-event-upsert' && payload) {
        savedEvents.push(payload)
        return { success: true, event: payload }
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

  it('rejects saving event when sortOrder is outside [startOrder, endOrder] with prompt', async () => {
    await renderTimeline()

    await openEditModal('e2')
    const sortOrderInput = formField('排序刻度') as HTMLInputElement
    await act(async () => {
      setInputValue(sortOrderInput, '999')
    })

    const saveBtn = Array.from(container.querySelectorAll('.writer-timeline-modal button'))
      .find(b => b.textContent?.includes('保存事件'))
    expect(saveBtn).not.toBeNull()

    await act(async () => {
      saveBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 弹窗未被关闭，且展示校验提示“请先编辑故事开端或故事结束”
    expect(container.querySelector('.writer-timeline-modal')).not.toBeNull()
    expect(container.querySelector('.writer-timeline-field-error')?.textContent).toContain('请先编辑故事开端或故事结束')

    // 关闭弹窗
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('.writer-timeline-modal')).toBeNull()
  })

  it('renders story start and end anchors and allows opening range modal on right click', async () => {
    await renderTimeline()

    const startAnchor = container.querySelector('[data-testid="timeline-anchor-start"]') as HTMLElement
    const endAnchor = container.querySelector('[data-testid="timeline-anchor-end"]') as HTMLElement
    expect(startAnchor).not.toBeNull()
    expect(endAnchor).not.toBeNull()
    expect(startAnchor.textContent).toContain('故事开端')
    expect(endAnchor.textContent).toContain('故事结束')

    // 右键开端锚点
    await act(async () => {
      startAnchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }))
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

  it('provides fit view button and maintains canvas responsiveness without unexpected viewport resets', async () => {
    await renderTimeline()

    const fitBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('适应视图'))
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
