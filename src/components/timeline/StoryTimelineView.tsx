import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'
import {
  AlertTriangle,
  Clock3,
  Crosshair,
  Maximize2,
  Plus,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import type {
  StoryTimelineBranch,
  StoryTimelineEvent,
  StoryTimelineMention,
} from '../../shared/story-timeline'
import { STORY_TIMELINE_MAIN_BRANCH_ID, STORY_TIMELINE_STATUS_LABELS } from '../../shared/story-timeline'
import type { StoryTimelineDeleteImpact } from '../../shared/story-timeline'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useCharacterStore } from '../../stores/character-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import {
  PlanningPageShell,
} from '../planning/PlanningPageShell'
import { usePlanningBackPath } from '../planning/planning-navigation'
import {
  buildStoryTimelineLayout,
  sortTimelineEvents,
} from './story-timeline-layout'
import { StoryTimelineScene } from './StoryTimelineScene'
import { TimelineEventFloat } from './TimelineEventFloat'
import {
  readTimelineUiPrefs,
  sanitizeTimelineCanvasViewport,
  writeTimelineUiPrefs,
  type TimelineCanvasViewport,
} from './timeline-ui-prefs'
import { TimelineContextMenu } from './TimelineContextMenu'
import { TimelineEventModal } from './TimelineEventModal'
import { TimelineRangeModal } from './TimelineRangeModal'
import {
  TimelineEventSidebar,
  TimelineSidebarRail,
  DEFAULT_TIMELINE_SIDEBAR_FILTERS,
  type TimelineDeleteBranchResult,
  type TimelineSidebarFilters,
} from './TimelineEventSidebar'
import type {
  TimelineCanvasBounds,
  TimelineCascadePreview,
  TimelineScreenPoint,
  TimelineUiResult,
  TimelineViewportIntent,
} from './timeline-ui-contract'

interface EventFloatState {
  eventId: string
  point: TimelineScreenPoint
  mode: 'details' | 'edit'
  bounds: TimelineCanvasBounds
}

interface CanvasMenuState {
  point: TimelineScreenPoint
  suggestedOrder: number | null
  canCreate: boolean
  bounds: TimelineCanvasBounds
}

interface AnchorMenuState {
  anchor: 'start' | 'end'
  point: TimelineScreenPoint
  bounds: TimelineCanvasBounds
}

interface CreateModalState {
  mode: 'create-main' | 'create-next' | 'create-branch'
  sourceEventId?: string
  /** create-next 追加到指定支线（含该支线首个事件）时的真实归属。 */
  branchId?: string
  /** 仅用于表单标题显示的真实支线名。 */
  branchName?: string
  suggestedOrder?: number
}

/**
 * 恢复视口时使用的 nonce。
 *
 * Scene 的视口意图按 nonce 去重，内部把初始值和 -1 视为「已处理」。
 * 宿主保存了真实视口时用这个值进入本帧：画布停在保存位置，不做初始适配。
 * 任何真实意图都从 0 开始递增，绝不会被误判成已处理。
 */
const RESTORE_VIEWPORT_NONCE = -1

function windowBounds(): TimelineCanvasBounds {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

/** 支线追加事件时的表单预填种子：只承载真实归属，不是一条真实事件记录。 */
function branchSeedEvent(
  branch: StoryTimelineBranch,
  lastEvent: StoryTimelineEvent | null,
): StoryTimelineEvent {
  return {
    id: '',
    branchId: branch.id,
    parentEventId: branch.sourceEventId ?? null,
    title: '',
    timeLabel: lastEvent?.timeLabel ?? '',
    sortOrder: lastEvent ? lastEvent.sortOrder + 1 : 1,
    precision: 'exact',
    description: '',
    chapterNumbers: [],
    characterNames: [],
    locationNodeIds: [],
    status: 'planned',
  }
}

export default function StoryTimelineView({
  projectKey,
  onNavigateMention,
}: {
  projectKey: string
  onNavigateMention?: (mention: StoryTimelineMention) => void
}) {
  const text = useLocaleStore(s => s.text)
  const backPath = usePlanningBackPath()
  const currentProject = useProjectStore(s => s.currentProject)
  const settings = useStoryTimelineStore(s => s.settings)
  const branches = useStoryTimelineStore(s => s.branches)
  const events = useStoryTimelineStore(s => s.events)
  const expandedBranchIds = useStoryTimelineStore(s => s.expandedBranchIds)
  const dataProjectKey = useStoryTimelineStore(s => s.dataProjectKey)
  const loadAll = useStoryTimelineStore(s => s.loadAll)
  const saveSettings = useStoryTimelineStore(s => s.saveSettings)
  const upsertEventResult = useStoryTimelineStore(s => s.upsertEventResult)
  const previewEventDelete = useStoryTimelineStore(s => s.previewEventDelete)
  const previewBranchDelete = useStoryTimelineStore(s => s.previewBranchDelete)
  const deleteEventConfirmed = useStoryTimelineStore(s => s.deleteEventConfirmed)
  const deleteBranchConfirmed = useStoryTimelineStore(s => s.deleteBranchConfirmed)
  const createBranchWithEvent = useStoryTimelineStore(s => s.createBranchWithEvent)
  const upsertBranch = useStoryTimelineStore(s => s.upsertBranch)
  const setBranchExpanded = useStoryTimelineStore(s => s.setBranchExpanded)
  const loadWorldMap = useWorldMapStore(s => s.loadAll)
  const worldMapNodes = useWorldMapStore(s => s.nodes)

  const flowRef = useRef<HTMLDivElement>(null)
  const [rangeModalOpen, setRangeModalOpen] = useState(false)
  const [rangeModalFocus, setRangeModalFocus] = useState<'start' | 'end' | 'general'>('general')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /**
   * 画布视口只响应这类意图；nonce 让同一目标可重复触发。
   * 恢复保存的视口时先停在 RESTORE_VIEWPORT_NONCE，避免初始适配覆盖它。
   */
  const [viewportIntent, setViewportIntent] = useState<TimelineViewportIntent>({
    nonce: RESTORE_VIEWPORT_NONCE,
    kind: 'initial',
  })
  /** 本项目上次离开时的真实视口：作为 React Flow 的 defaultViewport。 */
  const storedCanvas = useMemo(() => readTimelineUiPrefs(projectKey)?.canvas ?? null, [projectKey])

  // 画布浮层：事件浮窗 / 空白菜单 / 锚点菜单互斥，打开一个就关掉其他。
  const [eventFloat, setEventFloat] = useState<EventFloatState | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null)
  const [anchorMenu, setAnchorMenu] = useState<AnchorMenuState | null>(null)
  const [createModal, setCreateModal] = useState<CreateModalState | null>(null)
  /** 事件删除的权威影响预览：浮窗展示用；确认那一刻再取一次最新指纹。 */
  const [eventDeletePreview, setEventDeletePreview] = useState<{
    eventId: string
    impact: StoryTimelineDeleteImpact
  } | null>(null)

  // 左侧事件清单：搜索与状态 / 主线支线筛选（只作用列表）
  const [filters, setFilters] = useState<TimelineSidebarFilters>(DEFAULT_TIMELINE_SIDEBAR_FILTERS)
  /** 「事件与支线」内侧栏默认展开；收起后画布占满释放的空间，展开按钮始终在画布左缘。 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readTimelineUiPrefs(projectKey)?.sidebarCollapsed ?? false,
  )
  /** 读取失败必须显式重试，绝不把失败伪装成空项目。 */
  const [readFailed, setReadFailed] = useState(false)
  /** 每个项目的数据就绪后只恢复一次界面偏好。 */
  const [restoredProjectKey, setRestoredProjectKey] = useState<string | null>(null)

  const isDataReady = dataProjectKey === projectKey

  // 切项目：立刻用新项目自己的偏好与空选中重排，绝不复用另一个项目的选中/浮窗。
  const [activeProjectKey, setActiveProjectKey] = useState(projectKey)
  if (activeProjectKey !== projectKey) {
    setActiveProjectKey(projectKey)
    setRestoredProjectKey(null)
    const prefs = readTimelineUiPrefs(projectKey)
    setSidebarCollapsed(prefs?.sidebarCollapsed ?? false)
    setSelectedId(null)
    setEventFloat(null)
    setCanvasMenu(null)
    setAnchorMenu(null)
    setCreateModal(null)
    setFilters(DEFAULT_TIMELINE_SIDEBAR_FILTERS)
    setReadFailed(false)
    // 先不移动画布：真实视口由 defaultViewport 恢复，没有保存值时由就绪后的
    // 恢复逻辑发一次可读适配意图。
    setViewportIntent({ nonce: RESTORE_VIEWPORT_NONCE, kind: 'initial' })
  }

  /**
   * 提及只是一条导航入口，不能凭空创建人物或写入人物事实。若调用者没有
   * 自定义导航器，则在当前项目的已加载角色名单中定位同名角色并打开概览。
   */
  const handleNavigateMention = useCallback((mention: StoryTimelineMention) => {
    if (onNavigateMention) {
      onNavigateMention(mention)
      return
    }
    if (currentProject?.path !== projectKey) return

    const target = useCharacterStore.getState().characters
      .find(character => character.name === mention.name)
    if (!target) {
      toast.warning(text(
        `未找到「${mention.name}」的人物卡片，无法跳转。`,
        `No character card found for “${mention.name}”.`,
      ))
      return
    }

    useCharacterStore.getState().setSelectedName(target.name)
    useLayoutStore.getState().openCharacterProfile()
  }, [currentProject?.path, onNavigateMention, projectKey, text])

  /** 读取（含手动重试）：只有确认本项目数据仍未就绪时才标记失败。 */
  const runLoad = useCallback(async () => {
    await loadAll(projectKey)
    if (useProjectStore.getState().currentProject?.path !== projectKey) return
    if (useStoryTimelineStore.getState().dataProjectKey !== projectKey) setReadFailed(true)
  }, [loadAll, projectKey])

  useEffect(() => {
    void Promise.resolve().then(runLoad)
    void loadWorldMap(projectKey)
  }, [runLoad, loadWorldMap, projectKey])

  const orderedEvents = useMemo(() => sortTimelineEvents(events), [events])

  // 统计口径：branches 数据里含 main，主线不是支线，不能计入支线数。
  const nonMainBranches = useMemo(
    () => branches.filter(branch => branch.id !== STORY_TIMELINE_MAIN_BRANCH_ID),
    [branches],
  )
  const branchById = useMemo(() => {
    const map = new Map<string, StoryTimelineBranch>()
    for (const branch of branches) map.set(branch.id, branch)
    return map
  }, [branches])
  const eventById = useMemo(() => {
    const map = new Map<string, StoryTimelineEvent>()
    for (const event of events) map.set(event.id, event)
    return map
  }, [events])

  const nextMainOrder = useMemo(() => {
    const mainEvents = orderedEvents.filter(
      event => (event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID,
    )
    return mainEvents.length > 0
      ? Math.max(...mainEvents.map(event => event.sortOrder)) + 1
      : 1
  }, [orderedEvents])
  const nextBranchSortOrder = useMemo(() => {
    const orders = nonMainBranches.map(branch => branch.sortOrder)
    return orders.length > 0 ? Math.max(...orders) + 1 : 1
  }, [nonMainBranches])

  // 纯函数推导时间树布局
  const layout = useMemo(() => {
    return buildStoryTimelineLayout(events, branches, expandedBranchIds, settings)
  }, [events, branches, expandedBranchIds, settings])

  const branchNameById = useMemo(() => {
    const names = new Map<string, string>()
    for (const branch of branches) names.set(branch.id, branch.name)
    return names
  }, [branches])

  const statusLabel = useCallback((status: StoryTimelineEvent['status']) => {
    const label = STORY_TIMELINE_STATUS_LABELS[status]
    return text(label.zh, label.en)
  }, [text])

  // ============================================================
  // 支线展开链：定位/创建时必须展开目标支线的全部祖先，而不只是自身。
  // ============================================================

  const branchChain = useCallback((branchId: string): string[] => {
    const chain: string[] = []
    const seen = new Set<string>()
    let current: string | undefined = branchId
    while (current && current !== STORY_TIMELINE_MAIN_BRANCH_ID && !seen.has(current)) {
      seen.add(current)
      chain.push(current)
      const branch = branchById.get(current)
      const sourceEvent = branch?.sourceEventId ? eventById.get(branch.sourceEventId) : undefined
      current = sourceEvent?.branchId || STORY_TIMELINE_MAIN_BRANCH_ID
    }
    return chain.reverse()
  }, [branchById, eventById])

  const expandBranchChain = useCallback((branchId: string) => {
    for (const id of branchChain(branchId)) setBranchExpanded(id, true)
  }, [branchChain, setBranchExpanded])

  /** 处理源事件上的分支展开/折叠 */
  const handleToggleEventBranch = useCallback((eventId: string) => {
    const childBranches = branches.filter(branch => branch.sourceEventId === eventId)
    if (childBranches.length === 0) return
    const isAnyExpanded = childBranches.some(branch => expandedBranchIds.includes(branch.id))
    childBranches.forEach((branch) => {
      setBranchExpanded(branch.id, !isAnyExpanded)
    })
  }, [branches, expandedBranchIds, setBranchExpanded])

  // ============================================================
  // 画布回调：selection 与浮层是不同状态，互不代替。
  // ============================================================

  const closeAllOverlays = useCallback(() => {
    setEventFloat(null)
    setCanvasMenu(null)
    setAnchorMenu(null)
  }, [])

  const captureBounds = useCallback((): TimelineCanvasBounds => {
    const rect = flowRef.current?.getBoundingClientRect()
    return rect
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : windowBounds()
  }, [])

  const handleSelectEvent = useCallback((eventId: string | null) => {
    setSelectedId(eventId)
  }, [])

  const handleOpenEventFloat = useCallback((eventId: string, point: TimelineScreenPoint, mode: 'details' | 'edit') => {
    setCanvasMenu(null)
    setAnchorMenu(null)
    setSelectedId(eventId)
    setEventFloat({ eventId, point, mode, bounds: captureBounds() })
  }, [captureBounds])

  /** 从清单发起的编辑没有鼠标位置，把浮窗放在画布内容区中央。 */
  const openEditFloatFromList = useCallback((eventId: string) => {
    const rect = flowRef.current?.getBoundingClientRect()
    const point: TimelineScreenPoint = rect
      ? { clientX: rect.left + rect.width / 2, clientY: rect.top + Math.min(rect.height / 3, 220) }
      : { clientX: 0, clientY: 0 }
    handleOpenEventFloat(eventId, point, 'edit')
  }, [handleOpenEventFloat])

  const handleCanvasContextMenu = useCallback((point: TimelineScreenPoint, hint: { suggestedOrder: number | null; canCreate: boolean }) => {
    setEventFloat(null)
    setAnchorMenu(null)
    setCanvasMenu({ point, suggestedOrder: hint.suggestedOrder, canCreate: hint.canCreate, bounds: captureBounds() })
  }, [captureBounds])

  const handleAnchorContextMenu = useCallback((anchor: 'start' | 'end', point: TimelineScreenPoint) => {
    setEventFloat(null)
    setCanvasMenu(null)
    setAnchorMenu({ anchor, point, bounds: captureBounds() })
  }, [captureBounds])

  const handleOpenRangeEditor = useCallback((anchor: 'start' | 'end') => {
    setRangeModalFocus(anchor)
    setRangeModalOpen(true)
  }, [])

  /** Escape 关闭浮窗后把焦点还给触发节点，键盘操作不断链。 */
  const handleFloatClose = useCallback((options?: { viaEscape?: boolean }) => {
    setEventFloat((current) => {
      if (current && options?.viaEscape) {
        // 轴点也带 data-event-id，必须精确到事件标注本身。
        const node = document.querySelector<HTMLElement>(
          `[data-testid="timeline-event-label"][data-event-id="${CSS.escape(current.eventId)}"]`,
        )
        node?.focus()
      }
      return null
    })
  }, [])

  /**
   * 清单定位：展开目标的全部祖先支线，选中，并请求画布以可读比例聚焦。
   * 视口意图只记录诉求，真正的移动在 Scene 内部执行。
   */
  const locateEvent = useCallback((eventId: string) => {
    const event = eventById.get(eventId)
    if (!event) return
    expandBranchChain(event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID)
    setSelectedId(eventId)
    setViewportIntent(current => ({ kind: 'focus-event', eventId, nonce: current.nonce + 1 }))
  }, [eventById, expandBranchChain])

  // ============================================================
  // 写入适配：store 的写入/删除结果在这里统一收敛成 UI 结果。
  // 删除一律走 C 的权威影响预览 + 指纹确认，页面不自己猜级联范围。
  // ============================================================

  const handleFloatSave = useCallback(async (event: StoryTimelineEvent): Promise<TimelineUiResult> => {
    const wasFirstEvent = useStoryTimelineStore.getState().events.length === 0
    const result = await upsertEventResult(event)
    if (!result.success) return result
    setSelectedId(event.id)
    // 成功后回到该事件的详情浮窗并保持视角；只有首事件需要校正一次视口。
    setEventFloat(current => (current && current.eventId === event.id
      ? { ...current, mode: 'details' }
      : current))
    if (wasFirstEvent) {
      // 首个事件加入后节点尺寸在下一帧才完成测量；此时校正一次视口。
      setViewportIntent(current => ({ kind: 'initial', nonce: current.nonce + 1 }))
    }
    return result
  }, [upsertEventResult])

  /** 删除成功后清理已经失效的 selection 与浮窗目标。 */
  const pruneStaleSelection = useCallback(() => {
    const state = useStoryTimelineStore.getState()
    const alive = new Set(state.events.map(event => event.id))
    setSelectedId(current => (current && !alive.has(current) ? null : current))
    setEventFloat(current => (current && !alive.has(current.eventId) ? null : current))
  }, [])

  /**
   * 事件删除：确认瞬间重新取一次权威预览，用它的指纹提交。
   * 影响集合在“预览 → 确认”之间变化时，C 返回 needsReconfirmation，
   * 这里把最新影响交回浮窗显示并要求重新确认，绝不静默扩大删除范围。
   */
  const handleFloatDelete = useCallback(async (eventId: string): Promise<TimelineUiResult> => {
    const preview = await previewEventDelete(eventId)
    if (!preview.success || !preview.preview) {
      return {
        success: false,
        error: preview.error || text('无法确认删除影响，请重试', 'Could not verify the delete impact; please retry'),
      }
    }
    const result = await deleteEventConfirmed(eventId, preview.preview.fingerprint)
    if (!result.success) {
      if (result.needsReconfirmation && result.preview) {
        setEventDeletePreview({ eventId, impact: result.preview })
        return {
          success: false,
          error: text(
            `影响范围已经变化：现在将删除 ${result.preview.eventCount} 个事件、${result.preview.branchCount} 条支线。请重新确认。`,
            `The impact changed: ${result.preview.eventCount} events and ${result.preview.branchCount} branches will now be deleted. Please confirm again.`,
          ),
        }
      }
      return { success: false, error: result.error }
    }
    pruneStaleSelection()
    setEventFloat(null)
    return { success: true }
  }, [deleteEventConfirmed, previewEventDelete, pruneStaleSelection, text])

  const handleRenameBranch = useCallback(async (branchId: string, name: string): Promise<TimelineUiResult> => {
    const branch = useStoryTimelineStore.getState().branches.find(item => item.id === branchId)
    if (!branch) return { success: false, error: text('找不到这条支线', 'Branch not found') }
    const trimmed = name.trim()
    if (!trimmed) return { success: false, error: text('支线名称不能为空', 'Branch name is required') }
    if (trimmed === branch.name) return { success: true }
    const success = await upsertBranch({ ...branch, name: trimmed })
    if (!success) return { success: false, error: text('重命名失败，请重试', 'Rename failed; please retry') }
    return { success: true }
  }, [text, upsertBranch])

  /** 支线删除的权威影响预览：直接交给 C 计算，主线一律拒绝。 */
  const handlePreviewDeleteBranch = useCallback(async (branchId: string) => {
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) {
      return { success: false as const, error: text('主时间轴不可删除', 'The main timeline cannot be deleted') }
    }
    return previewBranchDelete(branchId)
  }, [previewBranchDelete, text])

  const handleDeleteBranch = useCallback(async (
    branchId: string,
    fingerprint: string,
  ): Promise<TimelineDeleteBranchResult> => {
    if (branchId === STORY_TIMELINE_MAIN_BRANCH_ID) {
      return { success: false, error: text('主时间轴不可删除', 'The main timeline cannot be deleted') }
    }
    const result = await deleteBranchConfirmed(branchId, fingerprint)
    if (!result.success) {
      if (result.needsReconfirmation && result.preview) {
        return {
          success: false,
          needsReconfirmation: true,
          preview: result.preview,
          error: text(
            `影响范围已经变化：现在将删除 ${result.preview.eventCount} 个事件、${result.preview.branchCount} 条支线。请重新确认。`,
            `The impact changed: ${result.preview.eventCount} events and ${result.preview.branchCount} branches will now be deleted. Please confirm again.`,
          ),
        }
      }
      return { success: false, error: result.error }
    }
    // 成功后清理失效的选中与浮窗目标（store 已按返回的 ID 集合清理数据）。
    pruneStaleSelection()
    setCanvasMenu(null)
    setAnchorMenu(null)
    return { success: true }
  }, [deleteBranchConfirmed, pruneStaleSelection, text])

  /**
   * 事件级联影响的本地临时估算，规则与仓库层 deleteEvent 一致：
   * 以该事件为源的所有下游支线（含嵌套）及其事件都会被连带删除。
   *
   * 只用于浮窗打开后、权威预览返回前的过渡显示；真正的删除范围与指纹
   * 一律来自 C 的主进程预览，本地估算绝不参与删除决策。
   */
  const computeEventCascade = useCallback((eventId: string): TimelineCascadePreview => {
    const branchesBySource = new Map<string, StoryTimelineBranch[]>()
    for (const branch of branches) {
      if (!branch.sourceEventId) continue
      const list = branchesBySource.get(branch.sourceEventId) ?? []
      list.push(branch)
      branchesBySource.set(branch.sourceEventId, list)
    }
    const doomedEvents = new Set<string>([eventId])
    const doomedBranches: string[] = []
    let frontier = [eventId]
    while (frontier.length > 0) {
      const next: string[] = []
      for (const currentId of frontier) {
        for (const branch of branchesBySource.get(currentId) ?? []) {
          if (doomedBranches.includes(branch.id)) continue
          doomedBranches.push(branch.id)
          for (const event of events) {
            if ((event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === branch.id && !doomedEvents.has(event.id)) {
              doomedEvents.add(event.id)
              next.push(event.id)
            }
          }
        }
      }
      frontier = next
    }
    return {
      branchNames: doomedBranches.map(id => branchNameById.get(id) ?? id),
      eventCount: doomedEvents.size,
    }
  }, [branches, events, branchNameById])

  /** 创建支线/后续事件从浮窗发起时先收起浮窗，再打开创建表单。 */
  const openCreateModal = useCallback((state: CreateModalState) => {
    closeAllOverlays()
    setCreateModal(state)
  }, [closeAllOverlays])

  /** 创建表单提交：创建支线走原子事务，其余走单个 upsert。 */
  const handleModalSave = useCallback(async ({
    event,
    newBranchName,
  }: {
    event: StoryTimelineEvent
    newBranchName?: string
  }): Promise<TimelineUiResult> => {
    const isFirstTimelineEvent = useStoryTimelineStore.getState().events.length === 0

    if (newBranchName && createModal?.mode === 'create-branch' && createModal.sourceEventId) {
      const sourceEvent = eventById.get(createModal.sourceEventId)
      if (!sourceEvent) return { success: false, error: text('找不到分叉源事件', 'Source event not found') }
      // 支线与首事件一次事务提交，绝不留下空支线。
      const commit = await createBranchWithEvent({
        id: event.branchId ?? `branch-${Date.now()}`,
        name: newBranchName,
        sourceEventId: sourceEvent.id,
        sortOrder: nextBranchSortOrder,
      }, event)
      if (!commit.success) return { success: false, error: commit.error }
      // 创建成功后展开全部祖先与新支线，选中并定位首个事件。
      expandBranchChain(commit.branch.id)
      setBranchExpanded(commit.branch.id, true)
      setSelectedId(commit.event.id)
      setViewportIntent(current => ({ kind: 'focus-event', eventId: commit.event.id, nonce: current.nonce + 1 }))
      return { success: true }
    }

    const result = await upsertEventResult(event)
    if (result.success) {
      expandBranchChain(event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID)
      setSelectedId(event.id)
      setViewportIntent(current => (isFirstTimelineEvent
        ? { kind: 'initial', nonce: current.nonce + 1 }
        : { kind: 'focus-event', eventId: event.id, nonce: current.nonce + 1 }))
    }
    return result
  }, [createBranchWithEvent, createModal, eventById, expandBranchChain, nextBranchSortOrder, setBranchExpanded, text, upsertEventResult])

  const floatEvent = eventFloat ? eventById.get(eventFloat.eventId) ?? null : null
  const floatChildBranches = useMemo(() => {
    if (!floatEvent) return []
    return nonMainBranches.filter(branch => branch.sourceEventId === floatEvent.id)
  }, [floatEvent, nonMainBranches])
  const floatIsExpanded = floatChildBranches.some(branch => expandedBranchIds.includes(branch.id))

  // 浮窗打开时向主进程取一次权威删除影响，供浮窗展示真实计数；
  // 事件或项目切换后旧预览立即作废，绝不跨事件复用。
  const floatEventId = eventFloat?.eventId ?? null
  const [renderedFloatEventId, setRenderedFloatEventId] = useState<string | null>(null)
  if (renderedFloatEventId !== floatEventId) {
    setRenderedFloatEventId(floatEventId)
    setEventDeletePreview(null)
  }
  useEffect(() => {
    if (!floatEventId) return
    let cancelled = false
    void previewEventDelete(floatEventId).then((result) => {
      if (cancelled) return
      setEventDeletePreview(result.success && result.preview
        ? { eventId: floatEventId, impact: result.preview }
        : null)
    })
    return () => { cancelled = true }
  }, [floatEventId, previewEventDelete])

  /**
   * 浮窗展示用的级联影响：优先用主进程的权威预览，未返回前显示同规则的
   * 本地临时估算（只用于文字展示，删除范围永远以指纹提交为准）。
   */
  const floatCascade = useMemo<TimelineCascadePreview>(() => {
    if (!floatEvent) return { branchNames: [], eventCount: 1 }
    if (eventDeletePreview && eventDeletePreview.eventId === floatEvent.id) {
      return {
        branchNames: eventDeletePreview.impact.branchNames,
        eventCount: eventDeletePreview.impact.eventCount,
      }
    }
    return computeEventCascade(floatEvent.id)
  }, [computeEventCascade, eventDeletePreview, floatEvent])

  /**
   * 创建表单的源事件：create-next 追加到某支线时用真实归属做预填种子
   * （支线可能还没有任何事件），种子绝不会被保存成事件。
   */
  const modalSourceEvent = useMemo<StoryTimelineEvent | null>(() => {
    if (!createModal) return null
    if (createModal.sourceEventId) return eventById.get(createModal.sourceEventId) ?? null
    if (createModal.branchId) {
      const branch = branchById.get(createModal.branchId)
      if (!branch) return null
      const last = sortTimelineEvents(events.filter(item => item.branchId === branch.id)).at(-1) ?? null
      return branchSeedEvent(branch, last)
    }
    return null
  }, [branchById, createModal, eventById, events])

  // ============================================================
  // 界面偏好：切项目恢复，操作后持久化（建议值，绝不触发额外 fitView）。
  // ============================================================

  /** 最近一次真实视口；写入偏好时取这里的值。 */
  const canvasRef = useRef<TimelineCanvasViewport | null>(storedCanvas)
  useEffect(() => {
    canvasRef.current = storedCanvas
  }, [storedCanvas])

  if (isDataReady && restoredProjectKey !== projectKey) {
    setRestoredProjectKey(projectKey)
    const prefs = readTimelineUiPrefs(projectKey)
    const savedId = prefs?.selectedEventId
    if (savedId && events.some(event => event.id === savedId)) setSelectedId(savedId)
    // 有保存视口时画布已经停在原位，这里不再移动；
    // 没有保存视口才发一次可读适配（选中事件优先，否则整体适配）。
    if (!storedCanvas) {
      setViewportIntent({
        nonce: 0,
        kind: savedId && events.some(event => event.id === savedId) ? 'focus-event' : 'initial',
        eventId: savedId ?? undefined,
      })
    }
  }

  const persistPrefs = useCallback(() => {
    if (!isDataReady) return
    writeTimelineUiPrefs(projectKey, {
      sidebarCollapsed,
      selectedEventId: selectedId,
      canvas: canvasRef.current,
    })
  }, [isDataReady, projectKey, selectedId, sidebarCollapsed])

  useEffect(() => {
    persistPrefs()
  }, [persistPrefs])

  // 平移/缩放结束后记录真实视口，供卸载重入恢复（数字与 zoom 由写入层校验）。
  const persistRef = useRef(persistPrefs)
  const persistFrameRef = useRef<number | null>(null)
  useEffect(() => {
    persistRef.current = persistPrefs
  }, [persistPrefs])
  useEffect(() => () => {
    if (persistFrameRef.current !== null) window.cancelAnimationFrame(persistFrameRef.current)
  }, [])
  const schedulePersist = useCallback(() => {
    if (persistFrameRef.current !== null) return
    persistFrameRef.current = window.requestAnimationFrame(() => {
      persistFrameRef.current = null
      persistRef.current()
    })
  }, [])

  const handleViewportChange = useCallback((viewport: Viewport) => {
    const valid = sanitizeTimelineCanvasViewport(viewport)
    if (!valid) return
    canvasRef.current = valid
    schedulePersist()
  }, [schedulePersist])

  /**
   * 用户开始缩放时关闭清洁浮窗与画布菜单。
   *
   * Scene 的 onInteractStart 由 React Flow 的 onMoveStart 驱动，程序化视口变化
   * （初始适配、恢复保存视口、定位事件）同样会触发它；这里只认滚轮这类真实
   * 用户缩放手势，避免浮窗刚打开就被随之而来的适配动作关掉。指针手势不需要
   * 在这里处理：浮窗自身会在浮窗外 pointerdown 时关闭（脏编辑仍由它守卫）。
   */
  const userZoomGestureRef = useRef(false)
  const handleInteractStart = useCallback(() => {
    if (!userZoomGestureRef.current) return
    userZoomGestureRef.current = false
    setCanvasMenu(null)
    setAnchorMenu(null)
    setEventFloat(current => (current && current.mode === 'details' ? null : current))
  }, [])

  const selectedEvent = selectedId ? eventById.get(selectedId) ?? null : null

  return (
    <>
      <PlanningPageShell
        breadcrumb={[
          { label: backPath.overviewLabel, onClick: backPath.openOverview },
          { label: backPath.planLabel, onClick: backPath.revealWritingPlan },
          { label: text('故事时间线', 'Story timeline') },
        ]}
        icon={<Clock3 size={15} />}
        title={settings.title}
        description={text(
          '作者手动排布的故事时间轴：刻度、自定义时间与事件都由你填写，不依赖蓝图或 AI。主轴向右推进，锚点界定故事范围。',
          'A story timeline arranged by the author: ruler, custom time labels, and events are all entered by hand, independent of blueprints or AI. The axis advances rightwards while anchors bound the story range.',
        )}
        meta={text(
          `${events.length} 个事件 · ${nonMainBranches.length} 条支线`,
          `${events.length} events · ${nonMainBranches.length} branches`,
        )}
        actions={
          <>
            <Button
              variant="default"
              size="sm"
              onClick={() => openCreateModal({ mode: 'create-main', suggestedOrder: nextMainOrder })}
              data-testid="timeline-toolbar-new-event"
            >
              <Plus size={13} /> {text('新建事件', 'New event')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedEvent}
              onClick={() => {
                if (!selectedEvent) return
                locateEvent(selectedEvent.id)
              }}
              title={selectedEvent
                ? text('把画布移到选中的事件', 'Move the canvas to the selected event')
                : text('先在画布或列表里选中一个事件', 'Select an event on the canvas or in the list first')}
              data-testid="timeline-toolbar-focus-selected"
            >
              <Crosshair size={13} /> {text('定位选中', 'Locate selected')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setViewportIntent(current => ({ kind: 'fit-all', nonce: current.nonce + 1 }))
              }}
              data-testid="timeline-toolbar-fit-all"
            >
              <Maximize2 size={13} /> {text('查看全部', 'View all')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRangeModalFocus('general')
                setRangeModalOpen(true)
              }}
              data-testid="timeline-toolbar-ruler"
            >
              <Settings2 size={13} /> {text('刻度设置', 'Ruler settings')}
            </Button>
          </>
        }
      >
        {!sidebarCollapsed && (
          <TimelineEventSidebar
            events={events}
            branches={branches}
            expandedBranchIds={expandedBranchIds}
            selectedId={selectedId}
            dataReady={isDataReady}
            filters={filters}
            onFiltersChange={setFilters}
            onCollapse={() => setSidebarCollapsed(true)}
            onLocateEvent={locateEvent}
            onEditEvent={openEditFloatFromList}
            onCreateMainEvent={() => openCreateModal({ mode: 'create-main', suggestedOrder: nextMainOrder })}
            onAddBranchEvent={(branchId) => {
              const branch = branchById.get(branchId)
              openCreateModal({
                mode: 'create-next',
                branchId,
                branchName: branch?.name,
              })
            }}
            onToggleBranch={(branchId) => setBranchExpanded(branchId, !expandedBranchIds.includes(branchId))}
            onRenameBranch={handleRenameBranch}
            onPreviewDeleteBranch={handlePreviewDeleteBranch}
            onDeleteBranch={handleDeleteBranch}
          />
        )}

        <main className="planning-page__main">
          <section
            className="writer-timeline-canvas flex-1 flex flex-col min-h-0"
            aria-label={text('故事时间轴', 'Story timeline')}
          >
            <div className="writer-timeline-ruler-heading">
              <span>{settings.rulerLabel}</span>
              <small>{settings.rulerUnit}</small>
              <small className="writer-timeline-ruler-hint">
                {text(
                  '拖动平移，滚轮缩放；右键事件或空白处添加、编辑事件。',
                  'Drag to pan, scroll to zoom; right-click events or blank canvas to edit and add events.',
                )}
              </small>
            </div>

            <div className="timeline-workbench__canvas-shell">
              {/* 收起内侧栏后画布占满释放的空间，展开按钮悬浮在画布左缘。 */}
              {sidebarCollapsed && <TimelineSidebarRail onExpand={() => setSidebarCollapsed(false)} />}

              {!isDataReady ? (
                readFailed ? (
                  // 读取失败必须显式重试，绝不伪装成空项目。
                  <div className="timeline-workbench__read-error" data-testid="timeline-read-error">
                    <AlertTriangle size={20} aria-hidden="true" />
                    <h3>{text('读取故事时间线失败', 'Failed to load the story timeline')}</h3>
                    <p>
                      {text(
                        '当前项目的刻度与事件没有被读入，画面上的空画布不代表你的时间线是空的。请重试读取，或确认项目仍然打开。',
                        'This project’s ruler and events were not loaded; the empty canvas does not mean your timeline is empty. Retry the read, or check that the project is still open.',
                      )}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReadFailed(false)
                        void runLoad()
                      }}
                      data-testid="timeline-read-retry"
                    >
                      <RefreshCw size={13} /> {text('重试读取', 'Retry')}
                    </Button>
                  </div>
                ) : (
                  <div className="writer-timeline-empty">
                    {text('正在读取项目时间线…', 'Loading project timeline…')}
                  </div>
                )
              ) : (
                <div
                  ref={flowRef}
                  className="writer-timeline-flow w-full flex-1 min-h-0 relative"
                  data-testid="timeline-flow"
                  onWheelCapture={() => { userZoomGestureRef.current = true }}
                >
                  <StoryTimelineScene
                    key={projectKey}
                    layout={layout}
                    selectedId={selectedId}
                    contentReady={isDataReady}
                    viewportIntent={viewportIntent}
                    initialViewport={storedCanvas ?? undefined}
                    callbacks={{
                      onSelectEvent: handleSelectEvent,
                      onOpenEventFloat: handleOpenEventFloat,
                      onToggleBranch: handleToggleEventBranch,
                      onCanvasContextMenu: handleCanvasContextMenu,
                      onAnchorContextMenu: handleAnchorContextMenu,
                      onOpenRangeEditor: handleOpenRangeEditor,
                      onInteractStart: handleInteractStart,
                      onViewportChange: handleViewportChange,
                    }}
                  />

                  {eventFloat && floatEvent && (
                    <TimelineEventFloat
                      key={`${eventFloat.eventId}:${eventFloat.mode}`}
                      eventId={eventFloat.eventId}
                      point={eventFloat.point}
                      mode={eventFloat.mode}
                      bounds={eventFloat.bounds}
                      event={floatEvent}
                      branchName={(floatEvent.branchId && floatEvent.branchId !== STORY_TIMELINE_MAIN_BRANCH_ID)
                        ? branchNameById.get(floatEvent.branchId) ?? null
                        : null}
                      statusLabel={statusLabel(floatEvent.status)}
                      chapterText={floatEvent.chapterNumbers.length > 0
                        ? floatEvent.chapterNumbers.map(number => text(`第${number}章`, `Ch.${number}`)).join('、')
                        : null}
                      characterNames={floatEvent.characterNames}
                      locationNames={floatEvent.locationNodeIds
                        .map(id => worldMapNodes.find(node => node.id === id)?.name ?? id)}
                      childBranches={floatChildBranches.map(branch => ({ id: branch.id, name: branch.name }))}
                      isExpanded={floatIsExpanded}
                      cascade={floatCascade}
                      callbacks={{
                        onClose: handleFloatClose,
                        onSwitchToEdit: () => setEventFloat(current => (current
                          ? { ...current, mode: 'edit' }
                          : current)),
                        onSaveEvent: handleFloatSave,
                        onDeleteEvent: handleFloatDelete,
                        onCreateBranch: (eventId) => {
                          openCreateModal({ mode: 'create-branch', sourceEventId: eventId })
                        },
                        onCreateNext: (eventId) => {
                          const source = eventById.get(eventId)
                          openCreateModal({
                            mode: 'create-next',
                            sourceEventId: eventId,
                            branchId: source?.branchId || STORY_TIMELINE_MAIN_BRANCH_ID,
                            branchName: source
                              ? branchNameById.get(source.branchId || STORY_TIMELINE_MAIN_BRANCH_ID)
                              : undefined,
                          })
                        },
                        onToggleBranches: handleToggleEventBranch,
                        onNavigateMention: handleNavigateMention,
                      }}
                    />
                  )}

                  {canvasMenu && (
                    <TimelineContextMenu
                      point={canvasMenu.point}
                      bounds={canvasMenu.bounds}
                      suggestedOrder={canvasMenu.suggestedOrder}
                      canCreateEventAtPosition={canvasMenu.canCreate}
                      onClose={() => setCanvasMenu(null)}
                      onCreateMainEvent={(suggestedOrder) => {
                        setCanvasMenu(null)
                        openCreateModal({ mode: 'create-main', suggestedOrder: suggestedOrder ?? nextMainOrder })
                      }}
                      onOpenRangeSettings={(focusField) => {
                        setCanvasMenu(null)
                        setRangeModalFocus(focusField || 'general')
                        setRangeModalOpen(true)
                      }}
                    />
                  )}

                  {anchorMenu && (
                    <TimelineContextMenu
                      point={anchorMenu.point}
                      bounds={anchorMenu.bounds}
                      targetAnchor={anchorMenu.anchor}
                      canCreateEventAtPosition={false}
                      onClose={() => setAnchorMenu(null)}
                      onCreateMainEvent={() => {}}
                      onOpenRangeSettings={(focusField) => {
                        setAnchorMenu(null)
                        setRangeModalFocus(focusField || 'general')
                        setRangeModalOpen(true)
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
      </PlanningPageShell>

      {/* 创建主轴事件 / 后续事件 / 支线的浮层表单 */}
      <TimelineEventModal
        open={createModal !== null}
        mode={createModal?.mode ?? 'create-main'}
        sourceEvent={modalSourceEvent}
        currentBranchName={createModal?.branchName
          ?? (modalSourceEvent && (modalSourceEvent.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) !== STORY_TIMELINE_MAIN_BRANCH_ID
            ? branchNameById.get(modalSourceEvent.branchId ?? '')
            : undefined)}
        nextSortOrder={nextMainOrder}
        initialSortOrder={createModal?.suggestedOrder}
        storyRange={{
          startOrder: layout.range.startOrder,
          endOrder: layout.range.endOrder,
        }}
        onClose={() => setCreateModal(null)}
        onSave={handleModalSave}
      />

      {/* 故事范围与刻度设置弹窗 */}
      <TimelineRangeModal
        open={rangeModalOpen}
        settings={settings}
        events={events}
        initialFocusField={rangeModalFocus}
        onClose={() => setRangeModalOpen(false)}
        onSave={async (newSettings) => {
          await saveSettings(newSettings)
        }}
      />
    </>
  )
}
