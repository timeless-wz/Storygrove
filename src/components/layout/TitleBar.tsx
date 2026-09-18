import { useEffect, useState, type CSSProperties } from 'react'
import { Languages, Minus, Square, X } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useEditorStore, saveDirtyEditorChangesForExit } from '../../stores/editor-store'
import { countUnsavedEditorItems } from '../../stores/editor-unsaved'
import { discardAllEditorChanges } from '../../stores/editor-discard'
import { APP_BRAND } from '../../shared/brand'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import { sameProjectPathKey } from '../../shared/project-session-context'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { alertError } from '../ui/AlertDialog'

const isMac = navigator.userAgent.includes('Mac')
const windowControlStyle: CSSProperties = { minHeight: 22, padding: '0 6px' }

/**
 * 极简应用栏：只承担品牌、拖拽区和系统窗口控制。
 * 项目状态与创作操作都在底部状态栏或项目资源树中，避免抢占编辑空间。
 */
export default function TitleBar() {
  const text = useLocaleStore(s => s.text)
  const t = useLocaleStore(s => s.t)
  const locale = useLocaleStore(s => s.locale)
  const toggleLocale = useLocaleStore(s => s.toggleLocale)
  const [exitRequest, setExitRequest] = useState<{ requestId: string; workflowBlocked?: boolean } | null>(null)
  const [exitBusy, setExitBusy] = useState(false)
  const [exitError, setExitError] = useState<string | null>(null)

  useEffect(() => ipc.on('window:close-requested', ({ requestId }) => {
    const projectPath = useProjectStore.getState().currentProject?.path
    const hasActiveWorkflow = !!projectPath && useWorkflowStore.getState().activeRuns.some(
      run => sameProjectPathKey(run.projectPath, projectPath),
    )
    if (hasActiveWorkflow) {
      setExitError(null)
      setExitRequest({ requestId, workflowBlocked: true })
      return
    }
    const editor = useEditorStore.getState()
    if (countUnsavedEditorItems(editor.tabs, editor.draftLedgers) === 0) {
      void ipc.invoke('window:resolve-close', requestId, 'proceed').then(result => {
        if (!result.success) console.error('[TitleBar] 退出请求已失效')
      }).catch(error => console.error('[TitleBar] 退出请求失败:', error))
      return
    }
    setExitError(null)
    setExitRequest({ requestId })
  }), [])

  const cancelExit = async () => {
    const request = exitRequest
    if (!request || exitBusy) return
    setExitBusy(true)
    try {
      const result = await ipc.invoke('window:resolve-close', request.requestId, 'cancel')
      if (!result.success) throw new Error(text('退出请求已失效，请重试', 'The exit request expired. Try again.'))
      setExitRequest(null)
      setExitError(null)
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error))
    } finally {
      setExitBusy(false)
    }
  }

  const discardAndExit = async () => {
    const request = exitRequest
    if (!request || request.workflowBlocked || exitBusy) return
    setExitBusy(true)
    setExitError(null)
    try {
      const result = await ipc.invoke('window:resolve-close', request.requestId, 'cancel')
      if (!result.success) throw new Error(text('退出请求已失效，请重试', 'The exit request expired. Try again.'))
      discardAllEditorChanges()
      setExitRequest(null)
      const closeResult = await ipc.invoke('window:close')
      if (!closeResult.success) {
        await alertError(
          text('未保存修改已放弃，但无法再次发起退出。请手动重试退出。', 'Unsaved changes were discarded, but exit could not be requested again. Try exiting again.'),
          { title: text('退出失败', 'Could not exit') },
        )
      }
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error))
    } finally {
      setExitBusy(false)
    }
  }

  const saveAndExit = async () => {
    const request = exitRequest
    if (!request || request.workflowBlocked || exitBusy) return
    setExitBusy(true)
    setExitError(null)
    try {
      await saveDirtyEditorChangesForExit(useProjectStore.getState().currentProject?.path)
      const result = await ipc.invoke('window:resolve-close', request.requestId, 'proceed')
      if (!result.success) throw new Error(text('退出请求已失效，请重试', 'The exit request expired. Try again.'))
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error))
    } finally {
      setExitBusy(false)
    }
  }

  return (
    <>
      <div
        className="writer-topbar writer-topbar--minimal no-select flex items-center justify-between"
        style={{
          height: 'var(--height-titlebar)',
          paddingLeft: isMac ? 78 : 12,
          paddingRight: 8,
          WebkitAppRegion: 'drag',
        } as CSSProperties}
      >
        <div className="flex items-center gap-2">
          <div className="writer-brand-mark flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)]">
            <img className="writer-brand-image" src="/brand-icon.png" alt="" />
          </div>
          <span className="brand-gradient text-[12px] font-semibold">
            {locale === 'zh-CN' ? APP_BRAND.zhName : APP_BRAND.enName}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="writer-command-button flex items-center gap-1 text-xs"
            title={t('language.switch')}
            onClick={() => void toggleLocale()}
            style={windowControlStyle}
          >
            <Languages size={13} strokeWidth={1.5} />
            <span>{locale === 'zh-CN' ? 'EN' : '中文'}</span>
          </button>
          <div className="writer-command-divider h-3.5 w-px mx-0.5" />
          <button className="writer-command-button" aria-label={text('最小化', 'Minimize')} onClick={() => ipc.invoke('window:minimize')} style={windowControlStyle}>
            <Minus size={13} />
          </button>
          <button className="writer-command-button" aria-label={text('最大化或还原', 'Maximize or restore')} onClick={() => ipc.invoke('window:toggle-maximize')} style={windowControlStyle}>
            <Square size={12} />
          </button>
          <button className="writer-command-button" aria-label={text('关闭', 'Close')} onClick={() => ipc.invoke('window:close')} style={windowControlStyle}>
            <X size={14} />
          </button>
        </div>
      </div>

      <Dialog open={exitRequest !== null} onOpenChange={(open) => { if (!open) void cancelExit() }}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{exitRequest?.workflowBlocked
              ? text('创作任务仍在运行', 'Creative task still running')
              : text('退出前处理未保存内容', 'Handle unsaved changes before exiting')}</DialogTitle>
            <DialogDescription>
              {exitRequest?.workflowBlocked
                ? text('请先等待当前创作任务完成，或在状态栏任务窗中取消任务后再退出。', 'Wait for the current creative task to finish, or cancel it in the task popover before exiting.')
                : text('保存会使用每个编辑器现有的项目会话；无法安全保存或保存期间又有输入时，应用不会退出。', 'Each editor saves through its existing project session. The app stays open if a save is unsafe or new input arrives while saving.')}
            </DialogDescription>
          </DialogHeader>
          {exitError && <p className="text-sm" style={{ color: 'var(--color-error-text)' }}>{exitError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => void cancelExit()} disabled={exitBusy}>
              {exitRequest?.workflowBlocked ? text('知道了', 'OK') : text('取消', 'Cancel')}
            </Button>
            {!exitRequest?.workflowBlocked && <>
              <Button variant="destructive" onClick={() => void discardAndExit()} disabled={exitBusy}>{text('放弃并退出', 'Discard and exit')}</Button>
              <Button onClick={() => void saveAndExit()} disabled={exitBusy}>{exitBusy ? text('处理中...', 'Working...') : text('保存并退出', 'Save and exit')}</Button>
            </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
