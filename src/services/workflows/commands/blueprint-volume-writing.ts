import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import type { BlueprintVolumeOutline } from '../../../shared/blueprint-planning'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import type { WritingLanguage } from '../../../shared/writing-language'
import { promptLanguageText } from '../../prompt-language'
import { ipc } from '../../ipc-client'

const MAX_OUTLINE_CHARS = 5_000
const MAX_RELATED_CHAPTERS = 5
const MAX_SUMMARY_TITLE_CHARS = 120
const MAX_SUMMARY_PURPOSE_CHARS = 240
const MAX_SUMMARY_EVENTS_CHARS = 500

export interface BlueprintVolumeWritingChapterSummary {
  chapterNumber: number
  title: string
  purpose: string
  keyEvents: string
}

export interface BlueprintVolumeWritingMaterial {
  /** Null means the bound chapter currently has no blueprint volume. */
  volumeId: string | null
  outline: Pick<BlueprintVolumeOutline, 'revision' | 'contentHash' | 'markdown'> | null
  relatedChapters: BlueprintVolumeWritingChapterSummary[]
}

function isSessionCurrent(projectSession: ProjectSessionContext): boolean {
  return sameProjectSessionContext(
    projectSession,
    projectSessionContextFromProject(useProjectStore.getState().currentProject),
  )
}

function clip(value: unknown, maxCharacters: number): string {
  return typeof value === 'string'
    ? Array.from(value).slice(0, maxCharacters).join('')
    : ''
}

/**
 * Load writing context through the actual blueprint assignment. `chapterNumber`
 * must come from the draft's blueprint binding, or from the blueprint explicitly
 * selected for a new draft. No prose-volume assignment or chapter-range guess is
 * used here. Only one full volume outline is read; neighboring chapter data is
 * bounded to summaries from that same `blueprints.volume_id`.
 */
export async function loadBlueprintVolumeWritingMaterial(
  projectSession: ProjectSessionContext,
  chapterNumber: number | null | undefined,
): Promise<BlueprintVolumeWritingMaterial | null> {
  if (!Number.isSafeInteger(chapterNumber) || (chapterNumber as number) <= 0) return null
  if (!isSessionCurrent(projectSession)) throw new Error('PROJECT_SESSION_MISMATCH')

  const blueprint = await ipc.invokeWithProjectSession(
    projectSession,
    'db:blueprint-get',
    chapterNumber as number,
    projectSession.projectPath,
  )
  if (!isSessionCurrent(projectSession)) throw new Error('PROJECT_SESSION_MISMATCH')
  const volumeId = blueprint?.volumeId?.trim() || null
  if (!volumeId) return { volumeId: null, outline: null, relatedChapters: [] }

  const outline = await ipc.invokeWithProjectSession(
    projectSession,
    'db:blueprint-volume-outline-get',
    volumeId,
    projectSession.projectPath,
  )
  if (!isSessionCurrent(projectSession)) throw new Error('PROJECT_SESSION_MISMATCH')
  if (!outline || outline.volumeId !== volumeId) return { volumeId, outline: null, relatedChapters: [] }

  const summaries = await ipc.invokeWithProjectSession(
    projectSession,
    'db:blueprint-list-summary',
    projectSession.projectPath,
  )
  if (!isSessionCurrent(projectSession)) throw new Error('PROJECT_SESSION_MISMATCH')

  const relatedChapters = summaries
    .filter(item => item.volumeId === volumeId)
    .sort((left, right) => (
      Math.abs(left.chapterNumber - (chapterNumber as number))
      - Math.abs(right.chapterNumber - (chapterNumber as number))
      || left.chapterNumber - right.chapterNumber
    ))
    .slice(0, MAX_RELATED_CHAPTERS)
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
    .map(item => ({
      chapterNumber: item.chapterNumber,
      title: clip(item.title || `第${item.chapterNumber}章`, MAX_SUMMARY_TITLE_CHARS),
      purpose: clip(item.purpose, MAX_SUMMARY_PURPOSE_CHARS),
      keyEvents: clip(item.keyEvents, MAX_SUMMARY_EVENTS_CHARS),
    }))

  return {
    volumeId,
    outline: {
      revision: outline.revision,
      contentHash: outline.contentHash,
      markdown: clip(outline.markdown, MAX_OUTLINE_CHARS),
    },
    relatedChapters,
  }
}

export function formatBlueprintVolumeWritingMaterial(
  material: BlueprintVolumeWritingMaterial | null,
  writingLanguage: WritingLanguage,
): string {
  if (!material?.volumeId || !material.outline) return ''
  const outlineHeading = promptLanguageText(
    writingLanguage,
    '【当前卷的卷纲计划｜创作计划，不是已发生事实】',
    '[Current volume outline | a plan, not established history]',
  )
  const sourceLabel = promptLanguageText(
    writingLanguage,
    `来源：卷 ${material.volumeId}，r${material.outline.revision}，${material.outline.contentHash}`,
    `Source: volume ${material.volumeId}, r${material.outline.revision}, ${material.outline.contentHash}`,
  )
  const siblingsHeading = promptLanguageText(
    writingLanguage,
    '【同卷相关章节简纲｜创作计划】',
    '[Related chapter summaries in this volume | planning material]',
  )
  const summaries = material.relatedChapters.map(chapter => promptLanguageText(
    writingLanguage,
    `- 第${chapter.chapterNumber}章 ${chapter.title}${chapter.purpose ? `：${chapter.purpose}` : ''}${chapter.keyEvents ? `\n  ${chapter.keyEvents}` : ''}`,
    `- Chapter ${chapter.chapterNumber} ${chapter.title}${chapter.purpose ? `: ${chapter.purpose}` : ''}${chapter.keyEvents ? `\n  ${chapter.keyEvents}` : ''}`,
  ))
  return [
    outlineHeading,
    sourceLabel,
    material.outline.markdown,
    ...(summaries.length > 0 ? [siblingsHeading, ...summaries] : []),
  ].join('\n\n')
}
