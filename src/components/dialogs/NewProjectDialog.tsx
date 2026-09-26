import { useState, useEffect } from 'react'
import { FolderOpen, Sparkles, Feather } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { useLocaleStore } from '../../stores/locale-store'

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
}

/** 新建项目对话框：只需作品名称和保存位置，创建后由总览创作路径承接 */
export default function NewProjectDialog({ open, onClose }: NewProjectDialogProps) {
  const createProject = useProjectStore((s) => s.createProject)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { locale, text } = useLocaleStore()

  /** 对话框每次打开时重置状态 */
  useEffect(() => {
    if (!open) return
    let mounted = true
    Promise.resolve().then(() => {
      if (mounted) {
        setName('')
        setPath('')
        setErrorMessage(null)
      }
    })
    return () => { mounted = false }
  }, [open])

  /** 选择文件夹 */
  const handleSelectFolder = async () => {
    try {
      const selected = await ipc.invoke('dialog:select-folder')
      if (selected) {
        setPath(selected)
        setErrorMessage(null)
      }
    } catch {
      // 忽略选择取消
    }
  }

  /** 创建项目（类型/受众留空，在项目总览创作路径随时填写） */
  const handleCreate = async () => {
    const trimmedName = name.trim()
    const trimmedPath = path.trim()
    if (!trimmedName || !trimmedPath || creating) return

    setCreating(true)
    setErrorMessage(null)

    try {
      const success = await createProject({
        name: trimmedName,
        path: trimmedPath,
        genre: '',
        targetAudience: '',
        writingLanguage: locale,
      })
      if (success) {
        onClose()
      } else {
        setErrorMessage(text('创建项目失败，请检查目录权限或路径有效性', 'Failed to create project. Please verify path permissions.'))
      }
    } catch (err) {
      setErrorMessage(String(err) || text('创建项目时发生异常', 'An error occurred during project creation.'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !creating && onClose()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Feather size={18} className="text-[var(--color-accent)]" />
            {text('新书立项', 'New Novel Project')}
          </DialogTitle>
          <DialogDescription>
            {text(
              '只需设定作品名称与保存位置；题材、世界观、人物与章节规划均可在创建后的总览中随时完善或直接执笔。',
              'Enter a title and save location. Worldbuilding, characters, and chapter blueprints can be configured anytime inside the overview.',
            )}
          </DialogDescription>
        </DialogHeader>

        {/* 表单 */}
        <div className="px-5 py-4 space-y-4">
          {errorMessage && (
            <div
              className="p-3 text-xs rounded-lg border leading-relaxed"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
                borderColor: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
                color: 'var(--color-error-text)',
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* 项目名称 */}
          <div>
            <Label htmlFor="novel-project-name">{text('作品名称', 'Novel Title')}</Label>
            <Input
              id="novel-project-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errorMessage) setErrorMessage(null)
              }}
              placeholder={text('如：未竟之书', 'e.g. The Unfolding Book')}
              autoFocus
              maxLength={100}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {/* 保存路径 */}
          <div>
            <Label htmlFor="novel-project-path">{text('保存位置', 'Save Location')}</Label>
            <div className="flex gap-2">
              <Input
                id="novel-project-path"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value)
                  if (errorMessage) setErrorMessage(null)
                }}
                placeholder={text('选择保存此小说工程的本地目录', 'Choose a folder to save this project')}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <Button type="button" variant="outline" onClick={handleSelectFolder}>
                <FolderOpen size={14} className="mr-1" />
                {text('选择', 'Browse')}
              </Button>
            </div>
          </div>

          <div
            className="rounded-lg p-3 text-xs border"
            style={{
              backgroundColor: 'var(--color-hover)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div className="font-medium text-[var(--color-text)] mb-1 flex items-center gap-1.5">
              <Sparkles size={13} className="text-[var(--color-accent)]" />
              {text('自由的创作流转', 'Flexible Creative Flow')}
            </div>
            {text(
              '创建后总览提供「定方向 → 建设定 → 做章节规划 → 写正文」全景引导，每一步均可跳过，作者拥有绝对自主权。',
              'After creation, an optional 4-step roadmap (Direction → World → Blueprints → Prose) is ready in the overview. All steps are skippable.',
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={creating}>
            {text('取消', 'Cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !name.trim() || !path.trim()}
          >
            <Feather size={14} className="mr-1.5" />
            {creating ? text('创建中...', 'Creating...') : text('立项创作', 'Create Project')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
