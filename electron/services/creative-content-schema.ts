import type BetterSqlite3 from 'better-sqlite3'

export function ensureCreativeContentSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_legacy_organization (
      source_field TEXT PRIMARY KEY,
      source_hash TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK(disposition IN ('organized','ignored')),
      target_categories_json TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creative_material_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      entry_kind TEXT NOT NULL CHECK(entry_kind IN ('material','retired','issue')),
      material_type TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL CHECK(status IN ('candidate','adopted','rejected','open','resolved','retired')),
      markdown TEXT NOT NULL DEFAULT '',
      source_file_name TEXT NOT NULL DEFAULT '',
      source_heading TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_creative_material_entries_filter
      ON creative_material_entries(entry_kind, status, updated_at DESC);
  `)
}
