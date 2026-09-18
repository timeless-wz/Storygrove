import { describe, expect, it } from 'vitest'
import { extractStoryCandidates } from '../story-candidate-extractor'

const source = {
  projectId: 'novel-a',
  sourceId: 'source-a',
  snapshotId: 'snapshot-a',
  fragmentId: 'fragment-a',
  relativePath: '05_人物与关系/角色.md',
  headingPath: '角色卡 > 林砚',
  startLine: 10,
  endLine: 20,
  fragmentHash: 'fragment-hash-a',
  content: '# 林砚\n人物：林砚\n能力：回溯\n代价：每次使用会失去一段记忆\n林砚与顾遥是师徒关系\n伏笔：门上的三道刻痕\n废案：旧结局不采用',
}

describe('story candidate extraction boundary', () => {
  it('extracts structured pending candidates with immutable source evidence', () => {
    const proposal = extractStoryCandidates({ ...source, createdAt: '2026-09-15T00:00:00.000Z' })
    expect(proposal.status).toBe('pending')
    expect(proposal.projectId).toBe('novel-a')
    expect(proposal.createdAt).toBe('2026-09-15T00:00:00.000Z')
    expect(proposal.candidates.map(candidate => candidate.candidateType)).toEqual([
      'character', 'ability', 'setting', 'relationship', 'foreshadowing', 'setting',
    ])
    const candidate = proposal.candidates[0]
    expect(candidate.status).toBe('pending')
    expect(candidate.source).toMatchObject({
      projectId: 'novel-a', sourceId: 'source-a', snapshotId: 'snapshot-a', fragmentId: 'fragment-a',
      evidence: '人物：林砚', evidenceStartLine: 11, evidenceEndLine: 11,
    })
    expect(candidate.source.evidenceHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(candidate.confidence).toBeGreaterThan(0)
  })

  it('marks uncertainty and deprecated wording as conflicts without approving it', () => {
    const proposal = extractStoryCandidates({
      ...source,
      content: '设定：可能存在第二套规则\n废案：不采用的能力',
      createdAt: '2026-09-15T00:00:00.000Z',
    })
    expect(proposal.status).toBe('pending')
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.stringContaining('不确定措辞'),
      expect.stringContaining('废止或废案'),
    ]))
    expect(proposal.candidates.every(candidate => candidate.status === 'pending')).toBe(true)
  })

  it('fails closed for missing or cross-project provenance', () => {
    expect(() => extractStoryCandidates({ ...source, projectId: '' })).toThrow('显式 projectId')
    expect(() => extractStoryCandidates({ projectId: 'novel-b', source: { ...source, projectId: 'novel-a' } })).toThrow('projectId 不一致')
    expect(() => extractStoryCandidates({ ...source, snapshotId: '' })).toThrow('snapshotId')
  })

  it('does not persist anything and exposes only a pending proposal', () => {
    const proposal = extractStoryCandidates({ ...source, content: '人物：仅提案' })
    expect(proposal.candidates[0].status).toBe('pending')
    expect(proposal.candidates[0].candidateType).toBe('character')
  })
})
