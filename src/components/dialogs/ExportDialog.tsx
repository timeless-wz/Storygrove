import { volumeChapterNumbers as getVolumeChapterNumbers } from '../../shared/prose-volume'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, FileText, Files, Type, XCircle, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import {
  exportNovel,
  exportSelectedMarkdown,
  loadBasicSettingsExportSnapshot,
  renderBasicSettingsMarkdown,
  type BasicSettingsExportSnapshot,
  type ExportFormat,
  type ExportProjectSnapshot,
  type MarkdownExportSettingKey,
} from '../../services/export-service'
import { ipc } from '../../services/ipc-client'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import { useLocaleStore } from '../../stores/locale-store'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../project-session-gate'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'
import type { BlueprintListSummary, BlueprintVolumeData } from '../../../electron/repositories/blueprint-repository'
import type {
  FinalizedDraftExportSnapshot,
} from '../../../electron/repositories/finalization-repository'
import type {
  DraftMarkdownSelectionRequest,
  DraftMarkdownSelectionSnapshot,
} from '../../shared/markdown-exchange'
import { resolveWritingLanguage } from '../../shared/writing-language'

type ExportScope = 'full-book' | 'chapter' | 'volume' | 'settings'
type SelectionCatalog = {
  drafts: DraftMeta[]
  assignments: Array<{ chapterNumber: number; volumeId: string | null }>
  blueprints: BlueprintListSummary[]
  volumes: BlueprintVolumeData[]
  planningVolumes: BlueprintVolumeData[]
  finalized: FinalizedDraftExportSnapshot[]
}

interface ExportTaskState {
  session: ProjectSessionContext
  exporting: boolean
  result: { success: boolean; path?: string; error?: string } | null
}

const SETTING_OPTIONS: Array<{ key: MarkdownExportSettingKey; zh: string; en: string }> = [
  { key: 'premise', zh: '故事前提', en: 'Story premise' },
  { key: 'worldview', zh: '世界观', en: 'Worldview' },
  { key: 'character-graph', zh: '角色图谱', en: 'Character graph' },
  { key: 'character-profiles', zh: '角色档案', en: 'Character profiles' },
]

function parseSelection(value: string): DraftMarkdownSelectionRequest | null {
  const [kind, idText] = value.split(':')
  const draftId = Number(idText)
  if (!Number.isSafeInteger(draftId) || draftId < 1 || (kind !== 'draft' && kind !== 'finalized')) return null
  return { kind, draftId }
}

export default function ExportDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const currentProject = useProjectStore(state => state.currentProject)
  const text = useLocaleStore(state => state.text)
  const locale = useLocaleStore(state => state.locale)
  const [scope, setScope] = useState<ExportScope>('full-book')
  const [format, setFormat] = useState<ExportFormat>('merged-md')
  const [includeOutline, setIncludeOutline] = useState(true)
  const [catalog, setCatalog] = useState<{ session: ProjectSessionContext; value: SelectionCatalog } | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [chapterNumber, setChapterNumber] = useState('')
  const [volumeId, setVolumeId] = useState('')
  const [selectedVersions, setSelectedVersions] = useState<Record<number, string>>({})
  const [settingKeys, setSettingKeys] = useState<MarkdownExportSettingKey[]>(SETTING_OPTIONS.map(option => option.key))
  const [preview, setPreview] = useState<DraftMarkdownSelectionSnapshot | null>(null)
  const [settingsPreview, setSettingsPreview] = useState<BasicSettingsExportSnapshot | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [taskState, setTaskState] = useState<ExportTaskState | null>(null)

  const activeTask = taskState && isProjectSessionCurrent(taskState.session) ? taskState : null
  const exporting = activeTask?.exporting ?? false
  const result = activeTask?.result ?? null
  const activeCatalog = catalog && isProjectSessionCurrent(catalog.session) ? catalog.value : null
  const catalogSession = catalog && isProjectSessionCurrent(catalog.session) ? catalog.session : null

  const loadCatalog = useCallback(async () => {
    const session = captureProjectSession(currentProject)
    if (!session) {
      setCatalogError(text('请先打开项目。', 'Open a project first.'))
      return
    }
    setLoadingCatalog(true)
    setCatalogError('')
    setPreview(null)
    try {
      const [drafts, blueprints, volumes, finalized, assignments, planningVolumes] = await Promise.all([
        ipc.invokeWithProjectSession(session, 'db:draft-list-all', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:blueprint-list-summary', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:prose-volume-list', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:draft-export-snapshot', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:chapter-volume-list', session.projectPath),
        ipc.invokeWithProjectSession(session, 'db:blueprint-volume-list', session.projectPath),
      ])
      if (!isProjectSessionCurrent(session)) return
      const value = { drafts, blueprints, volumes, finalized, assignments: assignments ?? [], planningVolumes }
      setCatalog({ session, value })
      const firstChapter = [...new Set([
        ...drafts.map(draft => draft.chapterNumber),
        ...finalized.map(draft => draft.chapterNumber),
      ])].sort((left, right) => left - right)[0]
      setChapterNumber(firstChapter ? String(firstChapter) : '')
      setVolumeId(volumes[0]?.id ?? '')
      setSelectedVersions({})
    } catch (error) {
      if (isProjectSessionCurrent(session)) setCatalogError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingCatalog(false)
    }
  }, [currentProject, text])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (isOpen) void loadCatalog()
      else {
        setCatalog(null)
        setPreview(null)
        setSettingsPreview(null)
        setTaskState(null)
      }
    })
    return () => { cancelled = true }
  }, [isOpen, loadCatalog])

  const finalByChapter = useMemo(() => {
    const map = new Map<number, SelectionCatalog['finalized'][number]>()
    for (const item of activeCatalog?.finalized ?? []) map.set(item.chapterNumber, item)
    return map
  }, [activeCatalog])

  const chapterNumbers = useMemo(() => [...new Set([
    ...(activeCatalog?.drafts.map(draft => draft.chapterNumber) ?? []),
    ...(activeCatalog?.finalized.map(draft => draft.chapterNumber) ?? []),
  ])].sort((left, right) => left - right), [activeCatalog])

  const volumeChapterNumbers = useMemo(() => {
    if (!activeCatalog || !volumeId) return []
    return getVolumeChapterNumbers(volumeId, activeCatalog.blueprints, activeCatalog.assignments)
  }, [activeCatalog, volumeId])

  const unassignedChapterNumbers = useMemo(() => {
    if (!activeCatalog) return []
    const assigned = new Set(activeCatalog.volumes.flatMap(volume => getVolumeChapterNumbers(volume.id, activeCatalog.blueprints, activeCatalog.assignments)))
    return [...new Set([
      ...activeCatalog.drafts.map(draft => draft.chapterNumber),
      ...activeCatalog.finalized.map(draft => draft.chapterNumber),
    ])]
      .filter(number => !assigned.has(number))
      .sort((left, right) => left - right)
  }, [activeCatalog])

  const invalidVolumeBlueprints = useMemo(() => {
    if (!activeCatalog) return []
    const volumeIds = new Set(activeCatalog.planningVolumes.map(volume => volume.id))
    return activeCatalog.blueprints.filter(blueprint => blueprint.volumeId && !volumeIds.has(blueprint.volumeId))
  }, [activeCatalog])

  const getChapterOptions = (number: number) => {
    const drafts = (activeCatalog?.drafts ?? []).filter(draft => draft.chapterNumber === number && ['draft', 'revised', 'reviewed'].includes(draft.status))
    const finalized = finalByChapter.get(number)
    return [
      ...drafts.map(draft => ({
        value: `draft:${draft.id}`,
        label: text(`草稿 v${draft.version} · ${draft.status}${draft.chapterTitle ? ` · ${draft.chapterTitle}` : ''}`, `Draft v${draft.version} · ${draft.status}${draft.chapterTitle ? ` · ${draft.chapterTitle}` : ''}`),
      })),
      ...(finalized ? [{
        value: `finalized:${finalized.draftId}`,
        label: text(`正文（当前定稿 v${finalized.version}）${finalized.title ? ` · ${finalized.title}` : ''}`, `Manuscript (current finalized v${finalized.version})${finalized.title ? ` · ${finalized.title}` : ''}`),
      }] : []),
    ]
  }

  const selectedChapterNumbers = scope === 'chapter'
    ? (chapterNumber ? [Number(chapterNumber)] : [])
    : scope === 'volume' ? volumeChapterNumbers : []
  const missingVersions = selectedChapterNumbers.filter(number => !selectedVersions[number])
  const selectedForPreview = selectedChapterNumbers
    .map(number => parseSelection(selectedVersions[number] ?? ''))
    .filter((item): item is DraftMarkdownSelectionRequest => item !== null)

  const refreshPreview = async () => {
    if (!catalogSession || !activeCatalog || loadingPreview) return
    if (scope === 'settings') {
      if (!settingKeys.length) {
        setPreviewError(text('请至少勾选一项基础设定。', 'Select at least one basic setting.'))
        return
      }
      setLoadingPreview(true)
      setPreviewError('')
      try {
        const snapshot = await loadBasicSettingsExportSnapshot(catalogSession)
        if (!isProjectSessionCurrent(catalogSession)) return
        setSettingsPreview(snapshot)
        setPreview({ chapters: [], receipt: [] })
      } catch (error) {
        if (isProjectSessionCurrent(catalogSession)) setPreviewError(error instanceof Error ? error.message : String(error))
      } finally {
        setLoadingPreview(false)
      }
      return
    }
    if (missingVersions.length) {
      setPreviewError(text(`还有 ${missingVersions.length} 章未选择版本；不能静默跳过。`, `${missingVersions.length} chapter(s) have no selected version. Every chapter must be explicit.`))
      setPreview(null)
      return
    }
    if (scope === 'volume' && invalidVolumeBlueprints.length > 0) {
      setPreviewError(text('蓝图引用了不存在的卷；请先修复卷归属。', 'Some blueprints reference missing volumes. Repair their volume assignments first.'))
      setPreview(null)
      return
    }
    if (!selectedForPreview.length) {
      setPreviewError(text('请先选择章节及其草稿版本或正文。', 'Choose a chapter and its draft version or finalized text first.'))
      return
    }
    setLoadingPreview(true)
    setPreviewError('')
    try {
      const snapshot = await ipc.invokeWithProjectSession(catalogSession, 'db:draft-export-selection', selectedForPreview, catalogSession.projectPath)
      if (!isProjectSessionCurrent(catalogSession)) return
      setPreview(snapshot)
      setSettingsPreview(null)
    } catch (error) {
      if (isProjectSessionCurrent(catalogSession)) setPreviewError(error instanceof Error ? error.message : String(error))
      setPreview(null)
    } finally {
      setLoadingPreview(false)
    }
  }

  const exportNow = async () => {
    if (!currentProject || exporting) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const session = scope === 'full-book' ? projectSession : catalogSession
    if (!session) return
    const approvedPreview = preview
    if (scope !== 'full-book' && (!approvedPreview || (scope === 'settings' && !settingsPreview))) {
      setPreviewError(text('请先查看导出预览。', 'Load the export preview first.'))
      return
    }
    const projectSnapshot: ExportProjectSnapshot = Object.freeze({
      id: session.projectId,
      sessionLease: session.leaseId,
      path: session.projectPath,
      name: currentProject.name,
      novelConfig: Object.freeze({
        genre: currentProject.novelConfig.genre,
        targetAudience: currentProject.novelConfig.targetAudience,
        writingLanguage: resolveWritingLanguage(currentProject.novelConfig.writingLanguage),
      }),
    })
    const destination = await ipc.invoke('dialog:select-export-directory')
    if (!destination || !isProjectSessionCurrent(session)) return
    setTaskState({ session, exporting: true, result: null })
    const res = scope === 'full-book'
      ? await exportNovel({ format, grantId: destination.grantId, includeOutline }, projectSnapshot, projectSession)
      : await exportSelectedMarkdown({
          range: scope,
          format: format === 'split-md' ? 'split-md' : 'merged-md',
          grantId: destination.grantId,
          selections: approvedPreview!.receipt.map(({ draftId, kind }) => ({ draftId, kind })),
          settings: scope === 'settings' ? settingKeys : undefined,
          scopeName: scope === 'chapter'
            ? text(`第 ${chapterNumber} 章`, `Chapter ${chapterNumber}`)
            : activeCatalog?.volumes.find(volume => volume.id === volumeId)?.name,
          volumeId: scope === 'volume' ? volumeId : undefined,
          expectedChapterNumbers: scope === 'volume' ? volumeChapterNumbers : undefined,
         }, projectSnapshot, session, approvedPreview!.receipt, settingsPreview ?? undefined)
    if (!isProjectSessionCurrent(session)) return
    setTaskState({
      session,
      exporting: false,
      result: res.success && res.path ? { ...res, path: `${destination.displayName}/${res.path}` } : res,
    })
  }

  const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; desc: string; icon: React.ReactNode }> = [
    { value: 'merged-md', label: text('合并 Markdown', 'Merged Markdown'), desc: scope === 'full-book' ? text('全书合并为单个 .md 文件', 'Combine the full book into one .md file') : text('合并为一个 .md 文件', 'Combine into one .md file'), icon: <FileText size={18} /> },
    { value: 'split-md', label: text('分章／分项 Markdown', 'Separate Markdown files'), desc: text('每章或每项设定一个独立 .md 文件', 'One .md file per chapter or setting'), icon: <Files size={18} /> },
    ...(scope === 'full-book' ? [
      { value: 'txt' as const, label: text('纯文本 TXT', 'Plain text'), desc: text('去除格式标记的纯文本', 'Export plain text without formatting'), icon: <Type size={18} /> },
      { value: 'word' as const, label: text('Word 文档', 'Word document'), desc: text('导出可用 Word 打开的文档', 'Export a document that opens in Word'), icon: <FileText size={18} /> },
    ] : []),
  ]

  const chooseScope = (next: ExportScope) => {
    setScope(next)
    setFormat(next === 'full-book' ? 'merged-md' : 'merged-md')
    setPreview(null)
    setSettingsPreview(null)
    setPreviewError('')
    setSelectedVersions({})
  }

  const previewSettings = settingsPreview
    ? renderBasicSettingsMarkdown(settingsPreview, settingKeys, locale)
    : []
  return (
    <Dialog open={isOpen} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-[760px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download size={16} className="text-[var(--color-accent)]" />
            {text('导出项目', 'Export project')}
          </DialogTitle>
          <DialogDescription>{text('先选导出范围，再选格式。单章、单卷和基础设定会显示数据库来源预览。', 'Choose a scope and then a format. Chapter, volume, and basic-setting exports show a preview from project data.')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium">{text('范围', 'Scope')}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ['full-book', '全书', 'Full book'], ['chapter', '单章', 'One chapter'],
                ['volume', '单卷', 'One volume'], ['settings', '基础设定', 'Basic settings'],
              ] as const).map(([value, zh, en]) => (
                <Button key={value} type="button" variant={scope === value ? 'default' : 'outline'} aria-pressed={scope === value} onClick={() => chooseScope(value)}>{text(zh, en)}</Button>
              ))}
            </div>
          </div>

          {scope !== 'full-book' && (
            <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
              {loadingCatalog && <div className="flex items-center gap-2 text-xs"><RefreshCw size={13} className="animate-spin" />{text('读取项目章节和卷目录…', 'Reading project chapters and volumes…')}</div>}
              {catalogError && <div role="alert" className="text-xs text-[var(--color-error-text)]">{catalogError}</div>}
              {scope === 'chapter' && activeCatalog && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs"><span>{text('章号', 'Chapter')}</span><select className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" value={chapterNumber} onChange={event => { setChapterNumber(event.target.value); setPreview(null) }}>
                    <option value="">{text('选择章号', 'Choose a chapter')}</option>{chapterNumbers.map(number => <option key={number} value={number}>{text(`第 ${number} 章`, `Chapter ${number}`)}</option>)}
                  </select></label>
                  {chapterNumber && <label className="space-y-1 text-xs"><span>{text('该章导出版本', 'Version to export')}</span><select className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" value={selectedVersions[Number(chapterNumber)] ?? ''} onChange={event => { setSelectedVersions(previous => ({ ...previous, [Number(chapterNumber)]: event.target.value })); setPreview(null) }}>
                    <option value="">{text('明确选择一个版本', 'Choose exactly one version')}</option>{getChapterOptions(Number(chapterNumber)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select></label>}
                </div>
              )}

              {scope === 'volume' && activeCatalog && (
                <>
                  <label className="block space-y-1 text-xs"><span>{text('卷', 'Volume')}</span><select className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" value={volumeId} onChange={event => { setVolumeId(event.target.value); setSelectedVersions({}); setPreview(null) }}>
                    <option value="">{text('选择卷', 'Choose a volume')}</option>{activeCatalog.volumes.map(volume => <option key={volume.id} value={volume.id}>{volume.name}</option>)}
                  </select></label>
                  {volumeChapterNumbers.length === 0
                    ? <p className="text-xs text-[var(--color-error-text)]">{text('该卷没有章节蓝图；不能推测章节归属。请先为章节分配到该卷。', 'This volume has no chapter blueprints. Assign chapters to the volume before exporting.')}</p>
                    : <div className="space-y-2">{volumeChapterNumbers.map(number => {
                      const options = getChapterOptions(number)
                      const blueprint = activeCatalog.blueprints.find(item => item.chapterNumber === number)
                      return <label key={number} className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-[minmax(120px,0.7fr)_minmax(240px,1.3fr)] sm:items-center">
                        <span>{text(`第 ${number} 章`, `Chapter ${number}`)}{blueprint?.title ? ` · ${blueprint.title}` : ''}</span>
                        <select className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" value={selectedVersions[number] ?? ''} onChange={event => { setSelectedVersions(previous => ({ ...previous, [number]: event.target.value })); setPreview(null) }}>
                          <option value="">{options.length ? text('请选择草稿版本或正文', 'Choose a draft or finalized text') : text('缺少可导出版本', 'No exportable version')}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    })}</div>}
                  {unassignedChapterNumbers.length > 0 && <div className="rounded border border-[var(--color-warning-border,var(--color-border))] p-2 text-xs text-[var(--color-warning-text)]">{text(`另有正文章节未绑定蓝图／卷归属：${unassignedChapterNumbers.map(number => `第${number}章`).join('、')}。它们不会被自动塞入本卷；请先建立蓝图并指定卷，或改用单章导出。`, `Draft or finalized chapters without blueprint volume ownership: ${unassignedChapterNumbers.join(', ')}. They will not be guessed into this volume. Add blueprint volume ownership or export them individually.`)}</div>}
                  {invalidVolumeBlueprints.length > 0 && <div role="alert" className="text-xs text-[var(--color-error-text)]">{text(`有 ${invalidVolumeBlueprints.length} 份蓝图引用不存在的卷。请修复卷归属后再导出。`, `${invalidVolumeBlueprints.length} blueprint(s) reference a missing volume. Repair their volume assignment before exporting.`)}</div>}
                </>
              )}

              {scope === 'settings' && <div className="grid grid-cols-2 gap-2">
                {SETTING_OPTIONS.map(option => <label key={option.key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settingKeys.includes(option.key)} onChange={event => {
                  setSettingKeys(previous => event.target.checked ? [...previous, option.key] : previous.filter(key => key !== option.key))
                  setSettingsPreview(null)
                  setPreview(null)
                }} />{text(option.zh, option.en)}</label>)}
              </div>}

              {scope !== 'settings' && selectedChapterNumbers.length > 0 && <div className="text-xs text-[var(--color-text-muted)]">{text(`已明确选择 ${selectedForPreview.length}/${selectedChapterNumbers.length} 章；缺少 ${missingVersions.length} 章。`, `${selectedForPreview.length}/${selectedChapterNumbers.length} chapters selected; ${missingVersions.length} missing.`)}</div>}
              {scope !== 'volume' || volumeChapterNumbers.length > 0 ? <Button type="button" variant="outline" onClick={() => void refreshPreview()} disabled={loadingPreview || loadingCatalog || !activeCatalog}>
                {loadingPreview ? <RefreshCw size={13} className="mr-2 animate-spin" /> : <FileText size={13} className="mr-2" />}{text('刷新实际导出预览', 'Load actual export preview')}
              </Button> : null}
              {previewError && <div role="alert" className="text-xs text-[var(--color-error-text)]">{previewError}</div>}
              {preview && scope !== 'settings' && <div className="max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs">
                <div className="mb-2 font-medium">{text('将导出的章节与正文预览', 'Chapters and prose selected for export')}</div>
                {preview.chapters.map(chapter => {
                  const chapterLabel = chapter.kind === 'finalized'
                    ? text(`第 ${chapter.chapterNumber} 章 · 正文 v${chapter.version}`, `Chapter ${chapter.chapterNumber} · Manuscript v${chapter.version}`)
                    : text(`第 ${chapter.chapterNumber} 章 · 草稿 v${chapter.version}（${chapter.status}）`, `Chapter ${chapter.chapterNumber} · Draft v${chapter.version} (${chapter.status})`)
                  return (
                    <section key={chapter.draftId} className="mb-3 border-b border-[var(--color-border)] pb-3 last:border-0">
                      <strong>{chapterLabel}</strong>
                      {chapter.title && <div className="mt-1">{chapter.title}</div>}
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-[var(--color-text-secondary)]">{chapter.content.slice(0, 1600)}{chapter.content.length > 1600 ? text('\n…（预览截断；导出保留完整正文）', '\n… (preview shortened; full text will be exported)') : ''}</pre>
                    </section>
                  )
                })}
              </div>}
              {preview && scope === 'settings' && <div className="max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs">
                {previewSettings.map(file => <section key={file.key} className="mb-3 border-b border-[var(--color-border)] pb-3 last:border-0"><pre className="whitespace-pre-wrap font-sans">{file.content}</pre></section>)}
              </div>}
            </div>
          )}

          {scope === 'full-book' && <>
            <div className="space-y-2">{FORMAT_OPTIONS.map(option => <button key={option.value} type="button" onClick={() => setFormat(option.value)} className={cn('flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors', format === option.value ? 'border-[var(--color-accent)] bg-[var(--color-active)]' : 'border-[var(--color-border)] bg-[var(--color-panel)] hover:bg-[var(--color-hover)]')}>
              <span className={format === option.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}>{option.icon}</span><span><span className="block text-xs font-medium">{option.label}</span><span className="block text-xs text-[var(--color-text-muted)]">{option.desc}</span></span>
            </button>)}</div>
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"><input type="checkbox" checked={includeOutline} onChange={event => setIncludeOutline(event.target.checked)} />{text('包含故事大纲', 'Include story outline')}</label>
          </>}

          {scope === 'volume' && <div className="flex gap-3">{FORMAT_OPTIONS.slice(0, 2).map(option => <label key={option.value} className="flex items-center gap-2 text-xs"><input type="radio" name="volume-format" checked={format === option.value} onChange={() => setFormat(option.value)} />{option.label}</label>)}</div>}
          {scope === 'settings' && <div className="flex gap-3">{FORMAT_OPTIONS.slice(0, 2).map(option => <label key={option.value} className="flex items-center gap-2 text-xs"><input type="radio" name="settings-format" checked={format === option.value} onChange={() => setFormat(option.value)} />{option.label}</label>)}</div>}

          {result && <div className={cn('rounded-lg p-3 text-xs', result.success ? 'bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-success-text)]' : 'bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)] text-[var(--color-error-text)]')}>
            {result.success ? <CheckCircle2 size={14} className="mr-1 inline" /> : <XCircle size={14} className="mr-1 inline" />}
            {result.success ? text(`已导出到：${result.path}`, `Exported to: ${result.path}`) : result.error}
          </div>}
        </div>

        <DialogFooter className="justify-end">
             <Button type="button" variant="default" onClick={() => void exportNow()} disabled={exporting || (scope !== 'full-book' && (!catalogSession || !preview || (scope === 'settings' && !settingsPreview) || (scope === 'volume' && (missingVersions.length > 0 || invalidVolumeBlueprints.length > 0))))}>
            <Download size={13} />{exporting ? text('导出中...', 'Exporting...') : text('选择目录并导出', 'Choose folder and export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
