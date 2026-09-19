import { useEffect, useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'

interface Props {
  open: boolean
  title: string
  /** 说明这张地图在层级中的位置，便于确认新建/重命名的对象。 */
  hint?: string
  defaultName?: string
  onClose: () => void
  onSave: (name: string) => Promise<boolean> | boolean
}

/** 新建顶层地图、新建子地图与重命名的统一命名对话框。 */
export default function WorldMapMapDialog({ open, title, hint, defaultName = '', onClose, onSave }: Props) {
  const text = useLocaleStore(s => s.text)
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setName(defaultName)
      setSaving(false)
    })
  }, [open, defaultName])

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const ok = await onSave(trimmed)
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapIcon size={16} />{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 px-6 py-4 text-xs">
          {hint && <p className="text-[var(--color-text-muted)]">{hint}</p>}
          <div>
            <Label>{text('地图名称 *', 'Map name *')}</Label>
            <Input
              value={name}
              autoFocus
              onChange={event => setName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void handleSave() }}
              placeholder={text('例如：世界总图、苍穹星地图、北境大陆地图', 'e.g. World overview, Northern continent')}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{text('取消', 'Cancel')}</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving ? text('保存中...', 'Saving...') : text('保存', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
