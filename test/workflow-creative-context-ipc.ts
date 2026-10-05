import { createHash } from 'node:crypto'
import { useProjectStore } from '../src/stores/project-store'
import {
  LEGACY_CREATIVE_FIELD_CATEGORIES,
  LEGACY_CREATIVE_FIELD_LABELS,
  type LegacyCreativeField,
  type LegacyCreativeSource,
} from '../src/shared/creative-content'

type TestInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>

function legacyRowsFromCore(core: Record<string, unknown>): LegacyCreativeSource[] {
  const fields: LegacyCreativeField[] = [
    'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile', 'globalGuidance', 'writingStyle',
  ]
  return fields.flatMap(sourceField => {
    const content = typeof core[sourceField] === 'string' ? String(core[sourceField]).trim() : ''
    if (!content) return []
    return [{
      sourceField,
      label: LEGACY_CREATIVE_FIELD_LABELS[sourceField],
      content,
      contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      recommendedCategories: LEGACY_CREATIVE_FIELD_CATEGORIES[sourceField],
      disposition: 'pending',
    }]
  })
}

function projectCoreFromCurrentProject(): Record<string, unknown> {
  const config = useProjectStore.getState().currentProject?.novelConfig as Record<string, unknown> | undefined
  const stringField = (key: string) => typeof config?.[key] === 'string' ? config[key] : ''
  const numberField = (key: string) => typeof config?.[key] === 'number' ? config[key] : 0
  return {
    projectName: useProjectStore.getState().currentProject?.name ?? '',
    genre: stringField('genre'), subGenre: stringField('subGenre'), targetAudience: stringField('targetAudience'),
    totalChapters: numberField('totalChapters'), wordsPerChapter: numberField('wordsPerChapter'),
    writingLanguage: config?.writingLanguage ?? 'zh-CN', creativeStrategy: 'auto',
    narrativeThreadDormantChapterThreshold: 8, plotStructure: stringField('plotStructure'),
    narrativePov: stringField('narrativePOV'), writingStyle: stringField('writingStyle'),
    creativeDirectionMarkdown: '', writingRulesMarkdown: '', referenceWorks: stringField('referenceWorks'),
    globalGuidance: stringField('globalGuidance'), goldenFinger: stringField('goldenFinger'),
    coreOutline: stringField('coreOutline'), worldSetting: stringField('worldSetting'),
    protagonistProfile: stringField('protagonistProfile'), premise: '', worldbuilding: '',
    charactersArch: '', synopsis: '', characterStates: '',
  }
}

function isGenericUnmatchedChannel(error: unknown, channel: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message === `Unexpected IPC channel: ${channel}`
    || message === `unexpected IPC: ${channel}`
}

/**
 * Keep existing workflow tests focused on their scenario while giving newly
 * required creative-context reads realistic empty or legacy-backed fixtures.
 * Explicit test responses and meaningful read errors still pass through.
 */
export function withWorkflowCreativeContextIpcDefaults(invoke: TestInvoke): TestInvoke {
  let latestCore: Record<string, unknown> | null = null
  return async (channel, ...args) => {
    let result: unknown
    try {
      result = await invoke(channel, ...args)
    } catch (error) {
      if (!isGenericUnmatchedChannel(error, channel)) throw error
      if (channel === 'db:project-core-get') result = projectCoreFromCurrentProject()
      else if (channel === 'db:creative-legacy-list') result = legacyRowsFromCore(latestCore ?? projectCoreFromCurrentProject())
      else if (channel === 'db:cultivation-read') result = { revision: 0, realms: [], markdown: '' }
      else if (channel === 'db:map-get-all') result = { maps: [], nodes: [], edges: [] }
      else if (channel === 'db:info-entry-list' || channel === 'db:knowledge-record-list' || channel === 'db:creative-material-list') result = []
      else if (channel === 'db:character-identities-get') result = {}
      else if (channel === 'db:character-roster-read') result = {
        schemaVersion: 1, revision: 0, migrationState: 'empty', status: 'empty',
        entries: [], renderedMarkdown: '', projectionHash: '', factHash: '',
      }
      else throw error
    }

    if (channel === 'db:project-core-get' && result === undefined) result = projectCoreFromCurrentProject()
    if (channel === 'db:project-core-get'
      && result && typeof result === 'object' && 'success' in result
      && Object.keys(result).every(key => key === 'success' || key === 'error')) {
      result = projectCoreFromCurrentProject()
    }
    if (channel === 'db:project-core-get' && result && typeof result === 'object') {
      latestCore = {
        ...projectCoreFromCurrentProject(),
        ...(result as Record<string, unknown>),
      }
      result = latestCore
    }
    if (channel === 'db:creative-legacy-list' && !Array.isArray(result)) {
      return legacyRowsFromCore(latestCore ?? projectCoreFromCurrentProject())
    }
    if (channel === 'db:cultivation-read'
      && (!result || typeof result !== 'object' || !Array.isArray((result as { realms?: unknown }).realms))) {
      return { revision: 0, realms: [], markdown: '' }
    }
    if (channel === 'db:map-get-all'
      && (!result || typeof result !== 'object' || !Array.isArray((result as { nodes?: unknown }).nodes))) {
      return { maps: [], nodes: [], edges: [] }
    }
    if ((channel === 'db:info-entry-list' || channel === 'db:knowledge-record-list' || channel === 'db:creative-material-list')
      && !Array.isArray(result)) return []
    if (channel === 'db:character-identities-get' && (!result || typeof result !== 'object')) return {}
    if (channel === 'db:character-roster-read'
      && (!result || typeof result !== 'object' || !['ready', 'empty', 'legacy_repair_required', 'inconsistent'].includes(String((result as { status?: unknown }).status)))) {
      return {
        schemaVersion: 1, revision: 0, migrationState: 'empty', status: 'empty',
        entries: [], renderedMarkdown: '', projectionHash: '', factHash: '',
      }
    }
    return result
  }
}
