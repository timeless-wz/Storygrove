import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles, Circle, RefreshCw, FileText, BookOpen, AlertTriangle, FolderTree, Eye, Copy, ArrowUpRight, Users, Workflow, MapPin, Lightbulb, History } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'
import { renderIcon } from '../panels/sidebar/sidebar-icons'

import ArchitectureConfirmDialog from '../dialogs/ArchitectureConfirmDialog'

import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { ipc } from '../../services/ipc-client'
import {
  openBuiltinEditor,
  openCreativeMaterialsView,
  openCultivationSettings,
  openLocationsEditor,
} from '../panels/sidebar/sidebar-file-openers'
import { getCharacterRosterRepairPresentation } from './character-roster-repair-state'

import { launchCreativeWorkflow } from '../../services/workflows/creative-workflow-launcher'
import { globalEventBus } from '../../shared/event-bus'
import {
  createProjectArchTabId,
  shouldRefreshArchOnWorkflowComplete,
  shouldSyncProjectArchTab,
} from './arch-file-refresh-policy'
import { LatestRequestGate } from './latest-request-gate'
import { useCharacterRosterRepair } from './use-character-roster-repair'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { sameProjectSessionContext } from '../../shared/project-session-context'
import {
  hasVisiblePartialSynopsisMarker,
  isRecoverableSynopsisCheckpoint,
  isUsableSynopsisCheckpoint,
  recoverableWorldBuildingCandidate,
} from '../../services/workflows/commands/architecture.command'
import type { ArchStepKey, ArchitectureLaunchMode } from '../../services/architecture-step-selection'
import './world-building-overview.css'

const ARCH_FILES: Array<{
  key: Exclude<ArchStepKey, 'characters'>
  fileName: string
  labelZh: string
  labelEn: string
  iconName: string
  descZh: string
  descEn: string
}> = [
    { key: 'premise', fileName: 'premise.md', labelZh: '故事前提', labelEn: 'Story premise', iconName: 'target', descZh: '故事钩子 · 核心冲突链 · 主角优势 · 悬念骨架', descEn: 'Story hook · core conflict · protagonist edge · suspense structure' },
    { key: 'worldbuilding', fileName: 'worldbuilding.md', labelZh: '世界观总纲', labelEn: 'Worldbuilding overview', iconName: 'globe', descZh: '核心规则 · 社会结构 · 深层危机', descEn: 'Core rules · social structure · underlying crisis' },
    { key: 'synopsis', fileName: 'synopsis.md', labelZh: '全书总纲', labelEn: 'Book outline', iconName: 'map', descZh: '故事主线、总体转折、高潮结局与各卷任务', descEn: 'Main story, major turns, ending, and each volume’s role' },
  ]

/** The overview links to authoritative business pages; it never stores a second copy. */
const OVERVIEW_ENTRIES = [
  { key: 'creative-direction', labelZh: '创作方向', labelEn: 'Creative direction', iconName: 'book-open' },
  { key: 'writing-rules', labelZh: '写作规范', labelEn: 'Writing rules', iconName: 'file-text' },
  { key: 'premise', labelZh: '故事前提', labelEn: 'Story premise', iconName: 'target' },
  { key: 'worldbuilding', labelZh: '世界设定', labelEn: 'World setting', iconName: 'globe' },
  { key: 'power-system', labelZh: '力量体系', labelEn: 'Power system', iconName: 'sparkles' },
  { key: 'locations', labelZh: '地点与区域', labelEn: 'Locations and regions', iconName: 'map-pin' },
  { key: 'characters', labelZh: '人物与关系', labelEn: 'Characters and relationships', iconName: 'users' },
  { key: 'plot-planning', labelZh: '剧情规划', labelEn: 'Plot planning', iconName: 'map' },
  { key: 'information-reveal', labelZh: '信息与揭露', labelEn: 'Information and reveals', iconName: 'eye' },
  { key: 'materials', labelZh: '素材与候选', labelEn: 'Materials and candidates', iconName: 'lightbulb' },
  { key: 'retired', labelZh: '废案', labelEn: 'Retired ideas', iconName: 'archive' },
  { key: 'issues', labelZh: '未解决问题', labelEn: 'Open issues', iconName: 'alert-triangle' },
  { key: 'legacy', labelZh: '待整理旧内容', labelEn: 'Unorganized legacy content', iconName: 'history' },
] as const

const OVERVIEW_GROUPS = [
  { key: 'foundation', zh: '创作基础', en: 'Creative foundations', entries: ['creative-direction', 'writing-rules', 'premise'] },
  { key: 'setting', zh: '故事资料', en: 'Story reference', entries: ['worldbuilding', 'power-system', 'locations', 'characters'] },
  { key: 'planning', zh: '剧情规划', en: 'Story planning', entries: ['plot-planning', 'information-reveal'] },
  { key: 'materials', zh: '资料整理', en: 'Material organization', entries: ['materials', 'retired', 'issues', 'legacy'] },
] as const

type OverviewEntryKey = typeof OVERVIEW_ENTRIES[number]['key']

const OVERVIEW_PURPOSES: Record<OverviewEntryKey, { zh: string; en: string }> = {
  'creative-direction': {
    zh: '作品定位、目标读者、阅读体验、创作原则、参考边界与写作参数。',
    en: 'Positioning, audience, reading experience, creative principles, references, and writing parameters.',
  },
  'writing-rules': {
    zh: '在正文层面维护视角、文风、对话、描写、节奏、禁忌与自检规则。',
    en: 'Maintain POV, style, dialogue, description, pacing, restrictions, and prose checks.',
  },
  premise: {
    zh: '维护核心故事、主要冲突与故事钩子。',
    en: 'Maintain the central story, its main conflict, and its hook.',
  },
  worldbuilding: {
    zh: '维护世界之间的总体设定与全书共同规则。',
    en: 'Maintain the overall setting across worlds and the rules they share.',
  },
  'power-system': {
    zh: '维护多人共用的力量来源、成长规则、限制与代价。',
    en: 'Maintain shared power sources, growth rules, limits, and costs.',
  },
  locations: {
    zh: '逐条维护世界、区域、地点、资源、危险和空间关系；地图可选。',
    en: 'Maintain worlds, regions, places, resources, dangers, and spatial relations; maps are optional.',
  },
  characters: {
    zh: '身份、目标、背景、个人能力和关系只在人物档案维护。',
    en: 'Maintain identity, goals, background, personal abilities, and relationships in character profiles.',
  },
  'plot-planning': {
    zh: '全书总纲、分卷大纲和逐章细纲统一在章节蓝图中维护。',
    en: 'Maintain the book, volume, and chapter outlines in Chapter Blueprints.',
  },
  'information-reveal': {
    zh: '维护作者真相、确定状态、人物与读者知情以及揭露计划。',
    en: 'Track author truth, certainty, character and reader knowledge, and reveal plans.',
  },
  materials: {
    zh: '保存尚未采用或正在评估的素材；候选不会自动注入正文生成。',
    en: 'Save unadopted or in-review ideas; candidates are not injected as facts.',
  },
  retired: {
    zh: '记录废止方案和原因，供 AI 避免重新采用。',
    en: 'Record retired ideas and reasons so AI can avoid reusing them.',
  },
  issues: {
    zh: '记录未解决漏洞、风险和处理状态，供审查引用。',
    en: 'Track unresolved gaps, risks, and resolution status for review.',
  },
  legacy: {
    zh: '查看并整理旧配置原文；确认归位前只作参考。',
    en: 'Review legacy configuration; it remains reference-only until organized.',
  },
}

function OverviewEntryIcon({ entry }: { entry: typeof OVERVIEW_ENTRIES[number] }) {
  switch (entry.key) {
    case 'locations': return <MapPin size={16} />
    case 'materials': return <Lightbulb size={16} />
    case 'information-reveal': return <Eye size={16} />
    case 'issues': return <AlertTriangle size={16} />
    case 'legacy': return <History size={16} />
    default: return renderIcon(entry.iconName, 16)
  }
}

/** 续批按钮默认的每批章数上限（可在弹窗内调整，避免一次请求剩余全部章节）。 */
const CONTINUATION_BATCH_SPAN = 20

/** 基础设定总览 — 指向各自的原有内容事实源，并保留生成/恢复状态。 */
export default function WorldBuildingEditor({ projectKey }: { projectKey: string }) {
  // ✅ 精确订阅，避免 novelConfig 等变化导致不必要的 loadStatus 重建
  const currentProject = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const projectMatches = currentProject?.path === projectKey
  const latestArchitectureTerminalRunId = useWorkflowStore(state => (
    state.history.find(run => run.type === 'architecture_generation' && run.projectPath === projectKey)?.id ?? null
  ))
  const activeArchitectureRun = useWorkflowStore(state => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession) return null
    return state.activeRuns.find(run => (
      run.type === 'architecture_generation'
      && run.projectPath === projectKey
      && run.projectSession !== null
      && sameProjectSessionContext(projectSession, run.projectSession)
    )) ?? null
  })
  const latestArchitectureTerminalRun = useWorkflowStore(state => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession) return null
    return state.history.find(run => (
      run.type === 'architecture_generation'
      && run.projectPath === projectKey
      && run.projectSession !== null
      && sameProjectSessionContext(projectSession, run.projectSession)
    )) ?? null
  })
  const [archStatus, setArchStatus] = useState<Record<string, boolean>>({})
  const [characterCounts, setCharacterCounts] = useState<Record<string, number>>({})
  const [documentHasContent, setDocumentHasContent] = useState<Record<string, boolean>>({})
  const [failedEntries, setFailedEntries] = useState<Record<string, boolean>>({})
  const [synopsisIncomplete, setSynopsisIncomplete] = useState(false)
  const [synopsisRecoveryFailed, setSynopsisRecoveryFailed] = useState(false)
  const [synopsisCoveredTo, setSynopsisCoveredTo] = useState<number>(0)
  const [synopsisTotalChapters, setSynopsisTotalChapters] = useState<number>(0)
  const [worldBuildingCandidate, setWorldBuildingCandidate] = useState('')
  const [showWorldBuildingCandidate, setShowWorldBuildingCandidate] = useState(false)
  const [pendingSynopsisRange, setPendingSynopsisRange] = useState<{ from: number; to: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showArchDialog, setShowArchDialog] = useState(false)
  const [launchMode, setLaunchMode] = useState<ArchitectureLaunchMode>({ kind: 'batch' })
  const lastCompletedArchitectureRunRef = useRef<string | null>(null)
  const archStatusRequestGate = useRef(new LatestRequestGate())
  // The same roster snapshot drives the role card and the generation selector.
  const {
    snapshot: rosterSnapshot,
    repairError: rosterRepairError,
    refresh: loadCharacterRosterStatus,
  } = useCharacterRosterRepair({ projectKey, enabled: projectMatches })

  /** 加载各架构文件状态（通过 Service 层获取，不直接调 IPC） */
  const loadStatus = useCallback(async () => {
    await Promise.resolve()
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) {
      archStatusRequestGate.current.begin()
      setArchStatus({})
      setCharacterCounts({})
      setDocumentHasContent({})
      setFailedEntries({})
      setSynopsisIncomplete(false)
      setSynopsisRecoveryFailed(false)
      setSynopsisCoveredTo(0)
      setSynopsisTotalChapters(0)
      setWorldBuildingCandidate('')
      setShowWorldBuildingCandidate(false)
      setLoading(false)
      return
    }
    const projectPath = projectSession.projectPath
    const requestId = archStatusRequestGate.current.begin()
    setLoading(true)
    const core = await ipc.invokeWithProjectSession(
      projectSession,
      'db:project-core-get',
      projectPath,
    )
    const settled = <T,>(promise: Promise<T>) => promise.then(
      value => ({ value, failed: false }),
      () => ({ value: null as T | null, failed: true }),
    )
    const [powerResult, locationsResult, informationResult, materialsResult, retiredResult, issuesResult, legacyResult] = await Promise.all([
      settled(ipc.invokeWithProjectSession(projectSession, 'db:cultivation-read', projectPath)),
      settled(ipc.invokeWithProjectSession(projectSession, 'db:map-get-all', projectPath)),
      settled(ipc.invokeWithProjectSession(projectSession, 'db:info-entry-list', undefined, projectPath)),
      settled(ipc.invokeWithProjectSession(projectSession, 'db:creative-material-list', { entryKind: 'material' }, projectPath)),
      settled(ipc.invokeWithProjectSession(projectSession, 'db:creative-material-list', { entryKind: 'retired' }, projectPath)),
      settled(ipc.invokeWithProjectSession(projectSession, 'db:creative-material-list', { entryKind: 'issue' }, projectPath)),
      settled(ipc.invokeWithProjectSession(projectSession, 'db:creative-legacy-list', projectPath)),
    ])
    // 情节大纲状态：中断可断点续写；或部分覆盖可分批续写（covered_to < total）
    let interrupted = false
    let recoveryFailed = false
    let coveredTo = 0
    let recoveredWorldBuildingCandidate = ''
    const dbSynopsis = core?.synopsis || ''
    const totalChapters = Number(core?.totalChapters ?? currentProject?.novelConfig?.totalChapters) || 0
    const writingLanguage = (core?.writingLanguage ?? currentProject?.novelConfig?.writingLanguage) === 'en-US'
      ? 'en-US'
      : 'zh-CN'
    const visiblyPartial = hasVisiblePartialSynopsisMarker(dbSynopsis)
    try {
      const partialResult = await ipc.invokeWithProjectSession(
        projectSession,
        'fs:read-json',
        `${projectPath}/.vela/partial_arch.json`,
        projectPath,
      )
      const partial = partialResult?.success === true
        ? (partialResult as { data?: Record<string, unknown> }).data
        : undefined
      recoveredWorldBuildingCandidate = recoverableWorldBuildingCandidate(partial)
      const checkpointUsable = isUsableSynopsisCheckpoint(
        partial,
        dbSynopsis,
        writingLanguage,
        totalChapters,
      )
      interrupted = checkpointUsable && isRecoverableSynopsisCheckpoint(
        partial,
        dbSynopsis,
        writingLanguage,
        totalChapters,
      )
      recoveryFailed = visiblyPartial && !checkpointUsable
      coveredTo = checkpointUsable && Number(partial?.synopsis_covered_to) > 0
        ? Number(partial?.synopsis_covered_to)
        : 0
    } catch {
      interrupted = false
      recoveryFailed = visiblyPartial
      coveredTo = 0
      recoveredWorldBuildingCandidate = ''
    }
    // Keep the existing generation-step threshold for the selection dialog.
    // The overview display uses exact document lengths so short existing content
    // is not presented as empty or as author-confirmed.
    const premise = String(core?.premise ?? '')
    const worldbuilding = String(core?.worldbuilding ?? '')
    const synopsis = String(core?.synopsis ?? '')
    const creativeDirectionLength = [
      core?.creativeDirectionMarkdown,
      core?.genre || currentProject?.novelConfig?.genre,
      core?.subGenre || currentProject?.novelConfig?.subGenre,
      core?.targetAudience || currentProject?.novelConfig?.targetAudience,
      core?.referenceWorks || currentProject?.novelConfig?.referenceWorks,
    ].reduce((total, value) => total + String(value ?? '').length, 0)
    const writingRulesLength = String(core?.writingRulesMarkdown ?? '').length
    const status: Record<string, boolean> = {
      premise: (core?.premise?.length ?? 0) > 50,
      characters: rosterSnapshot?.status === 'ready',
      worldbuilding: (core?.worldbuilding?.length ?? 0) > 50,
      synopsis: (core?.synopsis?.length ?? 0) > 50,
    }
    const counts: Record<string, number> = {
      'creative-direction': creativeDirectionLength,
      'writing-rules': writingRulesLength,
      premise: premise.length,
      characters: status.characters ? (rosterSnapshot?.renderedMarkdown.length ?? 0) : 0,
      worldbuilding: worldbuilding.length,
      synopsis: synopsis.length,
    }
    const contentPresence = {
      'creative-direction': creativeDirectionLength > 0,
      'writing-rules': Boolean(core?.writingRulesMarkdown?.trim()),
      premise: premise.trim().length > 0,
      worldbuilding: worldbuilding.trim().length > 0,
      'power-system': Boolean(powerResult.value?.markdown?.trim() || powerResult.value?.realms?.length),
      locations: Boolean(locationsResult.value?.nodes?.length),
      'plot-planning': synopsis.trim().length > 0,
      'information-reveal': Boolean(informationResult.value?.length),
      materials: Boolean(materialsResult.value?.length),
      retired: Boolean(retiredResult.value?.length),
      issues: Boolean(issuesResult.value?.length),
      legacy: Boolean(legacyResult.value?.some(source => source.disposition === 'pending')),
    }
    const failedPresence = {
      'power-system': powerResult.failed,
      locations: locationsResult.failed,
      'information-reveal': informationResult.failed,
      materials: materialsResult.failed,
      retired: retiredResult.failed,
      issues: issuesResult.failed,
      legacy: legacyResult.failed,
    }
    if (
      !archStatusRequestGate.current.isLatest(requestId)
      || !isProjectSessionCurrent(projectSession)
    ) return
    setArchStatus(status)
    setCharacterCounts(counts)
    setDocumentHasContent(contentPresence)
    setFailedEntries(failedPresence)
    setSynopsisIncomplete(interrupted && Boolean(status.synopsis))
    setSynopsisRecoveryFailed(recoveryFailed && Boolean(status.synopsis))
    setSynopsisCoveredTo(coveredTo)
    setSynopsisTotalChapters(totalChapters)
    setWorldBuildingCandidate(recoveredWorldBuildingCandidate)
    if (!recoveredWorldBuildingCandidate) setShowWorldBuildingCandidate(false)
    setLoading(false)
    // ✅ 只依赖 path 字符串，避免 novelConfig 等变化导致 loadStatus 重建
  }, [currentProject, projectKey, projectMatches, rosterSnapshot])

  useEffect(() => {
    const timer = setTimeout(() => { void loadStatus() }, 0)
    return () => clearTimeout(timer)
  }, [latestArchitectureTerminalRunId, loadStatus])

  // 监听 EventBus 事件，刷新后处理状态面板
  useEffect(() => {
    const eventMatchesProjectRun = (payload: {
      projectSession: ProjectSessionContext
      runId: string
    }) =>
      (() => {
        const projectSession = captureProjectSession(currentProject)
        return !!projectSession
          && isProjectSessionCurrent(projectSession)
          && sameProjectSessionContext(projectSession, payload.projectSession)
      })()
      && payload.runId.length > 0
    // 每步架构文件写完后实时刷新状态
    const unsub3 = globalEventBus.on('ARCH_FILE_UPDATED', (payload) => {
      if (!eventMatchesProjectRun(payload)) return
      loadStatus()
      loadCharacterRosterStatus()
    })
    // 整个工作流完成后也刷新一次
    const unsub4 = globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      const projectSession = captureProjectSession(currentProject)
      if (!projectSession || !isProjectSessionCurrent(projectSession)) return
      if (!shouldRefreshArchOnWorkflowComplete(
        payload,
        projectSession,
        lastCompletedArchitectureRunRef.current,
      )) return
      lastCompletedArchitectureRunRef.current = payload.runId
      loadStatus()
      loadCharacterRosterStatus()
    })
    return () => { unsub3(); unsub4() }
  }, [currentProject, loadCharacterRosterStatus, loadStatus, projectKey])

  /** 打开单个架构文件（arch-file 类型；若 tab 已存在则刷新磁盘内容） */
  const openArchFile = async (f: typeof ARCH_FILES[number]) => {
    if (f.key === 'synopsis') {
      openBuiltinEditor(
        'chapter-card-editor',
        text('章节蓝图', 'Chapter blueprints'),
        'chapter-card',
        undefined,
        undefined,
        undefined,
        { kind: 'book' },
      )
      return
    }
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const filePath = `vela://core/${f.key}`
    const tabId = createProjectArchTabId(projectKey, filePath)
    let content = ''
    try {
      const core = (await ipc.invokeWithProjectSession(
        projectSession,
        'db:project-core-get',
        projectSession.projectPath,
      )) as Record<string, unknown> | null
      content = (core?.[f.key] as string) || ''
    } catch {
      return
    }
    if (!isProjectSessionCurrent(projectSession)) return

    const { useEditorStore } = await import('../../stores/editor-store')
    if (!isProjectSessionCurrent(projectSession)) return
    const store = useEditorStore.getState()
    const existingTab = store.tabs.find(t => t.id === tabId)
    if (existingTab) {
      store.setActiveTab(tabId)
      if (shouldSyncProjectArchTab(existingTab, projectKey)) {
        store.syncTabContent(tabId, content)
        store.markTabSaved(tabId, content)
      }
    } else {
      store.openFile({
        id: tabId,
        name: text(f.labelZh, f.labelEn),
        type: 'arch-file',
        filePath,
        content,
        savedContent: content,
        projectKey,
      })
    }
  }

  /** 确认后启动架构工作流 */
  const handleConfirm = async (
    selectedSteps: ArchStepKey[],
    stepGuidance: Record<string, string>,
    synopsisRange?: { from: number; to: number },
    confirmedLaunchMode: ArchitectureLaunchMode = launchMode,
  ) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) throw new Error(text('项目会话已切换，未启动架构生成', 'The project session changed, so architecture generation was not started.'))
    if (!isProjectSessionCurrent(projectSession)) throw new Error(text('项目会话已切换，未启动架构生成', 'The project session changed, so architecture generation was not started.'))
    const effectiveSteps = confirmedLaunchMode.kind === 'resume'
      ? [confirmedLaunchMode.step]
      : selectedSteps
    await launchCreativeWorkflow({
      workflow: 'generate_architecture',
      selectedSteps: effectiveSteps,
      stepGuidance,
      synopsisRange,
      ...(confirmedLaunchMode.kind === 'resume' && confirmedLaunchMode.step === 'synopsis'
        ? { resumeSynopsis: true }
        : {}),
      ...(confirmedLaunchMode.kind === 'resume' && confirmedLaunchMode.step === 'worldbuilding'
        ? { resumeWorldBuilding: true }
        : {}),
    }, projectSession)
  }

  /** 从上次输出长度中断的检查点继续生成情节大纲（断点续写当前批） */
  const handleResumeSynopsis = () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (!isProjectSessionCurrent(projectSession) || !synopsisIncomplete) return
    setPendingSynopsisRange(null)
    setLaunchMode({ kind: 'resume', step: 'synopsis' })
    setShowArchDialog(true)
  }

  /** 从本项目保存的未完成候选继续生成世界观。 */
  const handleResumeWorldBuilding = () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (!isProjectSessionCurrent(projectSession) || !worldBuildingCandidate) return
    setPendingSynopsisRange(null)
    setLaunchMode({ kind: 'resume', step: 'worldbuilding' })
    setShowArchDialog(true)
  }

  const copyWorldBuildingCandidate = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches
      || !projectSession
      || !isProjectSessionPath(projectSession, projectKey)
      || !isProjectSessionCurrent(projectSession)
      || !worldBuildingCandidate
    ) return
    try {
      await navigator.clipboard.writeText(worldBuildingCandidate)
      const { toast } = await import('../ui/Toast')
      toast.success(text('世界观未完成候选已复制', 'Incomplete worldbuilding candidate copied.'))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const { toast } = await import('../ui/Toast')
      toast.error(text(`复制失败：${detail}`, `Copy failed: ${detail}`))
    }
  }

  /** 续批入口：打开生成弹窗并预填下一批范围（从 coveredTo+1 起，默认带本批上限，
   * 上限可在弹窗内调整）。避免一次请求剩余全部章节再次触发超长输出。 */
  const handleContinueOutlineBatch = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (!isProjectSessionCurrent(projectSession)) return
    const from = synopsisCoveredTo + 1
    if (from > synopsisTotalChapters || synopsisTotalChapters <= 0) return
    setPendingSynopsisRange({
      from,
      to: Math.min(synopsisTotalChapters, from + CONTINUATION_BATCH_SPAN - 1),
    })
    setLaunchMode({ kind: 'single', step: 'synopsis' })
    setShowArchDialog(true)
  }

  /** Open the batch selector; opening it never starts a model run. */
  const openGenerateDialog = () => {
    setPendingSynopsisRange(null)
    setLaunchMode({ kind: 'batch' })
    setShowArchDialog(true)
  }

  if (!projectMatches) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
        <div
          className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-editor-bg)',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
              {text('基础设定总览', 'Basic settings overview')}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          <EmptyState icon={<BookOpen size={36} />} message={text('请先打开项目', 'Open a project to continue')} opacity={0.4} />
        </div>
      </div>
    )
  }

  const novelConfig = currentProject?.novelConfig
  const rosterPresentation = getCharacterRosterRepairPresentation(
    rosterSnapshot,
    text,
    rosterRepairError,
  )
  const rosterCount = rosterSnapshot?.entries.length
  const roleStatus = rosterSnapshot?.status === 'empty'
    ? text('名单尚未建立', 'Roster not yet established')
    : rosterPresentation?.label ?? text('名单未就绪', 'Roster not ready')
  const creativeDirectionSummary = {
    type: [novelConfig?.genre?.trim(), novelConfig?.subGenre?.trim()].filter(Boolean).join(' · '),
    audience: novelConfig?.targetAudience?.trim() ?? '',
    chapters: Number(novelConfig?.totalChapters) > 0 ? Number(novelConfig?.totalChapters) : 0,
    wordsPerChapter: Number(novelConfig?.wordsPerChapter) > 0 ? Number(novelConfig?.wordsPerChapter) : 0,
  }
  const hasCreativeDirectionSummary = Boolean(
    creativeDirectionSummary.type
    || creativeDirectionSummary.audience
    || creativeDirectionSummary.chapters
    || creativeDirectionSummary.wordsPerChapter,
  )

  const openOverviewEntry = (key: typeof OVERVIEW_ENTRIES[number]['key']) => {
    if (key === 'creative-direction' || key === 'writing-rules') {
      openBuiltinEditor('config', text('创作方向', 'Creative direction'), 'config')
      const sectionId = key === 'writing-rules' ? 'novel-config-writing' : 'novel-config-ideas'
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }))
      return
    }
    if (key === 'characters') {
      useLayoutStore.getState().openCharacterProfile('edit')
      return
    }
    if (key === 'power-system') {
      openCultivationSettings(text('力量体系', 'Power system'))
      return
    }
    if (key === 'locations') {
      openLocationsEditor(text('地点与区域', 'Locations and regions'))
      return
    }
    if (key === 'information-reveal') {
      openBuiltinEditor('knowledge-gap', text('信息与揭露', 'Information and reveals'), 'knowledge-gap')
      return
    }
    if (key === 'plot-planning') {
      openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card', undefined, undefined, undefined, { kind: 'book' })
      return
    }
    if (key === 'materials' || key === 'retired' || key === 'issues' || key === 'legacy') {
      const view = key === 'retired' ? 'retired' : key === 'issues' ? 'issues' : key === 'legacy' ? 'legacy' : 'materials'
      const labels = {
        materials: text('素材与候选', 'Materials and candidates'),
        retired: text('废案', 'Retired ideas'),
        issues: text('未解决问题', 'Open issues'),
        legacy: text('待整理旧内容', 'Unorganized legacy content'),
      }
      openCreativeMaterialsView(view, labels[key])
      return
    }
    const file = ARCH_FILES.find(candidate => candidate.key === key)
    if (file) void openArchFile(file)
  }

  const openWorldManagement = () => {
    openBuiltinEditor('world-workbench', text('世界管理', 'World management'), 'world')
  }

  const openAIWorkflow = () => {
    useLayoutStore.getState().openRightPanel('ai-output')
  }

  return (
    <div className="world-building-overview h-full flex flex-col overflow-hidden">
      <header className="world-building-overview__header flex-shrink-0 border-b">
        <div className="world-building-overview__heading">
          <FolderTree size={17} aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="world-building-overview__title">
              {text('基础设定总览', 'Basic settings overview')}
            </h1>
            <p className="world-building-overview__description">
              {text(
                '查看创作资料状态，进入对应页面维护。',
                'Check your creative materials and open their dedicated editors.',
              )}
            </p>
          </div>
        </div>
        <div className="world-building-overview__actions">
          <Button
            variant="ghost"
            size="icon"
            onClick={loadStatus}
            title={text('刷新状态', 'Refresh status')}
            aria-label={text('刷新基础设定状态', 'Refresh basic settings status')}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={openAIWorkflow}
            title={text('查看 AI 任务进度与输出', 'View AI task progress and output')}
          >
            <Workflow size={13} />
            {text('查看 AI 工作流', 'View AI workflow')}
          </Button>
          <Button
            variant="ai"
            size="sm"
            onClick={openGenerateDialog}
            title={text('选择本次要生成的设定项目', 'Choose which setup sections to generate')}
          >
            <Sparkles size={12} />
            {text('批量生成设定', 'Generate setup in batch')}
          </Button>
        </div>
      </header>

      <main className="world-building-overview__body flex-1 overflow-y-auto">
        {activeArchitectureRun && (
          <div
            role="status"
            aria-live="polite"
            className="world-building-overview__run-state"
          >
            {activeArchitectureRun.status === 'running' || activeArchitectureRun.status === 'cancelling'
              ? <RefreshCw size={12} className="inline mr-1.5 animate-spin" />
              : <Circle size={12} className="inline mr-1.5" />
            }
            {activeArchitectureRun.status === 'waiting'
              ? text('基础设定生成正在等待继续', 'Basic settings generation is waiting to continue')
              : activeArchitectureRun.status === 'paused'
                ? text('基础设定生成已暂停', 'Basic settings generation is paused')
                : activeArchitectureRun.status === 'cancelling'
                  ? text('基础设定生成正在停止', 'Basic settings generation is stopping')
                  : text('基础设定生成中', 'Basic settings generation in progress')}
          </div>
        )}
        {!activeArchitectureRun && latestArchitectureTerminalRun?.status === 'failed' && (
          <div
            role="alert"
            className="world-building-overview__run-state world-building-overview__run-state--warning"
          >
            <AlertTriangle size={12} className="inline mr-1.5" />
            {text('上次基础设定生成失败：', 'The last basic settings run failed: ')}
            {latestArchitectureTerminalRun.error || text('请查看任务日志。', 'Check the task log for details.')}
          </div>
        )}
        <section className="world-building-overview__groups" aria-label={text('基础设定内容入口', 'Basic settings content entries')}>
          {OVERVIEW_GROUPS.map(group => {
            const groupEntries = OVERVIEW_ENTRIES.filter(entry => (group.entries as readonly string[]).includes(entry.key))

            return (
              <section key={group.key} className="world-building-overview__group" aria-labelledby={`overview-group-${group.key}`}>
                <h2 id={`overview-group-${group.key}`} className="world-building-overview__group-title">
                  {text(group.zh, group.en)}
                </h2>
                <div className="world-building-overview__entries">
                  {groupEntries.map(entry => {
                    const documentKey = entry.key === 'characters' ? null : entry.key
                    const hasContent = documentKey ? Boolean(documentHasContent[documentKey]) : false
                    const characterEntry = entry.key === 'characters'
                    const worldBuildingEntry = entry.key === 'worldbuilding'
                    const synopsisEntry = entry.key === 'plot-planning'
                    const isWorldBuildingCandidate = worldBuildingEntry && Boolean(worldBuildingCandidate)
                    const synopsisNeedsRecovery = synopsisEntry && synopsisRecoveryFailed
                    const title = text(entry.labelZh, entry.labelEn)
                    const purpose = OVERVIEW_PURPOSES[entry.key]
                    const statusLabel = loading && documentKey
                      ? text('正在读取', 'Loading')
                      : failedEntries[entry.key]
                        ? text('读取失败', 'Could not read')
                        : characterEntry
                          ? roleStatus
                          : hasContent
                            ? synopsisNeedsRecovery
                              ? text('有内容 · 检查点不可恢复', 'Has content · checkpoint unavailable')
                              : synopsisEntry && synopsisIncomplete
                                ? text('有内容 · 已存部分', 'Has content · partial saved')
                                : text('有内容', 'Has content')
                            : text('待填写', 'Needs content')
                    const characterCount = documentKey ? (characterCounts[documentKey] ?? 0) : 0
                    const characterCountLabel = rosterCount === undefined
                      ? null
                      : text(`${rosterCount} 个角色`, `${rosterCount} characters`)

                    return (
                      <article
                        key={entry.key}
                        data-overview-entry={entry.key}
                        className={`world-building-overview__card${isWorldBuildingCandidate || synopsisNeedsRecovery ? ' world-building-overview__card--attention' : ''}`}
                      >
                        <button
                          type="button"
                          className="world-building-overview__card-main"
                          onClick={() => openOverviewEntry(entry.key)}
                          aria-label={text(`打开${title}编辑`, `Open ${title} for editing`)}
                          aria-describedby={`basic-settings-${entry.key}-purpose basic-settings-${entry.key}-status`}
                        >
                          <span className="world-building-overview__card-heading">
                            <span className="world-building-overview__icon" aria-hidden="true">
                              <OverviewEntryIcon entry={entry} />
                            </span>
                            <span className="world-building-overview__card-title">{title}</span>
                            <ArrowUpRight size={14} className="world-building-overview__open-icon" aria-hidden="true" />
                          </span>
                          <span id={`basic-settings-${entry.key}-purpose`} className="world-building-overview__purpose">
                            {text(purpose.zh, purpose.en)}
                          </span>
                          {entry.key === 'creative-direction' && hasCreativeDirectionSummary && (
                            <span className="world-building-overview__summary">
                              {(creativeDirectionSummary.type || creativeDirectionSummary.audience) && (
                                <span className="world-building-overview__summary-context">
                                  {creativeDirectionSummary.type && (
                                    <span className="world-building-overview__summary-value">
                                      <span className="world-building-overview__summary-label">{text('类型', 'Type')}</span>
                                      {creativeDirectionSummary.type}
                                    </span>
                                  )}
                                  {creativeDirectionSummary.audience && (
                                    <span className="world-building-overview__summary-value">
                                      <span className="world-building-overview__summary-label">{text('读者', 'Readers')}</span>
                                      {creativeDirectionSummary.audience}
                                    </span>
                                  )}
                                </span>
                              )}
                              {(creativeDirectionSummary.chapters > 0 || creativeDirectionSummary.wordsPerChapter > 0) && (
                                <span className="world-building-overview__summary-scale">
                                  {creativeDirectionSummary.chapters > 0 && text(`${creativeDirectionSummary.chapters} 章`, `${creativeDirectionSummary.chapters} chapters`)}
                                  {creativeDirectionSummary.chapters > 0 && creativeDirectionSummary.wordsPerChapter > 0 && ' × '}
                                  {creativeDirectionSummary.wordsPerChapter > 0 && text(`每章 ${creativeDirectionSummary.wordsPerChapter.toLocaleString()} 字`, `${creativeDirectionSummary.wordsPerChapter.toLocaleString()} words/chapter`)}
                                </span>
                              )}
                            </span>
                          )}
                          <span className="world-building-overview__card-meta">
                            <span
                              id={`basic-settings-${entry.key}-status`}
                              className={`world-building-overview__status${hasContent ? ' world-building-overview__status--present' : ''}${failedEntries[entry.key] ? ' world-building-overview__status--error' : ''}`}
                            >
                              {hasContent && <FileText size={12} aria-hidden="true" />}
                              {characterEntry && <Users size={12} aria-hidden="true" />}
                              {failedEntries[entry.key] && <AlertTriangle size={12} aria-hidden="true" />}
                              {statusLabel}
                            </span>
                            {documentKey && !loading && characterCount > 0 && (
                              <>
                                <span className="world-building-overview__meta-separator" aria-hidden="true">·</span>
                                <span className="world-building-overview__count">
                                  {characterCount.toLocaleString()} {text('字符', 'characters')}
                                </span>
                              </>
                            )}
                            {characterEntry && characterCountLabel && (
                              <>
                                <span className="world-building-overview__meta-separator" aria-hidden="true">·</span>
                                <span className="world-building-overview__count">{characterCountLabel}</span>
                              </>
                            )}
                          </span>
                        </button>

                        {worldBuildingEntry && (
                          <div className="world-building-overview__card-secondary">
                            <p>{text('总纲维护共同规则，世界管理维护具体世界及组成。', 'The overview holds shared rules; World management holds specific worlds and their records.')}</p>
                            <Button variant="ghost" size="sm" onClick={openWorldManagement}>
                              {text('管理各个世界', 'Manage worlds')}
                              <ArrowUpRight size={12} />
                            </Button>
                          </div>
                        )}

                        {isWorldBuildingCandidate && (
                          <div className="world-building-overview__recovery">
                            <div className="world-building-overview__recovery-title">
                              {text('未完成候选 · 未写入正式内容', 'Incomplete candidate · not written to formal content')}
                            </div>
                            <div className="world-building-overview__recovery-actions">
                              <Button variant="ghost" size="sm" onClick={() => setShowWorldBuildingCandidate(value => !value)}>
                                <Eye size={12} />
                                {showWorldBuildingCandidate ? text('收起候选', 'Hide candidate') : text('查看候选', 'View candidate')}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => void copyWorldBuildingCandidate()}>
                                <Copy size={12} />
                                {text('复制', 'Copy')}
                              </Button>
                              <Button size="sm" onClick={handleResumeWorldBuilding}>
                                <RefreshCw size={12} />
                                {text('断点续写', 'Resume')}
                              </Button>
                            </div>
                          </div>
                        )}

                        {synopsisEntry && synopsisIncomplete && !loading && (
                          <div className="world-building-overview__recovery-actions">
                            <Button size="sm" onClick={handleResumeSynopsis}>
                              <RefreshCw size={12} />
                              {text('兼容模式：断点续写', 'Legacy mode: resume outline')}
                            </Button>
                          </div>
                        )}
                        {synopsisEntry && !synopsisIncomplete && !synopsisRecoveryFailed
                          && synopsisCoveredTo > 0 && synopsisCoveredTo < synopsisTotalChapters && !loading && (
                            <div className="world-building-overview__recovery-actions">
                              <Button variant="ghost" size="sm" onClick={() => void handleContinueOutlineBatch()}>
                                <RefreshCw size={12} />
                                {text(`兼容模式：按章续批（第 ${synopsisCoveredTo + 1} 章起）`, `Legacy chapter-range mode: continue (ch. ${synopsisCoveredTo + 1}+)`)}
                              </Button>
                            </div>
                          )}

                        {isWorldBuildingCandidate && showWorldBuildingCandidate && (
                          <div role="status" className="world-building-overview__candidate-preview">
                            <strong>{text('世界观未完成候选（不会自动写入正式世界观）', 'Incomplete worldbuilding candidate (not written to formal worldbuilding)')}</strong>
                            <pre>{worldBuildingCandidate}</pre>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </section>
      </main>

      {/* Opening the selector never submits a run; generation starts after confirmation. */}
      <ArchitectureConfirmDialog
        isOpen={showArchDialog}
        onClose={() => setShowArchDialog(false)}
        archStatus={archStatus}
        launchMode={launchMode}
        initialSynopsisRange={pendingSynopsisRange}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
