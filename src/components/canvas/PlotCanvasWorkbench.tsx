/**
 * PlotCanvasWorkbench — 作者可编辑的剧情画布（跨章节剧情组织）。
 *
 * 交互语义移植自参考项目的 PlotBuilderCanvas / PlotOutlineTree（编译产物
 * WorldStudio-D4YQGBkX.js）：画布树 + 子画布钻入与面包屑返回、节点/连线
 * 删除确认、搜索高亮与适应视图、“动作后即存”的持久化节奏。远程 API
 * （/plot/board/*、/world/canvas/*）全部改接本地 IPC；剧情事件不再有远端
 * 事件实体，画布节点就是唯一记录。
 *
 * 与确定性剧情树（PlotTreeSnapshot）的关系：投影只读。对照层开关把快照
 * 事件画成幽灵节点供对照，任何画布操作都不会写回投影。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useEdgesState,
  useNodesState,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ChevronRight,
  Eye,
  EyeOff,
  Film,
  FolderPlus,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import type { DatabaseChannels } from '../../shared/ipc-channels'
import {
  createPlotCanvasEdgeId,
  createPlotCanvasNodeId,
  type PlotCanvasColorKey,
  type PlotCanvasEdgeData,
  type PlotCanvasGraph,
  type PlotCanvasNodeData,
  type PlotCanvasSummary,
} from '../../shared/plot-canvas'
import type { PlotTreeSnapshot } from '../../shared/plot-tree'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { openBuiltinEditor, openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { Textarea } from '../ui/Textarea'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { useCanvasPersistence } from './canvas-persistence'
import {
  CanvasLabeledEdge,
  CanvasLabeledEdgeViewMemo,
  PlotEventCardNode,
  PlotEventCardNodeData,
  PlotEventCardNodeViewMemo,
  PlotProjectionGhostNode,
  PlotProjectionGhostNodeData,
  PlotProjectionGhostNodeViewMemo,
} from './CanvasVisuals'
import './canvas-workbench.css'

type BlueprintRow = DatabaseChannels['db:blueprint-get-all']['return'][number]
type DraftRow = DatabaseChannels['db:draft-list-all']['return'][number]
type ThreadRow = DatabaseChannels['db:narrative-thread-list']['return'][number]

const NODE_COLOR_KEYS: PlotCanvasColorKey[] = ['default', 'accent', 'success', 'warning', 'danger']

const COLOR_LABELS: Record<PlotCanvasColorKey, [string, string]> = {
  default: ['默认', 'Default'],
  accent: ['强调', 'Accent'],
  success: ['进展', 'Progress'],
  warning: ['悬疑', 'Suspense'],
  danger: ['危机', 'Crisis'],
}

const NODE_WIDTH = 240
const NODE_HEIGHT_ESTIMATE = 150

interface PlotCanvasWorkbenchProps {
  projectKey: string
  /** 从画布节点跳到线索计划（切换到计划清单视图并定位）。 */
  onOpenPlan?: (planId: number) => void
}

type FlowNode = PlotEventCardNode | PlotProjectionGhostNode
type FlowEdge = CanvasLabeledEdge

type DetailState =
  | { kind: 'node'; id: string; title: string; summary: string; colorKey: PlotCanvasColorKey }
  | { kind: 'edge'; id: string; label: string; edgeKind: 'main' | 'aux' }

export default function PlotCanvasWorkbench({ projectKey, onOpenPlan }: PlotCanvasWorkbenchProps) {
  const text = useLocaleStore(s => s.text)
  const persist = useCanvasPersistence()

  // ===== 服务端数据 =====
  const [canvases, setCanvases] = useState<PlotCanvasSummary[]>([])
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null)
  const [graph, setGraph] = useState<PlotCanvasGraph | null>(null)
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([])
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [threads, setThreads] = useState<ThreadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [projection, setProjection] = useState<PlotTreeSnapshot | null>(null)
  const [projectionStale, setProjectionStale] = useState(false)
  const [showProjection, setShowProjection] = useState(false)
  const [projectionTried, setProjectionTried] = useState(false)

  // ===== 画布交互状态 =====
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)

  // ===== 对话框 =====
  const [canvasDialog, setCanvasDialog] = useState<
    | { mode: 'create'; parentCanvasId: string | null }
    | { mode: 'rename'; canvas: PlotCanvasSummary }
    | null
  >(null)
  const [canvasDialogName, setCanvasDialogName] = useState('')
  const [canvasDialogBusy, setCanvasDialogBusy] = useState(false)
  const [deleteCanvasTarget, setDeleteCanvasTarget] = useState<PlotCanvasSummary | null>(null)
  const [mergeDialog, setMergeDialog] = useState<{ title: string; summary: string } | null>(null)
  const [subCanvasDialog, setSubCanvasDialog] = useState<{ nodeId: string; defaultName: string } | null>(null)
  const [subCanvasName, setSubCanvasName] = useState('')
  const [detail, setDetail] = useState<DetailState | null>(null)

  const graphRef = useRef<PlotCanvasGraph | null>(null)
  const activeCanvasIdRef = useRef<string | null>(null)
  // ref 只能在 effect 中同步（react-hooks/refs）；交互回调读到的都是已提交值。
  useEffect(() => { graphRef.current = graph }, [graph])
  useEffect(() => { activeCanvasIdRef.current = activeCanvasId }, [activeCanvasId])

  // ===== 数据加载 =====

  const loadCanvases = useCallback(async (preferredId?: string) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const list = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-list', projectKey)
    if (!isProjectSessionCurrent(session)) return
    setCanvases(list)
    setActiveCanvasId(previous => {
      if (preferredId && list.some(canvas => canvas.id === preferredId)) return preferredId
      if (previous && list.some(canvas => canvas.id === previous)) return previous
      return list[0]?.id ?? null
    })
  }, [projectKey])

  const loadReferences = useCallback(async () => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const [nextBlueprints, nextDrafts, nextThreads] = await Promise.all([
      ipc.invokeWithProjectSession(session, 'db:blueprint-get-all', projectKey),
      ipc.invokeWithProjectSession(session, 'db:draft-list-all', projectKey),
      ipc.invokeWithProjectSession(session, 'db:narrative-thread-list', projectKey),
    ])
    if (!isProjectSessionCurrent(session)) return
    setBlueprints(nextBlueprints)
    setDrafts(nextDrafts)
    setThreads(nextThreads)
  }, [projectKey])

  const loadGraph = useCallback(async (canvasId: string) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const next = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-graph-get', canvasId, projectKey)
    if (!isProjectSessionCurrent(session)) return
    setGraph(next)
    setSelectedNodeIds([])
    setDetail(null)
  }, [projectKey])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      void (async () => {
        setLoading(true)
        setLoadError('')
        try {
          await Promise.all([loadCanvases(), loadReferences()])
          if (!cancelled) setLoading(false)
        } catch (error) {
          if (!cancelled) {
            setLoading(false)
            setLoadError(error instanceof Error ? error.message : String(error))
          }
        }
      })()
    })
    return () => { cancelled = true }
  }, [loadCanvases, loadReferences])

  useEffect(() => {
    queueMicrotask(() => {
      if (!activeCanvasId) {
        setGraph(null)
        return
      }
      void (async () => {
        try {
          await loadGraph(activeCanvasId)
        } catch (error) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      })()
    })
  }, [activeCanvasId, loadGraph])

  // 对照层按需加载一次确定性投影。
  useEffect(() => {
    if (!showProjection || projectionTried) return
    queueMicrotask(() => {
      setProjectionTried(true)
      void (async () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return
        try {
          const sources = await ipc.invokeWithProjectSession(session, 'db:plot-tree-read', projectKey)
          if (!isProjectSessionCurrent(session)) return
          setProjection(sources.snapshot)
          setProjectionStale(Boolean(sources.snapshot && sources.snapshot.sourceRevision !== sources.sourceRevision))
        } catch {
          if (isProjectSessionCurrent(session)) setProjection(null)
        }
      })()
    })
  }, [showProjection, projectionTried, projectKey])

  // ===== 画布操作回调（经 ref 供给节点数据，避免闭包过期） =====

  const actionsRef = useRef<{
    splitNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => void
    enterSubCanvas: (nodeId: string) => void
  }>({ splitNode: () => {}, deleteNode: () => {}, enterSubCanvas: () => {} })

  const persistNode = useCallback((node: PlotCanvasNodeData, canvasId: string) => {
    persist.schedule({
      key: `node-upsert:${node.id}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-node-upsert', {
            id: node.id,
            canvasId,
            title: node.title,
            summary: node.summary,
            colorKey: node.colorKey,
            chapterRefs: node.chapterRefs,
            planId: node.planId,
            subCanvasId: node.subCanvasId,
            x: Math.round(node.x),
            y: Math.round(node.y),
          }, projectKey)
          return result.success
        })()
      },
    })
  }, [persist, projectKey])

  const persistEdge = useCallback((edge: PlotCanvasEdgeData, canvasId: string) => {
    persist.schedule({
      key: `edge-upsert:${edge.id}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-edge-upsert', {
            id: edge.id,
            canvasId,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            label: edge.label,
            kind: edge.kind,
          }, projectKey)
          return result.success
        })()
      },
    })
  }, [persist, projectKey])

  const deleteNode = useCallback(async (nodeId: string) => {
    const canvasId = activeCanvasIdRef.current
    const current = graphRef.current
    if (!canvasId || !current) return
    if (!current.nodes.some(item => item.id === nodeId)) return
    const ok = await confirm(text(
      '确认删除该节点？与之相连的连线会一并删除；蓝图、定稿与线索计划不受影响。',
      'Delete this node? Its connections are removed too; blueprints, finalized drafts, and thread plans are untouched.',
    ), {
      title: text('删除剧情节点', 'Delete plot node'),
      confirmText: text('删除', 'Delete'),
      danger: true,
    })
    if (!ok) return
    setGraph(previous => previous ? {
      ...previous,
      nodes: previous.nodes.filter(item => item.id !== nodeId),
      edges: previous.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    } : previous)
    setDetail(previous => previous?.kind === 'node' && previous.id === nodeId ? null : previous)
    setSelectedNodeIds(previous => previous.filter(id => id !== nodeId))
    persist.schedule({
      key: `node-delete:${nodeId}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(
            session, 'db:plot-canvas-node-delete', canvasId, nodeId, projectKey,
          )
          return result.success
        })()
      },
    })
  }, [persist, projectKey, text])

  const splitNode = useCallback((nodeId: string) => {
    const canvasId = activeCanvasIdRef.current
    const current = graphRef.current
    if (!canvasId || !current) return
    const node = current.nodes.find(item => item.id === nodeId)
    if (!node) return
    // 参考项目拆分语义的本地化：原节点保留第一段，后续段作为新节点接在
    // 右下方；压缩产物中拆分文本由 AI 侧给出，本地改为作者在详情面板
    // 自行搬运两段文本。
    const newNode: PlotCanvasNodeData = {
      id: createPlotCanvasNodeId(),
      canvasId,
      title: `${node.title} · ${text('续', 'cont.')}`,
      summary: '',
      colorKey: node.colorKey,
      chapterRefs: [],
      planId: null,
      subCanvasId: null,
      x: node.x + NODE_WIDTH + 48,
      y: node.y + NODE_HEIGHT_ESTIMATE + 40,
    }
    setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, newNode] } : previous)
    persistNode(newNode, canvasId)
    setSelectedNodeIds([newNode.id])
    setDetail({ kind: 'node', id: newNode.id, title: newNode.title, summary: '', colorKey: newNode.colorKey })
  }, [persistNode, text])

  // ref 只能在 effect 中赋值；节点数据回调经 ref 转发，避免闭包过期。
  useEffect(() => {
    actionsRef.current = {
      splitNode,
      deleteNode: nodeId => { void deleteNode(nodeId) },
      enterSubCanvas: nodeId => {
        const target = graphRef.current?.nodes.find(item => item.id === nodeId)?.subCanvasId
        if (target) setActiveCanvasId(target)
      },
    }
  }, [splitNode, deleteNode])

  // ===== 投影 → Flow 模型 =====

  const subCanvasTitles = useMemo(() => new Map(canvases.map(canvas => [canvas.id, canvas.name])), [canvases])

  useEffect(() => {
    if (!graph) {
      setNodes([])
      setEdges([])
      return
    }
    const query = search.trim().toLowerCase()
    // 注意：这里绝不把 selected 写回节点/连线对象——选中态由 React Flow
    // 内部通过 onNodesChange/onSelectionChange 管理；一旦从派生数据回写
    // selected，就会与 RF 的选择上报互相触发，形成无限循环。
    setNodes(graph.nodes.map(node => {
      const haystack = `${node.title}\n${node.summary}`.toLowerCase()
      const searchHit = query.length > 0 && haystack.includes(query)
      const data: PlotEventCardNodeData = {
        title: node.title,
        summary: node.summary,
        colorKey: node.colorKey,
        chapterRefs: node.chapterRefs,
        hasPlan: node.planId !== null,
        subCanvasTitle: node.subCanvasId ? subCanvasTitles.get(node.subCanvasId) ?? null : null,
        dimmed: query.length > 0 && !searchHit,
        searchHit,
        onSplit: id => actionsRef.current.splitNode(id),
        onDelete: id => actionsRef.current.deleteNode(id),
        onEnterSubCanvas: id => actionsRef.current.enterSubCanvas(id),
      }
      return {
        id: node.id,
        type: 'plot-event-card' as const,
        position: { x: node.x, y: node.y },
        data,
      }
    }))
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
    setEdges(graph.edges.map(edge => {
      const source = nodeById.get(edge.sourceNodeId)
      const target = nodeById.get(edge.targetNodeId)
      const endpointHit = (node: PlotCanvasNodeData | undefined) => node
        && query.length > 0
        && `${node.title}\n${node.summary}`.toLowerCase().includes(query)
      const match = Boolean(endpointHit(source) || endpointHit(target))
      return {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        type: 'canvas-labeled' as const,
        data: { label: edge.label, kind: edge.kind, dimmed: query.length > 0 && !match },
      }
    }))
  }, [graph, search, subCanvasTitles, setNodes, setEdges])

  // 已保存的视口只在进入画布时应用一次；没有保存过则适应视图。
  // fitView 必须等 React Flow 完成节点测量后再执行，否则边界按 0 尺寸计算，
  // 会把边缘节点裁掉。
  const appliedViewportRef = useRef<string | null>(null)
  useEffect(() => {
    if (!graph) return
    if (appliedViewportRef.current === graph.canvas.id) return
    appliedViewportRef.current = graph.canvas.id
    if (graph.viewport) {
      flowRef.current?.setViewport(graph.viewport, { duration: 0 })
      return
    }
    const timer = window.setTimeout(() => {
      flowRef.current?.fitView({ padding: 0.2, maxZoom: 1.2, duration: 0 })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [graph])

  // ===== 持久化：连线 / 拖动 / 视口 =====

  const onConnect = useCallback((connection: Connection) => {
    const canvasId = activeCanvasIdRef.current
    if (!canvasId || !connection.source || !connection.target || connection.source === connection.target) return
    const edge: PlotCanvasEdgeData = {
      id: createPlotCanvasEdgeId(),
      canvasId,
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
      label: '',
      kind: 'main',
    }
    setGraph(previous => previous ? { ...previous, edges: [...previous.edges, edge] } : previous)
    persistEdge(edge, canvasId)
  }, [persistEdge])

  const onNodeDragStop = useCallback(() => {
    const canvasId = activeCanvasIdRef.current
    const current = graphRef.current
    if (!canvasId || !current) return
    persist.schedule({
      key: `reposition:${canvasId}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const positions = current.nodes.map(node => {
            const rendered = flowRef.current?.getNode(node.id)
            return {
              nodeId: node.id,
              x: Math.round(rendered?.position.x ?? node.x),
              y: Math.round(rendered?.position.y ?? node.y),
            }
          })
          const result = await ipc.invokeWithProjectSession(
            session, 'db:plot-canvas-nodes-reposition', canvasId, positions, projectKey,
          )
          if (result.success) {
            setGraph(previous => previous ? {
              ...previous,
              nodes: previous.nodes.map(node => {
                const moved = positions.find(item => item.nodeId === node.id)
                return moved ? { ...node, x: moved.x, y: moved.y } : node
              }),
            } : previous)
          }
          return result.success
        })()
      },
    })
  }, [persist, projectKey])

  const onMoveEnd = useCallback(() => {
    const canvasId = activeCanvasIdRef.current
    if (!canvasId) return
    const viewport = flowRef.current?.getViewport()
    if (!viewport) return
    persist.schedule({
      key: `viewport:${canvasId}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(
            session, 'db:plot-canvas-viewport-save', canvasId, viewport, projectKey,
          )
          return result.success
        })()
      },
    })
  }, [persist, projectKey])

  const addNodeAtCenter = useCallback(() => {
    const canvasId = activeCanvasIdRef.current
    const current = graphRef.current
    if (!canvasId) return
    const viewport = flowRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 }
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom
    const offset = (current?.nodes.length ?? 0) % 5 * 28
    const newNode: PlotCanvasNodeData = {
      id: createPlotCanvasNodeId(),
      canvasId,
      title: text('新剧情事件', 'New plot event'),
      summary: '',
      colorKey: 'default',
      chapterRefs: [],
      planId: null,
      subCanvasId: null,
      x: Math.round(centerX - NODE_WIDTH / 2 + offset),
      y: Math.round(centerY - NODE_HEIGHT_ESTIMATE / 2 + offset),
    }
    setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, newNode] } : previous)
    persistNode(newNode, canvasId)
    setSelectedNodeIds([newNode.id])
    setDetail({ kind: 'node', id: newNode.id, title: newNode.title, summary: '', colorKey: 'default' })
  }, [persistNode, text])

  const fitView = useCallback(() => {
    flowRef.current?.fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 })
  }, [])

  // 对照层：把确定性投影事件摆成只读幽灵节点（按章节网格排布，避开作者节点）。
  const ghostNodes = useMemo<PlotProjectionGhostNode[]>(() => {
    if (!showProjection || !projection) return []
    const chapters = new Set<number>()
    for (const track of projection.tracks) {
      for (const event of track.events) chapters.add(event.chapterNumber)
    }
    const chapterOrder = [...chapters].sort((a, b) => a - b)
    const ghosts: PlotProjectionGhostNode[] = []
    projection.tracks.forEach((track, trackIndex) => {
      track.events.forEach(event => {
        const data: PlotProjectionGhostNodeData = {
          trackTitle: track.title,
          chapterNumber: event.chapterNumber,
          summary: event.summary,
          status: event.status,
        }
        ghosts.push({
          id: `plot-projection-${track.id}-${event.chapterNumber}-${ghosts.length}`,
          type: 'plot-projection-ghost',
          position: {
            x: 100 + chapterOrder.indexOf(event.chapterNumber) * 280,
            y: 760 + trackIndex * 210,
          },
          draggable: false,
          selectable: false,
          connectable: false,
          deletable: false,
          data,
        })
      })
    })
    return ghosts
  }, [projection, showProjection])

  const flowNodes = useMemo(() => [...nodes, ...ghostNodes], [nodes, ghostNodes])

  const fitToSearch = useCallback(() => {
    const query = search.trim().toLowerCase()
    if (!query) return
    const hitIds = (graphRef.current?.nodes ?? [])
      .filter(node => `${node.title}\n${node.summary}`.toLowerCase().includes(query))
      .map(node => node.id)
    if (hitIds.length === 0) return
    flowRef.current?.fitView({ nodes: hitIds.map(id => ({ id })), padding: 0.35, duration: 280, maxZoom: 1.2 })
  }, [search])

  const deleteEdgeById = useCallback(async (edgeId: string) => {
    const canvasId = activeCanvasIdRef.current
    if (!canvasId) return
    const ok = await confirm(text('确认删除该连线？', 'Delete this connection?'), {
      title: text('删除连线', 'Delete connection'),
      confirmText: text('删除', 'Delete'),
      danger: true,
    })
    if (!ok) return
    setGraph(previous => previous ? {
      ...previous,
      edges: previous.edges.filter(edge => edge.id !== edgeId),
    } : previous)
    setDetail(previous => previous?.kind === 'edge' && previous.id === edgeId ? null : previous)
    persist.schedule({
      key: `edge-delete:${edgeId}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(
            session, 'db:plot-canvas-edge-delete', canvasId, edgeId, projectKey,
          )
          return result.success
        })()
      },
    })
  }, [persist, projectKey, text])

  // ===== 详情面板操作 =====

  // 详情面板按 detail.id 反查目标，不依赖 RF 的选中态：RF 在节点重建后会
  // 上报空选择，如果面板内容跟着选中态走，就会出现“面板开着但内容消失”。
  const detailNode = detail?.kind === 'node'
    ? graph?.nodes.find(node => node.id === detail.id) ?? null
    : null
  const detailEdge = detail?.kind === 'edge'
    ? graph?.edges.find(edge => edge.id === detail.id) ?? null
    : null

  const patchSelectedNode = useCallback((patch: Partial<PlotCanvasNodeData>) => {
    const canvasId = activeCanvasIdRef.current
    const current = graphRef.current
    if (!canvasId || !current) return
    const existing = current.nodes.find(node => node.id === patch.id)
    if (!existing) return
    const next: PlotCanvasNodeData = { ...existing, ...patch, id: existing.id, canvasId }
    setGraph(previous => previous ? {
      ...previous,
      nodes: previous.nodes.map(node => node.id === next.id ? next : node),
    } : previous)
    persistNode(next, canvasId)
  }, [persistNode])

  const detailSave = () => {
    if (!detail) return
    if (detail.kind === 'node') {
      patchSelectedNode({
        id: detail.id,
        title: detail.title.trim() || text('新剧情事件', 'New plot event'),
        summary: detail.summary.trim(),
        colorKey: detail.colorKey,
      })
      setDetail(previous => previous?.kind === 'node'
        ? { ...previous, title: detail.title.trim() || previous.title, summary: detail.summary.trim() }
        : previous)
      return
    }
    const canvasId = activeCanvasIdRef.current
    const existingEdge = graphRef.current?.edges.find(edge => edge.id === detail.id)
    if (!canvasId || !existingEdge) return
    const updated: PlotCanvasEdgeData = {
      ...existingEdge,
      label: detail.label.trim(),
      kind: detail.edgeKind,
    }
    setGraph(previous => previous ? {
      ...previous,
      edges: previous.edges.map(edge => edge.id === updated.id ? updated : edge),
    } : previous)
    persistEdge(updated, canvasId)
  }

  const createSubCanvasForNode = async () => {
    const canvasId = activeCanvasIdRef.current
    if (!subCanvasDialog || !canvasId) return
    const name = subCanvasName.trim() || subCanvasDialog.defaultName
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-create', name, canvasId, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success || !result.canvas) {
        toast.error(result.error ?? text('创建子画布失败', 'Could not create the sub-canvas'))
        return
      }
      patchSelectedNode({ id: subCanvasDialog.nodeId, subCanvasId: result.canvas.id })
      setSubCanvasDialog(null)
      await loadCanvases()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const mergeSelected = async () => {
    const canvasId = activeCanvasIdRef.current
    if (!mergeDialog || !canvasId || selectedNodeIds.length < 2) return
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-nodes-merge', {
        canvasId,
        sourceNodeIds: selectedNodeIds,
        title: mergeDialog.title.trim() || text('合并剧情事件', 'Merged plot event'),
        summary: mergeDialog.summary,
      }, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success || !result.node) {
        toast.error(result.error ?? text('合并失败', 'Merge failed'))
        return
      }
      await loadGraph(canvasId)
      setMergeDialog(null)
      setSelectedNodeIds([result.node.id])
      setDetail({ kind: 'node', id: result.node.id, title: result.node.title, summary: result.node.summary, colorKey: result.node.colorKey })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  // ===== 画布列表操作 =====

  const createCanvas = async (name: string, parentCanvasId: string | null) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    setCanvasDialogBusy(true)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-create', name, parentCanvasId, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success || !result.canvas) {
        toast.error(result.error ?? text('创建剧情画布失败', 'Could not create the plot canvas'))
        return
      }
      setCanvasDialog(null)
      await loadCanvases(result.canvas.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCanvasDialogBusy(false)
    }
  }

  const renameCanvas = async (canvas: PlotCanvasSummary, name: string) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    setCanvasDialogBusy(true)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-rename', canvas.id, name, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success || !result.canvas) {
        toast.error(result.error ?? text('重命名剧情画布失败', 'Could not rename the plot canvas'))
        return
      }
      setCanvasDialog(null)
      await loadCanvases()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCanvasDialogBusy(false)
    }
  }

  const deleteCanvas = async (canvas: PlotCanvasSummary, strategy: 'promote-children' | 'cascade') => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-delete', canvas.id, strategy, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success) {
        toast.error(result.error ?? text('删除剧情画布失败', 'Could not delete the plot canvas'))
        return
      }
      setDeleteCanvasTarget(null)
      // 画布删除可能让现存节点的 subCanvasId 被 SET NULL：重载当前画布。
      const activeId = activeCanvasIdRef.current
      await Promise.all([loadCanvases(), activeId ? loadGraph(activeId) : Promise.resolve()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  // ===== 渲染 =====

  const activeCanvas = canvases.find(canvas => canvas.id === activeCanvasId) ?? null
  const breadcrumb = useMemo(() => {
    const trail: PlotCanvasSummary[] = []
    const byId = new Map(canvases.map(canvas => [canvas.id, canvas]))
    let cursor: PlotCanvasSummary | null | undefined = activeCanvas
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      trail.unshift(cursor)
      cursor = cursor.parentCanvasId ? byId.get(cursor.parentCanvasId) : null
    }
    return trail
  }, [activeCanvas, canvases])

  const childCount = (canvasId: string) => canvases.filter(canvas => canvas.parentCanvasId === canvasId).length

  const chapterLinkInfo = useMemo(() => {
    const info = new Map<number, { hasBlueprint: boolean; draftId: number | null; finalized: boolean }>()
    if (!detailNode) return info
    for (const chapter of detailNode.chapterRefs) {
      const chapterDrafts = drafts.filter(draft => draft.chapterNumber === chapter && draft.status !== 'archived')
      const best = chapterDrafts.find(draft => draft.status === 'finalized') ?? chapterDrafts[0]
      info.set(chapter, {
        hasBlueprint: blueprints.some(bp => bp.chapterNumber === chapter),
        draftId: best?.id ?? null,
        finalized: best?.status === 'finalized',
      })
    }
    return info
  }, [blueprints, drafts, detailNode])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {text('加载剧情画布…', 'Loading plot canvases…')}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm" style={{ color: 'var(--color-error-text)' }}>
        <span>{loadError}</span>
        <Button variant="outline" size="sm" onClick={() => { setLoadError(''); void loadCanvases(); void loadReferences() }}>
          {text('重试', 'Retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0" data-testid="plot-canvas-workbench">
      {/* 左侧画布目录 */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{text('剧情画布', 'Plot canvases')}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { setCanvasDialogName(''); setCanvasDialog({ mode: 'create', parentCanvasId: null }) }}
            title={text('新增剧情画布', 'New plot canvas')}
            aria-label={text('新增剧情画布', 'New plot canvas')}
          >
            <Plus size={13} />
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="planning-pane__search">
            <Input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={text('搜索剧情画布…', 'Search canvases…')}
              aria-label={text('搜索剧情画布', 'Search canvases')}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3" data-testid="plot-canvas-list">
          {canvases.length === 0 && (
            <p className="px-2 py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {text('暂无剧情画布', 'No plot canvases yet')}
            </p>
          )}
          {canvases
            .filter(canvas => {
              const query = search.trim().toLowerCase()
              if (!query) return true
              return canvas.name.toLowerCase().includes(query)
            })
            .map(canvas => {
              const depth = (() => {
                let level = 0
                const byId = new Map(canvases.map(item => [item.id, item]))
                let cursor: PlotCanvasSummary | undefined = canvas
                const seen = new Set<string>()
                while (cursor?.parentCanvasId && !seen.has(cursor.id)) {
                  seen.add(cursor.id)
                  cursor = byId.get(cursor.parentCanvasId)
                  level += 1
                }
                return level
              })()
              return (
                <div key={canvas.id} className="canvas-list-row">
                  {Array.from({ length: depth }).map((_, index) => (
                    <span key={index} className="canvas-list-row__indent" aria-hidden="true" />
                  ))}
                  <button
                    type="button"
                    className={`planning-row flex-1${activeCanvasId === canvas.id ? ' is-selected' : ''}`}
                    aria-current={activeCanvasId === canvas.id ? 'true' : undefined}
                    onClick={() => setActiveCanvasId(canvas.id)}
                    title={canvas.name}
                  >
                    <span className="planning-row__icon"><Film size={12} /></span>
                    <span className="planning-row__content">
                      <span className="planning-row__title">{canvas.name}</span>
                      {depth > 0 && <span className="planning-row__subtitle">{text('子画布', 'Sub-canvas')}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="canvas-node__hover-action"
                    title={text('重命名', 'Rename')}
                    aria-label={text('重命名画布', 'Rename canvas')}
                    onClick={() => { setCanvasDialogName(canvas.name); setCanvasDialog({ mode: 'rename', canvas }) }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    className="canvas-node__hover-action"
                    title={text('新增子画布', 'New sub-canvas')}
                    aria-label={text('新增子画布', 'New sub-canvas')}
                    onClick={() => { setCanvasDialogName(''); setCanvasDialog({ mode: 'create', parentCanvasId: canvas.id }) }}
                  >
                    <FolderPlus size={11} />
                  </button>
                  <button
                    type="button"
                    className="canvas-node__hover-action"
                    data-variant="danger"
                    title={text('删除画布', 'Delete canvas')}
                    aria-label={text('删除画布', 'Delete canvas')}
                    onClick={() => setDeleteCanvasTarget(canvas)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            })}
        </div>
      </aside>

      {/* 主画布区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {activeCanvas ? (
          <>
            {persist.pendingCount > 0 && (
              <div className="canvas-unsaved-banner" role="status" data-testid="canvas-unsaved-banner">
                <span>{text(
                  `${persist.pendingCount} 项更改未保存${persist.lastError ? `（${persist.lastError}）` : ''}`,
                  `${persist.pendingCount} unsaved change(s)${persist.lastError ? ` (${persist.lastError})` : ''}`,
                )}</span>
                <button type="button" onClick={persist.retry}>{text('重试保存', 'Retry save')}</button>
              </div>
            )}
            <div className="canvas-toolbar">
              <nav className="canvas-breadcrumb" aria-label={text('画布层级', 'Canvas hierarchy')}>
                {breadcrumb.map((crumb, index) => (
                  <span key={crumb.id} className="contents">
                    {index > 0 && <ChevronRight size={10} className="canvas-breadcrumb__sep" aria-hidden="true" />}
                    <button
                      type="button"
                      className={`canvas-breadcrumb__crumb${index === breadcrumb.length - 1 ? ' is-current' : ''}`}
                      onClick={() => setActiveCanvasId(crumb.id)}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </nav>
              <span className="canvas-toolbar__spacer" />
              <span className="canvas-toolbar__meta">
                {text(`${graph?.nodes.length ?? 0} 个节点 · ${graph?.edges.length ?? 0} 条连线`, `${graph?.nodes.length ?? 0} nodes · ${graph?.edges.length ?? 0} edges`)}
              </span>
              <Button variant="outline" size="sm" onClick={addNodeAtCenter} data-testid="plot-canvas-add-node">
                <Plus size={12} />{text('新增剧情事件', 'Add plot event')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedNodeIds.length < 2}
                onClick={() => setMergeDialog({
                  title: graph?.nodes.find(node => node.id === selectedNodeIds[0])?.title ?? '',
                  summary: selectedNodeIds
                    .map(id => graph?.nodes.find(node => node.id === id)?.summary ?? '')
                    .filter(Boolean)
                    .join('\n\n'),
                })}
                title={text('把选中的两个以上节点合并为一个', 'Merge two or more selected nodes into one')}
              >
                {text('合并所选', 'Merge selected')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowProjection(previous => !previous)}
                title={text('把蓝图/定稿投影画成只读幽灵节点对照', 'Overlay the read-only blueprint/finalized projection as ghost nodes')}
              >
                {showProjection ? <EyeOff size={12} /> : <Eye size={12} />}
                {text('对照层', 'Projection')}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitToSearch} title={text('适应搜索结果', 'Fit search results')}>
                <Search size={12} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fitView} title={text('适应视图', 'Fit view')}>
                <Maximize2 size={12} />
              </Button>
            </div>
            {showProjection && projectionStale && (
              <p className="px-3 py-1 text-xs" role="status" style={{ color: 'var(--color-warning-text)', background: 'var(--color-panel)' }}>
                {text('蓝图或定稿已更新，对照层显示的是旧投影；可回到「章节脉络图」重建。', 'Blueprints or finalized drafts changed; the overlay shows the previous projection. Rebuild it in the Thread graph view.')}
              </p>
            )}
            {showProjection && !projection && (
              <p className="px-3 py-1 text-xs" role="status" style={{ color: 'var(--color-text-muted)', background: 'var(--color-panel)' }}>
                {text('尚未生成剧情树投影；可回到「章节脉络图」先生成，再回到这里对照。', 'No projection built yet; build it in the Thread graph view first, then come back to compare.')}
              </p>
            )}
            <div className="canvas-workbench__flow" data-testid="plot-canvas-flow">
              <ReactFlow<FlowNode, FlowEdge>
                nodes={flowNodes}
                edges={edges}
                nodeTypes={{
                  'plot-event-card': PlotEventCardNodeViewMemo,
                  'plot-projection-ghost': PlotProjectionGhostNodeViewMemo,
                }}
                edgeTypes={{ 'canvas-labeled': CanvasLabeledEdgeViewMemo }}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onMoveEnd={onMoveEnd}
                onInit={instance => { flowRef.current = instance }}
                onSelectionChange={selection => {
                  const nextNodeIds = selection.nodes.map(node => node.id)
                  const nextEdgeId = selection.edges[0]?.id ?? null
                  // React Flow 会在节点对象重建后再次上报同一份选择；内容相同
                  // 时必须保持原数组/原值，否则与重建 effect 互相触发死循环。
                  setSelectedNodeIds(previous => (
                    previous.length === nextNodeIds.length
                    && previous.every(id => nextNodeIds.includes(id))
                      ? previous
                      : nextNodeIds
                  ))
                  if (nextEdgeId) {
                    const edge = graph?.edges.find(item => item.id === nextEdgeId)
                    if (edge) setDetail({ kind: 'edge', id: edge.id, label: edge.label, edgeKind: edge.kind })
                  } else {
                    const firstNode = selection.nodes[0]
                    const node = firstNode ? graph?.nodes.find(item => item.id === firstNode.id) : null
                    if (node) setDetail({ kind: 'node', id: node.id, title: node.title, summary: node.summary, colorKey: node.colorKey })
                  }
                }}
                onNodeDoubleClick={(_, node) => {
                  const found = graph?.nodes.find(item => item.id === node.id)
                  if (found) setDetail({ kind: 'node', id: found.id, title: found.title, summary: found.summary, colorKey: found.colorKey })
                }}
                minZoom={0.2}
                maxZoom={2}
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--color-border)" />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm" style={{ color: 'var(--color-text-muted)' }} data-testid="plot-canvas-empty">
            <Film size={34} className="opacity-40" />
            <p className="font-medium" style={{ color: 'var(--color-text)' }}>{text('选择一个剧情画布', 'Select a plot canvas')}</p>
            <p className="text-xs">{text('从左侧目录选择一个剧情画布，或创建新的剧情画布', 'Pick a canvas from the list, or create a new one')}</p>
            <Button
              variant="default"
              size="sm"
              onClick={() => { setCanvasDialogName(''); setCanvasDialog({ mode: 'create', parentCanvasId: null }) }}
            >
              <Plus size={13} />{text('新增剧情画布', 'New plot canvas')}
            </Button>
          </div>
        )}
      </div>

      {/* 详情面板 */}
      {detail && activeCanvas && (
        <aside className="canvas-detail" data-testid="plot-canvas-detail">
          <div className="canvas-detail__header">
            <span className="canvas-detail__title">
              {detail.kind === 'node'
                ? text('剧情事件详情', 'Plot event details')
                : text('连线详情', 'Connection details')}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDetail(null)} aria-label={text('关闭详情', 'Close details')}>
              <X size={12} />
            </Button>
          </div>
          <div className="canvas-detail__body">
            {detail.kind === 'node' && detailNode && (
              <>
                <div className="canvas-detail__section">
                  <Label htmlFor="plot-node-title">{text('标题', 'Title')}</Label>
                  <Input
                    id="plot-node-title"
                    value={detail.title}
                    onChange={event => setDetail(previous => previous?.kind === 'node' ? { ...previous, title: event.target.value } : previous)}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label htmlFor="plot-node-summary">{text('摘要', 'Summary')}</Label>
                  <Textarea
                    id="plot-node-summary"
                    rows={5}
                    value={detail.summary}
                    onChange={event => setDetail(previous => previous?.kind === 'node' ? { ...previous, summary: event.target.value } : previous)}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label>{text('颜色', 'Color')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {NODE_COLOR_KEYS.map(key => (
                      <button
                        key={key}
                        type="button"
                        className={`planning-chip${detail.colorKey === key ? ' is-active' : ''}`}
                        aria-pressed={detail.colorKey === key}
                        onClick={() => setDetail(previous => previous?.kind === 'node' ? { ...previous, colorKey: key } : previous)}
                      >
                        {text(...COLOR_LABELS[key])}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="canvas-detail__section">
                  <Label>{text('关联章节（点击切换）', 'Linked chapters (click to toggle)')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      const chapterNumbers = new Set<number>(detailNode.chapterRefs)
                      for (const bp of blueprints) chapterNumbers.add(bp.chapterNumber)
                      for (const draft of drafts) chapterNumbers.add(draft.chapterNumber)
                      return [...chapterNumbers].sort((a, b) => a - b).slice(0, 60).map(chapter => (
                        <button
                          key={chapter}
                          type="button"
                          className={`planning-chip${detailNode.chapterRefs.includes(chapter) ? ' is-active' : ''}`}
                          aria-pressed={detailNode.chapterRefs.includes(chapter)}
                          onClick={() => patchSelectedNode({
                            id: detailNode.id,
                            chapterRefs: detailNode.chapterRefs.includes(chapter)
                              ? detailNode.chapterRefs.filter(item => item !== chapter)
                              : [...detailNode.chapterRefs, chapter].sort((a, b) => a - b),
                          })}
                        >
                          {text(`第${chapter}章`, `Ch ${chapter}`)}
                        </button>
                      ))
                    })()}
                  </div>
                </div>
                <div className="canvas-detail__section">
                  <Label htmlFor="plot-node-plan">{text('关联线索计划', 'Linked thread plan')}</Label>
                  <NativeSelect
                    id="plot-node-plan"
                    value={detailNode.planId ?? ''}
                    onChange={event => patchSelectedNode({
                      id: detailNode.id,
                      planId: event.target.value === '' ? null : Number(event.target.value),
                    })}
                  >
                    <option value="">{text('未关联', 'Not linked')}</option>
                    {threads.map(thread => (
                      <option key={thread.id} value={thread.id}>{thread.title}</option>
                    ))}
                  </NativeSelect>
                  {detailNode.planId !== null && (
                    <Button variant="outline" size="sm" className="self-start" onClick={() => onOpenPlan?.(detailNode.planId as number)}>
                      {text('查看线索计划', 'Open thread plan')}
                    </Button>
                  )}
                </div>
                <div className="canvas-detail__section">
                  <Label>{text('章节跳转', 'Chapter jumps')}</Label>
                  <div className="canvas-detail__links">
                    {detailNode.chapterRefs.length === 0 && (
                      <span className="canvas-detail__text">{text('尚未关联章节。', 'No chapters linked yet.')}</span>
                    )}
                    {[...chapterLinkInfo.entries()].map(([chapter, info]) => (
                      <div key={chapter} className="flex flex-col gap-1">
                        <span className="canvas-detail__label">{text(`第 ${chapter} 章`, `Chapter ${chapter}`)}</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className={`canvas-detail__link${!info.hasBlueprint ? ' is-broken' : ''}`}
                            disabled={!info.hasBlueprint}
                            title={info.hasBlueprint
                              ? text('打开该章蓝图', 'Open this chapter blueprint')
                              : text('该章还没有蓝图', 'No blueprint for this chapter yet')}
                            onClick={() => openBlueprint(chapter)}
                          >
                            <span>{info.hasBlueprint ? text('打开蓝图', 'Open blueprint') : text('暂无蓝图', 'No blueprint')}</span>
                          </button>
                          <button
                            type="button"
                            className={`canvas-detail__link${!info.draftId ? ' is-broken' : ''}`}
                            disabled={!info.draftId}
                            title={info.draftId
                              ? text('打开该章正文', 'Open this chapter draft')
                              : text('该章还没有正文', 'No draft for this chapter yet')}
                            onClick={() => info.draftId && openDraft(info.draftId, chapter)}
                          >
                            <span>{info.draftId
                              ? text(info.finalized ? '打开定稿' : '打开草稿', info.finalized ? 'Open finalized' : 'Open draft')
                              : text('暂无正文', 'No draft')}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="canvas-detail__section">
                  <Label>{text('子画布', 'Sub-canvas')}</Label>
                  {detailNode.subCanvasId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => setActiveCanvasId(detailNode.subCanvasId as string)}
                    >
                      {text('进入子画布', 'Enter sub-canvas')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => {
                        const defaultName = `${detailNode.title} · ${text('子画布', 'Sub-canvas')}`
                        setSubCanvasName(defaultName)
                        setSubCanvasDialog({ nodeId: detailNode.id, defaultName })
                      }}
                    >
                      <FolderPlus size={12} />{text('创建子画布并关联', 'Create and link sub-canvas')}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={detailSave} data-testid="plot-node-save">{text('保存修改', 'Save changes')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteNode(detailNode.id)} data-testid="plot-node-delete">
                    <Trash2 size={12} />{text('删除节点', 'Delete node')}
                  </Button>
                </div>
              </>
            )}
            {detail.kind === 'edge' && detailEdge && (
              <>
                <div className="canvas-detail__section">
                  <Label htmlFor="plot-edge-label">{text('关系标签（如：承接 / 埋下 / 回收）', 'Relation label (e.g. follows / plants / pays off)')}</Label>
                  <Input
                    id="plot-edge-label"
                    value={detail.label}
                    onChange={event => setDetail(previous => previous?.kind === 'edge' ? { ...previous, label: event.target.value } : previous)}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label>{text('连线种类', 'Connection kind')}</Label>
                  <NativeSelect
                    value={detail.edgeKind}
                    onChange={event => setDetail(previous => previous?.kind === 'edge'
                      ? { ...previous, edgeKind: event.target.value as 'main' | 'aux' }
                      : previous)}
                  >
                    <option value="main">{text('主线（实线）', 'Main (solid)')}</option>
                    <option value="aux">{text('次要（虚线）', 'Secondary (dashed)')}</option>
                  </NativeSelect>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={detailSave}>{text('保存修改', 'Save changes')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteEdgeById(detailEdge.id)}>
                    <Trash2 size={12} />{text('删除连线', 'Delete connection')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* 新建 / 重命名画布对话框 */}
      <Dialog open={canvasDialog !== null} onOpenChange={open => { if (!open) setCanvasDialog(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {canvasDialog?.mode === 'create' ? text('新增剧情画布', 'New plot canvas') : text('重命名剧情画布', 'Rename plot canvas')}
            </DialogTitle>
            <DialogDescription>
              {canvasDialog?.mode === 'create' && canvasDialog.parentCanvasId
                ? text('子画布会挂在所选画布下，用于收纳一个剧情事件的展开。', 'The sub-canvas hangs under the chosen canvas to expand one plot event.')
                : text('画布标题用于左侧目录与面包屑。', 'The canvas title appears in the list and breadcrumb.')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-3">
            <Label htmlFor="plot-canvas-name">{text('画布标题', 'Canvas title')}</Label>
            <Input
              id="plot-canvas-name"
              value={canvasDialogName}
              onChange={event => setCanvasDialogName(event.target.value)}
              placeholder={text('例如：第一卷主线', 'e.g. Volume 1 main line')}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCanvasDialog(null)}>{text('取消', 'Cancel')}</Button>
            <Button
              disabled={canvasDialogBusy || !canvasDialogName.trim()}
              onClick={() => {
                if (canvasDialog?.mode === 'create') void createCanvas(canvasDialogName.trim(), canvasDialog.parentCanvasId)
                if (canvasDialog?.mode === 'rename') {
                  if (canvasDialog.canvas.name === canvasDialogName.trim()) setCanvasDialog(null)
                  else void renameCanvas(canvasDialog.canvas, canvasDialogName.trim())
                }
              }}
            >
              {text('保存', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除画布（含子画布策略） */}
      <Dialog open={deleteCanvasTarget !== null} onOpenChange={open => { if (!open) setDeleteCanvasTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{text('删除剧情画布', 'Delete plot canvas')}</DialogTitle>
            <DialogDescription>
              {deleteCanvasTarget && childCount(deleteCanvasTarget.id) > 0
                ? text(`「${deleteCanvasTarget.name}」包含 ${childCount(deleteCanvasTarget.id)} 个子画布。`, `“${deleteCanvasTarget.name}” contains ${childCount(deleteCanvasTarget.id)} sub-canvas(es).`)
                : text(`确认删除「${deleteCanvasTarget?.name ?? ''}」？画布上的节点与连线会一并删除，蓝图与正文不受影响。`, `Delete “${deleteCanvasTarget?.name ?? ''}”? Its nodes and connections are removed; blueprints and prose are untouched.`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteCanvasTarget(null)}>{text('取消', 'Cancel')}</Button>
            {deleteCanvasTarget && childCount(deleteCanvasTarget.id) > 0 && (
              <Button variant="outline" onClick={() => void deleteCanvas(deleteCanvasTarget, 'promote-children')}>
                {text('删除并上移子画布', 'Delete, keep sub-canvases')}
              </Button>
            )}
            {deleteCanvasTarget && (
              <Button variant="destructive" onClick={() => void deleteCanvas(deleteCanvasTarget, 'cascade')}>
                {childCount(deleteCanvasTarget.id) > 0
                  ? text('连同子画布一起删除', 'Delete with sub-canvases')
                  : text('删除', 'Delete')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 合并对话框 */}
      <Dialog open={mergeDialog !== null} onOpenChange={open => { if (!open) setMergeDialog(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{text('合并剧情事件', 'Merge plot events')}</DialogTitle>
            <DialogDescription>{text(
              '所选节点将合并为一个新节点：章节引用取并集，外部连线按原方向改接，源节点删除。',
              'Selected nodes merge into one new node: chapter refs union, external connections re-attached, sources removed.',
            )}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-3">
            <div>
              <Label htmlFor="plot-merge-title">{text('合并后标题', 'Merged title')}</Label>
              <Input
                id="plot-merge-title"
                value={mergeDialog?.title ?? ''}
                onChange={event => setMergeDialog(previous => previous ? { ...previous, title: event.target.value } : previous)}
              />
            </div>
            <div>
              <Label htmlFor="plot-merge-summary">{text('合并后摘要', 'Merged summary')}</Label>
              <Textarea
                id="plot-merge-summary"
                rows={6}
                value={mergeDialog?.summary ?? ''}
                onChange={event => setMergeDialog(previous => previous ? { ...previous, summary: event.target.value } : previous)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMergeDialog(null)}>{text('取消', 'Cancel')}</Button>
            <Button onClick={() => void mergeSelected()}>{text('合并', 'Merge')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 创建子画布对话框 */}
      <Dialog open={subCanvasDialog !== null} onOpenChange={open => { if (!open) setSubCanvasDialog(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{text('创建剧情子画布', 'Create plot sub-canvas')}</DialogTitle>
            <DialogDescription>{text(
              '子画布挂在当前画布下，并与该节点关联；节点会出现「进入子画布」入口。',
              'The sub-canvas hangs under this canvas and links to the node, which gains an “enter sub-canvas” entry.',
            )}</DialogDescription>
          </DialogHeader>
          <div className="px-6 py-3">
            <Label htmlFor="plot-subcanvas-name">{text('子画布标题', 'Sub-canvas title')}</Label>
            <Input
              id="plot-subcanvas-name"
              value={subCanvasName}
              onChange={event => setSubCanvasName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSubCanvasDialog(null)}>{text('取消', 'Cancel')}</Button>
            <Button onClick={() => void createSubCanvasForNode()}>{text('创建并关联', 'Create and link')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function openBlueprint(chapter: number): void {
  openBuiltinEditor(
    'chapter-card-editor',
    useLocaleStore.getState().text('章节蓝图', 'Chapter blueprint'),
    'chapter-card',
    undefined,
    chapter,
  )
}

function openDraft(draftId: number, chapter: number): void {
  const text = useLocaleStore.getState().text
  void openChapterFile(`vela://draft/${draftId}`, text(`第 ${chapter} 章草稿`, `Chapter ${chapter} draft`))
}
