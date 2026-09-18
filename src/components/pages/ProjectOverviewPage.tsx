import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  Compass,
  GitBranch,
  BookOpen,
  PenTool,
  Clock3,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useDraftStore } from '../../stores/draft-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession } from '../project-session-gate'
import type { ChapterBlueprint } from '../../services/workflows/directory-workflow'

export default function ProjectOverviewPage() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const nodes = useWorldMapStore(s => s.nodes)
  const edges = useWorldMapStore(s => s.edges)
  const loadWorldMap = useWorldMapStore(s => s.loadAll)
  const timelineEvents = useStoryTimelineStore(s => s.events)
  const timelineDataProjectKey = useStoryTimelineStore(s => s.dataProjectKey)
  const loadStoryTimeline = useStoryTimelineStore(s => s.loadAll)

  const [blueprints, setBlueprints] = useState<ChapterBlueprint[]>([])

  const projectPath = currentProject?.path
  const totalChapters = currentProject?.novelConfig?.totalChapters ?? 58
  const wordsPerChapter = currentProject?.novelConfig?.wordsPerChapter ?? 3000
  const expectedTotalWords = totalChapters * wordsPerChapter

  // 加载世界地图和章节蓝图
  useEffect(() => {
    if (!projectPath) return
    void loadWorldMap(projectPath)

    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return

    let cancelled = false
    ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get-all', projectPath)
      .then((res: unknown) => {
        if (!cancelled && Array.isArray(res)) {
          setBlueprints(res as ChapterBlueprint[])
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [projectPath, currentProject, loadWorldMap])

  // 总览中的时间线卡要反映项目自己的真实事件数量，而不是静态入口。
  useEffect(() => {
    if (!projectPath || timelineDataProjectKey === projectPath) return
    void loadStoryTimeline(projectPath)
  }, [projectPath, timelineDataProjectKey, loadStoryTimeline])

  // 统计草稿与已写字数
  const { draftedChaptersCount, totalDraftedWords } = useMemo(() => {
    let draftedCount = 0
    let words = 0
    for (const drafts of Object.values(draftsByChapter)) {
      if (drafts && drafts.length > 0) {
        draftedCount++
        const latest = drafts[0]
        words += (latest.wordCount ?? 0)
      }
    }
    return { draftedChaptersCount: draftedCount, totalDraftedWords: words }
  }, [draftsByChapter])

  // 地下与遗境等特殊地点统计
  const specialNodes = useMemo(() => {
    return nodes.filter(n => n.mapLayer === 'underground' || n.mapLayer === 'astral' || n.type === 'relic')
  }, [nodes])

  const timelineSummary = useMemo(() => ({
    planned: timelineEvents.filter(event => event.status === 'planned').length,
    drafted: timelineEvents.filter(event => event.status === 'drafted').length,
    finalized: timelineEvents.filter(event => event.status === 'finalized').length,
  }), [timelineEvents])

  // 打开世界地图
  const handleOpenWorldMap = () => {
    if (!projectPath) return
    openBuiltinEditor('world-map-editor', text('世界地图', 'World map'), 'world-map')
  }

  // 打开剧情树
  const handleOpenPlotTree = () => {
    if (!projectPath) return
    openBuiltinEditor('narrative-thread-editor', text('伏笔与叙事线索', 'Foreshadowing & narrative threads'), 'narrative-thread', 'plot-tree')
  }

  // 打开章节蓝图
  const handleOpenBlueprints = () => {
    if (!projectPath) return
    openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card')
  }

  const handleOpenStoryTimeline = () => {
    if (!projectPath) return
    openBuiltinEditor('story-timeline-editor', text('故事时间线', 'Story timeline'), 'story-timeline')
  }

  // 开始/继续写正文
  const handleResumeDrafting = () => {
    if (!projectPath) return
    // 寻找第一个有草稿的章节，或者第 1 章
    for (let i = 1; i <= totalChapters; i++) {
      const chapterDrafts = draftsByChapter[i]
      if (chapterDrafts && chapterDrafts.length > 0) {
        const latest = chapterDrafts[0]
        useEditorStore.getState().openFile({
          id: latest.filePath,
          name: latest.fileName || `第 ${i} 章草稿`,
          type: 'chapter',
          filePath: latest.filePath,
          chapterNumber: i,
          draftId: latest.id,
          projectKey: projectPath,
        })
        return
      }
    }
    // 若暂无草稿，打开章节蓝图以便新建
    handleOpenBlueprints()
  }

  /** 功能卡片与其底部行动按钮指向同一入口；卡片本身也可被键盘激活。 */
  const activateCardOnKey = (event: KeyboardEvent<HTMLDivElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

  return (
    <div
      className="h-full overflow-y-auto p-6 md:p-8"
      style={{ backgroundColor: 'var(--color-editor-bg)', color: 'var(--color-text)' }}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 顶部 Hero 欢迎与状态栏 */}
        <Card className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: 'rgba(var(--color-accent-rgb), 0.10)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {text('Codex 创作工作台', 'Codex Creative Workbench')}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {currentProject?.novelConfig?.genre || text('长篇小说', 'Fiction')}
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                {currentProject?.name || text('未命名小说项目', 'Untitled Novel')}
              </h1>
              <p className="text-xs mt-1 text-[var(--color-text-secondary)]">
                {text(
                  '纯粹由作者主导的创作空间：世界地图、章节蓝图、直接码字、只读审核。',
                  'Author-driven fiction workspace: World map, blueprints, prose writing, read-only audit.',
                )}
              </p>
            </div>

            {/* 快速直达按钮组 */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="default" size="sm" onClick={handleResumeDrafting}>
                <PenTool size={13} />
                {text('直接写正文', 'Write prose')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenWorldMap}>
                <Compass size={13} />
                {text('世界地图', 'World map')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenPlotTree}>
                <GitBranch size={13} />
                {text('剧情树', 'Plot tree')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenStoryTimeline}>
                <Clock3 size={13} />
                {text('故事时间线', 'Story timeline')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenBlueprints}>
                <BookOpen size={13} />
                {text('章节细纲', 'Blueprints')}
              </Button>
            </div>
          </div>

          {/* 进度统计条 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-[var(--color-border)]">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">{text('规划章节', 'Planned chapters')}</div>
              <div className="text-lg font-semibold mt-0.5 tabular-nums text-[var(--color-text)]">
                {blueprints.length} / {totalChapters} <span className="text-xs font-normal text-[var(--color-text-muted)]">{text('章', 'ch')}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">{text('已起草章节', 'Drafted chapters')}</div>
              <div className="text-lg font-semibold mt-0.5 tabular-nums text-[var(--color-text)]">
                {draftedChaptersCount} / {totalChapters} <span className="text-xs font-normal text-[var(--color-text-muted)]">{text('章', 'ch')}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">{text('正文字数统计', 'Drafted word count')}</div>
              <div className="text-lg font-semibold mt-0.5 tabular-nums text-[var(--color-text)]">
                {totalDraftedWords.toLocaleString()} <span className="text-xs font-normal text-[var(--color-text-muted)]">/ {expectedTotalWords.toLocaleString()} {text('字', 'words')}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">{text('世界地图节点', 'Map locations')}</div>
              <div className="text-lg font-semibold mt-0.5 tabular-nums text-[var(--color-text)]">
                {nodes.length} <span className="text-xs font-normal text-[var(--color-text-muted)]">{text('处地点', 'locations')}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* 核心功能卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 卡片 1: 世界地图 */}
          <Card
            role="button"
            tabIndex={0}
            aria-label={text('打开世界地图', 'Open world map')}
            onClick={handleOpenWorldMap}
            onKeyDown={(event) => activateCardOnKey(event, handleOpenWorldMap)}
            className="p-5 flex flex-col justify-between hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] cursor-pointer group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-accent)] border border-[var(--color-border)]">
                    <Compass size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{text('世界地图拓扑', 'World Map Topology')}</h3>
                    <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                      {text('可视化空间与势力网络', 'Spatial nodes and connections')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                  {nodes.length} {text('节点', 'nodes')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                {text(
                  '支持表世界/里世界等多图层切换，拖拽布局，节点连线与地理危险等级标注。正文写作时右侧自动联动所在地点规则。',
                  'Multi-layer spatial topology with interactive pan/zoom canvas, edges, and danger levels.',
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text(`路线连接: ${edges.length} 条`, `Routes: ${edges.length}`)}
                </span>
                {specialNodes.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                    {text(`地下/异界/遗境: ${specialNodes.length} 处`, `Underground/Relics: ${specialNodes.length}`)}
                  </span>
                )}
              </div>
            </div>
            <span className="writer-overview-card-action w-full justify-between">
              <span>{text('进入世界地图画布', 'Open world map')}</span>
              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Card>

          {/* 卡片 2: 剧情树与伏笔 */}
          <Card
            role="button"
            tabIndex={0}
            aria-label={text('打开剧情树', 'Open plot tree')}
            onClick={handleOpenPlotTree}
            onKeyDown={(event) => activateCardOnKey(event, handleOpenPlotTree)}
            className="p-5 flex flex-col justify-between hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] cursor-pointer group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-success)] border border-[var(--color-border)]">
                    <GitBranch size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{text('剧情树与伏笔', 'Plot Tree & Narrative')}</h3>
                    <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                      {text('算法确定性投影，零模型依赖', 'Algorithmic projection, no LLM')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                  {text('确定性', 'Deterministic')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                {text(
                  '纯粹从章节蓝图与线索直接投射的主线脉络，直观追踪各章节事件演进、伏笔埋设与回收状态，点击可直接跳到对应章节。',
                  'Instant projection of blueprints into chapter timelines, setup and payoff tracking without model delay.',
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text('第一卷主线: 1~58 章', 'Volume 1 main arc: Ch 1-58')}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text('伏笔埋设与回收', 'Setup & payoff')}
                </span>
              </div>
            </div>
            <span className="writer-overview-card-action w-full justify-between">
              <span>{text('查看剧情树脉络', 'Open plot tree')}</span>
              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Card>

          {/* 卡片 3: 章节蓝图 */}
          <Card
            role="button"
            tabIndex={0}
            aria-label={text('打开章节蓝图', 'Open chapter blueprints')}
            onClick={handleOpenBlueprints}
            onKeyDown={(event) => activateCardOnKey(event, handleOpenBlueprints)}
            className="p-5 flex flex-col justify-between hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] cursor-pointer group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-category-review-text)] border border-[var(--color-border)]">
                    <BookOpen size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{text('章节蓝图规划', 'Chapter Blueprints')}</h3>
                    <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                      {text('1~58 章细纲与关键事件', 'Chapters 1-58 detailed outlines')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                  {blueprints.length} {text('已就绪', 'ready')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                {text(
                  '包含章节目标、叙事目的、出场角色、关键事件及详细 user_guidance 细纲。每一章都可以一键新建或打开草稿开始直接码字。',
                  'Every chapter card includes narrative goals, events, characters, and user outline, with direct prose drafting.',
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text('细纲全文', 'Full outline')}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text('一键新建/打开正文', 'Direct prose drafting')}
                </span>
              </div>
            </div>
            <span className="writer-overview-card-action w-full justify-between">
              <span>{text('查看章节蓝图细纲', 'Open chapter blueprints')}</span>
              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Card>

          {/* 卡片 4: 正文写作 */}
          <Card
            role="button"
            tabIndex={0}
            aria-label={text('进入正文编辑器', 'Start drafting')}
            onClick={handleResumeDrafting}
            onKeyDown={(event) => activateCardOnKey(event, handleResumeDrafting)}
            className="p-5 flex flex-col justify-between hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] cursor-pointer group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-accent)] border border-[var(--color-border)]">
                    <PenTool size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{text('正文直接写作', 'Prose Drafting')}</h3>
                    <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                      {text('沉浸式专注码字工作区', 'Immersive focus drafting')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                  {draftedChaptersCount} {text('章有稿', 'drafted')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                {text(
                  '自由创作正文，无需任何模型前置配置；多版本草稿箱管理，支持字数统计、实时自动保存与定稿流转。',
                  'Direct fiction writing without prerequisite barriers. Full draft versioning, word counts, and publication flow.',
                )}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text(`已完成字数: ${totalDraftedWords.toLocaleString()}`, `Words: ${totalDraftedWords.toLocaleString()}`)}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  {text('右侧蓝图伴随', 'Right inspector guidance')}
                </span>
              </div>
            </div>
            <span className="writer-overview-card-action w-full justify-between">
              <span>{text('进入正文编辑器', 'Start drafting')}</span>
              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Card>

          {/* 卡片 5: 故事时间线 */}
          <Card
            role="button"
            tabIndex={0}
            aria-label={text('打开故事时间线', 'Open story timeline')}
            onClick={handleOpenStoryTimeline}
            onKeyDown={(event) => activateCardOnKey(event, handleOpenStoryTimeline)}
            className="p-5 flex flex-col justify-between hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] cursor-pointer group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-warning-text)] border border-[var(--color-border)]">
                    <Clock3 size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{text('故事时间线', 'Story Timeline')}</h3>
                    <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                      {text('按故事内时间编排事件、章节、人物与地点', 'Order events, chapters, characters, and locations by story time')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                  {timelineEvents.length} {text('个事件', 'events')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                {text(
                  '用独立的故事时间刻度管理关键事件：可记录精确时间、时间范围、相对时间或暂未确定的事件，并关联对应章节、角色和地点。',
                  'Maintain key events on an independent story-time ruler with exact, range, relative, or undecided dates and links to chapters, characters, and locations.',
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
                <div className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-hover)] text-xs">
                  <div className="font-medium text-[11px] mb-0.5 flex items-center gap-1 text-[var(--color-text)]">
                    <Clock3 size={11} className="text-[var(--color-warning-text)]" />
                    {text('计划中', 'Planned')}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {timelineSummary.planned} {text('个事件待推进', 'events to develop')}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-hover)] text-xs">
                  <div className="font-medium text-[11px] mb-0.5 flex items-center gap-1 text-[var(--color-text)]">
                    <PenTool size={11} className="text-[var(--color-accent)]" />
                    {text('已起草', 'Drafted')}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {timelineSummary.drafted} {text('个事件已写入草稿', 'events in drafts')}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-hover)] text-xs">
                  <div className="font-medium text-[11px] mb-0.5 flex items-center gap-1 text-[var(--color-text)]">
                    <BookOpen size={11} className="text-[var(--color-success-text)]" />
                    {text('已定稿', 'Finalized')}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    {timelineSummary.finalized} {text('个事件已完成定稿', 'events finalized')}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {text('拖动排序即可调整故事事件的先后顺序', 'Drag events to arrange their story order')}
              </span>
              <span className="writer-overview-card-action">
                <span>{text('进入时间线', 'Open timeline')}</span>
                <ArrowRight size={13} className="ml-1 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </Card>

          {/* 卡片 6: 只读一致性审核。入口只导航到正文草稿，绝不在总览中自动改写内容。 */}
          <Card
            role="button"
            tabIndex={0}
            aria-label={text('前往正文草稿进行只读一致性审核', 'Open a prose draft for read-only consistency audit')}
            onClick={handleResumeDrafting}
            onKeyDown={(event) => activateCardOnKey(event, handleResumeDrafting)}
            className="p-5 flex flex-col justify-between hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] cursor-pointer group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-warning-text)] border border-[var(--color-border)]">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">{text('只读一致性审核', 'Read-only Consistency Audit')}</h3>
                    <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                      {text('发现偏差，绝不自动改写正文', 'Find deviations, never rewrite prose')}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                  {text('作者决策', 'Author decides')}
                </span>
              </div>
              <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                {text(
                  '将当前草稿与章节蓝图、世界设定及叙事线索逐项比对；审核结果只生成报告和跳转线索，是否修订始终由作者决定。',
                  'Compare the current draft against blueprints, world rules, and narrative threads. Results only create a report and navigation clues; every revision remains the author’s decision.',
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
                  {text('蓝图兑现', 'Blueprint delivery')}
                </span>
                <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
                  {text('未授权事件', 'Unauthorized events')}
                </span>
                <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
                  {text('设定与地图冲突', 'Setting and map conflicts')}
                </span>
                <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
                  {text('证据链完整性', 'Evidence-chain integrity')}
                </span>
              </div>
            </div>
            <span className="writer-overview-card-action w-full justify-between">
              <span>{text('前往正文草稿审核', 'Open prose draft for audit')}</span>
              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </Card>
        </div>
      </div>
    </div>
  )
}
