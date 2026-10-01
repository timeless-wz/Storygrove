import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCultivationStore } from '../cultivation-store'
import { reconcileCharacterCultivationDraft, useCharacterStore, EMPTY_CARD } from '../character-store'
import { useEditorStore } from '../editor-store'
import { useProjectStore } from '../project-store'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ProjectData, ProjectSessionContext } from '../../shared/ipc-channels'
import { resolvedCultivationName, type CultivationSystem } from '../../shared/cultivation'
import type { CharacterRosterSnapshot } from '../../shared/character-roster'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../services/ipc-client', () => ({ ipc: { invokeWithProjectSession: invoke } }))
const a: ProjectSessionContext = { projectId: 'a', projectPath: 'C:\\test\\a', leaseId: 'a-1' }
const b: ProjectSessionContext = { projectId: 'b', projectPath: 'C:\\test\\b', leaseId: 'b-1' }
const system: CultivationSystem = { revision: 1, realms: [{ id: 'realm', levelId: 'base', name: '一境', stages: [] }] }
const roster: CharacterRosterSnapshot = { schemaVersion: 1, revision: 1, migrationState: 'ready', status: 'ready', entries: [], renderedMarkdown: '', projectionHash: '', factHash: '' }
const initial = useCultivationStore.getState()
const editorInitial = useEditorStore.getState()
const characterInitial = useCharacterStore.getState()
const projectInitial = useProjectStore.getState()
it('uses an explicit binding as the only current level and keeps free text as the unbound fallback', () => {
  const realms = [{ id: 'qi', name: '炼气', levelId: 'qi-base', stages: [{ id: 'qi-2', name: '二层' }] }]
  expect(resolvedCultivationName({ cultivationLevelId: 'qi-2', currentState: { powerLevel: '旧修为原文' } }, realms)).toBe('炼气·二层')
  expect(resolvedCultivationName({ cultivationLevelId: 'removed', currentState: { powerLevel: '旧修为原文' } }, realms)).toBe('')
  expect(resolvedCultivationName({ currentState: { powerLevel: '未绑定自由文本' } }, realms)).toBe('未绑定自由文本')
})
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept }); return { promise, resolve } }
beforeEach(() => {
  useCultivationStore.setState(initial); useEditorStore.setState({ tabs: [], draftLedgers: {} }); setActiveProjectSessionContext(a)
  invoke.mockReset(); invoke.mockImplementation(async (_session, channel) => channel === 'db:cultivation-read' ? system : roster)
})
afterEach(() => { useCultivationStore.setState(initial); useEditorStore.setState(editorInitial); useCharacterStore.setState(characterInitial); useProjectStore.setState(projectInitial); setActiveProjectSessionContext(null) })

it('ignores old load responses when switching projects', async () => {
  const pending = deferred<CultivationSystem>()
  invoke.mockImplementation(async (session, channel) => channel === 'db:cultivation-read' ? session.projectId === 'a' ? pending.promise : { revision: 0, realms: [] } : roster)
  const old = useCultivationStore.getState().load(a)
  setActiveProjectSessionContext(b); await useCultivationStore.getState().load(b)
  pending.resolve(system); await old
  expect(useCultivationStore.getState().session).toEqual(b)
  expect(useCultivationStore.getState().realms).toEqual([])
})
it('checks the lease when reopening the same path and ignores an old save completion', async () => {
  await useCultivationStore.getState().load(a)
  useCultivationStore.getState().edit([{ ...system.realms[0], name: '作者修改' }])
  const pending = deferred<unknown>()
  invoke.mockImplementation(async (_session, channel) => channel === 'db:cultivation-save' ? pending.promise : channel === 'db:cultivation-read' ? system : roster)
  const save = useCultivationStore.getState().save({})
  await vi.waitFor(() => expect(invoke.mock.calls.some(call => call[1] === 'db:cultivation-save')).toBe(true))
  const reopened = { ...a, leaseId: 'a-2' }
  setActiveProjectSessionContext(reopened); await useCultivationStore.getState().load(reopened)
  const before = useCultivationStore.getState()
  pending.resolve({ success: true, result: { system: { revision: 2, realms: [] }, roster } })
  expect(await save).toBe(false)
  expect(useCultivationStore.getState()).toBe(before)
})
it('retains unsaved settings and the ledger when a save fails', async () => {
  await useCultivationStore.getState().load(a)
  useCultivationStore.getState().edit([{ ...system.realms[0], name: '不能丢失的名称' }])
  const before = useEditorStore.getState().draftLedgers
  invoke.mockImplementation(async (_session, channel) => channel === 'db:cultivation-save' ? { success: false, error: 'disk full' } : roster)
  expect(await useCultivationStore.getState().save({})).toBe(false)
  expect(useCultivationStore.getState()).toMatchObject({ dirty: true, saving: false, error: expect.stringContaining('disk full') })
  expect(useEditorStore.getState().draftLedgers).toEqual(before)
  expect(useCultivationStore.getState().realms[0].name).toBe('不能丢失的名称')
})
it('keeps conflicting settings drafts across reopen and refuses to overwrite a newer configuration', async () => {
  await useCultivationStore.getState().load(a)
  useCultivationStore.getState().edit([{ ...system.realms[0], name: '旧会话草稿' }])
  const reopened = { ...a, leaseId: 'a-2' }; setActiveProjectSessionContext(reopened)
  invoke.mockImplementation(async (_session, channel) => channel === 'db:cultivation-read' ? { revision: 2, realms: [{ ...system.realms[0], name: '新配置' }] } : roster)
  await useCultivationStore.getState().load(reopened)
  expect(useCultivationStore.getState()).toMatchObject({ conflicted: true, dirty: true })
  expect(useCultivationStore.getState().realms[0].name).toBe('旧会话草稿')
  expect(await useCultivationStore.getState().save({})).toBe(false)
  useCultivationStore.getState().discard()
  expect(useCultivationStore.getState().realms[0].name).toBe('新配置')
  expect(useCultivationStore.getState().conflicted).toBe(false)
})
it('refreshes character bindings on successful settings save using the frozen project session', async () => {
  const accept = vi.spyOn(useCharacterStore.getState(), 'acceptCultivationSnapshot').mockImplementation(() => {})
  await useCultivationStore.getState().load(a)
  useCultivationStore.getState().edit([{ ...system.realms[0], name: '更名' }])
  const next = { revision: 2, realms: [{ ...system.realms[0], name: '更名' }] }
  invoke.mockImplementation(async (_session, channel) => channel === 'db:cultivation-save' ? { success: true, result: { system: next, roster } } : roster)
  expect(await useCultivationStore.getState().save({})).toBe(true)
  expect(accept).toHaveBeenCalledWith(roster, a, new Set(['base']))
  expect(invoke.mock.calls.every(call => call[0].leaseId === 'a-1')).toBe(true)
  expect(useCultivationStore.getState().dirty).toBe(false)
  accept.mockRestore()
})
it('reconciles config migration into an unsaved renamed profile without restoring removed IDs', () => {
  const base = [{ ...EMPTY_CARD, name: '甲', cultivationLevelId: 'old', notes: '原文' }]
  const draft = [{ ...base[0], name: '乙', notes: '正在编辑' }]
  const remote = [{ ...base[0], cultivationLevelId: 'new' }]
  const reconciled = reconcileCharacterCultivationDraft(draft, base, remote, new Set(['new']), [{ originalName: '甲', newName: '乙' }])
  expect(reconciled[0]).toMatchObject({ name: '乙', notes: '正在编辑', cultivationLevelId: 'new' })
  const cleared = reconcileCharacterCultivationDraft(draft, base, [{ ...base[0], cultivationLevelId: null }], new Set(), [{ originalName: '甲', newName: '乙' }])
  expect(cleared[0].cultivationLevelId).toBeUndefined()
})
it('preserves binding field order when a remote remap is the only profile change', () => {
  const baseCard = Object.assign({ name: '甲', cultivationLevelId: 'old' }, EMPTY_CARD, { name: '甲' })
  const remoteCard = { ...baseCard, cultivationLevelId: 'new' }
  const reconciled = reconcileCharacterCultivationDraft(
    [baseCard], [baseCard], [remoteCard], new Set(['new']),
  )
  expect(JSON.stringify(reconciled)).toBe(JSON.stringify([remoteCard]))
})
it('preserves valid local binding edits during a name-only config change, and cleans deleted local-only levels', () => {
  const base = [{ ...EMPTY_CARD, name: '甲', cultivationLevelId: 'a' }]
  const draft = [{ ...base[0], cultivationLevelId: 'b', notes: '正在编辑' }]
  expect(reconcileCharacterCultivationDraft(draft, base, base, new Set(['a', 'b']))[0].cultivationLevelId).toBe('b')
  expect(reconcileCharacterCultivationDraft(draft, base, base, new Set(['a']))[0]).toMatchObject({ cultivationLevelId: 'a', notes: '正在编辑' })
})
it('ignores a character save receipt overtaken by an atomic cultivation migration', async () => {
  useProjectStore.setState({ currentProject: { id: a.projectId, path: a.projectPath, sessionLease: a.leaseId } as ProjectData })
  const card = { ...EMPTY_CARD, name: '甲', cultivationLevelId: 'old' }
  useCharacterStore.setState({ ...characterInitial, characters: [card], loaded: true, dataProjectKey: a.projectPath, dataProjectSession: a, rosterRevision: 1, lastError: null, loadingProjectSession: null })
  useCharacterStore.getState().updateField('甲', 'notes', '保存期间的作者资料')
  const pending = deferred<unknown>()
  invoke.mockImplementation(async (_session, channel) => channel === 'db:character-roster-commit' ? pending.promise : roster)
  const saving = useCharacterStore.getState().saveAll(a.projectPath, a)
  const latest: CharacterRosterSnapshot = { ...roster, revision: 3, entries: [{ ...card, relationships: [], notes: '保存期间的作者资料', cultivationLevelId: 'new' }] }
  useCharacterStore.getState().acceptCultivationSnapshot(latest, a, new Set(['new']))
  pending.resolve({ success: true, receipt: { revision: 2, snapshot: { ...roster, revision: 2, entries: [{ ...card, relationships: [], notes: '保存期间的作者资料' }] } } })
  await saving
  expect(useCharacterStore.getState().rosterRevision).toBe(3)
  expect(useCharacterStore.getState().characters[0]).toMatchObject({ cultivationLevelId: 'new', notes: '保存期间的作者资料' })
  useCharacterStore.getState().acceptCultivationSnapshot({ ...latest, revision: 2, entries: [{ ...card, relationships: [] }] }, a, new Set(['old']))
  expect(useCharacterStore.getState().characters[0].cultivationLevelId).toBe('new')
})
