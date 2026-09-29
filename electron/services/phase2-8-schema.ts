import type BetterSqlite3 from 'better-sqlite3'

/** Cross-phase ledger tables.  They intentionally keep source/version fields
 * explicit so an audit or external-agent result can never become an
 * untraceable blob. */
export function ensurePhase2To8Schema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_events (
      event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      chapter_number INTEGER, story_time TEXT, location TEXT,
      participant_fact_ids_json TEXT NOT NULL DEFAULT '[]',
      preconditions_json TEXT NOT NULL DEFAULT '[]', result_json TEXT NOT NULL DEFAULT '{}',
      source_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK(status IN ('confirmed','candidate','deprecated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_story_events_project_chapter ON story_events(project_id, chapter_number);
    CREATE TABLE IF NOT EXISTS entity_state_snapshots (
      snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, entity_fact_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL, state_json TEXT NOT NULL, source_json TEXT NOT NULL DEFAULT '{}',
      authority_status TEXT NOT NULL DEFAULT 'candidate' CHECK(authority_status IN ('confirmed','candidate','deprecated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(project_id, entity_fact_id, chapter_number)
    );
    CREATE TABLE IF NOT EXISTS character_knowledge (
      knowledge_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, character_fact_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL, fact_id TEXT, statement TEXT NOT NULL, source_json TEXT NOT NULL DEFAULT '{}',
      authority_status TEXT NOT NULL DEFAULT 'candidate' CHECK(authority_status IN ('confirmed','candidate','deprecated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      chunk_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL,
      chapter_number INTEGER, fact_id TEXT, chunk_text TEXT NOT NULL, source_json TEXT NOT NULL DEFAULT '{}',
      version_id TEXT NOT NULL, authority_status TEXT NOT NULL DEFAULT 'candidate',
      stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)), created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_lookup ON knowledge_chunks(project_id, chapter_number, authority_status, stale);
    CREATE TABLE IF NOT EXISTS knowledge_index_queue (
      queue_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_index_queue_pending ON knowledge_index_queue(project_id, status, created_at);
    CREATE TABLE IF NOT EXISTS embedding_records (
      embedding_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
      model_fingerprint TEXT NOT NULL, index_generation INTEGER NOT NULL, vector_dimension INTEGER NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)), created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_runs (
      run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope_json TEXT NOT NULL,
      database_revision TEXT NOT NULL, index_generation TEXT NOT NULL, rule_set TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','completed','failed','paused')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_findings (
      finding_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, project_id TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('error','high','warning','info')),
      rule_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','waived','dismissed')),
      location_json TEXT NOT NULL, evidence_json TEXT NOT NULL, explanation TEXT NOT NULL,
      suggestion TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(run_id) REFERENCES audit_runs(run_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_audit_findings_project ON audit_findings(project_id, status, severity);
    CREATE TABLE IF NOT EXISTS audit_waivers (
      waiver_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, finding_id TEXT NOT NULL,
      reason TEXT NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_name TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{"read":true,"propose":true,"commit":false}',
      expected_revision TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mcp_audit_log (
      call_id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT, tool_name TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '', result_summary TEXT NOT NULL DEFAULT '',
      write_receipt TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_proposals (
      proposal_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
      proposal_type TEXT NOT NULL, payload_json TEXT NOT NULL, base_revision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','committed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT, approved_by TEXT
    );
  `)
  const proposalColumns = db.prepare('PRAGMA table_info(agent_proposals)').all() as Array<{ name: string }>
  if (!proposalColumns.some(column => column.name === 'approved_by')) db.exec('ALTER TABLE agent_proposals ADD COLUMN approved_by TEXT')
  // Durable commit receipts: written by the local MCP server inside the commit
  // transaction; the app only reads them for change awareness and audit.
  if (!proposalColumns.some(column => column.name === 'committed_at')) db.exec("ALTER TABLE agent_proposals ADD COLUMN committed_at TEXT")
  if (!proposalColumns.some(column => column.name === 'commit_receipt_json')) db.exec('ALTER TABLE agent_proposals ADD COLUMN commit_receipt_json TEXT')
}
