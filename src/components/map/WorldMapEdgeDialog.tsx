import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { useLocaleStore } from '../../stores/locale-store'
import {
  type WorldMapNode,
  type WorldMapEdge,
  type WorldMapEdgeType,
  WORLD_MAP_EDGE_TYPE_LABELS,
} from '../../shared/world-map'

interface Props {
  open: boolean
  edge: WorldMapEdge | null
  /** 只包含当前地图内部的地点。两端都在同一张地图内，跨地图连接不可能建立。 */
  nodes: WorldMapNode[]
  mapName: string
  defaultFromNodeId?: string | null
  onClose: () => void
  onSave: (edge: WorldMapEdge) => Promise<boolean>
}

export default function WorldMapEdgeDialog({
  open,
  edge,
  nodes,
  mapName,
  defaultFromNodeId,
  onClose,
  onSave,
}: Props) {
  const text = useLocaleStore(s => s.text)
  const isEditing = Boolean(edge)

  const [fromNodeId, setFromNodeId] = useState('')
  const [toNodeId, setToNodeId] = useState('')
  const [type, setType] = useState<WorldMapEdgeType>('route')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'active' | 'blocked' | 'hidden'>('active')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      if (edge) {
        setFromNodeId(edge.fromNodeId)
        setToNodeId(edge.toNodeId)
        setType(edge.type)
        setDescription(edge.description || '')
        setStatus(edge.status || 'active')
      } else {
        setFromNodeId(defaultFromNodeId || (nodes[0]?.id ?? ''))
        setToNodeId(nodes[1]?.id ?? nodes[0]?.id ?? '')
        setType('route')
        setDescription('')
        setStatus('active')
      }
    })
  }, [edge, open, defaultFromNodeId, nodes])

  const handleSave = async () => {
    if (!fromNodeId || !toNodeId) return
    if (fromNodeId === toNodeId) return
    setSaving(true)

    const edgeData: WorldMapEdge = {
      id: edge?.id || `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fromNodeId,
      toNodeId,
      type,
      description: description.trim(),
      status,
      createdAt: edge?.createdAt,
    }

    try {
      const ok = await onSave(edgeData)
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? text('编辑地点连接/航路', 'Edit location connection')
              : text('新建地点连接/航路', 'New location connection')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <p className="text-[var(--color-text-muted)]">
            {text(
              `两端地点都必须在「${mapName}」内部。连接只在这张地图上显示，不会跨地图。`,
              `Both endpoints must belong to “${mapName}”. The connection is only shown on this map and never crosses maps.`,
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{text('起点地点 *', 'From location *')}</Label>
              <NativeSelect
                value={fromNodeId}
                onChange={e => setFromNodeId(e.target.value)}
              >
                {nodes.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div>
              <Label>{text('终点地点 *', 'To location *')}</Label>
              <NativeSelect
                value={toNodeId}
                onChange={e => setToNodeId(e.target.value)}
              >
                {nodes.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{text('连接关系类型', 'Relationship type')}</Label>
              <NativeSelect
                value={type}
                onChange={e => setType(e.target.value as WorldMapEdgeType)}
              >
                {Object.entries(WORLD_MAP_EDGE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {text(v.zh, v.en)}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div>
              <Label>{text('连接状态', 'Status')}</Label>
              <NativeSelect
                value={status}
                onChange={e => setStatus(e.target.value as 'active' | 'blocked' | 'hidden')}
              >
                <option value="active">{text('通畅 / 正常', 'Active / Clear')}</option>
                <option value="blocked">{text('阻断 / 危险', 'Blocked / Hazardous')}</option>
                <option value="hidden">{text('隐秘 / 未知', 'Hidden / Unknown')}</option>
              </NativeSelect>
            </div>
          </div>

          <div>
            <Label>{text('关系说明 / 航道特征', 'Description / Route Details')}</Label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={text('例如：需飞空艇航行3日、界隙传送通道、长期交战前线', 'e.g. 3-day airship voyage, rift portal, war frontier')}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {text('取消', 'Cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !fromNodeId || !toNodeId || fromNodeId === toNodeId}
          >
            {saving ? text('保存中...', 'Saving...') : text('保存连接', 'Save connection')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
