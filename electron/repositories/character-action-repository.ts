/**
 * 人物行动线仓库（knowledge-action-outline-sync-contract §4）。
 *
 * 语义冻结：
 * - eventId 只存稳定引用；读取时 join 出只读事件投影（悬空显示 eventDangling，不复制字段）。
 * - promoteToTimeline 在同一事务内创建时间线事件并回填 eventId：
 *   已有 eventId 时幂等返回，不重复创建；事件以 status='planned' 进入时间线，
 *   人物名来自调用方传入的当前名（时间线数据模型是姓名，见契约缺口 §11.1）。
 * - 行动计划改变永不自动改世界事实、其他人物关系或时间线既有事件。
 */

import { getProjectDb } from '../database'
import { ensureCharacterActionSchema } from '../services/character-action-schema'
import { randomCanvasUuid } from '../../src/shared/canvas-ids'
import { STORY_TIMELINE_MAIN_BRANCH_ID } from '../../src/shared/story-timeline'
import { computeProseContentHash, validateProseAnchor } from '../../src/shared/prose-anchor'
import {
  assertValidCharacterActionDraft,
  createCharacterActionId,
  type CharacterAction,
  type CharacterActionSaveInput,
  type CharacterActionStatus,
  type CharacterActionView,
  type CharacterActionVisibility,
} from '../../src/shared/character-action'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

function requireDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

interface CharacterActionRow {
  id: string
  character_id: string
  title: string
  goal: string
  event_id: string | null
  planned_note: string | null
  visibility: string
  status: string
  payload: string
  revision: number
  created_at: string
  updated_at: string
}

interface TimelineEventProjectionRow {
  id: string
  title: string
  time_label: string
  sort_order: number
  status: string
  outcome: string
  aftermath: string
}

function rowToAction(row: CharacterActionRow): CharacterAction {
  const payload = JSON.parse(row.payload) as Partial<CharacterAction>
  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    goal: row.goal,
    resources: payload.resources ?? '',
    constraints: payload.constraints ?? '',
    basedOnKnowledgeIds: payload.basedOnKnowledgeIds ?? [],
    ...(row.event_id ? { eventId: row.event_id } : {}),
    ...(row.planned_note ? { plannedNote: row.planned_note } : {}),
    storyPosition: payload.storyPosition ?? { kind: 'unplaced' },
    narrativePosition: payload.narrativePosition ?? { kind: 'unplaced' },
    visibility: row.visibility as CharacterActionVisibility,
    ...(payload.outcome ? { outcome: payload.outcome } : {}),
    ...(payload.aftermath ? { aftermath: payload.aftermath } : {}),
    status: row.status as CharacterActionStatus,
    ...(payload.proseAnchor ? { proseAnchor: payload.proseAnchor } : {}),
    relatedChapterNumbers: payload.relatedChapterNumbers ?? [],
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function eventProjection(row: TimelineEventProjectionRow): NonNullable<CharacterActionView['event']> {
  return {
    id: row.id,
    title: row.title,
    timeLabel: row.time_label,
    sortOrder: row.sort_order,
    status: row.status,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.aftermath ? { aftermath: row.aftermath } : {}),
  }
}

export interface CharacterActionSaveResult {
  success: boolean
  id?: string
  revision?: number
  conflict?: boolean
  currentRevision?: number
  error?: string
}

export interface CharacterActionQuery {
  characterId?: string
  chapterNumber?: number
}

export class CharacterActionRepository {
  static ensureSchema(db: ProjectDatabase): void {
    ensureCharacterActionSchema(db)
  }

  static listActions(query: CharacterActionQuery = {}): CharacterActionView[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM character_actions ORDER BY updated_at DESC, id').all() as CharacterActionRow[]
    let actions: CharacterActionView[] = rows.map(row => {
      const action = rowToAction(row)
      const view: CharacterActionView = { ...action }
      if (action.eventId) {
        const eventRow = db.prepare(
          'SELECT id, title, time_label, sort_order, status, outcome, aftermath FROM story_timeline_events WHERE id = ?',
        ).get(action.eventId) as TimelineEventProjectionRow | undefined
        if (eventRow) view.event = eventProjection(eventRow)
        else view.eventDangling = true
      }
      return view
    })
    if (query.characterId) actions = actions.filter(action => action.characterId === query.characterId)
    if (query.chapterNumber !== undefined) {
      actions = actions.filter(action => (
        action.relatedChapterNumbers.includes(query.chapterNumber as number)
        || (action.narrativePosition.kind === 'chapter-scene'
          && action.narrativePosition.chapterNumber === query.chapterNumber)
      ))
    }
    return actions
  }

  static getAction(id: string): CharacterAction | null {
    const db = requireDb()
    const row = db.prepare('SELECT * FROM character_actions WHERE id = ?').get(id) as CharacterActionRow | undefined
    return row ? rowToAction(row) : null
  }

  static saveAction(input: CharacterActionSaveInput): CharacterActionSaveResult {
    assertValidCharacterActionDraft(input)
    if (input.status === 'prose' && input.proseAnchor && !input.proseAnchor.contentHash) {
      input.proseAnchor.contentHash = computeProseContentHash(input.proseAnchor.excerpt)
    }
    const db = requireDb()
    const tx = db.transaction((): CharacterActionSaveResult => {
      const now = new Date().toISOString()
      const payload = JSON.stringify({
        resources: input.resources,
        constraints: input.constraints,
        basedOnKnowledgeIds: input.basedOnKnowledgeIds,
        storyPosition: input.storyPosition,
        narrativePosition: input.narrativePosition,
        ...(input.outcome ? { outcome: input.outcome } : {}),
        ...(input.aftermath ? { aftermath: input.aftermath } : {}),
        ...(input.proseAnchor ? { proseAnchor: input.proseAnchor } : {}),
        relatedChapterNumbers: input.relatedChapterNumbers,
      })
      if (input.id) {
        const currentRow = db.prepare('SELECT * FROM character_actions WHERE id = ?').get(input.id) as CharacterActionRow | undefined
        if (!currentRow) return { success: false, error: `行动记录不存在：${input.id}` }
        const baseRevision = input.baseRevision ?? currentRow.revision
        if (baseRevision !== currentRow.revision) {
          return { success: false, conflict: true, currentRevision: currentRow.revision }
        }
        db.prepare(`
          UPDATE character_actions
          SET character_id = ?, title = ?, goal = ?, event_id = ?, planned_note = ?,
              visibility = ?, status = ?, payload = ?, revision = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.characterId, input.title, input.goal, input.eventId ?? null, input.plannedNote ?? null,
          input.visibility, input.status, payload, currentRow.revision + 1, now, input.id,
        )
        return { success: true, id: input.id, revision: currentRow.revision + 1 }
      }
      const id = createCharacterActionId()
      db.prepare(`
        INSERT INTO character_actions (id, character_id, title, goal, event_id, planned_note, visibility, status, payload, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id, input.characterId, input.title, input.goal, input.eventId ?? null, input.plannedNote ?? null,
        input.visibility, input.status, payload, now, now,
      )
      return { success: true, id, revision: 1 }
    })
    return tx()
  }

  static deleteAction(id: string): { success: boolean; error?: string } {
    const db = requireDb()
    db.prepare('DELETE FROM character_actions WHERE id = ?').run(id)
    return { success: true }
  }

  /**
   * 把未排入时间线的行动作为事件加入故事时间线并关联（幂等）。
   * 已有 eventId → 直接返回成功；否则在同一事务内创建 planned 事件 + 回填引用。
   * 重复操作不重复创建（契约 §4.1）。
   */
  static promoteToTimeline(input: {
    id: string
    characterName: string
    chapterNumbers?: number[]
  }): { success: boolean; eventId?: string; alreadyLinked?: boolean; error?: string } {
    const db = requireDb()
    const tx = db.transaction((): { success: boolean; eventId?: string; alreadyLinked?: boolean; error?: string } => {
      const row = db.prepare('SELECT * FROM character_actions WHERE id = ?').get(input.id) as CharacterActionRow | undefined
      if (!row) return { success: false, error: `行动记录不存在：${input.id}` }
      if (row.event_id) return { success: true, eventId: row.event_id, alreadyLinked: true }
      const payload = JSON.parse(row.payload) as Partial<CharacterAction>
      const name = input.characterName.trim()
      if (!name) return { success: false, error: '缺少人物当前名称，无法写入时间线' }
      const eventId = randomCanvasUuid()
      const now = new Date().toISOString()
      const maxOrder = (db.prepare('SELECT MAX(sort_order) AS m FROM story_timeline_events').get() as { m: number | null }).m
      const sortOrder = (maxOrder ?? 0) + 10
      db.prepare(`
        INSERT INTO story_timeline_events (
          id, branch_id, parent_event_id, title, time_label, sort_order, precision, range_end_label, description,
          chapter_numbers, character_names, location_node_ids, status, outcome, aftermath, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'unknown', '', ?, ?, ?, ?, 'planned', '', '', ?, ?)
      `).run(
        eventId,
        STORY_TIMELINE_MAIN_BRANCH_ID,
        row.title,
        '',
        sortOrder,
        [row.planned_note ?? '', row.goal].filter(Boolean).join('\n'),
        JSON.stringify((input.chapterNumbers ?? payload.relatedChapterNumbers ?? []).map(String)),
        JSON.stringify([name]),
        JSON.stringify([]),
        now,
        now,
      )
      db.prepare('UPDATE character_actions SET event_id = ?, updated_at = ? WHERE id = ?')
        .run(eventId, now, input.id)
      const updatedPayload = { ...payload, storyPosition: { kind: 'timeline-event', eventId } }
      db.prepare('UPDATE character_actions SET payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(updatedPayload), now, input.id)
      return { success: true, eventId }
    })
    return tx()
  }

  /**
   * 校验行动的正文锚点在给定正文中是否仍有效（失效 → 需重新定位，不改写）。
   */
  static checkProseAnchor(actionId: string, currentContent: string): 'intact' | 'stale' | 'no-anchor' {
    const action = CharacterActionRepository.getAction(actionId)
    if (!action?.proseAnchor) return 'no-anchor'
    return validateProseAnchor(action.proseAnchor, currentContent)
  }
}
