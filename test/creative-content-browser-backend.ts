import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CreativeContentRepository } from '../electron/repositories/creative-content-repository'
import { ensureCreativeContentSchema } from '../electron/services/creative-content-schema'
import type { CreativeMaterialSaveInput } from '../src/shared/creative-content'
import type { ProjectSessionContext } from '../src/shared/ipc-channels'
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

export async function creativeContentTestIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  if (channel === 'fixture:dispose') { dispose(); return null }
  if (channel === 'fixture:reset') {
    dispose()
    folder = mkdtempSync(join(tmpdir(), 'vela-creative-content-browser-'))
    const db = new Database(join(folder, 'project.db'))
    db.exec(`CREATE TABLE project_core (
      id TEXT PRIMARY KEY,
      core_outline TEXT NOT NULL DEFAULT '', world_setting TEXT NOT NULL DEFAULT '',
      golden_finger TEXT NOT NULL DEFAULT '', protagonist_profile TEXT NOT NULL DEFAULT '',
      global_guidance TEXT NOT NULL DEFAULT '', writing_style TEXT NOT NULL DEFAULT ''
    ); INSERT INTO project_core(id) VALUES('main');`)
    ensureCreativeContentSchema(db)
    setCultivationTestDb(db)
    session = { projectId: 'creative-content-browser', leaseId: randomUUID(), projectPath: folder }
    return session
  }

  const expectedSession = args.at(-1) as ProjectSessionContext
  if (!session
    || expectedSession?.leaseId !== session.leaseId
    || expectedSession.projectPath !== session.projectPath
    || expectedSession.projectId !== session.projectId
    || args.at(-2) !== session.projectPath) {
    throw new Error('Expired test project session')
  }
  if (channel === 'db:creative-legacy-list') return []
  if (channel === 'db:creative-material-list') {
    return CreativeContentRepository.listMaterials(args[0] as { entryKind?: 'material' | 'retired' | 'issue'; status?: never } | undefined)
  }
  if (channel === 'db:creative-material-save') {
    try {
      return { success: true, entry: CreativeContentRepository.saveMaterial(args[0] as CreativeMaterialSaveInput) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  throw new Error(`Unexpected test IPC channel: ${channel}`)
}
