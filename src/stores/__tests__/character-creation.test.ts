import { beforeEach, describe, expect, it } from 'vitest'

import type { ProjectData } from '../../shared/ipc-channels'
import { useCharacterStore, type CharacterCard } from '../character-store'
import { useEditorStore } from '../editor-store'
import { useProjectStore } from '../project-store'
import {
  CHARACTER_DRAFT_TAB,
  getProjectEditorDraft,
  parseProjectEditorDraftLedger,
} from '../project-editor-draft-ledger'

const PROJECT_PATH = 'C:\\novels\\character-creation'
const PROJECT_SESSION = {
  projectId: 'character-creation',
  leaseId: 'character-creation-lease',
  projectPath: PROJECT_PATH,
}

function project(): ProjectData {
  return {
    id: PROJECT_SESSION.projectId,
    sessionLease: PROJECT_SESSION.leaseId,
    name: '角色创建测试',
    path: PROJECT_PATH,
    novelConfig: {
      genre: '玄幻',
      subGenre: '',
      targetAudience: '全龄',
      totalChapters: 10,
      wordsPerChapter: 3000,
      plotStructure: 'three_act',
      narrativePOV: 'third_limited',
      coreOutline: '',
      worldSetting: '',
      goldenFinger: '',
      protagonistProfile: '',
      globalGuidance: '',
    },
    characterStates: '',
    createdAt: '',
    updatedAt: '',
  }
}

function card(name: string, role: CharacterCard['role'] = 'supporting'): CharacterCard {
  return {
    name,
    role,
    gender: '',
    age: '',
    appearance: '',
    personality: '',
    background: '',
    abilities: '',
    motivation: '',
    relationships: '',
    arc: '',
    notes: '',
  }
}

function draftValue(): unknown {
  const ledger = parseProjectEditorDraftLedger<CharacterCard[]>(
    useEditorStore.getState().draftLedgers[CHARACTER_DRAFT_TAB.id],
  )
  return getProjectEditorDraft(ledger, PROJECT_PATH)?.draftValue ?? null
}

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useProjectStore.setState({ currentProject: project(), fileTree: [], loading: false })
  useCharacterStore.getState().reset()
  useCharacterStore.setState({
    characters: [card('陆云飞')],
    selectedName: '陆云飞',
    loaded: true,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    rosterRevision: 1,
    loadingProjectKey: null,
    loadingProjectSession: null,
    lastError: null,
  })
})

describe('character creation contract', () => {
  it('creates an explicitly unassigned character and selects it', () => {
    const result = useCharacterStore.getState().addCharacter({ name: '沈砺' })

    expect(result).toEqual({ ok: true, name: '沈砺', role: 'unassigned' })
    expect(useCharacterStore.getState().characters.map(entry => [entry.name, entry.role])).toEqual([
      ['陆云飞', 'supporting'],
      // 未选择定位时是“暂未设定”，绝不是配角。
      ['沈砺', 'unassigned'],
    ])
    expect(useCharacterStore.getState().selectedName).toBe('沈砺')
    expect(draftValue()).toEqual([
      expect.objectContaining({ name: '陆云飞' }),
      expect.objectContaining({ name: '沈砺', role: 'unassigned' }),
    ])
  })

  it('keeps an author-chosen role including the protagonist option', () => {
    const result = useCharacterStore.getState().addCharacter({ name: '沈砺', role: 'protagonist' })

    expect(result).toEqual({ ok: true, name: '沈砺', role: 'protagonist' })
    expect(useCharacterStore.getState().characters[1]).toMatchObject({
      name: '沈砺',
      role: 'protagonist',
    })
  })

  it('trims the name and rejects an empty one without creating a ghost character', () => {
    expect(useCharacterStore.getState().addCharacter({ name: '   ' }))
      .toEqual({ ok: false, reason: 'empty_name' })
    expect(useCharacterStore.getState().addCharacter({ name: '' }))
      .toEqual({ ok: false, reason: 'empty_name' })

    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual(['陆云飞'])
    expect(useCharacterStore.getState().selectedName).toBe('陆云飞')
    expect(draftValue()).toBeNull()

    expect(useCharacterStore.getState().addCharacter({ name: '  沈砺  ' })).toMatchObject({ ok: true })
    expect(useCharacterStore.getState().characters[1].name).toBe('沈砺')
  })

  it('blocks duplicate names using the same identity rule as the roster transaction', () => {
    expect(useCharacterStore.getState().addCharacter({ name: '陆云飞' }))
      .toEqual({ ok: false, reason: 'duplicate_name' })
    expect(useCharacterStore.getState().addCharacter({ name: '  陆云飞 ' }))
      .toEqual({ ok: false, reason: 'duplicate_name' })
    // 大小写不敏感的身份键同样只允许一份。
    expect(useCharacterStore.getState().addCharacter({ name: 'Alice' })).toMatchObject({ ok: true })
    expect(useCharacterStore.getState().addCharacter({ name: '  alice ' }))
      .toEqual({ ok: false, reason: 'duplicate_name' })

    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual([
      '陆云飞', 'Alice',
    ])
  })

  it('never writes a character while the project session is unusable', () => {
    useCharacterStore.setState({ lastError: 'database busy' })
    expect(useCharacterStore.getState().addCharacter({ name: '沈砺' }))
      .toEqual({ ok: false, reason: 'not_ready' })

    useCharacterStore.setState({
      lastError: null,
      dataProjectSession: { ...PROJECT_SESSION, leaseId: 'another-lease' },
    })
    expect(useCharacterStore.getState().addCharacter({ name: '沈砺' }))
      .toEqual({ ok: false, reason: 'not_ready' })

    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual(['陆云飞'])
    expect(draftValue()).toBeNull()
  })
})
