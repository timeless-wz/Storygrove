/**
 * PlotGraphCardNode — 剧情画布卡片节点（@xyflow/react 自定义节点）。
 *
 * 特性：
 * 1. 深度支持 10 种节点种类（plot/idea/foreshadow/character/location/item/faction/skill/chapter/note）；
 * 2. 具备清晰的图标、强调色带、种类徽章与标题层级；
 * 3. 展示摘要（按需）、标签（按需）、关联章节、线索计划、子画布入口及关联实体；
 * 4. 严格遵循无数据不编造规则，空字段不渲染无意义占位符；
 * 5. 全面兼容旧版 PlotEventCardNodeData，旧 plot 节点展示平滑升级且不劣化；
 * 6. 支持 is-selected、is-search-hit、is-dimmed、is-hidden 状态与悬浮快速操作。
 */

import { memo, useMemo, type CSSProperties } from 'react'
import {
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react'
import {
  CornerUpRight,
  ExternalLink,
  Pencil,
  Scissors,
  Trash2,
} from 'lucide-react'

import type { PlotGraphNode } from './types'
import { getPlotNodeKindMeta } from './kind-meta'
import { useLocaleStore } from '../../../stores/locale-store'
import './plot-graph.css'

function PlotGraphCardNodeView({ id, data, selected }: NodeProps<PlotGraphNode>) {
  const text = useLocaleStore(s => s.text)
  const meta = useMemo(() => getPlotNodeKindMeta(data.kind), [data.kind])
  const KindIcon = meta.icon

  // CSS 变量注入，确保卡片样式能感知自身种类的语义配色
  const cardStyle = useMemo<CSSProperties>(() => {
    return {
      '--node-accent-color': meta.accentColor,
      '--node-badge-bg': meta.badgeBg,
      '--node-badge-text': meta.badgeText,
    } as CSSProperties
  }, [meta])

  const classNames = useMemo(() => {
    const list = ['plot-graph-card']
    if (selected) list.push('is-selected')
    if (data.searchHit && !selected) list.push('is-search-hit')
    if (data.dimmed) list.push('is-dimmed')
    if (data.hidden) list.push('is-hidden')
    return list.join(' ')
  }, [selected, data.searchHit, data.dimmed, data.hidden])

  const hasBadges = Boolean(
    data.subCanvasTitle ||
    data.hasPlan ||
    (data.chapterRefs && data.chapterRefs.length > 0) ||
    data.entityRef
  )

  return (
    <div
      className={classNames}
      style={cardStyle}
      data-testid="plot-graph-card"
      data-node-id={id}
      data-kind={meta.kind}
    >
      {/* 顶部色彩线标 */}
      <div className="plot-graph-card__accent-bar" aria-hidden="true" />

      {/* 悬浮操作按钮 */}
      <div className="plot-graph-card__hover-actions">
        {data.onEdit && (
          <button
            type="button"
            className="plot-graph-card__hover-btn"
            title={text('编辑详情', 'Edit details')}
            aria-label={text('编辑详情', 'Edit details')}
            onClick={event => {
              event.stopPropagation()
              data.onEdit?.(id)
            }}
          >
            <Pencil size={11} />
          </button>
        )}
        {data.onSplit && (
          <button
            type="button"
            className="plot-graph-card__hover-btn"
            title={text('拆分出后续节点', 'Split into a follow-up node')}
            aria-label={text('拆分出后续节点', 'Split into a follow-up node')}
            onClick={event => {
              event.stopPropagation()
              data.onSplit?.(id)
            }}
          >
            <Scissors size={11} />
          </button>
        )}
        {data.onDelete && (
          <button
            type="button"
            className="plot-graph-card__hover-btn"
            data-variant="danger"
            title={text('删除节点', 'Delete node')}
            aria-label={text('删除节点', 'Delete node')}
            onClick={event => {
              event.stopPropagation()
              data.onDelete?.(id)
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {/* 卡片主体 */}
      <div className="plot-graph-card__body">
        {/* 顶部 Kind 徽章与关联标签行 */}
        <div className="plot-graph-card__meta-row">
          <span className="plot-graph-card__kind-badge" title={text(meta.descriptionZh, meta.descriptionEn)}>
            <KindIcon size={11} />
            <span>{text(meta.labelZh, meta.labelEn)}</span>
          </span>

          {hasBadges && (
            <>
              {data.subCanvasTitle && (
                <button
                  type="button"
                  className="plot-graph-card__badge is-subcanvas"
                  title={text('进入子画布', 'Enter sub-canvas')}
                  onClick={event => {
                    event.stopPropagation()
                    data.onEnterSubCanvas?.(id, data.subCanvasId ?? undefined)
                  }}
                >
                  <CornerUpRight size={9} />
                  <span>{data.subCanvasTitle}</span>
                </button>
              )}

              {data.hasPlan && (
                <span className="plot-graph-card__badge" data-variant="plan" title={text('已关联线索计划', 'Linked to thread plan')}>
                  {text('线索', 'Plan')}
                </span>
              )}

              {data.chapterRefs && data.chapterRefs.map(chapter => (
                <span
                  key={chapter}
                  className="plot-graph-card__badge"
                  data-variant="ref"
                  title={text(`关联第 ${chapter} 章`, `Linked to Ch ${chapter}`)}
                >
                  {text(`第${chapter}章`, `Ch ${chapter}`)}
                </span>
              ))}

              {data.entityRef && (
                <span
                  className="plot-graph-card__badge"
                  title={text(`关联来源: ${data.entityRef.name ?? data.entityRef.type}`, `Entity: ${data.entityRef.name ?? data.entityRef.type}`)}
                  onClick={event => {
                    if (data.onNavigateEntity && data.entityRef) {
                      event.stopPropagation()
                      data.onNavigateEntity(data.entityRef)
                    }
                  }}
                >
                  <ExternalLink size={9} />
                  <span>{data.entityRef.name ?? data.entityRef.type}</span>
                </span>
              )}
            </>
          )}
        </div>

        {/* 标题 */}
        <div className="plot-graph-card__title" title={data.title}>
          {data.title}
        </div>

        {/* 摘要（只在存在且非空时展示，杜绝编造内容） */}
        {data.summary && data.summary.trim().length > 0 && (
          <div className="plot-graph-card__summary">
            {data.summary.trim()}
          </div>
        )}

        {/* 标签列表（只在有标签时展示） */}
        {data.tags && data.tags.length > 0 && (
          <div className="plot-graph-card__tags">
            {data.tags.map((tag, idx) => (
              <span key={`${tag}-${idx}`} className="plot-graph-card__tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* React Flow 连线桩 */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const PlotGraphCardNode = memo(PlotGraphCardNodeView)
