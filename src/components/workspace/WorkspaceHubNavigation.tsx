/**
 * 长篇小说创作资料中枢的顶部导航与资料边界说明。
 *
 * 这里只做导航与只读摘要：扫描、批准与资料状态全部来自 workspace-hub-store。
 * 分组的目的是给出阅读顺序——先资料与来源，再事实与检索，最后长篇控制与修订；
 * 它不改变任何资料的权威状态。
 */

import type { WorkspaceAuthorityStatus, WorkspaceSource } from '../../shared/workspace-hub'
import type { WorkspaceHubTab } from '../../stores/workspace-hub-store'
import {
  AUTHORITY_STATUS_PRESENTATION,
  WORKSPACE_TAB_GROUPS,
} from './workspace-hub-navigation'

type Text = (zhCN: string, enUS: string) => string

export function WorkspaceTabNav({
  activeTab,
  onSelect,
  confirmedRulesCount,
  pendingCandidatesCount,
  text,
}: {
  activeTab: WorkspaceHubTab
  onSelect: (tab: WorkspaceHubTab) => void
  confirmedRulesCount: number
  pendingCandidatesCount: number
  text: Text
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-x-4 gap-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
      {WORKSPACE_TAB_GROUPS.map(group => (
        <div key={group.id} className="flex flex-col gap-1 min-w-0" title={text(group.description.zh, group.description.en)}>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1" style={{ color: 'var(--color-text-muted)' }}>
            {text(group.label.zh, group.label.en)}
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            {group.tabs.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              const badge = tab.id === 'rules' && confirmedRulesCount > 0
                ? confirmedRulesCount
                : tab.id === 'sources' && pendingCandidatesCount > 0
                  ? pendingCandidatesCount
                  : null
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelect(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-accent/20 text-accent font-semibold'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-80'
                  }`}
                >
                  <Icon size={13} />
                  <span>{text(tab.label.zh, tab.label.en)}</span>
                  {badge !== null && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-accent/25">{badge}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 资料边界图例。
 *
 * 计数只统计当前项目已关联来源文件按 authorityStatus 的分布；没有来源的
 * 状态显示为 0，以便一眼看出「扫描结果里没有任何已确认条目」。
 */
export function WorkspaceAuthorityLegend({
  sources,
  text,
}: {
  sources: readonly WorkspaceSource[]
  text: Text
}) {
  const counts = new Map<WorkspaceAuthorityStatus, number>()
  for (const source of sources) {
    counts.set(source.authorityStatus, (counts.get(source.authorityStatus) ?? 0) + 1)
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" data-testid="workspace-authority-legend">
      <span style={{ color: 'var(--color-text-muted)' }}>
        {text('来源权威状态（按已关联文件统计）:', 'Source authority status (by linked file):')}
      </span>
      {AUTHORITY_STATUS_PRESENTATION.map(entry => {
        const count = counts.get(entry.status) ?? 0
        return (
          <span
            key={entry.status}
            className="inline-flex items-center gap-1"
            title={text(entry.detail.zh, entry.detail.en)}
          >
            <span
              className="px-1.5 py-0.5 rounded-full font-medium"
              style={{
                color: entry.status === 'deprecated' ? 'var(--color-error-text)' : 'var(--color-text-secondary)',
                backgroundColor: entry.status === 'deprecated'
                  ? 'color-mix(in srgb, var(--color-error) 12%, transparent)'
                  : 'var(--color-hover)',
              }}
            >
              {text(entry.label.zh, entry.label.en)}
            </span>
            <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{count}</span>
          </span>
        )
      })}
      <span style={{ color: 'var(--color-text-muted)' }}>
        {text('扫描只会产生候选与素材，不会直接产生已确认来源。', 'Scanning produces candidates and material only, never confirmed sources.')}
      </span>
    </div>
  )
}

/** 状态摘要的单个计数项。 */
export function SummaryMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'warning' | 'error' | 'accent'
}) {
  const color = tone === 'warning'
    ? 'var(--color-warning-text)'
    : tone === 'error'
      ? 'var(--color-error-text)'
      : tone === 'accent'
        ? 'var(--color-accent)'
        : 'var(--color-text)'
  return (
    <div className="flex flex-col" title={hint}>
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="text-xs font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  )
}
