/**
 * 章节蓝图 v2 纯函数测试（docs/blueprint-v2-contract.md §3）。
 * sha256 纯 TS 实现与 node:crypto 交叉验证；投影遵循 §6.3；升级脚手架遵循 §7.4。
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { isCanvasIdWithPrefix } from '../canvas-ids'
import {
  BLUEPRINT_V2_SCHEMA_VERSION,
  assertValidChapterBlueprintV2Content,
  buildBlueprintV2UpgradeScaffold,
  computeBlueprintV2ContentHash,
  createBlueprintV2ItemId,
  createBlueprintV2SceneId,
  deriveV1TitleFromChapterTitle,
  extractBlueprintV2WordBudget,
  getBlueprintV2Scenes,
  moveBlueprintV2Scene,
  normalizeBlueprintV2SectionTitle,
  projectV2ToV1,
  reorderBlueprintV2Scenes,
  type BlueprintV2SectionItem,
  type ChapterBlueprintV2Content,
} from '../blueprint-v2'

const CURRENT_V1 = {
  chapterNumber: 1,
  title: '旧标题',
  role: '建置',
  purpose: '旧目的',
  keyEvents: '旧节拍',
  characters: ['许渡'],
  suspenseHook: '旧钩子',
  userGuidance: '作者手写指导',
  notes: '定稿记录',
  notesUpdatedAt: '2026-01-01 00:00:00',
}

function emptyContent(chapterNumber = 1): ChapterBlueprintV2Content {
  return {
    schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
    chapterNumber,
    chapterTitle: '',
    docPreamble: '',
    sections: [],
    origin: 'manual',
  }
}

function sceneItem(id: string, title: string): BlueprintV2SectionItem {
  return { kind: 'scene', id, level: 5, title, markdown: `- 内容：${title}\n`, presence: 'off-canvas' }
}

function contentWithStoryboard(items: BlueprintV2SectionItem[]): ChapterBlueprintV2Content {
  return {
    ...emptyContent(),
    sections: [{
      kind: 'canonical', id: 'storyboard', title: '【逐场分镜拆解】', level: 4,
      preamble: '', items, postamble: '',
    }],
  }
}

describe('ID 生成与词表', () => {
  it('分镜 ID 形如 bps-<uuid v4>，条目 ID 形如 bpc-<uuid v4>', () => {
    const sceneId = createBlueprintV2SceneId()
    const itemId = createBlueprintV2ItemId()
    expect(isCanvasIdWithPrefix('bps', sceneId)).toBe(true)
    expect(isCanvasIdWithPrefix('bpc', itemId)).toBe(true)
    expect(sceneId).not.toBe(createBlueprintV2SceneId())
  })

  it('normalizeBlueprintV2SectionTitle 去空白与【】', () => {
    expect(normalizeBlueprintV2SectionTitle('  【 逐场分镜拆解 】 ')).toBe('逐场分镜拆解')
    expect(normalizeBlueprintV2SectionTitle('逐场分镜拆解')).toBe('逐场分镜拆解')
  })

  it('章题投影标题推导（契约 §6.3）', () => {
    expect(deriveV1TitleFromChapterTitle('第1章｜接错的人', 1)).toBe('接错的人')
    expect(deriveV1TitleFromChapterTitle('第1章:接错的人', 1)).toBe('接错的人')
    expect(deriveV1TitleFromChapterTitle('第12章｜雪夜', 1)).toBe('第12章｜雪夜')
    expect(deriveV1TitleFromChapterTitle('第1章', 1)).toBe('')
    expect(deriveV1TitleFromChapterTitle('', 1)).toBe('')
  })
})

describe('getBlueprintV2Scenes / moveBlueprintV2Scene / reorderBlueprintV2Scenes', () => {
  const items: BlueprintV2SectionItem[] = [
    sceneItem('bps-1', '场景一：A'),
    { kind: 'field', id: 'bpc-1', label: '备注', markdown: '- **备注**：夹在分镜之间\n' },
    sceneItem('bps-2', '场景二：B'),
    sceneItem('bps-3', '场景三：C'),
  ]

  it('order 从 1 起稠密', () => {
    const scenes = getBlueprintV2Scenes(contentWithStoryboard(items))
    expect(scenes.map(scene => scene.sceneId)).toEqual(['bps-1', 'bps-2', 'bps-3'])
    expect(scenes.map(scene => scene.order)).toEqual([1, 2, 3])
  })

  it('移动分镜只改 scene 子序列槽位，非分镜条目原地不动', () => {
    const moved = moveBlueprintV2Scene(contentWithStoryboard(items), 'bps-1', 3)
    expect(getBlueprintV2Scenes(moved).map(scene => scene.sceneId)).toEqual(['bps-2', 'bps-3', 'bps-1'])
    const storyboard = moved.sections[0]
    expect(storyboard.kind === 'canonical' ? storyboard.items[1].kind : null).toBe('field')
  })

  it('toOrder 越界夹取；未知 id 原样返回（同一引用）', () => {
    const base = contentWithStoryboard(items)
    expect(getBlueprintV2Scenes(moveBlueprintV2Scene(base, 'bps-3', 99))
      .map(scene => scene.sceneId)).toEqual(['bps-1', 'bps-2', 'bps-3'])
    expect(moveBlueprintV2Scene(base, 'bps-404', 1)).toBe(base)
  })

  it('整批重排要求恰为现有 ID 的排列', () => {
    const reordered = reorderBlueprintV2Scenes(contentWithStoryboard(items), ['bps-3', 'bps-1', 'bps-2'])
    expect(getBlueprintV2Scenes(reordered).map(scene => scene.sceneId)).toEqual(['bps-3', 'bps-1', 'bps-2'])
    expect(() => reorderBlueprintV2Scenes(contentWithStoryboard(items), ['bps-1', 'bps-2'])).toThrow(/排列/)
    expect(() => reorderBlueprintV2Scenes(contentWithStoryboard(items), ['bps-1', 'bps-2', 'bps-2'])).toThrow(/排列/)
  })
})

describe('computeBlueprintV2ContentHash', () => {
  it('与 node:crypto 的 sha256 对 canonicalJSON 交叉一致', () => {
    const content = parseLikeContent()
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
      }
      return JSON.stringify(value) ?? 'null'
    }
    const expected = createHash('sha256').update(canonical({
      chapterTitle: content.chapterTitle,
      docPreamble: content.docPreamble,
      sections: content.sections,
    })).digest('hex')
    expect(computeBlueprintV2ContentHash(content)).toBe(expected)
    expect(computeBlueprintV2ContentHash(content)).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('内容变化 → hash 变化；键序无关', () => {
    const base = parseLikeContent()
    const reorderedSections = {
      ...base,
      sections: [...base.sections].reverse(),
    }
    expect(computeBlueprintV2ContentHash(reorderedSections)).not.toBe(computeBlueprintV2ContentHash(base))
    const withPreamble = { ...base, docPreamble: `${base.docPreamble}x` }
    expect(computeBlueprintV2ContentHash(withPreamble)).not.toBe(computeBlueprintV2ContentHash(base))
  })

  function parseLikeContent(): ChapterBlueprintV2Content {
    return {
      ...emptyContent(),
      chapterTitle: '第1章｜接错的人',
      docPreamble: '\n',
      sections: [
        {
          kind: 'canonical', id: 'positioning', title: '【本章定位与四维指标】', level: 4,
          preamble: '',
          items: [{ kind: 'field', id: 'bpc-a', label: '核心使命', markdown: '- **核心使命**：立住人物。\n' }],
          postamble: '',
        },
        { kind: 'custom', id: 'custom-abcd1234', title: '【随手记】', level: 4, body: '- 杂记。\n' },
      ],
    }
  }
})

describe('projectV2ToV1（契约 §6.3）', () => {
  it('四列投影：标题去前缀、核心使命、分镜标题行、引用行拼接', () => {
    const content: ChapterBlueprintV2Content = {
      ...emptyContent(),
      chapterTitle: '第1章｜接错的人',
      sections: [
        {
          kind: 'canonical', id: 'positioning', title: '【本章定位与四维指标】', level: 4, preamble: '',
          items: [{ kind: 'field', id: 'bpc-a', label: '核心使命', markdown: '- **核心使命**：第一屏完成生理惊醒；立住职业习惯。\n' }],
          postamble: '',
        },
        {
          kind: 'canonical', id: 'storyboard', title: '【逐场分镜拆解】', level: 4, preamble: '',
          items: [sceneItem('bps-1', '场景一：02:14的冷汗'), sceneItem('bps-2', '场景二：失声的十七秒')],
          postamble: '',
        },
        {
          kind: 'canonical', id: 'cliffhanger', title: '【章末爆点与断章定格】', level: 4, preamble: '',
          items: [{
            kind: 'field', id: 'bpc-b', label: '章末钩子',
            markdown: '- **章末钩子**：\n\n  > “我想报警。”  \n  > “我坐的末班车，好像开出地图了。”\n\n',
          }],
          postamble: '',
        },
      ],
    }
    const projection = projectV2ToV1(content, CURRENT_V1)
    expect(projection.title).toBe('接错的人')
    expect(projection.purpose).toBe('第一屏完成生理惊醒；立住职业习惯。')
    expect(projection.keyEvents).toBe('场景一：02:14的冷汗\n场景二：失声的十七秒')
    expect(projection.suspenseHook).toBe('“我想报警。”\n“我坐的末班车，好像开出地图了。”')
  })

  it('空推导保持旧值（"新字段为空不抹旧字段"）', () => {
    const projection = projectV2ToV1(emptyContent(), CURRENT_V1)
    expect(projection.title).toBe('旧标题')
    expect(projection.purpose).toBe('旧目的')
    expect(projection.keyEvents).toBe('旧节拍')
    expect(projection.suspenseHook).toBe('旧钩子')
  })

  it('字数预算抽取；无预算字段为 null', () => {
    const withBudget: ChapterBlueprintV2Content = {
      ...emptyContent(),
      sections: [{
        kind: 'canonical', id: 'positioning', title: '【本章定位与四维指标】', level: 4, preamble: '',
        items: [{ kind: 'field', id: 'bpc-a', label: '正文字数预算', markdown: '- **正文字数预算**：4,200 字。\n' }],
        postamble: '',
      }],
    }
    expect(extractBlueprintV2WordBudget(withBudget)).toBe(4200)
    expect(extractBlueprintV2WordBudget(emptyContent())).toBeNull()
  })
})

describe('assertValidChapterBlueprintV2Content（保存前防线）', () => {
  it('合法内容通过；bps- 之外的 scene id、重复 ID、越界 check、悬空画布引用被拒绝', () => {
    expect(() => assertValidChapterBlueprintV2Content(emptyContent())).not.toThrow()

    const badSceneId = contentWithStoryboard([{ ...sceneItem('bps-1', '场景一'), id: 'scene-1' }])
    expect(() => assertValidChapterBlueprintV2Content(badSceneId)).toThrow(/bps-/)

    const duplicate = contentWithStoryboard([
      sceneItem('bps-11111111-1111-4111-8111-111111111111', '场景一'),
      sceneItem('bps-11111111-1111-4111-8111-111111111111', '场景二'),
    ])
    expect(() => assertValidChapterBlueprintV2Content(duplicate)).toThrow(/重复/)

    const strayCheck: ChapterBlueprintV2Content = {
      ...emptyContent(),
      sections: [{
        kind: 'canonical', id: 'storyboard', title: '【逐场分镜拆解】', level: 4, preamble: '',
        items: [{ kind: 'bullet', id: 'bpc-1', label: null, markdown: '- x\n', check: { mode: 'must', source: 'inferred' } }],
        postamble: '',
      }],
    }
    expect(() => assertValidChapterBlueprintV2Content(strayCheck)).toThrow(/伏笔\/禁忌/)

    const dangling = contentWithStoryboard([{
      kind: 'scene', id: 'bps-22222222-2222-4222-8222-222222222222', level: 5,
      title: '场景一', markdown: '', presence: 'off-canvas', canvasNodeId: 'ccn-1',
    }])
    expect(() => assertValidChapterBlueprintV2Content(dangling)).toThrow(/画布节点/)

    const oversized = contentWithStoryboard([sceneItem('bps-33333333-3333-4333-8333-333333333333', 'x'.repeat(161))])
    expect(() => assertValidChapterBlueprintV2Content(oversized)).toThrow(/超限/)

    expect(() => assertValidChapterBlueprintV2Content({ ...emptyContent(), schemaVersion: 3 as unknown as 2 }))
      .toThrow(/schema 版本/)
    expect(() => assertValidChapterBlueprintV2Content({ ...emptyContent(), chapterNumber: 0 })).toThrow(/章节号/)
  })
})

describe('buildBlueprintV2UpgradeScaffold（契约 §7.4）', () => {
  it('章题/核心使命/番茄钩子来自 v1；storyboard 留空；旧字段进 custom 存档', () => {
    const scaffold = buildBlueprintV2UpgradeScaffold(CURRENT_V1)
    expect(scaffold.origin).toBe('upgrade')
    expect(scaffold.chapterTitle).toBe('第1章｜旧标题')
    expect(scaffold.chapterTitleLevel).toBe(3)
    const positioning = scaffold.sections.find(section => section.kind === 'canonical' && section.id === 'positioning')
    expect(positioning && positioning.kind === 'canonical'
      ? positioning.items.map(item => item.kind === 'field' ? item.label : '') : []).toEqual(['核心使命', '番茄追读钩子'])
    const storyboard = scaffold.sections.find(section => section.kind === 'canonical' && section.id === 'storyboard')
    expect(storyboard && storyboard.kind === 'canonical' ? storyboard.items : []).toEqual([])
    const archive = scaffold.sections.find(section => section.kind === 'custom')
    expect(archive && archive.kind === 'custom' ? archive.body : '').toContain('- **章节定位（role）**：建置')
    expect(archive && archive.kind === 'custom' ? archive.body : '').toContain('- **出场角色（characters）**：许渡')
    expect(archive && archive.kind === 'custom' ? archive.body : '').toContain('- **作者微操指导（userGuidance）**：作者手写指导')
    expect(() => assertValidChapterBlueprintV2Content(scaffold)).not.toThrow()
  })
})
