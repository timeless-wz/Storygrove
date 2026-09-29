import { BrowserWindow } from 'electron'
import { getCurrentProjectPath } from '../database'
import { getAgentProposalCommitState } from './agent-proposal-service'
import type { AgentProposalCommitReceipt } from './agent-proposal-service'
import type { ProjectSessionLease } from './project-access'
import { projectAccess } from './project-access'

/**
 * 作者批准外部提案后，实际写入仍由本地 MCP 进程在任意时刻完成——它无法直接
 * 通知渲染进程。该服务在主进程轮询项目数据库，把「提案已提交」以携带冻结项目
 * 会话的事件广播给所有窗口；渲染进程按会话隔离决定是否刷新视图。
 *
 * 提交只能在提案所属的 MCP 会话过期前发生，因此监听在到达终态
 * （committed / rejected / 会话过期）后即停止，不会长期空转。
 */

const POLL_INTERVAL_MS = 1_200

const watchers = new Map<string, ReturnType<typeof setInterval>>()

function stopWatch(proposalId: string): void {
  const timer = watchers.get(proposalId)
  if (timer) {
    clearInterval(timer)
    watchers.delete(proposalId)
  }
}

function poll(proposalId: string, lease: ProjectSessionLease): void {
  try {
    // 项目切换或同路径重开会换租约：旧监听立即失效，事件绝不跨会话投递。
    try {
      projectAccess.assertCurrentSession({ projectId: lease.projectId, leaseId: lease.leaseId })
    } catch {
      stopWatch(proposalId)
      return
    }
    const currentPath = getCurrentProjectPath()
    if (!currentPath || !projectAccess.sameCanonicalProjectRoot(currentPath, lease.rootPath)) {
      stopWatch(proposalId)
      return
    }
    const state = getAgentProposalCommitState(lease.projectId, proposalId)
    if (!state) {
      stopWatch(proposalId)
      return
    }
    if (state.status === 'committed' && state.receipt) {
      stopWatch(proposalId)
      broadcastCommit(proposalId, state.proposalType, state.receipt, lease)
      return
    }
    if (state.status === 'rejected' || !state.sessionLive) {
      // 作者已拒绝；或提案所属 MCP 会话已过期——无论状态如何都不可能再提交。
      stopWatch(proposalId)
    }
  } catch {
    // 数据库已关闭（项目关闭/退出）等不可恢复场景：停止轮询而不是报错循环。
    stopWatch(proposalId)
  }
}

function broadcastCommit(
  proposalId: string,
  proposalType: string,
  receipt: AgentProposalCommitReceipt,
  lease: ProjectSessionLease,
): void {
  const payload = {
    proposalId,
    projectId: lease.projectId,
    proposalType,
    receipt,
    projectPath: lease.rootPath,
    projectSession: {
      projectId: lease.projectId,
      leaseId: lease.leaseId,
      projectPath: lease.rootPath,
    },
  }
  for (const target of BrowserWindow.getAllWindows()) {
    if (target.isDestroyed() || target.webContents.isDestroyed()) continue
    target.webContents.send('story-data:agent-proposal-committed', payload)
  }
}

export function watchAgentProposalCommit(proposalId: string, lease: ProjectSessionLease): void {
  if (!proposalId || watchers.has(proposalId)) return
  const timer = setInterval(() => poll(proposalId, lease), POLL_INTERVAL_MS)
  watchers.set(proposalId, timer)
}
