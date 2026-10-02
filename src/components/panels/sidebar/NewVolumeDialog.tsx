import { useState } from 'react'
import { ipc } from '../../../services/ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { globalEventBus } from '../../../shared/event-bus'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { toast } from '../../ui/Toast'

export function NewVolumeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const text = useLocaleStore(state => state.text)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session || busy) return
    setBusy(true)
    try {
      const volumes = await ipc.invokeWithProjectSession(session, 'db:prose-volume-list', session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      const order = Math.max(0, ...volumes.map(volume => volume.sortOrder)) + 1
      const result = await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-upsert', {
        id: `volume-${crypto.randomUUID()}`, name: name.trim() || text(`第${order}卷`, `Volume ${order}`), sortOrder: order,
      }, session.projectPath)
      if (!isProjectSessionCurrent(session)) return
      if (!result.success) throw new Error(result.error)
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['blueprints'], projectPath: session.projectPath, projectSession: session })
      setName('')
      onOpenChange(false)
    } catch (error) {
      if (isProjectSessionCurrent(session)) toast.error(String(error))
    } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setName(''); onOpenChange(value) } }}>
    <DialogContent className="max-w-[420px]">
      <DialogHeader><DialogTitle>{text('添加卷', 'Add volume')}</DialogTitle><DialogDescription>{text('创建卷后，点击卷旁的 ＋ 添加章节。', 'After creating a volume, use its + button to add chapters.')}</DialogDescription></DialogHeader>
      <div className="px-6 py-5"><label htmlFor="new-prose-volume-name">{text('卷名称（留空自动编号）', 'Volume name (leave blank to number automatically)')}</label>
        <Input id="new-prose-volume-name" value={name} onChange={event => setName(event.target.value)} autoFocus disabled={busy} /></div>
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{text('取消', 'Cancel')}</Button>
        <Button disabled={busy} onClick={() => void create()}>{busy ? text('创建中…', 'Creating…') : text('创建卷', 'Create volume')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
