import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, ListTree, PanelLeftClose, RefreshCw } from 'lucide-react'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { useEditorStore, saveEditorTabBeforeClose, type EditorTab } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWidthBucket } from '../../hooks/useResponsiveWorkbenchLayout'
import { toast } from '../ui/Toast'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { openBuiltinEditor, openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import { groupOutline, type OutlineData } from './chapter-outline-model'
import './chapter-outline-sidebar.css'

export default function ChapterOutlineSidebar({ tab }: { tab: EditorTab }) {
  const text = useLocaleStore(state => state.text)
  const project = useProjectStore(state => state.currentProject)
  const widthBucket = useWidthBucket()
  const narrow = widthBucket === 'narrow'
  const [open, setOpen] = useState(() => widthBucket !== 'narrow')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState<{ identity: string; data: OutlineData } | null>(null)
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const projectSession = captureProjectSession(project)
  const identity = projectSession && isProjectSessionPath(projectSession, tab.projectKey)
    ? `${projectSession.projectId}:${projectSession.leaseId}`
    : ''
  const data = loaded?.identity === identity ? loaded.data : null
  const error = failure?.identity === identity ? failure.message : ''

  const load = useCallback(async () => {
    const session = captureProjectSession(project)
    if (!session || !isProjectSessionPath(session, tab.projectKey)) return
    try {
      const [volumes, blueprints, drafts] = await Promise.all([
        ipc.invokeWithProjectSession(session, 'db:blueprint-volume-list', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:blueprint-get-all', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:draft-list-all', session.projectPath),
      ])
      if (!isProjectSessionCurrent(session)) return
      const loadedIdentity = `${session.projectId}:${session.leaseId}`
      setLoaded({ identity: loadedIdentity, data: { volumes, blueprints, drafts } })
      setFailure(null)
    } catch (cause) {
      if (isProjectSessionCurrent(session)) setFailure({ identity: `${session.projectId}:${session.leaseId}`, message: String(cause) })
    }
  }, [project, tab.projectKey])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])
  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', payload => {
    if (isProjectSessionCurrent(payload.projectSession)) void load()
  }), [load])
  useEffect(() => globalEventBus.on('FINALIZE_COMPLETE', payload => {
    if (isProjectSessionCurrent(payload.projectSession)) void load()
  }), [load])
  useEffect(() => globalEventBus.on('CHAPTER_DELETION_UPDATED', payload => {
    if (isProjectSessionCurrent(payload.projectSession)) void load()
  }), [load])

  const groups = useMemo(() => groupOutline(data ?? { volumes: [], blueprints: [], drafts: [] }, text('第1卷', 'Volume 1')),
    [data, text])
  const currentPath = tab.filePath

  const openTarget = async (target: { path?: string; name: string; chapterNumber: number }) => {
    if (busy || target.path === currentPath) return
    const session = captureProjectSession(project)
    if (!session || !isProjectSessionPath(session, tab.projectKey)) return
    setBusy(true)
    try {
      const current = useEditorStore.getState().tabs.find(item => item.id === tab.id)
      if (current?.dirty) {
        await saveEditorTabBeforeClose(tab.id)
        if (useEditorStore.getState().tabs.find(item => item.id === tab.id)?.dirty) {
          toast.info(text('当前章节仍有未保存的输入，请保存后重试', 'This chapter still has unsaved changes. Save and try again.'))
          return
        }
      }
      if (!isProjectSessionCurrent(session)) return
      if (target.path) {
        await openChapterFile(target.path, target.name)
      } else {
        openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card', undefined, target.chapterNumber)
      }
      if (narrow) setOpen(false)
    } catch (cause) {
      if (isProjectSessionCurrent(session)) toast.error(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const renderTarget = (draft: DraftMeta, kind: 'draft' | 'manuscript', number: number) => {
    const path = `vela://${kind}/${draft.id}`
    const label = kind === 'draft'
      ? text(`草稿 v${draft.version}`, `Draft v${draft.version}`)
      : text(`正文 v${draft.version}`, `Manuscript v${draft.version}`)
    return (
      <button
        key={path}
        type="button"
        className={`chapter-outline-target${currentPath === path ? ' is-current' : ''}`}
        aria-current={currentPath === path ? 'page' : undefined}
        disabled={busy}
        onClick={() => void openTarget({ path, name: `${text(`第 ${number} 章`, `Chapter ${number}`)} ${draft.chapterTitle || ''} v${draft.version}`, chapterNumber: number })}
      >
        <span className={`chapter-outline-kind chapter-outline-kind--${kind}`} aria-hidden="true" />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <>
      {narrow && open && <button type="button" className="chapter-outline-backdrop" aria-label={text('收起卷章目录', 'Close chapter outline')} onClick={() => setOpen(false)} />}
      <aside className={`chapter-outline-sidebar${open ? ' is-open' : ' is-collapsed'}${narrow ? ' is-narrow' : ''}`} aria-label={text('卷章目录', 'Chapter outline')}>
        <div className="chapter-outline-header">
          <button type="button" className="chapter-outline-toggle" aria-label={open ? text('收起卷章目录', 'Collapse chapter outline') : text('展开卷章目录', 'Expand chapter outline')} title={open ? text('收起卷章目录', 'Collapse chapter outline') : text('展开卷章目录', 'Expand chapter outline')} onClick={() => setOpen(value => !value)}>
            {open ? <PanelLeftClose size={16} /> : <ListTree size={17} />}
          </button>
          {open && <><strong>{text('卷章目录', 'Chapter outline')}</strong><button type="button" className="chapter-outline-refresh" aria-label={text('刷新卷章目录', 'Refresh chapter outline')} onClick={() => void load()}><RefreshCw size={14} /></button></>}
        </div>
        {open && <nav className="chapter-outline-list" aria-label={text('按卷浏览章节', 'Browse chapters by volume')}>
          {error && <div className="chapter-outline-message" role="alert">{text('目录读取失败，请刷新重试', 'Could not load the outline. Refresh to try again.')}</div>}
          {!error && !data && <div className="chapter-outline-message">{text('正在读取章节…', 'Loading chapters…')}</div>}
          {!error && data && groups.every(group => group.chapters.length === 0) && <div className="chapter-outline-message">{text('还没有章节', 'No chapters yet')}</div>}
          {!error && data && groups.map(group => {
            const closed = collapsed.has(group.volume.id)
            return <div className="chapter-outline-volume" key={group.volume.id}>
              <button type="button" className="chapter-outline-volume-button" aria-expanded={!closed} onClick={() => setCollapsed(previous => {
                const next = new Set(previous)
                if (closed) next.delete(group.volume.id)
                else next.add(group.volume.id)
                return next
              })}>
                {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <BookOpen size={14} />
                <span>{group.volume.id === 'ungrouped' ? text('未归卷', 'Unassigned') : group.volume.name}</span>
                <small>{group.chapters.length}</small>
              </button>
              {!closed && group.chapters.map(chapter => <div className="chapter-outline-chapter" key={chapter.number}>
                <button type="button" className="chapter-outline-chapter-button" disabled={busy} onClick={() => void openTarget({
                  path: chapter.draft ? `vela://draft/${chapter.draft.id}` : chapter.manuscript ? `vela://manuscript/${chapter.manuscript.id}` : undefined,
                  name: `${text(`第 ${chapter.number} 章`, `Chapter ${chapter.number}`)} ${chapter.title}`,
                  chapterNumber: chapter.number,
                })}>
                  <span>{text(`第 ${chapter.number} 章`, `Ch. ${chapter.number}`)}</span>
                  <span className="chapter-outline-chapter-title">{chapter.title || text('未命名', 'Untitled')}</span>
                </button>
                <div className="chapter-outline-targets">
                  {chapter.draft && renderTarget(chapter.draft, 'draft', chapter.number)}
                  {chapter.manuscript && renderTarget(chapter.manuscript, 'manuscript', chapter.number)}
                  {!chapter.draft && !chapter.manuscript && <span className="chapter-outline-planned">{text('章节蓝图', 'Blueprint')}</span>}
                </div>
              </div>)}
            </div>
          })}
        </nav>}
      </aside>
    </>
  )
}
