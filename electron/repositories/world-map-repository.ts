import { getProjectDb } from '../database'
import type {
  WorldMapNode,
  WorldMapEdge,
  WorldMapCandidate,
  WorldMapLayer,
  WorldMapNodeType,
  WorldMapEdgeType,
  WorldMapEdgeStatus,
} from '../../src/shared/world-map'

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

const LEGACY_LAYER_SEEDS: Array<Pick<WorldMapLayer, 'id' | 'name' | 'sortOrder'>> = [
  { id: 'surface', name: '主世界', sortOrder: 1 },
  { id: 'underground', name: '里世界', sortOrder: 2 },
  { id: 'astral', name: '星界', sortOrder: 3 },
]

function ensureProjectLayers(db: NonNullable<ReturnType<typeof getProjectDb>>): WorldMapLayer[] {
  const now = new Date().toISOString()
  const count = (db.prepare('SELECT COUNT(*) AS count FROM world_map_layers').get() as { count: number }).count
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO world_map_layers (id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const seed = db.transaction(() => {
      for (const layer of LEGACY_LAYER_SEEDS) insert.run(layer.id, layer.name, layer.sortOrder, now, now)
    })
    seed()
  }

  // A project created by an older version can have arbitrary legacy strings in map_layer.
  // Keep every existing location visible by materializing such values as editable layers.
  const knownIds = new Set((db.prepare('SELECT id FROM world_map_layers').all() as Array<{ id: string }>).map(row => row.id))
  const legacyIds = db.prepare(`
    SELECT DISTINCT map_layer AS id FROM world_map_nodes
    WHERE map_layer IS NOT NULL AND TRIM(map_layer) <> ''
  `).all() as Array<{ id: string }>
  let nextOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM world_map_layers').get() as { value: number }).value
  const insertLegacy = db.prepare(`
    INSERT OR IGNORE INTO world_map_layers (id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  for (const layer of legacyIds) {
    if (knownIds.has(layer.id)) continue
    nextOrder += 1
    insertLegacy.run(layer.id, layer.id, nextOrder, now, now)
  }

  return (db.prepare(`
    SELECT id, name, sort_order, created_at, updated_at
    FROM world_map_layers
    ORDER BY sort_order ASC, created_at ASC
  `).all() as Array<{ id: string; name: string; sort_order: number; created_at: string; updated_at: string }>)
    .map(row => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
}

function inferNodeType(name: string, description: string = ''): WorldMapNodeType {
  const text = (name + ' ' + description).toLowerCase()
  if (text.includes('世界') || text.includes('大陆') || text.includes('位面')) return 'world'
  if (text.includes('城') || text.includes('镇') || text.includes('港') || text.includes('要塞') || text.includes('堡')) return 'city'
  if (text.includes('遗境') || text.includes('遗迹') || text.includes('秘境') || text.includes('古墟') || text.includes('禁地') || text.includes('墓')) return 'relic'
  if (text.includes('航路') || text.includes('节点') || text.includes('通道') || text.includes('站') || text.includes('道标')) return 'route_node'
  if (text.includes('宗') || text.includes('派') || text.includes('会') || text.includes('教') || text.includes('盟') || text.includes('帝国') || text.includes('王朝') || text.includes('商会') || text.includes('势力')) return 'faction'
  if (text.includes('区') || text.includes('海') || text.includes('洋') || text.includes('荒原') || text.includes('森林') || text.includes('领') || text.includes('群岛')) return 'region'
  return 'landmark'
}

export class WorldMapRepository {
  static getAll(): { nodes: WorldMapNode[]; edges: WorldMapEdge[]; layers: WorldMapLayer[] } {
    const db = requireDb()
    const layers = ensureProjectLayers(db)
    const nodeRows = db.prepare(`
      SELECT id, name, type, description, parent_id, map_layer, x, y, source_refs, created_at, updated_at
      FROM world_map_nodes
      ORDER BY created_at ASC
    `).all() as Array<{
      id: string
      name: string
      type: string
      description: string
      parent_id: string | null
      map_layer: string
      x: number
      y: number
      source_refs: string
      created_at: string
      updated_at: string
    }>

    const edgeRows = db.prepare(`
      SELECT id, from_node_id, to_node_id, type, description, status, created_at, updated_at
      FROM world_map_edges
      ORDER BY created_at ASC
    `).all() as Array<{
      id: string
      from_node_id: string
      to_node_id: string
      type: string
      description: string
      status: string
      created_at: string
      updated_at: string
    }>

    const nodes: WorldMapNode[] = nodeRows.map(row => {
      let sourceRefs: string[] = []
      try {
        sourceRefs = JSON.parse(row.source_refs || '[]')
      } catch {
        sourceRefs = []
      }
      return {
        id: row.id,
        name: row.name,
        type: row.type as WorldMapNodeType,
        description: row.description,
        parentId: row.parent_id,
        mapLayer: row.map_layer,
        x: row.x,
        y: row.y,
        sourceRefs,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    })

    const edges: WorldMapEdge[] = edgeRows.map(row => ({
      id: row.id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      type: row.type as WorldMapEdgeType,
      description: row.description,
      status: row.status as WorldMapEdgeStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return { nodes, edges, layers }
  }

  static upsertLayer(layer: WorldMapLayer): WorldMapLayer {
    const db = requireDb()
    if (!layer.id.trim() || !layer.name.trim() || !Number.isFinite(layer.sortOrder)) {
      throw new Error('图层必须包含标识、名称与排序位置')
    }
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO world_map_layers (id, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(layer.id.trim(), layer.name.trim(), layer.sortOrder, layer.createdAt || now, now)
    return { ...layer, id: layer.id.trim(), name: layer.name.trim(), createdAt: layer.createdAt || now, updatedAt: now }
  }

  static deleteLayer(id: string, fallbackLayerId: string): void {
    const db = requireDb()
    if (!id || !fallbackLayerId || id === fallbackLayerId) {
      throw new Error('删除图层时必须指定另一个图层接收已有地点')
    }
    const fallbackExists = db.prepare('SELECT 1 FROM world_map_layers WHERE id = ?').get(fallbackLayerId)
    if (!fallbackExists) throw new Error('指定的迁移目标图层不存在')
    const tx = db.transaction(() => {
      db.prepare('UPDATE world_map_nodes SET map_layer = ? WHERE map_layer = ?').run(fallbackLayerId, id)
      db.prepare('DELETE FROM world_map_layers WHERE id = ?').run(id)
    })
    tx()
  }

  static reorderLayers(orderedIds: string[]): void {
    const db = requireDb()
    const uniqueIds = [...new Set(orderedIds.filter(Boolean))]
    const tx = db.transaction(() => {
      const update = db.prepare('UPDATE world_map_layers SET sort_order = ?, updated_at = ? WHERE id = ?')
      const now = new Date().toISOString()
      uniqueIds.forEach((id, index) => update.run(index + 1, now, id))
    })
    tx()
  }

  static upsertNode(node: WorldMapNode): WorldMapNode {
    const db = requireDb()
    if (!node.id || !node.name?.trim() || !node.type) {
      throw new Error('节点参数无效：必须包含 id, name, type')
    }
    const layers = ensureProjectLayers(db)
    const mapLayer = layers.some(layer => layer.id === node.mapLayer)
      ? node.mapLayer
      : layers[0]?.id
    if (!mapLayer) throw new Error('项目至少需要一个地图图层')
    const sourceRefsJson = JSON.stringify(node.sourceRefs || [])
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO world_map_nodes (id, name, type, description, parent_id, map_layer, x, y, source_refs, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        description = excluded.description,
        parent_id = excluded.parent_id,
        map_layer = excluded.map_layer,
        x = excluded.x,
        y = excluded.y,
        source_refs = excluded.source_refs,
        updated_at = excluded.updated_at
    `).run(
      node.id,
      node.name.trim(),
      node.type,
      node.description || '',
      node.parentId || null,
      mapLayer,
      node.x ?? 0,
      node.y ?? 0,
      sourceRefsJson,
      node.createdAt || now,
      now,
    )

    return {
      ...node,
      mapLayer,
      updatedAt: now,
      createdAt: node.createdAt || now,
    }
  }

  static deleteNode(id: string): void {
    const db = requireDb()
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM world_map_edges WHERE from_node_id = ? OR to_node_id = ?`).run(id, id)
      db.prepare(`UPDATE world_map_nodes SET parent_id = NULL WHERE parent_id = ?`).run(id)
      db.prepare(`DELETE FROM world_map_nodes WHERE id = ?`).run(id)
    })
    tx()
  }

  static upsertEdge(edge: WorldMapEdge): WorldMapEdge {
    const db = requireDb()
    if (!edge.id || !edge.fromNodeId || !edge.toNodeId || !edge.type) {
      throw new Error('连线参数无效：必须包含 id, fromNodeId, toNodeId, type')
    }
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO world_map_edges (id, from_node_id, to_node_id, type, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        from_node_id = excluded.from_node_id,
        to_node_id = excluded.to_node_id,
        type = excluded.type,
        description = excluded.description,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      edge.id,
      edge.fromNodeId,
      edge.toNodeId,
      edge.type,
      edge.description || '',
      edge.status || 'active',
      edge.createdAt || now,
      now,
    )

    return {
      ...edge,
      updatedAt: now,
      createdAt: edge.createdAt || now,
    }
  }

  static deleteEdge(id: string): void {
    const db = requireDb()
    db.prepare(`DELETE FROM world_map_edges WHERE id = ?`).run(id)
  }

  static extractCandidates(projectId?: string): WorldMapCandidate[] {
    const db = requireDb()
    const candidates: WorldMapCandidate[] = []
    const existingNodeNames = new Set(
      (db.prepare(`SELECT name FROM world_map_nodes`).all() as Array<{ name: string }>).map(r => r.name.toLowerCase().trim())
    )

    try {
      // 1. Scan from real approved workspace sources, rules, and fragments
      const hasWorkspace = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_sources'`).get()
      if (hasWorkspace) {
        const rules = db.prepare(`
          SELECT
            r.id,
            r.title,
            r.content,
            s.relative_path,
            s.category
          FROM workspace_source_snapshot_rules r
          INNER JOIN workspace_sources s
            ON s.id = r.source_id
            AND s.approved_snapshot_id = r.snapshot_id
          WHERE s.approved_snapshot_id IS NOT NULL
            AND s.approved_snapshot_id <> ''
            AND s.import_status = 'imported'
            AND s.is_disabled = 0
            AND s.is_missing = 0
            AND (? IS NULL OR s.project_id = ?)
          ORDER BY s.relative_path, r.id
          LIMIT 200
        `).all(projectId ?? null, projectId ?? null) as Array<{
          id: string
          title: string
          content: string
          relative_path: string
          category: string
        }>

        for (const rule of rules) {
          const rawTitle = (rule.title || '').trim()
          if (!rawTitle || rawTitle.length < 2) continue
          const cleanName = rawTitle.replace(/^#+\s*/, '').replace(/^[0-9]+[、. ]*/, '').trim()
          if (!cleanName || cleanName.length < 2 || cleanName.length > 30 || existingNodeNames.has(cleanName.toLowerCase())) continue

          const type = inferNodeType(cleanName, rule.content)
          const suggestedLayer = (
            rule.relative_path?.includes('里世界') ||
            cleanName.includes('里世界') ||
            cleanName.includes('深层') ||
            cleanName.includes('界隙')
          ) ? 'underground' : 'surface'

          candidates.push({
            id: `cand-${rule.id}`,
            name: cleanName,
            type,
            description: (rule.content || '').slice(0, 200),
            sourceRef: rule.relative_path || rule.id,
            suggestedLayer,
          })
          existingNodeNames.add(cleanName.toLowerCase())
        }

        const fragments = db.prepare(`
          SELECT
            f.id,
            f.heading_path,
            f.content,
            s.relative_path
          FROM workspace_source_snapshot_fragments f
          INNER JOIN workspace_sources s
            ON s.id = f.source_id
            AND s.approved_snapshot_id = f.snapshot_id
          WHERE s.approved_snapshot_id IS NOT NULL
            AND s.approved_snapshot_id <> ''
            AND s.import_status = 'imported'
            AND s.is_disabled = 0
            AND s.is_missing = 0
            AND (
              s.category IN ('world_data', 'reference', 'material')
              OR s.relative_path LIKE '%里世界%'
              OR s.relative_path LIKE '%探索%'
              OR s.relative_path LIKE '%地图%'
              OR s.relative_path LIKE '%地理%'
            )
            AND (? IS NULL OR s.project_id = ?)
          ORDER BY s.relative_path, f.start_line
          LIMIT 200
        `).all(projectId ?? null, projectId ?? null) as Array<{
          id: string
          heading_path: string
          content: string
          relative_path: string
        }>

        for (const frag of fragments) {
          const heading = (frag.heading_path || '').split('/').pop()?.trim() || ''
          const cleanName = heading.replace(/^#+\s*/, '').replace(/^[0-9]+[、. ]*/, '').trim()
          if (!cleanName || cleanName.length < 2 || cleanName.length > 30 || existingNodeNames.has(cleanName.toLowerCase())) continue

          const type = inferNodeType(cleanName, frag.content)
          const suggestedLayer = (
            frag.relative_path?.includes('里世界') ||
            cleanName.includes('里世界') ||
            cleanName.includes('深层') ||
            cleanName.includes('界隙')
          ) ? 'underground' : 'surface'

          candidates.push({
            id: `cand-frag-${frag.id}`,
            name: cleanName,
            type,
            description: (frag.content || '').slice(0, 200),
            sourceRef: `${frag.relative_path} (${heading})`,
            suggestedLayer,
          })
          existingNodeNames.add(cleanName.toLowerCase())
        }
      }

      // 2. Scan from project_core.worldbuilding if table exists
      const hasCore = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_core'`).get()
      if (hasCore) {
        const core = db.prepare(`SELECT worldbuilding FROM project_core WHERE id = 'main'`).get() as { worldbuilding?: string } | undefined
        if (core?.worldbuilding) {
          const lines = core.worldbuilding.split('\n')
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            if (line.startsWith('#') || line.startsWith('【') || line.startsWith('###')) {
              const cleanName = line.replace(/^[#【[\s]+/, '').replace(/[】\]]+$/, '').trim()
              if (cleanName.length >= 2 && cleanName.length <= 25 && !existingNodeNames.has(cleanName.toLowerCase())) {
                let desc = ''
                for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
                  if (lines[j].trim()) {
                    desc = lines[j].trim()
                    break
                  }
                }
                const type = inferNodeType(cleanName, desc)
                candidates.push({
                  id: `cand-wb-${candidates.length + 1}`,
                  name: cleanName,
                  type,
                  description: desc.slice(0, 200),
                  sourceRef: '项目设定: 故事架构/世界观',
                  suggestedLayer: 'surface',
                })
                existingNodeNames.add(cleanName.toLowerCase())
              }
            }
          }
        }
      }

      return candidates
    } catch (error) {
      throw new Error(`[WorldMapRepository] 提取地图候选节点失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
