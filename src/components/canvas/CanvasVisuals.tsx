/**
 * 两套画布共用的节点与连线渲染件。
 *
 * 所有颜色都来自主题 token；节点里绝不出现固定色值。节点数据用 `type`
 * 声明（而非 interface），以满足 React Flow v12 对 data 的隐式索引签名要求。
 */

import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'
import { CornerUpRight, Flag, Lightbulb, Scissors, Trash2, User, X } from 'lucide-react'

import type { Node, Edge } from '@xyflow/react'
import type { ChapterCanvasNodeType } from '../../shared/chapter-canvas'
import type { PlotCanvasColorKey } from '../../shared/plot-canvas'
import { useLocaleStore } from '../../stores/locale-store'

/* ===== 剧情画布：剧情事件节点 ===== */

export type PlotEventCardNodeData = {
  title: string
  summary: string
  colorKey: PlotCanvasColorKey
  chapterRefs: number[]
  hasPlan: boolean
  subCanvasTitle: string | null
  dimmed: boolean
  searchHit: boolean
  onDelete?: (nodeId: string) => void
  onSplit?: (nodeId: string) => void
  onEnterSubCanvas?: (nodeId: string) => void
}

export type PlotEventCardNode = Node<PlotEventCardNodeData, 'plot-event-card'>

function PlotEventCardNodeView({ id, data, selected }: NodeProps<PlotEventCardNode>) {
  const text = useLocaleStore(s => s.text)
  return (
    <div
      className={[
        'canvas-node',
        selected ? 'is-selected' : '',
        data.searchHit && !selected ? 'is-search-hit' : '',
        data.dimmed ? 'is-dimmed' : '',
      ].join(' ')}
      data-testid="plot-canvas-node"
      data-node-id={id}
    >
      <span className="canvas-node__accent" data-color={data.colorKey} aria-hidden="true" />
      <div className="canvas-node__hover-actions">
        {(data.onSplit || data.onDelete) && (
          <button
            type="button"
            className="canvas-node__hover-action"
            title={text('拆分出后续节点', 'Split into a follow-up node')}
            aria-label={text('拆分出后续节点', 'Split into a follow-up node')}
            onClick={event => { event.stopPropagation(); data.onSplit?.(id) }}
          >
            <Scissors size={11} />
          </button>
        )}
        {data.onDelete && (
          <button
            type="button"
            className="canvas-node__hover-action"
            data-variant="danger"
            title={text('删除节点', 'Delete node')}
            aria-label={text('删除节点', 'Delete node')}
            onClick={event => { event.stopPropagation(); data.onDelete?.(id) }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      <div className="canvas-node__body">
        {(data.chapterRefs.length > 0 || data.hasPlan || data.subCanvasTitle) && (
          <div className="canvas-node__badges">
            {data.subCanvasTitle && (
              <button
                type="button"
                className="canvas-node__badge"
                title={text('进入子画布', 'Enter sub-canvas')}
                onClick={event => { event.stopPropagation(); data.onEnterSubCanvas?.(id) }}
              >
                <CornerUpRight size={9} />
                {data.subCanvasTitle}
              </button>
            )}
            {data.hasPlan && (
              <span className="canvas-node__badge" title={text('已关联线索计划', 'Linked to a thread plan')}>
                {text('线索', 'Plan')}
              </span>
            )}
            {data.chapterRefs.map(chapter => (
              <span
                key={chapter}
                className="canvas-node__badge"
                data-variant="ref"
                title={text(`关联第 ${chapter} 章`, `Linked to chapter ${chapter}`)}
              >
                {text(`第${chapter}章`, `Ch ${chapter}`)}
              </span>
            ))}
          </div>
        )}
        <span className="canvas-node__title">{data.title}</span>
        {data.summary && <span className="canvas-node__summary">{data.summary}</span>}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const PlotEventCardNodeViewMemo = memo(PlotEventCardNodeView)

/* ===== 剧情画布：只读投影对照层的幽灵节点 ===== */

export type PlotProjectionGhostNodeData = {
  trackTitle: string
  chapterNumber: number
  summary: string
  status: 'planned' | 'occurred'
}

export type PlotProjectionGhostNode = Node<PlotProjectionGhostNodeData, 'plot-projection-ghost'>

function PlotProjectionGhostNodeView({ data }: NodeProps<PlotProjectionGhostNode>) {
  const text = useLocaleStore(s => s.text)
  return (
    <div
      className="canvas-node canvas-node--ghost"
      data-testid="plot-canvas-ghost"
      title={text('蓝图/定稿投影（只读对照）', 'Blueprint/finalized projection (read-only overlay)')}
    >
      <div className="canvas-node__body">
        <div className="canvas-node__badges">
          <span className="canvas-node__badge" data-variant={data.status === 'occurred' ? 'ref' : 'role'}>
            {text(
              data.status === 'occurred' ? `第${data.chapterNumber}章 · 已定稿` : `第${data.chapterNumber}章 · 蓝图`,
              data.status === 'occurred' ? `Ch ${data.chapterNumber} · finalized` : `Ch ${data.chapterNumber} · planned`,
            )}
          </span>
          <span className="canvas-node__badge">{data.trackTitle}</span>
        </div>
        <span className="canvas-node__title">{data.summary}</span>
      </div>
    </div>
  )
}

export const PlotProjectionGhostNodeViewMemo = memo(PlotProjectionGhostNodeView)

/* ===== 章节画布：场景卡节点 ===== */

export type ChapterSceneCardNodeData = {
  title: string
  summary: string
  role: string
  roleLabel: string
  order: number | null
  wordLabel: string
  dimmed: boolean
  searchHit: boolean
  onDelete?: (nodeId: string) => void
}

export type ChapterSceneCardNode = Node<ChapterSceneCardNodeData, 'chapter-scene-card'>

function ChapterSceneCardNodeView({ id, data, selected }: NodeProps<ChapterSceneCardNode>) {
  const text = useLocaleStore(s => s.text)
  return (
    <div
      className={[
        'canvas-node',
        selected ? 'is-selected' : '',
        data.searchHit && !selected ? 'is-search-hit' : '',
        data.dimmed ? 'is-dimmed' : '',
      ].join(' ')}
      data-testid="chapter-canvas-scene"
      data-node-id={id}
    >
      <span className="canvas-node__accent" aria-hidden="true" />
      <div className="canvas-node__hover-actions">
        {data.onDelete && (
          <button
            type="button"
            className="canvas-node__hover-action"
            data-variant="danger"
            title={text('删除场景（不影响蓝图与正文）', 'Delete scene (blueprint and prose are untouched)')}
            aria-label={text('删除场景', 'Delete scene')}
            onClick={event => { event.stopPropagation(); data.onDelete?.(id) }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      <div className="canvas-node__body">
        <div className="canvas-node__badges">
          {data.order !== null && (
            <span className="canvas-node__badge">#{data.order}</span>
          )}
          {data.role && (
            <span className="canvas-node__badge" data-variant="role">{data.roleLabel}</span>
          )}
        </div>
        <span className="canvas-node__title">{data.title}</span>
        {data.summary && <span className="canvas-node__summary">{data.summary}</span>}
      </div>
      {data.wordLabel && (
        <div className="canvas-node__footer"><span>{data.wordLabel}</span></div>
      )}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const ChapterSceneCardNodeViewMemo = memo(ChapterSceneCardNodeView)

/* ===== 章节画布：辅助节点（角色 / 伏笔 / 灵感 / 片段） ===== */

export type ChapterAuxCardNodeData = {
  auxType: Exclude<ChapterCanvasNodeType, 'scene'>
  title: string
  summary: string
  refLabel: string | null
  refBroken: boolean
  dimmed: boolean
  searchHit: boolean
  onDelete?: (nodeId: string) => void
}

export type ChapterAuxCardNode = Node<ChapterAuxCardNodeData, 'chapter-aux-card'>

const AUX_ICONS: Record<Exclude<ChapterCanvasNodeType, 'scene'>, typeof User> = {
  character: User,
  foreshadow: Flag,
  idea: Lightbulb,
  snippet: Scissors,
}

function ChapterAuxCardNodeView({ id, data, selected }: NodeProps<ChapterAuxCardNode>) {
  const text = useLocaleStore(s => s.text)
  const Icon = AUX_ICONS[data.auxType]
  return (
    <div
      className={[
        'canvas-node canvas-node--aux',
        selected ? 'is-selected' : '',
        data.searchHit && !selected ? 'is-search-hit' : '',
        data.dimmed ? 'is-dimmed' : '',
      ].join(' ')}
      data-testid="chapter-canvas-aux"
      data-node-id={id}
      data-aux-type={data.auxType}
    >
      <div className="canvas-node__hover-actions">
        {data.onDelete && (
          <button
            type="button"
            className="canvas-node__hover-action"
            data-variant="danger"
            title={text('删除节点（不影响原资料）', 'Delete node (source material is untouched)')}
            aria-label={text('删除节点（不影响原资料）', 'Delete node (source material is untouched)')}
            onClick={event => { event.stopPropagation(); data.onDelete?.(id) }}
          >
            <X size={11} />
          </button>
        )}
      </div>
      <div className="canvas-node__body">
        <div className="canvas-node__badges">
          <span className="canvas-node__badge" data-variant={data.refBroken ? 'broken' : 'ref'}>
            <Icon size={9} />
            {data.refLabel ?? text('引用失效', 'Missing source')}
          </span>
        </div>
        <span className="canvas-node__title">{data.title}</span>
        {data.summary && <span className="canvas-node__summary">{data.summary}</span>}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const ChapterAuxCardNodeViewMemo = memo(ChapterAuxCardNodeView)

/* ===== 带标签连线 ===== */

export type CanvasLabeledEdgeData = {
  label: string
  kind: 'main' | 'aux'
  dimmed?: boolean
}

export type CanvasLabeledEdge = Edge<CanvasLabeledEdgeData, 'canvas-labeled'>

function CanvasLabeledEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<CanvasLabeledEdge>) {
  // 三次贝塞尔路径与 React Flow 默认（getBezierEdgeCenter）一致；
  // 标签摆在两端中点，与默认边的 label 渲染策略相同。
  const path = `M ${sourceX},${sourceY} C ${sourceX + (targetX - sourceX) / 2},${sourceY} ${targetX - (targetX - sourceX) / 2},${targetY} ${targetX},${targetY}`
  const centerX = (sourceX + targetX) / 2
  const centerY = (sourceY + targetY) / 2
  const isAux = data?.kind === 'aux'
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected
            ? 'var(--color-accent)'
            : isAux ? 'var(--color-text-muted)' : 'var(--color-accent)',
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: isAux ? '5 4' : undefined,
          opacity: data?.dimmed ? 0.3 : 1,
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            className="canvas-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${centerX}px, ${centerY}px)`,
              pointerEvents: 'none',
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const CanvasLabeledEdgeViewMemo = memo(CanvasLabeledEdgeView)
