import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { getProjectDb } from '../database'
import {
  classifyRelationshipStorage,
  structuredRelationshipRows,
} from '../../src/shared/relationship-presentation'
import {
  canonicalCharacterPair,
  projectLegacyRelationshipsField,
  projectSharedRelationshipEdge,
  type CharacterGraphPosition,
  type CharacterIdentityMap,
  type CharacterSharedRelationship,
} from '../../src/shared/character-relationship'

export interface CharacterRelationshipRecord {
  id: string
  character1Id: string
  character2Id: string
  relation: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface CharacterRelationshipUpsertInput {
  id?: string
  character1Id: string
  character2Id: string
  relation: string
  description?: string
}

/**
 * 身份/关系/坐标表必须就位才能读写。正常路径由 initProjectDatabase 建表，
 * 但仓储也可能被直接调用（旧写入路径、测试夹具），因此首次使用时兜底建表。
 */
const schemaReadyDatabases = new WeakSet<BetterSqlite3.Database>()

function readyDb(dbInstance?: BetterSqlite3.Database): BetterSqlite3.Database {
  const db = dbInstance ?? getRequiredProjectDb()
  if (!schemaReadyDatabases.has(db)) {
    ensureCharacterRelationshipSchema(db)
    schemaReadyDatabases.add(db)
  }
  return db
}

function getRequiredProjectDb(): BetterSqlite3.Database {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function tableExists(db: BetterSqlite3.Database, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName)
  return Boolean(row)
}

function tableColumns(db: BetterSqlite3.Database, tableName: string): Set<string> {
  if (!tableExists(db, tableName)) return new Set()
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

const IDENTITY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS character_identities (
    character_id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_character_identities_name ON character_identities(name);
`

const SCHEMA_SQL = `${IDENTITY_SCHEMA_SQL}
  CREATE TABLE IF NOT EXISTS character_shared_relationships (
    id TEXT PRIMARY KEY,
    character1_id TEXT NOT NULL,
    character2_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (character1_id <> character2_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_character_shared_pair ON character_shared_relationships(
    CASE WHEN character1_id < character2_id THEN character1_id ELSE character2_id END,
    CASE WHEN character1_id < character2_id THEN character2_id ELSE character1_id END
  );
  CREATE INDEX IF NOT EXISTS idx_character_shared_c1 ON character_shared_relationships(character1_id);
  CREATE INDEX IF NOT EXISTS idx_character_shared_c2 ON character_shared_relationships(character2_id);

  CREATE TABLE IF NOT EXISTS character_graph_positions (
    character_id TEXT PRIMARY KEY,
    x REAL NOT NULL,
    y REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

/**
 * 人物关系/画布 schema。
 *
 * 首次运行时还会把姓名端点（早期未发布版本写入 character1/character2、
 * character_name）安全迁移成人物 ID：先为所有出现过的姓名补齐身份，再搬运数据，
 * 无法映射的行不删除，保证旧项目零丢失。
 */
export function ensureCharacterRelationshipSchema(db: BetterSqlite3.Database): void {
  // 身份表先就位（搬运姓名端点时要用它换 ID），再搬运早期姓名端点表
  //（它会重建同名表），最后确保最终表结构。
  db.exec(IDENTITY_SCHEMA_SQL)
  migrateNameBasedTables(db)
  db.exec(SCHEMA_SQL)
}

/** 早期姓名端点表的搬运（幂等：只在旧列仍存在时执行）。 */
function migrateNameBasedTables(db: BetterSqlite3.Database): void {
  const relationshipColumns = tableColumns(db, 'character_shared_relationships')
  const nameBasedRelationships = relationshipColumns.has('character1') && !relationshipColumns.has('character1_id')
  const positionColumns = tableColumns(db, 'character_graph_positions')
  const nameBasedPositions = positionColumns.has('character_name') && !positionColumns.has('character_id')
  if (!nameBasedRelationships && !nameBasedPositions) return

  const tx = db.transaction(() => {
    const legacyNames = new Set<string>()
    if (nameBasedRelationships) {
      const rows = db.prepare('SELECT character1, character2 FROM character_shared_relationships').all() as
        Array<{ character1: string; character2: string }>
      for (const row of rows) {
        if (row.character1?.trim()) legacyNames.add(row.character1.trim())
        if (row.character2?.trim()) legacyNames.add(row.character2.trim())
      }
    }
    if (nameBasedPositions) {
      const rows = db.prepare('SELECT character_name FROM character_graph_positions').all() as
        Array<{ character_name: string }>
      for (const row of rows) {
        if (row.character_name?.trim()) legacyNames.add(row.character_name.trim())
      }
    }

    // 先把姓名映射成 ID（含只出现在旧表里的姓名，避免搬运时丢行）。
    const identityByName = new Map<string, string>()
    const insertIdentity = db.prepare(`
      INSERT INTO character_identities (character_id, name, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(name) DO NOTHING
    `)
    for (const name of legacyNames) {
      insertIdentity.run(randomUUID(), name)
    }
    for (const row of db.prepare('SELECT name, character_id FROM character_identities').all() as
      Array<{ name: string; character_id: string }>) {
      identityByName.set(row.name, row.character_id)
    }

    if (nameBasedRelationships) {
      const rows = db.prepare(`
        SELECT id, character1, character2, relation, description, created_at, updated_at
        FROM character_shared_relationships
      `).all() as Array<{
        id: string
        character1: string
        character2: string
        relation: string
        description: string
        created_at: string
        updated_at: string
      }>
      db.exec(`
        CREATE TABLE character_shared_relationships_name_legacy (
          id TEXT PRIMARY KEY,
          character1 TEXT NOT NULL,
          character2 TEXT NOT NULL,
          relation TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT,
          updated_at TEXT
        );
      `)
      const insertLegacy = db.prepare(`
        INSERT OR REPLACE INTO character_shared_relationships_name_legacy
          (id, character1, character2, relation, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const row of rows) {
        insertLegacy.run(
          row.id, row.character1, row.character2, row.relation, row.description, row.created_at, row.updated_at,
        )
      }
      db.exec(`
        DROP TABLE character_shared_relationships;
      `)
      db.exec(SCHEMA_SQL)
      const insert = db.prepare(`
        INSERT OR IGNORE INTO character_shared_relationships (
          id, character1_id, character2_id, relation, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const row of rows) {
        const idA = identityByName.get(row.character1?.trim() ?? '')
        const idB = identityByName.get(row.character2?.trim() ?? '')
        if (!idA || !idB || idA === idB) continue
        const [c1, c2] = canonicalCharacterPair(idA, idB)
        insert.run(row.id, c1, c2, row.relation, row.description ?? '', row.created_at, row.updated_at)
      }
      // 搬运完成后旧表只是同一批行的副本，删除不会造成信息丢失。
      db.exec(`
        DROP TABLE character_shared_relationships_name_legacy;
      `)
    }

    if (nameBasedPositions) {
      const rows = db.prepare('SELECT character_name, x, y, updated_at FROM character_graph_positions').all() as
        Array<{ character_name: string; x: number; y: number; updated_at: string }>
      db.exec('DROP TABLE character_graph_positions;')
      db.exec(SCHEMA_SQL)
      const insert = db.prepare(`
        INSERT OR REPLACE INTO character_graph_positions (character_id, x, y, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      for (const row of rows) {
        const characterId = identityByName.get(row.character_name?.trim() ?? '')
        if (!characterId) continue
        insert.run(characterId, row.x, row.y, row.updated_at ?? new Date().toISOString())
      }
    }
  })
  tx()
}

function rowToRecord(row: Record<string, unknown>): CharacterRelationshipRecord {
  return {
    id: row.id as string,
    character1Id: row.character1_id as string,
    character2Id: row.character2_id as string,
    relation: (row.relation as string) || '',
    description: (row.description as string) || '',
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  }
}

export class CharacterRelationshipRepository {
  /** 姓名 → 人物 ID。只包含已建档的人物身份。 */
  static getIdentities(dbInstance?: BetterSqlite3.Database): CharacterIdentityMap {
    const db = readyDb(dbInstance)
    const rows = db.prepare('SELECT name, character_id FROM character_identities').all() as
      Array<{ name: string; character_id: string }>
    return Object.fromEntries(rows.map(row => [row.name, row.character_id]))
  }

  /** 为给定姓名补齐稳定身份（旧项目打开、新建角色落盘后调用）。 */
  static ensureIdentities(names: readonly string[], dbInstance?: BetterSqlite3.Database): CharacterIdentityMap {
    const db = readyDb(dbInstance)
    const insert = db.prepare(`
      INSERT INTO character_identities (character_id, name, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(name) DO NOTHING
    `)
    const tx = db.transaction(() => {
      for (const rawName of names) {
        const name = rawName?.trim()
        if (!name) continue
        insert.run(randomUUID(), name)
      }
    })
    tx()
    return CharacterRelationshipRepository.getIdentities(db)
  }

  /** 以当前 characters 表为准补齐身份；并清理被显式删除的人物身份。 */
  static reconcileIdentities(
    db: BetterSqlite3.Database,
    options: {
      renames?: readonly { originalName: string; newName: string }[]
      deletedNames?: readonly string[]
      /**
       * 角色名单提交在同一个事务里带严格回读校验，那里必须只改身份/关系/坐标，
       * 不重写 characters.relationships（旧字段投影由渲染层与关系写入路径维护）。
       */
      projectLegacyField?: boolean
    } = {},
  ): void {
    ensureCharacterRelationshipSchema(db)
    const projectLegacyField = options.projectLegacyField !== false
    CharacterRelationshipRepository.applyRenames(options.renames ?? [], db)
    for (const name of options.deletedNames ?? []) {
      CharacterRelationshipRepository.deleteCharacterCascade(name, db, { projectLegacyField })
    }
    const rows = db.prepare('SELECT name FROM characters').all() as Array<{ name: string }>
    CharacterRelationshipRepository.ensureIdentities(rows.map(row => row.name), db)

    const deletedNames = options.deletedNames ?? []
    if (projectLegacyField && deletedNames.length > 0) {
      // 被删除人物在别处遗留的旧边同样只是过时投影，随人物一起清理。
      const identities = CharacterRelationshipRepository.getIdentities(db)
      for (const row of rows) {
        const characterId = identities[row.name]
        if (characterId) {
          CharacterRelationshipRepository.projectLegacyFieldFor(characterId, db, { removedNames: deletedNames })
        }
      }
    }
  }

  /**
   * 改名只更新展示名镜像：关系端点与画布坐标都挂在稳定 ID 上，完全不受影响。
   * 交换姓名时先用临时名让出唯一约束。
   */
  static applyRenames(
    renames: readonly { originalName: string; newName: string }[],
    dbInstance?: BetterSqlite3.Database,
  ): void {
    const db = readyDb(dbInstance)
    if (renames.length === 0) return
    const update = db.prepare(`
      UPDATE character_identities SET name = ?, updated_at = datetime('now') WHERE name = ?
    `)
    const tx = db.transaction(() => {
      for (const rename of renames) {
        const original = rename.originalName?.trim()
        const next = rename.newName?.trim()
        if (!original || !next || original === next) continue
        update.run(next, original)
      }
    })
    tx()
  }

  /** 按姓名解析 ID；未建档时返回 null。 */
  static resolveIdentity(name: string, dbInstance?: BetterSqlite3.Database): string | null {
    const db = readyDb(dbInstance)
    const trimmed = name?.trim()
    if (!trimmed) return null
    const row = db.prepare('SELECT character_id FROM character_identities WHERE name = ?').get(trimmed) as
      | { character_id: string }
      | undefined
    return row?.character_id ?? null
  }

  private static decorate(
    rows: CharacterRelationshipRecord[],
    db: BetterSqlite3.Database,
  ): CharacterSharedRelationship[] {
    const idToName = new Map<string, string>()
    for (const row of db.prepare('SELECT name, character_id FROM character_identities').all() as
      Array<{ name: string; character_id: string }>) {
      idToName.set(row.character_id, row.name)
    }
    return rows.map(row => ({
      ...row,
      character1Name: idToName.get(row.character1Id) ?? '',
      character2Name: idToName.get(row.character2Id) ?? '',
    }))
  }

  /** 当前项目全部共用关系（附带由 ID 解析出的展示名）。 */
  static getAll(dbInstance?: BetterSqlite3.Database): CharacterSharedRelationship[] {
    const db = readyDb(dbInstance)
    const rows = db.prepare(`
      SELECT id, character1_id, character2_id, relation, description, created_at, updated_at
      FROM character_shared_relationships
      ORDER BY created_at ASC, id ASC
    `).all() as Record<string, unknown>[]
    return CharacterRelationshipRepository.decorate(rows.map(rowToRecord), db)
  }

  /** 指定人物（ID）的全部共用关系。 */
  static getForCharacterId(characterId: string, dbInstance?: BetterSqlite3.Database): CharacterSharedRelationship[] {
    const db = readyDb(dbInstance)
    const id = characterId?.trim()
    if (!id) return []
    const rows = db.prepare(`
      SELECT id, character1_id, character2_id, relation, description, created_at, updated_at
      FROM character_shared_relationships
      WHERE character1_id = ? OR character2_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(id, id) as Record<string, unknown>[]
    return CharacterRelationshipRepository.decorate(rows.map(rowToRecord), db)
  }

  /** 一对人物之间的唯一共用关系。 */
  static getBetweenIds(
    idA: string,
    idB: string,
    dbInstance?: BetterSqlite3.Database,
  ): CharacterSharedRelationship | null {
    const db = readyDb(dbInstance)
    const a = idA?.trim()
    const b = idB?.trim()
    if (!a || !b || a === b) return null
    const [c1, c2] = canonicalCharacterPair(a, b)
    const row = db.prepare(`
      SELECT id, character1_id, character2_id, relation, description, created_at, updated_at
      FROM character_shared_relationships
      WHERE character1_id = ? AND character2_id = ?
    `).get(c1, c2) as Record<string, unknown> | undefined
    return row ? CharacterRelationshipRepository.decorate([rowToRecord(row)], db)[0] : null
  }

  /** 两个人之间只有一条共用关系：已存在则更新，绝不新增重复连线。 */
  static upsert(
    input: CharacterRelationshipUpsertInput,
    dbInstance?: BetterSqlite3.Database,
  ): CharacterSharedRelationship {
    const db = readyDb(dbInstance)
    const a = input.character1Id?.trim()
    const b = input.character2Id?.trim()
    if (!a || !b) throw new Error('人物 ID 不能为空')
    if (a === b) throw new Error('不能与自身建立关系')
    const relation = input.relation?.trim()
    if (!relation) throw new Error('关系名称不能为空')
    const description = (input.description ?? '').trim()
    if (!CharacterRelationshipRepository.resolveIdentityById(a, db)) throw new Error('关系端点人物不存在')
    if (!CharacterRelationshipRepository.resolveIdentityById(b, db)) throw new Error('关系端点人物不存在')

    const [character1Id, character2Id] = canonicalCharacterPair(a, b)
    const existing = CharacterRelationshipRepository.getBetweenIds(character1Id, character2Id, db)
    const id = existing?.id ?? input.id ?? randomUUID()
    const now = new Date().toISOString()

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO character_shared_relationships (
          id, character1_id, character2_id, relation, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          character1_id = excluded.character1_id,
          character2_id = excluded.character2_id,
          relation = excluded.relation,
          description = excluded.description,
          updated_at = excluded.updated_at
      `).run(id, character1Id, character2Id, relation, description, existing?.createdAt || now, now)

      CharacterRelationshipRepository.projectLegacyFieldFor(character1Id, db)
      CharacterRelationshipRepository.projectLegacyFieldFor(character2Id, db)
    })
    tx()

    return {
      id,
      character1Id,
      character2Id,
      character1Name: CharacterRelationshipRepository.nameForId(character1Id, db) ?? '',
      character2Name: CharacterRelationshipRepository.nameForId(character2Id, db) ?? '',
      relation,
      description,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
  }

  private static resolveIdentityById(characterId: string, db: BetterSqlite3.Database): boolean {
    const row = db.prepare('SELECT 1 AS found FROM character_identities WHERE character_id = ?').get(characterId)
    return Boolean(row)
  }

  private static nameForId(characterId: string, db: BetterSqlite3.Database): string | null {
    const row = db.prepare('SELECT name FROM character_identities WHERE character_id = ?').get(characterId) as
      | { name: string }
      | undefined
    return row?.name ?? null
  }

  /** 删除一条共用关系。 */
  static delete(id: string, dbInstance?: BetterSqlite3.Database): void {
    const db = readyDb(dbInstance)
    const existing = db.prepare(
      'SELECT character1_id, character2_id FROM character_shared_relationships WHERE id = ?',
    ).get(id) as { character1_id: string; character2_id: string } | undefined
    if (!existing) return

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM character_shared_relationships WHERE id = ?').run(id)
      CharacterRelationshipRepository.projectLegacyFieldFor(existing.character1_id, db)
      CharacterRelationshipRepository.projectLegacyFieldFor(existing.character2_id, db)
    })
    tx()
  }

  /** 删除两个人物之间的共用关系。 */
  static deleteBetweenIds(idA: string, idB: string, dbInstance?: BetterSqlite3.Database): void {
    const existing = CharacterRelationshipRepository.getBetweenIds(idA, idB, dbInstance)
    if (existing) CharacterRelationshipRepository.delete(existing.id, dbInstance)
  }

  /** 人物被删除：按 ID 级联清理身份、关系与画布坐标。 */
  static deleteCharacterCascade(
    name: string,
    dbInstance?: BetterSqlite3.Database,
    options: { projectLegacyField?: boolean } = {},
  ): void {
    const db = readyDb(dbInstance)
    const trimmed = name?.trim()
    if (!trimmed) return
    const characterId = CharacterRelationshipRepository.resolveIdentity(trimmed, db)
    if (!characterId) return
    const projectLegacyField = options.projectLegacyField !== false

    const affected = CharacterRelationshipRepository.getForCharacterId(characterId, db)
      .map(rel => (rel.character1Id === characterId ? rel.character2Id : rel.character1Id))

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM character_shared_relationships WHERE character1_id = ? OR character2_id = ?')
        .run(characterId, characterId)
      db.prepare('DELETE FROM character_graph_positions WHERE character_id = ?').run(characterId)
      db.prepare('DELETE FROM character_identities WHERE character_id = ?').run(characterId)
      if (!projectLegacyField) return
      for (const otherId of affected) {
        // 被删除人物的展示名作为“已过期目标”传入：相关旧边随人物一起从投影里消失。
        CharacterRelationshipRepository.projectLegacyFieldFor(otherId, db, { removedNames: [trimmed] })
      }
    })
    tx()
  }

  /** 全部画布坐标，主键是人物 ID。 */
  static getGraphPositions(dbInstance?: BetterSqlite3.Database): Record<string, CharacterGraphPosition> {
    const db = readyDb(dbInstance)
    const rows = db.prepare('SELECT character_id, x, y FROM character_graph_positions').all() as
      Array<{ character_id: string; x: number; y: number }>
    const result: Record<string, CharacterGraphPosition> = {}
    for (const row of rows) result[row.character_id] = { x: row.x, y: row.y }
    return result
  }

  /** 批量保存画布坐标（按人物 ID）。 */
  static saveGraphPositions(
    positions: Record<string, CharacterGraphPosition>,
    dbInstance?: BetterSqlite3.Database,
  ): void {
    const db = readyDb(dbInstance)
    const now = new Date().toISOString()
    const stmt = db.prepare(`
      INSERT INTO character_graph_positions (character_id, x, y, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        updated_at = excluded.updated_at
    `)
    const tx = db.transaction(() => {
      for (const [characterId, position] of Object.entries(positions)) {
        if (
          characterId.trim()
          && typeof position?.x === 'number' && Number.isFinite(position.x)
          && typeof position?.y === 'number' && Number.isFinite(position.y)
        ) {
          stmt.run(characterId.trim(), position.x, position.y, now)
        }
      }
    })
    tx()
  }

  /**
   * 把共享关系表投影回旧 characters.relationships 字段（旧导出兼容）。
   * 旧字段里若还有未迁移 / 冲突 / 自由文本内容，保持原样不动。
   */
  static projectLegacyFieldFor(
    characterId: string,
    dbInstance?: BetterSqlite3.Database,
    options: { removedNames?: readonly string[] } = {},
  ): void {
    const db = readyDb(dbInstance)
    const id = characterId?.trim()
    if (!id) return
    const name = CharacterRelationshipRepository.nameForId(id, db)
    if (!name) return
    const row = db.prepare('SELECT relationships FROM characters WHERE name = ?').get(name) as
      | { relationships?: string }
      | undefined
    if (!row) return

    const edges = CharacterRelationshipRepository.getForCharacterId(id, db)
      .map(rel => projectSharedRelationshipEdge(rel, id))
      .filter((edge): edge is { target: string; relation: string } => edge !== null)
    const knownNames = db.prepare('SELECT name FROM characters').all() as Array<{ name: string }>

    const projected = projectLegacyRelationshipsField(row.relationships ?? '', edges, {
      knownNames: knownNames.map(entry => entry.name),
      removedNames: options.removedNames,
    })
    if (projected === null || projected === (row.relationships ?? '')) return
    db.prepare(`
      UPDATE characters SET relationships = ?, updated_at = datetime('now') WHERE name = ?
    `).run(projected, name)
  }

  /**
   * 增量迁移旧结构化关系。
   *
   * 每次打开/保存都可重复执行：按人物 ID 对去重，已存在的一对绝不重复插入；
   * 共享表里已有新关系也不影响其他人物遗留旧关系的迁移。无法解析、目标不存在
   * 或与现有共享关系冲突的旧数据一律不迁移，保留在旧字段里作为证据。
   */
  static migrateLegacyRelationships(
    db: BetterSqlite3.Database,
    options: { projectLegacyField?: boolean } = {},
  ): number {
    ensureCharacterRelationshipSchema(db)
    const characters = db.prepare('SELECT name, relationships FROM characters').all() as
      Array<{ name: string; relationships: string }>
    if (characters.length === 0) return 0

    CharacterRelationshipRepository.ensureIdentities(characters.map(row => row.name), db)
    const identityByName = CharacterRelationshipRepository.getIdentities(db)

    const insert = db.prepare(`
      INSERT OR IGNORE INTO character_shared_relationships (
        id, character1_id, character2_id, relation, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    const knownNames = new Set(characters.map(row => row.name.trim()))
    let migrated = 0

    const tx = db.transaction(() => {
      for (const character of characters) {
        const raw = (character.relationships ?? '').trim()
        if (!raw) continue
        // 纯文本旧关系是历史证据，绝不猜测成关系。
        if (classifyRelationshipStorage(raw) === 'legacy') continue
        const edges = structuredRelationshipRows(raw) ?? []
        if (edges.length === 0) continue

        const ownerName = character.name.trim()
        const ownerId = identityByName[ownerName]
        if (!ownerId) continue

        for (const edge of edges) {
          const target = edge.target.trim()
          const relationText = edge.relation.trim()
          if (!target || !relationText || target === ownerName || !knownNames.has(target)) continue
          const targetId = identityByName[target]
          if (!targetId || targetId === ownerId) continue

          const [character1Id, character2Id] = canonicalCharacterPair(ownerId, targetId)
          // 一对人物只有一条关系：已存在就视为已迁移，不覆盖、不重复。
          const existing = db.prepare(`
            SELECT id FROM character_shared_relationships
            WHERE character1_id = ? AND character2_id = ?
          `).get(character1Id, character2Id)
          if (existing) continue

          const match = relationText.match(/^(.+?)[（(](.+?)[）)]$/)
          const relation = match ? match[1].trim() : relationText
          const description = match ? match[2].trim() : ''
          const result = insert.run(randomUUID(), character1Id, character2Id, relation, description)
          if (result.changes > 0) {
            migrated += 1
            if (options.projectLegacyField !== false) {
              CharacterRelationshipRepository.projectLegacyFieldFor(character1Id, db)
              CharacterRelationshipRepository.projectLegacyFieldFor(character2Id, db)
            }
          }
        }
      }
    })
    tx()
    return migrated
  }
}
