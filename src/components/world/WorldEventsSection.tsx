/**
 * 世界历史事件分区。
 *
 * 事件本体始终由 `story_timeline_events` 拥有：世界页只维护「这个世界关联了
 * 哪些事件」以及事件与实体之间的关系。同一个事件关联多个世界时，各世界
 * 看到的是同一条事件，不复制第二份内容；在故事时间线里编辑后这里同步更新。
 *
 * 历史可以早于故事开端，也可以晚于开端：这里不强制章节号，也不改动作者
 * 设置的故事范围。
 */
import { useEffect, useMemo, useState } from 'react'
import { History, Link2, Plus, Trash2 } from 'lucide-react'

import { STORY_TIMELINE_PRECISION_LABELS, STORY_TIMELINE_STATUS_LABELS } from '../../shared/story-timeline'
import {
  WORLD_EVENT_TARGET_KIND_LABELS,
  WORLD_EVENT_TARGET_KINDS,
  type WorldEventLink,
  type WorldEventTargetKind,
} from '../../shared/world-workbench'
import { useLocaleStore } from '../../stores/locale-store'
import { useStoryTimelineStore } from '../../stores/story-timeline-store'
import { useWorldWorkbenchStore } from '../../stores/world-workbench-store'
import { Button } from '../ui/Button'
import { EntityFormDialog, fieldValue, withUnset, type FormFieldSpec } from './world-forms'
import { EmptyHint, SectionShell } from './WorldWorkbenchView'
import { openStoryTimeline } from './world-navigation'

export default function WorldEventsSection({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveEventLinks = useWorldWorkbenchStore(s => s.saveEventLinks)
  const deleteRelation = useWorldWorkbenchStore(s => s.deleteRelation)

  const events = useStoryTimelineStore(s => s.events)
  const loadTimeline = useStoryTimelineStore(s => s.loadAll)

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void loadTimeline(projectKey) }, [projectKey, loadTimeline])

  const linkedEventIds = new Set(data.eventWorlds.filter(row => row.worldId === worldId).map(row => row.eventId))
  const linkedEvents = events.filter(event => linkedEventIds.has(event.id))
  const unlinkedEvents = events.filter(event => !linkedEventIds.has(event.id))

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return linkedEvents
    return linkedEvents.filter(event => (
      event.title.toLocaleLowerCase('zh-CN').includes(keyword)
      || event.timeLabel.toLocaleLowerCase('zh-CN').includes(keyword)
    ))
  }, [linkedEvents, search])

  const current = editing ? events.find(event => event.id === editing) ?? null : null
  const currentLinks = editing ? data.eventLinks.filter(link => link.eventId === editing) : []

  const fields: FormFieldSpec[] = current
    ? [
        { key: 'title', label: text('标题', 'Title'), kind: 'text' },
        { key: 'timeLabel', label: text('时间文字', 'Time label'), kind: 'text', hint: text('可以写虚构纪年与模糊时间，不会被解析为真实日期。', 'Fictional eras and fuzzy labels are kept as written and never parsed into real dates.') },
        {
          key: 'precision',
          label: text('时间精度', 'Time precision'),
          kind: 'select',
          options: (['exact', 'range', 'relative', 'unknown'] as const).map(value => ({
            value,
            label: text(STORY_TIMELINE_PRECISION_LABELS[value].zh, STORY_TIMELINE_PRECISION_LABELS[value].en),
          })),
        },
        { key: 'rangeEndLabel', label: text('时间范围结束（精度为范围时）', 'Range end (for range precision)'), kind: 'text' },
        { key: 'sortOrder', label: text('排序刻度', 'Order tick'), kind: 'number', hint: text('独立刻度；历史事件可以用负数刻度排在故事开端之前。', 'An independent tick; historical events can use negative ticks before the story starts.') },
        { key: 'description', label: text('经过', 'Account'), kind: 'textarea' },
        { key: 'outcome', label: text('结果', 'Outcome'), kind: 'textarea' },
        { key: 'aftermath', label: text('后续影响', 'Aftermath'), kind: 'textarea' },
        { key: 'chapterNumbers', label: text('关联章节（可留空，逗号分隔）', 'Chapters (optional, comma separated)'), kind: 'text', hint: text('历史事件不强制关联正文或正整数章节。', 'Historical events are not forced to reference prose or positive chapter numbers.') },
        { key: 'isHistorical', label: text('标记为重要历史事件', 'Mark as a historical event'), kind: 'switch', placeholder: text('只影响分类，不改动故事范围或排序', 'Classification only; story range and ordering are untouched') },
      ]
    : []

  return (
    <SectionShell
      icon={<History size={13} />}
      title={text('重要历史事件', 'Historical events')}
      description={text(
        '历史事件复用故事时间线里的事件：世界历史页与故事时间线使用同一个事件 ID 与同一份内容，在任一侧编辑后另一侧同步更新。',
        'Historical events reuse timeline events: the world history view and the story timeline share one event ID and one record, so edits on either side show up on the other.',
      )}
      actions={<Button size="sm" variant="outline" onClick={() => openStoryTimeline()}><History size={13} />{text('打开故事时间线', 'Open story timeline')}</Button>}
      testId="world-events"
    >
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <input
          className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px]"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={text('搜索历史事件', 'Search historical events')}
          aria-label={text('搜索历史事件', 'Search historical events')}
        />
        <LinkEventControl
          unlinkedEvents={unlinkedEvents}
          onLink={eventId => void saveEventLinks(
            eventId,
            [...(data.eventWorlds.filter(row => row.eventId === eventId).map(row => row.worldId)), worldId],
            data.eventLinks.filter(link => link.eventId === eventId),
            projectKey,
          )}
        />
      </div>

      {linkedEvents.length === 0 ? (
        <p className="mt-2">
          <EmptyHint>{text('这个世界还没有关联历史事件。可以用上面的下拉把已有事件关联过来，或先到故事时间线创建。', 'No historical events linked to this world yet. Link an existing one above, or create it in the story timeline first.')}</EmptyHint>
        </p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {visible.map(event => {
            const links = data.eventLinks.filter(link => link.eventId === event.id)
            const sharedWorlds = data.eventWorlds.filter(row => row.eventId === event.id)
            return (
              <li key={event.id} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-event-${event.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--color-text)]">
                      {event.title}
                      <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
                        {event.timeLabel} · {text(STORY_TIMELINE_PRECISION_LABELS[event.precision].zh, STORY_TIMELINE_PRECISION_LABELS[event.precision].en)}
                        {' · '}{text(STORY_TIMELINE_STATUS_LABELS[event.status].zh, STORY_TIMELINE_STATUS_LABELS[event.status].en)}
                        {event.isHistorical ? ` · ${text('历史事件', 'historical')}` : ''}
                      </span>
                    </p>
                    {event.description && <p className="line-clamp-3 whitespace-pre-wrap text-[11px] text-[var(--color-text-muted)]">{event.description}</p>}
                    {event.outcome && <p className="text-[11px] text-[var(--color-text-muted)]">{text('结果：', 'Outcome: ')}{event.outcome}</p>}
                    {event.aftermath && <p className="text-[11px] text-[var(--color-text-muted)]">{text('后续影响：', 'Aftermath: ')}{event.aftermath}</p>}
                  </div>
                  <span className="flex flex-shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(event.id) }} title={text('编辑事件与世界关联', 'Edit event and its links')}>✎</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void saveEventLinks(
                        event.id,
                        sharedWorlds.filter(row => row.worldId !== worldId).map(row => row.worldId),
                        links,
                        projectKey,
                      )}
                      title={text('解除与前世界的关联（事件本身保留）', 'Unlink from this world (the event is kept)')}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </span>
                </div>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {text('关联世界：', 'Linked worlds: ')}
                  {sharedWorlds.map(row => data.worlds.find(world => world.id === row.worldId)?.name ?? row.worldId).join('、')}
                </p>
                {links.length > 0 && (
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {text('关联实体：', 'Linked records: ')}
                    {links.map(link => `${text(WORLD_EVENT_TARGET_KIND_LABELS[link.targetKind].zh, WORLD_EVENT_TARGET_KIND_LABELS[link.targetKind].en)} ${entityLabel(link, data)}`).join('、')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {current && (
        <EntityFormDialog
          open
          title={text('编辑历史事件', 'Edit historical event')}
          description={text('这里编辑的是故事时间线里的同一条事件。', 'This is the same event record as in the story timeline.')}
          fields={fields}
          initialValues={{
            title: current.title,
            timeLabel: current.timeLabel,
            precision: current.precision,
            rangeEndLabel: current.rangeEndLabel ?? '',
            sortOrder: String(current.sortOrder),
            description: current.description,
            outcome: current.outcome ?? '',
            aftermath: current.aftermath ?? '',
            chapterNumbers: current.chapterNumbers.join(', '),
            isHistorical: current.isHistorical ?? false,
          }}
          saving={saving}
          errorText={error}
          onClose={() => setEditing(null)}
          onSubmit={async values => {
            setSaving(true)
            setError(null)
            const linkedWorldIds = data.eventWorlds.filter(row => row.eventId === current.id).map(row => row.worldId)
            const worldIds = linkedWorldIds.includes(worldId) ? linkedWorldIds : [...linkedWorldIds, worldId]
            try {
              const savedEvent = await useStoryTimelineStore.getState().upsertEvent({
                ...current,
                title: fieldValue(values, 'title'),
                timeLabel: fieldValue(values, 'timeLabel'),
                precision: fieldValue(values, 'precision') as typeof current.precision,
                rangeEndLabel: fieldValue(values, 'rangeEndLabel') || undefined,
                sortOrder: Number(fieldValue(values, 'sortOrder') || '0'),
                description: fieldValue(values, 'description'),
                outcome: fieldValue(values, 'outcome'),
                aftermath: fieldValue(values, 'aftermath'),
                chapterNumbers: fieldValue(values, 'chapterNumbers')
                  .split(',')
                  .map(value => Number(value.trim()))
                  .filter(value => Number.isInteger(value) && value > 0),
                isHistorical: values.isHistorical === true,
              })
              await saveEventLinks(current.id, worldIds, data.eventLinks.filter(link => link.eventId === current.id), projectKey)
              if (!savedEvent) setError(text('保存事件失败', 'Saving the event failed'))
              else setEditing(null)
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setSaving(false)
            }
          }}
        />
      )}

      {current && (
        <SectionShell
          icon={<Link2 size={13} />}
          title={text('事件关联的实体', 'Records linked to this event')}
          description={text('关联地点、势力、秘境、人物与通道。人物与事件可以跨世界。', 'Link places, factions, relics, characters, and portals. Characters and events may span worlds.')}
        >
          <EventLinkEditor
            projectKey={projectKey}
            worldId={worldId}
            eventId={current.id}
            currentLinks={currentLinks}
            onSave={links => void saveEventLinks(current.id, data.eventWorlds.filter(row => row.eventId === current.id).map(row => row.worldId), links, projectKey)}
            onRemove={linkId => void deleteRelation('world_event_links', linkId, projectKey)}
          />
        </SectionShell>
      )}
    </SectionShell>
  )
}

function entityLabel(link: WorldEventLink, data: ReturnType<typeof useWorldWorkbenchStore.getState>['data']): string {
  switch (link.targetKind) {
    case 'faction':
      return data.factions.find(item => item.id === link.targetId)?.name ?? link.targetId
    case 'relic':
      return data.relics.find(item => item.id === link.targetId)?.name ?? link.targetId
    case 'portal':
      return data.portals.find(item => item.id === link.targetId)?.name ?? link.targetId
    case 'rule':
      return data.rules.find(item => item.id === link.targetId)?.name ?? link.targetId
    case 'character':
      return data.characterRefs.find(ref => ref.id === link.targetId)?.name ?? link.targetId
    default:
      return link.targetId
  }
}

function LinkEventControl({
  unlinkedEvents, onLink,
}: {
  unlinkedEvents: Array<{ id: string; title: string }>
  onLink: (eventId: string) => void
}) {
  const text = useLocaleStore(s => s.text)
  const [value, setValue] = useState('')
  return (
    <span className="flex items-center gap-1">
      <select
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-[11px]"
        value={value}
        onChange={event => setValue(event.target.value)}
        aria-label={text('选择要关联的事件', 'Choose an event to link')}
      >
        <option value="">{text('关联已有事件…', 'Link an existing event…')}</option>
        {unlinkedEvents.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}
      </select>
      <Button size="sm" disabled={!value} onClick={() => { onLink(value); setValue('') }}>
        <Plus size={12} />{text('关联', 'Link')}
      </Button>
    </span>
  )
}

function EventLinkEditor({
  projectKey, worldId, eventId, currentLinks, onSave, onRemove,
}: {
  projectKey: string
  worldId: string
  eventId: string
  currentLinks: WorldEventLink[]
  onSave: (links: WorldEventLink[]) => void
  onRemove: (linkId: string) => void
}) {
  void projectKey
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const [kind, setKind] = useState<WorldEventTargetKind>('character')
  const [targetId, setTargetId] = useState('')
  const [relation, setRelation] = useState('')

  const options: FormFieldValues = useMemo(() => {
    switch (kind) {
      case 'faction':
        return data.factions.filter(item => item.worldId === worldId).map(item => ({ value: item.id, label: item.name }))
      case 'relic':
        return data.relics.filter(item => item.worldId === worldId).map(item => ({ value: item.id, label: item.name }))
      case 'portal':
        return data.portals
          .filter(portal => portal.fromWorldId === worldId || portal.toWorldId === worldId)
          .map(portal => ({ value: portal.id, label: portal.name }))
      case 'rule':
        return data.rules.filter(item => item.worldId === worldId).map(item => ({ value: item.id, label: item.name }))
      case 'character':
        return data.characterRefs.map(ref => ({ value: ref.id, label: ref.name }))
      default:
        return []
    }
  }, [kind, data, worldId])

  return (
    <div className="space-y-2 text-[11px]">
      <ul className="space-y-1 text-xs">
        {currentLinks.map(link => (
          <li key={link.id} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1">
            <span className="truncate">
              {text(WORLD_EVENT_TARGET_KIND_LABELS[link.targetKind].zh, WORLD_EVENT_TARGET_KIND_LABELS[link.targetKind].en)}
              {' '}{entityLabel(link, data)}
              {link.relation ? `（${link.relation}）` : ''}
            </span>
            <button type="button" onClick={() => onRemove(link.id)} title={text('解除关联（不删除目标实体）', 'Unlink (the target is kept)')}>×</button>
          </li>
        ))}
        {currentLinks.length === 0 && <li><EmptyHint>{text('还没有关联实体。', 'No linked records yet.')}</EmptyHint></li>}
      </ul>
      <div className="flex flex-wrap items-center gap-1">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
          value={kind}
          onChange={event => { setKind(event.target.value as WorldEventTargetKind); setTargetId('') }}
          aria-label={text('关联种类', 'Link kind')}
        >
          {WORLD_EVENT_TARGET_KINDS.filter(value => value !== 'node').map(value => (
            <option key={value} value={value}>{text(WORLD_EVENT_TARGET_KIND_LABELS[value].zh, WORLD_EVENT_TARGET_KIND_LABELS[value].en)}</option>
          ))}
        </select>
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
          value={targetId}
          onChange={event => setTargetId(event.target.value)}
          aria-label={text('关联目标', 'Link target')}
        >
          <option value="">{text('选择目标…', 'Choose target…')}</option>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input
          className="w-28 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
          value={relation}
          onChange={event => setRelation(event.target.value)}
          placeholder={text('关系说明', 'Relation')}
          aria-label={text('关系说明', 'Relation')}
        />
        <Button
          size="sm"
          disabled={!targetId}
          onClick={() => {
            onSave([...currentLinks, {
              id: '',
              eventId,
              targetKind: kind,
              targetId,
              worldId: kind === 'character' ? worldId : null,
              relation,
              note: '',
            }])
            setTargetId('')
            setRelation('')
          }}
        >
          <Plus size={12} />{text('关联', 'Link')}
        </Button>
      </div>
      {void withUnset}
    </div>
  )
}

type FormFieldValues = Array<{ value: string; label: string }>
