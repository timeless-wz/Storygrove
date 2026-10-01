import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { toast } from '../components/ui/Toast'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../components/project-session-gate'
import { useProjectStore } from './project-store'
import {
  createWorldMapId,
  type WorldMap,
  type WorldMapCandidate,
  type WorldMapEdge,
  type WorldMapMigrationReport,
  type WorldMapNode,
} from '../shared/world-map'

export type WorldMapDeleteStrategy = 'promote-children' | 'cascade'

interface WorldMapState {
  maps: WorldMap[]
  nodes: WorldMapNode[]
  edges: WorldMapEdge[]
  candidates: WorldMapCandidate[]
  migration: WorldMapMigrationReport | null
  /** 当前正在查看的地图；所有地点与连接都以它为准。 */
  selectedMapId: string | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  viewMode: 'canvas' | 'list'
  /**
   * 一次性「定位到某个地点」的请求。世界资料跳转到地图时写入，
   * 画布消费后把视图移动到该地点；token 保证同一地点可以被重复定位。
   */
  focusNodeRequest: { nodeId: string; mapId: string; token: number } | null
  loading: boolean
  candidatesLoading: boolean

  setSelectedMapId: (id: string | null) => void
  setSelectedNodeId: (id: string | null) => void
  setSelectedEdgeId: (id: string | null) => void
  setViewMode: (mode: 'canvas' | 'list') => void
  consumeFocusNodeRequest: (token: number) => void

  loadAll: (projectPath: string) => Promise<void>
  loadCandidates: (projectPath: string) => Promise<void>
  upsertMap: (map: WorldMap, projectPath: string) => Promise<boolean>
  deleteMap: (mapId: string, strategy: WorldMapDeleteStrategy, projectPath: string) => Promise<boolean>
  reorderMaps: (orderedIds: string[], projectPath: string) => Promise<boolean>
  acknowledgeMigration: (projectPath: string) => Promise<void>
  upsertNode: (node: WorldMapNode, projectPath: string) => Promise<boolean>
  deleteNode: (id: string, projectPath: string) => Promise<boolean>
  upsertEdge: (edge: WorldMapEdge, projectPath: string) => Promise<boolean>
  deleteEdge: (id: string, projectPath: string) => Promise<boolean>
  confirmCandidate: (candidate: WorldMapCandidate, mapId: string, projectPath: string) => Promise<boolean>
  dismissCandidate: (candidateId: string) => void
}

function nextSortOrder(maps: WorldMap[], parentMapId: string | null): number {
  const siblings = maps.filter(map => map.parentMapId === parentMapId)
  return siblings.reduce((max, map) => Math.max(max, map.sortOrder), 0) + 1
}

export const useWorldMapStore = create<WorldMapState>((set, get) => ({
  maps: [],
  nodes: [],
  edges: [],
  candidates: [],
  migration: null,
  selectedMapId: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  viewMode: 'canvas',
  focusNodeRequest: null,
  loading: false,
  candidatesLoading: false,

  setSelectedMapId: (id) => {
    if (get().selectedMapId === id) return
    // 切换地图时必须清空选择：旧选择属于另一张地图，绝不能被沿用。
    set({ selectedMapId: id, selectedNodeId: null, selectedEdgeId: null })
  },
  setSelectedNodeId: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  consumeFocusNodeRequest: (token) => {
    // 只清掉已经消费的那一次请求：期间到来的新请求不能被旧响应抹掉。
    if (get().focusNodeRequest?.token === token) set({ focusNodeRequest: null })
  },

  loadAll: async (projectPath: string) => {
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return

    set({ loading: true })
    try {
      const data = await ipc.invokeWithProjectSession(projectSession, 'db:map-get-all', projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      const maps = data?.maps ?? []
      const currentMapId = get().selectedMapId
      const selectedMapId = currentMapId && maps.some(map => map.id === currentMapId)
        ? currentMapId
        : maps[0]?.id ?? null
      const nodes = data?.nodes ?? []
      const edges = data?.edges ?? []
      set({
        maps,
        nodes,
        edges,
        migration: data?.migration ?? null,
        selectedMapId,
        selectedNodeId: nodes.some(node => node.id === get().selectedNodeId) ? get().selectedNodeId : null,
        selectedEdgeId: edges.some(edge => edge.id === get().selectedEdgeId) ? get().selectedEdgeId : null,
        loading: false,
      })
    } catch (e) {
      console.error('[WorldMapStore] loadAll error:', e)
      set({ loading: false })
    }
  },

  loadCandidates: async (projectPath: string) => {
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return

    set({ candidatesLoading: true })
    try {
      const cands = await ipc.invokeWithProjectSession(projectSession, 'db:map-candidates-get', projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      set({ candidates: cands ?? [], candidatesLoading: false })
    } catch (e) {
      console.error('[WorldMapStore] loadCandidates error:', e)
      set({ candidatesLoading: false })
    }
  },

  upsertMap: async (map: WorldMap, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-upsert', map, projectPath)
      if (!res?.success) {
        toast.error(res?.error || '保存地图失败')
        return false
      }
      await get().loadAll(projectPath)
      set({ selectedMapId: map.id })
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  deleteMap: async (mapId: string, strategy: WorldMapDeleteStrategy, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-delete', mapId, strategy, projectPath)
      if (!res?.success) {
        toast.error(res?.error || '删除地图失败')
        return false
      }
      if (get().selectedMapId === mapId) set({ selectedMapId: null, selectedNodeId: null, selectedEdgeId: null })
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  reorderMaps: async (orderedIds: string[], projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-reorder', orderedIds, projectPath)
      if (!res?.success) throw new Error(res?.error || '调整地图顺序失败')
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  acknowledgeMigration: async (projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return
    try {
      await ipc.invokeWithProjectSession(projectSession, 'db:map-migration-ack', projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      const migration = get().migration
      if (migration) set({ migration: { ...migration, acknowledged: true } })
    } catch (e) {
      console.error('[WorldMapStore] acknowledgeMigration error:', e)
    }
  },

  upsertNode: async (node: WorldMapNode, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-node-upsert', node, projectPath)
      if (!res?.success) {
        toast.error(res?.error || '保存地点失败')
        return false
      }
      await get().loadAll(projectPath)
      set({ selectedMapId: node.mapId, selectedNodeId: node.id })
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  deleteNode: async (id: string, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-node-delete', id, projectPath)
      if (!res?.success) {
        toast.error(res?.error || '删除地点失败')
        return false
      }
      if (get().selectedNodeId === id) set({ selectedNodeId: null })
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  upsertEdge: async (edge: WorldMapEdge, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-edge-upsert', edge, projectPath)
      if (!res?.success) {
        // 跨地图连接由仓库层拒绝，错误信息必须原样透出，不做降级改写。
        toast.error(res?.error || '保存连接失败')
        return false
      }
      await get().loadAll(projectPath)
      set({ selectedEdgeId: edge.id })
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  deleteEdge: async (id: string, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-edge-delete', id, projectPath)
      if (!res?.success) {
        toast.error(res?.error || '删除连接失败')
        return false
      }
      if (get().selectedEdgeId === id) set({ selectedEdgeId: null })
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  confirmCandidate: async (candidate: WorldMapCandidate, mapId: string, projectPath: string) => {
    const mapNodes = get().nodes.filter(node => node.mapId === mapId)
    const offset = mapNodes.length * 30
    const newNode: WorldMapNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: candidate.name,
      type: candidate.type,
      description: candidate.description,
      parentId: null,
      mapId,
      x: 200 + (offset % 300),
      y: 150 + (Math.floor(offset / 300) * 80),
      sourceRefs: [candidate.sourceRef],
    }

    const ok = await get().upsertNode(newNode, projectPath)
    if (ok) {
      get().dismissCandidate(candidate.id)
      toast.success(`已添加地点「${candidate.name}」`)
      return true
    }
    return false
  },

  dismissCandidate: (candidateId: string) => {
    set(state => ({
      candidates: state.candidates.filter(c => c.id !== candidateId)
    }))
  },
}))

/** 新建地图时统一生成 id，保证它落在受控目录的安全格式内。 */
export function createMapDraft(
  maps: WorldMap[],
  name: string,
  parentMapId: string | null,
): WorldMap {
  return {
    id: createWorldMapId(),
    name,
    parentMapId,
    sortOrder: nextSortOrder(maps, parentMapId),
    image: null,
  }
}
