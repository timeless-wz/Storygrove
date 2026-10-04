import type { ReactNode } from 'react'
import type { WorldMapNode } from '../../shared/world-map'
import type { WorldPortal, WorldRecord } from '../../shared/world-workbench'
import type { WorldSectionKey } from '../../stores/world-workbench-store'

export interface WorldOverviewSummary {
  section: Exclude<WorldSectionKey, 'overview'>
  label: string
  count: number
  preview: string[]
}

export interface WorldOverviewConnection {
  id: string
  name: string
  fromWorldId: string
  fromWorldName: string | null
  toWorldId: string
  toWorldName: string | null
  bidirectional: boolean
  condition: string
  statusLabel: string
}

export interface WorldIntroductionProps {
  world: WorldRecord
  summaries: readonly WorldOverviewSummary[]
  connections: readonly WorldOverviewConnection[]
  editRequestToken: number
  saving: boolean
  saveError: string | null
  onSave: (world: Pick<WorldRecord, 'id' | 'name' | 'summary' | 'background' | 'notes'>) => Promise<WorldRecord | null>
  onNavigate: (section: WorldSectionKey) => void
  onCreate: (section: 'factions' | 'relics') => void
  onEditingChange: (editing: boolean) => void
}

export interface WorldNavigationPanelProps {
  worlds: readonly WorldRecord[]
  selectedWorldId: string | null
  loading: boolean
  loadError: string | null
  onSelect: (worldId: string) => void | Promise<void>
  onRetry: () => void
}

export interface WorldConnectionsSectionProps {
  worldId: string
  worlds: readonly WorldRecord[]
  portals: readonly WorldPortal[]
  nodes: readonly Pick<WorldMapNode, 'id' | 'name' | 'mapId'>[]
  onEdit: (portalId: string) => void
  onDelete: (portalId: string) => void
  onOpenMapAt: (mapId: string, nodeId: string) => void
  renderRelations?: (portal: WorldPortal) => ReactNode
}
