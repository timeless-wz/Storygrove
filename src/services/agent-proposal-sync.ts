/**
 * 外部 AI 提交的界面同步。
 *
 * 本地 MCP 进程直接写入项目数据库，无法触发渲染进程事件。主进程
 * AgentCommitWatchService 轮询提交回执并广播 'story-data:agent-proposal-committed'；
 * 本模块按冻结项目会话隔离地消费该事件：
 * - 通过 REFRESH_RESOURCE 驱动草稿列表 / 项目树 / 蓝图视图刷新；
 * - 打开中的草稿编辑器：干净 Tab 同步提交后的内容；有未保存修改的 Tab 只给
 *   作者可见提示，绝不把未保存正文替换成外部数据。
 */
import { globalEventBus } from '../shared/event-bus'
import type { AgentProposalCommitEvent } from '../shared/ipc-channels'
import { sameProjectPathKey } from '../shared/project-session-context'
import { ipc } from './ipc-client'
import { useEditorStore } from '../stores/editor-store'
import { useLocaleStore } from '../stores/locale-store'
import { toast } from '../components/ui/Toast'
import { isProjectSessionCurrent } from '../components/project-session-gate'

export type AgentProposalSyncResource = 'drafts' | 'blueprints' | 'fileTree'

export interface AgentProposalSyncPlan {
  /** 事件属于当前激活的项目会话时才为 true；同路径重开/切换项目后旧事件丢弃。 */
  applies: boolean
  resources: AgentProposalSyncResource[]
  /** 展示已提交草稿且无未保存修改的编辑器 Tab，可以安全同步外部内容。 */
  cleanDraftTabIds: string[]
  /** 展示已提交草稿但有未保存修改的编辑器 Tab，只提示，不写内容。 */
  dirtyDraftTabIds: string[]
  draftId: number | null
}

interface SyncableTab {
  id: string
  projectKey?: string
  filePath?: string
  dirty?: boolean
}

const DRAFT_TAB_PATH = /^vela:\/\/(?:draft|manuscript)\/(\d+)$/

export function planAgentProposalSync(
  event: AgentProposalCommitEvent,
  sessionCurrent: boolean,
  tabs: readonly SyncableTab[],
): AgentProposalSyncPlan {
  if (!sessionCurrent) {
    return { applies: false, resources: [], cleanDraftTabIds: [], dirtyDraftTabIds: [], draftId: null }
  }
  const resources: AgentProposalSyncResource[] = event.receipt?.resource === 'draft'
    ? ['drafts', 'fileTree']
    : ['blueprints', 'fileTree']
  const draftId = event.receipt?.resource === 'draft' ? (event.receipt.draftId ?? null) : null
  const cleanDraftTabIds: string[] = []
  const dirtyDraftTabIds: string[] = []
  if (draftId !== null) {
    for (const tab of tabs) {
      if (!sameProjectPathKey(tab.projectKey, event.projectPath)) continue
      const match = DRAFT_TAB_PATH.exec(tab.filePath ?? '')
      if (!match || Number(match[1]) !== draftId) continue
      if (tab.dirty) dirtyDraftTabIds.push(tab.id)
      else cleanDraftTabIds.push(tab.id)
    }
  }
  return { applies: true, resources, cleanDraftTabIds, dirtyDraftTabIds, draftId }
}

export function registerAgentProposalCommitSync(): () => void {
  return ipc.on('story-data:agent-proposal-committed', event => {
    const plan = planAgentProposalSync(
      event,
      isProjectSessionCurrent(event.projectSession),
      useEditorStore.getState().tabs,
    )
    if (!plan.applies) return
    globalEventBus.emit('REFRESH_RESOURCE', {
      resources: plan.resources,
      projectPath: event.projectPath,
      projectSession: event.projectSession,
    })
    const text = useLocaleStore.getState().text
    if (plan.dirtyDraftTabIds.length > 0) {
      toast.warning(text(
        '外部 AI 提交已更新当前打开的草稿；你的未保存修改未被覆盖，请对比后再决定是否保存',
        'An external commit updated this open draft. Your unsaved changes were not overwritten; compare before saving.',
      ))
    }
    for (const tabId of plan.cleanDraftTabIds) {
      const draftId = plan.draftId
      if (draftId === null) continue
      void ipc.invokeWithProjectSession(event.projectSession, 'db:draft-get-full', draftId, event.projectPath)
        .then(full => {
          if (!isProjectSessionCurrent(event.projectSession)) return
          // The author may start typing while the database read is in flight.
          // Check the live tab again before applying the returned content.
          const editor = useEditorStore.getState()
          const tab = editor.tabs.find(item => item.id === tabId)
          const match = DRAFT_TAB_PATH.exec(tab?.filePath ?? '')
          if (!tab || !sameProjectPathKey(tab.projectKey, event.projectPath)
            || !match || Number(match[1]) !== draftId) return
          if (tab.dirty) {
            toast.warning(text(
              '外部 AI 提交已更新当前打开的草稿；你的未保存修改未被覆盖，请对比后再决定是否保存',
              'An external commit updated this open draft. Your unsaved changes were not overwritten; compare before saving.',
            ))
            return
          }
          if (typeof full?.content === 'string') editor.syncTabContent(tabId, full.content)
        })
        .catch(error => toast.error(String(error)))
    }
  })
}
