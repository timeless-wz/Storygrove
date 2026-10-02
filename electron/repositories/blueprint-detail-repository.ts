/**
 * BlueprintDetailRepository — 章节蓝图 v2 细纲（blueprint_details 表）。
 *
 * 契约（docs/blueprint-v2-contract.md §5/§6/§7）：
 * - save 在同一事务内写 blueprint_details + 按 §6.3 更新 blueprints 投影四列
 *   （推导值为空 → 保持旧值）；永不写 user_guidance / notes / notes_updated_at / role / characters。
 * - 乐观并发：baseRevision ≠ 当前 revision → conflict，拒绝写入。
 * - 读取容错：detail_json 损坏或 schema_version 超前 → 附加 readStatus 并附上
 *   raw_markdown 原文，绝不静默丢弃（契约 §5.1/§13.5）。
 * - 换行统一为 LF（契约允许的唯一归一化）。
 */

import { getProjectDb } from '../database'
import {
  MAX_BLUEPRINT_V2_SCENE_TITLE,
  BLUEPRINT_V2_SCHEMA_VERSION,
  assertValidChapterBlueprintV2Content,
  buildBlueprintV2MigrationContent,
  computeBlueprintV2ContentHash,
  getBlueprintV2Scenes,
  moveBlueprintV2Scene,
  projectV2ToV1,
  extractBlueprintV2WordBudget,
  type ChapterBlueprintV2Detail,
  type ChapterBlueprintV2DetailRead,
  type ChapterBlueprintV2SaveInput,
  type ChapterBlueprintV2Summary,
} from '../../src/shared/blueprint-v2'
import {
  assertNoLossOnSerialize,
  serializeChapterBlueprintV2,
} from '../../src/shared/blueprint-v2-markdown'
import type { BlueprintData } from './blueprint-repository'

interface BlueprintDetailRow {
  chapter_number: number
  schema_version: number
  detail_json: string
  raw_markdown: string
  revision: number
  content_hash: string
  created_at: string
  updated_at: string
}

export interface BlueprintV2SaveResult {
  success: boolean
  revision?: number
  contentHash?: string
  conflict?: boolean
  currentRevision?: number
  error?: string
}

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function ensureReviewNoticeSchema(db: NonNullable<ReturnType<typeof getProjectDb>>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blueprint_detail_review_notices (
      chapter_number INTEGER PRIMARY KEY,
      notices_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function requireChapterNumber(chapterNumber: number): number {
  if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
    throw new Error('章节细纲章节号无效')
  }
  return chapterNumber
}

function rowToDetailRead(row: BlueprintDetailRow): ChapterBlueprintV2DetailRead {
  const base = {
    chapterNumber: row.chapter_number,
    revision: row.revision,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.detail_json)
  } catch {
    // detail_json 损坏：附上 raw_markdown 原文，绝不静默丢弃（契约 §5.1）。
    return {
      ...emptyDetailShape(base),
      schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
      readStatus: 'corrupt',
      rawMarkdown: row.raw_markdown,
    }
  }
  const record = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : {}) as Record<string, unknown>
  const storedSchemaVersion = Number(record.schemaVersion ?? row.schema_version)
  if (!Number.isSafeInteger(storedSchemaVersion) || storedSchemaVersion > BLUEPRINT_V2_SCHEMA_VERSION) {
    return {
      ...emptyDetailShape(base),
      schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
      readStatus: 'needs-newer-app',
      rawMarkdown: row.raw_markdown,
      storedSchemaVersion: Number.isSafeInteger(storedSchemaVersion) ? storedSchemaVersion : row.schema_version,
    }
  }
  // 正常读取：以 DB 冗余列的 revision/contentHash/时间为准，行内 JSON 仅为内容。
  const detail = {
    schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
    chapterNumber: row.chapter_number,
    chapterTitle: typeof record.chapterTitle === 'string' ? record.chapterTitle : '',
    docPreamble: typeof record.docPreamble === 'string' ? record.docPreamble : '',
    sections: Array.isArray(record.sections) ? record.sections : [],
    origin: record.origin === 'manual' || record.origin === 'upgrade' ? record.origin : 'import',
    revision: row.revision,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as ChapterBlueprintV2DetailRead
  if (typeof record.chapterTitleLevel === 'number') detail.chapterTitleLevel = record.chapterTitleLevel
  if (typeof record.chapterPostamble === 'string') detail.chapterPostamble = record.chapterPostamble
  return detail
}

function emptyDetailShape(base: {
  chapterNumber: number
  revision: number
  contentHash: string
  createdAt: string
  updatedAt: string
}): ChapterBlueprintV2DetailRead {
  return {
    schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
    chapterNumber: base.chapterNumber,
    chapterTitle: '',
    docPreamble: '',
    sections: [],
    origin: 'import',
    revision: base.revision,
    contentHash: base.contentHash,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  }
}

function rowToSummary(row: BlueprintDetailRow): ChapterBlueprintV2Summary | null {
  // 轻量摘要：解析 JSON 只为提取计数与标题；载荷绝不含分镜正文 / rawMarkdown。
  let record: Record<string, unknown>
  try {
    const parsed = JSON.parse(row.detail_json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    record = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const sections = Array.isArray(record.sections) ? record.sections : []
  const storyboard = sections.find(
    section => (section as { kind?: string; id?: string }).kind === 'canonical'
      && (section as { id?: string }).id === 'storyboard',
  ) as { items?: Array<{ kind?: string; title?: string }> } | undefined
  const sceneTitles = (storyboard?.items ?? [])
    .filter(item => item.kind === 'scene')
    .map(item => typeof item.title === 'string' ? item.title.slice(0, MAX_BLUEPRINT_V2_SCENE_TITLE) : '')
    .filter(Boolean)
  const origin = record.origin === 'manual' || record.origin === 'upgrade' ? record.origin : 'import'
  return {
    chapterNumber: row.chapter_number,
    revision: row.revision,
    contentHash: row.content_hash,
    origin,
    updatedAt: row.updated_at,
    sceneCount: sceneTitles.length,
    sceneTitles: sceneTitles.slice(0, 8),
    wordBudget: extractBlueprintV2WordBudget(record as unknown as Parameters<typeof extractBlueprintV2WordBudget>[0]),
  }
}

/** 轻量摘要列表（契约 §5.2）：绝不含分镜正文与 rawMarkdown。 */
export class BlueprintDetailRepository {
  static get(chapterNumber: number): ChapterBlueprintV2DetailRead | null {
    const db = requireDb()
    requireChapterNumber(chapterNumber)
    const row = db.prepare(
      'SELECT * FROM blueprint_details WHERE chapter_number = ?',
    ).get(chapterNumber) as BlueprintDetailRow | undefined
    if (!row) return null
    ensureReviewNoticeSchema(db)
    const detail = rowToDetailRead(row)
    const reviewRow = db.prepare(
      'SELECT notices_json FROM blueprint_detail_review_notices WHERE chapter_number = ?',
    ).get(chapterNumber) as { notices_json: string } | undefined
    if (reviewRow) {
      try {
        const notices = JSON.parse(reviewRow.notices_json)
        if (Array.isArray(notices)) {
          detail.reviewNotices = notices.filter((notice): notice is { oldName: string; newName: string; createdAt: string } => (
            !!notice && typeof notice === 'object'
            && typeof notice.oldName === 'string' && typeof notice.newName === 'string'
            && typeof notice.createdAt === 'string'
          ))
        }
      } catch {
        detail.reviewNotices = [{ oldName: '', newName: '', createdAt: '' }]
      }
    }
    return detail
  }

  /**
   * 角色改名只更新受控的角色名单字段。若旧名出现在 Markdown 中，仅记录
   * 人工核对提示，不尝试判断语义或替换正文里的同名词。
   */
  static markCharacterRenameReview(
    renames: ReadonlyArray<{ originalName: string; newName: string }>,
    db: NonNullable<ReturnType<typeof getProjectDb>> = requireDb(),
  ): void {
    if (renames.length === 0) return
    const detailTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blueprint_details'",
    ).get()
    if (!detailTable) return
    ensureReviewNoticeSchema(db)
    const rows = db.prepare('SELECT chapter_number, raw_markdown FROM blueprint_details')
      .all() as Array<{ chapter_number: number; raw_markdown: string }>
    const getNotices = db.prepare(
      'SELECT notices_json FROM blueprint_detail_review_notices WHERE chapter_number = ?',
    )
    const saveNotices = db.prepare(`
      INSERT INTO blueprint_detail_review_notices (chapter_number, notices_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(chapter_number) DO UPDATE SET
        notices_json = excluded.notices_json, updated_at = datetime('now')
    `)
    for (const row of rows) {
      const matches = renames.filter(rename => rename.originalName && row.raw_markdown.includes(rename.originalName))
      if (matches.length === 0) continue
      const stored = getNotices.get(row.chapter_number) as { notices_json: string } | undefined
      let current: Array<{ oldName: string; newName: string; createdAt: string }> = []
      try {
        const parsed = stored ? JSON.parse(stored.notices_json) : []
        if (Array.isArray(parsed)) current = parsed.filter(notice => (
          !!notice && typeof notice.oldName === 'string' && typeof notice.newName === 'string'
          && typeof notice.createdAt === 'string'
        ))
      } catch {
        current = []
      }
      const now = new Date().toISOString()
      for (const rename of matches) {
        if (!current.some(notice => notice.oldName === rename.originalName && notice.newName === rename.newName)) {
          current.push({ oldName: rename.originalName, newName: rename.newName, createdAt: now })
        }
      }
      saveNotices.run(row.chapter_number, JSON.stringify(current))
    }
  }

  static clearReviewNotices(chapterNumber: number): void {
    const db = requireDb()
    requireChapterNumber(chapterNumber)
    ensureReviewNoticeSchema(db)
    db.prepare('DELETE FROM blueprint_detail_review_notices WHERE chapter_number = ?').run(chapterNumber)
  }

  static getSummaryList(): ChapterBlueprintV2Summary[] {
    const db = requireDb()
    const rows = db.prepare(
      'SELECT * FROM blueprint_details ORDER BY chapter_number ASC LIMIT 300',
    ).all() as BlueprintDetailRow[]
    return rows
      .map(rowToSummary)
      .filter((summary): summary is ChapterBlueprintV2Summary => summary !== null)
  }

  /**
   * 保存（乐观并发 + 投影事务，契约 §6/§7）。成功返回新 revision 与 contentHash；
   * baseRevision 不匹配返回 conflict；rawMarkdown = serialize(content) 的规范导出。
   */
  static save(input: ChapterBlueprintV2SaveInput): BlueprintV2SaveResult {
    const db = requireDb()
    requireChapterNumber(input.chapterNumber)
    if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
      throw new Error('章节细纲 baseRevision 无效')
    }
    // 用户清空章题时，原本位于章题后的散块仍须留在文档原位。
    const content = !input.content.chapterTitle && input.content.chapterPostamble
      ? {
          ...input.content,
          docPreamble: input.content.docPreamble + input.content.chapterPostamble,
          chapterPostamble: undefined,
        }
      : input.content
    if (content.chapterNumber !== input.chapterNumber) {
      return { success: false, error: `细纲内容章节号（${content.chapterNumber}）与目标章（${input.chapterNumber}）不一致` }
    }
    try {
      assertValidChapterBlueprintV2Content(content)
      assertNoLossOnSerialize(content)
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }

    try {
      const result = db.transaction((): BlueprintV2SaveResult => {
        const row = db.prepare(
          'SELECT revision, detail_json, schema_version FROM blueprint_details WHERE chapter_number = ?',
        ).get(input.chapterNumber) as          | { revision: number; detail_json: string; schema_version: number }
          | undefined
        const currentRevision = row?.revision ?? 0
        if (currentRevision !== input.baseRevision) {
          return { success: false, conflict: true, currentRevision }
        }
        if (row) {
          // schema_version 超前的数据必须由更新版本的应用处理，不得降级覆盖。
          let storedSchema = row.schema_version
          try {
            storedSchema = Number((JSON.parse(row.detail_json) as { schemaVersion?: number }).schemaVersion ?? row.schema_version)
          } catch {
            storedSchema = row.schema_version
          }
          if (Number.isSafeInteger(storedSchema) && storedSchema > BLUEPRINT_V2_SCHEMA_VERSION) {
            return { success: false, error: `该章细纲由更新版本的应用写入（schema ${storedSchema}），请先升级应用` }
          }
        }

        const contentHash = computeBlueprintV2ContentHash(content)
        const nextRevision = currentRevision + 1
        const detail: ChapterBlueprintV2Detail = {
          ...content,
          revision: nextRevision,
          contentHash,
        }
        const rawMarkdown = serializeChapterBlueprintV2(content)
        db.prepare(`
          INSERT INTO blueprint_details
            (chapter_number, schema_version, detail_json, raw_markdown, revision, content_hash)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(chapter_number) DO UPDATE SET
            schema_version = excluded.schema_version,
            detail_json = excluded.detail_json,
            raw_markdown = excluded.raw_markdown,
            revision = excluded.revision,
            content_hash = excluded.content_hash,
            updated_at = datetime('now')
        `).run(
          input.chapterNumber,
          BLUEPRINT_V2_SCHEMA_VERSION,
          JSON.stringify(detail),
          rawMarkdown,
          nextRevision,
          contentHash,
        )
        BlueprintDetailRepository.projectV1ColumnsWithinTransaction(db, content)
        return { success: true, revision: nextRevision, contentHash }
      })()
      return result
    } catch (error) {
      // 事务已回滚，revision 不变；错误原样上抛给 UI（契约 §7.1）。
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 拖动专用（契约 §6 db:blueprint-v2-scene-order-save）：仅改 storyboard 条目
   * 位次。orderedSceneIds 必须是现有分镜 ID 的一个排列；同样走乐观并发与投影。
   */
  static saveSceneOrder(input: {
    chapterNumber: number
    baseRevision: number
    orderedSceneIds: string[]
  }): BlueprintV2SaveResult {
    requireChapterNumber(input.chapterNumber)
    if (!Array.isArray(input.orderedSceneIds)) {
      return { success: false, error: '分镜顺序列表无效' }
    }
    const detail = BlueprintDetailRepository.get(input.chapterNumber)
    if (!detail) return { success: false, error: '该章暂无 v2 细纲' }
    if (detail.readStatus === 'needs-newer-app') {
      return { success: false, error: '该章细纲由更新版本的应用写入，请先升级应用' }
    }
    const currentIds = getBlueprintV2Scenes(detail).map(scene => scene.sceneId)
    const requested = [...new Set(input.orderedSceneIds)]
    const isPermutation = requested.length === currentIds.length
      && requested.every(id => currentIds.includes(id))
    if (!isPermutation) {
      return { success: false, error: '分镜顺序列表与现有分镜不一致，请刷新后重试' }
    }
    let content = {
      schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
      chapterNumber: detail.chapterNumber,
      chapterTitle: detail.chapterTitle,
      ...(detail.chapterTitleLevel === undefined ? {} : { chapterTitleLevel: detail.chapterTitleLevel }),
      ...(detail.chapterPostamble === undefined ? {} : { chapterPostamble: detail.chapterPostamble }),
      docPreamble: detail.docPreamble,
      sections: detail.sections,
      origin: detail.origin,
    } as Parameters<typeof moveBlueprintV2Scene>[0]
    // 逐个把分镜移动到目标位次（等价于一次排列，且保持其余条目连续性）。
    requested.forEach((sceneId, index) => {
      content = moveBlueprintV2Scene(content, sceneId, index + 1)
    })
    return BlueprintDetailRepository.save({
      chapterNumber: input.chapterNumber,
      baseRevision: input.baseRevision,
      content,
    })
  }

  /** 删除 v2 细纲行；blueprints v1 字段保持删除前的投影值（契约 §7.3）。 */
  static delete(chapterNumber: number): void {
    const db = requireDb()
    requireChapterNumber(chapterNumber)
    db.prepare('DELETE FROM blueprint_details WHERE chapter_number = ?').run(chapterNumber)
    db.prepare('DELETE FROM blueprint_detail_review_notices WHERE chapter_number = ?').run(chapterNumber)
  }

  /** 清空全部 v2 细纲行（配合「清空全部蓝图」的章级清空流程）。 */
  static deleteAll(): void {
    const db = requireDb()
    db.prepare('DELETE FROM blueprint_details').run()
    db.prepare('DELETE FROM blueprint_detail_review_notices').run()
  }

  /** 守卫查询（契约 §7.4）：这些章已有 v2 细纲，v1 写入流程必须跳过。 */
  static chaptersWithDetails(chapterNumbers: readonly number[]): Set<number> {
    const result = new Set<number>()
    if (chapterNumbers.length === 0) return result
    const db = requireDb()
    const placeholders = chapterNumbers.map(() => '?').join(', ')
    const rows = db.prepare(
      `SELECT chapter_number FROM blueprint_details WHERE chapter_number IN (${placeholders})`,
    ).all(...chapterNumbers) as Array<{ chapter_number: number }>
    for (const row of rows) result.add(row.chapter_number)
    return result
  }

  /**
   * 章节蓝图统一版本迁移：把仅有 v1 简纲行（blueprints）且尚无 v2 细纲的章
   * 升级为 v2 权威数据。幂等：迁移目标以「blueprint_details 缺行」为准，重复
   * 执行不会产生重复内容；内容全空的行（新建占位章）跳过，保持可被工作流
   * 批量写入；单章失败只记录并跳过，原 v1 行原样保留。
   */
  static migrateLegacyRows(options?: { chapterNumbers?: readonly number[] }): {
    migrated: number[]
    skipped: Array<{ chapterNumber: number; reason: 'empty-legacy-content' | 'conflict' }>
    failed: Array<{ chapterNumber: number; error: string }>
  } {
    const db = requireDb()
    const migrated: number[] = []
    const skipped: Array<{ chapterNumber: number; reason: 'empty-legacy-content' | 'conflict' }> = []
    const failed: Array<{ chapterNumber: number; error: string }> = []
    let rows: Array<{
      chapter_number: number
      title: string
      purpose: string
      key_events: string
      suspense_hook: string
    }>
    try {
      if (options?.chapterNumbers && options.chapterNumbers.length > 0) {
        const placeholders = options.chapterNumbers.map(() => '?').join(', ')
        rows = db.prepare(`
          SELECT b.chapter_number, b.title, b.purpose, b.key_events, b.suspense_hook
          FROM blueprints b
          WHERE b.chapter_number IN (${placeholders})
            AND NOT EXISTS (SELECT 1 FROM blueprint_details d WHERE d.chapter_number = b.chapter_number)
          ORDER BY b.chapter_number ASC
        `).all(...options.chapterNumbers) as typeof rows
      } else {
        rows = db.prepare(`
          SELECT b.chapter_number, b.title, b.purpose, b.key_events, b.suspense_hook
          FROM blueprints b
          WHERE NOT EXISTS (SELECT 1 FROM blueprint_details d WHERE d.chapter_number = b.chapter_number)
          ORDER BY b.chapter_number ASC
          LIMIT 1000
        `).all() as typeof rows
      }
    } catch {
      // 极端旧库缺表等情况：本次不迁移，下一次项目打开重试。
      return { migrated, skipped, failed }
    }
    for (const row of rows) {
      const legacy = {
        chapterNumber: row.chapter_number,
        title: row.title ?? '',
        purpose: row.purpose ?? '',
        keyEvents: row.key_events ?? '',
        suspenseHook: row.suspense_hook ?? '',
      }
      if (!legacy.title.trim() && !legacy.purpose.trim() && !legacy.keyEvents.trim() && !legacy.suspenseHook.trim()) {
        skipped.push({ chapterNumber: row.chapter_number, reason: 'empty-legacy-content' })
        continue
      }
      try {
        const content = buildBlueprintV2MigrationContent(legacy, { origin: 'upgrade' })
        const result = BlueprintDetailRepository.save({
          chapterNumber: legacy.chapterNumber,
          baseRevision: 0,
          content,
        })
        if (result.success) {
          migrated.push(legacy.chapterNumber)
        } else if (result.conflict) {
          // 迁移期间该章已出现 v2 细纲（并发窗口）：视为已完成，绝不覆盖。
          skipped.push({ chapterNumber: legacy.chapterNumber, reason: 'conflict' })
        } else {
          failed.push({ chapterNumber: legacy.chapterNumber, error: result.error ?? '未知错误' })
        }
      } catch (error) {
        failed.push({
          chapterNumber: legacy.chapterNumber,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { migrated, skipped, failed }
  }

  /**
   * 投影（契约 §6.3）：同一事务内更新且仅更新 blueprints 四列；推导值为空 →
   * 保持旧值。永不投影 role / characters / volume_id / user_guidance / notes。
   */
  private static projectV1ColumnsWithinTransaction(
    db: NonNullable<ReturnType<typeof getProjectDb>>,
    content: Parameters<typeof projectV2ToV1>[0],
  ): void {
    const current = db.prepare(
      'SELECT chapter_number, title, purpose, key_events, suspense_hook FROM blueprints WHERE chapter_number = ?',
    ).get(content.chapterNumber) as
      | { chapter_number: number; title: string; purpose: string; key_events: string; suspense_hook: string }
      | undefined
    if (!current) return // 无 v1 行：投影无处可写，跳过（v1 行由既有流程创建）
    const blueprintData: BlueprintData = {
      chapterNumber: current.chapter_number,
      title: current.title,
      role: '',
      purpose: current.purpose,
      keyEvents: current.key_events,
      characters: [],
      suspenseHook: current.suspense_hook,
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
    }
    const projection = projectV2ToV1(content, blueprintData)
    db.prepare(`
      UPDATE blueprints
      SET title = ?, purpose = ?, key_events = ?, suspense_hook = ?, updated_at = datetime('now')
      WHERE chapter_number = ?
    `).run(projection.title, projection.purpose, projection.keyEvents, projection.suspenseHook, content.chapterNumber)
  }
}
