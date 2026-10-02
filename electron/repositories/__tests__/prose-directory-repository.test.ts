import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { BlueprintRepository } from '../blueprint-repository'
import { DraftRepository } from '../draft-repository'
import { ProseDirectoryRepository as Directory } from '../prose-directory-repository'
import { ChapterVolumeRepository } from '../chapter-volume-repository'
import { FinalizationService } from '../../services/finalization-service'
import { directoryProjectionFiles, syncDirectoryProjections } from '../../services/prose-directory-projection'

let root: string
const publish = new FinalizationService({ publisher: { publish: async () => {} } })
function create(n: number, volumeId = 'a', content = `正文${n}`) {
  return DraftRepository.create({ chapterNumber: n, volumeId, chapterTitle: `标题${n}`, source: 'write', content, wordCount: content.length })
}
async function finalize(id: number, expectedCurrentDraftId?: number | null) {
  const draft = DraftRepository.getFull(id)!
  return publish.finalize({ projectRoot: root, draftId: id, chapterNumber: draft.chapterNumber, chapterTitle: draft.chapterTitle!, content: draft.content, contentRevision: 0, expectedCurrentDraftId })
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-directory-'))
  initProjectDatabase(root)
  BlueprintRepository.upsertVolume({ id: 'a', name: '第一卷', sortOrder: 1 })
  BlueprintRepository.upsertVolume({ id: 'b', name: '第二卷', sortOrder: 2 })
})
afterEach(() => { closeProjectDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

it('allows several candidates and replaces exactly one current manuscript only after confirmation', async () => {
  const first = create(1), second = create(1, 'b', '候选稿')
  expect(DraftRepository.listByChapter(1)).toHaveLength(2)
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 1, volumeId: 'a' }])
  expect((await finalize(first)).success).toBe(true)
  expect((await finalize(second)).committed).toBe(false)
  expect((await finalize(second, first)).success).toBe(true)
  expect(DraftRepository.getMeta(first)?.status).toBe('draft')
  expect(DraftRepository.getFinalizedByChapter(1)?.id).toBe(second)
  expect((await finalize(first, second)).success).toBe(true)
  expect(DraftRepository.listAll().filter(d => d.status === 'finalized')).toHaveLength(1)
})

it('keeps legacy explicit volume ownership when adding a candidate from another volume', () => {
  BlueprintRepository.upsert({ chapterNumber: 5, title: '旧章节', volumeId: 'a', purpose: '', keyEvents: '', suspenseHook: '', role: '', characters: [], userGuidance: '', notes: '', notesUpdatedAt: '' })
  DraftRepository.create({ chapterNumber: 5, blueprintChapterNumber: 5, source: 'write', content: '旧稿', wordCount: 2 })
  create(5, 'b', '新候选')
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 5, volumeId: 'a' }])
  expect(DraftRepository.listByChapter(5)).toHaveLength(2)
})

it('preserves a replaced manuscript title even when the draft had no imported title', async () => {
  const old = DraftRepository.create({ chapterNumber: 9, volumeId: 'a', source: 'write', content: '旧正文', wordCount: 3 })
  await publish.finalize({ projectRoot: root, draftId: old, chapterNumber: 9, chapterTitle: '原正式章名', content: '旧正文', contentRevision: 0 })
  const next = create(9)
  await finalize(next, old)
  expect(DraftRepository.getMeta(old)).toMatchObject({ status: 'draft', chapterTitle: '原正式章名' })
})

it('inserts and moves chapters across volumes with continuous book numbering and stable content identities', async () => {
  const one = create(1), two = create(2), three = create(3, 'b')
  for (const id of [one, two, three]) expect((await finalize(id)).success).toBe(true)
  const inserted = DraftRepository.create({ chapterNumber: 4, chapterTitle: '插入', volumeId: 'a', insertRelativeTo: 2, insertSide: 'before', source: 'write', content: '新正文', wordCount: 3 })
  await finalize(inserted)
  expect(Directory.order().filter(r => r.displayNumber).map(r => [r.chapterNumber, r.displayNumber])).toEqual([[1, 1], [4, 2], [2, 3], [3, 4]])
  Directory.act({ type: 'relocate', chapterNumber: 3, volumeId: 'a', relativeTo: 1, side: 'before' })
  expect(Directory.order().filter(r => r.displayNumber).map(r => r.chapterNumber)).toEqual([3, 1, 4, 2])
  expect(DraftRepository.getFull(two)?.content).toBe('正文2')
  expect(DraftRepository.getMeta(two)?.chapterNumber).toBe(2)
  expect(DraftRepository.getMeta(two)?.displayNumber).toBe(4)
  closeProjectDatabase(); initProjectDatabase(root)
  expect(Directory.order().filter(r => r.displayNumber).map(r => r.chapterNumber)).toEqual([3, 1, 4, 2])
})

it('soft deletes and restores manuscript content, records and position across project reopen', async () => {
  const one = create(1), two = create(2)
  await finalize(one); await finalize(two)
  const trashId = Directory.act({ type: 'trash-draft', draftId: one })!
  expect(DraftRepository.getMeta(one)).toBeNull()
  expect(() => DraftRepository.updateContent(one, '过期编辑器的输入', 8)).toThrow('回收站')
  expect(DraftRepository.listAll().map(d => d.id)).toEqual([two])
  expect(Directory.order().find(r => r.chapterNumber === 2)?.displayNumber).toBe(1)
  closeProjectDatabase(); initProjectDatabase(root)
  expect(Directory.trash()[0].id).toBe(trashId)
  Directory.act({ type: 'restore', trashId })
  expect(DraftRepository.getFull(one)).toMatchObject({ status: 'finalized', content: '正文1', displayNumber: 1 })
  expect(Directory.order().find(r => r.chapterNumber === 2)?.displayNumber).toBe(2)
})

it('restores an old manuscript as a draft when a newer manuscript is already current', async () => {
  const old = create(1); await finalize(old)
  const trashId = Directory.act({ type: 'trash-draft', draftId: old })!
  const replacement = create(1); await finalize(replacement)
  Directory.act({ type: 'restore', trashId })
  expect(DraftRepository.getMeta(old)?.status).toBe('draft')
  expect(DraftRepository.getFinalizedByChapter(1)?.id).toBe(replacement)
})

it('renames drafts and volumes without changing prose, and permanently deletes only a trashed draft', () => {
  const id = create(1)
  Directory.act({ type: 'rename-draft', draftId: id, name: '新名称' })
  Directory.act({ type: 'rename-volume', volumeId: 'a', name: '开端' })
  expect(DraftRepository.getFull(id)).toMatchObject({ chapterTitle: '新名称', content: '正文1' })
  expect(ChapterVolumeRepository.volumes().find(v => v.id === 'a')?.name).toBe('开端')
  const trashId = Directory.act({ type: 'trash-draft', draftId: id })!
  Directory.act({ type: 'purge', trashId })
  expect(Directory.trash()).toEqual([])
  expect(getProjectDb()!.prepare('SELECT 1 FROM drafts WHERE id = ?').get(id)).toBeUndefined()
})

it('undoes volume removal, preserving chapters moved elsewhere after deletion', () => {
  create(1); create(2)
  const trashId = Directory.act({ type: 'trash-volume', volumeId: 'a' })!
  expect(ChapterVolumeRepository.list().every(row => row.volumeId === null)).toBe(true)
  ChapterVolumeRepository.set(2, 'b')
  Directory.act({ type: 'restore', trashId })
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 1, volumeId: 'a' }, { chapterNumber: 2, volumeId: 'b' }])
})

it('rolls back invalid inserts and moves, preserving text and membership', () => {
  create(1)
  expect(() => DraftRepository.create({ chapterNumber: 2, volumeId: 'a', insertRelativeTo: 999, source: 'write', content: '输入', wordCount: 2 })).toThrow()
  expect(DraftRepository.listAll()).toHaveLength(1)
  expect(() => Directory.act({ type: 'relocate', chapterNumber: 1, volumeId: 'b', relativeTo: 999 })).toThrow()
  expect(ChapterVolumeRepository.list()[0].volumeId).toBe('a')
})

it('synchronizes real manuscript files after insertion, replacement, trash and restore', async () => {
  const service = new FinalizationService()
  const first = create(1), second = create(2)
  const publishReal = async (id: number, expectedCurrentDraftId?: number) => {
    const draft = DraftRepository.getFull(id)!
    const result = await service.finalize({ projectRoot: root, draftId: id, chapterNumber: draft.chapterNumber, chapterTitle: draft.chapterTitle!, content: draft.content, contentRevision: 0, expectedCurrentDraftId })
    expect(result).toMatchObject({ success: true, committed: true })
  }
  await publishReal(first); await publishReal(second)
  const inserted = DraftRepository.create({ chapterNumber: 3, volumeId: 'a', chapterTitle: '插入', insertRelativeTo: 2, source: 'write', content: '插入正文', wordCount: 4 })
  await publishReal(inserted)
  const fileNames = () => fs.readdirSync(root).filter(name => name.endsWith('.txt')).sort()
  expect(fileNames()).toEqual([`第1章 标题1 (${first}).txt`, `第2章 插入 (${inserted}).txt`, `第3章 标题2 (${second}).txt`])
  const candidate = create(1, 'a', '替换正文')
  await publishReal(candidate, first)
  expect(fileNames().some(name => name.endsWith(`(${first}).txt`))).toBe(false)
  DraftRepository.updateContent(candidate, '再次编辑的正文', 7)
  await publishReal(candidate)
  expect(fs.readFileSync(path.join(root, `第1章 标题1 (${candidate}).txt`), 'utf8')).toContain('再次编辑的正文')
  const oldFiles = directoryProjectionFiles()
  const trashId = Directory.act({ type: 'trash-draft', draftId: inserted })!
  await syncDirectoryProjections(root, oldFiles)
  expect(fileNames()).toHaveLength(2)
  expect(fileNames()).toContain(`第2章 标题2 (${second}).txt`)
  Directory.act({ type: 'restore', trashId })
  await syncDirectoryProjections(root)
  expect(fileNames()).toContain(`第3章 标题2 (${second}).txt`)
  expect(fs.readFileSync(path.join(root, `第2章 插入 (${inserted}).txt`), 'utf8')).toContain('插入正文')
  expect(fs.readdirSync(path.join(root, '.vela', 'trash', 'prose-projections')).length).toBeGreaterThan(0)
})
