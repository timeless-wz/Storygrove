import type { DraftMeta } from '../../services/draft-index'
import type { DraftsByChapter } from '../../stores/draft-store'
import { openChapterFile } from '../panels/sidebar/sidebar-file-openers'

/** Choose the last edited, still editable version across all chapters. */
export function findResumableDraft(draftsByChapter: DraftsByChapter): DraftMeta | null {
  const candidates = Object.values(draftsByChapter)
    .flat()
    .filter(draft => draft.status !== 'archived' && draft.status !== 'finalized')

  if (candidates.length === 0) return null
  return candidates.reduce((latest, draft) => {
    const draftTime = draft.updatedAt || draft.createdAt
    const latestTime = latest.updatedAt || latest.createdAt
    return draftTime > latestTime || (draftTime === latestTime && draft.version > latest.version)
      ? draft
      : latest
  })
}

export async function openResumableDraft(draftsByChapter: DraftsByChapter): Promise<boolean> {
  const draft = findResumableDraft(draftsByChapter)
  if (!draft) return false

  // The chapter opener reads the authoritative DB body before mounting Vditor.
  // Opening a metadata-only tab here would display an empty page and risk saving it.
  await openChapterFile(
    `vela://draft/${draft.id}`,
    draft.chapterTitle || `第 ${draft.chapterNumber} 章草稿`,
  )
  return true
}
