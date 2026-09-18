import { useEffect } from 'react'
import {
  Compass,
  FolderOpen,
  RefreshCw,
  Unlink,
  Layers,
  BookMarked,
  FileText,
  Clock,
  ShieldCheck,
  XCircle,
  Database,
  Gauge,
  FileCheck2,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { useProjectStore } from '../../stores/project-store'
import { useLocaleStore } from '../../stores/locale-store'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import WorkspaceSourcesTab from './WorkspaceSourcesTab'
import WorkspaceRulesTab from './WorkspaceRulesTab'
import WorkspaceChapterContextTab from './WorkspaceChapterContextTab'
import StoryDataCenter from './StoryDataCenter'
import LongFormControlPanel from './LongFormControlPanel'
import PhaseAuditPanel from './PhaseAuditPanel'
import BookRevisionPanel from './BookRevisionPanel'
import ChapterWorkflowPanel from './ChapterWorkflowPanel'

export default function WorkspaceHub() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const status = useWorkspaceHubStore(s => s.status)
  const lastScanResult = useWorkspaceHubStore(s => s.lastScanResult)
  const activeTab = useWorkspaceHubStore(s => s.activeTab)
  const setActiveTab = useWorkspaceHubStore(s => s.setActiveTab)
  const loadAll = useWorkspaceHubStore(s => s.loadAll)
  const bindDirectory = useWorkspaceHubStore(s => s.bindDirectory)
  const unbindDirectory = useWorkspaceHubStore(s => s.unbindDirectory)
  const rescan = useWorkspaceHubStore(s => s.rescan)
  const cancelScan = useWorkspaceHubStore(s => s.cancelScan)
  const scanning = useWorkspaceHubStore(s => s.scanning)
  const cancelling = useWorkspaceHubStore(s => s.cancelling)

  useEffect(() => {
    if (currentProject) {
      void loadAll()
    }
  }, [currentProject, loadAll])

  const selectDirectory = useWorkspaceHubStore(s => s.selectDirectory)

  const handleSelectFolder = async () => {
    try {
      const selected = await selectDirectory()
      if (selected && selected.grantId) {
        const ok = await bindDirectory(selected.grantId)
        const lastScan = useWorkspaceHubStore.getState().lastScanResult
        if (ok) {
          const isIncomplete = lastScan?.truncated || lastScan?.enumerationComplete === false || (lastScan?.success && lastScan.enumerationComplete === undefined)
          if (isIncomplete) {
            toast.warning(text('扫描未完整覆盖', 'Scan coverage incomplete'))
          } else {
            toast.success(text('已关联创作母稿目录并完成初次扫描', 'Folder bound and initial scan complete'))
          }
        } else {
          const isCancelled = useWorkspaceHubStore.getState().error?.includes('扫描已取消')
          if (!isCancelled) {
            toast.error(text('关联目录扫描失败', 'Failed to scan directory'))
          }
        }
      }
    } catch (err) {
      toast.error(text(`选择目录失败: ${err}`, `Folder selection failed: ${err}`))
    }
  }

  const handleUnbind = async () => {
    const ok = await confirm(
      text(
        '解除关联仅会清除应用内的目录关联记录与可重建索引，绝不会删除或修改您的外部母稿文件。\n\n确定解除关联吗？',
        'Unbinding only removes the local connection and rebuildable index. It will NEVER delete or modify your external files.\n\nAre you sure?',
      ),
      {
        title: text('解除目录关联', 'Unbind Directory'),
        confirmText: text('解除关联', 'Unbind'),
        danger: true,
      }
    )
    if (!ok) return
    const success = await unbindDirectory()
    if (success) {
      toast.info(text('已解除外部目录关联', 'Directory unbound'))
    }
  }

  const handleRescan = async () => {
    const ok = await rescan()
    const lastScan = useWorkspaceHubStore.getState().lastScanResult
    if (ok) {
      const isIncomplete = lastScan?.truncated || lastScan?.enumerationComplete === false || (lastScan?.success && lastScan.enumerationComplete === undefined)
      if (isIncomplete) {
        toast.warning(text('扫描未完整覆盖', 'Scan coverage incomplete'))
      } else {
        toast.success(text('重新扫描完成', 'Rescan complete'))
      }
    } else {
      const isCancelled = useWorkspaceHubStore.getState().error?.includes('扫描已取消')
      if (!isCancelled) {
        toast.error(text('扫描失败', 'Scan failed'))
      }
    }
  }

  const handleCancelScan = async () => {
    const ok = await cancelScan()
    if (ok) {
      toast.info(text('扫描已取消，未提交本次扫描结果', 'Scan cancelled; no partial results were committed'))
    } else {
      toast.error(text('取消扫描失败', 'Failed to cancel scan'))
    }
  }

  return (
    <div
      className="skin-workspace-page w-full h-full flex flex-col overflow-hidden text-xs"
      style={{ backgroundColor: 'var(--color-editor-bg)', color: 'var(--color-text)' }}
    >
      {/* 顶部标题与目录管理卡片 */}
      <div
        className="p-4 border-b shrink-0 space-y-3"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass size={18} style={{ color: 'var(--color-accent)' }} />
            <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              {text('长篇小说创作资料中枢', 'Long-form Fiction Workspace Hub')}
            </h1>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: 'var(--color-accent-subtle, rgba(59, 130, 246, 0.15))',
                color: 'var(--color-accent)',
              }}
            >
              {text('阶段 2–5：故事与长篇控制', 'Phases 2–5: Story & long-form control')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {scanning || cancelling ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancelScan}
                disabled={cancelling}
                className="text-xs gap-1.5 h-8"
              >
                <XCircle size={13} className={cancelling ? 'animate-spin' : ''} />
                {cancelling
                  ? text('正在取消...', 'Cancelling...')
                  : text('取消扫描', 'Cancel Scan')}
              </Button>
            ) : status?.externalWorkspacePath ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRescan}
                  className="text-xs gap-1.5 h-8"
                >
                  <RefreshCw size={13} />
                  {text('重新扫描', 'Rescan')}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSelectFolder}
                  className="text-xs gap-1.5 h-8"
                >
                  <FolderOpen size={13} />
                  {text('更换目录', 'Change Directory')}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleUnbind}
                  className="text-xs gap-1.5 h-8 hover:bg-red-500/10"
                  style={{ color: 'var(--color-error)' }}
                >
                  <Unlink size={13} />
                  {text('解除关联', 'Unbind')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={handleSelectFolder}
                className="text-xs gap-1.5 h-8"
              >
                <FolderOpen size={13} />
                {text('关联外部创作母稿目录', 'Bind External Novel Folder')}
              </Button>
            )}
          </div>
        </div>

        {/* 目录与状态摘要条 */}
        {status?.externalWorkspacePath ? (
          <div
            className="flex flex-wrap items-center justify-between p-2.5 rounded border text-[11px] gap-2"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
          >
            <div className="flex items-center gap-2 truncate flex-1 min-w-0">
              <span className="font-medium opacity-70 shrink-0">{text('已关联目录: ', 'Bound Directory: ')}</span>
              <span className="font-mono truncate" title={status.externalWorkspacePath}>
                {status.externalWorkspacePath}
              </span>
            </div>

            <div className="flex items-center gap-4 shrink-0 font-medium">
              {(lastScanResult?.truncated || lastScanResult?.enumerationComplete === false || (lastScanResult?.success && lastScanResult.enumerationComplete === undefined)) && (
                <div
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    backgroundColor: 'rgba(234, 179, 8, 0.15)',
                    color: '#ca8a04',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                  }}
                  title={
                    lastScanResult?.truncationReason === 'max_files_limit'
                      ? text('已达单次最大文件数量上限 (1000)', 'Reached maximum files limit (1000)')
                      : lastScanResult?.truncationReason === 'max_total_bytes_limit'
                        ? text('已达正文解析总字节预算上限', 'Reached maximum total bytes budget')
                        : lastScanResult?.truncationReason === 'max_depth_limit'
                          ? text('超过最大目录遍历深度', 'Exceeded maximum directory depth')
                          : lastScanResult?.truncationReason === 'access_error'
                            ? text('部分子目录或文件访问受限', 'Some subdirectories or files were unreadable')
                            : text('扫描未完整覆盖', 'Scan coverage incomplete')
                  }
                >
                  <AlertTriangle size={11} />
                  <span>{text('扫描未完整覆盖', 'Scan coverage incomplete')}</span>
                </div>
              )}

              <div>
                <span className="opacity-70">{text('文件: ', 'Files: ')}</span>
                <span>{status.recognizedFiles} / {status.totalFiles}</span>
              </div>

              {status.changedFiles > 0 && (
                <div className="text-[var(--color-warning-text)]">
                  <span>{status.changedFiles} {text('已变化', 'changed')}</span>
                </div>
              )}

              {status.missingFiles > 0 && (
                <div className="text-[var(--color-error-text)]">
                  <span>{status.missingFiles} {text('缺失', 'missing')}</span>
                </div>
              )}

              <div>
                <span className="opacity-70">{text('已确认规则: ', 'Confirmed Rules: ')}</span>
                <span className="font-semibold text-accent">{status.confirmedRulesCount}</span>
              </div>

              {status.lastScannedAt && (
                <div className="flex items-center gap-1 opacity-60">
                  <Clock size={11} />
                  <span>{new Date(status.lastScannedAt).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="p-3 rounded border text-xs flex items-center justify-between"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-accent" />
              <span>
                {text(
                  '尚未关联外部创作目录。请选择外部 Markdown 创作资料目录进行关联与安全索引。',
                  'No external novel directory bound. Select an external folder containing Markdown files to begin.',
                )}
              </span>
            </div>
            <Button size="sm" onClick={handleSelectFolder} className="text-xs">
              {text('选择目录', 'Select Folder')}
            </Button>
          </div>
        )}

        {/* 顶部主选项卡切换 */}
        <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => setActiveTab('sources')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'sources'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <FileText size={13} />
            <span>{text('资料清单与片段', 'Sources & Fragments')}</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'rules'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <BookMarked size={13} />
            <span>{text('结构化设定规则', 'Structured Setting Rules')}</span>
            {status && status.confirmedRulesCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent/25">
                {status.confirmedRulesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('context')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'context'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <Layers size={13} />
            <span>{text('章节上下文装配包', 'Chapter Context Package')}</span>
          </button>

          <button
            onClick={() => setActiveTab('story-data')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'story-data'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <Database size={13} />
            <span>{text('故事资料中心', 'Story Data Center')}</span>
          </button>

          <button
            onClick={() => setActiveTab('control')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'control'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <Gauge size={13} />
            <span>{text('长篇控制台', 'Long-form Console')}</span>
          </button>

          <button
            onClick={() => setActiveTab('workbench')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'workbench'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <FileText size={13} />
            <span>{text('章节创作工作台', 'Chapter Workbench')}</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'audit'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <ShieldCheck size={13} />
            <span>{text('审核与检索', 'Audit & Search')}</span>
          </button>
          <button
            onClick={() => setActiveTab('revision')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'revision'
                ? 'bg-accent/20 text-accent font-semibold'
                : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
            }`}
          >
            <FileCheck2 size={13} />
            <span>{text('全书修订', 'Book Revision')}</span>
          </button>
        </div>
      </div>

      {/* 主工作区内容区 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'sources' && <WorkspaceSourcesTab />}
        {activeTab === 'rules' && <WorkspaceRulesTab />}
        {activeTab === 'context' && <WorkspaceChapterContextTab />}
        {activeTab === 'story-data' && <StoryDataCenter />}
        {activeTab === 'workbench' && <ChapterWorkflowPanel />}
        {activeTab === 'control' && <LongFormControlPanel />}
        {activeTab === 'audit' && <PhaseAuditPanel />}
        {activeTab === 'revision' && <BookRevisionPanel />}
      </div>
    </div>
  )
}
