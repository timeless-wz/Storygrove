import type { Locale } from '../../i18n/types'
import type { NovelConfig, ProjectSessionContext } from '../../shared/ipc-channels'
import { sameProjectPathKey, sameProjectSessionContext, projectSessionContextFromProject } from '../../shared/project-session-context'
import { resolveWritingLanguage } from '../../shared/writing-language'
import { useProjectStore } from '../../stores/project-store'
import {
  workflowResourceKey,
  type WorkflowDefinition,
} from '../../stores/workflow-store'
import { createGenerationRuntime } from '../generation/generation-runtime'
import type { WorkflowGenerationRuntimeDependencies } from './commands/base-command'
import type { GenerateFieldFrozenInput } from './commands/generate-field.command'
import { GENERATABLE_FIELD_LABELS, type GeneratableField } from './novel-config-field-labels'

export interface NovelConfigFieldWorkflowInput {
  readonly fieldKey: GeneratableField
  readonly projectPath: string
  readonly projectSession: ProjectSessionContext
  readonly novelConfigSnapshot: Readonly<NovelConfig>
  readonly generationModelId: string
  readonly uiLocale: Locale
  /** Test seam that still exercises the command's shared generation-runtime contract. */
  readonly generationRuntimeDependencies?: WorkflowGenerationRuntimeDependencies
}

function localized(locale: Locale, zhCNText: string, enUSText: string): string {
  return locale === 'en-US' ? enUSText : zhCNText
}

/** Wraps the existing field command in one tracked workflow step. */
export function createNovelConfigFieldWorkflow(
  input: NovelConfigFieldWorkflowInput,
): WorkflowDefinition {
  const project = useProjectStore.getState().currentProject
  const currentSession = projectSessionContextFromProject(project)
  const generationModelId = input.generationModelId.trim()
  if (
    !project
    || !currentSession
    || !sameProjectPathKey(project.path, input.projectPath)
    || !sameProjectSessionContext(input.projectSession, currentSession)
  ) {
    throw new Error(localized(
      input.uiLocale,
      '当前项目已切换，无法启动字段生成。',
      'The project changed, so field generation cannot start.',
    ))
  }
  if (!generationModelId) {
    throw new Error(localized(
      input.uiLocale,
      '请先在设置中配置 AI 模型。',
      'Configure an AI model in Settings first.',
    ))
  }

  const projectSession = Object.freeze({ ...input.projectSession })
  const novelConfigSnapshot = Object.freeze({ ...input.novelConfigSnapshot })
  const frozenInput: GenerateFieldFrozenInput = Object.freeze({
    projectSession,
    novelConfig: novelConfigSnapshot,
  })
  const writingLanguage = resolveWritingLanguage(novelConfigSnapshot.writingLanguage)
  const strategySnapshot = novelConfigSnapshot.creativeStrategy ?? 'auto'
  const labelPair = GENERATABLE_FIELD_LABELS[input.fieldKey]
  const fieldLabel = localized(input.uiLocale, ...labelPair)
  const title = localized(
    input.uiLocale,
    `创作方向：${fieldLabel}`,
    `Creative direction: ${fieldLabel}`,
  )

  const baseGenerationDependencies = input.generationRuntimeDependencies ?? {
    createRuntime: options => createGenerationRuntime(options),
  }
  const generationDependencies: WorkflowGenerationRuntimeDependencies = {
    createRuntime: options => baseGenerationDependencies.createRuntime({
      ...options,
      projectSession,
      creativeStrategy: strategySnapshot,
    }),
  }

  return {
    type: 'config_generation',
    title,
    projectPath: project.path,
    projectSession,
    generationModelId,
    uiLocale: input.uiLocale,
    resourceKeys: [workflowResourceKey('novel-config')],
    steps: [{
      name: fieldLabel,
      description: localized(
        input.uiLocale,
        '只生成并保存当前字段，使用任务启动时捕获的创作方向快照。',
        'Generate and save only this field using the creative-direction snapshot captured at task start.',
      ),
      executor: async (step, context, callbacks) => {
        if (
          !sameProjectSessionContext(projectSession, context.projectSession)
          || context.writingLanguage !== writingLanguage
          || context.generationModelId !== generationModelId
        ) {
          throw new Error(localized(
            input.uiLocale,
            '字段生成的项目、语言或模型快照已变化，已停止执行。',
            'The field-generation project, language, or model snapshot changed, so execution stopped.',
          ))
        }
        const { GenerateFieldCommand } = await import('./commands/generate-field.command')
        const command = new GenerateFieldCommand(
          input.fieldKey,
          generationDependencies,
          frozenInput,
        )
        return command.execute({ step, context, callbacks })
      },
    }],
    onComplete: { mode: 'silent' },
  }
}
