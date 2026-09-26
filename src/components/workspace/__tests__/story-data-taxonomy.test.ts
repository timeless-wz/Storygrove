import { describe, expect, it } from 'vitest'
import {
  STORY_ENTITY_GROUPS,
  STORY_ENTITY_LABELS,
  checkFactSourceSnapshot,
  matchesStoryQuery,
  needsSnapshotReview,
  payloadFieldsFor,
  splitFactsByStatus,
} from '../story-data-taxonomy'
import type { StoryFact, StoryProvenance } from '../../../shared/story-domain'
import type { WorkspaceSource } from '../../../shared/workspace-hub'

const provenance: StoryProvenance = {
  sourceId: 'source-1',
  sourceSnapshotId: 'snapshot-approved',
  sourceFragmentId: 'fragment-1',
  sourceFile: '01_已确认设定清单.md',
  sourceHeadingPath: '规则 / 力量体系',
  startLine: 10,
  endLine: 20,
  contentHash: 'hash-1',
}

function fact(overrides: Partial<StoryFact>): StoryFact {
  return {
    factId: 'fact-1',
    projectId: 'main',
    entityType: 'world_rule',
    canonicalName: '灵力上限',
    summary: '每人灵力上限固定',
    payload: {},
    status: 'confirmed',
    confidence: 0.9,
    revision: 1,
    provenance,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function source(overrides: Partial<WorkspaceSource>): WorkspaceSource {
  return {
    id: 'source-1',
    projectId: 'main',
    absolutePath: 'C:\\novel\\01_已确认设定清单.md',
    relativePath: '01_已确认设定清单.md',
    category: 'confirmed_settings',
    authorityStatus: 'confirmed',
    contentHash: 'hash-1',
    mtime: 0,
    lastScannedAt: '',
    importStatus: 'imported',
    isMissing: false,
    isDisabled: false,
    ...overrides,
  }
}

describe('story data authority boundaries', () => {
  it('keeps confirmed, candidate, and deprecated records in separate buckets', () => {
    const buckets = splitFactsByStatus([
      fact({ factId: 'a', status: 'confirmed' }),
      fact({ factId: 'b', status: 'candidate' }),
      fact({ factId: 'c', status: 'deprecated' }),
      fact({ factId: 'd', status: 'confirmed' }),
    ])

    expect(buckets.confirmed.map(item => item.factId)).toEqual(['a', 'd'])
    expect(buckets.candidate.map(item => item.factId)).toEqual(['b'])
    expect(buckets.deprecated.map(item => item.factId)).toEqual(['c'])
    // 三个桶互不相交：任何一次 split 都不会把废止内容混进正式事实。
    const total = buckets.confirmed.length + buckets.candidate.length + buckets.deprecated.length
    expect(total).toBe(4)
  })

  it('covers every entity type in exactly one category group', () => {
    const grouped = STORY_ENTITY_GROUPS.flatMap(group => [...group.entityTypes])
    expect([...grouped].sort()).toEqual([...Object.keys(STORY_ENTITY_LABELS)].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('only offers structured payload fields for the types that define them', () => {
    expect(payloadFieldsFor('character').map(field => field.key)).toContain('role')
    expect(payloadFieldsFor('timeline_event').map(field => field.key)).toContain('chapterNumber')
    expect(payloadFieldsFor('foreshadowing').map(field => field.key)).toEqual(['recoveryStatus'])
    expect(payloadFieldsFor('world_rule')).toEqual([])
  })

  it('searches names, summaries and scalar payload values only', () => {
    const record = fact({
      canonicalName: '雾港',
      summary: '北方港城',
      payload: { nested: { secret: '不该被检索' }, note: '港口常年大雾' },
    })

    expect(matchesStoryQuery(record, '雾港')).toBe(true)
    expect(matchesStoryQuery(record, '港口常年大雾')).toBe(true)
    expect(matchesStoryQuery(record, '')).toBe(true)
    expect(matchesStoryQuery(record, '不该被检索')).toBe(false)
  })
})

describe('fact provenance vs approved source snapshot', () => {
  it('reports a match only when the approved snapshot is the cited one', () => {
    const check = checkFactSourceSnapshot(fact({}), [source({ approvedSnapshotId: 'snapshot-approved' })])

    expect(check.verdict).toBe('matched')
    expect(needsSnapshotReview(check)).toBe(false)
  })

  it('reports a change when the source has a newer approved snapshot', () => {
    const check = checkFactSourceSnapshot(fact({}), [source({ approvedSnapshotId: 'snapshot-newer' })])

    expect(check.verdict).toBe('changed')
    expect(check.approvedSnapshotId).toBe('snapshot-newer')
    expect(needsSnapshotReview(check)).toBe(true)
  })

  it('treats a source without an approved snapshot as unapproved, not as confirmed', () => {
    const check = checkFactSourceSnapshot(fact({}), [source({ approvedSnapshotId: undefined })])

    expect(check.verdict).toBe('unapproved')
    expect(check.approvedSnapshotId).toBeNull()
    expect(needsSnapshotReview(check)).toBe(true)
  })

  it('reports an unknown source instead of assuming the provenance is valid', () => {
    const check = checkFactSourceSnapshot(fact({}), [])

    expect(check.verdict).toBe('source-unknown')
    expect(check.relativePath).toBeNull()
    expect(needsSnapshotReview(check)).toBe(true)
  })
})
