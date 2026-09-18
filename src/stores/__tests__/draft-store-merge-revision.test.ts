import { describe, expect, it } from 'vitest'
import { useDraftStore } from '../draft-store'

describe('draft-store automated revision merge prohibited', () => {
  it('prohibits applyMergedRevision from draft store: author edits directly', () => {
    const storeState = useDraftStore.getState() as unknown as Record<string, unknown>
    expect(storeState.applyMergedRevision).toBeUndefined()
  })

  it('keeps manual draft loading and invalidation intact', () => {
    const store = useDraftStore.getState()
    expect(typeof store.loadChapterDrafts).toBe('function')
    expect(typeof store.invalidateChapter).toBe('function')
  })
})
