import { describe, expect, it } from 'vitest'

import type { BlueprintPlanningCandidateRecord } from '../../../../shared/blueprint-planning'
import { findConfirmedChapterPlanning } from '../blueprint-planning.command'

function candidate(options: {
  operationId: string
  volumeId?: string
  state?: BlueprintPlanningCandidateRecord['state']
  confirmedChapterNumbers: number[]
  chapters: unknown[]
}): BlueprintPlanningCandidateRecord {
  return {
    operationId: options.operationId,
    kind: 'chapter-plan',
    scope: { kind: 'volume', volumeId: options.volumeId ?? 'volume-stable-id' },
    state: options.state ?? 'committed',
    schemaVersion: 1,
    payloadHash: `hash-${options.operationId}`,
    candidate: { volumeId: options.volumeId ?? 'volume-stable-id', chapters: options.chapters },
    sourceSnapshot: {
      snapshotId: `snapshot-${options.operationId}`,
      operationId: options.operationId,
      targetKind: 'volume',
      targetId: options.volumeId ?? 'volume-stable-id',
      targetRevision: 0,
      targetHash: 'target-hash',
      sources: [],
    },
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
    committedAt: '2026-10-03T00:00:00.000Z',
    commitReceipt: { chapterNumbers: options.confirmedChapterNumbers },
  }
}

describe('confirmed chapter-plan lookup', () => {
  it('uses planning fields only for the chapters listed in the explicit commit receipt', () => {
    const unselectedChapterCandidate = candidate({
      operationId: 'partial-batch',
      confirmedChapterNumbers: [20],
      chapters: [
        {
          chapterNumber: 20,
          planning: {
            volumeTask: 'Confirmed for Chapter 20 only',
            handoff: '',
            expectedEndChange: '',
          },
        },
        {
          chapterNumber: 21,
          planning: {
            volumeTask: 'Not confirmed',
            handoff: 'Not confirmed',
            expectedEndChange: 'Not confirmed',
          },
        },
      ],
    })
    const selectedChapterCandidate = candidate({
      operationId: 'confirmed-batch',
      confirmedChapterNumbers: [21],
      chapters: [{
        chapterNumber: 21,
        planning: {
          volumeTask: 'Escalate the cost of the rescue.',
          handoff: 'Carry the key into the next chapter.',
          expectedEndChange: 'The lead loses trust in the dispatcher.',
        },
      }],
    })

    expect(findConfirmedChapterPlanning(
      [unselectedChapterCandidate, selectedChapterCandidate],
      'volume-stable-id',
      21,
    )).toEqual({
      candidate: selectedChapterCandidate,
      planning: {
        volumeTask: 'Escalate the cost of the rescue.',
        handoff: 'Carry the key into the next chapter.',
        expectedEndChange: 'The lead loses trust in the dispatcher.',
      },
    })
    expect(findConfirmedChapterPlanning(
      [unselectedChapterCandidate],
      'volume-stable-id',
      21,
    )).toBeNull()
  })

  it('rejects uncommitted, wrong-volume, and incomplete planning candidates', () => {
    const uncommitted = candidate({
      operationId: 'draft',
      state: 'candidate',
      confirmedChapterNumbers: [21],
      chapters: [{ chapterNumber: 21, planning: { volumeTask: 'Task', handoff: '', expectedEndChange: '' } }],
    })
    const wrongVolume = candidate({
      operationId: 'other-volume',
      volumeId: 'other-volume-id',
      confirmedChapterNumbers: [21],
      chapters: [{ chapterNumber: 21, planning: { volumeTask: 'Task', handoff: '', expectedEndChange: '' } }],
    })
    const incomplete = candidate({
      operationId: 'missing-field',
      confirmedChapterNumbers: [21],
      chapters: [{ chapterNumber: 21, planning: { volumeTask: 'Task', handoff: '' } }],
    })

    expect(findConfirmedChapterPlanning([uncommitted, wrongVolume, incomplete], 'volume-stable-id', 21)).toBeNull()
  })
})
