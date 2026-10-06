import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeProjectDatabase, initProjectDatabase } from '../database'
import { DraftRepository } from '../repositories/draft-repository'
import { parseChapterMarkdownFiles } from '../services/chapter-draft-import'
import { ipc } from '../../src/services/ipc-client'
import { exportSelectedMarkdown } from '../../src/services/export-service'
import { setActiveProjectSessionContext } from '../../src/shared/project-session-context'
import { useLocaleStore } from '../../src/stores/locale-store'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'

vi.mock('../../src/services/ipc-client', () => ({
  ipc: { invoke: vi.fn(), invokeWithProjectSession: vi.fn() },
}))

let tempRoot = ''

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

afterEach(() => {
  setActiveProjectSessionContext(null)
  closeProjectDatabase()
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = ''
  vi.clearAllMocks()
})

describe('isolated Markdown project import, database reopen, and export', () => {
  it('persists an imported chapter title and body in SQLite, reopens it, and writes a UTF-8 Markdown export', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-markdown-project-integration-'))
    const projectPath = path.join(tempRoot, 'isolated-project')
    const inputPath = path.join(tempRoot, '第8章-灯塔.md')
    const outputRoot = path.join(tempRoot, 'exports')
    fs.mkdirSync(projectPath, { recursive: true })
    fs.mkdirSync(outputRoot, { recursive: true })
    fs.writeFileSync(inputPath, '# 第8章 灯塔\n\nCafé 亮起。\n潮声越过堤岸。', 'utf8')

    const parsed = parseChapterMarkdownFiles([{
      fileName: path.basename(inputPath),
      content: fs.readFileSync(inputPath, 'utf8'),
    }])[0]!
    const session: ProjectSessionContext = {
      projectId: 'isolated-markdown-project',
      projectPath,
      leaseId: 'isolated-markdown-lease',
    }
    const project = {
      id: session.projectId,
      path: projectPath,
      sessionLease: session.leaseId,
      name: '隔离验证小说',
      novelConfig: { genre: '测试', targetAudience: '测试', writingLanguage: 'zh-CN' as const },
    }
    setActiveProjectSessionContext(session)
    useLocaleStore.setState({ locale: 'zh-CN' })

    initProjectDatabase(projectPath)
    const [created] = DraftRepository.createImportedBatch([{
      chapterNumber: parsed.number,
      title: parsed.title,
      content: parsed.content,
      wordCount: parsed.wordCount,
    }])
    expect(created).toMatchObject({ chapterNumber: 8, version: 1 })

    closeProjectDatabase()
    initProjectDatabase(projectPath)
    const persisted = DraftRepository.getFull(created!.id)
    expect(persisted).toMatchObject({
      chapterNumber: 8,
      version: 1,
      status: 'draft',
      chapterTitle: '灯塔',
      content: 'Café 亮起。\n潮声越过堤岸。',
    })

    let frozenReceipt: Array<Record<string, unknown>> = []
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (_context: ProjectSessionContext, channel: string, ...args: unknown[]) => {
      if (channel === 'db:draft-export-selection') {
        const requested = args[0] as Array<{ draftId: number; kind: 'draft' | 'finalized' }>
        const chapters = requested.map(item => {
          const draft = DraftRepository.getFull(item.draftId)!
          if (draft.status !== 'draft') throw new Error('unexpected status')
          return {
            draftId: draft.id,
            kind: 'draft' as const,
            chapterNumber: draft.chapterNumber,
            version: draft.version,
            status: draft.status,
            title: draft.chapterTitle ?? '',
            titleHash: sha256(draft.chapterTitle ?? ''),
            content: draft.content,
            contentHash: sha256(draft.content),
            finalizationId: null,
          }
        })
        frozenReceipt = chapters.map(({ draftId, kind, chapterNumber, version, status, titleHash, contentHash, finalizationId }) => ({
          draftId, kind, chapterNumber, version, status, titleHash, contentHash, finalizationId,
        }))
        return { chapters, receipt: frozenReceipt } as never
      }
      if (channel === 'db:draft-export-selection-current') return true as never
      if (channel === 'db:prose-order') return [] as never
      throw new Error(`Unexpected database IPC: ${channel}`)
    }) as never)
    vi.mocked(ipc.invoke).mockImplementation(async (channel, ...args) => {
      const grantId = args[0]
      if (grantId !== 'test-only-grant') throw new Error('unexpected file grant')
      const relativePath = String(args[1])
      if (channel === 'fs:grant-mkdir') {
        fs.mkdirSync(path.join(outputRoot, ...relativePath.split('/')), { recursive: true })
        return { success: true } as never
      }
      if (channel === 'fs:grant-write-file') {
        const target = path.join(outputRoot, ...relativePath.split('/'))
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, String(args[2]), 'utf8')
        return { success: true, commitState: 'committed' } as never
      }
      throw new Error(`Unexpected file IPC: ${String(channel)}`)
    })

    const receipt = [{
      draftId: persisted!.id,
      kind: 'draft' as const,
      chapterNumber: persisted!.chapterNumber,
      version: persisted!.version,
      status: persisted!.status,
      contentHash: sha256(persisted!.content),
      titleHash: sha256(persisted!.chapterTitle ?? ''),
      finalizationId: null,
    }]
    const result = await exportSelectedMarkdown({
      range: 'chapter',
      format: 'merged-md',
      grantId: 'test-only-grant',
      selections: [{ draftId: persisted!.id, kind: 'draft' }],
    }, project, session, receipt)

    expect(result.success).toBe(true)
    const filePath = path.join(outputRoot, ...result.path!.split('/'))
    const bytes = fs.readFileSync(filePath)
    const exported = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    expect(exported).toBe('# 第8章 灯塔\n\nCafé 亮起。\n潮声越过堤岸。')
    expect(frozenReceipt).toHaveLength(1)
    expect(fs.readFileSync(inputPath, 'utf8')).toBe('# 第8章 灯塔\n\nCafé 亮起。\n潮声越过堤岸。')
  })
})
