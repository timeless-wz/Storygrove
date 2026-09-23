export type ForeshadowingMarkerType = 'foreshadowing' | 'deepen' | 'callback' | string
export type ForeshadowingColor = 'blue' | 'red' | 'yellow' | 'green' | 'purple' | string

export interface ForeshadowingRecord {
  id: string
  draftId: number
  chapterNumber: number
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
  note: string
  markerType: ForeshadowingMarkerType
  color: ForeshadowingColor
  completed: boolean
  createdAt: string
  updatedAt: string
  completedAt: string | null
  sourceType?: 'draft' | 'manuscript'
}

export interface CreateForeshadowingInput {
  id?: string
  draftId: number
  chapterNumber: number
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore?: string
  contextAfter?: string
  note: string
  markerType?: ForeshadowingMarkerType
  color?: ForeshadowingColor
}

export interface UpdateForeshadowingInput {
  note?: string
  markerType?: ForeshadowingMarkerType
  color?: ForeshadowingColor
}
