import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelExecutionLeaseReceipt } from '../../../../shared/ipc-channels'
import { computeBlueprintV2ContentHash, type ChapterBlueprintV2DetailRead } from '../../../../shared/blueprint-v2'
import { parseChapterBlueprintMarkdown } from '../../../../shared/blueprint-v2-markdown'
import { useEditorStore } from '../../../../stores/editor-store'
import { useProjectStore } from '../../../../stores/project-store'
import type { StepCallbacks, WorkflowContext } from '../../../../stores/workflow-store'
import {
  createGenerationRuntime,
  type GenerationRuntimeEnvironment,
} from '../../../generation/generation-runtime'
import { ReviewChapterCommand } from '../review-chapter.command'
import type { WorkflowGenerationRuntimeDependencies } from '../base-command'

const PROJECT_PATH = 'C:\\novels\\review-chapter'
const PROJECT_SESSION = Object.freeze({
  projectId: 'review-chapter',
  leaseId: 'project-lease-review-chapter',
  projectPath: PROJECT_PATH,
})

const PASSING_REVIEW_JSON = JSON.stringify({
  summary: '已根据冻结蓝图核对场景与正文证据。',
  items: [{
    category: '正文证据',
    severity: 'pass',
    description: '场景动作有原文支持。',
    quote: '顾舟扣紧安全带，按下录音键',
  }],
})

function leaseReceipt(modelId = 'model-a'): ModelExecutionLeaseReceipt {
  return {
    leaseId: 'model-lease-review-chapter',
    modelId,
    provider: 'custom',
    protocol: 'openai',
    modelName: modelId,
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

function runtimeDependencies(
  completeWithLease: GenerationRuntimeEnvironment['completeWithLease'],
): WorkflowGenerationRuntimeDependencies {
  return {
    createRuntime: options => createGenerationRuntime(options, {
      snapshotDefaultModelId: () => 'model-a',
      beginModelExecution: async () => leaseReceipt(),
      completeWithLease,
      closeModelExecution: async () => {},
    }),
  }
}

function workflowContext(): WorkflowContext {
  return {
    runId: 'review-chapter-run',
    projectPath: PROJECT_PATH,
    projectSession: PROJECT_SESSION,
    generationModelId: 'model-a',
    writingLanguage: 'zh-CN',
    uiLocale: 'zh-CN',
    data: {},
    cancelled: false,
  }
}

function callbacks(): StepCallbacks {
  return { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() }
}

function stubIpc(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): void {
  vi.stubGlobal('window', {
    velaAPI: {
      invoke: (channel: string, ...args: unknown[]) => (
        channel === 'prompt:load-global'
          ? Promise.resolve({ templates: [], diagnostics: [] })
          : channel === 'fs:check-exists'
            ? Promise.resolve(false)
            : invoke(channel, ...args)
      ),
    },
  })
}

function reviewCommand(
  completeWithLease: GenerationRuntimeEnvironment['completeWithLease'],
  params: { draftPath: string; draftContent: string; chapterNumber: number },
): ReviewChapterCommand {
  return new ReviewChapterCommand(params, runtimeDependencies(completeWithLease))
}

/** Frozen v2 detail built from the committed blueprint v2 fixture. */
function fixtureDetail(options: { chapterNumber: number; revision: number; marker: string }) {
  const markdown = readFileSync(
    resolve(__dirname, '../../../../../test/fixtures/blueprint-v2/chapter-01.md'),
    'utf8',
  )
  const { content } = parseChapterBlueprintMarkdown(markdown)
  const storyboard = content.sections.find(section => section.kind === 'canonical' && section.id === 'storyboard')
  const firstScene = storyboard?.kind === 'canonical'
    ? storyboard.items.find(item => item.kind === 'scene')
    : undefined
  if (firstScene?.kind !== 'scene') throw new Error('Fixture is missing its first storyboard scene')
  const stamped = {
    ...content,
    chapterNumber: options.chapterNumber,
    sections: content.sections.map(section => (
      section.kind === 'canonical' && section.id === 'storyboard'
        ? {
            ...section,
            items: section.items.map(item => (
              item.kind === 'scene' && item.id === firstScene.id
                ? { ...item, markdown: `${item.markdown}\n${options.marker}` }
                : item
            )),
          }
        : section
    )),
  }
  const detail: ChapterBlueprintV2DetailRead = {
    ...stamped,
    revision: options.revision,
    contentHash: computeBlueprintV2ContentHash(stamped),
  }
  return { detail, firstSceneId: firstScene.id }
}

function blueprintReviewPayload(sceneId: string) {
  return {
    scenes: [{
      sceneId,
      presence: 'present',
      sequence: 'in-order',
      causality: 'supported',
      description: '正文包含场景动作。',
      evidenceQuotes: ['顾舟扣紧安全带，按下录音键'],
      searchRange: { startLine: 1, endLine: 1 },
    }],
    checks: [],
    chapterHook: {
      status: 'uncertain',
      description: '待核对章末钩子。',
      evidenceQuotes: [],
      searchRange: { startLine: 1, endLine: 1 },
    },
    blueprintIssues: [],
  }
}

beforeEach(() => {
  useProjectStore.setState({
    currentProject: {
      id: 'review-chapter',
      name: 'Review',
      path: PROJECT_PATH,
      sessionLease: PROJECT_SESSION.leaseId,
      novelConfig: { globalGuidance: '', wordsPerChapter: 3000 },
    } as never,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useProjectStore.setState({ currentProject: null })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
})

describe('ReviewChapterCommand bound-chapter resolution', () => {
  it('reviews the draft-bound chapter, never the displayed chapter, and keeps the frozen v2 revision when the blueprint changes mid-review', async () => {
    const source = '顾舟扣紧安全带，按下录音键，屏幕亮起红色计时。'
    // The displayed chapter is 3; the DB draft is explicitly bound to blueprint chapter 7.
    const frozen = fixtureDetail({ chapterNumber: 7, revision: 4, marker: 'BOUND_BLUEPRINT_REVISION_4' })
    // Decoy: the displayed chapter 3 really has its own blueprint; it must never be read.
    const decoy = fixtureDetail({ chapterNumber: 3, revision: 9, marker: 'DISPLAYED_CHAPTER_BLUEPRINT_DECOY' })
    const newer = { ...frozen.detail, revision: 5, contentHash: 'b'.repeat(64) }
    let currentDetail: ChapterBlueprintV2DetailRead = frozen.detail
    const reportPayloads: Array<{ content: string }> = []
    const blueprintReads: unknown[] = []
    const continuityChapterReads: unknown[] = []
    let observedPrompt = ''

    const completeWithLease = vi.fn<GenerationRuntimeEnvironment['completeWithLease']>(async request => {
      // The blueprint is revised while the model call is in flight.
      currentDetail = newer
      observedPrompt = request.messages.map(message => message.content).join('\n')
      return {
        content: JSON.stringify({
          ...JSON.parse(PASSING_REVIEW_JSON),
          blueprintReview: blueprintReviewPayload(frozen.firstSceneId),
        }),
        finishReason: 'stop',
      }
    })

    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:draft-get-meta') {
        expect(args[0]).toBe(5)
        return { id: 5, chapterNumber: 3, version: 2, status: 'draft', source: 'write' }
      }
      if (channel === 'db:draft-get-full') {
        return {
          id: 5,
          chapterNumber: 3,
          blueprintChapterNumber: 7,
          version: 2,
          status: 'draft',
          content: source,
        }
      }
      if (channel === 'db:blueprint-get') {
        blueprintReads.push(args[0])
        return args[0] === 3
          ? { chapterNumber: 3, title: '显示章蓝图', role: '发展', purpose: '误导', keyEvents: 'DISPLAYED_CHAPTER', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' }
          : { chapterNumber: 7, title: '绑定章', role: '发展', purpose: '绑定章用途', keyEvents: '', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' }
      }
      if (channel === 'db:blueprint-v2-get') {
        blueprintReads.push(args[0])
        if (args[0] === 3) return decoy.detail
        return currentDetail
      }
      if (channel === 'db:continuity-list-before') {
        continuityChapterReads.push(args[0])
        return []
      }
      if (channel === 'db:project-core-get' || channel === 'db:character-get-all'
        || channel === 'db:blueprint-get-all'
        || channel === 'db:blueprint-list-summary' || channel === 'db:blueprint-v2-summary-list'
        || channel === 'db:consistency-exemption-list') return []
      if (channel === 'db:review-create') {
        reportPayloads.push(args[0] as { content: string })
        return { success: true, id: 77, reviewIndex: 1 }
      }
      throw new Error(`unexpected IPC: ${channel}`)
    })
    stubIpc(invoke)

    await reviewCommand(completeWithLease, {
      draftPath: 'vela://draft/5',
      draftContent: source,
      chapterNumber: 3,
    }).execute({ step: {}, context: workflowContext(), callbacks: callbacks() })

    // Every blueprint read used the bound chapter, not the displayed one.
    expect(blueprintReads).toEqual([7, 7])
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:blueprint-v2-get'))
      .toEqual([['db:blueprint-v2-get', 7, PROJECT_PATH, PROJECT_SESSION]])
    // Continuity is read twice, each with its own correct chapter: the review
    // context uses the manuscript position (displayed chapter 3), while the
    // consistency preflight follows the bound blueprint chapter 7.
    expect(continuityChapterReads).toEqual([3, 7])

    // The prompt carried the revision read before generation, not the revision
    // that appeared while the model was running.
    expect(observedPrompt).toContain('BOUND_BLUEPRINT_REVISION_4')
    expect(observedPrompt).not.toContain('BOUND_BLUEPRINT_REVISION_5')
    expect(observedPrompt).not.toContain('DISPLAYED_CHAPTER_BLUEPRINT_DECOY')
    expect(currentDetail.revision).toBe(5)

    // The persisted report still cites the frozen {chapterNumber, revision, contentHash}.
    expect(reportPayloads).toHaveLength(1)
    const report = JSON.parse(reportPayloads[0]!.content)
    expect(report.blueprintEvidence).toEqual({
      chapterNumber: 7,
      revision: 4,
      contentHash: frozen.detail.contentHash,
    })
    expect(report.blueprintReview.evidence).toEqual(report.blueprintEvidence)
    expect(report.blueprintReview.evidence).not.toEqual({
      chapterNumber: 3,
      revision: 9,
      contentHash: decoy.detail.contentHash,
    })
    expect(report.blueprintReviewUnavailable).toBeUndefined()

    // The saved report is bound to the stored draft, not to the displayed chapter.
    expect(invoke).toHaveBeenCalledWith('db:review-create', expect.objectContaining({
      baseDraftId: 5,
      expectedSource: {
        id: 5,
        chapterNumber: 3,
        version: 2,
        status: 'draft',
        content: source,
      },
    }), PROJECT_PATH, PROJECT_SESSION)
  })

  it('does not infer a bound blueprint from the displayed chapter when the draft has no binding', async () => {
    const source = '江面上的浮标逐个熄灭。'
    const blueprintReads: unknown[] = []
    let observedPrompt = ''
    const completeWithLease = vi.fn<GenerationRuntimeEnvironment['completeWithLease']>(async request => {
      observedPrompt = request.messages.map(message => message.content).join('\n')
      return { content: PASSING_REVIEW_JSON, finishReason: 'stop' }
    })
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:draft-get-meta') {
        return { id: 8, chapterNumber: 4, version: 1, status: 'draft', source: 'write' }
      }
      if (channel === 'db:draft-get-full') {
        // No blueprintChapterNumber: the draft is not bound to any blueprint.
        return { id: 8, chapterNumber: 4, version: 1, status: 'draft', content: source }
      }
      if (channel === 'db:blueprint-get' || channel === 'db:blueprint-v2-get') {
        blueprintReads.push([channel, args[0]])
        return null
      }
      if (channel === 'db:project-core-get' || channel === 'db:character-get-all'
        || channel === 'db:continuity-list-before' || channel === 'db:blueprint-get-all'
        || channel === 'db:blueprint-list-summary' || channel === 'db:blueprint-v2-summary-list'
        || channel === 'db:consistency-exemption-list') return []
      if (channel === 'db:review-create') return { success: true, id: 78, reviewIndex: 1 }
      throw new Error(`unexpected IPC: ${channel}`)
    })
    stubIpc(invoke)

    await reviewCommand(completeWithLease, {
      draftPath: 'vela://draft/8',
      draftContent: source,
      chapterNumber: 4,
    }).execute({ step: {}, context: workflowContext(), callbacks: callbacks() })

    expect(blueprintReads).toEqual([])
    expect(observedPrompt).toContain('草稿未绑定章节蓝图，未按显示章号推测')
  })

  it('records an unavailable blueprint review instead of fabricating one when the bound v2 detail is corrupt', async () => {
    const source = '灯塔第三次转暗。'
    const reportPayloads: Array<{ content: string }> = []
    const completeWithLease = vi.fn<GenerationRuntimeEnvironment['completeWithLease']>()
      .mockResolvedValue({ content: PASSING_REVIEW_JSON, finishReason: 'stop' })
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:draft-get-meta') {
        return { id: 9, chapterNumber: 6, version: 3, status: 'draft', source: 'write' }
      }
      if (channel === 'db:draft-get-full') {
        return {
          id: 9,
          chapterNumber: 6,
          blueprintChapterNumber: 12,
          version: 3,
          status: 'draft',
          content: source,
        }
      }
      if (channel === 'db:blueprint-get') {
        expect(args[0]).toBe(12)
        return { chapterNumber: 12, title: '绑定章', role: '发展', purpose: '用途', keyEvents: '', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' }
      }
      if (channel === 'db:blueprint-v2-get') {
        expect(args[0]).toBe(12)
        // Real contract (blueprint-detail-repository.ts): a corrupt detail_json is
        // reported as a Detail-shaped read plus readStatus/rawMarkdown, never as a
        // bare status object, so the stored revision/hash still travel with it.
        return {
          schemaVersion: 2,
          chapterNumber: 12,
          chapterTitle: '',
          docPreamble: '',
          sections: [],
          origin: 'import',
          revision: 6,
          contentHash: 'c'.repeat(64),
          createdAt: '',
          updatedAt: '',
          readStatus: 'corrupt',
          rawMarkdown: 'CORRUPT_BLUEPRINT_RAW_MARKDOWN',
        }
      }
      if (channel === 'db:project-core-get' || channel === 'db:character-get-all'
        || channel === 'db:continuity-list-before' || channel === 'db:blueprint-get-all'
        || channel === 'db:blueprint-list-summary' || channel === 'db:blueprint-v2-summary-list'
        || channel === 'db:consistency-exemption-list') return []
      if (channel === 'db:review-create') {
        reportPayloads.push(args[0] as { content: string })
        return { success: true, id: 79, reviewIndex: 1 }
      }
      throw new Error(`unexpected IPC: ${channel}`)
    })
    stubIpc(invoke)

    await reviewCommand(completeWithLease, {
      draftPath: 'vela://draft/9',
      draftContent: source,
      chapterNumber: 6,
    }).execute({ step: {}, context: workflowContext(), callbacks: callbacks() })

    const report = JSON.parse(reportPayloads[0]!.content)
    expect(report.blueprintReviewUnavailable).toBe('corrupt')
    expect(report.blueprintReview).toBeUndefined()
    expect(report.blueprintEvidence).toBeUndefined()
  })
})
