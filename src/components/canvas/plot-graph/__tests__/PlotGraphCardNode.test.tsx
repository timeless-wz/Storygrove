import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { PlotGraphCardNode } from '../PlotGraphCardNode'
import { ALL_PLOT_NODE_KINDS, type PlotGraphNode } from '../types'

function renderNode(node: PlotGraphNode, selected = false) {
  return renderToStaticMarkup(
    <ReactFlowProvider>
      {/* @ts-expect-error NodeProps mockup */}
      <PlotGraphCardNode {...node} selected={selected} />
    </ReactFlowProvider>
  )
}

describe('PlotGraphCardNode component', () => {
  it('renders all 10 kinds with correct kind attributes and labels', () => {
    const kindExpectedLabels: Record<string, string> = {
      plot: '剧情',
      idea: '灵感',
      foreshadow: '伏笔',
      character: '角色',
      location: '地点',
      item: '物品',
      faction: '势力',
      skill: '功法',
      chapter: '章节',
      note: '便签',
    }

    for (const kind of ALL_PLOT_NODE_KINDS) {
      const node: PlotGraphNode = {
        id: `node-${kind}`,
        type: 'plot-graph-card',
        position: { x: 0, y: 0 },
        data: {
          kind,
          title: `测试${kindExpectedLabels[kind]}标题`,
        },
      }

      const html = renderNode(node, false)

      expect(html).toContain(`data-kind="${kind}"`)
      expect(html).toContain(kindExpectedLabels[kind])
      expect(html).toContain(`测试${kindExpectedLabels[kind]}标题`)
    }
  })

  it('respects non-fabrication rule: does not render summary or tags container when empty', () => {
    const node: PlotGraphNode = {
      id: 'node-empty',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: {
        kind: 'plot',
        title: '无摘要节点',
      },
    }

    const html = renderNode(node, false)

    expect(html).toContain('无摘要节点')
    expect(html).not.toContain('plot-graph-card__summary')
    expect(html).not.toContain('plot-graph-card__tags')
  })

  it('renders summary, tags, and chapter references when present', () => {
    const node: PlotGraphNode = {
      id: 'node-full',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: {
        kind: 'foreshadow',
        title: '残卷伏笔',
        summary: '藏经阁深处的古老密约',
        tags: ['密约', '远古'],
        chapterRefs: [3, 7],
        hasPlan: true,
      },
    }

    const html = renderNode(node, false)

    expect(html).toContain('plot-graph-card__summary')
    expect(html).toContain('藏经阁深处的古老密约')
    expect(html).toContain('#密约')
    expect(html).toContain('#远古')
    expect(html).toContain('第3章')
    expect(html).toContain('第7章')
    expect(html).toContain('线索')
  })

  it('renders sub-canvas and entity link badges when present', () => {
    const node: PlotGraphNode = {
      id: 'node-sub',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: {
        kind: 'plot',
        title: '江面鏖战',
        subCanvasTitle: '渡口战斗子画布',
        subCanvasId: 'pca-sub-1',
        entityRef: {
          type: 'character',
          id: 'char-1',
          name: '苏砚',
        },
      },
    }

    const html = renderNode(node, false)

    expect(html).toContain('渡口战斗子画布')
    expect(html).toContain('苏砚')
  })

  it('shows every persisted entity reference without inventing a resolved entity name', () => {
    const html = renderNode({
      id: 'node-refs',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: {
        kind: 'note',
        title: '来源汇总',
        entityRefs: [
          { entityType: 'foreshadowing', entityId: 'fsh-1' },
          { entityType: 'draft', entityId: 12 },
        ],
      },
    })
    expect(html).toContain('foreshadowing: fsh-1')
    expect(html).toContain('draft: 12')
  })

  it('renders selected, search-hit, dimmed, and hidden class names accurately', () => {
    const nodeSelected: PlotGraphNode = {
      id: 'n1',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: { title: 'T1' },
    }
    const htmlSelected = renderNode(nodeSelected, true)
    expect(htmlSelected).toContain('is-selected')

    const nodeHit: PlotGraphNode = {
      id: 'n2',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: { title: 'T2', searchHit: true },
    }
    const htmlHit = renderNode(nodeHit, false)
    expect(htmlHit).toContain('is-search-hit')

    const nodeDimmed: PlotGraphNode = {
      id: 'n3',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: { title: 'T3', dimmed: true },
    }
    const htmlDimmed = renderNode(nodeDimmed, false)
    expect(htmlDimmed).toContain('is-dimmed')

    const nodeHidden: PlotGraphNode = {
      id: 'n4',
      type: 'plot-graph-card',
      position: { x: 0, y: 0 },
      data: { title: 'T4', hidden: true },
    }
    const htmlHidden = renderNode(nodeHidden, false)
    expect(htmlHidden).toContain('is-hidden')
  })

  it('maintains 100% backward compatibility when kind is omitted (legacy plot-event-card)', () => {
    const legacyNode: PlotGraphNode = {
      id: 'legacy-1',
      type: 'plot-graph-card',
      position: { x: 100, y: 100 },
      data: {
        title: '原有剧情事件',
        summary: '旧版数据平滑渲染',
        colorKey: 'accent',
        chapterRefs: [1],
        hasPlan: false,
        subCanvasTitle: null,
        dimmed: false,
        searchHit: false,
      },
    }

    const html = renderNode(legacyNode, false)

    expect(html).toContain('data-kind="plot"')
    expect(html).toContain('剧情')
    expect(html).toContain('原有剧情事件')
    expect(html).toContain('旧版数据平滑渲染')
    expect(html).toContain('第1章')
  })
})
