import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, Database, FileWarning, GitBranch, History, Network, ShieldQuestion, Sparkles, UserRound, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { useLocaleStore } from '../../stores/locale-store'
import { useStoryDataStore } from '../../stores/story-data-store'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import type { StoryFact, StoryFactCandidate } from '../../shared/story-domain'

const entityLabels: Record<string, string> = {
  character: '人物', relationship: '关系', world_rule: '世界规则', place: '地点', organization: '组织',
  faction: '势力', item: '物品', civilization: '文明', power_system: '力量体系', timeline_event: '时间事件',
  narrative_thread: '叙事线', mystery: '谜题', foreshadowing: '伏笔', outline: '大纲',
}

function Provenance({ item, onOpenSource }: { item: StoryFact | StoryFactCandidate; onOpenSource?: () => void }) {
  return (
    <div className="text-[11px] space-y-1 opacity-80">
      <div className="font-mono truncate" title={item.provenance.sourceFile}>{item.provenance.sourceFile}</div>
      <div>{item.provenance.sourceHeadingPath} · 第 {item.provenance.startLine}-{item.provenance.endLine} 行</div>
      <div className="font-mono truncate" title={item.provenance.contentHash}>hash: {item.provenance.contentHash}</div>
      {onOpenSource && <button className="text-accent hover:underline" onClick={onOpenSource}>查看来源片段 / Open source fragment</button>}
    </div>
  )
}

export default function StoryDataCenter() {
  const text = useLocaleStore(s => s.text)
  const selectSource = useWorkspaceHubStore(s => s.selectSource)
  const setWorkspaceTab = useWorkspaceHubStore(s => s.setActiveTab)
  const setTargetChapterNumber = useWorkspaceHubStore(s => s.setTargetChapterNumber)
  const assembleChapterContext = useWorkspaceHubStore(s => s.assembleChapterContext)
  const { candidates, facts, selectedFactId, versions, impacts, relations, allRelations, loading, error, load, selectFact, approve, reject, commit, addRelation } = useStoryDataStore()
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [payloadDraft, setPayloadDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState<'confirmed' | 'candidate' | 'deprecated'>('confirmed')
  const [confidenceDraft, setConfidenceDraft] = useState('')
  const [draftFactId, setDraftFactId] = useState<string | null>(null)
  const [relationTarget, setRelationTarget] = useState('')
  const [relationType, setRelationType] = useState('关联')
  const [entityFilter, setEntityFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'overview' | 'characters' | 'timeline' | 'graph' | 'foreshadowing'>('overview')
  const selectedFact = useMemo(() => facts.find(fact => fact.factId === selectedFactId) ?? null, [facts, selectedFactId])
  const visibleFacts = useMemo(() => entityFilter === 'all' ? facts : facts.filter(fact => fact.entityType === entityFilter), [entityFilter, facts])
  const visibleCandidates = useMemo(() => entityFilter === 'all' ? candidates : candidates.filter(candidate => candidate.entityType === entityFilter), [entityFilter, candidates])
  const characterFacts = useMemo(() => facts.filter(fact => fact.entityType === 'character'), [facts])
  const timelineFacts = useMemo(() => facts.filter(fact => fact.entityType === 'timeline_event').sort((a, b) => Number(a.payload.chapterNumber ?? 0) - Number(b.payload.chapterNumber ?? 0)), [facts])
  const foreshadowingFacts = useMemo(() => facts.filter(fact => fact.entityType === 'foreshadowing'), [facts])

  useEffect(() => { void load() }, [load])

  const handleApprove = async (candidate: StoryFactCandidate) => {
    const ok = await confirm(text(`确认将“${candidate.canonicalName}”写入正式资料库？\n\n来源：${candidate.provenance.sourceFile}`, `Confirm “${candidate.canonicalName}” into the authoritative story data?\n\nSource: ${candidate.provenance.sourceFile}`), {
      title: text('作者确认资料变更', 'Author confirmation required'),
      confirmText: text('确认写入', 'Confirm'),
    })
    if (!ok) return
    if (await approve(candidate.candidateId)) toast.success(text('已提交正式资料并更新影响章节', 'Authoritative fact committed and chapter impacts updated'))
  }

  const handleReject = async (candidate: StoryFactCandidate) => {
    if (await reject(candidate.candidateId)) toast.info(text('候选已标记为废止', 'Candidate rejected'))
  }

  const handleCommit = async () => {
    const nextSummary = draftFactId === selectedFact?.factId ? summaryDraft : (selectedFact?.summary ?? '')
    if (!selectedFact) return
    const nextPayloadText = draftFactId === selectedFact.factId ? payloadDraft : JSON.stringify(selectedFact.payload, null, 2)
    let nextPayload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(nextPayloadText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('payload 必须是 JSON 对象')
      nextPayload = parsed as Record<string, unknown>
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'payload JSON 无效')
      return
    }
    const nextConfidence = Number(confidenceDraft || selectedFact.confidence)
    if (!Number.isFinite(nextConfidence) || nextConfidence < 0 || nextConfidence > 1) {
      toast.error(text('置信度必须在 0 到 1 之间', 'Confidence must be between 0 and 1'))
      return
    }
    if (nextSummary.trim() === selectedFact.summary.trim()
      && nextPayloadText.trim() === JSON.stringify(selectedFact.payload, null, 2).trim()
      && statusDraft === selectedFact.status
      && nextConfidence === selectedFact.confidence) return
    const ok = await confirm(text('确认提交这条正式资料的新版本？', 'Commit a new version of this authoritative fact?'), { title: text('提交资料版本', 'Commit fact version'), confirmText: text('提交版本', 'Commit version') })
    if (ok && await commit({ factId: selectedFact.factId, summary: nextSummary, payload: nextPayload, status: statusDraft, confidence: nextConfidence, provenance: selectedFact.provenance })) toast.success(text('新版本已提交', 'New version committed'))
  }

  const handleAddRelation = async () => {
    if (await addRelation(relationTarget, relationType)) {
      setRelationTarget('')
      toast.success(text('资料关系已保存', 'Fact relation saved'))
    }
  }

  const openSource = async (sourceId: string) => {
    await selectSource(sourceId)
    setWorkspaceTab('sources')
  }

  const openImpactChapter = async (chapterNumber: number) => {
    setTargetChapterNumber(chapterNumber)
    setWorkspaceTab('context')
    await assembleChapterContext(chapterNumber)
  }

  const handleSelectFact = async (fact: StoryFact) => {
    setDraftFactId(fact.factId)
    setSummaryDraft(fact.summary)
    setPayloadDraft(JSON.stringify(fact.payload, null, 2))
    setStatusDraft(fact.status)
    setConfidenceDraft(String(fact.confidence))
    await selectFact(fact.factId)
  }

  const updatePayloadField = (key: string, value: unknown) => {
    if (!selectedFact) return
    const source = draftFactId === selectedFact.factId ? payloadDraft : JSON.stringify(selectedFact.payload, null, 2)
    try {
      const parsed: unknown = JSON.parse(source)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('payload 必须是 JSON 对象')
      ;(parsed as Record<string, unknown>)[key] = value
      setDraftFactId(selectedFact.factId)
      setPayloadDraft(JSON.stringify(parsed, null, 2))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'payload JSON 无效')
    }
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Database size={16} style={{ color: 'var(--color-accent)' }} />{text('故事资料管理中心', 'Story Data Center')}</div>
          <p className="text-[11px] opacity-70 mt-1">{text('模型只能提交候选；作者确认后才会进入正式资料库。每条资料都保留来源、版本与影响章节。', 'Models can only submit candidates. Author confirmation is required before facts become authoritative, with provenance, versions, and chapter impacts retained.')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{text('刷新', 'Refresh')}</Button>
      </div>

      {error && <div className="rounded border p-2 text-xs" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>{error}</div>}
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="opacity-70">{text('资料类型', 'Entity type')}</span><select value={entityFilter} onChange={event => setEntityFilter(event.target.value)} className="rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }}><option value="all">{text('全部类型', 'All types')}</option>{Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="opacity-60">{text(`候选 ${visibleCandidates.length} · 正式 ${visibleFacts.length}`, `Candidates ${visibleCandidates.length} · Facts ${visibleFacts.length}`)}</span><div className="flex gap-1 ml-auto">{([['overview', Database, '资料总览'], ['characters', UserRound, '人物卡'], ['timeline', CalendarClock, '时间轴'], ['graph', Network, '关系图'], ['foreshadowing', Sparkles, '伏笔回收']] as const).map(([mode, Icon, label]) => <button key={mode} onClick={() => setViewMode(mode)} className={`px-2 py-1 rounded flex items-center gap-1 ${viewMode === mode ? 'bg-accent/20 text-accent' : 'opacity-70 hover:bg-accent/10'}`}><Icon size={12} />{text(label, mode)}</button>)}</div></div>

      {viewMode === 'characters' && <section className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold mb-2">{text('人物卡与当前状态', 'Character cards & current state')}</div><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">{characterFacts.length === 0 ? <div className="text-xs opacity-60">{text('暂无已确认人物。', 'No confirmed characters.')}</div> : characterFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className="text-left rounded border p-3 hover:bg-accent/10" style={{ borderColor: 'var(--color-border)' }}><div className="font-medium">{fact.canonicalName}</div><div className="text-[11px] opacity-70 mt-1">{String(fact.payload.role ?? '未填写角色')} · {String(fact.payload.status ?? fact.payload.condition ?? '状态未记录')}</div><div className="text-xs mt-2 opacity-80">{fact.summary}</div></button>)}</div></section>}
      {viewMode === 'timeline' && <section className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold mb-2">{text('全书时间轴 / 事件 Ledger', 'Book timeline / event ledger')}</div><div className="space-y-1">{timelineFacts.length === 0 ? <div className="text-xs opacity-60">{text('暂无时间事件。', 'No timeline events.')}</div> : timelineFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className="w-full text-left grid grid-cols-[5rem_1fr_auto] gap-2 items-center rounded border p-2 hover:bg-accent/10 text-xs" style={{ borderColor: 'var(--color-border)' }}><span className="font-mono">{String(fact.payload.chapterNumber ?? fact.payload.date ?? '—')}</span><span>{fact.canonicalName} · {fact.summary}</span><span className="opacity-60">v{fact.revision}</span></button>)}</div></section>}
      {viewMode === 'foreshadowing' && <section className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold mb-2">{text('伏笔回收状态', 'Foreshadowing recovery status')}</div><div className="grid grid-cols-1 md:grid-cols-2 gap-2">{foreshadowingFacts.length === 0 ? <div className="text-xs opacity-60">{text('暂无已确认伏笔。', 'No confirmed foreshadowing.')}</div> : foreshadowingFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className="text-left rounded border p-3 hover:bg-accent/10" style={{ borderColor: 'var(--color-border)' }}><div className="flex justify-between"><span className="font-medium">{fact.canonicalName}</span><span className="text-[11px] opacity-70">{String(fact.payload.recoveryStatus ?? 'open')}</span></div><div className="text-xs mt-1 opacity-80">{fact.summary}</div></button>)}</div></section>}
      {viewMode === 'graph' && <section className="rounded border p-3 overflow-auto" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold mb-2">{text('人物与资料关系图', 'Story fact relationship graph')}</div><svg role="img" aria-label="story fact relationship graph" viewBox="0 0 760 360" className="w-full min-w-[620px] h-[360px]">{allRelations.map(relation => { const fromIndex = facts.findIndex(fact => fact.factId === relation.fromFactId); const toIndex = facts.findIndex(fact => fact.factId === relation.toFactId); if (fromIndex < 0 || toIndex < 0) return null; const fx = 90 + (fromIndex % 4) * 180; const fy = 70 + Math.floor(fromIndex / 4) * 120; const tx = 90 + (toIndex % 4) * 180; const ty = 70 + Math.floor(toIndex / 4) * 120; return <g key={relation.relationId}><line x1={fx} y1={fy} x2={tx} y2={ty} stroke="var(--color-border)" /><text x={(fx + tx) / 2} y={(fy + ty) / 2 - 4} fontSize="9" fill="var(--color-text-muted)">{relation.relationType}</text></g>})}{facts.slice(0, 12).map((fact, index) => { const x = 90 + (index % 4) * 180; const y = 70 + Math.floor(index / 4) * 120; return <g key={fact.factId} onClick={() => void handleSelectFact(fact)} className="cursor-pointer"><circle cx={x} cy={y} r="32" fill="var(--color-surface-raised)" stroke="var(--color-accent)" /><text x={x} y={y + 3} textAnchor="middle" fontSize="10" fill="var(--color-text)">{fact.canonicalName.slice(0, 8)}</text></g>})}</svg></section>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-semibold" style={{ borderColor: 'var(--color-border)' }}><ShieldQuestion size={14} />{text(`待作者确认 (${visibleCandidates.length})`, `Pending author review (${visibleCandidates.length})`)}</div>
          <div className="max-h-[420px] overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {visibleCandidates.length === 0 && <div className="p-4 text-xs opacity-60">{text('暂无待确认候选。', 'No pending candidates.')}</div>}
            {visibleCandidates.map(candidate => (
              <div key={candidate.candidateId} className={`p-3 space-y-2 ${selectedCandidateId === candidate.candidateId ? 'bg-accent/10' : ''}`}>
                <button className="w-full text-left" onClick={() => setSelectedCandidateId(candidate.candidateId)}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{candidate.canonicalName}</span><span className="text-[10px] opacity-70">{entityLabels[candidate.entityType] ?? candidate.entityType} · {(candidate.confidence * 100).toFixed(0)}%</span></div>
                  <div className="text-xs opacity-80 mt-1">{candidate.summary}</div>
                </button>
                {selectedCandidateId === candidate.candidateId && <>
                  <Provenance item={candidate} onOpenSource={() => void openSource(candidate.provenance.sourceId)} />
                  {!!candidate.possibleConflicts?.length && <div className="text-[11px]" style={{ color: 'var(--color-warning-text)' }}><FileWarning size={12} className="inline mr-1" />{candidate.possibleConflicts.join('；')}</div>}
                  <div className="flex gap-2"><Button size="sm" onClick={() => void handleApprove(candidate)}><Check size={13} />{text('确认写入', 'Confirm')}</Button><Button size="sm" variant="outline" onClick={() => void handleReject(candidate)}><X size={13} />{text('拒绝', 'Reject')}</Button></div>
                </>}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-semibold" style={{ borderColor: 'var(--color-border)' }}><GitBranch size={14} />{text(`正式资料 (${visibleFacts.length})`, `Authoritative facts (${visibleFacts.length})`)}</div>
          <div className="max-h-[420px] overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {visibleFacts.length === 0 && <div className="p-4 text-xs opacity-60">{text('尚未有作者确认资料。', 'No authoritative facts yet.')}</div>}
            {visibleFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className={`w-full text-left p-3 ${selectedFactId === fact.factId ? 'bg-accent/10' : ''}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{fact.canonicalName}</span><span className="text-[10px] opacity-70">{entityLabels[fact.entityType] ?? fact.entityType} · v{fact.revision}</span></div><div className="text-xs opacity-80 mt-1">{fact.summary}</div></button>)}
          </div>
        </section>
      </div>

      {selectedFact && <section className="rounded border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 text-xs font-semibold"><History size={14} />{selectedFact.canonicalName} · {text('来源与影响追踪', 'Provenance & impact trace')}</div>
        <Provenance item={selectedFact} onOpenSource={() => void openSource(selectedFact.provenance.sourceId)} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="font-medium mb-1">{text('作者编辑', 'Author editing')}</div>
            <textarea value={draftFactId === selectedFact.factId ? summaryDraft : selectedFact.summary} onChange={event => { setDraftFactId(selectedFact.factId); setSummaryDraft(event.target.value) }} className="w-full min-h-20 rounded border p-2 bg-transparent" style={{ borderColor: 'var(--color-border)' }} />
           <textarea value={draftFactId === selectedFact.factId ? payloadDraft : JSON.stringify(selectedFact.payload, null, 2)} onChange={event => { setDraftFactId(selectedFact.factId); setPayloadDraft(event.target.value) }} className="w-full min-h-28 rounded border p-2 mt-2 font-mono text-[11px] bg-transparent" style={{ borderColor: 'var(--color-border)' }} aria-label="payload JSON" />
            {selectedFact.entityType === 'character' && <div className="grid grid-cols-2 gap-2 mt-2 rounded border p-2" style={{ borderColor: 'var(--color-border)' }}><div className="col-span-2 font-medium">{text('人物卡字段', 'Character card fields')}</div>{(['role', 'status', 'location', 'condition', 'motivation'] as const).map(key => <label key={key} className="text-[11px]">{key}<input value={String((draftFactId === selectedFact.factId ? (() => { try { return JSON.parse(payloadDraft) as Record<string, unknown> } catch { return selectedFact.payload } })() : selectedFact.payload)[key] ?? '')} onChange={event => updatePayloadField(key, event.target.value)} className="w-full rounded border p-1 bg-transparent mt-1" style={{ borderColor: 'var(--color-border)' }} /></label>)}</div>}
            {selectedFact.entityType === 'timeline_event' && <div className="grid grid-cols-2 gap-2 mt-2 rounded border p-2" style={{ borderColor: 'var(--color-border)' }}><div className="col-span-2 font-medium">{text('事件 Ledger 字段', 'Event ledger fields')}</div><label className="text-[11px]">chapterNumber<input type="number" value={String((draftFactId === selectedFact.factId ? (() => { try { return JSON.parse(payloadDraft) as Record<string, unknown> } catch { return selectedFact.payload } })() : selectedFact.payload).chapterNumber ?? '')} onChange={event => updatePayloadField('chapterNumber', Number(event.target.value))} className="w-full rounded border p-1 bg-transparent mt-1" style={{ borderColor: 'var(--color-border)' }} /></label><label className="text-[11px]">date<input value={String((draftFactId === selectedFact.factId ? (() => { try { return JSON.parse(payloadDraft) as Record<string, unknown> } catch { return selectedFact.payload } })() : selectedFact.payload).date ?? '')} onChange={event => updatePayloadField('date', event.target.value)} className="w-full rounded border p-1 bg-transparent mt-1" style={{ borderColor: 'var(--color-border)' }} /></label></div>}
            {selectedFact.entityType === 'foreshadowing' && <label className="block text-[11px] mt-2">{text('伏笔回收状态', 'Recovery status')}<select value={String((draftFactId === selectedFact.factId ? (() => { try { return JSON.parse(payloadDraft) as Record<string, unknown> } catch { return selectedFact.payload } })() : selectedFact.payload).recoveryStatus ?? 'open')} onChange={event => updatePayloadField('recoveryStatus', event.target.value)} className="w-full rounded border p-1 bg-transparent mt-1" style={{ borderColor: 'var(--color-border)' }}><option value="open">open · 未推进</option><option value="planted">planted · 已埋设</option><option value="misdirected">misdirected · 已误导</option><option value="resolved">resolved · 已回收</option><option value="abandoned">abandoned · 废止</option></select></label>}
            <div className="flex gap-2 mt-2"><select value={draftFactId === selectedFact.factId ? statusDraft : selectedFact.status} onChange={event => { setDraftFactId(selectedFact.factId); setStatusDraft(event.target.value as 'confirmed' | 'candidate' | 'deprecated') }} className="rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }}><option value="confirmed">{text('已确认', 'Confirmed')}</option><option value="candidate">{text('候选', 'Candidate')}</option><option value="deprecated">{text('废止', 'Deprecated')}</option></select><input type="number" min="0" max="1" step="0.01" value={draftFactId === selectedFact.factId ? confidenceDraft : selectedFact.confidence} onChange={event => { setDraftFactId(selectedFact.factId); setConfidenceDraft(event.target.value) }} className="w-20 rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }} /><Button size="sm" onClick={() => void handleCommit()}>{text('提交新版本', 'Commit version')}</Button></div>
          </div>
          <div><div className="font-medium mb-1">{text('版本历史', 'Version history')}</div>{versions.map(version => <div key={version.versionId} className="border-l pl-2 mb-2" style={{ borderColor: 'var(--color-border)' }}>v{version.version} · {version.changedBy} · {version.createdAt}<div className="opacity-70">{version.summary}</div></div>)}</div>
          <div>
            <div className="font-medium mb-1">{text('受影响章节', 'Affected chapters')}</div>{impacts.length === 0 ? <div className="opacity-60">{text('暂无章节影响记录。', 'No chapter impacts recorded.')}</div> : <div className="flex flex-wrap gap-1">{impacts.map(impact => <button key={impact.impactId} onClick={() => void openImpactChapter(impact.chapterNumber)} className="px-2 py-1 rounded border hover:bg-accent/10" style={{ borderColor: 'var(--color-border)' }}>第{impact.chapterNumber}章 · {impact.impactType}</button>)}</div>}
            <div className="font-medium mt-3 mb-1">{text('资料关系', 'Fact relations')}</div>
            {relations.map(relation => <div key={relation.relationId} className="opacity-80 mb-1">{relation.fromFactId === selectedFact.factId ? '→' : '←'} {facts.find(fact => fact.factId === (relation.fromFactId === selectedFact.factId ? relation.toFactId : relation.fromFactId))?.canonicalName ?? '未知资料'} · {relation.relationType}</div>)}
            <div className="flex gap-1 mt-2"><select value={relationTarget} onChange={event => setRelationTarget(event.target.value)} className="min-w-0 flex-1 rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }}><option value="">{text('选择资料', 'Choose fact')}</option>{facts.filter(fact => fact.factId !== selectedFact.factId).map(fact => <option key={fact.factId} value={fact.factId}>{fact.canonicalName}</option>)}</select><input value={relationType} onChange={event => setRelationType(event.target.value)} className="w-20 rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }} /><Button size="sm" onClick={() => void handleAddRelation()} disabled={!relationTarget}>{text('关联', 'Link')}</Button></div>
          </div>
        </div>
      </section>}
    </div>
  )
}
