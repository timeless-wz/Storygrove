import { describe, expect, it } from 'vitest'
import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import type { DraftMeta } from '../../../../electron/repositories/draft-repository'
import { groupOutline } from '../chapter-outline-model'

const blueprint = (chapterNumber: number, volumeId: string, title: string) => ({
  chapterNumber, volumeId, title, role: '', purpose: '', keyEvents: '', characters: [],
  suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '',
}) satisfies BlueprintData

const draft = (id: number, chapterNumber: number, version: number, status: string, blueprintChapterNumber?: number) => ({
  id, chapterNumber, version, status, source: 'write', contentId: id, wordCount: 20,
  blueprintChapterNumber,
  sourceDependencies: [], dependenciesStale: false, createdAt: '', updatedAt: '',
}) satisfies DraftMeta

describe('chapter outline grouping', () => {
  it('groups only written chapters by volume and keeps prose states distinct', () => {
    const groups = groupOutline({
      volumes: [
        { id: 'second', name: '下卷', sortOrder: 2 },
        { id: 'first', name: '上卷', sortOrder: 1 },
      ],
      blueprints: [blueprint(1, 'first', '启程'), blueprint(2, 'second', '归来')],
      drafts: [
        draft(11, 1, 1, 'draft', 1),
        draft(12, 1, 2, 'draft', 1),
        draft(13, 1, 3, 'finalized', 1),
        draft(14, 2, 1, 'archived'),
      ],
    }, '第1卷')

    expect(groups.map(group => group.volume.name)).toEqual(['上卷'])
    expect(groups[0].chapters[0]).toMatchObject({
      number: 1, title: '启程', draft: { id: 12 }, manuscript: { id: 13 },
    })
    expect(groups.flatMap(group => group.chapters)).toHaveLength(1)
  })

  it('does not infer volume membership for an unbound draft from its chapter number', () => {
    const groups = groupOutline({
      volumes: [{ id: 'first', name: '上卷', sortOrder: 1 }],
      blueprints: [blueprint(1, 'first', '蓝图标题')],
      drafts: [draft(21, 1, 1, 'draft')],
    }, '第1卷')
    expect(groups).toHaveLength(1)
    expect(groups[0].volume.id).toBe('ungrouped')
    expect(groups[0].chapters).toMatchObject([{ number: 1, draft: { id: 21 } }])
    expect(groups[0].chapters[0].title).toBe('')
  })

  it('shows one actual chapter for 58 blueprints and none when prose is absent', () => {
    const data = {
      volumes: [{ id: 'first', name: '上卷', sortOrder: 1 }],
      blueprints: Array.from({ length: 58 }, (_, i) => blueprint(i + 1, 'first', `细纲${i + 1}`)),
      drafts: [{ ...draft(1, 1, 1, 'draft', 1), chapterTitle: '正文标题' }],
    }
    const groups = groupOutline(data, '第1卷')
    expect(groups[0].chapters).toMatchObject([{ number: 1, title: '正文标题' }])
    expect(groups[0].chapters).toHaveLength(1)
    expect(groupOutline({ ...data, drafts: [] }, '第1卷')).toEqual([])
  })
})
