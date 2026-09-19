import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Textarea } from '../ui/Textarea'
import { NativeSelect } from '../ui/NativeSelect'
import { useLocaleStore } from '../../stores/locale-store'
import {
  type WorldMapNode,
  type WorldMapNodeType,
  WORLD_MAP_NODE_TYPE_LABELS,
} from '../../shared/world-map'

interface Props {
  open: boolean
  node: WorldMapNode | null
  /** 只包含当前地图内部的地点：父地点选择绝不能跨地图。 */
  existingNodes: WorldMapNode[]
  mapId: string
  mapName: string
  onClose: () => void
  onSave: (node: WorldMapNode) => Promise<boolean>
}

export default function WorldMapNodeDialog({
  open,
  node,
  existingNodes,
  mapId,
  mapName,
  onClose,
  onSave,
}: Props) {
  const text = useLocaleStore(s => s.text)
  const isEditing = Boolean(node)

  const [name, setName] = useState('')
  const [type, setType] = useState<WorldMapNodeType>('city')
  const [parentId, setParentId] = useState<string>('')
  const [description, setDescription] = useState('')
  const [x, setX] = useState(250)
  const [y, setY] = useState(200)
  const [sourceRef, setSourceRef] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      if (node) {
        setName(node.name)
        setType(node.type)
        setParentId(node.parentId || '')
        setDescription(node.description || '')
        setX(node.x ?? 250)
        setY(node.y ?? 200)
        setSourceRef(node.sourceRefs?.join(', ') || '')
      } else {
        setName('')
        setType('city')
        setParentId('')
        setDescription('')
        setX(250 + Math.floor(Math.random() * 80))
        setY(200 + Math.floor(Math.random() * 80))
        setSourceRef('')
      }
    })
  }, [node, open])

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)

    const sourceRefs = sourceRef
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(Boolean)

    const nodeData: WorldMapNode = {
      id: node?.id || `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      type,
      // 归属地图不可编辑：一个地点必须且只能绑定一张地图。
      mapId,
      parentId: parentId || null,
      description: description.trim(),
      x,
      y,
      sourceRefs,
      createdAt: node?.createdAt,
    }

    try {
      const ok = await onSave(nodeData)
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  // Candidates for parent node (exclude current node to prevent cycle)
  const potentialParents = existingNodes.filter(n => n.id !== node?.id)

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? text(`编辑地点：${node?.name}`, `Edit location: ${node?.name}`)
              : text('新建地图地点', 'New map location')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <p className="text-[var(--color-text-muted)]">
            {text(
              `这个地点属于「${mapName}」，只会在该地图上出现。父地点与本地图内的连接都限制在同一张地图。`,
              `This location belongs to “${mapName}” and only appears on that map. Parent locations and connections are limited to this map.`,
            )}
          </p>

          <div>
            <Label>{text('地点名称 *', 'Location name *')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={text('例如：白银之城、苍穹之塔、星海遗境', 'e.g. Silver City, Astral Ruins')}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{text('地点类型', 'Type')}</Label>
              <NativeSelect
                value={type}
                onChange={e => setType(e.target.value as WorldMapNodeType)}
              >
                {Object.entries(WORLD_MAP_NODE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {text(v.zh, v.en)}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div>
              <Label>{text('所属地图', 'Map')}</Label>
              <Input value={mapName} readOnly disabled />
            </div>
          </div>

          <div>
            <Label>{text('父级地点（可选，仅限本地图）', 'Parent location (optional, this map only)')}</Label>
            <NativeSelect
              value={parentId}
              onChange={e => setParentId(e.target.value)}
            >
              <option value="">{text('（无父级 / 顶层地点）', '(None / Top-level)')}</option>
              {potentialParents.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({text(WORLD_MAP_NODE_TYPE_LABELS[p.type]?.zh || p.type, p.type)})
                </option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <Label>{text('地理与设定描述', 'Description')}</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={text('记录该地点的地貌特征、气候、危险度、势力归属或重要历史...', 'Record geographic features, climate, hazards, factions, or lore...')}
            />
          </div>

          <div>
            <Label>{text('关联资料 / 来源出处（逗号分隔）', 'Source references')}</Label>
            <Input
              value={sourceRef}
              onChange={e => setSourceRef(e.target.value)}
              placeholder={text('例如：03_里世界探索.md, 遗境清单', 'e.g. 03_exploration.md')}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {text('取消', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? text('保存中...', 'Saving...') : text('保存地点', 'Save location')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
