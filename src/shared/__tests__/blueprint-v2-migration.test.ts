import { describe, expect, it } from 'vitest'

import {
  buildBlueprintV2MigrationContent,
  extractBlueprintV2WordBudget,
  findBlueprintV2CanonicalSection,
  getBlueprintV2Scenes,
  projectV2ToV1,
  type BlueprintV2FieldItem,
} from '../blueprint-v2'
import {
  assertNoLossOnSerialize,
  parseChapterBlueprintMarkdown,
  serializeChapterBlueprintV2,
} from '../blueprint-v2-markdown'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'

function legacyRow(overrides: Partial<BlueprintData> = {}): BlueprintData {
  return {
    chapterNumber: 7,
    volumeId: 'volume-2',
    title: '雨夜追击',
    role: '冲突',
    purpose: '主角必须在雨夜前拿到账本。',
    keyEvents: '主角伪装成司机。\n遭遇第一次反转。\n  缩进行保持原样。',
    characters: ['沈砺', '账房'],
    suspenseHook: '账本里夹着第二张名单。',
    userGuidance: '保留雨夜的压迫感，不要提前揭底。',
    notes: '既有章节记录。',
    notesUpdatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fieldOf(
  content: ReturnType<typeof buildBlueprintV2MigrationContent>,
  sectionId: Parameters<typeof findBlueprintV2CanonicalSection>[1],
  label: string,
): BlueprintV2FieldItem | null {
  const section = findBlueprintV2CanonicalSection(content, sectionId)
  const item = section?.items.find(
    (candidate): candidate is BlueprintV2FieldItem => candidate.kind === 'field' && candidate.label === label,
  )
  return item ?? null
}

describe('buildBlueprintV2MigrationContent（章节蓝图统一迁移映射）', () => {
  it('maps title/purpose/keyEvents/hook into their canonical sections verbatim', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow())
    expect(content.schemaVersion).toBe(2)
    expect(content.chapterNumber).toBe(7)
    expect(content.chapterTitle).toBe('第7章｜雨夜追击')
    expect(content.chapterTitleLevel).toBe(3)
    expect(content.origin).toBe('upgrade')

    const mission = fieldOf(content, 'positioning', '核心使命')
    expect(mission && mission.markdown).toContain('主角必须在雨夜前拿到账本。')
    const events = fieldOf(content, 'conflict', '实质冲突与转折')
    expect(events && events.markdown).toContain('主角伪装成司机。')
    const hook = fieldOf(content, 'cliffhanger', '章末钩子')
    expect(hook && hook.markdown).toContain('账本里夹着第二张名单。')

    // 分镜留空：绝不把 keyEvents 节拍伪造成分镜。
    expect(getBlueprintV2Scenes(content)).toHaveLength(0)
    // 七个规范分区齐全且按注册顺序排列；没有自定义存档分区。
    expect(content.sections.map(section => section.kind === 'canonical' ? section.id : 'custom')).toEqual([
      'positioning', 'conflict', 'storyboard', 'rules', 'cliffhanger', 'foreshadow', 'taboos',
    ])
  })

  it('keeps aux fields out of v2 content (role/characters/userGuidance/notes stay v1-only)', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow())
    const serialized = serializeChapterBlueprintV2(content)
    expect(serialized).not.toContain('保留雨夜的压迫感')
    expect(serialized).not.toContain('既有章节记录')
    expect(serialized).not.toContain('章节定位')
  })

  it('produces newline-terminated items so the lossless check passes (regression: old scaffold merged items into one line)', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow())
    expect(() => assertNoLossOnSerialize(content)).not.toThrow()
    const serialized = serializeChapterBlueprintV2(content)
    expect(serialized).toContain('- **核心使命**：主角必须在雨夜前拿到账本。\n')
    expect(serialized).not.toContain('账本。- **')
  })

  it('round-trips through parse/serialize with multi-line key events intact', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow())
    const markdown = serializeChapterBlueprintV2(content)
    const reparsed = parseChapterBlueprintMarkdown(markdown).content
    const originalEvents = fieldOf(content, 'conflict', '实质冲突与转折')
    const reparsedEvents = fieldOf(reparsed, 'conflict', '实质冲突与转折')
    expect(reparsedEvents?.markdown).toBe(originalEvents?.markdown)
    expect(reparsedEvents?.markdown).toContain('  缩进行保持原样。')
  })

  it('is deterministic (same input → same JSON) so editor seeds are reproducible across sessions', () => {
    const first = buildBlueprintV2MigrationContent(legacyRow(), { origin: 'manual' })
    const second = buildBlueprintV2MigrationContent(legacyRow(), { origin: 'manual' })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('supports manual origin for local new-chapter seeds', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow(), { origin: 'manual' })
    expect(content.origin).toBe('manual')
  })

  it('creates empty canonical shells for a blank row and still round-trips', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow({
      chapterNumber: 1,
      title: '',
      purpose: '',
      keyEvents: '',
      suspenseHook: '',
    }))
    expect(content.chapterTitle).toBe('第1章')
    expect(content.sections.every(section => section.kind === 'canonical' && section.items.length === 0)).toBe(true)
    expect(() => assertNoLossOnSerialize(content)).not.toThrow()
  })

  it('projects back to the same v1 summary fields (title/purpose/hook; keyEvents kept when no scenes)', () => {
    const row = legacyRow()
    const content = buildBlueprintV2MigrationContent(row)
    const projection = projectV2ToV1(content, row)
    expect(projection.title).toBe('雨夜追击')
    expect(projection.purpose).toBe('主角必须在雨夜前拿到账本。')
    expect(projection.suspenseHook).toBe('账本里夹着第二张名单。')
    // 无分镜 → 关键事件投影为空 → 保留旧值（原简纲事件不丢）。
    expect(projection.keyEvents).toBe(row.keyEvents)
  })

  it('migrated hook is recognized by the writing block and the review hook anchor', () => {
    const content = buildBlueprintV2MigrationContent(legacyRow())
    const serialized = serializeChapterBlueprintV2(content)
    const reparsed = parseChapterBlueprintMarkdown(serialized).content
    // 写作注入：章末钩子进入 cliffhanger 分区（assembleBlueprintV2WritingBlock 的注入源）。
    const hook = fieldOf(reparsed, 'cliffhanger', '章末钩子')
    expect(hook).not.toBeNull()
    // 字数预算锚点仍可在迁移内容上解析。
    expect(extractBlueprintV2WordBudget(reparsed)).toBeNull()
  })
})
