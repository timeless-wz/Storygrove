import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { StoryDomainRepository } from '../../repositories/story-domain-repository'
import { auditChapter, listAuditFindings, waiveAuditFinding } from '../continuity-audit-service'

const roots: string[] = []
afterEach(() => { closeProjectDatabase(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function open() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-audit-')); roots.push(root); initProjectDatabase(root)
  const database = getProjectDb()!; database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','Audit fixture')").run()
  database.prepare(`INSERT INTO workspace_sources (id, project_id, absolute_path, relative_path, category, authority_status, import_status, content_hash, file_size) VALUES ('s','main', ?, 'canon.md', 'characters', 'confirmed', 'imported', 'hash', 3)`).run(path.join(root, 'canon.md'))
  database.prepare(`INSERT INTO workspace_source_snapshots (snapshot_id, source_id, project_id, content_hash, file_size, fragment_count) VALUES ('snap','s','main','hash',3,1)` ).run()
  database.prepare(`INSERT INTO workspace_source_snapshot_fragments (id,snapshot_id,source_id,project_id,heading_path,content,start_line,end_line,fragment_hash,purpose,status) VALUES ('frag','snap','s','main','角色','林越：已死亡',1,1,'hash','character','active')`).run()
  return root
}
function provenance() { return { sourceId: 's', sourceSnapshotId: 'snap', sourceFragmentId: 'frag', sourceFile: 'canon.md', sourceHeadingPath: '角色', startLine: 1, endLine: 1, contentHash: 'hash' } }

describe('continuity audit service', () => {
  it('persists a sourced death-state finding and supports an author waiver', () => {
    open(); const fact = StoryDomainRepository.createCandidate({ projectId: 'main', entityType: 'character', canonicalName: '林越', summary: '已死亡', payload: { status: '已死亡' }, confidence: 1, provenance: provenance() }); StoryDomainRepository.approveCandidate('main', fact.candidateId, 'author')
    const result = auditChapter({ projectId: 'main', chapterNumber: 31, content: '林越走进大厅。' }); expect(result.findings[0]).toMatchObject({ ruleCode: 'P4-FR-002', severity: 'high' }); expect(result.findings[0]?.evidence.length).toBeGreaterThan(0)
    expect(listAuditFindings('main', result.runId)).toHaveLength(1); waiveAuditFinding({ projectId: 'main', findingId: result.findings[0]!.findingId, reason: '回忆场景', approvedBy: 'author' }); expect(listAuditFindings('main', result.runId)[0]?.status).toBe('waived')
  })

  it('checks confirmed time, location, injury, power, knowledge, item and hard-outline constraints with evidence', () => {
    open()
    const create = (entityType: Parameters<typeof StoryDomainRepository.createCandidate>[0]['entityType'], canonicalName: string, payload: Record<string, unknown>) => {
      const candidate = StoryDomainRepository.createCandidate({ projectId: 'main', entityType, canonicalName, summary: canonicalName, payload, confidence: 1, provenance: provenance() })
      return StoryDomainRepository.approveCandidate('main', candidate.candidateId, 'author')
    }
    const linYue = create('character', '林越', {})
    create('character', '赵青', {})
    create('place', '北城', {})
    create('place', '南城', {})
    create('power_system', '修行境界', { maxLevel: 3, forbiddenAbilities: ['禁术'] })
    create('item', '赤霄剑', { owner: '林越' })
    create('relationship', '林越—赵青', { forbiddenTerms: ['父亲'] })
    create('outline', '第31章任务', { chapterNumber: 31, mustComplete: ['救出同伴'] })
    const database = getProjectDb()!
    database.prepare(`INSERT INTO entity_state_snapshots (snapshot_id, project_id, entity_fact_id, chapter_number, state_json, source_json, authority_status) VALUES ('state-1', 'main', ?, 30, ?, ?, 'confirmed')`).run(linYue.factId, JSON.stringify({ location: '北城', status: '重伤' }), JSON.stringify({ source: 'chapter-30' }))
    database.prepare(`INSERT INTO story_events (event_id, project_id, title, chapter_number, story_time, result_json, source_json, status) VALUES ('event-1', 'main', '抵达北城', 30, '第5天', '{}', ?, 'confirmed')`).run(JSON.stringify({ source: 'chapter-30' }))
    database.prepare(`INSERT INTO character_knowledge (knowledge_id, project_id, character_fact_id, chapter_number, statement, source_json, authority_status) VALUES ('knowledge-1', 'main', ?, 32, '密钥在塔顶', ?, 'confirmed')`).run(linYue.factId, JSON.stringify({ source: 'chapter-32' }))

    const result = auditChapter({ projectId: 'main', chapterNumber: 31, content: [
      '第3天。',
      '林越在南城疾跑，施展禁术达到第5阶。',
      '赵青拿着赤霄剑，并被林越称呼为父亲。',
      '林越知道密钥在塔顶。',
      '众人暂时撤离。',
    ].join('\n') })

    expect(new Set(result.findings.map(finding => finding.ruleCode))).toEqual(new Set([
      'P4-FR-001', 'P4-FR-002', 'P4-FR-003', 'P4-FR-004', 'P4-FR-005', 'P4-FR-006',
    ]))
    expect(result.findings.every(finding => finding.evidence.length >= 2)).toBe(true)
  })

  it('does not turn an unapproved hard outline into a finalization-blocking rule', () => {
    open()
    StoryDomainRepository.createCandidate({ projectId: 'main', entityType: 'outline', canonicalName: '候选任务', summary: '候选', payload: { chapterNumber: 31, mustComplete: ['不存在的任务'] }, confidence: 1, provenance: provenance() })
    const result = auditChapter({ projectId: 'main', chapterNumber: 31, content: '普通正文。' })
    expect(result.findings).toEqual([])
  })
})
