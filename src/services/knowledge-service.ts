/**
 * knowledge-service — 知识库数据访问服务
 *
 * 封装 KnowledgeOverview 和 KnowledgePanel 中的 IPC 调用，
 * 避免组件直接与 IPC 通信。
 */

import { ipc } from './ipc-client'
import type {
  AppErrorCode,
  AppFailure,
  ProjectSessionContext,
} from '../shared/ipc-channels'
import { projectDocumentKnowledgeName } from '../shared/project-documents'

export interface PlanningMaterial {
  fileName: string
  text: string
}

export class KnowledgeBaseServiceError extends Error {
  constructor(public readonly code: AppErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'KnowledgeBaseServiceError'
  }
}

export function unwrapKnowledgeValue<T>(result: T | AppFailure): T {
  if (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    result.success === false &&
    'errorCode' in result
  ) {
    throw new KnowledgeBaseServiceError(result.errorCode, result.error)
  }
  return result as T
}

/** 已导入文档 */
export interface KBDocument {
  id: string
  fileName: string
  importedAt: string
  chunkCount: number
  filePath: string
}

/** 检索结果 */
export interface SearchResult {
  text: string
  score: number
  fileName: string
}

/** 知识库统计 */
export interface KBStatsData {
  documentCount: number
  totalChunks: number
  vectorDimension: number
}

/**
 * A provider-free capability/status read for the explicit vector rebuild
 * action.  `embeddingConfigured` must be true before the UI offers a button.
 */
export interface VectorRebuildStatus {
  embeddingConfigured: boolean
  canRebuild: boolean
  totalChunks: number
  vectorlessCount: number
  activeVectorDimension: number
}

/** 加载文档列表 */
export async function listDocuments(expectedProjectPath: string): Promise<KBDocument[]> {
  return unwrapKnowledgeValue(await ipc.invoke('kb:list-documents', expectedProjectPath))
}

/** 获取知识库统计 */
export async function getStats(expectedProjectPath: string): Promise<KBStatsData> {
  return unwrapKnowledgeValue(await ipc.invoke('kb:stats', expectedProjectPath))
}

/** 同时加载文档列表和统计（常用组合） */
export async function loadKBData(expectedProjectPath: string): Promise<{ documents: KBDocument[]; stats: KBStatsData }> {
  const [documentsResult, statsResult] = await Promise.all([
    ipc.invoke('kb:list-documents', expectedProjectPath),
    ipc.invoke('kb:stats', expectedProjectPath),
  ])
  return {
    documents: unwrapKnowledgeValue(documentsResult),
    stats: unwrapKnowledgeValue(statsResult),
  }
}

/** 获取缺失向量的文档块数量 */
export async function getVectorlessCount(expectedProjectPath: string): Promise<number> {
  const result = unwrapKnowledgeValue(await ipc.invoke('kb:get-vectorless-count', expectedProjectPath))
  return result.count
}

/** Read whether an explicit vector rebuild can safely be offered. */
export async function getVectorRebuildStatus(expectedProjectPath: string): Promise<VectorRebuildStatus> {
  return unwrapKnowledgeValue(await ipc.invoke('kb:get-vector-rebuild-status', expectedProjectPath))
}

/** 执行语义检索 */
export async function searchKB(query: string, topK: number, expectedProjectPath: string): Promise<SearchResult[]> {
  return unwrapKnowledgeValue(await ipc.invoke('kb:search', query, topK, expectedProjectPath))
}

/** 执行向量回填 */
export async function backfillVectors(expectedProjectPath: string): Promise<{ success: boolean; processed: number; failed: number; error?: string }> {
  return ipc.invoke('kb:backfill-vectors', expectedProjectPath) as Promise<{ success: boolean; processed: number; failed: number; error?: string }>
}

/** 清空当前项目知识库 */
export async function clearKnowledgeBase(expectedProjectPath: string): Promise<{ success: boolean; error?: string }> {
  return ipc.invoke('kb:clear-all', expectedProjectPath)
}

export async function importKnowledgeDocument(grantId: string, expectedProjectPath: string) {
  return ipc.invoke('kb:import-document', grantId, expectedProjectPath)
}

export async function importKnowledgeFolder(grantId: string, expectedProjectPath: string) {
  return ipc.invoke('kb:import-folder', grantId, expectedProjectPath)
}

export async function removeKnowledgeDocument(docId: string, expectedProjectPath: string) {
  return ipc.invoke('kb:remove-document', docId, expectedProjectPath)
}

/** 读取用户通过系统文件选择器明确授权的创作资料。 */
export async function selectPlanningMaterials(): Promise<PlanningMaterial[]> {
  const grants = await ipc.invoke('dialog:select-knowledge-files')
  if (!grants) return []
  const materials: PlanningMaterial[] = []
  for (const grant of grants) {
    const result = await ipc.invoke('fs:grant-read-file', grant.grantId)
    if (!result.success) throw new Error(result.error || `Could not read ${grant.displayName}`)
    materials.push({ fileName: grant.displayName, text: result.content })
  }
  return materials
}

/** 将普通创作资料写入当前冻结项目的 project-knowledge 语料。 */
export async function importPlanningMaterial(
  projectSession: ProjectSessionContext,
  material: PlanningMaterial,
) {
  return ipc.invokeWithProjectSession(
    projectSession,
    'kb:import-planning-text',
    material.text,
    material.fileName,
    projectSession.projectPath,
  )
}

/**
 * 作者显式把一份项目自由文档加入知识检索。
 *
 * 这是唯一入口：项目文档不会被自动索引，批准资料来源的规则也不因它放宽。
 * 索引名称使用文档在受控目录内的相对路径，因此不同目录下的同名文档
 * 是两份互不覆盖的索引条目。
 */
export async function addProjectDocumentToKnowledge(
  projectSession: ProjectSessionContext,
  documentPath: string,
  text: string,
): Promise<{ success: boolean; docId?: string; chunkCount?: number; error?: string }> {
  const knowledgeName = projectDocumentKnowledgeName(documentPath)
  if (!knowledgeName) return { success: false, error: 'invalid-document-path' }
  return ipc.invokeWithProjectSession(
    projectSession,
    'kb:import-text',
    text,
    knowledgeName,
    projectSession.projectPath,
  )
}

/**
 * 按文档路径建立的知识检索状态。
 *
 * 键为受控目录内的项目相对路径（`卷一/设定.md`），因此同名文档各自独立；
 * 只有形状合法的文档路径才会进入索引状态，避免把其它语料误判成项目文档。
 */
export async function loadProjectKnowledgeIndex(
  projectSession: ProjectSessionContext,
): Promise<Record<string, { docId: string; fileName: string }>> {
  const documents = await listDocuments(projectSession.projectPath)
  const index: Record<string, { docId: string; fileName: string }> = {}
  for (const document of documents) {
    const documentPath = projectDocumentKnowledgeName(document.fileName)
    if (!documentPath) continue
    index[documentPath] = { docId: document.id, fileName: document.fileName }
  }
  return index
}

export async function removeProjectDocumentFromKnowledge(
  projectSession: ProjectSessionContext,
  docId: string,
): Promise<{ success: boolean; error?: string }> {
  return removeKnowledgeDocument(docId, projectSession.projectPath)
}
