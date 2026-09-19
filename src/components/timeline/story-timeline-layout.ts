import type { StoryTimelineEvent } from '../../shared/story-timeline'

/**
 * 故事时间轴的纯布局计算。
 *
 * 视觉位置完全由 sortOrder 推导，绝不回写、也绝不持久化：节点坐标是每次渲染
 * 现算的投影，作者调整顺序只改 sortOrder，坐标随之重算。这里刻意不引入任何
 * “支线/泳道”数据字段——上下分布只是排版，交替与错开都由排序刻度与标注宽度
 * 决定。
 */

/** 每个排序刻度单位对应的像素宽度：横轴距离与 sortOrder 差值成正比。 */
export const TIMELINE_PIXELS_PER_ORDER = 160
/**
 * 相邻事件的横向最小步长。刻度接近（或相等）的事件会因此“过密”，
 * 此时由同侧垂直错开而不是拉宽横轴来避免标题重叠。
 */
export const TIMELINE_MIN_COLUMN_SPACING = 110
/** 标注宽度上下限与其字符估算宽度。 */
export const TIMELINE_LABEL_MIN_WIDTH = 140
export const TIMELINE_LABEL_MAX_WIDTH = 240
export const TIMELINE_LABEL_CHAR_WIDTH = 12.5
export const TIMELINE_LABEL_HORIZONTAL_PADDING = 28
export const TIMELINE_LABEL_HEIGHT = 58
/** 主轴到最近一层标注的垂直距离，以及同一侧错开的每层步长。 */
export const TIMELINE_LABEL_AXIS_GAP = 30
export const TIMELINE_STAGGER_STEP = 66
/** 同一侧相邻标注之间必须保留的最小水平空隙。 */
export const TIMELINE_MIN_LABEL_GAP = 12
/** 主轴与画布留白。 */
export const TIMELINE_AXIS_OVERHANG = 90
export const TIMELINE_CANVAS_MARGIN = 48

export type StoryTimelineLabelSide = 'above' | 'below'

export interface StoryTimelineLayoutEvent {
  id: string
  side: StoryTimelineLabelSide
  /** 0 为紧贴主轴的一层；同一侧过密时递增，避免标题重叠。 */
  staggerLevel: number
  x: number
  y: number
  width: number
  height: number
  timeText: string
  title: string
}

export interface StoryTimelineLayout {
  events: StoryTimelineLayoutEvent[]
  axis: { x: number; y: number; width: number; height: number }
  canvasWidth: number
  canvasHeight: number
}

/** 按 sortOrder 从左到右排序；同刻度时用 id 兜底，保证渲染确定。 */
export function sortTimelineEvents(events: readonly StoryTimelineEvent[]): StoryTimelineEvent[] {
  return [...events].sort((left, right) => (
    left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
  ))
}

/**
 * 轴标注只展示自定义时间与标题。范围事件展示起止时间，其余只展示单一时间标签。
 */
export function formatTimelineEventTime(event: StoryTimelineEvent): string {
  const start = (event.timeLabel ?? '').trim()
  const end = (event.rangeEndLabel ?? '').trim()
  if (event.precision === 'range' && end) {
    return start ? `${start} — ${end}` : end
  }
  return start
}

/** 标注宽度由内容估算；布局与渲染共用同一函数，因此重叠判断是精确的。 */
export function estimateTimelineLabelWidth(event: StoryTimelineEvent): number {
  const timeText = formatTimelineEventTime(event)
  const longest = Math.max(
    Array.from(timeText).length,
    Array.from(event.title ?? '').length,
  )
  const estimated = longest * TIMELINE_LABEL_CHAR_WIDTH + TIMELINE_LABEL_HORIZONTAL_PADDING
  return Math.min(TIMELINE_LABEL_MAX_WIDTH, Math.max(TIMELINE_LABEL_MIN_WIDTH, estimated))
}

interface PlacedLabel {
  event: StoryTimelineEvent
  side: StoryTimelineLabelSide
  staggerLevel: number
  width: number
  /** 相对主轴的顶边偏移；主轴之上的标注为负值。 */
  relativeTop: number
}

export function buildStoryTimelineLayout(events: readonly StoryTimelineEvent[]): StoryTimelineLayout {
  const ordered = sortTimelineEvents(events)
  if (ordered.length === 0) {
    return {
      events: [],
      axis: { x: 0, y: 0, width: 0, height: 2 },
      canvasWidth: TIMELINE_CANVAS_MARGIN * 2,
      canvasHeight: TIMELINE_CANVAS_MARGIN * 2,
    }
  }

  // 横轴与 sortOrder 差值成正比；最小步长只用于避免刻度接近的事件在横轴上塌陷，
  // 它刻意小于标注宽度，因此“过密”会真实发生并由垂直错开解决。
  const minSortOrder = ordered[0].sortOrder
  const columnX: number[] = []
  let previousX: number | null = null
  for (const event of ordered) {
    const desiredX = (event.sortOrder - minSortOrder) * TIMELINE_PIXELS_PER_ORDER
    const x: number = previousX === null
      ? desiredX
      : Math.max(desiredX, previousX + TIMELINE_MIN_COLUMN_SPACING)
    columnX.push(x)
    previousX = x
  }

  const placed: PlacedLabel[] = []
  // 同侧只与同侧比较：上下交错本身已经把相邻事件分到两侧。
  const lastPlacedBySide: Record<StoryTimelineLabelSide, { width: number; staggerLevel: number } | undefined> = {
    above: undefined,
    below: undefined,
  }

  ordered.forEach((event, index) => {
    const side: StoryTimelineLabelSide = index % 2 === 0 ? 'above' : 'below'
    const width = estimateTimelineLabelWidth(event)
    const previous = lastPlacedBySide[side]

    let staggerLevel = 0
    if (previous && index >= 2) {
      const requiredGap = previous.width / 2 + width / 2 + TIMELINE_MIN_LABEL_GAP
      if (columnX[index] - columnX[index - 2] < requiredGap) {
        staggerLevel = previous.staggerLevel + 1
      }
    }

    const offsetFromAxis = TIMELINE_LABEL_AXIS_GAP + staggerLevel * TIMELINE_STAGGER_STEP
    const relativeTop = side === 'above'
      ? -offsetFromAxis - TIMELINE_LABEL_HEIGHT
      : offsetFromAxis

    placed.push({ event, side, staggerLevel, width, relativeTop })
    lastPlacedBySide[side] = { width, staggerLevel }
  })

  const minRelativeTop = Math.min(...placed.map(label => label.relativeTop))
  const maxRelativeBottom = Math.max(...placed.map(label => label.relativeTop + TIMELINE_LABEL_HEIGHT))
  const verticalOffset = TIMELINE_CANVAS_MARGIN - minRelativeTop
  const span = columnX[columnX.length - 1] - columnX[0]

  return {
    events: placed.map((label, index) => ({
      id: label.event.id,
      side: label.side,
      staggerLevel: label.staggerLevel,
      x: TIMELINE_CANVAS_MARGIN + columnX[index],
      y: verticalOffset + label.relativeTop,
      width: label.width,
      height: TIMELINE_LABEL_HEIGHT,
      timeText: formatTimelineEventTime(label.event),
      title: label.event.title,
    })),
    axis: {
      x: TIMELINE_CANVAS_MARGIN - TIMELINE_AXIS_OVERHANG,
      y: verticalOffset,
      width: span + TIMELINE_AXIS_OVERHANG * 2,
      height: 2,
    },
    canvasWidth: span + (TIMELINE_CANVAS_MARGIN + TIMELINE_AXIS_OVERHANG) * 2,
    canvasHeight: maxRelativeBottom - minRelativeTop + TIMELINE_CANVAS_MARGIN * 2,
  }
}
