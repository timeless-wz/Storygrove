import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('global inspiration notes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.resetModules()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('retains saved notes and deletions after the store is recreated', async () => {
    const { useHomeSurfaceStore: first } = await import('../home-surface-store')
    first.getState().addNote('雨夜的来客', ['主角'])
    first.getState().addNote('山中的信', ['场景'])
    first.getState().setSurface('library', 'images')

    vi.resetModules()
    const { useHomeSurfaceStore: reopened } = await import('../home-surface-store')
    expect(reopened.getState().notes.map(note => note.content)).toEqual(['山中的信', '雨夜的来客'])
    expect(reopened.getState().surface).toBe('home')
    expect(reopened.getState().category).toBe('notes')

    reopened.getState().removeNote(reopened.getState().notes[0].id)
    vi.resetModules()
    const { useHomeSurfaceStore: reopenedAgain } = await import('../home-surface-store')
    expect(reopenedAgain.getState().notes.map(note => note.content)).toEqual(['雨夜的来客'])
  })
})
