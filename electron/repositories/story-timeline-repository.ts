import { getProjectDb } from '../database'
import type {
  StoryTimelineEvent,
  StoryTimelineSettings,
  StoryTimelineSnapshot,
} from '../../src/shared/story-timeline'

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function parseStringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function parseChapterNumbers(value: string): number[] {
  return parseStringList(value)
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item > 0)
}

function mapEvent(row: {
  id: string
  title: string
  time_label: string
  sort_order: number
  precision: StoryTimelineEvent['precision']
  range_end_label: string
  description: string
  chapter_numbers: string
  character_names: string
  location_node_ids: string
  status: StoryTimelineEvent['status']
  created_at: string
  updated_at: string
}): StoryTimelineEvent {
  return {
    id: row.id,
    title: row.title,
    timeLabel: row.time_label,
    sortOrder: row.sort_order,
    precision: row.precision,
    rangeEndLabel: row.range_end_label || undefined,
    description: row.description,
    chapterNumbers: parseChapterNumbers(row.chapter_numbers),
    characterNames: parseStringList(row.character_names),
    locationNodeIds: parseStringList(row.location_node_ids),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class StoryTimelineRepository {
  static getAll(): StoryTimelineSnapshot {
    const db = requireDb()
    const settingsRow = db.prepare(`
      SELECT title, ruler_label, ruler_unit, updated_at
      FROM story_timeline_settings
      WHERE id = 'main'
    `).get() as { title: string; ruler_label: string; ruler_unit: string; updated_at: string } | undefined

    const rows = db.prepare(`
      SELECT id, title, time_label, sort_order, precision, range_end_label, description,
             chapter_numbers, character_names, location_node_ids, status, created_at, updated_at
      FROM story_timeline_events
      ORDER BY sort_order ASC, created_at ASC
    `).all() as Parameters<typeof mapEvent>[0][]

    return {
      settings: settingsRow
        ? {
            title: settingsRow.title,
            rulerLabel: settingsRow.ruler_label,
            rulerUnit: settingsRow.ruler_unit,
            updatedAt: settingsRow.updated_at,
          }
        : { title: '故事时间线', rulerLabel: '故事时间', rulerUnit: '刻度' },
      events: rows.map(mapEvent),
    }
  }

  static saveSettings(settings: StoryTimelineSettings): StoryTimelineSettings {
    const db = requireDb()
    const now = new Date().toISOString()
    const title = settings.title.trim() || '故事时间线'
    const rulerLabel = settings.rulerLabel.trim() || '故事时间'
    const rulerUnit = settings.rulerUnit.trim() || '刻度'
    db.prepare(`
      INSERT INTO story_timeline_settings (id, title, ruler_label, ruler_unit, updated_at)
      VALUES ('main', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        ruler_label = excluded.ruler_label,
        ruler_unit = excluded.ruler_unit,
        updated_at = excluded.updated_at
    `).run(title, rulerLabel, rulerUnit, now)
    return { title, rulerLabel, rulerUnit, updatedAt: now }
  }

  static upsertEvent(event: StoryTimelineEvent): StoryTimelineEvent {
    const db = requireDb()
    if (!event.id || !event.title.trim() || !event.timeLabel.trim() || !Number.isFinite(event.sortOrder)) {
      throw new Error('时间线事件必须包含标题、自定义时间与排序刻度')
    }
    const now = new Date().toISOString()
    const chapterNumbers = [...new Set(event.chapterNumbers.filter(value => Number.isInteger(value) && value > 0))]
    const characterNames = [...new Set(event.characterNames.map(value => value.trim()).filter(Boolean))]
    const locationNodeIds = [...new Set(event.locationNodeIds.map(value => value.trim()).filter(Boolean))]
    db.prepare(`
      INSERT INTO story_timeline_events (
        id, title, time_label, sort_order, precision, range_end_label, description,
        chapter_numbers, character_names, location_node_ids, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        time_label = excluded.time_label,
        sort_order = excluded.sort_order,
        precision = excluded.precision,
        range_end_label = excluded.range_end_label,
        description = excluded.description,
        chapter_numbers = excluded.chapter_numbers,
        character_names = excluded.character_names,
        location_node_ids = excluded.location_node_ids,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      event.id,
      event.title.trim(),
      event.timeLabel.trim(),
      event.sortOrder,
      event.precision,
      event.rangeEndLabel?.trim() || '',
      event.description.trim(),
      JSON.stringify(chapterNumbers.map(String)),
      JSON.stringify(characterNames),
      JSON.stringify(locationNodeIds),
      event.status,
      event.createdAt || now,
      now,
    )
    return {
      ...event,
      title: event.title.trim(),
      timeLabel: event.timeLabel.trim(),
      rangeEndLabel: event.rangeEndLabel?.trim() || undefined,
      description: event.description.trim(),
      chapterNumbers,
      characterNames,
      locationNodeIds,
      createdAt: event.createdAt || now,
      updatedAt: now,
    }
  }

  static deleteEvent(id: string): void {
    if (!id) throw new Error('缺少时间线事件标识')
    requireDb().prepare('DELETE FROM story_timeline_events WHERE id = ?').run(id)
  }

  static reorderEvents(orderedIds: string[]): void {
    const db = requireDb()
    const uniqueIds = [...new Set(orderedIds.filter(Boolean))]
    const tx = db.transaction(() => {
      const update = db.prepare('UPDATE story_timeline_events SET sort_order = ?, updated_at = ? WHERE id = ?')
      const now = new Date().toISOString()
      uniqueIds.forEach((id, index) => update.run(index + 1, now, id))
    })
    tx()
  }
}
