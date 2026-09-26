/**
 * planning-navigation.ts
 *
 * 创作规划区域五个页面共用的返回路径。放在独立的 .ts 模块里，
 * 让 PlanningPageShell.tsx 只导出组件，Fast Refresh 才能在编辑外壳时保留状态。
 */

import { useCallback, useMemo } from 'react'

import { useEditorStore } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'

/**
 * 在侧边栏中定位到某个分组并展开它。
 *
 * setSidebarView 在「已经停在该视图」时会切换侧栏开合，因此这里只在视图确实
 * 不同的时候才调用它，避免点一下返回路径反而把侧边栏关掉。
 */
export function revealSidebarGroup(groupId: string): void {
  const layout = useLayoutStore.getState()
  if (layout.sidebarView !== 'project') layout.setSidebarView('project')
  layout.setSidebarOpen(true)
  layout.setProjectTreeGroupOpen(groupId, true)
}

/**
 * 返回路径的根节点：把作者带回项目总览标签页，或直接展开项目树里的创作规划分组。
 * 五个规划页面共用同一条返回路径，避免每页各写一套「怎么回去」。
 */
export function usePlanningBackPath() {
  const text = useLocaleStore(s => s.text)
  const openOverview = useCallback(() => {
    const projectKey = useProjectStore.getState().currentProject?.path
    useEditorStore.getState().openFile({
      id: 'project-overview',
      name: useLocaleStore.getState().text('项目总览', 'Project overview'),
      type: 'overview',
      ...(projectKey ? { projectKey } : {}),
    })
  }, [])
  const revealWritingPlan = useCallback(() => revealSidebarGroup('plan'), [])
  return useMemo(() => ({
    overviewLabel: text('项目总览', 'Project overview'),
    planLabel: text('创作规划', 'Writing plan'),
    openOverview,
    revealWritingPlan,
  }), [openOverview, revealWritingPlan, text])
}
