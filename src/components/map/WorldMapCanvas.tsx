import { useState, useRef, useEffect, useCallback } from 'react'
import {
  type WorldMapNode,
  type WorldMapEdge,
  type WorldMapNodeType,
  WORLD_MAP_NODE_TYPE_LABELS,
  WORLD_MAP_EDGE_TYPE_LABELS,
} from '../../shared/world-map'
import { useLocaleStore } from '../../stores/locale-store'

interface Props {
  /** 当前地图自己的地点；画布绝不显示其他地图的地点。 */
  nodes: WorldMapNode[]
  edges: WorldMapEdge[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /** 当前地图自己的托管图片；随同画布的平移和缩放显示。 */
  backgroundImage?: string | null
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
  onUpdateNodePosition: (id: string, x: number, y: number) => void
  onDoubleNodeClick?: (node: WorldMapNode) => void
}

const TYPE_COLORS: Record<WorldMapNodeType, { bg: string; border: string; text: string }> = {
  world: { bg: 'rgba(99, 102, 241, 0.25)', border: 'rgb(99, 102, 241)', text: 'rgb(165, 180, 252)' },
  region: { bg: 'rgba(14, 165, 233, 0.25)', border: 'rgb(14, 165, 233)', text: 'rgb(125, 211, 252)' },
  city: { bg: 'rgba(234, 179, 8, 0.25)', border: 'rgb(234, 179, 8)', text: 'rgb(253, 224, 71)' },
  relic: { bg: 'rgba(239, 68, 68, 0.25)', border: 'rgb(239, 68, 68)', text: 'rgb(252, 165, 165)' },
  route_node: { bg: 'rgba(168, 85, 247, 0.25)', border: 'rgb(168, 85, 247)', text: 'rgb(216, 180, 254)' },
  landmark: { bg: 'rgba(34, 197, 94, 0.25)', border: 'rgb(34, 197, 94)', text: 'rgb(134, 239, 172)' },
  faction: { bg: 'rgba(249, 115, 22, 0.25)', border: 'rgb(249, 115, 22)', text: 'rgb(253, 186, 116)' },
}

const EDGE_STYLES: Record<string, { stroke: string; dash?: string; marker: string }> = {
  route: { stroke: 'rgba(125, 211, 252, 0.7)', marker: 'arrow-route' },
  adjacent: { stroke: 'rgba(148, 163, 184, 0.6)', dash: '4,4', marker: 'arrow-adj' },
  subordinate: { stroke: 'rgba(99, 102, 241, 0.7)', dash: '6,3', marker: 'arrow-sub' },
  portal: { stroke: 'rgba(192, 132, 252, 0.85)', dash: '3,3', marker: 'arrow-portal' },
  conflict: { stroke: 'rgba(239, 68, 68, 0.85)', marker: 'arrow-conflict' },
}

export default function WorldMapCanvas({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  backgroundImage,
  onSelectNode,
  onSelectEdge,
  onUpdateNodePosition,
  onDoubleNodeClick,
}: Props) {
  const text = useLocaleStore(s => s.text)
  const containerRef = useRef<HTMLDivElement>(null)

  // Zoom & pan
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const startPanRef = useRef({ x: 0, y: 0 })

  // Node dragging
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 })
  const currentDragPosRef = useRef<{ id: string; x: number; y: number } | null>(null)

  const visibleNodes = nodes
  const visibleNodeMap = new Map(visibleNodes.map(n => [n.id, n]))

  // Only connections whose both endpoints belong to this map are ever drawn.
  const visibleEdges = edges.filter(e => visibleNodeMap.has(e.fromNodeId) && visibleNodeMap.has(e.toNodeId))

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
    setZoom(prev => Math.min(Math.max(prev * zoomFactor, 0.3), 3))
  }

  // Pan start
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && e.target === containerRef.current || (e.target as HTMLElement)?.tagName === 'svg') {
      setIsPanning(true)
      startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
      onSelectNode(null)
      onSelectEdge(null)
    }
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPanRef.current.x,
        y: e.clientY - startPanRef.current.y,
      })
    } else if (draggingNodeId) {
      const dx = (e.clientX - dragStartRef.current.mouseX) / zoom
      const dy = (e.clientY - dragStartRef.current.mouseY) / zoom
      const newX = Math.round(dragStartRef.current.nodeX + dx)
      const newY = Math.round(dragStartRef.current.nodeY + dy)
      currentDragPosRef.current = { id: draggingNodeId, x: newX, y: newY }

      // Direct DOM update for smooth dragging
      const el = document.getElementById(`map-node-${draggingNodeId}`)
      if (el) {
        el.setAttribute('transform', `translate(${newX}, ${newY})`)
      }
    }
  }, [isPanning, draggingNodeId, zoom])

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false)
    }
    if (draggingNodeId) {
      if (currentDragPosRef.current) {
        onUpdateNodePosition(
          currentDragPosRef.current.id,
          currentDragPosRef.current.x,
          currentDragPosRef.current.y,
        )
      }
      setDraggingNodeId(null)
      currentDragPosRef.current = null
    }
  }, [isPanning, draggingNodeId, onUpdateNodePosition])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const startDragNode = (e: React.MouseEvent, node: WorldMapNode) => {
    e.stopPropagation()
    onSelectNode(node.id)
    setDraggingNodeId(node.id)
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-[var(--color-bg)]"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
    >
      {/* Background grid pattern */}
      <svg
        className="w-full h-full"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="0.5"
              strokeOpacity="0.4"
            />
          </pattern>
          {/* Arrow markers */}
          <marker id="arrow-route" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(125, 211, 252, 0.8)" />
          </marker>
          <marker id="arrow-adj" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148, 163, 184, 0.7)" />
          </marker>
          <marker id="arrow-sub" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(99, 102, 241, 0.8)" />
          </marker>
          <marker id="arrow-portal" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(192, 132, 252, 0.9)" />
          </marker>
          <marker id="arrow-conflict" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(239, 68, 68, 0.9)" />
          </marker>
        </defs>

        {/* Grid surface */}
        <rect width="8000" height="8000" x="-4000" y="-4000" fill="url(#grid)" />

        {backgroundImage && (
          <image
            href={backgroundImage}
            x="0"
            y="0"
            width="1200"
            height="900"
            preserveAspectRatio="xMidYMid meet"
            opacity="0.78"
            pointerEvents="none"
          />
        )}

        {/* Edges */}
        {visibleEdges.map(edge => {
          const fromNode = visibleNodeMap.get(edge.fromNodeId)
          const toNode = visibleNodeMap.get(edge.toNodeId)
          if (!fromNode || !toNode) return null

          const isSelected = edge.id === selectedEdgeId
          const style = EDGE_STYLES[edge.type] || EDGE_STYLES.route

          const midX = (fromNode.x + toNode.x) / 2
          const midY = (fromNode.y + toNode.y) / 2

          return (
            <g key={edge.id} className="cursor-pointer" onClick={e => { e.stopPropagation(); onSelectEdge(edge.id) }}>
              <line
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke={isSelected ? 'var(--color-accent)' : style.stroke}
                strokeWidth={isSelected ? 3 : 1.8}
                strokeDasharray={style.dash}
                markerEnd={`url(#${style.marker})`}
              />
              {/* Edge label */}
              <text
                x={midX}
                y={midY - 6}
                textAnchor="middle"
                fontSize="10"
                fill={isSelected ? 'var(--color-accent)' : 'var(--color-text-muted)'}
                className="pointer-events-none"
              >
                {edge.description || text(WORLD_MAP_EDGE_TYPE_LABELS[edge.type]?.zh || edge.type, edge.type)}
              </text>
            </g>
          )
        })}

        {/* Nodes */}
        {visibleNodes.map(node => {
          const isSelected = node.id === selectedNodeId
          const color = TYPE_COLORS[node.type] || TYPE_COLORS.landmark

          return (
            <g
              id={`map-node-${node.id}`}
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-move"
              onMouseDown={e => startDragNode(e, node)}
              onDoubleClick={() => onDoubleNodeClick?.(node)}
            >
              {/* Selected halo */}
              {isSelected && (
                <circle
                  r={26}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="2.5"
                  strokeDasharray="4,2"
                />
              )}

              {/* Node background circle */}
              <circle
                r={18}
                fill={color.bg}
                stroke={isSelected ? 'var(--color-accent)' : color.border}
                strokeWidth={isSelected ? 2.5 : 1.5}
              />

              {/* Center point */}
              <circle
                r={4}
                fill={color.border}
              />

              {/* Node Name */}
              <text
                y={30}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill={isSelected ? 'var(--color-accent)' : 'var(--color-text)'}
                className="pointer-events-none"
              >
                {node.name}
              </text>

              {/* Node Type Badge */}
              <text
                y={42}
                textAnchor="middle"
                fontSize="9"
                fill={color.text}
                className="pointer-events-none"
              >
                {text(WORLD_MAP_NODE_TYPE_LABELS[node.type]?.zh || node.type, node.type)}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Mini zoom controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-1 text-xs">
        <button
          type="button"
          className="px-2 py-1 hover:bg-[var(--color-hover)] rounded"
          onClick={() => setZoom(z => Math.max(z * 0.8, 0.3))}
          title="Zoom out"
        >
          -
        </button>
        <span className="px-1 text-[11px] text-[var(--color-text-muted)] min-w-10 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="px-2 py-1 hover:bg-[var(--color-hover)] rounded"
          onClick={() => setZoom(z => Math.min(z * 1.2, 3))}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="px-2 py-1 hover:bg-[var(--color-hover)] rounded text-[11px]"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
          title="Reset"
        >
          {text('重置', 'Reset')}
        </button>
      </div>
    </div>
  )
}
