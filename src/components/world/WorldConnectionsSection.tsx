import { useMemo } from 'react'
import { ArrowLeftRight, ArrowRight, Pencil, Trash2 } from 'lucide-react'

import {
  WORLD_PORTAL_STATUS_LABELS,
  WORLD_PORTAL_TYPE_LABELS,
  type WorldPortal,
  type WorldPortalStatus,
  type WorldPortalType,
} from '../../shared/world-workbench'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import type { WorldConnectionsSectionProps } from './world-management-contract'

/** Read-only presentation of the supplied cross-world portal records. */
export default function WorldConnectionsSection({
  worldId,
  worlds,
  portals,
  nodes,
  onEdit,
  onDelete,
  onOpenMapAt,
  renderRelations,
}: WorldConnectionsSectionProps) {
  const text = useLocaleStore(state => state.text)

  const visiblePortals = useMemo(() => {
    const unique = new Map<string, WorldPortal>()
    for (const portal of portals) {
      if (portal.fromWorldId !== worldId && portal.toWorldId !== worldId) continue
      if (!unique.has(portal.id)) unique.set(portal.id, portal)
    }
    return [...unique.values()]
  }, [portals, worldId])

  const worldById = useMemo(() => new Map(worlds.map(world => [world.id, world])), [worlds])
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])

  const worldLabel = (id: string) => {
    const world = worldById.get(id)
    return world
      ? world.name
      : text(`缺少世界引用（${id}）`, `Missing world reference (${id})`)
  }

  const nodeLabel = (id: string | null) => {
    if (!id) return text('未设定地点（世界级通道）', 'No place set (world-level portal)')
    const node = nodeById.get(id)
    return node
      ? node.name
      : text(`缺少地点引用（${id}）`, `Missing place reference (${id})`)
  }

  return (
    <div
      className="min-w-0 space-y-2"
      data-testid="world-connections"
    >
      {visiblePortals.length === 0 ? (
        <p className="rounded-[var(--radius-md)] px-2 py-2 text-xs text-[var(--color-text-muted)]" data-testid="world-connections-empty">
          {text('这个世界还没有关联通道。', 'No connections are linked to this world yet.')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={text('通道列表', 'Connection list')}>
          {visiblePortals.map(portal => (
            <li
              key={portal.id}
              className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
              data-testid={`world-connection-${portal.id}`}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="whitespace-normal break-words text-xs font-semibold text-[var(--color-text)] [overflow-wrap:anywhere]" title={portal.name}>
                    {portal.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
                      {portalTypeLabel(portal.type, portal.customTypeLabel, text)}
                    </span>
                    <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
                      {portalStatusLabel(portal.status, portal.customStatusLabel, text)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-secondary)]" data-testid={`world-connection-direction-${portal.id}`}>
                      {portal.bidirectional
                        ? <><ArrowLeftRight size={11} aria-hidden="true" />{text('双向：来源 ↔ 目标', 'Bidirectional: source ↔ target')}</>
                        : <><ArrowRight size={11} aria-hidden="true" />{text('单向：来源 → 目标', 'One way: source → target')}</>}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={text(`编辑通道「${portal.name}」`, `Edit connection “${portal.name}”`)}
                    title={text('编辑通道', 'Edit connection')}
                    onClick={() => onEdit(portal.id)}
                    data-testid={`world-connection-edit-${portal.id}`}
                  >
                    <Pencil size={12} aria-hidden="true" />
                    <span>{text('编辑', 'Edit')}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-[var(--color-error)] hover:text-[var(--color-error)]"
                    aria-label={text(`删除通道「${portal.name}」`, `Delete connection “${portal.name}”`)}
                    title={text('删除通道', 'Delete connection')}
                    onClick={() => onDelete(portal.id)}
                    data-testid={`world-connection-delete-${portal.id}`}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    <span>{text('删除', 'Delete')}</span>
                  </Button>
                </div>
              </div>

              <div className="mt-2 grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2">
                <Endpoint
                  label={text('来源世界 / 入口', 'Source world / entry')}
                  worldName={worldLabel(portal.fromWorldId)}
                  nodeName={nodeLabel(portal.fromNodeId)}
                  node={portal.fromNodeId ? nodeById.get(portal.fromNodeId) : undefined}
                  onOpenMapAt={onOpenMapAt}
                />
                <Endpoint
                  label={text('目标世界 / 出口', 'Target world / exit')}
                  worldName={worldLabel(portal.toWorldId)}
                  nodeName={nodeLabel(portal.toNodeId)}
                  node={portal.toNodeId ? nodeById.get(portal.toNodeId) : undefined}
                  onOpenMapAt={onOpenMapAt}
                />
              </div>

              {(portal.condition || portal.cost || portal.scheduleNote || portal.description) && (
                <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2 text-[10px] sm:grid-cols-2">
                  {portal.condition && <Detail label={text('通行条件', 'Condition')} value={portal.condition} />}
                  {portal.cost && <Detail label={text('通行代价', 'Cost')} value={portal.cost} />}
                  {portal.scheduleNote && <Detail label={text('开放时段', 'Schedule')} value={portal.scheduleNote} />}
                  {portal.description && <Detail label={text('说明', 'Description')} value={portal.description} wide />}
                </dl>
              )}

              {renderRelations && (
                <div className="mt-2 border-t border-[var(--color-border)] pt-2" data-testid={`world-connection-relations-${portal.id}`}>
                  {renderRelations(portal)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Endpoint({
  label, worldName, nodeName, node, onOpenMapAt,
}: {
  label: string
  worldName: string
  nodeName: string
  node?: { id: string; name: string; mapId: string }
  onOpenMapAt: (mapId: string, nodeId: string) => void
}) {
  const text = useLocaleStore(state => state.text)
  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)]/70 px-2 py-1">
      <p className="text-[10px] font-medium text-[var(--color-text-muted)]">{label}</p>
      <p className="whitespace-normal break-words text-[11px] text-[var(--color-text)] [overflow-wrap:anywhere]">{worldName}</p>
      {node ? (
        <button
          type="button"
          className="block whitespace-normal break-words text-left text-[10px] text-[var(--color-accent)] [overflow-wrap:anywhere]"
          aria-label={text(`打开地图地点：${node.name}`, `Open map place: ${node.name}`)}
          onClick={() => onOpenMapAt(node.mapId, node.id)}
        >
          {nodeName}
        </button>
      ) : (
        <p className="whitespace-normal break-words text-[10px] text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{nodeName}</p>
      )}
    </div>
  )
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="inline font-medium text-[var(--color-text-muted)]">{label}：</dt>
      <dd className="inline whitespace-pre-wrap break-words text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function portalTypeLabel(
  type: WorldPortalType,
  customLabel: string,
  text: (zh: string, en: string) => string,
): string {
  if (type === 'custom' && customLabel.trim()) return customLabel
  const label = WORLD_PORTAL_TYPE_LABELS[type]
  return text(label.zh, label.en)
}

function portalStatusLabel(
  status: WorldPortalStatus,
  customLabel: string,
  text: (zh: string, en: string) => string,
): string {
  if (status === 'custom' && customLabel.trim()) return customLabel
  const label = WORLD_PORTAL_STATUS_LABELS[status]
  return text(label.zh, label.en)
}
