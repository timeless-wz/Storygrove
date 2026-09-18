/**
 * Sidebar — 左侧导航面板容器
 *
 * 纯路由容器，根据 sidebarView 切换子视图。
 * 所有子视图已拆分到 sidebar/ 子目录。
 */

import { useState, useEffect } from 'react'
import { ArrowLeft, FolderOpen, Home, Search } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import { ContextMenu } from '../ui/ContextMenu'
import KnowledgePanel from './KnowledgePanel'
import HomeSidebarPanel from './sidebar/HomeSidebarPanel'
import ProjectTree from './sidebar/ProjectTree'
import CharactersView from './sidebar/CharactersView'
import WorkspaceSidebarPanel from './sidebar/WorkspaceSidebarPanel'
import {
  registerMenuSetter, unregisterMenuSetter,
  type SidebarMenuState,
} from './sidebar/sidebar-menu'
import { useLocaleStore } from '../../stores/locale-store'

/** 左侧面板 */
export default function Sidebar() {
  const sidebarView = useLayoutStore(s => s.sidebarView)
  const currentProject = useProjectStore(s => s.currentProject)
  const openProject = useProjectStore(s => s.openProject)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)
  const text = useLocaleStore(s => s.text)
  // 全局右键菜单状态
  const [sidebarMenu, setSidebarMenu] = useState<SidebarMenuState | null>(null)

  // 注册 / 注销右键菜单 setter
  useEffect(() => {
    registerMenuSetter(setSidebarMenu)
    return () => { unregisterMenuSetter() }
  }, [])

  const viewTitles: Record<string, string> = {
    home:       text('主页', 'Home'),
    project:    text('创作', 'Writing'),
    workspace:  text('创作资料', 'Writing sources'),
    knowledge:  text('知识库', 'Knowledge'),
    characters: text('角色', 'Characters'),
  }

  // 全局主页只在未打开项目时出现；所有资料、知识库和角色都从当前项目资源树进入。
  const effectiveView = currentProject ? sidebarView : 'home'

  return (
    <div
      className="skin-workspace-panel w-full h-full flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--color-sidebar)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {effectiveView === 'project' ? (
        <div className="writer-project-sidebar-header writer-project-sidebar-header--compact">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className="writer-command-button"
                title={text('返回首页（项目保持打开）', 'Return home (keep project open)')}
                aria-label={text('返回首页（项目保持打开）', 'Return home (keep project open)')}
                onClick={() => setSidebarView('home')}
              >
                <Home size={15} />
              </button>
              <span className="min-w-0 truncate text-sm font-semibold" title={currentProject?.path}>{currentProject?.name}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="writer-command-button"
                title={text('切换项目', 'Switch project')}
                aria-label={text('切换项目', 'Switch project')}
                onClick={async () => {
                  const folder = await ipc.invoke('dialog:select-folder')
                  if (folder) void openProject(folder)
                }}
              >
                <FolderOpen size={15} />
              </button>
              <button
                type="button"
                className="writer-command-button"
                title={text('搜索项目资料', 'Search project materials')}
                aria-label={text('搜索项目资料', 'Search project materials')}
                onClick={() => setSidebarView('knowledge')}
              >
                <Search size={15} />
              </button>
            </div>
          </div>
        </div>
      ) : effectiveView !== 'home' ? (
        <div className="panel-header flex items-center gap-1">
          <button type="button" className="writer-command-button" title={text('返回项目资源树', 'Back to project resources')} onClick={() => setSidebarView('project')}>
            <ArrowLeft size={14} />
          </button>
          <span>{viewTitles[effectiveView]}</span>
        </div>
      ) : (
        <div className="panel-header flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><Home size={14} />{text('首页', 'Home')}</span>
          {currentProject && (
            <button
              type="button"
              className="writer-command-button max-w-[170px]"
              title={text(`返回「${currentProject.name}」工作台`, `Return to ${currentProject.name}`)}
              onClick={() => setSidebarView('project')}
            >
              <FolderOpen size={14} />
              <span className="truncate">{text('返回创作', 'Return to project')}</span>
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {effectiveView === 'home'       && <HomeSidebarPanel />}
        {effectiveView === 'project'    && <ProjectTree />}
        {effectiveView === 'workspace'  && <WorkspaceSidebarPanel />}
        {effectiveView === 'knowledge'  && <KnowledgePanel />}
        {effectiveView === 'characters' && <CharactersView />}
      </div>

      {/* 动态右键菜单 */}
      {sidebarMenu && (
        <ContextMenu
          items={sidebarMenu.items}
          position={sidebarMenu.position}
          onClose={() => setSidebarMenu(null)}
        />
      )}
    </div>
  )
}
