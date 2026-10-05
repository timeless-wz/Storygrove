import { createHash, randomUUID } from 'node:crypto'
import {
  buildRevisionLearningSkillMarkdown,
  REVISION_LEARNING_PROMPT_VERSION,
  REVISION_LEARNING_SCHEMA_VERSION,
  REVISION_LEARNING_MAX_TEXT_CHARS,
  type RevisionLearningAttempt,
  type RevisionLearningAttemptStatus,
  type RevisionLearningChange,
  type RevisionLearningPublishReceipt,
  type RevisionLearningRecord,
  type RevisionLearningRecordSummary,
  type RevisionLearningResult,
  type RevisionLearningReviewDraft,
  type RevisionLearningReviewRule,
  type RevisionLearningSnapshot,
} from '../../src/shared/revision-learning'
import { computeRevisionLearningDiff } from '../../src/shared/revision-learning-diff'
import { getProjectDb } from '../database'
import { ProjectCoreRepository } from './project-core-repository'

type ProjectDatabase = NonNullable<ReturnType<typeof getProjectDb>>

interface RecordRow {
  id: string
  project_id: string
  schema_version: number
  revision: number
  input_revision: number
  input_hash: string
  before_snapshot_json: string
  after_snapshot_json: string | null
  changes_json: string
  overall_reason: string
  review_json: string | null
  active_attempt_id: string | null
  created_at: string
  updated_at: string
}

interface AttemptRow {
  id: string
  record_id: string
  input_revision: number
  input_hash: string
  prompt_version: string
  model_id: string | null
  status: RevisionLearningAttemptStatus
  error_summary: string | null
  result_json: string | null
  generation_receipt_json: string | null
  created_at: string
  completed_at: string | null
}

interface PublishRow {
  idempotency_key: string
  record_id: string
  skill_id: string
  relative_path: string
  content_hash: string
  review_revision: number
  status: 'prepared' | 'published'
  published_at: string | null
  created_at: string
  updated_at: string
}

function requireDb(): ProjectDatabase {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function parseJson<T>(value: string | null, label: string): T | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`${label}记录损坏，已拒绝覆盖`)
  }
}

function hashInput(
  before: RevisionLearningSnapshot,
  after: RevisionLearningSnapshot | null,
  changes: readonly RevisionLearningChange[],
  overallReason: string,
): string {
  return sha256(JSON.stringify({
    before,
    after,
    changes: changes.map(change => ({
      id: change.id,
      kind: change.kind,
      beforeStartParagraph: change.beforeStartParagraph,
      afterStartParagraph: change.afterStartParagraph,
      beforeEndParagraph: change.beforeEndParagraph,
      afterEndParagraph: change.afterEndParagraph,
      beforeText: change.beforeText,
      afterText: change.afterText,
      coarse: change.coarse,
      included: change.included,
      authorReason: change.authorReason,
    })),
    overallReason,
  }))
}

function mapAttempt(row: AttemptRow): RevisionLearningAttempt {
  return {
    id: row.id,
    inputRevision: row.input_revision,
    inputHash: row.input_hash,
    promptVersion: row.prompt_version,
    modelId: row.model_id,
    status: row.status,
    errorSummary: row.error_summary,
    result: parseJson<RevisionLearningResult>(row.result_json, '修订学习分析结果'),
    generationReceipt: parseJson<unknown>(row.generation_receipt_json, '修订学习生成回执'),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

function mapPublish(row: PublishRow): RevisionLearningPublishReceipt {
  if (row.status !== 'published' || !row.published_at) {
    throw new Error('项目技能尚未完成发布回执')
  }
  return {
    idempotencyKey: row.idempotency_key,
    skillId: row.skill_id,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    publishedAt: row.published_at,
  }
}

function summarizeSnapshot(snapshot: RevisionLearningSnapshot): Omit<RevisionLearningSnapshot, 'content'> {
  const summary = { ...snapshot }
  Reflect.deleteProperty(summary, 'content')
  return summary
}

function toSummary(row: RecordRow, attempts: RevisionLearningAttempt[], publishes: PublishRow[]): RevisionLearningRecordSummary {
  const before = parseJson<RevisionLearningSnapshot>(row.before_snapshot_json, '修订学习前稿')
  if (!before) throw new Error('修订学习前稿缺失')
  const after = parseJson<RevisionLearningSnapshot>(row.after_snapshot_json, '修订学习后稿')
  const latestAttempt = attempts[0]
  return {
    id: row.id,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    revision: row.revision,
    inputRevision: row.input_revision,
    inputHash: row.input_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    beforeSnapshot: summarizeSnapshot(before),
    afterSnapshot: after ? summarizeSnapshot(after) : null,
    changeCount: (parseJson<RevisionLearningChange[]>(row.changes_json, '修订学习差异') ?? []).length,
    latestAttempt: latestAttempt
      ? { id: latestAttempt.id, status: latestAttempt.status, createdAt: latestAttempt.createdAt, completedAt: latestAttempt.completedAt }
      : null,
    publishCount: publishes.filter(item => item.status === 'published').length,
  }
}

function getRecordRow(db: ProjectDatabase, recordId: string): RecordRow {
  const row = db.prepare('SELECT * FROM revision_learning_records WHERE id = ?').get(recordId) as RecordRow | undefined
  if (!row) throw new Error('找不到修订学习记录')
  return row
}

function requireExpectedRevision(row: RecordRow, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || row.revision !== expectedRevision) {
    throw new Error(`修订学习记录已在其他面板修改（当前版本 ${row.revision}），请重新加载后再编辑`)
  }
}

function attemptsFor(db: ProjectDatabase, recordId: string, limit = 50): RevisionLearningAttempt[] {
  const rows = db.prepare(`
    SELECT * FROM revision_learning_attempts
    WHERE record_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(recordId, limit) as AttemptRow[]
  return rows.map(mapAttempt)
}

function publishesFor(db: ProjectDatabase, recordId: string): PublishRow[] {
  return db.prepare(`
    SELECT * FROM revision_learning_publish_ops
    WHERE record_id = ? ORDER BY created_at DESC, idempotency_key DESC
  `).all(recordId) as PublishRow[]
}

function toRecord(db: ProjectDatabase, row: RecordRow): RevisionLearningRecord {
  const before = parseJson<RevisionLearningSnapshot>(row.before_snapshot_json, '修订学习前稿')
  if (!before) throw new Error('修订学习前稿缺失')
  const after = parseJson<RevisionLearningSnapshot>(row.after_snapshot_json, '修订学习后稿')
  const changes = parseJson<RevisionLearningChange[]>(row.changes_json, '修订学习差异') ?? []
  const attempts = attemptsFor(db, row.id)
  const publishes = publishesFor(db, row.id)
  return {
    ...toSummary(row, attempts, publishes),
    beforeSnapshot: before,
    afterSnapshot: after,
    changes,
    overallReason: row.overall_reason,
    attempts,
    review: parseJson<RevisionLearningReviewDraft>(row.review_json, '修订学习审阅草稿'),
    publishReceipts: publishes.filter(item => item.status === 'published').map(mapPublish),
  }
}

function validateSnapshot(snapshot: RevisionLearningSnapshot): void {
  if (
    !snapshot
    || !Number.isSafeInteger(snapshot.draftId)
    || snapshot.draftId < 1
    || !Number.isSafeInteger(snapshot.chapterNumber)
    || snapshot.chapterNumber < 1
    || !/^chapter:[1-9]\d*$/u.test(snapshot.logicalChapterIdentity)
    || !/^[a-f0-9]{64}$/u.test(snapshot.contentHash)
    || typeof snapshot.content !== 'string'
    || snapshot.content.length > REVISION_LEARNING_MAX_TEXT_CHARS
    || typeof snapshot.title !== 'string'
    || snapshot.title.length > 300
    || typeof snapshot.status !== 'string'
    || snapshot.status.length > 80
    || !Number.isSafeInteger(snapshot.version)
    || snapshot.version < 1
    || snapshot.logicalChapterIdentity !== `chapter:${snapshot.chapterNumber}`
    || sha256(snapshot.content) !== snapshot.contentHash
    || !['saved-draft', 'editor-snapshot'].includes(snapshot.sourceKind)
  ) throw new Error('修订学习样本来源无效')
  if (snapshot.sourceKind === 'editor-snapshot') {
    if (
      typeof snapshot.tabId !== 'string'
      || snapshot.tabId.length === 0
      || snapshot.tabId.length > 300
      || !Number.isSafeInteger(snapshot.editGeneration)
      || (snapshot.editGeneration as number) < 0
    ) throw new Error('编辑器快照缺少来源标签或编辑代次')
  }
}

function reviewRulesForSave(
  result: RevisionLearningResult,
  rules: readonly RevisionLearningReviewRule[],
): RevisionLearningReviewRule[] {
  if (!Array.isArray(rules) || rules.length !== result.rules.length || rules.length > 24) {
    throw new Error('审阅规则与当前分析结果不匹配')
  }
  const byId = new Map(result.rules.map(rule => [rule.id, rule]))
  const seen = new Set<string>()
  return rules.map((draft) => {
    const source = byId.get(draft.id)
    if (!source || seen.has(draft.id) || typeof draft.selected !== 'boolean') {
      throw new Error('审阅草稿含有未知或重复候选规则')
    }
    seen.add(draft.id)
    if (
      JSON.stringify(draft.evidenceChangeIds) !== JSON.stringify(source.evidenceChangeIds)
      || draft.reasonSource !== source.reasonSource
    ) throw new Error('候选规则的证据身份不能在审阅时更改')
    const textField = (value: unknown, max: number, label: string) => {
      if (typeof value !== 'string' || value.length > max) throw new Error(`${label}超过长度限制`)
      return value.trim()
    }
    return {
      ...source,
      title: textField(draft.title, 100, '规则标题'),
      guidance: textField(draft.guidance, 2_500, '规则正文'),
      appliesWhen: textField(draft.appliesWhen, 800, '适用场景'),
      exceptions: textField(draft.exceptions, 1_000, '规则例外'),
      limitations: textField(draft.limitations, 1_000, '规则边界'),
      selected: draft.selected,
    }
  })
}

export class RevisionLearningRepository {
  static createRecord(projectId: string, before: RevisionLearningSnapshot, after: RevisionLearningSnapshot | null): RevisionLearningRecord {
    validateSnapshot(before)
    if (after) validateSnapshot(after)
    if (after && (
      (before.sourceKind === 'editor-snapshot' && after.draftId !== before.draftId)
      || after.logicalChapterIdentity !== before.logicalChapterIdentity
      || after.sourceKind !== before.sourceKind
      || (before.sourceKind === 'editor-snapshot' && after.tabId !== before.tabId)
    )) throw new Error('修订学习样本必须来自同一逻辑正文和来源标签')
    const changes = after ? computeRevisionLearningDiff(before.content, after.content) : []
    const createdAt = new Date().toISOString()
    const id = randomUUID().replace(/-/g, '')
    const inputHash = hashInput(before, after, changes, '')
    const db = requireDb()
    db.prepare(`
      INSERT INTO revision_learning_records (
        id, project_id, schema_version, revision, input_revision, input_hash,
        before_snapshot_json, after_snapshot_json, changes_json, overall_reason,
        review_json, active_attempt_id, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, '', NULL, NULL, ?, ?)
    `).run(
      id,
      projectId,
      REVISION_LEARNING_SCHEMA_VERSION,
      inputHash,
      JSON.stringify(before),
      after ? JSON.stringify(after) : null,
      JSON.stringify(changes),
      createdAt,
      createdAt,
    )
    return this.getRecord(id)
  }

  static getRecord(recordId: string): RevisionLearningRecord {
    const db = requireDb()
    return toRecord(db, getRecordRow(db, recordId))
  }

  static listRecords(): RevisionLearningRecordSummary[] {
    const db = requireDb()
    const rows = db.prepare('SELECT * FROM revision_learning_records ORDER BY updated_at DESC, id DESC LIMIT 200').all() as RecordRow[]
    return rows.map(row => toSummary(row, attemptsFor(db, row.id, 1), publishesFor(db, row.id)))
  }

  static captureAfter(
    recordId: string,
    expectedRevision: number,
    after: RevisionLearningSnapshot,
  ): RevisionLearningRecord {
    validateSnapshot(after)
    const db = requireDb()
    const row = getRecordRow(db, recordId)
    requireExpectedRevision(row, expectedRevision)
    const before = parseJson<RevisionLearningSnapshot>(row.before_snapshot_json, '修订学习前稿')
    if (!before) throw new Error('修订学习前稿缺失')
    if (
      (before.sourceKind === 'editor-snapshot' && before.draftId !== after.draftId)
      || before.logicalChapterIdentity !== after.logicalChapterIdentity
      || before.sourceKind !== after.sourceKind
      || (before.sourceKind === 'editor-snapshot' && before.tabId !== after.tabId)
      || (before.sourceKind === 'editor-snapshot' && (after.editGeneration ?? -1) < (before.editGeneration ?? 0))
    ) throw new Error('修改后快照不属于记录的同一正文和编辑器标签')
    const previous = parseJson<RevisionLearningChange[]>(row.changes_json, '修订学习差异') ?? []
    const changes = computeRevisionLearningDiff(before.content, after.content, previous)
    this.updateInputRow(db, row, before, after, changes, row.overall_reason, expectedRevision)
    return this.getRecord(recordId)
  }

  static reverseSample(recordId: string, expectedRevision: number): RevisionLearningRecord {
    const db = requireDb()
    const row = getRecordRow(db, recordId)
    requireExpectedRevision(row, expectedRevision)
    const before = parseJson<RevisionLearningSnapshot>(row.before_snapshot_json, '修订学习前稿')
    const after = parseJson<RevisionLearningSnapshot>(row.after_snapshot_json, '修订学习后稿')
    if (!before || !after) throw new Error('需要前后两个样本才能交换方向')
    const changes = computeRevisionLearningDiff(after.content, before.content)
    this.updateInputRow(db, row, after, before, changes, row.overall_reason, expectedRevision)
    return this.getRecord(recordId)
  }

  static updateInput(
    recordId: string,
    expectedRevision: number,
    changes: ReadonlyArray<Pick<RevisionLearningChange, 'id' | 'included' | 'authorReason'>>,
    overallReason: string,
  ): RevisionLearningRecord {
    if (typeof overallReason !== 'string' || overallReason.length > 4_000) throw new Error('整体修改目标超过长度限制')
    if (!Array.isArray(changes) || changes.length > 4_000) throw new Error('差异设置数量无效')
    const db = requireDb()
    const row = getRecordRow(db, recordId)
    requireExpectedRevision(row, expectedRevision)
    const before = parseJson<RevisionLearningSnapshot>(row.before_snapshot_json, '修订学习前稿')
    const after = parseJson<RevisionLearningSnapshot>(row.after_snapshot_json, '修订学习后稿')
    if (!before || !after) throw new Error('需要先采集修改后样本')
    const original = parseJson<RevisionLearningChange[]>(row.changes_json, '修订学习差异') ?? []
    if (changes.length !== original.length) throw new Error('差异证据列表与当前样本不匹配')
    const incoming = new Map(changes.map(change => [change.id, change]))
    if (incoming.size !== original.length) throw new Error('差异证据存在未知或重复 ID')
    const next = original.map(change => {
      const edited = incoming.get(change.id)
      if (!edited || typeof edited.included !== 'boolean' || typeof edited.authorReason !== 'string'
        || edited.authorReason.length > 2_000) throw new Error('差异范围或理由无效')
      return { ...change, included: edited.included, authorReason: edited.authorReason.trim() }
    })
    this.updateInputRow(db, row, before, after, next, overallReason.trim(), expectedRevision)
    return this.getRecord(recordId)
  }

  private static updateInputRow(
    db: ProjectDatabase,
    row: RecordRow,
    before: RevisionLearningSnapshot,
    after: RevisionLearningSnapshot,
    changes: RevisionLearningChange[],
    overallReason: string,
    expectedRevision: number,
  ): void {
    const nextHash = hashInput(before, after, changes, overallReason)
    const inputChanged = nextHash !== row.input_hash
    const nextInputRevision = row.input_revision + (inputChanged ? 1 : 0)
    const operation = db.transaction(() => {
      if (inputChanged && row.active_attempt_id) {
        const completedAt = new Date().toISOString()
        db.prepare(`
          UPDATE revision_learning_attempts
          SET status = 'interrupted', error_summary = '样本在分析期间发生变化', completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(completedAt, row.active_attempt_id)
      }
      const result = db.prepare(`
        UPDATE revision_learning_records
        SET before_snapshot_json = ?, after_snapshot_json = ?, changes_json = ?, overall_reason = ?,
            input_hash = ?, input_revision = ?, active_attempt_id = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?
      `).run(
        JSON.stringify(before),
        JSON.stringify(after),
        JSON.stringify(changes),
        overallReason,
        nextHash,
        nextInputRevision,
        inputChanged ? null : row.active_attempt_id,
        new Date().toISOString(),
        row.id,
        expectedRevision,
      )
      if (result.changes !== 1) throw new Error('修订学习记录已被其他面板修改，请重新加载')
    })
    operation()
  }

  static beginAttempt(
    recordId: string,
    expectedInputRevision: number,
    expectedInputHash: string,
    modelId: string | null,
  ): RevisionLearningAttempt {
    if (!/^[a-f0-9]{64}$/u.test(expectedInputHash)) throw new Error('修订学习输入身份无效')
    const db = requireDb()
    const operation = db.transaction(() => {
      const row = getRecordRow(db, recordId)
      if (row.input_revision !== expectedInputRevision || row.input_hash !== expectedInputHash) {
        throw new Error('样本已变化，请重新加载后再分析')
      }
      const changes = parseJson<RevisionLearningChange[]>(row.changes_json, '修订学习差异') ?? []
      if (!parseJson<RevisionLearningSnapshot>(row.after_snapshot_json, '修订学习后稿')) {
        throw new Error('请先记录修改后文本')
      }
      if (changes.length === 0 || !changes.some(change => change.included)) throw new Error('请至少纳入一项真实差异后再分析')
      if (row.active_attempt_id) {
        const active = db.prepare('SELECT status FROM revision_learning_attempts WHERE id = ?').get(row.active_attempt_id) as { status?: string } | undefined
        if (active?.status === 'running') throw new Error('该记录已有分析正在运行')
      }
      const id = randomUUID().replace(/-/g, '')
      const createdAt = new Date().toISOString()
      db.prepare(`
        INSERT INTO revision_learning_attempts (
          id, record_id, input_revision, input_hash, prompt_version, model_id,
          status, error_summary, result_json, generation_receipt_json, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', NULL, NULL, NULL, ?, NULL)
      `).run(id, recordId, row.input_revision, row.input_hash, REVISION_LEARNING_PROMPT_VERSION, modelId, createdAt)
      db.prepare('UPDATE revision_learning_records SET active_attempt_id = ? WHERE id = ?')
        .run(id, recordId)
      return {
        id,
        inputRevision: row.input_revision,
        inputHash: row.input_hash,
        promptVersion: REVISION_LEARNING_PROMPT_VERSION,
        modelId,
        status: 'running' as const,
        errorSummary: null,
        result: null,
        generationReceipt: null,
        createdAt,
        completedAt: null,
      }
    })
    return operation()
  }

  static finishAttempt(
    recordId: string,
    attemptId: string,
    outcome: {
      status: 'completed' | 'failed' | 'cancelled'
      result?: RevisionLearningResult
      generationReceipt?: unknown
      errorSummary?: string | null
    },
  ): RevisionLearningAttempt {
    const db = requireDb()
    const operation = db.transaction(() => {
      const attempt = db.prepare('SELECT * FROM revision_learning_attempts WHERE id = ? AND record_id = ?')
        .get(attemptId, recordId) as AttemptRow | undefined
      if (!attempt) throw new Error('找不到对应的修订学习分析 attempt')
      if (attempt.status !== 'running') return mapAttempt(attempt)
      const record = getRecordRow(db, recordId)
      const active = record.active_attempt_id === attemptId
      const inputCurrent = record.input_revision === attempt.input_revision && record.input_hash === attempt.input_hash
      const status: RevisionLearningAttemptStatus = active && inputCurrent ? outcome.status : 'interrupted'
      const resultJson = status === 'completed' && outcome.result ? JSON.stringify(outcome.result) : null
      const completedAt = new Date().toISOString()
      const errorSummary = status === 'completed'
        ? null
        : (outcome.errorSummary || (status === 'interrupted' ? '分析结果已过期或被更新的 attempt 取代' : null))?.slice(0, 1_000) ?? null
      db.prepare(`
        UPDATE revision_learning_attempts
        SET status = ?, error_summary = ?, result_json = ?, generation_receipt_json = ?, completed_at = ?
        WHERE id = ? AND status = 'running'
      `).run(
        status,
        errorSummary,
        resultJson,
        outcome.generationReceipt === undefined ? null : JSON.stringify(outcome.generationReceipt),
        completedAt,
        attemptId,
      )
      if (active) {
        db.prepare('UPDATE revision_learning_records SET active_attempt_id = NULL WHERE id = ? AND active_attempt_id = ?')
          .run(recordId, attemptId)
      }
      const updated = db.prepare('SELECT * FROM revision_learning_attempts WHERE id = ?').get(attemptId) as AttemptRow
      return mapAttempt(updated)
    })
    return operation()
  }

  static saveReview(
    recordId: string,
    expectedRevision: number,
    input: {
      resultAttemptId: string
      resultInputHash: string
      rules: readonly RevisionLearningReviewRule[]
      skillDisplayName: string
      skillDescription: string
    },
  ): RevisionLearningRecord {
    if (input.skillDisplayName.trim().length > 80 || !input.skillDisplayName.trim()) throw new Error('技能名称无效')
    if (input.skillDescription.trim().length > 280 || !input.skillDescription.trim()) throw new Error('技能简介无效')
    const db = requireDb()
    const row = getRecordRow(db, recordId)
    requireExpectedRevision(row, expectedRevision)
    if (row.input_hash !== input.resultInputHash) throw new Error('分析结果已过期，不能继续确认技能')
    const attempt = db.prepare(`
      SELECT * FROM revision_learning_attempts
      WHERE id = ? AND record_id = ? AND status = 'completed'
    `).get(input.resultAttemptId, recordId) as AttemptRow | undefined
    if (!attempt || attempt.input_hash !== row.input_hash || attempt.input_revision !== row.input_revision) {
      throw new Error('分析结果不属于当前样本版本')
    }
    const result = parseJson<RevisionLearningResult>(attempt.result_json, '修订学习分析结果')
    if (!result) throw new Error('当前分析结果缺失')
    const rules = reviewRulesForSave(result, input.rules)
    const previous = parseJson<RevisionLearningReviewDraft>(row.review_json, '修订学习审阅草稿')
    const candidate = {
      resultAttemptId: input.resultAttemptId,
      resultInputHash: input.resultInputHash,
      rules,
      skillDisplayName: input.skillDisplayName.trim(),
      skillDescription: input.skillDescription.trim(),
    }
    const previousEditable = previous ? {
      resultAttemptId: previous.resultAttemptId,
      resultInputHash: previous.resultInputHash,
      rules: previous.rules,
      skillDisplayName: previous.skillDisplayName,
      skillDescription: previous.skillDescription,
    } : null
    const unchanged = Boolean(previousEditable && JSON.stringify(previousEditable) === JSON.stringify(candidate))
    const review: RevisionLearningReviewDraft = {
      ...candidate,
      skillDraftRevision: unchanged && previous
        ? previous.skillDraftRevision
        : previous?.resultAttemptId === input.resultAttemptId ? previous.skillDraftRevision + 1 : 1,
      skillContentHash: unchanged && previous ? previous.skillContentHash : null,
      confirmedAt: unchanged && previous ? previous.confirmedAt : null,
    }
    const updatedAt = new Date().toISOString()
    const update = db.prepare(`
      UPDATE revision_learning_records
      SET review_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(JSON.stringify(review), updatedAt, recordId, expectedRevision)
    if (update.changes !== 1) throw new Error('修订学习记录已被其他面板修改，请重新加载')
    return this.getRecord(recordId)
  }

  static confirmReview(
    recordId: string,
    expectedRevision: number,
    expectedContentHash: string,
    writingLanguage: 'zh-CN' | 'en-US',
  ): { record: RevisionLearningRecord; review: RevisionLearningReviewDraft } {
    const db = requireDb()
    const row = getRecordRow(db, recordId)
    requireExpectedRevision(row, expectedRevision)
    if (row.active_attempt_id) throw new Error('分析尚未结束，暂不能保存技能')
    if (!/^[a-f0-9]{64}$/u.test(expectedContentHash)) throw new Error('技能预览校验值无效')
    const review = parseJson<RevisionLearningReviewDraft>(row.review_json, '修订学习审阅草稿')
    if (!review || !review.rules.some(rule => rule.selected)) throw new Error('请至少选择一条候选规则')
    if (review.resultInputHash !== row.input_hash) throw new Error('分析结果已过期，不能保存技能')
    const projectLanguage = ProjectCoreRepository.get()?.writingLanguage ?? 'zh-CN'
    if (writingLanguage !== projectLanguage) throw new Error('项目写作语言已变化，请刷新技能预览后再保存')
    const markdown = buildSkillMarkdown(recordId, review, projectLanguage)
    const actualHash = sha256(markdown)
    if (actualHash !== expectedContentHash) throw new Error('技能预览与已保存的规则不一致，请重新确认预览')
    const confirmedReview: RevisionLearningReviewDraft = {
      ...review,
      skillContentHash: actualHash,
      confirmedAt: new Date().toISOString(),
      confirmedWritingLanguage: projectLanguage,
    }
    const update = db.prepare(`
      UPDATE revision_learning_records
      SET review_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(JSON.stringify(confirmedReview), new Date().toISOString(), recordId, expectedRevision)
    if (update.changes !== 1) throw new Error('修订学习记录已被其他面板修改，请重新加载')
    return { record: this.getRecord(recordId), review: confirmedReview }
  }

  static preparePublish(recordId: string, expectedRevision: number, expectedContentHash: string): PublishRow {
    const db = requireDb()
    const operation = db.transaction(() => {
      const row = getRecordRow(db, recordId)
      requireExpectedRevision(row, expectedRevision)
      const review = parseJson<RevisionLearningReviewDraft>(row.review_json, '修订学习审阅草稿')
      if (
        !review
        || !review.confirmedAt
        || !review.skillContentHash
        || review.skillContentHash !== expectedContentHash
        || review.resultInputHash !== row.input_hash
      ) throw new Error('技能草稿尚未按当前预览确认，不能发布')
      const idempotencyKey = `${recordId}:${review.skillDraftRevision}:${review.skillContentHash}`
      const previous = db.prepare('SELECT * FROM revision_learning_publish_ops WHERE idempotency_key = ?')
        .get(idempotencyKey) as PublishRow | undefined
      if (previous) return previous
      const skillName = requireSkillName(recordId, review.skillDraftRevision)
      const now = new Date().toISOString()
      db.prepare(`
        INSERT INTO revision_learning_publish_ops (
          idempotency_key, record_id, skill_id, relative_path, content_hash,
          review_revision, status, published_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'prepared', NULL, ?, ?)
      `).run(
        idempotencyKey,
        recordId,
        `project:${skillName}`,
        `.vela/skills/${skillName}/SKILL.md`,
        review.skillContentHash,
        review.skillDraftRevision,
        now,
        now,
      )
      return db.prepare('SELECT * FROM revision_learning_publish_ops WHERE idempotency_key = ?')
        .get(idempotencyKey) as PublishRow
    })
    return operation()
  }

  static getPublishOperation(idempotencyKey: string): PublishRow | null {
    return requireDb().prepare('SELECT * FROM revision_learning_publish_ops WHERE idempotency_key = ?')
      .get(idempotencyKey) as PublishRow | null
  }

  static markPublished(idempotencyKey: string, contentHash: string): RevisionLearningPublishReceipt {
    const db = requireDb()
    const row = db.prepare('SELECT * FROM revision_learning_publish_ops WHERE idempotency_key = ?')
      .get(idempotencyKey) as PublishRow | undefined
    if (!row || row.content_hash !== contentHash) throw new Error('技能发布恢复回执与内容哈希不一致')
    if (row.status === 'published' && row.published_at) return mapPublish(row)
    const publishedAt = new Date().toISOString()
    db.prepare(`
      UPDATE revision_learning_publish_ops SET status = 'published', published_at = ?, updated_at = ?
      WHERE idempotency_key = ? AND content_hash = ?
    `).run(publishedAt, publishedAt, idempotencyKey, contentHash)
    const updated = this.getPublishOperation(idempotencyKey)
    if (!updated) throw new Error('技能发布回执丢失')
    return mapPublish(updated)
  }

  static getPublishOperations(recordId: string): Array<PublishRow & { receipt: RevisionLearningPublishReceipt | null }> {
    return publishesFor(requireDb(), recordId).map(row => ({
      ...row,
      receipt: row.status === 'published' ? mapPublish(row) : null,
    }))
  }
}

function requireSkillName(recordId: string, revision: number): string {
  return `revision-${recordId.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 24)}-r${revision.toString(36)}`
}

function buildSkillMarkdown(
  recordId: string,
  review: RevisionLearningReviewDraft,
  language: 'zh-CN' | 'en-US',
): string {
  // Importing a shared deterministic builder avoids trusting renderer/model file content.
  return buildRevisionLearningSkillMarkdown(recordId, review, language)
}
