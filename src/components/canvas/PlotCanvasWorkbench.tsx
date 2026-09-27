/**
 * PlotCanvasWorkbench — 作者可编辑的剧情画布（跨章节剧情组织）。
 *
 * 交互语义移植自参考项目的 PlotBuilderCanvas / PlotOutlineTree（编译产物
 * WorldStudio-D4YQGBkX.js），并由 PlotCanvasShell 承载整体外壳：左侧目录、
 * 顶部悬浮选择器/面包屑/新增事件、左侧 PlotGraphToolbar 工具条、右侧详情
 * 或画布信息面板。React Flow 画布只有这一个实例，经 Shell 的 `canvas`
 * ReactNode 插槽注入；节点统一渲染为 plot-graph 的十类卡片（旧数据缺省
 * kind 回落 'plot'），投影对照层仍为只读幽灵节点。
 *
 * 搜索与十类筛选只作用于视图（filter-utils 纯函数）：被筛选隐藏的节点其
 * 连线一并隐藏，取消筛选即刻恢复；搜索命中可逐个定位。持久化仍走
 * “动作后即存”的幂等队列（useCanvasPersistence），所有 IPC 都经过项目
 * session 校验，项目切换后旧项目的异步结果不会写入新页面。
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
  Eye,
  EyeOff,
  FolderPlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'

import type { DatabaseChannels } from '../../shared/ipc-channels'
import {
  createPlotCanvasEdgeId,
  createPlotCanvasNodeId,
  normalizePlotCanvasTags,
  PLOT_CANVAS_NODE_KINDS,
  PLOT_CANVAS_NODE_KIND_LABELS,
  resolvePlotCanvasNodeKind,
  type PlotCanvasColorKey,
  type PlotCanvasEdgeData,
  type PlotCanvasGraph,
  type PlotCanvasNodeData,
  type PlotCanvasNodeEntityRef,
  type PlotCanvasNodeKind,
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
  PlotProjectionGhostNode,
  PlotProjectionGhostNodeData,
  PlotProjectionGhostNodeViewMemo,
} from './CanvasVisuals'
import {
  CreatePlotCanvasDialog,
  PlotCanvasEmptyState,
  PlotCanvasInfoPanel,
  PlotCanvasShell,
  PlotCanvasSidebar,
  PlotCanvasTopbar,
  type PlotCanvasDraftValues,
  type PlotCanvasSidebarEntry,
  type PlotCanvasSidebarTab,
} from './plot-shell'
import {
  filterPlotGraphNodes,
  PlotGraphCardNode,
  PlotGraphFilter,
  PlotGraphToolbar,
  resolvePlotGraphEdgeVisibility,
  type CanvasInteractionMode,
  type PlotGraphFilterState,
  type PlotGraphNode,
  type PlotGraphNodeData,
} from './plot-graph'
import './canvas-workbench.css'

type BlueprintRow = DatabaseChannels['db:blueprint-get-all']['return'][number]
type DraftRow = DatabaseChannels['db:draft-list-all']['return'][number]
type ThreadRow = DatabaseChannels['db:narrative-thread-list']['return'][number]
type ForeshadowingRow = DatabaseChannels['db:foreshadowing-list']['return'][number]

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

const ENTITY_REF_TYPE_LABELS: Record<PlotCanvasNodeEntityRef['entityType'], [string, string]> = {
  foreshadowing: ['伏笔记录', 'Foreshadowing'],
  'world-map-node': ['地图地点', 'Map node'],
  'timeline-event': ['时间线事件', 'Timeline event'],
  draft: ['正文草稿', 'Draft'],
}

interface PlotCanvasWorkbenchProps {
  projectKey: string
  /** 从画布节点跳到线索计划（切换到计划清单视图并定位）。 */
  onOpenPlan?: (planId: number) => void
}

type FlowNode = PlotGraphNode | PlotProjectionGhostNode
type FlowEdge = CanvasLabeledEdge

type DetailState =
  | {
    kind: 'node'
    id: string
    title: string
    summary: string
    colorKey: PlotCanvasColorKey
    nodeKind: PlotCanvasNodeKind
    tagsText: string
  }
  | { kind: 'edge'; id: string; label: string; edgeKind: 'main' | 'aux' }

function detailFromNode(node: PlotCanvasNodeData): DetailState {
  return {
    kind: 'node',
    id: node.id,
    title: node.title,
    summary: node.summary,
    colorKey: node.colorKey,
    nodeKind: resolvePlotCanvasNodeKind(node),
    tagsText: (node.tags ?? []).join(', '),
  }
}

/** 作者输入的标签串 → 归一化数组；整体非法（超长/超量）返回 null。 */
function parseTagsInput(raw: string): string[] | null {
  return normalizePlotCanvasTags(raw.split(/[,，、;；\n]/))
}

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
  const [foreshadowings, setForeshadowings] = useState<ForeshadowingRow[]>([])
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
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  // ===== 外壳状态 =====
  const [sidebarTab, setSidebarTab] = useState<PlotCanvasSidebarTab>('plot')
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [filterBarOpen, setFilterBarOpen] = useState(false)
  const [filter, setFilter] = useState<PlotGraphFilterState>({ searchQuery: '', selectedKinds: new Set() })
  const [matchIndex, setMatchIndex] = useState(-1)
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('pan')
  const [showGrid, setShowGrid] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const filterBarRef = useRef<HTMLDivElement | null>(null)
  const pickerMenuRef = useRef<HTMLDivElement | null>(null)

  // ===== 对话框 =====
  const [canvasDialog, setCanvasDialog] = useState<
    | { mode: 'create'; parentCanvasId: string | null }
    | { mode: 'rename'; canvas: PlotCanvasSummary }
    | null
  >(null)
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

  const openCreateDialog = useCallback(() => {
    setCanvasDialog({ mode: 'create', parentCanvasId: null })
  }, [])

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
    const [nextBlueprints, nextDrafts, nextThreads, nextForeshadowings] = await Promise.all([
      ipc.invokeWithProjectSession(session, 'db:blueprint-get-all', projectKey),
      ipc.invokeWithProjectSession(session, 'db:draft-list-all', projectKey),
      ipc.invokeWithProjectSession(session, 'db:narrative-thread-list', projectKey),
      ipc.invokeWithProjectSession(session, 'db:foreshadowing-list', 'all', projectKey),
    ])
    if (!isProjectSessionCurrent(session)) return
    setBlueprints(nextBlueprints)
    setDrafts(nextDrafts)
    setThreads(nextThreads)
    setForeshadowings(nextForeshadowings)
  }, [projectKey])

  const loadGraph = useCallback(async (canvasId: string) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const next = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-graph-get', canvasId, projectKey)
    if (!isProjectSessionCurrent(session)) return
    setGraph(next)
    setSelectedNodeIds([])
    setDetail(null)
    setFilter({ searchQuery: '', selectedKinds: new Set() })
    setMatchIndex(-1)
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
    editNode: (nodeId: string) => void
    splitNode: (nodeId: string) => void
    deleteNode: (nodeId: string) => void
    enterSubCanvas: (nodeId: string, subCanvasId?: string) => void
  }>({
    editNode: () => {},
    splitNode: () => {},
    deleteNode: () => {},
    enterSubCanvas: () => {},
  })

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
            kind: node.kind,
            title: node.title,
            summary: node.summary,
            colorKey: node.colorKey,
            tags: node.tags,
            entityRefs: node.entityRefs,
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
    // 右下方；种类与颜色随源节点，正文由作者在详情面板自行搬运。
    const newNode: PlotCanvasNodeData = {
      id: createPlotCanvasNodeId(),
      canvasId,
      kind: node.kind,
      title: `${node.title} · ${text('续', 'cont.')}`,
      summary: '',
      colorKey: node.colorKey,
      tags: [],
      entityRefs: [],
      chapterRefs: [],
      planId: null,
      subCanvasId: null,
      x: node.x + NODE_WIDTH + 48,
      y: node.y + NODE_HEIGHT_ESTIMATE + 40,
    }
    setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, newNode] } : previous)
    persistNode(newNode, canvasId)
    setSelectedNodeIds([newNode.id])
    setDetail(detailFromNode(newNode))
  }, [persistNode, text])

  // ref 只能在 effect 中赋值；节点数据回调经 ref 转发，避免闭包过期。
  useEffect(() => {
    actionsRef.current = {
      editNode: nodeId => {
        const node = graphRef.current?.nodes.find(item => item.id === nodeId)
        if (node) setDetail(detailFromNode(node))
      },
      splitNode,
      deleteNode: nodeId => { void deleteNode(nodeId) },
      enterSubCanvas: (nodeId, subCanvasId) => {
        const target = subCanvasId
          ?? graphRef.current?.nodes.find(item => item.id === nodeId)?.subCanvasId
        if (target) setActiveCanvasId(target)
      },
    }
  }, [splitNode, deleteNode])

  // ===== graph → 基础 Flow 模型（视图标志由筛选派生，不在此写入） =====

  const subCanvasTitles = useMemo(() => new Map(canvases.map(canvas => [canvas.id, canvas.name])), [canvases])

  useEffect(() => {
    if (!graph) {
      setNodes([])
      setEdges([])
      return
    }
    // 重建时保留 RF 已上报的选中态；detail 面板不依赖它，这里只为视觉连续。
    setNodes(previous => graph.nodes.map(node => {
      const data: PlotGraphNodeData = {
        kind: resolvePlotCanvasNodeKind(node),
        title: node.title,
        summary: node.summary,
        tags: node.tags,
        colorKey: node.colorKey,
        chapterRefs: node.chapterRefs,
        hasPlan: node.planId !== null,
        planId: node.planId,
        subCanvasTitle: node.subCanvasId ? subCanvasTitles.get(node.subCanvasId) ?? null : null,
        subCanvasId: node.subCanvasId,
        entityRefs: node.entityRefs,
        onEdit: id => actionsRef.current.editNode(id),
        onSplit: id => actionsRef.current.splitNode(id),
        onDelete: id => actionsRef.current.deleteNode(id),
        onEnterSubCanvas: (id, subCanvasId) => actionsRef.current.enterSubCanvas(id, subCanvasId),
      }
      const previousNode = previous.find(item => item.id === node.id)
      return {
        id: node.id,
        type: 'plot-graph-card' as const,
        position: { x: node.x, y: node.y },
        ...(previousNode?.selected ? { selected: true } : {}),
        data,
      }
    }))
    setEdges(previous => graph.edges.map(edge => ({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      type: 'canvas-labeled' as const,
      ...(previous.find(item => item.id === edge.id)?.selected ? { selected: true } : {}),
      data: { label: edge.label, kind: edge.kind },
    })))
  }, [graph, subCanvasTitles, setNodes, setEdges])

  // ===== 搜索 / 筛选派生（纯视图，不改持久化数据） =====

  const baseNodes = useMemo<PlotGraphNode[]>(
    () => nodes.filter((node): node is PlotGraphNode => node.type === 'plot-graph-card'),
    [nodes],
  )
  const filterResult = useMemo(() => filterPlotGraphNodes(baseNodes, filter), [baseNodes, filter])
  const isSearchActive = filter.searchQuery.trim().length > 0
  const visibleIdSet = useMemo(() => new Set(filterResult.visibleNodes.map(node => node.id)), [filterResult])
  const searchHitIdSet = useMemo(() => new Set(filterResult.searchHits.map(node => node.id)), [filterResult])
  const searchHits = filterResult.searchHits

  // 搜索词或筛选集合变化后，定位序号回到未聚焦状态。
  useEffect(() => { setMatchIndex(-1) }, [filter.searchQuery, filter.selectedKinds])

  const focusMatch = useCallback((index: number) => {
    if (searchHits.length === 0) return
    const wrapped = ((index % searchHits.length) + searchHits.length) % searchHits.length
    setMatchIndex(wrapped)
    flowRef.current?.fitView({ nodes: [{ id: searchHits[wrapped].id }], padding: 0.35, duration: 280, maxZoom: 1.2 })
  }, [searchHits])

  useEffect(() => {
    if (!filterBarOpen) return
    const timer = window.setTimeout(() => {
      filterBarRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    }, 40)
    return () => window.clearTimeout(timer)
  }, [filterBarOpen])

  // 画布选择器下拉：点击菜单外（含顶栏按钮以外区域）关闭。
  useEffect(() => {
    if (!pickerOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (pickerMenuRef.current?.contains(target as Node)) return
      if (target?.closest?.('[data-testid="plot-canvas-picker"]')) return
      setPickerOpen(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [pickerOpen])

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
      kind: 'plot',
      title: text('新剧情事件', 'New plot event'),
      summary: '',
      colorKey: 'default',
      tags: [],
      entityRefs: [],
      chapterRefs: [],
      planId: null,
      subCanvasId: null,
      x: Math.round(centerX - NODE_WIDTH / 2 + offset),
      y: Math.round(centerY - NODE_HEIGHT_ESTIMATE / 2 + offset),
    }
    setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, newNode] } : previous)
    persistNode(newNode, canvasId)
    setSelectedNodeIds([newNode.id])
    setDetail(detailFromNode(newNode))
  }, [persistNode, text])

  const fitView = useCallback(() => {
    flowRef.current?.fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 })
  }, [])

  // 选择变化处理器必须保持稳定身份：React Flow 会把 onSelectionChange 写进
  // 内部 store（useEffect 中 setState），每次渲染换新函数都会让写入立刻以
  // 当前选择回调一次；若回调再触发渲染就形成无限更新循环。这里用
  // useCallback + graphRef 取数据，并对 setDetail 做同值短路。
  const handleSelectionChange = useCallback((selection: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
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
    const current = graphRef.current
    if (nextEdgeId) {
      const edge = current?.edges.find(item => item.id === nextEdgeId)
      if (edge) {
        setDetail(previous => previous?.kind === 'edge' && previous.id === edge.id
          ? previous
          : { kind: 'edge', id: edge.id, label: edge.label, edgeKind: edge.kind })
      }
    } else {
      const firstNode = selection.nodes[0]
      const node = firstNode ? current?.nodes.find(item => item.id === firstNode.id) : null
      if (node) {
        setDetail(previous => previous?.kind === 'node' && previous.id === node.id
          ? previous
          : detailFromNode(node))
      }
    }
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

  const flowNodes = useMemo(() => [...filterResult.processedNodes, ...ghostNodes], [filterResult, ghostNodes])
  const flowEdges = useMemo(
    () => resolvePlotGraphEdgeVisibility(edges, visibleIdSet, searchHitIdSet, isSearchActive),
    [edges, visibleIdSet, searchHitIdSet, isSearchActive],
  )

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
      const tags = parseTagsInput(detail.tagsText)
      if (tags === null) {
        toast.error(text(
          `标签无效：最多 ${32} 个且单个不超过 ${40} 字。`,
          `Invalid tags: at most 32 tags, 40 characters each.`,
        ))
        return
      }
      patchSelectedNode({
        id: detail.id,
        title: detail.title.trim() || text('新剧情事件', 'New plot event'),
        summary: detail.summary.trim(),
        colorKey: detail.colorKey,
        kind: detail.nodeKind,
        tags,
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
      setDetail(detailFromNode(result.node))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  // ===== 画布列表操作 =====

  const createCanvas = async (values: PlotCanvasDraftValues, parentCanvasId: string | null) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    setCanvasDialogBusy(true)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-create', values.title, parentCanvasId, projectKey)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success || !result.canvas) {
        toast.error(result.error ?? text('创建剧情画布失败', 'Could not create the plot canvas'))
        return
      }
      if (values.description) {
        const updated = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-update', {
          canvasId: result.canvas.id,
          description: values.description,
        }, projectKey)
        if (!isProjectSessionCurrent(session)) return
        if (!updated.success) {
          toast.error(updated.error ?? text('保存画布说明失败', 'Could not save the canvas description'))
        }
      }
      setCanvasDialog(null)
      await loadCanvases(result.canvas.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCanvasDialogBusy(false)
    }
  }

  const renameCanvas = async (canvas: PlotCanvasSummary, values: PlotCanvasDraftValues) => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    setCanvasDialogBusy(true)
    try {
      if (canvas.name !== values.title) {
        const renamed = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-rename', canvas.id, values.title, projectKey)
        if (!isProjectSessionCurrent(session)) return
        if (!renamed.success || !renamed.canvas) {
          toast.error(renamed.error ?? text('重命名剧情画布失败', 'Could not rename the plot canvas'))
          return
        }
      }
      if (canvas.description !== values.description) {
        const updated = await ipc.invokeWithProjectSession(session, 'db:plot-canvas-update', {
          canvasId: canvas.id,
          description: values.description,
        }, projectKey)
        if (!isProjectSessionCurrent(session)) return
        if (!updated.success) {
          toast.error(updated.error ?? text('保存画布说明失败', 'Could not save the canvas description'))
          return
        }
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

  // 面包屑：只含祖先链（当前画布名显示在选择器胶囊里）。
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
    return trail.slice(0, -1)
  }, [activeCanvas, canvases])

  const canvasesById = useMemo(() => new Map(canvases.map(canvas => [canvas.id, canvas])), [canvases])

  const levelOf = useCallback((canvas: PlotCanvasSummary): number => {
    let level = 0
    let cursor: PlotCanvasSummary | undefined = canvas
    const seen = new Set<string>()
    while (cursor?.parentCanvasId && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      cursor = canvasesById.get(cursor.parentCanvasId)
      level += 1
    }
    return level
  }, [canvasesById])

  const sidebarEntries = useMemo<PlotCanvasSidebarEntry[]>(() => {
    if (sidebarTab !== 'plot') return []
    const query = sidebarSearch.trim().toLowerCase()
    return canvases
      .filter(canvas => !query || canvas.name.toLowerCase().includes(query))
      .map(canvas => {
        const level = levelOf(canvas)
        return {
          id: canvas.id,
          name: canvas.name,
          description: canvas.description || (level > 0 ? text('子画布', 'Sub-canvas') : null),
          level,
          hasChildren: canvases.some(item => item.parentCanvasId === canvas.id),
        }
      })
  }, [canvases, levelOf, sidebarSearch, sidebarTab, text])

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

  const sidebarItemActions = (entry: PlotCanvasSidebarEntry) => {
    const canvas = canvasesById.get(entry.id)
    if (!canvas) return null
    return (
      <>
        <button
          type="button"
          className="canvas-node__hover-action"
          title={text('重命名', 'Rename')}
          aria-label={text('重命名画布', 'Rename canvas')}
          onClick={() => setCanvasDialog({ mode: 'rename', canvas })}
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          className="canvas-node__hover-action"
          title={text('新增子画布', 'New sub-canvas')}
          aria-label={text('新增子画布', 'New sub-canvas')}
          onClick={() => setCanvasDialog({ mode: 'create', parentCanvasId: canvas.id })}
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
      </>
    )
  }

  const hasNodes = (graph?.nodes.length ?? 0) > 0
  const floatStackTop = filterBarOpen ? 104 : 58

  const rightPanel = detail && activeCanvas ? (
    <div className="plot-shell__detail" data-testid="plot-canvas-detail">
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
      <div className="plot-shell__detail__body">
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
              <Label>{text('种类', 'Kind')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLOT_CANVAS_NODE_KINDS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={`planning-chip${detail.nodeKind === kind ? ' is-active' : ''}`}
                    aria-pressed={detail.nodeKind === kind}
                    onClick={() => setDetail(previous => previous?.kind === 'node' ? { ...previous, nodeKind: kind } : previous)}
                  >
                    {text(PLOT_CANVAS_NODE_KIND_LABELS[kind].zh, PLOT_CANVAS_NODE_KIND_LABELS[kind].en)}
                  </button>
                ))}
              </div>
            </div>
            <div className="canvas-detail__section">
              <Label htmlFor="plot-node-tags">{text('标签（逗号分隔）', 'Tags (comma separated)')}</Label>
              <Input
                id="plot-node-tags"
                value={detail.tagsText}
                onChange={event => setDetail(previous => previous?.kind === 'node' ? { ...previous, tagsText: event.target.value } : previous)}
                placeholder={text('例如：主线, 悬念', 'e.g. main line, suspense')}
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
                  <Label>{text('关联实体（引用可能失效）', 'Linked entities (references may dangle)')}</Label>
                  {(detailNode.entityRefs?.length ?? 0) === 0 ? (
                    <span className="canvas-detail__text">{text('尚未关联实体记录。', 'No entity records linked yet.')}</span>
                  ) : (
                    <div className="canvas-detail__links">
                      {(detailNode.entityRefs ?? []).map((ref, index) => {
                        const labelPair = ENTITY_REF_TYPE_LABELS[ref.entityType]
                        // 只有加载了权威列表的引用类型才做失效判定（draft 与
                        // 伏笔记录）；地图/时间线引用仅展示，不虚构状态。
                        const draftMissing = ref.entityType === 'draft'
                          && !drafts.some(draft => draft.id === ref.entityId)
                        const foreshadowMissing = ref.entityType === 'foreshadowing'
                          && !foreshadowings.some(item => item.id === ref.entityId)
                        const isMissing = draftMissing || foreshadowMissing
                        return (
                          <div key={`${ref.entityType}-${ref.entityId}-${index}`} className="flex flex-col gap-1">
                            <span className="canvas-detail__label">
                              {text(labelPair[0], labelPair[1])} · {String(ref.entityId)}
                              {isMissing ? text('（引用失效）', ' (missing)') : ''}
                            </span>
                            {ref.entityType === 'draft' && !draftMissing && (
                              <button
                                type="button"
                                className="canvas-detail__link"
                                title={text('打开该正文草稿', 'Open this draft')}
                                onClick={() => openDraftRef(ref)}
                              >
                                <span>{text('打开正文', 'Open draft')}</span>
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
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
    </div>
  ) : infoOpen ? (
    <PlotCanvasInfoPanel
      canvasName={activeCanvas?.name ?? null}
      description={activeCanvas?.description ?? null}
      nodeCount={graph?.nodes.length ?? 0}
      edgeCount={graph?.edges.length ?? 0}
      onClose={() => setInfoOpen(false)}
    >
      {activeCanvas && (
        <button
          type="button"
          className="canvas-detail__link"
          onClick={() => setCanvasDialog({ mode: 'rename', canvas: activeCanvas })}
          data-testid="plot-canvas-info-edit"
        >
          <span>{text('编辑标题与说明', 'Edit title & description')}</span>
        </button>
      )}
    </PlotCanvasInfoPanel>
  ) : null

  return (
    <div ref={shellRef} className="h-full min-h-0" data-testid="plot-canvas-workbench">
      <PlotCanvasShell
        sidebarCollapsed={sidebarCollapsed}
        onSidebarExpand={() => setSidebarCollapsed(false)}
        sidebar={
          <PlotCanvasSidebar
            activeTab={sidebarTab}
            onTabChange={setSidebarTab}
            canvases={sidebarEntries}
            totalCount={sidebarTab === 'plot' ? canvases.length : 0}
            searchValue={sidebarSearch}
            onSearchChange={setSidebarSearch}
            selectedCanvasId={activeCanvasId}
            onSelectCanvas={setActiveCanvasId}
            onCreateCanvas={openCreateDialog}
            createDisabled={sidebarTab !== 'plot'}
            onCollapse={() => setSidebarCollapsed(true)}
            itemActions={sidebarItemActions}
            emptyStateNode={sidebarTab === 'chapter' ? (
              <div className="plot-canvas-sidebar__empty" data-testid="plot-canvas-sidebar-chapter-note">
                <span className="plot-canvas-sidebar__empty-icon" aria-hidden="true">📖</span>
                <span>
                  {text(
                    '章节结构在「章节蓝图」与章节画布中维护；此目录管理跨章节剧情画布。',
                    'Chapter structure lives in chapter blueprints and chapter canvases; this panel manages cross-chapter plot canvases.',
                  )}
                </span>
              </div>
            ) : undefined}
          />
        }
        topbar={
          <>
            <PlotCanvasTopbar
              canvasName={activeCanvas?.name ?? null}
              breadcrumb={breadcrumb.map(crumb => ({ id: crumb.id, name: crumb.name }))}
              onBreadcrumbSelect={setActiveCanvasId}
              onOpenCanvasSelector={() => setPickerOpen(previous => !previous)}
              addEventLabel={text('新增剧情事件', 'Add plot event')}
              onAddEvent={addNodeAtCenter}
              addEventDisabled={!activeCanvas}
              searchActive={filterBarOpen}
              onToggleSearch={() => setFilterBarOpen(previous => !previous)}
              searchDisabled={!activeCanvas}
              filtersActive={filterBarOpen}
              onOpenFilters={() => setFilterBarOpen(previous => !previous)}
              filtersDisabled={!activeCanvas}
              infoActive={infoOpen}
              onOpenInfo={() => setInfoOpen(previous => !previous)}
              infoDisabled={!activeCanvas}
              extraActions={
                <button
                  type="button"
                  className={`plot-shell__icon-btn${showProjection ? ' is-active' : ''}`}
                  onClick={() => setShowProjection(previous => !previous)}
                  disabled={!activeCanvas}
                  title={text('对照层：把蓝图/定稿投影画成只读幽灵节点', 'Overlay the read-only blueprint/finalized projection as ghost nodes')}
                  aria-pressed={showProjection}
                  data-testid="plot-canvas-projection-toggle"
                >
                  {showProjection ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              }
            />
            {pickerOpen && (
              <div className="plot-shell__picker-menu" ref={pickerMenuRef} data-testid="plot-canvas-picker-menu">
                {canvases.length === 0 ? (
                  <p className="plot-shell__picker-menu-empty">{text('暂无剧情画布', 'No plot canvases yet')}</p>
                ) : (
                  canvases.map(canvas => {
                    const level = levelOf(canvas)
                    return (
                      <button
                        key={canvas.id}
                        type="button"
                        className={`plot-shell__picker-menu-item${canvas.id === activeCanvasId ? ' is-selected' : ''}`}
                        style={{ paddingLeft: 9 + level * 14 }}
                        onClick={() => { setActiveCanvasId(canvas.id); setPickerOpen(false) }}
                      >
                        <span className="plot-shell__picker-menu-item-title">{canvas.name}</span>
                      </button>
                    )
                  })
                )}
              </div>
            )}
            {filterBarOpen && activeCanvas && (
              <div className="plot-shell__filter-float" ref={filterBarRef} data-testid="plot-canvas-filter-bar">
                <PlotGraphFilter
                  filter={filter}
                  onFilterChange={setFilter}
                  kindCounts={filterResult.kindCounts}
                  matchCount={filterResult.matchCount}
                  currentMatchIndex={matchIndex >= 0 ? matchIndex + 1 : 0}
                  onPrevMatch={() => focusMatch(matchIndex - 1)}
                  onNextMatch={() => focusMatch(matchIndex + 1)}
                />
              </div>
            )}
            {(persist.pendingCount > 0 || (showProjection && (projectionStale || !projection))) && (
              <div className="plot-shell__float-stack" style={{ top: floatStackTop }}>
                {persist.pendingCount > 0 && (
                  <div className="plot-shell__unsaved-float" role="status" data-testid="canvas-unsaved-banner">
                    <span>{text(
                      `${persist.pendingCount} 项更改未保存${persist.lastError ? `（${persist.lastError}）` : ''}`,
                      `${persist.pendingCount} unsaved change(s)${persist.lastError ? ` (${persist.lastError})` : ''}`,
                    )}</span>
                    <button type="button" onClick={persist.retry}>{text('重试保存', 'Retry save')}</button>
                  </div>
                )}
                {showProjection && projectionStale && (
                  <p className="plot-shell__notice-pill" data-variant="warning" role="status">
                    {text('蓝图或定稿已更新，对照层显示的是旧投影；可回到「章节脉络图」重建。', 'Blueprints or finalized drafts changed; the overlay shows the previous projection. Rebuild it in the Thread graph view.')}
                  </p>
                )}
                {showProjection && !projection && (
                  <p className="plot-shell__notice-pill" role="status">
                    {text('尚未生成剧情树投影；可回到「章节脉络图」先生成，再回到这里对照。', 'No projection built yet; build it in the Thread graph view first, then come back to compare.')}
                  </p>
                )}
              </div>
            )}
            {activeCanvas && selectedNodeIds.length >= 2 && (
              <button
                type="button"
                className="plot-shell__merge-float"
                data-testid="plot-canvas-merge-selected"
                onClick={() => setMergeDialog({
                  title: graph?.nodes.find(node => node.id === selectedNodeIds[0])?.title ?? '',
                  summary: selectedNodeIds
                    .map(id => graph?.nodes.find(node => node.id === id)?.summary ?? '')
                    .filter(Boolean)
                    .join('\n\n'),
                })}
              >
                {text(`合并所选（${selectedNodeIds.length}）`, `Merge selected (${selectedNodeIds.length})`)}
              </button>
            )}
          </>
        }
        toolRail={
          <PlotGraphToolbar
            interactionMode={interactionMode}
            onInteractionModeChange={setInteractionMode}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid(previous => !previous)}
            onFitView={fitView}
            onZoomIn={() => flowRef.current?.zoomIn({ duration: 200 })}
            onZoomOut={() => flowRef.current?.zoomOut({ duration: 200 })}
            onFocusSearch={() => setFilterBarOpen(true)}
            enableShortcuts
            shortcutScopeRef={shellRef}
          />
        }
        canvas={
          activeCanvas ? (
            <div className="canvas-workbench__flow" style={{ height: '100%' }} data-testid="plot-canvas-flow">
              <ReactFlow<FlowNode, FlowEdge>
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={{
                  'plot-graph-card': PlotGraphCardNode,
                  'plot-projection-ghost': PlotProjectionGhostNodeViewMemo,
                }}
                edgeTypes={{ 'canvas-labeled': CanvasLabeledEdgeViewMemo }}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onMoveEnd={onMoveEnd}
                onInit={instance => { flowRef.current = instance }}
                panOnDrag={interactionMode === 'pan'}
                selectionOnDrag={interactionMode === 'select'}
                onSelectionChange={handleSelectionChange}
                onNodeDoubleClick={(_, node) => {
                  const found = graph?.nodes.find(item => item.id === node.id)
                  if (found) setDetail(detailFromNode(found))
                }}
                minZoom={0.2}
                maxZoom={2}
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
              >
                {showGrid && (
                  <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--color-border)" />
                )}
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </div>
          ) : null
        }
        emptyOverlay={
          !activeCanvas ? (
            <PlotCanvasEmptyState mode="no-canvas" onCreateCanvas={openCreateDialog} />
          ) : graph && !hasNodes ? (
            <PlotCanvasEmptyState mode="empty-canvas" onAddEvent={addNodeAtCenter} />
          ) : null
        }
        rightPanel={rightPanel}
      />

      {/* 新建 / 重命名画布对话框（标题必填，描述选填并持久化） */}
      <CreatePlotCanvasDialog
        open={canvasDialog !== null}
        onOpenChange={open => { if (!open) setCanvasDialog(null) }}
        initialTitle={canvasDialog?.mode === 'rename' ? canvasDialog.canvas.name : ''}
        initialDescription={canvasDialog?.mode === 'rename' ? canvasDialog.canvas.description : ''}
        heading={canvasDialog?.mode === 'rename' ? text('重命名剧情画布', 'Rename plot canvas') : undefined}
        submitLabel={canvasDialog?.mode === 'rename' ? text('保存', 'Save') : undefined}
        submitting={canvasDialogBusy}
        onSubmit={values => {
          if (canvasDialog?.mode === 'create') void createCanvas(values, canvasDialog.parentCanvasId)
          if (canvasDialog?.mode === 'rename') void renameCanvas(canvasDialog.canvas, values)
        }}
      />

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
              '所选节点将合并为一个新节点：种类、标签与实体引用取并集，章节引用取并集，外部连线按原方向改接，源节点删除。',
              'Selected nodes merge into one new node: kind, tags, entity refs and chapter refs are unioned, external connections re-attached, sources removed.',
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

function openDraftRef(ref: PlotCanvasNodeEntityRef): void {
  if (ref.entityType !== 'draft') return
  const text = useLocaleStore.getState().text
  void openChapterFile(`vela://draft/${ref.entityId}`, text(`正文草稿 #${ref.entityId}`, `Draft #${ref.entityId}`))
}
