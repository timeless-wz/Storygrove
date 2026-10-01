import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import {
  getBlueprintV2Scenes,
  type ChapterBlueprintV2Content,
  type ChapterBlueprintV2DetailRead,
} from '../../../shared/blueprint-v2'
import {
  applyBlueprintV2Reimport,
  assertNoLossOnSerialize,
  matchScenesForReimport,
  parseChapterBlueprintMarkdown,
  serializeChapterBlueprintV2,
} from '../../../shared/blueprint-v2-markdown'
import { ipc } from '../../ipc-client'
import { buildAgentTool, type AgentExecutionContext } from '../tool-registry'
import { agentToolText, assertAgentProjectCurrent, assertAgentToolActive, requireAgentProject } from './project-context'
import type { ProposalFieldDiff } from './propose-novel-config.tool'

const STRING_FIELDS = new Set<keyof BlueprintData>([
  'title', 'role', 'purpose', 'keyEvents', 'suspenseHook', 'userGuidance',
])
const FIELD_ALIASES: Record<string, keyof BlueprintData> = {
  '作者微操指导': 'userGuidance',
  '用户指引': 'userGuidance',
}

export type ChapterBlueprintProposal =
  | { valid: true; kind: 'v1'; chapterNumber: number; changes: Partial<BlueprintData>; diffs: ProposalFieldDiff[] }
  | { valid: true; kind: 'v2'; chapterNumber: number; baseRevision: number; content: ChapterBlueprintV2Content; diffs: ProposalFieldDiff[]; warnings: string[] }
  | { valid: false; error: string }

function validateBlueprintChanges(args: Record<string, unknown>, context?: AgentExecutionContext):
  | { valid: true; changes: Partial<BlueprintData> }
  | { valid: false; error: string } {
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

export function buildChapterBlueprintProposal(
  args: Record<string, unknown>,
  current: BlueprintData,
  context?: AgentExecutionContext,
): ChapterBlueprintProposal {
  const chapterNumber = args.chapter_number
  if (!Number.isInteger(chapterNumber) || (chapterNumber as number) <= 0 || chapterNumber !== current.chapterNumber) {
    return { valid: false, error: agentToolText(context, '目标章节与当前蓝图不一致', 'The target chapter does not match the current blueprint') }
  }
  const validated = validateBlueprintChanges(args, context)
  if (!validated.valid) return validated
  const changes = validated.changes
  return {
    valid: true,
    kind: 'v1',
    chapterNumber: chapterNumber as number,
    changes,
    diffs: Object.entries(changes).map(([field, proposed]) => ({
      field,
      current: current[field as keyof BlueprintData],
      proposed,
    })),
  }
}

function outlineSectionText(content: ChapterBlueprintV2Content, sectionIndex: number): string {
  const section = content.sections[sectionIndex]
  if (!section) return ''
  return serializeChapterBlueprintV2({
    schemaVersion: 2,
    chapterNumber: content.chapterNumber,
    chapterTitle: '',
    docPreamble: '',
    sections: [section],
    origin: content.origin,
  })
}

function storyboardOtherItemsText(section: ChapterBlueprintV2Content['sections'][number] | undefined): string {
  if (!section || section.kind !== 'canonical' || section.id !== 'storyboard') return ''
  const nonSceneSection = { ...section, items: section.items.filter(item => item.kind !== 'scene') }
  return serializeChapterBlueprintV2({
    schemaVersion: 2,
    chapterNumber: 1,
    chapterTitle: '',
    docPreamble: '',
    sections: [nonSceneSection],
    origin: 'manual',
  })
}

function sceneProposalText(scene: { title: string; markdown: string }): string {
  return `${scene.title}\n${scene.markdown}`
}

function blueprintV2Diffs(
  current: ChapterBlueprintV2Content | null,
  proposed: ChapterBlueprintV2Content,
): ProposalFieldDiff[] {
  const diffs: ProposalFieldDiff[] = []
  if ((current?.chapterTitle ?? '') !== proposed.chapterTitle) diffs.push({
    field: '章题', current: current?.chapterTitle || '—', proposed: proposed.chapterTitle || '—',
  })
  if ((current?.docPreamble ?? '') !== proposed.docPreamble) diffs.push({
    field: '章题前内容', current: current?.docPreamble || '—', proposed: proposed.docPreamble || '—',
  })
  const currentSections = current?.sections ?? []
  const nextSections = proposed.sections
  const sectionKey = (section: ChapterBlueprintV2Content['sections'][number]) => (
    section.kind === 'canonical' ? `canonical:${section.id}` : `custom:${section.id}`
  )
  const currentByKey = new Map(currentSections.map(section => [sectionKey(section), section]))
  const proposedByKey = new Map(nextSections.map(section => [sectionKey(section), section]))
  const allKeys = [...new Set([...currentByKey.keys(), ...proposedByKey.keys()])]

  for (const key of allKeys) {
    const oldSection = currentByKey.get(key)
    const nextSection = proposedByKey.get(key)
    const label = nextSection?.title ?? oldSection?.title ?? key
    if (key === 'canonical:storyboard') {
      const oldOther = storyboardOtherItemsText(oldSection)
      const nextOther = storyboardOtherItemsText(nextSection)
      if (oldOther !== nextOther) diffs.push({
        field: `${label} / 其他分镜区内容`, current: oldOther || '—', proposed: nextOther || '—',
      })
      const oldScenes = current ? getBlueprintV2Scenes(current) : []
      const newScenes = getBlueprintV2Scenes(proposed)
      const sceneMatch = current ? matchScenesForReimport(current, proposed) : null
      const currentById = new Map(oldScenes.map(scene => [scene.sceneId, scene]))
      const incomingById = new Map((sceneMatch?.incoming ?? []).map(scene => [scene.sceneId, scene]))
      for (const nextScene of newScenes) {
        const matchedId = incomingById.get(nextScene.sceneId)?.matchedSceneId
        const oldScene = matchedId ? currentById.get(matchedId) : undefined
        const previous = oldScene ? sceneProposalText(oldScene) : '—'
        const next = sceneProposalText(nextScene)
        if (previous !== next) diffs.push({
          field: `${label} / ${nextScene.title}`,
          current: previous,
          proposed: next,
        })
      }
      for (const removed of sceneMatch?.removed ?? []) diffs.push({
        field: `${label} / 移除分镜 ${removed.title}`,
        current: `${removed.title}\n${removed.markdown}`,
        proposed: '—',
      })
      continue
    }
    const currentText = oldSection ? outlineSectionText({ ...current!, sections: [oldSection] }, 0) : '—'
    const proposedText = nextSection ? outlineSectionText({ ...proposed, sections: [nextSection] }, 0) : '—'
    if (currentText !== proposedText) diffs.push({ field: label, current: currentText, proposed: proposedText })
  }
  return diffs
}

export function buildChapterBlueprintV2Proposal(
  args: Record<string, unknown>,
  chapterNumber: number,
  current: ChapterBlueprintV2DetailRead | null,
): ChapterBlueprintProposal {
  if (current?.readStatus) {
    return { valid: false, error: `当前 v2 细纲状态为 ${current.readStatus}，为避免覆盖原文，不能接受提案` }
  }
  if (typeof args.markdown !== 'string' || !args.markdown.trim()) {
    return { valid: false, error: 'v2 蓝图提案必须提供完整 Markdown 文档' }
  }
  try {
    const parsed = parseChapterBlueprintMarkdown(args.markdown)
    const incoming = { ...parsed.content, chapterNumber }
    const content = current
      ? applyBlueprintV2Reimport(current, incoming, chapterNumber)
      : incoming
    assertNoLossOnSerialize(content)
    const diffs = blueprintV2Diffs(current, content)
    const warnings = parsed.suggestedChapterNumber && parsed.suggestedChapterNumber !== chapterNumber
      ? [`Markdown 标题建议章号为第 ${parsed.suggestedChapterNumber} 章，提案目标是第 ${chapterNumber} 章。`]
      : []
    return {
      valid: true,
      kind: 'v2',
      chapterNumber,
      baseRevision: current?.revision ?? 0,
      content,
      diffs,
      warnings,
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Markdown 细纲无效' }
  }
}

export const proposeChapterBlueprintTool = buildAgentTool({
  name: 'propose_chapter_blueprint',
  description: '提出一个现有章节蓝图的字段变更。应用会读取目标蓝图并展示当前值与建议值，必须由用户批准后才写入。',
  descriptionEn: 'Propose a complete Markdown v2 outline or legacy v1 field changes. The app shows a field-level diff and writes only after user approval.',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: { type: 'number', description: '目标章节号', descriptionEn: 'Target chapter number' },
      markdown: {
        type: 'string',
        description: 'v2 细纲的完整 Markdown 文档。已有 v2 细纲时必须提供此字段；未知分区、逐场分镜、规则和禁忌会作为完整文档保存。',
        descriptionEn: 'The complete Markdown document for a v2 outline. Required when the chapter already has a v2 outline; custom sections, scenes, rules, and taboos are retained.',
      },
      changes: {
        type: 'object',
        description: '仅 v1 简纲使用：title、role、purpose、keyEvents、characters、suspenseHook、userGuidance。notes 是定稿记录，不可提案修改。v2 蓝图请改用完整 markdown 字段。',
        descriptionEn: 'For v1 legacy outlines only: title, role, purpose, keyEvents, characters, suspenseHook, userGuidance. Notes are finalized records and cannot be changed here. Use markdown for v2 outlines.',
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
    if (typeof args.markdown !== 'string' && (!args.changes || typeof args.changes !== 'object')) {
      return { success: false, content: '', error: text('请提供完整 markdown 细纲或 v1 简纲变更字段', 'Provide complete outline Markdown or legacy v1 fields') }
    }
    if (typeof args.markdown === 'string' && args.changes !== undefined) {
      return { success: false, content: '', error: text('markdown 与旧字段 changes 不能同时提交', 'Do not submit Markdown and legacy changes together') }
    }
    const validatedLegacy = typeof args.markdown === 'string'
      ? null
      : validateBlueprintChanges(args, context)
    if (validatedLegacy && !validatedLegacy.valid) {
      return { success: false, content: '', error: validatedLegacy.error }
    }
    const { project, projectSession } = requireAgentProject(context)
    const current = await ipc.invokeWithProjectSession(
      projectSession, 'db:blueprint-get', chapterNumber as number, project.path,
    )
    assertAgentProjectCurrent(context)
    if (!current) return { success: false, content: '', error: text(`第 ${chapterNumber} 章蓝图不存在`, `The blueprint for Chapter ${chapterNumber} does not exist`) }
    const currentDetail = await ipc.invokeWithProjectSession(
      projectSession, 'db:blueprint-v2-get', chapterNumber as number, project.path,
    )
    assertAgentProjectCurrent(context)
    if (typeof args.markdown === 'string') {
      const proposal = buildChapterBlueprintV2Proposal(args, chapterNumber as number, currentDetail)
      if (!proposal.valid) return { success: false, content: '', error: proposal.error }
      if (proposal.kind !== 'v2') return { success: false, content: '', error: text('v2 细纲提案无效', 'The v2 outline proposal is invalid') }
      assertAgentToolActive(context)
      context?.markSideEffectStarted?.()
      const result = await ipc.invokeWithProjectSession(projectSession, 'db:blueprint-v2-save', {
        chapterNumber: proposal.chapterNumber,
        baseRevision: proposal.baseRevision,
        content: proposal.content,
      }, project.path)
      if (!result.success) return { success: false, content: '', error: result.error ?? text('章节细纲写入失败', 'Could not update the chapter outline') }
      return { success: true, content: text(`第 ${chapterNumber} 章细纲已更新（${proposal.diffs.length} 项差异）`, `Chapter ${chapterNumber} outline updated (${proposal.diffs.length} differences)`) }
    }
    if (currentDetail) {
      return { success: false, content: '', error: text('该章已有 v2 完整细纲。旧字段提案不会修改 v2 内容，请基于当前细纲提交完整 markdown 提案。', 'This chapter has a v2 outline. Legacy field proposals cannot update it; submit a complete Markdown proposal based on the current outline.') }
    }
    if (!validatedLegacy?.valid) return { success: false, content: '', error: text('章节蓝图提案无效', 'The chapter blueprint proposal is invalid') }
    const proposal = buildChapterBlueprintProposal(args, current, context)
    if (!proposal.valid || proposal.kind !== 'v1') return { success: false, content: '', error: proposal.valid ? text('v1 简纲提案无效', 'The legacy outline proposal is invalid') : proposal.error }
    assertAgentToolActive(context)
    context?.markSideEffectStarted?.()
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
