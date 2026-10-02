import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'

import { getProjectDb } from '../../database'
import { BlueprintDetailRepository } from '../blueprint-detail-repository'

vi.mock('../../database', () => ({
  getProjectDb: vi.fn(),
}))

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

function createDb(dbPath = ':memory:'): BetterSqlite3.Database {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blueprints (
      chapter_number INTEGER PRIMARY KEY,
      volume_id TEXT NOT NULL DEFAULT 'volume-1',
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
    CREATE TABLE IF NOT EXISTS blueprint_details (
      chapter_number INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 2,
      detail_json   TEXT NOT NULL,
      raw_markdown  TEXT NOT NULL,
      revision      INTEGER NOT NULL,
      content_hash  TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS blueprint_detail_review_notices (
      chapter_number INTEGER PRIMARY KEY,
      notices_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  return db
}

interface SeedRow {
  chapterNumber: number
  title?: string
  purpose?: string
  keyEvents?: string
  suspenseHook?: string
  role?: string
  userGuidance?: string
  notes?: string
  volumeId?: string
}

function seedLegacyRow(db: BetterSqlite3.Database, row: SeedRow): void {
  db.prepare(`
    INSERT INTO blueprints (chapter_number, volume_id, title, role, purpose, key_events, characters, suspense_hook, user_guidance, notes, notes_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, '')
  `).run(
    row.chapterNumber,
    row.volumeId ?? 'volume-1',
    row.title ?? '',
    row.role ?? '',
    row.purpose ?? '',
    row.keyEvents ?? '',
    row.suspenseHook ?? '',
    row.userGuidance ?? '',
    row.notes ?? '',
  )
}

function detailRow(db: BetterSqlite3.Database, chapterNumber: number) {
  return db.prepare('SELECT * FROM blueprint_details WHERE chapter_number = ?').get(chapterNumber) as
    | { chapter_number: number; schema_version: number; detail_json: string; raw_markdown: string; revision: number; content_hash: string }
    | undefined
}

let db: BetterSqlite3.Database

beforeEach(() => {
  db = createDb()
  vi.mocked(getProjectDb).mockReturnValue(db)
})

describe('BlueprintDetailRepository.migrateLegacyRows（章节蓝图统一迁移）', () => {
  it('migrates legacy-only chapters into v2 details with revision 1 and upgrades origin', () => {
    seedLegacyRow(db, {
      chapterNumber: 3,
      title: '雨夜追击',
      purpose: '拿到账本。',
      keyEvents: '第一次反转。',
      suspenseHook: '第二张名单。',
      userGuidance: '保留压迫感。',
      volumeId: 'volume-2',
    })
    const result = BlueprintDetailRepository.migrateLegacyRows()
    expect(result.migrated).toEqual([3])
    expect(result.skipped).toEqual([])
    expect(result.failed).toEqual([])

    const row = detailRow(db, 3)
    expect(row).toBeDefined()
    expect(row!.revision).toBe(1)
    expect(row!.schema_version).toBe(2)
    const detail = JSON.parse(row!.detail_json) as { chapterTitle: string; origin: string; sections: Array<{ kind: string; id?: string; items?: Array<{ kind: string; label?: string; markdown?: string }> }> }
    expect(detail.chapterTitle).toBe('第3章｜雨夜追击')
    expect(detail.origin).toBe('upgrade')
    const mission = detail.sections
      .find(section => section.id === 'positioning')?.items
      ?.find(item => item.label === '核心使命')
    expect(mission?.markdown).toContain('拿到账本。')
    // 迁移不得改动原 v1 行（含独立字段与卷归属）。
    const legacy = db.prepare('SELECT * FROM blueprints WHERE chapter_number = 3').get() as { user_guidance: string; volume_id: string }
    expect(legacy.user_guidance).toBe('保留压迫感。')
    expect(legacy.volume_id).toBe('volume-2')
  })

  it('projects title/purpose/keyEvents/suspenseHook into the v1 row within the same save', () => {
    seedLegacyRow(db, {
      chapterNumber: 1,
      title: '旧题',
      purpose: '旧目标',
      keyEvents: '旧事件',
      suspenseHook: '旧钩子',
    })
    BlueprintDetailRepository.migrateLegacyRows({ chapterNumbers: [1] })
    const projected = db.prepare('SELECT title, purpose, key_events, suspense_hook FROM blueprints WHERE chapter_number = 1').get() as
      { title: string; purpose: string; key_events: string; suspense_hook: string }
    expect(projected.title).toBe('旧题')
    expect(projected.purpose).toBe('旧目标')
    expect(projected.suspense_hook).toBe('旧钩子')
    // 无分镜 → 关键事件投影为空 → 保留旧值。
    expect(projected.key_events).toBe('旧事件')
  })

  it('is idempotent: reruns never duplicate rows or bump revisions', () => {
    seedLegacyRow(db, { chapterNumber: 1, title: '甲', purpose: '目标' })
    seedLegacyRow(db, { chapterNumber: 2, title: '乙', suspenseHook: '钩子' })
    const first = BlueprintDetailRepository.migrateLegacyRows()
    expect(first.migrated.sort()).toEqual([1, 2])
    const snapshot = db.prepare('SELECT chapter_number, revision, content_hash FROM blueprint_details ORDER BY chapter_number').all()
    const second = BlueprintDetailRepository.migrateLegacyRows()
    expect(second.migrated).toEqual([])
    expect(second.skipped).toEqual([])
    expect(db.prepare('SELECT chapter_number, revision, content_hash FROM blueprint_details ORDER BY chapter_number').all()).toEqual(snapshot)
    expect((db.prepare('SELECT COUNT(*) AS n FROM blueprint_details').get() as { n: number }).n)
      .toBe(2)
  })

  it('skips content-less legacy rows so workflow bulk writes can still fill them', () => {
    seedLegacyRow(db, { chapterNumber: 1 })
    seedLegacyRow(db, { chapterNumber: 2, role: '发展' })
    seedLegacyRow(db, { chapterNumber: 3, userGuidance: '只有作者指导的占位章' })
    const result = BlueprintDetailRepository.migrateLegacyRows()
    expect(result.migrated).toEqual([])
    expect(result.skipped.map(item => item.chapterNumber).sort()).toEqual([1, 2, 3])
    expect((db.prepare('SELECT COUNT(*) AS n FROM blueprint_details').get() as { n: number }).n)
      .toBe(0)
  })

  it('preserves original data when a chapter fails to migrate, and still migrates the rest', () => {
    seedLegacyRow(db, { chapterNumber: 1, title: '好章', purpose: '目标' })
    // chapter_number=0 会在构建/校验阶段被拒绝（章节号无效），模拟单章失败。
    db.prepare(`
      INSERT INTO blueprints (chapter_number, title, purpose) VALUES (0, '坏章', '目标')
    `).run()
    seedLegacyRow(db, { chapterNumber: 2, title: '另一章', suspenseHook: '钩子' })

    const result = BlueprintDetailRepository.migrateLegacyRows()
    expect(result.migrated.sort()).toEqual([1, 2])
    expect(result.failed.map(item => item.chapterNumber)).toEqual([0])
    expect(result.failed[0].error).toContain('章节号无效')
    // 失败章的 v1 行原样保留，未产生半截 v2 数据。
    const broken = db.prepare('SELECT title, purpose FROM blueprints WHERE chapter_number = 0').get() as { title: string; purpose: string }
    expect(broken.title).toBe('坏章')
    expect(broken.purpose).toBe('目标')
    expect(detailRow(db, 0)).toBeUndefined()
    // 失败章在数据修复（删除无效行）后可重试迁移。
    db.prepare('DELETE FROM blueprints WHERE chapter_number = 0').run()
    const retry = BlueprintDetailRepository.migrateLegacyRows()
    expect(retry.migrated).toEqual([])
  })

  it('does not touch chapters that already have a v2 detail', () => {
    seedLegacyRow(db, { chapterNumber: 1, title: '已有细纲', purpose: '目标' })
    const content = {
      schemaVersion: 2 as const,
      chapterNumber: 1,
      chapterTitle: '第1章｜作者手写',
      docPreamble: '',
      sections: [],
      origin: 'manual' as const,
    }
    const saved = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content })
    expect(saved.success).toBe(true)
    const before = detailRow(db, 1)

    const result = BlueprintDetailRepository.migrateLegacyRows()
    expect(result.migrated).toEqual([])
    expect(detailRow(db, 1)).toEqual(before)
  })

  it('returns empty result instead of throwing when tables are missing', () => {
    db.exec('DROP TABLE blueprint_details')
    const result = BlueprintDetailRepository.migrateLegacyRows()
    expect(result).toEqual({ migrated: [], skipped: [], failed: [] })
  })
})
