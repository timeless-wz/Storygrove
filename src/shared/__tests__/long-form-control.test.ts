import { describe, expect, it } from 'vitest'
import { buildLongFormControlSnapshot } from '../long-form-control'
import type { StoryFact } from '../story-domain'

const provenance = { sourceId: 's', sourceSnapshotId: 'ss', sourceFragmentId: 'f', sourceFile: 'x.md', sourceHeadingPath: '#', startLine: 1, endLine: 1, contentHash: 'h' }
const fact = (entityType: StoryFact['entityType'], payload: Record<string, unknown>, status: StoryFact['status'] = 'confirmed'): StoryFact => ({
  factId: `${entityType}-${Math.random()}`, projectId: 'main', entityType, canonicalName: entityType, summary: '', payload, status, confidence: 1, revision: 1, provenance, createdAt: '', updatedAt: '',
})

describe('long-form control snapshot', () => {
  it('summarizes authoritative timeline, threads, foreshadowing, and chapter coverage', () => {
    const snapshot = buildLongFormControlSnapshot({
      totalChapters: 100,
      wordsPerChapter: 3000,
      facts: [
        fact('timeline_event', { chapterNumber: 31 }),
        fact('narrative_thread', { status: 'active' }),
        fact('narrative_thread', { status: 'dormant' }),
        fact('narrative_thread', { status: 'resolved' }),
        fact('foreshadowing', { recoveryStatus: 'planted' }),
        fact('foreshadowing', { recoveryStatus: 'resolved' }),
      ],
      impacts: [{ chapterNumber: 31 }, { chapterNumber: 32 }],
    })
    expect(snapshot).toMatchObject({ plannedWords: 300000, latestTimelineChapter: 31, timelineEvents: 1, activeNarrativeThreads: 1, dormantNarrativeThreads: 1, resolvedNarrativeThreads: 1, foreshadowingTotal: 2, foreshadowingResolved: 1, foreshadowingOpen: 1, impactedChapters: 2, chaptersWithoutTrackedImpact: 98 })
  })

  it('returns chapter-backed density, pacing, hook, and reappearance reminders', () => {
    const snapshot = buildLongFormControlSnapshot({
      totalChapters: 8,
      wordsPerChapter: 1000,
      facts: [
        fact('character', { lastAppearanceChapter: 1 }),
        fact('foreshadowing', { lastProgressChapter: 1, recoveryStatus: 'planted' }),
      ],
      impacts: [{ chapterNumber: 1 }],
      chapters: [
        { chapterNumber: 1, content: '发现新的线索，然而危险仍在？' },
        { chapterNumber: 2, content: '日常休息。' },
        { chapterNumber: 3, content: '继续日常闲聊。' },
        { chapterNumber: 4, content: '探索遗迹并开始战斗！' },
        { chapterNumber: 9, content: '普通收尾。' },
      ],
      dormantChapterThreshold: 4,
    })
    expect(snapshot.actualWords).toBeGreaterThan(0)
    expect(snapshot.densities.find(item => item.category === 'battle')?.chapterNumbers).toEqual([4])
    expect(snapshot.lowInformationStreaks).toContainEqual({ fromChapter: 2, toChapter: 4 })
    expect(snapshot.hookMissingChapters).toContain(9)
    expect(snapshot.reminders).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'supporting-character', dueChapter: 5 }),
      expect.objectContaining({ kind: 'foreshadowing', dueChapter: 5 }),
    ]))
  })
})
