import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, BookOpen, Check, CircleAlert, FileClock, LoaderCircle, RotateCcw, Save, Sparkles } from 'lucide-react'
import {
  buildRevisionLearningSkillMarkdown,
  createInitialRevisionLearningReview,
  revisionLearningSkillName,
  sha256Text,
  type RevisionLearningFileStatus,
  type RevisionLearningRecord,
  type RevisionLearningRecordSummary,
  type RevisionLearningReviewDraft,
  type RevisionLearningSourceDraft,
} from '../../shared/revision-learning'
import { resolveWritingLanguage } from '../../shared/writing-language'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { projectSessionContextFromProject } from '../../shared/project-session-context'
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { ipc } from '../../services/ipc-client'
import { createRevisionLearningWorkflow } from '../../services/workflows/revision-learning-workflow'
import { skillRegistry } from '../../services/agent/skill-registry'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import { confirm as confirmAction } from '../ui/Confirm'

interface Props {
  recordId?: string
}

function recordTab(record: RevisionLearningRecordSummary | RevisionLearningRecord, projectPath: string) {
  return {
    id: `revision-learning:${record.id}`,
    name: `修订学习 · ${record.beforeSnapshot.title}`,
    type: 'revision-learning' as const,
    projectKey: projectPath,
    chapterNumber: record.beforeSnapshot.chapterNumber,
    revisionLearningRecordId: record.id,
    ...(record.beforeSnapshot.sourceKind === 'editor-snapshot' && record.beforeSnapshot.tabId
      ? { revisionLearningSourceTabId: record.beforeSnapshot.tabId }
      : {}),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function RevisionLearningEditor({ recordId }: Props) {
  const project = useProjectStore(state => state.currentProject)
  const projectSession = useMemo(() => projectSessionContextFromProject(project), [project])
  const text = useLocaleStore(state => state.text)
  const writingLanguage = resolveWritingLanguage(project?.novelConfig.writingLanguage)
  const [records, setRecords] = useState<RevisionLearningRecordSummary[]>([])
  const [sources, setSources] = useState<RevisionLearningSourceDraft[]>([])
  const [record, setRecord] = useState<RevisionLearningRecord | null>(null)
  const [review, setReview] = useState<RevisionLearningReviewDraft | null>(null)
  const [publicationStatus, setPublicationStatus] = useState<{
    refinementSkillId: string | null
    skills: RevisionLearningFileStatus[]
  } | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
  const [beforeDraftId, setBeforeDraftId] = useState<number | null>(null)
  const [afterDraftId, setAfterDraftId] = useState<number | null>(null)
  const [inputDirty, setInputDirty] = useState(false)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [previewHash, setPreviewHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sourceTabId = record?.beforeSnapshot.sourceKind === 'editor-snapshot'
    ? record.beforeSnapshot.tabId
    : undefined
  const sourceTab = useEditorStore(state => state.tabs.find(tab => tab.id === sourceTabId && tab.projectKey === project?.path))

  const reload = useCallback(async (session: ProjectSessionContext = projectSession as ProjectSessionContext) => {
    if (!session) return
    const [sourceDrafts, summaries] = await Promise.all([
      ipc.invokeWithProjectSession(session, 'revision-learning:list-source-drafts'),
      ipc.invokeWithProjectSession(session, 'revision-learning:list'),
    ])
    setSources(sourceDrafts)
    setRecords(summaries)
    if (sourceDrafts.length > 0) {
      setSelectedChapter(current => current ?? sourceDrafts[0]!.chapterNumber)
    }
    if (recordId) {
      const current = await ipc.invokeWithProjectSession(session, 'revision-learning:get', recordId)
      setRecord(current)
      setReview(current.review)
      setInputDirty(false)
      setReviewDirty(false)
      const status = await ipc.invokeWithProjectSession(session, 'revision-learning:publication-status', recordId)
      setPublicationStatus(status)
    } else {
      setRecord(null)
      setReview(null)
      setPublicationStatus(null)
    }
  }, [projectSession, recordId])

  useEffect(() => {
    let disposed = false
    if (!projectSession) return
    // Async IPC completion updates local UI state; it is intentionally lifecycle-scoped.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(projectSession).catch(cause => {
      if (!disposed) setError(errorMessage(cause))
    })
    return () => { disposed = true }
  }, [projectSession, reload])

  const chapterNumbers = useMemo(() => [...new Set(sources.map(source => source.chapterNumber))].sort((a, b) => a - b), [sources])
  const chapterSources = useMemo(
    () => sources.filter(source => selectedChapter === null || source.chapterNumber === selectedChapter),
    [sources, selectedChapter],
  )
  const currentAttempt = record?.attempts.find(attempt => attempt.status === 'completed'
    && attempt.inputRevision === record.inputRevision
    && attempt.inputHash === record.inputHash) ?? null
  const latestAttempt = record?.attempts[0] ?? null
  const currentReview = review && currentAttempt
    && review.resultAttemptId === currentAttempt.id
    && review.resultInputHash === record?.inputHash
    ? review
    : null

  const preview = useMemo(() => {
    if (!record || !currentReview) return { content: null as string | null, error: null as string | null }
    try {
      return {
        content: buildRevisionLearningSkillMarkdown(record.id, currentReview, writingLanguage),
        error: null,
      }
    } catch (cause) {
      return { content: null, error: errorMessage(cause) }
    }
  }, [currentReview, record, writingLanguage])

  useEffect(() => {
    let disposed = false
    // Clear a previous hash immediately while the new preview is hashed asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewHash(null)
    if (!preview.content) return
    void sha256Text(preview.content).then(hash => {
      if (!disposed) setPreviewHash(hash)
    }).catch(cause => {
      if (!disposed) setError(errorMessage(cause))
    })
    return () => { disposed = true }
  }, [preview.content])

  const refreshRecord = async (id = record?.id) => {
    if (!projectSession || !id) return null
    const current = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:get', id)
    setRecord(current)
    setReview(current.review)
    setInputDirty(false)
    setReviewDirty(false)
    const status = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:publication-status', id)
    setPublicationStatus(status)
    setRecords(await ipc.invokeWithProjectSession(projectSession, 'revision-learning:list'))
    return current
  }

  const openRecord = (target: RevisionLearningRecordSummary | RevisionLearningRecord) => {
    if (!project?.path) return
    useEditorStore.getState().openFile(recordTab(target, project.path))
  }

  const runBusy = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const createFromSavedVersions = () => runBusy(async () => {
    if (!projectSession || beforeDraftId === null || afterDraftId === null) throw new Error(text('请选择修改前和修改后的两个保存版本', 'Choose both the earlier and later saved versions.'))
    const created = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:create-from-versions', {
      beforeDraftId,
      afterDraftId,
    })
    openRecord(created)
  })

  const captureEditorAfter = () => runBusy(async () => {
    if (!record || !projectSession || !sourceTab || !sourceTabId) {
      throw new Error(text('找不到创建快照时的正文标签；请保留来源标签并重新打开本记录', 'The source prose tab is unavailable. Keep it open and reopen this record.'))
    }
    const updated = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:capture-after', {
      recordId: record.id,
      expectedRevision: record.revision,
      draftId: sourceTab.draftId ?? record.beforeSnapshot.draftId,
      tabId: sourceTabId,
      editGeneration: sourceTab.contentRevision ?? 0,
      content: sourceTab.content ?? '',
    })
    setRecord(updated)
    setInputDirty(false)
    setReview(updated.review)
    setReviewDirty(false)
    setRecords(await ipc.invokeWithProjectSession(projectSession, 'revision-learning:list'))
  })

  const saveInput = async (): Promise<RevisionLearningRecord> => {
    if (!record || !projectSession) throw new Error(text('修订学习记录尚未加载', 'The revision learning record is not loaded.'))
    const updated = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:save-input', {
      recordId: record.id,
      expectedRevision: record.revision,
      changes: record.changes.map(change => ({ id: change.id, included: change.included, authorReason: change.authorReason })),
      overallReason: record.overallReason,
    })
    setRecord(updated)
    setInputDirty(false)
    setReview(updated.review)
    setReviewDirty(false)
    return updated
  }

  const analyze = () => runBusy(async () => {
    if (!record || !projectSession) throw new Error(text('修订学习记录尚未加载', 'The revision learning record is not loaded.'))
    let frozen = inputDirty ? await saveInput() : record
    if (!frozen.afterSnapshot || !frozen.changes.some(change => change.included)) {
      throw new Error(text('请记录修改后文本，并至少纳入一项差异', 'Capture the later text and include at least one change.'))
    }
    await useLLMStore.getState().init()
    const modelId = useLLMStore.getState().defaultModelId
    const attempt = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:attempt-begin', {
      recordId: frozen.id,
      inputRevision: frozen.inputRevision,
      inputHash: frozen.inputHash,
      modelId,
    })
    setActiveAttemptId(attempt.id)
    try {
      await useWorkflowStore.getState().startWorkflow(createRevisionLearningWorkflow({
        projectSession,
        recordId: frozen.id,
        attemptId: attempt.id,
        modelId,
      }))
    } finally {
      setActiveAttemptId(null)
    }
    frozen = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:get', frozen.id)
    let completed = frozen.attempts.find(candidate => candidate.id === attempt.id)
    if (completed?.status === 'running') {
      const run = useWorkflowStore.getState().history.find(candidate => candidate.id === attempt.id)
      completed = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:attempt-finish', {
        recordId: frozen.id,
        attemptId: attempt.id,
        status: run?.error?.includes('取消') ? 'cancelled' : 'failed',
        errorSummary: run?.error || '工作流在命令执行前结束，未产生分析结果',
      })
      frozen = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:get', frozen.id)
    }
    setRecord(frozen)
    setReview(frozen.review)
    setInputDirty(false)
    setReviewDirty(false)
    if (completed?.status === 'completed' && completed.result) {
      const initial = createInitialRevisionLearningReview(completed.result, completed)
      const reviewed = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:review-save', {
        recordId: frozen.id,
        expectedRevision: frozen.revision,
        resultAttemptId: completed.id,
        resultInputHash: completed.inputHash,
        rules: initial.rules,
        skillDisplayName: initial.skillDisplayName,
        skillDescription: initial.skillDescription,
      })
      setRecord(reviewed)
      setReview(reviewed.review)
      setReviewDirty(false)
      setRecords(await ipc.invokeWithProjectSession(projectSession, 'revision-learning:list'))
    }
  })

  const saveReview = async (): Promise<{ record: RevisionLearningRecord; review: RevisionLearningReviewDraft }> => {
    if (!record || !currentReview || !projectSession) throw new Error(text('当前分析结果已过期，不能保存技能草稿', 'The analysis is stale, so this skill draft cannot be saved.'))
    const updated = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:review-save', {
      recordId: record.id,
      expectedRevision: record.revision,
      resultAttemptId: currentReview.resultAttemptId,
      resultInputHash: currentReview.resultInputHash,
      rules: currentReview.rules,
      skillDisplayName: currentReview.skillDisplayName,
      skillDescription: currentReview.skillDescription,
    })
    if (!updated.review) throw new Error(text('技能草稿保存回执缺失', 'The saved skill draft receipt is missing.'))
    setRecord(updated)
    setReview(updated.review)
    setReviewDirty(false)
    return { record: updated, review: updated.review }
  }

  const confirmPreview = () => runBusy(async () => {
    if (!currentReview || !preview.content) throw new Error(preview.error || text('至少选择一条候选规则后再确认预览', 'Select at least one candidate rule before confirming the preview.'))
    const saved = await saveReview()
    const savedPreview = buildRevisionLearningSkillMarkdown(saved.record.id, saved.review, writingLanguage)
    const hash = await sha256Text(savedPreview)
    const confirmed = await ipc.invokeWithProjectSession(projectSession!, 'revision-learning:review-confirm', {
      recordId: saved.record.id,
      expectedRevision: saved.record.revision,
      expectedContentHash: hash,
      writingLanguage,
    })
    setRecord(confirmed)
    setReview(confirmed.review)
    setReviewDirty(false)
  })

  const publishSkill = () => runBusy(async () => {
    if (!record || !currentReview || !previewHash || !projectSession) throw new Error(text('请先保存并确认当前技能预览', 'Save and confirm the current skill preview first.'))
    if (currentReview.skillContentHash !== previewHash || currentReview.confirmedWritingLanguage !== writingLanguage) {
      throw new Error(text('技能预览已变化，请重新确认', 'The skill preview changed. Confirm it again.'))
    }
    await ipc.invokeWithProjectSession(projectSession, 'revision-learning:publish', {
      recordId: record.id,
      expectedRevision: record.revision,
      expectedContentHash: previewHash,
    })
    await skillRegistry.loadAll()
    await refreshRecord(record.id)
  })

  const currentSkillId = record && currentReview
    ? `project:${revisionLearningSkillName(record.id, currentReview.skillDraftRevision)}`
    : null
  const latestReceipt = record?.publishReceipts.find(receipt => receipt.skillId === currentSkillId) ?? null
  const publishedFileStatus = latestReceipt
    ? publicationStatus?.skills.find(skill => skill.skillId === latestReceipt.skillId) ?? null
    : null

  const bindSkill = () => runBusy(async () => {
    if (!record || !latestReceipt || !publicationStatus || !projectSession) throw new Error(text('请先发布技能到项目目录', 'Publish the skill to the project first.'))
    const currentSkillId = publicationStatus.refinementSkillId
    if (currentSkillId && currentSkillId !== latestReceipt.skillId) {
      const oldSkill = skillRegistry.getById(currentSkillId)
      const oldName = oldSkill?.metadata.displayName ?? oldSkill?.metadata.name ?? currentSkillId
      const newSkill = skillRegistry.getById(latestReceipt.skillId)
      const newName = newSkill?.metadata.displayName ?? newSkill?.metadata.name ?? currentReview?.skillDisplayName ?? latestReceipt.skillId
      const accepted = await confirmAction(text(
        `当前“修稿与定稿前润色”阶段绑定为「${oldName}」。确认将其替换为「${newName}」吗？`,
        `The refinement stage currently uses “${oldName}”. Replace it with “${newName}”?`,
      ), { title: text('确认替换修稿阶段绑定', 'Replace refinement-stage binding') })
      if (!accepted) return
    }
    const result = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:bind', {
      recordId: record.id,
      skillId: latestReceipt.skillId,
      expectedCurrentSkillId: currentSkillId,
      mode: currentSkillId === null ? 'only-if-unbound' : 'replace',
    })
    if (result.conflict || !result.bound) {
      const status = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:publication-status', record.id)
      setPublicationStatus(status)
      throw new Error(text('修稿阶段绑定已变化，请核对当前绑定后重试', 'The refinement binding changed. Review the current binding and try again.'))
    }
    const status = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:publication-status', record.id)
    setPublicationStatus(status)
  })

  const reverseSample = () => runBusy(async () => {
    if (!record || !projectSession) return
    const updated = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:reverse-sample', record.id, record.revision)
    setRecord(updated)
    setReview(updated.review)
    setInputDirty(false)
    setReviewDirty(false)
    setRecords(await ipc.invokeWithProjectSession(projectSession, 'revision-learning:list'))
  })

  const updateChange = (id: string, patch: { included?: boolean; authorReason?: string }) => {
    setRecord(current => current ? {
      ...current,
      changes: current.changes.map(change => change.id === id ? { ...change, ...patch } : change),
    } : current)
    setInputDirty(true)
  }

  const updateReview = (patch: Partial<Pick<RevisionLearningReviewDraft, 'skillDisplayName' | 'skillDescription'>>) => {
    setReview(current => current ? { ...current, ...patch, skillContentHash: null, confirmedAt: null } : current)
    setReviewDirty(true)
  }

  const updateRule = (ruleId: string, patch: Partial<RevisionLearningReviewDraft['rules'][number]>) => {
    setReview(current => current ? {
      ...current,
      skillContentHash: null,
      confirmedAt: null,
      rules: current.rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule),
    } : current)
    setReviewDirty(true)
  }

  const sectionClass = 'border-t border-[var(--color-border)] py-5'
  const fieldClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)] px-3 py-2 text-sm leading-6 text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'
  const retryableAttempt = latestAttempt
    && ['failed', 'cancelled', 'interrupted'].includes(latestAttempt.status)

  return (
    <div className="h-full min-h-0 overflow-y-auto" style={{ color: 'var(--color-text)' }}>
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div className="max-w-3xl">
            <h1 className="text-xl font-semibold tracking-tight">{text('修订学习', 'Revision learning')}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              {text('对照真实修稿差异，说明修改理由，只把你纳入的证据交给模型。模型只给候选规则；你确认后才会生成项目修稿技能。', 'Compare real revision changes, record why they were made, and send only selected evidence for analysis. The model proposes rules; you approve each rule before a project skill is created.')}
            </p>
          </div>
          {record && (
            <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
              {text(`第 ${record.beforeSnapshot.displayNumber ?? record.beforeSnapshot.chapterNumber} 章`, `Chapter ${record.beforeSnapshot.displayNumber ?? record.beforeSnapshot.chapterNumber}`)}
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--color-error)] px-3 py-2 text-sm text-[var(--color-error-text)]">
            <CircleAlert size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!record ? (
          <>
            <section className={`${sectionClass} border-t-0 pt-0`} aria-labelledby="revision-learning-create-title">
              <h2 id="revision-learning-create-title" className="text-base font-semibold">{text('从已保存版本开始', 'Start from saved versions')}</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                {text('选择同一逻辑章节的修改前后两个版本。正文和版本身份由项目数据库读取。', 'Choose two saved versions from the same logical chapter. Text and version identity are read from the project database.')}
              </p>
              {sources.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">{text('项目里还没有可用的已保存草稿版本。', 'This project has no saved draft versions to compare yet.')}</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(150px,0.55fr)_1fr_1fr_auto] md:items-end">
                  <label className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                    <span>{text('章节', 'Chapter')}</span>
                    <NativeSelect
                      value={selectedChapter ?? ''}
                      onChange={event => {
                        const chapter = Number(event.target.value)
                        setSelectedChapter(Number.isSafeInteger(chapter) ? chapter : null)
                        setBeforeDraftId(null)
                        setAfterDraftId(null)
                      }}
                      aria-label={text('选择章节', 'Choose chapter')}
                    >
                      {chapterNumbers.map(chapter => <option key={chapter} value={chapter}>{text(`第 ${chapter} 章`, `Chapter ${chapter}`)}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                    <span>{text('修改前', 'Before')}</span>
                    <NativeSelect value={beforeDraftId ?? ''} onChange={event => setBeforeDraftId(event.target.value ? Number(event.target.value) : null)} aria-label={text('选择修改前版本', 'Choose the earlier version')}>
                      <option value="">{text('选择保存版本…', 'Choose a saved version…')}</option>
                      {chapterSources.map(source => <option key={source.id} value={source.id}>{source.title} · v{source.version} · {source.status}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                    <span>{text('修改后', 'After')}</span>
                    <NativeSelect value={afterDraftId ?? ''} onChange={event => setAfterDraftId(event.target.value ? Number(event.target.value) : null)} aria-label={text('选择修改后版本', 'Choose the later version')}>
                      <option value="">{text('选择保存版本…', 'Choose a saved version…')}</option>
                      {chapterSources.map(source => <option key={source.id} value={source.id}>{source.title} · v{source.version} · {source.status}</option>)}
                    </NativeSelect>
                  </label>
                  <Button onClick={() => void createFromSavedVersions()} disabled={busy || beforeDraftId === null || afterDraftId === null || beforeDraftId === afterDraftId}>
                    <ArrowDownUp size={14} />{text('对照版本', 'Compare versions')}
                  </Button>
                </div>
              )}
            </section>

            <section className={sectionClass} aria-labelledby="revision-learning-records-title">
              <div className="flex items-center gap-2">
                <FileClock size={17} className="text-[var(--color-text-secondary)]" />
                <h2 id="revision-learning-records-title" className="text-base font-semibold">{text('修订学习记录', 'Revision learning records')}</h2>
              </div>
              {records.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">{text('还没有记录。你也可以从正文编辑器的“修订学习”入口记录未保存前稿。', 'There are no records yet. You can also capture unsaved prose from the editor’s “Learn revisions” action.')}</p>
              ) : (
                <ul className="mt-2 divide-y divide-[var(--color-border)]">
                  {records.map(item => (
                    <li key={item.id}>
                      <button type="button" onClick={() => openRecord(item)} className="flex w-full items-center justify-between gap-4 py-3 text-left hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{item.beforeSnapshot.title}</span>
                          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{text(`第 ${item.beforeSnapshot.chapterNumber} 章 · ${item.changeCount} 项差异 · ${item.publishCount} 个已发布版本`, `Chapter ${item.beforeSnapshot.chapterNumber} · ${item.changeCount} changes · ${item.publishCount} published version(s)`)}</span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{new Date(item.updatedAt).toLocaleDateString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <>
            <section className={`${sectionClass} border-t-0 pt-0`} aria-labelledby="revision-learning-sample-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="revision-learning-sample-title" className="text-base font-semibold">{text('修订样本', 'Revision sample')}</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    {record.beforeSnapshot.sourceKind === 'editor-snapshot'
                      ? text('来源：编辑器未保存快照', 'Source: unsaved editor snapshot')
                      : text('来源：数据库已保存版本', 'Source: saved database versions')}
                    {record.afterSnapshot
                      ? ` · ${text(`v${record.beforeSnapshot.version} → v${record.afterSnapshot.version}`, `v${record.beforeSnapshot.version} → v${record.afterSnapshot.version}`)}`
                      : ` · ${text('等待修改后文本', 'Waiting for the revised text')}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {record.beforeSnapshot.sourceKind === 'editor-snapshot' && !record.afterSnapshot && (
                    <Button variant="outline" onClick={() => void captureEditorAfter()} disabled={busy || !sourceTab} title={text('记录来源正文标签当前显示的未保存文本', 'Capture the current unsaved text from the source prose tab')}>
                      <Check size={14} />{text('记录修改后文本', 'Capture revised text')}
                    </Button>
                  )}
                  {record.beforeSnapshot.sourceKind === 'editor-snapshot' && sourceTab && (
                    <Button variant="ghost" onClick={() => useEditorStore.getState().setActiveTab(sourceTab.id)}>
                      {text('返回来源正文', 'Return to source prose')}
                    </Button>
                  )}
                  {record.afterSnapshot && (
                    <Button variant="ghost" onClick={() => void reverseSample()} disabled={busy} title={text('交换前后稿方向并重新计算差异', 'Swap before and after, then recalculate changes')}>
                      <RotateCcw size={14} />{text('交换前后稿', 'Reverse sample')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {[record.beforeSnapshot, record.afterSnapshot].map((snapshot, index) => (
                  <div key={`${index}-${snapshot?.draftId ?? 'none'}-${snapshot?.version ?? 'none'}`}>
                    <h3 className="text-sm font-medium">{index === 0 ? text('修改前', 'Before') : text('修改后', 'After')}</h3>
                    {snapshot ? (
                      <details className="mt-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
                        <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">{snapshot.title} · v{snapshot.version} · {snapshot.status} · {text('展开正文快照', 'Show text snapshot')}</summary>
                        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--color-text-secondary)]">{snapshot.content}</pre>
                      </details>
                    ) : (
                      <p className="mt-2 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-5 text-sm text-[var(--color-text-muted)]">{text('后稿尚未记录', 'The later text has not been captured')}</p>
                    )}
                  </div>
                ))}
              </div>

              {record.afterSnapshot && (
                <div className="mt-5 space-y-4">
                  <label className="block space-y-1.5 text-sm font-medium">
                    <span>{text('整体修改目标或理由', 'Overall revision goal or reason')}</span>
                    <textarea
                      value={record.overallReason}
                      onChange={event => {
                        setRecord(current => current ? { ...current, overallReason: event.target.value } : current)
                        setInputDirty(true)
                      }}
                      rows={3}
                      maxLength={4_000}
                      className={fieldClass}
                      placeholder={text('例如：让冲突更直接，同时保留人物克制的表达。', 'For example: make the conflict clearer while preserving the character’s restrained voice.')}
                    />
                  </label>

                  <div>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium">{text('逐项核对差异', 'Review each change')}</h3>
                        <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{text('只有勾选的差异和对应理由会作为分析证据。大段变化会标记为粗略对照。', 'Only selected changes and their reasons count as analysis evidence. Large changes are marked as coarse comparisons.')}</p>
                      </div>
                      <span className="text-xs text-[var(--color-text-secondary)]">{record.changes.filter(change => change.included).length} / {record.changes.length} {text('项纳入', 'included')}</span>
                    </div>
                    {record.changes.length === 0 ? (
                      <p className="mt-3 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-5 text-sm text-[var(--color-text-muted)]">{text('前后稿没有检测到正文差异。', 'No prose differences were found between the snapshots.')}</p>
                    ) : (
                      <ol className="mt-2 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                        {record.changes.map(change => (
                          <li key={change.id} className="py-4">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={change.included}
                                onChange={event => updateChange(change.id, { included: event.target.checked })}
                                aria-label={text(`纳入差异 ${change.id}`, `Include change ${change.id}`)}
                                className="mt-1 size-4 accent-[var(--color-accent)]"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                                  <span className="font-medium">{text('差异', 'Change')} {change.beforeStartParagraph || change.afterStartParagraph} · {change.kind}</span>
                                  {change.coarse && <span className="text-[var(--color-warning-text)]">{text('粗略对照', 'Coarse comparison')}</span>}
                                  {!change.included && <span>{text('未纳入分析', 'Excluded from analysis')}</span>}
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--color-hover)] p-2 text-xs leading-5 text-[var(--color-text-secondary)]">{change.beforeText || text('（无）', '(empty)')}</pre>
                                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--color-hover)] p-2 text-xs leading-5 text-[var(--color-text-secondary)]">{change.afterText || text('（无）', '(empty)')}</pre>
                                </div>
                                <label className="mt-2 block space-y-1 text-xs text-[var(--color-text-secondary)]">
                                  <span>{text('这项修改的原因', 'Reason for this change')}</span>
                                  <textarea
                                    value={change.authorReason}
                                    onChange={event => updateChange(change.id, { authorReason: event.target.value })}
                                    rows={2}
                                    maxLength={2_000}
                                    className={fieldClass}
                                    placeholder={text('可写下你的真实考虑；留空时模型只能标记为推断。', 'Record your actual reason. If blank, the model can only label its explanation as an inference.')}
                                  />
                                </label>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => void runBusy(async () => { await saveInput() })} disabled={busy || !inputDirty}>
                        <Save size={14} />{text('保存样本设置', 'Save sample settings')}
                      </Button>
                      <Button onClick={() => void analyze()} disabled={busy || inputDirty || !record.changes.some(change => change.included)} title={inputDirty ? text('先保存差异选择和修改理由', 'Save selected changes and reasons first') : undefined}>
                        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {busy ? text('分析中…', 'Analyzing…') : retryableAttempt ? text('重试分析', 'Retry analysis') : text('分析并生成候选规则', 'Analyze and propose rules')}
                      </Button>
                      {activeAttemptId && (
                        <Button
                          variant="outline"
                          onClick={() => useWorkflowStore.getState().cancelWorkflow(activeAttemptId)}
                          disabled={!activeAttemptId}
                          title={text('停止当前分析；该次结果不会进入技能草稿', 'Stop this analysis; its result will not enter the skill draft')}
                        >
                          {text('停止分析', 'Stop analysis')}
                        </Button>
                      )}
                    </div>
                    {latestAttempt && (
                      <details className="mt-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs">
                        <summary className="cursor-pointer text-[var(--color-text-secondary)]">
                          {text(`分析记录 · ${record.attempts.length} 次`, `Analysis history · ${record.attempts.length} attempt(s)`)}
                        </summary>
                        <ol className="mt-2 divide-y divide-[var(--color-border)]">
                          {record.attempts.map(attempt => {
                            const receipt = attempt.generationReceipt && typeof attempt.generationReceipt === 'object'
                              ? attempt.generationReceipt as { model?: { id?: string }; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
                              : null
                            return (
                              <li key={attempt.id} className="py-2 text-[var(--color-text-secondary)]">
                                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                                  <span>{attempt.status} · {attempt.promptVersion} · input r{attempt.inputRevision}</span>
                                  <span>{new Date(attempt.createdAt).toLocaleString()}</span>
                                </div>
                                {receipt?.model?.id && <p className="mt-1">{text('模型', 'Model')}: {receipt.model.id}</p>}
                                {receipt?.usage?.totalTokens !== undefined && <p className="mt-1">{text('Token 用量', 'Token usage')}: {receipt.usage.promptTokens ?? 0} + {receipt.usage.completionTokens ?? 0} = {receipt.usage.totalTokens}</p>}
                                {attempt.inputHash !== record.inputHash && <p className="mt-1 text-[var(--color-warning-text)]">{text('基于旧样本，结果已过期', 'Based on an older sample; result is stale')}</p>}
                                {attempt.errorSummary && <p role="alert" className="mt-1 text-[var(--color-error-text)]">{attempt.errorSummary}</p>}
                              </li>
                            )
                          })}
                        </ol>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </section>

            {record.afterSnapshot && currentAttempt?.result && (
              <section className={sectionClass} aria-labelledby="revision-learning-review-title">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="revision-learning-review-title" className="text-base font-semibold">{text('审阅候选技能', 'Review candidate skill')}</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{currentAttempt.result.summary}</p>
                    {currentAttempt.result.nonGeneralizableChanges.length > 0 && (
                      <div className="mt-3">
                        <h3 className="text-sm font-medium">{text('保留为个例，不写入技能', 'Keep as examples; exclude from the skill')}</h3>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--color-text-secondary)]">
                          {currentAttempt.result.nonGeneralizableChanges.map((item, index) => (
                            <li key={`${item.changeIds.join('-')}-${index}`}>
                              {text('差异', 'Changes')} {item.changeIds.map(id => {
                                const change = record.changes.find(candidate => candidate.id === id)
                                return change?.beforeStartParagraph || change?.afterStartParagraph || id
                              }).join('、')} · {item.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  {reviewDirty && <span className="text-xs text-[var(--color-warning-text)]">{text('有未保存修改', 'Unsaved review edits')}</span>}
                </div>
                {!currentReview ? (
                  <Button className="mt-4" variant="outline" onClick={() => void runBusy(async () => {
                    if (!record || !currentAttempt?.result || !projectSession) return
                    const initial = createInitialRevisionLearningReview(currentAttempt.result, currentAttempt)
                    const saved = await ipc.invokeWithProjectSession(projectSession, 'revision-learning:review-save', {
                      recordId: record.id,
                      expectedRevision: record.revision,
                      resultAttemptId: initial.resultAttemptId,
                      resultInputHash: initial.resultInputHash,
                      rules: initial.rules,
                      skillDisplayName: initial.skillDisplayName,
                      skillDescription: initial.skillDescription,
                    })
                    setRecord(saved)
                    setReview(saved.review)
                  })} disabled={busy}>
                    <BookOpen size={14} />{text('建立候选技能草稿', 'Create skill review draft')}
                  </Button>
                ) : (
                  <>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                        <span>{text('技能标题', 'Skill title')}</span>
                        <Input value={currentReview.skillDisplayName} onChange={event => updateReview({ skillDisplayName: event.target.value })} maxLength={80} />
                      </label>
                      <label className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                        <span>{text('技能用途', 'Skill description')}</span>
                        <Input value={currentReview.skillDescription} onChange={event => updateReview({ skillDescription: event.target.value })} maxLength={280} />
                      </label>
                    </div>
                    <ul className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                      {currentReview.rules.map(rule => (
                        <li key={rule.id} className="py-4">
                          <div className="flex items-start gap-3">
                            <input type="checkbox" checked={rule.selected} onChange={event => updateRule(rule.id, { selected: event.target.checked })} aria-label={text(`选择候选规则 ${rule.title}`, `Select candidate rule ${rule.title}`)} className="mt-1 size-4 accent-[var(--color-accent)]" />
                            <div className="min-w-0 flex-1 space-y-3">
                              <label className="block space-y-1 text-xs text-[var(--color-text-secondary)]">
                                <span>{text('规则标题', 'Rule title')}</span>
                                <Input value={rule.title} onChange={event => updateRule(rule.id, { title: event.target.value })} maxLength={100} />
                              </label>
                              <label className="block space-y-1 text-xs text-[var(--color-text-secondary)]">
                                <span>{text('修稿方法', 'Revision guidance')}</span>
                                <textarea value={rule.guidance} onChange={event => updateRule(rule.id, { guidance: event.target.value })} rows={3} maxLength={2_500} className={fieldClass} />
                              </label>
                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="block space-y-1 text-xs text-[var(--color-text-secondary)]">
                                  <span>{text('适用场景', 'When it applies')}</span>
                                  <textarea value={rule.appliesWhen} onChange={event => updateRule(rule.id, { appliesWhen: event.target.value })} rows={2} maxLength={800} className={fieldClass} />
                                </label>
                                <label className="block space-y-1 text-xs text-[var(--color-text-secondary)]">
                                  <span>{text('例外', 'Exceptions')}</span>
                                  <textarea value={rule.exceptions} onChange={event => updateRule(rule.id, { exceptions: event.target.value })} rows={2} maxLength={1_000} className={fieldClass} />
                                </label>
                              </div>
                              <label className="block space-y-1 text-xs text-[var(--color-text-secondary)]">
                                <span>{text('边界与风险', 'Limits and risks')}</span>
                                <textarea value={rule.limitations} onChange={event => updateRule(rule.id, { limitations: event.target.value })} rows={2} maxLength={1_000} className={fieldClass} />
                              </label>
                              <p className="text-xs text-[var(--color-text-muted)]">
                                {text('理由来源', 'Reason source')}: {rule.reasonSource}
                                {' · '}{text('证据差异', 'Evidence changes')}: {rule.evidenceChangeIds.map(id => record.changes.find(change => change.id === id)?.beforeStartParagraph || record.changes.find(change => change.id === id)?.afterStartParagraph || id).join('、')}
                              </p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => void runBusy(async () => { await saveReview() })} disabled={busy || !reviewDirty}>
                        <Save size={14} />{text('保存审阅修改', 'Save review edits')}
                      </Button>
                      <Button variant="outline" onClick={() => void confirmPreview()} disabled={busy || !preview.content || !previewHash || reviewDirty}>
                        <Check size={14} />{text('确认当前预览', 'Confirm this preview')}
                      </Button>
                    </div>
                    {preview.error && <p role="alert" className="mt-2 text-xs text-[var(--color-error-text)]">{preview.error}</p>}
                    {preview.content && (
                      <div className="mt-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">{text('确定性技能预览', 'Deterministic skill preview')}</h3>
                          <span className="text-xs text-[var(--color-text-muted)]">{text('项目语言', 'Project language')}: {writingLanguage}</span>
                        </div>
                        <pre className="mt-2 max-h-[30rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)] p-4 text-xs leading-5 text-[var(--color-text-secondary)]">{preview.content}</pre>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {currentReview && (
              <section className={sectionClass} aria-labelledby="revision-learning-publish-title">
                <h2 id="revision-learning-publish-title" className="text-base font-semibold">{text('保存并绑定到修稿阶段', 'Save and bind to refinement')}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {text('项目技能文件以原子写入并独立读回校验。发布回执和修稿阶段绑定分别保存，可以在部分失败后重试。', 'The project skill uses an atomic write and independent read-back check. Publication and refinement binding have separate receipts, so either step can be retried.')}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="text-[var(--color-text-secondary)]">{text('当前修稿阶段', 'Current refinement skill')}:</span>
                  <strong className="break-all">{publicationStatus?.refinementSkillId ?? text('未绑定', 'Unbound')}</strong>
                  <span aria-hidden="true">→</span>
                  <strong className="break-all">{currentReview.skillDisplayName}{currentSkillId ? ` (${currentSkillId})` : ''}</strong>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void confirmPreview()} disabled={busy || !preview.content || !previewHash || reviewDirty || (currentReview.confirmedAt !== null && currentReview.skillContentHash === previewHash && currentReview.confirmedWritingLanguage === writingLanguage)}>
                    <Check size={14} />{text('确认技能预览', 'Confirm skill preview')}
                  </Button>
                  <Button onClick={() => void publishSkill()} disabled={busy || !previewHash || currentReview.skillContentHash !== previewHash || !currentReview.confirmedAt || currentReview.confirmedWritingLanguage !== writingLanguage}>
                    {busy ? <LoaderCircle size={14} className="animate-spin" /> : <BookOpen size={14} />}
                    {latestReceipt ? text('发布 / 恢复已发布技能', 'Publish / recover skill') : text('发布到项目技能库', 'Publish to project skill library')}
                  </Button>
                  <Button variant="outline" onClick={() => void bindSkill()} disabled={busy || !latestReceipt || !publishedFileStatus?.exists || !publishedFileStatus.compatible || !publishedFileStatus.matchesPublishedHash || publishedFileStatus.boundToRefinement} title={text('确认将项目技能设为修稿阶段绑定；已有绑定时会显示替换确认', 'Confirm this project skill for refinement; an existing binding will be shown for confirmation')}>
                    {publishedFileStatus?.boundToRefinement ? <Check size={14} /> : <ArrowDownUp size={14} />}
                    {publishedFileStatus?.boundToRefinement ? text('已绑定到修稿阶段', 'Bound to refinement') : text('保存并绑定', 'Save and bind')}
                  </Button>
                </div>
                {latestReceipt && (
                  <div className="mt-4 space-y-1 text-xs text-[var(--color-text-secondary)]">
                    <p>{text('项目技能文件', 'Project skill file')}: <code className="break-all">{latestReceipt.relativePath}</code></p>
                    <p>{text('内容校验', 'Content check')}: {publishedFileStatus?.exists
                      ? publishedFileStatus.matchesPublishedHash && publishedFileStatus.compatible
                        ? text('文件存在且与发布回执一致', 'File exists and matches its publish receipt')
                        : text('文件已变化或当前不兼容', 'File changed or is incompatible')
                      : text('文件尚未读回', 'File has not been read back')}</p>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
