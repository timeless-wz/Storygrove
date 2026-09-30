/**
 * BlueprintDetailRepository — 章节蓝图 v2 细纲（blueprint_details 表）。
 *
 * docs/blueprint-v2-contract.md §5/§6/§7：
 * - 分镜正文、规则、禁忌、检查条目的唯一权威；`blueprints` v1 字段只接收 §6.3 投影；
 * - 乐观并发（baseRevision），冲突拒绝写入并回报 currentRevision；
 * - 写入事务：blueprint_details + v1 投影列同事务，事务内回读校验，任何不一致回滚；
 * - 读取容错：detail_json 损坏 / schema 超前时返回 unreadable 状态并附 raw_markdown，
 *   绝不静默丢弃；只有显式删除能清掉该行。
 * - 红线 1：永不写 blueprints.notes / notes_updated_at / user_guidance。
 */
import {
  BLUEPRINT_V2_SCHEMA_VERSION,
  MAX_BLUEPRINT_V2_RAW_MARKDOWN,
  assertValidChapterBlueprintV2Content,
  canonicalBlueprintV2JsonStringify,
  computeBlueprintV2ContentHash,
  extractBlueprintV2WordBudget,
  getBlueprintV2Scenes,
  projectV2ToV1,
  reorderBlueprintV2Scenes,
} from '../../src/shared/blueprint-v2'
import { serializeChapterBlueprintV2 } from '../../src/shared/blueprint-v2-markdown'
import type {
  ChapterBlueprintV2Content,
  ChapterBlueprintV2Detail,
  ChapterBlueprintV2SaveInput,
  ChapterBlueprintV2Summary,
  ChapterBlueprintV2Unreadable,
} from '../../src/shared/blueprint-v2'
import { getProjectDb } from '../database'

export const BLUEPRINT_DETAILS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS blueprint_details (
    chapter_number INTEGER PRIMARY KEY,          -- 与 blueprints.chapter_number 一一对应
    schema_version INTEGER NOT NULL DEFAULT 2,
    detail_json   TEXT NOT NULL,                 -- ChapterBlueprintV2Detail 的 canonical JSON
    raw_markdown  TEXT NOT NULL,                 -- 最近一次导入/规范导出的完整原文，逐字，供核对
    revision      INTEGER NOT NULL,              -- 冗余列：免解析 JSON 的乐观并发/摘要读取
    content_hash  TEXT NOT NULL,                 -- 冗余列：同上
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );
`

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

interface DetailRow {
  chapter_number: number
  schema_version: number
  detail_json: string
  raw_markdown: string
  revision: number
  content_hash: string
  created_at: string
  updated_at: string
}

interface BlueprintV1Row {
  chapter_number: number
  title: string
  role: string
  purpose: string
  key_events: string
  characters: string
  suspense_hook: string
  user_guidance: string
  notes: string
  notes_updated_at: string
}

export interface BlueprintDetailSaveResult {
  success: boolean
  revision?: number
  contentHash?: string
  conflict?: boolean
  currentRevision?: number
  error?: string
}

export interface BlueprintDetailSceneOrderInput {
  chapterNumber: number
  baseRevision: number
  orderedSceneIds: string[]
}

function requireProjectDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

/** 沿用库内 CREATE TABLE IF NOT EXISTS 惯例；database.ts 打开项目时与仓库方法都会调用。 */
export function ensureBlueprintDetailSchema(db: ProjectDatabase): void {
  db.exec(BLUEPRINT_DETAILS_SCHEMA_SQL)
}

/** 与 SQLite datetime('now') 同格式（UTC，秒级），保证列值与 detail_json 时间戳一致。 */
function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function readDetailRow(db: ProjectDatabase, chapterNumber: number): DetailRow | undefined {
  return db.prepare(`
    SELECT chapter_number, schema_version, detail_json, raw_markdown,
           revision, content_hash, created_at, updated_at
    FROM blueprint_details
    WHERE chapter_number = ?
  `).get(chapterNumber) as DetailRow | undefined
}

function parseDetailContent(row: DetailRow): ChapterBlueprintV2Content {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.detail_json)
  } catch {
    throw new Error(`第 ${row.chapter_number} 章细纲 detail_json 已损坏`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`第 ${row.chapter_number} 章细纲 detail_json 结构无效`)
  }
  const candidate = parsed as ChapterBlueprintV2Content
  if (candidate.schemaVersion !== BLUEPRINT_V2_SCHEMA_VERSION
    || typeof candidate.chapterNumber !== 'number'
    || !Array.isArray(candidate.sections)) {
    throw new Error(`第 ${row.chapter_number} 章细纲 detail_json 结构无效`)
  }
  return candidate
}

/** detail_json 中还含 revision/contentHash 等服务端字段；与保存输入比较时只取内容字段。 */
function contentFieldsOnly(detail: ChapterBlueprintV2Content): ChapterBlueprintV2Content {
  return {
    schemaVersion: detail.schemaVersion,
    chapterNumber: detail.chapterNumber,
    chapterTitle: detail.chapterTitle,
    ...(detail.chapterTitleLevel !== undefined ? { chapterTitleLevel: detail.chapterTitleLevel } : {}),
    docPreamble: detail.docPreamble,
    ...(detail.chapterPostamble !== undefined ? { chapterPostamble: detail.chapterPostamble } : {}),
    sections: detail.sections,
    origin: detail.origin,
  }
}

function rowToBlueprintData(row: BlueprintV1Row) {
  let characters: string[] = []
  try { characters = JSON.parse(row.characters) } catch { /* 容错：空数组兜底 */ }
  if (!Array.isArray(characters)) characters = []
  return {
    chapterNumber: row.chapter_number,
    title: row.title,
    role: row.role,
    purpose: row.purpose,
    keyEvents: row.key_events,
    characters,
    suspenseHook: row.suspense_hook,
    userGuidance: row.user_guidance,
    notes: row.notes,
    notesUpdatedAt: row.notes_updated_at,
  }
}

const EMPTY_V1_BLUEPRINT = (chapterNumber: number) => ({
  chapterNumber,
  title: '',
  role: '',
  purpose: '',
  keyEvents: '',
  characters: [] as string[],
  suspenseHook: '',
  userGuidance: '',
  notes: '',
  notesUpdatedAt: '',
})

function readBlueprintV1Row(db: ProjectDatabase, chapterNumber: number): BlueprintV1Row | undefined {
  return db.prepare(`
    SELECT chapter_number, title, role, purpose, key_events, characters,
           suspense_hook, user_guidance, notes, notes_updated_at
    FROM blueprints
    WHERE chapter_number = ?
  `).get(chapterNumber) as BlueprintV1Row | undefined
}

function assertSaveInput(input: ChapterBlueprintV2SaveInput): void {
  if (!input || typeof input !== 'object') throw new Error('细纲保存输入无效')
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) {
    throw new Error('细纲保存章节号无效')
  }
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error('细纲保存 baseRevision 无效（0 = 期望不存在）')
  }
  assertValidChapterBlueprintV2Content(input.content)
  if (input.content.chapterNumber !== input.chapterNumber) {
    throw new Error(`细纲内容章节号（${input.content.chapterNumber}）与目标章（${input.chapterNumber}）不一致`)
  }
}

function assertSceneOrderInput(input: BlueprintDetailSceneOrderInput): void {
  if (!input || typeof input !== 'object') throw new Error('分镜重排输入无效')
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) {
    throw new Error('分镜重排章节号无效')
  }
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error('分镜重排 baseRevision 无效（0 = 期望不存在）')
  }
  if (!Array.isArray(input.orderedSceneIds) || input.orderedSceneIds.some(id => typeof id !== 'string' || !id)) {
    throw new Error('分镜重排列表无效')
  }
}

/**
 * 事务内写入 detail 行 + v1 投影，并回读校验。冲突返回结果对象，其余失败抛错
 * （由事务回滚，revision 不变；契约 §7.1/§7.2）。
 */
function writeDetailWithinTransaction(
  db: ProjectDatabase,
  rawInput: ChapterBlueprintV2SaveInput,
): BlueprintDetailSaveResult {
  // 调用方（如 saveSceneOrder）传入的 content 可能带着从 detail_json 解析出的
  // 服务端字段；先裁剪为纯内容，保证 detail_json 与回读比较的形状稳定。
  const input: ChapterBlueprintV2SaveInput = {
    chapterNumber: rawInput.chapterNumber,
    baseRevision: rawInput.baseRevision,
    content: contentFieldsOnly(rawInput.content),
  }
  const row = readDetailRow(db, input.chapterNumber)
  if (row) {
    if (input.baseRevision === 0 || row.revision !== input.baseRevision) {
      return {
        success: false,
        conflict: true,
        currentRevision: row.revision,
        error: `第 ${input.chapterNumber} 章细纲已被其他修改更新（当前 revision ${row.revision}），已拒绝写入`,
      }
    }
  } else if (input.baseRevision !== 0) {
    return {
      success: false,
      conflict: true,
      currentRevision: 0,
      error: `第 ${input.chapterNumber} 章还没有 v2 细纲，baseRevision 必须为 0`,
    }
  }

  const revision = (row?.revision ?? 0) + 1
  const now = sqliteNow()
  const contentHash = computeBlueprintV2ContentHash(input.content)
  const detail: ChapterBlueprintV2Detail = {
    ...input.content,
    revision,
    contentHash,
    createdAt: row?.created_at ?? now,
    updatedAt: now,
  }
  // detail_json 不含 rawMarkdown（原文只存 raw_markdown 列，避免同值双写）。
  const detailJson = canonicalBlueprintV2JsonStringify({ ...detail, rawMarkdown: undefined })
  const rawMarkdown = serializeChapterBlueprintV2(input.content)
  if (rawMarkdown.length > MAX_BLUEPRINT_V2_RAW_MARKDOWN) {
    throw new Error(`细纲规范导出超限：${rawMarkdown.length} > ${MAX_BLUEPRINT_V2_RAW_MARKDOWN} 字符`)
  }

  db.prepare(`
    INSERT INTO blueprint_details (
      chapter_number, schema_version, detail_json, raw_markdown,
      revision, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chapter_number) DO UPDATE SET
      schema_version = excluded.schema_version,
      detail_json = excluded.detail_json,
      raw_markdown = excluded.raw_markdown,
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at
  `).run(
    input.chapterNumber,
    BLUEPRINT_V2_SCHEMA_VERSION,
    detailJson,
    rawMarkdown,
    revision,
    contentHash,
    detail.createdAt,
    detail.updatedAt,
  )

  // 契约 §6.3：同一事务内、且仅更新 blueprints 的四列投影（空推导保持旧值）。
  const v1Row = readBlueprintV1Row(db, input.chapterNumber)
  const projection = projectV2ToV1(
    input.content,
    v1Row ? rowToBlueprintData(v1Row) : EMPTY_V1_BLUEPRINT(input.chapterNumber),
  )
  if (v1Row) {
    db.prepare(`
      UPDATE blueprints
      SET title = ?, purpose = ?, key_events = ?, suspense_hook = ?, updated_at = ?
      WHERE chapter_number = ?
    `).run(projection.title, projection.purpose, projection.keyEvents, projection.suspenseHook, now, input.chapterNumber)
  } else {
    // 该章没有 v1 行：以表默认值补建投影行（role/characters/notes/user_guidance 取
    // 默认），保证导入的细纲在 v1 蓝图列表可见；绝不触碰任何既有 v1 数据。
    db.prepare(`
      INSERT INTO blueprints (chapter_number, title, purpose, key_events, suspense_hook)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.chapterNumber, projection.title, projection.purpose, projection.keyEvents, projection.suspenseHook)
  }

  // 事务内回读校验（契约 §7.1：保存失败 → 回滚，revision 不变）。
  const readBack = readDetailRow(db, input.chapterNumber)
  if (!readBack
    || readBack.revision !== revision
    || readBack.content_hash !== contentHash
    || readBack.raw_markdown !== rawMarkdown) {
    throw new Error(`第 ${input.chapterNumber} 章细纲保存回读不一致，已回滚`)
  }
  const readBackContent = parseDetailContent(readBack)
  if (readBackContent.chapterNumber !== input.chapterNumber
    || canonicalBlueprintV2JsonStringify(contentFieldsOnly(readBackContent))
      !== canonicalBlueprintV2JsonStringify(input.content)) {
    throw new Error(`第 ${input.chapterNumber} 章细纲内容回读不一致，已回滚`)
  }
  const v1ReadBack = readBlueprintV1Row(db, input.chapterNumber)
  if (!v1ReadBack
    || v1ReadBack.title !== projection.title
    || v1ReadBack.purpose !== projection.purpose
    || v1ReadBack.key_events !== projection.keyEvents
    || v1ReadBack.suspense_hook !== projection.suspenseHook) {
    throw new Error(`第 ${input.chapterNumber} 章蓝图投影回读不一致，已回滚`)
  }

  return { success: true, revision, contentHash }
}

export class BlueprintDetailRepository {
  /**
   * 单章完整读取。null = 该章暂无 v2 细纲（v1 字段照常可用）；DB 故障抛错（沿用
   * chapter-context 的 load-error 模式）；detail_json 损坏 / schema 超前返回 unreadable。
   */
  static get(chapterNumber: number): ChapterBlueprintV2Detail | ChapterBlueprintV2Unreadable | null {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      throw new Error('章节号无效')
    }
    const db = requireProjectDb()
    ensureBlueprintDetailSchema(db)
    const row = readDetailRow(db, chapterNumber)
    if (!row) return null
    if (row.schema_version > BLUEPRINT_V2_SCHEMA_VERSION) {
      return {
        unreadable: 'needs-newer-app',
        rawMarkdown: row.raw_markdown,
        message: `第 ${chapterNumber} 章细纲由更新版本应用写入（schema ${row.schema_version}），请升级后读取`,
        storedSchemaVersion: row.schema_version,
      }
    }
    try {
      const content = parseDetailContent(row)
      return {
        ...content,
        revision: row.revision,
        contentHash: row.content_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        rawMarkdown: row.raw_markdown,
      }
    } catch (error) {
      return {
        unreadable: 'corrupt',
        rawMarkdown: row.raw_markdown,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 轻量摘要列表（契约 §5.2）：绝不含分镜正文 / rawMarkdown。载荷只到主进程为止，
   * 由本方法解析 JSON 后裁剪；损坏行以 unreadable 标记显式呈现（缺口 §13.7）。
   */
  static getSummaryList(): ChapterBlueprintV2Summary[] {
    const db = requireProjectDb()
    ensureBlueprintDetailSchema(db)
    const rows = db.prepare(`
      SELECT chapter_number, schema_version, detail_json, revision, content_hash, updated_at
      FROM blueprint_details
      ORDER BY chapter_number ASC
    `).all() as Array<DetailRow>
    return rows.map((row): ChapterBlueprintV2Summary => {
      if (row.schema_version > BLUEPRINT_V2_SCHEMA_VERSION) {
        return {
          chapterNumber: row.chapter_number,
          revision: row.revision,
          contentHash: row.content_hash,
          origin: 'import',
          updatedAt: row.updated_at,
          sceneCount: 0,
          sceneTitles: [],
          wordBudget: null,
          unreadable: 'needs-newer-app',
        }
      }
      try {
        const content = parseDetailContent(row)
        const scenes = getBlueprintV2Scenes(content)
        return {
          chapterNumber: row.chapter_number,
          revision: row.revision,
          contentHash: row.content_hash,
          origin: content.origin,
          updatedAt: row.updated_at,
          sceneCount: scenes.length,
          sceneTitles: scenes.map(scene => scene.title),
          wordBudget: extractBlueprintV2WordBudget(content),
        }
      } catch {
        return {
          chapterNumber: row.chapter_number,
          revision: row.revision,
          contentHash: row.content_hash,
          origin: 'import',
          updatedAt: row.updated_at,
          sceneCount: 0,
          sceneTitles: [],
          wordBudget: null,
          unreadable: 'corrupt',
        }
      }
    })
  }

  /** 保存（乐观并发 + 投影事务）。冲突返回 conflict 结果；校验/DB 失败抛错并整体回滚。 */
  static save(input: ChapterBlueprintV2SaveInput): BlueprintDetailSaveResult {
    assertSaveInput(input)
    const db = requireProjectDb()
    ensureBlueprintDetailSchema(db)
    const tx = db.transaction(() => writeDetailWithinTransaction(db, input))
    return tx()
  }

  /** 拖动重排专用：仅改 storyboard 条目位次（契约 §8.3），投影（keyEvents 顺序）同事务刷新。 */
  static saveSceneOrder(input: BlueprintDetailSceneOrderInput): BlueprintDetailSaveResult {
    assertSceneOrderInput(input)
    const db = requireProjectDb()
    ensureBlueprintDetailSchema(db)
    const tx = db.transaction(() => {
      const row = readDetailRow(db, input.chapterNumber)
      if (!row) {
        return {
          success: false,
          conflict: true,
          currentRevision: 0,
          error: `第 ${input.chapterNumber} 章还没有 v2 细纲，无法重排分镜`,
        }
      }
      if (row.revision !== input.baseRevision) {
        return {
          success: false,
          conflict: true,
          currentRevision: row.revision,
          error: `第 ${input.chapterNumber} 章细纲已被其他修改更新（当前 revision ${row.revision}），已拒绝重排`,
        }
      }
      const content = reorderBlueprintV2Scenes(parseDetailContent(row), input.orderedSceneIds)
      return writeDetailWithinTransaction(db, {
        chapterNumber: input.chapterNumber,
        baseRevision: row.revision,
        content,
      })
    })
    return tx()
  }

  /** 仅删 detail 行；blueprints v1 字段保持删除前的投影值，画布卡片保留（契约 §7.3）。 */
  static delete(chapterNumber: number): void {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      throw new Error('章节号无效')
    }
    const db = requireProjectDb()
    ensureBlueprintDetailSchema(db)
    db.prepare('DELETE FROM blueprint_details WHERE chapter_number = ?').run(chapterNumber)
  }

  /** 守卫查询（契约 §7.4）：这些章已有 v2 细纲，v1 写入流程必须先过滤。 */
  static chaptersWithDetails(chapterNumbers: readonly number[]): Set<number> {
    const result = new Set<number>()
    const unique = [...new Set(chapterNumbers)].filter(Number.isSafeInteger)
    if (unique.length === 0) return result
    const db = requireProjectDb()
    ensureBlueprintDetailSchema(db)
    const placeholders = unique.map(() => '?').join(', ')
    const rows = db.prepare(
      `SELECT chapter_number FROM blueprint_details WHERE chapter_number IN (${placeholders})`,
    ).all(...unique) as Array<{ chapter_number: number }>
    for (const row of rows) result.add(row.chapter_number)
    return result
  }

  /** 项目清理（blueprints 范围）调用：调用方拥有外层事务。 */
  static clearAllWithinTransaction(db: ProjectDatabase): void {
    ensureBlueprintDetailSchema(db)
    db.prepare('DELETE FROM blueprint_details').run()
  }
}
