import { createHash, randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { getProjectDb } from '../database'
import { CharacterRosterRepository } from './character-roster-repository'
import {
  characterRosterIdentityKey,
  type CharacterRosterCommitRequest,
  type CharacterRosterEntry,
} from '../../src/shared/character-roster'
import type {
  WorkspaceSource,
  WorkspaceSourceFragment,
  WorkspaceSourceSnapshot,
  WorkspaceSourceSnapshotFragment,
  SettingRule,
  SettingRuleStatus,
  SettingRuleConstraint,
  WorkspaceImportCandidate,
  WorkspaceImportCandidateType,
  WorkspaceImportCandidateStatus,
  WorkspaceHubStatus,
  WorkspaceAuthorityStatus,
  WorkspaceSourceCategory,
  ChapterContextSnapshot,
} from '../../src/shared/workspace-hub'

function requiredDb(): BetterSqlite3.Database {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function hashString(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

export interface StagedSourceItem {
  source: WorkspaceSource
  snapshot?: WorkspaceSourceSnapshot
  fragments?: WorkspaceSourceSnapshotFragment[]
  candidates?: WorkspaceImportCandidate[]
  rules?: SettingRule[]
  preserveOldSnapshots?: boolean
}

export interface StagedScanPayload {
  projectId: string
  items: StagedSourceItem[]
  activeSourceIds: string[]
  scanTime: string
  enumerationComplete?: boolean
  truncated?: boolean
  truncationReason?: string
}

const PROJECT_CORE_ROW_ID = 'main' 

interface ApprovableSourceRow {
  id: string
  project_id: string
  observed_snapshot_id: string | null
  observed_file_hash: string
  content_hash: string
}

function promoteSnapshotRules(
  db: BetterSqlite3.Database,
  source: ApprovableSourceRow,
  snapshotId: string,
): void {
  // 只替换同一扫描来源此前提升的规则；作者手工规则和其他来源一律不动。
  db.prepare(`
    DELETE FROM setting_rules
    WHERE project_id = ? AND origin_type = 'scan' AND source_id = ?
  `).run(source.project_id, source.id)

  const stagedRules = db.prepare(`
    SELECT id, title, content, status, constraint_type, scope,
           source_fragment_id, source_file, source_heading_path, source_line_range
    FROM workspace_source_snapshot_rules
    WHERE project_id = ? AND source_id = ? AND snapshot_id = ?
    ORDER BY id
  `).all(source.project_id, source.id, snapshotId) as Array<{
    id: string
    title: string
    content: string
    status: SettingRuleStatus
    constraint_type: SettingRuleConstraint
    scope: string
    source_fragment_id?: string
    source_file: string
    source_heading_path: string
    source_line_range: string
  }>

  const insertEffectiveRule = db.prepare(`
    INSERT INTO setting_rules (
      rule_id, project_id, title, content, status, constraint_type, scope,
      source_fragment_id, source_snapshot_fragment_id, source_file, source_heading_path, source_line_range,
      confirmed_at, confirmed_by, origin_type, source_id, source_snapshot_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?,
              CASE WHEN ? = 'confirmed' THEN datetime('now') ELSE NULL END,
              'source-approval', 'scan', ?, ?, datetime('now'))
  `)

  for (const rule of stagedRules) {
    const manualOverride = db.prepare(`
      SELECT 1 FROM setting_rules
      WHERE project_id = ? AND origin_type = 'manual'
        AND source_file = ? AND source_heading_path = ?
      LIMIT 1
    `).get(source.project_id, rule.source_file, rule.source_heading_path)
    if (manualOverride) continue

    let fragId = rule.source_fragment_id
    if (!fragId) {
      const matchFrag = db.prepare(`
        SELECT id FROM workspace_source_snapshot_fragments
        WHERE snapshot_id = ? AND heading_path = ?
        LIMIT 1
      `).get(snapshotId, rule.source_heading_path) as { id: string } | undefined
      fragId = matchFrag?.id
    }

    insertEffectiveRule.run(
      `effective-${rule.id}`,
      source.project_id,
      rule.title,
      rule.content,
      rule.status,
      rule.constraint_type,
      rule.scope,
      fragId ?? null,
      rule.source_file,
      rule.source_heading_path,
      rule.source_line_range,
      rule.status,
      source.id,
      snapshotId,
    )
  }
}

function approveObservedSnapshot(db: BetterSqlite3.Database, source: ApprovableSourceRow): void {
  const snapshotId = source.observed_snapshot_id
  if (!snapshotId) throw new Error('来源没有可批准的观察快照')

  const snapshot = db.prepare(`
    SELECT snapshot_id, content_hash, fragment_count, file_size
    FROM workspace_source_snapshots
    WHERE snapshot_id = ? AND source_id = ? AND project_id = ?
  `).get(snapshotId, source.id, source.project_id) as {
    snapshot_id: string
    content_hash: string
    fragment_count: number
    file_size: number
  } | undefined
  if (!snapshot) throw new Error('无法确认观察快照完整性，已拒绝批准')

  // 1. 验证实际片段数与 fragment_count 一致
  const actualFragmentCount = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM workspace_source_snapshot_fragments
    WHERE snapshot_id = ? AND source_id = ? AND project_id = ?
  `).get(snapshotId, source.id, source.project_id) as { count: number }).count

  if (actualFragmentCount !== snapshot.fragment_count) {
    throw new Error(`快照片段数不一致（记录: ${snapshot.fragment_count}, 实际: ${actualFragmentCount}），已拒绝批准`)
  }

  // 2. metadata_only 快照合法片段数必须为 0
  const sourceCategory = (db.prepare(`
    SELECT category, parse_status FROM workspace_sources WHERE id = ? AND project_id = ?
  `).get(source.id, source.project_id) as { category?: string; parse_status?: string } | undefined)

  if (sourceCategory?.category === 'reference_novel' || sourceCategory?.parse_status === 'metadata_only') {
    if (actualFragmentCount !== 0) {
      throw new Error('元数据快照包含非零片段，已拒绝批准')
    }
  }

  // 3. 验证所有暂存规则引用的片段属于同一快照
  const stagedRules = db.prepare(`
    SELECT id, source_fragment_id
    FROM workspace_source_snapshot_rules
    WHERE snapshot_id = ?
  `).all(snapshotId) as Array<{ id: string; source_fragment_id?: string | null }>

  for (const r of stagedRules) {
    if (r.source_fragment_id) {
      const fragmentMatches = db.prepare(`
        SELECT 1 FROM workspace_source_snapshot_fragments
        WHERE id = ? AND snapshot_id = ?
      `).get(r.source_fragment_id, snapshotId)
      if (!fragmentMatches) {
        throw new Error(`暂存规则 ${r.id} 引用的片段 ${r.source_fragment_id} 不属于当前快照`)
      }
    }
  }

  promoteSnapshotRules(db, source, snapshotId)
  db.prepare(`
    UPDATE workspace_sources
    SET approved_snapshot_id = ?, approved_content_hash = ?, import_status = 'imported',
        updated_at = datetime('now')
    WHERE id = ? AND project_id = ?
  `).run(snapshotId, source.observed_file_hash || snapshot.content_hash || source.content_hash, source.id, source.project_id)
}

function freezeCharacterApprovalRequest(
  suggestedData: string,
  operationId: string,
): CharacterRosterCommitRequest {
  const parsed = JSON.parse(suggestedData) as CharacterRosterEntry
  const currentSnapshot = CharacterRosterRepository.read()
  const existingEntries = [...currentSnapshot.entries]
  const matchIdx = existingEntries.findIndex(
    entry => characterRosterIdentityKey(entry.name) === characterRosterIdentityKey(parsed.name),
  )

  let mergedEntries: CharacterRosterEntry[]
  if (matchIdx >= 0) {
    const old = existingEntries[matchIdx]
    mergedEntries = [
      ...existingEntries.slice(0, matchIdx),
      {
        ...old,
        role: parsed.role || old.role,
        gender: parsed.gender || old.gender,
        age: parsed.age || old.age,
        appearance: parsed.appearance || old.appearance,
        personality: parsed.personality || old.personality,
        background: parsed.background || old.background,
        abilities: parsed.abilities || old.abilities,
        motivation: parsed.motivation || old.motivation,
        arc: parsed.arc || old.arc,
        notes: parsed.notes && !old.notes.includes(parsed.notes)
          ? `${old.notes}\n${parsed.notes}`.trim()
          : old.notes,
        relationships: parsed.relationships && parsed.relationships.length > 0
          ? parsed.relationships
          : old.relationships,
      },
      ...existingEntries.slice(matchIdx + 1),
    ]
  } else {
    mergedEntries = [...existingEntries, parsed]
  }

  return {
    operationId,
    expectedRevision: currentSnapshot.revision,
    schemaVersion: 1,
    entries: mergedEntries,
    intent: 'manual_edit',
  }
}

export class WorkspaceHubRepository {
  /** 获取中枢摘要状态 */
  static getStatus(projectId = 'main'): WorkspaceHubStatus {
    const db = requiredDb()
    const projectRow = db.prepare(`
      SELECT external_workspace_path, external_workspace_scanned_at
      FROM project_core WHERE id = ?
    `).get(PROJECT_CORE_ROW_ID) as { external_workspace_path?: string; external_workspace_scanned_at?: string } | undefined

    const counts = db.prepare(`
      SELECT
        COUNT(*) AS total_files,
        SUM(CASE WHEN category <> 'other' THEN 1 ELSE 0 END) AS recognized_files,
        SUM(CASE WHEN is_missing = 1 THEN 1 ELSE 0 END) AS missing_files,
        SUM(CASE
          WHEN approved_snapshot_id IS NOT NULL
           AND approved_snapshot_id <> ''
           AND observed_snapshot_id IS NOT NULL
           AND observed_snapshot_id <> approved_snapshot_id
          THEN 1 ELSE 0 END) AS changed_files
      FROM workspace_sources
      WHERE project_id = ? AND is_disabled = 0
    `).get(projectId) as {
      total_files: number
      recognized_files: number
      missing_files: number
      changed_files: number
    }

    const pendingCandidates = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM workspace_import_candidates
      WHERE project_id = ? AND status = 'pending'
    `).get(projectId) as { count: number }).count

    const confirmedRulesCount = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM setting_rules
      WHERE project_id = ? AND status = 'confirmed'
    `).get(projectId) as { count: number }).count

    return {
      externalWorkspacePath: projectRow?.external_workspace_path ?? '',
      lastScannedAt: projectRow?.external_workspace_scanned_at ?? '',
      totalFiles: counts?.total_files ?? 0,
      recognizedFiles: counts?.recognized_files ?? 0,
      missingFiles: counts?.missing_files ?? 0,
      changedFiles: counts?.changed_files ?? 0,
      pendingCandidates,
      confirmedRulesCount,
    }
  }

  /** 获取当前项目关联的外部母稿绝对路径 */
  static getBoundWorkspacePath(_projectId = 'main'): string {
    void _projectId
    const db = requiredDb()
    const row = db.prepare(`
      SELECT external_workspace_path FROM project_core WHERE id = ?
    `).get(PROJECT_CORE_ROW_ID) as { external_workspace_path?: string } | undefined
    return row?.external_workspace_path ?? ''
  }

  /** 关联外部创作母稿目录 */
  static bindWorkspaceDirectory(externalPath: string, _projectId = 'main'): void {
    void _projectId
    const db = requiredDb()
    db.prepare('INSERT OR IGNORE INTO project_core (id) VALUES (?)').run(PROJECT_CORE_ROW_ID)
    const result = db.prepare(`
      UPDATE project_core
      SET external_workspace_path = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(externalPath.trim(), PROJECT_CORE_ROW_ID)
    if (result.changes !== 1) {
      throw new Error(`未能绑定外部目录到 project_core: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
    }
  }

  /** 解除外部目录关联（仅清空关联记录与索引，绝不删除外部文件） */
  static unbindWorkspaceDirectory(projectId = 'main'): void {
    const db = requiredDb()
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO project_core (id) VALUES (?)').run(PROJECT_CORE_ROW_ID)
      const result = db.prepare(`
        UPDATE project_core
        SET external_workspace_path = '', external_workspace_scanned_at = '', updated_at = datetime('now')
        WHERE id = ?
      `).run(PROJECT_CORE_ROW_ID)
      if (result.changes !== 1) {
        throw new Error(`未能更新 project_core 主记录: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }
      // 清空关联的外部来源记录与快照缓存
      db.prepare('DELETE FROM workspace_sources WHERE project_id = ?').run(projectId)
    })()
  }

  /** 记录扫描完成时间 */
  static recordScanTime(timestamp: string, _projectId = 'main'): void {
    void _projectId
    const db = requiredDb()
    db.prepare('INSERT OR IGNORE INTO project_core (id) VALUES (?)').run(PROJECT_CORE_ROW_ID)
    const result = db.prepare(`
      UPDATE project_core
      SET external_workspace_scanned_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(timestamp, PROJECT_CORE_ROW_ID)
    if (result.changes !== 1) {
      throw new Error(`未能更新 project_core 扫描时间: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
    }
  }

  /** 获取所有外部来源文件列表 */
  static listSources(projectId = 'main'): WorkspaceSource[] {
    const db = requiredDb()
    const rows = db.prepare(`
      SELECT id, project_id, absolute_path, relative_path, category, authority_status,
             content_hash, observed_file_hash, approved_content_hash,
             observed_snapshot_id, approved_snapshot_id, parse_error, parse_status, skip_reason,
             mtime, last_scanned_at, import_status, is_missing, is_disabled, file_size
      FROM workspace_sources
      WHERE project_id = ?
      ORDER BY relative_path ASC
    `).all(projectId) as Array<{
      id: string
      project_id: string
      absolute_path: string
      relative_path: string
      category: WorkspaceSourceCategory
      authority_status: WorkspaceAuthorityStatus
      content_hash: string
      observed_file_hash: string
      approved_content_hash: string
      observed_snapshot_id: string | null
      approved_snapshot_id: string | null
      parse_error: string | null
      parse_status: 'parsed' | 'metadata_only' | 'error'
      skip_reason: string | null
      mtime: number
      last_scanned_at: string
      import_status: 'scanned' | 'imported' | 'stale' | 'missing' | 'disabled'
      is_missing: number
      is_disabled: number
      file_size: number
    }>

    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      absolutePath: r.absolute_path,
      relativePath: r.relative_path,
      category: r.category,
      authorityStatus: r.authority_status,
      contentHash: r.content_hash,
      observedFileHash: r.observed_file_hash,
      approvedContentHash: r.approved_content_hash,
      observedSnapshotId: r.observed_snapshot_id,
      approvedSnapshotId: r.approved_snapshot_id,
      parseError: r.parse_error,
      parseStatus: r.parse_status,
      skipReason: r.skip_reason,
      mtime: r.mtime,
      lastScannedAt: r.last_scanned_at,
      importStatus: r.import_status,
      isMissing: r.is_missing === 1,
      isDisabled: r.is_disabled === 1,
      fileSize: r.file_size,
    }))
  }

  /** 获取单个外部来源详情及其片段列表 */
  static getSourceDetail(
    sourceId: string,
    projectId = 'main',
    snapshotId?: string | null,
    fragmentId?: string | null,
  ): {
    source: WorkspaceSource | null
    fragments: WorkspaceSourceFragment[]
    targetSnapshotId?: string | null
    provenanceStatus?: 'found' | 'provenance-missing'
  } {
    const db = requiredDb()
    const r = db.prepare(`
      SELECT id, project_id, absolute_path, relative_path, category, authority_status,
             content_hash, observed_file_hash, approved_content_hash,
             observed_snapshot_id, approved_snapshot_id, parse_error, parse_status, skip_reason,
             mtime, last_scanned_at, import_status, is_missing, is_disabled, file_size
      FROM workspace_sources
      WHERE id = ? AND project_id = ?
    `).get(sourceId, projectId) as {
      id: string
      project_id: string
      absolute_path: string
      relative_path: string
      category: WorkspaceSourceCategory
      authority_status: WorkspaceAuthorityStatus
      content_hash: string
      observed_file_hash: string
      approved_content_hash: string
      observed_snapshot_id: string | null
      approved_snapshot_id: string | null
      parse_error: string | null
      parse_status: 'parsed' | 'metadata_only' | 'error'
      skip_reason: string | null
      mtime: number
      last_scanned_at: string
      import_status: 'scanned' | 'imported' | 'stale' | 'missing' | 'disabled'
      is_missing: number
      is_disabled: number
      file_size: number
    } | undefined

    if (!r) return { source: null, fragments: [], targetSnapshotId: null, provenanceStatus: 'provenance-missing' }

    // 严禁默认展示 observed_snapshot_id！默认优先展示 approved_snapshot_id，只有在尚未首次批准时才允许回退到 observed
    const targetSnapshotId = snapshotId || r.approved_snapshot_id || r.observed_snapshot_id
    let fragments: Array<{
      fragment_id: string
      source_id: string
      heading_path: string
      content: string
      start_line: number
      end_line: number
      fragment_hash: string
      chapter_start: number | null
      chapter_end: number | null
      purpose: string
      status: 'active' | 'stale' | 'deprecated'
    }> = []

    let provenanceStatus: 'found' | 'provenance-missing' = 'found'

    if (targetSnapshotId) {
      // 强制限制 project_id，并严格校验 snapshot_id 与 source_id
      const snapRows = db.prepare(`
        SELECT id AS fragment_id, source_id, heading_path, content, start_line, end_line,
               fragment_hash, chapter_start, chapter_end, purpose, status
        FROM workspace_source_snapshot_fragments
        WHERE snapshot_id = ? AND source_id = ? AND project_id = ?
        ORDER BY start_line ASC
      `).all(targetSnapshotId, sourceId, projectId) as typeof fragments
      fragments = snapRows

      if (fragmentId) {
        // 校验 snapshot_id, source_id, fragment_id 三者一致，不得静默回退
        const matched = fragments.find(f => f.fragment_id === fragmentId)
        if (!matched) {
          provenanceStatus = 'provenance-missing'
        }
      } else if (snapshotId && fragments.length === 0) {
        provenanceStatus = 'provenance-missing'
      }
    } else {
      provenanceStatus = 'provenance-missing'
    }

    return {
      source: {
        id: r.id,
        projectId: r.project_id,
        absolutePath: r.absolute_path,
        relativePath: r.relative_path,
        category: r.category,
        authorityStatus: r.authority_status,
        contentHash: r.content_hash,
        observedFileHash: r.observed_file_hash,
        approvedContentHash: r.approved_content_hash,
        observedSnapshotId: r.observed_snapshot_id,
        approvedSnapshotId: r.approved_snapshot_id,
        parseError: r.parse_error,
        parseStatus: r.parse_status,
        skipReason: r.skip_reason,
        mtime: r.mtime,
        lastScannedAt: r.last_scanned_at,
        importStatus: r.import_status,
        isMissing: r.is_missing === 1,
        isDisabled: r.is_disabled === 1,
        fileSize: r.file_size,
      },
      fragments: fragments.map(f => ({
        fragmentId: f.fragment_id,
        sourceId: f.source_id,
        headingPath: f.heading_path,
        content: f.content,
        startLine: f.start_line,
        endLine: f.end_line,
        fragmentHash: f.fragment_hash,
        chapterStart: f.chapter_start,
        chapterEnd: f.chapter_end,
        purpose: f.purpose,
        status: f.status,
      })),
      targetSnapshotId: targetSnapshotId || null,
      provenanceStatus,
    }
  }

  /** 隔离记录单个文件的解析异常（保留其旧快照，不覆盖已有健康片段） */
  static recordFileParseError(sourceId: string, relPath: string, errorMsg: string, projectId = 'main'): void {
    const db = requiredDb()
    db.prepare(`
      INSERT INTO workspace_sources (
        id, project_id, absolute_path, relative_path, category, authority_status,
        content_hash, observed_file_hash, approved_content_hash, parse_error, parse_status, skip_reason,
        mtime, last_scanned_at, import_status, is_missing, is_disabled, updated_at
      ) VALUES (?, ?, '', ?, 'other', 'material', '', '', '', ?, 'error', 'read_or_parse_failed',
                0, datetime('now'), 'scanned', 0, 0, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        parse_error = excluded.parse_error,
        parse_status = 'error',
        skip_reason = 'read_or_parse_failed',
        updated_at = datetime('now')
    `).run(sourceId, projectId, relPath, errorMsg)
  }

  /**
   * 单事务原子提交扫描快照（Phase 5 Atomic Commit）
   * 若取消或发生致命异常，数据库事务完整回滚，上一次成功快照完整保留。
   */
  static commitScanPayload(payload: StagedScanPayload): void {
    const db = requiredDb()
    db.transaction(() => {
      const upsertSourceStmt = db.prepare(`
        INSERT INTO workspace_sources (
          id, project_id, absolute_path, relative_path, category, authority_status,
          content_hash, observed_file_hash, approved_content_hash,
          observed_snapshot_id, approved_snapshot_id, parse_error, parse_status, skip_reason,
          mtime, last_scanned_at, import_status, is_missing, is_disabled, file_size, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          absolute_path = excluded.absolute_path,
          relative_path = excluded.relative_path,
          category = excluded.category,
          authority_status = excluded.authority_status,
          content_hash = excluded.content_hash,
          observed_file_hash = excluded.observed_file_hash,
          approved_content_hash = CASE
            WHEN workspace_sources.approved_content_hash = '' THEN excluded.approved_content_hash
            ELSE workspace_sources.approved_content_hash
          END,
          observed_snapshot_id = CASE
            WHEN excluded.observed_snapshot_id IS NOT NULL THEN excluded.observed_snapshot_id
            ELSE workspace_sources.observed_snapshot_id
          END,
          approved_snapshot_id = CASE
            WHEN workspace_sources.approved_snapshot_id IS NOT NULL THEN workspace_sources.approved_snapshot_id
            ELSE excluded.approved_snapshot_id
          END,
          parse_error = excluded.parse_error,
          parse_status = excluded.parse_status,
          skip_reason = excluded.skip_reason,
          mtime = excluded.mtime,
          last_scanned_at = excluded.last_scanned_at,
          import_status = excluded.import_status,
          is_missing = excluded.is_missing,
          is_disabled = excluded.is_disabled,
          file_size = excluded.file_size,
          updated_at = datetime('now')
      `)

      const insertSnapshotStmt = db.prepare(`
        INSERT INTO workspace_source_snapshots (
          snapshot_id, source_id, project_id, content_hash, file_size, fragment_count, parser_schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(snapshot_id) DO UPDATE SET
          file_size = excluded.file_size,
          fragment_count = excluded.fragment_count,
          parser_schema_version = excluded.parser_schema_version
        WHERE workspace_source_snapshots.source_id = excluded.source_id
          AND workspace_source_snapshots.project_id = excluded.project_id
          AND workspace_source_snapshots.content_hash = excluded.content_hash
          AND workspace_source_snapshots.snapshot_id NOT IN (
            SELECT approved_snapshot_id FROM workspace_sources
            WHERE project_id = excluded.project_id AND approved_snapshot_id IS NOT NULL
          )
      `)

      const insertSnapshotFragmentStmt = db.prepare(`
        INSERT INTO workspace_source_snapshot_fragments (
          id, snapshot_id, source_id, project_id, heading_path, content,
          start_line, end_line, fragment_hash, chapter_start, chapter_end, purpose, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          heading_path = excluded.heading_path,
          content = excluded.content,
          start_line = excluded.start_line,
          end_line = excluded.end_line,
          fragment_hash = excluded.fragment_hash,
          chapter_start = excluded.chapter_start,
          chapter_end = excluded.chapter_end,
          purpose = excluded.purpose,
          status = excluded.status
        WHERE workspace_source_snapshot_fragments.snapshot_id = excluded.snapshot_id
          AND workspace_source_snapshot_fragments.source_id = excluded.source_id
          AND workspace_source_snapshot_fragments.snapshot_id NOT IN (
            SELECT approved_snapshot_id FROM workspace_sources
            WHERE project_id = excluded.project_id AND approved_snapshot_id IS NOT NULL
          )
      `)

      const insertSnapshotRuleStmt = db.prepare(`
        INSERT INTO workspace_source_snapshot_rules (
          id, snapshot_id, source_id, project_id, title, content, status,
          constraint_type, scope, source_fragment_id, source_file,
          source_heading_path, source_line_range
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          status = excluded.status,
          constraint_type = excluded.constraint_type,
          scope = excluded.scope,
          source_fragment_id = excluded.source_fragment_id,
          source_file = excluded.source_file,
          source_heading_path = excluded.source_heading_path,
          source_line_range = excluded.source_line_range
        WHERE workspace_source_snapshot_rules.snapshot_id = excluded.snapshot_id
          AND workspace_source_snapshot_rules.source_id = excluded.source_id
          AND workspace_source_snapshot_rules.snapshot_id NOT IN (
            SELECT approved_snapshot_id FROM workspace_sources
            WHERE project_id = excluded.project_id AND approved_snapshot_id IS NOT NULL
          )
      `)

      const insertCandidateStmt = db.prepare(`
        INSERT INTO workspace_import_candidates (
          candidate_id, project_id, candidate_type, raw_data, suggested_data,
          source_file, source_heading_path, source_line_range, evidence,
          confidence, status, actioned_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(candidate_id) DO NOTHING
      `)

      for (const item of payload.items) {
        const s = item.source
        if (!s || !s.id) {
          throw new Error('Invalid source payload: source id cannot be null or empty')
        }

        upsertSourceStmt.run(
          s.id,
          s.projectId,
          s.absolutePath,
          s.relativePath,
          s.category,
          s.authorityStatus,
          s.contentHash,
          s.observedFileHash || s.contentHash,
          s.approvedContentHash || '',
          s.observedSnapshotId ?? null,
          s.approvedSnapshotId ?? null,
          s.parseError ?? null,
          s.parseStatus ?? 'parsed',
          s.skipReason ?? null,
          s.mtime,
          s.lastScannedAt,
          s.importStatus,
          s.isMissing ? 1 : 0,
          s.isDisabled ? 1 : 0,
          s.fileSize ?? 0,
        )

        if (item.snapshot && !item.preserveOldSnapshots) {
          insertSnapshotStmt.run(
            item.snapshot.snapshotId,
            item.snapshot.sourceId,
            item.snapshot.projectId,
            item.snapshot.contentHash,
            item.snapshot.fileSize,
            item.snapshot.fragmentCount,
            item.snapshot.parserSchemaVersion ?? 1,
          )

          if (item.fragments && item.fragments.length > 0) {
            for (const f of item.fragments) {
              insertSnapshotFragmentStmt.run(
                f.id,
                f.snapshotId,
                f.sourceId,
                f.projectId,
                f.headingPath,
                f.content,
                f.startLine,
                f.endLine,
                f.fragmentHash,
                f.chapterStart,
                f.chapterEnd,
                f.purpose,
                f.status,
              )

            }
          }

          if (item.rules && item.rules.length > 0) {
            item.rules.forEach((rule, index) => {
              insertSnapshotRuleStmt.run(
                `${item.snapshot!.snapshotId}-r-${index + 1}`,
                item.snapshot!.snapshotId,
                item.source.id,
                item.source.projectId,
                rule.title,
                rule.content,
                rule.status,
                rule.constraintType,
                rule.scope,
                rule.sourceFragmentId ?? null,
                rule.sourceFile,
                rule.sourceHeadingPath,
                rule.sourceLineRange,
              )

            })
          }
        }

        if (item.candidates && item.candidates.length > 0) {
          for (const c of item.candidates) {
            insertCandidateStmt.run(
              c.candidateId,
              c.projectId,
              c.candidateType,
              c.rawData,
              c.suggestedData,
              c.sourceFile,
              c.sourceHeadingPath,
              c.sourceLineRange,
              c.evidence,
              c.confidence,
              c.status,
              c.actionedAt ?? null,
            )
          }
        }

      }

      // 仅在完整遍历未被截断且无关键错误时，才执行全局缺失文件标记
      if (payload.enumerationComplete) {
        if (payload.activeSourceIds.length === 0) {
          db.prepare(`
            UPDATE workspace_sources
            SET is_missing = 1, import_status = 'missing', updated_at = datetime('now')
            WHERE project_id = ?
          `).run(payload.projectId)
        } else {
          const placeholders = payload.activeSourceIds.map(() => '?').join(',')
          db.prepare(`
            UPDATE workspace_sources
            SET is_missing = 1, import_status = 'missing', updated_at = datetime('now')
            WHERE project_id = ? AND id NOT IN (${placeholders})
          `).run(payload.projectId, ...payload.activeSourceIds)
        }
      }

      // 更新扫描完成时间（写入 project_core 主记录）
      db.prepare('INSERT OR IGNORE INTO project_core (id) VALUES (?)').run(PROJECT_CORE_ROW_ID)
      const scanTimeUpdate = db.prepare(`
        UPDATE project_core
        SET external_workspace_scanned_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(payload.scanTime, PROJECT_CORE_ROW_ID)
      if (scanTimeUpdate.changes !== 1) {
        throw new Error(`未能更新 project_core 扫描时间: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }
    })()
  }

  /**
   * 批准来源文件内容（原子切换 approved_snapshot_id = observed_snapshot_id，更新 approved_content_hash，消除 stale 状态）
   */
  static approveSource(sourceId: string, projectId = 'main'): { success: boolean; error?: string } {
    const db = requiredDb()
    const source = db.prepare(`
      SELECT id, project_id, observed_snapshot_id, observed_file_hash, content_hash
      FROM workspace_sources
      WHERE id = ? AND project_id = ?
    `).get(sourceId, projectId) as ApprovableSourceRow | undefined

    if (!source) {
      return { success: false, error: '来源不存在' }
    }

    try {
      db.transaction(() => approveObservedSnapshot(db, source))()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 批量批准当前所有来源为已批准快照（首次扫描后的全量确认） */
  static approveAllSources(projectId = 'main'): { success: boolean; count: number } {
    const db = requiredDb()
    const sources = db.prepare(`
      SELECT id, project_id, observed_snapshot_id, observed_file_hash, content_hash
      FROM workspace_sources
      WHERE project_id = ? AND is_missing = 0 AND is_disabled = 0
        AND observed_snapshot_id IS NOT NULL AND observed_snapshot_id <> ''
        AND (approved_snapshot_id IS NULL OR approved_snapshot_id <> observed_snapshot_id)
      ORDER BY id
    `).all(projectId) as ApprovableSourceRow[]

    try {
      db.transaction(() => {
        for (const source of sources) approveObservedSnapshot(db, source)
      })()
      return { success: true, count: sources.length }
    } catch {
      // 批准完整性无法确认时整批失败关闭，避免形成部分批准状态。
      return { success: false, count: 0 }
    }
  }

  /**
   * 查询经过批准的活动片段（默认仅读取 approved 快照，未经批准来源不进入正文上下文）
   */
  static queryFragments(options: {
    projectId?: string
    categories?: WorkspaceSourceCategory[]
    chapterNumber?: number
    excludeDeprecated?: boolean
  }): Array<WorkspaceSourceFragment & {
    sourcePath: string
    category: WorkspaceSourceCategory
    authorityStatus: WorkspaceAuthorityStatus
    approvedSnapshotId?: string | null
  }> {
    const db = requiredDb()
    const projectId = options.projectId ?? 'main'
    const whereClauses: string[] = [
      'src.project_id = ?',
      'src.is_missing = 0',
      'src.is_disabled = 0',
      "src.approved_snapshot_id IS NOT NULL",
      "src.approved_snapshot_id <> ''",
    ]
    const params: unknown[] = [projectId]

    if (options.excludeDeprecated) {
      whereClauses.push("src.authority_status <> 'deprecated'")
      whereClauses.push("frag.status <> 'deprecated'")
    }

    if (options.categories && options.categories.length > 0) {
      whereClauses.push(`src.category IN (${options.categories.map(() => '?').join(',')})`)
      params.push(...options.categories)
    }

    if (options.chapterNumber !== undefined) {
      whereClauses.push(`(
        (frag.chapter_start IS NULL AND frag.chapter_end IS NULL)
        OR (frag.chapter_start <= ? AND (frag.chapter_end IS NULL OR frag.chapter_end >= ?))
      )`)
      params.push(options.chapterNumber, options.chapterNumber)
    }

    // 正文上下文默认只能读取已批准的快照版本；废案条目允许作为负向约束被读取
    const sql = `
      SELECT
        frag.id AS fragment_id, frag.source_id, frag.heading_path, frag.content,
        frag.start_line, frag.end_line, frag.fragment_hash,
        frag.chapter_start, frag.chapter_end, frag.purpose,
        CASE WHEN frag.status = 'deprecated' THEN 'deprecated' ELSE 'active' END AS status,
        src.relative_path AS source_path, src.category, src.authority_status,
        src.approved_snapshot_id
      FROM workspace_source_snapshot_fragments AS frag
      JOIN workspace_sources AS src
        ON src.id = frag.source_id AND src.approved_snapshot_id = frag.snapshot_id
      JOIN workspace_source_snapshots AS snap
        ON snap.snapshot_id = src.approved_snapshot_id
       AND snap.snapshot_id = frag.snapshot_id
       AND snap.source_id = src.id
       AND snap.project_id = src.project_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY src.category ASC, frag.start_line ASC
    `

    let rows: Array<{
      fragment_id: string
      source_id: string
      heading_path: string
      content: string
      start_line: number
      end_line: number
      fragment_hash: string
      chapter_start: number | null
      chapter_end: number | null
      purpose: string
      status: 'active' | 'stale' | 'deprecated'
      source_path: string
      category: WorkspaceSourceCategory
      authority_status: WorkspaceAuthorityStatus
      approved_snapshot_id: string | null
    }> = []

    try {
      rows = db.prepare(sql).all(...params) as typeof rows
    } catch {
      rows = []
    }

    return rows.map(r => ({
      fragmentId: r.fragment_id,
      sourceId: r.source_id,
      headingPath: r.heading_path,
      content: r.content,
      startLine: r.start_line,
      endLine: r.end_line,
      fragmentHash: r.fragment_hash,
      chapterStart: r.chapter_start,
      chapterEnd: r.chapter_end,
      purpose: r.purpose,
      status: r.status,
      sourcePath: r.source_path,
      category: r.category,
      authorityStatus: r.authority_status,
      approvedSnapshotId: r.approved_snapshot_id,
    }))
  }

  // ============================================================
  // 设定规则管理
  // ============================================================

  static listRules(projectId = 'main', status?: SettingRuleStatus): SettingRule[] {
    const db = requiredDb()
    let query = `
      SELECT rule_id, project_id, title, content, status, constraint_type, scope,
             source_fragment_id, source_snapshot_fragment_id, source_file, source_heading_path, source_line_range,
             confirmed_at, confirmed_by, origin_type, source_id, source_snapshot_id,
             created_at, updated_at
      FROM setting_rules
      WHERE project_id = ?
    `
    const params: unknown[] = [projectId]
    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }
    query += ' ORDER BY created_at DESC'

    const rows = db.prepare(query).all(...params) as Array<{
      rule_id: string
      project_id: string
      title: string
      content: string
      status: SettingRuleStatus
      constraint_type: SettingRuleConstraint
      scope: string
      source_fragment_id?: string
      source_snapshot_fragment_id?: string
      source_file: string
      source_heading_path: string
      source_line_range: string
      confirmed_at?: string
      confirmed_by?: string
      origin_type: 'manual' | 'scan'
      source_id: string | null
      source_snapshot_id: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map(r => ({
      ruleId: r.rule_id,
      projectId: r.project_id,
      title: r.title,
      content: r.content,
      status: r.status,
      constraintType: r.constraint_type,
      scope: r.scope,
      sourceFragmentId: r.source_snapshot_fragment_id || r.source_fragment_id,
      sourceSnapshotFragmentId: r.source_snapshot_fragment_id || r.source_fragment_id,
      sourceFile: r.source_file,
      sourceHeadingPath: r.source_heading_path,
      sourceLineRange: r.source_line_range,
      confirmedAt: r.confirmed_at,
      confirmedBy: r.confirmed_by,
      originType: r.origin_type,
      sourceId: r.source_id,
      sourceSnapshotId: r.source_snapshot_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  static upsertRule(rule: SettingRule): void {
    const db = requiredDb()
    const r = rule as unknown as Record<string, unknown>
    const ruleId = rule.ruleId || String(r.id || '')
    const projectId = rule.projectId || String(r.project_id || 'main')
    const constraintType = (rule.constraintType || r.constraint_type || 'hard') as SettingRuleConstraint
    const scope = rule.scope || String(r.scope || 'global')
    const sourceFragmentId = (rule.sourceFragmentId || r.source_fragment_id || null) as string | null
    const sourceSnapshotFragmentId = (rule.sourceSnapshotFragmentId || r.source_snapshot_fragment_id || sourceFragmentId) as string | null
    const sourceFile = rule.sourceFile || String(r.source_file || '')
    const sourceHeadingPath = rule.sourceHeadingPath || String(r.source_heading_path || '')
    const sourceLineRange = rule.sourceLineRange || String(r.source_line_range || '')
    const confirmedAt = (rule.confirmedAt || r.confirmed_at || null) as string | null
    const confirmedBy = (rule.confirmedBy || r.confirmed_by || null) as string | null

    // 该入口仅供作者/显式候选审批写入；扫描规则只能经快照批准事务提升。
    db.prepare(`
      INSERT INTO setting_rules (
        rule_id, project_id, title, content, status, constraint_type, scope,
        source_fragment_id, source_snapshot_fragment_id, source_file, source_heading_path, source_line_range,
        confirmed_at, confirmed_by, origin_type, source_id, source_snapshot_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, datetime('now'))
      ON CONFLICT(rule_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        status = excluded.status,
        constraint_type = excluded.constraint_type,
        scope = excluded.scope,
        source_fragment_id = excluded.source_fragment_id,
        source_snapshot_fragment_id = excluded.source_snapshot_fragment_id,
        source_file = excluded.source_file,
        source_heading_path = excluded.source_heading_path,
        source_line_range = excluded.source_line_range,
        confirmed_at = excluded.confirmed_at,
        confirmed_by = excluded.confirmed_by,
        origin_type = 'manual',
        source_id = NULL,
        source_snapshot_id = NULL,
        updated_at = datetime('now')
    `).run(
      ruleId,
      projectId,
      rule.title,
      rule.content,
      rule.status,
      constraintType,
      scope,
      sourceFragmentId,
      sourceSnapshotFragmentId,
      sourceFile,
      sourceHeadingPath,
      sourceLineRange,
      confirmedAt,
      confirmedBy,
    )
  }

  static updateRuleStatus(
    ruleId: string,
    projectIdOrStatus: string | SettingRuleStatus = 'main',
    maybeStatus?: SettingRuleStatus,
    confirmedBy?: string,
  ): void {
    const db = requiredDb()
    const validStatuses: SettingRuleStatus[] = ['confirmed', 'candidate', 'background', 'deprecated']
    let projectId = 'main'
    let status: SettingRuleStatus
    let author = confirmedBy ?? 'author'

    if (validStatuses.includes(projectIdOrStatus as SettingRuleStatus)) {
      status = projectIdOrStatus as SettingRuleStatus
      if (typeof maybeStatus === 'string') author = maybeStatus
    } else {
      projectId = projectIdOrStatus
      status = maybeStatus ?? 'confirmed'
    }

    const result = db.prepare(`
      UPDATE setting_rules
      SET status = ?,
          confirmed_at = CASE WHEN ? = 'confirmed' THEN datetime('now') ELSE confirmed_at END,
          confirmed_by = CASE WHEN ? = 'confirmed' THEN ? ELSE confirmed_by END,
          origin_type = 'manual',
          source_id = NULL,
          source_snapshot_id = NULL,
          updated_at = datetime('now')
      WHERE rule_id = ? AND project_id = ?
    `).run(status, status, status, author, ruleId, projectId)

    if (result.changes !== 1) {
      throw new Error(`未找到属于项目 ${projectId} 的规则: ${ruleId}`)
    }
  }

  static deleteRule(ruleId: string, projectId = 'main'): void {
    const db = requiredDb()
    const result = db.prepare('DELETE FROM setting_rules WHERE rule_id = ? AND project_id = ?').run(ruleId, projectId)
    if (result.changes !== 1) {
      throw new Error(`未找到属于项目 ${projectId} 的规则: ${ruleId}`)
    }
  }

  // ============================================================
  // 导入与变更候选管理（带审批回执与崩溃恢复机制）
  // ============================================================

  static listCandidates(options?: {
    projectId?: string
    candidateType?: WorkspaceImportCandidateType
    status?: WorkspaceImportCandidateStatus
  }): WorkspaceImportCandidate[] {
    const db = requiredDb()
    const projectId = options?.projectId ?? 'main'
    const whereClauses: string[] = ['project_id = ?']
    const params: unknown[] = [projectId]

    if (options?.candidateType) {
      whereClauses.push('candidate_type = ?')
      params.push(options.candidateType)
    }
    if (options?.status) {
      whereClauses.push('status = ?')
      params.push(options.status)
    }

    const sql = `
      SELECT candidate_id, project_id, candidate_type, raw_data, suggested_data,
             source_file, source_heading_path, source_line_range, evidence,
             confidence, status, actioned_at, created_at
      FROM workspace_import_candidates
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
    `

    const rows = db.prepare(sql).all(...params) as Array<{
      candidate_id: string
      project_id: string
      candidate_type: WorkspaceImportCandidateType
      raw_data: string
      suggested_data: string
      source_file: string
      source_heading_path: string
      source_line_range: string
      evidence: string
      confidence: number
      status: WorkspaceImportCandidateStatus
      actioned_at?: string
      created_at: string
    }>

    return rows.map(r => ({
      candidateId: r.candidate_id,
      projectId: r.project_id,
      candidateType: r.candidate_type,
      rawData: r.raw_data,
      suggestedData: r.suggested_data,
      sourceFile: r.source_file,
      sourceHeadingPath: r.source_heading_path,
      sourceLineRange: r.source_line_range,
      evidence: r.evidence,
      confidence: r.confidence,
      status: r.status,
      actionedAt: r.actioned_at,
      createdAt: r.created_at,
    }))
  }

  static saveCandidate(candidate: WorkspaceImportCandidate): void {
    const db = requiredDb()
    db.prepare(`
      INSERT INTO workspace_import_candidates (
        candidate_id, project_id, candidate_type, raw_data, suggested_data,
        source_file, source_heading_path, source_line_range, evidence,
        confidence, status, actioned_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(candidate_id) DO NOTHING
    `).run(
      candidate.candidateId,
      candidate.projectId,
      candidate.candidateType,
      candidate.rawData,
      candidate.suggestedData,
      candidate.sourceFile,
      candidate.sourceHeadingPath,
      candidate.sourceLineRange,
      candidate.evidence,
      candidate.confidence,
      candidate.status,
      candidate.actionedAt ?? null,
    )
  }

  /**
   * 作者批准候选项目
   * 包含持久化审批回执机制（prepared -> roster_committed -> completed）与崩溃恢复防护：
   * 若在 roster_committed 后崩溃，重试时直接读取已提交状态，绝不重复写入角色备注或关系。
   */
  static approveCandidate<TStage extends string = string>(
    candidateId: string,
    projectId: string = 'main',
    authorName: string | ((stage: TStage) => void) = 'author',
    testCrashHook?: (stage: TStage) => void,
  ): { success: boolean; error?: string } {
    let actualProjectId = projectId
    let actualAuthor: string = typeof authorName === 'string' ? authorName : 'author'
    let actualCrashHook: ((stage: string) => void) | undefined = typeof authorName === 'function'
      ? (authorName as unknown as (stage: string) => void)
      : (testCrashHook as unknown as ((stage: string) => void) | undefined)

    const db = requiredDb()
    db.prepare('INSERT OR IGNORE INTO project_core (id) VALUES (?)').run(PROJECT_CORE_ROW_ID)

    // 兼容历史测试可能传入 (candidateId, 'author') 或 (candidateId, 'author', crashHook)
    if (projectId === 'author') {
      const exists = db.prepare('SELECT 1 FROM workspace_import_candidates WHERE candidate_id = ? AND project_id = ?').get(candidateId, 'author')
      if (!exists) {
        actualProjectId = 'main'
        actualAuthor = typeof authorName === 'string' ? authorName : 'author'
        if (typeof authorName === 'function') {
          actualCrashHook = authorName as unknown as ((stage: string) => void)
        }
      }
    }

    let candidate = db.prepare(`
      SELECT * FROM workspace_import_candidates WHERE candidate_id = ? AND project_id = ?
    `).get(candidateId, actualProjectId) as {
      candidate_id: string
      project_id: string
      candidate_type: WorkspaceImportCandidateType
      raw_data: string
      suggested_data: string
      source_file: string
      source_heading_path: string
      source_line_range: string
      status: string
    } | undefined

    if (!candidate && actualProjectId !== 'main') {
      const fallback = db.prepare(`
        SELECT * FROM workspace_import_candidates WHERE candidate_id = ? AND project_id = 'main'
      `).get(candidateId) as typeof candidate
      if (fallback) {
        actualAuthor = actualProjectId
        actualProjectId = 'main'
        candidate = fallback
      }
    }

    if (!candidate) {
      return { success: false, error: '候选项目不存在' }
    }

    // 检查审批回执
    let existingReceipt = db.prepare(`
      SELECT candidate_id, project_id, candidate_type, operation_id, payload_hash, frozen_payload, stage
      FROM workspace_approval_receipts
      WHERE candidate_id = ? AND project_id = ?
    `).get(candidateId, actualProjectId) as {
      candidate_id: string
      project_id: string
      candidate_type: string
      operation_id: string
      payload_hash: string
      frozen_payload: string
      stage: 'prepared' | 'roster_committed' | 'completed'
    } | undefined

    // 崩溃恢复：若发现 candidate 已 approved 但回执未 completed，执行一致性闭合
    if (candidate.status === 'approved') {
      if (existingReceipt && existingReceipt.stage !== 'completed') {
        db.prepare(`
          UPDATE workspace_approval_receipts
          SET stage = 'completed', updated_at = datetime('now')
          WHERE candidate_id = ? AND project_id = ?
        `).run(candidateId, actualProjectId)
      }
      return { success: true }
    }

    if (existingReceipt?.stage === 'completed') {
      db.prepare(`
        UPDATE workspace_import_candidates
        SET status = 'approved', actioned_at = datetime('now')
        WHERE candidate_id = ? AND project_id = ?
      `).run(candidateId, actualProjectId)
      return { success: true }
    }

    try {
      const candidateContentHash = hashString(candidate.suggested_data)
      // 确定性生成 operationId（严禁 randomUUID）
      const deterministicOpId = `workspace-approve-${candidate.candidate_id}-${candidateContentHash.slice(0, 8)}`

      if (existingReceipt && existingReceipt.operation_id !== deterministicOpId) {
        throw new Error('审批回执 operationId 与候选冻结内容不一致')
      }

      // 阶段 1: 在任何正式写入前冻结确定性 operationId 与完整提交请求。
      if (!existingReceipt) {
        const frozenPayload = candidate.candidate_type === 'character'
          ? JSON.stringify(freezeCharacterApprovalRequest(candidate.suggested_data, deterministicOpId))
          : candidate.suggested_data
        const frozenPayloadHash = hashString(frozenPayload)
        db.prepare(`
          INSERT INTO workspace_approval_receipts (
            candidate_id, project_id, candidate_type, operation_id,
            payload_hash, frozen_payload, stage, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'prepared', datetime('now'), datetime('now'))
        `).run(
          candidate.candidate_id,
          candidate.project_id,
          candidate.candidate_type,
          deterministicOpId,
          frozenPayloadHash,
          frozenPayload,
        )
        existingReceipt = db.prepare(`
          SELECT candidate_id, project_id, candidate_type, operation_id,
                 payload_hash, frozen_payload, stage
          FROM workspace_approval_receipts WHERE candidate_id = ? AND project_id = ?
        `).get(candidateId, actualProjectId) as typeof existingReceipt
      }

      const invokeTestCrashHook = (
        stage: 'prepared' | 'after_roster_commit_before_receipt' | 'roster_committed' | 'after_candidate_approved_before_receipt',
      ) => {
        if (actualCrashHook && (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true')) {
          actualCrashHook(stage)
        }
      }

      invokeTestCrashHook('prepared')

      if (!existingReceipt) throw new Error('无法建立审批 prepared 回执')
      const requiresFrozenPayload = existingReceipt.stage === 'prepared' || candidate.candidate_type === 'setting'
      if (requiresFrozenPayload) {
        if (!existingReceipt.frozen_payload || !existingReceipt.payload_hash) {
          throw new Error('审批 prepared 回执缺少冻结负载，已拒绝重新计算')
        }
        if (hashString(existingReceipt.frozen_payload) !== existingReceipt.payload_hash) {
          throw new Error('审批冻结负载哈希不一致')
        }
      }

      // 阶段 2: prepared 重试始终复用同一冻结请求。角色库先以 operationId
      // 幂等确认提交，再推进 workspace 回执；两者之间保留真实崩溃注入窗口。
      if (candidate.candidate_type === 'character' && existingReceipt.stage === 'prepared') {
        const frozenRequest = JSON.parse(existingReceipt.frozen_payload) as CharacterRosterCommitRequest
        if (frozenRequest.operationId !== existingReceipt.operation_id) {
          throw new Error('审批冻结请求 operationId 不一致')
        }
        CharacterRosterRepository.commit(frozenRequest)
        invokeTestCrashHook('after_roster_commit_before_receipt')

        db.prepare(`
          UPDATE workspace_approval_receipts
          SET stage = 'roster_committed', updated_at = datetime('now')
          WHERE candidate_id = ? AND project_id = ? AND stage = 'prepared'
        `).run(candidateId, actualProjectId)
        existingReceipt = { ...existingReceipt, stage: 'roster_committed' }
      }

      invokeTestCrashHook('roster_committed')

      if (candidate.candidate_type === 'setting') {
        const parsed = JSON.parse(existingReceipt.frozen_payload) as {
          title: string
          content: string
          constraintType?: SettingRuleConstraint
          scope?: string
        }
        const deterministicRuleId = `rule-${hashString(`${candidate.source_file}:${candidate.source_heading_path}`).slice(0, 16)}`

        // 设定规则写入、候选 approved 与回执 completed 在同一数据库事务内原子闭环
        db.transaction(() => {
          WorkspaceHubRepository.upsertRule({
            ruleId: deterministicRuleId,
            projectId: candidate.project_id,
            title: parsed.title || candidate.source_heading_path || '未命名规则',
            content: parsed.content || candidate.raw_data,
            status: 'confirmed',
            constraintType: parsed.constraintType ?? 'hard',
            scope: parsed.scope ?? 'global',
            sourceFile: candidate.source_file,
            sourceHeadingPath: candidate.source_heading_path,
            sourceLineRange: candidate.source_line_range,
            confirmedAt: new Date().toISOString(),
            confirmedBy: actualAuthor,
          })

          db.prepare(`
            UPDATE workspace_import_candidates
            SET status = 'approved', actioned_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ?
          `).run(candidateId, actualProjectId)

          invokeTestCrashHook('after_candidate_approved_before_receipt')

          db.prepare(`
            UPDATE workspace_approval_receipts
            SET stage = 'completed', updated_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ?
          `).run(candidateId, actualProjectId)
        })()

        return { success: true }
      }

      // 阶段 3: 角色类型候选原子完成候选状态与回执
      db.transaction(() => {
        db.prepare(`
          UPDATE workspace_import_candidates
          SET status = 'approved', actioned_at = datetime('now')
          WHERE candidate_id = ? AND project_id = ?
        `).run(candidateId, actualProjectId)

        invokeTestCrashHook('after_candidate_approved_before_receipt')

        db.prepare(`
          UPDATE workspace_approval_receipts
          SET stage = 'completed', updated_at = datetime('now')
          WHERE candidate_id = ? AND project_id = ?
        `).run(candidateId, actualProjectId)
      })()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 作者拒绝候选项目（带明确项目会话隔离与 dangling prepared 回执清理） */
  static rejectCandidate(candidateId: string, projectId = 'main'): { success: boolean; error?: string } {
    const db = requiredDb()
    const candidate = db.prepare(`
      SELECT candidate_id, status FROM workspace_import_candidates
      WHERE candidate_id = ? AND project_id = ?
    `).get(candidateId, projectId) as { candidate_id: string; status: string } | undefined

    if (!candidate) {
      return { success: false, error: '候选项目不存在' }
    }
    if (candidate.status === 'approved') {
      return { success: false, error: '已批准的候选无法直接拒绝' }
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE workspace_import_candidates
        SET status = 'rejected', actioned_at = datetime('now')
        WHERE candidate_id = ? AND project_id = ?
      `).run(candidateId, projectId)

      // 清理未完成的 prepared 审批回执
      db.prepare(`
        DELETE FROM workspace_approval_receipts
        WHERE candidate_id = ? AND project_id = ? AND stage = 'prepared'
      `).run(candidateId, projectId)
    })()

    return { success: true }
  }

  /** 保存章节上下文快照到独立表 chapter_context_snapshots，绝不篡改 blueprints */
  static saveChapterContextSnapshot(snapshot: ChapterContextSnapshot): { success: boolean; snapshotId: string } {
    const db = requiredDb()
    const snapshotId = snapshot.id || `snap-${randomUUID()}`
    db.prepare(`
      INSERT INTO chapter_context_snapshots (
        id, project_id, chapter_number, total_chars, estimated_tokens,
        bundle_text, sources_json, blocks_json, stale_warnings_json,
        candidate_warnings_json, omissions_json, excluded_deprecated_count,
        is_over_budget, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        total_chars = excluded.total_chars,
        estimated_tokens = excluded.estimated_tokens,
        bundle_text = excluded.bundle_text,
        sources_json = excluded.sources_json,
        blocks_json = excluded.blocks_json,
        stale_warnings_json = excluded.stale_warnings_json,
        candidate_warnings_json = excluded.candidate_warnings_json,
        omissions_json = excluded.omissions_json,
        excluded_deprecated_count = excluded.excluded_deprecated_count,
        is_over_budget = excluded.is_over_budget,
        updated_at = datetime('now')
    `).run(
      snapshotId,
      snapshot.projectId || 'main',
      snapshot.chapterNumber,
      snapshot.totalChars,
      snapshot.estimatedTokens,
      snapshot.bundleText,
      snapshot.sourcesJson || '[]',
      snapshot.blocksJson || '[]',
      snapshot.staleWarningsJson || '[]',
      snapshot.candidateWarningsJson || '[]',
      snapshot.omissionsJson || '[]',
      snapshot.excludedDeprecatedCount,
      snapshot.isOverBudget ? 1 : 0,
    )
    return { success: true, snapshotId }
  }

  /** 查询最近保存的章节上下文快照 */
  static getChapterContextSnapshot(chapterNumber: number, projectId = 'main'): ChapterContextSnapshot | null {
    const db = requiredDb()
    const row = db.prepare(`
      SELECT id, project_id, chapter_number, total_chars, estimated_tokens,
             bundle_text, sources_json, blocks_json, stale_warnings_json,
             candidate_warnings_json, omissions_json, excluded_deprecated_count,
             is_over_budget, created_at, updated_at
      FROM chapter_context_snapshots
      WHERE project_id = ? AND chapter_number = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(projectId, chapterNumber) as {
      id: string
      project_id: string
      chapter_number: number
      total_chars: number
      estimated_tokens: number
      bundle_text: string
      sources_json: string
      blocks_json: string
      stale_warnings_json: string
      candidate_warnings_json: string
      omissions_json: string
      excluded_deprecated_count: number
      is_over_budget: number
      created_at: string
      updated_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      projectId: row.project_id,
      chapterNumber: row.chapter_number,
      totalChars: row.total_chars,
      estimatedTokens: row.estimated_tokens,
      bundleText: row.bundle_text,
      sourcesJson: row.sources_json,
      blocksJson: row.blocks_json,
      staleWarningsJson: row.stale_warnings_json,
      candidateWarningsJson: row.candidate_warnings_json,
      omissionsJson: row.omissions_json,
      excludedDeprecatedCount: row.excluded_deprecated_count,
      isOverBudget: row.is_over_budget === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
