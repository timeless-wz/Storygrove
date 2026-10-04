/**
 * planning-navigation.ts
 *
 * 规划页与世界设定工具共用的返回路径。放在独立的 .ts 模块里，
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
 * 返回路径的根节点：把作者带回项目总览，或展开所属侧栏分组。
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
  const revealStorySetup = useCallback(() => revealSidebarGroup('setting'), [])
  const revealWorldSetup = useCallback(() => {
    revealSidebarGroup('setting')
    revealSidebarGroup('worldSetup')
  }, [])
  return useMemo(() => ({
    overviewLabel: text('项目总览', 'Project overview'),
    planLabel: text('创作规划', 'Writing plan'),
    storySetupLabel: text('故事设定', 'Story setup'),
    worldSetupLabel: text('世界设定', 'World setup'),
    openOverview,
    revealWritingPlan,
    revealStorySetup,
    revealWorldSetup,
  }), [openOverview, revealWritingPlan, revealStorySetup, revealWorldSetup, text])
}
