import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Layers, Plus, Trash2 } from 'lucide-react'
import type { WorldMapLayer } from '../../shared/world-map'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { confirm } from '../ui/Confirm'

interface Props {
  open: boolean
  layers: WorldMapLayer[]
  nodeCountByLayer: Map<string, number>
  onClose: () => void
  onUpsert: (layer: WorldMapLayer) => Promise<boolean>
  onDelete: (id: string, fallbackLayerId: string) => Promise<boolean>
  onReorder: (orderedIds: string[]) => Promise<boolean>
}

function createLayerId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function WorldMapLayersDialog({
  open,
  layers,
  nodeCountByLayer,
  onClose,
  onUpsert,
  onDelete,
  onReorder,
}: Props) {
  const text = useLocaleStore(s => s.text)
  const [newName, setNewName] = useState('')
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const orderedLayers = useMemo(() => [...layers].sort((a, b) => a.sortOrder - b.sortOrder), [layers])

  useEffect(() => {
    if (!open) return
    setDraftNames(Object.fromEntries(layers.map(layer => [layer.id, layer.name])))
    setNewName('')
  }, [open, layers])

  const addLayer = async () => {
    const name = newName.trim()
    if (!name) return
    const ok = await onUpsert({
      id: createLayerId(),
      name,
      sortOrder: orderedLayers.length + 1,
    })
    if (ok) setNewName('')
  }

  const saveName = async (layer: WorldMapLayer) => {
    const name = draftNames[layer.id]?.trim()
    if (!name || name === layer.name) return
    await onUpsert({ ...layer, name })
  }

  const move = async (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= orderedLayers.length) return
    const ids = orderedLayers.map(layer => layer.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await onReorder(ids)
  }

  const remove = async (layer: WorldMapLayer) => {
    const alternatives = orderedLayers.filter(candidate => candidate.id !== layer.id)
    if (alternatives.length === 0) return
    const fallbackLayerId = alternatives[0].id
    const count = nodeCountByLayer.get(layer.id) ?? 0
    const accepted = await confirm(
      count > 0
        ? text(`删除「${layer.name}」前，需要将其中 ${count} 个地点迁移到「${alternatives[0].name}」。是否继续？`, `Move ${count} nodes to ${alternatives[0].name} and delete ${layer.name}?`)
        : text(`确认删除图层「${layer.name}」？`, `Delete layer “${layer.name}”?`),
      { title: text('删除项目图层', 'Delete project layer'), confirmText: text('删除', 'Delete'), danger: true },
    )
    if (accepted) await onDelete(layer.id, fallbackLayerId)
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers size={16} />{text('项目地图图层', 'Project map layers')}</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            {text('图层完全属于当前小说项目。可重命名、排序与新增；删除时会将已有地点安全迁移到另一个图层。', 'Layers belong to this novel project. Rename, reorder, or add them; deletion safely moves existing locations.')}
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {orderedLayers.map((layer, index) => (
              <div key={layer.id} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5">
                <div className="flex flex-col">
                  <button type="button" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30" disabled={index === 0} onClick={() => void move(index, -1)} aria-label={text('上移图层', 'Move layer up')}><ChevronUp size={13} /></button>
                  <button type="button" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30" disabled={index === orderedLayers.length - 1} onClick={() => void move(index, 1)} aria-label={text('下移图层', 'Move layer down')}><ChevronDown size={13} /></button>
                </div>
                <Input className="h-7" value={draftNames[layer.id] ?? layer.name} onChange={event => setDraftNames(current => ({ ...current, [layer.id]: event.target.value }))} onBlur={() => void saveName(layer)} />
                <span className="w-12 text-right text-[10px] text-[var(--color-text-muted)]">{text(`${nodeCountByLayer.get(layer.id) ?? 0} 地点`, `${nodeCountByLayer.get(layer.id) ?? 0} nodes`)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--color-error)]" disabled={orderedLayers.length < 2} onClick={() => void remove(layer)} title={orderedLayers.length < 2 ? text('请至少保留一个图层', 'Keep at least one layer') : text('删除图层', 'Delete layer')}><Trash2 size={13} /></Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 border-t border-[var(--color-border)] pt-3">
            <Input value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addLayer() }} placeholder={text('例如：梦境层、远古纪元、海底城', 'Example: Dream realm, Ancient era')} />
            <Button size="sm" onClick={() => void addLayer()} disabled={!newName.trim()}><Plus size={13} />{text('添加图层', 'Add layer')}</Button>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{text('完成', 'Done')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
