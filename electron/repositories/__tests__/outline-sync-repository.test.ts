/**
 * 正文反向修纲仓库测试 — 临时项目库（knowledge-action-outline-sync-contract §5）。
 * 覆盖验收矩阵 7/9/10/11/12：无绑定不读写、逐项接受只改目标条目、
 * 版本变化阻止提交但保留候选、重复提交不双写、notes/userGuidance/正文零变化。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../database'
import { OutlineSyncRepository } from '../outline-sync-repository'
import { BlueprintRepository } from '../blueprint-repository'
import { BlueprintDetailRepository } from '../blueprint-detail-repository'
import { DraftRepository } from '../draft-repository'
import { KnowledgeGapRepository } from '../knowledge-gap-repository'
import { buildBlueprintV2MigrationContent, findBlueprintV2CanonicalSection } from '../../../src/shared/blueprint-v2'
import { computeProseContentHash } from '../../../src/shared/prose-anchor'
import type { ChapterBlueprintV2Content } from '../../../src/shared/blueprint-v2'
import type { OutlineSyncPatchItem } from '../../../src/shared/outline-sync'

const testRoot = path.resolve('.runtime/.cache/outline-sync-repository-tests')

let projectRoot = ''
const PROSE = '周晓在冷汗中醒来。许渡递来一枚铜钥匙。\n末班车缓缓驶出站台。\n'

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
})

function seedChapter(chapterNumber: number): ChapterBlueprintV2Content {
  BlueprintRepository.upsert({
    chapterNumber,
    title: `第${chapterNumber}章标题`,
    role: '发展',
    purpose: '初始目的',
    keyEvents: '初始事件',
    characters: ['周晓'],
    suspenseHook: '初始钩子',
    userGuidance: '作者的微操指导，永不被同步改写',
    notes: '定稿要点，永不被同步改写',
    notesUpdatedAt: '',
  })
  const content = buildBlueprintV2MigrationContent({
    chapterNumber,
    title: `第${chapterNumber}章标题`,
    purpose: '初始目的',
    keyEvents: '初始事件',
    suspenseHook: '初始钩子',
  }, { origin: 'manual' })
  const storyboard = findBlueprintV2CanonicalSection(content, 'storyboard')!
  storyboard.items = [
    { kind: 'scene', id: `bps-ch${chapterNumber}-s1`, level: 5, title: '场景一：惊醒', markdown: '周晓在冷汗中惊醒。\n', presence: 'off-canvas' },
    { kind: 'scene', id: `bps-ch${chapterNumber}-s2`, level: 5, title: '场景二：钥匙', markdown: '许渡出示物证。\n', presence: 'off-canvas' },
  ]
  const save = BlueprintDetailRepository.save({ chapterNumber, baseRevision: 0, content })
  expect(save.success).toBe(true)
  return content
}

function seedBoundDraft(chapterNumber: number, content: string): number {
  const id = DraftRepository.create({
    chapterNumber,
    blueprintChapterNumber: chapterNumber,
    source: 'write',
    content,
    wordCount: content.length,
  })
  return id
}

function sceneItem(itemId: string, before: string, after: string, afterTitle?: string): OutlineSyncPatchItem {
  return {
    id: itemId,
    changeKind: 'scene-content',
    explanation: '正文以铜钥匙替代了口头质问',
    proseEvidence: '许渡递来一枚铜钥匙',
    op: { kind: 'replace-item', sectionId: 'storyboard', itemId: 'bps-ch1-s2', beforeMarkdown: before, afterMarkdown: after, ...(afterTitle ? { afterTitle } : {}) },
    status: 'pending',
  }
}

describe('OutlineSyncRepository', () => {
  it('未绑定蓝图的草稿不创建候选（不按章号猜蓝图）', () => {
    seedChapter(1)
    const draftId = DraftRepository.create({ chapterNumber: 1, source: 'write', content: PROSE, wordCount: 1 })
    const result = OutlineSyncRepository.createCandidate({
      chapterNumber: 1,
      draftId,
      unfinishedDraft: false,
      items: [],
      noSubstantiveChange: true,
      summaryNote: '',
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/未绑定/)
  })

  it('提交成功：只改目标 v2 条目；notes/userGuidance/正文零变化；投影与审计更新', () => {
    seedChapter(1)
    const draftId = seedBoundDraft(1, PROSE)
    const detail = BlueprintDetailRepository.get(1)!
    const scene2 = findBlueprintV2CanonicalSection(detail as ChapterBlueprintV2Content, 'storyboard')!
      .items.find(entry => entry.id === 'bps-ch1-s2')!
    const candidate = OutlineSyncRepository.createCandidate({
      chapterNumber: 1,
      draftId,
      unfinishedDraft: false,
      items: [sceneItem('osi-1', scene2.markdown, '许渡递来一枚铜钥匙，周晓没有接。\n', '场景二：铜钥匙')],
      noSubstantiveChange: false,
      summaryNote: '正文调整了第二场的道具与钩子',
    })
    expect(candidate.success).toBe(true)
    expect(candidate.rejectedItems).toHaveLength(0)

    const committed = OutlineSyncRepository.commitCandidate({ candidateId: candidate.candidate!.id, acceptedItemIds: ['osi-1'] })
    expect(committed.success).toBe(true)
    expect(committed.needsRecompare).toBeFalsy()
    expect(committed.revision).toBe(2)

    const updated = BlueprintDetailRepository.get(1)!
    const storyboard = findBlueprintV2CanonicalSection(updated as ChapterBlueprintV2Content, 'storyboard')!
    const updatedScene2 = storyboard.items.find(entry => entry.id === 'bps-ch1-s2')!
    expect(updatedScene2.kind === 'scene' && updatedScene2.title).toBe('场景二：铜钥匙')
    expect(updatedScene2.markdown).toBe('许渡递来一枚铜钥匙，周晓没有接。\n')
    // 场景一未在补丁中 → 原文保真。
    const scene1 = storyboard.items.find(entry => entry.id === 'bps-ch1-s1')!
    expect(scene1.markdown).toBe('周晓在冷汗中惊醒。\n')
    // 投影：keyEvents = 分镜标题（含改后的标题）。
    const v1 = BlueprintRepository.getByChapter(1)!
    expect(v1.keyEvents.split('\n')).toContain('场景二：铜钥匙')
    // notes 与 userGuidance 永不被同步流程触碰。
    expect(v1.notes).toBe('定稿要点，永不被同步改写')
    expect(v1.userGuidance).toBe('作者的微操指导，永不被同步改写')
    // 正文零变化（同步不逆向改正文）。
    expect(DraftRepository.getFull(draftId)!.content).toBe(PROSE)
    // 候选状态与审计行。
    expect(OutlineSyncRepository.getCandidate(candidate.candidate!.id)!.status).toBe('committed')
    const commits = OutlineSyncRepository.listCommits(1)
    expect(commits).toHaveLength(1)
    expect(commits[0]!.acceptedItemIds).toEqual(['osi-1'])
    expect(commits[0]!.blueprintRevisionAfter).toBe(2)
  })

  it('蓝图在候选创建后被修改 → 阻止提交，候选保留', () => {
    seedChapter(1)
    const draftId = seedBoundDraft(1, PROSE)
    const detail = BlueprintDetailRepository.get(1)!
    const scene2 = findBlueprintV2CanonicalSection(detail as ChapterBlueprintV2Content, 'storyboard')!
      .items.find(entry => entry.id === 'bps-ch1-s2')!
    const candidate = OutlineSyncRepository.createCandidate({
      chapterNumber: 1, draftId, unfinishedDraft: false,
      items: [sceneItem('osi-1', scene2.markdown, '新版本\n')],
      noSubstantiveChange: false, summaryNote: '',
    })
    // 另一个窗口又保存了一次细纲 → revision 前进。
    const current = BlueprintDetailRepository.get(1)!
    BlueprintDetailRepository.save({ chapterNumber: 1, baseRevision: current.revision, content: current as ChapterBlueprintV2Content })
    const blocked = OutlineSyncRepository.commitCandidate({ candidateId: candidate.candidate!.id, acceptedItemIds: ['osi-1'] })
    expect(blocked.success).toBe(false)
    expect(blocked.needsRecompare).toBe(true)
    expect(OutlineSyncRepository.getCandidate(candidate.candidate!.id)!.status).toBe('pending')
  })

  it('正文在候选创建后又修改 → 阻止提交；重复提交同一候选幂等', () => {
    seedChapter(1)
    const draftId = seedBoundDraft(1, PROSE)
    const candidate = OutlineSyncRepository.createCandidate({
      chapterNumber: 1, draftId, unfinishedDraft: false,
      items: [], noSubstantiveChange: true, summaryNote: '无变化',
    })
    expect(candidate.success).toBe(true)
    // 提交一次成功。
    const first = OutlineSyncRepository.commitCandidate({ candidateId: candidate.candidate!.id, acceptedItemIds: [] })
    expect(first.success).toBe(true)
    // 重复提交 → 幂等返回已提交，不产生第二个审计行。
    const second = OutlineSyncRepository.commitCandidate({ candidateId: candidate.candidate!.id, acceptedItemIds: [] })
    expect(second.alreadyCommitted).toBe(true)
    expect(OutlineSyncRepository.listCommits(1)).toHaveLength(1)

    // 新候选 + 正文变化 → needsRecompare，候选保留。
    const candidate2 = OutlineSyncRepository.createCandidate({
      chapterNumber: 1, draftId, unfinishedDraft: false,
      items: [], noSubstantiveChange: true, summaryNote: '',
    })
    DraftRepository.updateContent(draftId, '正文又被作者改动了。', 1)
    const blocked = OutlineSyncRepository.commitCandidate({ candidateId: candidate2.candidate!.id, acceptedItemIds: [] })
    expect(blocked.needsRecompare).toBe(true)
    expect(blocked.reason).toMatch(/正文/)
    expect(OutlineSyncRepository.getCandidate(candidate2.candidate!.id)!.status).toBe('pending')
  })

  it('条目引用不存在的细纲条目或快照过期 → 创建时拒收', () => {
    seedChapter(1)
    const draftId = seedBoundDraft(1, PROSE)
    const result = OutlineSyncRepository.createCandidate({
      chapterNumber: 1, draftId, unfinishedDraft: false,
      items: [
        sceneItem('osi-ghost', '周晓在冷汗中惊醒。\n', 'x'),
        { ...sceneItem('osi-stale', '过期的原文快照', 'y'), op: { kind: 'replace-item', sectionId: 'storyboard', itemId: 'bps-ch1-s2', beforeMarkdown: '过期快照', afterMarkdown: 'y' } },
      ],
      noSubstantiveChange: false, summaryNote: '',
    })
    expect(result.success).toBe(true)
    expect(result.rejectedItems).toHaveLength(2)
    expect(result.candidate!.items).toHaveLength(0)
  })

  it('affected 预览：正文锚点失效的知情记录被标为需重新定位；原引用保留', () => {
    seedChapter(1)
    const draftId = seedBoundDraft(1, PROSE)
    const entry = KnowledgeGapRepository.saveInfoEntry({
      title: '铜钥匙的来历', summary: '', truth: '钥匙来自许渡的父亲', truthStatus: 'confirmed',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    KnowledgeGapRepository.saveKnowledgeRecord({
      infoId: entry.id!,
      subjectKind: 'character',
      characterId: 'ch-1',
      knownContent: '许渡有一枚铜钥匙',
      cognition: 'heard',
      believedStatement: '',
      truthRelation: 'undetermined',
      learningChannel: '亲历',
      channelSourceNote: '',
      storyPosition: { kind: 'unplaced' },
      narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 },
      concealment: null,
      basis: 'prose',
      proseAnchor: {
        draftId,
        version: DraftRepository.getMeta(draftId)!.version,
        status: 'draft',
        contentHash: computeProseContentHash(PROSE),
        excerpt: '许渡递来一枚铜钥匙',
      },
      reader: null,
    })
    // 正文改动前：锚点完好。
    const before = OutlineSyncRepository.affectedPreview(1)
    expect(before.staleProseAnchorRecordIds).toHaveLength(0)
    // 正文改动后：锚点失效可见，但记录本体未被改写。
    DraftRepository.updateContent(draftId, '完全不同的新正文。', 1)
    const after = OutlineSyncRepository.affectedPreview(1)
    expect(after.staleProseAnchorRecordIds).toHaveLength(1)
    const record = KnowledgeGapRepository.listKnowledgeRecords({ characterId: 'ch-1' })[0]!
    expect(record.proseAnchor!.excerpt).toBe('许渡递来一枚铜钥匙')
  })
})
