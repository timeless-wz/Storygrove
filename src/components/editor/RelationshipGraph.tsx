import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
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
import { Link2, Maximize2, User, X } from 'lucide-react'
import { useCharacterStore } from '../../stores/character-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import RelationshipModal from './RelationshipModal'
import type {
  CharacterSharedRelationship,
  CharacterGraphPosition,
} from '../../shared/character-relationship'
import { isMatchingRelationship } from '../../shared/character-relationship'

/** 画布只需要稳定 ID + 展示名 + 定位标签：关系事实一律来自共享关系表。 */
export interface RelationshipGraphCharacter {
  id: string
  name: string
  role: string
}

export interface RelationshipGraphProps {
  characters: RelationshipGraphCharacter[]
  projectKey?: string
  onCharacterSelect?: (name: string) => void
}

export type CharacterGraphNodeData = {
  characterId: string
  name: string
  role: string
  relationshipsCount: number
  avatar?: string
  isConnectSource?: boolean
  onContextMenu?: (event: React.MouseEvent, characterId: string, characterName: string) => void
}

export type CharacterGraphNode = Node<CharacterGraphNodeData, 'character'>

export type RelationshipFlowEdgeData = {
  relation: string
  description?: string
  character1Name: string
  character2Name: string
  relationship: CharacterSharedRelationship
  onEdgeClick?: (relationship: CharacterSharedRelationship) => void
}

export type RelationshipFlowEdge = Edge<RelationshipFlowEdgeData, 'relationship'>

const ROLE_COLORS: Record<string, string> = {
  protagonist: 'var(--color-role-protagonist, #2563eb)',
  antagonist: 'var(--color-role-antagonist, #dc2626)',
  supporting: 'var(--color-role-supporting, #7c3aed)',
  minor: 'var(--color-role-minor, #64748b)',
}

const ROLE_LABELS: Record<string, [string, string]> = {
  protagonist: ['主角', 'Protagonist'],
  antagonist: ['反派', 'Antagonist'],
  supporting: ['配角', 'Supporting'],
  minor: ['其他', 'Other'],
  unassigned: ['暂未设定', 'Not set yet'],
}

function compactLabel(value: string, maxCharacters = 12): string {
  const characters = Array.from(value.trim())
  return characters.length > maxCharacters
    ? `${characters.slice(0, maxCharacters).join('')}…`
    : characters.join('')
}

function CharacterGraphNodeView({ data, selected }: NodeProps<CharacterGraphNode>) {
  const text = useLocaleStore(state => state.text)
  const roleColor = ROLE_COLORS[data.role] ?? ROLE_COLORS.minor
  const [roleZhCN, roleEnUS] = ROLE_LABELS[data.role] ?? ROLE_LABELS.minor
  const isSource = data.isConnectSource

  return (
    <div
      className="group relative flex flex-col items-center cursor-pointer select-none"
      data-testid="relationship-graph-node"
      data-character-id={data.characterId}
      data-character-name={data.name}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        data.onContextMenu?.(e, data.characterId, data.name)
      }}
    >
      {/* Invisible Handles around the circle for smooth edge routing */}
      <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="source" position={Position.Left} id="left" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="target" position={Position.Top} id="t-top" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ opacity: 0 }} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ opacity: 0 }} isConnectable={false} />

      {/* Circular Node Body (64px x 64px) */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center shadow-md transition-transform group-hover:scale-105"
        style={{
          backgroundColor: roleColor,
          border: isSource
            ? '3px solid var(--color-accent, #3b82f6)'
            : selected
              ? `3px solid ${roleColor}`
              : '2px solid rgba(255, 255, 255, 0.9)',
          boxShadow: isSource
            ? '0 0 0 4px color-mix(in srgb, var(--color-accent, #3b82f6) 40%, transparent)'
            : selected
              ? `0 0 0 4px color-mix(in srgb, ${roleColor} 30%, transparent)`
              : undefined,
        }}
      >
        {data.avatar ? (
          <img
            src={data.avatar}
            alt={data.name}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="text-xl font-bold text-white tracking-wide">
            {data.name.slice(0, 1)}
          </span>
        )}
      </div>

      {/* Centered Name and Role Tag below circle */}
      <div className="mt-1.5 flex flex-col items-center max-w-28 text-center pointer-events-none">
        <span
          className="text-xs font-semibold text-[var(--color-text)] truncate max-w-24 leading-tight"
          title={data.name}
        >
          {data.name}
        </span>
        <span
          className="mt-0.5 inline-block rounded-full px-1.5 py-0.2 text-[10px] font-medium border leading-tight"
          style={{
            borderColor: roleColor,
            color: roleColor,
            backgroundColor: 'var(--color-bg, #ffffff)',
          }}
        >
          {text(roleZhCN, roleEnUS)}
        </span>
      </div>
    </div>
  )
}

function RelationshipEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<RelationshipFlowEdge>) {
  const labelX = (sourceX + targetX) / 2
  const labelY = (sourceY + targetY) / 2
  const path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`
  const label = data?.relation ?? ''

  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: 'var(--color-text-muted, #94a3b8)',
          strokeWidth: 2,
          opacity: 0.8,
          cursor: 'pointer',
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          data-testid="relationship-edge-chip"
          className="nodrag nopan absolute rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-sm transition-all hover:scale-105 cursor-pointer"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-raised, #ffffff)',
            color: 'var(--color-text)',
            pointerEvents: 'all',
            zIndex: 1000,
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (data?.relationship) data.onEdgeClick?.(data.relationship)
          }}
          title={data?.description ? `${label}：${data.description}` : label}
        >
          {compactLabel(label)}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { character: CharacterGraphNodeView }
const edgeTypes = { relationship: RelationshipEdgeView }

interface ModalState {
  open: boolean
  character1: RelationshipGraphCharacter
  character2: RelationshipGraphCharacter
  existing: CharacterSharedRelationship | null
}

const EMPTY_CHARACTER: RelationshipGraphCharacter = { id: '', name: '', role: 'minor' }

/**
 * 可编辑的共用关系画布。
 *
 * 节点、连线与坐标全部以稳定人物 ID 为身份：改名只影响展示名。
 * 关系事实只来自共享关系表（store.relationships），不再从角色卡旧
 * relationships 字段推导连线。
 */
export default function RelationshipGraph({
  characters,
  projectKey: _projectKey,
  onCharacterSelect,
}: RelationshipGraphProps) {
  const text = useLocaleStore(state => state.text)
  const relationships = useCharacterStore(state => state.relationships)
  const graphPositions = useCharacterStore(state => state.graphPositions)
  const upsertRelationship = useCharacterStore(state => state.upsertRelationship)
  const deleteRelationship = useCharacterStore(state => state.deleteRelationship)
  const saveGraphPositions = useCharacterStore(state => state.saveGraphPositions)

  const [isConnectMode, setIsConnectMode] = useState(false)
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    type: 'pane' | 'node'
    characterId?: string
    characterName?: string
  } | null>(null)
  const [connectNotice, setConnectNotice] = useState<string | null>(null)

  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    character1: EMPTY_CHARACTER,
    character2: EMPTY_CHARACTER,
    existing: null,
  })

  const flowRef = useRef<ReactFlowInstance<CharacterGraphNode, RelationshipFlowEdge> | null>(null)

  const characterById = useMemo(
    () => new Map(characters.filter(character => character.id && character.name.trim()).map(character => [character.id, character])),
    [characters],
  )

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, characterId: string, characterName: string) => {
      setContextMenu({ x: event.clientX, y: event.clientY, type: 'node', characterId, characterName })
    },
    [],
  )

  // Generate nodes from characters & stored positions (positions keyed by character ID)
  const initialNodes = useMemo(() => {
    const visible = characters.filter(character => character.name.trim())
    const count = visible.length
    const relationshipCount = new Map<string, number>()
    for (const rel of relationships) {
      if (rel.character1Id) relationshipCount.set(rel.character1Id, (relationshipCount.get(rel.character1Id) ?? 0) + 1)
      if (rel.character2Id) relationshipCount.set(rel.character2Id, (relationshipCount.get(rel.character2Id) ?? 0) + 1)
    }

    return visible.map((character, index) => {
      const storedPosition = character.id ? graphPositions[character.id] : undefined
      let pos: { x: number; y: number }
      if (storedPosition && typeof storedPosition.x === 'number' && typeof storedPosition.y === 'number') {
        pos = { x: storedPosition.x, y: storedPosition.y }
      } else {
        const angle = count > 1 ? (index / count) * 2 * Math.PI - Math.PI / 2 : 0
        const radius = Math.max(160, count * 35)
        pos = {
          x: Math.round(360 + radius * Math.cos(angle)),
          y: Math.round(260 + radius * Math.sin(angle)),
        }
      }

      return {
        // 尚未落盘的角色还没有稳定 ID，先用姓名占位保证画布完整；
        // 它不能建立关系（保存后由主进程补齐身份）。
        id: character.id || `pending:${character.name}`,
        type: 'character' as const,
        position: pos,
        data: {
          characterId: character.id,
          name: character.name,
          role: character.role,
          relationshipsCount: relationshipCount.get(character.id) ?? 0,
          isConnectSource: connectSourceId === character.id,
          onContextMenu: handleNodeContextMenu,
        },
      }
    })
  }, [characters, relationships, graphPositions, connectSourceId, handleNodeContextMenu])

  const [nodes, setNodes] = useState<CharacterGraphNode[]>(initialNodes)

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes])

  const edges = useMemo<RelationshipFlowEdge[]>(() => {
    const nodeIds = new Set(nodes.map(node => node.id))
    return relationships.flatMap((rel) => {
      if (!rel.character1Id || !rel.character2Id) return []
      if (!nodeIds.has(rel.character1Id) || !nodeIds.has(rel.character2Id)) return []
      return [{
        id: `relationship-edge-${rel.id}`,
        type: 'relationship' as const,
        source: rel.character1Id,
        target: rel.character2Id,
        data: {
          relation: rel.relation,
          description: rel.description,
          character1Name: rel.character1Name,
          character2Name: rel.character2Name,
          relationship: rel,
          onEdgeClick: (relationship: CharacterSharedRelationship) => {
            setContextMenu(null)
            const first = characterById.get(relationship.character1Id)
            const second = characterById.get(relationship.character2Id)
            if (!first || !second) return
            setModalState({ open: true, character1: first, character2: second, existing: relationship })
          },
        },
      }]
    })
  }, [relationships, nodes, characterById])

  const onNodesChange = useCallback((changes: NodeChange<CharacterGraphNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current))
  }, [])

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, _node: CharacterGraphNode, nextNodes: CharacterGraphNode[]) => {
      // 坐标主键是人物 ID：改名不会让已拖拽的位置失效。
      const positionsToSave: Record<string, CharacterGraphPosition> = {}
      for (const node of nextNodes) {
        positionsToSave[node.id] = {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        }
      }
      void saveGraphPositions(positionsToSave)
    },
    [saveGraphPositions],
  )

  const fitGraph = useCallback(() => {
    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.24, maxZoom: 1.15, duration: 180 })
    })
  }, [])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: CharacterGraphNode) => {
      setContextMenu(null)
      const clickedId = node.data.characterId
      const clickedName = node.data.name

      if (!isConnectMode) {
        onCharacterSelect?.(clickedName)
        return
      }
      if (!clickedId) {
        setConnectNotice(text('该角色尚未保存，保存后才能建立关系。', 'Save this character before connecting.'))
        return
      }
      setConnectNotice(null)
      if (!connectSourceId) {
        setConnectSourceId(clickedId)
        return
      }
      if (connectSourceId === clickedId) {
        setConnectSourceId(null)
        return
      }

      const source = characterById.get(connectSourceId)
      const target = characterById.get(clickedId)
      if (!source || !target) {
        setConnectSourceId(null)
        return
      }
      // 两个人之间只有一条共用关系：已有关系时打开编辑，而不是新增重复连线。
      const existing = relationships.find(rel => isMatchingRelationship(rel, connectSourceId, clickedId))
      setModalState({ open: true, character1: source, character2: target, existing: existing ?? null })
      setIsConnectMode(false)
      setConnectSourceId(null)
    },
    [characterById, connectSourceId, isConnectMode, onCharacterSelect, relationships, text],
  )

  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, type: 'pane' })
  }, [])

  const toggleConnectMode = useCallback(() => {
    setConnectNotice(null)
    setIsConnectMode(prev => {
      if (prev) {
        setConnectSourceId(null)
        return false
      }
      return true
    })
  }, [])

  const handlePaneClick = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleModalSave = async (data: { relation: string; description?: string }) => {
    await upsertRelationship({
      id: modalState.existing?.id,
      character1Id: modalState.character1.id,
      character2Id: modalState.character2.id,
      relation: data.relation,
      description: data.description,
    })
  }

  const handleModalDelete = async () => {
    if (modalState.existing?.id) {
      await deleteRelationship(modalState.existing.id)
    }
  }

  if (characters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
        {text('暂无角色数据', 'No character data')}
      </div>
    )
  }

  const connectSourceName = connectSourceId ? characterById.get(connectSourceId)?.name ?? '' : ''

  return (
    <div
      className="relative h-full min-h-100 w-full select-none"
      aria-label={text('角色关系图谱', 'Character relationship graph')}
      onClick={handlePaneClick}
    >
      <ReactFlow<CharacterGraphNode, RelationshipFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={handleNodeClick}
        onPaneContextMenu={handlePaneContextMenu}
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
        {/* Story timeline fine dot background */}
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border)" />

        {/* Bottom right zoom & fit controls */}
        <Controls showInteractive={false} position="bottom-right" />

        {/* Top Right Tool Panel */}
        <Panel
          position="top-right"
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel, var(--color-bg))' }}
        >
          <span className="text-xs text-[var(--color-text-muted)]">
            {text(`${edges.length} 条关系`, `${edges.length} relations`)}
          </span>

          <Button
            size="sm"
            variant={isConnectMode ? 'default' : 'outline'}
            data-testid="relationship-connect-mode-button"
            onClick={toggleConnectMode}
            className="gap-1 text-xs"
          >
            <Link2 size={13} />
            <span>{isConnectMode ? text('退出连线', 'Cancel Connect') : text('建立关系', 'Connect')}</span>
          </Button>

          <button
            type="button"
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
            title={text('适合视图', 'Fit view')}
            aria-label={text('适合视图', 'Fit view')}
            onClick={fitGraph}
          >
            <Maximize2 size={14} />
          </button>
        </Panel>

        {/* 未保存角色不能连线的提示 */}
        {connectNotice && (
          <Panel
            position="top-center"
            className="flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs shadow-md"
            style={{
              backgroundColor: 'var(--color-panel, var(--color-bg))',
              borderColor: 'var(--color-warning-text, #d97706)',
              color: 'var(--color-warning-text, #d97706)',
            }}
            data-testid="relationship-connect-notice"
          >
            <span>{connectNotice}</span>
            <button
              type="button"
              className="ml-1 rounded-full p-0.5 hover:bg-[var(--color-hover)]"
              onClick={() => setConnectNotice(null)}
              aria-label={text('关闭提示', 'Dismiss')}
            >
              <X size={12} />
            </button>
          </Panel>
        )}

        {/* Connect Mode Helper Indicator */}
        {isConnectMode && (
          <Panel
            position="top-center"
            className="flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs shadow-md bg-[var(--color-panel,var(--color-bg))] border-[var(--color-accent,#3b82f6)] text-[var(--color-accent,#3b82f6)] font-medium"
          >
            <Link2 size={13} className="animate-pulse" />
            <span>
              {!connectSourceId
                ? text('连线模式：请先点击第一个人物节点', 'Connect mode: Click the first character')
                : text(`已选「${connectSourceName}」，请点击第二个人物节点建立关系`, `Selected “${connectSourceName}”, click the second character`)}
            </span>
            <button
              type="button"
              className="ml-1 rounded-full p-0.5 hover:bg-[var(--color-hover)]"
              onClick={() => {
                setIsConnectMode(false)
                setConnectSourceId(null)
              }}
            >
              <X size={12} />
            </button>
          </Panel>
        )}
      </ReactFlow>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-32 rounded-lg border py-1 shadow-lg text-xs"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.type === 'pane' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-hover)] text-left"
              onClick={() => {
                setContextMenu(null)
                fitGraph()
              }}
            >
              <Maximize2 size={13} />
              <span>{text('适应视图', 'Fit View')}</span>
            </button>
          )}

          {contextMenu.type === 'node' && contextMenu.characterId && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-hover)] text-left"
                onClick={() => {
                  const targetId = contextMenu.characterId
                  setContextMenu(null)
                  setIsConnectMode(true)
                  if (targetId) {
                    setConnectNotice(null)
                    setConnectSourceId(targetId)
                    return
                  }
                  setConnectSourceId(null)
                  setConnectNotice(text('该角色尚未保存，保存后才能建立关系。', 'Save this character before connecting.'))
                }}
              >
                <Link2 size={13} />
                <span>{text('建立关系', 'Connect')}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-hover)] text-left"
                onClick={() => {
                  const targetName = contextMenu.characterName
                    ?? characterById.get(contextMenu.characterId ?? '')?.name
                  setContextMenu(null)
                  if (targetName) onCharacterSelect?.(targetName)
                }}
              >
                <User size={13} />
                <span>{text('打开人物卡', 'Open Character Card')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Relationship Edit/Create Modal */}
      <RelationshipModal
        open={modalState.open}
        character1={modalState.character1}
        character2={modalState.character2}
        initialRelationship={modalState.existing}
        onClose={() => setModalState(prev => ({ ...prev, open: false }))}
        onSave={handleModalSave}
        onDelete={modalState.existing?.id ? handleModalDelete : undefined}
      />
    </div>
  )
}
