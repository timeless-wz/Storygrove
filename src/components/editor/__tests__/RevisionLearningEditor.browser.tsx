import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import {
  revisionLearningSkillName,
  type RevisionLearningAttempt,
  type RevisionLearningRecord,
  type RevisionLearningRecordSummary,
  type RevisionLearningReviewDraft,
  type RevisionLearningResult,
  type RevisionLearningSourceDraft,
  type RevisionLearningSnapshot,
} from '../../../shared/revision-learning'
import { computeRevisionLearningDiff } from '../../../shared/revision-learning-diff'
import { useEditorStore } from '../../../stores/editor-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { skillRegistry } from '../../../services/agent/skill-registry'
import RevisionLearningEditor from '../RevisionLearningEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session: ProjectSessionContext = {
  projectId: 'revision-learning-project',
  projectPath: 'C:/novels/revision-learning-project',
  leaseId: 'revision-learning-lease',
}

const sourceDrafts: RevisionLearningSourceDraft[] = [
  { id: 101, chapterNumber: 7, displayNumber: 7, title: '第七章', version: 1, status: 'draft', updatedAt: '2026-10-04T01:00:00.000Z' },
  { id: 102, chapterNumber: 7, displayNumber: 7, title: '第七章', version: 2, status: 'draft', updatedAt: '2026-10-04T02:00:00.000Z' },
]

const beforeContent = '她推开门。屋里一片漆黑。'
const afterContent = '门被她推开。屋里黑得看不见尽头。'

function snapshot(draftId: number, version: number, content: string): RevisionLearningSnapshot {
  return {
    sourceKind: 'saved-draft',
    draftId,
    logicalChapterIdentity: 'chapter:7',
    chapterNumber: 7,
    displayNumber: 7,
    title: '第七章',
    version,
    status: 'draft',
    content,
    contentHash: `content-hash-${version}`,
    capturedAt: `2026-10-04T0${version}:00:00.000Z`,
  }
}

function summary(record: RevisionLearningRecord): RevisionLearningRecordSummary {
  const beforeSnapshot = { ...record.beforeSnapshot }
  Reflect.deleteProperty(beforeSnapshot, 'content')
  const afterSnapshot = record.afterSnapshot ? { ...record.afterSnapshot } : null
  if (afterSnapshot) Reflect.deleteProperty(afterSnapshot, 'content')
  return {
    id: record.id,
    projectId: record.projectId,
    schemaVersion: record.schemaVersion,
    revision: record.revision,
    inputRevision: record.inputRevision,
    inputHash: record.inputHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    beforeSnapshot,
    afterSnapshot,
    changeCount: record.changes.length,
    latestAttempt: record.attempts[0]
      ? { id: record.attempts[0].id, status: record.attempts[0].status, createdAt: record.attempts[0].createdAt, completedAt: record.attempts[0].completedAt }
      : null,
    publishCount: record.publishReceipts.length,
  }
}

function makeRecord(): RevisionLearningRecord {
  const before = snapshot(101, 1, beforeContent)
  const after = snapshot(102, 2, afterContent)
  const changes = computeRevisionLearningDiff(before.content, after.content)
  return {
    id: 'revision-learning-record-1',
    projectId: session.projectId,
    schemaVersion: 1,
    revision: 1,
    inputRevision: 1,
    inputHash: 'input-hash-1',
    createdAt: '2026-10-04T02:01:00.000Z',
    updatedAt: '2026-10-04T02:01:00.000Z',
    beforeSnapshot: before,
    afterSnapshot: after,
    changeCount: changes.length,
    latestAttempt: null,
    publishCount: 0,
    changes,
    overallReason: '',
    attempts: [],
    review: null,
    publishReceipts: [],
  }
}

function makeEditorSnapshotRecord(): RevisionLearningRecord {
  const record = makeRecord()
  return {
    ...record,
    id: 'revision-learning-editor-record',
    beforeSnapshot: {
      ...record.beforeSnapshot,
      sourceKind: 'editor-snapshot',
      tabId: 'source-prose-tab',
      editGeneration: 4,
    },
    afterSnapshot: null,
    changes: [],
    changeCount: 0,
    inputHash: 'editor-input-hash-1',
  }
}

function makeResult(record: RevisionLearningRecord): RevisionLearningResult {
  const evidenceId = record.changes[0]?.id
  if (!evidenceId) throw new Error('Test sample must contain a change')
  const rule = (id: string, title: string) => ({
    id,
    title,
    guidance: `${title}：让动作和感受落在具体描写中。`,
    appliesWhen: '修订叙事段落时',
    exceptions: '有意留白时',
    evidenceChangeIds: [evidenceId],
    reasonSource: 'author_explicit' as const,
    limitations: '只作为提示，按当前章节判断。',
  })
  return {
    summary: '候选规则来自作者选择的正文差异和修改理由。',
    rules: [rule('rule-1', '明确动作主体'), rule('rule-2', '保留人物克制')],
    nonGeneralizableChanges: [],
    suggestedSkill: { displayName: '修稿经验', description: '帮助复查叙事段落' },
  }
}

let root: Root | undefined
let container: HTMLDivElement | undefined
let currentRecord: RevisionLearningRecord | null = null
let refinementSkillId: string | null = 'builtin:natural-prose-refinement'
let nextAttempt = 0
const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>()
const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLLMState = useLLMStore.getState()
const originalSkills = skillRegistry.listAll()

function getRecord(): RevisionLearningRecord {
  if (!currentRecord) throw new Error('No revision-learning record exists')
  return currentRecord
}

function makeAttempt(input: Record<string, unknown>): RevisionLearningAttempt {
  const now = new Date().toISOString()
  return {
    id: `revision-learning-attempt-${++nextAttempt}`,
    inputRevision: input.inputRevision as number,
    inputHash: input.inputHash as string,
    promptVersion: 'revision-learning-v1',
    modelId: input.modelId as string | null,
    status: 'running',
    errorSummary: null,
    result: null,
    generationReceipt: null,
    createdAt: now,
    completedAt: null,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const activeTabId = useEditorStore(state => state.activeTabId)
  const activeTab = useEditorStore(state => state.tabs.find(tab => tab.id === activeTabId))
  const recordId = activeTab?.type === 'revision-learning' ? activeTab.revisionLearningRecordId : undefined
  return <RevisionLearningEditor recordId={recordId} />
}

beforeEach(async () => {
  currentRecord = null
  refinementSkillId = 'builtin:natural-prose-refinement'
  nextAttempt = 0
  invoke.mockReset()
  invoke.mockImplementation(async (channel, ...args) => {
    const input = args[0] as Record<string, unknown> | undefined
    switch (channel) {
      case 'revision-learning:list-source-drafts': return sourceDrafts
      case 'revision-learning:list': return currentRecord ? [summary(currentRecord)] : []
      case 'revision-learning:get': return structuredClone(getRecord())
      case 'revision-learning:create-from-versions':
        expect(input).toEqual({ beforeDraftId: 101, afterDraftId: 102 })
        currentRecord = makeRecord()
        return structuredClone(currentRecord)
      case 'revision-learning:capture-after': {
        const record = getRecord()
        const content = input?.content as string
        record.afterSnapshot = {
          ...record.beforeSnapshot,
          content,
          contentHash: `editor-after-${content.length}`,
          capturedAt: new Date().toISOString(),
          editGeneration: input?.editGeneration as number,
        }
        record.changes = computeRevisionLearningDiff(record.beforeSnapshot.content, content)
        record.changeCount = record.changes.length
        record.inputRevision++
        record.inputHash = `input-hash-${record.inputRevision}`
        record.revision++
        return structuredClone(record)
      }
      case 'revision-learning:save-input': {
        const record = getRecord()
        record.overallReason = input?.overallReason as string
        record.changes = record.changes.map(change => {
          const saved = (input?.changes as Array<{ id: string; included: boolean; authorReason: string }>).find(candidate => candidate.id === change.id)
          return saved ? { ...change, included: saved.included, authorReason: saved.authorReason } : change
        })
        record.inputRevision++
        record.inputHash = `input-hash-${record.inputRevision}`
        record.revision++
        record.updatedAt = new Date().toISOString()
        return structuredClone(record)
      }
      case 'revision-learning:attempt-begin': {
        const record = getRecord()
        const attempt = makeAttempt(input ?? {})
        record.attempts.unshift(attempt)
        return structuredClone(attempt)
      }
      case 'revision-learning:review-save': {
        const record = getRecord()
        const previousRevision = record.review?.skillDraftRevision ?? 0
        const review: RevisionLearningReviewDraft = {
          resultAttemptId: input?.resultAttemptId as string,
          resultInputHash: input?.resultInputHash as string,
          rules: structuredClone(input?.rules as RevisionLearningReviewDraft['rules']),
          skillDisplayName: input?.skillDisplayName as string,
          skillDescription: input?.skillDescription as string,
          skillDraftRevision: previousRevision + 1,
          skillContentHash: null,
          confirmedAt: null,
          confirmedWritingLanguage: null,
        }
        record.review = review
        record.revision++
        return structuredClone(record)
      }
      case 'revision-learning:review-confirm': {
        const record = getRecord()
        if (!record.review) throw new Error('Review draft is missing')
        record.review = {
          ...record.review,
          skillContentHash: input?.expectedContentHash as string,
          confirmedAt: new Date().toISOString(),
          confirmedWritingLanguage: input?.writingLanguage as 'zh-CN' | 'en-US',
        }
        record.revision++
        return structuredClone(record)
      }
      case 'revision-learning:publish': {
        const record = getRecord()
        if (!record.review) throw new Error('Review draft is missing')
        const skillId = `project:${revisionLearningSkillName(record.id, record.review.skillDraftRevision)}`
        record.publishReceipts = [{
          idempotencyKey: `publish:${skillId}`,
          skillId,
          relativePath: `.vela/skills/${skillId.slice('project:'.length)}/SKILL.md`,
          contentHash: input?.expectedContentHash as string,
          publishedAt: new Date().toISOString(),
        }]
        record.publishCount = record.publishReceipts.length
        record.revision++
        return { receipt: record.publishReceipts[0], idempotent: false }
      }
      case 'revision-learning:publication-status': {
        const record = getRecord()
        return {
          refinementSkillId,
          skills: record.publishReceipts.map(receipt => ({
            skillId: receipt.skillId,
            exists: true,
            compatible: true,
            contentHash: receipt.contentHash,
            matchesPublishedHash: true,
            boundToRefinement: refinementSkillId === receipt.skillId,
            actualRefinementSkillId: refinementSkillId,
          })),
        }
      }
      case 'revision-learning:bind':
        refinementSkillId = input?.skillId as string
        return { bound: true, conflict: false, currentSkillId: refinementSkillId }
      case 'skills:list-user': return []
      case 'fs:check-exists': return false
      case 'llm:list-models': return []
      case 'llm:get-default-model': return null
      case 'llm:get-default-embedding-model': return null
      default: throw new Error(`Unexpected IPC channel ${channel}`)
    }
  })

  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: () => () => {}, once: () => {}, send: () => {} },
  })
  useLocaleStore.setState({ locale: 'en-US' })
  useProjectStore.setState({
    currentProject: {
      id: session.projectId,
      name: 'Revision learning project',
      path: session.projectPath,
      sessionLease: session.leaseId,
      novelConfig: { writingLanguage: 'zh-CN' },
    } as never,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useLLMStore.setState({ ...originalLLMState, loaded: false, defaultModelId: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  await act(async () => {
    await vi.waitFor(() => expect(page.getByRole('heading', { name: 'Start from saved versions' }).query()).not.toBeNull())
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useProjectStore.setState(originalProjectState)
  useLocaleStore.setState(originalLocaleState)
  useEditorStore.setState(originalEditorState)
  useLLMStore.setState(originalLLMState)
  skillRegistry.clear()
  originalSkills.forEach(skill => skillRegistry.register(skill))
  vi.restoreAllMocks()
})

describe('revision learning editor', () => {
  it('captures an unsaved later editor snapshot from the original draft tab identity', async () => {
    const revisedBuffer = '她推开门。屋里亮起一盏灯。'
    currentRecord = makeEditorSnapshotRecord()
    const recordId = currentRecord.id
    await act(async () => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'source-prose-tab',
            name: '第七章',
            type: 'chapter',
            filePath: 'vela://draft/101',
            content: revisedBuffer,
            savedContent: beforeContent,
            dirty: true,
            draftId: 101,
            draftStatus: 'draft',
            chapterNumber: 7,
            projectKey: session.projectPath,
            projectSessionLease: session.leaseId,
            contentRevision: 12,
          },
          {
            id: 'revision-learning:revision-learning-editor-record',
            name: 'Revision learning · Chapter 7',
            type: 'revision-learning',
            projectKey: session.projectPath,
            chapterNumber: 7,
            revisionLearningRecordId: recordId,
            revisionLearningSourceTabId: 'source-prose-tab',
          },
        ],
        activeTabId: 'revision-learning:revision-learning-editor-record',
      })
    })
    await act(async () => {
      await vi.waitFor(() => expect(page.getByRole('heading', { name: 'Revision sample' }).query()).not.toBeNull())
    })

    await act(async () => page.getByRole('button', { name: 'Capture revised text' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(getRecord().afterSnapshot?.content).toBe(revisedBuffer))
    })

    const capture = invoke.mock.calls.find(call => call[0] === 'revision-learning:capture-after')
    expect(capture?.[1]).toMatchObject({
      recordId: 'revision-learning-editor-record',
      draftId: 101,
      tabId: 'source-prose-tab',
      editGeneration: 12,
      content: revisedBuffer,
    })
    expect(getRecord().beforeSnapshot.content).toBe(beforeContent)
    expect(getRecord().afterSnapshot).toMatchObject({
      sourceKind: 'editor-snapshot',
      draftId: 101,
      tabId: 'source-prose-tab',
      editGeneration: 12,
      content: revisedBuffer,
    })
    expect(getRecord().changes.length).toBeGreaterThan(0)
  })

  it('compares saved versions, reviews model suggestions, publishes, and binds the confirmed skill', async () => {
    let finishCancelledWorkflow: (() => void) | null = null
    let workflowRuns = 0
    const workflow = vi.spyOn(useWorkflowStore.getState(), 'startWorkflow').mockImplementation(definition => {
      expect(definition.type).toBe('revision_learning')
      expect(definition.projectSession).toEqual(session)
      const runId = definition.runId
      if (!runId) throw new Error('The analysis workflow has no attempt identity')
      workflowRuns++
      if (workflowRuns === 1) {
        return new Promise<string>(resolve => {
          finishCancelledWorkflow = () => resolve(runId)
        })
      }
      const record = getRecord()
      const attempt = record.attempts.find(candidate => candidate.id === runId)
      if (!attempt) throw new Error('Analysis attempt was not persisted before workflow start')
      attempt.result = makeResult(record)
      attempt.status = 'completed'
      attempt.completedAt = new Date().toISOString()
      attempt.generationReceipt = { model: { id: 'test-model' }, usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 } }
      return Promise.resolve(runId)
    })
    const cancelWorkflow = vi.spyOn(useWorkflowStore.getState(), 'cancelWorkflow').mockImplementation(runId => {
      const attempt = getRecord().attempts.find(candidate => candidate.id === runId)
      if (!attempt) throw new Error('Stop request did not target the active attempt')
      attempt.status = 'cancelled'
      attempt.errorSummary = 'Workflow was cancelled.'
      attempt.completedAt = new Date().toISOString()
      finishCancelledWorkflow?.()
    })

    await act(async () => page.getByLabelText('Choose the earlier version').selectOptions('101'))
    await act(async () => page.getByLabelText('Choose the later version').selectOptions('102'))
    await act(async () => page.getByRole('button', { name: 'Compare versions' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(page.getByRole('heading', { name: 'Revision sample' }).query()).not.toBeNull())
    })

    expect(invoke.mock.calls.find(call => call[0] === 'revision-learning:create-from-versions')).toBeDefined()
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'revision-learning' && tab.revisionLearningRecordId === 'revision-learning-record-1')).toBe(true)
    expect(getRecord().beforeSnapshot.content).toBe(beforeContent)
    expect(getRecord().afterSnapshot?.content).toBe(afterContent)

    await act(async () => {
      await page.getByLabelText('Overall revision goal or reason').fill('Make the emotional turn clearer while keeping the character restrained.')
      await page.getByLabelText('Reason for this change').fill('The revision makes the image sharper without explaining the fear.')
    })
    await act(async () => page.getByRole('button', { name: 'Save sample settings' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(getRecord().changes[0]?.authorReason).toContain('image sharper'))
    })

    await act(async () => page.getByRole('button', { name: 'Analyze and propose rules' }).click())
    await expect.element(page.getByRole('button', { name: 'Stop analysis' })).toBeVisible()
    const cancelledAttemptId = getRecord().attempts[0]!.id
    await act(async () => page.getByRole('button', { name: 'Stop analysis' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(getRecord().attempts.find(attempt => attempt.id === cancelledAttemptId)?.status).toBe('cancelled'))
    })
    expect(cancelWorkflow).toHaveBeenCalledWith(cancelledAttemptId)
    await expect.element(page.getByRole('button', { name: 'Retry analysis' })).toBeEnabled()

    await act(async () => page.getByRole('button', { name: 'Retry analysis' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(page.getByRole('heading', { name: 'Review candidate skill' }).query()).not.toBeNull())
    })
    expect(workflow).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls.filter(call => call[0] === 'revision-learning:attempt-begin')).toHaveLength(2)
    expect(getRecord().attempts.find(attempt => attempt.id === cancelledAttemptId)?.status).toBe('cancelled')
    await expect.element(page.getByRole('checkbox', { name: 'Select candidate rule 明确动作主体' })).toBeVisible()

    const firstRule = page.getByRole('checkbox', { name: 'Select candidate rule 明确动作主体' })
    await act(async () => firstRule.click())
    const guidanceFields = page.getByLabelText('Revision guidance')
    await act(async () => guidanceFields.nth(0).fill('Keep each action attached to the character who performs it.'))
    await act(async () => page.getByRole('button', { name: 'Save review edits' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(getRecord().review?.rules.some(rule => rule.id === 'rule-1' && rule.selected)).toBe(true))
    })
    const preview = [...(container?.querySelectorAll('pre') ?? [])].at(-1)
    expect(preview?.textContent).toContain('Keep each action attached to the character who performs it.')
    expect(preview?.textContent).not.toContain('保留人物克制')

    await act(async () => page.getByRole('button', { name: 'Confirm skill preview' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(getRecord().review?.confirmedAt).toBeTruthy())
    })
    await act(async () => page.getByRole('button', { name: 'Publish to project skill library' }).click())
    await act(async () => {
      await vi.waitFor(() => expect(getRecord().publishReceipts).toHaveLength(1))
    })

    const publishedSkillId = getRecord().publishReceipts[0]!.skillId
    expect(publishedSkillId).toMatch(/^project:revision-/u)
    await act(async () => page.getByRole('button', { name: 'Save and bind', exact: true }).click())
    await act(async () => {
      await vi.waitFor(() => expect(page.getByRole('dialog').query()).not.toBeNull())
    })
    await act(async () => page.getByRole('button', { name: 'Confirm', exact: true }).click())
    await act(async () => {
      await vi.waitFor(() => expect(refinementSkillId).toBe(publishedSkillId))
    })
    await expect.element(page.getByRole('button', { name: 'Bound to refinement' })).toBeVisible()

    const bindCall = invoke.mock.calls.find(call => call[0] === 'revision-learning:bind')
    expect(bindCall?.[1]).toMatchObject({
      recordId: 'revision-learning-record-1',
      skillId: publishedSkillId,
      expectedCurrentSkillId: 'builtin:natural-prose-refinement',
      mode: 'replace',
    })
  })
})
