import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  Compass,
  GitBranch,
  BookOpen,
  PenTool,
  Clock3,
  ShieldCheck,
  ArrowRight,
  Globe,
  Settings,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useDraftStore } from '../../stores/draft-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useCharacterStore } from '../../stores/character-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'
import { ipc } from '../../services/ipc-client'
import { captureProjectSession } from '../project-session-gate'
import type { ChapterBlueprint } from '../../services/workflows/directory-workflow'
import { NewDraftDialog } from '../panels/sidebar/NewDraftDialog'
import { openResumableDraft } from './workbench-draft-entry'

export default function ProjectOverviewPage() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const nodes = useWorldMapStore(s => s.nodes)
  const edges = useWorldMapStore(s => s.edges)
  const maps = useWorldMapStore(s => s.maps)
  const loadWorldMap = useWorldMapStore(s => s.loadAll)
  const timelineEvents = useStoryTimelineStore(s => s.events)
  const timelineDataProjectKey = useStoryTimelineStore(s => s.dataProjectKey)
  const loadStoryTimeline = useStoryTimelineStore(s => s.loadAll)
  const characters = useCharacterStore(s => s.characters)
  const loadCharacters = useCharacterStore(s => s.loadCharacters)

  const [blueprints, setBlueprints] = useState<ChapterBlueprint[]>([])
  const [stepperExpanded, setStepperExpanded] = useState(true)
  const [createDraftDialogOpen, setCreateDraftDialogOpen] = useState(false)

  const projectPath = currentProject?.path
  const totalChapters = currentProject?.novelConfig?.totalChapters ?? 58
  const wordsPerChapter = currentProject?.novelConfig?.wordsPerChapter ?? 3000
  const expectedTotalWords = totalChapters * wordsPerChapter

  // 加载地图册、角色档案和章节蓝图
  useEffect(() => {
    if (!projectPath) return
    void loadWorldMap(projectPath)
    void loadCharacters(projectPath)

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
  }, [projectPath, currentProject, loadWorldMap, loadCharacters])

  // 加载故事时间线真实数据
  useEffect(() => {
    if (!projectPath || timelineDataProjectKey === projectPath) return
    void loadStoryTimeline(projectPath)
  }, [projectPath, timelineDataProjectKey, loadStoryTimeline])

  // 统计草稿与真实已写字数
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

  // 遗境/秘境等特殊地点统计
  const specialNodes = useMemo(() => nodes.filter(n => n.type === 'relic'), [nodes])

  // 真实时间线状态分布
  const timelineSummary = useMemo(() => ({
    planned: timelineEvents.filter(event => event.status === 'planned').length,
    drafted: timelineEvents.filter(event => event.status === 'drafted').length,
    finalized: timelineEvents.filter(event => event.status === 'finalized').length,
  }), [timelineEvents])

  // 真实创作进度百分比
  const progressPercent = Math.min(100, Math.round((draftedChaptersCount / Math.max(totalChapters, 1)) * 100))

  // 打开地图册
  const handleOpenWorldMap = () => {
    if (!projectPath) return
    openBuiltinEditor('world-map-editor', text('多地图地图册', 'Map atlas'), 'world-map')
  }

  // 打开章节脉络（章节蓝图的确定性投影）
  const handleOpenPlotTree = () => {
    if (!projectPath) return
    openBuiltinEditor('narrative-thread-editor', text('章节脉络', 'Chapter thread'), 'narrative-thread', 'plot-tree')
  }

  // 打开章节蓝图
  const handleOpenBlueprints = () => {
    if (!projectPath) return
    openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card')
  }

  // 打开故事时间线
  const handleOpenStoryTimeline = () => {
    if (!projectPath) return
    openBuiltinEditor('story-timeline-editor', text('故事时间线', 'Story timeline'), 'story-timeline')
  }

  // 打开世界观设定
  const handleOpenWorldBuilding = () => {
    if (!projectPath) return
    openBuiltinEditor('world-building', text('世界观设定', 'World building'), 'world-building')
  }

  // 打开小说配置
  const handleOpenConfig = () => {
    if (!projectPath) return
    openBuiltinEditor('config', text('小说设定', 'Novel config'), 'config')
  }

  // 打开角色档案
  const handleOpenCharacterProfile = () => {
    useLayoutStore.getState().openCharacterProfile('overview')
  }

  // 继续最后编辑的未定稿章节；没有可编辑草稿时进入现有新建草稿流程。
  const handleResumeDrafting = async () => {
    if (!projectPath) return
    if (!await openResumableDraft(draftsByChapter)) setCreateDraftDialogOpen(true)
  }

  const firstPlannedUnwrittenChapter = blueprints
    .map(blueprint => blueprint.chapterNumber)
    .filter(chapterNumber => chapterNumber > 0 && !draftsByChapter[chapterNumber]?.length)
    .sort((a, b) => a - b)[0]
  const firstUnwrittenChapter = firstPlannedUnwrittenChapter ?? (() => {
    let chapterNumber = 1
    while (draftsByChapter[chapterNumber]?.length) chapterNumber++
    return chapterNumber
  })()

  /** 卡片键盘回车/空格激活无障碍支持 */
  const activateCardOnKey = (event: KeyboardEvent<HTMLDivElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    action()
  }

  // 4 步可跳过创作路径的真实状态计算
  const isDirectionSet = Boolean(currentProject?.novelConfig?.genre?.trim() && currentProject?.novelConfig?.coreOutline?.trim())
  const hasSomeDirection = Boolean(currentProject?.novelConfig?.genre?.trim() || currentProject?.novelConfig?.coreOutline?.trim())

  const isSettingEstablished = characters.length > 0 && nodes.length > 0
  const hasSomeSetting = characters.length > 0 || nodes.length > 0 || Boolean(currentProject?.novelConfig?.worldSetting?.trim())

  const isPlanningComplete = blueprints.length >= totalChapters && blueprints.length > 0
  const hasSomePlanning = blueprints.length > 0

  const hasDrafts = Object.values(draftsByChapter).some(drafts =>
    drafts.some(draft => draft.status !== 'archived' && draft.status !== 'finalized'))

  return (
    <div
      className="literary-overview h-full overflow-y-auto p-5 md:p-8"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 顶部 Hero 欢迎与真实状态栏 */}
        <Card className="literary-overview-hero">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span
                  className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    color: 'var(--color-accent-text)',
                    border: '1px solid color-mix(in srgb, var(--color-accent) 24%, transparent)',
                  }}
                >
                  {text('长篇小说工作台', 'Fiction Workbench')}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {currentProject?.novelConfig?.genre || text('长篇创作', 'Fiction')}
                </span>
                {currentProject?.novelConfig?.targetAudience && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    · {currentProject.novelConfig.targetAudience}
                  </span>
                )}
              </div>
              <h1
                className="literary-overview-title break-words"
                style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                title={currentProject?.name}
              >
                {currentProject?.name || text('未命名小说项目', 'Untitled Novel')}
              </h1>
              <p className="text-xs mt-1.5 text-[var(--color-text-secondary)] leading-relaxed">
                {text(
                  '纯粹由作者主导的创作空间：地图册、章节蓝图、正文写作、只读审核。所有数据均保存在本地。',
                  'Author-driven fiction workspace: World map, blueprints, prose writing, read-only audit. 100% local.',
                )}
              </p>
            </div>

            {/* 核心主行动：突出“继续写正文”层级 */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                className="literary-hero-primary-btn"
                onClick={handleResumeDrafting}
                title={text('进入正文草稿编辑器开始写作', 'Open draft editor')}
              >
                <PenTool size={15} />
                <span>{hasDrafts ? text('继续写正文', 'Continue drafting') : text('直接写正文', 'Start drafting')}</span>
                <ArrowRight size={14} />
              </button>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenBlueprints}
                  title={text('查看章节蓝图细纲', 'Blueprints')}
                  className="whitespace-nowrap"
                >
                  <BookOpen size={13} className="mr-1.5 flex-shrink-0" />
                  <span>{text('章节蓝图', 'Blueprints')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenWorldMap}
                  title={text('多地图地图册', 'Map atlas')}
                  className="whitespace-nowrap"
                >
                  <Compass size={13} className="mr-1.5 flex-shrink-0" />
                  <span>{text('地图册', 'Atlas')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenStoryTimeline}
                  title={text('故事时间线', 'Story timeline')}
                  className="whitespace-nowrap"
                >
                  <Clock3 size={13} className="mr-1.5 flex-shrink-0" />
                  <span>{text('时间线', 'Timeline')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenConfig}
                  title={text('小说设定与受众', 'Novel config')}
                  className="whitespace-nowrap"
                >
                  <Settings size={13} className="mr-1.5 flex-shrink-0" />
                  <span>{text('设定', 'Config')}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* 真实项目进度指标条（纯粹本地作品真实数据） */}
          <div className="literary-metric-grid">
            <div className="literary-metric-item">
              <div className="literary-metric-label">{text('规划细纲', 'Planned chapters')}</div>
              <div className="literary-metric-value">
                {blueprints.length} <span className="literary-metric-sub">/ {totalChapters} {text('章', 'ch')}</span>
              </div>
            </div>
            <div className="literary-metric-item">
              <div className="literary-metric-label">{text('已起草章节', 'Drafted chapters')}</div>
              <div className="literary-metric-value">
                {draftedChaptersCount} <span className="literary-metric-sub">/ {totalChapters} {text('章', 'ch')}</span>
              </div>
            </div>
            <div className="literary-metric-item">
              <div className="literary-metric-label">{text('已写正文字数', 'Drafted words')}</div>
              <div className="literary-metric-value">
                {totalDraftedWords.toLocaleString()} <span className="literary-metric-sub">/ {expectedTotalWords.toLocaleString()} {text('字', 'words')}</span>
              </div>
            </div>
            <div className="literary-metric-item">
              <div className="literary-metric-label">{text('已起草章节占比', 'Chapters drafted')}</div>
              <div className="literary-metric-value">
                {progressPercent}%
              </div>
            </div>
            <div className="literary-metric-item">
              <div className="literary-metric-label">{text('登场人物', 'Characters')}</div>
              <div className="literary-metric-value">
                {characters.length} <span className="literary-metric-sub">{text('位', 'chars')}</span>
              </div>
            </div>
            <div className="literary-metric-item">
              <div className="literary-metric-label">{text('地图地点', 'Map locations')}</div>
              <div className="literary-metric-value">
                {nodes.length} <span className="literary-metric-sub">({maps.length} {text('张图', 'maps')})</span>
              </div>
            </div>
          </div>
        </Card>

        {/* 可跳过的 4 步创作路径全景阶梯（定方向 → 建设定 → 做章节规划 → 写正文） */}
        <section className="literary-stepper-card" aria-label={text('创作路径导航', 'Writing roadmap')}>
          <div className="literary-stepper-header">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--color-accent)]" />
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {text('创作路径导航', 'Writing Roadmap')}
              </h2>
              <span className="text-xs text-[var(--color-text-muted)]">
                {text('自由推进或跳过，各环节随时可直达', 'Flexible & skippable; jump to any step anytime')}
              </span>
            </div>
            <button
              type="button"
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1 cursor-pointer"
              onClick={() => setStepperExpanded(!stepperExpanded)}
              aria-label={stepperExpanded ? text('收起创作导航', 'Collapse roadmap') : text('展开创作导航', 'Expand roadmap')}
            >
              {stepperExpanded ? (
                <>
                  <span>{text('收起导航', 'Collapse')}</span>
                  <ChevronUp size={14} />
                </>
              ) : (
                <>
                  <span>{text('展开全景导航', 'Expand roadmap')}</span>
                  <ChevronDown size={14} />
                </>
              )}
            </button>
          </div>

          {stepperExpanded && (
            <div className="literary-stepper-grid">
              {/* 步骤 1: 定方向 */}
              <div className={`literary-step-card ${!hasSomeDirection ? 'active-step' : ''}`}>
                <div>
                  <div className="literary-step-header">
                    <div className="flex items-center gap-2">
                      <span className="literary-step-num">1</span>
                      <span className="literary-step-name">{text('定方向', 'Direction')}</span>
                    </div>
                    <span className={`literary-step-badge ${isDirectionSet ? 'ready' : (hasSomeDirection ? 'in_progress' : 'pending')}`}>
                      {isDirectionSet
                        ? text('已就绪', 'Ready')
                        : hasSomeDirection
                          ? text('进行中', 'In progress')
                          : text('待起步', 'Pending')}
                    </span>
                  </div>
                  <div className="literary-step-desc">
                    {isDirectionSet
                      ? text(`${currentProject?.novelConfig?.genre || '题材已定'} · 核心梗概已拟定`, `${currentProject?.novelConfig?.genre || 'Genre set'} · Outline ready`)
                      : hasSomeDirection
                        ? text(`${currentProject?.novelConfig?.genre || '题材已选'} · 待补充核心梗概`, 'Genre chosen · pending outline')
                        : text('设定作品题材、目标受众与故事核心梗概', 'Set genre, target audience, and premise')}
                  </div>
                </div>
                <div className="literary-step-action">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs justify-between"
                    onClick={handleOpenConfig}
                  >
                    <span>{hasSomeDirection ? text('调整设定', 'Edit direction') : text('去定方向', 'Set direction')}</span>
                    <ArrowRight size={12} />
                  </Button>
                </div>
              </div>

              {/* 步骤 2: 建设定 */}
              <div className={`literary-step-card ${hasSomeDirection && !hasSomeSetting ? 'active-step' : ''}`}>
                <div>
                  <div className="literary-step-header">
                    <div className="flex items-center gap-2">
                      <span className="literary-step-num">2</span>
                      <span className="literary-step-name">{text('建设定', 'World & Setting')}</span>
                    </div>
                    <span className={`literary-step-badge ${isSettingEstablished ? 'ready' : (hasSomeSetting ? 'in_progress' : 'pending')}`}>
                      {isSettingEstablished
                        ? text('已充实', 'Established')
                        : hasSomeSetting
                          ? text('进行中', 'In progress')
                          : text('待构筑', 'Pending')}
                    </span>
                  </div>
                  <div className="literary-step-desc">
                    {isSettingEstablished
                      ? text(`${characters.length} 位人物 · ${nodes.length} 处地点 (${maps.length} 张图)`, `${characters.length} chars · ${nodes.length} places`)
                      : hasSomeSetting
                        ? characters.length > 0
                          ? text(`${characters.length} 位人物已建立 · 待绘制地图`, `${characters.length} chars · pending maps`)
                          : text(`${nodes.length} 处地点已建立 · 待录入人物`, `${nodes.length} places · pending chars`)
                        : text('构筑世界观规则、人物小传与地理版图', 'Create world laws, character profiles & maps')}
                  </div>
                </div>
                <div className="literary-step-action space-y-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs justify-between"
                    onClick={handleOpenWorldBuilding}
                  >
                    <span>{hasSomeSetting ? text('世界观设定', 'Worldbuilding') : text('开始建设定', 'Build setting')}</span>
                    <ArrowRight size={12} />
                  </Button>
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-[var(--color-accent-text)]">
                    <button
                      type="button"
                      className="hover:underline cursor-pointer"
                      onClick={handleOpenCharacterProfile}
                    >
                      {text('人物档案', 'Characters')}
                    </button>
                    <span className="text-[var(--color-text-muted)] opacity-50">·</span>
                    <button
                      type="button"
                      className="hover:underline cursor-pointer"
                      onClick={handleOpenWorldMap}
                    >
                      {text('地图册', 'Map Atlas')}
                    </button>
                  </div>
                </div>
              </div>

              {/* 步骤 3: 做章节规划 */}
              <div className={`literary-step-card ${hasSomeSetting && !hasSomePlanning ? 'active-step' : ''}`}>
                <div>
                  <div className="literary-step-header">
                    <div className="flex items-center gap-2">
                      <span className="literary-step-num">3</span>
                      <span className="literary-step-name">{text('做章节规划', 'Blueprints')}</span>
                    </div>
                    <span className={`literary-step-badge ${isPlanningComplete ? 'ready' : (hasSomePlanning ? 'in_progress' : 'pending')}`}>
                      {isPlanningComplete
                        ? text('全案就绪', 'Complete')
                        : hasSomePlanning
                          ? text('规划中', 'Planning')
                          : text('待规划', 'Pending')}
                    </span>
                  </div>
                  <div className="literary-step-desc">
                    {hasSomePlanning
                      ? text(`已规划 ${blueprints.length} / ${totalChapters} 章细纲 · ${timelineEvents.length} 个事件`, `Planned ${blueprints.length} / ${totalChapters} chs · ${timelineEvents.length} events`)
                      : text('拟定分卷目标、章节细纲与叙事线索', 'Draft volume goals, chapter cards & threads')}
                  </div>
                </div>
                <div className="literary-step-action space-y-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs justify-between"
                    onClick={handleOpenBlueprints}
                  >
                    <span>{hasSomePlanning ? text('管理细纲', 'Manage blueprints') : text('规划章节细纲', 'Plan chapters')}</span>
                    <ArrowRight size={12} />
                  </Button>
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-[var(--color-accent-text)]">
                    <button
                      type="button"
                      className="hover:underline cursor-pointer"
                      onClick={handleOpenPlotTree}
                    >
                      {text('章节脉络', 'Chapter thread')}
                    </button>
                    <span className="text-[var(--color-text-muted)] opacity-50">·</span>
                    <button
                      type="button"
                      className="hover:underline cursor-pointer"
                      onClick={handleOpenStoryTimeline}
                    >
                      {text('时间线', 'Timeline')}
                    </button>
                  </div>
                </div>
              </div>

              {/* 步骤 4: 写正文 */}
              <div className={`literary-step-card ${hasDrafts ? 'active-step' : ''}`}>
                <div>
                  <div className="literary-step-header">
                    <div className="flex items-center gap-2">
                      <span className="literary-step-num">4</span>
                      <span className="literary-step-name">{text('写正文', 'Prose Drafting')}</span>
                    </div>
                    <span className={`literary-step-badge ${hasDrafts ? 'in_progress' : 'pending'}`}>
                      {hasDrafts ? text('创作中', 'Active') : text('待执笔', 'Pending')}
                    </span>
                  </div>
                  <div className="literary-step-desc">
                    {hasDrafts
                      ? text(`已起草 ${draftedChaptersCount} 章 · 累计 ${totalDraftedWords.toLocaleString()} 字`, `Drafted ${draftedChaptersCount} chs · ${totalDraftedWords.toLocaleString()} words`)
                      : text('进入专注写作区，随时起草正文与版本流转', 'Immersive focus drafting with versioned drafts')}
                  </div>
                </div>
                <div className="literary-step-action">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full text-xs justify-center whitespace-nowrap font-medium"
                    onClick={handleResumeDrafting}
                  >
                    <span>{hasDrafts ? text('继续写正文', 'Continue writing') : text('开始起草正文', 'Start drafting')}</span>
                    <ArrowRight size={12} className="ml-1.5 flex-shrink-0" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 按创作阶段分组的功能卡片群 */}

        {/* 阶段一：世界与时空 */}
        <section className="literary-stage-section" aria-labelledby="stage-world-heading">
          <div className="literary-stage-header">
            <span className="literary-stage-tag">{text('阶段一', 'STAGE 1')}</span>
            <h2 id="stage-world-heading" className="literary-stage-title">
              {text('世界与时空', 'World & Setting')}
            </h2>
            <span className="literary-stage-desc">
              {text('为故事搭建坚实的地理舞台、时间标尺与法则设定', 'Ground your story in space, time, and rules')}
            </span>
          </div>

          <div className="literary-stage-grid">
            {/* 卡片 1: 多地图地图册 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('打开地图册', 'Open map atlas')}
              onClick={handleOpenWorldMap}
              onKeyDown={(event) => activateCardOnKey(event, handleOpenWorldMap)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-accent)] border border-[var(--color-border)]">
                      <Compass size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('多地图地图册', 'Map Atlas Topology')}
                      </h3>
                      <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                        {text('空间地理与势力网络', 'Spatial nodes and connections')}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                    {nodes.length} {text('地点', 'nodes')}
                  </span>
                </div>
                <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                  {text(
                    '地图册由多张独立地图组成层级：每张地图有自己的图片、地点与内部连接。正文写作时右侧自动联动所在地点规则。',
                    'An atlas of independent maps: each map has its own image, locations, and internal connections.',
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text(`地图: ${maps.length} 张`, `Maps: ${maps.length}`)}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text(`地点连接: ${edges.length} 条`, `Links: ${edges.length}`)}
                  </span>
                  {specialNodes.length > 0 && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full border font-medium"
                      style={{
                        borderColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                        color: 'var(--color-warning-text)',
                      }}
                    >
                      {text(`遗境/秘境: ${specialNodes.length} 处`, `Relics: ${specialNodes.length}`)}
                    </span>
                  )}
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('进入地图册画布', 'Open map atlas')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>

            {/* 卡片 2: 故事时间线 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('打开故事时间线', 'Open story timeline')}
              onClick={handleOpenStoryTimeline}
              onKeyDown={(event) => activateCardOnKey(event, handleOpenStoryTimeline)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-warning-text)] border border-[var(--color-border)]">
                      <Clock3 size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('故事时间线', 'Story Timeline')}
                      </h3>
                      <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                        {text('按故事内部时间编排事件与角色', 'Order events & characters by story time')}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                    {timelineEvents.length} {text('个事件', 'events')}
                  </span>
                </div>
                <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                  {text(
                    '用独立的故事时间刻度管理关键事件：支持精确时间、相对时间或待定事件，并关联对应章节与人物。',
                    'Maintain key events on an independent story-time ruler with exact, range, relative, or undecided dates.',
                  )}
                </p>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <div className="p-1.5 rounded border border-[var(--color-border)] bg-[var(--color-hover)] text-center">
                    <div className="text-[10px] text-[var(--color-text-muted)]">{text('计划中', 'Planned')}</div>
                    <div className="text-xs font-semibold text-[var(--color-text)]">{timelineSummary.planned}</div>
                  </div>
                  <div className="p-1.5 rounded border border-[var(--color-border)] bg-[var(--color-hover)] text-center">
                    <div className="text-[10px] text-[var(--color-text-muted)]">{text('已起草', 'Drafted')}</div>
                    <div className="text-xs font-semibold text-[var(--color-text)]">{timelineSummary.drafted}</div>
                  </div>
                  <div className="p-1.5 rounded border border-[var(--color-border)] bg-[var(--color-hover)] text-center">
                    <div className="text-[10px] text-[var(--color-text-muted)]">{text('已定稿', 'Finalized')}</div>
                    <div className="text-xs font-semibold text-[var(--color-text)]">{timelineSummary.finalized}</div>
                  </div>
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('进入故事时间线', 'Open story timeline')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>

            {/* 卡片 3: 世界观与规则设定 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('打开世界观设定', 'Open worldbuilding')}
              onClick={handleOpenWorldBuilding}
              onKeyDown={(event) => activateCardOnKey(event, handleOpenWorldBuilding)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-accent)] border border-[var(--color-border)]">
                      <Globe size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('世界观与规则设定', 'Worldbuilding & Rules')}
                      </h3>
                      <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                        {text('力量体系、势力派系与世界底则', 'Power system, factions & lore')}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                    {characters.length} {text('位人物', 'chars')}
                  </span>
                </div>
                <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                  {text(
                    '长篇小说的世界法则基石：录入力量体系、修炼等级、门派势力与自然法则，保证全书前后设定严谨一致。',
                    'Establish the foundational rules of your fiction: magic/power hierarchies, factions, and consistent world logic.',
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('世界法则', 'World laws')}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('势力派系', 'Factions')}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('人物档案联动', 'Character roster')}
                  </span>
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('进入世界观设定', 'Open worldbuilding')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>
          </div>
        </section>

        {/* 阶段二：大纲与叙事脉络 */}
        <section className="literary-stage-section" aria-labelledby="stage-outline-heading">
          <div className="literary-stage-header">
            <span className="literary-stage-tag">{text('阶段二', 'STAGE 2')}</span>
            <h2 id="stage-outline-heading" className="literary-stage-title">
              {text('大纲与叙事脉络', 'Structure & Narrative Arc')}
            </h2>
            <span className="literary-stage-desc">
              {text('拆解分卷蓝图，投射算法确定性的剧情伏笔演进', 'Deconstruct chapter cards & track story threads')}
            </span>
          </div>

          <div className="literary-stage-grid">
            {/* 卡片 4: 章节细纲规划 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('打开章节蓝图', 'Open chapter blueprints')}
              onClick={handleOpenBlueprints}
              onKeyDown={(event) => activateCardOnKey(event, handleOpenBlueprints)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-category-review-text)] border border-[var(--color-border)]">
                      <BookOpen size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('章节蓝图细纲', 'Chapter Blueprints')}
                      </h3>
                      <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                        {text('各章目标、出场人物与事件指南', 'Chapter goals, characters & beats')}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium">
                    {blueprints.length} / {totalChapters} {text('就绪', 'ready')}
                  </span>
                </div>
                <p className="text-xs leading-relaxed mb-3 text-[var(--color-text-secondary)]">
                  {text(
                    '包含章节目标、叙事目的、出场角色、关键事件及详细 user_guidance 细纲。每一章都可以一键新建或打开草稿。',
                    'Every chapter card includes narrative goals, events, characters, and user outline, with direct prose drafting.',
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('细纲全文', 'Full outline')}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('一键新建/打开正文', 'Direct prose drafting')}
                  </span>
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('查看章节蓝图细纲', 'Open chapter blueprints')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>

            {/* 卡片 5: 章节脉络 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('打开章节脉络', 'Open chapter thread')}
              onClick={handleOpenPlotTree}
              onKeyDown={(event) => activateCardOnKey(event, handleOpenPlotTree)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-success)] border border-[var(--color-border)]">
                      <GitBranch size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('章节脉络', 'Chapter Thread')}
                      </h3>
                      <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                        {text('确定性算法投影，零模型依赖', 'Deterministic projection, zero LLM delay')}
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
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text(`主线规划: 1~${totalChapters} 章`, `Arc: 1-${totalChapters} chs`)}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('伏笔埋设与回收追踪', 'Setup & payoff')}
                  </span>
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('查看章节脉络', 'Open chapter thread')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>
          </div>
        </section>

        {/* 阶段三：正文执笔与审核 */}
        <section className="literary-stage-section" aria-labelledby="stage-writing-heading">
          <div className="literary-stage-header">
            <span className="literary-stage-tag">{text('阶段三', 'STAGE 3')}</span>
            <h2 id="stage-writing-heading" className="literary-stage-title">
              {text('正文执笔与质量审核', 'Prose Drafting & Quality Audit')}
            </h2>
            <span className="literary-stage-desc">
              {text('沉浸专注码字，保持只读审核发现偏差而绝不擅自篡改正文', 'Immersive focus drafting with author-controlled audit')}
            </span>
          </div>

          <div className="literary-stage-grid">
            {/* 卡片 6: 沉浸正文直接写作 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('进入正文编辑器', 'Start drafting')}
              onClick={handleResumeDrafting}
              onKeyDown={(event) => activateCardOnKey(event, handleResumeDrafting)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-accent)] border border-[var(--color-border)]">
                      <PenTool size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('正文直接写作', 'Prose Drafting')}
                      </h3>
                      <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                        {text('专注码字工作区与多版本管理', 'Immersive focus drafting')}
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
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text(`已完成字数: ${totalDraftedWords.toLocaleString()}`, `Words: ${totalDraftedWords.toLocaleString()}`)}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {text('右侧蓝图伴随', 'Right inspector guidance')}
                  </span>
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('进入正文编辑器', 'Start drafting')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>

            {/* 卡片 7: 只读一致性审核 */}
            <Card
              role="button"
              tabIndex={0}
              aria-label={text('前往正文草稿进行只读一致性审核', 'Open a prose draft for read-only consistency audit')}
              onClick={handleResumeDrafting}
              onKeyDown={(event) => activateCardOnKey(event, handleResumeDrafting)}
              className="literary-workstation-card group"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-warning-text)] border border-[var(--color-border)]">
                      <ShieldCheck size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--color-text)]">
                        {text('只读一致性审核', 'Read-only Consistency Audit')}
                      </h3>
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
                    'Compare drafts against blueprints, rules, and threads. Results only create audit reports; revisions remain yours.',
                  )}
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                    {text('蓝图兑现', 'Blueprint delivery')}
                  </span>
                  <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                    {text('未授权事件', 'Unauthorized events')}
                  </span>
                  <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                    {text('设定与地图冲突', 'Setting and map conflicts')}
                  </span>
                  <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-hover)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                    {text('证据链完整性', 'Evidence integrity')}
                  </span>
                </div>
              </div>
              <div className="literary-card-action-bar">
                <span>{text('前往正文草稿审核', 'Open prose draft for audit')}</span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Card>
          </div>
        </section>
      </div>
      <NewDraftDialog
        open={createDraftDialogOpen}
        onOpenChange={setCreateDraftDialogOpen}
        suggestedChapterNumber={firstUnwrittenChapter}
      />
    </div>
  )
}
