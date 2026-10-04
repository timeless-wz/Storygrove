import { getProjectDb } from '../database'
import {
  collectMapWorldBlockers,
  collectNodeWorldReferences,
  hasWorldWorkbenchTables,
} from './world-workbench-repository'
import {
  isSafeWorldMapId,
  isWorldMapMarkerIcon,
  type WorldMap,
  type WorldMapAtlas,
  type WorldMapCandidate,
  type WorldMapEdge,
  type WorldMapEdgeStatus,
  type WorldMapEdgeType,
  type WorldMapImage,
  type WorldMapMigrationReport,
  type WorldMapNode,
  type WorldMapNodeType,
} from '../../src/shared/world-map'
import type { WorldDeleteBlocker } from '../../src/shared/world-workbench'

function requireDb(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  return db
}

const MIGRATION_ID = 'world-map-atlas-v1'

/** 删除一张地图时必须显式选择对子地图的处理方式，禁止静默级联。 */
export type WorldMapDeleteStrategy = 'promote-children' | 'cascade'

export interface WorldMapDeletePlan {
  /** 本次真正被删除的地图（cascade 含整棵子树）。 */
  mapIds: string[]
  /** 直接子地图；promote 策略下它们会改挂到被删地图的父地图。 */
  childMapIds: string[]
  nodeCount: number
  edgeCount: number
  /** 需要随之清理的项目托管图片副本。 */
  images: Array<{ mapId: string; fileName: string }>
  /**
   * 世界资料（出生地、目前所在地、秘境位置、势力驻地、规则范围、通道端点、
   * 人物行踪）对这些地图地点的引用。非空时删除被默认阻止。
   */
  worldReferences: WorldDeleteBlocker[]
}

/** 地点删除的影响预览：原有级联之外补充世界资料引用。 */
export interface WorldMapNodeDeletePlan {
  nodeId: string
  nodeName: string
  /** 会随地点一起被删除的同图连线数量。 */
  edgeCount: number
  /** 会失去父级而提升到顶层的地点数量。 */
  childNodeCount: number
  worldReferences: WorldDeleteBlocker[]
}

interface MapRow {
  id: string
  name: string
  parent_map_id: string | null
  sort_order: number
  image_file_name: string | null
  image_mime_type: string | null
  image_bytes: number | null
  world_id?: string | null
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: string
  name: string
  type: string
  marker_icon: string | null
  description: string
  parent_id: string | null
  map_id: string
  x: number
  y: number
  source_refs: string
  created_at: string
  updated_at: string
}

function toMap(row: MapRow): WorldMap {
  const image: WorldMapImage | null = row.image_file_name && row.image_mime_type && row.image_bytes
    ? {
        fileName: row.image_file_name,
        mimeType: row.image_mime_type,
        bytes: row.image_bytes,
        updatedAt: row.updated_at,
      }
    : null
  return {
    id: row.id,
    name: row.name,
    parentMapId: row.parent_map_id,
    sortOrder: row.sort_order,
    image,
    worldId: row.world_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 旧库可能尚未补出 world_id 列；按列是否存在动态选取，读取保持可用。 */
function mapSelectColumns(db: NonNullable<ReturnType<typeof getProjectDb>>): string {
  const base = 'id, name, parent_map_id, sort_order, image_file_name, image_mime_type, image_bytes, created_at, updated_at'
  return hasWorldWorkbenchTables(db) ? `${base}, world_id` : base
}

function listMaps(db: NonNullable<ReturnType<typeof getProjectDb>>): WorldMap[] {
  const rows = db.prepare(`
    SELECT ${mapSelectColumns(db)}
    FROM world_maps
    ORDER BY sort_order ASC, created_at ASC
  `).all() as MapRow[]
  return rows.map(toMap)
}

function requireMap(db: NonNullable<ReturnType<typeof getProjectDb>>, mapId: string): WorldMap {
  const row = db.prepare(`
    SELECT ${mapSelectColumns(db)}
    FROM world_maps WHERE id = ?
  `).get(mapId) as MapRow | undefined
  if (!row) throw new Error('地点必须绑定一张存在的地图')
  return toMap(row)
}

/** 地图树不允许成环，否则面包屑与删除子树都会失控。 */
function assertNoMapCycle(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  mapId: string,
  parentMapId: string | null,
): void {
  if (!parentMapId) return
  if (parentMapId === mapId) throw new Error('地图不能以自己为父地图')
  const parentById = new Map(
    (db.prepare('SELECT id, parent_map_id FROM world_maps').all() as Array<{ id: string; parent_map_id: string | null }>)
      .map(row => [row.id, row.parent_map_id]),
  )
  if (!parentById.has(parentMapId)) throw new Error('父地图不存在')
  const seen = new Set<string>()
  let cursor: string | null = parentMapId
  while (cursor && !seen.has(cursor)) {
    if (cursor === mapId) throw new Error('地图层级不能形成环')
    seen.add(cursor)
    cursor = parentById.get(cursor) ?? null
  }
}

/** 地点父级也必须留在同一张地图内，跨地图层级同样被禁止。 */
function assertNodeParentWithinMap(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  nodeId: string,
  parentId: string | null,
  mapId: string,
): void {
  if (!parentId) return
  if (parentId === nodeId) throw new Error('地点不能以自己为父地点')
  const parent = db.prepare('SELECT map_id FROM world_map_nodes WHERE id = ?').get(parentId) as { map_id: string } | undefined
  if (!parent) throw new Error('父地点不存在')
  if (parent.map_id !== mapId) throw new Error('父地点必须与当前地点属于同一张地图')
  const parentById = new Map(
    (db.prepare('SELECT id, parent_id FROM world_map_nodes WHERE map_id = ?').all(mapId) as Array<{ id: string; parent_id: string | null }>)
      .map(row => [row.id, row.parent_id]),
  )
  const seen = new Set<string>()
  let cursor: string | null = parentId
  while (cursor && !seen.has(cursor)) {
    if (cursor === nodeId) throw new Error('地点层级不能形成环')
    seen.add(cursor)
    cursor = parentById.get(cursor) ?? null
  }
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

function mapDeletePlan(
  db: NonNullable<ReturnType<typeof getProjectDb>>,
  mapId: string,
  strategy: WorldMapDeleteStrategy,
): WorldMapDeletePlan {
  const maps = listMaps(db)
  const ids = new Set(maps.map(map => map.id))
  if (!ids.has(mapId)) throw new Error('要删除的地图不存在')

  const childrenByParent = new Map<string, string[]>()
  for (const map of maps) {
    if (!map.parentMapId || !ids.has(map.parentMapId)) continue
    const bucket = childrenByParent.get(map.parentMapId)
    if (bucket) bucket.push(map.id)
    else childrenByParent.set(map.parentMapId, [map.id])
  }

  const childMapIds = childrenByParent.get(mapId) ?? []
  const removed = new Set<string>([mapId])
  if (strategy === 'cascade') {
    const queue = [...childMapIds]
    while (queue.length > 0) {
      const current = queue.shift() as string
      if (removed.has(current)) continue
      removed.add(current)
      queue.push(...(childrenByParent.get(current) ?? []))
    }
  }

  const removedIds = [...removed]
  const placeholders = removedIds.map(() => '?').join(', ')
  const nodeCount = (db.prepare(`
    SELECT COUNT(*) AS count FROM world_map_nodes WHERE map_id IN (${placeholders})
  `).get(...removedIds) as { count: number }).count
  const edgeCount = (db.prepare(`
    SELECT COUNT(*) AS count FROM world_map_edges
    WHERE from_node_id IN (SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders}))
       OR to_node_id IN (SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders}))
  `).get(...removedIds, ...removedIds) as { count: number }).count

  const images = maps
    .filter(map => removed.has(map.id) && map.image)
    .map(map => ({ mapId: map.id, fileName: (map.image as WorldMapImage).fileName }))

  return {
    mapIds: removedIds,
    childMapIds,
    nodeCount,
    edgeCount,
    images,
    worldReferences: hasWorldWorkbenchTables(db) ? collectMapWorldBlockers(db, removedIds) : [],
  }
}

export class WorldMapRepository {
  /** 一次读取地图册树、全部地点与未被隔离的连接。 */
  static getAll(): WorldMapAtlas {
    const db = requireDb()
    const maps = listMaps(db)

    const nodeRows = db.prepare(`
      SELECT id, name, type, marker_icon, description, parent_id, map_id, x, y, source_refs, created_at, updated_at
      FROM world_map_nodes
      ORDER BY created_at ASC
    `).all() as NodeRow[]

    const edgeRows = db.prepare(`
      SELECT id, from_node_id, to_node_id, type, description, status, map_id, created_at, updated_at
      FROM world_map_edges
      WHERE map_id IS NOT NULL
      ORDER BY created_at ASC
    `).all() as Array<{
      id: string
      from_node_id: string
      to_node_id: string
      type: string
      description: string
      status: string
      map_id: string | null
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
        markerIcon: isWorldMapMarkerIcon(row.marker_icon) ? row.marker_icon : null,
        description: row.description,
        parentId: row.parent_id,
        mapId: row.map_id,
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
      mapId: row.map_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return { maps, nodes, edges, migration: WorldMapRepository.getMigrationReport() }
  }

  static upsertMap(map: WorldMap): WorldMap {
    const db = requireDb()
    if (!isSafeWorldMapId(map.id)) throw new Error('地图标识无效')
    const name = map.name?.trim()
    if (!name) throw new Error('地图必须包含名称')
    if (!Number.isFinite(map.sortOrder)) throw new Error('地图必须包含排序位置')
    const parentMapId = map.parentMapId || null
    assertNoMapCycle(db, map.id, parentMapId)

    const now = new Date().toISOString()
    const existing = db.prepare('SELECT created_at, image_file_name, image_mime_type, image_bytes FROM world_maps WHERE id = ?')
      .get(map.id) as { created_at: string; image_file_name: string | null; image_mime_type: string | null; image_bytes: number | null } | undefined

    const keepImage = Boolean(existing?.image_file_name)
    db.prepare(`
      INSERT INTO world_maps (
        id, name, parent_map_id, sort_order,
        image_file_name, image_mime_type, image_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        parent_map_id = excluded.parent_map_id,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(
      map.id,
      name,
      parentMapId,
      map.sortOrder,
      keepImage ? existing?.image_file_name ?? null : null,
      keepImage ? existing?.image_mime_type ?? null : null,
      keepImage ? existing?.image_bytes ?? null : null,
      existing?.created_at ?? (map.createdAt || now),
      now,
    )

    const saved = requireMap(db, map.id)
    if (saved.image && saved.image.mimeType && saved.image.bytes) return { ...saved, createdAt: existing?.created_at ?? now }
    return { ...saved, createdAt: existing?.created_at ?? now }
  }

  /** 只改地图图片元数据；图片文件本体由主进程的图片存储服务管理。 */
  static saveMapImage(mapId: string, image: WorldMapImage | null): void {
    const db = requireDb()
    requireMap(db, mapId)
    const now = new Date().toISOString()
    if (!image) {
      db.prepare(`
        UPDATE world_maps SET image_file_name = NULL, image_mime_type = NULL, image_bytes = NULL, updated_at = ? WHERE id = ?
      `).run(now, mapId)
      return
    }
    if (!Number.isSafeInteger(image.bytes) || image.bytes <= 0) throw new Error('地图图片元数据无效')
    db.prepare(`
      UPDATE world_maps SET image_file_name = ?, image_mime_type = ?, image_bytes = ?, updated_at = ? WHERE id = ?
    `).run(image.fileName, image.mimeType, image.bytes, now, mapId)
  }

  static planMapDelete(mapId: string, strategy: WorldMapDeleteStrategy): WorldMapDeletePlan {
    return mapDeletePlan(requireDb(), mapId, strategy)
  }

  /**
   * 删除一张地图。子地图要么改挂到被删地图的父地图（promote-children），要么
   * 整棵子树一起删除（cascade）；两种情况都会同时删除该地图内部的地点、连接
   * 与其项目托管图片副本。调用方必须先把计划展示给作者。
   */
  static deleteMap(
    mapId: string,
    strategy: WorldMapDeleteStrategy,
    options: { allowWorldReferenceBreak?: boolean } = {},
  ): WorldMapDeletePlan {
    const db = requireDb()
    if (strategy !== 'promote-children' && strategy !== 'cascade') {
      throw new Error('删除地图必须显式指定对子地图的处理方式')
    }
    const plan = mapDeletePlan(db, mapId, strategy)
    // 世界资料引用默认阻止破坏性删除：删除地点不会删除秘境或势力资料，
    // 但会让它们的引用悬空，因此必须由作者先显式处理。
    if (plan.worldReferences.length > 0 && !options.allowWorldReferenceBreak) {
      const total = plan.worldReferences.reduce((sum, item) => sum + item.count, 0)
      throw new Error(`该地图的地点仍被 ${total} 项世界资料引用（出生地、位置、秘境、驻地、规则、通道、行踪），已拒绝删除；请先解除这些引用`)
    }
    const removed = new Set(plan.mapIds)
    const parentMapId = (db.prepare('SELECT parent_map_id FROM world_maps WHERE id = ?').get(mapId) as { parent_map_id: string | null })
      .parent_map_id
    const now = new Date().toISOString()

    const tx = db.transaction(() => {
      for (const childMapId of plan.childMapIds) {
        if (removed.has(childMapId)) continue
        db.prepare('UPDATE world_maps SET parent_map_id = ?, updated_at = ? WHERE id = ?')
          .run(parentMapId, now, childMapId)
      }
      const placeholders = plan.mapIds.map(() => '?').join(', ')
      // 连接只在所属地图内部成立，因此随地点一起清理，绝不留下跨地图悬空行。
      db.prepare(`
        DELETE FROM world_map_edges
        WHERE from_node_id IN (SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders}))
           OR to_node_id IN (SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders}))
      `).run(...plan.mapIds, ...plan.mapIds)
      db.prepare(`
        UPDATE world_map_nodes SET parent_id = NULL
        WHERE parent_id IN (SELECT id FROM world_map_nodes WHERE map_id IN (${placeholders}))
      `).run(...plan.mapIds)
      db.prepare(`DELETE FROM world_map_nodes WHERE map_id IN (${placeholders})`).run(...plan.mapIds)
      db.prepare(`DELETE FROM world_maps WHERE id IN (${placeholders})`).run(...plan.mapIds)
    })
    tx()

    return plan
  }

  /** 只在同一父地图的兄弟之间重排；跨层级排序由地图自己的 sortOrder 维持。 */
  static reorderMaps(orderedIds: string[]): void {
    const db = requireDb()
    const uniqueIds = [...new Set(orderedIds.filter(Boolean))]
    const now = new Date().toISOString()
    const tx = db.transaction(() => {
      const update = db.prepare('UPDATE world_maps SET sort_order = ?, updated_at = ? WHERE id = ?')
      uniqueIds.forEach((id, index) => update.run(index + 1, now, id))
    })
    tx()
  }

  static upsertNode(node: WorldMapNode): WorldMapNode {
    const db = requireDb()
    if (!node.id || !node.name?.trim() || !node.type) {
      throw new Error('地点参数无效：必须包含 id, name, type')
    }
    if (node.mapId) {
      if (!isSafeWorldMapId(node.mapId)) throw new Error('地点地图标识无效')
      requireMap(db, node.mapId)
      assertNodeParentWithinMap(db, node.id, node.parentId || null, node.mapId)
    } else if (node.parentId) {
      throw new Error('未关联地图的地点暂不能设置地图内层级')
    }
    if (node.markerIcon != null && !isWorldMapMarkerIcon(node.markerIcon)) {
      throw new Error('地图标识图标无效')
    }
    return db.transaction(() => {
      // 旧调用方仅更新坐标等字段时保留作者已选图标；显式 null 才恢复默认。
      const existing = db.prepare('SELECT marker_icon, updated_at FROM world_map_nodes WHERE id = ?')
        .get(node.id) as { marker_icon: string | null; updated_at: string } | undefined
      if (node.expectedUpdatedAt !== undefined) {
        if (node.expectedUpdatedAt === null ? !!existing : existing?.updated_at !== node.expectedUpdatedAt) {
          throw new Error('地点已在其他位置更新，请重新读取后再保存')
        }
      }
      const markerIcon = node.markerIcon === undefined
        ? (isWorldMapMarkerIcon(existing?.marker_icon) ? existing.marker_icon : null)
        : node.markerIcon

      const sourceRefsJson = JSON.stringify(node.sourceRefs || [])
      const now = new Date().toISOString()

      db.prepare(`
        INSERT INTO world_map_nodes (id, name, type, marker_icon, description, parent_id, map_id, x, y, source_refs, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          marker_icon = excluded.marker_icon,
          description = excluded.description,
          parent_id = excluded.parent_id,
          map_id = excluded.map_id,
          x = excluded.x,
          y = excluded.y,
          source_refs = excluded.source_refs,
          updated_at = excluded.updated_at
      `).run(
        node.id,
        node.name.trim(),
        node.type,
        markerIcon,
        node.description || '',
        node.parentId || null,
        node.mapId,
        node.x ?? 0,
        node.y ?? 0,
        sourceRefsJson,
        node.createdAt || now,
        now,
      )

      return {
        ...node,
        markerIcon,
        updatedAt: now,
        createdAt: node.createdAt || now,
      }
    })()
  }

  /** 删除地点前的影响预览：世界资料引用、同图连线与子地点。 */
  static planNodeDelete(id: string): WorldMapNodeDeletePlan {
    const db = requireDb()
    const node = db.prepare('SELECT id, name FROM world_map_nodes WHERE id = ?').get(id) as
      | { id: string; name: string }
      | undefined
    if (!node) throw new Error('要删除的地点不存在')
    const edgeCount = (db.prepare(
      'SELECT COUNT(*) AS count FROM world_map_edges WHERE from_node_id = ? OR to_node_id = ?',
    ).get(id, id) as { count: number }).count
    const childNodeCount = (db.prepare(
      'SELECT COUNT(*) AS count FROM world_map_nodes WHERE parent_id = ?',
    ).get(id) as { count: number }).count
    const references = hasWorldWorkbenchTables(db) ? collectNodeWorldReferences(db, [id]) : []
    return {
      nodeId: node.id,
      nodeName: node.name,
      edgeCount,
      childNodeCount,
      worldReferences: references.map(reference => ({
        kind: reference.kind,
        label: reference.label,
        count: reference.ids.length,
        ids: reference.ids,
      })),
    }
  }

  static deleteNode(id: string, options: { allowWorldReferenceBreak?: boolean } = {}): void {
    const db = requireDb()
    const plan = WorldMapRepository.planNodeDelete(id)
    if (plan.worldReferences.length > 0 && !options.allowWorldReferenceBreak) {
      const total = plan.worldReferences.reduce((sum, item) => sum + item.count, 0)
      throw new Error(`「${plan.nodeName}」仍被 ${total} 项世界资料引用，已拒绝删除；请先解除这些引用`)
    }
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM world_map_edges WHERE from_node_id = ? OR to_node_id = ?`).run(id, id)
      db.prepare(`UPDATE world_map_nodes SET parent_id = NULL WHERE parent_id = ?`).run(id)
      db.prepare(`DELETE FROM world_map_nodes WHERE id = ?`).run(id)
    })
    tx()
  }

  /**
   * 连接的归属地图由两个端点推导，写入方无法伪造。两端不在同一张地图时直接拒绝，
   * 这是「禁止跨地图连接」的唯一执行点。
   */
  static upsertEdge(edge: WorldMapEdge): WorldMapEdge {
    const db = requireDb()
    if (!edge.id || !edge.fromNodeId || !edge.toNodeId || !edge.type) {
      throw new Error('连接参数无效：必须包含 id, fromNodeId, toNodeId, type')
    }
    const from = db.prepare('SELECT map_id, name FROM world_map_nodes WHERE id = ?')
      .get(edge.fromNodeId) as { map_id: string; name: string } | undefined
    const to = db.prepare('SELECT map_id, name FROM world_map_nodes WHERE id = ?')
      .get(edge.toNodeId) as { map_id: string; name: string } | undefined
    if (!from || !to) throw new Error('地点连接的两端都必须是已存在的地图地点')
    if (from.map_id !== to.map_id) {
      throw new Error(`禁止跨地图连接：「${from.name}」与「${to.name}」不在同一张地图`)
    }
    requireMap(db, from.map_id)

    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO world_map_edges (id, from_node_id, to_node_id, type, description, status, map_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        from_node_id = excluded.from_node_id,
        to_node_id = excluded.to_node_id,
        type = excluded.type,
        description = excluded.description,
        status = excluded.status,
        map_id = excluded.map_id,
        updated_at = excluded.updated_at
    `).run(
      edge.id,
      edge.fromNodeId,
      edge.toNodeId,
      edge.type,
      edge.description || '',
      edge.status || 'active',
      from.map_id,
      edge.createdAt || now,
      now,
    )

    return {
      ...edge,
      mapId: from.map_id,
      updatedAt: now,
      createdAt: edge.createdAt || now,
    }
  }

  static deleteEdge(id: string): void {
    const db = requireDb()
    db.prepare(`DELETE FROM world_map_edges WHERE id = ?`).run(id)
  }

  /** 旧图层/单图结构的迁移报告；没有值得说明的结果时返回 null。 */
  static getMigrationReport(): WorldMapMigrationReport | null {
    const db = requireDb()
    const row = db.prepare(`
      SELECT report_json, acknowledged_at FROM world_map_atlas_migration WHERE migration_id = ?
    `).get(MIGRATION_ID) as { report_json: string; acknowledged_at: string | null } | undefined
    if (!row) return null
    let parsed: Omit<WorldMapMigrationReport, 'acknowledged'>
    try {
      parsed = JSON.parse(row.report_json)
    } catch {
      return null
    }
    const noteworthy = (parsed.mapCount ?? 0) > 0 || (parsed.isolatedEdgeCount ?? 0) > 0 || parsed.imageMigrated
    if (!noteworthy) return null
    return { ...parsed, acknowledged: Boolean(row.acknowledged_at) }
  }

  static acknowledgeMigration(): void {
    const db = requireDb()
    db.prepare(`
      UPDATE world_map_atlas_migration SET acknowledged_at = ? WHERE migration_id = ?
    `).run(new Date().toISOString(), MIGRATION_ID)
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

          candidates.push({
            id: `cand-${rule.id}`,
            name: cleanName,
            type: inferNodeType(cleanName, rule.content),
            description: (rule.content || '').slice(0, 200),
            sourceRef: rule.relative_path || rule.id,
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

          candidates.push({
            id: `cand-frag-${frag.id}`,
            name: cleanName,
            type: inferNodeType(cleanName, frag.content),
            description: (frag.content || '').slice(0, 200),
            sourceRef: `${frag.relative_path} (${heading})`,
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
                candidates.push({
                  id: `cand-wb-${candidates.length + 1}`,
                  name: cleanName,
                  type: inferNodeType(cleanName, desc),
                  description: desc.slice(0, 200),
                  sourceRef: '项目设定: 故事架构/世界观',
                })
                existingNodeNames.add(cleanName.toLowerCase())
              }
            }
          }
        }
      }

      return candidates
    } catch (error) {
      throw new Error(`[WorldMapRepository] 提取地图候选地点失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
