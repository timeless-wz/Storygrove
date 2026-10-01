import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog'
import WorldNodeReferences from '../world/WorldNodeReferences'
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
  WORLD_MAP_MARKER_ICON_LABELS,
  getWorldMapMarkerIcon,
  type WorldMapMarkerIcon,
} from '../../shared/world-map'
import { WORLD_MAP_MARKER_ICONS } from './world-map-marker-icons'

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
  const [markerIcon, setMarkerIcon] = useState<WorldMapMarkerIcon | null>(null)
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
        setMarkerIcon(node.markerIcon || null)
        setParentId(node.parentId || '')
        setDescription(node.description || '')
        setX(node.x ?? 250)
        setY(node.y ?? 200)
        setSourceRef(node.sourceRefs?.join(', ') || '')
      } else {
        setName('')
        setType('city')
        setMarkerIcon(null)
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
      markerIcon,
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
      <DialogContent className="max-w-md flex flex-col overflow-hidden" style={{ maxHeight: 'min(90vh, calc(100vh - 32px))' }}>
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEditing
              ? text(`编辑地点：${node?.name}`, `Edit location: ${node?.name}`)
              : text('新建地图地点', 'New map location')}
          </DialogTitle>
        </DialogHeader>

        <div className="vela-dialog-body min-h-0 overflow-y-auto space-y-3 text-xs">
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

          <fieldset>
            <legend className="mb-1 font-medium text-[var(--color-text)]">{text('地图标识', 'Map marker')}</legend>
            <div className="grid grid-cols-6 gap-1">
              {[null, ...Object.keys(WORLD_MAP_MARKER_ICON_LABELS) as WorldMapMarkerIcon[]].map(value => {
                const icon = value || getWorldMapMarkerIcon({ type, markerIcon: null })
                const Icon = WORLD_MAP_MARKER_ICONS[icon]
                const label = value ? WORLD_MAP_MARKER_ICON_LABELS[value] : { zh: '自动', en: 'Auto' }
                const selected = value === markerIcon
                return (
                  <button
                    key={value || 'auto'}
                    type="button"
                    aria-label={text(label.zh, label.en)}
                    aria-pressed={selected}
                    title={text(label.zh, label.en)}
                    onClick={() => setMarkerIcon(value)}
                    className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md border text-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${selected ? 'border-[var(--color-accent)] bg-[var(--color-active)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'}`}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{text(label.zh, label.en)}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{text('自动随地点类型显示；也可以为建筑单独选择标识。', 'Auto follows the location type. Choose a specific marker for each building.')}</p>
          </fieldset>

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

        {/* 这个地点在世界资料里被谁引用：作者不必先记住它属于哪个世界。 */}
        {isEditing && node && <WorldNodeReferences nodeId={node.id} />}

        <DialogFooter className="shrink-0 gap-2">
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
