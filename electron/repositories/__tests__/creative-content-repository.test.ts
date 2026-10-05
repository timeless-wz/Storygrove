import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getProjectDb } from '../../database'
import type { ProjectCoreData } from '../project-core-repository'
import { CreativeContentRepository } from '../creative-content-repository'
import { ensureCreativeContentSchema } from '../../services/creative-content-schema'

vi.mock('../../database', () => ({ getProjectDb: vi.fn() }))

function core(overrides: Partial<ProjectCoreData> = {}): ProjectCoreData {
  return {
    coreOutline: '# 前提\n\n主角从港口出发。',
    worldSetting: '# 背景\n\n城市沿潮汐运转。',
    goldenFinger: '',
    protagonistProfile: '',
    globalGuidance: '',
    writingStyle: '',
    ...overrides,
  } as ProjectCoreData
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('CreativeContentRepository', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE project_core (
        id TEXT PRIMARY KEY,
        core_outline TEXT NOT NULL DEFAULT '',
        world_setting TEXT NOT NULL DEFAULT '',
        golden_finger TEXT NOT NULL DEFAULT '',
        protagonist_profile TEXT NOT NULL DEFAULT '',
        global_guidance TEXT NOT NULL DEFAULT '',
        writing_style TEXT NOT NULL DEFAULT ''
      );
    `)
    db.prepare('INSERT INTO project_core(id, core_outline, world_setting) VALUES(?, ?, ?)')
      .run('main', '# 前提\n\n主角从港口出发。', '# 背景\n\n城市沿潮汐运转。')
    ensureCreativeContentSchema(db)
    vi.mocked(getProjectDb).mockReturnValue(db)
  })

  afterEach(() => db.close())

  it('keeps legacy text pending until explicitly organized and reopens it when its source changes', () => {
    const initial = core()
    const pending = CreativeContentRepository.listLegacySources(initial)
    const source = pending.find(item => item.sourceField === 'coreOutline')!
    expect(source.disposition).toBe('pending')
    expect(source.content).toContain('主角从港口出发')

    CreativeContentRepository.organizeLegacySource({
      sourceField: 'coreOutline',
      expectedHash: source.contentHash,
      disposition: 'organized',
      targetCategories: ['premise'],
    })
    expect(CreativeContentRepository.listLegacySources(initial).find(item => item.sourceField === 'coreOutline')?.disposition)
      .toBe('organized')
    expect(db.prepare('SELECT COUNT(*) AS count FROM creative_legacy_organization').get())
      .toEqual({ count: 1 })

    expect(() => CreativeContentRepository.organizeLegacySource({
      sourceField: 'coreOutline', expectedHash: '0'.repeat(64), disposition: 'organized', targetCategories: ['premise'],
    })).toThrow('旧内容已变化')
    expect(CreativeContentRepository.listLegacySources(core({ coreOutline: '# 新前提\n\n另一段原文。' }))
      .find(item => item.sourceField === 'coreOutline')?.disposition).toBe('pending')
  })

  it('persists and filters long Markdown records with revision compare-and-swap', () => {
    const markdown = `# 遗境候选\n\n> 来源：04_事件与遗境库.md / 潮汐井\n\n| 线索 | 代价 |\n| --- | --- |\n| ${'中文场景文本'.repeat(20)} | 记忆损耗 |`
    const saved = CreativeContentRepository.saveMaterial({
      title: '潮汐井', entryKind: 'material', materialType: 'relic', status: 'candidate',
      markdown, sourceFileName: '04_事件与遗境库.md', sourceHeading: '潮汐井', expectedRevision: null,
    })
    expect(saved.markdown).toBe(markdown)
    expect(CreativeContentRepository.getMaterial(saved.id)?.sourceHeading).toBe('潮汐井')
    expect(CreativeContentRepository.listMaterials({ entryKind: 'material', status: 'candidate' }))
      .toEqual([saved])

    const updated = CreativeContentRepository.saveMaterial({
      ...saved, markdown: `${markdown}\n\n## 已补充细节`, expectedRevision: saved.revision,
    })
    expect(updated.revision).toBe(saved.revision + 1)
    expect(updated.markdown).toContain('已补充细节')
    expect(() => CreativeContentRepository.saveMaterial({
      ...saved, markdown: '旧标签页不能覆盖新版本。', expectedRevision: saved.revision,
    })).toThrow('资料已在其他位置更新')
    expect(CreativeContentRepository.getMaterial(saved.id)?.markdown).toContain('已补充细节')
  })

  it('preserves the exact SHA-256 source identity used by the pending-content ledger', () => {
    expect(core().coreOutline).toBe('# 前提\n\n主角从港口出发。')
    expect(sha256(core().coreOutline)).toHaveLength(64)
  })
})
