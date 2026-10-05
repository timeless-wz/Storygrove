/**
 * 伏笔标记 ↔ 章节脉络计划 关系仓库（knowledge-action-outline-sync-contract §7）。
 * 允许一条标记关联多个计划、一个计划关联多条标记；重复关联幂等返回已有行。
 */

import { getProjectDb } from '../database'
import { ensureThreadMarkerLinkSchema } from '../services/thread-marker-link-schema'
import { randomCanvasUuid } from '../../src/shared/canvas-ids'
import { THREAD_MARKER_LINK_ID_PREFIX, type ThreadMarkerLink, type ThreadMarkerLinkInput } from '../../src/shared/thread-marker-link'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

function requireDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

interface LinkRow {
  id: string
  thread_plan_id: number
  foreshadowing_id: string
  kind: string
  note: string
  created_at: string
}

function rowToLink(row: LinkRow): ThreadMarkerLink {
  return {
    id: row.id,
    threadPlanId: row.thread_plan_id,
    foreshadowingId: row.foreshadowing_id,
    kind: row.kind as ThreadMarkerLink['kind'],
    note: row.note,
    createdAt: row.created_at,
  }
}

export class ThreadMarkerLinkRepository {
  static ensureSchema(db: ProjectDatabase): void {
    ensureThreadMarkerLinkSchema(db)
  }

  static listLinks(query: { threadPlanId?: number; foreshadowingId?: string } = {}): ThreadMarkerLink[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM thread_marker_links ORDER BY created_at DESC, id').all() as LinkRow[]
    let links = rows.map(rowToLink)
    if (query.threadPlanId !== undefined) links = links.filter(link => link.threadPlanId === query.threadPlanId)
    if (query.foreshadowingId) links = links.filter(link => link.foreshadowingId === query.foreshadowingId)
    return links
  }

  static link(input: ThreadMarkerLinkInput): { success: boolean; link?: ThreadMarkerLink; error?: string } {
    if (!Number.isSafeInteger(input.threadPlanId)) return { success: false, error: '脉络计划 ID 无效' }
    if (typeof input.foreshadowingId !== 'string' || !input.foreshadowingId.trim()) {
      return { success: false, error: '伏笔标记 ID 无效' }
    }
    if (input.kind !== 'evidence' && input.kind !== 'reference') {
      return { success: false, error: `未知的关系类型：${String(input.kind)}` }
    }
    const db = requireDb()
    const existing = db.prepare('SELECT * FROM thread_marker_links WHERE thread_plan_id = ? AND foreshadowing_id = ? AND kind = ?')
      .get(input.threadPlanId, input.foreshadowingId, input.kind) as LinkRow | undefined
    if (existing) return { success: true, link: rowToLink(existing) }
    const id = `${THREAD_MARKER_LINK_ID_PREFIX}-${randomCanvasUuid()}`
    db.prepare('INSERT INTO thread_marker_links (id, thread_plan_id, foreshadowing_id, kind, note) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.threadPlanId, input.foreshadowingId, input.kind, input.note ?? '')
    const row = db.prepare('SELECT * FROM thread_marker_links WHERE id = ?').get(id) as LinkRow
    return { success: true, link: rowToLink(row) }
  }

  static unlink(id: string): { success: boolean; error?: string } {
    const db = requireDb()
    db.prepare('DELETE FROM thread_marker_links WHERE id = ?').run(id)
    return { success: true }
  }
}
