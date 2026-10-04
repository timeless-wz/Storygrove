import {
  assertValidChapterBlueprintV2Content,
  type ChapterBlueprintV2Content,
} from '../../../shared/blueprint-v2'
import { parseChapterBlueprintMarkdown } from '../../../shared/blueprint-v2-markdown'
import type {
  BlueprintChapterPlanning,
  BlueprintPlanningCandidateKind,
  BlueprintPlanningCandidateRecord,
  BlueprintPlanningCandidateSaveInput,
  BlueprintPlanningCheckIssue,
  BlueprintPlanningCheckReport,
  BlueprintPlanningSelection,
  BlueprintPlanningSourceReference,
  BlueprintPlanningSourceSnapshot,
  BlueprintVolumeOutline,
  BlueprintVolumeOutlineSummary,
} from '../../../shared/blueprint-planning'
import {
  blueprintPlanningChapterSummaryHash,
  blueprintPlanningChapterIndexHash,
  blueprintPlanningChapterVolumeHash,
  blueprintPlanningTextHash,
  blueprintPlanningVolumeIndexHash,
  blueprintPlanningVolumeMetadataHash,
  stableBlueprintPlanningJson,
} from '../../../shared/blueprint-planning'
import type { NovelConfig, ProjectSessionContext } from '../../../shared/ipc-channels'
import type { BlueprintData, BlueprintListSummary, BlueprintVolumeData } from '../../../../electron/repositories/blueprint-repository'
import type { ProjectCoreData } from '../../../../electron/repositories/project-core-repository'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import type { WorkflowContext } from '../../../stores/workflow-store'
import { promptLanguageText } from '../../prompt-language'
import { ipc } from '../../ipc-client'
import { composePromptSystemRole, renderPrompt, resolvePromptTemplate, type PromptTemplate } from '../../prompt-templates'
import type { WritingLanguage } from '../../../shared/writing-language'
import { assertNoLossOnSerialize } from '../../../shared/blueprint-v2-markdown'
import { BaseWorkflowCommand, type CommandExecuteParams, type WorkflowGenerationRuntimeDependencies } from './base-command'
import { parseTextBlueprintsStrict } from '../directory-workflow'
import { randomUUID } from '../../../utils/id'

const PLANNING_SCHEMA_VERSION = 1
const MAX_PLAN_VOLUMES = 30
const MAX_PLAN_CHAPTERS = 100
const MAX_MARKDOWN_CHARS = 400_000
const MAX_CHECK_SUGGESTIONS = 30

export interface BlueprintPlanningCommandInput {
  operationId: string
  kind: BlueprintPlanningCandidateKind
  scope: BlueprintPlanningSelection
  guidance?: string
  mode?: 'generate' | 'improve'
  plannedChapterCount?: number
  totalChapters?: number
  chapterRange?: { from: number; to: number }
  /** Frozen at workflow registration; settings edits during model execution cannot change the prompt. */
  novelConfigSnapshot?: Readonly<NovelConfig>
}

interface SourceCapture {
  core: ProjectCoreData
  volumes: BlueprintVolumeData[]
  outlineSummaries: BlueprintVolumeOutlineSummary[]
  chapterSummaries: BlueprintListSummary[]
}

function sessionCurrent(projectSession: ProjectSessionContext): boolean {
  return sameProjectSessionContext(
    projectSession,
    projectSessionContextFromProject(useProjectStore.getState().currentProject),
  )
}

function assertSession(projectSession: ProjectSessionContext, context: WorkflowContext): void {
  if (
    !sameProjectSessionContext(projectSession, context.projectSession)
    || !sessionCurrent(projectSession)
  ) throw new Error('PROJECT_SESSION_MISMATCH')
}

async function hashValue(value: unknown): Promise<string> {
  return blueprintPlanningTextHash(typeof value === 'string' ? value : stableBlueprintPlanningJson(value))
}

function extractJson(content: string): unknown {
  const stripped = content
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('AI candidate is not a JSON object')
  return JSON.parse(stripped.slice(start, end + 1)) as unknown
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI candidate has an invalid shape')
  return value as Record<string, unknown>
}

function boundedString(value: unknown, max: number, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || Array.from(value).length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`AI candidate field ${field} is invalid`)
  }
  return value
}

/**
 * A batch chapter-plan candidate may be confirmed for only a subset of its
 * chapters. Treat a plan as author-confirmed for expansion only when the
 * committed receipt names that exact global chapter number.
 */
export function findConfirmedChapterPlanning(
  candidates: readonly BlueprintPlanningCandidateRecord[],
  volumeId: string,
  chapterNumber: number,
): { candidate: BlueprintPlanningCandidateRecord; planning: BlueprintChapterPlanning } | null {
  for (const candidate of candidates) {
    if (
      candidate.kind !== 'chapter-plan'
      || candidate.state !== 'committed'
      || candidate.scope.kind !== 'volume'
      || candidate.scope.volumeId !== volumeId
    ) continue

    const receipt = candidate.commitReceipt
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) continue
    const confirmedChapters = (receipt as { chapterNumbers?: unknown }).chapterNumbers
    if (!Array.isArray(confirmedChapters) || !confirmedChapters.includes(chapterNumber)) continue

    const payload = candidate.candidate
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    const chapters = (payload as { chapters?: unknown }).chapters
    if (!Array.isArray(chapters)) continue
    const chapter = chapters.find(item => (
      Boolean(item && typeof item === 'object' && !Array.isArray(item))
      && Number((item as Record<string, unknown>).chapterNumber) === chapterNumber
    )) as Record<string, unknown> | undefined
    const planning = chapter?.planning
    if (!planning || typeof planning !== 'object' || Array.isArray(planning)) continue
    const values = planning as Record<string, unknown>
    const fields = ['volumeTask', 'handoff', 'expectedEndChange'] as const
    if (fields.some(field => (
      typeof values[field] !== 'string'
      || Array.from(values[field] as string).length > 2_000
    ))) continue

    return {
      candidate,
      planning: {
        volumeTask: values.volumeTask as string,
        handoff: values.handoff as string,
        expectedEndChange: values.expectedEndChange as string,
      },
    }
  }
  return null
}

function appendPlannedChapterCount(
  markdown: string,
  count: number | null | undefined,
  writingLanguage: WritingLanguage,
): string {
  if (count === null || count === undefined || !Number.isSafeInteger(count) || count < 0) return markdown.trim()
  const note = promptLanguageText(
    writingLanguage,
    `> 预计章节数（规划值）：${count} 章。此值不是实际章数，也不会自动分配章节。`,
    `> Estimated chapter count (planning value): ${count}. This is not an actual count and does not assign chapters automatically.`,
  )
  return `${markdown.trimEnd()}\n\n${note}`
}

function htmlSafeGuidance(value: string | undefined, writingLanguage: WritingLanguage): string {
  return value?.trim() || promptLanguageText(writingLanguage, '（无补充指导）', '(no additional guidance)')
}

function renderTemplateContent(
  template: PromptTemplate,
  variables: Record<string, string>,
  writingLanguage: WritingLanguage,
): string {
  return renderPrompt(template, variables, writingLanguage)
}

function contextFingerprintSources(
  inputHash: string,
  templateHash: string,
  label: string,
): BlueprintPlanningSourceReference[] {
  return [
    { kind: 'input', targetId: `${label}:input`, contentHash: inputHash, label: 'Frozen planning inputs' },
    { kind: 'template', targetId: `${label}:template`, contentHash: templateHash, label: 'Prompt template' },
  ]
}

function formatChapterSummaries(
  items: SourceCapture['chapterSummaries'],
  writingLanguage: WritingLanguage,
  volumeId?: string,
  maxItems = 80,
): string {
  const matching = items
    .filter(item => volumeId === undefined || item.volumeId === volumeId)
    .slice(0, maxItems)
  if (matching.length === 0) return promptLanguageText(writingLanguage, '（尚无章节简纲）', '(no chapter summaries yet)')
  return matching.map(item => promptLanguageText(
    writingLanguage,
    `第${item.chapterNumber}章 ${item.title || '（无标题）'}：${item.purpose || '（无目标摘要）'}\n${item.keyEvents || ''}`,
    `Chapter ${item.chapterNumber} ${item.title || '(untitled)'}: ${item.purpose || '(no purpose summary)'}\n${item.keyEvents || ''}`,
  )).join('\n\n')
}

async function chapterSourceReference(item: BlueprintListSummary): Promise<BlueprintPlanningSourceReference> {
  const title = item.title ?? ''
  const purpose = item.purpose ?? ''
  const keyEvents = item.keyEvents ?? ''
  return {
    kind: 'chapter-summary',
    targetId: String(item.chapterNumber),
    chapterNumber: item.chapterNumber,
    volumeId: item.volumeId ?? null,
    revision: null,
    contentHash: blueprintPlanningChapterSummaryHash({ keyEvents, purpose, title }),
    label: item.title || `Chapter ${item.chapterNumber}`,
  }
}

function volumeSourceReference(volume: BlueprintVolumeData): BlueprintPlanningSourceReference {
  return {
    kind: 'volume',
    targetId: volume.id,
    volumeId: volume.id,
    contentHash: blueprintPlanningVolumeMetadataHash({
      id: volume.id,
      name: volume.name,
      sortOrder: volume.sortOrder,
    }),
    label: volume.name,
  }
}

function volumeIndexSourceReference(volumes: BlueprintVolumeData[]): BlueprintPlanningSourceReference {
  return {
    kind: 'volume-index',
    targetId: 'main',
    contentHash: blueprintPlanningVolumeIndexHash(volumes.map(volume => ({
      id: volume.id,
      name: volume.name,
      sortOrder: volume.sortOrder,
    }))),
    label: 'Volume directory',
  }
}

function volumeOutlineSourceReference(
  volumeId: string,
  outline: BlueprintVolumeOutlineSummary | BlueprintVolumeOutline | null,
  label?: string,
): BlueprintPlanningSourceReference {
  return outline
    ? {
        kind: 'volume-outline',
        targetId: volumeId,
        volumeId,
        revision: outline.revision,
        contentHash: outline.contentHash,
        label: label ?? volumeId,
      }
    : {
        kind: 'volume-outline',
        targetId: volumeId,
        volumeId,
        revision: 0,
        contentHash: blueprintPlanningTextHash(''),
        label: label ?? volumeId,
      }
}

function chapterIndexSourceReference(
  chapters: BlueprintListSummary[],
  targetId: string,
): BlueprintPlanningSourceReference {
  return {
    kind: 'chapter-index',
    targetId,
    contentHash: blueprintPlanningChapterIndexHash(chapters.map(chapter => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title ?? '',
      purpose: chapter.purpose ?? '',
      keyEvents: chapter.keyEvents ?? '',
      volumeId: chapter.volumeId ?? '',
    }))),
    label: targetId === 'main' ? 'Chapter directory' : `Chapter directory for volume ${targetId}`,
  }
}

function expectedMissingChapterReference(chapterNumber: number): BlueprintPlanningSourceReference {
  return {
    kind: 'chapter-summary',
    targetId: String(chapterNumber),
    chapterNumber,
    revision: 0,
    contentHash: blueprintPlanningTextHash(''),
    label: `Chapter ${chapterNumber} must remain unassigned`,
  }
}

function validateInput(input: BlueprintPlanningCommandInput): void {
  if (!input.operationId.trim()) throw new Error('Missing operationId')
  if (input.kind === 'book-outline' && input.scope.kind !== 'book') throw new Error('book-outline requires book scope')
  if (input.kind === 'volume-plan' && input.scope.kind !== 'book') throw new Error('volume-plan requires book scope')
  if (input.kind === 'volume-outline' && input.scope.kind !== 'volume') throw new Error('volume-outline requires volume scope')
  if (input.kind === 'chapter-plan' && input.scope.kind !== 'volume') throw new Error('chapter-plan requires volume scope')
  if (input.kind === 'chapter-expand' && input.scope.kind !== 'chapter') throw new Error('chapter-expand requires chapter scope')
  if (input.kind === 'connection-check' && input.scope.kind === 'chapter') throw new Error('connection-check requires book or volume scope')
  if (input.scope.kind === 'volume' && (!input.scope.volumeId.trim() || input.scope.volumeId.length > 160)) {
    throw new Error('volume scope requires a valid stable volumeId')
  }
  if (input.scope.kind === 'chapter' && (!Number.isSafeInteger(input.scope.chapterNumber) || input.scope.chapterNumber < 1)) {
    throw new Error('chapter scope requires a positive global chapter number')
  }
  if (input.kind === 'chapter-plan') {
    const range = input.chapterRange
    if (!range || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 1 || range.from > range.to) {
      throw new Error('chapter-plan requires a valid author-selected chapter range')
    }
    if (range.to - range.from + 1 > MAX_PLAN_CHAPTERS) throw new Error('chapter-plan range exceeds the batch limit')
  }
  if (input.plannedChapterCount !== undefined && (!Number.isSafeInteger(input.plannedChapterCount) || input.plannedChapterCount < 0)) {
    throw new Error('plannedChapterCount must be a non-negative integer')
  }
  if (input.totalChapters !== undefined && (!Number.isSafeInteger(input.totalChapters) || input.totalChapters < 0)) {
    throw new Error('totalChapters must be a non-negative integer')
  }
}

export class BlueprintPlanningCommand extends BaseWorkflowCommand<string> {
  constructor(
    private readonly input: BlueprintPlanningCommandInput,
    dependencies?: WorkflowGenerationRuntimeDependencies,
  ) {
    super(dependencies)
    validateInput(input)
  }

  async execute(params: CommandExecuteParams): Promise<string> {
    const intent = this.input.kind === 'book-outline' || this.input.kind === 'volume-outline'
      ? 'text'
      : 'structured'
    return this.executeWithGenerationRuntime(intent, params, () => this.executeWithinRuntime(params))
  }

  private async executeWithinRuntime({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const projectSession = context.projectSession
    assertSession(projectSession, context)
    const writingLanguage = context.writingLanguage
    const kind = this.input.kind
    if (kind === 'connection-check') return this.runConnectionCheck(context, callbacks)

    const capture = await this.capture(projectSession, context)
    const promptTemplateKey = kind === 'chapter-plan' ? 'chapter_blueprint_chunk' : 'synopsis'
    const template = await resolvePromptTemplate(promptTemplateKey, projectSession, writingLanguage)
    if (!template) throw new Error(`Missing ${promptTemplateKey} prompt template`)
    assertSession(projectSession, context)
    const novelConfig = this.input.novelConfigSnapshot
    if (!novelConfig) throw new Error('Project settings are unavailable')

    const generated = kind === 'book-outline'
      ? await this.generateBookOutline(capture, template, novelConfig, context, callbacks)
      : kind === 'volume-plan'
        ? await this.generateVolumePlan(capture, template, novelConfig, context, callbacks)
        : kind === 'volume-outline'
          ? await this.generateVolumeOutline(capture, template, novelConfig, context, callbacks)
          : kind === 'chapter-plan'
            ? await this.generateChapterPlan(capture, template, novelConfig, context, callbacks)
            : await this.generateChapterExpansion(capture, template, context, callbacks)

    this.assertNotCancelled(context)
    assertSession(projectSession, context)
    callbacks.log(promptLanguageText(
      writingLanguage,
      '正在保存待确认规划候选；尚未修改正式总纲、卷纲或章节。',
      'Saving the planning candidate for review; no formal book, volume, or chapter outline has been changed.',
    ))
    const candidateInput: BlueprintPlanningCandidateSaveInput = {
      operationId: this.input.operationId,
      kind,
      scope: this.input.scope,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      candidate: generated.candidate,
      sourceSnapshot: generated.sourceSnapshot,
    }
    const result = await ipc.invokeWithProjectSession(
      projectSession,
      'db:blueprint-planning-candidate-save',
      candidateInput,
      projectSession.projectPath,
    )
    assertSession(projectSession, context)
    if (!result.success) throw new Error(`${result.code}: ${result.error}`)
    context.data.blueprintPlanningOperationId = this.input.operationId
    context.data.blueprintPlanningKind = kind
    context.data.blueprintPlanningSelection = this.input.scope
    callbacks.setProgress(100)
    return promptLanguageText(
      writingLanguage,
      `候选已保存，编号 ${this.input.operationId}。请在蓝图工作区预览、编辑并明确确认。`,
      `Candidate saved as ${this.input.operationId}. Review, edit, and explicitly confirm it in the blueprint workspace.`,
    )
  }

  private async capture(projectSession: ProjectSessionContext, context: WorkflowContext): Promise<SourceCapture> {
    assertSession(projectSession, context)
    const [core, volumes, outlineSummaries, chapterSummaries] = await Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:project-core-get', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-list', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-volume-outline-list-summaries', projectSession.projectPath),
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-list-summary', projectSession.projectPath),
    ])
    assertSession(projectSession, context)
    if (!core) throw new Error('Project core data has not been initialized')
    return { core, volumes, outlineSummaries, chapterSummaries }
  }

  private async synopsisSource(core: SourceCapture['core']): Promise<BlueprintPlanningSourceReference> {
    const synopsis = core.synopsis ?? ''
    return { kind: 'synopsis', targetId: 'main', contentHash: blueprintPlanningTextHash(synopsis), label: 'Whole-book synopsis' }
  }

  private async createSnapshot(
    target: Pick<BlueprintPlanningSourceSnapshot, 'targetKind' | 'targetId' | 'targetRevision' | 'targetHash'>,
    operationId: string,
    sources: BlueprintPlanningSourceReference[],
  ): Promise<BlueprintPlanningSourceSnapshot> {
    return {
      snapshotId: randomUUID(),
      operationId,
      ...target,
      sources,
      createdAt: new Date().toISOString(),
    }
  }

  private async hashInputAndTemplate(
    input: unknown,
    template: PromptTemplate,
    kind: string,
  ): Promise<BlueprintPlanningSourceReference[]> {
    return contextFingerprintSources(
      await hashValue(input),
      await hashValue({
        content: template.content,
        systemSuffix: template.systemSuffix ?? '',
        taskGuidance: template.taskGuidance ?? '',
        systemRole: template.systemRole ?? '',
        requiredContextVariables: template.requiredContextVariables ?? [],
        writingLanguage: template.writingLanguage ?? '',
      }),
      kind,
    )
  }

  private async generateBookOutline(
    capture: SourceCapture,
    template: PromptTemplate,
    novelConfig: NovelConfig,
    context: WorkflowContext,
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<{ candidate: unknown; sourceSnapshot: BlueprintPlanningSourceSnapshot }> {
    const writingLanguage = context.writingLanguage
    const core = capture.core
    const synopsis = core.synopsis ?? ''
    const { getPlotStructureGuide, getNarrativePOVLabel } = await import('../architecture-workflow')
    const totalChapters = Number(novelConfig.totalChapters) > 0 ? Number(novelConfig.totalChapters) : 0
    const guide = totalChapters > 0
      ? getPlotStructureGuide(String(novelConfig.plotStructure || 'three_act'), totalChapters, writingLanguage)
      : ''
    const templateContent = renderTemplateContent(template, {
      premise: core.premise,
      character_dynamics: core.charactersArch,
      world_building: core.worldbuilding,
      genre: String(novelConfig.genre ?? ''),
      number_of_chapters: String(totalChapters),
      word_number: String(novelConfig.wordsPerChapter ?? ''),
      plot_structure_guide: guide,
      narrative_pov: getNarrativePOVLabel(String(novelConfig.narrativePOV || 'third_limited'), writingLanguage),
      global_guidance: String(novelConfig.globalGuidance ?? ''),
      step_guidance: this.input.guidance ?? '',
    }, writingLanguage)
    const prompt = [
      templateContent,
      promptLanguageText(
        writingLanguage,
        `【任务】${this.input.mode === 'improve' || (this.input.mode !== 'generate' && synopsis.trim()) ? '基于现有全书总纲生成一份可比较的改进候选' : '为全书生成一份总纲候选'}。输出完整 Markdown 正文，不要写入数据库，不要拆成分卷或章节细纲。请保留作者已有事实与明确设定；若现有总纲非空，不得假设它已过时。`,
        `[Task] ${this.input.mode === 'improve' || (this.input.mode !== 'generate' && synopsis.trim()) ? 'Create a comparable improvement candidate from the current book outline' : 'Create a whole-book outline candidate'}. Output the complete Markdown body. Do not write to the database or turn it into volume or chapter outlines. Preserve explicit author facts and settings; do not assume a non-empty current outline is obsolete.`,
      ),
      promptLanguageText(writingLanguage, `【当前全书总纲原文】\n${synopsis || '（空）'}`, `[Current whole-book outline]\n${synopsis || '(empty)'}`),
      promptLanguageText(writingLanguage, `【故事前提】\n${core.premise || '（未填写）'}`, `[Premise]\n${core.premise || '(not provided)'}`),
      promptLanguageText(writingLanguage, `【角色架构】\n${core.charactersArch || '（未填写）'}`, `[Character architecture]\n${core.charactersArch || '(not provided)'}`),
      promptLanguageText(writingLanguage, `【世界观】\n${core.worldbuilding || '（未填写）'}`, `[Worldbuilding]\n${core.worldbuilding || '(not provided)'}`),
      promptLanguageText(writingLanguage, `【项目配置】\n${JSON.stringify(novelConfig, null, 2)}`, `[Project configuration]\n${JSON.stringify(novelConfig, null, 2)}`),
      ...(guide ? [guide] : []),
      promptLanguageText(writingLanguage, `【作者指导】\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`, `[Author guidance]\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`),
      promptLanguageText(writingLanguage, '只返回完整 Markdown，不要添加解释或代码围栏。', 'Return only the complete Markdown body, with no explanation or code fence.'),
    ].filter(Boolean).join('\n\n')
    callbacks.log(promptLanguageText(writingLanguage, '正在生成全书总纲候选…', 'Generating a whole-book outline candidate…'))
    const result = await this.callLLMWithBoundedCompletion(
      prompt,
      composePromptSystemRole({ systemRole: template.systemRole }, writingLanguage),
      callbacks,
      { mode: 'append-visible-text', maxContinuations: 3 },
      { purpose: 'blueprint-book-outline-candidate', reasoningStage: 'planning', writingSkillStage: 'planning' },
      context,
    )
    this.assertNotCancelled(context)
    const markdown = result.trim()
    if (!markdown || markdown.length > MAX_MARKDOWN_CHARS) throw new Error('Whole-book outline candidate is empty or too large')
    const synopsisRef = await this.synopsisSource(core)
    const promptSources = await this.hashInputAndTemplate({
      synopsis,
      premise: core.premise,
      charactersArch: core.charactersArch,
      worldbuilding: core.worldbuilding,
      novelConfig,
      guidance: this.input.guidance ?? '',
      mode: this.input.mode ?? 'auto',
      language: writingLanguage,
    }, template, 'book-outline')
    const sourceSnapshot = await this.createSnapshot({
      targetKind: 'book',
      targetId: 'main',
      targetRevision: null,
      targetHash: synopsisRef.contentHash,
    }, this.input.operationId, [synopsisRef, ...promptSources])
    return { candidate: { markdown }, sourceSnapshot }
  }

  private async generateVolumePlan(
    capture: SourceCapture,
    template: PromptTemplate,
    novelConfig: NovelConfig,
    context: WorkflowContext,
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<{ candidate: unknown; sourceSnapshot: BlueprintPlanningSourceSnapshot }> {
    const writingLanguage = context.writingLanguage
    const synopsis = capture.core.synopsis ?? ''
    if (!synopsis.trim()) throw new Error(promptLanguageText(writingLanguage, '全书总纲为空，无法规划分卷。', 'The whole-book outline is empty; volume planning cannot start.'))
    const outlineByVolume = new Map(capture.outlineSummaries.map(item => [item.volumeId, item]))
    const currentVolumes = capture.volumes.map(volume => ({
      volumeId: volume.id,
      name: volume.name,
      sortOrder: volume.sortOrder,
      outline: outlineByVolume.get(volume.id)?.summary ?? '',
      actualChapterCount: capture.chapterSummaries.filter(chapter => chapter.volumeId === volume.id).length,
    }))
    const prompt = [
      renderTemplateContent(template, {
        premise: capture.core.premise,
        character_dynamics: capture.core.charactersArch,
        world_building: capture.core.worldbuilding,
        genre: String(novelConfig.genre ?? ''),
        number_of_chapters: String(novelConfig.totalChapters ?? ''),
        word_number: String(novelConfig.wordsPerChapter ?? ''),
        global_guidance: String(novelConfig.globalGuidance ?? ''),
        step_guidance: this.input.guidance ?? '',
      }, writingLanguage),
      promptLanguageText(
        writingLanguage,
        '基于冻结的全书总纲规划分卷。请只返回 JSON：{"volumes":[{"existingVolumeId":null,"name":"卷名","sortOrder":1,"plannedChapterCount":20,"markdown":"卷纲 Markdown"}]}。existingVolumeId 只有在明确要更新某一现有卷时才可填写，必须逐字使用给定 ID；不得按卷名匹配或合并。新卷由程序分配稳定 ID。plannedChapterCount 是计划值，绝不是实际章数或自动归属范围。',
        'Plan volumes from the frozen whole-book outline. Return only JSON: {"volumes":[{"existingVolumeId":null,"name":"Volume name","sortOrder":1,"plannedChapterCount":20,"markdown":"volume outline Markdown"}]}. Set existingVolumeId only when explicitly updating one listed existing volume, using its exact ID; never match or merge by name. The app assigns stable IDs to new volumes. plannedChapterCount is a plan, never an actual count or automatic chapter assignment range.',
      ),
      promptLanguageText(writingLanguage, `【全书总纲】\n${synopsis}`, `[Whole-book outline]\n${synopsis}`),
      promptLanguageText(writingLanguage, `【现有卷目录与有界卷纲摘要】\n${JSON.stringify(currentVolumes, null, 2)}`, `[Existing volumes and bounded outline summaries]\n${JSON.stringify(currentVolumes, null, 2)}`),
      promptLanguageText(writingLanguage, `【篇幅偏好】总章数约 ${Number(this.input.totalChapters ?? novelConfig.totalChapters) || '未指定'}；计划分卷数/章数偏好：${this.input.plannedChapterCount ?? '由作者选择'}。`, `[Length preference] About ${Number(this.input.totalChapters ?? novelConfig.totalChapters) || 'unspecified'} total chapters; volume/count preference: ${this.input.plannedChapterCount ?? 'author selects'}.`),
      promptLanguageText(writingLanguage, `【作者指导】\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`, `[Author guidance]\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`),
    ].filter(Boolean).join('\n\n')
    callbacks.log(promptLanguageText(writingLanguage, '正在规划卷纲候选…', 'Generating volume-plan candidates…'))
    const raw = await this.callLLMWithBoundedCompletion(
      prompt,
      composePromptSystemRole({ systemRole: template.systemRole }, writingLanguage),
      callbacks,
      { mode: 'replace-structured-output', maxContinuations: 1 },
      { responseFormat: { type: 'json_object' }, purpose: 'blueprint-volume-plan', reasoningStage: 'planning', writingSkillStage: 'planning' },
      context,
    )
    this.assertNotCancelled(context)
    const parsed = recordOf(extractJson(raw))
    if (!Array.isArray(parsed.volumes) || parsed.volumes.length < 1 || parsed.volumes.length > MAX_PLAN_VOLUMES) {
      throw new Error('Volume plan must contain 1–30 candidate volumes')
    }
    const existingIds = new Set(capture.volumes.map(volume => volume.id))
    const volumes = parsed.volumes.map((item, index) => {
      const rawVolume = recordOf(item)
      const existingVolumeId = rawVolume.existingVolumeId == null ? null : boundedString(rawVolume.existingVolumeId, 160, 'existingVolumeId')
      if (existingVolumeId && !existingIds.has(existingVolumeId)) throw new Error('Volume candidate refers to an unknown existing volume ID')
      const existing = existingVolumeId
        ? capture.volumes.find(volume => volume.id === existingVolumeId)
        : undefined
      const outline = existing ? outlineByVolume.get(existing.id) : undefined
      return {
        volumeId: existingVolumeId || randomUUID(),
        isNew: !existingVolumeId,
        name: boundedString(rawVolume.name, 160, 'name'),
        sortOrder: Number.isSafeInteger(rawVolume.sortOrder) && Number(rawVolume.sortOrder) >= 0
          ? Number(rawVolume.sortOrder)
          : index,
        plannedChapterCount: Number.isSafeInteger(rawVolume.plannedChapterCount) && Number(rawVolume.plannedChapterCount) >= 0
          ? Number(rawVolume.plannedChapterCount)
          : null,
        markdown: appendPlannedChapterCount(
          boundedString(rawVolume.markdown, MAX_MARKDOWN_CHARS, 'markdown', true),
          Number.isSafeInteger(rawVolume.plannedChapterCount) ? Number(rawVolume.plannedChapterCount) : null,
          writingLanguage,
        ),
        expectedOutlineRevision: outline?.revision ?? 0,
      }
    })
    const ids = volumes.map(volume => volume.volumeId)
    if (new Set(ids).size !== ids.length) throw new Error('Volume candidate IDs must be unique')
    const synopsisRef = await this.synopsisSource(capture.core)
    const sourceRefs: BlueprintPlanningSourceReference[] = [
      synopsisRef,
      volumeIndexSourceReference(capture.volumes),
      chapterIndexSourceReference(capture.chapterSummaries, 'main'),
    ]
    for (const volume of capture.volumes) {
      const summary = outlineByVolume.get(volume.id)
      sourceRefs.push(volumeSourceReference(volume), volumeOutlineSourceReference(volume.id, summary ?? null, volume.name))
    }
    for (const item of volumes.filter(volume => volume.isNew)) {
      sourceRefs.push({
        kind: 'volume', targetId: item.volumeId, volumeId: item.volumeId,
        revision: 0, contentHash: blueprintPlanningTextHash(''), label: item.name,
      })
    }
    const promptSources = await this.hashInputAndTemplate({
      synopsis,
      currentVolumes,
      novelConfig,
      guidance: this.input.guidance ?? '',
      plannedChapterCount: this.input.plannedChapterCount ?? null,
      totalChapters: this.input.totalChapters ?? null,
    }, template, 'volume-plan')
    sourceRefs.push(...promptSources)
    const sourceSnapshot = await this.createSnapshot({
      targetKind: 'book',
      targetId: 'main',
      targetRevision: null,
      targetHash: synopsisRef.contentHash,
    }, this.input.operationId, sourceRefs)
    return { candidate: { volumes: volumes.map(({ plannedChapterCount: _count, ...volume }) => volume) }, sourceSnapshot }
  }

  private async volumeOutlineContext(
    volumeId: string,
    capture: SourceCapture,
    context: WorkflowContext,
  ): Promise<{ volume: BlueprintVolumeData; outline: BlueprintVolumeOutline | null; neighbors: BlueprintVolumeData[] }> {
    const volume = capture.volumes.find(item => item.id === volumeId)
    if (!volume) throw new Error(`VOLUME_NOT_FOUND: ${volumeId}`)
    const outline = await ipc.invokeWithProjectSession(context.projectSession, 'db:blueprint-volume-outline-get', volumeId, context.projectPath)
    assertSession(context.projectSession, context)
    const index = capture.volumes.findIndex(item => item.id === volumeId)
    const neighbors = capture.volumes.filter((_, neighborIndex) => Math.abs(neighborIndex - index) <= 1)
    return { volume, outline, neighbors }
  }

  private async generateVolumeOutline(
    capture: SourceCapture,
    template: PromptTemplate,
    novelConfig: NovelConfig,
    context: WorkflowContext,
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<{ candidate: unknown; sourceSnapshot: BlueprintPlanningSourceSnapshot }> {
    const writingLanguage = context.writingLanguage
    if (this.input.scope.kind !== 'volume') throw new Error('volume-outline requires volume scope')
    const volumeId = this.input.scope.volumeId
    const { volume, outline, neighbors } = await this.volumeOutlineContext(volumeId, capture, context)
    const allSiblingChapters = capture.chapterSummaries.filter(chapter => chapter.volumeId === volumeId)
    const siblingChapters = allSiblingChapters.slice(0, 80)
    const adjacentOutlines = capture.outlineSummaries
      .filter(item => neighbors.some(neighbor => neighbor.id === item.volumeId) && item.volumeId !== volumeId)
      .map(item => ({ volumeId: item.volumeId, revision: item.revision, summary: item.summary }))
    const synopsis = capture.core.synopsis ?? ''
    const prompt = [
      renderTemplateContent(template, {
        premise: capture.core.premise,
        character_dynamics: capture.core.charactersArch,
        world_building: capture.core.worldbuilding,
        genre: String(novelConfig.genre ?? ''),
        number_of_chapters: String(novelConfig.totalChapters ?? ''),
        planned_chapter_count: String(this.input.plannedChapterCount ?? ''),
        global_guidance: String(novelConfig.globalGuidance ?? ''),
        step_guidance: this.input.guidance ?? '',
      }, writingLanguage),
      promptLanguageText(
        writingLanguage,
        '请为指定卷生成独立卷纲候选，输出完整 Markdown 正文，不要写入数据库。卷纲按需包含：卷定位与阶段目标、核心矛盾、主线推进、角色弧光、关键转折与高潮、伏笔承接与回收、卷末状态、与前后卷衔接、预计章节数量。允许空节与自定义节，不要把预计章节数当成实际章归属。',
        'Create an independent volume-outline candidate for the specified volume. Return the complete Markdown body without writing to the database. Sections may cover volume position and stage goal, central conflict, main-plot movement, character arcs, turns and climax, setup and payoff, ending state, adjacent-volume handoffs, and estimated chapter count. Empty and custom sections are valid. Do not treat an estimated chapter count as actual chapter ownership.',
      ),
      promptLanguageText(writingLanguage, `【目标卷】${volume.name}（稳定 volumeId=${volumeId}）\n【现有卷纲】\n${outline?.markdown ?? '（尚无卷纲）'}`, `[Target volume] ${volume.name} (stable volumeId=${volumeId})\n[Current volume outline]\n${outline?.markdown ?? '(no outline yet)'}`),
      promptLanguageText(writingLanguage, `【全书总纲原文】\n${synopsis}`, `[Whole-book outline]\n${synopsis}`),
      promptLanguageText(writingLanguage, `【相邻卷有界摘要】\n${JSON.stringify(adjacentOutlines, null, 2)}`, `[Bounded adjacent-volume summaries]\n${JSON.stringify(adjacentOutlines, null, 2)}`),
      promptLanguageText(writingLanguage, `【本卷已有章纲摘要】\n${formatChapterSummaries(siblingChapters, writingLanguage, volumeId)}`, `[Existing chapter summaries in this volume]\n${formatChapterSummaries(siblingChapters, writingLanguage, volumeId)}`),
      promptLanguageText(writingLanguage, `【作者指导】\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`, `[Author guidance]\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`),
      ...(this.input.plannedChapterCount !== undefined
        ? [promptLanguageText(
            writingLanguage,
            `【作者指定预计章节数】${this.input.plannedChapterCount} 章。这只是卷内规划值，不得自动分配蓝图章节。`,
            `[Author-selected planned chapter count] ${this.input.plannedChapterCount}. This is a volume planning value and must not assign blueprint chapters automatically.`,
          )]
        : []),
      promptLanguageText(writingLanguage, '只返回完整 Markdown，不要添加解释或代码围栏。', 'Return only the complete Markdown body, with no explanation or code fence.'),
    ].join('\n\n')
    callbacks.log(promptLanguageText(writingLanguage, `正在生成「${volume.name}」卷纲候选…`, `Generating a candidate outline for ${volume.name}…`))
    const raw = await this.callLLMWithBoundedCompletion(
      prompt,
      composePromptSystemRole({ systemRole: template.systemRole }, writingLanguage),
      callbacks,
      { mode: 'append-visible-text', maxContinuations: 3 },
      { purpose: 'blueprint-volume-outline-candidate', reasoningStage: 'planning', writingSkillStage: 'planning' },
      context,
    )
    const markdown = appendPlannedChapterCount(raw, this.input.plannedChapterCount, writingLanguage)
    if (!markdown || markdown.length > MAX_MARKDOWN_CHARS) throw new Error('Volume outline candidate is empty or too large')
    const synopsisRef = await this.synopsisSource(capture.core)
    const sources: BlueprintPlanningSourceReference[] = [
      synopsisRef,
      volumeSourceReference(volume),
      volumeIndexSourceReference(capture.volumes),
      chapterIndexSourceReference(allSiblingChapters, volumeId),
      volumeOutlineSourceReference(volumeId, outline, volume.name),
      ...neighbors
        .filter(item => item.id !== volumeId)
        .map(item => volumeOutlineSourceReference(item.id, capture.outlineSummaries.find(summary => summary.volumeId === item.id) ?? null, item.name)),
      ...await this.hashInputAndTemplate({ synopsis, volume, outlineRevision: outline?.revision ?? 0, outlineHash: outline?.contentHash ?? blueprintPlanningTextHash(''), adjacentOutlines, siblingChapters, plannedChapterCount: this.input.plannedChapterCount ?? null, guidance: this.input.guidance ?? '', novelConfig }, template, 'volume-outline'),
    ]
    const sourceSnapshot = await this.createSnapshot({
      targetKind: 'volume', targetId: volumeId, targetRevision: outline?.revision ?? 0, targetHash: outline?.contentHash ?? blueprintPlanningTextHash(''),
    }, this.input.operationId, sources)
    return { candidate: { volumeId, markdown, expectedRevision: outline?.revision ?? 0 }, sourceSnapshot }
  }

  private async generateChapterPlan(
    capture: SourceCapture,
    template: PromptTemplate,
    novelConfig: NovelConfig,
    context: WorkflowContext,
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<{ candidate: unknown; sourceSnapshot: BlueprintPlanningSourceSnapshot }> {
    const writingLanguage = context.writingLanguage
    if (this.input.scope.kind !== 'volume' || !this.input.chapterRange) throw new Error('chapter-plan requires volume scope and a chapter range')
    const volumeId = this.input.scope.volumeId
    const { volume, outline } = await this.volumeOutlineContext(volumeId, capture, context)
    const { from, to } = this.input.chapterRange
    const currentRangeChapters = capture.chapterSummaries.filter(chapter => chapter.chapterNumber >= from && chapter.chapterNumber <= to)
    if (currentRangeChapters.length > 0) {
      throw new Error(`Chapter range contains existing chapter blueprints (${currentRangeChapters.map(item => item.chapterNumber).join(', ')}); choose a range with no existing rows.`)
    }
    const allSiblingChapters = capture.chapterSummaries.filter(chapter => chapter.volumeId === volumeId)
    const siblingChapters = allSiblingChapters.slice(0, 80)
    const synopsis = capture.core.synopsis ?? ''
    const chapterList = formatChapterSummaries(siblingChapters, writingLanguage, volumeId)
    const prompt = [
      renderTemplateContent(template, {
        novel_architecture: synopsis,
        chapter_list: formatChapterSummaries(siblingChapters, writingLanguage, volumeId),
        number_of_chapters: String(novelConfig.totalChapters ?? ''),
        n: String(this.input.chapterRange?.from ?? ''),
        m: String(this.input.chapterRange?.to ?? ''),
        genre: String(novelConfig.genre ?? ''),
        global_guidance: String(novelConfig.globalGuidance ?? ''),
        pacing_guidance: this.input.guidance ?? '',
      }, writingLanguage),
      promptLanguageText(
        writingLanguage,
        `请只为指定卷规划章节简纲，输出与既有章节蓝图合同兼容的 JSON。每个 blueprints 项还必须包含 planning 对象，字段为 volumeTask、handoff、expectedEndChange（均为字符串，可留空）；这些是后续展开细纲要沿用的确认规划。唯一允许的 chapterNumber 范围为 ${from}–${to}，每个章号恰好出现一次，禁止重用全书其他章节号；候选只是章节安排，不是完整 v2 分镜细纲。只新增，不覆盖已有人工/导入章节。不要修改正文卷、草稿绑定、人物、notes 或 userGuidance。`,
        `Plan simple chapter outlines only for this exact volume. Return JSON compatible with the existing chapter-blueprint contract. Every blueprints item must also include a planning object with string fields volumeTask, handoff, and expectedEndChange (empty strings are allowed); these are confirmed plans that the later detailed-outline expansion must carry forward. Use every chapterNumber from ${from} through ${to} exactly once; do not reuse any other global chapter number. These are chapter arrangements, not full v2 scene storyboards. Add only and never replace existing manual/imported chapter rows. Do not modify prose volumes, draft bindings, characters, notes, or userGuidance.`,
      ),
      promptLanguageText(writingLanguage, `【目标卷】${volume.name}（volumeId=${volumeId}）\n【卷纲】\n${outline?.markdown ?? '（尚无卷纲）'}`, `[Target volume] ${volume.name} (volumeId=${volumeId})\n[Volume outline]\n${outline?.markdown ?? '(no volume outline yet)'}`),
      promptLanguageText(writingLanguage, `【全书总纲】\n${synopsis}`, `[Whole-book outline]\n${synopsis}`),
      promptLanguageText(writingLanguage, `【本卷已有章纲摘要】\n${chapterList}`, `[Existing chapter summaries in this volume]\n${chapterList}`),
      promptLanguageText(writingLanguage, `【小说配置】\n${JSON.stringify(novelConfig, null, 2)}`, `[Novel configuration]\n${JSON.stringify(novelConfig, null, 2)}`),
      promptLanguageText(writingLanguage, `【作者指导】\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`, `[Author guidance]\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`),
      promptLanguageText(writingLanguage, `必须完整返回 ${to - from + 1} 个章节。`, `Return exactly ${to - from + 1} complete chapter outline(s).`),
    ].join('\n\n')
    callbacks.log(promptLanguageText(writingLanguage, `正在规划卷「${volume.name}」第 ${from}–${to} 章…`, `Planning chapters ${from}-${to} in ${volume.name}…`))
    const raw = await this.callLLMWithBoundedCompletion(
      prompt,
      composePromptSystemRole({ systemRole: template.systemRole }, writingLanguage),
      callbacks,
      { mode: 'replace-structured-output', maxContinuations: 1 },
      { responseFormat: { type: 'json_object' }, purpose: 'blueprint-chapter-plan', reasoningStage: 'planning', writingSkillStage: 'planning' },
      context,
    )
    const parsedRoot = recordOf(extractJson(raw))
    if (!Array.isArray(parsedRoot.blueprints)) throw new Error('Chapter plan must return a blueprints array')
    const planningByChapter = new Map<number, { volumeTask: string; handoff: string; expectedEndChange: string }>()
    for (const rawItem of parsedRoot.blueprints) {
      const item = recordOf(rawItem)
      const chapterNumber = Number(item.chapterNumber ?? item.chapter_number)
      if (!Number.isSafeInteger(chapterNumber) || planningByChapter.has(chapterNumber)) throw new Error('Chapter plan contains an invalid or duplicate chapter number')
      const planning = recordOf(item.planning)
      planningByChapter.set(chapterNumber, {
        volumeTask: boundedString(planning.volumeTask, 2_000, 'planning.volumeTask', true),
        handoff: boundedString(planning.handoff, 2_000, 'planning.handoff', true),
        expectedEndChange: boundedString(planning.expectedEndChange, 2_000, 'planning.expectedEndChange', true),
      })
    }
    const chapters = parseTextBlueprintsStrict(raw, from, to).map((item: BlueprintData) => ({
      chapterNumber: item.chapterNumber,
      title: item.title,
      role: item.role,
      purpose: item.purpose,
      keyEvents: item.keyEvents,
      characters: item.characters,
      suspenseHook: item.suspenseHook,
      planning: planningByChapter.get(item.chapterNumber) ?? (() => { throw new Error(`Chapter ${item.chapterNumber} has no planning fields`) })(),
    }))
    if (chapters.some(chapter => chapter.chapterNumber < from || chapter.chapterNumber > to)) throw new Error('Chapter plan includes an unselected global chapter number')
    const synopsisRef = await this.synopsisSource(capture.core)
    const sources: BlueprintPlanningSourceReference[] = [
      synopsisRef,
      volumeSourceReference(volume),
      volumeOutlineSourceReference(volumeId, outline, volume.name),
      chapterIndexSourceReference(allSiblingChapters, volumeId),
      ...await Promise.all(allSiblingChapters.map(chapterSourceReference)),
      ...Array.from({ length: to - from + 1 }, (_, offset) => expectedMissingChapterReference(from + offset)),
      ...await this.hashInputAndTemplate({ synopsis, volume, outlineRevision: outline?.revision ?? 0, outlineHash: outline?.contentHash ?? blueprintPlanningTextHash(''), siblingChapters, chapterRange: this.input.chapterRange, guidance: this.input.guidance ?? '', novelConfig }, template, 'chapter-plan'),
    ]
    const sourceSnapshot = await this.createSnapshot({
      targetKind: 'volume', targetId: volumeId, targetRevision: outline?.revision ?? 0, targetHash: outline?.contentHash ?? blueprintPlanningTextHash(''),
    }, this.input.operationId, sources)
    return { candidate: { volumeId, chapterRange: { from, to }, chapters }, sourceSnapshot }
  }

  private async generateChapterExpansion(
    capture: SourceCapture,
    template: PromptTemplate,
    context: WorkflowContext,
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<{ candidate: unknown; sourceSnapshot: BlueprintPlanningSourceSnapshot }> {
    const writingLanguage = context.writingLanguage
    if (this.input.scope.kind !== 'chapter') throw new Error('chapter-expand requires chapter scope')
    const chapterNumber = this.input.scope.chapterNumber
    const [blueprint, currentDetail] = await Promise.all([
      ipc.invokeWithProjectSession(context.projectSession, 'db:blueprint-get', chapterNumber, context.projectPath),
      ipc.invokeWithProjectSession(context.projectSession, 'db:blueprint-v2-get', chapterNumber, context.projectPath),
    ])
    assertSession(context.projectSession, context)
    if (!blueprint) throw new Error(`Chapter ${chapterNumber} has no simple outline`)
    if (currentDetail) throw new Error('This chapter already has a v2 detail; explicit edit and compare it instead of expanding over it.')
    const volumeId = blueprint.volumeId ?? null
    const volumeOutline = volumeId
      ? await ipc.invokeWithProjectSession(context.projectSession, 'db:blueprint-volume-outline-get', volumeId, context.projectPath)
      : null
    assertSession(context.projectSession, context)
    const committedPlans = volumeId
      ? await ipc.invokeWithProjectSession(context.projectSession, 'db:blueprint-planning-candidate-list', {
          selection: { kind: 'volume', volumeId },
          states: ['committed'],
          limit: 200,
        }, context.projectPath)
      : []
    assertSession(context.projectSession, context)
    const confirmedChapterPlan = volumeId
      ? findConfirmedChapterPlanning(committedPlans as BlueprintPlanningCandidateRecord[], volumeId, chapterNumber)
      : null
    const plannedCandidate = confirmedChapterPlan?.candidate
    const confirmedPlan = confirmedChapterPlan?.planning
    const prompt = [
      renderTemplateContent(template, {
        premise: capture.core.premise,
        character_dynamics: capture.core.charactersArch,
        world_building: capture.core.worldbuilding,
        chapter_list: JSON.stringify({ title: blueprint.title, role: blueprint.role, purpose: blueprint.purpose, keyEvents: blueprint.keyEvents }, null, 2),
      }, writingLanguage),
      promptLanguageText(
        writingLanguage,
        '请将以下人工/导入章节简纲展开为完整 v2 Markdown 细纲候选，并以 JSON 输出：{"markdown":"...完整 Markdown...","planning":{"volumeTask":"...","handoff":"...","expectedEndChange":"..."}}。Markdown 至少包含本章定位、核心矛盾、逐场分镜、规则、章末目标、伏笔检查与写作禁忌；严格只根据既有简纲和卷纲，不把规划写成已发生事实。确认前不得保存。',
        'Expand the following chapter outline into a complete v2 Markdown candidate. Return JSON: {"markdown":"...complete Markdown...","planning":{"volumeTask":"...","handoff":"...","expectedEndChange":"..."}}. Include positioning, core conflict, scene storyboard, rules, chapter ending, foreshadowing checks, and writing taboos. Use only the supplied chapter and volume plans; do not present plans as established events. Do not save before confirmation.',
      ),
      promptLanguageText(writingLanguage, `【第${chapterNumber}章现有简纲】\n${JSON.stringify({ title: blueprint.title, role: blueprint.role, purpose: blueprint.purpose, keyEvents: blueprint.keyEvents, characters: blueprint.characters, suspenseHook: blueprint.suspenseHook }, null, 2)}`, `[Existing simple outline for Chapter ${chapterNumber}]\n${JSON.stringify({ title: blueprint.title, role: blueprint.role, purpose: blueprint.purpose, keyEvents: blueprint.keyEvents, characters: blueprint.characters, suspenseHook: blueprint.suspenseHook }, null, 2)}`),
      ...(volumeOutline ? [promptLanguageText(writingLanguage, `【本卷卷纲计划｜${volumeId}】\n${volumeOutline.markdown}`, `[Current volume outline plan | ${volumeId}]\n${volumeOutline.markdown}`)] : []),
      ...(confirmedPlan ? [promptLanguageText(
        writingLanguage,
        `【已确认的章节规划｜仅为计划，不代表已发生事实】\n${JSON.stringify(confirmedPlan, null, 2)}\n请在返回的 planning 字段中保留这三项原意，不要将其改写成已发生事实。`,
        `[Confirmed chapter plan | plans only, not established events]\n${JSON.stringify(confirmedPlan, null, 2)}\nPreserve these three fields in the returned planning object; do not rewrite them as events that already happened.`,
      )] : []),
      promptLanguageText(writingLanguage, `【作者指导】\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`, `[Author guidance]\n${htmlSafeGuidance(this.input.guidance, writingLanguage)}`),
    ].join('\n\n')
    callbacks.log(promptLanguageText(writingLanguage, `正在展开第 ${chapterNumber} 章细纲候选…`, `Expanding Chapter ${chapterNumber} into a detailed-outline candidate…`))
    const raw = await this.callLLMWithBoundedCompletion(
      prompt,
      composePromptSystemRole({ systemRole: template.systemRole }, writingLanguage),
      callbacks,
      { mode: 'replace-structured-output', maxContinuations: 1 },
      { responseFormat: { type: 'json_object' }, purpose: 'blueprint-chapter-expand', reasoningStage: 'planning', writingSkillStage: 'planning' },
      context,
    )
    const result = recordOf(extractJson(raw))
    const markdown = boundedString(result.markdown, MAX_MARKDOWN_CHARS, 'markdown')
    const parsed = parseChapterBlueprintMarkdown(markdown)
    if (parsed.suggestedChapterNumber !== null && parsed.suggestedChapterNumber !== chapterNumber) {
      throw new Error('Expanded v2 Markdown identifies a different chapter number')
    }
    const planningRecord = result.planning == null ? {} : recordOf(result.planning)
    const generatedPlanning = {
      volumeTask: boundedString(planningRecord.volumeTask ?? '', 2_000, 'planning.volumeTask', true),
      handoff: boundedString(planningRecord.handoff ?? '', 2_000, 'planning.handoff', true),
      expectedEndChange: boundedString(planningRecord.expectedEndChange ?? '', 2_000, 'planning.expectedEndChange', true),
    }
    const content: ChapterBlueprintV2Content = {
      ...parsed.content,
      chapterNumber,
      origin: 'manual',
      planning: confirmedPlan ?? generatedPlanning,
    }
    assertValidChapterBlueprintV2Content(content)
    assertNoLossOnSerialize(content)
    const synopsisRef = await this.synopsisSource(capture.core)
    const rowHash = blueprintPlanningChapterSummaryHash({
      keyEvents: blueprint.keyEvents ?? '', purpose: blueprint.purpose ?? '', title: blueprint.title ?? '',
    })
    const volume = volumeId ? capture.volumes.find(item => item.id === volumeId) : undefined
    const sources: BlueprintPlanningSourceReference[] = [
      synopsisRef,
      { kind: 'chapter-summary', targetId: String(chapterNumber), chapterNumber, volumeId, revision: null, contentHash: rowHash, label: blueprint.title || `Chapter ${chapterNumber}` },
      { kind: 'chapter-volume', targetId: String(chapterNumber), chapterNumber, volumeId, contentHash: blueprintPlanningChapterVolumeHash(volumeId ?? ''), label: 'Chapter ownership' },
      { kind: 'chapter-detail', targetId: String(chapterNumber), chapterNumber, revision: 0, contentHash: blueprintPlanningTextHash(''), label: 'Chapter v2 detail must remain empty' },
      ...(volume ? [volumeSourceReference(volume)] : []),
      ...(volumeId ? [volumeOutlineSourceReference(volumeId, volumeOutline, 'Current volume outline')] : []),
      ...await this.hashInputAndTemplate({
        chapter: {
          chapterNumber,
          title: blueprint.title ?? '',
          role: blueprint.role ?? '',
          purpose: blueprint.purpose ?? '',
          keyEvents: blueprint.keyEvents ?? '',
          characters: blueprint.characters ?? '',
          suspenseHook: blueprint.suspenseHook ?? '',
          volumeId,
        },
        volumeOutline: volumeOutline ? { revision: volumeOutline.revision, contentHash: volumeOutline.contentHash } : null,
      confirmedPlan: confirmedPlan ?? null,
      planCandidate: plannedCandidate ? { operationId: plannedCandidate.operationId, payloadHash: plannedCandidate.payloadHash } : null,
        guidance: this.input.guidance ?? '',
        language: writingLanguage,
      }, template, 'chapter-expand'),
    ]
    const sourceSnapshot = await this.createSnapshot({
      targetKind: 'chapter', targetId: String(chapterNumber), targetRevision: 0, targetHash: blueprintPlanningTextHash(''),
    }, this.input.operationId, sources)
    return { candidate: { chapterNumber, baseRevision: 0, content }, sourceSnapshot }
  }

  private async runConnectionCheck(
    context: WorkflowContext,
    callbacks: CommandExecuteParams['callbacks'],
  ): Promise<string> {
    const projectSession = context.projectSession
    const writingLanguage = context.writingLanguage
    const capture = await this.capture(projectSession, context)
    const scope = this.input.scope
    const targetVolumeId = scope.kind === 'volume' ? scope.volumeId : undefined
    const volumeIds = scope.kind === 'book'
      ? capture.volumes.map(volume => volume.id)
      : [targetVolumeId!]
    const volume = targetVolumeId ? capture.volumes.find(item => item.id === targetVolumeId) : undefined
    if (targetVolumeId && !volume) throw new Error(`VOLUME_NOT_FOUND: ${targetVolumeId}`)
    const outlinesById = new Map(capture.outlineSummaries.map(item => [item.volumeId, item]))
    const chapters = capture.chapterSummaries.filter(chapter => volumeIds.includes(chapter.volumeId ?? ''))
    const deterministic: BlueprintPlanningCheckIssue[] = []
    if (scope.kind === 'book' && capture.volumes.length === 0) {
      deterministic.push({ code: 'NO_VOLUMES', severity: 'warning', message: promptLanguageText(writingLanguage, '尚未建立分卷。', 'No volumes have been created.'), sourceSnapshotId: undefined })
    }
    if (scope.kind === 'book' && !(capture.core.synopsis ?? '').trim()) deterministic.push({
      code: 'BOOK_OUTLINE_EMPTY', severity: 'warning',
      message: promptLanguageText(writingLanguage, '全书总纲为空。', 'The whole-book outline is empty.'),
    })
    const knownVolumeIds = new Set(capture.volumes.map(item => item.id))
    if (scope.kind === 'book') {
      for (const chapter of capture.chapterSummaries) {
        if (!chapter.volumeId) deterministic.push({
          code: 'CHAPTER_UNASSIGNED', severity: 'warning', chapterNumber: chapter.chapterNumber,
          message: promptLanguageText(writingLanguage, `第 ${chapter.chapterNumber} 章尚未归入规划卷。`, `Chapter ${chapter.chapterNumber} is not assigned to a planning volume.`),
        })
        else if (!knownVolumeIds.has(chapter.volumeId)) deterministic.push({
          code: 'INVALID_VOLUME_REFERENCE', severity: 'error', chapterNumber: chapter.chapterNumber, volumeId: chapter.volumeId,
          message: promptLanguageText(writingLanguage, `第 ${chapter.chapterNumber} 章引用了不存在的卷 ${chapter.volumeId}。`, `Chapter ${chapter.chapterNumber} refers to missing volume ${chapter.volumeId}.`),
        })
      }
    }
    for (const volumeId of volumeIds) {
      const outline = outlinesById.get(volumeId)
      if (!outline) deterministic.push({
        code: 'VOLUME_OUTLINE_MISSING', severity: 'warning', volumeId,
        message: promptLanguageText(writingLanguage, `卷 ${volumeId} 尚无卷纲。`, `Volume ${volumeId} has no outline yet.`),
      })
      else if (!outline.summary.trim()) deterministic.push({
        code: 'VOLUME_OUTLINE_EMPTY', severity: 'warning', volumeId,
        message: promptLanguageText(writingLanguage, `卷 ${volumeId} 的卷纲正文为空。`, `Volume ${volumeId} has an empty outline.`),
      })
    }
    if (targetVolumeId) {
      const volumeChapters = chapters.filter(chapter => chapter.volumeId === targetVolumeId)
      if (volumeChapters.length === 0) deterministic.push({
        code: 'VOLUME_HAS_NO_CHAPTERS', severity: 'warning', volumeId: targetVolumeId,
        message: promptLanguageText(writingLanguage, '本卷尚无实际归属章节。', 'This volume has no actual assigned chapters yet.'),
      })
      const dangling = capture.chapterSummaries.filter(chapter => chapter.volumeId === targetVolumeId && !capture.volumes.some(item => item.id === chapter.volumeId))
      for (const chapter of dangling) deterministic.push({
        code: 'INVALID_VOLUME_REFERENCE', severity: 'error', chapterNumber: chapter.chapterNumber, volumeId: targetVolumeId,
        message: promptLanguageText(writingLanguage, `第 ${chapter.chapterNumber} 章引用了不存在的卷。`, `Chapter ${chapter.chapterNumber} refers to a missing volume.`),
      })
    }
    const checkChapters = scope.kind === 'book'
      ? capture.chapterSummaries
      : chapters.filter(chapter => chapter.volumeId === targetVolumeId)
    const sourceRefs: BlueprintPlanningSourceReference[] = [
      scope.kind === 'book'
        ? volumeIndexSourceReference(capture.volumes)
        : volumeSourceReference(volume!),
      chapterIndexSourceReference(checkChapters, scope.kind === 'book' ? 'main' : targetVolumeId!),
    ]
    if (scope.kind === 'book') sourceRefs.push(await this.synopsisSource(capture.core))
    const allVolumeSummary = capture.volumes.map(item => ({
      volumeId: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      outline: outlinesById.get(item.id) ?? null,
      chapters: capture.chapterSummaries.filter(chapter => chapter.volumeId === item.id).map(chapter => ({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        purpose: chapter.purpose,
        keyEvents: chapter.keyEvents,
      })),
    }))
    if (scope.kind === 'book') {
      for (const item of allVolumeSummary) {
        const volumeRecord = capture.volumes.find(volumeRow => volumeRow.id === item.volumeId)
        if (volumeRecord) sourceRefs.push(volumeSourceReference(volumeRecord))
        sourceRefs.push(volumeOutlineSourceReference(item.volumeId, item.outline, item.name))
      }
    }
    for (const chapter of checkChapters) {
      sourceRefs.push(await chapterSourceReference(chapter))
      sourceRefs.push({
        kind: 'chapter-volume',
        targetId: String(chapter.chapterNumber),
        chapterNumber: chapter.chapterNumber,
        volumeId: chapter.volumeId ?? null,
        contentHash: blueprintPlanningChapterVolumeHash(chapter.volumeId ?? ''),
        label: `Chapter ${chapter.chapterNumber} ownership`,
      })
    }
    const targetOutlineSummary = targetVolumeId ? outlinesById.get(targetVolumeId) : undefined
    const targetHash = scope.kind === 'book'
      ? (await this.synopsisSource(capture.core)).contentHash
      : targetOutlineSummary?.contentHash ?? blueprintPlanningTextHash('')
    const targetRevision = scope.kind === 'book' ? null : targetOutlineSummary?.revision ?? 0
    const targetId = scope.kind === 'book' ? 'main' : targetVolumeId!
    const targetKind = scope.kind
    if (targetVolumeId) {
      sourceRefs.push(volumeOutlineSourceReference(targetVolumeId, targetOutlineSummary ?? null, volume!.name))
    }
    const template = await resolvePromptTemplate('synopsis', projectSession, writingLanguage)
    if (!template) throw new Error('Missing synopsis prompt template')
    const targetInput = scope.kind === 'book'
      ? {
          synopsis: capture.core.synopsis ?? '',
          volumes: allVolumeSummary,
          unassignedChapters: capture.chapterSummaries.filter(chapter => !chapter.volumeId).map(chapter => ({
            chapterNumber: chapter.chapterNumber,
            title: chapter.title,
            purpose: chapter.purpose,
            keyEvents: chapter.keyEvents,
          })),
          invalidVolumeReferences: capture.chapterSummaries.filter(chapter => chapter.volumeId && !knownVolumeIds.has(chapter.volumeId)).map(chapter => ({
            chapterNumber: chapter.chapterNumber,
            volumeId: chapter.volumeId,
            title: chapter.title,
            purpose: chapter.purpose,
            keyEvents: chapter.keyEvents,
          })),
        }
      : { volume: { id: volume?.id, name: volume?.name, outline: outlinesById.get(volume?.id ?? '')?.summary ?? '' }, chapters: chapters.filter(chapter => chapter.volumeId === volume?.id) }
    sourceRefs.push(...await this.hashInputAndTemplate({
      targetInput,
      guidance: this.input.guidance ?? '',
      scope,
      language: writingLanguage,
    }, template, 'connection-check'))
    const sourceSnapshot = await this.createSnapshot({
      targetKind, targetId, targetRevision, targetHash,
    }, this.input.operationId, sourceRefs)
    assertSession(projectSession, context)
    this.assertNotCancelled(context)
    const prompt = [
      promptLanguageText(
        writingLanguage,
        '对下列规划做衔接审查，只返回 JSON：{"suggestions":[{"message":"建议","volumeId":null,"chapterNumber":null,"citation":"来源位置或章号"}]}。只给可操作的叙事建议，不要把推断写成确定性事实；任何建议都要引用给定卷纲或章节摘要。',
        'Audit the planning connections below. Return only JSON: {"suggestions":[{"message":"suggestion","volumeId":null,"chapterNumber":null,"citation":"source location or chapter"}]}. Give actionable narrative suggestions without presenting inference as fact; every suggestion must cite a supplied volume outline or chapter summary.',
      ),
      JSON.stringify(targetInput, null, 2),
      promptLanguageText(writingLanguage, `【作者指导】${htmlSafeGuidance(this.input.guidance, writingLanguage)}`, `[Author guidance] ${htmlSafeGuidance(this.input.guidance, writingLanguage)}`),
    ].join('\n\n')
    callbacks.log(promptLanguageText(writingLanguage, '正在审查规划衔接；报告只读，不会改写蓝图。', 'Checking planning connections; the report is read-only and will not edit any outline.'))
    const raw = await this.callLLMWithBoundedCompletion(
      prompt,
      composePromptSystemRole({ systemRole: template.systemRole }, writingLanguage),
      callbacks,
      { mode: 'replace-structured-output', maxContinuations: 1 },
      { responseFormat: { type: 'json_object' }, purpose: 'blueprint-connection-check', reasoningStage: 'review', writingSkillStage: 'planning' },
      context,
    )
    const parsed = recordOf(extractJson(raw))
    const rawSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, MAX_CHECK_SUGGESTIONS) : []
    const aiSuggestions: BlueprintPlanningCheckIssue[] = rawSuggestions.flatMap((item, index) => {
      let suggestion: Record<string, unknown>
      try {
        suggestion = recordOf(item)
      } catch {
        return []
      }
      const chapterNumber = Number.isSafeInteger(suggestion.chapterNumber) && Number(suggestion.chapterNumber) > 0
        ? Number(suggestion.chapterNumber)
        : undefined
      if (chapterNumber !== undefined && !checkChapters.some(chapter => chapter.chapterNumber === chapterNumber)) return []
      if (suggestion.chapterNumber !== undefined && chapterNumber === undefined) return []
      if (suggestion.volumeId !== undefined && suggestion.volumeId !== null && typeof suggestion.volumeId !== 'string') return []
      const suppliedVolumeId = typeof suggestion.volumeId === 'string' ? suggestion.volumeId : undefined
      if (suppliedVolumeId && !volumeIds.includes(suppliedVolumeId)) return []
      let citation: string
      try {
        citation = boundedString(suggestion.citation, 240, 'suggestion.citation')
      } catch {
        return []
      }
      const citationSources = [stableBlueprintPlanningJson(targetInput)]
      if (chapterNumber !== undefined) {
        citationSources.push(`第${chapterNumber}章`, `Chapter ${chapterNumber}`)
        citationSources.push(...checkChapters.filter(chapter => chapter.chapterNumber === chapterNumber).flatMap(chapter => [
          chapter.title ?? '', chapter.purpose ?? '', chapter.keyEvents ?? '',
        ]))
      }
      if (suppliedVolumeId !== undefined) {
        citationSources.push(...allVolumeSummary.filter(item => item.volumeId === suppliedVolumeId).flatMap(item => [
          item.name, item.outline?.summary ?? '', item.volumeId,
        ]))
      }
      const normalizeCitation = (value: string) => value.replace(/\s+/gu, '').toLocaleLowerCase()
      const normalizedCitation = normalizeCitation(citation)
      if (!citationSources.some(source => source && normalizeCitation(source).includes(normalizedCitation))) return []
      let message: string
      try {
        message = boundedString(suggestion.message, 600, 'suggestion.message')
      } catch {
        return []
      }
      return [{
        code: `AI_SUGGESTION_${index + 1}`,
        severity: 'suggestion',
        message,
        ...(suppliedVolumeId ? { volumeId: suppliedVolumeId } : {}),
        ...(chapterNumber ? { chapterNumber } : {}),
        citation,
        sourceSnapshotId: sourceSnapshot.snapshotId,
      }]
    })
    const report: BlueprintPlanningCheckReport = {
      checkId: this.input.operationId,
      kind: this.input.scope.kind === 'book' ? 'book-volume' : 'volume-chapters',
      targetKind,
      targetId,
      targetRevision,
      targetHash,
      sourceSnapshot,
      deterministic,
      aiSuggestions,
      createdAt: new Date().toISOString(),
    }
    const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-planning-check-save', report, projectSession.projectPath)
    assertSession(projectSession, context)
    if (!result.success) throw new Error(`${result.code}: ${result.error}`)
    callbacks.setProgress(100)
    context.data.blueprintPlanningCheckId = report.checkId
    return promptLanguageText(
      writingLanguage,
      `衔接检查已保存（${deterministic.length} 项可验证检查，${aiSuggestions.length} 条 AI 建议）；报告只读。`,
      `Connection check saved (${deterministic.length} deterministic checks, ${aiSuggestions.length} AI suggestions); the report is read-only.`,
    )
  }
}
