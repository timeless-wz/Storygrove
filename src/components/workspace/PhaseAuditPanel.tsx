import { useState } from 'react'
import { Search, ShieldAlert, Play, FileSearch } from 'lucide-react'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { Input } from '../ui/Input'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { projectSessionContextFromProject } from '../../shared/project-session-context'
import { phase3To8Service } from '../../services/phase3-8-service'
import type { PhaseAuditFinding, PhaseRagSearchHit } from '../../shared/phase3-8'

export default function PhaseAuditPanel() {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const [chapter, setChapter] = useState('1')
  const [content, setContent] = useState('')
  const [query, setQuery] = useState('')
  const [findings, setFindings] = useState<PhaseAuditFinding[]>([])
  const [hits, setHits] = useState<PhaseRagSearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const session = projectSessionContextFromProject(project)

  const runAudit = async () => {
    if (!session || !content.trim()) return
    setBusy(true); setError('')
    try { const result = await phase3To8Service.auditChapter(session, Number(chapter), content); setFindings(result.findings) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const search = async () => {
    if (!session || !query.trim()) return
    setBusy(true); setError('')
    try { const result = await phase3To8Service.search(session, query); setHits(result.hits) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  return <div className="h-full overflow-auto p-4 space-y-4" style={{ color: 'var(--color-text)' }}>
    <div className="flex items-center gap-2"><ShieldAlert size={16} style={{ color: 'var(--color-accent)' }} /><h2 className="font-semibold">{text('审核与可追溯检索', 'Audit & Traceable Search')}</h2></div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2"><FileSearch size={14} /><span className="font-medium">{text('章节连续性预检', 'Chapter continuity preflight')}</span></div>
        <Input value={chapter} onChange={event => setChapter(event.target.value)} type="number" min={1} placeholder={text('章节号', 'Chapter')} />
        <Textarea value={content} onChange={event => setContent(event.target.value)} rows={9} placeholder={text('粘贴待审核章节正文；结果只写入审核账本，不修改正文。', 'Paste chapter prose; findings are stored in the audit ledger and never rewrite prose.')} />
        <Button size="sm" onClick={() => void runAudit()} disabled={busy || !session || !content.trim()} className="gap-1"><Play size={13} />{text('运行审核', 'Run audit')}</Button>
        {findings.length === 0 && <p className="text-xs opacity-60">{text('暂无审核发现。', 'No findings.')}</p>}
        {findings.map(finding => <div key={finding.findingId} className="rounded border p-2 text-xs space-y-1" style={{ borderColor: finding.severity === 'high' || finding.severity === 'error' ? 'var(--color-error)' : 'var(--color-border)' }}><div className="font-semibold">{finding.ruleCode} · {finding.severity}</div><div>{finding.explanation}</div><div className="opacity-70">{finding.suggestion}</div></div>)}
      </section>
      <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2"><Search size={14} /><span className="font-medium">{text('权威资料检索', 'Authoritative knowledge search')}</span></div>
        <div className="flex gap-2"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder={text('例如：林越 左臂', 'e.g. Lin Yue left arm')} /><Button size="sm" onClick={() => void search()} disabled={busy || !session || !query.trim()}><Search size={13} /></Button></div>
        {hits.map((hit, index) => <div key={`${hit.fileName}-${index}`} className="rounded border p-2 text-xs" style={{ borderColor: 'var(--color-border)' }}><div className="font-medium">{hit.fileName} · {hit.authorityStatus}</div><div className="mt-1">{hit.text}</div>{hit.source && <div className="mt-1 opacity-60">{String(hit.source.sourceFile ?? '')}:{String(hit.source.startLine ?? '')}-{String(hit.source.endLine ?? '')}</div>}</div>)}
        {hits.length === 0 && <p className="text-xs opacity-60">{text('暂无检索结果。', 'No search results.')}</p>}
      </section>
    </div>
    {error && <div className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</div>}
  </div>
}
