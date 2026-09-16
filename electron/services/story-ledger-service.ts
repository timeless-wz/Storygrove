import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import type { EntityStateSnapshot, StoryEventRecord } from '../../src/shared/story-ledger'

function database() { const db = getProjectDb(); if (!db) throw new Error('项目数据库未打开'); return db }
function parse<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value)) as T } catch { return fallback } }
function event(row: Record<string, unknown>): StoryEventRecord { return { eventId: String(row.event_id), projectId: String(row.project_id), title: String(row.title), ...(row.chapter_number == null ? {} : { chapterNumber: Number(row.chapter_number) }), ...(row.story_time ? { storyTime: String(row.story_time) } : {}), ...(row.location ? { location: String(row.location) } : {}), participantFactIds: parse(row.participant_fact_ids_json, []), preconditions: parse(row.preconditions_json, []), result: parse(row.result_json, {}), source: parse(row.source_json, {}), status: row.status as StoryEventRecord['status'] } }

export function saveStoryEvent(input: Omit<StoryEventRecord, 'eventId'> & { eventId?: string }): StoryEventRecord {
  if (!input.projectId.trim() || !input.title.trim()) throw new Error('事件必须包含项目和标题')
  const id = input.eventId ?? randomUUID(); const db = database()
  db.prepare(`INSERT INTO story_events (event_id,project_id,title,chapter_number,story_time,location,participant_fact_ids_json,preconditions_json,result_json,source_json,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(event_id) DO UPDATE SET title=excluded.title,chapter_number=excluded.chapter_number,story_time=excluded.story_time,location=excluded.location,participant_fact_ids_json=excluded.participant_fact_ids_json,preconditions_json=excluded.preconditions_json,result_json=excluded.result_json,source_json=excluded.source_json,status=excluded.status,updated_at=datetime('now')`).run(id, input.projectId, input.title.trim(), input.chapterNumber ?? null, input.storyTime ?? null, input.location ?? null, JSON.stringify(input.participantFactIds), JSON.stringify(input.preconditions), JSON.stringify(input.result), JSON.stringify(input.source), input.status)
  return event(db.prepare('SELECT * FROM story_events WHERE event_id = ? AND project_id = ?').get(id, input.projectId) as Record<string, unknown>)
}

export function listStoryEvents(projectId: string, chapterNumber?: number): StoryEventRecord[] {
  const db = database(); const rows = chapterNumber === undefined ? db.prepare('SELECT * FROM story_events WHERE project_id = ? ORDER BY chapter_number, event_id').all(projectId) : db.prepare('SELECT * FROM story_events WHERE project_id = ? AND chapter_number = ? ORDER BY event_id').all(projectId, chapterNumber)
  return (rows as Array<Record<string, unknown>>).map(event)
}

export function saveEntityStateSnapshot(input: Omit<EntityStateSnapshot, 'snapshotId'> & { snapshotId?: string }): EntityStateSnapshot {
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) throw new Error('章节号无效')
  const id = input.snapshotId ?? randomUUID(); const db = database()
  db.prepare(`INSERT INTO entity_state_snapshots (snapshot_id,project_id,entity_fact_id,chapter_number,state_json,source_json,authority_status) VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id,entity_fact_id,chapter_number) DO UPDATE SET state_json=excluded.state_json,source_json=excluded.source_json,authority_status=excluded.authority_status`).run(id, input.projectId, input.entityFactId, input.chapterNumber, JSON.stringify(input.state), JSON.stringify(input.source), input.authorityStatus)
  const row = db.prepare('SELECT * FROM entity_state_snapshots WHERE project_id = ? AND entity_fact_id = ? AND chapter_number = ?').get(input.projectId, input.entityFactId, input.chapterNumber) as Record<string, unknown>
  return { snapshotId: String(row.snapshot_id), projectId: String(row.project_id), entityFactId: String(row.entity_fact_id), chapterNumber: Number(row.chapter_number), state: parse(row.state_json, {}), source: parse(row.source_json, {}), authorityStatus: row.authority_status as EntityStateSnapshot['authorityStatus'] }
}

export function getEntityStateAtChapter(projectId: string, entityFactId: string, chapterNumber: number): EntityStateSnapshot | null {
  const db = database(); const row = db.prepare('SELECT * FROM entity_state_snapshots WHERE project_id = ? AND entity_fact_id = ? AND chapter_number <= ? AND authority_status = \'confirmed\' ORDER BY chapter_number DESC LIMIT 1').get(projectId, entityFactId, chapterNumber) as Record<string, unknown> | undefined
  return row ? { snapshotId: String(row.snapshot_id), projectId: String(row.project_id), entityFactId: String(row.entity_fact_id), chapterNumber: Number(row.chapter_number), state: parse(row.state_json, {}), source: parse(row.source_json, {}), authorityStatus: 'confirmed' } : null
}
