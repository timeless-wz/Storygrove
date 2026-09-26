import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Database, BookOpen, FileText, FolderOpen,
  Search, RefreshCw, Layers, Zap, Server, Activity, Trash2, AlertTriangle, Upload,
  ExternalLink, Info, Ban, CheckCircle2, ListTree,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { useProjectStore } from '../../stores/project-store'
import { useProjectDocumentsStore } from '../../stores/project-documents-store'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { globalEventBus } from '../../shared/event-bus'
import {
  selectPlanningMaterials,
  unwrapKnowledgeValue,
  type KBDocument, type SearchResult, type KBStatsData, type VectorRebuildStatus,
} from '../../services/knowledge-service'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore, workflowResourceConflictMessage } from '../../stores/workflow-store'
import {
  createPlanningMaterialCharacterExtractionWorkflow,
  createPlanningMaterialWorkflow,
} from '../../services/workflows/planning-material-workflow'
import { useLocaleStore } from '../../stores/locale-store'
import { useLayoutStore } from '../../stores/layout-store'
import { appErrorMessage } from '../../i18n/app-errors'
import { ipc } from '../../services/ipc-client'
import {
  captureProjectSession,
  isProjectSessionCurrent,
} from '../project-session-gate'
import { sameProjectSessionContext } from '../../shared/project-session-context'
import { openProjectDocument } from '../panels/sidebar/sidebar-file-openers'
import { getVectorRebuildPresentation } from './knowledge-rebuild-presentation'
import {
  KNOWLEDGE_CORPUS_LABELS,
  KNOWLEDGE_EXCLUSIONS,
  KNOWLEDGE_INCLUSION_PATHS,
  isFullTextHit,
  readCorpusKind,
  readHitScope,
  resolveJumpTarget,
  summarizeCorpus,
} from './knowledge-scope'

/**
 * 知识库概览页面 — LanceDB 向量数据库的管理中心
 * 当侧栏视图为"知识库"时，作为中间编辑区的固定内容展示。
 *
 * 页面顺序按阅读顺序排列：收录范围 → 语义检索 → 索引维护 → 已收录清单。
 * 检索结果只展示真实命中的语料与可核对来源，不填充占位数据。
 */
export default function KnowledgeOverview() {
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [stats, setStats] = useState<KBStatsData>({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [topK, setTopK] = useState(10)
  const [vectorRebuildStatus, setVectorRebuildStatus] = useState<VectorRebuildStatus | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [loadError, setLoadError] = useState('')

  const currentProject = useProjectStore(s => s.currentProject)
  const { locale, text } = useLocaleStore()
  const projectDocuments = useProjectDocumentsStore(s => s.documents)
  const loadProjectDocuments = useProjectDocumentsStore(s => s.load)

  const loadData = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const expectedProjectPath = projectSession.projectPath
    try {
      const [documentsResult, statsResult] = await Promise.all([
        ipc.invokeWithProjectSession(projectSession, 'kb:list-documents', expectedProjectPath),
        ipc.invokeWithProjectSession(projectSession, 'kb:stats', expectedProjectPath),
      ])
      if (!isProjectSessionCurrent(projectSession)) return
      const docs = unwrapKnowledgeValue(documentsResult)
      const s = unwrapKnowledgeValue(statsResult)
      setDocuments(docs)
      setStats(s)
      setLoadError('')
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      setLoadError(appErrorMessage(locale, error))
    }
  }, [currentProject, locale])

  const loadVectorRebuildStatus = useCallback(async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const expectedProjectPath = projectSession.projectPath
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'kb:get-vector-rebuild-status',
        expectedProjectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      setVectorRebuildStatus(unwrapKnowledgeValue(result))
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      setLoadError(appErrorMessage(locale, error))
    }
  }, [currentProject, locale])

  useEffect(() => {
    let mounted = true
    Promise.resolve().then(() => {
      const projectSession = captureProjectSession(currentProject)
      if (!mounted || !projectSession) return
      setDocuments([])
      setStats({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
      setSearchResults([])
      setSearchedQuery(null)
      setVectorRebuildStatus(null)
      setLoadError('')
      setSearching(false)
      setBackfilling(false)
      setClearing(false)
      loadData()
      loadVectorRebuildStatus()
      void loadProjectDocuments(projectSession)
    })
    return () => { mounted = false }
  }, [currentProject, loadData, loadVectorRebuildStatus, loadProjectDocuments])

  useEffect(() => {
    Promise.resolve().then(() => loadVectorRebuildStatus())
  }, [loadVectorRebuildStatus, documents])

  // 通过 EventBus 监听资源刷新和定稿完成事件
  useEffect(() => {
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', (payload) => {
      const projectSession = captureProjectSession(currentProject)
      if (
        projectSession
        && sameProjectSessionContext(projectSession, payload.projectSession)
        && (payload.resources.includes('all') || payload.resources.includes('fileTree'))
      ) {
        loadData()
        loadVectorRebuildStatus()
      }
    })
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', ({ projectSession: eventSession }) => {
      const projectSession = captureProjectSession(currentProject)
      if (!projectSession || !sameProjectSessionContext(projectSession, eventSession)) return
      loadData()
      loadVectorRebuildStatus()
    })
    return () => { unsub1(); unsub2() }
  }, [currentProject, loadData, loadVectorRebuildStatus])

  // 判断检索模式
  const hasVectors = stats.vectorDimension > 0
  const searchMode = hasVectors ? text('混合检索', 'Hybrid search') : text('BM25 全文检索', 'BM25 full-text search')
  const rebuildPresentation = getVectorRebuildPresentation(vectorRebuildStatus)
  const corpusSummary = useMemo(() => summarizeCorpus(documents), [documents])
  /** 真实存在的项目文档路径：命中项只有落在其中才提供打开按钮。 */
  const projectDocumentPaths = useMemo(
    () => new Set(projectDocuments.map(document => document.documentPath)),
    [projectDocuments],
  )

  if (!currentProject) {
    return (
      <div className="skin-workspace-page h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
        <div
          className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-editor-bg)',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
              {text('知识库', 'Knowledge base')}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          <EmptyState icon={<BookOpen size={36} />} message={text('请先打开项目', 'Open a project first')} opacity={0.4} />
        </div>
      </div>
    )
  }

  /** 语义检索 */
  const handleSearch = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const expectedProjectPath = projectSession.projectPath
    const queryText = searchQuery
    setSearching(true)
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'kb:search',
        queryText,
        topK,
        expectedProjectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      setSearchResults(unwrapKnowledgeValue(result))
      setSearchedQuery(queryText)
    } catch (error) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(appErrorMessage(locale, error))
    } finally {
      if (isProjectSessionCurrent(projectSession)) {
        setSearching(false)
      }
    }
  }

  /** 向量回填 */
  const handleBackfill = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const expectedProjectPath = projectSession.projectPath
    setBackfilling(true)
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'kb:backfill-vectors',
        expectedProjectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (result.success) {
        toast.success(result.processed === 0
          ? text('向量索引检查完成，当前模型无需重建', 'Vector index check complete; the current model does not need a rebuild')
          : text(`向量索引重建完成：已处理 ${result.processed} 块${result.failed > 0 ? `，${result.failed} 块失败` : ''}`, `Vector index rebuilt: ${result.processed} chunks processed${result.failed > 0 ? `, ${result.failed} failed` : ''}`))
      } else {
        toast.error(result.error || text('向量回填失败', 'Vector backfill failed'))
      }
    } catch (e) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(appErrorMessage(locale, e))
    } finally {
      if (isProjectSessionCurrent(projectSession)) {
        setBackfilling(false)
        globalEventBus.emit('REFRESH_RESOURCE', {
          resources: ['all'],
          projectPath: expectedProjectPath,
          projectSession,
        })
      }
    }
  }

  /** 清空当前项目知识库 */
  const handleClearKnowledgeBase = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const expectedProjectPath = projectSession.projectPath
    const ok = await confirm(
      text('确认清空当前项目的全部知识库内容？\n此操作会删除已导入的知识文档与切片，不会删除项目正文、蓝图或故事架构。', 'Clear the entire knowledge base for this project?\nImported documents and chunks will be deleted. Manuscripts, blueprints, and story architecture are preserved.'),
      {
        title: text('清空知识库', 'Clear knowledge base'),
        confirmText: text('清空知识库', 'Clear knowledge base'),
        danger: true,
      },
    )
    if (!ok) return
    if (!isProjectSessionCurrent(projectSession)) {
      toast.error(text('项目已切换，本次清空操作已取消', 'The project changed, so the clear operation was cancelled'))
      return
    }

    setClearing(true)
    try {
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'kb:clear-all',
        expectedProjectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (result.success) {
        setDocuments([])
        setStats({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
        setSearchResults([])
        setVectorRebuildStatus(null)
        globalEventBus.emit('REFRESH_RESOURCE', {
          resources: ['all'],
          projectPath: expectedProjectPath,
          projectSession,
        })
        toast.success(text('知识库已清空', 'Knowledge base cleared'))
      } else {
        toast.error(result.error || text('清空知识库失败', 'Could not clear the knowledge base'))
      }
    } catch (e) {
      if (!isProjectSessionCurrent(projectSession)) return
      toast.error(appErrorMessage(locale, e))
    } finally {
      if (isProjectSessionCurrent(projectSession)) {
        setClearing(false)
      }
    }
  }

  const handleImportPlanningMaterials = async () => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || importing) return
    setImporting(true)
    try {
      const materials = await selectPlanningMaterials()
      if (materials.length === 0 || !isProjectSessionCurrent(projectSession)) return
      const workflowStore = useWorkflowStore.getState()
      const localWorkflow = createPlanningMaterialWorkflow({ projectSession, materials })
      const localRunId = await workflowStore.startWorkflow(localWorkflow)
      const localRun = useWorkflowStore.getState().history.find(run => run.id === localRunId)
      if (localRun?.status !== 'completed' || !isProjectSessionCurrent(projectSession)) return

      const llmState = useLLMStore.getState()
      const model = llmState.models.find(candidate => candidate.id === llmState.defaultModelId)
      if (!model) {
        toast.success(text(
          '创作资料已仅导入本地知识库；配置生成模型后可提取角色卡',
          'Planning material was imported only into the local knowledge base. Configure a generation model to extract character cards.',
        ))
        return
      }
      const shouldExtract = await confirm(
        text(
          `创作资料已仅保存在当前项目的本地知识库。\n\n若继续，本次选中的全部文本将发送到当前配置的模型端点，用于提取可编辑角色卡：\n模型：${model.name} (${model.modelName})\n端点：${model.baseUrl}\n\n是否发送并提取？`,
          `The planning material is now stored only in this project's local knowledge base.\n\nIf you continue, all selected text will be sent to the currently configured model endpoint to extract editable character cards:\nModel: ${model.name} (${model.modelName})\nEndpoint: ${model.baseUrl}\n\nSend the text and extract character cards?`,
        ),
        {
          title: text('AI 提取角色卡', 'AI character-card extraction'),
          confirmText: text('发送并提取', 'Send and extract'),
        },
      )
      if (!shouldExtract || !isProjectSessionCurrent(projectSession)) return

      const extractionWorkflow = createPlanningMaterialCharacterExtractionWorkflow({
        projectSession,
        materials,
        generationModelId: model.id,
      })
      const conflict = useWorkflowStore.getState().getResourceConflict(extractionWorkflow)
      if (conflict) {
        toast.warning(workflowResourceConflictMessage(locale, conflict.title))
        return
      }
      useLayoutStore.getState().openBottomTab('tasks')
      await useWorkflowStore.getState().startWorkflow(extractionWorkflow, true)
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) toast.error(appErrorMessage(locale, error))
    } finally {
      setImporting(false)
    }
  }

  /** 打开命中的真实来源文档；只有应用登记过的项目文档索引才会走到这里。 */
  const handleOpenSourceDocument = async (documentPath: string) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    await openProjectDocument(documentPath)
    if (!isProjectSessionCurrent(projectSession)) return
  }

  /** 章节语料没有可打开的文件路径；改为定位到该章的上下文装配包。 */
  const handleOpenChapterContext = async (chapterNumber: number) => {
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    const workspaceHub = useWorkspaceHubStore.getState()
    workspaceHub.setTargetChapterNumber(chapterNumber)
    workspaceHub.setActiveTab('context')
    useLayoutStore.getState().setSidebarView('workspace')
    await workspaceHub.assembleChapterContext(chapterNumber)
    if (!isProjectSessionCurrent(projectSession)) return
  }

  const openDocumentByIndexName = (doc: KBDocument): string | null => (
    readCorpusKind(doc) !== 'reference' && projectDocumentPaths.has(doc.fileName) ? doc.fileName : null
  )

  return (
    <div className="skin-workspace-page h-full overflow-y-auto" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="max-w-4xl mx-auto px-8 py-6">

        {/* ===== 标题 ===== */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-accent)' }}
          >
            <Database size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">{text('知识库', 'Knowledge base')}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {text('基于 LanceDB 的本地向量数据库，定稿后自动入库，为 AI 写作提供语义检索上下文', 'A local LanceDB vector database. Finalized chapters are indexed automatically to provide retrieval context for AI writing.')}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              className="text-xs"
              onClick={handleImportPlanningMaterials}
              disabled={importing}
            >
              {importing ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
              {text('导入创作资料', 'Import planning material')}
            </Button>
            <Button
              variant="outline"
              className="text-xs"
              onClick={handleClearKnowledgeBase}
              disabled={clearing || (stats.documentCount === 0 && stats.totalChunks === 0)}
            >
              {clearing ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {text('清空知识库', 'Clear knowledge base')}
            </Button>
          </div>
        </div>

        {loadError && (
          <div className="mb-6 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-error)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)] px-4 py-3 text-xs text-[var(--color-error-text)]">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* ===== 统计卡片 ===== */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard icon={<FileText size={14} />} label={text('文档数量', 'Documents')} value={stats.documentCount} />
          <StatCard icon={<Layers size={14} />} label={text('知识切片', 'Chunks')} value={stats.totalChunks} />
          <StatCard
            icon={<Server size={14} />}
            label={text('存储引擎', 'Storage engine')}
            value="LanceDB"
            accent
          />
          <StatCard
            icon={<Activity size={14} />}
            label={text('检索模式', 'Search mode')}
            value={hasVectors ? 'FTS+向量' : 'FTS'}
            badge={hasVectors ? text('混合', 'Hybrid') : text('基础', 'Basic')}
            badgeColor={hasVectors ? 'var(--color-success-text)' : 'var(--color-text-secondary)'}
          />
        </div>

        {/* ===== 收录范围：本页检索到底覆盖什么 ===== */}
        <section
          className="rounded-xl border border-[var(--color-border)] mb-6 overflow-hidden"
          style={{ backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
            <ListTree size={14} className="text-[var(--color-accent)] flex-shrink-0" />
            <span className="text-sm font-semibold text-[var(--color-text)]">{text('收录范围', 'Indexed scope')}</span>
            <span className="text-[0.7rem] text-[var(--color-text-muted)] ml-auto">
              {text(
                `当前覆盖 ${stats.documentCount} 份语料 / ${stats.totalChunks} 个切片`,
                `${stats.documentCount} documents / ${stats.totalChunks} chunks currently indexed`,
              )}
            </span>
          </div>
          <div className="px-4 py-3 space-y-3">
            <p className="text-[0.7rem] text-[var(--color-text-secondary)]">
              {text(
                '检索只能命中下面这些已入库语料。范围之外的正文、蓝图与档案不会被检索到，本页也不会为它们显示任何结果。',
                'Retrieval can only hit the corpora listed below. Anything outside this scope — manuscript text, blueprints, profiles — is not searchable here, and this page will not show results for it.',
              )}
            </p>

            <div className="space-y-2">
              {KNOWLEDGE_INCLUSION_PATHS.map((entry, index) => (
                <div key={entry.label.en} className="flex items-start gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0 text-[var(--color-success)]" />
                  <div className="min-w-0">
                    <div className="text-xs text-[var(--color-text)]">
                      <span className="text-[var(--color-text-muted)] mr-1 tabular-nums">{index + 1}.</span>
                      {text(entry.label.zh, entry.label.en)}
                    </div>
                    <div className="text-[0.7rem] text-[var(--color-text-muted)]">{text(entry.detail.zh, entry.detail.en)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
              {KNOWLEDGE_EXCLUSIONS.map(entry => (
                <div key={entry.en} className="flex items-start gap-2">
                  <Ban size={13} className="mt-0.5 flex-shrink-0 text-[var(--color-error-text)]" />
                  <div className="text-[0.7rem] text-[var(--color-text-secondary)]">{text(entry.zh, entry.en)}</div>
                </div>
              ))}
            </div>

            {/* 实际分布：来自文档的 corpusKind，未标记来源单独列出 */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--color-border)]">
              <span className="text-[0.7rem] text-[var(--color-text-muted)]">{text('实际分布:', 'Actual distribution:')}</span>
              {(['project-knowledge', 'reference', 'unknown'] as const).map(kind => {
                const count = kind === 'project-knowledge'
                  ? corpusSummary.projectKnowledge
                  : kind === 'reference'
                    ? corpusSummary.reference
                    : corpusSummary.unknown
                const label = KNOWLEDGE_CORPUS_LABELS[kind]
                return (
                  <span
                    key={kind}
                    className="text-[0.65rem] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: kind === 'reference'
                        ? 'color-mix(in srgb, var(--color-info) 14%, transparent)'
                        : 'var(--color-hover)',
                      color: kind === 'reference' ? 'var(--color-category-progress-text)' : 'var(--color-text-secondary)',
                    }}
                  >
                    {text(label.zh, label.en)} {count}
                  </span>
                )
              })}
            </div>
          </div>
        </section>

        {/* ===== 语义检索区域 ===== */}
        <div
          className="rounded-xl border border-[var(--color-border)] mb-6 overflow-hidden"
          style={{ backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
            <Search size={14} className="text-[var(--color-accent)] flex-shrink-0" />
            <span className="text-sm font-semibold text-[var(--color-text)]">{text('语义检索', 'Semantic search')}</span>
            {/* 检索模式标签 */}
            <span className={cn(
              'text-[0.65rem] px-1.5 py-0.5 rounded-full font-medium',
              hasVectors
                ? 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success-text)]'
                : 'bg-[color-mix(in_srgb,var(--color-info)_15%,transparent)] text-[var(--color-category-progress-text)]'
            )}>
              {searchMode}
            </span>
            <span className="text-[0.7rem] text-[var(--color-text-muted)] ml-auto">
              {hasVectors ? text('BM25 + 向量近邻融合', 'BM25 + vector nearest-neighbor fusion') : text('配置 Embedding 模型后自动升级为混合检索', 'Configure an embedding model to enable hybrid search')}
            </span>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 h-9"
                placeholder={text('输入查询内容，如：主角的能力体系、世界观核心设定...', 'Search for protagonist abilities, core world rules, and more...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                aria-label={text('检索内容', 'Search query')}
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[0.7rem] text-[var(--color-text-muted)]">Top</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={topK}
                  onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                  className="w-12 h-7 text-xs rounded px-1.5 text-center"
                  aria-label={text('返回条数', 'Result count')}
                />
              </div>
              <Button
                variant="ai"
                onClick={handleSearch}
                disabled={searching || searchQuery.trim() === ''}
              >
                {searching ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
                {text('检索', 'Search')}
              </Button>
            </div>
            <p className="text-[0.7rem] text-[var(--color-text-muted)] mt-2">
              {text(
                '检索范围就是上面的已收录语料；未命中时会明确告知，不会显示占位结果。',
                'Search only looks at the indexed corpora above. A miss is reported as a miss; no placeholder results are shown.',
              )}
            </p>
          </div>

          {/* 检索结果 */}
          {searchResults.length > 0 && (
            <div className="border-t border-[var(--color-border)]">
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  {text(`检索结果（${searchResults.length} 条）`, `Search results (${searchResults.length})`)}
                </span>
                <button
                  className="text-[0.7rem] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  onClick={() => { setSearchResults([]); setSearchedQuery(null); setSearchQuery('') }}
                >
                  {text('清除', 'Clear')}
                </button>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                {[...searchResults].reverse().map((r, i) => {
                  const scope = readHitScope(r)
                  const jump = resolveJumpTarget(r, documents, projectDocumentPaths)
                  const doc = scope.docId
                    ? documents.find(candidate => candidate.id === scope.docId)
                    : documents.find(candidate => candidate.fileName === r.fileName)
                  const corpusKind = doc ? readCorpusKind(doc) : 'unknown'
                  const corpusLabel = KNOWLEDGE_CORPUS_LABELS[corpusKind]
                  const registeredPath = jump.kind === 'project-document' ? jump.documentPath : null
                  return (
                    <div
                      key={i}
                      className="px-4 py-3 border-t border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                        <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5 min-w-0">
                          <FileText size={10} className="flex-shrink-0" />
                          <span className="truncate" title={r.fileName}>{r.fileName}</span>
                        </span>
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          <span
                            className="text-[0.65rem] px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: corpusKind === 'reference'
                                ? 'color-mix(in srgb, var(--color-info) 14%, transparent)'
                                : 'var(--color-hover)',
                              color: corpusKind === 'reference' ? 'var(--color-category-progress-text)' : 'var(--color-text-secondary)',
                            }}
                          >
                            {text(corpusLabel.zh, corpusLabel.en)}
                          </span>
                          <span className={cn(
                            'text-[0.7rem] px-1.5 py-0.5 rounded font-mono',
                            r.score > 0.8 ? 'bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] text-[var(--color-success-text)]' :
                            r.score > 0.6 ? 'bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)] text-[var(--color-warning-text)]' :
                            'bg-[var(--color-hover)] text-[var(--color-text-muted)]'
                          )}>
                            {isFullTextHit(r.score) ? text('全文匹配', 'Text match') : text(`相似度 ${(r.score * 100).toFixed(1)}%`, `${(r.score * 100).toFixed(1)}% similarity`)}
                          </span>
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                        {r.text}
                      </p>

                      {/* 来源与可核对信息 */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[0.7rem] text-[var(--color-text-muted)]">
                        {scope.chapterNumber !== null && (
                          <span>{text(`第 ${scope.chapterNumber} 章`, `Chapter ${scope.chapterNumber}`)}</span>
                        )}
                        {scope.startLine !== null && (
                          <span>
                            {text(
                              `行 ${scope.startLine}${scope.endLine !== null ? `-${scope.endLine}` : ''}`,
                              `lines ${scope.startLine}${scope.endLine !== null ? `-${scope.endLine}` : ''}`,
                            )}
                          </span>
                        )}
                        {scope.authorityStatus && (
                          <span>{text(`权威状态 ${scope.authorityStatus}`, `Authority ${scope.authorityStatus}`)}</span>
                        )}
                        {scope.sourceSnapshotId && (
                          <span className="font-mono truncate" title={scope.sourceSnapshotId}>
                            {text('快照', 'Snapshot')} {scope.sourceSnapshotId.slice(0, 12)}
                          </span>
                        )}
                      </div>

                      {/* 真实跳转：项目文档可打开；章节语料定位到该章装配包；其余如实说明 */}
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {registeredPath && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[0.7rem] px-2 gap-1"
                            onClick={() => void handleOpenSourceDocument(registeredPath)}
                          >
                            <ExternalLink size={11} />
                            {text('打开来源文档', 'Open source document')}
                          </Button>
                        )}
                        {jump.kind === 'chapter-context' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[0.7rem] px-2 gap-1"
                            onClick={() => void handleOpenChapterContext(jump.chapterNumber)}
                          >
                            <FolderOpen size={11} />
                            {text(`第 ${jump.chapterNumber} 章上下文装配包`, `Chapter ${jump.chapterNumber} context package`)}
                          </Button>
                        )}
                        {jump.kind === 'none' && !registeredPath && (
                          <span className="text-[0.65rem] text-[var(--color-text-muted)] flex items-center gap-1">
                            <Info size={10} />
                            {jump.reason === 'reference-material'
                              ? text('参考素材语料：只在本页检索，不参与正文生成上下文。', 'Reference material: searchable here only; excluded from prose generation context.')
                              : text('该语料没有可打开的来源文件（导入型语料），仅能依据上面的名称与行号核对。', 'No openable source file for this corpus entry; verify using the name and line range above.')}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 未命中：把「还没检索」和「检索了但没命中」分开说明，都不显示占位结果 */}
          {searchResults.length === 0 && !searching && (
            searchedQuery !== null ? (
              <div className="border-t border-[var(--color-border)] px-4 py-6 text-center" data-testid="knowledge-search-no-hit">
                <Search size={22} className="mx-auto mb-2 text-[var(--color-text-muted)]" />
                <div className="text-xs text-[var(--color-text)]">
                  {text(`「${searchedQuery}」没有命中任何已收录语料`, `“${searchedQuery}” matched no indexed corpus`)}
                </div>
                <div className="text-[0.7rem] text-[var(--color-text-muted)] mt-1 max-w-lg mx-auto leading-relaxed">
                  {text(
                    '本次检索没有返回命中，不代表项目里没有相关内容。只有已入库的正文与资料参与检索；未入库正文、蓝图与角色档案不会自动参与。',
                    'This search returned no matches; related content may still exist in the project. Only indexed prose and material are searched; unindexed prose, blueprints, and character profiles are not included automatically.',
                  )}
                </div>
                <div className="text-[0.7rem] text-[var(--color-text-muted)] mt-2">
                  {text('可改用「导入创作资料」或把项目文档加入知识检索后重试。', 'Import planning material, or add a project document to retrieval, then search again.')}
                </div>
              </div>
            ) : searchQuery.trim() !== '' ? (
              <div className="border-t border-[var(--color-border)] px-4 py-6 text-center">
                <Search size={22} className="mx-auto mb-2 text-[var(--color-text-muted)]" />
                <div className="text-xs text-[var(--color-text)]">{text('尚未检索', 'No search run yet')}</div>
                <div className="text-[0.7rem] text-[var(--color-text-muted)] mt-1">
                  {text('点击「检索」在上面的已收录语料中查询。', 'Use “Search” to query the indexed corpora listed above.')}
                </div>
              </div>
            ) : null
          )}
        </div>

        {/* ===== 索引维护 ===== */}
        {rebuildPresentation && (
          <div
            className={cn(
              'rounded-xl border mb-6 overflow-hidden',
              rebuildPresentation.kind === 'missing-vectors'
                ? 'border-[color-mix(in_srgb,var(--color-warning)_20%,transparent)]'
                : 'border-[color-mix(in_srgb,var(--color-info)_20%,transparent)]',
            )}
            style={{
              backgroundColor: rebuildPresentation.kind === 'missing-vectors'
                ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)'
                : 'color-mix(in srgb, var(--color-info) 6%, transparent)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  rebuildPresentation.kind === 'missing-vectors' ? 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)]' : 'bg-[color-mix(in_srgb,var(--color-info)_15%,transparent)]',
                )}>
                  <Zap size={16} className={rebuildPresentation.kind === 'missing-vectors' ? 'text-[var(--color-warning)]' : 'text-[var(--color-info)]'} />
                </div>
                <div>
                  <div className={cn(
                    'text-sm font-medium',
                    rebuildPresentation.kind === 'missing-vectors' ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-category-progress-text)]',
                  )}>
                    {text(rebuildPresentation.title.zhCN, rebuildPresentation.title.enUS)}
                  </div>
                  <div className={cn(
                    'text-[0.7rem]',
                    rebuildPresentation.kind === 'missing-vectors' ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-category-progress-text)]',
                  )}>
                    {rebuildPresentation.kind === 'missing-vectors'
                      ? text(
                          `${vectorRebuildStatus!.vectorlessCount} 个文本块尚未生成向量嵌入；检查后会安全补全或重建索引。`,
                          `${vectorRebuildStatus!.vectorlessCount} text chunks have no embeddings. The check safely completes or rebuilds the index.`,
                        )
                      : text(
                          `将用一条本地文本块检查当前模型的实际向量维度；如维度变化，会先完整建立新索引，再切换检索。当前索引为 ${vectorRebuildStatus!.activeVectorDimension || 'FTS'}。`,
                          `One local text chunk checks the current model's actual vector dimension. If it changed, a complete new index is built before search switches. Current index: ${vectorRebuildStatus!.activeVectorDimension || 'FTS'}.`,
                        )}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                className={cn(
                  'text-xs',
                  rebuildPresentation.kind === 'missing-vectors'
                    ? 'border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] text-[var(--color-warning-text)] hover:bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)]'
                    : 'border-[color-mix(in_srgb,var(--color-info)_30%,transparent)] text-[var(--color-category-progress-text)] hover:bg-[color-mix(in_srgb,var(--color-info)_20%,transparent)]',
                )}
                onClick={handleBackfill}
                disabled={backfilling}
              >
                {backfilling ? (
                  <><RefreshCw size={12} className="animate-spin mr-1.5" />{text('检查与重建中...', 'Checking and rebuilding...')}</>
                ) : (
                  <>{text(rebuildPresentation.action.zhCN, rebuildPresentation.action.enUS)}</>
                )}
              </Button>
            </div>
            {/* 进度条（回填时显示） */}
            {backfilling && (
              <div className={cn('h-1 w-full', rebuildPresentation.kind === 'missing-vectors' ? 'bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)]' : 'bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)]')}>
                <div className={cn(
                  'h-full animate-pulse rounded-full w-full',
                  rebuildPresentation.kind === 'missing-vectors'
                    ? 'bg-[var(--color-warning)]'
                    : 'bg-[var(--color-info)]',
                )} />
              </div>
            )}
          </div>
        )}

        {/* ===== 已收录清单 ===== */}
        <section
          className="rounded-xl border border-[var(--color-border)] overflow-hidden"
          style={{ backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
            <Layers size={14} className="text-[var(--color-accent)] flex-shrink-0" />
            <span className="text-sm font-semibold text-[var(--color-text)]">{text('已收录语料', 'Indexed corpora')}</span>
            <span className="text-[0.7rem] text-[var(--color-text-muted)] ml-auto">
              {text(`${documents.length} 份`, `${documents.length} documents`)}
            </span>
          </div>
          {documents.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <BookOpen size={26} className="mx-auto mb-2 text-[var(--color-text-muted)]" />
              <div className="text-xs text-[var(--color-text)]">{text('知识库还没有任何语料', 'The knowledge base has no corpora yet')}</div>
              <div className="text-[0.7rem] text-[var(--color-text-muted)] mt-1">
                {text('三种真实的入库方式:', 'Three real ways to add corpora:')}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={handleImportPlanningMaterials} disabled={importing}>
                  <Upload size={12} />
                  {text('选择文件并导入', 'Choose files to import')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => useLayoutStore.getState().setSidebarView('project')}
                >
                  <FolderOpen size={12} />
                  {text('在项目文档中开启知识检索', 'Enable retrieval on a project document')}
                </Button>
              </div>
              <div className="text-[0.65rem] text-[var(--color-text-muted)] mt-2">
                {text('章节定稿后也会自动入库，无需在此手动添加。', 'Finalizing a chapter also indexes it automatically; no manual step needed here.')}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)] max-h-[380px] overflow-y-auto">
              {documents.map(doc => {
                const corpusKind = readCorpusKind(doc)
                const corpusLabel = KNOWLEDGE_CORPUS_LABELS[corpusKind]
                const registeredPath = openDocumentByIndexName(doc)
                return (
                  <div key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
                    <FileText size={13} className="flex-shrink-0 text-[var(--color-text-muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-[var(--color-text)] truncate" title={doc.fileName}>{doc.fileName}</div>
                      <div className="text-[0.7rem] text-[var(--color-text-muted)] flex items-center gap-2 mt-0.5">
                        <span>{text(`${doc.chunkCount} 块`, `${doc.chunkCount} chunks`)}</span>
                        <span>{new Date(doc.importedAt).toLocaleDateString(locale)}</span>
                      </div>
                    </div>
                    <span
                      className="text-[0.65rem] px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: corpusKind === 'reference'
                          ? 'color-mix(in srgb, var(--color-info) 14%, transparent)'
                          : 'var(--color-hover)',
                        color: corpusKind === 'reference' ? 'var(--color-category-progress-text)' : 'var(--color-text-secondary)',
                      }}
                    >
                      {text(corpusLabel.zh, corpusLabel.en)}
                    </span>
                    {registeredPath ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[0.7rem] px-2 gap-1 flex-shrink-0"
                        onClick={() => void handleOpenSourceDocument(registeredPath)}
                      >
                        <ExternalLink size={11} />
                        {text('打开文档', 'Open')}
                      </Button>
                    ) : (
                      <span className="text-[0.65rem] text-[var(--color-text-muted)] flex-shrink-0" title={text('导入型语料没有可打开的项目文档路径', 'Imported corpora have no openable project document path')}>
                        {text('无来源文件', 'No source file')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

/** 统计卡片子组件 */
function StatCard({ icon, label, value, accent, badge, badgeColor }: {
  icon: React.ReactNode
  label: string
  value: number | string
  accent?: boolean
  badge?: string
  badgeColor?: string
}) {
  return (
    <div
      className="rounded-xl p-4 border border-[var(--color-border)]"
      style={{ backgroundColor: 'var(--color-sidebar)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[var(--color-text-muted)]">{icon}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className={cn(
          'text-2xl font-bold',
          accent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'
        )}>
          {value}
        </div>
        {badge && (
          <span
            className="text-[0.6rem] px-1.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: `color-mix(in srgb, ${badgeColor} 12%, transparent)`, color: badgeColor }}
          >
            {badge}
          </span>
        )}
      </div>
    </div>
  )
}
