import type { ProjectSessionContext } from './ipc-channels'

/** Immutable editor snapshot, bound to one validated project session. */
export interface FinalizationSnapshot {
  tabId: string
  projectPath: string
  projectSession: ProjectSessionContext
  draftId: number
  chapterNumber: number
  chapterTitle: string
  content: string
  contentRevision: number
}

export interface FinalizationResult {
  success: boolean
  committed: boolean
  finalizationId?: string
  contentHash?: string
  contentRevision?: number
  draftId?: number
  publicationStatus?: 'pending' | 'published'
  error?: string
}
