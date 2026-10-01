import { useEffect, useMemo, useState } from 'react'
import { FilePenLine, FileSearch, ListChecks, Sparkles } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { getActiveProjectSessionContext, sameProjectSessionContext } from '../../shared/project-session-context'
import { ipc } from '../../services/ipc-client'
import { storyDataService } from '../../services/story-data-service'
import { openBuiltinEditor, openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import type { DatabaseChannels } from '../../shared/ipc-channels'
import { getBlueprintV2Scenes, type ChapterBlueprintV2DetailRead } from '../../shared/blueprint-v2'
import { assertNoLossOnSerialize } from '../../shared/blueprint-v2-markdown'

type BlueprintView = {
  chapterNumber: number
  title?: string
  purpose?: string
  keyEvents?: string
  scenes: Array<{ id: string; title: string; markdown: string }>
  markdown: string | null
}

/**
 * Projects one persisted blueprint into this panel's read-only view. The view is
 * a strict subset of BlueprintData, so each field is selected explicitly instead
 * of asserting the IPC payload into a narrower shape.
 */
function toBlueprintView(
  blueprint: DatabaseChannels['db:blueprint-get']['return'],
  detail: ChapterBlueprintV2DetailRead | null,
): BlueprintView | null {
  if (!blueprint) return null
  const validDetail = detail && !detail.readStatus ? detail : null
  const markdown = validDetail ? assertNoLossOnSerialize(validDetail) : detail?.rawMarkdown ?? null
  const scenes = validDetail
    ? getBlueprintV2Scenes(validDetail).map(scene => ({ id: scene.sceneId, title: scene.title, markdown: scene.markdown }))
    : []
  return {
    chapterNumber: blueprint.chapterNumber,
    title: blueprint.title,
    purpose: blueprint.purpose,
    keyEvents: blueprint.keyEvents,
    scenes,
    markdown,
  }
}

/**
 * A composed chapter surface. It intentionally reuses the existing blueprint
 * and draft editors rather than creating a second writable copy of either.
 */
export default function ChapterWorkflowPanel() {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const chapter = useWorkspaceHubStore(s => s.targetChapterNumber)
  const setChapter = useWorkspaceHubStore(s => s.setTargetChapterNumber)
  const assemble = useWorkspaceHubStore(s => s.assembleChapterContext)
  const setWorkspaceTab = useWorkspaceHubStore(s => s.setActiveTab)
  const [blueprint, setBlueprint] = useState<BlueprintView | null>(null)
  const [drafts, setDrafts] = useState<DatabaseChannels['db:draft-list']['return']>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const session = getActiveProjectSessionContext()

  const refresh = async () => {
    if (!project || !session) return
    setBusy(true)
    try {
      const [chapterBlueprint, detail, chapterDrafts] = await Promise.all([
        ipc.invokeWithProjectSession(session, 'db:blueprint-get', chapter, session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:blueprint-v2-get', chapter, session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:draft-list', chapter, session.projectPath),
      ])
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      setBlueprint(toBlueprintView(chapterBlueprint, detail))
      setDrafts(chapterDrafts)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!project?.path || !session) return
    let cancelled = false
    void Promise.all([
      ipc.invokeWithProjectSession(session, 'db:blueprint-get', chapter, session.projectPath),
      ipc.invokeWithProjectSession(session, 'db:blueprint-v2-get', chapter, session.projectPath),
      ipc.invokeWithProjectSession(session, 'db:draft-list', chapter, session.projectPath),
    ]).then(([chapterBlueprint, detail, chapterDrafts]) => {
      if (cancelled || !sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      setBlueprint(toBlueprintView(chapterBlueprint, detail))
      setDrafts(chapterDrafts)
    }).catch(cause => {
      if (!cancelled) setMessage(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [chapter, project?.path, session, session?.leaseId])

  const beats = useMemo(() => (blueprint?.keyEvents ?? '').split(/\r?\n|[；;]/u).map(value => value.trim()).filter(Boolean), [blueprint])

  const assembleContext = async () => {
    setMessage('')
    await assemble()
    if (sameProjectSessionContext(session, getActiveProjectSessionContext())) {
      setWorkspaceTab('context')
    }
  }

  const openDraft = async (draft: DatabaseChannels['db:draft-list']['return'][number]) => {
    if (!project) return
    await openChapterFile(`vela://draft/${draft.id}`, `第${draft.chapterNumber}章 v${draft.version}`)
  }

  const extract = async (draft: DatabaseChannels['db:draft-list']['return'][number]) => {
    if (!session) return
    setMessage('')
    try {
      const candidates = await storyDataService.extractFinalizedDraft(session, draft.id)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      if (!Array.isArray(candidates)) throw new Error('候选资料返回无效')
      setMessage(text(`已从第${chapter}章定稿提取 ${candidates.length} 条候选资料，等待作者确认。`, `Extracted ${candidates.length} candidate facts from finalized chapter ${chapter}; author approval is still required.`))
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)) }
  }

  return <div className="h-full overflow-auto p-4 space-y-4" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-editor-bg)' }}>
    <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-semibold"><FilePenLine size={16} style={{ color: 'var(--color-accent)' }} />{text('章节创作工作台', 'Chapter Creation Workbench')}</div><p className="text-[11px] opacity-70 mt-1">{text('从已确认细纲和上下文开始，复用唯一的场景、正文、审核和定稿编辑器；不会复制或隐式改写作者正文。', 'Starts from confirmed outline and context, then reuses the single scene, prose, audit, and finalization editors without copying or silently rewriting author prose.')}</p></div><button className="writer-command-button" onClick={() => void refresh()} disabled={busy}>{busy ? text('加载中…', 'Loading…') : text('刷新本章状态', 'Refresh chapter state')}</button></div>
    <label className="text-xs flex items-center gap-2">{text('目标章节', 'Target chapter')}<input type="number" min={1} value={chapter} onChange={event => setChapter(Math.max(1, Number(event.target.value) || 1))} className="w-20 rounded border bg-transparent p-1 text-center" style={{ borderColor: 'var(--color-border)' }} /></label>
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex items-center gap-2 text-xs font-semibold"><Sparkles size={14} />1. {text('上下文装配', 'Context assembly')}</div><p className="text-xs opacity-75">{text('只装入已确认资料；候选与废案不进入正式正文上下文。', 'Only confirmed material enters formal prose context; candidates and deprecated items are excluded.')}</p><button className="writer-command-button text-xs" onClick={() => void assembleContext()}>{text('装配并查看上下文', 'Assemble and inspect context')}</button></section>
      <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex items-center gap-2 text-xs font-semibold"><ListChecks size={14} />2. {text('细纲与正式分镜', 'Outline and formal scenes')}</div>{blueprint ? <><div className="text-xs font-medium">{blueprint.title || text(`第${chapter}章细纲`, `Chapter ${chapter} outline`)}</div><div className="text-xs opacity-75">{blueprint.purpose}</div>{blueprint.scenes.length > 0 ? <ol className="list-decimal ml-4 text-xs space-y-1">{blueprint.scenes.map(scene => <li key={scene.id}><span className="font-medium">{scene.title}</span><div className="whitespace-pre-wrap opacity-75">{scene.markdown}</div></li>)}</ol> : blueprint.markdown ? <div className="text-xs opacity-60">{text('细纲已有内容，但尚未建立正式分镜。', 'The outline has content but no formal storyboard scenes.')}</div> : beats.length > 0 ? <ol className="list-decimal ml-4 text-xs space-y-1">{beats.map((beat, index) => <li key={index}>{beat}</li>)}</ol> : <div className="text-xs opacity-60">{text('尚未填写场景节拍。', 'No scene beats yet.')}</div>}{blueprint.markdown && <details><summary className="cursor-pointer text-xs">{text('查看完整 Markdown', 'View full Markdown')}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{blueprint.markdown}</pre></details>}<button className="writer-command-button text-xs" onClick={() => openBuiltinEditor(`chapter-card-${chapter}`, text(`第${chapter}章细纲`, `Chapter ${chapter} outline`), 'chapter-card', undefined, chapter)}>{text('编辑细纲与分镜', 'Edit outline and scenes')}</button></> : <div className="text-xs opacity-60">{text('本章还没有细纲；先在章节卡中建立作者可编辑的细纲。', 'This chapter has no outline yet; create it in the author-editable chapter card first.')}</div>}</section>
      <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex items-center gap-2 text-xs font-semibold"><FilePenLine size={14} />3–6. {text('正文、审核、修订与定稿', 'Prose, audit, revision, and finalization')}</div><p className="text-xs opacity-75">{text('打开草稿后，正文编辑器提供局部重写、审稿、修订合并和定稿；定稿前会运行确定性连续性门禁。', 'Opening a draft exposes localized rewrite, review, revision merge, and finalization; deterministic continuity is gated before finalization.')}</p>{drafts.length === 0 ? <div className="text-xs opacity-60">{text('尚未创建草稿。请在章节卡确认细纲后创建或生成初稿。', 'No draft yet. Confirm the outline in the chapter card, then create or generate the first draft.')}</div> : <div className="flex flex-wrap gap-2">{drafts.map(draft => <button key={draft.id} type="button" className="writer-command-button text-xs" onClick={() => void openDraft(draft)}>{text(`打开 v${draft.version}（${draft.status}）`, `Open v${draft.version} (${draft.status})`)}</button>)}</div>}</section>
      <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex items-center gap-2 text-xs font-semibold"><FileSearch size={14} />7. {text('定稿事实候选', 'Finalized fact candidates')}</div><p className="text-xs opacity-75">{text('仅可从当前定稿提取候选；作者批准后才会进入正式资料库。', 'Only current finalized prose can be extracted, and author approval is still required before the formal fact store changes.')}</p><div className="flex flex-wrap gap-2">{drafts.filter(draft => draft.status === 'finalized').map(draft => <button key={draft.id} type="button" className="writer-command-button text-xs" onClick={() => void extract(draft)}>{text('提取候选资料', 'Extract candidates')}</button>)}</div></section>
    </div>
    {message && <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--color-border)' }}>{message}</div>}
  </div>
}
