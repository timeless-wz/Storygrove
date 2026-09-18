import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { StoryDomainRepository } from '../repositories/story-domain-repository'
import type { StoryProvenance } from '../../src/shared/story-domain'

const temporaryProjects: string[] = []

function openProject(): void {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-story-domain-'))
  temporaryProjects.push(projectPath)
  initProjectDatabase(projectPath)
  const db = getProjectDb()!
  db.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main', 'Story domain test')").run()
  db.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('other', 'Other story')").run()
  db.prepare(`
    INSERT INTO workspace_sources (
      id, project_id, absolute_path, relative_path, category, authority_status, content_hash, file_size
    ) VALUES ('source-main', 'main', '/tmp/main.md', 'main.md', 'character_data', 'candidate', 'hash-main', 10),
             ('source-other', 'other', '/tmp/other.md', 'other.md', 'character_data', 'candidate', 'hash-other', 10)
  `).run()
  db.prepare(`
    INSERT INTO workspace_source_snapshots (snapshot_id, source_id, project_id, content_hash, file_size, fragment_count)
    VALUES ('snapshot-main', 'source-main', 'main', 'hash-main', 10, 1),
           ('snapshot-other', 'source-other', 'other', 'hash-other', 10, 1)
  `).run()
  db.prepare(`
    INSERT INTO workspace_source_snapshot_fragments (
      id, snapshot_id, source_id, project_id, heading_path, content, start_line, end_line, fragment_hash
    ) VALUES ('fragment-main', 'snapshot-main', 'source-main', 'main', '# 角色', '林岚', 1, 2, 'fragment-hash-main'),
             ('fragment-other', 'snapshot-other', 'source-other', 'other', '# 角色', '他人', 1, 2, 'fragment-hash-other')
  `).run()
}

function provenance(project: 'main' | 'other' = 'main'): StoryProvenance {
  return project === 'main'
    ? {
        sourceId: 'source-main', sourceSnapshotId: 'snapshot-main', sourceFragmentId: 'fragment-main',
        sourceFile: 'main.md', sourceHeadingPath: '# 角色', startLine: 1, endLine: 2, contentHash: 'hash-main',
      }
    : {
        sourceId: 'source-other', sourceSnapshotId: 'snapshot-other', sourceFragmentId: 'fragment-other',
        sourceFile: 'other.md', sourceHeadingPath: '# 角色', startLine: 1, endLine: 2, contentHash: 'hash-other',
      }
}

afterEach(() => {
  closeProjectDatabase()
  for (const projectPath of temporaryProjects.splice(0)) fs.rmSync(projectPath, { recursive: true, force: true })
})

describe('story domain repository', () => {
  it('keeps model extraction in candidate storage until author approval', () => {
    openProject()
    const candidate = StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'character', canonicalName: '林岚', summary: '候选角色',
      payload: { role: 'supporting', motivation: '查明真相' }, confidence: 0.82, provenance: provenance(),
      possibleConflicts: ['与第 8 章称谓可能冲突'],
    })
    expect(candidate.reviewStatus).toBe('pending')
    expect(StoryDomainRepository.listFacts('main')).toHaveLength(0)
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM story_facts').get()).toEqual({ count: 0 })

    const fact = StoryDomainRepository.approveCandidate('main', candidate.candidateId, 'author')
    expect(fact.status).toBe('confirmed')
    expect(fact.provenance.sourceSnapshotId).toBe('snapshot-main')
    expect(StoryDomainRepository.listVersions('main', fact.factId)).toHaveLength(1)
    expect(StoryDomainRepository.listCandidates('main')[0].reviewStatus).toBe('approved')
  })

  it('fails closed for cross-project candidates and preserves version history', () => {
    openProject()
    const candidate = StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'world_rule', canonicalName: '夜间禁行', summary: '规则',
      payload: { limit: '夜间' }, confidence: 1, provenance: provenance(),
    })
    expect(() => StoryDomainRepository.approveCandidate('other', candidate.candidateId, 'author')).toThrow()
    const fact = StoryDomainRepository.approveCandidate('main', candidate.candidateId, 'author')
    const version = StoryDomainRepository.commitFactVersion({
      projectId: 'main', factId: fact.factId, summary: '修订规则', payload: { limit: '子夜' },
      status: 'confirmed', confidence: 0.95, provenance: provenance(), changedBy: 'author',
    })
    expect(version.version).toBe(2)
    expect(StoryDomainRepository.listVersions('main', fact.factId).map(item => item.version)).toEqual([1, 2])
    expect(StoryDomainRepository.getFact('other', fact.factId)).toBeNull()
    expect(() => StoryDomainRepository.addImpact({
      projectId: 'other', factId: fact.factId, chapterNumber: 3, impactType: 'mentions',
    })).toThrow()
  })

  it('rejects unverifiable provenance and records relations and chapter impacts only in-project', () => {
    openProject()
    expect(() => StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'place', canonicalName: '旧城', summary: '', payload: {}, confidence: 0.5,
      provenance: { ...provenance(), sourceSnapshotId: 'unknown' },
    })).toThrow('来源快照或片段不存在')

    const first = StoryDomainRepository.approveCandidate('main', StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'character', canonicalName: '甲', summary: '', payload: {}, confidence: 0.8,
      provenance: provenance(),
    }).candidateId, 'author')
    const second = StoryDomainRepository.approveCandidate('main', StoryDomainRepository.createCandidate({
      projectId: 'main', entityType: 'place', canonicalName: '旧城', summary: '', payload: {}, confidence: 0.8,
      provenance: provenance(),
    }).candidateId, 'author')
    expect(StoryDomainRepository.addRelation({
      projectId: 'main', fromFactId: first.factId, toFactId: second.factId, relationType: 'located-in', provenance: provenance(),
    }).relationType).toBe('located-in')
    expect(StoryDomainRepository.addImpact({
      projectId: 'main', factId: first.factId, chapterNumber: 31, impactType: 'appears', narrativeLine: '主线',
    }).chapterNumber).toBe(31)
    expect(StoryDomainRepository.listRelations('main')).toHaveLength(1)
    expect(StoryDomainRepository.listImpacts('main', first.factId)).toHaveLength(1)
  })
})
