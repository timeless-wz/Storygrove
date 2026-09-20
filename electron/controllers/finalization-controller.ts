import { ipcMain } from 'electron'

import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { FinalizationService } from '../services/finalization-service'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import type { FinalizationSnapshot } from '../../src/services/finalization-snapshot'
import { auditChapter } from '../services/continuity-audit-service'

const finalizationService = new FinalizationService()

function isFinalizationSnapshot(value: unknown): value is FinalizationSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<FinalizationSnapshot>
  return (
    typeof snapshot.tabId === 'string'
    && typeof snapshot.projectPath === 'string'
    && isProjectSessionContext(snapshot.projectSession)
    && Number.isInteger(snapshot.draftId)
    && Number.isInteger(snapshot.chapterNumber)
    && typeof snapshot.chapterTitle === 'string'
    && typeof snapshot.content === 'string'
    && Number.isInteger(snapshot.contentRevision)
  )
}

function snapshotMatchesContext(
  snapshot: FinalizationSnapshot,
  context: ProjectSessionContext,
): boolean {
  return snapshot.projectPath === context.projectPath
    && snapshot.projectSession.projectId === context.projectId
    && snapshot.projectSession.leaseId === context.leaseId
    && snapshot.projectSession.projectPath === context.projectPath
}

/**
 * #23 的窄 IPC 边界。这里不复用 db-controller 的路径兼容调用，也不向 shared
 * IPC 增加宽泛路径 API；每个动作都必须带 #21 的当前项目会话并由 ProjectAccess
 * 重新验证。
 */
export function registerFinalizationController(): void {
  // “发布到正文”不再把作者的正文锁定为不可编辑的定稿。它只将当前内容
  // 投影到正文章节；后续保存会以相同正文身份同步最新内容。
  ipcMain.handle('publication:publish', async (
    _event,
    candidate: unknown,
    context: unknown,
  ) => {
    try {
      if (!isFinalizationSnapshot(candidate)) throw new Error('正文发布快照无效')
      if (!isProjectSessionContext(context) || !snapshotMatchesContext(candidate, context)) {
        throw new Error('正文发布快照与项目会话不匹配')
      }
      const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
      return await finalizationService.finalize({
        projectRoot: active.rootPath,
        draftId: candidate.draftId,
        chapterNumber: candidate.chapterNumber,
        chapterTitle: candidate.chapterTitle,
        content: candidate.content,
        contentRevision: candidate.contentRevision,
      })
    } catch (error) {
      return { success: false, committed: false, error: String(error) }
    }
  })

  ipcMain.handle('finalization:commit', async (
    _event,
    candidate: unknown,
    context: unknown,
  ) => {
    try {
      if (!isFinalizationSnapshot(candidate)) {
        throw new Error('定稿快照无效')
      }
      if (!isProjectSessionContext(context) || !snapshotMatchesContext(candidate, context)) {
        throw new Error('定稿快照与项目会话不匹配')
      }
      const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
      const audit = auditChapter({
        projectId: active.projectId,
        chapterNumber: candidate.chapterNumber,
        content: candidate.content,
        ruleSet: 'deterministic-pre-finalization-v1',
      })
      const blocking = audit.findings.filter(finding =>
        (finding.severity === 'error' || finding.severity === 'high') && finding.status === 'open',
      )
      if (blocking.length > 0) {
        return {
          success: false,
          committed: false,
          error: `定稿被连续性审核阻止：${blocking.map(finding => finding.ruleCode).join('、')}（运行 ${audit.runId}）`,
        }
      }
      return await finalizationService.finalize({
        projectRoot: active.rootPath,
        draftId: candidate.draftId,
        chapterNumber: candidate.chapterNumber,
        chapterTitle: candidate.chapterTitle,
        content: candidate.content,
        contentRevision: candidate.contentRevision,
      })
    } catch (error) {
      return { success: false, committed: false, error: String(error) }
    }
  })

  ipcMain.handle('finalization:retry', async (
    _event,
    finalizationId: unknown,
    context: unknown,
  ) => {
    try {
      if (typeof finalizationId !== 'string' || !finalizationId) {
        throw new Error('缺少可重试的定稿提交身份')
      }
      if (!isProjectSessionContext(context)) {
        throw new Error('缺少项目会话，已拒绝实体稿重试')
      }
      const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
      return await finalizationService.retry({
        projectRoot: active.rootPath,
        finalizationId,
      })
    } catch (error) {
      return { success: false, committed: false, error: String(error) }
    }
  })
}
