/**
 * Sidebar — 左侧导航面板容器
 *
 * 纯路由容器，根据 sidebarView 切换子视图。
 * 所有子视图已拆分到 sidebar/ 子目录。
 */

import { useState, useEffect } from 'react'
import { ArrowLeft, Compass, Database, FileText, FolderOpen, Home, Search, Users } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import { ContextMenu } from '../ui/ContextMenu'
import KnowledgePanel from './KnowledgePanel'
import HomeSidebarPanel from './sidebar/HomeSidebarPanel'
import ProjectTree from './sidebar/ProjectTree'
import CharactersView from './sidebar/CharactersView'
import ProjectDocumentsView from './sidebar/ProjectDocumentsView'
import WorkspaceSidebarPanel from './sidebar/WorkspaceSidebarPanel'
import { registerMenuSetter, unregisterMenuSetter, type SidebarMenuState } from './sidebar/sidebar-menu'
import { useLocaleStore } from '../../stores/locale-store'
import { Sidebar as ShadcnSidebar, SidebarHeader, SidebarContent } from '../ui/sidebar'

/** 左侧面板 */
export default function Sidebar() {
  const sidebarView = useLayoutStore(s => s.sidebarView)
  const currentProject = useProjectStore(s => s.currentProject)
  const openProject = useProjectStore(s => s.openProject)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)
  const text = useLocaleStore(s => s.text)
  const t = useLocaleStore(s => s.t)
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
    workspace:  text('资料来源与审核', 'Sources & review'),
    knowledge:  text('知识检索', 'Knowledge retrieval'),
    characters: text('角色档案', 'Character profile'),
    documents:  text('项目文档', 'Project documents'),
  }

  // 全局主页只在未打开项目时出现；所有资料、知识库和角色都从当前项目资源树进入。
  const effectiveView = currentProject ? sidebarView : 'home'

  return (
    <ShadcnSidebar
      className="literary-sidebar skin-workspace-panel w-full h-full border-r border-[var(--color-border)]"
    >
      {effectiveView === 'project' ? (
        <SidebarHeader className="writer-project-sidebar-header writer-project-sidebar-header--compact">
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
        </SidebarHeader>
      ) : effectiveView !== 'home' ? (
        <SidebarHeader className="writer-project-sidebar-header writer-project-sidebar-header--compact">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="writer-command-button group flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] active:scale-[0.97] transition-all duration-150 cursor-pointer select-none"
              title={text(currentProject ? `返回「${currentProject.name}」创作` : '返回项目资源树', currentProject ? `Return to ${currentProject.name}` : 'Back to project resources')}
              aria-label={text('返回创作', 'Return to project')}
              onClick={() => setSidebarView('project')}
            >
              <ArrowLeft
                size={14}
                className="transition-transform duration-150 group-hover:-translate-x-0.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] flex-shrink-0"
              />
              <span className="truncate">{text('返回创作', 'Return to project')}</span>
            </button>
            <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide"
                style={{
                  backgroundColor: 'var(--color-badge-bg)',
                  color: 'var(--color-accent)',
                }}
              >
                {effectiveView === 'characters' && <Users size={12} className="flex-shrink-0" />}
                {effectiveView === 'documents' && <FileText size={12} className="flex-shrink-0" />}
                {effectiveView === 'knowledge' && <Database size={12} className="flex-shrink-0" />}
                {effectiveView === 'workspace' && <Compass size={12} className="flex-shrink-0" />}
                <span className="truncate">{viewTitles[effectiveView]}</span>
              </span>
            </div>
          </div>
        </SidebarHeader>
      ) : (
        <SidebarHeader className="writer-project-sidebar-header writer-project-sidebar-header--compact">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
                style={{ backgroundColor: 'var(--color-badge-bg)', color: 'var(--color-accent)' }}
              >
                <Home size={13} />
              </span>
              <span className="text-xs font-semibold tracking-wide truncate" style={{ color: 'var(--color-text)' }}>
                {t('home.brand')}
              </span>
            </div>
            {currentProject && (
              <button
                type="button"
                className="writer-command-button flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
                style={{ color: 'var(--color-accent)' }}
                title={text(`返回「${currentProject.name}」创作`, `Return to ${currentProject.name}`)}
                onClick={() => setSidebarView('project')}
              >
                <FolderOpen size={13} />
                <span className="truncate">{text('返回创作', 'Return to project')}</span>
              </button>
            )}
          </div>
        </SidebarHeader>
      )}
      <SidebarContent className={`flex-1 ${effectiveView === 'project' || effectiveView === 'home' ? 'py-1' : 'py-0'}`}>
        {effectiveView === 'home'       && <HomeSidebarPanel />}
        {effectiveView === 'project'    && <ProjectTree />}
        {effectiveView === 'workspace'  && <WorkspaceSidebarPanel />}
        {effectiveView === 'knowledge'  && <KnowledgePanel />}
        {effectiveView === 'characters' && <CharactersView />}
        {effectiveView === 'documents'  && <ProjectDocumentsView />}
      </SidebarContent>

      {/* 动态右键菜单 */}
      {sidebarMenu && (
        <ContextMenu
          items={sidebarMenu.items}
          position={sidebarMenu.position}
          onClose={() => setSidebarMenu(null)}
        />
      )}
    </ShadcnSidebar>
  )
}
