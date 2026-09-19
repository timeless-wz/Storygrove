import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase, getProjectDb } from '../../database'
import { CharacterRepository, type CharacterData } from '../character-repository'
import {
  CharacterRelationshipRepository,
  ensureCharacterRelationshipSchema,
} from '../character-relationship-repository'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/character-relationship-repository-tests')

function character(name: string, overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name,
    role: 'supporting',
    gender: '男',
    age: '二十五',
    appearance: '',
    personality: '',
    background: '',
    abilities: '',
    motivation: '',
    relationships: '',
    arc: '',
    notes: '',
    ...overrides,
  }
}

function identityOf(name: string): string {
  const id = CharacterRelationshipRepository.resolveIdentity(name)
  if (!id) throw new Error(`missing identity for ${name}`)
  return id
}

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)

  CharacterRepository.upsert(character('许渡', { role: 'protagonist' }))
  CharacterRepository.upsert(character('沈砚', { age: '四十八' }))
  CharacterRepository.upsert(character('苏璃', { gender: '女', age: '二十' }))
  CharacterRelationshipRepository.reconcileIdentities(getProjectDb()!)
})

afterEach(() => {
  closeProjectDatabase()
})

describe('character identity', () => {
  it('assigns one stable ID per character and keeps it across reads', () => {
    const first = CharacterRelationshipRepository.getIdentities()
    expect(Object.keys(first).sort()).toEqual(['沈砚', '苏璃', '许渡'])
    const ids = Object.values(first)
    expect(new Set(ids).size).toBe(3)

    CharacterRelationshipRepository.ensureIdentities(['许渡', '沈砚', '苏璃'])
    expect(CharacterRelationshipRepository.getIdentities()).toEqual(first)
  })

  it('backfills an identity for a character created later and survives a rename', () => {
    const before = identityOf('许渡')

    CharacterRepository.saveAll(
      [character('许青玄', { role: 'protagonist' }), CharacterRepository.getByName('沈砚')!],
      [{ originalName: '许渡', newName: '许青玄' }],
    )

    // 改名只更新展示名镜像，ID 原样保留。
    expect(identityOf('许青玄')).toBe(before)
    expect(CharacterRelationshipRepository.resolveIdentity('许渡')).toBeNull()
  })
})

describe('shared relationships keyed by character id', () => {
  it('stores IDs on both ends and exposes resolved display names', () => {
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')

    const rel = CharacterRelationshipRepository.upsert({
      character1Id: xu,
      character2Id: shen,
      relation: '师徒',
      description: '十年前在雁门关相识',
    })

    expect([rel.character1Id, rel.character2Id].sort()).toEqual([xu, shen].sort())
    expect([rel.character1Name, rel.character2Name].sort()).toEqual(['沈砚', '许渡'])

    const all = CharacterRelationshipRepository.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(rel.id)

    // 双向查询返回同一条关系
    expect(CharacterRelationshipRepository.getBetweenIds(xu, shen)?.id).toBe(rel.id)
    expect(CharacterRelationshipRepository.getBetweenIds(shen, xu)?.id).toBe(rel.id)

    // 旧字段是派生投影，只用于旧导出兼容。
    expect(CharacterRepository.getByName('许渡')?.relationships).toContain('沈砚')
    expect(CharacterRepository.getByName('沈砚')?.relationships).toContain('许渡')
  })

  it('rejects empty IDs, unknown endpoints and self relationships', () => {
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')

    expect(() => CharacterRelationshipRepository.upsert({
      character1Id: '', character2Id: shen, relation: '师徒',
    })).toThrow('人物 ID 不能为空')

    expect(() => CharacterRelationshipRepository.upsert({
      character1Id: xu, character2Id: xu, relation: '孪生',
    })).toThrow('不能与自身建立关系')

    expect(() => CharacterRelationshipRepository.upsert({
      character1Id: xu, character2Id: shen, relation: '',
    })).toThrow('关系名称不能为空')

    expect(() => CharacterRelationshipRepository.upsert({
      character1Id: xu, character2Id: 'not-a-character', relation: '师徒',
    })).toThrow('关系端点人物不存在')
  })

  it('keeps one shared relationship per pair and never creates a duplicate line', () => {
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')

    const first = CharacterRelationshipRepository.upsert({
      character1Id: xu, character2Id: shen, relation: '同门',
    })
    const updated = CharacterRelationshipRepository.upsert({
      character1Id: shen, character2Id: xu, relation: '师徒', description: '现已确认师徒身份',
    })

    expect(updated.id).toBe(first.id)
    expect(updated.relation).toBe('师徒')
    expect(updated.description).toBe('现已确认师徒身份')
    expect(CharacterRelationshipRepository.getAll()).toHaveLength(1)
  })

  it('keeps relationship endpoints and canvas position keys untouched by a rename', () => {
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')
    CharacterRelationshipRepository.upsert({
      character1Id: xu, character2Id: shen, relation: '师徒',
    })
    CharacterRelationshipRepository.saveGraphPositions({ [xu]: { x: 150, y: 250 } })

    CharacterRepository.saveAll(
      [character('许青玄', { role: 'protagonist' }), CharacterRepository.getByName('沈砚')!],
      [{ originalName: '许渡', newName: '许青玄' }],
    )

    const rel = CharacterRelationshipRepository.getAll()[0]
    expect(rel.character1Id === xu || rel.character2Id === xu).toBe(true)
    expect(rel.character1Name === '许青玄' || rel.character2Name === '许青玄').toBe(true)

    // 坐标主键仍是同一个 ID，位置原样保留。
    expect(CharacterRelationshipRepository.getGraphPositions()[xu]).toEqual({ x: 150, y: 250 })
  })

  it('cascades relationship and position cleanup by ID when a character is deleted', () => {
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')
    const su = identityOf('苏璃')

    CharacterRelationshipRepository.upsert({ character1Id: xu, character2Id: shen, relation: '师徒' })
    CharacterRelationshipRepository.upsert({ character1Id: shen, character2Id: su, relation: '故交' })
    CharacterRelationshipRepository.saveGraphPositions({
      [shen]: { x: 100, y: 200 },
      [xu]: { x: 300, y: 400 },
    })

    CharacterRepository.delete('沈砚')

    expect(CharacterRelationshipRepository.getAll()).toHaveLength(0)
    expect(CharacterRelationshipRepository.resolveIdentity('沈砚')).toBeNull()

    const positions = CharacterRelationshipRepository.getGraphPositions()
    expect(positions[shen]).toBeUndefined()
    expect(positions[xu]).toEqual({ x: 300, y: 400 })

    expect(CharacterRepository.getByName('许渡')?.relationships).toBe('')
    expect(CharacterRepository.getByName('苏璃')?.relationships).toBe('')
  })

  it('removes a relationship and refreshes the derived legacy projection', () => {
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')
    const rel = CharacterRelationshipRepository.upsert({
      character1Id: xu, character2Id: shen, relation: '盟友',
    })

    CharacterRelationshipRepository.delete(rel.id)

    expect(CharacterRelationshipRepository.getAll()).toHaveLength(0)
    expect(CharacterRelationshipRepository.getBetweenIds(xu, shen)).toBeNull()
    expect(CharacterRepository.getByName('许渡')?.relationships).toBe('')
    expect(CharacterRepository.getByName('沈砚')?.relationships).toBe('')
  })
})

describe('legacy structured relationship migration', () => {
  it('migrates remaining legacy relationships even when the shared table already has a new one', () => {
    const db = getProjectDb()!
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')

    // 共享表里已经有一条“新建”的关系。
    CharacterRelationshipRepository.upsert({ character1Id: xu, character2Id: shen, relation: '同门' })
    expect(CharacterRelationshipRepository.getAll()).toHaveLength(1)

    // 另外两位角色的旧结构化关系仍未迁移。
    db.prepare("UPDATE characters SET relationships = ? WHERE name = '苏璃'")
      .run(JSON.stringify([{ target: '沈砚', relation: '故交（幼时邻居）' }]))
    db.prepare("UPDATE characters SET relationships = ? WHERE name = '沈砚'")
      .run(JSON.stringify([{ target: '苏璃', relation: '故交（幼时邻居）' }]))

    expect(CharacterRelationshipRepository.migrateLegacyRelationships(db)).toBe(1)
    const all = CharacterRelationshipRepository.getAll(db)
    expect(all).toHaveLength(2)
    const migrated = all.find(rel => rel.id !== undefined && rel.relation === '故交')
    expect(migrated).toMatchObject({ relation: '故交', description: '幼时邻居' })
    expect([migrated!.character1Id, migrated!.character2Id].sort())
      .toEqual([identityOf('苏璃'), shen].sort())

    // 可重复执行：已有的一对不会重复插入。
    expect(CharacterRelationshipRepository.migrateLegacyRelationships(db)).toBe(0)
    expect(CharacterRelationshipRepository.getAll(db)).toHaveLength(2)
  })

  it('keeps free-form legacy text, unresolvable targets and conflicts untouched', () => {
    const db = getProjectDb()!
    const xu = identityOf('许渡')
    const shen = identityOf('沈砚')

    const freeForm = '苏璃与沈砚有恩怨未了。'
    db.prepare("UPDATE characters SET relationships = ? WHERE name = '苏璃'").run(freeForm)

    // 一条可迁移 + 一条目标不存在：整体保持原样，不猜测、不静默覆盖。
    const mixed = JSON.stringify([
      { target: '沈砚', relation: '盟友' },
      { target: '不存在的人', relation: '旧敌' },
    ])
    db.prepare("UPDATE characters SET relationships = ? WHERE name = '许渡'").run(mixed)

    // 与共享关系冲突的旧数据：同一对人物已经有关系，旧字段同样保持原样。
    CharacterRelationshipRepository.upsert({ character1Id: xu, character2Id: shen, relation: '同门' })
    db.prepare("UPDATE characters SET relationships = ? WHERE name = '许渡'").run(mixed)

    CharacterRelationshipRepository.migrateLegacyRelationships(db)

    expect(CharacterRepository.getByName('苏璃')?.relationships).toBe(freeForm)
    expect(CharacterRepository.getByName('许渡')?.relationships).toBe(mixed)
    expect(CharacterRelationshipRepository.getAll(db)).toHaveLength(1)
  })

  it('rewrites the legacy field only when it is already a faithful projection', () => {
    const db = getProjectDb()!

    db.prepare("UPDATE characters SET relationships = ? WHERE name = '许渡'")
      .run(JSON.stringify([{ target: '沈砚', relation: '同盟（互相信任）' }]))
    db.prepare("UPDATE characters SET relationships = ? WHERE name = '沈砚'")
      .run(JSON.stringify([{ target: '许渡', relation: '同盟（互相信任）' }]))

    expect(CharacterRelationshipRepository.migrateLegacyRelationships(db)).toBe(1)

    const rel = CharacterRelationshipRepository.getAll(db)[0]
    expect(rel).toMatchObject({ relation: '同盟', description: '互相信任' })
    // 迁移后旧字段是共享关系表的一致投影（旧导出仍可读）。
    expect(JSON.parse(CharacterRepository.getByName('许渡')!.relationships))
      .toEqual([{ target: '沈砚', relation: '同盟（互相信任）' }])
    expect(JSON.parse(CharacterRepository.getByName('沈砚')!.relationships))
      .toEqual([{ target: '许渡', relation: '同盟（互相信任）' }])
  })

  it('migrates an early name-based table to character IDs without losing rows', () => {
    const db = getProjectDb()!

    // 模拟早期未发布版本写下的姓名端点表（含一个当时已不在名单里的旧人物）。
    db.exec(`
      DROP TABLE character_shared_relationships;
      DROP TABLE character_graph_positions;
      DROP TABLE character_identities;
      CREATE TABLE character_shared_relationships (
        id TEXT PRIMARY KEY,
        character1 TEXT NOT NULL,
        character2 TEXT NOT NULL,
        relation TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE character_graph_positions (
        character_name TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        updated_at TEXT
      );
    `)
    db.prepare(`INSERT INTO character_shared_relationships
      (id, character1, character2, relation, description, created_at, updated_at)
      VALUES ('legacy-rel', '许渡', '沈砚', '师徒', '旧版本写入', '2024-01-01', '2024-01-01')`).run()
    db.prepare(`INSERT INTO character_shared_relationships
      (id, character1, character2, relation, description, created_at, updated_at)
      VALUES ('legacy-orphan', '沈砚', '旧人', '旧识', '', '2024-01-01', '2024-01-01')`).run()
    db.prepare("INSERT INTO character_graph_positions (character_name, x, y, updated_at) VALUES ('沈砚', 12, 34, '2024-01-01')").run()

    ensureCharacterRelationshipSchema(db)

    const all = CharacterRelationshipRepository.getAll(db)
    expect(all).toHaveLength(2)
    const migrated = all.find(rel => rel.id === 'legacy-rel')!
    expect([migrated.character1Name, migrated.character2Name].sort()).toEqual(['沈砚', '许渡'])
    expect([migrated.character1Id, migrated.character2Id].sort())
      .toEqual([identityOf('沈砚'), identityOf('许渡')].sort())
    expect(migrated.relation).toBe('师徒')

    // 姓名已不在名单里的旧行同样零丢失地保留下来。
    const orphan = all.find(rel => rel.id === 'legacy-orphan')!
    expect([orphan.character1Name, orphan.character2Name].sort()).toEqual(['旧人', '沈砚'])

    expect(CharacterRelationshipRepository.getGraphPositions(db)[identityOf('沈砚')])
      .toEqual({ x: 12, y: 34 })
  })
})

describe('canvas positions', () => {
  it('stores positions under the character ID and ignores malformed values', () => {
    const xu = identityOf('许渡')
    CharacterRelationshipRepository.saveGraphPositions({
      [xu]: { x: 10.5, y: -20 },
      '': { x: 1, y: 2 },
      broken: { x: Number.NaN, y: 3 },
    })

    expect(CharacterRelationshipRepository.getGraphPositions()).toEqual({ [xu]: { x: 10.5, y: -20 } })
  })
})
