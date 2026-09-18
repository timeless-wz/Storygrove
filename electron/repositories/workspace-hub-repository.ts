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

function requiredSessionProjectId(projectId: string | undefined, operation: string): string {
  const normalized = projectId?.trim()
  if (!normalized) throw new Error(`${operation} 必须提供 sessionProjectId`)
  return normalized
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

interface ApprovedSnapshotRow {
  snapshot_id: string
  source_id: string
  project_id: string
  content_hash: string
  file_size: number
  fragment_count: number
  parser_schema_version: number
}

function normalizeSettingRuleForIntegrity(rule: {
  ruleId?: string
  projectId?: string
  title?: string
  content?: string
  status?: string
  constraintType?: string
  scope?: string
  sourceFragmentId?: string | null
  sourceSnapshotFragmentId?: string | null
  sourceFile?: string
  sourceHeadingPath?: string
  sourceLineRange?: string
}): Record<string, unknown> {
  return {
    ruleId: rule.ruleId ?? '',
    projectId: rule.projectId ?? '',
    title: rule.title ?? '',
    content: rule.content ?? '',
    status: rule.status ?? '',
    constraintType: rule.constraintType ?? '',
    scope: rule.scope ?? '',
    sourceFragmentId: rule.sourceFragmentId ?? null,
    sourceSnapshotFragmentId: rule.sourceSnapshotFragmentId ?? null,
    sourceFile: rule.sourceFile ?? '',
    sourceHeadingPath: rule.sourceHeadingPath ?? '',
    sourceLineRange: rule.sourceLineRange ?? '',
  }
}

function settingRuleIntegrityHash(rule: Parameters<typeof normalizeSettingRuleForIntegrity>[0]): string {
  return hashString(JSON.stringify(normalizeSettingRuleForIntegrity(rule)))
}

function characterEntryIntegrityValue(entry: CharacterRosterEntry): string {
  return JSON.stringify({
    name: entry.name,
    role: entry.role,
    gender: entry.gender,
    age: entry.age,
    appearance: entry.appearance,
    personality: entry.personality,
    background: entry.background,
    abilities: entry.abilities,
    motivation: entry.motivation,
    relationships: [...entry.relationships].sort((left, right) => (
      `${left.target}\u0000${left.relation}`.localeCompare(`${right.target}\u0000${right.relation}`)
    )),
    arc: entry.arc,
    notes: entry.notes,
    currentState: entry.currentState ?? null,
    legacyRelationshipNotes: entry.legacyRelationshipNotes ?? null,
  })
}

function assertCharacterOperationStillAuthoritative(
  db: BetterSqlite3.Database,
  operationId: string,
  frozenRequest: CharacterRosterCommitRequest,
  targetName: string,
): void {
  if (frozenRequest.operationId !== operationId) {
    throw new Error('审批冻结请求 operationId 不一致')
  }

  const operation = db.prepare(`
    SELECT operation_id, payload_hash, committed_revision, projection_hash
    FROM character_roster_operations
    WHERE operation_id = ?
  `).get(operationId) as {
    operation_id: string
    payload_hash: string
    committed_revision: number
    projection_hash: string
  } | undefined
  if (!operation) {
    throw new Error('审批恢复失败：缺少本次 operation 的正式角色事实证据，已拒绝闭合回执')
  }

  const currentRoster = CharacterRosterRepository.read()
  const targetKey = characterRosterIdentityKey(targetName)
  const targetEntry = currentRoster.entries.find(entry => characterRosterIdentityKey(entry.name) === targetKey)
  const expectedEntry = frozenRequest.entries.find(entry => characterRosterIdentityKey(entry.name) === targetKey)
  if (
    operation.operation_id !== operationId
    || operation.committed_revision < 1
    || operation.committed_revision > currentRoster.revision
    || !targetEntry
    || !expectedEntry
    || characterEntryIntegrityValue(targetEntry) !== characterEntryIntegrityValue(expectedEntry)
  ) {
    throw new Error('审批恢复失败：正式角色已被删除或替换，已拒绝闭合回执')
  }

  // The operation receipt stores the canonical roster request hash indirectly in
  // CharacterRosterRepository. A matching revision and projection alone is not
  // enough if the operation record itself was forged.
  const replay = CharacterRosterRepository.commit(frozenRequest)
  if (
    replay.operationId !== operationId
    || replay.payloadHash !== operation.payload_hash
    || !operation.projection_hash
  ) {
    throw new Error('审批恢复失败：正式角色事实不属于本次 operation，已拒绝闭合回执')
  }
}

function assertApprovedSnapshotPayloadIntegrity(
  db: BetterSqlite3.Database,
  source: WorkspaceSource,
  item: StagedSourceItem,
  approvedSnapshotId: string,
  existingSource: {
    absolute_path: string
    relative_path: string
    category: string
    authority_status: string
    content_hash: string
    observed_file_hash: string
    approved_content_hash: string
    observed_snapshot_id: string | null
    approved_snapshot_id: string | null
    import_status: string
    parse_error: string | null
    parse_status: string
    skip_reason: string | null
    is_missing: number
    is_disabled: number
    file_size: number
  },
): void {
  const snapshot = db.prepare(`
    SELECT snapshot_id, source_id, project_id, content_hash, file_size, fragment_count, parser_schema_version
    FROM workspace_source_snapshots
    WHERE snapshot_id = ?
  `).get(approvedSnapshotId) as ApprovedSnapshotRow | undefined
  if (!snapshot) throw new Error('已批准快照不存在，已拒绝不一致扫描提交')

  const observedFileHash = source.observedFileHash || source.contentHash
  if (
    source.projectId !== item.source.projectId
    || source.absolutePath !== existingSource.absolute_path
    || source.relativePath !== existingSource.relative_path
    || source.category !== existingSource.category
    || source.authorityStatus !== existingSource.authority_status
    || source.observedSnapshotId !== approvedSnapshotId
    || source.approvedSnapshotId !== approvedSnapshotId
    || source.contentHash !== existingSource.content_hash
    || observedFileHash !== existingSource.observed_file_hash
    || source.contentHash !== snapshot.content_hash
    || (source.fileSize ?? 0) !== existingSource.file_size
    || (source.fileSize ?? 0) !== snapshot.file_size
    || source.approvedContentHash !== existingSource.approved_content_hash
    || source.importStatus !== existingSource.import_status
    || (source.parseError ?? null) !== existingSource.parse_error
    || (source.parseStatus ?? 'parsed') !== existingSource.parse_status
    || (source.skipReason ?? null) !== existingSource.skip_reason
    || (source.isMissing ? 1 : 0) !== existingSource.is_missing
    || (source.isDisabled ? 1 : 0) !== existingSource.is_disabled
    || snapshot.source_id !== source.id
    || snapshot.project_id !== source.projectId
  ) {
    throw new Error('已批准 snapshotId 的来源观察数据不一致，已拒绝扫描提交')
  }

  if (item.snapshot) {
    const incoming = item.snapshot
    if (
      incoming.snapshotId !== snapshot.snapshot_id
      || incoming.sourceId !== snapshot.source_id
      || incoming.projectId !== snapshot.project_id
      || incoming.contentHash !== snapshot.content_hash
      || incoming.fileSize !== snapshot.file_size
      || incoming.fragmentCount !== snapshot.fragment_count
      || (incoming.parserSchemaVersion ?? 1) !== snapshot.parser_schema_version
    ) {
      throw new Error('已批准快照元数据不一致，已拒绝覆盖')
    }
  }

  if (item.fragments) {
    const storedFragments = db.prepare(`
      SELECT id, snapshot_id, source_id, project_id, heading_path, content,
             start_line, end_line, fragment_hash, chapter_start, chapter_end, purpose, status
      FROM workspace_source_snapshot_fragments
      WHERE snapshot_id = ?
      ORDER BY id
    `).all(approvedSnapshotId) as Array<Record<string, unknown>>
    const incomingFragments = [...item.fragments].sort((a, b) => a.id.localeCompare(b.id))
    if (incomingFragments.length !== storedFragments.length) {
      throw new Error('已批准快照片段数量不一致，已拒绝覆盖')
    }
    for (let index = 0; index < incomingFragments.length; index += 1) {
      const incoming = incomingFragments[index]
      const stored = storedFragments[index]
      const equal = (
        incoming.id === stored.id
        && incoming.snapshotId === stored.snapshot_id
        && incoming.sourceId === stored.source_id
        && incoming.projectId === stored.project_id
        && incoming.headingPath === stored.heading_path
        && incoming.content === stored.content
        && incoming.startLine === stored.start_line
        && incoming.endLine === stored.end_line
        && incoming.fragmentHash === stored.fragment_hash
        && incoming.chapterStart === stored.chapter_start
        && incoming.chapterEnd === stored.chapter_end
        && incoming.purpose === stored.purpose
        && incoming.status === stored.status
      )
      if (!equal) throw new Error('已批准快照片段不一致，已拒绝覆盖')
    }
  }

  if (item.rules) {
    const storedRules = db.prepare(`
      SELECT id, snapshot_id, source_id, project_id, title, content, status,
             constraint_type, scope, source_fragment_id, source_file,
             source_heading_path, source_line_range
      FROM workspace_source_snapshot_rules
      WHERE snapshot_id = ?
      ORDER BY id
    `).all(approvedSnapshotId) as Array<Record<string, unknown>>
    const incomingRules = item.rules.map((rule, index) => ({
      id: `${approvedSnapshotId}-r-${index + 1}`,
      rule,
    })).sort((a, b) => a.id.localeCompare(b.id))
    if (incomingRules.length !== storedRules.length) {
      throw new Error('已批准快照规则数量不一致，已拒绝覆盖')
    }
    for (let index = 0; index < incomingRules.length; index += 1) {
      const incoming = incomingRules[index]
      const stored = storedRules[index]
      const rule = incoming.rule
      const storedRuleHash = settingRuleIntegrityHash({
        ruleId: stored.id as string,
        projectId: stored.project_id as string,
        title: stored.title as string,
        content: stored.content as string,
        status: stored.status as string,
        constraintType: stored.constraint_type as string,
        scope: stored.scope as string,
        sourceFragmentId: stored.source_fragment_id as string | null,
        sourceFile: stored.source_file as string,
        sourceHeadingPath: stored.source_heading_path as string,
        sourceLineRange: stored.source_line_range as string,
      })
      const incomingRuleHash = settingRuleIntegrityHash({
        ruleId: incoming.id,
        projectId: rule.projectId,
        title: rule.title,
        content: rule.content,
        status: rule.status,
        constraintType: rule.constraintType,
        scope: rule.scope,
        sourceFragmentId: rule.sourceFragmentId ?? null,
        sourceFile: rule.sourceFile,
        sourceHeadingPath: rule.sourceHeadingPath,
        sourceLineRange: rule.sourceLineRange,
      })
      if (
        stored.id !== incoming.id
        || stored.snapshot_id !== approvedSnapshotId
        || stored.source_id !== source.id
        || stored.project_id !== source.projectId
        || storedRuleHash !== incomingRuleHash
      ) {
        throw new Error('已批准快照规则不一致，已拒绝覆盖')
      }
    }
  }
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
    ON CONFLICT(project_id, rule_id) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      status = excluded.status,
      constraint_type = excluded.constraint_type,
      scope = excluded.scope,
      source_snapshot_fragment_id = excluded.source_snapshot_fragment_id,
      source_file = excluded.source_file,
      source_heading_path = excluded.source_heading_path,
      source_line_range = excluded.source_line_range,
      confirmed_at = excluded.confirmed_at,
      confirmed_by = excluded.confirmed_by,
      origin_type = 'scan',
      source_id = excluded.source_id,
      source_snapshot_id = excluded.source_snapshot_id,
      updated_at = datetime('now')
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
    SELECT snapshot_id, source_id, project_id, content_hash, fragment_count, file_size
    FROM workspace_source_snapshots
    WHERE snapshot_id = ?
  `).get(snapshotId) as {
    snapshot_id: string
    source_id: string
    project_id: string
    content_hash: string
    fragment_count: number
    file_size: number
  } | undefined
  if (!snapshot) throw new Error('无法确认观察快照完整性，已拒绝批准')

  // 验证快照与来源、项目的关联一致性
  if (snapshot.source_id !== source.id || snapshot.project_id !== source.project_id) {
    throw new Error(`快照关联不一致（快照来源: ${snapshot.source_id}, 来源: ${source.id}; 快照项目: ${snapshot.project_id}, 来源项目: ${source.project_id}），已拒绝批准`)
  }

  // 验证观察哈希、快照 content_hash 和待批准来源关系一致
  const expectedContentHash = source.observed_file_hash || source.content_hash
  if (snapshot.content_hash !== expectedContentHash) {
    throw new Error(`快照 content_hash 与来源观察哈希不一致（快照: ${snapshot.content_hash}, 来源: ${expectedContentHash}），已拒绝批准`)
  }

  // 查询该快照下的所有片段
  const fragments = db.prepare(`
    SELECT id, snapshot_id, source_id, project_id, content, fragment_hash
    FROM workspace_source_snapshot_fragments
    WHERE snapshot_id = ?
  `).all(snapshotId) as Array<{
    id: string
    snapshot_id: string
    source_id: string
    project_id: string
    content: string
    fragment_hash: string
  }>

  // 1. 验证实际片段数与 fragment_count 一致
  if (fragments.length !== snapshot.fragment_count) {
    throw new Error(`快照片段数不一致（记录: ${snapshot.fragment_count}, 实际: ${fragments.length}），已拒绝批准`)
  }

  // 2. 验证每个片段的关联与哈希完整性（防篡改）
  for (const f of fragments) {
    if (f.source_id !== source.id || f.project_id !== source.project_id) {
      throw new Error(`快照片段 ${f.id} 关联的项目或来源与待批准来源不一致，已拒绝批准`)
    }
    const computedHash = hashString(f.content)
    if (computedHash !== f.fragment_hash) {
      throw new Error(`快照片段 ${f.id} 内容哈希校验失败（内容已被篡改），已拒绝批准`)
    }
  }

  // 3. metadata_only 快照合法片段数必须为 0
  const sourceCategory = (db.prepare(`
    SELECT category, parse_status FROM workspace_sources WHERE id = ? AND project_id = ?
  `).get(source.id, source.project_id) as { category?: string; parse_status?: string } | undefined)

  if (sourceCategory?.category === 'reference_novel' || sourceCategory?.parse_status === 'metadata_only') {
    if (fragments.length !== 0) {
      throw new Error('元数据快照包含非零片段，已拒绝批准')
    }
  }

  // 4. 验证所有暂存规则关联一致性及引用的片段真实存在且属于同项目、同来源、同快照
  const stagedRules = db.prepare(`
    SELECT id, snapshot_id, source_id, project_id, source_fragment_id
    FROM workspace_source_snapshot_rules
    WHERE snapshot_id = ?
  `).all(snapshotId) as Array<{
    id: string
    snapshot_id: string
    source_id: string
    project_id: string
    source_fragment_id?: string | null
  }>

  for (const r of stagedRules) {
    if (r.source_id !== source.id || r.project_id !== source.project_id) {
      throw new Error(`暂存规则 ${r.id} 关联的项目或来源与待批准来源不一致，已拒绝批准`)
    }
    if (r.source_fragment_id) {
      const fragmentMatches = db.prepare(`
        SELECT 1 FROM workspace_source_snapshot_fragments
        WHERE id = ? AND snapshot_id = ? AND source_id = ? AND project_id = ?
      `).get(r.source_fragment_id, snapshotId, source.id, source.project_id)
      if (!fragmentMatches) {
        throw new Error(`暂存规则 ${r.id} 引用的片段 ${r.source_fragment_id} 不属于当前快照或来源不一致`)
      }
    }
  }

  promoteSnapshotRules(db, source, snapshotId)
  const updateRes = db.prepare(`
    UPDATE workspace_sources
    SET approved_snapshot_id = ?, approved_content_hash = ?, import_status = 'imported',
        updated_at = datetime('now')
    WHERE id = ? AND project_id = ?
  `).run(snapshotId, source.observed_file_hash || snapshot.content_hash || source.content_hash, source.id, source.project_id)
  if (updateRes.changes !== 1) {
    throw new Error('更新来源批准快照状态失败：受影响行数不为 1')
  }
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
    const bindingState = db.prepare(`
      SELECT current_path, healthy_scanned_at
      FROM workspace_binding_states
      WHERE project_id = ?
    `).get(projectId) as { current_path?: string; healthy_scanned_at?: string } | undefined
    const legacyProjectRow = db.prepare(`
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
      externalWorkspacePath: bindingState?.current_path ?? (projectId === 'main' ? legacyProjectRow?.external_workspace_path ?? '' : ''),
      lastScannedAt: bindingState?.healthy_scanned_at ?? (projectId === 'main' ? legacyProjectRow?.external_workspace_scanned_at ?? '' : ''),
      totalFiles: counts?.total_files ?? 0,
      recognizedFiles: counts?.recognized_files ?? 0,
      missingFiles: counts?.missing_files ?? 0,
      changedFiles: counts?.changed_files ?? 0,
      pendingCandidates,
      confirmedRulesCount,
    }
  }

  /** 获取当前项目关联的外部母稿绝对路径 */
  static getBoundWorkspacePath(projectId = 'main'): string {
    const db = requiredDb()
    const bindingState = db.prepare(`
      SELECT current_path FROM workspace_binding_states WHERE project_id = ?
    `).get(projectId) as { current_path?: string } | undefined
    if (bindingState) return bindingState.current_path ?? ''
    if (projectId !== 'main') return ''
    const row = db.prepare(`
      SELECT external_workspace_path FROM project_core WHERE id = ?
    `).get(PROJECT_CORE_ROW_ID) as { external_workspace_path?: string } | undefined
    return row?.external_workspace_path ?? ''
  }

  /** 关联外部创作母稿目录 */
  static bindWorkspaceDirectory(externalPath: string, projectId = 'main'): void {
    const db = requiredDb()
    const sessionProjectId = requiredSessionProjectId(projectId, 'bindWorkspaceDirectory')
    const normalizedPath = externalPath.trim()
    if (!normalizedPath) throw new Error('bindWorkspaceDirectory 必须提供有效目录路径')
    db.transaction(() => {
      const previousCore = db.prepare(`
        SELECT external_workspace_path FROM project_core WHERE id = ?
      `).get(PROJECT_CORE_ROW_ID) as { external_workspace_path?: string } | undefined
      const result = db.prepare(`
        UPDATE project_core
        SET external_workspace_path = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(normalizedPath, PROJECT_CORE_ROW_ID)
      if (result.changes !== 1) {
        throw new Error(`未能绑定外部目录到 project_core: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }

      const existingState = db.prepare(`
        SELECT healthy_path FROM workspace_binding_states WHERE project_id = ?
      `).get(sessionProjectId) as { healthy_path?: string } | undefined
      if (existingState) {
        db.prepare(`
          UPDATE workspace_binding_states
          SET current_path = ?, updated_at = datetime('now')
          WHERE project_id = ?
        `).run(normalizedPath, sessionProjectId)
      } else {
        const canInheritLegacyHealth = sessionProjectId === 'main'
          && Boolean(previousCore?.external_workspace_path)
          && Boolean(db.prepare(`
            SELECT 1 FROM workspace_sources
            WHERE project_id = ? AND approved_snapshot_id IS NOT NULL
              AND approved_snapshot_id <> '' AND is_missing = 0
            LIMIT 1
          `).get(sessionProjectId))
        db.prepare(`
          INSERT INTO workspace_binding_states (
            project_id, current_path, healthy_path, healthy_scanned_at
          ) VALUES (?, ?, ?, COALESCE((
            SELECT external_workspace_scanned_at FROM project_core WHERE id = ?
          ), ''))
        `).run(
          sessionProjectId,
          normalizedPath,
          canInheritLegacyHealth ? previousCore?.external_workspace_path ?? '' : '',
          PROJECT_CORE_ROW_ID,
        )
      }
    })()
  }

  /**
   * 解除当前绑定，但保留项目来源、批准快照、片段和作者规则，供补偿失败后事务恢复。
   * 该方法不再删除 workspace_sources，避免取消扫描破坏最后一次健康状态。
   */
  static unbindWorkspaceDirectory(projectId: string): void {
    const db = requiredDb()
    const sessionProjectId = requiredSessionProjectId(projectId, 'unbindWorkspaceDirectory')
    db.transaction(() => {
      const currentState = db.prepare(`
        SELECT current_path, healthy_path FROM workspace_binding_states WHERE project_id = ?
      `).get(sessionProjectId) as { current_path?: string; healthy_path?: string } | undefined
      const currentCore = db.prepare(`
        SELECT external_workspace_path, external_workspace_scanned_at FROM project_core WHERE id = ?
      `).get(PROJECT_CORE_ROW_ID) as {
        external_workspace_path?: string
        external_workspace_scanned_at?: string
      } | undefined
      if (!currentCore) {
        throw new Error(`未能更新 project_core 主记录: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }
      const result = db.prepare(`
        UPDATE project_core
        SET external_workspace_path = '', external_workspace_scanned_at = '', updated_at = datetime('now')
        WHERE id = ?
      `).run(PROJECT_CORE_ROW_ID)
      const ownsLegacyActivePath = sessionProjectId === 'main'
        || currentState?.current_path === (currentCore.external_workspace_path ?? '')
      if (result.changes !== 1 && ownsLegacyActivePath) {
        throw new Error(`未能更新 project_core 主记录: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }
      if (result.changes === 1 && !ownsLegacyActivePath) {
        // A different session owns the legacy active path. Re-apply it while
        // changing only this session's durable binding state.
        db.prepare(`
          UPDATE project_core
          SET external_workspace_path = ?, external_workspace_scanned_at = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(currentCore.external_workspace_path ?? '', currentCore.external_workspace_scanned_at ?? '', PROJECT_CORE_ROW_ID)
      }
      if (currentState) {
        db.prepare(`
          UPDATE workspace_binding_states
          SET current_path = '', healthy_path = ?, healthy_scanned_at = healthy_scanned_at,
              updated_at = datetime('now')
          WHERE project_id = ?
        `).run(currentState.healthy_path ?? '', sessionProjectId)
      } else {
        const canInheritLegacyHealth = sessionProjectId === 'main'
          && Boolean(currentCore?.external_workspace_path)
          && Boolean(db.prepare(`
            SELECT 1 FROM workspace_sources
            WHERE project_id = ? AND approved_snapshot_id IS NOT NULL
              AND approved_snapshot_id <> '' AND is_missing = 0
            LIMIT 1
          `).get(sessionProjectId))
        db.prepare(`
          INSERT INTO workspace_binding_states (
            project_id, current_path, healthy_path, healthy_scanned_at
          ) VALUES (?, '', ?, ?)
        `).run(
          sessionProjectId,
          canInheritLegacyHealth ? currentCore?.external_workspace_path ?? '' : '',
          canInheritLegacyHealth ? currentCore?.external_workspace_scanned_at ?? '' : '',
        )
      }
    })()
  }

  /**
   * A compensation failure can leave a scan payload committed even though no
   * workspace path can safely remain bound. Preserve rows and immutable
   * snapshots for recovery, but make every source non-effective so content from
   * an unbound directory is never treated as current context.
   */
  static markAllSourcesMissingForUnboundRecovery(projectId: string): void {
    const db = requiredDb()
    const sessionProjectId = requiredSessionProjectId(projectId, 'markAllSourcesMissingForUnboundRecovery')
    db.prepare(`
      UPDATE workspace_sources
      SET is_missing = 1, import_status = 'missing', updated_at = datetime('now')
      WHERE project_id = ?
    `).run(sessionProjectId)
  }

  /**
   * 恢复本项目最后一次完整扫描成功的绑定路径。仅恢复仍存在且未缺失的批准快照，
   * 不从旧 fragments 表回退，也不写入 setting_rules。
   */
  static restoreWorkspaceDirectory(projectId: string): { success: boolean; error?: string } {
    const db = requiredDb()
    const sessionProjectId = requiredSessionProjectId(projectId, 'restoreWorkspaceDirectory')
    try {
      db.transaction(() => {
        const state = db.prepare(`
          SELECT healthy_path, healthy_scanned_at
          FROM workspace_binding_states WHERE project_id = ?
        `).get(sessionProjectId) as { healthy_path?: string; healthy_scanned_at?: string } | undefined
        if (!state?.healthy_path) throw new Error('没有可恢复的健康绑定状态')

        const invalidApproved = db.prepare(`
          SELECT src.id
          FROM workspace_sources AS src
          WHERE src.project_id = ?
            AND src.approved_snapshot_id IS NOT NULL
            AND src.approved_snapshot_id <> ''
            AND (
              src.is_missing = 1
              OR NOT EXISTS (
                SELECT 1 FROM workspace_source_snapshots AS snap
                WHERE snap.snapshot_id = src.approved_snapshot_id
                  AND snap.source_id = src.id
                  AND snap.project_id = src.project_id
              )
            )
          LIMIT 1
        `).get(sessionProjectId) as { id: string } | undefined
        if (invalidApproved) {
          throw new Error('健康绑定恢复失败：批准来源或快照已缺失')
        }

        const core = db.prepare(`
          SELECT external_workspace_path, external_workspace_scanned_at FROM project_core WHERE id = ?
        `).get(PROJECT_CORE_ROW_ID) as {
          external_workspace_path?: string
          external_workspace_scanned_at?: string
        } | undefined
        if (!core) {
          throw new Error(`未能恢复 project_core 主记录: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
        }
        const coreResult = db.prepare(`
          UPDATE project_core
          SET external_workspace_path = ?, external_workspace_scanned_at = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(state.healthy_path, state.healthy_scanned_at ?? '', PROJECT_CORE_ROW_ID)
        const canOwnLegacyActivePath = core.external_workspace_path === ''
          || core.external_workspace_path === state.healthy_path
        if (coreResult.changes !== 1 && canOwnLegacyActivePath) {
          throw new Error(`未能恢复 project_core 主记录: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
        }
        if (coreResult.changes === 1 && !canOwnLegacyActivePath) {
          db.prepare(`
            UPDATE project_core
            SET external_workspace_path = ?, external_workspace_scanned_at = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(core.external_workspace_path ?? '', core.external_workspace_scanned_at ?? '', PROJECT_CORE_ROW_ID)
        }
        db.prepare(`
          UPDATE workspace_binding_states
          SET current_path = ?, updated_at = datetime('now')
          WHERE project_id = ?
        `).run(state.healthy_path, sessionProjectId)
      })()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 记录扫描完成时间 */
  static recordScanTime(timestamp: string, _projectId = 'main'): void {
    void _projectId
    const db = requiredDb()
    db.transaction(() => {
      const result = db.prepare(`
        UPDATE project_core
        SET external_workspace_scanned_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(timestamp, PROJECT_CORE_ROW_ID)
      if (result.changes !== 1) {
        throw new Error(`未能更新 project_core 扫描时间: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }
    })()
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
        ON CONFLICT(project_id, candidate_id) DO NOTHING
      `)

      for (const item of payload.items) {
        const s = item.source
        if (!s || !s.id) {
          throw new Error('Invalid source payload: source id cannot be null or empty')
        }
        if (!payload.projectId || s.projectId !== payload.projectId) {
          throw new Error('扫描来源项目与 payload 项目不一致，已拒绝提交')
        }

        const existingSource = db.prepare(`
          SELECT absolute_path, relative_path, category, authority_status,
                 content_hash, observed_file_hash, approved_content_hash,
                 observed_snapshot_id, approved_snapshot_id, import_status,
                 parse_error, parse_status, skip_reason, is_missing, is_disabled, file_size
          FROM workspace_sources WHERE id = ? AND project_id = ?
        `).get(s.id, s.projectId) as {
          absolute_path: string
          relative_path: string
          category: string
          authority_status: string
          content_hash: string
          observed_file_hash: string
          approved_content_hash: string
          observed_snapshot_id: string | null
          approved_snapshot_id: string | null
          import_status: string
          parse_error: string | null
          parse_status: string
          skip_reason: string | null
          is_missing: number
          is_disabled: number
          file_size: number
        } | undefined

        if (existingSource?.approved_snapshot_id && s.observedSnapshotId === existingSource.approved_snapshot_id) {
          // An approved snapshot is immutable. Validate the complete payload before
          // touching even harmless-looking source metadata; otherwise a forged scan
          // could make the approved source appear imported.
          assertApprovedSnapshotPayloadIntegrity(db, s, item, existingSource.approved_snapshot_id, existingSource)

          // A valid replay may refresh observation timestamps, but never rewrites
          // content identity, approval identity, status, or file size.
          db.prepare(`
            UPDATE workspace_sources
            SET mtime = ?, last_scanned_at = ?, is_missing = ?, is_disabled = ?, updated_at = datetime('now')
            WHERE id = ? AND project_id = ?
          `).run(
            s.mtime,
            s.lastScannedAt || payload.scanTime || new Date().toISOString(),
            s.isMissing ? 1 : 0,
            s.isDisabled ? 1 : 0,
            s.id,
            s.projectId,
          )
        } else {
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
            s.lastScannedAt || payload.scanTime || new Date().toISOString(),
            s.importStatus || 'scanned',
            s.isMissing ? 1 : 0,
            s.isDisabled ? 1 : 0,
            s.fileSize ?? 0,
          )
        }

        if (item.snapshot && !item.preserveOldSnapshots) {
          const isApprovedSnapshot = Boolean(
            db.prepare(`
              SELECT 1 FROM workspace_sources
              WHERE approved_snapshot_id = ? AND project_id = ?
            `).get(item.snapshot.snapshotId, payload.projectId),
          )

          if (!isApprovedSnapshot) {
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

      // 更新扫描完成时间（写入 project_core 主记录，若主记录缺失则整事务失败回滚）
      const scanTimeUpdate = db.prepare(`
        UPDATE project_core
        SET external_workspace_scanned_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(payload.scanTime, PROJECT_CORE_ROW_ID)
      if (scanTimeUpdate.changes !== 1) {
        throw new Error(`未能更新 project_core 扫描时间: 未找到 id = '${PROJECT_CORE_ROW_ID}' 的项目主记录`)
      }

      // 只有完整扫描已经原子提交，才推进本项目的健康绑定游标。取消、失败或截断
      // 的扫描不会改变它，因此后续补偿可以恢复到上一次健康目录。
      if (payload.enumerationComplete && payload.activeSourceIds.length > 0) {
        db.prepare(`
          INSERT INTO workspace_binding_states (
            project_id, current_path, healthy_path, healthy_scanned_at
          ) VALUES (?, COALESCE((
            SELECT current_path FROM workspace_binding_states WHERE project_id = ?
          ), ''), COALESCE((
            SELECT current_path FROM workspace_binding_states WHERE project_id = ?
          ), ''), ?)
          ON CONFLICT(project_id) DO UPDATE SET
            healthy_path = CASE
              WHEN workspace_binding_states.current_path <> '' THEN workspace_binding_states.current_path
              ELSE workspace_binding_states.healthy_path
            END,
            healthy_scanned_at = CASE
              WHEN workspace_binding_states.current_path <> '' THEN excluded.healthy_scanned_at
              ELSE workspace_binding_states.healthy_scanned_at
            END,
            updated_at = datetime('now')
        `).run(payload.projectId, payload.projectId, payload.projectId, payload.scanTime)
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
    const ruleId = (rule.ruleId || String(r.id || '')).trim()
    const projectId = (rule.projectId || String(r.project_id || '')).trim()
    if (!ruleId) throw new Error('设定规则 ruleId 不能为空')
    if (!projectId) throw new Error('设定规则 projectId 不能为空')

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
    const result = db.prepare(`
      INSERT INTO setting_rules (
        rule_id, project_id, title, content, status, constraint_type, scope,
        source_fragment_id, source_snapshot_fragment_id, source_file, source_heading_path, source_line_range,
        confirmed_at, confirmed_by, origin_type, source_id, source_snapshot_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, datetime('now'))
      ON CONFLICT(project_id, rule_id) DO UPDATE SET
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

    if (result.changes !== 1) {
      throw new Error(`写入设定规则失败：受影响行数不为 1 (ruleId: ${ruleId}, projectId: ${projectId})`)
    }
  }

  static updateRuleStatus(
    ruleId: string,
    projectIdOrStatus: string | SettingRuleStatus,
    maybeStatus?: SettingRuleStatus,
    confirmedBy?: string,
  ): void {
    const db = requiredDb()
    const validStatuses: SettingRuleStatus[] = ['confirmed', 'candidate', 'background', 'deprecated']
    let projectId = ''
    let status: SettingRuleStatus
    const author = confirmedBy ?? 'author'

    if (validStatuses.includes(projectIdOrStatus as SettingRuleStatus)) {
      throw new Error('updateRuleStatus 必须提供显式 projectId')
    } else {
      projectId = projectIdOrStatus
      status = maybeStatus ?? 'confirmed'
    }

    if (!projectId || !projectId.trim()) {
      throw new Error('更新设定规则失败：projectId 不能为空')
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

  static deleteRule(ruleId: string, projectId: string): void {
    const db = requiredDb()
    if (!projectId || !projectId.trim()) {
      throw new Error('删除设定规则失败：projectId 不能为空')
    }
    const result = db.prepare('DELETE FROM setting_rules WHERE rule_id = ? AND project_id = ?').run(ruleId, projectId)
    if (result.changes !== 1) {
      throw new Error(`未找到属于项目 ${projectId} 的规则: ${ruleId}`)
    }
  }

  // ============================================================
  // 导入与变更候选管理（带审批回执与崩溃恢复机制）
  // ============================================================

  static listCandidates(options: {
    projectId?: string
    candidateType?: WorkspaceImportCandidateType
    status?: WorkspaceImportCandidateStatus
  }): WorkspaceImportCandidate[] {
    if (!options || typeof options.projectId !== 'string' || !options.projectId.trim()) {
      throw new Error('listCandidates 必须提供显式 sessionProjectId')
    }
    const db = requiredDb()
    const projectId = options.projectId
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
    if (!candidate.candidateId || !candidate.candidateId.trim()) {
      throw new Error('保存候选失败：candidateId 不能为空')
    }
    if (!candidate.projectId || !candidate.projectId.trim()) {
      throw new Error('保存候选失败：projectId 不能为空')
    }
    const db = requiredDb()
    db.prepare(`
      INSERT INTO workspace_import_candidates (
        candidate_id, project_id, candidate_type, raw_data, suggested_data,
        source_file, source_heading_path, source_line_range, evidence,
        confidence, status, actioned_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id, candidate_id) DO NOTHING
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
   * 严格按 sessionProjectId 隔离，严禁向 main 回退；
   * 严格原样重放同一个冻结请求，防止覆盖作者并发编辑；
   * 每次状态变更均验证 changes === 1。
   */
  static approveCandidate<TStage extends string = string>(
    candidateId: string,
    projectIdOrOptions: string | { projectId?: string; authorName?: string; testCrashHook?: (stage: TStage) => void },
    authorName?: string | ((stage: TStage) => void),
    testCrashHook?: (stage: TStage) => void,
  ): { success: boolean; error?: string } {
    let actualProjectId: string
    let actualAuthor = 'author'
    let actualCrashHook: ((stage: string) => void) | undefined

    if (typeof projectIdOrOptions === 'object' && projectIdOrOptions !== null) {
      if (!projectIdOrOptions.projectId || !projectIdOrOptions.projectId.trim()) {
        throw new Error('approveCandidate 必须提供显式 sessionProjectId')
      }
      actualProjectId = projectIdOrOptions.projectId
      actualAuthor = projectIdOrOptions.authorName ?? 'author'
      actualCrashHook = projectIdOrOptions.testCrashHook as unknown as ((stage: string) => void) | undefined
    } else if (typeof projectIdOrOptions === 'string') {
      actualProjectId = projectIdOrOptions
      if (typeof authorName === 'string') {
        actualAuthor = authorName
        actualCrashHook = testCrashHook as unknown as ((stage: string) => void) | undefined
      } else if (typeof authorName === 'function') {
        actualCrashHook = authorName as unknown as (stage: string) => void
      }
    } else {
      throw new Error('approveCandidate 必须提供显式 sessionProjectId')
    }

    if (!actualProjectId || !actualProjectId.trim()) {
      throw new Error('approveCandidate 必须提供显式 sessionProjectId')
    }

    try {
      const db = requiredDb()

      const candidate = db.prepare(`
        SELECT candidate_id, project_id, candidate_type, raw_data, suggested_data,
               source_file, source_heading_path, source_line_range, status
        FROM workspace_import_candidates
        WHERE candidate_id = ? AND project_id = ?
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

      // 严禁向 project_id = 'main' 回退，严格基于当前会话项目校验
      if (!candidate) {
        return { success: false, error: '候选项目不存在' }
      }

      const candidateContentHash = hashString(candidate.suggested_data)
      const deterministicOpId = `workspace-approve-${candidate.candidate_id}-${candidateContentHash.slice(0, 8)}`

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
        stage: 'prepared' | 'roster_committed' | 'completed' | 'compensated'
      } | undefined

      // 验证已有回执的完整性与哈希一致性（防篡改）
      if (existingReceipt) {
        if (
          existingReceipt.candidate_id !== candidate.candidate_id ||
          existingReceipt.project_id !== candidate.project_id ||
          existingReceipt.candidate_type !== candidate.candidate_type ||
           !existingReceipt.operation_id ||
           !existingReceipt.frozen_payload ||
           !existingReceipt.payload_hash ||
           existingReceipt.operation_id !== deterministicOpId ||
           hashString(existingReceipt.frozen_payload) !== existingReceipt.payload_hash
        ) {
          throw new Error('审批回执完整性校验失败：冻结负载或哈希被篡改')
        }
      }

      // 崩溃恢复：若 candidate 已 approved 或回执已 completed，先校验正式领域实体确实存在，再闭合回执
      if (candidate.status === 'approved' || existingReceipt?.stage === 'completed') {
        if (!existingReceipt) {
          throw new Error('审批完整性校验失败：缺少审批回执')
        }
        if (hashString(existingReceipt.frozen_payload) !== existingReceipt.payload_hash) {
          throw new Error('审批回执完整性校验失败：冻结负载或哈希被篡改')
        }

        if (candidate.candidate_type === 'character') {
          const frozenReq = JSON.parse(existingReceipt.frozen_payload) as CharacterRosterCommitRequest
          const parsed = JSON.parse(candidate.suggested_data) as { name: string }
          assertCharacterOperationStillAuthoritative(db, existingReceipt.operation_id, frozenReq, parsed.name)
        } else if (candidate.candidate_type === 'setting') {
          const frozenData = JSON.parse(existingReceipt.frozen_payload) as {
            targetRule: SettingRule
            targetContentHash: string
          }
          if (
            !frozenData.targetRule
            || frozenData.targetRule.projectId !== candidate.project_id
            || frozenData.targetRule.sourceFile !== candidate.source_file
            || frozenData.targetRule.sourceHeadingPath !== candidate.source_heading_path
            || frozenData.targetRule.sourceLineRange !== candidate.source_line_range
          ) {
            throw new Error('审批冻结设定回执与候选项目或来源不一致')
          }
          const ruleIdToInspect = frozenData.targetRule?.ruleId || `rule-${hashString(`${candidate.source_file}:${candidate.source_heading_path}`).slice(0, 16)}`
          const currentRule = db.prepare(`
            SELECT rule_id, project_id, title, content, status, constraint_type, scope,
                   source_fragment_id, source_snapshot_fragment_id, source_file,
                   source_heading_path, source_line_range
            FROM setting_rules WHERE project_id = ? AND rule_id = ?
          `).get(actualProjectId, ruleIdToInspect) as {
            rule_id: string
            project_id: string
            title: string
            content: string
            status: string
            constraint_type: string
            scope: string
            source_fragment_id: string | null
            source_snapshot_fragment_id: string | null
            source_file: string
            source_heading_path: string
            source_line_range: string
          } | undefined

          if (!currentRule) {
            throw new Error('审批恢复失败：正式设定规则已被删除，已拒绝闭合回执')
          } else {
            const currentRuleHash = settingRuleIntegrityHash({
              ruleId: currentRule.rule_id,
              projectId: currentRule.project_id,
              title: currentRule.title,
              content: currentRule.content,
              status: currentRule.status,
              constraintType: currentRule.constraint_type,
              scope: currentRule.scope,
              sourceFragmentId: currentRule.source_fragment_id,
              sourceSnapshotFragmentId: currentRule.source_snapshot_fragment_id,
              sourceFile: currentRule.source_file,
              sourceHeadingPath: currentRule.source_heading_path,
              sourceLineRange: currentRule.source_line_range,
            })
            const frozenRuleHash = settingRuleIntegrityHash(frozenData.targetRule)
            if (currentRuleHash !== frozenRuleHash) {
              throw new Error('审批恢复失败：设定规则已被作者修改，已拒绝覆盖')
            }
          }
        }

        db.transaction(() => {
          if (candidate.status !== 'approved') {
            const candUpdate = db.prepare(`
              UPDATE workspace_import_candidates
              SET status = 'approved', actioned_at = COALESCE(actioned_at, datetime('now'))
              WHERE candidate_id = ? AND project_id = ? AND status != 'approved'
            `).run(candidateId, actualProjectId)
            if (candUpdate.changes !== 1) {
              throw new Error('更新候选状态失败：受影响行数不为 1')
            }
          }

          if (existingReceipt && existingReceipt.stage !== 'completed') {
            const receiptUpdate = db.prepare(`
              UPDATE workspace_approval_receipts
              SET stage = 'completed', updated_at = datetime('now')
              WHERE candidate_id = ? AND project_id = ? AND stage != 'completed'
            `).run(candidateId, actualProjectId)
            if (receiptUpdate.changes !== 1) {
              throw new Error('更新回执状态失败：受影响行数不为 1')
            }
          }
        })()
        return { success: true }
      }

      if (existingReceipt && existingReceipt.operation_id !== deterministicOpId) {
        throw new Error('审批回执 operationId 与候选冻结内容不一致')
      }

      // 阶段 1: 在任何正式写入前冻结确定性 operationId 与完整提交请求
      if (!existingReceipt) {
        let frozenPayload: string
        if (candidate.candidate_type === 'character') {
          frozenPayload = JSON.stringify(freezeCharacterApprovalRequest(candidate.suggested_data, deterministicOpId))
        } else if (candidate.candidate_type === 'setting') {
          const deterministicRuleId = `rule-${hashString(`${candidate.source_file}:${candidate.source_heading_path}`).slice(0, 16)}`
          const parsed = JSON.parse(candidate.suggested_data) as {
            title?: string
            content?: string
            constraintType?: SettingRuleConstraint
            scope?: string
          }
          const existingRule = db.prepare(`
            SELECT rule_id, project_id, title, content, status, constraint_type, scope
            FROM setting_rules WHERE project_id = ? AND rule_id = ?
          `).get(actualProjectId, deterministicRuleId) as { content: string } | undefined

          const targetRule: SettingRule = {
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
          }
          frozenPayload = JSON.stringify({
            targetRule,
            priorContent: existingRule ? existingRule.content : null,
            priorRuleHash: existingRule ? hashString(existingRule.content) : 'none',
            targetContentHash: hashString(targetRule.content),
          })
        } else {
          frozenPayload = candidate.suggested_data
        }

        const frozenPayloadHash = hashString(frozenPayload)
        const insertReceipt = db.prepare(`
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
        if (insertReceipt.changes !== 1) {
          throw new Error('创建审批 prepared 回执失败：受影响行数不为 1')
        }

        existingReceipt = {
          candidate_id: candidate.candidate_id,
          project_id: candidate.project_id,
          candidate_type: candidate.candidate_type,
          operation_id: deterministicOpId,
          payload_hash: frozenPayloadHash,
          frozen_payload: frozenPayload,
          stage: 'prepared',
        }
      }

      const invokeTestCrashHook = (
        stage: 'prepared' | 'after_roster_commit_before_receipt' | 'roster_committed' | 'after_candidate_approved_before_receipt',
      ) => {
        if (actualCrashHook && (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true')) {
          actualCrashHook(stage)
        }
      }

      invokeTestCrashHook('prepared')

      // 阶段 2: 领域实体提交
      if (candidate.candidate_type === 'character') {
        const frozenRequest = JSON.parse(existingReceipt.frozen_payload) as CharacterRosterCommitRequest
        const parsed = JSON.parse(candidate.suggested_data) as { name: string }
        const operationExists = Boolean(db.prepare(`
          SELECT 1 FROM character_roster_operations WHERE operation_id = ?
        `).get(existingReceipt.operation_id))

        // If the domain commit did not happen yet, replay the frozen request
        // exactly once. If it did happen, only read and verify its operation
        // evidence; never replay a stale request over a newer author edit.
        if (!operationExists) {
          CharacterRosterRepository.commit(frozenRequest)
        }
        assertCharacterOperationStillAuthoritative(db, existingReceipt.operation_id, frozenRequest, parsed.name)

        const receiptWasPrepared = existingReceipt.stage === 'prepared'
        if (receiptWasPrepared) invokeTestCrashHook('after_roster_commit_before_receipt')

        if (receiptWasPrepared) {
          const receiptUpdate = db.prepare(`
            UPDATE workspace_approval_receipts
            SET stage = 'roster_committed', updated_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ? AND stage = 'prepared'
          `).run(candidateId, actualProjectId)
          if (receiptUpdate.changes !== 1) {
            throw new Error('更新回执至 roster_committed 失败：受影响行数不为 1')
          }
          existingReceipt = { ...existingReceipt, stage: 'roster_committed' }
        }

        if (receiptWasPrepared) invokeTestCrashHook('roster_committed')

        // 阶段 3: 原子推进候选 approved 与回执 completed
        db.transaction(() => {
          const candUpdate = db.prepare(`
            UPDATE workspace_import_candidates
            SET status = 'approved', actioned_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ?
          `).run(candidateId, actualProjectId)
          if (candUpdate.changes !== 1) {
            throw new Error('更新候选状态至 approved 失败：受影响行数不为 1')
          }

          invokeTestCrashHook('after_candidate_approved_before_receipt')

          const finalReceiptUpdate = db.prepare(`
            UPDATE workspace_approval_receipts
            SET stage = 'completed', updated_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ?
          `).run(candidateId, actualProjectId)
          if (finalReceiptUpdate.changes !== 1) {
            throw new Error('更新回执状态至 completed 失败：受影响行数不为 1')
          }
        })()

        return { success: true }
      }

      if (candidate.candidate_type === 'setting') {
        const frozenData = JSON.parse(existingReceipt.frozen_payload) as {
          targetRule: SettingRule
          priorContent: string | null
          priorRuleHash: string
          targetContentHash: string
        }
        if (
          !frozenData.targetRule
          || frozenData.targetRule.projectId !== candidate.project_id
          || frozenData.targetRule.sourceFile !== candidate.source_file
          || frozenData.targetRule.sourceHeadingPath !== candidate.source_heading_path
          || frozenData.targetRule.sourceLineRange !== candidate.source_line_range
          || frozenData.targetContentHash !== hashString(frozenData.targetRule.content)
        ) {
          throw new Error('审批冻结设定回执与候选或内容哈希不一致')
        }
        const deterministicRuleId = frozenData.targetRule?.ruleId || `rule-${hashString(`${candidate.source_file}:${candidate.source_heading_path}`).slice(0, 16)}`

        const currentRule = db.prepare(`
          SELECT rule_id, project_id, title, content, status, constraint_type, scope,
                 source_fragment_id, source_snapshot_fragment_id, source_file,
                 source_heading_path, source_line_range
          FROM setting_rules WHERE project_id = ? AND rule_id = ?
        `).get(actualProjectId, deterministicRuleId) as {
          rule_id: string
          project_id: string
          title: string
          content: string
          status: string
          constraint_type: string
          scope: string
          source_fragment_id: string | null
          source_snapshot_fragment_id: string | null
          source_file: string
          source_heading_path: string
          source_line_range: string
        } | undefined

        if (currentRule) {
          // 当前规则存在：如果内容已被作者改变，必须失败关闭，不能覆盖
          const currentRuleHash = settingRuleIntegrityHash({
            ruleId: currentRule.rule_id,
            projectId: currentRule.project_id,
            title: currentRule.title,
            content: currentRule.content,
            status: currentRule.status,
            constraintType: currentRule.constraint_type,
            scope: currentRule.scope,
            sourceFragmentId: currentRule.source_fragment_id,
            sourceSnapshotFragmentId: currentRule.source_snapshot_fragment_id,
            sourceFile: currentRule.source_file,
            sourceHeadingPath: currentRule.source_heading_path,
            sourceLineRange: currentRule.source_line_range,
          })
          const frozenRuleHash = settingRuleIntegrityHash(frozenData.targetRule)
          if (currentRuleHash !== frozenRuleHash) {
            throw new Error('审批恢复失败：设定规则已被作者修改，已拒绝覆盖')
          }
        } else {
          if (existingReceipt.stage !== 'prepared') {
            throw new Error('审批恢复失败：正式设定规则已被删除，已拒绝闭合回执')
          }
          // 规则不存在，可以安全写入
          WorkspaceHubRepository.upsertRule(frozenData.targetRule)
        }

        db.transaction(() => {
          const candUpdate = db.prepare(`
            UPDATE workspace_import_candidates
            SET status = 'approved', actioned_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ?
          `).run(candidateId, actualProjectId)
          if (candUpdate.changes !== 1) {
            throw new Error('更新候选状态至 approved 失败：受影响行数不为 1')
          }

          invokeTestCrashHook('after_candidate_approved_before_receipt')

          const finalReceiptUpdate = db.prepare(`
            UPDATE workspace_approval_receipts
            SET stage = 'completed', updated_at = datetime('now')
            WHERE candidate_id = ? AND project_id = ?
          `).run(candidateId, actualProjectId)
          if (finalReceiptUpdate.changes !== 1) {
            throw new Error('更新回执状态至 completed 失败：受影响行数不为 1')
          }
        })()

        return { success: true }
      }

      // 其他候选类型 (blueprint / lead)
      db.transaction(() => {
        const candUpdate = db.prepare(`
          UPDATE workspace_import_candidates
          SET status = 'approved', actioned_at = datetime('now')
          WHERE candidate_id = ? AND project_id = ?
        `).run(candidateId, actualProjectId)
        if (candUpdate.changes !== 1) {
          throw new Error('更新候选状态至 approved 失败：受影响行数不为 1')
        }

        invokeTestCrashHook('after_candidate_approved_before_receipt')

        const finalReceiptUpdate = db.prepare(`
          UPDATE workspace_approval_receipts
          SET stage = 'completed', updated_at = datetime('now')
          WHERE candidate_id = ? AND project_id = ?
        `).run(candidateId, actualProjectId)
        if (finalReceiptUpdate.changes !== 1) {
          throw new Error('更新回执状态至 completed 失败：受影响行数不为 1')
        }
      })()

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 作者拒绝候选项目（带明确项目会话隔离、补偿防护与状态机一致性防护） */
  static rejectCandidate(candidateId: string, projectId: string): { success: boolean; error?: string } {
    if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
      throw new Error('rejectCandidate 必须提供显式 sessionProjectId')
    }

    const db = requiredDb()
    const candidate = db.prepare(`
      SELECT candidate_id, project_id, candidate_type, raw_data, suggested_data, status
      FROM workspace_import_candidates
      WHERE candidate_id = ? AND project_id = ?
    `).get(candidateId, projectId) as {
      candidate_id: string
      project_id: string
      candidate_type: WorkspaceImportCandidateType
      raw_data: string
      suggested_data: string
      status: string
    } | undefined

    if (!candidate) {
      return { success: false, error: '候选项目不存在' }
    }
    if (candidate.status === 'approved') {
      return { success: false, error: '已批准的候选无法直接拒绝' }
    }
    if (candidate.status === 'rejected') {
      return { success: true }
    }

    const existingReceipt = db.prepare(`
      SELECT candidate_id, project_id, candidate_type, operation_id, payload_hash, frozen_payload, stage
      FROM workspace_approval_receipts
      WHERE candidate_id = ? AND project_id = ?
    `).get(candidateId, projectId) as {
      candidate_id: string
      project_id: string
      candidate_type: string
      operation_id: string
      payload_hash: string
      frozen_payload: string
      stage: 'prepared' | 'roster_committed' | 'completed' | 'compensated'
    } | undefined

    // 状态机流转防护：
    // 若处于 roster_committed，说明角色领域事实已经写入正式名单。
    // 安全策略：禁止直接拒绝，要求先恢复闭合审批。禁止按角色名删除，不得删除作者原有的同名角色。
    if (existingReceipt?.stage === 'roster_committed') {
      return {
        success: false,
        error: '候选审批已处于 roster_committed 阶段，禁止直接拒绝；请先恢复闭合审批以保护角色名单一致性',
      }
    }

    db.transaction(() => {
      const candUpdate = db.prepare(`
        UPDATE workspace_import_candidates
        SET status = 'rejected', actioned_at = datetime('now')
        WHERE candidate_id = ? AND project_id = ?
      `).run(candidateId, projectId)
      if (candUpdate.changes !== 1) {
        throw new Error('更新候选状态至 rejected 失败：受影响行数不为 1')
      }

      // 清理未完成的审批回执（例如 prepared 阶段的临时回执）
      if (existingReceipt) {
        const delReceipt = db.prepare(`
          DELETE FROM workspace_approval_receipts
          WHERE candidate_id = ? AND project_id = ?
        `).run(candidateId, projectId)
        if (delReceipt.changes !== 1) {
          throw new Error('清理审批回执失败：受影响行数不为 1')
        }
      }
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
