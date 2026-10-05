import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import { ensureCultivationSchema } from './cultivation-schema'
import { CharacterRosterRepository } from './character-roster-repository'
import { cultivationFullName, cultivationLevels, validateCultivationRealms, type CultivationSaveRequest, type CultivationSaveResult, type CultivationSystem } from '../../src/shared/cultivation'

export class CultivationRepository {
  static resolveName(id: string): string {
    const db = getProjectDb()
    if (!db) return ''
    const row = db.prepare('SELECT r.name AS realm, l.name AS stage FROM cultivation_levels l JOIN cultivation_realms r ON r.id=l.realm_id WHERE l.id=?').get(id) as { realm: string; stage: string | null } | undefined
    return row ? cultivationFullName(row.realm, row.stage) : ''
  }
  static read(): CultivationSystem {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    ensureCultivationSchema(db)
    const { revision, markdown } = db.prepare('SELECT revision, markdown FROM cultivation_meta WHERE id=1').get() as { revision: number; markdown: string }
    const realms = db.prepare('SELECT * FROM cultivation_realms ORDER BY position').all() as { id: string; name: string; level_id: string }[]
    return { revision, realms: realms.map(realm => ({ id: realm.id, name: realm.name, levelId: realm.level_id,
      stages: db.prepare('SELECT id,name FROM cultivation_levels WHERE realm_id=? AND name IS NOT NULL ORDER BY position').all(realm.id) as { id: string; name: string }[],
    })), markdown: markdown ?? '' }
  }

  static save(request: CultivationSaveRequest): CultivationSaveResult {
    const db = getProjectDb()
    if (!db) throw new Error('项目数据库未打开')
    ensureCultivationSchema(db)
    validateCultivationRealms(request?.realms)
    if (!request.resolutions || typeof request.resolutions !== 'object' || Array.isArray(request.resolutions)) throw new Error('Invalid impact resolutions / 影响处理格式无效')
    if (request.markdown !== undefined && (typeof request.markdown !== 'string' || request.markdown.length > 1_000_000)) throw new Error('力量体系 Markdown 无效')
    return db.transaction(() => {
      const before = this.read()
      const markdown = request.markdown ?? before.markdown ?? ''
      if (before.revision !== request.expectedRevision) throw new Error('等级设置已更新，请重新加载 / Cultivation settings changed; reload')
      const roster = CharacterRosterRepository.read()
      if (roster.revision !== request.expectedRosterRevision) throw new Error('角色已更新，请重新加载 / Characters changed; reload')
      if ((roster.status === 'inconsistent' && roster.migrationState !== 'legacy_cards_preserved') || roster.status === 'legacy_repair_required') throw new Error('请先修复角色名单 / Repair the roster first')
      const levels = cultivationLevels(request.realms)
      const valid = new Set(levels.map(level => level.id))
      for (const realm of request.realms) {
        const original = before.realms.find(entry => entry.id === realm.id)
        if (original && original.levelId !== realm.levelId) throw new Error('大境界完整等级标识必须保持稳定 / Realm level identity must remain stable')
      }
      const affected = roster.entries.filter(entry => entry.cultivationLevelId && !valid.has(entry.cultivationLevelId))
      for (const entry of affected) {
        if (!Object.hasOwn(request.resolutions, entry.name)) throw new Error(`必须处理角色「${entry.name}」的等级引用 / Resolve character ${entry.name}`)
        const target = request.resolutions[entry.name]
        if (target !== null && (typeof target !== 'string' || !valid.has(target))) throw new Error('重新指定的等级无效 / Invalid replacement level')
      }
      if (Object.keys(request.resolutions).some(name => !affected.some(entry => entry.name === name))) throw new Error('影响名单已变更 / Impact list changed')
      const entries = roster.entries.map(entry => {
        if (!affected.some(impact => impact.name === entry.name)) return entry
        return { ...entry, cultivationLevelId: request.resolutions[entry.name] }
      })
      const receipt = CharacterRosterRepository.commit({ operationId: `cultivation-${randomUUID()}`, expectedRevision: roster.revision, schemaVersion: 1, intent: roster.migrationState === 'legacy_cards_preserved' ? 'legacy_cards_adoption' : 'manual_edit', expectedLegacyMarkdown: roster.legacyMarkdown ?? '', entries }, () => {
        // A stable identity cannot be moved to another realm or reused as a different kind.
        const oldOwners = new Map(before.realms.flatMap(realm => [
          [realm.id, `realm:${realm.id}`], [realm.levelId, `base:${realm.id}`], ...realm.stages.map(stage => [stage.id, `stage:${realm.id}`]),
        ] as [string, string][]))
        for (const realm of request.realms) {
          for (const [id, owner] of [[realm.id, `realm:${realm.id}`], [realm.levelId, `base:${realm.id}`], ...realm.stages.map(stage => [stage.id, `stage:${realm.id}`])]) {
            if (oldOwners.has(id) && oldOwners.get(id) !== owner) throw new Error('不能复用等级身份 / Cannot reuse level identity')
          }
          db.prepare('INSERT INTO cultivation_realms(id,name,level_id,position) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position').run(realm.id, realm.name.trim(), realm.levelId, request.realms.indexOf(realm))
        }
        for (const level of levels) db.prepare('INSERT INTO cultivation_levels(id,realm_id,name,position) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,position=excluded.position').run(level.id, level.realmId, level.stageId ? request.realms.find(realm => realm.id === level.realmId)!.stages.find(stage => stage.id === level.id)!.name.trim() : null, level.number)
      })
      // Legacy adoption preserves cards; a configuration cannot silently rebind them.
      if (roster.migrationState === 'legacy_cards_preserved' && affected.length) throw new Error('请先保存角色档案再处理等级引用')
      for (const row of db.prepare('SELECT id FROM cultivation_levels').all() as { id: string }[]) {
        if (!valid.has(row.id)) db.prepare('DELETE FROM cultivation_levels WHERE id=?').run(row.id)
      }
      for (const realm of before.realms) if (!request.realms.some(next => next.id === realm.id)) db.prepare('DELETE FROM cultivation_realms WHERE id=?').run(realm.id)
      db.prepare('UPDATE cultivation_meta SET revision=revision+1, markdown=? WHERE id=1').run(markdown)
      return { system: this.read(), roster: receipt.snapshot }
    })()
  }
}
