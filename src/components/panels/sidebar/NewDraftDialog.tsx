import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

import { ipc } from '../../../services/ipc-client'
import { globalEventBus } from '../../../shared/event-bus'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { Button } from '../../ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/Dialog'
import { Input } from '../../ui/Input'
import { toast } from '../../ui/Toast'
import {
  captureProjectSession,
  isProjectSessionCurrent,
  isProjectSessionPath,
} from '../../project-session-gate'

interface NewDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  suggestedChapterNumber: number
}

/**
 * 从草稿箱或正文章节发起的同一个“新章节”动作。
 * 新章节必须先是可编辑草稿；作者点击定稿后，既有发布流程才会把它移入正文章节。
 */
export function NewDraftDialog({
  open,
  onOpenChange,
  suggestedChapterNumber,
}: NewDraftDialogProps) {
  const text = useLocaleStore(s => s.text)
  const currentProject = useProjectStore(s => s.currentProject)
  const projectKey = currentProject?.path
  const [chapterNumberInput, setChapterNumberInput] = useState(String(suggestedChapterNumber))
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) setChapterNumberInput(String(suggestedChapterNumber))
  }, [open, suggestedChapterNumber])

  const createDraft = async () => {
    const chapterNumber = Number(chapterNumberInput)
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      toast.error(text('请输入大于 0 的整数章节号', 'Enter a whole chapter number greater than 0.'))
      return
    }
    const projectSession = captureProjectSession(currentProject)
    if (!projectKey || !projectSession || !isProjectSessionPath(projectSession, projectKey)) return

    setCreating(true)
    try {
      const version = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-next-version',
        chapterNumber,
        projectKey,
      )
      if (!isProjectSessionCurrent(projectSession)) return

      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-create',
        { chapterNumber, version, source: 'write', content: '', wordCount: 0 },
        projectKey,
      )
      if (!isProjectSessionCurrent(projectSession)) return
      if (!result.success || !result.id) {
        toast.error(text(`创建草稿失败：${result.error || '未知错误'}`, `Could not create draft: ${result.error || 'Unknown error'}`))
        return
      }

      await useDraftStore.getState().loadChapterDrafts(chapterNumber, projectKey, projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      globalEventBus.emit('REFRESH_RESOURCE', {
        resources: ['drafts', 'fileTree'],
        projectPath: projectKey,
        projectSession,
      })
      const draftPath = `vela://draft/${result.id}`
      useEditorStore.getState().openFile({
        id: draftPath,
        name: text(`第${chapterNumber}章 · 自由创作 v${version}`, `Chapter ${chapterNumber} · Free draft v${version}`),
        type: 'chapter',
        filePath: draftPath,
        content: '',
        savedContent: '',
        draftId: result.id,
        chapterNumber,
        draftStatus: 'draft',
        projectKey,
        projectSessionLease: projectSession.leaseId,
      })
      onOpenChange(false)
      toast.success(text(`已创建第 ${chapterNumber} 章草稿；定稿后会自动发布到正文`, `Created Chapter ${chapterNumber} draft. It will move to the manuscript when finalized.`))
    } catch (error) {
      toast.error(text(`创建草稿失败：${String(error)}`, `Could not create draft: ${String(error)}`))
    } finally {
      if (isProjectSessionCurrent(projectSession)) setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{text('新建章节草稿', 'Create chapter draft')}</DialogTitle>
          <DialogDescription>
            {text('先直接写正文；点击定稿后，这一章会自动发布到正文章节。', 'Write first. When you finalize it, this chapter is automatically published to the manuscript.')}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-5">
          <label className="block text-sm font-medium mb-2" htmlFor="new-draft-chapter-number">
            {text('章节号', 'Chapter number')}
          </label>
          <Input
            id="new-draft-chapter-number"
            type="number"
            min={1}
            step={1}
            value={chapterNumberInput}
            onChange={event => setChapterNumberInput(event.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
            {text('取消', 'Cancel')}
          </Button>
          <Button onClick={createDraft} disabled={creating}>
            <Plus size={14} />
            {creating ? text('创建中…', 'Creating…') : text('创建并开始写作', 'Create and start writing')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
