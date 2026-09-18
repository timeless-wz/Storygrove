import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { WorldMapRepository } from '../repositories/world-map-repository'
import { ReviewRepository } from '../repositories/review-repository'
import { rebuildPlotTreeDeterministic } from '../../src/services/plot-tree-deterministic'
import { launchCreativeWorkflow, type CreativeIntent } from '../../src/services/workflows/creative-workflow-launcher'
import { useLayoutStore } from '../../src/stores/layout-store'
import { useDraftStore } from '../../src/stores/draft-store'

describe('Codex Fiction Creative Workbench Closure Integration Tests', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-closure-test-'))
    initProjectDatabase(tmpDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // 1. 蓝图直达写正文（第 1 章与第 42 章）、录入、保存、重开持久化。
  it('supports direct manual drafting from blueprints for Ch1 and Ch42 with save and reopen persistence', () => {
    // Commit blueprints for chapter 1 and chapter 42
    BlueprintRepository.commitRange({
      mode: 'replace-range',
      operationId: 'bp-op-1',
      startChapter: 1,
      endChapter: 1,
      blueprints: [{
        chapterNumber: 1,
        title: '第 1 章 命运之始',
        role: '建置',
        purpose: '引入主角与核心世界观冲突',
        keyEvents: '主角在白银城醒来',
        characters: ['克莱因'],
        suspenseHook: '远方钟楼的倒悬指针',
        userGuidance: '## 大纲指引\n第一章重点刻画迷雾中的清晨氛围',
        notes: '',
        notesUpdatedAt: '',
      }],
    })

    BlueprintRepository.commitRange({
      mode: 'replace-range',
      operationId: 'bp-op-42',
      startChapter: 42,
      endChapter: 42,
      blueprints: [{
        chapterNumber: 42,
        title: '第 42 章 终焉前夜',
        role: '高潮',
        purpose: '全线收束，决战前夕的阵营对峙',
        keyEvents: '各方势力集结黑曜石平原',
        characters: ['克莱因', '修女菲莉丝'],
        suspenseHook: '神秘信使带来的绝密羊皮纸',
        userGuidance: '## 大纲指引\n大决战前夜的压抑与希望',
        notes: '',
        notesUpdatedAt: '',
      }],
    })

    // Verify blueprints exist
    const bp1 = BlueprintRepository.getByChapter(1)
    const bp42 = BlueprintRepository.getByChapter(42)
    expect(bp1).toBeTruthy()
    expect(bp42).toBeTruthy()

    // Author writes Chapter 1 draft directly
    const ch1DraftText = '晨曦初破，灰雾弥漫的白银城街头，克莱因推开了沉重的木门。'
    const ch1DraftId = DraftRepository.create({
      chapterNumber: 1,
      source: 'write',
      content: ch1DraftText,
      wordCount: ch1DraftText.length,
    })
    expect(ch1DraftId).toBeGreaterThan(0)

    // Author writes Chapter 42 draft directly (jumping forward directly without generation)
    const ch42DraftText = '第四十二章：长夜将尽。平原上的旌旗在冷风中猎猎作响，信使送来了最后的羊皮纸。'
    const ch42DraftId = DraftRepository.create({
      chapterNumber: 42,
      source: 'write',
      content: ch42DraftText,
      wordCount: ch42DraftText.length,
    })
    expect(ch42DraftId).toBeGreaterThan(0)

    // Author edits and saves Chapter 1 draft
    const ch1UpdatedText = '晨曦初破，灰雾弥漫的白银城街头，克莱因推开了沉重的木门，街角传来第一声报时钟鸣。'
    DraftRepository.updateContent(ch1DraftId, ch1UpdatedText, ch1UpdatedText.length)

    // Verify content in memory
    const loadedCh1 = DraftRepository.getFull(ch1DraftId)
    const loadedCh42 = DraftRepository.getFull(ch42DraftId)
    expect(loadedCh1?.content).toBe(ch1UpdatedText)
    expect(loadedCh42?.content).toBe(ch42DraftText)

    // Simulate app restart / reopen: close and reopen database
    closeProjectDatabase()
    initProjectDatabase(tmpDir)

    // Re-query database after reopen
    const reopenedCh1 = DraftRepository.getFull(ch1DraftId)
    const reopenedCh42 = DraftRepository.getFull(ch42DraftId)
    expect(reopenedCh1?.content).toBe(ch1UpdatedText)
    expect(reopenedCh1?.chapterNumber).toBe(1)
    expect(reopenedCh42?.content).toBe(ch42DraftText)
    expect(reopenedCh42?.chapterNumber).toBe(42)

    // Blueprints remain completely intact after restart
    const reopenedBp1 = BlueprintRepository.getByChapter(1)
    const reopenedBp42 = BlueprintRepository.getByChapter(42)
    expect(reopenedBp1?.title).toBe('第 1 章 命运之始')
    expect(reopenedBp42?.title).toBe('第 42 章 终焉前夜')
  })

  // 2. 全局杜绝生成正文/批量写正文/修稿合并入口。
  it('strictly prohibits auto-draft generation, batch writing, and revision merge writeback', async () => {
    // 2.1 Workflow launcher blocks generate_draft
    await expect(
      launchCreativeWorkflow({
        workflow: 'generate_draft',
        chapterNumber: 1,
      } as unknown as CreativeIntent),
    ).rejects.toThrow(/Codex 创作工作台已禁用自动生成正文与自动修稿/u)

    // 2.2 Workflow launcher blocks refine
    await expect(
      launchCreativeWorkflow({
        workflow: 'refine',
        chapterNumber: 1,
      } as unknown as CreativeIntent),
    ).rejects.toThrow(/Codex 创作工作台已禁用自动生成正文与自动修稿/u)

    // 2.3 Layout store openChapterCreation is a no-op
    const layoutStore = useLayoutStore.getState()
    layoutStore.openChapterCreation({ chapterNumber: 1 })
    expect(useLayoutStore.getState().chapterCreationOpen).toBe(false)

    // 2.4 Draft store has no applyMergedRevision function
    const draftStoreState = useDraftStore.getState() as unknown as Record<string, unknown>
    expect(draftStoreState.applyMergedRevision).toBeUndefined()
  })

  // 3. 审核只读不变量（审核后正文内容、版本、哈希及蓝图均不改变）。
  it('enforces read-only audit invariant: draft content, hash, version, and blueprints are immutable', () => {
    // Setup chapter 10 draft and blueprint
    BlueprintRepository.commitRange({
      mode: 'replace-range',
      operationId: 'bp-audit-ch10',
      startChapter: 10,
      endChapter: 10,
      blueprints: [{
        chapterNumber: 10,
        title: '第 10 章 迷失森林',
        role: '转折',
        purpose: '揭露森林深处的秘密通道',
        keyEvents: '遭遇暗影巨兽',
        characters: ['克莱因'],
        suspenseHook: '地底传来的齿轮声',
        userGuidance: '重点渲染迷雾幽闭感',
        notes: '',
        notesUpdatedAt: '',
      }],
    })

    const initialText = '穿过枯萎的灌木丛，克莱因在树干上发现了一道新鲜的刻痕。暗影在树冠间悄然聚集。'
    const draftId = DraftRepository.create({
      chapterNumber: 10,
      source: 'write',
      content: initialText,
      wordCount: initialText.length,
    })

    const draftBefore = DraftRepository.getFull(draftId)!
    const bpBefore = BlueprintRepository.getByChapter(10)!
    const draftHashBefore = createHash('sha256').update(draftBefore.content).digest('hex')
    const bpHashBefore = createHash('sha256').update(JSON.stringify(bpBefore)).digest('hex')

    // Perform audit / review (read-only critique)
    const reviewResult = ReviewRepository.create({
      baseDraftId: draftId,
      content: JSON.stringify({
        overallScore: 88,
        dimensions: [
          { name: '一致性', score: 90, comment: '与蓝图中的迷雾森林设定高度吻合' },
          { name: '文笔节奏', score: 85, comment: '暗影出现的铺垫节奏自然' },
        ],
        strengths: ['环境描写细致', '悬念感强'],
        weaknesses: ['暗影巨兽出场前可增加听觉预警'],
        suggestions: ['建议在进入枯萎灌木丛前增加细微的齿轮运转声'],
        summary: '整体质量优秀，与蓝图目标一致。',
      }),
      expectedSource: {
        id: draftId,
        chapterNumber: draftBefore.chapterNumber,
        version: draftBefore.version,
        status: draftBefore.status as 'draft' | 'revised' | 'reviewed' | 'finalized' | 'archived',
        content: draftBefore.content,
      },
    })
    expect(reviewResult.id).toBeGreaterThan(0)

    // Query draft and blueprint after audit
    const draftAfter = DraftRepository.getFull(draftId)!
    const bpAfter = BlueprintRepository.getByChapter(10)!
    const draftHashAfter = createHash('sha256').update(draftAfter.content).digest('hex')
    const bpHashAfter = createHash('sha256').update(JSON.stringify(bpAfter)).digest('hex')

    // Invariant assertions:
    // 1. Draft content unchanged
    expect(draftAfter.content).toBe(initialText)
    // 2. Draft hash unchanged
    expect(draftHashAfter).toBe(draftHashBefore)
    // 3. Draft version unchanged
    expect(draftAfter.version).toBe(draftBefore.version)
    // 4. Blueprint unchanged
    expect(bpAfter.title).toBe(bpBefore.title)
    expect(bpAfter.purpose).toBe(bpBefore.purpose)
    expect(bpAfter.keyEvents).toBe(bpBefore.keyEvents)
    expect(bpHashAfter).toBe(bpHashBefore)
    // 5. No new draft versions created
    const allDrafts = DraftRepository.listByChapter(10)
    expect(allDrafts).toHaveLength(1)
  })

  // 4. 世界地图候选提取（已批准资料才出现，未批准不出现）。
  it('extracts world map candidates ONLY from real approved workspace data and excludes unapproved/disabled sources', () => {
    const db = getProjectDb()!

    // Insert an UNAPPROVED source
    db.prepare(`
      INSERT INTO workspace_sources (
        id, project_id, absolute_path, relative_path, category, authority_status,
        content_hash, observed_snapshot_id, approved_snapshot_id, import_status, is_missing, is_disabled
      ) VALUES (
        'src-unapproved', 'main', 'C:/novels/unapproved.md', '设定/未批准秘境.md', 'world_data', 'candidate',
        'hash-unapproved', 'snap-unapproved', NULL, 'scanned', 0, 0
      )
    `).run()

    db.prepare(`
      INSERT INTO workspace_source_snapshots (snapshot_id, source_id, project_id, content_hash)
      VALUES ('snap-unapproved', 'src-unapproved', 'main', 'hash-unapproved')
    `).run()

    db.prepare(`
      INSERT INTO workspace_source_snapshot_rules (
        id, snapshot_id, source_id, project_id, title, content, status, constraint_type, scope, source_file
      ) VALUES (
        'rule-unapproved', 'snap-unapproved', 'src-unapproved', 'main', '未批准的遗忘废墟', '未被批准的候选废墟', 'candidate', 'soft', 'global', '设定/未批准秘境.md'
      )
    `).run()

    // Candidates should be empty: unapproved source must NOT produce candidates!
    let candidates = WorldMapRepository.extractCandidates('main')
    expect(candidates.find(c => c.name.includes('未批准的遗忘废墟'))).toBeUndefined()

    // Insert an APPROVED source
    db.prepare(`
      INSERT INTO workspace_sources (
        id, project_id, absolute_path, relative_path, category, authority_status,
        content_hash, observed_snapshot_id, approved_snapshot_id, import_status, is_missing, is_disabled
      ) VALUES (
        'src-approved', 'main', 'C:/novels/world.md', '设定/03_里世界探索.md', 'world_data', 'confirmed',
        'hash-approved', 'snap-approved', 'snap-approved', 'imported', 0, 0
      )
    `).run()

    db.prepare(`
      INSERT INTO workspace_source_snapshots (snapshot_id, source_id, project_id, content_hash)
      VALUES ('snap-approved', 'src-approved', 'main', 'hash-approved')
    `).run()

    db.prepare(`
      INSERT INTO workspace_source_snapshot_rules (
        id, snapshot_id, source_id, project_id, title, content, status, constraint_type, scope, source_file
      ) VALUES (
        'rule-approved-01', 'snap-approved', 'src-approved', 'main', '里世界深层界隙', '空间褶皱深层的探索锚点', 'confirmed', 'hard', 'global', '设定/03_里世界探索.md'
      )
    `).run()

    db.prepare(`
      INSERT INTO workspace_source_snapshot_fragments (
        id, snapshot_id, source_id, project_id, heading_path, content, start_line, end_line, fragment_hash, status
      ) VALUES (
        'frag-approved-01', 'snap-approved', 'src-approved', 'main', '里世界探索/幽影回廊', '通往地下遗境的隐秘长廊', 1, 20, 'fraghash1', 'active'
      )
    `).run()

    // Candidates should now extract from approved source
    candidates = WorldMapRepository.extractCandidates('main')
    const ruleCandidate = candidates.find(c => c.name === '里世界深层界隙')
    const fragCandidate = candidates.find(c => c.name === '幽影回廊')

    expect(ruleCandidate).toBeDefined()
    expect(ruleCandidate?.suggestedLayer).toBe('underground')
    expect(fragCandidate).toBeDefined()
    expect(fragCandidate?.suggestedLayer).toBe('underground')

    // Disable the approved source (is_disabled = 1)
    db.prepare(`UPDATE workspace_sources SET is_disabled = 1 WHERE id = 'src-approved'`).run()
    candidates = WorldMapRepository.extractCandidates('main')
    expect(candidates.find(c => c.name === '里世界深层界隙')).toBeUndefined()
    expect(candidates.find(c => c.name === '幽影回廊')).toBeUndefined()
  })

  // 5. 剧情树多卷 vs 中立主线（无卷信息时为中立主线且不带第一卷字样，有多卷时拆分对应轨道）。
  it('builds neutral 主线 when no volume info exists, and splits tracks when multi-volume is detected', () => {
    // 5.1 Case A: No volume info -> Neutral "主线" without "第一卷"
    const neutralBlueprints = Array.from({ length: 15 }, (_, i) => ({
      chapterNumber: i + 1,
      title: `第 ${i + 1} 章 征途`,
      purpose: `章节 ${i + 1} 推进`,
      keyEvents: `事件 ${i + 1}`,
      userGuidance: i === 0 ? '## 本章大纲\n主角在王都集市识破刺客阴谋' : '',
    }))

    const neutralPlotTree = rebuildPlotTreeDeterministic({
      writingLanguage: 'zh-CN',
      synopsis: { content: '中立主线总纲' },
      blueprints: neutralBlueprints,
      finalizedChapters: [],
      narrativeThreads: [{
        id: 99,
        title: '线索：王都迷雾',
        type: 'main_thread',
        targetStartChapter: 3,
        targetEndChapter: 10,
        authorIntent: '调查王都迷雾起因',
        status: 'progressing',
        events: [],
      }],
      sourceRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      snapshot: null,
    })

    expect(neutralPlotTree.tracks).toHaveLength(2)
    const neutralMain = neutralPlotTree.tracks[0]
    expect(neutralMain.id).toBe('track-main')
    expect(neutralMain.title).toBe('主线')
    expect(neutralMain.title).not.toContain('第一卷')
    expect(neutralMain.startChapter).toBe(1)
    expect(neutralMain.endChapter).toBe(15)

    // Event 1 summary uses userGuidance outline summary
    expect(neutralMain.events[0].summary).toContain('主角在王都集市识破刺客阴谋')

    // Subplot points to neutral track-main
    const neutralSub = neutralPlotTree.tracks[1]
    expect(neutralSub.parentTrackId).toBe('track-main')

    // 5.2 Case B: Multi-volume split
    const multiVolBlueprints = [
      {
        chapterNumber: 1,
        title: '第一卷 破茧',
        purpose: '卷一序曲',
        keyEvents: '破茧重生',
        volumeNumber: 1,
        volumeTitle: '第一卷',
      },
      {
        chapterNumber: 2,
        title: '第一卷 试炼',
        purpose: '卷一中局',
        keyEvents: '通过学院考核',
        volumeNumber: 1,
        volumeTitle: '第一卷',
      },
      {
        chapterNumber: 3,
        title: '第二卷 远征',
        purpose: '卷二展开',
        keyEvents: '组建远征军',
        volumeNumber: 2,
        volumeTitle: '第二卷',
      },
      {
        chapterNumber: 4,
        title: '第二卷 烽火',
        purpose: '卷二决胜',
        keyEvents: '边关阻击战',
        volumeNumber: 2,
        volumeTitle: '第二卷',
      },
    ]

    const multiVolPlotTree = rebuildPlotTreeDeterministic({
      writingLanguage: 'zh-CN',
      synopsis: { content: '双卷结构总纲' },
      blueprints: multiVolBlueprints,
      finalizedChapters: [],
      narrativeThreads: [{
        id: 100,
        title: '支线：远征补给线',
        type: 'sub_plot',
        targetStartChapter: 3,
        targetEndChapter: 4,
        authorIntent: '确保军需供给',
        status: 'progressing',
        events: [],
      }],
      sourceRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      snapshot: null,
    })

    // 2 main tracks (Volume 1, Volume 2) + 1 subplot track
    expect(multiVolPlotTree.tracks).toHaveLength(3)

    const vol1Track = multiVolPlotTree.tracks[0]
    expect(vol1Track.id).toBe('track-main-vol1')
    expect(vol1Track.title).toBe('第一卷主线')
    expect(vol1Track.startChapter).toBe(1)
    expect(vol1Track.endChapter).toBe(2)

    const vol2Track = multiVolPlotTree.tracks[1]
    expect(vol2Track.id).toBe('track-main-vol2')
    expect(vol2Track.title).toBe('第二卷主线')
    expect(vol2Track.startChapter).toBe(3)
    expect(vol2Track.endChapter).toBe(4)

    // Subplot starting at chapter 3 belongs to Volume 2
    const vol2Sub = multiVolPlotTree.tracks[2]
    expect(vol2Sub.parentTrackId).toBe('track-main-vol2')
  })
})
