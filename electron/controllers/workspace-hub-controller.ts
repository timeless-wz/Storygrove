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

export function registerWorkspaceHubController(): void {
  // 1. 获取中枢状态
  registerWorkspaceHubHandler('workspace:get-status', (_event, projectId) => {
    return WorkspaceHubRepository.getStatus(projectId)
  })

  // 2. 主进程工作区目录选择并签发只读/列举短期授权
  registerWorkspaceHubHandler('workspace:select-directory', async event => {
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
    const grantId = String(args[0] || '').trim()
    if (!grantId) {
      return { success: false, error: '缺少目录授权标识' }
    }

    const currentProjectPath = getCurrentProjectPath()

    try {
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

      const canonicalPath = validation.canonicalPath
      WorkspaceHubRepository.bindWorkspaceDirectory(canonicalPath, projectId)

      // 发起异步、有界、可取消扫描
      const taskId = randomUUID()
      const controller = new AbortController()
      WorkspaceScannerService.registerScanTask(taskId, projectId, controller)

      try {
        const scanResult = await WorkspaceScannerService.scanDirectory(canonicalPath, projectId, {
          signal: controller.signal,
          taskId,
        })
        if (!scanResult.success) {
          const status = WorkspaceHubRepository.getStatus(projectId)
          if (status.totalFiles === 0) {
            WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
          }
        }
        return scanResult
      } catch (scanErr) {
        const status = WorkspaceHubRepository.getStatus(projectId)
        if (status.totalFiles === 0) {
          WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
        }
        throw scanErr
      } finally {
        WorkspaceScannerService.cancelScanTask(taskId)
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 4. 解除目录绑定（仅清空数据库索引与配置，绝不删除外部任何文件）
  registerWorkspaceHubHandler('workspace:unbind-directory', (_event, projectId) => {
    try {
      WorkspaceScannerService.cancelAllForProject(projectId)
      WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // 5. 手动重新扫描（只能使用主进程数据库中持久化的授权绑定路径，绝不接受渲染进程临时覆盖）
  registerWorkspaceHubHandler('workspace:scan', async (_event, projectId) => {
    const boundPath = WorkspaceHubRepository.getBoundWorkspacePath(projectId)
    if (!boundPath) {
      return { success: false, scannedCount: 0, recognizedCount: 0, error: '未关联创作母稿目录' }
    }

    const currentProjectPath = getCurrentProjectPath()
    const validation = validateWorkspacePath(boundPath, currentProjectPath)
    if (!validation.valid || !validation.canonicalPath) {
      return {
        success: false,
        scannedCount: 0,
        recognizedCount: 0,
        error: validation.error || '关联目录已失效或不安全',
      }
    }

    const taskId = randomUUID()
    const controller = new AbortController()
    WorkspaceScannerService.registerScanTask(taskId, projectId, controller)

    try {
      const scanResult = await WorkspaceScannerService.scanDirectory(validation.canonicalPath, projectId, {
        signal: controller.signal,
        taskId,
      })
      return scanResult
    } finally {
      WorkspaceScannerService.cancelScanTask(taskId)
    }
  })

  // 6. 取消扫描任务
  registerWorkspaceHubHandler('workspace:cancel-scan', (_event, projectId, ...args) => {
    const taskId = args[0] as string | undefined
    if (taskId) {
      const cancelled = WorkspaceScannerService.cancelScanTask(taskId)
      return { success: cancelled }
    }
    WorkspaceScannerService.cancelAllForProject(projectId)
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
