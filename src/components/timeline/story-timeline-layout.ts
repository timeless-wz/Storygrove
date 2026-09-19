import type {
  StoryTimelineBranch,
  StoryTimelineEvent,
  StoryTimelineEventStatus,
  StoryTimelineResolvedRange,
  StoryTimelineSettings,
} from '../../shared/story-timeline'
import {
  resolveStoryTimelineRange,
  STORY_TIMELINE_MAIN_BRANCH_ID,
} from '../../shared/story-timeline'

/**
 * 故事时间轴/时间树的纯布局计算。
 *
 * 视觉位置完全由 sortOrder 与分支归属推导，绝不回写、也绝不持久化。
 * 主轴（main）时间从左向右推进；支线（branch）从源事件向后发散；
 * 同一时间点允许多个重大事件，并在同列垂直对称错开。
 * 主轴两端固定为非事件锚点（故事开端与故事结束），限定故事范围。
 */

export const TIMELINE_PIXELS_PER_ORDER = 160
export const TIMELINE_MIN_COLUMN_SPACING = 110
export const TIMELINE_MIN_TRUNK_WIDTH = 1000
export const TIMELINE_ANCHOR_WIDTH = 120
export const TIMELINE_ANCHOR_HEIGHT = 42
export const TIMELINE_LABEL_MIN_WIDTH = 140
export const TIMELINE_LABEL_MAX_WIDTH = 240
export const TIMELINE_LABEL_CHAR_WIDTH = 12.5
export const TIMELINE_LABEL_HORIZONTAL_PADDING = 28
export const TIMELINE_LABEL_HEIGHT = 58
export const TIMELINE_LABEL_AXIS_GAP = 30
export const TIMELINE_STAGGER_STEP = 66
export const TIMELINE_MIN_LABEL_GAP = 12
export const TIMELINE_BRANCH_GAP_X = 70
export const TIMELINE_BRANCH_LANE_HEIGHT = 130
export const TIMELINE_AXIS_OVERHANG = 90
export const TIMELINE_CANVAS_MARGIN = 48

export type StoryTimelineLabelSide = 'above' | 'below' | 'center'

export interface StoryTimelineAnchor {
  id: 'timeline-anchor-start' | 'timeline-anchor-end'
  anchorType: 'start' | 'end'
  label: string
  timeLabel: string
  order: number
  x: number
  y: number
  width: number
  height: number
}

export interface StoryTimelineLayoutEvent {
  id: string
  branchId: string
  parentEventId: string | null
  side: StoryTimelineLabelSide
  staggerLevel: number
  x: number
  y: number
  width: number
  height: number
  timeText: string
  title: string
  status: StoryTimelineEventStatus
  childBranchCount: number
  isExpanded: boolean
}

export interface StoryTimelineLayoutEdge {
  id: string
  source: string
  target: string
  type: 'timeline-trunk' | 'timeline-branch'
  branchId: string
  color?: string
}

export interface StoryTimelineLayout {
  startAnchor: StoryTimelineAnchor
  endAnchor: StoryTimelineAnchor
  events: StoryTimelineLayoutEvent[]
  edges: StoryTimelineLayoutEdge[]
  axis: { x: number; y: number; width: number; height: number }
  canvasWidth: number
  canvasHeight: number
  range: StoryTimelineResolvedRange
}

/** 按 sortOrder 从左到右排序；同刻度时用 id 兜底，保证渲染确定。 */
export function sortTimelineEvents(events: readonly StoryTimelineEvent[]): StoryTimelineEvent[] {
  return [...events].sort((left, right) => (
    left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
  ))
}

/** 轴标注只展示自定义时间与标题。范围事件展示起止时间，其余只展示单一时间标签。 */
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

const BRANCH_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
]

/**
 * 递归计算分支展开层级与可见性。
 */
function getVisibleBranchIds(
  branches: readonly StoryTimelineBranch[],
  expandedBranchIds: ReadonlySet<string>,
): Set<string> {
  const visible = new Set<string>([STORY_TIMELINE_MAIN_BRANCH_ID])

  let changed = true
  while (changed) {
    changed = false
    for (const branch of branches) {
      if (branch.id === STORY_TIMELINE_MAIN_BRANCH_ID) continue
      if (visible.has(branch.id)) continue
      if (!expandedBranchIds.has(branch.id)) continue
      visible.add(branch.id)
      changed = true
    }
  }

  return visible
}

export function buildStoryTimelineLayout(
  events: readonly StoryTimelineEvent[],
  branches: readonly StoryTimelineBranch[] = [],
  expandedBranchIds: readonly string[] | ReadonlySet<string> = [STORY_TIMELINE_MAIN_BRANCH_ID],
  settings?: StoryTimelineSettings,
): StoryTimelineLayout {
  const range = resolveStoryTimelineRange(settings, events)
  const expandedSet = expandedBranchIds instanceof Set
    ? expandedBranchIds
    : new Set(expandedBranchIds)

  // 补全主分支定义
  const allBranches: StoryTimelineBranch[] = branches.length > 0
    ? [...branches]
    : [{ id: STORY_TIMELINE_MAIN_BRANCH_ID, name: '主时间轴', sourceEventId: null, sortOrder: 0 }]
  if (!allBranches.some(b => b.id === STORY_TIMELINE_MAIN_BRANCH_ID)) {
    allBranches.unshift({ id: STORY_TIMELINE_MAIN_BRANCH_ID, name: '主时间轴', sourceEventId: null, sortOrder: 0 })
  }

  const visibleBranchIds = getVisibleBranchIds(allBranches, expandedSet)

  // 统计每个事件派生出的子分支
  const childBranchesBySource = new Map<string, StoryTimelineBranch[]>()
  for (const branch of allBranches) {
    if (branch.sourceEventId) {
      const list = childBranchesBySource.get(branch.sourceEventId) ?? []
      list.push(branch)
      childBranchesBySource.set(branch.sourceEventId, list)
    }
  }

  // 按分支将可见事件分组
  const eventsByBranch = new Map<string, StoryTimelineEvent[]>()
  for (const event of events) {
    const branchId = event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID
    if (!visibleBranchIds.has(branchId)) continue
    const list = eventsByBranch.get(branchId) ?? []
    list.push(event)
    eventsByBranch.set(branchId, list)
  }

  const mainEvents = sortTimelineEvents(eventsByBranch.get(STORY_TIMELINE_MAIN_BRANCH_ID) ?? [])

  const startAnchorWidth = TIMELINE_ANCHOR_WIDTH
  const endAnchorWidth = TIMELINE_ANCHOR_WIDTH
  const startX = TIMELINE_CANVAS_MARGIN
  const trunkEventStartX = startX + startAnchorWidth + 40

  // 按 sortOrder 分组事件
  const eventsByOrder = new Map<number, StoryTimelineEvent[]>()
  for (const event of mainEvents) {
    const list = eventsByOrder.get(event.sortOrder) ?? []
    list.push(event)
    eventsByOrder.set(event.sortOrder, list)
  }

  const uniqueOrders = [...eventsByOrder.keys()].sort((a, b) => a - b)

  interface PlacedMainLabel {
    event: StoryTimelineEvent
    side: StoryTimelineLabelSide
    staggerLevel: number
    x: number
    width: number
  }

  const placedMainLabels: PlacedMainLabel[] = []
  let globalSideIndex = 0

  for (const order of uniqueOrders) {
    const group = eventsByOrder.get(order)!
    // 限制在起止故事范围刻度内
    const clampedOrder = Math.max(range.startOrder, Math.min(range.endOrder, order))
    const idealX = trunkEventStartX + (clampedOrder - range.startOrder) * TIMELINE_PIXELS_PER_ORDER

    group.forEach((event, indexInGroup) => {
      const width = estimateTimelineLabelWidth(event)

      // 同一刻度内多事件上下对称错开；单一事件顺延全局上下交错
      const baseSide: StoryTimelineLabelSide = group.length === 1
        ? (globalSideIndex++ % 2 === 0 ? 'above' : 'below')
        : (indexInGroup % 2 === 0 ? 'above' : 'below')

      let currentLevel = group.length === 1 ? 0 : Math.floor(indexInGroup / 2)

      // 检查与同侧同层已有标注的水平重叠，若重叠则逐层外推
      while (true) {
        const overlap = placedMainLabels.some(placed => {
          if (placed.side !== baseSide || placed.staggerLevel !== currentLevel) return false
          const x1 = idealX
          const x2 = idealX + width
          const p1 = placed.x
          const p2 = placed.x + placed.width
          return Math.max(x1, p1) < Math.min(x2, p2) + TIMELINE_MIN_LABEL_GAP
        })
        if (!overlap) break
        currentLevel++
      }

      placedMainLabels.push({
        event,
        side: baseSide,
        staggerLevel: currentLevel,
        x: idealX,
        width,
      })
    })
  }

  // 结束锚点位置与主干宽度计算：
  // 必须保证主干宽度不小于 TIMELINE_MIN_TRUNK_WIDTH (1000px)，且完全包裹最后一个事件与结束锚点
  const maxEventRight = placedMainLabels.reduce((max, p) => Math.max(max, p.x + p.width), trunkEventStartX)
  const naturalEndAnchorX = trunkEventStartX + (range.endOrder - range.startOrder) * TIMELINE_PIXELS_PER_ORDER + 40
  const minRequiredEndAnchorX = startX + startAnchorWidth + TIMELINE_MIN_TRUNK_WIDTH
  const endAnchorX = Math.max(minRequiredEndAnchorX, naturalEndAnchorX, maxEventRight + 40)

  const axisX = startX + startAnchorWidth / 2
  const axisWidth = endAnchorX + endAnchorWidth / 2 - axisX

  // 统计主轴上下最大错开层级与分支所需高度，推导安全 axisY
  const maxStaggerAbove = placedMainLabels
    .filter(p => p.side === 'above')
    .reduce((max, p) => Math.max(max, p.staggerLevel), 0)

  const childBranches = allBranches.filter(b => b.id !== STORY_TIMELINE_MAIN_BRANCH_ID && visibleBranchIds.has(b.id))
  const branchLanesAbove = Math.ceil(childBranches.length / 2)
  const minTopRequired = TIMELINE_CANVAS_MARGIN +
    (maxStaggerAbove + 1) * TIMELINE_STAGGER_STEP +
    TIMELINE_LABEL_HEIGHT +
    TIMELINE_LABEL_AXIS_GAP +
    branchLanesAbove * TIMELINE_BRANCH_LANE_HEIGHT

  const axisY = Math.max(TIMELINE_CANVAS_MARGIN + 120, minTopRequired)

  const startAnchor: StoryTimelineAnchor = {
    id: 'timeline-anchor-start',
    anchorType: 'start',
    label: range.startLabel,
    timeLabel: range.startTimeLabel,
    order: range.startOrder,
    x: startX,
    y: axisY - TIMELINE_ANCHOR_HEIGHT / 2,
    width: startAnchorWidth,
    height: TIMELINE_ANCHOR_HEIGHT,
  }

  const endAnchor: StoryTimelineAnchor = {
    id: 'timeline-anchor-end',
    anchorType: 'end',
    label: range.endLabel,
    timeLabel: range.endTimeLabel,
    order: range.endOrder,
    x: endAnchorX,
    y: axisY - TIMELINE_ANCHOR_HEIGHT / 2,
    width: endAnchorWidth,
    height: TIMELINE_ANCHOR_HEIGHT,
  }

  const placedEvents: StoryTimelineLayoutEvent[] = []
  const placedMap = new Map<string, StoryTimelineLayoutEvent>()
  const edges: StoryTimelineLayoutEdge[] = []

  // 放置主线事件
  for (const placed of placedMainLabels) {
    const childBranchesForEvent = childBranchesBySource.get(placed.event.id) ?? []
    const childBranchCount = childBranchesForEvent.length
    const isExpanded = childBranchesForEvent.some(b => expandedSet.has(b.id))

    const y = placed.side === 'above'
      ? axisY - TIMELINE_LABEL_AXIS_GAP - TIMELINE_LABEL_HEIGHT - placed.staggerLevel * TIMELINE_STAGGER_STEP
      : axisY + TIMELINE_LABEL_AXIS_GAP + placed.staggerLevel * TIMELINE_STAGGER_STEP

    const layoutEvent: StoryTimelineLayoutEvent = {
      id: placed.event.id,
      branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
      parentEventId: placed.event.parentEventId || null,
      side: placed.side,
      staggerLevel: placed.staggerLevel,
      x: placed.x,
      y,
      width: placed.width,
      height: TIMELINE_LABEL_HEIGHT,
      timeText: formatTimelineEventTime(placed.event),
      title: placed.event.title,
      status: placed.event.status,
      childBranchCount,
      isExpanded,
    }

    placedEvents.push(layoutEvent)
    placedMap.set(placed.event.id, layoutEvent)
  }

  // 2. 布局展开的支线（包括子支线）
  let branchLaneCounterAbove = 1
  let branchLaneCounterBelow = 1
  const branchLaneOffsets = new Map<string, number>()

  for (let i = 0; i < childBranches.length; i++) {
    const branch = childBranches[i]
    const goAbove = i % 2 === 0
    const lane = goAbove ? -branchLaneCounterAbove++ : branchLaneCounterBelow++
    branchLaneOffsets.set(branch.id, lane * TIMELINE_BRANCH_LANE_HEIGHT)
  }

  for (const branch of childBranches) {
    const bEvents = sortTimelineEvents(eventsByBranch.get(branch.id) ?? [])
    if (bEvents.length === 0) continue

    const sourcePlaced = branch.sourceEventId ? placedMap.get(branch.sourceEventId) : undefined
    const baseSourceX = sourcePlaced ? sourcePlaced.x + sourcePlaced.width + TIMELINE_BRANCH_GAP_X : trunkEventStartX
    const baseSourceY = sourcePlaced ? sourcePlaced.y : axisY
    const laneOffsetY = branchLaneOffsets.get(branch.id) ?? -TIMELINE_BRANCH_LANE_HEIGHT
    const branchY = baseSourceY + laneOffsetY

    const colorIndex = (Math.abs(laneOffsetY) / TIMELINE_BRANCH_LANE_HEIGHT - 1) % BRANCH_COLORS.length
    const branchColor = branch.color || BRANCH_COLORS[colorIndex] || '#3b82f6'

    let prevX = baseSourceX
    let prevPlaced: StoryTimelineLayoutEvent | null = null

    bEvents.forEach((event, idx) => {
      const width = estimateTimelineLabelWidth(event)
      const height = TIMELINE_LABEL_HEIGHT
      const childBranchesForEvent = childBranchesBySource.get(event.id) ?? []
      const childBranchCount = childBranchesForEvent.length
      const isExpanded = childBranchesForEvent.some(b => expandedSet.has(b.id))

      const x = idx === 0
        ? baseSourceX
        : Math.max(prevX + TIMELINE_MIN_COLUMN_SPACING, prevX + width + 24)

      const placed: StoryTimelineLayoutEvent = {
        id: event.id,
        branchId: branch.id,
        parentEventId: event.parentEventId || branch.sourceEventId || null,
        side: laneOffsetY < 0 ? 'above' : 'below',
        staggerLevel: 0,
        x,
        y: branchY,
        width,
        height,
        timeText: formatTimelineEventTime(event),
        title: event.title,
        status: event.status,
        childBranchCount,
        isExpanded,
      }

      placedEvents.push(placed)
      placedMap.set(event.id, placed)
      prevX = x

      if (idx === 0) {
        if (sourcePlaced) {
          edges.push({
            id: `branch-${branch.id}-${sourcePlaced.id}-${event.id}`,
            source: sourcePlaced.id,
            target: event.id,
            type: 'timeline-branch',
            branchId: branch.id,
            color: branchColor,
          })
        }
      } else if (prevPlaced) {
        edges.push({
          id: `branch-seq-${prevPlaced.id}-${event.id}`,
          source: prevPlaced.id,
          target: event.id,
          type: 'timeline-trunk',
          branchId: branch.id,
          color: branchColor,
        })
      }

      prevPlaced = placed
    })
  }

  // 3. 计算画布整体尺寸
  const allRight = [endAnchor.x + endAnchor.width, ...placedEvents.map(e => e.x + e.width)]
  const allY = [startAnchor.y, endAnchor.y, ...placedEvents.map(e => e.y)]
  const allBottom = [startAnchor.y + startAnchor.height, endAnchor.y + endAnchor.height, ...placedEvents.map(e => e.y + e.height)]

  const maxX = Math.max(...allRight)
  const minY = Math.min(...allY)
  const maxY = Math.max(...allBottom)

  return {
    startAnchor,
    endAnchor,
    events: placedEvents,
    edges,
    axis: {
      x: axisX,
      y: axisY,
      width: axisWidth,
      height: 2,
    },
    canvasWidth: maxX + TIMELINE_CANVAS_MARGIN,
    canvasHeight: Math.max(500, maxY - minY + TIMELINE_CANVAS_MARGIN * 2),
    range,
  }
}
