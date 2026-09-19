import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  PROJECT_DOCUMENTS_DIRECTORY,
  PROJECT_DOCUMENT_ASSET_MAX_BYTES,
  documentTitleFromPath,
  imageMimeTypeForFileName,
  isMarkdownDocumentFileName,
  isProjectDocumentImageFileName,
  normalizeManagedDocumentsPath,
  normalizeProjectDocumentPath,
  resolveProjectDocumentAssetReference,
  sanitizeProjectDocumentFileName,
  stripControlCharacters,
  type ProjectDocumentEntry,
  type ProjectDocumentImportFailure,
  type ProjectDocumentImportOutcome,
} from '../../src/shared/project-documents'
import type { FileWriteCommitState, ProjectSessionContext } from '../../src/shared/ipc-channels'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { externalFileGrants } from '../services/external-file-grant-service'
import { mainText } from '../i18n'
import {
  assertProjectFilePath,
  assertRequiredExpectedProjectPath,
} from '../utils/project-context'
import {
  atomicWriteFailureCommitState,
  createSecureFileCapability,
  windowsSafeFileSystem,
  type SecureFileCapability,
  type WindowsSafeFileSystem,
} from '../security/windows-safe-file-system'
import { childFileCapability } from '../security/file-capability'

const DOCUMENT_GRANT_TTL_MS = 10 * 60 * 1_000
const MAX_IMPORT_FILES = 256
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
const MAX_DIRECTORY_DEPTH = 16

const DOCUMENTS_PREFIX = `${PROJECT_DOCUMENTS_DIRECTORY}/`
const ASSETS_SEGMENT = 'assets'

function text(zhCNText: string, enUSText: string): string {
  return mainText(app.getLocale(), zhCNText, enUSText)
}

function invalidDocumentPathText(): string {
  return text(
    '文档路径不在当前项目的受控文档目录内，已拒绝操作。',
    'The document path is outside this project’s managed documents directory; the operation was rejected.',
  )
}

function isBoundaryFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /受控|超出当前项目|会话|租约|跨项目/.test(message)
}

function capabilityAbsolutePath(capability: SecureFileCapability): string {
  return capability.relativePath
    ? path.join(capability.rootPath, ...capability.relativePath.split('\\'))
    : capability.rootPath
}

function isMissingFileError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  const message = error instanceof Error ? error.message : String(error)
  return code === 'ENOENT'
    || code === 'SECURE_FS_NOT_FOUND'
    || message === 'SECURE_FS_NOT_FOUND'
}

/** 断言调用时冻结的完整租约仍是活动项目，并返回 canonical 项目根。 */
function assertActiveProject(context: ProjectSessionContext, expectedProjectPath: string): string {
  const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
  assertRequiredExpectedProjectPath(active.rootPath, expectedProjectPath)
  return active.rootPath
}

/**
 * 把受控目录内的相对路径解析为项目内绝对路径。
 * 先做词法边界检查，再用 realpath 确认没有 junction/symlink 逃逸。
 */
function resolveManagedTarget(
  rootPath: string,
  managedRelativePath: string,
  mode: 'existing' | 'writable',
): { relativePath: string; absolutePath: string; capability: SecureFileCapability } {
  const normalized = normalizeManagedDocumentsPath(managedRelativePath)
  if (!normalized) throw new Error(invalidDocumentPathText())
  const relativePath = `${DOCUMENTS_PREFIX}${normalized}`
  const absolutePath = path.join(rootPath, ...relativePath.split('/'))
  assertProjectFilePath(absolutePath, rootPath, mode)
  return {
    relativePath,
    absolutePath,
    capability: createSecureFileCapability(rootPath, absolutePath),
  }
}

/** 只有提交了受控目录内的相对 Markdown 路径，才会得到可用的文件能力。 */
function resolveDocumentTarget(
  context: ProjectSessionContext,
  documentPath: unknown,
  expectedProjectPath: string,
  mode: 'existing' | 'writable',
): { rootPath: string; relativePath: string; absolutePath: string; capability: SecureFileCapability } {
  const rootPath = assertActiveProject(context, expectedProjectPath)
  const normalized = normalizeProjectDocumentPath(documentPath)
  if (!normalized) throw new Error(invalidDocumentPathText())
  return { rootPath, ...resolveManagedTarget(rootPath, normalized, mode) }
}

function resolveDocumentsDirectory(
  context: ProjectSessionContext,
  expectedProjectPath: string,
  mode: 'existing' | 'writable',
): { rootPath: string; absolutePath: string; capability: SecureFileCapability } {
  const rootPath = assertActiveProject(context, expectedProjectPath)
  const absolutePath = path.join(rootPath, ...PROJECT_DOCUMENTS_DIRECTORY.split('/'))
  assertProjectFilePath(absolutePath, rootPath, mode)
  return {
    rootPath,
    absolutePath,
    capability: createSecureFileCapability(rootPath, absolutePath),
  }
}

/**
 * 重命名等破坏性提交点的最终会话校验。
 *
 * 与只解析路径不同，这里要求当前活动项目仍是同一条完整身份：
 * 项目会话、canonical 项目路径与租约都必须仍然匹配。
 */
function revalidateProjectSession(
  context: ProjectSessionContext,
  expectedProjectPath: string,
): { ok: true } | { ok: false; error: string } {
  try {
    assertActiveProject(context, expectedProjectPath)
    return { ok: true }
  } catch {
    return {
      ok: false,
      error: text(
        '项目会话或租约已失效，重命名未完成。原文件保持不变；新名称副本已写入受控目录，请刷新文档列表后自行处理。',
        'The project session or lease was invalidated, so the rename did not complete. The original file is unchanged and a copy with the new name was written into the managed directory; refresh the document list and resolve it manually.',
      ),
    }
  }
}

type DocumentFilesystemHandler<Args extends unknown[] = unknown[]> = (
  event: IpcMainInvokeEvent,
  context: ProjectSessionContext,
  ...args: Args
) => unknown

/** 每个 docs:* 通道在触碰文件系统前都以调用时冻结的完整租约重新认证。 */
function registerDocumentHandler<Args extends unknown[]>(
  channel: string,
  handler: DocumentFilesystemHandler<Args>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const candidate = args.at(-1)
    const context = isProjectSessionContext(candidate) ? candidate : undefined
    if (context) args.pop()
    try {
      if (!context) throw new Error('缺少项目会话上下文，已拒绝操作')
      projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
      return await handler(event, context, ...(args as Args))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const reported = (fallback: string) => (isBoundaryFailure(error) ? message : fallback)
      switch (channel) {
        case 'docs:list':
          return { success: false, documents: [], error: reported(text('无法读取项目文档列表。', 'Could not read the project document list.')) }
        case 'docs:read':
          return { success: false, content: '', error: reported(text('无法读取项目文档。', 'Could not read the project document.')) }
        case 'docs:write':
          return { success: false, commitState: 'not_committed' as FileWriteCommitState, error: reported(text('无法写入项目文档。', 'Could not write the project document.')) }
        case 'docs:create':
        case 'docs:rename':
          return { success: false, error: reported(text('无法完成文档操作。', 'The document operation could not be completed.')) }
        case 'docs:import':
          return { success: false, imported: [], failed: [], error: reported(text('无法导入 Markdown 文档。', 'Could not import the Markdown documents.')) }
        default:
          return { success: false, error: reported(text('无法完成文档操作。', 'The document operation could not be completed.')) }
      }
    }
  })
}

interface ListedDocument {
  documentPath: string
  fileName: string
  size: number
  modifiedAt: string
}

async function listDocumentsRecursively(
  fileSystem: WindowsSafeFileSystem,
  rootPath: string,
  root: SecureFileCapability,
): Promise<ListedDocument[]> {
  const documents: ListedDocument[] = []

  const visit = async (directory: SecureFileCapability, depth: number): Promise<void> => {
    if (depth > MAX_DIRECTORY_DEPTH) return
    const entries = await fileSystem.listDirectory(directory)
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const child = childFileCapability(directory, entry.name)
      if (entry.isDirectory) {
        if (entry.name.toLocaleLowerCase('en-US') === ASSETS_SEGMENT) continue
        await visit(child, depth + 1)
        continue
      }
      if (!isMarkdownDocumentFileName(entry.name)) continue
      const absolutePath = capabilityAbsolutePath(child)
      assertProjectFilePath(absolutePath, rootPath, 'existing')
      const prefix = root.relativePath ? `${root.relativePath}\\` : ''
      const documentPath = child.relativePath.slice(prefix.length).split('\\').join('/')
      if (!normalizeProjectDocumentPath(documentPath)) continue
      const stats = fs.statSync(absolutePath)
      documents.push({
        documentPath,
        fileName: entry.name,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      })
    }
  }

  await visit(root, 0)
  documents.sort((left, right) => left.documentPath.localeCompare(right.documentPath, 'zh-CN'))
  return documents
}

/** 同一目录下已存在的名字，用于避免覆盖作者的既有文档。 */
async function existingNamesInDirectory(
  fileSystem: WindowsSafeFileSystem,
  root: SecureFileCapability,
  directoryDocumentPath: string,
): Promise<string[]> {
  let directory = root
  for (const segment of directoryDocumentPath ? directoryDocumentPath.split('/') : []) {
    directory = childFileCapability(directory, segment)
  }
  try {
    const entries = await fileSystem.listDirectory(directory)
    return entries.map(entry => entry.name)
  } catch {
    return []
  }
}

function parentDocumentPath(documentPath: string): string {
  const index = documentPath.lastIndexOf('/')
  return index < 0 ? '' : documentPath.slice(0, index)
}

async function writeDocumentAtomically(
  fileSystem: WindowsSafeFileSystem,
  context: ProjectSessionContext,
  documentPath: string,
  expectedProjectPath: string,
  content: string,
): Promise<{ success: boolean; commitState: FileWriteCommitState; error?: string }> {
  const outcome = { commitState: 'not_committed' as FileWriteCommitState }
  try {
    const directory = resolveDocumentsDirectory(context, expectedProjectPath, 'writable')
    await fileSystem.mkdir(directory.capability)
    const target = resolveDocumentTarget(context, documentPath, expectedProjectPath, 'writable')
    await fileSystem.writeTextAtomically(target.capability, content, () => {
      // 提交点上文件与父目录句柄都还开着，此时旧租约绝不允许替换文件。
      resolveDocumentTarget(context, documentPath, expectedProjectPath, 'writable')
    })
    outcome.commitState = 'committed'
    resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    return { success: true, commitState: outcome.commitState }
  } catch (error) {
    if (outcome.commitState !== 'committed') {
      outcome.commitState = atomicWriteFailureCommitState(error) ?? 'not_committed'
    }
    return {
      success: false,
      commitState: outcome.commitState,
      error: isBoundaryFailure(error)
        ? (error instanceof Error ? error.message : String(error))
        : text('无法写入项目文档。', 'Could not write the project document.'),
    }
  }
}

/** 复制进来的图片沿用原始扩展名，但文件名必须重新消毒。 */
function sanitizeAssetFileName(originalName: string, taken: Iterable<string>): string {
  const extension = path.extname(originalName).toLocaleLowerCase('en-US')
  const rawStem = path.basename(originalName, path.extname(originalName))
  const cleanedStem = stripControlCharacters(rawStem)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\s.]+$/, '')
    .trim()
    .slice(0, 80)
  const used = new Set<string>()
  for (const name of taken) used.add(String(name).toLocaleLowerCase('en-US'))
  const stem = cleanedStem || 'image'
  let candidate = `${stem}${extension}`
  let suffix = 2
  while (used.has(candidate.toLocaleLowerCase('en-US'))) {
    candidate = `${stem}-${suffix}${extension}`
    suffix += 1
  }
  return candidate
}

function toDocumentEntries(documents: ListedDocument[]): ProjectDocumentEntry[] {
  return documents.map(document => ({
    relativePath: `${DOCUMENTS_PREFIX}${document.documentPath}`,
    documentPath: document.documentPath,
    fileName: document.fileName,
    title: documentTitleFromPath(document.documentPath),
    size: document.size,
    modifiedAt: document.modifiedAt,
  }))
}

export function registerProjectDocumentsController(
  fileSystem: WindowsSafeFileSystem = windowsSafeFileSystem,
): void {
  registerDocumentHandler('docs:list', async (_event, context, expectedProjectPath: string) => {
    let directory: { rootPath: string; absolutePath: string; capability: SecureFileCapability }
    try {
      directory = resolveDocumentsDirectory(context, expectedProjectPath, 'existing')
    } catch (error) {
      // 还没有任何文档时受控目录本来就不存在；这是空列表，不是读取失败。
      if (isMissingFileError(error)) return { success: true, documents: [] }
      throw error
    }
    if (!await fileSystem.exists(directory.capability)) return { success: true, documents: [] }
    const documents = await listDocumentsRecursively(fileSystem, directory.rootPath, directory.capability)
    return { success: true, documents: toDocumentEntries(documents) }
  })

  registerDocumentHandler('docs:read', async (_event, context, documentPath: string, expectedProjectPath: string) => {
    const target = resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    const content = await fileSystem.readText(target.capability, MAX_DOCUMENT_BYTES)
    resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    return { success: true, content }
  })

  registerDocumentHandler('docs:write', async (_event, context, documentPath: string, content: string, expectedProjectPath: string) => (
    writeDocumentAtomically(fileSystem, context, documentPath, expectedProjectPath, String(content ?? ''))
  ))

  registerDocumentHandler('docs:create', async (_event, context, title: string, expectedProjectPath: string) => {
    const directory = resolveDocumentsDirectory(context, expectedProjectPath, 'writable')
    await fileSystem.mkdir(directory.capability)
    const fileName = sanitizeProjectDocumentFileName(
      title,
      await existingNamesInDirectory(fileSystem, directory.capability, ''),
    )
    const documentPath = normalizeProjectDocumentPath(fileName)
    if (!documentPath) throw new Error(invalidDocumentPathText())
    const created = await writeDocumentAtomically(fileSystem, context, documentPath, expectedProjectPath, '')
    if (!created.success) return { success: false, error: created.error }
    return { success: true, documentPath }
  })

  registerDocumentHandler('docs:rename', async (_event, context, documentPath: string, nextTitle: string, expectedProjectPath: string) => {
    const source = resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    const directoryPath = parentDocumentPath(documentPath)
    const directory = resolveDocumentsDirectory(context, expectedProjectPath, 'existing')
    const fileName = sanitizeProjectDocumentFileName(
      nextTitle,
      await existingNamesInDirectory(fileSystem, directory.capability, directoryPath),
    )
    const nextDocumentPath = normalizeProjectDocumentPath(
      directoryPath ? `${directoryPath}/${fileName}` : fileName,
    )
    if (!nextDocumentPath) throw new Error(invalidDocumentPathText())
    if (nextDocumentPath === documentPath) return { success: true, documentPath }

    const content = await fileSystem.readText(source.capability, MAX_DOCUMENT_BYTES)
    // 写入前再确认一次：会话/路径/租约仍指向同一个项目。
    resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    const written = await writeDocumentAtomically(
      fileSystem,
      context,
      nextDocumentPath,
      expectedProjectPath,
      content,
    )
    /*
     * `commitState === 'committed'` 表示新副本已经落地；此时即使写入后的
     * 租约复核失败，也必须继续走到下面的提交点校验，而不能把它当成"什么都没写"。
     */
    if (!written.success && written.commitState !== 'committed') {
      return { success: false, error: written.error }
    }

    /*
     * 删除旧文件是重命名的提交点，因此在这里独立地重新验证完整会话身份
     * （项目会话 + 项目路径 + 租约），而不是只依赖路径解析。
     * 项目已切换或租约失效时绝不删除旧文件：宁可留下两份，也不能删掉作者的内容。
     */
    const sessionCheck = revalidateProjectSession(context, expectedProjectPath)
    if (!sessionCheck.ok) {
      return {
        success: false,
        error: sessionCheck.error,
        createdDocumentPath: nextDocumentPath,
      }
    }
    const removable = resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    fs.rmSync(capabilityAbsolutePath(removable.capability), { force: true })
    return { success: true, documentPath: nextDocumentPath }
  })

  registerDocumentHandler('docs:delete', async (_event, context, documentPath: string, expectedProjectPath: string) => {
    const target = resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    fs.rmSync(capabilityAbsolutePath(target.capability), { force: true })
    return { success: true }
  })

  registerDocumentHandler('docs:import', async (event, context, grantIds: string[], expectedProjectPath: string) => {
    // 目标目录必须先通过校验，避免任何一次写入发生在边界之外。
    const directory = resolveDocumentsDirectory(context, expectedProjectPath, 'writable')
    await fileSystem.mkdir(directory.capability)

    const ids = Array.isArray(grantIds) ? grantIds.slice(0, MAX_IMPORT_FILES) : []
    const imported: ProjectDocumentImportOutcome[] = []
    const failed: ProjectDocumentImportFailure[] = []
    const taken = await existingNamesInDirectory(fileSystem, directory.capability, '')

    for (const grantId of ids) {
      let sourceName = ''
      try {
        const grant = externalFileGrants.resolve({
          grantId,
          webContentsId: event.sender.id,
          operation: 'read',
        })
        sourceName = path.basename(grant.relativePath)
        if (!isMarkdownDocumentFileName(sourceName)) {
          failed.push({ sourceName, error: text('只支持 .md / .markdown 文件。', 'Only .md / .markdown files are supported.') })
          continue
        }
        // 来源只读；内容复制到当前项目受控目录，绝不回写来源文件。
        const content = await fileSystem.readText(grant, MAX_DOCUMENT_BYTES)
        const fileName = sanitizeProjectDocumentFileName(sourceName, taken)
        const documentPath = normalizeProjectDocumentPath(fileName)
        if (!documentPath) throw new Error(invalidDocumentPathText())
        const written = await writeDocumentAtomically(
          fileSystem,
          context,
          documentPath,
          expectedProjectPath,
          content,
        )
        if (!written.success) throw new Error(written.error ?? 'import failed')
        taken.push(fileName)
        imported.push({
          sourceName,
          documentPath,
          relativePath: `${DOCUMENTS_PREFIX}${documentPath}`,
        })
      } catch (error) {
        failed.push({
          sourceName: sourceName || text('未命名文件', 'Unnamed file'),
          error: isBoundaryFailure(error)
            ? (error instanceof Error ? error.message : String(error))
            : text('导入失败，来源文件未被修改。', 'Import failed; the source file was not modified.'),
        })
      }
    }

    return { success: failed.length === 0, imported, failed }
  })

  registerDocumentHandler('docs:import-asset', async (event, context, documentPath: string, grantId: string, expectedProjectPath: string) => {
    // 先确认文档本身在受控目录内，图片才允许复制到它旁边的 assets/ 下。
    const document = resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')
    const directoryPath = parentDocumentPath(documentPath)
    // 复用文档边界解析：assets 目录与文档同处受控目录内。
    const assetsDirectory = resolveManagedTarget(
      document.rootPath,
      directoryPath ? `${directoryPath}/${ASSETS_SEGMENT}` : ASSETS_SEGMENT,
      'writable',
    )

    const grant = externalFileGrants.resolve({
      grantId,
      webContentsId: event.sender.id,
      operation: 'read',
    })
    const sourceName = path.basename(grant.relativePath)
    if (!isProjectDocumentImageFileName(sourceName)) {
      return { success: false, error: text('只支持常见图片格式。', 'Only common image formats are supported.') }
    }
    const sourceAbsolutePath = path.join(grant.rootPath, grant.relativePath)
    const stats = fs.statSync(sourceAbsolutePath)
    if (!stats.isFile() || stats.size > PROJECT_DOCUMENT_ASSET_MAX_BYTES) {
      return { success: false, error: text('图片过大或不是普通文件。', 'The image is too large or is not a regular file.') }
    }

    fs.mkdirSync(assetsDirectory.absolutePath, { recursive: true })
    assertProjectFilePath(assetsDirectory.absolutePath, document.rootPath, 'existing')
    const assetName = sanitizeAssetFileName(sourceName, fs.readdirSync(assetsDirectory.absolutePath))
    const assetAbsolutePath = path.join(assetsDirectory.absolutePath, assetName)
    assertProjectFilePath(assetAbsolutePath, document.rootPath, 'writable')
    fs.copyFileSync(sourceAbsolutePath, assetAbsolutePath)
    if (!fs.existsSync(assetAbsolutePath)) {
      return { success: false, error: text('图片复制失败。', 'Copying the image failed.') }
    }
    assertProjectFilePath(assetAbsolutePath, document.rootPath, 'existing')
    resolveDocumentTarget(context, documentPath, expectedProjectPath, 'existing')

    // 引用相对当前文档所在目录，Markdown 始终保持可移植。
    return { success: true, assetReference: `${ASSETS_SEGMENT}/${assetName}` }
  })

  registerDocumentHandler('docs:read-asset', async (_event, context, documentPath: string, assetReference: string, expectedProjectPath: string) => {
    const normalizedDocument = normalizeProjectDocumentPath(documentPath)
    if (!normalizedDocument) throw new Error(invalidDocumentPathText())
    const assetsDocumentPath = resolveProjectDocumentAssetReference(normalizedDocument, assetReference)
    if (!assetsDocumentPath) {
      return {
        success: false,
        error: text(
          '图片引用不在当前项目的受控目录内，已拒绝加载。',
          'The image reference is outside this project’s managed documents directory.',
        ),
      }
    }
    const rootPath = assertActiveProject(context, expectedProjectPath)
    const target = resolveManagedTarget(rootPath, assetsDocumentPath, 'existing')
    const absolutePath = capabilityAbsolutePath(target.capability)
    const stats = fs.statSync(absolutePath)
    if (!stats.isFile() || stats.size > PROJECT_DOCUMENT_ASSET_MAX_BYTES) {
      return { success: false, error: text('图片过大或不存在。', 'The image is too large or does not exist.') }
    }
    const bytes = fs.readFileSync(absolutePath)
    resolveManagedTarget(rootPath, assetsDocumentPath, 'existing')
    return {
      success: true,
      dataUrl: `data:${imageMimeTypeForFileName(assetsDocumentPath)};base64,${bytes.toString('base64')}`,
    }
  })

  ipcMain.handle('dialog:select-markdown-files', async (event) => {
    const result = await dialog.showOpenDialog({
      title: text('导入 Markdown 文档', 'Import Markdown documents'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: text('Markdown 文档', 'Markdown documents'), extensions: ['md', 'markdown'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths.slice(0, MAX_IMPORT_FILES).map((filePath) => {
      const grant = externalFileGrants.issueFile({
        webContentsId: event.sender.id,
        filePath,
        operations: ['read'],
        ttlMs: DOCUMENT_GRANT_TTL_MS,
        maxUses: 1,
      })
      event.sender.once('destroyed', () => externalFileGrants.revoke(grant.grantId))
      return { grantId: grant.grantId, displayName: path.basename(filePath) }
    })
  })

  ipcMain.handle('dialog:select-markdown-images', async (event) => {
    const result = await dialog.showOpenDialog({
      title: text('插入图片', 'Insert image'),
      properties: ['openFile'],
      filters: [{
        name: text('图片', 'Images'),
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'],
      }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths.slice(0, 1).map((filePath) => {
      const grant = externalFileGrants.issueFile({
        webContentsId: event.sender.id,
        filePath,
        operations: ['read'],
        ttlMs: DOCUMENT_GRANT_TTL_MS,
        maxUses: 1,
      })
      event.sender.once('destroyed', () => externalFileGrants.revoke(grant.grantId))
      return { grantId: grant.grantId, displayName: path.basename(filePath) }
    })
  })
}
