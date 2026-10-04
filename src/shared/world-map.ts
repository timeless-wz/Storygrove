/**
 * 多地图地图册（World Map Atlas）共享契约。
 *
 * 核心规则：一张地图就是一层空间。地点、地点父子关系、地点连接与坐标都只在
 * 所属地图内部成立，绝不允许同一地点出现在多张地图，也不允许跨地图连接。
 * 地图之间只通过地图册树与面包屑切换。
 */

export type WorldMapNodeType =
  | 'world'       // 世界
  | 'region'      // 区域
  | 'city'        // 城市
  | 'relic'       // 遗境
  | 'route_node'  // 航路节点
  | 'landmark'    // 地标
  | 'faction'     // 势力

export type WorldMapEdgeType =
  | 'route'       // 航路
  | 'adjacent'    // 邻接
  | 'subordinate' // 从属
  | 'portal'      // 传送/界隙
  | 'conflict'    // 冲突关系

export type WorldMapEdgeStatus = 'active' | 'blocked' | 'hidden'

export const WORLD_MAP_MARKER_ICON_LABELS = {
  globe: { zh: '世界', en: 'World' },
  mountain: { zh: '山脉', en: 'Mountains' },
  castle: { zh: '城堡', en: 'Castle' },
  house: { zh: '住宅', en: 'House' },
  temple: { zh: '神殿', en: 'Temple' },
  gate: { zh: '城门', en: 'Gate' },
  port: { zh: '港口', en: 'Port' },
  ruins: { zh: '遗迹', en: 'Ruins' },
  signpost: { zh: '路标', en: 'Signpost' },
  flag: { zh: '据点', en: 'Stronghold' },
  forest: { zh: '森林', en: 'Forest' },
  camp: { zh: '营地', en: 'Camp' },
  mine: { zh: '矿场', en: 'Mine' },
  shop: { zh: '商铺', en: 'Shop' },
  inn: { zh: '旅店', en: 'Inn' },
  tower: { zh: '高塔', en: 'Tower' },
} as const

export type WorldMapMarkerIcon = keyof typeof WORLD_MAP_MARKER_ICON_LABELS

export function isWorldMapMarkerIcon(value: unknown): value is WorldMapMarkerIcon {
  return typeof value === 'string' && Object.hasOwn(WORLD_MAP_MARKER_ICON_LABELS, value)
}

export const WORLD_MAP_DEFAULT_MARKER_ICONS: Record<WorldMapNodeType, WorldMapMarkerIcon> = {
  world: 'globe', region: 'mountain', city: 'castle', relic: 'ruins',
  route_node: 'signpost', landmark: 'temple', faction: 'flag',
}

export function getWorldMapMarkerIcon(node: Pick<WorldMapNode, 'type' | 'markerIcon'>): WorldMapMarkerIcon {
  return isWorldMapMarkerIcon(node.markerIcon)
    ? node.markerIcon
    : WORLD_MAP_DEFAULT_MARKER_ICONS[node.type] || 'temple'
}

/** 地点资料可以独立于地图存在；mapId 为空字符串表示尚未关联地图。 */
export interface WorldMapNode {
  id: string
  name: string
  type: WorldMapNodeType
  /** null 或未设置时随地点类型显示默认标识。 */
  markerIcon?: WorldMapMarkerIcon | null
  description: string
  parentId: string | null
  /** 可选地图归属。非空时由仓库层验证地图存在；地点只属于一张地图。 */
  mapId: string
  /** Optional optimistic concurrency token used by the standalone location editor. */
  expectedUpdatedAt?: string | null
  x: number
  y: number
  sourceRefs: string[]
  createdAt?: string
  updatedAt?: string
}

/**
 * 地点连接。mapId 由两个端点推导并由仓库层写入；为 null 表示迁移期间被隔离的
 * 旧连接（两端已分属不同地图），运行时永不显示，但原始行仍然保留。
 */
export interface WorldMapEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  type: WorldMapEdgeType
  description: string
  status: WorldMapEdgeStatus
  mapId?: string | null
  createdAt?: string
  updatedAt?: string
}

/** 项目托管在地图受控目录中的图片元数据；渲染层只会拿到 data URL。 */
export interface WorldMapImage {
  fileName: string
  mimeType: string
  bytes: number
  updatedAt: string
}

/**
 * 一张独立地图。每张地图可分别导入一张图片，并可通过 parentMapId 组成层级地图树。
 * worldId 是这张地图归属的小说世界：一张地图最多归属一个世界，未关联时为 null
 * （旧地图保持未关联，绝不按名称或结构推断归属）。
 */
export interface WorldMap {
  id: string
  name: string
  parentMapId: string | null
  sortOrder: number
  image: WorldMapImage | null
  /** 归属世界；null 表示尚未关联，界面必须显式提供「关联到世界」操作。 */
  worldId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface WorldMapCandidate {
  id: string
  name: string
  type: WorldMapNodeType
  description: string
  sourceRef: string
}

/**
 * 旧单图/图层结构的迁移结果说明。迁移绝不删除既有地点、图层或连接：
 * 仅把旧图层转换成同名地图，把两端分属不同新地图的旧连接隔离（保留行但不再显示）。
 */
export interface WorldMapMigrationReport {
  migratedAt: string
  /** 由旧图层转换而来的地图数量。 */
  mapCount: number
  /** 迁移进地图的地点数量。 */
  nodeCount: number
  /** 因两端分属不同地图而被隔离、不再显示的旧连接数量。 */
  isolatedEdgeCount: number
  /** 旧单张项目底图是否已迁入某张地图。 */
  imageMigrated: boolean
  /** 旧图层名称，仅用于向作者说明迁移来源。 */
  legacyLayerNames: string[]
  /**
   * 新图片元数据已经提交、但旧托管副本未能清理时置位：此时两份文件都被保留，
   * 图片本身完好可用，旧副本仍留在项目内可供人工找回。
   */
  legacyImageCopyRetained?: boolean
  /** 与 legacyImageCopyRetained 配套的诊断信息。 */
  legacyImageCleanupError?: string
  acknowledged: boolean
}

export interface WorldMapAtlas {
  maps: WorldMap[]
  nodes: WorldMapNode[]
  edges: WorldMapEdge[]
  migration: WorldMapMigrationReport | null
}

export const WORLD_MAP_NODE_TYPE_LABELS: Record<WorldMapNodeType, { zh: string; en: string }> = {
  world: { zh: '世界', en: 'World' },
  region: { zh: '区域', en: 'Region' },
  city: { zh: '城市', en: 'City' },
  relic: { zh: '遗境', en: 'Relic / Ruins' },
  route_node: { zh: '航路节点', en: 'Route Node' },
  landmark: { zh: '地标', en: 'Landmark' },
  faction: { zh: '势力', en: 'Faction' },
}

export const WORLD_MAP_EDGE_TYPE_LABELS: Record<WorldMapEdgeType, { zh: string; en: string }> = {
  route: { zh: '航路', en: 'Route' },
  adjacent: { zh: '邻接', en: 'Adjacent' },
  subordinate: { zh: '从属', en: 'Subordinate' },
  portal: { zh: '传送/界隙', en: 'Portal / Rift' },
  conflict: { zh: '冲突关系', en: 'Conflict' },
}

/** 每张地图的图片都复制到项目受控目录 `.vela/world-maps/<map-id>/`。 */
export const WORLD_MAPS_DIRECTORY = '.vela/world-maps'
/** 旧版单张项目底图的托管目录；只在读取迁移前的文件时作为回退。 */
export const LEGACY_WORLD_MAP_DIRECTORY = '.vela/world-map'
export const MAX_WORLD_MAP_IMAGE_BYTES = 32 * 1024 * 1024
export const WORLD_MAP_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** 地图图片的文件名固定为 `map-<uuid>.<ext>`，也是地图目录名的安全校验依据。 */
const MANAGED_IMAGE_FILE_NAME = /^map-[0-9a-f-]{36}\.(?:png|jpe?g|webp)$/iu
const MAP_ID = /^map-[0-9a-f-]{36}$/iu

export function isSafeWorldMapImageFileName(fileName: string): boolean {
  return MANAGED_IMAGE_FILE_NAME.test(fileName)
}

/** 地图 id 直接参与受控目录路径，因此写入前必须通过严格格式校验。 */
export function isSafeWorldMapId(mapId: string): boolean {
  return MAP_ID.test(mapId)
}

export function createWorldMapId(): string {
  return `map-${randomUuidV4()}`
}

/**
 * 地图 id 会进入受控目录路径，因此渲染层必须始终产出合法 UUID。Chromium 在
 * file:// 下仍可能缺少 crypto.randomUUID，这里保证任何环境下都是合规 v4 值。
 */
function randomUuidV4(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getWorldMapName(maps: WorldMap[], id: string | null | undefined): string {
  if (!id) return ''
  return maps.find(map => map.id === id)?.name || id
}

/** 从根地图到指定地图的面包屑，用于在地图册树中定位当前位置。 */
export function getWorldMapBreadcrumb(maps: WorldMap[], id: string | null | undefined): WorldMap[] {
  if (!id) return []
  const byId = new Map(maps.map(map => [map.id, map]))
  const trail: WorldMap[] = []
  const visited = new Set<string>()
  let cursor = byId.get(id)
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    trail.unshift(cursor)
    cursor = cursor.parentMapId ? byId.get(cursor.parentMapId) : undefined
  }
  return trail
}

export interface WorldMapTreeNode {
  map: WorldMap
  depth: number
  children: WorldMapTreeNode[]
}

/** 按 sortOrder 构建地图册树；孤儿地图（父地图缺失）按顶层地图处理。 */
export function buildWorldMapTree(maps: WorldMap[]): WorldMapTreeNode[] {
  const ordered = [...maps].sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  const ids = new Set(ordered.map(map => map.id))
  const childrenByParent = new Map<string, WorldMap[]>()
  for (const map of ordered) {
    const parentKey = map.parentMapId && ids.has(map.parentMapId) ? map.parentMapId : ''
    const bucket = childrenByParent.get(parentKey)
    if (bucket) bucket.push(map)
    else childrenByParent.set(parentKey, [map])
  }

  const build = (parentKey: string, depth: number, seen: Set<string>): WorldMapTreeNode[] =>
    (childrenByParent.get(parentKey) ?? [])
      .filter(map => !seen.has(map.id))
      .map(map => {
        const nextSeen = new Set(seen).add(map.id)
        return { map, depth, children: build(map.id, depth + 1, nextSeen) }
      })

  return build('', 0, new Set())
}
