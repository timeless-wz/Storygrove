import type { BlueprintData } from '../../electron/repositories/blueprint-repository'
import type { ChapterBlueprintV2Summary } from './blueprint-v2'

/** Bounded list projection; full scene text is available only through v2-get. */
export interface BlueprintListProjection {
  chapterNumber: number
  title: string
  volumeId: string | null
  hasV2Detail?: boolean
  sceneCount?: number
  sceneTitles?: string[]
  wordBudget?: number | null
}

export function projectBlueprintList(
  legacyRows: readonly BlueprintData[],
  v2Summaries: readonly ChapterBlueprintV2Summary[],
): BlueprintListProjection[] {
  const summaryRows: readonly ChapterBlueprintV2Summary[] = Array.isArray(v2Summaries) ? v2Summaries : []
  const rows = Array.isArray(legacyRows) ? legacyRows : []
  const summaries = new Map(summaryRows.map(summary => [summary.chapterNumber, summary]))
  return rows.map(row => {
    const summary = summaries.get(row.chapterNumber)
    return {
      chapterNumber: row.chapterNumber,
      title: (row.title || '').slice(0, 160),
      volumeId: row.volumeId ?? null,
      hasV2Detail: Boolean(summary),
      sceneCount: summary?.sceneCount ?? 0,
      sceneTitles: summary?.sceneTitles.slice(0, 8).map(title => title.slice(0, 160)) ?? [],
      wordBudget: summary?.wordBudget ?? null,
    }
  })
}
