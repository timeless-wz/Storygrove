import type { StoryFact } from './story-domain'

export interface LongFormControlImpact { chapterNumber: number; impactType?: string; factId?: string }
export interface LongFormControlChapter { chapterNumber: number; content: string; wordCount?: number }
export interface LongFormControlInput {
  totalChapters: number
  wordsPerChapter: number
  facts: readonly StoryFact[]
  impacts?: readonly LongFormControlImpact[]
  chapters?: readonly LongFormControlChapter[]
  dormantChapterThreshold?: number
}
export interface LongFormDensity { category: 'battle' | 'exploration' | 'daily' | 'payoff' | 'new-information'; chapterNumbers: number[]; density: number }
export interface LongFormReminder { factId: string; name: string; lastChapter: number; dueChapter: number; kind: 'supporting-character' | 'foreshadowing' }
export interface LongFormControlSnapshot {
  totalChapters: number; plannedWords: number; actualWords: number; completedChapters: number
  timelineEvents: number; latestTimelineChapter: number | null; confirmedFacts: number
  activeNarrativeThreads: number; dormantNarrativeThreads: number; resolvedNarrativeThreads: number
  foreshadowingTotal: number; foreshadowingResolved: number; foreshadowingOpen: number
  impactedChapters: number; chaptersWithoutTrackedImpact: number
  densities: LongFormDensity[]; lowInformationStreaks: Array<{ fromChapter: number; toChapter: number }>
  hookMissingChapters: number[]; reminders: LongFormReminder[]
}

function positiveInteger(value: number, fallback: number): number { return Number.isSafeInteger(value) && value > 0 ? value : fallback }
function normalizedStatus(fact: StoryFact): string { const value = fact.payload.status ?? fact.payload.state ?? fact.payload.recoveryStatus; return typeof value === 'string' ? value.trim().toLowerCase() : '' }
function chapterNumber(fact: StoryFact): number | null { const value = fact.payload.chapterNumber ?? fact.payload.chapter ?? fact.payload.chapterNo; const parsed = typeof value === 'number' ? value : Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null }
function lastProgressChapter(fact: StoryFact): number | null {
  const value = fact.payload.lastProgressChapter ?? fact.payload.lastChapter ?? fact.payload.lastAppearanceChapter ?? fact.payload.chapterNumber ?? fact.payload.chapter
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function countWords(content: string): number { const english = content.match(/[A-Za-z0-9][A-Za-z0-9'-]*/gu)?.length ?? 0; const chinese = content.match(/[\u3400-\u9fff]/gu)?.length ?? 0; return english + chinese }
function matches(content: string, pattern: RegExp): boolean { return pattern.test(content) }

const CATEGORY_PATTERNS: Array<{ category: LongFormDensity['category']; pattern: RegExp }> = [
  { category: 'battle', pattern: /战斗|交手|斩杀|厮杀|攻向|法术|技能|对决/u },
  { category: 'exploration', pattern: /探索|遗迹|秘境|洞穴|地图|发现.*入口|踏入/u },
  { category: 'daily', pattern: /吃饭|休息|闲聊|日常|睡觉|逛街|家常/u },
  { category: 'payoff', pattern: /突破|逆转|胜利|奖励|收获|打脸|震惊/u },
  { category: 'new-information', pattern: /发现|得知|揭露|线索|真相|秘密|原来/u },
]

/** Build source-backed long-form metrics. Every chapter number returned here
 * is a concrete finalized chapter or an approved fact impact, never a model score. */
export function buildLongFormControlSnapshot(input: LongFormControlInput): LongFormControlSnapshot {
  const totalChapters = positiveInteger(input.totalChapters, 1)
  const wordsPerChapter = positiveInteger(input.wordsPerChapter, 1)
  const timeline = input.facts.filter(fact => fact.entityType === 'timeline_event')
  const timelineChapters = timeline.map(chapterNumber).filter((value): value is number => value !== null)
  const narrativeThreads = input.facts.filter(fact => fact.entityType === 'narrative_thread')
  const foreshadowing = input.facts.filter(fact => fact.entityType === 'foreshadowing')
  const foreshadowingResolved = foreshadowing.filter(fact => ['resolved', 'abandoned'].includes(normalizedStatus(fact))).length
  const impacts = input.impacts ?? []
  const impactedSet = new Set(impacts.map(impact => impact.chapterNumber).filter(number => Number.isSafeInteger(number) && number > 0))
  const chapters = [...(input.chapters ?? [])].filter(chapter => Number.isSafeInteger(chapter.chapterNumber) && chapter.chapterNumber > 0).sort((left, right) => left.chapterNumber - right.chapterNumber)
  const latestChapter = Math.max(0, ...chapters.map(chapter => chapter.chapterNumber), ...timelineChapters)
  const densities = CATEGORY_PATTERNS.map(({ category, pattern }) => {
    const chapterNumbers = chapters.filter(chapter => matches(chapter.content, pattern)).map(chapter => chapter.chapterNumber)
    return { category, chapterNumbers, density: chapters.length === 0 ? 0 : Number((chapterNumbers.length / chapters.length).toFixed(3)) }
  })
  const informationChapters = new Set(densities.find(entry => entry.category === 'new-information')?.chapterNumbers ?? [])
  for (const number of impactedSet) informationChapters.add(number)
  const lowInformationStreaks: Array<{ fromChapter: number; toChapter: number }> = []
  let streakStart: number | null = null; let previous: number | null = null
  for (const chapter of chapters) {
    const noSignal = !informationChapters.has(chapter.chapterNumber)
    if (noSignal && (previous === null || chapter.chapterNumber === previous + 1)) {
      if (streakStart === null) streakStart = chapter.chapterNumber
    } else if (streakStart !== null) {
      if ((previous ?? streakStart) - streakStart + 1 >= 2) lowInformationStreaks.push({ fromChapter: streakStart, toChapter: previous ?? streakStart })
      streakStart = noSignal ? chapter.chapterNumber : null
    }
    previous = chapter.chapterNumber
  }
  if (streakStart !== null && previous !== null && previous - streakStart + 1 >= 2) lowInformationStreaks.push({ fromChapter: streakStart, toChapter: previous })
  const hookMissingChapters = chapters.filter(chapter => !matches(chapter.content.slice(-500), /[？?！!]|危机|悬念|下一刻|然而|却见|未完/u)).map(chapter => chapter.chapterNumber)
  const dormantThreshold = positiveInteger(input.dormantChapterThreshold ?? 8, 8)
  const reminders: LongFormReminder[] = []
  for (const fact of input.facts.filter(fact => fact.status === 'confirmed' && (fact.entityType === 'character' || fact.entityType === 'foreshadowing'))) {
    const last = lastProgressChapter(fact)
    if (last === null || latestChapter <= 0 || latestChapter - last < dormantThreshold) continue
    reminders.push({ factId: fact.factId, name: fact.canonicalName, lastChapter: last, dueChapter: last + dormantThreshold, kind: fact.entityType === 'character' ? 'supporting-character' : 'foreshadowing' })
  }
  return {
    totalChapters, plannedWords: totalChapters * wordsPerChapter,
    actualWords: chapters.reduce((sum, chapter) => sum + (chapter.wordCount ?? countWords(chapter.content)), 0), completedChapters: chapters.length,
    timelineEvents: timeline.length, latestTimelineChapter: timelineChapters.length > 0 ? Math.max(...timelineChapters) : (chapters.length > 0 ? Math.max(...chapters.map(chapter => chapter.chapterNumber)) : null),
    confirmedFacts: input.facts.filter(fact => fact.status === 'confirmed').length,
    activeNarrativeThreads: narrativeThreads.filter(fact => !['dormant', 'resolved', 'abandoned'].includes(normalizedStatus(fact))).length,
    dormantNarrativeThreads: narrativeThreads.filter(fact => normalizedStatus(fact) === 'dormant').length,
    resolvedNarrativeThreads: narrativeThreads.filter(fact => ['resolved', 'abandoned'].includes(normalizedStatus(fact))).length,
    foreshadowingTotal: foreshadowing.length, foreshadowingResolved, foreshadowingOpen: foreshadowing.length - foreshadowingResolved,
    impactedChapters: impactedSet.size, chaptersWithoutTrackedImpact: Math.max(0, totalChapters - impactedSet.size),
    densities, lowInformationStreaks, hookMissingChapters, reminders: reminders.sort((left, right) => left.dueChapter - right.dueChapter),
  }
}
