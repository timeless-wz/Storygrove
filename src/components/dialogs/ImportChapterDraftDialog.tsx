import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileUp, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { ipc } from '../../services/ipc-client'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { DraftMeta } from '../../../electron/repositories/draft-repository'
import type { MarkdownChapterDraftInspection } from '../../shared/markdown-exchange'
import { DRAFT_STATUS_LABEL } from '../../shared/draft-status'
import { captureProjectSession, isProjectSessionCurrent } from '../project-session-gate'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'

interface Props {
  open: boolean
  onClose: () => void
}

interface ImportTask {
  session: ProjectSessionContext
  busy: boolean
  inspection: MarkdownChapterDraftInspection | null
  existing: DraftMeta[]
  result: string | null
  error: string | null
}

export default function ImportChapterDraftDialog({ open, onClose }: Props) {
  const project = useProjectStore(state => state.currentProject)
  const text = useLocaleStore(state => state.text)
  const [task, setTask] = useState<ImportTask | null>(null)
  const active = task && isProjectSessionCurrent(task.session) ? task : null
  const sessionChanged = Boolean(task && !isProjectSessionCurrent(task.session))
  const busy = active?.busy ?? false
  const inspection = active?.inspection ?? null
  const existing = active?.existing ?? []
  const error = active?.error ?? null
  const result = active?.result ?? null

  useEffect(() => {
    if (!open) setTask(null)
  }, [open])

  const draftsByChapter = useMemo(() => {
    const grouped = new Map<number, DraftMeta[]>()
    for (const draft of existing) grouped.set(draft.chapterNumber, [...(grouped.get(draft.chapterNumber) ?? []), draft])
    return grouped
  }, [existing])

  const chooseFiles = async () => {
    const session = captureProjectSession(project)
    if (!session) {
      setTask({ session: {} as ProjectSessionContext, busy: false, inspection: null, existing: [], result: null, error: text('请先打开项目。', 'Open a project first.') })
      return
    }
    setTask({ session, busy: true, inspection: null, existing: [], result: null, error: null })
    try {
      const picked = await ipc.invoke('dialog:select-chapter-markdown-files', session)
      if (!isProjectSessionCurrent(session)) return
      if (!picked) {
        setTask(current => current?.session === session ? { ...current, busy: false } : current)
        return
      }
      if ('success' in picked) {
        setTask({ session, busy: false, inspection: null, existing: [], result: null, error: picked.error })
        return
      }
      const drafts = await ipc.invokeWithProjectSession(session, 'db:draft-list-all', session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      setTask({ session, busy: false, inspection: picked, existing: drafts, result: null, error: null })
    } catch (cause) {
      if (!isProjectSessionCurrent(session)) return
      setTask({ session, busy: false, inspection: null, existing: [], result: null, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const confirmImport = async () => {
    if (!active || !inspection || busy || !isProjectSessionCurrent(active.session)) return
    const session = active.session
    setTask({ ...active, busy: true, error: null, result: null })
    try {
      const committed = await ipc.invokeWithProjectSession(
        session,
        'db:draft-import-markdown',
        inspection.inspectionId,
        session,
        session.projectPath,
      )
      if (!isProjectSessionCurrent(session)) return
      if (!committed.success || !committed.created) throw new Error(committed.error ?? text('创建草稿失败。', 'Could not create draft versions.'))
      const readBack = await Promise.all(committed.created.map(item => ipc.invokeWithProjectSession(
        session,
        'db:draft-get-full',
        item.id,
        session.projectPath,
      )))
      if (!isProjectSessionCurrent(session)) return
      const allReadBack = readBack.every((draft, index) => draft
        && draft.status === 'draft'
        && draft.chapterNumber === committed.created?.[index]?.chapterNumber
        && draft.version === committed.created?.[index]?.version
        && draft.content.length === inspection.chapters.find(chapter => chapter.number === draft.chapterNumber)?.contentLength)
      if (!allReadBack) throw new Error(text('数据库回读与导入预览不一致；请检查章节草稿列表。', 'Database read-back did not match the import preview. Check the chapter draft list.'))
      setTask({
        ...active,
        busy: false,
        result: text(`已创建 ${committed.created.length} 个新草稿版本，并逐章从数据库回读核对。`, `Created ${committed.created.length} new draft versions and verified each by reading it back from the database.`),
        error: null,
      })
    } catch (cause) {
      if (!isProjectSessionCurrent(session)) return
      setTask({ ...active, busy: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const cancel = () => {
    setTask(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && cancel()}>
      <DialogContent className="max-w-[680px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileUp size={16} />{text('作为章节内容导入数据库', 'Import as chapter content')}</DialogTitle>
          <DialogDescription>{text('来源文件只读。先预览目标项目、章号、标题、正文长度和现有版本；确认后只新增草稿版本，不覆盖正文或定稿。', 'Source files are read-only. Review the target project, chapter numbers, titles, body lengths, and existing versions. Confirmation creates new drafts only; it never replaces or finalizes prose.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-xs">
            <strong>{text('目标项目', 'Target project')}:</strong> {project?.name ?? text('未打开', 'No project open')}
            {project && <span className="ml-2 text-[var(--color-text-muted)]">{project.path}</span>}
          </div>
          {sessionChanged && <div role="alert" className="rounded border border-[var(--color-error-text)] p-3 text-xs text-[var(--color-error-text)]">{text('项目会话已切换，原 Markdown 预览已取消。请在当前项目重新选择文件。', 'The project session changed, so the Markdown preview was canceled. Choose the files again for the current project.')}</div>}

          <Button type="button" variant="outline" onClick={() => void chooseFiles()} disabled={busy || !project}>
            {busy ? <RefreshCw size={14} className="mr-2 animate-spin" /> : <FileUp size={14} className="mr-2" />}
            {inspection ? text('重新选择 Markdown 文件', 'Choose Markdown files again') : text('选择 .md / .markdown 文件', 'Choose .md / .markdown files')}
          </Button>

          {inspection && (
            <>
              <div className="text-xs text-[var(--color-text-secondary)]">
                {text('来源', 'Sources')}: {inspection.sourceNames.join('、')} · {text('大小', 'Size')}: {inspection.totalBytes.toLocaleString()} B
              </div>
              <div className="max-h-64 overflow-auto rounded border border-[var(--color-border)]">
                <table className="w-full text-xs">
                  <thead><tr className="bg-[var(--color-panel)] text-left"><th className="p-2">{text('目标章号 / 标题', 'Target chapter / title')}</th><th className="p-2">{text('正文长度', 'Body length')}</th><th className="p-2">{text('现有版本 / 冲突', 'Existing versions / conflict')}</th></tr></thead>
                  <tbody>{inspection.chapters.map(chapter => {
                    const versions = draftsByChapter.get(chapter.number) ?? []
                    const nextVersion = Math.max(0, ...versions.map(item => item.version)) + 1
                    return <tr key={chapter.number} className="border-t border-[var(--color-border)] align-top">
                      <td className="p-2"><strong>{text(`第 ${chapter.number} 章`, `Chapter ${chapter.number}`)}</strong>{chapter.title && <div className="text-[var(--color-text-secondary)]">{chapter.title}</div>}</td>
                      <td className="p-2">{chapter.contentLength.toLocaleString()} {text('字符', 'characters')}<div className="text-[var(--color-text-muted)]">{chapter.wordCount.toLocaleString()} {text('字', 'units')}</div></td>
                      <td className="p-2">{versions.length === 0
                        ? text(`无冲突；将创建 v${nextVersion}`, `No existing version; will create v${nextVersion}`)
                        : <><span className="inline-flex items-center gap-1 text-[var(--color-warning-text)]"><AlertTriangle size={12} />{text(`已有 ${versions.length} 个版本；将新增 v${nextVersion}`, `${versions.length} existing version(s); will append v${nextVersion}`)}</span><div className="mt-1 text-[var(--color-text-muted)]">{versions.map(version => `${version.chapterTitle ? `${version.chapterTitle} ` : ''}v${version.version} ${DRAFT_STATUS_LABEL[version.status] ?? version.status}`).join(' · ')}</div></>}
                      </td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
              {result && <div className="flex items-start gap-2 rounded bg-[var(--color-success-bg)] p-3 text-xs text-[var(--color-success-text)]"><CheckCircle2 size={14} />{result}</div>}
            </>
          )}
          {error && <div role="alert" className="rounded bg-[var(--color-error-bg)] p-3 text-xs text-[var(--color-error-text)]">{error}</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>{text('取消', 'Cancel')}</Button>
          {inspection && <Button type="button" onClick={() => void confirmImport()} disabled={busy || !active || !isProjectSessionCurrent(active.session)}>{busy ? text('处理中...', 'Working...') : text('确认新增草稿版本', 'Confirm new draft versions')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
