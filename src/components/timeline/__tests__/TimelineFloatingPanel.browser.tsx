/**
 * TimelineFloatingPanel.browser.tsx — 任务 B 浮窗/表单/关联选择的交互验收。
 *
 * 直接挂载 TimelineEventFloat 与 TimelineEventModal（不经过页面主文件），
 * 覆盖交接文档的独立验收场景：四边溢出、画布缩放重钳制、长文本、
 * 清洁/脏 Escape、点击外部、滚轮不穿透、保存失败重试、范围外修正、
 * 搜索无结果、旧关联“未找到”保留、支线名称必填、兼容字段不丢。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { StoryTimelineEvent } from '../../../shared/story-timeline'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { buildTimelineEventSubmission, createTimelineEventFormValues } from '../TimelineEventForm'
import { TimelineEventFloat } from '../TimelineEventFloat'
import { TimelineEventModal } from '../TimelineEventModal'
import type { TimelineCanvasBounds, TimelineEventFloatCallbacks, TimelineUiResult } from '../timeline-ui-contract'

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

const CANVAS_BOUNDS: TimelineCanvasBounds = { left: 0, top: 0, width: 800, height: 600 }

function makeEvent(overrides: Partial<StoryTimelineEvent> & { id: string }): StoryTimelineEvent {
  return {
    title: overrides.id,
    timeLabel: '大荒历 312 年',
    sortOrder: 20,
    precision: 'exact',
    description: '',
    chapterNumbers: [],
    characterNames: [],
    locationNodeIds: [],
    status: 'planned',
    ...overrides,
  }
}

function makeCallbacks(overrides: Partial<TimelineEventFloatCallbacks> = {}): TimelineEventFloatCallbacks {
  return {
    onClose: vi.fn(),
    onSwitchToEdit: vi.fn(),
    onSaveEvent: vi.fn(async (): Promise<TimelineUiResult> => ({ success: true })),
    onDeleteEvent: vi.fn(async (): Promise<TimelineUiResult> => ({ success: true })),
    onCreateBranch: vi.fn(),
    onCreateNext: vi.fn(),
    onToggleBranches: vi.fn(),
    ...overrides,
  }
}

const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorldMapState = useWorldMapStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 组件自身不加载 index.css，这里只补回浮窗定位所需的最小规则。 */
let injectedStyle: HTMLStyleElement | null = null
function injectFloatStyles() {
  const style = document.createElement('style')
  // 禁用 vela-feedback-panel 的入场动画：动画中的 transform 会让
  // getBoundingClientRect 偏离最终钳制位置，验收只关心静止位置。
  style.textContent = '.writer-timeline-float { position: absolute; z-index: 60; animation: none !important; }'
  document.head.append(style)
  injectedStyle = style
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

function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function formField(labelText: string): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(container.querySelectorAll('.writer-timeline-field'))
    .find(node => (node.querySelector('span')?.textContent ?? '').includes(labelText))
  const field = label?.querySelector('input, textarea')
  if (!field) throw new Error(`form field ${labelText} is missing`)
  return field as HTMLInputElement | HTMLTextAreaElement
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('click target is missing')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function queryFloat(): HTMLElement {
  const float = container.querySelector<HTMLElement>('[data-testid="timeline-event-float"]')
  if (!float) throw new Error('timeline event float is missing')
  return float
}

function expectInsideCanvas() {
  const panelRect = queryFloat().getBoundingClientRect()
  // 断言相对画布容器实际矩形，避免页面默认边距干扰；浮窗必须完整落在
  // 容器内且四边至少留出 FLOAT_MARGIN(12px)。
  const rect = container.getBoundingClientRect()
  const margin = 12
  expect(panelRect.left).toBeGreaterThanOrEqual(rect.left + margin - 0.5)
  expect(panelRect.top).toBeGreaterThanOrEqual(rect.top + margin - 0.5)
  expect(panelRect.right).toBeLessThanOrEqual(rect.left + rect.width - margin + 0.5)
  expect(panelRect.bottom).toBeLessThanOrEqual(rect.top + rect.height - margin + 0.5)
}

async function mountFloat(ui: React.ReactElement) {
  // 每次挂载都重建 root：循环场景里上一个用例的浮窗先被卸载。
  root = createRoot(container)
  await act(async () => {
    root.render(ui)
  })
}

/** 蓝图/名册候选的默认 mock：两个卷、三章、两名角色。 */
function mockCandidateChannels(options: { failBlueprints?: boolean } = {}) {
  invoke.mockImplementation(async (channel: string) => {
    if (options.failBlueprints && channel.startsWith('db:blueprint')) {
      throw new Error('blueprint backend offline')
    }
    if (channel === 'db:blueprint-list-summary') {
      return [
        { chapterNumber: 1, title: '启程', volumeId: 'v1' },
        { chapterNumber: 2, title: '雾港', volumeId: 'v1' },
        { chapterNumber: 3, title: '暗河', volumeId: undefined },
      ]
    }
    if (channel === 'db:blueprint-v2-summary-list') return []
    if (channel === 'db:blueprint-volume-list') {
      return [
        { id: 'v1', name: '第一卷', sortOrder: 0 },
        { id: 'v2', name: '第二卷', sortOrder: 1 },
      ]
    }
    if (channel === 'db:character-roster-read') {
      return {
        schemaVersion: 1, revision: 1, migrationState: 'ready', status: 'ready',
        entries: [
          { name: '许渡', role: '主角', gender: '', age: '', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '' },
          { name: '沈砚', role: '', gender: '', age: '', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '' },
        ],
        renderedMarkdown: '', projectionHash: '', factHash: '',
      }
    }
    return { success: false, error: `unexpected channel ${channel}` }
  })
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1 })
  useWorldMapStore.setState({ ...originalWorldMapState, maps: [], nodes: [], edges: [], migration: null, loading: false })
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:blueprint-list-summary') return []
    if (channel === 'db:blueprint-v2-summary-list') return []
    if (channel === 'db:blueprint-volume-list') return []
    if (channel === 'db:character-roster-read') {
      return {
        schemaVersion: 1, revision: 1, migrationState: 'ready', status: 'ready',
        entries: [], renderedMarkdown: '', projectionHash: '', factHash: '',
      }
    }
    return { success: false, error: `unexpected channel ${channel}` }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })

  container = document.createElement('div')
  Object.assign(container.style, {
    position: 'relative',
    width: `${CANVAS_BOUNDS.width}px`,
    height: `${CANVAS_BOUNDS.height}px`,
  })
  document.body.style.margin = '0'
  document.body.append(container)
  injectFloatStyles()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  injectedStyle?.remove()
  injectedStyle = null
  document.body.style.margin = ''
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useWorldMapStore.setState(originalWorldMapState)
  vi.restoreAllMocks()
})

describe('timeline floating panel: details', () => {
  it('shows real title, time, status, branch, links and a true empty state', async () => {
    await mountFloat(
      <TimelineEventFloat
        eventId="e2"
        point={{ clientX: 200, clientY: 200 }}
        mode="details"
        bounds={CANVAS_BOUNDS}
        event={makeEvent({
          id: 'e2',
          title: '雾港调查',
          timeLabel: '大荒历 312 年',
          status: 'drafted',
          description: '',
          chapterNumbers: [3, 4],
          characterNames: ['沈砚'],
          locationNodeIds: ['loc-1'],
        })}
        branchName="雾港暗线"
        statusLabel="已起草"
        chapterText="第3章、第4章"
        characterNames={['沈砚']}
        locationNames={['雾港']}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={makeCallbacks()}
      />,
    )

    const float = queryFloat()
    expect(float.textContent).toContain('雾港调查')
    expect(float.textContent).toContain('大荒历 312 年')
    expect(float.textContent).toContain('已起草')
    expect(float.textContent).toContain('雾港暗线')
    expect(float.textContent).toContain('第3章、第4章')
    expect(float.textContent).toContain('沈砚')
    expect(float.textContent).toContain('雾港')
    // 空描述必须是真实空状态，而不是编造的占位内容。
    expect(float.textContent).toContain('这条事件还没有描述。')
    expectInsideCanvas()
  })

  it('keeps the panel inside the canvas for all four corner right-clicks', async () => {
    const corners: Array<{ clientX: number; clientY: number }> = [
      { clientX: CANVAS_BOUNDS.left + 2, clientY: CANVAS_BOUNDS.top + 2 },
      { clientX: CANVAS_BOUNDS.left + CANVAS_BOUNDS.width - 2, clientY: CANVAS_BOUNDS.top + 2 },
      { clientX: CANVAS_BOUNDS.left + 2, clientY: CANVAS_BOUNDS.top + CANVAS_BOUNDS.height - 2 },
      {
        clientX: CANVAS_BOUNDS.left + CANVAS_BOUNDS.width - 2,
        clientY: CANVAS_BOUNDS.top + CANVAS_BOUNDS.height - 2,
      },
    ]
    for (const point of corners) {
      await mountFloat(
        <TimelineEventFloat
          eventId="e1"
          point={point}
          mode="details"
          bounds={CANVAS_BOUNDS}
          event={makeEvent({ id: 'e1', title: '末班车驶出地图' })}
          branchName={null}
          statusLabel="计划中"
          chapterText={null}
          characterNames={[]}
          locationNames={[]}
          childBranches={[]}
          isExpanded={false}
          cascade={{ branchNames: [], eventCount: 1 }}
          callbacks={makeCallbacks()}
        />,
      )
      expectInsideCanvas()
    }
  })

  it('re-clamps when the canvas shrinks (sidebar collapse)', async () => {
    await mountFloat(
      <TimelineEventFloat
        eventId="e1"
        point={{ clientX: 760, clientY: 560 }}
        mode="details"
        bounds={CANVAS_BOUNDS}
        event={makeEvent({ id: 'e1' })}
        branchName={null}
        statusLabel="计划中"
        chapterText={null}
        characterNames={[]}
        locationNames={[]}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={makeCallbacks()}
      />,
    )
    expectInsideCanvas()

    // 模拟内侧栏展开挤占画布：容器缩小后浮窗必须重新钳制。
    await act(async () => {
      container.style.width = '500px'
      container.style.height = '380px'
    })
    await vi.waitFor(() => {
      expectInsideCanvas()
      const panelRect = queryFloat().getBoundingClientRect()
      expect(panelRect.width).toBeLessThanOrEqual(500 - 12 * 2 + 0.5)
    })
  })

  it('ignores canvas zoom: panel size is driven by the container, not the flow transform', async () => {
    await mountFloat(
      <TimelineEventFloat
        eventId="e1"
        point={{ clientX: 200, clientY: 200 }}
        mode="details"
        bounds={CANVAS_BOUNDS}
        event={makeEvent({ id: 'e1', title: '缩放中的事件' })}
        branchName={null}
        statusLabel="计划中"
        chapterText={null}
        characterNames={[]}
        locationNames={[]}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={makeCallbacks()}
      />,
    )
    // 浮窗是画布容器的直接子元素，位于 React Flow 变换层之外。
    expect(queryFloat().parentElement).toBe(container)
    expect(queryFloat().closest('.react-flow__viewport')).toBeNull()
  })
})

describe('timeline floating panel: edit protection', () => {
  interface EditHarness {
    callbacks: TimelineEventFloatCallbacks
    event: StoryTimelineEvent
  }

  async function mountEdit(event: StoryTimelineEvent, overrides: Partial<TimelineEventFloatCallbacks> = {}): Promise<EditHarness> {
    const callbacks = makeCallbacks(overrides)
    await mountFloat(
      <TimelineEventFloat
        eventId={event.id}
        point={{ clientX: 200, clientY: 200 }}
        mode="edit"
        bounds={CANVAS_BOUNDS}
        event={event}
        branchName={null}
        statusLabel="计划中"
        chapterText={null}
        characterNames={[]}
        locationNames={[]}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={callbacks}
      />,
    )
    return { callbacks, event }
  }

  it('closes on Escape when clean and reports the escape for focus return', async () => {
    const { callbacks } = await mountEdit(makeEvent({ id: 'e1', title: '干净编辑' }))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(callbacks.onClose).toHaveBeenCalledWith({ viaEscape: true })
  })

  it('never silently discards dirty edits on Escape or outside clicks', async () => {
    const { callbacks } = await mountEdit(makeEvent({ id: 'e1', title: '脏编辑' }))
    setInputValue(formField('事件标题'), '改名后的雾港调查')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    const confirm = container.querySelector('[data-testid="timeline-float-discard-confirm"]')
    expect(confirm).not.toBeNull()
    expect(callbacks.onClose).not.toHaveBeenCalled()

    // 继续编辑：确认条收起，输入保留。
    const keepButtons = Array.from(confirm!.querySelectorAll('button'))
    await click(keepButtons.find(button => button.textContent === '继续编辑'))
    expect(container.querySelector('[data-testid="timeline-float-discard-confirm"]')).toBeNull()
    expect((formField('事件标题') as HTMLInputElement).value).toBe('改名后的雾港调查')

    // 点击外部同样先进入确认，绝不静默丢弃。
    await act(async () => {
      container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="timeline-float-discard-confirm"]')).not.toBeNull()
    expect(callbacks.onClose).not.toHaveBeenCalled()

    // 放弃修改：显式确认后才关闭。
    const discardButtons = Array.from(
      container.querySelector('[data-testid="timeline-float-discard-confirm"]')!.querySelectorAll('button'),
    )
    await click(discardButtons.find(button => button.textContent === '放弃修改'))
    expect(callbacks.onClose).toHaveBeenCalled()
  })

  it('keeps input and focus after a failed save and allows a retry', async () => {
    let attempt = 0
    const { callbacks } = await mountEdit(
      makeEvent({ id: 'e1', title: '写入必须失败' }),
      {
        onSaveEvent: vi.fn(async (): Promise<TimelineUiResult> => {
          attempt += 1
          return attempt === 1 ? { success: false, error: '数据库写入失败' } : { success: true }
        }),
      },
    )

    await click(queryFloat().querySelector('[data-testid="timeline-float-save"]'))
    expect(attempt).toBe(1)
    expect(queryFloat().textContent).toContain('数据库写入失败')
    expect((formField('事件标题') as HTMLInputElement).value).toBe('写入必须失败')
    expect(callbacks.onClose).not.toHaveBeenCalled()

    // 保存按钮在失败后恢复可用，重试成功。
    const saveButton = queryFloat().querySelector<HTMLButtonElement>('[data-testid="timeline-float-save"]')
    expect(saveButton?.disabled).toBe(false)
    await click(saveButton)
    expect(attempt).toBe(2)
  })

  it('refuses out-of-range ruler positions and points to the range editor instead of expanding it', async () => {
    const onSaveEvent = vi.fn(async (): Promise<TimelineUiResult> => ({ success: true }))
    await mountFloat(
      <TimelineEventFloat
        eventId="e1"
        point={{ clientX: 200, clientY: 200 }}
        mode="edit"
        bounds={CANVAS_BOUNDS}
        event={makeEvent({ id: 'e1', title: '范围外事件' })}
        branchName={null}
        statusLabel="计划中"
        chapterText={null}
        characterNames={[]}
        locationNames={[]}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={makeCallbacks({ onSaveEvent })}
        storyRange={{ startOrder: 0, endOrder: 100 }}
      />,
    )
    setInputValue(formField('排列位置'), '150')
    await click(queryFloat().querySelector('[data-testid="timeline-float-save"]'))

    expect(queryFloat().textContent).toContain('排列位置超出故事范围')
    expect(onSaveEvent).not.toHaveBeenCalled()
  })

  it('carries compatibility fields and old handwritten links through the save payload', async () => {
    const onSaveEvent = vi.fn<(event: StoryTimelineEvent) => Promise<TimelineUiResult>>(
      async (): Promise<TimelineUiResult> => ({ success: true }),
    )
    await mountEdit(
      makeEvent({
        id: 'e1',
        title: '历史事件',
        isHistorical: true,
        outcome: '旧结果',
        aftermath: '旧影响',
        chapterNumbers: [3, 99],
        characterNames: ['手写角色'],
      }),
      { onSaveEvent },
    )
    await click(queryFloat().querySelector('[data-testid="timeline-float-save"]'))

    expect(onSaveEvent).toHaveBeenCalledTimes(1)
    const payload = onSaveEvent.mock.calls[0][0]
    expect(payload.isHistorical).toBe(true)
    expect(payload.outcome).toBe('旧结果')
    expect(payload.aftermath).toBe('旧影响')
    // 候选之外的旧章号/手写名绝不因保存被清空。
    expect(payload.chapterNumbers).toEqual([3, 99])
    expect(payload.characterNames).toEqual(['手写角色'])
  })

  it('traps Tab focus inside the panel', async () => {
    await mountEdit(makeEvent({ id: 'e1', title: '焦点圈' }))
    const float = queryFloat()
    const focusable = Array.from(float.querySelectorAll<HTMLElement>('button, input, select, textarea'))
      .filter(element => !element.hasAttribute('disabled'))
    expect(focusable.length).toBeGreaterThan(1)

    focusable[focusable.length - 1].focus()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    })
    expect(float.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(focusable[0])
  })

  it('does not propagate wheel events to the canvas behind the float', async () => {
    await mountEdit(makeEvent({ id: 'e1', title: '滚轮' }))
    const wheelSpy = vi.fn()
    document.addEventListener('wheel', wheelSpy)
    try {
      await act(async () => {
        queryFloat().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 42 }))
      })
      expect(wheelSpy).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('wheel', wheelSpy)
    }
  })
})

describe('timeline floating panel: association pickers', () => {
  async function mountEditWithCandidates(event: StoryTimelineEvent) {
    mockCandidateChannels()
    const onSaveEvent = vi.fn<(event: StoryTimelineEvent) => Promise<TimelineUiResult>>(
      async (): Promise<TimelineUiResult> => ({ success: true }),
    )
    const callbacks = makeCallbacks({ onSaveEvent })
    await mountFloat(
      <TimelineEventFloat
        eventId={event.id}
        point={{ clientX: 200, clientY: 200 }}
        mode="edit"
        bounds={CANVAS_BOUNDS}
        event={event}
        branchName={null}
        statusLabel="计划中"
        chapterText={null}
        characterNames={[]}
        locationNames={[]}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={callbacks}
      />,
    )
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="timeline-chapter-option"]')).not.toBeNull()
    })
    return { callbacks, onSaveEvent }
  }

  it('filters chapters by real volume, searches by number/title, and shows a true empty state', async () => {
    await mountEditWithCandidates(makeEvent({ id: 'e1', title: '章节筛选' }))

    // 未归卷的第3章与第一卷的第1/2章都在候选里。
    expect(container.querySelectorAll('[data-testid="timeline-chapter-option"]').length).toBe(3)

    // 卷筛选使用候选自带的 volumeId，不凭章号推测。
    const volumeSelect = container.querySelector<HTMLSelectElement>('.writer-timeline-assoc-volume select')
    await act(async () => {
      setSelectValue(volumeSelect!, 'volume:v1')
    })
    const volumeRows = Array.from(container.querySelectorAll('[data-testid="timeline-chapter-option"]'))
    expect(volumeRows.length).toBe(2)
    expect(volumeRows.map(row => row.textContent)).toEqual([
      expect.stringContaining('第1章'),
      expect.stringContaining('第2章'),
    ])

    // 搜索无结果给真实空状态；回车可添加候选之外的章号。
    const search = container.querySelector<HTMLInputElement>('[data-testid="timeline-chapter-search"]')
    setInputValue(search!, '不存在的章节')
    expect(container.querySelector('[data-testid="timeline-chapter-empty"]')?.textContent)
      .toContain('没有匹配的章节')
    setInputValue(search!, '')
    setInputValue(search!, '7')
    await act(async () => {
      search!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const chips = Array.from(container.querySelectorAll('[data-testid="timeline-chapter-chip"]'))
    expect(chips.map(chip => chip.textContent)).toEqual([expect.stringContaining('第7章')])
  })

  it('keeps unknown old chapters and handwritten characters marked as not found', async () => {
    const { onSaveEvent } = await mountEditWithCandidates(makeEvent({
      id: 'e1',
      title: '旧关联',
      chapterNumbers: [3, 99],
      characterNames: ['许渡', '手写角色'],
    }))

    const missingChips = container.querySelectorAll('[data-testid="timeline-chapter-chip"][data-missing]')
    expect(missingChips.length).toBe(1)
    expect(missingChips[0].textContent).toContain('第99章')
    expect(missingChips[0].textContent).toContain('未找到')

    const missingCharacters = container.querySelectorAll('[data-testid="timeline-character-chip"][data-missing]')
    expect(missingCharacters.length).toBe(1)
    expect(missingCharacters[0].textContent).toContain('手写角色')
    expect(missingCharacters[0].textContent).toContain('未找到')

    // 保存时旧关联原样保留。
    await click(queryFloat().querySelector('[data-testid="timeline-float-save"]'))
    expect(onSaveEvent).toHaveBeenCalledTimes(1)
    const payload = onSaveEvent.mock.calls[0][0]
    expect(payload.chapterNumbers).toEqual([3, 99])
    expect(payload.characterNames).toEqual(['许渡', '手写角色'])  })

  it('keeps existing links and offers retry when candidates fail to load', async () => {
    mockCandidateChannels({ failBlueprints: true })
    const callbacks = makeCallbacks()
    await mountFloat(
      <TimelineEventFloat
        eventId="e1"
        point={{ clientX: 200, clientY: 200 }}
        mode="edit"
        bounds={CANVAS_BOUNDS}
        event={makeEvent({ id: 'e1', title: '候选失败', chapterNumbers: [99] })}
        branchName={null}
        statusLabel="计划中"
        chapterText={null}
        characterNames={[]}
        locationNames={[]}
        childBranches={[]}
        isExpanded={false}
        cascade={{ branchNames: [], eventCount: 1 }}
        callbacks={callbacks}
      />,
    )

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="timeline-chapter-retry"]')).not.toBeNull()
    })
    // 读取失败时不能断言“未找到”，旧值必须无标注地保留。
    const chip = container.querySelector('[data-testid="timeline-chapter-chip"]')
    expect(chip?.textContent).toContain('第99章')
    expect(chip?.hasAttribute('data-missing')).toBe(false)

    // 修复后重试成功，恢复候选列表；此时第99章确实不在候选里，徽标随之出现。
    mockCandidateChannels()
    await click(container.querySelector('[data-testid="timeline-chapter-retry"]'))
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="timeline-chapter-option"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="timeline-chapter-chip"]')?.hasAttribute('data-missing')).toBe(true)
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })
})

describe('timeline branch creation form', () => {
  it('requires an explicit branch name instead of silently filling 支线', async () => {
    const onSave = vi.fn<(data: { event: StoryTimelineEvent; newBranchName?: string }) => Promise<TimelineUiResult>>(
      async (): Promise<TimelineUiResult> => ({ success: true }),
    )
    const onClose = vi.fn()
    await mountFloat(
      <TimelineEventModal
        open
        mode="create-branch"
        sourceEvent={makeEvent({ id: 'e1', title: '末班车驶出地图' })}
        onClose={onClose}
        onSave={onSave}
      />,
    )

    // 名称字段必须从空白开始，由作者填写；空名时保存按钮禁用。
    const branchName = formField('支线名称') as HTMLInputElement
    expect(branchName.value).toBe('')
    const saveButton = container.querySelector<HTMLButtonElement>('.writer-timeline-modal-footer button:last-child')
    expect(saveButton?.disabled).toBe(true)

    // 共享校验同样拦截空支线名（双保险），错误文案真实可读。
    const values = createTimelineEventFormValues('create-branch', { sourceEvent: makeEvent({ id: 'e1', title: '末班车驶出地图' }) })
    const blocked = buildTimelineEventSubmission({ ...values, title: '反派潜入雾港', timeLabel: '大荒历 313 年' }, 'create-branch', {
      sourceEvent: makeEvent({ id: 'e1', title: '末班车驶出地图' }),
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toBe('请填写支线名称')
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    // 填写名称后保存成功，绝不出现静默的“支线”名称。
    setInputValue(branchName, '雾港暗线')
    setInputValue(formField('事件标题'), '反派潜入雾港')
    setInputValue(formField('自定义时间'), '大荒历 313 年')
    await click(container.querySelector('.writer-timeline-modal-footer button:last-child'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].newBranchName).toBe('雾港暗线')
  })

  it('announces the fork source explicitly', async () => {
    await mountFloat(
      <TimelineEventModal
        open
        mode="create-branch"
        sourceEvent={makeEvent({ id: 'e1', title: '末班车驶出地图' })}
        onClose={vi.fn()}
        onSave={vi.fn(async () => ({ success: true }) as const)}
      />,
    )
    const subtitle = container.querySelector('.writer-timeline-modal-subtitle')
    expect(subtitle?.textContent).toContain('分叉自事件')
    expect(subtitle?.textContent).toContain('末班车驶出地图')
    expect(formField('事件标题') instanceof HTMLInputElement).toBe(true)
  })
})
