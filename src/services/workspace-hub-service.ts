import { ipc } from './ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  WorkspaceHubStatus,
  WorkspaceSource,
  WorkspaceSourceFragment,
  SettingRule,
  SettingRuleStatus,
  WorkspaceImportCandidate,
  WorkspaceImportCandidateType,
  WorkspaceImportCandidateStatus,
  ChapterContextBundle,
  ChapterContextSnapshot,
} from '../shared/workspace-hub'

export const workspaceHubService = {
  /** 获取中枢状态 */
  async getStatus(session: ProjectSessionContext): Promise<WorkspaceHubStatus> {
    return ipc.invokeWithProjectSession(session, 'workspace:get-status', session.projectPath)
  },

  /** 打开系统文件选择器并获取外部目录短期授权标识 */
  async selectDirectory(session: ProjectSessionContext): Promise<{ grantId: string; displayName: string } | null> {
    return ipc.invokeWithProjectSession(session, 'workspace:select-directory', session.projectPath)
  },

  /** 通过授权标识绑定外部目录并触发首次扫描（Renderer严禁传入原始绝对路径） */
  async bindDirectory(
    session: ProjectSessionContext,
    grantId: string,
  ): Promise<{
    success: boolean
    scannedCount?: number
    recognizedCount?: number
    error?: string
  }> {
    return ipc.invokeWithProjectSession(session, 'workspace:bind-directory', grantId, session.projectPath)
  },

  /** 解除外部目录关联（不删除外部文件） */
  async unbindDirectory(session: ProjectSessionContext): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:unbind-directory', session.projectPath)
  },

  /** 重新扫描已关联目录（使用数据库中已授权绑定路径，不可被覆盖） */
  async rescan(session: ProjectSessionContext, taskId?: string): Promise<{
    success: boolean
    scannedCount?: number
    recognizedCount?: number
    error?: string
  }> {
    return ipc.invokeWithProjectSession(session, 'workspace:scan', taskId, session.projectPath)
  },

  /** 取消正在执行的扫描任务 */
  async cancelScan(session: ProjectSessionContext, taskId?: string): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:cancel-scan', taskId, session.projectPath)
  },

  /** 批准单个来源文件内容快照（消除 stale 状态，原子切换 approved_snapshot_id） */
  async approveSource(session: ProjectSessionContext, sourceId: string): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:approve-source', sourceId, session.projectPath)
  },

  /** 批量批准当前所有来源快照 */
  async approveAllSources(session: ProjectSessionContext): Promise<{ success: boolean; count?: number; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:approve-all-sources', session.projectPath)
  },

  /** 列出所有外部来源文件 */
  async listSources(session: ProjectSessionContext): Promise<WorkspaceSource[]> {
    return ipc.invokeWithProjectSession(session, 'workspace:list-sources', session.projectPath)
  },

  /** 获取单个外部来源文件详情与标题片段 */
  async getSourceDetail(
    session: ProjectSessionContext,
    sourceId: string,
    snapshotId?: string | null,
    fragmentId?: string | null,
  ): Promise<{
    source: WorkspaceSource | null
    fragments: WorkspaceSourceFragment[]
    targetSnapshotId?: string | null
    provenanceStatus?: 'found' | 'provenance-missing'
  }> {
    return ipc.invokeWithProjectSession(
      session,
      'workspace:get-source-detail',
      sourceId,
      snapshotId,
      fragmentId,
      session.projectPath,
    )
  },

  /** 列出设定规则 */
  async listRules(session: ProjectSessionContext, status?: SettingRuleStatus): Promise<SettingRule[]> {
    return ipc.invokeWithProjectSession(session, 'workspace:list-rules', status, session.projectPath)
  },

  /** 保存或更新设定规则 */
  async upsertRule(session: ProjectSessionContext, rule: SettingRule): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:upsert-rule', rule, session.projectPath)
  },

  /** 更新规则状态（已确认、候选、后台、废止） */
  async updateRuleStatus(
    session: ProjectSessionContext,
    ruleId: string,
    status: SettingRuleStatus,
  ): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:update-rule-status', ruleId, status, session.projectPath)
  },

  /** 删除规则 */
  async deleteRule(session: ProjectSessionContext, ruleId: string): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:delete-rule', ruleId, session.projectPath)
  },

  /** 列出导入候选 */
  async listCandidates(
    session: ProjectSessionContext,
    candidateType?: WorkspaceImportCandidateType,
    status?: WorkspaceImportCandidateStatus,
  ): Promise<WorkspaceImportCandidate[]> {
    return ipc.invokeWithProjectSession(session, 'workspace:list-candidates', candidateType, status, session.projectPath)
  },

  /** 操作候选（审批或拒绝） */
  async actionCandidate(
    session: ProjectSessionContext,
    candidateId: string,
    action: 'approve' | 'reject',
  ): Promise<{ success: boolean; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:action-candidate', candidateId, action, session.projectPath)
  },

  /** 装配目标章节上下文包 */
  async assembleChapterContext(
    session: ProjectSessionContext,
    chapterNumber: number,
    budgetChars?: number,
    includeCandidates?: boolean,
  ): Promise<ChapterContextBundle> {
    return ipc.invokeWithProjectSession(
      session,
      'workspace:assemble-chapter-context',
      chapterNumber,
      budgetChars,
      includeCandidates,
      session.projectPath,
    )
  },

  /** 保存上下文快照（写入独立的 chapter_context_snapshots，禁止直接写入 blueprints） */
  async saveChapterContextSnapshot(
    session: ProjectSessionContext,
    snapshot: ChapterContextSnapshot,
  ): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
    return ipc.invokeWithProjectSession(session, 'workspace:save-chapter-context-snapshot', snapshot, session.projectPath)
  },
}
