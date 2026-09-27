/**
 * PlotCanvasTopbar — 画布区顶部的悬浮操作条（纯展示）。
 *
 * 对照参考页面：左侧是画布类型小方块 + 画布选择器胶囊（含子画布面包屑）
 * 与“新增事件”主按钮；右侧是竖排的搜索 / 筛选 / 信息三个图标入口。
 * 无选中画布时选择器显示占位“选择剧情画布”，新增事件与各入口按
 * `*Disabled` 关闭。所有点击都通过回调上抛，不做任何假动作。
 */

import { useLayoutEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, FileText, Filter, Plus, Search, Workflow } from 'lucide-react'

import { useLocaleStore } from '../../../stores/locale-store'
import type { PlotCanvasBreadcrumbEntry } from './types'
import './plot-shell.css'

export interface PlotCanvasTopbarProps {
  /** 当前画布名；null/undefined 显示“选择剧情画布”占位。 */
  canvasName?: string | null
  /** 当前画布的祖先链（不含当前画布），按从根到直接父级排序。 */
  breadcrumb?: PlotCanvasBreadcrumbEntry[]
  onBreadcrumbSelect?: (canvasId: string) => void
  /** 打开画布选择器（由集成方渲染下拉/弹层）。 */
  onOpenCanvasSelector?: () => void
  addEventLabel?: string
  onAddEvent?: () => void
  addEventDisabled?: boolean
  searchActive?: boolean
  onToggleSearch?: () => void
  searchDisabled?: boolean
  filtersActive?: boolean
  onOpenFilters?: () => void
  filtersDisabled?: boolean
  infoActive?: boolean
  onOpenInfo?: () => void
  infoDisabled?: boolean
  className?: string
}

export function PlotCanvasTopbar({
  canvasName,
  breadcrumb = [],
  onBreadcrumbSelect,
  onOpenCanvasSelector,
  addEventLabel,
  onAddEvent,
  addEventDisabled,
  searchActive,
  onToggleSearch,
  searchDisabled,
  filtersActive,
  onOpenFilters,
  filtersDisabled,
  infoActive,
  onOpenInfo,
  infoDisabled,
  className,
}: PlotCanvasTopbarProps) {
  const text = useLocaleStore(s => s.text)
  const placeholder = text('选择剧情画布', 'Select a plot canvas')

  // 悬浮条比画布窄得多：面包屑过长时把溢出省略落在首端（根画布方向）。
  const breadcrumbRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const node = breadcrumbRef.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [breadcrumb])

  return (
    <div className={className ? `plot-shell__topbar ${className}` : 'plot-shell__topbar'} data-testid="plot-canvas-topbar">
      <div className="plot-shell__topbar-left">
        <span className="plot-shell__canvas-glyph" aria-hidden="true">
          <Workflow size={16} />
        </span>
        <button
          type="button"
          className={`plot-shell__canvas-picker${canvasName ? '' : ' plot-shell__canvas-picker--placeholder'}`}
          onClick={onOpenCanvasSelector}
          title={canvasName ?? placeholder}
          data-testid="plot-canvas-picker"
        >
          <span className="plot-shell__canvas-picker-label">{canvasName ?? placeholder}</span>
          <ChevronDown size={13} className="plot-shell__canvas-picker-caret" aria-hidden="true" />
        </button>
        {breadcrumb.length > 0 && (
          <nav
            ref={breadcrumbRef}
            className="plot-shell__breadcrumb"
            aria-label={text('画布层级', 'Canvas hierarchy')}
            data-testid="plot-canvas-breadcrumb"
          >
            {breadcrumb.map(crumb => (
              <span key={crumb.id} className="contents">
                <button
                  type="button"
                  className="plot-shell__breadcrumb-crumb"
                  onClick={() => onBreadcrumbSelect?.(crumb.id)}
                  title={crumb.name}
                >
                  {crumb.name}
                </button>
                <ChevronRight size={11} className="plot-shell__breadcrumb-sep" aria-hidden="true" />
              </span>
            ))}
          </nav>
        )}
        <button
          type="button"
          className="plot-shell__pill"
          onClick={onAddEvent}
          disabled={addEventDisabled}
          title={addEventLabel ?? text('新增事件', 'Add event')}
          data-testid="plot-canvas-add-event"
        >
          <span className="plot-shell__pill-icon" aria-hidden="true">
            <Plus size={14} />
          </span>
          <span>{addEventLabel ?? text('新增事件', 'Add event')}</span>
        </button>
      </div>

      <div className="plot-shell__topbar-right">
        <button
          type="button"
          className={`plot-shell__icon-btn${searchActive ? ' is-active' : ''}`}
          onClick={onToggleSearch}
          disabled={searchDisabled}
          title={text('搜索画布', 'Search canvas')}
          aria-label={text('搜索画布', 'Search canvas')}
          aria-pressed={searchActive}
          data-testid="plot-canvas-topbar-search"
        >
          <Search size={17} />
        </button>
        <button
          type="button"
          className={`plot-shell__icon-btn${filtersActive ? ' is-active' : ''}`}
          onClick={onOpenFilters}
          disabled={filtersDisabled}
          title={text('画布筛选', 'Canvas filters')}
          aria-label={text('画布筛选', 'Canvas filters')}
          aria-pressed={filtersActive}
          data-testid="plot-canvas-topbar-filters"
        >
          <Filter size={17} />
        </button>
        <button
          type="button"
          className={`plot-shell__icon-btn${infoActive ? ' is-active' : ''}`}
          onClick={onOpenInfo}
          disabled={infoDisabled}
          title={text('画布信息', 'Canvas info')}
          aria-label={text('画布信息', 'Canvas info')}
          aria-pressed={infoActive}
          data-testid="plot-canvas-topbar-info"
        >
          <FileText size={17} />
        </button>
      </div>
    </div>
  )
}
