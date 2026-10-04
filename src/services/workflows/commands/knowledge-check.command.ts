/**
 * 信息差检查 / 人物行动线检查 工作流命令（knowledge-action-outline-sync-contract §6/§8）。
 *
 * 有限任务边界：
 * - 只读取信息条目、知情记录、行动记录与关联数据，输出建议级检查报告（不写任何正式对象）。
 * - 每条发现必须携带具体引用；语义判断标为建议，模型判错不自动否决作者剧情。
 * - 检查结果经作者查看后自行决定是否修改数据；报告本身持久化可回看。
 */

import { ipc } from '../../ipc-client'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import type {
  InfoEntry,
  KnowledgeRecord,
} from '../../../shared/knowledge-gap'
import type { CharacterActionView } from '../../../shared/character-action'
import type {
  KnowledgeCheckCitation,
  KnowledgeCheckFinding,
  KnowledgeCheckKind,
  KnowledgeCheckReport,
} from '../../../shared/knowledge-check'
import { createKnowledgeCheckFindingId } from '../../../shared/knowledge-check'
import { BaseWorkflowCommand } from './base-command'
import type { CommandExecuteParams } from './base-command'

export type KnowledgeCheckScope =
  | { kind: 'project' }
  | { kind: 'chapter'; chapterNumber: number }
  | { kind: 'character'; characterId: string }

function positionText(record: KnowledgeRecord): string {
  const story = record.storyPosition.kind === 'timeline-event'
    ? `时间线事件${record.storyPosition.eventId}`
    : record.storyPosition.kind === 'manual'
      ? `自定义顺序${record.storyPosition.sortOrder}（${record.storyPosition.label}）`
      : '位置未知'
  const narrative = record.narrativePosition.kind === 'chapter-scene'
    ? `第${record.narrativePosition.chapterNumber}章${record.narrativePosition.authorOrdinal !== undefined ? `·序${record.narrativePosition.authorOrdinal}` : ''}`
    : '叙事位置未知'
  return `故事位置：${story}；叙事位置：${narrative}`
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

async function loadCheckData(projectSession: ProjectSessionContext): Promise<{
  entries: InfoEntry[]
  records: KnowledgeRecord[]
  actions: CharacterActionView[]
}> {
  const [entries, records, actions] = await Promise.all([
    ipc.invokeWithProjectSession(projectSession, 'db:info-entry-list', undefined, projectSession.projectPath) as Promise<InfoEntry[]>,
    ipc.invokeWithProjectSession(projectSession, 'db:knowledge-record-list', undefined, projectSession.projectPath) as Promise<KnowledgeRecord[]>,
    ipc.invokeWithProjectSession(projectSession, 'db:character-action-list', undefined, projectSession.projectPath) as Promise<CharacterActionView[]>,
  ])
  return { entries, records, actions }
}

function filterDataByScope(
  scope: KnowledgeCheckScope,
  entries: InfoEntry[],
  records: KnowledgeRecord[],
  actions: CharacterActionView[],
): { entries: InfoEntry[]; records: KnowledgeRecord[]; actions: CharacterActionView[] } {
  if (scope.kind === 'project') return { entries, records, actions }
  if (scope.kind === 'chapter') {
    const chapter = scope.chapterNumber
    const scopedRecords = records.filter(record => (
      record.narrativePosition.kind === 'chapter-scene'
      && record.narrativePosition.chapterNumber === chapter
    ))
    const infoIds = new Set(scopedRecords.map(record => record.infoId))
    const scopedEntries = entries.filter(entry => (
      infoIds.has(entry.id)
      || entry.sourceRefs.some(ref => ref.kind === 'chapter' && ref.chapterNumber === chapter)
    ))
    const scopedActions = actions.filter(action => (
      action.relatedChapterNumbers.includes(chapter)
      || (action.narrativePosition.kind === 'chapter-scene' && action.narrativePosition.chapterNumber === chapter)
    ))
    return { entries: scopedEntries, records: scopedRecords, actions: scopedActions }
  }
  const scopedRecords = records.filter(record => record.characterId === scope.characterId)
  const infoIds = new Set(scopedRecords.map(record => record.infoId))
  return {
    entries: entries.filter(entry => infoIds.has(entry.id)),
    records: scopedRecords,
    actions: actions.filter(action => action.characterId === scope.characterId),
  }
}

function buildInfoGapDigest(entries: InfoEntry[], records: KnowledgeRecord[]): string {
  const entryLines = entries.map(entry => (
    `- [${entry.id}] ${entry.title}｜状态：${entry.truthStatus}｜真相：${truncate(entry.truth, 400) || '（作者尚未确定）'}`
  ))
  const recordLines = records.map(record => {
    const subject = record.subjectKind === 'character'
      ? `人物${record.characterId ?? '?'}`
      : '读者（作者预期）'
    const conceal = record.concealment
      ? `；隐瞒：向${record.concealment.fromCharacterIds.join('、') || '（未指明）'}隐瞒，公开说法「${truncate(record.concealment.publicStatement, 80)}」`
      : ''
    return `- [${record.id}] ${subject}｜条目[${record.infoId}]｜认知：${record.cognition}｜已知：${truncate(record.knownContent, 200)}｜相信：${truncate(record.believedStatement, 150)}｜与真相关系：${record.truthRelation}｜途径：${record.learningChannel}${conceal}｜${positionText(record)}｜依据：${record.basis}`
  })
  return `【信息条目（作者层真相；状态 confirmed=已确认 / undecided=作者尚未确定 / retired=已废止）】\n${entryLines.join('\n') || '（无）'}\n\n【知情记录】\n${recordLines.join('\n') || '（无）'}`
}

function buildActionLineDigest(entries: InfoEntry[], records: KnowledgeRecord[], actions: CharacterActionView[]): string {
  const entryById = new Map(entries.map(entry => [entry.id, entry]))
  const recordById = new Map(records.map(record => [record.id, record]))
  const actionLines = actions.map(action => {
    const knowledge = action.basedOnKnowledgeIds
      .map(id => {
        const record = recordById.get(id)
        if (!record) return `${id}（引用已失效）`
        return `${truncate(record.knownContent, 80)}（认知：${record.cognition}，与真相关系：${record.truthRelation}）`
      })
      .join('；') || '（未声明所据认知）'
    const event = action.eventDangling
      ? '（关联的时间线事件已删除）'
      : action.event
        ? `时间线事件「${action.event.title}」（时间：${action.event.timeLabel || '未定'}，状态：${action.event.status}）`
        : `尚未排入时间线（计划：${truncate(action.plannedNote ?? '', 120)}）`
    return `- [${action.id}] 人物${action.characterId}｜${action.title}｜目标：${truncate(action.goal, 150)}｜资源：${truncate(action.resources, 80)}｜限制：${truncate(action.constraints, 80)}｜事件：${event}｜呈现：${action.visibility === 'off-stage' ? '幕后（未向读者展示）' : '台前'}｜叙事位置：${action.narrativePosition.kind === 'chapter-scene' ? `第${action.narrativePosition.chapterNumber}章` : '未排章'}｜结果：${truncate(action.outcome ?? '', 80)}｜所据认知：${knowledge}`
  })
  const entryLines = entries.map(entry => (
    `- [${entry.id}] ${entry.title}｜状态：${entry.truthStatus}｜真相：${truncate(entry.truth, 300) || '（作者尚未确定）'}`
  ))
  void entryById
  return `【行动记录】\n${actionLines.join('\n') || '（无）'}\n\n【相关条目真相（背景约束）】\n${entryLines.join('\n') || '（无）'}`
}

interface RawFinding {
  title?: unknown
  detail?: unknown
  citations?: unknown
}

function decodeFindings(raw: unknown): KnowledgeCheckFinding[] {
  if (!Array.isArray(raw)) throw new Error('检查结果缺少 findings 数组')
  const findings: KnowledgeCheckFinding[] = []
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as RawFinding
    if (typeof candidate.title !== 'string' || !candidate.title.trim()) continue
    if (typeof candidate.detail !== 'string') continue
    const citations: KnowledgeCheckCitation[] = []
    if (Array.isArray(candidate.citations)) {
      for (const citation of candidate.citations) {
        if (!citation || typeof citation !== 'object') continue
        const entry = citation as { kind?: unknown; id?: unknown; chapterNumber?: unknown; draftId?: unknown; note?: unknown }
        const note = typeof entry.note === 'string' ? entry.note : undefined
        if (entry.kind === 'info-entry' && typeof entry.id === 'string') {
          citations.push({ kind: 'info-entry', id: entry.id, ...(note ? { note } : {}) })
        } else if (entry.kind === 'knowledge-record' && typeof entry.id === 'string') {
          citations.push({ kind: 'knowledge-record', id: entry.id, ...(note ? { note } : {}) })
        } else if (entry.kind === 'character-action' && typeof entry.id === 'string') {
          citations.push({ kind: 'character-action', id: entry.id, ...(note ? { note } : {}) })
        } else if (entry.kind === 'timeline-event' && typeof entry.id === 'string') {
          citations.push({ kind: 'timeline-event', id: entry.id, ...(note ? { note } : {}) })
        } else if (entry.kind === 'thread-plan' && typeof entry.id === 'number') {
          citations.push({ kind: 'thread-plan', id: entry.id, ...(note ? { note } : {}) })
        } else if (entry.kind === 'chapter' && typeof entry.chapterNumber === 'number') {
          citations.push({ kind: 'chapter', chapterNumber: entry.chapterNumber, ...(note ? { note } : {}) })
        } else if (entry.kind === 'draft' && typeof entry.draftId === 'number') {
          citations.push({ kind: 'draft', draftId: entry.draftId, ...(note ? { note } : {}) })
        }
      }
    }
    findings.push({
      id: createKnowledgeCheckFindingId(),
      severity: 'suggestion',
      title: candidate.title.slice(0, 200),
      detail: candidate.detail.slice(0, 4000),
      citations,
    })
  }
  return findings
}

const CHECK_SYSTEM_PROMPT = [
  '你是小说创作的信息差一致性审读助手。你只提出疑点与建议，绝不替作者断言或修改任何设定。',
  '输出严格 JSON：{"findings":[{"title":string,"detail":string,"citations":[{"kind":string,"id"?:string,"chapterNumber"?:number,"draftId"?:number,"note"?:string}]}]}。',
  '每条发现必须引用具体条目/记录/行动 ID 作为证据；没有把握的判断标注为建议；找不到问题就返回空数组。',
].join('\n')

export class InfoGapCheckCommand extends BaseWorkflowCommand<KnowledgeCheckReport> {
  constructor(
    private readonly projectSession: ProjectSessionContext,
    private readonly scope: KnowledgeCheckScope,
  ) {
    super()
  }

  async execute(params: CommandExecuteParams): Promise<KnowledgeCheckReport> {
    const { context, callbacks } = params
    callbacks.log('读取信息条目与知情记录…')
    const all = await loadCheckData(this.projectSession)
    const { entries, records } = filterDataByScope(this.scope, all.entries, all.records, all.actions)
    if (records.length === 0 && entries.length === 0) {
      throw new Error('当前范围没有任何信息条目或知情记录，无需检查')
    }
    const scopeLabel = this.scope.kind === 'chapter'
      ? `chapter:${this.scope.chapterNumber}`
      : this.scope.kind === 'character'
        ? `character:${this.scope.characterId}`
        : 'project'
    const prompt = [
      '请检查以下信息差记录，找出疑点：',
      '1. 人物是否提前知道了以叙事位置看还不该知道的信息（注意故事位置与叙事位置是两个独立维度，倒叙/插叙时叙事位置晚于故事位置是正常的）。',
      '2. 隐瞒是否前后一致（同一人物的公开说法与知情记录是否冲突）。',
      '3. 读者是否已得到理解后续情节所需的必要线索（依据读者记录的预期理解）。',
      '4. 认知状态与"人物相信的说法"和作者真相之间是否存在未标注的矛盾。',
      '只报告有具体引用依据的疑点；没有问题返回空数组。',
      '',
      buildInfoGapDigest(entries, records),
    ].join('\n')
    callbacks.setProgress(30)
    const raw = await this.executeWithGenerationRuntime('structured', params, async () => {
      return this.callLLM(
        prompt,
        CHECK_SYSTEM_PROMPT,
        callbacks,
        { responseFormat: { type: 'json_object' }, purpose: 'knowledge-info-gap-check', reasoningStage: 'review' },
        context,
      )
    })
    callbacks.setProgress(80)
    const parsed = this.parseJSON(this.stripThinkingTags(raw)) as { findings?: unknown }
    const findings = decodeFindings(parsed.findings)
    callbacks.log(`检查完成：${findings.length} 条建议`)
    const report: KnowledgeCheckReport = {
      id: '',
      kind: 'info-gap' satisfies KnowledgeCheckKind,
      scope: scopeLabel,
      findings,
      modelNote: `信息差检查：${entries.length} 条信息条目、${records.length} 条知情记录。只提出建议，不改写任何记录。`,
      createdAt: '',
    }
    const saved = await ipc.invokeWithProjectSession(
      this.projectSession,
      'db:knowledge-check-report-save',
      { kind: report.kind, scope: report.scope, findings: report.findings, modelNote: report.modelNote },
      this.projectSession.projectPath,
    ) as { success: boolean; report?: KnowledgeCheckReport; error?: string }
    if (!saved.success || !saved.report) throw new Error(saved.error || '检查报告保存失败')
    callbacks.setProgress(100)
    return saved.report
  }
}

export class ActionLineCheckCommand extends BaseWorkflowCommand<KnowledgeCheckReport> {
  constructor(
    private readonly projectSession: ProjectSessionContext,
    private readonly scope: KnowledgeCheckScope,
  ) {
    super()
  }

  async execute(params: CommandExecuteParams): Promise<KnowledgeCheckReport> {
    const { context, callbacks } = params
    callbacks.log('读取人物行动线…')
    const all = await loadCheckData(this.projectSession)
    const { entries, records, actions } = filterDataByScope(this.scope, all.entries, all.records, all.actions)
    if (actions.length === 0) {
      throw new Error('当前范围没有任何行动记录，无需检查')
    }
    const scopeLabel = this.scope.kind === 'chapter'
      ? `chapter:${this.scope.chapterNumber}`
      : this.scope.kind === 'character'
        ? `character:${this.scope.characterId}`
        : 'project'
    const prompt = [
      '请检查以下人物行动线记录，找出疑点（全部为建议，不替作者断言）：',
      '1. 行动是否符合记录所据的认知（人物不能基于尚未获知的信息做决定）。',
      '2. 行动是否与目标、资源、限制匹配；是否有更合理路径的疑问。',
      '3. 幕后行动（尚未向读者展示）是否有合理的时间与路径（事件时间未定时提示补充）。',
      '4. 关联的时间线事件引用是否悬空或与行动目的不一致。',
      '只报告有具体引用依据的疑点；没有问题返回空数组。',
      '',
      buildActionLineDigest(entries, records, actions),
    ].join('\n')
    callbacks.setProgress(30)
    const raw = await this.executeWithGenerationRuntime('structured', params, async () => {
      return this.callLLM(
        prompt,
        CHECK_SYSTEM_PROMPT,
        callbacks,
        { responseFormat: { type: 'json_object' }, purpose: 'knowledge-action-line-check', reasoningStage: 'review' },
        context,
      )
    })
    callbacks.setProgress(80)
    const parsed = this.parseJSON(this.stripThinkingTags(raw)) as { findings?: unknown }
    const findings = decodeFindings(parsed.findings)
    callbacks.log(`检查完成：${findings.length} 条建议`)
    const saved = await ipc.invokeWithProjectSession(
      this.projectSession,
      'db:knowledge-check-report-save',
      {
        kind: 'action-line' satisfies KnowledgeCheckKind,
        scope: scopeLabel,
        findings,
        modelNote: `人物行动线检查：${actions.length} 条行动记录。只提出建议，不改写任何记录。`,
      },
      this.projectSession.projectPath,
    ) as { success: boolean; report?: KnowledgeCheckReport; error?: string }
    if (!saved.success || !saved.report) throw new Error(saved.error || '检查报告保存失败')
    callbacks.setProgress(100)
    return saved.report
  }
}
