import { describe, expect, it } from 'vitest'

import {
  canonicalCharacterPair,
  formatSharedRelationLabel,
  isMatchingRelationship,
  otherCharacterIdInRelationship,
  projectLegacyRelationshipsField,
  projectSharedRelationshipEdge,
  type CharacterSharedRelationship,
} from '../character-relationship'

function relationship(
  overrides: Partial<CharacterSharedRelationship> = {},
): CharacterSharedRelationship {
  return {
    id: 'rel-1',
    character1Id: 'id-a',
    character2Id: 'id-b',
    character1Name: '许渡',
    character2Name: '沈砚',
    relation: '师徒',
    description: '十年前',
    ...overrides,
  }
}

const CONTEXT = { knownNames: ['许渡', '沈砚', '苏璃'] }

describe('shared relationship identity', () => {
  it('canonicalises pairs and matches by ID in either direction', () => {
    expect(canonicalCharacterPair('id-b', 'id-a')).toEqual(['id-a', 'id-b'])
    expect(isMatchingRelationship(relationship(), 'id-b', 'id-a')).toBe(true)
    expect(isMatchingRelationship(relationship(), 'id-a', 'id-c')).toBe(false)
  })

  it('resolves the other end of a relationship by ID', () => {
    expect(otherCharacterIdInRelationship(relationship(), 'id-a')).toBe('id-b')
    expect(otherCharacterIdInRelationship(relationship(), 'id-b')).toBe('id-a')
    expect(formatSharedRelationLabel(relationship())).toBe('师徒（十年前）')
    expect(formatSharedRelationLabel(relationship({ description: '' }))).toBe('师徒')
  })

  it('projects the legacy edge from the other side display name', () => {
    expect(projectSharedRelationshipEdge(relationship(), 'id-a'))
      .toEqual({ target: '沈砚', relation: '师徒（十年前）' })
    expect(projectSharedRelationshipEdge(relationship(), 'id-b'))
      .toEqual({ target: '许渡', relation: '师徒（十年前）' })
    // 展示名缺失（人物已删除）时不猜测，交由调用方保留旧字段。
    expect(projectSharedRelationshipEdge(relationship({ character1Name: '' }), 'id-b')).toBeNull()
  })
})

describe('legacy relationships field projection', () => {
  it('never rewrites free-form legacy text', () => {
    expect(projectLegacyRelationshipsField('苏璃与沈砚有恩怨未了。', [], CONTEXT)).toBeNull()
  })

  it('writes the shared projection into an empty field and clears it when empty again', () => {
    expect(projectLegacyRelationshipsField('', [{ target: '沈砚', relation: '师徒' }], CONTEXT))
      .toBe(JSON.stringify([{ target: '沈砚', relation: '师徒' }]))
    expect(projectLegacyRelationshipsField('', [], CONTEXT)).toBeNull()
    expect(projectLegacyRelationshipsField(JSON.stringify([{ target: '沈砚', relation: '师徒' }]), [], CONTEXT))
      .toBe('')
  })

  it('keeps an unmigrated edge whose target no longer exists', () => {
    const legacy = JSON.stringify([{ target: '不存在的人', relation: '旧敌' }])
    expect(projectLegacyRelationshipsField(legacy, [], CONTEXT)).toBeNull()
    expect(projectLegacyRelationshipsField(legacy, [{ target: '沈砚', relation: '师徒' }], CONTEXT)).toBeNull()
  })

  it('keeps a conflicting legacy relation instead of overwriting it', () => {
    const legacy = JSON.stringify([{ target: '沈砚', relation: '盟友' }])
    // 同一对人物在共享关系表里已经是另一种说法 → 冲突，保留旧证据。
    expect(projectLegacyRelationshipsField(
      legacy,
      [{ target: '沈砚', relation: '师徒' }],
      CONTEXT,
    )).toBeNull()
  })

  it('rewrites when the legacy field is already a faithful projection', () => {
    const legacy = JSON.stringify([{ target: '沈砚', relation: '师徒（十年前）' }])
    expect(projectLegacyRelationshipsField(
      legacy,
      [{ target: '沈砚', relation: '师徒（十年前）' }],
      CONTEXT,
    )).toBe(legacy)
  })

  it('drops edges whose relationship was deleted but whose target still exists', () => {
    const legacy = JSON.stringify([{ target: '沈砚', relation: '师徒' }])
    expect(projectLegacyRelationshipsField(legacy, [], CONTEXT)).toBe('')
  })

  it('drops edges that point at a character deleted in this same change', () => {
    const legacy = JSON.stringify([{ target: '沈砚', relation: '师徒' }])
    expect(projectLegacyRelationshipsField(legacy, [], {
      knownNames: ['许渡', '苏璃'],
      removedNames: ['沈砚'],
    })).toBe('')
  })
})
