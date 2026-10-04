/**
 * ProjectTree — 项目导航树（侧边栏核心视图）
 *
 * 包含：创作方向、故事设定、创作规划、草稿箱、正文章节与项目工具
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronRight, ChevronDown, RefreshCw, CheckCircle2, Circle, Globe2,
  FolderOpen, Copy, Trash2,
  Layers, BookOpen, Library, FolderCog, PenTool,
} from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { useWorldWorkbenchStore } from '../../../stores/world-workbench-store'
import { ipc } from '../../../services/ipc-client'
import { Button } from '../../ui/Button'
import { IconTooltip } from '../../ui/Tooltip'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem } from '../../ui/sidebar'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../../ui/collapsible'

import { LeafItem } from './SidebarShared'
import { ARCH_FILES, type ArchFile } from './sidebar-arch-files'
import {
  confirmCurrentProjectSession,
  openArchFile,
  openBuiltinEditor,
} from './sidebar-file-openers'
import { renderIcon } from './sidebar-icons'
import { showSidebarMenu } from './sidebar-menu'
import { createProjectArchTabId } from '../../editor/arch-file-refresh-policy'
import { openProseDirectory } from './prose-directory-openers'
import { useLocaleStore } from '../../../stores/locale-store'
import { LatestRequestGate } from '../../editor/latest-request-gate'
import { beginProjectTreeIdentityTransition } from './project-tree-refresh-policy'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../../project-session-gate'
import { globalEventBus } from '../../../shared/event-bus'
import { shouldRefreshBlueprints } from '../../editor/blueprint-refresh'

export default function ProjectTree() {
  const currentProject = useProjectStore(s => s.currentProject)
  const projectSessionEpoch = useProjectStore(s => s.projectSessionEpoch)
  const text = useLocaleStore(s => s.text)

  // refreshFileTree / loadAllDrafts 在 refreshAll 内通过 getState() 调用
  // 只订阅 activeRuns
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  // 精确订阅，避免 loadAllDrafts 执行后引用变化触发 useCallback/useEffect 循环
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)

  // 存储各架构文件是否有实际内容（已生成）
  const [archStatus, setArchStatus] = useState<Record<string, boolean>>({})
  // 章节蓝图数量
  const [blueprintCount, setBlueprintCount] = useState<number>(-1)
  const [refreshing, setRefreshing] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const refreshRequestGate = useRef(new LatestRequestGate())
  const mapNodes = useWorldMapStore(s => s.nodes)
  const worldCount = useWorldWorkbenchStore(s => s.data.worlds.length)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)
  const projectTreeGroupOpen = useLayoutStore(s => s.projectTreeGroupOpen)
  const setProjectTreeGroupOpen = useLayoutStore(s => s.setProjectTreeGroupOpen)

  /** 统一刷新：文件树 + 架构状态 + 草稿列表 + 蓝图数量 */
  // 用 getState() 获取最新的 action，不作为依赖项，避免重建导致 useEffect 循环
  const refreshAll = useCallback(async () => {
    const projectState = useProjectStore.getState()
    const projectSession = captureProjectSession(projectState.currentProject)
    const projectPath = projectSession?.projectPath
    const expectedProjectSessionEpoch = projectState.projectSessionEpoch
    if (!projectPath || !projectSession) {
      refreshRequestGate.current.begin()
      return
    }
    const requestId = refreshRequestGate.current.begin()
    setRefreshing(true)
    try {
      // 通过服务层获取架构状态和蓝图数量（避免直接进行进程通信）
      const { checkArchStatus, getBlueprintCount } = await import('../../../services/architecture-service')
      const [, , status, count] = await Promise.all([
        useProjectStore.getState().refreshFileTree(projectPath, expectedProjectSessionEpoch, projectSession),
        useDraftStore.getState().loadAllDrafts(projectPath, projectSession),
        checkArchStatus(projectSession),
        getBlueprintCount(projectSession),
        useWorldMapStore.getState().loadAll(projectPath),
        useWorldWorkbenchStore.getState().loadAll(projectPath),
      ])
      if (
        !refreshRequestGate.current.isLatest(requestId)
        || !isProjectSessionCurrent(projectSession)
        || useProjectStore.getState().projectSessionEpoch !== expectedProjectSessionEpoch
      ) return
      setArchStatus(status)
      setBlueprintCount(count)
    } catch (error) {
      if (
        refreshRequestGate.current.isLatest(requestId)
        && isProjectSessionCurrent(projectSession)
        && useProjectStore.getState().projectSessionEpoch === expectedProjectSessionEpoch
      ) {
        toast.error(text(
          `项目资源刷新失败：${String(error)}`,
          `Could not refresh project resources: ${String(error)}`,
        ))
      }
    } finally {
      if (refreshRequestGate.current.isLatest(requestId)) setRefreshing(false)
    }
  }, [text])

  // 项目切换时刷新
  useEffect(() => {
    const transition = beginProjectTreeIdentityTransition(
      refreshRequestGate.current,
      currentProject?.path,
      projectSessionEpoch,
    )
    if (!transition.hasProject) {
      queueMicrotask(() => {
        if (
          refreshRequestGate.current.isLatest(transition.requestId)
          && !useProjectStore.getState().currentProject
        ) {
          setArchStatus({})
          setBlueprintCount(-1)
          setRefreshing(false)
        }
      })
      return
    }
    const projectPath = currentProject!.path
    queueMicrotask(() => {
      if (
        !refreshRequestGate.current.isLatest(transition.requestId)
        || useProjectStore.getState().currentProject?.path !== projectPath
        || useProjectStore.getState().projectSessionEpoch !== transition.projectSessionEpoch
      ) return
      void refreshAll()
    })
  }, [currentProject?.path, projectSessionEpoch, refreshAll]) // eslint-disable-line react-hooks/exhaustive-deps -- currentProject 对象引用变化不每次都需重跑

  useEffect(() => globalEventBus.on('ARCH_FILE_UPDATED', (payload) => {
    if (!isProjectSessionCurrent(payload.projectSession)) return
    void refreshAll()
  }), [refreshAll])

  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', (payload) => {
    if (!isProjectSessionCurrent(payload.projectSession)) return
    if (!shouldRefreshBlueprints(payload.resources)) return
    void refreshAll()
  }), [refreshAll])

  // 工作流步骤状态或整体状态变化时刷新侧边栏（适配多任务）
  // 合并为单一 effect + 防抖，避免一次步骤完成同时触发多次刷新
  const workflowKey = activeRuns.map(r => `${r.id}:${r.status}|${r.steps.map(s => s.status).join(',')}`).join(';')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!currentProject) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      refreshAll()
    }, 80)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // 依赖 path 字符串而非 currentProject 对象引用
    //    避免 updateNovelConfig 改变对象引用后触发不必要的 refreshAll
  }, [workflowKey, currentProject?.path, refreshAll]) // eslint-disable-line react-hooks/exhaustive-deps -- currentProject 对象引用变化不触发，仅 path 变化需响应

  if (!currentProject) {
    return (
      <div className="writer-project-tree h-full">
        <EmptyState
          icon={<span className="text-4xl opacity-60" style={{ color: 'var(--color-text-muted)' }}><FolderOpen size={36} /></span>}
          message={text('未打开项目', 'No project open')}
          className="p-4 pb-[15vh]"
          opacity={1}
        >
          <span
            className="text-xs text-center mt-0.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {text('新建或打开一个小说项目开始创作', 'Create or open a novel project to begin.')}
          </span>
          {/* 操作按钮 */}
          <div className="flex flex-col gap-2 mt-3 w-full">
            <Button
              variant="default"
              className="w-full"
              onClick={() => useLayoutStore.getState().openNewProject()}
            >
              {text('新建项目', 'New project')}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                const folder = await ipc.invoke('dialog:select-folder')
                if (folder) {
                  useProjectStore.getState().openProject(folder)
                }
              }}
            >
              {text('打开项目', 'Open project')}
            </Button>
          </div>
        </EmptyState>
      </div>
    )
  }

  // 改为彻底的数据驱动：从内存的全部草稿中提取已发布正文。
  const manuscriptFiles = Object.values(draftsByChapter)
    .map(drafts => drafts.find(d => d.status === 'finalized'))
    .filter(Boolean)
    .sort((a, b) => a!.chapterNumber - b!.chapterNumber)
    .map(draft => ({
      path: `vela://manuscript/${draft!.id}`, // 诸如 vela://manuscript/42
      name: `chapter_${draft!.chapterNumber}.md`, // 提供格式化的伪文件名供组件适配解析
      isDir: false,
      chapterTitle: draft!.chapterTitle,
      blueprintChapterNumber: draft!.blueprintChapterNumber,
    }))
  // 尚未定稿的章节数：草稿箱里还有稿子的章节，正文入口的进度提示。
  const draftChapterCount = Object.values(draftsByChapter)
    .filter(drafts => drafts.some(d => d.status !== 'archived' && d.status !== 'finalized'))
    .length

  // 仅表示是否已经录入故事构想，不代表创作方向表单全部完成。
  const nc = currentProject.novelConfig
  const configDone = !!(nc.coreOutline?.trim() || nc.protagonistProfile?.trim())

  const openOverview = () => openBuiltinEditor('project-overview', text('项目总览', 'Project overview'), 'overview')
  const openWorldMap = () => openBuiltinEditor('world-map-editor', text('地图册', 'Map atlas'), 'world-map')
  const openWorldWorkbench = () => openBuiltinEditor('world-workbench', text('世界管理', 'World management'), 'world')
  const openStoryTimeline = () => openBuiltinEditor('story-timeline-editor', text('故事时间线', 'Story timeline'), 'story-timeline')
  const openForeshadowing = () => openBuiltinEditor('foreshadowing-manager', text('伏笔管理', 'Foreshadowing'), 'foreshadowing')
  const openBasicSettingsOverview = () => openBuiltinEditor(
    'world-building-editor',
    text('基础设定总览', 'Basic settings overview'),
    'world-building',
  )
  const openConfigEditor = () => useEditorStore.getState().openFile({
    id: 'config',
    name: text('创作方向', 'Creative direction'),
    type: 'config',
    projectKey: currentProject.path,
  })
  const openCultivationEditor = () => useEditorStore.getState().openFile({
    id: 'cultivation-settings', name: text('修炼体系', 'Cultivation system'),
    type: 'cultivation', projectKey: currentProject.path,
  })

  const handleBackup = async () => {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const destination = await ipc.invoke('dialog:select-export-directory')
      if (!destination) return
      const result = await ipc.invoke('project:backup', destination.grantId)
      if (!result.success) throw new Error(result.error ?? text('备份失败', 'Backup failed'))
      toast.success(text(
        `项目状态已备份（${result.fileCount ?? 0} 个文件）`,
        `Project state backed up (${result.fileCount ?? 0} files)`,
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('备份失败', 'Backup failed'))
    } finally {
      setBackupBusy(false)
    }
  }

  const handleRestoreBackup = async () => {
    if (backupBusy) return
    const accepted = await confirm(
      text(
        '恢复只会写入你随后选择的“新项目目录”，不会覆盖已有 .vela 数据，也不会修改小说母稿。是否继续？',
        'Restore writes only to the new project directory you choose next. It never overwrites existing .vela data or modifies a linked manuscript. Continue?',
      ),
      { title: text('恢复项目备份', 'Restore project backup'), confirmText: text('选择备份', 'Choose backup') },
    )
    if (!accepted) return
    setBackupBusy(true)
    try {
      const backup = await ipc.invoke('dialog:select-backup-directory')
      if (!backup) return
      const target = await ipc.invoke('dialog:select-restore-directory')
      if (!target) return
      const result = await ipc.invoke('project:restore-backup', backup.grantId, target.grantId)
      if (!result.success) throw new Error(result.error ?? text('恢复失败', 'Restore failed'))
      toast.success(text(
        `项目状态已恢复（${result.fileCount ?? 0} 个文件）。可打开恢复目录继续使用。`,
        `Project state restored (${result.fileCount ?? 0} files). Open the restored directory to continue.`,
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('恢复失败', 'Restore failed'))
    } finally {
      setBackupBusy(false)
    }
  }

  const renderArchFileMenuItem = (key: string) => {
    const file = ARCH_FILES.find(candidate => candidate.key === key)
    if (!file) return null
    return (
      <SidebarMenuItem key={file.key}>
        <ArchFileRow
          f={file}
          filePath={`vela://core/${file.key}`}
          hasContent={archStatus[file.key]}
          onCleared={refreshAll}
        />
      </SidebarMenuItem>
    )
  }

  return (
    <div className="writer-project-tree min-h-full text-sm py-1">
      {/* 项目名 + 刷新 */}
      <div className="flex items-center justify-between gap-1 px-3 py-1.5 mb-0.5">
        <span className="font-semibold text-xs truncate" style={{ color: 'var(--color-text)' }}>
          {currentProject.name}
        </span>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <IconTooltip label={text('刷新项目资源', 'Refresh project resources')}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { void refreshAll() }}
              disabled={refreshing}
            >
              <RefreshCw size={12} />
            </Button>
          </IconTooltip>
        </div>
      </div>

      {/* 顶层导航：项目总览固定在项目树最上方，其余五个分组按作者任务自上而下排列 */}
      <SidebarGroup className="py-0.5 px-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <LeafItem
              iconName="layout-dashboard"
              label={text('项目总览', 'Project overview')}
              desc={text('小说创作进度与核心看板', 'Novel creative dashboard and progress')}
              onClick={openOverview}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <div
        className="mx-3 my-1 border-t"
        style={{ borderColor: 'var(--color-border)' }}
        aria-hidden="true"
      />

      {/* 1. 故事设定 */}
      <ProjectTreeCollapsibleGroup
        id="setting"
        title={text('故事设定', 'Story setup')}
        detail={text('创作方向、故事前提、人物与世界设定', 'Creative direction, story premise, characters, and world setup')}
        icon={BookOpen}
        isOpen={projectTreeGroupOpen.setting ?? true}
        onOpenChange={(nextOpen) => setProjectTreeGroupOpen('setting', nextOpen)}
      >
        <SidebarMenuItem>
          <LeafItem
            iconName="book-open"
            label={text('基础设定总览', 'Basic settings overview')}
            desc={text('查看设定内容状态，打开原文档或选择批量生成', 'Review content status, open source documents, or choose batch generation')}
            onClick={openBasicSettingsOverview}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="book-open"
            label={text('创作方向', 'Creative direction')}
            desc={text('基础信息、故事构想与写作要求', 'Basic information, initial ideas, and writing requirements')}
            badge={configDone ? text('已有构想', 'Idea present') : text('待补充构想', 'Add an idea')}
            badgeDone={configDone}
            onClick={openConfigEditor}
            onContextMenu={e => showSidebarMenu([
              {
                key: 'open',
                label: text('打开创作方向', 'Open creative direction'),
                icon: <FolderOpen size={13} />,
                onClick: openConfigEditor,
              },
            ], e)}
          />
        </SidebarMenuItem>
        {renderArchFileMenuItem('premise')}
        <SidebarMenuItem>
          <LeafItem
            iconName="users"
            label={text('角色档案', 'Character profile')}
            desc={text('角色事实来源：档案、关系、动机、弧光与当前状态', 'Single source of truth: profiles, relationships, motivations, arcs, and state')}
            onClick={() => useLayoutStore.getState().openCharacterProfile()}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <ProjectTreeCollapsibleGroup
            id="worldSetup"
            level={2}
            title={text('世界设定', 'World setup')}
            detail={text('世界观总纲、结构化世界管理、地图册与修炼体系', 'Worldbuilding overview, world management, map atlas, and cultivation system')}
            icon={Globe2}
            isOpen={projectTreeGroupOpen.worldSetup ?? false}
            onOpenChange={(nextOpen) => setProjectTreeGroupOpen('worldSetup', nextOpen)}
          >
            {renderArchFileMenuItem('worldbuilding')}
            <SidebarMenuItem>
              <LeafItem
                iconName="globe-2"
                label={text('世界管理', 'World management')}
                desc={text(
                  '结构化世界实体：世界、势力、秘境、通道、规则、历史事件与人物行踪',
                  'Structured records for worlds, factions, relics, portals, rules, history, and character trails',
                )}
                badge={worldCount > 0 ? text(`${worldCount} 个世界`, `${worldCount} worlds`) : text('待创建', 'Empty')}
                badgeColor={worldCount > 0 ? 'var(--color-accent)' : undefined}
                badgeDone={worldCount > 0}
                onClick={openWorldWorkbench}
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <LeafItem
                iconName="compass"
                label={text('地图册', 'Map atlas')}
                desc={text('地图、地点与空间拓扑网络', 'World maps, locations, and spatial relationships')}
                badge={mapNodes.length > 0 ? text(`${mapNodes.length} 处地点`, `${mapNodes.length} locations`) : text('待创建', 'Empty')}
                badgeColor={mapNodes.length > 0 ? 'var(--color-accent)' : undefined}
                badgeDone={mapNodes.length > 0}
                onClick={openWorldMap}
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <LeafItem
                iconName="bar-chart-3"
                label={text('修炼体系', 'Cultivation system')}
                desc={text('项目级境界体系、等级顺序与角色绑定', 'Project realms, level order, and character bindings')}
                onClick={openCultivationEditor}
              />
            </SidebarMenuItem>
          </ProjectTreeCollapsibleGroup>
        </SidebarMenuItem>
      </ProjectTreeCollapsibleGroup>

      {/* 2. 创作规划 */}
      <ProjectTreeCollapsibleGroup
        id="plan"
        title={text('创作规划', 'Writing plan')}
        detail={text(
          '全书总纲、分卷卷纲、章节细纲、章节脉络、故事时间线与伏笔管理',
          'Book outline, volume outlines, chapter blueprints, chapter thread, story timeline, and foreshadowing',
        )}
        icon={Layers}
        badge={blueprintCount > 0 ? text(`${blueprintCount} 章蓝图`, `${blueprintCount} blueprints`) : undefined}
        isOpen={projectTreeGroupOpen.plan ?? true}
        onOpenChange={(nextOpen) => setProjectTreeGroupOpen('plan', nextOpen)}
      >
        <SidebarMenuItem>
          <LeafItem
            iconName="layout-list"
            label={text('章节蓝图', 'Chapter blueprints')}
            desc={text(
              `全书总纲、分卷卷纲与逐章细纲；共 ${nc.totalChapters} 章，可直接从这里写正文`,
              `Book outline, volume outlines, and per-chapter blueprints; ${nc.totalChapters} chapters, with direct drafting`,
            )}
            badge={blueprintCount > 0 ? text(`${blueprintCount}/${nc.totalChapters} 章`, `${blueprintCount}/${nc.totalChapters} chapters`) : text('待生成', 'Pending')}
            badgeColor={
              blueprintCount >= nc.totalChapters
                ? 'var(--color-success-text)'
                : blueprintCount > 0
                  ? 'var(--color-warning-text, #7A5414)'
                  : undefined
            }
            badgeDone={blueprintCount >= nc.totalChapters}
            onClick={() => openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card', undefined, undefined, undefined, { kind: 'book' })}
            onContextMenu={e => showSidebarMenu([
              {
                key: 'open',
                label: text('打开章节蓝图', 'Open chapter blueprints'),
                icon: <FolderOpen size={13} />,
                onClick: () => openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card', undefined, undefined, undefined, { kind: 'book' }),
              },
            ], e)}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="git-branch"
            label={text('章节脉络', 'Chapter thread')}
            desc={text(
              '由章节蓝图与定稿确定性投影出的章节事件、主线与伏笔脉络，零模型依赖',
              'Deterministic projection of blueprints and finalized chapters into chapter events, main line, and setups',
            )}
            onClick={() => openBuiltinEditor('narrative-thread-editor', text('章节脉络', 'Chapter thread'), 'narrative-thread')}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="clock-3"
            label={text('故事时间线', 'Story timeline')}
            desc={text(
              '手动刻度、自定义时间与故事事件；作者自己排布的时间轴',
              'Manual ruler, custom time labels, and story events arranged by the author',
            )}
            onClick={openStoryTimeline}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="bookmark"
            label={text('伏笔管理', 'Foreshadowing')}
            desc={text(
              '正文原文锚定的伏笔标记：埋设、加深与回收追踪',
              'Prose-anchored foreshadowing markers with setup, deepening, and payoff tracking',
            )}
            onClick={openForeshadowing}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="book-open"
            label={text('信息与揭露', 'Info & Revelation')}
            desc={text(
              '信息条目、人物知情与读者记录：区分实际真相、误解隐瞒与揭露时机',
              'Info entries, character knowledge, and reader records: truth vs misconception, concealment, and reveal timing',
            )}
            onClick={() => openBuiltinEditor('knowledge-gap', text('信息与揭露', 'Info & Revelation'), 'knowledge-gap')}
          />
        </SidebarMenuItem>
      </ProjectTreeCollapsibleGroup>

      {/* 3. 正文写作：紧随创作规划，让写正文的入口在项目树上半部分就能看到 */}
      <ProjectTreeCollapsibleGroup
        id="manuscript"
        title={text('正文写作', 'Manuscript')}
        detail={text(
          '草稿箱与正文章节；章节蓝图页的「写作第 N 章」也直达这里',
          'Draft box and published chapters; the “Write Chapter N” action on the blueprint page lands here too',
        )}
        icon={PenTool}
        badge={manuscriptFiles.length > 0 || draftChapterCount > 0
          ? text(
              `${draftChapterCount} 章草稿 · ${manuscriptFiles.length} 章正文`,
              `${draftChapterCount} draft chapters · ${manuscriptFiles.length} published`,
            )
          : undefined}
        isOpen={projectTreeGroupOpen.manuscript ?? true}
        onOpenChange={(nextOpen) => setProjectTreeGroupOpen('manuscript', nextOpen)}
      >
        <SidebarMenuItem>
          <LeafItem iconName="file-pen" label={text('草稿箱', 'Draft box')} onClick={() => openProseDirectory('draft')} />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem iconName="book-open" label={text('正文章节', 'Manuscript chapters')} onClick={() => openProseDirectory('manuscript')} />
        </SidebarMenuItem>
      </ProjectTreeCollapsibleGroup>

      {/* 4. 资料库 */}
      <ProjectTreeCollapsibleGroup
        id="library"
        title={text('资料库', 'Library')}
        detail={text('自由文档、资料来源审核与知识检索', 'Free documents, source review, and knowledge retrieval')}
        icon={Library}
        isOpen={projectTreeGroupOpen.library ?? false}
        onOpenChange={(nextOpen) => setProjectTreeGroupOpen('library', nextOpen)}
      >
        <SidebarMenuItem>
          <LeafItem
            iconName="file-pen"
            label={text('项目文档', 'Project documents')}
            desc={text('设定笔记、卷纲、灵感与资料摘录的自由 Markdown 文档', 'Free Markdown notes, outlines, ideas, and excerpts')}
            onClick={() => setSidebarView('documents')}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="target"
            label={text('资料来源与审核', 'Sources & review')}
            desc={text('原始资料、文件来源、审核、批准快照与章节上下文', 'Raw sources, file provenance, review, approved snapshots, and chapter context')}
            onClick={() => setSidebarView('workspace')}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="brain-circuit"
            label={text('知识检索', 'Knowledge retrieval')}
            desc={text('检索作者已明确加入的内容；不会自动收录资料或项目文档', 'Search only what the author explicitly added; nothing is indexed automatically')}
            onClick={() => setSidebarView('knowledge')}
          />
        </SidebarMenuItem>
      </ProjectTreeCollapsibleGroup>

      {/* 5. 项目管理 */}
      <ProjectTreeCollapsibleGroup
        id="management"
        title={text('项目管理', 'Project management')}
        detail={text('本项目的导入、导出与配置', 'Import, export, and configuration for this project')}
        icon={FolderCog}
        isOpen={projectTreeGroupOpen.management ?? false}
        onOpenChange={(nextOpen) => setProjectTreeGroupOpen('management', nextOpen)}
      >
        <SidebarMenuItem>
          <LeafItem
            iconName="folder-open"
            label={text('导入创作资料', 'Import writing material')}
            desc={text('导入内容前会显示项目范围与确认步骤', 'Import content with project scope and confirmation')}
            onClick={() => useLayoutStore.getState().openImportNovel()}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="file-text"
            label={text('导出项目', 'Export project')}
            desc={text('导出当前项目的创作成果', 'Export this project’s work')}
            onClick={() => useLayoutStore.getState().openExport()}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="archive"
            label={text('备份项目', 'Back up project')}
            desc={text('将当前项目状态备份到你选择的目录', 'Back up the current project state to a directory you choose')}
            badge={backupBusy ? text('处理中', 'Working') : undefined}
            onClick={() => void handleBackup()}
          />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <LeafItem
            iconName="rotate-ccw"
            label={text('恢复项目备份', 'Restore project backup')}
            desc={text('恢复到新项目目录，不覆盖已有项目', 'Restore to a new project directory without overwriting an existing project')}
            badge={backupBusy ? text('处理中', 'Working') : undefined}
            onClick={() => void handleRestoreBackup()}
          />
        </SidebarMenuItem>
      </ProjectTreeCollapsibleGroup>
    </div>
  )
}

function ProjectTreeCollapsibleGroup({
  id,
  level = 1,
  title,
  detail,
  icon: Icon,
  badge,
  isOpen,
  onOpenChange,
  children,
}: {
  id: string
  level?: 1 | 2
  title: string
  detail?: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
  /** 纯文本进度摘要；分组标题栏内不放任何按钮。 */
  badge?: string
  isOpen: boolean
  onOpenChange: (nextOpen: boolean) => void
  children: React.ReactNode
}) {
  return (
    <SidebarGroup className="py-0.5 px-1" data-group-id={id} data-group-level={level}>
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <SidebarGroupLabel asChild className="p-0 h-auto">
          <CollapsibleTrigger
            aria-label={title}
            aria-expanded={isOpen}
            title={detail ?? title}
            className="group/trigger flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] transition-colors cursor-pointer select-none border-0 bg-transparent text-left"
          >
            <span className="flex items-center gap-2 min-w-0 flex-1">
              <Icon size={14} className="flex-shrink-0 text-[var(--color-text-muted)] group-hover/trigger:text-[var(--color-text)] transition-colors" />
              <span className="truncate tracking-wide font-medium">{title}</span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-1.5 ml-1">
              {badge && (
                <span
                  className="truncate max-w-[9rem] text-[0.7rem] font-normal tabular-nums text-[var(--color-text-muted)] group-hover/trigger:text-[var(--color-text-secondary)] transition-colors"
                  data-group-badge={id}
                >
                  {badge}
                </span>
              )}
              <span className="text-[var(--color-text-muted)] group-hover/trigger:text-[var(--color-text)] transition-colors">
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            </span>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent className="pt-0.5">
            <SidebarMenu>
              {children}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  )
}


/** 单个架构文件行 */
function ArchFileRow({
  f,
  filePath,
  hasContent,
  onCleared,
}: {
  f: ArchFile
  filePath: string
  hasContent: boolean
  onCleared: () => void | Promise<void>
}) {
  const text = useLocaleStore(s => s.text)
  const english = { label: f.labelEn, desc: f.descEn }
  const label = text(f.label, english.label)
  const isCharacterProjection = f.key === 'characters'
  const clearArchFile = async () => {
    if (isCharacterProjection) return
    const projectSession = await confirmCurrentProjectSession(
      useProjectStore.getState().currentProject,
      () => confirm(text(`确认清空「${f.label}」内容？\n此操作只清除此份设定文档，不影响其他设定文档、蓝图或正文。`, `Clear “${english.label}”?\nThis removes only this setup document and preserves the other documents, blueprints, and manuscript.`), {
        title: text('清空设定文档', 'Clear setup document'),
        confirmText: text('清空', 'Clear'),
        danger: true,
      }),
    )
    if (!projectSession) return
    const projectKey = projectSession.projectPath

    const { writeCoreContent } = await import('../../../services/vela-protocol')
    const success = await writeCoreContent(filePath, '', projectSession)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!success) {
      toast.error(text(`清空「${f.label}」失败`, `Could not clear “${english.label}”`))
      return
    }

    const store = useEditorStore.getState()
    const tabId = createProjectArchTabId(projectKey, filePath)
    store.syncTabContent(tabId, '')
    store.markTabSaved(tabId, '')
    await onCleared()
    if (!isProjectSessionCurrent(projectSession)) return
    toast.success(text(`已清空「${f.label}」`, `Cleared “${english.label}”`))
  }

  return (
    <div
      className="tree-item gap-1.5 cursor-pointer select-none"
      style={{ paddingLeft: 26 }}
      data-arch-file-key={f.key}
      onClick={() => openArchFile(filePath, label)}
      onContextMenu={e => showSidebarMenu([
        {
          key: 'open',
          label: text('打开文件', 'Open file'),
          icon: <FolderOpen size={13} />,
          onClick: () => openArchFile(filePath, label),
        },
        { key: 'div1', type: 'divider' as const },
        {
          key: 'copy-path',
          label: text('复制文件路径', 'Copy file path'),
          icon: <Copy size={13} />,
          onClick: () => navigator.clipboard.writeText(filePath).catch(() => { }),
        },
        ...(isCharacterProjection ? [] : [
          { key: 'div2', type: 'divider' as const },
          {
            key: 'delete',
            label: text(`清空${f.label}`, `Clear ${english.label}`),
            icon: <Trash2 size={13} />,
            danger: true,
            disabled: !hasContent,
            onClick: clearArchFile,
          },
        ]),
      ], e)}
      title={text(f.desc, english.desc)}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent p-0 text-left font-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        aria-label={text(`打开${f.label}`, `Open ${english.label}`)}
        onClick={event => {
          event.stopPropagation()
          void openArchFile(filePath, label)
        }}
      >
        {hasContent
          ? <CheckCircle2 size={10} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
          : <Circle size={6} style={{ flexShrink: 0, fill: 'transparent', stroke: 'var(--color-text-muted)' }} />
        }
        <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{renderIcon(f.iconName, 13)}</span>
        <span
          className="text-sm min-w-0 flex-1 truncate"
          style={{ color: hasContent ? 'var(--color-text)' : 'var(--color-text-secondary)' }}
        >
          {label}
        </span>
      </button>
      {hasContent ? (
        <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {text('有内容', 'Has content')}
        </span>
      ) : (
        <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {text('待补充', 'Needs content')}
        </span>
      )}
      {hasContent && !isCharacterProjection && (
        <IconTooltip label={text(`清空${f.label}`, `Clear ${english.label}`)}>
          <button
            type="button"
            className="opacity-70 hover:opacity-100 rounded p-0.5"
            onClick={(e) => {
              e.stopPropagation()
              clearArchFile()
            }}
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Trash2 size={11} />
          </button>
        </IconTooltip>
      )}
    </div>
  )
}
