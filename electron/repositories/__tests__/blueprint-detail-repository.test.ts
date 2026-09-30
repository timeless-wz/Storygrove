/**
 * BlueprintDetailRepository 测试（docs/blueprint-v2-contract.md §5/§6/§7、§12.3 A 底线）。
 * 全部写操作发生在临时内存库；验证 save/conflict/投影/损坏读取/删除/守卫查询与
 * 事务回滚（触发器制造写入失败，回滚后零残留）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type BetterSqlite3 from 'better-sqlite3'

import { getProjectDb } from '../../database'
import { BlueprintDetailRepository } from '../blueprint-detail-repository'
import { BlueprintRepository } from '../blueprint-repository'
import {
  assertValidChapterBlueprintV2Content,
  buildBlueprintV2UpgradeScaffold,
  computeBlueprintV2ContentHash,
} from '../../../src/shared/blueprint-v2'
import {
  parseChapterBlueprintMarkdown,
  serializeChapterBlueprintV2,
} from '../../../src/shared/blueprint-v2-markdown'

vi.mock('../../database', () => ({
  getProjectDb: vi.fn(),
}))

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../test/fixtures/blueprint-v2/chapter-01.md', import.meta.url)),
  'utf8',
)

function parsedChapter1(chapterNumber = 1) {
  const parsed = parseChapterBlueprintMarkdown(FIXTURE)
  return { ...parsed.content, chapterNumber }
}

function createDb(): BetterSqlite3.Database {
  const db = new Database(':memory:')
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
    CREATE TABLE IF NOT EXISTS project_core (
      id TEXT PRIMARY KEY,
      characters_arch TEXT DEFAULT ''
    );
    INSERT OR IGNORE INTO project_core (id, characters_arch) VALUES ('main', '');
  `)
  return db
}

/** 预置一行情景：作者已有人工 v1 蓝图（含定稿 notes 与作者指导）。 */
const SEEDED_V1 = {
  chapterNumber: 1,
  title: '旧版章名',
  role: '建置',
  purpose: '旧目的',
  keyEvents: '旧节拍一；旧节拍二',
  characters: JSON.stringify(['许渡', '周晓']),
  suspenseHook: '旧钩子',
  userGuidance: '作者手写指导，永不许覆盖',
  notes: '定稿后自动生成的章节要点',
  notesUpdatedAt: '2026-01-01 00:00:00',
}

function seedV1(db: BetterSqlite3.Database, data = SEEDED_V1): void {
  db.prepare(`
    INSERT INTO blueprints (
      chapter_number, title, role, purpose, key_events, characters,
      suspense_hook, user_guidance, notes, notes_updated_at
    ) VALUES (@chapterNumber, @title, @role, @purpose, @keyEvents, @characters,
              @suspenseHook, @userGuidance, @notes, @notesUpdatedAt)
  `).run(data)
}

function v1Row(db: BetterSqlite3.Database, chapterNumber = 1): Record<string, unknown> {
  return db.prepare('SELECT * FROM blueprints WHERE chapter_number = ?').get(chapterNumber) as Record<string, unknown>
}

function detailRow(db: BetterSqlite3.Database, chapterNumber = 1): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM blueprint_details WHERE chapter_number = ?').get(chapterNumber) as Record<string, unknown> | undefined
}

let db: BetterSqlite3.Database

beforeEach(() => {
  db = createDb()
  vi.mocked(getProjectDb).mockReturnValue(db as never)
})

describe('无库 / 无数据', () => {
  it('项目库未打开时抛错（load-error 模式，与"细纲不存在"可区分）', () => {
    vi.mocked(getProjectDb).mockReturnValue(null)
    expect(() => BlueprintDetailRepository.get(1)).toThrow(/项目数据库未打开/)
    expect(() => BlueprintDetailRepository.getSummaryList()).toThrow(/项目数据库未打开/)
  })

  it('该章没有 v2 细纲 → get 返回 null，v1 照常可用', () => {
    seedV1(db)
    expect(BlueprintDetailRepository.get(1)).toBeNull()
    expect(BlueprintDetailRepository.chaptersWithDetails([1])).toEqual(new Set())
  })
})

describe('保存 → 读回（契约 §11.10/§11.11 证据）', () => {
  it('首次导入：revision 1、contentHash/raw_markdown 可核对、投影四列刷新、红线字段零变化', () => {
    seedV1(db)
    const content = parsedChapter1()
    const result = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content })
    expect(result.success).toBe(true)
    expect(result.revision).toBe(1)
    expect(result.contentHash).toBe(computeBlueprintV2ContentHash(content))

    const detail = BlueprintDetailRepository.get(1)
    expect(detail).not.toBeNull()
    expect(detail && 'unreadable' in detail ? false : true).toBe(true)
    if (!detail || 'unreadable' in detail) throw new Error('expected detail')
    expect(detail.revision).toBe(1)
    expect(detail.contentHash).toBe(result.contentHash)
    expect(detail.chapterTitle).toBe('第1章｜接错的人')
    expect(detail.rawMarkdown).toBe(serializeChapterBlueprintV2(content))
    expect(detail.rawMarkdown).toBe(FIXTURE)

    const v1 = v1Row(db)
    expect(v1.title).toBe('接错的人')
    expect(v1.purpose).toBe('第一屏完成生理惊醒与绝命工位现场建立；立住许渡面对求助时的职业反应习惯；在第1章末尾精准掷出全书第一个核心事件钩子——“末班公交驶出地图”。')
    expect(v1.key_events).toBe([
      '场景一：02:14的冷汗与声学隔离席',
      '场景二：桌面下的余温与失声的十七秒',
      '场景三：红灯尖鸣与接通线路',
      '场景四：开出地图的末班车',
    ].join('\n'))
    expect(v1.suspense_hook).toBe('“我想报警。”\n“我坐的末班车，好像开出地图了。”')
    // 红线 1 + §6.3 永不投影列：与导入前完全一致。
    expect(v1.role).toBe(SEEDED_V1.role)
    expect(v1.characters).toBe(SEEDED_V1.characters)
    expect(v1.user_guidance).toBe(SEEDED_V1.userGuidance)
    expect(v1.notes).toBe(SEEDED_V1.notes)
    expect(v1.notes_updated_at).toBe(SEEDED_V1.notesUpdatedAt)
  })

  it('该章没有 v1 行时同一事务补建投影行（role/notes/user_guidance 取默认）', () => {
    const result = BlueprintDetailRepository.save({ chapterNumber: 2, baseRevision: 0, content: parsedChapter1(2) })
    expect(result.success).toBe(true)
    const v1 = v1Row(db, 2)
    // 内容章号(2)与章题「第1章」不一致 → 按契约不剥前缀，title 保留章题原文。
    expect(v1.title).toBe('第1章｜接错的人')
    expect(v1.role).toBe('')
    expect(v1.notes).toBe('')
    expect(v1.user_guidance).toBe('')
  })

  it('summary-list 轻量载荷：sceneCount/wordBudget 正确，不含分镜正文与 rawMarkdown', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const list = BlueprintDetailRepository.getSummaryList()
    expect(list).toHaveLength(1)
    const summary = list[0]
    expect(summary.chapterNumber).toBe(1)
    expect(summary.sceneCount).toBe(4)
    expect(summary.wordBudget).toBe(4200)
    expect(summary.sceneTitles[0]).toBe('场景一：02:14的冷汗与声学隔离席')
    expect(summary.unreadable).toBeUndefined()
    const payload = JSON.stringify(list)
    expect(payload).not.toContain('**时空与环境**')
    expect(payload).not.toContain('源-锚-桥-能参数')
    expect(payload).not.toContain('rawMarkdown')
    expect(payload).not.toContain('第1章｜接错的人\\n\\n####')
  })
})

describe('乐观并发（契约 §7.2/§11.11）', () => {
  it('baseRevision=0 但已有细纲 → conflict + currentRevision，拒绝写入', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const result = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    expect(result).toMatchObject({ success: false, conflict: true, currentRevision: 1 })
    expect(BlueprintDetailRepository.get(1)).toMatchObject({ revision: 1 } as never)
  })

  it('过期 baseRevision → conflict；以当前 revision 重试 → revision+1', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const stale = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 99, content: parsedChapter1() })
    expect(stale).toMatchObject({ success: false, conflict: true, currentRevision: 1 })
    const ok = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 1, content: parsedChapter1() })
    expect(ok).toMatchObject({ success: true, revision: 2 })
  })

  it('内容章节号与目标章不一致、非法内容 → 零写入抛错', () => {
    BlueprintDetailRepository.chaptersWithDetails([3]) // 触发建表
    expect(() => BlueprintDetailRepository.save({ chapterNumber: 3, baseRevision: 0, content: parsedChapter1(1) }))
      .toThrow(/不一致/)
    expect(detailRow(db, 3)).toBeUndefined()
    const bad = parsedChapter1(3)
    bad.sections = [{ kind: 'custom', id: 'custom-x', title: '坏', level: 9, body: '' }]
    expect(() => BlueprintDetailRepository.save({ chapterNumber: 3, baseRevision: 0, content: bad })).toThrow(/标题级/)
    expect(detailRow(db, 3)).toBeUndefined()
  })
})

describe('分镜重排（契约 §8.3）', () => {
  it('合法重排：revision+1、keyEvents 投影随顺序刷新、raw_markdown 同步', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const detail = BlueprintDetailRepository.get(1)
    if (!detail || 'unreadable' in detail) throw new Error('expected detail')
    const scenes = detail.sections.flatMap(section => section.kind === 'canonical' && section.id === 'storyboard'
      ? section.items.filter(item => item.kind === 'scene').map(item => item.kind === 'scene' ? item.id : '')
      : [])
    const reordered = [...scenes].reverse()
    const result = BlueprintDetailRepository.saveSceneOrder({
      chapterNumber: 1, baseRevision: 1, orderedSceneIds: reordered,
    })
    expect(result.success).toBe(true)
    expect(result.revision).toBe(2)
    const after = BlueprintDetailRepository.get(1)
    if (!after || 'unreadable' in after) throw new Error('expected detail')
    expect(after.contentHash).not.toBe(detail.contentHash)
    expect(v1Row(db).key_events).toBe([
      '场景四：开出地图的末班车',
      '场景三：红灯尖鸣与接通线路',
      '场景二：桌面下的余温与失声的十七秒',
      '场景一：02:14的冷汗与声学隔离席',
    ].join('\n'))
    expect(after.rawMarkdown).toBe(serializeChapterBlueprintV2(after))
  })

  it('过期 baseRevision → conflict；非排列 → 抛错零写入', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const conflict = BlueprintDetailRepository.saveSceneOrder({
      chapterNumber: 1, baseRevision: 5, orderedSceneIds: [],
    })
    expect(conflict).toMatchObject({ success: false, conflict: true, currentRevision: 1 })
    const detail = BlueprintDetailRepository.get(1)
    if (!detail || 'unreadable' in detail) throw new Error('expected detail')
    const sceneIds = detail.sections.flatMap(section => section.kind === 'canonical' && section.id === 'storyboard'
      ? section.items.filter(item => item.kind === 'scene').map(item => item.kind === 'scene' ? item.id : '')
      : [])
    expect(() => BlueprintDetailRepository.saveSceneOrder({
      chapterNumber: 1, baseRevision: 1, orderedSceneIds: sceneIds.slice(0, 2),
    })).toThrow(/排列/)
    expect(BlueprintDetailRepository.get(1)).toMatchObject({ revision: 1 } as never)
  })
})

describe('读取容错（契约 §5.1）', () => {
  it('detail_json 损坏 → corrupt + raw_markdown 原文保留；summary 标记 unreadable', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    db.prepare('UPDATE blueprint_details SET detail_json = ? WHERE chapter_number = 1').run('{oops')
    const detail = BlueprintDetailRepository.get(1)
    expect(detail && 'unreadable' in detail ? detail.unreadable : null).toBe('corrupt')
    expect(detail && 'unreadable' in detail ? detail.rawMarkdown : '').toContain('场景四：开出地图的末班车')
    const summary = BlueprintDetailRepository.getSummaryList()[0]
    expect(summary.unreadable).toBe('corrupt')
    expect(summary.sceneCount).toBe(0)
    // 损坏行的摘要仍然不携带正文。
    expect(JSON.stringify(summary)).not.toContain('源-锚-桥-能参数')
  })

  it('schema_version 超前 → needs-newer-app + 原文；显式删除是唯一清除方式', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    db.prepare('UPDATE blueprint_details SET schema_version = 3 WHERE chapter_number = 1').run()
    const detail = BlueprintDetailRepository.get(1)
    expect(detail && 'unreadable' in detail ? detail.unreadable : null).toBe('needs-newer-app')
    expect(detail && 'unreadable' in detail ? detail.storedSchemaVersion : null).toBe(3)
    expect(BlueprintDetailRepository.getSummaryList()[0].unreadable).toBe('needs-newer-app')
    BlueprintDetailRepository.delete(1)
    expect(BlueprintDetailRepository.get(1)).toBeNull()
  })
})

describe('删除与守卫查询（契约 §7.3/§7.4）', () => {
  it('删除只清 detail 行；v1 投影值保留；画布等其余数据不受影响', () => {
    seedV1(db)
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    expect(BlueprintDetailRepository.chaptersWithDetails([1, 2])).toEqual(new Set([1]))
    BlueprintDetailRepository.delete(1)
    expect(detailRow(db, 1)).toBeUndefined()
    const v1 = v1Row(db)
    expect(v1.title).toBe('接错的人') // 删除前的投影值保持
    expect(v1.notes).toBe(SEEDED_V1.notes)
    expect(BlueprintDetailRepository.chaptersWithDetails([1])).toEqual(new Set())
    expect(BlueprintDetailRepository.getSummaryList()).toEqual([])
  })
})

describe('v1 兼容（渐进升级，契约 §7.4）', () => {
  it('旧版简纲章：升级脚手架保存后 v1 四列有效值不变、红线字段不变', () => {
    seedV1(db)
    const scaffold = buildBlueprintV2UpgradeScaffold({
      chapterNumber: 1, title: SEEDED_V1.title, role: SEEDED_V1.role, purpose: SEEDED_V1.purpose,
      keyEvents: SEEDED_V1.keyEvents, characters: JSON.parse(SEEDED_V1.characters),
      suspenseHook: SEEDED_V1.suspenseHook, userGuidance: SEEDED_V1.userGuidance,
      notes: SEEDED_V1.notes, notesUpdatedAt: SEEDED_V1.notesUpdatedAt,
    })
    assertValidChapterBlueprintV2Content(scaffold)
    const result = BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: scaffold })
    expect(result.success).toBe(true)
    const detail = BlueprintDetailRepository.get(1)
    if (!detail || 'unreadable' in detail) throw new Error('expected detail')
    expect(detail.origin).toBe('upgrade')
    const storyboard = detail.sections.find(section => section.kind === 'canonical' && section.id === 'storyboard')
    expect(storyboard && storyboard.kind === 'canonical' ? storyboard.items : []).toEqual([])
    const v1 = v1Row(db)
    expect(v1.title).toBe(SEEDED_V1.title)
    expect(v1.purpose).toBe(SEEDED_V1.purpose)
    expect(v1.key_events).toBe(SEEDED_V1.keyEvents) // storyboard 留空 → 空推导保持旧值
    expect(v1.suspense_hook).toBe(SEEDED_V1.suspenseHook)
    expect(v1.role).toBe(SEEDED_V1.role)
    expect(v1.characters).toBe(SEEDED_V1.characters)
    expect(v1.user_guidance).toBe(SEEDED_V1.userGuidance)
    expect(v1.notes).toBe(SEEDED_V1.notes)
  })

  it('v1 通道（db:blueprint-upsert 的仓库层）写 v1 行时不动 detail 行（守卫在调用方，缺口 §13.1）', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const before = detailRow(db, 1)
    BlueprintRepository.upsert({
      chapterNumber: 1, title: 'AI 生成标题', role: '高潮', purpose: 'AI 目的', keyEvents: 'AI 节拍',
      characters: ['某人'], suspenseHook: 'AI 钩子', userGuidance: '', notes: '', notesUpdatedAt: '',
    })
    expect(detailRow(db, 1)).toEqual(before)
    expect(v1Row(db).title).toBe('AI 生成标题')
  })
})

describe('失败回滚（契约 §7.1 证据）', () => {
  it('投影 UPDATE 被触发器中止 → 抛错回滚，detail 零残留', () => {
    seedV1(db)
    db.exec(`CREATE TRIGGER abort_blueprint_update BEFORE UPDATE ON blueprints
      BEGIN SELECT RAISE(ABORT, 'simulated projection failure'); END;`)
    expect(() => BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() }))
      .toThrow(/simulated projection failure/)
    expect(detailRow(db, 1)).toBeUndefined()
    expect(BlueprintDetailRepository.get(1)).toBeNull()
  })

  it('二次保存中途失败 → 旧 detail 与旧投影原样保留，revision 不变', () => {
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 0, content: parsedChapter1() })
    const before = detailRow(db, 1)
    const beforeV1 = v1Row(db)
    db.exec(`CREATE TRIGGER abort_blueprint_update AFTER UPDATE ON blueprints
      BEGIN SELECT RAISE(ABORT, 'simulated projection failure'); END;`)
    const edited = { ...parsedChapter1(), docPreamble: `${parsedChapter1().docPreamble}二次修改\n` }
    expect(() => BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: 1, content: edited }))
      .toThrow(/simulated projection failure/)
    expect(detailRow(db, 1)).toEqual(before)
    expect(v1Row(db)).toEqual(beforeV1)
    const detail = BlueprintDetailRepository.get(1)
    expect(detail).toMatchObject({ revision: 1 } as never)
  })
})
