/**
 * 蓝图 v2 检查条目层（blueprint-v2-contract §10；任务 E 旁路模块）。
 *
 * 三种模式（冻结）：
 * - must（必达）：作者明确标为必须达成；未达成 → warning 级证据。
 * - reference（参考）：背景信息，只作上下文，永不产生发现。
 * - forbid（禁写）：禁止出现的内容；正文命中 → warning 级证据。
 *
 * 保守判负规则（冻结）：
 * - 只有 source='explicit' 或字面含必达词的 must 条目可判"未达成"；
 * - reference 条目、rules 分区的环境细节、以及任何未标必达的内容，
 *   不得仅凭正文字面缺失判失败；
 * - forbid 命中检测是确定性的：仅当条目内含引号词（「」『』“”‘’"''）
 *   且该词原样出现在正文中才产生发现；无引号词的禁写条目不产生发现
 *   （例如"严禁解释原身死因全貌"绝不因正文缺少解释而被判失败，也绝不
 *   被解读为要求正文解释该情节）。
 *
 * 发现是证据，绝不是写作禁令；输出沿用 ConsistencyFinding，绝不阻断写作/定稿。
 * 与 v1 预检的关系：findBlueprintContinuityRisks 行为不变，本层是附加发现源。
 */

import {
  findBlueprintV2CanonicalSection,
  type BlueprintV2BulletItem,
  type BlueprintV2FieldItem,
  type BlueprintV2SectionId,
  type ChapterBlueprintV2Content,
} from './blueprint-v2'
import type { ConsistencyExemption, ConsistencyFinding } from './consistency-preflight'

export interface BlueprintV2CheckItem {
  sectionId: Extract<BlueprintV2SectionId, 'foreshadow' | 'taboos'>
  item: BlueprintV2FieldItem | BlueprintV2BulletItem
  mode: 'must' | 'reference' | 'forbid'
}

/** 收集 foreshadow / taboos 分区的检查条目；无 check 元数据的条目按 reference 处理。 */
export function blueprintV2CheckItems(content: ChapterBlueprintV2Content): BlueprintV2CheckItem[] {
  const items: BlueprintV2CheckItem[] = []
  for (const sectionId of ['foreshadow', 'taboos'] as const) {
    const section = findBlueprintV2CanonicalSection(content, sectionId)
    if (!section) continue
    for (const item of section.items) {
      if (item.kind !== 'field' && item.kind !== 'bullet') continue
      if (!item.markdown.trim()) continue
      items.push({
        sectionId,
        item,
        mode: item.check?.mode ?? 'reference',
      })
    }
  }
  return items
}

const MUST_LITERAL_PATTERN = /必达|必须|务必|一定要/u

/** 提取条目内的引号词（≥2 个字符），用于 forbid 命中与 must 证据缺失的确定性检测。 */
export function quotedTermsOfCheckItem(markdown: string): string[] {
  const terms: string[] = []
  const patterns = [
    /「([^「」]{2,})」/gu,
    /『([^『』]{2,})』/gu,
    /[“]([^“”]{2,})[”]/gu,
    /["]([^"]{2,})["]/gu,
    /[‘]([^‘’]{2,})[’]/gu,
    /[']([^']{2,})['']/gu,
  ]
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const term = match[1]?.trim()
      if (term) terms.push(term)
    }
  }
  return [...new Set(terms)]
}

function finding(
  item: BlueprintV2CheckItem,
  chapterNumber: number,
  issue: ConsistencyFinding['issue'],
  evidence: string,
): ConsistencyFinding {
  return {
    stableFactKey: `bpcheck:${item.item.id}`,
    severity: 'warning',
    sourceChapter: chapterNumber,
    evidence,
    issue,
    suggestion: {
      zhCN: item.mode === 'forbid'
        ? '对照细纲禁写条目与正文，确认是否需要调整正文表述。'
        : '对照细纲必达条目与正文，确认是否需要补足相应事件。',
      enUS: item.mode === 'forbid'
        ? 'Compare the outline forbid item with the prose and adjust the wording if needed.'
        : 'Compare the outline must item with the prose and add the missing event if needed.',
    },
  }
}

/**
 * v2 检查条目层的确定性预检（§10.1）。draft 为空时返回空数组。
 * 参考条目、rules 分区细节、以及无引号词的禁写条目永不产生发现。
 */
export function findBlueprintV2CheckFindings(
  content: ChapterBlueprintV2Content,
  draft: string,
  chapterNumber: number,
  exemptions: readonly ConsistencyExemption[] = [],
): ConsistencyFinding[] {
  if (!draft.trim()) return []
  const activeExemptions = new Set(
    exemptions.filter(exemption => !exemption.revoked).map(exemption => exemption.stableFactKey),
  )
  const findings: ConsistencyFinding[] = []
  for (const checkItem of blueprintV2CheckItems(content)) {
    if (activeExemptions.has(`bpcheck:${checkItem.item.id}`)) continue
    const itemText = checkItem.item.markdown.trim()
    const terms = quotedTermsOfCheckItem(checkItem.item.markdown)

    if (checkItem.mode === 'forbid') {
      // 禁写：仅引号词原样命中才产出证据；否则保持沉默（绝不反向要求解释）。
      for (const term of terms) {
        if (!draft.includes(term)) continue
        findings.push(finding(
          checkItem,
          chapterNumber,
          {
            zhCN: `细纲禁写条目中的「${term}」出现在正文中。该条目是硬性禁止（${itemText}），不是需要正文解释的情节。`,
            enUS: `The quoted term "${term}" from a forbid item appears in the prose. The item is a hard prohibition (${itemText}), not a plot point to be explained.`,
          },
          itemText,
        ))
        break
      }
      continue
    }

    if (checkItem.mode === 'must') {
      // 保守判负：仅 explicit 或字面含必达词的条目可判未达成，且必须有可
      // 检测的引号词；证据全部缺失才产出发现，绝不凭正文风格差异判失败。
      const judgeable = checkItem.item.check?.source === 'explicit'
        || MUST_LITERAL_PATTERN.test(itemText)
      if (!judgeable || terms.length === 0) continue
      if (terms.some(term => draft.includes(term))) continue
      findings.push(finding(
        checkItem,
        chapterNumber,
        {
          zhCN: `细纲必达条目中的引号词（${terms.map(term => `「${term}」`).join('、')}）均未在正文出现，条目可能未达成：${itemText}`,
          enUS: `None of the quoted terms (${terms.map(term => `"${term}"`).join(', ')}) from a must item appear in the prose; the item may be unmet: ${itemText}`,
        },
        itemText,
      ))
      continue
    }
    // reference：永不产生发现。
  }
  return findings
}
