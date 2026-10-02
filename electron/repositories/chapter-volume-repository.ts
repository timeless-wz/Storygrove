import { getProjectDb } from '../database'
import { BlueprintRepository } from './blueprint-repository'

/** 正文章节独立归卷，不创建或改写章节蓝图。所有草稿版本与定稿共享章节归属。 */
export class ChapterVolumeRepository {
  private static database() {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未连接')
    db.exec(`CREATE TABLE IF NOT EXISTS chapter_volume_assignments (
      chapter_number INTEGER PRIMARY KEY,
      volume_id TEXT DEFAULT NULL
    ); CREATE TABLE IF NOT EXISTS prose_deleted_volumes (volume_id TEXT PRIMARY KEY)`)
    return db
  }

  static list(): Array<{ chapterNumber: number; volumeId: string | null }> {
    return (this.database().prepare('SELECT chapter_number, volume_id FROM chapter_volume_assignments').all() as
      Array<{ chapter_number: number; volume_id: string | null }>).map(row => ({
      chapterNumber: row.chapter_number, volumeId: row.volume_id,
    }))
  }

  static prune() {
    this.database().exec('DELETE FROM chapter_volume_assignments WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE drafts.chapter_number = chapter_volume_assignments.chapter_number)')
  }

  static volumes() {
    const db = this.database()
    const removed = new Set((db.prepare('SELECT volume_id FROM prose_deleted_volumes').all() as Array<{ volume_id: string }>).map(row => row.volume_id))
    return BlueprintRepository.getVolumes().filter(volume => !removed.has(volume.id))
  }

  /** 删除正文目录中的卷，保留章节、稿本和规划事实，并明确移入未归卷。 */
  static deleteVolume(volumeId: string) {
    const db = this.database()
    if (!this.volumes().some(volume => volume.id === volumeId)) throw new Error('卷不存在，请刷新目录')
    db.transaction(() => {
      const chapters = db.prepare(`SELECT DISTINCT drafts.chapter_number FROM drafts
        LEFT JOIN chapter_volume_assignments assignment ON assignment.chapter_number = drafts.chapter_number
        LEFT JOIN blueprints ON blueprints.chapter_number = drafts.blueprint_chapter_number
        WHERE assignment.volume_id = ? OR (assignment.chapter_number IS NULL AND COALESCE(blueprints.volume_id, 'volume-1') = ? AND drafts.blueprint_chapter_number IS NOT NULL)`)
        .all(volumeId, volumeId) as Array<{ chapter_number: number }>
      for (const chapter of chapters) db.prepare(`INSERT INTO chapter_volume_assignments (chapter_number, volume_id) VALUES (?, NULL)
        ON CONFLICT(chapter_number) DO UPDATE SET volume_id = NULL`).run(chapter.chapter_number)
      db.prepare('INSERT INTO prose_deleted_volumes (volume_id) VALUES (?)').run(volumeId)
    })()
  }

  static set(chapterNumber: number, volumeId: string | null) {
    const db = this.database()
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) throw new Error('章节号无效')
    if (!db.prepare('SELECT 1 FROM drafts WHERE chapter_number = ? AND status != ?').get(chapterNumber, 'archived')) {
      throw new Error('正文章节不存在')
    }
    if (volumeId !== null && (typeof volumeId !== 'string'
      || !db.prepare('SELECT 1 FROM blueprint_volumes WHERE id = ?').get(volumeId)
      || db.prepare('SELECT 1 FROM prose_deleted_volumes WHERE volume_id = ?').get(volumeId))) {
      throw new Error('卷不存在，请刷新目录')
    }
    db.prepare(`INSERT INTO chapter_volume_assignments (chapter_number, volume_id) VALUES (?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET volume_id = excluded.volume_id`).run(chapterNumber, volumeId)
  }
}
