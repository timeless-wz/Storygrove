import type BetterSqlite3 from 'better-sqlite3'

/**
 * 正文反向修纲表结构（knowledge-action-outline-sync-contract §5/§9）。
 *
 * outline_sync_candidates — 同步候选（冻结的正文/蓝图版本 + 补丁条目 JSON）。
 * outline_sync_commits    — 提交审计（源版本/目标版本/接受条目），可追溯，不回写。
 * outline_sync_pending    — 「细纲待核对」轻标记（保存正文后由编辑器显式写入）。
 */
export function ensureOutlineSyncSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outline_sync_candidates (
      id TEXT PRIMARY KEY,
      chapter_number INTEGER NOT NULL,
      draft_id INTEGER NOT NULL,
      prose_version INTEGER NOT NULL,
      prose_status TEXT NOT NULL CHECK(prose_status IN ('draft','finalized')),
      finalization_id TEXT,
      prose_hash TEXT NOT NULL,
      unfinished_draft INTEGER NOT NULL DEFAULT 0,
      blueprint_revision INTEGER NOT NULL,
      blueprint_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      no_substantive_change INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','committed','discarded','stale')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outline_sync_candidates_chapter ON outline_sync_candidates(chapter_number, status);

    CREATE TABLE IF NOT EXISTS outline_sync_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      accepted_item_ids TEXT NOT NULL DEFAULT '[]',
      skipped_items TEXT NOT NULL DEFAULT '[]',
      prose_source TEXT NOT NULL DEFAULT '{}',
      blueprint_revision_before INTEGER NOT NULL,
      blueprint_revision_after INTEGER NOT NULL,
      blueprint_hash_after TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outline_sync_commits_chapter ON outline_sync_commits(chapter_number);

    CREATE TABLE IF NOT EXISTS outline_sync_pending (
      chapter_number INTEGER PRIMARY KEY,
      draft_id INTEGER NOT NULL,
      prose_hash TEXT NOT NULL,
      marked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
