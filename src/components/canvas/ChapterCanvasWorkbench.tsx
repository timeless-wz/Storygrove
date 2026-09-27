/**
 * ChapterCanvasWorkbench — 每章一张的章内场景编排画布。
 *
 * 交互语义移植自参考项目的 ChapterBuilderCanvas（编译产物
 * WorldStudio-D4YQGBkX.js 的章节画布部分）：
 * - 场景卡按 `order` 组成主线；主线连线由渲染层按顺序自动绘制，**不持久化**，
 *   场景↔场景的用户连线被禁止（与参考项目一致，顺序与连线互相独立）；
 * - 角色 / 伏笔 / 灵感 / 片段是辅助节点（虚线卡片），带标签的次要连线负责关系；
 * - 删除画布卡只删画布数据，绝不删除角色名单、伏笔记录、蓝图或正文；
 * - 「写本章正文」走既有草稿打开链路（onOpenDraft → handleOpenOrNewDraft），
 *   不接参考项目的远程“生成正文”任务。
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
  Flag,
  Lightbulb,
  Maximize2,
  PenLine,
  Plus,
  Scissors,
  Trash2,
  User,
  X,
} from 'lucide-react'

import type { DatabaseChannels } from '../../shared/ipc-channels'
import {
  chapterCanvasId,
  createChapterCanvasEdgeId,
  createChapterCanvasNodeId,
  CHAPTER_CANVAS_NODE_TYPE_LABELS,
  CHAPTER_CANVAS_SCENE_ROLES,
  type ChapterCanvasEdgeData,
  type ChapterCanvasMeta,
  type ChapterCanvasNodeData,
} from '../../shared/chapter-canvas'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
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
  ChapterAuxCardNode,
  ChapterAuxCardNodeData,
  ChapterAuxCardNodeViewMemo,
  ChapterSceneCardNode,
  ChapterSceneCardNodeData,
  ChapterSceneCardNodeViewMemo,
} from './CanvasVisuals'
import './canvas-workbench.css'

type ForeshadowingRecord = DatabaseChannels['db:foreshadowing-list']['return'][number]

const SPINE_START_X = 100
const SPINE_GAP_X = 460
const SPINE_Y = 300

const ROLE_LABELS: Record<string, [string, string]> = {
  建置: ['建置', 'Setup'],
  铺垫: ['铺垫', 'Foreshadowing'],
  发展: ['发展', 'Development'],
  冲突: ['冲突', 'Conflict'],
  高潮: ['高潮', 'Climax'],
  转折: ['转折', 'Turning point'],
  收尾: ['收尾', 'Resolution'],
}

interface ChapterCanvasWorkbenchProps {
  projectKey: string
  chapterNumber: number
  chapterTitle: string
  /** 能否打开本章正文（已有草稿，或是当前可写的下一章）。 */
  canOpenDraft: boolean
  openDraftLabel: string
  /** 打开 / 新建本章正文：必须复用 ChapterCardEditor 的真实草稿链路。 */
  onOpenDraft: () => void
}

type FlowNode = ChapterSceneCardNode | ChapterAuxCardNode
type FlowEdge = CanvasLabeledEdge

/** 章节画布可能尚未落行（canvas 为 null），此时节点与边都是空集。 */
type ChapterCanvasState = {
  canvas: ChapterCanvasMeta | null
  nodes: ChapterCanvasNodeData[]
  edges: ChapterCanvasEdgeData[]
}

type DetailState =
  | { kind: 'scene'; id: string; title: string; summary: string; role: string; order: number | null }
  | { kind: 'aux'; id: string; title: string; summary: string }

export default function ChapterCanvasWorkbench({
  projectKey,
  chapterNumber,
  chapterTitle,
  canOpenDraft,
  openDraftLabel,
  onOpenDraft,
}: ChapterCanvasWorkbenchProps) {
  const text = useLocaleStore(s => s.text)
  const persist = useCanvasPersistence()

  const [graph, setGraph] = useState<ChapterCanvasState | null>(null)
  const [rosterNames, setRosterNames] = useState<string[]>([])
  const [foreshadowings, setForeshadowings] = useState<ForeshadowingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)

  const [createDialog, setCreateDialog] = useState<
    | { type: 'scene' }
    | { type: 'character'; name: string }
    | { type: 'foreshadow'; record: ForeshadowingRecord }
    | { type: 'idea' | 'snippet' }
    | null
  >(null)
  const [createTitle, setCreateTitle] = useState('')
  const [createSummary, setCreateSummary] = useState('')
  const [createRole, setCreateRole] = useState<string>('发展')
  const [detail, setDetail] = useState<DetailState | null>(null)

  const graphRef = useRef<ChapterCanvasState | null>(null)
  const appliedViewportRef = useRef(false)
  useEffect(() => { graphRef.current = graph }, [graph])

  /** 节点数据里的回调经 ref 转发，保证重建 effect 的依赖稳定（见下方赋值）。 */
  const actionsRef = useRef<{ deleteNode: (nodeId: string) => void }>({ deleteNode: () => {} })

  // ===== 数据加载 =====

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setLoadError('')
      appliedViewportRef.current = false
      try {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return
        const [nextGraph, roster, shadows] = await Promise.all([
          ipc.invokeWithProjectSession(session, 'db:chapter-canvas-get', chapterNumber, projectKey),
          ipc.invokeWithProjectSession(session, 'db:character-roster-read', projectKey),
          ipc.invokeWithProjectSession(session, 'db:foreshadowing-list', 'all' as const, projectKey),
        ])
        if (!isProjectSessionCurrent(session) || cancelled) return
        setGraph({ canvas: nextGraph.canvas, nodes: nextGraph.nodes, edges: nextGraph.edges })
        setRosterNames(roster.entries.map(entry => entry.name))
        setForeshadowings(shadows)
        setLoading(false)
      } catch (error) {
        if (!cancelled) {
          setLoading(false)
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
    return () => { cancelled = true }
  }, [chapterNumber, projectKey])

  // ===== 持久化 =====

  const persistNode = useCallback((node: ChapterCanvasNodeData) => {
    persist.schedule({
      key: `node-upsert:${node.id}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(session, 'db:chapter-canvas-node-upsert', {
            id: node.id,
            chapterNumber,
            type: node.type,
            title: node.title,
            summary: node.summary,
            colorKey: node.colorKey,
            role: node.role,
            order: node.order,
            refs: node.refs,
            x: Math.round(node.x),
            y: Math.round(node.y),
          }, projectKey)
          return result.success
        })()
      },
    })
  }, [chapterNumber, persist, projectKey])

  const persistEdge = useCallback((edge: ChapterCanvasEdgeData) => {
    persist.schedule({
      key: `edge-upsert:${edge.id}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(session, 'db:chapter-canvas-edge-upsert', {
            id: edge.id,
            chapterNumber,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            label: edge.label,
            kind: edge.kind,
          }, projectKey)
          return result.success
        })()
      },
    })
  }, [chapterNumber, persist, projectKey])

  const deleteNodeById = useCallback(async (nodeId: string) => {
    const current = graphRef.current
    if (!current) return
    const node = current.nodes.find(item => item.id === nodeId)
    if (!node) return
    const ok = await confirm(node.type === 'scene'
      ? text('删除这张场景卡？蓝图与正文不受影响；主线顺序自动收缩。', 'Delete this scene card? The blueprint and prose are untouched; the spine re-orders automatically.')
      : text('删除这个辅助节点？角色名单、伏笔记录等原资料不受影响。', 'Delete this auxiliary node? The character roster and foreshadowing records are untouched.'), {
      title: text('删除画布节点', 'Delete canvas node'),
      confirmText: text('删除', 'Delete'),
      danger: true,
    })
    if (!ok) return
    setGraph(previous => previous ? {
      ...previous,
      nodes: previous.nodes.filter(item => item.id !== nodeId),
      edges: previous.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    } : previous)
    setDetail(previous => previous?.id === nodeId ? null : previous)
    setSelectedNodeId(previous => previous === nodeId ? null : previous)
    persist.schedule({
      key: `node-delete:${nodeId}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(
            session, 'db:chapter-canvas-node-delete', chapterNumber, nodeId, projectKey,
          )
          return result.success
        })()
      },
    })
  }, [chapterNumber, persist, projectKey, text])

  const deleteEdgeById = useCallback(async (edgeId: string) => {
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
    setDetail(previous => previous?.id === edgeId ? null : previous)
    setSelectedEdgeId(previous => previous === edgeId ? null : previous)
    persist.schedule({
      key: `edge-delete:${edgeId}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(
            session, 'db:chapter-canvas-edge-delete', chapterNumber, edgeId, projectKey,
          )
          return result.success
        })()
      },
    })
  }, [chapterNumber, persist, projectKey, text])

  // ref 只能在 effect 中赋值；节点数据回调经 ref 转发，重建 effect 依赖保持稳定。
  useEffect(() => {
    actionsRef.current = { deleteNode: nodeId => { void deleteNodeById(nodeId) } }
  }, [deleteNodeById])

  // ===== 场景排序（主线） =====

  const orderedScenes = useMemo(() => {
    const scenes = (graph?.nodes ?? []).filter(node => node.type === 'scene')
    return [...scenes].sort((a, b) => {
      const left = a.order ?? Number.MAX_SAFE_INTEGER
      const right = b.order ?? Number.MAX_SAFE_INTEGER
      return left !== right ? left - right : a.x - b.x
    })
  }, [graph])

  const nextSceneSlot = useMemo(() => ({
    x: SPINE_START_X + orderedScenes.length * SPINE_GAP_X,
    y: SPINE_Y,
  }), [orderedScenes.length])

  const createScene = async () => {
    const title = createTitle.trim() || text('新场景', 'New scene')
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const node: ChapterCanvasNodeData = {
      id: createChapterCanvasNodeId(),
      canvasId: chapterCanvasId(chapterNumber),
      type: 'scene',
      title,
      summary: createSummary.trim(),
      colorKey: 'default',
      role: createRole,
      order: orderedScenes.length + 1,
      refs: {},
      x: nextSceneSlot.x,
      y: nextSceneSlot.y,
    }
    setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, node] } : previous)
    persistNode(node)
    setCreateDialog(null)
    setCreateTitle('')
    setCreateSummary('')
  }

  const createAuxNode = async () => {
    if (!createDialog || createDialog.type === 'scene') return
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const type = createDialog.type
    const refs: ChapterCanvasNodeData['refs'] = {}
    let title = createTitle.trim()
    if (type === 'character') {
      refs.characterName = createDialog.name
      title = title || createDialog.name
    } else if (type === 'foreshadow') {
      refs.foreshadowingId = createDialog.record.id
      title = title || createDialog.record.note || createDialog.record.selectedText.slice(0, 30)
    }
    const viewport = flowRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 }
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom
    const node: ChapterCanvasNodeData = {
      id: createChapterCanvasNodeId(),
      canvasId: chapterCanvasId(chapterNumber),
      type,
      title,
      summary: createSummary.trim(),
      colorKey: 'default',
      role: '',
      order: null,
      refs,
      x: Math.round(centerX - 100 + (graphRef.current?.nodes.length ?? 0) % 5 * 28),
      y: Math.round(centerY - 60 + (graphRef.current?.nodes.length ?? 0) % 5 * 28),
    }
    setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, node] } : previous)
    persistNode(node)
    setCreateDialog(null)
    setCreateTitle('')
    setCreateSummary('')
  }

  // ===== 画布交互 =====

  const onConnect = useCallback((connection: Connection) => {
    const current = graphRef.current
    if (!current || !connection.source || !connection.target || connection.source === connection.target) return
    const source = current.nodes.find(node => node.id === connection.source)
    const target = current.nodes.find(node => node.id === connection.target)
    if (!source || !target) return
    // 参考项目规则：场景↔场景连线被禁止，主线顺序由 scene_order 表达。
    if (source.type === 'scene' && target.type === 'scene') {
      toast.warning(text('场景之间不需要连线：修改场景的「顺序」即可排列主线。', 'Scene-to-scene connections are not needed: edit the scene order to arrange the spine.'))
      return
    }
    const edge: ChapterCanvasEdgeData = {
      id: createChapterCanvasEdgeId(),
      canvasId: chapterCanvasId(chapterNumber),
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
      label: '',
      kind: 'aux',
    }
    setGraph(previous => previous ? { ...previous, edges: [...previous.edges, edge] } : previous)
    persistEdge(edge)
  }, [chapterNumber, persistEdge, text])

  const onNodeDragStop = useCallback(() => {
    const current = graphRef.current
    if (!current) return
    persist.schedule({
      key: `reposition:${chapterCanvasId(chapterNumber)}`,
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
            session, 'db:chapter-canvas-nodes-reposition', chapterNumber, positions, projectKey,
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
  }, [chapterNumber, persist, projectKey])

  const onMoveEnd = useCallback(() => {
    if (!appliedViewportRef.current) return
    const viewport = flowRef.current?.getViewport()
    if (!viewport) return
    persist.schedule({
      key: `viewport:${chapterCanvasId(chapterNumber)}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
          const result = await ipc.invokeWithProjectSession(
            session, 'db:chapter-canvas-viewport-save', chapterNumber, viewport, projectKey,
          )
          return result.success
        })()
      },
    })
  }, [chapterNumber, persist, projectKey])

  // ===== Flow 模型 =====

  const rosterSet = useMemo(() => new Set(rosterNames), [rosterNames])
  const foreshadowById = useMemo(
    () => new Map(foreshadowings.map(record => [record.id, record])),
    [foreshadowings],
  )

  useEffect(() => {
    if (!graph) {
      setNodes([])
      setEdges([])
      return
    }
    const query = search.trim().toLowerCase()
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
    // 选中态由 React Flow 内部管理，这里绝不回写 selected（会形成选择上报
    // 与派生重建互相触发的死循环）。
    setNodes(graph.nodes.map(node => {
      const haystack = `${node.title}\n${node.summary}`.toLowerCase()
      const searchHit = query.length > 0 && haystack.includes(query)
      const dimmed = query.length > 0 && !searchHit
      if (node.type === 'scene') {
        const data: ChapterSceneCardNodeData = {
          title: node.title,
          summary: node.summary,
          role: node.role,
          roleLabel: node.role ? text(...(ROLE_LABELS[node.role] ?? [node.role, node.role])) : '',
          order: node.order,
          wordLabel: '',
          dimmed,
          searchHit,
          onDelete: id => actionsRef.current.deleteNode(id),
        }
        return { id: node.id, type: 'chapter-scene-card' as const, position: { x: node.x, y: node.y }, data }
      }
      let refLabel: string | null = null
      let refBroken = false
      if (node.refs.characterName) {
        refLabel = node.refs.characterName
        refBroken = !rosterSet.has(node.refs.characterName)
      } else if (node.refs.foreshadowingId) {
        const record = foreshadowById.get(node.refs.foreshadowingId)
        refLabel = record ? (record.note || record.selectedText.slice(0, 24)) : null
        refBroken = !record
      } else {
        refLabel = text(CHAPTER_CANVAS_NODE_TYPE_LABELS[node.type].zh, CHAPTER_CANVAS_NODE_TYPE_LABELS[node.type].en)
      }
      const data: ChapterAuxCardNodeData = {
        auxType: node.type,
        title: node.title,
        summary: node.summary,
        refLabel,
        refBroken,
        dimmed,
        searchHit,
        onDelete: id => actionsRef.current.deleteNode(id),
      }
      return { id: node.id, type: 'chapter-aux-card' as const, position: { x: node.x, y: node.y }, data }
    }))
    // 主线 spine：按顺序自动生成，不持久化（参考项目 SaveLayout 剔除 spine 边）。
    const spineEdges: FlowEdge[] = []
    orderedScenes.forEach((scene, index) => {
      const next = orderedScenes[index + 1]
      if (!next) return
      spineEdges.push({
        id: `spine-${scene.id}-${next.id}`,
        source: scene.id,
        target: next.id,
        type: 'canvas-labeled',
        selectable: false,
        data: { label: '', kind: 'main', dimmed: false },
      })
    })
    const userEdges: FlowEdge[] = graph.edges.map(edge => {
      const source = nodeById.get(edge.sourceNodeId)
      const target = nodeById.get(edge.targetNodeId)
      const endpointHit = (node: ChapterCanvasNodeData | undefined) => node
        && query.length > 0
        && `${node.title}\n${node.summary}`.toLowerCase().includes(query)
      return {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        type: 'canvas-labeled',
        data: {
          label: edge.label,
          kind: edge.kind,
          dimmed: query.length > 0 && !(endpointHit(source) || endpointHit(target)),
        },
      }
    })
    setEdges([...spineEdges, ...userEdges])
  }, [graph, search, orderedScenes, rosterSet, foreshadowById, text, setNodes, setEdges])

  // 进入画布时应用已保存视口；没有则适应全部节点（等 RF 测量完成后再适应，
  // 否则按 0 尺寸计算的边界会裁掉边缘节点）。
  useEffect(() => {
    if (!graph || appliedViewportRef.current) return
    if (!graph.canvas) return
    appliedViewportRef.current = true
    if (graph.canvas.viewport) {
      flowRef.current?.setViewport(graph.canvas.viewport, { duration: 0 })
      return
    }
    const timer = window.setTimeout(() => {
      flowRef.current?.fitView({ padding: 0.2, maxZoom: 1.1, duration: 0 })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [graph])

  // ===== 详情面板 =====

  const selectedNode = graph?.nodes.find(node => node.id === selectedNodeId) ?? null
  const selectedEdge = graph?.edges.find(edge => edge.id === selectedEdgeId) ?? null

  const patchSelectedNode = useCallback((patch: Partial<ChapterCanvasNodeData>) => {
    const current = graphRef.current
    if (!current) return
    const existing = current.nodes.find(node => node.id === patch.id)
    if (!existing) return
    const next: ChapterCanvasNodeData = { ...existing, ...patch, id: existing.id }
    setGraph(previous => previous ? {
      ...previous,
      nodes: previous.nodes.map(node => node.id === next.id ? next : node),
    } : previous)
    persistNode(next)
  }, [persistNode])

  const detailSave = () => {
    if (!detail) return
    if (detail.kind === 'scene') {
      patchSelectedNode({
        id: detail.id,
        title: detail.title.trim() || text('新场景', 'New scene'),
        summary: detail.summary.trim(),
        role: detail.role,
        order: detail.order !== null && detail.order >= 1 ? detail.order : null,
      })
      setDetail(previous => previous?.kind === 'scene'
        ? { ...previous, title: detail.title.trim() || previous.title, summary: detail.summary.trim() }
        : previous)
      return
    }
    patchSelectedNode({
      id: detail.id,
      title: detail.title.trim() || text('未命名', 'Untitled'),
      summary: detail.summary.trim(),
    })
    setDetail(previous => previous?.kind === 'aux'
      ? { ...previous, title: detail.title.trim() || previous.title, summary: detail.summary.trim() }
      : previous)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {text('加载章节画布…', 'Loading chapter canvas…')}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm" style={{ color: 'var(--color-error-text)' }}>
        <span>{loadError}</span>
        <Button variant="outline" size="sm" onClick={() => setLoadError('')}>{text('重试', 'Retry')}</Button>
      </div>
    )
  }

  const sceneCount = orderedScenes.length
  const auxCount = (graph?.nodes.length ?? 0) - sceneCount

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chapter-canvas-workbench">
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
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
          {text(`第 ${chapterNumber} 章 · ${chapterTitle || text('未命名', 'Untitled')}`, `Chapter ${chapterNumber} · ${chapterTitle || text('Untitled', 'Untitled')}`)}
        </span>
        <span className="canvas-toolbar__meta">
          {text(`${sceneCount} 个场景 · ${auxCount} 个辅助节点`, `${sceneCount} scenes · ${auxCount} aux nodes`)}
        </span>
        <span className="canvas-toolbar__spacer" />
        <Button variant="outline" size="sm" onClick={() => { setCreateTitle(''); setCreateSummary(''); setCreateRole('发展'); setCreateDialog({ type: 'scene' }) }} data-testid="chapter-canvas-add-scene">
          <Plus size={12} />{text('新增场景', 'Add scene')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={rosterNames.length === 0}
          title={rosterNames.length === 0 ? text('角色名单为空，先在角色档案建档。', 'The character roster is empty; create characters first.') : undefined}
          onClick={() => { setCreateTitle(''); setCreateSummary(''); setCreateDialog({ type: 'character', name: rosterNames[0] ?? '' }) }}
        >
          <User size={12} />{text('角色', 'Character')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={foreshadowings.length === 0}
          title={foreshadowings.length === 0 ? text('暂无伏笔记录，先在正文或伏笔管理中标注。', 'No foreshadowing records yet; mark them in the draft first.') : undefined}
          onClick={() => { setCreateTitle(''); setCreateSummary(''); setCreateDialog({ type: 'foreshadow', record: foreshadowings[0] }) }}
        >
          <Flag size={12} />{text('伏笔', 'Foreshadowing')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setCreateTitle(''); setCreateSummary(''); setCreateDialog({ type: 'idea' }) }}>
          <Lightbulb size={12} />{text('灵感', 'Idea')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setCreateTitle(''); setCreateSummary(''); setCreateDialog({ type: 'snippet' }) }}>
          <Scissors size={12} />{text('片段', 'Snippet')}
        </Button>
        {canOpenDraft && (
          <Button variant="default" size="sm" onClick={onOpenDraft} data-testid="chapter-canvas-open-draft">
            <PenLine size={12} />{openDraftLabel}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => flowRef.current?.fitView({ padding: 0.2, duration: 300, maxZoom: 1.1 })} title={text('适应视图', 'Fit view')}>
          <Maximize2 size={12} />
        </Button>
      </div>
      <div className="px-3 py-2" style={{ background: 'var(--color-panel)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="max-w-md">
          <Input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={text('搜索画布节点（标题或摘要）…', 'Search canvas nodes (title or summary)…')}
            aria-label={text('搜索画布节点', 'Search canvas nodes')}
          />
        </div>
      </div>
      <div className="canvas-workbench__flow" data-testid="chapter-canvas-flow">
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={{
            'chapter-scene-card': ChapterSceneCardNodeViewMemo,
            'chapter-aux-card': ChapterAuxCardNodeViewMemo,
          }}
          edgeTypes={{ 'canvas-labeled': CanvasLabeledEdgeViewMemo }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={onMoveEnd}
          onInit={instance => { flowRef.current = instance }}
          onSelectionChange={selection => {
            setSelectedNodeId(selection.nodes[0]?.id ?? null)
            setSelectedEdgeId(selection.edges[0]?.id ?? null)
            const firstNode = selection.nodes[0]
            const node = firstNode ? graph?.nodes.find(item => item.id === firstNode.id) : null
            if (node?.type === 'scene') {
              setDetail({ kind: 'scene', id: node.id, title: node.title, summary: node.summary, role: node.role, order: node.order })
            } else if (node) {
              setDetail({ kind: 'aux', id: node.id, title: node.title, summary: node.summary })
            }
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

      {/* 节点 / 连线详情 */}
      {(selectedNode || selectedEdge) && (
        <aside className="canvas-detail" data-testid="chapter-canvas-detail">
          <div className="canvas-detail__header">
            <span className="canvas-detail__title">
              {selectedNode
                ? (() => {
                    const labels = CHAPTER_CANVAS_NODE_TYPE_LABELS[selectedNode.type]
                    return text(labels.zh, labels.en)
                  })()
                : text('连线详情', 'Connection details')}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null) }} aria-label={text('关闭详情', 'Close details')}>
              <X size={12} />
            </Button>
          </div>
          <div className="canvas-detail__body">
            {selectedNode?.type === 'scene' && (
              <>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-node-title">{text('场景标题', 'Scene title')}</Label>
                  <Input
                    id="chapter-node-title"
                    value={detail?.kind === 'scene' && detail.id === selectedNode.id ? detail.title : selectedNode.title}
                    onChange={event => setDetail(previous => previous?.kind === 'scene' && previous.id === selectedNode.id
                      ? { ...previous, title: event.target.value }
                      : { kind: 'scene', id: selectedNode.id, title: event.target.value, summary: selectedNode.summary, role: selectedNode.role, order: selectedNode.order })}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-node-summary">{text('场景要点', 'Scene beats')}</Label>
                  <Textarea
                    id="chapter-node-summary"
                    rows={5}
                    value={detail?.kind === 'scene' && detail.id === selectedNode.id ? detail.summary : selectedNode.summary}
                    onChange={event => setDetail(previous => previous?.kind === 'scene' && previous.id === selectedNode.id
                      ? { ...previous, summary: event.target.value }
                      : { kind: 'scene', id: selectedNode.id, title: selectedNode.title, summary: event.target.value, role: selectedNode.role, order: selectedNode.order })}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-node-role">{text('场景定位', 'Scene role')}</Label>
                  <NativeSelect
                    id="chapter-node-role"
                    value={selectedNode.role}
                    onChange={event => patchSelectedNode({ id: selectedNode.id, role: event.target.value })}
                  >
                    <option value="">{text('未设定', 'Unset')}</option>
                    {CHAPTER_CANVAS_SCENE_ROLES.map(role => (
                      <option key={role} value={role}>{text(...(ROLE_LABELS[role] ?? [role, role]))}</option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-node-order">{text('主线顺序（1 起，留空则排最后）', 'Spine order (1-based; empty = last)')}</Label>
                  <Input
                    id="chapter-node-order"
                    type="number"
                    min={1}
                    value={selectedNode.order ?? ''}
                    onChange={event => patchSelectedNode({
                      id: selectedNode.id,
                      order: event.target.value === '' ? null : Math.max(1, Number(event.target.value) || 1),
                    })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={detailSave}>{text('保存修改', 'Save changes')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteNodeById(selectedNode.id)}>
                    <Trash2 size={12} />{text('删除场景卡', 'Delete scene card')}
                  </Button>
                </div>
              </>
            )}
            {selectedNode && selectedNode.type !== 'scene' && (
              <>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-node-title">{text('标题', 'Title')}</Label>
                  <Input
                    id="chapter-node-title"
                    value={detail?.kind === 'aux' && detail.id === selectedNode.id ? detail.title : selectedNode.title}
                    onChange={event => setDetail(previous => previous?.kind === 'aux' && previous.id === selectedNode.id
                      ? { ...previous, title: event.target.value }
                      : { kind: 'aux', id: selectedNode.id, title: event.target.value, summary: selectedNode.summary })}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-node-summary">{text('内容', 'Content')}</Label>
                  <Textarea
                    id="chapter-node-summary"
                    rows={5}
                    value={detail?.kind === 'aux' && detail.id === selectedNode.id ? detail.summary : selectedNode.summary}
                    onChange={event => setDetail(previous => previous?.kind === 'aux' && previous.id === selectedNode.id
                      ? { ...previous, summary: event.target.value }
                      : { kind: 'aux', id: selectedNode.id, title: selectedNode.title, summary: event.target.value })}
                  />
                </div>
                {selectedNode.refs.characterName && (
                  <div className="canvas-detail__section">
                    <Label>{text('引用的角色', 'Referenced character')}</Label>
                    <span className="canvas-detail__text" style={rosterSet.has(selectedNode.refs.characterName) ? undefined : { color: 'var(--color-error-text)' }}>
                      {selectedNode.refs.characterName}
                      {rosterSet.has(selectedNode.refs.characterName)
                        ? ''
                        : text('（该角色已不在名单中；此卡片删除不影响角色资料）', ' (not in the roster anymore; deleting this card never touches the character)')}
                    </span>
                  </div>
                )}
                {selectedNode.refs.foreshadowingId && (
                  <div className="canvas-detail__section">
                    <Label>{text('引用的伏笔', 'Referenced foreshadowing')}</Label>
                    <span className="canvas-detail__text" style={!foreshadowById.has(selectedNode.refs.foreshadowingId) ? { color: 'var(--color-error-text)' } : undefined}>
                      {foreshadowById.get(selectedNode.refs.foreshadowingId)?.note
                        ?? foreshadowById.get(selectedNode.refs.foreshadowingId)?.selectedText
                        ?? text('（该伏笔记录已删除；此卡片删除不影响伏笔资料）', '(this foreshadowing record is gone; deleting this card never touches foreshadowing data)')}
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={detailSave}>{text('保存修改', 'Save changes')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteNodeById(selectedNode.id)}>
                    <Trash2 size={12} />{text('删除节点', 'Delete node')}
                  </Button>
                </div>
              </>
            )}
            {selectedEdge && (
              <>
                <div className="canvas-detail__section">
                  <Label htmlFor="chapter-edge-label">{text('关系标签（如：严格遵守 / 对白设计）', 'Relation label (e.g. strict rule / dialogue design)')}</Label>
                  <Input
                    id="chapter-edge-label"
                    value={selectedEdge.label}
                    onChange={event => {
                      const label = event.target.value
                      setGraph(previous => previous ? {
                        ...previous,
                        edges: previous.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, label } : edge),
                      } : previous)
                    }}
                  />
                </div>
                <div className="canvas-detail__section">
                  <Label>{text('连线种类', 'Connection kind')}</Label>
                  <NativeSelect
                    value={selectedEdge.kind}
                    onChange={event => {
                      const kind = event.target.value as 'main' | 'aux'
                      setGraph(previous => previous ? {
                        ...previous,
                        edges: previous.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, kind } : edge),
                      } : previous)
                    }}
                  >
                    <option value="main">{text('主线（实线）', 'Main (solid)')}</option>
                    <option value="aux">{text('次要（虚线）', 'Secondary (dashed)')}</option>
                  </NativeSelect>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => persistEdge(selectedEdge)}>{text('保存修改', 'Save changes')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void deleteEdgeById(selectedEdge.id)}>
                    <Trash2 size={12} />{text('删除连线', 'Delete connection')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* 新建节点对话框 */}
      <Dialog open={createDialog !== null} onOpenChange={open => { if (!open) setCreateDialog(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {createDialog?.type === 'scene' && text('新增场景', 'Add scene')}
              {createDialog?.type === 'character' && text('引用角色节点', 'Add character node')}
              {createDialog?.type === 'foreshadow' && text('引用伏笔节点', 'Add foreshadowing node')}
              {createDialog?.type === 'idea' && text('新增灵感节点', 'Add idea node')}
              {createDialog?.type === 'snippet' && text('新增片段节点', 'Add snippet node')}
            </DialogTitle>
            <DialogDescription>
              {createDialog?.type === 'scene' && text('场景卡按顺序排在主线上；顺序可随时修改。', 'Scene cards line up on the spine by order; you can change the order anytime.')}
              {createDialog?.type === 'character' && text('角色节点只引用角色名单；拖拽或删除节点不会改动角色资料。', 'A character node only references the roster; dragging or deleting it never changes character data.')}
              {createDialog?.type === 'foreshadow' && text('伏笔节点引用伏笔记录；删除节点不影响伏笔本身。', 'A foreshadowing node references a foreshadowing record; deleting the node never deletes the record.')}
              {(createDialog?.type === 'idea' || createDialog?.type === 'snippet') && text('灵感与片段是本章的随手笔记，只保存在本章画布。', 'Ideas and snippets are per-chapter notes stored on this canvas only.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-3">
            {createDialog?.type === 'character' && (
              <div>
                <Label htmlFor="chapter-create-character">{text('选择角色', 'Pick a character')}</Label>
                <NativeSelect
                  id="chapter-create-character"
                  value={createDialog.name}
                  onChange={event => setCreateDialog(previous => previous?.type === 'character' ? { ...previous, name: event.target.value } : previous)}
                >
                  {rosterNames.map(name => <option key={name} value={name}>{name}</option>)}
                </NativeSelect>
              </div>
            )}
            {createDialog?.type === 'foreshadow' && (
              <div>
                <Label htmlFor="chapter-create-foreshadow">{text('选择伏笔记录', 'Pick a foreshadowing record')}</Label>
                <NativeSelect
                  id="chapter-create-foreshadow"
                  value={createDialog.record.id}
                  onChange={event => {
                    const record = foreshadowings.find(item => item.id === event.target.value)
                    if (record) setCreateDialog({ type: 'foreshadow', record })
                  }}
                >
                  {foreshadowings.map(record => (
                    <option key={record.id} value={record.id}>
                      [{text(`第${record.chapterNumber}章`, `Ch ${record.chapterNumber}`)}] {record.note || record.selectedText.slice(0, 40)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {createDialog?.type === 'scene' && (
              <div>
                <Label htmlFor="chapter-create-role">{text('场景定位', 'Scene role')}</Label>
                <NativeSelect id="chapter-create-role" value={createRole} onChange={event => setCreateRole(event.target.value)}>
                  {CHAPTER_CANVAS_SCENE_ROLES.map(role => (
                    <option key={role} value={role}>{text(...(ROLE_LABELS[role] ?? [role, role]))}</option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div>
              <Label htmlFor="chapter-create-title">{text(
                createDialog?.type === 'scene' ? '场景标题' : '标题（可留空）',
                createDialog?.type === 'scene' ? 'Scene title' : 'Title (optional)',
              )}</Label>
              <Input
                id="chapter-create-title"
                value={createTitle}
                onChange={event => setCreateTitle(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="chapter-create-summary">{text(
                createDialog?.type === 'scene' ? '场景要点' : '内容（可留空）',
                createDialog?.type === 'scene' ? 'Scene beats' : 'Content (optional)',
              )}</Label>
              <Textarea
                id="chapter-create-summary"
                rows={4}
                value={createSummary}
                onChange={event => setCreateSummary(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialog(null)}>{text('取消', 'Cancel')}</Button>
            <Button
              onClick={() => { if (createDialog?.type === 'scene') void createScene(); else void createAuxNode() }}
              disabled={createDialog?.type === 'character' && !createDialog.name}
            >
              {text('创建', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
