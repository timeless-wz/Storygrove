import { ArrowRight, BookOpen, Compass, Feather, FileUp, FolderOpen, Plus } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { useLayoutStore } from '../../stores/layout-store'
import { APP_BRAND } from '../../shared/brand'
import { useLocaleStore } from '../../stores/locale-store'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

/** Bookshelf connected to the existing project actions and local recent-project list. */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel }: WelcomePageProps) {
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)
  const workspaceStatus = useWorkspaceHubStore(s => s.status)
  const text = useLocaleStore(s => s.text)

  return (
    <div className="writer-shell-surface skin-workspace-page literary-home w-full h-full overflow-y-auto">
      <div className="literary-home-inner">
        <header className="literary-home-heading">
          <div className="literary-eyebrow"><Feather size={15} />{text('我的创作空间', 'MY WRITING SPACE')}</div>
          <span>{text('让灵感落在纸上', 'Make room for your next story')}</span>
        </header>
        <section className="literary-hero" aria-labelledby="welcome-title">
          <div className="literary-hero-copy">
            <span className="literary-eyebrow">{text(APP_BRAND.zhName, APP_BRAND.enName)}</span>
            <h1 id="welcome-title">{text('每个故事，都从一页开始。', 'Every story begins with a page.')}</h1>
            <p>{text('构筑一个世界，遇见笔下的人。让今天的灵感，成为下一章的开头。', 'Build a world. Meet your characters. Let today’s inspiration become your next chapter.')}</p>
            <button type="button" className="literary-hero-action" onClick={currentProject ? () => useLayoutStore.getState().setSidebarView('project') : onNewProject}>
              {currentProject ? <BookOpen size={16} /> : <Plus size={16} />}
              {currentProject ? text('继续创作', 'Continue writing') : text('开始新的故事', 'Start a new story')}
              <ArrowRight size={15} />
            </button>
            {currentProject && <span className="literary-current-title" title={currentProject.path}>{currentProject.name}</span>}
          </div>
          <div className="literary-hero-art" aria-hidden="true">
            <div className="literary-orbit" />
            <div className="literary-display-book"><Feather size={28} strokeWidth={1} /><span>{text('故事\n未完待续', 'A STORY\nUNFOLDING')}</span><small>{text('写下你的世界', 'YOUR WORLD IN WORDS')}</small></div>
            <div className="literary-book-shadow" />
          </div>
        </section>
        <section className="literary-quick-actions" aria-label={text('项目操作', 'Project actions')}>
          <button type="button" className="literary-action-card" onClick={onNewProject}>
            <span className="literary-action-icon"><Plus size={20} /></span>
            <span><strong>{text('新建项目', 'New project')}</strong><small>{text('从一个灵感，开始一部小说', 'Turn an idea into a novel')}</small></span><ArrowRight size={16} />
          </button>
          <button type="button" className="literary-action-card" onClick={onOpenProject}>
            <span className="literary-action-icon"><FolderOpen size={20} /></span>
            <span><strong>{text('打开项目', 'Open project')}</strong><small>{text('回到熟悉的故事与人物', 'Return to a familiar world')}</small></span><ArrowRight size={16} />
          </button>
          {onImportNovel && <button type="button" className="literary-action-card" onClick={onImportNovel}>
            <span className="literary-action-icon"><FileUp size={20} /></span>
            <span><strong>{text('拆解仿写', 'Style study')}</strong><small>{text('从参考作品中汲取写作灵感', 'Learn from a reference novel')}</small></span><ArrowRight size={16} />
          </button>}
        </section>
        <section aria-labelledby="bookshelf-title">
          <div className="literary-section-heading">
            <div><span className="literary-eyebrow">{text('故事在这里生长', 'A PLACE FOR YOUR STORIES')}</span><h2 id="bookshelf-title">{text('我的书架', 'My bookshelf')}</h2></div>
            <span>{text(`${recentProjects.length} 部最近作品`, `${recentProjects.length} recent projects`)}</span>
          </div>
          {recentProjects.length > 0 ? (
            <div className="literary-bookshelf">
              {recentProjects.map((project) => (
                <button key={project.path} type="button" className="literary-project-card" onClick={() => void openProject(project.path)} title={project.path}>
                  <span className="literary-book-cover" aria-hidden="true"><Feather size={19} strokeWidth={1} /><strong>{project.name}</strong><span>{text('长篇创作', 'FICTION')}</span></span>
                  <span className="literary-project-info">
                    <small>{project.path === currentProject?.path ? text('当前正在创作', 'CURRENT PROJECT') : text('最近项目', 'RECENT PROJECT')}</small>
                    <strong>{project.name}</strong><span className="literary-project-path">{project.path}</span>
                    <span className="literary-project-open">{text('翻开故事', 'Open story')}<ArrowRight size={14} /></span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="literary-empty-shelf">
              <BookOpen size={32} strokeWidth={1.2} />
              <h3>{text('书架的第一格，留给你的故事', 'A place for your first story')}</h3>
              <p>{text('新建一部小说，或打开已有项目，就能在这里继续创作。', 'Create a novel or open an existing project to begin filling your bookshelf.')}</p>
              <button type="button" className="literary-text-action" onClick={onNewProject}>{text('创建第一部作品', 'Create your first project')}<ArrowRight size={14} /></button>
            </div>
          )}
        </section>
        {currentProject && (
          <button type="button" className="literary-hub-card" onClick={() => useLayoutStore.getState().setSidebarView('workspace')}>
            <span className="literary-action-icon"><Compass size={22} /></span>
            <span><strong>{text('长篇创作中枢', 'Long-form Fiction Workspace')}</strong><small>{workspaceStatus?.externalWorkspacePath
              ? text(`已索引 ${workspaceStatus.recognizedFiles} / ${workspaceStatus.totalFiles} 个文件 · ${workspaceStatus.confirmedRulesCount} 条已确认规则`, `Indexed ${workspaceStatus.recognizedFiles} / ${workspaceStatus.totalFiles} files · ${workspaceStatus.confirmedRulesCount} confirmed rules`)
              : text('关联创作资料，让设定与章节彼此呼应', 'Connect your source materials with your chapters')}</small></span>
            <span className="literary-project-open">{text('进入中枢', 'Open Hub')}<ArrowRight size={16} /></span>
          </button>
        )}
        <footer className="literary-home-footer"><Feather size={13} />{text(`${APP_BRAND.zhName} · 故事由你执笔，数据保存在本地`, `${APP_BRAND.enName} · Your stories, stored locally`)}</footer>
      </div>
    </div>
  )
}
