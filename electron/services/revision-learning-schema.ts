import type BetterSqlite3 from 'better-sqlite3'

/** Durable author review, source snapshots, individual model attempts, and publish recovery receipts. */
export function ensureRevisionLearningSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS revision_learning_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      input_revision INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      before_snapshot_json TEXT NOT NULL,
      after_snapshot_json TEXT,
      changes_json TEXT NOT NULL,
      overall_reason TEXT NOT NULL DEFAULT '',
      review_json TEXT,
      active_attempt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revision_learning_records_updated
      ON revision_learning_records(updated_at DESC, id);

    CREATE TABLE IF NOT EXISTS revision_learning_attempts (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      input_revision INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
      error_summary TEXT,
      result_json TEXT,
      generation_receipt_json TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(record_id) REFERENCES revision_learning_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_revision_learning_attempts_record
      ON revision_learning_attempts(record_id, created_at DESC, id);

    CREATE TABLE IF NOT EXISTS revision_learning_publish_ops (
      idempotency_key TEXT PRIMARY KEY,
      record_id TEXT NOT NULL,
      skill_id TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      review_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('prepared','published')),
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(record_id) REFERENCES revision_learning_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_revision_learning_publish_record
      ON revision_learning_publish_ops(record_id, created_at DESC);

    UPDATE revision_learning_attempts
      SET status = 'interrupted', error_summary = '应用关闭时分析尚未完成', completed_at = datetime('now')
      WHERE status = 'running';
    UPDATE revision_learning_records SET active_attempt_id = NULL WHERE active_attempt_id IS NOT NULL;
  `)
}
