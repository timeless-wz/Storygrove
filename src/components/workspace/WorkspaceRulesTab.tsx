import { useState } from 'react'
import {
  Clock,
  Ban,
  Trash2,
  ExternalLink,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useWorkspaceHubStore } from '../../stores/workspace-hub-store'
import { useLocaleStore } from '../../stores/locale-store'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import type { SettingRule, SettingRuleStatus } from '../../shared/workspace-hub'

const STATUS_TABS: Array<{ id: SettingRuleStatus | 'all'; zh: string; en: string }> = [
  { id: 'all', zh: '全部', en: 'All' },
  { id: 'confirmed', zh: '已确认', en: 'Confirmed' },
  { id: 'candidate', zh: '候选', en: 'Candidate' },
  { id: 'background', zh: '后台', en: 'Background' },
  { id: 'deprecated', zh: '废止', en: 'Deprecated' },
]

export default function WorkspaceRulesTab() {
  const text = useLocaleStore(s => s.text)
  const rules = useWorkspaceHubStore(s => s.rules)
  const ruleFilterStatus = useWorkspaceHubStore(s => s.ruleFilterStatus)
  const setRuleFilterStatus = useWorkspaceHubStore(s => s.setRuleFilterStatus)
  const updateRuleStatus = useWorkspaceHubStore(s => s.updateRuleStatus)
  const deleteRule = useWorkspaceHubStore(s => s.deleteRule)
  const selectSource = useWorkspaceHubStore(s => s.selectSource)
  const setActiveTab = useWorkspaceHubStore(s => s.setActiveTab)
  const sources = useWorkspaceHubStore(s => s.sources)

  const [constraintFilter, setConstraintFilter] = useState<'all' | 'hard' | 'soft'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTraceRuleId, setExpandedTraceRuleId] = useState<string | null>(null)

  const handleLocateSource = async (rule: SettingRule) => {
    let targetSourceId = rule.sourceId
    if (!targetSourceId && rule.sourceFile) {
      const match = sources.find(s => s.relativePath === rule.sourceFile || s.absolutePath === rule.sourceFile)
      if (match) targetSourceId = match.id
    }
    if (targetSourceId) {
      await selectSource(targetSourceId, {
        snapshotId: rule.sourceSnapshotId,
        fragmentId: rule.sourceSnapshotFragmentId || rule.sourceFragmentId,
        projectId: rule.projectId || 'main',
      })
      setActiveTab('sources')
      toast.success(text(`已跳转定位至母稿资料快照 [${rule.sourceFile}]`, `Navigated to snapshot source [${rule.sourceFile}]`))
    } else {
      toast.info(text('未找到关联的母稿文件，可能为手工创建或文件已移除', 'Source file not found or manually created'))
    }
  }

  const filteredRules = rules.filter(r => {
    if (ruleFilterStatus !== 'all' && r.status !== ruleFilterStatus) return false
    if (constraintFilter !== 'all' && r.constraintType !== constraintFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)
    }
    return true
  })

  const handleStatusChange = async (ruleId: string, newStatus: SettingRuleStatus) => {
    const ok = await updateRuleStatus(ruleId, newStatus)
    if (ok) {
      toast.success(text('规则状态已更新', 'Rule status updated'))
    } else {
      toast.error(text('更新失败', 'Update failed'))
    }
  }

  const handleDelete = async (rule: SettingRule) => {
    const ok = await confirm(
      text(`确定要删除规则「${rule.title}」吗？`, `Delete rule "${rule.title}"?`),
      {
        title: text('删除规则', 'Delete Rule'),
        confirmText: text('删除', 'Delete'),
        danger: true,
      }
    )
    if (!ok) return
    const deleted = await deleteRule(rule.ruleId)
    if (deleted) {
      toast.success(text('规则已删除', 'Rule deleted'))
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 废案与候选重要说明 */}
      <div
        className="flex items-center gap-2.5 px-4 py-2 mx-4 mt-3 rounded border text-xs"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <Ban size={14} className="shrink-0" style={{ color: 'var(--color-error)' }} />
        <span>
          {text(
            '【事实安全原则】废止内容严禁注入任何正文与生成上下文；候选内容进入上下文包时必须显著标记；已确认规则具备最高事实权威。',
            '[Fact Security Principle] Deprecated lore is strictly forbidden from prompt injection. Candidate rules are explicitly tagged. Confirmed rules have authoritative precedence.',
          )}
        </span>
      </div>

      {/* 状态与过滤栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b text-xs shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        {/* 状态页签 */}
        <div className="flex items-center gap-1">
          {STATUS_TABS.map(tab => {
            const isActive = ruleFilterStatus === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setRuleFilterStatus(tab.id)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  isActive ? 'bg-accent/20 font-medium' : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
                style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-text)' }}
              >
                {text(tab.zh, tab.en)}
              </button>
            )
          })}
        </div>

        {/* 约束过滤与搜索 */}
        <div className="flex items-center gap-2">
          <select
            value={constraintFilter}
            onChange={e => setConstraintFilter(e.target.value as 'all' | 'hard' | 'soft')}
            className="text-xs px-2 py-1 rounded border bg-transparent"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="all">{text('全部约束', 'All Constraints')}</option>
            <option value="hard">{text('硬约束', 'Hard Constraint')}</option>
            <option value="soft">{text('软约束', 'Soft Constraint')}</option>
          </select>

          <input
            type="text"
            placeholder={text('搜索规则标题或正文...', 'Search rules...')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="text-xs px-2.5 py-1 rounded border bg-transparent w-48"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
      </div>

      {/* 规则卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredRules.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {text('未找到匹配的设定规则', 'No matching setting rules')}
          </div>
        ) : (
          filteredRules.map(r => {
            return (
              <div
                key={r.ruleId}
                className="border rounded-lg p-3.5 space-y-2.5 transition-all text-xs"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor:
                    r.status === 'deprecated'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : r.status === 'candidate'
                      ? 'rgba(245, 158, 11, 0.3)'
                      : 'var(--color-border)',
                }}
              >
                {/* 规则头部 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                        r.constraintType === 'hard'
                          ? 'bg-red-500/15 text-[var(--color-error-text)]'
                          : 'bg-blue-500/15 text-[var(--color-info)]'
                      }`}
                    >
                      {r.constraintType === 'hard' ? text('硬约束', 'Hard') : text('软约束', 'Soft')}
                    </span>
                    <span className="font-semibold text-xs truncate" style={{ color: 'var(--color-text)' }}>
                      {r.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 opacity-70">
                      {r.scope === 'global' ? text('全局通用', 'Global') : r.scope}
                    </span>
                  </div>

                  {/* 状态徽章与操作 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={r.status}
                      onChange={e => void handleStatusChange(r.ruleId, e.target.value as SettingRuleStatus)}
                      className="text-[11px] px-2 py-0.5 rounded border bg-transparent font-medium"
                      style={{
                        borderColor: 'var(--color-border)',
                        color:
                          r.status === 'confirmed'
                            ? 'var(--color-accent)'
                            : r.status === 'deprecated'
                            ? 'var(--color-error-text)'
                            : r.status === 'candidate'
                            ? 'var(--color-warning-text)'
                            : 'var(--color-text)',
                      }}
                    >
                      <option value="confirmed">{text('已确认', 'Confirmed')}</option>
                      <option value="candidate">{text('候选', 'Candidate')}</option>
                      <option value="background">{text('后台', 'Background')}</option>
                      <option value="deprecated">{text('废止', 'Deprecated')}</option>
                    </select>

                    <button
                      onClick={() => void handleDelete(r)}
                      title={text('删除规则', 'Delete rule')}
                      className="p-1 rounded hover:bg-red-500/10 transition-colors"
                      style={{ color: 'var(--color-error)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* 规则正文 */}
                <div
                  className="font-mono whitespace-pre-wrap leading-relaxed p-2.5 rounded text-[11px]"
                  style={{
                    backgroundColor: 'var(--color-editor-bg)',
                    color: 'var(--color-text)',
                  }}
                >
                  {r.content}
                </div>

                {/* 来源与证明 */}
                <div className="flex items-center justify-between text-[11px] opacity-75 pt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  <div className="flex items-center gap-2 truncate flex-1">
                    <span>{text('来源: ', 'Source: ')}</span>
                    <span className="font-mono">{r.sourceFile || text('手工创建', 'Manual')}</span>
                    {r.sourceHeadingPath && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-xs">{r.sourceHeadingPath}</span>
                      </>
                    )}
                    {r.sourceLineRange && (
                      <>
                        <span>·</span>
                        <span>行 {r.sourceLineRange}</span>
                      </>
                    )}
                    {r.sourceSnapshotId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-blue-500/10 text-[var(--color-info)]">
                        快照 {r.sourceSnapshotId.slice(0, 8)}
                      </span>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {r.confirmedAt && (
                      <div className="flex items-center gap-1 text-[10px]">
                        <Clock size={11} />
                        <span>{text('确认于: ', 'Confirmed: ')}{new Date(r.confirmedAt).toLocaleDateString()}</span>
                      </div>
                    )}
                    {(r.sourceId || r.sourceSnapshotId || r.sourceSnapshotFragmentId) && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedTraceRuleId(expandedTraceRuleId === r.ruleId ? null : r.ruleId)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          style={{ color: 'var(--color-accent)' }}
                          title={text('查看快照与片段溯源详情', 'View snapshot and fragment provenance')}
                        >
                          <Layers size={10} />
                          <span>{text('溯源', 'Provenance')}</span>
                          {expandedTraceRuleId === r.ruleId ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLocateSource(r)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-accent/10 hover:bg-accent/20 transition-colors"
                          style={{ color: 'var(--color-accent)' }}
                          title={text('定位母稿快照文件及片段', 'Locate snapshot source in Materials tab')}
                        >
                          <ExternalLink size={10} />
                          <span>{text('定位原始片段', 'Locate Source')}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* 展开的快照溯源详情卡片 */}
                {expandedTraceRuleId === r.ruleId && (
                  <div
                    className="p-2.5 rounded border text-[11px] space-y-1.5 font-mono"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <div className="flex items-center justify-between text-[10px] font-semibold pb-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <span className="flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                        <Layers size={12} />
                        {text('快照来源追溯凭证', 'Snapshot Provenance Locators')}
                      </span>
                      <span className="opacity-70">{r.originType === 'scan' ? text('扫描提取', 'Scanned') : text('手工创建', 'Manual')}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className="opacity-60">{text('批准快照 ID: ', 'Approved Snapshot: ')}</span>
                        <span className="select-all font-medium" style={{ color: 'var(--color-text)' }}>
                          {r.sourceSnapshotId || text('无', 'None')}
                        </span>
                      </div>
                      <div>
                        <span className="opacity-60">{text('快照片段 ID: ', 'Fragment ID: ')}</span>
                        <span className="select-all font-medium" style={{ color: 'var(--color-text)' }}>
                          {r.sourceSnapshotFragmentId || r.sourceFragmentId || text('无', 'None')}
                        </span>
                      </div>
                      <div>
                        <span className="opacity-60">{text('来源文件 ID: ', 'Source ID: ')}</span>
                        <span className="select-all" style={{ color: 'var(--color-text)' }}>
                          {r.sourceId || text('无', 'None')}
                        </span>
                      </div>
                      <div>
                        <span className="opacity-60">{text('行号范围: ', 'Line Range: ')}</span>
                        <span style={{ color: 'var(--color-text)' }}>{r.sourceLineRange || text('未指定', 'N/A')}</span>
                      </div>
                    </div>
                    <div className="text-[10px] truncate">
                      <span className="opacity-60">{text('标题面包屑路径: ', 'Heading Path: ')}</span>
                      <span style={{ color: 'var(--color-text)' }}>{r.sourceHeadingPath || r.title}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
