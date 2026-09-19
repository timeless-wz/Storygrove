/**
 * 人物共用关系的跨进程契约。
 *
 * 事实源只有一张共享关系表：两端记录稳定人物 ID，一个人物对之间只有一条关系。
 * 姓名只用于展示，改名不得改动关系端点或画布坐标主键。
 */
import {
  classifyRelationshipStorage,
  structuredRelationshipRows,
} from './relationship-presentation'

export interface CharacterSharedRelationship {
  id: string
  /** 两端的稳定人物 ID；顺序按字母表规范化，互为对称。 */
  character1Id: string
  character2Id: string
  /** 由 ID 解析出的展示名，只读，不作为身份使用。 */
  character1Name: string
  character2Name: string
  relation: string
  description: string
  createdAt?: string
  updatedAt?: string
}

export interface CharacterGraphPosition {
  x: number
  y: number
}

/** 人物姓名 → 稳定人物 ID 的映射（渲染层解析展示名用）。 */
export type CharacterIdentityMap = Record<string, string>

/** 规范化一对 ID（保持恒定字母表排序）。 */
export function canonicalCharacterPair(idA: string, idB: string): [string, string] {
  const a = idA.trim()
  const b = idB.trim()
  return a < b ? [a, b] : [b, a]
}

/** 某条共用关系是否属于给定的两个人物（按 ID 比较）。 */
export function isMatchingRelationship(
  rel: CharacterSharedRelationship,
  idA: string,
  idB: string,
): boolean {
  const [c1, c2] = canonicalCharacterPair(idA, idB)
  const [r1, r2] = canonicalCharacterPair(rel.character1Id, rel.character2Id)
  return c1 === r1 && c2 === r2
}

/** 关系中另一端的 ID。 */
export function otherCharacterIdInRelationship(
  rel: CharacterSharedRelationship,
  currentCharacterId: string,
): string {
  return rel.character1Id === currentCharacterId ? rel.character2Id : rel.character1Id
}

/** 关系中另一端的展示名。 */
export function otherCharacterNameInRelationship(
  rel: CharacterSharedRelationship,
  currentCharacterId: string,
): string {
  return rel.character1Id === currentCharacterId ? rel.character2Name : rel.character1Name
}

/** 关系标签展示格式化（如：师徒 或 师徒（十年前））。 */
export function formatSharedRelationLabel(rel: CharacterSharedRelationship): string {
  if (!rel.description?.trim()) return rel.relation
  return `${rel.relation}（${rel.description.trim()}）`
}

/** 人物卡 relationships 派生投影中的一条边。 */
export interface ProjectedRelationshipEdge {
  target: string
  relation: string
}

/**
 * 把一条共享关系投影成“我方视角”的旧字段边。
 * 展示名缺失（人物已被删除但关系仍在）时返回 null，调用方保持旧字段原样。
 */
export function projectSharedRelationshipEdge(
  rel: CharacterSharedRelationship,
  currentCharacterId: string,
): ProjectedRelationshipEdge | null {
  const target = otherCharacterNameInRelationship(rel, currentCharacterId).trim()
  if (!target) return null
  return { target, relation: formatSharedRelationLabel(rel) }
}

function edgeKey(edge: ProjectedRelationshipEdge): string {
  return `${edge.target.trim()}\u0000${edge.relation.trim()}`
}

export interface LegacyRelationshipsProjectionContext {
  /** 当前名单里仍然存在的人物展示名。 */
  knownNames: readonly string[]
  /**
   * 刚刚被删除的人物展示名：这些旧边是随人物一起消失的过时投影，
   * 不算“未迁移的旧证据”。
   */
  removedNames?: readonly string[]
}

/**
 * 旧 characters.relationships 字段的派生投影。
 *
 * 该字段只服务于旧导出与旧 reader，绝不是关系事实源。返回 null 表示
 * “保持旧字段原样”，只有下列情况才允许按共享关系表重写：
 * - 旧字段是自由文本（无法解析）→ 永远保留；
 * - 旧字段还有目标人物不存在、或与共享关系文本冲突的边 → 保留旧证据；
 * - 其余情况（迁移后的等价投影、人物已删除、关系已删除）→ 重写为共享关系表的
 *   投影，可重复执行且幂等。
 */
export function projectLegacyRelationshipsField(
  currentJson: string,
  edges: readonly ProjectedRelationshipEdge[],
  context: LegacyRelationshipsProjectionContext,
): string | null {
  const kind = classifyRelationshipStorage(currentJson)
  if (kind === 'legacy') return null

  const projected = edges.filter(edge => edge.target.trim() && edge.relation.trim())
  const serialized = projected.length > 0 ? JSON.stringify(projected) : ''

  if (kind === 'empty') return serialized || null

  const currentEdges = structuredRelationshipRows(currentJson) ?? []
  if (currentEdges.length === 0) return serialized || null

  const projectedKeys = new Set(projected.map(edgeKey))
  const sharedTargets = new Set(projected.map(edge => edge.target.trim()))
  const knownNames = new Set(context.knownNames.map(name => name.trim()))
  const removedNames = new Set((context.removedNames ?? []).map(name => name.trim()))

  const fullyCovered = currentEdges.every((edge) => {
    const target = edge.target.trim()
    if (removedNames.has(target)) return true
    if (projectedKeys.has(edgeKey(edge))) return true
    // 目标人物已不在名单里：需要保留的旧证据，不能猜、不能丢。
    if (!knownNames.has(target)) return false
    // 目标还在，但这一对已经有共享关系却是另一种说法：冲突，保留旧字段。
    if (sharedTargets.has(target)) return false
    // 目标还在，这一对已经没有共享关系：关系被删除了，旧边只是过时投影。
    return true
  })
  return fullyCovered ? serialized : null
}
