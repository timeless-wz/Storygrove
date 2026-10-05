import type BetterSqlite3 from 'better-sqlite3'

/**
 * AI 检查报告表结构（knowledge-action-outline-sync-contract §6/§9）。
 * 报告是证据不是事实；候选、报告与正式事实严格分离。
 */
export function ensureKnowledgeCheckSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_check_reports (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('info-gap','action-line')),
      scope TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_check_reports_kind ON knowledge_check_reports(kind, scope);
  `)
}
