import {
  Anchor, BedDouble, Castle, DoorOpen, Flag, Globe2, House, Landmark,
  Mountain, Pickaxe, Pyramid, Signpost, Store, Tent, TowerControl, Trees,
  type LucideIcon,
} from 'lucide-react'
import type { WorldMapMarkerIcon } from '../../shared/world-map'

export const WORLD_MAP_MARKER_ICONS: Record<WorldMapMarkerIcon, LucideIcon> = {
  globe: Globe2, mountain: Mountain, castle: Castle, house: House,
  temple: Landmark, gate: DoorOpen, port: Anchor, ruins: Pyramid,
  signpost: Signpost, flag: Flag, forest: Trees, camp: Tent,
  mine: Pickaxe, shop: Store, inn: BedDouble, tower: TowerControl,
}
