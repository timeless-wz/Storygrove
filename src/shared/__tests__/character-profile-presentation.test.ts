import { describe, expect, it } from 'vitest'

import {
  CHARACTER_STATE_FIELD_LABELS,
  characterProfileDetailSections,
  characterProfileSummaryFacts,
  characterRelationshipPresentation,
  characterStateProvenanceKind,
  persistableRelationshipEdges,
  selectCharacterStateSummary,
  truncateProfileText,
  validateCharacterRelationshipRows,
} from '../character-profile-presentation'
import type { CharacterRosterCharacterState } from '../character-roster'

function state(overrides: Partial<CharacterRosterCharacterState> = {}): CharacterRosterCharacterState {
  return {
    location: '', powerLevel: '', physicalState: '', mentalState: '',
    keyItems: '', recentEvents: '', updatedAtChapter: 0,
    ...overrides,
  }
}

describe('character profile summary facts', () => {
  it('only reports facts the card actually carries and never invents a faction field', () => {
    expect(characterProfileSummaryFacts({ role: 'protagonist', gender: '男', age: '二十一' })).toEqual({
      role: 'protagonist',
      facts: [
        { id: 'gender', value: '男' },
        { id: 'age', value: '二十一' },
      ],
    })

    expect(characterProfileSummaryFacts({ role: 'minor', gender: '  ', age: '' })).toEqual({
      role: 'minor',
      facts: [],
    })
  })
})

describe('character state summary for list views', () => {
  it('prefers where the character is and what just happened over a chapter counter', () => {
    expect(selectCharacterStateSummary(state({
      location: '青云城',
      powerLevel: '筑基三层',
      recentEvents: '与陆云飞决裂',
    }))).toEqual({ field: 'location', value: '青云城' })

    expect(selectCharacterStateSummary(state({
      recentEvents: '与陆云飞决裂',
      mentalState: '动摇',
    }))).toEqual({ field: 'recentEvents', value: '与陆云飞决裂' })
  })

  it('ignores blank values and reports nothing when no state was recorded', () => {
    expect(selectCharacterStateSummary(state({ location: '   ', mentalState: '警惕' })))
      .toEqual({ field: 'mentalState', value: '警惕' })
    expect(selectCharacterStateSummary(state())).toBeNull()
    expect(selectCharacterStateSummary(undefined)).toBeNull()
  })

  it('keeps a short, single-line preview of a long state value', () => {
    expect(truncateProfileText('第一行\n第二行', 40)).toBe('第一行 第二行')
    expect(truncateProfileText('青云城'.repeat(20), 6)).toBe('青云城青云城…')
  })

  it('labels every state field for overview, list and form surfaces', () => {
    expect(Object.keys(CHARACTER_STATE_FIELD_LABELS)).toEqual([
      'location', 'powerLevel', 'physicalState', 'mentalState', 'keyItems', 'recentEvents',
    ])
    expect(CHARACTER_STATE_FIELD_LABELS.location.shortZhCN).toBe('位置')
    expect(characterStateProvenanceKind(undefined)).toBe('unknown')
    expect(characterStateProvenanceKind({ kind: 'derived', source: {} as never })).toBe('derived')
  })
})

describe('character profile detail sections', () => {
  it('keeps the collapsed sections in the documented priority order', () => {
    const sections = characterProfileDetailSections({
      appearance: '一袭青衫',
      abilities: '',
      background: '南渡遗孤',
      arc: '',
      notes: '',
    })

    expect(sections.map(section => section.id)).toEqual([
      'appearance', 'abilities', 'background', 'arc', 'notes',
    ])
    expect(sections[0]).toEqual({ id: 'appearance', value: '一袭青衫' })
    expect(sections[1]).toEqual({ id: 'abilities', value: '' })
  })
})

describe('character relationship presentation', () => {
  it('projects structured relationships as target and relation groups', () => {
    const presentation = characterRelationshipPresentation(
      JSON.stringify([
        { target: '陆云飞', relation: '竞争对手' },
        { target: '陆云飞', relation: '旧识' },
        { target: '苏璃', relation: '盟友' },
      ]),
      { knownNames: ['沈砺', '陆云飞', '苏璃'], selfName: '沈砺' },
    )

    expect(presentation).toEqual({
      kind: 'structured',
      groups: [
        { target: '陆云飞', relations: ['竞争对手', '旧识'], resolvable: true },
        { target: '苏璃', relations: ['盟友'], resolvable: true },
      ],
    })
  })

  it('marks targets that are no longer in the roster instead of dropping them', () => {
    const presentation = characterRelationshipPresentation(
      JSON.stringify([
        { target: '已删除的人', relation: '旧敌' },
        { target: '沈砺', relation: '自己' },
      ]),
      { knownNames: ['沈砺'], selfName: '沈砺' },
    )

    expect(presentation).toEqual({
      kind: 'structured',
      groups: [
        { target: '已删除的人', relations: ['旧敌'], resolvable: false },
        { target: '沈砺', relations: ['自己'], resolvable: false },
      ],
    })
  })

  it('returns free-form legacy notes verbatim instead of guessing at structure', () => {
    const note = '陆云飞与沈砺表面合作，实际彼此试探。\n第二行  保留空格'
    expect(characterRelationshipPresentation(note)).toEqual({ kind: 'legacy', text: note })
  })

  it('returns unrecognised JSON verbatim so no legacy evidence is silently dropped', () => {
    const unknownJson = '[{"participant":"陆云飞","status":"待确认"}]'
    expect(characterRelationshipPresentation(unknownJson)).toEqual({
      kind: 'legacy',
      text: unknownJson,
    })
    expect(characterRelationshipPresentation('{"participant":"陆云飞"}')).toEqual({
      kind: 'legacy',
      text: '{"participant":"陆云飞"}',
    })
  })

  it('reports an empty projection for blank storage and for an empty structured list', () => {
    expect(characterRelationshipPresentation('')).toEqual({ kind: 'empty' })
    expect(characterRelationshipPresentation('   ')).toEqual({ kind: 'empty' })
    expect(characterRelationshipPresentation('[]')).toEqual({ kind: 'empty' })
  })

  it('treats every target as unresolvable when the caller knows an empty roster', () => {
    const presentation = characterRelationshipPresentation(
      JSON.stringify([{ target: '陆云飞', relation: '盟友' }]),
      { knownNames: [], selfName: '沈砺' },
    )

    expect(presentation).toEqual({
      kind: 'structured',
      groups: [{ target: '陆云飞', relations: ['盟友'], resolvable: false }],
    })
  })
})

describe('relationship row validation', () => {
  it('flags rows the roster transaction would reject', () => {
    const validations = validateCharacterRelationshipRows([
      { target: '', relation: '' },
      { target: '陆云飞', relation: '' },
      { target: '', relation: '盟友' },
      { target: '沈砺', relation: '自己' },
      { target: '陆云飞', relation: '盟友' },
      { target: '陆云飞', relation: '盟友' },
    ], { selfName: '沈砺' })

    expect(validations.map(validation => validation.issues)).toEqual([
      ['missingTarget', 'missingRelation'],
      ['missingRelation'],
      ['missingTarget'],
      ['selfTarget'],
      [],
      ['duplicate'],
    ])
    expect(validations.map(validation => validation.persistable)).toEqual([
      false, false, false, false, true, false,
    ])
  })

  it('persists only complete rows and trims them, keeping unresolvable targets', () => {
    expect(persistableRelationshipEdges([
      { target: ' 陆云飞 ', relation: ' 竞争对手 ' },
      { target: '陆云飞', relation: '' },
      { target: '', relation: '' },
      { target: '旧人', relation: '旧敌' },
    ], { selfName: '沈砺' })).toEqual([
      { target: '陆云飞', relation: '竞争对手' },
      // 目标已不在名单中的旧关系必须保留，静默丢弃才是数据丢失。
      { target: '旧人', relation: '旧敌' },
    ])
  })
})
