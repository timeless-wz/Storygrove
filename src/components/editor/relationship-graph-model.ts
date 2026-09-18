import { parseRelationshipEdges } from '../../shared/relationship-presentation'

export interface RelationshipGraphCharacter {
  name: string
  role: string
  relationships: string
}

export interface RelationshipGraphPosition {
  x: number
  y: number
}

export interface RelationshipGraphNodeModel {
  id: string
  name: string
  role: string
  position: RelationshipGraphPosition
}

export type RelationshipGraphEdgeTone = 'family' | 'conflict' | 'alliance' | 'neutral'

export interface RelationshipGraphEdgeModel {
  id: string
  source: string
  target: string
  sourceName: string
  targetName: string
  label: string
  tone: RelationshipGraphEdgeTone
  /** Used to keep reciprocal and parallel relationships visually separate. */
  lane: number
}

export interface RelationshipGraphModel {
  nodes: RelationshipGraphNodeModel[]
  edges: RelationshipGraphEdgeModel[]
}

export const RELATIONSHIP_GRAPH_LAYOUT_VERSION = 'v1'

export function relationshipGraphNodeId(name: string): string {
  return `character:${encodeURIComponent(name.trim())}`
}

export function relationshipGraphLayoutStorageKey(projectKey: string): string {
  return `ai-novel-writer:relationship-graph-layout:${RELATIONSHIP_GRAPH_LAYOUT_VERSION}:${projectKey}`
}

function finitePosition(value: unknown): RelationshipGraphPosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { x?: unknown; y?: unknown }
  return typeof candidate.x === 'number'
    && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number'
    && Number.isFinite(candidate.y)
    ? { x: candidate.x, y: candidate.y }
    : null
}

export function readRelationshipGraphPositions(projectKey?: string): Record<string, RelationshipGraphPosition> {
  if (!projectKey || typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(relationshipGraphLayoutStorageKey(projectKey))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([id, value]) => [id, finitePosition(value)] as const)
        .filter((entry): entry is [string, RelationshipGraphPosition] => entry[1] !== null),
    )
  } catch {
    // Graph placement is only a local presentation preference. A corrupt value
    // must never block the authoritative character roster from rendering.
    return {}
  }
}

export function writeRelationshipGraphPositions(
  projectKey: string | undefined,
  positions: Record<string, RelationshipGraphPosition>,
): void {
  if (!projectKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      relationshipGraphLayoutStorageKey(projectKey),
      JSON.stringify(positions),
    )
  } catch {
    // Storage may be disabled or full. The graph still remains usable for this
    // session, and no character or relationship fact is affected.
  }
}

function fallbackPosition(index: number, count: number, protagonistIndex: number): RelationshipGraphPosition {
  if (count <= 1) return { x: 0, y: 0 }
  if (index === protagonistIndex) return { x: 0, y: 0 }

  const outerIndexes = Array.from({ length: count }, (_, candidate) => candidate)
    .filter(candidate => candidate !== protagonistIndex)
  const outerIndex = outerIndexes.indexOf(index)
  const ring = Math.floor(outerIndex / 8)
  const itemsOnRing = Math.min(8, outerIndexes.length - ring * 8)
  const withinRing = outerIndex % 8
  const angle = (withinRing / Math.max(itemsOnRing, 1)) * Math.PI * 2 - Math.PI / 2
  const radius = 260 + ring * 220
  return {
    x: Math.round(radius * Math.cos(angle)),
    y: Math.round(radius * Math.sin(angle)),
  }
}

function toneForRelationship(label: string): RelationshipGraphEdgeTone {
  const normalized = label.toLocaleLowerCase('zh-CN')
  if (/(父|母|子|女|兄|弟|姐|妹|亲属|家族|师|徒|family|parent|child|sibling|mentor)/.test(normalized)) return 'family'
  if (/(敌|仇|对立|竞争|追杀|背叛|conflict|enemy|rival|betray)/.test(normalized)) return 'conflict'
  if (/(盟|友|合作|同伴|信任|alliance|ally|partner|friend)/.test(normalized)) return 'alliance'
  return 'neutral'
}

/**
 * Converts the roster's compatible relationship text into a presentation-only
 * directed graph. No graph interaction writes character facts: the roster
 * editor remains the only authoring boundary for relationships.
 */
export function buildRelationshipGraphModel(
  characters: readonly RelationshipGraphCharacter[],
  savedPositions: Record<string, RelationshipGraphPosition> = {},
): RelationshipGraphModel {
  const visibleCharacters = characters.filter(character => character.name.trim())
  const knownNames = visibleCharacters.map(character => character.name.trim())
  const protagonistIndex = Math.max(0, visibleCharacters.findIndex(character => character.role === 'protagonist'))
  const nodes = visibleCharacters.map((character, index) => {
    const id = relationshipGraphNodeId(character.name)
    return {
      id,
      name: character.name,
      role: character.role,
      position: savedPositions[id] ?? fallbackPosition(index, visibleCharacters.length, protagonistIndex),
    }
  })

  const rawEdges = visibleCharacters.flatMap((character) => (
    parseRelationshipEdges(character.relationships, {
      knownNames,
      selfName: character.name,
    }).map(edge => ({
      sourceName: character.name,
      targetName: edge.target,
      label: edge.relation,
    }))
  ))

  const pairCounts = new Map<string, number>()
  for (const edge of rawEdges) {
    const pairKey = [edge.sourceName, edge.targetName].sort().join('\u0000')
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1)
  }

  const directedCounts = new Map<string, number>()
  const edges = rawEdges.map((edge) => {
    const source = relationshipGraphNodeId(edge.sourceName)
    const target = relationshipGraphNodeId(edge.targetName)
    const directedKey = `${source}\u0000${target}`
    const lane = directedCounts.get(directedKey) ?? 0
    directedCounts.set(directedKey, lane + 1)
    const pairKey = [edge.sourceName, edge.targetName].sort().join('\u0000')
    const reciprocalOffset = pairCounts.get(pairKey)! > 1
      ? (edge.sourceName.localeCompare(edge.targetName, 'zh-CN') <= 0 ? -1 : 1)
      : 0
    return {
      id: `relationship:${source}:${target}:${encodeURIComponent(edge.label)}:${lane}`,
      source,
      target,
      sourceName: edge.sourceName,
      targetName: edge.targetName,
      label: edge.label,
      tone: toneForRelationship(edge.label),
      lane: reciprocalOffset * 2 + lane,
    }
  })

  return { nodes, edges }
}
