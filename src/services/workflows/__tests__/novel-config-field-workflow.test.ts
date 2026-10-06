import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NovelConfig } from '../../../shared/ipc-channels'
import type { WorkflowContext, StepCallbacks } from '../../../stores/workflow-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useProjectStore } from '../../../stores/project-store'
import { createWorkflowRuntimeDependencies } from '../commands/__tests__/workflow-generation-runtime.fixture'
import type { WorkflowGenerationRuntimeDependencies } from '../commands/base-command'
import { createNovelConfigFieldWorkflow } from '../novel-config-field-workflow'

const PROJECT_PATH = 'C:\\novels\\novel-config-field-workflow-test'
const PROJECT_SESSION = {
  projectId: 'novel-config-field-workflow-test',
  leaseId: 'novel-config-field-workflow-test-lease',
  projectPath: PROJECT_PATH,
}
const BASE_CONFIG: NovelConfig = {
  writingLanguage: 'en-US',
  creativeStrategy: 'consistency-first',
  genre: 'Launch genre',
  subGenre: '',
  targetAudience: 'Adult',
  totalChapters: 80,
  wordsPerChapter: 3000,
  plotStructure: 'three_act',
  narrativePOV: 'third_limited',
  coreOutline: 'Existing story concept',
  worldSetting: 'Existing setting',
  goldenFinger: '',
  protagonistProfile: '',
  globalGuidance: '',
  writingStyle: 'Launch style',
  referenceWorks: 'Existing reference',
}
const callbacks: StepCallbacks = {
  log: vi.fn(),
  setProgress: vi.fn(),
  appendText: vi.fn(),
}
const originalProjectState = useProjectStore.getState()
const originalLlmState = useLLMStore.getState()

function project(novelConfig: NovelConfig = BASE_CONFIG) {
  return {
    id: PROJECT_SESSION.projectId,
    name: 'Temporary workflow fixture',
    path: PROJECT_PATH,
    sessionLease: PROJECT_SESSION.leaseId,
    novelConfig: { ...novelConfig },
  }
}

function workflowContext(): WorkflowContext {
  return {
    runId: 'creative-direction-field-test-run',
    projectPath: PROJECT_PATH,
    projectSession: PROJECT_SESSION,
    generationModelId: 'model-frozen-at-click',
    writingLanguage: 'en-US',
    uiLocale: 'en-US',
    data: {},
    cancelled: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {
    velaAPI: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'prompt:load-global') return { templates: [], diagnostics: [] }
        if (channel === 'fs:check-exists') return false
        // Creative-context sources must not read the live project store:
        // this workflow is bound to the frozen novelConfigSnapshot.
        if (channel === 'db:project-core-get') {
          return { premise: '', worldbuilding: '', charactersArch: '', creativeDirectionMarkdown: '', writingLanguage: 'en-US' }
        }
        if (channel === 'db:creative-legacy-list') return []
        if (channel === 'db:cultivation-read') return { revision: 0, realms: [], markdown: '' }
        if (channel === 'db:map-get-all') return { maps: [], nodes: [], edges: [] }
        return { success: true }
      }),
    },
  })
  useProjectStore.setState({
    currentProject: project() as never,
  })
  useLLMStore.setState({
    defaultModelId: 'model-frozen-at-click',
    generateStream: vi.fn(async (_messages, streamCallbacks) => {
      streamCallbacks.onDone?.('New world detail', undefined, 'stop')
      return 'field-request'
    }),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useProjectStore.setState(originalProjectState)
  useLLMStore.setState(originalLlmState)
})

describe('single-field creative direction workflow', () => {
  it('runs one existing field command with frozen config, lease, model and full novel-config claim', async () => {
    const saveProject = vi.fn(async () => true)
    const generateStream = vi.fn(useLLMStore.getState().generateStream)
    generateStream.mockImplementation(async (_messages, streamCallbacks) => {
      streamCallbacks.onDone?.('New world detail', undefined, 'stop')
      return 'field-request'
    })
    useProjectStore.setState({ currentProject: project() as never, saveProject })
    useLLMStore.setState({ generateStream })
    const runtime = createWorkflowRuntimeDependencies()
    const createRuntime = vi.fn(runtime.createRuntime)
    const generationRuntimeDependencies: WorkflowGenerationRuntimeDependencies = { createRuntime }
    const definition = createNovelConfigFieldWorkflow({
      fieldKey: 'worldSetting',
      projectPath: PROJECT_PATH,
      projectSession: PROJECT_SESSION,
      novelConfigSnapshot: { ...BASE_CONFIG },
      generationModelId: ' model-frozen-at-click ',
      uiLocale: 'en-US',
      generationRuntimeDependencies,
    })

    useProjectStore.setState({
      currentProject: project({
        ...BASE_CONFIG,
        genre: 'Changed after launch',
        writingStyle: 'Edited while queued',
      }) as never,
    })

    expect(definition).toMatchObject({
      type: 'config_generation',
      title: 'Creative direction: Background concept',
      projectPath: PROJECT_PATH,
      projectSession: PROJECT_SESSION,
      generationModelId: 'model-frozen-at-click',
      uiLocale: 'en-US',
      resourceKeys: ['novel-config'],
    })
    expect(definition.steps).toHaveLength(1)
    expect(definition.steps[0]).toMatchObject({
      name: 'Background concept',
      description: expect.stringContaining('only this field'),
    })

    const result = await definition.steps[0]!.executor(
      { id: 'field-step', name: 'Background concept', description: '', status: 'running', logs: [] },
      workflowContext(),
      callbacks,
    )

    const promptCall = generateStream.mock.calls[0]!
    const promptText = promptCall[0].map(message => message.content).join('\n')
    expect(promptText).toContain('Launch genre')
    expect(promptText).not.toContain('Changed after launch')
    expect(promptText).toContain('Existing reference')
    expect(promptText).not.toContain('Edited while queued')
    expect(result).toBe('Existing setting\n\nNew world detail')
    expect(useProjectStore.getState().currentProject?.novelConfig).toMatchObject({
      genre: 'Changed after launch',
      worldSetting: 'Existing setting\n\nNew world detail',
      writingStyle: 'Edited while queued',
    })
    expect(saveProject).toHaveBeenCalledOnce()
    expect(createRuntime).toHaveBeenCalledOnce()
    expect(createRuntime.mock.calls[0]?.[0]).toMatchObject({
      modelId: 'model-frozen-at-click',
      projectSession: PROJECT_SESSION,
      creativeStrategy: 'consistency-first',
    })
    expect(generateStream).toHaveBeenCalledOnce()
  })

  it('rejects a snapshot from another project lease before opening the model runtime', async () => {
    const createRuntime = vi.fn(async () => { throw new Error('runtime must not open') })
    const definition = createNovelConfigFieldWorkflow({
      fieldKey: 'coreOutline',
      projectPath: PROJECT_PATH,
      projectSession: PROJECT_SESSION,
      novelConfigSnapshot: { ...BASE_CONFIG },
      generationModelId: 'model-frozen-at-click',
      uiLocale: 'en-US',
      generationRuntimeDependencies: { createRuntime },
    })
    const wrongLeaseContext = {
      ...workflowContext(),
      projectSession: { ...PROJECT_SESSION, leaseId: 'newer-project-lease' },
    }

    await expect(definition.steps[0]!.executor(
      { id: 'field-step', name: 'Story concept', description: '', status: 'running', logs: [] },
      wrongLeaseContext,
      callbacks,
    )).rejects.toThrow('field-generation project, language, or model snapshot changed')
    expect(createRuntime).not.toHaveBeenCalled()
    expect(useLLMStore.getState().generateStream).not.toHaveBeenCalled()
  })
})
