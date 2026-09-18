import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { WorkspaceScannerService, validateWorkspacePath } from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'
import { externalFileGrants } from '../services/external-file-grant-service'
import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { assertRequiredExpectedProjectPath } from '../utils/project-context'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import type {
  SettingRule,
  SettingRuleStatus,
  WorkspaceImportCandidateType,
  WorkspaceImportCandidateStatus,
  ChapterContextSnapshot,
} from '../../src/shared/workspace-hub'

const MUTATING_WORKSPACE_CHANNELS = new Set([
  'workspace:bind-directory',
  'workspace:unbind-directory',
  'workspace:scan',
  'workspace:cancel-scan',
  'workspace:approve-source',
  'workspace:approve-all-sources',
  'workspace:upsert-rule',
  'workspace:update-rule-status',
  'workspace:delete-rule',
  'workspace:action-candidate',
  'workspace:save-chapter-context-snapshot',
])

type WorkspaceHubHandler = (
  event: IpcMainInvokeEvent,
  projectId: string,
  ...args: unknown[]
) => unknown

/**
 * 扫描提交成功后绑定更新失败时的补偿扫描。
 *
 * 安全契约：
 * - 补偿扫描必须继承当前控制器的取消信号（用户取消原始扫描时必须同样停止补偿）；
 * - 补偿扫描必须注册独立 taskId 生命周期，使 workspace:cancel-scan 能真正中止它；
 * - 只有在“补偿扫描成功 **且** 绑定路径已恢复为原目录”时才认为补偿完成；
 * - 任何其他情况（补偿失败、补偿被取消、补偿后绑定仍未恢复）都必须显式解绑，
 *   绝不留下“旧绑定路径 + 新目录来源”或“新绑定路径 + 旧目录来源”的混合状态。
 */
async function rollbackToPreviousWorkspace(
  projectId: string,
  previousBoundPath: string,
  parentSignal: AbortSignal,
): Promise<void> {
  const compensationTaskId = randomUUID()
  const compensationController = new AbortController()
  const abortCompensation = () => compensationController.abort()
  if (parentSignal.aborted) {
    abortCompensation()
  } else {
    parentSignal.addEventListener('abort', abortCompensation, { once: true })
  }

  WorkspaceScannerService.registerScanTask(compensationTaskId, projectId, compensationController)

  try {
    let compensationSuccess = false
    try {
      const compensationScan = WorkspaceScannerService.scanDirectory(previousBoundPath, projectId, {
        signal: compensationController.signal,
        taskId: compensationTaskId,
        autoBindPath: previousBoundPath,
      })
      WorkspaceScannerService.attachTaskPromise(compensationTaskId, compensationScan)
      const compensationResult = await compensationScan
      compensationSuccess = compensationResult.success
    } catch {
      compensationSuccess = false
    }

    const boundAfterCompensation = WorkspaceHubRepository.getBoundWorkspacePath(projectId)
    if (!compensationSuccess || boundAfterCompensation !== previousBoundPath) {
      // 补偿未完整恢复既有健康状态：解绑是唯一不会产生混合来源/混合绑定的终态。
      unbindAfterFailedWorkspaceRecovery(projectId)
    }
  } finally {
    parentSignal.removeEventListener('abort', abortCompensation)
    WorkspaceScannerService.cleanupScanTask(compensationTaskId)
  }
}

function registerWorkspaceHubHandler(
  channel: string,
  handler: WorkspaceHubHandler,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const candidate = args.at(-1)
    const context = isProjectSessionContext(candidate) ? candidate : undefined
    if (context) args.pop()

    const candidateExpectedPath = typeof args.at(-1) === 'string' ? (args.at(-1) as string) : undefined
    const expectedPath = context?.projectPath ?? candidateExpectedPath

    try {
      const currentProjectPath = getCurrentProjectPath()
      const session = projectAccess.assertCurrentProjectContext(context, currentProjectPath)
      assertRequiredExpectedProjectPath(currentProjectPath, expectedPath)

      return await handler(event, session.projectId, ...args)
    } catch (error) {
      if (MUTATING_WORKSPACE_CHANNELS.has(channel)) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      throw error
    }
  })
}

interface ActiveProjectScanLifecycle {
  taskId: string
  controller: AbortController
  promise: Promise<unknown>
  cancelling: boolean
}

const activeProjectScanLifecycles = new Map<string, ActiveProjectScanLifecycle>()

function unbindAfterFailedWorkspaceRecovery(projectId: string): void {
  WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
  WorkspaceHubRepository.markAllSourcesMissingForUnboundRecovery(projectId)
}

export function registerWorkspaceHubController(): void {
  // 1. 获取中枢状态
  registerWorkspaceHubHandler('workspace:get-status', (_event, projectId) => {
    return WorkspaceHubRepository.getStatus(projectId)
  })

  // 2. 主进程工作区目录选择并签发只读/列举短期授权
  registerWorkspaceHubHandler('workspace:select-directory', async (event, projectId) => {
    if (activeProjectScanLifecycles.has(projectId)) {
      throw new Error('当前工作区有正在进行或正在取消的扫描任务，禁止更换目录')
    }

    const currentProjectPath = getCurrentProjectPath()
    const result = await dialog.showOpenDialog({
      title: '选择外部小说创作资料目录',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = result.filePaths[0]
    const validation = validateWorkspacePath(selectedPath, currentProjectPath)
    if (!validation.valid || !validation.canonicalPath) {
      throw new Error(validation.error || '所选创作资料目录无效')
    }

    const grant = externalFileGrants.issueDirectory({
      webContentsId: event.sender.id,
      directoryPath: validation.canonicalPath,
      operations: ['list', 'read'],
      ttlMs: 10 * 60 * 1000,
      maxUses: 10,
    })

    return {
      grantId: grant.grantId,
      displayName: path.basename(validation.canonicalPath),
    }
  })

  // 3. 绑定外部创作母稿目录（仅接收 grantId，严禁直接接收渲染进程伪造绝对路径）
  registerWorkspaceHubHandler('workspace:bind-directory', async (event, projectId, ...args) => {
    if (activeProjectScanLifecycles.has(projectId)) {
      return { success: false, error: '当前工作区有正在进行或正在取消的扫描任务，请稍候' }
    }

    const grantId = String(args[0] || '').trim()
    if (!grantId) {
      return { success: false, error: '缺少目录授权标识' }
    }

    const currentProjectPath = getCurrentProjectPath()

    // 同步初始化生命周期并锁定，杜绝并发竞争窗口
    const taskId = randomUUID()
    const controller = new AbortController()
    let resolveLifecyclePromise!: (val: unknown) => void
    const lifecyclePromise = new Promise(resolve => {
      resolveLifecyclePromise = resolve
    })

    const lifecycle: ActiveProjectScanLifecycle = {
      taskId,
      controller,
      promise: lifecyclePromise,
      cancelling: false,
    }
    activeProjectScanLifecycles.set(projectId, lifecycle)
    WorkspaceScannerService.registerScanTask(taskId, projectId, controller, lifecyclePromise)

    try {
      if (controller.signal.aborted || lifecycle.cancelling) {
        return { success: false, error: '扫描已取消' }
      }

      // 解析授权：非当前窗口、过期、伪造或未授予 list 的 grantId 均被抛错拒绝
      const resolved = externalFileGrants.resolve({
        grantId,
        webContentsId: event.sender.id,
        operation: 'list',
      })

      const targetDirectory = resolved.rootPath
      // 权威路径校验进入真实调用链
      const validation = validateWorkspacePath(targetDirectory, currentProjectPath)
      if (!validation.valid || !validation.canonicalPath) {
        return { success: false, error: validation.error || '工作区路径校验未通过' }
      }

      const previousBoundPath = WorkspaceHubRepository.getBoundWorkspacePath(projectId)
      const canonicalPath = validation.canonicalPath

      if (controller.signal.aborted || lifecycle.cancelling) {
        return { success: false, error: '扫描已取消' }
      }

      // 发起异步、有界、可取消扫描
      const scanPromise = WorkspaceScannerService.scanDirectory(canonicalPath, projectId, {
        signal: controller.signal,
        taskId,
        autoBindPath: canonicalPath,
      })
      scanPromise.then(resolveLifecyclePromise, resolveLifecyclePromise)

      try {
        const scanResult = await scanPromise
        if (!scanResult.success) {
          // 扫描失败或被取消：绝不更新绑定路径。若之前未绑定任何目录，确保处于完全解绑状态
          if (!previousBoundPath) {
            unbindAfterFailedWorkspaceRecovery(projectId)
          }
          return scanResult
        }

        // 验证与补偿保证：若因特殊环境或 mock 未在事务内完成绑定，执行显式绑定；
        // 若绑定更新失败，必须执行补偿回滚，绝不留下“旧绑定路径 + 新目录来源”的混合状态。
        try {
          WorkspaceHubRepository.bindWorkspaceDirectory(canonicalPath, projectId)
          return scanResult
        } catch (bindErr) {
          // 补偿扫描在原始扫描 Promise 结束前完成，生命周期锁在此期间保持不放。
          if (previousBoundPath) {
            await rollbackToPreviousWorkspace(projectId, previousBoundPath, controller.signal)
          } else {
            WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
          }
          throw bindErr
        }
      } catch (scanErr) {
        if (!previousBoundPath) {
          WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
        }
        throw scanErr
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      resolveLifecyclePromise(null)
      activeProjectScanLifecycles.delete(projectId)
      WorkspaceScannerService.cleanupScanTask?.(taskId)
      WorkspaceScannerService.cancelScanTask?.(taskId)
    }
  })

  // 4. 解除目录绑定（仅清空数据库索引与配置，绝不删除外部任何文件）
  registerWorkspaceHubHandler('workspace:unbind-directory', async (_event, projectId) => {
    if (activeProjectScanLifecycles.has(projectId)) {
      return { success: false, error: '当前工作区有正在进行或正在取消的扫描任务，禁止解绑' }
    }
    try {
      await WorkspaceScannerService.cancelAllForProject(projectId)
      WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 5. 手动重新扫描（只能使用主进程数据库中持久化的授权绑定路径，绝不接受渲染进程临时覆盖）
  registerWorkspaceHubHandler('workspace:scan', async (_event, projectId) => {
    if (activeProjectScanLifecycles.has(projectId)) {
      return {
        success: false,
        scannedCount: 0,
        recognizedCount: 0,
        enumerationComplete: false,
        truncated: true,
        truncationReason: 'concurrent_operation_blocked',
        error: '当前工作区有正在进行或正在取消的扫描任务，请稍候',
      }
    }

    const taskId = randomUUID()
    const controller = new AbortController()
    let resolveLifecyclePromise!: (val: unknown) => void
    const lifecyclePromise = new Promise(resolve => {
      resolveLifecyclePromise = resolve
    })

    const lifecycle: ActiveProjectScanLifecycle = {
      taskId,
      controller,
      promise: lifecyclePromise,
      cancelling: false,
    }
    activeProjectScanLifecycles.set(projectId, lifecycle)
    WorkspaceScannerService.registerScanTask(taskId, projectId, controller, lifecyclePromise)

    try {
      const boundPath = WorkspaceHubRepository.getBoundWorkspacePath(projectId)
      if (!boundPath) {
        return {
          success: false,
          scannedCount: 0,
          recognizedCount: 0,
          enumerationComplete: false,
          truncated: true,
          truncationReason: 'not_bound',
          error: '未关联创作母稿目录',
        }
      }

      const currentProjectPath = getCurrentProjectPath()
      const validation = validateWorkspacePath(boundPath, currentProjectPath)
      if (!validation.valid || !validation.canonicalPath) {
        return {
          success: false,
          scannedCount: 0,
          recognizedCount: 0,
          enumerationComplete: false,
          truncated: true,
          truncationReason: 'invalid_bound_path',
          error: validation.error || '关联目录已失效或不安全',
        }
      }

      if (controller.signal.aborted || lifecycle.cancelling) {
        return {
          success: false,
          scannedCount: 0,
          recognizedCount: 0,
          enumerationComplete: false,
          truncated: true,
          truncationReason: 'aborted',
          error: '扫描已取消',
        }
      }

      const scanPromise = WorkspaceScannerService.scanDirectory(validation.canonicalPath, projectId, {
        signal: controller.signal,
        taskId,
      })
      scanPromise.then(resolveLifecyclePromise, resolveLifecyclePromise)

      const scanResult = await scanPromise
      return scanResult
    } finally {
      resolveLifecyclePromise(null)
      activeProjectScanLifecycles.delete(projectId)
      WorkspaceScannerService.cleanupScanTask?.(taskId)
      WorkspaceScannerService.cancelScanTask?.(taskId)
    }
  })

  // 6. 取消扫描任务
  registerWorkspaceHubHandler('workspace:cancel-scan', async (_event, projectId, ...args) => {
    const taskId = args[0] as string | undefined
    const lifecycle = activeProjectScanLifecycles.get(projectId)
    if (lifecycle) {
      lifecycle.cancelling = true
      lifecycle.controller.abort()
    }
    if (taskId) {
      const cancelled = WorkspaceScannerService.cancelScanTask?.(taskId)
      return { success: cancelled || Boolean(lifecycle) }
    }
    if (typeof WorkspaceScannerService.abortAllForProject === 'function') {
      WorkspaceScannerService.abortAllForProject(projectId)
    } else {
      await WorkspaceScannerService.cancelAllForProject?.(projectId)
    }
    return { success: true }
  })

  // 7. 来源文件列表
  registerWorkspaceHubHandler('workspace:list-sources', (_event, projectId) => {
    return WorkspaceHubRepository.listSources(projectId)
  })

  // 8. 来源详情及片段
  registerWorkspaceHubHandler('workspace:get-source-detail', (_event, projectId, ...args) => {
    const sourceId = String(args[0] || '')
    const snapshotId = args[1] ? String(args[1]) : undefined
    const fragmentId = args[2] ? String(args[2]) : undefined
    return WorkspaceHubRepository.getSourceDetail(sourceId, projectId, snapshotId, fragmentId)
  })

  // 9. 批准单个来源文件内容快照（消除 stale 状态，原子切换 approved_snapshot_id）
  registerWorkspaceHubHandler('workspace:approve-source', (_event, projectId, ...args) => {
    const sourceId = String(args[0] || '')
    return WorkspaceHubRepository.approveSource(sourceId, projectId)
  })

  // 10. 批量批准当前所有来源快照（用于首次全量确认）
  registerWorkspaceHubHandler('workspace:approve-all-sources', (_event, projectId) => {
    return WorkspaceHubRepository.approveAllSources(projectId)
  })

  // 11. 规则列表
  registerWorkspaceHubHandler('workspace:list-rules', (_event, projectId, ...args) => {
    const rawStatus = args[0]
    const status = ['confirmed', 'candidate', 'background', 'deprecated'].includes(rawStatus as string)
      ? (rawStatus as SettingRuleStatus)
      : undefined
    return WorkspaceHubRepository.listRules(projectId, status)
  })

  // 12. 创建/更新规则
  registerWorkspaceHubHandler('workspace:upsert-rule', (_event, projectId, ...args) => {
    const rule = args[0] as SettingRule
    try {
      WorkspaceHubRepository.upsertRule({ ...rule, projectId })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 13. 更新规则状态
  registerWorkspaceHubHandler('workspace:update-rule-status', (_event, projectId, ...args) => {
    const ruleId = String(args[0] || '')
    const status = args[1] as SettingRuleStatus
    try {
      WorkspaceHubRepository.updateRuleStatus(ruleId, projectId, status)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 14. 删除规则
  registerWorkspaceHubHandler('workspace:delete-rule', (_event, projectId, ...args) => {
    const ruleId = String(args[0] || '')
    try {
      WorkspaceHubRepository.deleteRule(ruleId, projectId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 15. 候选列表
  registerWorkspaceHubHandler('workspace:list-candidates', (_event, projectId, ...args) => {
    const validTypes = ['character', 'setting', 'blueprint', 'lead']
    const validStatuses = ['pending', 'approved', 'rejected']
    const candidateType = validTypes.includes(args[0] as string)
      ? (args[0] as WorkspaceImportCandidateType)
      : undefined
    const status = validStatuses.includes(args[1] as string)
      ? (args[1] as WorkspaceImportCandidateStatus)
      : undefined
    return WorkspaceHubRepository.listCandidates({ projectId, candidateType, status })
  })

  // 16. 审批/拒绝候选（带回执与崩溃恢复防护）
  registerWorkspaceHubHandler('workspace:action-candidate', (_event, projectId, ...args) => {
    const candidateId = String(args[0] || '')
    const action = args[1] as 'approve' | 'reject'
    if (action === 'approve') {
      return WorkspaceHubRepository.approveCandidate(candidateId, projectId)
    }
    return WorkspaceHubRepository.rejectCandidate(candidateId, projectId)
  })

  // 17. 章节上下文包确定性装配（默认 includeCandidates: false）
  registerWorkspaceHubHandler('workspace:assemble-chapter-context', (_event, projectId, ...args) => {
    const chapterNumber = Number(args[0]) || 1
    const budgetChars = typeof args[1] === 'number' ? args[1] : undefined
    const includeCandidates = typeof args[2] === 'boolean' ? args[2] : undefined
    return ChapterContextAssembler.assemble({ projectId, chapterNumber, budgetChars, includeCandidates })
  })

  // 18. 保存章节上下文快照（存入独立的 chapter_context_snapshots 表，严禁写入 blueprints）
  registerWorkspaceHubHandler('workspace:save-chapter-context-snapshot', (_event, projectId, ...args) => {
    const snapshot = args[0] as ChapterContextSnapshot
    try {
      return WorkspaceHubRepository.saveChapterContextSnapshot({ ...snapshot, projectId })
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
