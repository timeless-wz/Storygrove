import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  CircleMinus,
  FileCheck2,
  HelpCircle,
  Info,
  ListChecks,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  X,
  BookOpen,
  FileText,
  ExternalLink,
  BookmarkCheck,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { useEditorStore } from '../../stores/editor-store'
import { openBuiltinEditor } from '../panels/sidebar/sidebar-file-openers'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { Textarea } from '../ui/Textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/Dialog'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { ipc } from '../../services/ipc-client'
import { requireIpcSuccess } from '../../services/ipc-result'
import type { ExpectedDraftSource } from '../../shared/ipc-channels'
import { parseChapterGoalReview, type ChapterGoalReview } from '../../shared/chapter-goal-review'
import {
  parseBlueprintReviewEvidence,
  parseChapterBlueprintReview,
  type BlueprintReviewEvidence,
  type ChapterBlueprintReview,
} from '../../shared/chapter-blueprint-review'
import type { BlueprintV2CheckMode } from '../../shared/blueprint-v2'
import {
  createHumanConfirmedReviewSnapshot,
  hasIncludedReviewItems,
  renderHumanConfirmedReviewBrief,
  parseHumanConfirmedReviewSnapshot,
  serializeHumanConfirmedReviewSnapshot,
  type HumanConfirmedReviewItem,
  type HumanConfirmedReviewSnapshot,
} from '../../shared/human-confirmed-review'

/** 审稿问题条目（JSON 格式） */
interface ReviewIssue {
  category: string
  severity: 'error' | 'warning' | 'pass' | 'unknown'
  goalId?: string
  sceneId?: string
  checkId?: string
  checkMode?: BlueprintV2CheckMode
  description: string
  /** 引用的原文片段（有问题时提供） */
  quote?: string
  stableFactKey?: string
  sourceChapter?: number
}

/** AI 返回的 JSON 审稿结构 */
interface ReviewJSON {
  goalReview?: unknown
  items: Array<{
    category: string
    severity: string
    goalId?: string
    sceneId?: string
    checkId?: string
    checkMode?: string
    description: string
    quote?: string
    stableFactKey?: string
    sourceChapter?: number
  }>
  summary: string
  blueprintReview?: unknown
  blueprintEvidence?: unknown
  blueprintReviewUnavailable?: unknown
}

interface ReviewReportProps {
  /** 原始审稿报告文本（JSON 或旧版 markdown） */
  reportText: string
  /** 审稿报告关联的草稿路径（用于触发修稿） */
  draftPath?: string
  /** 章节号 */
  chapterNumber?: number
  /** 章节目录 */
  chapterDir?: string
  /** 原始 AI 审稿报告的数据库 ID；确认快照必须持续指向该记录。 */
  reviewId?: number
  /** 审稿与草稿所属项目。 */
  projectKey: string
}

interface EditableReviewItem extends HumanConfirmedReviewItem {
  id: string
  severity: ReviewIssue['severity']
}

interface ConfirmedChecklist {
  /** The newly appended confirmation row, which is the revision's reviewSourceId. */
  reviewSourceId: number
  content: string
  snapshot: HumanConfirmedReviewSnapshot
}

// ===== 解析器 =====

/** 标准化 severity 值 */
function normalizeSeverity(raw: string): ReviewIssue['severity'] {
  const s = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (s === 'error' || s === 'critical' || s === 'severe') return 'error'
  if (s === 'warning' || s === 'warn' || s === 'minor') return 'warning'
  if (s === 'pass') return 'pass'
  return 'unknown'
}

/** 尝试从文本中提取 JSON（兼容 ```json 包裹） */
function extractJSON(text: string): string | null {
  // 先尝试直接解析
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return trimmed

  // 尝试从 ```json ... ``` 中提取
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) return codeBlockMatch[1].trim()

  // 尝试找第一个 { 和最后一个 }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return null
}

/** 解析审稿报告（优先 JSON，回退到旧版文本解析） */
function parseReport(text: string, fallbackCategory: string): {
  issues: ReviewIssue[]
  summary: string
  goalReview?: ChapterGoalReview
  blueprintReview?: ChapterBlueprintReview
  blueprintEvidence?: BlueprintReviewEvidence
  blueprintReviewUnavailable?: 'corrupt' | 'needs-newer-app' | 'unavailable'
} {
  const jsonStr = extractJSON(text)
  if (jsonStr) {
    try {
      const data = JSON.parse(jsonStr) as ReviewJSON
      if (data.items && Array.isArray(data.items)) {
        const issues: ReviewIssue[] = data.items.map(item => ({
          category: item.category || fallbackCategory,
          severity: normalizeSeverity(item.severity),
          goalId: item.goalId,
          sceneId: item.sceneId,
          checkId: item.checkId,
          checkMode: item.checkMode === 'must' || item.checkMode === 'reference' || item.checkMode === 'forbid'
            ? item.checkMode
            : undefined,
          description: item.description || '',
          quote: item.quote || undefined,
          stableFactKey: item.stableFactKey || undefined,
          sourceChapter: Number.isSafeInteger(item.sourceChapter) && Number(item.sourceChapter) > 0
            ? item.sourceChapter
            : undefined,
        }))
        return {
          issues,
          summary: data.summary || '',
          goalReview: parseChapterGoalReview(data.goalReview) ?? undefined,
          blueprintReview: parseChapterBlueprintReview(data.blueprintReview) ?? undefined,
          blueprintEvidence: parseBlueprintReviewEvidence(data.blueprintEvidence) ?? undefined,
          blueprintReviewUnavailable: data.blueprintReviewUnavailable === 'corrupt'
            || data.blueprintReviewUnavailable === 'needs-newer-app'
            || data.blueprintReviewUnavailable === 'unavailable'
            ? data.blueprintReviewUnavailable
            : undefined,
        }
      }
    } catch {
      // JSON 解析失败，回退到文本解析
    }
  }

  // 回退：旧版 markdown 文本解析（兼容历史数据）
  return parseLegacyReport(text, fallbackCategory)
}

/** 旧版文本解析器（兼容历史审稿报告） */
function parseLegacyReport(text: string, fallbackCategory: string): { issues: ReviewIssue[]; summary: string } {
  const issues: ReviewIssue[] = []
  const lines = text.split('\n')
  let currentCategory = fallbackCategory
  const summaryLines: string[] = []
  let inSummary = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 匹配标题行
    const headingMatch = trimmed.match(/^#{2,3}\s+(.+)/)
    if (headingMatch) {
      const heading = headingMatch[1].replace(/[*_]/g, '')
      if (/总体评价|总结|总评/.test(heading)) {
        inSummary = true
      } else {
        inSummary = false
        currentCategory = heading
      }
      continue
    }

    if (inSummary) {
      summaryLines.push(trimmed.replace(/^[-*]\s*/, ''))
      continue
    }

    // 检测 emoji 严重级别
    let severity: ReviewIssue['severity'] = 'pass'
    if (trimmed.includes('🔴')) severity = 'error'
    else if (trimmed.includes('🟡')) severity = 'warning'
    else if (trimmed.includes('🟢') || trimmed.includes('✅')) severity = 'pass'
    else if (trimmed.startsWith('-') || trimmed.startsWith('*')) severity = 'warning'
    else continue

    const cleanDesc = trimmed
      .replace(/^[-*]\s*/, '')
      .replace(/[🔴🟡🟢✅]\s*/u, '')
      .replace(/\*\*/g, '')

    if (cleanDesc) {
      issues.push({ category: currentCategory, severity, description: cleanDesc })
    }
  }

  return { issues, summary: summaryLines.join(' ') }
}

// ===== 视觉配置 =====

const SEVERITY_META: Record<ReviewIssue['severity'], {
  colorClass: string
  bgClass: string
  borderClass: string
}> = {
  unknown: {
    colorClass: 'text-[var(--color-text-muted)]',
    bgClass: 'bg-[var(--color-bg-elevated)]',
    borderClass: 'border-[var(--color-border)]',
  },
  error: {
    colorClass: 'text-[var(--color-error-text)]',
    bgClass: 'bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]',
    borderClass: 'border-[color-mix(in_srgb,var(--color-error)_30%,transparent)]',
  },
  warning: {
    colorClass: 'text-[var(--color-warning-text)]',
    bgClass: 'bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)]',
    borderClass: 'border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)]',
  },
  pass: {
    colorClass: 'text-[var(--color-success-text)]',
    bgClass: 'bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]',
    borderClass: 'border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]',
  },
}

function severityCopy(
  severity: ReviewIssue['severity'],
  text: (zhCNText: string, enUSText: string) => string,
) {
  switch (severity) {
    case 'unknown':
      return {
        label: text('待核实', 'Needs verification'),
        actionLabel: text('证据不足，不代表通过；默认不修稿', 'Insufficient evidence; not passed or included by default'),
        countLabel: text('待核实', 'unverified'),
      }
    case 'error':
      return {
        label: text('严重问题', 'Critical issue'),
        actionLabel: text('强烈建议修复', 'Strongly recommended to fix'),
        countLabel: text('严重', 'critical'),
      }
    case 'warning':
      return {
        label: text('改进建议', 'Improvement'),
        actionLabel: text('建议酌情修复', 'Consider fixing'),
        countLabel: text('建议', 'suggestions'),
      }
    default:
      return {
        label: text('检查通过', 'Passed'),
        actionLabel: text('无需处理', 'No action needed'),
        countLabel: text('通过', 'passed'),
      }
  }
}

function SeverityIcon({ severity }: { severity: ReviewIssue['severity'] }) {
  if (severity === 'unknown') return <HelpCircle size={14} className="flex-shrink-0 text-[var(--color-text-muted)]" />
  if (severity === 'error') return <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--color-error)' }} />
  if (severity === 'warning') return <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
  return <CheckCircle size={14} className="flex-shrink-0" style={{ color: 'var(--color-success)' }} />
}

function isReviewId(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function editableItemsFromReview(
  issues: ReviewIssue[],
  snapshot: HumanConfirmedReviewSnapshot | null,
): EditableReviewItem[] {
  if (snapshot) {
    return snapshot.items.map((item, index) => ({
      ...item,
      id: item.origin + '-' + (index + 1),
      severity: normalizeSeverity(item.severity),
    }))
  }

  return issues.map((issue, index) => ({
    id: 'ai-' + (index + 1),
    category: issue.category,
    severity: issue.severity,
    description: issue.description,
    ...(issue.quote ? { quote: issue.quote } : {}),
    ...(issue.stableFactKey ? { stableFactKey: issue.stableFactKey } : {}),
    ...(issue.sourceChapter ? { sourceChapter: issue.sourceChapter } : {}),
    ...(issue.goalId ? { goalId: issue.goalId } : {}),
    ...(issue.sceneId ? { sceneId: issue.sceneId } : {}),
    ...(issue.checkId ? { checkId: issue.checkId } : {}),
    ...(issue.checkMode ? { checkMode: issue.checkMode } : {}),
    decision: !issue.goalId && (issue.severity === 'error' || issue.severity === 'warning') ? 'apply' : 'ignore',
    origin: 'ai',
  }))
}

function confirmationSourceReviewId(
  snapshot: HumanConfirmedReviewSnapshot | null,
  reviewId: number | undefined,
): number | undefined {
  return snapshot?.sourceReviewId ?? reviewId
}

function matchesReviewSource(
  source: ExpectedDraftSource,
  draft: { id: number; chapterNumber: number; version: number; status: string },
  content: string,
): boolean {
  return source.id === draft.id
    && source.chapterNumber === draft.chapterNumber
    && source.version === draft.version
    && source.status === draft.status
    && source.content === content
}

/** 审稿报告查看器 */
export default function ReviewReport(props: ReviewReportProps) {
  const snapshot = parseHumanConfirmedReviewSnapshot(props.reportText)
  const reportKey = String(props.reviewId ?? 'untracked')
    + ':' + String(snapshot?.sourceReviewId ?? 'raw')
    + ':' + props.reportText

  // A report tab can update in place. A keyed session resets its editable
  // checklist only when the underlying immutable report changes.
  return <ReviewReportSession key={reportKey} {...props} initialSnapshot={snapshot} />
}

interface ReviewReportSessionProps extends ReviewReportProps {
  initialSnapshot: HumanConfirmedReviewSnapshot | null
}

function ReviewReportSession({
  reportText,
  draftPath,
  chapterNumber,
  chapterDir,
  projectKey,
  reviewId,
  initialSnapshot,
}: ReviewReportSessionProps) {
  const text = useLocaleStore(s => s.text)
  const intentionalMarker = text('【有意安排】', '[Intentional]')
  const parsedReport = parseReport(reportText, text('综合检查', 'General review'))
  const [items, setItems] = useState<EditableReviewItem[]>(() => (
    editableItemsFromReview(parsedReport.issues, initialSnapshot)
  ))
  const [authorGuidance, setAuthorGuidance] = useState(() => initialSnapshot?.authorGuidance ?? '')
  const [confirmed, setConfirmed] = useState<ConfirmedChecklist | null>(() => (
    initialSnapshot && isReviewId(reviewId)
      ? {
        reviewSourceId: reviewId,
        content: reportText,
        snapshot: initialSnapshot,
      }
      : null
  ))
  const [editingChecklist, setEditingChecklist] = useState(() => !initialSnapshot || !isReviewId(reviewId))
  const [checklistError, setChecklistError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [revisionModelId, setRevisionModelId] = useState('')
  const [startingRevision, setStartingRevision] = useState(false)
  const models = useLLMStore(s => s.models).filter(model => model.purposes.includes('generation'))
  const writingLanguage = useProjectStore(s => s.currentProject?.novelConfig.writingLanguage) ?? 'zh-CN'
  const [showLegend, setShowLegend] = useState(false)
  const sourceReviewId = confirmationSourceReviewId(initialSnapshot, reviewId)
  const summary = initialSnapshot?.summary ?? parsedReport.summary
  const goalReview = confirmed?.snapshot.goalReview ?? initialSnapshot?.goalReview ?? parsedReport.goalReview
  const blueprintReview = confirmed?.snapshot.blueprintReview ?? initialSnapshot?.blueprintReview ?? parsedReport.blueprintReview
  const blueprintReviewUnavailable = parsedReport.blueprintReviewUnavailable
  const canManageChecklist = Boolean(draftPath && chapterDir)

  useEffect(() => {
    if (initialSnapshot || !draftPath || !chapterDir || !isReviewId(reviewId)) return

    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    let cancelled = false
    void (async () => {
      const { parseDraftMeta } = await import('../../services/workflows/chapter-workflow')
      if (cancelled || !isProjectSessionCurrent(projectSession)) return
      const draftMeta = await parseDraftMeta(
        draftPath,
        projectSession.projectPath,
        projectSession,
      )
      if (cancelled || !isProjectSessionCurrent(projectSession) || !draftMeta) return

      const latestReview = await ipc.invokeWithProjectSession(
        projectSession,
        'db:review-get-latest',
        draftMeta.id,
        projectSession.projectPath,
      )
      if (cancelled || !isProjectSessionCurrent(projectSession) || !latestReview) return

      const restoredSnapshot = parseHumanConfirmedReviewSnapshot(latestReview.content)
      if (!restoredSnapshot || restoredSnapshot.sourceReviewId !== reviewId) return

      setItems(editableItemsFromReview([], restoredSnapshot))
      setAuthorGuidance(restoredSnapshot.authorGuidance)
      setConfirmed({
        reviewSourceId: latestReview.id,
        content: latestReview.content,
        snapshot: restoredSnapshot,
      })
      setEditingChecklist(false)
    })()

    return () => {
      cancelled = true
    }
  }, [chapterDir, draftPath, initialSnapshot, projectKey, reviewId])

  // 按分类分组
  const categories = new Map<string, EditableReviewItem[]>()
  for (const item of items) {
    const list = categories.get(item.category) || []
    list.push(item)
    categories.set(item.category, list)
  }

  // 统计
  const errorCount = items.filter((i) => i.severity === 'error').length
  const warningCount = items.filter((i) => i.severity === 'warning').length
  const passCount = items.filter((i) => i.severity === 'pass').length
  const unknownCount = items.filter((i) => i.severity === 'unknown').length
  const errorCopy = severityCopy('error', text)
  const warningCopy = severityCopy('warning', text)
  const passCopy = severityCopy('pass', text)

  const updateItem = (itemId: string, patch: Partial<EditableReviewItem>) => {
    setItems(current => current.map(item => item.id === itemId ? { ...item, ...patch } : item))
    setChecklistError(null)
  }

  const addAuthorItem = () => {
    setItems(current => {
      const authorItemCount = current.filter(item => item.origin === 'author').length
      return [
        ...current,
        {
          id: 'author-' + Date.now() + '-' + (authorItemCount + 1),
          category: text('作者补充', 'Author note'),
          severity: 'warning',
          description: '',
          decision: 'apply',
          origin: 'author',
        },
      ]
    })
  }

  const confirmChecklist = async () => {
    if (!draftPath || !chapterDir) {
      setChecklistError(text(
        '此审稿报告未关联到可修稿的草稿，无法确认清单。',
        'This review is not linked to a revisable draft, so its checklist cannot be confirmed.',
      ))
      return
    }
    if (!isReviewId(sourceReviewId)) {
      setChecklistError(text(
        '此审稿报告缺少原始审稿记录，无法确认。请重新运行 AI 审稿。',
        'This review has no source record, so it cannot be confirmed. Run AI review again.',
      ))
      return
    }

    if (items.some(item => item.origin === 'author' && !item.description.trim())) {
      setChecklistError(text(
        '请填写或移除空白的人工问题后再确认。',
        'Fill in or remove blank author-added issues before confirming.',
      ))
      return
    }

    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) {
      setChecklistError(text(
        '当前项目会话已失效，请重新打开该项目后再确认。',
        'The current project session is no longer active. Reopen the project and try again.',
      ))
      return
    }

    setConfirming(true)
    try {
      const { parseDraftMeta } = await import('../../services/workflows/chapter-workflow')
      if (!isProjectSessionCurrent(projectSession)) return
      const draftMeta = await parseDraftMeta(
        draftPath,
        projectSession.projectPath,
        projectSession,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (!draftMeta) {
        setChecklistError(text(
          '找不到关联草稿，无法确认审稿清单。',
          'The associated draft could not be found, so the review checklist cannot be confirmed.',
        ))
        return
      }

      const sourceReview = await ipc.invokeWithProjectSession(
        projectSession,
        'db:review-get-full',
        sourceReviewId,
        projectSession.projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      const { readDraftBody } = await import('../../stores/draft-store')
      const currentDraftContent = await readDraftBody(
        draftPath,
        projectSession.projectPath,
        projectSession,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (
        !sourceReview
        || sourceReview.id !== sourceReviewId
        || sourceReview.baseDraftId !== draftMeta.id
        || !sourceReview.sourceDraft
        || !matchesReviewSource(sourceReview.sourceDraft, draftMeta, currentDraftContent)
      ) {
        setChecklistError(text(
          '源草稿已变化，无法确认这份旧审稿；请重新运行 AI 审稿。',
          'The source draft changed, so this stale review cannot be confirmed. Run AI review again.',
        ))
        return
      }

      const sourceReviewData = parseReport(sourceReview.content, text('综合检查', 'General review'))
      const sourceBlueprintEvidence = sourceReviewData.blueprintEvidence
      const sourceBlueprintReview = sourceReviewData.blueprintReview
      if (sourceBlueprintEvidence) {
        if (draftMeta.blueprintChapterNumber !== sourceBlueprintEvidence.chapterNumber) {
          setChecklistError(text(
            '审查后草稿的蓝图绑定已变化，不能确认这份报告；请重新运行一致性审查。',
            'The draft blueprint binding changed after review. This report cannot be confirmed; run the consistency review again.',
          ))
          return
        }
        const currentBlueprint = await ipc.invokeWithProjectSession(
          projectSession,
          'db:blueprint-v2-get',
          sourceBlueprintEvidence.chapterNumber,
          projectSession.projectPath,
        )
        if (!isProjectSessionCurrent(projectSession)) return
        if (
          !currentBlueprint
          || currentBlueprint.revision !== sourceBlueprintEvidence.revision
          || currentBlueprint.contentHash !== sourceBlueprintEvidence.contentHash
        ) {
          setChecklistError(text(
            '审查依据的蓝图版本已变化，不能确认旧报告；请重新运行一致性审查。',
            'The blueprint version used by this review has changed. Confirming the old report is blocked; run the consistency review again.',
          ))
          return
        }
      }

      const snapshot = createHumanConfirmedReviewSnapshot({
        sourceReviewId,
        sourceDraft: sourceReview.sourceDraft,
        summary,
        authorGuidance,
        ...(goalReview ? { goalReview } : {}),
        ...(sourceBlueprintEvidence ? { blueprintEvidence: sourceBlueprintEvidence } : {}),
        ...(sourceBlueprintReview ? { blueprintReview: sourceBlueprintReview } : {}),
        items: items.map(({
          category, severity, description, quote, stableFactKey, sourceChapter, goalId, sceneId, checkId, checkMode, decision, origin,
        }) => ({
          category,
          severity,
          description,
          ...(quote?.trim() ? { quote: quote.trim() } : {}),
          ...(stableFactKey ? { stableFactKey } : {}),
          ...(sourceChapter ? { sourceChapter } : {}),
          ...(goalId ? { goalId } : {}),
          ...(sceneId ? { sceneId } : {}),
          ...(checkId ? { checkId } : {}),
          ...(checkMode ? { checkMode } : {}),
          decision,
          origin,
        })),
      })
      if (!snapshot) {
        setChecklistError(text(
          '审稿清单包含未填写的分类、问题或严重程度；请补充后再确认。',
          'The checklist has an empty category, issue, or severity. Complete it before confirming.',
        ))
        return
      }

      const reviewIndex = await ipc.invokeWithProjectSession(
        projectSession,
        'db:review-next-index',
        draftMeta.id,
        projectSession.projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      const content = serializeHumanConfirmedReviewSnapshot(snapshot)
      const createResponse = await ipc.invokeWithProjectSession(projectSession, 'db:review-create', {
          baseDraftId: draftMeta.id,
          reviewIndex,
          content,
          expectedSource: sourceReview.sourceDraft,
        }, projectSession.projectPath)
      if (createResponse.errorCode === 'SOURCE_DRAFT_CHANGED') {
        throw new Error(text(
          '确认期间源草稿已变化，清单未保存；请重新运行 AI 审稿。',
          'The source draft changed during confirmation, so the checklist was not saved. Run AI review again.',
        ))
      }
      const createResult = requireIpcSuccess(
        createResponse,
        text('保存确认审稿清单', 'Save confirmed review checklist'),
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (!isReviewId(createResult.id)) {
        throw new Error(text(
          '确认审稿清单未返回记录标识。',
          'The confirmed checklist did not return a record identifier.',
        ))
      }

      setConfirmed({
        reviewSourceId: createResult.id,
        content,
        snapshot,
      })
      setEditingChecklist(false)
      setChecklistError(null)
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      setChecklistError(error instanceof Error
        ? error.message
        : text('确认审稿清单时发生错误。', 'An error occurred while confirming the review checklist.'))
    } finally {
      if (isProjectSessionCurrent(projectSession)) setConfirming(false)
    }
  }

  const openRevision = () => {
    if (!confirmed || editingChecklist) return
    setChecklistError(null)
    if (!hasIncludedReviewItems(confirmed.snapshot)) {
      setChecklistError(text('未纳入任何审稿项，请先修改并重新确认清单。', 'No review items are included. Edit and confirm the checklist first.'))
      return
    }
    const defaultId = useLLMStore.getState().defaultModelId
    setRevisionModelId(models.find(model => model.id === defaultId)?.id ?? models[0]?.id ?? '')
    setRevisionOpen(true)
  }

  const startRevision = async () => {
    if (!confirmed || editingChecklist || !draftPath || startingRevision) return
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    setStartingRevision(true)
    try {
      if (!models.some(model => model.id === revisionModelId)) {
        throw new Error(text('请选择可用于生成的模型。', 'Select a generation model.'))
      }
      const { parseDraftMeta, createRefineFromReviewWorkflow } = await import('../../services/workflows/chapter-workflow')
      const draftMeta = await parseDraftMeta(draftPath, projectSession.projectPath, projectSession)
      const persisted = await ipc.invokeWithProjectSession(projectSession, 'db:review-get-full', confirmed.reviewSourceId, projectSession.projectPath)
      const { readDraftBody } = await import('../../stores/draft-store')
      const body = await readDraftBody(draftPath, projectSession.projectPath, projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      const snapshot = persisted && parseHumanConfirmedReviewSnapshot(persisted.content)
      if (!snapshot || serializeHumanConfirmedReviewSnapshot(snapshot) !== confirmed.content
        || persisted?.id !== confirmed.reviewSourceId || persisted.baseDraftId !== draftMeta?.id
        || !persisted.sourceDraft || !snapshot.sourceDraft
        || !(['id', 'chapterNumber', 'version', 'status', 'content'] as const)
          .every(key => persisted.sourceDraft![key] === snapshot.sourceDraft![key])) {
        throw new Error(text('已保存的确认清单不一致，请重新确认。', 'The saved checklist does not match. Confirm it again.'))
      }
      if (!draftMeta || !matchesReviewSource(snapshot.sourceDraft, draftMeta, body)) {
        throw new Error(text('源草稿已变化，请重新审稿并确认清单。', 'The source draft changed. Review and confirm it again.'))
      }
      const openDraft = useEditorStore.getState().tabs.find(tab => tab.projectKey === projectKey && tab.filePath === draftPath)
      if (openDraft && openDraft.content !== body) {
        throw new Error(text('源草稿有未保存修改，请先保存，再重新审稿并确认清单。', 'The source draft has unsaved edits. Save it, then review and confirm again.'))
      }
      if (!hasIncludedReviewItems(snapshot)) {
        throw new Error(text('未纳入任何审稿项。', 'No review items are included.'))
      }
      if (snapshot.blueprintEvidence) {
        const evidence = snapshot.blueprintEvidence
        const current = draftMeta.blueprintChapterNumber === evidence.chapterNumber
          ? await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-get', evidence.chapterNumber, projectSession.projectPath)
          : null
        if (!isProjectSessionCurrent(projectSession)) return
        if (!current || current.revision !== evidence.revision || current.contentHash !== evidence.contentHash) {
          throw new Error(text('审查依据的蓝图版本已变化，请重新审稿。', 'The reviewed blueprint changed. Run review again.'))
        }
      }
      if (!isProjectSessionCurrent(projectSession)) return
      await useWorkflowStore.getState().startWorkflow(createRefineFromReviewWorkflow({
        projectPath: projectSession.projectPath,
        chapterNumber: draftMeta.chapterNumber,
        chapterTitle: draftMeta.chapterTitle ?? '',
        draftPath,
        draftContent: body,
        confirmedReviewContent: confirmed.content,
        reviewSourceId: confirmed.reviewSourceId,
        generationModelId: revisionModelId,
      }, projectSession), false)
      if (isProjectSessionCurrent(projectSession)) setRevisionOpen(false)
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      setRevisionOpen(false)
      setChecklistError(error instanceof Error ? error.message : text('修稿启动失败。', 'Could not start revision.'))
    } finally {
      setStartingRevision(false)
    }
  }

  const jumpToDraft = async () => {
    if (!draftPath) {
      toast.error(text('该审稿报告未关联正文草稿', 'No draft linked to this review report'))
      return
    }
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const { readDraftBody } = await import('../../stores/draft-store')
    const draftContent = await readDraftBody(draftPath, projectKey, projectSession)
    if (!isProjectSessionCurrent(projectSession)) return
    useEditorStore.getState().openFile({
      id: draftPath,
      name: text(`第${chapterNumber ?? ''}章草稿`, `Chapter ${chapterNumber ?? ''} Draft`),
      type: 'chapter',
      filePath: draftPath,
      content: draftContent,
      savedContent: draftContent,
      chapterNumber,
      projectKey,
    })
    toast.success(text('已定位至正文草稿', 'Navigated to draft'))
  }

  const jumpToBlueprint = () => {
    openBuiltinEditor(
      'chapter-card-editor',
      text('章节蓝图', 'Chapter blueprints'),
      'chapter-card',
      undefined,
      chapterNumber,
    )
    toast.success(text('已定位至章节蓝图', 'Navigated to blueprint'))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-4">
        {/* 统计栏 */}
        <div className="flex items-center gap-4 mb-4 pb-3 border-b border-[var(--color-border)]">
          <h3 className="text-base font-bold text-[var(--color-text)]">{text('审稿报告', 'Review report')}</h3>
          <div className="flex items-center gap-3 text-xs ml-auto">
            {errorCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-error)_20%,transparent)] text-[var(--color-error-text)]">
                <SeverityIcon severity="error" /> {errorCount} {errorCopy.countLabel}
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)] text-[var(--color-warning-text)]">
                <SeverityIcon severity="warning" /> {warningCount} {warningCopy.countLabel}
              </span>
            )}
            {unknownCount > 0 && (
              <span className="flex items-center gap-1 text-[var(--color-text-muted)]">
                <SeverityIcon severity="unknown" /> {unknownCount} {text('待核实', 'unverified')}
              </span>
            )}
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] text-[var(--color-success-text)]">
              <SeverityIcon severity="pass" /> {passCount} {passCopy.countLabel}
            </span>
            {/* 图例帮助按钮 */}
            <button
              className="flex items-center justify-center rounded-full hover:bg-[var(--color-hover)] transition-colors"
              style={{ width: 22, height: 22 }}
              onClick={() => setShowLegend(!showLegend)}
              title={text('颜色说明', 'Color legend')}
            >
              <HelpCircle size={14} style={{ color: 'var(--color-text-muted)' }} />
            </button>
          </div>
        </div>

        {/* 双向跳转导航栏 */}
        <div className="flex items-center justify-between gap-2 mb-4 p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] text-xs">
          <div className="flex items-center gap-1.5 font-medium text-[var(--color-text)]">
            <ExternalLink size={14} className="text-[var(--color-accent)]" />
            <span>{text(`第 ${chapterNumber ?? ''} 章一致性审核报告（只读）`, `Chapter ${chapterNumber ?? ''} Consistency Audit (Read-only)`)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={jumpToDraft} disabled={!draftPath}>
              <FileText size={12} />
              {text('定位至正文', 'Jump to prose')}
            </Button>
            <Button variant="outline" size="sm" onClick={jumpToBlueprint}>
              <BookOpen size={12} />
              {text('定位至蓝图', 'Jump to blueprint')}
            </Button>
          </div>
        </div>

        {/* 颜色图例说明 */}
        {showLegend && (
          <div
            className="mb-4 rounded-lg border p-3 text-xs space-y-2"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
            }}
          >
            <div className="font-medium text-[var(--color-text)] mb-1.5">{text('颜色标记说明', 'Color legend')}</div>
            {(['error', 'warning', 'unknown', 'pass'] as const).map(sev => {
              const meta = SEVERITY_META[sev]
              const copy = severityCopy(sev, text)
              return (
                <div key={sev} className="flex items-center gap-2">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded',
                    meta.bgClass, meta.colorClass
                  )}>
                    <SeverityIcon severity={sev} /> {copy.label}
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    — {copy.actionLabel}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 总体评价（如有） */}
        {summary && (
          <div
            className="mb-4 px-4 py-3 rounded-lg border text-sm"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            <span className="font-medium">{text('总体评价：', 'Overall assessment:')}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>{summary}</span>
          </div>
        )}

        {goalReview && (
          <p className="mb-4 text-xs text-[var(--color-text-muted)]">
            {goalReview.coverage === 'complete'
              ? text('本章目标已逐项检查；覆盖完整不代表全部完成。', 'Chapter goals checked individually; full coverage does not mean all goals are completed.')
              : goalReview.coverage === 'not_configured'
                ? text('本章未配置可检查的目标，未进行目标验收。', 'No chapter goals are configured; goal acceptance was not performed.')
                : text('本章目标检查不完整，尚有待核实项。', 'Chapter goal review is incomplete and needs verification.')}
          </p>
        )}
        {blueprintReviewUnavailable && (
          <p className="mb-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {blueprintReviewUnavailable === 'corrupt'
              ? text('绑定蓝图 v2 数据损坏，本次未据此下结论。', 'The bound v2 blueprint is corrupt; no conclusions were drawn from it.')
              : blueprintReviewUnavailable === 'needs-newer-app'
                ? text('绑定蓝图由较新版本写入，本次未据此下结论。', 'The bound blueprint requires a newer app; no conclusions were drawn from it.')
                : text('绑定蓝图 v2 暂时不可读取，本次未据此下结论。', 'The bound v2 blueprint could not be read; no conclusions were drawn from it.')}
          </p>
        )}
        {blueprintReview && (
          <section className="mb-5 rounded-lg border border-[var(--color-border)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                {text('章节蓝图一致性', 'Chapter blueprint consistency')}
              </h4>
              <span className="text-[0.7rem] text-[var(--color-text-muted)]">
                {text(
                  `第 ${blueprintReview.evidence.chapterNumber} 章 · r${blueprintReview.evidence.revision}`,
                  `Chapter ${blueprintReview.evidence.chapterNumber} · r${blueprintReview.evidence.revision}`,
                )}
              </span>
            </div>
            <p className="text-[0.7rem] text-[var(--color-text-muted)] break-all">
              {text('蓝图内容哈希：', 'Blueprint content hash: ')}{blueprintReview.evidence.contentHash}
            </p>
            {blueprintReview.scenes.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  {text('分镜顺序与因果（建议）', 'Scene order and causality (advisory)')}
                </h5>
                {blueprintReview.scenes.map(scene => (
                  <div key={scene.sceneId} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs space-y-1">
                    <div className="font-medium text-[var(--color-text)]">
                      {scene.order}. {scene.title} <span className="font-mono text-[0.65rem] text-[var(--color-text-muted)]">{scene.sceneId}</span>
                    </div>
                    <div className="text-[var(--color-text-secondary)]">
                      {text('出现：', 'Presence: ')}{scene.presence === 'present' ? text('找到', 'present') : scene.presence === 'missing' ? text('未找到（需人工判断）', 'not found (review manually)') : text('待核实', 'uncertain')}
                      {' · '}{text('顺序：', 'Order: ')}{scene.sequence === 'in-order' ? text('合理', 'plausible') : scene.sequence === 'out-of-order' ? text('可能异常（需人工判断）', 'possibly out of order (review manually)') : text('待核实', 'uncertain')}
                      {' · '}{text('因果：', 'Causality: ')}{scene.causality === 'supported' ? text('有正文支持', 'supported') : scene.causality === 'gap' ? text('可能有断点（需人工判断）', 'possible gap (review manually)') : text('待核实', 'uncertain')}
                    </div>
                    <p className="text-[var(--color-text-secondary)]">{scene.description}</p>
                    {scene.evidence.map((evidence, index) => (
                      <blockquote key={`${scene.sceneId}-evidence-${index}`} className="border-l-2 border-[var(--color-border)] pl-2 text-[var(--color-text-muted)]">
                        {text(`正文第 ${evidence.startLine} 行：`, `Prose line ${evidence.startLine}: `)}{evidence.quote}
                      </blockquote>
                    ))}
                    {scene.evidence.length === 0 && (
                      <p className="text-[var(--color-text-muted)]">
                        {text(`无直接引文，查找范围：正文第 ${scene.searchRange.startLine}–${scene.searchRange.endLine} 行。`, `No direct quote; searched prose lines ${scene.searchRange.startLine}–${scene.searchRange.endLine}.`)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {blueprintReview.checks.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  {text('必达、参考与禁写条目', 'Must, reference, and forbid checks')}
                </h5>
                {blueprintReview.checks.map(check => (
                  <div key={check.checkId} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs space-y-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-text)]">
                      <span>{check.mode === 'must' ? text('必达', 'Must') : check.mode === 'forbid' ? text('禁写', 'Forbid') : text('参考', 'Reference')}</span>
                      <span className="font-mono text-[0.65rem] text-[var(--color-text-muted)]">{check.checkId}</span>
                      {check.mode === 'reference' && <span className="text-[var(--color-text-muted)]">{text('仅上下文，不计发现', 'Context only; no finding')}</span>}
                    </div>
                    <p className="whitespace-pre-wrap text-[var(--color-text-secondary)]">{check.requirement}</p>
                    <p className="text-[var(--color-text-secondary)]">{check.description}</p>
                    {check.evidence.map((evidence, index) => (
                      <blockquote key={`${check.checkId}-evidence-${index}`} className="border-l-2 border-[var(--color-border)] pl-2 text-[var(--color-text-muted)]">
                        {text(`正文第 ${evidence.startLine} 行：`, `Prose line ${evidence.startLine}: `)}{evidence.quote}
                      </blockquote>
                    ))}
                    {check.mode !== 'reference' && check.evidence.length === 0 && (
                      <p className="text-[var(--color-text-muted)]">
                        {text(`无直接引文，查找范围：正文第 ${check.searchRange.startLine}–${check.searchRange.endLine} 行。`, `No direct quote; searched prose lines ${check.searchRange.startLine}–${check.searchRange.endLine}.`)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {blueprintReview.chapterHook.status !== 'not-configured' && (
              <div className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs space-y-1">
                <h5 className="font-semibold text-[var(--color-text-secondary)]">{text('章末钩子（建议）', 'Chapter-end hook (advisory)')}</h5>
                <p className="whitespace-pre-wrap text-[var(--color-text-secondary)]">{blueprintReview.chapterHook.requirement}</p>
                <p className="text-[var(--color-text-secondary)]">{blueprintReview.chapterHook.description}</p>
                {blueprintReview.chapterHook.evidence.map((evidence, index) => (
                  <blockquote key={`hook-evidence-${index}`} className="border-l-2 border-[var(--color-border)] pl-2 text-[var(--color-text-muted)]">
                    {text(`正文第 ${evidence.startLine} 行：`, `Prose line ${evidence.startLine}: `)}{evidence.quote}
                  </blockquote>
                ))}
                {blueprintReview.chapterHook.evidence.length === 0 && (
                  <p className="text-[var(--color-text-muted)]">
                    {text(`无直接引文，查找范围：正文第 ${blueprintReview.chapterHook.searchRange.startLine}–${blueprintReview.chapterHook.searchRange.endLine} 行。`, `No direct quote; searched prose lines ${blueprintReview.chapterHook.searchRange.startLine}–${blueprintReview.chapterHook.searchRange.endLine}.`)}
                  </p>
                )}
              </div>
            )}
            {blueprintReview.blueprintIssues.map((issue, index) => (
              <p key={`blueprint-issue-${index}`} className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                {text('蓝图自身问题（不是正文违背蓝图）：', 'Blueprint issue (not a prose violation): ')}{issue}
              </p>
            ))}
          </section>
        )}
        {/* 分类展示 */}
        {items.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
            <CheckCircle size={32} className="mx-auto mb-2" style={{ color: 'var(--color-success)' }} />
            {goalReview && goalReview.coverage !== 'complete'
              ? text('暂无已确认的检查结果', 'No confirmed review results yet')
              : text('审稿通过，未发现问题', 'Review passed. No issues found.')}
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(categories.entries()).map(([category, items]) => (
              <div key={category}>
                <h4 className="text-sm font-semibold text-[var(--color-text)] mb-2 flex items-center gap-1.5">
                  <Info size={14} className="text-[var(--color-text-muted)]" />
                  {category}
                </h4>
                <div className="space-y-1.5 pl-1">
                  {items.map((item) => {
                    const meta = SEVERITY_META[item.severity]
                    const copy = severityCopy(item.severity, text)
                    const isPass = item.severity === 'pass'
                    const goal = goalReview?.items.find(goal => goal.id === item.goalId)
                    const isEmptyAuthorIssue = item.origin === 'author' && !item.description.trim()
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'px-3 py-2 rounded-md border text-xs leading-relaxed',
                          meta.borderClass, meta.bgClass
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <SeverityIcon severity={item.severity} />
                          <div className="flex-1 min-w-0 space-y-2">
                            {goal && (
                              <div className="space-y-1" aria-label={text('本章目标与证据', 'Chapter goal and evidence')}>
                                <p className="font-medium">
                                  {text('本章目标：', 'Chapter goal: ')}{goal.text}
                                  {' — '}{goal.status === 'completed' ? text('已完成', 'Completed') : goal.status === 'unmet' ? text('未完成', 'Unmet') : text('待核实', 'Needs verification')}
                                </p>
                                {goal.evidence.map((evidence, index) => (
                                  <blockquote key={index} className="border-l-2 border-[var(--color-border)] pl-2">
                                    <Quote size={10} className="inline mr-1" />{evidence.quote}
                                  </blockquote>
                                ))}
                                {goal.evidence.length === 0 && <p>{text('暂无可定位正文证据', 'No locatable chapter evidence')}</p>}
                              </div>
                            )}
                            {editingChecklist && !isPass ? (
                              <>
                                <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2">
                                  <Input
                                    aria-label={text('问题分类', 'Issue category')}
                                    value={item.category}
                                    onChange={(event) => updateItem(item.id, { category: event.target.value })}
                                  />
                                  <NativeSelect
                                    aria-label={text('严重程度', 'Severity')}
                                    value={item.severity}
                                    onChange={(event) => {
                                      const severity = normalizeSeverity(event.target.value)
                                      updateItem(item.id, {
                                        severity,
                                        ...(severity === 'unknown' ? { decision: 'ignore' } : {}),
                                      })
                                    }}
                                  >
                                    <option value="error">{text('严重问题', 'Critical issue')}</option>
                                    <option value="warning">{text('改进建议', 'Improvement')}</option>
                                    <option value="unknown">{text('待核实', 'Needs verification')}</option>
                                  </NativeSelect>
                                </div>
                                <Textarea
                                  aria-label={text('审稿问题', 'Review issue')}
                                  aria-invalid={isEmptyAuthorIssue || undefined}
                                  aria-describedby={isEmptyAuthorIssue ? `author-issue-hint-${item.id}` : undefined}
                                  value={item.description}
                                  placeholder={item.origin === 'author' ? text(
                                    '请填写需要纳入本次修稿的具体问题',
                                    'Describe the specific issue to include in this revision',
                                  ) : undefined}
                                  onChange={(event) => updateItem(item.id, { description: event.target.value })}
                                />
                                {isEmptyAuthorIssue && (
                                  <p
                                    id={`author-issue-hint-${item.id}`}
                                    className="text-[0.7rem] text-[var(--color-warning-text)]"
                                  >
                                    {text(
                                      '请填写具体问题，或移除这一项。',
                                      'Describe the issue, or remove this item.',
                                    )}
                                  </p>
                                )}
                                <Input
                                  aria-label={text('相关原文（可选）', 'Related text (optional)')}
                                  value={item.quote ?? ''}
                                  placeholder={text('相关原文（可选）', 'Related text (optional)')}
                                  onChange={(event) => updateItem(item.id, { quote: event.target.value })}
                                />
                              </>
                            ) : (
                              <div>
                                <span className="text-[var(--color-text-secondary)]">
                                  {item.description.replace(/【有意安排】|\[Intentional\]/g, intentionalMarker)}
                                </span>
                                <span className={cn('ml-2 text-[0.65rem] opacity-70', meta.colorClass)}>
                                  [{copy.actionLabel}]
                                </span>
                              </div>
                            )}
                            {item.sourceChapter && (
                              <p className="text-[0.7rem] text-[var(--color-text-muted)]">
                                {text(
                                  `来源：第${item.sourceChapter}章`,
                                  `Source: Chapter ${item.sourceChapter}`,
                                )}
                              </p>
                            )}
                            {!isPass && editingChecklist && (
                              <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                                <span className={cn('text-[0.7rem]', meta.colorClass)}>
                                  {item.decision === 'apply'
                                    ? text('已标记为待处理问题', 'Flagged to address')
                                    : text('已标记为忽略/有意安排', 'Ignored / Intentional')}
                                </span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={jumpToDraft}
                                    disabled={!draftPath}
                                    title={text('跳转至正文草稿', 'Jump to draft')}
                                  >
                                    <FileText size={11} />
                                    {text('定位正文', 'Prose')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={jumpToBlueprint}
                                    title={text('跳转至章节蓝图', 'Jump to blueprint')}
                                  >
                                    <BookOpen size={11} />
                                    {text('定位蓝图', 'Blueprint')}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateItem(item.id, {
                                      decision: item.decision === 'apply' ? 'ignore' : 'apply',
                                    })}
                                  >
                                    {item.decision === 'apply'
                                      ? <CircleMinus size={12} />
                                      : <RotateCcw size={12} />}
                                    {item.decision === 'apply'
                                      ? text('忽略', 'Ignore')
                                      : text('恢复', 'Restore')}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      updateItem(item.id, {
                                        decision: 'ignore',
                                        description: /【有意安排】|\[Intentional\]/.test(item.description)
                                          ? item.description
                                          : `${item.description} ${intentionalMarker}`,
                                      })
                                      toast.success(text('已标记为有意安排', 'Marked as intentional'))
                                    }}
                                    title={text('作者有意突破设定，不视为错误', 'Mark as intentional departure')}
                                  >
                                    <BookmarkCheck size={12} />
                                    {text('有意安排', 'Intentional')}
                                  </Button>
                                  {item.origin === 'author' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setItems(current => current.filter(candidate => candidate.id !== item.id))}
                                      title={text('移除人工问题', 'Remove author issue')}
                                    >
                                      <X size={12} />
                                      {text('移除', 'Remove')}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                            {!editingChecklist && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[0.7rem] px-2"
                                  onClick={jumpToDraft}
                                  disabled={!draftPath}
                                  title={text('跳转至正文草稿', 'Jump to draft')}
                                >
                                  <FileText size={11} />
                                  {text('定位正文', 'Prose')}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[0.7rem] px-2"
                                  onClick={jumpToBlueprint}
                                  title={text('跳转至章节蓝图', 'Jump to blueprint')}
                                >
                                  <BookOpen size={11} />
                                  {text('定位蓝图', 'Blueprint')}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* 引用原文（如有） */}
                        {!editingChecklist && item.quote && (
                          <div
                            className="mt-1.5 ml-5 pl-2 text-[0.7rem] italic"
                            style={{
                              borderLeft: '2px solid var(--color-border)',
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            <Quote size={10} className="inline mr-1 opacity-60" />
                            {item.quote}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="mt-6 rounded-lg border border-[var(--color-border)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-1.5">
                <ListChecks size={15} className="text-[var(--color-accent)]" />
                {text('作者决策与确认清单', 'Author decision checklist')}
              </h4>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {editingChecklist
                  ? text('普通错误和建议默认纳入；本章目标与待核实项默认忽略，只有明确选择才纳入；“通过”仅展示。', 'General issues and suggestions are included by default; chapter goals and unverified items require explicit inclusion; passed checks are display-only.')
                  : text('已保存为新的不可变确认快照；原始 AI 审稿未被修改。', 'Saved as a new immutable confirmation snapshot; the original AI review was not modified.')}
              </p>
            </div>
            {confirmed && !editingChecklist && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success-text)]">
                <FileCheck2 size={14} />
                {text('已确认', 'Confirmed')}
              </span>
            )}
          </div>

          {editingChecklist && (
            <>
              <div>
                <Label htmlFor="review-author-guidance">
                  {text('作者修改指导（可选）', 'Author editing guidance (optional)')}
                </Label>
                <Textarea
                  id="review-author-guidance"
                  value={authorGuidance}
                  onChange={(event) => setAuthorGuidance(event.target.value)}
                  placeholder={text(
                    '例如：优先修复角色动机的前后不一致，保持本章克制的叙事节奏。',
                    'For example: prioritize inconsistent character motivation while keeping this chapter’s restrained pace.',
                  )}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={addAuthorItem}>
                  <Plus size={13} />
                  {text('新增人工问题', 'Add author issue')}
                </Button>
                {canManageChecklist ? (
                  <Button variant="ai" size="sm" onClick={confirmChecklist} disabled={confirming}>
                    <FileCheck2 size={13} />
                    {confirmed
                      ? text('重新确认审稿清单', 'Confirm updated checklist')
                      : text('确认审稿清单', 'Confirm review checklist')}
                  </Button>
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {text('关联草稿后可确认清单。', 'Link this report to a draft to confirm the checklist.')}
                  </span>
                )}
              </div>
            </>
          )}

          {confirmed && !editingChecklist && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingChecklist(true)
                  setChecklistError(null)
                }}
              >
                <Pencil size={13} />
                {text('修改决策清单', 'Edit decision checklist')}
              </Button>
              <Button variant="ai" size="sm" onClick={openRevision}>
                {text('按确认意见修稿', 'Revise from confirmed checklist')}
              </Button>
              <Button variant="default" size="sm" onClick={jumpToDraft} disabled={!draftPath}>
                <FileText size={13} />
                {text('返回正文修改', 'Return to prose')}
              </Button>
              <Button variant="outline" size="sm" onClick={jumpToBlueprint}>
                <BookOpen size={13} />
                {text('查看对应蓝图', 'View blueprint')}
              </Button>
            </div>
          )}

          {checklistError && (
            <p role="alert" className="text-xs text-[var(--color-error-text)]">
              {checklistError}
            </p>
          )}
        </section>

        <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{text('按确认意见修稿', 'Revise from confirmed checklist')}</DialogTitle>
              <DialogDescription>{text('仅使用已保存的作者确认清单，生成独立修订稿。', 'Use the saved author checklist to create a separate revision.')}</DialogDescription>
            </DialogHeader>
            <Label htmlFor="review-revision-model">{text('修稿模型', 'Revision model')}</Label>
            <NativeSelect id="review-revision-model" value={revisionModelId} onChange={event => setRevisionModelId(event.target.value)}>
              {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </NativeSelect>
            <p className="text-sm">{text('发送给修稿的已确认指导', 'Confirmed guidance sent to revision')}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{confirmed && renderHumanConfirmedReviewBrief(confirmed.snapshot, writingLanguage)}</pre>
            <DialogFooter>
              <Button onClick={() => void startRevision()} disabled={startingRevision || !revisionModelId}>{text('开始修稿', 'Start revision')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 原始文本折叠 */}
        <details className="mt-6">
          <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text)]">
            {text(
              initialSnapshot ? '查看此确认记录原文' : '查看原始 AI 审稿文本',
              initialSnapshot ? 'View this confirmation record' : 'View original AI review text',
            )}
          </summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap font-mono leading-5 text-[var(--color-text-secondary)] bg-[var(--color-sidebar)] rounded-md p-3 border border-[var(--color-border)]">
            {reportText}
          </pre>
        </details>
      </div>
    </div>
  )
}
