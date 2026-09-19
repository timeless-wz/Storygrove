import { describe, expect, it } from 'vitest'

import type { StoryTimelineEvent, StoryTimelinePrecision } from '../../../shared/story-timeline'
import { parseStoryTimelineMentions } from '../../../shared/story-timeline'
import {
  buildStoryTimelineLayout,
  estimateTimelineLabelWidth,
  formatTimelineEventTime,
  sortTimelineEvents,
  TIMELINE_LABEL_AXIS_GAP,
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
    expect(above[0].x).toBeLessThan(above[1].x)
  })

  it('keeps dense but short labels on a single layer', () => {
    const layout = buildStoryTimelineLayout(
      [0, 1, 2].map(index => makeEvent(`e${index}`, 7, { title: 'A', timeLabel: 'B' })),
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

  it('exposes only the custom time and the title on an axis label', () => {
    const layout = buildStoryTimelineLayout([makeEvent('only', 1, {
      title: '标题',
      timeLabel: '时间',
      description: '描述不应出现在时间轴上',
      chapterNumbers: [3, 4],
      characterNames: ['许渡'],
      locationNodeIds: ['loc-1'],
      status: 'finalized',
    })])

    // 时间轴标注字段不包含大段描述与关联元数据，但包含分支与层级状态
    expect(Object.keys(layout.events[0]).sort()).toEqual([
      'branchId',
      'childBranchCount',
      'height',
      'id',
      'isExpanded',
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
  })

  it('clamps estimated label width between the configured bounds', () => {
    expect(estimateTimelineLabelWidth(makeEvent('tiny', 1, { title: 'A', timeLabel: 'B' })))
      .toBe(TIMELINE_LABEL_MIN_WIDTH)
    expect(estimateTimelineLabelWidth(makeEvent('huge', 1, { title: 'x'.repeat(120) })))
      .toBe(TIMELINE_LABEL_MAX_WIDTH)
  })

  it('returns an empty axis for an empty timeline without inventing events', () => {
    const layout = buildStoryTimelineLayout([])

    expect(layout.events).toEqual([])
    expect(layout.axis.width).toBe(0)
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

    const seqEdge = layout.edges.find(e => e.id === 'branch-seq-b1-b2')
    expect(seqEdge).toBeDefined()
  })

  it('supports multiple events at the same sortOrder timepoint', () => {
    const eventA = makeEvent('a', 10, { title: '事件 A' })
    const eventB = makeEvent('b', 10, { title: '事件 B' })

    const layout = buildStoryTimelineLayout([eventA, eventB])
    expect(layout.events).toHaveLength(2)
    // 两个事件均被布局且互不重叠
    const a = layout.events.find(e => e.id === 'a')!
    const b = layout.events.find(e => e.id === 'b')!
    expect(a.y).not.toBe(b.y)
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
