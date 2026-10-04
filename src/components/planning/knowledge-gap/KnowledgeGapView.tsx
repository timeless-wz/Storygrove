/**
 * 信息与揭露（信息差）主页（knowledge-action-outline-sync-contract §3）。
 *
 * 页面行为：信息列表 → 选中条目 → 真相与状态 → 人物/读者知情记录 → 来源与揭露安排。
 * 作者确定状态（已确认/待定/废止）与揭露状态独立；真相修改保留版本历史并提示
 * 已有知情记录可能需要检查，不批量改写人物认知。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenText, Eye, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { PlanningPageShell } from '../PlanningPageShell'
import { usePlanningBackPath } from '../planning-navigation'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { Textarea } from '../../ui/Textarea'
import { EmptyState as BaseEmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import {
  INFO_TRUTH_STATUS_LABEL,
  KNOWLEDGE_COGNITION_LABEL,
  KNOWLEDGE_TRUTH_RELATION_LABEL,
  type InfoEntry,
  type InfoTruthStatus,
  type InfoTruthVersion,
  type KnowledgeRecord,
} from '../../../shared/knowledge-gap'
import type { StoryTimelineSnapshot } from '../../../shared/story-timeline'
import type { KnowledgeCheckReport } from '../../../shared/knowledge-check'
import type { NarrativeThreadView } from '../../../shared/narrative-thread'
import {
  deleteInfoEntry,
  listInfoEntries,
  listKnowledgeCheckReports,
  listKnowledgeRecords,
  listThreadMarkerLinks,
  listTruthHistory,
  saveInfoEntry,
} from '../../../services/knowledge-gap-client'
import { ipc } from '../../../services/ipc-client'
import KnowledgeRecordEditor from './KnowledgeRecordEditor'

interface KnowledgeGapViewProps {
  projectKey: string
  /** 章节细纲/正文侧快捷入口预置的章节过滤。 */
  initialChapterFilter?: number
}

const STATUS_BADGE_COLOR: Record<InfoTruthStatus, string> = {
  confirmed: 'var(--color-success-text)',
  undecided: 'var(--color-warning-text)',
  retired: 'var(--color-text-secondary)',
}

function StatusBadge({ status, label }: { status: InfoTruthStatus; label: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color: STATUS_BADGE_COLOR[status], backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)' }}
    >
      {label}
    </span>
  )
}

export default function KnowledgeGapView({ projectKey, initialChapterFilter }: KnowledgeGapViewProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const characterIdentities = useCharacterStore(s => s.characterIdentities)
  const addLog = useWorkflowStore(s => s.addLog)

  const [entries, setEntries] = useState<InfoEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [records, setRecords] = useState<KnowledgeRecord[]>([])
  const [history, setHistory] = useState<InfoTruthVersion[]>([])
  const [reports, setReports] = useState<KnowledgeCheckReport[]>([])
  const [threadPlans, setThreadPlans] = useState<NarrativeThreadView[]>([])
  const [threadLinks, setThreadLinks] = useState<Map<number, number>>(new Map())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<InfoTruthStatus | ''>('')
  const [chapterFilter, setChapterFilter] = useState(initialChapterFilter !== undefined ? String(initialChapterFilter) : '')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [recordEditorOpen, setRecordEditorOpen] = useState<'character' | 'reader' | null>(null)
  const [editingRecord, setEditingRecord] = useState<KnowledgeRecord | null>(null)
  const [timeline, setTimeline] = useState<StoryTimelineSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  // 新建/编辑条目的本地表单（前端仅表单草稿；正式数据存 SQLite）。
  const [formTitle, setFormTitle] = useState('')
  const [formSummary, setFormSummary] = useState('')
  const [formTruth, setFormTruth] = useState('')
  const [formStatus, setFormStatus] = useState<InfoTruthStatus>('undecided')
  const [formChapterRef, setFormChapterRef] = useState('')
  const [formNoteRef, setFormNoteRef] = useState('')
  const [formPlanIds, setFormPlanIds] = useState<string>('')
  const [showHistory, setShowHistory] = useState(false)

  const selectedEntry = useMemo(
    () => entries.find(entry => entry.id === selectedId) ?? null,
    [entries, selectedId],
  )

  const characterOptions = useMemo(() => (
    characters.map(character => ({
      id: characterIdentities[character.name] ?? '',
      name: character.name,
    })).filter(option => option.id)
  ), [characterIdentities, characters])

  const characterNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const [name, id] of Object.entries(characterIdentities)) map.set(id, name)
    for (const character of characters) {
      const id = characterIdentities[character.name]
      if (id) map.set(id, character.name)
    }
    return map
  }, [characterIdentities, characters])

  const loadAll = useCallback(async (keepSelection: boolean) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectKey) return
    setLoading(true)
    try {
      const [entryList, reportList, planList] = await Promise.all([
        listInfoEntries(projectSession),
        listKnowledgeCheckReports(projectSession, { kind: 'info-gap' }),
        ipc.invokeWithProjectSession(projectSession, 'db:narrative-thread-list', projectSession.projectPath) as Promise<NarrativeThreadView[]>,
      ])
      if (!isProjectSessionCurrent(projectSession)) return
      setEntries(entryList)
      setReports(reportList)
      setThreadPlans(planList)
      const links = await listThreadMarkerLinks(projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      const perPlan = new Map<number, number>()
      for (const link of links) perPlan.set(link.threadPlanId, (perPlan.get(link.threadPlanId) ?? 0) + 1)
      setThreadLinks(perPlan)
      setSelectedId(previous => (keepSelection && previous && entryList.some(entry => entry.id === previous) ? previous : entryList[0]?.id ?? null))
    } catch (error) {
      addLog('error', text(`信息条目加载失败：${String(error)}`, `Could not load info entries: ${String(error)}`))
    } finally {
      setLoading(false)
    }
  }, [addLog, currentProject, projectKey, text])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAll(true) }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAll])

  // 时间线事件（故事位置选择器数据源）。
  useEffect(() => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || projectSession.projectPath !== projectKey) return
    void ipc.invokeWithProjectSession(projectSession, 'db:timeline-get-all', projectSession.projectPath)
      .then(snapshot => { if (isProjectSessionCurrent(projectSession)) setTimeline(snapshot as StoryTimelineSnapshot) })
      .catch(() => setTimeline(null))
  }, [currentProject, projectKey])

  // 选中条目 → 加载知情记录 + 真相历史。
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const projectSession = captureProjectSession(currentProject)
        if (!projectSession || !selectedEntry) {
          if (!cancelled) { setRecords([]); setHistory([]) }
          return
        }
        try {
          const [recordList, historyList] = await Promise.all([
            listKnowledgeRecords(projectSession, { infoId: selectedEntry.id }),
            listTruthHistory(projectSession, selectedEntry.id),
          ])
          if (!cancelled && isProjectSessionCurrent(projectSession)) {
            setRecords(recordList)
            setHistory(historyList)
          }
        } catch {
          if (!cancelled) { setRecords([]); setHistory([]) }
        }
      })()
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [currentProject, selectedEntry])

  // 检查工作流完成 → 刷新报告。
  useEffect(() => globalEventBus.on('WORKFLOW_COMPLETE', payload => {
    if (payload.projectPath === projectKey) void loadAll(true)
  }), [loadAll, projectKey])

  const filteredEntries = useMemo(() => {
    let list = entries
    if (statusFilter) list = list.filter(entry => entry.truthStatus === statusFilter)
    if (chapterFilter.trim()) {
      const chapter = Number.parseInt(chapterFilter, 10)
      if (Number.isSafeInteger(chapter)) {
        list = list.filter(entry => entry.sourceRefs.some(ref => ref.kind === 'chapter' && ref.chapterNumber === chapter))
      }
    }
    if (query.trim()) {
      const needle = query.trim().toLowerCase()
      list = list.filter(entry => (
        entry.title.toLowerCase().includes(needle)
        || entry.summary.toLowerCase().includes(needle)
        || entry.truth.toLowerCase().includes(needle)
      ))
    }
    return list
  }, [chapterFilter, entries, query, statusFilter])

  const resetForm = useCallback((entry: InfoEntry | null) => {
    setFormTitle(entry?.title ?? '')
    setFormSummary(entry?.summary ?? '')
    setFormTruth(entry?.truth ?? '')
    setFormStatus(entry?.truthStatus ?? 'undecided')
    setFormChapterRef('')
    setFormNoteRef('')
    setFormPlanIds(entry?.relatedThreadPlanIds.join('、') ?? '')
  }, [])

  const handleCreateEntry = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    try {
      const result = await saveInfoEntry(projectSession, {
        title: formTitle.trim() || text('未命名信息', 'Untitled info'),
        summary: formSummary,
        truth: formTruth,
        truthStatus: formStatus,
        sourceRefs: [
          ...(Number.parseInt(formChapterRef, 10) > 0 ? [{ kind: 'chapter' as const, chapterNumber: Number.parseInt(formChapterRef, 10) }] : []),
          ...(formNoteRef.trim() ? [{ kind: 'note' as const, text: formNoteRef.trim() }] : []),
        ],
        relatedThreadPlanIds: formPlanIds.split(/[、,，]/).map(part => Number.parseInt(part.trim(), 10)).filter(value => Number.isSafeInteger(value) && value > 0),
      })
      if (!isProjectSessionCurrent(projectSession)) return
      setCreating(false)
      resetForm(null)
      await loadAll(true)
      setSelectedId(result.id)
      toast.success(text('信息条目已创建', 'Info entry created'))
    } catch (error) {
      toast.error(text(`创建失败：${String(error)}`, `Could not create: ${String(error)}`))
    }
  }

  const handleUpdateEntry = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !selectedEntry) return
    try {
      const result = await saveInfoEntry(projectSession, {
        id: selectedEntry.id,
        baseRevision: selectedEntry.revision,
        title: formTitle.trim() || selectedEntry.title,
        summary: formSummary,
        truth: formTruth,
        truthStatus: formStatus,
        sourceRefs: [
          ...selectedEntry.sourceRefs,
          ...(Number.parseInt(formChapterRef, 10) > 0 ? [{ kind: 'chapter' as const, chapterNumber: Number.parseInt(formChapterRef, 10) }] : []),
          ...(formNoteRef.trim() ? [{ kind: 'note' as const, text: formNoteRef.trim() }] : []),
        ],
        relatedThreadPlanIds: formPlanIds.split(/[、,，]/).map(part => Number.parseInt(part.trim(), 10)).filter(value => Number.isSafeInteger(value) && value > 0),
        truthChangeNote: '',
      })
      if (!isProjectSessionCurrent(projectSession)) return
      setEditing(false)
      await loadAll(true)
      if (result.knowledgeRecordsAffected > 0 && (formTruth !== selectedEntry.truth || formStatus !== selectedEntry.truthStatus)) {
        toast.info(text(
          `真相已更新。该条目下有 ${result.knowledgeRecordsAffected} 条知情记录，可能需要检查。`,
          `Truth updated. ${result.knowledgeRecordsAffected} knowledge record(s) under this entry may need review.`,
        ))
      } else {
        toast.success(text('信息条目已保存', 'Info entry saved'))
      }
    } catch (error) {
      toast.error(text(`保存失败：${String(error)}`, `Could not save: ${String(error)}`))
    }
  }

  const handleDeleteEntry = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !selectedEntry) return
    const recordCount = records.length
    const ok = await confirm(text(
      `删除信息条目「${selectedEntry.title}」？其下 ${recordCount} 条知情记录与真相历史将一并删除；人物、时间线与正文不受影响。`,
      `Delete info entry “${selectedEntry.title}”? Its ${recordCount} knowledge record(s) and truth history are removed too; characters, timeline and prose are unaffected.`,
    ), { title: text('删除信息条目', 'Delete info entry'), confirmText: text('删除', 'Delete'), danger: true })
    if (!ok) return
    try {
      await deleteInfoEntry(projectSession, selectedEntry.id)
      if (!isProjectSessionCurrent(projectSession)) return
      setSelectedId(null)
      await loadAll(false)
    } catch (error) {
      toast.error(text(`删除失败：${String(error)}`, `Could not delete: ${String(error)}`))
    }
  }

  const runInfoGapCheck = () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    void (async () => {
      try {
        const { createInfoGapCheckWorkflow } = await import('../../../services/workflows/knowledge-workflows')
        const workflow = createInfoGapCheckWorkflow({
          projectSession,
          scope: { kind: 'project' },
        })
        await useWorkflowStore.getState().startWorkflow(workflow)
      } catch (error) {
        addLog('error', text(`信息差检查启动失败：${String(error)}`, `Could not start the info-gap check: ${String(error)}`))
      }
    })()
  }

  const backPath = usePlanningBackPath()
  const breadcrumbs = useMemo(() => [
    { label: backPath.overviewLabel, onClick: backPath.openOverview },
    { label: backPath.planLabel, onClick: backPath.revealWritingPlan },
    { label: text('信息与揭露', 'Info & Revelation') },
  ], [backPath, text])

  const characterRecords = records.filter(record => record.subjectKind === 'character')
  const readerRecords = records.filter(record => record.subjectKind === 'reader')

  return (
    <PlanningPageShell
      breadcrumb={breadcrumbs}
      icon={<BookOpenText size={16} />}
      title={text('信息与揭露', 'Info & Revelation')}
      description={text(
        '区分实际真相、作者尚未确定的部分、人物知道/误解/隐瞒的内容，以及读者已看到的信息与揭露时机',
        'Separate the actual truth, undecided parts, what characters know/misconstrue/conceal, and what readers have seen',
      )}
      meta={<span className="text-xs text-[var(--color-text-secondary)]">{text(`${entries.length} 条信息`, `${entries.length} entries`)}</span>}
      actions={(
        <>
          <Button
            variant="outline"
            size="sm"
            title={text('AI 只提出建议级疑点，不改写任何记录', 'AI suggestions only; no records are modified')}
            onClick={runInfoGapCheck}
            data-testid="info-gap-check-run"
          >
            {text('信息差检查', 'Info-gap check')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { void loadAll(true) }}>
            <RefreshCw size={12} /> {text('刷新', 'Refresh')}
          </Button>
          <Button
            variant="default"
            size="sm"
            data-testid="info-entry-create"
            onClick={() => { setEditing(false); setCreating(!creating); resetForm(null) }}
          >
            <Plus size={12} /> {text('新建信息条目', 'New info entry')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col xl:flex-row gap-3 flex-1 min-h-0">
        {/* 左列：信息列表 */}
        <div className="xl:w-72 flex flex-col gap-2 min-h-0 flex-shrink-0">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={text('搜索名称/说明/真相', 'Search title / summary / truth')}
            className="h-8 text-xs"
            data-testid="info-entry-search"
          />
          <div className="flex gap-2">
            <NativeSelect value={statusFilter} onChange={e => setStatusFilter(e.target.value as InfoTruthStatus | '')} className="h-8 text-xs flex-1">
              <option value="">{text('全部状态', 'All statuses')}</option>
              {(Object.keys(INFO_TRUTH_STATUS_LABEL) as InfoTruthStatus[]).map(status => (
                <option key={status} value={status}>{text(INFO_TRUTH_STATUS_LABEL[status].zh, INFO_TRUTH_STATUS_LABEL[status].en)}</option>
              ))}
            </NativeSelect>
            <Input
              value={chapterFilter}
              onChange={e => setChapterFilter(e.target.value)}
              placeholder={text('章号', 'chapter')}
              className="h-8 text-xs w-20"
              title={text('按来源章节过滤', 'Filter by source chapter')}
            />
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-24" data-testid="info-entry-list">
            {filteredEntries.length === 0 && !loading && (
              <div className="text-xs text-[var(--color-text-secondary)] px-1 py-4">
                {text('暂无信息条目', 'No info entries')}
              </div>
            )}
            {filteredEntries.map(entry => (
              <button
                key={entry.id}
                type="button"
                onClick={() => { setSelectedId(entry.id); setEditing(false); setCreating(false); setShowHistory(false) }}
                className={`text-left rounded-md border px-2.5 py-2 text-xs transition-colors ${entry.id === selectedId ? 'ring-1' : ''}`}
                style={{
                  borderColor: entry.id === selectedId ? 'var(--color-accent)' : 'var(--color-border)',
                  backgroundColor: entry.id === selectedId ? 'var(--color-accent)' : 'transparent',
                  opacity: entry.id === selectedId ? 0.08 : 1,
                }}
                data-testid={`info-entry-${entry.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate text-[var(--color-text)]">{entry.title}</span>
                  <div className="flex-1" />
                  <StatusBadge status={entry.truthStatus} label={text(INFO_TRUTH_STATUS_LABEL[entry.truthStatus].zh, INFO_TRUTH_STATUS_LABEL[entry.truthStatus].en)} />
                </div>
                {entry.summary && (
                  <div className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 mt-0.5">{entry.summary}</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 右列：详情 */}
        <div className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-3">
          {creating && (
            <div className="rounded-md border p-3 flex flex-col gap-2 text-xs" style={{ borderColor: 'var(--color-border)' }}>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder={text('名称', 'Title')} className="h-8 text-xs" data-testid="info-entry-title" />
              <Input value={formSummary} onChange={e => setFormSummary(e.target.value)} placeholder={text('主题说明', 'Summary')} className="h-8 text-xs" />
              <Textarea value={formTruth} onChange={e => setFormTruth(e.target.value)} rows={3} placeholder={text('实际真相（未决定时留空，不虚构）', 'Actual truth (leave empty if undecided; do not invent)')} className="text-xs" data-testid="info-entry-truth" />
              <div className="flex flex-wrap gap-2 items-center">
                <NativeSelect value={formStatus} onChange={e => setFormStatus(e.target.value as InfoTruthStatus)} className="h-8 text-xs" data-testid="info-entry-status">
                  {(Object.keys(INFO_TRUTH_STATUS_LABEL) as InfoTruthStatus[]).map(status => (
                    <option key={status} value={status}>{text(INFO_TRUTH_STATUS_LABEL[status].zh, INFO_TRUTH_STATUS_LABEL[status].en)}</option>
                  ))}
                </NativeSelect>
                <Input value={formChapterRef} onChange={e => setFormChapterRef(e.target.value)} placeholder={text('来源章号（可选）', 'Source chapter (optional)')} className="h-8 text-xs w-36" />
                <Input value={formNoteRef} onChange={e => setFormNoteRef(e.target.value)} placeholder={text('来源说明（可选）', 'Source note (optional)')} className="h-8 text-xs w-44" />
                <Input value={formPlanIds} onChange={e => setFormPlanIds(e.target.value)} placeholder={text('关联脉络计划 ID（顿号分隔，可选）', 'Related thread plan IDs (optional)')} className="h-8 text-xs w-56" />
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>{text('取消', 'Cancel')}</Button>
                <Button variant="outline" size="sm" data-testid="info-entry-create-save" onClick={() => { void handleCreateEntry() }}>{text('创建', 'Create')}</Button>
              </div>
            </div>
          )}

          {!selectedEntry && !creating && (
            <BaseEmptyState
              icon={<BookOpenText size={32} />}
              message={text('选择或创建一个信息条目，维护谁在何时知道什么', 'Select or create an info entry to track who knows what and when')}
              opacity={0.35}
            />
          )}

          {selectedEntry && !creating && (
            <>
              {/* 真相与状态 */}
              <section className="rounded-md border text-xs" style={{ borderColor: 'var(--color-border)' }} data-testid="info-entry-detail">
                <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <BookOpenText size={13} className="text-[var(--color-accent)]" />
                  <span className="font-semibold text-[var(--color-text)]">{selectedEntry.title}</span>
                  <StatusBadge status={selectedEntry.truthStatus} label={text(INFO_TRUTH_STATUS_LABEL[selectedEntry.truthStatus].zh, INFO_TRUTH_STATUS_LABEL[selectedEntry.truthStatus].en)} />
                  <div className="flex-1" />
                  {!editing && (
                    <Button variant="ghost" size="sm" onClick={() => { resetForm(selectedEntry); setEditing(true) }}>{text('编辑', 'Edit')}</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>{text('真相历史', 'Truth history')}</Button>
                  <Button variant="ghost" size="sm" className="text-[var(--color-destructive)]" onClick={() => { void handleDeleteEntry() }}>
                    <Trash2 size={12} /> {text('删除', 'Delete')}
                  </Button>
                </div>
                <div className="p-3 flex flex-col gap-2">
                  {selectedEntry.summary && (
                    <div className="text-[var(--color-text-secondary)]">{selectedEntry.summary}</div>
                  )}
                  {!editing ? (
                    <>
                      <div className="whitespace-pre-wrap leading-5 text-[var(--color-text)]" data-testid="info-entry-truth-view">
                        {selectedEntry.truth.trim() || text('（作者尚未确定真相——不要虚构）', '(The author has not decided the truth — do not invent it)')}
                      </div>
                      {selectedEntry.sourceRefs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedEntry.sourceRefs.map((ref, index) => (
                            <span key={index} className="rounded px-1.5 py-0.5 text-[10px] border" style={{ borderColor: 'var(--color-border)' }}>
                              {ref.kind === 'chapter' ? text(`第 ${ref.chapterNumber} 章`, `Chapter ${ref.chapterNumber}`)
                                : ref.kind === 'character' ? text(`人物 ${characterNameById.get(ref.characterId) ?? ref.characterId}`, `Character ${characterNameById.get(ref.characterId) ?? ref.characterId}`)
                                  : ref.kind === 'document' ? text(`文档 ${ref.documentId}`, `Document ${ref.documentId}`)
                                    : ref.text}
                            </span>
                          ))}
                        </div>
                      )}
                      {selectedEntry.relatedThreadPlanIds.length > 0 && (
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          {text('关联长线计划：', 'Related thread plans: ')}
                          {selectedEntry.relatedThreadPlanIds.map(planId => {
                            const plan = threadPlans.find(candidate => candidate.id === planId)
                            return (
                              <span key={planId} className="mr-2">
                                {plan ? `#${planId} ${plan.title}` : `#${planId}`}
                                {threadLinks.get(planId) ? text(`（${threadLinks.get(planId)} 个伏笔证据）`, ` (${threadLinks.get(planId)} marker links)`) : ''}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder={text('名称', 'Title')} className="h-8 text-xs" />
                      <Input value={formSummary} onChange={e => setFormSummary(e.target.value)} placeholder={text('主题说明', 'Summary')} className="h-8 text-xs" />
                      <Textarea value={formTruth} onChange={e => setFormTruth(e.target.value)} rows={3} className="text-xs" placeholder={text('实际真相', 'Actual truth')} />
                      <div className="flex flex-wrap gap-2 items-center">
                        <NativeSelect value={formStatus} onChange={e => setFormStatus(e.target.value as InfoTruthStatus)} className="h-8 text-xs">
                          {(Object.keys(INFO_TRUTH_STATUS_LABEL) as InfoTruthStatus[]).map(status => (
                            <option key={status} value={status}>{text(INFO_TRUTH_STATUS_LABEL[status].zh, INFO_TRUTH_STATUS_LABEL[status].en)}</option>
                          ))}
                        </NativeSelect>
                        <Input value={formChapterRef} onChange={e => setFormChapterRef(e.target.value)} placeholder={text('补充来源章号', 'Add source chapter')} className="h-8 text-xs w-36" />
                        <Input value={formNoteRef} onChange={e => setFormNoteRef(e.target.value)} placeholder={text('补充来源说明', 'Add source note')} className="h-8 text-xs w-44" />
                        <Input value={formPlanIds} onChange={e => setFormPlanIds(e.target.value)} placeholder={text('关联脉络计划 ID', 'Related thread plan IDs')} className="h-8 text-xs w-56" />
                        <div className="flex-1" />
                        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{text('取消', 'Cancel')}</Button>
                        <Button variant="outline" size="sm" data-testid="info-entry-update-save" onClick={() => { void handleUpdateEntry() }}>{text('保存', 'Save')}</Button>
                      </div>
                    </div>
                  )}
                </div>
                {showHistory && (
                  <div className="px-3 pb-3 flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
                    {history.length === 0 && <div className="text-[11px] text-[var(--color-text-secondary)]">{text('暂无历史', 'No history')}</div>}
                    {history.map(version => (
                      <div key={`${version.revision}-${version.createdAt}`} className="text-[11px] text-[var(--color-text-secondary)] flex gap-2">
                        <span className="flex-shrink-0">r{version.revision}</span>
                        <span className="min-w-0 whitespace-pre-wrap">{version.truth.trim() || text('（空）', '(empty)')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 知情记录 */}
              <section className="rounded-md border text-xs" style={{ borderColor: 'var(--color-border)' }} data-testid="knowledge-records">
                <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                  <Users size={13} className="text-[var(--color-accent)]" />
                  <span className="font-semibold">{text('人物知情记录', 'Character knowledge')}</span>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="knowledge-record-add-character"
                    onClick={() => { setEditingRecord(null); setRecordEditorOpen(recordEditorOpen === 'character' ? null : 'character') }}
                  >
                    <Plus size={12} /> {text('添加人物记录', 'Add character record')}
                  </Button>
                </div>
                <div className="p-2 flex flex-col gap-1.5">
                  {recordEditorOpen === 'character' && (
                    <KnowledgeRecordEditor
                      projectSession={captureProjectSession(currentProject)!}
                      entry={selectedEntry}
                      record={editingRecord}
                      characterOptions={characterOptions}
                      timeline={timeline}
                      onSaved={() => { setRecordEditorOpen(null); setEditingRecord(null); void loadAll(true) }}
                      onCancel={() => { setRecordEditorOpen(null); setEditingRecord(null) }}
                    />
                  )}
                  {characterRecords.length === 0 && recordEditorOpen !== 'character' && (
                    <div className="text-[11px] text-[var(--color-text-secondary)] px-1 py-1">{text('暂无人物记录', 'No character records')}</div>
                  )}
                  {characterRecords.map(record => {
                    const name = record.characterId ? characterNameById.get(record.characterId) : undefined
                    const dangling = record.characterId && !name
                    return (
                      <button
                        key={record.id}
                        type="button"
                        className="text-left rounded border px-2 py-1.5 hover:opacity-80"
                        style={{ borderColor: 'var(--color-border)' }}
                        onClick={() => { setEditingRecord(record); setRecordEditorOpen('character') }}
                        data-testid={`knowledge-record-${record.id}`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{dangling
                            ? text(`（引用的人物已删除/失效 ${record.characterId?.slice(0, 8)}…）`, `(Referenced character missing ${record.characterId?.slice(0, 8)}…)`)
                            : name}</span>
                          <span className="text-[10px] rounded px-1 py-0.5 border" style={{ borderColor: 'var(--color-border)' }}>
                            {text(KNOWLEDGE_COGNITION_LABEL[record.cognition].zh, KNOWLEDGE_COGNITION_LABEL[record.cognition].en)}
                          </span>
                          <span className="text-[10px] rounded px-1 py-0.5 border" style={{ borderColor: 'var(--color-border)' }}>
                            {text(KNOWLEDGE_TRUTH_RELATION_LABEL[record.truthRelation].zh, KNOWLEDGE_TRUTH_RELATION_LABEL[record.truthRelation].en)}
                          </span>
                          {record.concealment && (
                            <span className="text-[10px] rounded px-1 py-0.5" style={{ color: 'var(--color-warning-text)' }}>{text('隐瞒', 'Concealing')}</span>
                          )}
                          <span className="text-[10px] text-[var(--color-text-secondary)]">
                            {record.narrativePosition.kind === 'chapter-scene'
                              ? text(`第${record.narrativePosition.chapterNumber}章${record.narrativePosition.authorOrdinal !== undefined ? `·序${record.narrativePosition.authorOrdinal}` : ''}`, `Ch${record.narrativePosition.chapterNumber}${record.narrativePosition.authorOrdinal !== undefined ? `#${record.narrativePosition.authorOrdinal}` : ''}`)
                              : text('叙事位置未知', 'Narrative position unknown')}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-secondary)]">
                            {record.basis === 'prose' ? text('正文依据', 'Prose') : text('计划', 'Plan')}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 mt-0.5">{record.knownContent}</div>
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                  <Eye size={13} className="text-[var(--color-accent)]" />
                  <span className="font-semibold">{text('读者记录（作者预期）', 'Reader records (author expectation)')}</span>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEditingRecord(null); setRecordEditorOpen(recordEditorOpen === 'reader' ? null : 'reader') }}
                  >
                    <Plus size={12} /> {text('添加读者记录', 'Add reader record')}
                  </Button>
                </div>
                <div className="p-2 flex flex-col gap-1.5">
                  {recordEditorOpen === 'reader' && (
                    <KnowledgeRecordEditor
                      projectSession={captureProjectSession(currentProject)!}
                      entry={selectedEntry}
                      record={editingRecord}
                      characterOptions={[]}
                      timeline={timeline}
                      onSaved={() => { setRecordEditorOpen(null); setEditingRecord(null); void loadAll(true) }}
                      onCancel={() => { setRecordEditorOpen(null); setEditingRecord(null) }}
                    />
                  )}
                  {readerRecords.length === 0 && recordEditorOpen !== 'reader' && (
                    <div className="text-[11px] text-[var(--color-text-secondary)] px-1 py-1">{text('暂无读者记录', 'No reader records')}</div>
                  )}
                  {readerRecords.map(record => (
                    <button
                      key={record.id}
                      type="button"
                      className="text-left rounded border px-2 py-1.5 hover:opacity-80"
                      style={{ borderColor: 'var(--color-border)' }}
                      onClick={() => { setEditingRecord(record); setRecordEditorOpen('reader') }}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-[var(--color-text-secondary)]">
                          {record.narrativePosition.kind === 'chapter-scene'
                            ? text(`揭露位置：第${record.narrativePosition.chapterNumber}章`, `Reveal at Ch${record.narrativePosition.chapterNumber}`)
                            : text('揭露位置未知', 'Reveal position unknown')}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 mt-0.5">{record.reader?.shownEvidence}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* 检查报告 */}
              <section className="rounded-md border text-xs" style={{ borderColor: 'var(--color-border)' }} data-testid="info-gap-reports">
                <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="font-semibold">{text('信息差检查报告（建议级）', 'Info-gap check reports (suggestions)')}</span>
                </div>
                <div className="p-2 flex flex-col gap-2">
                  {reports.length === 0 && (
                    <div className="text-[11px] text-[var(--color-text-secondary)] px-1">{text('暂无报告；点击右上角「信息差检查」运行', 'No reports yet; run the info-gap check from the toolbar')}</div>
                  )}
                  {reports.map(report => (
                    <div key={report.id} className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[var(--color-text-secondary)]">{new Date(report.createdAt).toLocaleString()}</span>
                        <span className="text-[11px]">{text(`${report.findings.length} 条建议`, `${report.findings.length} suggestion(s)`)}</span>
                        <div className="flex-1" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const projectSession = captureProjectSession(currentProject)
                            if (!projectSession) return
                            void import('../../../services/knowledge-gap-client').then(module => module.deleteKnowledgeCheckReport(projectSession, report.id))
                              .then(() => loadAll(true))
                          }}
                        >
                          <Trash2 size={11} />
                        </Button>
                      </div>
                      {report.findings.map(finding => (
                        <div key={finding.id} className="mt-1 rounded px-1.5 py-1" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
                          <div className="font-medium">{finding.title}</div>
                          <div className="text-[11px] text-[var(--color-text-secondary)] whitespace-pre-wrap">{finding.detail}</div>
                          {finding.citations.length > 0 && (
                            <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                              {text('引用：', 'Citations: ')}
                              {finding.citations.map((citation, index) => (
                                <span key={index} className="mr-1.5">
                                  {citation.kind === 'chapter' ? `第${citation.chapterNumber}章`
                                    : citation.kind === 'draft' ? `草稿${citation.draftId}`
                                      : citation.kind === 'thread-plan' ? `脉络#${citation.id}`
                                        : String('id' in citation ? citation.id : '')}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </PlanningPageShell>
  )
}
