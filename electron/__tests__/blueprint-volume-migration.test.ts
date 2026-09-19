import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
const roots: string[] = []

afterEach(() => {
  closeProjectDatabase()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('blueprint volume migration', () => {
  it('adds the legacy volume column before creating its index', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-blueprint-volume-'))
    roots.push(projectRoot)
    const velaRoot = path.join(projectRoot, '.vela')
    fs.mkdirSync(velaRoot, { recursive: true })

    const legacyDb = new Database(path.join(velaRoot, 'vela.db'))
    legacyDb.exec(`
      CREATE TABLE blueprints (
        chapter_number INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        role TEXT DEFAULT '',
        purpose TEXT DEFAULT '',
        key_events TEXT DEFAULT '',
        characters TEXT DEFAULT '[]',
        suspense_hook TEXT DEFAULT '',
        user_guidance TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        notes_updated_at TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO blueprints (chapter_number, title) VALUES (1, '旧章节');
    `)
    legacyDb.close()

    initProjectDatabase(projectRoot)

    expect(getProjectDb()!.prepare('PRAGMA table_info(blueprints)').all())
      .toContainEqual(expect.objectContaining({ name: 'volume_id' }))
    expect(getProjectDb()!.prepare(
      'SELECT chapter_number, volume_id FROM blueprints WHERE chapter_number = 1',
    ).get()).toEqual({ chapter_number: 1, volume_id: 'volume-1' })
    expect(getProjectDb()!.prepare(
      'SELECT id, name, sort_order FROM blueprint_volumes',
    ).all()).toEqual([{ id: 'volume-1', name: '第1卷', sort_order: 1 }])
  })
})
