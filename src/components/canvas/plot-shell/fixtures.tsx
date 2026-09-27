/**
 * plot-shell 展示 fixtures — 说明各组件导出接口的最小数据样例。
 *
 * 只含展示数据与默认工具组，不触达持久层。集成方可参考这里的形状把
 * 数据库记录映射为组件 props；测试与截图也直接复用这些 fixture。
 */

import {
  BoxSelect,
  FlaskConical,
  Grid3x3,
  Hand,
  Layers,
  Link2,
  Lightbulb,
  Quote,
  Search,
  Eye,
} from 'lucide-react'
import type { ReactNode } from 'react'

import type { PlotCanvasSidebarEntry, PlotCanvasToolGroup } from './types'

/** 有数据状态的画布列表样例（含顶级与子画布、长标题与描述）。 */
export const plotCanvasSidebarFixtures: PlotCanvasSidebarEntry[] = [
  { id: 'pca-1', name: '第一卷 · 归墟主线', description: '渔村灭门 → 观澜楼 → 归墟之门', level: 0, hasChildren: true },
  { id: 'pca-2', name: '藏书阁夜遇 · 子画布', description: '展开「藏书阁夜遇」事件的内部冲突', level: 1 },
  { id: 'pca-3', name: '外门大比 · 子画布', description: null, level: 1 },
  { id: 'pca-4', name: '第二卷 · 潮汐暗流与观澜楼继承权之争的漫长布局', level: 0 },
]

/** 空列表样例。 */
export const emptyPlotCanvasFixtures: PlotCanvasSidebarEntry[] = []

/**
 * 默认工具组：标签与分组对照参考页面的悬浮工具栏（灵感 / 结构 /
 * 画布交互 / 视图）。id 只在本外壳内作回调键使用，业务语义由集成方
 * 自行接线；这里不虚构参考页面中不存在的工具。
 */
export function createDefaultPlotCanvasToolGroups(options: {
  activeToolId?: string | null
  dotGridActive?: boolean
  dotGridDisabled?: boolean
} = {}): PlotCanvasToolGroup[] {
  const { activeToolId, dotGridActive, dotGridDisabled } = options
  const withState = (id: string, label: string, node: ReactNode) => ({
    id,
    label,
    icon: node,
    active: activeToolId === id,
  })
  return [
    {
      id: 'inspiration',
      items: [
        withState('inspiration-reserve', '灵感储备', <FlaskConical size={16} />),
        withState('inspiration-idea', '灵感', <Lightbulb size={16} />),
        withState('inspiration-foreshadow', '伏笔', <Eye size={16} />),
        withState('inspiration-snippet', '片段', <Quote size={16} />),
      ],
    },
    {
      id: 'structure',
      items: [
        withState('chapter-ref', '章节引用', <Link2 size={16} />),
        withState('asset', '素材', <Layers size={16} />),
      ],
    },
    {
      id: 'canvas-tools',
      items: [
        withState('pan', '平移画布', <Hand size={16} />),
        withState('select', '框选', <BoxSelect size={16} />),
        withState('zoom', '缩放', <Search size={16} />),
        {
          id: 'dot-grid',
          label: '背景网格',
          icon: <Grid3x3 size={16} />,
          active: dotGridActive,
          disabled: dotGridDisabled,
        },
      ],
    },
  ]
}
