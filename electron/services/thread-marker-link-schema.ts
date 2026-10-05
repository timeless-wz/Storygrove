import type BetterSqlite3 from 'better-sqlite3'

/**
 * 伏笔标记 ↔ 章节脉络计划 关系表结构（knowledge-action-outline-sync-contract §7/§9）。
 */
export function ensureThreadMarkerLinkSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_marker_links (
      id TEXT PRIMARY KEY,
      thread_plan_id INTEGER NOT NULL,
      foreshadowing_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'evidence' CHECK(kind IN ('evidence','reference')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_thread_marker_links_plan ON thread_marker_links(thread_plan_id);
    CREATE INDEX IF NOT EXISTS idx_thread_marker_links_marker ON thread_marker_links(foreshadowing_id);
  `)
}
