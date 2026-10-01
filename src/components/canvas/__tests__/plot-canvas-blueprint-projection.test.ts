import { describe, expect, it } from 'vitest'

import type { DatabaseChannels, ProjectData } from '../../../shared/ipc-channels'
import type { ChapterBlueprintV2Summary } from '../../../shared/blueprint-v2'
import type { PlotCanvasGraph } from '../../../shared/plot-canvas'
import { createPlotCanvasAIMessages, projectPlotCanvasBlueprintSummaries } from '../plot-canvas-ai-prompt'

type LegacyBlueprint = DatabaseChannels['db:blueprint-get-all']['return'][number]

function legacyBlueprint(chapterNumber: number): LegacyBlueprint {
  return {
    chapterNumber,
    volumeId: 'volume-1',
    title: '题'.repeat(200),
    role: '发展',
    purpose: '目'.repeat(500),
    keyEvents: '节'.repeat(1000),
    characters: ['许渡'],
    suspenseHook: '钩'.repeat(500),
    userGuidance: '',
    notes: '定稿记录不可进入规划摘要',
    notesUpdatedAt: '',
  }
}

function v2Summary(chapterNumber: number): ChapterBlueprintV2Summary {
  return {
    chapterNumber,
    revision: 2,
    contentHash: 'a'.repeat(64),
    origin: 'import',
    updatedAt: '2026-09-30T00:00:00.000Z',
    sceneCount: 4,
    sceneTitles: ['场景一：短标题', '场景二：另一个短标题'],
    wordBudget: 4200,
  }
}

describe('plot canvas blueprint projection', () => {
  it('bounds every v1 projection field and uses only v2 scene-title summaries', () => {
    const summary = projectPlotCanvasBlueprintSummaries(
      [legacyBlueprint(1)],
      [v2Summary(1), v2Summary(2)],
    )

    expect(summary).toHaveLength(2)
    expect(summary[0]?.title).toHaveLength(160)
    expect(summary[0]?.purpose).toHaveLength(300)
    expect(summary[0]?.keyEvents).toHaveLength(700)
    expect(summary[0]?.suspenseHook).toHaveLength(320)
    expect(summary[1]).toMatchObject({
      chapterNumber: 2,
      title: '第2章',
      keyEvents: '场景一：短标题\n场景二：另一个短标题',
    })
    expect(JSON.stringify(summary)).not.toContain('定稿记录不可进入规划摘要')
  })

  it('sends at most forty bounded chapter summaries and no outline body to the model', () => {
    const blueprints = projectPlotCanvasBlueprintSummaries(
      Array.from({ length: 45 }, (_, index) => legacyBlueprint(index + 1)),
      [],
    )
    const messages = createPlotCanvasAIMessages({
      mode: 'initialize',
      instruction: '按章节建立跨章线索',
      graph: {
        canvas: { id: 'plot-1', name: '测试', description: '', parentCanvasId: null, sortOrder: 0 },
        viewport: null,
        nodes: [],
        edges: [],
      } as PlotCanvasGraph,
      project: { name: '测试', novelConfig: { writingLanguage: 'zh-CN' } } as ProjectData,
      blueprints,
      history: [],
    })
    const prompt = messages[1]?.content ?? ''
    const context = JSON.parse(prompt.split('Context JSON:\n')[1] ?? '{}') as {
      blueprints: Array<{ title: string; purpose: string; keyEvents: string }>
    }

    expect(context.blueprints).toHaveLength(40)
    expect(context.blueprints.every(item => item.title.length <= 160
      && item.purpose.length <= 300 && item.keyEvents.length <= 700)).toBe(true)
    expect(prompt).not.toContain('定稿记录不可进入规划摘要')
  })
})
