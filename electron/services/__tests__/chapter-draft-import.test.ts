import { describe, expect, it } from 'vitest'
import {
  ChapterDraftImportInspectionStore,
  parseChapterMarkdownFiles,
} from '../chapter-draft-import'
import type { ProjectSessionContext } from '../../../src/shared/ipc-channels'

const session: ProjectSessionContext = {
  projectId: 'isolated-test-project',
  projectPath: 'C:/temporary/isolated-test-project',
  leaseId: 'lease-test-1',
}

describe('chapter Markdown import parsing and preview lease', () => {
  it('parses numbered .md and .markdown headings and retains body line breaks', () => {
    expect(parseChapterMarkdownFiles([
      { fileName: 'story.md', content: '# 第2章 夜航\n\n第一行\n第二行' },
      { fileName: '第1章-开端.markdown', content: '未编号标题的单章正文\n仍保留第二行' },
    ])).toEqual([
      expect.objectContaining({ number: 1, title: '开端', content: '未编号标题的单章正文\n仍保留第二行' }),
      expect.objectContaining({ number: 2, title: '夜航', content: '第一行\n第二行' }),
    ])
  })

  it('rejects empty files, unnumbered files without chapter headings, duplicate numbers, and empty chapter bodies', () => {
    expect(() => parseChapterMarkdownFiles([{ fileName: 'empty.md', content: ' \n' }])).toThrow(/文件为空/u)
    expect(() => parseChapterMarkdownFiles([{ fileName: 'notes.markdown', content: '只是自由笔记' }])).toThrow(/未发现章节标题/u)
    expect(() => parseChapterMarkdownFiles([
      { fileName: 'a.md', content: '# 第3章 甲\n正文甲' },
      { fileName: 'b.markdown', content: '# Chapter 3: Beta\nBody beta' },
    ])).toThrow(/重复章号/u)
    expect(() => parseChapterMarkdownFiles([{ fileName: 'body.md', content: '# 第4章 空章\n\n# 第5章 后章\n有正文' }])).toThrow(/没有正文/u)
  })

  it('requires a chapter number in a no-heading filename and rejects non-Markdown extensions', () => {
    expect(() => parseChapterMarkdownFiles([{ fileName: 'uncertain.txt', content: '正文' }])).toThrow(/仅支持/u)
    expect(() => parseChapterMarkdownFiles([{ fileName: 'untitled.md', content: '正文' }])).toThrow(/文件名没有章号/u)
    expect(parseChapterMarkdownFiles([{ fileName: 'Chapter-12-Arrival.md', content: 'Opening\n\nNext line' }]))
      .toEqual([expect.objectContaining({ number: 12, title: 'Arrival', content: 'Opening\n\nNext line' })])
  })

  it('binds preview tokens to the selecting window and frozen project lease', () => {
    const store = new ChapterDraftImportInspectionStore()
    const chapters = parseChapterMarkdownFiles([{ fileName: '第1章.md', content: '正文' }])
    const preview = store.create({
      webContentsId: 7,
      projectSession: session,
      sourceNames: ['第1章.md'],
      totalBytes: 6,
      chapters,
    })
    expect(preview.chapters).toEqual([{ number: 1, title: '', wordCount: 2, contentLength: 2 }])
    expect(() => store.consume(preview.inspectionId, 8, session)).toThrow(/预览已失效/u)
    expect(() => store.consume(preview.inspectionId, 7, { ...session, leaseId: 'lease-test-2' })).toThrow(/项目已切换/u)
    expect(store.consume(preview.inspectionId, 7, session)[0]?.content).toBe('正文')
    expect(() => store.consume(preview.inspectionId, 7, session)).toThrow(/预览已失效/u)
  })

  it('rejects oversized source metadata before retaining preview content', () => {
    const store = new ChapterDraftImportInspectionStore()
    const chapters = parseChapterMarkdownFiles([{ fileName: '第1章.md', content: '正文' }])
    expect(() => store.create({
      webContentsId: 7,
      projectSession: session,
      sourceNames: ['第1章.md'],
      totalBytes: 128 * 1024 * 1024 + 1,
      chapters,
    })).toThrow(/超过 128 MiB/u)
  })
})
