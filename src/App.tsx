import { type ReactNode, useEffect } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { type Theme, useThemeStore } from './stores/theme-store'
import { useLayoutStore } from './stores/layout-store'
import { useLLMStore } from './stores/llm-store'
import { useProjectStore } from './stores/project-store'
import { useMCPStore } from './stores/mcp-store'
import { useWorkflowStore } from './stores/workflow-store'
import { useLocaleStore } from './stores/locale-store'
import { useSkinStore } from './stores/skin-store'
import { useEditorStore } from './stores/editor-store'
import { ipc } from './services/ipc-client'
import TitleBar from './components/layout/TitleBar'
import StatusBar from './components/layout/StatusBar'
import Sidebar from './components/panels/Sidebar'
import EditorArea from './components/panels/EditorArea'
import AIPanel from './components/panels/AIPanel'
import AIOutputPanel from './components/panels/AIOutputPanel'
import ProjectReferencePanel from './components/panels/ProjectReferencePanel'
import NewProjectDialog from './components/dialogs/NewProjectDialog'
import ImportNovelDialog from './components/dialogs/ImportNovelDialog'
import ExportDialog from './components/dialogs/ExportDialog'
import SettingsModal from './components/settings/SettingsModal'
import { ANIME_SKIN_URL } from './components/settings/AppearanceSettings'
import { ErrorBoundary } from './components/ErrorBoundary'
import { actionToast } from './components/ui/ActionToast'
import { TooltipProvider } from './components/ui/Tooltip'
import { UpdateNotifier } from './components/updates/UpdateNotifier'
import { useResponsiveWorkbenchLayout } from './hooks/useResponsiveWorkbenchLayout'
import { globalEventBus } from './shared/event-bus'
import {
  projectSessionContextFromProject,
  sameProjectSessionContext,
} from './shared/project-session-context'
import type { SkinId } from './shared/skin-types'

// eslint-disable-next-line react-refresh/only-export-components
export function resolveSkinBackgroundUrl(skinId: SkinId, customUrl: string | null): string | null {
  if (skinId === 'anime') return ANIME_SKIN_URL
  if (skinId === 'custom') return customUrl
  return null
}

/** The sole decorative skin layer at the App root. It never participates in accessibility. */
export function SkinBackgroundLayer({
  skinId,
  backgroundUrl,
  onImageError,
}: {
  skinId: SkinId
  backgroundUrl: string | null
  onImageError?: () => void
}) {
  const imageUrl = resolveSkinBackgroundUrl(skinId, backgroundUrl)
  return (
    <div
      aria-hidden="true"
      data-skin-background={skinId}
      className="app-skin-background"
    >
      {imageUrl && <img src={imageUrl} alt="" className="app-skin-background-image" onError={onImageError} />}
    </div>
  )
}

/** Stable root semantics let image skins opt into their own readability tokens for every color theme. */
export function AppSkinRoot({
  theme,
  skinId,
  children,
}: {
  theme: Theme
  skinId: SkinId
  children: ReactNode
}) {
  return (
    <div
      className="app-skin-root flex flex-col w-full h-full overflow-hidden"
      data-theme={theme}
      data-skin={skinId}
      data-skin-readability={skinId === 'classic' ? 'theme-default' : 'high-contrast'}
    >
      {children}
    </div>
  )
}

/**
 * Vela 主应用组件
 * 使用 react-resizable-panels 实现可拖拽调整大小的四区布局
 */
export default function App() {
  const initTheme = useThemeStore((s) => s.initTheme)
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
  const initLocale = useLocaleStore((s) => s.init)
  const text = useLocaleStore((s) => s.text)
  const sidebarOpen = useLayoutStore(s => s.sidebarOpen)
  const sidebarView = useLayoutStore(s => s.sidebarView)
  const aiPanelOpen = useLayoutStore(s => s.aiPanelOpen)
  const referencePanelOpen = useLayoutStore(s => s.referencePanelOpen)
  const focusMode = useLayoutStore(s => s.focusMode)
  const currentProject = useProjectStore(s => s.currentProject)
  const rightView = useLayoutStore(s => s.rightView)
  const settingsOpen = useLayoutStore(s => s.settingsOpen)
  const closeSettings = useLayoutStore(s => s.closeSettings)
  const newProjectOpen = useLayoutStore(s => s.newProjectOpen)
  const closeNewProject = useLayoutStore(s => s.closeNewProject)
  const exportOpen = useLayoutStore(s => s.exportOpen)
  const closeExport = useLayoutStore(s => s.closeExport)
  const importNovelOpen = useLayoutStore(s => s.importNovelOpen)
  const closeImportNovel = useLayoutStore(s => s.closeImportNovel)
  const initLLM = useLLMStore((s) => s.init)
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects)
  const skinState = useSkinStore((s) => s.skinState)
  const skinBackgroundUrl = useSkinStore((s) => s.backgroundUrl)
  const initSkin = useSkinStore((s) => s.init)
  const disposeSkin = useSkinStore((s) => s.dispose)
  const recoverFromImageFailure = useSkinStore((s) => s.recoverFromImageFailure)

  // 窄屏策略：右栏优先收起，1280px 起三栏完整可用
  useResponsiveWorkbenchLayout()

  // 初始化：主题 + LLM 模型 + 最近项目 + 缩放级别
  useEffect(() => {
    initLocale()
    initTheme()
    initLLM()
    loadRecentProjects()
    // 初始化 MCP Store
    useMCPStore.getState().init().catch(e => console.warn('[MCP] 初始化失败:', e))
    if (ipc.isElectron) {
      const savedZoom = localStorage.getItem('vela-zoom-level')
      if (savedZoom) ipc.setZoomLevel(parseFloat(savedZoom))
    }
    // 初始化 ProjectService — 注册全局事件监听（生命周期与 App 一致）
    import('./services/project-service').then(({ initProjectService }) => {
      initProjectService()
    }).catch(e => console.warn('[ProjectService] 初始化失败:', e))

    // C) 工作流完成时弹出 ActionToast 通知（不依赖任何面板状态）
    const unsubActionToast = globalEventBus.on('WORKFLOW_COMPLETE', ({ projectSession, runId }) => {
      if (!sameProjectSessionContext(
        projectSession,
        projectSessionContextFromProject(useProjectStore.getState().currentProject),
      )) return
      const text = useLocaleStore.getState().text
      const { activeRuns, history } = useWorkflowStore.getState()
      const completedRun = activeRuns.find(r => r.id === runId)
        ?? history.find(r => r.id === runId)
      if (!completedRun) return
      actionToast.workflowComplete(
        text(`「${completedRun.title}」已完成`, `“${completedRun.title}” completed`),
        () => useLayoutStore.getState().openBottomTab('tasks')
      )
    })

    const unsubAutoOpenNextChapter = globalEventBus.on('FINALIZE_COMPLETE', ({
      chapterNumber,
      projectSession,
      source,
    }) => {
      void (async () => {
        try {
          if (source === 'batch') return
          const isCurrentProjectSession = () => sameProjectSessionContext(
            projectSession,
            projectSessionContextFromProject(useProjectStore.getState().currentProject),
          )
          if (!isCurrentProjectSession()) return
          const config = await ipc.invoke('config:get')
          if (!isCurrentProjectSession()) return
          if (!config.autoOpenNextChapterAfterFinalize) return

          const nextChapterNumber = chapterNumber + 1
          const [blueprint, existingDraft] = await Promise.all([
            ipc.invokeWithProjectSession(
              projectSession,
              'db:blueprint-get',
              nextChapterNumber,
              projectSession.projectPath,
            ),
            ipc.invokeWithProjectSession(
              projectSession,
              'db:draft-get-latest',
              nextChapterNumber,
              projectSession.projectPath,
            ),
          ])
          if (existingDraft && typeof existingDraft === 'object' && 'id' in existingDraft) {
            const draftObj = existingDraft as { id: number }
            useEditorStore.getState().openFile({
              id: `draft-${draftObj.id}`,
              name: `第${nextChapterNumber}章 ${(blueprint as { title?: string } | null)?.title || ''}`.trim(),
              type: 'chapter',
              filePath: `vela://draft/${draftObj.id}`,
              draftId: draftObj.id,
              chapterNumber: nextChapterNumber,
              projectKey: projectSession.projectPath,
            })
          }
        } catch (error) {
          console.warn('[AutoNextChapter] 无法自动打开下一章:', error)
        }
      })()
    })

    return () => {
      // App 卸载时销毁 ProjectService（开发环境 HMR 时会触发）
      import('./services/project-service').then(({ disposeProjectService }) => {
        disposeProjectService()
      }).catch(() => {})
      unsubActionToast()
      unsubAutoOpenNextChapter()
    }
  }, [initLocale, initTheme, initLLM, loadRecentProjects])

  useEffect(() => {
    if (!ipc.isElectron) return undefined
    void initSkin()
    return disposeSkin
  }, [disposeSkin, initSkin])

  useEffect(() => {
    if (!ipc.isElectron) return
    void ipc.invoke('project:smoke-open-request').then(async (request) => {
      if (!request) return
      const opened = await useProjectStore.getState().openProject(request.projectPath)
      if (!opened) throw new Error('烟测项目打开失败')
      const confirmed = await ipc.invoke('project:smoke-open-confirm', request.projectPath)
      if (!confirmed.success) throw new Error(confirmed.error || '烟测项目确认失败')
    }).catch(error => console.error('[SmokeProjectOpen]', error))
  }, [])

  // 全局快捷键: Cmd+N 新建项目，Cmd+O 打开项目
  // 注意：Cmd+=/- 缩放已由 TitleBar.tsx 统一处理，此处不重复注册
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        useLayoutStore.getState().openNewProject()
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        const folder = await ipc.invoke('dialog:select-folder')
        if (folder) {
          useProjectStore.getState().openProject(folder)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={300}>
    <AppSkinRoot theme={resolvedTheme} skinId={skinState.activeSkin}>
      <SkinBackgroundLayer
        skinId={skinState.activeSkin}
        backgroundUrl={skinBackgroundUrl}
        onImageError={() => void recoverFromImageFailure()}
      />
      <UpdateNotifier />
      {/* 标题栏 */}
      <TitleBar />

      {/* 项目工作台：资源树 | 编辑器 | 按需上下文。任务以状态栏悬浮窗展示，不占工作区高度。 */}
      <div className={`app-skin-main-region writer-desktop-shell flex flex-1 overflow-hidden${focusMode ? ' is-focus-mode' : ''}`}>

        <PanelGroup orientation="horizontal" className="flex-1 h-full">

              {/* 左侧边栏 */}
              {sidebarOpen && !focusMode && (
                <>
                  <Panel id="sidebar" defaultSize="260px" minSize="200px" maxSize="380px">
                    <ErrorBoundary fallbackLabel={text('侧边栏渲染失败', 'Sidebar failed to render')}>
                      <Sidebar />
                    </ErrorBoundary>
                  </Panel>
                  <PanelResizeHandle />
                </>
              )}

              {/* 编辑区 */}
              <Panel id="editor" minSize="300px">
                <ErrorBoundary fallbackLabel={text('编辑区渲染失败', 'Editor failed to render')}>
                  <EditorArea onNewProject={() => useLayoutStore.getState().openNewProject()} />
                </ErrorBoundary>
              </Panel>

              {/* 项目参考栏：真实入口指向角色、蓝图、世界、剧情、任务和工作区中枢。 */}
              {currentProject && sidebarView !== 'home' && referencePanelOpen && !aiPanelOpen && !focusMode && (
                <>
                  <PanelResizeHandle />
                  <Panel id="project-reference" defaultSize="280px" minSize="220px" maxSize="420px">
                    <ErrorBoundary fallbackLabel={text('项目参考栏渲染失败', 'Project reference panel failed to render')}>
                      <ProjectReferencePanel />
                    </ErrorBoundary>
                  </Panel>
                </>
              )}

              {/* 右侧 AI 面板按需展开，保留既有 Agent 与工作流输出。 */}
              {currentProject && sidebarView !== 'home' && aiPanelOpen && !focusMode && (
                <>
                  <PanelResizeHandle />
                  <Panel id="ai-panel" defaultSize="340px" minSize="260px" maxSize="600px">
                    <ErrorBoundary fallbackLabel={text('AI 面板渲染失败', 'AI panel failed to render')}>
                      {rightView === 'ai-output' ? <AIOutputPanel /> : <AIPanel />}
                    </ErrorBoundary>
                  </Panel>
                </>
              )}
        </PanelGroup>
      </div>


      {/* 状态栏（全宽） */}
      <StatusBar />

      {/* 全局对话框 — 由 layout-store 控制开关，不再依赖 window.dispatchEvent */}
      <NewProjectDialog
        open={newProjectOpen}
        onClose={closeNewProject}
      />
      <ImportNovelDialog
        open={importNovelOpen}
        onClose={closeImportNovel}
      />
      <ExportDialog
        isOpen={exportOpen}
        onClose={closeExport}
      />
      {/* 全屏设置弹窗 */}
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
      />

    </AppSkinRoot>
    </TooltipProvider>
  )
}
