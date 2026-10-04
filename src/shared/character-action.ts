/**
 * 人物行动线 — 跨模块唯一权威类型模块（knowledge-action-outline-sync-contract §4）。
 *
 * 权威边界（冻结）：
 * - 行动记录只存人物自己的目标/资源/限制/选择/结果；行动所关联事件的标题、时间、
 *   结果与影响以 story_timeline_events 为准，行动线只引用事件 ID，不复制成第二份。
 * - off-stage（幕后）表示尚未向读者展示，不等于没有发生；故事内状态与叙事呈现状态同时存在。
 * - 行动计划改变永不自动改世界事实、其他人物关系或时间线既有事件。
 */

import { randomCanvasUuid } from './canvas-ids'
import type { NarrativePosition, ProseAnchor, StoryPosition } from './prose-anchor'

export const CHARACTER_ACTION_ID_PREFIX = 'act'

export const MAX_ACTION_TITLE = 160
export const MAX_ACTION_TEXT = 4000
export const MAX_ACTION_NOTE = 2000

/** off-stage = 幕后行动：尚未向读者展示（叙事呈现），但故事内已经发生/计划发生。 */
export type CharacterActionVisibility = 'on-stage' | 'off-stage'

/** 计划（作者规划，可无正文）或有正文依据（必须带锚点）。 */
export type CharacterActionStatus = 'plan' | 'prose'

export interface CharacterAction {
  id: string                     // act-<uuid>
  characterId: string            // 稳定人物 ID（必填）
  title: string
  goal: string                   // 目标/行动意图
  resources: string              // 掌握的资源
  constraints: string            // 限制
  /** 所据认知 → knw- 记录 ID。 */
  basedOnKnowledgeIds: string[]
  /** 已排入的时间线事件 id；与 plannedNote 互斥使用。 */
  eventId?: string
  /** 尚未排入事件的行动计划说明。 */
  plannedNote?: string
  storyPosition: StoryPosition
  narrativePosition: NarrativePosition
  visibility: CharacterActionVisibility
  /** 人物侧结果（事件结果本身以时间线为准）。 */
  outcome?: string
  aftermath?: string
  status: CharacterActionStatus
  proseAnchor?: ProseAnchor
  /** 受影响的章（提示用，非权威）。 */
  relatedChapterNumbers: number[]
  revision: number
  createdAt: string
  updatedAt: string
}

/** 行动线读取视图：事件信息为只读投影（悬空时 eventDangling=true）。 */
export interface CharacterActionView extends CharacterAction {
  event?: {
    id: string
    title: string
    timeLabel: string
    sortOrder: number
    status: string
    outcome?: string
    aftermath?: string
  }
  eventDangling?: boolean
}

export interface CharacterActionDraft {
  characterId: string
  title: string
  goal: string
  resources: string
  constraints: string
  basedOnKnowledgeIds: string[]
  eventId?: string
  plannedNote?: string
  storyPosition: StoryPosition
  narrativePosition: NarrativePosition
  visibility: CharacterActionVisibility
  outcome?: string
  aftermath?: string
  status: CharacterActionStatus
  proseAnchor?: ProseAnchor
  relatedChapterNumbers: number[]
}

export function createCharacterActionId(): string {
  return `${CHARACTER_ACTION_ID_PREFIX}-${randomCanvasUuid()}`
}

/** 新建/更新行动的完整输入（id 缺省 = 新建；baseRevision 用于乐观并发）。 */
export interface CharacterActionSaveInput extends CharacterActionDraft {
  id?: string
  baseRevision?: number
}

export function assertValidCharacterActionDraft(draft: CharacterActionDraft): void {
  if (!draft || typeof draft !== 'object') throw new Error('行动记录无效')
  if (typeof draft.characterId !== 'string' || !draft.characterId.trim()) {
    throw new Error('行动记录缺少稳定人物 ID')
  }
  if (typeof draft.title !== 'string' || !draft.title.trim()) throw new Error('行动记录缺少标题')
  if (draft.title.length > MAX_ACTION_TITLE) throw new Error(`行动标题超限（≤${MAX_ACTION_TITLE} 字符）`)
  for (const [field, limit] of [['goal', MAX_ACTION_TEXT], ['resources', MAX_ACTION_NOTE], ['constraints', MAX_ACTION_NOTE]] as const) {
    const value = draft[field]
    if (typeof value !== 'string' || value.length > limit) {
      throw new Error(`行动的 ${field} 字段无效或超限`)
    }
  }
  if (!Array.isArray(draft.basedOnKnowledgeIds)
    || draft.basedOnKnowledgeIds.some(id => typeof id !== 'string')) {
    throw new Error('所据认知列表无效')
  }
  if (draft.eventId !== undefined && (typeof draft.eventId !== 'string' || !draft.eventId.trim())) {
    throw new Error('时间线事件引用无效')
  }
  if (draft.eventId === undefined && (!draft.plannedNote || !draft.plannedNote.trim())) {
    throw new Error('未排入时间线的行动需要填写行动计划说明')
  }
  if (draft.plannedNote !== undefined && (typeof draft.plannedNote !== 'string' || draft.plannedNote.length > MAX_ACTION_NOTE)) {
    throw new Error(`行动计划说明超限（≤${MAX_ACTION_NOTE} 字符）`)
  }
  if (!draft.storyPosition || typeof draft.storyPosition !== 'object') throw new Error('故事位置无效')
  if (!draft.narrativePosition || typeof draft.narrativePosition !== 'object') throw new Error('叙事位置无效')
  if (draft.visibility !== 'on-stage' && draft.visibility !== 'off-stage') {
    throw new Error(`未知的行动可见性：${String(draft.visibility)}`)
  }
  if (draft.status !== 'plan' && draft.status !== 'prose') {
    throw new Error(`未知的行动状态：${String(draft.status)}`)
  }
  if (draft.status === 'prose' && !draft.proseAnchor) {
    throw new Error('有正文依据的行动必须携带正文锚点')
  }
  if (draft.outcome !== undefined && (typeof draft.outcome !== 'string' || draft.outcome.length > MAX_ACTION_NOTE)) {
    throw new Error('行动结果无效或超限')
  }
  if (draft.aftermath !== undefined && (typeof draft.aftermath !== 'string' || draft.aftermath.length > MAX_ACTION_NOTE)) {
    throw new Error('后续影响无效或超限')
  }
  if (!Array.isArray(draft.relatedChapterNumbers)
    || draft.relatedChapterNumbers.some(n => !Number.isSafeInteger(n) || n < 1)) {
    throw new Error('关联章节列表无效')
  }
}
