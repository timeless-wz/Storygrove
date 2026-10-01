import { useEffect, useState, useMemo, type ReactNode } from 'react'
import {
  Bot,
  BookOpen,
  BookMarked,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Compass,
  Globe2,
  Layers3,
  PanelRightClose,
  ShieldCheck,
  Users,
  Waypoints,
  MapPin,
  ExternalLink,
  Info,
} from 'lucide-react'
import { globalEventBus } from '../../shared/event-bus'
import type { ForeshadowingRecord } from '../../shared/foreshadowing'
import { useCharacterStore } from '../../stores/character-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { openBuiltinEditor } from './sidebar/sidebar-file-openers'
import { IconTooltip } from '../ui/Tooltip'
import { captureProjectSession } from '../project-session-gate'
import { ipc } from '../../services/ipc-client'
import { getWorldMapName } from '../../shared/world-map'
import type { ChapterBlueprint } from '../../services/workflows/directory-workflow'
import type { ReviewFull } from '../../../electron/repositories/review-repository'
import type { ChapterBlueprintV2DetailRead } from '../../shared/blueprint-v2'
import { assertNoLossOnSerialize } from '../../shared/blueprint-v2-markdown'

type ReferenceGroupProps = {
  icon: typeof Users
  title: string
  count?: number
  children: ReactNode
  defaultOpen?: boolean
}

function ReferenceGroup({ icon: Icon, title, count, children, defaultOpen = true }: ReferenceGroupProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="writer-reference-group">
      <button type="button" className="writer-reference-group-trigger" onClick={() => setOpen(value => !value)}>
        <span className="flex items-center gap-2 min-w-0">
          <Icon size={15} />
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="writer-reference-count">{count}</span>}
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && <div className="writer-reference-group-content">{children}</div>}
    </section>
  )
}

function ReferenceLink({ icon: Icon, label, detail, onClick }: {
  icon: typeof Users
  label: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="writer-reference-link" onClick={onClick}>
      <Icon size={15} />
      <span className="min-w-0 text-left">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate writer-reference-link-detail">{detail}</span>}
      </span>
    </button>
  )
}

export default function ProjectReferencePanel() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const dataProjectKey = useCharacterStore(s => s.dataProjectKey)
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)
  const setSidebarOpen = useLayoutStore(s => s.setSidebarOpen)
  const openBottomTab = useLayoutStore(s => s.openBottomTab)
  const openRightPanel = useLayoutStore(s => s.openRightPanel)
  const toggleReferencePanel = useLayoutStore(s => s.toggleReferencePanel)

  const activeTab = useEditorStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const worldMapNodes = useWorldMapStore(s => s.nodes)
  const worldMaps = useWorldMapStore(s => s.maps)
  const selectedNodeId = useWorldMapStore(s => s.selectedNodeId)

  const isChapterEditing = activeTab?.type === 'chapter' && (
    Boolean(activeTab.filePath?.startsWith('vela://draft/')) ||
    Boolean(activeTab.filePath?.startsWith('vela://manuscript/'))
  )

  // 正在写草稿时上下文感知的当前蓝图与审核状态
  const [currentBlueprint, setCurrentBlueprint] = useState<ChapterBlueprint | null>(null)
  const [currentBlueprintDetail, setCurrentBlueprintDetail] = useState<ChapterBlueprintV2DetailRead | null>(null)
  const [currentBlueprintNumber, setCurrentBlueprintNumber] = useState<number | null>(null)
  const [currentReview, setCurrentReview] = useState<ReviewFull | null>(null)
  const [chapterForeshadowings, setChapterForeshadowings] = useState<ForeshadowingRecord[]>([])
  const [blueprintLoading, setBlueprintLoading] = useState(false)
  const currentBlueprintMarkdown = useMemo(() => {
    if (!currentBlueprintDetail || currentBlueprintDetail.readStatus) return null
    try {
      return assertNoLossOnSerialize(currentBlueprintDetail)
    } catch {
      return null
    }
  }, [currentBlueprintDetail])

  const acknowledgeBlueprintReview = async () => {
    const session = captureProjectSession(currentProject)
    if (!session || !currentBlueprintNumber || !currentBlueprintDetail?.reviewNotices?.length) return
    try {
      const result = await ipc.invokeWithProjectSession(
        session, 'db:blueprint-v2-review-notices-clear', currentBlueprintNumber, session.projectPath,
      )
      if (result.success) {
        setCurrentBlueprintDetail(previous => previous ? { ...previous, reviewNotices: [] } : previous)
      }
    } catch {
      // Keep the persistent notice visible when acknowledgment could not be saved.
    }
  }

  useEffect(() => {
    const projectPath = currentProject?.path
    if (!projectPath || dataProjectKey === projectPath) return
    void useCharacterStore.getState().load(projectPath)
  }, [currentProject?.path, dataProjectKey])

  // 正文参考只跟随草稿明确保存的 blueprint_chapter_number；未绑定时不猜章号。
  const chapterNumber = activeTab?.chapterNumber
  useEffect(() => {
    if (activeTab?.type !== 'chapter' || !chapterNumber || !currentProject) {
      queueMicrotask(() => {
        setCurrentBlueprint(null)
        setCurrentBlueprintDetail(null)
        setCurrentBlueprintNumber(null)
        setCurrentReview(null)
      })
      return
    }
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return

    let cancelled = false
    setCurrentBlueprint(null)
    setCurrentBlueprintDetail(null)
    setCurrentBlueprintNumber(null)
    queueMicrotask(() => {
      if (!cancelled) setBlueprintLoading(true)
    })

    const readBoundBlueprint = async () => {
      try {
        const draftId = activeTab.draftId
        if (!draftId) return
        const meta = await ipc.invokeWithProjectSession(
          projectSession, 'db:draft-get-meta', draftId, projectSession.projectPath,
        )
        if (cancelled) return
        const boundNumber = meta?.blueprintChapterNumber
        if (!Number.isSafeInteger(boundNumber) || (boundNumber as number) <= 0) return
        setCurrentBlueprintNumber(boundNumber as number)
        const [bp, detail] = await Promise.all([
          ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get', boundNumber as number, projectSession.projectPath),
          ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-get', boundNumber as number, projectSession.projectPath),
        ])
        if (cancelled) return
        setCurrentBlueprint(bp as ChapterBlueprint | null)
        setCurrentBlueprintDetail(detail as ChapterBlueprintV2DetailRead | null)
      } catch {
        if (!cancelled) {
          setCurrentBlueprint(null)
          setCurrentBlueprintDetail(null)
        }
      } finally {
        if (!cancelled) setBlueprintLoading(false)
      }
    }
    void readBoundBlueprint()

    // 2. 获取最近审稿
    const draftId = activeTab.draftId
    if (draftId) {
      ipc.invokeWithProjectSession(projectSession, 'db:review-get-latest', draftId, projectSession.projectPath)
        .then((rev: unknown) => {
          if (!cancelled && rev) {
            setCurrentReview(rev as ReviewFull)
          } else if (!cancelled) {
            setCurrentReview(null)
          }
        })
        .catch(() => {
          if (!cancelled) setCurrentReview(null)
        })
    } else {
      queueMicrotask(() => {
        if (!cancelled) setCurrentReview(null)
      })
    }

    return () => {
      cancelled = true
    }
  }, [activeTab?.type, activeTab?.draftId, chapterNumber, currentProject])

  // 章节编辑时拉取该章节的伏笔与回收状态，并响应实时事件更新
  useEffect(() => {
    const draftId = activeTab?.draftId
    if (!isChapterEditing || !draftId || !currentProject) {
      setChapterForeshadowings([])
      return
    }

    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return

    let cancelled = false
    const fetchForeshadowings = () => {
      ipc.invokeWithProjectSession(projectSession, 'db:foreshadowing-list-by-draft', draftId, projectSession.projectPath)
        .then((list: unknown) => {
          if (!cancelled && Array.isArray(list)) {
            setChapterForeshadowings(list as ForeshadowingRecord[])
          }
        })
        .catch(() => {
          if (!cancelled) setChapterForeshadowings([])
        })
    }

    fetchForeshadowings()
    const unsubscribe = globalEventBus.on('FORESHADOWING_UPDATED', () => {
      fetchForeshadowings()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [isChapterEditing, activeTab?.draftId, currentProject])

  // 当前章节相关角色（优先筛选蓝图或本章正文中出现的角色，若无明确匹配则显示全部）
  const displayCharacters = useMemo(() => {
    if (!isChapterEditing) return characters
    const bpCharNames = new Set(currentBlueprint?.characters || [])
    const searchTarget = [
      currentBlueprint?.title || '',
      currentBlueprint?.purpose || '',
      currentBlueprint?.keyEvents || '',
      currentBlueprint?.userGuidance || '',
      activeTab?.name || '',
      (activeTab?.content || '').slice(0, 3000),
    ].join(' ')

    const matched = characters.filter(
      c => bpCharNames.has(c.name) || (c.name && searchTarget.includes(c.name))
    )
    return matched.length > 0 ? matched : characters
  }, [isChapterEditing, currentBlueprint, activeTab?.name, activeTab?.content, characters])

  // 关联的地图节点（根据蓝图细纲、标题、叙事目的和正文匹配）
  const linkedMapNodes = useMemo(() => {
    if (!currentBlueprint && activeTab?.type !== 'chapter') return []
    const bp = currentBlueprint
    const searchTarget = [
      bp?.title || '',
      bp?.purpose || '',
      bp?.keyEvents || '',
      bp?.userGuidance || '',
      activeTab?.name || '',
      (activeTab?.content || '').slice(0, 3000),
    ].join(' ')

    return worldMapNodes.filter(node => node.name && searchTarget.includes(node.name))
  }, [currentBlueprint, activeTab, worldMapNodes])

  // 地图册中当前选中的地点
  const activeMapNode = useMemo(() => {
    if (activeTab?.type !== 'world-map') return null
    return worldMapNodes.find(n => n.id === selectedNodeId) || null
  }, [activeTab?.type, worldMapNodes, selectedNodeId])

  const showCharacters = (characterName?: string) => {
    if (typeof characterName === 'string' && characterName.trim().length > 0) {
      useCharacterStore.getState().setSelectedName(characterName)
    }

    // 右侧面板是快捷入口；点击角色卡或“查看全部角色”必须稳定打开角色列表，
    // 绝不能触发侧栏反向收起。
    setSidebarView('characters')
    setSidebarOpen(true)
  }
  const showConfiguration = () => {
    setSidebarView('project')
    if (!currentProject) return
    useEditorStore.getState().openFile({
      id: 'config',
      name: text('小说配置', 'Novel configuration'),
      type: 'config',
      projectKey: currentProject.path,
    })
  }
  const showBlueprint = () => {
    setSidebarView('project')
    openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprints'), 'chapter-card')
  }
  const showWorld = () => {
    setSidebarView('project')
    openBuiltinEditor('world-building-editor', text('故事架构', 'Story architecture'), 'world-building')
  }
  const showPlot = () => {
    setSidebarView('project')
    openBuiltinEditor('narrative-thread-editor', text('伏笔与叙事线索', 'Foreshadowing & narrative threads'), 'narrative-thread', 'plans')
  }

  // 打开地图册
  const openWorldMap = () => {
    openBuiltinEditor('world-map-editor', text('多地图地图册', 'Map atlas'), 'world-map')
  }

  return (
    <aside className="writer-reference-panel" aria-label={text('上下文', 'Context')}>
      <header className="writer-reference-header">
        <div className="flex min-w-0 items-center gap-1.5">
          <Layers3 size={14} />
          <span className="truncate">{text('上下文', 'Context')}</span>
        </div>
        <IconTooltip label={text('收起上下文', 'Collapse context')}>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleReferencePanel}
          >
            <PanelRightClose size={14} />
          </button>
        </IconTooltip>
      </header>

      <div className="writer-reference-scroll space-y-1.5">
        {/* 1. 正文草稿上下文检查器 */}
        {activeTab?.type === 'chapter' && (
          <div className="writer-context-block space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="writer-context-block-title">
                <BookOpen size={13} />
                {currentBlueprintNumber
                  ? text(`第 ${currentBlueprintNumber} 章蓝图与创作指导`, `Chapter ${currentBlueprintNumber} blueprint & guidance`)
                  : text('当前草稿未绑定章节蓝图', 'This draft has no linked chapter blueprint')}
              </span>
              <button
                type="button"
                className="flex items-center gap-0.5 text-[11px] hover:underline"
                style={{ color: 'var(--writer-accent-text)' }}
                onClick={showBlueprint}
              >
                <span>{text('蓝图详情', 'Blueprint')}</span>
                <ExternalLink size={10} />
              </button>
            </div>

            {blueprintLoading ? (
              <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {text('加载章节蓝图中...', 'Loading blueprint...')}
              </div>
            ) : !currentBlueprintNumber ? (
              <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {text('此处只显示草稿明确绑定的蓝图；可通过蓝图绑定入口选择章节。', 'This panel only shows the blueprint explicitly linked to the draft. Use the blueprint binding action to choose one.')}
              </div>
            ) : currentBlueprint ? (
              <div className="space-y-2">
                {/* 章节标题与叙事目的 */}
                <div>
                  <div className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>
                    {currentBlueprint.title}
                  </div>
                  {currentBlueprint.purpose && (
                    <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                        {text('叙事目的：', 'Purpose: ')}
                      </span>
                      {currentBlueprint.purpose}
                    </div>
                  )}
                </div>

                {/* 关键事件清单 */}
                {currentBlueprint.keyEvents && (
                  <div className="writer-context-field">
                    <div className="writer-context-field-label">{text('关键事件', 'Key events')}</div>
                    <div className="writer-context-field-body">{currentBlueprint.keyEvents}</div>
                  </div>
                )}

                {(currentBlueprintDetail?.reviewNotices?.length ?? 0) > 0 && (
                  <div className="writer-context-field rounded border border-[var(--color-warning-border,var(--color-border))] p-2 text-[11px]" role="alert" data-testid="blueprint-name-review-notice">
                    <div className="font-semibold">{text('角色改名待核对', 'Character rename needs review')}</div>
                    <ul className="mt-1 list-disc pl-4 space-y-1">
                      {currentBlueprintDetail?.reviewNotices?.map((notice, index) => (
                        <li key={`${notice.oldName}-${notice.newName}-${index}`}>
                          {notice.oldName
                            ? text(`请核对「${notice.oldName} → ${notice.newName}」在细纲正文中的出现位置；正文未自动替换。`, `Check occurrences of “${notice.oldName} → ${notice.newName}” in the outline. The text was not automatically replaced.`)
                            : text('细纲中可能包含待核对的角色名；正文未自动替换。', 'A character name in this outline may need review. The text was not automatically replaced.')}
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="mt-2 underline" onClick={() => void acknowledgeBlueprintReview()}>
                      {text('我已核对细纲正文', 'I reviewed the outline text')}
                    </button>
                  </div>
                )}

                {currentBlueprintDetail && !currentBlueprintDetail.readStatus && currentBlueprintMarkdown && (
                  <details className="writer-context-field" data-testid="project-reference-blueprint-v2">
                    <summary className="cursor-pointer font-medium">
                      {text(
                        `阅读完整 v2 细纲（${currentBlueprintDetail.sections.length} 个分区）`,
                        `Read full v2 outline (${currentBlueprintDetail.sections.length} sections)`,
                      )}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed">{currentBlueprintMarkdown}</pre>
                  </details>
                )}
                {currentBlueprintDetail && !currentBlueprintDetail.readStatus && !currentBlueprintMarkdown && (
                  <div className="writer-context-field text-[11px] text-[var(--color-warning-text)]" role="status">
                    {text('完整细纲无法通过无损序列化自检，请在蓝图编辑器中核对。', 'The full outline failed the lossless serialization check. Inspect it in the blueprint editor.')}
                  </div>
                )}
                {currentBlueprintDetail?.readStatus && currentBlueprintDetail.rawMarkdown && (
                  <details className="writer-context-field" data-testid="project-reference-blueprint-v2-raw">
                    <summary className="cursor-pointer font-medium text-[var(--color-warning-text)]">
                      {text(
                        `细纲结构读取状态：${currentBlueprintDetail.readStatus}；查看保留的原始 Markdown`,
                        `Outline status: ${currentBlueprintDetail.readStatus}; inspect preserved raw Markdown`,
                      )}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed">{currentBlueprintDetail.rawMarkdown}</pre>
                  </details>
                )}

                {/* user_guidance 创作指导与细纲 */}
                {currentBlueprint.userGuidance && (
                  <div className="writer-context-field" style={{ borderLeft: '2px solid var(--color-accent)' }}>
                    <div className="writer-context-field-label">
                      <Info size={11} />
                      {text('创作指导与细纲 (user_guidance)', 'Creative guidance & outline (user_guidance)')}
                    </div>
                    <div className="writer-context-field-body">{currentBlueprint.userGuidance}</div>
                  </div>
                )}

                {/* 关联的地图册地点 */}
                <div className="pt-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                      <MapPin size={12} style={{ color: 'var(--writer-accent-text)' }} />
                      {text('关联地图节点', 'Linked map nodes')}
                    </span>
                    <button
                      type="button"
                      className="text-[10px] hover:underline"
                      style={{ color: 'var(--color-text-muted)' }}
                      onClick={openWorldMap}
                    >
                      {text('查看地图', 'View map')}
                    </button>
                  </div>
                  {linkedMapNodes.length > 0 ? (
                    <div className="space-y-1">
                      {linkedMapNodes.map(node => (
                        <div
                          key={node.id}
                          className="writer-context-field flex items-start justify-between gap-1.5"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                              <span>{node.name}</span>
                              <span className="writer-titlebar-meta" style={{ height: 16, padding: '0 5px', fontSize: 10 }}>
                                {node.type}
                              </span>
                              <span
                                className="writer-titlebar-meta writer-titlebar-meta--accent"
                                style={{ height: 16, padding: '0 5px', fontSize: 10 }}
                              >
                                {getWorldMapName(worldMaps, node.mapId)}
                              </span>
                            </div>
                            {node.description && (
                              <div className="mt-0.5 line-clamp-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                {node.description}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {text('本章细纲暂无明确匹配的地图地点', 'No recognized locations in this outline')}
                    </div>
                  )}
                </div>

                {/* 最近一致性审核状态 — 只报告偏差与跳转，不修改正文 */}
                <div className="pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                      <ShieldCheck size={12} style={{ color: 'var(--writer-accent-text)' }} />
                      {text('一致性审核发现', 'Consistency findings')}
                    </span>
                    {currentReview && (
                      <button
                        type="button"
                        className="text-[10px] hover:underline"
                        style={{ color: 'var(--writer-accent-text)' }}
                        onClick={() => {
                          if (!currentProject) return
                          useEditorStore.getState().openFile({
                            id: `review:${currentReview.id}`,
                            name: text(`第 ${chapterNumber} 章审稿报告`, `Ch ${chapterNumber} review`),
                            type: 'review-report',
                            content: currentReview.content,
                            filePath: activeTab.filePath,
                            chapterNumber,
                            reviewId: currentReview.id,
                            projectKey: currentProject.path,
                          })
                        }}
                      >
                        {text('查看完整报告', 'Full report')}
                      </button>
                    )}
                  </div>
                  {currentReview ? (
                    <div className="writer-context-field">
                      <div className="line-clamp-2 text-[11px]" style={{ color: 'var(--color-text)' }}>
                        {currentReview.content.slice(0, 100)}...
                      </div>
                      <div className="mt-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        {text('只读分析，仅报告偏差与证据；不会自动修改正文或蓝图', 'Read-only analysis reporting deviations and evidence only. It never edits prose or blueprints.')}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {text('暂无审核报告，可在正文编辑器工具栏点击「AI 审稿」启动只读审查', 'No audit yet. Click "AI Review" in the draft toolbar to run a read-only check.')}
                    </div>
                  )}
                </div>

                {/* 本章伏笔与回收状态 */}
                <div className="pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                      <Bookmark size={12} style={{ color: 'var(--writer-accent-text)' }} />
                      {text('本章伏笔与回收状态', 'Chapter foreshadowings & payoff')}
                    </span>
                    <button
                      type="button"
                      className="text-[10px] hover:underline"
                      style={{ color: 'var(--color-text-muted)' }}
                      onClick={() => openBuiltinEditor('foreshadowing-manager', text('伏笔管理', 'Foreshadowing'), 'foreshadowing')}
                    >
                      {text('管理伏笔', 'Manage')}
                    </button>
                  </div>
                  {chapterForeshadowings.length > 0 ? (
                    <div className="space-y-1">
                      {chapterForeshadowings.map(fsh => (
                        <div key={fsh.id} className="writer-context-field flex items-center justify-between gap-1.5">
                          <span className="truncate text-[11px]">“{fsh.selectedText}”</span>
                          <span
                            className="text-[10px] font-medium flex-shrink-0"
                            style={{ color: fsh.completed ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}
                          >
                            {fsh.completed ? text('已回收', 'Completed') : text('待回收', 'Pending')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {text('本章暂无伏笔标记', 'No foreshadowings for this chapter')}
                    </div>
                  )}
                </div>
              </div>
            ) : currentBlueprintDetail && !currentBlueprintDetail.readStatus ? (
              <div className="space-y-2">
                <div className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>
                  {currentBlueprintDetail.chapterTitle || text(`第 ${currentBlueprintNumber} 章细纲`, `Chapter ${currentBlueprintNumber} outline`)}
                </div>
                {currentBlueprintMarkdown ? (
                  <details className="writer-context-field" data-testid="project-reference-blueprint-v2">
                    <summary className="cursor-pointer font-medium">
                      {text(`阅读完整 v2 细纲（${currentBlueprintDetail.sections.length} 个分区）`, `Read full v2 outline (${currentBlueprintDetail.sections.length} sections)`)}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed">{currentBlueprintMarkdown}</pre>
                  </details>
                ) : (
                  <div className="writer-context-field text-[11px] text-[var(--color-warning-text)]" role="status">
                    {text('完整细纲无法通过无损序列化自检，请在蓝图编辑器中核对。', 'The full outline failed the lossless serialization check. Inspect it in the blueprint editor.')}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {text(`草稿绑定的第 ${currentBlueprintNumber} 章蓝图不存在或不可读取。`, `The blueprint linked to Chapter ${currentBlueprintNumber} does not exist or could not be read.`)}
              </div>
            )}
          </div>
        )}

        {/* 2. 地图册上下文检查器 */}
        {activeTab?.type === 'world-map' && (
          <div className="writer-context-block space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="writer-context-block-title">
                <Compass size={13} />
                {text('地图节点检查器', 'World map inspector')}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                {worldMapNodes.length} {text('处地点', 'locations')}
              </span>
            </div>

            {activeMapNode ? (
              <div className="space-y-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    <span>{activeMapNode.name}</span>
                    <span className="writer-titlebar-meta" style={{ height: 16, padding: '0 5px', fontSize: 10, fontWeight: 400 }}>
                      {activeMapNode.type}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    {text('所属地图：', 'Map: ')}{getWorldMapName(worldMaps, activeMapNode.mapId)}
                  </div>
                </div>

                {activeMapNode.description && (
                  <div className="writer-context-field">
                    <div className="writer-context-field-label">
                      {text('地点描述与物理机制', 'Description & rules')}
                    </div>
                    <div className="writer-context-field-body">{activeMapNode.description}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {text('在地图画布或列表中单击节点查看属性详情与规则约束。', 'Click a node on the canvas to inspect.')}
              </p>
            )}
          </div>
        )}

        {/* 3. 基础项目参考导航组：在草稿与正文创作时隐藏全局设定与资料，避免重复左侧栏并腾出写作空间 */}
        {!isChapterEditing && (
          <ReferenceGroup icon={BookMarked} title={text('项目设定', 'Project setup')}>
            <ReferenceLink
              icon={BookOpen}
              label={text('小说配置', 'Novel configuration')}
              detail={text('题材、篇幅与写作要求', 'Genre, length, and writing guidance')}
              onClick={showConfiguration}
            />
            <ReferenceLink
              icon={Globe2}
              label={text('故事架构与世界观', 'Story architecture & world')}
              detail={text('前提、世界规则与地点', 'Premise, rules, and locations')}
              onClick={showWorld}
            />
          </ReferenceGroup>
        )}

        <ReferenceGroup
          icon={Users}
          title={isChapterEditing ? text('当前章节相关角色', 'Chapter characters') : text('角色', 'Characters')}
          count={displayCharacters.length}
        >
          {displayCharacters.slice(0, 3).map(character => (
            <button
              type="button"
              className="writer-reference-character"
              key={character.name}
              onClick={() => showCharacters(character.name)}
            >
              <span className="writer-character-avatar">{character.name.slice(0, 1) || '?'}</span>
              <span className="min-w-0 text-left">
                <span className="block truncate">{character.name}</span>
                <span className="block truncate writer-reference-link-detail">
                  {[character.role, character.age].filter(Boolean).join(' · ') || text('查看角色资料', 'Open character profile')}
                </span>
              </span>
            </button>
          ))}
          {displayCharacters.length === 0 && (
            <ReferenceLink
              icon={Users}
              label={text('管理角色资料', 'Manage character profiles')}
              detail={text('角色库', 'Character roster')}
              onClick={() => showCharacters()}
            />
          )}
          {displayCharacters.length > 0 && (
            <ReferenceLink
              icon={Users}
              label={text('查看全部角色', 'View all characters')}
              onClick={() => showCharacters()}
            />
          )}
        </ReferenceGroup>

        <ReferenceGroup icon={Waypoints} title={text('创作规划', 'Writing plan')}>
          <ReferenceLink
            icon={BookMarked}
            label={text('卷纲与章节细纲', 'Volume & chapter blueprints')}
            detail={currentProject?.novelConfig?.totalChapters ? text(`共 ${currentProject.novelConfig.totalChapters} 章`, `${currentProject.novelConfig.totalChapters} chapters`) : undefined}
            onClick={showBlueprint}
          />
          <ReferenceLink
            icon={Waypoints}
            label={text('伏笔与叙事线索', 'Foreshadowing & narrative threads')}
            detail={text('事件、埋设与回收', 'Events, setup, and payoff')}
            onClick={showPlot}
          />
        </ReferenceGroup>

        {!isChapterEditing && (
          <ReferenceGroup icon={Compass} title={text('创作资料', 'Writing sources')}>
            <ReferenceLink
              icon={Compass}
              label={text('创作资料中枢', 'Writing sources hub')}
              detail={text('批准资料、规则与章节上下文', 'Approved sources, rules, and chapter context')}
              onClick={() => setSidebarView('workspace')}
            />
            <ReferenceLink
              icon={BookOpen}
              label={text('本地知识库', 'Local knowledge base')}
              detail={text('导入资料与语义检索', 'Imported materials and semantic search')}
              onClick={() => setSidebarView('knowledge')}
            />
          </ReferenceGroup>
        )}

        <ReferenceGroup icon={ClipboardCheck} title={text('任务', 'Tasks')} count={activeRuns.length} defaultOpen={false}>
          <ReferenceLink
            icon={ClipboardCheck}
            label={text('查看创作任务与审核进度', 'View writing tasks & review progress')}
            onClick={() => openBottomTab('tasks')}
          />
        </ReferenceGroup>
      </div>

      <footer className="writer-reference-ai-shortcuts">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          <ShieldCheck size={13} style={{ color: 'var(--writer-accent-text)' }} />
          {text('只读审核助手', 'Read-only audit assistant')}
        </div>
        <button
          type="button"
          className="writer-ai-shortcut w-full mt-1.5"
          onClick={() => openRightPanel('agent')}
        >
          <Bot size={13} />
          {text('打开 AI 助手', 'Open AI assistant')}
        </button>
      </footer>
    </aside>
  )
}
