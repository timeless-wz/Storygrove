/**
 * HomeSidebarPanel — 主页侧边栏：项目管理入口 + 最近项目列表
 */

import { ArrowRight, BookOpen, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { ipc } from '../../../services/ipc-client'
import { Button } from '../../ui/Button'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { useLocaleStore } from '../../../stores/locale-store'

export default function HomeSidebarPanel() {
  const currentProject = useProjectStore(s => s.currentProject)
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const removeRecentProject = useProjectStore(s => s.removeRecentProject)
  const deleteProject = useProjectStore(s => s.deleteProject)
  const text = useLocaleStore(s => s.text)

  const handleDeleteProject = async (project: { name: string; path: string }) => {
    const ok = await confirm(
      text(`确认删除项目「${project.name}」？\n此操作会删除该项目目录下的小说正文、故事架构、角色、蓝图、知识库和所有项目数据。`, `Delete project “${project.name}”?\nThis removes its manuscripts, architecture, characters, blueprints, knowledge base, and all project data.`),
      {
        title: text('删除项目', 'Delete project'),
        confirmText: text('删除项目', 'Delete project'),
        danger: true,
      },
    )
    if (!ok) return

    const success = await deleteProject(project.path)
    if (success) {
      toast.success(text(`项目「${project.name}」已删除`, `Project “${project.name}” deleted`))
    }
  }

  const handleRemoveRecentProject = async (project: { name: string; path: string }) => {
    const ok = await confirm(
      text(
        `确认从最近项目中移除「${project.name}」？\n这只会移除列表记录，不会删除项目文件。`,
        `Remove “${project.name}” from recent projects?\nThis only removes the list entry and does not delete project files.`,
      ),
      {
        title: text('从最近项目移除', 'Remove from recent projects'),
        confirmText: text('移除记录', 'Remove entry'),
      },
    )
    if (!ok) return

    const success = await removeRecentProject(project.path)
    if (success) {
      toast.success(text(`已从最近项目移除「${project.name}」`, `Removed “${project.name}” from recent projects`))
    }
  }

  return (
    <div className="px-3 py-2 text-sm flex flex-col h-full">
      {/* 当前项目信息：可交互卡片，点击直接进入创作 */}
      {currentProject && (
        <div
          className="group relative mb-3 p-2.5 rounded-xl border transition-all duration-150 cursor-pointer shadow-xs"
          style={{
            backgroundColor: 'var(--color-panel)',
            borderColor: 'var(--color-border)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-accent)'
            e.currentTarget.style.backgroundColor = 'var(--color-raised)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.backgroundColor = 'var(--color-panel)'
          }}
          onClick={() => useLayoutStore.getState().setSidebarView('project')}
          title={text(`点击继续创作「${currentProject.name}」`, `Click to continue writing ${currentProject.name}`)}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
              style={{ backgroundColor: 'var(--color-badge-bg)', color: 'var(--color-accent)' }}
            >
              <BookOpen size={15} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                {currentProject.name}
              </p>
              <p className="text-[0.68rem] flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--color-accent)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                {text('正在创作 · 点击进入', 'Active · Click to enter')}
              </p>
            </div>
            <button
              type="button"
              title={text('删除项目', 'Delete project')}
              aria-label={text('删除项目', 'Delete project')}
              className="writer-command-button opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              style={{ minHeight: 22, minWidth: 22, padding: 0, color: 'var(--color-error)' }}
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteProject(currentProject)
              }}
            >
              <Trash2 size={12} />
            </button>
            <ArrowRight
              size={13}
              className="flex-shrink-0 transition-transform group-hover:translate-x-0.5"
              style={{ color: 'var(--color-text-muted)' }}
            />
          </div>
        </div>
      )}

      {/* 快捷操作：网格化 2 列按钮 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Button
          variant="default"
          size="sm"
          className="h-8 text-xs font-medium flex items-center justify-center gap-1.5 rounded-lg shadow-xs"
          onClick={() => useLayoutStore.getState().openNewProject()}
        >
          <Plus size={13} />
          {text('新建项目', 'New project')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-medium flex items-center justify-center gap-1.5 rounded-lg"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={async () => {
            const folder = await ipc.invoke('dialog:select-folder')
            if (folder) {
              openProject(folder)
            }
          }}
        >
          <FolderOpen size={13} />
          {text('打开项目', 'Open project')}
        </Button>
      </div>

      {/* 最近项目列表 */}
      {recentProjects.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div
            className="flex items-center justify-between mb-2 pt-2"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {text('最近项目', 'Recent projects')}
            </span>
            <span
              className="text-[0.65rem] px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
            >
              {recentProjects.filter(p => p.path !== currentProject?.path).length}
            </span>
          </div>
          <div className="space-y-1 overflow-y-auto flex-1 pr-0.5" style={{ scrollbarWidth: 'thin' }}>
            {recentProjects
              .filter(p => p.path !== currentProject?.path)
              .slice(0, 10)
              .map((p, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                  style={{ backgroundColor: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-hover)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  onClick={() => openProject(p.path)}
                >
                  <FolderOpen size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate font-medium" style={{ color: 'var(--color-text)' }}>
                      {p.name}
                    </p>
                    <p className="text-[0.65rem] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {p.path}
                    </p>
                  </div>
                  <button
                    type="button"
                    title={text('从最近项目移除', 'Remove from recent projects')}
                    aria-label={text('从最近项目移除', 'Remove from recent projects')}
                    className="writer-command-button opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
                    style={{ minHeight: 22, minWidth: 22, padding: 0, color: 'var(--color-error)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveRecentProject(p)
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            {recentProjects.filter(p => p.path !== currentProject?.path).length === 0 && (
              <p className="text-xs px-2 py-2 opacity-50 text-center" style={{ color: 'var(--color-text-muted)' }}>
                {text('暂无其他最近项目', 'No other recent projects')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
