import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import {
  projectSessionContextFromProject,
  sameProjectPathKey,
  sameProjectSessionContext,
} from '../shared/project-session-context'
import type {
  CharacterData,
  CharacterStateData,
} from '../../electron/repositories/character-repository'
import { normalizeCharacterRole, DEFAULT_CHARACTER_CREATION_ROLE, type CharacterRole } from '../shared/character-role'
import { characterRosterIdentityKey } from '../shared/character-roster'
import { cultivationLevels } from '../shared/cultivation'
import {
  characterCardFromRosterEntry,
  characterRosterEntriesFromCards,
} from '../services/character-roster-client'
import { randomUUID } from '../utils/id'
import { classifyRelationshipStorage } from '../shared/relationship-presentation'
import type {
  CharacterSharedRelationship,
  CharacterGraphPosition,
  CharacterIdentityMap,
} from '../shared/character-relationship'
import {
  isMatchingRelationship,
  projectLegacyRelationshipsField,
  projectSharedRelationshipEdge,
} from '../shared/character-relationship'
import { useEditorStore } from './editor-store'
import { useProjectStore } from './project-store'
import {
  CHARACTER_DRAFT_TAB,
  discardProjectEditorDraft,
  getProjectEditorDraft,
  mergeNamedRecordDraftWithRemote,
  parseProjectEditorDraftLedger,
  persistProjectEditorDraftLedger,
  rebaseProjectEditorDraft,
  recordProjectEditorEdit,
  settleProjectEditorSave,
} from './project-editor-draft-ledger'
import {
  getCharacterDraftRenames,
  mergeCharacterDraftWithRemote,
  rebuildCharacterRenamesAfterSave,
  setCharacterDraftRenames,
  updateCharacterRename,
} from './character-rename-ledger'

export type CharacterCurrentState = CharacterStateData
export type CharacterCard = CharacterData

/** Remote rebinding wins over an old draft, while unrelated profile edits survive. */
export function reconcileCharacterCultivationDraft(
  cards: CharacterCard[], base: CharacterCard[], remote: CharacterCard[],
  validIds: ReadonlySet<string>, renames: { originalName: string; newName: string }[] = [],
): CharacterCard[] {
  return cards.map(card => {
    const name = renames.find(rename => rename.newName === card.name)?.originalName ?? card.name
    const persisted = remote.find(entry => entry.name === name)
    if (!persisted) return card
    const original = base.find(entry => entry.name === name)
    if ((persisted.cultivationLevelId ?? null) === (original?.cultivationLevelId ?? null)
      && (!card.cultivationLevelId || validIds.has(card.cultivationLevelId))) return card
    const next = { ...card }
    if (persisted.cultivationLevelId) next.cultivationLevelId = persisted.cultivationLevelId
    else delete next.cultivationLevelId
    return next
  })
}

export const EMPTY_CARD: CharacterCard = {
  name: '', role: DEFAULT_CHARACTER_CREATION_ROLE, gender: '', age: '',
  appearance: '', personality: '', background: '', abilities: '',
  motivation: '', relationships: '', arc: '', notes: '',
}

export const EMPTY_STATE: CharacterCurrentState = {
  location: '', powerLevel: '', physicalState: '', mentalState: '',
  keyItems: '', recentEvents: '', updatedAtChapter: 0,
}

export type CharacterCreationFailure = 'empty_name' | 'duplicate_name' | 'not_ready'

export interface CharacterCreationRequest {
  name: string
  /** 作者未选择定位时按“暂未设定”创建：绝不能默认成配角。 */
  role?: CharacterRole
}

export type CharacterCreationResult =
  | { ok: true; name: string; role: CharacterRole }
  | { ok: false; reason: CharacterCreationFailure }

function textField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : ''
}

function normalizeCharacterState(value: unknown): CharacterCurrentState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const state = value as Record<string, unknown>
  const provenance = state.provenance && typeof state.provenance === 'object' && !Array.isArray(state.provenance)
    ? state.provenance as CharacterCurrentState['provenance']
    : undefined
  return {
    location: textField(state, 'location'),
    powerLevel: textField(state, 'powerLevel'),
    physicalState: textField(state, 'physicalState'),
    mentalState: textField(state, 'mentalState'),
    keyItems: textField(state, 'keyItems'),
    recentEvents: textField(state, 'recentEvents'),
    updatedAtChapter: Number.isInteger(state.updatedAtChapter) && Number(state.updatedAtChapter) >= 0
      ? Number(state.updatedAtChapter)
      : 0,
    ...(provenance ? { provenance } : {}),
  }
}

function readCharacterDraftLedger(projectKey: string) {
  const ledger = parseProjectEditorDraftLedger<unknown>(
    useEditorStore.getState().draftLedgers[CHARACTER_DRAFT_TAB.id],
  )
  return {
    version: 1 as const,
    projects: ledger.projects.map(project => (
      project.projectKey === projectKey
        ? {
            ...project,
            baseValue: normalizeCharacterCards(project.baseValue),
            draftValue: normalizeCharacterCards(project.draftValue),
          }
        : project
    )),
    // The ledger is heterogeneous on disk. Only the requested project is ever
    // read through the typed editor helpers; foreign payloads stay opaque and
    // are carried through byte-for-byte at the value level.
  } as ReturnType<typeof parseProjectEditorDraftLedger<CharacterCard[]>>
}

function normalizeCharacterCards(value: unknown): CharacterCard[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (
      !candidate
      || typeof candidate !== 'object'
      || typeof (candidate as { name?: unknown }).name !== 'string'
    ) return []
    const card = candidate as Record<string, unknown>
    const currentState = normalizeCharacterState(card.currentState)
    const normalizedCard = {
      ...card,
      name: card.name as string,
      role: normalizeCharacterRole(card.role),
      gender: textField(card, 'gender'),
      age: textField(card, 'age'),
      appearance: textField(card, 'appearance'),
      personality: textField(card, 'personality'),
      background: textField(card, 'background'),
      abilities: textField(card, 'abilities'),
      motivation: textField(card, 'motivation'),
      relationships: textField(card, 'relationships'),
      arc: textField(card, 'arc'),
      notes: textField(card, 'notes'),
      ...(card.cultivationLevelId !== undefined ? { cultivationLevelId: card.cultivationLevelId } : {}),
    } as CharacterCard
    if (currentState) normalizedCard.currentState = currentState
    else delete normalizedCard.currentState
    return [normalizedCard]
  })
}

/**
 * 旧 characters.relationships 字段的派生投影。
 *
 * 共享关系表是唯一事实源；这里只把共享关系按人物 ID 投影回旧字段（旧导出兼容）。
 * 自由文本、未迁移、目标不存在或与共享关系冲突的旧内容一律保持原样，绝不覆盖。
 */
export function syncCardsWithRelationships(
  cards: readonly CharacterCard[],
  relationships: readonly CharacterSharedRelationship[],
  identities: CharacterIdentityMap,
  options: { removedNames?: readonly string[] } = {},
): CharacterCard[] {
  const knownNames = cards.map(card => card.name)
  return cards.map(card => {
    if (classifyRelationshipStorage(card.relationships) === 'legacy') return card
    const characterId = identities[card.name]
    if (!characterId) return card
    const edges = relationships
      .filter(rel => rel.character1Id === characterId || rel.character2Id === characterId)
      .map(rel => projectSharedRelationshipEdge(rel, characterId))
      .filter((edge): edge is { target: string; relation: string } => edge !== null)
    const projected = projectLegacyRelationshipsField(card.relationships, edges, {
      knownNames,
      removedNames: options.removedNames,
    })
    if (projected === null || projected === card.relationships) return card
    return { ...card, relationships: projected }
  })
}

/**
 * 身份表响应校验：写通道在项目上下文过期时返回结构化失败而不是映射，
 * 这种情况下宁可暂时没有 ID，也不能把失败对象当成身份表使用。
 */
function identityMapFromResponse(value: unknown): CharacterIdentityMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  if ('success' in (value as Record<string, unknown>)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function persistCharacterDraftLedger(ledger: ReturnType<typeof readCharacterDraftLedger>) {
  persistProjectEditorDraftLedger(useEditorStore.getState(), CHARACTER_DRAFT_TAB, ledger)
}

function currentCharacterProjectSession(
  expectedProjectPath?: string,
  expectedProjectSession?: ProjectSessionContext,
): ProjectSessionContext | null {
  const project = useProjectStore.getState().currentProject
  const projectSession = projectSessionContextFromProject(project)
  if (
    !project
    || !projectSession
    || (expectedProjectPath && !sameProjectPathKey(project.path, expectedProjectPath))
    || (expectedProjectSession && !sameProjectSessionContext(expectedProjectSession, projectSession))
  ) return null
  return projectSession
}

function isCharacterProjectSessionCurrent(projectSession: ProjectSessionContext): boolean {
  return sameProjectSessionContext(
    projectSession,
    projectSessionContextFromProject(useProjectStore.getState().currentProject),
  )
}

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 主进程用 String(error) 序列化失败原因；剥离多余的 “Error: ” 前缀，提示保持可读。 */
function rosterCommitErrorText(value: string | undefined): string {
  const text = value?.trim() || '角色卡保存失败'
  return text.replace(/^(?:Error:\s*)+/, '')
}

function removeFirstCharacterNamed(
  characters: readonly CharacterCard[],
  name: string,
): CharacterCard[] {
  const targetIndex = characters.findIndex(character => character.name === name)
  return targetIndex < 0
    ? [...characters]
    : characters.filter((_, index) => index !== targetIndex)
}

interface SessionOperation<T> {
  projectSession: ProjectSessionContext
  promise: Promise<T>
  kind: 'save' | 'rename' | 'delete'
}

let characterSaveInFlight: SessionOperation<void> | null = null
let characterIdentityMutationInFlight: SessionOperation<unknown> | null = null
let characterLoadSequence = 0

interface CharacterState {
  characters: CharacterCard[]
  selectedName: string | null
  saving: boolean
  identityBusy: boolean
  loaded: boolean
  /** 当前 characters 数组实际归属的项目；为空时禁止任何角色写操作。 */
  dataProjectKey: string | null
  /** Exact lease whose character data is currently mounted. */
  dataProjectSession: ProjectSessionContext | null
  /** 当前角色卡来自的 roster revision；所有保存都必须带回这一乐观并发令牌。 */
  rosterRevision: number | null
  loadingProjectKey: string | null
  loadingProjectSession: ProjectSessionContext | null
  lastError: string | null

  load: (projectPath?: string, expectedProjectSession?: ProjectSessionContext) => Promise<void>
  beginProjectLoad: (projectPath: string) => void
  reset: () => void
  setSelectedName: (name: string | null) => void
  /**
   * 创建角色卡。姓名必填且必须唯一：校验失败时不写入任何状态，避免留下幽灵角色。
   * 作者未选定位时按“暂未设定”创建，不再默认成配角。
   */
  addCharacter: (request: CharacterCreationRequest) => CharacterCreationResult
  deleteCharacter: (
    name: string,
    projectPath?: string,
    expectedProjectSession?: ProjectSessionContext,
  ) => Promise<boolean>
  clearAllCharacters: (
    projectPath?: string,
    expectedProjectSession?: ProjectSessionContext,
  ) => Promise<boolean>
  renameCharacter: (name: string, newName: string) => boolean
  acceptCultivationSnapshot: (snapshot: import('../shared/character-roster').CharacterRosterSnapshot, session: ProjectSessionContext, validIds: ReadonlySet<string>) => void
  discardDraft: (projectPath: string, expectedProjectSession?: ProjectSessionContext) => void
  updateField: <K extends Exclude<keyof CharacterCard, 'name'>>(
    name: string,
    key: K,
    value: CharacterCard[K],
  ) => void
  saveAll: (
    projectPath?: string,
    expectedProjectSession?: ProjectSessionContext,
    operationKind?: 'delete',
  ) => Promise<void>

  // 关系画布与共用关系
  /** 姓名 → 稳定人物 ID；关系与画布坐标只认 ID。 */
  characterIdentities: CharacterIdentityMap
  relationships: CharacterSharedRelationship[]
  graphPositions: Record<string, CharacterGraphPosition>
  loadRelationshipsAndPositions: (projectPath?: string, expectedProjectSession?: ProjectSessionContext) => Promise<void>
  upsertRelationship: (data: {
    id?: string
    character1Id: string
    character2Id: string
    relation: string
    description?: string
  }) => Promise<CharacterSharedRelationship | null>
  deleteRelationship: (id: string) => Promise<boolean>
  saveGraphPositions: (positions: Record<string, CharacterGraphPosition>) => Promise<void>

  // 兼容旧接口
  loadCharacters: (projectPath: string, expectedProjectSession?: ProjectSessionContext) => Promise<void>
}

export const useCharacterStore = create<CharacterState>()((set, get) => ({
  characters: [],
  characterIdentities: {},
  relationships: [],
  graphPositions: {},
  selectedName: null,
  saving: false,
  identityBusy: false,
  loaded: false,
  dataProjectKey: null,
  dataProjectSession: null,
  rosterRevision: null,
  loadingProjectKey: null,
  loadingProjectSession: null,
  lastError: null,

  load: async (projectPath, expectedProjectSession) => {
    const projectSession = currentCharacterProjectSession(projectPath, expectedProjectSession)
    if (!projectSession) return
    const requestedProjectKey = projectSession.projectPath
    const requestSequence = ++characterLoadSequence
    if (!sameProjectSessionContext(get().dataProjectSession, projectSession)) {
      set({
        characters: [],
        selectedName: null,
        loaded: false,
        dataProjectKey: null,
        dataProjectSession: null,
        rosterRevision: null,
        loadingProjectKey: requestedProjectKey,
        loadingProjectSession: projectSession,
        lastError: null,
      })
    } else {
      set({
        loadingProjectKey: requestedProjectKey,
        loadingProjectSession: projectSession,
        lastError: null,
      })
    }
    const pendingIdentityMutation = characterIdentityMutationInFlight
    if (
      pendingIdentityMutation
      && sameProjectSessionContext(pendingIdentityMutation.projectSession, projectSession)
    ) {
      try {
        await pendingIdentityMutation.promise
      } catch {
        // 身份操作失败不应永久阻断后续项目加载。
      }
      if (
        !isCharacterProjectSessionCurrent(projectSession)
        || requestSequence !== characterLoadSequence
      ) return
    }
    try {
      const roster = await ipc.invokeWithProjectSession(
        projectSession,
        'db:character-roster-read',
        requestedProjectKey,
      )
      if (
        !isCharacterProjectSessionCurrent(projectSession)
        || requestSequence !== characterLoadSequence
      ) return

      const draftLedger = readCharacterDraftLedger(requestedProjectKey)
      const cards = normalizeCharacterCards(roster.entries.map(characterCardFromRosterEntry))
      const renames = requestedProjectKey
        ? getCharacterDraftRenames(draftLedger, requestedProjectKey)
        : []
      const projectDraft = getProjectEditorDraft(draftLedger, requestedProjectKey)
      const hasBinding = [...cards, ...(projectDraft?.draftValue ?? [])].some(card => card.cultivationLevelId)
      const validIds = hasBinding
        ? new Set(cultivationLevels((await ipc.invokeWithProjectSession(projectSession, 'db:cultivation-read', requestedProjectKey)).realms).map(level => level.id))
        : new Set<string>()
      if (!isCharacterProjectSessionCurrent(projectSession) || requestSequence !== characterLoadSequence) return
      if (sameProjectSessionContext(get().dataProjectSession, projectSession)
        && get().rosterRevision !== null && roster.revision < get().rosterRevision!) {
        set({ loadingProjectKey: null, loadingProjectSession: null })
        return
      }
      const restored = requestedProjectKey
        ? rebaseProjectEditorDraft(
            draftLedger,
            requestedProjectKey,
            cards,
            (base, draft, remote) => (
              reconcileCharacterCultivationDraft(renames.length > 0
                ? mergeCharacterDraftWithRemote(base, draft, remote, renames)
                : mergeNamedRecordDraftWithRemote(base, draft, remote), base, remote, validIds, renames)
            ),
          )
        : { ledger: draftLedger, value: cards }
      if (requestedProjectKey && getProjectEditorDraft(draftLedger, requestedProjectKey)) {
        persistCharacterDraftLedger(restored.ledger)
      }
      if (
        !isCharacterProjectSessionCurrent(projectSession)
        || requestSequence !== characterLoadSequence
      ) return
      const visibleCards = normalizeCharacterCards(restored.value)
      let identities: CharacterIdentityMap = {}
      let sharedRels: CharacterSharedRelationship[] = []
      let positions: Record<string, CharacterGraphPosition> = {}
      try {
        // 旧项目打开时安全补齐稳定人物 ID，再读取共享关系与画布坐标。
        identities = identityMapFromResponse(await ipc.invokeWithProjectSession(
          projectSession,
          'db:character-identities-ensure',
          visibleCards.map(card => card.name),
          requestedProjectKey,
        ))
        const [relsResult, posResult] = await Promise.all([
          ipc.invokeWithProjectSession(projectSession, 'db:character-relationships-get-all', requestedProjectKey),
          ipc.invokeWithProjectSession(projectSession, 'db:character-graph-positions-get', requestedProjectKey),
        ])
        if (Array.isArray(relsResult)) sharedRels = relsResult
        if (posResult && typeof posResult === 'object') positions = posResult
      } catch {
        // 关系通道不可用时角色卡本身仍然可用；关系随后可重试加载。
      }

      const syncedCards = syncCardsWithRelationships(visibleCards, sharedRels, identities)

      if (!isCharacterProjectSessionCurrent(projectSession) || requestSequence !== characterLoadSequence) return
      if (sameProjectSessionContext(get().dataProjectSession, projectSession)
        && get().rosterRevision !== null && roster.revision < get().rosterRevision!) {
        set({ loadingProjectKey: null, loadingProjectSession: null })
        return
      }

      const { selectedName } = get()
      set({
        characters: syncedCards,
        characterIdentities: identities,
        relationships: sharedRels,
        graphPositions: positions,
        loaded: true,
        dataProjectKey: requestedProjectKey,
        dataProjectSession: projectSession,
        rosterRevision: roster.revision,
        loadingProjectKey: null,
        loadingProjectSession: null,
        lastError: null,
        selectedName: syncedCards.find(c => c.name === selectedName)
          ? selectedName
          : (syncedCards.length > 0 ? syncedCards[0].name : null),
      })
    } catch (error) {
      if (
        !isCharacterProjectSessionCurrent(projectSession)
        || requestSequence !== characterLoadSequence
      ) return
      set({
        characters: [],
        selectedName: null,
        loaded: false,
        dataProjectKey: requestedProjectKey,
        dataProjectSession: projectSession,
        rosterRevision: null,
        loadingProjectKey: null,
        loadingProjectSession: null,
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  loadCharacters: async (projectPath, expectedProjectSession) => {
    await get().load(projectPath, expectedProjectSession)
  },

  beginProjectLoad: (projectPath) => {
    characterLoadSequence += 1
    set({
      characters: [],
      selectedName: null,
      saving: false,
      identityBusy: false,
      loaded: false,
      dataProjectKey: null,
      dataProjectSession: null,
      rosterRevision: null,
      loadingProjectKey: projectPath,
      loadingProjectSession: null,
      lastError: null,
    })
  },

  reset: () => {
    characterLoadSequence += 1
    set({
      characters: [],
      selectedName: null,
      saving: false,
      identityBusy: false,
      loaded: false,
      dataProjectKey: null,
      dataProjectSession: null,
      rosterRevision: null,
      loadingProjectKey: null,
      loadingProjectSession: null,
      lastError: null,
    })
  },

  setSelectedName: (name) => {
    const projectSession = currentCharacterProjectSession()
    const state = get()
    if (
      !projectSession
      || !sameProjectSessionContext(state.dataProjectSession, projectSession)
      || state.loadingProjectSession !== null
      || state.lastError !== null
    ) return
    set({ selectedName: name })
  },

  addCharacter: (request) => {
    const projectSession = currentCharacterProjectSession()
    if (!projectSession) return { ok: false, reason: 'not_ready' }
    if (
      characterIdentityMutationInFlight
      && sameProjectSessionContext(characterIdentityMutationInFlight.projectSession, projectSession)
    ) return { ok: false, reason: 'not_ready' }
    const projectKey = projectSession.projectPath
    const state = get()
    if (
      !sameProjectSessionContext(state.dataProjectSession, projectSession)
      || state.loadingProjectSession !== null
      || state.lastError !== null
    ) return { ok: false, reason: 'not_ready' }

    const name = request.name.trim()
    if (!name) return { ok: false, reason: 'empty_name' }
    const before = get().characters
    // 角色名单以不区分大小写、忽略首尾空白的名字为身份键，创建必须先服从同一条规则。
    const identityKey = characterRosterIdentityKey(name)
    if (before.some(character => characterRosterIdentityKey(character.name) === identityKey)) {
      return { ok: false, reason: 'duplicate_name' }
    }

    const role = normalizeCharacterRole(request.role ?? DEFAULT_CHARACTER_CREATION_ROLE)
    const newCard: CharacterCard = { ...EMPTY_CARD, name, role }
    set((s) => ({
      characters: [...s.characters, newCard],
      selectedName: newCard.name,
    }))
    persistCharacterDraftLedger(recordProjectEditorEdit(
      readCharacterDraftLedger(projectKey),
      projectKey,
      before,
      get().characters,
    ))
    return { ok: true, name, role }
  },

  deleteCharacter: (name, projectPath, expectedProjectSession) => {
    const projectSession = currentCharacterProjectSession(projectPath, expectedProjectSession)
    if (!projectSession) return Promise.resolve(false)
    if (
      characterIdentityMutationInFlight
      && sameProjectSessionContext(characterIdentityMutationInFlight.projectSession, projectSession)
    ) return Promise.resolve(false)
    const projectKey = projectSession.projectPath
    if (
      !sameProjectSessionContext(get().dataProjectSession, projectSession)
      || get().loadingProjectSession !== null
      || get().lastError !== null
    ) return Promise.resolve(false)
    const { characters } = get()
    if (!characters.some(card => card.name === name)) return Promise.resolve(false)
    const ledger = readCharacterDraftLedger(projectKey)
    const renames = getCharacterDraftRenames(ledger, projectKey)
    const remaining = removeFirstCharacterNamed(characters, name)
    const deletedId = get().characterIdentities[name]
    const remainingRels = deletedId
      ? get().relationships.filter(r => r.character1Id !== deletedId && r.character2Id !== deletedId)
      : get().relationships
    const nextPositions = { ...get().graphPositions }
    const nextIdentities = { ...get().characterIdentities }
    if (deletedId) {
      delete nextPositions[deletedId]
      delete nextIdentities[name]
    }
    const pendingRename = renames.find(rename => rename.newName === name)
    const nextRenames = pendingRename
      ? renames.filter(rename => rename !== pendingRename)
      : renames
    set({
      // 被删除人物的旧边随之过期：其余角色的旧字段同步清理。
      characters: syncCardsWithRelationships(remaining, remainingRels, nextIdentities, { removedNames: [name] }),
      characterIdentities: nextIdentities,
      relationships: remainingRels,
      graphPositions: nextPositions,
      selectedName: remaining.some(character => character.name === get().selectedName)
        ? get().selectedName
        : (remaining[0]?.name ?? null),
    })
    let nextLedger = recordProjectEditorEdit(ledger, projectKey, characters, remaining)
    nextLedger = setCharacterDraftRenames(nextLedger, projectKey, nextRenames)
    persistCharacterDraftLedger(nextLedger)

    // 删除同样是完整手工名单保存：由 roster seam 在一次事务中清理关系、
    // 蓝图引用、投影、revision 与 receipt。失败时草稿仍在本地可重试。
    return get().saveAll(projectKey, projectSession, 'delete')
      .then(() => isCharacterProjectSessionCurrent(projectSession))
      .catch(() => false)
  },

  clearAllCharacters: (projectPath, expectedProjectSession) => {
    const projectSession = currentCharacterProjectSession(projectPath, expectedProjectSession)
    if (!projectSession) return Promise.resolve(false)
    if (
      characterIdentityMutationInFlight
      && sameProjectSessionContext(characterIdentityMutationInFlight.projectSession, projectSession)
    ) return Promise.resolve(false)
    const projectKey = projectSession.projectPath
    const state = get()
    if (
      !sameProjectSessionContext(state.dataProjectSession, projectSession)
      || state.loadingProjectSession !== null
      || state.lastError !== null
    ) return Promise.resolve(false)
    const characters = state.characters
    if (characters.length === 0) return Promise.resolve(true)

    const ledger = readCharacterDraftLedger(projectKey)
    set({ characters: [], characterIdentities: {}, relationships: [], graphPositions: {}, selectedName: null })
    let nextLedger = recordProjectEditorEdit(ledger, projectKey, characters, [])
    nextLedger = setCharacterDraftRenames(nextLedger, projectKey, [])
    persistCharacterDraftLedger(nextLedger)

    // 空名单仍通过既有 roster 原子提交；主进程据此同步删除角色、关系和投影。
    return get().saveAll(projectKey, projectSession, 'delete')
      .then(() => isCharacterProjectSessionCurrent(projectSession))
      .catch(() => false)
  },

  renameCharacter: (name, newName) => {
    const projectSession = currentCharacterProjectSession()
    if (!projectSession) return false
    if (
      characterIdentityMutationInFlight
      && sameProjectSessionContext(characterIdentityMutationInFlight.projectSession, projectSession)
    ) return false
    const projectKey = projectSession.projectPath
    const state = get()
    if (
      !sameProjectSessionContext(state.dataProjectSession, projectSession)
      || state.loadingProjectSession !== null
      || state.lastError !== null
    ) return false
    const before = get().characters
    const targetIndex = before.findIndex(character => character.name === name)
    if (targetIndex < 0) return false
    if (before.some((character, index) => index !== targetIndex && character.name === newName)) {
      return false
    }

    const ledger = readCharacterDraftLedger(projectKey)
    const existing = getProjectEditorDraft(ledger, projectKey)
    const renames = getCharacterDraftRenames(ledger, projectKey)
    const persistedNames = new Set((existing?.baseValue ?? before).map(character => character.name))
    const nextRenames = updateCharacterRename(renames, name, newName, persistedNames)

    /*
     * 改名只改展示名：关系端点与画布坐标都是稳定 ID，这里不动。
     * 只把姓名→ID 的本地解析表换个键，落盘时主进程会同步身份表的名称镜像。
     */
    const nextIdentities = { ...get().characterIdentities }
    const renamedId = nextIdentities[name]
    if (renamedId) {
      delete nextIdentities[name]
      nextIdentities[newName] = renamedId
    }

    const characters = before.map((character, index) => (
      index === targetIndex ? { ...character, name: newName } : character
    ))
    set({
      characters: syncCardsWithRelationships(characters, get().relationships, nextIdentities),
      characterIdentities: nextIdentities,
      selectedName: get().selectedName === name ? newName : get().selectedName,
    })

    let nextLedger = recordProjectEditorEdit(ledger, projectKey, before, characters)
    nextLedger = setCharacterDraftRenames(nextLedger, projectKey, nextRenames)
    persistCharacterDraftLedger(nextLedger)
    return true
  },

  acceptCultivationSnapshot: (snapshot, session, validIds) => {
    if (!isCharacterProjectSessionCurrent(session)) return
    if (!sameProjectSessionContext(get().dataProjectSession, session)) {
      if (sameProjectSessionContext(get().loadingProjectSession, session)) void get().load(session.projectPath, session)
      return
    }
    if (get().rosterRevision !== null && snapshot.revision < get().rosterRevision!) return
    const remote = snapshot.entries.map(characterCardFromRosterEntry)
    const draftLedger = readCharacterDraftLedger(session.projectPath)
    const renames = getCharacterDraftRenames(draftLedger, session.projectPath)
    const before = get().characters
    const characters = reconcileCharacterCultivationDraft(before,
      getProjectEditorDraft(draftLedger, session.projectPath)?.baseValue ?? before, remote, validIds, renames)
    let nextLedger = settleProjectEditorSave(draftLedger, session.projectPath, remote, characters)
    nextLedger = setCharacterDraftRenames(nextLedger, session.projectPath, renames)
    persistCharacterDraftLedger(nextLedger)
    set({ characters, rosterRevision: snapshot.revision })
  },

  discardDraft: (projectPath, expectedProjectSession) => {
    const ledger = readCharacterDraftLedger(projectPath)
    const projectDraft = getProjectEditorDraft(ledger, projectPath)
    if (!projectDraft) return
    const projectSession = currentCharacterProjectSession(projectPath, expectedProjectSession)

    if (
      projectSession
      && (
        !sameProjectSessionContext(get().dataProjectSession, projectSession)
        || get().loadingProjectSession !== null
        || get().lastError !== null
      )
    ) {
      return
    }
    if (
      projectSession
      && sameProjectSessionContext(get().dataProjectSession, projectSession)
    ) {
      const restored = projectDraft.baseValue
      const selectedName = get().selectedName
      const renames = getCharacterDraftRenames(ledger, projectPath)
      const selectedRename = renames.find(rename => rename.newName === selectedName)
      const restoredSelection = selectedRename?.originalName ?? selectedName
      set({
        characters: restored,
        selectedName: restored.some(character => character.name === restoredSelection)
          ? restoredSelection
          : (restored[0]?.name ?? null),
      })
    }

    persistCharacterDraftLedger(discardProjectEditorDraft(ledger, projectPath))
  },

  updateField: (name, key, value) => {
    const projectSession = currentCharacterProjectSession()
    if (!projectSession) return
    const projectKey = projectSession.projectPath
    const state = get()
    if (
      !sameProjectSessionContext(state.dataProjectSession, projectSession)
      || state.lastError !== null
    ) return
    const before = get().characters
    set((s) => {
      const newChars = s.characters.map(c =>
        c.name === name ? { ...c, [key]: value } : c
      )

      return { characters: newChars }
    })
    persistCharacterDraftLedger(recordProjectEditorEdit(
      readCharacterDraftLedger(projectKey),
      projectKey,
      before,
      get().characters,
    ))
  },

  saveAll: (projectPath, expectedProjectSession, operationKind) => {
    const projectSession = currentCharacterProjectSession(projectPath, expectedProjectSession)
    const projectKey = projectSession?.projectPath
    if (
      !projectSession
      || !projectKey
      || !sameProjectSessionContext(get().dataProjectSession, projectSession)
      || get().loadingProjectSession !== null
      || get().lastError !== null
      || get().rosterRevision === null
    ) {
      return Promise.reject(new Error('角色数据仍在切换项目，已拒绝跨项目保存'))
    }
    if (
      characterSaveInFlight
      && sameProjectSessionContext(characterSaveInFlight.projectSession, projectSession)
    ) {
      if (characterSaveInFlight.kind === 'delete') {
        return Promise.reject(new Error('角色身份操作正在进行（删除中），请等待完成后再保存'))
      }
      return characterSaveInFlight.promise
    }
    if (
      characterIdentityMutationInFlight
      && sameProjectSessionContext(characterIdentityMutationInFlight.projectSession, projectSession)
    ) {
      return Promise.reject(new Error('角色身份操作正在进行，请稍后再保存'))
    }
    set({ saving: true, identityBusy: true })
    const { characters } = get()
    const expectedRevision = get().rosterRevision
    if (expectedRevision === null) {
      return Promise.reject(new Error('角色名单尚未完成安全读取，已拒绝保存'))
    }
    const saveLedger = readCharacterDraftLedger(projectKey)
    const renames = getCharacterDraftRenames(saveLedger, projectKey)
    const savedCharacters = characters.map(character => ({
      ...character,
      name: character.name.trim(),
    }))
    const savedRenames = renames.map(rename => ({
      originalName: rename.originalName,
      newName: rename.newName.trim(),
    }))
    const saveKind: SessionOperation<void>['kind'] = operationKind
      ?? (savedRenames.length > 0 ? 'rename' : 'save')

    const save = async () => {
      // 角色主键改名、删除、蓝图结构化引用、角色图谱、revision 和 receipt
      // 都由主进程 roster seam 在同一事务内完成。
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:character-roster-commit',
        {
          operationId: `manual-character-save-${randomUUID()}`,
          expectedRevision,
          schemaVersion: 1,
          intent: 'manual_edit',
          entries: characterRosterEntriesFromCards(savedCharacters),
          ...(savedRenames.length > 0 ? { renames: savedRenames } : {}),
        },
        projectKey,
      )
      if (!result.success || !result.receipt) {
        throw new Error(rosterCommitErrorText(result.error))
      }
      if (!isCharacterProjectSessionCurrent(projectSession)) return
      // A cultivation migration may already have committed a later roster while
      // this request's receipt was in transit. Never restore its old binding/revision.
      if (get().rosterRevision !== null && result.receipt.revision < get().rosterRevision!) return
      const savedRosterCards = result.receipt.snapshot.entries.map(characterCardFromRosterEntry)
      const ledger = readCharacterDraftLedger(projectKey)
      const currentProjectDraft = getProjectEditorDraft(ledger, projectKey)
      const projectSaveInputStillCurrent = (
        !currentProjectDraft || valuesMatch(currentProjectDraft.draftValue, characters)
      )
      const currentValue = projectSaveInputStillCurrent
        ? savedRosterCards
        : currentProjectDraft.draftValue
      const currentRenames = getCharacterDraftRenames(ledger, projectKey)
      const remainingRenames = rebuildCharacterRenamesAfterSave(
        savedRosterCards,
        currentValue,
        savedRenames,
        currentRenames,
      )
      let settledLedger = settleProjectEditorSave(
        ledger,
        projectKey,
        savedRosterCards,
        currentValue,
      )
      settledLedger = setCharacterDraftRenames(settledLedger, projectKey, remainingRenames)
      if (!isCharacterProjectSessionCurrent(projectSession)) return
      persistCharacterDraftLedger(settledLedger)

      if (
        projectSaveInputStillCurrent
        && valuesMatch(get().characters, characters)
      ) {
        const selectedIndex = savedRosterCards.findIndex(character => character.name === get().selectedName)
        set({
          characters: savedRosterCards,
          rosterRevision: result.receipt.revision,
          selectedName: selectedIndex >= 0
            ? savedRosterCards[selectedIndex].name
            : get().selectedName,
        })
      } else if (isCharacterProjectSessionCurrent(projectSession)) {
        set({ rosterRevision: result.receipt.revision })
      }
    }
    const trackedSave = save().finally(() => {
      if (characterSaveInFlight?.promise === trackedSave) {
        characterSaveInFlight = null
      }
      if (characterIdentityMutationInFlight?.promise === trackedSave) {
        characterIdentityMutationInFlight = null
      }
      if (isCharacterProjectSessionCurrent(projectSession)) {
        set({ saving: false, identityBusy: false })
      }
    })
    characterSaveInFlight = { projectSession, promise: trackedSave, kind: saveKind }
    characterIdentityMutationInFlight = { projectSession, promise: trackedSave, kind: saveKind }
    return trackedSave
  },

  loadRelationshipsAndPositions: async (projectPath?: string, expectedProjectSession?: ProjectSessionContext) => {
    const projectSession = currentCharacterProjectSession(projectPath, expectedProjectSession)
    if (!projectSession) return
    const requestedProjectKey = projectSession.projectPath
    try {
      // 先补齐稳定人物 ID（新角色、旧项目人物都覆盖），关系与坐标才有端点可挂。
      const identities = identityMapFromResponse(await ipc.invokeWithProjectSession(
        projectSession,
        'db:character-identities-ensure',
        get().characters.map(card => card.name),
        requestedProjectKey,
      ))
      const [relsResult, posResult] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'db:character-relationships-get-all', requestedProjectKey),
        ipc.invokeWithProjectSession(projectSession, 'db:character-graph-positions-get', requestedProjectKey),
      ])
      const relationships = Array.isArray(relsResult) ? relsResult : []
      const graphPositions = (posResult && typeof posResult === 'object') ? posResult : {}
      const characters = syncCardsWithRelationships(get().characters, relationships, identities)
      set({ characterIdentities: identities, relationships, graphPositions, characters })
    } catch (err) {
      console.error('Failed to load character relationships/positions:', err)
    }
  },

  upsertRelationship: async (data: {
    id?: string
    character1Id: string
    character2Id: string
    relation: string
    description?: string
  }) => {
    const projectSession = currentCharacterProjectSession()
    if (!projectSession) return null
    const requestedProjectKey = projectSession.projectPath
    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:character-relationship-upsert',
        data,
        requestedProjectKey,
      )
      if (res && res.success && res.relationship) {
        const saved: CharacterSharedRelationship = res.relationship
        // 一对人物只有一条关系：按 ID 对就地更新，绝不追加重复连线。
        const existingIndex = get().relationships.findIndex(
          rel => isMatchingRelationship(rel, saved.character1Id, saved.character2Id),
        )
        let nextRels: CharacterSharedRelationship[]
        if (existingIndex >= 0) {
          nextRels = [...get().relationships]
          nextRels[existingIndex] = saved
        } else {
          nextRels = [...get().relationships, saved]
        }
        const nextCards = syncCardsWithRelationships(get().characters, nextRels, get().characterIdentities)
        set({ relationships: nextRels, characters: nextCards })
        return saved
      }
      return null
    } catch (err) {
      console.error('Failed to upsert relationship:', err)
      return null
    }
  },

  deleteRelationship: async (id: string) => {
    const projectSession = currentCharacterProjectSession()
    if (!projectSession) return false
    const requestedProjectKey = projectSession.projectPath
    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:character-relationship-delete',
        id,
        requestedProjectKey,
      )
      if (res && res.success) {
        const nextRels = get().relationships.filter(r => r.id !== id)
        const nextCards = syncCardsWithRelationships(get().characters, nextRels, get().characterIdentities)
        set({ relationships: nextRels, characters: nextCards })
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to delete relationship:', err)
      return false
    }
  },

  saveGraphPositions: async (positions: Record<string, CharacterGraphPosition>) => {
    const projectSession = currentCharacterProjectSession()
    const mergedPositions = { ...get().graphPositions, ...positions }
    set({ graphPositions: mergedPositions })
    if (!projectSession) return
    const requestedProjectKey = projectSession.projectPath
    try {
      await ipc.invokeWithProjectSession(
        projectSession,
        'db:character-graph-positions-save',
        positions,
        requestedProjectKey,
      )
    } catch (err) {
      console.error('Failed to save graph positions:', err)
    }
  },
}))
