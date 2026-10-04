import { useMemo, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, FileText, Layers3, RefreshCw, Sparkles } from 'lucide-react'

import type {
  BlueprintPlanningCheckRecord,
  BlueprintPlanningSelection,
  BlueprintVolumeOutlineOrigin,
  BlueprintVolumeOutlineSummary,
} from '../../shared/blueprint-planning'
import type {
  BlueprintBookOutlineImportPreview,
  BlueprintVolumeOutlineImportPreview,
} from '../../services/blueprint-planning-exchange'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { cn } from '../../lib/utils'
import './blueprint-planning.css'

export interface BlueprintPlanningTreeVolume {
  id: string
  name: string
  sortOrder: number
}

export interface BlueprintPlanningTreeChapter {
  chapterNumber: number
  title: string
  volumeId: string
  role?: string
  hasDraft?: boolean
  sourceStatus?: 'current' | 'stale' | 'unlinked' | 'loading'
}

export interface BlueprintPlanningTreeProps {
  selection: BlueprintPlanningSelection
  volumes: BlueprintPlanningTreeVolume[]
  chapters: BlueprintPlanningTreeChapter[]
  synopsis: string
  outlineSummaries: BlueprintVolumeOutlineSummary[]
  searchQuery: string
  draftFilter: 'all' | 'no-draft' | 'has-draft'
  collapsedVolumeIds: Set<string>
  onSearchChange(value: string): void
  onDraftFilterChange(value: 'all' | 'no-draft' | 'has-draft'): void
  onToggleVolume(volumeId: string): void
  onSelect(selection: BlueprintPlanningSelection): void
  onAddVolume(): void
  onAddChapter(): void
}

const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase()

export function BlueprintPlanningTree({
  selection, volumes, chapters, synopsis, outlineSummaries, searchQuery, draftFilter,
  collapsedVolumeIds, onSearchChange, onDraftFilterChange, onToggleVolume, onSelect,
  onAddVolume, onAddChapter,
}: BlueprintPlanningTreeProps) {
  const text = useLocaleStore(state => state.text)
  const query = normalizeSearch(searchQuery)
  const summaryByVolume = useMemo(() => new Map(outlineSummaries.map(item => [item.volumeId, item])), [outlineSummaries])
  const matchingChapters = (volumeId: string) => chapters.filter(chapter => {
    if (chapter.volumeId !== volumeId) return false
    if (draftFilter === 'has-draft' && !chapter.hasDraft) return false
    if (draftFilter === 'no-draft' && chapter.hasDraft) return false
    return !query || String(chapter.chapterNumber).includes(query) || chapter.title.toLocaleLowerCase().includes(query)
  })
  const filteredChapterCount = volumes.reduce((sum, volume) => sum + matchingChapters(volume.id).length, 0)
  const allChapterCount = chapters.length
  const bookMatches = !query || synopsis.toLocaleLowerCase().includes(query)

  return (
    <div className="blueprint-planning-tree" data-testid="blueprint-planning-tree">
      <label className="blueprint-planning-tree__search-label" htmlFor="blueprint-planning-search">
        {text('搜索总纲、卷纲、章号或标题', 'Search book, volume, chapter number, or title')}
      </label>
      <input
        id="blueprint-planning-search"
        className="blueprint-planning-tree__search"
        type="search"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
        placeholder={text('搜索规划内容…', 'Search planning…')}
        data-testid="blueprint-planning-search"
      />
      <div className="blueprint-planning-tree__filters" role="group" aria-label={text('写作状态筛选', 'Draft status filter')}>
        {([
          ['all', text('全部', 'All'), allChapterCount],
          ['no-draft', text('待写作', 'No draft'), chapters.filter(chapter => !chapter.hasDraft).length],
          ['has-draft', text('有正文', 'Has draft'), chapters.filter(chapter => chapter.hasDraft).length],
        ] as const).map(([value, label, count]) => (
          <button
            type="button"
            key={value}
            className={cn('blueprint-planning-tree__filter', draftFilter === value && 'is-active')}
            aria-pressed={draftFilter === value}
            onClick={() => onDraftFilterChange(value)}
          >
            {label}<span>{count}</span>
          </button>
        ))}
      </div>

      <div className="blueprint-planning-tree__nodes">
        <button
          type="button"
          className={cn('blueprint-planning-tree__node blueprint-planning-tree__node--book', selection.kind === 'book' && 'is-selected')}
          onClick={() => onSelect({ kind: 'book' })}
          data-testid="blueprint-planning-select-book"
        >
          <BookOpen size={14} aria-hidden="true" />
          <span>{text('全书总纲', 'Book outline')}</span>
          <span className="blueprint-planning-tree__count" title={text('章节匹配数', 'Matching chapters')}>{filteredChapterCount}</span>
        </button>

        {volumes.map(volume => {
          const volumeChapters = matchingChapters(volume.id)
          const allVolumeChapters = chapters.filter(chapter => chapter.volumeId === volume.id)
          const summary = summaryByVolume.get(volume.id)
          const collapsed = collapsedVolumeIds.has(volume.id)
          return (
            <section className="blueprint-planning-tree__volume" key={volume.id} data-volume-id={volume.id}>
              <div className={cn('blueprint-planning-tree__volume-row', selection.kind === 'volume' && selection.volumeId === volume.id && 'is-selected')}>
                <button
                  type="button"
                  className="blueprint-planning-tree__fold"
                  onClick={() => onToggleVolume(volume.id)}
                  aria-label={collapsed ? text(`展开${volume.name}`, `Expand ${volume.name}`) : text(`收起${volume.name}`, `Collapse ${volume.name}`)}
                  aria-expanded={!collapsed}
                  data-testid={`blueprint-planning-volume-fold-${volume.id}`}
                >
                  {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button
                  type="button"
                  className="blueprint-planning-tree__volume-title"
                  onClick={() => onSelect({ kind: 'volume', volumeId: volume.id })}
                  data-testid={`blueprint-planning-select-volume-${volume.id}`}
                  title={text('打开本卷卷纲', 'Open this volume outline')}
                >
                  <Layers3 size={13} aria-hidden="true" />
                  <span>{volume.name}</span>
                </button>
                <span className="blueprint-planning-tree__count" title={text('匹配章节 / 实际章节', 'Matching / actual chapters')}>
                  {query ? `${volumeChapters.length}/${allVolumeChapters.length}` : allVolumeChapters.length}
                </span>
              </div>
              {!collapsed && <div className="blueprint-planning-tree__children">
                <button
                  type="button"
                  className={cn('blueprint-planning-tree__node blueprint-planning-tree__node--outline', selection.kind === 'volume' && selection.volumeId === volume.id && 'is-selected')}
                  onClick={() => onSelect({ kind: 'volume', volumeId: volume.id })}
                  data-testid={`blueprint-planning-volume-outline-${volume.id}`}
                >
                  <FileText size={12} aria-hidden="true" />
                  <span>{text('本卷卷纲', 'Volume outline')}</span>
                  <span className={cn('blueprint-planning-tree__status', summary ? 'is-present' : 'is-empty')}>
                    {summary ? text(`r${summary.revision}`, `r${summary.revision}`) : text('未建立', 'Empty')}
                  </span>
                </button>
                {allVolumeChapters.length === 0 ? (
                  <p className="blueprint-planning-tree__empty">{text('本卷暂无实际章节', 'No actual chapters in this volume')}</p>
                ) : volumeChapters.length === 0 ? (
                  <p className="blueprint-planning-tree__empty">{text('没有匹配的章节；本卷卷纲仍可打开', 'No matching chapters; the volume outline remains available')}</p>
                ) : volumeChapters.map(chapter => (
                  <button
                    type="button"
                    key={chapter.chapterNumber}
                    className={cn('blueprint-planning-tree__node blueprint-planning-tree__node--chapter', selection.kind === 'chapter' && selection.chapterNumber === chapter.chapterNumber && 'is-selected')}
                    onClick={() => onSelect({ kind: 'chapter', chapterNumber: chapter.chapterNumber })}
                    data-testid={`blueprint-planning-select-chapter-${chapter.chapterNumber}`}
                  >
                    <span className="blueprint-planning-tree__chapter-number">{chapter.chapterNumber}</span>
                    <span className="blueprint-planning-tree__chapter-title">{chapter.title || text('未命名', 'Untitled')}</span>
                    {chapter.sourceStatus && chapter.sourceStatus !== 'current' && <span className={cn('blueprint-planning-tree__source-status', chapter.sourceStatus === 'stale' && 'is-warning')} title={chapter.sourceStatus === 'stale' ? text('上层来源已变化，建议重新检查', 'A source changed; review suggested') : chapter.sourceStatus === 'loading' ? text('正在核对来源版本', 'Checking source versions') : text('尚未建立来源关联', 'No source link yet')} aria-label={chapter.sourceStatus === 'stale' ? text('规划过期', 'Planning stale') : chapter.sourceStatus === 'loading' ? text('正在核对来源', 'Checking sources') : text('尚无来源关联', 'No source link')}>
                      {chapter.sourceStatus === 'stale' ? '!' : chapter.sourceStatus === 'loading' ? '…' : '○'}
                    </span>}
                    {chapter.hasDraft && <span className="blueprint-planning-tree__draft-mark" title={text('已有正文', 'Has draft')}>●</span>}
                  </button>
                ))}
              </div>}
            </section>
          )
        })}
      </div>

      <div className="blueprint-planning-tree__footer">
        <span>{text(`显示 ${filteredChapterCount} / ${allChapterCount} 个实际章节`, `${filteredChapterCount} / ${allChapterCount} actual chapters`)}</span>
        <div className="blueprint-planning-tree__footer-actions">
          <Button variant="ghost" size="sm" onClick={onAddVolume} data-testid="blueprint-planning-add-volume">＋ {text('新卷', 'Volume')}</Button>
          <Button variant="ghost" size="sm" onClick={onAddChapter} data-testid="blueprint-planning-add-chapter">＋ {text('新章', 'Chapter')}</Button>
        </div>
      </div>
      {query && !bookMatches && <p className="blueprint-planning-tree__search-note">{text('总纲节点保留；当前查询未匹配总纲正文。', 'The book outline stays visible; this query did not match its text.')}</p>}
    </div>
  )
}

export interface BlueprintPlanningChecksProps {
  checks: BlueprintPlanningCheckRecord[]
}

export function BlueprintPlanningChecks({ checks }: BlueprintPlanningChecksProps) {
  const text = useLocaleStore(state => state.text)
  if (checks.length === 0) return <p className="blueprint-planning__muted">{text('尚无衔接检查记录。', 'No connection checks yet.')}</p>
  return (
    <div className="blueprint-planning-checks" data-testid="blueprint-planning-checks">
      {checks.map(check => (
        <article key={check.checkId} className="blueprint-planning-checks__report" data-check-state={check.currentState}>
          <header>
            <strong>{check.kind === 'book-volume' ? text('总纲 → 卷纲', 'Book → volumes') : text('卷纲 → 章节', 'Volume → chapters')}</strong>
            <span className={cn('blueprint-planning__badge', check.currentState !== 'current' && 'is-warning')}>
              {check.currentState === 'current' ? text('当前版本', 'Current') : check.currentState === 'unlinked' ? text('尚未建立来源关联', 'Unlinked') : text('上层已变化，建议检查', 'Sources changed; review suggested')}
            </span>
          </header>
          <p className="blueprint-planning__muted">{text(`目标版本：${check.targetRevision ?? '—'} · ${check.targetHash.slice(0, 12)}`, `Target revision: ${check.targetRevision ?? '—'} · ${check.targetHash.slice(0, 12)}`)}</p>
          <div className="blueprint-planning-checks__columns">
            <section>
              <h4>{text('确定性检查', 'Deterministic checks')}</h4>
              {check.deterministic.length === 0 ? <p className="blueprint-planning__muted">{text('未发现结构问题', 'No structural issues found')}</p> : check.deterministic.map((issue, index) => <p key={`${issue.code}-${index}`} className={cn('blueprint-planning-checks__issue', `is-${issue.severity}`)}>{issue.message}{issue.citation && <small>{issue.citation}</small>}</p>)}
            </section>
            <section>
              <h4>{text('AI 建议（非硬性结论）', 'AI suggestions (not hard requirements)')}</h4>
              {check.aiSuggestions.length === 0 ? <p className="blueprint-planning__muted">{text('暂无建议', 'No suggestions')}</p> : check.aiSuggestions.map((issue, index) => <p key={`${issue.code}-${index}`} className="blueprint-planning-checks__issue is-suggestion">{issue.message}{issue.citation && <small>{issue.citation}</small>}</p>)}
            </section>
          </div>
        </article>
      ))}
    </div>
  )
}

export interface BlueprintBookOutlineEditorProps {
  markdown: string
  dirty: boolean
  saving: boolean
  loading: boolean
  error: string | null
  contentHash: string | null
  currentMarkdown: string
  candidates: BlueprintPlanningCandidateView[]
  checks: BlueprintPlanningCheckRecord[]
  busyOperationId: string | null
  workflowStarting: boolean
  importPreview: BlueprintBookOutlineImportPreview | null
  onChange(markdown: string): void
  onSave(): Promise<boolean>
  onDiscard(): void
  onImport(): void
  onCancelImport(): void
  onConfirmImport(): Promise<boolean>
  onExport(): void
  onClear(): void
  onRefresh(): void
  onGenerate(kind: 'book-outline' | 'volume-plan' | 'connection-check', options?: { guidance?: string; mode?: 'generate' | 'improve' }): void
  onConfirmCandidate(candidate: BlueprintPlanningCandidateView, editedJson: string, selected: { volumeIds: string[]; chapterNumbers: number[] }): Promise<void>
  onUpdateCandidate(candidate: BlueprintPlanningCandidateView, editedJson: string): Promise<boolean>
  onCancelCandidate(operationId: string): Promise<void>
}

const BOOK_TEMPLATE = `# 故事主线\n\n# 核心矛盾\n\n# 人物总体成长\n\n# 主要转折\n\n# 全书高潮\n\n# 结局方向\n\n# 各卷承担的剧情任务\n`

export function BlueprintBookOutlineEditor(props: BlueprintBookOutlineEditorProps) {
  const text = useLocaleStore(state => state.text)
  const [showCandidates, setShowCandidates] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const [guidance, setGuidance] = useState('')
  return (
    <section className="blueprint-planning-editor" data-testid="blueprint-book-outline-editor">
      <header className="blueprint-planning-editor__header">
        <div>
          <h2>{text('全书总纲', 'Book outline')}</h2>
          <p>{text('沿用项目总纲原文作为唯一正文。旧内容不会自动拆分或改写；各卷任务的详细内容由本卷卷纲保存。', 'The existing project synopsis remains the single source of truth. Existing text is never split or rewritten automatically; each volume owns its detailed tasks.')}</p>
        </div>
        <div className="blueprint-planning-editor__revision" data-testid="blueprint-book-outline-version">
          {props.contentHash ? text(`正文 hash ${props.contentHash.slice(0, 12)}`, `Body hash ${props.contentHash.slice(0, 12)}`) : text('尚未读取版本', 'Version not loaded')}
        </div>
      </header>
      {props.error && <p className="blueprint-planning__error" role="alert">{props.error}</p>}
      <div className="blueprint-planning-editor__toolbar">
        <Button variant="outline" size="sm" onClick={() => props.onChange(`${props.markdown}${props.markdown && !props.markdown.endsWith('\n') ? '\n' : ''}${BOOK_TEMPLATE}`)} disabled={props.loading || props.saving}>{text('插入可选模板', 'Insert optional template')}</Button>
        <Button variant="outline" size="sm" onClick={props.onImport} disabled={props.loading || props.saving}>{text('导入 Markdown', 'Import Markdown')}</Button>
        <Button variant="outline" size="sm" onClick={props.onExport} disabled={props.loading}>{text('导出 Markdown', 'Export Markdown')}</Button>
        <span className="blueprint-planning__muted">{props.dirty ? text('有未保存修改', 'Unsaved changes') : text('已同步', 'Synced')}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('book-outline', { guidance, mode: 'generate' })} disabled={props.workflowStarting || props.loading || props.saving}>{text('生成新总纲候选', 'Generate new outline candidate')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('book-outline', { guidance, mode: 'improve' })} disabled={props.workflowStarting || props.loading || props.saving || !props.currentMarkdown.trim()}>{text('改进现有总纲', 'Improve existing outline')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('volume-plan', { guidance })} disabled={props.workflowStarting || props.loading || props.saving}>{text('规划分卷', 'Plan volumes')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('connection-check')} disabled={props.workflowStarting || props.loading || props.saving}>{text('检查总纲与卷纲', 'Check book and volumes')}</Button>
        <Button variant="outline" size="sm" onClick={() => setShowCandidates(value => !value)}>{text(`候选（${props.candidates.length}）`, `Candidates (${props.candidates.length})`)}</Button>
        <Button variant="outline" size="sm" onClick={() => setShowChecks(value => !value)}>{text(`检查报告（${props.checks.length}）`, `Checks (${props.checks.length})`)}</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={props.onRefresh} title={text('刷新候选与检查记录', 'Refresh candidates and checks')} aria-label={text('刷新规划状态', 'Refresh planning status')}><RefreshCw size={13} /></Button>
        <Button variant="destructive" size="sm" onClick={props.onClear} disabled={(!props.markdown && !props.dirty) || props.saving}>{text('清空总纲', 'Clear outline')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onDiscard()} disabled={!props.dirty || props.saving}>{text('放弃修改', 'Discard')}</Button>
        <Button size="sm" onClick={() => void props.onSave()} disabled={!props.dirty || props.saving || props.loading} data-testid="blueprint-book-outline-save">{props.saving ? text('保存中…', 'Saving…') : text('保存总纲', 'Save book outline')}</Button>
      </div>
      <div className="blueprint-planning-editor__guidance">
        <label htmlFor="blueprint-book-guidance">{text('作者指导（仅用于候选生成，不作为总纲正文）', 'Author guidance (candidate input only; not added to the outline)')}</label>
        <input id="blueprint-book-guidance" value={guidance} onChange={event => setGuidance(event.target.value)} placeholder={text('可留空', 'Optional')} />
        <span className="blueprint-planning__muted">{text('使用上方按钮时会把指导作为候选输入。', 'The buttons above use this guidance as candidate input.')}</span>
      </div>
      <Textarea
        className="blueprint-planning-editor__markdown"
        value={props.markdown}
        onChange={event => props.onChange(event.target.value)}
        rows={24}
        spellCheck
        aria-label={text('全书总纲 Markdown 正文', 'Book outline Markdown')}
        placeholder={text('在这里按原文编辑全书总纲…', 'Edit the book outline here…')}
        data-testid="blueprint-book-outline-markdown"
      />
      {props.importPreview && <div className="blueprint-planning-import" role="dialog" aria-modal="true" aria-label={text('总纲导入预览', 'Book outline import preview')} data-testid="blueprint-book-import-preview">
        <div className="blueprint-planning-import__card">
          <header><h3>{text('确认导入全书总纲 Markdown', 'Confirm book outline Markdown import')}</h3><button type="button" onClick={props.onCancelImport} aria-label={text('关闭', 'Close')}>×</button></header>
          <p>{text(`文件：${props.importPreview.fileName} · 当前总纲 hash：${props.importPreview.expectedSynopsisHash.slice(0, 12)} · 导入 hash：${props.importPreview.importHash.slice(0, 12)}`, `File: ${props.importPreview.fileName} · current outline hash: ${props.importPreview.expectedSynopsisHash.slice(0, 12)} · imported hash: ${props.importPreview.importHash.slice(0, 12)}`)}</p>
          <details className="blueprint-planning-import__current">
            <summary>{text('查看导入前的当前总纲', 'Inspect the current book outline')}</summary>
            <Textarea readOnly value={props.importPreview.currentSynopsis} rows={8} aria-label={text('当前总纲正文', 'Current book outline')} />
          </details>
          <Textarea readOnly value={props.importPreview.markdown} rows={12} aria-label={text('导入内容预览', 'Imported content preview')} />
          <footer>
            <Button variant="ghost" size="sm" onClick={props.onCancelImport}>{text('取消', 'Cancel')}</Button>
            <Button size="sm" disabled={props.saving || props.loading} onClick={() => void props.onConfirmImport()}>{text('按预览版本确认保存', 'Confirm using preview version')}</Button>
          </footer>
        </div>
      </div>}
      {showCandidates && <section className="blueprint-planning-editor__subpanel"><h3>{text('规划候选', 'Planning candidates')}</h3><BlueprintPlanningCandidatePanel candidates={props.candidates} currentMarkdown={props.currentMarkdown} busyOperationId={props.busyOperationId} onConfirm={props.onConfirmCandidate} onUpdate={props.onUpdateCandidate} onCancel={props.onCancelCandidate} /></section>}
      {showChecks && <section className="blueprint-planning-editor__subpanel"><h3>{text('衔接检查', 'Connection checks')}</h3><BlueprintPlanningChecks checks={props.checks} /></section>}
    </section>
  )
}

export interface BlueprintVolumeOutlineEditorProps {
  volumeId: string
  volumeName: string
  markdown: string
  revision: number
  contentHash: string | null
  actualChapterCount: number
  dirty: boolean
  saving: boolean
  loading: boolean
  error: string | null
  sourceStatus: 'unlinked' | 'current' | 'stale' | 'loading'
  candidates: BlueprintPlanningCandidateView[]
  checks: BlueprintPlanningCheckRecord[]
  busyOperationId: string | null
  workflowStarting: boolean
  currentMarkdown: string
  importPreview: BlueprintVolumeOutlineImportPreview | null
  onChange(markdown: string): void
  onSave(markdown: string, origin: BlueprintVolumeOutlineOrigin): Promise<boolean>
  onDiscard(): void
  onImport(): void
  onCancelImport(): void
  onConfirmImport(): Promise<boolean>
  onExport(): void
  onClear(): void
  onRefresh(): void
  onGenerate(kind: 'volume-outline' | 'chapter-plan' | 'connection-check', options?: { guidance?: string; plannedChapterCount?: number; chapterRange?: { from: number; to: number } }): void
  onConfirmCandidate(candidate: BlueprintPlanningCandidateView, editedJson: string, selected: { volumeIds: string[]; chapterNumbers: number[] }): Promise<void>
  onUpdateCandidate(candidate: BlueprintPlanningCandidateView, editedJson: string): Promise<boolean>
  onCancelCandidate(operationId: string): Promise<void>
}

const VOLUME_SECTIONS = [
  '本卷定位与承担的全书任务',
  '开卷状态与本卷目标',
  '主要冲突、对立力量与关键限制',
  '主要人物及本卷变化',
  '关键事件、阶段推进与重要转折',
  '本卷高潮、结果与代价',
  '伏笔的引入、推进与计划回收',
  '卷末人物/世界状态与下一卷衔接',
  '预计篇幅、章节安排与作者指导',
] as const

const VOLUME_TEMPLATE = VOLUME_SECTIONS.map(title => `## ${title}\n\n`).join('')

function plannedChapterCount(markdown: string): string {
  const match = markdown.match(/(?:预计|计划)(?:章节数|章数|章节|篇幅)[^\d\n]{0,16}(\d{1,4})/u)
  return match?.[1] ?? '—'
}

export function BlueprintVolumeOutlineEditor(props: BlueprintVolumeOutlineEditorProps) {
  const text = useLocaleStore(state => state.text)
  const [showCandidates, setShowCandidates] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const [guidance, setGuidance] = useState('')
  const [plannedCountInput, setPlannedCountInput] = useState('')
  const [rangeStartInput, setRangeStartInput] = useState('')
  const [rangeEndInput, setRangeEndInput] = useState('')
  const headingStatus = useMemo(() => new Set(VOLUME_SECTIONS.filter(section => props.markdown.includes(section))), [props.markdown])
  const workflowOptions = {
    guidance,
    ...(Number(plannedCountInput) > 0 ? { plannedChapterCount: Math.trunc(Number(plannedCountInput)) } : {}),
    ...(Number(rangeStartInput) > 0 && Number(rangeEndInput) >= Number(rangeStartInput)
      ? { chapterRange: { from: Math.trunc(Number(rangeStartInput)), to: Math.trunc(Number(rangeEndInput)) } }
      : {}),
  }
  const insertSection = (section: string) => {
    if (props.markdown.includes(section)) return
    const prefix = props.markdown && !props.markdown.endsWith('\n') ? '\n\n' : props.markdown ? '\n' : ''
    props.onChange(`${props.markdown}${prefix}## ${section}\n\n`)
  }
  return (
    <section className="blueprint-planning-editor" data-testid="blueprint-volume-outline-editor" data-volume-id={props.volumeId}>
      <header className="blueprint-planning-editor__header">
        <div>
          <h2>{props.volumeName} · {text('本卷卷纲', 'Volume outline')}</h2>
          <p>{text('Markdown 全文是唯一正文；人物变化、伏笔与状态都属于计划，不会写入人物事实或正文。', 'The full Markdown body is authoritative. Character changes, foreshadowing, and state are plans; they do not update character facts or prose.')}</p>
        </div>
        <div className="blueprint-planning-editor__revision">
          <span>{props.revision ? `r${props.revision}` : text('尚无卷纲', 'No outline yet')}</span>
          {props.contentHash && <code>{props.contentHash.slice(0, 12)}</code>}
        </div>
      </header>
      <div className="blueprint-planning-editor__counts" data-testid="blueprint-volume-counts">
        <span>{text('实际章节', 'Actual chapters')} <strong>{props.actualChapterCount}</strong></span>
        <span>{text('预计章节（从卷纲文本读取）', 'Planned chapters (read from outline text)')} <strong>{plannedChapterCount(props.markdown)}</strong></span>
        <span className={cn('blueprint-planning__badge', props.sourceStatus === 'stale' && 'is-warning')}>
          {props.sourceStatus === 'unlinked' ? text('尚未建立来源关联', 'Source not linked') : props.sourceStatus === 'stale' ? text('上层已变化，建议检查', 'Sources changed; review suggested') : props.sourceStatus === 'loading' ? text('正在核对来源版本', 'Checking source versions') : text('来源版本一致', 'Source version matches')}
        </span>
      </div>
      {props.error && <p className="blueprint-planning__error" role="alert">{props.error}</p>}
      <div className="blueprint-planning-editor__toolbar">
        <Button variant="outline" size="sm" onClick={() => props.onChange(`${props.markdown}${props.markdown && !props.markdown.endsWith('\n') ? '\n' : ''}${VOLUME_TEMPLATE}`)} disabled={props.loading || props.saving}>{text('插入九项可选模板', 'Insert optional 9-section template')}</Button>
        <Button variant="outline" size="sm" onClick={props.onImport}>{text('导入 Markdown', 'Import Markdown')}</Button>
        <Button variant="outline" size="sm" onClick={props.onExport} disabled={!props.revision}>{text('导出 Markdown', 'Export Markdown')}</Button>
        <Button variant="destructive" size="sm" onClick={props.onClear} disabled={!props.revision || props.saving}>{text('清空卷纲', 'Clear outline')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('volume-outline', workflowOptions)} disabled={props.workflowStarting || props.loading || props.saving}>{text('生成卷纲候选', 'Generate outline candidate')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('chapter-plan', workflowOptions)} disabled={props.workflowStarting || props.loading || props.saving}>{text('规划本卷章节', 'Plan chapters')}</Button>
        <Button variant="ghost" size="sm" onClick={() => props.onGenerate('connection-check')} disabled={props.workflowStarting || props.loading || props.saving}>{text('检查卷纲与章节', 'Check volume and chapters')}</Button>
        <Button variant="outline" size="sm" onClick={() => setShowCandidates(value => !value)}>{text(`候选（${props.candidates.length}）`, `Candidates (${props.candidates.length})`)}</Button>
        <Button variant="outline" size="sm" onClick={() => setShowChecks(value => !value)}>{text(`检查报告（${props.checks.length}）`, `Checks (${props.checks.length})`)}</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={props.onRefresh} title={text('刷新候选与检查记录', 'Refresh candidates and checks')} aria-label={text('刷新规划状态', 'Refresh planning status')}><RefreshCw size={13} /></Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={props.onDiscard} disabled={!props.dirty || props.saving}>{text('放弃修改', 'Discard')}</Button>
        <Button size="sm" onClick={() => void props.onSave(props.markdown, 'manual')} disabled={!props.dirty || props.saving || props.loading} data-testid="blueprint-volume-outline-save">{props.saving ? text('保存中…', 'Saving…') : text('保存卷纲', 'Save volume outline')}</Button>
      </div>
      <nav className="blueprint-planning-sections" aria-label={text('卷纲分区导航', 'Volume outline sections')}>
        {VOLUME_SECTIONS.map((section, index) => <button type="button" key={section} className={headingStatus.has(section) ? 'is-present' : ''} onClick={() => insertSection(section)} title={text('点击插入缺少的分区标题', 'Click to insert this section heading if missing')}><span>{index + 1}</span>{section}</button>)}
      </nav>
      <div className="blueprint-planning-editor__workflow-inputs">
        <label>{text('预计章数', 'Planned chapter count')}<input inputMode="numeric" type="number" min="1" value={plannedCountInput} onChange={event => setPlannedCountInput(event.target.value)} placeholder={plannedChapterCount(props.markdown)} /></label>
        <label>{text('本卷章号范围（可选）', 'Chapter range (optional)')}<span><input inputMode="numeric" type="number" min="1" value={rangeStartInput} onChange={event => setRangeStartInput(event.target.value)} placeholder={text('起始', 'From')} /><input inputMode="numeric" type="number" min="1" value={rangeEndInput} onChange={event => setRangeEndInput(event.target.value)} placeholder={text('结束', 'To')} /></span></label>
        <label className="blueprint-planning-editor__workflow-guidance">{text('作者指导（仅用于候选）', 'Author guidance (candidate input only)')}<input value={guidance} onChange={event => setGuidance(event.target.value)} placeholder={text('可留空', 'Optional')} /></label>
      </div>
      <Textarea
        className="blueprint-planning-editor__markdown"
        value={props.markdown}
        onChange={event => props.onChange(event.target.value)}
        rows={22}
        spellCheck
        aria-label={text('本卷卷纲 Markdown 正文', 'Volume outline Markdown')}
        placeholder={text('可直接写自由 Markdown，也可按上方分区导航插入标题…', 'Write free-form Markdown or use the section navigation to insert headings…')}
        data-testid="blueprint-volume-outline-markdown"
      />
      {props.importPreview && <div className="blueprint-planning-import" role="dialog" aria-modal="true" aria-label={text('卷纲导入预览', 'Volume outline import preview')} data-testid="blueprint-volume-import-preview">
        <div className="blueprint-planning-import__card">
          <header><h3>{text('确认导入卷纲 Markdown', 'Confirm volume Markdown import')}</h3><button type="button" onClick={props.onCancelImport} aria-label={text('关闭', 'Close')}>×</button></header>
          <p>{text(`目标：${props.volumeName}（${props.volumeId}） · 当前版本 r${props.importPreview.expectedRevision} · 文件：${props.importPreview.fileName} · 当前 hash：${props.importPreview.currentHash?.slice(0, 12) ?? '—'} · 导入 hash：${props.importPreview.importHash.slice(0, 12)}`, `Target: ${props.volumeName} (${props.volumeId}) · current revision r${props.importPreview.expectedRevision} · file: ${props.importPreview.fileName} · current hash: ${props.importPreview.currentHash?.slice(0, 12) ?? '—'} · import hash: ${props.importPreview.importHash.slice(0, 12)}`)}</p>
          <details className="blueprint-planning-import__current">
            <summary>{text('查看导入前的当前卷纲', 'Inspect the current volume outline')}</summary>
            <Textarea readOnly value={props.importPreview.currentMarkdown ?? ''} rows={8} aria-label={text('当前卷纲正文', 'Current volume outline')} />
          </details>
          <Textarea readOnly value={props.importPreview.markdown} rows={12} aria-label={text('导入内容预览', 'Imported content preview')} />
          <footer>
            <Button variant="ghost" size="sm" onClick={props.onCancelImport}>{text('取消', 'Cancel')}</Button>
            <Button size="sm" disabled={props.saving || props.loading} onClick={() => void props.onConfirmImport()}>{text('按预览版本确认保存', 'Confirm using preview version')}</Button>
          </footer>
        </div>
      </div>}
      {showCandidates && <section className="blueprint-planning-editor__subpanel"><h3>{text('规划候选', 'Planning candidates')}</h3><BlueprintPlanningCandidatePanel candidates={props.candidates} currentMarkdown={props.currentMarkdown} busyOperationId={props.busyOperationId} onConfirm={props.onConfirmCandidate} onUpdate={props.onUpdateCandidate} onCancel={props.onCancelCandidate} /></section>}
      {showChecks && <section className="blueprint-planning-editor__subpanel"><h3>{text('衔接检查', 'Connection checks')}</h3><BlueprintPlanningChecks checks={props.checks} /></section>}
    </section>
  )
}

export interface BlueprintPlanningCandidateView {
  operationId: string
  kind: string
  state: string
  payloadHash: string
  candidate: unknown
  sourceSummary: string
}

export interface BlueprintPlanningCandidatePanelProps {
  candidates: BlueprintPlanningCandidateView[]
  currentMarkdown?: string
  onConfirm(candidate: BlueprintPlanningCandidateView, editedJson: string, selected: { volumeIds: string[]; chapterNumbers: number[] }): Promise<void>
  onUpdate(candidate: BlueprintPlanningCandidateView, editedJson: string): Promise<boolean>
  onCancel(operationId: string): Promise<void>
  busyOperationId: string | null
}

export function BlueprintPlanningCandidatePanel({ candidates, currentMarkdown, onConfirm, onUpdate, onCancel, busyOperationId }: BlueprintPlanningCandidatePanelProps) {
  const text = useLocaleStore(state => state.text)
  if (candidates.length === 0) return <p className="blueprint-planning__muted">{text('生成结果将在这里以候选显示；确认前不会写入正式规划。', 'Generated results appear here as candidates; they do not become formal plans until confirmed.')}</p>
  return (
    <div className="blueprint-planning-candidates" data-testid="blueprint-planning-candidates">
      {candidates.map(candidate => (
        <CandidateEditor key={candidate.operationId} candidate={candidate} currentMarkdown={currentMarkdown} busy={busyOperationId === candidate.operationId} onConfirm={(edited, selected) => onConfirm(candidate, edited, selected)} onUpdate={edited => onUpdate(candidate, edited)} onCancel={() => onCancel(candidate.operationId)} />
      ))}
    </div>
  )
}

function CandidateEditor({ candidate, currentMarkdown, busy, onConfirm, onUpdate, onCancel }: {
  candidate: BlueprintPlanningCandidateView
  currentMarkdown?: string
  busy: boolean
  onConfirm(editedJson: string, selected: { volumeIds: string[]; chapterNumbers: number[] }): Promise<void>
  onUpdate(editedJson: string): Promise<boolean>
  onCancel(): Promise<void>
}) {
  const text = useLocaleStore(state => state.text)
  const [json, setJson] = useState(() => JSON.stringify(candidate.candidate, null, 2))
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(candidate.candidate, null, 2))
  const [selectedVolumeIds, setSelectedVolumeIds] = useState<string[]>([])
  const [selectedChapterNumbers, setSelectedChapterNumbers] = useState<number[]>([])
  const parsed = useMemo(() => {
    try { JSON.parse(json); return true } catch { return false }
  }, [json])
  const candidateData = useMemo(() => parsed
    ? JSON.parse(json) as { markdown?: string; volumes?: Array<{ volumeId?: string; name?: string; isNew?: boolean }>; chapters?: Array<{ chapterNumber?: number; title?: string; purpose?: string; keyEvents?: string }> }
    : {}, [json, parsed])
  const volumeRows = candidate.kind === 'volume-plan' ? (candidateData.volumes ?? []).filter(row => row.volumeId) : []
  const chapterRows = candidate.kind === 'chapter-plan' ? (candidateData.chapters ?? []).filter(row => Number.isInteger(row.chapterNumber) && (row.chapterNumber ?? 0) > 0) : []
  return (
    <article className="blueprint-planning-candidates__item" data-operation-id={candidate.operationId}>
      <header>
        <div><strong>{candidate.kind}</strong><span className="blueprint-planning__badge">{candidate.state}</span></div>
        <code>{candidate.operationId}</code>
      </header>
      <p className="blueprint-planning__muted">{candidate.sourceSummary}</p>
      {parsed && <section className="blueprint-planning-candidates__preview" data-testid="blueprint-planning-candidate-preview">
        <h4>{text('候选预览', 'Candidate preview')}</h4>
        {typeof candidateData.markdown === 'string' && (candidate.kind === 'book-outline' || candidate.kind === 'volume-outline')
          ? <>
            <p className="blueprint-planning-candidates__comparison-status">{currentMarkdown === candidateData.markdown ? text('候选与当前正文一致', 'Candidate matches the current body') : text('当前正文与候选不同；确认前请逐段审阅', 'Candidate differs from the current body; review it before confirming')}</p>
            <div className="blueprint-planning-candidates__comparison" data-testid="blueprint-planning-outline-comparison">
              <section><h5>{text('当前正式正文', 'Current authoritative body')}</h5><pre data-testid="blueprint-planning-current-outline">{currentMarkdown || text('当前正文为空', 'Current body is empty')}</pre></section>
              <section><h5>{text('候选正文', 'Candidate body')}</h5><pre data-testid="blueprint-planning-candidate-outline">{candidateData.markdown || text('候选 Markdown 为空', 'Candidate Markdown is empty')}</pre></section>
            </div>
          </>
          : typeof candidateData.markdown === 'string'
            ? <pre>{candidateData.markdown || text('候选 Markdown 为空', 'Candidate Markdown is empty')}</pre>
          : candidate.kind === 'volume-plan'
            ? <ul>{volumeRows.map((volume, index) => <li key={`${volume.volumeId}-${index}`}><strong>{volume.name || volume.volumeId}</strong><span>{volume.isNew ? text('新建卷', 'New volume') : text('更新现有卷', 'Update existing volume')}</span><small>{volume.volumeId}</small></li>)}</ul>
            : candidate.kind === 'chapter-plan'
              ? <ol>{chapterRows.map((chapter, index) => <li key={`${chapter.chapterNumber}-${index}`}><strong>{text(`第 ${chapter.chapterNumber} 章`, `Chapter ${chapter.chapterNumber}`)} · {chapter.title || text('未命名', 'Untitled')}</strong>{chapter.purpose && <p>{chapter.purpose}</p>}{chapter.keyEvents && <p>{chapter.keyEvents}</p>}</li>)}</ol>
              : <pre>{JSON.stringify(candidateData, null, 2)}</pre>}
      </section>}
      <label className="blueprint-planning__label">{text('候选内容（可编辑 JSON）', 'Candidate (editable JSON)')}</label>
      <Textarea value={json} onChange={event => setJson(event.target.value)} rows={Math.min(22, Math.max(7, json.split('\n').length))} className="blueprint-planning-candidates__json" aria-label={text('编辑候选 JSON', 'Edit candidate JSON')} />
      {!parsed && <p className="blueprint-planning__error" role="alert">{text('JSON 格式有误，修复后才能确认。', 'Invalid JSON. Fix it before confirming.')}</p>}
      {volumeRows.length > 0 && <fieldset className="blueprint-planning-candidates__selection"><legend>{text('选择要提交的卷', 'Select volumes to commit')}</legend>{volumeRows.map((volume, index) => <label key={`${volume.volumeId}-${index}`}><input type="checkbox" checked={selectedVolumeIds.includes(volume.volumeId!)} onChange={event => setSelectedVolumeIds(current => event.target.checked ? [...new Set([...current, volume.volumeId!])] : current.filter(id => id !== volume.volumeId))} /><span>{volume.name || volume.volumeId}</span><small>{volume.isNew ? text('新建卷', 'New') : text('更新现有卷', 'Existing')}</small><code>{volume.volumeId}</code></label>)}</fieldset>}
      {chapterRows.length > 0 && <fieldset className="blueprint-planning-candidates__selection"><legend>{text('选择要提交的章节（全书唯一章号）', 'Select chapters to commit (globally unique numbers)')}</legend>{chapterRows.map((chapter, index) => <label key={`${chapter.chapterNumber}-${index}`}><input type="checkbox" checked={selectedChapterNumbers.includes(chapter.chapterNumber!)} onChange={event => setSelectedChapterNumbers(current => event.target.checked ? [...new Set([...current, chapter.chapterNumber!])] : current.filter(number => number !== chapter.chapterNumber))} /><span>{text(`第 ${chapter.chapterNumber} 章`, `Chapter ${chapter.chapterNumber}`)} · {chapter.title || text('未命名', 'Untitled')}</span></label>)}</fieldset>}
      <footer>
        <Button variant="ghost" size="sm" disabled={!parsed || busy || candidate.state !== 'candidate' || json === savedJson} onClick={async () => { if (await onUpdate(json)) setSavedJson(json) }}>{text('保存候选修改', 'Save candidate edits')}</Button>
        <Button variant="outline" size="sm" disabled={!parsed || busy || candidate.state !== 'candidate' || (candidate.kind === 'volume-plan' && selectedVolumeIds.length === 0) || (candidate.kind === 'chapter-plan' && selectedChapterNumbers.length === 0)} onClick={() => void onConfirm(json, { volumeIds: selectedVolumeIds, chapterNumbers: selectedChapterNumbers })}>{busy ? text('提交中…', 'Confirming…') : text('确认提交', 'Confirm')}</Button>
        <Button variant="ghost" size="sm" disabled={busy || candidate.state === 'committed' || candidate.state === 'cancelled'} onClick={() => void onCancel()}>{text('取消候选', 'Cancel candidate')}</Button>
      </footer>
    </article>
  )
}

export interface BlueprintChapterPlanningActionsProps {
  chapterNumber: number
  title: string
  candidates: BlueprintPlanningCandidateView[]
  busyOperationId: string | null
  workflowStarting: boolean
  onGenerate(): void
  onRefresh(): void
  onConfirmCandidate(candidate: BlueprintPlanningCandidateView, editedJson: string, selected: { volumeIds: string[]; chapterNumbers: number[] }): Promise<void>
  onUpdateCandidate(candidate: BlueprintPlanningCandidateView, editedJson: string): Promise<boolean>
  onCancelCandidate(operationId: string): Promise<void>
}

export function BlueprintChapterPlanningActions(props: BlueprintChapterPlanningActionsProps) {
  const text = useLocaleStore(state => state.text)
  const [showCandidates, setShowCandidates] = useState(false)
  return (
    <section className="blueprint-planning-chapter-actions" data-testid="blueprint-chapter-planning-actions">
      <div>
        <h3>{text('展开本章细纲', 'Expand this chapter outline')}</h3>
        <p>{text(`第 ${props.chapterNumber} 章 · ${props.title || '未命名'}：先生成可编辑候选，确认后才保存正式 v2 细纲。`, `Chapter ${props.chapterNumber} · ${props.title || 'Untitled'}: review an editable candidate before saving the formal v2 outline.`)}</p>
      </div>
      <div className="blueprint-planning-chapter-actions__buttons">
        <Button variant="ai" size="sm" disabled={props.workflowStarting} onClick={() => { setShowCandidates(true); props.onGenerate() }}><Sparkles size={13} />{props.workflowStarting ? text('启动中…', 'Starting…') : text('展开细纲候选', 'Generate detail candidate')}</Button>
        <Button variant="outline" size="sm" onClick={() => setShowCandidates(value => !value)}>{text(`候选（${props.candidates.length}）`, `Candidates (${props.candidates.length})`)}</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={props.onRefresh} title={text('刷新候选', 'Refresh candidates')} aria-label={text('刷新候选', 'Refresh candidates')}><RefreshCw size={13} /></Button>
      </div>
      {showCandidates && <div className="blueprint-planning-editor__subpanel"><BlueprintPlanningCandidatePanel candidates={props.candidates} busyOperationId={props.busyOperationId} onConfirm={props.onConfirmCandidate} onUpdate={props.onUpdateCandidate} onCancel={props.onCancelCandidate} /></div>}
    </section>
  )
}
