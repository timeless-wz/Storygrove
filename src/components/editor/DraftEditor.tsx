import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, BadgeCheck, Save, FileText, Wrench, Check } from 'lucide-react'

import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler, useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import CodeMirrorEditor from './CodeMirrorEditor'
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
import { retryFinalizationPublication } from '../../services/finalization-client'
import { captureFinalizationSnapshot } from '../../services/finalization-snapshot'

import { DRAFT_STATUS_LABEL, DRAFT_STATUS_COLOR } from '../../shared/draft-status'
import { countDraftUnits } from '../../shared/draft-units'
import { PostProcessStatusPanel } from '../ui/PostProcessStatusPanel'
import { getChapterFinalizeScope } from '../../services/workflows/workflow-utils'
import { guardRepairPostProcess } from '../../services/workflow-guards'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'
import { readDraftBody } from '../../stores/draft-store'

const DRAFT_STATUS_EN: Record<string, string> = {
  draft: 'Draft',
  revised: 'Revised',
  reviewed: 'Reviewed',
  finalized: 'Finalized',
  archived: 'Archived',
}

interface Props {
  tabId: string
  filePath: string
  content: string
  projectKey: string
}

/**
 * 草稿编辑器
 * — 顶部工具栏：草稿状态 + 待合并修稿 + AI 修稿(含自定义提示词) / AI 审稿 / 定稿
 * — 正文：CodeMirrorEditor（prose 模式）
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

  // 后处理失败状态（用于控制是否展示修复按钮）
  const [hasProcessFailure, setHasProcessFailure] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const projectSession = captureProjectSession(currentProject)
      if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
      const m = await parseDraftMeta(filePath, projectKey, projectSession)
      if (cancelled || !isProjectSessionCurrent(projectSession) || !m) return
      const bps = await ipc.invokeWithProjectSession(
        projectSession,
        'db:blueprint-get-all',
        projectSession.projectPath,
      )
      if (cancelled || !isProjectSessionCurrent(projectSession)) return
      const bp = Array.isArray(bps) ? bps.find((b: unknown) => (b as { chapterNumber?: number }).chapterNumber === m.chapterNumber) : null
      setMeta({ ...m, chapterTitle: bp ? (bp as { title?: string }).title : undefined, filePath, fileName: `v${m.version}`, createdAt: m.updatedAt ?? m.createdAt })
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
  }, [currentProject, filePath, projectKey])

  const status: DraftStatus = tabDraftStatus ?? meta?.status ?? 'draft'
  const isReadonly = status === 'finalized' || status === 'archived'

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

  /** 保存（vela://draft/ 走 DB，其他走 FS） */
  const doSave = async (draftContent: string) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const targetTab = useEditorStore.getState().tabs.find(
      tab => tab.id === tabId && tab.projectKey === projectKey,
    )
    if (
      !targetTab
      || targetTab.draftStatus === 'finalized'
      || targetTab.draftStatus === 'archived'
      || status === 'finalized'
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

  /** 定稿 */
  const doFinalize = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !currentProject || !meta || isChapterBusy || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const ok = await confirm(
      text(
        `确定要将第 ${meta.chapterNumber} 章定稿吗？\n\n定稿后章节将标记为完成，不再支持修改和重新后处理。`,
        `Finalize Chapter ${meta.chapterNumber}?\n\nIt will be marked complete and can no longer be edited or post-processed again.`,
      ),
      {
        title: text('确认定稿', 'Confirm finalization'),
        confirmText: text('确认定稿', 'Finalize'),
      }
    )
    if (!ok || !isProjectSessionCurrent(projectSession)) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      if (!isProjectSessionCurrent(projectSession)) return
      const targetTab = useEditorStore.getState().tabs.find(
        tab => tab.id === tabId && tab.projectKey === projectKey,
      )
      if (!targetTab) {
        throw new Error(text('当前草稿或项目会话已失效，无法冻结定稿内容', 'The draft or project session is no longer available.'))
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
      })
      if (!isProjectSessionCurrent(projectSession)) return
      useEditorStore.setState(state => ({
        tabs: state.tabs.map(tab => tab.id === snapshot.tabId && tab.projectKey === snapshot.projectPath
          ? {
              ...tab,
              draftId: snapshot.draftId,
              chapterNumber: snapshot.chapterNumber,
              projectSessionLease: snapshot.projectSession.leaseId,
              finalizationConflict: undefined,
            }
          : tab),
      }))

      if (!isProjectSessionCurrent(projectSession)) return
      useWorkflowStore.getState().startWorkflow(createFinalizeWorkflow({
        projectPath: projectSession.projectPath,
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: snapshot.content,
        snapshot,
      }, projectSession), false)
    } catch (e) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(text(`定稿启动失败：${e}`, 'Could not start finalization.'))
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

  /** 修复定稿后处理 — 只重跑失败的步骤 */
  const doRepairFinalize = useCallback(async (stepKey?: string) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectMatches || !currentProject || !meta || isChapterBusy || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    try {
      const guard = await guardRepairPostProcess(meta.chapterNumber, projectKey, projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!guard.ok) {
        toast.error(locale === 'zh-CN'
          ? (guard.message || text('无法执行修复', 'Could not run the repair.'))
          : text('无法执行修复', 'Could not run the repair.'))
        return
      }
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRepairFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      if (!isProjectSessionCurrent(projectSession)) return
      useWorkflowStore.getState().startWorkflow(
        createRepairFinalizeWorkflow(meta.chapterNumber, projectSession.projectPath, projectSession, stepKey),
        false,
      )
    } catch (e) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(text(`修复启动失败：${e}`, 'Could not start the repair.'))
    }
  }, [currentProject, isChapterBusy, locale, meta, projectKey, projectMatches, text])

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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        {/* 左侧：章节标题 + 版本 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
              {meta
                ? text(`第 ${meta.chapterNumber} 章 — ${meta.chapterTitle || '未知标题'}`, `Chapter ${meta.chapterNumber} — ${meta.chapterTitle || 'Untitled'}`)
                : text('草稿', 'Draft')}
          </span>
          {meta && (
            <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              v{meta.version}
            </span>
          )}
        </div>

        {/* 右侧：字数 + 状态 + 待合并 + AI操作 + 定稿 */}
        {!isReadonly && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 字数 */}
            {charCount > 0 && (
              <span className="text-xs tabular-nums mr-1" style={{ color: 'var(--color-text-muted)' }}>
                {text(`${charCount.toLocaleString(locale)} 字`, `${charCount.toLocaleString(locale)} words`)}
              </span>
            )}

            {/* 未保存指示灯 */}
            {isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-0.5"
                style={{ backgroundColor: 'var(--color-warning)' }}
                title={text('有未保存的修改', 'There are unsaved changes')}
              />
            )}

            {/* 保存按钮 */}
            {isDirty && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => doSave(currentBodyRef.current)}
                disabled={saving}
                title={text('保存（⌘S）', 'Save (Ctrl+S)')}
              >
                <Save size={12} />
                {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
              </Button>
            )}

            {/* 状态标签 */}
            <span
              className="text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                backgroundColor: 'var(--color-hover)',
                color: DRAFT_STATUS_COLOR[status] ?? 'var(--color-text-muted)',
              }}
            >
              {text(DRAFT_STATUS_LABEL[status] ?? status, DRAFT_STATUS_EN[status] ?? status)}
            </span>

            {finalizationConflict && (
              <span
                className="text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ color: 'var(--color-warning-text)', backgroundColor: 'var(--color-hover)' }}
                title={text(
                  '定稿完成事件没有覆盖这次编辑；请先处理本地后续修改与已定稿版本的差异。',
                  'Finalization did not overwrite this edit. Resolve the difference between your later local changes and the finalized version first.',
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
                title={text('定稿已提交、实体稿待发布；只重试已提交的发布记录', 'Finalization is submitted and the manuscript is pending publication. Retry only the submitted publication.')}
              >
                <Wrench size={12} />
                {text('重试实体稿', 'Retry manuscript')}
              </Button>
            )}

            {/* Review report */}
            {reviewCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={openLatestReview}
                title={text('查看最新审稿报告', 'View the latest review report')}
              >
                <FileText size={12} />
                {text(`审稿报告(${reviewCount})`, `Review report (${reviewCount})`)}
              </Button>
            )}

            {/* AI 审稿 */}
            <Button
              variant="ai"
              size="sm"
              onClick={() => setConfirmAction('review')}
              disabled={isChapterBusy}
              title={text('AI 审稿 — 一致性检查（蓝图兑现/未授权事件/设定冲突/证据链）', 'AI review — Consistency check (blueprint/events/setting conflict/evidence)')}
            >
              <Search size={12} />
              {text('AI 审稿', 'AI review')}
            </Button>

            {/* 定稿 */}
            <Button
              variant="success"
              size="sm"
              onClick={doFinalize}
              disabled={isChapterBusy || !!finalizationConflict || finalizationPending}
                title={text('定稿 — 确认终稿并写入正文章节', 'Finalize — confirm the final draft and write it to the manuscript')}
            >
              <BadgeCheck size={12} />
                {text('定稿', 'Finalize')}
            </Button>
          </div>
        )}

        {/* 已定稿/归档显示只读提示 */}
        {isReadonly && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {charCount > 0 && (
              <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {text(`${charCount.toLocaleString(locale)} 字`, `${charCount.toLocaleString(locale)} words`)}
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {status === 'finalized'
                ? text('已定稿（只读）', 'Finalized (read-only)')
                : text('已归档（只读）', 'Archived (read-only)')}
            </span>
            {finalizationPending && (
              <Button
                variant="outline"
                size="sm"
                onClick={doRetryManuscriptPublication}
                title={text('定稿已提交、实体稿待发布；只重试已提交的发布记录', 'Finalization is submitted and the manuscript is pending publication. Retry only the submitted publication.')}
              >
                <Wrench size={11} />
                {text('重试实体稿', 'Retry manuscript')}
              </Button>
            )}
            {/* 已定稿 → 有失败项时显示修复定稿按钮 */}
            {status === 'finalized' && meta && hasProcessFailure && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void doRepairFinalize()}
                disabled={isChapterBusy}
                title={text('重新执行失败的后处理步骤（角色卡、知识库等）', 'Retry failed post-processing steps such as character cards and knowledge indexing')}
              >
                <Wrench size={11} />
                {text('修复定稿', 'Repair finalization')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 后处理状态面板（仅定稿草稿显示） */}
      {status === 'finalized' && meta && (
        <div className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <PostProcessStatusPanel
            scope={getChapterFinalizeScope(meta.chapterNumber)}
            onRetry={doRepairFinalize}
            onStatusLoad={setHasProcessFailure}
          />
        </div>
      )}

      {/* 正文区 */}
      <div className="flex-1 overflow-hidden relative">
        <CodeMirrorEditor
          mode="prose"
          content={content}
          filePath={filePath}
          editable={!isReadonly && !isChapterBusy}
          hideStatusBar
          onCharCountChange={setCharCount}
          onChange={(text) => {
            currentBodyRef.current = text
            useEditorStore.getState().updateTabContent(tabId, text)
          }}
          onSave={(text) => doSave(text)}
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
    </div>
  )
}
