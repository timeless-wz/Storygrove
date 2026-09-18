import { useEffect } from 'react'
import {
  Compass,
  RefreshCw,
  FolderOpen,
  FileText,
  AlertCircle,
  BookMarked,
  Layers,
} from 'lucide-react'
import { useWorkspaceHubStore } from '../../../stores/workspace-hub-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'

export default function WorkspaceSidebarPanel() {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const status = useWorkspaceHubStore(s => s.status)
  const sources = useWorkspaceHubStore(s => s.sources)
  const selectedSourceId = useWorkspaceHubStore(s => s.selectedSourceId)
  const scanning = useWorkspaceHubStore(s => s.scanning)
  const activeTab = useWorkspaceHubStore(s => s.activeTab)
  const loadAll = useWorkspaceHubStore(s => s.loadAll)
  const rescan = useWorkspaceHubStore(s => s.rescan)
  const selectSource = useWorkspaceHubStore(s => s.selectSource)
  const setActiveTab = useWorkspaceHubStore(s => s.setActiveTab)

  useEffect(() => {
    if (currentProject) {
      void loadAll()
    }
  }, [currentProject, loadAll])

  return (
    <div className="flex flex-col h-full text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      {/* 顶部概览小卡片 */}
      <div className="p-3 m-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--color-text)' }}>
            <Compass size={14} style={{ color: 'var(--color-accent)' }} />
            <span>{text('创作资料中枢', 'Writing Sources Hub')}</span>
          </div>
          {status?.externalWorkspacePath && (
            <button
              onClick={() => void rescan()}
              disabled={scanning}
              title={text('重新扫描外部目录', 'Rescan external directory')}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={12} className={scanning ? 'animate-spin text-accent' : ''} />
            </button>
          )}
        </div>

        {status?.externalWorkspacePath ? (
          <div className="space-y-1 text-[11px]">
            <div className="truncate" title={status.externalWorkspacePath} style={{ color: 'var(--color-text-muted)' }}>
              {status.externalWorkspacePath}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span>{text('总文件 / 已识别', 'Total / Recognized')}</span>
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                {status.totalFiles} / {status.recognizedFiles}
              </span>
            </div>
            {(status.changedFiles > 0 || status.missingFiles > 0) && (
              <div className="flex items-center gap-2 pt-0.5" style={{ color: 'var(--color-warning)' }}>
                <AlertCircle size={12} />
                <span>
                  {status.changedFiles > 0 && text(`${status.changedFiles} 个已变化`, `${status.changedFiles} changed`)}
                  {status.changedFiles > 0 && status.missingFiles > 0 && ' · '}
                  {status.missingFiles > 0 && text(`${status.missingFiles} 个缺失`, `${status.missingFiles} missing`)}
                </span>
              </div>
            )}
            {status.pendingCandidates > 0 && (
              <div className="text-[11px] font-medium" style={{ color: 'var(--color-accent)' }}>
                {text(`${status.pendingCandidates} 个待确认候选项`, `${status.pendingCandidates} pending candidates`)}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] py-1" style={{ color: 'var(--color-text-muted)' }}>
            {text('未关联外部创作目录', 'No external folder bound')}
          </div>
        )}
      </div>

      {/* 视图快速导航 */}
      <div className="px-2 pb-2 space-y-1">
        <button
          onClick={() => setActiveTab('sources')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-colors ${
            activeTab === 'sources' ? 'bg-accent/15 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          style={{ color: activeTab === 'sources' ? 'var(--color-accent)' : 'var(--color-text)' }}
        >
          <FolderOpen size={14} />
          <span>{text('资料清单', 'Sources')}</span>
          <span className="ml-auto text-[10px] opacity-70">{sources.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('rules')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-colors ${
            activeTab === 'rules' ? 'bg-accent/15 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          style={{ color: activeTab === 'rules' ? 'var(--color-accent)' : 'var(--color-text)' }}
        >
          <BookMarked size={14} />
          <span>{text('设定规则', 'Rules')}</span>
          <span className="ml-auto text-[10px] opacity-70">{status?.confirmedRulesCount ?? 0}</span>
        </button>

        <button
          onClick={() => setActiveTab('context')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-colors ${
            activeTab === 'context' ? 'bg-accent/15 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          style={{ color: activeTab === 'context' ? 'var(--color-accent)' : 'var(--color-text)' }}
        >
          <Layers size={14} />
          <span>{text('章节上下文', 'Chapter Context')}</span>
        </button>
      </div>

      <div className="border-t mx-2 my-1" style={{ borderColor: 'var(--color-border)' }} />

      {/* 资料文件列表 */}
      <div className="px-2 pt-1 pb-1 text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
        {text('外部资料文件', 'External Files')}
      </div>

      <div className="flex-1 overflow-y-auto px-1 space-y-0.5">
        {sources.length === 0 ? (
          <div className="p-3 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {text('暂无扫描文件', 'No files scanned')}
          </div>
        ) : (
          sources.map(s => {
            const isSelected = selectedSourceId === s.id
            const isStale = Boolean(s.approvedSnapshotId)
              && Boolean(s.observedSnapshotId)
              && s.approvedSnapshotId !== s.observedSnapshotId
            return (
              <button
                key={s.id}
                onClick={() => {
                  void selectSource(s.id)
                  setActiveTab('sources')
                }}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors ${
                  isSelected ? 'bg-accent/20 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
                style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text)' }}
              >
                <FileText size={13} className="shrink-0 opacity-70" />
                <span className="truncate flex-1" title={s.relativePath}>
                  {s.relativePath}
                </span>
                {s.isMissing ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title={text('文件缺失', 'Missing')} />
                ) : isStale ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title={text('内容已变化', 'Changed')} />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title={text('正常', 'Synced')} />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
