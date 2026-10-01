import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { ProjectData } from '../../../shared/ipc-channels'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import type { NarrativeThreadCandidateGenerator } from '../../../services/narrative-thread-candidate-generator'
import { PlotTreeSourceLimitError } from '../../../services/plot-tree-generator'
import NarrativeThreadEditor from '../NarrativeThreadEditor'

const PROJECT_PATH = 'C:\\novels\\narrative-thread'
let root: Root | undefined
let container: HTMLDivElement | undefined
let plans: Array<Record<string, unknown>> = []
let eventFailure = ''
let plotSources: Record<string, unknown>
let plotSaveResponse: Record<string, unknown> | null = null
let plotSaveReject: string | null = null
let plotSaveBarrier: Promise<void> | null = null
let plotClearResponse: Record<string, unknown> | null = null
let invoke: ReturnType<typeof vi.fn>
const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalLLMState = useLLMStore.getState()
const originalEditorState = useEditorStore.getState()
const originalGlobalLogs = useWorkflowStore.getState().globalLogs

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.includes(label))
  if (!button) throw new Error(`找不到按钮：${label}`)
  return button
}

function alertTexts(root: ParentNode): Array<string | null> {
  return Array.from(root.querySelectorAll('[role="alert"]')).map(element => element.textContent)
}

/** 事件列表损坏（非数组）时的资料包：仍然是一条可用的叙事线索来源。 */
function corruptedThreadSources(): Record<string, unknown> {
  return {
    ...plotSources,
    narrativeThreads: [{
      id: 1, title: '损坏的支线', type: '伏笔', targetStartChapter: 2, targetEndChapter: 4,
      authorIntent: '数据库中的事件列表已损坏。', status: 'planned', events: undefined,
    }],
  }
}

function installIpc() {
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:draft-get-max-finalized-chapter') return 3
    if (channel === 'db:draft-list-all') return [{ id: 7, chapterNumber: 1, version: 1, status: 'finalized', source: 'write', contentId: 1, wordCount: 8, createdAt: '', updatedAt: '' }]
    if (channel === 'db:draft-get-full') return { id: 7, content: '门上出现刻痕。林岚没有声张。' }
    if (channel === 'db:blueprint-list-summary') return [{
      chapterNumber: 2, title: '刻痕之谜', purpose: '引出幕后对手',
      keyEvents: '林岚再次发现相同刻痕。',
    }]
    if (channel === 'db:blueprint-v2-summary-list') return [{
      chapterNumber: 2, revision: 1, contentHash: 'a'.repeat(64), origin: 'imported',
      updatedAt: '', sceneCount: 2, sceneTitles: ['门框上的刻痕', '目击者改口'], wordBudget: null,
    }]
    if (channel === 'db:narrative-thread-list') return plans
    if (channel === 'db:plot-tree-read') return plotSources
    if (channel === 'db:plot-tree-save') {
      if (plotSaveBarrier) await plotSaveBarrier
      if (plotSaveReject) throw new Error(plotSaveReject)
      if (plotSaveResponse) return plotSaveResponse
      plotSources = { ...plotSources, snapshot: args[0] }
      return { success: true, snapshot: args[0] }
    }
    if (channel === 'db:plot-tree-clear') {
      if (plotClearResponse) return plotClearResponse
      plotSources = { ...plotSources, snapshot: null }
      return { success: true }
    }
    if (channel === 'db:narrative-thread-plan-create') {
      const input = args[0] as Record<string, unknown>
      plans = [{ ...input, id: 1, status: 'planned', dormantChapters: 2, overdue: false, events: [], createdAt: '', updatedAt: '' }]
      return { success: true, plan: plans[0] }
    }
    if (channel === 'db:narrative-thread-plan-update') {
      plans = [{ ...plans[0], ...(args[1] as Record<string, unknown>) }]
      return { success: true, plan: plans[0] }
    }
    if (channel === 'db:narrative-thread-plan-delete') {
      plans = []
      return { success: true }
    }
    if (channel === 'db:narrative-thread-event-confirm') {
      if (eventFailure) return { success: false, error: eventFailure }
      plans = [{ ...plans[0], status: 'planted', events: [{ id: 1, planId: 1, draftId: 7, chapterNumber: 1, chapterTitle: '第一章', type: 'planted', evidence: '门上出现刻痕。', reason: '埋设入口。', createdAt: '' }] }]
      return { success: true, event: (plans[0]?.events as unknown[])[0] }
    }
    throw new Error(`unexpected IPC ${channel}`)
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
}

beforeEach(() => {
  plans = []
  eventFailure = ''
  plotSaveResponse = null
  plotSaveReject = null
  plotSaveBarrier = null
  plotClearResponse = null
  plotSources = {
    writingLanguage: 'zh-CN',
    synopsis: { content: '林岚追查被篡改的航海日志。' },
    blueprints: [{
      chapterNumber: 2, title: '刻痕之谜', purpose: '引出幕后对手', keyEvents: '林岚再次发现相同刻痕。',
    }],
    finalizedChapters: [],
    narrativeThreads: [],
    sourceRevision: 'a'.repeat(64),
    snapshot: {
      version: 1,
      generatedAt: '2026-09-02T08:00:00.000Z',
      writingLanguage: 'zh-CN',
      sourceRevision: 'b'.repeat(64),
      tracks: [{
        id: 'main-old', title: '旧航海日志', role: 'main', startChapter: 1, endChapter: 3,
        summary: '追查日志的真相。',
        events: [{
          status: 'planned', chapterNumber: 2, summary: '发现第二处刻痕',
          sources: [{ type: 'blueprint', chapterNumber: 2 }],
        }],
      }],
    },
  }
  useLocaleStore.setState({ locale: 'zh-CN' })
  const project: ProjectData = {
    id: 'thread-project', sessionLease: 'thread-lease', name: '线索测试', path: PROJECT_PATH,
    novelConfig: { genre: '', subGenre: '', targetAudience: '', totalChapters: 10, wordsPerChapter: 2000, plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '' },
    characterStates: '', createdAt: '', updatedAt: '',
  }
  useProjectStore.setState({ currentProject: project, fileTree: [], loading: false })
  useLLMStore.setState({
    models: [
      { id: 'glm', name: 'GLM', provider: 'bigmodel', protocol: 'openai', modelName: 'glm', apiKey: 'fixture', baseUrl: 'https://example.invalid', temperature: 0.7, maxTokens: 4096, purposes: ['generation'] },
      { id: 'grok', name: 'Grok', provider: 'xai', protocol: 'openai', modelName: 'grok', apiKey: 'fixture', baseUrl: 'https://example.invalid', temperature: 0.7, maxTokens: 4096, purposes: ['generation'] },
      { id: 'embed', name: 'Embedding', provider: 'openai', protocol: 'openai', modelName: 'embed', apiKey: 'fixture', baseUrl: 'https://example.invalid', temperature: 0, maxTokens: 4096, purposes: ['embedding'] },
    ],
    defaultModelId: 'glm',
    loaded: true,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useWorkflowStore.setState({ globalLogs: [] })
  setActiveProjectSessionContext({ projectId: project.id, leaseId: project.sessionLease!, projectPath: PROJECT_PATH })
  installIpc()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useProjectStore.setState(originalProjectState)
  useLocaleStore.setState(originalLocaleState)
  useLLMStore.setState(originalLLMState)
  useEditorStore.setState(originalEditorState)
  useWorkflowStore.setState({ globalLogs: originalGlobalLogs })
})

describe('NarrativeThreadEditor', () => {
  it('rebuilds the plot tree deterministically from stored sources and keeps plans in the same editor', async () => {
    // 生成器属性仍被接受，但确定性投影绝不调用它。
    const unusedGenerator = vi.fn()

    await act(async () => root?.render(
      <NarrativeThreadEditor
        projectKey={PROJECT_PATH}
        initialView="plot-tree"
        plotTreeGenerator={unusedGenerator}
      />,
    ))
    await vi.waitFor(() => {
      expect(container?.textContent).toContain('旧航海日志')
      expect(container?.textContent).toContain('章节蓝图或正文资料已更新，可点击「重建剧情树」刷新时间线。')
    })

    await act(async () => findButton(container!, '重建剧情树').click())

    await vi.waitFor(() => {
      expect(container?.textContent).toContain('刻痕之谜：引出幕后对手')
      expect(container?.textContent).not.toContain('章节蓝图或正文资料已更新')
    })
    expect(unusedGenerator).not.toHaveBeenCalled()
    expect(useLLMStore.getState().defaultModelId).toBe('glm')

    const saveCall = invoke.mock.calls.find(([channel]) => channel === 'db:plot-tree-save')
    expect(saveCall?.[1]).toMatchObject({
      version: 1,
      writingLanguage: 'zh-CN',
      sourceRevision: 'a'.repeat(64),
      tracks: [expect.objectContaining({
        id: 'track-main', title: '主线', role: 'main', startChapter: 2, endChapter: 2,
      })],
    })
    expect(saveCall?.[2]).toBe('a'.repeat(64))
    expect(saveCall?.[3]).toBe(PROJECT_PATH)
    expect(saveCall?.[4]).toMatchObject({
      projectId: 'thread-project',
      leaseId: 'thread-lease',
      projectPath: PROJECT_PATH,
    })

    // 事件 → 来源 → 章节蓝图：对话框经 portal 渲染到 body。
    await act(async () => findButton(container!, '刻痕之谜：引出幕后对手').click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('第 2 章 剧情事件'))
    await act(async () => findButton(document.body, '第 2 章蓝图').click())
    expect(useEditorStore.getState().tabs).toContainEqual(expect.objectContaining({
      type: 'chapter-card',
      chapterNumber: 2,
    }))

    await act(async () => findButton(container!, '计划清单').click())
    await vi.waitFor(() => expect(container?.textContent).toContain('新建计划'))
  })

  it('keeps sparse and long plot histories inside a bounded chapter window', async () => {
    const eventChapters = [1, ...Array.from({ length: 130 }, (_, index) => index + 2), 10_000]
    plotSources = {
      ...plotSources,
      snapshot: {
        version: 1,
        generatedAt: '2026-09-03T08:00:00.000Z',
        writingLanguage: 'zh-CN',
        sourceRevision: 'a'.repeat(64),
        tracks: [{
          id: 'long-main', title: '长篇主线', role: 'main', startChapter: 1, endChapter: 10_000,
          summary: '跨越稀疏章节的主线。',
          events: eventChapters.map(chapterNumber => ({
            status: 'planned', chapterNumber, summary: `事件 ${chapterNumber}`,
            sources: [{ type: 'narrative-thread', planId: 9 }],
          })),
        }],
      },
    }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('长篇主线'))

    expect(container!.querySelectorAll('thead th')).toHaveLength(41)
    expect(container?.textContent).toContain('第 1 章')
    expect(container?.textContent).not.toContain('第 10000 章')
    await act(async () => Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('下一组章节'))?.click())
    expect(container?.textContent).toContain('第 41 章')
  })

  it('shows an actionable no-source message and does not call the generator', async () => {
    plotSources = {
      ...plotSources,
      blueprints: [],
      finalizedChapters: [],
      narrativeThreads: [],
      snapshot: null,
    }
    const plotTreeGenerator = vi.fn()

    await act(async () => root?.render(
      <NarrativeThreadEditor
        projectKey={PROJECT_PATH}
        initialView="plot-tree"
        plotTreeGenerator={plotTreeGenerator}
      />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('请先添加章节蓝图、定稿或叙事线索'))

    const generate = Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成剧情树'))
    expect(generate?.disabled).toBe(true)
    generate?.click()
    expect(plotTreeGenerator).not.toHaveBeenCalled()
  })

  it('reports an isolated invalid stored snapshot without hiding the author sources', async () => {
    plotSources = {
      ...plotSources,
      snapshot: null,
      storedSnapshotInvalid: true,
    }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))

    await vi.waitFor(() => expect(container?.textContent).toContain('旧剧情树快照无法安全显示'))
    expect(container?.textContent).toContain('生成剧情树')
    expect(plotSources.blueprints).toHaveLength(1)
  })

  it('does not mark a snapshot stale when its source revision still matches', async () => {
    plotSources = {
      ...plotSources,
      snapshot: {
        ...(plotSources.snapshot as Record<string, unknown>),
        generatedAt: '2026-09-01T08:00:00.000Z',
        sourceRevision: 'a'.repeat(64),
      },
    }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    expect(container?.textContent).not.toContain('章节蓝图或正文资料已更新')
  })

  it('keeps a legacy snapshot without a revision visible and marks it stale', async () => {
    const legacySnapshot = { ...(plotSources.snapshot as Record<string, unknown>) }
    delete legacySnapshot.sourceRevision
    plotSources = { ...plotSources, snapshot: legacySnapshot }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    expect(container?.textContent).toContain('章节蓝图或正文资料已更新，可点击「重建剧情树」刷新时间线。')
  })

  it('keeps the previous plot tree when the rebuild fails and shows a safe fallback', async () => {
    plotSources = corruptedThreadSources()

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, '重建剧情树').click())

    await vi.waitFor(() => expect(container?.textContent).toContain('剧情树重建失败。'))
    expect(container?.textContent).toContain('旧航海日志')
    expect(container?.textContent).not.toContain('iterable')
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:plot-tree-save')).toBe(false)
  })

  it.each([
    ['zh-CN', '重建剧情树', '无法保存剧情树。'],
    ['en-US', 'Rebuild Plot Tree', 'Could not save the plot tree.'],
  ] as const)('explains a rejected snapshot save in %s without replacing the snapshot', async (locale, buttonText, expected) => {
    useLocaleStore.setState({ locale })
    plotSaveReject = 'PRIVATE_DATABASE_FAILURE'

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, buttonText).click())

    await vi.waitFor(() => expect(container?.textContent).toContain(expected))
    expect(container?.textContent).toContain('旧航海日志')
    expect(container?.textContent).not.toContain('PRIVATE_DATABASE_FAILURE')
    expect(document.body.textContent).not.toContain('PRIVATE_DATABASE_FAILURE')
    expect((plotSources.snapshot as Record<string, unknown>).generatedAt).toBe('2026-09-02T08:00:00.000Z')
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:plot-tree-save')).toBe(true)
  })

  it('shows an English rebuild reason for a Chinese project without leaking the raw failure', async () => {
    useLocaleStore.setState({ locale: 'en-US' })
    plotSaveResponse = {
      success: false,
      error: '剧情树输出达到模型最大长度，结果未保存，请提高最大输出 Tokens 或缩短项目资料。',
    }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    expect(plotSources.writingLanguage).toBe('zh-CN')
    await act(async () => findButton(container!, 'Rebuild Plot Tree').click())

    await vi.waitFor(() => expect(container?.textContent).toContain('Could not save the plot tree.'))
    // 确定性投影不再产生任何模型输出文案，原始失败原因也不得泄露。
    expect(container?.textContent).not.toContain('剧情树输出达到模型最大长度')
    expect(container?.textContent).not.toContain('Plot-tree output reached the model maximum output length')
    expect(document.body.textContent).not.toContain('剧情树输出达到模型最大长度')
    expect(useWorkflowStore.getState().globalLogs.map(log => log.message).join('\n'))
      .not.toContain('剧情树输出达到模型最大长度')
  })

  it.each([
    ['a rejected save that carries provider output', { reject: 'PRIVATE_MODEL_OUTPUT' }],
    ['a save failure that carries provider output', { response: { success: false, error: 'PRIVATE_MODEL_OUTPUT' } }],
  ] as const)('localizes %s without exposing it', async (_label, failure) => {
    useLocaleStore.setState({ locale: 'en-US' })
    if ('reject' in failure) plotSaveReject = failure.reject
    else plotSaveResponse = { ...failure.response }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, 'Rebuild Plot Tree').click())

    // 失败只通过内联 role=alert 的安全文案上报，原始内容既不入 UI 也不入日志。
    await vi.waitFor(() => expect(alertTexts(container!)).toContain('Could not save the plot tree.'))
    expect(container?.textContent).toContain('旧航海日志')
    expect(container?.textContent).not.toContain('PRIVATE_MODEL_OUTPUT')
    expect(document.body.textContent).not.toContain('PRIVATE_MODEL_OUTPUT')
    expect(useWorkflowStore.getState().globalLogs.map(log => log.message).join('\n'))
      .not.toContain('PRIVATE_MODEL_OUTPUT')
  })

  it.each([
    ['a generator that would resolve', () => vi.fn()],
    ['a generator that would reject with a source limit', () => vi.fn().mockRejectedValue(new PlotTreeSourceLimitError(200))],
  ] as const)('rebuilds deterministically and never calls the injected generator: %s', async (_label, buildGenerator) => {
    const plotTreeGenerator = buildGenerator()

    await act(async () => root?.render(
      <NarrativeThreadEditor
        projectKey={PROJECT_PATH}
        initialView="plot-tree"
        plotTreeGenerator={plotTreeGenerator}
      />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, '重建剧情树').click())

    await vi.waitFor(() => expect(container?.textContent).toContain('刻痕之谜：引出幕后对手'))
    expect(plotTreeGenerator).not.toHaveBeenCalled()
    expect(container?.textContent).not.toContain('剧情树完整来源上限')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:plot-tree-save')).toHaveLength(1)
  })

  it('keeps the UI locale that was active when the rebuild started', async () => {
    useLocaleStore.setState({ locale: 'en-US' })
    plotSaveResponse = { success: false, error: 'ignored' }
    let finishRequest: (() => void) | undefined
    plotSaveBarrier = new Promise<void>((resolve) => { finishRequest = resolve })

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, 'Rebuild Plot Tree').click())
    await vi.waitFor(() => expect(
      invoke.mock.calls.some(([channel]) => channel === 'db:plot-tree-save'),
    ).toBe(true))

    useLocaleStore.setState({ locale: 'zh-CN' })
    await act(async () => finishRequest?.())

    await vi.waitFor(() => expect(container?.textContent).toContain('Could not save the plot tree.'))
    expect(container?.textContent).not.toContain('无法保存剧情树。')
  })

  it('shows known save and rebuild failures in English', async () => {
    useLocaleStore.setState({ locale: 'en-US' })
    plotSaveResponse = { success: false, error: 'PRIVATE_PROJECT_CONTENT' }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, 'Rebuild Plot Tree').click())
    await vi.waitFor(() => expect(alertTexts(container!)).toContain('Could not save the plot tree.'))
    expect(container?.textContent).not.toContain('PRIVATE_PROJECT_CONTENT')
    expect(container?.textContent).toContain('旧航海日志')

    // 让组件重新读取损坏的资料，再验证未知失败走英文兜底文案。
    plotSaveResponse = null
    plotSources = corruptedThreadSources()
    await act(async () => findButton(container!, 'Plan list').click())
    await vi.waitFor(() => expect(container?.textContent).toContain('No foreshadowing or narrative threads yet'))
    await act(async () => findButton(container!, 'Thread graph').click())
    await vi.waitFor(() => expect(
      invoke.mock.calls.filter(([channel]) => channel === 'db:plot-tree-read'),
    ).toHaveLength(2))

    await act(async () => findButton(container!, 'Rebuild Plot Tree').click())
    await vi.waitFor(() => expect(alertTexts(container!)).toContain('Could not rebuild the plot tree.'))
    expect(container?.textContent).not.toContain('Could not save the plot tree.')
    expect(container?.textContent).toContain('旧航海日志')
    expect(container?.textContent).not.toContain('iterable')
  })

  it.each([
    'Error: 剧情树快照清除失败',
    'Error: 项目数据库未打开',
  ])('shows a known clear failure in Chinese: %s', async (error) => {
    plotClearResponse = { success: false, error }
    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))

    await act(async () => Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('清除剧情树'))?.click())

    await vi.waitFor(() => expect(container?.textContent).toContain('无法清除剧情树。'))
  })

  it('clears the derived plot-tree snapshot through the current project session', async () => {
    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))

    await act(async () => Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('清除剧情树'))?.click())

    await vi.waitFor(() => expect(container?.textContent).toContain('尚未生成剧情树'))
    expect(invoke).toHaveBeenCalledWith(
      'db:plot-tree-clear',
      PROJECT_PATH,
      expect.objectContaining({ projectId: 'thread-project', leaseId: 'thread-lease' }),
    )
    expect(plotSources).toMatchObject({
      synopsis: { content: '林岚追查被篡改的航海日志。' },
      blueprints: [{ chapterNumber: 2 }],
      snapshot: null,
    })
  })

  it('reloads changed sources after the save rejects the rebuilt snapshot as stale', async () => {
    plotSaveResponse = {
      success: false,
      errorCode: 'sources-changed',
      error: 'PRIVATE_PROJECT_CONTENT',
    }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))
    await act(async () => findButton(container!, '重建剧情树').click())

    await vi.waitFor(() => expect(container?.textContent)
      .toContain('剧情资料在生成期间已更新，本次结果未保存，请重新生成。'))
    expect(container?.textContent).toContain('旧航海日志')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:plot-tree-read')).toHaveLength(2)
    expect(container?.textContent).not.toContain('PRIVATE_PROJECT_CONTENT')
    expect(document.body.textContent).not.toContain('PRIVATE_PROJECT_CONTENT')
    expect(useWorkflowStore.getState().globalLogs.map(log => log.message).join('\n'))
      .not.toContain('PRIVATE_PROJECT_CONTENT')
  })

  it('keeps the plot-tree view usable with no generation model configured', async () => {
    useLLMStore.setState({ models: [], defaultModelId: null })

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('旧航海日志'))

    // 确定性剧情树不需要任何模型：既没有模型选择器，也不受「模型不可用」影响。
    expect(container!.querySelector('#plot-tree-model')).toBeNull()
    expect(container!.querySelectorAll('select')).toHaveLength(0)
    expect(container?.textContent).not.toContain('已不可用')
    const rebuild = findButton(container!, '重建剧情树')
    expect(rebuild.hasAttribute('disabled')).toBe(false)
    await act(async () => rebuild.click())
    await vi.waitFor(() => expect(container?.textContent).toContain('刻痕之谜：引出幕后对手'))
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:plot-tree-save')).toHaveLength(1)

    // 计划清单里的 AI 分析模型选择器仍会解释「没有可用生成模型」。
    await act(async () => findButton(container!, '计划清单').click())
    await vi.waitFor(() => expect(container?.textContent).toContain('AI 建议伏笔与线索'))
    await act(async () => findButton(container!, 'AI 建议伏笔与线索').click())
    await vi.waitFor(() => expect(document.body.textContent)
      .toContain('没有已配置且可用于文本生成的模型。请先在设置中添加生成模型。'))
    expect(document.body.querySelector<HTMLSelectElement>('#narrative-thread-ai-model')?.disabled).toBe(true)
  })

  it('opens the narrative plan referenced by a plot-tree event', async () => {
    plans = [{
      id: 9, title: '被篡改的日志', type: '伏笔', targetStartChapter: 2,
      targetEndChapter: 4, authorIntent: '第四章揭示篡改者。', status: 'planned',
      dormantChapters: 0, overdue: false, events: [], createdAt: '', updatedAt: '',
    }]
    plotSources = {
      ...plotSources,
      narrativeThreads: plans,
      snapshot: {
        version: 1,
        generatedAt: '2026-09-03T08:00:00.000Z',
        writingLanguage: 'zh-CN',
        sourceRevision: 'a'.repeat(64),
        tracks: [{
          id: 'subplot-log', title: '日志伏笔', role: 'subplot', parentTrackId: 'main-old',
          startChapter: 2, endChapter: 4, summary: '日志真相等待回收。',
          events: [{
            status: 'planned', chapterNumber: 2, summary: '日志线索出现',
            sources: [{ type: 'narrative-thread', planId: 9 }],
          }],
        }, {
          id: 'main-old', title: '主线', role: 'main', startChapter: 1, endChapter: 4,
          summary: '追查日志。', events: [{
            status: 'planned', chapterNumber: 2, summary: '开始追查',
            sources: [{ type: 'blueprint', chapterNumber: 2 }],
          }],
        }],
      },
    }

    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plot-tree" />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('日志线索出现'))
    await act(async () => findButton(container!, '日志线索出现').click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('来源引用与回跳入口'))
    expect(document.body.textContent).toContain('叙事线索 #9')
    await act(async () => findButton(document.body, '叙事线索 #9').click())

    await vi.waitFor(() => expect(container?.querySelector('#narrative-plan-9')?.textContent)
      .toContain('被篡改的日志'))
    expect(container?.querySelector<HTMLElement>('#narrative-plan-9')?.style.borderColor)
      .toBe('var(--color-accent)')
  })

  it('creates a plan and confirms an event from a finalized chapter', async () => {
    await act(async () => root?.render(<NarrativeThreadEditor projectKey={PROJECT_PATH} />))
    await vi.waitFor(() => expect(container?.textContent).toContain('暂无伏笔或叙事线索'))

    const fields = container!.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setValue(fields[0]!, '门上的刻痕')
      setValue(fields[1]!, '伏笔')
      setValue(container!.querySelector<HTMLTextAreaElement>('textarea')!, '第三章揭示来源。')
    })
    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('保存计划'))?.click())
    await vi.waitFor(() => expect(container?.textContent).toContain('门上的刻痕'))

    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('确认定稿事件'))?.click())
    const eventEvidence = container!.querySelector<HTMLInputElement>('input[placeholder="粘贴该定稿章节中的短原文"]')!
    const eventReason = container!.querySelector<HTMLInputElement>('input[placeholder="确认理由"]')!
    await act(async () => {
      setValue(eventEvidence, '门上出现刻痕。')
      setValue(eventReason, '确认第一章已埋设。')
    })
    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('保存事件'))?.click())
    await vi.waitFor(() => expect(container?.textContent).toContain('门上出现刻痕。'))

    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('编辑'))?.click())
    const title = container!.querySelectorAll<HTMLInputElement>('input')[0]!
    await act(async () => setValue(title, '门上的三道刻痕'))
    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('保存计划'))?.click())
    await vi.waitFor(() => expect(container?.textContent).toContain('门上的三道刻痕'))

    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('删除'))?.click())
    await vi.waitFor(() => expect(container?.textContent).toContain('暂无伏笔或叙事线索'))
  })

  it('renders status history and actions in English after rebuilding the view', async () => {
    useLocaleStore.setState({ locale: 'en-US' })
    plans = [{
      id: 2, title: 'The altered logbook', type: 'Promise', targetStartChapter: 1,
      targetEndChapter: 3, authorIntent: 'Reveal the forger.', status: 'progressing',
      dormantChapters: 2, overdue: false, createdAt: '', updatedAt: '',
      events: [{ id: 2, planId: 2, draftId: 7, chapterNumber: 1, chapterTitle: 'Departure', type: 'planted', evidence: 'The seal was broken.', reason: 'Establish the clue.', createdAt: '' }],
    }]

    await act(async () => root?.render(<NarrativeThreadEditor projectKey={PROJECT_PATH} />))

    await vi.waitFor(() => {
      expect(container?.textContent).toContain('Plot tree & narrative threads')
      expect(container?.textContent).toContain('Progressing')
      expect(container?.textContent).toContain('Chapter 1')
      expect(container?.textContent).toContain('Confirm finalized event')
    })
  })

  it('explains the evidence boundary and shows only the controlled actionable failure', async () => {
    plans = [{
      id: 3, title: '门上的刻痕', type: '伏笔', targetStartChapter: 1, targetEndChapter: 3,
      authorIntent: '第三章解释来源。', status: 'planned', dormantChapters: 0, overdue: false,
      createdAt: '', updatedAt: '', events: [],
    }]
    eventFailure = 'Error: 短证据必须来自绑定的定稿正文；C:\\private\\novel.txt'
    await act(async () => root?.render(<NarrativeThreadEditor projectKey={PROJECT_PATH} />))
    await vi.waitFor(() => expect(container?.textContent).toContain('门上的刻痕'))
    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('确认定稿事件'))?.click())

    expect(container!.querySelector<HTMLInputElement>('input[placeholder="粘贴该定稿章节中的短原文"]')).not.toBeNull()
    await act(async () => {
      setValue(container!.querySelector<HTMLInputElement>('input[placeholder="粘贴该定稿章节中的短原文"]')!, '不存在的片段')
      setValue(container!.querySelector<HTMLInputElement>('input[placeholder="确认理由"]')!, '人工确认。')
    })
    await act(async () => Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('保存事件'))?.click())

    await vi.waitFor(() => expect(container?.textContent).toContain('请粘贴所选定稿章节中实际出现的短原文'))
    expect(container?.textContent).not.toContain('private')
    expect(container?.textContent).not.toContain('novel.txt')
  })

  it('keeps blueprint AI output in memory until the author confirms a plan with the frozen model', async () => {
    const candidateGenerator: NarrativeThreadCandidateGenerator = {
      generatePlanCandidates: vi.fn().mockResolvedValue([{
        title: '门框上的刻痕', type: '伏笔', targetStartChapter: 2, targetEndChapter: 8,
        authorIntent: '模型声称已经埋设，但这里只能确认人工计划。',
      }]),
      generateEventCandidates: vi.fn().mockResolvedValue([]),
    }
    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} candidateGenerator={candidateGenerator} />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('AI 建议伏笔与线索'))

    await act(async () => Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('AI 建议伏笔与线索'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('本次识别模型'))
    const modelSelect = document.body.querySelector<HTMLSelectElement>('#narrative-thread-ai-model')!
    expect(Array.from(modelSelect.options).map(option => option.textContent)).toEqual(['请选择可用生成模型', 'GLM', 'Grok'])
    await act(async () => {
      modelSelect.value = 'grok'
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成候选'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('门框上的刻痕'))

    expect(candidateGenerator.generatePlanCandidates).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'grok',
      blueprint: expect.objectContaining({
        chapterNumber: 2,
        title: '刻痕之谜',
        sceneTitles: ['门框上的刻痕', '目击者改口'],
      }),
    }))
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:narrative-thread-plan-create')).toBe(false)
    expect(useLLMStore.getState().defaultModelId).toBe('glm')

    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('拒绝候选'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('门框上的刻痕'))
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:narrative-thread-plan-create')).toBe(false)

    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成候选'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('门框上的刻痕'))
    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认计划'))?.click())
    await vi.waitFor(() => expect(container?.textContent).toContain('门框上的刻痕'))

    const planCreate = invoke.mock.calls.find(([channel]) => channel === 'db:narrative-thread-plan-create')
    expect(planCreate?.[1]).toEqual({
      title: '门框上的刻痕', type: '伏笔', targetStartChapter: 2, targetEndChapter: 8,
      authorIntent: '模型声称已经埋设，但这里只能确认人工计划。',
    })
    expect(planCreate?.[1]).not.toHaveProperty('eventType')
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:narrative-thread-event-confirm')).toBe(false)
  })

  it('binds finalized-event AI candidates to the selected plan and draft until confirmation', async () => {
    plans = [{
      id: 4, title: '门上的刻痕', type: '伏笔', targetStartChapter: 1, targetEndChapter: 5,
      authorIntent: '第五章揭示来源。', status: 'planned', dormantChapters: 1, overdue: false,
      createdAt: '', updatedAt: '', events: [],
    }]
    const candidateGenerator: NarrativeThreadCandidateGenerator = {
      generatePlanCandidates: vi.fn().mockResolvedValue([]),
      generateEventCandidates: vi.fn().mockResolvedValue([{
        type: 'planted', evidence: '门上出现刻痕。', reason: '定稿正文已出现约定的视觉线索。',
      }]),
    }
    await act(async () => root?.render(
      <NarrativeThreadEditor projectKey={PROJECT_PATH} candidateGenerator={candidateGenerator} />,
    ))
    await vi.waitFor(() => expect(container?.textContent).toContain('门上的刻痕'))

    await act(async () => Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认定稿事件'))?.click())
    await act(async () => Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('AI 识别定稿事件'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('定稿事件候选'))
    const modelSelect = document.body.querySelector<HTMLSelectElement>('#narrative-thread-ai-model')!
    await act(async () => {
      modelSelect.value = 'grok'
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成候选'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('定稿正文已出现约定的视觉线索'))

    expect(candidateGenerator.generateEventCandidates).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'grok', draftId: 7, chapterNumber: 1,
      finalizedContent: '门上出现刻痕。林岚没有声张。',
      plan: expect.objectContaining({ id: 4, title: '门上的刻痕' }),
    }))
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:narrative-thread-event-confirm')).toBe(false)
    expect(useLLMStore.getState().defaultModelId).toBe('glm')

    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('拒绝候选'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('定稿正文已出现约定的视觉线索'))
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:narrative-thread-event-confirm')).toBe(false)

    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成候选'))?.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('定稿正文已出现约定的视觉线索'))
    await act(async () => Array.from(document.body.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认事件'))?.click())

    const eventConfirm = invoke.mock.calls.find(([channel]) => channel === 'db:narrative-thread-event-confirm')
    expect(eventConfirm?.[1]).toEqual({
      planId: 4, draftId: 7, type: 'planted', evidence: '门上出现刻痕。',
      reason: '定稿正文已出现约定的视觉线索。',
    })
  })

  it('updates the dormant reminder immediately from the current project threshold', async () => {
    const currentProject = useProjectStore.getState().currentProject!
    useProjectStore.setState({
      currentProject: {
        ...currentProject,
        novelConfig: { ...currentProject.novelConfig, narrativeThreadDormantChapterThreshold: 5 },
      },
    })
    plans = [{
      id: 5, title: '沉睡的航线', type: '悬念', targetStartChapter: 1, targetEndChapter: 8,
      authorIntent: '后续重新推进。', status: 'progressing', dormantChapters: 4, overdue: false,
      createdAt: '', updatedAt: '', events: [],
    }]
    await act(async () => root?.render(<NarrativeThreadEditor projectKey={PROJECT_PATH} />))
    await vi.waitFor(() => expect(container?.textContent).toContain('沉睡的航线'))
    expect(container?.textContent).not.toContain('已达到项目沉寂提醒阈值')

    const latestProject = useProjectStore.getState().currentProject!
    await act(async () => useProjectStore.setState({
      currentProject: {
        ...latestProject,
        novelConfig: { ...latestProject.novelConfig, narrativeThreadDormantChapterThreshold: 4 },
      },
    }))
    await vi.waitFor(() => expect(container?.textContent).toContain('已达到项目沉寂提醒阈值'))
  })
})
