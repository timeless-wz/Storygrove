import { ArrowRight, BookOpen, Compass, Feather, FileUp, FolderOpen, PenTool, Plus, Search } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useDraftStore } from '../../stores/draft-store'
import { useLayoutStore } from '../../stores/layout-store'
import { APP_BRAND } from '../../shared/brand'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { openResumableDraft } from './workbench-draft-entry'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

/**
 * 书斋首页：强化继续创作层级、保留真实回调与书架、优化留白与封面拟物视觉
 */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel }: WelcomePageProps) {
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const text = useLocaleStore(s => s.text)

  const activeOrRecentProject = currentProject || (recentProjects.length > 0 ? recentProjects[0] : null)
  const isCurrentProjectActive = Boolean(currentProject)
  const hasResumableDraft = Object.values(draftsByChapter).some(drafts =>
    drafts.some(draft => draft.status !== 'archived' && draft.status !== 'finalized'))

  const handleContinueWriting = () => {
    if (!currentProject) return
    useLayoutStore.getState().setSidebarView('project')
    void openResumableDraft(draftsByChapter)
  }

  return (
    <div className="writer-shell-surface skin-workspace-page literary-home w-full h-full overflow-y-auto">
      <div className="literary-home-inner">
        {/* 顶部书斋标题栏与辅助动作 */}
        <header className="literary-home-heading">
          <div>
            <div className="literary-eyebrow">
              <Feather size={14} />
              <span>{text(APP_BRAND.zhName, APP_BRAND.enName)}</span>
            </div>
            <h2 className="text-sm font-medium mt-1 text-[var(--color-text)]">
              {text('书斋 · 让灵感落于纸上', 'Sanctuary · Room for your next story')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenProject}
              className="text-xs"
            >
              <FolderOpen size={14} className="mr-1.5" />
              {text('打开项目', 'Open project')}
            </Button>
            {onImportNovel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onImportNovel}
                className="text-xs"
              >
                <FileUp size={14} className="mr-1.5" />
                {text('拆解仿写', 'Analyze & imitate')}
              </Button>
            )}
          </div>
        </header>

        {/* 焦点 Hero：突出继续创作主层级，消解冗余等权卡片 */}
        <section className="literary-hero" aria-labelledby="welcome-hero-title">
          <div className="literary-hero-copy">
            <div>
              <div className="literary-eyebrow mb-1">
                {isCurrentProjectActive
                  ? text('当前正在创作', 'CURRENT PROJECT')
                  : activeOrRecentProject
                    ? text('最近编辑的作品', 'MOST RECENT STORY')
                    : text('新篇启程', 'A NEW BEGINNING')}
              </div>
              <h1 id="welcome-hero-title" title={activeOrRecentProject?.name}>
                {activeOrRecentProject
                  ? activeOrRecentProject.name
                  : text('每个故事，都从一页空白开始。', 'Every story begins with a blank page.')}
              </h1>
              <p>
                {activeOrRecentProject ? (
                  isCurrentProjectActive ? (
                    text(
                      '项目已就绪。随时返回章节草稿、查阅地图册与细纲蓝图，保持纯粹专注的创作流。',
                      'Your project is loaded. Resume drafting, review the atlas, and continue writing seamlessly.',
                    )
                  ) : (
                    text(
                      `保存于 ${activeOrRecentProject.path}。一键翻开故事即可重返笔下世界。`,
                      `Saved at ${activeOrRecentProject.path}. Open to return to your novel.`,
                    )
                  )
                ) : (
                  text(
                    '构筑一个世界，遇见笔下的人。在本地纯净空间中，让今天的灵感成为下一章的开头。',
                    'Build a world. Meet your characters. Let today’s inspiration become your next chapter.',
                  )
                )}
              </p>
            </div>

            <div className="literary-hero-actions">
              {isCurrentProjectActive ? (
                <>
                  <button
                    type="button"
                    className="literary-hero-primary-btn"
                    onClick={handleContinueWriting}
                  >
                    <PenTool size={15} />
                    <span>{hasResumableDraft ? text('继续创作', 'Continue writing') : text('前往项目创作', 'Open project workbench')}</span>
                    <ArrowRight size={14} />
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => useLayoutStore.getState().setSidebarView('workspace')}
                    className="text-xs"
                  >
                    <Compass size={14} className="mr-1.5" />
                    {text('长篇创作中枢', 'Fiction Hub')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onNewProject}
                    className="text-xs"
                  >
                    <Plus size={14} className="mr-1.5" />
                    {text('新书立项', 'New project')}
                  </Button>
                </>
              ) : activeOrRecentProject ? (
                <>
                  <button
                    type="button"
                    className="literary-hero-primary-btn"
                    onClick={() => void openProject(activeOrRecentProject.path)}
                  >
                    <BookOpen size={15} />
                    <span>{text('翻开最近作品', 'Open recent story')}</span>
                    <ArrowRight size={14} />
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onNewProject}
                    className="text-xs"
                  >
                    <Plus size={14} className="mr-1.5" />
                    {text('新书立项', 'New project')}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="literary-hero-primary-btn"
                    onClick={onNewProject}
                  >
                    <Plus size={15} />
                    <span>{text('新书立项', 'Start new story')}</span>
                    <ArrowRight size={14} />
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenProject}
                    className="text-xs"
                  >
                    <FolderOpen size={14} className="mr-1.5" />
                    {text('打开已有项目', 'Open existing project')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* 右侧书本实体化展示 */}
          <div className="literary-hero-art" aria-hidden="true">
            <div className="literary-display-book">
              <div className="literary-display-book-tag">
                {currentProject?.novelConfig?.genre || text('长篇创作', 'NOVEL')}
              </div>
              <div className="literary-display-book-title">
                {activeOrRecentProject?.name || text('万语千言\n待君落墨', 'Words Unwritten')}
              </div>
              <div className="literary-display-book-footer">
                <Feather size={14} />
                <span>{APP_BRAND.zhName}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 书架区域：拟物封面、新书立项槽位与最近项目 */}
        <section className="literary-bookshelf-section" aria-labelledby="bookshelf-section-title">
          <div className="literary-section-heading">
            <div>
              <div className="literary-eyebrow">{text('本地作品陈列', 'YOUR SHELF')}</div>
              <h2 id="bookshelf-section-title">{text('我的书架', 'My Bookshelf')}</h2>
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">
              {text(`${recentProjects.length} 部最近作品`, `${recentProjects.length} recent projects`)}
            </span>
          </div>

          <div className="literary-bookshelf">
            {/* 新书立项插槽（借鉴参考项目的画风，融入书架第一格） */}
            <button
              type="button"
              className="literary-new-book-slot"
              onClick={onNewProject}
              title={text('开启一部新的长篇小说', 'Create a new novel project')}
            >
              <div className="literary-new-book-icon">
                <Plus size={18} />
              </div>
              <div>
                <strong>{text('新书立项', 'New Project')}</strong>
                <small className="block mt-1">
                  {text('从一个灵感，开始一部小说', 'Turn an idea into a novel')}
                </small>
              </div>
            </button>

            {/* 最近作品卡片列表 */}
            {recentProjects.map((project) => {
              const isCurrent = project.path === currentProject?.path
              return (
                <button
                  key={project.path}
                  type="button"
                  className="literary-project-card"
                  onClick={() => void openProject(project.path)}
                  title={project.path}
                >
                  <div className="literary-book-cover" aria-hidden="true">
                    <span className="literary-book-cover-tag">
                      {isCurrent ? text('创作中', 'ACTIVE') : text('小说', 'NOVEL')}
                    </span>
                    <strong>{project.name}</strong>
                    <Feather size={12} className="mx-auto text-[var(--color-text-muted)]" />
                  </div>
                  <div className="literary-project-info">
                    <div>
                      <div className="literary-project-info-header">
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: isCurrent
                              ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                              : 'var(--color-hover)',
                            color: isCurrent
                              ? 'var(--color-accent-text)'
                              : 'var(--color-text-secondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          {isCurrent ? text('当前工程', 'Active') : text('本地项目', 'Local')}
                        </span>
                      </div>
                      <div className="literary-project-info-title" title={project.name}>
                        {project.name}
                      </div>
                      <span className="literary-project-path" title={project.path}>
                        {project.path}
                      </span>
                    </div>
                    <span className="literary-project-open">
                      <span>{text('翻开故事', 'Open story')}</span>
                      <ArrowRight size={13} />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 书架全空时的静谧引导 */}
          {recentProjects.length === 0 && (
            <div className="literary-empty-shelf mt-4">
              <BookOpen size={36} strokeWidth={1.2} />
              <h3>{text('书斋初辟，待君落墨', 'Your bookshelf awaits its first story')}</h3>
              <p>
                {text(
                  '点击上方“新书立项”开始创作，或打开本地已有小说目录。',
                  'Create your first project or open an existing directory to start filling your shelf.',
                )}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={onOpenProject}>
                <FolderOpen size={14} className="mr-1.5" />
                {text('打开本地目录', 'Open local folder')}
              </Button>
            </div>
          )}
        </section>

        {/* 资料检索提示：只描述当前真实存在的入口与收录范围。 */}
        <div className="literary-tip-card">
          <div className="flex items-center gap-2.5 min-w-0">
            <Search size={15} className="text-[var(--color-accent-text)] flex-shrink-0" />
            <div className="truncate">
              <strong>{text('项目资料检索：', 'Project material search: ')}</strong>
              <span>
                {text(
                  '打开项目后，点击侧栏顶部的搜索图标，检索已明确加入知识库的资料。',
                  'Open a project, then use the search icon at the top of the sidebar to find material added to the knowledge base.',
                )}
              </span>
            </div>
          </div>
        </div>

        {/* 页脚 */}
        <footer className="literary-home-footer">
          <Feather size={13} />
          <span>
            {text(
              `${APP_BRAND.zhName} · 故事由你执笔，数据保存在本地`,
              `${APP_BRAND.enName} · Your stories, stored locally`,
            )}
          </span>
        </footer>
      </div>
    </div>
  )
}
