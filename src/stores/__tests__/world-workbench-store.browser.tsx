/**
 * 世界资料 store 的会话隔离与失败语义。
 *
 * 这些断言针对真实故障模式：
 * - A 项目的迟到响应绝不能写进 B 项目的 store；
 * - 同一路径关闭再打开会拿到新 lease，仅比较路径是不够的；
 * - 保存失败时当前世界与已加载数据必须保持原样（界面据此保留作者输入）。
 *
 * 放在浏览器配置下运行：失败提示通过共享 Toast 组件展示，它需要一个真实 DOM；
 * 这里同时验证「失败只提示、不改动本地状态」这一真实行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import {
  EMPTY_WORLD_SNAPSHOT,
  factionsOfWorld,
  mapsOfWorld,
  membersOfWorld,
  portalsOfWorld,
  relicsOfWorld,
  rulesOfWorld,
  useWorldWorkbenchStore,
} from '../world-workbench-store'
import { useProjectStore } from '../project-store'
import type {
  WorldCharacterLocation,
  WorldWorkbenchSnapshot,
} from '../../shared/world-workbench'

const PATH_A = 'C:\\novels\\world-project-a'
const PATH_B = 'C:\\novels\\world-project-b'

const PROJECT_A: ProjectData = {
  id: 'project-a', sessionLease: 'lease-a', name: 'A', path: PATH_A,
  novelConfig: { genre: '', subGenre: '', targetAudience: '', totalChapters: 0, wordsPerChapter: 0 } as ProjectData['novelConfig'],
  characterStates: '', createdAt: '', updatedAt: '',
}
const PROJECT_B: ProjectData = { ...PROJECT_A, id: 'project-b', sessionLease: 'lease-b', name: 'B', path: PATH_B }
/** 同一路径重新打开：路径相同、lease 不同。 */
const PROJECT_A_REOPENED: ProjectData = { ...PROJECT_A, sessionLease: 'lease-a2' }

function sessionOf(project: ProjectData) {
  return { projectId: project.id, leaseId: project.sessionLease as string, projectPath: project.path }
}

function snapshotWith(worldName: string): WorldWorkbenchSnapshot {
  return {
    ...EMPTY_WORLD_SNAPSHOT,
    worlds: [{
      id: `world-${worldName}`, name: worldName, summary: '', background: '', notes: '', sortOrder: 1,
    }],
  }
}

function location(characterId: string, kind: 'birth' | 'current', worldId: string | null): WorldCharacterLocation {
  return {
    id: `location-${characterId}-${kind}`,
    characterId,
    kind,
    worldId,
    nodeId: null,
    note: '',
    storyTimeLabel: '',
    timePrecision: 'unknown',
    chapterNumber: null,
    boundLocationText: '',
    boundProvenanceKind: '',
    boundAt: '',
  }
}

function selectorSnapshot(): WorldWorkbenchSnapshot {
  return {
    ...EMPTY_WORLD_SNAPSHOT,
    factions: [
      { id: 'faction-a', worldId: 'world-a', name: 'A 势力', type: '', summary: '', description: '', seat: '', domainNote: '', notes: '' },
      { id: 'faction-b', worldId: 'world-b', name: 'B 势力', type: '', summary: '', description: '', seat: '', domainNote: '', notes: '' },
    ],
    relics: [
      { id: 'relic-a', worldId: 'world-a', name: 'A 秘境', type: '', summary: '', description: '', locationNote: '', nodeId: null, entranceNodeId: null, entryCondition: '', danger: '', rewards: '', availabilityNote: '', status: 'sealed', customStatusLabel: '', notes: '' },
      { id: 'relic-b', worldId: 'world-b', name: 'B 秘境', type: '', summary: '', description: '', locationNote: '', nodeId: null, entranceNodeId: null, entryCondition: '', danger: '', rewards: '', availabilityNote: '', status: 'sealed', customStatusLabel: '', notes: '' },
    ],
    rules: [
      { id: 'rule-a', worldId: 'world-a', name: 'A 规则', category: 'nature', customCategoryLabel: '', content: '', scopeNote: '', restriction: '', consequence: '', notes: '', sourceKind: 'author', sourceRefId: '', sourceStatus: '' },
      { id: 'rule-b', worldId: 'world-b', name: 'B 规则', category: 'nature', customCategoryLabel: '', content: '', scopeNote: '', restriction: '', consequence: '', notes: '', sourceKind: 'author', sourceRefId: '', sourceStatus: '' },
    ],
    portals: [
      { id: 'portal-ab', name: 'A 至 B', type: 'rift', customTypeLabel: '', fromWorldId: 'world-a', toWorldId: 'world-b', fromNodeId: null, toNodeId: null, bidirectional: false, condition: '', cost: '', scheduleNote: '', status: 'active', customStatusLabel: '', description: '', notes: '' },
      { id: 'portal-bc', name: 'B 至 C', type: 'rift', customTypeLabel: '', fromWorldId: 'world-b', toWorldId: 'world-c', fromNodeId: null, toNodeId: null, bidirectional: true, condition: '', cost: '', scheduleNote: '', status: 'active', customStatusLabel: '', description: '', notes: '' },
    ],
    mapWorldLinks: [
      { mapId: 'map-a-1', worldId: 'world-a' },
      { mapId: 'map-a-2', worldId: 'world-a' },
      { mapId: 'map-b-1', worldId: 'world-b' },
    ],
    characterLinks: [
      { id: 'character-link-a', worldId: 'world-a', characterId: 'character-shared', relation: '出生于此', note: '' },
      { id: 'character-link-b', worldId: 'world-b', characterId: 'character-shared', relation: '旅居', note: '' },
    ],
    characterLocationViews: [
      {
        characterId: 'character-shared', characterName: '同一人物',
        birth: location('character-shared', 'birth', 'world-a'),
        current: location('character-shared', 'current', 'world-a'),
        currentState: 'bound', locationText: '', locationProvenanceKind: '',
      },
      {
        characterId: 'character-birth-only', characterName: '仅有出生地',
        birth: location('character-birth-only', 'birth', 'world-a'),
        current: null,
        currentState: 'unset', locationText: '', locationProvenanceKind: '',
      },
      {
        characterId: 'character-stale', characterName: '失效位置',
        birth: null,
        current: location('character-stale', 'current', 'world-a'),
        currentState: 'stale', locationText: '已离开', locationProvenanceKind: 'author',
      },
    ],
  }
}

const invoke = vi.fn()

/** 切换活动项目：project-store 与 IPC 会话登记处必须同时更新。 */
function activate(project: ProjectData): void {
  useProjectStore.setState({ currentProject: project })
  setActiveProjectSessionContext(sessionOf(project))
}

beforeEach(() => {
  invoke.mockReset()
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: () => () => {},
      once: () => {},
      send: () => {},
      setZoomLevel: () => {},
      setZoomFactor: () => {},
      getZoomLevel: () => 0,
    },
  })
  useWorldWorkbenchStore.getState().reset()
  activate(PROJECT_A)
})

afterEach(() => {
  setActiveProjectSessionContext(null)
  useProjectStore.setState({ currentProject: null })
  useWorldWorkbenchStore.getState().reset()
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('世界工作台按稳定世界与人物 ID 读取', () => {
  it('filters single-world records and maps while showing a shared portal from either endpoint', () => {
    const data = selectorSnapshot()

    expect(factionsOfWorld(data, 'world-a').map(item => item.id)).toEqual(['faction-a'])
    expect(relicsOfWorld(data, 'world-b').map(item => item.id)).toEqual(['relic-b'])
    expect(rulesOfWorld(data, 'world-a').map(item => item.id)).toEqual(['rule-a'])
    expect(mapsOfWorld(data, 'world-a')).toEqual(['map-a-1', 'map-a-2'])

    expect(portalsOfWorld(data, 'world-a').map(item => item.id)).toEqual(['portal-ab'])
    const worldBPortals = portalsOfWorld(data, 'world-b')
    expect(worldBPortals.map(item => item.id).sort()).toEqual(['portal-ab', 'portal-bc'])
    expect(worldBPortals.find(item => item.id === 'portal-ab')).toMatchObject({ fromWorldId: 'world-a', toWorldId: 'world-b' })
    expect(worldBPortals.find(item => item.id === 'portal-bc')).toMatchObject({ fromWorldId: 'world-b', toWorldId: 'world-c' })
    expect(portalsOfWorld(data, 'world-c').map(item => item.id)).toEqual(['portal-bc'])
  })

  it('counts one person once across world identity, birth, and current-location associations', () => {
    const members = membersOfWorld(selectorSnapshot(), 'world-a')

    expect(members.map(member => member.characterId).sort()).toEqual(['character-birth-only', 'character-shared'])
    expect(members.find(member => member.characterId === 'character-shared')).toMatchObject({
      viaBirth: true,
      viaCurrent: true,
    })
    // 失效的当前位置不能把角色继续算作该世界的成员。
    expect(members.some(member => member.characterId === 'character-stale')).toBe(false)
  })
})

describe('世界资料 store 的会话隔离', () => {
  it('drops a late response from project A after the session switched to project B', async () => {
    let resolveA: ((value: WorldWorkbenchSnapshot) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise<WorldWorkbenchSnapshot>(resolve => { resolveA = resolve }))

    const loading = useWorldWorkbenchStore.getState().loadAll(PATH_A)
    // 请求已经发出，此时作者立刻切换到 B 项目。
    activate(PROJECT_B)
    resolveA?.(snapshotWith('A界'))
    await loading

    const state = useWorldWorkbenchStore.getState()
    expect(state.data.worlds).toEqual([])
    expect(state.selectedWorldId).toBeNull()
    expect(state.loadedProjectKey).toBeNull()
  })

  it('drops a late response when the same path is reopened with a new lease', async () => {
    let resolveA: ((value: WorldWorkbenchSnapshot) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise<WorldWorkbenchSnapshot>(resolve => { resolveA = resolve }))

    const loading = useWorldWorkbenchStore.getState().loadAll(PATH_A)
    // 同一路径关闭后重新打开：路径没变，但 lease 已经不同。
    activate(PROJECT_A_REOPENED)
    resolveA?.(snapshotWith('旧会话'))
    await loading

    const state = useWorldWorkbenchStore.getState()
    expect(state.data.worlds).toEqual([])
    expect(state.loadedProjectKey).toBeNull()
  })

  it('commits data that still belongs to the active session', async () => {
    invoke.mockResolvedValue(snapshotWith('凡人界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)

    const state = useWorldWorkbenchStore.getState()
    expect(state.data.worlds.map(world => world.name)).toEqual(['凡人界'])
    expect(state.selectedWorldId).toBe('world-凡人界')
    expect(state.loadedProjectKey).toBe(PATH_A)
    expect(invoke).toHaveBeenCalledWith(
      'db:world-get-all',
      PATH_A,
      expect.objectContaining({ projectId: 'project-a', leaseId: 'lease-a' }),
    )
  })

  it('refuses to write when the frozen session no longer matches the active one', async () => {
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)
    useWorldWorkbenchStore.getState().setSelectedWorldId('world-凡人界')
    activate(PROJECT_B)

    const saved = await useWorldWorkbenchStore.getState().saveWorld({ name: '修真界' }, PATH_A)
    expect(saved).toBeNull()
    // 一次写入都没有发出去。
    expect(invoke.mock.calls.every(call => call[0] === 'db:world-get-all')).toBe(true)
  })

  it('drops a late successful save instead of selecting its world in the new project', async () => {
    invoke.mockResolvedValueOnce(snapshotWith('A界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)

    let resolveSave: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    const saving = useWorldWorkbenchStore.getState().saveWorld({ name: '迟到的 A 世界' }, PATH_A)

    activate(PROJECT_B)
    useWorldWorkbenchStore.getState().reset()
    invoke.mockResolvedValueOnce(snapshotWith('B界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_B)

    resolveSave?.({
      success: true,
      world: { id: 'world-late-a', name: '迟到的 A 世界', summary: '', background: '', notes: '', sortOrder: 2 },
    })
    expect(await saving).toBeNull()
    expect(useWorldWorkbenchStore.getState()).toMatchObject({
      selectedWorldId: 'world-B界',
      loadedProjectKey: PATH_B,
      lastError: null,
    })
    expect(useWorldWorkbenchStore.getState().data.worlds.map(world => world.name)).toEqual(['B界'])
  })

  it('drops a late failed save without writing the old error into the new project', async () => {
    invoke.mockResolvedValueOnce(snapshotWith('A界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)

    let resolveSave: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
    const saving = useWorldWorkbenchStore.getState().saveWorld({ name: '失败的 A 世界' }, PATH_A)

    activate(PROJECT_B)
    useWorldWorkbenchStore.getState().reset()
    invoke.mockResolvedValueOnce(snapshotWith('B界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_B)

    resolveSave?.({ success: false, error: 'A 项目只读' })
    expect(await saving).toBeNull()
    expect(useWorldWorkbenchStore.getState().lastError).toBeNull()
    expect(useWorldWorkbenchStore.getState().data.worlds.map(world => world.name)).toEqual(['B界'])
  })

  it('does not report a late current-location commit as successful in the new project', async () => {
    invoke.mockResolvedValueOnce(snapshotWith('A界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)

    let resolveCommit: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolveCommit = resolve }))
    const committing = useWorldWorkbenchStore.getState().commitCurrentLocation(
      'character-a', 'world-A界', null, {}, PATH_A,
    )

    activate(PROJECT_B)
    useWorldWorkbenchStore.getState().reset()
    invoke.mockResolvedValueOnce(snapshotWith('B界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_B)

    resolveCommit?.({ success: true, locationText: 'A界 · 故乡' })
    expect(await committing).toEqual({ ok: false })
    expect(useWorldWorkbenchStore.getState().data.worlds.map(world => world.name)).toEqual(['B界'])
    expect(useWorldWorkbenchStore.getState().lastError).toBeNull()
  })

  it('drops a late world-delete preview after the project session changes', async () => {
    let resolvePlan: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve }))
    const pending = useWorldWorkbenchStore.getState().planWorldDelete('world-a', PATH_A)

    activate(PROJECT_B)
    resolvePlan?.({ plan: { entityKind: 'world', entityId: 'world-a', entityName: 'A', blockers: [], cascadedRelationCount: 0, removedRowCount: 1 } })

    expect(await pending).toBeNull()
  })

  it('drops a late map-assignment preview after the same path is reopened with a new lease', async () => {
    let resolvePlan: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve }))
    const pending = useWorldWorkbenchStore.getState().planMapAssignment('map-a', 'world-b', PATH_A)

    activate(PROJECT_A_REOPENED)
    resolvePlan?.({ plan: { mapId: 'map-a', nextWorldId: 'world-b', descendantMapIds: [], blockers: [] } })

    expect(await pending).toBeNull()
  })

  it('drops a late generic delete preview after the project session changes', async () => {
    let resolvePlan: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve }))
    const pending = useWorldWorkbenchStore.getState().planDeleteFor('faction', 'faction-a')

    activate(PROJECT_B)
    resolvePlan?.({ plan: { entityKind: 'faction', entityId: 'faction-a', entityName: 'A 势力', blockers: [], cascadedRelationCount: 0, removedRowCount: 1 } })

    expect(await pending).toBeNull()
  })

  it('drops a late trail-delete preview after the project session changes', async () => {
    let resolvePlan: ((value: unknown) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolvePlan = resolve }))
    const pending = useWorldWorkbenchStore.getState().planTrailDelete('trail-a', PATH_A)

    activate(PROJECT_B)
    resolvePlan?.({ plan: { entityKind: 'trail', entityId: 'trail-a', entityName: 'A 行踪', blockers: [], cascadedRelationCount: 0, removedRowCount: 1 } })

    expect(await pending).toBeNull()
  })
})

describe('世界资料 store 的失败语义', () => {
  it('keeps the previously loaded data and the selection when a save fails', async () => {
    invoke.mockResolvedValueOnce({
      ...snapshotWith('凡人界'),
      worlds: [
        { id: 'world-1', name: '凡人界', summary: '', background: '', notes: '', sortOrder: 1 },
        { id: 'world-2', name: '修真界', summary: '', background: '', notes: '', sortOrder: 2 },
      ],
    })
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)
    useWorldWorkbenchStore.getState().setSelectedWorldId('world-2')

    invoke.mockResolvedValueOnce({ success: false, error: '数据库只读，已拒绝写入' })
    const saved = await useWorldWorkbenchStore.getState().saveWorld({ name: '新世界' }, PATH_A)

    expect(saved).toBeNull()
    const state = useWorldWorkbenchStore.getState()
    // 作者原本选中的世界没有被改动，已加载的数据也没有被清空。
    expect(state.selectedWorldId).toBe('world-2')
    expect(state.data.worlds.map(world => world.name)).toEqual(['凡人界', '修真界'])
    expect(state.lastError).toBe('数据库只读，已拒绝写入')
    // 失败后不得再发一次读取去覆盖本地状态。
    expect(invoke.mock.calls.filter(call => call[0] === 'db:world-get-all')).toHaveLength(1)
  })

  it('reloads from the database after a successful save and selects the saved world', async () => {
    invoke.mockResolvedValueOnce(snapshotWith('凡人界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)

    invoke.mockResolvedValueOnce({
      success: true,
      world: { id: 'world-new', name: '修真界', summary: '', background: '', notes: '', sortOrder: 2 },
    })
    invoke.mockResolvedValueOnce({
      ...snapshotWith('凡人界'),
      worlds: [
        { id: 'world-凡人界', name: '凡人界', summary: '', background: '', notes: '', sortOrder: 1 },
        { id: 'world-new', name: '修真界', summary: '', background: '', notes: '', sortOrder: 2 },
      ],
    })

    const saved = await useWorldWorkbenchStore.getState().saveWorld({ name: '修真界' }, PATH_A)
    expect(saved?.id).toBe('world-new')

    const state = useWorldWorkbenchStore.getState()
    // 列表来自保存后的真实读取，而不是乐观拼接。
    expect(state.data.worlds.map(world => world.name)).toEqual(['凡人界', '修真界'])
    expect(state.selectedWorldId).toBe('world-new')
    expect(state.lastError).toBeNull()
  })

  it('surfaces a transport error as a real failure instead of a success toast', async () => {
    invoke.mockResolvedValueOnce(snapshotWith('凡人界'))
    await useWorldWorkbenchStore.getState().loadAll(PATH_A)

    invoke.mockRejectedValueOnce(new Error('项目数据库未打开'))
    const saved = await useWorldWorkbenchStore.getState().saveWorld({ name: '修真界' }, PATH_A)

    expect(saved).toBeNull()
    const state = useWorldWorkbenchStore.getState()
    expect(state.lastError).toBe('项目数据库未打开')
    expect(state.data.worlds.map(world => world.name)).toEqual(['凡人界'])
  })
})
