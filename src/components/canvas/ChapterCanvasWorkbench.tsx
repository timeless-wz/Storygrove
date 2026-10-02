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
import {
  getBlueprintV2Scenes,
  moveBlueprintV2Scene,
  type BlueprintV2SceneItem,
  type ChapterBlueprintV2Content,
} from '../../shared/blueprint-v2'
import { ipc } from '../../services/ipc-client'
import { recordLastCreationLocation } from '../../services/last-creation-location'
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
  /** 画布侧改动了蓝图 v2 细纲（排上/移出/删除/重排）后通知蓝图页刷新。 */
  onBlueprintChanged?: () => void
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
  onBlueprintChanged,
}: ChapterCanvasWorkbenchProps) {
  const text = useLocaleStore(s => s.text)
  const persist = useCanvasPersistence()

  const [graph, setGraph] = useState<ChapterCanvasState | null>(null)
  const [rosterNames, setRosterNames] = useState<string[]>([])
  const [foreshadowings, setForeshadowings] = useState<ForeshadowingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  // 蓝图 v2 细纲（同章分镜的内容权威，契约 §2/§8）：画布只编排，不持有正文。
  const [blueprint, setBlueprint] = useState<{ content: ChapterBlueprintV2Content; revision: number } | null>(null)
  const [placeDialogOpen, setPlaceDialogOpen] = useState(false)

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
      setBlueprint(null)
      try {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return
        const [nextGraph, roster, shadows, detail] = await Promise.all([
          ipc.invokeWithProjectSession(session, 'db:chapter-canvas-get', chapterNumber, projectKey),
          ipc.invokeWithProjectSession(session, 'db:character-roster-read', projectKey),
          ipc.invokeWithProjectSession(session, 'db:foreshadowing-list', 'all' as const, projectKey),
          ipc.invokeWithProjectSession(session, 'db:blueprint-v2-get', chapterNumber, projectKey),
        ])
        if (!isProjectSessionCurrent(session) || cancelled) return
        setGraph({ canvas: nextGraph.canvas, nodes: nextGraph.nodes, edges: nextGraph.edges })
        setRosterNames(roster.entries.map(entry => entry.name))
        setForeshadowings(shadows)
        // 损坏 / schema 超前的细纲不参与编排；相关场景卡按悬空引用渲染。
        if (detail && detail.readStatus === undefined) {
          setBlueprint({
            content: {
              schemaVersion: detail.schemaVersion,
              chapterNumber: detail.chapterNumber,
              chapterTitle: detail.chapterTitle,
              ...(detail.chapterTitleLevel === undefined ? {} : { chapterTitleLevel: detail.chapterTitleLevel }),
              docPreamble: detail.docPreamble,
              ...(detail.chapterPostamble === undefined ? {} : { chapterPostamble: detail.chapterPostamble }),
              sections: detail.sections,
              origin: detail.origin,
            },
            revision: detail.revision,
          })
        }
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
          if (result.success) {
            // 真实保存完成 → 记录“上次创作位置”（只写导航辅助，不动权威数据）。
            recordLastCreationLocation(projectKey, {
              kind: 'chapter-canvas',
              chapterNumber,
              title: chapterTitle,
              savedAt: new Date().toISOString(),
            })
          }
          return result.success
        })()
      },
    })
  }, [chapterNumber, chapterTitle, persist, projectKey])

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
          if (result.success) {
            recordLastCreationLocation(projectKey, {
              kind: 'chapter-canvas',
              chapterNumber,
              title: chapterTitle,
              savedAt: new Date().toISOString(),
            })
          }
          return result.success
        })()
      },
    })
  }, [chapterNumber, chapterTitle, persist, projectKey])

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

  // ===== 蓝图 v2 分镜编排（blueprint-v2-contract §8） =====

  const blueprintScenes = useMemo(
    () => (blueprint ? getBlueprintV2Scenes(blueprint.content) : []),
    [blueprint],
  )
  const blueprintSceneById = useMemo(
    () => new Map(blueprintScenes.map(scene => [scene.sceneId, scene])),
    [blueprintScenes],
  )

  async function refreshBlueprint(session: ReturnType<typeof captureProjectSession>) {
    if (!session) return
    try {
      const detail = await ipc.invokeWithProjectSession(
        session, 'db:blueprint-v2-get', chapterNumber, projectKey,
      )
      if (!isProjectSessionCurrent(session)) return
      if (detail && detail.readStatus === undefined) {
        setBlueprint({
          content: {
            schemaVersion: detail.schemaVersion,
            chapterNumber: detail.chapterNumber,
            chapterTitle: detail.chapterTitle,
            ...(detail.chapterTitleLevel === undefined ? {} : { chapterTitleLevel: detail.chapterTitleLevel }),
            docPreamble: detail.docPreamble,
            ...(detail.chapterPostamble === undefined ? {} : { chapterPostamble: detail.chapterPostamble }),
            sections: detail.sections,
            origin: detail.origin,
          },
          revision: detail.revision,
        })
      } else {
        setBlueprint(null)
      }
    } catch {
      // 保留现有蓝图状态；下次进入画布会重新读取。
    }
  }

  /** 写回蓝图内容（乐观并发 §7.2）；冲突时刷新为最新，不自动重放旧顺序。 */
  const saveBlueprint = useCallback(async (
    mutate: (content: ChapterBlueprintV2Content) => ChapterBlueprintV2Content,
  ): Promise<{ success: false } | { success: true; revision: number; content: ChapterBlueprintV2Content }> => {
    if (!blueprint) return { success: false }
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return { success: false }
    const nextContent = mutate(blueprint.content)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:blueprint-v2-save', {
        chapterNumber,
        baseRevision: blueprint.revision,
        content: nextContent,
      }, projectKey)
      if (!isProjectSessionCurrent(session)) return { success: false }
      if (!result.success) {
        toast.error(result.conflict
          ? text('蓝图细纲已被其他窗口修改，画布将刷新为最新内容；请重试。', 'The outline changed elsewhere; the canvas will refresh to the latest content. Please retry.')
          : text(`保存蓝图细纲失败：${result.error ?? '未知错误'}`, `Could not save the outline: ${result.error ?? 'Unknown error'}`))
        await refreshBlueprint(session)
        onBlueprintChanged?.()
        return { success: false }
      }
      const revision = result.revision ?? blueprint.revision + 1
      setBlueprint({ content: nextContent, revision })
      onBlueprintChanged?.()
      return { success: true, revision, content: nextContent }
    } catch (error) {
      toast.error(text(
        `保存蓝图细纲失败：${error instanceof Error ? error.message : String(error)}`,
        `Could not save the outline: ${error instanceof Error ? error.message : String(error)}`,
      ))
      return { success: false }
    }
  }, [blueprint, chapterNumber, onBlueprintChanged, projectKey, text])

  const patchStoryboardScene = (
    content: ChapterBlueprintV2Content,
    sceneId: string,
    patch: (scene: BlueprintV2SceneItem) => BlueprintV2SceneItem,
  ): ChapterBlueprintV2Content => ({
    ...content,
    sections: content.sections.map(section => {
      if (!(section.kind === 'canonical' && section.id === 'storyboard')) return section
      return {
        ...section,
        items: section.items.map(item => (item.kind === 'scene' && item.id === sceneId ? patch(item) : item)),
      }
    }),
  })

  /** 排上画布（§8.2）：新建场景卡（标题快照 + refs.sceneId）+ 蓝图 presence。 */
  const placeSceneOnCanvas = useCallback(async (sceneId: string) => {
    const scene = blueprintSceneById.get(sceneId)
    if (!scene || !graphRef.current) return
    if (graphRef.current.nodes.some(node => node.refs.sceneId === sceneId)) return
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return
    const spineCount = graphRef.current.nodes.filter(node => node.type === 'scene').length
    const node: ChapterCanvasNodeData = {
      id: createChapterCanvasNodeId(),
      canvasId: chapterCanvasId(chapterNumber),
      type: 'scene',
      title: scene.title.slice(0, 160),
      summary: '',
      colorKey: 'default',
      role: '',
      order: scene.order,
      refs: { sceneId: scene.sceneId },
      x: SPINE_START_X + spineCount * SPINE_GAP_X,
      y: SPINE_Y,
    }
    const savedNode = await ipc.invokeWithProjectSession(session, 'db:chapter-canvas-node-upsert', {
      id: node.id,
      chapterNumber,
      type: node.type,
      title: node.title,
      summary: node.summary,
      colorKey: node.colorKey,
      role: node.role,
      order: node.order,
      refs: node.refs,
      x: node.x,
      y: node.y,
    }, projectKey)
    if (!isProjectSessionCurrent(session)) return
    if (!savedNode.success) {
      toast.error(text(
        `排上画布失败：${savedNode.error ?? '画布卡保存失败'}`,
        `Could not place the scene: ${savedNode.error ?? 'Could not save the canvas card'}`,
      ))
      return
    }
    const saved = await saveBlueprint(content => patchStoryboardScene(content, sceneId, item => ({
      ...item,
      presence: 'on-canvas',
      canvasNodeId: node.id,
    })))
    if (saved.success) {
      setGraph(previous => previous ? { ...previous, nodes: [...previous.nodes, node] } : previous)
      recordLastCreationLocation(projectKey, {
        kind: 'chapter-canvas',
        chapterNumber,
        title: chapterTitle,
        savedAt: new Date().toISOString(),
      })
      toast.success(text(`已把「${scene.title}」排上画布`, `Placed “${scene.title}” on the canvas`))
    } else {
      // 权威蓝图未能登记 canvasNodeId 时回收刚写入的卡，避免刷新后出现孤立重复卡。
      try {
        const cleanup = await ipc.invokeWithProjectSession(
          session, 'db:chapter-canvas-node-delete', chapterNumber, node.id, projectKey,
        )
        if (!cleanup.success) throw new Error(cleanup.error ?? 'cleanup rejected')
      } catch {
        persist.schedule({
          key: `node-delete:${node.id}`,
          run: async () => {
            const cleanup = await ipc.invokeWithProjectSession(
              session, 'db:chapter-canvas-node-delete', chapterNumber, node.id, projectKey,
            )
            return cleanup.success
          },
        })
      }
    }
  }, [blueprintSceneById, chapterNumber, chapterTitle, persist, projectKey, saveBlueprint, text])

  /** 移出画布（§8.2）：删画布卡 + 蓝图分镜保留（presence off-canvas，清空 canvasNodeId）。 */
  const removeFromCanvas = useCallback(async (nodeId: string) => {
    const current = graphRef.current
    if (!current) return
    const node = current.nodes.find(item => item.id === nodeId)
    if (!node || node.type !== 'scene') return
    const sceneId = node.refs.sceneId
    const linkedScene = sceneId ? blueprintSceneById.get(sceneId) : undefined
    const ok = await confirm(text(
      linkedScene
        ? `把场景卡「${node.title}」移出画布？\n蓝图分镜会保留（可再次排上画布）；相关连线一并移除。`
        : `删除这张场景卡？蓝图与正文不受影响。`,
      linkedScene
        ? `Remove the scene card “${node.title}” from the canvas?\nThe blueprint scene is kept (you can place it again); its connections are removed.`
        : 'Delete this scene card? The blueprint and prose are untouched.',
    ), {
      title: text(linkedScene ? '移出画布' : '删除场景卡', linkedScene ? 'Remove from canvas' : 'Delete scene card'),
      confirmText: text(linkedScene ? '移出画布' : '删除', linkedScene ? 'Remove from canvas' : 'Delete'),
      danger: !linkedScene,
    })
    if (!ok) return
    const deleteSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!deleteSession || !isProjectSessionCurrent(deleteSession)) return

    // 先保存权威蓝图。若此步失败，画布卡与连线都保持原样。
    let blueprintWrite: Awaited<ReturnType<typeof saveBlueprint>> | null = null
    if (linkedScene && sceneId) {
      blueprintWrite = await saveBlueprint(content => patchStoryboardScene(content, sceneId, item => ({
        ...item,
        presence: 'off-canvas',
        ...(Object.prototype.hasOwnProperty.call(item, 'canvasNodeId') ? { canvasNodeId: undefined } : {}),
      })))
      if (!blueprintWrite.success) return
    }

    try {
      const result = await ipc.invokeWithProjectSession(
        deleteSession, 'db:chapter-canvas-node-delete', chapterNumber, nodeId, projectKey,
      )
      if (!isProjectSessionCurrent(deleteSession)) return
      if (!result.success) throw new Error(result.error ?? text('画布卡删除失败', 'Could not delete the canvas card'))
    } catch (error) {
      if (linkedScene && sceneId && blueprintWrite?.success) {
        // 画布删除失败时用刚保存的 revision 回滚 presence，保持两侧一致。
        const restoredContent = patchStoryboardScene(blueprintWrite.content, sceneId, item => ({
          ...item,
          presence: 'on-canvas',
          canvasNodeId: nodeId,
        }))
        try {
          const restored = await ipc.invokeWithProjectSession(deleteSession, 'db:blueprint-v2-save', {
            chapterNumber,
            baseRevision: blueprintWrite.revision,
            content: restoredContent,
          }, projectKey)
          if (restored.success && isProjectSessionCurrent(deleteSession)) {
            setBlueprint({ content: restoredContent, revision: restored.revision ?? blueprintWrite.revision + 1 })
            onBlueprintChanged?.()
          } else {
            await refreshBlueprint(deleteSession)
          }
        } catch {
          await refreshBlueprint(deleteSession)
        }
      }
      toast.error(text(
        `移出画布失败：${error instanceof Error ? error.message : String(error)}`,
        `Could not remove the canvas card: ${error instanceof Error ? error.message : String(error)}`,
      ))
      return
    }

    setGraph(previous => previous ? {
      ...previous,
      nodes: previous.nodes.filter(item => item.id !== nodeId),
      edges: previous.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    } : previous)
    setDetail(previous => previous?.id === nodeId ? null : previous)
    setSelectedNodeId(previous => previous === nodeId ? null : previous)
    if (linkedScene) {
      toast.success(text(`已移出画布；蓝图分镜「${linkedScene.title}」保留。`, `Removed from canvas; the blueprint scene “${linkedScene.title}” is kept.`))
    }
  }, [blueprintSceneById, chapterNumber, onBlueprintChanged, projectKey, saveBlueprint, text])

  /** 删除蓝图分镜（§8.2，破坏性）：蓝图条目移除；场景卡保留并显示引用失效。 */
  const deleteBlueprintScene = useCallback(async (sceneId: string) => {
    const scene = blueprintSceneById.get(sceneId)
    if (!scene) return
    const linkedCardCount = graphRef.current?.nodes.filter(node => node.refs.sceneId === sceneId).length ?? 0
    const ok = await confirm(text(
      `删除蓝图分镜「${scene.title}」？\n\n破坏性操作：分镜正文将从蓝图移除。当前有 ${linkedCardCount} 张关联画布卡；它们会保留并显示「引用失效」，不会被连带删除。\n\n——— 完整分镜正文 ———\n${scene.markdown}`,
      `Delete the blueprint scene “${scene.title}”?\n\nThis is destructive: the scene body is removed from the blueprint. ${linkedCardCount} canvas card(s) currently reference it; they will remain and show a “broken reference” badge, and will not be deleted.\n\n——— Full scene body ———\n${scene.markdown}`,
    ), {
      title: text('删除蓝图分镜', 'Delete blueprint scene'),
      confirmText: text('删除分镜', 'Delete scene'),
      danger: true,
    })
    if (!ok) return
    const saved = await saveBlueprint(content => ({
      ...content,
      sections: content.sections.map(section => {
        if (!(section.kind === 'canonical' && section.id === 'storyboard')) return section
        return { ...section, items: section.items.filter(item => !(item.kind === 'scene' && item.id === sceneId)) }
      }),
    }))
    if (saved.success) {
      toast.success(text('已删除蓝图分镜；关联场景卡保留为普通卡（显示引用失效）。', 'The blueprint scene was deleted; its canvas card remains as a plain card (broken reference).'))
    }
  }, [blueprintSceneById, saveBlueprint, text])

  /** 主线顺序变更（§8.3）：先写蓝图（scene-order-save），再镜像 node.order 与 x。 */
  const changeSceneOrder = useCallback(async (
    sceneId: string,
    toOrder: number,
    dragPositions?: Array<{ nodeId: string; x: number; y: number }>,
  ): Promise<boolean> => {
    if (!blueprint || blueprintScenes.length === 0) return false
    const currentIds = blueprintScenes.map(scene => scene.sceneId)
    const clamped = Math.min(Math.max(Math.trunc(toOrder) || 1, 1), currentIds.length)
    if (currentIds[clamped - 1] === sceneId) return true
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session) return false
    const ordered = currentIds.filter(id => id !== sceneId)
    ordered.splice(clamped - 1, 0, sceneId)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:blueprint-v2-scene-order-save', {
        chapterNumber,
        baseRevision: blueprint.revision,
        orderedSceneIds: ordered,
      }, projectKey)
      if (!isProjectSessionCurrent(session)) return false
      if (!result.success) {
        toast.warning(result.conflict
          ? text('分镜顺序已被其他窗口修改，画布已刷新为最新顺序。', 'The scene order changed elsewhere; the canvas refreshed to the latest order.')
          : text(`调整顺序失败：${result.error ?? '未知错误'}`, `Could not change the order: ${result.error ?? 'Unknown error'}`))
        await refreshBlueprint(session)
        onBlueprintChanged?.()
        return false
      }
      const displacedId = currentIds[clamped - 1]
      const nextContent = moveBlueprintV2Scene(blueprint.content, sceneId, clamped)
      setBlueprint({ content: nextContent, revision: result.revision ?? blueprint.revision + 1 })
      // 镜像 node.order。按钮重排时交换卡片槽位；拖动重排时保留用户刚放下的坐标。
      setGraph(previous => {
        if (!previous) return previous
        const positionById = new Map(dragPositions?.map(position => [position.nodeId, position]) ?? [])
        const nextOrderBySceneId = new Map(getBlueprintV2Scenes(nextContent).map(scene => [scene.sceneId, scene.order]))
        const movedNode = previous.nodes.find(node => node.refs.sceneId === sceneId)
        const displacedNode = displacedId
          ? previous.nodes.find(node => node.refs.sceneId === displacedId)
          : undefined
        let nodes = previous.nodes.map(node => {
          const droppedPosition = positionById.get(node.id)
          const sceneOrder = node.refs.sceneId ? nextOrderBySceneId.get(node.refs.sceneId) : undefined
          return {
            ...node,
            ...(droppedPosition ? { x: droppedPosition.x, y: droppedPosition.y } : {}),
            ...(sceneOrder === undefined ? {} : { order: sceneOrder }),
          }
        })
        if (!dragPositions && movedNode && displacedNode && movedNode.id !== displacedNode.id) {
          nodes = nodes.map(node => {
            if (node.id === movedNode.id) return { ...node, x: displacedNode.x, y: displacedNode.y }
            if (node.id === displacedNode.id) return { ...node, x: movedNode.x, y: movedNode.y }
            return node
          })
          persistNode({ ...movedNode, order: clamped, x: displacedNode.x, y: displacedNode.y })
          const displacedOrder = nextOrderBySceneId.get(displacedId)
          persistNode({ ...displacedNode, order: displacedOrder ?? displacedNode.order, x: movedNode.x, y: movedNode.y })
        } else if (dragPositions) {
          for (const node of nodes) {
            if (node.refs.sceneId && nextOrderBySceneId.has(node.refs.sceneId)) persistNode(node)
          }
        } else if (movedNode) {
          persistNode({ ...movedNode, order: clamped })
        }
        return { ...previous, nodes }
      })
      onBlueprintChanged?.()
      return true
    } catch (error) {
      toast.error(text(
        `调整顺序失败：${error instanceof Error ? error.message : String(error)}`,
        `Could not change the order: ${error instanceof Error ? error.message : String(error)}`,
      ))
      return false
    }
  }, [blueprint, blueprintScenes, chapterNumber, onBlueprintChanged, persistNode, projectKey, text])

  /** 删除画布节点的统一入口：已关联分镜的卡走「移出画布」语义（§8.2）。 */
  const deleteNodeRouted = useCallback(async (nodeId: string) => {
    const current = graphRef.current
    const node = current?.nodes.find(item => item.id === nodeId)
    if (node?.type === 'scene' && node.refs.sceneId && blueprintSceneById.has(node.refs.sceneId)) {
      await removeFromCanvas(nodeId)
      return
    }
    await deleteNodeById(nodeId)
  }, [blueprintSceneById, deleteNodeById, removeFromCanvas])

  useEffect(() => {
    actionsRef.current = { deleteNode: nodeId => { void deleteNodeRouted(nodeId) } }
  }, [deleteNodeRouted])

  // ===== 场景排序（主线） =====

  /** 已关联分镜卡的有效顺序 = 蓝图分镜 order（唯一权威，§8.3）；未关联卡沿用 node.order。 */
  const effectiveSceneOrder = useCallback((node: ChapterCanvasNodeData): number => {
    if (node.refs.sceneId) {
      const scene = blueprintSceneById.get(node.refs.sceneId)
      if (scene) return scene.order
    }
    return node.order ?? Number.MAX_SAFE_INTEGER
  }, [blueprintSceneById])

  const orderedScenes = useMemo(() => {
    const scenes = (graph?.nodes ?? []).filter(node => node.type === 'scene')
    return [...scenes].sort((a, b) => {
      const left = effectiveSceneOrder(a)
      const right = effectiveSceneOrder(b)
      return left !== right ? left - right : a.x - b.x
    })
  }, [graph, effectiveSceneOrder])

  /** 尚未排上画布的蓝图分镜（供「排上画布」选择）。 */
  const unplacedBlueprintScenes = useMemo(() => {
    if (!graph) return []
    const placedIds = new Set(
      graph.nodes.map(node => node.refs.sceneId).filter((id): id is string => Boolean(id)),
    )
    return blueprintScenes.filter(scene => !placedIds.has(scene.sceneId))
  }, [graph, blueprintScenes])

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

  const onNodeDragStop = useCallback(async (_event: unknown, draggedFlowNode: FlowNode) => {
    const current = graphRef.current
    if (!current) return
    const positions = current.nodes.map(node => {
      const rendered = flowRef.current?.getNode(node.id)
      return {
        nodeId: node.id,
        x: Math.round(rendered?.position.x ?? node.x),
        y: Math.round(rendered?.position.y ?? node.y),
      }
    })
    const positionById = new Map(positions.map(position => [position.nodeId, position]))
    const draggedNode = current.nodes.find(node => node.id === draggedFlowNode.id)
    const draggedSceneId = draggedNode?.type === 'scene' && draggedNode.refs.sceneId
      && blueprintSceneById.has(draggedNode.refs.sceneId)
      ? draggedNode.refs.sceneId
      : null
    if (draggedSceneId) {
      const draggedX = positionById.get(draggedNode!.id)?.x ?? draggedNode!.x
      const visiblePeers = current.nodes
        .filter(node => node.type === 'scene' && node.refs.sceneId && blueprintSceneById.has(node.refs.sceneId)
          && node.refs.sceneId !== draggedSceneId)
        .map(node => ({
          sceneId: node.refs.sceneId!,
          x: positionById.get(node.id)?.x ?? node.x,
        }))
        .sort((left, right) => left.x - right.x)
      const orderedWithoutDragged = blueprintScenes.map(scene => scene.sceneId).filter(id => id !== draggedSceneId)
      const nextPeer = visiblePeers.find(peer => peer.x > draggedX)
      const previousPeer = [...visiblePeers].reverse().find(peer => peer.x <= draggedX)
      const nextOrder = nextPeer
        ? orderedWithoutDragged.indexOf(nextPeer.sceneId) + 1
        : previousPeer
          ? orderedWithoutDragged.indexOf(previousPeer.sceneId) + 2
          : blueprintScenes.findIndex(scene => scene.sceneId === draggedSceneId) + 1
      const orderSaved = await changeSceneOrder(draggedSceneId, nextOrder, positions)
      if (!orderSaved) {
        // 蓝图顺序是权威；保存失败时把画布位置恢复到拖动前的数据库快照。
        const oldPositions = current.nodes.map(node => ({ nodeId: node.id, x: node.x, y: node.y }))
        const oldPositionById = new Map(oldPositions.map(position => [position.nodeId, position]))
        setGraph(previous => previous ? {
          ...previous,
          nodes: previous.nodes.map(node => {
            const position = oldPositionById.get(node.id)
            return position ? { ...node, x: position.x, y: position.y } : node
          }),
        } : previous)
        setNodes(previous => previous.map(node => {
          const position = oldPositionById.get(node.id)
          return position ? { ...node, position: { x: position.x, y: position.y } } : node
        }))
        return
      }
    } else {
      setGraph(previous => previous ? {
        ...previous,
        nodes: previous.nodes.map(node => {
          const position = positionById.get(node.id)
          return position ? { ...node, x: position.x, y: position.y } : node
        }),
      } : previous)
    }
    persist.schedule({
      key: `reposition:${chapterCanvasId(chapterNumber)}`,
      run: () => {
        const session = captureProjectSession(useProjectStore.getState().currentProject)
        if (!session) return Promise.resolve(false)
        return (async () => {
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
  }, [blueprintSceneById, blueprintScenes, changeSceneOrder, chapterNumber, persist, projectKey, setNodes])

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
    const driftFixes: ChapterCanvasNodeData[] = []
    setNodes(graph.nodes.map(node => {
      const linkedScene = node.refs.sceneId ? blueprintSceneById.get(node.refs.sceneId) : undefined
      const haystack = `${node.title}\n${node.summary}`.toLowerCase()
      const searchHit = query.length > 0 && haystack.includes(query)
      const dimmed = query.length > 0 && !searchHit
      if (node.type === 'scene') {
        // 已关联卡展示蓝图权威标题/顺序（快照漂移时异步修复节点列，§8.3）。
        const displayTitle = linkedScene ? linkedScene.title : node.title
        const displayOrder = linkedScene ? linkedScene.order : node.order
        if (linkedScene && (node.title !== displayTitle || node.order !== displayOrder)) {
          driftFixes.push({ ...node, title: displayTitle, order: displayOrder })
        }
        const data: ChapterSceneCardNodeData = {
          title: displayTitle,
          summary: node.summary,
          role: node.role,
          roleLabel: node.role ? text(...(ROLE_LABELS[node.role] ?? [node.role, node.role])) : '',
          order: displayOrder,
          wordLabel: '',
          dangling: Boolean(node.refs.sceneId) && !linkedScene,
          linked: Boolean(linkedScene),
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
    // 镜像漂移异步修复（§8.3）：标题/顺序以蓝图为准，持久化修正后的快照。
    if (driftFixes.length > 0) {
      setGraph(previous => previous ? {
        ...previous,
        nodes: previous.nodes.map(node => {
          const fix = driftFixes.find(item => item.id === node.id)
          return fix ? { ...node, title: fix.title, order: fix.order } : node
        }),
      } : previous)
      for (const fix of driftFixes) persistNode(fix)
    }
  }, [graph, search, orderedScenes, rosterSet, foreshadowById, blueprintSceneById, persistNode, text, setNodes, setEdges])

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
        {blueprint ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPlaceDialogOpen(true)}
            data-testid="chapter-canvas-place-scene"
            title={text('把蓝图分镜排上画布（场景卡绑定正式分镜 ID）', 'Place blueprint scenes on the canvas (cards bind to formal scene IDs)')}
          >
            <Plus size={12} />{text('排上画布', 'Place from blueprint')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setCreateTitle(''); setCreateSummary(''); setCreateRole('发展'); setCreateDialog({ type: 'scene' }) }} data-testid="chapter-canvas-add-scene">
            <Plus size={12} />{text('新增场景', 'Add scene')}
          </Button>
        )}
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
            const selectedNodeId = selection.nodes[0]?.id ?? null
            const selectedEdgeId = selection.edges[0]?.id ?? null
            setSelectedNodeId(previous => previous === selectedNodeId ? previous : selectedNodeId)
            setSelectedEdgeId(previous => previous === selectedEdgeId ? previous : selectedEdgeId)
            const firstNode = selection.nodes[0]
            const node = firstNode ? graph?.nodes.find(item => item.id === firstNode.id) : null
            if (node?.type === 'scene') {
              setDetail(previous => previous?.kind === 'scene'
                && previous.id === node.id
                && previous.title === node.title
                && previous.summary === node.summary
                && previous.role === node.role
                && previous.order === node.order
                ? previous
                : { kind: 'scene', id: node.id, title: node.title, summary: node.summary, role: node.role, order: node.order })
            } else if (node) {
              setDetail(previous => previous?.kind === 'aux'
                && previous.id === node.id
                && previous.title === node.title
                && previous.summary === node.summary
                ? previous
                : { kind: 'aux', id: node.id, title: node.title, summary: node.summary })
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
            {selectedNode?.type === 'scene' && (() => {
              const linkedScene = selectedNode.refs.sceneId
                ? blueprintSceneById.get(selectedNode.refs.sceneId)
                : undefined
              const dangling = Boolean(selectedNode.refs.sceneId) && !linkedScene
              const sceneIndex = linkedScene
                ? blueprintScenes.findIndex(scene => scene.sceneId === linkedScene.sceneId)
                : -1
              return (
                <>
                  {linkedScene && (
                    <div className="canvas-detail__section" data-testid="chapter-canvas-blueprint-body">
                      <Label>{text('分镜正文（蓝图权威，只读）', 'Scene body (blueprint authority, read-only)')}</Label>
                      <pre className="canvas-detail__markdown">{linkedScene.markdown.trim() || text('（无正文）', '(no body)')}</pre>
                      <p className="canvas-detail__hint">
                        {text('分镜正文与小标题在章节蓝图中编辑；这里不维护另一份摘要。', 'Edit the scene body and headings in the chapter blueprint; the canvas keeps no second copy.')}
                      </p>
                    </div>
                  )}
                  {dangling && (
                    <div
                      className="canvas-detail__section"
                      style={{ color: 'var(--color-error-text)' }}
                      data-testid="chapter-canvas-dangling-ref"
                    >
                      {text(
                        '引用失效：该分镜已从蓝图删除。此卡是画布上的普通卡，可安全删除，不影响任何资料。',
                        'Broken reference: the blueprint scene was deleted. This card is a plain canvas card and can be deleted safely.',
                      )}
                    </div>
                  )}
                  <div className="canvas-detail__section">
                    <Label htmlFor="chapter-node-title">
                      {linkedScene
                        ? text('场景标题（蓝图快照，只读）', 'Scene title (blueprint snapshot, read-only)')
                        : text('场景标题', 'Scene title')}
                    </Label>
                    <Input
                      id="chapter-node-title"
                      value={linkedScene ? linkedScene.title
                        : detail?.kind === 'scene' && detail.id === selectedNode.id ? detail.title : selectedNode.title}
                      onChange={linkedScene ? undefined : event => setDetail(previous => previous?.kind === 'scene' && previous.id === selectedNode.id
                        ? { ...previous, title: event.target.value }
                        : { kind: 'scene', id: selectedNode.id, title: event.target.value, summary: selectedNode.summary, role: selectedNode.role, order: selectedNode.order })}
                      readOnly={Boolean(linkedScene)}
                    />
                  </div>
                  <div className="canvas-detail__section">
                    <Label htmlFor="chapter-node-summary">
                      {linkedScene
                        ? text('画布备注（非分镜正文）', 'Canvas note (not the scene body)')
                        : text('场景要点', 'Scene beats')}
                    </Label>
                    <Textarea
                      id="chapter-node-summary"
                      rows={linkedScene ? 3 : 5}
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
                    <Label htmlFor="chapter-node-order">
                      {linkedScene
                        ? text('主线顺序（写入蓝图分镜顺序）', 'Spine order (writes to the blueprint scene order)')
                        : text('主线顺序（1 起，留空则排最后）', 'Spine order (1-based; empty = last)')}
                    </Label>
                    {linkedScene ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline" size="sm"
                          disabled={sceneIndex <= 0}
                          onClick={() => void changeSceneOrder(linkedScene.sceneId, sceneIndex)}
                          title={text('上移一位（写入蓝图）', 'Move up one slot (writes to the blueprint)')}
                        >
                          ↑ {text('上移', 'Up')}
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          disabled={sceneIndex < 0 || sceneIndex >= blueprintScenes.length - 1}
                          onClick={() => void changeSceneOrder(linkedScene.sceneId, sceneIndex + 2)}
                          title={text('下移一位（写入蓝图）', 'Move down one slot (writes to the blueprint)')}
                        >
                          ↓ {text('下移', 'Down')}
                        </Button>
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          #{linkedScene.order}
                        </span>
                      </div>
                    ) : (
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
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={detailSave}>{text('保存修改', 'Save changes')}</Button>
                    {linkedScene && (
                      <Button variant="outline" size="sm" onClick={() => void removeFromCanvas(selectedNode.id)} data-testid="chapter-canvas-remove-from-canvas">
                        {text('移出画布', 'Remove from canvas')}
                      </Button>
                    )}
                    {linkedScene && (
                      <Button variant="ghost" size="sm" onClick={() => void deleteBlueprintScene(linkedScene.sceneId)} data-testid="chapter-canvas-delete-scene">
                        <Trash2 size={12} />{text('删除蓝图分镜', 'Delete blueprint scene')}
                      </Button>
                    )}
                    {!linkedScene && (
                      <Button variant="ghost" size="sm" onClick={() => void deleteNodeById(selectedNode.id)}>
                        <Trash2 size={12} />{text('删除场景卡', 'Delete scene card')}
                      </Button>
                    )}
                  </div>
                </>
              )
            })()}
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

      {/* 从蓝图排上画布：仅列出尚未排上的分镜（§8.2 排上画布行） */}
      <Dialog open={placeDialogOpen} onOpenChange={open => { if (!open) setPlaceDialogOpen(false) }}>
        <DialogContent className="max-w-md" data-testid="chapter-canvas-place-dialog">
          <DialogHeader>
            <DialogTitle>{text('把蓝图分镜排上画布', 'Place blueprint scenes on the canvas')}</DialogTitle>
            <DialogDescription>
              {text(
                '场景卡绑定正式分镜 ID：标题是快照，正文始终指向蓝图；此后重排在蓝图与画布间保持一致。',
                'Scene cards bind to formal scene IDs: the title is a snapshot and the body always points to the blueprint; reordering stays consistent on both sides.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-6 py-3 max-h-[50vh] overflow-y-auto">
            {unplacedBlueprintScenes.length === 0
              ? (
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {blueprint
                    ? text('所有分镜都已排上画布。', 'Every scene is already on the canvas.')
                    : text('本章还没有细纲分镜；先在章节蓝图页导入或编辑细纲。', 'No outline scenes for this chapter yet; import or edit the outline in the blueprint page first.')}
                </p>
              )
              : unplacedBlueprintScenes.map(scene => (
                <div key={scene.sceneId} className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate" style={{ color: 'var(--color-text)' }}>
                    #{scene.order} {scene.title}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void placeSceneOnCanvas(scene.sceneId)}
                    data-testid={`chapter-canvas-place-${scene.sceneId}`}
                  >
                    {text('排上画布', 'Place')}
                  </Button>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlaceDialogOpen(false)}>{text('关闭', 'Close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
