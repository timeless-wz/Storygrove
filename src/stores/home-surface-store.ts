import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type HomeSurface = 'home' | 'library' | 'references'
export type LibraryCategory = 'notes' | 'references' | 'images' | 'general'

export interface InspirationNote {
  id: string
  content: string
  tags: string[]
  updatedAt: string
}

interface HomeSurfaceState {
  surface: HomeSurface
  category: LibraryCategory
  notes: InspirationNote[]
  setSurface: (surface: HomeSurface, category?: LibraryCategory) => void
  addNote: (content: string, tags: string[]) => void
  removeNote: (id: string) => void
}

/** Global notes are shared across projects and retained in this device's app profile. */
export const useHomeSurfaceStore = create<HomeSurfaceState>()(
  persist(
    (set) => ({
      surface: 'home',
      category: 'notes',
      notes: [],
      setSurface: (surface, category) => set(state => ({ surface, category: category ?? state.category })),
      addNote: (content, tags) => set(state => ({
        notes: [{ id: crypto.randomUUID(), content: content.trim(), tags, updatedAt: new Date().toISOString() }, ...state.notes],
      })),
      removeNote: id => set(state => ({ notes: state.notes.filter(note => note.id !== id) })),
    }),
    {
      name: 'ai-novel-writer-global-inspiration-notes',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({ notes: state.notes }),
      merge: (persisted, current) => {
        const candidate = (persisted as { notes?: unknown } | null)?.notes
        const notes = Array.isArray(candidate) ? candidate.filter((note): note is InspirationNote =>
          note !== null && typeof note === 'object' &&
          typeof note.id === 'string' && typeof note.content === 'string' &&
          typeof note.updatedAt === 'string' &&
          Array.isArray(note.tags) && note.tags.every((tag: unknown) => typeof tag === 'string')) : []
        return { ...current, notes }
      },
    },
  ),
)
