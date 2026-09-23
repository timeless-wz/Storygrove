import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase, getProjectDb } from '../../database'
import { DraftRepository } from '../draft-repository'
import { ForeshadowingRepository } from '../foreshadowing-repository'

let projectRoot = ''

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-fsh-test-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
  fs.rmSync(projectRoot, { recursive: true, force: true })
})

describe('ForeshadowingRepository', () => {
  it('creates and lists foreshadowings with default status', () => {
    const draftId = DraftRepository.create({
      chapterNumber: 1,
      version: 1,
      source: 'write',
      content: '夜色如墨，李玄机握紧了手中的青铜残片。',
      wordCount: 20,
    })

    const id = ForeshadowingRepository.create({
      draftId,
      chapterNumber: 1,
      selectedText: '青铜残片',
      startOffset: 16,
      endOffset: 20,
      contextBefore: '握紧了手中的',
      contextAfter: '。',
      note: '师尊临终遗物，第十章解开身世之谜',
      markerType: 'foreshadowing',
      color: 'blue',
    })

    expect(id).toBeDefined()

    const list = ForeshadowingRepository.listAll()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id,
      draftId,
      chapterNumber: 1,
      selectedText: '青铜残片',
      startOffset: 16,
      endOffset: 20,
      contextBefore: '握紧了手中的',
      contextAfter: '。',
      note: '师尊临终遗物，第十章解开身世之谜',
      markerType: 'foreshadowing',
      color: 'blue',
      completed: false,
      completedAt: null,
      sourceType: 'draft',
    })
  })

  it('filters foreshadowings by completion state and tracks completed_at', () => {
    const draftId = DraftRepository.create({
      chapterNumber: 2,
      source: 'write',
      content: '第二章正文...',
      wordCount: 10,
    })

    const id1 = ForeshadowingRepository.create({
      draftId,
      chapterNumber: 2,
      selectedText: '暗记',
      startOffset: 0,
      endOffset: 2,
      note: '伏笔1',
    })

    ForeshadowingRepository.create({
      draftId,
      chapterNumber: 2,
      selectedText: '秘籍',
      startOffset: 3,
      endOffset: 5,
      note: '伏笔2',
    })

    expect(ForeshadowingRepository.listAll('pending')).toHaveLength(2)
    expect(ForeshadowingRepository.listAll('completed')).toHaveLength(0)

    // Toggle id1 to completed
    ForeshadowingRepository.toggleCompleted(id1, true)
    const item1 = ForeshadowingRepository.getById(id1)
    expect(item1?.completed).toBe(true)
    expect(item1?.completedAt).toBeTruthy()

    expect(ForeshadowingRepository.listAll('pending')).toHaveLength(1)
    expect(ForeshadowingRepository.listAll('completed')).toHaveLength(1)

    // Toggle back
    ForeshadowingRepository.toggleCompleted(id1, false)
    const item1Reverted = ForeshadowingRepository.getById(id1)
    expect(item1Reverted?.completed).toBe(false)
    expect(item1Reverted?.completedAt).toBeNull()
  })

  it('updates note, marker type, and color', () => {
    const draftId = DraftRepository.create({
      chapterNumber: 3,
      source: 'write',
      content: '第三章...',
      wordCount: 10,
    })

    const id = ForeshadowingRepository.create({
      draftId,
      chapterNumber: 3,
      selectedText: '古琴',
      startOffset: 0,
      endOffset: 2,
      note: '初始说明',
      markerType: 'foreshadowing',
      color: 'blue',
    })

    ForeshadowingRepository.update(id, {
      note: '更新后的说明',
      markerType: 'deepen',
      color: 'red',
    })

    const updated = ForeshadowingRepository.getById(id)
    expect(updated?.note).toBe('更新后的说明')
    expect(updated?.markerType).toBe('deepen')
    expect(updated?.color).toBe('red')
  })

  it('deletes foreshadowings', () => {
    const draftId = DraftRepository.create({
      chapterNumber: 4,
      source: 'write',
      content: '第四章...',
      wordCount: 10,
    })

    const id = ForeshadowingRepository.create({
      draftId,
      chapterNumber: 4,
      selectedText: '玉佩',
      startOffset: 0,
      endOffset: 2,
      note: '待删除',
    })

    expect(ForeshadowingRepository.listAll()).toHaveLength(1)
    ForeshadowingRepository.delete(id)
    expect(ForeshadowingRepository.listAll()).toHaveLength(0)
  })

  it('cascades deletion when draft is deleted without leaving orphan records', () => {
    const draftId = DraftRepository.create({
      chapterNumber: 5,
      source: 'write',
      content: '第五章...',
      wordCount: 10,
    })

    ForeshadowingRepository.create({
      draftId,
      chapterNumber: 5,
      selectedText: '线索',
      startOffset: 0,
      endOffset: 2,
      note: '关联第5章',
    })

    expect(ForeshadowingRepository.listByDraft(draftId)).toHaveLength(1)

    // Delete draft
    DraftRepository.delete(draftId)

    // Foreign key cascade should remove foreshadowing
    expect(ForeshadowingRepository.listByDraft(draftId)).toHaveLength(0)
    expect(ForeshadowingRepository.listAll()).toHaveLength(0)
  })

  it('identifies published manuscript drafts as manuscript source type', () => {
    const db = getProjectDb()
    const draftId = DraftRepository.create({
      chapterNumber: 6,
      source: 'write',
      content: '第六章定稿正文...',
      wordCount: 10,
    })

    const id = ForeshadowingRepository.create({
      draftId,
      chapterNumber: 6,
      selectedText: '定稿伏笔',
      startOffset: 0,
      endOffset: 4,
      note: '正文伏笔',
    })

    expect(ForeshadowingRepository.getById(id)?.sourceType).toBe('draft')

    // Simulate draft finalization in DB
    db?.prepare("UPDATE drafts SET status = 'finalized' WHERE id = ?").run(draftId)

    expect(ForeshadowingRepository.getById(id)?.sourceType).toBe('manuscript')
  })

  it('rejects creation with empty text or invalid draftId', () => {
    expect(() => {
      ForeshadowingRepository.create({
        draftId: 99999,
        chapterNumber: 1,
        selectedText: '文本',
        startOffset: 0,
        endOffset: 2,
        note: '测试',
      })
    }).toThrow('关联草稿不存在')

    const draftId = DraftRepository.create({
      chapterNumber: 7,
      source: 'write',
      content: '内容',
      wordCount: 2,
    })

    expect(() => {
      ForeshadowingRepository.create({
        draftId,
        chapterNumber: 7,
        selectedText: '   ',
        startOffset: 0,
        endOffset: 0,
        note: '测试',
      })
    }).toThrow('选中文本不能为空')
  })
})
