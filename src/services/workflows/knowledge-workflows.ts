/**
 * 信息差检查 / 人物行动线检查 / 正文—细纲同步建议 的工作流工厂。
 *
 * 三类任务都只读正式数据 + 写候选/报告，与正式写入解耦（contract §8）：
 * 检查命令写报告表；同步命令只写同步候选，作者在补丁审查 UI 里逐项确认后才提交。
 */

import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../shared/project-session-context'
import { localize } from '../../i18n/core'
import type { Locale } from '../../i18n/types'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { workflowResourceKey, type WorkflowDefinition } from '../../stores/workflow-store'
import type { KnowledgeCheckReport } from '../../shared/knowledge-check'
import type { KnowledgeCheckScope } from './commands/knowledge-check.command'
import type { OutlineSyncSuggestParams } from './commands/outline-sync.command'

export interface KnowledgeCheckWorkflowParams {
  projectSession: ProjectSessionContext
  scope: KnowledgeCheckScope
  generationModelId?: string
}

function assertCurrentSession(projectSession: ProjectSessionContext, actionZh: string, actionEn: string): void {
  if (!sameProjectSessionContext(
    projectSession,
    projectSessionContextFromProject(useProjectStore.getState().currentProject),
  )) {
    throw new Error(localize(useLocaleStore.getState().locale,
      `当前项目已切换，无法${actionZh}`,
      `The project changed, so ${actionEn} is unavailable.`,
    ))
  }
}

export function createInfoGapCheckWorkflow(
  params: KnowledgeCheckWorkflowParams,
  uiLocale: Locale = useLocaleStore.getState().locale,
): WorkflowDefinition {
  const text = (zh: string, en: string) => localize(uiLocale, zh, en)
  assertCurrentSession(params.projectSession, '启动信息差检查', 'running the info-gap check')
  const projectSession = Object.freeze({ ...params.projectSession })
  const generationModelId = params.generationModelId
  return {
    type: 'post_process',
    title: text('信息差检查', 'Info-gap check'),
    projectPath: projectSession.projectPath,
    projectSession,
    uiLocale,
    ...(generationModelId ? { generationModelId } : {}),
    readResourceKeys: [workflowResourceKey('character-roster'), workflowResourceKey('blueprints')],
    steps: [
      {
        name: text('检查信息差与知情一致性', 'Check info gaps and knowledge consistency'),
        description: text(
          '只提出建议级疑点，不修改任何信息条目或知情记录',
          'Suggestions only; no info entries or knowledge records are modified',
        ),
        executor: async (step, context, callbacks) => {
          const { InfoGapCheckCommand } = await import('./commands/knowledge-check.command')
          const command = new InfoGapCheckCommand(projectSession, params.scope)
          const report = await command.execute({ step, context, callbacks })
          callbacks.log(text(
            `报告已保存（${report.findings.length} 条建议），可在「信息与揭露」页查看`,
            `Report saved (${report.findings.length} suggestions); view it on the Info & Revelation page`,
          ))
          return text(`信息差检查完成：${report.findings.length} 条建议`, `Info-gap check finished: ${report.findings.length} suggestion(s)`)
        },
      },
    ],
  }
}

export function createActionLineCheckWorkflow(
  params: KnowledgeCheckWorkflowParams,
  uiLocale: Locale = useLocaleStore.getState().locale,
): WorkflowDefinition {
  const text = (zh: string, en: string) => localize(uiLocale, zh, en)
  assertCurrentSession(params.projectSession, '启动行动线检查', 'running the action-line check')
  const projectSession = Object.freeze({ ...params.projectSession })
  const generationModelId = params.generationModelId
  return {
    type: 'post_process',
    title: text('人物行动线检查', 'Action-line check'),
    projectPath: projectSession.projectPath,
    projectSession,
    uiLocale,
    ...(generationModelId ? { generationModelId } : {}),
    readResourceKeys: [workflowResourceKey('character-roster'), workflowResourceKey('blueprints')],
    steps: [
      {
        name: text('检查行动与目标/认知的一致性', 'Check actions against goals and knowledge'),
        description: text(
          '只提出建议级疑点，不修改任何行动记录',
          'Suggestions only; no action records are modified',
        ),
        executor: async (step, context, callbacks) => {
          const { ActionLineCheckCommand } = await import('./commands/knowledge-check.command')
          const command = new ActionLineCheckCommand(projectSession, params.scope)
          const report = await command.execute({ step, context, callbacks })
          callbacks.log(text(
            `报告已保存（${report.findings.length} 条建议），可在角色行动线页查看`,
            `Report saved (${report.findings.length} suggestions); view it on the character action-line page`,
          ))
          return text(`行动线检查完成：${report.findings.length} 条建议`, `Action-line check finished: ${report.findings.length} suggestion(s)`)
        },
      },
    ],
  }
}

export interface OutlineSyncWorkflowParams extends OutlineSyncSuggestParams {
  projectSession: ProjectSessionContext
  generationModelId?: string
  /** 候选创建成功后的回调（UI 打开补丁审查面板）。 */
  onCandidateReady?: (candidateId: string, itemCount: number, noSubstantiveChange: boolean) => void
}

export function createOutlineSyncWorkflow(
  params: OutlineSyncWorkflowParams,
  uiLocale: Locale = useLocaleStore.getState().locale,
): WorkflowDefinition {
  const text = (zh: string, en: string) => localize(uiLocale, zh, en)
  assertCurrentSession(params.projectSession, '启动细纲对照同步', 'running the outline sync comparison')
  const projectSession = Object.freeze({ ...params.projectSession })
  const generationModelId = params.generationModelId
  return {
    type: 'post_process',
    title: text(`第 ${params.chapterNumber} 章 细纲对照`, `Chapter ${params.chapterNumber} outline comparison`),
    projectPath: projectSession.projectPath,
    projectSession,
    uiLocale,
    ...(generationModelId ? { generationModelId } : {}),
    readResourceKeys: [
      workflowResourceKey('blueprints'),
      workflowResourceKey('chapter', params.chapterNumber),
    ],
    steps: [
      {
        name: text('冻结正文与细纲并生成对照建议', 'Freeze prose and outline, then suggest patches'),
        description: text(
          '只生成候选补丁；作者逐项确认前不修改正式细纲',
          'Produces candidate patches only; the formal outline changes after per-item confirmation',
        ),
        executor: async (step, context, callbacks) => {
          const { OutlineSyncSuggestCommand } = await import('./commands/outline-sync.command')
          const command = new OutlineSyncSuggestCommand(projectSession, {
            chapterNumber: params.chapterNumber,
            draftId: params.draftId,
            unfinishedDraft: params.unfinishedDraft,
          })
          const result = await command.execute({ step, context, callbacks })
          params.onCandidateReady?.(result.candidateId, result.itemCount, result.noSubstantiveChange)
          return text(
            `候选已创建（${result.itemCount} 条补丁${result.noSubstantiveChange ? '，无实质变化' : ''}），请逐项核对`,
            `Candidate created (${result.itemCount} patch(es)${result.noSubstantiveChange ? ', no substantive change' : ''}); review each item`,
          )
        },
      },
    ],
  }
}

export type { KnowledgeCheckReport }
