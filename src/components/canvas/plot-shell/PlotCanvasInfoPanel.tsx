/**
 * PlotCanvasInfoPanel — 画布信息面板的纯展示外壳。
 *
 * 对照参考页面右上“画布信息”入口展开的面板：画布标题、描述、
 * 节点/连线数量与空画布提示。真实数据由集成方后续填入；`children`
 * 预留给事件列表等更丰富的内容，本组件不做任何数据加载。
 */

import { Film, Workflow, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { useLocaleStore } from '../../../stores/locale-store'
import './plot-shell.css'

export interface PlotCanvasInfoPanelProps {
  /** 当前画布名；空时显示占位标题。 */
  canvasName?: string | null
  description?: string | null
  nodeCount?: number
  edgeCount?: number
  onClose?: () => void
  /** 预留给集成方的额外内容（事件列表、AI 状态等）。 */
  children?: ReactNode
  className?: string
}

export function PlotCanvasInfoPanel({
  canvasName,
  description,
  nodeCount = 0,
  edgeCount = 0,
  onClose,
  children,
  className,
}: PlotCanvasInfoPanelProps) {
  const text = useLocaleStore(s => s.text)

  return (
    <div className={className ? `plot-canvas-info ${className}` : 'plot-canvas-info'} data-testid="plot-canvas-info-panel">
      <div className="plot-canvas-info__header">
        <span className="plot-canvas-info__title">{text('画布信息', 'Canvas info')}</span>
        {onClose && (
          <button
            type="button"
            className="plot-canvas-info__close"
            onClick={onClose}
            aria-label={text('关闭画布信息', 'Close canvas info')}
            data-testid="plot-canvas-info-close"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="plot-canvas-info__body">
        <span className="plot-canvas-info__canvas-name" data-testid="plot-canvas-info-name">
          {canvasName ?? text('未选择画布', 'No canvas selected')}
        </span>
        <p
          className={`plot-canvas-info__desc${description ? '' : ' plot-canvas-info__desc--placeholder'}`}
          data-testid="plot-canvas-info-desc"
        >
          {description || text('暂无描述。', 'No description yet.')}
        </p>
        <div className="plot-canvas-info__stats" data-testid="plot-canvas-info-stats">
          <span className="plot-canvas-info__stat">
            <Workflow size={11} aria-hidden="true" />
            {text(`${nodeCount} 个剧情事件`, `${nodeCount} plot event(s)`)}
          </span>
          <span className="plot-canvas-info__stat">
            <Film size={11} aria-hidden="true" />
            {text(`${edgeCount} 条连线`, `${edgeCount} connection(s)`)}
          </span>
        </div>
        {nodeCount === 0 && (
          <div className="plot-canvas-info__empty" data-testid="plot-canvas-info-empty">
            {text(
              '该画布还没有剧情事件。点击顶部「新增事件」，或双击画布空白处手动添加。',
              'This canvas has no plot events yet. Click “Add event” above, or double-click an empty spot on the canvas.',
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
