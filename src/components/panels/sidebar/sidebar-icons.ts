import { createElement, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import {
  Target, Users, Globe, Map, BookOpen, FolderTree, LayoutList,
  FilePen, PenTool, BrainCircuit, Sparkles, FolderOpen, Zap,
  FileText, MessageCircle, RefreshCw, GitCompare, GitBranch, Archive, RotateCcw,
  Compass, LayoutDashboard, Clock3, Bookmark, Globe2, BarChart3,
} from 'lucide-react'

type SidebarIcon = ComponentType<{ size?: number; className?: string; style?: CSSProperties }>

const ICON_MAP: Record<string, SidebarIcon> = {
  target: Target,
  users: Users,
  globe: Globe,
  'globe-2': Globe2,
  map: Map,
  compass: Compass,
  'layout-dashboard': LayoutDashboard,
  'clock-3': Clock3,
  bookmark: Bookmark,
  'book-open': BookOpen,
  'folder-tree': FolderTree,
  'layout-list': LayoutList,
  'file-pen': FilePen,
  'pen-tool': PenTool,
  'brain-circuit': BrainCircuit,
  sparkles: Sparkles,
  'folder-open': FolderOpen,
  zap: Zap,
  'file-text': FileText,
  'message-circle': MessageCircle,
  'refresh-cw': RefreshCw,
  'git-compare': GitCompare,
  'git-branch': GitBranch,
  archive: Archive,
  'rotate-ccw': RotateCcw,
  'bar-chart-3': BarChart3,
}

/** 根据 iconName 渲染 Lucide 图标；未找到时返回空占位。 */
export function renderIcon(iconName: string, size = 14, style?: CSSProperties): ReactNode {
  const Icon = ICON_MAP[iconName]
  if (!Icon) {
    return createElement('span', {
      style: { width: size, height: size, display: 'inline-block', flexShrink: 0, ...style },
    })
  }
  return createElement(Icon, { size, style: { flexShrink: 0, ...style } })
}
