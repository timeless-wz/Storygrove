import { useEffect, useState } from 'react'

import { ipc } from '../../../services/ipc-client'
import { globalEventBus } from '../../../shared/event-bus'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { toast } from '../../ui/Toast'
import { Button } from '../../ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/Dialog'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../../project-session-gate'

export interface BlueprintBindingTarget {
  draftId: number
  chapterNumber: number
  blueprintChapterNumber?: number
  label: string
}

export function BlueprintBindingDialog({
  target,
  open,
  onOpenChange,
}: {
  target: BlueprintBindingTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const [blueprints, setBlueprints] = useState<Array<{ chapterNumber: number; title: string }>>([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !target) return
    setSelected(target.blueprintChapterNumber ? String(target.blueprintChapterNumber) : '')
    let cancelled = false
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession) return
    void Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-list-summary', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-summary-list', projectSession.projectPath),
    ])
      .then(([items, v2Summaries]) => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) {
          const byChapter = new Map(items.map(item => [item.chapterNumber, item.title]))
          for (const summary of v2Summaries) {
            if (!byChapter.has(summary.chapterNumber)) {
              const sceneHint = summary.sceneTitles[0]
              byChapter.set(summary.chapterNumber, sceneHint || `第${summary.chapterNumber}章`)
            }
          }
          setBlueprints([...byChapter]
            .sort(([left], [right]) => left - right)
            .map(([chapterNumber, title]) => ({ chapterNumber, title })))
        }
      })
      .catch(() => {
        if (!cancelled && isProjectSessionCurrent(projectSession)) setBlueprints([])
      })
    return () => { cancelled = true }
  }, [currentProject, open, target])

  const save = async () => {
    if (!target) return
    const projectSession = captureProjectSession(currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, projectSession.projectPath)) return
    setSaving(true)
    try {
      const selectedChapter = selected ? Number(selected) : null
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-set-blueprint',
        target.draftId,
        selectedChapter,
        projectSession.projectPath,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success) throw new Error(result.error || text('绑定失败', 'Could not bind the blueprint'))
      globalEventBus.emit('REFRESH_RESOURCE', {
        resources: ['drafts', 'fileTree', 'blueprints'],
        projectPath: projectSession.projectPath,
        projectSession,
      })
      toast.success(selectedChapter
        ? text('已绑定章节蓝图', 'Chapter blueprint linked')
        : text('已解绑章节蓝图', 'Chapter blueprint unlinked'))
      onOpenChange(false)
    } catch (error) {
      if (isProjectSessionCurrent(projectSession)) {
        toast.error(text(`蓝图绑定失败：${error}`, `Could not bind blueprint: ${error}`))
      }
    } finally {
      if (isProjectSessionCurrent(projectSession)) setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{text('绑定章节蓝图', 'Link chapter blueprint')}</DialogTitle>
          <DialogDescription>
            {target
              ? text(`为「${target.label}」选择一个蓝图；发布到正文后此关联会保留。`, `Choose a blueprint for “${target.label}”. The link remains after publishing.`)
              : text('选择要关联的章节蓝图。', 'Choose a chapter blueprint to link.')}
          </DialogDescription>
        </DialogHeader>
        <div className="vela-dialog-body">
          <label className="vela-dialog-field-label" htmlFor="blueprint-binding-select">
            {text('选择蓝图', 'Choose a blueprint')}
          </label>
          <select
            id="blueprint-binding-select"
            className="vela-dialog-select"
            value={selected}
            onChange={event => setSelected(event.target.value)}
          >
            <option value="">{text('不绑定蓝图', 'No blueprint')}</option>
            {blueprints.map(blueprint => (
              <option key={blueprint.chapterNumber} value={blueprint.chapterNumber}>
                {text(`第${blueprint.chapterNumber}章 ${blueprint.title || '未命名蓝图'}`, `Chapter ${blueprint.chapterNumber} ${blueprint.title || 'Untitled blueprint'}`)}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{text('取消', 'Cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving ? text('保存中...', 'Saving...') : text('保存绑定', 'Save link')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
