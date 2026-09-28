import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'

import { getProjectDb } from '../../database'
import { DraftRepository } from '../draft-repository'

vi.mock('../../database', () => ({ getProjectDb: vi.fn() }))

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
let db: BetterSqlite3.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE contents (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
    CREATE TABLE drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      imported_title TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      source TEXT NOT NULL DEFAULT 'write',
      content_id INTEGER NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      source_dependencies TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chapter_number, version)
    );
  `)
  vi.mocked(getProjectDb).mockReturnValue(db)
  const contentId = Number(db.prepare('INSERT INTO contents (body) VALUES (?)').run('Existing finalized text').lastInsertRowid)
  db.prepare('INSERT INTO drafts (chapter_number, version, status, content_id, word_count) VALUES (1, 1, ?, ?, 1)')
    .run('finalized', contentId)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('DraftRepository.createImportedBatch', () => {
  it('atomically adds new draft versions without replacing the current finalized body', () => {
    const created = DraftRepository.createImportedBatch([
      { chapterNumber: 1, title: 'Imported title', content: 'Imported draft\nwith a line break', wordCount: 2 },
      { chapterNumber: 3, title: 'New chapter title', content: 'New chapter', wordCount: 1 },
    ])
    expect(created.map(item => [item.chapterNumber, item.version])).toEqual([[1, 2], [3, 1]])
    expect(db.prepare('SELECT status FROM drafts WHERE id = ?').get(created[0]!.id)).toEqual({ status: 'draft' })
    expect(db.prepare('SELECT imported_title FROM drafts WHERE id = ?').get(created[0]!.id)).toEqual({ imported_title: 'Imported title' })
    expect(db.prepare('SELECT body FROM contents WHERE id = (SELECT content_id FROM drafts WHERE chapter_number = 1 AND version = 1)').get())
      .toEqual({ body: 'Existing finalized text' })
    expect(db.prepare('SELECT body FROM contents WHERE id = (SELECT content_id FROM drafts WHERE id = ?)').get(created[0]!.id))
      .toEqual({ body: 'Imported draft\nwith a line break' })
  })

  it('rejects repeated chapter numbers before creating any content', () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM contents').get() as { count: number }
    expect(() => DraftRepository.createImportedBatch([
      { chapterNumber: 2, title: 'one', content: 'one', wordCount: 1 },
      { chapterNumber: 2, title: 'two', content: 'two', wordCount: 1 },
    ])).toThrow(/无效或章号重复/u)
    expect(db.prepare('SELECT COUNT(*) AS count FROM contents').get()).toEqual(before)
  })

  it('rolls back every inserted body and draft if a later insert fails', () => {
    db.exec(`
      CREATE TRIGGER reject_chapter_three
      BEFORE INSERT ON drafts
      WHEN NEW.chapter_number = 3
      BEGIN SELECT RAISE(ABORT, 'test insert failure'); END;
    `)
    expect(() => DraftRepository.createImportedBatch([
      { chapterNumber: 2, title: 'first', content: 'first body', wordCount: 1 },
      { chapterNumber: 3, title: 'second', content: 'second body', wordCount: 1 },
    ])).toThrow(/test insert failure/u)
    expect(db.prepare('SELECT COUNT(*) AS count FROM drafts').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM contents').get()).toEqual({ count: 1 })
  })
})
