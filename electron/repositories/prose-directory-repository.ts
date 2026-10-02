import { invalidateContinuityProjectionFrom } from './summary-repository'
import { getProjectDb } from '../database'
import { ChapterVolumeRepository } from './chapter-volume-repository'
import type { ProseDirectoryAction, ProseOrderEntry, ProseTrashEntry } from '../../src/shared/prose-directory'

interface TrashRow { id: number; kind: 'draft' | 'volume'; target: string; name: string; previous_status: string; payload: string; deleted_at: string }
/** Non-destructive directory operations. Existing chapter numbers remain stable foreign keys. */
export class ProseDirectoryRepository {
  private static db() {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未连接')
    db.exec(`CREATE TABLE IF NOT EXISTS prose_chapter_order (chapter_number INTEGER PRIMARY KEY, position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS prose_trash (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
        target TEXT NOT NULL, name TEXT NOT NULL, previous_status TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}',
        deleted_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(kind, target));`)
    return db
  }

  static order(): ProseOrderEntry[] {
    const db = this.db()
    const existing = db.prepare('SELECT chapter_number, position FROM prose_chapter_order ORDER BY position, chapter_number').all() as Array<{ chapter_number: number; position: number }>
    const missing = db.prepare('SELECT DISTINCT chapter_number FROM drafts WHERE NOT EXISTS (SELECT 1 FROM prose_chapter_order o WHERE o.chapter_number = drafts.chapter_number) ORDER BY chapter_number').all() as Array<{ chapter_number: number }>
    let last = Math.max(0, ...existing.map(row => row.position))
    for (const row of missing) db.prepare('INSERT INTO prose_chapter_order VALUES (?, ?)').run(row.chapter_number, ++last)
    const assignments = new Map(ChapterVolumeRepository.list().map(row => [row.chapterNumber, row.volumeId]))
    const volumes = ChapterVolumeRepository.volumes()
    const ranks = new Map(volumes.map(volume => [volume.id, volume.sortOrder]))
    const legacyVolumes = new Map((db.prepare(`SELECT DISTINCT d.chapter_number, b.volume_id FROM drafts d JOIN blueprints b ON b.chapter_number = d.blueprint_chapter_number`).all() as Array<{ chapter_number: number; volume_id: string | null }>).map(row => [row.chapter_number, row.volume_id || 'volume-1']))
    const rank = (n: number) => ranks.get((assignments.has(n) ? assignments.get(n) : legacyVolumes.get(n)) ?? '') ?? Number.MAX_SAFE_INTEGER
    const finalized = new Set((db.prepare("SELECT DISTINCT chapter_number FROM drafts WHERE status = 'finalized'").all() as Array<{ chapter_number: number }>).map(row => row.chapter_number))
    const rows = [...existing, ...missing.map((row, index) => ({ ...row, position: last - missing.length + index + 1 }))]
      .sort((a, b) => rank(a.chapter_number) - rank(b.chapter_number) || a.position - b.position || a.chapter_number - b.chapter_number)
    let number = 0
    return rows.map(row => ({ chapterNumber: row.chapter_number, position: row.position, displayNumber: finalized.has(row.chapter_number) ? ++number : null }))
  }

  static move(chapterNumber: number, relativeTo: number, side: 'before' | 'after') {
    const db = this.db()
    if (!Number.isSafeInteger(chapterNumber) || !Number.isSafeInteger(relativeTo) || !['before', 'after'].includes(side)) throw new Error('章节位置无效')
    const rows = this.order().sort((a, b) => a.position - b.position).map(row => row.chapterNumber)
    if (!rows.includes(chapterNumber) || !db.prepare("SELECT 1 FROM drafts WHERE chapter_number = ? AND status != 'archived'").get(relativeTo)) throw new Error('目标章节不存在，请刷新目录')
    if (chapterNumber === relativeTo) return
    const next = rows.filter(n => n !== chapterNumber)
    next.splice(next.indexOf(relativeTo) + (side === 'after' ? 1 : 0), 0, chapterNumber)
    next.forEach((n, index) => db.prepare('UPDATE prose_chapter_order SET position = ? WHERE chapter_number = ?').run(index + 1, n))
  }

  static trash(): ProseTrashEntry[] {
    return (this.db().prepare('SELECT * FROM prose_trash ORDER BY id DESC').all() as TrashRow[]).map(row => ({ id: row.id, kind: row.kind, name: row.name, deletedAt: row.deleted_at, ...(row.kind === 'draft' ? { draftId: Number(row.target) } : { volumeId: row.target }) }))
  }

  static act(action: ProseDirectoryAction): number | undefined {
    const db = this.db()
    return db.transaction(() => {
      if (['relocate', 'move', 'trash-draft', 'trash-volume', 'restore'].includes(action.type)) invalidateContinuityProjectionFrom(db, 1)
      if (action.type === 'relocate') {
        ChapterVolumeRepository.set(action.chapterNumber, action.volumeId)
        if (action.relativeTo !== undefined) this.move(action.chapterNumber, action.relativeTo, action.side ?? 'before')
        return
      }
      if (action.type === 'move') { this.move(action.chapterNumber, action.relativeTo, action.side); return }
      if (action.type === 'rename-draft' || action.type === 'rename-volume') {
        if (typeof action.name !== 'string' || !action.name.trim() || action.name.length > 500) throw new Error('名称不能为空且不能超过 500 字')
        if (action.type === 'rename-draft') {
          const row = db.prepare("SELECT status FROM drafts WHERE id = ? AND status != 'archived'").get(action.draftId)
          if (!row) throw new Error('草稿不存在')
          db.prepare("UPDATE drafts SET imported_title = ?, updated_at = datetime('now') WHERE id = ?").run(action.name.trim(), action.draftId)
          db.prepare('UPDATE finalization_outbox SET chapter_title = ? WHERE draft_id = ?').run(action.name.trim(), action.draftId)
        } else {
          if (!ChapterVolumeRepository.volumes().some(volume => volume.id === action.volumeId)) throw new Error('卷不存在')
          db.prepare('UPDATE blueprint_volumes SET name = ? WHERE id = ?').run(action.name.trim(), action.volumeId)
        }
        return
      }
      if (action.type === 'trash-draft') {
        const row = db.prepare("SELECT d.id, d.chapter_number, COALESCE(CASE WHEN d.status = 'finalized' THEN f.chapter_title END, NULLIF(d.imported_title, ''), b.title) AS imported_title, d.version, d.status FROM drafts d LEFT JOIN finalization_outbox f ON f.draft_id = d.id LEFT JOIN blueprints b ON b.chapter_number = d.blueprint_chapter_number WHERE d.id = ? AND d.status != 'archived'").get(action.draftId) as { chapter_number: number; imported_title: string | null; version: number; status: string } | undefined
        if (!row) throw new Error('稿件不存在或已在回收站')
        const number = this.order().find(item => item.chapterNumber === row.chapter_number)?.displayNumber ?? row.chapter_number
        const inserted = db.prepare('INSERT INTO prose_trash (kind, target, name, previous_status) VALUES (?, ?, ?, ?)').run('draft', String(action.draftId), `第${number}章 ${row.imported_title || ''} v${row.version}`, row.status)
        db.prepare("UPDATE drafts SET status = 'archived' WHERE id = ?").run(action.draftId)
        return Number(inserted.lastInsertRowid)
      }
      if (action.type === 'trash-volume') {
        const volume = ChapterVolumeRepository.volumes().find(volume => volume.id === action.volumeId)
        if (!volume) throw new Error('卷不存在')
        const before = ChapterVolumeRepository.list()
        ChapterVolumeRepository.deleteVolume(action.volumeId)
        const affected = ChapterVolumeRepository.list().filter(row => row.volumeId === null && (!before.some(old => old.chapterNumber === row.chapterNumber) || before.some(old => old.chapterNumber === row.chapterNumber && old.volumeId === action.volumeId)))
        return Number(db.prepare('INSERT INTO prose_trash (kind, target, name, payload) VALUES (?, ?, ?, ?)').run('volume', action.volumeId, volume.name, JSON.stringify(affected.map(row => row.chapterNumber))).lastInsertRowid)
      }
      const row = db.prepare('SELECT * FROM prose_trash WHERE id = ?').get(action.trashId) as TrashRow | undefined
      if (!row) throw new Error('回收站条目不存在，请刷新')
      if (action.type === 'restore') {
        if (row.kind === 'draft') {
          const draft = db.prepare('SELECT chapter_number FROM drafts WHERE id = ?').get(Number(row.target)) as { chapter_number: number } | undefined
          if (!draft) throw new Error('稿件数据不存在')
          const conflict = row.previous_status === 'finalized' && db.prepare("SELECT 1 FROM drafts WHERE chapter_number = ? AND status = 'finalized'").get(draft.chapter_number)
          // A newer current manuscript must never be overwritten by restoration.
          db.prepare('UPDATE drafts SET status = ? WHERE id = ?').run(conflict ? 'draft' : row.previous_status, Number(row.target))
        } else {
          db.prepare('DELETE FROM prose_deleted_volumes WHERE volume_id = ?').run(row.target)
          const chapters = JSON.parse(row.payload) as number[]
          for (const n of chapters) db.prepare('UPDATE chapter_volume_assignments SET volume_id = ? WHERE chapter_number = ? AND volume_id IS NULL').run(row.target, n)
        }
      } else if (action.type === 'purge') {
        if (row.kind === 'draft') {
          // Keep shared contents and all planning facts; cascade only the selected draft's records.
          db.prepare('DELETE FROM drafts WHERE id = ? AND status = ?').run(Number(row.target), 'archived')
        }
      } else throw new Error('目录操作无效')
      db.prepare('DELETE FROM prose_trash WHERE id = ?').run(row.id)
      return
    })()
  }
}
