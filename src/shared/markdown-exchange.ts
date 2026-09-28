export type DraftMarkdownSelectionKind = 'draft' | 'finalized'

export interface DraftMarkdownSelectionRequest {
  draftId: number
  kind: DraftMarkdownSelectionKind
}

export interface DraftMarkdownSelectionReceiptItem extends DraftMarkdownSelectionRequest {
  chapterNumber: number
  version: number
  status: string
  contentHash: string
  titleHash: string
  finalizationId: string | null
}

export interface DraftMarkdownSelectedChapter extends DraftMarkdownSelectionReceiptItem {
  title: string
  content: string
}

export interface DraftMarkdownSelectionSnapshot {
  chapters: DraftMarkdownSelectedChapter[]
  receipt: DraftMarkdownSelectionReceiptItem[]
}

export interface MarkdownChapterDraftPreview {
  number: number
  title: string
  wordCount: number
  contentLength: number
}

export interface MarkdownChapterDraftInspection {
  inspectionId: string
  sourceNames: string[]
  totalBytes: number
  chapters: MarkdownChapterDraftPreview[]
}

export interface MarkdownChapterDraftCommitResult {
  success: boolean
  created?: Array<{ id: number; chapterNumber: number; version: number }>
  error?: string
}
