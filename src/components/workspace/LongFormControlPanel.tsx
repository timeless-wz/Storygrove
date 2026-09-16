import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, CalendarClock, Gauge, GitBranch, ListChecks, Sparkles } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useStoryDataStore } from '../../stores/story-data-store'
import { getActiveProjectSessionContext, sameProjectSessionContext } from '../../shared/project-session-context'
import { ipc } from '../../services/ipc-client'
import { storyDataService } from '../../services/story-data-service'
import { buildLongFormControlSnapshot } from '../../shared/long-form-control'

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string | number; detail?: string }) {
  return <div className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex items-center gap-2 text-[11px] opacity-75">{icon}{label}</div><div className="text-xl font-semibold mt-2">{value}</div>{detail && <div className="text-[11px] opacity-60 mt-1">{detail}</div>}</div>
}

export default function LongFormControlPanel() {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const { facts } = useStoryDataStore()
  const [chapters, setChapters] = useState<Array<{ chapterNumber: number; content: string; wordCount?: number }>>([])
  const [impacts, setImpacts] = useState<Array<{ chapterNumber: number; impactType?: string; factId?: string }>>([])
  const projectPath = project?.path
  const projectId = project?.id
  const projectLease = project?.sessionLease
  useEffect(() => {
    const session = getActiveProjectSessionContext()
    let cancelled = false
    if (!projectPath || !session) {
      void Promise.resolve().then(() => {
        if (!cancelled) { setChapters([]); setImpacts([]) }
      })
      return () => { cancelled = true }
    }
    void Promise.all([
      ipc.invokeWithProjectSession(session, 'db:draft-list-all', session.projectPath),
      storyDataService.listImpacts(session),
    ]).then(async ([drafts, nextImpacts]) => {
      const finalized = drafts.filter(draft => draft.status === 'finalized')
      const full = await Promise.all(finalized.map(async draft => {
        const body = await ipc.invokeWithProjectSession(session, 'db:draft-get-full', draft.id, session.projectPath)
        return { chapterNumber: draft.chapterNumber, content: body?.content ?? '', wordCount: draft.wordCount }
      }))
      if (!cancelled && sameProjectSessionContext(session, getActiveProjectSessionContext())) {
        setChapters(full)
        setImpacts(nextImpacts.map(impact => ({ chapterNumber: impact.chapterNumber, impactType: impact.impactType, factId: impact.factId })))
      }
    }).catch(() => { if (!cancelled) { setChapters([]); setImpacts([]) } })
    return () => { cancelled = true }
  }, [projectId, projectLease, projectPath])
  const snapshot = useMemo(() => buildLongFormControlSnapshot({ totalChapters: project?.novelConfig.totalChapters ?? 1, wordsPerChapter: project?.novelConfig.wordsPerChapter ?? 1, facts, chapters, impacts }), [facts, project, chapters, impacts])
  const progress = snapshot.totalChapters > 0 ? Math.min(100, Math.round((snapshot.latestTimelineChapter ?? 0) / snapshot.totalChapters * 100)) : 0
  return <div className="h-full overflow-auto p-4 space-y-4" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-editor-bg)' }}>
    <div><div className="flex items-center gap-2 text-sm font-semibold"><Gauge size={16} style={{ color: 'var(--color-accent)' }} />{text('长篇叙事控制台', 'Long-form narrative console')}</div><p className="text-[11px] opacity-70 mt-1">{text('只统计已确认故事资料；用于观察主线、暗线、伏笔和全书推进，不会直接改写正文。', 'Authoritative facts only. Observe story-line, thread, foreshadowing, and book progress without rewriting prose.')}</p></div>
    <div className="rounded border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex justify-between text-xs"><span>{text('时间轴覆盖进度', 'Timeline coverage')}</span><span>{progress}% · {snapshot.latestTimelineChapter ? text(`推进至第${snapshot.latestTimelineChapter}章`, `Through Chapter ${snapshot.latestTimelineChapter}`) : text('暂无事件', 'No events')}</span></div><div className="h-2 rounded-full mt-2" style={{ backgroundColor: 'var(--color-bg-elevated)' }}><div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: 'var(--color-accent)' }} /></div></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2"><Metric icon={<ListChecks size={13} />} label={text('计划总字数', 'Planned words')} value={snapshot.plannedWords.toLocaleString()} detail={`${snapshot.totalChapters} ${text('章', 'chapters')} × ${project?.novelConfig.wordsPerChapter ?? 0}`} /><Metric icon={<CalendarClock size={13} />} label={text('定稿进度', 'Finalized progress')} value={`${snapshot.completedChapters}/${snapshot.totalChapters}`} detail={text(`${snapshot.actualWords.toLocaleString()} 实际字数`, `${snapshot.actualWords.toLocaleString()} actual words`)} /><Metric icon={<GitBranch size={13} />} label={text('活跃叙事线', 'Active threads')} value={snapshot.activeNarrativeThreads} detail={text(`休眠 ${snapshot.dormantNarrativeThreads} · 已回收 ${snapshot.resolvedNarrativeThreads}`, `${snapshot.dormantNarrativeThreads} dormant · ${snapshot.resolvedNarrativeThreads} resolved`)} /><Metric icon={<Sparkles size={13} />} label={text('未回收伏笔', 'Open foreshadowing')} value={snapshot.foreshadowingOpen} detail={text(`共 ${snapshot.foreshadowingTotal} 条`, `${snapshot.foreshadowingTotal} total`)} /></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="flex items-center gap-2 font-medium"><Activity size={13} />{text('长期推进信号', 'Long-range signals')}</div><div className="mt-2 space-y-1 opacity-80"><div>{text('已确认资料', 'Confirmed facts')}：{snapshot.confirmedFacts}</div><div>{text('被资料影响的章节', 'Chapters with tracked impacts')}：{snapshot.impactedChapters}</div><div>{text('低信息连续章节', 'Low-information streaks')}：{snapshot.lowInformationStreaks.length === 0 ? text('无', 'None') : snapshot.lowInformationStreaks.map(item => `第${item.fromChapter}-${item.toChapter}章`).join('、')}</div><div>{text('缺少章末钩子的定稿', 'Finalized chapters without hook')}：{snapshot.hookMissingChapters.length === 0 ? text('无', 'None') : snapshot.hookMissingChapters.map(number => `第${number}章`).join('、')}</div></div></div><div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}><div className="font-medium">{text('密度与长期提醒', 'Density and long-term reminders')}</div><div className="mt-2 space-y-1 opacity-80">{snapshot.densities.map(item => <div key={item.category}>{item.category}：{item.chapterNumbers.length} {text('章', 'chapters')} · {(item.density * 100).toFixed(0)}%</div>)}{snapshot.reminders.map(reminder => <div key={`${reminder.kind}-${reminder.factId}`}>{reminder.kind === 'foreshadowing' ? text('伏笔', 'Foreshadowing') : text('配角', 'Supporting character')}「{reminder.name}」{text(`自第${reminder.lastChapter}章未推进`, `not advanced since Chapter ${reminder.lastChapter}`)}</div>)}</div><div className="mt-2 opacity-80">{snapshot.foreshadowingOpen > 0 ? text('优先检查未回收伏笔，确认下一次推进或回收章节。', 'Review open foreshadowing and assign its next progress or payoff chapter.') : text('伏笔当前均已回收或废止，可继续检查人物线和卷级承诺。', 'Foreshadowing is resolved or retired; review character lines and volume promises next.')}</div></div></div>
  </div>
}
