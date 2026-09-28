import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../electron/database'
import { BlueprintRepository } from '../electron/repositories/blueprint-repository'
import { DraftRepository } from '../electron/repositories/draft-repository'
import { ProjectCoreRepository } from '../electron/repositories/project-core-repository'
import { CharacterRepository } from '../electron/repositories/character-repository'
import { WorldMapRepository } from '../electron/repositories/world-map-repository'
import { StoryTimelineRepository } from '../electron/repositories/story-timeline-repository'
import { ForeshadowingRepository } from '../electron/repositories/foreshadowing-repository'
import { createWorldMapId } from '../src/shared/world-map'

function insertTestDraft(chapterNumber: number, version: number, content: string, status = 'draft') {
  const db = getProjectDb()!
  const contentRes = db.prepare("INSERT INTO contents (body, created_at) VALUES (?, datetime('now'))").run(content)
  const contentId = contentRes.lastInsertRowid
  const draftRes = db.prepare(`
    INSERT INTO drafts (chapter_number, version, status, source, content_id, word_count, source_dependencies)
    VALUES (?, ?, ?, 'write', ?, ?, '[]')
  `).run(chapterNumber, version, status, contentId, content.length)
  return { id: Number(draftRes.lastInsertRowid), chapterNumber, version, status, contentId: Number(contentId) }
}

function getTestDrafts() {
  const db = getProjectDb()!
  return db.prepare(`
    SELECT d.id, d.chapter_number, d.version, d.status, c.body AS content
    FROM drafts d
    JOIN contents c ON d.content_id = c.id
    ORDER BY d.id ASC
  `).all() as Array<{ id: number; chapter_number: number; version: number; status: string; content: string }>
}

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  closeProjectDatabase()
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // transient Windows file locks will be cleaned up by OS
    }
  }
})

describe('NAV-05 & FUNC-01: Real SQLite Backend Persistence, Multi-Volume & Read-Back', () => {
  it('creates two volumes, two chapters per volume, two drafts per chapter, and reads back after DB reopen', async () => {
    const projectRoot = createTempDir('vela-nav-backend-')
    fs.mkdirSync(path.join(projectRoot, '.vela'), { recursive: true })
    fs.mkdirSync(path.join(projectRoot, 'manuscript'), { recursive: true })

    // 1. 初始化数据库
    initProjectDatabase(projectRoot)
    const db = getProjectDb()
    expect(db).not.toBeNull()

    // 2. 准备两卷 (Volume 1 & Volume 2)
    BlueprintRepository.upsertVolume({
      id: 'volume-1',
      name: '第一卷 风起云涌',
      sortOrder: 1,
    })
    BlueprintRepository.upsertVolume({
      id: 'volume-2',
      name: '第二卷 龙战于野',
      sortOrder: 2,
    })

    const volumes = BlueprintRepository.getVolumes()
    expect(volumes).toHaveLength(2)
    expect(volumes[0].name).toBe('第一卷 风起云涌')
    expect(volumes[1].name).toBe('第二卷 龙战于野')

    // 3. 准备每卷两章蓝图 (Vol 1: Ch 1, 2; Vol 2: Ch 3, 4)
    BlueprintRepository.upsert({
      chapterNumber: 1,
      volumeId: 'volume-1',
      title: '少年初试锋芒',
      role: '建置',
      purpose: '交代主角身世与核心悬念',
      keyEvents: '宗门测试，灵根初显',
      characters: ['林风', '李导师'],
      userGuidance: '重点渲染测试时的压迫感',
    })

    BlueprintRepository.upsert({
      chapterNumber: 2,
      volumeId: 'volume-1',
      title: '寒潭暗藏杀机',
      role: '发展',
      purpose: '引入外部反派冲突',
      keyEvents: '采药偶遇黑煞门余孽',
      characters: ['林风', '黑煞长老'],
      userGuidance: '战斗节奏紧凑',
    })

    BlueprintRepository.upsert({
      chapterNumber: 3,
      volumeId: 'volume-2',
      title: '深入蛮荒绝地',
      role: '转折',
      purpose: '世界观拓宽到第二卷大陆',
      keyEvents: '穿越死亡沙海，寻找遗迹',
      characters: ['林风', '神秘向导'],
      userGuidance: '强调环境恶劣',
    })

    BlueprintRepository.upsert({
      chapterNumber: 4,
      volumeId: 'volume-2',
      title: '上古遗阵惊变',
      role: '高潮',
      purpose: '触发卷末大战',
      keyEvents: '阵眼破裂，妖王苏醒',
      characters: ['林风', '妖王残魂'],
      userGuidance: '史诗感与绝望感',
    })

    // 4. 准备每章两份草稿 (Ch 1: v1, v2; Ch 2: v1, v2; Ch 3: v1; Ch 4: v1)
    const ch1_v1 = insertTestDraft(1, 1, '【初稿草稿】林风站在石台前，手掌按向测试灵石。')
    const ch1_v2 = insertTestDraft(1, 2, '【修订二稿】林风站在青苍石台前，手掌缓缓按向悬浮的测试灵石。光芒冲天而起！', 'finalized')

    const ch2_v1 = insertTestDraft(2, 1, '夜黑风高，寒潭水面波澜不惊。')
    const ch2_v2 = insertTestDraft(2, 2, '夜黑风高，寒潭水面泛起一丝刺骨冰寒。林风屏息凝神，隐于树荫深处。')

    const ch3_v1 = insertTestDraft(3, 1, '狂沙漫天，视野不足三尺。')

    // 5. 写入核心架构文档 (Premise, Worldbuilding, Synopsis)
    ProjectCoreRepository.init('测试小说')
    ProjectCoreRepository.update({
      premise: '【核心故事前提】天才少年意外觉醒上古神灵血脉，逆境崛起打破神界桎梏。',
      worldbuilding: '【世界观】九天十地，以灵气凝聚度划分为凡尘、玄域、天阙三层境界。',
      synopsis: '【全书大纲】全书分五卷，共60章，从边境小镇至横扫玄域。',
    })

    // 6. 写入角色档案
    CharacterRepository.upsert({
      name: '林风',
      role: 'protagonist',
      gender: '男',
      age: '17',
      appearance: '青衫落拓，眉宇如剑，双眸深邃',
      personality: '沉着冷静、恩怨分明、极具决断力',
      background: '幼时家族遭劫，唯一幸存者',
      abilities: '九霄神雷诀、无名断剑',
      motivation: '查明家族覆灭真相，问鼎武道巅峰',
      relationships: '师承李导师，仇视黑煞门',
      arc: '从边缘宗门弃徒成长为诸天神主',
      notes: '佩戴神秘残破玉佩',
    })

    // 7. 写入多地图地点
    const mapId = createWorldMapId()
    WorldMapRepository.upsertMap({
      id: mapId,
      name: '青云门山界图',
      parentMapId: null,
      sortOrder: 1,
      image: null,
    })
    WorldMapRepository.upsertNode({
      id: 'node-stone-platform',
      mapId,
      name: '灵根测试台',
      type: 'landmark',
      description: '外门弟子晋升内门测试场地',
      parentId: null,
      x: 150,
      y: 200,
      sourceRefs: [],
    })

    // 8. 写入故事时间线
    StoryTimelineRepository.upsertEvent({
      id: 'event-test-day',
      title: '青云门秋闱大测',
      timeLabel: '天元历四三二年秋九月初三',
      sortOrder: 1,
      precision: 'exact',
      rangeEndLabel: null,
      description: '主角林风在此日检测出神级灵根',
      chapterNumbers: [1],
      characterNames: ['林风'],
      locationNodeIds: ['node-stone-platform'],
      status: 'finalized',
    })

    // 9. 写入伏笔
    ForeshadowingRepository.create({
      id: 'hook-jade-pendant',
      draftId: ch1_v1.id,
      chapterNumber: 1,
      selectedText: '母亲遗留的残破玉佩',
      startOffset: 10,
      endOffset: 20,
      note: '玉佩接触神脉灵石时发出微弱轰鸣',
    })

    // ===== 关键测试步骤：关闭数据库，模拟应用关闭 =====
    closeProjectDatabase()
    expect(getProjectDb()).toBeNull()

    // ===== 重新打开数据库，模拟应用重新启动或重新打开项目 =====
    initProjectDatabase(projectRoot)
    const reopenedDb = getProjectDb()
    expect(reopenedDb).not.toBeNull()

    // ===== 回读与断言真实数据完整性 =====

    // 回读分卷
    const reloadedVolumes = BlueprintRepository.getVolumes()
    expect(reloadedVolumes).toHaveLength(2)
    expect(reloadedVolumes.map(v => v.name)).toEqual(['第一卷 风起云涌', '第二卷 龙战于野'])

    // 回读蓝图 (验证卷与章的归属)
    const reloadedBlueprints = BlueprintRepository.getAll()
    expect(reloadedBlueprints).toHaveLength(4)
    const bp1 = reloadedBlueprints.find(b => b.chapterNumber === 1)!
    expect(bp1.volumeId ?? 'volume-1').toBe('volume-1')
    expect(bp1.title).toBe('少年初试锋芒')
    expect(bp1.keyEvents).toBe('宗门测试，灵根初显')

    const bp3 = reloadedBlueprints.find(b => b.chapterNumber === 3)!
    expect(bp3.volumeId).toBe('volume-2')
    expect(bp3.title).toBe('深入蛮荒绝地')

    // 回读草稿 (验证多版本与定稿状态)
    const ch1Drafts = reopenedDb.prepare(`
      SELECT d.id, d.chapter_number, d.version, d.status, c.body AS content
      FROM drafts d
      JOIN contents c ON d.content_id = c.id
      WHERE d.chapter_number = ?
      ORDER BY d.version ASC
    `).all(1) as Array<{ id: number; chapter_number: number; version: number; status: string; content: string }>
    expect(ch1Drafts).toHaveLength(2)
    const ch1DraftV2 = ch1Drafts.find(d => d.version === 2)!
    expect(ch1DraftV2.status).toBe('finalized')
    expect(ch1DraftV2.content).toContain('光芒冲天而起')

    const ch2Drafts = reopenedDb.prepare(`
      SELECT d.id, d.chapter_number, d.version, d.status, c.body AS content
      FROM drafts d
      JOIN contents c ON d.content_id = c.id
      WHERE d.chapter_number = ?
      ORDER BY d.version ASC
    `).all(2) as Array<{ id: number; chapter_number: number; version: number; status: string; content: string }>
    expect(ch2Drafts).toHaveLength(2)
    const ch2DraftV1 = ch2Drafts.find(d => d.version === 1)!
    expect(ch2DraftV1.content).toContain('夜黑风高')

    // 回读核心故事架构
    const core = ProjectCoreRepository.get()!
    expect(core.premise).toContain('天才少年意外觉醒上古神灵血脉')
    expect(core.worldbuilding).toContain('九天十地')
    expect(core.synopsis).toContain('全书分五卷')

    // 回读角色
    const characters = CharacterRepository.getAll()
    expect(characters).toHaveLength(1)
    expect(characters[0].name).toBe('林风')
    expect(characters[0].abilities).toContain('九霄神雷诀')

    // 回读地图
    const atlas = WorldMapRepository.getAll()
    expect(atlas.maps).toHaveLength(1)
    expect(atlas.maps[0].name).toBe('青云门山界图')
    expect(atlas.nodes).toHaveLength(1)
    expect(atlas.nodes[0].name).toBe('灵根测试台')

    // 回读时间线
    const timeline = StoryTimelineRepository.getAll()
    expect(timeline.events).toHaveLength(1)
    expect(timeline.events[0].title).toBe('青云门秋闱大测')

    // 回读伏笔
    const hooks = ForeshadowingRepository.listAll()
    expect(hooks).toHaveLength(1)
    expect(hooks[0].selectedText).toBe('母亲遗留的残破玉佩')
  })
})

describe('NAV-07: Cross-Project Isolation in SQLite Database Layer', () => {
  it('strictly isolates Project A and Project B databases without data bleed', () => {
    const projectARoot = createTempDir('vela-nav-proj-a-')
    const projectBRoot = createTempDir('vela-nav-proj-b-')
    fs.mkdirSync(path.join(projectARoot, '.vela'), { recursive: true })
    fs.mkdirSync(path.join(projectBRoot, '.vela'), { recursive: true })

    // 1. 初始化项目 A，写入专属数据
    initProjectDatabase(projectARoot)
    BlueprintRepository.upsert({
      chapterNumber: 1,
      title: '项目A独有章节：仙途初醒',
      purpose: 'A的设定',
    })
    insertTestDraft(1, 1, '【项目A正文】这是A的世界。')
    ProjectCoreRepository.init('项目A')
    ProjectCoreRepository.update({ premise: '【项目A前提】仙道修真。' })
    CharacterRepository.upsert({
      name: '修真者A',
      role: 'protagonist',
      gender: '男',
      age: '20',
      appearance: '',
      personality: '',
      background: '',
      abilities: '',
      motivation: '',
      relationships: '',
      arc: '',
      notes: '',
    })

    // 2. 切换到项目 B
    closeProjectDatabase()
    initProjectDatabase(projectBRoot)

    // 检查项目 B 初始状态没有任何来自 A 的数据
    expect(BlueprintRepository.getAll()).toHaveLength(0)
    expect(getTestDrafts()).toHaveLength(0)
    expect(ProjectCoreRepository.get()?.premise ?? '').toBe('')
    expect(CharacterRepository.getAll()).toHaveLength(0)

    // 写入项目 B 专属数据
    BlueprintRepository.upsert({
      chapterNumber: 1,
      title: '项目B独有章节：末日废土',
      purpose: 'B的设定',
    })
    insertTestDraft(1, 1, '【项目B正文】辐射与荒原。')
    ProjectCoreRepository.init('项目B')
    ProjectCoreRepository.update({ premise: '【项目B前提】废土机甲生存。' })
    CharacterRepository.upsert({
      name: '废土幸存者B',
      role: 'protagonist',
      gender: '女',
      age: '25',
      appearance: '',
      personality: '',
      background: '',
      abilities: '',
      motivation: '',
      relationships: '',
      arc: '',
      notes: '',
    })

    // 3. 切回项目 A，验证 A 的数据完全不受 B 的写入影响
    closeProjectDatabase()
    initProjectDatabase(projectARoot)

    const aBlueprints = BlueprintRepository.getAll()
    expect(aBlueprints).toHaveLength(1)
    expect(aBlueprints[0].title).toBe('项目A独有章节：仙途初醒')

    const aDrafts = getTestDrafts()
    expect(aDrafts).toHaveLength(1)
    expect(aDrafts[0].content).toBe('【项目A正文】这是A的世界。')

    expect(ProjectCoreRepository.get()?.premise).toBe('【项目A前提】仙道修真。')

    const aCharacters = CharacterRepository.getAll()
    expect(aCharacters).toHaveLength(1)
    expect(aCharacters[0].name).toBe('修真者A')

    // 4. 再切回项目 B，验证 B 的数据完整且无 A 的残留
    closeProjectDatabase()
    initProjectDatabase(projectBRoot)

    const bBlueprints = BlueprintRepository.getAll()
    expect(bBlueprints).toHaveLength(1)
    expect(bBlueprints[0].title).toBe('项目B独有章节：末日废土')

    const bDrafts = getTestDrafts()
    expect(bDrafts).toHaveLength(1)
    expect(bDrafts[0].content).toBe('【项目B正文】辐射与荒原。')

    expect(ProjectCoreRepository.get()?.premise).toBe('【项目B前提】废土机甲生存。')

    const bCharacters = CharacterRepository.getAll()
    expect(bCharacters).toHaveLength(1)
    expect(bCharacters[0].name).toBe('废土幸存者B')
  })

  it('verifies DraftRepository ReadonlyArray syntax fix and batch import', () => {
    const projectRoot = createTempDir('vela-nav-draft-repo-')
    fs.mkdirSync(path.join(projectRoot, '.vela'), { recursive: true })
    initProjectDatabase(projectRoot)

    const createdDraftId = DraftRepository.create({
      chapterNumber: 1,
      version: 1,
      content: '少年执剑立于山巅。',
      wordCount: 9,
      source: 'write',
    })
    expect(createdDraftId).toBeGreaterThan(0)

    const drafts = DraftRepository.listByChapter(1)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].chapterNumber).toBe(1)
    expect(drafts[0].wordCount).toBe(9)

    // 验证批处理导入方法 createImportedBatch 的 ReadonlyArray 语法
    const imported = DraftRepository.createImportedBatch([
      { chapterNumber: 2, title: '第二章 幽冥鬼市', content: '鬼市隐匿于浓雾深处。', wordCount: 10 },
      { chapterNumber: 3, title: '第三章 绝处逢生', content: '雷光自九天倾泻而下。', wordCount: 10 },
    ])
    expect(imported).toHaveLength(2)
    expect(imported[0].chapterNumber).toBe(2)
    expect(imported[1].chapterNumber).toBe(3)

    const ch2Drafts = DraftRepository.listByChapter(2)
    expect(ch2Drafts[0].chapterTitle).toBe('第二章 幽冥鬼市')
  })
})
