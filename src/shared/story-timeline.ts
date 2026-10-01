/**
 * 项目内故事时间线。
 *
 * timeLabel 是作者面向读者/创作时看到的任意时间表达（例如“大荒历 317 年冬”），
 * sortOrder 则是独立、稳定的编排刻度；两者刻意分离，避免模糊时间无法排序。
 */
export type StoryTimelinePrecision = 'exact' | 'range' | 'relative' | 'unknown'

export type StoryTimelineEventStatus = 'planned' | 'drafted' | 'finalized'

export interface StoryTimelineSettings {
  title: string
  rulerLabel: string
  rulerUnit: string
  /** 故事开端锚点名称，默认“故事开端” */
  startLabel?: string
  /** 故事开端时间文本（如“创世纪”、“第1年”） */
  startTimeLabel?: string
  /** 故事开端刻度数值（如 0） */
  startOrder?: number
  /** 故事结束锚点名称，默认“故事结束” */
  endLabel?: string
  /** 故事结束时间文本（如“终局之战”、“第10年”） */
  endTimeLabel?: string
  /** 故事结束刻度数值（如 100） */
  endOrder?: number
  /** 是否已被作者显式保存/确认过故事范围 */
  hasCustomRange?: boolean
  updatedAt?: string
}

export const DEFAULT_TIMELINE_SETTINGS: StoryTimelineSettings = {
  title: '故事时间线',
  rulerLabel: '故事时间',
  rulerUnit: '刻度',
  startLabel: '故事开端',
  startTimeLabel: '',
  startOrder: 0,
  endLabel: '故事结束',
  endTimeLabel: '',
  endOrder: 10,
  hasCustomRange: false,
}

export interface StoryTimelineResolvedRange {
  startLabel: string
  startTimeLabel: string
  startOrder: number
  endLabel: string
  endTimeLabel: string
  endOrder: number
  isConfigured: boolean
}

/**
 * 解析并计算出有效的故事范围：
 * 1. 若作者已显式设置，严格使用作者设定的范围；
 * 2. 旧项目兼容：若尚未显式配置范围且已有历史事件，默认自动包含所有历史事件，不可截断；
 * 3. 空项目无设置时，默认 0 ~ 10 刻度。
 */
export function resolveStoryTimelineRange(
  settings?: StoryTimelineSettings | null,
  events: readonly StoryTimelineEvent[] = [],
): StoryTimelineResolvedRange {
  const isConfigured = Boolean(
    settings?.hasCustomRange ||
    (typeof settings?.startOrder === 'number' && typeof settings?.endOrder === 'number' && settings.startOrder < settings.endOrder),
  )

  const defaultStart = 0
  const defaultEnd = 10

  if (isConfigured && settings) {
    const startOrder = typeof settings.startOrder === 'number' ? settings.startOrder : defaultStart
    const rawEnd = typeof settings.endOrder === 'number' ? settings.endOrder : defaultEnd
    const endOrder = rawEnd > startOrder ? rawEnd : startOrder + 10
    return {
      startLabel: settings.startLabel?.trim() || '故事开端',
      startTimeLabel: settings.startTimeLabel ?? '',
      startOrder,
      endLabel: settings.endLabel?.trim() || '故事结束',
      endTimeLabel: settings.endTimeLabel ?? '',
      endOrder,
      isConfigured: true,
    }
  }

  // 旧项目兼容：取主干事件的最大最小刻度作为参考
  const mainEvents = events.filter(e => (e.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID)
  const eventOrders = mainEvents.map(e => e.sortOrder)
  const minEventOrder = eventOrders.length > 0 ? Math.min(...eventOrders) : defaultStart
  const maxEventOrder = eventOrders.length > 0 ? Math.max(...eventOrders) : defaultEnd

  const startOrder = Math.min(defaultStart, minEventOrder)
  const endOrder = Math.max(defaultEnd, maxEventOrder, startOrder + 10)

  return {
    startLabel: settings?.startLabel?.trim() || '故事开端',
    startTimeLabel: settings?.startTimeLabel ?? '',
    startOrder,
    endLabel: settings?.endLabel?.trim() || '故事结束',
    endTimeLabel: settings?.endTimeLabel ?? '',
    endOrder,
    isConfigured: false,
  }
}

export interface StoryTimelineBranch {
  id: string
  name: string
  sourceEventId?: string | null
  color?: string
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

export interface StoryTimelineEvent {
  id: string
  branchId?: string
  parentEventId?: string | null
  title: string
  timeLabel: string
  sortOrder: number
  precision: StoryTimelinePrecision
  rangeEndLabel?: string
  description: string
  chapterNumbers: number[]
  characterNames: string[]
  locationNodeIds: string[]
  status: StoryTimelineEventStatus
  /**
   * 重要历史事件标识。历史可以早于故事开端，也可以晚于开端；
   * 它只是一段资料的分类，绝不改变故事范围设置，也不改动原排序。
   * 旧事件迁移后该字段为 false，不会被自动标为历史。
   */
  isHistorical?: boolean
  /** 事件结果；允许为空。 */
  outcome?: string
  /** 后续影响；允许为空。 */
  aftermath?: string
  createdAt?: string
  updatedAt?: string
}

export interface StoryTimelineSnapshot {
  settings: StoryTimelineSettings
  branches: StoryTimelineBranch[]
  events: StoryTimelineEvent[]
}

export const STORY_TIMELINE_MAIN_BRANCH_ID = 'main'

export const STORY_TIMELINE_PRECISION_LABELS: Record<StoryTimelinePrecision, { zh: string; en: string }> = {
  exact: { zh: '精确时间', en: 'Exact time' },
  range: { zh: '时间范围', en: 'Time range' },
  relative: { zh: '相对时间', en: 'Relative time' },
  unknown: { zh: '未定', en: 'Undecided' },
}

export const STORY_TIMELINE_STATUS_LABELS: Record<StoryTimelineEventStatus, { zh: string; en: string }> = {
  planned: { zh: '计划中', en: 'Planned' },
  drafted: { zh: '已起草', en: 'Drafted' },
  finalized: { zh: '已定稿', en: 'Finalized' },
}

export interface StoryTimelineMention {
  raw: string
  name: string
  type: 'character' | 'entity'
}

/**
 * 识别描述中的手动引用：支持 @人物 或 [[人物]] 两种常用小说与笔记语法。
 */
export function parseStoryTimelineMentions(text: string): StoryTimelineMention[] {
  if (!text) return []
  const mentions: StoryTimelineMention[] = []
  const seen = new Set<string>()

  // 1. [[人物名]] 语法
  const wikiRegex = /\[\[([^\]\n\r]+)\]\]/g
  let wikiMatch: RegExpExecArray | null
  while ((wikiMatch = wikiRegex.exec(text)) !== null) {
    const raw = wikiMatch[0]
    const name = wikiMatch[1].trim()
    if (name && !seen.has(`wiki:${name}`)) {
      seen.add(`wiki:${name}`)
      mentions.push({ raw, name, type: 'character' })
    }
  }

  // 2. @人物名 语法（避免匹配邮箱：要求非字母数字前缀或行首）
  const atRegex = /(?:^|[^\w@])@([^\s@,，。！？!?;；:：\[\]\(\)（）]+)/g
  let atMatch: RegExpExecArray | null
  while ((atMatch = atRegex.exec(text)) !== null) {
    const name = atMatch[1].trim()
    const raw = `@${name}`
    if (name && !seen.has(`at:${name}`)) {
      seen.add(`at:${name}`)
      mentions.push({ raw, name, type: 'character' })
    }
  }

  return mentions
}
