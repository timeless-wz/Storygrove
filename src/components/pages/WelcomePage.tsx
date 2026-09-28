import { useState, type DragEvent, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Feather, FileUp, FolderOpen, Lightbulb, Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useDraftStore } from '../../stores/draft-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useHomeSurfaceStore, type LibraryCategory } from '../../stores/home-surface-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { openResumableDraft } from './workbench-draft-entry'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

function InspirationNotes({ compact }: { compact: boolean }) {
  const t = useLocaleStore(s => s.t)
  const locale = useLocaleStore(s => s.locale)
  const notes = useHomeSurfaceStore(s => s.notes)
  const addNote = useHomeSurfaceStore(s => s.addNote)
  const removeNote = useHomeSurfaceStore(s => s.removeNote)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const visibleNotes = compact ? notes.slice(0, 3) : notes

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!content.trim()) return
    addNote(content, tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))
    setContent('')
    setTags('')
    setEditing(false)
  }

  return (
    <section className="literary-inspiration-section" aria-labelledby={compact ? 'home-inspiration-title' : 'library-inspiration-title'}>
      <div className="literary-section-heading">
        <div className="literary-section-caption">
          <Lightbulb size={24} strokeWidth={1.5} aria-hidden="true" />
          <h2 id={compact ? 'home-inspiration-title' : 'library-inspiration-title'}>{t('home.inspirationTitle')}</h2>
          {compact && <p>{t('home.inspirationDescription')}</p>}
        </div>
        <Button type="button" size="sm" onClick={() => setEditing(true)}>
          <Plus size={15} className="mr-1" />{t('home.inspirationAdd')}
        </Button>
      </div>
      <p className="literary-session-notice">{t('home.inspirationSession')}</p>
      {editing && (
        <form className="literary-note-composer" onSubmit={save}>
          <textarea autoFocus value={content} onChange={event => setContent(event.target.value)} placeholder={t('home.inspirationPlaceholder')} maxLength={2000} />
          <input value={tags} onChange={event => setTags(event.target.value)} placeholder={t('home.inspirationTags')} maxLength={160} />
          <div className="literary-note-composer-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>{t('home.inspirationCancel')}</Button>
            <Button type="submit" size="sm" disabled={!content.trim()}>{t('home.inspirationSave')}</Button>
          </div>
        </form>
      )}
      {visibleNotes.length === 0 ? (
        <div className="literary-notes-empty">{t('home.inspirationEmpty')}</div>
      ) : (
        <div className="literary-inspiration-grid">
          {visibleNotes.map(note => (
            <article className="literary-inspiration-card" key={note.id}>
              <p>{note.content}</p>
              <div className="literary-note-tags">{note.tags.map(tag => <span key={tag}># {tag}</span>)}</div>
              <div className="literary-note-footer">
                <time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleDateString(locale)}</time>
                <button type="button" aria-label={t('home.inspirationRemove')} title={t('home.inspirationRemove')} onClick={() => removeNote(note.id)}><Trash2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function LibrarySurface({ onImportNovel }: { onImportNovel?: () => void }) {
  const t = useLocaleStore(s => s.t)
  const surface = useHomeSurfaceStore(s => s.surface)
  const category = useHomeSurfaceStore(s => s.category)
  const setSurface = useHomeSurfaceStore(s => s.setSurface)
  const selectedCategory: LibraryCategory = surface === 'references' ? 'references' : category
  const categories: Array<[LibraryCategory, string]> = [
    ['notes', t('home.libraryNotes')],
    ['references', t('home.libraryReferences')],
    ['images', t('home.libraryImages')],
    ['general', t('home.libraryGeneral')],
  ]

  return (
    <div className="literary-home-inner literary-library-page">
      <button type="button" className="literary-back-link" onClick={() => setSurface('home')}><ArrowLeft size={16} />{t('home.backHome')}</button>
      <header className="literary-library-heading">
        <h1>{surface === 'references' ? t('home.libraryReferences') : t('home.libraryTitle')}</h1>
        <p>{t('home.libraryDescription')}</p>
      </header>
      <nav className="literary-library-tabs" aria-label={t('home.libraryTitle')}>
        {categories.map(([id, label]) => (
          <button key={id} type="button" aria-current={selectedCategory === id ? 'page' : undefined} onClick={() => setSurface(id === 'references' ? 'references' : 'library', id)}>{label}</button>
        ))}
      </nav>
      {selectedCategory === 'notes' ? <InspirationNotes compact={false} /> : (
        <div className="literary-library-empty">
          <BookOpen size={30} strokeWidth={1.5} aria-hidden="true" />
          <p>{t(selectedCategory === 'references' ? 'home.libraryReferencesUnavailable' : 'home.libraryUnavailable')}</p>
          {selectedCategory === 'references' && onImportNovel && (
            <Button type="button" onClick={onImportNovel}><FileUp size={16} className="mr-2" />{t('home.referencesAction')}</Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Home project actions remain live; global-only resources expose their current data boundary. */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel }: WelcomePageProps) {
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const surface = useHomeSurfaceStore(s => s.surface)
  const setSurface = useHomeSurfaceStore(s => s.setSurface)
  const t = useLocaleStore(s => s.t)
  const text = useLocaleStore(s => s.text)
  const [dragging, setDragging] = useState(false)
  const [dropMessage, setDropMessage] = useState('')

  const activeOrRecentProject = currentProject || recentProjects[0] || null
  const hasResumableDraft = Object.values(draftsByChapter).some(drafts =>
    drafts.some(draft => draft.status !== 'archived' && draft.status !== 'finalized'))

  const handleContinueWriting = () => {
    if (!currentProject) return
    useLayoutStore.getState().setSidebarView('project')
    void openResumableDraft(draftsByChapter)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0 || files.some(file => !/\.(txt|epub|md|markdown)$/i.test(file.name))) {
      setDropMessage(t('home.dropInvalid'))
      return
    }
    // Main-process selection preserves the import controller's file capability
    // and project-session boundary. Dropped File objects cannot supply it.
    setDropMessage(t('home.dropConfirm'))
    onImportNovel?.()
  }

  return (
    <div className="writer-shell-surface skin-workspace-page literary-home w-full h-full overflow-y-auto">
      {surface !== 'home' ? <LibrarySurface onImportNovel={onImportNovel} /> : (
        <div className="literary-home-inner">
          <header className="literary-home-heading">
            <div className="literary-home-brand"><Feather size={35} strokeWidth={1.5} aria-hidden="true" /><div><strong>{t('home.brand')}</strong><p>{t('home.tagline')}</p></div></div>
          </header>

          <div className={`literary-hero-engines${onImportNovel ? '' : ' literary-hero-engines--single'}`}>
            <section className="literary-continue-card" aria-labelledby="welcome-hero-title">
              <div className="literary-continue-copy">
                <div>
                  <h1 id="welcome-hero-title" title={activeOrRecentProject?.name}>
                    {activeOrRecentProject?.name ?? text('每个故事，都从一页空白开始。', 'Every story begins with a blank page.')}
                  </h1>
                  <p>{activeOrRecentProject
                    ? currentProject
                      ? t('home.activeDescription')
                      : text(`保存于 ${activeOrRecentProject.path}。一键翻开故事即可重返笔下世界。`, `Saved at ${activeOrRecentProject.path}. Open it to return to your story.`)
                    : t('home.noProjectDescription')}</p>
                </div>
                <div className="literary-hero-actions">
                  <button type="button" className="literary-hero-primary-btn" onClick={currentProject ? handleContinueWriting : activeOrRecentProject ? () => void openProject(activeOrRecentProject.path) : onNewProject}>
                    <BookOpen size={17} />
                    <span>{currentProject ? hasResumableDraft ? text('继续创作', 'Continue writing') : text('前往项目创作', 'Open project workbench') : activeOrRecentProject ? text('翻开最近作品', 'Open recent story') : text('新书立项', 'New project')}</span>
                    <ArrowRight size={16} />
                  </button>
                  {currentProject && <button type="button" className="literary-hero-text-link" onClick={() => useLayoutStore.getState().setSidebarView('workspace')}>{text('长篇创作中枢', 'Fiction Hub')}</button>}
                  {activeOrRecentProject && <button type="button" className="literary-hero-text-link" onClick={onNewProject}>{text('新书立项', 'New project')}</button>}
                </div>
              </div>
            </section>
            {onImportNovel && (
              <section className={`literary-deconstruct-card${dragging ? ' is-dragging' : ''}`} aria-labelledby="deconstruct-title" onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={handleDrop}>
                <div className="literary-deconstruct-art" aria-hidden="true" />
                <div className="literary-deconstruct-content">
                  <span className="literary-deconstruct-eyebrow">{t('home.deconstructEyebrow')}</span>
                  <h2 id="deconstruct-title">{t('home.deconstructTitle')}</h2>
                  <p>{t('home.deconstructDescription')}</p>
                  <Button type="button" onClick={onImportNovel}><FileUp size={17} className="mr-2" />{t('home.deconstructAction')}</Button>
                  <div className="literary-drop-zone" aria-live="polite"><FileUp size={18} /><span>{dropMessage || (dragging ? t('home.dropReady') : t('home.dropPrompt'))}</span></div>
                </div>
              </section>
            )}
          </div>

          <section className="literary-bookshelf-section" aria-labelledby="bookshelf-section-title">
            <div className="literary-section-heading">
              <div className="literary-section-caption"><BookOpen size={24} strokeWidth={1.5} aria-hidden="true" /><h2 id="bookshelf-section-title">{t('home.bookshelfTitle')}</h2><span>{t('home.bookshelfCount', { count: recentProjects.length })}</span></div>
              <div className="literary-bookshelf-actions"><Button type="button" size="sm" onClick={onNewProject}><Plus size={15} className="mr-1" />{text('新书立项', 'New project')}</Button><Button type="button" size="sm" variant="outline" onClick={onOpenProject}><FolderOpen size={15} className="mr-1" />{t('home.openLocalProject')}</Button></div>
            </div>
            {recentProjects.length > 0 ? (
              <div className="literary-bookshelf">
                {recentProjects.map(project => (
                  <button key={project.path} type="button" className="literary-project-card" onClick={() => void openProject(project.path)} title={project.path}>
                    <div className="literary-book-cover" aria-hidden="true"><strong>{project.name.slice(0, 4)}</strong><Feather size={15} /></div>
                    <div className="literary-project-info"><div><div className="literary-project-info-title">{project.name}</div>{project.path === currentProject?.path && <span className="literary-project-current">{t('home.currentProject')}</span>}<p className="literary-project-path">{project.path}</p></div><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString()}</time></div>
                  </button>
                ))}
              </div>
            ) : <div className="literary-empty-shelf"><BookOpen size={30} strokeWidth={1.5} /><h3>{t('home.emptyShelfTitle')}</h3><p>{t('home.emptyShelfDescription')}</p></div>}
          </section>

          <div className="literary-home-lower">
            <InspirationNotes compact />
            <section className="literary-resource-library-card" aria-labelledby="home-library-title">
              <div><BookOpen size={27} strokeWidth={1.5} aria-hidden="true" /><h2 id="home-library-title">{t('home.libraryTitle')}</h2><p>{t('home.libraryDescription')}</p></div>
              <div className="literary-resource-types">
                {(['notes', 'references', 'images', 'general'] as const).map(category => (
                  <button key={category} type="button" onClick={() => setSurface(category === 'references' ? 'references' : 'library', category)}>{t(category === 'notes' ? 'home.libraryNotes' : category === 'references' ? 'home.libraryReferences' : category === 'images' ? 'home.libraryImages' : 'home.libraryGeneral')}</button>
                ))}
              </div>
              <button type="button" className="literary-library-open" onClick={() => setSurface('library', 'notes')}>{t('home.libraryAction')}<ArrowRight size={18} /></button>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
