import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { StoryDomainRepository } from '../repositories/story-domain-repository'
import { StoryDataApprovalService } from '../services/story-data-approval-service'
import { StoryCandidatePersistenceService } from '../services/story-candidate-persistence-service'
import { extractStoryCandidates } from '../services/story-candidate-extractor'
import type { StoryProvenance } from '../../src/shared/story-domain'

const roots: string[] = []

afterEach(() => {
  closeProjectDatabase()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function setup(): { projectPath: string; provenance: StoryProvenance } {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'story-approval-'))
  roots.push(projectPath)
  initProjectDatabase(projectPath)
  getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main', 'Test')").run()
  const db = getProjectDb()!
  db.prepare(`
    INSERT INTO workspace_sources (id, project_id, relative_path, absolute_path, category,
      authority_status, content_hash, observed_file_hash, approved_content_hash,
      approved_snapshot_id, observed_snapshot_id, mtime, last_scanned_at)
    VALUES ('source-1', 'main', 'world.md', 'C:/world.md', 'confirmed_settings',
      'confirmed', 'hash', 'hash', 'hash', 'snapshot-1', 'snapshot-1', 1, datetime('now'))
  `).run()
  db.prepare(`
    INSERT INTO workspace_source_snapshots
      (snapshot_id, source_id, project_id, content_hash, file_size, fragment_count)
    VALUES ('snapshot-1', 'source-1', 'main', 'hash', 10, 1)
  `).run()
  db.prepare(`
    INSERT INTO workspace_source_snapshot_fragments
      (id, snapshot_id, source_id, project_id, heading_path, content, start_line,
       end_line, fragment_hash, chapter_start, chapter_end, purpose, status)
    VALUES ('fragment-1', 'snapshot-1', 'source-1', 'main', '规则 > 守恒', '事实',
      1, 3, 'fragment-hash', 3, 4, '主线', 'active')
  `).run()
  return {
    projectPath,
    provenance: {
      sourceId: 'source-1', sourceSnapshotId: 'snapshot-1', sourceFragmentId: 'fragment-1',
      sourceFile: 'world.md', sourceHeadingPath: '规则 > 守恒', startLine: 1, endLine: 3,
      contentHash: 'hash',
    },
  }
}

describe('StoryDataApprovalService', () => {
  it('commits only after explicit approval, records a version and chapter impacts', () => {
    const { provenance } = setup()
    const candidate = StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'world_rule', canonicalName: '守恒', summary: '能量守恒',
      payload: { content: '能量不可凭空产生' }, confidence: 0.9, provenance,
    })
    expect(StoryDomainRepository.listFacts('main')).toHaveLength(0)

    const result = StoryDataApprovalService.approve({ projectId: 'main', candidateId: candidate.candidateId, approvedBy: 'author' })
    expect(result.success).toBe(true)
    expect(result.idempotent).toBe(false)
    expect(result.version?.version).toBe(1)
    expect(result.impacts?.map(impact => impact.chapterNumber)).toEqual([3, 4])
    expect(StoryDomainRepository.listFacts('main')).toHaveLength(1)
    expect(getProjectDb()!.prepare("SELECT status, reason FROM knowledge_index_queue WHERE project_id = 'main'").all())
      .toEqual([{ status: 'pending', reason: 'confirmed-chunk-created' }])

    const replay = StoryDataApprovalService.approve({ projectId: 'main', candidateId: candidate.candidateId, approvedBy: 'author' })
    expect(replay).toMatchObject({ success: true, idempotent: true, version: { version: 1 } })
    expect(StoryDataApprovalService.listImpacts('main')).toHaveLength(2)
  })

  it('fails closed across projects and makes rejection retry-safe', () => {
    setup()
    const candidate = StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'world_rule', canonicalName: '仅主项目', summary: '',
      payload: { value: true }, confidence: 0.5,
      provenance: {
        sourceId: 'source-1', sourceSnapshotId: 'snapshot-1', sourceFragmentId: 'fragment-1',
        sourceFile: 'world.md', sourceHeadingPath: '规则 > 守恒', startLine: 1, endLine: 3, contentHash: 'hash',
      },
    })
    expect(StoryDataApprovalService.approve({ projectId: 'other', candidateId: candidate.candidateId, approvedBy: 'author' }).success).toBe(false)
    expect(StoryDataApprovalService.reject('main', candidate.candidateId)).toEqual({ success: true })
    expect(StoryDataApprovalService.reject('main', candidate.candidateId)).toEqual({ success: true })
    expect(StoryDataApprovalService.approve({ projectId: 'main', candidateId: candidate.candidateId, approvedBy: 'author' })).toMatchObject({ success: false })
  })

  it('persists only pending extracted proposals and deduplicates the same frozen source', () => {
    setup()
    const proposal = extractStoryCandidates({
      projectId: 'main',
      source: {
        projectId: 'main', sourceId: 'source-1', snapshotId: 'snapshot-1', fragmentId: 'fragment-1',
        relativePath: 'world.md', headingPath: '规则 > 守恒', startLine: 1, endLine: 3,
        fragmentHash: 'hash', content: '规则：只能在主线生效',
      },
      createdAt: '2026-09-15T00:00:00.000Z',
    })
    const first = StoryCandidatePersistenceService.persistProposal('main', proposal)
    const second = StoryCandidatePersistenceService.persistProposal('main', proposal)
    expect(first).toHaveLength(1)
    expect(second.map(item => item.candidateId)).toEqual(first.map(item => item.candidateId))
    expect(StoryDomainRepository.listFacts('main')).toHaveLength(0)
    expect(() => StoryCandidatePersistenceService.persistProposal('other', proposal)).toThrow('projectId')
  })
})
