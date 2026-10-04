import { getProjectDb } from '../database'
import type {
  StoryTimelineBranch,
  StoryTimelineDeleteCommitResult,
  StoryTimelineDeleteImpact,
  StoryTimelineEvent,
  StoryTimelineSettings,
  StoryTimelineSnapshot,
} from '../../src/shared/story-timeline'
import {
  DEFAULT_TIMELINE_SETTINGS,
  STORY_TIMELINE_ANCHOR_NODE_IDS,
  STORY_TIMELINE_MAIN_BRANCH_ID,
  fingerprintStoryTimelineIds,
  isStoryTimelineAnchorNodeId,
} from '../../src/shared/story-timeline'
import { tableExists } from '../services/world-workbench-schema'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

const ANCHOR_DELETE_REJECTION = `时间线起止锚点（${STORY_TIMELINE_ANCHOR_NODE_IDS.join(' / ')}）来自故事范围设置，不是事件，不可删除`
const MAIN_BRANCH_REJECTION = '主时间轴为核心基准，不可删除'

const VALID_PRECISIONS: readonly StoryTimelineEvent['precision'][] = ['exact', 'range', 'relative', 'unknown']
const VALID_STATUSES: readonly StoryTimelineEvent['status'][] = ['planned', 'drafted', 'finalized']

function requireDb(): ProjectDatabase {
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
  is_historical?: number | null
  outcome?: string | null
  aftermath?: string | null
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
    isHistorical: Boolean(row.is_historical),
    outcome: row.outcome ?? '',
    aftermath: row.aftermath ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 事件载荷的后端校验，渲染层检查之外的最后防线。
 * precision/status 的非法值即使漏到这里，也会被建表 CHECK 约束拒绝，
 * 这里先行拒绝是为了给出可理解的错误而不是 SQLite 内部报错。
 */
function assertValidEventPayload(event: StoryTimelineEvent): void {
  if (!event || typeof event !== 'object') throw new Error('时间线事件载荷无效')
  if (!event.id || typeof event.id !== 'string') throw new Error('时间线事件必须包含唯一标识')
  if (!event.title?.trim()) throw new Error('时间线事件必须包含标题')
  if (!event.timeLabel?.trim()) throw new Error('时间线事件必须包含自定义时间')
  if (!Number.isFinite(event.sortOrder)) throw new Error('时间线事件必须包含有效的排序刻度')
  if (!VALID_PRECISIONS.includes(event.precision)) {
    throw new Error(`时间线事件时间精度无效：${String(event.precision)}`)
  }
  if (!VALID_STATUSES.includes(event.status)) {
    throw new Error(`时间线事件状态无效：${String(event.status)}`)
  }
  if (!Array.isArray(event.chapterNumbers) || !Array.isArray(event.characterNames) || !Array.isArray(event.locationNodeIds)) {
    throw new Error('时间线事件的章节、人物与地点关联必须是列表')
  }
}

interface CascadeCollect {
  eventIds: string[]
  branchIds: string[]
  branchNames: string[]
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
             chapter_numbers, character_names, location_node_ids, status,
             is_historical, outcome, aftermath, created_at, updated_at
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

  /**
   * 从来源事件出发，沿“事件 → 所属支线 → 该支线的来源事件”向上回溯。
   * 若途中回到 branchId 自身，说明把来源指到该支线自己或其下游，
   * 支线会成为自己的后代而形成环。
   */
  private static assertBranchSourceAcyclic(
    db: ProjectDatabase,
    branchId: string,
    sourceEventId: string,
  ): void {
    const visitedEvents = new Set<string>()
    const visitedBranches = new Set<string>()
    let cursorEventId: string | null = sourceEventId
    while (cursorEventId && !visitedEvents.has(cursorEventId)) {
      visitedEvents.add(cursorEventId)
      const eventRow = db.prepare(
        'SELECT branch_id FROM story_timeline_events WHERE id = ?',
      ).get(cursorEventId) as { branch_id: string | null } | undefined
      if (!eventRow) break
      const ownerBranchId = eventRow.branch_id || STORY_TIMELINE_MAIN_BRANCH_ID
      if (ownerBranchId === branchId) {
        throw new Error('支线来源事件不能位于该支线自身或其下游支线，否则会形成环')
      }
      if (visitedBranches.has(ownerBranchId)) break
      visitedBranches.add(ownerBranchId)
      const branchRow = db.prepare(
        'SELECT source_event_id FROM story_timeline_branches WHERE id = ?',
      ).get(ownerBranchId) as { source_event_id: string | null } | undefined
      cursorEventId = branchRow?.source_event_id || null
    }
  }

  /**
   * 支线来源的后端校验。来源事件必须存在于当前项目；
   * 变更来源（或新建支线）时额外做环检测。来源未变化的重命名不做强校验，
   * 避免历史悬空来源 blocking 作者修复数据。
   */
  private static assertBranchSourceValid(
    db: ProjectDatabase,
    branchId: string,
    sourceEventId: string | null,
    options: { requireSource: boolean; sourceChanged: boolean },
  ): void {
    if (!sourceEventId) {
      if (options.requireSource) {
        throw new Error('创建支线必须指定分叉来源事件')
      }
      return
    }
    if (options.sourceChanged) {
      const sourceRow = db.prepare(
        'SELECT id FROM story_timeline_events WHERE id = ?',
      ).get(sourceEventId)
      if (!sourceRow) {
        throw new Error(`分叉来源事件不存在于当前项目：${sourceEventId}`)
      }
      StoryTimelineRepository.assertBranchSourceAcyclic(db, branchId, sourceEventId)
    }
  }

  static upsertBranch(branch: StoryTimelineBranch): StoryTimelineBranch {
    const db = requireDb()
    if (!branch.id || !branch.name.trim()) {
      throw new Error('时间线分支必须包含唯一标识与名称')
    }
    if (branch.id === STORY_TIMELINE_MAIN_BRANCH_ID && branch.sourceEventId) {
      throw new Error('主时间轴不能设置分叉来源')
    }
    const now = new Date().toISOString()
    const name = branch.name.trim()
    const sourceEventId = branch.id === STORY_TIMELINE_MAIN_BRANCH_ID ? null : (branch.sourceEventId ?? null)
    const color = branch.color?.trim() || null
    const sortOrder = Number.isFinite(branch.sortOrder) ? branch.sortOrder : 1

    const existingRow = db.prepare(
      'SELECT source_event_id FROM story_timeline_branches WHERE id = ?',
    ).get(branch.id) as { source_event_id: string | null } | undefined
    const sourceChanged = (existingRow?.source_event_id || null) !== (sourceEventId || null)
    StoryTimelineRepository.assertBranchSourceValid(db, branch.id, sourceEventId, {
      requireSource: false,
      sourceChanged,
    })

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

  /**
   * 原子创建支线及其首事件：来源存在性、环检测、归属一致与载荷校验
   * 全部在同一个 SQLite 事务内完成后才执行两条写入，任一步失败整体回滚，
   * 绝不留下“有支线无事件”的空分支。重复提交携带稳定 ID 时按 upsert
   * 幂等收敛，不会产生重复支线。
   */
  static createBranchWithEvent(
    branch: StoryTimelineBranch,
    event: StoryTimelineEvent,
  ): { branch: StoryTimelineBranch; event: StoryTimelineEvent } {
    const db = requireDb()
    if (!branch.id || !branch.name.trim()) {
      throw new Error('时间线分支必须包含唯一标识与名称')
    }
    if (branch.id === STORY_TIMELINE_MAIN_BRANCH_ID) {
      throw new Error('支线不能占用主时间轴标识')
    }
    if (!branch.sourceEventId) {
      throw new Error('创建支线必须指定分叉来源事件')
    }
    assertValidEventPayload(event)
    const declaredBranchId = event.branchId?.trim() || ''
    if (declaredBranchId && declaredBranchId !== branch.id) {
      throw new Error(`首事件归属的支线（${declaredBranchId}）与目标支线（${branch.id}）不一致`)
    }

    const tx = db.transaction(() => {
      // 来源与归属校验在事务内基于当前库状态执行，写入前最后一刻仍然成立。
      const sourceRow = db.prepare(
        'SELECT id FROM story_timeline_events WHERE id = ?',
      ).get(branch.sourceEventId as string)
      if (!sourceRow) {
        throw new Error(`分叉来源事件不存在于当前项目：${branch.sourceEventId}`)
      }
      StoryTimelineRepository.assertBranchSourceAcyclic(db, branch.id, branch.sourceEventId as string)

      const writtenBranch = StoryTimelineRepository.upsertBranch(branch)
      const writtenEvent = StoryTimelineRepository.upsertEvent({ ...event, branchId: branch.id })
      return { branch: writtenBranch, event: writtenEvent }
    })
    return tx()
  }

  /**
   * 收集一条支线及其全部下游支线（含嵌套）。下游的展开规则：
   * 已收集支线上的事件若被其他支线声明为分叉来源，则那些支线一并收集。
   * 预览与真实删除共用，不得出现两套规则。
   */
  private static collectBranchCascade(db: ProjectDatabase, rootBranchId: string): CascadeCollect {
    const branchIds: string[] = [rootBranchId]
    const seen = new Set<string>([rootBranchId])
    let added = true
    while (added) {
      added = false
      const placeholders = branchIds.map(() => '?').join(',')
      const childBranchRows = db.prepare(`
        SELECT b.id FROM story_timeline_branches b
        INNER JOIN story_timeline_events e ON b.source_event_id = e.id
        WHERE e.branch_id IN (${placeholders})
      `).all(...branchIds) as Array<{ id: string }>

      for (const child of childBranchRows) {
        if (!seen.has(child.id)) {
          seen.add(child.id)
          branchIds.push(child.id)
          added = true
        }
      }
    }

    const namePlaceholders = branchIds.map(() => '?').join(',')
    const nameRows = db.prepare(
      `SELECT id, name FROM story_timeline_branches WHERE id IN (${namePlaceholders})`,
    ).all(...branchIds) as Array<{ id: string; name: string }>
    const nameById = new Map(nameRows.map(row => [row.id, row.name]))

    const sortedBranchIds = [...branchIds].sort()
    const eventRows = db.prepare(
      `SELECT id FROM story_timeline_events WHERE branch_id IN (${namePlaceholders})`,
    ).all(...branchIds) as Array<{ id: string }>
    const eventIds = [...new Set(eventRows.map(row => row.id))].sort()

    return {
      eventIds,
      branchIds: sortedBranchIds,
      branchNames: sortedBranchIds.map(id => nameById.get(id) || id),
    }
  }

  /**
   * 删除事件的完整影响：事件本身，加上以它为分叉来源的下游支线
   * （含嵌套）及其全部事件。与旧级联语义完全一致。
   */
  private static collectEventDeleteImpact(db: ProjectDatabase, eventId: string): CascadeCollect {
    const eventRow = db.prepare(
      'SELECT title FROM story_timeline_events WHERE id = ?',
    ).get(eventId) as { title: string } | undefined
    if (!eventRow) {
      throw new Error('时间线事件不存在或已被删除')
    }

    const childBranchRows = db.prepare(
      'SELECT id, name FROM story_timeline_branches WHERE source_event_id = ? ORDER BY created_at ASC, id ASC',
    ).all(eventId) as Array<{ id: string; name: string }>
    const mergedBranchIds = new Set<string>()
    const mergedBranchNames = new Map<string, string>()
    for (const child of childBranchRows) {
      const cascade = StoryTimelineRepository.collectBranchCascade(db, child.id)
      for (const [index, branchId] of cascade.branchIds.entries()) {
        mergedBranchIds.add(branchId)
        mergedBranchNames.set(branchId, cascade.branchNames[index])
      }
    }

    const branchIds = [...mergedBranchIds].sort()
    const branchNames = branchIds.map(id => mergedBranchNames.get(id) || id)
    const eventIds = [...new Set([eventId, ...StoryTimelineRepository.collectEventIdsUnderBranches(db, branchIds)])].sort()

    return { eventIds, branchIds, branchNames }
  }

  private static collectEventIdsUnderBranches(db: ProjectDatabase, branchIds: readonly string[]): string[] {
    if (branchIds.length === 0) return []
    const placeholders = branchIds.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id FROM story_timeline_events WHERE branch_id IN (${placeholders})`,
    ).all(...branchIds) as Array<{ id: string }>
    return rows.map(row => row.id)
  }

  private static collectBranchDeleteImpact(db: ProjectDatabase, branchId: string): CascadeCollect {
    const branchRow = db.prepare(
      'SELECT name FROM story_timeline_branches WHERE id = ?',
    ).get(branchId) as { name: string } | undefined
    if (!branchRow) {
      throw new Error('时间线支线不存在或已被删除')
    }
    return StoryTimelineRepository.collectBranchCascade(db, branchId)
  }

  private static buildDeleteImpact(
    kind: 'event' | 'branch',
    targetId: string,
    targetLabel: string,
    collected: CascadeCollect,
  ): StoryTimelineDeleteImpact {
    return {
      kind,
      targetId,
      targetLabel,
      eventIds: collected.eventIds,
      branchIds: collected.branchIds,
      branchNames: collected.branchNames,
      eventCount: collected.eventIds.length,
      branchCount: collected.branchIds.length,
      fingerprint: fingerprintStoryTimelineIds(collected.eventIds, collected.branchIds),
    }
  }

  static previewEventDelete(eventId: string): StoryTimelineDeleteImpact {
    if (!eventId) throw new Error('缺少时间线事件标识')
    if (isStoryTimelineAnchorNodeId(eventId)) throw new Error(ANCHOR_DELETE_REJECTION)
    const db = requireDb()
    const eventRow = db.prepare(
      'SELECT title FROM story_timeline_events WHERE id = ?',
    ).get(eventId) as { title: string } | undefined
    if (!eventRow) throw new Error('时间线事件不存在或已被删除')
    return StoryTimelineRepository.buildDeleteImpact(
      'event',
      eventId,
      eventRow.title,
      StoryTimelineRepository.collectEventDeleteImpact(db, eventId),
    )
  }

  static previewBranchDelete(branchId: string): StoryTimelineDeleteImpact {
    if (!branchId) throw new Error('缺少分支标识')
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) throw new Error(MAIN_BRANCH_REJECTION)
    if (isStoryTimelineAnchorNodeId(branchId)) throw new Error(ANCHOR_DELETE_REJECTION)
    const db = requireDb()
    const branchRow = db.prepare(
      'SELECT name FROM story_timeline_branches WHERE id = ?',
    ).get(branchId) as { name: string } | undefined
    if (!branchRow) throw new Error('时间线支线不存在或已被删除')
    return StoryTimelineRepository.buildDeleteImpact(
      'branch',
      branchId,
      branchRow.name,
      StoryTimelineRepository.collectBranchDeleteImpact(db, branchId),
    )
  }

  /**
   * 确认删除事件：在同一事务内重新收集影响并比对预览指纹。
   * 指纹不一致说明确认期间级联范围已变化，此时不删除任何数据，
   * 返回 needsReconfirmation 与最新预览，绝不静默扩大删除范围。
   */
  static deleteEventConfirmed(eventId: string, expectedFingerprint: string): StoryTimelineDeleteCommitResult {
    if (!eventId) throw new Error('缺少时间线事件标识')
    if (isStoryTimelineAnchorNodeId(eventId)) throw new Error(ANCHOR_DELETE_REJECTION)
    const db = requireDb()
    const tx = db.transaction((): StoryTimelineDeleteCommitResult => {
      const eventRow = db.prepare('SELECT title FROM story_timeline_events WHERE id = ?').get(eventId) as { title: string } | undefined
      if (!eventRow) throw new Error('时间线事件不存在或已被删除')
      const collected = StoryTimelineRepository.collectEventDeleteImpact(db, eventId)
      const impact = StoryTimelineRepository.buildDeleteImpact('event', eventId, eventRow.title, collected)
      if (impact.fingerprint !== expectedFingerprint) {
        return {
          success: false,
          needsReconfirmation: true,
          error: '删除影响自预览后已变化，请基于最新影响重新确认',
          preview: impact,
        }
      }
      StoryTimelineRepository.performEventDelete(db, eventId, collected)
      return { success: true, deletedEventIds: collected.eventIds, deletedBranchIds: collected.branchIds }
    })
    return tx()
  }

  /**
   * 确认删除支线：语义与 deleteEventConfirmed 相同，目标是整条支线。
   */
  static deleteBranchConfirmed(branchId: string, expectedFingerprint: string): StoryTimelineDeleteCommitResult {
    if (!branchId) throw new Error('缺少分支标识')
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) throw new Error(MAIN_BRANCH_REJECTION)
    if (isStoryTimelineAnchorNodeId(branchId)) throw new Error(ANCHOR_DELETE_REJECTION)
    const db = requireDb()
    const tx = db.transaction((): StoryTimelineDeleteCommitResult => {
      const branchRow = db.prepare('SELECT name FROM story_timeline_branches WHERE id = ?').get(branchId) as { name: string } | undefined
      if (!branchRow) throw new Error('时间线支线不存在或已被删除')
      const collected = StoryTimelineRepository.collectBranchDeleteImpact(db, branchId)
      const impact = StoryTimelineRepository.buildDeleteImpact('branch', branchId, branchRow.name, collected)
      if (impact.fingerprint !== expectedFingerprint) {
        return {
          success: false,
          needsReconfirmation: true,
          error: '删除影响自预览后已变化，请基于最新影响重新确认',
          preview: impact,
        }
      }
      StoryTimelineRepository.deleteBranchCascade(db, branchId)
      return { success: true, deletedEventIds: collected.eventIds, deletedBranchIds: collected.branchIds }
    })
    return tx()
  }

  /** 在已开启的事务内执行事件级联删除（旧语义：仅目标事件的 world_trails 引用被解除）。 */
  private static performEventDelete(db: ProjectDatabase, eventId: string, collected: CascadeCollect): void {
    if (collected.branchIds.length > 0) {
      const placeholders = collected.branchIds.map(() => '?').join(',')
      db.prepare(`DELETE FROM story_timeline_events WHERE branch_id IN (${placeholders})`).run(...collected.branchIds)
      db.prepare(`DELETE FROM story_timeline_branches WHERE id IN (${placeholders})`).run(...collected.branchIds)
    }
    // 世界资料引用必须一起处理，绝不留下指向已删除事件的隐藏有效引用。
    // 关联的实体本身（势力/秘境/通道/人物/地点）一律保留，只解除关系。
    if (tableExists(db, 'world_trails')) {
      db.prepare('UPDATE world_trails SET event_id = NULL, updated_at = ? WHERE event_id = ?')
        .run(new Date().toISOString(), eventId)
    }
    db.prepare('DELETE FROM story_timeline_events WHERE id = ?').run(eventId)
  }

  /** 在已开启的事务内执行支线级联删除，返回实际删除的 ID 集合。 */
  private static deleteBranchCascade(db: ProjectDatabase, rootBranchId: string): CascadeCollect {
    const collected = StoryTimelineRepository.collectBranchCascade(db, rootBranchId)
    const placeholders = collected.branchIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM story_timeline_events WHERE branch_id IN (${placeholders})`).run(...collected.branchIds)
    db.prepare(`DELETE FROM story_timeline_branches WHERE id IN (${placeholders})`).run(...collected.branchIds)
    return collected
  }

  static deleteBranch(branchId: string): void {
    if (!branchId) throw new Error('缺少分支标识')
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) {
      throw new Error(MAIN_BRANCH_REJECTION)
    }
    const db = requireDb()
    const tx = db.transaction(() => {
      const exists = db.prepare('SELECT id FROM story_timeline_branches WHERE id = ?').get(branchId)
      if (!exists) return
      StoryTimelineRepository.deleteBranchCascade(db, branchId)
    })
    tx()
  }

  static upsertEvent(event: StoryTimelineEvent): StoryTimelineEvent {
    const db = requireDb()
    assertValidEventPayload(event)
    const branchId = event.branchId?.trim() || STORY_TIMELINE_MAIN_BRANCH_ID
    const parentEventId = event.parentEventId?.trim() || null
    const now = new Date().toISOString()
    const chapterNumbers = [...new Set(event.chapterNumbers.filter(value => Number.isInteger(value) && value > 0))]
    const characterNames = [...new Set(event.characterNames.map(value => value.trim()).filter(Boolean))]
    const locationNodeIds = [...new Set(event.locationNodeIds.map(value => value.trim()).filter(Boolean))]

    db.prepare(`
      INSERT INTO story_timeline_events (
        id, branch_id, parent_event_id, title, time_label, sort_order, precision, range_end_label, description,
        chapter_numbers, character_names, location_node_ids, status,
        is_historical, outcome, aftermath, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        is_historical = excluded.is_historical,
        outcome = excluded.outcome,
        aftermath = excluded.aftermath,
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
      event.isHistorical ? 1 : 0,
      event.outcome?.trim() || '',
      event.aftermath?.trim() || '',
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
      isHistorical: Boolean(event.isHistorical),
      outcome: event.outcome?.trim() || '',
      aftermath: event.aftermath?.trim() || '',
      createdAt: event.createdAt || now,
      updatedAt: now,
    }
  }

  static deleteEvent(id: string): void {
    if (!id) throw new Error('缺少时间线事件标识')
    if (isStoryTimelineAnchorNodeId(id)) throw new Error(ANCHOR_DELETE_REJECTION)
    const db = requireDb()
    const tx = db.transaction(() => {
      const exists = db.prepare('SELECT id FROM story_timeline_events WHERE id = ?').get(id)
      if (!exists) return
      // 若有以此事件为源头分叉出的支线，连带级联清理其支线及支线下属事件
      const childBranches = db.prepare(
        'SELECT id FROM story_timeline_branches WHERE source_event_id = ?',
      ).all(id) as Array<{ id: string }>
      const downstreamBranchIds = new Set<string>()
      for (const branch of childBranches) {
        for (const branchId of StoryTimelineRepository.collectBranchCascade(db, branch.id).branchIds) {
          downstreamBranchIds.add(branchId)
        }
      }
      StoryTimelineRepository.performEventDelete(db, id, {
        eventIds: [id],
        branchIds: [...downstreamBranchIds].sort(),
        branchNames: [],
      })
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
