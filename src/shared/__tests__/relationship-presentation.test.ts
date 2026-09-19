import { describe, expect, it } from 'vitest'

import {
  classifyRelationshipStorage,
  formatRelationshipsForEditor,
  parseRelationshipEdges,
  relationshipRepairGuidance,
  relationshipStorageFromEditor,
  relationshipStorageFromRows,
  structuredRelationshipRows,
} from '../relationship-presentation'

describe('relationship presentation', () => {
  it('renders legacy structured relationships as natural-language editor lines', () => {
    const persisted = JSON.stringify([
      {
        target: '陆云飞',
        relation: '关系类型：竞争对手；矛盾张力：权力斗争；情感连接：无',
      },
    ])

    expect(formatRelationshipsForEditor(persisted)).toBe(
      '陆云飞：竞争对手（权力斗争；情感连接：无）',
    )
  })

  it('stores unambiguous natural-language editor lines as graph-readable edges', () => {
    const stored = relationshipStorageFromEditor(
      '陆云飞：竞争对手（权力斗争）\n苏璃：盟友',
      { knownNames: ['沈砺', '陆云飞', '苏璃'], selfName: '沈砺' },
    )

    expect(JSON.parse(stored)).toEqual([
      { target: '陆云飞', relation: '竞争对手（权力斗争）' },
      { target: '苏璃', relation: '盟友' },
    ])
    expect(parseRelationshipEdges(stored, {
      knownNames: ['沈砺', '陆云飞', '苏璃'],
      selfName: '沈砺',
    })).toEqual([
      { target: '陆云飞', relation: '竞争对手（权力斗争）' },
      { target: '苏璃', relation: '盟友' },
    ])
  })

  it('keeps untouched detail fields from legacy structured data while another relation is edited', () => {
    const previousStorage = JSON.stringify([
      {
        target: '陆云飞',
        relation: '关系类型：竞争对手；矛盾张力：权力斗争；情感连接：无',
      },
    ])

    const stored = relationshipStorageFromEditor(
      '陆云飞：竞争对手（权力斗争；情感连接：无）\n苏璃：盟友',
      {
        knownNames: ['沈砺', '陆云飞', '苏璃'],
        selfName: '沈砺',
        previousStorage,
      },
    )

    expect(JSON.parse(stored)).toEqual([
      {
        target: '陆云飞',
        relation: '关系类型：竞争对手；矛盾张力：权力斗争；情感连接：无',
      },
      { target: '苏璃', relation: '盟友' },
    ])
  })

  it('preserves unknown free-form notes byte-for-byte instead of guessing at structure', () => {
    const note = '陆云飞与沈砺表面合作，实际彼此试探。'

    expect(relationshipStorageFromEditor(note, {
      knownNames: ['沈砺', '陆云飞'],
      selfName: '沈砺',
    })).toBe(note)
    expect(formatRelationshipsForEditor(note)).toBe(note)
  })

  it.each([
    '[{"participant":"陆云飞","status":"待确认"}]',
    '{"participant":"陆云飞","status":"待确认"}',
    '[{"target":"陆云飞"}]',
  ])('hides unknown JSON from the editor and never turns it into graph edges', (unknownJson) => {
    const displayed = formatRelationshipsForEditor(unknownJson)
    const englishDisplayed = formatRelationshipsForEditor(unknownJson, { locale: 'en-US' })
    const options = {
      knownNames: ['沈砺', '陆云飞'],
      selfName: '沈砺',
    }

    expect(displayed).not.toBe(unknownJson)
    expect(displayed).not.toContain('[{')
    expect(displayed).not.toContain('{"participant"')
    expect(displayed).toBe('关系数据格式无法识别。请按“角色：关系”逐行重写。')
    expect(englishDisplayed).toBe(
      'Relationship data format is unrecognized. Rewrite one relationship per line as “Character: relationship”.',
    )
    expect(parseRelationshipEdges(unknownJson, options)).toEqual([])
    // 展示层不自动改写持久化数据；用户主动编辑前保留原有值。
    expect(relationshipStorageFromEditor(unknownJson, options)).toBe(unknownJson)
  })
})

describe('relationship storage classification', () => {
  it('separates blank, structured and legacy storage without rewriting any of them', () => {
    expect(classifyRelationshipStorage('')).toBe('empty')
    expect(classifyRelationshipStorage('   ')).toBe('empty')
    expect(classifyRelationshipStorage('[]')).toBe('structured')
    expect(classifyRelationshipStorage(JSON.stringify([{ target: '陆云飞', relation: '盟友' }])))
      .toBe('structured')
    expect(classifyRelationshipStorage('陆云飞：盟友')).toBe('legacy')
    expect(classifyRelationshipStorage('[{"participant":"陆云飞"}]')).toBe('legacy')
  })

  it('returns structured rows only for data the roster seam can persist', () => {
    expect(structuredRelationshipRows('[]')).toEqual([])
    expect(structuredRelationshipRows(JSON.stringify([
      { target: '陆云飞', relation: '盟友' },
    ]))).toEqual([{ target: '陆云飞', relation: '盟友' }])
    expect(structuredRelationshipRows('陆云飞：盟友')).toBeNull()
    expect(structuredRelationshipRows('[{"target":"陆云飞"}]')).toBeNull()
  })

  it('serializes editor rows into the canonical structured shape and back to empty', () => {
    expect(relationshipStorageFromRows([
      { target: ' 陆云飞 ', relation: ' 盟友 ' },
      { target: '苏璃', relation: '师徒' },
    ])).toBe(JSON.stringify([
      { target: '陆云飞', relation: '盟友' },
      { target: '苏璃', relation: '师徒' },
    ]))
    // 删除最后一条关系后必须回到空字符串，而不是留下一个空的 JSON 数组。
    expect(relationshipStorageFromRows([])).toBe('')
    expect(relationshipStorageFromRows([{ target: '', relation: '' }])).toBe('')
  })

  it('exposes the localized repair guidance used next to legacy text', () => {
    expect(relationshipRepairGuidance()).toBe('关系数据格式无法识别。请按“角色：关系”逐行重写。')
    expect(relationshipRepairGuidance('en-US')).toBe(
      'Relationship data format is unrecognized. Rewrite one relationship per line as “Character: relationship”.',
    )
  })
})
