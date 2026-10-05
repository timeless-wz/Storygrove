import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorldMapRepository } from '../electron/repositories/world-map-repository'
import type { ProjectSessionContext } from '../src/shared/ipc-channels'
import type { WorldMapNode } from '../src/shared/world-map'
import { getProjectDb, setCultivationTestDb } from './cultivation-browser-database'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
let folder: string | null = null
let session: ProjectSessionContext | null = null

function dispose(): void {
  getProjectDb()?.close()
  setCultivationTestDb(null)
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = null
  session = null
}

function assertSession(args: unknown[]): void {
  const received = args.at(-1) as ProjectSessionContext | undefined
  if (!session
    || received?.projectId !== session.projectId
    || received.leaseId !== session.leaseId
    || received.projectPath !== session.projectPath
    || args.at(-2) !== session.projectPath) {
    throw new Error('Expired test project session')
  }
}

export async function locationTestIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  if (channel === 'fixture:dispose') { dispose(); return null }
  if (channel === 'fixture:reset') {
    dispose()
    folder = mkdtempSync(join(tmpdir(), 'vela-location-browser-'))
    const db = new Database(join(folder, 'project.db'))
    db.exec(`
      CREATE TABLE world_maps (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_map_id TEXT DEFAULT NULL,
        sort_order REAL NOT NULL DEFAULT 0, image_file_name TEXT DEFAULT NULL,
        image_mime_type TEXT DEFAULT NULL, image_bytes INTEGER DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE world_map_nodes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, marker_icon TEXT DEFAULT NULL,
        description TEXT NOT NULL DEFAULT '', parent_id TEXT DEFAULT NULL, map_id TEXT NOT NULL DEFAULT '',
        x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, source_refs TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE world_map_edges (
        id TEXT PRIMARY KEY, from_node_id TEXT NOT NULL, to_node_id TEXT NOT NULL,
        type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
        map_id TEXT DEFAULT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE world_map_atlas_migration (
        migration_id TEXT PRIMARY KEY, report_json TEXT NOT NULL,
        acknowledged_at TEXT DEFAULT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    const timestamp = '2026-10-01T00:00:00.000Z'
    const insert = db.prepare(`
      INSERT INTO world_map_nodes (
        id, name, type, marker_icon, description, parent_id, map_id, x, y, source_refs, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, '', 0, 0, '[]', ?, ?)
    `)
    insert.run('location-tide-harbor', '潮汐港', 'city', '## 港口旧稿\n\n旧内容。', timestamp, timestamp)
    insert.run('location-salt-market', '盐市', 'landmark', '## 盐市\n\n盐市旧内容。', '2026-10-01T00:00:01.000Z', timestamp)
    setCultivationTestDb(db)
    session = { projectId: 'location-browser', leaseId: randomUUID(), projectPath: folder }
    return session
  }

  assertSession(args)
  if (channel === 'db:map-get-all') return WorldMapRepository.getAll()
  if (channel === 'db:map-node-upsert') {
    try {
      return { success: true, node: WorldMapRepository.upsertNode(args[0] as WorldMapNode) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (channel === 'fixture:readback') return WorldMapRepository.getAll()
  throw new Error(`Unexpected test IPC channel: ${channel}`)
}
