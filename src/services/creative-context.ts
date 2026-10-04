import type { ProjectCoreData } from '../../electron/repositories/project-core-repository'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import {
  LEGACY_CREATIVE_FIELD_CATEGORIES,
  LEGACY_CREATIVE_FIELD_LABELS,
  type CreativeContentCategory,
  type CreativePromptSource,
  type LegacyCreativeSource,
} from '../shared/creative-content'
import { ipc } from './ipc-client'
import type { CultivationSystem } from '../shared/cultivation'
import type { WorldMapAtlas } from '../shared/world-map'
import type { CharacterRosterSnapshot } from '../shared/character-roster'
import type { InfoEntry, KnowledgeRecord } from '../shared/knowledge-gap'
import type { WritingLanguage } from '../shared/writing-language'
import { localizeNovelConfigFacts } from '../shared/novel-config-localization'

const CORE_FIELDS: Partial<Record<CreativeContentCategory, keyof ProjectCoreData>> = {
  'creative-direction': 'creativeDirectionMarkdown',
  'writing-rules': 'writingRulesMarkdown',
  premise: 'premise',
  'world-setting': 'worldbuilding',
  'plot-planning': 'synopsis',
}

const CORE_SOURCE_LABELS: Partial<Record<CreativeContentCategory, string>> = {
  'creative-direction': '创作方向',
  'writing-rules': '写作规范',
  premise: '故事前提',
  'world-setting': '世界设定',
  characters: '人物架构',
  'plot-planning': '全书总纲',
}

const ENGLISH_CATEGORY_LABELS: Record<CreativeContentCategory, string> = {
  'creative-direction': 'Creative direction', 'writing-rules': 'Writing rules', premise: 'Story premise',
  'world-setting': 'World setting', 'power-system': 'Power system', locations: 'Locations and regions',
  characters: 'Characters and relationships', 'plot-planning': 'Plot planning',
  'information-reveal': 'Information and reveals', materials: 'Materials and candidates',
  'retired-and-issues': 'Retired ideas and issues',
}

const ENGLISH_LEGACY_LABELS: Record<LegacyCreativeSource['sourceField'], string> = {
  coreOutline: 'Legacy story concept / core outline', worldSetting: 'Legacy background concept',
  goldenFinger: 'Legacy protagonist ability / selling point', protagonistProfile: 'Legacy protagonist profile',
  globalGuidance: 'Legacy global writing guidance', writingStyle: 'Legacy writing style',
}

function structuredDirection(core: ProjectCoreData, writingLanguage: WritingLanguage): string {
  const modelFacts = localizeNovelConfigFacts({ genre: core.genre, targetAudience: core.targetAudience }, writingLanguage)
  if (writingLanguage === 'en-US') return [
    modelFacts.genre && `Genre: ${modelFacts.genre}${core.subGenre ? ` / ${core.subGenre}` : ''}`,
    modelFacts.targetAudience && `Target audience: ${modelFacts.targetAudience}`,
    core.referenceWorks && `Reference works and adaptation boundaries:\n${core.referenceWorks}`,
    core.totalChapters > 0 && `Planned chapter count: ${core.totalChapters}`,
    core.wordsPerChapter > 0 && `Default chapter length: ${core.wordsPerChapter}`,
  ].filter(Boolean).join('\n')
  return [
    modelFacts.genre && `题材：${modelFacts.genre}${core.subGenre ? ` / ${core.subGenre}` : ''}`,
    modelFacts.targetAudience && `目标读者：${modelFacts.targetAudience}`,
    core.referenceWorks && `参考作品与借鉴边界：\n${core.referenceWorks}`,
    core.totalChapters > 0 && `预计总章数：${core.totalChapters}`,
    core.wordsPerChapter > 0 && `默认每章字数：${core.wordsPerChapter}`,
  ].filter(Boolean).join('\n')
}

function structuredWritingRules(core: ProjectCoreData, writingLanguage: WritingLanguage): string {
  const { narrativePOV } = localizeNovelConfigFacts({ narrativePOV: core.narrativePov }, writingLanguage)
  if (!narrativePOV) return ''
  return writingLanguage === 'en-US'
    ? `Narrative point of view: ${narrativePOV}`
    : `叙述视角：${narrativePOV}`
}

/** Read explicit formal core fields and attach only compatible, pending legacy fallbacks. */
export function buildCreativeCorePromptSources(
  core: ProjectCoreData,
  legacySources: readonly LegacyCreativeSource[],
  categories: readonly CreativeContentCategory[],
  writingLanguage: WritingLanguage = core.writingLanguage,
): CreativePromptSource[] {
  const requested = new Set(categories)
  const sources: CreativePromptSource[] = []
  const formalContent = new Map<CreativeContentCategory, string>()

  for (const category of categories) {
    if (category === 'characters') {
      const legacyCharacterArchitecture = String(core.charactersArch ?? '').trim()
      formalContent.set(category, '')
      if (legacyCharacterArchitecture) sources.push({
        id: 'project_core.characters_arch',
        label: writingLanguage === 'en-US' ? 'Legacy character architecture' : '旧人物架构',
        category,
        content: legacyCharacterArchitecture,
        status: 'legacy-pending',
        note: writingLanguage === 'en-US'
          ? 'Unorganized character notes; use only as reference until corresponding character records are organized.'
          : '旧人物资料尚未整理到人物档案前仅作参考。',
      })
      continue
    }
    const field = CORE_FIELDS[category]
    if (category === 'creative-direction') {
      const content = [String(core.creativeDirectionMarkdown ?? '').trim(), structuredDirection(core, writingLanguage)].filter(Boolean).join('\n\n')
      formalContent.set(category, content)
      if (content) sources.push({
        id: 'project_core.creative_direction_markdown',
        label: writingLanguage === 'en-US' ? ENGLISH_CATEGORY_LABELS[category] : CORE_SOURCE_LABELS[category]!,
        category, content, status: 'formal',
      })
      continue
    }
    if (category === 'writing-rules') {
      const markdown = String(core.writingRulesMarkdown ?? '').trim()
      const pointOfView = structuredWritingRules(core, writingLanguage)
      formalContent.set(category, markdown)
      if (markdown) sources.push({
        id: 'project_core.writing_rules_markdown',
        label: writingLanguage === 'en-US' ? ENGLISH_CATEGORY_LABELS[category] : CORE_SOURCE_LABELS[category]!,
        category, content: markdown, status: 'formal',
      })
      if (pointOfView) sources.push({
        id: 'project_core.narrative_pov',
        label: writingLanguage === 'en-US' ? 'Narrative point of view' : '叙述视角',
        category, content: pointOfView, status: 'formal',
      })
      continue
    }
    if (!field) continue
    const content = String(core[field] ?? '').trim()
    formalContent.set(category, content)
    if (content) sources.push({
      id: `project_core.${String(field)}`,
      label: writingLanguage === 'en-US' ? ENGLISH_CATEGORY_LABELS[category] : CORE_SOURCE_LABELS[category] ?? String(field),
      category,
      content,
      status: category === 'plot-planning' ? 'plan' : 'formal',
    })
  }

  for (const legacy of legacySources) {
    if (legacy.disposition !== 'pending' || !legacy.content.trim()) continue
    const eligibleCategories = LEGACY_CREATIVE_FIELD_CATEGORIES[legacy.sourceField]
      .filter(category => requested.has(category) && !(formalContent.get(category) ?? '').trim())
    if (eligibleCategories.length === 0) continue
    const category = eligibleCategories[0]
    sources.push({
      id: `legacy.${legacy.sourceField}`,
      label: writingLanguage === 'en-US' ? ENGLISH_LEGACY_LABELS[legacy.sourceField] : LEGACY_CREATIVE_FIELD_LABELS[legacy.sourceField],
      category,
      content: legacy.content,
      status: 'legacy-pending',
      note: writingLanguage === 'en-US'
        ? `Suggested destination: ${eligibleCategories.map(item => ENGLISH_CATEGORY_LABELS[item]).join(', ')}`
        : `建议归入：${eligibleCategories.join('、')}`,
    })
  }
  return sources
}

export async function loadLegacyCreativeSources(
  projectSession: ProjectSessionContext,
  expectedProjectPath: string,
): Promise<LegacyCreativeSource[]> {
  const legacy = await ipc.invokeWithProjectSession(
    projectSession,
    'db:creative-legacy-list',
    expectedProjectPath,
  )
  return legacy ?? []
}

export async function loadCreativeCorePromptSources(
  projectSession: ProjectSessionContext,
  expectedProjectPath: string,
  categories: readonly CreativeContentCategory[],
): Promise<CreativePromptSource[]> {
  const [core, legacy] = await Promise.all([
    ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', expectedProjectPath),
    loadLegacyCreativeSources(projectSession, expectedProjectPath),
  ])
  if (!core) throw new Error('无法读取项目正式资料：项目核心资料不存在。')
  return buildCreativeCorePromptSources(core, legacy, categories, core.writingLanguage)
}

export async function loadCreativeDomainPromptSources(
  projectSession: ProjectSessionContext,
  expectedProjectPath: string,
  options: { powerSystem?: boolean; locations?: boolean; relevanceText?: string; writingLanguage?: WritingLanguage },
): Promise<CreativePromptSource[]> {
  const sources: CreativePromptSource[] = []
  const relevance = options.relevanceText?.toLocaleLowerCase() ?? ''
  const english = options.writingLanguage === 'en-US'
  if (options.powerSystem) {
    const system = await ipc.invokeWithProjectSession(projectSession, 'db:cultivation-read', expectedProjectPath) as CultivationSystem
    const levels = system.realms.map(realm => [realm.name, ...realm.stages.map(stage => stage.name)].join(' / ')).join('\n')
    const content = [system.markdown?.trim(), levels].filter(Boolean).join('\n\n')
    if (content) sources.push({
      id: 'cultivation_meta.markdown',
      label: english ? 'Power system' : '力量体系',
      category: 'power-system',
      content,
      status: 'formal',
    })
  }
  if (options.locations) {
    const atlas = await ipc.invokeWithProjectSession(projectSession, 'db:map-get-all', expectedProjectPath) as WorldMapAtlas
    const matches = atlas.nodes.filter(node => (
      node.description.trim()
      && relevance.length > 0
      && (relevance.includes(node.name.toLocaleLowerCase()) || node.name.toLocaleLowerCase().includes(relevance))
    ))
    for (const node of matches) {
      sources.push({
        id: `world_map_nodes.${node.id}`,
        label: english ? `Location: ${node.name}` : `地点：${node.name}`,
        category: 'locations',
        content: node.description,
        status: 'formal',
      })
    }
  }
  return sources
}

/** Load only author-selected, usable material records; candidates never enter context implicitly. */
export async function loadSelectedCreativeMaterialPromptSources(
  projectSession: ProjectSessionContext,
  expectedProjectPath: string,
  selectedIds: readonly string[],
): Promise<CreativePromptSource[]> {
  const ids = [...new Set(selectedIds.map(id => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []
  if (ids.length > 20) throw new Error('一次最多选择 20 条素材作为规划输入。')
  const entries = await ipc.invokeWithProjectSession(
    projectSession,
    'db:creative-material-list',
    { entryKind: 'material' },
    expectedProjectPath,
  )
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return ids.map(id => {
    const entry = byId.get(id)
    if (!entry) throw new Error(`所选素材不存在或已移除：${id}`)
    if (!['candidate', 'adopted'].includes(entry.status)) {
      throw new Error(`所选素材当前不能用于发想：${entry.title}（${entry.status}）`)
    }
    if (!entry.markdown.trim()) throw new Error(`所选素材没有正文：${entry.title}`)
    return {
      id: `creative_material_entries.${entry.id}@r${entry.revision}`,
      label: `作者选择的素材：${entry.title}`,
      category: 'materials',
      content: entry.markdown,
      status: 'candidate',
      note: `显式选择用于总纲发想；素材状态：${entry.status === 'adopted' ? '已采用但仍须按计划素材处理' : '候选'}${entry.sourceFileName ? `；来源：${entry.sourceFileName}${entry.sourceHeading ? ` / ${entry.sourceHeading}` : ''}` : ''}`,
    }
  })
}

/** Build explicit author-truth and reader/character knowledge sources for planning. */
export async function loadInformationRevealPromptSources(
  projectSession: ProjectSessionContext,
  expectedProjectPath: string,
  chapterNumbers?: readonly number[],
): Promise<CreativePromptSource[]> {
  const [entries, records] = await Promise.all([
    ipc.invokeWithProjectSession(projectSession, 'db:info-entry-list', undefined, expectedProjectPath) as Promise<InfoEntry[]>,
    ipc.invokeWithProjectSession(projectSession, 'db:knowledge-record-list', undefined, expectedProjectPath) as Promise<KnowledgeRecord[]>,
  ])
  const allowedChapters = chapterNumbers ? new Set(chapterNumbers) : null
  const relevantRecords = records.filter(record => !allowedChapters || (
    record.narrativePosition.kind === 'chapter-scene'
    && allowedChapters.has(record.narrativePosition.chapterNumber)
  ))
  const relevantInfoIds = new Set(relevantRecords.map(record => record.infoId))
  const relevantEntries = allowedChapters
    ? entries.filter(entry => relevantInfoIds.has(entry.id))
    : entries
  const sources: CreativePromptSource[] = []
  for (const entry of relevantEntries) {
    const status = entry.truthStatus === 'confirmed' ? 'formal' : entry.truthStatus === 'undecided' ? 'undecided' : 'retired'
    const content = [
      `作者真相状态：${entry.truthStatus === 'confirmed' ? '已确认' : entry.truthStatus === 'undecided' ? '未定' : '已废止'}`,
      entry.summary.trim() ? `作者摘要：\n${entry.summary.trim()}` : '',
      entry.truthStatus === 'confirmed' && entry.truth.trim() ? `作者确认真相：\n${entry.truth.trim()}` : '',
      entry.truthStatus === 'undecided' ? '作者尚未确定真相；不得自行补全。' : '',
      entry.truthStatus === 'retired' && entry.truth.trim() ? `已废止内容，仅用于禁止复用：\n${entry.truth.trim()}` : '',
    ].filter(Boolean).join('\n\n')
    if (content) sources.push({
      id: `info_entries.${entry.id}@r${entry.revision}`,
      label: `信息与揭露：${entry.title}`,
      category: 'information-reveal',
      content,
      status,
    })
    for (const record of relevantRecords.filter(item => item.infoId === entry.id)) {
      const subject = record.subjectKind === 'reader' ? '读者' : `人物 ${record.characterId ?? '未指定'}`
      const recordContent = [
        `记录依据：${record.basis === 'plan' ? '计划' : record.proseAnchor?.status === 'finalized' ? '已定稿正文锚点' : '未定稿正文锚点'}`,
        `主体：${subject}；认知：${record.cognition}；与作者真相关系：${record.truthRelation}`,
        record.knownContent.trim() ? `已知内容：${record.knownContent.trim()}` : '',
        record.believedStatement.trim() ? `相信的说法：${record.believedStatement.trim()}` : '',
        record.learningChannel.trim() ? `获知途径：${record.learningChannel.trim()}` : '',
        `故事位置：${JSON.stringify(record.storyPosition)}；叙事位置：${JSON.stringify(record.narrativePosition)}`,
        record.concealment?.publicStatement ? `公开说法：${record.concealment.publicStatement}` : '',
        record.reader ? `读者已见证据：${record.reader.shownEvidence}\n作者预期读者理解：${record.reader.expectedUnderstanding}\n揭露计划：${record.reader.revealPlanNote}` : '',
      ].filter(Boolean).join('\n')
      const recordStatus = record.basis === 'plan' ? 'plan' : record.proseAnchor?.status === 'finalized' ? 'formal' : 'candidate'
      sources.push({
        id: `knowledge_records.${record.id}@r${record.revision}`,
        label: `${entry.title} · ${subject}知情与揭露`,
        category: 'information-reveal',
        content: recordContent,
        status: entry.truthStatus === 'retired' ? 'retired' : recordStatus,
        note: record.basis === 'plan' ? '知情/揭露计划，不代表已发生' : undefined,
      })
    }
  }
  return sources
}

export async function loadCharacterProfilePromptSource(
  projectSession: ProjectSessionContext,
  expectedProjectPath: string,
  names: readonly string[],
): Promise<CreativePromptSource | null> {
  const requestedNames = [...new Set(names.map(name => name.trim()).filter(Boolean))]
  if (requestedNames.length === 0) return null
  const roster = await ipc.invokeWithProjectSession(
    projectSession,
    'db:character-roster-read',
    expectedProjectPath,
  ) as CharacterRosterSnapshot
  if (roster.status !== 'ready' && roster.status !== 'empty') {
    throw new Error(`人物档案读取失败：角色名单状态为 ${roster.status}。`)
  }
  const selected = roster.entries.filter(entry => requestedNames.includes(entry.name))
  const content = selected.map(entry => [
    `## ${entry.name}${entry.role ? `（${entry.role}）` : ''}`,
    entry.gender && `性别：${entry.gender}`,
    entry.age && `年龄：${entry.age}`,
    entry.appearance && `外貌：${entry.appearance}`,
    entry.personality && `性格：${entry.personality}`,
    entry.motivation && `目标与欲望：${entry.motivation}`,
    entry.background && `背景：${entry.background}`,
    entry.abilities && `个人能力：${entry.abilities}`,
    entry.arc && `人物弧线（计划）：${entry.arc}`,
    entry.notes && `备注：${entry.notes}`,
    ...entry.relationships.map(relationship => `关系：${relationship.target}（${relationship.relation}）`),
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')
  if (!content) return null
  return {
    id: `character_roster.revision.${roster.revision}`,
    label: '本章相关人物档案',
    category: 'characters',
    content,
    status: 'formal',
    note: `仅包含明确选中的人物：${selected.map(entry => entry.name).join('、')}`,
  }
}
