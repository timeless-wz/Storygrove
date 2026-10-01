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
import { EMPTY_WORLD_SNAPSHOT, useWorldWorkbenchStore } from '../world-workbench-store'
import { useProjectStore } from '../project-store'
import type { WorldWorkbenchSnapshot } from '../../shared/world-workbench'

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
