import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  ChevronRight,
  Compass,
  ImagePlus,
  Layers,
  List,
  Map as MapIcon,
  Network,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  getWorldMapBreadcrumb,
  type WorldMap,
  type WorldMapEdge,
} from '../../shared/world-map'
import { createMapDraft, useWorldMapStore, type WorldMapDeleteStrategy } from '../../stores/world-map-store'
import { useLocaleStore } from '../../stores/locale-store'
import { ipc } from '../../services/ipc-client'
import { Button } from '../ui/Button'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import WorldMapAtlasTree from './WorldMapAtlasTree'
import WorldMapCanvas from './WorldMapCanvas'
import WorldMapListView from './WorldMapListView'
import WorldMapNodeDialog from './WorldMapNodeDialog'
import WorldMapEdgeDialog from './WorldMapEdgeDialog'
import WorldMapCandidatesModal from './WorldMapCandidatesModal'
import WorldMapMapDialog from './WorldMapMapDialog'
import WorldMapDeleteDialog from './WorldMapDeleteDialog'
import {
  PlanningPageShell,
  PlanningPane,
  PlanningSearch,
  PlanningEmptyState,
} from '../planning/PlanningPageShell'
import { usePlanningBackPath } from '../planning/planning-navigation'

type MapDialogTarget =
  | { kind: 'create-top-level' }
  | { kind: 'create-child'; parentMapId: string }
  | null

/**
 * 多地图地图册。选中的地图是一个独立空间：主区域只显示它自己的图片、地点、
 * 地点层级与内部连接；地图之间只通过左侧地图册树和面包屑切换。
 */
export default function WorldMapView({ projectKey }: { projectKey: string }) {
  const text = useLocaleStore(s => s.text)
  const backPath = usePlanningBackPath()
  const maps = useWorldMapStore(s => s.maps)
  const nodes = useWorldMapStore(s => s.nodes)
  const edges = useWorldMapStore(s => s.edges)
  const candidates = useWorldMapStore(s => s.candidates)
  const migration = useWorldMapStore(s => s.migration)
  const selectedMapId = useWorldMapStore(s => s.selectedMapId)
  const selectedNodeId = useWorldMapStore(s => s.selectedNodeId)
  const selectedEdgeId = useWorldMapStore(s => s.selectedEdgeId)
  const viewMode = useWorldMapStore(s => s.viewMode)
  const candidatesLoading = useWorldMapStore(s => s.candidatesLoading)
  const focusNodeRequest = useWorldMapStore(s => s.focusNodeRequest)
  const consumeFocusNodeRequest = useWorldMapStore(s => s.consumeFocusNodeRequest)
  const loadAll = useWorldMapStore(s => s.loadAll)
  const loadCandidates = useWorldMapStore(s => s.loadCandidates)
  const upsertMap = useWorldMapStore(s => s.upsertMap)
  const deleteMap = useWorldMapStore(s => s.deleteMap)
  const reorderMaps = useWorldMapStore(s => s.reorderMaps)
  const acknowledgeMigration = useWorldMapStore(s => s.acknowledgeMigration)
  const upsertNode = useWorldMapStore(s => s.upsertNode)
  const deleteNode = useWorldMapStore(s => s.deleteNode)
  const upsertEdge = useWorldMapStore(s => s.upsertEdge)
  const deleteEdge = useWorldMapStore(s => s.deleteEdge)
  const confirmCandidate = useWorldMapStore(s => s.confirmCandidate)
  const dismissCandidate = useWorldMapStore(s => s.dismissCandidate)
  const setSelectedMapId = useWorldMapStore(s => s.setSelectedMapId)
  const setSelectedNodeId = useWorldMapStore(s => s.setSelectedNodeId)
  const setSelectedEdgeId = useWorldMapStore(s => s.setSelectedEdgeId)
  const setViewMode = useWorldMapStore(s => s.setViewMode)

  const [showAtlas, setShowAtlas] = useState(true)
  const [mapQuery, setMapQuery] = useState('')
  const [mapDialogTarget, setMapDialogTarget] = useState<MapDialogTarget>(null)
  const [nodeDialogTarget, setNodeDialogTarget] = useState<string | null | 'new'>(null)
  const [edgeDialogTarget, setEdgeDialogTarget] = useState<WorldMapEdge | null | 'new'>(null)
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorldMap | null>(null)
  /**
   * 图片始终与它所属的地图 id 一起保存，切换地图时无需清空状态：
   * 只要 id 不匹配就一律视为没有图片，绝不会把上一张地图的底图显示出来。
   */
  const [mapImageState, setMapImageState] = useState<{ mapId: string; dataUrl: string | null } | null>(null)
  const [importingImage, setImportingImage] = useState(false)

  useEffect(() => {
    void loadAll(projectKey)
    void loadCandidates(projectKey)
  }, [projectKey, loadAll, loadCandidates])

  // 世界资料跳转到某个地点时，无论作者上次停在哪一种视图，都切回画布并定位；
  // 否则「跳转到地图地点」只会落在列表页上。
  useEffect(() => {
    if (focusNodeRequest) setViewMode('canvas')
  }, [focusNodeRequest, setViewMode])

  const selectedMap = maps.find(map => map.id === selectedMapId) ?? null

  /** 只暴露当前地图自己的地点与连接。 */
  const mapNodes = useMemo(
    () => nodes.filter(node => node.mapId === selectedMapId),
    [nodes, selectedMapId],
  )
  const mapEdges = useMemo(
    () => edges.filter(edge => edge.mapId === selectedMapId),
    [edges, selectedMapId],
  )
  const nodeCountByMap = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of nodes) counts.set(node.mapId, (counts.get(node.mapId) ?? 0) + 1)
    return counts
  }, [nodes])
  const childMapsByParent = useMemo(() => {
    const children = new Map<string, WorldMap[]>()
    for (const map of maps) {
      if (!map.parentMapId) continue
      const bucket = children.get(map.parentMapId)
      if (bucket) bucket.push(map)
      else children.set(map.parentMapId, [map])
    }
    return children
  }, [maps])

  // 只同步外部系统（主进程托管的图片），并丢弃已经过期的那张地图的响应。
  useEffect(() => {
    if (!selectedMapId) return
    let cancelled = false
    void (async () => {
      try {
        const result = await ipc.invoke('world-map-image:get', selectedMapId, projectKey)
        if (cancelled) return
        setMapImageState({ mapId: selectedMapId, dataUrl: result.success ? result.dataUrl ?? null : null })
      } catch {
        if (!cancelled) setMapImageState({ mapId: selectedMapId, dataUrl: null })
      }
    })()
    return () => { cancelled = true }
  }, [selectedMapId, projectKey])

  const mapImage = mapImageState && mapImageState.mapId === selectedMapId ? mapImageState.dataUrl : null

  const importMapImage = async () => {
    if (!selectedMapId) return
    setImportingImage(true)
    try {
      const result = await ipc.invoke('world-map-image:select-and-import', selectedMapId, projectKey)
      if (result.cancelled) return
      if (!result.success || !result.dataUrl) throw new Error(result.error || 'import failed')
      setMapImageState({ mapId: selectedMapId, dataUrl: result.dataUrl })
      await loadAll(projectKey)
      toast.success(text('地图图片已导入这张地图', 'Map image imported for this map'))
    } catch {
      toast.error(text('导入地图图片失败', 'Could not import the map image'))
    } finally {
      setImportingImage(false)
    }
  }

  const removeMapImage = async () => {
    if (!selectedMapId || !mapImage) return
    const accepted = await confirm(text(
      `移除「${selectedMap?.name ?? ''}」的图片？这张地图的地点、层级和连接不受影响，其他地图的图片也不会被改动；你最初选择的原始图片不会被删除。`,
      `Remove the image from “${selectedMap?.name ?? ''}”? Its locations, hierarchy, and connections are unchanged, other maps keep their images, and your original file is not deleted.`,
    ), { title: text('移除地图图片', 'Remove map image'), confirmText: text('移除', 'Remove'), danger: true })
    if (!accepted) return
    const result = await ipc.invoke('world-map-image:remove', selectedMapId, projectKey)
    if (!result.success) {
      toast.error(result.error || text('移除地图图片失败', 'Could not remove the map image'))
      return
    }
    setMapImageState({ mapId: selectedMapId, dataUrl: null })
    await loadAll(projectKey)
  }

  const selectedNode = mapNodes.find(node => node.id === selectedNodeId)
  const selectedEdge = mapEdges.find(edge => edge.id === selectedEdgeId)
  const childNodes = useMemo(
    () => selectedNode ? mapNodes.filter(node => node.parentId === selectedNode.id) : [],
    [mapNodes, selectedNode],
  )

  const updateNodePosition = async (id: string, x: number, y: number) => {
    const node = nodes.find(item => item.id === id)
    if (node) await upsertNode({ ...node, x, y }, projectKey)
  }

  const removeNode = async (id: string) => {
    const node = nodes.find(item => item.id === id)
    const accepted = await confirm(text(
      `删除地点「${node?.name ?? id}」？与它的连接会一起删除，子地点会成为该地图的顶层地点。`,
      `Delete location “${node?.name ?? id}”? Its connections are removed and child locations become top-level locations on this map.`,
    ), { title: text('删除地点', 'Delete location'), confirmText: text('删除', 'Delete'), danger: true })
    if (accepted) await deleteNode(id, projectKey)
  }

  const removeEdge = async (id: string) => {
    const accepted = await confirm(text('删除这条地点连接？', 'Delete this location connection?'), {
      title: text('删除连接', 'Delete connection'), confirmText: text('删除', 'Delete'), danger: true,
    })
    if (accepted) await deleteEdge(id, projectKey)
  }

  const saveMapName = async (target: MapDialogTarget, name: string) => {
    if (!target) return false
    if (target.kind === 'create-top-level') {
      return upsertMap(createMapDraft(maps, name, null), projectKey)
    }
    return upsertMap(createMapDraft(maps, name, target.parentMapId), projectKey)
  }

  const deleteImpact = useMemo(() => {
    if (!deleteTarget) return { childMapCount: 0, descendantMapCount: 0, nodeCount: 0, edgeCount: 0, hasImage: false }
    const descendants = new Set<string>()
    const queue = [...(childMapsByParent.get(deleteTarget.id) ?? []).map(map => map.id)]
    while (queue.length > 0) {
      const current = queue.shift() as string
      if (descendants.has(current)) continue
      descendants.add(current)
      queue.push(...(childMapsByParent.get(current) ?? []).map(map => map.id))
    }
    return {
      childMapCount: (childMapsByParent.get(deleteTarget.id) ?? []).length,
      descendantMapCount: descendants.size,
      nodeCount: nodes.filter(node => node.mapId === deleteTarget.id).length,
      edgeCount: edges.filter(edge => edge.mapId === deleteTarget.id).length,
      hasImage: Boolean(deleteTarget.image),
    }
  }, [deleteTarget, childMapsByParent, nodes, edges])

  const breadcrumb = selectedMap ? getWorldMapBreadcrumb(maps, selectedMap.id) : []
  /**
   * 地图册树按名称筛选。
   *
   * 命中的地图会连同「祖先」和「全部后代」一起保留，因此筛选结果对父级是封闭的：
   * 任何保留下来的地图，它的父地图也一定在列表里，树的层级不会被筛断。
   */
  const atlasMaps = useMemo(() => {
    const query = mapQuery.trim().toLowerCase()
    if (!query) return maps
    const byId = new Map(maps.map(map => [map.id, map]))
    const included = new Set<string>()
    for (const map of maps) {
      if (!map.name.toLowerCase().includes(query)) continue
      included.add(map.id)
      let parentId = map.parentMapId
      while (parentId && byId.has(parentId) && !included.has(parentId)) {
        included.add(parentId)
        parentId = byId.get(parentId)?.parentMapId ?? null
      }
      const queue = maps.filter(child => child.parentMapId === map.id)
      while (queue.length > 0) {
        const child = queue.shift() as WorldMap
        if (included.has(child.id)) continue
        included.add(child.id)
        queue.push(...maps.filter(candidate => candidate.parentMapId === child.id))
      }
    }
    return maps.filter(map => included.has(map.id))
  }, [maps, mapQuery])
  const mapDialogTitle = mapDialogTarget?.kind === 'create-child'
    ? text('新建子地图', 'New child map')
    : text('新建顶层地图', 'New top-level map')
  const mapDialogHint = mapDialogTarget?.kind === 'create-child'
    ? text(
        `新地图会成为「${maps.find(map => map.id === mapDialogTarget.parentMapId)?.name ?? ''}」的子地图，并拥有自己的图片、地点与连接。`,
        `The new map becomes a child of “${maps.find(map => map.id === mapDialogTarget.parentMapId)?.name ?? ''}” with its own image, locations, and connections.`,
      )
    : text('顶层地图不从属于任何地图，可作为世界总图等根节点。', 'A top-level map belongs to no other map and can act as the atlas root.')

  return (
    <>
    <PlanningPageShell
      breadcrumb={[
        { label: backPath.overviewLabel, onClick: backPath.openOverview },
        { label: backPath.storySetupLabel, onClick: backPath.revealStorySetup },
        { label: backPath.worldSetupLabel, onClick: backPath.revealWorldSetup },
        { label: text('地图册', 'Map atlas') },
      ]}
      icon={<Compass size={15} />}
      title={text('地图册', 'Map atlas')}
      description={text(
        '空间地图册：每张地图是独立空间，各自拥有一张底图、一组地点、地点层级与内部连接，地图之间只通过左侧地图册树和面包屑切换。它描述的是地点与空间关系，不含剧情时间与伏笔。',
        'A spatial atlas: each map is an independent space with its own base image, locations, hierarchy, and internal connections. Maps switch only through the atlas tree and breadcrumb. It describes places and spatial relations, not plot time or setups.',
      )}
      meta={selectedMap
        ? text(
            `「${selectedMap.name}」：${mapNodes.length} 个地点 · ${mapEdges.length} 条连接 · 共 ${maps.length} 张地图`,
            `“${selectedMap.name}”: ${mapNodes.length} locations · ${mapEdges.length} connections · ${maps.length} maps total`,
          )
        : text(`共 ${maps.length} 张地图`, `${maps.length} maps`)}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setShowAtlas(value => !value)} title={text('显示或隐藏地图册树', 'Show or hide the atlas tree')}>
            <Layers size={13} />{text('管理地图', 'Manage maps')}
          </Button>
          <div className="planning-segmented" role="group" aria-label={text('地图视图', 'Map views')}>
            <button
              type="button"
              className={`planning-segmented__option${viewMode === 'canvas' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'canvas'}
              onClick={() => setViewMode('canvas')}
              title={text('画布视图', 'Canvas view')}
            >
              <MapIcon size={13} />{text('画布', 'Canvas')}
            </button>
            <button
              type="button"
              className={`planning-segmented__option${viewMode === 'list' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              title={text('地点列表', 'Location list')}
            >
              <List size={13} />{text('地点列表', 'Locations')}
            </button>
          </div>
          <Button size="sm" variant="outline" disabled={!selectedMap} onClick={() => void importMapImage()} title={text('为当前地图导入或替换图片', 'Import or replace this map’s image')}>
            <ImagePlus size={13} />{mapImage ? text('替换图片', 'Replace image') : text('导入图片', 'Import image')}
          </Button>
          {mapImage && <Button size="sm" variant="outline" disabled={!selectedMap} onClick={() => void removeMapImage()} title={text('移除当前地图的图片', 'Remove this map’s image')} aria-label={text('移除当前地图的图片', 'Remove this map’s image')}><Trash2 size={13} /></Button>}
          <Button size="sm" variant="outline" disabled={!selectedMap} onClick={() => setCandidatesOpen(true)} title={text('从已收录资料中挑选地点候选', 'Pick location candidates from reviewed sources')}><Sparkles size={13} />{text('地点候选', 'Candidates')}</Button>
          <Button size="sm" variant="outline" disabled={mapNodes.length < 2} onClick={() => setEdgeDialogTarget('new')} title={text('在当前地图内新建地点连接', 'Create a connection inside this map')}><ArrowRight size={13} />{text('新建连接', 'New connection')}</Button>
          <Button size="sm" disabled={!selectedMap} onClick={() => setNodeDialogTarget('new')} title={text('在当前地图内新建地点', 'Create a location in this map')}><Plus size={13} />{text('新建地点', 'New location')}</Button>
        </>
      }
      banner={migration && !migration.acknowledged
        ? (
          <div className="planning-page__banner flex-wrap items-center gap-2" style={{ backgroundColor: 'var(--color-hover)' }}>
            <Network size={13} className="flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
            <span style={{ color: 'var(--color-text)' }}>
              {text(
                `旧图层结构已迁移为 ${migration.mapCount} 张地图${migration.legacyLayerNames.length > 0 ? `（${migration.legacyLayerNames.join('、')}）` : ''}，${migration.nodeCount} 个地点保留在原坐标上。`,
                `Legacy layers were migrated into ${migration.mapCount} maps; ${migration.nodeCount} locations kept their original coordinates.`,
              )}
            </span>
            {migration.isolatedEdgeCount > 0 && (
              <span style={{ color: 'var(--color-warning-text)' }}>
                {text(
                  `其中 ${migration.isolatedEdgeCount} 条旧连接的两端分属不同地图，已安全隔离并且不会在任何地图上显示；原始记录仍然保留。`,
                  `${migration.isolatedEdgeCount} legacy connections linked different maps; they are quarantined and never displayed, and their records are preserved.`,
                )}
              </span>
            )}
            {migration.imageMigrated && (
              <span style={{ color: 'var(--color-text-muted)' }}>{text('旧项目底图已迁入对应的地图。', 'The legacy project image was moved into its map.')}</span>
            )}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void acknowledgeMigration(projectKey)}>{text('知道了', 'Got it')}</Button>
          </div>
        )
        : undefined}
    >
      {showAtlas && (
        <PlanningPane
          title={text('地图册', 'Atlas')}
          icon={<Layers size={12} />}
          width={252}
          actions={
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setMapDialogTarget({ kind: 'create-top-level' })}
              title={text('新建顶层地图', 'New top-level map')}
              aria-label={text('新建顶层地图', 'New top-level map')}
            >
              <Plus size={13} />
            </Button>
          }
          filters={
            maps.length > 1
              ? (
                <PlanningSearch
                  value={mapQuery}
                  onChange={setMapQuery}
                  placeholder={text('搜索地图名称…', 'Search map names…')}
                />
              )
              : undefined
          }
          footer={text(
            `共 ${maps.length} 张地图 · ${nodes.length} 个地点`,
            `${maps.length} maps · ${nodes.length} locations`,
          )}
        >
          <WorldMapAtlasTree
            maps={atlasMaps}
            selectedMapId={selectedMapId}
            nodeCountByMap={nodeCountByMap}
            onSelect={setSelectedMapId}
            onCreateTopLevel={() => setMapDialogTarget({ kind: 'create-top-level' })}
            onCreateChild={parentMapId => setMapDialogTarget({ kind: 'create-child', parentMapId })}
            onRename={(map, name) => void upsertMap({ ...map, name }, projectKey)}
            onMove={(map, siblings, offset) => {
              const index = siblings.findIndex(candidate => candidate.id === map.id)
              const target = index + offset
              if (index < 0 || target < 0 || target >= siblings.length) return
              const ids = siblings.map(candidate => candidate.id)
              ;[ids[index], ids[target]] = [ids[target], ids[index]]
              void reorderMaps(ids, projectKey)
            }}
            onDelete={setDeleteTarget}
          />
        </PlanningPane>
      )}

      <main className="planning-page__main">
        <div className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-xs" data-testid="world-map-breadcrumb">
          {breadcrumb.length === 0 ? (
            <span className="text-[var(--color-text-muted)]">{text('未选择地图', 'No map selected')}</span>
          ) : breadcrumb.map((map, index) => (
            <span key={map.id} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={12} className="flex-shrink-0 text-[var(--color-text-muted)]" />}
              {index === breadcrumb.length - 1 ? (
                <span className="truncate font-semibold text-[var(--color-text)]">{map.name}</span>
              ) : (
                <button type="button" className="truncate text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]" onClick={() => setSelectedMapId(map.id)}>{map.name}</button>
              )}
            </span>
          ))}
        </div>

        {maps.length === 0 ? (
          <div className="planning-page__scroll flex-1">
            <PlanningEmptyState
              icon={<MapIcon size={22} />}
              title={text('先新建一张地图', 'Create your first map')}
              description={text(
                '每张地图都是独立空间，可以分别导入一张图片，并在自己的内部建立地点、地点层级与连接。地图之间可组成父子层级。',
                'Each map is an independent space with its own image and its own locations, hierarchy, and connections. Maps can form a parent/child tree.',
              )}
              steps={[
                text('新建一张顶层地图（可作为世界总图）；', 'Create a top-level map (for example the world overview).'),
                text('给它导入一张底图，或直接建立地点；', 'Import a base image for it, or add locations directly.'),
                text('需要更细的层次时，再为它新建子地图。', 'When you need finer detail, create child maps under it.'),
              ]}
              actions={
                <Button onClick={() => setMapDialogTarget({ kind: 'create-top-level' })}>
                  <Plus size={13} />{text('新建顶层地图', 'New top-level map')}
                </Button>
              }
            />
          </div>
        // 即使还没有地点，已经导入的底图也必须进入画布；否则导入成功后会被
        // "这张地图还是空的" 的占位状态遮住。
        ) : mapNodes.length === 0 && mapEdges.length === 0 && !mapImage ? (
          <div className="planning-page__scroll flex-1">
            <PlanningEmptyState
              icon={<Compass size={22} />}
              title={text('这张地图还是空的', 'This map is still empty')}
              description={text(
                '可以先导入这张地图自己的图片，也可以直接建立地点。图片只是底图，地点仍按世界、区域、城市等层级组织。',
                'Import this map’s own image first, or create locations right away. The image is only a base map; locations are still organized as worlds, regions, and cities.',
              )}
              steps={[
                text('导入这张地图的图片（可选，仅作为底图）；', 'Import this map’s image (optional, used only as a base map).'),
                text('新建地点，并拖动到它在图片上的位置；', 'Create locations and drag them onto their positions.'),
                text('两个地点都建好后，用「新建连接」描述它们之间的关系。', 'Once two locations exist, use “New connection” to describe their relation.'),
              ]}
              actions={
                <>
                  <Button onClick={() => void importMapImage()} disabled={importingImage}><ImagePlus size={13} />{text('导入图片', 'Import image')}</Button>
                  <Button variant="outline" onClick={() => setNodeDialogTarget('new')}><Plus size={13} />{text('新建地点', 'New location')}</Button>
                </>
              }
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
              {viewMode === 'canvas'
                ? <WorldMapCanvas nodes={mapNodes} edges={mapEdges} selectedNodeId={selectedNodeId} selectedEdgeId={selectedEdgeId} backgroundImage={mapImage} layoutKey={showAtlas} focusNodeRequest={focusNodeRequest} onFocusHandled={consumeFocusNodeRequest} onSelectNode={setSelectedNodeId} onSelectEdge={setSelectedEdgeId} onUpdateNodePosition={updateNodePosition} onDoubleNodeClick={node => setNodeDialogTarget(node.id)} />
                : <WorldMapListView nodes={mapNodes} edges={mapEdges} selectedNodeId={selectedNodeId} selectedEdgeId={selectedEdgeId} onSelectNode={setSelectedNodeId} onSelectEdge={setSelectedEdgeId} onEditNode={node => setNodeDialogTarget(node.id)} onDeleteNode={removeNode} onEditEdge={edge => setEdgeDialogTarget(edge)} onDeleteEdge={removeEdge} />}
            </div>
            {(selectedNode || selectedEdge) && (
              <aside className="w-64 flex-shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-xs">
                {selectedNode && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate">{selectedNode.name}</strong>
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setNodeDialogTarget(selectedNode.id)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="ghost" onClick={() => void removeNode(selectedNode.id)}><Trash2 size={13} /></Button>
                      </span>
                    </div>
                    <p className="mt-2 text-[var(--color-text-muted)]">{text(`所属地图：${selectedMap?.name ?? ''}`, `Map: ${selectedMap?.name ?? ''}`)}</p>
                    {selectedNode.parentId && <p className="mt-1">{text(`上级地点：${mapNodes.find(node => node.id === selectedNode.parentId)?.name ?? selectedNode.parentId}`, `Parent: ${mapNodes.find(node => node.id === selectedNode.parentId)?.name ?? selectedNode.parentId}`)}</p>}
                    <p className="mt-1">{text(`下级地点：${childNodes.length}`, `Child locations: ${childNodes.length}`)}</p>
                    {selectedNode.description && <p className="mt-3 whitespace-pre-wrap rounded border border-[var(--color-border)] p-2">{selectedNode.description}</p>}
                  </>
                )}
                {selectedEdge && !selectedNode && (
                  <>
                    <div className="flex items-center justify-between">
                      <strong>{text('地点连接', 'Location connection')}</strong>
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEdgeDialogTarget(selectedEdge)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="ghost" onClick={() => void removeEdge(selectedEdge.id)}><Trash2 size={13} /></Button>
                      </span>
                    </div>
                    <p className="mt-3">{mapNodes.find(node => node.id === selectedEdge.fromNodeId)?.name} → {mapNodes.find(node => node.id === selectedEdge.toNodeId)?.name}</p>
                    <p className="mt-1 text-[var(--color-text-muted)]">{text('连接只存在于这张地图内部。', 'Connections only exist inside this map.')}</p>
                    {selectedEdge.description && <p className="mt-2 whitespace-pre-wrap">{selectedEdge.description}</p>}
                  </>
                )}
              </aside>
            )}
          </div>
        )}
      </main>
    </PlanningPageShell>

      <WorldMapMapDialog
        open={mapDialogTarget !== null}
        title={mapDialogTitle}
        hint={mapDialogHint}
        onClose={() => setMapDialogTarget(null)}
        onSave={name => saveMapName(mapDialogTarget, name)}
      />

      {nodeDialogTarget && selectedMap && (
        <WorldMapNodeDialog
          open
          node={nodeDialogTarget === 'new' ? null : mapNodes.find(node => node.id === nodeDialogTarget) ?? null}
          existingNodes={mapNodes}
          mapId={selectedMap.id}
          mapName={selectedMap.name}
          onClose={() => setNodeDialogTarget(null)}
          onSave={node => upsertNode(node, projectKey)}
        />
      )}

      {edgeDialogTarget && selectedMap && (
        <WorldMapEdgeDialog
          open
          edge={edgeDialogTarget === 'new' ? null : edgeDialogTarget}
          nodes={mapNodes}
          mapName={selectedMap.name}
          defaultFromNodeId={selectedNodeId}
          onClose={() => setEdgeDialogTarget(null)}
          onSave={edge => upsertEdge(edge, projectKey)}
        />
      )}

      <WorldMapCandidatesModal
        open={candidatesOpen}
        candidates={candidates}
        loading={candidatesLoading}
        targetMapName={selectedMap?.name ?? ''}
        onClose={() => setCandidatesOpen(false)}
        onConfirm={candidate => selectedMapId ? confirmCandidate(candidate, selectedMapId, projectKey) : Promise.resolve(false)}
        onDismiss={dismissCandidate}
      />

      <WorldMapDeleteDialog
        open={deleteTarget !== null}
        map={deleteTarget}
        impact={deleteImpact}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(strategy: WorldMapDeleteStrategy) => deleteTarget ? deleteMap(deleteTarget.id, strategy, projectKey) : Promise.resolve(false)}
      />
    </>
  )
}
