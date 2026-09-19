import type {
  StoryTimelineBranch,
  StoryTimelineEvent,
  StoryTimelineEventStatus,
} from '../../shared/story-timeline'
import { STORY_TIMELINE_MAIN_BRANCH_ID } from '../../shared/story-timeline'

/**
 * 故事时间轴/时间树的纯布局计算。
 *
 * 视觉位置完全由 sortOrder 与分支归属推导，绝不回写、也绝不持久化。
 * 主轴（main）时间从左向右推进；支线（branch）从源事件向后发散；
 * 同一时间点允许多个重大事件，并在同列垂直对称错开。
 */

export const TIMELINE_PIXELS_PER_ORDER = 160
export const TIMELINE_MIN_COLUMN_SPACING = 110
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
  events: StoryTimelineLayoutEvent[]
  edges: StoryTimelineLayoutEdge[]
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
): StoryTimelineLayout {
  if (events.length === 0) {
    return {
      events: [],
      edges: [],
      axis: { x: 0, y: 0, width: 0, height: 2 },
      canvasWidth: TIMELINE_CANVAS_MARGIN * 2,
      canvasHeight: TIMELINE_CANVAS_MARGIN * 2,
    }
  }

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

  const placedEvents: StoryTimelineLayoutEvent[] = []
  const placedMap = new Map<string, StoryTimelineLayoutEvent>()
  const edges: StoryTimelineLayoutEdge[] = []

  // 1. 布局主轴事件
  let axisY = TIMELINE_CANVAS_MARGIN + 120
  let minMainX = TIMELINE_CANVAS_MARGIN

  if (mainEvents.length > 0) {
    const minSortOrder = mainEvents[0].sortOrder

    // 横轴坐标计算：保持单调增与横向最小步长
    const columnX: number[] = []
    let previousX: number | null = null
    for (const event of mainEvents) {
      const desiredX = (event.sortOrder - minSortOrder) * TIMELINE_PIXELS_PER_ORDER
      const x: number = previousX === null
        ? desiredX
        : Math.max(desiredX, previousX + TIMELINE_MIN_COLUMN_SPACING)
      columnX.push(x)
      previousX = x
    }

    interface PlacedMainLabel {
      event: StoryTimelineEvent
      side: StoryTimelineLabelSide
      staggerLevel: number
      width: number
      relativeTop: number
      x: number
    }

    const placedMain: PlacedMainLabel[] = []
    const lastPlacedBySide: Record<'above' | 'below', { width: number; staggerLevel: number } | undefined> = {
      above: undefined,
      below: undefined,
    }

    mainEvents.forEach((event, index) => {
      const side: 'above' | 'below' = index % 2 === 0 ? 'above' : 'below'
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

      placedMain.push({
        event,
        side,
        staggerLevel,
        width,
        relativeTop,
        x: TIMELINE_CANVAS_MARGIN + columnX[index],
      })
      lastPlacedBySide[side] = { width, staggerLevel }
    })

    const minRelativeTop = Math.min(...placedMain.map(label => label.relativeTop))
    axisY = TIMELINE_CANVAS_MARGIN - minRelativeTop
    minMainX = TIMELINE_CANVAS_MARGIN + columnX[0]

    placedMain.forEach((label, idx) => {
      const childBranches = childBranchesBySource.get(label.event.id) ?? []
      const childBranchCount = childBranches.length
      const isExpanded = childBranches.some(b => expandedSet.has(b.id))

      const placed: StoryTimelineLayoutEvent = {
        id: label.event.id,
        branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
        parentEventId: label.event.parentEventId || null,
        side: label.side,
        staggerLevel: label.staggerLevel,
        x: label.x,
        y: axisY + label.relativeTop,
        width: label.width,
        height: TIMELINE_LABEL_HEIGHT,
        timeText: formatTimelineEventTime(label.event),
        title: label.event.title,
        status: label.event.status,
        childBranchCount,
        isExpanded,
      }
      placedEvents.push(placed)
      placedMap.set(label.event.id, placed)

      if (idx > 0) {
        edges.push({
          id: `trunk-${placedMain[idx - 1].event.id}-${label.event.id}`,
          source: placedMain[idx - 1].event.id,
          target: label.event.id,
          type: 'timeline-trunk',
          branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
        })
      }
    })
  }

  // 2. 布局展开的支线（包括子支线）
  const childBranches = allBranches.filter(b => b.id !== STORY_TIMELINE_MAIN_BRANCH_ID && visibleBranchIds.has(b.id))

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
    const baseSourceX = sourcePlaced ? sourcePlaced.x + sourcePlaced.width + TIMELINE_BRANCH_GAP_X : TIMELINE_CANVAS_MARGIN
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
  const allRight = placedEvents.map(e => e.x + e.width)
  const allY = placedEvents.map(e => e.y)
  const allBottom = placedEvents.map(e => e.y + e.height)

  const maxX = allRight.length > 0 ? Math.max(...allRight) : TIMELINE_CANVAS_MARGIN + 400
  const minY = allY.length > 0 ? Math.min(...allY) : axisY - 100
  const maxY = allBottom.length > 0 ? Math.max(...allBottom) : axisY + 100

  const axisLeft = Math.min(minMainX - TIMELINE_AXIS_OVERHANG, TIMELINE_CANVAS_MARGIN - TIMELINE_AXIS_OVERHANG)
  const axisWidth = Math.max(120, (maxX + TIMELINE_AXIS_OVERHANG) - axisLeft)

  return {
    events: placedEvents,
    edges,
    axis: {
      x: axisLeft,
      y: axisY,
      width: axisWidth,
      height: 2,
    },
    canvasWidth: maxX + TIMELINE_CANVAS_MARGIN * 2,
    canvasHeight: Math.max(500, maxY - minY + TIMELINE_CANVAS_MARGIN * 2),
  }
}
