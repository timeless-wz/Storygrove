import { useState, useEffect } from 'react'
import {
  Map as MapIcon,
  List,
  Plus,
  Sparkles,
  Layers,
  MapPin,
  Compass,
  ArrowRight,
  Edit2,
  Trash2,
  BookOpen,
} from 'lucide-react'
import { useWorldMapStore } from '../../stores/world-map-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useEditorStore } from '../../stores/editor-store'
import { Button } from '../ui/Button'
import { NativeSelect } from '../ui/NativeSelect'
import { EmptyState } from '../ui/EmptyState'
import { confirm } from '../ui/Confirm'
import WorldMapCanvas from './WorldMapCanvas'
import WorldMapListView from './WorldMapListView'
import WorldMapNodeDialog from './WorldMapNodeDialog'
import WorldMapEdgeDialog from './WorldMapEdgeDialog'
import WorldMapCandidatesModal from './WorldMapCandidatesModal'
import WorldMapLayersDialog from './WorldMapLayersDialog'
import {
  type WorldMapNode,
  type WorldMapEdge,
  getWorldMapLayerName,
  WORLD_MAP_NODE_TYPE_LABELS,
  WORLD_MAP_EDGE_TYPE_LABELS,
} from '../../shared/world-map'

export default function WorldMapView({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(s => s.text)

  const nodes = useWorldMapStore(s => s.nodes)
  const edges = useWorldMapStore(s => s.edges)
  const layers = useWorldMapStore(s => s.layers)
  const candidates = useWorldMapStore(s => s.candidates)
  const selectedNodeId = useWorldMapStore(s => s.selectedNodeId)
  const selectedEdgeId = useWorldMapStore(s => s.selectedEdgeId)
  const activeLayer = useWorldMapStore(s => s.activeLayer)
  const viewMode = useWorldMapStore(s => s.viewMode)
  const candidatesLoading = useWorldMapStore(s => s.candidatesLoading)

  const loadAll = useWorldMapStore(s => s.loadAll)
  const loadCandidates = useWorldMapStore(s => s.loadCandidates)
  const upsertNode = useWorldMapStore(s => s.upsertNode)
  const deleteNode = useWorldMapStore(s => s.deleteNode)
  const upsertEdge = useWorldMapStore(s => s.upsertEdge)
  const deleteEdge = useWorldMapStore(s => s.deleteEdge)
  const upsertLayer = useWorldMapStore(s => s.upsertLayer)
  const deleteLayer = useWorldMapStore(s => s.deleteLayer)
  const reorderLayers = useWorldMapStore(s => s.reorderLayers)
  const confirmCandidate = useWorldMapStore(s => s.confirmCandidate)
  const dismissCandidate = useWorldMapStore(s => s.dismissCandidate)
  const setSelectedNodeId = useWorldMapStore(s => s.setSelectedNodeId)
  const setSelectedEdgeId = useWorldMapStore(s => s.setSelectedEdgeId)
  const setActiveLayer = useWorldMapStore(s => s.setActiveLayer)
  const setViewMode = useWorldMapStore(s => s.setViewMode)

  // Dialog state
  const [nodeDialogTarget, setNodeDialogTarget] = useState<WorldMapNode | null | 'new'>(null)
  const [edgeDialogTarget, setEdgeDialogTarget] = useState<WorldMapEdge | null | 'new'>(null)
  const [candidatesModalOpen, setCandidatesModalOpen] = useState(false)
  const [layersDialogOpen, setLayersDialogOpen] = useState(false)

  // Blueprint cache for chapter references
  const [blueprints, setBlueprints] = useState<Array<{ chapterNumber: number; title: string; keyEvents: string; purpose: string }>>([])

  useEffect(() => {
    if (projectKey) {
      void loadAll(projectKey)
      void loadCandidates(projectKey)
    }
  }, [projectKey, loadAll, loadCandidates])

  useEffect(() => {
    // Load blueprints to show associated chapters
    const loadBps = async () => {
      try {
        const { ipc } = await import('../../services/ipc-client')
        const list = await ipc.invoke('db:blueprint-get-all', projectKey)
        if (Array.isArray(list)) {
          setBlueprints(list.map(b => ({
            chapterNumber: b.chapterNumber,
            title: b.title || '',
            keyEvents: b.keyEvents || '',
            purpose: b.purpose || '',
          })))
        }
      } catch (e) {
        console.warn('[WorldMapView] load blueprints error:', e)
      }
    }
    if (projectKey) void loadBps()
  }, [projectKey])

  const selectedNode = nodes.find(n => n.id === selectedNodeId)
  const selectedEdge = edges.find(e => e.id === selectedEdgeId)
  const nodeCountByLayer = new Map<string, number>()
  for (const node of nodes) nodeCountByLayer.set(node.mapLayer, (nodeCountByLayer.get(node.mapLayer) ?? 0) + 1)

  // Associated chapters for selected node
  const associatedChapters = selectedNode
    ? blueprints.filter(b => (
      b.title.includes(selectedNode.name) ||
      b.keyEvents.includes(selectedNode.name) ||
      b.purpose.includes(selectedNode.name)
    ))
    : []

  const handleUpdateNodePosition = async (id: string, x: number, y: number) => {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    await upsertNode({ ...node, x, y }, projectKey)
  }

  const handleDeleteNodeConfirm = async (id: string) => {
    const target = nodes.find(n => n.id === id)
    const ok = await confirm(text(
      `确认删除节点「${target?.name || id}」？\n此操作会同时删除该节点的所有连接航路，子级节点将变为根节点。`,
      `Delete node “${target?.name || id}”? Connected edges will also be removed.`,
    ), {
      title: text('删除地图节点', 'Delete Map Node'),
      confirmText: text('删除', 'Delete'),
      danger: true,
    })
    if (ok) await deleteNode(id, projectKey)
  }

  const handleDeleteEdgeConfirm = async (id: string) => {
    const ok = await confirm(text(
      '确认删除该条连线航路？',
      'Delete this connection edge?',
    ), {
      title: text('删除连线', 'Delete Edge'),
      confirmText: text('删除', 'Delete'),
      danger: true,
    })
    if (ok) await deleteEdge(id, projectKey)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Top toolbar */}
      <div
        className="flex items-center justify-between gap-3 px-4 h-11 flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-panel)]"
      >
        <div className="flex items-center gap-2">
          <Compass size={17} style={{ color: 'var(--color-accent)' }} />
          <span className="font-semibold text-sm text-[var(--color-text)]">
            {text('世界地图', 'World Map')}
          </span>
          <span className="text-xs text-[var(--color-text-muted)] ml-1">
            {text(`${nodes.length} 个地点 · ${edges.length} 条航路`, `${nodes.length} nodes · ${edges.length} routes`)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Layer Filter */}
          <div className="flex items-center gap-1 text-xs">
            <Layers size={13} className="text-[var(--color-text-muted)]" />
            <NativeSelect
              className="h-7 text-xs"
              value={activeLayer}
              onChange={e => setActiveLayer(e.target.value)}
            >
              <option value="all">{text('全部层级', 'All Layers')}</option>
              {layers.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <Button size="sm" variant="outline" onClick={() => setLayersDialogOpen(true)} title={text('管理当前项目的地图图层', 'Manage project map layers')}>
            <Layers size={13} />
            <span>{text('管理图层', 'Layers')}</span>
          </Button>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-0.5 text-xs">
            <button
              type="button"
              className={`p-1 rounded ${viewMode === 'canvas' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              onClick={() => setViewMode('canvas')}
              title={text('画布视图', 'Canvas View')}
            >
              <MapIcon size={13} />
            </button>
            <button
              type="button"
              className={`p-1 rounded ${viewMode === 'list' ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              onClick={() => setViewMode('list')}
              title={text('列表视图', 'List View')}
            >
              <List size={13} />
            </button>
          </div>

          {/* Candidates button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCandidatesModalOpen(true)}
            title={text('查看从设定中扫描到的候选地点', 'View candidate locations scanned from settings')}
          >
            <Sparkles size={13} />
            <span>{text('待确认候选', 'Candidates')}</span>
            {candidates.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--color-accent)] text-white">
                {candidates.length}
              </span>
            )}
          </Button>

          {/* Add Edge */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEdgeDialogTarget('new')}
            disabled={nodes.length < 2}
            title={nodes.length < 2 ? text('至少需要两个节点才能连线', 'Requires at least 2 nodes') : undefined}
          >
            <ArrowRight size={13} />
            <span>{text('添加连线', 'Add Route')}</span>
          </Button>

          {/* Add Node */}
          <Button
            size="sm"
            variant="default"
            onClick={() => setNodeDialogTarget('new')}
          >
            <Plus size={13} />
            <span>{text('新建节点', 'New Node')}</span>
          </Button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {nodes.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <EmptyState
              icon={<Compass size={40} className="text-[var(--color-text-muted)]" />}
              message={text('尚未录入地图数据', 'No world map data recorded yet')}
            >
              <p className="text-xs text-[var(--color-text-muted)] max-w-md text-center mt-1">
                {text(
                  '系统遵守创作真实原则，不会臆造或自动填充地理信息。你可以手动录入地点与航路，或从已有资料中提取待确认候选。',
                  'The workbench respects narrative authenticity and never fabricates geography. Add nodes manually or extract candidates from your setting materials.',
                )}
              </p>
              <div className="flex items-center gap-2 mt-4">
                <Button variant="default" onClick={() => setNodeDialogTarget('new')}>
                  <Plus size={13} />
                  {text('手动添加节点', 'Add Node Manually')}
                </Button>
                {candidates.length > 0 && (
                  <Button variant="outline" onClick={() => setCandidatesModalOpen(true)}>
                    <Sparkles size={13} />
                    {text(`查看 ${candidates.length} 个候选地点`, `View ${candidates.length} Candidates`)}
                  </Button>
                )}
              </div>
            </EmptyState>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Canvas or List view */}
            <div className="flex-1 h-full overflow-hidden">
              {viewMode === 'canvas' ? (
                <WorldMapCanvas
                  nodes={nodes}
                  edges={edges}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  activeLayer={activeLayer}
                  onSelectNode={setSelectedNodeId}
                  onSelectEdge={setSelectedEdgeId}
                  onUpdateNodePosition={handleUpdateNodePosition}
                  onDoubleNodeClick={node => setNodeDialogTarget(node)}
                />
              ) : (
                <WorldMapListView
                  nodes={nodes}
                  edges={edges}
                  layers={layers}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onSelectNode={setSelectedNodeId}
                  onSelectEdge={setSelectedEdgeId}
                  onEditNode={node => setNodeDialogTarget(node)}
                  onDeleteNode={handleDeleteNodeConfirm}
                  onEditEdge={edge => setEdgeDialogTarget(edge)}
                  onDeleteEdge={handleDeleteEdgeConfirm}
                />
              )}
            </div>

            {/* Right-side Inspector Drawer when a Node or Edge is selected */}
            {(selectedNode || selectedEdge) && (
              <div
                className="w-72 flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col h-full overflow-hidden"
              >
                {selectedNode && (
                  <>
                    <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MapPin size={15} style={{ color: 'var(--color-accent)' }} />
                        <span className="font-semibold text-xs truncate text-[var(--color-text)]">
                          {selectedNode.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => setNodeDialogTarget(selectedNode)}
                          title={text('编辑节点', 'Edit Node')}
                        >
                          <Edit2 size={12} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-[var(--color-error)]"
                          onClick={() => handleDeleteNodeConfirm(selectedNode.id)}
                          title={text('删除节点', 'Delete Node')}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                      <div>
                        <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                          {text('基本信息', 'Basic Info')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-hover)] text-[var(--color-text)]">
                            {text(WORLD_MAP_NODE_TYPE_LABELS[selectedNode.type]?.zh || selectedNode.type, selectedNode.type)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                            {getWorldMapLayerName(layers, selectedNode.mapLayer)}
                          </span>
                        </div>
                      </div>

                      {selectedNode.description && (
                        <div>
                          <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                            {text('地理与设定描述', 'Description')}
                          </span>
                          <p className="text-xs text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap bg-[var(--color-bg)] p-2 rounded border border-[var(--color-border)]">
                            {selectedNode.description}
                          </p>
                        </div>
                      )}

                      {/* Source References */}
                      {selectedNode.sourceRefs && selectedNode.sourceRefs.length > 0 && (
                        <div>
                          <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                            {text('关联设定出处', 'Source References')}
                          </span>
                          <div className="space-y-1">
                            {selectedNode.sourceRefs.map((ref, idx) => (
                              <div
                                key={idx}
                                className="text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-bg)] px-2 py-1 rounded border border-[var(--color-border)] truncate"
                              >
                                {ref}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Connected Edges */}
                      <div>
                        <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                          {text('连接航路与关系', 'Connected Routes')}
                        </span>
                        {edges.filter(e => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id).length === 0 ? (
                          <span className="text-[11px] text-[var(--color-text-muted)]">
                            {text('暂无连接航路', 'No connected routes')}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {edges
                              .filter(e => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id)
                              .map(edge => {
                                const otherId = edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.fromNodeId
                                const otherNode = nodes.find(n => n.id === otherId)
                                return (
                                  <div
                                    key={edge.id}
                                    className="p-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[11px]"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-[var(--color-text)]">
                                        {otherNode?.name || otherId}
                                      </span>
                                      <span className="text-[10px] text-[var(--color-text-muted)]">
                                        {text(WORLD_MAP_EDGE_TYPE_LABELS[edge.type]?.zh || edge.type, edge.type)}
                                      </span>
                                    </div>
                                    {edge.description && (
                                      <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                                        {edge.description}
                                      </p>
                                    )}
                                  </div>
                                )
                              })}
                          </div>
                        )}
                      </div>

                      {/* Associated Chapters / Blueprints */}
                      <div>
                        <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                          {text('关联章节蓝图', 'Associated Chapters')}
                        </span>
                        {associatedChapters.length === 0 ? (
                          <span className="text-[11px] text-[var(--color-text-muted)]">
                            {text('蓝图中未显式提及该地点', 'Not explicitly mentioned in blueprints')}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {associatedChapters.map(ch => (
                              <button
                                key={ch.chapterNumber}
                                type="button"
                                className="w-full text-left p-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
                                onClick={() => {
                                  useEditorStore.getState().openFile({
                                    id: 'chapter-card-editor',
                                    name: text('章节蓝图', 'Chapter blueprints'),
                                    type: 'chapter-card',
                                    projectKey,
                                  })
                                }}
                              >
                                <div className="flex items-center gap-1 font-medium text-[11px] text-[var(--color-text)]">
                                  <BookOpen size={11} className="text-[var(--color-accent)]" />
                                  <span>第 {ch.chapterNumber} 章：{ch.title}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {selectedEdge && !selectedNode && (
                  <>
                    <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
                      <span className="font-semibold text-xs text-[var(--color-text)]">
                        {text('连线详情', 'Edge Details')}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => setEdgeDialogTarget(selectedEdge)}
                          title={text('编辑连线', 'Edit Edge')}
                        >
                          <Edit2 size={12} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-[var(--color-error)]"
                          onClick={() => handleDeleteEdgeConfirm(selectedEdge.id)}
                          title={text('删除连线', 'Delete Edge')}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>

                    <div className="p-3 space-y-3 text-xs">
                      <div className="flex items-center justify-between p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                        <span className="font-semibold">{nodes.find(n => n.id === selectedEdge.fromNodeId)?.name}</span>
                        <ArrowRight size={12} className="text-[var(--color-text-muted)]" />
                        <span className="font-semibold">{nodes.find(n => n.id === selectedEdge.toNodeId)?.name}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                          {text('关系类型', 'Type')}
                        </span>
                        <span>{text(WORLD_MAP_EDGE_TYPE_LABELS[selectedEdge.type]?.zh || selectedEdge.type, selectedEdge.type)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                          {text('状态', 'Status')}
                        </span>
                        <span>{selectedEdge.status}</span>
                      </div>
                      {selectedEdge.description && (
                        <div>
                          <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                            {text('说明', 'Description')}
                          </span>
                          <p className="text-xs text-[var(--color-text-secondary)]">{selectedEdge.description}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node Dialog */}
      {nodeDialogTarget && (
        <WorldMapNodeDialog
          open={Boolean(nodeDialogTarget)}
          node={nodeDialogTarget === 'new' ? null : nodeDialogTarget}
          existingNodes={nodes}
          layers={layers}
          onClose={() => setNodeDialogTarget(null)}
          onSave={node => upsertNode(node, projectKey)}
        />
      )}

      {/* Edge Dialog */}
      {edgeDialogTarget && (
        <WorldMapEdgeDialog
          open={Boolean(edgeDialogTarget)}
          edge={edgeDialogTarget === 'new' ? null : edgeDialogTarget}
          nodes={nodes}
          defaultFromNodeId={selectedNodeId}
          onClose={() => setEdgeDialogTarget(null)}
          onSave={edge => upsertEdge(edge, projectKey)}
        />
      )}

      {/* Candidates Modal */}
      <WorldMapCandidatesModal
        open={candidatesModalOpen}
        candidates={candidates}
        loading={candidatesLoading}
        onClose={() => setCandidatesModalOpen(false)}
        onConfirm={cand => confirmCandidate(cand, projectKey)}
        onDismiss={dismissCandidate}
        layers={layers}
      />
      <WorldMapLayersDialog
        open={layersDialogOpen}
        layers={layers}
        nodeCountByLayer={nodeCountByLayer}
        onClose={() => setLayersDialogOpen(false)}
        onUpsert={layer => upsertLayer(layer, projectKey)}
        onDelete={(id, fallbackLayerId) => deleteLayer(id, fallbackLayerId, projectKey)}
        onReorder={orderedIds => reorderLayers(orderedIds, projectKey)}
      />
    </div>
  )
}
