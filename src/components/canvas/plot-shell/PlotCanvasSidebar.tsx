/**
 * PlotCanvasSidebar — 剧情画布外壳的左侧目录（纯展示）。
 *
 * 结构与视觉对照参考项目的剧情目录：品牌区（剧情编排 / 剧情画布 · 子画布）、
 * 章节/剧情页签、薄荷绿“新增剧情画布”按钮、搜索框、画布计数与画布列表
 * （层级缩进、长标题截断、描述次行、选中高亮）、空列表状态。
 *
 * 数据由集成方映射后传入：`canvases` 是已按搜索过滤的展示列表，
 * `totalCount` 是未过滤总数（用于「N 个画布 / M 匹配」）。所有交互
 * （切换页签、搜索、选中、新建、收起）都通过回调上抛，本组件不持有
 * 持久化状态。
 */

import { Clapperboard, Film, Search, X, ChevronsLeft } from 'lucide-react'

import { useLocaleStore } from '../../../stores/locale-store'
import type { PlotCanvasSidebarEntry, PlotCanvasSidebarTab } from './types'
import './plot-shell.css'

export interface PlotCanvasSidebarProps {
  /** 当前页签（章节 / 剧情），展示态由父级持有。 */
  activeTab: PlotCanvasSidebarTab
  onTabChange?: (tab: PlotCanvasSidebarTab) => void
  /** 已过滤的画布展示列表。 */
  canvases: PlotCanvasSidebarEntry[]
  /** 未过滤的画布总数，用于计数行。 */
  totalCount: number
  searchValue: string
  onSearchChange?: (value: string) => void
  selectedCanvasId?: string | null
  onSelectCanvas?: (canvasId: string) => void
  onCreateCanvas?: () => void
  createDisabled?: boolean
  onCollapse?: () => void
  className?: string
}

const TAB_ITEMS: Array<{ key: PlotCanvasSidebarTab; icon: typeof Film }> = [
  { key: 'chapter', icon: Film },
  { key: 'plot', icon: Clapperboard },
]

export function PlotCanvasSidebar({
  activeTab,
  onTabChange,
  canvases,
  totalCount,
  searchValue,
  onSearchChange,
  selectedCanvasId,
  onSelectCanvas,
  onCreateCanvas,
  createDisabled,
  onCollapse,
  className,
}: PlotCanvasSidebarProps) {
  const text = useLocaleStore(s => s.text)
  const isSearching = searchValue.trim().length > 0
  const matchCount = canvases.length

  return (
    <div className={className ? `plot-canvas-sidebar ${className}` : 'plot-canvas-sidebar'} data-testid="plot-canvas-sidebar">
      <div className="plot-canvas-sidebar__brand">
        <span className="plot-canvas-sidebar__brand-icon" aria-hidden="true">
          <Clapperboard size={15} />
        </span>
        <span className="plot-canvas-sidebar__brand-text">
          <span className="plot-canvas-sidebar__brand-title">{text('剧情编排', 'Plot studio')}</span>
          <span className="plot-canvas-sidebar__brand-subtitle">
            {activeTab === 'plot'
              ? text('剧情画布 / 子画布', 'Plot canvases / sub-canvases')
              : text('章节结构 / 场景编排', 'Chapter structure / scenes')}
          </span>
        </span>
        {onCollapse && (
          <button
            type="button"
            className="plot-canvas-sidebar__collapse"
            title={text('收起目录', 'Collapse panel')}
            aria-label={text('收起目录', 'Collapse panel')}
            onClick={onCollapse}
            data-testid="plot-canvas-sidebar-collapse"
          >
            <ChevronsLeft size={14} />
          </button>
        )}
      </div>

      <div className="plot-canvas-sidebar__tabs" role="tablist" aria-label={text('目录类型', 'Outline type')}>
        {TAB_ITEMS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={`plot-canvas-sidebar__tab${activeTab === key ? ' is-active' : ''}`}
            onClick={() => onTabChange?.(key)}
            data-testid={`plot-canvas-sidebar-tab-${key}`}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{key === 'chapter' ? text('章节', 'Chapters') : text('剧情', 'Plot')}</span>
          </button>
        ))}
      </div>

      <div className="plot-canvas-sidebar__actions">
        <button
          type="button"
          className="plot-canvas-sidebar__create"
          onClick={onCreateCanvas}
          disabled={createDisabled}
          data-testid="plot-canvas-create-entry"
        >
          <span className="plot-canvas-sidebar__create-icon" aria-hidden="true">+</span>
          <span>{text('新增剧情画布', 'New plot canvas')}</span>
        </button>
      </div>

      <div className="plot-canvas-sidebar__search">
        <Search size={12} className="plot-canvas-sidebar__search-icon" aria-hidden="true" />
        <input
          type="search"
          className="plot-canvas-sidebar__search-input"
          value={searchValue}
          onChange={event => onSearchChange?.(event.target.value)}
          placeholder={text('搜索剧情画布…', 'Search canvases…')}
          aria-label={text('搜索剧情画布', 'Search canvases')}
          data-testid="plot-canvas-sidebar-search"
        />
        {isSearching && (
          <button
            type="button"
            className="plot-canvas-sidebar__search-clear"
            aria-label={text('清除搜索', 'Clear search')}
            onClick={() => onSearchChange?.('')}
          >
            <X size={10} />
          </button>
        )}
      </div>

      <div className="plot-canvas-sidebar__count-row" data-testid="plot-canvas-sidebar-count">
        <span>{text(`${totalCount} 个画布`, `${totalCount} canvas(es)`)}</span>
        {isSearching && (
          <span>{text(`${matchCount} 匹配`, `${matchCount} match(es)`)}</span>
        )}
      </div>

      <div className="plot-canvas-sidebar__list" data-testid="plot-canvas-sidebar-list" role="list" aria-label={text('剧情画布列表', 'Plot canvas list')}>
        {canvases.length === 0 ? (
          <div className="plot-canvas-sidebar__empty" data-testid="plot-canvas-sidebar-empty">
            <span className="plot-canvas-sidebar__empty-icon" aria-hidden="true">📭</span>
            <span>{isSearching ? text('未找到匹配的画布', 'No matching canvases') : text('暂无剧情画布', 'No plot canvases yet')}</span>
          </div>
        ) : (
          canvases.map(canvas => {
            const level = canvas.level ?? 0
            const selected = canvas.id === selectedCanvasId
            const Icon = level > 0 ? Film : Clapperboard
            return (
              <div
                key={canvas.id}
                className="plot-canvas-sidebar__item"
                role="listitem"
                data-testid="plot-canvas-sidebar-item"
                data-canvas-id={canvas.id}
              >
                {Array.from({ length: level }).map((_, index) => (
                  <span key={index} className="plot-canvas-sidebar__item-indent" aria-hidden="true" />
                ))}
                <button
                  type="button"
                  className={`plot-canvas-sidebar__item-btn${selected ? ' is-selected' : ''}`}
                  onClick={() => onSelectCanvas?.(canvas.id)}
                  title={canvas.name}
                  aria-current={selected ? 'true' : undefined}
                >
                  <span className="plot-canvas-sidebar__item-icon" aria-hidden="true">
                    <Icon size={12} />
                  </span>
                  <span className="plot-canvas-sidebar__item-body">
                    <span className="plot-canvas-sidebar__item-title">{canvas.name}</span>
                    {canvas.description && (
                      <span className="plot-canvas-sidebar__item-desc">{canvas.description}</span>
                    )}
                  </span>
                  {canvas.hasChildren && (
                    <span className="plot-canvas-sidebar__item-arrow" aria-hidden="true">›</span>
                  )}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
