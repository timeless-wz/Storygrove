import { getProjectDb } from '../database'
import {
  blueprintPlanningChapterSummaryHash,
  blueprintPlanningChapterIndexHash,
  blueprintPlanningChapterVolumeHash,
  blueprintPlanningVolumeDirectoryHash,
  blueprintPlanningVolumeMetadataHash,
  blueprintPlanningTextHash,
  stableBlueprintPlanningJson,
} from '../../src/shared/blueprint-planning'
import type {
  BlueprintPlanningCandidateKind,
  BlueprintPlanningCandidateListScope,
  BlueprintPlanningCandidateRecord,
  BlueprintPlanningCandidateSaveInput,
  BlueprintPlanningCandidateState,
  BlueprintPlanningCandidateUpdateInput,
  BlueprintPlanningCheckIssue,
  BlueprintPlanningCheckListScope,
  BlueprintPlanningCheckRecord,
  BlueprintPlanningCheckReport,
  BlueprintPlanningConfirmInput,
  BlueprintPlanningCommitReceipt,
  BlueprintPlanningConfirmResult,
  BlueprintPlanningErrorCode,
  BlueprintPlanningExportPackage,
  BlueprintPlanningSelection,
  BlueprintPlanningSourceReference,
  BlueprintPlanningSourceSnapshot,
  BlueprintPlanningSourceStatusRecord,
  BlueprintPlanningTargetSourceReference,
  BlueprintPlanningTargetSourceStatusRecord,
  BlueprintVolumeOutline,
  BlueprintVolumeOutlineDeleteInput,
  BlueprintVolumeOutlineOrigin,
  BlueprintVolumeOutlineSaveInput,
  BlueprintVolumeOutlineSummary,
} from '../../src/shared/blueprint-planning'
import { ProjectCoreRepository } from './project-core-repository'
import { BlueprintDetailRepository } from './blueprint-detail-repository'
import type { ChapterBlueprintV2Content } from '../../src/shared/blueprint-v2'

const HASH_RE = /^[a-f0-9]{64}$/u
const MAX_MARKDOWN_LENGTH = 1_000_000
const MAX_CANDIDATE_JSON_LENGTH = 2_000_000
const MAX_SOURCE_JSON_LENGTH = 512_000
const MAX_CANDIDATE_LIST = 100
const VALID_CANDIDATE_KINDS = new Set<BlueprintPlanningCandidateKind>([
  'book-outline', 'volume-plan', 'volume-outline', 'chapter-plan', 'chapter-expand', 'connection-check',
])
const VALID_OUTLINE_ORIGINS = new Set<BlueprintVolumeOutlineOrigin>(['manual', 'import', 'ai', 'template'])

interface VolumeOutlineRow {
  volume_id: string
  schema_version: number
  markdown: string
  revision: number
  content_hash: string
  origin: BlueprintVolumeOutlineOrigin
  source_snapshot_id: string | null
  created_at: string
  updated_at: string
}

interface CandidateRow {
  operation_id: string
  kind: BlueprintPlanningCandidateKind
  scope_json: string
  state: BlueprintPlanningCandidateState
  schema_version: number
  payload_hash: string
  candidate_json: string
  source_snapshot_json: string
  created_at: string
  updated_at: string
  committed_at: string | null
  commit_receipt_json: string | null
}

interface CheckRow {
  check_id: string
  kind: BlueprintPlanningCheckReport['kind']
  target_kind: BlueprintPlanningCheckReport['targetKind']
  target_id: string
  target_revision: number | null
  target_hash: string
  source_snapshot_json: string
  report_json: string
  created_at: string
}

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  ensureBlueprintPlanningSchema(db)
  return db
}

export function ensureBlueprintPlanningSchema(db: NonNullable<ReturnType<typeof getProjectDb>>): void {
  db.exec(`
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
  `)
}

export function blueprintPlanningSha256(value: string): string {
  return blueprintPlanningTextHash(value)
}

function stableJson(value: unknown): string {
  return stableBlueprintPlanningJson(value)
}

function toOutline(row: VolumeOutlineRow): BlueprintVolumeOutline {
  return {
    volumeId: row.volume_id,
    schemaVersion: row.schema_version,
    markdown: row.markdown,
    revision: row.revision,
    contentHash: row.content_hash,
    origin: row.origin,
    sourceSnapshotId: row.source_snapshot_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readOutline(volumeId: string): BlueprintVolumeOutline | null {
  const db = requireDb()
  const row = db.prepare(`
    SELECT volume_id, schema_version, markdown, revision, content_hash, origin,
           source_snapshot_id, created_at, updated_at
    FROM blueprint_volume_outlines WHERE volume_id = ?
  `).get(volumeId) as VolumeOutlineRow | undefined
  return row ? toOutline(row) : null
}

function validateSelection(selection: BlueprintPlanningSelection): void {
  if (!selection || !['book', 'volume', 'chapter'].includes(selection.kind)) {
    throw new Error('规划范围无效')
  }
  if (selection.kind === 'volume' && (!selection.volumeId.trim() || selection.volumeId.length > 160)) {
    throw new Error('规划卷标识无效')
  }
  if (selection.kind === 'chapter' && (!Number.isSafeInteger(selection.chapterNumber) || selection.chapterNumber < 1)) {
    throw new Error('规划章节号无效')
  }
}

function validateSnapshot(snapshot: BlueprintPlanningSourceSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.snapshotId?.trim() || snapshot.snapshotId.length > 160) {
    throw new Error('规划来源快照无效')
  }
  const selection: BlueprintPlanningSelection = snapshot.targetKind === 'book'
    ? { kind: 'book' }
    : snapshot.targetKind === 'volume'
      ? { kind: 'volume', volumeId: snapshot.targetId }
      : { kind: 'chapter', chapterNumber: Number(snapshot.targetId) }
  validateSelection(selection)
  if (!snapshot.targetId.trim() || !HASH_RE.test(snapshot.targetHash)) throw new Error('规划来源目标版本无效')
  if (snapshot.targetRevision !== undefined && snapshot.targetRevision !== null
    && (!Number.isSafeInteger(snapshot.targetRevision) || snapshot.targetRevision < 0)) {
    throw new Error('规划来源目标 revision 无效')
  }
  if (!Array.isArray(snapshot.sources) || snapshot.sources.length > 500) throw new Error('规划来源列表无效')
  for (const source of snapshot.sources) {
    if (!source || typeof source !== 'object' || typeof source.kind !== 'string'
      || !source.targetId?.trim() || source.targetId.length > 200 || !HASH_RE.test(source.contentHash)) {
      throw new Error('规划来源条目无效')
    }
    if (!['synopsis', 'volume', 'volume-directory', 'volume-index', 'volume-outline', 'chapter-detail', 'chapter-summary', 'chapter-volume', 'chapter-index', 'input', 'template'].includes(source.kind)) {
      throw new Error('规划来源类型不支持')
    }
    if (source.revision !== undefined && source.revision !== null
      && (!Number.isSafeInteger(source.revision) || source.revision < 0)) throw new Error('规划来源 revision 无效')
  }
}

function upsertSnapshot(snapshot: BlueprintPlanningSourceSnapshot, operationId: string | null): void {
  const db = requireDb()
  validateSnapshot(snapshot)
  const sourcesJson = stableJson(snapshot.sources)
  const existing = db.prepare('SELECT * FROM blueprint_planning_sources WHERE snapshot_id = ?')
    .get(snapshot.snapshotId) as Record<string, unknown> | undefined
  if (existing) {
    if (existing.target_kind !== snapshot.targetKind || existing.target_id !== snapshot.targetId
      || existing.target_revision !== (snapshot.targetRevision ?? null) || existing.target_hash !== snapshot.targetHash
      || existing.sources_json !== sourcesJson) throw new Error('规划来源快照 ID 已绑定不同版本')
    return
  }
  db.prepare(`
    INSERT INTO blueprint_planning_sources
      (snapshot_id, operation_id, target_kind, target_id, target_revision, target_hash, sources_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(snapshot.snapshotId, operationId, snapshot.targetKind, snapshot.targetId,
    snapshot.targetRevision ?? null, snapshot.targetHash, sourcesJson)
}

function derivedSnapshot(
  source: BlueprintPlanningSourceSnapshot,
  operationId: string,
  targetKind: BlueprintPlanningSourceSnapshot['targetKind'],
  targetId: string,
  targetRevision: number | null,
  targetHash: string,
): BlueprintPlanningSourceSnapshot {
  const suffix = blueprintPlanningSha256(`${targetKind}:${targetId}:${targetRevision ?? 'none'}:${targetHash}`).slice(0, 20)
  return {
    snapshotId: `${source.snapshotId.slice(0, 110)}:${suffix}`,
    operationId,
    targetKind,
    targetId,
    targetRevision,
    targetHash,
    sources: source.sources,
    createdAt: new Date().toISOString(),
  }
}

function parseJson<T>(value: string, error: string): T {
  try { return JSON.parse(value) as T } catch { throw new Error(error) }
}

function toCandidate(row: CandidateRow): BlueprintPlanningCandidateRecord {
  return {
    operationId: row.operation_id,
    kind: row.kind,
    scope: parseJson<BlueprintPlanningSelection>(row.scope_json, '规划候选范围损坏'),
    state: row.state,
    schemaVersion: row.schema_version,
    payloadHash: row.payload_hash,
    candidate: parseJson<unknown>(row.candidate_json, '规划候选内容损坏'),
    sourceSnapshot: parseJson<BlueprintPlanningSourceSnapshot>(row.source_snapshot_json, '规划候选来源损坏'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    committedAt: row.committed_at,
    commitReceipt: row.commit_receipt_json ? parseJson<unknown>(row.commit_receipt_json, '规划候选收据损坏') : null,
  }
}

function candidateById(operationId: string): BlueprintPlanningCandidateRecord | null {
  const row = requireDb().prepare('SELECT * FROM blueprint_planning_candidates WHERE operation_id = ?')
    .get(operationId) as CandidateRow | undefined
  return row ? toCandidate(row) : null
}

function refreshCandidateFreshness(candidate: BlueprintPlanningCandidateRecord): BlueprintPlanningCandidateRecord {
  if (candidate.state !== 'candidate' || snapshotCurrent(candidate.sourceSnapshot)) return candidate
  requireDb().prepare(`
    UPDATE blueprint_planning_candidates
    SET state = 'stale', updated_at = datetime('now')
    WHERE operation_id = ? AND state = 'candidate'
  `).run(candidate.operationId)
  return { ...candidate, state: 'stale' }
}

function validateCandidateInput(input: BlueprintPlanningCandidateSaveInput): { candidateJson: string; sourceJson: string; scopeJson: string; payloadHash: string } {
  if (!input || typeof input !== 'object' || !input.operationId?.trim() || input.operationId.length > 160) {
    throw new Error('规划候选 operationId 无效')
  }
  if (!VALID_CANDIDATE_KINDS.has(input.kind)) throw new Error('规划候选类型无效')
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion !== 1) throw new Error('规划候选 schema 不支持')
  validateSelection(input.scope)
  validateSnapshot(input.sourceSnapshot)
  const candidateJson = stableJson(input.candidate)
  const sourceJson = stableJson(input.sourceSnapshot)
  const scopeJson = stableJson(input.scope)
  if (candidateJson.length > MAX_CANDIDATE_JSON_LENGTH || sourceJson.length > MAX_SOURCE_JSON_LENGTH) {
    throw new Error('规划候选或来源快照超限')
  }
  if (input.sourceSnapshot.operationId && input.sourceSnapshot.operationId !== input.operationId) {
    throw new Error('规划候选与来源快照 operationId 不一致')
  }
  const payloadHash = blueprintPlanningSha256(stableJson({
    kind: input.kind,
    scope: input.scope,
    schemaVersion: input.schemaVersion,
    candidate: input.candidate,
    sourceSnapshot: input.sourceSnapshot,
  }))
  return { candidateJson, sourceJson, scopeJson, payloadHash }
}

function sourceReferenceMatches(source: BlueprintPlanningSourceReference): boolean {
  const db = requireDb()
  const expectsAbsence = source.revision === 0 && source.contentHash === blueprintPlanningSha256('')
  switch (source.kind) {
    case 'synopsis': {
      const row = db.prepare("SELECT synopsis FROM project_core WHERE id = 'main'").get() as { synopsis: string } | undefined
      return Boolean(row && blueprintPlanningSha256(row.synopsis ?? '') === source.contentHash)
    }
    case 'volume': {
      const row = db.prepare('SELECT id, name, sort_order FROM blueprint_volumes WHERE id = ?')
        .get(source.targetId) as { id: string; name: string; sort_order: number } | undefined
      if (expectsAbsence) return !row
      return Boolean(row && blueprintPlanningVolumeMetadataHash({ id: row.id, name: row.name, sortOrder: row.sort_order }) === source.contentHash)
    }
    case 'volume-directory': {
      const rows = db.prepare('SELECT id, name, sort_order FROM blueprint_volumes ORDER BY sort_order, id')
        .all() as Array<{ id: string; name: string; sort_order: number }>
      return blueprintPlanningVolumeDirectoryHash(rows.map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order }))) === source.contentHash
    }
    case 'volume-index': {
      const rows = db.prepare('SELECT id, name, sort_order FROM blueprint_volumes ORDER BY sort_order, id')
        .all() as Array<{ id: string; name: string; sort_order: number }>
      return blueprintPlanningVolumeDirectoryHash(rows.map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order }))) === source.contentHash
    }
    case 'volume-outline': {
      const row = db.prepare('SELECT revision, content_hash FROM blueprint_volume_outlines WHERE volume_id = ?')
        .get(source.targetId) as { revision: number; content_hash: string } | undefined
      if (expectsAbsence) return !row
      return Boolean(row && row.revision === source.revision && row.content_hash === source.contentHash)
    }
    case 'chapter-detail': {
      const chapterNumber = source.chapterNumber ?? Number(source.targetId)
      const row = db.prepare('SELECT revision, content_hash FROM blueprint_details WHERE chapter_number = ?')
        .get(chapterNumber) as { revision: number; content_hash: string } | undefined
      if (expectsAbsence) return !row
      return Boolean(row && row.revision === source.revision && row.content_hash === source.contentHash)
    }
    case 'chapter-summary': {
      const chapterNumber = source.chapterNumber ?? Number(source.targetId)
      const row = db.prepare('SELECT title, purpose, key_events FROM blueprints WHERE chapter_number = ?')
        .get(chapterNumber) as { title: string; purpose: string; key_events: string } | undefined
      if (expectsAbsence) return !row
      return Boolean(row && blueprintPlanningChapterSummaryHash({
        title: row.title ?? '', purpose: row.purpose ?? '', keyEvents: row.key_events ?? '',
      }) === source.contentHash)
    }
    case 'chapter-volume': {
      const chapterNumber = source.chapterNumber ?? Number(source.targetId)
      const row = db.prepare('SELECT volume_id FROM blueprints WHERE chapter_number = ?')
        .get(chapterNumber) as { volume_id: string } | undefined
      if (expectsAbsence) return !row
      return Boolean(row && row.volume_id === (source.volumeId ?? null)
        && blueprintPlanningChapterVolumeHash(String(row.volume_id ?? '')) === source.contentHash)
    }
    case 'chapter-index': {
      const rows = source.targetId === 'main'
        ? db.prepare(`SELECT chapter_number, volume_id, title, purpose, key_events FROM blueprints ORDER BY chapter_number`).all()
        : db.prepare(`SELECT chapter_number, volume_id, title, purpose, key_events FROM blueprints WHERE volume_id = ? ORDER BY chapter_number`).all(source.targetId)
      const chapters = rows as Array<{ chapter_number: number; volume_id: string; title: string; purpose: string; key_events: string }>
      return blueprintPlanningChapterIndexHash(chapters.map(row => ({
        chapterNumber: row.chapter_number,
        volumeId: row.volume_id ?? '',
        title: row.title ?? '',
        purpose: row.purpose ?? '',
        keyEvents: row.key_events ?? '',
      }))) === source.contentHash
    }
    case 'input':
    case 'template':
      // These are frozen input facts embedded in the snapshot; they have no mutable DB row.
      return true
  }
}

/**
 * Re-read a source after a confirmed operation has intentionally changed it.
 * Candidate snapshots remain immutable and keep the exact generation inputs;
 * committed output snapshots use the post-commit baseline so they do not mark
 * themselves stale because of their own transaction.
 */
function currentSourceReference(source: BlueprintPlanningSourceReference): BlueprintPlanningSourceReference | null {
  const db = requireDb()
  switch (source.kind) {
    case 'synopsis': {
      const row = db.prepare("SELECT synopsis FROM project_core WHERE id = 'main'").get() as { synopsis: string } | undefined
      return row ? { ...source, contentHash: blueprintPlanningSha256(row.synopsis ?? '') } : null
    }
    case 'volume': {
      const row = db.prepare('SELECT id, name, sort_order FROM blueprint_volumes WHERE id = ?')
        .get(source.targetId) as { id: string; name: string; sort_order: number } | undefined
      return row ? {
        ...source,
        volumeId: row.id,
        contentHash: blueprintPlanningVolumeMetadataHash({ id: row.id, name: row.name, sortOrder: row.sort_order }),
      } : null
    }
    case 'volume-directory':
    case 'volume-index': {
      const rows = db.prepare('SELECT id, name, sort_order FROM blueprint_volumes ORDER BY sort_order, id')
        .all() as Array<{ id: string; name: string; sort_order: number }>
      return {
        ...source,
        contentHash: blueprintPlanningVolumeDirectoryHash(rows.map(row => ({ id: row.id, name: row.name, sortOrder: row.sort_order }))),
      }
    }
    case 'volume-outline': {
      const row = db.prepare('SELECT revision, content_hash FROM blueprint_volume_outlines WHERE volume_id = ?')
        .get(source.targetId) as { revision: number; content_hash: string } | undefined
      return row ? { ...source, revision: row.revision, contentHash: row.content_hash } : null
    }
    case 'chapter-detail': {
      const chapterNumber = source.chapterNumber ?? Number(source.targetId)
      const row = db.prepare('SELECT revision, content_hash FROM blueprint_details WHERE chapter_number = ?')
        .get(chapterNumber) as { revision: number; content_hash: string } | undefined
      return row ? { ...source, chapterNumber, revision: row.revision, contentHash: row.content_hash } : null
    }
    case 'chapter-summary': {
      const chapterNumber = source.chapterNumber ?? Number(source.targetId)
      const row = db.prepare('SELECT title, purpose, key_events, volume_id FROM blueprints WHERE chapter_number = ?')
        .get(chapterNumber) as { title: string; purpose: string; key_events: string; volume_id: string | null } | undefined
      return row ? {
        ...source,
        chapterNumber,
        volumeId: row.volume_id,
        contentHash: blueprintPlanningChapterSummaryHash({
          title: row.title ?? '', purpose: row.purpose ?? '', keyEvents: row.key_events ?? '',
        }),
      } : null
    }
    case 'chapter-volume': {
      const chapterNumber = source.chapterNumber ?? Number(source.targetId)
      const row = db.prepare('SELECT volume_id FROM blueprints WHERE chapter_number = ?')
        .get(chapterNumber) as { volume_id: string | null } | undefined
      return row ? {
        ...source,
        chapterNumber,
        volumeId: row.volume_id,
        contentHash: blueprintPlanningChapterVolumeHash(String(row.volume_id ?? '')),
      } : null
    }
    case 'chapter-index': {
      const rows = source.targetId === 'main'
        ? db.prepare('SELECT chapter_number, volume_id, title, purpose, key_events FROM blueprints ORDER BY chapter_number').all()
        : db.prepare('SELECT chapter_number, volume_id, title, purpose, key_events FROM blueprints WHERE volume_id = ? ORDER BY chapter_number').all(source.targetId)
      const chapters = rows as Array<{ chapter_number: number; volume_id: string; title: string; purpose: string; key_events: string }>
      return {
        ...source,
        contentHash: blueprintPlanningChapterIndexHash(chapters.map(row => ({
          chapterNumber: row.chapter_number,
          volumeId: row.volume_id ?? '',
          title: row.title ?? '',
          purpose: row.purpose ?? '',
          keyEvents: row.key_events ?? '',
        }))),
      }
    }
    case 'input':
    case 'template':
      return source
  }
}

function settleCommittedSourceSnapshots(operationId: string, originalSnapshotId: string): void {
  const db = requireDb()
  const rows = db.prepare(`
    SELECT snapshot_id, sources_json
    FROM blueprint_planning_sources
    WHERE operation_id = ? AND snapshot_id <> ?
  `).all(operationId, originalSnapshotId) as Array<{ snapshot_id: string; sources_json: string }>
  const update = db.prepare('UPDATE blueprint_planning_sources SET sources_json = ? WHERE snapshot_id = ?')
  for (const row of rows) {
    const sources = parseJson<BlueprintPlanningSourceReference[]>(row.sources_json, '规划来源快照损坏')
    const settled = sources.map(source => sourceReferenceMatches(source)
      ? source
      : currentSourceReference(source) ?? source)
    update.run(stableJson(settled), row.snapshot_id)
  }
}

function snapshotSourcesCurrent(snapshot: BlueprintPlanningSourceSnapshot): boolean {
  return snapshot.sources.every(sourceReferenceMatches)
}

function snapshotTargetCurrent(snapshot: BlueprintPlanningSourceSnapshot): boolean {
  const db = requireDb()
  const expectsAbsence = (snapshot.targetRevision === 0 || snapshot.targetRevision === null)
    && snapshot.targetHash === blueprintPlanningSha256('')
  if (snapshot.targetKind === 'book') {
    const row = db.prepare("SELECT synopsis FROM project_core WHERE id = 'main'").get() as { synopsis: string } | undefined
    return Boolean(row && blueprintPlanningSha256(row.synopsis ?? '') === snapshot.targetHash)
  }
  if (snapshot.targetKind === 'volume') {
    if (!db.prepare('SELECT 1 FROM blueprint_volumes WHERE id = ?').get(snapshot.targetId)) return false
    const row = db.prepare('SELECT revision, content_hash FROM blueprint_volume_outlines WHERE volume_id = ?')
      .get(snapshot.targetId) as { revision: number; content_hash: string } | undefined
    if (expectsAbsence) return !row
    return Boolean(row && row.revision === snapshot.targetRevision && row.content_hash === snapshot.targetHash)
  }
  const chapterNumber = Number(snapshot.targetId)
  if (snapshot.targetKind === 'chapter' && snapshot.targetRevision === null) {
    const row = db.prepare(`
      SELECT chapter_number, volume_id, title, purpose, key_events, suspense_hook
      FROM blueprints WHERE chapter_number = ?
    `).get(chapterNumber) as {
      chapter_number: number
      volume_id: string | null
      title: string
      purpose: string
      key_events: string
      suspense_hook: string
    } | undefined
    if (!row) return false
    const targetHash = blueprintPlanningSha256(stableJson({
      chapterNumber: row.chapter_number,
      volumeId: row.volume_id ?? '',
      title: row.title ?? '',
      purpose: row.purpose ?? '',
      keyEvents: row.key_events ?? '',
      suspenseHook: row.suspense_hook ?? '',
    }))
    return targetHash === snapshot.targetHash
  }
  const row = db.prepare('SELECT revision, content_hash FROM blueprint_details WHERE chapter_number = ?')
    .get(chapterNumber) as { revision: number; content_hash: string } | undefined
  if (expectsAbsence) return !row
  return Boolean(row && row.revision === snapshot.targetRevision && row.content_hash === snapshot.targetHash)
}

function snapshotCurrent(snapshot: BlueprintPlanningSourceSnapshot): boolean {
  return snapshotTargetCurrent(snapshot) && snapshotSourcesCurrent(snapshot)
}

function sourceStatus(snapshotId: string): BlueprintPlanningSourceStatusRecord {
  const row = requireDb().prepare('SELECT * FROM blueprint_planning_sources WHERE snapshot_id = ?')
    .get(snapshotId) as {
      snapshot_id: string
      operation_id: string | null
      target_kind: BlueprintPlanningSourceSnapshot['targetKind']
      target_id: string
      target_revision: number | null
      target_hash: string
      sources_json: string
      created_at: string
    } | undefined
  if (!row) return { snapshotId, state: 'unlinked' }
  try {
    const snapshot: BlueprintPlanningSourceSnapshot = {
      snapshotId: row.snapshot_id,
      operationId: row.operation_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      targetRevision: row.target_revision,
      targetHash: row.target_hash,
      sources: parseJson<BlueprintPlanningSourceReference[]>(row.sources_json, '规划来源快照损坏'),
      createdAt: row.created_at,
    }
    validateSnapshot(snapshot)
    return { snapshotId, state: snapshotCurrent(snapshot) ? 'current' : 'stale' }
  } catch {
    return { snapshotId, state: 'stale' }
  }
}

function validateVolumeOutlineInput(input: BlueprintVolumeOutlineSaveInput): string | null {
  if (!input || typeof input.volumeId !== 'string' || !input.volumeId.trim() || input.volumeId.length > 160) {
    throw new Error('卷纲 volumeId 无效')
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('卷纲 expectedRevision 无效')
  if (typeof input.markdown !== 'string' || input.markdown.length > MAX_MARKDOWN_LENGTH) throw new Error('卷纲正文无效或超限')
  if (!VALID_OUTLINE_ORIGINS.has(input.origin)) throw new Error('卷纲来源无效')
  if (input.sourceSnapshotId !== undefined && input.sourceSnapshotId !== null
    && (typeof input.sourceSnapshotId !== 'string' || input.sourceSnapshotId.length > 160)) throw new Error('卷纲来源快照 ID 无效')
  return input.sourceSnapshotId ?? null
}

function saveOutlineWithinTransaction(input: BlueprintVolumeOutlineSaveInput):
  | { success: true; outline: BlueprintVolumeOutline }
  | { success: false; code: 'REVISION_CONFLICT' | 'VOLUME_NOT_FOUND'; error: string; current?: BlueprintVolumeOutline | null } {
  const db = requireDb()
  const sourceSnapshotId = validateVolumeOutlineInput(input)
  if (!db.prepare('SELECT 1 FROM blueprint_volumes WHERE id = ?').get(input.volumeId)) {
    return { success: false, code: 'VOLUME_NOT_FOUND', error: '目标卷不存在' }
  }
  const row = db.prepare('SELECT * FROM blueprint_volume_outlines WHERE volume_id = ?').get(input.volumeId) as VolumeOutlineRow | undefined
  const currentRevision = row?.revision ?? 0
  if (currentRevision !== input.expectedRevision) {
    return {
      success: false,
      code: 'REVISION_CONFLICT',
      error: '卷纲已被其他操作修改，请重新读取后保存',
      current: row ? toOutline(row) : null,
    }
  }
  const nowHash = blueprintPlanningSha256(input.markdown)
  const nextRevision = currentRevision + 1
  db.prepare(`
    INSERT INTO blueprint_volume_outlines
      (volume_id, schema_version, markdown, revision, content_hash, origin, source_snapshot_id, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(volume_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      markdown = excluded.markdown,
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      origin = excluded.origin,
      source_snapshot_id = excluded.source_snapshot_id,
      updated_at = datetime('now')
  `).run(input.volumeId, input.markdown, nextRevision, nowHash, input.origin, sourceSnapshotId)
  const saved = db.prepare('SELECT * FROM blueprint_volume_outlines WHERE volume_id = ?').get(input.volumeId) as VolumeOutlineRow
  return { success: true, outline: toOutline(saved) }
}

function matchesSelection(scope: BlueprintPlanningSelection, filter?: BlueprintPlanningSelection): boolean {
  if (!filter) return true
  if (scope.kind !== filter.kind) return false
  if (scope.kind === 'volume' && filter.kind === 'volume') return scope.volumeId === filter.volumeId
  if (scope.kind === 'chapter' && filter.kind === 'chapter') return scope.chapterNumber === filter.chapterNumber
  return scope.kind === 'book' && filter.kind === 'book'
}

function checkCurrentState(report: BlueprintPlanningCheckReport): BlueprintPlanningCheckRecord['currentState'] {
  if (report.sourceSnapshot.sources.length === 0) return 'unlinked'
  try {
    const targetCurrent = snapshotTargetCurrent({
      snapshotId: report.sourceSnapshot.snapshotId,
      targetKind: report.targetKind,
      targetId: report.targetId,
      targetRevision: report.targetRevision,
      targetHash: report.targetHash,
      sources: [],
    })
    return targetCurrent && snapshotCurrent(report.sourceSnapshot) ? 'current' : 'stale'
  } catch {
    return 'stale'
  }
}

function readCheckRecord(row: CheckRow): BlueprintPlanningCheckRecord {
  const report = parseJson<BlueprintPlanningCheckReport>(row.report_json, '规划检查报告损坏')
  return { ...report, createdAt: row.created_at, currentState: checkCurrentState(report) }
}

function issueListValid(value: unknown): value is BlueprintPlanningCheckIssue[] {
  return Array.isArray(value) && value.length <= 1000 && value.every(item => item
    && typeof item === 'object' && typeof item.code === 'string'
    && ['error', 'warning', 'suggestion'].includes(item.severity)
    && typeof item.message === 'string' && item.message.length <= 10_000)
}

function findSourceHash(snapshot: BlueprintPlanningSourceSnapshot, kind: 'synopsis'): string | null {
  return snapshot.sources.find(source => source.kind === kind && source.targetId === 'main')?.contentHash ?? null
}

function selectedIds<T extends { id: string }>(requested: string[] | number[] | undefined, candidates: T[]): string[] {
  const ids = requested === undefined ? candidates.map(item => item.id) : requested.map(String)
  if (new Set(ids).size !== ids.length || ids.some(id => !candidates.some(item => item.id === id))) {
    throw Object.assign(new Error('选择项与规划候选不匹配'), { code: 'INVALID_SELECTION' as const })
  }
  return ids
}

function commitBookOutline(candidate: unknown, snapshot: BlueprintPlanningSourceSnapshot, operationId: string, edits: unknown): void {
  const body = typeof edits === 'string' ? edits
    : edits && typeof edits === 'object' && typeof (edits as { markdown?: unknown }).markdown === 'string'
      ? (edits as { markdown: string }).markdown
      : candidate && typeof candidate === 'object' && typeof (candidate as { markdown?: unknown }).markdown === 'string'
        ? (candidate as { markdown: string }).markdown
        : null
  if (body === null || body.length > MAX_MARKDOWN_LENGTH) throw Object.assign(new Error('总纲候选正文无效'), { code: 'INVALID_CONTENT' as const })
  const core = ProjectCoreRepository.get()
  if (!core) throw Object.assign(new Error('项目主台账未初始化'), { code: 'STORAGE_ERROR' as const })
  const expectedHash = findSourceHash(snapshot, 'synopsis') ?? snapshot.targetHash
  if (blueprintPlanningSha256(core.synopsis) !== expectedHash) {
    throw Object.assign(new Error('全书总纲已变化，候选已过期'), { code: 'STALE_SOURCE' as const })
  }
  const result = ProjectCoreRepository.update({ synopsis: body, expectedSynopsisHash: expectedHash })
  if (!result.success) throw Object.assign(new Error(result.error ?? '全书总纲已变化，候选已过期'), { code: 'STALE_SOURCE' as const })
  upsertSnapshot(derivedSnapshot(snapshot, operationId, 'book', 'main', null, blueprintPlanningSha256(body)), operationId)
}

function commitVolumePlan(
  candidate: unknown,
  selected: string[],
  snapshot: BlueprintPlanningSourceSnapshot,
  operationId: string,
): string[] {
  const db = requireDb()
  const volumes = candidate && typeof candidate === 'object' && Array.isArray((candidate as { volumes?: unknown }).volumes)
    ? (candidate as { volumes: unknown[] }).volumes
    : null
  if (!volumes) throw Object.assign(new Error('分卷候选格式无效'), { code: 'INVALID_CONTENT' as const })
  type VolumeCandidate = Record<string, unknown> & { id: string }
  const entries: VolumeCandidate[] = volumes
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map(item => ({ ...item, id: String(item.volumeId ?? item.id ?? '') }))
  if (new Set(entries.map(item => item.id)).size !== entries.length) {
    throw Object.assign(new Error('分卷候选包含重复的稳定卷标识'), { code: 'INVALID_CONTENT' as const })
  }
  const ids = selectedIds(selected, entries)
  if (ids.length === 0) throw Object.assign(new Error('至少选择一个分卷候选'), { code: 'INVALID_SELECTION' as const })
  const selectedVolumes: VolumeCandidate[] = ids.map(id => entries.find(item => item.id === id)!)
  const now = new Date().toISOString()
  const insertVolume = db.prepare(`
    INSERT INTO blueprint_volumes (id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const item of selectedVolumes) {
    if (!item.id.trim() || item.id.length > 160 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 240) {
      throw Object.assign(new Error('分卷候选包含无效卷名或标识'), { code: 'INVALID_CONTENT' as const })
    }
    const isNew = item.isNew === true
    const existing = db.prepare('SELECT id, name, sort_order FROM blueprint_volumes WHERE id = ?').get(item.id) as
      { id: string; name: string; sort_order: number } | undefined
    if (isNew && existing) throw Object.assign(new Error('新卷标识已被占用'), { code: 'INVALID_SELECTION' as const })
    if (!isNew && !existing) throw Object.assign(new Error('显式选择的已有卷不存在'), { code: 'VOLUME_NOT_FOUND' as const })
    const validOrder = typeof item.sortOrder === 'number' && Number.isSafeInteger(item.sortOrder) && item.sortOrder >= 0
    if (item.sortOrder !== undefined && !validOrder) {
      throw Object.assign(new Error(`卷「${item.name}」排序值无效`), { code: 'INVALID_CONTENT' as const })
    }
    if (isNew) {
      const order = validOrder
        ? item.sortOrder
        : Number((db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM blueprint_volumes').get() as { value: number }).value) + 1
      insertVolume.run(item.id, item.name.trim(), order, now, now)
    } else {
      const order = validOrder ? item.sortOrder : existing!.sort_order
      db.prepare(`
        UPDATE blueprint_volumes SET name = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(item.name.trim(), order, now, item.id)
    }
    if (typeof item.markdown !== 'string' || item.markdown.length > MAX_MARKDOWN_LENGTH) {
      throw Object.assign(new Error(`卷「${item.name}」卷纲正文无效`), { code: 'INVALID_CONTENT' as const })
    }
    const expectedRevision = typeof item.expectedOutlineRevision === 'number'
      && Number.isSafeInteger(item.expectedOutlineRevision) ? item.expectedOutlineRevision : 0
    const outlineSnapshot = derivedSnapshot(snapshot, operationId, 'volume', item.id, expectedRevision + 1,
      blueprintPlanningSha256(item.markdown))
    upsertSnapshot(outlineSnapshot, operationId)
    const outline = saveOutlineWithinTransaction({
      volumeId: item.id,
      expectedRevision,
      markdown: item.markdown,
      origin: 'ai',
      sourceSnapshotId: outlineSnapshot.snapshotId,
    })
    if (!outline.success) throw Object.assign(new Error(outline.error), { code: outline.code })
  }
  return ids
}

function commitChapterPlan(
  candidate: unknown,
  targetVolumeId: string | undefined,
  requestedNumbers: number[] | undefined,
  snapshot: BlueprintPlanningSourceSnapshot,
  operationId: string,
): number[] {
  const db = requireDb()
  const root = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : null
  const volumeId = targetVolumeId ?? (typeof root?.volumeId === 'string' ? root.volumeId : '')
  if (targetVolumeId && typeof root?.volumeId === 'string' && root.volumeId !== targetVolumeId) {
    throw Object.assign(new Error('所选目标卷与章节候选绑定卷不一致'), { code: 'INVALID_SELECTION' as const })
  }
  if (!volumeId || !db.prepare('SELECT 1 FROM blueprint_volumes WHERE id = ?').get(volumeId)) {
    throw Object.assign(new Error('章节规划目标卷不存在'), { code: 'VOLUME_NOT_FOUND' as const })
  }
  if (!Array.isArray(root?.chapters)) throw Object.assign(new Error('章节规划候选格式无效'), { code: 'INVALID_CONTENT' as const })
  const chapters = root.chapters.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
  const allowed = new Set(chapters.map(item => String(item.chapterNumber)))
  const numbers = requestedNumbers === undefined
    ? chapters.map(item => Number(item.chapterNumber))
    : requestedNumbers
  if (new Set(numbers).size !== numbers.length || numbers.some(number => !allowed.has(String(number)))) {
    throw Object.assign(new Error('选择的章节号与候选不匹配'), { code: 'INVALID_SELECTION' as const })
  }
  if (numbers.length === 0) throw Object.assign(new Error('至少选择一个章节规划候选'), { code: 'INVALID_SELECTION' as const })
  const insert = db.prepare(`
    INSERT INTO blueprints (
      chapter_number, volume_id, title, role, purpose, key_events, characters,
      suspense_hook, user_guidance, notes, notes_updated_at
    ) VALUES (?, ?, ?, '', ?, ?, '[]', ?, '', '', '')
  `)
  for (const number of numbers) {
    if (!Number.isSafeInteger(number) || number < 1) throw Object.assign(new Error('规划章节号无效'), { code: 'INVALID_CONTENT' as const })
    const item = chapters.find(value => Number(value.chapterNumber) === number)
    if (!item || typeof item.title !== 'string' || item.title.length > 160
      || typeof item.purpose !== 'string' || typeof item.keyEvents !== 'string') {
      throw Object.assign(new Error(`第${number}章规划内容无效`), { code: 'INVALID_CONTENT' as const })
    }
    if (db.prepare('SELECT 1 FROM blueprints WHERE chapter_number = ?').get(number)) {
      throw Object.assign(new Error(`第${number}章已存在，规划候选不会覆盖人工或导入简纲`), { code: 'CHAPTER_NUMBER_CONFLICT' as const })
    }
    const suspenseHook = typeof item.suspenseHook === 'string' ? item.suspenseHook : ''
    insert.run(number, volumeId, item.title, item.purpose, item.keyEvents, suspenseHook)
    const targetHash = blueprintPlanningSha256(stableJson({
      chapterNumber: number, volumeId, title: item.title, purpose: item.purpose, keyEvents: item.keyEvents, suspenseHook,
    }))
    upsertSnapshot(derivedSnapshot(snapshot, operationId, 'chapter', String(number), null, targetHash), operationId)
  }
  return numbers
}

function commitChapterExpand(
  candidate: unknown,
  edits: unknown,
  snapshot: BlueprintPlanningSourceSnapshot,
  operationId: string,
): { chapterNumber: number; revision: number; contentHash: string } {
  const payload = edits ?? candidate
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('细纲展开候选无效'), { code: 'INVALID_CONTENT' as const })
  const item = payload as Record<string, unknown>
  const chapterNumber = Number(item.chapterNumber)
  const content = item.content as ChapterBlueprintV2Content | undefined
  const baseRevision = Number(item.baseRevision)
  if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1 || !content || content.chapterNumber !== chapterNumber
    || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw Object.assign(new Error('细纲展开候选缺少章号、内容或 revision'), { code: 'INVALID_CONTENT' as const })
  }
  const result = BlueprintDetailRepository.save({ chapterNumber, baseRevision, content })
  if (!result.success) throw Object.assign(new Error(result.error ?? '细纲保存失败'), {
    code: result.conflict ? 'REVISION_CONFLICT' as const : 'INVALID_CONTENT' as const,
  })
  const saved = BlueprintDetailRepository.get(chapterNumber)
  if (!saved || saved.readStatus) throw Object.assign(new Error('细纲保存后无法安全读回'), { code: 'STORAGE_ERROR' as const })
  upsertSnapshot(derivedSnapshot(snapshot, operationId, 'chapter', String(chapterNumber), saved.revision, saved.contentHash), operationId)
  return { chapterNumber, revision: saved.revision, contentHash: saved.contentHash }
}

export class BlueprintPlanningRepository {
  static getVolumeOutline(volumeId: string): BlueprintVolumeOutline | null {
    if (!volumeId?.trim()) throw new Error('卷纲 volumeId 无效')
    return readOutline(volumeId)
  }

  /** A list-safe SQL projection; it never selects the full Markdown body. */
  static listVolumeOutlineSummaries(): BlueprintVolumeOutlineSummary[] {
    const rows = requireDb().prepare(`
      SELECT o.volume_id, o.revision, o.content_hash, o.origin, o.updated_at,
             substr(o.markdown, 1, 240) AS summary
      FROM blueprint_volume_outlines o
      JOIN blueprint_volumes v ON v.id = o.volume_id
      ORDER BY v.sort_order, v.created_at, v.id
    `).all() as Array<{ volume_id: string; revision: number; content_hash: string; origin: BlueprintVolumeOutlineOrigin; updated_at: string; summary: string }>
    return rows.map(row => ({
      volumeId: row.volume_id, revision: row.revision, contentHash: row.content_hash,
      origin: row.origin, updatedAt: row.updated_at, summary: row.summary,
    }))
  }

  static saveVolumeOutline(input: BlueprintVolumeOutlineSaveInput) {
    try {
      const result = requireDb().transaction(() => saveOutlineWithinTransaction(input))()
      return result
    } catch (error) {
      return { success: false as const, code: 'STORAGE_ERROR' as const, error: error instanceof Error ? error.message : String(error) }
    }
  }

  static deleteVolumeOutline(input: BlueprintVolumeOutlineDeleteInput):
    | { success: true; deleted: boolean }
    | { success: false; code: 'VOLUME_NOT_FOUND' | 'REVISION_CONFLICT' | 'STORAGE_ERROR'; error: string; current?: BlueprintVolumeOutline | null } {
    try {
      const db = requireDb()
      if (!input?.volumeId?.trim() || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
        return { success: false, code: 'STORAGE_ERROR', error: '卷纲清空请求无效' }
      }
      return db.transaction(() => {
        if (!db.prepare('SELECT 1 FROM blueprint_volumes WHERE id = ?').get(input.volumeId)) {
          return { success: false as const, code: 'VOLUME_NOT_FOUND' as const, error: '目标卷不存在' }
        }
        const current = readOutline(input.volumeId)
        if (!current && input.expectedRevision === 0) return { success: true as const, deleted: false }
        if (!current || current.revision !== input.expectedRevision) {
          return {
            success: false as const,
            code: 'REVISION_CONFLICT' as const,
            error: '卷纲版本已变化，请重新读取后再清空',
            current,
          }
        }
        db.prepare('DELETE FROM blueprint_volume_outlines WHERE volume_id = ? AND revision = ?')
          .run(input.volumeId, input.expectedRevision)
        return { success: true as const, deleted: true }
      })()
    } catch (error) {
      return { success: false, code: 'STORAGE_ERROR', error: error instanceof Error ? error.message : String(error) }
    }
  }

  static saveCandidate(input: BlueprintPlanningCandidateSaveInput):
    | { success: true; candidate: BlueprintPlanningCandidateRecord; idempotent: boolean }
    | { success: false; code: BlueprintPlanningErrorCode; error: string } {
    try {
      const db = requireDb()
      const normalized = validateCandidateInput(input)
      return db.transaction(() => {
        const existing = db.prepare('SELECT * FROM blueprint_planning_candidates WHERE operation_id = ?')
          .get(input.operationId) as CandidateRow | undefined
        if (existing) {
          if (existing.payload_hash !== normalized.payloadHash) {
            return { success: false as const, code: 'OPERATION_ID_REUSE' as const, error: 'operationId 已绑定不同候选载荷' }
          }
          return { success: true as const, candidate: toCandidate(existing), idempotent: true }
        }
        upsertSnapshot(input.sourceSnapshot, input.operationId)
        db.prepare(`
          INSERT INTO blueprint_planning_candidates
            (operation_id, kind, scope_json, state, schema_version, payload_hash, candidate_json,
             source_snapshot_json, created_at, updated_at)
          VALUES (?, ?, ?, 'candidate', ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(input.operationId, input.kind, normalized.scopeJson, input.schemaVersion, normalized.payloadHash,
          normalized.candidateJson, normalized.sourceJson)
        return { success: true as const, candidate: candidateById(input.operationId)!, idempotent: false }
      })()
    } catch (error) {
      return { success: false, code: 'INVALID_CONTENT', error: error instanceof Error ? error.message : String(error) }
    }
  }

  static getCandidate(operationId: string): BlueprintPlanningCandidateRecord | null {
    if (!operationId?.trim()) throw new Error('规划候选 operationId 无效')
    const db = requireDb()
    return db.transaction(() => {
      const candidate = candidateById(operationId)
      return candidate ? refreshCandidateFreshness(candidate) : null
    })()
  }

  static getSourceStatuses(snapshotIds: string[]): BlueprintPlanningSourceStatusRecord[] {
    if (!Array.isArray(snapshotIds) || snapshotIds.length > MAX_CANDIDATE_LIST) {
      throw new Error('规划来源状态查询列表无效或超限')
    }
    const uniqueIds = [...new Set(snapshotIds)]
    if (uniqueIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 160)) {
      throw new Error('规划来源状态快照 ID 无效')
    }
    requireDb()
    return uniqueIds.map(sourceStatus)
  }

  static getTargetSourceStatuses(targets: BlueprintPlanningTargetSourceReference[]): BlueprintPlanningTargetSourceStatusRecord[] {
    if (!Array.isArray(targets) || targets.length > MAX_CANDIDATE_LIST) {
      throw new Error('规划目标来源状态查询列表无效或超限')
    }
    const uniqueTargets = [...new Map(targets.map(target => [`${target?.targetKind}:${target?.targetId}`, target])).values()]
    if (uniqueTargets.some(target => !target || !['book', 'volume', 'chapter'].includes(target.targetKind)
      || typeof target.targetId !== 'string' || !target.targetId.trim() || target.targetId.length > 200)) {
      throw new Error('规划目标来源状态查询目标无效')
    }
    const db = requireDb()
    return uniqueTargets.map(target => {
      const row = db.prepare(`
        SELECT s.snapshot_id, s.operation_id
        FROM blueprint_planning_sources s
        JOIN blueprint_planning_candidates c ON c.operation_id = s.operation_id
        WHERE s.target_kind = ? AND s.target_id = ? AND c.state = 'committed'
        ORDER BY s.created_at DESC, s.rowid DESC
        LIMIT 1
      `).get(target.targetKind, target.targetId) as { snapshot_id: string; operation_id: string | null } | undefined
      if (!row) return { ...target, snapshotId: null, operationId: null, state: 'unlinked' as const }
      return { ...target, ...sourceStatus(row.snapshot_id), operationId: row.operation_id }
    })
  }

  static updateCandidate(input: BlueprintPlanningCandidateUpdateInput):
    | { success: true; candidate: BlueprintPlanningCandidateRecord }
    | { success: false; code: BlueprintPlanningErrorCode; error: string; current?: BlueprintPlanningCandidateRecord } {
    try {
      const db = requireDb()
      if (!input.operationId?.trim() || !HASH_RE.test(input.expectedPayloadHash)) {
        return { success: false, code: 'INVALID_CONTENT', error: '候选编辑缺少有效的 operationId 或版本 hash' }
      }
      const candidateJson = stableJson(input.candidate)
      if (candidateJson.length > MAX_CANDIDATE_JSON_LENGTH) {
        return { success: false, code: 'INVALID_CONTENT', error: '规划候选内容超限' }
      }
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM blueprint_planning_candidates WHERE operation_id = ?')
          .get(input.operationId) as CandidateRow | undefined
        if (!row) return { success: false as const, code: 'CANDIDATE_NOT_FOUND' as const, error: '规划候选不存在' }
        const current = toCandidate(row)
        if (current.state !== 'candidate') {
          return { success: false as const, code: 'INVALID_SELECTION' as const, error: '只有待确认候选可以编辑', current }
        }
        if (row.payload_hash !== input.expectedPayloadHash) {
          return { success: false as const, code: 'REVISION_CONFLICT' as const, error: '候选已被其他编辑更新', current }
        }
        const nextPayloadHash = blueprintPlanningSha256(stableJson({
          kind: current.kind,
          scope: current.scope,
          schemaVersion: current.schemaVersion,
          candidate: input.candidate,
          sourceSnapshot: current.sourceSnapshot,
        }))
        const update = db.prepare(`
          UPDATE blueprint_planning_candidates
          SET candidate_json = ?, payload_hash = ?, updated_at = datetime('now')
          WHERE operation_id = ? AND payload_hash = ? AND state = 'candidate'
        `).run(candidateJson, nextPayloadHash, input.operationId, input.expectedPayloadHash)
        if (update.changes !== 1) {
          return { success: false as const, code: 'REVISION_CONFLICT' as const, error: '候选已被其他编辑更新', current: candidateById(input.operationId) ?? undefined }
        }
        return { success: true as const, candidate: candidateById(input.operationId)! }
      })()
    } catch (error) {
      return { success: false, code: 'STORAGE_ERROR', error: error instanceof Error ? error.message : String(error) }
    }
  }

  static listCandidates(scope: BlueprintPlanningCandidateListScope): BlueprintPlanningCandidateRecord[] {
    if (scope?.selection) validateSelection(scope.selection)
    const limit = scope?.limit === undefined ? 30 : Math.min(MAX_CANDIDATE_LIST, Math.max(1, Math.trunc(scope.limit)))
    const db = requireDb()
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM blueprint_planning_candidates ORDER BY updated_at DESC LIMIT 200
      `).all() as CandidateRow[]
      return rows.map(toCandidate).map(refreshCandidateFreshness)
        .filter(row => matchesSelection(row.scope, scope?.selection))
        .filter(row => !scope?.states?.length || scope.states.includes(row.state))
        .slice(0, limit)
    })()
  }

  static cancelCandidate(operationId: string):
    | { success: true; candidate: BlueprintPlanningCandidateRecord }
    | { success: false; code: BlueprintPlanningErrorCode; error: string } {
    try {
      const db = requireDb()
      return db.transaction(() => {
        const candidate = candidateById(operationId)
        if (!candidate) return { success: false as const, code: 'CANDIDATE_NOT_FOUND' as const, error: '规划候选不存在' }
        if (candidate.state === 'committed') return { success: false as const, code: 'INVALID_SELECTION' as const, error: '已确认的候选不能取消' }
        if (candidate.state !== 'cancelled') db.prepare(`
          UPDATE blueprint_planning_candidates SET state = 'cancelled', updated_at = datetime('now') WHERE operation_id = ?
        `).run(operationId)
        return { success: true as const, candidate: candidateById(operationId)! }
      })()
    } catch (error) {
      return { success: false, code: 'STORAGE_ERROR', error: error instanceof Error ? error.message : String(error) }
    }
  }

  static saveCheck(report: BlueprintPlanningCheckReport): BlueprintPlanningCheckRecord {
    const db = requireDb()
    validateSnapshot(report.sourceSnapshot)
    if (!report.checkId?.trim() || report.checkId.length > 160
      || !['book-volume', 'volume-chapters'].includes(report.kind)
      || !issueListValid(report.deterministic) || !issueListValid(report.aiSuggestions)) {
      throw new Error('规划检查报告无效')
    }
    if (report.targetKind !== report.sourceSnapshot.targetKind || report.targetId !== report.sourceSnapshot.targetId
      || report.targetRevision !== (report.sourceSnapshot.targetRevision ?? null)
      || report.targetHash !== report.sourceSnapshot.targetHash) throw new Error('检查目标与来源快照不一致')
    const reportJson = stableJson(report)
    const sourceJson = stableJson(report.sourceSnapshot)
    if (reportJson.length > MAX_CANDIDATE_JSON_LENGTH || sourceJson.length > MAX_SOURCE_JSON_LENGTH) throw new Error('规划检查报告超限')
    return db.transaction(() => {
      upsertSnapshot(report.sourceSnapshot, report.sourceSnapshot.operationId ?? null)
      db.prepare(`
      INSERT INTO blueprint_planning_checks
        (check_id, kind, target_kind, target_id, target_revision, target_hash,
         source_snapshot_json, report_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(check_id) DO UPDATE SET
        kind = excluded.kind, target_kind = excluded.target_kind, target_id = excluded.target_id,
        target_revision = excluded.target_revision, target_hash = excluded.target_hash,
        source_snapshot_json = excluded.source_snapshot_json, report_json = excluded.report_json
      `).run(report.checkId, report.kind, report.targetKind, report.targetId, report.targetRevision,
        report.targetHash, sourceJson, reportJson)
      const row = db.prepare('SELECT * FROM blueprint_planning_checks WHERE check_id = ?').get(report.checkId) as CheckRow
      return readCheckRecord(row)
    })()
  }

  static listChecks(scope: BlueprintPlanningCheckListScope): BlueprintPlanningCheckRecord[] {
    if (scope?.selection) validateSelection(scope.selection)
    const limit = scope?.limit === undefined ? 30 : Math.min(MAX_CANDIDATE_LIST, Math.max(1, Math.trunc(scope.limit)))
    const rows = requireDb().prepare(`SELECT * FROM blueprint_planning_checks ORDER BY created_at DESC LIMIT 200`).all() as CheckRow[]
    return rows.map(readCheckRecord)
      .filter(row => !scope?.selection || (row.targetKind === scope.selection.kind
        && (row.targetKind === 'book'
          || (row.targetKind === 'volume' && scope.selection.kind === 'volume' && row.targetId === scope.selection.volumeId)
          || (row.targetKind === 'chapter' && scope.selection.kind === 'chapter' && Number(row.targetId) === scope.selection.chapterNumber))))
      .slice(0, limit)
  }

  static confirm(input: BlueprintPlanningConfirmInput): BlueprintPlanningConfirmResult {
    try {
      const db = requireDb()
      if (!input.operationId?.trim()) return { success: false, code: 'INVALID_SELECTION', error: '规划确认缺少 operationId' }
      validateSnapshot(input.expectedSourceSnapshot)
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM blueprint_planning_candidates WHERE operation_id = ?')
          .get(input.operationId) as CandidateRow | undefined
        if (!row) return { success: false as const, code: 'CANDIDATE_NOT_FOUND' as const, error: '规划候选不存在' }
        const candidate = toCandidate(row)
        const confirmationHash = blueprintPlanningSha256(stableJson({ selection: input.selection, edits: input.edits ?? null }))
        if (candidate.state === 'committed' && candidate.commitReceipt) {
          const previous = candidate.commitReceipt as BlueprintPlanningCommitReceipt
          if (previous.confirmationHash !== confirmationHash) {
            return { success: false as const, code: 'OPERATION_ID_REUSE' as const, error: 'operationId 已用不同选择或编辑完成确认' }
          }
          return { success: true as const, receipt: { ...previous, idempotent: true } }
        }
        if (candidate.state === 'cancelled') return { success: false as const, code: 'INVALID_SELECTION' as const, error: '规划候选已取消' }
        if (candidate.state === 'stale') return { success: false as const, code: 'STALE_SOURCE' as const, error: '规划候选来源已变化，请重新生成' }
        if (stableJson(candidate.sourceSnapshot) !== stableJson(input.expectedSourceSnapshot)) {
          return { success: false as const, code: 'STALE_SOURCE' as const, error: '确认时的来源快照与候选不一致' }
        }
        if (!snapshotCurrent(candidate.sourceSnapshot)) {
          db.prepare(`UPDATE blueprint_planning_candidates SET state = 'stale', updated_at = datetime('now') WHERE operation_id = ?`)
            .run(input.operationId)
          return { success: false as const, code: 'STALE_SOURCE' as const, error: '候选来源已变化；候选已保留并标记为过期' }
        }

        const selectedVolumeIds: string[] = []
        let chapterNumbers: number[] = []
        switch (candidate.kind) {
          case 'book-outline':
            commitBookOutline(candidate.candidate, candidate.sourceSnapshot, candidate.operationId, input.edits)
            break
          case 'volume-plan':
            selectedVolumeIds.push(...commitVolumePlan(candidate.candidate, input.selection.volumeIds ?? [], candidate.sourceSnapshot, candidate.operationId))
            break
          case 'volume-outline': {
            const payload = candidate.candidate && typeof candidate.candidate === 'object' ? candidate.candidate as Record<string, unknown> : {}
            const volumeId = input.selection.targetVolumeId
              ?? (candidate.scope.kind === 'volume' ? candidate.scope.volumeId : String(payload.volumeId ?? ''))
            const markdown = typeof input.edits === 'string' ? input.edits
              : input.edits && typeof input.edits === 'object' && typeof (input.edits as { markdown?: unknown }).markdown === 'string'
                ? (input.edits as { markdown: string }).markdown
                : payload.markdown
            const expectedRevision = Number.isSafeInteger(payload.expectedRevision) ? Number(payload.expectedRevision) : 0
            if (typeof markdown !== 'string') throw Object.assign(new Error('卷纲候选正文无效'), { code: 'INVALID_CONTENT' as const })
            const outlineSnapshot = derivedSnapshot(candidate.sourceSnapshot, candidate.operationId, 'volume', volumeId,
              expectedRevision + 1, blueprintPlanningSha256(markdown))
            upsertSnapshot(outlineSnapshot, candidate.operationId)
            const saved = saveOutlineWithinTransaction({
              volumeId, expectedRevision, markdown,
              origin: 'ai', sourceSnapshotId: outlineSnapshot.snapshotId,
            })
            if (!saved.success) throw Object.assign(new Error(saved.error), { code: saved.code })
            selectedVolumeIds.push(volumeId)
            break
          }
          case 'chapter-plan':
            chapterNumbers = commitChapterPlan(candidate.candidate, input.selection.targetVolumeId,
              input.selection.chapterNumbers, candidate.sourceSnapshot, candidate.operationId)
            selectedVolumeIds.push(input.selection.targetVolumeId
              ?? (candidate.candidate && typeof candidate.candidate === 'object' ? String((candidate.candidate as { volumeId?: unknown }).volumeId ?? '') : ''))
            break
          case 'chapter-expand':
            chapterNumbers.push(commitChapterExpand(candidate.candidate, input.edits,
              candidate.sourceSnapshot, candidate.operationId).chapterNumber)
            break
          case 'connection-check':
            throw Object.assign(new Error('衔接检查报告请通过规划检查保存通道提交'), { code: 'INVALID_SELECTION' as const })
        }

        // A plan's own transaction may create the very rows that the generation
        // snapshot recorded as absent, or advance an outline it used as input.
        // Keep the candidate snapshot frozen; rebase only the committed output
        // snapshots so their source status reflects changes after confirmation.
        settleCommittedSourceSnapshots(candidate.operationId, candidate.sourceSnapshot.snapshotId)

        const committedAt = new Date().toISOString()
        const receipt: BlueprintPlanningCommitReceipt = {
          operationId: candidate.operationId,
          kind: candidate.kind,
          payloadHash: candidate.payloadHash,
          committedAt,
          selectedVolumeIds: [...new Set(selectedVolumeIds.filter(Boolean))],
          chapterNumbers,
          sourceSnapshotId: candidate.sourceSnapshot.snapshotId,
          confirmationHash,
          idempotent: false,
        }
        db.prepare(`
          UPDATE blueprint_planning_candidates
          SET state = 'committed', committed_at = datetime('now'), commit_receipt_json = ?, updated_at = datetime('now')
          WHERE operation_id = ?
        `).run(stableJson(receipt), candidate.operationId)
        return { success: true as const, receipt }
      })()
    } catch (error) {
      const candidateCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code) as BlueprintPlanningErrorCode
        : 'STORAGE_ERROR'
      return { success: false, code: candidateCode, error: error instanceof Error ? error.message : String(error) }
    }
  }

  static exportPlanningPackage(): BlueprintPlanningExportPackage {
    const db = requireDb()
    const core = ProjectCoreRepository.get()
    const volumes = db.prepare(`
      SELECT v.id, v.name, v.sort_order, o.volume_id, o.schema_version, o.markdown, o.revision,
             o.content_hash, o.origin, o.source_snapshot_id, o.created_at AS outline_created_at,
             o.updated_at AS outline_updated_at
      FROM blueprint_volumes v
      LEFT JOIN blueprint_volume_outlines o ON o.volume_id = v.id
      ORDER BY v.sort_order, v.created_at, v.id
    `).all() as Array<Record<string, unknown>>
    const chapters = db.prepare(`
      SELECT b.chapter_number, b.volume_id, b.title, b.role, b.purpose, b.key_events, b.characters,
             b.suspense_hook, b.user_guidance, b.notes, b.notes_updated_at,
             d.schema_version AS detail_schema_version, d.detail_json, d.raw_markdown,
             d.revision AS detail_revision, d.content_hash AS detail_content_hash,
             d.created_at AS detail_created_at, d.updated_at AS detail_updated_at
      FROM blueprints b
      LEFT JOIN blueprint_details d ON d.chapter_number = b.chapter_number
      ORDER BY b.chapter_number
    `).all() as Array<Record<string, unknown>>
    return {
      manifest: { schemaVersion: 1, exportedAt: new Date().toISOString() },
      synopsis: core?.synopsis ?? '',
      volumes: volumes.map(row => ({
        volumeId: String(row.id), name: String(row.name), sortOrder: Number(row.sort_order),
        outline: row.volume_id === null ? null : {
          volumeId: String(row.volume_id), schemaVersion: Number(row.schema_version), markdown: String(row.markdown),
          revision: Number(row.revision), contentHash: String(row.content_hash), origin: row.origin as BlueprintVolumeOutlineOrigin,
          sourceSnapshotId: row.source_snapshot_id as string | null,
          createdAt: String(row.outline_created_at), updatedAt: String(row.outline_updated_at),
        },
      })),
      chapters: chapters.map(row => ({
        chapterNumber: Number(row.chapter_number), volumeId: String(row.volume_id),
        blueprint: {
          chapterNumber: Number(row.chapter_number), volumeId: String(row.volume_id), title: row.title,
          role: row.role, purpose: row.purpose, keyEvents: row.key_events,
          characters: parseJson<unknown[]>(String(row.characters ?? '[]'), '章节人物字段损坏'),
          suspenseHook: row.suspense_hook, userGuidance: row.user_guidance,
          notes: row.notes, notesUpdatedAt: row.notes_updated_at,
        },
        detail: row.detail_json === null ? null : {
          schemaVersion: row.detail_schema_version, detail: parseJson<unknown>(String(row.detail_json), '章节细纲损坏'),
          rawMarkdown: row.raw_markdown, revision: row.detail_revision, contentHash: row.detail_content_hash,
          createdAt: row.detail_created_at, updatedAt: row.detail_updated_at,
        },
      })),
    }
  }
}
