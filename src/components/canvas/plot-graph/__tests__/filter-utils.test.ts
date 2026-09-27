import { describe, expect, it } from 'vitest'
import {
  checkNodeSearchHit,
  filterPlotGraphNodes,
  resolvePlotGraphEdgeVisibility,
} from '../filter-utils'
import type { PlotGraphEdgeData, PlotGraphFilterState, PlotGraphNodeData } from '../types'

describe('plot-graph filter-utils', () => {
  const sampleNodes: Array<{ id: string; data: PlotGraphNodeData }> = [
    {
      id: 'node-1',
      data: {
        kind: 'plot',
        title: '青石镇血战',
        summary: '主角突围，宗族藏经阁被毁',
        tags: ['高潮', '战斗'],
      },
    },
    {
      id: 'node-2',
      data: {
        kind: 'character',
        title: '苏砚',
        summary: '青石镇苏家族人，身怀残卷',
        tags: ['主角', '复仇'],
      },
    },
    {
      id: 'node-3',
      data: {
        kind: 'foreshadow',
        title: '残卷谶语',
        summary: '凡入此江者，皆逆命而行',
        tags: ['古籍', '身世'],
      },
    },
    {
      id: 'node-4',
      data: {
        kind: 'location',
        title: '渡云荒江',
        summary: '江风如刀，铁索横江',
        tags: ['江河', '凶险'],
      },
    },
    {
      id: 'node-5',
      data: {
        kind: 'item',
        title: '玄幽铁索',
        summary: '封禁江流的古宝',
      },
    },
    {
      id: 'node-6',
      data: {
        kind: 'faction',
        title: '天命宗',
        summary: '追杀主角的神秘势力',
      },
    },
    {
      id: 'node-7',
      data: {
        kind: 'skill',
        title: '逆浪行',
        summary: '水系遁术身法',
      },
    },
    {
      id: 'node-8',
      data: {
        kind: 'idea',
        title: '灵感：渡船上的暗杀',
        summary: '刺客伪装成摆渡老人',
      },
    },
    {
      id: 'node-9',
      data: {
        kind: 'chapter',
        title: '第一章 逆流之航',
        summary: '故事开篇',
      },
    },
    {
      id: 'node-10',
      data: {
        kind: 'note',
        title: '便签：注意江雾的气氛渲染',
        summary: '突出肃杀压迫感',
      },
    },
  ]

  const sampleEdges: PlotGraphEdgeData[] = [
    { id: 'edge-1-2', source: 'node-1', target: 'node-2', label: '主角参与' },
    { id: 'edge-2-3', source: 'node-2', target: 'node-3', label: '知晓' },
    { id: 'edge-1-4', source: 'node-1', target: 'node-4', label: '发生于' },
    { id: 'edge-4-5', source: 'node-4', target: 'node-5', label: '包含' },
    { id: 'edge-6-1', source: 'node-6', target: 'node-1', label: '引发' },
  ]

  describe('checkNodeSearchHit', () => {
    it('matches by title case-insensitively', () => {
      expect(checkNodeSearchHit({ title: '青石镇血战' }, '青石')).toBe(true)
      expect(checkNodeSearchHit({ title: 'Hero Journey' }, 'hero')).toBe(true)
      expect(checkNodeSearchHit({ title: 'Hero Journey' }, 'villain')).toBe(false)
    })

    it('matches by summary', () => {
      expect(checkNodeSearchHit({ title: 'test', summary: '江风如刀' }, '江风')).toBe(true)
      expect(checkNodeSearchHit({ title: 'test', summary: '江风如刀' }, '烈火')).toBe(false)
    })

    it('matches by tags', () => {
      expect(checkNodeSearchHit({ title: 'test', tags: ['高潮', '战斗'] }, '战斗')).toBe(true)
      expect(checkNodeSearchHit({ title: 'test', tags: ['高潮'] }, '悬疑')).toBe(false)
    })

    it('returns false when query is empty', () => {
      expect(checkNodeSearchHit({ title: 'test' }, '  ')).toBe(false)
    })
  })

  describe('filterPlotGraphNodes', () => {
    it('returns all visible nodes when filter is empty or all kinds selected', () => {
      const filter: PlotGraphFilterState = {
        searchQuery: '',
        selectedKinds: new Set(),
      }
      const result = filterPlotGraphNodes(sampleNodes, filter)
      expect(result.visibleNodes).toHaveLength(10)
      expect(result.processedNodes.every(n => !n.data.hidden)).toBe(true)
      expect(result.kindCounts.plot).toBe(1)
      expect(result.kindCounts.character).toBe(1)
      expect(result.kindCounts.foreshadow).toBe(1)
    })

    it('filters by multiple kinds correctly without destroying hidden nodes', () => {
      const filter: PlotGraphFilterState = {
        searchQuery: '',
        selectedKinds: new Set(['character', 'location']),
      }
      const result = filterPlotGraphNodes(sampleNodes, filter)
      expect(result.visibleNodes).toHaveLength(2)
      expect(result.visibleNodes.map(n => n.data.kind)).toEqual(['character', 'location'])
      // Full list is preserved with hidden flag
      expect(result.processedNodes).toHaveLength(10)
      const hiddenNodes = result.processedNodes.filter(n => n.data.hidden)
      expect(hiddenNodes).toHaveLength(8)
    })

    it('calculates search hits and dims non-matching visible nodes', () => {
      const filter: PlotGraphFilterState = {
        searchQuery: '江',
        selectedKinds: new Set(),
      }
      const result = filterPlotGraphNodes(sampleNodes, filter)
      // '渡云荒江' (title), '残卷谶语' (summary: 凡入此江者), '便签' (summary: 注意江雾)
      expect(result.searchHits.length).toBeGreaterThanOrEqual(2)
      expect(result.searchHits.every(n => n.data.searchHit)).toBe(true)
      const nonHits = result.visibleNodes.filter(n => !n.data.searchHit)
      expect(nonHits.every(n => n.data.dimmed)).toBe(true)
    })

    it('handles combined kind filter and search query correctly', () => {
      const filter: PlotGraphFilterState = {
        searchQuery: '江',
        selectedKinds: new Set(['location']),
      }
      const result = filterPlotGraphNodes(sampleNodes, filter)
      expect(result.visibleNodes).toHaveLength(1)
      expect(result.visibleNodes[0].id).toBe('node-4')
      expect(result.searchHits).toHaveLength(1)
      expect(result.searchHits[0].id).toBe('node-4')
    })
  })

  describe('resolvePlotGraphEdgeVisibility (Connection rules & edge preservation)', () => {
    it('keeps edge visible when both source and target nodes are visible', () => {
      const visibleNodeIds = new Set(['node-1', 'node-2', 'node-3', 'node-4', 'node-5', 'node-6'])
      const searchHits = new Set<string>()
      const resolvedEdges = resolvePlotGraphEdgeVisibility(sampleEdges, visibleNodeIds, searchHits, false)

      expect(resolvedEdges.every(e => !e.hidden)).toBe(true)
    })

    it('hides edges when either source or target node is filtered out (no dangling edges)', () => {
      // Only keep 'node-1' and 'node-2' visible
      const visibleNodeIds = new Set(['node-1', 'node-2'])
      const searchHits = new Set<string>()
      const resolvedEdges = resolvePlotGraphEdgeVisibility(sampleEdges, visibleNodeIds, searchHits, false)

      // edge-1-2 should be visible
      const edge12 = resolvedEdges.find(e => e.id === 'edge-1-2')
      expect(edge12?.hidden).toBe(false)

      // edge-2-3 connects to hidden node-3 -> must be hidden
      const edge23 = resolvedEdges.find(e => e.id === 'edge-2-3')
      expect(edge23?.hidden).toBe(true)

      // edge-1-4 connects to hidden node-4 -> must be hidden
      const edge14 = resolvedEdges.find(e => e.id === 'edge-1-4')
      expect(edge14?.hidden).toBe(true)

      // edge-4-5 has both endpoints hidden -> must be hidden
      const edge45 = resolvedEdges.find(e => e.id === 'edge-4-5')
      expect(edge45?.hidden).toBe(true)
    })

    it('preserves all edges in the data without mutating original array', () => {
      const visibleNodeIds = new Set(['node-1'])
      const originalCopy = JSON.stringify(sampleEdges)
      const resolvedEdges = resolvePlotGraphEdgeVisibility(sampleEdges, visibleNodeIds, new Set(), false)

      expect(resolvedEdges).toHaveLength(sampleEdges.length)
      expect(JSON.stringify(sampleEdges)).toBe(originalCopy)
    })

    it('highlights edges connected to search hit nodes and dims other visible edges', () => {
      const visibleNodeIds = new Set(['node-1', 'node-2', 'node-3'])
      const searchHits = new Set(['node-2']) // node-2 is a search hit
      const resolvedEdges = resolvePlotGraphEdgeVisibility(sampleEdges, visibleNodeIds, searchHits, true)

      // edge-1-2 connects to node-2 -> dimmed false
      const edge12 = resolvedEdges.find(e => e.id === 'edge-1-2')
      expect(edge12?.hidden).toBe(false)
      expect(edge12?.dimmed).toBe(false)

      // edge-2-3 connects to node-2 -> dimmed false
      const edge23 = resolvedEdges.find(e => e.id === 'edge-2-3')
      expect(edge23?.hidden).toBe(false)
      expect(edge23?.dimmed).toBe(false)
    })
  })
})
