import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getCurrentProjectPath, getProjectDb } from '../database'
import { ProseDirectoryRepository } from '../repositories/prose-directory-repository'
import { manuscriptPublisher, serializeManuscript } from './manuscript-publisher'

interface Projection { draft_id: number; chapter_number: number; chapter_title: string; content_snapshot: string; target_file_name: string; status: string }

export function directoryProjectionFiles(): string[] {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未连接')
  return (db.prepare('SELECT target_file_name FROM finalization_outbox').all() as Array<{ target_file_name: string }>).map(row => row.target_file_name)
}

/** Rebuild only owned manuscript projections. SQLite chapter IDs and frozen content remain unchanged. */
const projectionQueues = new Map<string, Promise<void>>()
export async function syncDirectoryProjections(projectRoot: string, previousFiles: string[] = []): Promise<void> {
  const key = path.resolve(projectRoot)
  const capturedDatabase = getProjectDb()
  const previous = projectionQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    if (!capturedDatabase || capturedDatabase !== getProjectDb()) throw new Error('项目会话已变化，停止同步实体稿')
    await rebuildDirectoryProjections(projectRoot, previousFiles)
  })
  projectionQueues.set(key, current)
  try { await current } finally { if (projectionQueues.get(key) === current) projectionQueues.delete(key) }
}

async function rebuildDirectoryProjections(projectRoot: string, previousFiles: string[]): Promise<void> {
  const db = getProjectDb()
  if (!db || path.resolve(getCurrentProjectPath() ?? '') !== path.resolve(projectRoot)) throw new Error('项目会话已变化')
  const rows = db.prepare(`SELECT f.draft_id, f.chapter_number, f.chapter_title, f.content_snapshot,
    f.target_file_name, d.status FROM finalization_outbox f JOIN drafts d ON d.id = f.draft_id`).all() as Projection[]
  const numbers = new Map(ProseDirectoryRepository.order().map(row => [row.chapterNumber, row.displayNumber]))
  const owned = new Set([...previousFiles, ...rows.map(row => row.target_file_name)])
  const root = path.resolve(projectRoot)
  const child = (name: string) => {
    const file = path.resolve(root, name)
    if (path.dirname(file) !== root || path.basename(file) !== name) throw new Error('实体稿路径无效')
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('实体稿不能是符号链接')
    return file
  }
  const active = rows.filter(row => row.status === 'finalized').map(row => {
    const number = numbers.get(row.chapter_number)
    if (!number) throw new Error('正文章节顺序缺失')
    const title = Array.from(row.chapter_title, char => char.charCodeAt(0) <= 31 ? '_' : char).join('').replace(/[<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 100)
    const fileName = `第${number}章${title ? ` ${title}` : ''} (${row.draft_id}).txt`
    const file = child(fileName)
    if (fs.existsSync(file) && !owned.has(fileName)) throw new Error('正文目标已有非本程序管理的文件，已拒绝覆盖')
    return { ...row, number, fileName }
  })
  const archive = (file: string, name: string) => {
    const trashRoot = path.join(root, '.vela', 'trash', 'prose-projections')
    fs.mkdirSync(trashRoot, { recursive: true })
    if (path.relative(root, fs.realpathSync(trashRoot)).startsWith('..')) throw new Error('回收站路径越出项目')
    fs.renameSync(file, path.join(trashRoot, `${randomUUID()}-${name}`))
  }
  const retained = new Set(active.map(row => row.fileName))
  for (const name of owned) {
    const file = child(name)
    if (retained.has(name) || !fs.existsSync(file)) continue
    archive(file, name)
  }
  for (const row of active) {
    if (getProjectDb() !== db) throw new Error('项目会话已变化，停止同步实体稿')
    const file = child(row.fileName)
    const expected = serializeManuscript({ chapterNumber: row.number, chapterTitle: row.chapter_title, content: row.content_snapshot })
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== expected) archive(file, row.fileName)
    await manuscriptPublisher.publish({ projectRoot, targetFileName: row.fileName, chapterNumber: row.number, chapterTitle: row.chapter_title, content: row.content_snapshot })
    if (getProjectDb() !== db) throw new Error('项目会话已变化，停止同步实体稿')
    db.prepare('UPDATE finalization_outbox SET target_file_name = ? WHERE draft_id = ?').run(row.fileName, row.draft_id)
  }
}
