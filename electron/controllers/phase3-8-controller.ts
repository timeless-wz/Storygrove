import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { assertRequiredExpectedProjectPath } from '../utils/project-context'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import { searchKnowledgeWithProvenance } from '../services/rag-context-service'
import { readJsonFile, DEFAULT_GLOBAL_CONFIG, GLOBAL_CONFIG_PATH, MODELS_CONFIG_PATH } from '../utils/config-utils'
import type { GlobalConfig, ModelProfile } from '../../src/shared/ipc-channels'
import { auditChapter, listAuditFindings } from '../services/continuity-audit-service'
import { listStoryEvents, saveStoryEvent } from '../services/story-ledger-service'
import type { StoryEventRecord } from '../../src/shared/story-ledger'

type Handler = (event: IpcMainInvokeEvent, projectId: string, projectPath: string, ...args: unknown[]) => unknown

function embeddingConfig() {
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const targetId = config.defaultEmbeddingModelId || config.defaultModelId
  if (!targetId) return undefined
  const model = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, []).find(candidate => candidate.id === targetId)
  if (!model || !model.baseUrl.trim() || !model.apiKey.trim() || (model.protocol !== 'openai' && model.protocol !== 'gemini')) return undefined
  return { protocol: model.protocol, model: { baseUrl: model.baseUrl, apiKey: model.apiKey, modelName: model.modelName, embeddingOptions: model.embeddingOptions } } as const
}
function register(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event, ...input: unknown[]) => {
    const candidate = input.at(-1)
    const context = isProjectSessionContext(candidate) ? candidate : undefined
    if (context) input.pop()
    const expectedPath = context?.projectPath ?? (typeof input.at(-1) === 'string' ? String(input.at(-1)) : undefined)
    const currentPath = getCurrentProjectPath()
    const session = projectAccess.assertCurrentProjectContext(context, currentPath)
    assertRequiredExpectedProjectPath(currentPath, expectedPath)
    return handler(event, session.projectId, session.rootPath, ...input)
  })
}

export function registerPhase3To8Controller(): void {
  register('phase:rag-search', async (_event, projectId, projectPath, ...args) => searchKnowledgeWithProvenance({ projectId, projectPath, query: String(args[0] ?? ''), topK: Number(args[1] ?? 10), embedding: embeddingConfig() }))
  register('phase:audit-chapter', (_event, projectId, _projectPath, ...args) => auditChapter({ projectId, chapterNumber: Number(args[0]), content: String(args[1] ?? '') }))
  register('phase:list-audit-findings', (_event, projectId, _projectPath, ...args) => listAuditFindings(projectId, args[0] ? String(args[0]) : undefined))
  register('phase:list-events', (_event, projectId, _projectPath, ...args) => listStoryEvents(projectId, args[0] === undefined ? undefined : Number(args[0])))
  register('phase:save-event', (_event, projectId, _projectPath, ...args) => {
    const event = args[0] as Omit<StoryEventRecord, 'eventId'> & { eventId?: string }
    if (!event || event.projectId !== projectId) throw new Error('事件 projectId 与当前项目会话不一致')
    return saveStoryEvent(event)
  })
}
