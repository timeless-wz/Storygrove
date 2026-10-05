import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CreativeContentRepository } from '../electron/repositories/creative-content-repository'
import { ProjectCoreRepository } from '../electron/repositories/project-core-repository'
import { ensureCreativeContentSchema } from '../electron/services/creative-content-schema'
import type { CreativeMaterialSaveInput } from '../src/shared/creative-content'
import type { ProjectSessionContext } from '../src/shared/ipc-channels'
import { getProjectDb, setCultivationTestDb } from './cultivation-browser-database'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
let folder: string | null = null
let session: ProjectSessionContext | null = null
let rejectNextMaterialSaveWith: string | null = null

function dispose(): void {
  getProjectDb()?.close()
  setCultivationTestDb(null)
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = null
  session = null
  rejectNextMaterialSaveWith = null
}

export async function creativeContentTestIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  if (channel === 'fixture:dispose') { dispose(); return null }
  if (channel === 'fixture:reject-next-material-save') {
    rejectNextMaterialSaveWith = '磁盘已满'
    return null
  }
  if (channel === 'fixture:reset') {
    dispose()
    folder = mkdtempSync(join(tmpdir(), 'vela-creative-content-browser-'))
    const db = new Database(join(folder, 'project.db'))
    db.exec(`CREATE TABLE project_core (
      id TEXT PRIMARY KEY DEFAULT 'main',
      project_name TEXT NOT NULL DEFAULT '',
      genre TEXT DEFAULT '', sub_genre TEXT DEFAULT '', target_audience TEXT DEFAULT '',
      total_chapters INTEGER DEFAULT 100, words_per_chapter INTEGER DEFAULT 3000,
      writing_language TEXT NOT NULL DEFAULT 'zh-CN', creative_strategy TEXT NOT NULL DEFAULT 'auto',
      narrative_thread_dormant_threshold INTEGER NOT NULL DEFAULT 3,
      plot_structure TEXT DEFAULT 'three_act', narrative_pov TEXT DEFAULT 'third_limited', writing_style TEXT DEFAULT '',
      creative_direction_markdown TEXT NOT NULL DEFAULT '', writing_rules_markdown TEXT NOT NULL DEFAULT '',
      reference_works TEXT DEFAULT '', global_guidance TEXT DEFAULT '', golden_finger TEXT DEFAULT '',
      core_outline TEXT DEFAULT '', world_setting TEXT DEFAULT '', protagonist_profile TEXT DEFAULT '',
      premise TEXT DEFAULT '', worldbuilding TEXT DEFAULT '', characters_arch TEXT DEFAULT '',
      synopsis TEXT DEFAULT '', character_states TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );`)
    setCultivationTestDb(db)
    ProjectCoreRepository.init('Isolated creative content browser fixture')
    ensureCreativeContentSchema(db)
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
  if (channel === 'db:project-core-get') return ProjectCoreRepository.get()
  if (channel === 'db:project-core-update') {
    try {
      return ProjectCoreRepository.update(args[0] as Parameters<typeof ProjectCoreRepository.update>[0])
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (channel === 'db:creative-legacy-list') {
    const core = ProjectCoreRepository.get()
    return core ? CreativeContentRepository.listLegacySources(core) : []
  }
  if (channel === 'db:creative-legacy-organize') {
    try {
      CreativeContentRepository.organizeLegacySource(args[0] as Parameters<typeof CreativeContentRepository.organizeLegacySource>[0])
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (channel === 'db:creative-material-list') {
    return CreativeContentRepository.listMaterials(args[0] as { entryKind?: 'material' | 'retired' | 'issue'; status?: never } | undefined)
  }
  if (channel === 'db:creative-material-save') {
    if (rejectNextMaterialSaveWith) {
      const error = rejectNextMaterialSaveWith
      rejectNextMaterialSaveWith = null
      return { success: false, error }
    }
    try {
      return { success: true, entry: CreativeContentRepository.saveMaterial(args[0] as CreativeMaterialSaveInput) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  throw new Error(`Unexpected test IPC channel: ${channel}`)
}
