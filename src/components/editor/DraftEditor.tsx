import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Search, Upload, Save, FileText, Wrench, Check, Link2, Bookmark,
  ChevronLeft, ChevronRight, BookOpen, Layers,
} from 'lucide-react'

import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler, useEditorStore } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import VditorProseEditor, {
  type ForeshadowingSelectionInfo,
  type VditorProseEditorRef,
} from './VditorProseEditor'
import type { ForeshadowingRecord } from '../../shared/foreshadowing'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import {
  parseDraftMeta,
  type DraftMeta,
  type DraftStatus,
  type FrozenDraftSourceIdentity,
} from '../../services/workflows/chapter-workflow'
import { getReviewsForVersion } from '../../services/draft-index'
import { ipc } from '../../services/ipc-client'
import { requireIpcSuccess } from '../../services/ipc-result'
import { publishChapterSnapshot, retryFinalizationPublication } from '../../services/finalization-client'
import { captureFinalizationSnapshot } from '../../services/finalization-snapshot'

import { DRAFT_STATUS_LABEL, DRAFT_STATUS_COLOR } from '../../shared/draft-status'
import { countDraftUnits } from '../../shared/draft-units'
import { globalEventBus } from '../../shared/event-bus'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'
import { readDraftBody } from '../../stores/draft-store'
import { recordLastCreationLocation } from '../../services/last-creation-location'
import { BlueprintBindingDialog } from '../panels/sidebar/BlueprintBindingDialog'
import { openBuiltinEditor, openChapterFile } from '../panels/sidebar/sidebar-file-openers'
import {
  boundBlueprintChapterNumber,
  loadChapterContext,
  type ChapterContextState,
} from '../../services/chapter-context'
import {
  draftEditorPositionKey,
  takeDraftEditorPosition,
} from '../../services/draft-editor-position'
import { useWidthBucket } from '../../hooks/useResponsiveWorkbenchLayout'
import ChapterContextSidebar from './ChapterContextSidebar'
import './chapter-context.css'
import './draft-chapter-chrome.css'

const DRAFT_STATUS_EN: Record<string, string> = {
  draft: 'Draft',
  revised: 'Revised',
  reviewed: 'Reviewed',
  finalized: 'Published',
  archived: 'Archived',
}

const FORESHADOWING_PRESET_TYPES = ['埋伏', '呼应', '线索', '收尾', '悬念']
const FORESHADOWING_COLOR_OPTIONS = [
  { value: 'blue', names: ['浅蓝', 'Blue'], bg: 'rgba(59, 130, 246, 0.25)', border: '#3b82f6' },
  { value: 'red', names: ['浅红', 'Red'], bg: 'rgba(239, 68, 68, 0.25)', border: '#ef4444' },
  { value: 'yellow', names: ['浅黄', 'Yellow'], bg: 'rgba(234, 179, 8, 0.25)', border: '#eab308' },
  { value: 'green', names: ['浅绿', 'Green'], bg: 'rgba(34, 197, 94, 0.25)', border: '#22c55e' },
  { value: 'purple', names: ['浅紫', 'Purple'], bg: 'rgba(168, 85, 247, 0.25)', border: '#a855f7' },
]

interface Props {
  tabId: string
  filePath: string
  content: string
  projectKey: string
}

/**
 * 草稿编辑器
 * — 顶部工具栏：草稿状态、保存、只读一致性审核与定稿
 * — 正文：Vditor 即时渲染（IR）编辑器，可在 IR / 所见即所得 / 分屏预览间切换
 */
export default function DraftEditor(props: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const projectSession = captureProjectSession(currentProject)
  const sessionKey = projectSession && isProjectSessionPath(projectSession, props.projectKey)
    ? `${projectSession.projectId}:${projectSession.leaseId}`
    : `inactive:${props.projectKey}`

  // 同一路径重新打开会生成新 lease；用会话键重挂载，避免旧会话的本地 UI 状态短暂显示。
  return <DraftEditorSession key={sessionKey} {...props} />
}

/**
 * 「本章创作上下文」的身份键：项目路径 + 草稿 ID。
 *
 * 生产端（跳转前读取）与消费端（渲染判断）必须算出逐字相同的键，因此统一走
 * 这个函数，避免路径大小写或分隔符写法不同导致侧栏卡在加载态。
 */
function chapterContextIdentityKey(projectKey: string, draftId: number): string {
  return `${projectKey}::${draftId}`
}

function DraftEditorSession({ tabId, filePath, content, projectKey }: Props) {
  // 从系统读取草稿元数据与章节标题
  const [meta, setMeta] = useState<(DraftMeta & { chapterTitle?: string; filePath?: string }) | null>(null)
  const editorTab = useEditorStore(
    state => state.tabs.find(tab => tab.id === tabId && tab.projectKey === projectKey),
  )
  const currentProject = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const projectMatches = currentProject?.path === projectKey
  const tabDraftStatus = editorTab?.draftStatus
  const [reviewCount, setReviewCount] = useState(0)
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false)
  /**
   * 绑定变更计数。
   *
   * 绑定对话框保存成功后，草稿的 `blueprint_chapter_number` 已在数据库里变化，
   * 但本组件持有的 meta 是快照；递增它让 meta 与上下文重新读取。
   */
  const [bindingRevision, setBindingRevision] = useState(0)

  // ===== 本章创作上下文侧栏 =====
  const widthBucket = useWidthBucket()
  /** 只有宽屏才内联展开；中窄屏改为抽屉，绝不挤压正文宽度。 */
  const chapterContextAsDrawer = widthBucket !== 'wide'
  const chapterContextPreference = useLayoutStore(s => s.chapterContextOpen)
  const setChapterContextOpen = useLayoutStore(s => s.setChapterContextOpen)
  /**
   * 作者没表态时按宽度决定：宽屏展开、窄屏收起。
   * 窄屏下抽屉会覆盖工具栏与正文，不能在作者没要求时自己弹出来。
   */
  const chapterContextOpen = chapterContextPreference ?? !chapterContextAsDrawer
  /**
   * 已加载的上下文连同它的身份键。
   *
   * 键包含项目会话与草稿 ID：切章、切项目后即使旧请求刚回来，也因键不匹配
   * 而不会显示上一章的内容。
   */
  const [chapterContext, setChapterContext] = useState<{ key: string; state: ChapterContextState } | null>(null)

  /**
   * 回到正文时要还原的编辑位置。
   *
   * 位置在跳转前由编辑器记入内存；这里在同一挂载生命周期内只取一次，
   * 取走即清空，避免作者之后主动滚动时又被拉回旧位置。
   */
  const [restorePosition, setRestorePosition] = useState<
    (NonNullable<ReturnType<typeof takeDraftEditorPosition>> & { requestId: number }) | null
  >(null)
  const restoreRequestedRef = useRef(false)

  // ===== 伏笔管理与正文标注状态 =====
  const proseEditorRef = useRef<VditorProseEditorRef | null>(null)
  const [foreshadowings, setForeshadowings] = useState<ForeshadowingRecord[]>([])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createCandidate, setCreateCandidate] = useState<ForeshadowingSelectionInfo | null>(null)
  const [createNote, setCreateNote] = useState('')
  const [createMarkerType, setCreateMarkerType] = useState('埋伏')
  const [createColor, setCreateColor] = useState('blue')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const foreshadowingDraftId = meta?.id

  const loadForeshadowings = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey) || !foreshadowingDraftId) return
    try {
      const list = await ipc.invokeWithProjectSession(
        projectSession,
        'db:foreshadowing-list-by-draft',
        foreshadowingDraftId,
        projectSession.projectPath,
      )
      if (isProjectSessionCurrent(projectSession) && Array.isArray(list)) {
        setForeshadowings(list)
      }
    } catch (err) {
      console.error('Failed to load foreshadowings for draft', err)
    }
  }, [currentProject, foreshadowingDraftId, projectKey])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadForeshadowings() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadForeshadowings])

  useEffect(() => {
    return globalEventBus.on('FORESHADOWING_UPDATED', () => {
      loadForeshadowings()
    })
  }, [loadForeshadowings])

  const handleToolbarMarkForeshadowing = () => {
    const res = proseEditorRef.current?.getSelectionInfo()
    if (!res || !res.success) {
      if (res?.reason === 'ambiguous') {
        toast.warning(res.message || text('所选文字存在多个位置，请缩短选择范围或重新选择', 'The selected text appears in multiple locations. Please narrow your selection or reselect.'))
      } else if (res?.reason === 'not_found') {
        toast.warning(res.message || text('未在正文中找到所选文字，请重新选择', 'The selected text was not found in the prose. Please reselect.'))
      } else {
        toast.warning(text('请先在正文中选中要标记为伏笔的文字', 'Please select text in the prose to mark as foreshadowing first'))
      }
      return
    }
    setCreateCandidate(res.info)
    setCreateNote('')
    setCreateMarkerType('埋伏')
    setCreateColor('blue')
    setCreateDialogOpen(true)
  }

  const handleBubbleMarkForeshadowing = (info: ForeshadowingSelectionInfo) => {
    if (!info || !info.selectedText.trim()) {
      toast.warning(text('请先在正文中选中要标记为伏笔的文字', 'Please select text in the prose to mark as foreshadowing first'))
      return
    }
    setCreateCandidate(info)
    setCreateNote('')
    setCreateMarkerType('埋伏')
    setCreateColor('blue')
    setCreateDialogOpen(true)
  }

  const handleToggleForeshadowingCompleted = async (id: string, completed: boolean) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    try {
      const res = await ipc.invokeWithProjectSession(
        projectSession,
        'db:foreshadowing-toggle-completed',
        id,
        completed,
        projectSession.projectPath,
      )
      if (res.success) {
        toast.success(completed ? text('伏笔已标记为完成', 'Foreshadowing marked completed') : text('伏笔已恢复为未完成', 'Foreshadowing reopened'))
        globalEventBus.emit('FORESHADOWING_UPDATED', { projectPath: projectKey, projectSession, draftId: meta?.id })
        loadForeshadowings()
      } else {
        toast.error(res.error || text('操作失败', 'Action failed'))
      }
    } catch (e) {
      toast.error(String(e))
    }
  }

  const handleOpenForeshadowingManager = () => {
    useEditorStore.getState().openFile({
      id: 'foreshadowing-manager',
      name: text('伏笔管理', 'Foreshadowings'),
      type: 'foreshadowing',
      filePath: 'builtin://foreshadowing',
      projectKey,
    })
  }

  const handleConfirmCreateForeshadowing = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !currentProject || !meta || !projectSession || !isProjectSessionPath(projectSession, projectKey) || !createCandidate) return

    if (!createNote.trim()) {
      toast.warning(text('请填写伏笔说明', 'Please enter a note'))
      return
    }

    setCreateSubmitting(true)
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:foreshadowing-create',
        {
          draftId: meta.id,
          chapterNumber: meta.chapterNumber,
          selectedText: createCandidate.selectedText,
          startOffset: createCandidate.startOffset,
          endOffset: createCandidate.endOffset,
          contextBefore: createCandidate.contextBefore,
          contextAfter: createCandidate.contextAfter,
          note: createNote.trim(),
          markerType: createMarkerType.trim() || '埋伏',
          color: createColor,
        },
        projectSession.projectPath,
      )

      if (!result.success) {
        toast.error(result.error || text('创建伏笔失败', 'Failed to create foreshadowing'))
      } else {
        toast.success(text('已标记为伏笔', 'Foreshadowing marked'))
        setCreateDialogOpen(false)
        setCreateCandidate(null)
        globalEventBus.emit('FORESHADOWING_UPDATED', {
          projectPath: projectKey,
          projectSession,
          draftId: meta.id,
        })
        loadForeshadowings()
      }
    } finally {
      setCreateSubmitting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const projectSession = captureProjectSession(currentProject)
      if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
      const m = await parseDraftMeta(filePath, projectKey, projectSession)
      if (cancelled || !isProjectSessionCurrent(projectSession) || !m) return
      const bps = await ipc.invokeWithProjectSession(
        projectSession,
        'db:blueprint-list-summary',
        projectSession.projectPath,
      )
      if (cancelled || !isProjectSessionCurrent(projectSession)) return
      const bp = Array.isArray(bps) ? bps.find((b: unknown) => (
        b as { chapterNumber?: number }
      ).chapterNumber === (m.blueprintChapterNumber ?? m.chapterNumber)) : null
      setMeta({ ...m, chapterTitle: m.chapterTitle || (bp ? (bp as { title?: string }).title : undefined), filePath, fileName: `v${m.version}`, createdAt: m.updatedAt ?? m.createdAt })
      useEditorStore.setState(state => ({ tabs: state.tabs.map(tab => {
        if (tab.id !== tabId || tab.projectKey !== projectKey || (tab.draftStatus === m.status && !bindingRevision)) return tab
        const title = m.chapterTitle || (bp as { title?: string } | null)?.title || ''
        return { ...tab, draftStatus: m.status, proseDirectoryKind: m.status === 'finalized' ? 'manuscript' as const : 'draft' as const,
          filePath: `vela://${m.status === 'finalized' ? 'manuscript' : 'draft'}/${m.id}`,
          name: text(`第 ${m.displayNumber ?? m.chapterNumber} 章 ${title} v${m.version}`, `Chapter ${m.displayNumber ?? m.chapterNumber} ${title} v${m.version}`) }
      }) }))
      // 回到正文时还原编辑位置：位置在跳转前或上次卸载时记录，取走即不再复用。
      // 键一律用本 Tab 的 projectKey（而不是会话里的写法）：路径大小写或分隔符
      // 不同也会被会话门判为同一项目，用同一个字符串才能命中同一条记忆。
      if (!restoreRequestedRef.current) {
        restoreRequestedRef.current = true
        const position = takeDraftEditorPosition(draftEditorPositionKey(projectKey, m.id))
        if (position) setRestorePosition({ ...position, requestId: 1 })
      }
      // 使用 DB 化的虚拟 chapterDir（用于 draft-index 兼容层解析章节号）
      const chapterDir = `vela://draft/ch${m.chapterNumber}`
      // 检查审稿报告
      const reviews = await getReviewsForVersion(chapterDir, m.version, projectKey)
      if (!cancelled && isProjectSessionCurrent(projectSession)) setReviewCount(reviews.length)
    }
    load()

    // 数据刷新由 ProjectService 统一处理（FINALIZE_COMPLETE 事件驱动 Store 更新后组件自动重渲染）

    return () => {
      cancelled = true
    }
  }, [bindingRevision, currentProject, filePath, projectKey, tabId, text])

  useEffect(() => globalEventBus.on('REFRESH_RESOURCE', payload => {
    if (!isProjectSessionCurrent(payload.projectSession) || !isProjectSessionPath(payload.projectSession, projectKey)) return
    if (!payload.resources.some(resource => ['all', 'drafts', 'blueprints'].includes(resource))) return
    const binding = payload.blueprintBinding
    if (binding) {
      setMeta(previous => previous?.id === binding.draftId
        ? { ...previous, blueprintChapterNumber: binding.blueprintChapterNumber ?? undefined }
        : previous)
      // 立即隐藏旧上下文；只替换绑定元数据，正文与未保存输入保持原样。
      if (binding.draftId === meta?.id) setChapterContext(null)
    }
    setBindingRevision(revision => revision + 1)
  }), [meta?.id, projectKey])

  const status: DraftStatus = tabDraftStatus ?? meta?.status ?? 'draft'
  const isReadonly = status === 'archived'

  /**
   * 当前上下文身份键。
   *
   * 回答的是「这是哪一份草稿」：项目路径 + 草稿 ID。切章、切项目后旧结果都因
   * 键不匹配被丢弃；同一目录重开会话（新租约）则由外层按会话键重挂载本组件
   * 加 isProjectSessionCurrent 校验兜住。未拿到 meta 时为 null，此时侧栏停在
   * 加载态而不是展示旧内容。
   */
  const chapterContextKey = meta
    && isProjectSessionPath(captureProjectSession(currentProject), projectKey)
    ? chapterContextIdentityKey(projectKey, meta.id)
    : null

  // 读取本章上下文：严格以草稿绑定的蓝图章号为准，未绑定就只显示未绑定状态。
  useEffect(() => {
    if (!meta) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const key = chapterContextIdentityKey(projectKey, meta.id)
    let cancelled = false
    void loadChapterContext(projectSession, meta).then(state => {
      if (cancelled || !isProjectSessionCurrent(projectSession)) return
      // 会话失效返回 status='session-lost'，同样不进入侧栏内容。
      setChapterContext({ key, state })
    })
    return () => { cancelled = true }
  }, [currentProject, meta, projectKey])

  /** 身份键不匹配时一律按加载中处理，杜绝上一章内容短暂闪现。 */
  const chapterContextState: ChapterContextState = meta
    ? (chapterContext && chapterContextKey && chapterContext.key === chapterContextKey
        ? chapterContext.state
        : { status: 'loading' })
    : { status: 'loading' }

  /**
   * 跳转到当前草稿的蓝图 / 章内场景画布。
   *
   * 用草稿绑定的章号而不是草稿自身章号：作者绑定哪一章的蓝图，就打开哪一章。
   * 跳转前先把光标与滚动位置记下来，返回正文时由编辑器还原；这里只做导航，
   * 不触发任何保存。
   */
  const openChapterCardSurface = useCallback((view: 'blueprint' | 'canvas') => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const targetChapterNumber = boundBlueprintChapterNumber(meta)
    if (targetChapterNumber === null) return
    // 此刻正文还在文档里，位置记录最准；失败也不影响跳转本身。
    proseEditorRef.current?.rememberPosition()
    openBuiltinEditor(
      'chapter-card-editor',
      text('章节蓝图', 'Chapter blueprints'),
      'chapter-card',
      undefined,
      targetChapterNumber,
      view,
    )
  }, [meta, projectKey, text])

  /** 记录编辑位置用的键；草稿身份未就绪时不记录，避免把位置写到别的草稿上。 */
  const editorPositionMemoryKey = meta ? draftEditorPositionKey(projectKey, meta.id) : undefined

  // 检查是否有相关章节工作流正在运行
  // ✅ 只订阅 activeRuns，不订阅 globalLogs 等高频更新字段
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const activeChapterRun = activeRuns.find(r =>
    r.projectPath === projectKey
    && r.type === 'chapter_creation'
    && meta
    && (r.title.includes(`第${meta.chapterNumber}章`) || r.title.includes(`第 ${meta.chapterNumber} 章`))
  )
  const isChapterBusy = !!activeChapterRun

  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'review' | null>(null)
  // 审稿维度多选（聚焦 4 类核心问题）
  const REVIEW_DIMS = [
    {
      key: 'blueprint_unfulfilled',
      label: text('蓝图未兑现', 'Blueprint unfulfilled'),
      desc: text('蓝图规划的关键事件、出场人物、小目标正文未体现', 'Planned events, characters, or goals not reflected in prose'),
      promptLabel: '蓝图未兑现',
    },
    {
      key: 'unauthorized_events',
      label: text('正文未授权事件', 'Unauthorized prose events'),
      desc: text('正文中出现了蓝图未记录的重大事件或新设定', 'Major unrecorded events or setting additions in prose'),
      promptLabel: '正文未授权新增事件',
    },
    {
      key: 'conflict',
      label: text('设定/地图/状态冲突', 'Setting/map/state conflicts'),
      desc: text('角色状态、据点属性、战力、前后文规则矛盾', 'Character state, location attributes, rules contradictions'),
      promptLabel: '设定/地图/状态冲突',
    },
    {
      key: 'evidence',
      label: text('证据链审查', 'Evidence check'),
      desc: text('无法从正文或蓝图中找到支撑结论的段落需明确提示', 'Explicitly flag assertions without concrete text evidence'),
      promptLabel: '证据不足',
    },
  ]
  const [reviewDims, setReviewDims] = useState<Record<string, boolean>>(
    Object.fromEntries(REVIEW_DIMS.map(d => [d.key, true]))
  )
  const [charCount, setCharCount] = useState(0)
  const isDirty = editorTab?.dirty ?? false
  const finalizationPending = editorTab?.finalizationPublication === 'pending'
  const finalizationConflict = editorTab?.finalizationConflict
  const currentBodyRef = useRef(content)
  const referencePanelOpen = useLayoutStore((s) => s.referencePanelOpen)
  const toggleReferencePanel = useLayoutStore((s) => s.toggleReferencePanel)
  const chapterJumpPending = useRef(false)

  /** 保存（vela://draft/ 走 DB，其他走 FS） */
  const doSave = async (draftContent: string) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const targetTab = useEditorStore.getState().tabs.find(
      tab => tab.id === tabId && tab.projectKey === projectKey,
    )
    if (
      !targetTab
      || targetTab.draftStatus === 'archived'
      || status === 'archived'
    ) return
    const saveSnapshot = {
      content: targetTab.content ?? draftContent,
      contentRevision: targetTab.contentRevision ?? 0,
    }
    setSaving(true)
    try {
      if (filePath.startsWith('vela://draft/') || filePath.startsWith('vela://manuscript/')) {
        const prefix = filePath.startsWith('vela://draft/') ? 'vela://draft/' : 'vela://manuscript/'
        const draftId = parseInt(filePath.replace(prefix, ''))
        const result = await ipc.invokeWithProjectSession(
          projectSession,
          'db:draft-update-content',
          draftId,
          saveSnapshot.content,
          countDraftUnits(saveSnapshot.content),
          projectSession.projectPath,
        )
        if (!result.success) throw new Error(result.error || text('草稿保存失败', 'Could not save the draft'))
        // 真实保存完成 → 记录“上次创作位置”（只写导航辅助，不动权威数据）。
        const resumeChapterNumber = targetTab.chapterNumber ?? meta?.chapterNumber
        if (Number.isSafeInteger(resumeChapterNumber) && (resumeChapterNumber as number) > 0) {
          recordLastCreationLocation(projectSession.projectPath, {
            kind: 'draft',
            chapterNumber: resumeChapterNumber as number,
            title: meta?.chapterTitle || targetTab.name,
            savedAt: new Date().toISOString(),
            draftId,
          })
        }
        if (status === 'finalized' && meta) {
          const snapshot = captureFinalizationSnapshot({
            tab: { ...targetTab, content: saveSnapshot.content },
            projectSession,
            chapterTitle: meta.chapterTitle ?? '',
          })
          const publication = await publishChapterSnapshot(snapshot)
          if (!publication.success) throw new Error(publication.error || text('正文同步失败', 'Could not sync the manuscript'))
        }
      } else {
        requireIpcSuccess(
          await ipc.invokeWithProjectSession(
            projectSession,
            'fs:write-file',
            filePath,
            saveSnapshot.content,
            projectSession.projectPath,
          ),
          '保存草稿文件',
        )
      }
      if (!isProjectSessionCurrent(projectSession)) return
      const currentTab = useEditorStore.getState().tabs.find(
        tab => tab.id === tabId && tab.projectKey === projectKey,
      )
      if (currentTab) {
        useEditorStore.getState().settleTabSave(currentTab.id, saveSnapshot)
      }
    } finally {
      if (isProjectSessionCurrent(projectSession)) setSaving(false)
    }
  }

  const exitSaveRef = useRef(doSave)
  useEffect(() => {
    exitSaveRef.current = doSave
  })
  useEffect(() => {
    registerEditorExitSaveHandler({
      tabId,
      type: 'chapter',
      projectKey,
      save: () => exitSaveRef.current(currentBodyRef.current),
    })
  }, [projectKey, tabId])

  /** 卷章快速切换：保存当前草稿并跳转至目标章节草稿 */
  const handleJumpChapter = async (direction: number) => {
    if (!meta || chapterJumpPending.current) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    chapterJumpPending.current = true
    try {
      if (useEditorStore.getState().tabs.find(tab => tab.id === tabId)?.dirty) {
        await doSave(currentBodyRef.current)
      }
      if (!isProjectSessionCurrent(projectSession)) return
      // 保存期间继续输入时留在当前章，不把新输入误认为已保存。
      if (useEditorStore.getState().tabs.find(tab => tab.id === tabId)?.dirty) return
      const order = await ipc.invokeWithProjectSession(projectSession, 'db:prose-order', projectSession.projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      const all = await ipc.invokeWithProjectSession(projectSession, 'db:draft-list-all', projectSession.projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      const entries = (order ?? []).filter(row => all.some(draft => draft.chapterNumber === row.chapterNumber && (meta.status !== 'finalized' || draft.status === 'finalized')))
      const index = entries.findIndex(row => row.chapterNumber === meta.chapterNumber)
      const targetChapterNumber = entries[index + direction]?.chapterNumber
      if (targetChapterNumber === undefined) return
      const targetDraft = await ipc.invokeWithProjectSession(
        projectSession,
        meta.status === 'finalized' ? 'db:draft-get-finalized' : 'db:draft-get-latest',
        targetChapterNumber,
        projectSession.projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (targetDraft) {
        await openChapterFile(
          `vela://${targetDraft.status === 'finalized' ? 'manuscript' : 'draft'}/${targetDraft.id}`,
          text(`第${targetChapterNumber}章 v${targetDraft.version}`, `Chapter ${targetChapterNumber} v${targetDraft.version}`),
        )
      } else {
        toast.info(text(`未找到第 ${targetChapterNumber} 章的草稿`, `Draft for chapter ${targetChapterNumber} not found`))
      }
    } catch (e) {
      if (isProjectSessionCurrent(projectSession)) toast.error(String(e))
    } finally {
      chapterJumpPending.current = false
    }
  }

  const freezeDraftSourceForAI = async (projectSession: NonNullable<ReturnType<typeof captureProjectSession>>) => {
    if (!meta) return null
    const targetTab = useEditorStore.getState().tabs.find(
      tab => tab.id === tabId && tab.projectKey === projectKey,
    )
    if (!targetTab || (targetTab.draftId !== undefined && targetTab.draftId !== meta.id)) {
      toast.warning(text(
        '当前草稿身份已变化，请重新打开后再执行 AI 操作',
        'The current draft identity changed. Reopen it before running the AI action.',
      ))
      return null
    }
    const body = targetTab.content ?? currentBodyRef.current
    const sourceDraft = Object.freeze({
      id: meta.id,
      chapterNumber: meta.chapterNumber,
      version: meta.version,
      status: targetTab.draftStatus ?? meta.status,
      contentRevision: targetTab.contentRevision ?? 0,
    })

    if (targetTab.dirty) await doSave(body)
    if (!isProjectSessionCurrent(projectSession)) return null
    return Object.freeze({ body, sourceDraft })
  }

  const isFrozenAISourceCurrent = (
    body: string,
    sourceDraft: FrozenDraftSourceIdentity,
  ): boolean => {
    const currentTab = useEditorStore.getState().tabs.find(
      tab => tab.id === tabId && tab.projectKey === projectKey,
    )
    if (
      !currentTab
      || currentTab.content !== body
      || (currentTab.contentRevision ?? 0) !== sourceDraft.contentRevision
      || (currentTab.draftId !== undefined && currentTab.draftId !== sourceDraft.id)
      || (currentTab.chapterNumber !== undefined && currentTab.chapterNumber !== sourceDraft.chapterNumber)
      || (currentTab.draftStatus !== undefined && currentTab.draftStatus !== sourceDraft.status)
    ) {
      toast.warning(text(
        '确认后正文已变化，本次 AI 操作未启动',
        'The draft changed after confirmation, so the AI action was not started.',
      ))
      return false
    }
    return true
  }


  /** 执行 AI 审稿 */
  const doReview = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !currentProject || !meta || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    try {
      const source = await freezeDraftSourceForAI(projectSession)
      if (!source || !isProjectSessionCurrent(projectSession)) return
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createReviewOnlyWorkflow } = await import('../../services/workflows/chapter-workflow')
      if (!isProjectSessionCurrent(projectSession)) return
      if (!isFrozenAISourceCurrent(source.body, source.sourceDraft)) return

      useWorkflowStore.getState().startWorkflow(createReviewOnlyWorkflow({
        projectPath: projectSession.projectPath,
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: source.body,
        sourceDraft: source.sourceDraft,
        reviewFocus: REVIEW_DIMS.filter(d => reviewDims[d.key]).map(d => d.promptLabel).join('、') || undefined,
      }, projectSession), false)
    } catch (e) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(text(`审稿启动失败：${e}`, 'Could not start AI review.'))
    }
  }

  /** 发布到正文；发布只改变归类，不锁定正文。 */
  const doPublish = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !currentProject || !meta || isChapterBusy || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const existingManuscript = await ipc.invokeWithProjectSession(projectSession, 'db:draft-get-finalized', meta.chapterNumber, projectKey).catch(error => { if (isProjectSessionCurrent(projectSession)) toast.error(String(error)); return undefined })
    if (existingManuscript === undefined) return
    if (!isProjectSessionCurrent(projectSession)) return
    const replacing = existingManuscript && existingManuscript.id !== meta.id
    const ok = await confirm(
      text(
        replacing ? `该章已有正文“${existingManuscript.chapterTitle || ''}”。替换为当前草稿吗？旧正文会保留在草稿箱。` : `将这一稿发布到正文吗？正文会按所在位置自动连续编号。`,
        `Publish Chapter ${meta.chapterNumber} to the manuscript?\n\nIt will move to “Manuscript” and remain editable.`,
      ),
      {
        title: text(replacing ? '替换当前正文' : '确认发布', 'Confirm publication'),
        confirmText: text('发布到正文', 'Publish'),
      }
    )
    if (!ok || !isProjectSessionCurrent(projectSession)) return
    try {
      const targetTab = useEditorStore.getState().tabs.find(
        tab => tab.id === tabId && tab.projectKey === projectKey,
      )
      if (!targetTab) {
        throw new Error(text('当前草稿或项目会话已失效，无法发布正文', 'The draft or project session is no longer available.'))
      }
      const snapshot = captureFinalizationSnapshot({
        tab: {
          ...targetTab,
          // 老标签可能尚未填入这两个数据库身份；只能从已解析的当前标签元数据补齐，
          // 正文仍严格取编辑器可见值，不再回读 SQLite。
          draftId: targetTab.draftId ?? meta.id,
          chapterNumber: targetTab.chapterNumber ?? meta.chapterNumber,
          content: targetTab.content ?? currentBodyRef.current,
        },
        projectSession,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        expectedCurrentDraftId: existingManuscript?.id ?? null,
      })
      if (!isProjectSessionCurrent(projectSession)) return
      const result = await publishChapterSnapshot(snapshot)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.committed) throw new Error(result.error || text('正文发布失败', 'Could not publish the manuscript.'))
      useEditorStore.setState(state => ({
        tabs: state.tabs.map(tab => tab.id === snapshot.tabId && tab.projectKey === snapshot.projectPath
          ? {
              ...tab,
              draftId: snapshot.draftId,
              chapterNumber: snapshot.chapterNumber,
              projectSessionLease: snapshot.projectSession.leaseId,
              draftStatus: 'finalized',
              finalizationId: result.finalizationId,
              finalizationPublication: result.publicationStatus,
              finalizationConflict: undefined,
            }
          : tab),
      }))

      globalEventBus.emit('REFRESH_RESOURCE', {
        resources: ['drafts', 'fileTree'],
        projectPath: projectSession.projectPath,
        projectSession,
      })
      toast.success(result.success
        ? text('已发布到正文章节', 'Published to manuscript')
        : text('正文已保存，实体文件将自动重试同步', 'Manuscript saved; its file will retry syncing automatically.'))
    } catch (e) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(text(`正文发布失败：${e}`, 'Could not publish the manuscript.'))
    }
  }

  /** 实体稿失败后只按已提交的 finalizationId 重试；不再交回正文或路径。 */
  const doRetryManuscriptPublication = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const finalizationId = useEditorStore.getState().tabs.find(
      tab => tab.id === tabId && tab.projectKey === projectKey,
    )?.finalizationId
    if (!finalizationId) return
    try {
      const result = await retryFinalizationPublication(finalizationId, projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success) {
          throw new Error(result.error || text('实体稿发布仍未完成', 'Manuscript publication is not complete.'))
      }
      useEditorStore.setState(state => ({
        tabs: state.tabs.map(tab => tab.id === tabId
          && tab.projectKey === projectKey
          && tab.finalizationId === finalizationId
          ? { ...tab, finalizationPublication: 'published' }
          : tab),
      }))
      toast.success(text('实体稿已发布', 'Manuscript published'))
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(text(`实体稿发布失败：${error}`, 'Could not publish the manuscript.'))
    }
  }, [currentProject, projectKey, tabId, text])

  /** 打开最新的审稿报告 */
  const openLatestReview = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!meta || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const chapterDir = `vela://draft/ch${meta.chapterNumber}`
    const { getLatestReview } = await import('../../services/draft-index')
    if (!isProjectSessionCurrent(projectSession)) return
    const latest = await getLatestReview(chapterDir, meta.version, projectKey)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!latest) return

    // 使用 review 的数据库 ID 读取审稿报告内容
    const reportContent = await readDraftBody(`vela://review/${latest.id}`, projectKey, projectSession)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!reportContent) return

    useEditorStore.getState().openFile({
      id: `review-report-${meta.chapterNumber}-${latest.id}`,
      name: text(`审稿报告 v${meta.version}`, `Review report v${meta.version}`),
      type: 'review-report',
      content: reportContent,
      filePath,
      reviewReport: reportContent,
      chapterNumber: meta.chapterNumber,
      chapterDir,
      draftId: meta.id,
      reviewId: latest.id,
      projectKey,
    })
  }

  // 状态色与圆点共用一次取值，避免两处 fallback 走偏
  const statusColor = DRAFT_STATUS_COLOR[status] ?? 'var(--editor-ink-muted, var(--color-text-muted))'

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      {/* 章节栏：左边交代"我在写哪一章"，右边按 改这一章 / 换视角 / 落笔与提交 分三堆 */}
      <div
        className="draft-chapter-bar"
        style={{
          borderColor: 'var(--editor-chrome-line)',
          backgroundColor: 'var(--editor-chrome-bg)',
        }}
      >
        {/* 左：章节身份 */}
        <div className="draft-chapter-identity">
          {meta && (
            <div className="draft-chapter-stepper">
              <button
                type="button"
                onClick={() => handleJumpChapter(-1)}
                disabled={(meta.displayNumber ?? meta.chapterNumber) <= 1}
                className="draft-chapter-step"
                title={text('上一章', 'Previous chapter')}
              >
                <ChevronLeft size={13} />
              </button>
              <span className="draft-chapter-index">
                {text(`第 ${meta.displayNumber ?? meta.chapterNumber} 章`, `Ch. ${meta.displayNumber ?? meta.chapterNumber}`)}
              </span>
              <button
                type="button"
                onClick={() => handleJumpChapter(1)}
                className="draft-chapter-step"
                title={text('下一章', 'Next chapter')}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}

          <span
            className="draft-chapter-title"
            title={meta?.chapterTitle || text('未知标题', 'Untitled')}
          >
            {meta ? (meta.chapterTitle || text('未知标题', 'Untitled')) : text('草稿', 'Draft')}
          </span>

          {meta && <span className="draft-chapter-version">v{meta.version}</span>}

          {/* 状态：语义色圆点 + 文字，直接取自草稿状态表 */}
          <span className="draft-chapter-status" style={{ color: statusColor }}>
            <span className="draft-chapter-status-dot" style={{ backgroundColor: statusColor }} />
            {text(DRAFT_STATUS_LABEL[status] ?? status, DRAFT_STATUS_EN[status] ?? status)}
          </span>

          {/* 关联伏笔指示 */}
          {foreshadowings.length > 0 && (
            <button
              type="button"
              className="draft-chapter-mark"
              onClick={handleOpenForeshadowingManager}
              title={text(`本章已标记 ${foreshadowings.length} 处伏笔，点击查看管理`, `${foreshadowings.length} foreshadowing marks, click to manage`)}
            >
              <Bookmark size={12} />
              <span className="draft-chapter-mark-count">{foreshadowings.length}</span>
            </button>
          )}
        </div>

        {/* 右：改这一章 → 换视角 → 落笔与提交 */}
        {!isReadonly && (
          <div className="draft-chapter-actions">
            {/* 改这一章：伏笔、蓝图与审稿报告 */}
            {meta && (
              <div className="draft-chapter-group">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToolbarMarkForeshadowing}
                  className="draft-action draft-action--quiet"
                  aria-label={text('标记为伏笔', 'Mark as Foreshadowing')}
                  title={text('将选中文本标记为伏笔', 'Mark selected text as foreshadowing')}
                >
                  <Bookmark size={12} />
                  <span className="draft-action-label">{text('标记为伏笔', 'Mark as Foreshadowing')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBindingDialogOpen(true)}
                  className="draft-action draft-action--quiet"
                  aria-label={text('绑定蓝图', 'Link blueprint')}
                  title={text('绑定或更换章节蓝图', 'Link or change the chapter blueprint')}
                >
                  <Link2 size={12} />
                  <span className="draft-action-label">{text('绑定蓝图', 'Link blueprint')}</span>
                </Button>
                {reviewCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openLatestReview}
                    className="draft-action draft-action--report"
                    aria-label={text(`审稿报告(${reviewCount})`, `Review report (${reviewCount})`)}
                    title={text('查看最新审稿报告', 'View the latest review report')}
                  >
                    <FileText size={12} />
                    <span className="draft-action-label">{text(`审稿报告(${reviewCount})`, `Review report (${reviewCount})`)}</span>
                  </Button>
                )}
              </div>
            )}

            {/* 换视角：两个各自独立的两态开关 */}
            <div className="draft-chapter-group">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChapterContextOpen(!chapterContextOpen)}
                aria-expanded={chapterContextOpen}
                aria-controls="chapter-context-panel"
                aria-label={text('本章上下文', 'Chapter context')}
                className={`draft-action draft-action--toggle${chapterContextOpen ? ' is-open' : ''}`}
                title={text(
                  chapterContextOpen ? '收起本章创作上下文' : '展开本章创作上下文（本章蓝图要点与场景顺序）',
                  chapterContextOpen ? 'Collapse chapter writing context' : 'Expand chapter writing context (blueprint goals and scene order)',
                )}
                data-testid="draft-chapter-context-toggle"
              >
                <Layers size={12} />
                <span className="draft-action-label">{text('本章上下文', 'Chapter context')}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleReferencePanel}
                aria-label={text('参考上下文', 'Context')}
                className={`draft-action draft-action--toggle${referencePanelOpen ? ' is-open' : ''}`}
                title={text(
                  referencePanelOpen ? '收起参考上下文' : '展开参考上下文（蓝图/角色/世界设定）',
                  referencePanelOpen ? 'Collapse reference context' : 'Expand reference context (blueprint/characters/worldbuilding)',
                )}
              >
                <BookOpen size={12} />
                <span className="draft-action-label">{text('参考上下文', 'Context')}</span>
              </Button>
            </div>

            <span className="draft-chapter-sep" aria-hidden="true" />

            {/* 落笔与提交 */}
            <div className="draft-chapter-group">
              {/* 字数 */}
              {charCount > 0 && (
                <span
                  className="draft-chapter-count"
                  title={text(`当前字数：${charCount.toLocaleString(locale)}`, `Word count: ${charCount.toLocaleString(locale)}`)}
                >
                  {text(`${charCount.toLocaleString(locale)} 字`, `${charCount.toLocaleString(locale)} words`)}
                </span>
              )}

              {/* 未保存指示呼吸灯 */}
              {isDirty && (
                <span
                  className="draft-chapter-dirty"
                  title={text('有未保存的修改', 'There are unsaved changes')}
                />
              )}

              {finalizationConflict && (
                <span
                  className="draft-chapter-conflict"
                  style={{
                    color: 'var(--color-warning-text)',
                    backgroundColor: 'var(--bg-hover, var(--color-hover))',
                    borderColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
                  }}
                  title={text(
                    '发布完成事件没有覆盖这次编辑；请保存后重新同步正文。',
                    'Publication did not overwrite this edit. Save it and sync the manuscript again.',
                  )}
                >
                  {text('已保留后续编辑', 'Later edits kept')}
                </span>
              )}

              {finalizationPending && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doRetryManuscriptPublication}
                  className="draft-action"
                  title={text('正文已保存、实体文件待同步；重试当前发布记录', 'The manuscript is saved and its file is pending sync. Retry the current publication.')}
                >
                  <Wrench size={12} />
                  {text('重试同步', 'Retry sync')}
                </Button>
              )}

              {/* 保存按钮 */}
              {isDirty && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => doSave(currentBodyRef.current)}
                  disabled={saving}
                  className="draft-action draft-action--save"
                  title={text('保存（⌘S）', 'Save (Ctrl+S)')}
                >
                  <Save size={12} />
                  {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
                </Button>
              )}

              {/* 核心操作：AI 审稿 — 主题色描边，把实心位置让给发布 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction('review')}
                disabled={isChapterBusy}
                className="draft-action draft-action--accent"
                title={text('AI 审稿 — 一致性检查（蓝图兑现/未授权事件/设定冲突/证据链）', 'AI review — Consistency check (blueprint/events/setting conflict/evidence)')}
              >
                <Search size={12} />
                {text('AI 审稿', 'AI review')}
              </Button>

              {/* 核心操作：发布到正文 — 本页唯一的实心强调色按钮 */}
              {status !== 'finalized' && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={doPublish}
                  disabled={isChapterBusy || !!finalizationConflict || finalizationPending}
                  className="draft-action draft-action--primary"
                  title={text('发布到正文（定稿） — 移到正文章节，之后仍可编辑', 'Publish / finalize — move to manuscript and keep editing')}
                >
                  <Upload size={12} />
                  <span>{text('发布到正文', 'Publish')}</span>
                  <span className="sr-only">{text('定稿', 'Finalize')}</span>
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 归档稿显示只读提示 */}
        {isReadonly && (
          <div className="draft-chapter-actions">
            <div className="draft-chapter-group">
              {charCount > 0 && (
                <span className="draft-chapter-count">
                  {text(`${charCount.toLocaleString(locale)} 字`, `${charCount.toLocaleString(locale)} words`)}
                </span>
              )}
              <span className="draft-chapter-status" style={{ color: 'var(--color-text-muted)' }}>
                <span className="draft-chapter-status-dot" style={{ backgroundColor: 'var(--color-text-muted)' }} />
                {text('已归档（只读）', 'Archived (read-only)')}
              </span>
              {finalizationPending && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doRetryManuscriptPublication}
                  className="draft-action"
                  title={text('正文实体文件待同步；重试当前发布记录', 'The manuscript file is pending sync. Retry the current publication.')}
                >
                  <Wrench size={12} />
                  {text('重试同步', 'Retry sync')}
                </Button>
              )}
            </div>

            <span className="draft-chapter-sep" aria-hidden="true" />

            {/* 换视角：只读态下同样可以看上下文 */}
            <div className="draft-chapter-group">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChapterContextOpen(!chapterContextOpen)}
                aria-expanded={chapterContextOpen}
                aria-controls="chapter-context-panel"
                aria-label={text('本章上下文', 'Chapter context')}
                className={`draft-action draft-action--toggle${chapterContextOpen ? ' is-open' : ''}`}
                title={text(
                  chapterContextOpen ? '收起本章创作上下文' : '展开本章创作上下文（本章蓝图要点与场景顺序）',
                  chapterContextOpen ? 'Collapse chapter writing context' : 'Expand chapter writing context (blueprint goals and scene order)',
                )}
                data-testid="draft-chapter-context-toggle"
              >
                <Layers size={12} />
                <span className="draft-action-label">{text('本章上下文', 'Chapter context')}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={toggleReferencePanel}
                aria-label={text('参考上下文', 'Context')}
                className={`draft-action draft-action--toggle${referencePanelOpen ? ' is-open' : ''}`}
                title={text(
                  referencePanelOpen ? '收起参考上下文' : '展开参考上下文（蓝图/角色/世界设定）',
                  referencePanelOpen ? 'Collapse reference context' : 'Expand reference context (blueprint/characters/worldbuilding)',
                )}
              >
                <BookOpen size={12} />
                <span className="draft-action-label">{text('参考上下文', 'Context')}</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 正文区：Markdown 编辑与预览都由 Vditor 承担。
          窄屏下本章上下文以抽屉覆盖呈现，正文宽度不被挤压。 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          <VditorProseEditor
            editorRef={proseEditorRef}
            content={editorTab?.content ?? content}
            editable={!isReadonly && !isChapterBusy}
            placeholder={text('开始写这一章…', 'Start writing this chapter…')}
            onCharCountChange={setCharCount}
            positionMemoryKey={editorPositionMemoryKey}
            restorePosition={restorePosition}
            onChange={(nextContent) => {
              currentBodyRef.current = nextContent
              useEditorStore.getState().updateTabContent(tabId, nextContent)
            }}
            onSave={(nextContent) => doSave(nextContent)}
            foreshadowings={foreshadowings}
            onToggleForeshadowingCompleted={handleToggleForeshadowingCompleted}
            onOpenForeshadowingManager={handleOpenForeshadowingManager}
            onMarkForeshadowing={handleBubbleMarkForeshadowing}
          />
        </div>
        <ChapterContextSidebar
          open={chapterContextOpen}
          onCollapse={() => setChapterContextOpen(false)}
          asDrawer={chapterContextAsDrawer}
          state={chapterContextState}
          onOpenBlueprint={() => openChapterCardSurface('blueprint')}
          onOpenCanvas={() => openChapterCardSurface('canvas')}
          onOpenBindingDialog={() => setBindingDialogOpen(true)}
        />
      </div>

      {/* AI 一致性审核确认弹窗（只读） */}
      <Dialog open={confirmAction !== null} onOpenChange={(v) => !v && setConfirmAction(null)}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search size={15} className="text-[var(--color-accent)]" />
              {text('AI 一致性审核确认', 'Confirm AI consistency audit')}
            </DialogTitle>
            <DialogDescription>
              {text('对象：', 'Target: ')}{meta
                ? `${meta.chapterTitle || text('未知标题', 'Untitled')} v${meta.version}`
                : text('当前草稿', 'Current draft')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-2 text-sm space-y-2" style={{ color: 'var(--color-text-secondary)' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {text('将对本章草稿进行只读一致性审核，绝不会自动修改正文或蓝图。重点检查以下维度：', 'A read-only consistency check will be performed on this draft. It will never modify prose or blueprints. Focus dimensions:')}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              {REVIEW_DIMS.map(d => (
                <label
                  key={d.key}
                  className="flex items-start gap-2 cursor-pointer select-none p-2 rounded-md border text-xs"
                  style={{
                    borderColor: reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-border)',
                    backgroundColor: reviewDims[d.key] ? 'rgba(var(--color-accent-rgb, 99 102 241), 0.08)' : 'transparent',
                  }}
                  onClick={() => setReviewDims(prev => ({ ...prev, [d.key]: !prev[d.key] }))}
                >
                  <div
                    className="w-3.5 h-3.5 mt-0.5 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: reviewDims[d.key] ? 'var(--color-accent)' : 'transparent',
                      border: `1.5px solid ${reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    }}
                  >
                    {reviewDims[d.key] && (
                      <Check size={9} strokeWidth={3} color="white" aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--color-text)' }}>{d.label}</div>
                    <div className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>{d.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>{text('取消', 'Cancel')}</Button>
            <Button
              variant="ai"
              onClick={() => {
                setConfirmAction(null)
                doReview()
              }}
            >
              <Search size={13} />
              {text('开始一致性审核', 'Start consistency check')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BlueprintBindingDialog
        open={bindingDialogOpen}
        onOpenChange={setBindingDialogOpen}
        target={meta ? {
          draftId: meta.id,
          chapterNumber: meta.chapterNumber,
          blueprintChapterNumber: meta.blueprintChapterNumber,
          label: text(`第${meta.chapterNumber}章`, `Chapter ${meta.chapterNumber}`),
        } : null}
      />

      {/* 标记为伏笔轻量对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark size={16} className="text-[var(--color-accent)]" />
              {text('标记为伏笔', 'Mark as Foreshadowing')}
            </DialogTitle>
            <DialogDescription>
              {meta ? text(`归属：第 ${meta.chapterNumber} 章 ${meta.chapterTitle || ''}`, `Chapter ${meta.chapterNumber} ${meta.chapterTitle || ''}`) : ''}
            </DialogDescription>
          </DialogHeader>

          {createCandidate && (
            <div className="px-5 py-2 space-y-4 text-xs">
              <div>
                <label className="block text-[var(--color-text-muted)] mb-1 font-medium">
                  {text('选中原文：', 'Selected Text:')}
                </label>
                <div
                  className="p-2.5 rounded-md border italic line-clamp-3 leading-relaxed"
                  style={{
                    backgroundColor: 'var(--color-hover)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  "{createCandidate.selectedText}"
                </div>
              </div>

              <div>
                <label className="block text-[var(--color-text)] mb-1 font-medium">
                  {text('伏笔说明 / 备注 *', 'Foreshadowing Note *')}
                </label>
                <textarea
                  value={createNote}
                  onChange={e => setCreateNote(e.target.value)}
                  placeholder={text('记录此处的暗线意图、角色伏笔或后续预计呼应的情节…', 'Record clue intent, character setup, or planned callbacks...')}
                  rows={3}
                  className="w-full p-2.5 rounded-md border text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  style={{
                    backgroundColor: 'var(--color-surface, var(--color-bg))',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              <div>
                <label className="block text-[var(--color-text-muted)] mb-1.5 font-medium">
                  {text('标记类型：', 'Marker Type:')}
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {FORESHADOWING_PRESET_TYPES.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                        createMarkerType === preset
                          ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] border-transparent'
                          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
                      }`}
                      onClick={() => setCreateMarkerType(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={createMarkerType}
                  onChange={e => setCreateMarkerType(e.target.value)}
                  placeholder={text('自定义类型…', 'Custom type...')}
                  className="w-full px-2.5 py-1.5 rounded-md border text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  style={{
                    backgroundColor: 'var(--color-surface, var(--color-bg))',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              <div>
                <label className="block text-[var(--color-text-muted)] mb-1.5 font-medium">
                  {text('标记颜色：', 'Highlight Color:')}
                </label>
                <div className="flex items-center gap-2.5">
                  {FORESHADOWING_COLOR_OPTIONS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-all ${
                        createColor === c.value
                          ? 'ring-2 ring-offset-1 ring-[var(--color-accent)] font-semibold'
                          : 'opacity-85 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: c.bg,
                        borderColor: c.border,
                        color: 'var(--color-text)',
                      }}
                      onClick={() => setCreateColor(c.value)}
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.border }} />
                      <span>{text(c.names[0], c.names[1])}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false)
                setCreateCandidate(null)
              }}
              disabled={createSubmitting}
            >
              {text('取消', 'Cancel')}
            </Button>
            <Button
              variant="default"
              onClick={handleConfirmCreateForeshadowing}
              disabled={createSubmitting || !createNote.trim()}
            >
              <Bookmark size={13} />
              {createSubmitting ? text('保存中...', 'Saving...') : text('保存伏笔', 'Save Foreshadowing')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
