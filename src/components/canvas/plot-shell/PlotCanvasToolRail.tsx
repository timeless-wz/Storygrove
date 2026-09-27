/**
 * PlotCanvasToolRail — 画布左侧悬浮竖向工具栏（纯展示）。
 *
 * 对照参考页面的 ink-bar：白底圆角竖条、分组竖排图标按钮、组间分隔线、
 * 琥珀色选中态与右侧悬浮提示；底部一个收起按钮。工具列表完全由
 * `groups` 数据驱动（图标、提示、active/disabled 都是展示状态），点击
 * 统一经 `onToolSelect(id)` 上抛——本组件不虚构任何业务行为，集成方
 * 自行把工具 id 映射到画布交互（平移 / 框选 / 缩放 / 网格开关等）。
 */

import { ChevronsRight } from 'lucide-react'

import { useLocaleStore } from '../../../stores/locale-store'
import type { PlotCanvasToolGroup } from './types'
import './plot-shell.css'

export interface PlotCanvasToolRailProps {
  /** 分组的工具列表，组间渲染分隔线。 */
  groups: PlotCanvasToolGroup[]
  onToolSelect?: (toolId: string) => void
  /** 底部收起按钮；提供 onToggleCollapsed 时才渲染。 */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  className?: string
}

export function PlotCanvasToolRail({
  groups,
  onToolSelect,
  collapsed,
  onToggleCollapsed,
  className,
}: PlotCanvasToolRailProps) {
  const text = useLocaleStore(s => s.text)
  const visibleGroups = groups.filter(group => group.items.length > 0)

  return (
    <div
      className={className ? `plot-shell__toolrail ${className}` : 'plot-shell__toolrail'}
      data-testid="plot-canvas-toolrail"
      role="toolbar"
      aria-label={text('画布工具', 'Canvas tools')}
      aria-orientation="vertical"
    >
      {visibleGroups.map((group, groupIndex) => (
        <div key={group.id} style={{ display: 'contents' }}>
          {groupIndex > 0 && <span className="plot-shell__toolrail-divider" aria-hidden="true" />}
          <div className="plot-shell__toolrail-group">
            {group.items.map(item => (
              <button
                key={item.id}
                type="button"
                className={`plot-shell__toolrail-btn${item.active ? ' is-active' : ''}`}
                data-tip={item.label}
                aria-label={item.label}
                aria-pressed={item.active}
                disabled={item.disabled || !onToolSelect}
                onClick={() => onToolSelect?.(item.id)}
                data-testid={`plot-canvas-tool-${item.id}`}
              >
                {item.icon}
              </button>
            ))}
          </div>
        </div>
      ))}
      {onToggleCollapsed && (
        <>
          <span className="plot-shell__toolrail-divider" aria-hidden="true" />
          <button
            type="button"
            className="plot-shell__toolrail-btn plot-shell__toolrail-collapse"
            data-tip={text('收起工具栏', 'Collapse toolbar')}
            aria-label={text('收起工具栏', 'Collapse toolbar')}
            onClick={onToggleCollapsed}
            data-testid="plot-canvas-toolrail-collapse"
          >
            <ChevronsRight size={16} style={collapsed ? { transform: 'rotate(180deg)' } : undefined} />
          </button>
        </>
      )}
    </div>
  )
}
