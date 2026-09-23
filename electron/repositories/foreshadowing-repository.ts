import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'

export interface ForeshadowingRecord {
  id: string
  draftId: number
  chapterNumber: number
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
  note: string
  markerType: string
  color: string
  completed: boolean
  createdAt: string
  updatedAt: string
  completedAt: string | null
  sourceType: 'draft' | 'manuscript'
}

export interface CreateForeshadowingParams {
  id?: string
  draftId: number
  chapterNumber: number
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore?: string
  contextAfter?: string
  note: string
  markerType?: string
  color?: string
}

export interface UpdateForeshadowingParams {
  note?: string
  markerType?: string
  color?: string
}

interface RawForeshadowingRow {
  id: string
  draft_id: number
  chapter_number: number
  selected_text: string
  start_offset: number
  end_offset: number
  context_before: string
  context_after: string
  note: string
  marker_type: string
  color: string
  completed: number
  created_at: string
  updated_at: string
  completed_at: string | null
  draft_status: string | null
}

function mapRowToRecord(row: RawForeshadowingRow): ForeshadowingRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    chapterNumber: row.chapter_number,
    selectedText: row.selected_text,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    contextBefore: row.context_before,
    contextAfter: row.context_after,
    note: row.note,
    markerType: row.marker_type,
    color: row.color,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    sourceType: row.draft_status === 'finalized' ? 'manuscript' : 'draft',
  }
}

const SELECT_WITH_DRAFT_STATUS = `
  SELECT 
    f.id, f.draft_id, f.chapter_number, f.selected_text,
    f.start_offset, f.end_offset, f.context_before, f.context_after,
    f.note, f.marker_type, f.color, f.completed,
    f.created_at, f.updated_at, f.completed_at,
    d.status AS draft_status
  FROM foreshadowings f
  LEFT JOIN drafts d ON d.id = f.draft_id
`

export class ForeshadowingRepository {
  /**
   * 列出所有伏笔，支持按完成状态筛选
   */
  static listAll(filter: 'all' | 'pending' | 'completed' = 'all'): ForeshadowingRecord[] {
    const db = getProjectDb()
    if (!db) return []

    let sql = `${SELECT_WITH_DRAFT_STATUS}`
    const params: unknown[] = []

    if (filter === 'pending') {
      sql += ' WHERE f.completed = 0'
    } else if (filter === 'completed') {
      sql += ' WHERE f.completed = 1'
    }

    sql += ' ORDER BY f.chapter_number ASC, f.created_at DESC'

    const rows = db.prepare(sql).all(...params) as RawForeshadowingRow[]
    return rows.map(mapRowToRecord)
  }

  /**
   * 按草稿 ID 获取伏笔列表（正文编辑使用）
   */
  static listByDraft(draftId: number): ForeshadowingRecord[] {
    const db = getProjectDb()
    if (!db) return []

    const sql = `
      ${SELECT_WITH_DRAFT_STATUS}
      WHERE f.draft_id = ?
      ORDER BY f.start_offset ASC, f.created_at ASC
    `
    const rows = db.prepare(sql).all(draftId) as RawForeshadowingRow[]
    return rows.map(mapRowToRecord)
  }

  /**
   * 获取单条伏笔
   */
  static getById(id: string): ForeshadowingRecord | null {
    const db = getProjectDb()
    if (!db) return null

    const sql = `
      ${SELECT_WITH_DRAFT_STATUS}
      WHERE f.id = ?
    `
    const row = db.prepare(sql).get(id) as RawForeshadowingRow | undefined
    return row ? mapRowToRecord(row) : null
  }

  /**
   * 创建伏笔
   */
  static create(params: CreateForeshadowingParams): string {
    const db = getProjectDb()
    if (!db) throw new Error('[ForeshadowingRepository] 数据库未连接')

    if (!params.selectedText || !params.selectedText.trim()) {
      throw new Error('选中文本不能为空')
    }

    // 检查关联草稿是否存在
    const draft = db.prepare('SELECT id, chapter_number FROM drafts WHERE id = ?').get(params.draftId) as { id: number; chapter_number: number } | undefined
    if (!draft) {
      throw new Error(`关联草稿不存在 (draftId: ${params.draftId})`)
    }

    const id = params.id || `fsh-${Date.now()}-${randomUUID().slice(0, 8)}`
    const chapterNumber = params.chapterNumber ?? draft.chapter_number
    const markerType = params.markerType || 'foreshadowing'
    const color = params.color || 'blue'
    const contextBefore = params.contextBefore ?? ''
    const contextAfter = params.contextAfter ?? ''
    const note = params.note ?? ''

    db.prepare(`
      INSERT INTO foreshadowings (
        id, draft_id, chapter_number, selected_text,
        start_offset, end_offset, context_before, context_after,
        note, marker_type, color, completed,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
    `).run(
      id,
      params.draftId,
      chapterNumber,
      params.selectedText,
      params.startOffset,
      params.endOffset,
      contextBefore,
      contextAfter,
      note,
      markerType,
      color,
    )

    return id
  }

  /**
   * 更新伏笔信息（说明、类型、颜色）
   */
  static update(id: string, updates: UpdateForeshadowingParams): void {
    const db = getProjectDb()
    if (!db) throw new Error('[ForeshadowingRepository] 数据库未连接')

    const existing = db.prepare('SELECT id FROM foreshadowings WHERE id = ?').get(id)
    if (!existing) {
      throw new Error(`伏笔不存在 (id: ${id})`)
    }

    const sets: string[] = ["updated_at = datetime('now')"]
    const params: unknown[] = []

    if (updates.note !== undefined) {
      sets.push('note = ?')
      params.push(updates.note)
    }
    if (updates.markerType !== undefined) {
      sets.push('marker_type = ?')
      params.push(updates.markerType)
    }
    if (updates.color !== undefined) {
      sets.push('color = ?')
      params.push(updates.color)
    }

    params.push(id)
    db.prepare(`UPDATE foreshadowings SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  /**
   * 切换伏笔完成状态
   */
  static toggleCompleted(id: string, completed: boolean): void {
    const db = getProjectDb()
    if (!db) throw new Error('[ForeshadowingRepository] 数据库未连接')

    const existing = db.prepare('SELECT id FROM foreshadowings WHERE id = ?').get(id)
    if (!existing) {
      throw new Error(`伏笔不存在 (id: ${id})`)
    }

    if (completed) {
      db.prepare(`
        UPDATE foreshadowings 
        SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(id)
    } else {
      db.prepare(`
        UPDATE foreshadowings 
        SET completed = 0, completed_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(id)
    }
  }

  /**
   * 删除伏笔
   */
  static delete(id: string): void {
    const db = getProjectDb()
    if (!db) throw new Error('[ForeshadowingRepository] 数据库未连接')

    db.prepare('DELETE FROM foreshadowings WHERE id = ?').run(id)
  }

  /**
   * 清除所有伏笔
   */
  static clearAll(): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM foreshadowings').run()
  }
}
