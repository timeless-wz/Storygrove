import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { DraftRepository } from '../draft-repository'
import { BlueprintRepository } from '../blueprint-repository'
import { ChapterVolumeRepository } from '../chapter-volume-repository'
import { FinalizationRepository } from '../finalization-repository'

let root = ''
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-prose-volume-'))
  initProjectDatabase(root)
  BlueprintRepository.upsertVolume({ id: 'vol-a', name: '第1卷', sortOrder: 1 })
  BlueprintRepository.upsertVolume({ id: 'vol-b', name: '第2卷', sortOrder: 2 })
})
afterEach(() => { closeProjectDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

it('creates free prose in a volume atomically and preserves it through finalization and reopen', () => {
  const content = '没有蓝图的正文。'
  const id = DraftRepository.create({ chapterNumber: 1, volumeId: 'vol-a', source: 'write', content, wordCount: 9 })
  expect(DraftRepository.getMeta(id)?.blueprintChapterNumber).toBeUndefined()
  expect(BlueprintRepository.getAll()).toEqual([])
  FinalizationRepository.commit({ finalizationId: 'prose-volume-finalize', draftId: id, chapterNumber: 1,
    chapterTitle: '自由创作', content, contentHash: createHash('sha256').update(content).digest('hex'),
    contentRevision: 1, targetFileName: 'chapter-1.md' })
  closeProjectDatabase()
  initProjectDatabase(root)
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 1, volumeId: 'vol-a' }])
  expect(DraftRepository.getFull(id)).toMatchObject({ status: 'finalized', content })
  expect(BlueprintRepository.getAll()).toEqual([])
})

it('moves all versions together and supports explicit unassigned without changing prose or blueprints', () => {
  const params = { chapterNumber: 2, source: 'write' as const, content: '旧稿', wordCount: 2 }
  const id = DraftRepository.create({ ...params, volumeId: 'vol-a' })
  DraftRepository.create({ ...params, content: '新稿' })
  ChapterVolumeRepository.set(2, 'vol-b')
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 2, volumeId: 'vol-b' }])
  ChapterVolumeRepository.set(2, null)
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 2, volumeId: null }])
  expect(DraftRepository.getFull(id)?.content).toBe('旧稿')
  expect(DraftRepository.listByChapter(2)).toHaveLength(2)
  expect(BlueprintRepository.getAll()).toEqual([])
})

it('rolls back draft and body creation when the requested volume does not exist', () => {
  const db = getProjectDb()!
  const before = db.prepare('SELECT COUNT(*) AS count FROM contents').get()
  expect(() => DraftRepository.create({ chapterNumber: 3, volumeId: 'missing', source: 'write', content: '不能孤立保存', wordCount: 6 })).toThrow('卷不存在')
  expect(DraftRepository.listAll()).toEqual([])
  expect(db.prepare('SELECT COUNT(*) AS count FROM contents').get()).toEqual(before)
  expect(() => ChapterVolumeRepository.set(99, 'vol-a')).toThrow('正文章节不存在')
})

it('rejects occupied chapter numbers without moving existing prose and clears assignments with deleted drafts', () => {
  const params = { chapterNumber: 5, source: 'write' as const, content: '保留正文', wordCount: 4 }
  const id = DraftRepository.create({ ...params, volumeId: 'vol-a' })
  expect(() => DraftRepository.create({ ...params, volumeId: 'vol-b' })).toThrow('章节号已存在')
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 5, volumeId: 'vol-a' }])
  DraftRepository.delete(id)
  expect(ChapterVolumeRepository.list()).toEqual([])
})

it('persists a chapter name independently of blueprints and retains it after reopening', () => {
  const id = DraftRepository.create({ chapterNumber: 8, chapterTitle: '带名称的章节', volumeId: 'vol-a', source: 'write', content: '', wordCount: 0 })
  closeProjectDatabase()
  initProjectDatabase(root)
  expect(DraftRepository.getMeta(id)?.chapterTitle).toBe('带名称的章节')
  expect(BlueprintRepository.getAll()).toEqual([])
})

it('deletes default and custom prose volumes without deleting drafts or recreating them on reopen', () => {
  const a = DraftRepository.create({ chapterNumber: 10, volumeId: 'volume-1', chapterTitle: '保留一', source: 'write', content: '第一卷正文', wordCount: 5 })
  const b = DraftRepository.create({ chapterNumber: 11, volumeId: 'vol-a', chapterTitle: '保留二', source: 'write', content: '第二卷正文', wordCount: 5 })
  ChapterVolumeRepository.deleteVolume('volume-1')
  ChapterVolumeRepository.deleteVolume('vol-a')
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 10, volumeId: null }, { chapterNumber: 11, volumeId: null }])
  closeProjectDatabase()
  initProjectDatabase(root)
  expect(ChapterVolumeRepository.volumes().map(volume => volume.id)).not.toContain('volume-1')
  expect(ChapterVolumeRepository.volumes().map(volume => volume.id)).not.toContain('vol-a')
  expect(DraftRepository.getFull(a)?.content).toBe('第一卷正文')
  expect(DraftRepository.getFull(b)?.content).toBe('第二卷正文')
  expect(() => ChapterVolumeRepository.set(10, 'vol-a')).toThrow('卷不存在')
})

it('moves legacy bound prose to unassigned when removing a volume while preserving blueprint content', () => {
  const blueprint = { chapterNumber: 1, volumeId: 'vol-a', title: '蓝图原名', role: '', purpose: '保留规划', keyEvents: '', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' }
  BlueprintRepository.upsert(blueprint)
  const id = DraftRepository.create({ chapterNumber: 12, blueprintChapterNumber: 1, source: 'write', content: '保留正文', wordCount: 4 })
  ChapterVolumeRepository.deleteVolume('vol-a')
  expect(ChapterVolumeRepository.list()).toEqual([{ chapterNumber: 12, volumeId: null }])
  expect(DraftRepository.getFull(id)?.content).toBe('保留正文')
  expect(BlueprintRepository.getByChapter(1)).toMatchObject({ volumeId: 'vol-a', title: '蓝图原名', purpose: '保留规划' })
})
