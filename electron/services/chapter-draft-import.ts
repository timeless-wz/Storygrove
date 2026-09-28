import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { countDraftUnits } from '../../src/shared/draft-units'

const MAX_IMPORT_BYTES = 128 * 1024 * 1024
const MAX_CHAPTERS = 5_000
const INSPECTION_TTL_MS = 10 * 60 * 1_000

export interface ChapterDraftImportChapter {
  number: number
  title: string
  content: string
  wordCount: number
  contentLength: number
  contentHash: string
}

export interface ChapterDraftImportPreview {
  inspectionId: string
  sourceNames: string[]
  totalBytes: number
  chapters: Array<Pick<ChapterDraftImportChapter, 'number' | 'title' | 'wordCount' | 'contentLength'>>
}

interface ChapterDraftImportInspection {
  webContentsId: number
  projectId: string
  projectPath: string
  leaseId: string
  chapters: ChapterDraftImportChapter[]
  summary: ChapterDraftImportPreview
  expiresAt: number
}

function chineseNumber(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value)
  const digit: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1_000 }
  let total = 0
  let section = 0
  let current = 0
  for (const char of value) {
    if (char in digit) current = digit[char]!
    else if (char in unit) {
      const magnitude = unit[char]!
      if (magnitude === 1_000) {
        section += (current || 1) * magnitude
        total += section
        section = 0
      } else section += (current || 1) * magnitude
      current = 0
    }
  }
  return total + section + current
}

function heading(line: string): { number: number; title: string } | null {
  const value = line.trim()
  const match = value.match(/^\s{0,3}(?:#{1,6}[ \t]+)?(?:第([一二两三四五六七八九十百千零〇\d]+)章|Chapter[ \t]+(\d+))(?=$|[ \t:：·—-])(?:[ \t:：·—-]*(.*?))?[ \t]*#*[ \t]*$/iu)
  if (!match) return null
  const number = chineseNumber(match[1] ?? match[2] ?? '')
  if (!Number.isSafeInteger(number) || number < 1) return null
  return { number, title: (match[3] ?? '').trim() }
}

function filenameChapter(fileName: string): { number: number; title: string } | null {
  const base = path.basename(fileName, path.extname(fileName)).trim()
  const match = base.match(/^(?:第([一二两三四五六七八九十百千零〇\d]+)章|Chapter[ _-]*(\d+))(?:[ _：:-]*(.*))?$/iu)
  if (!match) return null
  const number = chineseNumber(match[1] ?? match[2] ?? '')
  return Number.isSafeInteger(number) && number > 0
    ? { number, title: (match[3] ?? '').trim() }
    : null
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Parse UTF-8 Markdown while retaining body line endings and rejecting ambiguous chapter numbering. */
export function parseChapterMarkdownFiles(
  files: readonly { fileName: string; content: string }[],
): ChapterDraftImportChapter[] {
  if (files.length === 0) throw new Error('请至少选择一个 Markdown 文件')
  const chapters: ChapterDraftImportChapter[] = []
  for (const file of files) {
    if (!/\.(md|markdown)$/iu.test(file.fileName)) throw new Error(`仅支持 .md / .markdown：${file.fileName}`)
    const source = file.content.replace(/^\uFEFF/u, '')
    if (!source.trim()) throw new Error(`文件为空：${file.fileName}`)
    const lines = source.split(/\r?\n/u)
    const headings = lines.map((line, index) => ({ line, index, parsed: heading(line) }))
      .filter((item): item is { line: string; index: number; parsed: { number: number; title: string } } => item.parsed !== null)
    if (headings.length === 0) {
      const inferred = filenameChapter(file.fileName)
      if (!inferred) throw new Error(`未发现章节标题，且文件名没有章号：${file.fileName}。请在 Markdown 中加入“# 第N章 标题”。`)
      const content = source.replace(/\r\n?/gu, '\n')
      chapters.push({
        ...inferred,
        content,
        wordCount: countDraftUnits(content),
        contentLength: content.length,
        contentHash: sha256(content),
      })
      continue
    }
    if (lines.slice(0, headings[0]!.index).some(line => line.trim())) {
      throw new Error(`第一个章节标题前存在未归属内容：${file.fileName}。请将前言单独整理为有章号的章节。`)
    }
    headings.forEach((item, index) => {
      const next = headings[index + 1]
      const end = next?.index ?? lines.length
      const content = lines.slice(item.index + 1, end).join('\n').replace(/^\n+|\n+$/gu, '')
      if (!content.trim()) throw new Error(`第 ${item.parsed.number} 章没有正文：${file.fileName}`)
      chapters.push({
        number: item.parsed.number,
        title: item.parsed.title,
        content,
        wordCount: countDraftUnits(content),
        contentLength: content.length,
        contentHash: sha256(content),
      })
    })
  }
  if (chapters.length > MAX_CHAPTERS) throw new Error(`章节数超过上限 ${MAX_CHAPTERS}`)
  const seen = new Set<number>()
  for (const chapter of chapters) {
    if (seen.has(chapter.number)) throw new Error(`重复章号：第 ${chapter.number} 章。请修正后重新选择。`)
    seen.add(chapter.number)
    if (Buffer.byteLength(chapter.content, 'utf8') > MAX_IMPORT_BYTES) throw new Error(`单章正文超过安全上限：第 ${chapter.number} 章`)
  }
  return chapters.sort((left, right) => left.number - right.number)
}

export class ChapterDraftImportInspectionStore {
  private readonly inspections = new Map<string, ChapterDraftImportInspection>()

  create(input: {
    webContentsId: number
    projectSession: ProjectSessionContext
    sourceNames: string[]
    totalBytes: number
    chapters: ChapterDraftImportChapter[]
  }): ChapterDraftImportPreview {
    this.removeExpired()
    if (input.totalBytes > MAX_IMPORT_BYTES) throw new Error('所选 Markdown 文件总大小超过 128 MiB')
    if (!input.chapters.length || input.chapters.length > MAX_CHAPTERS) throw new Error('没有可导入的章节正文')
    if (input.sourceNames.length === 0 || input.sourceNames.some(name => !name || name.includes('/') || name.includes('\\'))) {
      throw new Error('Markdown 来源文件名无效')
    }
    for (const [id, inspection] of this.inspections) {
      if (inspection.webContentsId === input.webContentsId) this.inspections.delete(id)
    }
    const inspectionId = randomUUID()
    const summary: ChapterDraftImportPreview = {
      inspectionId,
      sourceNames: [...input.sourceNames],
      totalBytes: input.totalBytes,
      chapters: input.chapters.map(({ number, title, wordCount, contentLength }) => ({ number, title, wordCount, contentLength })),
    }
    this.inspections.set(inspectionId, {
      webContentsId: input.webContentsId,
      projectId: input.projectSession.projectId,
      projectPath: input.projectSession.projectPath,
      leaseId: input.projectSession.leaseId,
      chapters: input.chapters.map(chapter => ({ ...chapter })),
      summary,
      expiresAt: Date.now() + INSPECTION_TTL_MS,
    })
    return summary
  }

  consume(inspectionId: string, webContentsId: number, projectSession: ProjectSessionContext): ChapterDraftImportChapter[] {
    this.removeExpired()
    const inspection = this.inspections.get(inspectionId)
    if (!inspection || inspection.webContentsId !== webContentsId) throw new Error('导入预览已失效，请重新选择文件')
    if (inspection.projectId !== projectSession.projectId
      || inspection.projectPath !== projectSession.projectPath
      || inspection.leaseId !== projectSession.leaseId) {
      throw new Error('项目已切换，原导入预览已取消，请重新选择文件')
    }
    this.inspections.delete(inspectionId)
    return inspection.chapters.map(chapter => ({ ...chapter }))
  }

  revokeForWebContents(webContentsId: number): void {
    for (const [id, inspection] of this.inspections) {
      if (inspection.webContentsId === webContentsId) this.inspections.delete(id)
    }
  }

  private removeExpired(): void {
    const now = Date.now()
    for (const [id, inspection] of this.inspections) {
      if (inspection.expiresAt <= now) this.inspections.delete(id)
    }
  }
}

export const chapterDraftImportInspectionStore = new ChapterDraftImportInspectionStore()
