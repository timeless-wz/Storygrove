import type BetterSqlite3 from 'better-sqlite3'

/**
 * 人物行动线表结构（knowledge-action-outline-sync-contract §4/§9）。
 *
 * character_actions — 人物自己的目标/资源/限制/行动/结果；事件只存稳定引用（event_id），
 * 事件标题/时间/结果永远从 story_timeline_events 读取，不在本表复制成可编辑第二份。
 * 复杂字段（位置/锚点/关联章）存 payload JSON。
 */
export function ensureCharacterActionSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_actions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      event_id TEXT,
      planned_note TEXT,
      visibility TEXT NOT NULL DEFAULT 'on-stage' CHECK(visibility IN ('on-stage','off-stage')),
      status TEXT NOT NULL DEFAULT 'plan' CHECK(status IN ('plan','prose')),
      payload TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_character_actions_character ON character_actions(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_actions_event ON character_actions(event_id);
  `)
}
