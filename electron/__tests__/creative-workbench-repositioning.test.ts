import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { closeProjectDatabase, initProjectDatabase } from '../database'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { WorldMapRepository } from '../repositories/world-map-repository'
import { ReviewRepository } from '../repositories/review-repository'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { rebuildPlotTreeDeterministic } from '../../src/services/plot-tree-deterministic'

describe('Creative Workbench Repositioning Verification', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-repositioning-test-'))
    initProjectDatabase(tmpDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('allows direct blank prose draft creation for any chapter without LLM / model dependency', () => {
    // Create a draft for chapter 1 directly without needing AI models or pre-generated text
    const ch1DraftId = DraftRepository.create({
      chapterNumber: 1,
      source: 'write',
      content: '这是作者直接手工写下的第一章开篇正文。',
      wordCount: 22,
    })
    expect(ch1DraftId).toBeGreaterThan(0)

    // Create a draft for chapter 42 directly (non-consecutive, no prerequisite barriers)
    const ch42DraftId = DraftRepository.create({
      chapterNumber: 42,
      source: 'write',
      content: '',
      wordCount: 0,
    })
    expect(ch42DraftId).toBeGreaterThan(0)

    // Retrieve drafts metadata and content
    const ch1Meta = DraftRepository.getMeta(ch1DraftId)
    expect(ch1Meta?.chapterNumber).toBe(1)
    expect(ch1Meta?.status).toBe('draft')

    const ch42Full = DraftRepository.getFull(ch42DraftId)
    expect(ch42Full?.chapterNumber).toBe(42)
    expect(ch42Full?.content).toBe('')
  })

  it('preserves full user_guidance outline across blueprints 1 to 58 and projects them deterministically to plot tree', () => {
    const blueprintsToCommit = Array.from({ length: 58 }, (_, i) => ({
      chapterNumber: i + 1,
      title: `第 ${i + 1} 章 故事节点`,
      role: i === 0 ? '建置' : i === 20 ? '发展' : i === 45 ? '高潮' : '铺垫',
      purpose: `达成阶段目标 ${i + 1}`,
      keyEvents: `核心事件 ${i + 1}`,
      characters: ['主角A', '配角B'],
      suspenseHook: `悬念钩子 ${i + 1}`,
      userGuidance: `这是作者为第 ${i + 1} 章拟定的详细创作指引细纲全文：必须遵循的世界法则与人物心理历程。`,
      notes: '',
      notesUpdatedAt: '',
    }))

    const receipt = BlueprintRepository.commitRange({
      mode: 'full',
      operationId: 'op-init-58',
      startChapter: 1,
      endChapter: 58,
      blueprints: blueprintsToCommit,
    })
    expect(receipt.chapterNumbers).toHaveLength(58)
    expect(receipt.startChapter).toBe(1)
    expect(receipt.endChapter).toBe(58)

    // Verify userGuidance is preserved completely for chapter 1 and chapter 58
    const bp1 = BlueprintRepository.getByChapter(1)
    expect(bp1).not.toBeNull()
    expect(bp1?.userGuidance).toContain('这是作者为第 1 章拟定的详细创作指引细纲全文')

    const bp58 = BlueprintRepository.getByChapter(58)
    expect(bp58).not.toBeNull()
    expect(bp58?.userGuidance).toContain('这是作者为第 58 章拟定的详细创作指引细纲全文')

    // Project deterministically to Plot Tree (zero LLM calls)
    const allBlueprints = BlueprintRepository.getAll()
    const plotTree = rebuildPlotTreeDeterministic({
      writingLanguage: 'zh-CN',
      sourceRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      synopsis: { content: '小说总纲' },
      snapshot: null,
      blueprints: allBlueprints,
      finalizedChapters: [],
      narrativeThreads: [],
    })
    expect(plotTree.tracks).toHaveLength(1)
    expect(plotTree.tracks[0].id).toBe('track-main')
    expect(plotTree.tracks[0].title).toBe('主线')
    expect(plotTree.tracks[0].events).toHaveLength(58)
    expect(plotTree.tracks[0].events[0].chapterNumber).toBe(1)
    expect(plotTree.tracks[0].events[57].chapterNumber).toBe(58)
  })

  it('stores world map nodes and queries candidates from worldbuilding text without model hallucination', () => {
    // Insert a node with spatial coordinates and rules
    const node = WorldMapRepository.upsertNode({
      id: 'node-astral-01',
      name: '星界裂隙',
      type: 'route_node',
      description: '连接表世界与星界的空间不稳定褶皱点。',
      parentId: null,
      mapLayer: 'astral',
      x: 350.5,
      y: 420.0,
      sourceRefs: ['worldbuilding.md#astral'],
    })
    expect(node.id).toBe('node-astral-01')

    const all = WorldMapRepository.getAll()
    expect(all.nodes).toHaveLength(1)
    expect(all.nodes[0].name).toBe('星界裂隙')
    expect(all.nodes[0].mapLayer).toBe('astral')

    // Candidate extraction parses keywords deterministically from worldbuilding
    ProjectCoreRepository.init('测试小说')
    ProjectCoreRepository.update({
      worldbuilding: `
# 核心地理概貌
## 白银之城
帝国北方最大的要塞城市。
## 灰质深渊
极度危险的遗境区域，充斥着失落文明的遗迹。
      `,
    })

    const candidates = WorldMapRepository.extractCandidates()
    expect(candidates.length).toBeGreaterThanOrEqual(2)
    const names = candidates.map(c => c.name)
    expect(names).toContain('白银之城')
    expect(names).toContain('灰质深渊')
    const relic = candidates.find(c => c.name === '灰质深渊')
    expect(relic?.type).toBe('relic')
  })

  it('maintains read-only consistency review without altering drafts or blueprints', () => {
    const draftText = '正文原稿内容，绝不容许任何自动化覆写。'
    const draftId = DraftRepository.create({
      chapterNumber: 5,
      source: 'write',
      content: draftText,
      wordCount: draftText.length,
    })

    const originalFull = DraftRepository.getFull(draftId)
    expect(originalFull?.content).toBe(draftText)

    // Model only outputs read-only review analysis
    const reviewContent = JSON.stringify({
      summary: '本章检测到 1 处蓝图未兑现与 1 处设定冲突。',
      items: [
        {
          category: '蓝图未兑现',
          severity: 'warning',
          description: '蓝图规划的关键事件「取得解药」未在正文中发生。',
          quote: '',
        },
        {
          category: '设定/地图/状态冲突',
          severity: 'error',
          description: '主角在未携带防护符的情况下直接进入了星界裂隙。',
          quote: '主角直接踏入了星界裂隙',
        },
      ],
    })

    const reviewRes = ReviewRepository.create({
      baseDraftId: draftId,
      content: reviewContent,
      expectedSource: {
        id: draftId,
        chapterNumber: 5,
        version: originalFull?.version ?? 1,
        status: (originalFull?.status as 'draft' | 'finalized') ?? 'draft',
        content: draftText,
      },
    })
    expect(reviewRes.id).toBeGreaterThan(0)

    const fullReview = ReviewRepository.getFull(reviewRes.id)
    expect(fullReview).not.toBeNull()
    expect(fullReview?.content).toContain('蓝图未兑现')
    expect(fullReview?.content).toContain('设定/地图/状态冲突')

    // Confirm that the original draft content is 100% intact and untouched
    const currentDraftContent = DraftRepository.getFull(draftId)?.content
    expect(currentDraftContent).toBe(draftText)
  })
})
