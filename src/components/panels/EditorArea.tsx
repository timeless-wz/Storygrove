import CultivationSettingsPage from '../pages/CultivationSettingsPage'
import { X, FileText, Settings, Users, ArrowLeftRight, MoreHorizontal, BookOpen, History, ClipboardCheck, Globe, Save, ChevronLeft, ChevronRight, Check, Focus, Compass, LayoutDashboard, Clock3, Globe2 } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { IconTooltip } from '../ui/Tooltip'
import VditorProseEditor from '../editor/VditorProseEditor'
import NovelConfigEditor from '../editor/NovelConfigEditor'
import CharacterEditor from '../editor/CharacterEditor'
import ChapterCardEditor from '../editor/ChapterCardEditor'
import WorldBuildingEditor from '../editor/WorldBuildingEditor'
import ArchFileViewer from '../editor/ArchFileViewer'
import ProjectDocumentEditor from '../editor/ProjectDocumentEditor'
import DraftEditor from '../editor/DraftEditor'
import ChapterOutlineSidebar from '../editor/ChapterOutlineSidebar'
import VersionHistory from '../editor/VersionHistory'
import ReviewReport from '../editor/ReviewReport'
import NarrativeThreadEditor from '../editor/NarrativeThreadEditor'
import ForeshadowingManagementView from '../editor/ForeshadowingManagementView'
import ThreeWayMerge from '../editor/ThreeWayMerge'  // 保留引用以防其他入口使用
import WelcomePage from '../pages/WelcomePage'
import KnowledgeOverview from '../pages/KnowledgeOverview'
import WorkspaceHub from '../workspace/WorkspaceHub'
import WorldMapView from '../map/WorldMapView'
import StoryTimelineView from '../timeline/StoryTimelineView'
import WorldWorkbenchView from '../world/WorldWorkbenchView'
import ProjectOverviewPage from '../pages/ProjectOverviewPage'
import { useProjectStore } from '../../stores/project-store'
import { registerEditorExitSaveHandler, useEditorStore, type EditorTab } from '../../stores/editor-store'
import {
  hasEditorExitSaveHandler,
  saveEditorTabBeforeClose,
} from '../../stores/editor-store'
import { discardAndCloseEditorTab } from '../../stores/editor-discard'
import { useLayoutStore } from '../../stores/layout-store'
import { useLocaleStore } from '../../stores/locale-store'


import { ipc } from '../../services/ipc-client'
import { requireIpcSuccess } from '../../services/ipc-result'
import { toast } from '../ui/Toast'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../project-session-gate'

import { savePhysicalChapterForSession } from './editor-area-physical-save'
import '../editor/novel-editor.css'

// ─── 正文章节编辑器包装层（含字数信息栏） ─────────────────────────────────────────────
function ProseEditorWrapper({
  tab,
  onSave,
  unsavedOnly = false,
}: {
  tab: EditorTab
  onSave?: (text: string) => Promise<void>
  unsavedOnly?: boolean
}) {
  const [wordCount, setWordCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const fileName = tab.name
  // 追踪当前编辑器内容，供保存按钮使用（不触发重渲染）
  const currentContentRef = useRef(tab.content ?? '')
  const text = useLocaleStore(s => s.text)

  const handleSave = useCallback(async (text: string) => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
    }
  }, [onSave])

  useEffect(() => {
    if (!onSave) return
    registerEditorExitSaveHandler({
      tabId: tab.id,
      type: tab.type,
      projectKey: tab.projectKey,
      save: () => handleSave(currentContentRef.current),
    })
  }, [handleSave, onSave, tab.id, tab.projectKey, tab.type])

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* 顶部信息栏（背景与编辑区一致） */}
      <div
        className="flex items-center justify-between px-3.5 h-10 flex-shrink-0 transition-colors border-b select-none"
        style={{
          borderColor: 'var(--editor-ruled-line, var(--color-border))',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        {/* 左侧：文件名 */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="block text-xs font-semibold truncate" style={{ color: 'var(--editor-ink-primary, var(--color-text))' }}>
            {fileName}
          </span>
          {unsavedOnly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[var(--editor-selection-bg,var(--color-hover))]" style={{ color: 'var(--color-warning-text)', border: '1px solid var(--color-warning)' }}>
              {text('项目恢复候选；不会自动写入正式草稿', 'Project recovery candidate; it is not written to the formal draft automatically')}
            </span>
          )}
        </div>

        {/* 右侧：字数 + dirty 指示灯 + 保存按钮 */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {wordCount > 0 && (
            <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--editor-ink-muted, var(--color-text-muted))' }}>
              {text(`${wordCount.toLocaleString()} 字`, `${wordCount.toLocaleString()} words`)}
            </span>
          )}
          {/* 未保存圆点指示灯 */}
          {tab.dirty && (
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
              style={{ backgroundColor: 'var(--color-warning)' }}
              title={text('有未保存的修改', 'Unsaved changes')}
            />
          )}
          {/* 保存按钮（有改动时显示） */}
          {tab.dirty && onSave && (
            <button
              className="icon-btn"
              style={{ width: 24, height: 22 }}
              onClick={() => handleSave(currentContentRef.current)}
              disabled={saving}
              title={text('保存（⌘S）', 'Save (⌘S)')}
            >
              <Save size={13} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* 编辑器主体 */}
      <div className="flex-1 overflow-hidden">
        <VditorProseEditor
          key={tab.id}
          content={tab.content ?? ''}
          editable={true}
          onCharCountChange={setWordCount}
          onChange={(text) => {
            // 同步 ref，供保存按钮使用
            currentContentRef.current = text
            // 标记 tab.dirty
            useEditorStore.getState().updateTabContent(tab.id, text)
          }}
          onSave={onSave ? (text) => handleSave(text) : undefined}
          placeholder={text('开始写这一章…', 'Start writing this chapter…')}
        />
      </div>
    </div>
  )
}

interface EditorAreaProps {
  onNewProject: () => void
}

/** 中间主编辑区 */
export default function EditorArea({ onNewProject }: EditorAreaProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore((s) => s.currentProject)
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const openFile = useEditorStore(s => s.openFile)
  const closeTab = useEditorStore(s => s.closeTab)
  const setActiveTab = useEditorStore(s => s.setActiveTab)
  const sidebarView = useLayoutStore((s) => s.sidebarView)
  const focusMode = useLayoutStore((s) => s.focusMode)
  const toggleFocusMode = useLayoutStore((s) => s.toggleFocusMode)
  const referencePanelOpen = useLayoutStore((s) => s.referencePanelOpen)
  const toggleReferencePanel = useLayoutStore((s) => s.toggleReferencePanel)



  // ===== 所有 Hooks 必须在条件 return 之前 =====

  // 打开或切换项目后，先进入项目总览；小说配置仍可从项目树和上下文入口打开。
  // project.id 对所有项目都可能相同，因此必须以绝对路径作为切换身份。
  // openFile 会复用同项目的现有总览 Tab，同时保留其他项目的未保存 Tab。
  useEffect(() => {
    const projectPath = currentProject?.path
    if (!projectPath) return
    openFile({
      id: 'project-overview',
      name: useLocaleStore.getState().text('项目总览', 'Project overview'),
      type: 'overview',
      projectKey: projectPath,
    })
  }, [currentProject?.path, openFile])

  // 防御性兜底：tabs 有内容但 activeTabId 无效时，激活第一个 tab
  const activeTab = tabs.find((t) => t.id === activeTabId)
  useEffect(() => {
    if (tabs.length > 0 && !activeTab) {
      setActiveTab(tabs[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, activeTab])

  // Tab 条自动滚动到当前活跃 Tab
  const tabBarRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeTabRef.current && tabBarRef.current) {
      activeTabRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [activeTabId])

  /** 点击左右箭头时切换到上/下一个 Tab */
  const switchTab = useCallback((direction: 'left' | 'right') => {
    if (tabs.length === 0) return
    const currentIndex = tabs.findIndex(t => t.id === activeTabId)
    let nextIndex: number
    if (direction === 'left') {
      nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1
    } else {
      nextIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1
    }
    setActiveTab(tabs[nextIndex].id)
  }, [tabs, activeTabId, setActiveTab])

  // ===== 三个点菜单状态 =====
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [moreMenuPosition, setMoreMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  // ===== Tab 右键菜单状态 =====
  const [tabMenu, setTabMenu] = useState<{
    tabId: string
    position: { x: number; y: number }
  } | null>(null)

  // ===== 关闭确认弹窗状态 =====
  const [closeConfirm, setCloseConfirm] = useState<string | null>(null) // 单个待关闭的 tabId
  // 批量关闭确认：待关闭的 tabId 列表（含 dirty 的）
  const [batchCloseConfirm, setBatchCloseConfirm] = useState<string[] | null>(null)

  const closeMoreMenu = useCallback(() => {
    setMoreMenuOpen(false)
    setMoreMenuPosition(null)
  }, [setMoreMenuOpen, setMoreMenuPosition])

  const toggleMoreMenu = useCallback(() => {
    if (moreMenuOpen) {
      closeMoreMenu()
      return
    }

    const rect = moreButtonRef.current?.getBoundingClientRect()
    if (!rect) return

    setMoreMenuPosition({ x: rect.right - 200, y: rect.bottom + 4 })
    setMoreMenuOpen(true)
  }, [closeMoreMenu, moreMenuOpen, setMoreMenuOpen, setMoreMenuPosition])

  // 绑定 ⌘W 快捷键：关闭当前 Tab（带 dirty 检查）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault()
        const { activeTabId: aid, tabs: ts } = useEditorStore.getState()
        if (aid) {
          const t = ts.find(x => x.id === aid)
          if (t && !t.pinned) {
            if (t.dirty) {
              setCloseConfirm(aid)
            } else {
              useEditorStore.getState().closeTab(aid)
            }
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCloseConfirm])

  /** 尝试关闭 Tab：如果有未保存修改则弹确认对话框 */
  const tryCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    if (tab.pinned) return
    if (tab.dirty) {
      // 有未保存修改，弹确认弹窗
      setCloseConfirm(tabId)
    } else {
      closeTab(tabId)
    }
  }, [tabs, closeTab, setCloseConfirm])

  /** 尝试批量关闭 Tab：收集待关闭列表，若其中有 dirty tab 则弹确认弹窗 */
  const tryBatchClose = useCallback((tabIds: string[]) => {
    const cleanIds = tabIds.filter(id => {
      const t = tabs.find(t => t.id === id)
      return t && !t.pinned
    })
    const dirtyIds = cleanIds.filter(id => tabs.find(t => t.id === id)?.dirty)
    if (dirtyIds.length > 0) {
      // 待关闭列表都放入批量确认弹窗中，一次性关闭
      setBatchCloseConfirm(cleanIds)
    } else {
      cleanIds.forEach(id => closeTab(id))
    }
  }, [tabs, closeTab, setBatchCloseConfirm])

  /** 构建 Tab 右键菜单项 */
  const buildTabMenuItems = useCallback(
    (tabId: string): ContextMenuEntry[] => {
      const tab = tabs.find(t => t.id === tabId)
      const tabIndex = tabs.findIndex(t => t.id === tabId)
      const hasOthers = tabs.length > 1
      const hasRight = tabIndex < tabs.length - 1

      return [
        {
          key: 'close',
          label: text('关闭', 'Close'),
          shortcut: '⌘W',
          disabled: tab?.pinned,
          onClick: () => tryCloseTab(tabId),
        },
        {
          key: 'close-others',
          label: text('关闭其他', 'Close others'),
          disabled: !hasOthers || tab?.pinned,
          onClick: () => {
            const others = tabs
              .filter(t => t.id !== tabId && !t.pinned)
              .map(t => t.id)
            tryBatchClose(others)
          },
        },
        {
          key: 'close-right',
          label: text('关闭右侧所有', 'Close all to the right'),
          disabled: !hasRight,
          onClick: () => {
            const right = tabs
              .slice(tabIndex + 1)
              .filter(t => !t.pinned)
              .map(t => t.id)
            tryBatchClose(right)
          },
        },
        { key: 'div1', type: 'divider' as const },
        {
          key: 'close-all',
          label: text('关闭所有', 'Close all'),
          danger: true,
          onClick: () => {
            const all = tabs.filter(t => !t.pinned).map(t => t.id)
            tryBatchClose(all)
          },
        },
      ]
    },
    [tabs, tryCloseTab, tryBatchClose, text]
  )

  /** 构建三个点菜单项（Tab 操作 + 已打开 Tab 列表） */
  const buildMoreMenuItems = useCallback((): ContextMenuEntry[] => {
    const hasActive = !!activeTabId
    const activeTab = tabs.find(t => t.id === activeTabId)
    const activeIndex = tabs.findIndex(t => t.id === activeTabId)
    const hasOthers = tabs.length > 1
    const hasRight = activeIndex < tabs.length - 1

    return [
      {
        key: 'close-current',
        label: text('关闭', 'Close'),
        shortcut: '⌘W',
        disabled: !hasActive || activeTab?.pinned,
        onClick: () => { if (activeTabId) tryCloseTab(activeTabId) },
      },
      {
        key: 'close-others',
        label: text('关闭其他', 'Close others'),
        disabled: !hasActive || !hasOthers,
        onClick: () => {
          const others = tabs
            .filter(t => t.id !== activeTabId && !t.pinned)
            .map(t => t.id)
          tryBatchClose(others)
        },
      },
      {
        key: 'close-right',
        label: text('关闭右侧所有', 'Close all to the right'),
        disabled: !hasActive || !hasRight,
        onClick: () => {
          const right = tabs
            .slice(activeIndex + 1)
            .filter(t => !t.pinned)
            .map(t => t.id)
          tryBatchClose(right)
        },
      },
      { key: 'div-close', type: 'divider' as const },
      {
        key: 'close-all',
        label: text('关闭所有', 'Close all'),
        danger: true,
        onClick: () => {
          const all = tabs.filter(t => !t.pinned).map(t => t.id)
          tryBatchClose(all)
        },
      },
      // 已打开的 Tab 列表
      ...(tabs.length > 0 ? [
        { key: 'div-list', type: 'divider' as const } as ContextMenuEntry,
        ...tabs.map(t => ({
          key: `goto-${t.id}`,
          label: t.name,
          icon: t.id === activeTabId
            ? <Check size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--color-accent)' }} />
            : undefined,
          onClick: () => setActiveTab(t.id),
        })),
      ] : []),
    ]
  }, [tabs, activeTabId, tryCloseTab, tryBatchClose, setActiveTab, text])

  // ===== 条件渲染 =====

  // 侧栏为「主页」时，中间区域显示欢迎页
  if (sidebarView === 'home') {
    return (
      <WelcomePage
        onNewProject={() => {
          useLayoutStore.getState().openNewProject()
        }}
        onOpenProject={async () => {
          const folder = await ipc.invoke('dialog:select-folder')
          if (folder) {
            useProjectStore.getState().openProject(folder)
          }
        }}
        onImportNovel={() => {
          useLayoutStore.getState().openImportNovel()
        }}
      />
    )
  }

  // 侧栏为「角色管理」时，中间区域固定展示角色编辑器（跳过 Tab 系统）
  if (sidebarView === 'characters') {
    return (
      <div
        className="skin-workspace-page w-full h-full flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-editor-bg)' }}
      >
        <CharacterEditor projectKey={currentProject?.path ?? ''} />
      </div>
    )
  }

  // 侧栏为「知识库」时，中间区域固定展示向量数据库查询界面（跳过 Tab 系统）
  if (sidebarView === 'knowledge') {
    return <KnowledgeOverview />
  }

  // 侧栏为「中枢」时，中间区域固定展示创作资料中枢界面（跳过 Tab 系统）
  if (sidebarView === 'workspace') {
    return <WorkspaceHub />
  }

  // 未打开项目时显示欢迎页
  if (!currentProject) {
    return (
      <WelcomePage
        onNewProject={onNewProject}
        onOpenProject={async () => {
          const folder = await ipc.invoke('dialog:select-folder')
          if (folder) {
            useProjectStore.getState().openProject(folder)
          }
        }}
        onImportNovel={() => {
          useLayoutStore.getState().openImportNovel()
        }}
      />
    )
  }

  // 有项目但没有打开的 Tab：展示项目总览面板
  if (tabs.length === 0) {
    return (
      <div
        className="skin-workspace-page w-full h-full flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-editor-bg)' }}
      >
        <ProjectOverviewPage />
      </div>
    )
  }

  /** Tab 图标 */
  const TabIcon = ({ type }: { type: EditorTab['type'] }) => {
    if (type === 'config') return <Settings size={14} />
    if (type === 'character') return <Users size={14} />
    if (type === 'diff') return <ArrowLeftRight size={14} />
    if (type === 'chapter-card') return <BookOpen size={14} />
    if (type === 'world-building') return <Globe size={14} />
    if (type === 'world-map') return <Compass size={14} />
    if (type === 'story-timeline') return <Clock3 size={14} />
    if (type === 'world') return <Globe2 size={14} />
    if (type === 'overview') return <LayoutDashboard size={14} />
    if (type === 'version-history') return <History size={14} />
    if (type === 'review-report') return <ClipboardCheck size={14} />
    if (type === 'project-document') return <FileText size={14} />
    return <FileText size={14} />
  }

  return (
    <div
      className="skin-workspace-page w-full h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--color-editor-bg)' }}
    >
      {/* Tab 条：左右箭头 + 可横向滚动区域 + 三个点菜单 */}
      <div
        className="no-select flex items-center flex-shrink-0"
        style={{
          height: 'var(--height-tab)',
          backgroundColor: 'var(--color-tab-bg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* Tab 列表可滚动区域 — 扁平标签，激活态只用 2px 细底线 */}
        <div ref={tabBarRef} className="writer-tab-list">
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id
            return (
              <div
                key={tab.id}
                ref={isActive ? activeTabRef : undefined}
                role="tab"
                aria-selected={isActive}
                className={`writer-tab group/tab${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={e => {
                  e.preventDefault()
                  setActiveTab(tab.id)
                  setTabMenu({ tabId: tab.id, position: { x: e.clientX, y: e.clientY } })
                }}
              >
                <TabIcon type={tab.type} />
                <span className="writer-tab-name">{tab.name}</span>

                {/* 关闭区：未保存时显示实心圆点，悬停切换为关闭按钮 */}
                {tab.dirty ? (
                  <span
                    className="writer-tab-close group/close"
                    onClick={e => { e.stopPropagation(); tryCloseTab(tab.id) }}
                    title={text('有未保存的修改，点击关闭', 'Unsaved changes; click to close')}
                  >
                    <span className="writer-tab-dirty group-hover/close:hidden" />
                    <X size={10} className="hidden group-hover/close:block" />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="writer-tab-close opacity-0 transition-opacity group-hover/tab:opacity-100"
                    aria-label={text('关闭标签页', 'Close tab')}
                    onClick={e => { e.stopPropagation(); tryCloseTab(tab.id) }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* 右侧操作区：参考上下文 + 专注模式 + 上一个/下一个 + 已打开编辑器列表 */}
        <div
          className="flex items-center flex-shrink-0 h-full gap-0.5 px-1"
          style={{ borderLeft: '1px solid var(--color-border)' }}
        >
          <IconTooltip label={referencePanelOpen ? text('收起参考上下文', 'Collapse reference context') : text('展开参考上下文', 'Expand reference context')}>
            <button
              className={`icon-btn flex-shrink-0 ${referencePanelOpen ? 'text-[var(--color-accent)]' : ''}`}
              onClick={toggleReferencePanel}
              title={text(referencePanelOpen ? '收起参考上下文' : '展开参考上下文', referencePanelOpen ? 'Collapse reference context' : 'Expand reference context')}
            >
              <BookOpen size={14} />
            </button>
          </IconTooltip>
          <IconTooltip label={focusMode ? text('退出专注模式', 'Exit focus mode') : text('专注模式', 'Focus mode')}>
            <button
              className="icon-btn flex-shrink-0"
              onClick={toggleFocusMode}
            >
              <Focus size={14} />
            </button>
          </IconTooltip>
          <IconTooltip label={text('上一个编辑器', 'Previous editor')}>
            <button className="icon-btn flex-shrink-0" onClick={() => switchTab('left')}>
              <ChevronLeft size={14} />
            </button>
          </IconTooltip>
          <IconTooltip label={text('下一个编辑器', 'Next editor')}>
            <button className="icon-btn flex-shrink-0" onClick={() => switchTab('right')}>
              <ChevronRight size={14} />
            </button>
          </IconTooltip>
          <IconTooltip label={text('已打开的编辑器', 'Open editors')}>
            <button ref={moreButtonRef} className="icon-btn flex-shrink-0" onClick={toggleMoreMenu}>
              <MoreHorizontal size={14} />
            </button>
          </IconTooltip>
        </div>
      </div>



      {/* 编辑区主体 */}
      <div className="flex-1 min-h-0 overflow-hidden flex relative">
        {(activeTab?.type === 'chapter' || activeTab?.type === 'chapter-directory') && activeTab.projectKey === currentProject.path
          && !activeTab.filePath?.startsWith('vela://recovery/') && (
          <ChapterOutlineSidebar key={`${currentProject.id}:${currentProject.sessionLease}:${activeTab.draftStatus === 'finalized' || activeTab.filePath?.startsWith('vela://manuscript/') ? 'manuscript' : activeTab.proseDirectoryKind || 'draft'}`} tab={activeTab} />
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
        {activeTab?.type === 'chapter-directory' && activeTab.projectKey === currentProject.path && <div className="chapter-directory-empty">{text('展开左侧的卷，选择章节开始写作；也可以添加卷或章节。', 'Expand a volume and select a chapter, or add a volume or chapter.')}</div>}
        {activeTab?.type === 'chapter' && activeTab.projectKey === currentProject.path && (
          activeTab.filePath?.startsWith('vela://draft/')
          || activeTab.filePath?.startsWith('vela://manuscript/')
        ) && (
          // 草稿文件：使用 DraftEditor（工具栏含修稿/审稿/定稿按鈕）
          <DraftEditor
            key={activeTab.id}
            tabId={activeTab.id}
            filePath={activeTab.filePath}
            content={activeTab.content ?? ''}
            projectKey={activeTab.projectKey}
          />
        )}
        {activeTab?.type === 'chapter' && activeTab.projectKey === currentProject.path
          && activeTab.filePath?.startsWith('vela://recovery/') && (
          <ProseEditorWrapper
            key={activeTab.id}
            tab={activeTab}
            onSave={async content => {
              const projectSession = captureProjectSession(currentProject)
              const candidateId = activeTab.filePath?.slice('vela://recovery/'.length)
              if (
                !projectSession
                || !candidateId
                || !isProjectSessionPath(projectSession, activeTab.projectKey)
              ) return
              const tab = useEditorStore.getState().tabs.find(candidate => candidate.id === activeTab.id)
              if (!tab) return
              const snapshot = { content, contentRevision: tab.contentRevision ?? 0 }
              const result = await ipc.invokeWithProjectSession(
                projectSession,
                'db:recovery-candidate-update',
                candidateId,
                content,
                projectSession.projectPath,
              )
              requireIpcSuccess(result, '保存恢复候选')
              if (!isProjectSessionCurrent(projectSession)) return
              useEditorStore.getState().settleTabSave(activeTab.id, snapshot)
            }}
            unsavedOnly
          />
        )}
        {activeTab?.type === 'chapter' && activeTab.projectKey === currentProject.path
          && !activeTab.filePath?.startsWith('vela://draft/')
          && !activeTab.filePath?.startsWith('vela://manuscript/')
          && !activeTab.filePath?.startsWith('vela://recovery/') && (
          // 【DB 迁移备注】：终稿目前作为物理文件保存在 manuscript/ 目录是合理的（用于外部阅读器或最终打包编译导出）
          // 终稿文件（manuscript/）：用 ProseEditorWrapper（含字数信息栏）
          <ProseEditorWrapper
            key={activeTab.id}
            tab={activeTab}
            onSave={async (text) => {
              if (!activeTab.filePath) return
              const projectSession = captureProjectSession(currentProject)
              if (
                !projectSession
                || !isProjectSessionPath(projectSession, activeTab.projectKey)
              ) return
              await savePhysicalChapterForSession({
                tabId: activeTab.id,
                filePath: activeTab.filePath,
                content: text,
                projectSession,
              })
            }}
          />
        )}
        {activeTab?.type === 'cultivation' && activeTab.projectKey === currentProject.path && <CultivationSettingsPage key={activeTab.id} projectKey={activeTab.projectKey} />}
        {activeTab?.type === 'config' && activeTab.projectKey && (
          <NovelConfigEditor key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'outline' && (
          <div className="h-full overflow-y-auto p-6">
            <pre
              className="text-sm whitespace-pre-wrap font-mono leading-6"
              style={{ color: 'var(--color-text)' }}
            >
              {activeTab.content || text('加载中...', 'Loading...')}
            </pre>
          </div>
        )}
        {activeTab?.type === 'character' && activeTab.projectKey && (
          <CharacterEditor key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'chapter-card' && activeTab.projectKey && (
          <ChapterCardEditor
            key={activeTab.id}
            projectKey={activeTab.projectKey}
            initialChapterNumber={activeTab.chapterNumber}
            initialChapterView={activeTab.chapterView}
            chapterViewRequest={activeTab.chapterViewRequest}
          />
        )}
        {activeTab?.type === 'world-building' && activeTab.projectKey && (
          <WorldBuildingEditor key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'narrative-thread' && activeTab.projectKey === currentProject.path && (
          <NarrativeThreadEditor
            key={activeTab.id}
            projectKey={activeTab.projectKey}
            initialView={activeTab.narrativeThreadView ?? 'plans'}
            viewRequest={activeTab.narrativeThreadViewRequest}
          />
        )}
        {activeTab?.type === 'arch-file' && activeTab.filePath && activeTab.projectKey && (
          <ArchFileViewer
            key={activeTab.id}
            tabId={activeTab.id}
            filePath={activeTab.filePath}
            projectKey={activeTab.projectKey}
            content={activeTab.content ?? ''}
            savedContent={activeTab.savedContent ?? activeTab.content ?? ''}
          />
        )}
        {activeTab?.type === 'version-history' && activeTab.projectKey === currentProject.path && (
          <VersionHistory projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'review-report' && activeTab.projectKey === currentProject.path && activeTab.content && (
          <ReviewReport
            reportText={activeTab.content}
            draftPath={activeTab.filePath}
            chapterNumber={activeTab.chapterNumber}
            chapterDir={activeTab.chapterDir}
            reviewId={activeTab.reviewId}
            projectKey={activeTab.projectKey}
          />
        )}
        {activeTab?.type === 'world-map' && activeTab.projectKey === currentProject.path && (
          <WorldMapView key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'story-timeline' && activeTab.projectKey === currentProject.path && (
          <StoryTimelineView key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'world' && activeTab.projectKey === currentProject.path && (
          <WorldWorkbenchView key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {activeTab?.type === 'overview' && (
          <ProjectOverviewPage key={activeTab.id} />
        )}
        {activeTab?.type === 'project-document'
          && activeTab.projectKey === currentProject.path
          && activeTab.filePath && (
          <ProjectDocumentEditor
            key={activeTab.id}
            tabId={activeTab.id}
            documentPath={activeTab.filePath}
            projectKey={activeTab.projectKey}
            content={activeTab.content ?? ''}
            savedContent={activeTab.savedContent ?? activeTab.content ?? ''}
          />
        )}
        {activeTab?.type === 'foreshadowing' && activeTab.projectKey === currentProject.path && (
          <ForeshadowingManagementView key={activeTab.id} projectKey={activeTab.projectKey} />
        )}
        {/* AI 建议预览 — 只读对比，统一使用弹出式 Dialog（与 DraftEditor 一致） */}
        <Dialog
          open={
            activeTab?.type === 'diff'
            && activeTab.projectKey === currentProject.path
            && !!activeTab.originalContent
            && !!activeTab.content
          }
          onOpenChange={(v) => {
            if (!v && activeTab?.type === 'diff') {
              useEditorStore.getState().closeTab(activeTab.id)
            }
          }}
        >
          <DialogContent
            className="p-0"
            style={{
              width: '90vw',
              maxWidth: '90vw',
              height: '85vh',
              maxHeight: '85vh',
              overflow: 'hidden',
            }}
            onPointerDownOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader className="px-4 py-0" style={{ height: 50, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
              <DialogTitle className="flex items-center gap-2 text-[0.8rem]">
                {text(`AI 建议预览 — ${activeTab?.name ?? '对比视图'}`, `AI suggestion preview — ${activeTab?.name ?? 'Comparison'}`)}
              </DialogTitle>
              <DialogDescription className="text-[11px]">
                {text('只读对比：不会自动写入正文，采用与否由作者决定。', 'Read-only comparison: it is never written to the manuscript automatically.')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-hidden" style={{ height: 'calc(85vh - 50px - 1px)' }}>
              {activeTab?.type === 'diff'
                && activeTab.projectKey === currentProject.path
                && activeTab.originalContent
                && activeTab.content && (
                <ThreeWayMerge
                  originalContent={activeTab.originalContent}
                  modifiedContent={activeTab.content}
                  onComplete={() => {
                    toast.info(text('Codex 创作工作台已禁用自动修稿回写，请由作者手工编辑正文。', 'Automated revision write-back is disabled in Codex creative workbench. Please edit prose manually.'))
                    useEditorStore.getState().closeTab(activeTab.id)
                  }}
                  onCancel={() => useEditorStore.getState().closeTab(activeTab.id)}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>

        </div>
      </div>

      {/* Tab 右键菜单 */}
      {tabMenu && (
        <ContextMenu
          items={buildTabMenuItems(tabMenu.tabId)}
          position={tabMenu.position}
          onClose={() => setTabMenu(null)}
        />
      )}

      {/* 三个点菜单（已打开的编辑器列表 + Tab 操作） */}
      {moreMenuOpen && moreMenuPosition && (
        <ContextMenu
          items={buildMoreMenuItems()}
          position={moreMenuPosition}
          onClose={closeMoreMenu}
        />
      )}

      {/* 关闭未保存 Tab 确认弹窗 — 保存 / 放弃 / 取消 */}
      <Dialog
        open={closeConfirm !== null}
        onOpenChange={v => !v && setCloseConfirm(null)}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{text('关闭未保存的文件', 'Close unsaved file')}</DialogTitle>
            <DialogDescription>
              {text(`「${tabs.find(t => t.id === closeConfirm)?.name ?? '该文件'}」有未保存的修改。保存后关闭、放弃修改，还是取消？`, `“${tabs.find(t => t.id === closeConfirm)?.name ?? 'This file'}” has unsaved changes. Save and close, discard them, or cancel?`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCloseConfirm(null)}>
              {text('取消', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const projectSession = captureProjectSession(currentProject)
                if (closeConfirm && projectSession && isProjectSessionCurrent(projectSession)) {
                  discardAndCloseEditorTab(closeConfirm, projectSession)
                }
                setCloseConfirm(null)
              }}
            >
              {text('放弃修改', 'Discard changes')}
            </Button>
            {(() => {
              const tab = tabs.find(t => t.id === closeConfirm)
              if (!tab || !hasEditorExitSaveHandler(tab)) return null
              return (
                <Button
                  variant="default"
                  onClick={() => {
                    const tabId = closeConfirm
                    if (!tabId) return
                    setCloseConfirm(null)
                    void (async () => {
                      try {
                        await saveEditorTabBeforeClose(tabId)
                        useEditorStore.getState().closeTab(tabId)
                      } catch (error) {
                        toast.error(error instanceof Error
                          ? error.message
                          : text('保存失败，文件保持打开', 'Save failed; the file stays open'))
                      }
                    })()
                  }}
                >
                  {text('保存并关闭', 'Save and close')}
                </Button>
              )
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量关闭未保存 Tab 确认弹窗 */}
      <Dialog
        open={batchCloseConfirm !== null}
        onOpenChange={v => !v && setBatchCloseConfirm(null)}
      >
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{text('关闭多个文件', 'Close multiple files')}</DialogTitle>
            <DialogDescription>
              {(() => {
                const dirtyCount = (batchCloseConfirm ?? []).filter(
                  id => tabs.find(t => t.id === id)?.dirty
                ).length
                const total = (batchCloseConfirm ?? []).length
                return dirtyCount > 0
                  ? text(`即将关闭 ${total} 个文件，其中 ${dirtyCount} 个有未保存的修改。是否放弃修改并全部关闭？`, `Close ${total} files? ${dirtyCount} have unsaved changes that will be discarded.`)
                  : text(`即将关闭 ${total} 个文件。`, `Close ${total} files.`)
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setBatchCloseConfirm(null)}>
              {text('取消', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const projectSession = captureProjectSession(currentProject)
                if (batchCloseConfirm && projectSession && isProjectSessionCurrent(projectSession)) {
                  batchCloseConfirm.forEach(id => discardAndCloseEditorTab(id, projectSession))
                }
                setBatchCloseConfirm(null)
              }}
            >
              {text('放弃修改并关闭', 'Discard and close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
