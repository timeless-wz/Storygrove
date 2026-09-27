import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, it } from 'vitest'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import '../../../../index.css'
import '../../../../styles/literary-themes.css'
import '../../../../styles/literary-workbench.css'
import '../../canvas-workbench.css'
import '../plot-graph.css'

import { useLocaleStore } from '../../../../stores/locale-store'
import { PlotGraphCardNode } from '../PlotGraphCardNode'
import { PlotGraphFilter } from '../PlotGraphFilter'
import { PlotNodeDetailPanel } from '../PlotNodeDetailPanel'
import { PlotGraphToolbar } from '../PlotGraphToolbar'
import { filterPlotGraphNodes, resolvePlotGraphEdgeVisibility } from '../filter-utils'
import type {
  CanvasInteractionMode,
  PlotGraphEdgeData,
  PlotGraphFilterState,
  PlotGraphNode,
  PlotNodeKind,
} from '../types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nodeTypes = {
  'plot-graph-card': PlotGraphCardNode,
}

const INITIAL_NODES: PlotGraphNode[] = [
  {
    id: 'n-plot',
    type: 'plot-graph-card',
    position: { x: 60, y: 80 },
    data: {
      kind: 'plot',
      title: '青石镇血战',
      summary: '主角突围，宗族藏经阁遭洗劫覆灭，青石镇化作火海。',
      tags: ['高潮', '宗族覆灭'],
      chapterRefs: [1, 2],
      hasPlan: true,
      subCanvasTitle: '青石镇战斗推演',
      subCanvasId: 'sub-board-1',
    },
  },
  {
    id: 'n-char',
    type: 'plot-graph-card',
    position: { x: 350, y: 80 },
    data: {
      kind: 'character',
      title: '苏砚',
      summary: '青石镇苏家族人，身怀上古残卷谶语，逆命独行。',
      tags: ['主角', '复仇', '水系'],
      chapterRefs: [1],
      entityRef: { type: 'character', id: 'char-101', name: '苏砚 (主角)' },
    },
  },
  {
    id: 'n-foreshadow',
    type: 'plot-graph-card',
    position: { x: 640, y: 80 },
    data: {
      kind: 'foreshadow',
      title: '残卷谶语',
      summary: '“凡入此江者，皆逆命而行，无退路，无归途。”',
      tags: ['古籍残卷', '宿命伏笔'],
      chapterRefs: [1, 12],
    },
  },
  {
    id: 'n-loc',
    type: 'plot-graph-card',
    position: { x: 60, y: 330 },
    data: {
      kind: 'location',
      title: '渡云荒江',
      summary: '江风如刀，铁索横江，常年笼罩在铅灰色冰冷浓雾中。',
      tags: ['主地图', '险境'],
      entityRef: { type: 'location', id: 'loc-201', name: '渡云荒江' },
    },
  },
  {
    id: 'n-item',
    type: 'plot-graph-card',
    position: { x: 350, y: 330 },
    data: {
      kind: 'item',
      title: '玄幽铁索',
      summary: '贯穿荒江两岸的上古玄铁索，刻有封禁镇魔符印。',
      tags: ['法宝', '封印'],
      entityRef: { type: 'item', id: 'item-301', name: '玄幽铁索' },
    },
  },
  {
    id: 'n-faction',
    type: 'plot-graph-card',
    position: { x: 640, y: 330 },
    data: {
      kind: 'faction',
      title: '天命宗巡察使',
      summary: '统御东荒九域的霸道宗门，密令缉捕苏家遗族。',
      tags: ['敌对阵营', '大宗门'],
      entityRef: { type: 'faction', id: 'fac-401', name: '天命宗' },
    },
  },
  {
    id: 'n-skill',
    type: 'plot-graph-card',
    position: { x: 60, y: 560 },
    data: {
      kind: 'skill',
      title: '逆浪游龙步',
      summary: '借水势而动的身法秘术，残卷附带的上古步法。',
      tags: ['身法', '玄阶上品'],
    },
  },
  {
    id: 'n-idea',
    type: 'plot-graph-card',
    position: { x: 350, y: 560 },
    data: {
      kind: 'idea',
      title: '灵感：渡船上的暗杀',
      summary: '刺客伪装成垂钓老者，在江心漩涡处暴起突袭。',
      tags: ['剧情脑洞', '悬疑反转'],
    },
  },
  {
    id: 'n-chapter',
    type: 'plot-graph-card',
    position: { x: 640, y: 560 },
    data: {
      kind: 'chapter',
      title: '第一章 逆流之航',
      summary: '长篇开篇：风雨江行，少年持卷踏上不归之途。',
      chapterRefs: [1],
    },
  },
  {
    id: 'n-note',
    type: 'plot-graph-card',
    position: { x: 930, y: 560 },
    data: {
      kind: 'note',
      title: '便签：江雾气氛渲染',
      summary: '重点强调铅灰色冷风与铁索冰凉感，营造萧瑟冷寂基调。',
    },
  },
]

const INITIAL_EDGES: PlotGraphEdgeData[] = [
  { id: 'e1', source: 'n-plot', target: 'n-char', label: '主角经历' },
  { id: 'e2', source: 'n-char', target: 'n-foreshadow', label: '参悟' },
  { id: 'e3', source: 'n-plot', target: 'n-loc', label: '转战于' },
  { id: 'e4', source: 'n-loc', target: 'n-item', label: '地标古迹' },
  { id: 'e5', source: 'n-faction', target: 'n-char', label: '追杀' },
  { id: 'e6', source: 'n-char', target: 'n-skill', label: '习得' },
  { id: 'e7', source: 'n-idea', target: 'n-plot', label: '融入' },
  { id: 'e8', source: 'n-plot', target: 'n-chapter', label: '章节归属' },
]

function InteractivePlotCanvasDemo() {
  const [nodes] = useState<PlotGraphNode[]>(INITIAL_NODES)
  const [edges] = useState<PlotGraphEdgeData[]>(INITIAL_EDGES)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n-char')
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('pan')
  const [showGrid, setShowGrid] = useState(true)
  const [filter, setFilter] = useState<PlotGraphFilterState>({
    searchQuery: '',
    selectedKinds: new Set<PlotNodeKind>(),
  })

  // 纯函数计算筛选与连线可见性
  const filterResult = filterPlotGraphNodes(nodes, filter)
  const visibleNodeIdSet = new Set(filterResult.visibleNodes.map(n => n.id))
  const searchHitNodeIdSet = new Set(filterResult.searchHits.map(n => n.id))
  const resolvedEdges = resolvePlotGraphEdgeVisibility(
    edges,
    visibleNodeIdSet,
    searchHitNodeIdSet,
    filter.searchQuery.trim().length > 0
  )

  const selectedNode = nodes.find(n => n.id === selectedNodeId)?.data ?? null

  const flowEdges: Edge[] = resolvedEdges
    .filter(e => !e.hidden)
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: !e.dimmed,
      style: {
        stroke: e.dimmed ? 'var(--color-border)' : 'var(--color-accent)',
        opacity: e.dimmed ? 0.35 : 0.9,
      },
    }))

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden select-none bg-[var(--color-bg)]"
      style={{
        backgroundColor: 'var(--color-bg, #0f172a)',
        color: 'var(--color-text, #f8fafc)',
      }}
    >
      {/* 顶部状态与面包屑 */}
      <div
        className="flex items-center justify-between px-4 h-12 border-b flex-shrink-0 z-20"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-panel)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
            <span className="text-xs font-semibold text-[var(--color-accent)]">剧情编排</span>
            <span className="text-xs text-[var(--color-text-muted)]">/</span>
            <span className="text-xs font-medium text-[var(--color-text)]">第一卷 · 逆流之航</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-raised)] text-[var(--color-text-secondary)]">
              {nodes.length} 节点
            </span>
          </div>
        </div>

        {/* 顶部搜索与种类筛选 */}
        <div className="flex items-center gap-2">
          <PlotGraphFilter
            filter={filter}
            onFilterChange={setFilter}
            kindCounts={filterResult.kindCounts}
            matchCount={filterResult.matchCount}
          />
        </div>
      </div>

      {/* 画布中央区 */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* 左侧悬浮工具条 */}
        <PlotGraphToolbar
          interactionMode={interactionMode}
          onInteractionModeChange={setInteractionMode}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid(g => !g)}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          onFitView={() => {}}
          onCenterView={() => {}}
          onFocusSearch={() => {}}
        />

        {/* 主画布 Flow */}
        <div className="flex-1 h-full relative canvas-workbench__flow">
          <ReactFlow
            nodes={filterResult.processedNodes.map(n => ({
              ...n,
              selected: n.id === selectedNodeId,
            }))}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            panOnDrag={interactionMode === 'pan'}
            selectionOnDrag={interactionMode === 'select'}
          >
            {showGrid && (
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.5}
                color="color-mix(in srgb, var(--color-text) 18%, transparent)"
              />
            )}
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
        </div>

        {/* 右侧节点详情抽屉 */}
        <PlotNodeDetailPanel
          nodeId={selectedNodeId}
          nodeData={selectedNode}
          onClose={() => setSelectedNodeId('')}
          onEdit={() => {}}
          onDelete={() => {}}
          onSplit={() => {}}
          onEnterSubCanvas={() => {}}
          onNavigateEntity={() => {}}
          onOpenPlan={() => {}}
        />
      </div>
    </div>
  )
}

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  await page.viewport(1440, 880)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  container.style.width = '1440px'
  container.style.height = '880px'
  container.style.position = 'relative'
  container.style.overflow = 'hidden'
  document.body.style.margin = '0'
  document.body.style.padding = '0'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  root.unmount()
  container.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})

describe('Plot Graph interactive visual demonstration capture', () => {
  it('captures full plot canvas with 10 kinds, toolbar, filter, and detail drawer', async () => {
    document.documentElement.setAttribute('data-theme', 'storyforge')
    await act(async () => {
      root.render(<InteractivePlotCanvasDemo />)
    })

    // 等待 React Flow 与所有节点样式完成挂载和排版渲染
    await new Promise(r => setTimeout(r, 1200))

    await page.screenshot({ path: '__screenshots__/plot-canvas-graph-demo.png' })
  })
})
