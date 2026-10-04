import { describe, expect, it } from 'vitest'

import type { StoryTimelineEvent, StoryTimelinePrecision } from '../../../shared/story-timeline'
import { parseStoryTimelineMentions } from '../../../shared/story-timeline'
import {
  buildStoryTimelineLayout,
  estimateTimelineLabelHeight,
  estimateTimelineLabelWidth,
  formatTimelineEventTime,
  sortTimelineEvents,
  TIMELINE_LABEL_AXIS_GAP,
  TIMELINE_LABEL_MAX_HEIGHT,
  TIMELINE_LABEL_MAX_WIDTH,
  TIMELINE_LABEL_MIN_WIDTH,
  TIMELINE_PIXELS_PER_ORDER,
  TIMELINE_STAGGER_STEP,
} from '../story-timeline-layout'

function makeEvent(
  id: string,
  sortOrder: number,
  overrides: Partial<StoryTimelineEvent> = {},
): StoryTimelineEvent {
  return {
    id,
    title: `事件 ${id}`,
    timeLabel: `时间 ${sortOrder}`,
    sortOrder,
    precision: 'exact' as StoryTimelinePrecision,
    description: '',
    chapterNumbers: [],
    characterNames: [],
    locationNodeIds: [],
    status: 'planned',
    ...overrides,
  }
}

/** 标题足够长时会命中宽度上限，从而触发同侧错开。 */
const LONG_TITLE = '很长的事件标题需要错开'.repeat(3)

describe('story timeline layout', () => {
  it('orders events by sortOrder regardless of input order', () => {
    const ordered = sortTimelineEvents([
      makeEvent('c', 30),
      makeEvent('a', 10),
      makeEvent('b', 20),
    ])

    expect(ordered.map(event => event.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks equal sortOrder ties deterministically by id', () => {
    const ordered = sortTimelineEvents([makeEvent('z', 5), makeEvent('a', 5), makeEvent('m', 5)])

    expect(ordered.map(event => event.id)).toEqual(['a', 'm', 'z'])
  })

  it('places earlier sortOrder to the left with proportional horizontal distance', () => {
    const layout = buildStoryTimelineLayout([
      makeEvent('first', 1),
      makeEvent('second', 3),
      makeEvent('third', 5),
    ])

    const [first, second, third] = layout.events
    expect(first.x).toBeLessThan(second.x)
    expect(second.x).toBeLessThan(third.x)
    // 刻度差值 2 对应 2 个刻度单位的像素距离。
    expect(second.x - first.x).toBe(2 * TIMELINE_PIXELS_PER_ORDER)
    expect(third.x - second.x).toBe(2 * TIMELINE_PIXELS_PER_ORDER)
  })

  it('keeps the left-to-right order independent of the id tie-break', () => {
    const layout = buildStoryTimelineLayout([
      makeEvent('z', 4),
      makeEvent('a', 2),
      makeEvent('m', 6),
    ])

    expect(layout.events.map(event => event.id)).toEqual(['a', 'z', 'm'])
    expect(layout.events[0].x).toBeLessThan(layout.events[1].x)
    expect(layout.events[1].x).toBeLessThan(layout.events[2].x)
  })

  it('alternates labels above and below around the continuous axis', () => {
    const layout = buildStoryTimelineLayout([1, 2, 3, 4, 5].map(order => makeEvent(`e${order}`, order)))

    expect(layout.events.map(event => event.side)).toEqual(['above', 'below', 'above', 'below', 'above'])
    // 主轴位于上下标注之间。
    for (const event of layout.events) {
      if (event.side === 'above') expect(event.y + event.height).toBeLessThanOrEqual(layout.axis.y)
      else expect(event.y).toBeGreaterThanOrEqual(layout.axis.y)
    }
  })

  it('does not stagger labels that are far enough apart on the same side', () => {
    const layout = buildStoryTimelineLayout([1, 2, 3, 4].map(order => makeEvent(`e${order}`, order)))

    expect(layout.events.map(event => event.staggerLevel)).toEqual([0, 0, 0, 0])
  })

  it('staggers same-side labels when dense events would overlap their titles', () => {
    const layout = buildStoryTimelineLayout(
      [0, 1, 2, 3, 4].map(index => makeEvent(
        `e${index}`,
        // 刻度完全相同 => 列被压到最小步长，同侧标注必然重叠。
        7,
        { title: LONG_TITLE },
      )),
    )

    // 同侧相邻标注逐层外推，保证标题不重叠。
    expect(layout.events.map(event => event.side))
      .toEqual(['above', 'below', 'above', 'below', 'above'])
    expect(layout.events.map(event => event.staggerLevel)).toEqual([0, 0, 1, 1, 2])

    const above = layout.events.filter(event => event.side === 'above')
    expect(above[1].y).toBeLessThan(above[0].y)
    expect(above[2].y).toBeLessThan(above[1].y)
    // 每层错开一个固定步长，而不是把横轴拉宽。
    expect(above[0].y - above[1].y).toBe(TIMELINE_STAGGER_STEP)
    // 同一刻度共享同一水平基准列
    expect(above[0].x).toBe(above[1].x)
  })

  it('keeps dense but short labels on separate columns without extra vertical stagger', () => {
    const layout = buildStoryTimelineLayout(
      [1, 2, 3].map(order => makeEvent(`e${order}`, order, { title: 'A', timeLabel: 'B' })),
    )

    expect(layout.events.map(event => event.staggerLevel)).toEqual([0, 0, 0])
  })

  it('shows start and end time for range events and a single time otherwise', () => {
    const range = makeEvent('range', 1, {
      timeLabel: '大荒历 317 年冬',
      precision: 'range',
      rangeEndLabel: '大荒历 318 年春',
    })
    expect(formatTimelineEventTime(range)).toBe('大荒历 317 年冬 — 大荒历 318 年春')

    const openRange = makeEvent('open', 2, { timeLabel: '大荒历 320 年', precision: 'range' })
    expect(formatTimelineEventTime(openRange)).toBe('大荒历 320 年')

    const exact = makeEvent('exact', 3, { timeLabel: '大荒历 321 年', precision: 'exact', rangeEndLabel: '不应出现' })
    expect(formatTimelineEventTime(exact)).toBe('大荒历 321 年')

    const layout = buildStoryTimelineLayout([range])
    expect(layout.events[0].timeText).toBe('大荒历 317 年冬 — 大荒历 318 年春')
  })

  it('exposes the custom time, title, two-line description and meta on an axis label', () => {
    const layout = buildStoryTimelineLayout([makeEvent('only', 1, {
      title: '标题',
      timeLabel: '时间',
      description: '描述会以两行截断的形式出现在节点上，完整内容留在浮窗里',
      chapterNumbers: [3, 4],
      characterNames: ['许渡'],
      locationNodeIds: ['loc-1'],
      status: 'finalized',
    })])

    // 节点字段包含画布直接渲染的描述与元信息，但角色/地点只留在浮窗。
    expect(Object.keys(layout.events[0]).sort()).toEqual([
      'branchId',
      'childBranchCount',
      'description',
      'height',
      'id',
      'isExpanded',
      'metaText',
      'parentEventId',
      'side',
      'staggerLevel',
      'status',
      'timeText',
      'title',
      'width',
      'x',
      'y',
    ])
    expect(layout.events[0].title).toBe('标题')
    expect(layout.events[0].timeText).toBe('时间')
    expect(layout.events[0].status).toBe('finalized')
    expect(layout.events[0].description).toContain('两行截断')
    expect(layout.events[0].metaText).toBe('第3、4章')
    // 角色/地点从不进入布局节点
    expect(layout.events[0].metaText).not.toContain('许渡')
  })

  it('estimates node heights from content lines and clamps to a sane maximum', () => {
    const bare = makeEvent('bare', 1, { title: '短标题', timeLabel: '时间' })
    const bareHeight = estimateTimelineLabelHeight(bare)
    expect(bareHeight).toBeGreaterThan(40)
    expect(bareHeight).toBeLessThanOrEqual(TIMELINE_LABEL_MAX_HEIGHT)

    const rich = makeEvent('rich', 2, {
      title: '一个特别特别特别长的事件标题一定会折行',
      timeLabel: '大荒历 317 年冬',
      description: '描述有整整两行内容，用来验证高度估算把换行计入在内，否则节点会互相重叠。'.repeat(2),
      chapterNumbers: [1, 2],
    })
    expect(estimateTimelineLabelHeight(rich)).toBeGreaterThan(bareHeight)
    expect(estimateTimelineLabelHeight(rich)).toBeLessThanOrEqual(TIMELINE_LABEL_MAX_HEIGHT)
  })

  it('clamps estimated label width between the configured bounds', () => {
    expect(estimateTimelineLabelWidth(makeEvent('tiny', 1, { title: 'A', timeLabel: 'B' })))
      .toBe(TIMELINE_LABEL_MIN_WIDTH)
    expect(estimateTimelineLabelWidth(makeEvent('huge', 1, { title: 'x'.repeat(120) })))
      .toBe(TIMELINE_LABEL_MAX_WIDTH)
  })

  it('emits an axis dot per main event aligned with its label centre', () => {
    const layout = buildStoryTimelineLayout([1, 2, 3].map(order => makeEvent(`e${order}`, order)))

    expect(layout.axisDots.map(dot => dot.eventId)).toEqual(['e1', 'e2', 'e3'])
    for (const event of layout.events) {
      const dot = layout.axisDots.find(item => item.eventId === event.id)!
      expect(dot.x).toBe(event.x + event.width / 2)
    }
  })

  it('places a branch label beside its branch lane when the branch is expanded', () => {
    const mainEvent = makeEvent('m1', 10, { title: '主线事件' })
    const branchEvent = makeEvent('b1', 20, { title: '支线事件', branchId: 'side' })
    const layout = buildStoryTimelineLayout(
      [mainEvent, branchEvent],
      [
        { id: 'main', name: '主时间轴', sourceEventId: null, sortOrder: 0 },
        { id: 'side', name: '暗线分支', sourceEventId: 'm1', sortOrder: 1 },
      ],
      ['main', 'side'],
    )

    expect(layout.branchLabels).toHaveLength(1)
    const [label] = layout.branchLabels
    expect(label.branchId).toBe('side')
    expect(label.name).toBe('暗线分支')
    const first = layout.events.find(event => event.id === 'b1')!
    // 标签贴着支线首事件（上方泳道在首事件上方）
    expect(label.y).toBeLessThan(first.y)
  })

  it('maintains a trunk width of at least 1000px for empty timeline with start and end anchors', () => {
    const layout = buildStoryTimelineLayout([])

    expect(layout.events).toEqual([])
    expect(layout.axis.width).toBeGreaterThanOrEqual(1000)
    expect(layout.startAnchor).toBeDefined()
    expect(layout.endAnchor).toBeDefined()
    expect(layout.startAnchor.id).toBe('timeline-anchor-start')
    expect(layout.endAnchor.id).toBe('timeline-anchor-end')
    expect(layout.startAnchor.x).toBeLessThan(layout.endAnchor.x)
    expect(layout.endAnchor.x - layout.startAnchor.x).toBeGreaterThanOrEqual(1000)
  })

  it('derives identical geometry for identical input and never stores positions on events', () => {
    const events = [1, 2, 3].map(order => makeEvent(`e${order}`, order))
    const first = buildStoryTimelineLayout(events)
    const second = buildStoryTimelineLayout(events)

    expect(second).toEqual(first)
    // 事件本身没有被写入任何视觉位置字段。
    for (const event of events) {
      expect(Object.keys(event)).not.toContain('x')
      expect(Object.keys(event)).not.toContain('y')
      expect(Object.keys(event)).not.toContain('side')
      expect(Object.keys(event)).not.toContain('position')
    }
  })

  it('keeps the axis continuous across every event and vertically centred between layers', () => {
    const layout = buildStoryTimelineLayout(
      [0, 1, 2, 3].map(index => makeEvent(`e${index}`, 7, { title: LONG_TITLE })),
    )

    const first = layout.events[0]
    const last = layout.events[layout.events.length - 1]
    // 主轴横跨全部事件并向外延伸。
    expect(layout.axis.x).toBeLessThan(first.x)
    expect(layout.axis.x + layout.axis.width).toBeGreaterThan(last.x)
    expect(layout.axis.height).toBeGreaterThan(0)

    // 上下两层相对主轴对称，间隔为基础间距 + 错开层数。
    const deepestAbove = layout.events
      .filter(event => event.side === 'above')
      .reduce((deepest, event) => (event.y < deepest.y ? event : deepest))
    expect(layout.axis.y - (deepestAbove.y + deepestAbove.height))
      .toBe(TIMELINE_LABEL_AXIS_GAP + deepestAbove.staggerLevel * TIMELINE_STAGGER_STEP)
  })

  it('keeps branches collapsed by default and only shows main line events', () => {
    const mainEvent = makeEvent('m1', 10, { title: '主线事件' })
    const branchEvent = makeEvent('b1', 20, { title: '支线事件', branchId: 'side-branch' })
    const branches = [
      { id: 'main', name: '主时间轴', sourceEventId: null, sortOrder: 0 },
      { id: 'side-branch', name: '暗线分支', sourceEventId: 'm1', sortOrder: 1 },
    ]

    // 默认折叠：expandedBranchIds 仅 main
    const layout = buildStoryTimelineLayout([mainEvent, branchEvent], branches, ['main'])
    expect(layout.events.map(e => e.id)).toEqual(['m1'])
    // 源事件标记有 1 条支线，且处于未展开状态
    expect(layout.events[0].childBranchCount).toBe(1)
    expect(layout.events[0].isExpanded).toBe(false)
  })

  it('lays out branch events to the right of source event when expanded and creates branch edge', () => {
    const mainEvent = makeEvent('m1', 10, { title: '主线事件' })
    const branchEvent1 = makeEvent('b1', 20, { title: '支线事件 1', branchId: 'side-branch' })
    const branchEvent2 = makeEvent('b2', 30, { title: '支线事件 2', branchId: 'side-branch' })
    const branches = [
      { id: 'main', name: '主时间轴', sourceEventId: null, sortOrder: 0 },
      { id: 'side-branch', name: '暗线分支', sourceEventId: 'm1', sortOrder: 1, color: '#10b981' },
    ]

    const layout = buildStoryTimelineLayout(
      [mainEvent, branchEvent1, branchEvent2],
      branches,
      ['main', 'side-branch'],
    )

    expect(layout.events.map(e => e.id)).toEqual(['m1', 'b1', 'b2'])
    const m1 = layout.events.find(e => e.id === 'm1')!
    const b1 = layout.events.find(e => e.id === 'b1')!
    const b2 = layout.events.find(e => e.id === 'b2')!

    // 支线事件必须严格位于源事件的右侧（向后发展）
    expect(b1.x).toBeGreaterThan(m1.x)
    expect(b2.x).toBeGreaterThan(b1.x)
    // 支线事件处于不同的 Y 泳道
    expect(b1.y).not.toBe(m1.y)
    expect(b2.y).toBe(b1.y)

    // 源事件标记为已展开
    expect(m1.childBranchCount).toBe(1)
    expect(m1.isExpanded).toBe(true)

    // 包含 branch 类型的平滑连接线与支线内部顺序连线
    const branchEdge = layout.edges.find(e => e.type === 'timeline-branch')
    expect(branchEdge).toBeDefined()
    expect(branchEdge?.source).toBe('m1')
    expect(branchEdge?.target).toBe('b1')
    expect(branchEdge?.color).toBe('#10b981')
    // 分叉曲线走向由源/目标相对位置决定，供渲染层选择控制点方向
    expect(branchEdge?.direction === 'up' || branchEdge?.direction === 'down').toBe(true)

    const seqEdge = layout.edges.find(e => e.id === 'branch-seq-b1-b2')
    expect(seqEdge).toBeDefined()
  })

  it('symmetrically staggers multiple events on the same tick above and below without overlapping', () => {
    const eventA = makeEvent('a', 10, { title: '事件 A' })
    const eventB = makeEvent('b', 10, { title: '事件 B' })
    const eventC = makeEvent('c', 10, { title: '事件 C' })
    const eventD = makeEvent('d', 10, { title: '事件 D' })

    const layout = buildStoryTimelineLayout([eventA, eventB, eventC, eventD])
    expect(layout.events).toHaveLength(4)

    const a = layout.events.find(e => e.id === 'a')!
    const b = layout.events.find(e => e.id === 'b')!
    const c = layout.events.find(e => e.id === 'c')!
    const d = layout.events.find(e => e.id === 'd')!

    // 同一刻度多事件共享同一水平基准列
    expect(a.x).toBe(b.x)
    expect(b.x).toBe(c.x)
    expect(c.x).toBe(d.x)

    // 上下对称分布
    expect(a.side).toBe('above')
    expect(b.side).toBe('below')
    expect(c.side).toBe('above')
    expect(d.side).toBe('below')

    // 垂直方向不重叠：同侧逐层错开
    expect(c.y).toBeLessThan(a.y)
    expect(d.y).toBeGreaterThan(b.y)
    expect(a.y).not.toBe(b.y)
    expect(c.y).not.toBe(d.y)
  })

  it('calculates start and end anchor coordinates and properties accurately', () => {
    const customSettings = {
      title: '主线故事',
      rulerLabel: '年代',
      rulerUnit: '年',
      startLabel: '起源纪元',
      startTimeLabel: '前 100 年',
      startOrder: 5,
      endLabel: '终局之战',
      endTimeLabel: '后 200 年',
      endOrder: 25,
      hasCustomRange: true,
    }

    const layout = buildStoryTimelineLayout([], [], ['main'], customSettings)
    expect(layout.startAnchor).toEqual({
      id: 'timeline-anchor-start',
      anchorType: 'start',
      label: '起源纪元',
      timeLabel: '前 100 年',
      order: 5,
      x: expect.any(Number),
      y: expect.any(Number),
      width: 120,
      height: 42,
    })
    expect(layout.endAnchor).toEqual({
      id: 'timeline-anchor-end',
      anchorType: 'end',
      label: '终局之战',
      timeLabel: '后 200 年',
      order: 25,
      x: expect.any(Number),
      y: expect.any(Number),
      width: 120,
      height: 42,
    })
    expect(layout.startAnchor.x).toBeLessThan(layout.endAnchor.x)
    expect(layout.axis.width).toBeGreaterThanOrEqual(1000)
  })

  it('clamps events with sortOrder outside [startOrder, endOrder] within timeline boundaries', () => {
    const customSettings = {
      title: '范围测试',
      rulerLabel: '刻度',
      rulerUnit: '点',
      startLabel: '开端',
      startTimeLabel: '0',
      startOrder: 10,
      endLabel: '结束',
      endTimeLabel: '30',
      endOrder: 30,
      hasCustomRange: true,
    }

    const under = makeEvent('under', 2, { title: '太早的事件' })
    const normal = makeEvent('normal', 20, { title: '正常事件' })
    const over = makeEvent('over', 99, { title: '太晚的事件' })

    const layout = buildStoryTimelineLayout([under, normal, over], [], ['main'], customSettings)
    const underPlaced = layout.events.find(e => e.id === 'under')!
    const normalPlaced = layout.events.find(e => e.id === 'normal')!
    const overPlaced = layout.events.find(e => e.id === 'over')!

    // 边界保护：超出范围的刻度被约束在锚点区间内，不会溢出到主干之外
    expect(underPlaced.x).toBeGreaterThanOrEqual(layout.startAnchor.x)
    expect(overPlaced.x).toBeLessThanOrEqual(layout.endAnchor.x)
    expect(normalPlaced.x).toBeGreaterThan(underPlaced.x)
    expect(overPlaced.x).toBeGreaterThan(normalPlaced.x)
  })
})

describe('story timeline layout acceptance scenarios', () => {
  /** 每个验收场景都必须给出有限坐标，绝不出现 NaN/Infinity。 */
  function expectFiniteLayout(layout: ReturnType<typeof buildStoryTimelineLayout>) {
    const points: Array<[string, number]> = [
      ['axis.x', layout.axis.x],
      ['axis.y', layout.axis.y],
      ['axis.width', layout.axis.width],
      ['startAnchor.x', layout.startAnchor.x],
      ['startAnchor.y', layout.startAnchor.y],
      ['endAnchor.x', layout.endAnchor.x],
      ['endAnchor.y', layout.endAnchor.y],
      ['canvasWidth', layout.canvasWidth],
      ['canvasHeight', layout.canvasHeight],
    ]
    layout.events.forEach((event) => {
      points.push([`event ${event.id} x`, event.x], [`event ${event.id} y`, event.y], [`event ${event.id} width`, event.width], [`event ${event.id} height`, event.height])
    })
    layout.branchLabels.forEach(label => points.push([`label ${label.branchId} x`, label.x], [`label ${label.branchId} y`, label.y]))
    for (const [name, value] of points) {
      expect(Number.isFinite(value), `${name} must be finite`).toBe(true)
    }
  }

  /** 同一支线泳道内（或主轴线上）任意两个节点矩形不得相交。 */
  function expectNoOverlap(events: Array<{ id: string; x: number; y: number; width: number; height: number }>) {
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i]
        const b = events[j]
        const separated = a.x + a.width <= b.x
          || b.x + b.width <= a.x
          || a.y + a.height <= b.y
          || b.y + b.height <= a.y
        expect(separated, `nodes ${a.id} and ${b.id} must not overlap`).toBe(true)
      }
    }
  }

  function branch(id: string, name: string, sourceEventId: string | null, sortOrder: number) {
    return { id, name, sourceEventId, sortOrder }
  }

  it('empty timeline: finite geometry with anchors only', () => {
    const layout = buildStoryTimelineLayout([])
    expect(layout.events).toEqual([])
    expectFiniteLayout(layout)
  })

  it('single event: finite geometry, readable label, no overlaps possible', () => {
    const layout = buildStoryTimelineLayout([makeEvent('solo', 3, { title: '唯一事件' })])
    expectFiniteLayout(layout)
    expect(layout.events).toHaveLength(1)
    expect(layout.axisDots).toHaveLength(1)
  })

  it('six main events plus one branch: finite, branch right of source, labels emitted', () => {
    const mainEvents = [1, 2, 3, 4, 5, 6].map(order => makeEvent(`m${order}`, order * 2, {
      title: `主线事件 ${order}`,
      description: order % 2 === 0 ? '带一句描述验证两行截断不会撑爆布局。' : '',
    }))
    const branchEvents = [makeEvent('b1', 5, { title: '支线首事件', branchId: 'br1' })]
    const layout = buildStoryTimelineLayout(
      [...mainEvents, ...branchEvents],
      [
        branch('main', '主时间轴', null, 0),
        branch('br1', '暗河支线', 'm3', 1),
      ],
      ['main', 'br1'],
    )
    expectFiniteLayout(layout)
    expect(layout.events).toHaveLength(7)
    expect(layout.branchLabels.map(label => label.branchId)).toEqual(['br1'])
    const m3 = layout.events.find(event => event.id === 'm3')!
    const b1 = layout.events.find(event => event.id === 'b1')!
    expect(b1.x).toBeGreaterThan(m3.x)
    expectNoOverlap(layout.events)
  })

  it('eight events on the same tick: symmetric stagger with zero overlap', () => {
    const sameTick = Array.from({ length: 8 }, (_, index) => makeEvent(`t${index}`, 7, {
      title: `同刻度事件${index}`,
      description: index % 2 === 0 ? '同刻度事件的描述文本，验证避让。' : '',
    }))
    const layout = buildStoryTimelineLayout(sameTick)
    expectFiniteLayout(layout)
    // 同刻度共享同一水平基准列
    const xs = new Set(layout.events.map(event => event.x))
    expect(xs.size).toBe(1)
    // 上下对称交错并逐层外推，任意两个节点都不相交
    expectNoOverlap(layout.events)
    // 同侧最多逐层下探，不会无限横向挤压
    const levels = layout.events.map(event => event.staggerLevel)
    expect(Math.max(...levels)).toBeLessThanOrEqual(4)
  })

  it('three branches from one source: distinct stable lanes, no overlap', () => {
    const mainEvent = makeEvent('m1', 10, { title: '分叉源' })
    const branches = [
      branch('main', '主时间轴', null, 0),
      branch('ba', '支线甲', 'm1', 1),
      branch('bb', '支线乙', 'm1', 2),
      branch('bc', '支线丙', 'm1', 3),
    ]
    const branchEvents = [
      makeEvent('ba-1', 12, { title: '甲线事件', branchId: 'ba' }),
      makeEvent('bb-1', 13, { title: '乙线事件', branchId: 'bb' }),
      makeEvent('bc-1', 14, { title: '丙线事件', branchId: 'bc' }),
    ]
    const layout = buildStoryTimelineLayout([mainEvent, ...branchEvents], branches, ['main', 'ba', 'bb', 'bc'])
    expectFiniteLayout(layout)
    expect(layout.branchLabels).toHaveLength(3)
    // 三条支线占据互不相同的泳道高度
    const lanes = new Set(layout.events.filter(event => event.branchId !== 'main').map(event => event.y))
    expect(lanes.size).toBe(3)
    expectNoOverlap(layout.events)
  })

  it('three-level nesting: chains extend rightwards with finite stable geometry', () => {
    const mainEvent = makeEvent('m1', 10, { title: '根事件' })
    const branches = [
      branch('main', '主时间轴', null, 0),
      branch('L1', '一级支线', 'm1', 1),
      branch('L2', '二级支线', 'n1', 2),
      branch('L3', '三级支线', 'n2', 3),
    ]
    const nested = [
      makeEvent('n1', 12, { title: '一级支线事件', branchId: 'L1' }),
      makeEvent('n2', 14, { title: '二级支线事件', branchId: 'L2' }),
      makeEvent('n3', 16, { title: '三级支线事件', branchId: 'L3' }),
    ]
    const layout = buildStoryTimelineLayout([mainEvent, ...nested], branches, ['main', 'L1', 'L2', 'L3'])
    expectFiniteLayout(layout)
    expect(layout.events).toHaveLength(4)
    // 每一层都严格向右发展
    const order = ['m1', 'n1', 'n2', 'n3'].map(id => layout.events.find(event => event.id === id)!)
    for (let i = 1; i < order.length; i++) {
      expect(order[i].x).toBeGreaterThan(order[i - 1].x)
    }
    expectNoOverlap(layout.events)
  })

  it('long titles clamp width, grow height, and still avoid overlap', () => {
    const longTitle = '这是一个特别特别特别长的事件标题用来验证换行与避让'
    const layout = buildStoryTimelineLayout(
      [10, 11, 12].map((order, index) => makeEvent(`long-${index}`, order, {
        title: longTitle + (index > 0 ? '再加一段' : ''),
        description: '同样很长的描述也参与高度估算，保证相邻节点不重叠。',
      })),
    )
    expectFiniteLayout(layout)
    for (const event of layout.events) {
      expect(event.width).toBeLessThanOrEqual(TIMELINE_LABEL_MAX_WIDTH)
      expect(event.height).toBeLessThanOrEqual(TIMELINE_LABEL_MAX_HEIGHT)
    }
    expectNoOverlap(layout.events)
  })

  it('100+ events: monotonic order, finite geometry, main line without overlap', () => {
    const many = Array.from({ length: 120 }, (_, index) => makeEvent(`mass-${index}`, index + 1, {
      title: `批量事件 ${index + 1}`,
      description: index % 5 === 0 ? '每五个事件带一条描述。' : '',
    }))
    const layout = buildStoryTimelineLayout(many)
    expectFiniteLayout(layout)
    expect(layout.events).toHaveLength(120)
    // 按 sortOrder 从左到右单调
    for (let i = 1; i < layout.events.length; i++) {
      expect(layout.events[i].x).toBeGreaterThanOrEqual(layout.events[i - 1].x)
    }
    expectNoOverlap(layout.events)
  })

  it('collapsing one branch never moves unrelated nodes (stable lanes and axis baseline)', () => {
    const mainEvents = [1, 2, 3].map(order => makeEvent(`m${order}`, order * 3, { title: `主线 ${order}` }))
    const branches = [
      branch('main', '主时间轴', null, 0),
      branch('alpha', '甲支线', 'm1', 1),
      branch('beta', '乙支线', 'm2', 2),
      branch('gamma', '丙支线', 'm3', 3),
    ]
    const allEvents = [
      ...mainEvents,
      makeEvent('alpha-1', 4, { title: '甲事件', branchId: 'alpha' }),
      makeEvent('beta-1', 7, { title: '乙事件', branchId: 'beta' }),
      makeEvent('gamma-1', 10, { title: '丙事件', branchId: 'gamma' }),
    ]

    const expandedAll = buildStoryTimelineLayout(allEvents, branches, ['main', 'alpha', 'beta', 'gamma'])
    // 折叠 gamma（例如其父事件所在支线被收起）后，其余节点必须原地不动
    const collapsedGamma = buildStoryTimelineLayout(allEvents, branches, ['main', 'alpha', 'beta'])

    const positionKey = (event: { id: string; x: number; y: number; width: number; height: number }) =>
      `${event.x}:${event.y}:${event.width}:${event.height}`
    const before = new Map(expandedAll.events.map(event => [event.id, positionKey(event)]))
    const after = new Map(collapsedGamma.events.map(event => [event.id, positionKey(event)]))

    // 主轴与甲、乙支线的事件完全不动
    for (const event of collapsedGamma.events) {
      expect(after.get(event.id), `node ${event.id} must keep its position`).toBe(before.get(event.id))
    }
    // 被折叠支线的事件从布局中消失
    expect(before.has('gamma-1')).toBe(true)
    expect(after.has('gamma-1')).toBe(false)
    // 轴基线与两端锚点不动
    expect(collapsedGamma.axis.y).toBe(expandedAll.axis.y)
    expect(collapsedGamma.startAnchor.y).toBe(expandedAll.startAnchor.y)
    expect(collapsedGamma.endAnchor.y).toBe(expandedAll.endAnchor.y)
  })

  it('layout is a pure function: identical input yields identical output and never writes to events', () => {
    const events = [
      makeEvent('p1', 2, { title: '纯函数', branchId: 'pb' }),
      makeEvent('p0', 1, { title: '主线上' }),
    ]
    const branches = [branch('main', '主时间轴', null, 0), branch('pb', '支线', 'p0', 1)]
    const first = buildStoryTimelineLayout(events, branches, ['main', 'pb'])
    const second = buildStoryTimelineLayout(events, branches, ['main', 'pb'])
    expect(second).toEqual(first)
    for (const event of events) {
      expect(Object.keys(event)).not.toContain('x')
      expect(Object.keys(event)).not.toContain('y')
      expect(Object.keys(event)).not.toContain('side')
      expect(Object.keys(event)).not.toContain('position')
    }
  })
})

describe('story timeline mention parsing', () => {
  it('extracts @character and [[character]] mentions from description', () => {
    const text = '在雾港与 @许渡 碰头，随后寻找 [[沈砚]] 和 [[周晓]]。'
    const mentions = parseStoryTimelineMentions(text)

    expect(mentions).toEqual([
      { raw: '[[沈砚]]', name: '沈砚', type: 'character' },
      { raw: '[[周晓]]', name: '周晓', type: 'character' },
      { raw: '@许渡', name: '许渡', type: 'character' },
    ])
  })

  it('deduplicates multiple mentions of the same character and avoids empty matches', () => {
    const text = '@许渡 再次出现，许渡在想什么？@许渡 离开了。'
    const mentions = parseStoryTimelineMentions(text)

    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toEqual({ raw: '@许渡', name: '许渡', type: 'character' })
  })

  it('returns empty array when no mentions are found', () => {
    expect(parseStoryTimelineMentions('')).toEqual([])
    expect(parseStoryTimelineMentions('普通纯文本描述，没有任何引用标记')).toEqual([])
  })
})
