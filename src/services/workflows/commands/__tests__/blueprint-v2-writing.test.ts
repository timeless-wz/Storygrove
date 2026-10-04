import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseChapterBlueprintMarkdown, serializeChapterBlueprintV2 } from '../../../../shared/blueprint-v2-markdown'
import { buildBlueprintV2MigrationContent, computeBlueprintV2ContentHash, type ChapterBlueprintV2DetailRead } from '../../../../shared/blueprint-v2'
import {
  assembleBlueprintV2WritingBlock,
  BLUEPRINT_V2_CONSTRAINT_SCAFFOLD,
  isWritableBlueprintV2Detail,
} from '../blueprint-v2-writing'

const FIXTURE_PATH = resolve(__dirname, '../../../../../test/fixtures/blueprint-v2/chapter-01.md')

function fixtureDetail(): ChapterBlueprintV2DetailRead {
  const markdown = readFileSync(FIXTURE_PATH, 'utf8')
  const { content } = parseChapterBlueprintMarkdown(markdown)
  return {
    ...content,
    revision: 3,
    contentHash: computeBlueprintV2ContentHash(content),
  }
}

describe('blueprint v2 writing block assembly (contract §9)', () => {
  const block = assembleBlueprintV2WritingBlock(fixtureDetail(), 'zh-CN')!

  it('injects the four scenes verbatim in formal order', () => {
    const indexes = [
      block.text.indexOf('场景一：02:14的冷汗与声学隔离席'),
      block.text.indexOf('场景二：桌面下的余温与失声的十七秒'),
      block.text.indexOf('场景三：红灯尖鸣与接通线路'),
      block.text.indexOf('场景四：开出地图的末班车'),
    ]
    expect(indexes.every(index => index >= 0)).toBe(true)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
    // 各异小标题与嵌套对白子列表逐字保留（验收 §11.3/§11.4）。
    expect(block.text).toContain('- **物证搜查**：')
    expect(block.text).toContain('- 周晓：“……值守员同志，我想报警。”')
    expect(block.text).toContain('- 许渡调出外网治安联动界面')
  })

  it('preserves scene Markdown edge whitespace instead of normalizing the imported text', () => {
    const base = fixtureDetail()
    const sections = base.sections.map(section => {
      if (section.kind !== 'canonical' || section.id !== 'storyboard') return section
      return {
        ...section,
        items: section.items.map((item, index) => item.kind === 'scene' && index === 0
          ? { ...item, markdown: `\n  ${item.markdown}\n\n` }
          : item),
      }
    })
    const detail = { ...base, sections }
    const storyboard = detail.sections.find(section => section.id === 'storyboard')
    if (!storyboard || storyboard.kind !== 'canonical') throw new Error('fixture storyboard section is missing')
    const firstScene = storyboard.items.find(item => item.kind === 'scene')
    if (!firstScene || firstScene.kind !== 'scene') throw new Error('fixture scene is missing')

    const block = assembleBlueprintV2WritingBlock(detail, 'zh-CN')!

    expect(block.text).toContain(`#### ${firstScene.title}\n${firstScene.markdown}`)
  })

  it('carries rules, cliffhanger, conflict, and check items in the frozen order', () => {
    const sceneOne = block.text.indexOf('场景一：')
    const rules = block.text.indexOf('【规则与环境细节（约束，不是题材）】')
    const cliffhanger = block.text.indexOf('【章末目标与断章定格】')
    const conflict = block.text.indexOf('【核心矛盾与博弈结构】')
    const checks = block.text.indexOf('【检查条目（必达/参考/禁写）】')
    const budget = block.text.indexOf('正文字数预算：4200 字（蓝图明确值，优先生效）。')
    expect(sceneOne).toBeGreaterThanOrEqual(0)
    expect(rules).toBeGreaterThan(block.text.indexOf('场景四：'))
    expect(cliffhanger).toBeGreaterThan(rules)
    expect(conflict).toBeGreaterThan(cliffhanger)
    expect(checks).toBeGreaterThan(conflict)
    expect(budget).toBeGreaterThan(checks)
    // rules/cliffhanger 关键内容逐字在场（验收 §11.6/§11.7）。
    expect(block.text).toContain('- **源**：百年前异文明归航遗留的避难协议。')
    expect(block.text).toContain('周晓的清醒机制')
    expect(block.text).toContain('下一站，老槐树平房。')
  })

  it('marks taboos as forbid constraints that must not be explained as plot', () => {
    expect(block.text).toContain('- [禁写] - 严禁在第1章解释前世事故、原身死因全貌、信标来源或故事之神真身。')
    expect(block.text).toContain('- [禁写] - 严禁出现游戏化属性面板或“系统提示音”')
    expect(block.text).toContain('- [参考] - **新线索**：')
    // 固定脚手架明确声明规则/禁忌是约束，不是要求正文解释的题材（契约 §9.3）。
    expect(block.text).toContain('规则、禁忌与检查条目约束事件与现象的走向')
    expect(block.text).toContain('不是要求正文解释的题材')
    expect(block.text).toContain('不得直接讲解世界观设定、系统规则或神明名号')
  })

  it('reports the blueprint word budget and never includes author guidance', () => {
    expect(block.wordBudget).toBe(4200)
    expect(block.sceneCount).toBe(4)
    expect(block.text).not.toContain('userGuidance')
  })

  it('injects confirmed chapter planning fields as intent, not established events', () => {
    const detail = {
      ...fixtureDetail(),
      planning: {
        volumeTask: 'Expose the hidden cost of the rescue.',
        handoff: 'Carry the missing key into the next chapter.',
        expectedEndChange: 'The protagonist loses trust in the dispatcher.',
      },
    }
    const block = assembleBlueprintV2WritingBlock(detail, 'en-US')!
    expect(block.text).toContain('[Chapter planning intent (author-confirmed plans, not established events)]')
    expect(block.text).toContain('Chapter role in the volume: Expose the hidden cost of the rescue.')
    expect(block.text).toContain('Planned handoff: Carry the missing key into the next chapter.')
    expect(block.text).toContain('Intended end-of-chapter change: The protagonist loses trust in the dispatcher.')
  })

  it('keeps the constraint scaffold a constant independent of outline content', () => {
    expect(BLUEPRINT_V2_CONSTRAINT_SCAFFOLD.zhCN).toBe(BLUEPRINT_V2_CONSTRAINT_SCAFFOLD.zhCN.trim())
    const otherChapter = assembleBlueprintV2WritingBlock(
      {
        ...fixtureDetail(),
        chapterTitle: '第2章｜完全不同的内容',
        sections: fixtureDetail().sections,
      },
      'zh-CN',
    )!
    expect(otherChapter.text).toContain(BLUEPRINT_V2_CONSTRAINT_SCAFFOLD.zhCN)
    // 同一 detail 组装是确定性的（注入单一性）。
    expect(assembleBlueprintV2WritingBlock(fixtureDetail(), 'zh-CN')!.text).toBe(block.text)
  })

  it('assembles an English block for English projects', () => {
    const en = assembleBlueprintV2WritingBlock(fixtureDetail(), 'en-US')!
    expect(en.text).toContain('[Scene storyboard (realize in order)]')
    expect(en.text).toContain('[Check items (must / reference / forbid)]')
    expect(en.text).toContain('Prose word budget: 4200 words (explicit blueprint value, takes priority).')
    expect(en.text).toContain('场景一：02:14的冷汗与声学隔离席')
  })

  it('returns null for an empty migration content so the v1 path stays authoritative', () => {
    const scaffold = buildBlueprintV2MigrationContent({
      chapterNumber: 2,
      title: '旧章',
      purpose: '',
      keyEvents: '',
      suspenseHook: '',
    })
    expect(assembleBlueprintV2WritingBlock(scaffold, 'zh-CN')).toBeNull()
  })

  it('treats corrupt and needs-newer-app reads as not writable', () => {
    expect(isWritableBlueprintV2Detail({ ...fixtureDetail(), readStatus: 'corrupt', rawMarkdown: serializeChapterBlueprintV2(fixtureDetail()) } as ChapterBlueprintV2DetailRead)).toBe(false)
    expect(isWritableBlueprintV2Detail({ ...fixtureDetail(), readStatus: 'needs-newer-app' } as ChapterBlueprintV2DetailRead)).toBe(false)
    expect(isWritableBlueprintV2Detail(fixtureDetail())).toBe(true)
    expect(isWritableBlueprintV2Detail(null)).toBe(false)
  })
})
