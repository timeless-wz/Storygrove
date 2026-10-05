import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { RevisionLearningRepository } from '../revision-learning-repository'
import type { RevisionLearningSnapshot } from '../../../src/shared/revision-learning'

let projectRoot = ''

function snapshot(
  draftId: number,
  content: string,
  version: number,
  sourceKind: 'saved-draft' | 'editor-snapshot' = 'saved-draft',
  tabId?: string,
  editGeneration?: number,
): RevisionLearningSnapshot {
  return {
    sourceKind,
    draftId,
    logicalChapterIdentity: 'chapter:4',
    chapterNumber: 4,
    displayNumber: 4,
    title: '第四章 夜行',
    version,
    status: 'draft',
    content,
    contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
    capturedAt: new Date().toISOString(),
    ...(sourceKind === 'editor-snapshot' ? { tabId, editGeneration } : {}),
  }
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-revision-learning-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
  if (projectRoot && fs.existsSync(projectRoot)) fs.rmSync(projectRoot, { recursive: true, force: true })
})

describe('RevisionLearningRepository', () => {
  it('compares saved versions from different draft rows in the same chapter and persists author selections', () => {
    const record = RevisionLearningRepository.createRecord(
      'project-main',
      snapshot(10, '角色推门进屋。\n\n她坐下。', 1),
      snapshot(11, '角色停在门边听了一会儿。\n\n她坐下。', 2),
    )
    expect(record.changes).toHaveLength(1)
    expect(record.beforeSnapshot.draftId).toBe(10)
    expect(record.afterSnapshot?.draftId).toBe(11)

    const change = record.changes[0]!
    const edited = RevisionLearningRepository.updateInput(
      record.id,
      record.revision,
      [{ id: change.id, included: true, authorReason: '先建立角色的警觉状态' }],
      '保留悬念，稍后再揭示屋内情况。',
    )
    expect(edited.inputRevision).toBe(record.inputRevision + 1)
    expect(edited.changes[0]).toMatchObject({ included: true, authorReason: '先建立角色的警觉状态' })
    expect(edited.overallReason).toContain('保留悬念')
  })

  it('interrupts an active analysis when author input changes and ignores its late result', () => {
    const record = RevisionLearningRepository.createRecord(
      'project-main',
      snapshot(20, '旧稿。', 1),
      snapshot(21, '新稿。', 2),
    )
    const firstChange = record.changes[0]!
    const prepared = RevisionLearningRepository.updateInput(
      record.id,
      record.revision,
      [{ id: firstChange.id, included: true, authorReason: '改善节奏' }],
      '',
    )
    const attempt = RevisionLearningRepository.beginAttempt(record.id, prepared.inputRevision, prepared.inputHash, 'model-1')
    const changed = RevisionLearningRepository.updateInput(
      record.id,
      prepared.revision,
      [{ id: firstChange.id, included: true, authorReason: '把动作写清楚' }],
      '',
    )

    expect(changed.attempts[0]).toMatchObject({ status: 'interrupted', result: null })
    const late = RevisionLearningRepository.finishAttempt(record.id, attempt.id, {
      status: 'completed',
      result: {
        summary: 'stale',
        rules: [],
        nonGeneralizableChanges: [],
        suggestedSkill: { displayName: 'stale', description: 'stale' },
      },
    })
    expect(late).toMatchObject({ status: 'interrupted', result: null })
  })

  it('recovers a running attempt as interrupted after reopening the project database', () => {
    const record = RevisionLearningRepository.createRecord(
      'project-main',
      snapshot(30, '开门。', 1, 'editor-snapshot', 'draft-tab-1', 7),
      null,
    )
    const captured = RevisionLearningRepository.captureAfter(
      record.id,
      record.revision,
      snapshot(30, '先听见脚步，再开门。', 1, 'editor-snapshot', 'draft-tab-1', 8),
    )
    const ready = RevisionLearningRepository.updateInput(
      captured.id,
      captured.revision,
      captured.changes.map(change => ({ id: change.id, included: true, authorReason: '增加动作前的判断' })),
      '',
    )
    const attempt = RevisionLearningRepository.beginAttempt(ready.id, ready.inputRevision, ready.inputHash, 'model-2')

    closeProjectDatabase()
    initProjectDatabase(projectRoot)

    const reopened = RevisionLearningRepository.getRecord(record.id)
    expect(reopened.beforeSnapshot.content).toBe('开门。')
    expect(reopened.afterSnapshot?.content).toBe('先听见脚步，再开门。')
    expect(reopened.attempts.find(item => item.id === attempt.id)).toMatchObject({
      status: 'interrupted',
      errorSummary: '应用关闭时分析尚未完成',
      result: null,
    })
  })
})
