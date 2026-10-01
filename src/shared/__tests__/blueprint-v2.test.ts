import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  BLUEPRINT_V2_CANONICAL_SECTIONS,
  BLUEPRINT_V2_SCHEMA_VERSION,
  computeBlueprintV2ContentHash,
  createBlueprintV2SceneId,
  extractBlueprintV2WordBudget,
  getBlueprintV2Scenes,
  moveBlueprintV2Scene,
  projectV2ToV1,
} from '../blueprint-v2'
import {
  applyBlueprintV2Reimport,
  assertNoLossOnSerialize,
  matchScenesForReimport,
  parseChapterBlueprintMarkdown,
  serializeChapterBlueprintV2,
} from '../blueprint-v2-markdown'

const fixturePath = path.join(__dirname, '../../../test/fixtures/blueprint-v2/chapter-01.md')
const fixture = readFileSync(fixturePath, 'utf8')

function parseFixture() {
  return parseChapterBlueprintMarkdown(fixture)
}

describe('blueprint-v2 契约验收（fixture：第1章｜接错的人）', () => {
  it('§11.1 章题与建议章号', () => {
    const { content, suggestedChapterNumber } = parseFixture()
    expect(content.chapterTitle).toBe('第1章｜接错的人')
    expect(suggestedChapterNumber).toBe(1)
    expect(content.schemaVersion).toBe(BLUEPRINT_V2_SCHEMA_VERSION)
  })

  it('§11.2 七个 canonical 分区按文档顺序全部命中，title 保留【】原文', () => {
    const { content } = parseFixture()
    const canonical = content.sections.filter(section => section.kind === 'canonical')
    expect(canonical.map(section => (section as { id: string }).id)).toEqual(
      BLUEPRINT_V2_CANONICAL_SECTIONS.map(entry => entry.id),
    )
    expect(canonical.map(section => (section as { title: string }).title)).toEqual(
      BLUEPRINT_V2_CANONICAL_SECTIONS.map(entry => `【${entry.title}】`),
    )
  })

  it('§11.3 storyboard 恰好 4 个 scene 条目，title 逐字等于四条场景标题', () => {
    const { content } = parseFixture()
    const scenes = getBlueprintV2Scenes(content)
    expect(scenes.map(scene => scene.title)).toEqual([
      '场景一：02:14的冷汗与声学隔离席',
      '场景二：桌面下的余温与失声的十七秒',
      '场景三：红灯尖鸣与接通线路',
      '场景四：开出地图的末班车',
    ])
    expect(scenes.every(scene => scene.order >= 1 && scene.order <= 4)).toBe(true)
    // 分镜标题级 = 样例的 #####（5）。
    const storyboard = content.sections.find(
      section => section.kind === 'canonical' && section.id === 'storyboard',
    )
    expect(storyboard && storyboard.kind === 'canonical').toBe(true)
    if (storyboard && storyboard.kind === 'canonical') {
      expect(
        storyboard.items.filter(item => item.kind === 'scene').every(scene => scene.level === 5),
      ).toBe(true)
    }
  })

  it('§11.4 各分镜正文逐字保留各不相同的小标题集与嵌套缩进', () => {
    const { content } = parseFixture()
    const scenes = getBlueprintV2Scenes(content)
    expect(scenes[0].markdown).toContain('- **时空与环境**：')
    expect(scenes[0].markdown).toContain('- **动作与生理细节**：')
    expect(scenes[0].markdown).toContain('- **心理流**：')
    expect(scenes[0].markdown).toContain('【岚容城危机干预中心·四级值守员·许渡·工号7102】')
    expect(scenes[1].markdown).toContain('- **物证搜查**：')
    expect(scenes[1].markdown).toContain('- **桌下异物**：')
    expect(scenes[1].markdown).toContain('- **声学捕捉**：')
    expect(scenes[1].markdown).toContain('- **有限研判**：')
    expect(scenes[2].markdown).toContain('- **冲突爆发**：')
    expect(scenes[2].markdown).toContain('- **屏幕信息**：')
    expect(scenes[2].markdown).toContain('- **动作定格**：')
    // 场景四：对白推进 + 5 条嵌套对白子列表逐字符保留。
    expect(scenes[3].markdown).toContain('- **对白推进**：\n')
    expect(scenes[3].markdown).toContain('  - 周晓：“……值守员同志，我想报警。”\n')
    expect(scenes[3].markdown.match(/^  - /gm)?.length).toBe(5)
    expect(scenes[3].markdown).toContain('- **边缘感应**：')
  })

  it('§11.5 positioning：wordBudget=4200，核心使命/情绪曲线/番茄追读钩子原文非空', () => {
    const { content } = parseFixture()
    expect(extractBlueprintV2WordBudget(content)).toBe(4200)
    const positioning = content.sections.find(
      section => section.kind === 'canonical' && section.id === 'positioning',
    )
    expect(positioning && positioning.kind === 'canonical').toBe(true)
    if (!positioning || positioning.kind !== 'canonical') return
    const markdownOf = (label: string) => {
      const item = positioning.items.find(
        candidate => candidate.kind === 'field' && candidate.label === label,
      )
      return item && item.kind === 'field' ? item.markdown : ''
    }
    expect(markdownOf('核心使命')).toContain('末班公交驶出地图')
    const emotion = markdownOf('情绪曲线')
    expect(emotion).toContain('（25度）')
    expect(emotion).toContain('（98度）')
    expect(markdownOf('番茄追读钩子')).toContain('末班公交车')
  })

  it('§11.6 rules：「源-锚-桥-能参数」5 条嵌套子项与「周晓的清醒机制」逐字保留', () => {
    const { content } = parseFixture()
    const rules = content.sections.find(section => section.kind === 'canonical' && section.id === 'rules')
    if (!rules || rules.kind !== 'canonical') throw new Error('rules 分区缺失')
    const params = rules.items.find(item => item.kind === 'field' && item.label === '源-锚-桥-能参数')
    expect(params && params.kind === 'field').toBe(true)
    if (!params || params.kind !== 'field') return
    for (const label of ['源', '锚', '桥', '能', '错误参数']) {
      expect(params.markdown).toContain(`  - **${label}**：`)
    }
    expect(params.markdown).toContain('百年前异文明归航遗留的避难协议')
    expect(params.markdown).toContain('古代登记库已不存在')
    const mechanism = rules.items.find(item => item.kind === 'field' && item.label === '周晓的清醒机制')
    expect(mechanism && mechanism.kind === 'field').toBe(true)
    if (mechanism && mechanism.kind === 'field') {
      expect(mechanism.markdown).toContain('天然抗体')
    }
  })

  it('§11.7 cliffhanger：视觉定格原文；章末钩子两行引用（行尾硬换行空格）；投影 suspenseHook 按行拼接', () => {
    const { content } = parseFixture()
    const cliffhanger = content.sections.find(section => section.kind === 'canonical' && section.id === 'cliffhanger')
    if (!cliffhanger || cliffhanger.kind !== 'canonical') throw new Error('cliffhanger 分区缺失')
    const visual = cliffhanger.items.find(item => item.kind === 'field' && item.label === '视觉定格')
    expect(visual && visual.kind === 'field').toBe(true)
    if (visual && visual.kind === 'field') {
      expect(visual.markdown).toContain('下一站，老槐树平房。')
    }
    const hook = cliffhanger.items.find(item => item.kind === 'field' && item.label === '章末钩子')
    expect(hook && hook.kind === 'field').toBe(true)
    if (!hook || hook.kind !== 'field') return
    expect(hook.markdown).toContain('> “我想报警。”  \n')
    expect(hook.markdown).toContain('> “我坐的末班车，好像开出地图了。”')
    const projection = projectV2ToV1(content, {
      chapterNumber: 1, title: '', role: '', purpose: '', keyEvents: '',
      characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '',
    })
    expect(projection.suspenseHook).toBe('“我想报警。”\n“我坐的末班车，好像开出地图了。”')
  })

  it('§11.8 checks：taboos 两条 forbid（严禁…），foreshadow 两条 reference', () => {
    const { content } = parseFixture()
    const taboos = content.sections.find(section => section.kind === 'canonical' && section.id === 'taboos')
    const foreshadow = content.sections.find(section => section.kind === 'canonical' && section.id === 'foreshadow')
    if (!taboos || taboos.kind !== 'canonical') throw new Error('taboos 分区缺失')
    if (!foreshadow || foreshadow.kind !== 'canonical') throw new Error('foreshadow 分区缺失')
    const tabooChecks = taboos.items.map(item => (item.kind === 'bullet' || item.kind === 'field') ? item.check : undefined)
    expect(tabooChecks.filter(Boolean)).toHaveLength(2)
    expect(tabooChecks.every(check => check?.mode === 'forbid' && check.source === 'inferred')).toBe(true)
    const foreshadowChecks = foreshadow.items.map(item => (item.kind === 'bullet' || item.kind === 'field') ? item.check : undefined)
    expect(foreshadowChecks.filter(Boolean)).toHaveLength(2)
    expect(foreshadowChecks.every(check => check?.mode === 'reference' && check.source === 'inferred')).toBe(true)
  })

  it('§11.9 无损往返：serialize→parse 全部条目 markdown 相等', () => {
    const { content } = parseFixture()
    const markdown = assertNoLossOnSerialize(content)
    // 序列化结果再 parse，与首次 parse 逐条目比较。
    const second = parseChapterBlueprintMarkdown(markdown).content
    const flat = (candidate: typeof content): Array<{ kind: string; markdown: string; title: string | null }> => {
      const rows: Array<{ kind: string; markdown: string; title: string | null }> = []
      for (const section of candidate.sections) {
        if (section.kind === 'canonical') {
          for (const item of section.items) {
            rows.push({ kind: item.kind, markdown: item.markdown, title: item.kind === 'scene' ? item.title : null })
          }
        } else {
          rows.push({ kind: section.kind, markdown: section.body, title: section.title })
        }
      }
      return rows
    }
    expect(flat(second)).toEqual(flat(content))
    // CRLF 归一化后仍无损。
    const crlf = parseChapterBlueprintMarkdown(fixture.replace(/\n/g, '\r\n')).content
    expect(serializeChapterBlueprintV2(crlf)).toBe(markdown)
  })

  it('导出后重新导入保留未识别标题与完整分镜正文', () => {
    const source = [
      '# 第1章｜接错的人',
      '',
      '#### 【逐场分镜拆解】',
      '##### 场景一：站台',
      '- **动作与对白**：',
      '  - 周晓：“我想报警。”',
      '  - 许渡：“请说清楚位置。”',
      '',
      '#### 【未识别的附加要求】',
      '保留自定义标题、表格和正文。',
      '| 项目 | 内容 |',
      '| --- | --- |',
      '| 信号 | 三次回响 |',
      '',
    ].join('\n')
    const first = parseChapterBlueprintMarkdown(source).content
    const exported = assertNoLossOnSerialize(first)
    const reimported = parseChapterBlueprintMarkdown(exported).content
    const custom = reimported.sections.find(section => section.kind === 'custom')

    expect(custom).toMatchObject({
      kind: 'custom',
      title: '【未识别的附加要求】',
    })
    if (custom?.kind === 'custom') {
      expect(custom.body).toContain('保留自定义标题、表格和正文。')
      expect(custom.body).toContain('| 信号 | 三次回响 |')
    }
    expect(getBlueprintV2Scenes(reimported)[0].markdown).toBe(getBlueprintV2Scenes(first)[0].markdown)
    expect(getBlueprintV2Scenes(reimported)[0].markdown).toContain('  - 周晓：“我想报警。”')
  })

  it('§6.3 投影：title=接错的人；purpose=核心使命正文；keyEvents=4 行分镜标题；空推导不抹旧值', () => {
    const { content } = parseFixture()
    const current = {
      chapterNumber: 1,
      title: '旧标题（应被投影覆盖）',
      role: '建置',
      purpose: '旧目的',
      keyEvents: '旧节拍',
      characters: ['许渡'],
      suspenseHook: '旧钩子',
      userGuidance: '作者指导（永不投影）',
      notes: '定稿记录（永不投影）',
      notesUpdatedAt: '2026-01-01',
    }
    const projection = projectV2ToV1(content, current)
    expect(projection.title).toBe('接错的人')
    expect(projection.purpose).toContain('末班公交驶出地图')
    expect(projection.keyEvents).toBe(
      ['场景一：02:14的冷汗与声学隔离席', '场景二：桌面下的余温与失声的十七秒', '场景三：红灯尖鸣与接通线路', '场景四：开出地图的末班车'].join('\n'),
    )
    expect(projection.suspenseHook).toContain('末班车，好像开出地图了')
  })

  it('§3 moveBlueprintV2Scene：只改 storyboard 条目位次，其余条目相对连续性不变', () => {
    const { content } = parseFixture()
    const scenes = getBlueprintV2Scenes(content)
    const moved = moveBlueprintV2Scene(content, scenes[2].sceneId, 1)
    const after = getBlueprintV2Scenes(moved)
    expect(after.map(scene => scene.title)).toEqual([
      '场景三：红灯尖鸣与接通线路',
      '场景一：02:14的冷汗与声学隔离席',
      '场景二：桌面下的余温与失声的十七秒',
      '场景四：开出地图的末班车',
    ])
    // 内容逐字不变，仅位次变化。
    expect(after[0].markdown).toBe(scenes[2].markdown)
    // 分区标题、preamble 等不受影响。
    expect(moved.sections).toHaveLength(content.sections.length)
    // 越界夹取。
    const clamped = moveBlueprintV2Scene(content, scenes[0].sceneId, 99)
    expect(getBlueprintV2Scenes(clamped)[3].title).toBe(scenes[0].title)
  })

  it('§3 contentHash：canonicalJSON（键排序）的 sha256，与 node:crypto 一致且覆盖新增原文', () => {
    const { content } = parseFixture()
    const canonicalJson = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
      }
      return JSON.stringify(value) ?? 'null'
    }
    const hashInput: Record<string, unknown> = {
        chapterTitle: content.chapterTitle,
        docPreamble: content.docPreamble,
        sections: JSON.parse(JSON.stringify(content.sections)),
    }
    if (content.chapterTitleLevel !== undefined) hashInput.chapterTitleLevel = content.chapterTitleLevel
    if (content.chapterPostamble !== undefined) hashInput.chapterPostamble = content.chapterPostamble
    const expected = createHash('sha256')
      .update(canonicalJson(hashInput))
      .digest('hex')
    expect(computeBlueprintV2ContentHash(content)).toBe(expected)
    expect(computeBlueprintV2ContentHash({ ...content, chapterPostamble: `${content.chapterPostamble ?? ''}附加原文` }))
      .not.toBe(expected)
    expect(computeBlueprintV2ContentHash({ ...content, chapterTitleLevel: (content.chapterTitleLevel ?? 3) % 3 + 1 }))
      .not.toBe(expected)
  })

  it('§8.2/§4.3 重复导入匹配：同名分镜沿用旧 scene id，新场景分配新 id，旧有新无列入移除', () => {
    const first = parseFixture().content
    const firstScenes = getBlueprintV2Scenes(first)
    // 构造“重导入文档”：删掉场景三，改名场景四，新增场景五。
    const reimported = `### 第1章｜接错的人

#### 【逐场分镜拆解】

##### 场景一：02:14的冷汗与声学隔离席

- **时空与环境**：同前。

##### 场景二：桌面下的余温与失声的十七秒

- **物证搜查**：同前。

##### 场景四：开出地图的末班车（改题）

- **对白推进**：同前。

##### 场景五：新增场次

- **新内容**：全新分镜。
`
    const second = parseChapterBlueprintMarkdown(reimported).content
    const match = matchScenesForReimport(first, second)
    expect(match.incoming.map(entry => entry.matchedSceneId)).toEqual([
      firstScenes[0].sceneId,
      firstScenes[1].sceneId,
      null,
      null,
    ])
    // “场景四：开出地图的末班车（改题）”与旧题不同 → 不匹配；旧场景四列入移除。
    expect(match.removed.map(scene => scene.title)).toEqual([
      '场景三：红灯尖鸣与接通线路',
      '场景四：开出地图的末班车',
    ])
    const applied = applyBlueprintV2Reimport(first, second, 1)
    const appliedScenes = getBlueprintV2Scenes(applied)
    expect(appliedScenes[0].sceneId).toBe(firstScenes[0].sceneId)
    expect(appliedScenes[1].sceneId).toBe(firstScenes[1].sceneId)
    expect(appliedScenes[2].sceneId).not.toBe(firstScenes[3].sceneId)
    expect(appliedScenes[3].sceneId).toBe(match.incoming[3].sceneId)
    expect(applied.chapterNumber).toBe(1)
  })

  it('ID 生成：bps- 前缀且唯一', () => {
    const a = createBlueprintV2SceneId()
    const b = createBlueprintV2SceneId()
    expect(a).toMatch(/^bps-[0-9a-f-]{36}$/u)
    expect(a).not.toBe(b)
  })
})
