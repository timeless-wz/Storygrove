import { createHash, randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import { getProjectDb } from '../database'
import type {
  StoryEntityType,
  StoryFact,
  StoryFactCandidate,
  StoryFactCandidateInput,
  StoryFactImpact,
  StoryFactImpactInput,
  StoryFactRelation,
  StoryFactRelationInput,
  StoryFactVersion,
  StoryProvenance,
  StoryRecordStatus,
} from '../../src/shared/story-domain'

type Row = Record<string, unknown>

function requiredDb(): BetterSqlite3.Database {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function requiredProjectId(projectId: string): string {
  const normalized = projectId.trim()
  if (!normalized || normalized.length > 200) throw new Error('必须提供显式 projectId')
  return normalized
}

function requiredText(value: string, label: string, maxLength = 1000): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new Error(`${label}无效`)
  return normalized
}

function validateProvenance(provenance: StoryProvenance): StoryProvenance {
  const sourceId = requiredText(provenance.sourceId, 'sourceId', 200)
  const sourceSnapshotId = requiredText(provenance.sourceSnapshotId, 'sourceSnapshotId', 200)
  const sourceFragmentId = requiredText(provenance.sourceFragmentId, 'sourceFragmentId', 200)
  const sourceFile = requiredText(provenance.sourceFile, 'sourceFile', 2000)
  const sourceHeadingPath = requiredText(provenance.sourceHeadingPath, 'sourceHeadingPath', 2000)
  if (!Number.isSafeInteger(provenance.startLine) || provenance.startLine < 1
    || !Number.isSafeInteger(provenance.endLine) || provenance.endLine < provenance.startLine) {
    throw new Error('来源行号范围无效')
  }
  const contentHash = requiredText(provenance.contentHash, 'contentHash', 200)
  return {
    sourceId,
    sourceSnapshotId,
    sourceFragmentId,
    sourceFile,
    sourceHeadingPath,
    startLine: provenance.startLine,
    endLine: provenance.endLine,
    contentHash,
  }
}

function assertProvenanceBelongsToProject(
  db: BetterSqlite3.Database,
  projectId: string,
  provenance: StoryProvenance,
): void {
  const finalizedDraft = /^finalized-draft:(\d+)$/u.exec(provenance.sourceId)
  if (finalizedDraft) {
    const draftId = Number(finalizedDraft[1])
    const draft = db.prepare(`
      SELECT drafts.id, drafts.chapter_number AS chapterNumber, drafts.version, drafts.status, contents.body AS content
      FROM drafts JOIN contents ON contents.id = drafts.content_id
      WHERE drafts.id = ?
    `).get(draftId) as { id: number; chapterNumber: number; version: number; status: string; content: string } | undefined
    const expectedHash = draft ? createHash('sha256').update(draft.content, 'utf8').digest('hex') : ''
    const expectedLines = draft ? draft.content.split(/\r?\n/u).length : 0
    if (
      !draft || draft.status !== 'finalized'
      || provenance.sourceSnapshotId !== `finalized-v${draft.version}`
      || provenance.sourceFragmentId !== `draft-${draft.id}-body-v${draft.version}`
      || provenance.sourceFile !== `internal://finalized-drafts/${draft.id}/v${draft.version}`
      || provenance.sourceHeadingPath !== `第${draft.chapterNumber}章定稿正文`
      || provenance.startLine < 1 || provenance.endLine > expectedLines
      || provenance.contentHash !== expectedHash
    ) throw new Error('定稿正文来源不存在、不是当前定稿或已变化，已拒绝写入候选')
    return
  }
  const row = db.prepare(`
    SELECT 1 AS present
    FROM workspace_source_snapshot_fragments fragments
    JOIN workspace_source_snapshots snapshots
      ON snapshots.snapshot_id = fragments.snapshot_id
     AND snapshots.source_id = fragments.source_id
     AND snapshots.project_id = fragments.project_id
    JOIN workspace_sources sources
      ON sources.id = fragments.source_id AND sources.project_id = fragments.project_id
    WHERE fragments.id = ? AND fragments.snapshot_id = ? AND fragments.source_id = ?
      AND fragments.project_id = ? AND snapshots.content_hash = ?
    LIMIT 1
  `).get(
    provenance.sourceFragmentId,
    provenance.sourceSnapshotId,
    provenance.sourceId,
    projectId,
    provenance.contentHash,
  ) as { present: number } | undefined
  if (!row) throw new Error('来源快照或片段不存在，已拒绝写入候选')
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'string') throw new Error(`${label}损坏`)
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label}不是有效 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是对象`)
  return parsed as Record<string, unknown>
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

function candidateFromRow(row: Row): StoryFactCandidate {
  return {
    candidateId: row.candidate_id as string,
    projectId: row.project_id as string,
    entityType: row.entity_type as StoryEntityType,
    canonicalName: row.canonical_name as string,
    summary: row.summary as string,
    payload: parseObject(row.payload_json, '候选资料'),
    confidence: row.confidence as number,
    provenance: provenanceFromRow(row),
    possibleConflicts: parseStringArray(row.possible_conflicts_json),
    authorityStatus: 'candidate',
    reviewStatus: row.review_status as StoryFactCandidate['reviewStatus'],
    createdAt: row.created_at as string,
    ...(row.actioned_at ? { actionedAt: row.actioned_at as string } : {}),
  }
}

function provenanceFromRow(row: Row): StoryProvenance {
  return {
    sourceId: row.source_id as string,
    sourceSnapshotId: row.source_snapshot_id as string,
    sourceFragmentId: row.source_fragment_id as string,
    sourceFile: row.source_file as string,
    sourceHeadingPath: row.source_heading_path as string,
    startLine: row.source_start_line as number,
    endLine: row.source_end_line as number,
    contentHash: row.source_content_hash as string,
  }
}

function factFromRow(row: Row): StoryFact {
  return {
    factId: row.fact_id as string,
    projectId: row.project_id as string,
    entityType: row.entity_type as StoryEntityType,
    canonicalName: row.canonical_name as string,
    summary: row.summary as string,
    payload: parseObject(row.payload_json, '正式资料'),
    status: row.status as StoryRecordStatus,
    confidence: row.confidence as number,
    revision: row.revision as number,
    provenance: provenanceFromRow(row),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at as string } : {}),
    ...(row.confirmed_by ? { confirmedBy: row.confirmed_by as string } : {}),
  }
}

function versionFromRow(row: Row): StoryFactVersion {
  return {
    versionId: row.version_id as string,
    factId: row.fact_id as string,
    projectId: row.project_id as string,
    version: row.version as number,
    summary: row.summary as string,
    payload: parseObject(row.payload_json, '资料版本'),
    status: row.status as StoryRecordStatus,
    changedBy: row.changed_by as string,
    provenance: provenanceFromRow(row),
    createdAt: row.created_at as string,
  }
}

function assertFactProject(db: BetterSqlite3.Database, projectId: string, factId: string): void {
  const row = db.prepare('SELECT project_id FROM story_facts WHERE fact_id = ?').get(factId) as { project_id: string } | undefined
  if (!row || row.project_id !== projectId) throw new Error('资料不存在或不属于当前项目')
}

function insertVersion(
  db: BetterSqlite3.Database,
  fact: StoryFact,
  changedBy: string,
): StoryFactVersion {
  const versionId = randomUUID()
  const provenance = fact.provenance
  db.prepare(`
    INSERT INTO story_fact_versions (
      version_id, fact_id, project_id, version, summary, payload_json, status,
      changed_by, source_id, source_snapshot_id, source_fragment_id, source_file,
      source_heading_path, source_start_line, source_end_line, source_content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, fact.factId, fact.projectId, fact.revision, fact.summary,
    JSON.stringify(fact.payload), fact.status, changedBy,
    provenance.sourceId, provenance.sourceSnapshotId, provenance.sourceFragmentId, provenance.sourceFile,
    provenance.sourceHeadingPath, provenance.startLine, provenance.endLine, provenance.contentHash,
  )
  return versionFromRow(db.prepare('SELECT * FROM story_fact_versions WHERE version_id = ?').get(versionId) as Row)
}

export class StoryDomainRepository {
  /** 模型/提取管线唯一允许的写入口：只产生待审核候选，不写正式资料。 */
  static createCandidate(input: StoryFactCandidateInput): StoryFactCandidate {
    const db = requiredDb()
    const projectId = requiredProjectId(input.projectId)
    const canonicalName = requiredText(input.canonicalName, '资料名称', 200)
    const summary = input.summary.trim()
    if (summary.length > 2000) throw new Error('资料摘要无效')
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new Error('置信度必须在 0 到 1 之间')
    }
    const provenance = validateProvenance(input.provenance)
    assertProvenanceBelongsToProject(db, projectId, provenance)
    const payload = input.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('资料内容必须是对象')
    const candidateId = randomUUID()
    db.prepare(`
      INSERT INTO story_fact_candidates (
        candidate_id, project_id, entity_type, canonical_name, summary, payload_json,
        confidence, possible_conflicts_json, source_id, source_snapshot_id,
        source_fragment_id, source_file, source_heading_path, source_start_line,
        source_end_line, source_content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      candidateId, projectId, input.entityType, canonicalName, summary, JSON.stringify(payload),
      input.confidence, JSON.stringify(input.possibleConflicts ?? []), provenance.sourceId,
      provenance.sourceSnapshotId, provenance.sourceFragmentId, provenance.sourceFile,
      provenance.sourceHeadingPath, provenance.startLine, provenance.endLine, provenance.contentHash,
    )
    return candidateFromRow(db.prepare('SELECT * FROM story_fact_candidates WHERE candidate_id = ?').get(candidateId) as Row)
  }

  static listCandidates(projectId: string, entityType?: StoryEntityType): StoryFactCandidate[] {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    const rows = entityType
      ? db.prepare('SELECT * FROM story_fact_candidates WHERE project_id = ? AND entity_type = ? ORDER BY created_at, candidate_id').all(normalizedProject, entityType)
      : db.prepare('SELECT * FROM story_fact_candidates WHERE project_id = ? ORDER BY created_at, candidate_id').all(normalizedProject)
    return (rows as Row[]).map(candidateFromRow)
  }

  /** 作者确认候选后，原子地提交正式资料首个版本。 */
  static approveCandidate(projectId: string, candidateId: string, approvedBy: string): StoryFact {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    const actor = requiredText(approvedBy, '确认人', 200)
    const result = db.transaction(() => {
      const candidate = db.prepare(`
        SELECT * FROM story_fact_candidates
        WHERE candidate_id = ? AND project_id = ? AND review_status = 'pending'
      `).get(candidateId, normalizedProject) as Row | undefined
      if (!candidate) throw new Error('候选不存在、已处理或不属于当前项目')
      const provenance = provenanceFromRow(candidate)
      const existing = db.prepare(`
        SELECT * FROM story_facts
        WHERE project_id = ? AND entity_type = ? AND canonical_name = ?
      `).get(normalizedProject, candidate.entity_type, candidate.canonical_name) as Row | undefined
      let fact: StoryFact
      if (existing) {
        const revision = (existing.revision as number) + 1
        db.prepare(`
          UPDATE story_facts SET summary = ?, payload_json = ?, status = 'confirmed', confidence = ?,
            revision = ?, source_id = ?, source_snapshot_id = ?, source_fragment_id = ?, source_file = ?,
            source_heading_path = ?, source_start_line = ?, source_end_line = ?, source_content_hash = ?,
            confirmed_at = datetime('now'), confirmed_by = ?, updated_at = datetime('now')
          WHERE fact_id = ? AND project_id = ?
        `).run(
          candidate.summary, candidate.payload_json, candidate.confidence, revision,
          provenance.sourceId, provenance.sourceSnapshotId, provenance.sourceFragmentId, provenance.sourceFile,
          provenance.sourceHeadingPath, provenance.startLine, provenance.endLine, provenance.contentHash,
          actor, existing.fact_id, normalizedProject,
        )
        fact = factFromRow(db.prepare('SELECT * FROM story_facts WHERE fact_id = ? AND project_id = ?').get(existing.fact_id, normalizedProject) as Row)
      } else {
        const factId = randomUUID()
        db.prepare(`
          INSERT INTO story_facts (
            fact_id, project_id, entity_type, canonical_name, summary, payload_json, status, confidence,
            revision, source_id, source_snapshot_id, source_fragment_id, source_file, source_heading_path,
            source_start_line, source_end_line, source_content_hash, confirmed_at, confirmed_by
          ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).run(
          factId, normalizedProject, candidate.entity_type, candidate.canonical_name, candidate.summary,
          candidate.payload_json, candidate.confidence, provenance.sourceId, provenance.sourceSnapshotId,
          provenance.sourceFragmentId, provenance.sourceFile, provenance.sourceHeadingPath,
          provenance.startLine, provenance.endLine, provenance.contentHash, actor,
        )
        fact = factFromRow(db.prepare('SELECT * FROM story_facts WHERE fact_id = ? AND project_id = ?').get(factId, normalizedProject) as Row)
      }
      insertVersion(db, fact, actor)
      db.prepare(`
        UPDATE story_fact_candidates SET review_status = 'approved', actioned_at = datetime('now')
        WHERE candidate_id = ? AND project_id = ? AND review_status = 'pending'
      `).run(candidateId, normalizedProject)
      return fact
    })()
    return result
  }

  static rejectCandidate(projectId: string, candidateId: string): void {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    const result = db.prepare(`
      UPDATE story_fact_candidates SET review_status = 'rejected', actioned_at = datetime('now')
      WHERE candidate_id = ? AND project_id = ? AND review_status = 'pending'
    `).run(candidateId, normalizedProject)
    if (result.changes !== 1) throw new Error('候选不存在、已处理或不属于当前项目')
  }

  static listFacts(projectId: string, status?: StoryRecordStatus, entityType?: StoryEntityType): StoryFact[] {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    const clauses = ['project_id = ?']
    const params: Array<string> = [normalizedProject]
    if (status) { clauses.push('status = ?'); params.push(status) }
    if (entityType) { clauses.push('entity_type = ?'); params.push(entityType) }
    const rows = db.prepare(`SELECT * FROM story_facts WHERE ${clauses.join(' AND ')} ORDER BY entity_type, canonical_name`).all(...params)
    return (rows as Row[]).map(factFromRow)
  }

  static getFact(projectId: string, factId: string): StoryFact | null {
    const db = requiredDb()
    const row = db.prepare('SELECT * FROM story_facts WHERE fact_id = ? AND project_id = ?')
      .get(factId, requiredProjectId(projectId)) as Row | undefined
    return row ? factFromRow(row) : null
  }

  /** 作者已有资料的版本提交；模型不得调用此方法。 */
  static commitFactVersion(input: {
    projectId: string
    factId: string
    summary: string
    payload: Record<string, unknown>
    status: StoryRecordStatus
    confidence: number
    provenance: StoryProvenance
    changedBy: string
  }): StoryFactVersion {
    const db = requiredDb()
    const projectId = requiredProjectId(input.projectId)
    const actor = requiredText(input.changedBy, '修改人', 200)
    const provenance = validateProvenance(input.provenance)
    assertProvenanceBelongsToProject(db, projectId, provenance)
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('置信度无效')
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('资料内容必须是对象')
    return db.transaction(() => {
      const existing = db.prepare('SELECT * FROM story_facts WHERE fact_id = ? AND project_id = ?').get(input.factId, projectId) as Row | undefined
      if (!existing) throw new Error('资料不存在或不属于当前项目')
      const revision = (existing.revision as number) + 1
      db.prepare(`
        UPDATE story_facts SET summary = ?, payload_json = ?, status = ?, confidence = ?, revision = ?,
          source_id = ?, source_snapshot_id = ?, source_fragment_id = ?, source_file = ?, source_heading_path = ?,
          source_start_line = ?, source_end_line = ?, source_content_hash = ?, updated_at = datetime('now'),
          confirmed_at = CASE WHEN ? = 'confirmed' THEN datetime('now') ELSE confirmed_at END,
          confirmed_by = CASE WHEN ? = 'confirmed' THEN ? ELSE confirmed_by END
        WHERE fact_id = ? AND project_id = ?
      `).run(
        input.summary.trim(), JSON.stringify(input.payload), input.status, input.confidence, revision,
        provenance.sourceId, provenance.sourceSnapshotId, provenance.sourceFragmentId, provenance.sourceFile,
        provenance.sourceHeadingPath, provenance.startLine, provenance.endLine, provenance.contentHash,
        input.status, input.status, actor, input.factId, projectId,
      )
      const fact = factFromRow(db.prepare('SELECT * FROM story_facts WHERE fact_id = ? AND project_id = ?').get(input.factId, projectId) as Row)
      return insertVersion(db, fact, actor)
    })()
  }

  static listVersions(projectId: string, factId: string): StoryFactVersion[] {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    assertFactProject(db, normalizedProject, factId)
    return (db.prepare(`SELECT * FROM story_fact_versions WHERE fact_id = ? AND project_id = ? ORDER BY version`).all(factId, normalizedProject) as Row[]).map(versionFromRow)
  }

  static addRelation(input: StoryFactRelationInput): StoryFactRelation {
    const db = requiredDb()
    const projectId = requiredProjectId(input.projectId)
    const relationType = requiredText(input.relationType, '关系类型', 100)
    const provenance = validateProvenance(input.provenance)
    assertFactProject(db, projectId, input.fromFactId)
    assertFactProject(db, projectId, input.toFactId)
    assertProvenanceBelongsToProject(db, projectId, provenance)
    const relationId = randomUUID()
    db.prepare(`
      INSERT INTO story_fact_relations (
        relation_id, project_id, from_fact_id, to_fact_id, relation_type, status,
        source_id, source_snapshot_id, source_fragment_id, source_file, source_heading_path,
        source_start_line, source_end_line, source_content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relationId, projectId, input.fromFactId, input.toFactId, relationType, input.status ?? 'confirmed',
      provenance.sourceId, provenance.sourceSnapshotId, provenance.sourceFragmentId, provenance.sourceFile,
      provenance.sourceHeadingPath, provenance.startLine, provenance.endLine, provenance.contentHash,
    )
    const row = db.prepare('SELECT * FROM story_fact_relations WHERE relation_id = ? AND project_id = ?').get(relationId, projectId) as Row
    return {
      relationId,
      projectId,
      fromFactId: row.from_fact_id as string,
      toFactId: row.to_fact_id as string,
      relationType: row.relation_type as string,
      status: row.status as StoryRecordStatus,
      provenance: provenanceFromRow(row),
      createdAt: row.created_at as string,
    }
  }

  static listRelations(projectId: string, factId?: string): StoryFactRelation[] {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    const rows = factId
      ? db.prepare('SELECT * FROM story_fact_relations WHERE project_id = ? AND (from_fact_id = ? OR to_fact_id = ?) ORDER BY created_at, relation_id').all(normalizedProject, factId, factId)
      : db.prepare('SELECT * FROM story_fact_relations WHERE project_id = ? ORDER BY created_at, relation_id').all(normalizedProject)
    return (rows as Row[]).map(row => ({
      relationId: row.relation_id as string,
      projectId: row.project_id as string,
      fromFactId: row.from_fact_id as string,
      toFactId: row.to_fact_id as string,
      relationType: row.relation_type as string,
      status: row.status as StoryRecordStatus,
      provenance: provenanceFromRow(row),
      createdAt: row.created_at as string,
    }))
  }

  static addImpact(input: StoryFactImpactInput): StoryFactImpact {
    const db = requiredDb()
    const projectId = requiredProjectId(input.projectId)
    if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) throw new Error('章节号无效')
    assertFactProject(db, projectId, input.factId)
    const impactId = randomUUID()
    db.prepare(`
      INSERT INTO story_fact_impacts (impact_id, project_id, fact_id, chapter_number, impact_type, narrative_line)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(impactId, projectId, input.factId, input.chapterNumber, input.impactType, input.narrativeLine?.trim() ?? '')
    const row = db.prepare('SELECT * FROM story_fact_impacts WHERE impact_id = ? AND project_id = ?').get(impactId, projectId) as Row
    return {
      impactId,
      projectId,
      factId: row.fact_id as string,
      chapterNumber: row.chapter_number as number,
      impactType: row.impact_type as StoryFactImpact['impactType'],
      narrativeLine: row.narrative_line as string,
      createdAt: row.created_at as string,
    }
  }

  static listImpacts(projectId: string, factId?: string): StoryFactImpact[] {
    const db = requiredDb()
    const normalizedProject = requiredProjectId(projectId)
    const rows = factId
      ? db.prepare('SELECT * FROM story_fact_impacts WHERE project_id = ? AND fact_id = ? ORDER BY chapter_number, impact_id').all(normalizedProject, factId)
      : db.prepare('SELECT * FROM story_fact_impacts WHERE project_id = ? ORDER BY chapter_number, impact_id').all(normalizedProject)
    return (rows as Row[]).map(row => ({
      impactId: row.impact_id as string,
      projectId: row.project_id as string,
      factId: row.fact_id as string,
      chapterNumber: row.chapter_number as number,
      impactType: row.impact_type as StoryFactImpact['impactType'],
      narrativeLine: row.narrative_line as string,
      createdAt: row.created_at as string,
    }))
  }
}
