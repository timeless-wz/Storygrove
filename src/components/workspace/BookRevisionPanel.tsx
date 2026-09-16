import { useState } from 'react'
import { FileCheck2, RefreshCw } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import { getActiveProjectSessionContext, sameProjectSessionContext } from '../../shared/project-session-context'
import { analyzeBook, type BookRevisionReport } from '../../shared/book-revision'
import { storyDataService } from '../../services/story-data-service'
import type { DatabaseChannels } from '../../shared/ipc-channels'

export default function BookRevisionPanel() {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const [report, setReport] = useState<BookRevisionReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [finalizedDrafts, setFinalizedDrafts] = useState<DatabaseChannels['db:draft-list-all']['return']>([])
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null)

  const run = async () => {
    const session = getActiveProjectSessionContext()
    if (!project || !session) return
    setBusy(true)
    setError(null)
    try {
      const drafts = await ipc.invokeWithProjectSession(session, 'db:draft-list-all', project.path)
      const finalized = drafts.filter(draft => draft.status === 'finalized')
      const chapters = await Promise.all(finalized.map(async draft => {
        const full = await ipc.invokeWithProjectSession(session, 'db:draft-get-full', draft.id, project.path)
        return { chapterNumber: draft.chapterNumber, title: draft.chapterTitle ?? `第${draft.chapterNumber}章`, content: full?.content ?? '' }
      }))
      const facts = await storyDataService.listFacts(session, 'confirmed')
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      setFinalizedDrafts(finalized)
      const controlledTerms = facts.flatMap(fact => {
        if (fact.entityType !== 'character' && fact.entityType !== 'organization' && fact.entityType !== 'place') return []
        const aliases = Array.isArray((fact.payload as Record<string, unknown>).aliases)
          ? ((fact.payload as Record<string, unknown>).aliases as unknown[]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : []
        return aliases.length > 0 ? [{ canonical: fact.canonicalName, discouragedVariants: aliases.filter(alias => alias !== fact.canonicalName) }] : []
      })
      setReport(analyzeBook(chapters, { controlledTerms }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const extractFinalizedFacts = async (draftId: number, chapterNumber: number) => {
    const session = getActiveProjectSessionContext()
    if (!session) return
    setExtractionMessage(null)
    try {
      const candidates = await storyDataService.extractFinalizedDraft(session, draftId)
      if (!sameProjectSessionContext(session, getActiveProjectSessionContext())) return
      if (!Array.isArray(candidates)) throw new Error('候选资料返回无效')
      setExtractionMessage(text(`第${chapterNumber}章已提取 ${candidates.length} 条候选资料，等待作者确认。`, `Extracted ${candidates.length} candidate facts from chapter ${chapterNumber}; author approval is still required.`))
    } catch (cause) {
      setExtractionMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <div className="h-full overflow-auto p-4 space-y-4" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-editor-bg)' }}>
    <div className="flex items-center justify-between gap-3">
      <div><div className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} style={{ color: 'var(--color-accent)' }} />{text('全书修订与输出检查', 'Whole-book revision and output checks')}</div><p className="text-[11px] opacity-70 mt-1">{text('只读取定稿正文，报告重复段落、低推进章节、标题编号和伏笔状态，不会修改正文。', 'Reads finalized prose only and reports duplicates, low-progress chapters, title numbering, and foreshadowing without changing prose.')}</p></div>
      <button className="writer-command-button" onClick={() => void run()} disabled={busy || !project}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{busy ? text('检查中…', 'Checking…') : text('运行全书检查', 'Run book check')}</button>
    </div>
    {error && <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>{error}</div>}
    {report && <>
      <div className="grid grid-cols-3 gap-2"><div className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-[11px] opacity-70">{text('定稿章节', 'Finalized chapters')}</div><div className="text-xl font-semibold">{report.chapterCount}</div></div><div className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-[11px] opacity-70">{text('总字数', 'Total words')}</div><div className="text-xl font-semibold">{report.totalWords.toLocaleString()}</div></div><div className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-[11px] opacity-70">{text('发现', 'Findings')}</div><div className="text-xl font-semibold">{report.findings.length}</div></div></div>
      <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold">{text('可追溯问题', 'Traceable findings')}</div>{report.findings.length === 0 ? <div className="text-xs opacity-70">{text('未发现确定性问题。', 'No deterministic findings.')}</div> : report.findings.map((finding, index) => <div key={`${finding.code}-${index}`} className="rounded border p-2 text-xs" style={{ borderColor: 'var(--color-border)' }}><div className="font-medium">{finding.code} · {text('第', 'Chapter ')}{finding.chapters.join(', ')}{text('章', '')}</div><div className="opacity-80 mt-1">{finding.evidence}</div><div className="opacity-60 mt-1">{finding.suggestion}</div></div>)}</div>
      <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold">{text('伏笔状态', 'Foreshadowing status')}</div>{report.foreshadowing.length === 0 ? <div className="text-xs opacity-70">{text('未识别到带有伏笔标记的行。', 'No marked foreshadowing lines found.')}</div> : report.foreshadowing.map((item, index) => <div key={`${item.chapterNumber}-${index}`} className="text-xs flex gap-2"><span className={item.status === 'resolved' ? 'text-[var(--color-success-text)]' : 'text-[var(--color-warning-text)]'}>{item.status}</span><span>第{item.chapterNumber}章</span><span className="opacity-80 truncate">{item.text}</span></div>)}</div>
      <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="text-xs font-semibold">{text('从定稿提取事实候选', 'Extract candidate facts from finalized prose')}</div>
        <p className="text-[11px] opacity-70">{text('只从当前定稿正文提取；结果始终是候选，必须在故事资料中心由作者批准后才会成为正式事实。', 'Reads current finalized prose only. Results remain candidates until the author approves them in Story Data Center.')}</p>
        <div className="flex flex-wrap gap-2">{finalizedDrafts.map(draft => <button key={draft.id} type="button" className="writer-command-button text-xs" onClick={() => void extractFinalizedFacts(draft.id, draft.chapterNumber)}>{text(`提取第${draft.chapterNumber}章候选`, `Extract chapter ${draft.chapterNumber} candidates`)}</button>)}</div>
        {extractionMessage && <div className="text-xs opacity-80">{extractionMessage}</div>}
      </div>
    </>}
  </div>
}
