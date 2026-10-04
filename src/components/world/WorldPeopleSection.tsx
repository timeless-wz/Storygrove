/**
 * 世界人物分区：世界人物关联、出生地与目前所在地、人物行踪。
 *
 * 位置一致性：
 * - 出生地是纯背景信息，与目前所在地互不覆盖。
 * - 结构化目前所在地是 characters.cs_location 的扩展，必须通过角色名单的
 *   同一业务提交写入；这里只发起那次提交，不另存一份位置文字。
 * - 绑定失效（角色页或定稿后处理改了位置）时明确显示「需要重新确认」，
 *   绝不把旧地图地点继续当作当前有效位置。
 */
import { useMemo, useState } from 'react'
import { Footprints, MapPin, Plus, Trash2, Users } from 'lucide-react'

import type { StoryTimelinePrecision } from '../../shared/story-timeline'
import { STORY_TIMELINE_PRECISION_LABELS } from '../../shared/story-timeline'
import type { WorldCharacterLocation, WorldCharacterTrail } from '../../shared/world-workbench'
import { useLocaleStore } from '../../stores/locale-store'
import { membersOfWorld, useWorldWorkbenchStore } from '../../stores/world-workbench-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import { Button } from '../ui/Button'
import { EntityFormDialog, withUnset, type FormFieldOption, type FormFieldSpec, type FormValues } from './world-forms'
import { fieldValue } from './world-forms'
import { DeletePlanDialog, EmptyHint, SectionShell } from './WorldWorkbenchView'
import { openCharacterEditor } from './world-navigation'

export default function WorldPeopleSection({
  projectKey, worldId, trailsOnly = false,
}: {
  projectKey: string
  worldId: string
  trailsOnly?: boolean
}) {
  return trailsOnly
    ? <TrailPanel projectKey={projectKey} worldId={worldId} />
    : (
      <div className="space-y-3">
        <WorldCharacterPanel projectKey={projectKey} worldId={worldId} />
        <TrailPanel projectKey={projectKey} worldId={worldId} />
      </div>
    )
}

function WorldCharacterPanel({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveCharacterLink = useWorldWorkbenchStore(s => s.saveCharacterLink)
  const deleteRelation = useWorldWorkbenchStore(s => s.deleteRelation)
  const saveBirthLocation = useWorldWorkbenchStore(s => s.saveBirthLocation)
  const commitCurrentLocation = useWorldWorkbenchStore(s => s.commitCurrentLocation)
  const clearCurrentLocation = useWorldWorkbenchStore(s => s.clearCurrentLocation)

  const nodes = useWorldMapStore(s => s.nodes)
  const members = membersOfWorld(data, worldId)
  const nodeOptions = useNodeOptions(worldId, data.mapWorldLinks)
  const worldOptions: FormFieldOption[] = data.worlds.map(world => ({ value: world.id, label: world.name }))
  const nodeName = (id: string | null) => (id ? nodes.find(node => node.id === id)?.name ?? id : '')
  const worldName = (id: string | null) => (id ? data.worlds.find(world => world.id === id)?.name ?? id : '')

  const [search, setSearch] = useState('')
  const [linkCharacter, setLinkCharacter] = useState('')
  const [linkRelation, setLinkRelation] = useState('居住于此')
  const [locationEditor, setLocationEditor] = useState<{ characterId: string; kind: 'birth' | 'current' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return members
    const byName = new Map(data.characterRefs.map(ref => [ref.id, ref.name]))
    return members.filter(member => (byName.get(member.characterId) ?? '').toLocaleLowerCase('zh-CN').includes(keyword))
  }, [members, data.characterRefs, search])

  const linkedIds = new Set(members.map(member => member.characterId))

  return (
    <SectionShell
      icon={<Users size={13} />}
      title={text('人物', 'Characters')}
      description={text(
        '人物来自项目已有的角色资料，通过稳定人物 ID 关联；同一个人物可以出现在多个世界里。人物改名后关联依然有效。',
        'Characters come from the existing project roster and link through stable character IDs; the same character can appear in several worlds and survives renames.',
      )}
      actions={undefined}
      testId="world-characters"
    >
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <input
          className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px]"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={text('搜索人物', 'Search characters')}
          aria-label={text('搜索人物', 'Search characters')}
        />
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-[11px]"
          value={linkCharacter}
          onChange={event => setLinkCharacter(event.target.value)}
          aria-label={text('选择项目角色', 'Choose a project character')}
        >
          <option value="">{text('关联已有角色…', 'Link an existing character…')}</option>
          {data.characterRefs.filter(ref => !linkedIds.has(ref.id)).map(ref => (
            <option key={ref.id} value={ref.id}>{ref.name}</option>
          ))}
        </select>
        <input
          className="w-28 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px]"
          value={linkRelation}
          onChange={event => setLinkRelation(event.target.value)}
          placeholder={text('关系说明', 'Relation')}
          aria-label={text('世界内关系说明', 'Relation in this world')}
        />
        <Button
          size="sm"
          disabled={!linkCharacter}
          onClick={() => void saveCharacterLink({
            id: '', worldId, characterId: linkCharacter, relation: linkRelation, note: '',
          }, projectKey).then(ok => { if (ok) setLinkCharacter('') })}
        >
          <Plus size={12} />{text('关联', 'Link')}
        </Button>
      </div>

      {data.characterRefs.length === 0 && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {text('这个项目还没有角色资料。先到「角色管理」建立角色。', 'This project has no characters yet. Create them in Character management first.')}
        </p>
      )}

      {members.length === 0 ? (
        <div className="mt-2"><EmptyHint>{text('这个世界还没有关联人物。', 'No characters linked to this world yet.')}</EmptyHint></div>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {visible.map(member => {
            const ref = data.characterRefs.find(item => item.id === member.characterId)
            const view = data.characterLocationViews.find(item => item.characterId === member.characterId)
            return (
              <li key={member.characterId} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-character-${member.characterId}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="font-medium text-[var(--color-accent)]"
                      onClick={() => openCharacterEditor()}
                      title={text('打开角色管理查看完整角色资料', 'Open character management for the full profile')}
                    >
                      {ref?.name ?? member.characterId}
                    </button>
                    {member.relation && <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">{member.relation}</span>}
                    {/* 来源区别可见：显式关联 / 出生地 / 目前所在地。 */}
                    <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
                      {member.linkId ? text('已关联', 'Linked') : ''}
                      {member.viaBirth ? text(' · 出生于本世界', ' · born here') : ''}
                      {member.viaCurrent ? text(' · 目前在本世界', ' · currently here') : ''}
                    </span>
                  </div>
                  <span className="flex flex-shrink-0 gap-1">
                    {member.linkId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void deleteRelation('world_character_links', member.linkId as string, projectKey)}
                        title={text('解除世界关联（不删除项目角色，也不改动出生地与当前位置）', 'Unlink from this world (the character and their locations are kept)')}
                      >
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </span>
                </div>

                <div className="mt-1 space-y-0.5 text-[11px] text-[var(--color-text-muted)]">
                  <p>
                    {text('出生地：', 'Birth place: ')}
                    {view?.birth?.worldId || view?.birth?.note
                      ? `${worldName(view.birth?.worldId ?? null)}${view.birth?.nodeId ? ` · ${nodeName(view.birth.nodeId)}` : ''}${view.birth?.note ? `（${view.birth.note}）` : ''}`
                      : text('未设定', 'Not set')}
                    <button type="button" className="ml-1 text-[var(--color-accent)]" onClick={() => setLocationEditor({ characterId: member.characterId, kind: 'birth' })}>
                      {text('编辑', 'Edit')}
                    </button>
                  </p>
                  <p>
                    {text('目前所在地：', 'Current location: ')}
                    {view?.currentState === 'bound'
                      ? `${worldName(view.current?.worldId ?? null)}${view.current?.nodeId ? ` · ${nodeName(view.current.nodeId)}` : ''}${view.current?.storyTimeLabel ? `（${view.current.storyTimeLabel}）` : ''}`
                      : view?.currentState === 'stale'
                        ? text('需要重新确认（角色位置已被其它操作改动）', 'Needs re-confirming (the location changed elsewhere)')
                        : text('未设定', 'Not set')}
                    {view?.locationText && (
                      <span className="ml-1">
                        {text(`· 位置文字「${view.locationText}」（来源 ${provenanceLabel(view.locationProvenanceKind, text)}）`, ` · location text “${view.locationText}” (source: ${provenanceLabel(view.locationProvenanceKind, text)})`)}
                      </span>
                    )}
                    <button type="button" className="ml-1 text-[var(--color-accent)]" onClick={() => setLocationEditor({ characterId: member.characterId, kind: 'current' })}>
                      {text('编辑', 'Edit')}
                    </button>
                    {view?.currentState === 'bound' && (
                      <button
                        type="button"
                        className="ml-1 text-[var(--color-text-secondary)]"
                        onClick={() => void clearCurrentLocation(member.characterId, projectKey)}
                        title={text('解除结构化绑定；位置文字原样保留', 'Detach the structured binding; the location text is kept')}
                      >
                        {text('解除绑定', 'Detach')}
                      </button>
                    )}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {locationEditor && (
        <LocationDialog
          projectKey={projectKey}
          worldId={worldId}
          characterId={locationEditor.characterId}
          kind={locationEditor.kind}
          worldOptions={worldOptions}
          nodeOptionsForWorld={selectedWorldId => (selectedWorldId === worldId
            ? nodeOptions
            : [])}
          saving={saving}
          errorText={error}
          onClose={() => { setLocationEditor(null); setError(null) }}
          onSubmit={async values => {
            setSaving(true)
            setError(null)
            if (locationEditor.kind === 'birth') {
              const ok = await saveBirthLocation({
                id: '',
                characterId: locationEditor.characterId,
                kind: 'birth',
                worldId: fieldValue(values, 'worldId') || null,
                nodeId: fieldValue(values, 'nodeId') || null,
                note: fieldValue(values, 'note'),
                storyTimeLabel: '', timePrecision: 'unknown', chapterNumber: null,
                boundLocationText: '', boundProvenanceKind: '', boundAt: '',
              } as WorldCharacterLocation, projectKey)
              setSaving(false)
              if (ok) setLocationEditor(null)
              return
            }
            const result = await commitCurrentLocation(
              locationEditor.characterId,
              fieldValue(values, 'worldId') || null,
              fieldValue(values, 'nodeId') || null,
              {
                storyTimeLabel: fieldValue(values, 'storyTimeLabel'),
                timePrecision: fieldValue(values, 'timePrecision') as StoryTimelinePrecision,
                chapterNumber: fieldValue(values, 'chapterNumber') ? Number(fieldValue(values, 'chapterNumber')) : null,
                locationText: fieldValue(values, 'locationText') || undefined,
              },
              projectKey,
            )
            setSaving(false)
            if (result.ok) setLocationEditor(null)
            else setError(result.error ?? text('保存失败', 'Save failed'))
          }}
        />
      )}
    </SectionShell>
  )
}

function provenanceLabel(kind: string, text: (zh: string, en: string) => string): string {
  if (kind === 'author') return text('作者确认', 'author-confirmed')
  if (kind === 'derived') return text('定稿派生', 'derived from a finalized chapter')
  if (kind === 'legacy') return text('旧值（来源未知）', 'legacy value (unknown source)')
  return text('未标注', 'unmarked')
}

function LocationDialog({
  projectKey, worldId, characterId, kind, worldOptions, nodeOptionsForWorld, saving, errorText, onClose, onSubmit,
}: {
  projectKey: string
  worldId: string
  characterId: string
  kind: 'birth' | 'current'
  worldOptions: FormFieldOption[]
  nodeOptionsForWorld: (worldId: string) => FormFieldOption[]
  saving: boolean
  errorText: string | null
  onClose: () => void
  onSubmit: (values: FormValues) => void | Promise<void>
}) {
  void projectKey
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const view = data.characterLocationViews.find(item => item.characterId === characterId)
  const existing = kind === 'birth' ? view?.birth ?? null : view?.current ?? null
  const unsetLabel = text('未设定', 'Not set')

  const fields: FormFieldSpec[] = kind === 'birth'
    ? [
        { key: 'worldId', label: text('世界', 'World'), kind: 'select', options: withUnset(worldOptions, unsetLabel) },
        { key: 'nodeId', label: text('地图地点', 'Map place'), kind: 'select', options: values => withUnset(nodeOptionsForWorld(fieldValue(values, 'worldId')), text('未设定', 'Not set')) },
        { key: 'note', label: text('补充说明', 'Note'), kind: 'textarea' },
      ]
    : [
        { key: 'worldId', label: text('世界', 'World'), kind: 'select', options: withUnset(worldOptions, unsetLabel) },
        { key: 'nodeId', label: text('地图地点', 'Map place'), kind: 'select', options: values => withUnset(nodeOptionsForWorld(fieldValue(values, 'worldId')), text('未设定', 'Not set')) },
        {
          key: 'locationText',
          label: text('位置文字（留空则按世界与地点生成）', 'Location text (blank = generated from world and place)'),
          kind: 'text',
          hint: text('位置文字会写入角色资料，并标记为作者确认。', 'The text is written into the character record and marked as author-confirmed.'),
        },
        { key: 'storyTimeLabel', label: text('剧情时间', 'Story time'), kind: 'text', placeholder: text('例如：大荒历 317 年冬', 'For example: 317th year of the Great Desolation, winter') },
        {
          key: 'timePrecision',
          label: text('时间精度', 'Time precision'),
          kind: 'select',
          options: (['exact', 'range', 'relative', 'unknown'] as StoryTimelinePrecision[]).map(value => ({
            value,
            label: text(STORY_TIMELINE_PRECISION_LABELS[value].zh, STORY_TIMELINE_PRECISION_LABELS[value].en),
          })),
        },
        { key: 'chapterNumber', label: text('关联章节（可留空）', 'Chapter (optional)'), kind: 'number' },
      ]

  return (
    <EntityFormDialog
      open
      title={kind === 'birth' ? text('编辑出生地', 'Edit birth place') : text('设置目前所在地', 'Set current location')}
      description={kind === 'birth'
        ? text('出生地是可编辑的背景信息，与目前所在地互不覆盖。', 'The birth place is editable background and never overrides the current location.')
        : text('目前所在地与角色资料中的位置是同一份事实：保存会同时更新角色位置并标记为作者确认。', 'The current location is the same fact as the character record’s location: saving updates both and marks it author-confirmed.')}
      fields={fields}
      initialValues={{
        worldId: existing?.worldId ?? worldId,
        nodeId: existing?.nodeId ?? '',
        note: existing?.note ?? '',
        locationText: '',
        storyTimeLabel: kind === 'current' ? existing?.storyTimeLabel ?? '' : '',
        timePrecision: kind === 'current' ? existing?.timePrecision ?? 'unknown' : 'unknown',
        chapterNumber: kind === 'current' && existing?.chapterNumber ? String(existing.chapterNumber) : '',
      }}
      saving={saving}
      errorText={errorText}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}

function TrailPanel({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const commitTrail = useWorldWorkbenchStore(s => s.commitTrail)
  const deleteTrail = useWorldWorkbenchStore(s => s.deleteTrail)
  const planDeleteFor = useWorldWorkbenchStore(s => s.planDeleteFor)

  const nodes = useWorldMapStore(s => s.nodes)
  const trails = data.trails.filter(trail => trail.worldId === worldId)
  const nodeOptions = useNodeOptions(worldId, data.mapWorldLinks)
  const portalsHere = data.portals.filter(portal => portal.fromWorldId === worldId || portal.toWorldId === worldId)
  const eventsHere = data.eventWorlds.filter(row => row.worldId === worldId)

  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof planDeleteFor>> | null>(null)
  const [releaseBinding, setReleaseBinding] = useState(false)

  const current = typeof editing === 'string' && editing !== 'new'
    ? data.trails.find(item => item.id === editing) ?? null
    : null
  const characterName = (id: string) => data.characterRefs.find(ref => ref.id === id)?.name ?? id
  const nodeName = (id: string | null) => (id ? nodes.find(node => node.id === id)?.name ?? id : '')

  const fields: FormFieldSpec[] = [
    { key: 'characterId', label: text('人物', 'Character'), kind: 'select', options: data.characterRefs.map(ref => ({ value: ref.id, label: ref.name })) },
    { key: 'worldId', label: text('所在世界', 'World'), kind: 'select', options: data.worlds.map(world => ({ value: world.id, label: world.name })) },
    { key: 'nodeId', label: text('地图地点', 'Map place'), kind: 'select', options: withUnset(nodeOptions, text('未设定', 'Not set')) },
    { key: 'note', label: text('位置说明', 'Place note'), kind: 'textarea' },
    { key: 'arrivedLabel', label: text('到达时间', 'Arrival'), kind: 'text' },
    { key: 'departedLabel', label: text('离开时间', 'Departure'), kind: 'text' },
    {
      key: 'timePrecision',
      label: text('时间精度', 'Time precision'),
      kind: 'select',
      options: (['exact', 'range', 'relative', 'unknown'] as StoryTimelinePrecision[]).map(value => ({
        value,
        label: text(STORY_TIMELINE_PRECISION_LABELS[value].zh, STORY_TIMELINE_PRECISION_LABELS[value].en),
      })),
      hint: text(
        '只有到达与离开都是纯数字刻度时才校验先后顺序；虚构纪年、相对时间与未知时间可以原样保存。',
        'Order is only checked when both labels are plain numeric ticks; fictional eras, relative time, and unknown time are stored as written.',
      ),
    },
    { key: 'sortOrder', label: text('排序刻度', 'Order tick'), kind: 'number', hint: text('独立刻度，只用于列表排序，不会用来推断当前位置。', 'An independent tick used only for ordering; it never infers the current location.') },
    { key: 'reason', label: text('行动原因', 'Reason'), kind: 'textarea' },
    { key: 'chapterNumber', label: text('关联章节（可留空）', 'Chapter (optional)'), kind: 'number' },
    { key: 'portalId', label: text('经过的通道', 'Portal used'), kind: 'select', options: withUnset(portalsHere.map(portal => ({ value: portal.id, label: portal.name })), text('未设定', 'Not set')) },
    { key: 'eventId', label: text('参与事件', 'Related event'), kind: 'select', options: withUnset(eventsHere.map(row => ({ value: row.eventId, label: row.eventId })), text('未设定', 'Not set')) },
    { key: 'notes', label: text('备注', 'Notes'), kind: 'textarea' },
    {
      key: 'alsoSetCurrentLocation',
      label: text('同时设为目前所在地', 'Also set as current location'),
      kind: 'switch',
      placeholder: text('默认不改变目前所在地', 'Off by default; the current location stays unchanged'),
      hint: text('勾选后，行踪与位置更新在同一个事务里成功或一起回滚。', 'When on, the trail and the location update succeed or roll back together in one transaction.'),
    },
  ]

  return (
    <SectionShell
      icon={<Footprints size={13} />}
      title={text('人物行踪', 'Character trails')}
      description={text(
        '记录谁在什么时候到过哪里。补录行踪默认不改变目前所在地；只有显式勾选才会同步更新。排序刻度与创建时间都不会被用来推断当前位置。',
        'Records who went where and when. Recording a trail never changes the current location unless you explicitly ask for it; neither creation time nor the order tick is used to infer the current location.',
      )}
      actions={<Button size="sm" onClick={() => { setError(null); setEditing('new') }}><Plus size={13} />{text('补录行踪', 'New trail')}</Button>}
      testId="world-trails"
    >
      {trails.length === 0 ? (
        <EmptyHint>{text('还没有行踪记录。', 'No trails recorded yet.')}</EmptyHint>
      ) : (
        <ul className="space-y-1 text-xs">
          {trails.map(trail => {
            const binding = useWorldWorkbenchStore.getState().data.trails.find(item => item.id === trail.id)
            void binding
            return (
              <li key={trail.id} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-trail-${trail.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0">
                    <span className="font-medium text-[var(--color-text)]">{characterName(trail.characterId)}</span>
                    <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
                      <MapPin size={11} className="inline" /> {nodeName(trail.nodeId) || text('未设定地点', 'No place')}
                      {trail.arrivedLabel ? ` · ${text('到达 ', 'from ')}${trail.arrivedLabel}` : ''}
                      {trail.departedLabel ? ` · ${text('离开 ', 'to ')}${trail.departedLabel}` : ''}
                    </span>
                  </p>
                  <span className="flex flex-shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setEditing(trail.id) }} title={text('编辑行踪', 'Edit trail')}>✎</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setReleaseBinding(false); void planDeleteFor('trail', trail.id).then(setPlan) }}
                      title={text('删除行踪', 'Delete trail')}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </span>
                </div>
                {trail.reason && <p className="text-[11px] text-[var(--color-text-muted)]">{text('原因：', 'Reason: ')}{trail.reason}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {editing !== null && (
        <EntityFormDialog
          open
          title={current ? text('编辑行踪', 'Edit trail') : text('补录行踪', 'New trail')}
          fields={fields}
          initialValues={{
            characterId: current?.characterId ?? data.characterRefs[0]?.id ?? '',
            worldId: current?.worldId ?? worldId,
            nodeId: current?.nodeId ?? '',
            note: current?.note ?? '',
            arrivedLabel: current?.arrivedLabel ?? '',
            departedLabel: current?.departedLabel ?? '',
            timePrecision: current?.timePrecision ?? 'unknown',
            sortOrder: String(current?.sortOrder ?? 0),
            reason: current?.reason ?? '',
            chapterNumber: current?.chapterNumber ? String(current.chapterNumber) : '',
            portalId: current?.portalId ?? '',
            eventId: current?.eventId ?? '',
            notes: current?.notes ?? '',
            alsoSetCurrentLocation: false,
          }}
          saving={saving}
          errorText={error}
          onClose={() => setEditing(null)}
          onSubmit={async values => {
            setSaving(true)
            setError(null)
            const trail: WorldCharacterTrail = {
              id: current?.id ?? '',
              characterId: fieldValue(values, 'characterId'),
              worldId: fieldValue(values, 'worldId'),
              nodeId: fieldValue(values, 'nodeId') || null,
              note: fieldValue(values, 'note'),
              arrivedLabel: fieldValue(values, 'arrivedLabel'),
              departedLabel: fieldValue(values, 'departedLabel'),
              timePrecision: fieldValue(values, 'timePrecision') as StoryTimelinePrecision,
              sortOrder: Number(fieldValue(values, 'sortOrder') || '0'),
              reason: fieldValue(values, 'reason'),
              chapterNumber: fieldValue(values, 'chapterNumber') ? Number(fieldValue(values, 'chapterNumber')) : null,
              notes: fieldValue(values, 'notes'),
              portalId: fieldValue(values, 'portalId') || null,
              eventId: fieldValue(values, 'eventId') || null,
            }
            const ok = await commitTrail({
              trail,
              alsoSetCurrentLocation: values.alsoSetCurrentLocation === true,
            }, projectKey)
            setSaving(false)
            if (ok) setEditing(null)
            else setError(text('保存失败，请检查人物、世界、地点与通道是否匹配。', 'Save failed. Check that the character, world, place, and portal match.'))
          }}
        />
      )}

      <DeletePlanDialog
        plan={plan}
        onClose={() => setPlan(null)}
        onConfirm={() => { const id = plan?.entityId; if (id) void deleteTrail(id, releaseBinding, projectKey) }}
        confirmLabel={releaseBinding ? text('解除绑定并删除', 'Detach and delete') : undefined}
      />
      {plan && plan.blockers.some(blocker => blocker.kind === 'current-location-binding') && (
        <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
          <input type="checkbox" checked={releaseBinding} onChange={event => setReleaseBinding(event.target.checked)} />
          {text('这条行踪被设为目前所在地：确认解除绑定并删除（位置文字保留，需要重新确认）', 'This trail backs the current location: confirm detaching it and deleting (the location text is kept and needs re-confirming)')}
        </label>
      )}
    </SectionShell>
  )
}

/** 世界内的地图地点选项；只列出属于该世界的地图里的地点。 */
function useNodeOptions(worldId: string, mapWorldLinks: Array<{ mapId: string; worldId: string }>): FormFieldOption[] {
  const nodes = useWorldMapStore(s => s.nodes)
  const maps = useWorldMapStore(s => s.maps)
  return useMemo(() => {
    const mapIds = new Set(mapWorldLinks.filter(link => link.worldId === worldId).map(link => link.mapId))
    const mapNameById = new Map(maps.map(map => [map.id, map.name]))
    return nodes
      .filter(node => mapIds.has(node.mapId))
      .map(node => ({ value: node.id, label: `${mapNameById.get(node.mapId) ?? node.mapId} / ${node.name}` }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [worldId, mapWorldLinks, nodes, maps])
}
