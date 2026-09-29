import type { BlueprintData, BlueprintVolumeData } from '../../../electron/repositories/blueprint-repository'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'

export interface OutlineData {
  volumes: BlueprintVolumeData[]
  blueprints: BlueprintData[]
  drafts: DraftMeta[]
}

export interface ChapterEntry {
  number: number
  title: string
  draft?: DraftMeta
  manuscript?: DraftMeta
}

const DEFAULT_VOLUME_ID = 'volume-1'

function latest(drafts: DraftMeta[]): DraftMeta | undefined {
  return drafts.sort((a, b) => b.version - a.version || b.id - a.id)[0]
}

export function groupOutline(data: OutlineData, fallbackVolumeName: string) {
  const volumes = data.volumes.length > 0
    ? [...data.volumes].sort((a, b) => a.sortOrder - b.sortOrder)
    : [{ id: DEFAULT_VOLUME_ID, name: fallbackVolumeName, sortOrder: 1 }]
  const blueprints = new Map(data.blueprints.map(blueprint => [blueprint.chapterNumber, blueprint]))
  const chapters = new Map<string, ChapterEntry>()
  const volumeForBlueprint = (chapterNumber: number) => {
    const blueprint = blueprints.get(chapterNumber)
    if (!blueprint) return 'ungrouped'
    const volumeId = blueprint.volumeId || volumes[0].id
    return volumes.some(volume => volume.id === volumeId) ? volumeId : 'ungrouped'
  }
  for (const blueprint of data.blueprints) {
    chapters.set(`${volumeForBlueprint(blueprint.chapterNumber)}:${blueprint.chapterNumber}`, {
      number: blueprint.chapterNumber, title: blueprint.title,
    })
  }
  for (const draft of data.drafts) {
    if (draft.status === 'archived') continue
    // Volume membership follows the draft's explicit blueprint binding only.
    const volumeId = draft.blueprintChapterNumber === undefined
      ? 'ungrouped'
      : volumeForBlueprint(draft.blueprintChapterNumber)
    const key = `${volumeId}:${draft.chapterNumber}`
    const entry = chapters.get(key) ?? {
      number: draft.chapterNumber,
      title: draft.chapterTitle || blueprints.get(draft.blueprintChapterNumber ?? -1)?.title || '',
    }
    if (draft.status === 'finalized') {
      entry.manuscript = latest([draft, ...(entry.manuscript ? [entry.manuscript] : [])])
    } else {
      entry.draft = latest([draft, ...(entry.draft ? [entry.draft] : [])])
    }
    if (!entry.title && draft.chapterTitle) entry.title = draft.chapterTitle
    chapters.set(key, entry)
  }
  const groups = volumes.map(volume => ({ volume, chapters: [] as ChapterEntry[] }))
  const ungrouped = { volume: { id: 'ungrouped', name: '', sortOrder: Infinity }, chapters: [] as ChapterEntry[] }
  for (const [key, entry] of [...chapters.entries()].sort((a, b) => a[1].number - b[1].number)) {
    const volumeId = key.slice(0, key.lastIndexOf(':'))
    const group = groups.find(item => item.volume.id === volumeId)
    ;(group ?? ungrouped).chapters.push(entry)
  }
  return ungrouped.chapters.length > 0 ? [...groups, ungrouped] : groups
}
