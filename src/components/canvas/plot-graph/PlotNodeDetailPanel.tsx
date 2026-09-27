/**
 * PlotNodeDetailPanel — 剧情节点详情展示与动作抽屉组件。
 *
 * 交付内容：
 * 1. 真实展示节点字段：种类（Kind）、标题、摘要、标签、颜色属性；
 * 2. 真实展示关联来源：所属章节（chapterRefs）、线索计划（planId）、子画布（subCanvasId）、关联实体（entityRef）；
 * 3. 严格不直接调用 IPC，所有行为以纯 Props 回调上报（onEdit, onDelete, onEnterSubCanvas, onNavigateEntity, onOpenPlan）；
 * 4. 健壮的可用与不可用状态判定（缺少关联或无回调时按钮置灰并提示说明，绝不静默报错）。
 */

import { useMemo } from 'react'
import {
  BookOpen,
  CornerUpRight,
  ExternalLink,
  Pencil,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'

import type { EntitySourceRef, PlotGraphNodeData } from './types'
import type { PlotCanvasNodeEntityRef } from '../../../shared/plot-canvas'
import { getPlotNodeKindMeta } from './kind-meta'
import { useLocaleStore } from '../../../stores/locale-store'
import './plot-graph.css'

export interface PlotNodeDetailPanelProps {
  nodeId: string | null
  nodeData: PlotGraphNodeData | null
  onClose?: () => void
  onEdit?: (nodeId: string) => void
  onDelete?: (nodeId: string) => void
  onSplit?: (nodeId: string) => void
  onEnterSubCanvas?: (nodeId: string, subCanvasId: string) => void
  onNavigateEntity?: (entity: EntitySourceRef | PlotCanvasNodeEntityRef) => void
  onOpenPlan?: (planId: number) => void
  readOnly?: boolean
}

export function PlotNodeDetailPanel({
  nodeId,
  nodeData,
  onClose,
  onEdit,
  onDelete,
  onSplit,
  onEnterSubCanvas,
  onNavigateEntity,
  onOpenPlan,
  readOnly = false,
}: PlotNodeDetailPanelProps) {
  const text = useLocaleStore(s => s.text)
  const meta = useMemo(() => getPlotNodeKindMeta(nodeData?.kind), [nodeData?.kind])
  const KindIcon = meta.icon

  if (!nodeId || !nodeData) {
    return (
      <div className="plot-graph-detail-panel" data-testid="plot-graph-detail-empty">
        <div className="plot-graph-detail-panel__header">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
            {text('节点详情', 'Node Details')}
          </span>
          {onClose && (
            <button
              type="button"
              className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)]"
              onClick={onClose}
              title={text('关闭', 'Close')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[var(--color-text-muted)]">
          <p className="text-xs">
            {text('未选中任何节点。点击画布上的节点以查看详情。', 'No node selected. Click a node on canvas to view details.')}
          </p>
        </div>
      </div>
    )
  }

  const canEnterSubCanvas = Boolean(nodeData.subCanvasId && onEnterSubCanvas)
  const displayedEntityRefs = nodeData.entityRefs?.length
    ? nodeData.entityRefs
    : nodeData.entityRef ? [nodeData.entityRef] : []
  const canNavigateEntity = Boolean(onNavigateEntity)
  const canOpenPlan = Boolean(nodeData.planId && onOpenPlan)

  return (
    <div className="plot-graph-detail-panel" data-testid="plot-graph-detail-panel">
      {/* 头部：类别与关闭 */}
      <div className="plot-graph-detail-panel__header">
        <div className="plot-graph-detail-panel__title-wrap">
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{
              backgroundColor: meta.badgeBg,
              color: meta.badgeText,
            }}
          >
            <KindIcon size={12} />
            <span>{text(meta.labelZh, meta.labelEn)}</span>
          </span>
          <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[140px]">
            {nodeId}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            onClick={onClose}
            title={text('关闭面板', 'Close panel')}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* 主体字段展示 */}
      <div className="plot-graph-detail-panel__body">
        {/* 标题 */}
        <div className="plot-graph-detail-section">
          <span className="plot-graph-detail-section__label">
            {text('标题', 'Title')}
          </span>
          <div className="text-sm font-semibold text-[var(--color-text)]">
            {nodeData.title}
          </div>
        </div>

        {/* 摘要说明 */}
        <div className="plot-graph-detail-section">
          <span className="plot-graph-detail-section__label">
            {text('摘要内容', 'Summary')}
          </span>
          <div className="plot-graph-detail-section__value whitespace-pre-wrap text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg)] p-2.5 rounded-md border border-[var(--color-border)]">
            {nodeData.summary && nodeData.summary.trim().length > 0
              ? nodeData.summary.trim()
              : <span className="italic text-[var(--color-text-muted)]">{text('（未填写摘要）', '(No summary provided)')}</span>}
          </div>
        </div>

        {/* 标签列表 */}
        {nodeData.tags && nodeData.tags.length > 0 && (
          <div className="plot-graph-detail-section">
            <span className="plot-graph-detail-section__label">
              {text('标签', 'Tags')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {nodeData.tags.map((tag, i) => (
                <span
                  key={`${tag}-${i}`}
                  className="px-2 py-0.5 rounded text-[11px] bg-[var(--color-raised)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 关联章节 */}
        {nodeData.chapterRefs && nodeData.chapterRefs.length > 0 && (
          <div className="plot-graph-detail-section">
            <span className="plot-graph-detail-section__label">
              {text('关联章节', 'Linked Chapters')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {nodeData.chapterRefs.map(chapter => (
                <span
                  key={chapter}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-success-bg,rgba(16,185,129,0.1))] text-[var(--color-success-text,#10b981)] border border-[var(--color-success-border,rgba(16,185,129,0.2))]"
                >
                  <BookOpen size={11} />
                  <span>{text(`第${chapter}章`, `Ch ${chapter}`)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 关联线索计划 */}
        {nodeData.planId !== undefined && nodeData.planId !== null && (
          <div className="plot-graph-detail-section">
            <span className="plot-graph-detail-section__label">
              {text('线索计划', 'Narrative Thread Plan')}
            </span>
            <div className="flex items-center justify-between p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)]">
              <span className="text-xs text-[var(--color-text-secondary)]">
                {text(`计划 ID: #${nodeData.planId}`, `Plan ID: #${nodeData.planId}`)}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!canOpenPlan}
                onClick={() => nodeData.planId && onOpenPlan?.(nodeData.planId)}
                title={canOpenPlan ? text('跳转到线索计划', 'Jump to plan') : text('当前环境不可跳转', 'Navigation unavailable')}
              >
                <ExternalLink size={12} />
                <span>{text('查看计划', 'View Plan')}</span>
              </button>
            </div>
          </div>
        )}

        {/* 关联子画布 */}
        {nodeData.subCanvasId && (
          <div className="plot-graph-detail-section">
            <span className="plot-graph-detail-section__label">
              {text('子画布', 'Sub-canvas')}
            </span>
            <div className="flex items-center justify-between p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)]">
              <span className="text-xs font-medium text-[var(--color-text)] truncate max-w-[150px]">
                {nodeData.subCanvasTitle || text('未命名子画布', 'Untitled sub-canvas')}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!canEnterSubCanvas}
                onClick={() => nodeData.subCanvasId && onEnterSubCanvas?.(nodeId, nodeData.subCanvasId)}
                title={canEnterSubCanvas ? text('进入该子画布', 'Enter sub-canvas') : text('不可进入', 'Unavailable')}
              >
                <CornerUpRight size={12} />
                <span>{text('进入子画布', 'Enter')}</span>
              </button>
            </div>
          </div>
        )}

        {/* 关联实体来源 */}
        {displayedEntityRefs.length > 0 && (
          <div className="plot-graph-detail-section">
            <span className="plot-graph-detail-section__label">
              {text('关联实体', 'Linked Entity')}
            </span>
            {displayedEntityRefs.map((ref, index) => <div key={index} className="flex items-center justify-between p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)]">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-[var(--color-text)] truncate">
                  {'entityType' in ref ? String(ref.entityId) : ref.name ?? String(ref.id)}
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {'entityType' in ref ? ref.entityType : ref.type}
                </span>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!canNavigateEntity}
                onClick={() => onNavigateEntity?.(ref)}
                title={canNavigateEntity ? text('跳转到关联实体', 'Jump to entity') : text('不可跳转', 'Unavailable')}
              >
                <ExternalLink size={12} />
                <span>{text('查看实体', 'View Entity')}</span>
              </button>
            </div>)}
          </div>
        )}
      </div>

      {/* 底部动作栏 */}
      {!readOnly && (
        <div className="plot-graph-detail-panel__footer">
          {onSplit && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-[var(--color-border)] hover:bg-[var(--color-hover)] text-[var(--color-text)] transition-colors"
              onClick={() => onSplit(nodeId)}
              title={text('拆分此节点为后续事件', 'Split node')}
            >
              <Scissors size={12} />
              <span>{text('拆分续接', 'Split')}</span>
            </button>
          )}

          {onEdit && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-[var(--color-border)] hover:bg-[var(--color-hover)] text-[var(--color-text)] transition-colors"
              onClick={() => onEdit(nodeId)}
              title={text('编辑节点内容与属性', 'Edit node')}
            >
              <Pencil size={12} />
              <span>{text('编辑', 'Edit')}</span>
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-[var(--color-error)] text-[var(--color-error)] hover:bg-[var(--color-error-bg,rgba(239,68,68,0.1))] transition-colors"
              onClick={() => onDelete(nodeId)}
              title={text('删除此节点', 'Delete node')}
            >
              <Trash2 size={12} />
              <span>{text('删除', 'Delete')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
