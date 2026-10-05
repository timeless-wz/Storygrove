import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { getProjectDb } from '../../database'
import { CultivationRepository } from '../cultivation-repository'
import { ensureCultivationSchema } from '../cultivation-schema'
import { CharacterRosterRepository } from '../character-roster-repository'
import { CharacterRepository } from '../character-repository'
import { cultivationLevels, cultivationLevelAt, CULTIVATION_PRESETS, type CultivationRealm } from '../../../src/shared/cultivation'
import type { CharacterRosterEntry } from '../../../src/shared/character-roster'

vi.mock('../../database', () => ({ getProjectDb: vi.fn() }))
const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
let db: BetterSqlite3.Database
let folder: string
let sequence = 0
function schema(database: BetterSqlite3.Database) {
  database.pragma('foreign_keys = ON')
  database.exec(`CREATE TABLE project_core(id TEXT PRIMARY KEY, writing_language TEXT DEFAULT 'zh-CN', characters_arch TEXT DEFAULT ''); INSERT INTO project_core(id) VALUES('main');
    CREATE TABLE characters(name TEXT PRIMARY KEY, role TEXT, gender TEXT, age TEXT, appearance TEXT, personality TEXT, background TEXT, abilities TEXT, motivation TEXT, relationships TEXT, arc TEXT, notes TEXT, cs_location TEXT, cs_power_level TEXT, cs_physical_state TEXT, cs_mental_state TEXT, cs_key_items TEXT, cs_recent_events TEXT, cs_updated_at_chapter INTEGER, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE blueprints(chapter_number INTEGER PRIMARY KEY, characters TEXT DEFAULT '[]', updated_at TEXT);
    CREATE TABLE drafts(id INTEGER PRIMARY KEY, chapter_number INTEGER, status TEXT);
    CREATE TABLE finalization_outbox(finalization_id TEXT PRIMARY KEY, draft_id INTEGER, chapter_number INTEGER, content_hash TEXT);`)
}
function entry(name: string): CharacterRosterEntry {
  return { name, role: 'protagonist', gender: '', age: '', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '', currentState: { location: '', powerLevel: '旧修为原文', physicalState: '', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 0 } }
}
const realms: CultivationRealm[] = [
  { id: 'qi', name: '炼气', levelId: 'qi-base', stages: [{ id: 'qi-1', name: '一层' }, { id: 'qi-2', name: '二层' }] },
  { id: 'foundation', name: '筑基', levelId: 'foundation-base', stages: [{ id: 'foundation-1', name: '初期' }] },
  { id: 'core', name: '金丹', levelId: 'core-base', stages: [] },
]
function save(next = realms, resolutions: Record<string, string | null> = {}) {
  return CultivationRepository.save({ expectedRevision: CultivationRepository.read().revision, expectedRosterRevision: CharacterRosterRepository.read().revision, realms: next, resolutions })
}
function commit(entries: CharacterRosterEntry[], intent: 'manual_edit' | 'architecture_generation' | 'novel_import' = 'manual_edit', renames?: { originalName: string; newName: string }[]) {
  return CharacterRosterRepository.commit({ operationId: `test-${++sequence}`, expectedRevision: CharacterRosterRepository.read().revision, schemaVersion: 1, intent, entries, renames })
}
function bind(name = '甲', id = 'qi-2') { commit(CharacterRosterRepository.read().entries.map(card => card.name === name ? { ...card, cultivationLevelId: id } : card)) }
function storage() { return JSON.stringify({ system: CultivationRepository.read(), roster: CharacterRosterRepository.read(), rows: db.prepare('SELECT * FROM characters ORDER BY name').all(), operations: db.prepare('SELECT * FROM character_roster_operations').all() }) }
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'vela-cultivation-'))
  db = new Database(join(folder, 'project.db'))
  schema(db)
  vi.mocked(getProjectDb).mockReturnValue(db)
  CharacterRosterRepository.commit({ operationId: `init-${++sequence}`, expectedRevision: 0, schemaVersion: 1, entries: [entry('甲'), entry('乙')] })
})
afterEach(() => { db.close(); rmSync(folder, { recursive: true, force: true }) })

describe('project cultivation transactions', () => {
  it('migrates repeatedly without defaults or parsing free text', () => {
    ensureCultivationSchema(db); ensureCultivationSchema(db)
    expect(CultivationRepository.read()).toEqual({ revision: 0, markdown: '', realms: [] })
    expect(CharacterRepository.getByName('甲')?.cultivationLevelId).toBeUndefined()
    expect(CharacterRepository.getByName('甲')?.currentState?.powerLevel).toBe('旧修为原文')
  })
  it('maps every number both ways, including a realm without stages and invalid integers', () => {
    save()
    const levels = cultivationLevels(CultivationRepository.read().realms)
    expect(levels.map(level => `${level.number}=${level.name}`)).toEqual(['1=炼气·一层', '2=炼气·二层', '3=筑基·初期', '4=金丹'])
    for (const level of levels) expect(cultivationLevelAt(realms, String(level.number))?.id).toBe(level.id)
    for (const invalid of ['0', '-1', '1.5', '5', '1e0', '', 'Infinity', '01']) expect(cultivationLevelAt(realms, invalid)).toBeUndefined()
  })
  it('presets remain editable, with different stages in each realm', () => {
    const preset = { ...realms[0], stages: CULTIVATION_PRESETS[0].names.map((name, index) => ({ id: `preset-${index}`, name })) }
    save([preset, realms[1]])
    const edited = { ...preset, name: '气海', stages: [{ id: 'added', name: '自定' }, ...preset.stages.slice(1).reverse().map(stage => stage.id === 'preset-8' ? { ...stage, name: '巅峰' } : stage)] }
    save([edited, realms[1]])
    expect(CultivationRepository.read().realms).toEqual([edited, realms[1]])
  })
  it('renaming, insertion and reorder change only the bound display and number', () => {
    save(); bind()
    const next = [realms[2], { ...realms[0], name: '气海', stages: [{ id: 'new', name: '入门' }, ...realms[0].stages] }, realms[1]]
    const result = save(next)
    expect(result.roster.entries.find(card => card.name === '甲')?.cultivationLevelId).toBe('qi-2')
    expect(cultivationLevels(result.system.realms).find(level => level.id === 'qi-2')).toMatchObject({ number: 4, name: '气海·二层' })
    expect(CharacterRosterRepository.read().status).toBe('ready')
    expect(result.roster.renderedMarkdown).toContain('修炼等级：气海·二层')
  })
  it('refuses unresolved referenced deletion and rolls back invalid bulk remapping', () => {
    save(); bind(); bind('乙')
    const before = storage()
    expect(() => save([realms[1]], {})).toThrow('必须处理角色')
    expect(storage()).toBe(before)
    expect(() => save([realms[1]], { 甲: 'foundation-1', 乙: 'missing' })).toThrow('无效')
    expect(storage()).toBe(before)
    const result = save([realms[1]], { 甲: 'foundation-1', 乙: null })
    expect(result.roster.entries.find(card => card.name === '甲')?.cultivationLevelId).toBe('foundation-1')
    expect(result.roster.entries.find(card => card.name === '乙')?.cultivationLevelId).toBeUndefined()
    expect(db.prepare('SELECT * FROM cultivation_levels WHERE id=?').get('qi-2')).toBeUndefined()
    expect(db.pragma('foreign_key_check')).toEqual([])
  })
  it('preserves the realm base identity across stage replacement and demands impact resolution', () => {
    save([realms[2]]); bind('甲', 'core-base')
    const staged = { ...realms[2], stages: [{ id: 'core-early', name: '初期' }] }
    expect(() => save([staged])).toThrow('甲')
    save([staged], { 甲: 'core-early' })
    expect(() => save([realms[2]])).toThrow('甲')
    save([realms[2]], { 甲: 'core-base' })
    expect(CharacterRosterRepository.read().renderedMarkdown).toContain('修炼等级：金丹')
  })
  it('rolls back realms, bindings, roster metadata and receipt when the transaction fails', () => {
    save(); bind()
    const before = storage()
    db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON project_core BEGIN SELECT RAISE(ABORT,'forced failure'); END")
    expect(() => save([realms[1]], { 甲: 'foundation-1' })).toThrow('forced failure')
    expect(storage()).toBe(before)
  })
  it('persists and resolves bindings after closing and reopening the SQLite file', () => {
    save(); bind()
    const before = storage()
    db.close(); db = new Database(join(folder, 'project.db')); db.pragma('foreign_keys=ON'); vi.mocked(getProjectDb).mockReturnValue(db)
    expect(storage()).toBe(before)
    expect(CultivationRepository.resolveName(CharacterRepository.getByName('甲')!.cultivationLevelId!)).toBe('炼气·二层')
  })
  it('keeps project A and B isolated when the active database changes', () => {
    save(); bind(); const a = db; const before = storage()
    const b = new Database(join(folder, 'b.db')); schema(b); db = b; vi.mocked(getProjectDb).mockReturnValue(b)
    expect(CultivationRepository.read().realms).toEqual([])
    save([realms[2]])
    expect(CharacterRosterRepository.read().entries).toEqual([])
    b.close(); db = a; vi.mocked(getProjectDb).mockReturnValue(a)
    expect(storage()).toBe(before)
  })
  it('preserves bindings through omitted manual fields, character rename, generation and import', () => {
    save(); bind()
    let entries = CharacterRosterRepository.read().entries.map(card => { const next = { ...card, notes: '手工备注' }; delete next.cultivationLevelId; return next })
    commit(entries)
    entries = CharacterRosterRepository.read().entries.map(card => card.name === '甲' ? { ...card, name: '改名' } : card)
    commit(entries, 'manual_edit', [{ originalName: '甲', newName: '改名' }])
    expect(CharacterRepository.getByName('改名')?.cultivationLevelId).toBe('qi-2')
    for (const intent of ['architecture_generation', 'novel_import'] as const) {
      commit([{ ...entry('改名'), cultivationLevelId: 'foundation-1' }], intent)
      expect(CharacterRepository.getByName('改名')?.cultivationLevelId).toBe('qi-2')
    }
    const direct = CharacterRepository.getByName('改名')!; delete direct.cultivationLevelId; CharacterRepository.upsert(direct)
    expect(CharacterRepository.getByName('改名')?.cultivationLevelId).toBe('qi-2')
  })
  it('deleting a character cleans its binding without deleting the project level', () => {
    save(); bind()
    commit(CharacterRosterRepository.read().entries.filter(card => card.name !== '甲'))
    expect(CharacterRepository.getByName('甲')).toBeNull()
    expect(cultivationLevels(CultivationRepository.read().realms).some(level => level.id === 'qi-2')).toBe(true)
  })
  it('keeps author binding during blueprint synchronization and finalized chapter state progression', () => {
    save(); bind()
    let snapshot = CharacterRosterRepository.read()
    CharacterRosterRepository.commit({ operationId: `blueprint-${++sequence}`, expectedRevision: snapshot.revision, schemaVersion: 1, intent: 'blueprint_sync', entries: [{ ...entry('甲'), cultivationLevelId: 'foundation-1' }] })
    snapshot = CharacterRosterRepository.read()
    expect(snapshot.entries.find(card => card.name === '甲')?.cultivationLevelId).toBe('qi-2')
    db.prepare("INSERT INTO drafts(id,chapter_number,status) VALUES(1,1,'finalized')").run()
    db.prepare('INSERT INTO finalization_outbox(finalization_id,draft_id,chapter_number,content_hash) VALUES(?,?,?,?)').run('finalized-1', 1, 1, 'a'.repeat(64))
    const source = { draftId: 1, chapterNumber: 1, finalizationId: 'finalized-1', contentHash: 'a'.repeat(64) }
    const candidate = entry('甲')
    candidate.currentState = { ...candidate.currentState!, location: '第一章现场', updatedAtChapter: 1, provenance: { location: { kind: 'derived', source } } }
    CharacterRosterRepository.commit({ operationId: `chapter-${++sequence}`, expectedRevision: snapshot.revision, schemaVersion: 1, intent: 'chapter_progress', source, entries: [candidate] })
    expect(CharacterRepository.getByName('甲')?.cultivationLevelId).toBe('qi-2')
    expect(CharacterRepository.getByName('甲')?.currentState?.location).toBe('第一章现场')
  })
  it('allows old preserved character cards to configure levels without overwriting their free text', () => {
    db.prepare('DELETE FROM character_roster_operations').run()
    db.prepare('DELETE FROM character_roster_meta').run()
    db.prepare("UPDATE project_core SET characters_arch='旧角色图谱原文'").run()
    const rows = db.prepare('SELECT * FROM characters').all()
    const result = save()
    expect(result.system.realms).toEqual(realms)
    expect(db.prepare('SELECT * FROM characters').all()).toEqual(rows)
    expect(result.roster.entries.every(card => !card.cultivationLevelId)).toBe(true)
  })
  it('rejects stale settings, stale roster revisions, dangling bindings and reused identities', () => {
    save(); bind()
    const before = storage()
    expect(() => CultivationRepository.save({ expectedRevision: 0, expectedRosterRevision: CharacterRosterRepository.read().revision, realms, resolutions: {} })).toThrow('已更新')
    expect(() => CultivationRepository.save({ expectedRevision: 1, expectedRosterRevision: 0, realms, resolutions: {} })).toThrow('已更新')
    expect(() => bind('甲', 'missing')).toThrow('已删除')
    expect(() => save([{ ...realms[0], levelId: 'replacement-base' }], { 甲: null })).toThrow('稳定')
    expect(() => save([{ ...realms[1], stages: [{ id: 'qi-2', name: '伪造' }] }])).toThrow('身份')
    expect(storage()).toBe(before)
  })
})
