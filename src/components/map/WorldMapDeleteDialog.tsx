import { useEffect, useState } from 'react'
import { AlertTriangle, ImageOff, Map as MapIcon, MapPin, Trash2 } from 'lucide-react'
import type { WorldMap } from '../../shared/world-map'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import type { WorldMapDeleteStrategy } from '../../stores/world-map-store'

export interface WorldMapDeleteImpact {
  /** 直接子地图数量。 */
  childMapCount: number
  /** cascade 会一并删除的全部后代地图数量（不含自身）。 */
  descendantMapCount: number
  nodeCount: number
  edgeCount: number
  hasImage: boolean
}

interface Props {
  open: boolean
  map: WorldMap | null
  impact: WorldMapDeleteImpact
  onClose: () => void
  onConfirm: (strategy: WorldMapDeleteStrategy) => Promise<boolean>
}

/**
 * 删除地图前必须逐项说明子地图、地点、图片与连接的处理方式，禁止静默删除。
 */
export default function WorldMapDeleteDialog({ open, map, impact, onClose, onConfirm }: Props) {
  const text = useLocaleStore(s => s.text)
  const [strategy, setStrategy] = useState<WorldMapDeleteStrategy>('promote-children')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setStrategy('promote-children')
      setDeleting(false)
    })
  }, [open, map?.id])

  if (!map) return null

  const hasChildren = impact.childMapCount > 0
  const effective: WorldMapDeleteStrategy = hasChildren ? strategy : 'cascade'

  const option = (
    value: WorldMapDeleteStrategy,
    title: string,
    detail: string,
  ) => (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${strategy === value ? 'border-[var(--color-accent)] bg-[var(--color-hover)]' : 'border-[var(--color-border)]'}`}
    >
      <input
        type="radio"
        className="mt-0.5"
        name="world-map-delete-strategy"
        value={value}
        checked={strategy === value}
        onChange={() => setStrategy(value)}
      />
      <span className="min-w-0">
        <span className="block font-medium text-[var(--color-text)]">{title}</span>
        <span className="mt-0.5 block text-[var(--color-text-muted)]">{detail}</span>
      </span>
    </label>
  )

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      const ok = await onConfirm(effective)
      if (ok) onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
            {text(`删除地图「${map.name}」`, `Delete map “${map.name}”`)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-6 py-4 text-xs">
          <ul className="space-y-1.5">
            <li className="flex items-center gap-2">
              <MapPin size={12} className="text-[var(--color-text-muted)]" />
              {text(
                `这张地图内部的 ${impact.nodeCount} 个地点会在删除后一并移除，它们不会出现在其他地图。`,
                `The ${impact.nodeCount} locations inside this map are removed with it; they never appear on other maps.`,
              )}
            </li>
            <li className="flex items-center gap-2">
              <MapIcon size={12} className="text-[var(--color-text-muted)]" />
              {text(
                `地图内部连接 ${impact.edgeCount} 条会被删除；跨地图连接不存在，因此没有其他地图会被牵连。`,
                `${impact.edgeCount} connections inside the map are deleted. Cross-map connections do not exist, so no other map is affected.`,
              )}
            </li>
            <li className="flex items-center gap-2">
              <ImageOff size={12} className="text-[var(--color-text-muted)]" />
              {impact.hasImage
                ? text('这张地图的托管图片副本会被删除；你最初选择的原始图片不会被删除。', 'This map’s managed image copy is deleted. The original image you selected is never deleted.')
                : text('这张地图没有图片，不会触碰文件。', 'This map has no image, so no file is touched.')}
            </li>
          </ul>

          <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
            <p className="font-medium text-[var(--color-text)]">
              {hasChildren
                ? text(`子地图处理方式（共 ${impact.childMapCount} 张直接子地图）`, `Child map handling (${impact.childMapCount} direct child maps)`)
                : text('子地图处理方式', 'Child map handling')}
            </p>
            {hasChildren ? (
              <>
                {option(
                  'promote-children',
                  text('保留子地图，改挂到上层', 'Keep child maps, move them up'),
                  text(
                    `子地图不会删除，会成为${map.parentMapId ? '当前地图父地图' : '顶层地图'}的子地图；它们自己的地点、连接和图片完全不受影响。`,
                    `Child maps are kept and re-parented under ${map.parentMapId ? 'the parent map' : 'the top level'}; their own locations, connections, and images are untouched.`,
                  ),
                )}
                {option(
                  'cascade',
                  text('连同整棵子树一起删除', 'Delete the whole subtree'),
                  text(
                    `会额外删除全部 ${impact.descendantMapCount} 张后代地图，以及它们各自的地点、连接与托管图片副本。`,
                    `Additionally deletes all ${impact.descendantMapCount} descendant maps with their locations, connections, and managed image copies.`,
                  ),
                )}
              </>
            ) : (
              <p className="text-[var(--color-text-muted)]">
                {text('这张地图没有子地图，无需额外处理。', 'This map has no child maps, so nothing else needs handling.')}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={deleting}>{text('取消', 'Cancel')}</Button>
          <Button variant="destructive" onClick={() => void handleConfirm()} disabled={deleting}>
            <Trash2 size={13} />
            {deleting ? text('删除中...', 'Deleting...') : text('确认删除', 'Delete map')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
