import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Save, BookOpen, RefreshCw, Trash2,
  PenLine, AlertTriangle, MapPin, FolderPlus, FileText
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useDraftStore, readDraftBody } from '../../stores/draft-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { WORLD_MAP_NODE_TYPE_LABELS, getWorldMapName } from '../../shared/world-map'
import { ipc } from '../../services/ipc-client'
import { clearProjectData } from '../../services/project-clear-service'
import OutlineSyncReviewDialog from './outline-sync/OutlineSyncReviewDialog'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type {
  BlueprintPlanningCandidateRecord,
  BlueprintPlanningCheckRecord,
  BlueprintPlanningConfirmSelection,
  BlueprintPlanningSelection,
  BlueprintPlanningSourceState,
  BlueprintPlanningTargetSourceReference,
  BlueprintVolumeOutline,
  BlueprintVolumeOutlineOrigin,
  BlueprintVolumeOutlineSummary,
} from '../../shared/blueprint-planning'
import {
  projectSessionContextFromProject,
  sameProjectPathKey,
  sameProjectSessionContext,
} from '../../shared/project-session-context'
import {
  loadDirectoryBlueprints,
  saveChapterBlueprint,
  saveAllBlueprints,
  type ChapterBlueprint,
} from '../../services/workflows/directory-workflow'
import { recordLastCreationLocation } from '../../services/last-creation-location'
import type { BlueprintVolumeData } from '../../../electron/repositories/blueprint-repository'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { globalEventBus } from '../../shared/event-bus'
import { shouldRefreshBlueprints } from './blueprint-refresh'
import { useLocaleStore } from '../../stores/locale-store'
import { registerEditorExitSaveHandler, useEditorStore } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import {
  CHAPTER_CARD_TAB_ID,
  captureBlueprintSnapshots,
  getChapterCardProjectDraft,
  parseChapterCardDraftLedger,
  persistChapterCardDraftLedger,
  refreshChapterCardDraftFromRemote,
  reconcileClearedBlueprintSnapshots,
  reconcileDeletedBlueprintSnapshots,
  reconcileSavedBlueprintSnapshots,
  updateEditableChapterBlueprintField,
  updateChapterCardProjectDraft,
  type DraftState,
  type EditableChapterBlueprintField,
} from './chapter-card-draft-ledger'
import {
  CHAPTER_CARD_V2_TAB_ID,
  discardChapterCardV2Draft,
  getChapterCardV2Draft,
  getChapterCardV2ProjectDraft,
  parseChapterCardV2DraftLedger,
  persistChapterCardV2DraftLedger,
  updateChapterCardV2Draft,
  type ChapterCardBlueprintV2Draft,
} from './chapter-card-draft-ledger'
import {
  assertNoLossOnSerialize,
} from '../../shared/blueprint-v2-markdown'
import {
  buildBlueprintV2MigrationContent,
  extractBlueprintV2WordBudget,
  getBlueprintV2Scenes,
  projectV2ToV1,
  type ChapterBlueprintV2Content,
  type ChapterBlueprintV2DetailRead,
} from '../../shared/blueprint-v2'
import BlueprintV2Editor from './BlueprintV2Editor'
import BlueprintV2ImportDialog from './BlueprintV2ImportDialog'
import { LatestRequestGate } from './latest-request-gate'
import ChapterCanvasWorkbench from '../canvas/ChapterCanvasWorkbench'
import {
  PlanningPageShell,
  PlanningPane,
  PlanningEmptyState,
} from '../planning/PlanningPageShell'
import {
  BlueprintBookOutlineEditor,
  BlueprintChapterPlanningActions,
  BlueprintPlanningTree,
  BlueprintVolumeOutlineEditor,
  type BlueprintPlanningCandidateView,
} from './BlueprintPlanningViews'
import { startBlueprintPlanningWorkflow } from '../../services/workflows/blueprint-planning-workflow'
import {
  prepareBlueprintVolumeOutlineImport,
  confirmBlueprintVolumeOutlineImport,
  exportBlueprintVolumeOutlineMarkdown,
  prepareBlueprintBookOutlineImport,
  confirmBlueprintBookOutlineImport,
  exportBlueprintBookOutlineMarkdown,
  exportBlueprintPlanningPackage,
  type BlueprintBookOutlineImportPreview,
  type BlueprintVolumeOutlineImportPreview,
} from '../../services/blueprint-planning-exchange'
import { revealSidebarGroup, usePlanningBackPath } from '../planning/planning-navigation'
import {
  AuthoritativeChapterSequenceError,
  readAuthoritativeNextChapter,
} from '../../services/authoritative-chapter-sequence'

const ROLES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾']
const DEFAULT_VOLUME_ID = 'volume-1'

function blueprintV2DetailToContent(detail: ChapterBlueprintV2DetailRead): ChapterBlueprintV2Content {
  return {
    schemaVersion: detail.schemaVersion,
    chapterNumber: detail.chapterNumber,
    chapterTitle: detail.chapterTitle,
    ...(detail.chapterTitleLevel === undefined ? {} : { chapterTitleLevel: detail.chapterTitleLevel }),
    docPreamble: detail.docPreamble,
    ...(detail.chapterPostamble === undefined ? {} : { chapterPostamble: detail.chapterPostamble }),
    ...(detail.planning === undefined ? {} : { planning: detail.planning }),
    sections: detail.sections,
    origin: detail.origin,
  }
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function blueprintVolumeId(blueprint: ChapterBlueprint): string {
  return blueprint.volumeId?.trim() || DEFAULT_VOLUME_ID
}

function createBlueprintVolumeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `volume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function planningSelectionStorageKey(projectId: string): string {
  return `blueprint-planning-selection:${projectId}`
}

function isValidPlanningSelection(
  selection: BlueprintPlanningSelection | null,
  blueprints: ChapterBlueprint[],
  volumes: BlueprintVolumeData[],
): selection is BlueprintPlanningSelection {
  if (!selection || typeof selection !== 'object') return false
  if (selection.kind === 'book') return true
  if (selection.kind === 'volume') return volumes.some(volume => volume.id === selection.volumeId)
  return selection.kind === 'chapter' && blueprints.some(blueprint => blueprint.chapterNumber === selection.chapterNumber)
}

function readStoredPlanningSelection(projectId: string): BlueprintPlanningSelection | null {
  try {
    const raw = localStorage.getItem(planningSelectionStorageKey(projectId))
    return raw ? JSON.parse(raw) as BlueprintPlanningSelection : null
  } catch {
    return null
  }
}

function persistPlanningSelection(projectId: string, selection: BlueprintPlanningSelection): void {
  try { localStorage.setItem(planningSelectionStorageKey(projectId), JSON.stringify(selection)) } catch { /* UI preference only. */ }
}

async function sha256Body(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function candidateView(record: BlueprintPlanningCandidateRecord): BlueprintPlanningCandidateView {
  const sourceSummary = record.sourceSnapshot.sources.map(source => (
    `${source.label ?? source.kind} ${source.targetId}${source.revision == null ? '' : ` r${source.revision}`} ${source.contentHash.slice(0, 8)}`
  )).join(' · ') || '—'
  return {
    operationId: record.operationId,
    kind: record.kind,
    state: record.state,
    payloadHash: record.payloadHash,
    candidate: record.candidate,
    sourceSummary,
  }
}

function planningExchangeError(result: unknown, fallback: string): string {
  if (typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string') return result.error
  return fallback
}

function readDraftLedgerFromFixedTab() {
  return parseChapterCardDraftLedger(
    useEditorStore.getState().draftLedgers[CHAPTER_CARD_TAB_ID],
  )
}

function currentProjectSessionForPath(projectKey: string): ProjectSessionContext | null {
  const projectSession = projectSessionContextFromProject(
    useProjectStore.getState().currentProject,
  )
  return projectSession && sameProjectPathKey(projectSession.projectPath, projectKey)
    ? projectSession
    : null
}

function isCurrentProjectSession(projectSession: ProjectSessionContext): boolean {
  return sameProjectSessionContext(
    projectSession,
    projectSessionContextFromProject(useProjectStore.getState().currentProject),
  )
}

/** 章节蓝图编辑器 — 读写 directory.json */
export default function ChapterCardEditor({
  projectKey,
  initialChapterNumber,
  initialChapterView,
  chapterViewRequest,
  initialPlanningSelection,
}: {
  projectKey: string
  initialChapterNumber?: number
  initialChapterView?: 'blueprint' | 'canvas'
  chapterViewRequest?: number
  initialPlanningSelection?: BlueprintPlanningSelection
}) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const backPath = usePlanningBackPath()
  const currentProject = useProjectStore(s => s.currentProject)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const worldMapNodes = useWorldMapStore(s => s.nodes)
  const worldMaps = useWorldMapStore(s => s.maps)
  // ✅ action 用 getState() 获取，不订阅 workflow store 高频更新
  const addLog = useWorkflowStore.getState().addLog
  const [blueprints, setBlueprints] = useState<ChapterBlueprint[]>([])
  const [volumes, setVolumes] = useState<BlueprintVolumeData[]>([])
  /** 正文反向修纲（对照关联正文）对话框。 */
  const [outlineSyncOpen, setOutlineSyncOpen] = useState(false)
  const [, setSelectedVolumeId] = useState(DEFAULT_VOLUME_ID)
  const [collapsedVolumeIds, setCollapsedVolumeIds] = useState<Set<string>>(() => new Set())
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [planningSelection, setPlanningSelection] = useState<BlueprintPlanningSelection>({ kind: 'book' })
  const planningSelectionRef = useRef<BlueprintPlanningSelection>({ kind: 'book' })
  const [outlineSummaries, setOutlineSummaries] = useState<BlueprintVolumeOutlineSummary[]>([])
  const [synopsisStored, setSynopsisStored] = useState('')
  const [synopsisDraft, setSynopsisDraft] = useState('')
  const [synopsisBaseHash, setSynopsisBaseHash] = useState<string | null>(null)
  const [synopsisLoading, setSynopsisLoading] = useState(false)
  const [synopsisSaving, setSynopsisSaving] = useState(false)
  const [synopsisError, setSynopsisError] = useState<string | null>(null)
  const [bookImportPreview, setBookImportPreview] = useState<BlueprintBookOutlineImportPreview | null>(null)
  const [volumeOutline, setVolumeOutline] = useState<BlueprintVolumeOutline | null>(null)
  const [volumeOutlineDraft, setVolumeOutlineDraft] = useState('')
  const [volumeOutlineLoading, setVolumeOutlineLoading] = useState(false)
  const [volumeOutlineSaving, setVolumeOutlineSaving] = useState(false)
  const [volumeOutlineError, setVolumeOutlineError] = useState<string | null>(null)
  const [volumeImportPreview, setVolumeImportPreview] = useState<BlueprintVolumeOutlineImportPreview | null>(null)
  const [planningCandidates, setPlanningCandidates] = useState<BlueprintPlanningCandidateRecord[]>([])
  const [planningChecks, setPlanningChecks] = useState<BlueprintPlanningCheckRecord[]>([])
  const [planningSourceStatuses, setPlanningSourceStatuses] = useState<Record<string, BlueprintPlanningSourceState>>({})
  const [planningTargetSourceStatuses, setPlanningTargetSourceStatuses] = useState<Record<string, BlueprintPlanningSourceState | 'loading'>>({})
  const [planningBusyOperationId, setPlanningBusyOperationId] = useState<string | null>(null)
  const [planningWorkflowStarting, setPlanningWorkflowStarting] = useState(false)
  const [selectionSaveError, setSelectionSaveError] = useState<string | null>(null)
  const [selectionSaving, setSelectionSaving] = useState(false)
  const [planningCandidatesRevision, setPlanningCandidatesRevision] = useState(0)
  const planningRunIdsRef = useRef(new Map<string, string>())
  // 卷 / 章节清单的搜索与写作状态筛选
  const [searchQuery, setSearchQuery] = useState('')
  const [draftFilter, setDraftFilter] = useState<'all' | 'no-draft' | 'has-draft'>('all')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dirtyChapterNumbers, setDirtyChapterNumbers] = useState<Set<number>>(() => new Set())
  const blueprintsRef = useRef<ChapterBlueprint[]>([])
  const dirtyChapterNumbersRef = useRef<Set<number>>(new Set())
  const [dataProjectSession, setDataProjectSession] = useState<ProjectSessionContext | null>(null)
  const dataProjectSessionRef = useRef<ProjectSessionContext | null>(null)
  const loadRequestGateRef = useRef(new LatestRequestGate())
  const currentProjectSession = projectSessionContextFromProject(currentProject)
  const renderedProjectId = currentProjectSession?.projectId ?? null
  const renderedProjectLeaseId = currentProjectSession?.leaseId ?? null
  const renderedProjectPath = currentProjectSession?.projectPath ?? null
  const projectMatches = sameProjectPathKey(currentProjectSession?.projectPath, projectKey)
  const projectDataReady = Boolean(
    projectMatches
    && sameProjectSessionContext(currentProjectSession, dataProjectSession),
  )
  const dirty = dirtyChapterNumbers.size > 0
  // 下一个可写的章节号
  const [nextWriteChapter, setNextWriteChapter] = useState<number | null>(null)
  const [authorityError, setAuthorityError] = useState<string | null>(null)
  // 选中章的主区视图：蓝图表单 / 章内场景画布。切章后回到蓝图。
  const [chapterView, setChapterView] = useState<'blueprint' | 'canvas'>('blueprint')
  // 旧版仿写导入可能造成“前章未写、后续正文已定稿”的异常状态；该状态只能由用户确认恢复。
  const [legacyImportedTextRecoveryChapter, setLegacyImportedTextRecoveryChapter] = useState<number | null>(null)

  const [recoveringLegacyImportedText, setRecoveringLegacyImportedText] = useState(false)

  // ===== 章节蓝图 v2（细纲）状态 =====
  // v2Detail：所选章的数据库事实（只作为基底，不直接编辑）。
  // v2Draft：本地未保存的编辑副本（镜像到 draftLedgers 的独立 v2 账本；
  // 切章 / 切蓝图-画布视图 / 列表刷新都不会丢失输入）。
  const [v2Detail, setV2Detail] = useState<ChapterBlueprintV2DetailRead | null>(null)
  const [v2Draft, setV2Draft] = useState<ChapterCardBlueprintV2Draft | null>(null)
  const [v2Saving, setV2Saving] = useState(false)
  const [v2Loading, setV2Loading] = useState(false)
  const [v2LoadError, setV2LoadError] = useState<string | null>(null)
  const [v2ReloadNonce, setV2ReloadNonce] = useState(0)
  const [v2ImportOpen, setV2ImportOpen] = useState(false)
  const v2LoadGateRef = useRef(new LatestRequestGate())

  useEffect(() => {
    if (loading || initialPlanningSelection || initialChapterNumber === undefined) return
    const targetIndex = blueprintsRef.current.findIndex(
      blueprint => blueprint.chapterNumber === initialChapterNumber,
    )
    if (targetIndex >= 0) {
      const selection: BlueprintPlanningSelection = { kind: 'chapter', chapterNumber: initialChapterNumber }
      setSelectedIdx(targetIndex)
      planningSelectionRef.current = selection
      setPlanningSelection(selection)
    }
  }, [initialChapterNumber, initialPlanningSelection, loading])

  // 外部视图请求（如概览「回到上次创作位置」直达场景画布）：定位到目标章并
  // 应用请求的视图。与 lastSelectedIdx 同批更新，避免渲染期重置覆盖请求。
  useEffect(() => {
    if (chapterViewRequest === undefined) return
    if (loading) return
    if (initialChapterView !== 'blueprint' && initialChapterView !== 'canvas') return
    setChapterView(initialChapterView)
    if (initialChapterNumber !== undefined) {
      const targetIndex = blueprintsRef.current.findIndex(
        blueprint => blueprint.chapterNumber === initialChapterNumber,
      )
      if (targetIndex >= 0) {
        setSelectedIdx(targetIndex)
        setLastSelectedIdx(targetIndex)
        const selection: BlueprintPlanningSelection = { kind: 'chapter', chapterNumber: initialChapterNumber }
        planningSelectionRef.current = selection
        setPlanningSelection(selection)
      }
    }
    // chapterViewRequest 变化代表一次新的外部视图请求。
  }, [chapterViewRequest, initialChapterView, initialChapterNumber, loading])

  // 切换选中章节时退出画布视图，避免把上一章的画布语境带进新章。
  // React 推荐的「props/state 变化时调整状态」模式：渲染期比较并重置。
  const [lastSelectedIdx, setLastSelectedIdx] = useState(selectedIdx)
  if (lastSelectedIdx !== selectedIdx) {
    setLastSelectedIdx(selectedIdx)
    setChapterView('blueprint')
  }

  const roleLabel = (role: string) => text(role, ({
    建置: 'Setup',
    铺垫: 'Foreshadowing',
    发展: 'Development',
    冲突: 'Conflict',
    高潮: 'Climax',
    转折: 'Turning point',
    收尾: 'Resolution',
  } as Record<string, string>)[role] ?? role)

  const applyVisibleDraftState = useCallback((nextBlueprints: ChapterBlueprint[], nextDirty: Set<number>) => {
    blueprintsRef.current = nextBlueprints
    dirtyChapterNumbersRef.current = nextDirty
    setBlueprints(nextBlueprints)
    setDirtyChapterNumbers(nextDirty)
  }, [])

  const persistProjectDraftState = useCallback((
    projectKey: string,
    projectSession: ProjectSessionContext,
    nextBlueprints: ChapterBlueprint[],
    nextDirty: Set<number>,
  ) => {
    if (
      !isCurrentProjectSession(projectSession)
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const store = useEditorStore.getState()
    const ledger = updateChapterCardProjectDraft(
      readDraftLedgerFromFixedTab(),
      projectKey,
      nextBlueprints,
      nextDirty,
    )
    persistChapterCardDraftLedger(store, ledger)
    applyVisibleDraftState(nextBlueprints, nextDirty)
  }, [applyVisibleDraftState])

  const currentWorkingState = useCallback((
    projectKey: string,
    projectSession: ProjectSessionContext,
  ): DraftState => {
    if (
      isCurrentProjectSession(projectSession)
      && sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) {
      return {
        blueprints: blueprintsRef.current,
        dirtyChapterNumbers: dirtyChapterNumbersRef.current,
      }
    }
    const draft = getChapterCardProjectDraft(readDraftLedgerFromFixedTab(), projectKey)
    return {
      blueprints: draft?.blueprints ?? [],
      dirtyChapterNumbers: new Set(draft?.dirtyChapterNumbers ?? []),
    }
  }, [])

  const markChapterDirty = useCallback((
    nextBlueprints: ChapterBlueprint[],
    chapterNumber: number,
  ) => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const nextDirty = new Set(dirtyChapterNumbersRef.current)
    nextDirty.add(chapterNumber)
    persistProjectDraftState(projectKey, projectSession, nextBlueprints, nextDirty)
  }, [projectKey, projectMatches, persistProjectDraftState])

  const loadBlueprints = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || projectSession.projectId !== renderedProjectId
      || projectSession.leaseId !== renderedProjectLeaseId
      || !sameProjectPathKey(projectSession.projectPath, renderedProjectPath)
    ) {
      loadRequestGateRef.current.begin()
      dataProjectSessionRef.current = null
      setDataProjectSession(null)
      setNextWriteChapter(null)
      setAuthorityError(null)
      setLegacyImportedTextRecoveryChapter(null)
      setSaving(false)
      setVolumes([])
      setSelectedVolumeId(DEFAULT_VOLUME_ID)
      planningSelectionRef.current = { kind: 'book' }
      setPlanningSelection({ kind: 'book' })
      setOutlineSummaries([])
      setSynopsisStored('')
      setSynopsisDraft('')
      setSynopsisBaseHash(null)
      setVolumeOutline(null)
      setVolumeOutlineDraft('')
      setPlanningCandidates([])
      setPlanningChecks([])
      applyVisibleDraftState([], new Set())
      setLoading(false)
      return
    }
    const requestId = loadRequestGateRef.current.begin()
    const isLatestProjectRequest = () => (
      loadRequestGateRef.current.isLatest(requestId)
      && isCurrentProjectSession(projectSession)
    )
    setLoading(true)
    setLegacyImportedTextRecoveryChapter(null)
    if (!sameProjectSessionContext(dataProjectSessionRef.current, projectSession)) {
      dataProjectSessionRef.current = null
      setDataProjectSession(null)
      setNextWriteChapter(null)
      setAuthorityError(null)
      setLegacyImportedTextRecoveryChapter(null)
      setSaving(false)
      setVolumes([])
      setSelectedVolumeId(DEFAULT_VOLUME_ID)
      planningSelectionRef.current = { kind: 'book' }
      setPlanningSelection({ kind: 'book' })
      setOutlineSummaries([])
      setSynopsisStored('')
      setSynopsisDraft('')
      setSynopsisBaseHash(null)
      setVolumeOutline(null)
      setVolumeOutlineDraft('')
      setPlanningCandidates([])
      setPlanningChecks([])
      applyVisibleDraftState([], new Set())
    }
    try {
      const [restored, loadedVolumes] = await Promise.all([
        refreshChapterCardDraftFromRemote({
        projectKey,
        loadRemote: () => loadDirectoryBlueprints(projectKey, projectSession),
        readLedger: readDraftLedgerFromFixedTab,
        isProjectCurrent: isLatestProjectRequest,
        commit: (state, restoredDraft) => {
          dataProjectSessionRef.current = projectSession
          setDataProjectSession(projectSession)
          if (restoredDraft) {
            persistProjectDraftState(
              projectKey,
              projectSession,
              state.blueprints,
              state.dirtyChapterNumbers,
            )
          } else {
            applyVisibleDraftState(state.blueprints, state.dirtyChapterNumbers)
          }
        },
        }),
        ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-list', projectKey),
      ])
      // 项目可能在远端读取期间切换；旧项目结果不会进入 commit。
      if (!restored || !isLatestProjectRequest()) return
      const data = restored.blueprints
      const remoteVolumes = Array.isArray(loadedVolumes) && loadedVolumes.length > 0
        ? loadedVolumes
        : [{ id: DEFAULT_VOLUME_ID, name: text('第1卷', 'Volume 1'), sortOrder: 1 }]
      setVolumes(remoteVolumes)
      const storedSelection = initialPlanningSelection
        ?? (initialChapterNumber === undefined ? readStoredPlanningSelection(projectSession.projectId) : null)
      const routeSelection = initialPlanningSelection
        ?? (initialChapterNumber === undefined ? null : { kind: 'chapter' as const, chapterNumber: initialChapterNumber })
      const preferredSelection = routeSelection ?? storedSelection
      const defaultSelection: BlueprintPlanningSelection = data[0]
        ? { kind: 'chapter', chapterNumber: data[0].chapterNumber }
        : { kind: 'book' }
      const nextSelection = isValidPlanningSelection(preferredSelection, data, remoteVolumes)
        ? preferredSelection
        : defaultSelection
      planningSelectionRef.current = nextSelection
      setPlanningSelection(nextSelection)
      persistPlanningSelection(projectSession.projectId, nextSelection)
      setSelectedVolumeId(current => {
        if (remoteVolumes.some(volume => volume.id === current)) return current
        return data[0] ? blueprintVolumeId(data[0]) : (remoteVolumes[0]?.id ?? DEFAULT_VOLUME_ID)
      })
      if (data.length > 0) {
        const index = data.findIndex(blueprint => blueprint.chapterNumber === (nextSelection.kind === 'chapter' ? nextSelection.chapterNumber : data[0].chapterNumber))
        setSelectedIdx(Math.max(0, index))
      }
      try {
        const nextChapter = await readAuthoritativeNextChapter(projectSession, locale)
        if (!isLatestProjectRequest()) return
        setAuthorityError(null)
        setLegacyImportedTextRecoveryChapter(null)
        setNextWriteChapter(nextChapter)
      } catch (error) {
        if (!isLatestProjectRequest()) return
        const message = error instanceof Error ? error.message : String(error)
        const recoveryChapter = error instanceof AuthoritativeChapterSequenceError
          && error.sequence.firstGapChapterNumber !== undefined
          && error.sequence.lastChapterNumber > error.sequence.firstGapChapterNumber
          ? error.sequence.firstGapChapterNumber
          : null
        setAuthorityError(message)
        setLegacyImportedTextRecoveryChapter(recoveryChapter)
        setNextWriteChapter(null)
      }
    } catch (error) {
      if (isLatestProjectRequest()) {
        const message = error instanceof Error ? error.message : String(error)
        setAuthorityError(message)
        addLog('error', text('读取章节蓝图失败', 'Could not load chapter blueprints'))
      }
    } finally {
      if (isLatestProjectRequest()) setLoading(false)
    }
  }, [
    projectKey,
    initialChapterNumber,
    initialPlanningSelection,
    projectMatches,
    renderedProjectId,
    renderedProjectLeaseId,
    renderedProjectPath,
    addLog,
    text,
    locale,
    applyVisibleDraftState,
    persistProjectDraftState,
  ])

  useEffect(() => {
    let mounted = true
    Promise.resolve().then(() => { if (mounted) loadBlueprints() })
    return () => { mounted = false }
  }, [loadBlueprints, projectKey])

  // 规划候选和检查报告在普通工作流完成后写入；按 runId 识别本编辑器启动的任务。
  useEffect(() => {
    return globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      if (!sameProjectSessionContext(payload.projectSession, currentProjectSessionForPath(projectKey))) return
      if (payload.type === 'directory') loadBlueprints()
      const operationId = planningRunIdsRef.current.get(payload.runId)
      if (!operationId) return
      planningRunIdsRef.current.delete(payload.runId)
      setPlanningBusyOperationId(current => current === operationId ? null : current)
      setPlanningCandidatesRevision(value => value + 1)
    })
  }, [loadBlueprints, projectKey])

  // 单章或批量定稿后，重新读取连续定稿状态，避免旧版异常记录造成跳章入口。
  useEffect(() => {
    return globalEventBus.on('FINALIZE_COMPLETE', ({ projectPath, projectSession }) => {
      if (
        !sameProjectPathKey(projectPath, projectKey)
        || !sameProjectSessionContext(projectSession, currentProjectSessionForPath(projectKey))
      ) return
      loadBlueprints()
    })
  }, [projectKey, loadBlueprints])

  useEffect(() => {
    return globalEventBus.on('REFRESH_RESOURCE', (payload) => {
      if (
        sameProjectSessionContext(
          payload.projectSession,
          currentProjectSessionForPath(projectKey),
        )
        && shouldRefreshBlueprints(payload.resources)
      ) {
        loadBlueprints()
      }
    })
  }, [loadBlueprints, projectKey])

  const selected = projectDataReady && planningSelection.kind === 'chapter'
    ? blueprints.find(blueprint => blueprint.chapterNumber === planningSelection.chapterNumber) ?? null
    : null
  const selectedChapterDirty = Boolean(selected && dirtyChapterNumbers.has(selected.chapterNumber))

  const planningSelectionKey = planningSelection.kind === 'book'
    ? 'book'
    : planningSelection.kind === 'volume'
      ? `volume:${planningSelection.volumeId}`
      : `chapter:${planningSelection.chapterNumber}`

  useEffect(() => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectDataReady || !projectSession) {
      setSynopsisLoading(false)
      setVolumeOutlineLoading(false)
      return
    }
    let stale = false
    const selectionSnapshot = planningSelection
    const stillCurrent = () => !stale
      && isCurrentProjectSession(projectSession)
      && sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
      && planningSelectionKey === (
        planningSelectionRef.current.kind === 'book' ? 'book'
          : planningSelectionRef.current.kind === 'volume' ? `volume:${planningSelectionRef.current.volumeId}`
            : `chapter:${planningSelectionRef.current.chapterNumber}`
      )
    setSynopsisLoading(true)
    setSynopsisError(null)
    setPlanningCandidates([])
    setPlanningChecks([])
    setPlanningSourceStatuses({})
    if (selectionSnapshot.kind === 'volume') {
      setVolumeOutline(null)
      setVolumeOutlineDraft('')
      setVolumeOutlineLoading(true)
      setVolumeOutlineError(null)
      setVolumeImportPreview(null)
    } else {
      setVolumeOutline(null)
      setVolumeOutlineDraft('')
      setVolumeOutlineError(null)
      setVolumeImportPreview(null)
    }
    if (selectionSnapshot.kind !== 'book') setBookImportPreview(null)
    void Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectKey),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-list-summaries', projectKey),
      selectionSnapshot.kind === 'volume'
        ? ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-get', selectionSnapshot.volumeId, projectKey)
        : Promise.resolve(null),
    ]).then(async ([core, summaries, volumeRecord]) => {
      if (!stillCurrent()) return
      const nextSynopsis = core?.synopsis ?? ''
      const nextHash = await sha256Body(nextSynopsis)
      if (!stillCurrent()) return
      setSynopsisStored(nextSynopsis)
      setSynopsisDraft(nextSynopsis)
      setSynopsisBaseHash(nextHash)
      setOutlineSummaries(Array.isArray(summaries) ? summaries : [])
      const outline = selectionSnapshot.kind === 'volume' ? volumeRecord : null
      setVolumeOutline(outline)
      setVolumeOutlineDraft(outline?.markdown ?? '')
      setSynopsisLoading(false)
      setVolumeOutlineLoading(false)
    }).catch(error => {
      if (!stillCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      setSynopsisError(message)
      setSynopsisLoading(false)
      setVolumeOutlineLoading(false)
    })
    return () => { stale = true }
  }, [
    projectDataReady,
    projectKey,
    renderedProjectId,
    renderedProjectLeaseId,
    renderedProjectPath,
    planningSelectionKey,
  ])

  useEffect(() => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectDataReady || !projectSession) return
    let stale = false
    const selectionSnapshot = planningSelection
    const stillCurrent = () => !stale
      && isCurrentProjectSession(projectSession)
      && sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
      && planningSelectionKey === (
        planningSelectionRef.current.kind === 'book' ? 'book'
          : planningSelectionRef.current.kind === 'volume' ? `volume:${planningSelectionRef.current.volumeId}`
            : `chapter:${planningSelectionRef.current.chapterNumber}`
      )
    void Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-list-summaries', projectKey),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-candidate-list', { selection: selectionSnapshot, limit: 20 }, projectKey),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-check-list', { selection: selectionSnapshot, limit: 20 }, projectKey),
    ]).then(([summaries, candidates, checks]) => {
      if (!stillCurrent()) return
      setOutlineSummaries(Array.isArray(summaries) ? summaries : [])
      setPlanningCandidates(Array.isArray(candidates) ? candidates : [])
      setPlanningChecks(Array.isArray(checks) ? checks : [])
    }).catch(error => {
      if (!stillCurrent()) return
      setPlanningCandidates([])
      setPlanningChecks([])
      const message = error instanceof Error ? error.message : String(error)
      setSelectionSaveError(text(`读取候选与检查报告失败：${message}`, `Could not load candidates and checks: ${message}`))
    })
    return () => { stale = true }
  }, [
    projectDataReady,
    projectKey,
    renderedProjectId,
    renderedProjectLeaseId,
    renderedProjectPath,
    planningSelectionKey,
    planningCandidatesRevision,
    text,
  ])

  const planningSnapshotIds = [
    volumeOutline?.sourceSnapshotId,
    ...planningChecks.map(check => check.sourceSnapshot.snapshotId),
  ].filter((snapshotId): snapshotId is string => Boolean(snapshotId))
  const planningSnapshotKey = [...new Set(planningSnapshotIds)].sort().join('|')
  useEffect(() => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectDataReady || !projectSession || !planningSnapshotKey) {
      setPlanningSourceStatuses({})
      return
    }
    let stale = false
    void ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-planning-source-status',
      [...new Set(planningSnapshotIds)],
      projectKey,
    ).then(statuses => {
      if (stale || !isCurrentProjectSession(projectSession)) return
      setPlanningSourceStatuses(Object.fromEntries(statuses.map(status => [status.snapshotId, status.state])))
    }).catch(() => {
      if (!stale && isCurrentProjectSession(projectSession)) setPlanningSourceStatuses({})
    })
    return () => { stale = true }
  }, [planningSnapshotKey, projectDataReady, projectKey, renderedProjectId, renderedProjectLeaseId, renderedProjectPath])

  const planningTargetRefs: BlueprintPlanningTargetSourceReference[] = blueprints.map(blueprint => ({
    targetKind: 'chapter',
    targetId: String(blueprint.chapterNumber),
  }))
  const planningTargetKey = planningTargetRefs.map(target => target.targetId).sort().join('|')
  useEffect(() => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectDataReady || !projectSession || !planningTargetKey) {
      setPlanningTargetSourceStatuses({})
      return
    }
    let stale = false
    const targets: BlueprintPlanningTargetSourceReference[] = planningTargetKey.split('|').map(targetId => ({ targetKind: 'chapter', targetId }))
    setPlanningTargetSourceStatuses(Object.fromEntries(targets.map(target => [`${target.targetKind}:${target.targetId}`, 'loading'])))
    void ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-planning-target-source-status',
      targets,
      projectKey,
    ).then(statuses => {
      if (stale || !isCurrentProjectSession(projectSession)) return
      setPlanningTargetSourceStatuses(Object.fromEntries(statuses.map(status => [`${status.targetKind}:${status.targetId}`, status.state])))
    }).catch(() => {
      if (stale || !isCurrentProjectSession(projectSession)) return
      setPlanningTargetSourceStatuses(Object.fromEntries(targets.map(target => [`${target.targetKind}:${target.targetId}`, 'unlinked'])))
    })
    return () => { stale = true }
  }, [planningTargetKey, projectDataReady, projectKey, renderedProjectId, renderedProjectLeaseId, renderedProjectPath])

  // ===== 章节蓝图 v2：读取 / 编辑 / 保存 =====

  const selectedChapterNumber = selected?.chapterNumber ?? null
  const v2SelectedChapterRef = useRef<number | null>(selectedChapterNumber)
  v2SelectedChapterRef.current = selectedChapterNumber

  const readV2Ledger = useCallback(() => parseChapterCardV2DraftLedger(
    useEditorStore.getState().draftLedgers[CHAPTER_CARD_V2_TAB_ID],
  ), [])

  const persistV2Ledger = useCallback((draft: ChapterCardBlueprintV2Draft | null, chapterNumber: number) => {
    const store = useEditorStore.getState()
    let ledger = parseChapterCardV2DraftLedger(store.draftLedgers[CHAPTER_CARD_V2_TAB_ID])
    if (draft) ledger = updateChapterCardV2Draft(ledger, projectKey, draft)
    else ledger = discardChapterCardV2Draft(ledger, projectKey, chapterNumber)
    persistChapterCardV2DraftLedger(store, ledger)
  }, [projectKey])

  // 所选章变化（或从画布视图返回）时：拉取数据库事实 + 恢复本地未保存草稿。
  // 统一编辑界面：数据库尚无细纲的章（启动迁移未覆盖的旧数据、工作流本轮
  // 写入的简纲行、本地新建章节）按同一迁移映射生成种子内容并进入本地草稿
  // 账本；保存时经 db:blueprint-v2-save 落库，取消/不保存则无任何数据库写入。
  // 种子内容确定性（条目 ID 派生自章节号），因此「未编辑过的种子」可跨会话
  // 识别，允许直接从 v1 行启动写作。
  const v2SeedJsonRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectDataReady || selectedChapterNumber === null || chapterView === 'canvas') {
      v2LoadGateRef.current.begin()
      v2SeedJsonRef.current = null
      return
    }
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    const requestId = v2LoadGateRef.current.begin()
    let stale = false
    setV2Loading(true)
    setV2LoadError(null)
    // 立刻清空上一章的数据库事实：载入期间显示载入态，而不是把旧章内容挂在新章标题下。
    setV2Detail(null)
    v2SeedJsonRef.current = null
    void (async () => {
      try {
        const detail = await ipc.invokeWithProjectSession(
          projectSession, 'db:blueprint-v2-get', selectedChapterNumber, projectKey,
        )
        if (stale || !v2LoadGateRef.current.isLatest(requestId)) return
        if (detail === null) {
          const source = blueprintsRef.current.find(
            item => item.chapterNumber === selectedChapterNumber,
          ) ?? null
          if (source) {
            const seedContent = buildBlueprintV2MigrationContent(source, { origin: 'manual' })
            v2SeedJsonRef.current = JSON.stringify(seedContent)
            if (!getChapterCardV2Draft(readV2Ledger(), projectKey, selectedChapterNumber)) {
              const seedDraft: ChapterCardBlueprintV2Draft = {
                chapterNumber: selectedChapterNumber,
                content: seedContent,
                baseRevision: 0,
              }
              // 展示未编辑的种子不是作者修改；首次实际编辑时再进入持久草稿账本。
              setV2Draft(seedDraft)
            }
          } else {
            v2SeedJsonRef.current = null
          }
        } else {
          v2SeedJsonRef.current = null
        }
        setV2Detail(detail)
      } catch (error) {
        if (!stale && v2LoadGateRef.current.isLatest(requestId)) {
          setV2Detail(null)
          setV2LoadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!stale && v2LoadGateRef.current.isLatest(requestId)) setV2Loading(false)
      }
    })()
    // 本地草稿（若有）优先于数据库事实展示；保存时以 baseRevision 乐观并发。
    setV2Draft(getChapterCardV2Draft(readV2Ledger(), projectKey, selectedChapterNumber) ?? null)
    return () => { stale = true }
    // chapterView 变化（从画布返回蓝图）需要重取，画布可能改过 presence / 顺序。
  }, [chapterView, projectDataReady, projectKey, readV2Ledger, selectedChapterNumber, v2ReloadNonce])

  const v2Content = v2Draft
    ? v2Draft.content
    : (v2Detail && v2Detail.readStatus === undefined ? blueprintV2DetailToContent(v2Detail) : null)
  const v2BaseRevision = v2Draft?.baseRevision ?? (v2Detail && v2Detail.readStatus === undefined ? v2Detail.revision : 0)
  const v2ConflictRevision = v2Draft?.conflictCurrentRevision ?? null
  const v2Dirty = v2Draft !== null
  // 种子未编辑 = 草稿内容与确定性种子完全一致且数据库确无细纲行。
  // 此时写作入口可直接走 v1 行数据，无需先保存种子。
  const v2SeedUnsaved = Boolean(
    v2Draft
    && v2Detail === null
    && v2SeedJsonRef.current !== null
    && JSON.stringify(v2Draft.content) === v2SeedJsonRef.current,
  )

  /** 更新 v2 细纲内容：写入本地草稿 + 持久到账本（输入永不因视图切换丢失）。 */
  const updateV2Content = useCallback((next: ChapterBlueprintV2Content) => {
    if (selectedChapterNumber === null) return
    const draft: ChapterCardBlueprintV2Draft = {
      chapterNumber: selectedChapterNumber,
      content: next,
      baseRevision: v2BaseRevision,
      conflictCurrentRevision: v2ConflictRevision,
    }
    persistV2Ledger(draft, selectedChapterNumber)
    setV2Draft(draft)
  }, [persistV2Ledger, selectedChapterNumber, v2BaseRevision, v2ConflictRevision])

  /** v2 细纲保存：乐观并发；失败/冲突保持当前输入与当前章节。 */
  const handleSaveV2 = useCallback(async (overrideBaseRevision?: number) => {
    if (!selected || !v2Content) return
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return
    const baseRevision = overrideBaseRevision ?? v2BaseRevision
    const chapterNumber = selected.chapterNumber
    const contentSnapshot = v2Content
    setV2Saving(true)
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-save', {
        chapterNumber,
        baseRevision,
        content: contentSnapshot,
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.success) {
        if (result.conflict) {
          const latestDraft = getChapterCardV2Draft(readV2Ledger(), projectKey, chapterNumber)
          const conflicted: ChapterCardBlueprintV2Draft = {
            chapterNumber,
            content: latestDraft?.content ?? contentSnapshot,
            baseRevision: latestDraft?.baseRevision ?? baseRevision,
            conflictCurrentRevision: result.currentRevision ?? null,
          }
          persistV2Ledger(conflicted, chapterNumber)
          if (v2SelectedChapterRef.current === chapterNumber) setV2Draft(conflicted)
          toast.error(text(
            `第 ${chapterNumber} 章细纲已被其他窗口修改（当前 r${result.currentRevision ?? '?'}）。可选择「覆盖保存」或「放弃本地并重载」。`,
            `The outline for Chapter ${chapterNumber} changed elsewhere (current r${result.currentRevision ?? '?'}). Choose “Overwrite” or “Discard local and reload”.`,
          ))
        } else {
          toast.error(text(
            `保存细纲失败\n\n${result.error ?? '未知错误'}`,
            `Could not save the outline.\n\n${result.error ?? 'Unknown error'}`,
          ))
        }
        return // 保持输入与当前章节（不回滚、不重置）
      }
      const savedRevision = result.revision ?? baseRevision + 1
      const latestDraft = getChapterCardV2Draft(readV2Ledger(), projectKey, chapterNumber)
      let retainedDraft: ChapterCardBlueprintV2Draft | null = null
      if (latestDraft && JSON.stringify(latestDraft.content) !== JSON.stringify(contentSnapshot)) {
        retainedDraft = { ...latestDraft, baseRevision: savedRevision, conflictCurrentRevision: null }
        persistV2Ledger(retainedDraft, chapterNumber)
      } else {
        persistV2Ledger(null, chapterNumber)
      }
      if (v2SelectedChapterRef.current === chapterNumber) {
        setV2Detail({ ...contentSnapshot, revision: savedRevision, contentHash: result.contentHash ?? '' })
        setV2Draft(retainedDraft)
        v2SeedJsonRef.current = null
      }
      // 本地同步 v1 投影四列（title/purpose/keyEvents/suspenseHook），不整页重载，
      // 避免选中章跳回第一章；其余章节由下次读取自然刷新。
      const currentBlueprint = blueprintsRef.current.find(blueprint => blueprint.chapterNumber === chapterNumber) ?? selected
      const projection = projectV2ToV1(contentSnapshot, currentBlueprint)
      const nextBlueprints = blueprintsRef.current.map(blueprint => (
        blueprint.chapterNumber === chapterNumber ? { ...blueprint, ...projection } : blueprint
      ))
      blueprintsRef.current = nextBlueprints
      setBlueprints(nextBlueprints)
      addLog('info', text(
        `第 ${chapterNumber} 章细纲已保存（r${savedRevision}）`,
        `Saved the outline for Chapter ${chapterNumber} (r${savedRevision})`,
      ))
      toast.success(text(
        `第 ${chapterNumber} 章细纲已保存`,
        `Saved the outline for Chapter ${chapterNumber}`,
      ))
    } catch (error) {
      if (!isCurrentProjectSession(projectSession)) return
      const message = error instanceof Error ? error.message : String(error)
      toast.error(text(`保存细纲失败\n\n${message}`, `Could not save the outline.\n\n${message}`))
    } finally {
      if (isCurrentProjectSession(projectSession)) setV2Saving(false)
    }
  }, [addLog, persistV2Ledger, projectKey, projectMatches, readV2Ledger, selected, text, v2BaseRevision, v2Content])

  /** 冲突恢复：放弃本地编辑并重载最新细纲。 */
  const handleDiscardV2Draft = useCallback(async () => {
    if (selectedChapterNumber === null) return
    const chapterNumber = selectedChapterNumber
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    persistV2Ledger(null, chapterNumber)
    setV2Draft(null)
    try {
      const detail = await ipc.invokeWithProjectSession(
        projectSession, 'db:blueprint-v2-get', chapterNumber, projectKey,
      )
      if (!isCurrentProjectSession(projectSession) || v2SelectedChapterRef.current !== chapterNumber) return
      setV2Detail(detail)
      v2SeedJsonRef.current = detail ? null : v2SeedJsonRef.current
      setV2LoadError(null)
    } catch {
      // 保留已有 detail；用户可手动刷新。
    }
  }, [persistV2Ledger, projectKey, selectedChapterNumber])

  /** 导出规范 Markdown（先无损自检，再复制到剪贴板）。 */
  const handleExportV2 = useCallback(async () => {
    if (!v2Content) return
    try {
      const markdown = assertNoLossOnSerialize(v2Content)
      await copyTextToClipboard(markdown)
      toast.success(text(
        '已通过无损自检并复制规范 Markdown 到剪贴板',
        'Lossless check passed; the canonical Markdown is copied to the clipboard',
      ))
    } catch (error) {
      toast.error(text(
        `导出自检失败：${error instanceof Error ? error.message : String(error)}`,
        `Export check failed: ${error instanceof Error ? error.message : String(error)}`,
      ))
    }
  }, [v2Content])

  /** 删除细纲（独立用户动作；v1 行字段保留投影值，画布卡保留并显示引用失效）。 */
  const handleDeleteV2Detail = useCallback(async () => {
    if (!selected) return
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return
    const ok = await confirm(text(
      `确认删除第 ${selected.chapterNumber} 章的正式细纲（含分镜正文、规则与禁忌）？\n\n此操作不可撤销；章节概要字段保留删除前的投影值，画布上已关联的场景卡会保留并显示「引用失效」。`,
      `Delete the formal outline for Chapter ${selected.chapterNumber} (including scene bodies, rules, and taboos)?\n\nThis cannot be undone; the summary fields keep their last projected values; linked canvas cards stay and show a “broken reference” badge.`,
    ), {
      title: text('删除细纲', 'Delete outline'),
      confirmText: text('删除细纲', 'Delete outline'),
      danger: true,
    })
    if (!ok || !isCurrentProjectSession(projectSession)) return
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession, 'db:blueprint-v2-delete', selected.chapterNumber, projectKey,
      )
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.success) {
        toast.error(text(`删除失败\n\n${result.error ?? '未知错误'}`, `Could not delete.\n\n${result.error ?? 'Unknown error'}`))
        return
      }
      persistV2Ledger(null, selected.chapterNumber)
      if (v2SelectedChapterRef.current === selected.chapterNumber) {
        setV2Draft(null)
        setV2Detail(null)
      }
      // 重新载入：章仍可能有 v1 行（迁移来源），按统一规则重新生成种子内容。
      setV2ReloadNonce(value => value + 1)
      toast.success(text(`已删除第 ${selected.chapterNumber} 章细纲`, `Deleted the outline for Chapter ${selected.chapterNumber}`))
    } catch (error) {
      toast.error(text(
        `删除失败\n\n${error instanceof Error ? error.message : String(error)}`,
        `Could not delete.\n\n${error instanceof Error ? error.message : String(error)}`,
      ))
    }
  }, [persistV2Ledger, projectKey, projectMatches, selected])

  /** 画布侧改过蓝图（排上/移出/删除/重排）后刷新数据库事实；本地草稿保留。 */
  const handleV2DetailRefresh = useCallback(async (chapterNumber: number) => {
    if (chapterNumber !== selectedChapterNumber) return
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    try {
      const detail = await ipc.invokeWithProjectSession(
        projectSession, 'db:blueprint-v2-get', chapterNumber, projectKey,
      )
      if (!isCurrentProjectSession(projectSession) || v2SelectedChapterRef.current !== chapterNumber) return
      setV2Detail(detail)
      v2SeedJsonRef.current = detail ? null : v2SeedJsonRef.current
      setV2LoadError(null)
    } catch {
      // 下次进入页面会重新读取。
    }
  }, [projectKey, selectedChapterNumber])

  /** 导入完成：若目标即当前章，重取事实。 */
  const handleV2Imported = useCallback(async (chapterNumber: number) => {
    if (chapterNumber !== selectedChapterNumber) return
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    try {
      const detail = await ipc.invokeWithProjectSession(
        projectSession, 'db:blueprint-v2-get', chapterNumber, projectKey,
      )
      if (!isCurrentProjectSession(projectSession) || v2SelectedChapterRef.current !== chapterNumber) return
      setV2Detail(detail)
      v2SeedJsonRef.current = detail ? null : v2SeedJsonRef.current
      setV2LoadError(null)
      persistV2Ledger(null, chapterNumber)
      setV2Draft(null)
    } catch {
      // 下次进入页面会重新读取。
    }
  }, [persistV2Ledger, projectKey, selectedChapterNumber])

  /** 「保存全部」/退出保存的前半段：先落所有 v2 细纲草稿（失败保留草稿）。 */
  const handleSaveAllV2Drafts = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return
    const drafts = [...(getChapterCardV2ProjectDraft(readV2Ledger(), projectKey)?.drafts ?? [])]
    for (const draft of drafts) {
      try {
        const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-save', {
          chapterNumber: draft.chapterNumber,
          baseRevision: draft.baseRevision,
          content: draft.content,
        }, projectKey)
        if (!isCurrentProjectSession(projectSession)) return
        if (result.success) {
          const savedRevision = result.revision ?? draft.baseRevision + 1
          const latestDraft = getChapterCardV2Draft(readV2Ledger(), projectKey, draft.chapterNumber)
          if (latestDraft && JSON.stringify(latestDraft.content) !== JSON.stringify(draft.content)) {
            persistV2Ledger({ ...latestDraft, baseRevision: savedRevision, conflictCurrentRevision: null }, draft.chapterNumber)
          } else {
            persistV2Ledger(null, draft.chapterNumber)
          }
          // 同步本地 v1 投影，避免随后的 v1 全量保存把陈旧投影写回数据库。
          const blueprint = blueprintsRef.current.find(item => item.chapterNumber === draft.chapterNumber)
          if (blueprint) {
            const projection = projectV2ToV1(draft.content, blueprint)
            blueprintsRef.current = blueprintsRef.current.map(item => (
              item.chapterNumber === draft.chapterNumber ? { ...item, ...projection } : item
            ))
            setBlueprints(blueprintsRef.current)
          }
          if (draft.chapterNumber === v2SelectedChapterRef.current) {
            const currentDraft = getChapterCardV2Draft(readV2Ledger(), projectKey, draft.chapterNumber)
            const unchanged = !currentDraft || JSON.stringify(currentDraft.content) === JSON.stringify(draft.content)
            setV2Draft(unchanged ? null : { ...currentDraft!, baseRevision: savedRevision, conflictCurrentRevision: null })
            setV2Detail({ ...draft.content, revision: savedRevision, contentHash: result.contentHash ?? '' })
          }
        } else if (result.conflict) {
          const latestDraft = getChapterCardV2Draft(readV2Ledger(), projectKey, draft.chapterNumber) ?? draft
          const conflicted = { ...latestDraft, conflictCurrentRevision: result.currentRevision ?? null }
          persistV2Ledger(conflicted, draft.chapterNumber)
          if (draft.chapterNumber === v2SelectedChapterRef.current) setV2Draft(conflicted)
          toast.error(text(
            `第 ${draft.chapterNumber} 章细纲冲突（当前 r${result.currentRevision ?? '?'}），已保留本地编辑。`,
            `The outline for Chapter ${draft.chapterNumber} conflicts (current r${result.currentRevision ?? '?'}); local edits are kept.`,
          ))
        } else {
          toast.error(text(
            `第 ${draft.chapterNumber} 章细纲保存失败：${result.error ?? '未知错误'}（草稿已保留）`,
            `Could not save the outline for Chapter ${draft.chapterNumber}: ${result.error ?? 'Unknown error'} (draft kept)`,
          ))
        }
      } catch (error) {
        if (!isCurrentProjectSession(projectSession)) return
        toast.error(text(
          `第 ${draft.chapterNumber} 章细纲保存失败：${error instanceof Error ? error.message : String(error)}（草稿已保留）`,
          `Could not save the outline for Chapter ${draft.chapterNumber}: ${error instanceof Error ? error.message : String(error)} (draft kept)`,
        ))
      }
    }
    if (getChapterCardV2ProjectDraft(readV2Ledger(), projectKey)?.drafts.length) {
      throw new Error(text('细纲仍有未保存修改，请处理冲突或保存失败后重试', 'Outline edits remain unsaved. Resolve conflicts or save errors before retrying.'))
    }
  }, [persistV2Ledger, projectKey, projectMatches, readV2Ledger, text])

  // 独立 ref 持有 v1 全量保存（每渲染同步），供组合保存调用，避免互相递归。
  // ref 只声明不初始化；赋值 effect 位于 handleSaveAll 声明之后。
  const saveAllRef = useRef<(() => Promise<void>) | null>(null)

  const handleSaveAllWithV2 = useCallback(async () => {
    await handleSaveAllV2Drafts()
    await saveAllRef.current?.()
  }, [handleSaveAllV2Drafts])

  const synopsisDirty = synopsisDraft !== synopsisStored
  const volumeOutlineDirty = volumeOutlineDraft !== (volumeOutline?.markdown ?? '')

  const handleSaveSynopsis = useCallback(async (markdown = synopsisDraft): Promise<boolean> => {
    const projectSession = currentProjectSessionForPath(projectKey)
    const nextDirty = markdown !== synopsisStored
    if (!projectSession || !projectMatches || !nextDirty) return !nextDirty
    if (markdown === '' && (synopsisStored !== '' || synopsisDraft !== '')) {
      const ok = await confirm(text(
        '将清空全书总纲正文。该正文保存在项目唯一权威字段中，清空后不能自动恢复。',
        'This clears the book outline body in its only authoritative project field. The previous text cannot be restored automatically.',
      ), {
        title: text('确认清空全书总纲', 'Confirm clearing the book outline'),
        confirmText: text('清空总纲', 'Clear outline'),
        danger: true,
      })
      if (!ok || !isCurrentProjectSession(projectSession)) return false
    }
    setSynopsisSaving(true)
    setSynopsisError(null)
    try {
      const expectedSynopsisHash = synopsisBaseHash ?? await sha256Body(synopsisStored)
      if (!isCurrentProjectSession(projectSession)) return false
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:project-core-update', {
        synopsis: markdown,
        expectedSynopsisHash,
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return false
      if (!result.success) {
        const message = result.error ?? text('总纲已在其他位置修改，请重新读取后合并。', 'The book outline changed elsewhere. Reload and merge your edits.')
        setSynopsisError(message)
        toast.error(text(`保存总纲失败：${message}`, `Could not save the book outline: ${message}`))
        return false
      }
      const readback = await ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectKey)
      if (!isCurrentProjectSession(projectSession)) return false
      const savedText = readback?.synopsis ?? ''
      if (savedText !== markdown) {
        const message = text('保存后的总纲读回与输入不一致；原输入仍保留。', 'The saved outline did not match the editor after read-back; your input is preserved.')
        setSynopsisError(message)
        return false
      }
      const savedHash = await sha256Body(savedText)
      if (!isCurrentProjectSession(projectSession)) return false
      setSynopsisStored(savedText)
      setSynopsisDraft(savedText)
      setSynopsisBaseHash(savedHash)
      setSynopsisError(null)
      toast.success(text('全书总纲已保存', 'Book outline saved'))
      setPlanningCandidatesRevision(value => value + 1)
      return true
    } catch (error) {
      if (!isCurrentProjectSession(projectSession)) return false
      const message = error instanceof Error ? error.message : String(error)
      setSynopsisError(message)
      toast.error(text(`保存总纲失败：${message}`, `Could not save the book outline: ${message}`))
      return false
    } finally {
      if (isCurrentProjectSession(projectSession)) setSynopsisSaving(false)
    }
  }, [projectKey, projectMatches, synopsisBaseHash, synopsisDraft, synopsisStored, text])

  const handleDiscardSynopsis = useCallback(() => {
    setSynopsisDraft(synopsisStored)
    setSynopsisError(null)
  }, [synopsisStored])

  const handleClearSynopsis = useCallback(async () => {
    if (!synopsisStored && !synopsisDraft) return
    const saved = await handleSaveSynopsis('')
    if (saved) setBookImportPreview(null)
  }, [handleSaveSynopsis, synopsisDraft, synopsisStored])

  const handleSaveVolumeOutline = useCallback(async (
    markdown = volumeOutlineDraft,
    origin: BlueprintVolumeOutlineOrigin = 'manual',
  ): Promise<boolean> => {
    if (planningSelection.kind !== 'volume') return false
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return false
    if (markdown === '' && volumeOutline?.markdown) {
      const ok = await confirm(text(
        '空卷纲正文会删除当前卷纲记录；本卷和章节归属会保留。',
        'An empty volume outline deletes this outline record; the volume and chapter assignments remain.',
      ), {
        title: text('确认清空本卷卷纲', 'Confirm clearing the volume outline'),
        confirmText: text('清空卷纲', 'Clear outline'),
        danger: true,
      })
      if (!ok || !isCurrentProjectSession(projectSession)) return false
      setVolumeOutlineSaving(true)
      setVolumeOutlineError(null)
      try {
        const deleted = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-delete', {
          volumeId: planningSelection.volumeId,
          expectedRevision: volumeOutline.revision,
        }, projectKey)
        if (!isCurrentProjectSession(projectSession)) return false
        if (!deleted.success) {
          const message = `${deleted.code} · ${deleted.error}`
          setVolumeOutlineError(message)
          toast.error(text(`清空卷纲失败：${message}`, `Could not clear the volume outline: ${message}`))
          return false
        }
        setVolumeOutline(null)
        setVolumeOutlineDraft('')
        setOutlineSummaries(current => current.filter(summary => summary.volumeId !== planningSelection.volumeId))
        setPlanningCandidatesRevision(value => value + 1)
        toast.success(text('本卷卷纲已清空；卷与章节归属保留。', 'The volume outline was cleared; the volume and chapter assignments remain.'))
        return true
      } catch (error) {
        if (!isCurrentProjectSession(projectSession)) return false
        const message = error instanceof Error ? error.message : String(error)
        setVolumeOutlineError(message)
        toast.error(text(`清空卷纲失败：${message}`, `Could not clear the volume outline: ${message}`))
        return false
      } finally {
        if (isCurrentProjectSession(projectSession)) setVolumeOutlineSaving(false)
      }
    }
    if (markdown === '' && !volumeOutline) return false
    setVolumeOutlineSaving(true)
    setVolumeOutlineError(null)
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-save', {
        volumeId: planningSelection.volumeId,
        expectedRevision: volumeOutline?.revision ?? 0,
        markdown,
        origin,
        ...(volumeOutline?.sourceSnapshotId ? { sourceSnapshotId: volumeOutline.sourceSnapshotId } : {}),
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return false
      if (!result.success) {
        const message = result.error ?? text('卷纲版本已变化，请重新读取并合并。', 'The volume outline changed; reload and merge your edits.')
        setVolumeOutlineError(message)
        toast.error(text(`保存卷纲失败：${message}`, `Could not save the volume outline: ${message}`))
        return false
      }
      const saved = await ipc.invokeWithProjectSession(
        projectSession,
        'db:blueprint-volume-outline-get',
        planningSelection.volumeId,
        projectKey,
      )
      if (!isCurrentProjectSession(projectSession)) return false
      if (!saved || saved.revision !== result.outline.revision || saved.contentHash !== result.outline.contentHash || saved.markdown !== markdown) {
        const message = text('保存卷纲后的数据库读回不一致；编辑输入仍保留。', 'The saved outline did not match the database read-back; editor input is preserved.')
        setVolumeOutlineError(message)
        return false
      }
      setVolumeOutline(saved)
      setVolumeOutlineDraft(saved.markdown)
      setOutlineSummaries(current => {
        const summary = saved.markdown.replace(/\s+/gu, ' ').trim().slice(0, 240)
        const item: BlueprintVolumeOutlineSummary = {
          volumeId: saved.volumeId,
          revision: saved.revision,
          contentHash: saved.contentHash,
          origin: saved.origin,
          updatedAt: saved.updatedAt,
          summary,
        }
        return [...current.filter(existing => existing.volumeId !== saved.volumeId), item]
      })
      setVolumeOutlineError(null)
      toast.success(text('本卷卷纲已保存', 'Volume outline saved'))
      setPlanningCandidatesRevision(value => value + 1)
      return true
    } catch (error) {
      if (!isCurrentProjectSession(projectSession)) return false
      const message = error instanceof Error ? error.message : String(error)
      setVolumeOutlineError(message)
      toast.error(text(`保存卷纲失败：${message}`, `Could not save the volume outline: ${message}`))
      return false
    } finally {
      if (isCurrentProjectSession(projectSession)) setVolumeOutlineSaving(false)
    }
  }, [planningSelection, projectKey, projectMatches, text, volumeOutline, volumeOutlineDraft])

  const handleDiscardVolumeOutline = useCallback(() => {
    setVolumeOutlineDraft(volumeOutline?.markdown ?? '')
    setVolumeOutlineError(null)
  }, [volumeOutline])

  const saveActivePlanningSelection = useCallback(async (): Promise<boolean> => {
    const current = planningSelectionRef.current
    if (current.kind === 'book') return synopsisDirty ? handleSaveSynopsis() : true
    if (current.kind === 'volume') return volumeOutlineDirty ? handleSaveVolumeOutline() : true
    if (!dirty && !v2Dirty) return true
    try {
      await handleSaveAllWithV2()
      return dirtyChapterNumbersRef.current.size === 0
        && (getChapterCardV2ProjectDraft(readV2Ledger(), projectKey)?.drafts.length ?? 0) === 0
    } catch (error) {
      setSelectionSaveError(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [dirty, handleSaveAllWithV2, handleSaveSynopsis, handleSaveVolumeOutline, projectKey, synopsisDirty, v2Dirty, volumeOutlineDirty])

  const handleStartPlanningWorkflow = useCallback(async (
    kind: 'book-outline' | 'volume-plan' | 'volume-outline' | 'chapter-plan' | 'chapter-expand' | 'connection-check',
    options?: { guidance?: string; mode?: 'generate' | 'improve'; plannedChapterCount?: number; chapterRange?: { from: number; to: number } },
  ) => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return
    const generationModelId = useLLMStore.getState().defaultModelId?.trim()
    if (!generationModelId) {
      toast.error(text('请先在设置中配置 AI 生成模型。', 'Configure a generation model in Settings first.'))
      return
    }
    if (kind === 'volume-outline' || kind === 'chapter-plan') {
      if (planningSelection.kind !== 'volume') {
        toast.warning(text('请先选中一个现有卷，再生成卷纲或章节计划。', 'Select an existing volume before generating its outline or chapter plan.'))
        return
      }
    }
    if (kind === 'chapter-expand' && planningSelection.kind !== 'chapter') {
      toast.warning(text('请先选中一章，再生成细纲候选。', 'Select a chapter before generating a detailed outline candidate.'))
      return
    }
    if (kind === 'connection-check' && planningSelection.kind === 'chapter') {
      toast.warning(text('衔接检查需要选中全书或一卷。', 'Connection checks require the book or a volume selection.'))
      return
    }
    setPlanningWorkflowStarting(true)
    try {
      if (!(await saveActivePlanningSelection())) return
      if (!isCurrentProjectSession(projectSession)) return
      const result = await startBlueprintPlanningWorkflow({
        projectSession,
        generationModelId,
        kind,
        scope: planningSelection,
        ...(options?.guidance?.trim() ? { guidance: options.guidance.trim() } : {}),
        ...(options?.mode ? { mode: options.mode } : {}),
        ...(options?.plannedChapterCount ? { plannedChapterCount: options.plannedChapterCount } : {}),
        ...(currentProject?.novelConfig.totalChapters ? { totalChapters: currentProject.novelConfig.totalChapters } : {}),
        ...(options?.chapterRange ? { chapterRange: options.chapterRange } : {}),
        uiLocale: locale,
      })
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.accepted) return
      planningRunIdsRef.current.set(result.runId, result.operationId)
      setPlanningBusyOperationId(result.operationId)
      toast.info(text(`规划工作流已启动（${result.operationId}），候选完成后会出现在本页。`, `Planning workflow started (${result.operationId}); its candidate will appear here when ready.`))
      setPlanningCandidatesRevision(value => value + 1)
    } catch (error) {
      if (!isCurrentProjectSession(projectSession)) return
      toast.error(text(`启动规划工作流失败：${error instanceof Error ? error.message : String(error)}`, `Could not start planning workflow: ${error instanceof Error ? error.message : String(error)}`))
    } finally {
      if (isCurrentProjectSession(projectSession)) setPlanningWorkflowStarting(false)
    }
  }, [currentProject?.novelConfig.totalChapters, locale, planningSelection, projectKey, projectMatches, saveActivePlanningSelection, text])

  const handleConfirmPlanningCandidate = useCallback(async (
    candidateViewItem: BlueprintPlanningCandidateView,
    editedJson: string,
    selectedRows: { volumeIds: string[]; chapterNumbers: number[] },
  ) => {
    const projectSession = currentProjectSessionForPath(projectKey)
    const record = planningCandidates.find(item => item.operationId === candidateViewItem.operationId)
    if (!projectSession || !record || !projectMatches) return
    let edited: unknown
    try { edited = JSON.parse(editedJson) } catch { return }
    const explicitSelection: BlueprintPlanningConfirmSelection = {}
    if (record.kind === 'volume-outline' && record.scope.kind === 'volume') explicitSelection.targetVolumeId = record.scope.volumeId
    if (record.kind === 'chapter-plan' && record.scope.kind === 'volume') {
      explicitSelection.targetVolumeId = record.scope.volumeId
      const occupied = new Set(blueprintsRef.current.map(blueprint => blueprint.chapterNumber))
      const conflicting = selectedRows.chapterNumbers.filter(number => occupied.has(number))
      if (conflicting.length > 0) {
        toast.error(text(`候选章号已存在：${conflicting.join(', ')}。请取消选择或修改候选。`, `Chapter numbers already exist: ${conflicting.join(', ')}. Deselect them or edit the candidate.`))
        return
      }
      explicitSelection.chapterNumbers = [...new Set(selectedRows.chapterNumbers)]
    }
    if (record.kind === 'chapter-expand' && record.scope.kind === 'chapter') explicitSelection.chapterNumbers = [record.scope.chapterNumber]
    if (record.kind === 'volume-plan') explicitSelection.volumeIds = selectedRows.volumeIds
    setPlanningBusyOperationId(record.operationId)
    try {
      const updated = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-candidate-update', {
        operationId: record.operationId,
        expectedPayloadHash: record.payloadHash,
        candidate: edited,
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return
      if (!updated.success) {
        toast.error(text(`候选修改未保存：${updated.code} · ${updated.error}`, `Candidate edits were not saved: ${updated.code} · ${updated.error}`))
        setPlanningCandidatesRevision(value => value + 1)
        return
      }
      setPlanningCandidates(current => current.map(item => item.operationId === record.operationId ? updated.candidate : item))
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-confirm', {
        operationId: record.operationId,
        expectedSourceSnapshot: updated.candidate.sourceSnapshot,
        selection: explicitSelection,
        ...(record.kind === 'book-outline' && typeof (edited as { markdown?: unknown })?.markdown === 'string'
          ? { edits: { markdown: (edited as { markdown: string }).markdown } }
          : record.kind === 'volume-outline' && typeof (edited as { markdown?: unknown })?.markdown === 'string'
            ? { edits: { markdown: (edited as { markdown: string }).markdown } }
            : {}),
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.success) {
        toast.error(text(`候选未提交：${result.code} · ${result.error}`, `Candidate was not committed: ${result.code} · ${result.error}`))
        setPlanningCandidatesRevision(value => value + 1)
        return
      }
      toast.success(text('规划候选已确认并保存。', 'Planning candidate confirmed and saved.'))
      setPlanningCandidatesRevision(value => value + 1)
      if (record.kind === 'volume-plan' || record.kind === 'chapter-plan') await loadBlueprints()
      if (record.kind === 'book-outline') {
        const core = await ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectKey)
        if (!isCurrentProjectSession(projectSession)) return
        const saved = core?.synopsis ?? ''
        const hash = await sha256Body(saved)
        if (!isCurrentProjectSession(projectSession)) return
        setSynopsisStored(saved)
        setSynopsisDraft(saved)
        setSynopsisBaseHash(hash)
      }
      if (record.kind === 'volume-outline' && record.scope.kind === 'volume') {
        const outline = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-get', record.scope.volumeId, projectKey)
        if (!isCurrentProjectSession(projectSession)) return
        if (planningSelectionRef.current.kind === 'volume' && planningSelectionRef.current.volumeId === record.scope.volumeId) {
          setVolumeOutline(outline)
          setVolumeOutlineDraft(outline?.markdown ?? '')
        }
      }
      if (record.kind === 'chapter-expand' && record.scope.kind === 'chapter') await handleV2DetailRefresh(record.scope.chapterNumber)
    } catch (error) {
      if (isCurrentProjectSession(projectSession)) toast.error(text(`确认候选失败：${error instanceof Error ? error.message : String(error)}`, `Could not confirm candidate: ${error instanceof Error ? error.message : String(error)}`))
    } finally {
      if (isCurrentProjectSession(projectSession)) setPlanningBusyOperationId(null)
    }
  }, [handleV2DetailRefresh, loadBlueprints, planningCandidates, projectKey, projectMatches, text])

  const handleUpdatePlanningCandidate = useCallback(async (
    candidateViewItem: BlueprintPlanningCandidateView,
    editedJson: string,
  ): Promise<boolean> => {
    const projectSession = currentProjectSessionForPath(projectKey)
    const record = planningCandidates.find(item => item.operationId === candidateViewItem.operationId)
    if (!projectSession || !record || !projectMatches) return false
    let candidate: unknown
    try { candidate = JSON.parse(editedJson) } catch { return false }
    setPlanningBusyOperationId(record.operationId)
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-candidate-update', {
        operationId: record.operationId,
        expectedPayloadHash: record.payloadHash,
        candidate,
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return false
      if (!result.success) {
        toast.error(text(`候选修改冲突：${result.code} · ${result.error}`, `Candidate edit conflict: ${result.code} · ${result.error}`))
        setPlanningCandidatesRevision(value => value + 1)
        return false
      }
      setPlanningCandidates(current => current.map(item => item.operationId === record.operationId ? result.candidate : item))
      toast.success(text('候选修改已保存，可稍后继续审阅。', 'Candidate edits are saved and can be reviewed later.'))
      return true
    } catch (error) {
      if (isCurrentProjectSession(projectSession)) toast.error(text(`保存候选修改失败：${error instanceof Error ? error.message : String(error)}`, `Could not save candidate edits: ${error instanceof Error ? error.message : String(error)}`))
      return false
    } finally {
      if (isCurrentProjectSession(projectSession)) setPlanningBusyOperationId(null)
    }
  }, [planningCandidates, projectKey, projectMatches, text])

  const handleCancelPlanningCandidate = useCallback(async (operationId: string) => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    setPlanningBusyOperationId(operationId)
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-candidate-cancel', operationId, projectKey)
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.success) toast.error(text(`取消候选失败：${result.code} · ${result.error}`, `Could not cancel candidate: ${result.code} · ${result.error}`))
      else setPlanningCandidatesRevision(value => value + 1)
    } catch (error) {
      if (isCurrentProjectSession(projectSession)) toast.error(text(`取消候选失败：${error instanceof Error ? error.message : String(error)}`, `Could not cancel candidate: ${error instanceof Error ? error.message : String(error)}`))
    } finally {
      if (isCurrentProjectSession(projectSession)) setPlanningBusyOperationId(null)
    }
  }, [projectKey, text])

  const handleImportVolumeOutline = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || planningSelection.kind !== 'volume') return
    if (volumeOutlineDirty) {
      toast.warning(text('请先保存或放弃当前卷纲修改，再开始导入预览。', 'Save or discard the current volume outline edits before preparing an import.'))
      return
    }
    const result = await prepareBlueprintVolumeOutlineImport(projectSession, planningSelection.volumeId)
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success) {
      if (!result.cancelled) {
        const message = planningExchangeError(result, text('读取导入预览失败。', 'Could not read the import preview.'))
        toast.error(text(`卷纲导入预览失败：${message}`, `Could not prepare outline import: ${message}`))
      }
      return
    }
    setVolumeImportPreview(result.preview ?? null)
  }, [planningSelection, projectKey, text, volumeOutlineDirty])

  const handleConfirmVolumeImport = useCallback(async (): Promise<boolean> => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !volumeImportPreview) return false
    const result = await confirmBlueprintVolumeOutlineImport(projectSession, volumeImportPreview)
    if (!isCurrentProjectSession(projectSession)) return false
    if (!result.success || !result.outline) {
      const message = planningExchangeError(result, text('卷纲导入未完成。', 'Volume outline import did not complete.'))
      toast.error(text(`卷纲导入未提交：${message}`, `Volume outline import was not committed: ${message}`))
      return false
    }
    setVolumeOutline(result.outline)
    setVolumeOutlineDraft(result.outline.markdown)
    setVolumeImportPreview(null)
    setPlanningCandidatesRevision(value => value + 1)
    toast.success(text('卷纲已导入并从数据库读回确认。', 'Volume outline imported and verified by database read-back.'))
    return true
  }, [projectKey, text, volumeImportPreview])

  const handleExportVolumeOutline = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || planningSelection.kind !== 'volume') return
    const result = await exportBlueprintVolumeOutlineMarkdown(projectSession, planningSelection.volumeId)
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success && !result.cancelled) {
      const message = planningExchangeError(result, text('卷纲导出失败。', 'Could not export the volume outline.'))
      toast.error(text(`卷纲导出失败：${message}`, `Could not export volume outline: ${message}`))
    }
    else if (result.success) toast.success(text(`已导出 ${result.fileName}`, `Exported ${result.fileName}`))
  }, [planningSelection, projectKey, text])

  const handleClearVolumeOutline = useCallback(async () => {
    if (planningSelection.kind !== 'volume' || !volumeOutline) return
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return
    const ok = await confirm(text(
      `清空「${volumes.find(volume => volume.id === planningSelection.volumeId)?.name ?? planningSelection.volumeId}」的卷纲正文？该卷纲行将被删除；本卷和章节不会删除。`,
      `Delete the volume outline for “${volumes.find(volume => volume.id === planningSelection.volumeId)?.name ?? planningSelection.volumeId}”? The outline record will be removed; the volume and chapters will remain.`,
    ), {
      title: text('清空本卷卷纲', 'Clear volume outline'),
      confirmText: text('清空卷纲', 'Clear outline'),
      danger: true,
    })
    if (!ok || !isCurrentProjectSession(projectSession)) return
    setVolumeOutlineSaving(true)
    setVolumeOutlineError(null)
    try {
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-delete', {
        volumeId: planningSelection.volumeId,
        expectedRevision: volumeOutline.revision,
      }, projectKey)
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.success) {
        const message = `${result.code} · ${result.error}`
        setVolumeOutlineError(message)
        toast.error(text(`清空卷纲失败：${message}`, `Could not clear the volume outline: ${message}`))
        return
      }
      setVolumeOutline(null)
      setVolumeOutlineDraft('')
      setOutlineSummaries(current => current.filter(summary => summary.volumeId !== planningSelection.volumeId))
      setVolumeImportPreview(null)
      setPlanningCandidatesRevision(value => value + 1)
      toast.success(text('本卷卷纲已清空；卷与章节归属保留。', 'The volume outline was cleared; the volume and chapter assignments remain.'))
    } catch (error) {
      if (!isCurrentProjectSession(projectSession)) return
      const message = error instanceof Error ? error.message : String(error)
      setVolumeOutlineError(message)
      toast.error(text(`清空卷纲失败：${message}`, `Could not clear the volume outline: ${message}`))
    } finally {
      if (isCurrentProjectSession(projectSession)) setVolumeOutlineSaving(false)
    }
  }, [planningSelection, projectKey, projectMatches, text, volumeOutline, volumes])

  const handleImportBookOutline = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || planningSelection.kind !== 'book') return
    if (synopsisDirty) {
      toast.warning(text('请先保存或放弃当前总纲修改，再开始导入预览。', 'Save or discard the current book outline edits before preparing an import.'))
      return
    }
    const result = await prepareBlueprintBookOutlineImport(projectSession)
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success) {
      if (!result.cancelled) {
        const message = planningExchangeError(result, text('读取导入预览失败。', 'Could not read the import preview.'))
        toast.error(text(`总纲导入预览失败：${message}`, `Could not prepare book outline import: ${message}`))
      }
      return
    }
    setBookImportPreview(result.preview ?? null)
  }, [planningSelection, projectKey, synopsisDirty, text])

  const handleConfirmBookImport = useCallback(async (): Promise<boolean> => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !bookImportPreview) return false
    const result = await confirmBlueprintBookOutlineImport(projectSession, bookImportPreview)
    if (!isCurrentProjectSession(projectSession)) return false
    if (!result.success || result.content === undefined) {
      const message = planningExchangeError(result, text('总纲导入未完成。', 'Book outline import did not complete.'))
      setSynopsisError(message)
      toast.error(text(`总纲导入未提交：${message}`, `Book outline import was not committed: ${message}`))
      return false
    }
    const savedHash = await sha256Body(result.content)
    if (!isCurrentProjectSession(projectSession)) return false
    setSynopsisStored(result.content)
    setSynopsisDraft(result.content)
    setSynopsisBaseHash(savedHash)
    setSynopsisError(null)
    setBookImportPreview(null)
    setPlanningCandidatesRevision(value => value + 1)
    toast.success(text('全书总纲已导入并从数据库读回确认。', 'Book outline imported and verified by database read-back.'))
    return true
  }, [bookImportPreview, projectKey, text])

  const handleExportBookOutline = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    const result = await exportBlueprintBookOutlineMarkdown(projectSession)
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success && !result.cancelled) {
      const message = planningExchangeError(result, text('总纲导出失败。', 'Could not export the book outline.'))
      toast.error(text(`总纲导出失败：${message}`, `Could not export the book outline: ${message}`))
    }
    else if (result.success) toast.success(text(`已导出 ${result.fileName}`, `Exported ${result.fileName}`))
  }, [projectKey, text])

  const handleExportPlanningPackage = useCallback(async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession) return
    const result = await exportBlueprintPlanningPackage(projectSession)
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success && !result.cancelled) {
      const message = planningExchangeError(result, text('规划包导出失败。', 'Could not export the planning package.'))
      toast.error(text(`规划包导出失败：${message}`, `Could not export planning package: ${message}`))
    }
    else if (result.success) toast.success(text(`已导出 ${result.fileName}`, `Exported ${result.fileName}`))
  }, [projectKey, text])

  const requestPlanningSelection = useCallback(async (next: BlueprintPlanningSelection) => {
    const current = planningSelectionRef.current
    const same = current.kind === next.kind && (
      current.kind === 'book' || (current.kind === 'volume' && next.kind === 'volume' && current.volumeId === next.volumeId)
      || (current.kind === 'chapter' && next.kind === 'chapter' && current.chapterNumber === next.chapterNumber)
    )
    if (same) return
    const hasCurrentEdits = current.kind === 'book' ? synopsisDirty
      : current.kind === 'volume' ? volumeOutlineDirty
        : dirty || v2Dirty
    if (hasCurrentEdits) {
      setSelectionSaving(true)
      setSelectionSaveError(null)
      let saved = false
      try {
        saved = await saveActivePlanningSelection()
      } catch (error) {
        setSelectionSaveError(error instanceof Error ? error.message : String(error))
        saved = false
      } finally {
        setSelectionSaving(false)
      }
      if (!saved) {
        setSelectionSaveError(text('保存失败，仍停留在当前对象；输入已保留。可先修复后重试或放弃修改。', 'Save failed. The current object stays selected and input is preserved; retry or discard the edits.'))
        return
      }
    }
    if (next.kind === 'volume' && !volumes.some(volume => volume.id === next.volumeId)) return
    if (next.kind === 'chapter') {
      const index = blueprintsRef.current.findIndex(blueprint => blueprint.chapterNumber === next.chapterNumber)
      if (index < 0) return
      setSelectedIdx(index)
      setSelectedVolumeId(blueprintVolumeId(blueprintsRef.current[index]))
    } else if (next.kind === 'volume') setSelectedVolumeId(next.volumeId)
    planningSelectionRef.current = next
    setPlanningSelection(next)
    setSelectionSaveError(null)
    setChapterView('blueprint')
    const projectSession = currentProjectSessionForPath(projectKey)
    if (projectSession) persistPlanningSelection(projectSession.projectId, next)
  }, [projectKey, saveActivePlanningSelection, text, volumes])

  /** 更新选中章节蓝图的字段 */
  const updateField = <K extends EditableChapterBlueprintField>(
    key: K,
    value: ChapterBlueprint[K],
  ) => {
    if (!selected) return
    markChapterDirty(blueprintsRef.current.map((b, i) => (
      i === selectedIdx ? updateEditableChapterBlueprintField(b, key, value) : b
    )), selected.chapterNumber)
  }

  /**
   * 章有未保存 v2 细纲草稿时，v1 行的四个投影列必须先按草稿重算再写库，
   * 否则旧的本地投影会把 v2 刚保存的投影值覆盖回去（契约 §6.3）。
   */
  const reconcileProjectedFields = useCallback((blueprint: ChapterBlueprint): ChapterBlueprint => {
    const draft = getChapterCardV2Draft(readV2Ledger(), projectKey, blueprint.chapterNumber)
    if (!draft) return blueprint
    return { ...blueprint, ...projectV2ToV1(draft.content, blueprint) }
  }, [projectKey, readV2Ledger])

  /** 保存当前章节蓝图 */
  const handleSaveOne = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !selected
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const target = reconcileProjectedFields(selected)
    const savedSnapshots = captureBlueprintSnapshots([target])
    setSaving(true)
    try {
      await saveChapterBlueprint(target, projectKey, projectSession)
      if (!isCurrentProjectSession(projectSession)) return
      // 真实保存完成 → 记录“上次创作位置”（只写导航辅助，不动权威数据）。
      recordLastCreationLocation(projectKey, {
        kind: 'blueprint',
        chapterNumber: selected.chapterNumber,
        title: selected.title || text(`第 ${selected.chapterNumber} 章`, `Chapter ${selected.chapterNumber}`),
        savedAt: new Date().toISOString(),
      })
      const current = currentWorkingState(projectKey, projectSession)
      const nextDirty = reconcileSavedBlueprintSnapshots(
        current.blueprints,
        current.dirtyChapterNumbers,
        savedSnapshots,
      )
      persistProjectDraftState(projectKey, projectSession, current.blueprints, nextDirty)
    addLog('info', text(`第 ${selected.chapterNumber} 章蓝图已保存`, `Saved blueprint for Chapter ${selected.chapterNumber}`))
    } catch (err) {
      if (!isCurrentProjectSession(projectSession)) return
      const message = err instanceof Error ? err.message : String(err)
      addLog('error', text(`保存第 ${selected.chapterNumber} 章蓝图失败：${message}`, `Could not save the blueprint for Chapter ${selected.chapterNumber}.`))
      toast.error(text(`保存失败\n\n${message}`, 'Could not save the blueprint.'))
    } finally {
      if (isCurrentProjectSession(projectSession)) setSaving(false)
    }
  }

  const handleDiscardChapterEdits = async () => {
    if (!selected || (!selectedChapterDirty && !v2Dirty)) return
    const chapterNumber = selected.chapterNumber
    const selectedVolumeId = blueprintVolumeId(selected)
    const projectSession = currentProjectSessionForPath(projectKey)
    if (!projectSession || !projectMatches) return
    const ok = await confirm(text(
      `放弃第 ${chapterNumber} 章尚未保存的章节信息与细纲修改？这不会删除数据库中的章节或正式细纲。`,
      `Discard unsaved chapter metadata and outline edits for Chapter ${chapterNumber}? This will not delete its database row or saved outline.`,
    ), {
      title: text('放弃本章修改', 'Discard chapter edits'),
      confirmText: text('放弃本章修改', 'Discard chapter edits'),
      danger: true,
    })
    if (!ok || !isCurrentProjectSession(projectSession)) return
    try {
      const persistedBlueprints = await loadDirectoryBlueprints(projectKey, projectSession)
      if (!isCurrentProjectSession(projectSession) || planningSelectionRef.current.kind !== 'chapter' || planningSelectionRef.current.chapterNumber !== chapterNumber) return
      const persisted = persistedBlueprints.find(blueprint => blueprint.chapterNumber === chapterNumber)
      const current = blueprintsRef.current
      const nextBlueprints = persisted
        ? current.map(blueprint => blueprint.chapterNumber === chapterNumber ? persisted : blueprint)
        : current.filter(blueprint => blueprint.chapterNumber !== chapterNumber)
      const nextDirty = new Set(dirtyChapterNumbersRef.current)
      nextDirty.delete(chapterNumber)
      persistProjectDraftState(projectKey, projectSession, nextBlueprints, nextDirty)
      persistV2Ledger(null, chapterNumber)
      setV2Draft(null)
      setV2Detail(null)
      if (!persisted) {
        setSelectedIdx(index => Math.max(0, Math.min(index, nextBlueprints.length - 1)))
        await requestPlanningSelection({ kind: 'volume', volumeId: selectedVolumeId })
      } else {
        await handleDiscardV2Draft()
      }
      if (isCurrentProjectSession(projectSession)) toast.success(text(`已放弃第 ${chapterNumber} 章的本地修改。`, `Discarded local edits for Chapter ${chapterNumber}.`))
    } catch (error) {
      if (isCurrentProjectSession(projectSession)) toast.error(text(`放弃本章修改失败：${error instanceof Error ? error.message : String(error)}`, `Could not discard chapter edits: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  /** 全量保存到 SQLite（含全部 v2 细纲草稿 + v1 蓝图） */
  const handleSaveAll = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const saveInput = blueprintsRef.current.map(reconcileProjectedFields)
    const savedSnapshots = captureBlueprintSnapshots(saveInput)
    setSaving(true)
    try {
      await saveAllBlueprints(saveInput, projectKey, projectSession)
      if (!isCurrentProjectSession(projectSession)) return
      // 全量保存成功 → 以作者当前所在章记录“上次创作位置”。
      const resumeSelected = selected
      if (resumeSelected) {
        recordLastCreationLocation(projectKey, {
          kind: 'blueprint',
          chapterNumber: resumeSelected.chapterNumber,
          title: resumeSelected.title || text(`第 ${resumeSelected.chapterNumber} 章`, `Chapter ${resumeSelected.chapterNumber}`),
          savedAt: new Date().toISOString(),
        })
      }
      const current = currentWorkingState(projectKey, projectSession)
      const nextDirty = reconcileSavedBlueprintSnapshots(
        current.blueprints,
        current.dirtyChapterNumbers,
        savedSnapshots,
      )
      persistProjectDraftState(projectKey, projectSession, current.blueprints, nextDirty)
      addLog('info', text(`已保存全部 ${saveInput.length} 章蓝图`, `Saved all ${saveInput.length} chapter blueprints`))
    } catch (err) {
      if (!isCurrentProjectSession(projectSession)) return
      const message = err instanceof Error ? err.message : String(err)
      addLog('error', text(`保存全部蓝图失败：${message}`, 'Could not save all chapter blueprints.'))
      toast.error(text(`保存失败\n\n${message}`, 'Could not save the blueprints.'))
    } finally {
      if (isCurrentProjectSession(projectSession)) setSaving(false)
    }
  }

  const exitSaveRef = useRef(handleSaveAll)
  useEffect(() => {
    exitSaveRef.current = handleSaveAllWithV2
    saveAllRef.current = handleSaveAll
  })
  useEffect(() => {
    registerEditorExitSaveHandler({
      type: 'chapter-card',
      projectKey,
      save: () => exitSaveRef.current(),
    })
  }, [projectKey])

  /** 新建空章节 */
  const handleAddChapter = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const targetVolumeId = planningSelection.kind === 'volume'
      ? planningSelection.volumeId
      : planningSelection.kind === 'chapter' && selected
        ? blueprintVolumeId(selected)
        : null
    if (!targetVolumeId || !volumes.some(volume => volume.id === targetVolumeId)) {
      toast.warning(text('请先在左侧目录中新建或选择一个卷。', 'Create or select a volume in the outline first.'))
      return
    }
    if (!(await saveActivePlanningSelection())) return
    if (nextWriteChapter === null) {
      toast.warning(authorityError || text(
        '当前无法确定权威下一章，请先修复定稿章节。',
        'The authoritative next chapter is unavailable. Repair finalized chapters first.',
      ))
      return
    }
    const currentBlueprints = blueprintsRef.current
    const authoritativeBlueprintExists = currentBlueprints.some(
      blueprint => blueprint.chapterNumber === nextWriteChapter,
    )
    const chapterNumber = authoritativeBlueprintExists
      ? Math.max(nextWriteChapter, ...currentBlueprints.map(blueprint => blueprint.chapterNumber)) + 1
      : nextWriteChapter
    const newBlueprint: ChapterBlueprint = {
      chapterNumber,
      volumeId: targetVolumeId,
      title: '',
      role: '发展',
      purpose: '',
      keyEvents: '',
      characters: [],
      suspenseHook: '',
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
    }
    markChapterDirty([...currentBlueprints, newBlueprint], newBlueprint.chapterNumber)
    void requestPlanningSelection({ kind: 'chapter', chapterNumber: newBlueprint.chapterNumber })
    if (authoritativeBlueprintExists) {
      toast.info(text(
        `第 ${nextWriteChapter} 章蓝图已存在，已新增第 ${chapterNumber} 章；写作入口仍为第 ${nextWriteChapter} 章。`,
        `The Chapter ${nextWriteChapter} blueprint already exists. Added Chapter ${chapterNumber}; the writing entry remains Chapter ${nextWriteChapter}.`,
      ))
    }
  }

  /** 新增一个项目级卷目录，并立即把后续新章归入该卷。 */
  const handleAddVolume = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    if (!(await saveActivePlanningSelection())) return
    const nextVolume: BlueprintVolumeData = {
      id: createBlueprintVolumeId(),
      name: text(`第${volumes.length + 1}卷`, `Volume ${volumes.length + 1}`),
      sortOrder: volumes.length + 1,
    }
    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-volume-upsert',
      nextVolume,
      projectKey,
    )
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success) {
      toast.error(text(`新增卷失败\n\n${result.error ?? '未知错误'}`, `Could not create volume.\n\n${result.error ?? 'Unknown error'}`))
      return
    }
    setVolumes(current => [...current, nextVolume])
    setSelectedVolumeId(nextVolume.id)
    setCollapsedVolumeIds(current => {
      const next = new Set(current)
      next.delete(nextVolume.id)
      return next
    })
    planningSelectionRef.current = { kind: 'volume', volumeId: nextVolume.id }
    setPlanningSelection({ kind: 'volume', volumeId: nextVolume.id })
    persistPlanningSelection(projectSession.projectId, { kind: 'volume', volumeId: nextVolume.id })
    toast.success(text(`已新增${nextVolume.name}`, `Created ${nextVolume.name}`))
  }

  /** 删除选中章节 */
  const handleDeleteChapter = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !selected
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const deletedSnapshots = captureBlueprintSnapshots([selected])
    const ok = await confirm(text(
      `确认删除第 ${selected.chapterNumber} 章蓝图？\n此操作不可撤销。${v2Detail || v2Draft ? '\n该章的正式细纲（含分镜正文）将一并删除。' : ''}`,
      `Delete the blueprint for Chapter ${selected.chapterNumber}?\nThis cannot be undone.${v2Detail || v2Draft ? '\nThe formal outline (including scene bodies) will be deleted with it.' : ''}`,
    ), {
      title: text('删除章节蓝图', 'Delete chapter blueprint'),
      confirmText: text('删除', 'Delete'),
      danger: true,
    })
    if (!ok || !isCurrentProjectSession(projectSession)) return
    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-delete',
      selected.chapterNumber,
      projectKey,
    )
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success) {
      toast.error(text(`删除失败\n\n${result.error ?? '未知错误'}`, 'Could not delete the chapter blueprint.'))
      return
    }
    const current = currentWorkingState(projectKey, projectSession)
    const next = reconcileDeletedBlueprintSnapshots(
      current.blueprints,
      current.dirtyChapterNumbers,
      deletedSnapshots,
    )
    persistProjectDraftState(projectKey, projectSession, next.blueprints, next.dirtyChapterNumbers)
    // 章删除已级联清理 v2 细纲行（db:blueprint-delete）；本地 v2 状态同步清空。
    persistV2Ledger(null, selected.chapterNumber)
    setV2Draft(null)
    setV2Detail(null)
    if (isCurrentProjectSession(projectSession)) {
      setSelectedIdx(index => Math.max(0, Math.min(index, next.blueprints.length - 1)))
    }
    globalEventBus.emit('REFRESH_RESOURCE', {
      resources: ['blueprints', 'fileTree'],
      projectPath: projectKey,
      projectSession,
    })
    toast.success(text(`已删除第 ${selected.chapterNumber} 章蓝图`, `Deleted the blueprint for Chapter ${selected.chapterNumber}`))
  }

  /** 清空全部章节蓝图 */
  const handleClearAllBlueprints = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || blueprints.length === 0
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const clearedSnapshots = captureBlueprintSnapshots(blueprintsRef.current)
    const ok = await confirm(text(
      `仅清空 ${blueprints.length} 章的章节简纲与细纲。全书总纲、各卷卷纲、规划候选、检查报告、正文和草稿均保留。此操作不可撤销。`,
      `Clear the brief and detailed outlines for ${blueprints.length} chapters only. The book outline, volume outlines, planning candidates, check reports, manuscript, and drafts will remain. This cannot be undone.`,
    ), {
      title: text('清空全部章纲', 'Clear all chapter outlines'),
      confirmText: text('清空全部章纲', 'Clear chapter outlines'),
      danger: true,
    })
    if (!ok || !isCurrentProjectSession(projectSession)) return

    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-clear-all',
      projectKey,
    )
    if (!isCurrentProjectSession(projectSession)) return
    if (!result.success) {
      toast.error(text(`清空失败\n\n${result.error ?? '未知错误'}`, 'Could not clear the chapter blueprints.'))
      return
    }
    const current = currentWorkingState(projectKey, projectSession)
    const next = reconcileClearedBlueprintSnapshots(current.blueprints, clearedSnapshots)
    persistProjectDraftState(projectKey, projectSession, next.blueprints, next.dirtyChapterNumbers)
    if (isCurrentProjectSession(projectSession)) setSelectedIdx(0)
    globalEventBus.emit('REFRESH_RESOURCE', {
      resources: ['blueprints', 'fileTree'],
      projectPath: projectKey,
      projectSession,
    })
    toast.success(text('已清空全部章纲', 'All chapter outlines cleared'))
  }

  /**
   * 新建或打开此章正文草稿 — 直达正文写作
   */
  const handleAIWriting = (bp: ChapterBlueprint) => {
    const session = currentProjectSessionForPath(projectKey)
    if (!session || !sameProjectSessionContext(dataProjectSessionRef.current, session)
      || bp.chapterNumber !== nextWriteChapter || dirty
      || (v2Dirty && !v2SeedUnsaved) || v2Loading
      || v2Detail?.readStatus) return
    useLayoutStore.getState().openChapterCreation({
      chapterNumber: bp.chapterNumber, title: bp.title, role: bp.role,
      purpose: bp.purpose, keyEvents: bp.keyEvents,
      characters: bp.characters.join('、'), userGuidance: bp.userGuidance,
      wordsTarget: v2Content ? extractBlueprintV2WordBudget(v2Content) ?? undefined : undefined,
    })
  }

  const handleOpenOrNewDraft = async (bp: ChapterBlueprint) => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectSession
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return
    const drafts = draftsByChapter[bp.chapterNumber] || []
    const existingDraft = drafts.find(d => d.status !== 'archived') || drafts[0]

    if (existingDraft) {
      const content = await readDraftBody(existingDraft.filePath, projectKey, projectSession)
      if (!isCurrentProjectSession(projectSession)) return
      useEditorStore.getState().openFile({
        id: existingDraft.filePath,
        name: text(
          `第${bp.chapterNumber}章 · ${bp.title || '未命名'} v${existingDraft.version}`,
          `Chapter ${bp.chapterNumber} · ${bp.title || 'Untitled'} v${existingDraft.version}`,
        ),
        type: 'chapter',
        filePath: existingDraft.filePath,
        content,
        savedContent: content,
        draftId: existingDraft.id,
        chapterNumber: bp.chapterNumber,
        draftStatus: existingDraft.status,
        projectKey,
        projectSessionLease: projectSession.leaseId,
      })
      toast.success(text(`已打开第 ${bp.chapterNumber} 章正文草稿`, `Opened draft for Chapter ${bp.chapterNumber}`))
    } else {
      if (nextWriteChapter === null || bp.chapterNumber !== nextWriteChapter) {
        toast.warning(authorityError || text(
          `当前只可新建第 ${nextWriteChapter ?? '—'} 章正文，请先检查定稿章节顺序。`,
          `Only Chapter ${nextWriteChapter ?? '—'} can be started now. Check the finalized chapter sequence first.`,
        ))
        return
      }
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-create',
        {
          chapterNumber: bp.chapterNumber,
          blueprintChapterNumber: bp.chapterNumber,
          version: 1,
          source: 'write',
          content: '',
          wordCount: 0,
        },
        projectKey,
      )
      if (!isCurrentProjectSession(projectSession)) return
      if (!result.success || !result.id) {
        toast.error(text(`创建正文草稿失败：${result.error || '未知错误'}`, `Failed to create draft: ${result.error || 'Unknown error'}`))
        return
      }
      await useDraftStore.getState().loadChapterDrafts(bp.chapterNumber, projectKey, projectSession)
      globalEventBus.emit('REFRESH_RESOURCE', {
        resources: ['drafts', 'fileTree'],
        projectPath: projectKey,
        projectSession,
      })
      const draftPath = `vela://draft/${result.id}`
      useEditorStore.getState().openFile({
        id: draftPath,
        name: text(
          `第${bp.chapterNumber}章 · ${bp.title || '未命名'} v1`,
          `Chapter ${bp.chapterNumber} · ${bp.title || 'Untitled'} v1`,
        ),
        type: 'chapter',
        filePath: draftPath,
        content: '',
        savedContent: '',
        draftId: result.id,
        chapterNumber: bp.chapterNumber,
        draftStatus: 'draft',
        projectKey,
        projectSessionLease: projectSession.leaseId,
      })
      toast.success(text(`已为第 ${bp.chapterNumber} 章创建空白草稿并打开`, `Created and opened blank draft for Chapter ${bp.chapterNumber}`))
    }
  }


  /**
   * 旧版“小说拆解与仿写”曾把参考原文误写为草稿和定稿；此处只给用户一个
   * 明确确认后的恢复入口，不尝试自动判定或删除任何项目内容。
   */
  const handleClearLegacyImportedText = async () => {
    const projectSession = currentProjectSessionForPath(projectKey)
    if (
      !projectMatches
      || !projectSession
      || !sameProjectSessionContext(dataProjectSessionRef.current, projectSession)
    ) return

    const ok = await confirm(text(
      '仅当当前草稿和正文来自旧版“小说拆解与仿写”导入时，才继续清除。\n\n此操作会永久清除草稿、定稿、审稿和摘要等正文产物；会保留角色、故事架构、章节蓝图与知识库。若只是尚未生成下一章蓝图，请取消并先补充蓝图。',
      'Continue only if the current drafts and manuscript text came from a legacy “Novel analysis and imitation” import.\n\nThis permanently clears drafts, final manuscript text, reviews, and summaries. Characters, story architecture, chapter blueprints, and the knowledge base are kept. If the next blueprint is simply missing, cancel and add that blueprint first.',
    ), {
      title: text('清除误导入正文', 'Clear incorrectly imported text'),
      confirmText: text('清除误导入正文', 'Clear incorrectly imported text'),
      danger: true,
    })
    if (!ok || !isCurrentProjectSession(projectSession)) return

    setRecoveringLegacyImportedText(true)
    try {
      await clearProjectData({ generatedText: true }, projectSession)
      if (!isCurrentProjectSession(projectSession)) return
      await loadBlueprints()
      if (!isCurrentProjectSession(projectSession)) return
      toast.success(text(
        '已清除误导入的正文产物；现在可从第 1 章开始写作。',
        'Incorrectly imported text was cleared. You can now start writing from Chapter 1.',
      ))
    } catch (error) {
      if (!isCurrentProjectSession(projectSession)) return
      const message = error instanceof Error ? error.message : String(error)
      toast.error(text(
        `清除误导入正文失败\n\n${message}`,
        `Could not clear incorrectly imported text.\n\n${message}`,
      ))
    } finally {
      if (isCurrentProjectSession(projectSession)) setRecoveringLegacyImportedText(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-muted)' }}>
        <RefreshCw size={16} className="animate-spin" /> {text('加载章节蓝图...', 'Loading chapter blueprints...')}
      </div>
    )
  }

  if (!projectMatches) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <BookOpen size={36} />
        <span className="text-sm">{text('此标签属于另一个项目，请切回原项目后继续。', 'This tab belongs to another project. Switch back to continue.')}</span>
      </div>
    )
  }

  const visibleBlueprints = projectDataReady ? blueprints : []
  const visibleDirty = projectDataReady && dirty
  const canRecoverLegacyImportedText = projectDataReady
    && legacyImportedTextRecoveryChapter !== null

  const hasDraftFor = (blueprint: ChapterBlueprint) =>
    (draftsByChapter[blueprint.chapterNumber]?.length ?? 0) > 0
  const canOpenOrCreateDraft = (blueprint: ChapterBlueprint) =>
    hasDraftFor(blueprint) || (nextWriteChapter !== null && blueprint.chapterNumber === nextWriteChapter)

  const hasDraftCount = visibleBlueprints.filter(hasDraftFor).length

  return (
    <PlanningPageShell
      breadcrumb={[
        { label: backPath.overviewLabel, onClick: backPath.openOverview },
        { label: backPath.planLabel, onClick: backPath.revealWritingPlan },
        { label: text('章节蓝图', 'Chapter blueprints') },
      ]}
      icon={<BookOpen size={15} />}
      title={text('章节蓝图', 'Chapter blueprints')}
      description={text(
        '逐章细纲：作者在这里维护每章的分区细纲与逐场分镜，并补充小目标、冲突转折、悬念钩子与微操指导；它是 AI 写正文和人工写正文的共同依据。章节号是稳定标识，不与正文草稿共用存储。',
        'Per-chapter outlines: maintain per-section outlines and scene storyboards here, plus goals, conflicts, hooks, and author guidance. This is the shared basis for both AI and manual drafting. Chapter numbers are stable identifiers and are stored separately from prose drafts.',
      )}
      meta={text(
        `${visibleBlueprints.length} 章蓝图 · ${hasDraftCount} 章已写正文`,
        `${visibleBlueprints.length} blueprints · ${hasDraftCount} with drafts`,
      )}
      actions={
        <>
          {projectDataReady && selected && canOpenOrCreateDraft(selected) && (
            <Button
              variant="default"
              size="sm"
              onClick={() => handleOpenOrNewDraft(selected)}
              title={
                hasDraftFor(selected)
                  ? text(`打开第 ${selected.chapterNumber} 章正文草稿`, `Open Chapter ${selected.chapterNumber} draft`)
                  : text(`为第 ${selected.chapterNumber} 章新建空白草稿并直接开始写作`, `Create blank draft and write Chapter ${selected.chapterNumber}`)
              }
            >
              <PenLine size={12} />
              {hasDraftFor(selected)
                ? text(`打开第${selected.chapterNumber}章正文`, `Open Chapter ${selected.chapterNumber}`)
                : text(`新建第${selected.chapterNumber}章正文`, `New Chapter ${selected.chapterNumber}`)}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => revealSidebarGroup('manuscript')}
            title={text('在项目树中展开草稿箱与正文章节', 'Reveal the draft box and manuscript in the project tree')}
          >
            <PenLine size={12} />
            {text('正文写作', 'Manuscript')}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => loadBlueprints()} title={text('重新加载', 'Reload')} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearAllBlueprints}
            disabled={saving || visibleBlueprints.length === 0 || !projectDataReady}
            title={text('清空全部章纲', 'Clear all chapter outlines')}
          >
            <Trash2 size={12} />
            {text('清空章纲', 'Clear chapter outlines')}
          </Button>
          {(visibleDirty || v2Dirty) && (
            <Button variant="outline" size="sm" onClick={() => { void handleSaveAllWithV2().catch(error => toast.error(error instanceof Error ? error.message : String(error))) }} disabled={saving || v2Saving || !projectDataReady}>
            <Save size={12} /> {saving || v2Saving ? text('保存中...', 'Saving...') : text('保存全部', 'Save all')}
            </Button>
          )}
        </>
      }
      banner={
        <>
          {canRecoverLegacyImportedText && (
            <div
              className="planning-page__banner flex-wrap items-center justify-between gap-3"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-warning) 42%, var(--color-border))',
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
              }}
            >
              <div className="flex min-w-0 items-start gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
                <p className="max-w-3xl leading-5">
                  {text(
                    `检测到后续正文但第 ${legacyImportedTextRecoveryChapter} 章尚未写作，可能是旧版“小说拆解与仿写”误导入的参考原文。系统不会自动清除任何内容；确认“清除误导入正文”后会保留角色、故事架构、章节蓝图与知识库，并可从第 ${legacyImportedTextRecoveryChapter} 章开始写作。`,
                    `Later manuscript text exists while Chapter ${legacyImportedTextRecoveryChapter} has not been written. This may be reference text incorrectly imported by a legacy “Novel analysis and imitation” workflow. Nothing is cleared automatically; after you confirm “Clear incorrectly imported text”, characters, story architecture, chapter blueprints, and the knowledge base are kept, and you can start writing from Chapter ${legacyImportedTextRecoveryChapter}.`,
                  )}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearLegacyImportedText}
                disabled={recoveringLegacyImportedText}
              >
                <Trash2 size={12} />
                {recoveringLegacyImportedText
                  ? text('清除中...', 'Clearing...')
                  : text('清除误导入正文', 'Clear incorrectly imported text')}
              </Button>
            </div>
          )}

          {projectDataReady && authorityError && !canRecoverLegacyImportedText && (
            <div
              className="planning-page__banner"
              style={{
                color: 'var(--color-warning-text)',
                borderColor: 'color-mix(in srgb, var(--color-warning) 42%, var(--color-border))',
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
              }}
            >
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
              <p className="leading-5">{authorityError}</p>
            </div>
          )}
        </>
      }
    >
      <PlanningPane
        title={text('层级规划', 'Planning hierarchy')}
        icon={<BookOpen size={12} />}
        width={270}
        actions={
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleExportPlanningPackage()} title={text('导出完整规划包（不含正文）', 'Export planning package (no prose)')} aria-label={text('导出规划包', 'Export planning package')}>
            <FileText size={13} />
          </Button>
        }
        footer={text('总纲、卷纲与章纲分别保存；搜索不会隐藏上层规划。', 'Book, volume, and chapter plans are saved separately; search keeps parent plans visible.')}
      >
        <BlueprintPlanningTree
          selection={planningSelection}
          volumes={volumes}
          chapters={visibleBlueprints.map(blueprint => ({
            chapterNumber: blueprint.chapterNumber,
            title: blueprint.title,
            volumeId: blueprintVolumeId(blueprint),
            role: blueprint.role,
            hasDraft: hasDraftFor(blueprint),
            sourceStatus: planningTargetSourceStatuses[`chapter:${blueprint.chapterNumber}`] ?? 'loading',
          }))}
          synopsis={synopsisStored}
          outlineSummaries={outlineSummaries}
          searchQuery={searchQuery}
          draftFilter={draftFilter}
          collapsedVolumeIds={collapsedVolumeIds}
          onSearchChange={setSearchQuery}
          onDraftFilterChange={setDraftFilter}
          onToggleVolume={volumeId => setCollapsedVolumeIds(current => {
            const next = new Set(current)
            if (next.has(volumeId)) next.delete(volumeId)
            else next.add(volumeId)
            return next
          })}
          onSelect={selection => void requestPlanningSelection(selection)}
          onAddVolume={() => void handleAddVolume()}
          onAddChapter={handleAddChapter}
        />
      </PlanningPane>

      <main className={cn('planning-page__main', chapterView === 'blueprint' && 'planning-page__scroll')}>
          {selectionSaveError && <div className="blueprint-planning-selection-error" role="alert" data-testid="blueprint-selection-save-error">{selectionSaveError}</div>}
          {planningSelection.kind === 'book' ? (
            <BlueprintBookOutlineEditor
              markdown={synopsisDraft}
              currentMarkdown={synopsisStored}
              dirty={synopsisDirty}
              saving={synopsisSaving || selectionSaving}
              loading={synopsisLoading}
              error={synopsisError}
              contentHash={synopsisBaseHash}
              candidates={planningCandidates.map(candidateView)}
              checks={planningChecks}
              busyOperationId={planningBusyOperationId}
              workflowStarting={planningWorkflowStarting}
              importPreview={bookImportPreview}
              onChange={setSynopsisDraft}
              onSave={handleSaveSynopsis}
              onDiscard={handleDiscardSynopsis}
              onImport={() => void handleImportBookOutline()}
              onCancelImport={() => setBookImportPreview(null)}
              onConfirmImport={handleConfirmBookImport}
              onExport={() => void handleExportBookOutline()}
              onClear={() => void handleClearSynopsis()}
              onRefresh={() => setPlanningCandidatesRevision(value => value + 1)}
              onGenerate={handleStartPlanningWorkflow}
              onConfirmCandidate={handleConfirmPlanningCandidate}
              onUpdateCandidate={handleUpdatePlanningCandidate}
              onCancelCandidate={handleCancelPlanningCandidate}
            />
          ) : planningSelection.kind === 'volume' ? (
            <BlueprintVolumeOutlineEditor
              volumeId={planningSelection.volumeId}
              volumeName={volumes.find(volume => volume.id === planningSelection.volumeId)?.name ?? planningSelection.volumeId}
              markdown={volumeOutlineDraft}
              revision={volumeOutline?.revision ?? 0}
              contentHash={volumeOutline?.contentHash ?? null}
              currentMarkdown={volumeOutline?.markdown ?? ''}
              actualChapterCount={blueprints.filter(blueprint => blueprintVolumeId(blueprint) === planningSelection.volumeId).length}
              dirty={volumeOutlineDirty}
              saving={volumeOutlineSaving || selectionSaving}
              loading={volumeOutlineLoading}
              error={volumeOutlineError}
              sourceStatus={!volumeOutline?.sourceSnapshotId
                ? 'unlinked'
                : planningSourceStatuses[volumeOutline.sourceSnapshotId] ?? 'loading'}
              candidates={planningCandidates.map(candidateView)}
              checks={planningChecks}
              busyOperationId={planningBusyOperationId}
              workflowStarting={planningWorkflowStarting}
              importPreview={volumeImportPreview}
              onChange={setVolumeOutlineDraft}
              onSave={handleSaveVolumeOutline}
              onDiscard={handleDiscardVolumeOutline}
              onImport={() => void handleImportVolumeOutline()}
              onCancelImport={() => setVolumeImportPreview(null)}
              onConfirmImport={handleConfirmVolumeImport}
              onExport={() => void handleExportVolumeOutline()}
              onClear={() => void handleClearVolumeOutline()}
              onRefresh={() => setPlanningCandidatesRevision(value => value + 1)}
              onGenerate={handleStartPlanningWorkflow}
              onConfirmCandidate={handleConfirmPlanningCandidate}
              onUpdateCandidate={handleUpdatePlanningCandidate}
              onCancelCandidate={handleCancelPlanningCandidate}
            />
          ) : <>
          {selected && (
              <div className="flex flex-shrink-0 items-center justify-between gap-3 px-5 pt-3">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {text(`第 ${selected.chapterNumber} 章`, `Chapter ${selected.chapterNumber}`)}
              </span>
                <div className="flex items-center gap-2">
                  {(selectedChapterDirty || v2Dirty) && <Button variant="ghost" size="sm" onClick={() => void handleDiscardChapterEdits()} disabled={saving || v2Saving} data-testid="blueprint-chapter-discard-edits">{text('放弃本章修改', 'Discard chapter edits')}</Button>}
                  <div className="planning-segmented" role="group" aria-label={text('章节视图', 'Chapter views')}>
                <button
                  type="button"
                  aria-pressed={chapterView === 'blueprint'}
                  className={`planning-segmented__option${chapterView === 'blueprint' ? ' is-active' : ''}`}
                  onClick={() => setChapterView('blueprint')}
                >
                  <BookOpen size={12} />
                  {text('蓝图', 'Blueprint')}
                </button>
                <button
                  type="button"
                  aria-pressed={chapterView === 'canvas'}
                  className={`planning-segmented__option${chapterView === 'canvas' ? ' is-active' : ''}`}
                  onClick={() => setChapterView('canvas')}
                  data-testid="chapter-canvas-toggle"
                >
                  <MapPin size={12} />
                  {text('场景画布', 'Scene canvas')}
                </button>
              </div>
                </div>
            </div>
          )}
          {selected && chapterView === 'canvas' ? (
            <ChapterCanvasWorkbench
              projectKey={projectKey}
              chapterNumber={selected.chapterNumber}
              chapterTitle={selected.title}
              canOpenDraft={canOpenOrCreateDraft(selected)}
              openDraftLabel={hasDraftFor(selected)
                ? text(`打开第${selected.chapterNumber}章正文`, `Open Chapter ${selected.chapterNumber}`)
                : text(`新建第${selected.chapterNumber}章正文`, `New Chapter ${selected.chapterNumber}`)}
              onOpenDraft={() => void handleOpenOrNewDraft(selected)}
              onBlueprintChanged={() => void handleV2DetailRefresh(selected.chapterNumber)}
            />
          ) : selected && v2Detail?.readStatus ? (
            <div className="max-w-3xl mx-auto px-5 py-4 space-y-3" data-testid="blueprint-v2-readonly-recovery">
              <div className="planning-page__banner flex-wrap items-start justify-between gap-3" style={{ color: 'var(--color-error-text)' }}>
                <div>
                  <h3 className="text-sm font-bold">
                    {v2Detail.readStatus === 'corrupt'
                      ? text('细纲数据损坏，原始 Markdown 已保留', 'Outline data is corrupt; raw Markdown is preserved')
                      : text(`细纲来自较新版本（schema ${v2Detail.storedSchemaVersion ?? '?'}）`, `Outline is from a newer version (schema ${v2Detail.storedSchemaVersion ?? '?'})`)}
                  </h3>
                  <p className="text-xs mt-1">
                    {text('为避免把无法读取的数据当作旧简纲覆盖，当前只显示原始内容。', 'This read-only view prevents unreadable outline data from being mistaken for a legacy simple outline.')}
                  </p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => void handleDeleteV2Detail()} data-testid="blueprint-v2-delete-unreadable">
                  <Trash2 size={12} /> {text('确认删除此细纲记录', 'Delete this outline record')}
                </Button>
              </div>
              <div>
                <Label>{text('保留的原始 Markdown', 'Preserved raw Markdown')}</Label>
                <pre className="mt-2 max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border p-3 text-xs" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }} data-testid="blueprint-v2-preserved-raw">
                  {v2Detail.rawMarkdown ?? text('此记录未附原始 Markdown。', 'No raw Markdown was attached to this record.')}
                </pre>
              </div>
            </div>
          ) : selected && v2LoadError ? (
            <div className="max-w-2xl mx-auto px-5 py-8" role="alert" data-testid="blueprint-v2-load-error">
              <p className="text-sm" style={{ color: 'var(--color-error-text)' }}>
                {text(`读取第 ${selected.chapterNumber} 章细纲失败：${v2LoadError}`, `Could not read the outline for Chapter ${selected.chapterNumber}: ${v2LoadError}`)}
              </p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => setV2ReloadNonce(value => value + 1)}>
                {text('重试读取', 'Retry read')}
              </Button>
            </div>
          ) : selected && v2Content ? (
            <div className="blueprint-v2-view" data-testid="blueprint-v2-view">
              {/* 统一细纲编辑区头部 */}
              <div className="blueprint-v2-view__header">
                <div className="blueprint-v2-view__heading">
                  <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                    {text(
                      `第 ${selected.chapterNumber} 章：${v2Content.chapterTitle || selected.title || '未命名'}`,
                      `Chapter ${selected.chapterNumber}: ${v2Content.chapterTitle || selected.title || 'Untitled'}`,
                    )}
                  </h3>
                  <p className="text-[0.7rem] mt-0.5" style={{ color: 'var(--color-text-muted)' }} data-testid="blueprint-v2-status">
                    {v2Loading
                      ? text('读取细纲…', 'Loading outline…')
                      : text(
                        `正式细纲 r${v2BaseRevision} · ${getBlueprintV2Scenes(v2Content).length} 个分镜 · 字数预算 ${extractBlueprintV2WordBudget(v2Content) ?? '—'}${v2Dirty ? ' · 有未保存修改' : ''}`,
                        `Outline r${v2BaseRevision} · ${getBlueprintV2Scenes(v2Content).length} scene(s) · word budget ${extractBlueprintV2WordBudget(v2Content) ?? '—'}${v2Dirty ? ' · unsaved changes' : ''}`,
                      )}
                  </p>
                </div>
                <div className="blueprint-v2-view__actions">
                  <Button variant="ai" size="sm" onClick={() => handleAIWriting(selected)} disabled={selected.chapterNumber !== nextWriteChapter || dirty || (v2Dirty && !v2SeedUnsaved) || v2Loading || !!v2Detail?.readStatus} title={text('保存修改后从此章蓝图启动 AI 写作', 'Save changes, then start AI writing from this blueprint')}>
                    {text('写作此章', 'Write this chapter')}
                  </Button>
                  {canOpenOrCreateDraft(selected) && <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleOpenOrNewDraft(selected)}
                    title={
                      (draftsByChapter[selected.chapterNumber]?.length ?? 0) > 0
                        ? text('打开已有正文草稿', 'Open existing draft')
                        : text('新建空白草稿直接开始创作', 'Create blank draft and write')
                    }
                  >
                    <PenLine size={12} />
                    {(draftsByChapter[selected.chapterNumber]?.length ?? 0) > 0
                      ? text('打开正文草稿', 'Open draft')
                      : text('新建正文草稿', 'New draft')}
                  </Button>}
                  <Button variant="outline" size="sm" onClick={() => setOutlineSyncOpen(true)} data-testid="blueprint-v2-sync-prose" title={text('对照关联正文，逐项确认后回写本细纲', 'Compare with the linked prose; the outline changes after per-item confirmation')}>
                    {text('对照关联正文', 'Compare with prose')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={text('查看本章相关的信息条目与知情记录', 'View info entries and knowledge records related to this chapter')}
                    onClick={() => openBuiltinEditor(
                      'knowledge-gap',
                      text('信息与揭露', 'Info & Revelation'),
                      'knowledge-gap',
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      selected.chapterNumber,
                    )}
                  >
                    {text('本章信息', 'Chapter info')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setV2ImportOpen(true)} data-testid="blueprint-v2-import">
                    {text('导入 Markdown', 'Import Markdown')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleExportV2()} title={text('先无损自检，再复制规范 Markdown', 'Run the lossless check, then copy the canonical Markdown')}>
                    {text('导出', 'Export')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleDeleteV2Detail()} title={text('仅删除细纲；章节信息字段与画布卡保留', 'Delete the outline only; chapter info fields and canvas cards remain')}>
                    <Trash2 size={12} />
                    {text('删除细纲', 'Delete outline')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteChapter} title={text('删除此章', 'Delete this chapter')}>
                    <Trash2 size={12} />
                    {text('删除此章', 'Delete chapter')}
                  </Button>
                  <Button variant="default" size="sm" onClick={() => void handleSaveV2()} disabled={v2Saving} data-testid="blueprint-v2-save">
                    <Save size={12} />
                    {v2Saving ? text('保存中...', 'Saving...') : v2Dirty ? text('保存细纲', 'Save outline') : text('已同步', 'Synced')}
                  </Button>
                </div>
                <OutlineSyncReviewDialog
                  projectKey={projectKey}
                  chapterNumber={selected.chapterNumber}
                  open={outlineSyncOpen}
                  onClose={() => setOutlineSyncOpen(false)}
                />
              </div>

              {v2ConflictRevision !== null && (
                <div
                  className="planning-page__banner flex-wrap items-center justify-between gap-3 mb-3"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--color-warning) 42%, var(--color-border))',
                    backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                  }}
                  data-testid="blueprint-v2-conflict-banner"
                >
                  <p className="leading-5">
                    {text(
                      `细纲已被其他窗口修改（当前 r${v2ConflictRevision}）。本地编辑仍保留：`,
                      `The outline changed elsewhere (current r${v2ConflictRevision}). Local edits are kept:`,
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void handleSaveV2(v2ConflictRevision)}>{text('覆盖保存', 'Overwrite')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleDiscardV2Draft()}>{text('放弃本地并重载', 'Discard local & reload')}</Button>
                  </div>
                </div>
              )}

              {v2Detail && v2Detail.readStatus && (
                <div
                  className="planning-page__banner mb-3"
                  style={{
                    color: 'var(--color-error-text)',
                    borderColor: 'color-mix(in srgb, var(--color-error) 42%, var(--color-border))',
                    backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
                  }}
                  data-testid="blueprint-v2-readstatus-banner"
                >
                  <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                  <p className="leading-5">
                    {v2Detail.readStatus === 'corrupt'
                      ? text(
                        '该章细纲结构化数据损坏；原始 Markdown 已完整保留，可先「导出」核对。重新导入可重建细纲。',
                        'The structured outline data is corrupt; the raw Markdown is intact. Export to inspect it first; re-import to rebuild.',
                      )
                      : text(
                        `该章细纲由更新版本的应用写入（schema ${v2Detail.storedSchemaVersion ?? '?'}），请先升级应用再编辑；原始 Markdown 未丢失。`,
                        `This outline was written by a newer app version (schema ${v2Detail.storedSchemaVersion ?? '?'}); upgrade the app before editing. The raw Markdown is intact.`,
                      )}
                  </p>
                </div>
              )}

              {/* 章题（H3 行；保存时按契约投影为 v1 标题） */}
              <div className="mb-3">
                <Label>{text('章题（细纲 H3 行）', 'Chapter title (outline H3 line)')}</Label>
                <Input
                  value={v2Content.chapterTitle}
                  onChange={event => updateV2Content({ ...v2Content, chapterTitle: event.target.value })}
                  placeholder={text('如：第1章｜接错的人', 'e.g. 第1章｜接错的人')}
                  data-testid="blueprint-v2-chapter-title"
                />
              </div>

              <BlueprintChapterPlanningActions
                chapterNumber={selected.chapterNumber}
                title={v2Content.chapterTitle || selected.title}
                candidates={planningCandidates.map(candidateView).filter(candidate => candidate.kind === 'chapter-expand')}
                busyOperationId={planningBusyOperationId}
                workflowStarting={planningWorkflowStarting}
                onGenerate={() => void handleStartPlanningWorkflow('chapter-expand')}
                onRefresh={() => setPlanningCandidatesRevision(value => value + 1)}
                onConfirmCandidate={handleConfirmPlanningCandidate}
                onUpdateCandidate={handleUpdatePlanningCandidate}
                onCancelCandidate={handleCancelPlanningCandidate}
              />

              <BlueprintV2Editor content={v2Content} onChange={updateV2Content} />

              {/* 章节信息与作者指导（细纲不携带这些字段；修改后单独保存） */}
              <div className="mt-5 p-3 rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                <Label className="flex items-center gap-1.5 font-medium">
                  {text('章节信息与作者指导', 'Chapter info & author guidance')}
                  <span className="text-[0.7rem] font-normal" style={{ color: 'var(--color-text-muted)' }}>
                    {text('（细纲不携带这些字段；修改后单独保存）', '(not carried by the outline; save separately)')}
                  </span>
                </Label>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div>
                    <Label>{text('所属卷', 'Volume')}</Label>
                    <NativeSelect
                      value={blueprintVolumeId(selected)}
                      onChange={event => {
                        const volumeId = event.target.value
                        updateField('volumeId', volumeId)
                        setSelectedVolumeId(volumeId)
                      }}
                    >
                      {volumes.map(volume => <option key={volume.id} value={volume.id}>{volume.name}</option>)}
                    </NativeSelect>
                  </div>
                  <div>
                    <Label>{text('章节定位', 'Chapter role')}</Label>
                    <NativeSelect value={selected.role} onChange={e => updateField('role', e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </NativeSelect>
                  </div>
                  <div>
                    <Label>{text('出场关键人（逗号分隔）', 'Key characters (comma-separated)')}</Label>
                    <Input
                      value={selected.characters.join('、')}
                      onChange={e => updateField('characters', e.target.value.split(/[,，、\s]+/).filter(Boolean))}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Label>{text('作者微操指导', 'Author guidance')}</Label>
                  <span className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {text('（写稿时会作为最高优先级注入 AI — 可覆盖细纲）', '(Used as the highest-priority instruction during drafting; it can override the outline.)')}
                  </span>
                  <Textarea
                    value={selected.userGuidance}
                    onChange={e => updateField('userGuidance', e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="mt-3">
                  <Label>{text('章节要点', 'Chapter notes')}</Label>
                  <span className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {selected.notesUpdatedAt
                      ? text(
                        `（定稿后自动生成 — ${new Date(selected.notesUpdatedAt).toLocaleDateString(locale)}）`,
                        `(Generated after finalization — ${new Date(selected.notesUpdatedAt).toLocaleDateString(locale)})`,
                      )
                      : text('（定稿后自动生成，也可手动填写）', '(Generated after finalization, or enter it manually.)')
                    }
                  </span>
                  <Textarea
                    value={selected.notes || ''}
                    onChange={e => updateField('notes', e.target.value)}
                    rows={3}
                  />
                </div>
                {dirty && (
                  <div className="mt-3 flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleSaveOne} disabled={saving}>
                      <Save size={12} /> {saving ? text('保存中...', 'Saving...') : text('保存章节信息', 'Save chapter info')}
                    </Button>
                  </div>
                )}
              </div>

              {/* 关联世界地图节点（按本章细纲文本自动识别，只读展示） */}
              <div
                className="mt-3 p-3 rounded-lg border"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-panel)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <Label className="flex items-center gap-1.5 font-medium">
                    <MapPin size={13} style={{ color: 'var(--color-accent)' }} />
                    <span>{text('关联地图节点', 'Linked map nodes')}</span>
                    <span className="text-[0.7rem] font-normal" style={{ color: 'var(--color-text-muted)' }}>
                      {text('（根据本章细纲与事件中提及的地点自动关联）', '(Automatically recognized from chapter text and outline)')}
                    </span>
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      useEditorStore.getState().openFile({
                        id: 'world-map',
                        name: text('地图册', 'Map atlas'),
                        type: 'world-map',
                        projectKey,
                      })
                    }}
                  >
                    {text('在地图册中查看', 'View in map atlas')}
                  </Button>
                </div>
                {(() => {
                  const matched = worldMapNodes.filter(node =>
                    node.name && (
                      (selected.title || '').includes(node.name)
                      || (selected.purpose || '').includes(node.name)
                      || (selected.keyEvents || '').includes(node.name)
                      || (selected.userGuidance || '').includes(node.name)
                    )
                  )
                  if (matched.length === 0) {
                    return (
                      <p className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>
                        {text('本章细纲或事件中未提及已收录的地图节点。', 'No recognized world map nodes mentioned in this chapter.')}
                      </p>
                    )
                  }
                  return (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {matched.map(node => (
                        <div
                          key={node.id}
                          className="text-xs px-2.5 py-1.5 rounded border flex items-center gap-2"
                          style={{
                            borderColor: 'var(--color-border)',
                            backgroundColor: 'var(--color-bg)',
                          }}
                        >
                          <span className="font-semibold">{node.name}</span>
                          <span className="text-[0.7rem] px-1 rounded" style={{ backgroundColor: 'var(--color-panel)' }}>
                            {WORLD_MAP_NODE_TYPE_LABELS[node.type]?.[locale === 'zh-CN' ? 'zh' : 'en'] || node.type}
                          </span>
                          <span className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                            {getWorldMapName(worldMaps, node.mapId)}
                          </span>
                          {node.description && (
                            <span className="text-[0.7rem] truncate max-w-[200px]" style={{ color: 'var(--color-text-muted)' }}>
                              {node.description}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          ) : selected ? (
            <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm" style={{ color: 'var(--color-text-muted)' }} data-testid="blueprint-loading">
              <RefreshCw size={14} className={v2Loading ? 'animate-spin' : ''} />
              {v2Loading
                ? text('正在载入本章细纲…', 'Loading this chapter outline…')
                : text('本章细纲尚未建立，正在生成统一编辑视图…', 'This chapter has no outline yet; preparing the unified editor…')}
            </div>
          ) : (
            <PlanningEmptyState
              icon={<BookOpen size={20} />}
              title={text('在左侧选择一章开始编辑', 'Choose a chapter on the left to start editing')}
              description={text(
                '右侧是这一章的统一细纲编辑器：分区细纲、逐场分镜、章节信息与作者指导、关联地图节点。',
                'The detail pane is the unified outline editor for this chapter: sections, scenes, chapter info, author guidance, and linked map nodes.',
              )}
              steps={visibleBlueprints.length === 0 ? [
                text('先在左侧新建一卷，再新增章节；', 'Create a volume on the left, then add chapters to it.'),
                text('选中章节后填写细纲，保存后即可写正文。', 'Select a chapter, fill in the outline, save, then start drafting.'),
              ] : [
                text('在左侧点选章节（双击可直达正文草稿）；', 'Click a chapter on the left (double-click to open its draft).'),
                text('修改后点「保存」或「保存全部」。', 'After editing, click “Save” or “Save all”.'),
              ]}
              actions={visibleBlueprints.length === 0 ? (
                <Button variant="default" size="sm" onClick={() => void handleAddVolume()} disabled={!projectDataReady}>
                  <FolderPlus size={13} /> {text('新建卷', 'New volume')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => revealSidebarGroup('manuscript')}>
                  <PenLine size={13} /> {text('打开正文写作', 'Open manuscript')}
                </Button>
              )}
            />
          )}
          </>}
      </main>
      {projectDataReady && currentProjectSession && (
        <BlueprintV2ImportDialog
          open={v2ImportOpen}
          onClose={() => setV2ImportOpen(false)}
          chapters={blueprints.map(blueprint => ({
            chapterNumber: blueprint.chapterNumber,
            title: blueprint.title,
          }))}
          projectSession={currentProjectSession}
          projectKey={projectKey}
          onImported={chapterNumber => void handleV2Imported(chapterNumber)}
        />
      )}
    </PlanningPageShell>
  )
}
