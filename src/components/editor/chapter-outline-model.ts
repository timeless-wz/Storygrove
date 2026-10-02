import type { BlueprintVolumeData } from '../../../electron/repositories/blueprint-repository'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'

export interface OutlineData {
  volumes: BlueprintVolumeData[]
  blueprints: Array<{ chapterNumber: number; title: string; volumeId?: string | null }>
  assignments?: Array<{ chapterNumber: number; volumeId: string | null }>
  order?: Array<{ chapterNumber: number; position: number; displayNumber: number | null }>
  drafts: DraftMeta[]
}

export interface ChapterEntry {
  number: number
  chapterNumber: number
  position: number
  drafts: DraftMeta[]
  title: string
  draft?: DraftMeta
  manuscript?: DraftMeta
}

const DEFAULT_VOLUME_ID = 'volume-1'

function latest(drafts: DraftMeta[]): DraftMeta | undefined {
  return drafts.sort((a, b) => b.version - a.version || b.id - a.id)[0]
}

export function groupOutline(data: OutlineData, fallbackVolumeName: string, includeEmpty = false) {
  const volumes = data.volumes.length > 0
    ? [...data.volumes].sort((a, b) => a.sortOrder - b.sortOrder)
    : [{ id: DEFAULT_VOLUME_ID, name: fallbackVolumeName, sortOrder: 1 }]
  const blueprints = new Map(data.blueprints.map(blueprint => [blueprint.chapterNumber, blueprint]))
  const order = new Map(data.order?.map(row => [row.chapterNumber, row]))
  const chapters = new Map<string, ChapterEntry>()
  const assignments = new Map(data.assignments?.map(item => [item.chapterNumber, item]))
  const volumeForBlueprint = (chapterNumber: number) => {
    const blueprint = blueprints.get(chapterNumber)
    if (!blueprint) return 'ungrouped'
    const volumeId = blueprint.volumeId || volumes[0].id
    return volumes.some(volume => volume.id === volumeId) ? volumeId : 'ungrouped'
  }
  for (const draft of data.drafts) {
    if (draft.status === 'archived') continue
    // Explicit prose membership wins; legacy chapters retain their explicit blueprint binding.
    const assigned = assignments.get(draft.chapterNumber)
    const volumeId = assigned
      ? (volumes.some(volume => volume.id === assigned.volumeId) ? assigned.volumeId! : 'ungrouped')
      : draft.blueprintChapterNumber === undefined
        ? 'ungrouped'
        : volumeForBlueprint(draft.blueprintChapterNumber)
    const key = `${volumeId}:${draft.chapterNumber}`
    const entry = chapters.get(key) ?? {
      number: draft.status === 'finalized' ? order.get(draft.chapterNumber)?.displayNumber ?? draft.displayNumber ?? draft.chapterNumber : draft.chapterNumber,
      chapterNumber: draft.chapterNumber,
      position: order.get(draft.chapterNumber)?.position ?? draft.chapterNumber,
      drafts: [],
      title: draft.chapterTitle || blueprints.get(draft.blueprintChapterNumber ?? -1)?.title || '',
    }
    if (draft.status === 'finalized') {
      entry.manuscript = latest([draft, ...(entry.manuscript ? [entry.manuscript] : [])])
    } else {
      entry.drafts.push(draft)
      entry.draft = latest([draft, ...(entry.draft ? [entry.draft] : [])])
    }
    entry.title = entry.draft?.chapterTitle || entry.manuscript?.chapterTitle
      || blueprints.get(draft.blueprintChapterNumber ?? -1)?.title || ''
    chapters.set(key, entry)
  }
  const groups = volumes.map(volume => ({ volume, chapters: [] as ChapterEntry[] }))
  const ungrouped = { volume: { id: 'ungrouped', name: '', sortOrder: Infinity }, chapters: [] as ChapterEntry[] }
  for (const [key, entry] of [...chapters.entries()].sort((a, b) => a[1].position - b[1].position)) {
    const volumeId = key.slice(0, key.lastIndexOf(':'))
    const group = groups.find(item => item.volume.id === volumeId)
    ;(group ?? ungrouped).chapters.push(entry)
  }
  return [...groups, ungrouped].filter(group => group.chapters.length > 0 || (includeEmpty && group.volume.id !== 'ungrouped' && data.volumes.length > 0))
}
