import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlotGraphFilter } from '../PlotGraphFilter'
import type { PlotGraphFilterState, PlotNodeKind } from '../types'

describe('PlotGraphFilter component', () => {
  const defaultFilter: PlotGraphFilterState = {
    searchQuery: '',
    selectedKinds: new Set<PlotNodeKind>(),
  }

  it('renders search box, trigger button, and default placeholder', () => {
    const html = renderToStaticMarkup(
      <PlotGraphFilter
        filter={defaultFilter}
        onFilterChange={vi.fn()}
      />
    )

    expect(html).toContain('plot-graph-filter-bar')
    expect(html).toContain('plot-graph-search-input')
    expect(html).toContain('搜索标题、摘要或标签')
    expect(html).toContain('种类筛选')
  })

  it('displays search query and match counter when query is active', () => {
    const htmlWithQuery = renderToStaticMarkup(
      <PlotGraphFilter
        filter={{ searchQuery: '江风', selectedKinds: new Set() }}
        onFilterChange={vi.fn()}
        matchCount={3}
        currentMatchIndex={1}
      />
    )

    expect(htmlWithQuery).toContain('江风')
    expect(htmlWithQuery).toContain('1 / 3')
    expect(htmlWithQuery).toContain('上一个')
    expect(htmlWithQuery).toContain('下一个')
    expect(htmlWithQuery).toContain('清除搜索')
  })

  it('displays "无结果" when match count is zero with active query', () => {
    const htmlNoMatch = renderToStaticMarkup(
      <PlotGraphFilter
        filter={{ searchQuery: '不存在的词', selectedKinds: new Set() }}
        onFilterChange={vi.fn()}
        matchCount={0}
      />
    )

    expect(htmlNoMatch).toContain('不存在的词')
    expect(htmlNoMatch).toContain('无结果')
  })

  it('renders filter badge with active filter count when some kinds are selected', () => {
    const filterWithKinds: PlotGraphFilterState = {
      searchQuery: '',
      selectedKinds: new Set(['character', 'location', 'plot']),
    }

    const html = renderToStaticMarkup(
      <PlotGraphFilter
        filter={filterWithKinds}
        onFilterChange={vi.fn()}
      />
    )

    expect(html).toContain('plot-graph-filter-badge')
    expect(html).toContain('>3<')
  })
})
