import { useState } from 'react'
import {
  FileText,
  ChevronDown,
  ChevronRight,
  Layers,
  Sparkles,
  Filter,
  Check,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { useLocaleStore } from '../../stores/locale-store'
import { toast } from '../ui/Toast'
import CandidateApprovalModal from './CandidateApprovalModal'
import type { WorkspaceSourceCategory } from '../../shared/workspace-hub'

const CATEGORY_NAMES: Record<WorkspaceSourceCategory, { zh: string; en: string }> = {
  creation_principles: { zh: '创作总则', en: 'Principles' },
  confirmed_settings: { zh: '已确认设定', en: 'Confirmed' },
  master_plot: { zh: '全书规划', en: 'Master Plot' },
  world_data: { zh: '世界资料', en: 'World' },
  event_materials: { zh: '事件素材', en: 'Events' },
  character_data: { zh: '人物资料', en: 'Characters' },
  deprecated: { zh: '废案', en: 'Deprecated' },
  background_settings: { zh: '后台设定', en: 'Background' },
  reference_boundary: { zh: '参考边界', en: 'Reference' },
  narrative_goals: { zh: '叙事目标', en: 'Goals' },
  volume_outline: { zh: '卷级规划', en: 'Volume' },
  chapter_outline: { zh: '逐章规划', en: 'Chapters' },
  style_guide: { zh: '风格规范', en: 'Style' },
  reference_novel: { zh: '参考素材', en: 'Material' },
  other: { zh: '其他资料', en: 'Other' },
}

export default function WorkspaceSourcesTab() {
  const text = useLocaleStore(s => s.text)
  const sources = useWorkspaceHubStore(s => s.sources)
  const selectedSourceId = useWorkspaceHubStore(s => s.selectedSourceId)
  const selectedSourceDetail = useWorkspaceHubStore(s => s.selectedSourceDetail)
  const selectSource = useWorkspaceHubStore(s => s.selectSource)
  const candidates = useWorkspaceHubStore(s => s.candidates)
  const approveSource = useWorkspaceHubStore(s => s.approveSource)
  const approveAllSources = useWorkspaceHubStore(s => s.approveAllSources)

  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [candidateModalOpen, setCandidateModalOpen] = useState(false)

  const pendingCandidatesCount = candidates.filter(c => c.status === 'pending').length
  const hasUnapprovedOrStale = sources.some(s => (
    !s.approvedSnapshotId || s.approvedSnapshotId !== s.observedSnapshotId
  ))

  const filteredSources = sources.filter(s => {
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
    return true
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 待确认候选浮条（如果有待确认候选项） */}
      {pendingCandidatesCount > 0 && (
        <div
          className="flex items-center justify-between px-4 py-2.5 mx-4 mt-3 rounded-md border text-xs"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-accent)',
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>
              {text(
                `检测到 ${pendingCandidatesCount} 项待作者确认的导入候选（角色/设定事实）`,
                `${pendingCandidatesCount} pending candidates detected for review (character/setting facts)`,
              )}
            </span>
          </div>
          <Button size="sm" onClick={() => setCandidateModalOpen(true)} className="text-xs h-7">
            {text('立即审核导入', 'Review and Import')}
          </Button>
        </div>
      )}

      {/* 筛选与全量批准工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b text-xs shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <Filter size={13} style={{ color: 'var(--color-text-muted)' }} />
          <span>{text('类别筛选: ', 'Filter by category: ')}</span>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border bg-transparent"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="all">{text('全部类别', 'All Categories')}</option>
            {Object.entries(CATEGORY_NAMES).map(([key, val]) => (
              <option key={key} value={key}>
                {text(val.zh, val.en)}
              </option>
            ))}
          </select>
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {text(`共 ${filteredSources.length} 个文件`, `${filteredSources.length} files`)}
          </span>
        </div>

        {hasUnapprovedOrStale && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const ok = await approveAllSources()
              if (ok) toast.success(text('已全量批准当前所有来源快照', 'All sources approved'))
              else toast.error(text('全量批准失败', 'Failed to approve all'))
            }}
            className="text-xs h-7 gap-1"
          >
            <Check size={12} />
            {text('全量批准快照', 'Approve All Snapshots')}
          </Button>
        )}
      </div>

      {/* 来源文件列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {filteredSources.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {text('暂无匹配的资料文件', 'No matching source files found')}
          </div>
        ) : (
          filteredSources.map(s => {
            const isExpanded = selectedSourceId === s.id
            const cat = CATEGORY_NAMES[s.category] ?? { zh: s.category, en: s.category }
            const isStale = Boolean(s.approvedSnapshotId)
              && Boolean(s.observedSnapshotId)
              && s.approvedSnapshotId !== s.observedSnapshotId
            const needsApproval = !s.approvedSnapshotId || s.approvedSnapshotId !== s.observedSnapshotId

            return (
              <div
                key={s.id}
                className="border rounded-lg overflow-hidden transition-all"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: isExpanded ? 'var(--color-accent)' : 'var(--color-border)',
                }}
              >
                {/* 标题栏卡片 */}
                <div
                  onClick={() => void selectSource(isExpanded ? null : s.id)}
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0 opacity-70" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0 opacity-70" />
                    )}
                    <FileText size={15} className="shrink-0 opacity-80" />
                    <div className="min-w-0">
                      <div className="font-medium text-xs truncate" style={{ color: 'var(--color-text)' }}>
                        {s.relativePath}
                      </div>
                      <div className="text-[11px] opacity-70 flex items-center gap-2 mt-0.5">
                        <span>{text(`权威等级: ${s.authorityStatus}`, `Authority: ${s.authorityStatus}`)}</span>
                        <span>·</span>
                        <span className="font-mono">{s.contentHash.slice(0, 8)}</span>
                        {s.approvedSnapshotId && (
                          <>
                            <span>·</span>
                            <span className="text-[10px] opacity-80 font-mono" title={s.approvedSnapshotId}>
                              已批准: {s.approvedSnapshotId.slice(0, 16)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 状态徽章与批准动作区 */}
                  <div className="flex items-center gap-2 shrink-0">
                    {needsApproval && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          const ok = await approveSource(s.id)
                          if (ok) toast.success(text('已批准该来源当前快照', 'Source snapshot approved'))
                          else toast.error(text('批准失败', 'Approval failed'))
                        }}
                        className="text-[11px] px-2 py-0.5 rounded border border-accent text-accent hover:bg-accent/10 transition-colors font-medium"
                      >
                        {text('批准快照', 'Approve Snapshot')}
                      </button>
                    )}

                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: s.category === 'deprecated' ? 'rgba(239, 68, 68, 0.15)' : 'var(--color-accent-subtle, rgba(59, 130, 246, 0.15))',
                        color: s.category === 'deprecated' ? '#ef4444' : 'var(--color-accent)',
                      }}
                    >
                      {text(cat.zh, cat.en)}
                    </span>

                    {s.isMissing ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/20 text-[var(--color-error-text)] font-medium">
                        {text('缺失', 'Missing')}
                      </span>
                    ) : isStale ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-[var(--color-warning-text)] font-medium">
                        {text('已变化', 'Changed')}
                      </span>
                    ) : !s.approvedSnapshotId ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-[var(--color-accent)] font-medium">
                        {text('待首次批准', 'Pending Approval')}
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-[var(--color-success-text)] font-medium">
                        {text('正常', 'Normal')}
                      </span>
                    )}
                  </div>
                </div>

                {/* 展开后的片段与层级结构 */}
                {isExpanded && selectedSourceDetail && (
                  <div className="border-t p-3 text-xs space-y-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-editor-bg)' }}>
                    <div className="flex items-center justify-between text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      <span>{text('Markdown 标题层级与片段解析', 'Markdown Heading Hierarchy & Fragments')}</span>
                      <span>{text(`共 ${selectedSourceDetail.fragments.length} 个片段`, `${selectedSourceDetail.fragments.length} fragments`)}</span>
                    </div>

                    <div className="space-y-2">
                      {selectedSourceDetail.fragments.map(f => (
                        <div
                          key={f.fragmentId}
                          className="border rounded p-2.5 text-xs space-y-1.5"
                          style={{
                            borderColor: 'var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                          }}
                        >
                          <div className="flex items-center justify-between font-medium" style={{ color: 'var(--color-text)' }}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Layers size={13} className="shrink-0 opacity-70" />
                              <span className="truncate">{f.headingPath}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                              行 {f.startLine} - {f.endLine}
                              {f.chapterStart !== null && ` · 第${f.chapterStart}章`}
                            </span>
                          </div>

                          {f.content && (
                            <div
                              className="text-[11px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed p-2 rounded"
                              style={{
                                backgroundColor: 'var(--color-editor-bg)',
                                color: 'var(--color-text-secondary)',
                              }}
                            >
                              {f.content}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <CandidateApprovalModal
        open={candidateModalOpen}
        onClose={() => setCandidateModalOpen(false)}
      />
    </div>
  )
}
