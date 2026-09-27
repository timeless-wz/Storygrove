import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlotNodeDetailPanel } from '../PlotNodeDetailPanel'
import type { PlotGraphNodeData } from '../types'

describe('PlotNodeDetailPanel component', () => {
  it('renders clean empty state when no node is selected', () => {
    const html = renderToStaticMarkup(
      <PlotNodeDetailPanel nodeId={null} nodeData={null} />
    )

    expect(html).toContain('plot-graph-detail-empty')
    expect(html).toContain('未选中任何节点')
  })

  it('renders all actual node fields, tags, and chapter references accurately', () => {
    const data: PlotGraphNodeData = {
      kind: 'foreshadow',
      title: '龙渊残剑的来历',
      summary: '百年前青石宗大长老亲手封入深潭',
      tags: ['神兵', '封印'],
      chapterRefs: [4, 9],
      planId: 102,
      subCanvasId: 'pca-sub-2',
      subCanvasTitle: '剑冢秘境',
      entityRef: {
        type: 'item',
        id: 'item-99',
        name: '龙渊残剑',
      },
    }

    const html = renderToStaticMarkup(
      <PlotNodeDetailPanel
        nodeId="node-123"
        nodeData={data}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSplit={vi.fn()}
        onEnterSubCanvas={vi.fn()}
        onNavigateEntity={vi.fn()}
        onOpenPlan={vi.fn()}
      />
    )

    expect(html).toContain('龙渊残剑的来历')
    expect(html).toContain('百年前青石宗大长老亲手封入深潭')
    expect(html).toContain('#神兵')
    expect(html).toContain('#封印')
    expect(html).toContain('第4章')
    expect(html).toContain('第9章')
    expect(html).toContain('计划 ID: #102')
    expect(html).toContain('剑冢秘境')
    expect(html).toContain('龙渊残剑')
    expect(html).toContain('拆分续接')
    expect(html).toContain('编辑')
    expect(html).toContain('删除')
  })

  it('handles missing callbacks and references gracefully with disabled state', () => {
    const data: PlotGraphNodeData = {
      kind: 'note',
      title: '临时便签',
      summary: '',
      subCanvasId: 'pca-sub-x', // has ID but no callback
    }

    const html = renderToStaticMarkup(
      <PlotNodeDetailPanel
        nodeId="node-note"
        nodeData={data}
        // onEnterSubCanvas is deliberately omitted
      />
    )

    expect(html).toContain('临时便签')
    expect(html).toContain('disabled=""')
  })

  it('hides footer action buttons when readOnly is true', () => {
    const data: PlotGraphNodeData = {
      kind: 'plot',
      title: '定稿只读章节',
      summary: '已发布内容',
    }

    const html = renderToStaticMarkup(
      <PlotNodeDetailPanel
        nodeId="node-readonly"
        nodeData={data}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        readOnly={true}
      />
    )

    expect(html).toContain('定稿只读章节')
    expect(html).not.toContain('plot-graph-detail-panel__footer')
    expect(html).not.toContain('删除')
    expect(html).not.toContain('编辑')
  })
})
