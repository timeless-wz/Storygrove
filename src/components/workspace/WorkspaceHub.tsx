import { useEffect } from 'react'
import {
  Compass,
  FolderOpen,
  RefreshCw,
  Unlink,
  Clock,
  ShieldCheck,
  XCircle,
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
import {
  SummaryMetric,
  WorkspaceAuthorityLegend,
  WorkspaceTabNav,
} from './WorkspaceHubNavigation'

export default function WorkspaceHub() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const status = useWorkspaceHubStore(s => s.status)
  const sources = useWorkspaceHubStore(s => s.sources)
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

  const coverageIncomplete = Boolean(
    lastScanResult?.truncated
    || lastScanResult?.enumerationComplete === false
    || (lastScanResult?.success && lastScanResult.enumerationComplete === undefined),
  )
  const truncationLabel = lastScanResult?.truncationReason === 'max_files_limit'
    ? text('已达单次最大文件数量上限 (1000)', 'Reached maximum files limit (1000)')
    : lastScanResult?.truncationReason === 'max_total_bytes_limit'
      ? text('已达正文解析总字节预算上限', 'Reached maximum total bytes budget')
      : lastScanResult?.truncationReason === 'max_depth_limit'
        ? text('超过最大目录遍历深度', 'Exceeded maximum directory depth')
        : lastScanResult?.truncationReason === 'access_error'
          ? text('部分子目录或文件访问受限', 'Some subdirectories or files were unreadable')
          : text('扫描未完整覆盖', 'Scan coverage incomplete')

  const pendingCandidatesCount = status?.pendingCandidates ?? 0

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
                  className="text-xs gap-1.5 h-8 hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]"
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

        {/* 目录与状态摘要：路径 → 覆盖告警 → 计数指标 */}
        {status?.externalWorkspacePath ? (
          <div
            className="p-2.5 rounded border text-[11px] space-y-2"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen size={12} className="shrink-0 opacity-70" />
              <span className="font-medium opacity-70 shrink-0">{text('已关联目录: ', 'Bound Directory: ')}</span>
              <span className="font-mono truncate" title={status.externalWorkspacePath}>
                {status.externalWorkspacePath}
              </span>
              {status.lastScannedAt && (
                <span className="flex items-center gap-1 opacity-60 shrink-0 ml-auto">
                  <Clock size={11} />
                  <span>{new Date(status.lastScannedAt).toLocaleTimeString()}</span>
                </span>
              )}
            </div>

            {coverageIncomplete && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold w-fit"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
                  color: 'var(--color-warning-text)',
                  border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
                }}
                title={truncationLabel}
              >
                <AlertTriangle size={11} />
                <span>{text('扫描未完整覆盖', 'Scan coverage incomplete')}</span>
                <span className="font-normal opacity-80">{truncationLabel}</span>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <SummaryMetric
                label={text('识别文件', 'Recognized files')}
                value={`${status.recognizedFiles} / ${status.totalFiles}`}
                hint={text('已识别为创作资料的文件数 / 扫描到的文件总数', 'Files recognized as writing material / total files scanned')}
              />
              <SummaryMetric
                label={text('已变化', 'Changed')}
                value={status.changedFiles}
                hint={text('母稿内容相对已批准快照发生变化', 'Manuscript content differs from the approved snapshot')}
                tone={status.changedFiles > 0 ? 'warning' : undefined}
              />
              <SummaryMetric
                label={text('缺失', 'Missing')}
                value={status.missingFiles}
                hint={text('已关联但当前扫描不到的文件', 'Linked files that the current scan could not find')}
                tone={status.missingFiles > 0 ? 'error' : undefined}
              />
              <SummaryMetric
                label={text('待确认候选', 'Pending candidates')}
                value={pendingCandidatesCount}
                hint={text('扫描与模型提交的导入候选，等待作者审核', 'Import candidates from scans and models awaiting author review')}
                tone={pendingCandidatesCount > 0 ? 'warning' : undefined}
              />
              <SummaryMetric
                label={text('已确认规则', 'Confirmed rules')}
                value={status.confirmedRulesCount}
                hint={text('具备事实权威的结构化设定规则', 'Structured setting rules with fact authority')}
                tone="accent"
              />
            </div>

            <WorkspaceAuthorityLegend sources={sources} text={text} />
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

        {/* 顶部主选项卡切换：按资料与来源 / 事实与检索 / 长篇控制与修订分组 */}
        <WorkspaceTabNav
          activeTab={activeTab}
          onSelect={setActiveTab}
          confirmedRulesCount={status?.confirmedRulesCount ?? 0}
          pendingCandidatesCount={pendingCandidatesCount}
          text={text}
        />
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
