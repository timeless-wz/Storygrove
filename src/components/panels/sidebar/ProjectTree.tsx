/**
 * ProjectTree — 项目导航树（侧边栏核心视图）
 *
 * 包含：小说配置、故事架构、章节蓝图、草稿箱、正文章节、全局摘要
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, CheckCircle2, Circle, FolderOpen, Copy, FolderTree, Sparkles, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { ipc } from '../../../services/ipc-client'
import { Button } from '../../ui/Button'
import { IconTooltip } from '../../ui/Tooltip'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import ClearProjectDataDialog from '../../dialogs/ClearProjectDataDialog'



import { LeafItem } from './SidebarShared'
import { ARCH_FILES } from './sidebar-arch-files'
import {
  confirmCurrentProjectSession,
  openArchFile,
  openBuiltinEditor,
} from './sidebar-file-openers'
import { renderIcon } from './sidebar-icons'
import { showSidebarMenu } from './sidebar-menu'
import { createProjectArchTabId } from '../../editor/arch-file-refresh-policy'
import DraftBoxGroup from './DraftBoxGroup'
import ManuscriptGroup from './ManuscriptGroup'
import { useLocaleStore } from '../../../stores/locale-store'
import { LatestRequestGate } from '../../editor/latest-request-gate'
import { beginProjectTreeIdentityTransition } from './project-tree-refresh-policy'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../../project-session-gate'
import { globalEventBus } from '../../../shared/event-bus'
import { shouldRefreshBlueprints } from '../../editor/blueprint-refresh'

const ARCH_FILE_EN: Record<string, { label: string; desc: string }> = {
  premise: { label: 'Premise', desc: 'Core premise and conflict' },
  worldbuilding: { label: 'World building', desc: 'World rules and systems' },
  synopsis: { label: 'Plot outline', desc: 'Whole-book plan and pacing' },
}

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
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const refreshRequestGate = useRef(new LatestRequestGate())
  const mapNodes = useWorldMapStore(s => s.nodes)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)

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
          setClearDialogOpen(false)
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

  const p = currentProject.path
  // 改为彻底的数据驱动：从内存的全部草稿中提取 status='finalized' 的草稿
  const manuscriptFiles = Object.values(draftsByChapter)
    .map(drafts => drafts.find(d => d.status === 'finalized'))
    .filter(Boolean)
    .sort((a, b) => a!.chapterNumber - b!.chapterNumber)
    .map(draft => ({
      path: `vela://manuscript/${draft!.id}`, // 诸如 vela://manuscript/42
      name: `chapter_${draft!.chapterNumber}.md`, // 提供格式化的伪文件名供组件适配解析
      isDir: false,
      chapterTitle: draft!.chapterTitle,
    }))

  // 小说配置是否已完成（核心大纲非空视为已完成）
  const nc = currentProject.novelConfig
  const configDone = !!(nc.coreOutline?.trim() || nc.protagonistProfile?.trim())

  // 故事架构进度
  const archDone = ARCH_FILES.filter(f => archStatus[f.key]).length
  const clearDisabled = activeRuns.length > 0

  const openOverview = () => openBuiltinEditor('project-overview', text('项目总览', 'Project overview'), 'overview')
  const openWorldMap = () => openBuiltinEditor('world-map-editor', text('多地图地图册', 'Map atlas'), 'world-map')
  const openStoryTimeline = () => openBuiltinEditor('story-timeline-editor', text('故事时间线', 'Story timeline'), 'story-timeline')
  const openConfigEditor = () => useEditorStore.getState().openFile({
    id: 'config',
    name: text('创作参数', 'Creative parameters'),
    type: 'config',
    projectKey: currentProject.path,
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

  return (
    <div className="writer-project-tree min-h-full text-sm py-1">
      {/* 项目名 + 刷新 */}
      <div className="flex items-center justify-between gap-1 px-3 py-1.5 mb-0.5">
        <span className="font-semibold text-xs truncate" style={{ color: 'var(--color-text)' }}>
          {currentProject.name}
        </span>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClearDialogOpen(true)}
            disabled={clearDisabled}
            title={clearDisabled
              ? text('工作流运行中，暂不能清除', 'A workflow is running. Project data cannot be cleared yet.')
              : text('清除项目生成内容', 'Clear generated project data')}
          >
            <Trash2 size={12} />
            {text('清除全部', 'Clear all')}
          </Button>
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

      <ClearProjectDataDialog
        open={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onCleared={refreshAll}
      />

      {/* 顶层导航 */}
      <LeafItem
        iconName="layout-dashboard"
        label={text('项目总览', 'Project overview')}
        desc={text('小说创作进度与核心看板', 'Novel creative dashboard and progress')}
        onClick={openOverview}
      />

      <ProjectTreeSection
        title={text('创作规划', 'Writing plan')}
        detail={text('章节蓝图与叙事线索', 'Chapter blueprints and narrative threads')}
      />

      <LeafItem
        iconName="compass"
        label={text('多地图地图册', 'Map atlas')}
        desc={text('地点、势力与空间拓扑网络', 'Locations, factions, and spatial network')}
        badge={mapNodes.length > 0 ? text(`${mapNodes.length} 处地点`, `${mapNodes.length} locations`) : text('待创建', 'Empty')}
        badgeColor={mapNodes.length > 0 ? 'var(--color-accent)' : undefined}
        badgeDone={mapNodes.length > 0}
        onClick={openWorldMap}
      />

      {/* 章节蓝图 */}
      <LeafItem
        iconName="layout-list"
        label={text('章节蓝图', 'Chapter blueprints')}
        desc={text('1~58 章细纲与关键事件，可直接写正文', 'Chapters 1-58 detailed outlines, direct prose drafting')}
        badge={blueprintCount > 0 ? text(`${blueprintCount}/${nc.totalChapters} 章`, `${blueprintCount}/${nc.totalChapters} chapters`) : text('待生成', 'Pending')}
        badgeColor={
          blueprintCount >= nc.totalChapters
            ? 'var(--color-success-text)'
            : blueprintCount > 0
              ? 'var(--color-warning-text, #7A5414)'
              : undefined
        }
        badgeDone={blueprintCount >= nc.totalChapters}
        onClick={() => openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card')}
        onContextMenu={e => showSidebarMenu([
          {
            key: 'open',
            label: text('打开章节蓝图', 'Open chapter blueprints'),
            icon: <FolderOpen size={13} />,
            onClick: () => openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card'),
          },
        ], e)}
      />

      {/* 章节脉络：章节蓝图的确定性投影 */}
      <LeafItem
        iconName="git-branch"
        label={text('章节脉络', 'Chapter thread')}
        desc={text('由章节蓝图确定性投影的章节事件与伏笔脉络，零模型依赖', 'Deterministic projection of blueprints into chapter events and setups')}
        onClick={() => openBuiltinEditor('narrative-thread-editor', text('章节脉络', 'Chapter thread'), 'narrative-thread')}
      />

      <LeafItem
        iconName="clock-3"
        label={text('故事时间线', 'Story timeline')}
        desc={text('手动刻度、自定义时间与故事事件', 'Manual ruler, custom time labels, and story events')}
        onClick={openStoryTimeline}
      />

      <ProjectTreeSection
        title={text('故事设定', 'Story setup')}
        detail={text('创作参数、架构文档与角色档案', 'Creative parameters, architecture documents, and characters')}
      />

      {/* 创作参数：作品元数据与创作约束 */}
      <LeafItem
        iconName="book-open"
        label={text('创作参数', 'Creative parameters')}
        desc={text('书名、题材、受众、章数与叙事视角', 'Title metadata, genre, audience, chapters, and point of view')}
        badge={configDone ? text('已完成', 'Complete') : text('待配置', 'Pending')}
        badgeDone={configDone}
        onClick={openConfigEditor}
        onContextMenu={e => showSidebarMenu([
          {
            key: 'open',
            label: text('打开创作参数', 'Open creative parameters'),
            icon: <FolderOpen size={13} />,
            onClick: openConfigEditor,
          },
        ], e)}
      />

      {/* 故事架构：分组标题不再直接打开编辑器，下面只有三个可编辑的架构文档 */}
      <WorldBuildingGroup archStatus={archStatus} archDone={archDone} onCleared={refreshAll} />

      {/* 角色档案：唯一的角色入口，关系图谱是它内部的只读视图 */}
      <LeafItem
        iconName="users"
        label={text('角色档案', 'Character profile')}
        desc={text('角色事实来源：档案、关系、动机、弧光与当前状态', 'Single source of truth: profiles, relationships, motivations, arcs, and state')}
        onClick={() => useLayoutStore.getState().openCharacterProfile('overview')}
      />

      <ProjectTreeSection
        title={text('资料库', 'Library')}
        detail={text('自由文档、资料来源审核与知识检索', 'Free documents, source review, and knowledge retrieval')}
      />

      {/* 项目文档：作者自由创建的 Markdown 资料 */}
      <LeafItem
        iconName="file-pen"
        label={text('项目文档', 'Project documents')}
        desc={text('设定笔记、卷纲、灵感与资料摘录的自由 Markdown 文档', 'Free Markdown notes, outlines, ideas, and excerpts')}
        onClick={() => setSidebarView('documents')}
      />

      {/* 资料来源与审核：原始资料、快照、批准与版本 */}
      <LeafItem
        iconName="target"
        label={text('资料来源与审核', 'Sources & review')}
        desc={text('原始资料、文件来源、审核、批准快照与章节上下文', 'Raw sources, file provenance, review, approved snapshots, and chapter context')}
        onClick={() => setSidebarView('workspace')}
      />

      {/* 知识检索：只检索作者已明确加入的内容 */}
      <LeafItem
        iconName="brain-circuit"
        label={text('知识检索', 'Knowledge retrieval')}
        desc={text('检索作者已明确加入的内容；不会自动收录资料或项目文档', 'Search only what the author explicitly added; nothing is indexed automatically')}
        onClick={() => setSidebarView('knowledge')}
      />

      <ProjectTreeSection
        title={text('项目管理', 'Project management')}
        detail={text('本项目的导入、导出与配置', 'Import, export, and configuration for this project')}
      />

      <LeafItem
        iconName="folder-open"
        label={text('导入创作资料', 'Import writing material')}
        desc={text('导入内容前会显示项目范围与确认步骤', 'Import content with project scope and confirmation')}
        onClick={() => useLayoutStore.getState().openImportNovel()}
      />
      <LeafItem
        iconName="file-text"
        label={text('导出项目', 'Export project')}
        desc={text('导出当前项目的创作成果', 'Export this project’s work')}
        onClick={() => useLayoutStore.getState().openExport()}
      />
      <LeafItem
        iconName="archive"
        label={text('备份项目', 'Back up project')}
        desc={text('将当前项目状态备份到你选择的目录', 'Back up the current project state to a directory you choose')}
        badge={backupBusy ? text('处理中', 'Working') : undefined}
        onClick={() => void handleBackup()}
      />
      <LeafItem
        iconName="rotate-ccw"
        label={text('恢复项目备份', 'Restore project backup')}
        desc={text('恢复到新项目目录，不覆盖已有项目', 'Restore to a new project directory without overwriting an existing project')}
        badge={backupBusy ? text('处理中', 'Working') : undefined}
        onClick={() => void handleRestoreBackup()}
      />

      <ProjectTreeSection
        title={text('正文创作', 'Manuscript')}
        detail={text('草稿与已定稿章节', 'Drafts and finalized chapters')}
      />

      {/* 草稿箱 */}
      <DraftBoxGroup draftsByChapter={draftsByChapter} />

      {/* 正文章节 — 仅显示已定稿 */}
      <ManuscriptGroup files={manuscriptFiles} projectPath={p} />
    </div>
  )
}

function ProjectTreeSection({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="writer-project-section-title" title={detail}>
      <span>{title}</span>
      <span>{detail}</span>
    </div>
  )
}


// ===== 故事架构折叠组 =====

function WorldBuildingGroup({
  archStatus,
  archDone,
  onCleared,
}: {
  archStatus: Record<string, boolean>
  archDone: number
  onCleared: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(true)
  const text = useLocaleStore(s => s.text)

  const allDone = archDone === ARCH_FILES.length

  return (
    <div>
      {/*
       * 分组标题本身不再打开编辑器：故事架构下只有三个可编辑的架构文档，
       * 打开总览（AI 生成 / 断点续写）保留为独立的显式动作。
       */}
      <div
        className="tree-item gap-1.5 select-none"
        style={{ paddingLeft: 10 }}
        title={text('故事前提、世界观、情节大纲', 'Premise, worldbuilding, and plot outline')}
      >
        <button
          type="button"
          style={{ width: 12, flexShrink: 0, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          aria-expanded={open}
          aria-label={open ? text('折叠故事架构', 'Collapse story architecture') : text('展开故事架构', 'Expand story architecture')}
          onClick={() => setOpen(v => !v)}
        >
          {open
            ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)' }} />
            : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />
          }
        </button>
        <FolderTree size={14} style={{ color: 'var(--color-text-muted)' }} />
        <span className="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{text('故事架构', 'Story architecture')}</span>
        {/* 进度徽章：故事前提、世界观、情节大纲三项 */}
        <span
          className="text-[0.7rem] flex-shrink-0 ml-1"
          style={{
            color: allDone
              ? 'var(--color-success-text)'
              : archDone > 0
                ? 'var(--color-warning-text, #7A5414)'
                : 'var(--color-text-muted)'
          }}
        >
          {archDone}/{ARCH_FILES.length}
        </span>
        <IconTooltip label={text('打开架构总览（AI 生成 / 断点续写）', 'Open architecture overview (AI generation / resume)')}>
          <button
            type="button"
            className="opacity-70 hover:opacity-100 rounded p-0.5 flex-shrink-0"
            aria-label={text('打开架构总览', 'Open architecture overview')}
            onClick={() => openBuiltinEditor('world-building-editor', text('故事架构', 'Story architecture'), 'world-building')}
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Sparkles size={11} />
          </button>
        </IconTooltip>
      </div>

      {/* 子文件列表（点击直接在 Markdown 编辑器打开） */}
      {open && (
        <div>
          {ARCH_FILES.map(f => {
            const isGenerated = archStatus[f.key]
            const filePath = `vela://core/${f.key}`
            return (
              <ArchFileRow
                key={f.key}
                f={f}
                filePath={filePath}
                isGenerated={isGenerated}
                onCleared={onCleared}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 单个架构文件行 */
function ArchFileRow({
  f,
  filePath,
  isGenerated,
  onCleared,
}: {
  f: { key: string; iconName: string; label: string; desc: string }
  filePath: string
  isGenerated: boolean
  onCleared: () => void | Promise<void>
}) {
  const text = useLocaleStore(s => s.text)
  const english = ARCH_FILE_EN[f.key] ?? { label: f.label, desc: f.desc }
  const label = text(f.label, english.label)
  const isCharacterProjection = f.key === 'characters'
  const clearArchFile = async () => {
    if (isCharacterProjection) return
    const projectSession = await confirmCurrentProjectSession(
      useProjectStore.getState().currentProject,
      () => confirm(text(`确认清空「${f.label}」内容？\n此操作会删除该项故事架构文本，不影响其他架构项、蓝图或正文。`, `Clear “${english.label}”?\nThis removes only this architecture section and preserves the other sections, blueprints, and manuscript.`), {
        title: text('清空故事架构项', 'Clear architecture section'),
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
            disabled: !isGenerated,
            onClick: clearArchFile,
          },
        ]),
      ], e)}
      title={text(f.desc, english.desc)}
    >
      {isGenerated
        ? <CheckCircle2 size={10} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
        : <Circle size={6} style={{ flexShrink: 0, fill: 'transparent', stroke: 'var(--color-text-muted)' }} />
      }
      <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{renderIcon(f.iconName, 13)}</span>
      <span
        className="text-sm flex-1 truncate"
        style={{ color: isGenerated ? 'var(--color-text)' : 'var(--color-text-secondary)' }}
      >
        {label}
      </span>
      {!isGenerated && (
        <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {text('待生成', 'Pending')}
        </span>
      )}
      {isGenerated && !isCharacterProjection && (
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
