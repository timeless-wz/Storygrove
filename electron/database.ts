/**
 * Vela SQLite 数据库服务 — 主进程使用
 *
 * 负责 SQLite 实例的连接、生命周期与建表。
 * 具体业务逻辑由 /repositories 提供。
 */
import { createRequire } from 'node:module'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { loadApplicationImportSourceSecret } from './services/import-source-identity-secret'
import { countDraftUnits } from '../src/shared/draft-units'
import { migrateDraftUnitCounts } from './services/draft-unit-migration'
import { migrateWorldMapAtlas } from './services/world-map-atlas-migration'
import { ensureWorldWorkbenchSchema } from './services/world-workbench-schema'
import { ensureKnowledgeGapSchema } from './services/knowledge-gap-schema'
import { ensureCharacterActionSchema } from './services/character-action-schema'
import { ensureOutlineSyncSchema } from './services/outline-sync-schema'
import { ensureKnowledgeCheckSchema } from './services/knowledge-check-schema'
import { ensureThreadMarkerLinkSchema } from './services/thread-marker-link-schema'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
import type BetterSqlite3 from 'better-sqlite3'
import { ensureCultivationSchema } from './repositories/cultivation-schema'
import { ensureCharacterRosterSchema } from './repositories/character-roster-schema'
import { ensureStoryDomainSchema } from './services/story-domain-schema'
import { ensurePhase2To8Schema } from './services/phase2-8-schema'
import {
  CharacterRelationshipRepository,
  ensureCharacterRelationshipSchema,
} from './repositories/character-relationship-repository'
import { BlueprintDetailRepository } from './repositories/blueprint-detail-repository'

let projectDb: BetterSqlite3.Database | null = null
let currentProjectPath: string | null = null

const WORKSPACE_HUB_LEGACY_MIGRATION_ID = 'workspace-hub-approved-snapshots-v1'

/**
 * 一次性、显式迁移旧工作区表。只有旧记录明确处于 imported 状态时，
 * 才把 workspace_source_fragments 固化为批准快照；无法确认批准状态的数据
 * 保持未批准且永远不会被运行时查询回退读取。迁移结果写入审计表。
 */
function migrateLegacyWorkspaceHubData(db: BetterSqlite3.Database): void {
  const alreadyApplied = db.prepare(`
    SELECT migration_id FROM workspace_hub_migration_audit WHERE migration_id = ?
  `).get(WORKSPACE_HUB_LEGACY_MIGRATION_ID)
  if (alreadyApplied) return

  db.transaction(() => {
    const sources = db.prepare(`
      SELECT id, project_id, content_hash, file_size
      FROM workspace_sources
      WHERE import_status = 'imported'
        AND (approved_snapshot_id IS NULL OR approved_snapshot_id = '')
        AND content_hash <> ''
        AND EXISTS (
          SELECT 1 FROM workspace_source_fragments legacy WHERE legacy.source_id = workspace_sources.id
        )
      ORDER BY id
    `).all() as Array<{ id: string; project_id: string; content_hash: string; file_size: number }>

    const legacyFragments = db.prepare(`
      SELECT heading_path, content, start_line, end_line, fragment_hash,
             chapter_start, chapter_end, purpose, status
      FROM workspace_source_fragments
      WHERE source_id = ?
      ORDER BY start_line, fragment_id
    `)
    const insertSnapshot = db.prepare(`
      INSERT INTO workspace_source_snapshots (
        snapshot_id, source_id, project_id, content_hash, file_size, fragment_count
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertFragment = db.prepare(`
      INSERT INTO workspace_source_snapshot_fragments (
        id, snapshot_id, source_id, project_id, heading_path, content,
        start_line, end_line, fragment_hash, chapter_start, chapter_end, purpose, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updateSource = db.prepare(`
      UPDATE workspace_sources
      SET observed_snapshot_id = ?, approved_snapshot_id = ?,
          observed_file_hash = content_hash, approved_content_hash = content_hash,
          updated_at = datetime('now')
      WHERE id = ? AND project_id = ?
    `)

    let migratedFragmentCount = 0
    for (const source of sources) {
      const snapshotId = `snap-legacy-${source.id}-${source.content_hash.slice(0, 16)}`
      const fragments = legacyFragments.all(source.id) as Array<{
        heading_path: string
        content: string
        start_line: number
        end_line: number
        fragment_hash: string
        chapter_start: number | null
        chapter_end: number | null
        purpose: string
        status: 'active' | 'stale' | 'deprecated'
      }>
      insertSnapshot.run(
        snapshotId,
        source.id,
        source.project_id,
        source.content_hash,
        source.file_size,
        fragments.length,
      )
      fragments.forEach((fragment, index) => {
        insertFragment.run(
          `${snapshotId}-f-${index + 1}`,
          snapshotId,
          source.id,
          source.project_id,
          fragment.heading_path,
          fragment.content,
          fragment.start_line,
          fragment.end_line,
          fragment.fragment_hash,
          fragment.chapter_start,
          fragment.chapter_end,
          fragment.purpose,
          fragment.status === 'stale' ? 'active' : fragment.status,
        )
      })
      migratedFragmentCount += fragments.length
      updateSource.run(snapshotId, snapshotId, source.id, source.project_id)
    }

    const legacyScanRules = db.prepare(`
      SELECT rule_id, project_id, title, content, status, constraint_type, scope,
             source_file, source_heading_path, source_line_range
      FROM setting_rules
      WHERE confirmed_by = 'preset-importer' AND origin_type = 'manual'
      ORDER BY rule_id
    `).all() as Array<{
      rule_id: string
      project_id: string
      title: string
      content: string
      status: string
      constraint_type: string
      scope: string
      source_file: string
      source_heading_path: string
      source_line_range: string
    }>
    let promotedLegacyRuleCount = 0
    let discardedUnapprovedRuleCount = 0
    for (const rule of legacyScanRules) {
      const source = db.prepare(`
        SELECT id, approved_snapshot_id
        FROM workspace_sources
        WHERE project_id = ? AND relative_path = ?
          AND approved_snapshot_id IS NOT NULL AND approved_snapshot_id <> ''
      `).get(rule.project_id, rule.source_file) as { id: string; approved_snapshot_id: string } | undefined
      if (!source) {
        db.prepare('DELETE FROM setting_rules WHERE rule_id = ?').run(rule.rule_id)
        discardedUnapprovedRuleCount++
        continue
      }
      db.prepare(`
        UPDATE setting_rules
        SET origin_type = 'scan', source_id = ?, source_snapshot_id = ?
        WHERE rule_id = ?
      `).run(source.id, source.approved_snapshot_id, rule.rule_id)
      const stagedId = `${source.approved_snapshot_id}-legacy-rule-${createHash('sha256').update(rule.rule_id).digest('hex').slice(0, 12)}`
      db.prepare(`
        INSERT OR IGNORE INTO workspace_source_snapshot_rules (
          id, snapshot_id, source_id, project_id, title, content, status,
          constraint_type, scope, source_file, source_heading_path, source_line_range
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stagedId,
        source.approved_snapshot_id,
        source.id,
        rule.project_id,
        rule.title,
        rule.content,
        rule.status,
        rule.constraint_type,
        rule.scope,
        rule.source_file,
        rule.source_heading_path,
        rule.source_line_range,
      )
      promotedLegacyRuleCount++
    }

    db.prepare(`
      INSERT INTO workspace_hub_migration_audit (
        migration_id, migrated_source_count, migrated_fragment_count, details_json
      ) VALUES (?, ?, ?, ?)
    `).run(
      WORKSPACE_HUB_LEGACY_MIGRATION_ID,
      sources.length,
      migratedFragmentCount,
      JSON.stringify({ promotedLegacyRuleCount, discardedUnapprovedRuleCount }),
    )
  })()
}

/** 初始化项目数据库（打开项目时调用） */
export function initProjectDatabase(projectPath: string, importSourceSecret?: Buffer): void {
  closeProjectDatabase()
  currentProjectPath = projectPath

  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  projectDb = new Database(dbPath)
  projectDb.pragma('journal_mode = WAL')
  projectDb.pragma('foreign_keys = ON')

  // 创建表结构
  createTables(projectDb, importSourceSecret)
  ensureForeshadowingSchema(projectDb)
  // Retain every former manuscript as an editable candidate; one current manuscript per chapter.
  projectDb.exec(`UPDATE drafts SET status = 'draft' WHERE status = 'finalized' AND EXISTS (
    SELECT 1 FROM drafts newer WHERE newer.chapter_number = drafts.chapter_number AND newer.status = 'finalized'
      AND (newer.version > drafts.version OR (newer.version = drafts.version AND newer.id > drafts.id))
  ); CREATE UNIQUE INDEX IF NOT EXISTS idx_one_current_manuscript ON drafts(chapter_number) WHERE status = 'finalized';`)


  // 旧项目只有「一张项目底图 + 图层筛选」的结构。一次性把旧图层转换成同名地图，
  // 并把旧底图迁入其中一张地图的受控目录；迁移不删除任何既有地点、图层或连接。
  migrateWorldMapAtlas(projectDb, projectPath)
  // 人物关系表以稳定人物 ID 为端点；旧项目在这里安全补齐身份并增量迁移旧结构化关系。
  ensureCharacterRelationshipSchema(projectDb)
  CharacterRelationshipRepository.migrateLegacyRelationships(projectDb)

  // 世界资料（世界/势力/秘境/通道/规则/人物行踪）。幂等：只新增表与可空列，
  // 不创建默认世界、不推断旧地图归属、不升级候选状态。
  ensureWorldWorkbenchSchema(projectDb)

  // 信息与揭露 / 人物行动线 / 正文反向修纲 / 检查报告 / 伏笔↔脉络关系
  // （knowledge-action-outline-sync-contract §9）：全部全新表，幂等 DDL，无旧行迁移。
  ensureKnowledgeGapSchema(projectDb)
  ensureCharacterActionSchema(projectDb)
  ensureOutlineSyncSchema(projectDb)
  ensureKnowledgeCheckSchema(projectDb)
  ensureThreadMarkerLinkSchema(projectDb)

  // 章节蓝图统一版本：把仅剩 v1 简纲行的章安全迁移为 v2 权威细纲。
  // 幂等（只补 blueprint_details 缺行）；单章失败保留原 v1 行，下次打开重试。
  try {
    const blueprintMigration = BlueprintDetailRepository.migrateLegacyRows()
    if (blueprintMigration.migrated.length > 0) {
      console.log(
        `[Vela DB] 章节蓝图统一迁移：已迁移 ${blueprintMigration.migrated.length} 章`
        + (blueprintMigration.failed.length > 0 ? `，${blueprintMigration.failed.length} 章失败（原数据保留）` : ''),
      )
    }
    if (blueprintMigration.failed.length > 0) {
      console.warn('[Vela DB] 蓝图迁移失败章号：', blueprintMigration.failed.map(item => item.chapterNumber))
    }
  } catch (error) {
    // 迁移绝不阻断项目打开；v1 行未被改动，下一次打开会重试。
    console.warn('[Vela DB] 章节蓝图统一迁移未执行：', error)
  }

  console.log(`[Vela DB] 项目数据库已打开: ${dbPath}`)
}

/** 关闭项目数据库 */
export function closeProjectDatabase(): void {
  // Clear the process-visible identity before closing the native handle. If
  // the close itself throws, callers still fail closed instead of treating a
  // half-closed database as the active project.
  const closingDatabase = projectDb
  projectDb = null
  currentProjectPath = null
  closingDatabase?.close()
}

/** 获取当前数据库实例 */
export function getProjectDb(): BetterSqlite3.Database | null {
  return projectDb
}

/** 获取当前已打开项目路径 */
export function getCurrentProjectPath(): string | null {
  return currentProjectPath
}

/** 创建完整表结构（9 张核心表 + 2 张沿用表） */
function createTables(db: BetterSqlite3.Database, importSourceSecret?: Buffer) {
  db.exec(`
    -- ============================================================
    -- 1. project_core — 项目主台账（NovelConfig + 架构四大件）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS project_core (
      id TEXT PRIMARY KEY DEFAULT 'main',
      project_name TEXT NOT NULL DEFAULT '',      -- 小说工程名
      -- [基础定位]
      genre TEXT DEFAULT '',                      -- 核心流派
      sub_genre TEXT DEFAULT '',                  -- 细分流派
      target_audience TEXT DEFAULT '',            -- 目标受众
      total_chapters INTEGER DEFAULT 100,         -- 预计总章数
      words_per_chapter INTEGER DEFAULT 3000,     -- 单章基准字数
      writing_language TEXT NOT NULL DEFAULT 'zh-CN', -- 项目级写作语言
      creative_strategy TEXT NOT NULL DEFAULT 'auto', -- 项目级创作策略
      narrative_thread_dormant_threshold INTEGER NOT NULL DEFAULT 3,
      -- [写作技法]
      plot_structure TEXT DEFAULT 'three_act',    -- 故事模型
      narrative_pov TEXT DEFAULT 'third_limited', -- 叙事视角
      writing_style TEXT DEFAULT '',              -- 文风描述
      reference_works TEXT DEFAULT '',            -- 参考作品
      global_guidance TEXT DEFAULT '',            -- 全局行文指导
      golden_finger TEXT DEFAULT '',              -- 金手指设定
      core_outline TEXT DEFAULT '',               -- 作者配置核心大纲（独立于推演摘要）
      world_setting TEXT DEFAULT '',              -- 作者配置世界设定（独立于架构世界观）
      protagonist_profile TEXT DEFAULT '',        -- 作者配置主角档案（独立于角色名单投影）
      -- [架构四大件]
      premise TEXT DEFAULT '',                    -- 故事前提
      worldbuilding TEXT DEFAULT '',              -- 世界观
      characters_arch TEXT DEFAULT '',            -- 人物群像网络
      synopsis TEXT DEFAULT '',                   -- 情节总大纲
      -- [系统缓存]
      character_states TEXT DEFAULT '',           -- 全书角色动态快照
      plot_tree_snapshot TEXT NOT NULL DEFAULT '',-- 可重建的剧情树派生快照
      -- [创作中枢关联]
      external_workspace_path TEXT DEFAULT '',     -- 关联的外部创作母稿目录路径
      external_workspace_scanned_at TEXT DEFAULT '', -- 最近一次扫描完成时间
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 2. blueprints — 章节蓝图
    -- ============================================================
    CREATE TABLE IF NOT EXISTS blueprints (
      chapter_number INTEGER PRIMARY KEY,         -- 章节序号
      volume_id TEXT NOT NULL DEFAULT 'volume-1', -- 所属卷（旧项目统一归入第 1 卷）
      title TEXT NOT NULL DEFAULT '',             -- 章节标题
      role TEXT DEFAULT '',                       -- 章节角色
      purpose TEXT DEFAULT '',                    -- 核心目的
      key_events TEXT DEFAULT '',                 -- 关键事件
      characters TEXT DEFAULT '[]',               -- 出场角色 (JSON Array)
      suspense_hook TEXT DEFAULT '',              -- 悬念钩子
      user_guidance TEXT DEFAULT '',              -- 用户预设指导
      notes TEXT DEFAULT '',                      -- 后处理提取的章节要点
      notes_updated_at TEXT DEFAULT '',           -- notes 提取时间
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    -- ============================================================
    -- 2b. blueprint_details — 章节蓝图 v2 细纲（blueprint-v2-contract §5.1）
    -- 分镜正文、规则、禁忌、检查条目的唯一权威。blueprints 表不加列不改列；
    -- v2 保存时在同一事务内按 §6.3 投影四列。
    -- ============================================================
    CREATE TABLE IF NOT EXISTS blueprint_details (
      chapter_number INTEGER PRIMARY KEY,         -- 与 blueprints.chapter_number 一一对应
      schema_version INTEGER NOT NULL DEFAULT 2,
      detail_json   TEXT NOT NULL,                -- ChapterBlueprintV2Detail 的 canonical JSON
      raw_markdown  TEXT NOT NULL,                -- 最近一次导入/规范导出的完整原文，逐字，供核对
      revision      INTEGER NOT NULL,             -- 冗余列：免解析 JSON 的乐观并发/摘要读取
      content_hash  TEXT NOT NULL,                -- 冗余列：同上
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS blueprint_detail_review_notices (
      chapter_number INTEGER PRIMARY KEY,
      notices_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS blueprint_volumes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- 三层蓝图规划的新增数据表。旧 synopsis、卷目录与章归属不在此迁移中回写。
    CREATE TABLE IF NOT EXISTS blueprint_volume_outlines (
      volume_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      markdown TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      origin TEXT NOT NULL,
      source_snapshot_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blueprint_planning_candidates (
      operation_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      state TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload_hash TEXT NOT NULL,
      candidate_json TEXT NOT NULL,
      source_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      committed_at TEXT DEFAULT NULL,
      commit_receipt_json TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blueprint_planning_candidates_state_updated
      ON blueprint_planning_candidates(state, updated_at DESC);
    CREATE TABLE IF NOT EXISTS blueprint_planning_sources (
      snapshot_id TEXT PRIMARY KEY,
      operation_id TEXT DEFAULT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_revision INTEGER DEFAULT NULL,
      target_hash TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blueprint_planning_sources_operation
      ON blueprint_planning_sources(operation_id);
    CREATE TABLE IF NOT EXISTS blueprint_planning_checks (
      check_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_revision INTEGER DEFAULT NULL,
      target_hash TEXT NOT NULL,
      source_snapshot_json TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blueprint_planning_checks_target_created
      ON blueprint_planning_checks(target_kind, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blueprint_volumes_order
      ON blueprint_volumes(sort_order, created_at);

    -- ============================================================
    -- 3. characters — 角色卡（currentState 拍平为 cs_* 列）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS characters (
      name TEXT PRIMARY KEY,                      -- 角色名
      role TEXT DEFAULT 'supporting',             -- protagonist/antagonist/supporting/minor
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
      appearance TEXT DEFAULT '',                 -- 外貌
      personality TEXT DEFAULT '',                -- 性格
      background TEXT DEFAULT '',                 -- 背景
      abilities TEXT DEFAULT '',                  -- 能力
      motivation TEXT DEFAULT '',                 -- 动机
      relationships TEXT DEFAULT '',              -- 关系链
      arc TEXT DEFAULT '',                        -- 弧光
      notes TEXT DEFAULT '',                      -- 备忘录
      cs_location TEXT DEFAULT '',                -- 当前位置
      cs_power_level TEXT DEFAULT '',             -- 修为境界
      cs_physical_state TEXT DEFAULT '',          -- 身体状态
      cs_mental_state TEXT DEFAULT '',            -- 心理状态
      cs_key_items TEXT DEFAULT '',               -- 关键道具
      cs_recent_events TEXT DEFAULT '',           -- 最近事件
      cs_updated_at_chapter INTEGER DEFAULT NULL, -- 状态更新于第几章；NULL = 无 currentState
      cs_provenance TEXT NOT NULL DEFAULT '{}',   -- currentState 字段级来源
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 4. contents — 文本内容池（正文与元数据分离）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL DEFAULT '',              -- 正文/报告内容
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 5. drafts — 草稿主线（finalized = 已发布正文，仍可编辑）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,            -- 归属章节
      blueprint_chapter_number INTEGER DEFAULT NULL, -- 作者显式绑定的章节蓝图
      imported_title TEXT NOT NULL DEFAULT '',     -- 导入草稿携带的标题，不改写章节蓝图
      version INTEGER NOT NULL,                   -- v1, v2...
      status TEXT DEFAULT 'draft',                -- draft/revised/finalized/archived
      source TEXT DEFAULT 'write',                -- write/rewrite
      content_id INTEGER NOT NULL,                -- FK -> contents
      word_count INTEGER DEFAULT 0,               -- 字数缓存
      source_dependencies TEXT NOT NULL DEFAULT '[]', -- ordered draft ids + frozen prose hashes
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS chapter_volume_assignments (
      chapter_number INTEGER PRIMARY KEY,
      volume_id TEXT DEFAULT NULL
    );
    CREATE TRIGGER IF NOT EXISTS cleanup_empty_prose_chapter_volume AFTER DELETE ON drafts
    WHEN NOT EXISTS (SELECT 1 FROM drafts WHERE chapter_number = OLD.chapter_number)
    BEGIN
      DELETE FROM chapter_volume_assignments WHERE chapter_number = OLD.chapter_number;
    END;
    CREATE INDEX IF NOT EXISTS idx_drafts_chapter ON drafts(chapter_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_chapter_version
      ON drafts(chapter_number, version);

    -- Failed generation output is a recoverable candidate, never a draft or
    -- finalized fact. It remains project-local and requires an explicit user
    -- action before entering an unsaved editor buffer.
    CREATE TABLE IF NOT EXISTS recovery_candidates (
      candidate_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL CHECK(chapter_number > 0),
      chapter_title TEXT NOT NULL DEFAULT '',
      source_snapshot TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      source_draft_id INTEGER DEFAULT NULL,
      source_draft_version INTEGER DEFAULT NULL,
      source_draft_identity_captured INTEGER NOT NULL DEFAULT 0
        CHECK(source_draft_identity_captured IN (0, 1)),
      visible_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      failure_code TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'continued', 'discarded')),
      replaces_candidate_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT DEFAULT NULL,
      FOREIGN KEY (replaces_candidate_id) REFERENCES recovery_candidates(candidate_id)
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_candidates_pending
      ON recovery_candidates(status, created_at);

    -- ============================================================
    -- 5b. finalization_outbox — 定稿实体稿发布投影
    -- SQLite 中的正文与定稿状态先在同一事务提交；根目录实体稿由此 outbox
    -- 异步发布，失败保持 pending 并可根据冻结快照精确重试。
    -- ============================================================
    CREATE TABLE IF NOT EXISTS finalization_outbox (
      finalization_id TEXT PRIMARY KEY,
      draft_id INTEGER NOT NULL UNIQUE,
      chapter_number INTEGER NOT NULL,
      chapter_title TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      content_revision INTEGER NOT NULL,
      content_snapshot TEXT NOT NULL DEFAULT '',
      target_file_name TEXT NOT NULL,
      knowledge_document_id TEXT NOT NULL DEFAULT '',
      publication_status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',
      published_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_finalization_outbox_status
      ON finalization_outbox(publication_status);

    -- 已定稿章节删除：SQLite 事实删除与投影清理收据在同一事务登记。
    -- 实体稿和知识库跨存储清理失败后，可按冻结身份幂等重试。
    CREATE TABLE IF NOT EXISTS chapter_deletion_operations (
      operation_id TEXT PRIMARY KEY,
      draft_id INTEGER NOT NULL UNIQUE,
      chapter_number INTEGER NOT NULL,
      chapter_title TEXT NOT NULL DEFAULT '',
      finalization_id TEXT NOT NULL,
      target_file_name TEXT NOT NULL DEFAULT '',
      knowledge_document_id TEXT NOT NULL DEFAULT '',
      post_process_run_ids TEXT NOT NULL DEFAULT '[]',
      manuscript_status TEXT NOT NULL DEFAULT 'pending',
      manuscript_error TEXT NOT NULL DEFAULT '',
      knowledge_status TEXT NOT NULL DEFAULT 'pending',
      knowledge_error TEXT NOT NULL DEFAULT '',
      legacy_knowledge_authorization TEXT NOT NULL DEFAULT 'not_required',
      legacy_knowledge_authorized_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_deletion_status
      ON chapter_deletion_operations(status);

    -- Imported finalized chapters are committed as one idempotent unit. The
    -- stored receipt is replayed only after the immutable draft/outbox facts
    -- have been verified again.
    CREATE TABLE IF NOT EXISTS finalized_draft_import_operations (
      operation_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Global facts inferred during import are committed as one idempotent
    -- unit: project core plus the authoritative structured character roster.
    CREATE TABLE IF NOT EXISTS import_global_fact_operations (
      operation_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 6. revisions — 修稿（派生自 draft）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_draft_id INTEGER NOT NULL,             -- 父草稿 FK
      revision_index INTEGER NOT NULL,            -- r1, r2
      revision_type TEXT NOT NULL,                -- refine | review-fix
      status TEXT DEFAULT 'pending',              -- pending/merged/discarded
      merged_to_draft_id INTEGER,                 -- 合并产出的新 draft
      user_prompt TEXT DEFAULT '',                -- 用户指导
      review_source_id INTEGER,                   -- 关联审稿 ID
      source_draft_chapter_number INTEGER,        -- 生成时冻结源稿章节
      source_draft_version INTEGER,               -- 生成时冻结源稿版本
      source_draft_status TEXT,                   -- 生成时冻结源稿状态
      source_content TEXT,                        -- 生成时冻结源稿正文
      content_id INTEGER NOT NULL,                -- FK -> contents
      word_count INTEGER DEFAULT 0,               -- 字数缓存
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (base_draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_revisions_draft_index
      ON revisions(base_draft_id, revision_index);

    -- ============================================================
    -- 7. reviews — 审稿（派生自 draft）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_draft_id INTEGER NOT NULL,             -- 审查对象 FK
      review_index INTEGER NOT NULL,              -- 审阅顺位
      source_draft_chapter_number INTEGER,        -- 审稿时冻结源稿章节
      source_draft_version INTEGER,               -- 审稿时冻结源稿版本
      source_draft_status TEXT,                   -- 审稿时冻结源稿状态
      source_content TEXT,                        -- 审稿时冻结源稿正文
      content_id INTEGER NOT NULL,                -- FK -> contents
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (base_draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_draft_index
      ON reviews(base_draft_id, review_index);

    -- ============================================================
    -- 8. post_process_runs — 后处理跑批实例
    -- ============================================================
    CREATE TABLE IF NOT EXISTS post_process_runs (
      id TEXT PRIMARY KEY,                        -- UUID
      trigger_source_type TEXT NOT NULL,           -- chapter_finalize / arch_extract
      trigger_source_id TEXT NOT NULL,             -- 章节号 / draft_id
      source_label TEXT DEFAULT '',               -- UI 标签
      all_critical_passed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_runs_source
      ON post_process_runs(trigger_source_type, trigger_source_id);

    -- ============================================================
    -- 9. post_process_steps — 后处理步骤明细
    -- ============================================================
    CREATE TABLE IF NOT EXISTS post_process_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,                       -- FK -> post_process_runs
      step_key TEXT NOT NULL,                     -- 步骤标识
      label TEXT DEFAULT '',                      -- 展示名称
      critical INTEGER DEFAULT 0,                 -- 是否关键步骤
      ok INTEGER DEFAULT 0,                       -- 是否完成
      error_msg TEXT DEFAULT '',
      attempt_count INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT '',
      last_attempt_at TEXT DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES post_process_runs(id) ON DELETE CASCADE
    );

    -- ============================================================
    -- 沿用表：LLM 调用记录
    -- ============================================================
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      model_name TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_message TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 沿用表：角色状态快照
    -- ============================================================
    CREATE TABLE IF NOT EXISTS summary_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER DEFAULT NULL,
      chapter_number INTEGER NOT NULL,
      character_states TEXT DEFAULT '',
      chapter_notes TEXT NOT NULL DEFAULT '',
      continuity_facts TEXT NOT NULL DEFAULT '[]',
      character_state_candidates TEXT NOT NULL DEFAULT '[]',
      source_finalization_id TEXT NOT NULL DEFAULT '',
      source_content_hash TEXT NOT NULL DEFAULT '',
      projection_generation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS narrative_thread_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      target_start_chapter INTEGER NOT NULL CHECK(target_start_chapter > 0),
      target_end_chapter INTEGER NOT NULL CHECK(target_end_chapter >= target_start_chapter),
      author_intent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS narrative_thread_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      draft_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('planted', 'progressing', 'resolved', 'abandoned')),
      evidence TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES narrative_thread_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      UNIQUE(plan_id, draft_id, event_type, evidence)
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_thread_confirmations_plan
      ON narrative_thread_confirmations(plan_id, draft_id, id);

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_llm_calls_time ON llm_calls(created_at);

    -- ============================================================
    -- 10. world_maps & world_map_nodes & world_map_edges — 多地图地图册
    --
    -- 一张地图 = 一层独立空间。地点通过 map_id 唯一归属一张地图，图片也由
    -- 地图自己持有（不再有项目级单张底图）。旧版 world_map_layers 与
    -- world_map_image 表不再创建：其数据由 world-map-atlas-migration 一次性
    -- 迁入本结构，迁移代码保留原始行以供追溯。
    -- ============================================================
    CREATE TABLE IF NOT EXISTS world_maps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_map_id TEXT DEFAULT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      image_file_name TEXT DEFAULT NULL,
      image_mime_type TEXT DEFAULT NULL,
      image_bytes INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_world_maps_parent ON world_maps(parent_map_id);
    CREATE INDEX IF NOT EXISTS idx_world_maps_order ON world_maps(sort_order, created_at);

    -- 旧图层/单图结构的迁移审计。一次性执行，迁移报告供界面向作者说明结果。
    CREATE TABLE IF NOT EXISTS world_map_atlas_migration (
      migration_id TEXT PRIMARY KEY,
      report_json TEXT NOT NULL,
      acknowledged_at TEXT DEFAULT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS world_map_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      marker_icon TEXT DEFAULT NULL,
      description TEXT NOT NULL DEFAULT '',
      parent_id TEXT DEFAULT NULL,
      map_id TEXT NOT NULL DEFAULT '',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      source_refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_world_map_nodes_parent ON world_map_nodes(parent_id);

    CREATE TABLE IF NOT EXISTS world_map_edges (
      id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      map_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_node_id) REFERENCES world_map_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES world_map_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_world_map_edges_from ON world_map_edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_world_map_edges_to ON world_map_edges(to_node_id);
    -- map_id 的索引在增量补列之后建立：旧库的节点/连线表此时还没有该列。

    -- ============================================================
    -- 11. story_timeline — 作者手动维护的故事内时间线
    -- ============================================================
    CREATE TABLE IF NOT EXISTS story_timeline_settings (
      id TEXT PRIMARY KEY CHECK(id = 'main'),
      title TEXT NOT NULL DEFAULT '故事时间线',
      ruler_label TEXT NOT NULL DEFAULT '故事时间',
      ruler_unit TEXT NOT NULL DEFAULT '刻度',
      start_label TEXT NOT NULL DEFAULT '故事开端',
      start_time_label TEXT NOT NULL DEFAULT '',
      start_order REAL DEFAULT NULL,
      end_label TEXT NOT NULL DEFAULT '故事结束',
      end_time_label TEXT NOT NULL DEFAULT '',
      end_order REAL DEFAULT NULL,
      has_custom_range INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS story_timeline_branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_event_id TEXT DEFAULT NULL,
      color TEXT DEFAULT NULL,
      sort_order REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_story_timeline_branches_source
      ON story_timeline_branches(source_event_id);

    CREATE TABLE IF NOT EXISTS story_timeline_events (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL DEFAULT 'main',
      parent_event_id TEXT DEFAULT NULL,
      title TEXT NOT NULL,
      time_label TEXT NOT NULL,
      sort_order REAL NOT NULL,
      precision TEXT NOT NULL DEFAULT 'exact'
        CHECK(precision IN ('exact', 'range', 'relative', 'unknown')),
      range_end_label TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      chapter_numbers TEXT NOT NULL DEFAULT '[]',
      character_names TEXT NOT NULL DEFAULT '[]',
      location_node_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK(status IN ('planned', 'drafted', 'finalized')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_story_timeline_events_order
      ON story_timeline_events(sort_order, created_at);
    -- branch_id 的索引不在这里建立：旧库的 story_timeline_events 还没有该列，
    -- 会在 ensurePhase2To8Schema 增量补列之后再创建（与 world_map_nodes.map_id
    -- 的索引同一处理方式）。否则打开旧项目会在这里直接失败。

    -- ============================================================
    -- 12. plot_canvas — 作者可编辑的剧情画布（跨章节剧情组织）
    --
    -- 与 project_core.plot_tree_snapshot（确定性只读投影）严格分离：
    -- 这里存的是作者自由编排的画布 / 节点 / 连线，绝不回写投影。
    -- 画布树用 parent_canvas_id 表达“子画布”；节点与连线都归属唯一画布。
    -- ============================================================
    CREATE TABLE IF NOT EXISTS plot_canvases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      parent_canvas_id TEXT DEFAULT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      viewport_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (parent_canvas_id) REFERENCES plot_canvases(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plot_canvases_parent
      ON plot_canvases(parent_canvas_id, sort_order, created_at);

    CREATE TABLE IF NOT EXISTS plot_canvas_nodes (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'plot'
        CHECK(kind IN ('plot', 'idea', 'foreshadow', 'character', 'location',
                       'item', 'faction', 'skill', 'chapter', 'note')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      color_key TEXT NOT NULL DEFAULT 'default'
        CHECK(color_key IN ('default', 'accent', 'success', 'warning', 'danger')),
      tags TEXT NOT NULL DEFAULT '[]',
      entity_refs TEXT NOT NULL DEFAULT '[]',
      chapter_refs TEXT NOT NULL DEFAULT '[]',
      plan_id INTEGER DEFAULT NULL,
      sub_canvas_id TEXT DEFAULT NULL REFERENCES plot_canvases(id) ON DELETE SET NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (canvas_id) REFERENCES plot_canvases(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plot_canvas_nodes_canvas
      ON plot_canvas_nodes(canvas_id, created_at);

    CREATE TABLE IF NOT EXISTS plot_canvas_edges (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'main' CHECK(kind IN ('main', 'aux')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (canvas_id, source_node_id, target_node_id),
      FOREIGN KEY (canvas_id) REFERENCES plot_canvases(id) ON DELETE CASCADE,
      FOREIGN KEY (source_node_id) REFERENCES plot_canvas_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_node_id) REFERENCES plot_canvas_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plot_canvas_edges_canvas
      ON plot_canvas_edges(canvas_id, created_at);

    -- ============================================================
    -- 13. chapter_canvas — 每章一张的章内场景编排画布
    --
    -- 画布 ID 确定性推导自章节号（cha-<n>），章节删除时按 ID 精确清理。
    -- 场景 / 角色 / 伏笔 / 灵感 / 片段节点都在这里；对角色名单与伏笔记录
    -- 只存引用，权威资料删除后画布侧仅显示失效，绝不反向改写。
    -- ============================================================
    CREATE TABLE IF NOT EXISTS chapter_canvases (
      id TEXT PRIMARY KEY,
      chapter_number INTEGER NOT NULL UNIQUE CHECK(chapter_number > 0),
      viewport_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chapter_canvas_nodes (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      type TEXT NOT NULL
        CHECK(type IN ('scene', 'character', 'foreshadow', 'idea', 'snippet')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      color_key TEXT NOT NULL DEFAULT 'default'
        CHECK(color_key IN ('default', 'accent', 'success', 'warning', 'danger')),
      role TEXT NOT NULL DEFAULT '',
      scene_order INTEGER DEFAULT NULL,
      refs_json TEXT NOT NULL DEFAULT '{}',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (canvas_id) REFERENCES chapter_canvases(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_canvas_nodes_canvas
      ON chapter_canvas_nodes(canvas_id, created_at);

    CREATE TABLE IF NOT EXISTS chapter_canvas_edges (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'main' CHECK(kind IN ('main', 'aux')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (canvas_id, source_node_id, target_node_id),
      FOREIGN KEY (canvas_id) REFERENCES chapter_canvases(id) ON DELETE CASCADE,
      FOREIGN KEY (source_node_id) REFERENCES chapter_canvas_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_node_id) REFERENCES chapter_canvas_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_canvas_edges_canvas
      ON chapter_canvas_edges(canvas_id, created_at);

    -- 人物关系与画布坐标的表结构由 ensureCharacterRelationshipSchema 统一创建（人物 ID 主键）。

    -- Reference imports are recoverable project facts, not generic workflow history.
    CREATE TABLE IF NOT EXISTS import_runs (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL DEFAULT 'reference'
        CHECK(purpose IN ('reference', 'author-manuscript')),
      root_run_id TEXT NOT NULL,
      effect_namespace TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      manifest_fingerprint TEXT NOT NULL,
      authority_fingerprint TEXT NOT NULL DEFAULT '',
      legacy_source_fingerprint TEXT NOT NULL DEFAULT '',
      source_display_json TEXT NOT NULL DEFAULT '[]',
      locale TEXT NOT NULL CHECK(locale IN ('zh-CN', 'en-US')),
      stage TEXT NOT NULL DEFAULT 'knowledge'
        CHECK(stage IN (
          'parsing', 'prepared', 'knowledge', 'global', 'style', 'blueprints',
          'author-commit', 'author-publish', 'author-postprocess',
          'refresh', 'completed'
        )),
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK(status IN ('ready', 'running', 'failed', 'cancelled', 'completed')),
      completed_batches_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT NOT NULL DEFAULT '',
      resumable INTEGER NOT NULL DEFAULT 1 CHECK(resumable IN (0, 1)),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
      execution_owner TEXT NOT NULL DEFAULT '',
      execution_epoch INTEGER NOT NULL DEFAULT 0,
      lease_expires_at INTEGER NOT NULL DEFAULT 0,
      total_chapters INTEGER NOT NULL,
      total_content_size INTEGER NOT NULL DEFAULT 0,
      manifest_chapter_count INTEGER NOT NULL,
      manifest_content_size INTEGER NOT NULL DEFAULT 0,
      manifest_word_count INTEGER NOT NULL DEFAULT 0,
      completed_chapters INTEGER NOT NULL DEFAULT 0,
      base_run_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL,
      FOREIGN KEY (base_run_id) REFERENCES import_runs(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_import_runs_source_status
      ON import_runs(source_fingerprint, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_import_runs_resumable
      ON import_runs(resumable, status, updated_at);

    CREATE TABLE IF NOT EXISTS import_run_chapters (
      run_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      source_chapter_number INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      content_fingerprint TEXT NOT NULL,
      content_size INTEGER NOT NULL,
      content_snapshot TEXT NOT NULL,
      PRIMARY KEY (run_id, chapter_number),
      FOREIGN KEY (run_id) REFERENCES import_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_import_run_chapters_page
      ON import_run_chapters(run_id, chapter_number);

    CREATE TABLE IF NOT EXISTS import_run_sources (
      run_id TEXT NOT NULL,
      source_index INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      legacy_source_fingerprint TEXT NOT NULL DEFAULT '',
      display_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
      manifest_fingerprint TEXT NOT NULL DEFAULT '',
      chapter_count INTEGER NOT NULL DEFAULT 0,
      content_size INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, source_id),
      UNIQUE (run_id, source_index),
      FOREIGN KEY (run_id) REFERENCES import_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_run_source_chapters (
      run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content_fingerprint TEXT NOT NULL,
      content_size INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      content_snapshot TEXT NOT NULL,
      PRIMARY KEY (run_id, source_id, source_chapter_number),
      FOREIGN KEY (run_id, source_id) REFERENCES import_run_sources(run_id, source_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_import_run_source_chapters
      ON import_run_source_chapters(run_id, source_id, source_chapter_number);

    CREATE TABLE IF NOT EXISTS import_legacy_identity_bridge (
      id TEXT PRIMARY KEY,
      ciphertext_hex TEXT NOT NULL,
      iv_hex TEXT NOT NULL,
      auth_tag_hex TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_source_aliases (
      alias_digest TEXT PRIMARY KEY,
      alias_kind TEXT NOT NULL CHECK(alias_kind IN ('location', 'file')),
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_import_source_aliases_source
      ON import_source_aliases(source_id);

    CREATE TABLE IF NOT EXISTS import_source_chapter_map (
      purpose TEXT NOT NULL CHECK(purpose IN ('reference', 'author-manuscript')),
      source_id TEXT NOT NULL,
      source_chapter_number INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      PRIMARY KEY (purpose, source_id, source_chapter_number),
      UNIQUE (purpose, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS import_run_receipts (
      run_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      effect_namespace TEXT NOT NULL,
      effect_key TEXT NOT NULL,
      stage TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared', 'committed')),
      effect_receipt_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, stage, batch_id),
      UNIQUE (effect_namespace, effect_key),
      FOREIGN KEY (run_id) REFERENCES import_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_import_run_receipts_state
      ON import_run_receipts(run_id, state, stage);

    CREATE TABLE IF NOT EXISTS import_run_knowledge_receipts (
      run_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_chapter_number INTEGER NOT NULL,
      content_fingerprint TEXT NOT NULL,
      document_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state = 'committed'),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, chapter_number),
      FOREIGN KEY (run_id, chapter_number)
        REFERENCES import_run_chapters(run_id, chapter_number) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_import_run_knowledge_receipts_affiliation
      ON import_run_knowledge_receipts(
        purpose, source_id, source_chapter_number, content_fingerprint, state
      );

    CREATE TABLE IF NOT EXISTS import_reference_documents (
      document_id TEXT PRIMARY KEY,
      idempotency_key_hash TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      chunk_set_hash TEXT NOT NULL,
      expected_chunk_count INTEGER NOT NULL,
      corpus_kind TEXT NOT NULL CHECK(corpus_kind = 'reference'),
      state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared', 'committed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 10. 创作资料中枢 (Workspace Hub) — 外部来源、片段、规则与候选
    -- ============================================================
    CREATE TABLE IF NOT EXISTS workspace_sources (
      id TEXT NOT NULL PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'main',
      absolute_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      category TEXT NOT NULL,
      authority_status TEXT NOT NULL CHECK(authority_status IN (
        'confirmed', 'candidate', 'background', 'deprecated', 'reference', 'material'
      )),
      content_hash TEXT NOT NULL,
      observed_file_hash TEXT NOT NULL DEFAULT '',
      approved_content_hash TEXT NOT NULL DEFAULT '',
      observed_snapshot_id TEXT DEFAULT NULL,
      approved_snapshot_id TEXT DEFAULT NULL,
      parse_error TEXT DEFAULT NULL,
      parse_status TEXT NOT NULL DEFAULT 'parsed' CHECK(parse_status IN ('parsed', 'metadata_only', 'error')),
      skip_reason TEXT DEFAULT NULL,
      mtime INTEGER NOT NULL DEFAULT 0,
      last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      import_status TEXT NOT NULL DEFAULT 'scanned' CHECK(import_status IN (
        'scanned', 'imported', 'stale', 'missing', 'disabled'
      )),
      is_missing INTEGER NOT NULL DEFAULT 0 CHECK(is_missing IN (0, 1)),
      is_disabled INTEGER NOT NULL DEFAULT 0 CHECK(is_disabled IN (0, 1)),
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_sources_project_path
      ON workspace_sources(project_id, relative_path);
    -- commitScanPayload 的“该快照是否已被批准”护栏按 approved_snapshot_id 逐条
    -- 回查；缺少此索引时会退化为扫描本项目的全部来源行，千文件扫描约 156ms
    -- （已批准快照的不可变保护会随来源数量呈平方级增长）。
    CREATE INDEX IF NOT EXISTS idx_workspace_sources_approved_snapshot
      ON workspace_sources(project_id, approved_snapshot_id);

    CREATE TABLE IF NOT EXISTS workspace_binding_states (
      project_id TEXT NOT NULL PRIMARY KEY,
      current_path TEXT NOT NULL DEFAULT '',
      healthy_path TEXT NOT NULL DEFAULT '',
      healthy_scanned_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_binding_states_healthy
      ON workspace_binding_states(project_id, healthy_path);

    CREATE TABLE IF NOT EXISTS workspace_source_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      content_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      fragment_count INTEGER NOT NULL DEFAULT 0,
      parser_schema_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_source_snapshots_source
      ON workspace_source_snapshots(source_id);

    CREATE TABLE IF NOT EXISTS workspace_source_snapshot_fragments (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      heading_path TEXT NOT NULL,
      content TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      fragment_hash TEXT NOT NULL,
      chapter_start INTEGER DEFAULT NULL,
      chapter_end INTEGER DEFAULT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'stale', 'deprecated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES workspace_source_snapshots(snapshot_id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_fragments_snapshot
      ON workspace_source_snapshot_fragments(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_fragments_chapter
      ON workspace_source_snapshot_fragments(chapter_start, chapter_end);

    CREATE TABLE IF NOT EXISTS workspace_source_snapshot_rules (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'candidate', 'background', 'deprecated')),
      constraint_type TEXT NOT NULL DEFAULT 'hard' CHECK(constraint_type IN ('hard', 'soft')),
      scope TEXT NOT NULL DEFAULT 'global',
      source_fragment_id TEXT DEFAULT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      source_heading_path TEXT NOT NULL DEFAULT '',
      source_line_range TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES workspace_source_snapshots(snapshot_id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_rules_snapshot
      ON workspace_source_snapshot_rules(snapshot_id);

    CREATE TABLE IF NOT EXISTS workspace_approval_receipts (
      candidate_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'main',
      candidate_type TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL DEFAULT '',
      frozen_payload TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL CHECK(stage IN ('prepared', 'roster_committed', 'completed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_approval_receipts_stage
      ON workspace_approval_receipts(project_id, stage);

    CREATE TABLE IF NOT EXISTS chapter_context_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'main',
      chapter_number INTEGER NOT NULL,
      total_chars INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      bundle_text TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      blocks_json TEXT NOT NULL DEFAULT '[]',
      stale_warnings_json TEXT NOT NULL DEFAULT '[]',
      candidate_warnings_json TEXT NOT NULL DEFAULT '[]',
      omissions_json TEXT NOT NULL DEFAULT '[]',
      excluded_deprecated_count INTEGER NOT NULL DEFAULT 0,
      is_over_budget INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_context_snapshots_project_chapter
      ON chapter_context_snapshots(project_id, chapter_number);

    CREATE TABLE IF NOT EXISTS workspace_source_fragments (
      fragment_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      heading_path TEXT NOT NULL,
      content TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      fragment_hash TEXT NOT NULL,
      chapter_start INTEGER DEFAULT NULL,
      chapter_end INTEGER DEFAULT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'stale', 'deprecated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_fragments_source
      ON workspace_source_fragments(source_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_fragments_chapter
      ON workspace_source_fragments(chapter_start, chapter_end);

    CREATE TABLE IF NOT EXISTS setting_rules (
      rule_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN (
        'confirmed', 'candidate', 'background', 'deprecated'
      )),
      constraint_type TEXT NOT NULL DEFAULT 'hard' CHECK(constraint_type IN ('hard', 'soft')),
      scope TEXT NOT NULL DEFAULT 'global',
      source_fragment_id TEXT DEFAULT NULL,
      source_snapshot_fragment_id TEXT DEFAULT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      source_heading_path TEXT NOT NULL DEFAULT '',
      source_line_range TEXT NOT NULL DEFAULT '',
      confirmed_at TEXT DEFAULT NULL,
      confirmed_by TEXT DEFAULT NULL,
      origin_type TEXT NOT NULL DEFAULT 'manual' CHECK(origin_type IN ('manual', 'scan')),
      source_id TEXT DEFAULT NULL,
      source_snapshot_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, rule_id),
      FOREIGN KEY (source_fragment_id) REFERENCES workspace_source_fragments(fragment_id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_setting_rules_status
      ON setting_rules(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_setting_rules_scan_source
      ON setting_rules(project_id, origin_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_setting_rules_source_fragment
      ON setting_rules(source_fragment_id);

    CREATE TABLE IF NOT EXISTS workspace_hub_migration_audit (
      migration_id TEXT PRIMARY KEY,
      migrated_source_count INTEGER NOT NULL DEFAULT 0,
      migrated_fragment_count INTEGER NOT NULL DEFAULT 0,
      details_json TEXT NOT NULL DEFAULT '{}',
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_import_candidates (
      candidate_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      candidate_type TEXT NOT NULL CHECK(candidate_type IN ('character', 'setting', 'blueprint', 'lead')),
      raw_data TEXT NOT NULL,
      suggested_data TEXT NOT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      source_heading_path TEXT NOT NULL DEFAULT '',
      source_line_range TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      actioned_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, candidate_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_candidates_status
      ON workspace_import_candidates(project_id, candidate_type, status);
  `)

  // 章节蓝图的卷目录是项目事实。旧项目只有平铺章节，因此只在首次升级时将其
  // 归入默认第 1 卷；不改写章节号、草稿或正文关联。
  const blueprintColumns = new Set(
    (db.prepare('PRAGMA table_info(blueprints)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!blueprintColumns.has('volume_id')) {
    db.exec("ALTER TABLE blueprints ADD COLUMN volume_id TEXT NOT NULL DEFAULT 'volume-1'")
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS blueprint_volumes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blueprint_volumes_order
      ON blueprint_volumes(sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_blueprints_volume_chapter
      ON blueprints(volume_id, chapter_number);
    INSERT OR IGNORE INTO blueprint_volumes (id, name, sort_order)
      VALUES ('volume-1', '第1卷', 1);
    UPDATE blueprints SET volume_id = 'volume-1'
      WHERE volume_id IS NULL OR TRIM(volume_id) = '';
  `)

  const draftColumns = db.prepare('PRAGMA table_info(drafts)').all() as Array<{ name: string }>
  if (!draftColumns.some(column => column.name === 'source_dependencies')) {
    db.exec("ALTER TABLE drafts ADD COLUMN source_dependencies TEXT NOT NULL DEFAULT '[]'")
  }
  if (!draftColumns.some(column => column.name === 'blueprint_chapter_number')) {
    db.exec('ALTER TABLE drafts ADD COLUMN blueprint_chapter_number INTEGER DEFAULT NULL')
  }
  if (!draftColumns.some(column => column.name === 'imported_title')) {
    db.exec("ALTER TABLE drafts ADD COLUMN imported_title TEXT NOT NULL DEFAULT ''")
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_drafts_blueprint_chapter
      ON drafts(blueprint_chapter_number);
  `)

  // Legacy candidates did not freeze the draft identity. Keep them marked
  // unknown so update/continue fails closed instead of rebinding to today's draft.
  const recoveryCandidateColumns = new Set(
    (db.prepare('PRAGMA table_info(recovery_candidates)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!recoveryCandidateColumns.has('source_draft_id')) {
    db.exec('ALTER TABLE recovery_candidates ADD COLUMN source_draft_id INTEGER')
  }
  if (!recoveryCandidateColumns.has('source_draft_version')) {
    db.exec('ALTER TABLE recovery_candidates ADD COLUMN source_draft_version INTEGER')
  }
  if (!recoveryCandidateColumns.has('source_draft_identity_captured')) {
    db.exec('ALTER TABLE recovery_candidates ADD COLUMN source_draft_identity_captured INTEGER NOT NULL DEFAULT 0')
  }

  // Legacy rows cannot be safely rebound to today's mutable draft body. Add
  // nullable columns and leave old source identity unknown so merge/refine can fail closed.
  for (const table of ['revisions', 'reviews'] as const) {
    const columns = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name),
    )
    const addSourceColumn = (name: string, type: string) => {
      if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)
    }
    addSourceColumn('source_draft_chapter_number', 'INTEGER')
    addSourceColumn('source_draft_version', 'INTEGER')
    addSourceColumn('source_draft_status', 'TEXT')
    addSourceColumn('source_content', 'TEXT')
  }

  // Durable continuity facts were added to the existing summary projection so
  // older projects keep their legacy snapshots while new rows bind to a
  // finalized draft identity.
  const summaryColumns = new Set(
    (db.prepare('PRAGMA table_info(summary_snapshots)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!summaryColumns.has('draft_id')) {
    db.exec(`
      ALTER TABLE summary_snapshots
      ADD COLUMN draft_id INTEGER DEFAULT NULL REFERENCES drafts(id) ON DELETE CASCADE
    `)
  }
  if (!summaryColumns.has('chapter_notes')) {
    db.exec("ALTER TABLE summary_snapshots ADD COLUMN chapter_notes TEXT NOT NULL DEFAULT ''")
  }
  if (!summaryColumns.has('continuity_facts')) {
    db.exec("ALTER TABLE summary_snapshots ADD COLUMN continuity_facts TEXT NOT NULL DEFAULT '[]'")
  }
  if (!summaryColumns.has('character_state_candidates')) {
    db.exec("ALTER TABLE summary_snapshots ADD COLUMN character_state_candidates TEXT NOT NULL DEFAULT '[]'")
  }
  if (!summaryColumns.has('source_finalization_id')) {
    db.exec("ALTER TABLE summary_snapshots ADD COLUMN source_finalization_id TEXT NOT NULL DEFAULT ''")
  }
  if (!summaryColumns.has('source_content_hash')) {
    db.exec("ALTER TABLE summary_snapshots ADD COLUMN source_content_hash TEXT NOT NULL DEFAULT ''")
  }
  if (!summaryColumns.has('projection_generation')) {
    db.exec('ALTER TABLE summary_snapshots ADD COLUMN projection_generation INTEGER NOT NULL DEFAULT 0')
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS continuity_projection_meta (
      id TEXT PRIMARY KEY CHECK (id = 'main'),
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      stale_from_chapter INTEGER DEFAULT NULL CHECK (stale_from_chapter IS NULL OR stale_from_chapter > 0)
    );
    INSERT OR IGNORE INTO continuity_projection_meta (id) VALUES ('main');
  `)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_snapshots_draft
      ON summary_snapshots(draft_id) WHERE draft_id IS NOT NULL
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS consistency_exemptions (
      stable_fact_key TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0, 1))
    )
  `)

  // Import-run columns were introduced incrementally during pre-release development.
  // Existing project databases must receive the same lease and manifest invariants.
  const importRunColumns = new Set(
    (db.prepare('PRAGMA table_info(import_runs)').all() as Array<{ name: string }>).map(column => column.name),
  )
  const addImportRunColumn = (name: string, definition: string) => {
    if (importRunColumns.has(name)) return
    db.exec(`ALTER TABLE import_runs ADD COLUMN ${name} ${definition}`)
    importRunColumns.add(name)
  }
  addImportRunColumn('execution_owner', "TEXT NOT NULL DEFAULT ''")
  addImportRunColumn('execution_epoch', 'INTEGER NOT NULL DEFAULT 0')
  addImportRunColumn('lease_expires_at', 'INTEGER NOT NULL DEFAULT 0')
  addImportRunColumn('manifest_chapter_count', 'INTEGER NOT NULL DEFAULT 0')
  addImportRunColumn('manifest_content_size', 'INTEGER NOT NULL DEFAULT 0')
  addImportRunColumn('manifest_word_count', 'INTEGER NOT NULL DEFAULT 0')
  addImportRunColumn('purpose', "TEXT NOT NULL DEFAULT 'reference'")
  addImportRunColumn('root_run_id', "TEXT NOT NULL DEFAULT ''")
  addImportRunColumn('effect_namespace', "TEXT NOT NULL DEFAULT ''")
  addImportRunColumn('authority_fingerprint', "TEXT NOT NULL DEFAULT ''")
  addImportRunColumn('legacy_source_fingerprint', "TEXT NOT NULL DEFAULT ''")
  db.exec(`
    UPDATE import_runs
    SET manifest_chapter_count = CASE WHEN manifest_chapter_count = 0 THEN total_chapters ELSE manifest_chapter_count END,
        manifest_content_size = CASE WHEN manifest_content_size = 0 THEN total_content_size ELSE manifest_content_size END,
        root_run_id = CASE WHEN root_run_id = '' THEN id ELSE root_run_id END,
        effect_namespace = CASE WHEN effect_namespace = '' THEN 'import:reference:' || id ELSE effect_namespace END
  `)
  const importRunSchema = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'import_runs'
  `).get() as { sql: string } | undefined
  if (
    importRunSchema
    && (!importRunSchema.sql.includes("'parsing'") || !importRunSchema.sql.includes("'author-commit'"))
  ) {
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE import_runs_stage_v3 (
            id TEXT PRIMARY KEY,
            purpose TEXT NOT NULL DEFAULT 'reference' CHECK(purpose IN ('reference', 'author-manuscript')),
            root_run_id TEXT NOT NULL,
            effect_namespace TEXT NOT NULL,
            source_fingerprint TEXT NOT NULL,
            manifest_fingerprint TEXT NOT NULL,
            authority_fingerprint TEXT NOT NULL DEFAULT '',
            legacy_source_fingerprint TEXT NOT NULL DEFAULT '',
            source_display_json TEXT NOT NULL DEFAULT '[]',
            locale TEXT NOT NULL CHECK(locale IN ('zh-CN', 'en-US')),
            stage TEXT NOT NULL DEFAULT 'knowledge'
              CHECK(stage IN (
                'parsing', 'prepared', 'knowledge', 'global', 'style', 'blueprints',
                'author-commit', 'author-publish', 'author-postprocess',
                'refresh', 'completed'
              )),
            status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'running', 'failed', 'cancelled', 'completed')),
            completed_batches_json TEXT NOT NULL DEFAULT '{}',
            last_error TEXT NOT NULL DEFAULT '',
            resumable INTEGER NOT NULL DEFAULT 1 CHECK(resumable IN (0, 1)),
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
            execution_owner TEXT NOT NULL DEFAULT '',
            execution_epoch INTEGER NOT NULL DEFAULT 0,
            lease_expires_at INTEGER NOT NULL DEFAULT 0,
            total_chapters INTEGER NOT NULL,
            total_content_size INTEGER NOT NULL DEFAULT 0,
            manifest_chapter_count INTEGER NOT NULL,
            manifest_content_size INTEGER NOT NULL DEFAULT 0,
            manifest_word_count INTEGER NOT NULL DEFAULT 0,
            completed_chapters INTEGER NOT NULL DEFAULT 0,
            base_run_id TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT DEFAULT NULL,
            FOREIGN KEY (base_run_id) REFERENCES import_runs_stage_v3(id) ON DELETE SET NULL
          );
          INSERT INTO import_runs_stage_v3 (
            id, purpose, root_run_id, effect_namespace, source_fingerprint, manifest_fingerprint,
            authority_fingerprint, legacy_source_fingerprint,
            source_display_json, locale, stage, status, completed_batches_json, last_error,
            resumable, cancel_requested, execution_owner, execution_epoch, lease_expires_at,
            total_chapters, total_content_size, manifest_chapter_count, manifest_content_size,
            manifest_word_count, completed_chapters, base_run_id, created_at, updated_at, completed_at
          )
          SELECT
            id, purpose, root_run_id, effect_namespace, source_fingerprint, manifest_fingerprint,
            authority_fingerprint, legacy_source_fingerprint,
            source_display_json, locale, stage, status, completed_batches_json, last_error,
            resumable, cancel_requested, execution_owner, execution_epoch, lease_expires_at,
            total_chapters, total_content_size, manifest_chapter_count, manifest_content_size,
            manifest_word_count, completed_chapters, base_run_id, created_at, updated_at, completed_at
          FROM import_runs;
          DROP TABLE import_runs;
          ALTER TABLE import_runs_stage_v3 RENAME TO import_runs;
          CREATE INDEX idx_import_runs_source_status ON import_runs(source_fingerprint, status, updated_at);
          CREATE INDEX idx_import_runs_resumable ON import_runs(resumable, status, updated_at);
        `)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('导入运行阶段迁移破坏了外键约束')
  }
  const importChapterColumns = new Set(
    (db.prepare('PRAGMA table_info(import_run_chapters)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!importChapterColumns.has('source_id')) {
    db.exec("ALTER TABLE import_run_chapters ADD COLUMN source_id TEXT NOT NULL DEFAULT ''")
  }
  if (!importChapterColumns.has('source_chapter_number')) {
    db.exec('ALTER TABLE import_run_chapters ADD COLUMN source_chapter_number INTEGER NOT NULL DEFAULT 0')
  }
  db.exec(`
    UPDATE import_run_chapters
    SET source_id = 'legacy:' || COALESCE((
          SELECT runs.source_fingerprint FROM import_runs AS runs WHERE runs.id = import_run_chapters.run_id
        ), run_id),
        source_chapter_number = chapter_number
    WHERE source_id = '' OR source_chapter_number = 0;

    CREATE TABLE IF NOT EXISTS import_source_chapter_map (
      purpose TEXT NOT NULL CHECK(purpose IN ('reference', 'author-manuscript')),
      source_id TEXT NOT NULL,
      source_chapter_number INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      PRIMARY KEY (purpose, source_id, source_chapter_number),
      UNIQUE (purpose, chapter_number)
    );

    INSERT OR IGNORE INTO import_source_chapter_map (
      purpose, source_id, source_chapter_number, chapter_number
    )
    SELECT runs.purpose, chapters.source_id, chapters.source_chapter_number, chapters.chapter_number
    FROM import_run_chapters AS chapters
    JOIN import_runs AS runs ON runs.id = chapters.run_id
    ORDER BY runs.created_at, runs.rowid, chapters.chapter_number;
  `)
  const unmappedLegacyChapters = db.prepare(`
    SELECT DISTINCT runs.purpose, chapters.source_id, chapters.source_chapter_number
    FROM import_run_chapters AS chapters
    JOIN import_runs AS runs ON runs.id = chapters.run_id
    LEFT JOIN import_source_chapter_map AS source_map
      ON source_map.purpose = runs.purpose
      AND source_map.source_id = chapters.source_id
      AND source_map.source_chapter_number = chapters.source_chapter_number
    WHERE source_map.chapter_number IS NULL
    ORDER BY runs.created_at, runs.rowid, chapters.chapter_number
  `).all() as Array<{
    purpose: 'reference' | 'author-manuscript'
    source_id: string
    source_chapter_number: number
  }>
  const nextLegacyChapterByPurpose = new Map<string, number>()
  const insertLegacySourceMapping = db.prepare(`
    INSERT INTO import_source_chapter_map (
      purpose, source_id, source_chapter_number, chapter_number
    ) VALUES (?, ?, ?, ?)
  `)
  db.transaction(() => {
    for (const chapter of unmappedLegacyChapters) {
      let next = nextLegacyChapterByPurpose.get(chapter.purpose)
      if (next === undefined) {
        next = (db.prepare(`
          SELECT COALESCE(MAX(chapter_number), 0) AS value
          FROM import_source_chapter_map WHERE purpose = ?
        `).get(chapter.purpose) as { value: number }).value
      }
      next += 1
      nextLegacyChapterByPurpose.set(chapter.purpose, next)
      insertLegacySourceMapping.run(
        chapter.purpose,
        chapter.source_id,
        chapter.source_chapter_number,
        next,
      )
    }
  })()
  const legacyManifestRuns = db.prepare(`
    SELECT id, locale, manifest_chapter_count
    FROM import_runs
    WHERE manifest_word_count = 0 AND status <> 'completed' AND resumable = 1
      AND stage NOT IN ('parsing', 'prepared')
  `).all() as Array<{
    id: string
    locale: 'zh-CN' | 'en-US'
    manifest_chapter_count: number
  }>
  const readLegacySnapshots = db.prepare(`
    SELECT content_fingerprint, content_size, content_snapshot
    FROM import_run_chapters
    WHERE run_id = ?
    ORDER BY chapter_number
  `)
  const saveLegacyWordCount = db.prepare(`
    UPDATE import_runs
    SET manifest_word_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `)
  const rejectLegacyResume = db.prepare(`
    UPDATE import_runs
    SET status = 'failed', resumable = 0, cancel_requested = 0, last_error = ?,
        execution_owner = '', execution_epoch = execution_epoch + 1, lease_expires_at = 0,
        updated_at = datetime('now')
    WHERE id = ?
  `)
  db.transaction(() => {
    for (const run of legacyManifestRuns) {
      const snapshots = readLegacySnapshots.all(run.id) as Array<{
        content_fingerprint: string
        content_size: number
        content_snapshot: string
      }>
      const snapshotsAreComplete = run.manifest_chapter_count > 0
        && snapshots.length === run.manifest_chapter_count
        && snapshots.every(snapshot =>
          snapshot.content_snapshot.length > 0
          && Buffer.byteLength(snapshot.content_snapshot, 'utf8') === snapshot.content_size
          && createHash('sha256').update(snapshot.content_snapshot).digest('hex') === snapshot.content_fingerprint,
        )
      if (snapshotsAreComplete) {
        saveLegacyWordCount.run(
          snapshots.reduce((total, snapshot) => total + countDraftUnits(snapshot.content_snapshot), 0),
          run.id,
        )
        continue
      }
      rejectLegacyResume.run(
        run.locale === 'en-US'
          ? 'This legacy import is missing complete frozen chapter snapshots and cannot be resumed. Select the source again to restart.'
          : '该旧导入缺少完整的冻结章节快照，不可恢复；请重新选择来源后开始。',
        run.id,
      )
    }
  })()
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_runs_source_status
      ON import_runs(source_fingerprint, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_import_runs_resumable
      ON import_runs(resumable, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_import_runs_purpose_source_status
      ON import_runs(purpose, source_fingerprint, status, updated_at);
  `)
  const importReceiptColumns = new Set(
    (db.prepare('PRAGMA table_info(import_run_receipts)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!importReceiptColumns.has('schema_version')) {
    db.exec('ALTER TABLE import_run_receipts ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1')
  }
  const legacyIdentityTable = db.prepare(`
    SELECT 1 AS value FROM sqlite_master WHERE type = 'table' AND name = 'import_source_identity'
  `).get() as { value: number } | undefined
  if (legacyIdentityTable) {
    const migrationSecret = importSourceSecret ?? loadApplicationImportSourceSecret()
    if (!Buffer.isBuffer(migrationSecret) || migrationSecret.byteLength !== 32) {
      throw new Error('旧导入来源身份迁移需要有效的应用密钥')
    }
    const legacy = db.prepare('SELECT salt_hex FROM import_source_identity WHERE id = ?')
      .get('main') as { salt_hex: string } | undefined
    if (legacy) {
      const salt = Buffer.from(legacy.salt_hex, 'hex')
      if (salt.byteLength !== 32) throw new Error('旧导入来源身份盐损坏')
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', migrationSecret, iv)
      cipher.setAAD(Buffer.from('ai-novel:legacy-import-source-salt:v1', 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(salt), cipher.final()])
      db.prepare(`
        INSERT OR REPLACE INTO import_legacy_identity_bridge (
          id, ciphertext_hex, iv_hex, auth_tag_hex
        ) VALUES ('main', ?, ?, ?)
      `).run(ciphertext.toString('hex'), iv.toString('hex'), cipher.getAuthTag().toString('hex'))
    }
    db.exec('DROP TABLE import_source_identity')
  }
  // Opening a project database is a process/session boundary. Any persisted
  // running owner belonged to the previous handle and must be fenced before a
  // new renderer can resume the run.
  db.exec(`
    UPDATE import_runs
    SET execution_owner = '', execution_epoch = execution_epoch + 1, lease_expires_at = 0,
        updated_at = datetime('now')
    WHERE status = 'running' AND (execution_owner <> '' OR lease_expires_at <> 0)
  `)

  // 角色事实继续存放于 characters；这里仅建立 revision、迁移与幂等元数据。
  // 旧角色图谱原文在首次打开时只归档，不自动解析或改写。
  ensureCultivationSchema(db)
  ensureCharacterRosterSchema(db)
  ensureStoryDomainSchema(db)
  ensurePhase2To8Schema(db)

  // 兼容早期 #23 预览数据库：该表一旦已经存在，CREATE TABLE IF NOT EXISTS
  // 不会补列。正文快照必须留在 outbox，重试时不能再从可变 contents.body 回读。
  const outboxColumns = db.prepare('PRAGMA table_info(finalization_outbox)').all() as Array<{ name: string }>
  const addedContentSnapshotColumn = !outboxColumns.some(column => column.name === 'content_snapshot')
  if (addedContentSnapshotColumn) {
    db.exec(`
      ALTER TABLE finalization_outbox
      ADD COLUMN content_snapshot TEXT NOT NULL DEFAULT ''
    `)
    // 只在本次确实新增列时回填旧行。之后空正文也可能是合法冻结快照，绝不能在
    // 每次项目重开时又把它替换为可变 contents.body。
    db.exec(`
      UPDATE finalization_outbox
      SET content_snapshot = COALESCE((
        SELECT contents.body
        FROM drafts
        JOIN contents ON contents.id = drafts.content_id
        WHERE drafts.id = finalization_outbox.draft_id
      ), '')
      WHERE content_snapshot = ''
    `)
  }
  if (!outboxColumns.some(column => column.name === 'knowledge_document_id')) {
    db.exec(`
      ALTER TABLE finalization_outbox
      ADD COLUMN knowledge_document_id TEXT NOT NULL DEFAULT ''
    `)
  }

  const deletionColumns = new Set(
    (db.prepare('PRAGMA table_info(chapter_deletion_operations)').all() as Array<{ name: string }>)
      .map(column => column.name),
  )
  const addDeletionTextColumn = (column: string, defaultValue: string) => {
    if (deletionColumns.has(column)) return
    db.exec(`ALTER TABLE chapter_deletion_operations ADD COLUMN ${column} TEXT NOT NULL DEFAULT '${defaultValue}'`)
    deletionColumns.add(column)
  }
  addDeletionTextColumn('legacy_knowledge_authorization', 'not_required')
  addDeletionTextColumn('legacy_knowledge_authorized_at', '')

  // 旧项目把作者配置字段映射到架构字段，导致重开漂移。新列保持独立事实：
  // 大纲和世界设定可从旧显示来源无损继承；主角档案绝不复制 characters_arch，
  // 因为后者是结构化角色名单的派生投影。
  const projectCoreColumns = new Set(
    (db.prepare('PRAGMA table_info(project_core)').all() as Array<{ name: string }>).map(column => column.name),
  )
  const addProjectCoreTextColumn = (column: string, legacySource?: string) => {
    if (projectCoreColumns.has(column)) return
    db.exec(`ALTER TABLE project_core ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`)
    if (legacySource) db.exec(`UPDATE project_core SET ${column} = COALESCE(${legacySource}, '')`)
    projectCoreColumns.add(column)
  }
  addProjectCoreTextColumn('core_outline', 'synopsis')
  addProjectCoreTextColumn('world_setting', 'worldbuilding')
  addProjectCoreTextColumn('protagonist_profile')
  addProjectCoreTextColumn('plot_tree_snapshot')
  addProjectCoreTextColumn('external_workspace_path')
  addProjectCoreTextColumn('external_workspace_scanned_at')
  if (!projectCoreColumns.has('writing_language')) {
    db.exec("ALTER TABLE project_core ADD COLUMN writing_language TEXT NOT NULL DEFAULT 'zh-CN'")
    projectCoreColumns.add('writing_language')
  }
  if (!projectCoreColumns.has('creative_strategy')) {
    db.exec("ALTER TABLE project_core ADD COLUMN creative_strategy TEXT NOT NULL DEFAULT 'auto'")
    projectCoreColumns.add('creative_strategy')
  }
  if (!projectCoreColumns.has('narrative_thread_dormant_threshold')) {
    db.exec('ALTER TABLE project_core ADD COLUMN narrative_thread_dormant_threshold INTEGER NOT NULL DEFAULT 3')
    projectCoreColumns.add('narrative_thread_dormant_threshold')
  }

  const characterStateColumns = new Set(
    (db.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!characterStateColumns.has('cs_provenance')) {
    db.exec("ALTER TABLE characters ADD COLUMN cs_provenance TEXT NOT NULL DEFAULT '{}'")
  }

  // 兼容旧库：将「无 currentState」的哨兵 0 迁移为 NULL（chapter 0 合法状态不受影响）
  try {
    db.prepare(`
      UPDATE characters SET cs_updated_at_chapter = NULL
      WHERE cs_updated_at_chapter = 0
        AND IFNULL(cs_location, '') = ''
        AND IFNULL(cs_power_level, '') = ''
        AND IFNULL(cs_physical_state, '') = ''
        AND IFNULL(cs_mental_state, '') = ''
        AND IFNULL(cs_key_items, '') = ''
        AND IFNULL(cs_recent_events, '') = ''
    `).run()
  } catch {
    // 旧库结构差异时忽略
  }

  const workspaceSourcesColumns = new Set(
    (db.prepare('PRAGMA table_info(workspace_sources)').all() as Array<{ name: string }>).map(c => c.name),
  )
  if (workspaceSourcesColumns.size > 0) {
    if (!workspaceSourcesColumns.has('observed_file_hash')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN observed_file_hash TEXT NOT NULL DEFAULT ''")
      db.exec("UPDATE workspace_sources SET observed_file_hash = content_hash WHERE observed_file_hash = ''")
    }
    if (!workspaceSourcesColumns.has('approved_content_hash')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN approved_content_hash TEXT NOT NULL DEFAULT ''")
      db.exec("UPDATE workspace_sources SET approved_content_hash = content_hash WHERE approved_content_hash = ''")
    }
    if (!workspaceSourcesColumns.has('observed_snapshot_id')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN observed_snapshot_id TEXT DEFAULT NULL")
    }
    if (!workspaceSourcesColumns.has('approved_snapshot_id')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN approved_snapshot_id TEXT DEFAULT NULL")
    }
    if (!workspaceSourcesColumns.has('parse_error')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN parse_error TEXT DEFAULT NULL")
    }
    if (!workspaceSourcesColumns.has('file_size')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0")
    }
    if (!workspaceSourcesColumns.has('parse_status')) {
      db.exec("ALTER TABLE workspace_sources ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'parsed'")
    }
    if (!workspaceSourcesColumns.has('skip_reason')) {
      db.exec('ALTER TABLE workspace_sources ADD COLUMN skip_reason TEXT DEFAULT NULL')
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_binding_states (
      project_id TEXT NOT NULL PRIMARY KEY,
      current_path TEXT NOT NULL DEFAULT '',
      healthy_path TEXT NOT NULL DEFAULT '',
      healthy_scanned_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_binding_states_healthy
      ON workspace_binding_states(project_id, healthy_path);

    CREATE TABLE IF NOT EXISTS workspace_source_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      content_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      fragment_count INTEGER NOT NULL DEFAULT 0,
      parser_schema_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_source_snapshots_source
      ON workspace_source_snapshots(source_id);

    CREATE TABLE IF NOT EXISTS workspace_source_snapshot_fragments (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      heading_path TEXT NOT NULL,
      content TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      fragment_hash TEXT NOT NULL,
      chapter_start INTEGER DEFAULT NULL,
      chapter_end INTEGER DEFAULT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'stale', 'deprecated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES workspace_source_snapshots(snapshot_id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_fragments_snapshot
      ON workspace_source_snapshot_fragments(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_fragments_chapter
      ON workspace_source_snapshot_fragments(chapter_start, chapter_end);

    CREATE TABLE IF NOT EXISTS workspace_source_snapshot_rules (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'candidate', 'background', 'deprecated')),
      constraint_type TEXT NOT NULL DEFAULT 'hard' CHECK(constraint_type IN ('hard', 'soft')),
      scope TEXT NOT NULL DEFAULT 'global',
      source_fragment_id TEXT DEFAULT NULL,
      source_file TEXT NOT NULL DEFAULT '',
      source_heading_path TEXT NOT NULL DEFAULT '',
      source_line_range TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES workspace_source_snapshots(snapshot_id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES workspace_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_rules_snapshot
      ON workspace_source_snapshot_rules(snapshot_id);

    CREATE TABLE IF NOT EXISTS workspace_approval_receipts (
      candidate_id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'main',
      candidate_type TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL DEFAULT '',
      frozen_payload TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL CHECK(stage IN ('prepared', 'roster_committed', 'completed', 'compensated')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, candidate_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_approval_receipts_stage
      ON workspace_approval_receipts(project_id, stage);

    CREATE TABLE IF NOT EXISTS workspace_hub_migration_audit (
      migration_id TEXT PRIMARY KEY,
      migrated_source_count INTEGER NOT NULL DEFAULT 0,
      migrated_fragment_count INTEGER NOT NULL DEFAULT 0,
      details_json TEXT NOT NULL DEFAULT '{}',
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const settingRulePkColumns = (db.prepare('PRAGMA table_info(setting_rules)').all() as Array<{ name: string; pk: number }>)
    .filter(c => c.pk > 0)
    .map(c => c.name)
  if (settingRulePkColumns.length === 1 && settingRulePkColumns[0] === 'rule_id') {
    const legacySettingRuleColumns = new Set(
      (db.prepare('PRAGMA table_info(setting_rules)').all() as Array<{ name: string }>).map(c => c.name),
    )
    const legacySettingRuleIndexes = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'setting_rules' AND sql IS NOT NULL
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>
    const settingRuleColumnsToCopy = [
      'rule_id', 'project_id', 'title', 'content', 'status', 'constraint_type', 'scope',
      'source_fragment_id', 'source_snapshot_fragment_id', 'source_file',
      'source_heading_path', 'source_line_range', 'confirmed_at', 'confirmed_by',
      'origin_type', 'source_id', 'source_snapshot_id', 'created_at', 'updated_at',
    ]
    const missingColumnDefaults: Record<string, string> = {
      rule_id: "''",
      project_id: "'main'",
      title: "''",
      content: "''",
      status: "'confirmed'",
      constraint_type: "'hard'",
      scope: "'global'",
      source_fragment_id: 'NULL',
      source_snapshot_fragment_id: 'NULL',
      source_file: "''",
      source_heading_path: "''",
      source_line_range: "''",
      confirmed_at: 'NULL',
      confirmed_by: 'NULL',
      origin_type: "'manual'",
      source_id: 'NULL',
      source_snapshot_id: 'NULL',
      created_at: "datetime('now')",
      updated_at: "datetime('now')",
    }
    const quotedColumns = settingRuleColumnsToCopy.map(column => `"${column}"`).join(', ')
    const copyExpressions = settingRuleColumnsToCopy.map(column => (
      legacySettingRuleColumns.has(column) ? `"${column}"` : missingColumnDefaults[column]
    )).join(', ')

    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE setting_rules_stage_v2 (
            rule_id TEXT NOT NULL,
            project_id TEXT NOT NULL DEFAULT 'main',
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN (
              'confirmed', 'candidate', 'background', 'deprecated'
            )),
            constraint_type TEXT NOT NULL DEFAULT 'hard' CHECK(constraint_type IN ('hard', 'soft')),
            scope TEXT NOT NULL DEFAULT 'global',
            source_fragment_id TEXT DEFAULT NULL,
            source_snapshot_fragment_id TEXT DEFAULT NULL,
            source_file TEXT NOT NULL DEFAULT '',
            source_heading_path TEXT NOT NULL DEFAULT '',
            source_line_range TEXT NOT NULL DEFAULT '',
            confirmed_at TEXT DEFAULT NULL,
            confirmed_by TEXT DEFAULT NULL,
            origin_type TEXT NOT NULL DEFAULT 'manual' CHECK(origin_type IN ('manual', 'scan')),
            source_id TEXT DEFAULT NULL,
            source_snapshot_id TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, rule_id),
            FOREIGN KEY (source_fragment_id) REFERENCES workspace_source_fragments(fragment_id) ON DELETE SET NULL
          );
          INSERT INTO setting_rules_stage_v2 (${quotedColumns})
            SELECT ${copyExpressions} FROM setting_rules;
          DROP TABLE setting_rules;
          ALTER TABLE setting_rules_stage_v2 RENAME TO setting_rules;
        `)

        // Rebuild every named legacy index after the table swap. The required
        // indexes below are added afterwards so an existing index definition is
        // never silently replaced by an IF NOT EXISTS collision.
        for (const index of legacySettingRuleIndexes) db.exec(index.sql)
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_setting_rules_status
            ON setting_rules(project_id, status);
          CREATE INDEX IF NOT EXISTS idx_setting_rules_scan_source
            ON setting_rules(project_id, origin_type, source_id);
          CREATE INDEX IF NOT EXISTS idx_setting_rules_source_fragment
            ON setting_rules(source_fragment_id);
        `)

        const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check('setting_rules')").all()
        if (foreignKeyViolations.length > 0) {
          throw new Error('setting_rules 迁移后外键校验失败，已回滚')
        }
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }

  const settingRuleColumns = new Set(
    (db.prepare('PRAGMA table_info(setting_rules)').all() as Array<{ name: string }>).map(c => c.name),
  )
  if (!settingRuleColumns.has('origin_type')) {
    db.exec("ALTER TABLE setting_rules ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'manual'")
  }
  if (!settingRuleColumns.has('source_id')) {
    db.exec('ALTER TABLE setting_rules ADD COLUMN source_id TEXT DEFAULT NULL')
  }
  if (!settingRuleColumns.has('source_snapshot_id')) {
    db.exec('ALTER TABLE setting_rules ADD COLUMN source_snapshot_id TEXT DEFAULT NULL')
  }
  if (!settingRuleColumns.has('source_snapshot_fragment_id')) {
    db.exec('ALTER TABLE setting_rules ADD COLUMN source_snapshot_fragment_id TEXT DEFAULT NULL')
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_setting_rules_scan_source
    ON setting_rules(project_id, origin_type, source_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_setting_rules_source_fragment
    ON setting_rules(source_fragment_id)`)

  const snapshotColumns = new Set(
    (db.prepare('PRAGMA table_info(workspace_source_snapshots)').all() as Array<{ name: string }>).map(c => c.name),
  )
  if (!snapshotColumns.has('parser_schema_version')) {
    db.exec('ALTER TABLE workspace_source_snapshots ADD COLUMN parser_schema_version INTEGER NOT NULL DEFAULT 1')
  }

  const approvalReceiptPkColumns = (db.prepare('PRAGMA table_info(workspace_approval_receipts)').all() as Array<{ name: string; pk: number }>)
    .filter(c => c.pk > 0)
    .map(c => c.name)
  if (approvalReceiptPkColumns.length === 1 && approvalReceiptPkColumns[0] === 'candidate_id') {
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE workspace_approval_receipts_stage_v2 (
            candidate_id TEXT NOT NULL,
            project_id TEXT NOT NULL DEFAULT 'main',
            candidate_type TEXT NOT NULL,
            operation_id TEXT NOT NULL,
            payload_hash TEXT NOT NULL DEFAULT '',
            frozen_payload TEXT NOT NULL DEFAULT '',
            stage TEXT NOT NULL CHECK(stage IN ('prepared', 'roster_committed', 'completed', 'compensated')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, candidate_id)
          );
          INSERT OR IGNORE INTO workspace_approval_receipts_stage_v2 SELECT * FROM workspace_approval_receipts;
          DROP TABLE workspace_approval_receipts;
          ALTER TABLE workspace_approval_receipts_stage_v2 RENAME TO workspace_approval_receipts;
          CREATE INDEX IF NOT EXISTS idx_workspace_approval_receipts_stage
            ON workspace_approval_receipts(project_id, stage);
        `)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }

  const approvalReceiptColumns = new Set(
    (db.prepare('PRAGMA table_info(workspace_approval_receipts)').all() as Array<{ name: string }>).map(c => c.name),
  )
  if (!approvalReceiptColumns.has('payload_hash')) {
    db.exec("ALTER TABLE workspace_approval_receipts ADD COLUMN payload_hash TEXT NOT NULL DEFAULT ''")
  }
  if (!approvalReceiptColumns.has('frozen_payload')) {
    db.exec("ALTER TABLE workspace_approval_receipts ADD COLUMN frozen_payload TEXT NOT NULL DEFAULT ''")
  }

  const candidatePkColumns = (db.prepare('PRAGMA table_info(workspace_import_candidates)').all() as Array<{ name: string; pk: number }>)
    .filter(c => c.pk > 0)
    .map(c => c.name)
  if (candidatePkColumns.length === 1 && candidatePkColumns[0] === 'candidate_id') {
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE workspace_import_candidates_stage_v2 (
            candidate_id TEXT NOT NULL,
            project_id TEXT NOT NULL DEFAULT 'main',
            candidate_type TEXT NOT NULL CHECK(candidate_type IN ('character', 'setting', 'blueprint', 'lead')),
            raw_data TEXT NOT NULL,
            suggested_data TEXT NOT NULL,
            source_file TEXT NOT NULL DEFAULT '',
            source_heading_path TEXT NOT NULL DEFAULT '',
            source_line_range TEXT NOT NULL DEFAULT '',
            evidence TEXT NOT NULL DEFAULT '',
            confidence REAL NOT NULL DEFAULT 1.0,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            actioned_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, candidate_id)
          );
          INSERT OR IGNORE INTO workspace_import_candidates_stage_v2 SELECT * FROM workspace_import_candidates;
          DROP TABLE workspace_import_candidates;
          ALTER TABLE workspace_import_candidates_stage_v2 RENAME TO workspace_import_candidates;
          CREATE INDEX IF NOT EXISTS idx_workspace_candidates_status
            ON workspace_import_candidates(project_id, candidate_type, status);
        `)
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }

  migrateLegacyWorkspaceHubData(db)

  // 多地图地图册：旧库的节点/连线表没有 map_id。列必须可空或带默认值才能
  // 增量补齐；真正的归属由 world-map-atlas-migration 从旧图层回填。
  const nodeColumns = new Set(
    (db.prepare('PRAGMA table_info(world_map_nodes)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!nodeColumns.has('map_id')) {
    db.exec("ALTER TABLE world_map_nodes ADD COLUMN map_id TEXT NOT NULL DEFAULT ''")
  }
  if (!nodeColumns.has('marker_icon')) {
    db.exec('ALTER TABLE world_map_nodes ADD COLUMN marker_icon TEXT DEFAULT NULL')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_world_map_nodes_map ON world_map_nodes(map_id)')

  const edgeColumns = new Set(
    (db.prepare('PRAGMA table_info(world_map_edges)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!edgeColumns.has('map_id')) {
    db.exec('ALTER TABLE world_map_edges ADD COLUMN map_id TEXT DEFAULT NULL')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_world_map_edges_map ON world_map_edges(map_id)')

  // Existing databases only have the legacy project_core path. Backfill the
  // authoritative per-session state once, after legacy approved snapshots have
  // been promoted; runtime reads never fall back to legacy fragment tables.
  db.exec(`
    INSERT OR IGNORE INTO workspace_binding_states (
      project_id, current_path, healthy_path, healthy_scanned_at
    )
    SELECT 'main',
           COALESCE(external_workspace_path, ''),
           CASE WHEN EXISTS (
             SELECT 1 FROM workspace_sources
             WHERE project_id = 'main'
               AND approved_snapshot_id IS NOT NULL
               AND approved_snapshot_id <> ''
               AND is_missing = 0
           ) THEN COALESCE(external_workspace_path, '') ELSE '' END,
           COALESCE(external_workspace_scanned_at, '')
    FROM project_core
    WHERE id = 'main'
  `)

  // 故事时间树：旧库的 story_timeline_events 没有 branch_id 与 parent_event_id。
  // 增量补齐，同时确保默认 main 分支存在。
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_timeline_branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_event_id TEXT DEFAULT NULL,
      color TEXT DEFAULT NULL,
      sort_order REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_story_timeline_branches_source
      ON story_timeline_branches(source_event_id);
    INSERT OR IGNORE INTO story_timeline_branches (id, name, source_event_id, sort_order)
    VALUES ('main', '主时间轴', NULL, 0);
  `)
  const timelineColumns = new Set(
    (db.prepare('PRAGMA table_info(story_timeline_events)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!timelineColumns.has('branch_id')) {
    db.exec("ALTER TABLE story_timeline_events ADD COLUMN branch_id TEXT NOT NULL DEFAULT 'main'")
  }
  if (!timelineColumns.has('parent_event_id')) {
    db.exec('ALTER TABLE story_timeline_events ADD COLUMN parent_event_id TEXT DEFAULT NULL')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_events_branch ON story_timeline_events(branch_id, sort_order)')

  const settingsColumns = new Set(
    (db.prepare('PRAGMA table_info(story_timeline_settings)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (!settingsColumns.has('start_label')) {
    db.exec("ALTER TABLE story_timeline_settings ADD COLUMN start_label TEXT NOT NULL DEFAULT '故事开端'")
  }
  if (!settingsColumns.has('start_time_label')) {
    db.exec("ALTER TABLE story_timeline_settings ADD COLUMN start_time_label TEXT NOT NULL DEFAULT ''")
  }
  if (!settingsColumns.has('start_order')) {
    db.exec('ALTER TABLE story_timeline_settings ADD COLUMN start_order REAL DEFAULT NULL')
  }
  if (!settingsColumns.has('end_label')) {
    db.exec("ALTER TABLE story_timeline_settings ADD COLUMN end_label TEXT NOT NULL DEFAULT '故事结束'")
  }
  if (!settingsColumns.has('end_time_label')) {
    db.exec("ALTER TABLE story_timeline_settings ADD COLUMN end_time_label TEXT NOT NULL DEFAULT ''")
  }
  if (!settingsColumns.has('end_order')) {
    db.exec('ALTER TABLE story_timeline_settings ADD COLUMN end_order REAL DEFAULT NULL')
  }
  if (!settingsColumns.has('has_custom_range')) {
    db.exec('ALTER TABLE story_timeline_settings ADD COLUMN has_custom_range INTEGER NOT NULL DEFAULT 0')
  }

  ensureCharacterRelationshipSchema(db)
  ensureForeshadowingSchema(db)

  // 画布表在早期预览版本创建时还没有子画布关联列；这里按 PRAGMA 增量补列。
  const plotCanvasNodeColumns = new Set(
    (db.prepare('PRAGMA table_info(plot_canvas_nodes)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (plotCanvasNodeColumns.size > 0 && !plotCanvasNodeColumns.has('sub_canvas_id')) {
    db.exec(`
      ALTER TABLE plot_canvas_nodes
      ADD COLUMN sub_canvas_id TEXT DEFAULT NULL REFERENCES plot_canvases(id) ON DELETE SET NULL
    `)
  }

  // 剧情画布的说明与节点种类 / 标签 / 实体引用为增量字段：旧库升级后
  // description 落空字符串、kind 落 'plot'、tags / entity_refs 落空数组，
  // 既有画布与节点一行都不能丢。
  const plotCanvasColumns = new Set(
    (db.prepare('PRAGMA table_info(plot_canvases)').all() as Array<{ name: string }>).map(column => column.name),
  )
  if (plotCanvasColumns.size > 0 && !plotCanvasColumns.has('description')) {
    db.exec("ALTER TABLE plot_canvases ADD COLUMN description TEXT NOT NULL DEFAULT ''")
  }
  if (plotCanvasNodeColumns.size > 0 && !plotCanvasNodeColumns.has('kind')) {
    db.exec(`
      ALTER TABLE plot_canvas_nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'plot'
        CHECK(kind IN ('plot', 'idea', 'foreshadow', 'character', 'location',
                       'item', 'faction', 'skill', 'chapter', 'note'))
    `)
  }
  if (plotCanvasNodeColumns.size > 0 && !plotCanvasNodeColumns.has('tags')) {
    db.exec("ALTER TABLE plot_canvas_nodes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
  }
  if (plotCanvasNodeColumns.size > 0 && !plotCanvasNodeColumns.has('entity_refs')) {
    db.exec("ALTER TABLE plot_canvas_nodes ADD COLUMN entity_refs TEXT NOT NULL DEFAULT '[]'")
  }

  migrateDraftUnitCounts(db)
}

/** 确保伏笔管理数据表存在（支持新旧项目热迁移） */
export function ensureForeshadowingSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS foreshadowings (
      id TEXT PRIMARY KEY,
      draft_id INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      selected_text TEXT NOT NULL,
      start_offset INTEGER NOT NULL DEFAULT 0,
      end_offset INTEGER NOT NULL DEFAULT 0,
      context_before TEXT NOT NULL DEFAULT '',
      context_after TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      marker_type TEXT NOT NULL DEFAULT 'foreshadowing',
      color TEXT NOT NULL DEFAULT 'blue',
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL,
      FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_foreshadowings_draft ON foreshadowings(draft_id);
    CREATE INDEX IF NOT EXISTS idx_foreshadowings_chapter ON foreshadowings(chapter_number);
    CREATE INDEX IF NOT EXISTS idx_foreshadowings_completed ON foreshadowings(completed);
  `)
}

