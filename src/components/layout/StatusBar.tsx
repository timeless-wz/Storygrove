import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bot, CheckCircle2, FolderOpen, Languages, ListTodo, Minus, PanelLeft,
  PanelRight, Plus, Settings, Wifi,
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useEditorStore } from '../../stores/editor-store'
import { countUnsavedEditorItems } from '../../stores/editor-unsaved'
import { useDraftStore } from '../../stores/draft-store'
import { useThemeStore } from '../../stores/theme-store'
import { useLocaleStore } from '../../stores/locale-store'
import BottomPanel from '../panels/BottomPanel'

/**
 * 工作台状态栏：承接项目上下文和低频控制；任务采用绝对定位的浮层，关闭后不占高度。
 */
export default function StatusBar() {
  const currentProject = useProjectStore(s => s.currentProject)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const activeTab = useEditorStore(s => s.tabs.find(tab => tab.id === s.activeTabId))
  const hasDirty = useEditorStore(s => countUnsavedEditorItems(s.tabs, s.draftLedgers) > 0)
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)
  const zoom = useThemeStore(s => s.zoom)
  const zoomIn = useThemeStore(s => s.zoomIn)
  const zoomOut = useThemeStore(s => s.zoomOut)
  const zoomReset = useThemeStore(s => s.zoomReset)
  const locale = useLocaleStore(s => s.locale)
  const toggleLocale = useLocaleStore(s => s.toggleLocale)
  const text = useLocaleStore(s => s.text)
  const openSettings = useLayoutStore(s => s.openSettings)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const toggleReferencePanel = useLayoutStore(s => s.toggleReferencePanel)
  const openRightPanel = useLayoutStore(s => s.openRightPanel)
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const bottomTab = useLayoutStore(s => s.bottomTab)
  const defaultModel = models.find(model => model.id === defaultModelId && model.purposes?.some(purpose => purpose !== 'embedding'))
  const totalWords = useMemo(
    () => Object.values(draftsByChapter).reduce((sum, drafts) => sum + (drafts[0]?.wordCount ?? 0), 0),
    [draftsByChapter],
  )
  const pageLabel = activeTab?.name ?? (currentProject ? text('项目总览', 'Project overview') : text('开始创作', 'Start creating'))
  const chapterWords = activeTab?.type === 'chapter' ? (activeTab.content?.length ?? 0) : 0
  const lastSaved = currentProject?.updatedAt
    ? new Date(currentProject.updatedAt).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  return (
    <div
      className="writer-statusbar no-select flex items-center justify-between"
      style={{ height: 'var(--height-statusbar)', fontSize: '0.75rem', flexShrink: 0 }}
    >
      <div className="flex min-w-0 items-center h-full">
        <StatusBarSegment title={text('显示或隐藏项目资源树', 'Show or hide project resources')} onClick={toggleSidebar}>
          <PanelLeft size={12} />
        </StatusBarSegment>
        {currentProject && <>
          <StatusBarDivider />
          <StatusBarSegment title={currentProject.path}>
            <FolderOpen size={11} />
            <span className="max-w-[150px] truncate font-medium">{currentProject.name}</span>
          </StatusBarSegment>
        </>}
        <StatusBarDivider />
        <StatusBarSegment title={pageLabel}>
          <span className="max-w-[220px] truncate opacity-85">{pageLabel}</span>
        </StatusBarSegment>
      </div>

      <div className="relative flex items-center h-full">
        <AITaskCapsule />
        <StatusBarSegment title={text('显示或隐藏上下文检视', 'Show or hide context inspector')} onClick={toggleReferencePanel}>
          <PanelRight size={12} />
        </StatusBarSegment>
        <StatusBarSegment title={text('打开 AI 助手', 'Open AI assistant')} onClick={() => openRightPanel('agent')}>
          <Bot size={12} />
        </StatusBarSegment>
        {activeTab?.type === 'chapter' && <StatusBarSegment title={text('当前章字数', 'Current chapter words')}>
          <span className="tabular-nums">{text(`本章 ${chapterWords.toLocaleString()}`, `Chapter ${chapterWords.toLocaleString()}`)}</span>
        </StatusBarSegment>}
        <StatusBarSegment title={text('全书已起草字数', 'Total drafted words')}>
          <span className="tabular-nums">{text(`全书 ${totalWords.toLocaleString()}`, `Total ${totalWords.toLocaleString()}`)}</span>
        </StatusBarSegment>
        <StatusBarSegment title={hasDirty ? text('有未保存修改', 'Unsaved changes') : text(`已保存，最后保存 ${lastSaved}`, `Saved, last saved ${lastSaved}`)}>
          <CheckCircle2 size={12} style={{ color: hasDirty ? 'var(--color-warning-text)' : 'var(--color-success-text)' }} />
          <span style={{ color: hasDirty ? 'var(--color-warning-text)' : 'var(--color-success-text)' }}>{hasDirty ? text('未保存', 'Modified') : text('已保存', 'Saved')}</span>
        </StatusBarSegment>
        <StatusBarSegment title={text('缩小', 'Zoom out')} onClick={zoomOut}><Minus size={11} /></StatusBarSegment>
        <StatusBarSegment title={text('重置缩放', 'Reset zoom')} onClick={zoomReset}><span className="tabular-nums">{Math.round(zoom * 100)}%</span></StatusBarSegment>
        <StatusBarSegment title={text('放大', 'Zoom in')} onClick={zoomIn}><Plus size={11} /></StatusBarSegment>
        <StatusBarSegment title={text('切换语言', 'Switch language')} onClick={() => void toggleLocale()}><Languages size={12} /><span>{locale === 'zh-CN' ? 'EN' : '中文'}</span></StatusBarSegment>
        <StatusBarSegment title={defaultModel ? text(`当前模型：${defaultModel.name}`, `Current model: ${defaultModel.name}`) : text('配置模型', 'Configure model')} onClick={() => openSettings('llm')}>
          <Wifi size={11} /><span className="max-w-[110px] truncate">{defaultModel?.name ?? text('模型设置', 'Model settings')}</span>
        </StatusBarSegment>
        <StatusBarSegment title={text('设置（含日志与模型配置）', 'Settings, logs and model configuration')} onClick={() => openSettings('editor')}>
          <Settings size={12} />
        </StatusBarSegment>

        {bottomPanelOpen && bottomTab === 'tasks' && (
          <div className="writer-task-popover" role="dialog" aria-label={text('任务进度', 'Task progress')}>
            <BottomPanel />
          </div>
        )}
      </div>
    </div>
  )
}

/** 仅在有进行中任务或刚完成任务时出现；点击后打开浮层而非挤压编辑器。 */
function AITaskCapsule() {
  const text = useLocaleStore(s => s.text)
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const getActiveStepInfo = useWorkflowStore(s => s.getActiveStepInfo)
  const [completedTitle, setCompletedTitle] = useState<string | null>(null)

  useEffect(() => {
    if (activeRuns.length === 0 && completedTitle) {
      const timer = setTimeout(() => setCompletedTitle(null), 1800)
      return () => clearTimeout(timer)
    }
  }, [activeRuns.length, completedTitle])

  useEffect(() => {
    if (activeRuns.length > 0) return
    const latest = useWorkflowStore.getState().history[0]
    if (latest?.status !== 'completed') return
    // 延后到 effect 完成后再同步提示，避免在 React effect 中触发级联渲染。
    const timer = setTimeout(() => {
      setCompletedTitle(previous => previous === latest.title ? previous : latest.title)
    }, 0)
    return () => clearTimeout(timer)
  }, [activeRuns.length])

  const stepInfo = getActiveStepInfo()
  if (!stepInfo && !completedTitle) return null
  const label = stepInfo
    ? (activeRuns.length > 1 ? text(`${activeRuns.length} 个任务运行中`, `${activeRuns.length} tasks running`) : stepInfo.stepName)
    : text(`${completedTitle!.replace(/^[^\s]+\s/, '')} 完成`, `${completedTitle!.replace(/^[^\s]+\s/, '')} complete`)

  return (
    <button
      type="button"
      className={`ai-task-capsule${stepInfo ? '' : ' ai-task-capsule--complete'}`}
      title={text('查看任务进度', 'View task progress')}
      onClick={() => useLayoutStore.getState().openBottomTab('tasks')}
    >
      {stepInfo ? <span className="w-[5px] h-[5px] rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }} /> : <CheckCircle2 size={10} />}
      <ListTodo size={11} />
      <span className="truncate max-w-[140px]">{label}</span>
      {stepInfo && activeRuns.length === 1 && <span className="font-mono text-[0.62rem] opacity-80">{stepInfo.completed}/{stepInfo.total}</span>}
    </button>
  )
}

function StatusBarSegment({ children, title, onClick }: { children: ReactNode; title?: string; onClick?: () => void }) {
  return (
    <button type="button" className="writer-statusbar-segment flex items-center gap-1 px-2 h-full transition-colors" title={title} onClick={onClick} disabled={!onClick}>
      {children}
    </button>
  )
}

function StatusBarDivider() {
  return <span aria-hidden="true" style={{ opacity: 0.25, fontSize: '0.75rem', userSelect: 'none' }}>|</span>
}
