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

export interface WorldMapNode {
  id: string
  name: string
  type: WorldMapNodeType
  description: string
  parentId: string | null
  mapLayer: string
  x: number
  y: number
  sourceRefs: string[]
  createdAt?: string
  updatedAt?: string
}

export interface WorldMapEdge {
  id: string
  fromNodeId: string
  toNodeId: string
  type: WorldMapEdgeType
  description: string
  status: WorldMapEdgeStatus
  createdAt?: string
  updatedAt?: string
}

/** 项目级可维护图层。id 被节点引用，name 可随时由作者改名。 */
export interface WorldMapLayer {
  id: string
  name: string
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

export interface WorldMapCandidate {
  id: string
  name: string
  type: WorldMapNodeType
  description: string
  sourceRef: string
  suggestedLayer?: string
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

export function getWorldMapLayerName(layers: WorldMapLayer[], id: string): string {
  return layers.find(layer => layer.id === id)?.name || id
}
