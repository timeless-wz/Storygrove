/**
 * PlotGraphFilter — 剧情画布搜索与种类多选筛选器组件。
 *
 * 交付内容：
 * 1. 标题、摘要、标签实时全局搜索输入框；
 * 2. 搜索结果计数（“X 个匹配” 或 “无结果” 反馈），提供上一处/下一处快捷跳跃；
 * 3. 10 种节点种类多选筛选 Popover，提供 全选、清空、反选 快捷操作及各类真实数量计数；
 * 4. 浮层支持点击外部或 Esc 安全收起；
 * 5. 输入框获焦时阻止事件冒泡，杜绝与画布全局快捷键冲突。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  X,
} from 'lucide-react'

import { ALL_PLOT_NODE_KINDS, type PlotGraphFilterState, type PlotNodeKind } from './types'
import { PLOT_NODE_KIND_METAS } from './kind-meta'
import { useLocaleStore } from '../../../stores/locale-store'
import './plot-graph.css'

export interface PlotGraphFilterProps {
  filter: PlotGraphFilterState
  onFilterChange: (next: PlotGraphFilterState) => void
  /** 当前画布上各种类的统计数量 */
  kindCounts?: Record<PlotNodeKind, number>
  /** 搜索命中匹配的总数 */
  matchCount?: number
  /** 当前聚焦的搜索命中序号（1-indexed，可选） */
  currentMatchIndex?: number
  /** 导航到上一处匹配 */
  onPrevMatch?: () => void
  /** 导航到下一处匹配 */
  onNextMatch?: () => void
  /** 禁用状态 */
  disabled?: boolean
}

export function PlotGraphFilter({
  filter,
  onFilterChange,
  kindCounts,
  matchCount = 0,
  currentMatchIndex = 0,
  onPrevMatch,
  onNextMatch,
  disabled = false,
}: PlotGraphFilterProps) {
  const text = useLocaleStore(s => s.text)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const selectedCount = filter.selectedKinds.size
  const isFilterActive = selectedCount > 0 && selectedCount < ALL_PLOT_NODE_KINDS.length

  // 处理搜索框变更
  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filter,
      searchQuery: e.target.value,
    })
  }, [filter, onFilterChange])

  // 清空搜索框
  const handleClearSearch = useCallback(() => {
    onFilterChange({
      ...filter,
      searchQuery: '',
    })
  }, [filter, onFilterChange])

  // 搜索框内按键处理（Enter 下一个，Shift+Enter 上一个，Esc 清空）
  const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation() // 阻止冒泡到画布
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        onPrevMatch?.()
      } else {
        onNextMatch?.()
      }
    } else if (e.key === 'Escape') {
      handleClearSearch()
    }
  }, [handleClearSearch, onPrevMatch, onNextMatch])

  // 单选/反选单个类别
  const toggleKind = useCallback((kind: PlotNodeKind) => {
    const nextSet = filter.selectedKinds.size === 0
      ? new Set(ALL_PLOT_NODE_KINDS)
      : new Set(filter.selectedKinds)
    if (nextSet.has(kind)) {
      nextSet.delete(kind)
    } else {
      nextSet.add(kind)
    }
    // Empty means "no kind filter". Do not turn the final deselection
    // into an apparently unchanged selection of every kind.
    if (nextSet.size === 0) return
    onFilterChange({
      ...filter,
      selectedKinds: nextSet,
    })
  }, [filter, onFilterChange])

  // 全选
  const handleSelectAll = useCallback(() => {
    onFilterChange({
      ...filter,
      selectedKinds: new Set(ALL_PLOT_NODE_KINDS),
    })
  }, [filter, onFilterChange])

  // 重置为默认的全部可见状态。
  const handleClearAll = useCallback(() => {
    onFilterChange({
      ...filter,
      selectedKinds: new Set(),
    })
  }, [filter, onFilterChange])

  // 反选仅在部分种类被选中时有明确结果。
  const handleInvert = useCallback(() => {
    const nextSet = new Set<PlotNodeKind>()
    for (const kind of ALL_PLOT_NODE_KINDS) {
      if (!filter.selectedKinds.has(kind)) {
        nextSet.add(kind)
      }
    }
    onFilterChange({
      ...filter,
      selectedKinds: nextSet,
    })
  }, [filter, onFilterChange])

  // 点击外部收起
  useEffect(() => {
    if (!popoverOpen) return
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setPopoverOpen(false)
      }
    }
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [popoverOpen])

  // 搜索计数标签文案
  const counterText = useMemo(() => {
    const q = filter.searchQuery.trim()
    if (!q) return null
    if (matchCount === 0) return text('无结果', 'No matches')
    if (currentMatchIndex > 0) return `${currentMatchIndex} / ${matchCount}`
    return text(`${matchCount} 处匹配`, `${matchCount} matches`)
  }, [filter.searchQuery, matchCount, currentMatchIndex, text])

  return (
    <div className="plot-graph-filter-bar" data-testid="plot-graph-filter-bar">
      {/* 搜索输入框 */}
      <div className="plot-graph-search-box">
        <Search size={14} className="text-[var(--color-text-muted)] flex-shrink-0" />
        <input
          type="text"
          className="plot-graph-search-input"
          placeholder={text('搜索标题、摘要或标签…', 'Search title, summary or tags…')}
          value={filter.searchQuery}
          aria-label={text('搜索节点标题、摘要或标签', 'Search node title, summary, or tags')}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          disabled={disabled}
        />
        {counterText && (
          <span className="plot-graph-search-counter">
            {counterText}
          </span>
        )}
        {filter.searchQuery && matchCount > 0 && (
          <div className="flex items-center gap-0.5 ml-1">
            <button
              type="button"
              className="p-0.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              title={text('上一个 (Shift+Enter)', 'Previous match (Shift+Enter)')}
              onClick={onPrevMatch}
              disabled={!onPrevMatch}
              aria-label={text('上一个匹配', 'Previous match')}
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              className="p-0.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              title={text('下一个 (Enter)', 'Next match (Enter)')}
              onClick={onNextMatch}
              disabled={!onNextMatch}
              aria-label={text('下一个匹配', 'Next match')}
            >
              <ChevronDown size={12} />
            </button>
          </div>
        )}
        {filter.searchQuery && (
          <button
            type="button"
            className="p-0.5 rounded-full hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] ml-1"
            title={text('清除搜索 (Esc)', 'Clear search (Esc)')}
            onClick={handleClearSearch}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* 种类筛选 Trigger 按钮 */}
      <button
        ref={triggerRef}
        type="button"
        className={`plot-graph-filter-trigger ${isFilterActive || popoverOpen ? 'is-active' : ''}`}
        onClick={() => setPopoverOpen(prev => !prev)}
        disabled={disabled}
        title={text('按节点种类筛选', 'Filter by node kinds')}
      >
        <Filter size={14} />
        <span>{text('种类筛选', 'Kinds')}</span>
        {isFilterActive && (
          <span className="plot-graph-filter-badge">
            {selectedCount}
          </span>
        )}
      </button>

      {/* 种类筛选浮层 */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          className="plot-graph-filter-popover"
          onClick={e => e.stopPropagation()}
        >
          <div className="plot-graph-filter-popover__head">
            <span className="plot-graph-filter-popover__title">
              {text('节点种类筛选', 'Node Kind Filter')}
            </span>
            <span className="plot-graph-filter-popover__meta">
              {selectedCount === 0 || selectedCount === ALL_PLOT_NODE_KINDS.length
                ? text('全部可见', 'All visible')
                : text(`${selectedCount} / 10 种类`, `${selectedCount} / 10 kinds`)}
            </span>
          </div>

          {/* 快捷批量按钮 */}
          <div className="plot-graph-filter-popover__actions">
            <button
              type="button"
              className="plot-graph-filter-action-btn"
              onClick={handleSelectAll}
            >
              {text('全选', 'Select all')}
            </button>
            <button
              type="button"
              className="plot-graph-filter-action-btn"
              disabled={!isFilterActive}
              onClick={handleClearAll}
            >
              {text('重置', 'Reset')}
            </button>
            <button
              type="button"
              className="plot-graph-filter-action-btn"
              disabled={!isFilterActive}
              onClick={handleInvert}
            >
              {text('反选', 'Invert')}
            </button>
          </div>

          {/* 10 种类别 Chips 网格 */}
          <div className="plot-graph-filter-chips-grid">
            {ALL_PLOT_NODE_KINDS.map(kind => {
              const meta = PLOT_NODE_KIND_METAS[kind]
              const isSelected = selectedCount === 0 || filter.selectedKinds.has(kind)
              const count = kindCounts?.[kind] ?? 0
              const chipStyle = {
                '--chip-color': meta.accentColor,
              } as React.CSSProperties

              return (
                <button
                  key={kind}
                  type="button"
                  style={chipStyle}
                  className={`plot-graph-filter-chip ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleKind(kind)}
                  title={text(meta.descriptionZh, meta.descriptionEn)}
                >
                  <span className="plot-graph-filter-chip__dot" />
                  <span>{text(meta.labelZh, meta.labelEn)}</span>
                  <span className="plot-graph-filter-chip__count">
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
