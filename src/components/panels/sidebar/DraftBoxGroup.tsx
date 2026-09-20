/**
 * DraftBoxGroup — 草稿箱折叠组（含章节分组和单条草稿条目）
 */

import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, CheckCircle2, FileText, FolderOpen, Copy, Trash2, FilePen, Plus, Link2 } from 'lucide-react'
import type { DraftMeta } from '../../../stores/draft-store'
import { useDraftStore, readDraftBody } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { confirm } from '../../ui/Confirm'
import { DRAFT_STATUS_LABEL, DRAFT_STATUS_COLOR } from '../../../shared/draft-status'
import { showSidebarMenu } from './sidebar-menu'
import { ipc } from '../../../services/ipc-client'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../../project-session-gate'
import { deleteFinalizedChapter } from './finalized-chapter-deletion'
import { NewDraftDialog } from './NewDraftDialog'
import { BlueprintBindingDialog, type BlueprintBindingTarget } from './BlueprintBindingDialog'

const DRAFT_STATUS_EN: Record<string, string> = {
  draft: 'Draft', revising: 'Revising', reviewed: 'Reviewed', finalized: 'Published', archived: 'Archived',
}

// ===== 草稿箱折叠组 =====

export default function DraftBoxGroup({
  draftsByChapter,
}: {
  draftsByChapter: Record<number, DraftMeta[]>
}) {
  const [open, setOpen] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [bindingTarget, setBindingTarget] = useState<BlueprintBindingTarget | null>(null)
  const text = useLocaleStore(s => s.text)
  const projectKey = useProjectStore(s => s.currentProject?.path)
  if (!projectKey) return null

  // 所有章节号排序
  const chapterNums = Object.keys(draftsByChapter)
    .map(Number)
    .sort((a, b) => a - b)

  // 已发布章节只属于“正文章节”；草稿箱只保留未发布稿件。
  const draftChapterNums = chapterNums.filter(n =>
    (draftsByChapter[n] || []).some(d => d.status !== 'archived' && d.status !== 'finalized')
  )

  const openCreateDialog = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setCreateDialogOpen(true)
  }

  return (
    <div>
      {/* 草稿箱标题行 */}
      <div
        className="tree-item gap-1.5 cursor-pointer select-none"
        style={{ paddingLeft: 10 }}
        onClick={() => setOpen(v => !v)}
        title={text('草稿箱：AI 生成后的章节草稿在此管理，发布后进入正文章节', 'Draft box: manage AI-generated drafts here. Published drafts move to the manuscript.')}
      >
        {open
          ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        }
        <FilePen size={14} style={{ color: 'var(--color-text-muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{text('草稿箱', 'Draft box')}</span>
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] hover:bg-[var(--color-hover)]"
          style={{ color: 'var(--color-accent)' }}
          title={text('新建自由草稿', 'Create free draft')}
          onClick={openCreateDialog}
        >
          <Plus size={12} />
          <span>{text('新建草稿', 'New draft')}</span>
        </button>
        {draftChapterNums.length > 0 && (
          <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
            {text(`${draftChapterNums.length} 章`, `${draftChapterNums.length} chapters`)}
          </span>
        )}
      </div>

      {open && (
        <div>
          {draftChapterNums.length === 0 ? (
            <div
              className="text-xs py-1"
              style={{ paddingLeft: 34, color: 'var(--color-text-muted)' }}
            >
              {text('暂无草稿。可新建自由草稿，或从章节蓝图点击「写作此章」创作。', 'No drafts. Create a free draft or use “Write chapter” from a chapter blueprint.')}
            </div>
          ) : (
            draftChapterNums.map(chNum => (
              <DraftChapterItems
                key={chNum}
                chapterNumber={chNum}
                drafts={draftsByChapter[chNum] || []}
                projectKey={projectKey}
                onBindBlueprint={setBindingTarget}
              />
            ))
          )}
        </div>
      )}

      <NewDraftDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        suggestedChapterNumber={Math.max(0, ...chapterNums) + 1}
      />
      <BlueprintBindingDialog
        open={bindingTarget !== null}
        onOpenChange={open => { if (!open) setBindingTarget(null) }}
        target={bindingTarget}
      />
    </div>
  )
}

// ===== 单章草稿分组 =====

function DraftChapterItems({
  chapterNumber,
  drafts,
  projectKey,
  onBindBlueprint,
}: {
  chapterNumber: number
  drafts: DraftMeta[]
  projectKey: string
  onBindBlueprint: (target: BlueprintBindingTarget) => void
}) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  // 发布后只在正文章节出现；这里不再生成“第 N 章 → 草稿_vN”的二级菜单。
  const activeDrafts = drafts.filter(d => d.status !== 'archived' && d.status !== 'finalized')
  const archivedDrafts = drafts.filter(d => d.status === 'archived')
  const [showArchived, setShowArchived] = useState(false)
  const [bpTitle, setBpTitle] = useState<{ projectKey: string; title: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get', chapterNumber, projectKey).then(bp => {
      if (!cancelled && isProjectSessionCurrent(projectSession) && bp?.title) {
        setBpTitle({ projectKey, title: bp.title })
      }
    }).catch(() => { })
    return () => { cancelled = true }
  }, [chapterNumber, currentProject, projectKey])

  const scopedBlueprintTitle = bpTitle?.projectKey === projectKey ? bpTitle.title : ''
  const baseTitle = scopedBlueprintTitle || drafts[0]?.chapterTitle || ''
  const cleanTitle = baseTitle.startsWith(`第${chapterNumber}章`)
    ? baseTitle.replace(`第${chapterNumber}章`, '').trim()
    : baseTitle
  const displayTitle = text(
    cleanTitle ? `第${chapterNumber}章 ${cleanTitle}` : `第${chapterNumber}章`,
    cleanTitle ? `Chapter ${chapterNumber} ${cleanTitle}` : `Chapter ${chapterNumber}`
  )

  return (
    <div>
          {activeDrafts.map(draft => (
            <DraftItem
              key={draft.filePath}
              draft={draft}
              chapterTitleText={displayTitle}
              projectKey={projectKey}
              onBindBlueprint={onBindBlueprint}
              compact
              showVersion={activeDrafts.length + archivedDrafts.length > 1}
            />
          ))}

          {/* 显示归档草稿的切换按钮 */}
          {archivedDrafts.length > 0 && (
            <div
              className="flex items-center gap-1 cursor-pointer select-none"
              style={{ paddingLeft: 30 }}
              onClick={() => setShowArchived(v => !v)}
            >
              <span className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
                {showArchived ? <><ChevronDown size={10} className="inline" /> {text('隐藏', 'Hide')}</> : <><ChevronRight size={10} className="inline" /> {text(`${archivedDrafts.length} 个已归档`, `${archivedDrafts.length} archived`)}</>}
              </span>
            </div>
          )}
          {showArchived && archivedDrafts.map(draft => (
            <DraftItem
              key={draft.filePath}
              draft={draft}
              chapterTitleText={displayTitle}
              projectKey={projectKey}
              onBindBlueprint={onBindBlueprint}
              archived
              compact
              showVersion
            />
          ))}
    </div>
  )
}

// ===== 单条草稿条目 =====

function DraftItem({
  draft,
  chapterTitleText,
  projectKey,
  archived = false,
  compact = false,
  showVersion = false,
  onBindBlueprint,
}: {
  draft: DraftMeta
  chapterTitleText: string
  projectKey: string
  archived?: boolean
  compact?: boolean
  showVersion?: boolean
  onBindBlueprint: (target: BlueprintBindingTarget) => void
}) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const statusLabel = text(DRAFT_STATUS_LABEL[draft.status] || draft.status, DRAFT_STATUS_EN[draft.status] || draft.status)
  /** 打开草稿到编辑器 */
  const openDraft = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const content = await readDraftBody(draft.filePath, projectKey, projectSession)
    if (!isProjectSessionCurrent(projectSession)) return
    useEditorStore.getState().openFile({
      id: draft.filePath,
      name: `${chapterTitleText} v${draft.version}`,
      type: 'chapter',
      filePath: draft.filePath,
      content,
      savedContent: content,
      draftId: draft.id,
      chapterNumber: draft.chapterNumber,
      draftStatus: draft.status,
      projectKey,
      projectSessionLease: projectSession.leaseId,
    })
  }

  /** 删除草稿 */
  const deleteDraft = async () => {
    if (draft.status === 'finalized') {
      await deleteFinalizedChapter({
        project: currentProject,
        projectPath: projectKey,
        draftId: draft.id,
        chapterNumber: draft.chapterNumber,
        displayName: `${chapterTitleText} v${draft.version}`,
        tabFilePath: draft.filePath,
        surface: 'draft',
      })
      return
    }

    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const ok = await confirm(
      text(`确认删除 "${chapterTitleText} v${draft.version}"？\n此操作会删除该稿正文记录及关联的审稿/修稿产物，不可撤销。`, `Delete “${chapterTitleText} v${draft.version}”?\nThis permanently removes the draft and related review/revision artifacts.`),
      { title: text('删除这一稿', 'Delete draft'), confirmText: text('删除', 'Delete'), danger: true }
    )
    if (!ok || !isProjectSessionCurrent(projectSession)) return
    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:draft-delete',
      draft.id,
      projectKey,
    )
    if (!isProjectSessionCurrent(projectSession)) return
    if (result.errorCode === 'FINALIZED_DRAFT_DELETE_REQUIRED') {
      await useDraftStore.getState().loadChapterDrafts(
        draft.chapterNumber,
        projectKey,
        projectSession,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      await deleteFinalizedChapter({
        project: currentProject,
        projectPath: projectKey,
        draftId: draft.id,
        chapterNumber: draft.chapterNumber,
        displayName: `${chapterTitleText} v${draft.version}`,
        tabFilePath: draft.filePath,
        surface: 'draft',
      })
      return
    }
    if (!result.success) {
      toast.error(text(`删除失败\n\n${result.error ?? '未知错误'}`, `Delete failed\n\n${result.error ?? 'Unknown error'}`))
      return
    }
    const editor = useEditorStore.getState()
    const tab = editor.tabs.find(t =>
      t.projectKey === projectKey && (t.id === draft.filePath || t.filePath === draft.filePath)
    )
    if (tab) editor.closeTab(tab.id)
    await useDraftStore.getState().loadChapterDrafts(
      draft.chapterNumber,
      projectKey,
      projectSession,
    )
    if (!isProjectSessionCurrent(projectSession)) return
    globalEventBus.emit('REFRESH_RESOURCE', {
      resources: ['drafts', 'fileTree'],
      projectPath: projectKey,
      projectSession,
    })
    toast.success(text(`已删除 ${chapterTitleText} v${draft.version}`, `Deleted ${chapterTitleText} v${draft.version}`))
  }

  const isFinalized = draft.status === 'finalized'

  return (
    <div
      className="relative flex items-center gap-1.5 cursor-pointer hover:bg-[var(--color-hover)]"
      style={{
        paddingLeft: compact ? 30 : 50,
        paddingRight: 8,
        paddingTop: 3,
        paddingBottom: 3,
        opacity: archived ? 0.45 : 1,
      }}
      onClick={openDraft}
      onContextMenu={e => showSidebarMenu([
        {
          key: 'open',
          label: text('打开草稿', 'Open draft'),
          icon: <FolderOpen size={13} />,
          onClick: openDraft,
        },
        { key: 'div1', type: 'divider' as const },
        {
          key: 'copy-path',
          label: text('复制文件路径', 'Copy file path'),
          icon: <Copy size={13} />,
          onClick: () => navigator.clipboard.writeText(draft.filePath).catch(() => { }),
        },
        { key: 'div2', type: 'divider' as const },
        {
          key: 'bind-blueprint',
          label: text('绑定蓝图', 'Link blueprint'),
          icon: <Link2 size={13} />,
          onClick: () => onBindBlueprint({
            draftId: draft.id,
            chapterNumber: draft.chapterNumber,
            blueprintChapterNumber: draft.blueprintChapterNumber,
            label: `${chapterTitleText} v${draft.version}`,
          }),
        },
        { key: 'div3', type: 'divider' as const },
        {
          key: 'delete',
          label: text('删除这一稿', 'Delete draft'),
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: deleteDraft,
        },
      ], e)}
      title={text(`点击打开 — ${chapterTitleText} v${draft.version}（${DRAFT_STATUS_LABEL[draft.status] || draft.status}）`, `Open — ${chapterTitleText} v${draft.version} (${statusLabel})`)}
    >
      <FileText size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
        {showVersion ? `${chapterTitleText} v${draft.version}` : chapterTitleText}
      </span>
      {/* 状态标签（始终显示） */}
      <span
        className="text-[0.7rem] flex-shrink-0"
        style={{ color: DRAFT_STATUS_COLOR[draft.status] || 'var(--color-text-muted)' }}
      >
        {statusLabel}
      </span>
      {/* 已发布图标 */}
      {isFinalized && (
        <CheckCircle2 size={10} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
      )}
      <button
        type="button"
        className="opacity-70 hover:opacity-100 rounded p-0.5"
        title={text('绑定蓝图', 'Link blueprint')}
        onClick={(event) => {
          event.stopPropagation()
          onBindBlueprint({
            draftId: draft.id,
            chapterNumber: draft.chapterNumber,
            blueprintChapterNumber: draft.blueprintChapterNumber,
            label: `${chapterTitleText} v${draft.version}`,
          })
        }}
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Link2 size={10} />
      </button>
      <button
        type="button"
        className="opacity-70 hover:opacity-100 rounded p-0.5"
        title={text('删除这一稿', 'Delete draft')}
        onClick={(e) => {
          e.stopPropagation()
          deleteDraft()
        }}
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Trash2 size={10} />
      </button>
    </div>
  )
}
