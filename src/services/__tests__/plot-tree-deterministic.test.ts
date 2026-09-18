import { describe, expect, it } from 'vitest'
import { rebuildPlotTreeDeterministic, extractBlueprintOutlineSummary } from '../plot-tree-deterministic'
import type { PlotTreeSourceBundle } from '../../shared/plot-tree'

describe('rebuildPlotTreeDeterministic', () => {
  it('deterministically rebuilds chapters 1 to 58 into neutral 主线 without volume hardcoding', () => {
    // Generate 58 mock blueprints matching 《未竟之书》
    const blueprints = Array.from({ length: 58 }, (_, i) => ({
      chapterNumber: i + 1,
      title: `第 ${i + 1} 章标题`,
      purpose: `第 ${i + 1} 章的核心剧情目的`,
      keyEvents: `第 ${i + 1} 章发生的关键事件`,
      userGuidance: i === 1 ? '## 本章大纲摘要\n主角在藏书阁偶遇神秘碎片并解开初层封印' : '',
    }))

    const sources: PlotTreeSourceBundle = {
      writingLanguage: 'zh-CN',
      synopsis: { content: '小说总纲' },
      blueprints,
      finalizedChapters: [
        {
          draftId: 101,
          chapterNumber: 1,
          title: '序章·初醒',
          summary: '主角在白银城醒来',
        },
      ],
      narrativeThreads: [
        {
          id: 1,
          title: '暗线：失落的密钥',
          type: 'sub_plot',
          targetStartChapter: 5,
          targetEndChapter: 20,
          authorIntent: '主角寻找第一把钥匙',
          status: 'progressing',
          events: [
            {
              id: 10,
              chapterNumber: 5,
              type: 'planted',
              evidence: '在藏书阁偶遇神秘碎片',
              reason: '埋下钥匙伏笔',
            },
          ],
        },
      ],
      sourceRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      snapshot: null,
    }

    const snapshot = rebuildPlotTreeDeterministic(sources)

    expect(snapshot.version).toBe(1)
    expect(snapshot.writingLanguage).toBe('zh-CN')
    expect(snapshot.tracks).toHaveLength(2)

    // Main track: neutral '主线'
    const mainTrack = snapshot.tracks[0]
    expect(mainTrack.id).toBe('track-main')
    expect(mainTrack.title).toBe('主线')
    expect(mainTrack.role).toBe('main')
    expect(mainTrack.startChapter).toBe(1)
    expect(mainTrack.endChapter).toBe(58)
    expect(mainTrack.events).toHaveLength(58)

    // Chapter 1 is finalized -> occurred
    const ch1Event = mainTrack.events.find(e => e.chapterNumber === 1)!
    expect(ch1Event.status).toBe('occurred')
    expect(ch1Event.sources).toEqual([
      { type: 'finalized-chapter', draftId: 101, chapterNumber: 1 },
    ])

    // Chapter 2 is blueprint -> planned, and uses userGuidance outline summary
    const ch2Event = mainTrack.events.find(e => e.chapterNumber === 2)!
    expect(ch2Event.status).toBe('planned')
    expect(ch2Event.summary).toContain('主角在藏书阁偶遇神秘碎片并解开初层封印')
    expect(ch2Event.sources).toEqual([
      { type: 'blueprint', chapterNumber: 2 },
    ])

    // Subplot track points to neutral track-main
    const subplotTrack = snapshot.tracks[1]
    expect(subplotTrack.title).toBe('暗线：失落的密钥')
    expect(subplotTrack.role).toBe('subplot')
    expect(subplotTrack.parentTrackId).toBe('track-main')
    expect(subplotTrack.startChapter).toBe(5)
    expect(subplotTrack.endChapter).toBe(20)
    expect(subplotTrack.events).toHaveLength(1)
    expect(subplotTrack.events[0].status).toBe('occurred')
  })

  it('splits tracks dynamically when multiple volumes are detected', () => {
    const blueprints = [
      {
        chapterNumber: 1,
        title: '第一卷 启程',
        purpose: '第一卷序章',
        keyEvents: '获得初印',
        volumeNumber: 1,
        volumeTitle: '第一卷',
      },
      {
        chapterNumber: 2,
        title: '第一卷 探秘',
        purpose: '第一卷深入',
        keyEvents: '深入迷宫',
        volumeNumber: 1,
        volumeTitle: '第一卷',
      },
      {
        chapterNumber: 3,
        title: '第二卷 破局',
        purpose: '第二卷转折',
        keyEvents: '跨越界限',
        volumeNumber: 2,
        volumeTitle: '第二卷',
      },
      {
        chapterNumber: 4,
        title: '第二卷 决战',
        purpose: '第二卷高潮',
        keyEvents: '终极对决',
        volumeNumber: 2,
        volumeTitle: '第二卷',
      },
    ]

    const sources: PlotTreeSourceBundle = {
      writingLanguage: 'zh-CN',
      synopsis: { content: '两卷宏大篇章' },
      blueprints,
      finalizedChapters: [],
      narrativeThreads: [
        {
          id: 1,
          title: '支线：远古盟约',
          type: 'sub_plot',
          targetStartChapter: 3,
          targetEndChapter: 4,
          authorIntent: '远古盟约解封',
          status: 'progressing',
          events: [],
        },
      ],
      sourceRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      snapshot: null,
    }

    const snapshot = rebuildPlotTreeDeterministic(sources)
    // 2 main tracks (Vol 1, Vol 2) + 1 subplot track
    expect(snapshot.tracks).toHaveLength(3)

    const vol1Track = snapshot.tracks[0]
    expect(vol1Track.id).toBe('track-main-vol1')
    expect(vol1Track.title).toBe('第一卷主线')
    expect(vol1Track.startChapter).toBe(1)
    expect(vol1Track.endChapter).toBe(2)
    expect(vol1Track.events).toHaveLength(2)

    const vol2Track = snapshot.tracks[1]
    expect(vol2Track.id).toBe('track-main-vol2')
    expect(vol2Track.title).toBe('第二卷主线')
    expect(vol2Track.startChapter).toBe(3)
    expect(vol2Track.endChapter).toBe(4)
    expect(vol2Track.events).toHaveLength(2)

    // Subplot starting at chapter 3 belongs to vol2
    const subplotTrack = snapshot.tracks[2]
    expect(subplotTrack.parentTrackId).toBe('track-main-vol2')
  })

  it('prioritizes userGuidance outline summary over purpose/keyEvents', () => {
    const summaryFromGuidance = extractBlueprintOutlineSummary({
      title: '第 10 章',
      purpose: '交代世界观设定',
      keyEvents: '发生了一场普通对话',
      userGuidance: '### 核心大纲\n主角在黑市识破了暗杀者的伪装并获得关键地图\n次要提示：注意暗色调氛围',
    })
    expect(summaryFromGuidance).toBe('主角在黑市识破了暗杀者的伪装并获得关键地图')

    const summaryFallback = extractBlueprintOutlineSummary({
      title: '第 11 章',
      purpose: '交代阵营分歧',
      keyEvents: '两派长老激辩',
    })
    expect(summaryFallback).toBe('交代阵营分歧')
  })

  it('throws helpful error when no blueprints or sources exist', () => {
    const emptySources: PlotTreeSourceBundle = {
      writingLanguage: 'zh-CN',
      synopsis: { content: '' },
      blueprints: [],
      finalizedChapters: [],
      narrativeThreads: [],
      sourceRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      snapshot: null,
    }

    expect(() => rebuildPlotTreeDeterministic(emptySources)).toThrow(/未找到章节蓝图或定稿事实/u)
  })
})
