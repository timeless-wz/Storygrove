import type BetterSqlite3 from 'better-sqlite3'

/**
 * 信息与揭露（信息差）表结构（knowledge-action-outline-sync-contract §3/§9）。
 *
 * info_entries      — 作者层面的真相与确定状态（不是世界/角色正式资料）。
 * info_truth_versions — 真相版本历史，只追加不改写。
 * knowledge_records — 人物/读者的知情记录；复杂字段（位置/隐瞒/读者段/锚点）存 payload JSON，
 *                     查询列（info_id/subject_kind/character_id/basis/cognition）单独成列。
 */
export function ensureKnowledgeGapSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS info_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      truth TEXT NOT NULL DEFAULT '',
      truth_status TEXT NOT NULL CHECK(truth_status IN ('confirmed','undecided','retired')),
      source_refs TEXT NOT NULL DEFAULT '[]',
      related_thread_plan_ids TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_info_entries_status ON info_entries(truth_status);

    CREATE TABLE IF NOT EXISTS info_truth_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      truth TEXT NOT NULL DEFAULT '',
      truth_status TEXT NOT NULL CHECK(truth_status IN ('confirmed','undecided','retired')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_info_truth_versions_entry ON info_truth_versions(entry_id);

    CREATE TABLE IF NOT EXISTS knowledge_records (
      id TEXT PRIMARY KEY,
      info_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL CHECK(subject_kind IN ('character','reader')),
      character_id TEXT,
      payload TEXT NOT NULL,
      cognition TEXT NOT NULL CHECK(cognition IN ('unknown','heard','suspected','partial','confident')),
      basis TEXT NOT NULL CHECK(basis IN ('plan','prose')),
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_records_info ON knowledge_records(info_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_records_character ON knowledge_records(character_id);
  `)
}
