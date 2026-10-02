import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, ListTree, PanelLeftClose, RefreshCw, Plus, Trash2 } from 'lucide-react'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { useEditorStore, saveEditorTabBeforeClose, type EditorTab } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWidthBucket } from '../../hooks/useResponsiveWorkbenchLayout'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { deleteFinalizedChapter } from '../panels/sidebar/finalized-chapter-deletion'
import { useDraftStore } from '../../stores/draft-store'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import { groupOutline, type OutlineData } from './chapter-outline-model'
import { NewDraftDialog } from '../panels/sidebar/NewDraftDialog'
import { NewVolumeDialog } from '../panels/sidebar/NewVolumeDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/Dialog'
import { Button } from '../ui/Button'
import './chapter-outline-sidebar.css'

export default function ChapterOutlineSidebar({ tab }: { tab: EditorTab }) {
  const text = useLocaleStore(state => state.text)
  const project = useProjectStore(state => state.currentProject)
  const widthBucket = useWidthBucket()
  const narrow = widthBucket === 'narrow'
  const [open, setOpen] = useState(() => tab.type === 'chapter-directory' || widthBucket !== 'narrow')
  const kind = tab.draftStatus === 'finalized' || tab.filePath?.startsWith('vela://manuscript/')
    ? 'manuscript' : tab.proseDirectoryKind ?? 'draft'
  const [selectedVolume, setSelectedVolume] = useState<string | null>(null)
  const [newVolume, setNewVolume] = useState(false)
  const [newChapter, setNewChapter] = useState<{ id: string | null; name: string } | null>(null)
  const [movingChapter, setMovingChapter] = useState<number | null>(null)
  const [moveVolume, setMoveVolume] = useState('')
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState<{ identity: string; data: OutlineData; groupingUnavailable: boolean } | null>(null)
  const loadSequence = useRef(0)
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
    const request = ++loadSequence.current
    try {
      const [volumeResult, blueprintResult, draftResult, assignmentResult] = await Promise.allSettled([
        ipc.invokeWithProjectSession(session, 'db:prose-volume-list', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:blueprint-list-summary', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:draft-list-all', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:chapter-volume-list', session.projectPath),
      ])
      if (!isProjectSessionCurrent(session) || request !== loadSequence.current) return
      if (draftResult.status === 'rejected') throw draftResult.reason
      // 正文是目录事实源；辅助卷信息失败不能阻断打开正文，也不能猜测卷归属。
      const groupingUnavailable = volumeResult.status === 'rejected' || blueprintResult.status === 'rejected' || assignmentResult.status === 'rejected'
      const volumes = !groupingUnavailable && volumeResult.status === 'fulfilled' ? volumeResult.value : []
      const blueprints = !groupingUnavailable && blueprintResult.status === 'fulfilled' ? blueprintResult.value : []
      const loadedIdentity = `${session.projectId}:${session.leaseId}`
      setLoaded({ identity: loadedIdentity, data: { volumes, blueprints, drafts: draftResult.value, assignments: !groupingUnavailable && assignmentResult.status === 'fulfilled' ? assignmentResult.value ?? [] : [] }, groupingUnavailable })
      setFailure(null)
    } catch (cause) {
      if (isProjectSessionCurrent(session) && request === loadSequence.current) {
        setFailure({ identity: `${session.projectId}:${session.leaseId}`, message: String(cause) })
      }
    }
  }, [project, tab.projectKey])

  useEffect(() => {
    let cancelled = false
    if (tab.type === 'chapter-directory') queueMicrotask(() => { if (!cancelled) setOpen(true) })
    return () => { cancelled = true }
  }, [tab.id, tab.type])

  useEffect(() => {
    let cancelled = false
    const invalidatePendingLoads = () => { loadSequence.current++ }
    Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true; invalidatePendingLoads() }
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

  const groups = useMemo(() => groupOutline(data ? { ...data, drafts: data.drafts.filter(draft => !kind || (kind === 'manuscript' ? draft.status === 'finalized' : draft.status !== 'finalized')) } : { volumes: [], blueprints: [], drafts: [] }, text('第1卷', 'Volume 1'), !!kind),
    [data, text, kind])
  const currentPath = tab.filePath

  const openTarget = async (target: { path: string; name: string }) => {
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
      await openChapterFile(target.path, target.name)
      if (narrow) setOpen(false)
    } catch (cause) {
      if (isProjectSessionCurrent(session)) toast.error(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const deleteVolume = async (volumeId: string, name: string) => {
    const session = captureProjectSession(project)
    if (!session || busy) return
    const approved = await confirm(text(`删除“${name}”？卷内所有正文将移入“未归卷”，草稿和定稿内容会保留。`, `Delete “${name}”? All prose moves to Unassigned and its text is preserved.`), { title: text('删除卷', 'Delete volume'), confirmText: text('删除', 'Delete'), danger: true })
    if (!approved || !isProjectSessionCurrent(session)) return
    setBusy(true)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:prose-volume-delete', volumeId, session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success) throw new Error(result.error)
      setSelectedVolume(null)
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'blueprints'], projectPath: session.projectPath, projectSession: session })
    } catch (cause) { if (isProjectSessionCurrent(session)) toast.error(String(cause)) }
    finally { setBusy(false) }
  }

  const deleteDraft = async (draft: DraftMeta, kind: 'draft' | 'manuscript') => {
    const session = captureProjectSession(project)
    if (!session || busy) return
    const path = `vela://${kind}/${draft.id}`
    const displayName = text(`第 ${draft.chapterNumber} 章 ${draft.chapterTitle || ''} v${draft.version}`, `Chapter ${draft.chapterNumber} ${draft.chapterTitle || ''} v${draft.version}`)
    setBusy(true)
    try {
      const deleteFinalized = () => deleteFinalizedChapter({ project, projectPath: session.projectPath, draftId: draft.id, chapterNumber: draft.chapterNumber, displayName, tabFilePath: path, surface: kind === 'manuscript' ? 'manuscript' : 'draft' })
      if (draft.status === 'finalized') { await deleteFinalized(); return }
      const approved = await confirm(text(`确认删除“${displayName}”这一稿？正文及关联审稿／修稿记录将被删除，此操作不可撤销。`, `Delete this draft “${displayName}” and its review/revision records? This cannot be undone.`), { title: text('删除这一稿', 'Delete draft'), confirmText: text('删除', 'Delete'), danger: true })
      if (!approved || !isProjectSessionCurrent(session)) return
      const result = await ipc.invokeWithProjectSession(session, 'db:draft-delete', draft.id, session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      if (result.errorCode === 'FINALIZED_DRAFT_DELETE_REQUIRED') { await deleteFinalized(); return }
      if (!result.success) throw new Error(result.error)
      const editor = useEditorStore.getState()
      for (const item of editor.tabs.filter(item => item.projectKey === session.projectPath && item.filePath === path)) editor.closeTab(item.id)
      await useDraftStore.getState().loadChapterDrafts(draft.chapterNumber, session.projectPath, session)
      if (isProjectSessionCurrent(session)) globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'fileTree'], projectPath: session.projectPath, projectSession: session })
    } catch (cause) { if (isProjectSessionCurrent(session)) toast.error(String(cause)) }
    finally { setBusy(false) }
  }

  const renderTarget = (draft: DraftMeta, kind: 'draft' | 'manuscript', number: number) => {
    const path = `vela://${kind}/${draft.id}`
    const label = kind === 'draft'
      ? text(`草稿 v${draft.version}`, `Draft v${draft.version}`)
      : text(`正文 v${draft.version}`, `Manuscript v${draft.version}`)
    return (
      <div key={path} className="chapter-outline-target-row"><button
        type="button"
        className={`chapter-outline-target${currentPath === path ? ' is-current' : ''}`}
        aria-current={currentPath === path ? 'page' : undefined}
        disabled={busy}
        onClick={() => void openTarget({ path, name: `${text(`第 ${number} 章`, `Chapter ${number}`)} ${draft.chapterTitle || ''} v${draft.version}` })}
      >
        <span className={`chapter-outline-kind chapter-outline-kind--${kind}`} aria-hidden="true" />
        <span>{label}</span>
      </button><button type="button" className="chapter-outline-arrow chapter-outline-delete" disabled={busy} aria-label={text(`删除第 ${number} 章${kind === 'draft' ? '草稿' : '正文'} v${draft.version}`, `Delete Chapter ${number} ${kind} v${draft.version}`)} onClick={() => void deleteDraft(draft, kind)}><Trash2 size={12} /></button></div>
    )
  }

  const moveChapter = async () => {
    const session = captureProjectSession(project)
    if (!session || movingChapter === null || busy) return
    setBusy(true)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:chapter-volume-set', movingChapter, moveVolume || null, session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success) throw new Error(result.error)
      setMovingChapter(null)
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'], projectPath: session.projectPath, projectSession: session })
    } catch (cause) { if (isProjectSessionCurrent(session)) toast.error(String(cause)) }
    finally { setBusy(false) }
  }

  return (
    <>
      {narrow && open && <button type="button" className="chapter-outline-backdrop" aria-label={text('收起卷章目录', 'Close chapter outline')} onClick={() => setOpen(false)} />}
      <aside className={`chapter-outline-sidebar${open ? ' is-open' : ' is-collapsed'}${narrow ? ' is-narrow' : ''}`} aria-label={text('卷章目录', 'Chapter outline')}>
        <div className="chapter-outline-header">
          <button type="button" className="chapter-outline-toggle" aria-label={open ? text('收起卷章目录', 'Collapse chapter outline') : text('展开卷章目录', 'Expand chapter outline')} title={open ? text('收起卷章目录', 'Collapse chapter outline') : text('展开卷章目录', 'Expand chapter outline')} onClick={() => setOpen(value => !value)}>
            {open ? <PanelLeftClose size={16} /> : <ListTree size={17} />}
          </button>
          {open && <><strong>{kind === 'draft' ? text('草稿箱', 'Draft box') : kind === 'manuscript' ? text('正文章节', 'Manuscript chapters') : text('卷章目录', 'Chapter outline')}</strong><button type="button" className="chapter-outline-refresh" aria-label={text('刷新卷章目录', 'Refresh chapter outline')} onClick={() => void load()}><RefreshCw size={14} /></button></>}
        </div>
        {open && <div className="chapter-outline-actions">
          <button type="button" disabled={busy || !data || !!error || loaded?.groupingUnavailable} onClick={() => setNewVolume(true)}><Plus size={14} />{text('添加卷', 'Add volume')}</button>
        </div>}
        {open && <nav className="chapter-outline-list" aria-label={text('按卷浏览章节', 'Browse chapters by volume')}>
          {error && <div className="chapter-outline-message" role="alert">{text('目录读取失败，请刷新重试', 'Could not load the outline. Refresh to try again.')}</div>}
          {!error && !data && <div className="chapter-outline-message">{text('正在读取章节…', 'Loading chapters…')}</div>}
          {!error && data && groups.length === 0 && <div className="chapter-outline-message">{text('暂无草稿或正文章节', 'No drafts or manuscript chapters yet')}</div>}
          {!error && data && groups.length > 0 && loaded?.groupingUnavailable && <div className="chapter-outline-message" role="status">{text('卷信息读取失败，正文暂列于未归卷，可刷新重试', 'Volume information could not load. Prose is listed under Unassigned; refresh to retry.')}</div>}
          {!error && data && groups.map(group => {
            const closed = !expandedVolumes.has(group.volume.id)
            return <div className="chapter-outline-volume" key={group.volume.id}>
              <div className={`chapter-outline-volume-row${selectedVolume === group.volume.id ? ' is-selected' : ''}`}>
                <button type="button" className="chapter-outline-arrow" aria-label={text(`${closed ? '展开' : '收起'}${group.volume.name || '未归卷'}`, `${closed ? 'Expand' : 'Collapse'} ${group.volume.name || 'Unassigned'}`)} aria-expanded={!closed} onClick={() => {
                  setSelectedVolume(group.volume.id)
                  setExpandedVolumes(previous => {
                    const next = new Set(previous)
                    if (next.has(group.volume.id)) next.delete(group.volume.id)
                    else next.add(group.volume.id)
                    return next
                  })
                }}>{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
                <button type="button" className="chapter-outline-volume-button" aria-pressed={selectedVolume === group.volume.id} onClick={() => setSelectedVolume(group.volume.id)}>
                  <BookOpen size={14} />
                  <span>{group.volume.id === 'ungrouped' ? text('未归卷', 'Unassigned') : group.volume.name}</span>
                  <small>{group.chapters.length}</small>
                </button>
                {group.volume.id !== 'ungrouped' && <button type="button" className="chapter-outline-arrow chapter-outline-delete" disabled={busy || loaded?.groupingUnavailable} aria-label={text(`删除${group.volume.name}`, `Delete ${group.volume.name}`)} onClick={() => void deleteVolume(group.volume.id, group.volume.name)}><Trash2 size={13} /></button>}
              </div>
              {(selectedVolume === group.volume.id || !closed) && group.volume.id !== 'ungrouped' && <div className="chapter-outline-volume-actions">
                <button type="button" disabled={busy || loaded?.groupingUnavailable} aria-label={text(`向${group.volume.name}添加章节`, `Add chapter to ${group.volume.name}`)} onClick={() => setNewChapter({ id: group.volume.id, name: group.volume.name })}><Plus size={14} />{text('添加章节', 'Add chapter')}</button>
              </div>}
              {!closed && group.chapters.length === 0 && <div className="chapter-outline-message">{text('暂无章节，点击上方添加章节', 'No chapters yet. Add a chapter above.')}</div>}
              {!closed && group.chapters.map(chapter => <div className="chapter-outline-chapter" key={chapter.number}>
                <button type="button" className="chapter-outline-chapter-button" disabled={busy} onClick={() => void openTarget({
                  path: chapter.draft ? `vela://draft/${chapter.draft.id}` : `vela://manuscript/${chapter.manuscript!.id}`,
                  name: `${text(`第 ${chapter.number} 章`, `Chapter ${chapter.number}`)} ${chapter.title}`,
                })}>
                  <span>{text(`第 ${chapter.number} 章`, `Ch. ${chapter.number}`)}</span>
                  <span className="chapter-outline-chapter-title">{chapter.title || text('未命名', 'Untitled')}</span>
                </button>
                <div className="chapter-outline-targets">
                  <button type="button" className="chapter-outline-target" disabled={busy || loaded?.groupingUnavailable} aria-label={text(`移动第 ${chapter.number} 章到卷`, `Move Chapter ${chapter.number} to volume`)} onClick={() => { setMovingChapter(chapter.number); setMoveVolume(group.volume.id === 'ungrouped' ? '' : group.volume.id) }}>{text('移动到卷', 'Move to volume')}</button>
                  {chapter.draft && renderTarget(chapter.draft, 'draft', chapter.number)}
                  {chapter.manuscript && renderTarget(chapter.manuscript, 'manuscript', chapter.number)}
                </div>
              </div>)}
            </div>
          })}
        </nav>}
      </aside>
      <NewVolumeDialog open={newVolume} onOpenChange={setNewVolume} />
      <NewDraftDialog open={newChapter !== null} onOpenChange={value => { if (!value) setNewChapter(null) }} suggestedChapterNumber={Math.max(0, ...(data?.drafts.map(draft => draft.chapterNumber) ?? [])) + 1} volumeId={newChapter?.id} volumeName={newChapter?.name} />
      <Dialog open={movingChapter !== null} onOpenChange={value => { if (!value && !busy) setMovingChapter(null) }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle>{text('移动章节到卷', 'Move chapter to volume')}</DialogTitle><DialogDescription>{text('同一章节的草稿和定稿会一起移动。', 'Drafts and finalized prose for this chapter move together.')}</DialogDescription></DialogHeader>
          <div className="px-6 py-5"><label htmlFor="prose-move-volume">{text('目标卷', 'Destination volume')}</label>
            <select id="prose-move-volume" className="chapter-outline-volume-select" disabled={busy} value={moveVolume} onChange={event => setMoveVolume(event.target.value)}>
              <option value="">{text('未归卷', 'Unassigned')}</option>{data?.volumes.map(volume => <option key={volume.id} value={volume.id}>{volume.name}</option>)}
            </select></div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setMovingChapter(null)}>{text('取消', 'Cancel')}</Button><Button disabled={busy} onClick={() => void moveChapter()}>{text('确认移动', 'Move chapter')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
