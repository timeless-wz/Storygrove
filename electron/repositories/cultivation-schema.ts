import type BetterSqlite3 from 'better-sqlite3'

export function ensureCultivationSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cultivation_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, markdown TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO cultivation_meta(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS cultivation_realms (id TEXT PRIMARY KEY, name TEXT NOT NULL, level_id TEXT NOT NULL UNIQUE, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cultivation_levels (id TEXT PRIMARY KEY, realm_id TEXT NOT NULL REFERENCES cultivation_realms(id), name TEXT, position INTEGER NOT NULL);
  `)
  const metaColumns = db.prepare('PRAGMA table_info(cultivation_meta)').all() as { name: string }[]
  if (!metaColumns.some(column => column.name === 'markdown')) {
    db.exec("ALTER TABLE cultivation_meta ADD COLUMN markdown TEXT NOT NULL DEFAULT ''")
  }
  const columns = db.prepare('PRAGMA table_info(characters)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'cultivation_level_id')) {
    db.exec('ALTER TABLE characters ADD COLUMN cultivation_level_id TEXT REFERENCES cultivation_levels(id) ON DELETE RESTRICT')
  }
}
