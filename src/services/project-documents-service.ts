/**
 * project-documents-service — 项目自由 Markdown 文档的渲染进程入口
 *
 * 所有调用都走 `docs:*` 通道：主进程以当前项目租约与受控目录
 * `boundary` 重新认证。这里不接受、也不构造任何绝对路径。
 */

import { ipc } from './ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  ProjectDocumentEntry,
  ProjectDocumentImportFailure,
  ProjectDocumentImportOutcome,
} from '../shared/project-documents'

export interface ProjectDocumentListOutcome {
  success: boolean
  documents: ProjectDocumentEntry[]
  error?: string
}

export interface ProjectDocumentImportOutcomeResult {
  success: boolean
  imported: ProjectDocumentImportOutcome[]
  failed: ProjectDocumentImportFailure[]
  error?: string
}

export interface ProjectDocumentMutationOutcome {
  success: boolean
  documentPath?: string
  /** 会话/租约在删除旧文件前失效时，新名称副本已经写入完成。 */
  createdDocumentPath?: string
  error?: string
}

/** 列出当前项目的自由 Markdown 文档。 */
export async function listProjectDocuments(
  projectSession: ProjectSessionContext,
): Promise<ProjectDocumentListOutcome> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:list',
    projectSession.projectPath,
  )
}

export async function readProjectDocument(
  projectSession: ProjectSessionContext,
  documentPath: string,
): Promise<{ success: boolean; content: string; error?: string }> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:read',
    documentPath,
    projectSession.projectPath,
  )
}

export async function writeProjectDocument(
  projectSession: ProjectSessionContext,
  documentPath: string,
  content: string,
): Promise<{ success: boolean; commitState: 'not_committed' | 'committed' | 'unknown'; error?: string }> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:write',
    documentPath,
    content,
    projectSession.projectPath,
  )
}

export async function createProjectDocument(
  projectSession: ProjectSessionContext,
  title: string,
): Promise<ProjectDocumentMutationOutcome> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:create',
    title,
    projectSession.projectPath,
  )
}

export async function renameProjectDocument(
  projectSession: ProjectSessionContext,
  documentPath: string,
  nextTitle: string,
): Promise<ProjectDocumentMutationOutcome> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:rename',
    documentPath,
    nextTitle,
    projectSession.projectPath,
  )
}

export async function deleteProjectDocument(
  projectSession: ProjectSessionContext,
  documentPath: string,
): Promise<{ success: boolean; error?: string }> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:delete',
    documentPath,
    projectSession.projectPath,
  )
}

/** 选择外部 Markdown 文件；只签发只读授权，来源文件永不被写入。 */
export async function selectExternalMarkdownFiles(): Promise<Array<{ grantId: string; displayName: string }> | null> {
  return ipc.invoke('dialog:select-markdown-files')
}

export async function selectExternalMarkdownImage(): Promise<Array<{ grantId: string; displayName: string }> | null> {
  return ipc.invoke('dialog:select-markdown-images')
}

/** 把已授权的外部 Markdown 复制进当前项目受控目录。 */
export async function importProjectDocuments(
  projectSession: ProjectSessionContext,
  grantIds: string[],
): Promise<ProjectDocumentImportOutcomeResult> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:import',
    grantIds,
    projectSession.projectPath,
  )
}

/** 复制一张图片到文档旁的 assets/，返回写回 Markdown 的相对引用。 */
export async function importProjectDocumentAsset(
  projectSession: ProjectSessionContext,
  documentPath: string,
  grantId: string,
): Promise<{ success: boolean; assetReference?: string; error?: string }> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:import-asset',
    documentPath,
    grantId,
    projectSession.projectPath,
  )
}

/** 通过受控读取把文档图片变成 data URL 预览；失败即图片不可用。 */
export async function readProjectDocumentAsset(
  projectSession: ProjectSessionContext,
  documentPath: string,
  assetReference: string,
): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
  return ipc.invokeWithProjectSession(
    projectSession,
    'docs:read-asset',
    documentPath,
    assetReference,
    projectSession.projectPath,
  )
}
