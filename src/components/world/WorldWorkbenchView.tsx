/**
 * 世界工作台。
 *
 * 一本小说可以有多个世界，每个世界分别管理：世界介绍与背景、区域与地点、
 * 势力、秘境、人物关联、出生地与目前所在地、关联地图、世界之间的通道、
 * 世界规则、重要历史事件与人物行踪。
 *
 * 事实源是 SQLite（`.vela/vela.db`）：所有写入都通过 `db:world-*` 会话通道
 * 落到主进程仓库；界面只保留表单草稿与当前选中项，绝不并存第二份事实。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DoorOpen, Globe2, Link2, MapIcon, Pencil, Plus, ScrollText, ShieldAlert, Trash2,
} from 'lucide-react'

import type { WorldMap } from '../../shared/world-map'
import type { WorldDeletePlan } from '../../shared/world-workbench'
import { useLocaleStore } from '../../stores/locale-store'
import {
  factionsOfWorld,
  mapsOfWorld,
  membersOfWorld,
  portalsOfWorld,
  relicsOfWorld,
  rulesOfWorld,
  useWorldWorkbenchStore,
  type WorldSectionKey,
} from '../../stores/world-workbench-store'
import { useWorldMapStore } from '../../stores/world-map-store'
import {
  PlanningEmptyState, PlanningListRow, PlanningPageShell, PlanningPane, PlanningSearch,
} from '../planning/PlanningPageShell'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { EntityFormDialog, withUnset, type FormFieldOption, type FormValues } from './world-forms'
import {
  factionDefaults, factionFields, factionPayload,
  portalDefaults, portalFields, portalPayload,
  relicDefaults, relicFields, relicPayload,
  ruleDefaults, ruleFields, rulePayload,
  relationLabel, RELATION_LABEL_MAPS, RELATION_OPTIONS,
} from './world-entity-forms'
import { openCharacterEditor, openMapAt } from './world-navigation'
import WorldPeopleSection from './WorldPeopleSection'
import WorldEventsSection from './WorldEventsSection'

export default function WorldWorkbenchView({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const loading = useWorldWorkbenchStore(s => s.loading)
  const selectedWorldId = useWorldWorkbenchStore(s => s.selectedWorldId)
  const section = useWorldWorkbenchStore(s => s.section)
  const loadAll = useWorldWorkbenchStore(s => s.loadAll)
  const setSelectedWorldId = useWorldWorkbenchStore(s => s.setSelectedWorldId)
  const setSection = useWorldWorkbenchStore(s => s.setSection)

  const maps = useWorldMapStore(s => s.maps)
  const mapNodes = useWorldMapStore(s => s.nodes)
  const loadMaps = useWorldMapStore(s => s.loadAll)

  const [worldSearch, setWorldSearch] = useState('')

  useEffect(() => {
    void loadAll(projectKey)
    // 世界页按世界展示地图与地点：读的是同一份地图事实，不是副本。
    void loadMaps(projectKey)
  }, [projectKey, loadAll, loadMaps])

  const selectedWorld = data.worlds.find(world => world.id === selectedWorldId) ?? null
  const filteredWorlds = useMemo(() => {
    const keyword = worldSearch.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return data.worlds
    return data.worlds.filter(world => (
      world.name.toLocaleLowerCase('zh-CN').includes(keyword)
      || world.summary.toLocaleLowerCase('zh-CN').includes(keyword)
    ))
  }, [data.worlds, worldSearch])

  const sections: Array<{ key: WorldSectionKey; label: string; count: number }> = selectedWorld
    ? [
        { key: 'overview', label: text('概览', 'Overview'), count: 0 },
        { key: 'maps', label: text('地图与地点', 'Maps & places'), count: mapsOfWorld(data, selectedWorld.id).length },
        { key: 'factions', label: text('势力', 'Factions'), count: factionsOfWorld(data, selectedWorld.id).length },
        { key: 'relics', label: text('秘境', 'Relics'), count: relicsOfWorld(data, selectedWorld.id).length },
        { key: 'characters', label: text('人物', 'Characters'), count: membersOfWorld(data, selectedWorld.id).length },
        { key: 'portals', label: text('通道', 'Portals'), count: portalsOfWorld(data, selectedWorld.id).length },
        { key: 'rules', label: text('规则', 'Rules'), count: rulesOfWorld(data, selectedWorld.id).length },
        { key: 'events', label: text('历史事件', 'History'), count: data.eventWorlds.filter(row => row.worldId === selectedWorld.id).length },
        { key: 'trails', label: text('人物行踪', 'Trails'), count: data.trails.filter(trail => trail.worldId === selectedWorld.id).length },
      ]
    : []

  return (
    <PlanningPageShell
      breadcrumb={[{ label: text('世界', 'Worlds') }]}
      icon={<Globe2 size={15} />}
      title={text('世界', 'Worlds')}
      description={text(
        '一本小说可以有多个世界：每个世界分别管理介绍与背景、区域与地点、势力、秘境、人物关联、出生地与目前所在地、关联地图、世界之间的通道、世界规则、重要历史事件与人物行踪。资料保存在项目数据库里，可以相互关联与跳转。',
        'A novel can hold many worlds. Each world manages its introduction, places, factions, relics, character links, birth and current locations, maps, cross-world portals, rules, historical events, and character trails. All records live in the project database and can be linked and jumped between.',
      )}
      meta={text(`${data.worlds.length} 个世界`, `${data.worlds.length} worlds`)}
      actions={<WorldCreateButton projectKey={projectKey} />}
    >
      <PlanningPane
        title={text('世界列表', 'World list')}
        icon={<Globe2 size={13} />}
        filters={<PlanningSearch value={worldSearch} onChange={setWorldSearch} placeholder={text('搜索世界', 'Search worlds')} />}
      >
        {loading && data.worlds.length === 0 && (
          <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">{text('载入中…', 'Loading…')}</p>
        )}
        {!loading && data.worlds.length === 0 && (
          <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">
            {text('还没有世界。用右上角「新建世界」创建第一个。', 'No worlds yet. Use “New world” above to create the first one.')}
          </p>
        )}
        {data.worlds.length > 0 && filteredWorlds.length === 0 && (
          <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">{text('没有匹配的世界。', 'No matching worlds.')}</p>
        )}
        {filteredWorlds.map(world => (
          <PlanningListRow
            key={world.id}
            selected={world.id === selectedWorldId}
            onSelect={() => setSelectedWorldId(world.id)}
            icon={<Globe2 size={13} />}
            title={world.name}
            subtitle={world.summary || text('暂无简介', 'No summary')}
            trailing={<span className="planning-tag">{factionsOfWorld(data, world.id).length}</span>}
            testId={`world-list-row-${world.id}`}
          />
        ))}
      </PlanningPane>

      <main className="planning-page__main">
        {!selectedWorld && (
          <div className="planning-page__scroll">
            <PlanningEmptyState
              variant="card"
              icon={<Globe2 size={22} />}
              title={data.worlds.length === 0
                ? text('还没有任何世界', 'No worlds yet')
                : text('未选择世界', 'No world selected')}
              description={text(
                '世界是小说设定实体：它可以没有地图，也可以有多张地图。势力、秘境、规则与历史事件都挂在具体的世界上。',
                'A world is a setting entity: it may have no maps or many. Factions, relics, rules, and historical events belong to a specific world.',
              )}
              steps={[
                text('创建世界并填写名称与背景', 'Create a world with a name and background'),
                text('按需关联地图，地图里的地点会自动归属这个世界', 'Link maps; their places then belong to this world'),
                text('在各自分区录入势力、秘境、通道、规则与历史事件', 'Fill in factions, relics, portals, rules, and events per section'),
              ]}
              actions={<WorldCreateButton projectKey={projectKey} />}
            />
          </div>
        )}

        {selectedWorld && (
          <>
            <div className="flex h-9 flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-panel)] px-2">
              {sections.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={`planning-chip${item.key === section ? ' is-active' : ''}`}
                  aria-pressed={item.key === section}
                  onClick={() => setSection(item.key)}
                  data-testid={`world-section-${item.key}`}
                >
                  {item.label}
                  {item.count > 0 && <span className="planning-chip__count">{item.count}</span>}
                </button>
              ))}
            </div>
            <div className="planning-page__scroll">
              <div className="space-y-4 p-4">
                <WorldHeaderCard projectKey={projectKey} worldId={selectedWorld.id} />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {sections.find(item => item.key === section)?.label}
                </h2>
                {section === 'overview' && <WorldOverviewSection worldId={selectedWorld.id} maps={maps} />}
                {section === 'maps' && <WorldMapsSection projectKey={projectKey} worldId={selectedWorld.id} maps={maps} mapNodes={mapNodes} />}
                {section === 'factions' && <FactionSection projectKey={projectKey} worldId={selectedWorld.id} />}
                {section === 'relics' && <RelicSection projectKey={projectKey} worldId={selectedWorld.id} />}
                {section === 'portals' && <PortalSection projectKey={projectKey} worldId={selectedWorld.id} />}
                {section === 'rules' && <RuleSection projectKey={projectKey} worldId={selectedWorld.id} />}
                {section === 'characters' && <WorldPeopleSection projectKey={projectKey} worldId={selectedWorld.id} />}
                {section === 'events' && <WorldEventsSection projectKey={projectKey} worldId={selectedWorld.id} />}
                {section === 'trails' && <WorldPeopleSection projectKey={projectKey} worldId={selectedWorld.id} trailsOnly />}
              </div>
            </div>
          </>
        )}
      </main>
    </PlanningPageShell>
  )
}

// ============================================================
// 共用块
// ============================================================

export function SectionShell({
  icon, title, description, actions, children, testId,
}: {
  icon: React.ReactNode
  title: string
  description: string
  actions?: React.ReactNode
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-panel)]" data-testid={testId}>
      <header className="flex items-start gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <span className="mt-0.5 text-[var(--color-text-secondary)]">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-[var(--color-text)]">{title}</h3>
          <p className="text-[11px] text-[var(--color-text-muted)]">{description}</p>
        </div>
        {actions && <span className="flex flex-shrink-0 gap-1">{actions}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--color-text-muted)]">{children}</p>
}

/** 删除影响预览：blockers 非空时默认阻止，并要求先处理依赖。 */
export function DeletePlanDialog({
  plan, onClose, onConfirm, confirmLabel,
}: {
  plan: WorldDeletePlan | null
  onClose: () => void
  onConfirm: () => void
  confirmLabel?: string
}) {
  const text = useLocaleStore(s => s.text)
  if (!plan) return null
  const blocked = plan.blockers.length > 0
  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{text('删除影响预览', 'Delete impact')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {text(`即将删除「${plan.entityName}」。`, `About to delete “${plan.entityName}”.`)}
        </p>
        {blocked ? (
          <div className="space-y-2 py-2">
            <p className="text-xs text-[var(--color-warning-text,var(--color-text))]">
              {text('它仍被以下资料引用，默认不允许删除。请先解除这些依赖。', 'It is still referenced by these records and cannot be deleted yet. Release them first.')}
            </p>
            <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
              {plan.blockers.map(blocker => (
                <li key={`${blocker.kind}-${blocker.label}`} className="flex justify-between rounded border border-[var(--color-border)] px-2 py-1">
                  <span className="truncate">{blocker.label}</span>
                  <span className="planning-tag is-warning">{blocker.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="py-2 text-xs text-[var(--color-text-muted)]">
            {plan.cascadedRelationCount > 0
              ? text(
                  `没有人引用它。删除会同时清理 ${plan.cascadedRelationCount} 条属于它自己的关联；关联的人物、地图地点与历史事件都会保留。`,
                  `Nothing references it. Deleting also clears ${plan.cascadedRelationCount} of its own links; linked characters, places, and events are kept.`,
                )
              : text('没有人引用它，可以安全删除。', 'Nothing references it; it can be deleted safely.')}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>{text('关闭', 'Close')}</Button>
          <Button size="sm" variant="destructive" disabled={blocked} onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel ?? text('确认删除', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorldCreateButton({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(s => s.text)
  const saveWorld = useWorldWorkbenchStore(s => s.saveWorld)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<FormValues>({ name: '', summary: '', background: '', notes: '' })
  const [saving, setSaving] = useState(false)

  // 表单内容以对话框提交上来的值为准：父组件只负责决定保存成功后做什么。
  const submit = async (submitted: FormValues) => {
    setSaving(true)
    const saved = await saveWorld({
      name: String(submitted.name ?? ''),
      summary: String(submitted.summary ?? ''),
      background: String(submitted.background ?? ''),
      notes: String(submitted.notes ?? ''),
    }, projectKey)
    setSaving(false)
    if (saved) { setValues({ name: '', summary: '', background: '', notes: '' }); setOpen(false) }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} title={text('新建设定世界', 'Create a setting world')}>
        <Plus size={13} />{text('新建世界', 'New world')}
      </Button>
      <EntityFormDialog
        open={open}
        title={text('新建世界', 'New world')}
        fields={[
          { key: 'name', label: text('世界名称', 'World name'), kind: 'text', placeholder: text('例如：凡人界', 'For example: Mortal realm') },
          { key: 'summary', label: text('简介', 'Summary'), kind: 'text' },
          { key: 'background', label: text('详细背景', 'Background'), kind: 'textarea' },
          { key: 'notes', label: text('备注', 'Notes'), kind: 'textarea' },
        ]}
        initialValues={values}
        saving={saving}
        submitLabel={text('创建', 'Create')}
        onClose={() => setOpen(false)}
        onSubmit={submit}
      />
    </>
  )
}

function WorldHeaderCard({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveWorld = useWorldWorkbenchStore(s => s.saveWorld)
  const deleteWorld = useWorldWorkbenchStore(s => s.deleteWorld)
  const planWorldDelete = useWorldWorkbenchStore(s => s.planWorldDelete)
  const world = data.worlds.find(item => item.id === worldId)
  const [editing, setEditing] = useState(false)
  const [plan, setPlan] = useState<WorldDeletePlan | null>(null)

  if (!world) {
    return (
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
        <PlanningEmptyState
          variant="card"
          icon={<ShieldAlert size={20} />}
          title={text('这个世界不存在', 'This world no longer exists')}
          description={text('它可能已在别处被删除。请从左侧重新选择世界。', 'It may have been deleted elsewhere. Pick another world on the left.')}
        />
      </div>
    )
  }

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-[var(--color-text)]" data-testid="world-title">{world.name}</h1>
          {world.summary && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{world.summary}</p>}
        </div>
        <div className="flex flex-shrink-0 gap-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(value => !value)} title={text('编辑世界资料', 'Edit world')}>
            <Pencil size={13} />{text('编辑', 'Edit')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void planWorldDelete(worldId, projectKey).then(setPlan)}
            title={text('查看删除影响', 'Delete impact')}
          >
            <Trash2 size={13} />{text('删除', 'Delete')}
          </Button>
        </div>
      </div>

      {editing && (
        <WorldEditForm
          projectKey={projectKey}
          worldId={worldId}
          onDone={() => setEditing(false)}
          onSave={payload => void saveWorld(payload, projectKey).then(saved => { if (saved) setEditing(false) })}
        />
      )}

      <DeletePlanDialog plan={plan} onClose={() => setPlan(null)} onConfirm={() => void deleteWorld(worldId, projectKey)} />
    </div>
  )
}

function WorldEditForm({
  worldId, projectKey, onSave, onDone,
}: {
  worldId: string
  projectKey: string
  onSave: (payload: { id: string; name: string; summary: string; background: string; notes: string }) => void
  onDone: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const world = data.worlds.find(item => item.id === worldId)
  const [values, setValues] = useState<FormValues>({
    name: world?.name ?? '', summary: world?.summary ?? '', background: world?.background ?? '', notes: world?.notes ?? '',
  })

  useEffect(() => {
    setValues({
      name: world?.name ?? '', summary: world?.summary ?? '', background: world?.background ?? '', notes: world?.notes ?? '',
    })
  }, [world])

  useEffect(() => { void projectKey }, [projectKey])

  return (
    <div className="mt-3 space-y-2">
      {([
        ['name', text('名称', 'Name')],
        ['summary', text('简介', 'Summary')],
        ['background', text('详细背景', 'Background')],
        ['notes', text('备注', 'Notes')],
      ] as const).map(([key, label]) => (
        <div key={key}>
          <label className="block text-[11px] text-[var(--color-text-secondary)]" htmlFor={`world-edit-${key}`}>{label}</label>
          {key === 'name' || key === 'summary' ? (
            <input
              id={`world-edit-${key}`}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)]"
              value={String(values[key] ?? '')}
              onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))}
            />
          ) : (
            <textarea
              id={`world-edit-${key}`}
              rows={3}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)]"
              value={String(values[key] ?? '')}
              onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))}
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!String(values.name ?? '').trim()}
          onClick={() => onSave({
            id: worldId,
            name: String(values.name ?? ''),
            summary: String(values.summary ?? ''),
            background: String(values.background ?? ''),
            notes: String(values.notes ?? ''),
          })}
        >
          {text('保存', 'Save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{text('取消', 'Cancel')}</Button>
      </div>
    </div>
  )
}

// ============================================================
// 概览
// ============================================================

function WorldOverviewSection({ worldId, maps }: { worldId: string; maps: WorldMap[] }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const world = data.worlds.find(item => item.id === worldId)
  if (!world) return null
  const linkedMapIds = mapsOfWorld(data, worldId)
  const linkedMaps = linkedMapIds.map(mapId => maps.find(map => map.id === mapId)).filter(Boolean) as WorldMap[]

  return (
    <div className="space-y-3">
      <SectionShell
        icon={<Globe2 size={13} />}
        title={text('世界资料', 'World record')}
        description={text('作者手写的介绍与背景。', 'Author-written summary and background.')}
        testId="world-overview-record"
      >
        {world.summary || world.background || world.notes ? (
          <div className="space-y-2 text-xs text-[var(--color-text)]">
            {world.summary && <p><span className="text-[var(--color-text-muted)]">{text('简介：', 'Summary: ')}</span>{world.summary}</p>}
            {world.background && <p className="whitespace-pre-wrap"><span className="text-[var(--color-text-muted)]">{text('背景：', 'Background: ')}</span>{world.background}</p>}
            {world.notes && <p className="whitespace-pre-wrap"><span className="text-[var(--color-text-muted)]">{text('备注：', 'Notes: ')}</span>{world.notes}</p>}
          </div>
        ) : (
          <EmptyHint>{text('还没有填写介绍。用上方的「编辑」补充。', 'No introduction yet. Use “Edit” above.')}</EmptyHint>
        )}
      </SectionShell>

      <SectionShell
        icon={<MapIcon size={13} />}
        title={text('关联地图', 'Linked maps')}
        description={text('一个世界可以有多张地图；地图里的地点由地图归属决定世界。', 'A world can have several maps; each map’s places belong to that world.')}
      >
        {linkedMaps.length === 0 ? (
          <EmptyHint>{text('还没有关联地图。到「地图与地点」分区把地图关联到这个世界。', 'No maps linked yet. Link one in “Maps & places”.')}</EmptyHint>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {linkedMaps.map(map => (
              <li key={map.id}>
                <button
                  type="button"
                  className="planning-tag is-accent"
                  onClick={() => openMapAt(map.id, null)}
                  title={text('在地图册中打开这张地图', 'Open this map in the atlas')}
                >
                  <MapIcon size={11} /> {map.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      <SectionShell
        icon={<ShieldAlert size={13} />}
        title={text('资料规模', 'Record counts')}
        description={text('各分区当前属于这个世界的资料数量。', 'How many records belong to this world per section.')}
      >
        <ul className="flex flex-wrap gap-2 text-xs">
          {([
            [text('地图', 'Maps'), linkedMapIds.length],
            [text('势力', 'Factions'), factionsOfWorld(data, worldId).length],
            [text('秘境', 'Relics'), relicsOfWorld(data, worldId).length],
            [text('人物', 'Characters'), membersOfWorld(data, worldId).length],
            [text('通道', 'Portals'), portalsOfWorld(data, worldId).length],
            [text('规则', 'Rules'), rulesOfWorld(data, worldId).length],
            [text('历史事件', 'Events'), data.eventWorlds.filter(row => row.worldId === worldId).length],
            [text('行踪', 'Trails'), data.trails.filter(trail => trail.worldId === worldId).length],
          ] as const).map(([label, count]) => (
            <li key={label} className="rounded border border-[var(--color-border)] px-2 py-1">
              {label}：<strong>{count}</strong>
            </li>
          ))}
        </ul>
      </SectionShell>
    </div>
  )
}

// ============================================================
// 地图与地点
// ============================================================

function WorldMapsSection({
  projectKey, worldId, maps, mapNodes,
}: {
  projectKey: string
  worldId: string
  maps: WorldMap[]
  mapNodes: Array<{ id: string; name: string; mapId: string }>
}) {
  void projectKey
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const planMapAssignment = useWorldWorkbenchStore(s => s.planMapAssignment)
  const applyMapAssignment = useWorldWorkbenchStore(s => s.applyMapAssignment)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof planMapAssignment>> | null>(null)

  const linkedMapIds = new Set(mapsOfWorld(data, worldId))
  const ownedMapIds = new Set(data.mapWorldLinks.map(link => link.mapId))
  const unlinkedMaps = maps.filter(map => !ownedMapIds.has(map.id))
  const otherWorldMaps = maps.filter(map => ownedMapIds.has(map.id) && !linkedMapIds.has(map.id))

  return (
    <div className="space-y-3">
      <SectionShell
        icon={<MapIcon size={13} />}
        title={text('属于这个世界的区域与地点', 'Places in this world')}
        description={text('地点复用地图册里的地图节点；世界归属由地图归属推导，不重建同名地点。', 'Places reuse atlas nodes; world membership comes from the map, so no duplicate place facts.')}
        testId="world-maps-linked"
      >
        {linkedMapIds.size === 0 ? (
          <EmptyHint>{text('这个世界还没有地图。可以先录入势力与规则，之后再关联地图。', 'This world has no maps yet. Record factions and rules first if you like, then link maps.')}</EmptyHint>
        ) : (
          <div className="space-y-3">
            {[...linkedMapIds].map(mapId => {
              const map = maps.find(item => item.id === mapId)
              const nodes = mapNodes.filter(node => node.mapId === mapId)
              return (
                <div key={mapId} className="rounded border border-[var(--color-border)]">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-2 py-1">
                    <button
                      type="button"
                      className="truncate text-xs font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
                      onClick={() => openMapAt(mapId, null)}
                      title={text('打开这张地图', 'Open this map')}
                    >
                      {map?.name ?? mapId}
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void planMapAssignment(mapId, null, projectKey).then(setPlan)}
                      title={text('解除这张地图与世界的关联；不会删除地图或地点', 'Unlink this map; the map and its places are kept')}
                    >
                      <Link2 size={12} />{text('解除关联', 'Unlink')}
                    </Button>
                  </div>
                  {nodes.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-[var(--color-text-muted)]">
                      {text('这张地图还没有地点。到地图册里创建地点，它们会自动属于这个世界。', 'No places in this map yet. Create them in the atlas; they then belong to this world.')}
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1 px-2 py-2">
                      {nodes.map(node => (
                        <li key={node.id}>
                          <button
                            type="button"
                            className="planning-tag"
                            onClick={() => openMapAt(mapId, node.id)}
                            title={text('在地图上定位这个地点', 'Locate this place on the map')}
                          >
                            {node.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionShell>

      <SectionShell
        icon={<Link2 size={13} />}
        title={text('关联到世界', 'Link to world')}
        description={text('旧地图不会按名称推断归属；未关联的地图在这里显式关联。归属变更前先展示影响预览。', 'Legacy maps are never inferred by name. Unlinked maps are linked here explicitly, after an impact preview.')}
        testId="world-maps-unlinked"
      >
        {unlinkedMaps.length === 0 && otherWorldMaps.length === 0 ? (
          <EmptyHint>{text('没有未关联或属于其它世界的地图。', 'No unlinked maps, and none owned by another world.')}</EmptyHint>
        ) : (
          <ul className="space-y-2">
            {unlinkedMaps.map(map => (
              <li key={map.id} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                <span className="truncate text-xs">
                  {map.name}
                  <span className="ml-1 text-[11px] text-[var(--color-text-muted)]">{text('未关联世界', 'No world')}</span>
                </span>
                <span className="flex flex-shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => openMapAt(map.id, null)}>{text('打开', 'Open')}</Button>
                  <Button
                    size="sm"
                    onClick={() => void planMapAssignment(map.id, worldId, projectKey).then(setPlan)}
                    title={text('把这张地图关联到当前世界', 'Link this map to the current world')}
                  >
                    <Link2 size={12} />{text('关联到世界', 'Link')}
                  </Button>
                </span>
              </li>
            ))}
            {otherWorldMaps.map(map => {
              const ownerId = data.mapWorldLinks.find(link => link.mapId === map.id)?.worldId
              const owner = data.worlds.find(world => world.id === ownerId)
              return (
                <li key={map.id} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                  <span className="truncate text-xs">
                    {map.name}
                    <span className="ml-1 text-[11px] text-[var(--color-text-muted)]">
                      {text(`已属于「${owner?.name ?? '未知世界'}」`, `Already in “${owner?.name ?? 'unknown world'}”`)}
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => openMapAt(map.id, null)}>{text('打开', 'Open')}</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void planMapAssignment(map.id, worldId, projectKey).then(setPlan)}
                      title={text('把这地图改挂到当前世界（先预览影响）', 'Move this map to the current world (impact preview first)')}
                    >
                      {text('改挂到本世界', 'Move here')}
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </SectionShell>

      <MapAssignmentDialog plan={plan} onClose={() => setPlan(null)} onConfirm={(mapId, nextWorldId) => void applyMapAssignment(mapId, nextWorldId, projectKey)} />
    </div>
  )
}

function MapAssignmentDialog({
  plan, onClose, onConfirm,
}: {
  plan: Awaited<ReturnType<ReturnType<typeof useWorldWorkbenchStore.getState>['planMapAssignment']>> | null
  onClose: () => void
  onConfirm: (mapId: string, nextWorldId: string | null) => void
}) {
  const text = useLocaleStore(s => s.text)
  if (!plan) return null
  const blocked = plan.blockers.length > 0
  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{text('地图归属变更预览', 'Map assignment impact')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {plan.nextWorldId
            ? text('这张地图（及其子地图）会归属到当前世界。', 'This map (and its child maps) will belong to the current world.')
            : text('这张地图会解除世界归属，保持未关联。', 'This map will be unlinked from any world and stay unassigned.')}
        </p>
        {plan.descendantMapIds.length > 0 && (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {text(`会一起变更的子地图：${plan.descendantMapIds.length} 张。`, `Child maps included: ${plan.descendantMapIds.length}.`)}
          </p>
        )}
        {blocked ? (
          <div className="space-y-2 py-2">
            <p className="text-xs text-[var(--color-warning-text,var(--color-text))]">
              {text('以下资料的世界归属会与目标世界不一致，已拒绝修改。请先处理它们。', 'These records would become inconsistent with the target world, so the change is refused. Resolve them first.')}
            </p>
            <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
              {plan.blockers.map(blocker => (
                <li key={`${blocker.kind}-${blocker.label}`} className="flex justify-between rounded border border-[var(--color-border)] px-2 py-1">
                  <span className="truncate">{blocker.label}</span>
                  <span className="planning-tag is-warning">{blocker.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="py-2 text-xs text-[var(--color-text-muted)]">
            {text('没有资料会因此不一致。地图里的地点不会被搬移或删除。', 'Nothing becomes inconsistent. Places are neither moved nor deleted.')}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>{text('关闭', 'Close')}</Button>
          <Button size="sm" disabled={blocked} onClick={() => { onConfirm(plan.mapId, plan.nextWorldId); onClose() }}>
            {text('确认变更', 'Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// 势力
// ============================================================

function FactionSection({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveFaction = useWorldWorkbenchStore(s => s.saveFaction)
  const deleteFaction = useWorldWorkbenchStore(s => s.deleteFaction)
  const planDeleteFor = useWorldWorkbenchStore(s => s.planDeleteFor)
  const factions = factionsOfWorld(data, worldId)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<WorldDeletePlan | null>(null)
  const [detachEvents, setDetachEvents] = useState(false)

  const nodeOptions = useNodeOptions(worldId, data.mapWorldLinks)
  const characterOptions = data.characterRefs.map(ref => ({ value: ref.id, label: ref.name }))
  const current = typeof editing === 'string' && editing !== 'new'
    ? data.factions.find(item => item.id === editing) ?? null
    : null

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return factions
    return factions.filter(faction => faction.name.toLocaleLowerCase('zh-CN').includes(keyword))
  }, [factions, search])

  return (
    <div className="space-y-3">
      <SectionShell
        icon={<ShieldAlert size={13} />}
        title={text('势力', 'Factions')}
        description={text('势力默认只属于一个世界。跨世界的分支用不同势力记录加「分支 / 附属」关系表达。', 'A faction belongs to one world. Cross-world branches use separate records with branch/subordinate relations.')}
        actions={
          <Button size="sm" onClick={() => setEditing('new')} title={text('新建势力', 'New faction')}>
            <Plus size={13} />{text('新建势力', 'New faction')}
          </Button>
        }
        testId="world-factions"
      >
        <PlanningSearch value={search} onChange={setSearch} placeholder={text('搜索势力', 'Search factions')} />
        {visible.length === 0 ? (
          <EmptyHint>{text('这个世界还没有势力。', 'No factions in this world yet.')}</EmptyHint>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {visible.map(faction => (
              <li key={faction.id} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-faction-${faction.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--color-text)]">
                      {faction.name}{faction.type ? ` · ${faction.type}` : ''}
                    </p>
                    {faction.summary && <p className="text-[11px] text-[var(--color-text-muted)]">{faction.summary}</p>}
                  </div>
                  <span className="flex flex-shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(faction.id)} title={text('编辑势力', 'Edit faction')}><Pencil size={12} /></Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setDetachEvents(false); void planDeleteFor('faction', faction.id).then(setPlan) }}
                      title={text('删除势力', 'Delete faction')}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </span>
                </div>
                <FactionRelations
                  projectKey={projectKey}
                  worldId={worldId}
                  factionId={faction.id}
                  factions={factions}
                  nodeOptions={nodeOptions}
                  characterOptions={characterOptions}
                />
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      <EntityFormDialog
        open={editing !== null}
        title={current ? text('编辑势力', 'Edit faction') : text('新建势力', 'New faction')}
        fields={factionFields(text, nodeOptions, characterOptions)}
        initialValues={factionDefaults(current)}
        saving={saving}
        errorText={current === null && editing !== 'new' ? text('势力已不存在', 'The faction no longer exists') : null}
        onClose={() => setEditing(null)}
        onSubmit={async values => {
          setSaving(true)
          const saved = await saveFaction(factionPayload(values, worldId, current), projectKey)
          setSaving(false)
          if (saved) setEditing(null)
        }}
      />

      <DeletePlanDialog
        plan={plan}
        onClose={() => setPlan(null)}
        onConfirm={() => { const id = plan?.entityId; if (id) void deleteFaction(id, detachEvents, projectKey) }}
        confirmLabel={detachEvents ? text('同时解除事件引用并删除', 'Detach event links and delete') : undefined}
      />
      {plan && plan.blockers.some(blocker => blocker.label === '历史事件引用') && (
        <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
          <input type="checkbox" checked={detachEvents} onChange={event => setDetachEvents(event.target.checked)} />
          {text('同时解除历史事件对它的引用（事件本身保留）', 'Also detach historical-event references (the events are kept)')}
        </label>
      )}
    </div>
  )
}

/** 势力详情：驻地地点、人物身份、势力关系与掌控的秘境。 */
function FactionRelations({
  projectKey, worldId, factionId, factions, nodeOptions, characterOptions,
}: {
  projectKey: string
  worldId: string
  factionId: string
  factions: ReturnType<typeof factionsOfWorld>
  nodeOptions: FormFieldOption[]
  characterOptions: FormFieldOption[]
}) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveFactionPlace = useWorldWorkbenchStore(s => s.saveFactionPlace)
  const saveFactionRelation = useWorldWorkbenchStore(s => s.saveFactionRelation)
  const saveFactionCharacter = useWorldWorkbenchStore(s => s.saveFactionCharacter)
  const deleteRelation = useWorldWorkbenchStore(s => s.deleteRelation)
  const nodes = useWorldMapStore(s => s.nodes)
  const faction = data.factions.find(item => item.id === factionId)
  const places = data.factionPlaces.filter(link => link.factionId === factionId)
  const members = data.factionCharacters.filter(link => link.factionId === factionId)
  const relations = data.factionRelations.filter(link => link.fromFactionId === factionId || link.toFactionId === factionId)
  const relics = data.relicFactions.filter(link => link.factionId === factionId)
  const nodeName = (id: string) => nodes.find(node => node.id === id)?.name ?? id
  const characterName = (id: string) => data.characterRefs.find(ref => ref.id === id)?.name ?? id
  const factionName = (id: string) => data.factions.find(item => item.id === id)?.name ?? id
  const otherFactions = factions.filter(item => item.id !== factionId).map(item => ({ value: item.id, label: item.name }))

  const [placeNode, setPlaceNode] = useState('')
  const [memberCharacter, setMemberCharacter] = useState('')
  const [memberRelation, setMemberRelation] = useState('成员')
  const [relationTarget, setRelationTarget] = useState('')
  const [relationKind, setRelationKind] = useState('ally')

  if (!faction) return null

  return (
    <div className="mt-1 space-y-1.5 border-t border-[var(--color-border)] pt-1.5 text-[11px] text-[var(--color-text-muted)]">
      <div>
        <span>{text('驻地 / 控制地点：', 'Seat & controlled places: ')}</span>
        {places.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {places.map(link => (
          <span key={link.id} className="mr-1 inline-flex items-center gap-0.5">
            {nodeName(link.nodeId)}
            <button type="button" onClick={() => void deleteRelation('world_faction_places', link.id, projectKey)} title={text('解除关联（不删除地点）', 'Unlink (the place is kept)')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={placeNode}
          onChange={event => setPlaceNode(event.target.value)}
          aria-label={text('选择势力地点', 'Choose a faction place')}
        >
          <option value="">{text('添加地点…', 'Add place…')}</option>
          {nodeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {placeNode && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void saveFactionPlace({ id: '', factionId, nodeId: placeNode, note: '' }, projectKey).then(() => setPlaceNode(''))}
          >
            {text('添加', 'Add')}
          </button>
        )}
      </div>

      <div>
        <span>{text('人物身份：', 'Members: ')}</span>
        {members.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {members.map(link => (
          <span key={link.id} className="mr-1 inline-flex items-center gap-0.5">
            <button
              type="button"
              className="text-[var(--color-accent)]"
              onClick={() => openCharacterEditorFor()}
              title={text('打开角色管理', 'Open character management')}
            >
              {characterName(link.characterId)}
            </button>
            （{link.relation}{link.tenureNote ? ` · ${link.tenureNote}` : ''}）
            <button type="button" onClick={() => void deleteRelation('world_faction_characters', link.id, projectKey)} title={text('解除关联（不删除项目角色）', 'Unlink (the project character is kept)')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={memberCharacter}
          onChange={event => setMemberCharacter(event.target.value)}
          aria-label={text('选择人物', 'Choose a character')}
        >
          <option value="">{text('添加人物…', 'Add character…')}</option>
          {characterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input
          className="ml-1 w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={memberRelation}
          onChange={event => setMemberRelation(event.target.value)}
          placeholder={text('身份', 'Role')}
          aria-label={text('身份关系', 'Role in faction')}
        />
        {memberCharacter && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void saveFactionCharacter({ id: '', factionId, characterId: memberCharacter, relation: memberRelation, tenureNote: '', note: '' }, projectKey).then(() => setMemberCharacter(''))}
          >
            {text('添加', 'Add')}
          </button>
        )}
      </div>

      <div>
        <span>{text('势力关系：', 'Faction relations: ')}</span>
        {relations.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {relations.map(link => (
          <span key={link.id} className="mr-1 inline-flex items-center gap-0.5">
            {factionName(link.fromFactionId)} {link.directed ? '→' : '↔'} {factionName(link.toFactionId)}
            （{relationLabel(link.relation, link.customLabel, RELATION_LABEL_MAPS.factionToFaction, text)}）
            <button type="button" onClick={() => void deleteRelation('world_faction_relations', link.id, projectKey)} title={text('解除关系', 'Remove relation')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={relationTarget}
          onChange={event => setRelationTarget(event.target.value)}
          aria-label={text('选择对端势力', 'Choose the other faction')}
        >
          <option value="">{text('选择对端势力…', 'Choose faction…')}</option>
          {otherFactions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={relationKind}
          onChange={event => setRelationKind(event.target.value)}
          aria-label={text('关系类型', 'Relation kind')}
        >
          {RELATION_OPTIONS.factionToFaction(text).filter(option => option.value !== 'custom').map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {relationTarget && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void saveFactionRelation({
              id: '', worldId, fromFactionId: factionId, toFactionId: relationTarget,
              relation: relationKind as 'ally', customLabel: '', directed: false, note: '',
            }, projectKey).then(() => setRelationTarget(''))}
          >
            {text('建立关系', 'Add relation')}
          </button>
        )}
      </div>

      {relics.length > 0 && (
        <div>
          <span>{text('相关秘境：', 'Relics: ')}</span>
          {relics.map(link => (
            <span key={link.id} className="mr-1">
              {data.relics.find(relic => relic.id === link.relicId)?.name ?? link.relicId}
              （{relationLabel(link.relation, link.customLabel, RELATION_LABEL_MAPS.relicFaction, text)}）
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function openCharacterEditorFor(): void {
  // 角色资料只有一份：跳转到角色管理，而不是在世界页复制一份人物卡。
  openCharacterEditor()
}

// ============================================================
// 秘境
// ============================================================

function RelicSection({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveRelic = useWorldWorkbenchStore(s => s.saveRelic)
  const deleteRelic = useWorldWorkbenchStore(s => s.deleteRelic)
  const planDeleteFor = useWorldWorkbenchStore(s => s.planDeleteFor)
  const relics = relicsOfWorld(data, worldId)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<WorldDeletePlan | null>(null)
  const nodeOptions = useNodeOptions(worldId, data.mapWorldLinks)
  const current = typeof editing === 'string' && editing !== 'new' ? data.relics.find(item => item.id === editing) ?? null : null

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return relics
    return relics.filter(relic => relic.name.toLocaleLowerCase('zh-CN').includes(keyword))
  }, [relics, search])

  return (
    <div className="space-y-3">
      <SectionShell
        icon={<ShieldAlert size={13} />}
        title={text('秘境', 'Relics')}
        description={text('秘境与地图上的「遗境」节点通过明确关联连接；状态由作者维护，不按电脑时间自动开启。', 'Relics link to atlas “relic” nodes explicitly. Status is author-maintained; nothing opens by clock time.')}
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={13} />{text('新建秘境', 'New relic')}</Button>}
        testId="world-relics"
      >
        <PlanningSearch value={search} onChange={setSearch} placeholder={text('搜索秘境', 'Search relics')} />
        {visible.length === 0 ? (
          <EmptyHint>{text('这个世界还没有秘境。', 'No relics in this world yet.')}</EmptyHint>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {visible.map(relic => {
              const node = relic.nodeId ? useWorldMapStore.getState().nodes.find(item => item.id === relic.nodeId) : null
              const entrance = relic.entranceNodeId ? useWorldMapStore.getState().nodes.find(item => item.id === relic.entranceNodeId) : null
              const controlling = data.relicFactions.filter(link => link.relicId === relic.id)
              const guardians = data.relicCharacters.filter(link => link.relicId === relic.id)
              return (
                <li key={relic.id} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-relic-${relic.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--color-text)]">{relic.name}{relic.type ? ` · ${relic.type}` : ''}</p>
                      {relic.summary && <p className="text-[11px] text-[var(--color-text-muted)]">{relic.summary}</p>}
                    </div>
                    <span className="flex flex-shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(relic.id)} title={text('编辑秘境', 'Edit relic')}><Pencil size={12} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => void planDeleteFor('relic', relic.id).then(setPlan)} title={text('删除秘境', 'Delete relic')}><Trash2 size={12} /></Button>
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {text('状态：', 'Status: ')}
                    {relic.status === 'custom' ? relic.customStatusLabel : relic.status}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {text('位置：', 'Place: ')}
                    {node
                      ? <button type="button" className="text-[var(--color-accent)]" onClick={() => openMapAt(node.mapId, node.id)}>{node.name}</button>
                      : text('未关联地图地点', 'No map place')}
                    {' / '}
                    {text('入口：', 'Entrance: ')}
                    {entrance
                      ? <button type="button" className="text-[var(--color-accent)]" onClick={() => openMapAt(entrance.mapId, entrance.id)}>{entrance.name}</button>
                      : text('未设定', 'Not set')}
                  </p>
                  <RelicLinks
                    projectKey={projectKey}
                    worldId={worldId}
                    relicId={relic.id}
                    controllingFactions={controlling.map(link => ({
                      id: link.id,
                      name: data.factions.find(faction => faction.id === link.factionId)?.name ?? link.factionId,
                      relation: relationLabel(link.relation, link.customLabel, RELATION_LABEL_MAPS.relicFaction, text),
                    }))}
                    guardians={guardians.map(link => ({
                      id: link.id,
                      name: data.characterRefs.find(ref => ref.id === link.characterId)?.name ?? link.characterId,
                      characterId: link.characterId,
                      relation: relationLabel(link.relation, link.customLabel, RELATION_LABEL_MAPS.relicCharacter, text),
                    }))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </SectionShell>

      <EntityFormDialog
        open={editing !== null}
        title={current ? text('编辑秘境', 'Edit relic') : text('新建秘境', 'New relic')}
        fields={relicFields(text, nodeOptions)}
        initialValues={relicDefaults(current)}
        saving={saving}
        onClose={() => setEditing(null)}
        onSubmit={async values => {
          setSaving(true)
          const saved = await saveRelic(relicPayload(values, worldId, current), projectKey)
          setSaving(false)
          if (saved) setEditing(null)
        }}
      />

      <DeletePlanDialog
        plan={plan}
        onClose={() => setPlan(null)}
        onConfirm={() => { const id = plan?.entityId; if (id) void deleteRelic(id, projectKey) }}
      />
    </div>
  )
}

function RelicLinks({
  projectKey, worldId, relicId, controllingFactions, guardians,
}: {
  projectKey: string
  worldId: string
  relicId: string
  controllingFactions: Array<{ id: string; name: string; relation: string }>
  guardians: Array<{ id: string; name: string; characterId: string; relation: string }>
}) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveRelicFaction = useWorldWorkbenchStore(s => s.saveRelicFaction)
  const saveRelicCharacter = useWorldWorkbenchStore(s => s.saveRelicCharacter)
  const deleteRelation = useWorldWorkbenchStore(s => s.deleteRelation)
  const [factionId, setFactionId] = useState('')
  const [characterId, setCharacterId] = useState('')
  const factions = factionsOfWorld(data, worldId)

  return (
    <div className="mt-1 space-y-1 text-[11px] text-[var(--color-text-muted)]">
      <div>
        <span>{text('掌控势力：', 'Factions: ')}</span>
        {controllingFactions.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {controllingFactions.map(link => (
          <span key={link.id} className="mr-1 inline-flex gap-0.5">
            {link.name}（{link.relation}）
            <button type="button" onClick={() => void deleteRelation('world_relic_factions', link.id, projectKey)} title={text('解除关联', 'Unlink')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={factionId}
          onChange={event => setFactionId(event.target.value)}
          aria-label={text('选择势力', 'Choose faction')}
        >
          <option value="">{text('添加势力…', 'Add faction…')}</option>
          {factions.map(faction => <option key={faction.id} value={faction.id}>{faction.name}</option>)}
        </select>
        {factionId && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void saveRelicFaction({ id: '', relicId, factionId, relation: 'control', customLabel: '', note: '' }, projectKey).then(() => setFactionId(''))}
          >
            {text('添加', 'Add')}
          </button>
        )}
      </div>
      <div>
        <span>{text('关联人物：', 'Characters: ')}</span>
        {guardians.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {guardians.map(link => (
          <span key={link.id} className="mr-1 inline-flex gap-0.5">
            <button type="button" className="text-[var(--color-accent)]" onClick={() => openCharacterEditorFor()}>{link.name}</button>
            （{link.relation}）
            <button type="button" onClick={() => void deleteRelation('world_relic_characters', link.id, projectKey)} title={text('解除关联（不删除项目角色）', 'Unlink (the character is kept)')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={characterId}
          onChange={event => setCharacterId(event.target.value)}
          aria-label={text('选择人物', 'Choose character')}
        >
          <option value="">{text('添加人物…', 'Add character…')}</option>
          {data.characterRefs.map(ref => <option key={ref.id} value={ref.id}>{ref.name}</option>)}
        </select>
        {characterId && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void saveRelicCharacter({ id: '', relicId, characterId, relation: 'guard', customLabel: '', note: '' }, projectKey).then(() => setCharacterId(''))}
          >
            {text('添加', 'Add')}
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 通道
// ============================================================

function PortalSection({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const savePortal = useWorldWorkbenchStore(s => s.savePortal)
  const deletePortal = useWorldWorkbenchStore(s => s.deletePortal)
  const planDeleteFor = useWorldWorkbenchStore(s => s.planDeleteFor)
  const portals = portalsOfWorld(data, worldId)
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<WorldDeletePlan | null>(null)
  const worldOptions = data.worlds.map(world => ({ value: world.id, label: world.name }))
  const current = typeof editing === 'string' && editing !== 'new' ? data.portals.find(item => item.id === editing) ?? null : null
  const nodesForWorld = (worldIdValue: string) => data.mapWorldLinks
    .filter(link => link.worldId === worldIdValue)
    .flatMap(link => useWorldMapStore.getState().nodes.filter(node => node.mapId === link.mapId)
      .map(node => ({ value: node.id, label: node.name })))

  return (
    <div className="space-y-3">
      <SectionShell
        icon={<DoorOpen size={13} />}
        title={text('世界之间的通道', 'Portals between worlds')}
        description={text('通道是独立资料，不是地图连线；两端世界都能看到同一条通道，方向明确显示。', 'A portal is its own record, not a map edge. Both worlds see the same portal, and its direction is explicit.')}
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={13} />{text('新建通道', 'New portal')}</Button>}
        testId="world-portals"
      >
        {portals.length === 0 ? (
          <EmptyHint>{text('还没有世界通道。', 'No portals yet.')}</EmptyHint>
        ) : (
          <ul className="space-y-1 text-xs">
            {portals.map(portal => {
              const fromName = data.worlds.find(world => world.id === portal.fromWorldId)?.name ?? portal.fromWorldId
              const toName = data.worlds.find(world => world.id === portal.toWorldId)?.name ?? portal.toWorldId
              const guardianLinks = data.portalCharacters.filter(link => link.portalId === portal.id)
              const endpointNode = (id: string | null) => (id ? useWorldMapStore.getState().nodes.find(node => node.id === id) ?? null : null)
              const fromNode = endpointNode(portal.fromNodeId)
              const toNode = endpointNode(portal.toNodeId)
              return (
                <li key={portal.id} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-portal-${portal.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium text-[var(--color-text)]">
                      {portal.name}
                      <span className="ml-2 text-[11px] text-[var(--color-text-muted)]">
                        {portal.bidirectional
                          ? text(`${fromName} ↔ ${toName}（双向通行）`, `${fromName} ↔ ${toName} (both ways)`)
                          : text(`${fromName} → ${toName}（单向通行，反向不可走）`, `${fromName} → ${toName} (one way only; the reverse is not passable)`)}
                      </span>
                    </p>
                    <span className="flex flex-shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(portal.id)} title={text('编辑通道', 'Edit portal')}><Pencil size={12} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => void planDeleteFor('portal', portal.id).then(setPlan)} title={text('删除通道', 'Delete portal')}><Trash2 size={12} /></Button>
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {text('端点：', 'Endpoints: ')}
                    {fromNode
                      ? <button type="button" className="text-[var(--color-accent)]" onClick={() => openMapAt(fromNode.mapId, fromNode.id)}>{fromNode.name}</button>
                      : text('入口地点未设定', 'entry place not set')}
                    {' → '}
                    {toNode
                      ? <button type="button" className="text-[var(--color-accent)]" onClick={() => openMapAt(toNode.mapId, toNode.id)}>{toNode.name}</button>
                      : text('出口地点未设定', 'exit place not set')}
                  </p>
                  {portal.condition && <p className="text-[11px] text-[var(--color-text-muted)]">{text('通行条件：', 'Condition: ')}{portal.condition}</p>}
                  <PortalLinks
                    projectKey={projectKey}
                    worldId={worldId}
                    portalId={portal.id}
                    controlling={data.portalFactions.filter(link => link.portalId === portal.id).map(link => ({
                      id: link.id,
                      name: data.factions.find(faction => faction.id === link.factionId)?.name ?? link.factionId,
                      relation: relationLabel(link.relation, link.customLabel, RELATION_LABEL_MAPS.portalFaction, text),
                    }))}
                    guardians={guardianLinks.map(link => ({
                      id: link.id,
                      characterId: link.characterId,
                      name: data.characterRefs.find(ref => ref.id === link.characterId)?.name ?? link.characterId,
                      relation: relationLabel(link.relation, link.customLabel, RELATION_LABEL_MAPS.portalCharacter, text),
                    }))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </SectionShell>

      <EntityFormDialog
        open={editing !== null}
        title={current ? text('编辑通道', 'Edit portal') : text('新建通道', 'New portal')}
        fields={portalFields(text, worldOptions, nodesForWorld)}
        initialValues={portalDefaults(current, worldId)}
        saving={saving}
        onClose={() => setEditing(null)}
        onSubmit={async values => {
          setSaving(true)
          const saved = await savePortal(portalPayload(values, current) as never, projectKey)
          setSaving(false)
          if (saved) setEditing(null)
        }}
      />

      <DeletePlanDialog
        plan={plan}
        onClose={() => setPlan(null)}
        onConfirm={() => { const id = plan?.entityId; if (id) void deletePortal(id, false, projectKey) }}
      />
    </div>
  )
}

/**
 * 通道的控制势力与守护人物。两端的资料都挂在同一个通道上，不会因为从哪一端
 * 进入而产生两份记录。
 */
function PortalLinks({
  projectKey, worldId, portalId, controlling, guardians,
}: {
  projectKey: string
  worldId: string
  portalId: string
  controlling: Array<{ id: string; name: string; relation: string }>
  guardians: Array<{ id: string; characterId: string; name: string; relation: string }>
}) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const savePortalFaction = useWorldWorkbenchStore(s => s.savePortalFaction)
  const savePortalCharacter = useWorldWorkbenchStore(s => s.savePortalCharacter)
  const deleteRelation = useWorldWorkbenchStore(s => s.deleteRelation)
  const factions = factionsOfWorld(data, worldId)
  const [factionId, setFactionId] = useState('')
  const [characterId, setCharacterId] = useState('')

  return (
    <div className="mt-1 space-y-1 text-[11px] text-[var(--color-text-muted)]">
      <div>
        <span>{text('控制 / 守护势力：', 'Controlling factions: ')}</span>
        {controlling.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {controlling.map(link => (
          <span key={link.id} className="mr-1 inline-flex gap-0.5">
            {link.name}（{link.relation}）
            <button type="button" onClick={() => void deleteRelation('world_portal_factions', link.id, projectKey)} title={text('解除关联（不删除势力）', 'Unlink (the faction is kept)')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={factionId}
          onChange={event => setFactionId(event.target.value)}
          aria-label={text('选择控制势力', 'Choose a controlling faction')}
        >
          <option value="">{text('添加势力…', 'Add faction…')}</option>
          {factions.map(faction => <option key={faction.id} value={faction.id}>{faction.name}</option>)}
        </select>
        {factionId && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void savePortalFaction({ id: '', portalId, factionId, relation: 'control', customLabel: '', note: '' }, projectKey).then(() => setFactionId(''))}
          >
            {text('添加', 'Add')}
          </button>
        )}
      </div>
      <div>
        <span>{text('守护人物：', 'Guardians: ')}</span>
        {guardians.length === 0 && <span>{text('未设定', 'Not set')}</span>}
        {guardians.map(link => (
          <span key={link.id} className="mr-1 inline-flex gap-0.5">
            <button type="button" className="text-[var(--color-accent)]" onClick={() => openCharacterEditorFor()}>{link.name}</button>
            （{link.relation}）
            <button type="button" onClick={() => void deleteRelation('world_portal_characters', link.id, projectKey)} title={text('解除关联（不删除项目角色）', 'Unlink (the character is kept)')}>×</button>
          </span>
        ))}
        <select
          className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[11px]"
          value={characterId}
          onChange={event => setCharacterId(event.target.value)}
          aria-label={text('选择守护人物', 'Choose a guardian')}
        >
          <option value="">{text('添加人物…', 'Add character…')}</option>
          {data.characterRefs.map(ref => <option key={ref.id} value={ref.id}>{ref.name}</option>)}
        </select>
        {characterId && (
          <button
            type="button"
            className="ml-1 text-[var(--color-accent)]"
            onClick={() => void savePortalCharacter({ id: '', portalId, characterId, relation: 'guard', customLabel: '', note: '' }, projectKey).then(() => setCharacterId(''))}
          >
            {text('添加', 'Add')}
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 规则
// ============================================================

function RuleSection({ projectKey, worldId }: { projectKey: string; worldId: string }) {
  const text = useLocaleStore(s => s.text)
  const data = useWorldWorkbenchStore(s => s.data)
  const saveRule = useWorldWorkbenchStore(s => s.saveRule)
  const deleteRule = useWorldWorkbenchStore(s => s.deleteRule)
  const planDeleteFor = useWorldWorkbenchStore(s => s.planDeleteFor)
  const saveRuleTarget = useWorldWorkbenchStore(s => s.saveRuleTarget)
  const deleteRelation = useWorldWorkbenchStore(s => s.deleteRelation)
  const rules = rulesOfWorld(data, worldId)
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<WorldDeletePlan | null>(null)
  const current = typeof editing === 'string' && editing !== 'new' ? data.rules.find(item => item.id === editing) ?? null : null
  const nodeOptions = useNodeOptions(worldId, data.mapWorldLinks)
  const relicOptions = relicsOfWorld(data, worldId).map(relic => ({ value: relic.id, label: relic.name }))

  const [targetRuleId, setTargetRuleId] = useState('')
  const [targetKind, setTargetKind] = useState<'node' | 'relic'>('node')
  const [targetRole, setTargetRole] = useState<'scope' | 'exception'>('scope')
  const [targetId, setTargetId] = useState('')

  return (
    <div className="space-y-3">
      <SectionShell
        icon={<ScrollText size={13} />}
        title={text('世界规则', 'World rules')}
        description={text('默认适用整个世界，也可以指定适用地点或秘境，并单独记录例外。这里只做设定管理，不干预正文。', 'Rules apply to the whole world by default, can target places or relics, and can carry explicit exceptions. This is setting management only; it never rewrites prose.')}
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={13} />{text('新建规则', 'New rule')}</Button>}
        testId="world-rules"
      >
        {rules.length === 0 ? (
          <EmptyHint>{text('这个世界还没有规则。', 'No rules in this world yet.')}</EmptyHint>
        ) : (
          <ul className="space-y-1 text-xs">
            {rules.map(rule => {
              const targets = data.ruleTargets.filter(target => target.ruleId === rule.id)
              return (
                <li key={rule.id} className="rounded border border-[var(--color-border)] px-2 py-1" data-testid={`world-rule-${rule.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--color-text)]">{rule.name}</p>
                      {rule.content && <p className="whitespace-pre-wrap text-[11px] text-[var(--color-text-muted)]">{rule.content}</p>}
                    </div>
                    <span className="flex flex-shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(rule.id)} title={text('编辑规则', 'Edit rule')}><Pencil size={12} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => void planDeleteFor('rule', rule.id).then(setPlan)} title={text('删除规则', 'Delete rule')}><Trash2 size={12} /></Button>
                    </span>
                  </div>
                  {targets.length > 0 && (
                    <ul className="text-[11px] text-[var(--color-text-muted)]">
                      {targets.map(target => (
                        <li key={target.id} className="flex items-center gap-1">
                          <span>
                            {target.role === 'exception' ? text('例外', 'Exception') : text('适用范围', 'Scope')}
                            {text('：', ': ')}
                            {target.targetKind === 'relic'
                              ? data.relics.find(relic => relic.id === target.targetId)?.name ?? target.targetId
                              : useWorldMapStore.getState().nodes.find(node => node.id === target.targetId)?.name ?? target.targetId}
                            {target.note ? `（${target.note}）` : ''}
                          </span>
                          <button type="button" onClick={() => void deleteRelation('world_rule_targets', target.id, projectKey)} title={text('解除该范围/例外', 'Remove this scope or exception')}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {rule.sourceKind === 'author'
                      ? text('来源：作者手写', 'Source: author-written')
                      : text(`来源：引用既有事实 ${rule.sourceRefId}（状态 ${rule.sourceStatus || '未标注'}）`, `Source: existing fact ${rule.sourceRefId} (status ${rule.sourceStatus || 'unmarked'})`)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </SectionShell>

      {rules.length > 0 && (
        <SectionShell
          icon={<ScrollText size={13} />}
          title={text('适用范围与例外', 'Scope & exceptions')}
          description={text('适用范围和例外目标必须属于这个世界；跨世界目标会被仓库拒绝。', 'Scope and exception targets must belong to this world; cross-world targets are refused by the repository.')}
        >
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <select
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
              value={targetRuleId}
              onChange={event => setTargetRuleId(event.target.value)}
              aria-label={text('选择规则', 'Choose rule')}
            >
              <option value="">{text('选择规则…', 'Choose rule…')}</option>
              {rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
            </select>
            <select
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
              value={targetRole}
              onChange={event => setTargetRole(event.target.value as 'scope' | 'exception')}
              aria-label={text('范围或例外', 'Scope or exception')}
            >
              <option value="scope">{text('适用范围', 'Scope')}</option>
              <option value="exception">{text('例外', 'Exception')}</option>
            </select>
            <select
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
              value={targetKind}
              onChange={event => { setTargetKind(event.target.value as 'node' | 'relic'); setTargetId('') }}
              aria-label={text('目标种类', 'Target kind')}
            >
              <option value="node">{text('地点', 'Place')}</option>
              <option value="relic">{text('秘境', 'Relic')}</option>
            </select>
            <select
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
              value={targetId}
              onChange={event => setTargetId(event.target.value)}
              aria-label={text('目标', 'Target')}
            >
              <option value="">{text('选择目标…', 'Choose target…')}</option>
              {(targetKind === 'node' ? nodeOptions : relicOptions).map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!targetRuleId || !targetId}
              onClick={() => void saveRuleTarget({
                id: '', ruleId: targetRuleId, role: targetRole, targetKind, targetId, note: '',
              }, projectKey).then(() => setTargetId(''))}
            >
              {text('添加', 'Add')}
            </Button>
          </div>
        </SectionShell>
      )}

      <EntityFormDialog
        open={editing !== null}
        title={current ? text('编辑规则', 'Edit rule') : text('新建规则', 'New rule')}
        fields={ruleFields(text, nodeOptions)}
        initialValues={ruleDefaults(current)}
        saving={saving}
        onClose={() => setEditing(null)}
        onSubmit={async values => {
          setSaving(true)
          const saved = await saveRule(rulePayload(values, worldId, current), projectKey)
          setSaving(false)
          if (saved) setEditing(null)
        }}
      />

      <DeletePlanDialog
        plan={plan}
        onClose={() => setPlan(null)}
        onConfirm={() => { const id = plan?.entityId; if (id) void deleteRule(id, false, projectKey) }}
      />
    </div>
  )
}

// ============================================================
// 工具
// ============================================================

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

export { withUnset, openCharacterEditorFor }
