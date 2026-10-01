/**
 * 章节蓝图 v2 Markdown 导入/导出验收（docs/blueprint-v2-contract.md §11，fixture =
 * 《第1章｜接错的人》完整细纲原文）。红线：未编辑内容逐字保留（仅 CRLF→LF）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MAX_BLUEPRINT_V2_RAW_MARKDOWN,
  type BlueprintV2Section,
  type BlueprintV2SectionItem,
  type ChapterBlueprintV2Content,
  projectV2ToV1,
} from '../blueprint-v2'
import {
  applyBlueprintV2SceneIdReuse,
  assertNoLossOnSerialize,
  collectBlueprintV2Unclassified,
  diffChapterBlueprintV2ForReimport,
  matchScenesForReimport,
  parseChapterBlueprintMarkdown,
  serializeChapterBlueprintV2,
} from '../blueprint-v2-markdown'

const FIXTURE_PATH = fileURLToPath(new URL('../../../test/fixtures/blueprint-v2/chapter-01.md', import.meta.url))
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8')

function parseFixture(): ChapterBlueprintV2Content {
  return parseChapterBlueprintMarkdown(FIXTURE).content
}

/** 去掉应用元数据（id/presence/canvasNodeId/check），只比内容本身。 */
function stripMetadata(content: ChapterBlueprintV2Content): unknown {
  return {
    chapterTitle: content.chapterTitle,
    docPreamble: content.docPreamble,
    chapterPostamble: content.chapterPostamble ?? '',
    sections: content.sections.map((section): unknown => {
      if (section.kind === 'custom') return { kind: 'custom', title: section.title, level: section.level, body: section.body }
      return {
        kind: 'canonical',
        id: section.id,
        title: section.title,
        preamble: section.preamble,
        postamble: section.postamble,
        items: section.items.map(item => {
          if (item.kind === 'scene') return { kind: 'scene', level: item.level, title: item.title, markdown: item.markdown }
          if (item.kind === 'field') return { kind: 'field', label: item.label, markdown: item.markdown }
          if (item.kind === 'bullet') return { kind: 'bullet', markdown: item.markdown }
          return { kind: 'block', markdown: item.markdown }
        }),
      }
    }),
  }
}

describe('parseChapterBlueprintMarkdown（契约 §11.1–11.8）', () => {
  const parsed = parseChapterBlueprintMarkdown(FIXTURE)
  const content = parsed.content
  const canonical = (id: string) =>
    content.sections.find((section): section is Extract<BlueprintV2Section, { kind: 'canonical' }> =>
      section.kind === 'canonical' && section.id === id)

  it('§11.1 章题与建议章号', () => {
    expect(parsed.chapterTitle).toBe('第1章｜接错的人')
    expect(parsed.suggestedChapterNumber).toBe(1)
    expect(content.chapterTitle).toBe('第1章｜接错的人')
    expect(content.chapterTitleLevel).toBe(3)
  })

  it('§11.2 七个 canonical 分区按文档顺序命中且保留【】原文', () => {
    expect(content.sections.map(section => section.kind === 'canonical' ? section.id : `custom:${section.id}`)).toEqual([
      'positioning', 'conflict', 'storyboard', 'rules', 'cliffhanger', 'foreshadow', 'taboos',
    ])
    expect(content.sections.map(section => section.title)).toEqual([
      '【本章定位与四维指标】', '【核心矛盾与博弈结构】', '【逐场分镜拆解】', '【超凡物理与规则交互细节】',
      '【章末爆点与断章定格】', '【线索埋设与伏笔自检】', '【写作禁忌与防坑自检】',
    ])
    expect(content.sections.every(section => section.kind !== 'custom')).toBe(true)
  })

  it('§11.3 storyboard 恰好 4 个分镜且标题逐字保留编号', () => {
    const scenes = canonical('storyboard')!.items.filter(item => item.kind === 'scene')
    expect(scenes.map(scene => scene.kind === 'scene' ? scene.title : '')).toEqual([
      '场景一：02:14的冷汗与声学隔离席',
      '场景二：桌面下的余温与失声的十七秒',
      '场景三：红灯尖鸣与接通线路',
      '场景四：开出地图的末班车',
    ])
    expect(scenes.every(scene => scene.kind === 'scene' && scene.level === 5)).toBe(true)
  })

  it('§11.4 各分镜互不相同的小标题逐字保留（含嵌套缩进）', () => {
    const markdownOf = (order: number) => {
      const scenes = canonical('storyboard')!.items.filter(item => item.kind === 'scene')
      const scene = scenes[order - 1]
      return scene && scene.kind === 'scene' ? scene.markdown : ''
    }
    expect(markdownOf(1)).toContain('**时空与环境**：')
    expect(markdownOf(1)).toContain('**动作与生理细节**：')
    expect(markdownOf(1)).toContain('**心理流**：')
    expect(markdownOf(2)).toContain('**物证搜查**：')
    expect(markdownOf(2)).toContain('**桌下异物**：')
    expect(markdownOf(2)).toContain('**声学捕捉**：')
    expect(markdownOf(2)).toContain('**有限研判**：')
    expect(markdownOf(3)).toContain('**冲突爆发**：')
    expect(markdownOf(3)).toContain('**屏幕信息**：')
    expect(markdownOf(3)).toContain('**动作定格**：')
    expect(markdownOf(4)).toContain('**对白推进**：')
    expect(markdownOf(4)).toContain('**边缘感应**：')
    // 场景四的 5 条嵌套对白子列表逐字符保留（含两空格缩进）。
    expect(markdownOf(4)).toContain('\n  - 周晓：“……值守员同志，我想报警。”')
    expect(markdownOf(4)).toContain('\n  - 许渡调出外网治安联动界面：')
    expect(markdownOf(4)).toContain('\n  - 周晓发出一声颤抖的呼吸：')
    expect(markdownOf(4)).toContain('\n  - 许渡敲击键盘调出城域交通实时监控网，输入车辆编号，屏幕上跳出一行绿字：')
    expect(markdownOf(4)).toContain('\n  - 周晓的声音带上一丝极力克制的哭腔：')
    // 分镜正文以标题行后原文开头（首行为空行）。
    expect(markdownOf(1).startsWith('\n- ')).toBe(true)
  })

  it('§11.5 positioning：字数预算 4200，情绪曲线含两端温度', () => {
    const items = canonical('positioning')!.items
    const labels = items.map(item => item.kind === 'field' ? item.label : '')
    expect(labels).toEqual(['核心使命', '情绪曲线', '正文字数预算', '番茄追读钩子'])
    const emotion = items.find(item => item.kind === 'field' && item.label === '情绪曲线')
    expect(emotion && emotion.kind === 'field' ? emotion.markdown : '').toContain('（25度）')
    expect(emotion && emotion.kind === 'field' ? emotion.markdown : '').toContain('（98度）')
    expect(items.every(item => item.markdown.trim().length > 0)).toBe(true)
  })

  it('§11.6 rules：源-锚-桥-能参数 5 条嵌套子项与周晓的清醒机制逐字保留', () => {
    const items = canonical('rules')!.items
    expect(items.map(item => item.kind === 'field' ? item.label : '')).toEqual(['源-锚-桥-能参数', '周晓的清醒机制'])
    const params = items[0]
    expect(params && params.kind === 'field' ? params.markdown : '').toContain('\n  - **源**：百年前异文明归航遗留的避难协议。')
    expect(params && params.kind === 'field' ? params.markdown : '').toContain('\n  - **锚**：13路公交车底盘大修时误装的异文明航路构件。')
    expect(params && params.kind === 'field' ? params.markdown : '').toContain('\n  - **桥**：暴雨界潮、白痕残留航廊')
    expect(params && params.kind === 'field' ? params.markdown : '').toContain('\n  - **能**：暴雨界潮积聚的环境界质。')
    expect(params && params.kind === 'field' ? params.markdown : '').toContain('\n  - **错误参数**：古代登记库已不存在')
    const mechanism = items[1]
    expect(mechanism && mechanism.kind === 'field' ? mechanism.markdown : '')
      .toContain('苦难记忆的刺痛构成了对抗致幻归航的天然抗体。')
  })

  it('§11.7 cliffhanger：引用行含行尾硬换行空格；投影 suspenseHook 为两行拼接', () => {
    const items = canonical('cliffhanger')!.items
    const hook = items.find((item): item is BlueprintV2SectionItem & { kind: 'field' } =>
      item.kind === 'field' && item.label === '章末钩子')
    expect(hook).toBeDefined()
    expect(hook!.markdown).toContain('> “我想报警。”  \n  > “我坐的末班车，好像开出地图了。”')
    const visual = items.find(item => item.kind === 'field' && item.label === '视觉定格')
    expect(visual && visual.kind === 'field' ? visual.markdown : '').toContain('“下一站，老槐树平房。”')
    const projection = projectV2ToV1(content, {
      chapterNumber: 1, title: '旧', role: '建置', purpose: '旧', keyEvents: '旧',
      characters: [], suspenseHook: '旧', userGuidance: '', notes: '', notesUpdatedAt: '',
    })
    expect(projection.suspenseHook).toBe('“我想报警。”\n“我坐的末班车，好像开出地图了。”')
  })

  it('§11.8 checks：taboos 两条 forbid，foreshadow 两条 reference（field 条目）', () => {
    const taboos = canonical('taboos')!.items
    expect(taboos.map(item => item.kind)).toEqual(['bullet', 'bullet'])
    expect(taboos.map(item => item.kind === 'bullet' ? item.check?.mode : undefined)).toEqual(['forbid', 'forbid'])
    expect(taboos.every(item => item.kind === 'bullet' && item.check?.source === 'inferred')).toBe(true)
    const foreshadow = canonical('foreshadow')!.items
    expect(foreshadow.map(item => item.kind === 'field' ? item.label : '')).toEqual(['新线索', '主线咬合'])
    expect(foreshadow.map(item => item.kind === 'field' ? item.check?.mode : undefined)).toEqual(['reference', 'reference'])
  })

  it('显式【禁写】前缀优先于词面推断', () => {
    const doc = ['#### 【写作禁忌与防坑自检】', '', '- 【禁写】不要提前揭示真相。', ''].join('\n')
    const parsedDoc = parseChapterBlueprintMarkdown(doc)
    const section = parsedDoc.content.sections[0]
    expect(section.kind).toBe('canonical')
    if (section.kind !== 'canonical') return
    const bullet = section.items[0]
    expect(bullet.kind).toBe('bullet')
    expect(bullet.kind === 'bullet' ? bullet.check : undefined).toEqual({ mode: 'forbid', source: 'explicit' })
  })
})

describe('serialize 往返（契约 §11.9 + 红线 3）', () => {
  it('serialize(parse(fixture)) 与原文字节恒等（fixture 为 LF）', () => {
    const serialized = serializeChapterBlueprintV2(parseFixture())
    expect(serialized).toBe(FIXTURE)
  })

  it('assertNoLossOnSerialize 通过；再 parse 后内容与首次 parse 相等', () => {
    const content = parseFixture()
    expect(() => assertNoLossOnSerialize(content)).not.toThrow()
    const reparsed = parseChapterBlueprintMarkdown(serializeChapterBlueprintV2(content)).content
    expect(stripMetadata(reparsed)).toEqual(stripMetadata(content))
  })

  it('CRLF 输入归一化为 LF 且往返无损', () => {
    const crlf = FIXTURE.replace(/\n/gu, '\r\n')
    const content = parseChapterBlueprintMarkdown(crlf).content
    expect(serializeChapterBlueprintV2(content)).toBe(FIXTURE)
    expect(() => assertNoLossOnSerialize(content)).not.toThrow()
  })

  it('无章题文档：首段并入 docPreamble，散块不丢', () => {
    const doc = ['开篇白噪声。', '', '#### 【逐场分镜拆解】', '', '##### 场景一：测试', '', '- **目标**：确认。', ''].join('\n')
    const content = parseChapterBlueprintMarkdown(doc).content
    expect(content.chapterTitle).toBe('')
    expect(content.docPreamble).toBe('开篇白噪声。\n\n')
    const serialized = serializeChapterBlueprintV2(content)
    expect(serialized).toBe(doc)
    expect(() => assertNoLossOnSerialize(content)).not.toThrow()
  })

  it('章题行与首个分区之间的散块保真（chapterPostamble）', () => {
    const doc = [
      '### 第2章｜测试',
      '',
      '章题下的一段闲笔。',
      '',
      '#### 【本章定位与四维指标】',
      '',
      '- **核心使命**：立住人物。',
      '',
    ].join('\n')
    const content = parseChapterBlueprintMarkdown(doc).content
    expect(content.chapterPostamble).toBe('\n章题下的一段闲笔。\n\n')
    expect(serializeChapterBlueprintV2(content)).toBe(doc)
  })

  it('custom 分区、分镜间杂项标题与 postamble 整节逐字保留', () => {
    const doc = [
      '### 第3章｜杂项',
      '',
      '#### 【逐场分镜拆解】',
      '',
      '##### 场景一：唯一',
      '',
      '- **动作**：进门。',
      '',
      '##### 备忘：这条不是分镜',
      '',
      '自由文本与 ```代码 围栏### 内的 #### 伪标题都不该切开。',
      '',
      '##### 场景二：压轴',
      '',
      '- **收尾**：出门。',
      '',
      '##### 尾注：最后的分镜之后',
      '',
      '#### 【作者私货】',
      '',
      '- 这一级标题不在注册表里。',
      '',
    ].join('\n')
    const content = parseChapterBlueprintMarkdown(doc).content
    const custom = content.sections.find(section => section.kind === 'custom')
    expect(custom && custom.kind === 'custom' ? custom.title : '').toBe('【作者私货】')
    expect(custom && custom.kind === 'custom' ? custom.body : '').toBe('\n- 这一级标题不在注册表里。\n')
    const storyboard = content.sections.find(section => section.kind === 'canonical' && section.id === 'storyboard')
    if (!storyboard || storyboard.kind !== 'canonical') throw new Error('storyboard 分区缺失')
    // 「备忘」H5 不是「场景」开头且夹在两个分镜之间 → block 条目保留（含围栏内的伪标题）。
    const blocks = storyboard.items.filter(item => item.kind === 'block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind === 'block' ? blocks[0].markdown : '').toContain('#### 伪标题')
    expect(storyboard.items.filter(item => item.kind === 'scene')).toHaveLength(2)
    // 末个分镜之后的散块 → postamble（契约 §3），逐字保留。
    expect(storyboard.postamble).toBe('##### 尾注：最后的分镜之后\n\n')
    expect(serializeChapterBlueprintV2(content)).toBe(doc)
    expect(() => assertNoLossOnSerialize(content)).not.toThrow()
  })

  it('解析永不因"看不懂"而失败：纯散文全部进 docPreamble', () => {
    const doc = '只是一段没有任何标题的散文。\n第二行。\n'
    const content = parseChapterBlueprintMarkdown(doc).content
    expect(content.docPreamble).toBe(doc)
    expect(content.sections).toEqual([])
    expect(serializeChapterBlueprintV2(content)).toBe(doc)
  })

  it('超限与非字符串输入抛错且带长度（契约 §4.1.1）', () => {
    expect(() => parseChapterBlueprintMarkdown('x'.repeat(MAX_BLUEPRINT_V2_RAW_MARKDOWN + 1)))
      .toThrow(/超限.*400 ?001|400001/u)
    expect(() => parseChapterBlueprintMarkdown(42 as unknown as string)).toThrow(/字符串/u)
  })
})

describe('重复导入预览（契约 §4.3）', () => {
  it('同一文档再导入：全部分镜沿用旧 id，无增删', () => {
    const existing = parseFixture()
    const incoming = parseFixture()
    const match = matchScenesForReimport(existing, incoming)
    expect(match.kept).toHaveLength(4)
    expect(match.removed).toEqual([])
    expect(match.added).toEqual([])
    const diff = diffChapterBlueprintV2ForReimport(existing, incoming)
    expect(diff.every(entry => entry.status === 'unchanged')).toBe(true)
  })

  it('标题改动 → 旧分镜列入 removed（带原文），新分镜列入 added', () => {
    const existing = parseFixture()
    const editedText = FIXTURE.replace('##### 场景三：红灯尖鸣与接通线路', '##### 场景三：接通线路的抉择')
      .replace('##### 场景四：开出地图的末班车', '##### 场景五：开出地图的末班车')
    const incoming = parseChapterBlueprintMarkdown(editedText).content
    const match = matchScenesForReimport(existing, incoming)
    // 场景三换了标题、场景四编号被改写：两者都是旧有新无 → removed（编号文字也是小说内容，永不自动匹配）。
    expect(match.removed.map(scene => scene.title)).toEqual(['场景三：红灯尖鸣与接通线路', '场景四：开出地图的末班车'])
    expect(match.removed[0].markdown).toContain('**冲突爆发**：')
    expect(match.added.map(scene => scene.title)).toEqual(['场景三：接通线路的抉择', '场景五：开出地图的末班车'])
    expect(match.kept.map(scene => scene.title)).toEqual([
      '场景一：02:14的冷汗与声学隔离席', '场景二：桌面下的余温与失声的十七秒',
    ])
    const withReuse = applyBlueprintV2SceneIdReuse(incoming, existing)
    // 标题未变的分镜回填旧 scene id（画布链接存活）；标题已改的分镜仍列入 removed/added。
    const reused = matchScenesForReimport(existing, withReuse)
    expect(reused.kept.map(entry => entry.title)).toEqual([
      '场景一：02:14的冷汗与声学隔离席', '场景二：桌面下的余温与失声的十七秒',
    ])
    expect(reused.removed.map(scene => scene.title)).toEqual(['场景三：红灯尖鸣与接通线路', '场景四：开出地图的末班车'])
    const incomingSceneIds = withReuse.sections.flatMap(section => section.kind === 'canonical' && section.id === 'storyboard'
      ? section.items.filter(item => item.kind === 'scene').map(item => item.kind === 'scene' ? item.id : '')
      : [])
    const existingSceneIds = new Set(reused.kept.map(entry => entry.sceneId))
    expect(incomingSceneIds.filter(id => existingSceneIds.has(id))).toHaveLength(2)
    expect(new Set(incomingSceneIds).size).toBe(4)
  })

  it('分区级差异：标题匹配 → update，新分区 → add，旧分区 → remove', () => {
    const existing = parseFixture()
    const editedText = FIXTURE
      .replace('- **正文字数预算**：4200 字。', '- **正文字数预算**：4500 字。')
      .replace('#### 【写作禁忌与防坑自检】\n', '')
    const incoming = parseChapterBlueprintMarkdown(editedText).content
    const diff = diffChapterBlueprintV2ForReimport(existing, incoming)
    const positioning = diff.find(entry => entry.sectionKey === 'positioning')
    const taboos = diff.find(entry => entry.sectionKey === 'taboos')
    expect(positioning?.status).toBe('update')
    expect(taboos?.status).toBe('remove')
  })

  it('无法归类内容预览列出 custom 分区与 block 散块', () => {
    const content = parseFixture()
    expect(collectBlueprintV2Unclassified(content)).toEqual([])
    const withExtras = parseChapterBlueprintMarkdown(`${FIXTURE}\n#### 【随手记】\n\n- 一条杂记。\n`).content
    const entries = collectBlueprintV2Unclassified(withExtras)
    expect(entries.some(entry => entry.kind === 'custom-section' && entry.title === '【随手记】')).toBe(true)
  })
})
