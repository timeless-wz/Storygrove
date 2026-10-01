import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { CharacterRelationshipRepository } from '../character-relationship-repository'
import { CharacterRosterRepository } from '../character-roster-repository'
import { ProjectCoreRepository } from '../project-core-repository'
import { StoryTimelineRepository } from '../story-timeline-repository'
import { WorldMapRepository } from '../world-map-repository'
import { WorldWorkbenchRepository } from '../world-workbench-repository'
import { CHARACTER_ROSTER_SCHEMA_VERSION } from '../../../src/shared/character-roster'
import { createWorldEntityId } from '../../../src/shared/world-workbench'

const ROOT = path.resolve('.runtime/.cache/world-workbench-evidence')
const MORTAL_MAP = 'map-44444444-4444-4444-8444-444444444444'
const IMMORTAL_MAP = 'map-55555555-5555-4555-8555-555555555555'

describe('世界资料持久化：关闭并重开后从数据库读回', () => {
  afterAll(() => {
    closeProjectDatabase()
    try { fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 可再生缓存 */ }
  })

  it('reads back every new entity and relation from the database file', () => {
    fs.rmSync(ROOT, { recursive: true, force: true })
    fs.mkdirSync(ROOT, { recursive: true })
    initProjectDatabase(ROOT)
    ProjectCoreRepository.init('证据项目', 'zh-CN')

    const mortal = WorldWorkbenchRepository.upsertWorld({
      id: createWorldEntityId('world'), name: '凡人界', summary: '灵气稀薄', background: '', notes: '', sortOrder: 1,
    })
    const immortal = WorldWorkbenchRepository.upsertWorld({
      id: createWorldEntityId('world'), name: '修真界', summary: '灵气充沛', background: '', notes: '', sortOrder: 2,
    })
    WorldMapRepository.upsertMap({ id: MORTAL_MAP, name: '凡人界总图', parentMapId: null, sortOrder: 1, image: null })
    WorldMapRepository.upsertMap({ id: IMMORTAL_MAP, name: '修真界总图', parentMapId: null, sortOrder: 2, image: null })
    WorldMapRepository.upsertNode({ id: 'node-qtc-ev', name: '青石村', type: 'city', description: '', parentId: null, mapId: MORTAL_MAP, x: 1, y: 2, sourceRefs: [] })
    WorldMapRepository.upsertNode({ id: 'node-tmc-ev', name: '天门城', type: 'city', description: '', parentId: null, mapId: IMMORTAL_MAP, x: 3, y: 4, sourceRefs: [] })
    WorldWorkbenchRepository.applyMapWorldAssignment(MORTAL_MAP, mortal.id)
    WorldWorkbenchRepository.applyMapWorldAssignment(IMMORTAL_MAP, immortal.id)

    // 角色：走角色名单的同一业务提交。
    const snapshot = CharacterRosterRepository.read()
    CharacterRosterRepository.commit({
      operationId: 'evidence-roster',
      expectedRevision: snapshot.revision,
      schemaVersion: CHARACTER_ROSTER_SCHEMA_VERSION,
      entries: [{
        name: '林尘', role: 'protagonist', gender: '', age: '', appearance: '', personality: '',
        background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '',
      }],
      intent: 'manual_edit',
    })
    const heroId = CharacterRelationshipRepository.resolveIdentity('林尘')
    if (!heroId) throw new Error('人物身份未建立')

    const faction = WorldWorkbenchRepository.upsertFaction({
      id: createWorldEntityId('faction'), worldId: mortal.id, name: '青云门', type: '宗门',
      summary: '', description: '', seat: '', domainNote: '', notes: '',
    })
    WorldWorkbenchRepository.upsertFactionCharacter({
      id: '', factionId: faction.id, characterId: heroId, relation: '弟子', tenureNote: '入门三年', note: '',
    })
    WorldWorkbenchRepository.upsertFactionPlace({ id: '', factionId: faction.id, nodeId: 'node-qtc-ev', note: '' })
    const relic = WorldWorkbenchRepository.upsertRelic({
      id: createWorldEntityId('relic'), worldId: mortal.id, name: '古剑秘境', type: '秘境',
      summary: '', description: '', locationNote: '', nodeId: 'node-qtc-ev', entranceNodeId: 'node-qtc-ev',
      entryCondition: '需持剑令', danger: '', rewards: '', availabilityNote: '', status: 'sealed',
      customStatusLabel: '', notes: '',
    })
    WorldWorkbenchRepository.upsertRelicFaction({
      id: '', relicId: relic.id, factionId: faction.id, relation: 'control', customLabel: '', note: '',
    })
    WorldWorkbenchRepository.upsertPortal({
      id: createWorldEntityId('portal'), name: '登天梯', type: 'teleport', customTypeLabel: '',
      fromWorldId: mortal.id, toWorldId: immortal.id, fromNodeId: 'node-qtc-ev', toNodeId: 'node-tmc-ev',
      bidirectional: true, condition: '筑基以上', cost: '', scheduleNote: '', status: 'active',
      customStatusLabel: '', description: '', notes: '',
    })
    WorldWorkbenchRepository.saveBirthLocation({
      id: '', characterId: heroId, kind: 'birth', worldId: mortal.id, nodeId: 'node-qtc-ev', note: '村中老屋',
      storyTimeLabel: '', timePrecision: 'unknown', chapterNumber: null,
      boundLocationText: '', boundProvenanceKind: '', boundAt: '',
    })
    WorldWorkbenchRepository.commitCurrentLocation(heroId, immortal.id, 'node-tmc-ev', {
      storyTimeLabel: '大荒历 317 年冬', timePrecision: 'exact',
    })
    WorldWorkbenchRepository.commitTrail({
      trail: {
        id: createWorldEntityId('trail'), characterId: heroId, worldId: mortal.id, nodeId: 'node-qtc-ev',
        note: '', arrivedLabel: '大荒历 300 年', departedLabel: '', timePrecision: 'relative',
        sortOrder: 0, reason: '拜入青云门', chapterNumber: null, notes: '', portalId: null, eventId: null,
      },
      alsoSetCurrentLocation: false,
    })
    const event = StoryTimelineRepository.upsertEvent({
      id: 'evt-jmzz', title: '界门之战', timeLabel: '大荒历 500 年', sortOrder: -5, precision: 'exact',
      description: '两界通道开启后的第一场大战', chapterNumbers: [], characterNames: [],
      locationNodeIds: [], status: 'planned', isHistorical: true, outcome: '界门崩塌', aftermath: '两界隔绝三百年',
    })
    WorldWorkbenchRepository.saveEventLinks(event.id, [mortal.id, immortal.id], [
      { id: '', eventId: event.id, targetKind: 'faction', targetId: faction.id, worldId: null, relation: '参战', note: '' },
    ])

    // ---- 关闭并重新打开项目：以下每一行都来自磁盘上的 vela.db ----
    closeProjectDatabase()
    initProjectDatabase(ROOT)
    const db = getProjectDb()
    if (!db) throw new Error('数据库未打开')

    const dump = <T,>(sql: string): T[] => db.prepare(sql).all() as T[]
    const report = {
      worlds: dump<{ name: string; summary: string }>('SELECT name, summary FROM worlds ORDER BY sort_order'),
      mapWorldLinks: dump<{ mapId: string; worldId: string }>('SELECT id AS mapId, world_id AS worldId FROM world_maps ORDER BY sort_order'),
      factions: dump<{ worldId: string; name: string; type: string }>('SELECT world_id AS worldId, name, type FROM world_factions'),
      factionCharacters: dump<{ character: string; relation: string; tenure: string }>(`
        SELECT i.name AS character, fc.relation, fc.tenure_note AS tenure
        FROM world_faction_characters fc JOIN character_identities i ON i.character_id = fc.character_id
      `),
      factionPlaces: dump<{ nodeId: string; node: string }>('SELECT fp.node_id AS nodeId, n.name AS node FROM world_faction_places fp JOIN world_map_nodes n ON n.id = fp.node_id'),
      relics: dump<{ worldId: string; name: string; nodeId: string; entrance: string; status: string; entry: string }>('SELECT world_id AS worldId, name, node_id AS nodeId, entrance_node_id AS entrance, status, entry_condition AS entry FROM world_relics'),
      portals: dump<{ name: string; fromWorld: string; toWorld: string; fromNode: string; toNode: string; bidirectional: number }>('SELECT name, from_world_id AS fromWorld, to_world_id AS toWorld, from_node_id AS fromNode, to_node_id AS toNode, bidirectional FROM world_portals'),
      locations: dump<{ kind: string; worldId: string; nodeId: string; note: string; boundText: string; boundKind: string }>('SELECT kind, world_id AS worldId, node_id AS nodeId, note, bound_location_text AS boundText, bound_provenance_kind AS boundKind FROM world_character_locations ORDER BY kind'),
      characterState: dump<{ name: string; location: string; provenance: string }>("SELECT name, cs_location AS location, cs_provenance AS provenance FROM characters WHERE name = '林尘'"),
      trails: dump<{ worldId: string; nodeId: string; arrived: string; reason: string }>('SELECT world_id AS worldId, node_id AS nodeId, arrived_label AS arrived, reason FROM world_trails'),
      events: dump<{ id: string; title: string; timeLabel: string; sortOrder: number; isHistorical: number; outcome: string; aftermath: string }>('SELECT id, title, time_label AS timeLabel, sort_order AS sortOrder, is_historical AS isHistorical, outcome, aftermath FROM story_timeline_events'),
      eventWorlds: dump<{ eventId: string; worldId: string }>('SELECT event_id AS eventId, world_id AS worldId FROM world_event_worlds'),
      eventLinks: dump<{ kind: string; targetId: string; relation: string }>('SELECT target_kind AS kind, target_id AS targetId, relation FROM world_event_links'),
      migrations: dump<{ migration_id: string; schema_version: number }>('SELECT migration_id, schema_version FROM world_workbench_migrations'),
      storyRange: StoryTimelineRepository.getAll().settings,
    }
    // 一行可核对的读回摘要：这些数字全部来自重新打开后的 vela.db。
    console.log('[证据] 读回 ' + JSON.stringify({
      worlds: report.worlds.length,
      mapWorldLinks: report.mapWorldLinks.length,
      factions: report.factions.length,
      factionCharacters: report.factionCharacters.length,
      factionPlaces: report.factionPlaces.length,
      relics: report.relics.length,
      portals: report.portals.length,
      locations: report.locations.length,
      trails: report.trails.length,
      events: report.events.length,
      eventWorlds: report.eventWorlds.length,
      eventLinks: report.eventLinks.length,
      migrations: report.migrations.length,
      currentLocation: report.characterState[0]?.location,
      currentProvenance: report.characterState[0]?.provenance,
      storyStart: report.storyRange.startOrder,
      storyEnd: report.storyRange.endOrder,
    }))

    // 每个实体与关联都能从磁盘读回，而不是只存在于 store 里。
    expect(report.worlds).toHaveLength(2)
    expect(report.mapWorldLinks).toHaveLength(2)
    expect(report.factions).toHaveLength(1)
    expect(report.factionCharacters).toHaveLength(1)
    expect(report.factionPlaces).toHaveLength(1)
    expect(report.relics).toHaveLength(1)
    expect(report.portals).toHaveLength(1)
    expect(report.locations).toHaveLength(2)
    expect(report.trails).toHaveLength(1)
    expect(report.events).toHaveLength(1)
    expect(report.eventWorlds).toHaveLength(2)
    expect(report.eventLinks).toHaveLength(1)
    expect(report.migrations).toHaveLength(1)
    // 出生地在凡人界、目前所在地在修真界，且位置事实只有一份。
    expect(report.locations.find(row => row.kind === 'birth')).toMatchObject({ worldId: expect.any(String) })
    expect(report.characterState[0].location).toBe('修真界 · 天门城')
    expect(report.characterState[0].provenance).toContain('"kind":"author"')
    // 历史事件保留虚构纪年与负数刻度，且不会改动作者的故事范围。
    expect(report.events[0].sortOrder).toBe(-5)
    expect(report.events[0].isHistorical).toBe(1)
    expect(report.storyRange.startOrder).toBe(0)
    expect(report.storyRange.endOrder).toBe(10)
  })
})
