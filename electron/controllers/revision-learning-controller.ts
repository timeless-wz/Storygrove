import { createHash } from 'node:crypto'
import { ipcMain } from 'electron'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import {
  REVISION_LEARNING_MAX_TEXT_CHARS,
  buildRevisionLearningSkillMarkdown,
  parseRevisionLearningResult,
  type RevisionLearningAfterSnapshotInput,
  type RevisionLearningAttemptFinishInput,
  type RevisionLearningAttemptStartInput,
  type RevisionLearningBindingCasInput,
  type RevisionLearningBindInput,
  type RevisionLearningCreateFromVersionsInput,
  type RevisionLearningEditorSnapshotInput,
  type RevisionLearningPublishInput,
  type RevisionLearningReviewConfirmInput,
  type RevisionLearningReviewSaveInput,
  type RevisionLearningSaveInput,
  type RevisionLearningSnapshot,
} from '../../src/shared/revision-learning'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import { DraftRepository } from '../repositories/draft-repository'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { RevisionLearningRepository } from '../repositories/revision-learning-repository'
import { RevisionLearningProjectFileStore } from '../services/revision-learning-file-store'
import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { assertRequiredExpectedProjectPath } from '../utils/project-context'

const fileStore = new RevisionLearningProjectFileStore()

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function recordForProject(recordId: string, projectId: string) {
  const record = RevisionLearningRepository.getRecord(recordId)
  if (record.projectId !== projectId) throw new Error('修订学习记录不属于当前项目')
  return record
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}结构无效`)
  return value as Record<string, unknown>
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label}无效`)
  return value as number
}

function snapshotFromDraft(
  draftId: number,
  content: string,
  sourceKind: 'saved-draft' | 'editor-snapshot',
  source?: { tabId: string; editGeneration: number },
): RevisionLearningSnapshot {
  const draft = DraftRepository.getFull(draftId)
  if (!draft) throw new Error('找不到该草稿版本，或该草稿已归档')
  if (typeof content !== 'string' || content.length > REVISION_LEARNING_MAX_TEXT_CHARS) {
    throw new Error('修订学习样本为空或超过 250,000 字符限制')
  }
  return {
    sourceKind,
    draftId: draft.id,
    logicalChapterIdentity: `chapter:${draft.chapterNumber}`,
    chapterNumber: draft.chapterNumber,
    ...(draft.displayNumber !== undefined ? { displayNumber: draft.displayNumber } : {}),
    title: draft.chapterTitle?.trim() || `第${draft.displayNumber ?? draft.chapterNumber}章`,
    version: draft.version,
    status: draft.status,
    content,
    contentHash: sha256(content),
    capturedAt: new Date().toISOString(),
    ...(source ? { tabId: source.tabId, editGeneration: source.editGeneration } : {}),
  }
}

function validateEditorInput(value: unknown): RevisionLearningEditorSnapshotInput {
  const input = requireObject(value, '编辑器快照')
  const draftId = requirePositiveInteger(input.draftId, '草稿 ID')
  const tabId = input.tabId
  const editGeneration = input.editGeneration
  const content = input.content
  if (typeof tabId !== 'string' || !tabId.trim() || tabId.length > 300) throw new Error('编辑器来源标签无效')
  if (!Number.isSafeInteger(editGeneration) || (editGeneration as number) < 0) throw new Error('编辑器变更代次无效')
  if (typeof content !== 'string' || content.length > REVISION_LEARNING_MAX_TEXT_CHARS) throw new Error('编辑器正文超过 250,000 字符限制')
  return { draftId, tabId, editGeneration: editGeneration as number, content }
}

function currentWritingLanguage(): 'zh-CN' | 'en-US' {
  return ProjectCoreRepository.get()?.writingLanguage ?? 'zh-CN'
}

function compactReceipt(value: unknown): unknown {
  if (value === undefined) return null
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('生成回执无法序列化')
  }
  if (serialized.length > 64 * 1024) throw new Error('生成回执超过存储限制')
  return JSON.parse(serialized) as unknown
}

function registerProjectHandler(
  channel: string,
  handler: (projectId: string, projectPath: string, context: ProjectSessionContext, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...incoming: unknown[]) => {
    const context = incoming.at(-1)
    if (!isProjectSessionContext(context)) throw new Error('缺少冻结的项目会话')
    incoming.pop()
    const currentPath = getCurrentProjectPath()
    const session = projectAccess.assertCurrentProjectContext(context, currentPath)
    assertRequiredExpectedProjectPath(currentPath, context.projectPath)
    return handler(session.projectId, session.rootPath, context, ...incoming)
  })
}

export function registerRevisionLearningController(): void {
  registerProjectHandler('revision-learning:list-source-drafts', () => DraftRepository.listAll()
    .map(draft => ({
      id: draft.id,
      chapterNumber: draft.chapterNumber,
      ...(draft.displayNumber !== undefined ? { displayNumber: draft.displayNumber } : {}),
      title: draft.chapterTitle?.trim() || `第${draft.displayNumber ?? draft.chapterNumber}章`,
      version: draft.version,
      status: draft.status,
      updatedAt: draft.updatedAt,
    })))

  registerProjectHandler('revision-learning:list', () => RevisionLearningRepository.listRecords())

  registerProjectHandler('revision-learning:get', (projectId, _projectPath, _context, rawRecordId) => {
    if (typeof rawRecordId !== 'string') throw new Error('修订学习记录 ID 无效')
    return recordForProject(rawRecordId, projectId)
  })

  registerProjectHandler('revision-learning:create-from-versions', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '保存版本对比') as unknown as RevisionLearningCreateFromVersionsInput
    const beforeDraftId = requirePositiveInteger(input.beforeDraftId, '修改前草稿 ID')
    const afterDraftId = requirePositiveInteger(input.afterDraftId, '修改后草稿 ID')
    if (beforeDraftId === afterDraftId) throw new Error('请选择两个不同的已保存版本')
    const beforeDraft = DraftRepository.getFull(beforeDraftId)
    const afterDraft = DraftRepository.getFull(afterDraftId)
    if (!beforeDraft || !afterDraft) throw new Error('找不到所选草稿版本，或草稿已归档')
    if (beforeDraft.chapterNumber !== afterDraft.chapterNumber) throw new Error('只能对比同一逻辑章节的已保存版本')
    const before = snapshotFromDraft(beforeDraftId, beforeDraft.content, 'saved-draft')
    const after = snapshotFromDraft(afterDraftId, afterDraft.content, 'saved-draft')
    return RevisionLearningRepository.createRecord(projectId, before, after)
  })

  registerProjectHandler('revision-learning:record-editor-before', (projectId, _path, _context, rawInput) => {
    const input = validateEditorInput(rawInput)
    const before = snapshotFromDraft(input.draftId, input.content, 'editor-snapshot', {
      tabId: input.tabId,
      editGeneration: input.editGeneration,
    })
    return RevisionLearningRepository.createRecord(projectId, before, null)
  })

  registerProjectHandler('revision-learning:capture-after', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '编辑器后稿快照') as unknown as RevisionLearningAfterSnapshotInput
    const editor = validateEditorInput(input)
    if (typeof input.recordId !== 'string' || !input.recordId) throw new Error('修订学习记录 ID 无效')
    const recordId = input.recordId
    const expectedRevision = requirePositiveInteger(input.expectedRevision, '记录版本')
    const record = recordForProject(recordId, projectId)
    if (record.beforeSnapshot.sourceKind !== 'editor-snapshot') throw new Error('该记录来自已保存版本，不能追加编辑器快照')
    if (record.beforeSnapshot.tabId !== editor.tabId || record.beforeSnapshot.draftId !== editor.draftId) {
      throw new Error('编辑器后稿不属于创建记录时的来源标签和草稿')
    }
    const after = snapshotFromDraft(editor.draftId, editor.content, 'editor-snapshot', {
      tabId: editor.tabId,
      editGeneration: editor.editGeneration,
    })
    return RevisionLearningRepository.captureAfter(recordId, expectedRevision, after)
  })

  registerProjectHandler('revision-learning:reverse-sample', (projectId, _path, _context, rawRecordId, rawRevision) => {
    if (typeof rawRecordId !== 'string' || !rawRecordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(rawRecordId, projectId)
    const revision = requirePositiveInteger(rawRevision, '记录版本')
    return RevisionLearningRepository.reverseSample(record.id, revision)
  })

  registerProjectHandler('revision-learning:save-input', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '修订样本设置') as unknown as RevisionLearningSaveInput
    if (typeof input.recordId !== 'string' || !input.recordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(input.recordId, projectId)
    const expectedRevision = requirePositiveInteger(input.expectedRevision, '记录版本')
    return RevisionLearningRepository.updateInput(record.id, expectedRevision, input.changes, input.overallReason)
  })

  registerProjectHandler('revision-learning:attempt-begin', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '修订学习分析请求') as unknown as RevisionLearningAttemptStartInput
    if (typeof input.recordId !== 'string' || !input.recordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(input.recordId, projectId)
    const inputRevision = requirePositiveInteger(input.inputRevision, '分析输入版本')
    const modelId = input.modelId === null || typeof input.modelId === 'string' ? input.modelId : undefined
    if (modelId === undefined || (modelId !== null && modelId.length > 300)) throw new Error('模型 ID 无效')
    return RevisionLearningRepository.beginAttempt(record.id, inputRevision, input.inputHash, modelId)
  })

  registerProjectHandler('revision-learning:attempt-finish', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '修订学习分析结果') as unknown as RevisionLearningAttemptFinishInput
    if (typeof input.recordId !== 'string' || !input.recordId || typeof input.attemptId !== 'string' || !input.attemptId) {
      throw new Error('修订学习分析 attempt 身份无效')
    }
    const record = recordForProject(input.recordId, projectId)
    if (!['completed', 'failed', 'cancelled'].includes(input.status)) throw new Error('分析状态无效')
    const generationReceipt = compactReceipt(input.generationReceipt)
    if (input.status === 'completed') {
      const attempt = record.attempts.find(item => item.id === input.attemptId)
      if (!attempt || attempt.inputHash !== record.inputHash || attempt.inputRevision !== record.inputRevision) {
        throw new Error('分析 attempt 已过期，结果未保存')
      }
      if (!input.result) throw new Error('模型分析结果缺失')
      const result = parseRevisionLearningResult(JSON.stringify(input.result), record.changes, record.overallReason)
      return RevisionLearningRepository.finishAttempt(record.id, input.attemptId, {
        status: 'completed',
        result,
        generationReceipt,
      })
    }
    return RevisionLearningRepository.finishAttempt(record.id, input.attemptId, {
      status: input.status,
      generationReceipt,
      errorSummary: typeof input.errorSummary === 'string' ? input.errorSummary.slice(0, 1_000) : null,
    })
  })

  registerProjectHandler('revision-learning:review-save', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '技能审阅草稿') as unknown as RevisionLearningReviewSaveInput
    if (typeof input.recordId !== 'string' || !input.recordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(input.recordId, projectId)
    return RevisionLearningRepository.saveReview(record.id, requirePositiveInteger(input.expectedRevision, '记录版本'), input)
  })

  registerProjectHandler('revision-learning:review-confirm', (projectId, _path, _context, rawInput) => {
    const input = requireObject(rawInput, '技能预览确认') as unknown as RevisionLearningReviewConfirmInput
    if (typeof input.recordId !== 'string' || !input.recordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(input.recordId, projectId)
    const confirmed = RevisionLearningRepository.confirmReview(
      record.id,
      requirePositiveInteger(input.expectedRevision, '记录版本'),
      input.expectedContentHash,
      currentWritingLanguage(),
    )
    return confirmed.record
  })

  registerProjectHandler('revision-learning:publish', async (projectId, projectPath, context, rawInput) => {
    const input = requireObject(rawInput, '技能发布请求') as unknown as RevisionLearningPublishInput
    if (typeof input.recordId !== 'string' || !input.recordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(input.recordId, projectId)
    const review = record.review
    if (!review?.confirmedAt || !review.skillContentHash || review.confirmedWritingLanguage !== currentWritingLanguage()) {
      throw new Error('技能预览需要按当前项目写作语言重新确认')
    }
    const markdown = buildRevisionLearningSkillMarkdown(record.id, review, currentWritingLanguage())
    const contentHash = sha256(markdown)
    if (contentHash !== input.expectedContentHash || contentHash !== review.skillContentHash) {
      throw new Error('技能预览哈希与已确认版本不一致，请重新确认')
    }
    const operation = RevisionLearningRepository.preparePublish(
      record.id,
      requirePositiveInteger(input.expectedRevision, '记录版本'),
      contentHash,
    )
    const write = await fileStore.publishSkill(context, projectPath, {
      relativePath: operation.relative_path,
      skillId: operation.skill_id,
      content: markdown,
      contentHash,
    })
    const receipt = RevisionLearningRepository.markPublished(operation.idempotency_key, write.contentHash)
    return { receipt, recovered: write.recovered }
  })

  registerProjectHandler('revision-learning:bind', async (projectId, projectPath, context, rawInput) => {
    const input = requireObject(rawInput, '修稿阶段绑定请求') as unknown as RevisionLearningBindInput
    if (typeof input.recordId !== 'string' || !input.recordId || typeof input.skillId !== 'string') {
      throw new Error('项目技能身份无效')
    }
    const record = recordForProject(input.recordId, projectId)
    const operation = RevisionLearningRepository.getPublishOperations(record.id)
      .find(item => item.status === 'published' && item.skill_id === input.skillId && item.receipt)
    if (!operation) throw new Error('该技能还没有持久发布回执')
    return fileStore.bindPublishedSkill(context, projectPath, {
      skillId: operation.skill_id,
      relativePath: operation.relative_path,
      contentHash: operation.content_hash,
      expectedCurrentSkillId: input.expectedCurrentSkillId,
      mode: input.mode,
    })
  })

  registerProjectHandler('revision-learning:publication-status', async (projectId, projectPath, context, rawRecordId) => {
    if (typeof rawRecordId !== 'string' || !rawRecordId) throw new Error('修订学习记录 ID 无效')
    const record = recordForProject(rawRecordId, projectId)
    const receipts = RevisionLearningRepository.getPublishOperations(record.id)
      .filter(item => item.status === 'published')
      .map(item => ({ skillId: item.skill_id, relativePath: item.relative_path, contentHash: item.content_hash }))
    return fileStore.status(context, projectPath, receipts)
  })

  registerProjectHandler('revision-learning:binding-cas', async (_projectId, projectPath, context, rawInput) => {
    const input = requireObject(rawInput, '写作 Skill 绑定变更') as unknown as RevisionLearningBindingCasInput
    return fileStore.updateBindingWithCas(context, projectPath, input)
  })
}
