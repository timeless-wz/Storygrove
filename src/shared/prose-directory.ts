/** chapterNumber is the immutable chapter identity; displayNumber is its book position. */
export interface ProseOrderEntry { chapterNumber: number; position: number; displayNumber: number | null }
export interface ProseTrashEntry { id: number; kind: 'draft' | 'volume'; name: string; deletedAt: string; draftId?: number; volumeId?: string }
export type ProseDirectoryAction =
  | { type: 'rename-draft'; draftId: number; name: string }
  | { type: 'rename-volume'; volumeId: string; name: string }
  | { type: 'move'; chapterNumber: number; relativeTo: number; side: 'before' | 'after' }
  | { type: 'relocate'; chapterNumber: number; volumeId: string | null; relativeTo?: number; side?: 'before' | 'after' }
  | { type: 'trash-draft'; draftId: number }
  | { type: 'trash-volume'; volumeId: string }
  | { type: 'restore'; trashId: number }
  | { type: 'purge'; trashId: number }
