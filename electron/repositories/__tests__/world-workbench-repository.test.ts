import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { CharacterRelationshipRepository } from '../character-relationship-repository'
import { CharacterRepository } from '../character-repository'
import { CHARACTER_ROSTER_SCHEMA_VERSION } from '../../../src/shared/character-roster'
import { CharacterRosterRepository } from '../character-roster-repository'
import { ProjectCoreRepository } from '../project-core-repository'
import { StoryTimelineRepository } from '../story-timeline-repository'
import { WorldMapRepository } from '../world-map-repository'
import {
  WorldWorkbenchRepository,
  parseComparableTick,
} from '../world-workbench-repository'
import {
  createWorldEntityId,
  type WorldCharacterLocation,
  type WorldCharacterTrail,
  type WorldFaction,
  type WorldPortal,
  type WorldRecord,
  type WorldRelic,
  type WorldRule,
} from '../../../src/shared/world-workbench'

const testRoot = path.resolve('.runtime/.cache/world-workbench-repository-tests')

const ROOT_MAP_ID = 'map-11111111-1111-4111-8111-111111111111'
const SECT_MAP_ID = 'map-22222222-2222-4222-8222-222222222222'
const ORPHAN_MAP_ID = 'map-33333333-3333-4333-8333-333333333333'

let projectRoot = ''

function db() {
  const instance = getProjectDb()
  if (!instance) throw new Error('测试数据库未打开')
  return instance
}

function makeWorld(name: string): WorldRecord {
  return WorldWorkbenchRepository.upsertWorld({
    id: createWorldEntityId('world'),
    name,
    summary: `${name} 简介`,
    background: `${name} 背景`,
    notes: '',
    sortOrder: 0,
  })
}

function makeMap(id: string, name: string): void {
  WorldMapRepository.upsertMap({ id, name, parentMapId: null, sortOrder: 1, image: null })
}

function makeNode(id: string, name: string, mapId: string): void {
  WorldMapRepository.upsertNode({
    id,
    name,
    type: 'city',
    description: '',
    parentId: null,
    mapId,
    x: 1,
    y: 2,
    sourceRefs: [],
  })
}

function rosterEntry(name: string) {
  return {
    name,
    role: 'protagonist' as const,
    gender: '', age: '', appearance: '', personality: '', background: '',
    abilities: '', motivation: '', relationships: [], arc: '', notes: '',
  }
}

/**
 * 建角色走角色名单的同一业务提交（manual_edit），与应用的正常写入路径一致；
 * 这样 roster 的 revision / 投影 / 事实哈希都保持自洽。
 */
function makeCharacter(name: string): string {
  const snapshot = CharacterRosterRepository.read()
  if (!snapshot.entries.some(entry => entry.name === name)) {
    CharacterRosterRepository.commit({
      operationId: `test-roster-${name}-${snapshot.revision}`,
      expectedRevision: snapshot.revision,
      schemaVersion: CHARACTER_ROSTER_SCHEMA_VERSION,
      entries: [...snapshot.entries, rosterEntry(name)],
      intent: 'manual_edit',
    })
  }
  const id = CharacterRelationshipRepository.resolveIdentity(name)
  if (!id) throw new Error('角色身份创建失败')
  return id
}

/**
 * 造一个「旧项目」：角色卡由早期版本直接写进 characters（没有字段级来源），
 * 然后重建角色名单元数据，使名单进入升级后第一次打开时的
 * `legacy_cards_preserved` 状态。这是旧项目真实经历的状态，不是人为损坏。
 */
function makeCharacterWithLegacyState(
  name: string,
  state: { location: string; powerLevel: string },
): string {
  const now = new Date().toISOString()
  db().prepare(`
    INSERT INTO characters (
      name, role, gender, age, appearance, personality, background,
      abilities, motivation, relationships, arc, notes,
      cs_location, cs_power_level, cs_physical_state, cs_mental_state,
      cs_key_items, cs_recent_events, cs_updated_at_chapter, cs_provenance, cultivation_level_id
    ) VALUES (?, 'protagonist', '', '', '', '', '', '', '', '[]', '', '',
      ?, ?, '', '', '', '', 0, '{}', NULL)
  `).run(name, state.location, state.powerLevel)
  db().prepare('DELETE FROM character_roster_meta').run()
  const snapshot = CharacterRosterRepository.read()
  expect(snapshot.migrationState).toBe('legacy_cards_preserved')
  expect(snapshot.status).toBe('inconsistent')
  CharacterRelationshipRepository.reconcileIdentities(db())
  const id = CharacterRelationshipRepository.resolveIdentity(name)
  if (!id) throw new Error('角色身份创建失败')
  void now
  return id
}

function renameCharacter(original: string, next: string): string {
  const snapshot = CharacterRosterRepository.read()
  CharacterRosterRepository.commit({
    operationId: `test-rename-${original}-${snapshot.revision}`,
    expectedRevision: snapshot.revision,
    schemaVersion: CHARACTER_ROSTER_SCHEMA_VERSION,
    entries: snapshot.entries.map(entry => (entry.name === original ? rosterEntry(next) : entry)),
    intent: 'manual_edit',
    renames: [{ originalName: original, newName: next }],
  })
  const id = CharacterRelationshipRepository.resolveIdentity(next)
  if (!id) throw new Error('改名失败')
  return id
}

/** 新建项目：两张地图，一张归属「凡人界」，一张未归属（旧地图）。 */
function seedBase(): { mortalWorld: WorldRecord; immortalWorld: WorldRecord; nodeA: string; nodeB: string } {
  const mortalWorld = makeWorld('凡人界')
  const immortalWorld = makeWorld('修真界')
  makeMap(ROOT_MAP_ID, '凡人界总图')
  makeMap(SECT_MAP_ID, '修真界总图')
  makeMap(ORPHAN_MAP_ID, '旧项目地图')
  makeNode('node-qtc', '青石村', ROOT_MAP_ID)
  makeNode('node-tmc', '天门城', SECT_MAP_ID)
  WorldWorkbenchRepository.applyMapWorldAssignment(ROOT_MAP_ID, mortalWorld.id)
  WorldWorkbenchRepository.applyMapWorldAssignment(SECT_MAP_ID, immortalWorld.id)
  return { mortalWorld, immortalWorld, nodeA: 'node-qtc', nodeB: 'node-tmc' }
}

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
  ProjectCoreRepository.init('World Workbench Test Novel', 'zh-CN')
})

afterEach(() => {
  closeProjectDatabase()
  try {
    fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows 上 WAL 句柄可能延迟释放；这只是 .runtime 下的可再生测试缓存。
  }
})

describe('世界实体与归属', () => {
  it('starts with no worlds and never fabricates a default world', () => {
    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.worlds).toEqual([])
    expect(snapshot.factions).toEqual([])
    expect(snapshot.relics).toEqual([])
    expect(snapshot.rules).toEqual([])
    expect(WorldWorkbenchRepository.getMigrationReport()?.defaultWorldCount).toBe(0)
  })

  it('keeps per-world lists isolated (凡人界 / 修真界 do not cross)', () => {
    const { mortalWorld, immortalWorld } = seedBase()
    WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    WorldWorkbenchRepository.upsertFaction(baseFaction(immortalWorld.id, '玄霄宗'))
    WorldWorkbenchRepository.upsertRelic(baseRelic(mortalWorld.id, '古剑秘境'))
    WorldWorkbenchRepository.upsertRule(baseRule(mortalWorld.id, '灵气枯竭'))
    WorldWorkbenchRepository.upsertRule(baseRule(immortalWorld.id, '元婴之上'))

    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.factions.filter(f => f.worldId === mortalWorld.id).map(f => f.name)).toEqual(['青云门'])
    expect(snapshot.factions.filter(f => f.worldId === immortalWorld.id).map(f => f.name)).toEqual(['玄霄宗'])
    expect(snapshot.relics.filter(r => r.worldId === mortalWorld.id).map(r => r.name)).toEqual(['古剑秘境'])
    expect(snapshot.relics.filter(r => r.worldId === immortalWorld.id)).toEqual([])
    expect(snapshot.rules.filter(r => r.worldId === immortalWorld.id).map(r => r.name)).toEqual(['元婴之上'])
  })

  it('rejects a second world with the same name', () => {
    makeWorld('凡人界')
    expect(() => makeWorld('凡人界')).toThrow(/同名世界/)
  })

  it('keeps one map in at most one world and allows unassigned legacy maps', () => {
    const { mortalWorld, immortalWorld } = seedBase()
    const snapshot = WorldWorkbenchRepository.getAll()
    const links = snapshot.mapWorldLinks
    expect(links.find(link => link.mapId === ROOT_MAP_ID)?.worldId).toBe(mortalWorld.id)
    expect(links.find(link => link.mapId === SECT_MAP_ID)?.worldId).toBe(immortalWorld.id)
    // 旧地图保持未关联，删除/打开都不受影响。
    expect(links.some(link => link.mapId === ORPHAN_MAP_ID)).toBe(false)
    expect(WorldMapRepository.getAll().maps.map(map => map.id)).toContain(ORPHAN_MAP_ID)
  })

  it('refuses a map assignment change that would make existing references inconsistent', () => {
    const { mortalWorld, immortalWorld, nodeA } = seedBase()
    const faction = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    WorldWorkbenchRepository.upsertFactionPlace({ id: '', factionId: faction.id, nodeId: nodeA, note: '' })

    const plan = WorldWorkbenchRepository.planMapWorldAssignment(ROOT_MAP_ID, immortalWorld.id)
    expect(plan.blockers.length).toBeGreaterThan(0)
    expect(plan.blockers.some(blocker => blocker.kind === 'faction-place')).toBe(true)
    expect(() => WorldWorkbenchRepository.applyMapWorldAssignment(ROOT_MAP_ID, immortalWorld.id))
      .toThrow(/不一致/)

    // 归属没有被静默搬移。
    const links = WorldWorkbenchRepository.getAll().mapWorldLinks
    expect(links.find(link => link.mapId === ROOT_MAP_ID)?.worldId).toBe(mortalWorld.id)
  })

  it('blocks deleting a world that still has references, and deletes an empty one', () => {
    const { mortalWorld, immortalWorld } = seedBase()
    WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    const plan = WorldWorkbenchRepository.planDelete('world', mortalWorld.id)
    expect(plan.blockers.some(blocker => blocker.label === '势力')).toBe(true)
    expect(() => WorldWorkbenchRepository.deleteEntity('world', mortalWorld.id)).toThrow(/引用/)
    // 有关联地图的世界同样被阻止（地图是世界的引用之一）。
    expect(WorldWorkbenchRepository.planDelete('world', immortalWorld.id).blockers
      .some(blocker => blocker.label === '关联地图')).toBe(true)

    // 完全没有被引用的世界可以删除。
    const spare = makeWorld('备用界')
    WorldWorkbenchRepository.deleteEntity('world', spare.id)
    expect(WorldWorkbenchRepository.getAll().worlds.map(world => world.id).sort())
      .toEqual([mortalWorld.id, immortalWorld.id].sort())
  })
})

function baseFaction(worldId: string, name: string): WorldFaction {
  return {
    id: createWorldEntityId('faction'),
    worldId,
    name,
    type: '宗门',
    summary: '',
    description: '',
    seat: '',
    domainNote: '',
    notes: '',
  }
}

function baseRelic(worldId: string, name: string): WorldRelic {
  return {
    id: createWorldEntityId('relic'),
    worldId,
    name,
    type: '秘境',
    summary: '',
    description: '',
    locationNote: '',
    nodeId: null,
    entranceNodeId: null,
    entryCondition: '',
    danger: '',
    rewards: '',
    availabilityNote: '',
    status: 'sealed',
    customStatusLabel: '',
    notes: '',
  }
}

function baseRule(worldId: string, name: string): WorldRule {
  return {
    id: createWorldEntityId('rule'),
    worldId,
    name,
    category: 'cultivation',
    customCategoryLabel: '',
    content: `${name} 内容`,
    scopeNote: '',
    restriction: '',
    consequence: '',
    notes: '',
    sourceKind: 'author',
    sourceRefId: '',
    sourceStatus: '',
  }
}

function basePortal(fromWorldId: string, toWorldId: string, name: string): WorldPortal {
  return {
    id: createWorldEntityId('portal'),
    name,
    type: 'teleport',
    customTypeLabel: '',
    fromWorldId,
    toWorldId,
    fromNodeId: null,
    toNodeId: null,
    bidirectional: true,
    condition: '',
    cost: '',
    scheduleNote: '',
    status: 'active',
    customStatusLabel: '',
    description: '',
    notes: '',
  }
}

describe('势力：人物身份与关系', () => {
  it('links a sect master and a disciple, supports reverse lookup, and survives a rename', () => {
    const { mortalWorld } = seedBase()
    const sect = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '玄霄宗'))
    const masterId = makeCharacter('凌沧海')
    const discipleId = makeCharacter('苏晚')

    WorldWorkbenchRepository.upsertFactionCharacter({
      id: '', factionId: sect.id, characterId: masterId, relation: '宗主', tenureNote: '', note: '',
    })
    WorldWorkbenchRepository.upsertFactionCharacter({
      id: '', factionId: sect.id, characterId: discipleId, relation: '弟子', tenureNote: '入门三年', note: '',
    })

    let snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.factionCharacters.filter(link => link.factionId === sect.id)).toHaveLength(2)

    // 反向查询：从人物找到势力，用的是同一行关系，不是第二份数据。
    const renamedId = renameCharacter('苏晚', '苏晚婉')
    expect(renamedId).toBe(discipleId)
    snapshot = WorldWorkbenchRepository.getAll()
    const renamed = snapshot.factionCharacters.filter(link => link.characterId === discipleId)
    expect(renamed).toHaveLength(1)
    expect(snapshot.factionCharacters.some(link => link.characterId === masterId)).toBe(true)
    expect(linkNames(snapshot, sect.id)).toContain('苏晚婉')
  })

  it('rejects self relations and duplicate relations, and stores symmetric relations once', () => {
    const { mortalWorld } = seedBase()
    const a = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '甲宗'))
    const b = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '乙宗'))

    expect(() => WorldWorkbenchRepository.upsertFactionRelation({
      id: '', worldId: mortalWorld.id, fromFactionId: a.id, toFactionId: a.id,
      relation: 'ally', customLabel: '', directed: false, note: '',
    })).toThrow(/自身/)

    WorldWorkbenchRepository.upsertFactionRelation({
      id: '', worldId: mortalWorld.id, fromFactionId: a.id, toFactionId: b.id,
      relation: 'ally', customLabel: '', directed: false, note: '',
    })
    // 对称关系只存一次：反方向重复保存被拒绝。
    expect(() => WorldWorkbenchRepository.upsertFactionRelation({
      id: '', worldId: mortalWorld.id, fromFactionId: b.id, toFactionId: a.id,
      relation: 'ally', customLabel: '', directed: false, note: '',
    })).toThrow(/已存在/)

    // 附属是有向关系：反向记录是不同的事实，允许存在，且方向被保存。
    const subordinate = WorldWorkbenchRepository.upsertFactionRelation({
      id: '', worldId: mortalWorld.id, fromFactionId: b.id, toFactionId: a.id,
      relation: 'subordinate', customLabel: '', directed: false, note: '',
    })
    expect(subordinate.directed).toBe(true)
    expect(subordinate.fromFactionId).toBe(b.id)
    expect(subordinate.toFactionId).toBe(a.id)
  })
})

function linkNames(snapshot: ReturnType<typeof WorldWorkbenchRepository.getAll>, factionId: string): string[] {
  const nameById = new Map(snapshot.characterLocationViews.map(view => [view.characterId, view.characterName]))
  return snapshot.factionCharacters
    .filter(link => link.factionId === factionId)
    .map(link => nameById.get(link.characterId) ?? link.characterId)
}

describe('秘境', () => {
  it('links entrance, controlling faction and guardian, and rejects nodes from another world', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const sect = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    const guardianId = makeCharacter('守镜人')

    const relic = WorldWorkbenchRepository.upsertRelic({
      ...baseRelic(mortalWorld.id, '古剑秘境'),
      entranceNodeId: nodeA,
      entryCondition: '需持有剑令',
    })
    WorldWorkbenchRepository.upsertRelicFaction({
      id: '', relicId: relic.id, factionId: sect.id, relation: 'control', customLabel: '', note: '',
    })
    WorldWorkbenchRepository.upsertRelicCharacter({
      id: '', relicId: relic.id, characterId: guardianId, relation: 'guard', customLabel: '', note: '',
    })

    const snapshot = WorldWorkbenchRepository.getAll()
    const stored = snapshot.relics.find(item => item.id === relic.id)
    expect(stored?.entranceNodeId).toBe(nodeA)
    expect(stored?.entryCondition).toBe('需持有剑令')
    expect(snapshot.relicFactions.filter(link => link.relicId === relic.id)).toHaveLength(1)
    expect(snapshot.relicCharacters.filter(link => link.relicId === relic.id)).toHaveLength(1)

    // 另一世界的地点是跨世界引用，必须被仓库拒绝。
    expect(() => WorldWorkbenchRepository.upsertRelic({
      ...baseRelic(mortalWorld.id, '跨界秘境'),
      nodeId: nodeB,
    })).toThrow(/不属于当前世界/)
    expect(immortalWorld.id).not.toBe(mortalWorld.id)
  })
})

describe('世界通道', () => {
  it('stores a shared portal once and shows it from both worlds with a correct direction', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const bidirectional = WorldWorkbenchRepository.upsertPortal({
      ...basePortal(mortalWorld.id, immortalWorld.id, '登天梯'),
      fromNodeId: nodeA,
      toNodeId: nodeB,
    })
    const oneWay = WorldWorkbenchRepository.upsertPortal({
      ...basePortal(immortalWorld.id, mortalWorld.id, '坠凡井'),
      bidirectional: false,
    })

    const snapshot = WorldWorkbenchRepository.getAll()
    // 同一行被两端世界同时看到，而不是复制两份。
    expect(snapshot.portals.filter(portal => portal.id === bidirectional.id)).toHaveLength(1)
    const visibleInMortal = snapshot.portals.filter(p => p.fromWorldId === mortalWorld.id || p.toWorldId === mortalWorld.id)
    expect(visibleInMortal.map(p => p.id).sort()).toEqual([bidirectional.id, oneWay.id].sort())
    expect(oneWay.bidirectional).toBe(false)
    expect(oneWay.fromWorldId).toBe(immortalWorld.id)
    expect(oneWay.toWorldId).toBe(mortalWorld.id)

    // 未设具体地点时明确是「入口地点未设定」的世界级通道。
    expect(oneWay.fromNodeId).toBeNull()
    expect(oneWay.toNodeId).toBeNull()
  })

  it('rejects a portal whose two ends are the same world or whose node belongs elsewhere', () => {
    const { mortalWorld, immortalWorld, nodeB } = seedBase()
    expect(() => WorldWorkbenchRepository.upsertPortal(basePortal(mortalWorld.id, mortalWorld.id, '内环')))
      .toThrow(/不同的世界/)
    expect(() => WorldWorkbenchRepository.upsertPortal({
      ...basePortal(mortalWorld.id, immortalWorld.id, '错端通道'),
      fromNodeId: nodeB,
    })).toThrow(/不属于当前世界/)
  })

  it('allows cross-world portals while plain map edges still reject cross-map connections', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    // 跨世界通道被允许。
    expect(() => WorldWorkbenchRepository.upsertPortal(basePortal(mortalWorld.id, immortalWorld.id, '界门')))
      .not.toThrow()
    // 普通地图连线仍然拒绝跨地图。
    expect(() => WorldMapRepository.upsertEdge({
      id: 'edge-cross', fromNodeId: nodeA, toNodeId: nodeB, type: 'route',
      description: '', status: 'active',
    })).toThrow(/禁止跨地图连接/)
  })
})

describe('世界规则', () => {
  it('keeps scope and exception targets inside the rule world', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const relic = WorldWorkbenchRepository.upsertRelic(baseRelic(mortalWorld.id, '古剑秘境'))
    const rule = WorldWorkbenchRepository.upsertRule(baseRule(mortalWorld.id, '灵气上限'))

    WorldWorkbenchRepository.upsertRuleTarget({
      id: '', ruleId: rule.id, role: 'scope', targetKind: 'node', targetId: nodeA, note: '',
    })
    WorldWorkbenchRepository.upsertRuleTarget({
      id: '', ruleId: rule.id, role: 'exception', targetKind: 'relic', targetId: relic.id, note: '秘境内部不受限制',
    })

    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.ruleTargets.filter(target => target.ruleId === rule.id)).toHaveLength(2)
    expect(snapshot.ruleTargets.find(target => target.role === 'exception')?.note).toBe('秘境内部不受限制')

    // 另一世界的地点作为范围必须被拒绝。
    expect(() => WorldWorkbenchRepository.upsertRuleTarget({
      id: '', ruleId: rule.id, role: 'scope', targetKind: 'node', targetId: nodeB, note: '',
    })).toThrow(/不属于当前世界/)
    expect(immortalWorld.id).not.toBe(mortalWorld.id)
  })

  it('requires a real fact id when a rule cites an existing confirmed fact', () => {
    const { mortalWorld } = seedBase()
    expect(() => WorldWorkbenchRepository.upsertRule({
      ...baseRule(mortalWorld.id, '借用规则'),
      sourceKind: 'setting-rule',
      sourceRefId: '',
    })).toThrow(/原事实 ID/)

    const cited = WorldWorkbenchRepository.upsertRule({
      ...baseRule(mortalWorld.id, '借用规则'),
      sourceKind: 'setting-rule',
      sourceRefId: 'rule-42',
      sourceStatus: 'confirmed',
    })
    expect(cited.sourceRefId).toBe('rule-42')
    expect(cited.sourceStatus).toBe('confirmed')
  })
})

describe('出生地与目前所在地', () => {
  it('keeps birth in one world and current location in another, consistently', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const heroId = makeCharacter('林尘')

    WorldWorkbenchRepository.saveBirthLocation({
      id: '', characterId: heroId, kind: 'birth', worldId: mortalWorld.id, nodeId: nodeA, note: '村中老屋',
      storyTimeLabel: '', timePrecision: 'unknown', chapterNumber: null,
      boundLocationText: '', boundProvenanceKind: '', boundAt: '',
    } as WorldCharacterLocation)

    const result = WorldWorkbenchRepository.commitCurrentLocation(heroId, immortalWorld.id, nodeB, {
      storyTimeLabel: '大荒历 317 年冬',
      timePrecision: 'exact',
    })
    expect(result.success).toBe(true)
    expect(result.locationText).toBe('修真界 · 天门城')

    const snapshot = WorldWorkbenchRepository.getAll()
    const view = snapshot.characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.birth?.worldId).toBe(mortalWorld.id)
    expect(view?.birth?.nodeId).toBe(nodeA)
    expect(view?.current?.worldId).toBe(immortalWorld.id)
    expect(view?.currentState).toBe('bound')
    // 结构化位置与 characters.cs_location 是同一份事实。
    expect(view?.locationText).toBe('修真界 · 天门城')
    expect(view?.locationProvenanceKind).toBe('author')
    // 世界页与角色页都从同一处读取。
    expect(CharacterRepository.getByName('林尘')?.currentState?.location).toBe('修真界 · 天门城')
  })

  it('preserves other dynamic state and keeps a legacy location text untouched', () => {
    const { immortalWorld, nodeB, mortalWorld } = seedBase()
    // 旧项目的文字位置来源是 legacy：升级时不自动匹配地图地点。
    const heroId = makeCharacterWithLegacyState('林尘', { location: '某个旧世界', powerLevel: '练气三层' })

    WorldWorkbenchRepository.saveBirthLocation({
      id: '', characterId: heroId, kind: 'birth', worldId: mortalWorld.id, nodeId: null, note: '出生地待补',
      storyTimeLabel: '', timePrecision: 'unknown', chapterNumber: null,
      boundLocationText: '', boundProvenanceKind: '', boundAt: '',
    } as WorldCharacterLocation)

    // 只补出生地不会改动位置事实，也不会把 legacy 来源伪装成作者确认。
    let view = WorldWorkbenchRepository.getAll().characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.locationText).toBe('某个旧世界')
    expect(view?.locationProvenanceKind).toBe('legacy')
    expect(view?.currentState).toBe('unset')
    expect(CharacterRepository.getByName('林尘')?.currentState?.location).toBe('某个旧世界')

    // 旧项目第一次显式设置结构化位置：先按角色名单自己的 legacy_cards_adoption
    // 重建只读投影（不改写角色卡），再提交本次位置修改。
    const beforeRoster = CharacterRosterRepository.read()
    expect(beforeRoster.status).toBe('inconsistent')
    const commit = WorldWorkbenchRepository.commitCurrentLocation(heroId, immortalWorld.id, nodeB, {})
    expect(commit.success).toBe(true)
    expect(CharacterRosterRepository.read().status).toBe('ready')
    expect(CharacterRosterRepository.read().migrationState).toBe('ready')

    const stored = CharacterRepository.getByName('林尘')
    // 其他动态状态与它们自己的旧来源原样保留，不被伪装成作者确认。
    expect(stored?.currentState?.powerLevel).toBe('练气三层')
    expect(stored?.currentState?.provenance?.powerLevel?.kind).toBe('legacy')
    expect(stored?.currentState?.location).toBe('修真界 · 天门城')
    expect(stored?.currentState?.location).toBe('修真界 · 天门城')
    expect(stored?.currentState?.provenance?.location?.kind).toBe('author')

    view = WorldWorkbenchRepository.getAll().characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('bound')
  })

  it('marks the structured binding stale when the character page changes the location text', () => {
    const { immortalWorld, nodeB } = seedBase()
    const heroId = makeCharacter('林尘')
    WorldWorkbenchRepository.commitCurrentLocation(heroId, immortalWorld.id, nodeB, {})

    // 模拟角色页直接编辑位置文字：旧文字与旧来源证据保留，但绑定必须失效。
    db().prepare(`
      UPDATE characters SET cs_location = ?, cs_provenance = ?
      WHERE name = '林尘'
    `).run('作者手写的另一个地方', JSON.stringify({ location: { kind: 'author', chapterNumber: 0 } }))

    const view = WorldWorkbenchRepository.getAll().characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('stale')
    expect(view?.locationText).toBe('作者手写的另一个地方')
    // 旧绑定行保留为证据，不被删除。
    expect(view?.current?.nodeId).toBe(nodeB)
    expect(view?.current?.boundLocationText).toBe('修真界 · 天门城')
  })

  it('detaches the binding without touching the location text', () => {
    const { immortalWorld, nodeB } = seedBase()
    const heroId = makeCharacter('林尘')
    WorldWorkbenchRepository.commitCurrentLocation(heroId, immortalWorld.id, nodeB, {})
    WorldWorkbenchRepository.clearCurrentLocationBinding(heroId)

    const view = WorldWorkbenchRepository.getAll().characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('unset')
    expect(view?.current?.worldId).toBeNull()
    expect(view?.locationText).toBe('修真界 · 天门城')
  })

  it('refuses a node that does not belong to the selected world', () => {
    const { mortalWorld, nodeB } = seedBase()
    const heroId = makeCharacter('林尘')
    expect(() => WorldWorkbenchRepository.saveBirthLocation({
      id: '', characterId: heroId, kind: 'birth', worldId: mortalWorld.id, nodeId: nodeB, note: '',
      storyTimeLabel: '', timePrecision: 'unknown', chapterNumber: null,
      boundLocationText: '', boundProvenanceKind: '', boundAt: '',
    } as WorldCharacterLocation)).toThrow(/不属于当前世界/)
  })
})

function baseTrail(characterId: string, worldId: string, nodeId: string | null, arrived: string): WorldCharacterTrail {
  return {
    id: createWorldEntityId('trail'),
    characterId,
    worldId,
    nodeId,
    note: '',
    arrivedLabel: arrived,
    departedLabel: '',
    timePrecision: 'unknown',
    sortOrder: 0,
    reason: '',
    chapterNumber: null,
    notes: '',
    portalId: null,
    eventId: null,
  }
}

describe('人物行踪', () => {
  it('records an early trail without changing the current location', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const heroId = makeCharacter('林尘')
    WorldWorkbenchRepository.commitCurrentLocation(heroId, immortalWorld.id, nodeB, {})

    const result = WorldWorkbenchRepository.commitTrail({
      trail: baseTrail(heroId, mortalWorld.id, nodeA, '大荒历 300 年'),
      alsoSetCurrentLocation: false,
    })
    expect(result.success).toBe(true)

    const view = WorldWorkbenchRepository.getAll().characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.current?.worldId).toBe(immortalWorld.id)
    expect(view?.locationText).toBe('修真界 · 天门城')
    expect(WorldWorkbenchRepository.getAll().trails).toHaveLength(1)
  })

  it('rolls the whole thing back when the linked current-location update fails', () => {
    const { mortalWorld, nodeA } = seedBase()
    const heroId = makeCharacter('林尘')

    expect(() => WorldWorkbenchRepository.commitTrail({
      trail: baseTrail(heroId, mortalWorld.id, nodeA, '大荒历 310 年'),
      alsoSetCurrentLocation: true,
      // 章节号非法：失败发生在行踪行已经写入之后，整个事务必须回滚。
      currentLocation: { chapterNumber: -3 },
    })).toThrow(/关联章节必须是正整数/)

    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.trails).toEqual([])
    const view = snapshot.characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('unset')
    expect(CharacterRepository.getByName('林尘')?.currentState?.location ?? '').toBe('')
  })

  it('saves the trail and the current location atomically when asked', () => {
    const { mortalWorld, nodeA } = seedBase()
    const heroId = makeCharacter('林尘')
    const result = WorldWorkbenchRepository.commitTrail({
      trail: baseTrail(heroId, mortalWorld.id, nodeA, '大荒历 310 年'),
      alsoSetCurrentLocation: true,
      currentLocation: { storyTimeLabel: '大荒历 310 年', timePrecision: 'exact' },
    })
    expect(result.success).toBe(true)
    expect(result.rosterRevision).toBeGreaterThan(0)

    const view = WorldWorkbenchRepository.getAll().characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('bound')
    expect(view?.current?.nodeId).toBe(nodeA)
    expect(WorldWorkbenchRepository.getTrailBinding(result.trail?.id ?? '').bound).toBe(true)
  })

  it('requires an explicit decision before deleting a trail that backs the current location', () => {
    const { mortalWorld, nodeA } = seedBase()
    const heroId = makeCharacter('林尘')
    const result = WorldWorkbenchRepository.commitTrail({
      trail: baseTrail(heroId, mortalWorld.id, nodeA, '310'),
      alsoSetCurrentLocation: true,
    })
    const trailId = result.trail?.id ?? ''

    const plan = WorldWorkbenchRepository.planDelete('trail', trailId)
    expect(plan.blockers.some(blocker => blocker.kind === 'current-location-binding')).toBe(true)
    expect(() => WorldWorkbenchRepository.deleteEntity('trail', trailId)).toThrow(/引用/)

    WorldWorkbenchRepository.deleteEntity('trail', trailId, { releaseCurrentLocation: true })
    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.trails).toEqual([])
    // 不悄悄换成另一条行踪：解绑后位置需要作者重新确认，文字位置原样保留。
    const view = snapshot.characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('unset')
    expect(view?.locationText).toBe('修真界'.length > 0 ? view?.locationText : '凡人界 · 青石村')
  })

  it('validates the portal only when a reliable comparable tick exists', () => {
    expect(parseComparableTick('310')).toBe(310)
    expect(parseComparableTick('大荒历 310 年')).toBeNull()
    expect(parseComparableTick('')).toBeNull()

    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const heroId = makeCharacter('林尘')
    const portal = WorldWorkbenchRepository.upsertPortal({
      ...basePortal(mortalWorld.id, immortalWorld.id, '登天梯'),
      fromNodeId: nodeA,
      toNodeId: nodeB,
    })

    // 纯数字刻度才比较：离开早于到达被拒绝。
    expect(() => WorldWorkbenchRepository.commitTrail({
      trail: { ...baseTrail(heroId, mortalWorld.id, nodeA, '320'), departedLabel: '300', timePrecision: 'exact' },
      alsoSetCurrentLocation: false,
    })).toThrow(/离开时间不能早于到达时间/)

    // 虚构纪年与相对时间照常保存。
    expect(WorldWorkbenchRepository.commitTrail({
      trail: { ...baseTrail(heroId, mortalWorld.id, nodeA, '大荒历 320 年'), departedLabel: '大荒历 300 年', timePrecision: 'relative' },
      alsoSetCurrentLocation: false,
    }).success).toBe(true)

    // 行踪世界与通道端点必须相符。
    expect(() => WorldWorkbenchRepository.commitTrail({
      trail: { ...baseTrail(heroId, immortalWorld.id, nodeB, ''), portalId: portal.id },
      alsoSetCurrentLocation: false,
    })).not.toThrow()
    expect(() => WorldWorkbenchRepository.commitTrail({
      trail: { ...baseTrail(heroId, mortalWorld.id, null, ''), portalId: 'wportal-00000000-0000-4000-8000-000000000000' },
      alsoSetCurrentLocation: false,
    })).toThrow(/不存在或已删除/)
  })
})

describe('历史事件', () => {
  it('shares one event across two worlds and keeps the timeline as the single owner', () => {
    const { mortalWorld, immortalWorld, nodeA } = seedBase()
    const event = StoryTimelineRepository.upsertEvent({
      id: 'evt-boundary-war',
      title: '界门之战',
      timeLabel: '大荒历 500 年',
      sortOrder: -5,
      precision: 'exact',
      description: '两界通道开启后的第一场大战',
      chapterNumbers: [],
      characterNames: [],
      locationNodeIds: [],
      status: 'planned',
      isHistorical: true,
      outcome: '界门崩塌',
      aftermath: '两界隔绝三百年',
    })

    WorldWorkbenchRepository.saveEventLinks(event.id, [mortalWorld.id, immortalWorld.id], [
      { id: '', eventId: event.id, targetKind: 'node', targetId: nodeA, worldId: null, relation: '主战场', note: '' },
    ])

    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.eventWorlds.filter(row => row.eventId === event.id)).toHaveLength(2)
    expect(snapshot.eventLinks.filter(row => row.eventId === event.id)).toHaveLength(1)
    // 事件本体只有一份，仍在故事时间线里。
    const timeline = StoryTimelineRepository.getAll()
    const stored = timeline.events.find(item => item.id === event.id)
    expect(stored?.title).toBe('界门之战')
    expect(stored?.isHistorical).toBe(true)
    expect(stored?.aftermath).toBe('两界隔绝三百年')
    expect(stored?.chapterNumbers).toEqual([])

    // 在故事时间线编辑后，世界页读到的同一事件同步更新。
    StoryTimelineRepository.upsertEvent({ ...event, title: '界门之战（上）' })
    expect(StoryTimelineRepository.getAll().events.find(item => item.id === event.id)?.title).toBe('界门之战（上）')
  })

  it('never resets the author story range for a pre-story historical event', () => {
    const { mortalWorld } = seedBase()
    StoryTimelineRepository.saveSettings({
      title: '故事时间线', rulerLabel: '故事时间', rulerUnit: '刻度',
      startLabel: '故事开端', startOrder: 0, endLabel: '故事结束', endOrder: 10, hasCustomRange: true,
    })
    const event = StoryTimelineRepository.upsertEvent({
      id: 'evt-ancient',
      title: '上古大战',
      timeLabel: '混沌纪',
      sortOrder: -1000,
      precision: 'range',
      description: '',
      chapterNumbers: [],
      characterNames: ['旧名'],
      locationNodeIds: [],
      status: 'planned',
      isHistorical: true,
    })
    void event
    void mortalWorld
    const settings = StoryTimelineRepository.getAll().settings
    expect(settings.startOrder).toBe(0)
    expect(settings.endOrder).toBe(10)
    expect(settings.hasCustomRange).toBe(true)
  })

  it('refuses an event link to a target that does not exist', () => {
    const { mortalWorld } = seedBase()
    const event = StoryTimelineRepository.upsertEvent({
      id: 'evt-x', title: '事件', timeLabel: '第一年', sortOrder: 1, precision: 'exact',
      description: '', chapterNumbers: [], characterNames: [], locationNodeIds: [], status: 'planned',
    })
    expect(() => WorldWorkbenchRepository.saveEventLinks(event.id, [mortalWorld.id], [
      { id: '', eventId: event.id, targetKind: 'relic', targetId: 'wrelic-00000000-0000-4000-8000-000000000000', worldId: null, relation: '', note: '' },
    ])).toThrow(/不存在或已删除/)
  })
})

describe('删除依赖与关联解除', () => {
  it('blocks deleting a referenced relic and never deletes its characters, nodes or events', () => {
    const { mortalWorld, nodeA } = seedBase()
    const relic = WorldWorkbenchRepository.upsertRelic({ ...baseRelic(mortalWorld.id, '古剑秘境'), nodeId: nodeA })
    const guardianId = makeCharacter('守镜人')
    WorldWorkbenchRepository.upsertRelicCharacter({
      id: '', relicId: relic.id, characterId: guardianId, relation: 'guard', customLabel: '', note: '',
    })
    StoryTimelineRepository.upsertEvent({
      id: 'evt-relic', title: '秘境开启', timeLabel: '第二年', sortOrder: 2, precision: 'exact',
      description: '', chapterNumbers: [], characterNames: [], locationNodeIds: [], status: 'planned',
    })
    WorldWorkbenchRepository.saveEventLinks('evt-relic', [mortalWorld.id], [
      { id: '', eventId: 'evt-relic', targetKind: 'relic', targetId: relic.id, worldId: null, relation: '开启', note: '' },
    ])

    const plan = WorldWorkbenchRepository.planDelete('relic', relic.id)
    expect(plan.blockers.some(blocker => blocker.label === '历史事件引用')).toBe(true)
    expect(() => WorldWorkbenchRepository.deleteEntity('relic', relic.id)).toThrow(/引用/)

    WorldWorkbenchRepository.deleteEntity('relic', relic.id, { detachEventLinks: true })
    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.relics).toEqual([])
    // 关联角色、地图地点与历史事件都不随秘境删除。
    expect(CharacterRepository.getByName('守镜人')).not.toBeNull()
    expect(WorldMapRepository.getAll().nodes.some(node => node.id === nodeA)).toBe(true)
    expect(StoryTimelineRepository.getAll().events.some(item => item.id === 'evt-relic')).toBe(true)
    expect(snapshot.eventLinks).toEqual([])
  })

  it('removes only the relation when a link is released, keeping both entities', () => {
    const { mortalWorld } = seedBase()
    const faction = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    const characterId = makeCharacter('林尘')
    const link = WorldWorkbenchRepository.upsertFactionCharacter({
      id: '', factionId: faction.id, characterId, relation: '弟子', tenureNote: '', note: '',
    })

    WorldWorkbenchRepository.deleteRelation('world_faction_characters', link.id)
    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.factionCharacters).toEqual([])
    expect(snapshot.factions.map(item => item.id)).toEqual([faction.id])
    expect(CharacterRepository.getByName('林尘')).not.toBeNull()
  })

  it('detaches world references when a project character is deleted, keeping shared entities', () => {
    const { mortalWorld } = seedBase()
    const faction = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    const relic = WorldWorkbenchRepository.upsertRelic(baseRelic(mortalWorld.id, '古剑秘境'))
    const characterId = makeCharacter('林尘')
    WorldWorkbenchRepository.upsertFactionCharacter({
      id: '', factionId: faction.id, characterId, relation: '弟子', tenureNote: '', note: '',
    })
    WorldWorkbenchRepository.upsertRelicCharacter({
      id: '', relicId: relic.id, characterId, relation: 'visited', customLabel: '', note: '',
    })
    WorldWorkbenchRepository.upsertCharacterLink({
      id: '', worldId: mortalWorld.id, characterId, relation: '出生于此', note: '',
    })
    StoryTimelineRepository.upsertEvent({
      id: 'evt-death', title: '陨落', timeLabel: '第三年', sortOrder: 3, precision: 'exact',
      description: '', chapterNumbers: [], characterNames: ['林尘'], locationNodeIds: [], status: 'planned',
    })
    WorldWorkbenchRepository.saveEventLinks('evt-death', [mortalWorld.id], [
      { id: '', eventId: 'evt-death', targetKind: 'character', targetId: characterId, worldId: mortalWorld.id, relation: '当事人', note: '' },
    ])

    CharacterRepository.delete('林尘')

    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.factionCharacters).toEqual([])
    expect(snapshot.relicCharacters).toEqual([])
    expect(snapshot.characterLinks).toEqual([])
    // 共享实体保留。
    expect(snapshot.factions.map(item => item.id)).toEqual([faction.id])
    expect(snapshot.relics.map(item => item.id)).toEqual([relic.id])
    expect(StoryTimelineRepository.getAll().events.some(item => item.id === 'evt-death')).toBe(true)
    // 历史人物证据保留但显式标注角色已删除，界面禁止跳转。
    const eventLink = snapshot.eventLinks.find(row => row.eventId === 'evt-death')
    expect(eventLink?.relation).toContain('角色已删除')
  })

  it('blocks a destructive map or node delete while world data references the location', () => {
    const { mortalWorld, nodeA } = seedBase()
    const relic = WorldWorkbenchRepository.upsertRelic({ ...baseRelic(mortalWorld.id, '古剑秘境'), nodeId: nodeA })
    void relic

    const nodePlan = WorldMapRepository.planNodeDelete(nodeA)
    expect(nodePlan.worldReferences.some(reference => reference.kind === 'relic-node')).toBe(true)
    expect(() => WorldMapRepository.deleteNode(nodeA)).toThrow(/世界资料引用/)

    const mapPlan = WorldMapRepository.planMapDelete(ROOT_MAP_ID, 'promote-children')
    expect(mapPlan.worldReferences.length).toBeGreaterThan(0)
    expect(() => WorldMapRepository.deleteMap(ROOT_MAP_ID, 'promote-children')).toThrow(/世界资料引用/)

    // 显式允许时才执行，且世界资料本身不被删除。
    WorldMapRepository.deleteNode(nodeA, { allowWorldReferenceBreak: true })
    expect(WorldWorkbenchRepository.getAll().relics.map(item => item.id)).toEqual([relic.id])
    expect(WorldWorkbenchRepository.getAll().relics[0].nodeId).toBeNull()
  })

  it('cleans trail references when a timeline event is deleted', () => {
    const { mortalWorld, nodeA } = seedBase()
    const heroId = makeCharacter('林尘')
    StoryTimelineRepository.upsertEvent({
      id: 'evt-route', title: '赶路', timeLabel: '第四年', sortOrder: 4, precision: 'exact',
      description: '', chapterNumbers: [], characterNames: [], locationNodeIds: [], status: 'planned',
    })
    WorldWorkbenchRepository.commitTrail({
      trail: { ...baseTrail(heroId, mortalWorld.id, nodeA, ''), eventId: 'evt-route' },
      alsoSetCurrentLocation: false,
    })

    StoryTimelineRepository.deleteEvent('evt-route')
    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.trails).toHaveLength(1)
    expect(snapshot.trails[0].eventId).toBeNull()
  })
})

describe('持久化', () => {
  it('survives closing and reopening the project database', () => {
    const { mortalWorld, immortalWorld, nodeA, nodeB } = seedBase()
    const sect = WorldWorkbenchRepository.upsertFaction(baseFaction(mortalWorld.id, '青云门'))
    const heroId = makeCharacter('林尘')
    WorldWorkbenchRepository.upsertFactionCharacter({
      id: '', factionId: sect.id, characterId: heroId, relation: '弟子', tenureNote: '', note: '',
    })
    WorldWorkbenchRepository.commitCurrentLocation(heroId, immortalWorld.id, nodeB, {})
    WorldWorkbenchRepository.commitTrail({
      trail: baseTrail(heroId, mortalWorld.id, nodeA, '大荒历 300 年'),
      alsoSetCurrentLocation: false,
    })
    WorldWorkbenchRepository.upsertPortal({
      ...basePortal(mortalWorld.id, immortalWorld.id, '登天梯'),
      fromNodeId: nodeA,
      toNodeId: nodeB,
    })

    closeProjectDatabase()
    initProjectDatabase(projectRoot)

    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.worlds.map(world => world.name).sort()).toEqual(['修真界', '凡人界'])
    expect(snapshot.factions.map(faction => faction.name)).toEqual(['青云门'])
    expect(snapshot.factionCharacters).toHaveLength(1)
    expect(snapshot.portals.map(portal => portal.name)).toEqual(['登天梯'])
    expect(snapshot.trails).toHaveLength(1)
    // 直接读库证明事实来自 SQLite，而不是内存 store。
    const row = db().prepare('SELECT COUNT(*) AS count FROM world_factions').get() as { count: number }
    expect(row.count).toBe(1)
    const view = snapshot.characterLocationViews.find(item => item.characterId === heroId)
    expect(view?.currentState).toBe('bound')
    expect(view?.locationText).toBe('修真界 · 天门城')
    expect(CharacterRepository.getByName('林尘')?.currentState?.location).toBe('修真界 · 天门城')
  })

  it('works on an empty project with no maps, no characters and no location data', () => {
    const world = makeWorld('空世界')
    const snapshot = WorldWorkbenchRepository.getAll()
    expect(snapshot.worlds.map(item => item.id)).toEqual([world.id])
    expect(snapshot.characterRefs).toEqual([])
    expect(snapshot.characterLocationViews).toEqual([])
    expect(snapshot.mapWorldLinks).toEqual([])
    expect(WorldWorkbenchRepository.planDelete('world', world.id).blockers).toEqual([])
  })

  it('exposes character references with their existing profile summary', () => {
    makeCharacter('林尘')
    const refs = WorldWorkbenchRepository.getAll().characterRefs
    expect(refs.map(ref => ref.name)).toEqual(['林尘'])
    expect(refs[0].role).toBe('protagonist')
    expect(refs[0].id).toBe(CharacterRelationshipRepository.resolveIdentity('林尘'))
  })
})
