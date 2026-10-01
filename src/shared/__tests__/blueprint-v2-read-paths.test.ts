import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { getBlueprintV2Scenes } from '../blueprint-v2'
import { assertNoLossOnSerialize, parseChapterBlueprintMarkdown } from '../blueprint-v2-markdown'

const source = readFileSync(
  new URL('../../../test/fixtures/blueprint-v2/chapter-01.md', import.meta.url),
  'utf8',
).replace(/\r\n/gu, '\n')

describe('blueprint v2 reading and export projections', () => {
  it('retains all seven sections, four complete scene bodies, dialogue, rules, and taboos', () => {
    const parsed = parseChapterBlueprintMarkdown(source)
    const exported = assertNoLossOnSerialize(parsed.content)
    const reimported = parseChapterBlueprintMarkdown(exported).content

    expect(reimported.sections.map(section => section.title)).toHaveLength(7)
    const scenes = getBlueprintV2Scenes(reimported)
    expect(scenes).toHaveLength(4)
    expect(scenes[0]?.markdown).toContain('**时空与环境**')
    expect(scenes[0]?.markdown).toContain('**动作与生理细节**')
    expect(scenes[1]?.markdown).toContain('**声学捕捉**')
    expect(scenes[3]?.markdown).toContain('**对白推进**')
    expect(exported).toContain('**对白推进**')
    expect(exported).toContain('周晓：')
    expect(exported).toContain('信标')
    expect(exported).toContain('石书')
    expect(exported).toContain('写作禁忌')
  })

  it('keeps unknown top-level headings and their scene-like content verbatim', () => {
    const withoutChapterTitle = source.replace(/^### 第1章｜接错的人\n\n/u, '')
    const withCustomSection = `${withoutChapterTitle}\n## 【作者补充：不可改写】\n\n保留这一整段；不要拆成旧版节拍。\n\n##### 场景式标题\n\n- 对白：原文照留。\n`
    const parsed = parseChapterBlueprintMarkdown(withCustomSection)
    const exported = assertNoLossOnSerialize(parsed.content)

    expect(exported).toBe(withCustomSection)
    expect(parseChapterBlueprintMarkdown(exported).content.sections.at(-1)).toMatchObject({
      kind: 'custom',
      title: '【作者补充：不可改写】',
      body: '\n保留这一整段；不要拆成旧版节拍。\n\n##### 场景式标题\n\n- 对白：原文照留。\n',
    })
  })
})
