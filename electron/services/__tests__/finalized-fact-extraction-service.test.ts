import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { extractFinalizedDraftFactCandidates } from '../finalized-fact-extraction-service'

const roots: string[] = []
afterEach(() => { closeProjectDatabase(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('finalized draft fact extraction', () => {
  it('creates traceable candidates only from final author prose and leaves formal facts untouched', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-final-candidates-')); roots.push(root)
    initProjectDatabase(root)
    const db = getProjectDb()!
    const contentId = Number(db.prepare('INSERT INTO contents (body) VALUES (?)').run('人物：林岚\n伏笔：门后的钟声').lastInsertRowid)
    const draftId = Number(db.prepare("INSERT INTO drafts (chapter_number, version, status, content_id, word_count) VALUES (31, 1, 'finalized', ?, 10)").run(contentId).lastInsertRowid)
    const candidates = extractFinalizedDraftFactCandidates('main', draftId)
    expect(candidates).toHaveLength(2)
    expect(candidates[0]?.provenance).toMatchObject({ sourceId: `finalized-draft:${draftId}`, sourceSnapshotId: 'finalized-v1', sourceFile: `internal://finalized-drafts/${draftId}/v1` })
    expect(db.prepare("SELECT COUNT(*) AS count FROM story_facts WHERE project_id = 'main' AND status = 'confirmed'").get()).toEqual({ count: 0 })
  })

  it('rejects draft bodies that have not been finalized', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-final-candidates-draft-')); roots.push(root)
    initProjectDatabase(root)
    const db = getProjectDb()!
    const contentId = Number(db.prepare('INSERT INTO contents (body) VALUES (?)').run('人物：林岚').lastInsertRowid)
    const draftId = Number(db.prepare("INSERT INTO drafts (chapter_number, version, status, content_id, word_count) VALUES (31, 1, 'draft', ?, 4)").run(contentId).lastInsertRowid)
    expect(() => extractFinalizedDraftFactCandidates('main', draftId)).toThrow(/当前定稿/u)
  })
})
