import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  Database,
  FileWarning,
  Filter,
  GitBranch,
  History,
  Layers,
  Link2,
  Network,
  Search,
  ShieldQuestion,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { useLocaleStore } from '../../stores/locale-store'
import { useStoryDataStore } from '../../stores/story-data-store'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import type {
  StoryEntityType,
  StoryFact,
  StoryFactCandidate,
  StoryRecordStatus,
} from '../../shared/story-domain'
import {
  STORY_ENTITY_GROUPS,
  STORY_ENTITY_LABELS,
  STORY_RECORD_STATUS_LABELS,
  checkFactSourceSnapshot,
  entityLabel,
  findEntityGroup,
  matchesStoryQuery,
  needsSnapshotReview,
  payloadFieldsFor,
  payloadGroupLabelFor,
  splitFactsByStatus,
  type BilingualLabel,
  type FactSourceSnapshotCheck,
} from './story-data-taxonomy'
import {
  SourceSnapshotBadge,
  StoryAuthorityBoundaryNote,
  StoryEmptyState,
  StoryRecordStatusChip,
  StoryReviewStatusChip,
} from './story-data-boundary'

const STATUS_FILTERS: Array<StoryRecordStatus | 'all'> = ['all', 'confirmed', 'candidate', 'deprecated']

type CategoryKey =
  | 'all'
  | `group:${string}`
  | 'status:confirmed'
  | 'status:candidate'
  | 'status:deprecated'
  | 'source:review'

type ViewMode = 'overview' | 'characters' | 'timeline' | 'graph' | 'foreshadowing'

const VIEW_MODES: readonly [ViewMode, BilingualLabel][] = [
  ['overview', { zh: '资料总览', en: 'overview' }],
  ['characters', { zh: '人物卡', en: 'characters' }],
  ['timeline', { zh: '时间轴', en: 'timeline' }],
  ['graph', { zh: '关系图', en: 'graph' }],
  ['foreshadowing', { zh: '伏笔回收', en: 'foreshadowing' }],
]

const VIEW_ICONS: Record<ViewMode, typeof Database> = {
  overview: Database,
  characters: UserRound,
  timeline: CalendarClock,
  graph: Network,
  foreshadowing: Sparkles,
}

/** 候选资料的权威状态恒为候选；用它参与统一的状态筛选。 */
const CANDIDATE_AUTHORITY_STATUS: StoryRecordStatus = 'candidate'

function Provenance({ item, onOpenSource }: { item: StoryFact | StoryFactCandidate; onOpenSource?: () => void }) {
  const text = useLocaleStore(s => s.text)
  return (
    <div className="text-[11px] space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono truncate" title={item.provenance.sourceFile}>{item.provenance.sourceFile}</span>
      </div>
      <div>
        {item.provenance.sourceHeadingPath} · {text(`第 ${item.provenance.startLine}-${item.provenance.endLine} 行`, `lines ${item.provenance.startLine}-${item.provenance.endLine}`)}
      </div>
      <div className="font-mono truncate" title={item.provenance.contentHash}>hash: {item.provenance.contentHash}</div>
      {onOpenSource && (
        <button className="text-accent hover:underline inline-flex items-center gap-1" onClick={onOpenSource}>
          <Link2 size={11} />
          {text('查看来源片段', 'Open source fragment')}
        </button>
      )}
    </div>
  )
}

function StatTile({
  testId,
  label,
  value,
  hint,
  accent,
  active,
  onClick,
}: {
  testId: string
  label: string
  value: number
  hint: string
  accent: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="text-left rounded-lg border px-3 py-2 transition-colors"
      style={{
        borderColor: active ? accent : 'var(--color-border)',
        backgroundColor: active ? `color-mix(in srgb, ${accent} 12%, transparent)` : 'var(--color-surface)',
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums" style={{ color: active ? accent : 'var(--color-text)' }}>
          {value}
        </span>
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>{label}</span>
      </div>
      <div className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-muted)' }}>{hint}</div>
    </button>
  )
}

function CategoryRail({
  categoryKey,
  onSelect,
  counts,
  text,
}: {
  categoryKey: CategoryKey
  onSelect: (key: CategoryKey) => void
  counts: {
    all: number
    groups: Record<string, number>
    confirmed: number
    candidate: number
    deprecated: number
    snapshotReview: number
  }
  text: (zhCN: string, enUS: string) => string
}) {
  const entry = (
    key: CategoryKey,
    label: BilingualLabel,
    count: number,
    icon?: React.ReactNode,
  ) => {
    const active = categoryKey === key
    return (
      <li key={key}>
        <button
          onClick={() => onSelect(key)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[11px] transition-colors"
          style={{
            backgroundColor: active ? 'var(--color-accent-subtle)' : 'transparent',
            color: active ? 'var(--color-accent)' : 'var(--color-text)',
            fontWeight: active ? 600 : 400,
          }}
        >
          {icon}
          <span className="truncate flex-1">{text(label.zh, label.en)}</span>
          <span className="tabular-nums opacity-70">{count}</span>
        </button>
      </li>
    )
  }

  const section = (label: BilingualLabel) => (
    <li className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
      {text(label.zh, label.en)}
    </li>
  )

  return (
    <nav aria-label={text('资料分类导航', 'Story data categories')} className="text-xs">
      <ul className="space-y-0.5">
        {entry('all', { zh: '全部资料', en: 'All records' }, counts.all)}
        {section({ zh: '分类档案（正式 + 候选）', en: 'Categories (facts + candidates)' })}
        {STORY_ENTITY_GROUPS.map(group => entry(`group:${group.id}`, group.label, counts.groups[group.id] ?? 0))}
        {section({ zh: '权威状态', en: 'Authority status' })}
        {entry('status:confirmed', STORY_RECORD_STATUS_LABELS.confirmed, counts.confirmed, <Check size={12} />)}
        {entry('status:candidate', STORY_RECORD_STATUS_LABELS.candidate, counts.candidate, <ShieldQuestion size={12} />)}
        {entry('status:deprecated', STORY_RECORD_STATUS_LABELS.deprecated, counts.deprecated, <Ban size={12} />)}
        {section({ zh: '来源', en: 'Provenance' })}
        {entry('source:review', { zh: '来源快照待复核', en: 'Snapshot needs review' }, counts.snapshotReview, <FileWarning size={12} />)}
      </ul>
    </nav>
  )
}

export default function StoryDataCenter() {
  const text = useLocaleStore(s => s.text)
  const selectSource = useWorkspaceHubStore(s => s.selectSource)
  const setWorkspaceTab = useWorkspaceHubStore(s => s.setActiveTab)
  const setTargetChapterNumber = useWorkspaceHubStore(s => s.setTargetChapterNumber)
  const assembleChapterContext = useWorkspaceHubStore(s => s.assembleChapterContext)
  const sources = useWorkspaceHubStore(s => s.sources)
  const { candidates, facts, selectedFactId, versions, impacts, relations, allRelations, loading, error, load, selectFact, approve, reject, commit, addRelation } = useStoryDataStore()
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [payloadDraft, setPayloadDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState<StoryRecordStatus>('confirmed')
  const [confidenceDraft, setConfidenceDraft] = useState('')
  const [draftFactId, setDraftFactId] = useState<string | null>(null)
  const [relationTarget, setRelationTarget] = useState('')
  const [relationType, setRelationType] = useState('关联')
  const [entityFilter, setEntityFilter] = useState<StoryEntityType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StoryRecordStatus | 'all'>('all')
  const [categoryKey, setCategoryKey] = useState<CategoryKey>('all')
  const [query, setQuery] = useState('')
  const [deprecatedOpen, setDeprecatedOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('overview')

  const selectedFact = useMemo(() => facts.find(fact => fact.factId === selectedFactId) ?? null, [facts, selectedFactId])
  const statusBuckets = useMemo(() => splitFactsByStatus(facts), [facts])
  const activeGroup = useMemo(
    () => (categoryKey.startsWith('group:') ? findEntityGroup(categoryKey.slice('group:'.length)) : null),
    [categoryKey],
  )

  const snapshotChecks = useMemo(() => {
    const checks = new Map<string, FactSourceSnapshotCheck>()
    for (const fact of facts) checks.set(fact.factId, checkFactSourceSnapshot(fact, sources))
    return checks
  }, [facts, sources])

  const candidateSnapshotChecks = useMemo(() => {
    const checks = new Map<string, FactSourceSnapshotCheck>()
    for (const candidate of candidates) checks.set(candidate.candidateId, checkFactSourceSnapshot(candidate, sources))
    return checks
  }, [candidates, sources])

  // 废止内容本来就禁止进入上下文，不需要参与「快照待复核」的统计。
  const snapshotReviewKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const fact of facts) {
      if (fact.status === 'deprecated') continue
      const check = snapshotChecks.get(fact.factId)
      if (check && needsSnapshotReview(check)) keys.add(fact.factId)
    }
    for (const [candidateId, check] of candidateSnapshotChecks) if (needsSnapshotReview(check)) keys.add(candidateId)
    return keys
  }, [facts, snapshotChecks, candidateSnapshotChecks])

  const categoryMatches = useCallback(
    (entityType: StoryEntityType, authorityStatus: StoryRecordStatus, key: string) => {
      if (categoryKey === 'all') return true
      if (categoryKey === 'source:review') return snapshotReviewKeys.has(key)
      if (categoryKey.startsWith('group:')) {
        return activeGroup ? activeGroup.entityTypes.includes(entityType) : true
      }
      return authorityStatus === categoryKey.slice('status:'.length)
    },
    [categoryKey, activeGroup, snapshotReviewKeys],
  )

  const visibleCandidates = useMemo(() => candidates.filter(candidate => (
    categoryMatches(candidate.entityType, CANDIDATE_AUTHORITY_STATUS, candidate.candidateId)
    && (entityFilter === 'all' || candidate.entityType === entityFilter)
    && (statusFilter === 'all' || statusFilter === CANDIDATE_AUTHORITY_STATUS)
    && matchesStoryQuery(candidate, query)
  )), [candidates, categoryMatches, entityFilter, statusFilter, query])

  const visibleFacts = useMemo(() => facts.filter(fact => (
    categoryMatches(fact.entityType, fact.status, fact.factId)
    && (entityFilter === 'all' || fact.entityType === entityFilter)
    && (statusFilter === 'all' || fact.status === statusFilter)
    && matchesStoryQuery(fact, query)
  )), [facts, categoryMatches, entityFilter, statusFilter, query])

  const confirmedFacts = useMemo(() => visibleFacts.filter(fact => fact.status === 'confirmed'), [visibleFacts])
  const candidateFacts = useMemo(() => visibleFacts.filter(fact => fact.status === 'candidate'), [visibleFacts])
  const deprecatedFacts = useMemo(() => visibleFacts.filter(fact => fact.status === 'deprecated'), [visibleFacts])

  const characterFacts = useMemo(() => confirmedFacts.filter(fact => fact.entityType === 'character'), [confirmedFacts])
  const timelineFacts = useMemo(() => confirmedFacts
    .filter(fact => fact.entityType === 'timeline_event')
    .sort((a, b) => Number(a.payload.chapterNumber ?? 0) - Number(b.payload.chapterNumber ?? 0)), [confirmedFacts])
  const foreshadowingFacts = useMemo(() => confirmedFacts.filter(fact => fact.entityType === 'foreshadowing'), [confirmedFacts])

  const counts = useMemo(() => {
    const groups: Record<string, number> = {}
    for (const group of STORY_ENTITY_GROUPS) {
      groups[group.id] = facts.filter(fact => group.entityTypes.includes(fact.entityType)).length
        + candidates.filter(candidate => group.entityTypes.includes(candidate.entityType)).length
    }
    return {
      all: facts.length + candidates.length,
      groups,
      confirmed: statusBuckets.confirmed.length,
      candidate: statusBuckets.candidate.length + candidates.length,
      deprecated: statusBuckets.deprecated.length,
      snapshotReview: snapshotReviewKeys.size,
    }
  }, [facts, candidates, statusBuckets, snapshotReviewKeys])

  /** 实体类型下拉只列出当前分类档案里的类型，避免选出必然为空的结果。 */
  const entityOptions = useMemo(() => {
    const types = (activeGroup?.entityTypes ?? (Object.keys(STORY_ENTITY_LABELS) as StoryEntityType[]))
    return [...types]
  }, [activeGroup])

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

  const payloadObject = (fact: StoryFact): Record<string, unknown> => {
    if (draftFactId === fact.factId) {
      try {
        const parsed: unknown = JSON.parse(payloadDraft)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
      } catch { /* 保留最后一次可解析的草稿，编辑中的非法 JSON 不参与渲染 */ }
    }
    return fact.payload
  }

  const activeFilters = categoryKey !== 'all' || statusFilter !== 'all' || entityFilter !== 'all' || query.trim() !== ''
  const resetFilters = () => {
    setCategoryKey('all')
    setStatusFilter('all')
    setEntityFilter('all')
    setQuery('')
  }

  /**
   * 切换分类档案时同时重置实体类型：类型下拉只列出当前分组的类型，
   * 否则会留下一个在下拉里看不见、却仍在生效的筛选，把结果清空。
   */
  const handleCategorySelect = (key: CategoryKey) => {
    if (key.startsWith('group:')) setEntityFilter('all')
    setCategoryKey(key)
  }

  const selectedFactCheck = selectedFact ? snapshotChecks.get(selectedFact.factId) ?? null : null
  const selectedFields = selectedFact ? payloadFieldsFor(selectedFact.entityType) : []
  const selectedFieldsLabel = selectedFact ? payloadGroupLabelFor(selectedFact.entityType) : null

  /** 列表空状态：说明为什么为空，以及作者做哪个动作才会有内容。 */
  const queueEmptyState = (title: string, description: string, steps?: readonly string[]) => (
    <StoryEmptyState icon={<Layers size={22} />} title={title} description={description} steps={steps} />
  )

  return (
    <div className="h-full overflow-auto p-4 space-y-4" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-editor-bg)' }}>
      {/* 标题与资料边界说明：本页只管理事实与来源，不含写作统计 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Database size={16} style={{ color: 'var(--color-accent)' }} />{text('故事资料管理中心', 'Story Data Center')}</div>
          <p className="text-[11px] opacity-70 mt-1">{text('模型只能提交候选；作者确认后才会进入正式资料库。每条资料都保留来源、版本与影响章节。', 'Models can only submit candidates. Author confirmation is required before facts become authoritative, with provenance, versions, and chapter impacts retained.')}</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{text('本页管理事实与来源，不统计每日字数或写作时长。', 'This surface manages facts and provenance; it does not report daily word counts or writing time.')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{text('刷新', 'Refresh')}</Button>
      </div>

      {error && <div className="rounded border p-2 text-xs" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>{error}</div>}

      {/* 权威状态摘要：四条彼此独立的边界，点击即筛选 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <StatTile
          testId="story-stat-confirmed"
          label={text('正式事实（已确认）', 'Authoritative facts (confirmed)')}
          value={counts.confirmed}
          hint={text('唯一具备事实权威，可进入正文上下文', 'The only entries with fact authority; eligible for prose context')}
          accent="var(--color-success)"
          active={categoryKey === 'status:confirmed'}
          onClick={() => setCategoryKey(categoryKey === 'status:confirmed' ? 'all' : 'status:confirmed')}
        />
        <StatTile
          testId="story-stat-candidates"
          label={text('待作者确认候选', 'Candidates awaiting review')}
          value={candidates.length}
          hint={text('模型与扫描提交，未写入正式资料库', 'Submitted by models and scans; not committed as facts')}
          accent="var(--color-warning)"
          active={categoryKey === 'status:candidate'}
          onClick={() => setCategoryKey(categoryKey === 'status:candidate' ? 'all' : 'status:candidate')}
        />
        <StatTile
          testId="story-stat-deprecated"
          label={text('已废止内容', 'Deprecated content')}
          value={counts.deprecated}
          hint={text('保留追溯，严禁进入正文与生成上下文', 'Retained for traceability; excluded from prose and generation')}
          accent="var(--color-error)"
          active={categoryKey === 'status:deprecated'}
          onClick={() => setCategoryKey(categoryKey === 'status:deprecated' ? 'all' : 'status:deprecated')}
        />
        <StatTile
          testId="story-stat-snapshot-review"
          label={text('来源快照待复核', 'Provenance needing review')}
          value={counts.snapshotReview}
          hint={text('依据快照与母稿批准快照不一致或未批准', 'Citing snapshots that differ from, or are not covered by, an approved source snapshot')}
          accent="var(--color-info)"
          active={categoryKey === 'source:review'}
          onClick={() => setCategoryKey(categoryKey === 'source:review' ? 'all' : 'source:review')}
        />
      </div>

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <StoryAuthorityBoundaryNote text={text} />
      </div>

      {/* 检索与筛选 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-60" />
          <Input
            className="pl-6"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={text('搜索名称、摘要或字段值', 'Search name, summary, or field values')}
            aria-label={text('搜索资料', 'Search story data')}
          />
        </div>
        <Filter size={12} className="opacity-60" />
        <span className="opacity-70">{text('资料类型', 'Entity type')}</span>
        <select
          value={entityFilter}
          onChange={event => setEntityFilter(event.target.value as StoryEntityType | 'all')}
          className="rounded border p-1 bg-transparent"
          style={{ borderColor: 'var(--color-border)' }}
          aria-label={text('资料类型', 'Entity type')}
        >
          <option value="all">{text('全部类型', 'All types')}</option>
          {entityOptions.map(value => (
            <option key={value} value={value}>{text(STORY_ENTITY_LABELS[value].zh, STORY_ENTITY_LABELS[value].en)}</option>
          ))}
        </select>
        <span className="opacity-70">{text('权威状态', 'Authority status')}</span>
        <select
          value={statusFilter}
          onChange={event => setStatusFilter(event.target.value as StoryRecordStatus | 'all')}
          className="rounded border p-1 bg-transparent"
          style={{ borderColor: 'var(--color-border)' }}
          aria-label={text('权威状态', 'Authority status')}
        >
          {STATUS_FILTERS.map(status => (
            <option key={status} value={status}>
              {status === 'all'
                ? text('全部状态', 'All statuses')
                : text(STORY_RECORD_STATUS_LABELS[status].zh, STORY_RECORD_STATUS_LABELS[status].en)}
            </option>
          ))}
        </select>
        {activeFilters && (
          <button className="hover:underline inline-flex items-center gap-1" style={{ color: 'var(--color-accent)' }} onClick={resetFilters}>
            <X size={11} />
            {text('清除筛选', 'Clear filters')}
          </button>
        )}
        <span className="opacity-60 ml-auto">{text(`候选 ${visibleCandidates.length} · 正式库 ${visibleFacts.length}`, `Candidates ${visibleCandidates.length} · Fact records ${visibleFacts.length}`)}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* 分类导航 */}
        <aside
          className="w-full lg:w-56 lg:shrink-0 rounded-lg border p-2"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <CategoryRail categoryKey={categoryKey} onSelect={handleCategorySelect} counts={counts} text={text} />
        </aside>

        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* 视图切换 */}
          <div className="flex flex-wrap gap-1">
            {VIEW_MODES.map(([mode, label]) => {
              const Icon = VIEW_ICONS[mode]
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2 py-1 rounded flex items-center gap-1 text-xs ${viewMode === mode ? 'bg-accent/20 text-accent' : 'opacity-70 hover:bg-accent/10'}`}
                >
                  <Icon size={12} />{text(label.zh, label.en)}
                </button>
              )
            })}
          </div>

          {viewMode === 'characters' && <section className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-2 text-xs font-semibold mb-2">
              {text('人物卡与当前状态', 'Character cards & current state')}
              <span className="text-[10px] font-normal opacity-70">{text('仅已确认资料', 'Confirmed facts only')}</span>
            </div>
            {characterFacts.length === 0
              ? queueEmptyState(
                  text('暂无已确认人物。', 'No confirmed characters.'),
                  text('候选人物在下方「待作者确认候选」中等待处理。', 'Candidate characters wait in the review queue below.'),
                )
              : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">{characterFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className="text-left rounded border p-3 hover:bg-accent/10" style={{ borderColor: 'var(--color-border)' }}><div className="font-medium">{fact.canonicalName}</div><div className="text-[11px] opacity-70 mt-1">{String(fact.payload.role ?? text('未填写角色', 'No role recorded'))} · {String(fact.payload.status ?? fact.payload.condition ?? text('状态未记录', 'No status recorded'))}</div><div className="text-xs mt-2 opacity-80">{fact.summary}</div></button>)}</div>}
          </section>}

          {viewMode === 'timeline' && <section className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-2 text-xs font-semibold mb-2">
              {text('全书时间轴 / 事件 Ledger', 'Book timeline / event ledger')}
              <span className="text-[10px] font-normal opacity-70">{text('仅已确认资料', 'Confirmed facts only')}</span>
            </div>
            {timelineFacts.length === 0
              ? queueEmptyState(
                  text('暂无时间事件。', 'No timeline events.'),
                  text('时间事件属于世界设定的事实，同样需要作者确认后才进入时间轴。', 'Timeline events are facts about the world and only enter the ledger after author confirmation.'),
                )
              : <div className="space-y-1">{timelineFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className="w-full text-left grid grid-cols-[5rem_1fr_auto] gap-2 items-center rounded border p-2 hover:bg-accent/10 text-xs" style={{ borderColor: 'var(--color-border)' }}><span className="font-mono">{String(fact.payload.chapterNumber ?? fact.payload.date ?? '—')}</span><span>{fact.canonicalName} · {fact.summary}</span><span className="opacity-60">v{fact.revision}</span></button>)}</div>}
          </section>}

          {viewMode === 'foreshadowing' && <section className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-2 text-xs font-semibold mb-2">
              {text('伏笔回收状态', 'Foreshadowing recovery status')}
              <span className="text-[10px] font-normal opacity-70">{text('仅已确认资料', 'Confirmed facts only')}</span>
            </div>
            {foreshadowingFacts.length === 0
              ? queueEmptyState(
                  text('暂无已确认伏笔。', 'No confirmed foreshadowing.'),
                  text('伏笔只有被作者确认后才会在此显示回收状态。', 'Foreshadowing appears here with its recovery status only after author confirmation.'),
                )
              : <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{foreshadowingFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className="text-left rounded border p-3 hover:bg-accent/10" style={{ borderColor: 'var(--color-border)' }}><div className="flex justify-between"><span className="font-medium">{fact.canonicalName}</span><span className="text-[11px] opacity-70">{String(fact.payload.recoveryStatus ?? 'open')}</span></div><div className="text-xs mt-1 opacity-80">{fact.summary}</div></button>)}</div>}
          </section>}

          {viewMode === 'graph' && <section className="rounded border p-3 overflow-auto" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="text-xs font-semibold mb-2">{text('人物与资料关系图', 'Story fact relationship graph')}</div><svg role="img" aria-label="story fact relationship graph" viewBox="0 0 760 360" className="w-full min-w-[620px] h-[360px]">{allRelations.map(relation => { const fromIndex = facts.findIndex(fact => fact.factId === relation.fromFactId); const toIndex = facts.findIndex(fact => fact.factId === relation.toFactId); if (fromIndex < 0 || toIndex < 0) return null; const fx = 90 + (fromIndex % 4) * 180; const fy = 70 + Math.floor(fromIndex / 4) * 120; const tx = 90 + (toIndex % 4) * 180; const ty = 70 + Math.floor(toIndex / 4) * 120; return <g key={relation.relationId}><line x1={fx} y1={fy} x2={tx} y2={ty} stroke="var(--color-border)" /><text x={(fx + tx) / 2} y={(fy + ty) / 2 - 4} fontSize="9" fill="var(--color-text-muted)">{relation.relationType}</text></g>})}{confirmedFacts.slice(0, 12).map((fact, index) => { const x = 90 + (index % 4) * 180; const y = 70 + Math.floor(index / 4) * 120; return <g key={fact.factId} onClick={() => void handleSelectFact(fact)} className="cursor-pointer"><circle cx={x} cy={y} r="32" fill="var(--color-surface-raised)" stroke="var(--color-accent)" /><text x={x} y={y + 3} textAnchor="middle" fontSize="10" fill="var(--color-text)">{fact.canonicalName.slice(0, 8)}</text></g>})}{allRelations.length === 0 && confirmedFacts.length === 0 && <text x="380" y="180" textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">{text('暂无已确认资料关系', 'No confirmed fact relations yet')}</text>}</svg></section>}

          {/* 候选资料队列：模型与扫描只能提交到这里 */}
          <section data-testid="story-queue-candidates" className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <ShieldQuestion size={14} />
                {text(`候选资料 · 待作者确认 (${visibleCandidates.length})`, `Candidates · awaiting author review (${visibleCandidates.length})`)}
              </div>
              <div className="text-[10px] font-normal mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {text('来自模型或母稿扫描，尚未写入正式资料库；拒绝会标记为废止。', 'Submitted by models or source scans, not yet committed; rejecting marks them deprecated.')}
              </div>
            </div>
            <div className="max-h-[420px] overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {visibleCandidates.length === 0 && queueEmptyState(
                text('暂无待确认候选。', 'No pending candidates.'),
                text(
                  '候选只由模型提取或母稿扫描产生，且永远不会自动成为设定。当前没有被拒绝的候选记录在此显示。',
                  'Candidates come only from model extraction or source scans and never become settings automatically. Rejected candidates are not listed here.',
                ),
                [
                  text('在「资料清单与片段」中关联母稿目录并扫描，扫描结果只会生成候选。', 'Bind and scan a manuscript folder in Sources & Fragments; scanning only produces candidates.'),
                  text('在原稿分析工作流中提交角色卡候选，然后回到这里逐条确认。', 'Submit character-card candidates from the planning-material workflow, then confirm each one here.'),
                ],
              )}
              {visibleCandidates.map(candidate => {
                const check = candidateSnapshotChecks.get(candidate.candidateId)
                return (
                  <div key={candidate.candidateId} className={`p-3 space-y-2 ${selectedCandidateId === candidate.candidateId ? 'bg-accent/10' : ''}`}>
                    <button className="w-full text-left" onClick={() => setSelectedCandidateId(candidate.candidateId)}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium">{candidate.canonicalName}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[10px] opacity-70">{text(entityLabel(candidate.entityType).zh, entityLabel(candidate.entityType).en)} · {(candidate.confidence * 100).toFixed(0)}%</span>
                          <StoryReviewStatusChip reviewStatus={candidate.reviewStatus} text={text} />
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                            {text('候选 · 非设定', 'Candidate · not a setting')}
                          </span>
                        </span>
                      </div>
                      <div className="text-xs opacity-80 mt-1">{candidate.summary}</div>
                    </button>
                    {selectedCandidateId === candidate.candidateId && <>
                      <Provenance item={candidate} onOpenSource={() => void openSource(candidate.provenance.sourceId)} />
                      {check && <SourceSnapshotBadge check={check} text={text} />}
                      {!!candidate.possibleConflicts?.length && <div className="text-[11px]" style={{ color: 'var(--color-warning-text)' }}><FileWarning size={12} className="inline mr-1" />{candidate.possibleConflicts.join('；')}</div>}
                      <div className="flex gap-2"><Button size="sm" onClick={() => void handleApprove(candidate)}><Check size={13} />{text('确认写入', 'Confirm')}</Button><Button size="sm" variant="outline" onClick={() => void handleReject(candidate)}><X size={13} />{text('拒绝', 'Reject')}</Button></div>
                    </>}
                  </div>
                )
              })}
            </div>
          </section>

          {/* 正式资料库中的候选态记录：已在库里但不是事实 */}
          {candidateFacts.length > 0 && <section data-testid="story-queue-candidate-records" className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-warning)', backgroundColor: 'var(--color-surface)' }}>
            <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} style={{ color: 'var(--color-warning-text)' }} />
                {text(`正式库中仍标记为候选 (${candidateFacts.length})`, `Fact records still marked candidate (${candidateFacts.length})`)}
              </div>
              <div className="text-[10px] font-normal mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {text('这些记录已经入库，但没有事实权威；确认后才会进入生成上下文。', 'These records exist in the store but carry no fact authority until confirmed.')}
              </div>
            </div>
            <div className="max-h-[260px] overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {candidateFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className={`w-full text-left p-3 ${selectedFactId === fact.factId ? 'bg-accent/10' : ''}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{fact.canonicalName}</span><span className="flex items-center gap-1.5"><span className="text-[10px] opacity-70">{text(entityLabel(fact.entityType).zh, entityLabel(fact.entityType).en)} · v{fact.revision}</span><StoryRecordStatusChip status={fact.status} text={text} /></span></div><div className="text-xs opacity-80 mt-1">{fact.summary}</div></button>)}
            </div>
          </section>}

          {/* 正式事实：唯一具备事实权威的列表 */}
          <section data-testid="story-queue-confirmed" className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="px-3 py-2 border-b text-xs font-semibold" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <GitBranch size={14} />
                {text(`正式事实 · 已确认 (${confirmedFacts.length})`, `Authoritative facts · confirmed (${confirmedFacts.length})`)}
              </div>
              <div className="text-[10px] font-normal mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {text('作者确认过的设定，可进入正文与生成上下文。', 'Settings confirmed by the author; eligible for prose and generation context.')}
              </div>
            </div>
            <div className="max-h-[420px] overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {confirmedFacts.length === 0 && queueEmptyState(
                text('尚未有作者确认资料。', 'No authoritative facts yet.'),
                text('在「候选资料」中确认后，条目会移动到这里，并成为可进入正文上下文的事实。', 'Entries move here once you confirm them in the candidate queue, and only then may enter prose context.'),
              )}
              {confirmedFacts.map(fact => {
                const check = snapshotChecks.get(fact.factId)
                return (
                  <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className={`w-full text-left p-3 ${selectedFactId === fact.factId ? 'bg-accent/10' : ''}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium">{fact.canonicalName}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-[10px] opacity-70">{text(entityLabel(fact.entityType).zh, entityLabel(fact.entityType).en)} · v{fact.revision}</span>
                        <StoryRecordStatusChip status={fact.status} text={text} />
                        {check && needsSnapshotReview(check) && <SourceSnapshotBadge check={check} text={text} />}
                      </span>
                    </div>
                    <div className="text-xs opacity-80 mt-1">{fact.summary}</div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* 废止内容：可见但隔离 */}
          <section data-testid="story-queue-deprecated" className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <button
              onClick={() => setDeprecatedOpen(open => !open)}
              className="w-full px-3 py-2 text-left text-xs font-semibold flex items-center gap-2"
              aria-expanded={deprecatedOpen}
            >
              <Ban size={14} style={{ color: 'var(--color-error-text)' }} />
              {text(`已废止内容 (${deprecatedFacts.length})`, `Deprecated content (${deprecatedFacts.length})`)}
              <span className="text-[10px] font-normal ml-auto" style={{ color: 'var(--color-text-muted)' }}>
                {deprecatedOpen ? text('收起', 'Collapse') : text('展开查看', 'Expand')}
              </span>
            </button>
            <div className="px-3 pb-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {text('保留用于追溯历史与漏洞记录；严禁进入正文与生成上下文。', 'Kept for history and gap records; strictly excluded from prose and generation context.')}
            </div>
            {deprecatedOpen && <div className="border-t max-h-[300px] overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {deprecatedFacts.length === 0 && queueEmptyState(
                text('暂无废止内容。', 'No deprecated content.'),
                text('被拒绝的候选与作者标记废止的记录会保留在这里。', 'Rejected candidates and author-deprecated records stay here.'),
              )}
              {deprecatedFacts.map(fact => <button key={fact.factId} onClick={() => void handleSelectFact(fact)} className={`w-full text-left p-3 opacity-80 ${selectedFactId === fact.factId ? 'bg-accent/10' : ''}`}><div className="flex items-center justify-between gap-2"><span className="font-medium line-through">{fact.canonicalName}</span><span className="flex items-center gap-1.5"><span className="text-[10px] opacity-70">{text(entityLabel(fact.entityType).zh, entityLabel(fact.entityType).en)} · v{fact.revision}</span><StoryRecordStatusChip status={fact.status} text={text} /></span></div><div className="text-xs opacity-80 mt-1">{fact.summary}</div></button>)}
            </div>}
          </section>

          {activeFilters && visibleCandidates.length === 0 && visibleFacts.length === 0 && (
            <StoryEmptyState
              icon={<Search size={26} />}
              title={text('当前筛选条件下没有资料', 'No records match the current filters')}
              description={text(
                '筛选只改变显示范围，不会改动任何资料的权威状态。',
                'Filters only change what is shown; they never change the authority status of a record.',
              )}
              actions={<Button size="sm" variant="outline" onClick={resetFilters}>{text('清除筛选', 'Clear filters')}</Button>}
            />
          )}
        </div>
      </div>

      {selectedFact && <section className="rounded border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 text-xs font-semibold flex-wrap">
          <History size={14} />{selectedFact.canonicalName} · {text('来源与影响追踪', 'Provenance & impact trace')}
          <StoryRecordStatusChip status={selectedFact.status} text={text} />
          <span className="text-[10px] font-normal opacity-70">
            {text(
              `v${selectedFact.revision} · 置信度 ${selectedFact.confidence.toFixed(2)}${selectedFact.confirmedBy ? ` · 确认人 ${selectedFact.confirmedBy}` : ''}${selectedFact.confirmedAt ? ` · ${selectedFact.confirmedAt}` : ''}`,
              `v${selectedFact.revision} · confidence ${selectedFact.confidence.toFixed(2)}${selectedFact.confirmedBy ? ` · confirmed by ${selectedFact.confirmedBy}` : ''}${selectedFact.confirmedAt ? ` · ${selectedFact.confirmedAt}` : ''}`,
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded border p-2.5 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-[11px] font-medium">{text('来源', 'Source')}</div>
            <Provenance item={selectedFact} onOpenSource={() => void openSource(selectedFact.provenance.sourceId)} />
          </div>
          <div className="rounded border p-2.5 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-[11px] font-medium">{text('批准快照核对', 'Approved-snapshot check')}</div>
            {selectedFactCheck ? <>
              <SourceSnapshotBadge check={selectedFactCheck} text={text} />
              <div className="text-[11px] space-y-0.5 font-mono break-all" style={{ color: 'var(--color-text-secondary)' }}>
                <div>{text('依据快照', 'Cited snapshot')}: {selectedFactCheck.provenanceSnapshotId || '—'}</div>
                <div>{text('来源批准快照', 'Approved source snapshot')}: {selectedFactCheck.approvedSnapshotId ?? '—'}</div>
                <div>{text('来源文件', 'Source file')}: {selectedFactCheck.relativePath ?? text('未在当前项目来源清单中', 'Not in the current project source list')}</div>
              </div>
            </> : <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{text('无法读取来源核对信息。', 'Source check unavailable.')}</div>}
          </div>
        </div>

        {selectedFact.status === 'deprecated' && (
          <div className="rounded border p-2 text-[11px] flex items-start gap-2" style={{ borderColor: 'color-mix(in srgb, var(--color-error) 35%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error-text)' }}>
            <Ban size={13} className="mt-0.5 shrink-0" />
            <span>{text('这条内容已废止：仅用于追溯，不会进入正文与生成上下文。', 'This record is deprecated: kept for traceability only and excluded from prose and generation context.')}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="font-medium mb-1">{text('作者编辑', 'Author editing')}</div>
            <textarea value={draftFactId === selectedFact.factId ? summaryDraft : selectedFact.summary} onChange={event => { setDraftFactId(selectedFact.factId); setSummaryDraft(event.target.value) }} className="w-full min-h-20 rounded border p-2 bg-transparent" style={{ borderColor: 'var(--color-border)' }} aria-label={text('资料摘要', 'Fact summary')} />
            <textarea value={draftFactId === selectedFact.factId ? payloadDraft : JSON.stringify(selectedFact.payload, null, 2)} onChange={event => { setDraftFactId(selectedFact.factId); setPayloadDraft(event.target.value) }} className="w-full min-h-28 rounded border p-2 mt-2 font-mono text-[11px] bg-transparent" style={{ borderColor: 'var(--color-border)' }} aria-label="payload JSON" />
            {selectedFields.length > 0 && (
              <div className="mt-2 rounded border p-2" style={{ borderColor: 'var(--color-border)' }}>
                {selectedFieldsLabel && <div className="font-medium mb-1 text-[11px]">{text(selectedFieldsLabel.zh, selectedFieldsLabel.en)}</div>}
                <div className="grid grid-cols-2 gap-2">
                  {selectedFields.map(field => {
                    const payload = payloadObject(selectedFact)
                    if (field.options) {
                      return (
                        <label key={field.key} className="text-[11px] col-span-2">
                          {text(field.label.zh, field.label.en)}
                          <select
                            value={String(payload[field.key] ?? field.options[0].value)}
                            onChange={event => updatePayloadField(field.key, event.target.value)}
                            className="w-full rounded border p-1 bg-transparent mt-1"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            {field.options.map(option => (
                              <option key={option.value} value={option.value}>{text(option.label.zh, option.label.en)}</option>
                            ))}
                          </select>
                        </label>
                      )
                    }
                    return (
                      <label key={field.key} className="text-[11px]">
                        {text(field.label.zh, field.label.en)}
                        <input
                          type={field.kind === 'number' ? 'number' : 'text'}
                          value={String(payload[field.key] ?? '')}
                          onChange={event => updatePayloadField(field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value)}
                          className="w-full rounded border p-1 bg-transparent mt-1"
                          style={{ borderColor: 'var(--color-border)' }}
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex gap-2 mt-2 flex-wrap">
              <select
                value={draftFactId === selectedFact.factId ? statusDraft : selectedFact.status}
                onChange={event => { setDraftFactId(selectedFact.factId); setStatusDraft(event.target.value as StoryRecordStatus) }}
                className="rounded border p-1 bg-transparent"
                style={{ borderColor: 'var(--color-border)' }}
                aria-label={text('权威状态', 'Authority status')}
              >
                <option value="confirmed">{text('已确认', 'Confirmed')}</option>
                <option value="candidate">{text('候选', 'Candidate')}</option>
                <option value="deprecated">{text('废止', 'Deprecated')}</option>
              </select>
              <input type="number" min="0" max="1" step="0.01" value={draftFactId === selectedFact.factId ? confidenceDraft : selectedFact.confidence} onChange={event => { setDraftFactId(selectedFact.factId); setConfidenceDraft(event.target.value) }} className="w-20 rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }} aria-label={text('置信度', 'Confidence')} />
              <Button size="sm" onClick={() => void handleCommit()}>{text('提交新版本', 'Commit version')}</Button>
            </div>
          </div>
          <div>
            <div className="font-medium mb-1">{text('版本历史', 'Version history')}</div>
            {versions.length === 0
              ? <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{text('暂无版本记录。', 'No versions recorded yet.')}</div>
              : versions.map(version => <div key={version.versionId} className="border-l pl-2 mb-2" style={{ borderColor: 'var(--color-border)' }}>v{version.version} · {version.changedBy} · {version.createdAt}<div className="opacity-70">{version.summary}</div></div>)}
          </div>
          <div>
            <div className="font-medium mb-1">{text('受影响章节', 'Affected chapters')}</div>
            {impacts.length === 0
              ? <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{text('暂无章节影响记录。', 'No chapter impacts recorded.')}</div>
              : <div className="flex flex-wrap gap-1">{impacts.map(impact => <button key={impact.impactId} onClick={() => void openImpactChapter(impact.chapterNumber)} className="px-2 py-1 rounded border hover:bg-accent/10" style={{ borderColor: 'var(--color-border)' }}>第{impact.chapterNumber}章 · {impact.impactType}</button>)}</div>}
            <div className="font-medium mt-3 mb-1">{text('资料关系', 'Fact relations')}</div>
            {relations.length === 0
              ? <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{text('暂无资料关系。', 'No fact relations yet.')}</div>
              : relations.map(relation => <div key={relation.relationId} className="opacity-80 mb-1">{relation.fromFactId === selectedFact.factId ? '→' : '←'} {facts.find(fact => fact.factId === (relation.fromFactId === selectedFact.factId ? relation.toFactId : relation.fromFactId))?.canonicalName ?? text('未知资料', 'Unknown record')} · {relation.relationType}</div>)}
            <div className="flex gap-1 mt-2"><select value={relationTarget} onChange={event => setRelationTarget(event.target.value)} className="min-w-0 flex-1 rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }}><option value="">{text('选择资料', 'Choose fact')}</option>{facts.filter(fact => fact.factId !== selectedFact.factId).map(fact => <option key={fact.factId} value={fact.factId}>{fact.canonicalName}</option>)}</select><input value={relationType} onChange={event => setRelationType(event.target.value)} className="w-20 rounded border p-1 bg-transparent" style={{ borderColor: 'var(--color-border)' }} aria-label={text('关系类型', 'Relation type')} /><Button size="sm" onClick={() => void handleAddRelation()} disabled={!relationTarget}>{text('关联', 'Link')}</Button></div>
          </div>
        </div>
      </section>}
    </div>
  )
}
