import type BetterSqlite3 from 'better-sqlite3'

/**
 * 第二阶段结构化故事资料表。候选表与正式表分离，正式表只能由
 * StoryDomainRepository 的作者确认事务写入；扫描器不应直接操作这些表。
 */
export function ensureStoryDomainSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_fact_candidates (
      candidate_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN (
        'character', 'relationship', 'world_rule', 'place', 'organization',
        'faction', 'item', 'civilization', 'power_system', 'timeline_event',
        'narrative_thread', 'mystery', 'foreshadowing', 'outline'
      )),
      canonical_name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      authority_status TEXT NOT NULL DEFAULT 'candidate' CHECK(authority_status = 'candidate'),
      review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending', 'approved', 'rejected')),
      possible_conflicts_json TEXT NOT NULL DEFAULT '[]',
      source_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      source_fragment_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_heading_path TEXT NOT NULL,
      source_start_line INTEGER NOT NULL CHECK(source_start_line >= 1),
      source_end_line INTEGER NOT NULL CHECK(source_end_line >= source_start_line),
      source_content_hash TEXT NOT NULL,
      actioned_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_story_candidates_project_status
      ON story_fact_candidates(project_id, review_status, entity_type);
    CREATE INDEX IF NOT EXISTS idx_story_candidates_source
      ON story_fact_candidates(project_id, source_id, source_snapshot_id, source_fragment_id);

    CREATE TABLE IF NOT EXISTS story_facts (
      fact_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN (
        'character', 'relationship', 'world_rule', 'place', 'organization',
        'faction', 'item', 'civilization', 'power_system', 'timeline_event',
        'narrative_thread', 'mystery', 'foreshadowing', 'outline'
      )),
      canonical_name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'candidate', 'deprecated')),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      revision INTEGER NOT NULL CHECK(revision >= 1),
      source_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      source_fragment_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_heading_path TEXT NOT NULL,
      source_start_line INTEGER NOT NULL CHECK(source_start_line >= 1),
      source_end_line INTEGER NOT NULL CHECK(source_end_line >= source_start_line),
      source_content_hash TEXT NOT NULL,
      confirmed_at TEXT DEFAULT NULL,
      confirmed_by TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, entity_type, canonical_name)
    );
    CREATE INDEX IF NOT EXISTS idx_story_facts_project_status
      ON story_facts(project_id, status, entity_type);
    CREATE INDEX IF NOT EXISTS idx_story_facts_source
      ON story_facts(project_id, source_id, source_snapshot_id, source_fragment_id);

    CREATE TABLE IF NOT EXISTS story_fact_versions (
      version_id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1),
      summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'candidate', 'deprecated')),
      changed_by TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      source_fragment_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_heading_path TEXT NOT NULL,
      source_start_line INTEGER NOT NULL CHECK(source_start_line >= 1),
      source_end_line INTEGER NOT NULL CHECK(source_end_line >= source_start_line),
      source_content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (fact_id) REFERENCES story_facts(fact_id) ON DELETE CASCADE,
      UNIQUE(fact_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_story_fact_versions_project_fact
      ON story_fact_versions(project_id, fact_id, version);

    CREATE TABLE IF NOT EXISTS story_fact_relations (
      relation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_fact_id TEXT NOT NULL,
      to_fact_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'candidate', 'deprecated')),
      source_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      source_fragment_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_heading_path TEXT NOT NULL,
      source_start_line INTEGER NOT NULL CHECK(source_start_line >= 1),
      source_end_line INTEGER NOT NULL CHECK(source_end_line >= source_start_line),
      source_content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_fact_id) REFERENCES story_facts(fact_id) ON DELETE CASCADE,
      FOREIGN KEY (to_fact_id) REFERENCES story_facts(fact_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_story_fact_relations_project
      ON story_fact_relations(project_id, from_fact_id, to_fact_id);

    CREATE TABLE IF NOT EXISTS story_fact_impacts (
      impact_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL CHECK(chapter_number >= 1),
      impact_type TEXT NOT NULL CHECK(impact_type IN ('appears', 'depends_on', 'contradicts', 'resolves', 'mentions')),
      narrative_line TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (fact_id) REFERENCES story_facts(fact_id) ON DELETE CASCADE,
      UNIQUE(project_id, fact_id, chapter_number, impact_type, narrative_line)
    );
    CREATE INDEX IF NOT EXISTS idx_story_fact_impacts_project_chapter
      ON story_fact_impacts(project_id, chapter_number, impact_type);
  `)
}
