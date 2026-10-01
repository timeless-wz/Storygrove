import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setCultivationTestDb, getProjectDb } from './cultivation-browser-database'
import { CultivationRepository } from '../electron/repositories/cultivation-repository'
import { CharacterRosterRepository } from '../electron/repositories/character-roster-repository'
import { CharacterRelationshipRepository } from '../electron/repositories/character-relationship-repository'
import type { CharacterRosterCommitRequest } from '../src/shared/character-roster'
import type { CultivationSaveRequest } from '../src/shared/cultivation'
import type { ProjectSessionContext } from '../src/shared/ipc-channels'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
let folder: string | null = null
let session: ProjectSessionContext | null = null
let failSave = false
function dispose() {
  getProjectDb()?.close(); setCultivationTestDb(null)
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = null; session = null
}
export async function cultivationTestIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  if (channel === 'fixture:dispose') { dispose(); return null }
  if (channel === 'fixture:reset') {
    dispose()
    folder = mkdtempSync(join(tmpdir(), 'vela-cultivation-browser-'))
    const db = new Database(join(folder, 'project.db'))
    db.pragma('foreign_keys=ON')
    db.exec(`CREATE TABLE project_core(id TEXT PRIMARY KEY, writing_language TEXT DEFAULT 'zh-CN', characters_arch TEXT DEFAULT ''); INSERT INTO project_core(id) VALUES('main');
      CREATE TABLE characters(name TEXT PRIMARY KEY, role TEXT, gender TEXT, age TEXT, appearance TEXT, personality TEXT, background TEXT, abilities TEXT, motivation TEXT, relationships TEXT, arc TEXT, notes TEXT, cs_location TEXT, cs_power_level TEXT, cs_physical_state TEXT, cs_mental_state TEXT, cs_key_items TEXT, cs_recent_events TEXT, cs_updated_at_chapter INTEGER, updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE blueprints(chapter_number INTEGER PRIMARY KEY, characters TEXT DEFAULT '[]', updated_at TEXT);
      CREATE TABLE drafts(id INTEGER PRIMARY KEY, chapter_number INTEGER, status TEXT);
      CREATE TABLE finalization_outbox(finalization_id TEXT PRIMARY KEY, draft_id INTEGER, chapter_number INTEGER, content_hash TEXT);`)
    setCultivationTestDb(db)
    session = { projectId: 'cultivation-browser', leaseId: randomUUID(), projectPath: folder }
    failSave = false
    CharacterRosterRepository.commit({ operationId: randomUUID(), expectedRevision: 0, schemaVersion: 1, entries: [{
      name: '沈砺', role: 'protagonist', gender: '', age: '', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '',
      currentState: { location: '', powerLevel: '旧修为：筑基中期', physicalState: '', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 0 },
    }] })
    return session
  }
  if (channel === 'fixture:reopen') {
    if (!folder || !session) throw new Error('No test project')
    getProjectDb()?.close()
    const db = new Database(join(folder, 'project.db')); db.pragma('foreign_keys=ON'); setCultivationTestDb(db)
    session = { ...session, leaseId: randomUUID() }
    return session
  }
  if (channel === 'fixture:fail-save') { failSave = Boolean(args[0]); return null }
  const expectedSession = args.at(-1) as ProjectSessionContext
  if (!session || expectedSession?.leaseId !== session.leaseId || expectedSession.projectPath !== session.projectPath || expectedSession.projectId !== session.projectId || args.at(-2) !== session.projectPath) throw new Error('Expired test project session')
  if (channel === 'db:cultivation-read') return CultivationRepository.read()
  if (channel === 'db:character-roster-read') return CharacterRosterRepository.read()
  if (channel === 'db:character-identities-ensure') return CharacterRelationshipRepository.ensureIdentities(args[0] as string[])
  if (channel === 'db:character-relationships-get-all') return CharacterRelationshipRepository.getAll()
  if (channel === 'db:character-graph-positions-get') return CharacterRelationshipRepository.getGraphPositions()
  if (channel === 'db:cultivation-save' || channel === 'db:character-roster-commit') {
    if (failSave) return { success: false, error: 'Forced test save failure' }
    try {
      return channel === 'db:cultivation-save'
        ? { success: true, result: CultivationRepository.save(args[0] as CultivationSaveRequest) }
        : { success: true, receipt: CharacterRosterRepository.commit(args[0] as CharacterRosterCommitRequest) }
    } catch (error) { return { success: false, error: String(error) } }
  }
  throw new Error(`Unexpected test IPC channel: ${channel}`)
}
