export const CREATIVE_CONTENT_CATEGORIES = [
  'creative-direction',
  'writing-rules',
  'premise',
  'world-setting',
  'power-system',
  'locations',
  'characters',
  'plot-planning',
  'information-reveal',
  'materials',
  'retired-and-issues',
] as const

export type CreativeContentCategory = typeof CREATIVE_CONTENT_CATEGORIES[number]

export const CREATIVE_MATERIAL_TYPES = [
  'event', 'relic', 'character', 'setting', 'scene', 'hook', 'other',
] as const

export type CreativeMaterialType = typeof CREATIVE_MATERIAL_TYPES[number]
export type CreativeMaterialKind = 'material' | 'retired' | 'issue'
export type CreativeMaterialStatus = 'candidate' | 'adopted' | 'rejected' | 'open' | 'resolved' | 'retired'

export interface CreativeMaterialEntry {
  id: string
  title: string
  entryKind: CreativeMaterialKind
  materialType: CreativeMaterialType
  status: CreativeMaterialStatus
  markdown: string
  sourceFileName: string
  sourceHeading: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface CreativeMaterialSaveInput {
  id?: string
  title: string
  entryKind: CreativeMaterialKind
  materialType?: CreativeMaterialType
  status: CreativeMaterialStatus
  markdown: string
  sourceFileName?: string
  sourceHeading?: string
  /** null creates a row; an integer performs a compare-and-swap update. */
  expectedRevision: number | null
}

export interface CreativeLegacyOrganizationInput {
  sourceField: LegacyCreativeField
  expectedHash: string
  disposition: LegacyCreativeDisposition
  targetCategories: CreativeContentCategory[]
}

export type LegacyCreativeField =
  | 'coreOutline'
  | 'worldSetting'
  | 'goldenFinger'
  | 'protagonistProfile'
  | 'globalGuidance'
  | 'writingStyle'

export type LegacyCreativeDisposition = 'organized' | 'ignored'

export interface LegacyCreativeSource {
  sourceField: LegacyCreativeField
  label: string
  content: string
  contentHash: string
  recommendedCategories: CreativeContentCategory[]
  disposition: LegacyCreativeDisposition | 'pending'
  reviewedAt?: string
}

export interface CreativePromptSource {
  id: string
  label: string
  category: CreativeContentCategory
  content: string
  status: 'formal' | 'legacy-pending' | 'plan' | 'candidate' | 'retired' | 'issue' | 'undecided'
  note?: string
  duplicateSources?: Array<Pick<CreativePromptSource, 'id' | 'label' | 'category' | 'status' | 'note'>>
}

export interface CreativeContextBundle {
  promptText: string
  sources: Array<Pick<CreativePromptSource, 'id' | 'label' | 'category' | 'status'>>
}

/**
 * Deduplicate only byte-equivalent normalized Markdown. Similar passages remain
 * separate and keep their source labels so the author can resolve conflicts.
 */
export function deduplicateCreativeSources(
  sources: readonly CreativePromptSource[],
): CreativePromptSource[] {
  const byContent = new Map<string, CreativePromptSource>()
  for (const source of sources) {
    const content = source.content.replace(/\r\n?/gu, '\n').normalize('NFC').trim()
    if (!content) continue
    const existing = byContent.get(content)
    if (!existing) {
      byContent.set(content, { ...source, content, duplicateSources: [...(source.duplicateSources ?? [])] })
      continue
    }
    const incomingSources = [{
      id: source.id,
      label: source.label,
      category: source.category,
      status: source.status,
      ...(source.note ? { note: source.note } : {}),
    }, ...(source.duplicateSources ?? [])]
    const knownIds = new Set([existing.id, ...(existing.duplicateSources ?? []).map(origin => origin.id)])
    existing.duplicateSources = [
      ...(existing.duplicateSources ?? []),
      ...incomingSources.filter(origin => !knownIds.has(origin.id)),
    ]
  }
  return [...byContent.values()]
}

export function buildCreativeContextBundle(
  sourcesInput: readonly CreativePromptSource[],
  writingLanguage: 'zh-CN' | 'en-US',
  options: { includeSourceList?: boolean } = {},
): CreativeContextBundle {
  const sources = deduplicateCreativeSources(sourcesInput)
  const zh = writingLanguage === 'zh-CN'
  const includeSourceList = options.includeSourceList !== false
  const promptText = sources.length === 0
    ? ''
    : [
        ...(includeSourceList ? [
          zh ? '【本次使用资料】' : '[Sources used for this request]',
          ...sources.flatMap(source => [source, ...(source.duplicateSources ?? [])].map(origin => {
          const label = `${origin.label} · ${origin.id}`
          const status = origin.status === 'formal'
            ? (zh ? '正式资料' : 'formal source')
            : origin.status === 'legacy-pending'
              ? (zh ? '待整理旧内容，仅作参考' : 'unorganized legacy input; reference only')
              : origin.status === 'undecided'
                ? (zh ? '作者尚未确定，不得补全' : 'undecided by the author; do not invent')
              : origin.status === 'plan'
                ? (zh ? '剧情计划，非已发生事实' : 'planned story, not established history')
                : origin.status === 'candidate'
                  ? (zh ? '候选，不作为事实' : 'candidate, not a fact')
                  : origin.status === 'retired'
                    ? (zh ? '废案，仅作禁用约束' : 'retired, prohibition context only')
                    : (zh ? '待解决问题' : 'unresolved issue')
          const note = origin.note ? `；${origin.note}` : ''
            return `- ${label}（${status}${note}）`
          })),
          '',
        ] : []),
        ...sources.map(source => {
          const origins = [source, ...(source.duplicateSources ?? [])]
          const statusNotes = [...new Set(origins.map(origin => origin.status))]
          const restrictions = statusNotes.map(status => status === 'legacy-pending'
            ? (zh
                ? '待整理旧内容｜以下原文尚未归位，不是已确认事实；如与正式资料冲突，以正式资料为准，并将冲突标出。'
                : 'Unorganized legacy input | this source is not confirmed fact; formal sources take precedence and any conflict must be surfaced.')
            : status === 'plan'
              ? (zh ? '计划｜不得当作已经发生的历史。' : 'Plan | do not treat as established history.')
              : status === 'undecided'
                ? (zh ? '未定｜作者尚未决定真相，不得自行补全或当作确定事实。' : 'Undecided | do not invent or present as confirmed fact.')
              : status === 'candidate'
                ? (zh ? '候选｜作者确认前不得作为正式事实。' : 'Candidate | do not treat as formal fact before author confirmation.')
                : status === 'retired'
                  ? (zh ? '废案｜只用于避免重提或重用。' : 'Retired | use only to avoid proposing or reusing it.')
                  : status === 'issue'
                    ? (zh ? '未解决问题｜作为审查约束，不得自行宣称已修复。' : 'Unresolved issue | review constraint; do not claim it is resolved.')
                    : '').filter(Boolean)
          const originLabels = origins.map(origin => `${origin.label} [${origin.id}]`).join('；')
          return [
            `### ${originLabels}${restrictions.length ? ` — ${restrictions.join('；')}` : ''}`,
            source.content,
          ].join('\n')
        }),
      ].join('\n')
  return {
    promptText,
    sources: sources.flatMap(source => [source, ...(source.duplicateSources ?? [])]
      .map(({ id, label, category, status }) => ({ id, label, category, status }))),
  }
}

export const LEGACY_CREATIVE_FIELD_LABELS: Record<LegacyCreativeField, string> = {
  coreOutline: '旧故事构想 / 核心大纲',
  worldSetting: '旧背景构想',
  goldenFinger: '旧主角优势 / 核心卖点',
  protagonistProfile: '旧主角构想',
  globalGuidance: '旧全局写作要求',
  writingStyle: '旧文风配置',
}

export const LEGACY_CREATIVE_FIELD_CATEGORIES: Record<LegacyCreativeField, CreativeContentCategory[]> = {
  coreOutline: ['premise', 'plot-planning'],
  worldSetting: ['world-setting', 'power-system', 'locations'],
  goldenFinger: ['characters', 'power-system', 'premise'],
  protagonistProfile: ['characters'],
  globalGuidance: ['creative-direction', 'writing-rules'],
  writingStyle: ['writing-rules'],
}
