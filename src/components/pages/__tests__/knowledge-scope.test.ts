import { describe, expect, it } from 'vitest'
import {
  isFullTextHit,
  readCorpusKind,
  readHitScope,
  resolveJumpTarget,
  summarizeCorpus,
} from '../knowledge-scope'
import type { KBDocument, SearchResult } from '../../../services/knowledge-service'

function document(overrides: Partial<KBDocument> & { id: string; fileName: string }): KBDocument {
  return {
    importedAt: '2026-01-01T00:00:00.000Z',
    chunkCount: 3,
    filePath: '',
    ...overrides,
  }
}

describe('knowledge corpus classification', () => {
  it('narrows runtime corpus kinds and never mistakes a missing field for the project corpus', () => {
    expect(readCorpusKind(document({ id: 'a', fileName: 'a.md' }))).toBe('unknown')
    expect(readCorpusKind({ ...document({ id: 'b', fileName: 'b.md' }), corpusKind: 'reference' } as KBDocument)).toBe('reference')
    expect(readCorpusKind({ ...document({ id: 'c', fileName: 'c.md' }), corpusKind: 'something-else' } as unknown as KBDocument)).toBe('unknown')
  })

  it('counts each corpus kind separately', () => {
    const summary = summarizeCorpus([
      { ...document({ id: 'a', fileName: '卷一/设定.md' }), corpusKind: 'project-knowledge' } as KBDocument,
      { ...document({ id: 'b', fileName: '参考.md' }), corpusKind: 'reference' } as KBDocument,
      document({ id: 'c', fileName: '旧数据.md' }),
    ])

    expect(summary).toEqual({ projectKnowledge: 1, reference: 1, unknown: 1, total: 3 })
  })
})

describe('search hit scope narrowing', () => {
  it('reads optional provenance fields and ignores malformed values', () => {
    const scope = readHitScope({
      text: '片段',
      score: 0.5,
      fileName: '卷一/设定.md',
      docId: 'doc-1',
      chapterNumber: 12,
      startLine: 4,
      endLine: 9,
      sourceSnapshotId: 'snap-1',
      authorityStatus: 'confirmed',
    } as SearchResult)

    expect(scope).toEqual({
      docId: 'doc-1',
      chapterNumber: 12,
      startLine: 4,
      endLine: 9,
      sourceSnapshotId: 'snap-1',
      authorityStatus: 'confirmed',
    })

    const malformed = readHitScope({
      text: '片段',
      score: 0.7,
      fileName: 'x.md',
      chapterNumber: '12',
      startLine: null,
    } as unknown as SearchResult)

    expect(malformed.chapterNumber).toBeNull()
    expect(malformed.startLine).toBeNull()
    expect(malformed.docId).toBeNull()
  })

  it('treats 0.5 as a full-text match rather than a similarity score', () => {
    expect(isFullTextHit(0.5)).toBe(true)
    expect(isFullTextHit(0.51)).toBe(false)
  })
})

describe('knowledge source jump resolution', () => {
  const indexedDocument = document({ id: 'doc-document', fileName: '卷一/设定.md' })

  it('opens a project document only when that path really exists in the project', () => {
    const hit: SearchResult = { text: '片段', score: 0.9, fileName: '卷一/设定.md', docId: 'doc-document' } as SearchResult

    expect(resolveJumpTarget(hit, [indexedDocument], new Set(['卷一/设定.md']))).toEqual({
      kind: 'project-document',
      documentPath: '卷一/设定.md',
      documentName: '卷一/设定.md',
    })
  })

  it('does not offer a document jump for an imported corpus that merely looks like a document path', () => {
    const hit: SearchResult = { text: '片段', score: 0.9, fileName: '卷一/设定.md', docId: 'doc-document' } as SearchResult

    expect(resolveJumpTarget(hit, [indexedDocument], new Set())).toEqual({
      kind: 'none',
      reason: 'not-a-project-document',
    })
  })

  it('labels reference material as search-only instead of offering a jump', () => {
    const referenceDocument = { ...document({ id: 'doc-reference', fileName: '素材/参考.txt' }), corpusKind: 'reference' } as KBDocument
    const hit: SearchResult = { text: '片段', score: 0.5, fileName: '素材/参考.txt', docId: 'doc-reference' } as SearchResult

    expect(resolveJumpTarget(hit, [referenceDocument], new Set())).toEqual({
      kind: 'none',
      reason: 'reference-material',
    })
  })

  it('routes chapter corpora to the chapter context package using the real chapter number', () => {
    const hit: SearchResult = {
      text: '片段',
      score: 0.5,
      fileName: '第12章 雾港.md',
      docId: 'doc-chapter',
      chapterNumber: 12,
    } as SearchResult
    const chapterDocument = document({ id: 'doc-chapter', fileName: '第12章 雾港.md' })

    expect(resolveJumpTarget(hit, [chapterDocument], new Set())).toEqual({
      kind: 'chapter-context',
      chapterNumber: 12,
    })
  })

  it('reports an unknown corpus instead of inventing a destination', () => {
    const hit: SearchResult = { text: '片段', score: 0.5, fileName: '未知.md' } as SearchResult

    expect(resolveJumpTarget(hit, [], new Set())).toEqual({ kind: 'none', reason: 'not-indexed' })
  })
})
