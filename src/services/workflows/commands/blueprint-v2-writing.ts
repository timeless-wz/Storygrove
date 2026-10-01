/**
 * 章节蓝图 v2 → 写作输入组装（blueprint-v2-contract §9）。
 *
 * 注入契约（冻结）：
 * - 顺序：分镜全文（按 order，含各异小标题与对白）→ rules 分区条目 →
 *   cliffhanger（视觉定格 + 章末钩子）→ 冲突条目 → 检查条目（带
 *   must/reference/forbid 标注）→ wordBudget 作为字数目标。
 * - 规则与禁忌是约束不是题材：固定脚手架（本模块常量，不得由内容动态生成）
 *   声明规则/禁忌约束事件与现象的走向，正文不得直接讲解世界观、系统、神明名号。
 * - userGuidance 永远不属于 v2，仍由调用方以最高优先级注入。
 * - 同一消费方对同一章只走一条注入路径：detail 存在 → 本模块的 v2 路径；
 *   不存在 → 原 v1 路径。本模块只负责组装，不负责双路径判定的调用侧纪律。
 *
 * 本模块为纯函数：不触 IPC、不触 DB；分镜与条目正文逐字保留（红线 3）。
 */

import {
  extractBlueprintV2WordBudget,
  findBlueprintV2CanonicalSection,
  getBlueprintV2Scenes,
  type BlueprintV2BulletItem,
  type BlueprintV2FieldItem,
  type BlueprintV2SectionItem,
  type ChapterBlueprintV2Content,
} from '../../../shared/blueprint-v2'
import type { WritingLanguage } from '../../../shared/writing-language'
import { promptLanguageText } from '../../prompt-language'

/** 契约 §9.3 的固定脚手架：常量，禁止根据细纲内容动态生成或改写。 */
export const BLUEPRINT_V2_CONSTRAINT_SCAFFOLD = Object.freeze({
  zhCN: [
    '【细纲使用规则（固定）】',
    '- 逐场分镜按给定顺序构成本章正文骨架：每一场的内容、目的与收束都必须落实；分镜标题里的编号（如「场景三」排在第二位）是原文的一部分，照原样保留，不得重排或改写编号。',
    '- 规则、禁忌与检查条目约束事件与现象的走向：它们决定「什么能发生、什么不能发生」，不是要求正文解释的题材。',
    '- 正文只呈现可感知的动作、对话与现象；不得直接讲解世界观设定、系统规则或神明名号，不得用旁白说明规则为何如此。',
    '- 标注「禁写」的条目是硬性禁止：相关内容不得出现，也不得变相解释其成因或全貌。',
    '- 标注「必达」的条目必须通过正文事件达成；标注「参考」的条目是背景信息，不要求正文字面出现。',
  ].join('\n'),
  enUS: [
    '[Detailed-outline usage rules (fixed)]',
    '- The scene storyboard, in the given order, is the backbone of this chapter: every scene\'s content, purpose, and end state must be realized. Scene numbering in titles (e.g. "Scene Three" appearing second) is part of the source text; keep it verbatim and never reorder or renumber.',
    '- Rules, taboos, and check items constrain how events and phenomena may unfold: they decide what can and cannot happen; they are not subject matter to be explained in the prose.',
    '- The prose presents only perceivable actions, dialogue, and phenomena; do not directly explain worldview settings, system rules, or deity names, and do not narrate why the rules work.',
    '- Items marked "forbid" are hard prohibitions: the related content must not appear, and its cause or full picture must not be explained indirectly.',
    '- Items marked "must" must be achieved through story events; items marked "reference" are background and need not appear verbatim.',
  ].join('\n'),
})

/** v2 组装的写作块：text 一次性注入，wordBudget 供字数目标采用。 */
export interface BlueprintV2WritingBlock {
  /** 已按契约 §9.2 顺序组装的完整注入文本（含固定脚手架），永不包含 userGuidance。 */
  text: string
  /** positioning 分区「正文字数预算」的明确值；无则 null（调用方走既有默认）。 */
  wordBudget: number | null
  /** 分镜数量（诊断日志用）。 */
  sceneCount: number
}

function checkAnnotation(
  item: BlueprintV2FieldItem | BlueprintV2BulletItem,
  writingLanguage: WritingLanguage,
): string {
  const mode = item.check?.mode ?? 'reference'
  if (mode === 'forbid') {
    return promptLanguageText(writingLanguage, '禁写', 'forbid')
  }
  if (mode === 'must') {
    return promptLanguageText(writingLanguage, '必达', 'must')
  }
  return promptLanguageText(writingLanguage, '参考', 'reference')
}

function sectionItemText(item: BlueprintV2SectionItem): string {
  return item.kind === 'scene' ? item.markdown : item.markdown
}

/** rules / conflict 分区条目正文（逐字）；分区缺失时为空。 */
function canonicalSectionBody(
  content: ChapterBlueprintV2Content,
  id: 'rules' | 'conflict' | 'cliffhanger',
): string {
  const section = findBlueprintV2CanonicalSection(content, id)
  if (!section) return ''
  return section.items.map(sectionItemText).join('\n')
}

/** foreshadow / taboos 的检查条目（带 mode 标注）；仅收录有文字的条目。 */
function checkEntries(content: ChapterBlueprintV2Content, writingLanguage: WritingLanguage): string {
  const parts: string[] = []
  for (const sectionId of ['foreshadow', 'taboos'] as const) {
    const section = findBlueprintV2CanonicalSection(content, sectionId)
    if (!section) continue
    for (const item of section.items) {
      if (item.kind !== 'field' && item.kind !== 'bullet') continue
      const body = item.markdown.trim()
      if (!body) continue
      parts.push(`- [${checkAnnotation(item, writingLanguage)}] ${body}`)
    }
  }
  return parts.join('\n')
}

/**
 * 组装 v2 写作块（契约 §9.2）。content 无分镜且无任何 canonical 内容时返回
 * null（调用方回落 v1 路径——例如"升级为 v2"的空脚手架不应产生空细纲块）。
 */
export function assembleBlueprintV2WritingBlock(
  content: ChapterBlueprintV2Content,
  writingLanguage: WritingLanguage,
): BlueprintV2WritingBlock | null {
  const scenes = getBlueprintV2Scenes(content)
  const rules = canonicalSectionBody(content, 'rules')
  const cliffhanger = canonicalSectionBody(content, 'cliffhanger')
  const conflict = canonicalSectionBody(content, 'conflict')
  const checks = checkEntries(content, writingLanguage)
  if (scenes.length === 0 && !rules && !cliffhanger && !conflict && !checks) return null

  const chapterHeader = content.chapterTitle
    ? promptLanguageText(writingLanguage, content.chapterTitle, content.chapterTitle)
    : promptLanguageText(writingLanguage, `第${content.chapterNumber}章`, `Chapter ${content.chapterNumber}`)

  const parts: string[] = [
    promptLanguageText(
      writingLanguage,
      `【本章细纲（蓝图 v2 任务书）｜${chapterHeader}】`,
      `[Chapter detailed outline (blueprint v2 task sheet) | ${chapterHeader}]`,
    ),
    BLUEPRINT_V2_CONSTRAINT_SCAFFOLD[writingLanguage === 'en-US' ? 'enUS' : 'zhCN'],
  ]

  if (scenes.length > 0) {
    parts.push(promptLanguageText(writingLanguage, '【逐场分镜（按序落实）】', '[Scene storyboard (realize in order)]'))
    scenes.forEach((scene) => {
      // Do not trim scene Markdown: indentation, leading/trailing blank lines,
      // nested headings, and list structure are part of the imported outline.
      parts.push(`#### ${scene.title}\n${scene.markdown}`)
    })
  }
  if (rules) {
    parts.push(promptLanguageText(
      writingLanguage,
      '【规则与环境细节（约束，不是题材）】',
      '[Rules and environmental details (constraints, not subject matter)]',
    ), rules)
  }
  if (cliffhanger) {
    parts.push(promptLanguageText(
      writingLanguage,
      '【章末目标与断章定格】',
      '[Chapter-end goal and closing freeze-frame]',
    ), cliffhanger)
  }
  if (conflict) {
    parts.push(promptLanguageText(
      writingLanguage,
      '【核心矛盾与博弈结构】',
      '[Core conflict and game structure]',
    ), conflict)
  }
  if (checks) {
    parts.push(promptLanguageText(
      writingLanguage,
      '【检查条目（必达/参考/禁写）】',
      '[Check items (must / reference / forbid)]',
    ), checks)
  }
  const wordBudget = extractBlueprintV2WordBudget(content)
  if (wordBudget !== null) {
    parts.push(promptLanguageText(
      writingLanguage,
      `正文字数预算：${wordBudget} 字（蓝图明确值，优先生效）。`,
      `Prose word budget: ${wordBudget} words (explicit blueprint value, takes priority).`,
    ))
  }
  return { text: parts.join('\n\n'), wordBudget, sceneCount: scenes.length }
}

/**
 * v2 读取状态的写作侧处置（契约 §5.1/§7.1）：
 * - 正常 → 可用；
 * - corrupt / needs-newer-app → 不可注入（结构不可信），调用方回落 v1 路径并
 *   必须记录日志（绝不静默丢弃——DB 的 raw_markdown 仍完整保留）。
 */
export function isWritableBlueprintV2Detail(
  detail: ChapterBlueprintV2Content | null,
): detail is ChapterBlueprintV2Content {
  if (!detail) return false
  const readStatus = (detail as { readStatus?: string }).readStatus
  return readStatus !== 'corrupt' && readStatus !== 'needs-newer-app'
}
