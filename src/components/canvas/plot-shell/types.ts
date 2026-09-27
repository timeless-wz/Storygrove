/**
 * plot-shell 展示类型 — 剧情画布外壳组件的对外契约。
 *
 * 这里只描述"展示所需的数据形状"与回调签名：集成方把持久层（IPC/数据库）
 * 的记录映射成这些类型传入，所有变更都通过回调上抛，外壳自身不做任何
 * 持久化，也不实例化第二个 React Flow 画布。
 */

import type { ReactNode } from 'react'

/** 左侧目录里的画布条目（已经过集成方筛选/排序的展示数据）。 */
export interface PlotCanvasSidebarEntry {
  id: string
  name: string
  /** 可选的次级说明（参考项目里子画布会标注来源事件），超长自动截断。 */
  description?: string | null
  /** 层级深度，0 为顶级，用于缩进与子级图标。 */
  level?: number
  /** 是否含子画布，决定展开箭头的展示占位。 */
  hasChildren?: boolean
}

/** 左侧目录的页签（参考页面：章节 / 剧情）。 */
export type PlotCanvasSidebarTab = 'chapter' | 'plot'

/** 空状态类别：no-canvas = 尚无任何画布；empty-canvas = 已选中的画布没有事件。 */
export type PlotCanvasEmptyStateMode = 'no-canvas' | 'empty-canvas'

/** 悬浮工具栏上的单个按钮：只描述展示与状态，不携带业务行为。 */
export interface PlotCanvasToolItem {
  id: string
  /** 悬浮提示文案（参考项目的 data-tip）。 */
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
}

/** 悬浮工具栏的分组，组间渲染分隔线。 */
export interface PlotCanvasToolGroup {
  id: string
  items: PlotCanvasToolItem[]
}

/** 顶部画布选择器的祖先链条目（面包屑，不含当前画布）。 */
export interface PlotCanvasBreadcrumbEntry {
  id: string
  name: string
}

/** CreatePlotCanvasDialog 提交出去的值。 */
export interface PlotCanvasDraftValues {
  /** 必填，组件内保证非空 trim。 */
  title: string
  /** 选填，空字符串表示未填。 */
  description: string
}
