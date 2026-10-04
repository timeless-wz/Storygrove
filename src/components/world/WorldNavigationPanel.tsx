import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Search } from 'lucide-react'

import { useLocaleStore } from '../../stores/locale-store'
import type { WorldNavigationPanelProps } from './world-management-contract'

/** A prop-driven world switcher. It owns only its search and disclosure state. */
export default function WorldNavigationPanel({
  worlds,
  selectedWorldId,
  loading,
  loadError,
  onSelect,
  onRetry,
}: WorldNavigationPanelProps) {
  const text = useLocaleStore(state => state.text)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const visibleWorlds = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    if (!keyword) return worlds
    return worlds.filter(world => (
      `${world.name}\n${world.summary}`.toLocaleLowerCase().includes(keyword)
    ))
  }, [query, worlds])

  const regionId = 'world-navigation-list'

  return (
    <aside
      aria-label={text('世界导航', 'World navigation')}
      className="min-w-0 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
      data-collapsed={collapsed}
      data-testid="world-navigation"
    >
      {collapsed ? (
        <>
          <button
            type="button"
            aria-controls={regionId}
            aria-expanded={false}
            aria-label={text('展开世界导航', 'Expand world navigation')}
            className="flex min-h-8 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] sm:justify-start"
            data-testid="world-navigation-expand"
            onClick={() => setCollapsed(false)}
          >
            <ChevronRight size={14} aria-hidden="true" />
            <Globe size={14} aria-hidden="true" />
            <span className="sr-only">{text('展开世界导航', 'Expand world navigation')}</span>
          </button>
          <div id={regionId} hidden />
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <Globe size={14} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
              <span>{text('世界导航', 'World navigation')}</span>
              <span className="rounded-full bg-[var(--color-hover)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--color-text-muted)]">
                {worlds.length}
              </span>
            </h2>
            <button
              type="button"
              aria-controls={regionId}
              aria-expanded={true}
              aria-label={text('收起世界导航', 'Collapse world navigation')}
              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              data-testid="world-navigation-collapse"
              onClick={() => setCollapsed(true)}
            >
              <ChevronDown size={13} aria-hidden="true" />
              <span>{text('收起', 'Collapse')}</span>
            </button>
          </div>

          <div id={regionId} className="mt-2 space-y-2">
            <label className="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 focus-within:ring-2 focus-within:ring-[var(--color-accent)]">
              <Search size={13} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
              <span className="sr-only">{text('搜索世界', 'Search worlds')}</span>
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                aria-label={text('搜索世界', 'Search worlds')}
                className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
                placeholder={text('搜索世界名称或简介', 'Search world name or summary')}
                data-testid="world-navigation-search"
              />
            </label>

            <div
              aria-live="polite"
              className="max-h-72 space-y-1 overflow-y-auto overscroll-contain pr-0.5"
              data-testid="world-navigation-list"
            >
              {loading ? (
                <p className="rounded-[var(--radius-md)] px-2 py-2 text-xs text-[var(--color-text-muted)]" role="status">
                  {text('正在加载世界…', 'Loading worlds…')}
                </p>
              ) : loadError ? (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-2 py-2" role="alert">
                  <p className="min-w-0 flex-1 break-words text-xs text-[var(--color-error)] [overflow-wrap:anywhere]">
                    {text('世界加载失败：', 'Could not load worlds: ')}{loadError}
                  </p>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="min-h-7 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                    data-testid="world-navigation-retry"
                  >
                    {text('重试', 'Retry')}
                  </button>
                </div>
              ) : worlds.length === 0 ? (
                <p className="rounded-[var(--radius-md)] px-2 py-2 text-xs text-[var(--color-text-muted)]">
                  {text('还没有创建世界。', 'No worlds have been created yet.')}
                </p>
              ) : visibleWorlds.length === 0 ? (
                <p className="rounded-[var(--radius-md)] px-2 py-2 text-xs text-[var(--color-text-muted)]">
                  {text('没有匹配的世界。', 'No worlds match this search.')}
                </p>
              ) : (
                <ul className="space-y-1" aria-label={text('世界列表', 'World list')}>
                  {visibleWorlds.map(world => {
                    const selected = world.id === selectedWorldId
                    return (
                      <li key={world.id}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-current={selected ? 'true' : undefined}
                          title={world.name}
                          onClick={() => { void onSelect(world.id) }}
                          data-testid={`world-navigation-item-${world.id}`}
                          className={`block min-w-0 w-full rounded-[var(--radius-md)] border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${selected
                            ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-text)]'
                            : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]'
                            }`}
                        >
                            <span className="block truncate text-xs font-medium" title={world.name}>
                            {world.name}
                          </span>
                          {world.summary.trim() && (
                            <span className="mt-0.5 block truncate text-[10px] leading-4 text-[var(--color-text-muted)]" title={world.summary}>
                              {world.summary}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
