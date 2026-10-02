import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import { ipc } from '../../ipc-client'
import { buildAgentTool, type AgentExecutionContext } from '../tool-registry'
import { agentToolText, assertAgentProjectCurrent, assertAgentToolActive, requireAgentProject } from './project-context'
import type { ProposalFieldDiff } from './propose-novel-config.tool'
import { applyBlueprintV2Reimport, parseChapterBlueprintMarkdown } from '../../../shared/blueprint-v2-markdown'
import type {
  BlueprintV2Section,
  BlueprintV2SectionItem,
  ChapterBlueprintV2Content,
  ChapterBlueprintV2DetailRead,
} from '../../../shared/blueprint-v2'

const STRING_FIELDS = new Set<keyof BlueprintData>([
  'title', 'role', 'purpose', 'keyEvents', 'suspenseHook', 'userGuidance', 'notes',
])
const FIELD_ALIASES: Record<string, keyof BlueprintData> = {
  '作者微操指导': 'userGuidance',
  '用户指引': 'userGuidance',
}

export type ChapterBlueprintProposal =
  | {
      valid: true
      chapterNumber: number
      changes: Partial<BlueprintData>
      diffs: ProposalFieldDiff[]
      v2Content?: ChapterBlueprintV2Content
      v2Diffs?: ProposalFieldDiff[]
      suggestedChapterNumber?: number | null
    }
  | { valid: false; error: string }

type ProposalBlueprintCurrent = Pick<BlueprintData, 'chapterNumber'>
  & Partial<Record<keyof BlueprintData, unknown>>

function validateBlueprintChanges(args: Record<string, unknown>, context?: AgentExecutionContext):
  | { valid: true; changes: Partial<BlueprintData>; v2Content?: ChapterBlueprintV2Content; suggestedChapterNumber?: number | null }
  | { valid: false; error: string } {
  if (args.v2_markdown !== undefined) {
    if (args.changes !== undefined) {
      return { valid: false, error: agentToolText(context, 'v2_markdown 与旧版 changes 请分开提案，避免跨存储部分写入', 'Submit v2_markdown and legacy changes as separate proposals to avoid partial writes across storage.') }
    }
    if (typeof args.v2_markdown !== 'string' || !args.v2_markdown.trim()) {
      return { valid: false, error: agentToolText(context, 'v2_markdown 必须是完整 Markdown 细纲', 'v2_markdown must contain the full Markdown outline.') }
    }
    try {
      const parsed = parseChapterBlueprintMarkdown(args.v2_markdown)
      return { valid: true, changes: {}, v2Content: parsed.content, suggestedChapterNumber: parsed.suggestedChapterNumber }
    } catch (error) {
      return { valid: false, error: agentToolText(context,
        `细纲 Markdown 无法解析：${error instanceof Error ? error.message : String(error)}`,
        `Could not parse v2 outline Markdown: ${error instanceof Error ? error.message : String(error)}`,
      ) }
    }
  }
  const candidate = args.changes
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || Object.keys(candidate).length === 0) {
    return { valid: false, error: agentToolText(context, '缺少章节蓝图变更字段', 'No chapter blueprint changes were provided') }
  }
  const changes: Record<string, unknown> = {}
  for (const [field, proposed] of Object.entries(candidate as Record<string, unknown>)) {
    const canonicalField = FIELD_ALIASES[field] ?? field
    if (STRING_FIELDS.has(canonicalField as keyof BlueprintData)) {
      if (typeof proposed !== 'string') return { valid: false, error: agentToolText(context, `字段 ${field} 必须是文本`, `Field ${field} must be text`) }
    } else if (canonicalField === 'characters') {
      if (!Array.isArray(proposed) || !proposed.every(item => typeof item === 'string')) {
        return { valid: false, error: agentToolText(context, '字段 characters 必须是文本数组', 'Field characters must be an array of text values') }
      }
    } else {
      return { valid: false, error: agentToolText(context, `未知章节蓝图字段：${field}`, `Unknown chapter blueprint field: ${field}`) }
    }
    changes[canonicalField] = proposed
  }
  return { valid: true, changes: changes as Partial<BlueprintData> }
}

function sectionMarkdown(section: BlueprintV2Section): string {
  if (section.kind === 'custom') return `${'#'.repeat(section.level)} ${section.title}\n${section.body}`
  const items = section.items.map(item => item.kind === 'scene'
    ? `${'#'.repeat(item.level)} ${item.title}\n${item.markdown}`
    : item.markdown).join('')
  return `${'#'.repeat(section.level ?? 4)} ${section.title}\n${section.preamble}${items}${section.postamble}`
}

function itemDiffLabel(item: BlueprintV2SectionItem, index: number): string {
  if (item.kind === 'scene') return `分镜：${item.title}`
  if (item.kind === 'field') return `字段：${item.label}`
  if (item.kind === 'bullet' && item.label) return `条目：${item.label}`
  return `${item.kind === 'block' ? '散块' : '条目'} ${index + 1}`
}

function itemDiffKey(item: BlueprintV2SectionItem, index: number, occurrence: number): string {
  if (item.kind === 'scene') return `scene:${item.title}#${occurrence}`
  if (item.kind === 'field') return `field:${item.label}#${occurrence}`
  if (item.kind === 'bullet' && item.label) return `bullet:${item.label}#${occurrence}`
  return `${item.kind}:${index}`
}

function itemMarkdown(item: BlueprintV2SectionItem): string {
  return item.kind === 'scene'
    ? `${'#'.repeat(item.level)} ${item.title}\n${item.markdown}`
    : item.markdown
}

function itemDiffs(
  sectionId: string,
  sectionTitle: string,
  currentItems: BlueprintV2SectionItem[],
  proposedItems: BlueprintV2SectionItem[],
): ProposalFieldDiff[] {
  const indexItems = (items: BlueprintV2SectionItem[]) => {
    const occurrenceByBase = new Map<string, number>()
    return items.map((item, index) => {
      const base = item.kind === 'scene' ? `scene:${item.title}`
        : item.kind === 'field' ? `field:${item.label}`
          : item.kind === 'bullet' && item.label ? `bullet:${item.label}`
            : `${item.kind}:${index}`
      const occurrence = (occurrenceByBase.get(base) ?? 0) + 1
      occurrenceByBase.set(base, occurrence)
      return {
        key: itemDiffKey(item, index, occurrence),
        label: itemDiffLabel(item, index),
        markdown: itemMarkdown(item),
      }
    })
  }
  const current = new Map(indexItems(currentItems).map(item => [item.key, item]))
  const proposed = new Map(indexItems(proposedItems).map(item => [item.key, item]))
  const keys = [
    ...current.keys(),
    ...[...proposed.keys()].filter(key => !current.has(key)),
  ]
  return keys.flatMap(key => {
    const before = current.get(key)
    const after = proposed.get(key)
    const currentText = before?.markdown ?? ''
    const proposedText = after?.markdown ?? ''
    if (currentText === proposedText) return []
    return [{
      field: `v2:${sectionId}:${after?.label ?? before?.label ?? sectionTitle}`,
      current: currentText,
      proposed: proposedText,
    }]
  })
}

function v2FieldDiffs(
  current: ChapterBlueprintV2DetailRead | null,
  proposed: ChapterBlueprintV2Content,
): ProposalFieldDiff[] {
  const metaDiffs: ProposalFieldDiff[] = []
  const currentTitle = current?.chapterTitle ?? ''
  if (currentTitle !== proposed.chapterTitle) {
    metaDiffs.push({ field: 'v2:chapterTitle:章题', current: currentTitle, proposed: proposed.chapterTitle })
  }
  const currentPreamble = current?.docPreamble ?? ''
  if (currentPreamble !== proposed.docPreamble) {
    metaDiffs.push({ field: 'v2:docPreamble:文档前导内容', current: currentPreamble, proposed: proposed.docPreamble })
  }
  const key = (section: BlueprintV2Section) => section.id
  const currentByKey = new Map((current?.sections ?? []).map(section => [key(section), section]))
  const proposedByKey = new Map(proposed.sections.map(section => [key(section), section]))
  const orderedKeys = [
    ...(current?.sections ?? []).map(key),
    ...proposed.sections.map(key).filter(sectionKey => !currentByKey.has(sectionKey)),
  ]
  const sectionDiffs = orderedKeys.flatMap(sectionKey => {
    const before = currentByKey.get(sectionKey)
    const after = proposedByKey.get(sectionKey)
    const sectionTitle = after?.title ?? before?.title ?? sectionKey
    if (!before || !after || before.kind !== 'canonical' || after.kind !== 'canonical') {
      const currentText = before ? sectionMarkdown(before) : ''
      const proposedText = after ? sectionMarkdown(after) : ''
      return currentText === proposedText
        ? []
        : [{ field: `v2:${sectionKey}:${sectionTitle}`, current: currentText, proposed: proposedText }]
    }
    const diffs: ProposalFieldDiff[] = []
    if (before.title !== after.title) {
      diffs.push({ field: `v2:${sectionKey}:分区标题`, current: before.title, proposed: after.title })
    }
    if (before.preamble !== after.preamble) {
      diffs.push({ field: `v2:${sectionKey}:前导内容`, current: before.preamble, proposed: after.preamble })
    }
    diffs.push(...itemDiffs(sectionKey, sectionTitle, before.items, after.items))
    if (before.postamble !== after.postamble) {
      diffs.push({ field: `v2:${sectionKey}:尾随内容`, current: before.postamble, proposed: after.postamble })
    }
    return diffs
  })
  const currentOrder = (current?.sections ?? []).map(section => section.id)
  const proposedOrder = proposed.sections.map(section => section.id)
  if (JSON.stringify(currentOrder) !== JSON.stringify(proposedOrder)) {
    metaDiffs.push({
      field: 'v2:section-order:分区顺序',
      current: (current?.sections ?? []).map(section => section.title).join('\n'),
      proposed: proposed.sections.map(section => section.title).join('\n'),
    })
  }
  return [...metaDiffs, ...sectionDiffs]
}

export function buildChapterBlueprintProposal(
  args: Record<string, unknown>,
  current: ProposalBlueprintCurrent,
  context?: AgentExecutionContext,
  currentDetail: ChapterBlueprintV2DetailRead | null = null,
): ChapterBlueprintProposal {
  const chapterNumber = args.chapter_number
  if (!Number.isInteger(chapterNumber) || (chapterNumber as number) <= 0 || chapterNumber !== current.chapterNumber) {
    return { valid: false, error: agentToolText(context, '目标章节与当前蓝图不一致', 'The target chapter does not match the current blueprint') }
  }
  const validated = validateBlueprintChanges(args, context)
  if (!validated.valid) return validated
  if (validated.v2Content && currentDetail?.readStatus) {
    return { valid: false, error: agentToolText(context, '现有 v2 细纲不可安全读取，请先在应用中核对后再提案', 'The existing v2 outline cannot be read safely. Inspect it in the app before proposing a replacement.') }
  }
  const v2Content = validated.v2Content
    ? { ...validated.v2Content, chapterNumber: chapterNumber as number }
    : undefined
  const changes = validated.changes
  return {
    valid: true,
    chapterNumber: chapterNumber as number,
    changes,
    diffs: Object.entries(changes).map(([field, proposed]) => ({
      field,
      current: current[field as keyof BlueprintData],
      proposed,
    })),
    ...(v2Content ? {
      v2Content,
      v2Diffs: v2FieldDiffs(currentDetail, v2Content),
      suggestedChapterNumber: validated.suggestedChapterNumber,
    } : {}),
  }
}

export const proposeChapterBlueprintTool = buildAgentTool({
  name: 'propose_chapter_blueprint',
  description: '提案修改旧版蓝图字段，或通过 v2_markdown 提交整章 v2 Markdown 细纲。界面逐分区展示当前与建议内容，必须由用户批准后写入；v2 解析保留未知标题、分镜正文、规则与禁忌。',
  descriptionEn: 'Propose legacy blueprint field changes, or submit a full v2 Markdown outline through v2_markdown. The app shows current and proposed content by section and writes only after user approval; v2 parsing preserves unknown headings, scene bodies, rules, and taboos.',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: { type: 'number', description: '目标章节号', descriptionEn: 'Target chapter number' },
      changes: {
        type: 'object',
        description: '章节蓝图建议值。字段使用 title、role、purpose、keyEvents、characters、suspenseHook、userGuidance、notes；“作者微操指导”或“用户指引”也会规范化为 userGuidance。',
        descriptionEn: 'Proposed blueprint values. Use title, role, purpose, keyEvents, characters, suspenseHook, userGuidance, and notes.',
      },
      v2_markdown: {
        type: 'string',
        description: '完整章节蓝图 v2 Markdown 原文。与 changes 分开使用；所有分区、未知标题与场景正文都会进入字段级确认差异。',
        descriptionEn: 'Full chapter blueprint v2 Markdown. Use separately from changes; sections, unknown headings, and scene bodies appear in the field-level confirmation diff.',
      },
    },
    required: ['chapter_number'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args, context) => {
    const text = (zhCN: string, enUS: string) => agentToolText(context, zhCN, enUS)
    const chapterNumber = args.chapter_number
    if (!Number.isInteger(chapterNumber) || (chapterNumber as number) <= 0) {
      return { success: false, content: '', error: text('章节号无效', 'The chapter number is invalid') }
    }
    const validated = validateBlueprintChanges(args, context)
    if (!validated.valid) return { success: false, content: '', error: validated.error }
    const { project, projectSession } = requireAgentProject(context)
    const [current, currentDetail] = await Promise.all([
      ipc.invokeWithProjectSession(projectSession, 'db:blueprint-get', chapterNumber as number, project.path),
      validated.v2Content
        ? ipc.invokeWithProjectSession(
          projectSession, 'db:blueprint-v2-get', chapterNumber as number, project.path,
        ) as Promise<ChapterBlueprintV2DetailRead | null>
        : Promise.resolve(null),
    ])
    assertAgentProjectCurrent(context)
    if (!current && !currentDetail) return { success: false, content: '', error: text(`第 ${chapterNumber} 章蓝图不存在`, `The blueprint for Chapter ${chapterNumber} does not exist`) }
    if (!current && !validated.v2Content) {
      return { success: false, content: '', error: text('旧版字段提案需要已有简纲记录', 'Legacy-field proposals require an existing simple-outline record') }
    }
    const proposal = buildChapterBlueprintProposal(args, current ?? { chapterNumber: chapterNumber as number }, context, currentDetail)
    if (!proposal.valid) return { success: false, content: '', error: proposal.error }
    assertAgentToolActive(context)
    context?.markSideEffectStarted?.()
    if (proposal.v2Content) {
      const merged = currentDetail
        ? applyBlueprintV2Reimport(currentDetail, proposal.v2Content, chapterNumber as number)
        : proposal.v2Content
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-save', {
        chapterNumber: chapterNumber as number,
        baseRevision: currentDetail?.revision ?? 0,
        content: merged,
      }, project.path)
      if (!result.success) {
        return {
          success: false,
          content: '',
          error: result.conflict
            ? text('该章细纲已被并发修改，请重新发起提案并确认最新差异。', 'The outline changed concurrently. Re-submit the proposal and review the latest diff.')
            : result.error ?? text('章节细纲写入失败', 'Could not update the chapter outline'),
        }
      }
      return {
        success: true,
        content: text(
          `第 ${chapterNumber} 章细纲已更新（${proposal.v2Diffs?.length ?? 0} 个分区差异，r${result.revision}）；匹配分镜保留原 ID。`,
          `Chapter ${chapterNumber} outline updated (${proposal.v2Diffs?.length ?? 0} section diff(s), r${result.revision}); matching scene IDs were preserved.`,
        ),
      }
    }
    if (!current) {
      return { success: false, content: '', error: text('旧版字段提案需要已有简纲记录', 'Legacy-field proposals require an existing simple-outline record') }
    }
    const result = await ipc.invokeWithProjectSession(
      projectSession, 'db:blueprint-upsert', { ...current, ...proposal.changes }, project.path,
    )
    if (!result.success) {
      const detail = result.error
      return {
        success: false,
        content: '',
        error: context?.writingLanguage === 'en-US' && /[\u3400-\u9fff]/u.test(detail ?? '')
          ? text('章节蓝图写入失败', 'Could not update the chapter blueprint')
          : detail ?? text('章节蓝图写入失败', 'Could not update the chapter blueprint'),
      }
    }
    return { success: true, content: text(`第 ${chapterNumber} 章蓝图已更新（${proposal.diffs.length} 个字段）`, `Chapter ${chapterNumber} blueprint updated (${proposal.diffs.length} fields)`) }
  },
})
