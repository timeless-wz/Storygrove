/**
 * plot-canvas-acceptance.browser.tsx — 剧情画布集成验收流程与截图存证。
 *
 * 在真实组件树上走完验收链路：新建画布 → 新增事件 → 编辑（种类/标签）→
 * 筛选 → 查看详情 → 卸载重装后读回。数据经 fixture IPC 写入内存数据集，
 * 断言同时校验 IPC 调用与 DOM；截图输出到 output/plot-canvas-integration/，
 * 覆盖 1264×900 / 2516×1289 与深色主题。
 *
 * 运行：npx vitest run --config vitest.browser.config.ts
 *       src/components/canvas/__tests__/plot-canvas-acceptance.browser.tsx
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

import type { ProjectData } from '../../../shared/ipc-channels'
import {
  createPlotCanvasEdgeId,
  createPlotCanvasId,
  createPlotCanvasNodeId,
  type PlotCanvasEdgeData,
  type PlotCanvasGraph,
  type PlotCanvasNodeData,
  type PlotCanvasSummary,
} from '../../../shared/plot-canvas'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import PlotCanvasWorkbench from '../PlotCanvasWorkbench'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\plot-canvas-acceptance'
const SCREENSHOT_DIR = 'output/plot-canvas-integration'

interface FixtureDb {
  canvases: PlotCanvasSummary[]
  graphs: Map<string, { nodes: PlotCanvasNodeData[]; edges: PlotCanvasEdgeData[] }>
}

let db: FixtureDb
let container: HTMLDivElement
let root: Root
let aiReply = ''

beforeEach(() => {
  db = { canvases: [], graphs: new Map() }
  aiReply = ''
  useLocaleStore.setState({ locale: 'zh-CN' })
  const project: ProjectData = {
    id: 'plot-acceptance', sessionLease: 'plot-acceptance-lease', name: '验收项目', path: PROJECT_PATH,
    novelConfig: { genre: '', subGenre: '', targetAudience: '', totalChapters: 12, wordsPerChapter: 2000, plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '' },
    characterStates: '', createdAt: '', updatedAt: '',
  }
  useProjectStore.setState({ currentProject: project, fileTree: [], loading: false })
  setActiveProjectSessionContext({ projectId: project.id, leaseId: project.sessionLease!, projectPath: PROJECT_PATH })
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    switch (channel) {
      case 'db:plot-canvas-list':
        return [...db.canvases].sort((a, b) => a.sortOrder - b.sortOrder)
      case 'db:plot-canvas-create': {
        const [name, parentCanvasId] = args as [string, string | null]
        const description = args.length >= 4 ? String(args[2] ?? '') : ''
        const canvas: PlotCanvasSummary = {
          id: `pca-${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000`,
          name, description: description ?? '', parentCanvasId, sortOrder: db.canvases.length + 1,
        }
        db.canvases.push(canvas)
        db.graphs.set(canvas.id, { nodes: [], edges: [] })
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
      case 'db:plot-canvas-graph-get': {
        const [canvasId] = args as [string]
        const canvas = db.canvases.find(item => item.id === canvasId)
        if (!canvas) throw new Error('剧情画布不存在')
        const graph = db.graphs.get(canvasId) ?? { nodes: [], edges: [] }
        return { canvas, viewport: null, nodes: graph.nodes, edges: graph.edges } satisfies PlotCanvasGraph
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
      case 'db:plot-canvas-graph-apply': {
        const [input] = args as [{ canvasId: string; expectedNodes: PlotCanvasNodeData[]; expectedEdges: PlotCanvasEdgeData[]; desiredNodes: PlotCanvasNodeData[]; desiredEdges: PlotCanvasEdgeData[] }]
        const current = db.graphs.get(input.canvasId)
        if (!current || JSON.stringify(current.nodes) !== JSON.stringify(input.expectedNodes)
          || JSON.stringify(current.edges) !== JSON.stringify(input.expectedEdges)) {
          return { success: false, error: '画布在生成候选后发生了变化' }
        }
        const next = { nodes: structuredClone(input.desiredNodes), edges: structuredClone(input.desiredEdges) }
        db.graphs.set(input.canvasId, next)
        return { success: true, graph: {
          canvas: db.canvases.find(item => item.id === input.canvasId), viewport: null,
          nodes: next.nodes, edges: next.edges,
        } }
      }
      case 'llm:generate':
        return { success: true, content: aiReply, finishReason: 'stop' }
      case 'db:blueprint-get-all':
        return [{
          chapterNumber: 2, title: '验牌', role: '发展', purpose: '', keyEvents: '',
          characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '',
        }]
      case 'db:blueprint-v2-summary-list':
        return []
      case 'db:draft-list-all':
        return [{ id: 7, chapterNumber: 2, version: 1, status: 'finalized', source: 'write', contentId: 1, wordCount: 800, createdAt: '', updatedAt: '' }]
      case 'db:narrative-thread-list':
        return [{ id: 3, title: '铜牌与归墟', type: 'mystery', targetStartChapter: 1, targetEndChapter: 6, authorIntent: '', status: 'planned', dormantChapters: 0, overdue: false, events: [], createdAt: '', updatedAt: '' }]
      case 'db:foreshadowing-list':
        return [{ id: 'fs-1', draftId: 7, chapterNumber: 2, selectedText: '铜牌', startOffset: 0, endOffset: 2, contextBefore: '', contextAfter: '', note: '潮纹铜牌的来历', markerType: 'foreshadowing', color: 'blue', completed: false, createdAt: '', updatedAt: '', completedAt: null }]
      default:
        return { success: true }
    }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
  container = document.createElement('div')
  container.style.width = '100vw'
  container.style.height = '100vh'
  container.style.position = 'relative'
  container.style.overflow = 'hidden'
  document.body.style.margin = '0'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
  Reflect.deleteProperty(window, 'velaAPI')
  useLLMStore.setState({ models: [], defaultModelId: null, loaded: false })
})

async function clickButton(matcher: (button: HTMLButtonElement) => boolean) {
  const button = await vi.waitFor(() => {
    const found = Array.from(document.body.querySelectorAll('button')).find(matcher)
    if (!found) throw new Error('button not found')
    return found
  })
  await act(async () => { button.click() })
}

function findButton(label: string) {
  return (button: HTMLButtonElement) => button.textContent?.includes(label) ?? false
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

async function settle(ms = 350) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
}

async function shoot(name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` })
}

describe('plot canvas integration acceptance', () => {
  it('offers both AI modes and only writes an approved proposal', async () => {
    const canvasId = createPlotCanvasId()
    db.canvases.push({ id: canvasId, name: 'AI 主线', description: '', parentCanvasId: null, sortOrder: 1 })
    db.graphs.set(canvasId, { nodes: [], edges: [] })
    useLLMStore.setState({
      loaded: true, defaultModelId: 'test-generation',
      models: [{ id: 'test-generation', name: '测试外部模型', modelName: 'test-generation', purposes: ['generation'] }] as ReturnType<typeof useLLMStore.getState>['models'],
    })
    aiReply = JSON.stringify({ explanation: '建立开端与转折', operations: [
      { action: 'add_node', key: 'start', title: '开端', chapterRefs: [2] },
      { action: 'add_node', key: 'turn', title: '转折' },
      { action: 'add_edge', source: 'start', target: 'turn', label: '引出' },
    ] })
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container.querySelector('[data-testid="plot-canvas-ai-initialize"]')).toBeTruthy())
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-ai-initialize')
    await clickButton(findButton('生成候选'))
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="plot-canvas-ai-preview"]')).toBeTruthy())
    expect(db.graphs.get(canvasId)?.nodes).toHaveLength(0)
    await shoot('10-ai-initialize-preview')
    await clickButton(findButton('确认并应用'))
    await vi.waitFor(() => expect(db.graphs.get(canvasId)?.nodes).toHaveLength(2))
    expect(db.graphs.get(canvasId)?.edges).toHaveLength(1)
    await clickButton(button => button.textContent?.trim() === '关闭')

    const firstId = db.graphs.get(canvasId)!.nodes[0].id
    aiReply = JSON.stringify({ explanation: '调整开端', operations: [
      { action: 'update_node', id: firstId, title: '新的开端' },
    ] })
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-ai-discuss')
    await setInput('#plot-canvas-ai-instruction', '修改第一个事件的标题')
    await clickButton(findButton('生成候选'))
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="plot-canvas-ai-preview"]')).toBeTruthy())
    expect(db.graphs.get(canvasId)?.nodes[0]?.title).toBe('开端')
    await clickButton(findButton('确认并应用'))
    await vi.waitFor(() => expect(db.graphs.get(canvasId)?.nodes[0]?.title).toBe('新的开端'))
  })

  it('keeps the newly selected canvas when the previous graph read resolves late', async () => {
    const alphaId = createPlotCanvasId()
    const betaId = createPlotCanvasId()
    const makeNode = (canvasId: string, title: string): PlotCanvasNodeData => ({
      id: createPlotCanvasNodeId(), canvasId, kind: 'plot', title, summary: '',
      colorKey: 'default', tags: [], entityRefs: [], chapterRefs: [],
      planId: null, subCanvasId: null, x: 120, y: 160,
    })
    db.canvases.push(
      { id: alphaId, name: '先打开的画布', description: '', parentCanvasId: null, sortOrder: 1 },
      { id: betaId, name: '后选择的画布', description: '', parentCanvasId: null, sortOrder: 2 },
    )
    db.graphs.set(alphaId, { nodes: [makeNode(alphaId, '旧画布节点')], edges: [] })
    db.graphs.set(betaId, { nodes: [makeNode(betaId, '新画布节点')], edges: [] })

    let releaseOldRead!: (graph: PlotCanvasGraph) => void
    const delayedOldRead = new Promise<PlotCanvasGraph>(resolve => { releaseOldRead = resolve })
    const api = (window as unknown as { velaAPI: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }).velaAPI
    const baseInvoke = api.invoke
    api.invoke = vi.fn((channel: string, ...args: unknown[]) => (
      channel === 'db:plot-canvas-graph-get' && args[0] === alphaId
        ? delayedOldRead
        : baseInvoke(channel, ...args)
    ))

    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container.textContent).toContain('后选择的画布'))
    await clickButton(button => button.title === '后选择的画布')
    await vi.waitFor(() => expect(container.textContent).toContain('新画布节点'))
    releaseOldRead({
      canvas: db.canvases[0], viewport: null,
      nodes: db.graphs.get(alphaId)!.nodes, edges: [],
    })
    await settle(100)
    expect(container.textContent).toContain('新画布节点')
    expect(container.textContent).not.toContain('旧画布节点')
  })

  it('新建画布 → 新增/编辑节点 → 筛选 → 查看详情 → 重开读回（含双尺寸双主题截图）', async () => {
    document.documentElement.setAttribute('data-theme', 'storyforge')
    document.documentElement.className = ''
    await page.viewport(1264, 900)

    // 1) 无画布状态
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container.textContent).toContain('暂无剧情画布'))
    await settle()
    await shoot('01-light-1264-no-canvas')

    // 2) 新建画布：标题与说明由单次 create IPC 一起写入。
    await clickButton(findButton('新增剧情画布'))
    await setInput('#plot-canvas-create-title', '第一卷 · 归墟主线')
    await setInput('#plot-canvas-create-description', '渔村灭门到归墟之门的主线编排')
    await clickButton(findButton('创建'))
    await vi.waitFor(() => expect(container.textContent).toContain('第一卷 · 归墟主线'))
    expect(db.canvases[0]?.description).toBe('渔村灭门到归墟之门的主线编排')

    // 3) 空画布状态 → 手动新增事件（真实创建并保存）
    await vi.waitFor(() => expect(container.querySelector('[data-testid="plot-canvas-empty-state"]')?.getAttribute('data-mode')).toBe('empty-canvas'))
    await settle()
    await shoot('02-light-1264-empty-canvas')

    await clickButton(findButton('新增剧情事件'))
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(1))
    const pane = container.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()
    const paneBounds = pane!.getBoundingClientRect()
    await act(async () => {
      pane!.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        clientX: paneBounds.left + 110,
        clientY: paneBounds.top + paneBounds.height / 2,
      }))
    })
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(2))
    await vi.waitFor(() => expect(db.graphs.get(db.canvases[0].id)?.nodes).toHaveLength(2))

    // 4) 编辑节点：改标题、种类（剧情→伏笔）、标签，真实写库
    await setInput('#plot-node-title', '潮纹铜牌')
    await clickButton(button => button.textContent?.trim() === '伏笔' && button.className.includes('planning-chip'))
    await setInput('#plot-node-tags', '暗线, 铜牌')
    await clickButton(findButton('保存修改'))
    await vi.waitFor(() => {
      const saved = db.graphs.get(db.canvases[0].id)?.nodes.find(node => node.title === '潮纹铜牌')
      expect(saved?.kind).toBe('foreshadow')
      expect(saved?.tags).toEqual(['暗线', '铜牌'])
    })

    // 5) 查看详情（选中节点 → 右侧详情；含章节跳转区）
    await vi.waitFor(() => expect(container.querySelector('[data-testid="plot-canvas-detail"]')).toBeTruthy())
    await settle()
    const selectedCard = container.querySelector<HTMLElement>('[data-kind="foreshadow"]')
    const flowPane = container.querySelector<HTMLElement>('.react-flow')
    expect(selectedCard).not.toBeNull()
    expect(flowPane).not.toBeNull()
    for (const card of container.querySelectorAll<HTMLElement>('[data-testid="plot-graph-card"]')) {
      const cardRect = card.getBoundingClientRect()
      const paneRect = flowPane!.getBoundingClientRect()
      expect(cardRect.left).toBeGreaterThanOrEqual(paneRect.left + 8)
      expect(cardRect.right).toBeLessThanOrEqual(paneRect.right - 8)
    }
    await shoot('03-light-1264-detail-and-nodes')

    // The fixture has one persisted edge so the filter assertion checks an
    // actual React Flow connection rather than a graph with no edges.
    const canvasId = db.canvases[0].id
    const storedGraph = db.graphs.get(canvasId)!
    storedGraph.edges.push({
      id: createPlotCanvasEdgeId(), canvasId,
      sourceNodeId: storedGraph.nodes[0].id,
      targetNodeId: storedGraph.nodes[1].id,
      label: '承接', kind: 'main',
    })
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => expect(container.querySelector('.react-flow__edge')).toBeTruthy())

    // 6) 筛选：打开筛选条，搜索定位 + 种类筛选只改视图
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-topbar-search')
    await vi.waitFor(() => expect(container.querySelector('.plot-graph-search-input')).toBeTruthy())
    await setInput('.plot-graph-search-input', '潮纹')
    await vi.waitFor(() => {
      const hit = container.querySelector('[data-kind="foreshadow"]')
      expect(hit?.className).toContain('is-search-hit')
    })
    await settle()
    await shoot('04-light-1264-search-filter')

    await setInput('.plot-graph-search-input', '')
    // 筛选条已由搜索步骤打开：直接点条内的“种类筛选”触发器。
    await vi.waitFor(() => expect(container.querySelector('.plot-graph-filter-trigger')).toBeTruthy())
    await act(async () => { (container.querySelector('.plot-graph-filter-trigger') as HTMLButtonElement).click() })
    await vi.waitFor(() => expect(container.querySelector('.plot-graph-filter-chips-grid')).toBeTruthy())
    await settle()
    await shoot('05-light-1264-kind-filter-popover')
    const plotChip = await vi.waitFor(() => {
      const found = Array.from(container.querySelectorAll('.plot-graph-filter-chip')).find(chip => chip.textContent?.startsWith('剧情'))
      if (!found) throw new Error('plot chip missing')
      return found as HTMLElement
    })
    await act(async () => { plotChip.click() })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-kind="plot"]')).toBeNull()
      expect(container.querySelector('[data-kind="foreshadow"]')).toBeTruthy()
      expect(container.querySelector('.react-flow__edge')).toBeNull()
    })
    expect(db.graphs.get(db.canvases[0].id)?.nodes).toHaveLength(2)
    expect(db.graphs.get(db.canvases[0].id)?.edges).toHaveLength(1)
    await settle()
    await shoot('06-light-1264-kind-filtered')
    // 重置筛选恢复视图
    await clickButton(button => button.textContent === '重置')
    await vi.waitFor(() => {
      expect(container.querySelector('[data-kind="plot"]')).toBeTruthy()
      expect(container.querySelector('[data-kind="foreshadow"]')).toBeTruthy()
      expect(container.querySelector('.react-flow__edge')).toBeTruthy()
    })

    // 7) 宽屏 2516×1289（信息面板展开；先关详情，右栏让位给信息面板）
    await page.viewport(2516, 1289)
    const closeDetail = container.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')
    if (closeDetail) await act(async () => { closeDetail.click() })
    await vi.waitFor(() => expect(container.querySelector('[data-testid="plot-canvas-detail"]')).toBeNull())
    await clickButton(button => button.getAttribute('data-testid') === 'plot-canvas-topbar-info')
    await vi.waitFor(() => expect(container.querySelector('[data-testid="plot-canvas-info-panel"]')).toBeTruthy())
    await settle(500)
    await shoot('07-light-2516-info-panel')

    // 8) 关闭并重开项目（卸载重装）→ 画布、节点、种类、标签、描述全部读回
    await page.viewport(1264, 900)
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await act(async () => { root.render(<PlotCanvasWorkbench projectKey={PROJECT_PATH} />) })
    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="plot-graph-card"]')).toHaveLength(2)
      expect(container.textContent).toContain('潮纹铜牌')
      expect(container.textContent).toContain('渔村灭门到归墟之门的主线编排')
      const saved = db.graphs.get(db.canvases[0].id)?.nodes.find(node => node.title === '潮纹铜牌')
      expect(saved?.kind).toBe('foreshadow')
      expect(saved?.tags).toEqual(['暗线', '铜牌'])
    })
    await settle()
    await shoot('08-light-1264-reopened')

    // 9) 深色主题
    document.documentElement.setAttribute('data-theme', 'ember')
    document.documentElement.className = 'dark'
    await settle()
    await shoot('09-dark-1264-reopened')
  })
})
