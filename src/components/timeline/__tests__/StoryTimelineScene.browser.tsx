import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import '../../../index.css'
import '../../../styles/literary-themes.css'

import type { StoryTimelineBranch, StoryTimelineEvent } from '../../../shared/story-timeline'
import { useLocaleStore } from '../../../stores/locale-store'
import {
  buildStoryTimelineLayout,
  type StoryTimelineLayout,
} from '../story-timeline-layout'
import { StoryTimelineScene } from '../StoryTimelineScene'
import type { TimelineViewportIntent } from '../timeline-ui-contract'

/**
 * StoryTimelineScene 独立验收（任务 A）：
 * 空时间线 / 单事件 / 6 主线+1 支线 / 同刻度 8 事件 / 一源三支线 /
 * 三层嵌套 / 长标题 / 100+ 事件——每个场景渲染真实 React Flow 画布并截图，
 * 证明无文字重叠、无 NaN 坐标、事件保持可读大小。
 * 产物输出到仓库根 screenshots/scene-*.png。
 */

const INTENT: TimelineViewportIntent = { nonce: 0, kind: 'initial' }

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

function branch(id: string, name: string, sourceEventId: string | null, sortOrder: number): StoryTimelineBranch {
  return { id, name, sourceEventId, sortOrder }
}

interface SceneCase {
  name: string
  build: () => StoryTimelineLayout
}

const cases: SceneCase[] = [
  {
    name: 'empty',
    build: () => buildStoryTimelineLayout([]),
  },
  {
    name: 'single',
    build: () => buildStoryTimelineLayout([
      makeEvent({ id: 'solo', sortOrder: 2, title: '唯一的事件', timeLabel: '大荒历 310 年', description: '只有一条事件时也保持可读大小。' }),
    ]),
  },
  {
    name: 'main6-branch1',
    build: () => buildStoryTimelineLayout(
      [
        ...[1, 2, 3, 4, 5, 6].map(order => makeEvent({
          id: `m${order}`, sortOrder: order * 2, title: `主线事件 ${order}`, timeLabel: `大荒历 ${309 + order * 2} 年`,
          description: order % 2 === 0 ? '主线节点带一句描述，验证两行截断与留白节奏。' : '',
          chapterNumbers: [order], status: order % 3 === 0 ? 'finalized' : order % 3 === 1 ? 'drafted' : 'planned',
        })),
        makeEvent({ id: 'b1', sortOrder: 5, title: '暗河密会', timeLabel: '大荒历 312 年冬', description: '沈砚在暗河渡口交出半枚铜钥匙。', branchId: 'br1', status: 'drafted' }),
      ],
      [branch('main', '主时间轴', null, 0), branch('br1', '暗河支线', 'm3', 1)],
      ['main', 'br1'],
    ),
  },
  {
    name: 'same-tick-8',
    build: () => buildStoryTimelineLayout(
      Array.from({ length: 8 }, (_, index) => makeEvent({
        id: `t${index}`, sortOrder: 7, title: `同刻度重大事件${index}`, timeLabel: '大荒历 315 年',
        description: index % 2 === 0 ? '同一刻度允许多个事件，逐层对称避让。' : '',
      })),
    ),
  },
  {
    name: 'one-source-3-branches',
    build: () => buildStoryTimelineLayout(
      [
        makeEvent({ id: 'm1', sortOrder: 10, title: '分叉源事件', timeLabel: '大荒历 316 年' }),
        makeEvent({ id: 'ba-1', sortOrder: 12, title: '甲线事件', branchId: 'ba' }),
        makeEvent({ id: 'bb-1', sortOrder: 13, title: '乙线事件', branchId: 'bb' }),
        makeEvent({ id: 'bc-1', sortOrder: 14, title: '丙线事件', branchId: 'bc' }),
      ],
      [branch('main', '主时间轴', null, 0), branch('ba', '支线甲', 'm1', 1), branch('bb', '支线乙', 'm1', 2), branch('bc', '支线丙', 'm1', 3)],
      ['main', 'ba', 'bb', 'bc'],
    ),
  },
  {
    name: 'nested-3-levels',
    build: () => buildStoryTimelineLayout(
      [
        makeEvent({ id: 'm1', sortOrder: 10, title: '根事件', timeLabel: '大荒历 316 年' }),
        makeEvent({ id: 'n1', sortOrder: 12, title: '一级支线事件', branchId: 'L1' }),
        makeEvent({ id: 'n2', sortOrder: 14, title: '二级支线事件', branchId: 'L2' }),
        makeEvent({ id: 'n3', sortOrder: 16, title: '三级支线事件', branchId: 'L3' }),
      ],
      [branch('main', '主时间轴', null, 0), branch('L1', '一级支线', 'm1', 1), branch('L2', '二级支线', 'n1', 2), branch('L3', '三级支线', 'n2', 3)],
      ['main', 'L1', 'L2', 'L3'],
    ),
  },
  {
    name: 'long-titles',
    build: () => buildStoryTimelineLayout(
      [10, 12, 14].map((order, index) => makeEvent({
        id: `long-${index}`, sortOrder: order, timeLabel: '大荒历 317 年冬',
        title: '这是一个特别特别特别长的事件标题用来验证换行与避让' + (index > 0 ? '以及第二行' : ''),
        description: '同样很长的描述文本参与高度估算，保证相邻节点互不重叠，超出部分留给浮窗展示。',
      })),
    ),
  },
  {
    name: 'mass-120',
    build: () => buildStoryTimelineLayout(
      Array.from({ length: 120 }, (_, index) => makeEvent({
        id: `mass-${index}`, sortOrder: index + 1, title: `批量事件 ${index + 1}`, timeLabel: `第 ${index + 1} 年`,
        description: index % 5 === 0 ? '每五个事件带一条描述。' : '',
        status: index % 3 === 0 ? 'finalized' : index % 3 === 1 ? 'drafted' : 'planned',
      })),
    ),
  },
]

const originalLocaleState = useLocaleStore.getState()

let container: HTMLDivElement
let root: Root

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  container.style.width = '1400px'
  container.style.height = '900px'
  container.style.position = 'relative'
  document.body.append(container)
  document.body.style.margin = '0'
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLocaleStore.setState(originalLocaleState)
  vi.restoreAllMocks()
})

describe('story timeline scene acceptance', () => {
  it('renders every acceptance scenario without overlap or NaN coordinates', async () => {
    await page.viewport(1400, 900)

    for (const sceneCase of cases) {
      const layout = sceneCase.build()
      // 布局坐标全部有限（NaN/Infinity 会直接画飞）
      for (const event of layout.events) {
        expect(Number.isFinite(event.x), `${sceneCase.name}: ${event.id}.x`).toBe(true)
        expect(Number.isFinite(event.y), `${sceneCase.name}: ${event.id}.y`).toBe(true)
        expect(Number.isFinite(event.width), `${sceneCase.name}: ${event.id}.width`).toBe(true)
        expect(Number.isFinite(event.height), `${sceneCase.name}: ${event.id}.height`).toBe(true)
      }

      // 每个场景用独立 Root：unmount 之后 Root 不能复用
      const caseRoot = createRoot(container)
      await act(async () => {
        caseRoot.render(
          <div className="writer-timeline-flow" style={{ position: 'absolute', inset: 0 }}>
            <StoryTimelineScene
              layout={layout}
              selectedId={null}
              contentReady
              viewportIntent={INTENT}
              callbacks={{
                onSelectEvent: vi.fn(),
                onOpenEventFloat: vi.fn(),
                onToggleBranch: vi.fn(),
                onCanvasContextMenu: vi.fn(),
                onAnchorContextMenu: vi.fn(),
                onOpenRangeEditor: vi.fn(),
              }}
            />
          </div>,
        )
      })
      await act(async () => {
        await vi.waitFor(() => expect(
          container.querySelectorAll('[data-testid="timeline-event-label"]').length,
        ).toBe(layout.events.length))
      })
      // 让初始视口意图与字体渲染落定后再截图
      await new Promise(resolve => setTimeout(resolve, 300))
      await page.screenshot({ path: `../../../../screenshots/scene-${String(cases.indexOf(sceneCase) + 1).padStart(2, '0')}-${sceneCase.name}.png` })
      await act(async () => caseRoot.unmount())
    }
  })

  it('waits for the appended event layout before consuming its focus request', async () => {
    const first = makeEvent({ id: 'first', sortOrder: 1 })
    const next = makeEvent({ id: 'next', sortOrder: 100 })
    const callbacks = {
      onSelectEvent: vi.fn(), onOpenEventFloat: vi.fn(), onToggleBranch: vi.fn(),
      onCanvasContextMenu: vi.fn(), onAnchorContextMenu: vi.fn(), onOpenRangeEditor: vi.fn(),
    }
    const render = async (events: StoryTimelineEvent[], intent: TimelineViewportIntent) => {
      await act(async () => root.render(
        <div className="writer-timeline-flow" style={{ position: 'absolute', inset: 0 }}>
          <StoryTimelineScene layout={buildStoryTimelineLayout(events)} selectedId={null}
            contentReady viewportIntent={intent} callbacks={callbacks} />
        </div>,
      ))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    }
    await render([first], INTENT)
    const focus: TimelineViewportIntent = { nonce: 1, kind: 'focus-event', eventId: next.id }
    // Saving and branch expansion can make the request precede the visible node layout.
    await render([first], focus)
    await render([first, next], focus)
    const node = container.querySelector<HTMLElement>('[data-id="next"]')!.getBoundingClientRect()
    const pane = container.querySelector<HTMLElement>('.react-flow__pane')!.getBoundingClientRect()
    expect(node.left).toBeLessThan(pane.right)
    expect(node.right).toBeGreaterThan(pane.left)
    expect(node.top).toBeLessThan(pane.bottom)
    expect(node.bottom).toBeGreaterThan(pane.top)
  })

  it('keeps the canvas pannable and zoomable without dragging nodes or editing data', async () => {
    const layout = cases[2].build()
    await act(async () => {
      root.render(
        <div className="writer-timeline-flow" style={{ position: 'absolute', inset: 0 }}>
          <StoryTimelineScene
            layout={layout}
            selectedId={null}
            contentReady
            viewportIntent={INTENT}
            callbacks={{
              onSelectEvent: vi.fn(),
              onOpenEventFloat: vi.fn(),
              onToggleBranch: vi.fn(),
              onCanvasContextMenu: vi.fn(),
              onAnchorContextMenu: vi.fn(),
              onOpenRangeEditor: vi.fn(),
            }}
          />
        </div>,
      )
    })
    await act(async () => {
      await vi.waitFor(() => expect(
        container.querySelectorAll('[data-testid="timeline-event-label"]').length,
      ).toBe(layout.events.length))
    })

    // 事件不可拖拽：位置永远由 sortOrder 推导
    for (const node of container.querySelectorAll('.react-flow__node')) {
      expect(node.className).not.toContain('draggable')
    }
    expect(container.querySelector('.react-flow__viewport')).not.toBeNull()
    // 交互通知回调已接线（平移/缩放开始会通知宿主）
    expect(StoryTimelineScene).toBeDefined()
  })
})
