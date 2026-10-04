/**
 * TimelineEventSidebar — 故事时间线内侧栏「事件与支线」（任务 D）。
 *
 * 职责边界：
 * - 只呈现与筛选列表，所有真实写入都通过回调交给页面（页面再走 store/IPC）；
 * - 主线与支线分组，真实存在的空支线也保留一行，保证创建后可见、可重命名、可删除；
 * - 主线不提供任何删除/改名入口；支线标题提供重命名、添加事件、折叠、删除；
 * - 折叠由页面控制：收起后本组件整体不占布局宽度，画布占满释放的空间，
 *   展开入口由 TimelineSidebarRail 悬浮在画布左缘；
 * - 筛选只作用于本列表，画布始终展示全部事件，界面里对此有明确说明。
 */

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  Clock3,
  GitBranch,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

import type {
  StoryTimelineBranch,
  StoryTimelineDeleteImpact,
  StoryTimelineDeletePreviewResult,
  StoryTimelineEvent,
  StoryTimelineEventStatus,
} from '../../shared/story-timeline'
import {
  STORY_TIMELINE_MAIN_BRANCH_ID,
  STORY_TIMELINE_STATUS_LABELS,
} from '../../shared/story-timeline'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import {
  PlanningChipGroup,
  PlanningEmptyState,
  PlanningListRow,
  PlanningPane,
  PlanningSearch,
} from '../planning/PlanningPageShell'
import type { TimelineUiResult } from './timeline-ui-contract'
import './story-timeline-workbench.css'

/** 支线删除的页面结果：需要重新确认时带回最新影响，绝不静默扩大范围。 */
export type TimelineDeleteBranchResult =
  | { success: true }
  | { success: false; error: string; needsReconfirmation?: boolean; preview?: StoryTimelineDeleteImpact }

/** 删除确认区的状态机：预览、提交、失败与重新确认都在这一个对象里。 */
interface BranchDeleteState {
  branchId: string
  preview: StoryTimelineDeleteImpact | null
  loadingPreview: boolean
  deleting: boolean
  error: string | null
  /** true 表示确认后影响集合变化，需要用最新预览重新确认。 */
  needsReconfirmation: boolean
}

/** 列表筛选：只影响列表，不影响画布渲染。 */
export interface TimelineSidebarFilters {
  query: string
  status: 'all' | StoryTimelineEventStatus
  /** 'all' | STORY_TIMELINE_MAIN_BRANCH_ID | 真实支线 id */
  branchId: string
}

export const DEFAULT_TIMELINE_SIDEBAR_FILTERS: TimelineSidebarFilters = {
  query: '',
  status: 'all',
  branchId: 'all',
}

export interface TimelineEventSidebarProps {
  events: readonly StoryTimelineEvent[]
  branches: readonly StoryTimelineBranch[]
  expandedBranchIds: readonly string[]
  selectedId: string | null
  /**
   * 当前项目的数据是否已经真的读入。false 时绝不展示「还没有事件」这类
   * 空项目状态——读取失败不能伪装成空时间线。
   */
  dataReady: boolean
  filters: TimelineSidebarFilters
  onFiltersChange: (next: TimelineSidebarFilters) => void
  /** 收起内侧栏：只隐藏本列，不影响全局项目导航。 */
  onCollapse: () => void
  /** 单击列表定位：展开全部祖先支线并把画布移到可读比例。 */
  onLocateEvent: (eventId: string) => void
  onEditEvent: (eventId: string) => void
  onCreateMainEvent: () => void
  /** 在指定支线追加事件。 */
  onAddBranchEvent: (branchId: string) => void
  /** 折叠/展开一条支线在画布上的泳道。 */
  onToggleBranch: (branchId: string) => void
  onRenameBranch: (branchId: string, name: string) => Promise<TimelineUiResult>
  /** 删除前的影响预览：由主进程用与真实删除完全相同的递归规则生成。 */
  onPreviewDeleteBranch: (branchId: string) => Promise<StoryTimelineDeletePreviewResult>
  /** 用预览指纹提交删除；影响集合变化时返回需要重新确认。 */
  onDeleteBranch: (branchId: string, fingerprint: string) => Promise<TimelineDeleteBranchResult>
}

interface SidebarGroup {
  id: string
  name: string
  isMain: boolean
  color?: string
  /** 筛选之后仍然可见的事件。 */
  events: StoryTimelineEvent[]
  /** 数据里这条支线一个事件都没有（不是被筛掉的）。 */
  isEmptyBranch: boolean
  expanded: boolean
  /** 该支线在数据里的事件总数，用于折叠入口的可用性判断。 */
  totalEvents: number
}

/** 折叠后的展开入口：悬浮在画布左缘，不占布局宽度。 */
export function TimelineSidebarRail({ onExpand }: { onExpand: () => void }) {
  const text = useLocaleStore(s => s.text)
  return (
    <button
      type="button"
      className="timeline-sidebar-rail"
      data-testid="timeline-sidebar-expand"
      onClick={onExpand}
      title={text('展开事件与支线', 'Expand events & branches')}
      aria-label={text('展开事件与支线', 'Expand events & branches')}
    >
      <ChevronsRight size={14} aria-hidden="true" />
      <span className="timeline-sidebar-rail-label">{text('事件与支线', 'Events & branches')}</span>
    </button>
  )
}

export function TimelineEventSidebar({
  events,
  branches,
  expandedBranchIds,
  selectedId,
  dataReady,
  filters,
  onFiltersChange,
  onCollapse,
  onLocateEvent,
  onEditEvent,
  onCreateMainEvent,
  onAddBranchEvent,
  onToggleBranch,
  onRenameBranch,
  onPreviewDeleteBranch,
  onDeleteBranch,
}: TimelineEventSidebarProps) {
  const text = useLocaleStore(s => s.text)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)

  const [confirmDeleteState, setConfirmDeleteState] = useState<BranchDeleteState | null>(null)

  const statusLabel = (status: StoryTimelineEventStatus) => {
    const label = STORY_TIMELINE_STATUS_LABELS[status]
    return text(label.zh, label.en)
  }

  /** 统计口径：branches 数据里含 main，主线不是支线，不能计入支线数。 */
  const nonMainBranches = useMemo(
    () => branches.filter(branch => branch.id !== STORY_TIMELINE_MAIN_BRANCH_ID),
    [branches],
  )

  const orderedEvents = useMemo(
    () => [...events].sort((left, right) => (
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
    )),
    [events],
  )

  /** 筛选只作用列表：搜索标题/时间、状态、线路三者叠加。 */
  const listedEvents = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return orderedEvents.filter(event => {
      const branchId = event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID
      if (filters.branchId !== 'all' && branchId !== filters.branchId) return false
      if (filters.status !== 'all' && event.status !== filters.status) return false
      if (query && !(
        event.title.toLowerCase().includes(query)
        || event.timeLabel.toLowerCase().includes(query)
      )) return false
      return true
    })
  }, [orderedEvents, filters])

  /**
   * 按主线 / 支线分组：筛选后没有可见事件的支线不再占位，
   * 但数据里真的没有事件的空支线始终显示，保证创建后可发现、可管理。
   */
  const groups = useMemo<SidebarGroup[]>(() => {
    const result: SidebarGroup[] = []
    const mainEvents = listedEvents.filter(
      event => (event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID,
    )
    const mainBranch = branches.find(branch => branch.id === STORY_TIMELINE_MAIN_BRANCH_ID)
    if (mainEvents.length > 0) {
      result.push({
        id: STORY_TIMELINE_MAIN_BRANCH_ID,
        name: mainBranch?.name || text('主轴事件', 'Main axis'),
        isMain: true,
        events: mainEvents,
        isEmptyBranch: false,
        expanded: true,
        totalEvents: orderedEvents.filter(
          event => (event.branchId || STORY_TIMELINE_MAIN_BRANCH_ID) === STORY_TIMELINE_MAIN_BRANCH_ID,
        ).length,
      })
    }

    for (const branch of nonMainBranches) {
      const branchEvents = listedEvents.filter(event => event.branchId === branch.id)
      const totalEvents = orderedEvents.filter(event => event.branchId === branch.id).length
      if (branchEvents.length === 0) {
        if (totalEvents > 0) continue // 只是被筛选条件挡住
        result.push({
          id: branch.id,
          name: branch.name,
          isMain: false,
          color: branch.color,
          events: [],
          isEmptyBranch: true,
          expanded: expandedBranchIds.includes(branch.id),
          totalEvents: 0,
        })
        continue
      }
      result.push({
        id: branch.id,
        name: branch.name,
        isMain: false,
        color: branch.color,
        events: branchEvents,
        isEmptyBranch: false,
        expanded: expandedBranchIds.includes(branch.id),
        totalEvents,
      })
    }
    return result
  }, [branches, expandedBranchIds, listedEvents, nonMainBranches, orderedEvents, text])

  const filterActive = filters.query.trim() !== ''
    || filters.status !== 'all'
    || filters.branchId !== 'all'

  const clearFilters = () => onFiltersChange(DEFAULT_TIMELINE_SIDEBAR_FILTERS)

  const submitRename = async (branchId: string) => {
    const branch = branches.find(item => item.id === branchId)
    if (!branch) {
      setRenameError(text('找不到这条支线', 'Branch not found'))
      return
    }
    const name = renameValue.trim()
    if (!name) {
      setRenameError(text('支线名称不能为空', 'Branch name is required'))
      return
    }
    if (name === branch.name) {
      setRenamingId(null)
      return
    }
    setRenameSaving(true)
    setRenameError(null)
    const result = await onRenameBranch(branch.id, name)
    setRenameSaving(false)
    // 失败保留输入与错误，成功才结束本次重命名。
    if (!result.success) {
      setRenameError(result.error)
      return
    }
    setRenamingId(null)
  }

  /** 打开删除确认区：先向主进程要权威影响，拿不到就不给确认按钮。 */
  const startDelete = async (branchId: string) => {
    setConfirmDeleteState({
      branchId,
      preview: null,
      loadingPreview: true,
      deleting: false,
      error: null,
      needsReconfirmation: false,
    })
    const result = await onPreviewDeleteBranch(branchId)
    setConfirmDeleteState(current => {
      if (!current || current.branchId !== branchId) return current
      if (!result.success || !result.preview) {
        return {
          ...current,
          loadingPreview: false,
          error: result.error || text('无法获取删除影响，请重试', 'Could not load the delete impact; please retry'),
        }
      }
      return { ...current, loadingPreview: false, preview: result.preview, error: null }
    })
  }

  const confirmDelete = async () => {
    const current = confirmDeleteState
    if (!current || !current.preview || current.deleting) return
    setConfirmDeleteState({ ...current, deleting: true, error: null })
    const result = await onDeleteBranch(current.branchId, current.preview.fingerprint)
    if (result.success) {
      setConfirmDeleteState(null)
      return
    }
    if (result.needsReconfirmation && result.preview) {
      // 影响集合已变化：保留确认区，换成最新影响要求重新确认。
      setConfirmDeleteState({
        branchId: current.branchId,
        preview: result.preview,
        loadingPreview: false,
        deleting: false,
        error: result.error,
        needsReconfirmation: true,
      })
      return
    }
    // 失败保留上下文与预览，作者可以直接重试。
    setConfirmDeleteState({ ...current, deleting: false, error: result.error })
  }

  return (
    <PlanningPane
      title={text('事件与支线', 'Events & branches')}
      icon={<GitBranch size={12} />}
      width={250}
      testId="timeline-event-sidebar"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onCreateMainEvent}
            title={text('新建主轴事件', 'New main-axis event')}
            aria-label={text('新建主轴事件', 'New main-axis event')}
            data-testid="timeline-sidebar-new-event"
          >
            <Plus size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onCollapse}
            title={text('收起事件与支线', 'Collapse events & branches')}
            aria-label={text('收起事件与支线', 'Collapse events & branches')}
            data-testid="timeline-sidebar-collapse"
          >
            <ChevronsLeft size={13} />
          </Button>
        </>
      }
      filters={
        <>
          <PlanningSearch
            value={filters.query}
            onChange={value => onFiltersChange({ ...filters, query: value })}
            placeholder={text('搜索标题或时间…', 'Search title or time…')}
          />
          <PlanningChipGroup
            value={filters.status}
            onChange={value => onFiltersChange({ ...filters, status: value })}
            ariaLabel={text('事件状态筛选', 'Event status filter')}
            options={[
              { value: 'all', label: text('全部', 'All') },
              { value: 'planned', label: statusLabel('planned') },
              { value: 'drafted', label: statusLabel('drafted') },
              { value: 'finalized', label: statusLabel('finalized') },
            ]}
          />
          {nonMainBranches.length > 0 && (
            <PlanningChipGroup
              value={filters.branchId}
              onChange={value => onFiltersChange({ ...filters, branchId: value })}
              ariaLabel={text('主线与支线筛选', 'Main line and branch filter')}
              options={[
                { value: 'all', label: text('全部线路', 'All lines') },
                { value: STORY_TIMELINE_MAIN_BRANCH_ID, label: text('仅主轴', 'Main axis') },
                ...nonMainBranches.map(branch => ({ value: branch.id, label: branch.name })),
              ]}
            />
          )}
          {/* 筛选作用的范围必须说清楚：只筛列表，不隐藏画布事件。 */}
          <p className="timeline-sidebar__scope-note" data-testid="timeline-filter-scope-note">
            {text(
              '筛选只作用于这份列表；画布始终显示全部事件。',
              'Filters apply to this list only; the canvas always shows every event.',
            )}
          </p>
        </>
      }
      footer={dataReady ? (
        <span className="timeline-sidebar__footer">
          <span data-testid="timeline-sidebar-count">
            {text(
              `显示 ${listedEvents.length} / ${events.length} 个事件`,
              `Showing ${listedEvents.length} of ${events.length} events`,
            )}
          </span>
          <span data-testid="timeline-sidebar-branch-count">
            {text(`${nonMainBranches.length} 条支线`, `${nonMainBranches.length} branches`)}
          </span>
        </span>
      ) : undefined}
    >
      {!dataReady ? (
        <div className="timeline-sidebar__pending" data-testid="timeline-sidebar-not-loaded">
          {text(
            '这个项目的事件还没有读入。读取成功前，这里不会显示成「没有事件」。',
            'This project’s events are not loaded yet. Until the read succeeds this list will not claim you have no events.',
          )}
        </div>
      ) : groups.length === 0 ? (
        <PlanningEmptyState
          icon={<Clock3 size={20} />}
          title={events.length === 0
            ? text('时间线上还没有事件', 'No timeline events yet')
            : text('没有符合筛选的事件', 'No events match the filters')}
          description={events.length === 0
            ? text(
                '时间线只记录你自己排布的剧情时间，画布上不会预置任何占位事件。',
                'The timeline only holds events you arrange; no placeholder events are pre-filled.',
              )
            : text('可以调整搜索词，或切换状态与线路筛选。', 'Adjust the search term, or switch the status and line filters.')}
          steps={events.length === 0 ? [
            text('先在「刻度设置」里确定故事开端与结束，界定时间范围；', 'Set the story start and end in “Ruler settings” to bound the range.'),
            text('再在画布空白处右键选择「在此创建事件」，或点上方「新建事件」。', 'Right-click the canvas to add an event, or use “New event” above.'),
          ] : undefined}
          actions={events.length === 0 ? (
            <Button variant="default" size="sm" onClick={onCreateMainEvent}>
              <Plus size={13} /> {text('新建事件', 'New event')}
            </Button>
          ) : filterActive ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              {text('清除筛选', 'Clear filters')}
            </Button>
          ) : undefined}
        />
      ) : groups.map(group => (
        <div
          key={group.id}
          className="timeline-sidebar__group"
          data-testid="timeline-branch-group"
          data-branch-id={group.id}
          data-is-main={group.isMain ? 'true' : 'false'}
        >
          <div className="timeline-sidebar__group-head">
            <button
              type="button"
              className="timeline-sidebar__group-toggle"
              onClick={() => {
                if (!group.isMain && group.totalEvents > 0) onToggleBranch(group.id)
              }}
              aria-expanded={group.isMain ? true : group.expanded}
              aria-label={group.isMain
                ? group.name
                : text(
                    `${group.expanded ? '折叠' : '展开'}支线 ${group.name}`,
                    `${group.expanded ? 'Collapse' : 'Expand'} branch ${group.name}`,
                  )}
              data-testid="timeline-branch-toggle"
              data-branch-id={group.id}
              disabled={group.isMain || group.totalEvents === 0}
            >
              {!group.isMain && group.totalEvents > 0 && (
                group.expanded
                  ? <ChevronDown size={11} aria-hidden="true" />
                  : <ChevronRight size={11} aria-hidden="true" />
              )}
              <span
                className="timeline-sidebar__swatch"
                aria-hidden="true"
                style={group.isMain ? undefined : { background: group.color || undefined }}
              />
              <span className="timeline-sidebar__group-name" title={group.name}>{group.name}</span>
            </button>
            <span className="timeline-sidebar__group-count">{group.events.length}</span>
            {/* 主线是核心基准：不提供删除/改为支线等危险操作。 */}
            {!group.isMain && (
              <span className="timeline-sidebar__group-actions">
                <button
                  type="button"
                  className="timeline-sidebar__icon-button"
                  data-testid="timeline-branch-rename"
                  data-branch-id={group.id}
                  title={text('重命名支线', 'Rename branch')}
                  aria-label={text(`重命名支线 ${group.name}`, `Rename branch ${group.name}`)}
                  onClick={() => {
                    setRenamingId(group.id)
                    setRenameValue(group.name)
                    setRenameError(null)
                    setConfirmDeleteState(null)
                  }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="timeline-sidebar__icon-button"
                  data-testid="timeline-branch-add-event"
                  data-branch-id={group.id}
                  title={text('在这条支线上添加事件', 'Add event on this branch')}
                  aria-label={text(`在 ${group.name} 上添加事件`, `Add event on ${group.name}`)}
                  onClick={() => onAddBranchEvent(group.id)}
                >
                  <Plus size={11} />
                </button>
                <button
                  type="button"
                  className="timeline-sidebar__icon-button is-danger"
                  data-testid="timeline-branch-delete"
                  data-branch-id={group.id}
                  title={text('删除支线', 'Delete branch')}
                  aria-label={text(`删除支线 ${group.name}`, `Delete branch ${group.name}`)}
                  onClick={() => void startDelete(group.id)}
                >
                  <Trash2 size={11} />
                </button>
              </span>
            )}
          </div>

          {renamingId === group.id && (
            <div className="timeline-sidebar__rename">
              <input
                className="timeline-sidebar__rename-input"
                data-testid="timeline-branch-rename-input"
                value={renameValue}
                autoFocus
                aria-label={text('支线名称', 'Branch name')}
                onChange={event => {
                  setRenameValue(event.target.value)
                  setRenameError(null)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitRename(group.id)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setRenamingId(null)
                    setRenameError(null)
                  }
                }}
              />
              <button
                type="button"
                className="timeline-sidebar__icon-button"
                data-testid="timeline-branch-rename-save"
                disabled={renameSaving}
                title={text('保存支线名称', 'Save branch name')}
                aria-label={text('保存支线名称', 'Save branch name')}
                onClick={() => void submitRename(group.id)}
              >
                <Check size={11} />
              </button>
              <button
                type="button"
                className="timeline-sidebar__icon-button"
                data-testid="timeline-branch-rename-cancel"
                title={text('取消重命名', 'Cancel rename')}
                aria-label={text('取消重命名', 'Cancel rename')}
                onClick={() => {
                  setRenamingId(null)
                  setRenameError(null)
                }}
              >
                <X size={11} />
              </button>
            </div>
          )}
          {renamingId === group.id && renameError && (
            <p className="timeline-sidebar__error" role="alert" data-testid="timeline-branch-rename-error">
              {renameError}
            </p>
          )}

          {confirmDeleteState?.branchId === group.id && (
            <div className="timeline-sidebar__confirm" data-testid="timeline-branch-delete-confirm">
              <p className="timeline-sidebar__confirm-title">
                {confirmDeleteState.needsReconfirmation
                  ? text('影响范围已经变化', 'The impact has changed')
                  : text('删除这条支线？', 'Delete this branch?')}
              </p>
              {confirmDeleteState.loadingPreview && (
                <p data-testid="timeline-branch-delete-preview-loading">
                  {text('正在计算删除影响…', 'Calculating the delete impact…')}
                </p>
              )}
              {confirmDeleteState.preview && (
                <p data-testid="timeline-branch-delete-impact">
                  {text(
                    `将删除 ${confirmDeleteState.preview.eventCount} 个事件、${confirmDeleteState.preview.branchCount} 条支线。`,
                    `${confirmDeleteState.preview.eventCount} events and ${confirmDeleteState.preview.branchCount} branches will be deleted.`,
                  )}
                  {confirmDeleteState.preview.branchNames.length > 0 && (
                    <span className="timeline-sidebar__confirm-names">
                      {` （${confirmDeleteState.preview.branchNames.join('、')}）`}
                    </span>
                  )}
                </p>
              )}
              {confirmDeleteState.error && (
                <p className="timeline-sidebar__error" role="alert" data-testid="timeline-branch-delete-error">
                  {confirmDeleteState.error}
                </p>
              )}
              <div className="timeline-sidebar__confirm-actions">
                <button
                  type="button"
                  className="timeline-sidebar__confirm-button is-danger"
                  data-testid="timeline-branch-delete-confirm-button"
                  disabled={confirmDeleteState.deleting || confirmDeleteState.loadingPreview || !confirmDeleteState.preview}
                  onClick={() => void confirmDelete()}
                >
                  <Trash2 size={11} />
                  <span>{confirmDeleteState.deleting ? text('删除中…', 'Deleting…') : text('确认删除', 'Confirm delete')}</span>
                </button>
                <button
                  type="button"
                  className="timeline-sidebar__confirm-button"
                  data-testid="timeline-branch-delete-cancel"
                  onClick={() => setConfirmDeleteState(null)}
                >
                  {text('取消', 'Cancel')}
                </button>
              </div>
            </div>
          )}

          {group.isEmptyBranch ? (
            <div
              className="timeline-sidebar__empty-branch"
              data-testid="timeline-branch-empty"
              data-branch-id={group.id}
              title={text('这条支线还没有事件', 'This branch has no events yet')}
            >
              {text('暂无事件', 'No events yet')}
            </div>
          ) : group.events.map(event => (
            <PlanningListRow
              key={event.id}
              selected={selectedId === event.id}
              onSelect={() => onLocateEvent(event.id)}
              onDoubleClick={() => onEditEvent(event.id)}
              icon={<span className={`writer-timeline-status-dot is-${event.status}`} aria-hidden="true" />}
              title={event.title || text('未命名事件', 'Untitled event')}
              subtitle={event.timeLabel || text('未填写时间', 'No time label')}
              titleAttr={text('单击定位到画布，双击编辑事件', 'Click to locate on the canvas, double-click to edit')}
              trailing={<span className="planning-tag">{statusLabel(event.status)}</span>}
              testId={`timeline-event-row:${event.id}`}
            />
          ))}
        </div>
      ))}
    </PlanningPane>
  )
}
