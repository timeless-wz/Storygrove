import { getProjectDb } from '../database'
import type {
  StoryTimelineBranch,
  StoryTimelineEvent,
  StoryTimelineSettings,
  StoryTimelineSnapshot,
} from '../../src/shared/story-timeline'
import { DEFAULT_TIMELINE_SETTINGS, STORY_TIMELINE_MAIN_BRANCH_ID } from '../../src/shared/story-timeline'

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

function mapBranch(row: {
  id: string
  name: string
  source_event_id: string | null
  color: string | null
  sort_order: number
  created_at: string
  updated_at: string
}): StoryTimelineBranch {
  return {
    id: row.id,
    name: row.name,
    sourceEventId: row.source_event_id || null,
    color: row.color || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEvent(row: {
  id: string
  branch_id?: string
  parent_event_id?: string | null
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
    branchId: row.branch_id || STORY_TIMELINE_MAIN_BRANCH_ID,
    parentEventId: row.parent_event_id || null,
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

const DEFAULT_MAIN_BRANCH: StoryTimelineBranch = {
  id: STORY_TIMELINE_MAIN_BRANCH_ID,
  name: '主时间轴',
  sourceEventId: null,
  sortOrder: 0,
}

export class StoryTimelineRepository {
  static getAll(): StoryTimelineSnapshot {
    const db = requireDb()
    const settingsRow = db.prepare(`
      SELECT title, ruler_label, ruler_unit,
             start_label, start_time_label, start_order,
             end_label, end_time_label, end_order,
             has_custom_range, updated_at
      FROM story_timeline_settings
      WHERE id = 'main'
    `).get() as {
      title: string
      ruler_label: string
      ruler_unit: string
      start_label: string | null
      start_time_label: string | null
      start_order: number | null
      end_label: string | null
      end_time_label: string | null
      end_order: number | null
      has_custom_range: number | null
      updated_at: string
    } | undefined

    const branchRows = db.prepare(`
      SELECT id, name, source_event_id, color, sort_order, created_at, updated_at
      FROM story_timeline_branches
      ORDER BY sort_order ASC, created_at ASC
    `).all() as Parameters<typeof mapBranch>[0][]

    const branches = branchRows.length > 0 ? branchRows.map(mapBranch) : [DEFAULT_MAIN_BRANCH]
    if (!branches.some(branch => branch.id === STORY_TIMELINE_MAIN_BRANCH_ID)) {
      branches.unshift(DEFAULT_MAIN_BRANCH)
    }

    const rows = db.prepare(`
      SELECT id, branch_id, parent_event_id, title, time_label, sort_order, precision, range_end_label, description,
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
            startLabel: settingsRow.start_label || '故事开端',
            startTimeLabel: settingsRow.start_time_label || '',
            startOrder: typeof settingsRow.start_order === 'number' ? settingsRow.start_order : undefined,
            endLabel: settingsRow.end_label || '故事结束',
            endTimeLabel: settingsRow.end_time_label || '',
            endOrder: typeof settingsRow.end_order === 'number' ? settingsRow.end_order : undefined,
            hasCustomRange: Boolean(settingsRow.has_custom_range),
            updatedAt: settingsRow.updated_at,
          }
        : DEFAULT_TIMELINE_SETTINGS,
      branches,
      events: rows.map(mapEvent),
    }
  }

  static saveSettings(settings: StoryTimelineSettings): StoryTimelineSettings {
    const db = requireDb()
    const now = new Date().toISOString()
    const title = settings.title.trim() || '故事时间线'
    const rulerLabel = settings.rulerLabel.trim() || '故事时间'
    const rulerUnit = settings.rulerUnit.trim() || '刻度'
    const startLabel = settings.startLabel?.trim() || '故事开端'
    const startTimeLabel = settings.startTimeLabel?.trim() || ''
    const startOrder = typeof settings.startOrder === 'number' && Number.isFinite(settings.startOrder)
      ? settings.startOrder
      : null
    const endLabel = settings.endLabel?.trim() || '故事结束'
    const endTimeLabel = settings.endTimeLabel?.trim() || ''
    const endOrder = typeof settings.endOrder === 'number' && Number.isFinite(settings.endOrder)
      ? settings.endOrder
      : null
    const hasCustomRange = settings.hasCustomRange || (startOrder !== null && endOrder !== null) ? 1 : 0

    db.prepare(`
      INSERT INTO story_timeline_settings (
        id, title, ruler_label, ruler_unit,
        start_label, start_time_label, start_order,
        end_label, end_time_label, end_order,
        has_custom_range, updated_at
      )
      VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        ruler_label = excluded.ruler_label,
        ruler_unit = excluded.ruler_unit,
        start_label = excluded.start_label,
        start_time_label = excluded.start_time_label,
        start_order = excluded.start_order,
        end_label = excluded.end_label,
        end_time_label = excluded.end_time_label,
        end_order = excluded.end_order,
        has_custom_range = excluded.has_custom_range,
        updated_at = excluded.updated_at
    `).run(
      title, rulerLabel, rulerUnit,
      startLabel, startTimeLabel, startOrder,
      endLabel, endTimeLabel, endOrder,
      hasCustomRange, now,
    )
    return {
      title,
      rulerLabel,
      rulerUnit,
      startLabel,
      startTimeLabel,
      startOrder: startOrder ?? undefined,
      endLabel,
      endTimeLabel,
      endOrder: endOrder ?? undefined,
      hasCustomRange: Boolean(hasCustomRange),
      updatedAt: now,
    }
  }

  static upsertBranch(branch: StoryTimelineBranch): StoryTimelineBranch {
    const db = requireDb()
    if (!branch.id || !branch.name.trim()) {
      throw new Error('时间线分支必须包含唯一标识与名称')
    }
    const now = new Date().toISOString()
    const name = branch.name.trim()
    const sourceEventId = branch.id === STORY_TIMELINE_MAIN_BRANCH_ID ? null : (branch.sourceEventId ?? null)
    const color = branch.color?.trim() || null
    const sortOrder = Number.isFinite(branch.sortOrder) ? branch.sortOrder : 1

    db.prepare(`
      INSERT INTO story_timeline_branches (id, name, source_event_id, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_event_id = excluded.source_event_id,
        color = excluded.color,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(branch.id, name, sourceEventId, color, sortOrder, branch.createdAt || now, now)

    return {
      id: branch.id,
      name,
      sourceEventId,
      color: color ?? undefined,
      sortOrder,
      createdAt: branch.createdAt || now,
      updatedAt: now,
    }
  }

  static deleteBranch(branchId: string): void {
    if (!branchId) throw new Error('缺少分支标识')
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) {
      throw new Error('主时间轴为核心基准，不可删除')
    }
    const db = requireDb()
    const tx = db.transaction(() => {
      // 递归查找该分支及该分支上事件所衍生的全部下级支线
      const branchIdsToDelete = new Set<string>([branchId])
      let added = true
      while (added) {
        added = false
        const placeholders = Array.from(branchIdsToDelete).map(() => '?').join(',')
        const childBranchRows = db.prepare(`
          SELECT b.id FROM story_timeline_branches b
          INNER JOIN story_timeline_events e ON b.source_event_id = e.id
          WHERE e.branch_id IN (${placeholders})
        `).all(...Array.from(branchIdsToDelete)) as Array<{ id: string }>

        for (const child of childBranchRows) {
          if (!branchIdsToDelete.has(child.id)) {
            branchIdsToDelete.add(child.id)
            added = true
          }
        }
      }

      const placeholders = Array.from(branchIdsToDelete).map(() => '?').join(',')
      db.prepare(`DELETE FROM story_timeline_events WHERE branch_id IN (${placeholders})`).run(...Array.from(branchIdsToDelete))
      db.prepare(`DELETE FROM story_timeline_branches WHERE id IN (${placeholders})`).run(...Array.from(branchIdsToDelete))
    })
    tx()
  }

  static upsertEvent(event: StoryTimelineEvent): StoryTimelineEvent {
    const db = requireDb()
    if (!event.id || !event.title.trim() || !event.timeLabel.trim() || !Number.isFinite(event.sortOrder)) {
      throw new Error('时间线事件必须包含标题、自定义时间与排序刻度')
    }
    const branchId = event.branchId?.trim() || STORY_TIMELINE_MAIN_BRANCH_ID
    const parentEventId = event.parentEventId?.trim() || null
    const now = new Date().toISOString()
    const chapterNumbers = [...new Set(event.chapterNumbers.filter(value => Number.isInteger(value) && value > 0))]
    const characterNames = [...new Set(event.characterNames.map(value => value.trim()).filter(Boolean))]
    const locationNodeIds = [...new Set(event.locationNodeIds.map(value => value.trim()).filter(Boolean))]

    db.prepare(`
      INSERT INTO story_timeline_events (
        id, branch_id, parent_event_id, title, time_label, sort_order, precision, range_end_label, description,
        chapter_numbers, character_names, location_node_ids, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id,
        parent_event_id = excluded.parent_event_id,
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
      branchId,
      parentEventId,
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
      branchId,
      parentEventId,
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
    const db = requireDb()
    const tx = db.transaction(() => {
      // 若有以此事件为源头分叉出的支线，连带级联清理其支线及支线下属事件
      const childBranches = db.prepare(
        'SELECT id FROM story_timeline_branches WHERE source_event_id = ?',
      ).all(id) as Array<{ id: string }>

      for (const branch of childBranches) {
        StoryTimelineRepository.deleteBranch(branch.id)
      }

      db.prepare('DELETE FROM story_timeline_events WHERE id = ?').run(id)
    })
    tx()
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
