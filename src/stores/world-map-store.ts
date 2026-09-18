import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { toast } from '../components/ui/Toast'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../components/project-session-gate'
import { useProjectStore } from './project-store'
import type {
  WorldMapNode,
  WorldMapEdge,
  WorldMapCandidate,
  WorldMapLayer,
} from '../shared/world-map'

interface WorldMapState {
  nodes: WorldMapNode[]
  edges: WorldMapEdge[]
  layers: WorldMapLayer[]
  candidates: WorldMapCandidate[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  activeLayer: string
  viewMode: 'canvas' | 'list'
  loading: boolean
  candidatesLoading: boolean

  setSelectedNodeId: (id: string | null) => void
  setSelectedEdgeId: (id: string | null) => void
  setActiveLayer: (layer: string) => void
  setViewMode: (mode: 'canvas' | 'list') => void

  loadAll: (projectPath: string) => Promise<void>
  loadCandidates: (projectPath: string) => Promise<void>
  upsertNode: (node: WorldMapNode, projectPath: string) => Promise<boolean>
  deleteNode: (id: string, projectPath: string) => Promise<boolean>
  upsertEdge: (edge: WorldMapEdge, projectPath: string) => Promise<boolean>
  deleteEdge: (id: string, projectPath: string) => Promise<boolean>
  upsertLayer: (layer: WorldMapLayer, projectPath: string) => Promise<boolean>
  deleteLayer: (id: string, fallbackLayerId: string, projectPath: string) => Promise<boolean>
  reorderLayers: (orderedIds: string[], projectPath: string) => Promise<boolean>
  confirmCandidate: (candidate: WorldMapCandidate, projectPath: string) => Promise<boolean>
  dismissCandidate: (candidateId: string) => void
}

export const useWorldMapStore = create<WorldMapState>((set, get) => ({
  nodes: [],
  edges: [],
  layers: [],
  candidates: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  activeLayer: 'all',
  viewMode: 'canvas',
  loading: false,
  candidatesLoading: false,

  setSelectedNodeId: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setViewMode: (mode) => set({ viewMode: mode }),

  loadAll: async (projectPath: string) => {
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return

    set({ loading: true })
    try {
      const data = await ipc.invokeWithProjectSession(
        projectSession,
        'db:map-get-all',
        projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      const layers = data?.layers ?? []
      const activeLayer = get().activeLayer
      set({
        nodes: data?.nodes ?? [],
        edges: data?.edges ?? [],
        layers,
        activeLayer: activeLayer === 'all' || layers.some(layer => layer.id === activeLayer) ? activeLayer : 'all',
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
      const cands = await ipc.invokeWithProjectSession(
        projectSession,
        'db:map-candidates-get',
        projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      set({ candidates: cands ?? [], candidatesLoading: false })
    } catch (e) {
      console.error('[WorldMapStore] loadCandidates error:', e)
      set({ candidatesLoading: false })
    }
  },

  upsertNode: async (node: WorldMapNode, projectPath: string) => {
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false

    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:map-node-upsert',
        node,
        projectPath,
      )
      if (!res?.success) {
        toast.error(res?.error || '保存地图节点失败')
        return false
      }
      await get().loadAll(projectPath)
      set({ selectedNodeId: node.id })
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  deleteNode: async (id: string, projectPath: string) => {
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false

    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:map-node-delete',
        id,
        projectPath,
      )
      if (!res?.success) {
        toast.error(res?.error || '删除节点失败')
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
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false

    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:map-edge-upsert',
        edge,
        projectPath,
      )
      if (!res?.success) {
        toast.error(res?.error || '保存连线失败')
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
    const currentProject = useProjectStore.getState().currentProject
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false

    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:map-edge-delete',
        id,
        projectPath,
      )
      if (!res?.success) {
        toast.error(res?.error || '删除连线失败')
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

  upsertLayer: async (layer: WorldMapLayer, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-layer-upsert', layer, projectPath)
      if (!res?.success) throw new Error(res?.error || '保存图层失败')
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  deleteLayer: async (id: string, fallbackLayerId: string, projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-layer-delete', id, fallbackLayerId, projectPath)
      if (!res?.success) throw new Error(res?.error || '删除图层失败')
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  reorderLayers: async (orderedIds: string[], projectPath: string) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || projectSession.projectPath !== projectPath) return false
    try {
      const res = await ipc.invokeWithProjectSession(projectSession, 'db:map-layers-reorder', orderedIds, projectPath)
      if (!res?.success) throw new Error(res?.error || '调整图层顺序失败')
      await get().loadAll(projectPath)
      return true
    } catch (e) {
      toast.error(String(e))
      return false
    }
  },

  confirmCandidate: async (candidate: WorldMapCandidate, projectPath: string) => {
    // Determine random offset near center so new node doesn't overlap perfectly
    const existing = get().nodes
    const offset = existing.length * 30
    const newNode: WorldMapNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: candidate.name,
      type: candidate.type,
      description: candidate.description,
      parentId: null,
      mapLayer: get().layers.find(layer => layer.id === candidate.suggestedLayer)?.id
        || get().layers[0]?.id
        || 'surface',
      x: 200 + (offset % 300),
      y: 150 + (Math.floor(offset / 300) * 80),
      sourceRefs: [candidate.sourceRef],
    }

    const ok = await get().upsertNode(newNode, projectPath)
    if (ok) {
      get().dismissCandidate(candidate.id)
      toast.success(`已添加地图节点「${candidate.name}」`)
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
