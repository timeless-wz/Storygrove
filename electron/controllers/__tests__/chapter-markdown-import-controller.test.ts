import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showOpenDialog: vi.fn(),
  activeProjectPath: '',
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler)) },
}))
vi.mock('../../database', () => ({ getCurrentProjectPath: () => mocks.activeProjectPath }))
vi.mock('../../services/project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext: vi.fn((session: { projectId: string; leaseId: string; projectPath: string }, currentPath: string) => {
      if (!session || session.projectPath !== currentPath || currentPath !== mocks.activeProjectPath) throw new Error('项目会话或租约已失效')
      return { rootPath: currentPath, session }
    }),
  },
}))

import { registerImportController } from '../import-controller'
import { ExternalFileGrantService } from '../../services/external-file-grant-service'
import { ImportInspectionStore } from '../../services/import-inspection-store'
import { nodeTestSecureFileSystem } from '../../../test/helpers/node-test-secure-file-system'
import type { ProjectSessionContext } from '../../../src/shared/ipc-channels'

type Handler = (...args: unknown[]) => Promise<unknown>
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chapter-markdown-import-'))
const projectPath = path.join(temporaryRoot, 'isolated-project')
const sourcePath = path.join(temporaryRoot, 'sources')
const session: ProjectSessionContext = { projectId: 'markdown-import-project', leaseId: 'markdown-import-lease', projectPath }
let grants: ExternalFileGrantService
let inspections: ImportInspectionStore

function handler(channel: string): Handler {
  const value = mocks.handlers.get(channel)
  if (!value) throw new Error(`Missing IPC handler: ${channel}`)
  return value
}

function event() {
  return { sender: { id: 812, once: vi.fn() } }
}

function register(limits: { maxTotalBytes?: number } = {}) {
  registerImportController(
    nodeTestSecureFileSystem,
    filePath => ({ canonicalLocation: filePath }),
    limits,
    grants,
    inspections,
    Buffer.alloc(32, 29),
  )
}

beforeEach(() => {
  fs.mkdirSync(projectPath, { recursive: true })
  fs.mkdirSync(sourcePath, { recursive: true })
  mocks.handlers.clear()
  mocks.showOpenDialog.mockReset()
  mocks.activeProjectPath = projectPath
  grants = new ExternalFileGrantService()
  inspections = new ImportInspectionStore()
  register()
})

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true })
  fs.rmSync(sourcePath, { recursive: true, force: true })
})

describe('authorized chapter Markdown selection and preview', () => {
  it('reads .md and .markdown via external read grants and returns chapter facts without changing source bytes', async () => {
    const md = path.join(sourcePath, 'chapters.md')
    const markdown = path.join(sourcePath, '第3章-港口.markdown')
    const source1 = '# Chapter 1: Arrival\r\nFirst body\r\nsecond line'
    const source2 = '不带标题的单章正文'
    fs.writeFileSync(md, source1, 'utf8')
    fs.writeFileSync(markdown, source2, 'utf8')
    const before = [fs.readFileSync(md), fs.readFileSync(markdown)]
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [md, markdown] })

    const result = await handler('dialog:select-chapter-markdown-files')(event(), session) as {
      inspectionId: string; chapters: Array<{ number: number; title: string; contentLength: number }>; sourceNames: string[]
    }
    expect(result.chapters.map(chapter => [chapter.number, chapter.title])).toEqual([[1, 'Arrival'], [3, '港口']])
    expect(result.chapters[0]?.contentLength).toBe('First body\nsecond line'.length)
    expect(result.sourceNames).toEqual(['chapters.md', '第3章-港口.markdown'])
    expect(fs.readFileSync(md)).toEqual(before[0])
    expect(fs.readFileSync(markdown)).toEqual(before[1])
  })

  it('reports empty, missing chapter number, duplicate numbers, and invalid UTF-8 files before issuing a preview', async () => {
    const empty = path.join(sourcePath, '第1章-empty.md')
    fs.writeFileSync(empty, '')
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [empty] })
    await expect(handler('dialog:select-chapter-markdown-files')(event(), session)).resolves.toMatchObject({ success: false, error: expect.stringContaining('文件为空') })

    const unnumbered = path.join(sourcePath, 'notes.markdown')
    fs.writeFileSync(unnumbered, '这不是章节标题，也没有章号文件名', 'utf8')
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [unnumbered] })
    await expect(handler('dialog:select-chapter-markdown-files')(event(), session)).resolves.toMatchObject({ success: false, error: expect.stringContaining('文件名没有章号') })

    const duplicate = path.join(sourcePath, 'duplicate.md')
    fs.writeFileSync(duplicate, '# 第2章 一\n正文\n# 第2章 二\n又一段正文', 'utf8')
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [duplicate] })
    await expect(handler('dialog:select-chapter-markdown-files')(event(), session)).resolves.toMatchObject({ success: false, error: expect.stringContaining('重复章号') })

    const badUtf8 = path.join(sourcePath, 'invalid.md')
    const invalidBytes = Buffer.from([0x23, 0x20, 0xff, 0xfe])
    fs.writeFileSync(badUtf8, invalidBytes)
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [badUtf8] })
    await expect(handler('dialog:select-chapter-markdown-files')(event(), session)).resolves.toMatchObject({ success: false, error: expect.stringContaining('不是有效的 UTF-8') })
    expect(fs.readFileSync(badUtf8)).toEqual(invalidBytes)
  })

  it('rejects an over-limit file and a project switch during the native file dialog', async () => {
    const large = path.join(sourcePath, '第1章.md')
    fs.writeFileSync(large, '# 第1章 标题\n正文超过限额')
    register({ maxTotalBytes: 8 })
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [large] })
    await expect(handler('dialog:select-chapter-markdown-files')(event(), session)).resolves.toMatchObject({ success: false, error: expect.stringContaining('超过上限') })

    register()
    mocks.showOpenDialog.mockImplementationOnce(async () => {
      mocks.activeProjectPath = path.join(temporaryRoot, 'other-project')
      return { canceled: false, filePaths: [large] }
    })
    await expect(handler('dialog:select-chapter-markdown-files')(event(), session)).resolves.toMatchObject({ success: false, error: expect.stringContaining('会话或租约已失效') })
  })
})
