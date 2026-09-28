/**
 * ProjectDocumentsView — 资料库「项目文档」列表
 *
 * 作者的自由 Markdown 资料在这里管理：新建、导入、搜索、重命名、
 * 删除前确认，以及显式的“加入知识检索”。文档本身作为标签页在中间区域打开，
 * 因此多文档、未保存状态和关闭保护都复用编辑器的既有机制。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  FilePlus2,
  FileText,
  FolderDown,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Database,
  DatabaseZap,
  Trash2,
  Check,
  X,
} from 'lucide-react'

import { PROJECT_DOCUMENTS_DIRECTORY, type ProjectDocumentEntry } from '../../../shared/project-documents'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useProjectDocumentsStore } from '../../../stores/project-documents-store'
import { useEditorStore } from '../../../stores/editor-store'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../../project-session-gate'
import {
  createProjectDocument,
  deleteProjectDocument,
  importProjectDocuments,
  readProjectDocument,
  renameProjectDocument,
  selectExternalMarkdownFiles,
} from '../../../services/project-documents-service'
import { openProjectDocument } from '../sidebar/sidebar-file-openers'

const MAX_BODY_SEARCH_DOCUMENTS = 200

/** 缓存为空时的稳定引用，避免每次渲染都产生新的依赖。 */
const NO_BODY_CONTENTS: Record<string, string> = {}

interface BodyCache {
  projectKey: string
  contents: Record<string, string>
}

interface DirectoryGroup {
  directory: string
  documents: ProjectDocumentEntry[]
}

function groupByDirectory(documents: ProjectDocumentEntry[]): DirectoryGroup[] {
  const groups = new Map<string, ProjectDocumentEntry[]>()
  for (const document of documents) {
    const index = document.documentPath.lastIndexOf('/')
    const directory = index < 0 ? '' : document.documentPath.slice(0, index)
    const bucket = groups.get(directory)
    if (bucket) bucket.push(document)
    else groups.set(directory, [document])
  }
  return [...groups.entries()]
    .map(([directory, entries]) => ({ directory, documents: entries }))
    .sort((left, right) => left.directory.localeCompare(right.directory, 'zh-CN'))
}

export default function ProjectDocumentsView() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const projectKey = currentProject?.path ?? ''

  const documents = useProjectDocumentsStore(s => s.documents)
  const dataProjectKey = useProjectDocumentsStore(s => s.dataProjectKey)
  const loading = useProjectDocumentsStore(s => s.loading)
  const lastError = useProjectDocumentsStore(s => s.lastError)
  const knowledgeIndex = useProjectDocumentsStore(s => s.knowledgeIndex)
  const knowledgeBusyDocumentPath = useProjectDocumentsStore(s => s.knowledgeBusyDocumentPath)
  const load = useProjectDocumentsStore(s => s.load)
  const loadKnowledgeIndex = useProjectDocumentsStore(s => s.loadKnowledgeIndex)
  const addToKnowledge = useProjectDocumentsStore(s => s.addToKnowledge)
  const removeFromKnowledge = useProjectDocumentsStore(s => s.removeFromKnowledge)

  const [query, setQuery] = useState('')
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  /**
   * 未完成的重命名。保留它（而不是只弹一条 toast）是为了让作者在左栏
   * 持续看到"旧文件仍在、新副本已存在"的真实状态。
   */
  const [renameIssue, setRenameIssue] = useState<{
    documentPath: string
    message: string
    createdDocumentPath?: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  // 正文搜索的按需缓存与所属项目绑定：切换项目后缓存自动视为无效。
  const [bodyCache, setBodyCache] = useState<BodyCache>({ projectKey: '', contents: {} })
  const bodyLoadRequest = useRef(0)

  const visibleDocuments = useMemo(
    () => (dataProjectKey === projectKey ? documents : []),
    [dataProjectKey, documents, projectKey],
  )
  const bodyContents = bodyCache.projectKey === projectKey ? bodyCache.contents : NO_BODY_CONTENTS

  const refresh = useCallback(async () => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return
    await Promise.all([
      load(projectSession),
      loadKnowledgeIndex(projectSession),
    ])
  }, [load, loadKnowledgeIndex])

  useEffect(() => {
    if (!currentProject) return
    void refresh()
  }, [currentProject?.path, refresh]) // eslint-disable-line react-hooks/exhaustive-deps -- 仅项目路径变化需要重新加载

  // 正文搜索：按需读取一次并缓存；切换项目后缓存立即失效。
  const normalizedQuery = query.trim().toLocaleLowerCase()
  useEffect(() => {
    if (!normalizedQuery) return
    if (visibleDocuments.length === 0) return
    if (visibleDocuments.length > MAX_BODY_SEARCH_DOCUMENTS) return
    const missing = visibleDocuments.filter(document => !(document.documentPath in bodyContents))
    if (missing.length === 0) return

    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return
    const requestId = ++bodyLoadRequest.current
    const knownContents = bodyContents
    void (async () => {
      const loaded: Record<string, string> = {}
      for (const document of missing) {
        if (!isProjectSessionCurrent(projectSession)) return
        const result = await readProjectDocument(projectSession, document.documentPath)
        if (result.success) loaded[document.documentPath] = result.content
      }
      if (requestId !== bodyLoadRequest.current) return
      if (!isProjectSessionCurrent(projectSession)) return
      setBodyCache({
        projectKey: projectSession.projectPath,
        contents: { ...knownContents, ...loaded },
      })
    })()
  }, [bodyContents, normalizedQuery, visibleDocuments])

  const filteredGroups = useMemo(() => {
    const matches = visibleDocuments.filter(document => {
      if (!normalizedQuery) return true
      if (document.title.toLocaleLowerCase().includes(normalizedQuery)) return true
      if (document.documentPath.toLocaleLowerCase().includes(normalizedQuery)) return true
      return (bodyContents[document.documentPath] ?? '')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    })
    return groupByDirectory(matches)
  }, [bodyContents, normalizedQuery, visibleDocuments])

  const runExclusive = useCallback(async (task: () => Promise<void>) => {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }, [])

  const handleCreate = () => runExclusive(async () => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const title = text('未命名文档', 'Untitled document')
    const result = await createProjectDocument(projectSession, title)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!result.success || !result.documentPath) {
      toast.error(result.error ?? text('新建文档失败', 'Could not create the document'))
      return
    }
    await refresh()
    if (!isProjectSessionCurrent(projectSession)) return
    await openProjectDocument(result.documentPath)
  })

  const handleImport = () => runExclusive(async () => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const grants = await selectExternalMarkdownFiles()
    if (!grants || grants.length === 0) return
    if (!isProjectSessionCurrent(projectSession)) return
    const result = await importProjectDocuments(projectSession, grants.map(grant => grant.grantId))
    if (!isProjectSessionCurrent(projectSession)) return
    await refresh()
    if (result.imported.length > 0) {
      toast.success(text(
        `已复制 ${result.imported.length} 份 Markdown 到当前项目（来源文件未被修改）`,
        `Copied ${result.imported.length} Markdown file(s) into this project (source files were not modified)`,
      ))
    }
    if (result.failed.length > 0) {
      toast.error(text(
        `${result.failed.length} 份导入失败：${result.failed.map(item => item.sourceName).join('、')}`,
        `${result.failed.length} import(s) failed: ${result.failed.map(item => item.sourceName).join(', ')}`,
      ))
    }
  })

  const handleRenameCommit = useCallback(async (document: ProjectDocumentEntry) => {
    const nextTitle = renameValue.trim()
    setRenamingPath(null)
    if (!nextTitle || nextTitle === document.title) return
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const result = await renameProjectDocument(projectSession, document.documentPath, nextTitle)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!result.success || !result.documentPath) {
      /*
       * 会话/租约在写入之后、删除旧文件之前失效时，主进程会拒绝删除并告知
       * 新副本已存在。这里保留未完成状态：不动标签页、不假装成功，只提示作者
       * 并刷新列表，让旧文件与新副本都可见。
       */
      const message = result.error ?? text('重命名失败', 'Rename failed')
      setRenameIssue({
        documentPath: document.documentPath,
        message,
        ...(result.createdDocumentPath
          ? { createdDocumentPath: result.createdDocumentPath }
          : {}),
      })
      toast.error(message)
      await refresh()
      return
    }
    setRenameIssue(null)
    // 已打开的标签页仍指向旧路径；先关闭再用新路径打开，避免标签页停留在不存在的文件上。
    const store = useEditorStore.getState()
    const openTab = store.tabs.find(tab => (
      tab.type === 'project-document'
      && tab.projectKey === projectKey
      && tab.filePath === document.documentPath
    ))
    if (openTab) store.closeTab(openTab.id)
    await refresh()
    if (!isProjectSessionCurrent(projectSession)) return
    if (openTab) await openProjectDocument(result.documentPath)
  }, [projectKey, refresh, renameValue, text])

  const handleDelete = useCallback(async (document: ProjectDocumentEntry) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const openTab = useEditorStore.getState().tabs.find(tab => (
      tab.type === 'project-document'
      && tab.projectKey === projectKey
      && tab.filePath === document.documentPath
    ))
    const accepted = await confirm(
      openTab?.dirty
        ? text(
          `删除「${document.title}」？该文档正在编辑且有未保存修改，删除后修改也会丢失。此操作不可撤销。`,
          `Delete “${document.title}”? It is open with unsaved changes, which will be lost. This cannot be undone.`,
        )
        : text(
          `删除「${document.title}」？此操作不可撤销。`,
          `Delete “${document.title}”? This cannot be undone.`,
        ),
      {
        title: text('删除项目文档', 'Delete project document'),
        confirmText: text('删除', 'Delete'),
        danger: true,
      },
    )
    if (!accepted || !isProjectSessionCurrent(projectSession)) return
    const result = await deleteProjectDocument(projectSession, document.documentPath)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!result.success) {
      toast.error(result.error ?? text('删除失败', 'Delete failed'))
      return
    }
    if (openTab) useEditorStore.getState().closeTab(openTab.id)
    setBodyCache(previous => {
      const contents = { ...previous.contents }
      delete contents[document.documentPath]
      return { projectKey: previous.projectKey, contents }
    })
    await refresh()
  }, [projectKey, refresh, text])

  const handleKnowledgeToggle = useCallback(async (document: ProjectDocumentEntry) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (knowledgeIndex[document.documentPath]) {
      const result = await removeFromKnowledge(projectSession, document.documentPath)
      if (result.success) {
        toast.success(text('已取消该文档的知识检索索引', 'Removed the document from the knowledge index'))
      } else {
        toast.error(text('取消索引失败', 'Could not remove the index'))
      }
      return
    }
    const read = await readProjectDocument(projectSession, document.documentPath)
    if (!isProjectSessionCurrent(projectSession)) return
    if (!read.success) {
      toast.error(read.error ?? text('无法读取文档内容', 'Could not read the document'))
      return
    }
    setBodyCache(previous => ({
      projectKey: previous.projectKey || projectKey,
      contents: { ...previous.contents, [document.documentPath]: read.content },
    }))
    const result = await addToKnowledge(
      projectSession,
      document.documentPath,
      read.content,
    )
    if (result.success) {
      toast.success(text(
        '已加入知识检索（只是检索索引，不会成为已批准资料或世界观事实）',
        'Added to knowledge retrieval (a search index only; not approved sources or world facts)',
      ))
    } else {
      toast.error(text('加入知识检索失败', 'Could not add to knowledge retrieval'))
    }
  }, [addToKnowledge, knowledgeIndex, projectKey, removeFromKnowledge, text])

  if (!currentProject) {
    return (
      <EmptyState
        icon={<FileText size={36} />}
        message={text('请先打开项目', 'Open a project first')}
        className="pb-[15vh]"
        opacity={0.4}
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {renameIssue && (
        <div
          role="alert"
          data-project-document-rename-issue={renameIssue.documentPath}
          className="flex items-start gap-2 px-3 py-2 text-[11px] flex-shrink-0 border-b"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'rgba(245, 158, 11, 0.10)',
            color: 'var(--color-warning-text)',
          }}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="block">{text('重命名未完成', 'Rename did not complete')}</strong>
            <span>{renameIssue.message}</span>
            {renameIssue.createdDocumentPath && (
              <span className="block mt-0.5">
                {text(
                  `已存在的新副本：${renameIssue.createdDocumentPath}（原文件仍保留）`,
                  `Existing new copy: ${renameIssue.createdDocumentPath} (the original file is kept)`,
                )}
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            aria-label={text('关闭提示', 'Dismiss notice')}
            title={text('关闭提示', 'Dismiss notice')}
            onClick={() => setRenameIssue(null)}
          >
            <X size={12} />
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1">
          <FileText size={13} />
          {text(`项目文档（${visibleDocuments.length}）`, `Project documents (${visibleDocuments.length})`)}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => void refresh()}
            disabled={loading || busy}
            title={text('刷新文档列表', 'Refresh document list')}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCreate}
            disabled={busy}
            title={text('新建 Markdown 文档', 'New Markdown document')}
          >
            <FilePlus2 size={14} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleImport}
            disabled={busy}
            title={text('复制为项目自由文档；不会加入章节草稿或正文数据库', 'Copy as a free project document; this does not add chapter drafts or prose to the database')}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FolderDown size={14} strokeWidth={2} />}
          </Button>
        </div>
      </div>

      <div className="relative px-2 py-1.5 border-b border-[var(--color-border)]">
        <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label={text('搜索文档标题和正文', 'Search document titles and content')}
          placeholder={text('搜索标题和正文', 'Search titles and content')}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {visibleDocuments.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {lastError
              ? text(`文档列表读取失败：${lastError}`, `Could not read the document list: ${lastError}`)
              : (
                <div className="space-y-3">
                  <p>{text(
                    '还没有项目文档。它们是你自由创建的设定笔记、卷纲、灵感与资料摘录。',
                    'No project documents yet. They are your free-form notes, outlines, ideas, and excerpts.',
                  )}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {text(
                      `保存在项目的 ${PROJECT_DOCUMENTS_DIRECTORY}/ 目录，不会被当成故事架构字段。`,
                      `Stored in this project’s ${PROJECT_DOCUMENTS_DIRECTORY}/ folder and never treated as story architecture fields.`,
                    )}
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button variant="default" className="w-full" onClick={handleCreate} disabled={busy}>
                      <FilePlus2 size={13} /> {text('新建文档', 'New document')}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={handleImport} disabled={busy}>
                      <FolderDown size={13} /> {text('导入为项目文档', 'Import as project document')}
                    </Button>
                  </div>
                </div>
              )}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center py-6 opacity-60 text-xs">
            {text('没有匹配的文档', 'No matching documents')}
          </div>
        ) : filteredGroups.map(group => (
          <div key={group.directory || '__root__'} className="mb-1">
            {group.directory && (
              <div
                className="px-2 py-0.5 text-[0.68rem] truncate"
                style={{ color: 'var(--color-text-muted)' }}
                title={`${PROJECT_DOCUMENTS_DIRECTORY}/${group.directory}`}
              >
                {group.directory}/
              </div>
            )}
            {group.documents.map(document => {
              // 同名文档以文档路径区分：一份加入索引不会影响另一份。
              const indexed = Boolean(knowledgeIndex[document.documentPath])
              const knowledgeBusy = knowledgeBusyDocumentPath === document.documentPath
              const isRenaming = renamingPath === document.documentPath
              return (
                <div
                  key={document.documentPath}
                  role="button"
                  tabIndex={0}
                  data-project-document-row={document.documentPath}
                  aria-label={text(`打开文档 ${document.title}`, `Open document ${document.title}`)}
                  onClick={() => {
                    if (isRenaming) return
                    void openProjectDocument(document.documentPath)
                  }}
                  onKeyDown={event => {
                    if (isRenaming) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    void openProjectDocument(document.documentPath)
                  }}
                  className="group/doc flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-[var(--color-hover)]"
                >
                  <FileText size={13} className="flex-shrink-0 opacity-70" aria-hidden="true" />
                  {isRenaming ? (
                    <span className="flex flex-1 min-w-0 items-center gap-1" onClick={event => event.stopPropagation()}>
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={event => setRenameValue(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') { event.preventDefault(); void handleRenameCommit(document) }
                          if (event.key === 'Escape') { event.preventDefault(); setRenamingPath(null) }
                        }}
                        aria-label={text('文档名称', 'Document name')}
                        className="h-6 flex-1 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={text('确认重命名', 'Confirm rename')}
                        onClick={() => { void handleRenameCommit(document) }}
                      >
                        <Check size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={text('取消重命名', 'Cancel rename')}
                        onClick={() => setRenamingPath(null)}
                      >
                        <X size={12} />
                      </Button>
                    </span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs" style={{ color: 'var(--color-text)' }}>
                          {document.title}
                        </span>
                        <span className="block truncate text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                          {document.fileName}
                          {indexed ? ` · ${text('已加入知识检索', 'In knowledge retrieval')}` : ''}
                        </span>
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/doc:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label={indexed
                            ? text('取消知识检索索引', 'Remove from knowledge index')
                            : text('加入知识检索', 'Add to knowledge retrieval')}
                          title={indexed
                            ? text('取消该文档的知识检索索引', 'Remove this document from the knowledge index')
                            : text('由你显式把该文档加入知识检索', 'Explicitly add this document to knowledge retrieval')}
                          disabled={knowledgeBusy}
                          onClick={event => {
                            event.stopPropagation()
                            void handleKnowledgeToggle(document)
                          }}
                        >
                          {knowledgeBusy
                            ? <Loader2 size={12} className="animate-spin" />
                            : indexed ? <DatabaseZap size={12} /> : <Database size={12} />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label={text('重命名', 'Rename')}
                          title={text('重命名', 'Rename')}
                          onClick={event => {
                            event.stopPropagation()
                            setRenameValue(document.title)
                            setRenamingPath(document.documentPath)
                          }}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label={text('删除', 'Delete')}
                          title={text('删除', 'Delete')}
                          onClick={event => {
                            event.stopPropagation()
                            void handleDelete(document)
                          }}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
