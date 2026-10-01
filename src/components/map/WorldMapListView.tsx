import { useState } from 'react'
import {
  type WorldMapNode,
  type WorldMapEdge,
  WORLD_MAP_NODE_TYPE_LABELS,
  WORLD_MAP_EDGE_TYPE_LABELS,
  getWorldMapMarkerIcon,
} from '../../shared/world-map'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Search, Edit2, Trash2, ArrowRight } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { WORLD_MAP_MARKER_ICONS } from './world-map-marker-icons'

interface Props {
  /** 当前地图自己的地点与内部连接。 */
  nodes: WorldMapNode[]
  edges: WorldMapEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
  onEditNode: (node: WorldMapNode) => void
  onDeleteNode: (id: string) => void
  onEditEdge: (edge: WorldMapEdge) => void
  onDeleteEdge: (id: string) => void
}

export default function WorldMapListView({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onEditNode,
  onDeleteNode,
  onEditEdge,
  onDeleteEdge,
}: Props) {
  const text = useLocaleStore(s => s.text)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'nodes' | 'edges'>('nodes')

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const filteredNodes = nodes.filter(n => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return n.name.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)
  })

  const filteredEdges = edges.filter(e => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const fromName = nodeMap.get(e.fromNodeId)?.name.toLowerCase() || ''
    const toName = nodeMap.get(e.toNodeId)?.name.toLowerCase() || ''
    return fromName.includes(q) || toName.includes(q) || e.description.toLowerCase().includes(q)
  })

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden bg-[var(--color-bg)]">
      {/* Search & Tabs */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
        <div className="flex items-center gap-1 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-0.5 text-xs">
          <button
            type="button"
            className={`px-3 py-1 rounded transition-colors ${tab === 'nodes' ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            onClick={() => setTab('nodes')}
          >
            {text(`地图节点 (${nodes.length})`, `Nodes (${nodes.length})`)}
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded transition-colors ${tab === 'edges' ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            onClick={() => setTab('edges')}
          >
            {text(`连线与航路 (${edges.length})`, `Edges & Routes (${edges.length})`)}
          </button>
        </div>

        <div className="relative w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <Input
            className="pl-8 h-8 text-xs"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={text('搜索地点名称、描述...', 'Search locations...')}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)]">
        {tab === 'nodes' ? (
          filteredNodes.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
              {text('未找到匹配的地图节点', 'No matching nodes found')}
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  <th className="py-2 px-3 font-semibold">{text('名称', 'Name')}</th>
                  <th className="py-2 px-3 font-semibold">{text('类型', 'Type')}</th>
                  <th className="py-2 px-3 font-semibold">{text('上级地点', 'Parent location')}</th>
                  <th className="py-2 px-3 font-semibold">{text('描述', 'Description')}</th>
                  <th className="py-2 px-3 font-semibold text-right">{text('操作', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredNodes.map(n => {
                  const isSelected = n.id === selectedNodeId
                  const MarkerIcon = WORLD_MAP_MARKER_ICONS[getWorldMapMarkerIcon(n)]
                  return (
                    <tr
                      key={n.id}
                      className={`border-b border-[var(--color-border)] hover:bg-[var(--color-hover)] cursor-pointer transition-colors ${isSelected ? 'bg-[var(--color-active)]' : ''}`}
                      onClick={() => onSelectNode(n.id)}
                    >
                      <td className="py-2 px-3 font-medium text-[var(--color-text)]">
                        <span className="inline-flex items-center gap-2"><MarkerIcon size={16} className="shrink-0" aria-hidden="true" />{n.name}</span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)]">
                          {text(WORLD_MAP_NODE_TYPE_LABELS[n.type]?.zh || n.type, n.type)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[var(--color-text-muted)]">
                        {n.parentId ? nodeMap.get(n.parentId)?.name ?? n.parentId : '—'}
                      </td>
                      <td className="py-2 px-3 text-[var(--color-text-secondary)] truncate max-w-xs">
                        {n.description || '—'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => onEditNode(n)}
                            title={text('编辑', 'Edit')}
                          >
                            <Edit2 size={12} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-[var(--color-error)]"
                            onClick={() => onDeleteNode(n.id)}
                            title={text('删除', 'Delete')}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          filteredEdges.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
              {text('未找到匹配的连线', 'No matching edges found')}
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                  <th className="py-2 px-3 font-semibold">{text('起点', 'From')}</th>
                  <th className="py-2 px-3 font-semibold">{text('终点', 'To')}</th>
                  <th className="py-2 px-3 font-semibold">{text('类型', 'Type')}</th>
                  <th className="py-2 px-3 font-semibold">{text('说明', 'Description')}</th>
                  <th className="py-2 px-3 font-semibold">{text('状态', 'Status')}</th>
                  <th className="py-2 px-3 font-semibold text-right">{text('操作', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEdges.map(e => {
                  const isSelected = e.id === selectedEdgeId
                  const fromNode = nodeMap.get(e.fromNodeId)
                  const toNode = nodeMap.get(e.toNodeId)
                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-[var(--color-border)] hover:bg-[var(--color-hover)] cursor-pointer transition-colors ${isSelected ? 'bg-[var(--color-active)]' : ''}`}
                      onClick={() => onSelectEdge(e.id)}
                    >
                      <td className="py-2 px-3 font-medium text-[var(--color-text)]">{fromNode?.name || e.fromNodeId}</td>
                      <td className="py-2 px-3 font-medium text-[var(--color-text)]">
                        <span className="flex items-center gap-1">
                          <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
                          {toNode?.name || e.toNodeId}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-hover)] text-[var(--color-text-secondary)]">
                          {text(WORLD_MAP_EDGE_TYPE_LABELS[e.type]?.zh || e.type, e.type)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[var(--color-text-secondary)] truncate max-w-xs">
                        {e.description || '—'}
                      </td>
                      <td className="py-2 px-3 text-[var(--color-text-muted)]">
                        {e.status}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={ev => ev.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => onEditEdge(e)}
                            title={text('编辑', 'Edit')}
                          >
                            <Edit2 size={12} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-[var(--color-error)]"
                            onClick={() => onDeleteEdge(e.id)}
                            title={text('删除', 'Delete')}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}
