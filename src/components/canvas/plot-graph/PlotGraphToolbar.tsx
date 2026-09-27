/**
 * PlotGraphToolbar — 剧情画布左侧悬浮工具条与交互模式逻辑。
 *
 * 交付内容：
 * 1. 拖动画布（Pan / 🖐️）与框选模式（Select / 🔲）互斥切换；
 * 2. 缩放操作：放大（Zoom In）、缩小（Zoom Out）、适应画布（Fit View）、居中原点（Center View）；
 * 3. 背景网格点阵开关（Grid Toggle）；
 * 4. 搜索定位呼出快捷入口；
 * 5. 工具条折叠/展开收拢开关；
 * 6. 全局快捷键智能接管：输入框（Input / Textarea / ContentEditable）获焦时严防拦截，保证不冲突。
 */

import { useCallback, useEffect, useState, type RefObject } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Grid3X3,
  Hand,
  Link2,
  Maximize2,
  MousePointer,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import type { CanvasInteractionMode } from './types'
import { useLocaleStore } from '../../../stores/locale-store'
import './plot-graph.css'

export interface PlotGraphToolbarProps {
  /** 当前交互模式 */
  interactionMode: CanvasInteractionMode
  onInteractionModeChange: (mode: CanvasInteractionMode) => void
  /** 是否显示背景点阵网格 */
  showGrid: boolean
  onToggleGrid: () => void
  /** 适应全画布视图 */
  onFitView?: () => void
  /** 视图居中 */
  onCenterView?: () => void
  /** 放大 */
  onZoomIn?: () => void
  /** 缩小 */
  onZoomOut?: () => void
  /** 呼出/聚焦搜索栏 */
  onFocusSearch?: () => void
  /** 是否允许快捷键 */
  enableShortcuts?: boolean
  /** Keyboard shortcuts only apply while focus is inside this canvas host. */
  shortcutScopeRef?: RefObject<HTMLElement | null>
}

/**
 * 严格检测当前是否处于文本输入态，保证快捷键绝不与输入框冲突。
 * 兼容 Node 环境与不同 DOM 视口。
 */
export function isTypingInInput(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el) return false

  const tagName = el.tagName ? String(el.tagName).toUpperCase() : ''
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true

  if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) return true
  if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) return true
  if ((el as HTMLElement).isContentEditable) return true

  return false
}

export function PlotGraphToolbar({
  interactionMode,
  onInteractionModeChange,
  showGrid,
  onToggleGrid,
  onFitView,
  onCenterView,
  onZoomIn,
  onZoomOut,
  onFocusSearch,
  enableShortcuts = false,
  shortcutScopeRef,
}: PlotGraphToolbarProps) {
  const text = useLocaleStore(s => s.text)
  const [collapsed, setCollapsed] = useState(false)

  // 快捷键监听
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enableShortcuts || e.defaultPrevented) return
    if (!shortcutScopeRef?.current?.contains(e.target as Node)) return
    if (isTypingInInput()) return

    const key = e.key.toLowerCase()
    const isCtrlOrCmd = e.ctrlKey || e.metaKey

    // Ctrl+F / Cmd+F: 呼出搜索
    if (isCtrlOrCmd && key === 'f' && onFocusSearch) {
      e.preventDefault()
      onFocusSearch?.()
      return
    }

    if (!isCtrlOrCmd && !e.altKey && !e.shiftKey) {
      if (key === 'h') {
        e.preventDefault()
        onInteractionModeChange('pan')
      } else if (key === 'v') {
        e.preventDefault()
        onInteractionModeChange('select')
      } else if (key === 'l') {
        e.preventDefault()
        onInteractionModeChange('connect')
      } else if (key === 'g') {
        e.preventDefault()
        onToggleGrid()
      } else if (key === '+' || key === '=') {
        e.preventDefault()
        onZoomIn?.()
      } else if (key === '-') {
        e.preventDefault()
        onZoomOut?.()
      } else if (key === '0') {
        e.preventDefault()
        onFitView?.()
      }
    }
  }, [
    enableShortcuts,
    shortcutScopeRef,
    onInteractionModeChange,
    onToggleGrid,
    onZoomIn,
    onZoomOut,
    onFitView,
    onFocusSearch,
  ])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  if (collapsed) {
    return (
      <div className="plot-graph-toolbar" data-testid="plot-graph-toolbar-collapsed">
        <button
          type="button"
          className="plot-graph-toolbar__btn"
          onClick={() => setCollapsed(false)}
          title={text('展开画布工具条', 'Expand toolbar')}
          aria-label={text('展开画布工具条', 'Expand toolbar')}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="plot-graph-toolbar" data-testid="plot-graph-toolbar">
      {/* 模式切换：拖动画布 (Pan) */}
      <button
        type="button"
        className={`plot-graph-toolbar__btn ${interactionMode === 'pan' ? 'is-active' : ''}`}
        onClick={() => onInteractionModeChange('pan')}
        title={text('平移/拖动画布模式 (H)', 'Pan canvas mode (H)')}
        aria-label={text('平移/拖动画布模式', 'Pan canvas mode')}
      >
        <Hand size={16} />
      </button>

      {/* 模式切换：框选 (Select) */}
      <button
        type="button"
        className={`plot-graph-toolbar__btn ${interactionMode === 'select' ? 'is-active' : ''}`}
        onClick={() => onInteractionModeChange('select')}
        title={text('框选/选择模式 (V)', 'Box selection mode (V)')}
        aria-label={text('框选/选择模式', 'Box selection mode')}
      >
        <MousePointer size={16} />
      </button>

      <button
        type="button"
        className={`plot-graph-toolbar__btn ${interactionMode === 'connect' ? 'is-active' : ''}`}
        onClick={() => onInteractionModeChange('connect')}
        title={text('连线模式：依次点击起点和终点 (L)', 'Connect mode: click a source, then a target (L)')}
        aria-label={text('连线模式', 'Connect mode')}
        aria-pressed={interactionMode === 'connect'}
        data-testid="plot-canvas-connect-tool"
      >
        <Link2 size={16} />
      </button>

      <div className="plot-graph-toolbar__divider" />

      {/* 视图控制：放大 */}
      {onZoomIn && (
        <button
          type="button"
          className="plot-graph-toolbar__btn"
          onClick={onZoomIn}
          title={text('放大 (+)', 'Zoom in (+)')}
          aria-label={text('放大', 'Zoom in')}
        >
          <ZoomIn size={16} />
        </button>
      )}

      {/* 视图控制：缩小 */}
      {onZoomOut && (
        <button
          type="button"
          className="plot-graph-toolbar__btn"
          onClick={onZoomOut}
          title={text('缩小 (-)', 'Zoom out (-)')}
          aria-label={text('缩小', 'Zoom out')}
        >
          <ZoomOut size={16} />
        </button>
      )}

      {/* 视图控制：适应全屏 */}
      {onFitView && (
        <button
          type="button"
          className="plot-graph-toolbar__btn"
          onClick={onFitView}
          title={text('适应画布/全部显示 (0)', 'Fit view to canvas (0)')}
          aria-label={text('适应画布', 'Fit view')}
        >
          <Maximize2 size={15} />
        </button>
      )}

      {/* 视图控制：居中 */}
      {onCenterView && (
        <button
          type="button"
          className="plot-graph-toolbar__btn"
          onClick={onCenterView}
          title={text('居中视角', 'Center view')}
          aria-label={text('居中视角', 'Center view')}
        >
          <Crosshair size={15} />
        </button>
      )}

      <div className="plot-graph-toolbar__divider" />

      {/* 点阵网格开关 */}
      <button
        type="button"
        className={`plot-graph-toolbar__btn ${showGrid ? 'is-active' : ''}`}
        onClick={onToggleGrid}
        title={text('点阵网格开关 (G)', 'Toggle grid dots (G)')}
        aria-label={text('点阵网格开关', 'Toggle grid dots')}
      >
        <Grid3X3 size={15} />
      </button>

      {/* 搜索定位呼出按钮 */}
      {onFocusSearch && (
        <button
          type="button"
          className="plot-graph-toolbar__btn"
          onClick={onFocusSearch}
          title={text('搜索定位 (Ctrl+F)', 'Search on canvas (Ctrl+F)')}
          aria-label={text('搜索定位', 'Search on canvas')}
        >
          <Search size={15} />
        </button>
      )}

      <div className="plot-graph-toolbar__divider" />

      {/* 折叠按钮 */}
      <button
        type="button"
        className="plot-graph-toolbar__btn"
        onClick={() => setCollapsed(true)}
        title={text('收起工具条', 'Collapse toolbar')}
        aria-label={text('收起工具条', 'Collapse toolbar')}
      >
        <ChevronLeft size={16} />
      </button>
    </div>
  )
}
