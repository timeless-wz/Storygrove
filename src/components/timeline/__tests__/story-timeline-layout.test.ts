import { describe, expect, it } from 'vitest'

import type { StoryTimelineEvent, StoryTimelinePrecision } from '../../../shared/story-timeline'
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

    // 时间轴标注字段就是全部可见内容：状态/描述/章节/角色/地点一律不到时间轴。
    expect(Object.keys(layout.events[0]).sort()).toEqual([
      'height',
      'id',
      'side',
      'staggerLevel',
      'timeText',
      'title',
      'width',
      'x',
      'y',
    ])
    expect(layout.events[0].title).toBe('标题')
    expect(layout.events[0].timeText).toBe('时间')
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
})
