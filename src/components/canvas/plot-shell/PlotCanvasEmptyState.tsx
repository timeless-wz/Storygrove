/**
 * PlotCanvasEmptyState — 画布区的空状态覆盖层（纯展示）。
 *
 * 两种模式（文字与视觉贴近参考页面）：
 * - no-canvas   尚无任何画布：参考页的“选择一个剧情画布”引导，主操作
 *               是新建画布。
 * - empty-canvas 已选中空画布：参考页的“开始构建剧情”引导卡片。本轮
 *               AI 能力排除，主操作是手动新增剧情事件；`aiSlot` 预留
 *               未来 AI 初始化区域的扩展位，不传则不渲染任何 AI 入口，
 *               也不显示假的“AI 智能初始化”按钮。
 */

import { Clapperboard, Layers, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

import { useLocaleStore } from '../../../stores/locale-store'
import type { PlotCanvasEmptyStateMode } from './types'
import './plot-shell.css'

export interface PlotCanvasEmptyStateProps {
  mode: PlotCanvasEmptyStateMode
  /** no-canvas 模式的主操作：新建画布。 */
  onCreateCanvas?: () => void
  /** empty-canvas 模式的主操作：手动新增剧情事件。 */
  onAddEvent?: () => void
  addEventDisabled?: boolean
  /** 未来 AI 初始化区域的扩展位（例如占位说明或真实入口）。 */
  aiSlot?: ReactNode
  className?: string
}

export function PlotCanvasEmptyState({
  mode,
  onCreateCanvas,
  onAddEvent,
  addEventDisabled,
  aiSlot,
  className,
}: PlotCanvasEmptyStateProps) {
  const text = useLocaleStore(s => s.text)

  return (
    <div className={className ? `plot-canvas-empty ${className}` : 'plot-canvas-empty'} data-testid="plot-canvas-empty-state" data-mode={mode}>
      {mode === 'empty-canvas' && <span className="plot-canvas-empty__glow" aria-hidden="true" />}
      {mode === 'no-canvas' ? (
        <div className="plot-canvas-empty__card" data-testid="plot-canvas-empty-card">
          <span className="plot-canvas-empty__icon" aria-hidden="true">
            <Clapperboard size={30} />
          </span>
          <h3 className="plot-canvas-empty__title">{text('选择一个剧情画布', 'Select a plot canvas')}</h3>
          <p className="plot-canvas-empty__subtitle">
            {text('从左侧目录选择一个剧情画布，或创建新的剧情画布', 'Pick a canvas from the list on the left, or create a new one')}
          </p>
          <div className="plot-canvas-empty__actions">
            <button type="button" className="plot-shell__pill" onClick={onCreateCanvas} disabled={!onCreateCanvas} data-testid="plot-canvas-empty-create">
              <span className="plot-shell__pill-icon" aria-hidden="true">
                <Plus size={14} />
              </span>
              <span>{text('新增剧情画布', 'New plot canvas')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="plot-canvas-empty__card" data-testid="plot-canvas-empty-card">
          <span className="plot-canvas-empty__icon" aria-hidden="true">
            <Layers size={30} />
          </span>
          <h3 className="plot-canvas-empty__title">{text('开始构建剧情', 'Start building the plot')}</h3>
          <p className="plot-canvas-empty__subtitle">
            {text('双击画布空白处，或点击下方按钮手动添加剧情事件', 'Double-click an empty spot on the canvas, or use the button below to add plot events manually')}
          </p>
          <div className="plot-canvas-empty__actions">
            <button
              type="button"
              className="plot-shell__pill"
              onClick={onAddEvent}
              disabled={addEventDisabled || !onAddEvent}
              data-testid="plot-canvas-empty-add-event"
            >
              <span className="plot-shell__pill-icon" aria-hidden="true">
                <Plus size={14} />
              </span>
              <span>{text('新增剧情事件', 'Add plot event')}</span>
            </button>
            <span className="plot-canvas-empty__hint">{text('或双击画布手动添加', 'or double-click the canvas')}</span>
          </div>
          {aiSlot && <div className="plot-canvas-empty__slot">{aiSlot}</div>}
        </div>
      )}
    </div>
  )
}
