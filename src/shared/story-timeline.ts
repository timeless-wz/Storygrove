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
  updatedAt?: string
}

export interface StoryTimelineEvent {
  id: string
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
  createdAt?: string
  updatedAt?: string
}

export interface StoryTimelineSnapshot {
  settings: StoryTimelineSettings
  events: StoryTimelineEvent[]
}

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
