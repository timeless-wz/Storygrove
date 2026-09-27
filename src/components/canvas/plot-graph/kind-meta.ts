/**
 * 十种节点种类的元数据配置：图标、文案、语义配色与辅助信息。
 * 遵循主题一致性，全部基于主题语义或变量，不锁死单色。
 */

import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Film,
  Flag,
  Lightbulb,
  MapPin,
  Package,
  Shield,
  StickyNote,
  User,
  Zap,
} from 'lucide-react'

import type { PlotNodeKind } from './types'

export interface PlotNodeKindMeta {
  kind: PlotNodeKind
  labelZh: string
  labelEn: string
  icon: LucideIcon
  /** 语义强调色（CSS 颜色或主题变量值） */
  accentColor: string
  /** 边框高亮色 */
  borderColor: string
  /** 徽章背景色 */
  badgeBg: string
  /** 徽章文字色 */
  badgeText: string
  descriptionZh: string
  descriptionEn: string
}

export const PLOT_NODE_KIND_METAS: Record<PlotNodeKind, PlotNodeKindMeta> = {
  plot: {
    kind: 'plot',
    labelZh: '剧情',
    labelEn: 'Plot',
    icon: Film,
    accentColor: 'var(--color-accent, #f59e0b)',
    borderColor: 'color-mix(in srgb, var(--color-accent, #f59e0b) 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, var(--color-accent, #f59e0b) 14%, transparent)',
    badgeText: 'var(--color-accent, #f59e0b)',
    descriptionZh: '核心主线或支线剧情事件',
    descriptionEn: 'Core plot or sub-plot event',
  },
  idea: {
    kind: 'idea',
    labelZh: '灵感',
    labelEn: 'Idea',
    icon: Lightbulb,
    accentColor: '#06b6d4',
    borderColor: 'color-mix(in srgb, #06b6d4 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #06b6d4 14%, transparent)',
    badgeText: '#0891b2',
    descriptionZh: '突发构思、剧情脑洞与闪念',
    descriptionEn: 'Brainstorm, inspiration and thoughts',
  },
  foreshadow: {
    kind: 'foreshadow',
    labelZh: '伏笔',
    labelEn: 'Foreshadow',
    icon: Flag,
    accentColor: '#a855f7',
    borderColor: 'color-mix(in srgb, #a855f7 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #a855f7 14%, transparent)',
    badgeText: '#9333ea',
    descriptionZh: '暗线伏笔、悬念铺垫与前后呼应',
    descriptionEn: 'Foreshadowing, clue and setup',
  },
  character: {
    kind: 'character',
    labelZh: '角色',
    labelEn: 'Character',
    icon: User,
    accentColor: '#3b82f6',
    borderColor: 'color-mix(in srgb, #3b82f6 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #3b82f6 14%, transparent)',
    badgeText: '#2563eb',
    descriptionZh: '登场人物、阵营立场与角色动机',
    descriptionEn: 'Dramatis personae and motivations',
  },
  location: {
    kind: 'location',
    labelZh: '地点',
    labelEn: 'Location',
    icon: MapPin,
    accentColor: '#10b981',
    borderColor: 'color-mix(in srgb, #10b981 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #10b981 14%, transparent)',
    badgeText: '#059669',
    descriptionZh: '发生地点、地理空间与环境风貌',
    descriptionEn: 'Setting, geography and surroundings',
  },
  item: {
    kind: 'item',
    labelZh: '物品',
    labelEn: 'Item',
    icon: Package,
    accentColor: '#ea580c',
    borderColor: 'color-mix(in srgb, #ea580c 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #ea580c 14%, transparent)',
    badgeText: '#c2410c',
    descriptionZh: '关键道具、法宝秘典与信物',
    descriptionEn: 'Key prop, relic or manuscript',
  },
  faction: {
    kind: 'faction',
    labelZh: '势力',
    labelEn: 'Faction',
    icon: Shield,
    accentColor: '#8b5cf6',
    borderColor: 'color-mix(in srgb, #8b5cf6 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #8b5cf6 14%, transparent)',
    badgeText: '#7c3aed',
    descriptionZh: '门派宗族、势力组织与社会集团',
    descriptionEn: 'Organization, clan or faction',
  },
  skill: {
    kind: 'skill',
    labelZh: '功法',
    labelEn: 'Skill',
    icon: Zap,
    accentColor: '#ef4444',
    borderColor: 'color-mix(in srgb, #ef4444 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #ef4444 14%, transparent)',
    badgeText: '#dc2626',
    descriptionZh: '功法神术、超凡异能与战斗体系',
    descriptionEn: 'Technique, power or martial art',
  },
  chapter: {
    kind: 'chapter',
    labelZh: '章节',
    labelEn: 'Chapter',
    icon: BookOpen,
    accentColor: '#6366f1',
    borderColor: 'color-mix(in srgb, #6366f1 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, #6366f1 14%, transparent)',
    badgeText: '#4f46e5',
    descriptionZh: '所属章节或规划卷章挂靠',
    descriptionEn: 'Chapter reference or book division',
  },
  note: {
    kind: 'note',
    labelZh: '便签',
    labelEn: 'Note',
    icon: StickyNote,
    accentColor: 'var(--color-text-muted, #94a3b8)',
    borderColor: 'color-mix(in srgb, var(--color-text-muted, #94a3b8) 45%, var(--color-border))',
    badgeBg: 'color-mix(in srgb, var(--color-text-muted, #94a3b8) 14%, transparent)',
    badgeText: 'var(--color-text-secondary, #64748b)',
    descriptionZh: '备忘批注、临时便签与备用说明',
    descriptionEn: 'Memo, remark or auxiliary note',
  },
}

export function getPlotNodeKindMeta(kind?: PlotNodeKind): PlotNodeKindMeta {
  if (!kind || !(kind in PLOT_NODE_KIND_METAS)) {
    return PLOT_NODE_KIND_METAS.plot
  }
  return PLOT_NODE_KIND_METAS[kind]
}
