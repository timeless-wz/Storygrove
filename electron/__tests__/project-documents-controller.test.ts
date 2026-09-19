import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WindowsSafeFileSystem } from '../security/windows-safe-file-system'
import type { SecureFileCapability } from '../security/windows-safe-file-system'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'

type IpcHandler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  /** 活动项目根：模拟主进程“当前已打开项目”。 */
  currentProjectPath: '' as string,
  handlers: new Map<string, IpcHandler>(),
  /** 外部文件授权的只读目标：一次导入一个来源文件。 */
  grantedSource: null as { rootPath: string; relativePath: string } | null,
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../database', () => ({
  getCurrentProjectPath: () => mocks.currentProjectPath,
}))

vi.mock('../services/project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext: (context: ProjectSessionContext | undefined) => {
      if (!context || !mocks.currentProjectPath) {
        throw new Error('缺少项目会话上下文，已拒绝操作')
      }
      if (context.projectPath !== mocks.currentProjectPath) {
        throw new Error('项目上下文已切换，已拒绝跨项目读写')
      }
      return { rootPath: mocks.currentProjectPath }
    },
  },
}))

vi.mock('../services/external-file-grant-service', () => ({
  externalFileGrants: {
    resolve: () => {
      if (!mocks.grantedSource) throw new Error('外部文件授权不存在或已失效')
      return {
        rootPath: mocks.grantedSource.rootPath,
        relativePath: mocks.grantedSource.relativePath,
        rootIdentity: {},
      }
    },
    revalidate: () => {
      throw new Error('外部文件授权不存在或已失效')
    },
    issueFile: () => ({ grantId: 'grant-test', expiresAt: Date.now() + 600_000 }),
    issueDirectory: () => ({ grantId: 'grant-dir', expiresAt: Date.now() + 600_000 }),
    revoke: () => {},
  },
}))

vi.mock('../i18n', () => ({
  mainText: (_locale: unknown, zhCNText: string) => zhCNText,
}))

function capabilityPath(capability: SecureFileCapability): string {
  return capability.relativePath
    ? path.join(capability.rootPath, ...capability.relativePath.split('\\'))
    : capability.rootPath
}

/**
 * 测试接缝：真实写入完成（新文件已改名落地）之后立刻执行一次。
 * 用于模拟「写入之后、删除旧文件之前」项目会话被切换的窗口。
 */
let afterAtomicWrite: (() => void) | null = null

/**
 * 用真实文件系统实现安全文件系统接口。
 *
 * 边界校验使用的是生产代码（assertProjectFilePath / createSecureFileCapability），
 * 因此 realpath 与目录穿越拒绝都被真实执行。
 */
function createRealFileSystem(): WindowsSafeFileSystem {
  return {
    async readBytes(capability, maxBytes) {
      const target = capabilityPath(capability)
      const bytes = fs.readFileSync(target)
      if (maxBytes !== undefined && bytes.length > maxBytes) {
        throw new Error('SECURE_FS_FILE_TOO_LARGE')
      }
      return bytes
    },
    async readText(capability, maxBytes) {
      const target = capabilityPath(capability)
      const content = fs.readFileSync(target, 'utf8')
      if (maxBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxBytes) {
        throw new Error('SECURE_FS_FILE_TOO_LARGE')
      }
      return content
    },
    async writeTextAtomically(capability, content, beforeReplace) {
      const target = capabilityPath(capability)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const temporary = `${target}.tmp`
      fs.writeFileSync(temporary, content, 'utf8')
      beforeReplace?.()
      fs.renameSync(temporary, target)
      afterAtomicWrite?.()
    },
    async mkdir(capability) {
      fs.mkdirSync(capabilityPath(capability), { recursive: true })
    },
    async exists(capability) {
      return fs.existsSync(capabilityPath(capability))
    },
    async listDirectory(capability) {
      return fs.readdirSync(capabilityPath(capability), { withFileTypes: true })
        .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    },
  }
}

let root: string
let projectA: string
let projectB: string
let sourceDirectory: string

function session(projectPath: string, leaseId = 'lease-1'): ProjectSessionContext {
  return { projectId: path.basename(projectPath), leaseId, projectPath }
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return handler({ sender: { id: 1, once: () => {} } }, ...args)
}

/** 目录快照：用于证明某个项目目录完全没有被创建或修改。 */
function snapshotDirectory(directory: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const visit = (current: string): void => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) visit(child)
      else snapshot[path.relative(directory, child).split(path.sep).join('/')] = fs.readFileSync(child, 'utf8')
    }
  }
  visit(directory)
  return snapshot
}

async function createDocument(documentPath: string, content: string): Promise<void> {
  const result = await invoke(
    'docs:write',
    documentPath,
    content,
    mocks.currentProjectPath,
    session(mocks.currentProjectPath),
  ) as { success: boolean }
  expect(result.success).toBe(true)
}

beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear()
  mocks.grantedSource = null
  afterAtomicWrite = null
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-documents-'))
  projectA = path.join(root, 'project-a')
  projectB = path.join(root, 'project-b')
  sourceDirectory = path.join(root, 'readonly-master')
  for (const directory of [projectA, projectB]) {
    fs.mkdirSync(path.join(directory, '.vela'), { recursive: true })
  }
  // 只读母稿目录：测试期间不得被写入、移动或重命名。
  fs.mkdirSync(sourceDirectory, { recursive: true })
  mocks.currentProjectPath = projectA

  const { registerProjectDocumentsController } = await import('../controllers/project-documents-controller')
  registerProjectDocumentsController(createRealFileSystem())
})

afterEach(() => {
  afterAtomicWrite = null
  mocks.handlers.clear()
  mocks.currentProjectPath = ''
  mocks.grantedSource = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('project documents controller', () => {
  it('creates, reads and lists documents inside the managed directory only', async () => {
    await createDocument('卷纲.md', '# 第一卷\n\n正文\n')
    await createDocument('notes/灵感.md', '灵感内容\n')

    expect(fs.existsSync(path.join(projectA, '.vela', 'documents', '卷纲.md'))).toBe(true)
    expect(fs.existsSync(path.join(projectA, '.vela', 'documents', 'notes', '灵感.md'))).toBe(true)

    const listed = await invoke('docs:list', projectA, session(projectA)) as {
      success: boolean
      documents: Array<{ documentPath: string; title: string }>
    }
    expect(listed.success).toBe(true)
    expect(listed.documents.map(document => document.documentPath).sort())
      .toEqual(['notes/灵感.md', '卷纲.md'])

    const read = await invoke('docs:read', '卷纲.md', projectA, session(projectA)) as {
      success: boolean
      content: string
    }
    expect(read).toEqual({ success: true, content: '# 第一卷\n\n正文\n' })
  })

  it('returns an empty list when the managed directory does not exist yet', async () => {
    const listed = await invoke('docs:list', projectA, session(projectA)) as {
      success: boolean
      documents: unknown[]
    }
    expect(listed).toEqual({ success: true, documents: [] })
  })

  it('keeps project A and project B documents isolated', async () => {
    await createDocument('A-设定.md', 'A\n')
    mocks.currentProjectPath = projectB
    await createDocument('B-设定.md', 'B\n')

    const listedB = await invoke('docs:list', projectB, session(projectB)) as {
      documents: Array<{ documentPath: string }>
    }
    expect(listedB.documents.map(document => document.documentPath)).toEqual(['B-设定.md'])

    // 项目 B 的会话无权读取项目 A 的文档。
    const crossRead = await invoke('docs:read', 'A-设定.md', projectB, session(projectB)) as {
      success: boolean
      error?: string
    }
    expect(crossRead.success).toBe(false)

    mocks.currentProjectPath = projectA
    const listedA = await invoke('docs:list', projectA, session(projectA)) as {
      documents: Array<{ documentPath: string }>
    }
    expect(listedA.documents.map(document => document.documentPath)).toEqual(['A-设定.md'])
  })

  it('rejects every out-of-boundary path without touching the filesystem', async () => {
    const outside = path.join(projectA, 'escaped.md')
    const attempts = [
      '../escaped.md',
      'notes/../../escaped.md',
      'C:/Windows/System32/escaped.md',
      '/etc/escaped.md',
      '.vela/project.json',
      'notes/escaped.txt',
      'assets/escaped.md',
    ]
    for (const documentPath of attempts) {
      const write = await invoke(
        'docs:write',
        documentPath,
        'pwned',
        projectA,
        session(projectA),
      ) as { success: boolean; error?: string }
      expect(write.success, documentPath).toBe(false)

      const read = await invoke('docs:read', documentPath, projectA, session(projectA)) as {
        success: boolean
      }
      expect(read.success, documentPath).toBe(false)
    }
    expect(fs.existsSync(outside)).toBe(false)
    expect(fs.existsSync(path.join(projectA, '.vela', 'project.json'))).toBe(false)
  })

  it('rejects a stale lease even when the path itself is valid', async () => {
    await createDocument('卷纲.md', '内容\n')
    const stale = await invoke(
      'docs:write',
      '卷纲.md',
      '来自旧租约的写入',
      projectA,
      { projectId: 'project-a', leaseId: 'previous-lease', projectPath: projectB },
    ) as { success: boolean }
    expect(stale.success).toBe(false)
    expect(fs.readFileSync(path.join(projectA, '.vela', 'documents', '卷纲.md'), 'utf8')).toBe('内容\n')
  })

  it('renames a document without leaving the old file behind', async () => {
    await createDocument('旧标题.md', '内容\n')
    const renamed = await invoke(
      'docs:rename',
      '旧标题.md',
      '新标题',
      projectA,
      session(projectA),
    ) as { success: boolean; documentPath?: string }
    expect(renamed).toEqual({ success: true, documentPath: '新标题.md' })
    expect(fs.existsSync(path.join(projectA, '.vela', 'documents', '旧标题.md'))).toBe(false)
    expect(fs.readFileSync(path.join(projectA, '.vela', 'documents', '新标题.md'), 'utf8')).toBe('内容\n')
  })

  it('never deletes the original when the project session changes during the rename', async () => {
    await createDocument('卷一/旧标题.md', '内容\n')
    const projectBBefore = snapshotDirectory(projectB)

    // 新副本写入完成、删除旧文件之前，项目会话切到 B。
    afterAtomicWrite = () => { mocks.currentProjectPath = projectB }

    const renamed = await invoke(
      'docs:rename',
      '卷一/旧标题.md',
      '新标题',
      projectA,
      session(projectA),
    ) as { success: boolean; documentPath?: string; createdDocumentPath?: string; error?: string }

    // 受控失败：明确告知未完成，并说明新副本已经写入。
    expect(renamed.success).toBe(false)
    expect(renamed.error).toBeTruthy()
    expect(renamed.createdDocumentPath).toBe('卷一/新标题.md')
    expect(renamed.documentPath).toBeUndefined()

    // 项目 A 的原文件必须原样保留。
    expect(fs.readFileSync(
      path.join(projectA, '.vela', 'documents', '卷一', '旧标题.md'),
      'utf8',
    )).toBe('内容\n')

    // 项目 B 不得被创建或修改任何文件。
    expect(snapshotDirectory(projectB)).toEqual(projectBBefore)
    expect(mocks.currentProjectPath).toBe(projectB)
  })

  it('copies an imported Markdown file without modifying the source', async () => {
    const sourcePath = path.join(sourceDirectory, '母稿设定.md')
    const sourceContent = '# 母稿\n\n只读来源，不得修改。\n'
    fs.writeFileSync(sourcePath, sourceContent, 'utf8')
    const before = fs.statSync(sourcePath)
    mocks.grantedSource = { rootPath: sourceDirectory, relativePath: '母稿设定.md' }

    const result = await invoke('docs:import', ['grant-1'], projectA, session(projectA)) as {
      success: boolean
      imported: Array<{ documentPath: string }>
      failed: unknown[]
    }
    expect(result.success).toBe(true)
    expect(result.failed).toEqual([])
    expect(result.imported.map(item => item.documentPath)).toEqual(['母稿设定.md'])
    expect(fs.readFileSync(path.join(projectA, '.vela', 'documents', '母稿设定.md'), 'utf8'))
      .toBe(sourceContent)

    // 来源母稿必须逐字节不变，且未被移动、重命名或删除。
    const after = fs.statSync(sourcePath)
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sourceContent)
    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    // 只读母稿目录里除了来源文件，不出现任何复制残留或临时文件。
    expect(fs.readdirSync(sourceDirectory)).toEqual(['母稿设定.md'])
  })

  it('does not overwrite an existing document when importing a same-named file', async () => {
    await createDocument('设定.md', '作者自己的内容\n')
    const sourcePath = path.join(sourceDirectory, '设定.md')
    fs.writeFileSync(sourcePath, '导入的内容\n', 'utf8')
    mocks.grantedSource = { rootPath: sourceDirectory, relativePath: '设定.md' }

    const result = await invoke('docs:import', ['grant-1'], projectA, session(projectA)) as {
      imported: Array<{ documentPath: string }>
    }
    expect(result.imported.map(item => item.documentPath)).toEqual(['设定 2.md'])
    expect(fs.readFileSync(path.join(projectA, '.vela', 'documents', '设定.md'), 'utf8'))
      .toBe('作者自己的内容\n')
  })

  it('deletes only the managed document', async () => {
    await createDocument('待删除.md', '内容\n')
    const result = await invoke('docs:delete', '待删除.md', projectA, session(projectA)) as {
      success: boolean
    }
    expect(result.success).toBe(true)
    expect(fs.existsSync(path.join(projectA, '.vela', 'documents', '待删除.md'))).toBe(false)

    const outside = await invoke('docs:delete', '../escaped.md', projectA, session(projectA)) as {
      success: boolean
    }
    expect(outside.success).toBe(false)
  })

  it('copies an inserted image into the managed assets directory', async () => {
    await createDocument('绘图笔记.md', '')
    const sourceImage = path.join(sourceDirectory, '地图.png')
    fs.writeFileSync(sourceImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    mocks.grantedSource = { rootPath: sourceDirectory, relativePath: '地图.png' }

    const result = await invoke(
      'docs:import-asset',
      '绘图笔记.md',
      'grant-image',
      projectA,
      session(projectA),
    ) as { success: boolean; assetReference?: string }
    expect(result).toEqual({ success: true, assetReference: 'assets/地图.png' })
    expect(fs.existsSync(path.join(projectA, '.vela', 'documents', 'assets', '地图.png'))).toBe(true)

    const asset = await invoke(
      'docs:read-asset',
      '绘图笔记.md',
      'assets/地图.png',
      projectA,
      session(projectA),
    ) as { success: boolean; dataUrl?: string }
    expect(asset.success).toBe(true)
    expect(asset.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)

    // 越界引用不得被读成图片。
    const escaped = await invoke(
      'docs:read-asset',
      '绘图笔记.md',
      '../../.vela/project.json',
      projectA,
      session(projectA),
    ) as { success: boolean }
    expect(escaped.success).toBe(false)
  })
})
