import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { StoryDomainRepository } from '../../repositories/story-domain-repository'
import { listKnowledgeIndexQueue, markFactKnowledgeStale, markKnowledgeVersionStale, processKnowledgeIndexQueue, recordKnowledgeChunk, searchKnowledgeWithProvenance } from '../rag-context-service'

const roots: string[] = []
afterEach(() => { closeProjectDatabase(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function open() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-rag-context-')); roots.push(root); initProjectDatabase(root)
  const database = getProjectDb()!
  database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','RAG fixture')").run()
  database.prepare(`INSERT INTO workspace_sources (id, project_id, absolute_path, relative_path, category, authority_status, import_status, content_hash, file_size) VALUES ('s','main', ?, 'canon.md', 'confirmed_settings', 'confirmed', 'imported', 'hash', 3)`).run(path.join(root, 'canon.md'))
  database.prepare(`INSERT INTO workspace_source_snapshots (snapshot_id, source_id, project_id, content_hash, file_size, fragment_count) VALUES ('snap','s','main','hash',3,1)`).run()
  database.prepare(`INSERT INTO workspace_source_snapshot_fragments (id,snapshot_id,source_id,project_id,heading_path,content,start_line,end_line,fragment_hash,purpose,status) VALUES ('frag','snap','s','main','设定','林越左臂受伤',1,1,'hash','setting','active')`).run()
  return root
}
function provenance() { return { sourceId: 's', sourceSnapshotId: 'snap', sourceFragmentId: 'frag', sourceFile: 'canon.md', sourceHeadingPath: '设定', startLine: 1, endLine: 1, contentHash: 'hash' } }

describe('RAG context provenance service', () => {
  it('returns only fresh confirmed facts/chunks and visibly degrades to FTS without embeddings', async () => {
    const root = open()
    const candidate = StoryDomainRepository.createCandidate({ projectId: 'main', entityType: 'character', canonicalName: '林越', summary: '左臂受伤，不能持剑', payload: {}, confidence: 1, provenance: provenance() })
    const fact = StoryDomainRepository.approveCandidate('main', candidate.candidateId, 'author')
    const confirmed = recordKnowledgeChunk({ projectId: 'main', documentId: 'canon', chunkText: '林越左臂受伤，不能持剑。', versionId: 'v1', factId: fact.factId, source: provenance(), authorityStatus: 'confirmed' })
    recordKnowledgeChunk({ projectId: 'main', documentId: 'candidate', chunkText: '林越可以无限使用禁术。', versionId: 'v2', source: provenance(), authorityStatus: 'candidate' })
    const stale = recordKnowledgeChunk({ projectId: 'main', documentId: 'stale', chunkText: '林越左臂已经痊愈。', versionId: 'old', source: provenance(), authorityStatus: 'confirmed' })
    expect(listKnowledgeIndexQueue('main').map(entry => entry.chunkId)).toContain(confirmed)
    expect(markKnowledgeVersionStale('main', 'old')).toBe(1)

    const result = await searchKnowledgeWithProvenance({ projectId: 'main', projectPath: root, query: '林越 左臂', topK: 10 })
    expect(result).toMatchObject({ mode: 'fts', degraded: true, degradationReason: 'embedding-unconfigured' })
    expect(result.hits).toEqual(expect.arrayContaining([expect.objectContaining({ authorityStatus: 'confirmed', source: expect.objectContaining({ sourceFile: 'canon.md' }) })]))
    expect(result.hits.map(hit => hit.text).join('\n')).not.toContain('无限使用禁术')
    expect(result.hits.map(hit => hit.text).join('\n')).not.toContain('已经痊愈')
    expect(listKnowledgeIndexQueue('main').some(entry => entry.chunkId === stale && entry.reason === 'source-version-stale')).toBe(true)
  })

  it('consumes confirmed queue rows into sourced vector records and leaves the queue visibly pending without embeddings', async () => {
    const root = open()
    const chunkId = recordKnowledgeChunk({ projectId: 'main', documentId: 'canon', chunkText: '林越左臂受伤。', versionId: 'v1', source: provenance(), authorityStatus: 'confirmed' })
    const waiting = await processKnowledgeIndexQueue({ projectId: 'main', projectPath: root })
    expect(waiting).toEqual({ processed: 0, failed: 0, waitingForEmbedding: true })
    const addChunks = vi.fn(async () => ({ success: true, chunkCount: 1 }))
    const result = await processKnowledgeIndexQueue({ projectId: 'main', projectPath: root, embedding: { protocol: 'openai', model: { baseUrl: 'https://embedding.invalid', apiKey: 'key', modelName: 'test' } } }, {
      generateEmbeddings: vi.fn(async () => [[0.1, 0.2]]) as never,
      addChunks: addChunks as never,
      removeDocument: vi.fn(async () => true) as never,
    })
    expect(result).toEqual({ processed: 1, failed: 0, waitingForEmbedding: false })
    expect(addChunks).toHaveBeenCalledWith(expect.any(String), `story-fact:${chunkId}`, expect.any(String), ['林越左臂受伤。'], [[0.1, 0.2]], undefined, expect.objectContaining({ authorityStatus: 'confirmed', sourceSnapshotId: 'snap', sourceFragmentId: 'frag' }), expect.any(Object))
    expect(listKnowledgeIndexQueue('main').find(entry => entry.chunkId === chunkId)?.status).toBe('completed')
  })

  it('retires a deprecated fact projection before its vector cleanup completes', async () => {
    open()
    const candidate = StoryDomainRepository.createCandidate({ projectId: 'main', entityType: 'item', canonicalName: '旧钥匙', summary: '已经作废', payload: {}, confidence: 1, provenance: provenance() })
    const fact = StoryDomainRepository.approveCandidate('main', candidate.candidateId, 'author')
    const chunk = recordKnowledgeChunk({ projectId: 'main', documentId: 'canon', chunkText: '旧钥匙能够开启密室。', versionId: 'v1', factId: fact.factId, source: provenance(), authorityStatus: 'confirmed' })
    expect(markFactKnowledgeStale('main', fact.factId)).toBe(1)
    const result = await searchKnowledgeWithProvenance({ projectId: 'main', projectPath: roots.at(-1)!, query: '旧钥匙 密室' })
    expect(result.hits.map(hit => hit.text).join('\n')).not.toContain('能够开启密室')
    expect(listKnowledgeIndexQueue('main')).toEqual(expect.arrayContaining([expect.objectContaining({ chunkId: chunk, reason: 'fact-deprecated' })]))
  })
})
