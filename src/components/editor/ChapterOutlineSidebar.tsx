import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, ListTree, PanelLeftClose, RefreshCw, Plus, Trash2, MoreHorizontal, Undo2 } from 'lucide-react'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { useEditorStore, saveEditorTabBeforeClose, type EditorTab } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWidthBucket } from '../../hooks/useResponsiveWorkbenchLayout'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Input } from '../ui/Input'
import type { ProseDirectoryAction, ProseTrashEntry } from '../../shared/prose-directory'
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
  const [newChapter, setNewChapter] = useState<{ id: string | null; name: string; chapterNumber?: number; insertRelativeTo?: number; insertSide?: 'before' | 'after' } | null>(null)
  const [menu, setMenu] = useState<{ items: ContextMenuEntry[]; position: { x: number; y: number } } | null>(null)
  const [renaming, setRenaming] = useState<{ draftId?: number; volumeId?: string; name: string } | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<ProseTrashEntry[]>([])
  const [undoId, setUndoId] = useState<number | null>(null)
  const [movePosition, setMovePosition] = useState('')
  const [moveSide, setMoveSide] = useState<'before' | 'after'>('before')
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
      const [volumeResult, blueprintResult, draftResult, assignmentResult, orderResult] = await Promise.allSettled([
        ipc.invokeWithProjectSession(session, 'db:prose-volume-list', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:blueprint-list-summary', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:draft-list-all', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:chapter-volume-list', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:prose-order', session.projectPath),
      ])
      if (!isProjectSessionCurrent(session) || request !== loadSequence.current) return
      if (draftResult.status === 'rejected') throw draftResult.reason
      if (orderResult.status === 'rejected') throw orderResult.reason
      // 正文是目录事实源；辅助卷信息失败不能阻断打开正文，也不能猜测卷归属。
      const groupingUnavailable = volumeResult.status === 'rejected' || blueprintResult.status === 'rejected' || assignmentResult.status === 'rejected'
      const volumes = !groupingUnavailable && volumeResult.status === 'fulfilled' ? volumeResult.value : []
      const blueprints = !groupingUnavailable && blueprintResult.status === 'fulfilled' ? blueprintResult.value : []
      const loadedIdentity = `${session.projectId}:${session.leaseId}`
      setLoaded({ identity: loadedIdentity, data: { volumes, blueprints, order: orderResult.status === 'fulfilled' ? orderResult.value ?? [] : [], drafts: draftResult.value, assignments: !groupingUnavailable && assignmentResult.status === 'fulfilled' ? assignmentResult.value ?? [] : [] }, groupingUnavailable })
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

  const refresh = (session: NonNullable<ReturnType<typeof captureProjectSession>>) => {
    globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts', 'blueprints', 'fileTree'], projectPath: session.projectPath, projectSession: session })
  }
  const actDirectory = async (action: ProseDirectoryAction) => {
    const session = captureProjectSession(project)
    if (!session || busy || !isProjectSessionPath(session, tab.projectKey)) return
    setBusy(true)
    try {
      if (action.type === 'trash-draft' || action.type === 'rename-draft') {
        const editor = useEditorStore.getState()
        for (const item of editor.tabs.filter(item => item.projectKey === session.projectPath && (item.draftId === action.draftId || item.filePath === `vela://draft/${action.draftId}` || item.filePath === `vela://manuscript/${action.draftId}`) && item.dirty)) {
          await saveEditorTabBeforeClose(item.id)
          if (useEditorStore.getState().tabs.find(tab => tab.id === item.id)?.dirty) throw new Error(text('稿件仍有未保存输入，请先保存再操作', 'Save this draft before continuing.'))
        }
      }
      if (!isProjectSessionCurrent(session)) return
      const result = await ipc.invokeWithProjectSession(session, 'db:prose-directory-action', action, session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success) throw new Error(result.error)
      if (result.warning) toast.info(result.warning)
      if (result.trashId) { setUndoId(result.trashId); toast.info(text('已移入回收站，可点击“撤销删除”恢复', 'Moved to recycle bin. Use Undo deletion to restore.')) }
      if (action.type === 'trash-draft') {
        const editor = useEditorStore.getState()
        for (const item of editor.tabs.filter(item => item.projectKey === session.projectPath && (item.draftId === action.draftId || item.filePath === `vela://draft/${action.draftId}` || item.filePath === `vela://manuscript/${action.draftId}`))) editor.closeTab(item.id)
      }
      if (action.type === 'rename-draft') useEditorStore.setState(state => ({ tabs: state.tabs.map(item => item.projectKey === session.projectPath && item.draftId === action.draftId ? { ...item, name: action.name } : item) }))
      if (action.type === 'restore' || action.type === 'purge') {
        if (undoId === action.trashId) setUndoId(null)
        const entries = await ipc.invokeWithProjectSession(session, 'db:prose-trash', session.projectPath)
        if (isProjectSessionCurrent(session)) setTrash(entries)
      }
      setRenaming(null)
      refresh(session)
      const chapterNumber = action.type === 'trash-draft' || action.type === 'rename-draft' ? data?.drafts.find(draft => draft.id === action.draftId)?.chapterNumber : undefined
      if (chapterNumber !== undefined) await useDraftStore.getState().loadChapterDrafts(chapterNumber, session.projectPath, session)
    } catch (cause) { if (isProjectSessionCurrent(session)) toast.error(String(cause)) }
    finally { setBusy(false) }
  }
  const showMenu = (items: ContextMenuEntry[], event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation()
    setMenu({ items, position: { x: event.clientX, y: event.clientY } })
  }
  const draftMenu = (draft: DraftMeta): ContextMenuEntry[] => [
    { key: 'rename', label: text('重命名章节', 'Rename chapter'), onClick: () => setRenaming({ draftId: draft.id, name: draft.chapterTitle || '' }) },
    { key: 'trash', label: text('移入回收站', 'Move to recycle bin'), danger: true, onClick: () => void actDirectory({ type: 'trash-draft', draftId: draft.id }) },
  ]
  const openTrash = async () => {
    const session = captureProjectSession(project)
    if (!session) return
    try {
      const entries = await ipc.invokeWithProjectSession(session, 'db:prose-trash', session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      setTrash(entries); setTrashOpen(true)
    } catch (cause) { if (isProjectSessionCurrent(session)) toast.error(String(cause)) }
  }

  const renderTarget = (draft: DraftMeta, kind: 'draft' | 'manuscript', number: number) => {
    const path = `vela://${kind}/${draft.id}`
    const label = kind === 'draft'
      ? text(`草稿 v${draft.version}`, `Draft v${draft.version}`)
      : text(`正文 v${draft.version}`, `Manuscript v${draft.version}`)
    return (
      <div key={path} className="chapter-outline-target-row" onContextMenu={event => showMenu(draftMenu(draft), event)}><button
        type="button"
        className={`chapter-outline-target${currentPath === path ? ' is-current' : ''}`}
        aria-current={currentPath === path ? 'page' : undefined}
        disabled={busy}
        onClick={() => void openTarget({ path, name: `${text(`第 ${number} 章`, `Chapter ${number}`)} ${draft.chapterTitle || ''} v${draft.version}` })}
      >
        <span className={`chapter-outline-kind chapter-outline-kind--${kind}`} aria-hidden="true" />
        <span>{label}{kind === 'draft' && draft.chapterTitle ? ` · ${draft.chapterTitle}` : ''}</span>
      </button><button type="button" className="chapter-outline-arrow" disabled={busy} aria-label={text(`稿件 v${draft.version} 操作`, `Draft v${draft.version} actions`)} onClick={event => showMenu(draftMenu(draft), event)}><MoreHorizontal size={12} /></button></div>
    )
  }

  const moveChapter = async () => {
    const session = captureProjectSession(project)
    if (!session || movingChapter === null || busy) return
    setBusy(true)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:prose-directory-action', { type: 'relocate', chapterNumber: movingChapter, volumeId: moveVolume || null, ...(movePosition ? { relativeTo: Number(movePosition), side: moveSide } : {}) }, session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success) throw new Error(result.error)
      if (result.warning) toast.info(result.warning)
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
          <button type="button" disabled={busy} onClick={() => void openTrash()}><Trash2 size={14} />{text('回收站', 'Recycle bin')}</button>
          {undoId !== null && <button type="button" disabled={busy} onClick={() => void actDirectory({ type: 'restore', trashId: undoId })}><Undo2 size={14} />{text('撤销删除', 'Undo deletion')}</button>}
        </div>}
        {open && <nav className="chapter-outline-list" aria-label={text('按卷浏览章节', 'Browse chapters by volume')}>
          {error && <div className="chapter-outline-message" role="alert">{text('目录读取失败，请刷新重试', 'Could not load the outline. Refresh to try again.')}</div>}
          {!error && !data && <div className="chapter-outline-message">{text('正在读取章节…', 'Loading chapters…')}</div>}
          {!error && data && groups.length === 0 && <div className="chapter-outline-message">{text('暂无草稿或正文章节', 'No drafts or manuscript chapters yet')}</div>}
          {!error && data && groups.length > 0 && loaded?.groupingUnavailable && <div className="chapter-outline-message" role="status">{text('卷信息读取失败，正文暂列于未归卷，可刷新重试', 'Volume information could not load. Prose is listed under Unassigned; refresh to retry.')}</div>}
          {!error && data && groups.map(group => {
            const closed = !expandedVolumes.has(group.volume.id)
            const addChapter = () => setNewChapter({ id: group.volume.id === 'ungrouped' ? null : group.volume.id, name: group.volume.name || text('未归卷', 'Unassigned') })
            const volumeMenu: ContextMenuEntry[] = [
              { key: 'add', label: text('添加章节', 'Add chapter'), onClick: addChapter },
              ...(group.volume.id !== 'ungrouped' ? [
                { key: 'rename', label: text('重命名卷', 'Rename volume'), onClick: () => setRenaming({ volumeId: group.volume.id, name: group.volume.name }) },
                { key: 'trash', label: text('删除卷（章节移入未归卷）', 'Delete volume (keep chapters)'), danger: true, onClick: () => void actDirectory({ type: 'trash-volume', volumeId: group.volume.id }) },
              ] : []),
            ]
            return <div className="chapter-outline-volume" key={group.volume.id}>
              <div className={`chapter-outline-volume-row${selectedVolume === group.volume.id ? ' is-selected' : ''}`} onContextMenu={event => showMenu(volumeMenu, event)} onKeyDown={event => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault()
                  const bounds = event.currentTarget.getBoundingClientRect()
                  setMenu({ items: volumeMenu, position: { x: bounds.left + 24, y: bounds.bottom } })
                }
              }}>
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
                <button type="button" className="chapter-outline-arrow" disabled={busy || loaded?.groupingUnavailable} aria-label={text(`向${group.volume.name || '未归卷'}添加章节`, `Add chapter to ${group.volume.name || 'Unassigned'}`)} onClick={addChapter}><Plus size={14} /></button>
              </div>
              {!closed && group.chapters.length === 0 && <div className="chapter-outline-message">{text('暂无章节，点击卷右侧＋添加章节', 'No chapters yet. Add a chapter above.')}</div>}
              {!closed && group.chapters.map(chapter => <div className="chapter-outline-chapter" key={chapter.chapterNumber} onContextMenu={event => showMenu([
                { key: 'before', label: text('在前面插入新章节', 'Insert chapter before'), onClick: () => setNewChapter({ id: group.volume.id === 'ungrouped' ? null : group.volume.id, name: group.volume.name, insertRelativeTo: chapter.chapterNumber, insertSide: 'before' }) },
                { key: 'after', label: text('在后面插入新章节', 'Insert chapter after'), onClick: () => setNewChapter({ id: group.volume.id === 'ungrouped' ? null : group.volume.id, name: group.volume.name, insertRelativeTo: chapter.chapterNumber, insertSide: 'after' }) },
                { key: 'candidate', label: text('添加这一章的候选稿', 'Add another draft for this chapter'), onClick: () => setNewChapter({ id: group.volume.id === 'ungrouped' ? null : group.volume.id, name: group.volume.name, insertRelativeTo: undefined, insertSide: undefined, chapterNumber: chapter.chapterNumber }) },
                { key: 'move', label: text('移动章节／调整顺序', 'Move / reorder chapter'), onClick: () => { setMovingChapter(chapter.chapterNumber); setMoveVolume(group.volume.id === 'ungrouped' ? '' : group.volume.id); setMovePosition('') } },
                ...draftMenu(chapter.draft ?? chapter.manuscript!),
              ], event)}>
                <button type="button" className="chapter-outline-chapter-button" disabled={busy} onClick={() => void openTarget({
                  path: chapter.draft ? `vela://draft/${chapter.draft.id}` : `vela://manuscript/${chapter.manuscript!.id}`,
                  name: `${text(`第 ${chapter.number} 章`, `Chapter ${chapter.number}`)} ${chapter.title}`,
                })}>
                  <span>{text(`第 ${chapter.number} 章`, `Ch. ${chapter.number}`)}</span>
                  <span className="chapter-outline-chapter-title">{chapter.title || text('未命名', 'Untitled')}</span>
                </button>
                <div className="chapter-outline-targets">
                  <button type="button" className="chapter-outline-target" disabled={busy || loaded?.groupingUnavailable} aria-label={text(`移动第 ${chapter.number} 章到卷`, `Move Chapter ${chapter.number} to volume`)} onClick={() => { setMovingChapter(chapter.chapterNumber); setMovePosition(''); setMoveVolume(group.volume.id === 'ungrouped' ? '' : group.volume.id) }}>{text('移动／排序', 'Move / reorder')}</button>
                  {chapter.drafts.map(draft => renderTarget(draft, 'draft', chapter.number))}
                  {chapter.manuscript && renderTarget(chapter.manuscript, 'manuscript', chapter.number)}
                </div>
              </div>)}
            </div>
          })}
        </nav>}
      </aside>
      <NewVolumeDialog open={newVolume} onOpenChange={setNewVolume} />
      <NewDraftDialog open={newChapter !== null} onOpenChange={value => { if (!value) setNewChapter(null) }} insertRelativeTo={newChapter?.insertRelativeTo} insertSide={newChapter?.insertSide} suggestedChapterNumber={newChapter?.chapterNumber ?? Math.max(0, ...(data?.drafts.map(draft => draft.chapterNumber) ?? []), ...(data?.order?.map(row => row.chapterNumber) ?? [])) + 1} volumeId={newChapter?.id} volumeName={newChapter?.name} />
      {menu && <ContextMenu items={menu.items} position={menu.position} onClose={() => setMenu(null)} />}
      <Dialog open={renaming !== null} onOpenChange={value => { if (!value && !busy) setRenaming(null) }}>
        <DialogContent className="max-w-[420px]"><DialogHeader><DialogTitle>{text('重命名', 'Rename')}</DialogTitle><DialogDescription>{text('修改名称，保留稿件内容和关联。', 'Change the name while preserving content and bindings.')}</DialogDescription></DialogHeader>
          <div className="px-6 py-5"><Input aria-label={text('名称', 'Name')} autoFocus maxLength={500} value={renaming?.name ?? ''} onChange={event => setRenaming(previous => previous ? { ...previous, name: event.target.value } : null)} /></div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setRenaming(null)}>{text('取消', 'Cancel')}</Button><Button disabled={busy || !renaming?.name.trim()} onClick={() => renaming && void actDirectory(renaming.draftId !== undefined ? { type: 'rename-draft', draftId: renaming.draftId, name: renaming.name } : { type: 'rename-volume', volumeId: renaming.volumeId!, name: renaming.name })}>{text('保存名称', 'Save name')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}><DialogContent className="max-w-[560px]"><DialogHeader><DialogTitle>{text('项目回收站', 'Project recycle bin')}</DialogTitle><DialogDescription>{text('恢复会保留正文内容和原位置。若已有新正文，旧正文恢复为草稿。', 'Restore content at its original position. If a newer manuscript exists, restore the old one as a draft.')}</DialogDescription></DialogHeader>
        <div className="prose-trash-list">{trash.length === 0 && <p>{text('回收站为空', 'Recycle bin is empty')}</p>}{trash.map(entry => <div className="prose-trash-row" key={entry.id}><span>{entry.name}<small>{entry.deletedAt}</small></span><Button variant="ghost" disabled={busy} onClick={() => void actDirectory({ type: 'restore', trashId: entry.id })}>{text('恢复', 'Restore')}</Button><Button variant="ghost" disabled={busy} onClick={async () => { if (await confirm(text('永久删除后无法恢复，确定继续吗？', 'Permanent deletion cannot be undone. Continue?'), { title: text('永久删除', 'Delete permanently'), danger: true })) void actDirectory({ type: 'purge', trashId: entry.id }) }}>{text('永久删除', 'Delete permanently')}</Button></div>)}</div>
        <DialogFooter><Button variant="ghost" onClick={() => setTrashOpen(false)}>{text('关闭', 'Close')}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={movingChapter !== null} onOpenChange={value => { if (!value && !busy) setMovingChapter(null) }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle>{text('移动章节到卷', 'Move chapter to volume')}</DialogTitle><DialogDescription>{text('同一章节的草稿和定稿会一起移动。', 'Drafts and finalized prose for this chapter move together.')}</DialogDescription></DialogHeader>
          <div className="px-6 py-5"><label htmlFor="prose-move-volume">{text('目标卷', 'Destination volume')}</label>
            <select id="prose-move-volume" className="chapter-outline-volume-select" disabled={busy} value={moveVolume} onChange={event => setMoveVolume(event.target.value)}>
              <option value="">{text('未归卷', 'Unassigned')}</option>{data?.volumes.map(volume => <option key={volume.id} value={volume.id}>{volume.name}</option>)}
            </select>
            <label htmlFor="prose-move-position">{text('插入位置', 'Insert position')}</label>
            <select id="prose-move-position" className="chapter-outline-volume-select" value={movePosition} onChange={event => setMovePosition(event.target.value)} disabled={busy}>
              <option value="">{text('保留相对位置', 'Keep relative position')}</option>{groups.filter(group => (group.volume.id === 'ungrouped' ? '' : group.volume.id) === moveVolume).flatMap(group => group.chapters).filter(chapter => chapter.chapterNumber !== movingChapter).map(chapter => <option key={chapter.chapterNumber} value={chapter.chapterNumber}>{text(`第 ${chapter.number} 章`, `Chapter ${chapter.number}`)} {chapter.title}</option>)}
            </select>
            <select aria-label={text('前后位置', 'Before or after')} className="chapter-outline-volume-select" value={moveSide} onChange={event => setMoveSide(event.target.value as 'before' | 'after')} disabled={busy}><option value="before">{text('之前', 'Before')}</option><option value="after">{text('之后', 'After')}</option></select>
            </div>
          <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setMovingChapter(null)}>{text('取消', 'Cancel')}</Button><Button disabled={busy} onClick={() => void moveChapter()}>{text('确认移动', 'Move chapter')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
