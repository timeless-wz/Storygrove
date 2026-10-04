import type {
  BlueprintPlanningExportPackage,
  BlueprintVolumeOutline,
} from '../shared/blueprint-planning'
import { blueprintPlanningTextHash } from '../shared/blueprint-planning'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import { ipc } from './ipc-client'
import {
  getActiveProjectSessionContext,
  sameProjectSessionContext,
} from '../shared/project-session-context'

export interface BlueprintVolumeOutlineImportPreview {
  volumeId: string
  fileName: string
  markdown: string
  importHash: string
  expectedRevision: number
  currentMarkdown: string | null
  currentHash: string | null
}

export interface BlueprintBookOutlineImportPreview {
  fileName: string
  markdown: string
  importHash: string
  expectedSynopsisHash: string
  currentSynopsis: string
}

export type BlueprintPlanningExchangeResult =
  | { success: true; fileName?: string; content?: string; outline?: BlueprintVolumeOutline; package?: BlueprintPlanningExportPackage }
  | { success: false; cancelled?: boolean; error: string; current?: BlueprintVolumeOutline | null }

function isSessionCurrent(projectSession: ProjectSessionContext): boolean {
  return sameProjectSessionContext(projectSession, getActiveProjectSessionContext())
}

function staleSessionError(): string {
  return '项目会话已切换，本次蓝图交换已取消'
}

export function sha256PlanningText(value: string): string {
  return blueprintPlanningTextHash(value)
}

/**
 * Selects and reads exactly one external Markdown file, then freezes the current
 * volume outline revision for a later explicit preview/confirm flow.
 */
export async function prepareBlueprintVolumeOutlineImport(
  projectSession: ProjectSessionContext,
  volumeId: string,
): Promise<BlueprintPlanningExchangeResult & { preview?: BlueprintVolumeOutlineImportPreview }> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }

  const selected = await ipc.invoke('dialog:select-markdown-files')
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!selected?.length) return { success: false, cancelled: true, error: '未选择 Markdown 文件' }
  if (selected.length !== 1) {
    return { success: false, error: '请一次只选择一个卷纲 Markdown 文件' }
  }

  const file = selected[0]
  const [read, current, volumes] = await Promise.all([
    ipc.invoke('fs:grant-read-file', file.grantId),
    ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-get', volumeId, projectSession.projectPath),
    ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-list', projectSession.projectPath),
  ])
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!volumes.some(volume => volume.id === volumeId)) {
    return { success: false, error: '目标卷不存在，请刷新蓝图目录后重试' }
  }
  if (!read.success) return { success: false, error: read.error || '读取所选 Markdown 文件失败' }

  const markdown = read.content
  return {
    success: true,
    preview: {
      volumeId,
      fileName: file.displayName,
      markdown,
      importHash: sha256PlanningText(markdown),
      expectedRevision: current?.revision ?? 0,
      currentMarkdown: current?.markdown ?? null,
      currentHash: current?.contentHash ?? null,
    },
  }
}

/** Selects the exact legacy synopsis Markdown body and freezes its source hash. */
export async function prepareBlueprintBookOutlineImport(
  projectSession: ProjectSessionContext,
): Promise<BlueprintPlanningExchangeResult & { preview?: BlueprintBookOutlineImportPreview }> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const selected = await ipc.invoke('dialog:select-markdown-files')
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!selected?.length) return { success: false, cancelled: true, error: '未选择 Markdown 文件' }
  if (selected.length !== 1) return { success: false, error: '请一次只选择一个总纲 Markdown 文件' }

  const file = selected[0]
  const [read, core] = await Promise.all([
    ipc.invoke('fs:grant-read-file', file.grantId),
    ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectSession.projectPath),
  ])
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!read.success) return { success: false, error: read.error || '读取所选 Markdown 文件失败' }
  if (!core) return { success: false, error: '无法读取当前全书总纲' }

  const currentSynopsis = core.synopsis ?? ''
  return {
    success: true,
    preview: {
      fileName: file.displayName,
      markdown: read.content,
      importHash: blueprintPlanningTextHash(read.content),
      expectedSynopsisHash: blueprintPlanningTextHash(currentSynopsis),
      currentSynopsis,
    },
  }
}

/** Imports into the sole project_core.synopsis authority and verifies DB readback. */
export async function confirmBlueprintBookOutlineImport(
  projectSession: ProjectSessionContext,
  preview: BlueprintBookOutlineImportPreview,
): Promise<BlueprintPlanningExchangeResult> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (blueprintPlanningTextHash(preview.markdown) !== preview.importHash) {
    return { success: false, error: '导入预览正文已变化，请重新选择文件' }
  }
  const update = await ipc.invokeWithProjectSession(
    projectSession,
    'db:project-core-update',
    { synopsis: preview.markdown, expectedSynopsisHash: preview.expectedSynopsisHash },
    projectSession.projectPath,
  )
  if (!update.success) return { success: false, error: update.error || '全书总纲已变化，请重新预览后再确认' }
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const readback = await ipc.invokeWithProjectSession(
    projectSession,
    'db:project-core-get',
    projectSession.projectPath,
  )
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!readback || blueprintPlanningTextHash(readback.synopsis ?? '') !== preview.importHash) {
    return { success: false, error: '总纲导入已提交，但数据库读回与预览正文不一致，请刷新后核对' }
  }
  return { success: true, content: readback.synopsis }
}

/** Commits a reviewed preview by CAS, then reads the saved row back from SQLite. */
export async function confirmBlueprintVolumeOutlineImport(
  projectSession: ProjectSessionContext,
  preview: BlueprintVolumeOutlineImportPreview,
): Promise<BlueprintPlanningExchangeResult> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const result = await ipc.invokeWithProjectSession(
    projectSession,
    'db:blueprint-volume-outline-save',
    {
      volumeId: preview.volumeId,
      expectedRevision: preview.expectedRevision,
      markdown: preview.markdown,
      origin: 'import',
    },
    projectSession.projectPath,
  )
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      current: result.current ?? null,
    }
  }
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const readback = await ipc.invokeWithProjectSession(
    projectSession,
    'db:blueprint-volume-outline-get',
    preview.volumeId,
    projectSession.projectPath,
  )
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!readback || readback.revision !== result.outline.revision || readback.contentHash !== preview.importHash) {
    return {
      success: false,
      error: '卷纲导入已提交，但数据库读回与预览版本不一致，请刷新后核对',
      current: readback,
    }
  }
  return { success: true, outline: readback }
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').trim().slice(0, 100) || 'blueprint-planning'
}

async function writeGrantedFile(
  projectSession: ProjectSessionContext,
  fileName: string,
  content: string,
): Promise<BlueprintPlanningExchangeResult> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const destination = await ipc.invoke('dialog:select-export-directory')
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!destination) return { success: false, cancelled: true, error: '已取消导出' }
  const written = await ipc.invoke('fs:grant-write-file', destination.grantId, fileName, content)
  if (!written.success) return { success: false, error: written.error || `写入 ${fileName} 失败` }
  return { success: true, fileName }
}

/** Export one volume's exact authoritative Markdown body through a file grant. */
export async function exportBlueprintVolumeOutlineMarkdown(
  projectSession: ProjectSessionContext,
  volumeId: string,
): Promise<BlueprintPlanningExchangeResult> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const [volumes, outline] = await Promise.all([
    ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-list', projectSession.projectPath),
    ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-get', volumeId, projectSession.projectPath),
  ])
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const volume = volumes.find(item => item.id === volumeId)
  if (!volume) return { success: false, error: '目标卷不存在' }
  if (!outline) return { success: false, error: '本卷尚无卷纲可导出' }
  const fileName = `${safeFileName(volume.name)}-卷纲.md`
  return writeGrantedFile(projectSession, fileName, outline.markdown)
}

/** Exports the exact sole book-outline source without formatting or headers. */
export async function exportBlueprintBookOutlineMarkdown(
  projectSession: ProjectSessionContext,
): Promise<BlueprintPlanningExchangeResult> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const core = await ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectSession.projectPath)
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  if (!core) return { success: false, error: '无法读取全书总纲' }
  return writeGrantedFile(projectSession, '全书总纲.md', core.synopsis ?? '')
}

/** Export the explicit versioned package; the package contains no prose or drafts. */
export async function exportBlueprintPlanningPackage(
  projectSession: ProjectSessionContext,
): Promise<BlueprintPlanningExchangeResult> {
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const planningPackage = await ipc.invokeWithProjectSession(
    projectSession,
    'db:blueprint-planning-export',
    projectSession.projectPath,
  )
  if (!isSessionCurrent(projectSession)) return { success: false, error: staleSessionError() }
  const content = `${JSON.stringify(planningPackage, null, 2)}\n`
  const write = await writeGrantedFile(projectSession, 'blueprint-planning-export.json', content)
  return write.success
    ? { ...write, content, package: planningPackage }
    : write
}
