import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, CornerDownRight, Map as MapIcon, Pencil, Plus, Trash2 } from 'lucide-react'
import { buildWorldMapTree, type WorldMap, type WorldMapTreeNode } from '../../shared/world-map'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

interface Props {
  maps: WorldMap[]
  selectedMapId: string | null
  /** 每张地图自己内部的地点数量，用于说明删除影响。 */
  nodeCountByMap: Map<string, number>
  onSelect: (mapId: string) => void
  onCreateTopLevel: () => void
  onCreateChild: (parentMapId: string) => void
  onRename: (map: WorldMap, name: string) => void
  onMove: (map: WorldMap, siblings: WorldMap[], offset: -1 | 1) => void
  onDelete: (map: WorldMap) => void
}

/**
 * 地图册树。地图之间只通过这棵树和面包屑切换，绝不通过复制地点或跨地图连线跳转。
 */
export default function WorldMapAtlasTree({
  maps,
  selectedMapId,
  nodeCountByMap,
  onSelect,
  onCreateTopLevel,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
}: Props) {
  const text = useLocaleStore(s => s.text)
  const tree = buildWorldMapTree(maps)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  // 选中的地图被删除后，重命名草稿不能继续挂在已经不存在的行上。
  useEffect(() => {
    if (!renamingId || maps.some(map => map.id === renamingId)) return
    // 延后一帧再同步，避免在 effect 内同步 setState 造成级联渲染。
    const frame = requestAnimationFrame(() => setRenamingId(null))
    return () => cancelAnimationFrame(frame)
  }, [maps, renamingId])

  const startRename = (map: WorldMap) => {
    setRenamingId(map.id)
    setDraftName(map.name)
  }

  const commitRename = (map: WorldMap) => {
    const name = draftName.trim()
    setRenamingId(null)
    if (name && name !== map.name) onRename(map, name)
  }

  const renderRow = (node: WorldMapTreeNode, siblings: WorldMap[]) => {
    const map = node.map
    const isSelected = map.id === selectedMapId
    const index = siblings.findIndex(candidate => candidate.id === map.id)
    return (
      <div key={map.id}>
        <div
          className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs ${isSelected ? 'bg-[var(--color-active)]' : 'hover:bg-[var(--color-hover)]'}`}
          style={{ paddingLeft: 4 + node.depth * 12 }}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => onSelect(map.id)}
            title={text('切换到此地图', 'Switch to this map')}
            aria-current={isSelected ? 'true' : undefined}
          >
            {node.depth > 0
              ? <CornerDownRight size={11} className="flex-shrink-0 text-[var(--color-text-muted)]" />
              : <MapIcon size={12} className="flex-shrink-0" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />}
            {renamingId === map.id ? (
              <Input
                className="h-6 text-xs"
                value={draftName}
                autoFocus
                onChange={event => setDraftName(event.target.value)}
                onClick={event => event.stopPropagation()}
                onBlur={() => commitRename(map)}
                onKeyDown={event => {
                  if (event.key === 'Enter') commitRename(map)
                  if (event.key === 'Escape') setRenamingId(null)
                }}
              />
            ) : (
              <span className={`truncate ${isSelected ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}`}>
                {map.name || text('未命名地图', 'Untitled map')}
              </span>
            )}
          </button>
          {renamingId !== map.id && (
            <>
              <span className="flex-shrink-0 text-[10px] text-[var(--color-text-muted)]">{nodeCountByMap.get(map.id) ?? 0}</span>
              <span className="flex flex-shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={() => onCreateChild(map.id)} title={text('新建子地图', 'New child map')} aria-label={text(`在「${map.name}」下新建子地图`, `New child map under ${map.name}`)}><Plus size={11} /></button>
                <button type="button" className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30" disabled={index <= 0} onClick={() => onMove(map, siblings, -1)} title={text('上移', 'Move up')} aria-label={text(`上移「${map.name}」`, `Move ${map.name} up`)}><ChevronUp size={11} /></button>
                <button type="button" className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30" disabled={index < 0 || index >= siblings.length - 1} onClick={() => onMove(map, siblings, 1)} title={text('下移', 'Move down')} aria-label={text(`下移「${map.name}」`, `Move ${map.name} down`)}><ChevronDown size={11} /></button>
                <button type="button" className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={() => startRename(map)} title={text('重命名', 'Rename')} aria-label={text(`重命名「${map.name}」`, `Rename ${map.name}`)}><Pencil size={11} /></button>
                <button type="button" className="p-0.5 text-[var(--color-error)]" onClick={() => onDelete(map)} title={text('删除地图', 'Delete map')} aria-label={text(`删除「${map.name}」`, `Delete ${map.name}`)}><Trash2 size={11} /></button>
              </span>
            </>
          )}
        </div>
        {node.children.map(child => renderRow(child, node.children.map(entry => entry.map)))}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-2.5 py-1.5">
        <span className="text-xs font-semibold text-[var(--color-text)]" data-testid="world-map-atlas-tree-title">
          {text('地图册', 'Map atlas')}
        </span>
        <Button size="sm" variant="outline" onClick={onCreateTopLevel}><Plus size={12} />{text('新建顶层地图', 'New top-level map')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {tree.length === 0 ? (
          <p className="px-1 py-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            {text('还没有地图。每张地图都是独立空间，可分别导入图片并建立自己的地点与连接。', 'No maps yet. Each map is its own space with its own image, locations, and connections.')}
          </p>
        ) : tree.map(node => renderRow(node, tree.map(entry => entry.map)))}
      </div>
    </div>
  )
}
