/**
 * 手工角色保存的端到端回归（任务 A：新建人物无法保存）。
 *
 * 真实主进程（db/fs 控制器 + initProjectDatabase + preload 桥）+ 真实渲染层
 * character-store。覆盖验收要点：
 * - 无默认模型、无修炼体系时，新建人物可以保存；
 * - 受保护名单（legacy_cards_preserved / 哈希漂移）曾把保存与“重建只读图谱”
 *   的唯一出口同时锁死（出口曾要求默认模型）；回归锁定采用/校准分支不依赖模型；
 * - 保存失败有明确提示并保留输入；
 * - 项目会话与 revision 保护未被取消。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

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
let temporaryRoot = ''
let initProjectDatabase: typeof import('../../database').initProjectDatabase
let closeProjectDatabase: typeof import('../../database').closeProjectDatabase
let projectAccess: typeof import('../../services/project-access').projectAccess

function api(): PreloadApi {
  if (!bridge.api) throw new Error('Preload API was not exposed')
  return bridge.api
}

beforeAll(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-character-manual-save-'))
  ;({ initProjectDatabase, closeProjectDatabase } = await import('../../database'))
  ;({ projectAccess } = await import('../../services/project-access'))
  const { registerDatabaseController } = await import('../db-controller')
  registerDatabaseController()
  const { registerFSController } = await import('../fs-controller')
  registerFSController()
  await import('../../preload')

  // 渲染层 store 依赖浏览器全局（zustand persist → localStorage、ipc-client → window.velaAPI）。
  const storage = new Map<string, string>()
  const localStorageStub = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
    clear: () => storage.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  Object.defineProperty(globalThis, 'velaAPI', { value: api(), configurable: true })
})

afterAll(() => {
  closeProjectDatabase?.()
  projectAccess?.invalidateCurrentSession()
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
})

interface Harness {
  projectRoot: string
  projectStore: typeof import('../../../src/stores/project-store').useProjectStore
  characterStore: typeof import('../../../src/stores/character-store').useCharacterStore
  session: import('../../../src/shared/ipc-channels').ProjectSessionContext
}

async function openProject(name: string, options: { withoutDefaultModel?: boolean } = {}): Promise<Harness> {
  const { ProjectCoreRepository } = await import('../../repositories/project-core-repository')
  const { useCharacterStore } = await import('../../../src/stores/character-store')
  const { useProjectStore } = await import('../../../src/stores/project-store')
  const { useLLMStore } = await import('../../../src/stores/llm-store')
  const { projectSessionContextFromProject } = await import('../../../src/shared/project-session-context')

  if (options.withoutDefaultModel) useLLMStore.setState({ defaultModelId: null })

  const projectRoot = path.join(temporaryRoot, name)
  fs.mkdirSync(projectRoot)
  initProjectDatabase(projectRoot)
  ProjectCoreRepository.init(name)
  const projectId = randomUUID()
  const lease = projectAccess.beginSession({ kind: 'manifest', projectId, rootPath: projectRoot })

  useProjectStore.setState({
    currentProject: {
      id: projectId,
      sessionLease: lease.leaseId,
      name,
      path: projectRoot,
      novelConfig: {
        genre: '玄幻', subGenre: '', targetAudience: '', totalChapters: 100, wordsPerChapter: 3000,
        plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '',
        goldenFinger: '', protagonistProfile: '', globalGuidance: '',
      },
      characterStates: '',
      createdAt: '', updatedAt: '',
    } as never,
  })

  await useCharacterStore.getState().load(projectRoot)
  const state = useCharacterStore.getState()
  expect(state.lastError).toBeNull()
  return {
    projectRoot,
    projectStore: useProjectStore,
    characterStore: useCharacterStore,
    session: projectSessionContextFromProject(useProjectStore.getState().currentProject)!,
  }
}

async function reopenProject(harness: Harness): Promise<void> {
  closeProjectDatabase()
  initProjectDatabase(harness.projectRoot)
  await harness.characterStore.getState().load(harness.projectRoot)
  expect(harness.characterStore.getState().lastError).toBeNull()
}

it('saves a new character on a fresh project without any default model or cultivation system, and it survives a project reopen', async () => {
  const harness = await openProject('fresh-project', { withoutDefaultModel: true })
  const { characterStore, projectRoot, session } = harness

  const created = characterStore.getState().addCharacter({ name: '林小新' })
  expect(created).toMatchObject({ ok: true, name: '林小新', role: 'unassigned' })
  characterStore.getState().updateField('林小新', 'personality', '勇敢但冲动')
  characterStore.getState().updateField('林小新', 'age', '十六')

  await characterStore.getState().saveAll(projectRoot)

  const afterSave = characterStore.getState()
  expect(afterSave.lastError).toBeNull()
  expect(afterSave.rosterRevision).toBe(1)
  expect(afterSave.characters.map(card => card.name)).toEqual(['林小新'])

  // 真实保存后的数据库回读。
  const roster = await api().invoke('db:character-roster-read', projectRoot, session) as {
    revision: number
    status: string
    entries: Array<{ name: string; personality: string; age: string }>
  }
  expect(roster.status).toBe('ready')
  expect(roster.revision).toBe(1)
  expect(roster.entries[0]).toMatchObject({ name: '林小新', personality: '勇敢但冲动', age: '十六' })

  // 重开项目后人物及字段仍存在。
  await reopenProject(harness)
  const reopened = characterStore.getState()
  expect(reopened.characters).toHaveLength(1)
  expect(reopened.characters[0]).toMatchObject({ name: '林小新', personality: '勇敢但冲动', age: '十六' })
  expect(reopened.rosterRevision).toBe(1)

  // ready 名单上继续新增同样可以保存。
  expect(characterStore.getState().addCharacter({ name: '第二人' })).toMatchObject({ ok: true })
  await characterStore.getState().saveAll(projectRoot)
  const roster2 = await api().invoke('db:character-roster-read', projectRoot, harness.session) as {
    revision: number
    entries: Array<{ name: string }>
  }
  expect(roster2.revision).toBe(2)
  expect([...roster2.entries.map(entry => entry.name)].sort()).toEqual(['第二人', '林小新'].sort())
})

it('unblocks protected legacy cards: manual save is rejected with a clear message and preserved input, the explicit repair no longer needs a default model, and afterwards saving works', async () => {
  const harness = await openProject('legacy-cards-project', { withoutDefaultModel: true })
  const { characterStore, projectRoot, session } = harness

  // 模拟旧版本应用的项目：roster meta 尚不存在时已有角色卡 → 升级后归类为 legacy_cards_preserved。
  closeProjectDatabase()
  const dbPath = path.join(projectRoot, '.vela', 'vela.db')
  const Database = require('better-sqlite3')
  const legacy = new Database(dbPath)
  legacy.prepare(`INSERT INTO characters (name, role, gender, age, appearance, personality, background, abilities, motivation, relationships, arc, notes)
    VALUES ('旧主角', 'protagonist', '男', '三十', '', '沉稳', '', '', '', '少年时与沈家有些旧怨', '', '左手有旧伤')`).run()
  legacy.exec('DROP TABLE character_roster_meta')
  legacy.close()
  initProjectDatabase(projectRoot)

  await characterStore.getState().load(projectRoot)
  expect(characterStore.getState().characters.map(card => card.name)).toEqual(['旧主角'])
  expect(characterStore.getState().rosterRevision).toBe(0)

  // 作者在受保护项目里新建人物并编辑（本地草稿）。
  expect(characterStore.getState().addCharacter({ name: '林小新' })).toMatchObject({ ok: true })
  characterStore.getState().updateField('林小新', 'personality', '勇敢但冲动')

  // 手工保存被拒绝：错误提示明确（无 “Error:” 前缀噪声）且输入完整保留。
  await expect(characterStore.getState().saveAll(projectRoot)).rejects.toThrow('已有角色数据受到保护')
  const afterFailure = characterStore.getState()
  expect(afterFailure.characters.map(card => card.name)).toEqual(['旧主角', '林小新'])
  expect(afterFailure.characters.find(card => card.name === '林小新')?.personality).toBe('勇敢但冲动')
  expect(afterFailure.lastError).toBeNull()

  // 唯一出口“重建只读图谱”：无默认模型时也必须能完成（回归核心：修复不再依赖模型租约）。
  const { migrateLegacyCharacterRoster } = await import('../../../src/services/workflows/architecture-workflow')
  await migrateLegacyCharacterRoster(projectRoot)

  // 采用只重建投影，不改写角色卡；本地草稿仍在。刷新后保存（旧人 + 新人）成功。
  await characterStore.getState().load(projectRoot)
  expect(characterStore.getState().lastError).toBeNull()
  expect(characterStore.getState().characters.map(card => card.name)).toEqual(['旧主角', '林小新'])

  await characterStore.getState().saveAll(projectRoot)
  const roster = await api().invoke('db:character-roster-read', projectRoot, session) as {
    revision: number
    status: string
    entries: Array<{ name: string; personality: string; relationships: unknown[]; legacyRelationshipNotes?: string }>
    renderedMarkdown: string
    legacyMarkdown?: string
  }
  expect(roster.status).toBe('ready')
  expect(roster.entries.map(entry => entry.name).sort()).toEqual(['旧主角', '林小新'])
  expect(roster.entries.find(entry => entry.name === '林小新')?.personality).toBe('勇敢但冲动')
  // 旧人物的自由文本关系与备注原样保留；旧图谱证据未被覆盖；投影包含两人。
  const preserved = roster.entries.find(entry => entry.name === '旧主角')
  expect(preserved?.legacyRelationshipNotes).toBe('少年时与沈家有些旧怨')
  expect(roster.legacyMarkdown ?? '').toBe('')
  expect(roster.renderedMarkdown).toContain('旧主角')
  expect(roster.renderedMarkdown).toContain('林小新')

  // revision 保护未被取消：用过期 revision 直接提交必须被拒绝。
  const stale = await api().invoke('db:character-roster-commit', {
    operationId: `stale-${randomUUID()}`,
    expectedRevision: 0,
    schemaVersion: 1,
    intent: 'manual_edit',
    entries: roster.entries,
  }, projectRoot, harness.session) as { success: boolean; error?: string }
  expect(stale.success).toBe(false)
  expect(stale.error).toContain('revision 已过期')

  // 重开项目后两人都在。
  await reopenProject(harness)
  expect(characterStore.getState().characters.map(card => card.name).sort()).toEqual(['旧主角', '林小新'])
})

it('recalibrates a drifted ready roster without a default model (v1 fact-hash upgrade gap), then saves new characters again', async () => {
  const harness = await openProject('drifted-ready-project', { withoutDefaultModel: true })
  const { characterStore, projectRoot, session } = harness

  expect(characterStore.getState().addCharacter({ name: '旧主角' })).toMatchObject({ ok: true })
  await characterStore.getState().saveAll(projectRoot)
  expect(characterStore.getState().rosterRevision).toBe(1)

  // 模拟 v1 roster 元数据升级缺口：fact_hash 列被补齐为空 → ready 名单按哈希判为 inconsistent。
  closeProjectDatabase()
  const Database = require('better-sqlite3')
  const drifted = new Database(path.join(projectRoot, '.vela', 'vela.db'))
  drifted.exec("UPDATE character_roster_meta SET fact_hash = '' WHERE id = 'main'")
  drifted.close()
  initProjectDatabase(projectRoot)

  await characterStore.getState().load(projectRoot)
  const driftedRoster = await api().invoke('db:character-roster-read', projectRoot, session) as { status: string; migrationState: string; entries: unknown[] }
  expect(driftedRoster.status).toBe('inconsistent')
  expect(driftedRoster.entries).toHaveLength(1)

  // 保存被拒、输入保留。
  expect(characterStore.getState().addCharacter({ name: '林小新' })).toMatchObject({ ok: true })
  await expect(characterStore.getState().saveAll(projectRoot)).rejects.toThrow('角色名单状态不一致')
  expect(characterStore.getState().characters.map(card => card.name)).toEqual(['旧主角', '林小新'])

  // “校准角色名单”（同一条采用分支）无默认模型可用，校准后恢复保存。
  const { migrateLegacyCharacterRoster } = await import('../../../src/services/workflows/architecture-workflow')
  await migrateLegacyCharacterRoster(projectRoot)

  await characterStore.getState().load(projectRoot)
  await characterStore.getState().saveAll(projectRoot)
  const roster = await api().invoke('db:character-roster-read', projectRoot, session) as {
    revision: number
    status: string
    entries: Array<{ name: string }>
  }
  expect(roster.status).toBe('ready')
  expect(roster.entries.map(entry => entry.name).sort()).toEqual(['旧主角', '林小新'])
})

it('keeps the project session guard: a stale lease cannot read or commit the roster', async () => {
  const harness = await openProject('session-guard-project', { withoutDefaultModel: true })
  const staleSession = { ...harness.session, leaseId: 'expired-lease' }

  await expect(api().invoke('db:character-roster-read', harness.projectRoot, staleSession)).rejects.toThrow()
  const rejected = await api().invoke('db:character-roster-commit', {
    operationId: `stale-session-${randomUUID()}`,
    expectedRevision: 0,
    schemaVersion: 1,
    intent: 'manual_edit',
    entries: [],
  }, harness.projectRoot, staleSession) as { success: boolean }
  expect(rejected.success).toBe(false)
})
