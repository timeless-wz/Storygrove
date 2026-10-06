import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { ProjectCoreRepository } from '../../repositories/project-core-repository'
import type { ProjectSessionContext } from '../../../src/shared/ipc-channels'
import type { CultivationSaveRequest } from '../../../src/shared/cultivation'
import type { CharacterRosterCommitRequest, CharacterRosterSnapshot } from '../../../src/shared/character-roster'

type Handler = (event: unknown, ...args: unknown[]) => unknown
type PreloadApi = { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
const bridge = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), api: null as PreloadApi | null }))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { bridge.handlers.set(channel, handler) } },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = bridge.handlers.get(channel)
      if (!handler) throw new Error(`No main-process handler for ${channel}`)
      return handler({ sender: { id: 1 } }, ...args)
    },
  },
  contextBridge: { exposeInMainWorld: (_key: string, api: PreloadApi) => { bridge.api = api } },
  webFrame: { setZoomLevel: () => {}, setZoomFactor: () => {}, getZoomLevel: () => 0 },
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false },
}))

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
let temporaryRoot = ''
let initProjectDatabase: typeof import('../../database').initProjectDatabase
let closeProjectDatabase: typeof import('../../database').closeProjectDatabase
let projectAccess: typeof import('../../services/project-access').projectAccess
let currentSession: ProjectSessionContext | null = null

function api(): PreloadApi {
  if (!bridge.api) throw new Error('Preload API was not exposed')
  return bridge.api
}

function beginSession(root: string, projectId: string): ProjectSessionContext {
  const lease = projectAccess.beginSession({ kind: 'manifest', projectId, rootPath: root })
  return { projectId: lease.projectId, leaseId: lease.leaseId, projectPath: root }
}

function invoke(channel: string, ...args: unknown[]) {
  if (!currentSession) throw new Error('No active fixture project session')
  return api().invoke(channel, ...args, currentSession.projectPath, currentSession)
}

function character(name: string, powerLevel: string) {
  return {
    name, role: 'protagonist' as const, gender: '', age: '', appearance: '', personality: '', background: '',
    abilities: '', motivation: '', relationships: [], arc: '', notes: '',
    currentState: { location: '', powerLevel, physicalState: '', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 0 },
  }
}

async function commitCharacter(name: string, powerLevel: string, cultivationLevelId?: string) {
  const roster = await invoke('db:character-roster-read') as CharacterRosterSnapshot
  const entry = { ...character(name, powerLevel), ...(cultivationLevelId ? { cultivationLevelId } : {}) }
  const request: CharacterRosterCommitRequest = {
    operationId: randomUUID(), expectedRevision: roster.revision, schemaVersion: 1, intent: 'manual_edit',
    expectedLegacyMarkdown: roster.legacyMarkdown ?? '', entries: [...roster.entries, entry],
  }
  return invoke('db:character-roster-commit', request)
}

beforeAll(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-cultivation-main-ipc-'))
  ;({ initProjectDatabase, closeProjectDatabase } = await import('../../database'))
  ;({ projectAccess } = await import('../../services/project-access'))
  const { registerDatabaseController } = await import('../db-controller')
  registerDatabaseController()
  await import('../../preload')
})

beforeEach(() => {
  closeProjectDatabase()
  projectAccess.invalidateCurrentSession()
  currentSession = null
})

afterAll(() => {
  closeProjectDatabase?.()
  projectAccess?.invalidateCurrentSession()
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
})

it('runs the production preload and database controller against initialized, migrated, reopened, and switched temp projects', async () => {
  const newRoot = path.join(temporaryRoot, 'new-project')
  fs.mkdirSync(newRoot)
  initProjectDatabase(newRoot)
  ProjectCoreRepository.init('New temp project')
  const projectId = randomUUID()
  currentSession = beginSession(newRoot, projectId)

  const emptyRoster = await invoke('db:character-roster-read') as CharacterRosterSnapshot
  const request: CultivationSaveRequest = {
    expectedRevision: 0, expectedRosterRevision: emptyRoster.revision, resolutions: {},
    realms: [{ id: 'qi', name: '炼气', levelId: 'qi-base', stages: [{ id: 'qi-1', name: '一层' }, { id: 'qi-2', name: '二层' }] }],
  }
  const saved = await invoke('db:cultivation-save', request) as { success: boolean; result?: { roster: CharacterRosterSnapshot } }
  expect(saved.success, JSON.stringify(saved)).toBe(true)
  await commitCharacter('沈砺', '旧文字不改写', 'qi-2')
  const boundRoster = await invoke('db:character-roster-read') as CharacterRosterSnapshot
  expect(boundRoster.entries[0]).toMatchObject({ name: '沈砺', cultivationLevelId: 'qi-2', currentState: { powerLevel: '旧文字不改写' } })
  const firstLease = currentSession

  await expect(invoke('db:cultivation-delete')).rejects.toThrow('Unknown cultivation IPC channel')
  expect((await invoke('db:cultivation-read') as { realms: Array<{ name: string }> }).realms[0]?.name).toBe('炼气')
  expect((await invoke('db:cultivation-save', { ...request, expectedRevision: 1 }) as { success: boolean }).success).toBe(false)

  await expect(invoke('db:close')).resolves.toMatchObject({ success: true })
  initProjectDatabase(newRoot)
  currentSession = beginSession(newRoot, projectId)
  const reopenedSystem = await invoke('db:cultivation-read') as { revision: number; realms: Array<{ name: string; stages: Array<{ id: string }> }> }
  const reopenedRoster = await invoke('db:character-roster-read') as CharacterRosterSnapshot
  expect(reopenedSystem.realms[0]?.name).toBe('炼气')
  expect(reopenedRoster.entries[0]).toMatchObject({ cultivationLevelId: 'qi-2', currentState: { powerLevel: '旧文字不改写' } })
  expect(reopenedSystem.realms[0]?.stages[1]?.id).toBe('qi-2')

  await invoke('db:close')
  const legacyRoot = path.join(temporaryRoot, 'old-project')
  fs.mkdirSync(legacyRoot)
  initProjectDatabase(legacyRoot)
  ProjectCoreRepository.init('Legacy temp project')
  const legacyId = randomUUID()
  currentSession = beginSession(legacyRoot, legacyId)
  await commitCharacter('旧角色', '旧修为文字保持原样')
  await invoke('db:close')
  const legacyDbPath = path.join(legacyRoot, '.vela', 'vela.db')
  const legacyDb = new Database(legacyDbPath)
  legacyDb.pragma('foreign_keys = OFF')
  legacyDb.exec('DROP TABLE cultivation_levels; DROP TABLE cultivation_realms; DROP TABLE cultivation_meta; ALTER TABLE characters DROP COLUMN cultivation_level_id;')
  legacyDb.close()

  initProjectDatabase(legacyRoot)
  currentSession = beginSession(legacyRoot, legacyId)
  const migratedSystem = await invoke('db:cultivation-read') as { revision: number; realms: unknown[] }
  const migratedRoster = await invoke('db:character-roster-read') as CharacterRosterSnapshot
  expect(migratedSystem).toEqual({ revision: 0, realms: [], markdown: '' })
  expect(migratedRoster.entries[0]).toMatchObject({ name: '旧角色', currentState: { powerLevel: '旧修为文字保持原样' } })
  expect(migratedRoster.entries[0]?.cultivationLevelId).toBeUndefined()

  const oldProjectContext = currentSession
  const otherRoot = path.join(temporaryRoot, 'project-b')
  fs.mkdirSync(otherRoot)
  initProjectDatabase(otherRoot)
  currentSession = beginSession(otherRoot, randomUUID())
  await expect(api().invoke('db:cultivation-read', oldProjectContext.projectPath, oldProjectContext)).rejects.toThrow('项目会话已失效')
  const rejectedSave = await api().invoke('db:cultivation-save', request, oldProjectContext.projectPath, oldProjectContext) as { success: boolean }
  expect(rejectedSave.success).toBe(false)
  expect((await invoke('db:cultivation-read') as { realms: unknown[] }).realms).toEqual([])

  initProjectDatabase(newRoot)
  currentSession = beginSession(newRoot, projectId)
  await expect(api().invoke('db:cultivation-read', firstLease.projectPath, firstLease)).rejects.toThrow('项目会话已失效')
  expect((await invoke('db:cultivation-read') as { realms: Array<{ name: string }> }).realms[0]?.name).toBe('炼气')
})
