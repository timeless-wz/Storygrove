import { BaseWorkflowCommand, CommandExecuteParams, type WorkflowGenerationRuntimeDependencies } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { resolvePromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import { requireIpcSuccess } from '../../ipc-result'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../../shared/project-session-context'
import { readWorkflowDraftMeta } from '../workflow-draft-meta'
import {
  requireWorkflowProjectSession,
  workflowUiLocale,
  workflowUiText,
  workflowWritingLanguage,
} from '../workflow-project-session'
import { promptLanguageText } from '../../prompt-language'
import { buildCreativeContextBundle } from '../../../shared/creative-content'
import { buildCreativeCorePromptSources, loadCharacterProfilePromptSource, loadCreativeDomainPromptSources, loadLegacyCreativeSources } from '../../creative-context'
import { buildKnowledgeGapMaterial } from './knowledge-material'
import { assertMateriallyCompleteRevision } from './refinement-completeness'
import { countDraftUnits } from '../../../shared/draft-units'
import { throwIfSourceDraftChanged } from '../source-draft-changed'
import { assembleBlueprintV2WritingBlock, isWritableBlueprintV2Detail } from './blueprint-v2-writing'
import {
  formatBlueprintVolumeWritingMaterial,
  loadBlueprintVolumeWritingMaterial,
} from './blueprint-volume-writing'

import type { ChapterInfo, FrozenDraftSourceIdentity } from '../chapter-workflow'

export interface RefineDraftParams {
  draftPath: string
  draftContent: string
  sourceDraft?: FrozenDraftSourceIdentity
  chapterNumber: number
  chapterInfo: ChapterInfo
  mergedGuidance?: string
  userRefinePrompt?: string
  shortSummary?: string
}

export class RefineDraftCommand extends BaseWorkflowCommand<string> {
  constructor(
    private params: RefineDraftParams,
    generationDependencies?: WorkflowGenerationRuntimeDependencies,
  ) {
    super(generationDependencies)
  }

  async execute(params: CommandExecuteParams): Promise<string> {
    return this.executeWithGenerationRuntime('text', params, () => this.executeWithinGeneration(params))
  }

  private async executeWithinGeneration({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const projectSession = requireWorkflowProjectSession(context)
    const writingLanguage = workflowWritingLanguage(context)
    const text = (zhCNText: string, enUSText: string) => workflowUiText(context, zhCNText, enUSText)
    const project = useProjectStore.getState().currentProject
    if (!project || !sameProjectSessionContext(
      projectSession,
      projectSessionContextFromProject(project),
    )) throw new Error(text('当前项目已切换，修稿已停止', 'The project changed, so the revision stopped.'))
    const novelConfig = Object.freeze({ ...project.novelConfig })

    const initialDraftMeta = await readWorkflowDraftMeta(
      this.params.draftPath,
      context.projectPath,
      projectSession,
    )
    if (
      !initialDraftMeta
      || (this.params.sourceDraft && (
        initialDraftMeta.id !== this.params.sourceDraft.id
        || initialDraftMeta.chapterNumber !== this.params.sourceDraft.chapterNumber
        || initialDraftMeta.version !== this.params.sourceDraft.version
        || initialDraftMeta.status !== this.params.sourceDraft.status
      ))
    ) throw new Error(text('基准草稿已变化，修稿已停止。', 'The source draft changed, so revision stopped.'))
    const boundBlueprintChapterNumber = initialDraftMeta.blueprintChapterNumber
    const volumeMaterial = await loadBlueprintVolumeWritingMaterial(
      projectSession,
      boundBlueprintChapterNumber,
    )
    const volumePlanningText = formatBlueprintVolumeWritingMaterial(volumeMaterial, writingLanguage)

    const draft = this.params.draftContent
    if (!draft) throw new Error(text('无草稿内容', 'There is no draft content to revise.'))

    const core = await ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', context.projectPath)
    if (!core) throw new Error(text('无法读取项目正式资料，已停止修稿。', 'Could not read the formal project sources; revision stopped.'))
    const [legacySources, domainSources, characterSource, information] = await Promise.all([
      loadLegacyCreativeSources(projectSession, context.projectPath),
      loadCreativeDomainPromptSources(projectSession, context.projectPath, {
        powerSystem: true,
        locations: true,
        relevanceText: `${draft}\n${this.params.chapterInfo.title}\n${this.params.chapterInfo.keyEvents ?? ''}`,
      }),
      loadCharacterProfilePromptSource(projectSession, context.projectPath, this.params.chapterInfo.characters),
      buildKnowledgeGapMaterial(projectSession, this.params.chapterNumber, this.params.chapterInfo.characters),
    ])
    const creativeContext = buildCreativeContextBundle([
      ...buildCreativeCorePromptSources(core, legacySources, [
        'creative-direction', 'writing-rules', 'premise', 'world-setting', 'characters',
      ], writingLanguage),
      ...(characterSource ? [characterSource] : []),
      ...domainSources,
      ...(information ? [{
        id: 'information-reveal.chapter-projection',
        label: '本章信息与揭露投影',
        category: 'information-reveal' as const,
        content: information.text,
        status: 'formal' as const,
        note: '作者真相、人物认知、读者证据已按本章范围分别标记',
      }] : []),
    ], writingLanguage, { includeSourceList: false })

    callbacks.log(text('正在精修章节...', 'Refining the chapter...'))

    const template = await resolvePromptTemplate('refine_chapter', projectSession, writingLanguage)
    if (!template) throw new Error(text('未找到修稿模板', 'The revision prompt template was not found.'))

    const mergedGuidance = this.params.mergedGuidance || ''
    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? promptLanguageText(
          writingLanguage,
          `【用户额外修稿指导（最高优先级）】\n${this.params.userRefinePrompt}`,
          `[Additional author revision guidance — highest priority]\n${this.params.userRefinePrompt}`,
        )
      : ''

    // 本章 v2 细纲（契约 §9）：存在时按同一路径注入，修稿不得偏离分镜与禁忌。
    let blueprintV2Text = ''
    let blueprintWordBudget: number | null = null
    let hasBlueprintV2Content = false
    let detail
    try {
      detail = boundBlueprintChapterNumber === undefined
        ? null
        : await ipc.invokeWithProjectSession(
            projectSession, 'db:blueprint-v2-get', boundBlueprintChapterNumber, context.projectPath,
          )
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message = text(
        `读取第 ${this.params.chapterNumber} 章 v2 细纲失败，已停止修稿以免漏用细纲：${reason}`,
        `Could not read Chapter ${this.params.chapterNumber}'s v2 detailed outline. Revision stopped to avoid omitting it: ${reason}`,
      )
      callbacks.log(message)
      throw new Error(message)
    }
    if (detail && !isWritableBlueprintV2Detail(detail)) {
      const status = (detail as { readStatus?: string }).readStatus
      const message = text(
        status === 'needs-newer-app'
          ? '本章 v2 细纲由更新版本的应用写入，已停止修稿。'
          : '本章 v2 细纲存储已损坏，已停止修稿；请先修复或重新导入。',
        status === 'needs-newer-app'
          ? 'The chapter v2 detailed outline was written by a newer app version. Revision stopped.'
          : 'The chapter v2 detailed outline is corrupted. Revision stopped; repair or re-import it first.',
      )
      callbacks.log(message)
      throw new Error(message)
    }
    if (detail && detail.chapterNumber !== boundBlueprintChapterNumber) {
      const message = text(
        `读取到第 ${detail.chapterNumber} 章 v2 细纲，但当前草稿绑定第 ${boundBlueprintChapterNumber} 章；已停止以防串章。`,
        `The v2 outline read is for Chapter ${detail.chapterNumber}, but this draft is bound to Chapter ${boundBlueprintChapterNumber}. Revision stopped to prevent a chapter mismatch.`,
      )
      callbacks.log(message)
      throw new Error(message)
    }
    if (isWritableBlueprintV2Detail(detail)) {
      const block = assembleBlueprintV2WritingBlock(detail, writingLanguage)
      if (block) {
        blueprintV2Text = block.text
        blueprintWordBudget = block.wordBudget
        hasBlueprintV2Content = true
      }
    }

    const promptBuilder = new ChapterPromptBuilder(template, writingLanguage)
      .withDraftContent(draft)
      .withChapterInfo(hasBlueprintV2Content
        ? { ...this.params.chapterInfo, purpose: '', keyEvents: '', suspenseHook: '' }
        : this.params.chapterInfo)
      .withGlobalGuidance(mergedGuidance)
      .withGlobalSummary(this.params.shortSummary || '')
      .withShortSummary(this.params.shortSummary || '')
      .withWordNumber(blueprintWordBudget ?? novelConfig.wordsPerChapter)
      .withWritingStyle('')
      .withUserRefinePrompt(userPromptBlock)

    const usedSources = [
      ...creativeContext.sources.map(source => `- ${source.label} · ${source.id}（${source.status}）`),
      `- 当前草稿 v${this.params.sourceDraft?.version ?? initialDraftMeta.version}（修稿对象）`,
      ...(boundBlueprintChapterNumber !== undefined
        ? [`- 绑定章纲第${boundBlueprintChapterNumber}章${detail ? ` · revision ${detail.revision} / ${detail.contentHash}` : ''}（计划）`]
        : []),
      ...(volumeMaterial?.outline ? ['- 绑定卷纲与相关章纲摘要（计划）'] : []),
      ...(information ? ['- 本章适用的信息与揭露记录 · info_entries / knowledge_records'] : []),
      ...(this.params.userRefinePrompt?.trim() ? ['- 作者本次修稿指令'] : []),
    ]
    const sourceList = promptLanguageText(
      writingLanguage,
      `【本次使用资料】\n${usedSources.join('\n')}`,
      `[Sources used for this request]\n${usedSources.join('\n')}`,
    )

    const refined = await this.callLLMWithBoundedCompletion(
      [sourceList, creativeContext.promptText, promptBuilder.build(), volumePlanningText, blueprintV2Text].filter(Boolean).join('\n\n'),
      promptBuilder.getSystemRole(),
      callbacks,
      { mode: 'append-visible-text', maxContinuations: 3 },
      { purpose: 'refine-draft', reasoningStage: 'review', writingSkillStage: 'refinement' },
      context,
    )
    this.assertNotCancelled(context)
    const cleanRefined = this.stripThinkingTags(refined).trim()
    assertMateriallyCompleteRevision(
      draft,
      cleanRefined,
      novelConfig.wordsPerChapter,
      workflowUiLocale(context),
    )

    if (!sameProjectSessionContext(
      projectSession,
      projectSessionContextFromProject(useProjectStore.getState().currentProject),
    )) throw new Error(text('当前项目已切换，修稿结果未保存', 'The project changed, so the revision was not saved.'))

    const frozenSource = this.params.sourceDraft
    const latestDraftMeta = await readWorkflowDraftMeta(
      this.params.draftPath,
      context.projectPath,
      projectSession,
    )
    if (
      !latestDraftMeta
      || latestDraftMeta.id !== initialDraftMeta.id
      || latestDraftMeta.chapterNumber !== initialDraftMeta.chapterNumber
      || latestDraftMeta.version !== initialDraftMeta.version
      || latestDraftMeta.status !== initialDraftMeta.status
      || latestDraftMeta.blueprintChapterNumber !== initialDraftMeta.blueprintChapterNumber
    ) throw new Error(text(
      '修稿期间草稿蓝图绑定已变化，未保存结果。',
      'The draft blueprint binding changed during revision, so the result was not saved.',
    ))
    const latestVolumeMaterial = await loadBlueprintVolumeWritingMaterial(
      projectSession,
      latestDraftMeta.blueprintChapterNumber,
    )
    if (JSON.stringify(latestVolumeMaterial) !== JSON.stringify(volumeMaterial)) throw new Error(text(
      '修稿期间本章归卷或卷纲版本已变化，未保存结果。',
      'The chapter assignment or volume-outline version changed during revision, so the result was not saved.',
    ))
    const legacyBaseDraft = frozenSource ? null : latestDraftMeta
    const baseDraftId = frozenSource?.id ?? legacyBaseDraft?.id
    if (baseDraftId === undefined) throw new Error(text('找不到基准草稿版本', 'The source draft version could not be found.'))

    this.assertNotCancelled(context)
    const createRes = await ipc.invokeWithProjectSession(projectSession, 'db:revision-replace-pending', {
      baseDraftId,
      revisionType: 'refine',
      content: cleanRefined,
      wordCount: countDraftUnits(cleanRefined),
      ...(frozenSource ? {
        expectedSource: {
          id: frozenSource.id,
          chapterNumber: frozenSource.chapterNumber,
          version: frozenSource.version,
          status: frozenSource.status,
          content: draft,
        },
      } : {}),
    }, context.projectPath)
    throwIfSourceDraftChanged(createRes, workflowUiLocale(context), 'refine')
    requireIpcSuccess(createRes, text('创建修订稿', 'Create the pending revision'))
    if (createRes.id === undefined) {
      throw new Error(text('创建修订稿失败：未返回修订稿编号', 'The pending revision did not return an ID.'))
    }

    const revIndex = createRes.revisionIndex ?? 0

    this.assertNotCancelled(context)
    if (!sameProjectSessionContext(
      projectSession,
      projectSessionContextFromProject(useProjectStore.getState().currentProject),
    )) throw new Error(text('当前项目已切换，已拒绝打开旧修订稿', 'The project changed, so the stale revision was not opened.'))
    const { useEditorStore } = await import('../../../stores/editor-store')
    useEditorStore.getState().openFile({
      id: `diff-${this.params.draftPath}-${createRes.id}`,
      name: text(
        `修稿合并：第${this.params.chapterNumber}章`,
        `Revision merge: Chapter ${this.params.chapterNumber}`,
      ),
      type: 'diff',
      filePath: this.params.draftPath,
      originalContent: this.params.draftContent,
      content: cleanRefined,
      revisionPath: `vela://revision/${createRes.id}`,
      chapterNumber: this.params.chapterNumber,
      chapterDir: `vela://draft/ch${this.params.chapterNumber}`,
      projectKey: context.projectPath,
    })

    context.data.refined = cleanRefined
    context.data.refinedPath = this.params.draftPath
    callbacks.log(text(
      `修稿完成（${countDraftUnits(cleanRefined)} 字），已生成修订稿版本 r${revIndex}`,
      `Revision complete (${countDraftUnits(cleanRefined)} words); created revision r${revIndex}`,
    ))
    return cleanRefined
  }
}
