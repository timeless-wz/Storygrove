import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type BetterSqlite3 from 'better-sqlite3'

import { getProjectDb } from '../../database'
import { BlueprintDetailRepository } from '../blueprint-detail-repository'
import { BlueprintRepository } from '../blueprint-repository'
import {
  MAX_BLUEPRINT_V2_SCENE_TITLE,
  computeBlueprintV2ContentHash,
  getBlueprintV2Scenes,
  type ChapterBlueprintV2Content,
} from '../../../src/shared/blueprint-v2'
import {
  assertNoLossOnSerialize,
  parseChapterBlueprintMarkdown,
} from '../../../src/shared/blueprint-v2-markdown'

vi.mock('../../database', () => ({
  getProjectDb: vi.fn(),
}))

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

const fixturePath = path.join(__dirname, '../../../test/fixtures/blueprint-v2/chapter-01.md')
const fixture = readFileSync(fixturePath, 'utf8')

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
    CREATE TABLE IF NOT EXISTS project_core (
      id TEXT PRIMARY KEY,
      characters_arch TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO project_core (id, characters_arch) VALUES ('main', '');
  `)
  return db
}

function importedChapter1Content(chapterNumber = 1): ChapterBlueprintV2Content {
  const { content } = parseChapterBlueprintMarkdown(fixture)
  return { ...content, chapterNumber }
}

function seedBlueprint(db: BetterSqlite3.Database, chapterNumber = 1): void {
  db.prepare(`
    INSERT INTO blueprints (chapter_number, title, role, purpose, key_events, characters, suspense_hook, user_guidance, notes, notes_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chapterNumber,
    '旧标题',
    '建置',
    '旧目的',
    '旧节拍',
    JSON.stringify(['许渡']),
    '旧钩子',
    '作者微操指导原文',
    '定稿要点原文',
    '2026-01-01 00:00:00',
  )
}

let db: BetterSqlite3.Database

beforeEach(() => {
  db = createDb()
  vi.mocked(getProjectDb).mockReturnValue(db as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
})

describe('BlueprintDetailRepository（临时内存库）', () => {
  it('完整第1章在落盘临时项目中导入、回读、重排、移出画布及删除分镜', () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'blueprint-v2-acceptance-'))
    const dbPath = path.join(projectDir, 'project.db')
    const diskDb = createDb(dbPath)
    vi.mocked(getProjectDb).mockReturnValue(diskDb as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
    try {
      const parsed = parseChapterBlueprintMarkdown(fixture)
      expect(parsed.content.sections.filter(section => section.kind === 'canonical')).toHaveLength(7)
      expect(assertNoLossOnSerialize(parsed.content)).toBe(fixture.replace(/\r\n/g, '\n'))
      expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsed.content }).success).toBe(true)

      let detail = BlueprintDetailRepository.get(1)!
      const bySection = (id: string) => detail.sections.find(section => section.kind === 'canonical' && section.id === id)
      const sectionItems = (id: string) => {
        const section = bySection(id)
        return section?.kind === 'canonical' ? section.items : []
      }
      const sectionMarkdown = (id: string) => sectionItems(id).map(item => 'markdown' in item ? item.markdown : '').join('')
      expect(sectionItems('conflict').filter(item => item.kind === 'field')).toHaveLength(2)
      expect(sectionMarkdown('rules')).toContain('**源-锚-桥-能参数**')
      expect(sectionMarkdown('cliffhanger')).toContain('> “我坐的末班车，好像开出地图了。”')
      expect(sectionMarkdown('foreshadow')).toContain('十七秒断裂音频')
      expect(sectionMarkdown('taboos')).toContain('严禁出现游戏化属性面板')
      expect(BlueprintDetailRepository.getSummaryList()[0].wordBudget).toBe(4200)
      const original = getBlueprintV2Scenes(detail)
      expect(original).toHaveLength(4)
      expect(original.map(scene => scene.markdown)).toEqual(getBlueprintV2Scenes(parsed.content).map(scene => scene.markdown))

      const order = [original[3].sceneId, original[0].sceneId, original[1].sceneId, original[2].sceneId]
      expect(BlueprintDetailRepository.saveSceneOrder({ chapterNumber: 1, baseRevision: 1, orderedSceneIds: order }).success).toBe(true)
      diskDb.close()
      const reopened = new Database(dbPath)
      vi.mocked(getProjectDb).mockReturnValue(reopened as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
      try {
        detail = BlueprintDetailRepository.get(1)!
        expect(getBlueprintV2Scenes(detail).map(scene => scene.sceneId)).toEqual(order)
        expect(getBlueprintV2Scenes(detail)[0].markdown).toBe(original[3].markdown)
        const offCanvas = {
          ...detail,
          sections: detail.sections.map(section => section.kind === 'canonical' && section.id === 'storyboard'
            ? { ...section, items: section.items.map(item => item.kind === 'scene' && item.id === order[0]
              ? { ...item, presence: 'off-canvas' as const, canvasNodeId: undefined } : item) }
            : section),
        }
        expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: detail.revision, content: offCanvas }).success).toBe(true)
        detail = BlueprintDetailRepository.get(1)!
        expect(getBlueprintV2Scenes(detail)).toHaveLength(4)
        expect(getBlueprintV2Scenes(detail)[0].presence).toBe('off-canvas')
        const withoutScene = {
          ...detail,
          sections: detail.sections.map(section => section.kind === 'canonical' && section.id === 'storyboard'
            ? { ...section, items: section.items.filter(item => item.kind !== 'scene' || item.id !== order[0]) }
            : section),
        }
        expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: detail.revision, content: withoutScene }).success).toBe(true)
        detail = BlueprintDetailRepository.get(1)!
        expect(getBlueprintV2Scenes(detail).map(scene => scene.sceneId)).toEqual(order.slice(1))
      } finally { reopened.close() }
    } finally {
      if (diskDb.open) diskDb.close()
      unlinkSync(dbPath)
      rmdirSync(projectDir)
    }
  })
  it('save→get 往返：revision=1、contentHash 一致、rawMarkdown 无损（§11.9/§11.11）', () => {
    const content = importedChapter1Content()
    const result = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content })
    expect(result.success).toBe(true)
    expect(result.revision).toBe(1)
    expect(result.contentHash).toBe(computeBlueprintV2ContentHash(content))

    const detail = BlueprintDetailRepository.get(1)
    expect(detail).not.toBeNull()
    expect(detail?.readStatus).toBeUndefined()
    expect(detail?.revision).toBe(1)
    expect(detail?.chapterTitle).toBe('第1章｜接错的人')
    expect(getBlueprintV2Scenes(detail!)).toHaveLength(4)
    // raw_markdown 与 detail 内容一致（规范导出），且可无损再解析。
    const raw = (db.prepare('SELECT raw_markdown FROM blueprint_details WHERE chapter_number = 1').get() as { raw_markdown: string }).raw_markdown
    expect(raw).toBe(assertNoLossOnSerialize(content))
    const reparsed = parseChapterBlueprintMarkdown(raw)
    expect(getBlueprintV2Scenes(reparsed.content).map(scene => scene.markdown))
      .toEqual(getBlueprintV2Scenes(content).map(scene => scene.markdown))
  })

  it('乐观并发：过期 baseRevision → conflict + currentRevision，拒绝写入（§7.2/§11.11）', () => {
    const content = importedChapter1Content()
    expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content }).success).toBe(true)
    const conflict = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content })
    expect(conflict.success).toBe(false)
    expect(conflict.conflict).toBe(true)
    expect(conflict.currentRevision).toBe(1)
    expect(BlueprintDetailRepository.get(1)?.revision).toBe(1)
  })

  it('投影事务：四列更新，role/characters/userGuidance/notes/notes_updated_at 逐字不变（§11.10）', () => {
    seedBlueprint(db)
    const content = importedChapter1Content()
    const result = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content })
    expect(result.success).toBe(true)
    const saved = BlueprintRepository.getByChapter(1)
    expect(saved?.title).toBe('接错的人')
    expect(saved?.purpose).toContain('末班公交驶出地图')
    expect(saved?.keyEvents.split('\n')).toHaveLength(4)
    expect(saved?.suspenseHook).toContain('开出地图')
    // v2 永不触碰的字段
    expect(saved?.role).toBe('建置')
    expect(saved?.characters).toEqual(['许渡'])
    expect(saved?.userGuidance).toBe('作者微操指导原文')
    expect(saved?.notes).toBe('定稿要点原文')
    expect(saved?.notesUpdatedAt).toBe('2026-01-01 00:00:00')
  })

  it('空推导不抹旧字段：无章题/无分镜的内容保存后旧投影保留（§6.3）', () => {
    seedBlueprint(db)
    const content = importedChapter1Content()
    const stripped: ChapterBlueprintV2Content = {
      ...content,
      chapterTitle: '',
      sections: content.sections.map(section => (
        section.kind === 'canonical' && section.id === 'storyboard'
          ? { ...section, items: section.items.filter(item => item.kind !== 'scene') }
          : section
      )),
    }
    const result = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: stripped })
    expect(result.success).toBe(true)
    const saved = BlueprintRepository.getByChapter(1)
    // 章题为空 → title 不动；无分镜 → keyEvents 不动。
    expect(saved?.title).toBe('旧标题')
    expect(saved?.keyEvents).toBe('旧节拍')
    // purpose / suspenseHook 仍由分区条目投影。
    expect(saved?.purpose).toContain('末班公交驶出地图')
  })

  it('scene-order-save：只改位次、revision+1；非法排列被拒绝（§6/§8.3）', () => {
    const content = importedChapter1Content()
    expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content }).success).toBe(true)
    const scenes = getBlueprintV2Scenes(BlueprintDetailRepository.get(1)!)
    const reordered = [scenes[2].sceneId, scenes[0].sceneId, scenes[1].sceneId, scenes[3].sceneId]
    const result = BlueprintDetailRepository.saveSceneOrder({
      chapterNumber: 1,
      baseRevision: 1,
      orderedSceneIds: reordered,
    })
    expect(result.success).toBe(true)
    expect(result.revision).toBe(2)
    const after = getBlueprintV2Scenes(BlueprintDetailRepository.get(1)!)
    expect(after.map(scene => scene.sceneId)).toEqual(reordered)
    // 内容逐字不变，仅位次变化。
    expect(after[0].markdown).toBe(scenes[2].markdown)
    // 非法排列（缺一个 id）。
    const bad = BlueprintDetailRepository.saveSceneOrder({
      chapterNumber: 1,
      baseRevision: 2,
      orderedSceneIds: reordered.slice(0, 3),
    })
    expect(bad.success).toBe(false)
    expect(bad.error).toBeTruthy()
  })

  it('delete：仅删 detail 行，blueprints 投影值保持删除前状态（§7.3）', () => {
    seedBlueprint(db)
    const content = importedChapter1Content()
    expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content }).success).toBe(true)
    BlueprintDetailRepository.delete(1)
    expect(BlueprintDetailRepository.get(1)).toBeNull()
    const saved = BlueprintRepository.getByChapter(1)
    expect(saved?.title).toBe('接错的人')
    expect(saved?.notes).toBe('定稿要点原文')
  })

  it('chaptersWithDetails：守卫查询（§7.4）', () => {
    const content = importedChapter1Content(2)
    expect(BlueprintDetailRepository.save({ chapterNumber: 2, baseRevision: 0, content }).success).toBe(true)
    const withDetails = BlueprintDetailRepository.chaptersWithDetails([1, 2, 3])
    expect(withDetails.has(2)).toBe(true)
    expect(withDetails.has(1)).toBe(false)
    expect(withDetails.has(3)).toBe(false)
    expect(BlueprintDetailRepository.chaptersWithDetails([]).size).toBe(0)
  })

  it('损坏 detail_json：readStatus=corrupt 且附 raw_markdown 原文（§5.1/§13.5）', () => {
    const content = importedChapter1Content()
    expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content }).success).toBe(true)
    db.prepare("UPDATE blueprint_details SET detail_json = '{broken' WHERE chapter_number = 1").run()
    const detail = BlueprintDetailRepository.get(1)
    expect(detail?.readStatus).toBe('corrupt')
    expect(detail?.rawMarkdown).toContain('场景一：02:14的冷汗与声学隔离席')
    // 修复性保存：损坏行允许以正确 baseRevision 覆盖。
    const repair = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 1, content })
    expect(repair.success).toBe(true)
    expect(BlueprintDetailRepository.get(1)?.readStatus).toBeUndefined()
  })

  it('schema_version 超前：读取 needs-newer-app、保存拒绝（§5.1）', () => {
    const content = importedChapter1Content()
    expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content }).success).toBe(true)
    db.prepare(`UPDATE blueprint_details SET schema_version = 3, detail_json = json_set(detail_json, '$.schemaVersion', 3) WHERE chapter_number = 1`).run()
    const detail = BlueprintDetailRepository.get(1)
    expect(detail?.readStatus).toBe('needs-newer-app')
    expect(detail?.storedSchemaVersion).toBe(3)
    expect(detail?.rawMarkdown).toContain('逐场分镜')
    const overwrite = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 1, content })
    expect(overwrite.success).toBe(false)
    expect(overwrite.error).toContain('更新版本')
  })

  it('summary-list：sceneCount/wordBudget 正确，载荷不含分镜正文与 rawMarkdown（§5.2/§11.12）', () => {
    const content = importedChapter1Content()
    expect(BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content }).success).toBe(true)
    const summaries = BlueprintDetailRepository.getSummaryList()
    expect(summaries).toHaveLength(1)
    const summary = summaries[0]
    expect(summary.chapterNumber).toBe(1)
    expect(summary.sceneCount).toBe(4)
    expect(summary.wordBudget).toBe(4200)
    expect(summary.sceneTitles[0]).toBe('场景一：02:14的冷汗与声学隔离席')

    const stored = db.prepare(
      'SELECT detail_json FROM blueprint_details WHERE chapter_number = 1',
    ).get() as { detail_json: string }
    const corrupt = JSON.parse(stored.detail_json) as ChapterBlueprintV2Content
    const storyboard = corrupt.sections.find(section => section.kind === 'canonical' && section.id === 'storyboard')
    if (!storyboard || storyboard.kind !== 'canonical') throw new Error('fixture storyboard missing')
    const firstScene = storyboard.items.find(item => item.kind === 'scene')
    if (!firstScene || firstScene.kind !== 'scene') throw new Error('fixture scene missing')
    firstScene.title = '场'.repeat(MAX_BLUEPRINT_V2_SCENE_TITLE + 1000)
    db.prepare('UPDATE blueprint_details SET detail_json = ? WHERE chapter_number = 1').run(JSON.stringify(corrupt))
    expect(BlueprintDetailRepository.getSummaryList()[0].sceneTitles[0])
      .toBe('场'.repeat(MAX_BLUEPRINT_V2_SCENE_TITLE))

    const payload = JSON.stringify(summaries)
    expect(payload).not.toContain('声学隔离席位')
    expect(payload).not.toContain('rawMarkdown')
    expect(payload).not.toContain('markdown')
  })
})
