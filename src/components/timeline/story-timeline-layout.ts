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
export const TIMELINE_LABEL_MIN_WIDTH = 180
export const TIMELINE_LABEL_MAX_WIDTH = 240
/** 高度估算上限：双行标题 + 双行描述 + 元信息的理论最大值附近。 */
export const TIMELINE_LABEL_MAX_HEIGHT = 150
/** 派生了支线的事件节点底部会渲染「N 支线」徽标，高度估算需追加这一行。 */
export const TIMELINE_BRANCH_BADGE_ALLOWANCE = 26
export const TIMELINE_LABEL_HORIZONTAL_PADDING = 28
/** 节点内边距（左右合计），估算换行时从内容宽度里扣除。 */
export const TIMELINE_LABEL_INNER_PADDING = 22
/** 节点与主轴的基础净距。 */
export const TIMELINE_LABEL_AXIS_GAP = 34
/**
 * 同侧错开步长。必须大于最高节点估算高度（双行标题 + 双行描述 + 元信息
 * + 支线徽标）加上安全间距，否则深层节点会与浅层节点重叠。
 */
export const TIMELINE_STAGGER_STEP = 186
export const TIMELINE_MIN_LABEL_GAP = 12
/** 支线泳道间距：需容纳支线名标签 + 最高节点高度（含徽标）。 */
export const TIMELINE_BRANCH_GAP_X = 70
export const TIMELINE_BRANCH_LANE_HEIGHT = 200
export const TIMELINE_BRANCH_LABEL_OFFSET = 26
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
  /** 画布节点上直接可见的最多两行描述；空字符串表示无描述。 */
  description: string
  /** 元信息一行（支线名 · 关联章节），空字符串表示不展示。 */
  metaText: string
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
  /** 支线曲线走向：target 在 source 上方为 up，否则 down。 */
  direction: 'up' | 'down'
  color?: string
}

/** 主轴上的事件圆点：视觉上与其事件标注属于同一整体。 */
export interface StoryTimelineAxisDot {
  eventId: string
  /** 圆点中心的绝对 x（与事件标注中心对齐）。 */
  x: number
}

/** 支线名标签：放在所属路径附近，不遮挡其他分支。 */
export interface StoryTimelineBranchLabel {
  branchId: string
  name: string
  x: number
  y: number
  color?: string
}

/**
 * 支线泳道在主轴内容范围之外的额外退让：支线名一行（26px）加上
 * 半个最高节点（约 88px），保证支线首事件与其名标签不压主轴标注。
 */
const TIMELINE_BRANCH_LANE_INSET = 120

export interface StoryTimelineLayout {
  startAnchor: StoryTimelineAnchor
  endAnchor: StoryTimelineAnchor
  events: StoryTimelineLayoutEvent[]
  edges: StoryTimelineLayoutEdge[]
  axis: { x: number; y: number; width: number; height: number }
  axisDots: StoryTimelineAxisDot[]
  branchLabels: StoryTimelineBranchLabel[]
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

/** CJK 字符按全宽估算，拉丁字符按半宽估算；宁宽勿窄，保证重叠判断保守。 */
function measureTextWidth(text: string, cjkWidth: number, latinWidth: number): number {
  let width = 0
  for (const char of text) {
    width += /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F]/.test(char)
      ? cjkWidth
      : latinWidth
  }
  return width
}

/** 标注宽度由内容估算；布局与渲染共用同一函数，因此重叠判断是精确的。 */
export function estimateTimelineLabelWidth(event: StoryTimelineEvent): number {
  const timeText = formatTimelineEventTime(event)
  const timeWidth = measureTextWidth(timeText, 12.5, 7)
  const titleWidth = measureTextWidth(event.title ?? '', 16, 8.5)
  const estimated = Math.max(timeWidth, titleWidth) + TIMELINE_LABEL_HORIZONTAL_PADDING
  return Math.min(TIMELINE_LABEL_MAX_WIDTH, Math.max(TIMELINE_LABEL_MIN_WIDTH, estimated))
}

/** 事件在画布上的元信息行：支线事件带支线名，有关联章节时附在第 N 章。 */
function buildEventMetaText(
  event: StoryTimelineEvent,
  branchNameById: ReadonlyMap<string, string>,
): string {
  const parts: string[] = []
  const branchId = event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID
  if (branchId !== STORY_TIMELINE_MAIN_BRANCH_ID) {
    parts.push(branchNameById.get(branchId) ?? '')
  }
  if (event.chapterNumbers.length > 0) {
    parts.push(`第${event.chapterNumbers.join('、')}章`)
  }
  return parts.filter(Boolean).join(' · ')
}

/**
 * 节点高度按真实内容行数估算（时间一行、标题最多两行、元信息一行、描述最多两行），
 * 与渲染层的 CSS 行高约定保持一致；布局与渲染共用，保证层间不重叠。
 */
export function estimateTimelineLabelHeight(event: StoryTimelineEvent): number {
  const width = estimateTimelineLabelWidth(event)
  const innerWidth = Math.max(60, width - TIMELINE_LABEL_INNER_PADDING)

  const titleText = (event.title ?? '').trim()
  const titleLines = titleText
    ? Math.min(2, Math.max(1, Math.ceil(measureTextWidth(titleText, 16, 8.5) / innerWidth)))
    : 1

  const descriptionText = (event.description ?? '').trim()
  const descriptionLines = descriptionText
    ? Math.min(2, Math.ceil(measureTextWidth(descriptionText, 12.5, 6.8) / innerWidth))
    : 0

  const metaText = buildEventMetaText(event, new Map())
    || ((event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) !== STORY_TIMELINE_MAIN_BRANCH_ID ? '支线' : '')
  // 时间行(17+2) + 标题(22/行) + 元信息(16+2) + 描述(4+19/行) + 上下内边距(12)
  let height = 12 + 19 + titleLines * 22
  if (metaText) height += 18
  if (descriptionLines > 0) height += 4 + descriptionLines * 19
  return Math.min(TIMELINE_LABEL_MAX_HEIGHT, Math.ceil(height))
}

/** 支线默认取灰绿色系（主题 token），作者显式指定的支线颜色优先。 */
const BRANCH_COLOR_VARS = [
  'var(--tl-branch-1)',
  'var(--tl-branch-2)',
  'var(--tl-branch-3)',
  'var(--tl-branch-4)',
  'var(--tl-branch-5)',
  'var(--tl-branch-6)',
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

interface BranchLane {
  branch: StoryTimelineBranch
  color?: string
  /** 相对主轴的泳道偏移：负数在主轴上方，正数在下方。 */
  laneOffsetY: number
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

  const branchNameById = new Map(allBranches.map(branch => [branch.id, branch.name]))
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
    height: number
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
      // 带支线的事件节点底部还有「N 支线」徽标行，计入高度保证避让成立。
      const hasBranchBadge = (childBranchesBySource.get(event.id)?.length ?? 0) > 0
      const height = estimateTimelineLabelHeight(event) + (hasBranchBadge ? TIMELINE_BRANCH_BADGE_ALLOWANCE : 0)

      // 同一刻度内多事件上下对称错开；单一事件顺延全局上下交错
      const baseSide: StoryTimelineLabelSide = group.length === 1
        ? (globalSideIndex++ % 2 === 0 ? 'above' : 'below')
        : (indexInGroup % 2 === 0 ? 'above' : 'below')

      let currentLevel = group.length === 1 ? 0 : Math.floor(indexInGroup / 2)

      // 检查与同侧同层已有标注的水平重叠，若重叠则逐层外推
      let hasOverlap = true
      while (hasOverlap) {
        hasOverlap = placedMainLabels.some(placed => {
          if (placed.side !== baseSide || placed.staggerLevel !== currentLevel) return false
          const x1 = idealX
          const x2 = idealX + width
          const p1 = placed.x
          const p2 = placed.x + placed.width
          return Math.max(x1, p1) < Math.min(x2, p2) + TIMELINE_MIN_LABEL_GAP
        })
        if (hasOverlap) currentLevel++
      }

      placedMainLabels.push({
        event,
        side: baseSide,
        staggerLevel: currentLevel,
        x: idealX,
        width,
        height,
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

  // 主轴两侧内容的真实范围：支线泳道必须让出这片区域，避免与主轴标注重叠。
  const mainExtentAbove = placedMainLabels
    .filter(placed => placed.side === 'above')
    .reduce((max, placed) => Math.max(max, TIMELINE_LABEL_AXIS_GAP + placed.staggerLevel * TIMELINE_STAGGER_STEP + placed.height), 0)
  const mainExtentBelow = placedMainLabels
    .filter(placed => placed.side === 'below')
    .reduce((max, placed) => Math.max(max, TIMELINE_LABEL_AXIS_GAP + placed.staggerLevel * TIMELINE_STAGGER_STEP + placed.height), 0)

  /**
   * 泳道分配对「全部」非主线支线做一次稳定编号（按 sortOrder、id 排序），
   * 与展开/折叠状态无关：折叠某条支线时，其余支线与主轴节点都不跳位。
   * 泳道相对主轴，从主轴内容范围之外向外排布。
   */
  const stableBranchOrder = allBranches
    .filter(b => b.id !== STORY_TIMELINE_MAIN_BRANCH_ID)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
  let branchLaneCounterAbove = 0
  let branchLaneCounterBelow = 0
  const laneByBranchId = new Map<string, BranchLane>()
  stableBranchOrder.forEach((branch, index) => {
    const goAbove = index % 2 === 0
    const lane = goAbove ? ++branchLaneCounterAbove : ++branchLaneCounterBelow
    const colorIndex = (lane - 1) % BRANCH_COLOR_VARS.length
    laneByBranchId.set(branch.id, {
      branch,
      color: branch.color || BRANCH_COLOR_VARS[colorIndex],
      laneOffsetY: goAbove
        ? -(mainExtentAbove + TIMELINE_BRANCH_LANE_INSET + (lane - 1) * TIMELINE_BRANCH_LANE_HEIGHT)
        : mainExtentBelow + TIMELINE_BRANCH_LANE_INSET + (lane - 1) * TIMELINE_BRANCH_LANE_HEIGHT,
    })
  })

  // ==========================================================
  // 第一遍：以主轴为 y=0 放置全部元素，之后整体平移，
  // 让内容四周恰好留出 TIMELINE_CANVAS_MARGIN。
  // ==========================================================

  const placedEvents: StoryTimelineLayoutEvent[] = []
  const placedMap = new Map<string, StoryTimelineLayoutEvent>()
  const edges: StoryTimelineLayoutEdge[] = []
  const axisDots: StoryTimelineAxisDot[] = []
  const branchLabels: StoryTimelineBranchLabel[] = []

  // 放置主线事件（y 相对主轴）
  for (const placed of placedMainLabels) {
    const childBranchesForEvent = childBranchesBySource.get(placed.event.id) ?? []

    const y = placed.side === 'above'
      ? -TIMELINE_LABEL_AXIS_GAP - placed.staggerLevel * TIMELINE_STAGGER_STEP - placed.height
      : TIMELINE_LABEL_AXIS_GAP + placed.staggerLevel * TIMELINE_STAGGER_STEP

    const layoutEvent: StoryTimelineLayoutEvent = {
      id: placed.event.id,
      branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
      parentEventId: placed.event.parentEventId || null,
      side: placed.side,
      staggerLevel: placed.staggerLevel,
      x: placed.x,
      y,
      width: placed.width,
      height: placed.height,
      timeText: formatTimelineEventTime(placed.event),
      title: placed.event.title,
      description: (placed.event.description ?? '').trim(),
      metaText: buildEventMetaText(placed.event, branchNameById),
      status: placed.event.status,
      childBranchCount: childBranchesForEvent.length,
      isExpanded: childBranchesForEvent.some(b => expandedSet.has(b.id)),
    }

    placedEvents.push(layoutEvent)
    placedMap.set(placed.event.id, layoutEvent)
    axisDots.push({ eventId: placed.event.id, x: placed.x + placed.width / 2 })
  }

  // 放置展开的支线（包括子支线）
  for (const lane of laneByBranchId.values()) {
    const branch = lane.branch
    const bEvents = sortTimelineEvents(eventsByBranch.get(branch.id) ?? [])
    if (bEvents.length === 0) continue

    const sourcePlaced = branch.sourceEventId ? placedMap.get(branch.sourceEventId) : undefined
    const baseSourceX = sourcePlaced ? sourcePlaced.x + sourcePlaced.width + TIMELINE_BRANCH_GAP_X : trunkEventStartX
    // 曲线起点仍在源事件中心；泳道高度与源事件位置无关（相对主轴）。
    const baseSourceY = sourcePlaced ? sourcePlaced.y + sourcePlaced.height / 2 : 0
    const branchY = lane.laneOffsetY

    let prevX = baseSourceX
    let prevPlaced: StoryTimelineLayoutEvent | null = null

    bEvents.forEach((event, idx) => {
      const width = estimateTimelineLabelWidth(event)
      const childBranchesForEvent = childBranchesBySource.get(event.id) ?? []
      // 支线事件同样可能派生下级支线，徽标行计入高度。
      const height = estimateTimelineLabelHeight(event)
        + (childBranchesForEvent.length > 0 ? TIMELINE_BRANCH_BADGE_ALLOWANCE : 0)

      const x = idx === 0
        ? baseSourceX
        : Math.max(prevX + TIMELINE_MIN_COLUMN_SPACING, prevX + width + 24)

      const placed: StoryTimelineLayoutEvent = {
        id: event.id,
        branchId: branch.id,
        parentEventId: event.parentEventId || branch.sourceEventId || null,
        side: lane.laneOffsetY < 0 ? 'above' : 'below',
        staggerLevel: 0,
        x,
        y: branchY - height / 2,
        width,
        height,
        timeText: formatTimelineEventTime(event),
        title: event.title,
        description: (event.description ?? '').trim(),
        metaText: buildEventMetaText(event, branchNameById),
        status: event.status,
        childBranchCount: childBranchesForEvent.length,
        isExpanded: childBranchesForEvent.some(b => expandedSet.has(b.id)),
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
            direction: placed.y + placed.height / 2 < baseSourceY ? 'up' : 'down',
            color: lane.color,
          })
        }
      } else if (prevPlaced) {
        edges.push({
          id: `branch-seq-${prevPlaced.id}-${event.id}`,
          source: prevPlaced.id,
          target: event.id,
          type: 'timeline-trunk',
          branchId: branch.id,
          direction: placed.y + placed.height / 2 < prevPlaced.y + prevPlaced.height / 2 ? 'up' : 'down',
          color: lane.color,
        })
      }

      prevPlaced = placed
    })

    // 支线名标签贴着本支线首事件
    const first = placedMap.get(bEvents[0].id)
    if (first) {
      branchLabels.push({
        branchId: branch.id,
        name: branch.name,
        x: first.x,
        y: lane.laneOffsetY < 0
          ? first.y - TIMELINE_BRANCH_LABEL_OFFSET
          : first.y + first.height + 8,
        color: lane.color,
      })
    }
  }

  // ==========================================================
  // 第二遍：整体平移，使内容四周留出画布边距。
  // ==========================================================

  const anchorHalfHeight = TIMELINE_ANCHOR_HEIGHT / 2
  const relativeTops = [
    ...placedEvents.map(event => event.y),
    ...branchLabels.map(label => label.y),
    -anchorHalfHeight,
  ]
  const relativeBottoms = [
    ...placedEvents.map(event => event.y + event.height),
    ...branchLabels.map(label => label.y + 18),
    anchorHalfHeight,
  ]

  const relativeMinY = relativeTops.length > 0 ? Math.min(...relativeTops) : 0
  const relativeMaxY = relativeBottoms.length > 0 ? Math.max(...relativeBottoms) : 0
  /**
   * 轴基线只取决于主轴自身的内容范围，与任何支线的展开/折叠无关：
   * 折叠一条深层支线时，主轴与起止锚点绝不上下跳动（更深的上方泳道
   * 会越过顶部留白，可通过平移/查看全部到达，这是稳定性换来的取舍）。
   */
  const axisY = TIMELINE_CANVAS_MARGIN + mainExtentAbove + TIMELINE_BRANCH_LANE_INSET
  const shiftY = axisY

  for (const event of placedEvents) event.y += shiftY
  for (const label of branchLabels) label.y += shiftY

  const startAnchor: StoryTimelineAnchor = {
    id: 'timeline-anchor-start',
    anchorType: 'start',
    label: range.startLabel,
    timeLabel: range.startTimeLabel,
    order: range.startOrder,
    x: startX,
    y: axisY - anchorHalfHeight,
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
    y: axisY - anchorHalfHeight,
    width: endAnchorWidth,
    height: TIMELINE_ANCHOR_HEIGHT,
  }

  const allRight = [endAnchor.x + endAnchor.width, ...placedEvents.map(e => e.x + e.width)]
  const maxX = Math.max(...allRight)

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
    axisDots,
    branchLabels,
    canvasWidth: maxX + TIMELINE_CANVAS_MARGIN,
    canvasHeight: Math.max(500, relativeMaxY - relativeMinY + TIMELINE_CANVAS_MARGIN * 2),
    range,
  }
}
