import type { Locale } from '../../i18n/types'
import type {
  BlueprintPlanningCandidateListScope,
  BlueprintPlanningCandidateRecord,
  BlueprintPlanningCandidateUpdateInput,
  BlueprintPlanningCheckListScope,
  BlueprintPlanningCheckRecord,
  BlueprintPlanningConfirmInput,
  BlueprintPlanningConfirmResult,
  BlueprintPlanningSelection,
} from '../../shared/blueprint-planning'
import type { NovelConfig, ProjectSessionContext } from '../../shared/ipc-channels'
import { projectSessionContextFromProject, sameProjectPathKey, sameProjectSessionContext } from '../../shared/project-session-context'
import { randomUUID } from '../../utils/id'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore, type WorkflowDefinition, type WorkflowStatus } from '../../stores/workflow-store'
import { ipc } from '../ipc-client'
import type { BlueprintPlanningCommandInput } from './commands/blueprint-planning.command'
import type { WorkflowGenerationRuntimeDependencies } from './commands/base-command'

export interface StartBlueprintPlanningWorkflowParams {
  readonly projectSession: ProjectSessionContext
  readonly generationModelId: string
  readonly kind: BlueprintPlanningCommandInput['kind']
  readonly scope: BlueprintPlanningSelection
  readonly guidance?: string
  /** Author-selected material IDs; only book-outline brainstorming accepts them. */
  readonly selectedCreativeMaterialIds?: readonly string[]
  readonly mode?: 'generate' | 'improve'
  readonly plannedChapterCount?: number
  readonly totalChapters?: number
  readonly chapterRange?: { from: number; to: number }
  readonly uiLocale?: Locale
  /** Test seam that preserves the shared workflow generation runtime. */
  readonly generationRuntimeDependencies?: WorkflowGenerationRuntimeDependencies
}

export interface BlueprintPlanningWorkflowReceipt {
  readonly accepted: true
  readonly operationId: string
  readonly runId: string
  readonly status: WorkflowStatus
}

function text(locale: Locale, zhCNText: string, enUSText: string): string {
  return locale === 'en-US' ? enUSText : zhCNText
}

function assertCurrentSession(projectSession: ProjectSessionContext): void {
  const project = useProjectStore.getState().currentProject
  const currentSession = projectSessionContextFromProject(project)
  if (
    !project
    || !currentSession
    || !sameProjectPathKey(project.path, projectSession.projectPath)
    || !sameProjectSessionContext(projectSession, currentSession)
  ) throw new Error('PROJECT_SESSION_MISMATCH')
}

function targetResourceKey(kind: StartBlueprintPlanningWorkflowParams['kind'], scope: BlueprintPlanningSelection): string {
  if (kind === 'book-outline' && scope.kind === 'book') return 'blueprint-planning:book'
  const target = scope.kind === 'book'
    ? 'book'
    : scope.kind === 'volume'
      ? scope.volumeId
      : String(scope.chapterNumber)
  return kind === 'connection-check'
    ? `blueprint-planning:check:${scope.kind}:${target}`
    : `blueprint-planning:${kind}:${scope.kind}:${target}`
}

function workflowStepLabel(kind: StartBlueprintPlanningWorkflowParams['kind'], locale: Locale): { name: string; description: string } {
  const labels: Record<StartBlueprintPlanningWorkflowParams['kind'], [string, string, string, string]> = {
    'book-outline': ['生成全书总纲候选', 'Generate book-outline candidate', '保存候选；确认前不修改正式总纲', 'Save a candidate; the formal book outline stays unchanged until confirmation'],
    'volume-plan': ['规划分卷候选', 'Plan volume candidates', '基于全书总纲生成可选择的分卷与卷纲候选', 'Generate selectable volume and outline candidates from the book outline'],
    'volume-outline': ['生成卷纲候选', 'Generate volume-outline candidate', '只生成指定卷的卷纲候选；确认后按版本提交', 'Generate a candidate for the selected volume; commit with revision checks after confirmation'],
    'chapter-plan': ['规划本卷章节候选', 'Plan chapter candidates', '只规划作者选择的章号范围；确认后归入指定卷', 'Plan only the author-selected chapter range; assign to this volume after confirmation'],
    'chapter-expand': ['展开章节细纲候选', 'Expand chapter-outline candidate', '生成完整 v2 细纲候选；确认前不写入正式章节蓝图', 'Generate a complete v2 candidate; do not save the formal chapter detail before confirmation'],
    'connection-check': ['检查规划衔接', 'Check planning connections', '保存确定性检查与 AI 建议；报告保持只读', 'Save deterministic checks and AI suggestions as a read-only report'],
  }
  const [zhName, enName, zhDescription, enDescription] = labels[kind]
  return { name: text(locale, zhName, enName), description: text(locale, zhDescription, enDescription) }
}

export function createBlueprintPlanningWorkflow(
  params: StartBlueprintPlanningWorkflowParams,
  operationId = randomUUID(),
): WorkflowDefinition {
  assertCurrentSession(params.projectSession)
  const locale = params.uiLocale ?? useLocaleStore.getState().locale
  if (params.selectedCreativeMaterialIds?.length && params.kind !== 'book-outline') {
    throw new Error(text(locale, '所选素材目前只用于全书总纲发想。', 'Selected materials are currently supported for book-outline brainstorming only.'))
  }
  const modelId = params.generationModelId.trim()
  if (!modelId) throw new Error(text(locale, '请先选择 AI 生成模型。', 'Choose a generation model first.'))

  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('PROJECT_SESSION_MISMATCH')
  const projectSession = Object.freeze({ ...params.projectSession })
  const novelConfigSnapshot: Readonly<NovelConfig> = Object.freeze({ ...project.novelConfig })
  const scope = Object.freeze({ ...params.scope }) as BlueprintPlanningSelection
  const commandInput: BlueprintPlanningCommandInput = Object.freeze({
    operationId,
    kind: params.kind,
    scope,
    ...(params.guidance?.trim() ? { guidance: params.guidance.trim() } : {}),
    ...(params.selectedCreativeMaterialIds?.length ? { selectedCreativeMaterialIds: [...new Set(params.selectedCreativeMaterialIds)] } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.plannedChapterCount !== undefined ? { plannedChapterCount: params.plannedChapterCount } : {}),
    ...(params.totalChapters !== undefined ? { totalChapters: params.totalChapters } : {}),
    ...(params.chapterRange ? { chapterRange: Object.freeze({ ...params.chapterRange }) } : {}),
    novelConfigSnapshot,
  })
  const label = workflowStepLabel(params.kind, locale)

  return {
    type: 'post_process',
    title: label.name,
    projectPath: project.path,
    projectSession,
    generationModelId: modelId,
    uiLocale: locale,
    resourceKeys: [targetResourceKey(params.kind, scope)],
    readResourceKeys: ['architecture', 'blueprints', 'novel-config'],
    steps: [{
      name: label.name,
      description: label.description,
      executor: async (step, context, callbacks) => {
        assertCurrentSession(projectSession)
        if (
          !sameProjectSessionContext(context.projectSession, projectSession)
          || context.generationModelId !== modelId
        ) throw new Error('BLUEPRINT_PLANNING_WORKFLOW_SNAPSHOT_MISMATCH')
        const { BlueprintPlanningCommand } = await import('./commands/blueprint-planning.command')
        return new BlueprintPlanningCommand(commandInput, params.generationRuntimeDependencies)
          .execute({ step, context, callbacks })
      },
    }],
    onComplete: { mode: 'silent' },
  }
}

/** Start a tracked planner using the shared lease, generation runtime, progress, and cancellation machinery. */
export async function startBlueprintPlanningWorkflow(
  params: StartBlueprintPlanningWorkflowParams,
): Promise<BlueprintPlanningWorkflowReceipt> {
  const locale = params.uiLocale ?? useLocaleStore.getState().locale
  assertCurrentSession(params.projectSession)
  const operationId = randomUUID()
  const runId = randomUUID()
  const definition = createBlueprintPlanningWorkflow(params, operationId)
  const conflict = useWorkflowStore.getState().getResourceConflict(definition)
  if (conflict) throw new Error(text(
    locale,
    `「${conflict.title}」正在处理相同规划内容，请等待完成或取消后重试。`,
    `"${conflict.title}" is already working on this planning target. Wait for it to finish or cancel it before retrying.`,
  ))
  const completion = useWorkflowStore.getState().startWorkflow({ ...definition, runId, uiLocale: locale })
  void completion.catch(error => {
    useWorkflowStore.getState().addLog(
      'error',
      text(locale, `规划工作流启动后异常：${String(error)}`, `Planning workflow failed after launch: ${String(error)}`),
      locale,
    )
  })
  const registered = useWorkflowStore.getState().activeRuns.find(run => run.id === runId)
    ?? useWorkflowStore.getState().history.find(run => run.id === runId)
  if (!registered || registered.status === 'failed') {
    throw new Error(registered?.error ?? '规划工作流未能注册，已拒绝报告启动成功。')
  }
  return Object.freeze({ accepted: true, operationId, runId, status: registered.status })
}

function invokeForSession<T>(projectSession: ProjectSessionContext, operation: () => Promise<T>): Promise<T> {
  assertCurrentSession(projectSession)
  return operation().then(result => {
    assertCurrentSession(projectSession)
    return result
  })
}

export function getBlueprintPlanningCandidate(
  projectSession: ProjectSessionContext,
  operationId: string,
): Promise<BlueprintPlanningCandidateRecord | null> {
  return invokeForSession(projectSession, () => ipc.invokeWithProjectSession(
    projectSession, 'db:blueprint-planning-candidate-get', operationId, projectSession.projectPath,
  ))
}

export function listBlueprintPlanningCandidates(
  projectSession: ProjectSessionContext,
  scope: BlueprintPlanningCandidateListScope = {},
): Promise<BlueprintPlanningCandidateRecord[]> {
  return invokeForSession(projectSession, () => ipc.invokeWithProjectSession(
    projectSession, 'db:blueprint-planning-candidate-list', scope, projectSession.projectPath,
  ))
}

export function updateBlueprintPlanningCandidate(
  projectSession: ProjectSessionContext,
  input: BlueprintPlanningCandidateUpdateInput,
) {
  return invokeForSession(projectSession, () => ipc.invokeWithProjectSession(
    projectSession, 'db:blueprint-planning-candidate-update', input, projectSession.projectPath,
  ))
}

export function cancelBlueprintPlanningCandidate(projectSession: ProjectSessionContext, operationId: string) {
  return invokeForSession(projectSession, () => ipc.invokeWithProjectSession(
    projectSession, 'db:blueprint-planning-candidate-cancel', operationId, projectSession.projectPath,
  ))
}

export function confirmBlueprintPlanningCandidate(
  projectSession: ProjectSessionContext,
  input: BlueprintPlanningConfirmInput,
): Promise<BlueprintPlanningConfirmResult> {
  return invokeForSession(projectSession, () => ipc.invokeWithProjectSession(
    projectSession, 'db:blueprint-planning-confirm', input, projectSession.projectPath,
  ))
}

export function listBlueprintPlanningChecks(
  projectSession: ProjectSessionContext,
  scope: BlueprintPlanningCheckListScope = {},
): Promise<BlueprintPlanningCheckRecord[]> {
  return invokeForSession(projectSession, () => ipc.invokeWithProjectSession(
    projectSession, 'db:blueprint-planning-check-list', scope, projectSession.projectPath,
  ))
}

export function cancelBlueprintPlanningWorkflow(runId: string): void {
  useWorkflowStore.getState().cancelWorkflow(runId)
}
