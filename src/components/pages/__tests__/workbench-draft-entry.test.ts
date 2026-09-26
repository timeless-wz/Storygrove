import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DraftMeta } from '../../../services/draft-index'
import { openChapterFile } from '../../panels/sidebar/sidebar-file-openers'
import { findResumableDraft, openResumableDraft } from '../workbench-draft-entry'

vi.mock('../../panels/sidebar/sidebar-file-openers', () => ({ openChapterFile: vi.fn() }))

const draft = (id: number, chapterNumber: number, updatedAt: string, status: DraftMeta['status'] = 'draft'): DraftMeta => ({
  id,
  chapterNumber,
  version: 1,
  status,
  source: 'write',
  wordCount: 100,
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt,
  filePath: `vela://draft/${id}`,
  fileName: `draft_v1.md`,
})

afterEach(() => vi.restoreAllMocks())

describe('书斋与总览共用的继续创作入口', () => {
  it('从所有章节中选最后编辑的可编辑草稿，忽略定稿和归档稿', () => {
    const older = draft(1, 1, '2026-09-21T00:00:00Z')
    const newest = draft(2, 7, '2026-09-23T00:00:00Z', 'revised')
    expect(findResumableDraft({
      1: [older],
      2: [draft(3, 2, '2026-09-25T00:00:00Z', 'finalized')],
      7: [newest],
      8: [draft(4, 8, '2026-09-26T00:00:00Z', 'archived')],
    })).toBe(newest)
  })

  it('无可编辑草稿时交回新建草稿流程', async () => {
    expect(findResumableDraft({ 1: [draft(1, 1, '2026-09-25T00:00:00Z', 'finalized')] })).toBeNull()
    expect(await openResumableDraft({})).toBe(false)
  })

  it('通过正文读取入口打开选中的草稿，而非创建空白元数据标签', async () => {
    expect(await openResumableDraft({
      1: [draft(1, 1, '2026-09-21T00:00:00Z')],
      5: [draft(5, 5, '2026-09-24T00:00:00Z')],
    })).toBe(true)
    expect(openChapterFile).toHaveBeenCalledWith('vela://draft/5', '第 5 章草稿')
  })
})
