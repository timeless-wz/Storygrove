/**
 * PlotCanvasShell — 剧情画布外壳布局（纯展示）。
 *
 * 承载参考页面的整体骨架：左侧圆角目录（可折叠成细条）、主画布区
 * （顶部悬浮操作条 + 左侧悬浮工具栏 + 画布主体 + 空状态覆盖层）与
 * 右侧信息面板。画布本体（React Flow 实例）通过 `canvas` ReactNode
 * 插槽注入，外壳不实例化第二个画布；顶部/工具栏/空状态/右栏也都
 * 是插槽，由集成方用本目录的展示组件装配，或换成任意自定义节点。
 */

import { PanelLeftOpen } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import { useLocaleStore } from '../../../stores/locale-store'
import './plot-shell.css'

export interface PlotCanvasShellProps {
  /** 左侧目录（通常放 PlotCanvasSidebar）。 */
  sidebar?: ReactNode
  /** 顶部悬浮操作条（通常放 PlotCanvasTopbar），绝对定位在画布上方。 */
  topbar?: ReactNode
  /** 左侧悬浮工具栏（通常放 PlotCanvasToolRail）。 */
  toolRail?: ReactNode
  /** 空状态覆盖层（通常放 PlotCanvasEmptyState）。 */
  emptyOverlay?: ReactNode
  /** 画布主体插槽：实际 React Flow 画布由集成方传入。 */
  canvas?: ReactNode
  /** 右侧面板（通常放 PlotCanvasInfoPanel）。 */
  rightPanel?: ReactNode
  /** 目录折叠态：隐藏 sidebar 插槽并显示展开细条。 */
  sidebarCollapsed?: boolean
  onSidebarExpand?: () => void
  className?: string
  style?: CSSProperties
}

export function PlotCanvasShell({
  sidebar,
  topbar,
  toolRail,
  emptyOverlay,
  canvas,
  rightPanel,
  sidebarCollapsed,
  onSidebarExpand,
  className,
  style,
}: PlotCanvasShellProps) {
  const text = useLocaleStore(s => s.text)

  return (
    <div className={className ? `plot-shell ${className}` : 'plot-shell'} style={style} data-testid="plot-canvas-shell">
      {sidebarCollapsed ? (
        <div className="plot-shell__sidebar-rail" data-testid="plot-canvas-shell-sidebar-rail">
          {onSidebarExpand && (
            <button
              type="button"
              className="plot-canvas-sidebar__collapse"
              title={text('展开目录', 'Expand panel')}
              aria-label={text('展开目录', 'Expand panel')}
              onClick={onSidebarExpand}
              data-testid="plot-canvas-shell-sidebar-expand"
            >
              <PanelLeftOpen size={15} />
            </button>
          )}
        </div>
      ) : (
        <div className="plot-shell__sidebar" data-testid="plot-canvas-shell-sidebar">{sidebar}</div>
      )}

      <div className="plot-shell__main">
        <div className="plot-shell__canvas-host plot-shell__canvas-host--dotted" data-testid="plot-canvas-shell-canvas-host">
          {canvas}
        </div>
        {topbar}
        {toolRail}
        {emptyOverlay}
      </div>

      {rightPanel && <div className="plot-shell__right-panel">{rightPanel}</div>}
    </div>
  )
}
