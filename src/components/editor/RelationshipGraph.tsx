import { useCallback, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize2, RotateCcw } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import {
  buildRelationshipGraphModel,
  readRelationshipGraphPositions,
  relationshipGraphLayoutStorageKey,
  writeRelationshipGraphPositions,
  type RelationshipGraphCharacter,
  type RelationshipGraphEdgeModel,
  type RelationshipGraphEdgeTone,
  type RelationshipGraphModel,
  type RelationshipGraphNodeModel,
  type RelationshipGraphPosition,
} from './relationship-graph-model'

interface RelationshipGraphProps {
  characters: RelationshipGraphCharacter[]
  /** Local-only layout preferences are scoped to the project, never to character facts. */
  projectKey?: string
  onCharacterSelect?: (name: string) => void
}

interface RelationshipGraphSurfaceProps extends RelationshipGraphProps {
  graphModel: RelationshipGraphModel
}

type CharacterGraphNodeData = Record<string, unknown> & {
  name: string
  role: string
  relationships: number
}

type CharacterGraphNode = Node<CharacterGraphNodeData, 'character'>

type RelationshipFlowEdgeData = Record<string, unknown> & {
  label: string
  tone: RelationshipGraphEdgeTone
  lane: number
  sourceName: string
  targetName: string
}

type RelationshipFlowEdge = Edge<RelationshipFlowEdgeData, 'relationship'>

const ROLE_COLORS: Record<string, string> = {
  protagonist: 'var(--color-role-protagonist, #2563eb)',
  antagonist: 'var(--color-role-antagonist, #dc2626)',
  supporting: 'var(--color-role-supporting, #7c3aed)',
  minor: 'var(--color-role-minor, #64748b)',
}

const EDGE_COLORS: Record<RelationshipGraphEdgeTone, string> = {
  family: '#a16207',
  conflict: '#dc2626',
  alliance: '#059669',
  neutral: '#64748b',
}

const ROLE_LABELS: Record<string, [string, string]> = {
  protagonist: ['主角', 'Protagonist'],
  antagonist: ['反派', 'Antagonist'],
  supporting: ['配角', 'Supporting'],
  minor: ['次要角色', 'Minor'],
}

const HANDLE_POSITIONS = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
} as const

function compactLabel(value: string, maxCharacters = 15): string {
  const characters = Array.from(value.trim())
  return characters.length > maxCharacters
    ? `${characters.slice(0, maxCharacters).join('')}…`
    : characters.join('')
}

function handleForDirection(
  source: RelationshipGraphPosition,
  target: RelationshipGraphPosition,
  kind: 'source' | 'target',
): string {
  const dx = target.x - source.x
  const dy = target.y - source.y
  let direction: 'left' | 'right' | 'top' | 'bottom'
  if (Math.abs(dx) >= Math.abs(dy)) direction = dx >= 0 ? 'right' : 'left'
  else direction = dy >= 0 ? 'bottom' : 'top'

  if (kind === 'target') {
    direction = ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const)[direction]
  }
  return `${kind}-${direction}`
}

function toFlowNodes(nodes: RelationshipGraphNodeModel[], edges: RelationshipGraphEdgeModel[]): CharacterGraphNode[] {
  const relationshipCounts = new Map<string, number>()
  for (const edge of edges) {
    relationshipCounts.set(edge.source, (relationshipCounts.get(edge.source) ?? 0) + 1)
    relationshipCounts.set(edge.target, (relationshipCounts.get(edge.target) ?? 0) + 1)
  }
  return nodes.map(node => ({
    id: node.id,
    type: 'character',
    position: node.position,
    data: {
      name: node.name,
      role: node.role,
      relationships: relationshipCounts.get(node.id) ?? 0,
    },
  }))
}

function toFlowEdges(
  edges: RelationshipGraphEdgeModel[],
  nodes: readonly CharacterGraphNode[],
): RelationshipFlowEdge[] {
  const positions = new Map(nodes.map(node => [node.id, node.position]))
  return edges.flatMap((edge) => {
    const sourcePosition = positions.get(edge.source)
    const targetPosition = positions.get(edge.target)
    if (!sourcePosition || !targetPosition) return []
    return [{
      id: edge.id,
      type: 'relationship',
      source: edge.source,
      target: edge.target,
      sourceHandle: handleForDirection(sourcePosition, targetPosition, 'source'),
      targetHandle: handleForDirection(sourcePosition, targetPosition, 'target'),
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLORS[edge.tone] },
      data: {
        label: edge.label,
        tone: edge.tone,
        lane: edge.lane,
        sourceName: edge.sourceName,
        targetName: edge.targetName,
      },
    }]
  })
}

function CharacterGraphNodeView({ data, selected }: NodeProps<CharacterGraphNode>) {
  const text = useLocaleStore(state => state.text)
  const color = ROLE_COLORS[data.role] ?? ROLE_COLORS.minor
  const relationshipCount = data.relationships
  const [roleZhCN, roleEnUS] = ROLE_LABELS[data.role] ?? ROLE_LABELS.minor
  return (
    <div
      className="min-w-32 max-w-48 rounded-lg border px-3 py-2 shadow-sm transition-shadow"
      style={{
        borderColor: selected ? color : 'var(--color-border)',
        background: 'var(--color-raised)',
        boxShadow: selected ? `0 0 0 2px color-mix(in srgb, ${color} 24%, transparent)` : undefined,
      }}
      title={data.name}
      data-testid="relationship-graph-node"
      data-character-name={data.name}
    >
      {(['left', 'right', 'top', 'bottom'] as const).flatMap(side => [
        <Handle key={`source-${side}`} id={`source-${side}`} type="source" position={HANDLE_POSITIONS[side]} isConnectable={false} style={{ opacity: 0 }} />,
        <Handle key={`target-${side}`} id={`target-${side}`} type="target" position={HANDLE_POSITIONS[side]} isConnectable={false} style={{ opacity: 0 }} />,
      ])}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text)]">{data.name}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-muted)]">
        <span>{text(roleZhCN, roleEnUS)}</span>
        {relationshipCount > 0 && <span>{text(`${relationshipCount} 条关系`, `${relationshipCount} relations`)}</span>}
      </div>
    </div>
  )
}

function RelationshipEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
}: EdgeProps<RelationshipFlowEdge>) {
  const lane = typeof data?.lane === 'number' ? data.lane : 0
  const tone = data?.tone ?? 'neutral'
  const color = EDGE_COLORS[tone]
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const distance = Math.max(Math.hypot(dx, dy), 1)
  const normalX = -dy / distance
  const normalY = dx / distance
  const curveOffset = Math.max(-56, Math.min(56, lane * 18))
  const controlX = (sourceX + targetX) / 2 + normalX * curveOffset
  const controlY = (sourceY + targetY) / 2 + normalY * curveOffset
  const labelX = (sourceX + 2 * controlX + targetX) / 4
  const labelY = (sourceY + 2 * controlY + targetY) / 4
  const path = `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`
  const label = data?.label ?? ''

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: 1.8, opacity: 0.9 }} />
      <EdgeLabelRenderer>
        <span
          className="nodrag nopan absolute rounded border px-1.5 py-0.5 text-[10px] leading-none shadow-sm"
          data-testid="relationship-edge-label"
          title={label}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            borderColor: color,
            background: 'var(--color-raised)',
            color,
            pointerEvents: 'all',
          }}
        >
          {compactLabel(label)}
        </span>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { character: CharacterGraphNodeView }
const edgeTypes = { relationship: RelationshipEdgeView }

/**
 * Relationship visualisation deliberately remains a projection of the approved
 * roster. It gives every directed relation a separate labelled curve, while
 * editing facts continues to go through CharacterEditor and its revision guard.
 */
function RelationshipGraphSurface({
  characters,
  projectKey,
  onCharacterSelect,
  graphModel,
}: RelationshipGraphSurfaceProps) {
  const text = useLocaleStore(state => state.text)
  const [nodes, setNodes] = useState<CharacterGraphNode[]>(() => toFlowNodes(graphModel.nodes, graphModel.edges))
  const [edges, setEdges] = useState<RelationshipFlowEdge[]>(() => {
    const initialNodes = toFlowNodes(graphModel.nodes, graphModel.edges)
    return toFlowEdges(graphModel.edges, initialNodes)
  })
  const flowRef = useRef<ReactFlowInstance<CharacterGraphNode, RelationshipFlowEdge> | null>(null)

  const fitGraph = useCallback(() => {
    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.24, maxZoom: 1.15, duration: 180 })
    })
  }, [])

  const onNodesChange = useCallback((changes: NodeChange<CharacterGraphNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current))
  }, [])

  const persistLayout = useCallback((nextNodes: readonly CharacterGraphNode[]) => {
    writeRelationshipGraphPositions(
      projectKey,
      Object.fromEntries(nextNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }])),
    )
  }, [projectKey])

  const onNodeDragStop = useCallback((_event: React.MouseEvent, _node: CharacterGraphNode, nextNodes: CharacterGraphNode[]) => {
    setEdges(toFlowEdges(graphModel.edges, nextNodes))
    persistLayout(nextNodes)
  }, [graphModel.edges, persistLayout])

  const resetLayout = useCallback(() => {
    if (projectKey && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(relationshipGraphLayoutStorageKey(projectKey))
      } catch {
        // Resetting a local presentation preference is best-effort only.
      }
    }
    const resetModel = buildRelationshipGraphModel(characters)
    const resetNodes = toFlowNodes(resetModel.nodes, resetModel.edges)
    setNodes(resetNodes)
    setEdges(toFlowEdges(resetModel.edges, resetNodes))
    fitGraph()
  }, [characters, fitGraph, projectKey])

  if (characters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
        {text('暂无角色数据', 'No character data')}
      </div>
    )
  }

  return (
    <div className="h-full min-h-100 w-full" aria-label={text('角色关系图谱', 'Character relationship graph')}>
      <ReactFlow<CharacterGraphNode, RelationshipFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_event, node) => onCharacterSelect?.(node.data.name)}
        onInit={(instance) => {
          flowRef.current = instance
          fitGraph()
        }}
        fitView
        minZoom={0.25}
        maxZoom={2}
        nodesConnectable={false}
        edgesFocusable
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--color-bg)]"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)" />
        <Controls showInteractive={false} position="bottom-right" />
        {nodes.length > 6 && (
          <MiniMap
            position="bottom-left"
            maskColor="rgba(15, 23, 42, 0.08)"
            nodeColor={(node) => ROLE_COLORS[(node.data as CharacterGraphNodeData).role] ?? ROLE_COLORS.minor}
          />
        )}
        <Panel position="top-right" className="flex items-center gap-1 rounded-md border p-1 shadow-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
          <span className="px-1 text-[11px] text-[var(--color-text-muted)]">
            {text(`${edges.length} 条有向关系`, `${edges.length} directed relations`)}
          </span>
          <button type="button" className="rounded p-1 hover:bg-[var(--color-hover)]" title={text('适合视图', 'Fit graph')} aria-label={text('适合视图', 'Fit graph')} onClick={fitGraph}>
            <Maximize2 size={14} />
          </button>
          <button type="button" className="rounded p-1 hover:bg-[var(--color-hover)]" title={text('重置布局', 'Reset layout')} aria-label={text('重置布局', 'Reset layout')} onClick={resetLayout}>
            <RotateCcw size={14} />
          </button>
        </Panel>
      </ReactFlow>
    </div>
  )
}

export default function RelationshipGraph({ characters, projectKey, onCharacterSelect }: RelationshipGraphProps) {
  const graphKey = [projectKey ?? '', JSON.stringify(characters.map(character => [
    character.name,
    character.role,
    character.relationships,
  ]))].join('\u0000')
  const graphModel = useMemo(
    () => buildRelationshipGraphModel(characters, readRelationshipGraphPositions(projectKey)),
    [characters, projectKey],
  )

  return (
    <RelationshipGraphSurface
      key={graphKey}
      characters={characters}
      projectKey={projectKey}
      onCharacterSelect={onCharacterSelect}
      graphModel={graphModel}
    />
  )
}
