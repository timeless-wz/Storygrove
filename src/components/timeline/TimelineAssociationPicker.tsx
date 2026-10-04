/**
 * TimelineAssociationPicker — 事件表单的章节/人物关联选择（任务 B）。
 *
 * - 章节候选只读项目蓝图「章级摘要」与卷列表（db:blueprint-list-summary、
 *   db:blueprint-v2-summary-list、db:blueprint-volume-list），是有界数据，
 *   绝不全量加载蓝图 Markdown 正文；
 * - 卷筛选只使用候选自带的 volumeId，绝不凭章号推测卷归属；
 * - 人物候选只读 db:character-roster-read 的只读快照，不写角色商店；
 * - 既有手写角色名与无效旧关联始终保留：候选读取成功但不含该值时以
 *   「未找到」徽标标注，移除必须由作者显式点击，绝不静默删除；
 * - 搜索无结果、候选读取失败都显示真实状态，并提供重试入口；
 * - 搜索框回车可添加候选之外的章号/角色名，保留手写能力。
 */

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { DatabaseChannels } from '../../shared/ipc-channels'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import './timeline-floating-panel.css'

type BlueprintListSummary = DatabaseChannels['db:blueprint-list-summary']['return'][number]
type ChapterBlueprintV2Summary = DatabaseChannels['db:blueprint-v2-summary-list']['return'][number]
type BlueprintVolumeRow = DatabaseChannels['db:blueprint-volume-list']['return'][number]

type CandidateLoadState = 'loading' | 'ready' | 'error'

interface ChapterCandidate {
  chapterNumber: number
  title: string
  volumeId?: string
}

interface CharacterCandidate {
  name: string
  role: string
}

function isLoadFailurePayload(payload: unknown): boolean {
  // 通道异常兜底（例如测试/旧环境返回 { success:false }）按失败处理，
  // 绝不把非数组载荷当成“零候选”进而给旧关联扣上“未找到”。
  return Array.isArray(payload) === false
}

function AssociationChip({
  label,
  missing,
  onRemove,
  removeLabel,
  testId,
}: {
  label: string
  missing: boolean
  onRemove: () => void
  removeLabel: string
  testId: string
}) {
  const text = useLocaleText()
  return (
    <span className="writer-timeline-assoc-chip" data-testid={testId} data-missing={missing || undefined}>
      <span className="writer-timeline-assoc-chip-label">{label}</span>
      {missing && (
        <span className="writer-timeline-assoc-chip-missing" title={label}>
          {text('未找到', 'Not found')}
        </span>
      )}
      <button
        type="button"
        className="writer-timeline-assoc-chip-remove"
        aria-label={`${removeLabel}：${label}`}
        onClick={onRemove}
      >
        <X size={11} />
      </button>
    </span>
  )
}

function useLocaleText() {
  return useLocaleStore(s => s.text)
}

function MissingHint({ ready, count }: { ready: boolean; count: number }) {
  const text = useLocaleText()
  if (!ready) {
    return (
      <small className="writer-timeline-assoc-hint" data-testid="timeline-assoc-candidates-unavailable">
        {text('候选读取失败，已保留现有关联。', 'Candidates could not be loaded; existing links are kept.')}
      </small>
    )
  }
  if (count === 0) {
    return (
      <small className="writer-timeline-assoc-hint">
        {text('尚无候选数据，可直接输入后回车添加。', 'No candidates yet; type and press Enter to add.')}
      </small>
    )
  }
  return null
}

// ============================================================
// 章节关联：真实卷筛选 + 章号/标题搜索 + 多选
// ============================================================

export interface TimelineChapterPickerProps {
  value: number[]
  onChange: (next: number[]) => void
  /** 编辑开始时事件已关联的章号：候选缺失的旧值据此标注“未找到”。 */
  initial?: number[]
}

export function TimelineChapterPicker({ value, onChange, initial = [] }: TimelineChapterPickerProps) {
  const text = useLocaleText()
  const currentProject = useProjectStore(s => s.currentProject)
  const [state, setState] = useState<CandidateLoadState>(currentProject ? 'loading' : 'error')
  const [candidates, setCandidates] = useState<ChapterCandidate[]>([])
  const [volumes, setVolumes] = useState<BlueprintVolumeRow[]>([])
  const [volumeFilter, setVolumeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const [renderedProject, setRenderedProject] = useState(currentProject)
  const [renderedRetry, setRenderedRetry] = useState(retry)
  if (renderedProject !== currentProject || renderedRetry !== retry) {
    setRenderedProject(currentProject)
    setRenderedRetry(retry)
    setState(currentProject ? 'loading' : 'error')
  }

  useEffect(() => {
    let cancelled = false
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) {
      if (currentProject) {
        void Promise.resolve().then(() => {
          if (!cancelled) setState('error')
        })
      }
      return () => { cancelled = true }
    }
    void Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-list-summary', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-summary-list', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-list', projectSession.projectPath),
    ])
      .then(([legacyItems, v2Summaries, volumeRows]) => {
        if (cancelled || !isProjectSessionCurrent(projectSession)) return
        if (isLoadFailurePayload(legacyItems) || isLoadFailurePayload(v2Summaries) || isLoadFailurePayload(volumeRows)) {
          setState('error')
          return
        }
        // 只合并章号/标题/卷 ID 摘要；v2 摘要补齐缺少的章，不读取正文。
        const byChapter = new Map<number, ChapterCandidate>()
        for (const item of legacyItems as BlueprintListSummary[]) {
          byChapter.set(item.chapterNumber, { chapterNumber: item.chapterNumber, title: item.title ?? '', volumeId: item.volumeId })
        }
        for (const summary of v2Summaries as ChapterBlueprintV2Summary[]) {
          if (!byChapter.has(summary.chapterNumber)) {
            byChapter.set(summary.chapterNumber, {
              chapterNumber: summary.chapterNumber,
              title: summary.sceneTitles[0] ?? '',
            })
          }
        }
        setCandidates([...byChapter.values()].sort((a, b) => a.chapterNumber - b.chapterNumber))
        setVolumes([...(volumeRows as BlueprintVolumeRow[])].sort((a, b) => a.sortOrder - b.sortOrder))
        setState('ready')
      })
      .catch(() => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [currentProject, retry])

  const candidateByChapter = useMemo(
    () => new Map(candidates.map(item => [item.chapterNumber, item])),
    [candidates],
  )
  const hasUnassigned = useMemo(
    () => candidates.some(item => !item.volumeId || !volumes.some(volume => volume.id === item.volumeId)),
    [candidates, volumes],
  )
  const volumeKeyOf = (volumeId?: string) =>
    volumeId && volumes.some(volume => volume.id === volumeId) ? `volume:${volumeId}` : 'unassigned'
  const volumeName = (volumeId?: string) =>
    volumes.find(volume => volume.id === volumeId)?.name ?? text('未归卷', 'Unassigned')

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filtered = candidates.filter(item => {
    if (volumeFilter !== 'all' && volumeKeyOf(item.volumeId) !== volumeFilter) return false
    if (!normalizedSearch) return true
    const haystack = `${item.chapterNumber} 第${item.chapterNumber}章 ${item.title}`.toLocaleLowerCase()
    return haystack.includes(normalizedSearch)
  })

  const toggleChapter = (chapterNumber: number) => {
    onChange(value.includes(chapterNumber)
      ? value.filter(item => item !== chapterNumber)
      : [...value, chapterNumber])
  }
  const commitCustomChapter = () => {
    const parsed = Number(search.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) return
    if (!value.includes(parsed)) onChange([...value, parsed])
    setSearch('')
  }

  return (
    <div className="writer-timeline-field" data-testid="timeline-chapter-picker">
      <span>{text('关联章节', 'Linked chapters')}</span>

      {value.length > 0 && (
        <div className="writer-timeline-assoc-chips">
          {value.map(chapterNumber => {
            const candidate = candidateByChapter.get(chapterNumber)
            const missing = state === 'ready' && !candidate && initial.includes(chapterNumber)
            return (
              <AssociationChip
                key={chapterNumber}
                testId="timeline-chapter-chip"
                label={text(`第${chapterNumber}章`, `Ch.${chapterNumber}`)}
                missing={missing}
                onRemove={() => onChange(value.filter(item => item !== chapterNumber))}
                removeLabel={text('移除章节', 'Remove chapter')}
              />
            )
          })}
        </div>
      )}

      <div className="writer-timeline-assoc-filters">
        <div className="writer-timeline-assoc-volume">
          <NativeSelect
            aria-label={text('按卷筛选', 'Filter by volume')}
            value={volumeFilter}
            onChange={e => setVolumeFilter(e.target.value)}
            disabled={state !== 'ready'}
          >
            <option value="all">{text('全部卷', 'All volumes')}</option>
            {volumes.map(volume => (
              <option key={volume.id} value={`volume:${volume.id}`}>{volume.name}</option>
            ))}
            {hasUnassigned && <option value="unassigned">{text('未归卷', 'Unassigned')}</option>}
          </NativeSelect>
        </div>
        <div className="writer-timeline-assoc-search">
          <Search size={13} aria-hidden="true" />
          <Input
            value={search}
            data-testid="timeline-chapter-search"
            aria-label={text('搜索章号或标题', 'Search chapter number or title')}
            placeholder={text('章号或标题，回车添加候选外的章号', 'Number or title; Enter adds a custom chapter')}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitCustomChapter()
              }
            }}
          />
        </div>
      </div>

      <div className="writer-timeline-assoc-list" role="group" aria-label={text('章节候选', 'Chapter candidates')}>
        {state === 'loading' && (
          <p className="writer-timeline-assoc-empty" role="status">{text('正在读取章节候选…', 'Loading chapters…')}</p>
        )}
        {state === 'error' && (
          <div className="writer-timeline-assoc-empty" role="alert">
            <p>{text('章节候选读取失败，现有关联已保留。', 'Could not load chapters; existing links are kept.')}</p>
            <button
              type="button"
              className="writer-timeline-assoc-retry"
              data-testid="timeline-chapter-retry"
              onClick={() => setRetry(n => n + 1)}
            >
              {text('重试', 'Retry')}
            </button>
          </div>
        )}
        {state === 'ready' && filtered.length === 0 && (
          <p className="writer-timeline-assoc-empty" data-testid="timeline-chapter-empty">
            {candidates.length === 0
              ? text('项目中还没有章节蓝图，可直接输入章号后回车添加。', 'No chapter blueprints yet; type a number and press Enter.')
              : text('没有匹配的章节，试试其他卷、章号或标题。', 'No matching chapters. Try another volume, number or title.')}
          </p>
        )}
        {state === 'ready' && filtered.map(item => (
          <label key={item.chapterNumber} className="writer-timeline-assoc-row" data-testid="timeline-chapter-option">
            <input
              type="checkbox"
              checked={value.includes(item.chapterNumber)}
              onChange={() => toggleChapter(item.chapterNumber)}
            />
            <span className="writer-timeline-assoc-row-title">
              {text(`第${item.chapterNumber}章`, `Ch.${item.chapterNumber}`)}
              {item.title ? ` · ${item.title}` : ''}
            </span>
            <span className="writer-timeline-assoc-row-volume">{volumeName(item.volumeId)}</span>
          </label>
        ))}
      </div>

      {state === 'ready' && candidates.length > 0 && (
        <small className="writer-timeline-assoc-hint" aria-live="polite">
          {text(`${filtered.length} / ${candidates.length} 章`, `${filtered.length} / ${candidates.length} chapters`)}
        </small>
      )}
      <MissingHint ready={state === 'error'} count={candidates.length} />
    </div>
  )
}

// ============================================================
// 人物关联：名册搜索选择 + 手写名保留
// ============================================================

export interface TimelineCharacterPickerProps {
  value: string[]
  onChange: (next: string[]) => void
  /** 编辑开始时事件已关联的角色名：名册缺失的旧值据此标注“未找到”。 */
  initial?: string[]
}

export function TimelineCharacterPicker({ value, onChange, initial = [] }: TimelineCharacterPickerProps) {
  const text = useLocaleText()
  const currentProject = useProjectStore(s => s.currentProject)
  const [state, setState] = useState<CandidateLoadState>(currentProject ? 'loading' : 'error')
  const [candidates, setCandidates] = useState<CharacterCandidate[]>([])
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const [renderedProject, setRenderedProject] = useState(currentProject)
  const [renderedRetry, setRenderedRetry] = useState(retry)
  if (renderedProject !== currentProject || renderedRetry !== retry) {
    setRenderedProject(currentProject)
    setRenderedRetry(retry)
    setState(currentProject ? 'loading' : 'error')
  }

  useEffect(() => {
    let cancelled = false
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) {
      if (currentProject) {
        void Promise.resolve().then(() => {
          if (!cancelled) setState('error')
        })
      }
      return () => { cancelled = true }
    }
    void ipc.invokeWithProjectSession(projectSession, 'db:character-roster-read', projectSession.projectPath)
      .then(snapshot => {
        if (cancelled || !isProjectSessionCurrent(projectSession)) return
        const entries = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : []
        const seen = new Set<string>()
        const roster: CharacterCandidate[] = []
        for (const entry of entries) {
          const name = entry.name.trim()
          if (!name || seen.has(name)) continue
          seen.add(name)
          roster.push({ name, role: entry.role ?? '' })
        }
        setCandidates(roster)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [currentProject, retry])

  const rosterNames = useMemo(() => new Set(candidates.map(item => item.name)), [candidates])
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filtered = normalizedSearch
    ? candidates.filter(item => item.name.toLocaleLowerCase().includes(normalizedSearch))
    : candidates

  const toggleCharacter = (name: string) => {
    onChange(value.includes(name) ? value.filter(item => item !== name) : [...value, name])
  }
  const commitCustomCharacter = () => {
    const name = search.trim()
    if (!name) return
    if (!value.includes(name)) onChange([...value, name])
    setSearch('')
  }

  return (
    <div className="writer-timeline-field" data-testid="timeline-character-picker">
      <span>{text('涉及角色', 'Characters')}</span>

      {value.length > 0 && (
        <div className="writer-timeline-assoc-chips">
          {value.map(name => {
            const missing = state === 'ready' && !rosterNames.has(name) && initial.includes(name)
            return (
              <AssociationChip
                key={name}
                testId="timeline-character-chip"
                label={name}
                missing={missing}
                onRemove={() => onChange(value.filter(item => item !== name))}
                removeLabel={text('移除角色', 'Remove character')}
              />
            )
          })}
        </div>
      )}

      <div className="writer-timeline-assoc-search">
        <Search size={13} aria-hidden="true" />
        <Input
          value={search}
          data-testid="timeline-character-search"
          aria-label={text('搜索或添加角色名', 'Search or add a character name')}
          placeholder={text('搜索角色，回车添加手写名', 'Search characters; Enter adds a handwritten name')}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitCustomCharacter()
            }
          }}
        />
      </div>

      <div className="writer-timeline-assoc-list" role="group" aria-label={text('角色候选', 'Character candidates')}>
        {state === 'loading' && (
          <p className="writer-timeline-assoc-empty" role="status">{text('正在读取角色名册…', 'Loading characters…')}</p>
        )}
        {state === 'error' && (
          <div className="writer-timeline-assoc-empty" role="alert">
            <p>{text('角色名册读取失败，现有关联已保留。', 'Could not load characters; existing links are kept.')}</p>
            <button
              type="button"
              className="writer-timeline-assoc-retry"
              data-testid="timeline-character-retry"
              onClick={() => setRetry(n => n + 1)}
            >
              {text('重试', 'Retry')}
            </button>
          </div>
        )}
        {state === 'ready' && filtered.length === 0 && (
          <p className="writer-timeline-assoc-empty" data-testid="timeline-character-empty">
            {candidates.length === 0
              ? text('角色名册为空，可直接输入角色名后回车添加。', 'The roster is empty; type a name and press Enter.')
              : text('没有匹配的角色，回车可添加手写名。', 'No matching characters; press Enter to add a handwritten name.')}
          </p>
        )}
        {state === 'ready' && filtered.map(item => (
          <label key={item.name} className="writer-timeline-assoc-row" data-testid="timeline-character-option">
            <input
              type="checkbox"
              checked={value.includes(item.name)}
              onChange={() => toggleCharacter(item.name)}
            />
            <span className="writer-timeline-assoc-row-title">{item.name}</span>
            {item.role && <span className="writer-timeline-assoc-row-volume">{item.role}</span>}
          </label>
        ))}
      </div>

      {state === 'ready' && candidates.length > 0 && (
        <small className="writer-timeline-assoc-hint" aria-live="polite">
          {text(`${filtered.length} / ${candidates.length} 名角色`, `${filtered.length} / ${candidates.length} characters`)}
        </small>
      )}
      <MissingHint ready={state === 'error'} count={candidates.length} />
    </div>
  )
}
