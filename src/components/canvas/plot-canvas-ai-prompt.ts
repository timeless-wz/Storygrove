import type { DatabaseChannels, ProjectData } from '../../shared/ipc-channels'
import type { ChapterBlueprintV2Summary } from '../../shared/blueprint-v2'
import type { PlotCanvasGraph } from '../../shared/plot-canvas'
import type { PlotCanvasAIMode } from './plot-canvas-ai-proposal'

type Blueprint = DatabaseChannels['db:blueprint-list-summary']['return'][number]

export interface PlotCanvasBlueprintSummary {
  chapterNumber: number
  title: string
  purpose: string
  keyEvents: string
  suspenseHook: string
}

/** 将旧简纲与 v2 场景标题投影为有界的跨章节摘要。 */
export function projectPlotCanvasBlueprintSummaries(
  legacyRows: readonly Blueprint[],
  v2Summaries: readonly ChapterBlueprintV2Summary[],
): PlotCanvasBlueprintSummary[] {
  const byChapter = new Map(v2Summaries.map(summary => [summary.chapterNumber, summary]))
  const seen = new Set<number>()
  const rows = legacyRows.map(row => {
    seen.add(row.chapterNumber)
    const v2 = byChapter.get(row.chapterNumber)
    return {
      chapterNumber: row.chapterNumber,
      title: String(row.title ?? '').slice(0, 160),
      purpose: String(row.purpose ?? '').slice(0, 300),
      keyEvents: String(row.keyEvents || (v2?.sceneTitles ?? []).join('\n')).slice(0, 700),
      suspenseHook: String(('suspenseHook' in row ? row.suspenseHook : '') ?? '').slice(0, 320),
    }
  })
  for (const summary of v2Summaries) {
    if (seen.has(summary.chapterNumber)) continue
    rows.push({
      chapterNumber: summary.chapterNumber,
      title: `第${summary.chapterNumber}章`,
      purpose: '',
      keyEvents: summary.sceneTitles.slice(0, 8).join('\n').slice(0, 700),
      suspenseHook: '',
    })
  }
  return rows.sort((a, b) => a.chapterNumber - b.chapterNumber).slice(0, 40)
}

/** 只发送作者确认的规划摘要与当前画布，不读取正文或改变权威资料。 */
export function createPlotCanvasAIMessages(input: {
  mode: PlotCanvasAIMode
  instruction: string
  graph: PlotCanvasGraph
  project: ProjectData
  blueprints: PlotCanvasBlueprintSummary[]
  history: Array<{ instruction: string; explanation: string }>
}): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const { mode, instruction, graph, project, blueprints, history } = input
  const novel = project.novelConfig
  const context = {
    projectName: project.name,
    writingLanguage: novel.writingLanguage ?? 'zh-CN',
    coreOutline: String(novel.coreOutline ?? '').slice(0, 5000),
    worldSetting: String(novel.worldSetting ?? '').slice(0, 3000),
    globalGuidance: String(novel.globalGuidance ?? '').slice(0, 2000),
    blueprints: blueprints.slice(0, 40).map(item => ({
      chapterNumber: item.chapterNumber,
      title: String(item.title ?? '').slice(0, 160),
      purpose: String(item.purpose ?? '').slice(0, 300),
      keyEvents: String(item.keyEvents ?? '').slice(0, 700),
    })),
    canvas: {
      id: graph.canvas.id,
      name: graph.canvas.name,
      description: graph.canvas.description,
      nodes: graph.nodes.slice(0, 100).map(node => ({
        id: node.id, kind: node.kind ?? 'plot', title: node.title,
        summary: node.summary.slice(0, 500), tags: node.tags ?? [], chapterRefs: node.chapterRefs,
      })),
      edges: graph.edges.slice(0, 150).map(edge => ({
        id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId,
        label: edge.label, kind: edge.kind,
      })),
    },
    recentAppliedRequests: history.slice(-6),
  }
  const schema = `Return one JSON object only: {"explanation":"brief explanation in the project's writing language","operations":[...]}.
Allowed operations:
{"action":"add_node","key":"unique temporary key","title":"...","summary":"...","kind":"plot|idea|foreshadow|character|location|item|faction|skill|chapter|note","tags":["..."],"chapterRefs":[1]}
{"action":"update_node","id":"existing node id","title":"optional","summary":"optional","kind":"optional","tags":["optional"],"chapterRefs":[1]}
{"action":"delete_node","id":"existing node id"}
{"action":"add_edge","source":"existing node id or new temporary key","target":"existing node id or new temporary key","label":"...","kind":"main|aux"}
{"action":"update_edge","id":"existing edge id","label":"optional","kind":"main|aux"}
{"action":"delete_edge","id":"existing edge id"}.
Only cite chapter numbers present in blueprints. Never invent existing IDs, sources, settled facts, or links to authority records. Do not change manuscript, blueprints, finalized facts, or project settings. Keep 1–50 focused operations. Every added node must have a distinct key. Do not duplicate undirected edges. Present narrative suggestions as editable proposals, not established facts.`
  const modeRule = mode === 'initialize'
    ? 'Initialize or extend this author-editable canvas. Use only add_node and add_edge. Build a coherent sequence from the supplied outline and chapter plans; if source material is sparse, make the limits clear in the explanation.'
    : 'Respond to the author instruction by proposing minimal add/update/delete operations on existing canvas nodes and edges. Preserve all unrelated data and IDs.'
  return [
    { role: 'system', content: `You are a fiction plot canvas assistant. Follow the project's writing language. ${schema}\n${modeRule}` },
    { role: 'user', content: `${instruction.trim()}\n\nContext JSON:\n${JSON.stringify(context)}` },
  ]
}
