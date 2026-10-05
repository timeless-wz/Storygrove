import type { ProjectSessionContext } from '../../shared/ipc-channels'
import type { WorkflowDefinition } from '../../stores/workflow-store'

export function createRevisionLearningWorkflow(options: {
  projectSession: ProjectSessionContext
  recordId: string
  attemptId: string
  modelId: string | null
  title?: string
}): WorkflowDefinition {
  const { projectSession } = options
  return {
    runId: options.attemptId,
    type: 'revision_learning',
    title: options.title ?? '修订学习：分析修稿样本',
    projectPath: projectSession.projectPath,
    projectSession,
    ...(options.modelId ? { generationModelId: options.modelId } : {}),
    readResourceKeys: [],
    steps: [{
      name: '从纳入的差异归纳修稿规则',
      description: '模型只生成候选；每条规则由作者确认后才能写入项目技能库',
      executor: async (step, context, callbacks) => {
        const { AnalyzeRevisionLearningCommand } = await import('./commands/analyze-revision-learning.command')
        const command = new AnalyzeRevisionLearningCommand(projectSession, options.recordId, options.attemptId)
        const result = await command.execute({ step, context, callbacks })
        return `生成 ${result.rules.length} 条候选规则与 ${result.nonGeneralizableChanges.length} 项个例；等待作者审阅。`
      },
    }],
  }
}
