import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseChapterBlueprintMarkdown } from '../blueprint-v2-markdown'
import {
  blueprintV2CheckItems,
  findBlueprintV2CheckFindings,
  quotedTermsOfCheckItem,
} from '../blueprint-v2-checks'

const FIXTURE_PATH = resolve(__dirname, '../../../test/fixtures/blueprint-v2/chapter-01.md')

function fixtureContent() {
  const markdown = readFileSync(FIXTURE_PATH, 'utf8')
  const { content } = parseChapterBlueprintMarkdown(markdown)
  return content
}

describe('blueprint v2 check item layer (contract §10)', () => {
  it('collects foreshadow/taboos items with parsed modes from the acceptance fixture', () => {
    const items = blueprintV2CheckItems(fixtureContent())
    const modes = items.map(item => item.mode)
    // 验收断言 §11.8：taboos 两条 forbid（两条"严禁…"），foreshadow 两条 reference。
    expect(modes).toEqual(['reference', 'reference', 'forbid', 'forbid'])
    expect(items[2]!.item.markdown).toContain('严禁在第1章解释前世事故、原身死因全貌、信标来源或故事之神真身')
    expect(items[3]!.item.markdown).toContain('严禁出现游戏化属性面板')
  })

  it('extracts quoted terms deterministically', () => {
    expect(quotedTermsOfCheckItem('严禁出现"系统提示音"或「属性面板」').sort()).toEqual(['系统提示音', '属性面板'].sort())
    expect(quotedTermsOfCheckItem('严禁解释原身死因全貌')).toEqual([])
  })

  it('reports a forbid finding only when a quoted term literally appears in the draft', () => {
    const content = fixtureContent()
    const draft = '屏幕上弹出叮的一声：【系统提示音】欢迎来到属性面板。'
    const findings = findBlueprintV2CheckFindings(content, draft, 1)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.stableFactKey).toMatch(/^bpcheck:/)
    expect(findings[0]!.issue.zhCN).toContain('系统提示音')
    expect(findings[0]!.issue.zhCN).toContain('不是需要正文解释的情节')
  })

  it('never turns an unquoted forbid item into a plot or explanation requirement', () => {
    const content = fixtureContent()
    // 原身死因全貌等禁忌条目没有引号词：无论正文写什么、没写什么，都不产生发现。
    const findingsForEmptyProse = findBlueprintV2CheckFindings(content, '正文只有晨跑。', 1)
    expect(findingsForEmptyProse).toEqual([])
    const findingsForExplainingProse = findBlueprintV2CheckFindings(
      content,
      '他在雨里回忆起前世事故与原身死因全貌。',
      1,
    )
    expect(findingsForExplainingProse).toEqual([])
  })

  it('judges must items conservatively: only explicit or literal-must items with quoted terms can be unmet', () => {
    const content = fixtureContent()
    const foreshadow = content.sections.find(
      section => section.kind === 'canonical' && section.id === 'foreshadow',
    )
    if (!foreshadow || foreshadow.kind !== 'canonical') throw new Error('fixture foreshadow section missing')
    // fixture 的 foreshadow 条目是 reference（"新线索/主线咬合"）——补一条
    // 显式必达条目验证判负保守性：含引号词且正文未出现 → 发现；
    // 正出现 → 无发现。
    const mustItem = {
      kind: 'bullet' as const,
      id: 'bpc-test-must',
      label: null,
      markdown: '- 【必达】本章必须出现"末班车"的说法。',
      check: { mode: 'must' as const, source: 'explicit' as const },
    }
    foreshadow.items.push(mustItem)

    const unmet = findBlueprintV2CheckFindings(content, '正文完全没提那辆车。', 1)
    expect(unmet).toHaveLength(1)
    expect(unmet[0]!.issue.zhCN).toContain('可能未达成')

    const met = findBlueprintV2CheckFindings(content, '末班车缓缓驶出。', 1)
    expect(met).toEqual([])
  })

  it('never judges inferred must items without quoted terms, and never judges reference items', () => {
    const content = fixtureContent()
    const foreshadow = content.sections.find(
      section => section.kind === 'canonical' && section.id === 'foreshadow',
    )
    if (!foreshadow || foreshadow.kind !== 'canonical') throw new Error('fixture foreshadow section missing')
    foreshadow.items.push({
      kind: 'bullet',
      id: 'bpc-test-inferred',
      label: null,
      markdown: '- 必须保证主线推进明确。',
      check: { mode: 'must', source: 'inferred' },
    })
    // reference 条目永不产生发现；无引号词的 inferred must 也不产生发现。
    expect(findBlueprintV2CheckFindings(content, '正文任意。', 1)).toEqual([])
  })

  it('returns no findings for an empty draft and honors exemptions', () => {
    const content = fixtureContent()
    expect(findBlueprintV2CheckFindings(content, '  \n ', 1)).toEqual([])
    const draft = '屏幕上弹出叮的一声：【系统提示音】。'
    const findings = findBlueprintV2CheckFindings(content, draft, 1)
    expect(findings).toHaveLength(1)
    const exempted = findBlueprintV2CheckFindings(content, draft, 1, [
      { stableFactKey: findings[0]!.stableFactKey, reason: 'test', revoked: false },
    ])
    expect(exempted).toEqual([])
  })
})
