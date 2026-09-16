import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import { searchKnowledge, searchKnowledgeFTS } from '../knowledge-base'
import { generateEmbeddings } from '../embedding'
import { addChunks, removeDocument } from '../vector-store'
import { StoryDomainRepository } from '../repositories/story-domain-repository'
import type { EmbeddingOptions } from '../../src/shared/embedding-options'
import type { StoryFact } from '../../src/shared/story-domain'

export interface RagEmbeddingConfig {
  protocol: 'openai' | 'gemini'
  model: { baseUrl: string; apiKey: string; modelName?: string; embeddingOptions?: EmbeddingOptions }
}
export interface KnowledgeIndexProcessResult { processed: number; failed: number; waitingForEmbedding: boolean }
type IndexQueueRow = { queue_id: string; chunk_id: string; reason: string; chunk_text: string | null; document_id: string | null; chapter_number: number | null; fact_id: string | null; source_json: string | null; version_id: string | null; authority_status: string | null; stale: number | null }
type KnowledgeIndexDependencies = {
  generateEmbeddings: typeof generateEmbeddings
  addChunks: typeof addChunks
  removeDocument: typeof removeDocument
}
const defaultIndexDependencies: KnowledgeIndexDependencies = { generateEmbeddings, addChunks, removeDocument }
const scheduledIndexRuns = new Map<string, Promise<void>>()
export interface RAGSearchHit {
  text: string; score: number; fileName: string; chapterNumber?: number
  source?: StoryFact['provenance'] | Record<string, unknown>; authorityStatus: 'confirmed' | 'candidate' | 'deprecated' | 'unknown'
}
export interface RAGSearchResult {
  mode: 'fts' | 'hybrid'
  /** FTS remains available without an embedding configuration. The UI can show this explicitly. */
  degraded: boolean
  degradationReason?: 'embedding-unconfigured'
  hits: RAGSearchHit[]
}

type ChunkRow = { chunk_id: string; document_id: string; chapter_number: number | null; fact_id: string | null; chunk_text: string; source_json: string; authority_status: string }
type RawHit = { text: string; score: number; fileName: string; chapterNumber?: number; sourceSnapshotId?: string; sourceFragmentId?: string; authorityStatus?: string; startLine?: number; endLine?: number }

function parseObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} } catch { return {} } }
function queryTokens(query: string): string[] {
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu) ?? []
  return [...new Set(tokens.map(token => token.trim()).filter(token => token.length >= 2))].slice(0, 12)
}
function relevance(query: string, text: string, canonicalName?: string): number {
  const tokens = queryTokens(query); const normalized = text.toLocaleLowerCase(); const canonical = canonicalName?.toLocaleLowerCase()
  return tokens.reduce((score, token, index) => score + (normalized.includes(token.toLocaleLowerCase()) ? tokens.length - index : 0), canonical && query.toLocaleLowerCase().includes(canonical) ? tokens.length + 4 : 0)
}
function sourceForFact(fact: StoryFact): StoryFact['provenance'] { return fact.provenance }
function safeTopK(value: number | undefined): number { return Math.min(50, Math.max(1, Number.isSafeInteger(value) ? Number(value) : 10)) }
function usableEmbeddingConfig(value: RagEmbeddingConfig | undefined): value is RagEmbeddingConfig { return !!value && !!value.model.baseUrl.trim() && !!value.model.apiKey.trim() }

/**
 * Strict, version-aware RAG boundary.  Vector/Lance results are recall hints;
 * a result becomes positive writing context only after its authority can be
 * tied to a confirmed fact or a fresh confirmed SQLite knowledge chunk.
 */
export async function searchKnowledgeWithProvenance(input: {
  projectId: string; projectPath: string; query: string; topK?: number; chapterScope?: [number, number]; embedding?: RagEmbeddingConfig
}): Promise<RAGSearchResult> {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  const projectId = input.projectId.trim(); if (!projectId) throw new Error('必须提供显式 projectId')
  const query = input.query.trim(); if (!query) return { mode: usableEmbeddingConfig(input.embedding) ? 'hybrid' : 'fts', degraded: !usableEmbeddingConfig(input.embedding), ...(usableEmbeddingConfig(input.embedding) ? {} : { degradationReason: 'embedding-unconfigured' }), hits: [] }
  const topK = safeTopK(input.topK)
  const facts = StoryDomainRepository.listFacts(projectId, 'confirmed')
  const factBySnapshot = new Map(facts.map(fact => [`${fact.provenance.sourceSnapshotId}:${fact.provenance.sourceFragmentId}`, fact]))
  const factById = new Map(facts.map(fact => [fact.factId, fact]))
  const factMatches = facts.filter(fact => relevance(query, `${fact.canonicalName} ${fact.summary} ${JSON.stringify(fact.payload)}`, fact.canonicalName) > 0)
  const chunkRows = database.prepare(`
    SELECT chunk_id, document_id, chapter_number, fact_id, chunk_text, source_json, authority_status
    FROM knowledge_chunks
    WHERE project_id = ? AND authority_status = 'confirmed' AND stale = 0
      AND (? IS NULL OR chapter_number IS NULL OR chapter_number BETWEEN ? AND ?)
  `).all(projectId, input.chapterScope ? 1 : null, input.chapterScope?.[0] ?? null, input.chapterScope?.[1] ?? null) as ChunkRow[]
  const chunkMatches = chunkRows.filter(row => relevance(query, row.chunk_text) > 0)
  let raw: RawHit[] = []
  if (usableEmbeddingConfig(input.embedding)) {
    raw = await searchKnowledge(query, input.projectPath, input.embedding.protocol, input.embedding.model, topK * 3, input.chapterScope, ['reference']) as RawHit[]
  } else {
    raw = await searchKnowledgeFTS(query, input.projectPath, topK * 3, input.chapterScope, ['reference']) as RawHit[]
  }
  const hits: RAGSearchHit[] = []
  for (const fact of factMatches) hits.push({ text: `${fact.canonicalName}：${fact.summary}`, score: 10_000 + relevance(query, `${fact.canonicalName} ${fact.summary}`, fact.canonicalName), fileName: fact.provenance.sourceFile, source: sourceForFact(fact), authorityStatus: 'confirmed' })
  for (const chunk of chunkMatches) {
    const fact = chunk.fact_id ? factById.get(chunk.fact_id) : undefined
    const source = fact?.provenance ?? parseObject(chunk.source_json)
    hits.push({ text: chunk.chunk_text, score: 5_000 + relevance(query, chunk.chunk_text), fileName: typeof source.sourceFile === 'string' ? source.sourceFile : chunk.document_id, ...(chunk.chapter_number === null ? {} : { chapterNumber: chunk.chapter_number }), source, authorityStatus: 'confirmed' })
  }
  for (const hit of raw) {
    const authority = hit.authorityStatus
    const fact = hit.sourceSnapshotId && hit.sourceFragmentId ? factBySnapshot.get(`${hit.sourceSnapshotId}:${hit.sourceFragmentId}`) : undefined
    // Unknown/candidate/deprecated vector rows must not silently become facts.
    if (authority !== 'confirmed' && !fact) continue
    hits.push({ text: hit.text, score: 1_000 + hit.score + relevance(query, hit.text), fileName: hit.fileName, ...(hit.chapterNumber === undefined ? {} : { chapterNumber: hit.chapterNumber }), ...(fact ? { source: fact.provenance } : {}), authorityStatus: 'confirmed' })
  }
  const unique = new Map<string, RAGSearchHit>()
  for (const hit of hits.sort((left, right) => right.score - left.score)) {
    const key = JSON.stringify([hit.fileName, hit.chapterNumber ?? null, hit.text])
    if (!unique.has(key)) unique.set(key, hit)
  }
  const hybrid = usableEmbeddingConfig(input.embedding)
  return { mode: hybrid ? 'hybrid' : 'fts', degraded: !hybrid, ...(hybrid ? {} : { degradationReason: 'embedding-unconfigured' }), hits: [...unique.values()].slice(0, topK) }
}

/** Store an authoritative source fragment for FTS/RAG metadata. It is a local
 * SQLite write only; vector work is queued explicitly and never blocks prose. */
export function recordKnowledgeChunk(input: {
  projectId: string; documentId: string; chunkText: string; versionId: string; chapterNumber?: number; factId?: string
  source?: Record<string, unknown> | StoryFact['provenance']; authorityStatus?: 'confirmed' | 'candidate' | 'deprecated'
}): string {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  if (!input.projectId.trim() || !input.documentId.trim() || !input.versionId.trim() || !input.chunkText.trim()) throw new Error('知识切片缺少项目、文档、版本或正文')
  const authority = input.authorityStatus ?? 'candidate'
  const chunkId = randomUUID()
  database.transaction(() => {
    database.prepare(`INSERT INTO knowledge_chunks (chunk_id, project_id, document_id, chapter_number, fact_id, chunk_text, source_json, version_id, authority_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chunkId, input.projectId, input.documentId, input.chapterNumber ?? null, input.factId ?? null, input.chunkText, JSON.stringify(input.source ?? {}), input.versionId, authority)
    if (authority === 'confirmed') database.prepare("INSERT INTO knowledge_index_queue (queue_id, project_id, chunk_id, reason) VALUES (?, ?, ?, 'confirmed-chunk-created')").run(randomUUID(), input.projectId, chunkId)
  })()
  return chunkId
}

/** Keep the SQLite/RAG projection synchronized after an author-confirmed fact
 * version is committed.  This never invokes a model or changes author prose. */
export function synchronizeConfirmedFactKnowledge(fact: StoryFact, versionId: string): string {
  if (!versionId.trim()) throw new Error('已确认资料缺少版本标识')
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  const existing = database.prepare(`SELECT chunk_id FROM knowledge_chunks WHERE project_id = ? AND fact_id = ? AND version_id = ? AND stale = 0 LIMIT 1`).get(fact.projectId, fact.factId, versionId) as { chunk_id: string } | undefined
  if (existing) return existing.chunk_id
  database.transaction(() => {
    const previous = database.prepare('SELECT DISTINCT version_id FROM knowledge_chunks WHERE project_id = ? AND fact_id = ? AND stale = 0').all(fact.projectId, fact.factId) as Array<{ version_id: string }>
    database.prepare('UPDATE knowledge_chunks SET stale = 1 WHERE project_id = ? AND fact_id = ? AND stale = 0').run(fact.projectId, fact.factId)
    const refresh = database.prepare("UPDATE knowledge_index_queue SET reason = 'fact-version-superseded', status = 'pending', updated_at = datetime('now') WHERE project_id = ? AND chunk_id = ? AND status IN ('pending','failed')")
    const lookup = database.prepare('SELECT chunk_id FROM knowledge_chunks WHERE project_id = ? AND fact_id = ? AND version_id = ?')
    const enqueue = database.prepare("INSERT INTO knowledge_index_queue (queue_id, project_id, chunk_id, reason) SELECT ?, ?, ?, 'fact-version-superseded' WHERE NOT EXISTS (SELECT 1 FROM knowledge_index_queue WHERE project_id = ? AND chunk_id = ? AND status IN ('pending','processing'))")
    for (const row of previous) {
      const chunk = lookup.get(fact.projectId, fact.factId, row.version_id) as { chunk_id: string } | undefined
      if (!chunk) continue
      if (refresh.run(fact.projectId, chunk.chunk_id).changes === 0) enqueue.run(randomUUID(), fact.projectId, chunk.chunk_id, fact.projectId, chunk.chunk_id)
    }
  })()
  return recordKnowledgeChunk({
    projectId: fact.projectId,
    documentId: fact.provenance.sourceId,
    chunkText: `${fact.canonicalName}\n${fact.summary}\n${JSON.stringify(fact.payload)}`,
    versionId,
    factId: fact.factId,
    source: fact.provenance,
    authorityStatus: 'confirmed',
  })
}

/** Mark superseded source versions stale and atomically schedule re-indexing.
 * No stale chunk is returned as current writing context while waiting. */
export function markKnowledgeVersionStale(projectId: string, versionId: string): number {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  return database.transaction(() => {
    const staleChunks = database.prepare('SELECT chunk_id FROM knowledge_chunks WHERE project_id = ? AND version_id = ? AND stale = 0').all(projectId, versionId) as Array<{ chunk_id: string }>
    database.prepare('UPDATE knowledge_chunks SET stale = 1 WHERE project_id = ? AND version_id = ?').run(projectId, versionId)
    const refresh = database.prepare("UPDATE knowledge_index_queue SET reason = 'source-version-stale', status = 'pending', updated_at = datetime('now') WHERE project_id = ? AND chunk_id = ? AND status IN ('pending','failed')")
    const enqueue = database.prepare("INSERT INTO knowledge_index_queue (queue_id, project_id, chunk_id, reason) SELECT ?, ?, ?, 'source-version-stale' WHERE NOT EXISTS (SELECT 1 FROM knowledge_index_queue WHERE project_id = ? AND chunk_id = ? AND status IN ('pending','processing'))")
    for (const chunk of staleChunks) {
      if (refresh.run(projectId, chunk.chunk_id).changes === 0) enqueue.run(randomUUID(), projectId, chunk.chunk_id, projectId, chunk.chunk_id)
    }
    return staleChunks.length
  })()
}

/** Retire every current index projection for a fact that an author has
 * deprecated. The stale rows are retained for provenance but cannot return as
 * writing context, and the queue removes their vector copies when available. */
export function markFactKnowledgeStale(projectId: string, factId: string): number {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  return database.transaction(() => {
    const chunks = database.prepare('SELECT chunk_id FROM knowledge_chunks WHERE project_id = ? AND fact_id = ? AND stale = 0').all(projectId, factId) as Array<{ chunk_id: string }>
    database.prepare('UPDATE knowledge_chunks SET stale = 1 WHERE project_id = ? AND fact_id = ? AND stale = 0').run(projectId, factId)
    const enqueue = database.prepare("INSERT INTO knowledge_index_queue (queue_id, project_id, chunk_id, reason) SELECT ?, ?, ?, 'fact-deprecated' WHERE NOT EXISTS (SELECT 1 FROM knowledge_index_queue WHERE project_id = ? AND chunk_id = ? AND status IN ('pending','processing'))")
    const refresh = database.prepare("UPDATE knowledge_index_queue SET reason = 'fact-deprecated', status = 'pending', updated_at = datetime('now') WHERE project_id = ? AND chunk_id = ? AND status IN ('failed','pending')")
    for (const chunk of chunks) {
      if (refresh.run(projectId, chunk.chunk_id).changes === 0) enqueue.run(randomUUID(), projectId, chunk.chunk_id, projectId, chunk.chunk_id)
    }
    return chunks.length
  })()
}

export function listKnowledgeIndexQueue(projectId: string): Array<{ queueId: string; chunkId: string; reason: string; status: 'pending' | 'processing' | 'completed' | 'failed' }> {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  return (database.prepare('SELECT queue_id, chunk_id, reason, status FROM knowledge_index_queue WHERE project_id = ? ORDER BY created_at, queue_id').all(projectId) as Array<{ queue_id: string; chunk_id: string; reason: string; status: 'pending' | 'processing' | 'completed' | 'failed' }>).map(row => ({ queueId: row.queue_id, chunkId: row.chunk_id, reason: row.reason, status: row.status }))
}

export function listStaleKnowledgeChunks(projectId: string): Array<{ chunkId: string; versionId: string; source: Record<string, unknown> }> {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  return (database.prepare('SELECT chunk_id, version_id, source_json FROM knowledge_chunks WHERE project_id = ? AND stale = 1 ORDER BY created_at').all(projectId) as Array<{ chunk_id: string; version_id: string; source_json: string }>).map(row => ({ chunkId: row.chunk_id, versionId: row.version_id, source: parseObject(row.source_json) }))
}

function embeddingFingerprint(config: RagEmbeddingConfig): string {
  return `${config.protocol}|${config.model.baseUrl.trim().replace(/\/+$/u, '')}|${config.model.modelName?.trim() || 'default'}`
}

/**
 * Consumes a bounded batch of the local queue. Queue rows are claimed before
 * network work, and every completed vector row preserves its fact/version and
 * source locator. Stale rows are physically removed when possible, but are
 * already excluded by the authoritative search join before that cleanup runs.
 */
export async function processKnowledgeIndexQueue(
  input: { projectId: string; projectPath: string; embedding?: RagEmbeddingConfig; limit?: number },
  dependencies: KnowledgeIndexDependencies = defaultIndexDependencies,
): Promise<KnowledgeIndexProcessResult> {
  const database = getProjectDb(); if (!database) throw new Error('项目数据库未打开')
  const projectId = input.projectId.trim(); if (!projectId) throw new Error('必须提供显式 projectId')
  if (!usableEmbeddingConfig(input.embedding)) return { processed: 0, failed: 0, waitingForEmbedding: true }
  const limit = Math.min(64, Math.max(1, Number.isSafeInteger(input.limit) ? Number(input.limit) : 16))
  const claimed = database.transaction(() => {
    const rows = database.prepare(`
      SELECT queue.queue_id, queue.chunk_id, queue.reason, chunks.chunk_text, chunks.document_id,
        chunks.chapter_number, chunks.fact_id, chunks.source_json, chunks.version_id,
        chunks.authority_status, chunks.stale
      FROM knowledge_index_queue queue
      LEFT JOIN knowledge_chunks chunks ON chunks.chunk_id = queue.chunk_id AND chunks.project_id = queue.project_id
      WHERE queue.project_id = ? AND queue.status IN ('pending', 'failed')
      ORDER BY queue.created_at, queue.queue_id LIMIT ?
    `).all(projectId, limit) as IndexQueueRow[]
    const claim = database.prepare("UPDATE knowledge_index_queue SET status = 'processing', updated_at = datetime('now') WHERE queue_id = ? AND project_id = ? AND status IN ('pending', 'failed')")
    return rows.filter(row => claim.run(row.queue_id, projectId).changes === 1)
  })()
  let processed = 0; let failed = 0
  for (const row of claimed) {
    try {
      const vectorDocId = `story-fact:${row.chunk_id}`
      if (!row.chunk_text || row.authority_status !== 'confirmed' || row.stale === 1) {
        await dependencies.removeDocument(input.projectPath, vectorDocId)
      } else {
        const source = parseObject(row.source_json ?? '{}')
        const vectors = await dependencies.generateEmbeddings(
          [row.chunk_text], input.embedding.protocol, input.embedding.model, input.embedding.model.embeddingOptions?.batchSize,
        )
        if (vectors.length !== 1) throw new Error(`Embedding 返回数量不匹配：期望 1，实际 ${vectors.length}`)
        const result = await dependencies.addChunks(input.projectPath, vectorDocId, `story-fact-${row.chunk_id}`, [row.chunk_text], vectors, undefined, {
          chapterNumber: row.chapter_number ?? undefined,
          corpusKind: 'project-knowledge', replacementMode: 'stable-id', factId: row.fact_id ?? undefined,
          sourceSnapshotId: typeof source.sourceSnapshotId === 'string' ? source.sourceSnapshotId : undefined,
          sourceFragmentId: typeof source.sourceFragmentId === 'string' ? source.sourceFragmentId : undefined,
          versionId: row.version_id ?? undefined, sourceType: 'confirmed-story-fact', authorityStatus: 'confirmed',
          startLine: typeof source.startLine === 'number' ? source.startLine : undefined,
          endLine: typeof source.endLine === 'number' ? source.endLine : undefined,
          stale: false,
        }, { modelFingerprint: embeddingFingerprint(input.embedding), distanceMetric: 'l2' })
        if (!result.success) throw new Error(result.error || '向量索引写入失败')
        database.prepare(`INSERT OR REPLACE INTO embedding_records (embedding_id, project_id, chunk_id, model_fingerprint, index_generation, vector_dimension, stale) VALUES (?, ?, ?, ?, 0, ?, 0)`).run(randomUUID(), projectId, row.chunk_id, embeddingFingerprint(input.embedding), vectors[0]?.length ?? 0)
      }
      database.prepare("UPDATE knowledge_index_queue SET status = 'completed', updated_at = datetime('now') WHERE queue_id = ? AND project_id = ?").run(row.queue_id, projectId)
      processed += 1
    } catch {
      database.prepare("UPDATE knowledge_index_queue SET status = 'failed', updated_at = datetime('now') WHERE queue_id = ? AND project_id = ?").run(row.queue_id, projectId)
      failed += 1
    }
  }
  return { processed, failed, waitingForEmbedding: false }
}

/** Fire-and-observe helper used after author approval; only one worker per project runs at once. */
export function scheduleKnowledgeIndexQueue(input: { projectId: string; projectPath: string; embedding?: RagEmbeddingConfig }): void {
  const existing = scheduledIndexRuns.get(input.projectId)
  if (existing) return
  const run = (async () => {
    try {
      for (;;) {
        const result = await processKnowledgeIndexQueue(input)
        // Failed rows remain retryable, but this background pass must yield after
        // a failure. Reclaiming the same failed row here would otherwise create a
        // tight loop while an embedding endpoint is unavailable.
        if (result.waitingForEmbedding || result.processed === 0 || result.failed > 0) return
      }
    } finally {
      scheduledIndexRuns.delete(input.projectId)
    }
  })()
  scheduledIndexRuns.set(input.projectId, run)
}
