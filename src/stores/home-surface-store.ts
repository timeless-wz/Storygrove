import { create } from 'zustand'

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

/** Global-home UI state. Notes deliberately live only for this app session until a data contract exists. */
export const useHomeSurfaceStore = create<HomeSurfaceState>()((set) => ({
  surface: 'home',
  category: 'notes',
  notes: [],
  setSurface: (surface, category) => set(state => ({ surface, category: category ?? state.category })),
  addNote: (content, tags) => set(state => ({
    notes: [{ id: crypto.randomUUID(), content: content.trim(), tags, updatedAt: new Date().toISOString() }, ...state.notes],
  })),
  removeNote: id => set(state => ({ notes: state.notes.filter(note => note.id !== id) })),
}))
