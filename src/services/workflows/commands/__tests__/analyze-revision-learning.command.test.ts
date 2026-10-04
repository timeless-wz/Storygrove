import { describe, expect, it, vi } from 'vitest'

import type { ModelExecutionLeaseReceipt } from '../../../../shared/ipc-channels'
import { computeRevisionLearningDiff } from '../../../../shared/revision-learning-diff'
import type { RevisionLearningAttempt, RevisionLearningRecord } from '../../../../shared/revision-learning'
import type { StepCallbacks, WorkflowContext } from '../../../../stores/workflow-store'
import { createGenerationRuntime, type GenerationRuntimeEnvironment } from '../../../generation/generation-runtime'
import type { WorkflowGenerationRuntimeDependencies } from '../base-command'
import { AnalyzeRevisionLearningCommand } from '../analyze-revision-learning.command'

const PROJECT_PATH = 'C:/novels/revision-learning-analysis'
const PROJECT_SESSION = Object.freeze({
  projectId: 'revision-learning-analysis',
  leaseId: 'revision-learning-analysis-lease',
  projectPath: PROJECT_PATH,
})

const MODEL_RESULT = JSON.stringify({
  summary: 'The revision keeps the hesitation visible through an action.',
  rules: [{
    id: 'rule-1',
    title: 'Keep hesitation physical',
    guidance: 'Show hesitation through a concrete action before naming the emotion.',
    appliesWhen: 'When revising a restrained emotional beat.',
    exceptions: 'Use direct naming when clarity requires it.',
    evidenceChangeIds: ['change-1'],
    reasonSource: 'author_explicit',
    limitations: 'This is a candidate from one sample.',
  }],
  nonGeneralizableChanges: [],
  suggestedSkill: { displayName: 'Revision craft', description: 'Review emotional beats through action.' },
})

function leaseReceipt(): ModelExecutionLeaseReceipt {
  return {
    leaseId: 'revision-learning-model-lease',
    modelId: 'model-a',
    provider: 'custom',
    protocol: 'openai',
    modelName: 'model-a',
    modelRevision: 'a'.repeat(64),
    endpointFingerprint: 'b'.repeat(64),
    capabilityEvidence: {
      source: {
        contextWindowTokens: 'unknown',
        maxOutputTokens: 'user-operational-cap',
        featureFlags: 'unknown',
      },
      subjectFingerprint: 'c'.repeat(64),
      contextWindowTokens: 32_768,
      maxOutputTokens: 8192,
      reasoning: null,
      structuredOutput: true,
      usage: null,
    },
    createdAt: 1000,
    expiresAt: 61_000,
  }
}

function makeFixture(): { record: RevisionLearningRecord; attempt: RevisionLearningAttempt } {
  const beforeText = 'Mara reached for the cold door. She was afraid.'
  const afterText = 'Mara let her hand rest on the cold door. She did not enter.'
  const changes = computeRevisionLearningDiff(beforeText, afterText)
  if (!changes[0]) throw new Error('Analysis fixture needs a difference')
  changes[0] = {
    ...changes[0],
    id: 'change-1',
    included: true,
    authorReason: 'Keep the fear in the gesture and preserve the restrained tone.',
  }
  const attempt: RevisionLearningAttempt = {
    id: 'attempt-1',
    inputRevision: 1,
    inputHash: 'input-hash-1',
    promptVersion: 'revision-learning-v1',
    modelId: 'model-a',
    status: 'running',
    errorSummary: null,
    result: null,
    generationReceipt: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    completedAt: null,
  }
  const beforeSnapshot = {
    sourceKind: 'saved-draft' as const,
    draftId: 101,
    logicalChapterIdentity: 'chapter:7',
    chapterNumber: 7,
    displayNumber: 7,
    title: 'Chapter 7',
    version: 1,
    status: 'draft',
    content: beforeText,
    contentHash: 'before-hash',
    capturedAt: '2026-10-04T00:00:00.000Z',
  }
  const afterSnapshot = {
    ...beforeSnapshot,
    draftId: 102,
    version: 2,
    content: afterText,
    contentHash: 'after-hash',
    capturedAt: '2026-10-04T00:01:00.000Z',
  }
  const record: RevisionLearningRecord = {
    id: 'record-1',
    projectId: PROJECT_SESSION.projectId,
    schemaVersion: 1,
    revision: 1,
    inputRevision: 1,
    inputHash: 'input-hash-1',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    beforeSnapshot,
    afterSnapshot,
    changes,
    changeCount: changes.length,
    overallReason: 'Keep the hesitation visible while preserving a restrained emotional tone.',
    attempts: [attempt],
    latestAttempt: { id: attempt.id, status: attempt.status, createdAt: attempt.createdAt, completedAt: null },
    review: null,
    publishReceipts: [],
    publishCount: 0,
  }
  return { record, attempt }
}

describe('AnalyzeRevisionLearningCommand', () => {
  it('sends the complete frozen evidence in project writing language without injecting the bound refinement skill', async () => {
    const { record, attempt } = makeFixture()
    const completeWithLease = vi.fn<GenerationRuntimeEnvironment['completeWithLease']>(async () => ({
      content: MODEL_RESULT,
      finishReason: 'stop',
    }))
    const dependencies: WorkflowGenerationRuntimeDependencies = {
      createRuntime: options => createGenerationRuntime(options, {
        snapshotDefaultModelId: () => 'model-a',
        beginModelExecution: async () => leaseReceipt(),
        completeWithLease,
        closeModelExecution: async () => {},
      }),
    }
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'revision-learning:get') return structuredClone(record)
      if (channel === 'revision-learning:attempt-finish') {
        const input = args[0] as {
          status: RevisionLearningAttempt['status']
          result?: RevisionLearningAttempt['result']
          generationReceipt?: unknown
        }
        attempt.status = input.status
        attempt.result = input.result ?? null
        attempt.generationReceipt = input.generationReceipt ?? null
        attempt.completedAt = '2026-10-04T00:02:00.000Z'
        record.latestAttempt = { id: attempt.id, status: attempt.status, createdAt: attempt.createdAt, completedAt: attempt.completedAt }
        return structuredClone(attempt)
      }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    })
    vi.stubGlobal('window', { velaAPI: { invoke } })
    const context: WorkflowContext = {
      runId: attempt.id,
      projectPath: PROJECT_PATH,
      projectSession: PROJECT_SESSION,
      generationModelId: 'model-a',
      writingLanguage: 'en-US',
      uiLocale: 'en-US',
      data: {},
      cancelled: false,
      writingSkills: Object.freeze({
        refinement: Object.freeze({
          skillId: 'project:existing-style',
          name: 'Existing style',
          stage: 'refinement',
          source: 'project',
          writingLanguage: 'en-US',
          content: 'BOUND_REFINEMENT_SKILL_SENTINEL',
          utf8Bytes: 31,
        }),
      }),
    }
    const callbacks: StepCallbacks = { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() }

    const result = await new AnalyzeRevisionLearningCommand(
      PROJECT_SESSION,
      record.id,
      attempt.id,
      dependencies,
    ).execute({ step: {}, context, callbacks })

    expect(result.rules).toHaveLength(1)
    expect(completeWithLease).toHaveBeenCalledOnce()
    const request = completeWithLease.mock.calls[0]![0]
    expect(request.purpose).toBe('revision-learning-analysis')
    expect(request.plan.output).toBe('structured-data')
    expect(request.messages[1]?.content).toContain('Write all natural-language result fields in English.')
    expect(request.messages[1]?.content).toContain(record.beforeSnapshot.content)
    expect(request.messages[1]?.content).toContain(record.afterSnapshot!.content)
    expect(request.messages[1]?.content).toContain(record.overallReason)
    expect(request.messages[1]?.content).toContain(record.changes[0]!.authorReason)
    expect(request.messages.map(message => message.content).join('\n')).not.toContain('BOUND_REFINEMENT_SKILL_SENTINEL')

    const finish = invoke.mock.calls.find(call => call[0] === 'revision-learning:attempt-finish')?.[1] as {
      status: string
      generationReceipt: { promptBudget?: { errorCode: string; reservedOutputTokens: number; sections: Array<{ sectionName: string }> } }
    }
    expect(finish.status).toBe('completed')
    const promptBudget = finish.generationReceipt.promptBudget
    if (!promptBudget) throw new Error('Prompt budget report was not persisted with the generation receipt')
    expect(promptBudget).toMatchObject({
      errorCode: 'OK',
      sections: expect.arrayContaining([expect.objectContaining({ sectionName: 'revision-sample' })]),
    })
    expect(promptBudget.reservedOutputTokens).toBeGreaterThan(0)
  })

  it('rejects an oversized complete sample before sending a provider request', async () => {
    const { record, attempt } = makeFixture()
    record.beforeSnapshot.content = '样'.repeat(130_000)
    record.afterSnapshot!.content = '稿'.repeat(130_000)
    const completeWithLease = vi.fn<GenerationRuntimeEnvironment['completeWithLease']>()
    const dependencies: WorkflowGenerationRuntimeDependencies = {
      createRuntime: options => createGenerationRuntime(options, {
        snapshotDefaultModelId: () => 'model-a',
        beginModelExecution: async () => leaseReceipt(),
        completeWithLease,
        closeModelExecution: async () => {},
      }),
    }
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'revision-learning:get') return structuredClone(record)
      if (channel === 'revision-learning:attempt-finish') {
        const input = args[0] as { status: RevisionLearningAttempt['status']; errorSummary?: string }
        attempt.status = input.status
        attempt.errorSummary = input.errorSummary ?? null
        attempt.completedAt = '2026-10-04T00:03:00.000Z'
        return structuredClone(attempt)
      }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    })
    vi.stubGlobal('window', { velaAPI: { invoke } })
    const context: WorkflowContext = {
      runId: attempt.id,
      projectPath: PROJECT_PATH,
      projectSession: PROJECT_SESSION,
      generationModelId: 'model-a',
      writingLanguage: 'zh-CN',
      uiLocale: 'zh-CN',
      data: {},
      cancelled: false,
    }

    await expect(new AnalyzeRevisionLearningCommand(
      PROJECT_SESSION,
      record.id,
      attempt.id,
      dependencies,
    ).execute({ step: {}, context, callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() } })).rejects.toThrow()

    expect(completeWithLease).not.toHaveBeenCalled()
    expect(attempt.status).toBe('failed')
    expect(attempt.errorSummary).toContain('缩短')
  })
})
