/**
 * plot-shell — 剧情画布展示外壳的统一出口。
 *
 * 本目录只提供 UI 结构与样式（不含数据加载与持久化）：
 * - `PlotCanvasShell` 负责布局骨架，画布本体经 `canvas` ReactNode 插槽
 *   注入（由集成方实例化唯一的 React Flow）。
 * - 其余组件为可独立使用的展示件，全部交互经回调上抛。
 * 集成示例见 `fixtures.tsx` 与 `__tests__/plot-shell.browser.tsx`。
 */

export { PlotCanvasShell, type PlotCanvasShellProps } from './PlotCanvasShell'
export { PlotCanvasSidebar, type PlotCanvasSidebarProps } from './PlotCanvasSidebar'
export { PlotCanvasTopbar, type PlotCanvasTopbarProps } from './PlotCanvasTopbar'
export { PlotCanvasToolRail, type PlotCanvasToolRailProps } from './PlotCanvasToolRail'
export { PlotCanvasEmptyState, type PlotCanvasEmptyStateProps } from './PlotCanvasEmptyState'
export { CreatePlotCanvasDialog, type CreatePlotCanvasDialogProps } from './CreatePlotCanvasDialog'
export { PlotCanvasInfoPanel, type PlotCanvasInfoPanelProps } from './PlotCanvasInfoPanel'
export {
  createDefaultPlotCanvasToolGroups,
  plotCanvasSidebarFixtures,
  emptyPlotCanvasFixtures,
} from './fixtures'
export type {
  PlotCanvasSidebarEntry,
  PlotCanvasSidebarTab,
  PlotCanvasEmptyStateMode,
  PlotCanvasToolItem,
  PlotCanvasToolGroup,
  PlotCanvasBreadcrumbEntry,
  PlotCanvasDraftValues,
} from './types'
