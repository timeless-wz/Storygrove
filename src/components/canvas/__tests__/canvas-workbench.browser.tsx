import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import {
  chapterCanvasId,
  type ChapterCanvasEdgeData,
  type ChapterCanvasNodeData,
} from '../../../shared/chapter-canvas'
import {
  createPlotCanvasNodeId,
  type PlotCanvasEdgeData,
  type PlotCanvasGraph,
  type PlotCanvasNodeData,
  type PlotCanvasSummary,
} from '../../../shared/plot-canvas'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import PlotCanvasWorkbench from '../PlotCanvasWorkbench'
import ChapterCanvasWorkbench from '../ChapterCanvasWorkbench'

const PROJECT_PATH = 'C:\\novels\\canvas-workbench'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ===== 可变 fixture 存储：模拟项目数据库，跨重挂载保持 ===== */

interface FixtureDb {
  canvases: PlotCanvasSummary[]
  graphs: Map<string, { nodes: PlotCanvasNodeData[]; edges: PlotCanvasEdgeData[] }>
  chapterNodes: ChapterCanvasNodeData[]
  chapterEdges: ChapterCanvasEdgeData[]
  failChannel: string | null
}

let db: FixtureDb
let invoke: ReturnType<typeof vi.fn>
let container: HTMLDivElement | undefined
let root: Root | undefined
const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()

function freshDb(): FixtureDb {
  return { canvases: [], graphs: new Map(), chapterNodes: [], chapterEdges: [], failChannel: null }
}

function installIpc() {
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (db.failChannel === channel) throw new Error(`模拟保存失败：${channel}`)
    const expectedProjectPath = args.at(-2)
    void expectedProjectPath
    switch (channel) {
      case 'db:plot-canvas-list':
        return [...db.canvases].sort((a, b) => a.sortOrder - b.sortOrder)
      case 'db:plot-canvas-create': {
        const [name, parentCanvasId] = args as [string, string | null]
        const canvas: PlotCanvasSummary = {
          id: `pca-${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000`,
          name,
          description: '',
          parentCanvasId,
          sortOrder: db.canvases.length + 1,
        }
        db.canvases.push(canvas)
        db.graphs.set(canvas.id, { nodes: [], edges: [] })
        return { success: true, canvas }
      }
      case 'db:plot-canvas-rename': {
        const [canvasId, name] = args as [string, string]
        const canvas = db.canvases.find(item => item.id === canvasId)
        if (!canvas) return { success: false, error: '画布不存在' }
        canvas.name = name
        return { success: true, canvas }
      }
      case 'db:plot-canvas-update': {
        const [input] = args as [{ canvasId: string; name?: string; description?: string }]
        const canvas = db.canvases.find(item => item.id === input.canvasId)
        if (!canvas) return { success: false, error: '画布不存在' }
        if (input.name !== undefined) canvas.name = input.name
        if (input.description !== undefined) canvas.description = input.description
        return { success: true, canvas }
      }
      case 'db:plot-canvas-delete': {
        const [canvasId] = args as [string]
        db.canvases = db.canvases.filter(canvas => canvas.id !== canvasId)
        db.graphs.delete(canvasId)
        return { success: true, removedCanvasIds: [canvasId] }
      }
      case 'db:plot-canvas-graph-get': {
        const [canvasId] = args as [string]
        const canvas = db.canvases.find(item => item.id === canvasId)
        if (!canvas) throw new Error('剧情画布不存在')
        const graph = db.graphs.get(canvasId) ?? { nodes: [], edges: [] }
        // IPC returns a structured clone; keep fixture mutations from changing React state by reference.
        const result: PlotCanvasGraph = { canvas: { ...canvas }, viewport: null, nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) }
        return result
      }
      case 'db:plot-canvas-node-upsert': {
        const input = args[0] as PlotCanvasNodeData & { canvasId: string }
        const graph = db.graphs.get(input.canvasId) ?? { nodes: [], edges: [] }
        const existing = graph.nodes.find(node => node.id === input.id)
        if (existing) Object.assign(existing, input)
        else graph.nodes.push({ ...input })
        db.graphs.set(input.canvasId, graph)
        return { success: true, node: input }
      }
      case 'db:plot-canvas-node-delete': {
        const [canvasId, nodeId] = args as [string, string]
        const graph = db.graphs.get(canvasId)
        if (graph) {
          graph.nodes = graph.nodes.filter(node => node.id !== nodeId)
          graph.edges = graph.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
        }
        return { success: true }
      }
      case 'db:plot-canvas-nodes-reposition': {
        const [canvasId, positions] = args as [string, Array<{ nodeId: string; x: number; y: number }>]
        const graph = db.graphs.get(canvasId)
        if (graph) {
          for (const position of positions) {
            const node = graph.nodes.find(item => item.id === position.nodeId)
            if (node) { node.x = position.x; node.y = position.y }
          }
        }
        return { success: true }
      }
      case 'db:plot-canvas-edge-upsert': {
        const input = args[0] as PlotCanvasEdgeData
        const graph = db.graphs.get(input.canvasId)
        if (graph) {
          const existing = graph.edges.find(edge => edge.id === input.id)
          if (existing) Object.assign(existing, input)
          else graph.edges.push({ ...input })
          db.graphs.set(input.canvasId, graph)
        }
        return { success: true, edge: input }
      }
      case 'db:plot-canvas-edge-delete': {
        const [canvasId, edgeId] = args as [string, string]
        const graph = db.graphs.get(canvasId)
        if (graph) graph.edges = graph.edges.filter(edge => edge.id !== edgeId)
        return { success: true }
      }
      case 'db:plot-canvas-nodes-merge': {
        const input = args[0] as { canvasId: string; sourceNodeIds: string[]; title: string; summary: string }
        const graph = db.graphs.get(input.canvasId)
        if (!graph) return { success: false, error: '画布不存在' }
        const sources = graph.nodes.filter(node => input.sourceNodeIds.includes(node.id))
        if (sources.length < 2) return { success: false, error: '合并至少需要两个剧情事件' }
        const chapterRefs = [...new Set(sources.flatMap(node => node.chapterRefs))].sort((a, b) => a - b)
        const merged: PlotCanvasNodeData = {
          ...sources[0],
          id: createPlotCanvasNodeId(),
          title: input.title,
          summary: input.summary,
          chapterRefs,
        }
        graph.nodes = graph.nodes.filter(node => !input.sourceNodeIds.includes(node.id))
        graph.nodes.push(merged)
        graph.edges = graph.edges
          .filter(edge => !(input.sourceNodeIds.includes(edge.sourceNodeId) && input.sourceNodeIds.includes(edge.targetNodeId)))
          .map(edge => ({
            ...edge,
            sourceNodeId: input.sourceNodeIds.includes(edge.sourceNodeId) ? merged.id : edge.sourceNodeId,
            targetNodeId: input.sourceNodeIds.includes(edge.targetNodeId) ? merged.id : edge.targetNodeId,
          }))
        return { success: true, node: merged }
      }
      case 'db:blueprint-get-all':
        return [{
          chapterNumber: 2, title: '刻痕之谜', role: '发展', purpose: '', keyEvents: '',
          characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '',
        }]
      case 'db:blueprint-list-summary':
        return [{ chapterNumber: 2, title: '刻痕之谜', purpose: '', keyEvents: '' }]
      case 'db:draft-list-all':
        return [{ id: 7, chapterNumber: 2, version: 1, status: 'finalized', source: 'write', contentId: 1, wordCount: 8, createdAt: '', updatedAt: '' }]
      case 'db:narrative-thread-list':
        return [{ id: 11, title: '刻痕线索', type: 'mystery', targetStartChapter: 1, targetEndChapter: 6, authorIntent: '', status: 'planned', dormantChapters: 0, overdue: false, events: [], createdAt: '', updatedAt: '' }]
      case 'db:plot-tree-read':
        return { writingLanguage: 'zh-CN', synopsis: { content: '' }, blueprints: [], finalizedChapters: [], narrativeThreads: [], sourceRevision: 'a'.repeat(64), snapshot: null }
      case 'db:chapter-canvas-get': {
        const [chapterNumber] = args as [number]
        return {
          canvas: db.chapterNodes.length > 0 || db.chapterEdges.length > 0
            ? { id: chapterCanvasId(chapterNumber), chapterNumber, viewport: null }
            : null,
          nodes: db.chapterNodes.filter(node => node.canvasId === chapterCanvasId(chapterNumber)),
          edges: db.chapterEdges.filter(edge => edge.canvasId === chapterCanvasId(chapterNumber)),
        }
      }
      case 'db:chapter-canvas-node-upsert': {
        const input = args[0] as ChapterCanvasNodeData & { chapterNumber: number }
        const node: ChapterCanvasNodeData = { ...input, canvasId: chapterCanvasId(input.chapterNumber) }
        const existing = db.chapterNodes.find(item => item.id === node.id)
        if (existing) Object.assign(existing, node)
        else db.chapterNodes.push(node)
        return { success: true, node }
      }
      case 'db:chapter-canvas-node-delete': {
        const [, nodeId] = args as [number, string]
        db.chapterNodes = db.chapterNodes.filter(node => node.id !== nodeId)
        db.chapterEdges = db.chapterEdges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
        return { success: true }
      }
      case 'db:chapter-canvas-edge-upsert': {
        const input = args[0] as ChapterCanvasEdgeData & { chapterNumber: number }
        const edge = { ...input, canvasId: chapterCanvasId(input.chapterNumber) }
        const existing = db.chapterEdges.find(item => item.id === edge.id)
        if (existing) Object.assign(existing, edge)
        else db.chapterEdges.push(edge)
        return { success: true, edge }
      }
      case 'db:chapter-canvas-nodes-reposition': {
        const [, positions] = args as [number, Array<{ nodeId: string; x: number; y: number }>]
        for (const position of positions) {
          const node = db.chapterNodes.find(item => item.id === position.nodeId)
          if (node) { node.x = position.x; node.y = position.y }
        }
        return { success: true }
      }
      case 'db:character-roster-read':
        return {
          schemaVersion: 1, revision: 1, migrationState: {}, status: 'ready',
          entries: [{ name: '林岚', role: 'protagonist', gender: '', age: '', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: [], arc: '', notes: '' }],
          renderedMarkdown: '', projectionHash: '', factHash: '',
        }
      case 'db:foreshadowing-list':
        return [{
          id: 'fs-1', draftId: 7, chapterNumber: 2, selectedText: '刻痕', startOffset: 0, endOffset: 2,
          contextBefore: '', contextAfter: '', note: '门上的刻痕是谁留的', markerType: 'foreshadowing', color: 'blue',
          completed: false, createdAt: '', updatedAt: '', completedAt: null,
        }]
      case 'db:chapter-canvas-viewport-save':
      case 'db:plot-canvas-viewport-save':
        return { success: true }
      case 'db:blueprint-v2-get':
        // 本章没有 v2 细纲：画布保持旧版手工场景卡行为。
        return null
      case 'db:blueprint-v2-summary-list':
        return []
      default:
        throw new Error(`unexpected IPC ${channel}`)
    }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
}

beforeEach(() => {
  db = freshDb()
  useLocaleStore.setState({ locale: 'zh-CN' })
  const project: ProjectData = {
    id: 'canvas-project', sessionLease: 'canvas-lease', name: '画布测试', path: PROJECT_PATH,
    novelConfig: { genre: '', subGenre: '', targetAudience: '', totalChapters: 10, wordsPerChapter: 2000, plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '' },
    characterStates: '', createdAt: '', updatedAt: '',
  }
  useProjectStore.setState({ currentProject: project, fileTree: [], loading: false })
  setActiveProjectSessionContext({ projectId: project.id, leaseId: project.sessionLease!, projectPath: PROJECT_PATH })
  installIpc()
  container = document.createElement('div')
  container.style.width = '1280px'
  container.style.height = '800px'
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => { root?.unmount() })
    root = undefined
  }
  container?.remove()
  container = undefined
  Reflect.deleteProperty(window, 'velaAPI')
  useProjectStore.setState(originalProjectState)
  useLocaleStore.setState(originalLocaleState)
  setActiveProjectSessionContext(null)
})

async function clickButton(matcher: (button: HTMLButtonElement) => boolean) {
  const button = await vi.waitFor(() => {
    // Radix Dialog / confirm() 渲染在 body 级 portal，因此全文档查找。
    const found = Array.from(document.body.querySelectorAll('button')).find(matcher)
    if (!found) throw new Error('button not found')
    return found
  })
  await act(async () => { button.click() })
}

function findButton(label: string): (button: HTMLButtonElement) => boolean {
  return button => button.textContent?.includes(label) ?? false
}

async function setInput(selector: string, value: string) {
  const element = await vi.waitFor(() => {
    const found = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
    if (!found) throw new Error(`input ${selector} not found`)
    return found
  })
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('PlotCanvasWorkbench', () => {
  it('新建画布 → 添加节点 → 编辑 → 删除确认，全程真实持久化并在重挂载后仍在', async () => {
    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container!.textContent).toContain('暂无剧情画布'))

    // 新建画布（对话框 → 输入标题 → 创建）。
    await clickButton(findButton('新增剧情画布'))
    await setInput('#plot-canvas-create-title', '第一卷主线')
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container!.textContent).toContain('第一卷主线'))
    expect(db.canvases).toHaveLength(1)

    // 添加两个剧情事件。
    await clickButton(findButton('新增剧情事件'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(1))
    await clickButton(findButton('新增剧情事件'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(2))
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('db:plot-canvas-node-upsert', expect.anything(), PROJECT_PATH, expect.anything()))

    // 连线模式：点起点、点终点，真实 edge-upsert 并保存。
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-connect-tool')
    await vi.waitFor(() => expect(container!.querySelector('[data-testid="plot-canvas-connect-hint"]')).toBeTruthy())
    const connectNodes = container!.querySelectorAll<HTMLElement>('.react-flow__node')
    await act(async () => { connectNodes[0].click() })
    await act(async () => { connectNodes[1].click() })
    await vi.waitFor(() => expect(db.graphs.get(db.canvases[0].id)?.edges).toHaveLength(1))
    await vi.waitFor(() => expect(container!.querySelectorAll('.react-flow__edge')).toHaveLength(1))
    expect(invoke).toHaveBeenCalledWith('db:plot-canvas-edge-upsert', expect.anything(), PROJECT_PATH, expect.anything())
    await clickButton(button => button.getAttribute('aria-label') === '框选/选择模式')

    // 编辑第一个节点的标题并保存。
    await setInput('#plot-node-title', '发现刻痕')
    await clickButton(findButton('保存修改'))
    await vi.waitFor(() => {
      const saved = db.graphs.get(db.canvases[0].id)?.nodes.find(node => node.title === '发现刻痕')
      expect(saved).toBeTruthy()
    })

    // 详情面板关联第 2 章（蓝图与定稿都存在 → 两个跳转按钮可用）。
    await vi.waitFor(() => expect(container!.textContent).toContain('关联章节'))
    const chapterChip = await vi.waitFor(() => {
      const found = Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.trim() === '第2章')
      if (!found) throw new Error('chapter chip not found')
      return found
    })
    await act(async () => { chapterChip.click() })
    await vi.waitFor(() => {
      const saved = db.graphs.get(db.canvases[0].id)?.nodes.find(node => node.title === '发现刻痕')
      expect(saved?.chapterRefs).toEqual([2])
    })
    await vi.waitFor(() => expect(container!.textContent).toContain('打开蓝图'))
    expect(Array.from(container!.querySelectorAll('button')).find(button => button.textContent?.includes('打开定稿'))?.disabled).toBe(false)
    // 第 1 章从未出现 → 无效关联显示明确状态（这里只有第 2 章可选）。

    // 新增第三个节点（详情自动切到它）并删除，验证删除确认与级联清理。
    await clickButton(findButton('新增剧情事件'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(3))
    await clickButton(findButton('删除节点'))
    await clickButton(button => button.textContent === '删除')
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(2))
    expect(db.graphs.get(db.canvases[0].id)?.nodes).toHaveLength(2)

    // 重挂载：改名节点与章节引用仍在（持久化而非组件状态）。
    await act(async () => { root?.unmount() })
    root = createRoot(container!)
    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => {
      expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(2)
      expect(container!.textContent).toContain('发现刻痕')
      const saved = db.graphs.get(db.canvases[0].id)?.nodes.find(node => node.title === '发现刻痕')
      expect(saved?.chapterRefs).toEqual([2])
      expect(db.graphs.get(db.canvases[0].id)?.edges).toHaveLength(1)
    })
  })

  it('保存失败时显示未保存横幅并可重试', async () => {
    db.failChannel = 'db:plot-canvas-node-upsert'
    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await clickButton(findButton('新增剧情画布'))
    await setInput('#plot-canvas-create-title', '失败演练')
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container!.textContent).toContain('失败演练'))

    await clickButton(findButton('新增剧情事件'))
    await vi.waitFor(() => expect(container!.querySelector('[data-testid="canvas-unsaved-banner"]')).toBeTruthy())
    expect(container!.textContent).toContain('未保存')

    // 恢复后重试成功，横幅消失。
    db.failChannel = null
    await clickButton(findButton('重试保存'))
    await vi.waitFor(() => expect(container!.querySelector('[data-testid="canvas-unsaved-banner"]')).toBeNull())
    expect(db.graphs.get(db.canvases[0].id)?.nodes).toHaveLength(1)
  })

  it('搜索命中高亮、未命中变暗（画布节点搜索在筛选条中）', async () => {
    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await clickButton(findButton('新增剧情画布'))
    await setInput('#plot-canvas-create-title', '搜索演练')
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container!.textContent).toContain('搜索演练'))
    await clickButton(findButton('新增剧情事件'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(1))

    // 顶栏搜索入口打开筛选条，节点搜索在其中。
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-topbar-search')
    await vi.waitFor(() => expect(container!.querySelector('.plot-graph-search-input')).toBeTruthy())
    await setInput('.plot-graph-search-input', '不存在的关键词')
    await vi.waitFor(() => {
      const node = container!.querySelector('[data-testid="plot-graph-card"]')
      expect(node?.className).toContain('is-dimmed')
    })
  })

  it('集成：描述持久化、entityRefs 展示、种类/标签编辑、筛选只改视图', async () => {
    // 直接种子：带描述的画布 + 两个节点（伏笔带实体引用）与一条连线。
    const canvas: PlotCanvasSummary = {
      id: 'pca-70000000-0000-4000-8000-000000000001',
      name: '集成演练',
      description: '铜牌与归墟之门',
      parentCanvasId: null,
      sortOrder: 1,
    }
    db.canvases.push(canvas)
    const foreshadowNode: PlotCanvasNodeData = {
      id: 'pcn-70000000-0000-4000-8000-000000000001',
      canvasId: canvas.id,
      kind: 'foreshadow',
      title: '潮纹铜牌',
      summary: '铜牌在灵气激荡时显出潮纹。',
      colorKey: 'default',
      tags: ['暗线'],
      entityRefs: [
        { entityType: 'foreshadowing', entityId: 'fs-missing' },
        { entityType: 'draft', entityId: 7 },
      ],
      chapterRefs: [2],
      planId: null,
      subCanvasId: null,
      x: 100,
      y: 120,
    }
    const plotNode: PlotCanvasNodeData = {
      id: 'pcn-70000000-0000-4000-8000-000000000002',
      canvasId: canvas.id,
      kind: 'plot',
      title: '渔村灭门',
      summary: '苏砚回到渔村，全家被灭。',
      colorKey: 'default',
      tags: [],
      entityRefs: [],
      chapterRefs: [1],
      planId: null,
      subCanvasId: null,
      x: 460,
      y: 120,
    }
    db.graphs.set(canvas.id, {
      nodes: [foreshadowNode, plotNode],
      edges: [{
        id: 'pce-70000000-0000-4000-8000-000000000001',
        canvasId: canvas.id,
        sourceNodeId: plotNode.id,
        targetNodeId: foreshadowNode.id,
        label: '埋下',
        kind: 'main',
      }],
    })

    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(2))
    // 左侧目录展示画布描述。
    await vi.waitFor(() => expect(container!.textContent).toContain('铜牌与归墟之门'))
    // 卡片按 kind 渲染种类徽章与标签。
    const foreshadowCard = container!.querySelector('[data-kind="foreshadow"]')
    expect(foreshadowCard?.textContent).toContain('伏笔')
    expect(foreshadowCard?.textContent).toContain('#暗线')

    // 点选伏笔节点 → 详情展示 entityRefs：悬挂引用标失效，draft 引用可打开。
    // d3-drag 读取 event.view，合成事件必须带 view: window。
    await act(async () => {
      ;(foreshadowCard as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }))
    })
    await act(async () => { (foreshadowCard as HTMLElement).click() })
    await vi.waitFor(() => expect(container!.querySelector('[data-testid="plot-canvas-detail"]')).toBeTruthy())
    await vi.waitFor(() => {
      expect(container!.textContent).toContain('关联实体')
      expect(container!.textContent).toContain('fs-missing')
      expect(container!.textContent).toContain('引用失效')
      expect(container!.textContent).toContain('正文草稿')
    })
    const openDraftButton = Array.from(container!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('打开正文'))
    expect(openDraftButton).toBeTruthy()
    expect(openDraftButton!.disabled).toBe(false)

    // 编辑标签与种类并保存 → 真实写库。
    await setInput('#plot-node-tags', '暗线, 铜牌')
    await clickButton(findButton('保存修改'))
    await vi.waitFor(() => {
      const saved = db.graphs.get(canvas.id)?.nodes.find(node => node.id === foreshadowNode.id)
      expect(saved?.tags).toEqual(['暗线', '铜牌'])
    })

    // 种类筛选只改视图：隐藏“剧情”种类后，该节点与相连连线从视图消失，库不变。
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-topbar-filters')
    await vi.waitFor(() => expect(container!.querySelector('.plot-graph-filter-trigger')).toBeTruthy())
    await act(async () => {
      (container!.querySelector('.plot-graph-filter-trigger') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => expect(container!.querySelector('.plot-graph-filter-chips-grid')).toBeTruthy())
    const plotChip = await vi.waitFor(() => {
      const found = Array.from(container!.querySelectorAll('.plot-graph-filter-chip'))
        .find(chip => chip.textContent?.startsWith('剧情'))
      if (!found) throw new Error('plot kind chip not found')
      return found
    })
    await act(async () => { (plotChip as HTMLElement).click() })
    // React Flow 不渲染 hidden 节点/连线：被筛掉的种类从画布 DOM 消失。
    await vi.waitFor(() => {
      expect(container!.querySelector('[data-kind="plot"]')).toBeNull()
      expect(container!.querySelector('[data-kind="foreshadow"]')).toBeTruthy()
      expect(container!.querySelector('.react-flow__edge')).toBeNull()
    })
    // 数据层不受筛选影响。
    expect(db.graphs.get(canvas.id)?.nodes).toHaveLength(2)
    expect(db.graphs.get(canvas.id)?.edges).toHaveLength(1)

    // 重置筛选 → 节点与连线即刻恢复。
    await clickButton(button => button.textContent === '重置')
    await vi.waitFor(() => {
      expect(container!.querySelector('[data-kind="plot"]')).toBeTruthy()
      expect(container!.querySelector('.react-flow__edge')).toBeTruthy()
    })
  })

  it('重命名与说明通过同一对话框保存，重开后仍存在', async () => {
    const canvas: PlotCanvasSummary = {
      id: 'pca-71000000-0000-4000-8000-000000000001',
      name: '旧名画布',
      description: '旧说明',
      parentCanvasId: null,
      sortOrder: 1,
    }
    db.canvases.push(canvas)
    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container!.textContent).toContain('旧名画布'))

    // 悬停操作：重命名（对话框预填标题与说明）。
    await clickButton(button => button.getAttribute('aria-label') === '重命名画布')
    await vi.waitFor(() => {
      const titleInput = document.body.querySelector<HTMLInputElement>('#plot-canvas-create-title')
      expect(titleInput?.value).toBe('旧名画布')
    })
    const descriptionInput = document.body.querySelector<HTMLTextAreaElement>('#plot-canvas-create-description')
    expect(descriptionInput?.value).toBe('旧说明')
    await setInput('#plot-canvas-create-title', '新名画布')
    await setInput('#plot-canvas-create-description', '新说明铜牌线')
    await clickButton(findButton('保存'))
    await vi.waitFor(() => {
      expect(db.canvases[0]?.name).toBe('新名画布')
      expect(db.canvases[0]?.description).toBe('新说明铜牌线')
    })

    // 重挂载读回：标题与描述都在。
    await act(async () => { root?.unmount() })
    root = createRoot(container!)
    await act(async () => { root?.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => {
      expect(container!.textContent).toContain('新名画布')
      expect(container!.textContent).toContain('新说明铜牌线')
    })
  })
})

describe('ChapterCanvasWorkbench', () => {
  it('新增两个场景与伏笔节点 → 持久化 → 重挂载仍在；正文入口走真实链路', async () => {
    const onOpenDraft = vi.fn()
    await act(async () => {
      root?.render(
        <ChapterCanvasWorkbench
          projectKey={PROJECT_PATH}
          chapterNumber={2}
          chapterTitle="刻痕之谜"
          canOpenDraft
          openDraftLabel="打开第2章正文"
          onOpenDraft={onOpenDraft}
        />,
      )
    })
    await vi.waitFor(() => expect(container!.textContent).toContain('第 2 章'))

    // 新增两个场景。
    await clickButton(findButton('新增场景'))
    await setInput('#chapter-create-title', '开场发现')
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(1))
    await clickButton(findButton('新增场景'))
    await setInput('#chapter-create-title', '系统激活')
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(2))
    expect(db.chapterNodes.filter(node => node.type === 'scene')).toHaveLength(2)
    expect(db.chapterNodes.filter(node => node.type === 'scene')[1]?.order).toBe(2)

    // 新增伏笔节点（引用 fixture 中唯一的伏笔记录）。
    await clickButton(findButton('伏笔'))
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-aux"]')).toHaveLength(1))
    expect(db.chapterNodes.find(node => node.type === 'foreshadow')?.refs.foreshadowingId).toBe('fs-1')

    // 主线 spine 由顺序自动生成，不出现在持久化边里。
    expect(db.chapterEdges).toHaveLength(0)
    expect(container!.querySelectorAll('canvas')).toBeTruthy()

    // 正文入口调用真实链路回调，而不是远程生成。
    await clickButton(findButton('打开第2章正文'))
    expect(onOpenDraft).toHaveBeenCalledTimes(1)

    // 重挂载：场景与伏笔节点仍在。
    await act(async () => { root?.unmount() })
    root = createRoot(container!)
    await act(async () => {
      root?.render(
        <ChapterCanvasWorkbench
          projectKey={PROJECT_PATH}
          chapterNumber={2}
          chapterTitle="刻痕之谜"
          canOpenDraft
          openDraftLabel="打开第2章正文"
          onOpenDraft={onOpenDraft}
        />,
      )
    })
    await vi.waitFor(() => {
      expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(2)
      expect(container!.querySelectorAll('[data-testid="chapter-canvas-aux"]')).toHaveLength(1)
    })
  })
})
