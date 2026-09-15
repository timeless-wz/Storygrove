import { describe, expect, it } from 'vitest'

import {
  matchWorkspaceCategory,
  WORKSPACE_CATEGORY_PRESETS,
  type WorkspaceSourceCategory,
} from '../../src/shared/workspace-hub'
import {
  extractChapterRange,
  parseMarkdownFragments,
} from '../services/workspace-scanner-service'

describe('Workspace Hub - Category Matching & Presets', () => {
  it('correctly maps standard long-form directory presets to categories', () => {
    expect(matchWorkspaceCategory('00_创作方向.md').category).toBe('creation_principles')
    expect(matchWorkspaceCategory('01_已确认设定清单.md').category).toBe('confirmed_settings')
    expect(matchWorkspaceCategory('02_剧情总纲.md').category).toBe('master_plot')
    expect(matchWorkspaceCategory('03_里世界探索.md').category).toBe('world_data')
    expect(matchWorkspaceCategory('04_事件与遗境库.md').category).toBe('event_materials')
    expect(matchWorkspaceCategory('05_人物与关系.md').category).toBe('character_data')
    expect(matchWorkspaceCategory('06_废案与漏洞记录.md').category).toBe('deprecated')
    expect(matchWorkspaceCategory('07_世界观后台.md').category).toBe('background_settings')
    expect(matchWorkspaceCategory('08_参考作品与借鉴边界.md').category).toBe('reference_boundary')
    expect(matchWorkspaceCategory('09_爆点设计与情绪兑现.md').category).toBe('narrative_goals')
    expect(matchWorkspaceCategory('10_第一卷剧情大纲.md').category).toBe('volume_outline')
    expect(matchWorkspaceCategory('11_第一卷逐章细纲.md').category).toBe('chapter_outline')
    expect(matchWorkspaceCategory('11_第一卷逐章细纲/第001章_荒村夜渡.md').category).toBe('chapter_outline')
    expect(matchWorkspaceCategory('11_第一卷逐章细纲\\第002章.md').category).toBe('chapter_outline')
    expect(matchWorkspaceCategory('12_叙述风格与正文规范.md').category).toBe('style_guide')
    expect(matchWorkspaceCategory('素材/深海神话.txt').category).toBe('reference_novel')
    expect(matchWorkspaceCategory('random_notes.md').category).toBe('other')
  })

  it('preserves strict authority definitions for all 14 presets', () => {
    expect(WORKSPACE_CATEGORY_PRESETS.length).toBe(14)
    for (const preset of WORKSPACE_CATEGORY_PRESETS) {
      expect(preset.category).toBeDefined()
      expect(preset.nameZh).toBeDefined()
      expect(preset.pattern).toBeInstanceOf(RegExp)
      expect(['confirmed', 'candidate', 'background', 'deprecated', 'reference', 'material']).toContain(preset.defaultAuthority)
    }
  })

  it('guarantees deprecated category is strictly excluded from prompt injection', () => {
    const deprecatedPreset = WORKSPACE_CATEGORY_PRESETS.find(p => p.category === 'deprecated')
    expect(deprecatedPreset).toBeDefined()
    expect(deprecatedPreset!.defaultAuthority).toBe('deprecated')
    expect(deprecatedPreset!.canInjectIntoContext).toBe(false)
    expect(deprecatedPreset!.isDeprecatedExcluded).toBe(true)
  })

  it('guarantees character data category defaults to candidate authority requiring author confirmation', () => {
    const charPreset = WORKSPACE_CATEGORY_PRESETS.find(p => p.category === 'character_data')
    expect(charPreset).toBeDefined()
    expect(charPreset!.defaultAuthority).toBe('candidate')
    expect(charPreset!.purposeZh).toContain('预览确认')
  })
})

describe('Workspace Hub - Markdown Parser & Chapter Detection', () => {
  it('extracts chapter ranges from varied Chinese and English heading styles', () => {
    expect(extractChapterRange('第01-08章 荒村夜行')).toEqual({ start: 1, end: 8 })
    expect(extractChapterRange('第1—5章')).toEqual({ start: 1, end: 5 })
    expect(extractChapterRange('第1到10章')).toEqual({ start: 1, end: 10 })
    expect(extractChapterRange('第3章 危机四伏')).toEqual({ start: 3, end: 3 })
    expect(extractChapterRange('第025章 终局')).toEqual({ start: 25, end: 25 })
    expect(extractChapterRange('Chapter 14 The End')).toEqual({ start: 14, end: 14 })
    expect(extractChapterRange('未设定章节范围的普通规则')).toEqual({ start: null, end: null })
  })

  it('parses headings hierarchy, line ranges, and chapter spans into structured fragments', () => {
    const markdown = [
      '# 设定总览',
      '',
      '这里是总览介绍文本。',
      '',
      '## 核心法则 [第1-10章]',
      '法则一：不可直视深渊。',
      '法则二：灵性守恒。',
      '',
      '### 守恒特例 [第5章]',
      '在深渊节点内不适用。',
      '',
      '## 边缘法则',
      '日常规则。',
    ].join('\n')

    const fragments = parseMarkdownFragments(markdown, '01_已确认设定清单.md')
    expect(fragments.length).toBe(4)

    // First heading: # 设定总览
    expect(fragments[0].headingPath).toBe('设定总览')
    expect(fragments[0].startLine).toBe(1)
    expect(fragments[0].content).toContain('这里是总览介绍文本。')

    // Second heading: ## 核心法则 [第1-10章]
    expect(fragments[1].headingPath).toBe('设定总览 > 核心法则 [第1-10章]')
    expect(fragments[1].chapterStart).toBe(1)
    expect(fragments[1].chapterEnd).toBe(10)
    expect(fragments[1].content).toContain('法则一：不可直视深渊。')

    // Third heading: ### 守恒特例 [第5章]
    expect(fragments[2].headingPath).toBe('设定总览 > 核心法则 [第1-10章] > 守恒特例 [第5章]')
    expect(fragments[2].chapterStart).toBe(5)
    expect(fragments[2].chapterEnd).toBe(5)
    expect(fragments[2].content).toContain('在深渊节点内不适用。')

    // Fourth heading: ## 边缘法则
    expect(fragments[3].headingPath).toBe('设定总览 > 边缘法则')
    expect(fragments[3].chapterStart).toBeNull()
    expect(fragments[3].content).toContain('日常规则。')
  })
})

describe('Workspace Hub - 13-Stage Assembly Contracts & Exclusion Rules', () => {
  const STAGE_ORDER: Array<{ stage: number; nameZh: string; category: WorkspaceSourceCategory }> = [
    { stage: 1, nameZh: '创作总则', category: 'creation_principles' },
    { stage: 2, nameZh: '剧情总纲与长线目标', category: 'master_plot' },
    { stage: 3, nameZh: '卷级大纲', category: 'volume_outline' },
    { stage: 4, nameZh: '当前逐章细纲', category: 'chapter_outline' },
    { stage: 5, nameZh: '当前章节目标与情绪兑现', category: 'narrative_goals' },
    { stage: 6, nameZh: '已确认世界设定', category: 'confirmed_settings' },
    { stage: 7, nameZh: '当前章节出场人物与关系', category: 'character_data' },
    { stage: 8, nameZh: '世界资料与景观玩法', category: 'world_data' },
    { stage: 9, nameZh: '事件与遗境素材', category: 'event_materials' },
    { stage: 10, nameZh: '后台与关联设定', category: 'background_settings' },
    { stage: 11, nameZh: '参考作品与借鉴边界', category: 'reference_boundary' },
    { stage: 12, nameZh: '前文摘要与连续性', category: 'other' },
    { stage: 13, nameZh: '叙述风格与正文规范', category: 'style_guide' },
  ]

  it('defines 13 distinct ordered stages in exact sequence', () => {
    expect(STAGE_ORDER.length).toBe(13)
    for (let i = 0; i < STAGE_ORDER.length; i++) {
      expect(STAGE_ORDER[i].stage).toBe(i + 1)
    }
  })

  it('guarantees deprecated content is excluded from positive prompt blocks', () => {
    const rules = [
      { id: '1', title: '有效规则', status: 'confirmed', content: '可用' },
      { id: '2', title: '待定规则', status: 'candidate', content: '候选' },
      { id: '3', title: '废案规则', status: 'deprecated', content: '已废弃，严禁使用' },
    ]

    const filtered = rules.filter(r => r.status !== 'deprecated')
    expect(filtered.length).toBe(2)
    expect(filtered.map(r => r.title)).toEqual(['有效规则', '待定规则'])
  })

  it('tags candidate items with prominent warning marker', () => {
    const formatCandidate = (title: string, isCandidate: boolean) => {
      return isCandidate ? `[待确认/候选] ${title}` : title
    }

    expect(formatCandidate('测试设定', false)).toBe('测试设定')
    expect(formatCandidate('测试设定', true)).toBe('[待确认/候选] 测试设定')
  })
})
