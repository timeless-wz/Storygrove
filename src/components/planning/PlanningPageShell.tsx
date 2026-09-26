/**
 * PlanningPageShell — 创作规划区域五个页面共用的页面外壳。
 *
 * 服务对象：章节蓝图、章节脉络、故事时间线、伏笔管理、多地图地图册。
 * 统一的是「怎么摆放」——返回路径、标题层级、工具栏、左侧列表、筛选与空状态；
 * 每个页面自己的数据模型、存储与真实操作完全保留在各页面内部，绝不在这里合并。
 *
 * 只使用主题 token（--color-*）着色，因此主题切换时外壳与画布一起变化。
 */

import { ChevronRight, Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { useLocaleStore } from '../../stores/locale-store'
import { cn } from '../../lib/utils'
import { Input } from '../ui/Input'

import './planning-workbench.css'

export interface PlanningCrumb {
  label: string
  onClick?: () => void
}

interface PlanningPageShellProps {
  /** 面包屑返回路径，最后一项即当前页面。 */
  breadcrumb: PlanningCrumb[]
  icon: ReactNode
  title: string
  description: string
  /** 标题行右侧的统计信息（数量、进度等）。 */
  meta?: ReactNode
  /** 工具栏：页面级真实操作。 */
  actions?: ReactNode
  /** 标题下方的提示横幅（来源变更、权限异常等）。 */
  banner?: ReactNode
  children: ReactNode
  className?: string
}

/** 统一的标题层级：返回路径 → 标题 + 统计 → 用途说明 → 工具栏。 */
export function PlanningPageShell({
  breadcrumb,
  icon,
  title,
  description,
  meta,
  actions,
  banner,
  children,
  className,
}: PlanningPageShellProps) {
  const text = useLocaleStore(s => s.text)
  return (
    <div className={cn('planning-page', className)}>
      <header className="planning-page__header">
        <div className="planning-page__heading">
          <nav className="planning-page__breadcrumb" aria-label={text('返回路径', 'Breadcrumb')}>
            {breadcrumb.map((crumb, index) => {
              const isCurrent = index === breadcrumb.length - 1
              return (
                <span key={`${crumb.label}:${index}`} className="planning-page__crumb-item">
                  {index > 0 && <ChevronRight size={10} className="planning-page__crumb-sep" aria-hidden="true" />}
                  {crumb.onClick && !isCurrent ? (
                    <button
                      type="button"
                      className="planning-page__crumb"
                      onClick={crumb.onClick}
                      title={crumb.label}
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span
                      className={cn('planning-page__crumb', isCurrent && 'is-current')}
                      aria-current={isCurrent ? 'page' : undefined}
                    >
                      {crumb.label}
                    </span>
                  )}
                </span>
              )
            })}
          </nav>
          <div className="planning-page__title-row">
            <span className="planning-page__crumb" aria-hidden="true" style={{ color: 'var(--color-accent)' }}>
              {icon}
            </span>
            <h1 className="planning-page__title">{title}</h1>
            {meta && <span className="planning-page__meta">{meta}</span>}
          </div>
          <p className="planning-page__description">{description}</p>
        </div>
        {actions && <div className="planning-page__actions">{actions}</div>}
      </header>

      {banner}

      <div className="planning-page__body">{children}</div>
    </div>
  )
}

interface PlanningPaneProps {
  /** 左侧列表的标题，说明这一列装的是什么。 */
  title: string
  icon?: ReactNode
  /** 列表级真实操作（新增、重建等）。 */
  actions?: ReactNode
  /** 筛选区：搜索框与状态胶囊。 */
  filters?: ReactNode
  footer?: ReactNode
  width?: number
  children: ReactNode
  testId?: string
}

/** 统一的左侧列表：标题 + 操作 → 筛选 → 列表 → 页脚统计。 */
export function PlanningPane({
  title,
  icon,
  actions,
  filters,
  footer,
  width = 236,
  children,
  testId,
}: PlanningPaneProps) {
  return (
    <aside
      className="planning-pane"
      style={{ ['--planning-pane-width' as string]: `${width}px` }}
      data-testid={testId}
    >
      <div className="planning-pane__header">
        <span className="planning-pane__title">
          {icon}
          {title}
        </span>
        {actions && <span className="planning-pane__actions">{actions}</span>}
      </div>
      {filters && <div className="planning-pane__filters">{filters}</div>}
      <div className="planning-pane__body">{children}</div>
      {footer && <div className="planning-pane__footer">{footer}</div>}
    </aside>
  )
}

interface PlanningSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel?: string
}

/** 统一的搜索框（带清除按钮）。 */
export function PlanningSearch({ value, onChange, placeholder, ariaLabel }: PlanningSearchProps) {
  const text = useLocaleStore(s => s.text)
  return (
    <div className="planning-pane__search">
      <Search size={12} className="planning-pane__search-icon" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
      />
      {value && (
        <button
          type="button"
          className="planning-pane__search-clear"
          onClick={() => onChange('')}
          aria-label={text('清除搜索', 'Clear search')}
          title={text('清除搜索', 'Clear search')}
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

export interface PlanningChipOption<T extends string> {
  value: T
  label: string
  count?: number
}

interface PlanningChipGroupProps<T extends string> {
  value: T
  options: Array<PlanningChipOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
}

/** 统一的状态筛选胶囊：选中态取 --color-accent。 */
export function PlanningChipGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: PlanningChipGroupProps<T>) {
  return (
    <div className="planning-chips" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={cn('planning-chip', value === option.value && 'is-active')}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="planning-chip__count">{option.count}</span>}
        </button>
      ))}
    </div>
  )
}

interface PlanningListRowProps {
  selected?: boolean
  onSelect: () => void
  icon?: ReactNode
  title: string
  subtitle?: ReactNode
  trailing?: ReactNode
  titleAttr?: string
  onDoubleClick?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  testId?: string
}

/** 统一的列表行：图标 + 标题 + 副标题 + 右侧标签。 */
export function PlanningListRow({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  trailing,
  titleAttr,
  onDoubleClick,
  onContextMenu,
  testId,
}: PlanningListRowProps) {
  return (
    <button
      type="button"
      className={cn('planning-row', selected && 'is-selected')}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={titleAttr ?? title}
      data-testid={testId}
    >
      {icon && <span className="planning-row__icon">{icon}</span>}
      <span className="planning-row__content">
        <span className="planning-row__title">{title}</span>
        {subtitle && <span className="planning-row__subtitle">{subtitle}</span>}
      </span>
      {trailing && <span className="planning-row__trailing">{trailing}</span>}
    </button>
  )
}

interface PlanningEmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  /** 如何开始：按顺序说明作者接下来要做的真实动作。 */
  steps?: string[]
  /** 连接到页面已有的创建动作。 */
  actions?: ReactNode
  variant?: 'panel' | 'card'
  className?: string
}

/**
 * 统一的空状态：说明这里是什么、怎么开始，并直接给出该页面已有的创建入口。
 * 只描述真实存在的动作，不预置任何占位数据。
 */
export function PlanningEmptyState({
  icon,
  title,
  description,
  steps,
  actions,
  variant = 'panel',
  className,
}: PlanningEmptyStateProps) {
  return (
    <div className={cn('planning-empty', variant === 'card' && 'is-card', className)}>
      <span className="planning-empty__icon">{icon}</span>
      <span className="planning-empty__title">{title}</span>
      <p className="planning-empty__description">{description}</p>
      {steps && steps.length > 0 && (
        <div className="planning-empty__steps">
          {steps.map((step, index) => (
            <span key={step} className="planning-empty__step">
              <span className="planning-empty__step-index">{index + 1}</span>
              <span>{step}</span>
            </span>
          ))}
        </div>
      )}
      {actions && <div className="planning-empty__actions">{actions}</div>}
    </div>
  )
}
