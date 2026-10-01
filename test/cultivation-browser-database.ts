/** Test-only database boundary used by Vitest's Node-side browser commands. */
import type BetterSqlite3 from 'better-sqlite3'
let db: BetterSqlite3.Database | null = null
export function getProjectDb() { return db }
export function setCultivationTestDb(value: BetterSqlite3.Database | null) { db = value }
