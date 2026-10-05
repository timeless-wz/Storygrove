/**
 * ProjectDocumentEditor — 项目自由 Markdown 文档的标签页编辑器
 *
 * 作者的自由资料保持原始 Markdown 文本：解析结果只进入预览，
 * 永不反向改写文件内容。文档绑定当前项目会话，切换项目后旧会话不写入。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Save,
  ImagePlus,
  Database,
  DatabaseZap,
  Loader2,
  AlertTriangle,
  FileText,
} from 'lucide-react'

import {
  analyzeProjectDocumentMarkdown,
} from '../../shared/project-documents'
import { createProjectDocumentIdentity } from '../../shared/document-editing'
import { countDraftUnits } from '../../shared/draft-units'
import { registerEditorExitSaveHandler, useEditorStore } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useProjectDocumentsStore } from '../../stores/project-documents-store'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import DocumentEditingSurface from './DocumentEditingSurface'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'
import {
  importProjectDocumentAsset,
  selectExternalMarkdownImage,
  writeProjectDocument,
} from '../../services/project-documents-service'

interface Props {
  tabId: string
  documentPath: string
  projectKey: string
  content: string
  savedContent: string
}

export default function ProjectDocumentEditor(props: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const projectSession = captureProjectSession(currentProject)
  const sessionKey = projectSession && isProjectSessionPath(projectSession, props.projectKey)
    ? `${projectSession.projectId}:${projectSession.leaseId}`
    : `inactive:${props.projectKey}`

  // 同一路径重新打开会产生新 lease；重挂载可隔离旧会话的编辑器临时状态。
  return <ProjectDocumentEditorSession key={sessionKey} {...props} />
}

function ProjectDocumentEditorSession({
  tabId,
  documentPath,
  projectKey,
  content: initialContent,
  savedContent: initialSavedContent,
}: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const projectMatches = currentProject?.path === projectKey
  const fileName = useMemo(() => documentPath.split('/').pop() ?? documentPath, [documentPath])
  const documentIdentity = createProjectDocumentIdentity({
    projectId: projectMatches && currentProject ? currentProject.id : `inactive:${projectKey}`,
    documentPath,
  })

  const knowledgeIndex = useProjectDocumentsStore(s => s.knowledgeIndex)
  const knowledgeBusyDocumentPath = useProjectDocumentsStore(s => s.knowledgeBusyDocumentPath)
  const addToKnowledge = useProjectDocumentsStore(s => s.addToKnowledge)
  const removeFromKnowledge = useProjectDocumentsStore(s => s.removeFromKnowledge)

  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(initialContent !== initialSavedContent)

  const savedContentRef = useRef(initialSavedContent)
  const currentContentRef = useRef(initialContent)
  // 传给 VditorProseEditor 的初始内容只在“外部重载”时更新，避免光标跳末尾。
  const [editorContent, setEditorContent] = useState(initialContent)
  // 目录与字数分析基于实时文本。
  const [liveContent, setLiveContent] = useState(initialContent)
  const [insertRequest, setInsertRequest] = useState<{ text: string; requestId: number } | null>(null)
  const [assetBusy, setAssetBusy] = useState(false)
  const requestSequenceRef = useRef(0)

  // 外部内容更新（保存后刷新、AI 写入）时的热重载。
  useEffect(() => {
    if (!projectMatches) return
    if (initialContent === currentContentRef.current) return
    savedContentRef.current = initialContent
    currentContentRef.current = initialContent
    setEditorContent(initialContent)
    setLiveContent(initialContent)
    setIsDirty(false)
  }, [initialContent, projectMatches])

  const handleChange = useCallback((markdown: string) => {
    currentContentRef.current = markdown
    setLiveContent(markdown)
    setIsDirty(markdown !== savedContentRef.current)
    const store = useEditorStore.getState()
    store.updateTabContent(tabId, markdown)
    if (markdown === savedContentRef.current) store.markTabSaved(tabId, markdown)
  }, [tabId])

  const handleSave = useCallback(async (markdown: string, propagateFailure = false) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (markdown === savedContentRef.current) {
      setIsDirty(false)
      useEditorStore.getState().markTabSaved(tabId, markdown)
      return
    }
    setSaving(true)
    try {
      const result = await writeProjectDocument(projectSession, documentPath, markdown)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success) throw new Error(result.error ?? text('保存失败', 'Save failed'))
      savedContentRef.current = markdown
      const settled = useEditorStore.getState()
      if (currentContentRef.current === markdown) {
        setIsDirty(false)
        settled.markTabSaved(tabId, markdown)
      } else {
        setIsDirty(true)
        settled.updateTabContent(tabId, currentContentRef.current)
      }
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) {
        toast.error(error instanceof Error ? error.message : text('保存失败', 'Save failed'))
      }
      // 退出保存必须向上抛出，否则调用方会把未保存文档当作已保存关闭。
      if (propagateFailure) throw error
    } finally {
      if (isProjectSessionCurrent(projectSession)) setSaving(false)
    }
  }, [documentPath, projectKey, tabId, text])

  useEffect(() => {
    registerEditorExitSaveHandler({
      tabId,
      type: 'project-document',
      projectKey,
      save: () => handleSave(currentContentRef.current, true),
    })
  }, [handleSave, projectKey, tabId])

  const analysis = useMemo(() => analyzeProjectDocumentMarkdown(liveContent), [liveContent])
  const characterCount = useMemo(() => countDraftUnits(liveContent), [liveContent])
  // 同名文档以受控目录内的相对路径区分，互不覆盖。
  const indexedEntry = knowledgeIndex[documentPath]
  const knowledgeBusy = knowledgeBusyDocumentPath === documentPath

  const handleInsertImage = useCallback(async () => {
    if (assetBusy) return
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    const grants = await selectExternalMarkdownImage()
    if (!grants || grants.length === 0) return
    if (!isProjectSessionCurrent(projectSession)) return
    setAssetBusy(true)
    try {
      const result = await importProjectDocumentAsset(projectSession, documentPath, grants[0].grantId)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success || !result.assetReference) {
        toast.error(result.error ?? text('图片插入失败', 'Inserting the image failed'))
        return
      }
      const alt = grants[0].displayName.replace(/\.[^.]+$/, '')
      requestSequenceRef.current += 1
      setInsertRequest({
        text: `![${alt}](${result.assetReference})`,
        requestId: requestSequenceRef.current,
      })
      toast.success(text(
        `图片已复制到项目文档目录：${result.assetReference}`,
        `Image copied into the project documents directory: ${result.assetReference}`,
      ))
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) {
        toast.error(error instanceof Error ? error.message : text('图片插入失败', 'Inserting the image failed'))
      }
    } finally {
      setAssetBusy(false)
    }
  }, [assetBusy, documentPath, projectKey, text])

  const handleKnowledgeToggle = useCallback(async () => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectKey)) return
    if (indexedEntry) {
      const result = await removeFromKnowledge(projectSession, documentPath)
      if (result.success) {
        toast.success(text('已从知识检索移除该文档', 'Removed the document from knowledge retrieval'))
      } else {
        toast.error(text('移出知识检索失败', 'Could not remove the document from knowledge retrieval'))
      }
      return
    }
    const result = await addToKnowledge(projectSession, documentPath, currentContentRef.current)
    if (result.success) {
      toast.success(text(
        '已加入知识检索（仅检索索引，不会提升为世界观或角色事实）',
        'Added to knowledge retrieval (search index only; not promoted to world rules or character facts)',
      ))
    } else {
      toast.error(text('加入知识检索失败', 'Could not add the document to knowledge retrieval'))
    }
  }, [addToKnowledge, documentPath, indexedEntry, projectKey, removeFromKnowledge, text])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 工具栏（背景与编辑区一致） */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {fileName}
          </span>
          <span className="hidden md:inline text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
            {documentPath}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            {characterCount.toLocaleString()} {text('字', 'chars')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleInsertImage()}
            disabled={assetBusy}
            title={text(
              '把图片复制进项目文档目录，再以相对路径插入',
              'Copy an image into the project documents directory and insert a relative reference',
            )}
          >
            {assetBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
            {text('插入图片', 'Image')}
          </Button>
          <Button
            variant={indexedEntry ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => void handleKnowledgeToggle()}
            disabled={knowledgeBusy}
            title={indexedEntry
              ? text('取消该文档的知识检索索引', 'Remove this document from the knowledge index')
              : text('由作者显式把该文档加入知识检索', 'Explicitly add this document to knowledge retrieval')}
          >
            {knowledgeBusy
              ? <Loader2 size={12} className="animate-spin" />
              : indexedEntry ? <DatabaseZap size={12} /> : <Database size={12} />}
            {indexedEntry ? text('取消索引', 'Unindex') : text('加入知识检索', 'Add to knowledge')}
          </Button>
          {saving && (
            <span className="text-xs" style={{ color: 'var(--color-accent)' }}>{text('保存中…', 'Saving…')}</span>
          )}
          {isDirty && !saving && (
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: 'var(--color-warning)' }}
              title={text('有未保存的修改', 'Unsaved changes')}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSave(currentContentRef.current)}
            disabled={saving || !isDirty || !projectMatches}
            title={text('保存（Cmd/Ctrl+S）', 'Save (Cmd/Ctrl+S)')}
          >
            <Save size={12} />
            {text('保存', 'Save')}
          </Button>
        </div>
      </div>

      {indexedEntry && (
        <div
          role="note"
          className="px-3 py-1.5 text-[11px]"
          style={{
            color: 'var(--color-text-secondary)',
            backgroundColor: 'var(--color-editor-bg)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {text(
            '该文档已加入知识检索。它只是检索索引，不会被当作世界观、角色事实或已批准资料。',
            'This document is in knowledge retrieval. It is only a search index entry, not approved sources, world rules, or character facts.',
          )}
        </div>
      )}

      {analysis.issues.length > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
          style={{
            color: 'var(--color-warning-text)',
            backgroundColor: 'var(--color-editor-bg)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span>{analysis.issues[0].message}</span>
        </div>
      )}

      {!projectMatches && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 text-xs"
          style={{
            color: 'var(--color-warning-text)',
            backgroundColor: 'var(--color-editor-bg)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span>{text(
            '此标签属于另一个项目，请切回原项目后继续。',
            'This tab belongs to another project. Switch back to continue.',
          )}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <DocumentEditingSurface
          documentIdentity={documentIdentity}
          layout="long-document"
          content={editorContent}
          editable={projectMatches}
          onChange={handleChange}
          onSave={handleSave}
          insertRequest={insertRequest}
          placeholder={text('开始写你的设定笔记…', 'Start writing your notes…')}
        />
      </div>
    </div>
  )
}
