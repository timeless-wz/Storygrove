import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'

import {
  LEGACY_WORLD_MAP_DIRECTORY,
  MAX_WORLD_MAP_IMAGE_BYTES,
  WORLD_MAPS_DIRECTORY,
  isSafeWorldMapImageFileName,
  type WorldMapImage,
} from '../../src/shared/world-map'
import { assertProjectFilePath } from '../utils/project-context'
import {
  finalizeStagedMapImageRemoval,
  nodeWorldMapImageFileSystem,
  pruneEmptyMapImageDirectory,
  removeMapImageCopies,
  stageLegacyMapImageRemoval,
  type WorldMapImageFileSystem,
} from './world-map-image-store'

/**
 * 旧「一项目一张底图 + 图层筛选」结构 → 多地图地图册的一次性迁移。
 *
 * 硬性约束：
 * - 绝不删除任何既有地点、图层或连接行；
 * - 旧图层先转换成同名地图，原属于该图层的地点连同坐标迁入对应地图；
 * - 两端分属不同新地图的旧连接保持原样但 map_id 置空（隔离），运行时不再显示；
 * - 旧底图只搬运项目托管副本，绝不触碰用户原始图片。
 *
 * 图片搬运是可恢复的两阶段操作：先把副本复制进目标地图目录并校验字节数，再提交新的
 * 图片元数据，最后才清理旧托管副本并废弃旧单例表。任何一步失败都不会写入完成记录，
 * 因此下次打开项目会从头安全重试，数据库里也不会出现指向不存在文件的元数据。
 */

const MIGRATION_ID = 'world-map-atlas-v1'

export interface WorldMapAtlasMigrationRecord {
  migratedAt: string
  mapCount: number
  nodeCount: number
  isolatedEdgeCount: number
  imageMigrated: boolean
  legacyLayerNames: string[]
  /**
   * 新图片元数据已经提交、但旧托管副本未能清理时置位：两份文件都被保留，
   * 图片本身完好，只是旧副本仍留在项目内。
   */
  legacyImageCopyRetained?: boolean
  /** 与 legacyImageCopyRetained 配套的诊断信息。 */
  legacyImageCleanupError?: string
}

interface LegacyLayerRow {
  id: string
  name: string
  sort_order: number
}

interface LegacyImageRow {
  file_name: string
  mime_type: string
  bytes: number
  updated_at: string
}

function tableExists(db: BetterSqlite3.Database, tableName: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 AS value FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName))
}

function tableColumns(db: BetterSqlite3.Database, tableName: string): Set<string> {
  if (!tableExists(db, tableName)) return new Set()
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(column => column.name),
  )
}

function rootMapName(db: BetterSqlite3.Database): string {
  const row = tableExists(db, 'project_core')
    ? db.prepare(`SELECT writing_language FROM project_core WHERE id = 'main'`).get() as { writing_language?: string } | undefined
    : undefined
  return (row?.writing_language ?? 'zh-CN').toLowerCase().startsWith('en') ? 'World Map' : '世界总图'
}

/**
 * 阶段一：把旧托管副本复制进目标地图目录，并确认副本存在且字节数与原文件一致。
 *
 * 可重入：若目标目录中已经存在同名同字节数的副本（上一次尝试中断留下的），直接复用，
 * 绝不覆盖一个已经可用的副本。
 */
function copyLegacyImageIntoMapDirectory(
  projectPath: string,
  mapId: string,
  source: LegacyImageRow,
  fileSystem: WorldMapImageFileSystem,
): WorldMapImage {
  const sourcePath = path.join(projectPath, LEGACY_WORLD_MAP_DIRECTORY, source.file_name)
  if (!fileSystem.existsSync(sourcePath)) throw new Error(`旧地图图片托管副本不存在: ${source.file_name}`)
  assertProjectFilePath(sourcePath, projectPath, 'existing')
  const sourceStats = fileSystem.statSync(sourcePath)
  if (!sourceStats.isFile() || sourceStats.size <= 0 || sourceStats.size > MAX_WORLD_MAP_IMAGE_BYTES) {
    throw new Error('旧地图图片托管副本不可用')
  }

  const directory = path.join(projectPath, WORLD_MAPS_DIRECTORY, mapId)
  assertProjectFilePath(directory, projectPath, 'writable')
  fileSystem.mkdirSync(directory)
  assertProjectFilePath(directory, projectPath, 'existing')

  const target = path.join(directory, source.file_name)
  assertProjectFilePath(target, projectPath, 'writable')
  const existing = fileSystem.existsSync(target) ? fileSystem.statSync(target) : null
  if (!existing || !existing.isFile() || existing.size !== sourceStats.size) {
    fileSystem.copyFileSync(sourcePath, target, { exclusive: false })
  }

  const verified = fileSystem.statSync(target)
  if (!verified.isFile() || verified.size !== sourceStats.size) {
    throw new Error('新地图目录中的图片副本校验失败')
  }

  return {
    fileName: source.file_name,
    mimeType: source.mime_type,
    // 以校验通过的真实字节数为准；旧单例行里的 bytes 可能已经过时。
    bytes: verified.size,
    updatedAt: source.updated_at,
  }
}

/**
 * 阶段一失败后清掉目标目录里那个尚未被任何记录引用的副本，避免留下无法管理的文件。
 * 只删这张新地图目录下的文件，旧托管副本原样保留，因此迁移仍然可以重试。
 */
function discardUncommittedImageCopy(
  projectPath: string,
  mapId: string,
  fileName: string,
  fileSystem: WorldMapImageFileSystem,
): void {
  try {
    removeMapImageCopies(projectPath, mapId, [fileName], fileSystem)
    pruneEmptyMapImageDirectory(projectPath, mapId, fileSystem)
  } catch (error) {
    console.warn('[WorldMapAtlas] 清理未提交的图片副本失败，该文件尚无记录但仍在项目目录内', error)
  }
}

interface MapPlanEntry {
  id: string
  name: string
  parentMapId: string | null
  sortOrder: number
}

export function migrateWorldMapAtlas(
  db: BetterSqlite3.Database,
  projectPath: string,
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): void {
  const applied = db.prepare(`
    SELECT migration_id FROM world_map_atlas_migration WHERE migration_id = ?
  `).get(MIGRATION_ID)
  if (applied) return

  const now = new Date().toISOString()
  const record: WorldMapAtlasMigrationRecord = {
    migratedAt: now,
    mapCount: 0,
    nodeCount: 0,
    isolatedEdgeCount: 0,
    imageMigrated: false,
    legacyLayerNames: [],
  }

  // ---- 读取阶段：只读旧结构，并在任何 SQL 写入之前确定地图计划 ----
  const nodeColumns = tableColumns(db, 'world_map_nodes')
  const hasLegacyLayerColumn = nodeColumns.has('map_layer')
  const legacyLayers = tableExists(db, 'world_map_layers')
    ? db.prepare(`
        SELECT id, name, sort_order FROM world_map_layers ORDER BY sort_order ASC, created_at ASC
      `).all() as LegacyLayerRow[]
    : []
  const nodeRows = hasLegacyLayerColumn
    ? db.prepare('SELECT id, map_layer FROM world_map_nodes').all() as Array<{ id: string; map_layer: string | null }>
    : (db.prepare('SELECT id FROM world_map_nodes').all() as Array<{ id: string }>)
        .map(row => ({ id: row.id, map_layer: null }))
  const legacyImage = tableExists(db, 'world_map_image')
    ? db.prepare(`
        SELECT file_name, mime_type, bytes, updated_at FROM world_map_image WHERE singleton_id = 1
      `).get() as LegacyImageRow | undefined
    : undefined

  // 图层来源 = 已持久化的旧图层 + 地点上残留的未知图层字符串。后者必须保留，
  // 否则这些地点会在迁移后失去归属。
  const layerSeeds: Array<{ key: string; name: string }> = []
  const knownLayerKeys = new Set<string>()
  for (const layer of legacyLayers) {
    if (knownLayerKeys.has(layer.id)) continue
    knownLayerKeys.add(layer.id)
    layerSeeds.push({ key: layer.id, name: layer.name || layer.id })
  }
  for (const node of nodeRows) {
    const legacyKey = (node.map_layer ?? '').trim()
    if (!legacyKey || knownLayerKeys.has(legacyKey)) continue
    knownLayerKeys.add(legacyKey)
    layerSeeds.push({ key: legacyKey, name: legacyKey })
  }

  // 旧底图属于整个项目，因此放在一张新的根地图上，旧图层地图成为它的子地图；
  // 没有底图但已存在地点时也要有一张地图，地点绝不能因为改结构而失去归属。
  const rootNeeded = Boolean(legacyImage) || (nodeRows.length > 0 && layerSeeds.length === 0)
  const mapPlan: MapPlanEntry[] = []
  const layerToMapId = new Map<string, string>()
  let rootMapId: string | null = null
  let order = 1
  if (rootNeeded) {
    rootMapId = `map-${randomUUID()}`
    mapPlan.push({ id: rootMapId, name: rootMapName(db), parentMapId: null, sortOrder: order++ })
  }
  for (const seed of layerSeeds) {
    const mapId = `map-${randomUUID()}`
    layerToMapId.set(seed.key, mapId)
    mapPlan.push({ id: mapId, name: seed.name, parentMapId: rootMapId, sortOrder: order++ })
  }
  record.mapCount = mapPlan.length
  record.legacyLayerNames = layerSeeds.map(seed => seed.name)

  // ---- 阶段一：复制旧底图并校验。失败则完全不碰数据库，下次打开项目原样重试 ----
  let migratedImage: WorldMapImage | null = null
  if (legacyImage && rootMapId) {
    if (!isSafeWorldMapImageFileName(legacyImage.file_name)) {
      console.warn('[WorldMapAtlas] 旧单例底图文件名不可信，已放弃本次迁移以保留可重试状态', legacyImage.file_name)
      return
    }
    try {
      migratedImage = copyLegacyImageIntoMapDirectory(projectPath, rootMapId, legacyImage, fileSystem)
    } catch (error) {
      // 复制或校验失败：清掉目标目录里这个还没有任何记录引用的副本，旧记录与旧文件
      // 原样保留，因此下次打开项目可以从零安全重试。
      console.warn('[WorldMapAtlas] 旧底图复制或校验失败，已保留旧记录与旧文件，待下次打开重试', error)
      discardUncommittedImageCopy(projectPath, rootMapId, legacyImage.file_name, fileSystem)
      return
    }
  }

  // ---- 阶段二：一次性写入地图树、地点归属、连接归属与图片元数据 ----
  try {
    db.transaction(() => {
      const insertMap = db.prepare(`
        INSERT INTO world_maps (id, name, parent_map_id, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const entry of mapPlan) {
        insertMap.run(entry.id, entry.name, entry.parentMapId, entry.sortOrder, now, now)
      }

      // 地点连同原坐标迁入对应地图；父地点关系不变。map_id 非空即归属唯一地图。
      const fallbackMapId = mapPlan[0]?.id ?? null
      const updateNode = db.prepare('UPDATE world_map_nodes SET map_id = ?, updated_at = ? WHERE id = ?')
      for (const node of nodeRows) {
        const legacyKey = (node.map_layer ?? '').trim()
        const targetMapId = layerToMapId.get(legacyKey) ?? fallbackMapId
        if (!targetMapId) continue
        updateNode.run(targetMapId, now, node.id)
      }
      record.nodeCount = nodeRows.length

      // 连接只在两个端点归入同一张地图时保留归属；端点分属不同新地图的旧连接不删除，
      // 但也绝不跨地图显示——map_id 保持 NULL 即为隔离状态。
      const ownerByNode = new Map<string, string>()
      for (const row of db.prepare('SELECT id, map_id FROM world_map_nodes').all() as Array<{ id: string; map_id: string }>) {
        ownerByNode.set(row.id, row.map_id)
      }
      const setEdgeMap = db.prepare('UPDATE world_map_edges SET map_id = ? WHERE id = ?')
      const isolateEdge = db.prepare('UPDATE world_map_edges SET map_id = NULL WHERE id = ?')
      for (const edge of db.prepare('SELECT id, from_node_id, to_node_id FROM world_map_edges').all() as Array<{
        id: string
        from_node_id: string
        to_node_id: string
      }>) {
        const fromMapId = ownerByNode.get(edge.from_node_id)
        const toMapId = ownerByNode.get(edge.to_node_id)
        if (fromMapId && toMapId && fromMapId === toMapId) setEdgeMap.run(fromMapId, edge.id)
        else {
          isolateEdge.run(edge.id)
          record.isolatedEdgeCount += 1
        }
      }

      if (migratedImage && rootMapId) {
        db.prepare(`
          UPDATE world_maps
          SET image_file_name = ?, image_mime_type = ?, image_bytes = ?, updated_at = ?
          WHERE id = ?
        `).run(
          migratedImage.fileName,
          migratedImage.mimeType,
          migratedImage.bytes,
          migratedImage.updatedAt,
          rootMapId,
        )
        record.imageMigrated = true
        // 只有新元数据与图像副本同时就绪，才允许废弃旧单例表。
        if (tableExists(db, 'world_map_image')) db.exec('DROP TABLE world_map_image')
      } else if (tableExists(db, 'world_map_image') && !legacyImage) {
        // 没有旧底图时该表本就是空的，可以直接废弃。
        db.exec('DROP TABLE world_map_image')
      }

      db.prepare(`
        INSERT INTO world_map_atlas_migration (migration_id, report_json, applied_at)
        VALUES (?, ?, ?)
      `).run(MIGRATION_ID, JSON.stringify(record), now)
    })()
  } catch (error) {
    // SQL 回滚后地图树与图片元数据都不存在，阶段一写下的副本也就没有记录可依附：
    // 清掉它，旧记录与旧文件保持原样，下次打开可从零安全重试。
    if (migratedImage && rootMapId) {
      discardUncommittedImageCopy(projectPath, rootMapId, migratedImage.fileName, fileSystem)
    }
    console.warn('[WorldMapAtlas] 迁移写入失败，已回滚并且不写入完成记录', error)
    return
  }

  // ---- 阶段三：提交之后才清理旧托管副本。失败只保留两份文件，绝不回滚新元数据 ----
  if (migratedImage) {
    try {
      const staged = stageLegacyMapImageRemoval(projectPath, [migratedImage.fileName], fileSystem)
      const remaining = finalizeStagedMapImageRemoval(staged, fileSystem)
      if (remaining > 0) {
        record.legacyImageCopyRetained = true
        record.legacyImageCleanupError = `仍有 ${remaining} 个旧托管副本留在项目恢复目录中`
      }
    } catch (error) {
      record.legacyImageCopyRetained = true
      record.legacyImageCleanupError = error instanceof Error ? error.message : String(error)
    }
    if (record.legacyImageCopyRetained) {
      console.warn(
        '[WorldMapAtlas] 旧底图副本未能清理，已保留两份文件且新图片元数据保持不变',
        projectPath,
        record.legacyImageCleanupError,
      )
      try {
        db.prepare(`
          UPDATE world_map_atlas_migration SET report_json = ? WHERE migration_id = ?
        `).run(JSON.stringify(record), MIGRATION_ID)
      } catch (error) {
        // 诊断信息写不进去不影响任何图片的可用性；控制台已经留下可排查线索。
        console.warn('[WorldMapAtlas] 记录旧副本保留状态失败', error)
      }
    }
  }
}
