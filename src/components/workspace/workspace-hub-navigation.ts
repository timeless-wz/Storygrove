/**
 * 资料中枢导航与来源权威状态的数据定义。
 *
 * 与 WorkspaceHubNavigation.tsx 分离，便于单独测试这些映射，
 * 也避免组件文件同时导出非组件常量。
 */

import {
  BookMarked,
  Database,
  FileCheck2,
  FileText,
  Gauge,
  Layers,
  ShieldCheck,
} from 'lucide-react'
import type { WorkspaceAuthorityStatus } from '../../shared/workspace-hub'
import type { WorkspaceHubTab } from '../../stores/workspace-hub-store'
import type { BilingualLabel } from './story-data-taxonomy'

export interface WorkspaceTabDefinition {
  id: WorkspaceHubTab
  label: BilingualLabel
  icon: typeof FileText
}

export interface WorkspaceTabGroup {
  id: string
  label: BilingualLabel
  description: BilingualLabel
  tabs: readonly WorkspaceTabDefinition[]
}

/**
 * 八个功能页分成三组。
 *
 * 「故事资料中心」属于事实与来源管理，因此与「审核与检索」同组，
 * 不与长篇控制台或章节工作台混在一起。
 */
export const WORKSPACE_TAB_GROUPS: readonly WorkspaceTabGroup[] = [
  {
    id: 'sources',
    label: { zh: '资料与来源', en: 'Sources & provenance' },
    description: {
      zh: '外部母稿、片段解析与章节上下文装配',
      en: 'External manuscripts, fragment parsing, and chapter context assembly',
    },
    tabs: [
      { id: 'sources', label: { zh: '资料清单与片段', en: 'Sources & Fragments' }, icon: FileText },
      { id: 'rules', label: { zh: '结构化设定规则', en: 'Structured Setting Rules' }, icon: BookMarked },
      { id: 'context', label: { zh: '章节上下文装配包', en: 'Chapter Context Package' }, icon: Layers },
    ],
  },
  {
    id: 'facts',
    label: { zh: '事实与检索', en: 'Facts & retrieval' },
    description: {
      zh: '正式事实、候选资料、来源追溯与资料审计',
      en: 'Authoritative facts, candidates, provenance, and data audit',
    },
    tabs: [
      { id: 'story-data', label: { zh: '故事资料中心', en: 'Story Data Center' }, icon: Database },
      { id: 'audit', label: { zh: '审核与检索', en: 'Audit & Search' }, icon: ShieldCheck },
    ],
  },
  {
    id: 'longform',
    label: { zh: '长篇控制与修订', en: 'Long-form & revision' },
    description: {
      zh: '长篇控制台、章节创作工作台与全书修订',
      en: 'Long-form console, chapter workbench, and book revision',
    },
    tabs: [
      { id: 'control', label: { zh: '长篇控制台', en: 'Long-form Console' }, icon: Gauge },
      { id: 'workbench', label: { zh: '章节创作工作台', en: 'Chapter Workbench' }, icon: FileText },
      { id: 'revision', label: { zh: '全书修订', en: 'Book Revision' }, icon: FileCheck2 },
    ],
  },
]

/**
 * 来源权威状态的含义。
 *
 * 与 shared/workspace-hub.ts 的 WorkspaceAuthorityStatus 一一对应：
 * 扫描可以产生候选与素材，但不能产生「已确认」。
 */
export const AUTHORITY_STATUS_PRESENTATION: readonly {
  status: WorkspaceAuthorityStatus
  label: BilingualLabel
  detail: BilingualLabel
}[] = [
  {
    status: 'confirmed',
    label: { zh: '已确认', en: 'Confirmed' },
    detail: {
      zh: '作者认可的世界规则与硬约束，可进入上下文',
      en: 'Author-approved world rules and hard constraints; may enter context',
    },
  },
  {
    status: 'candidate',
    label: { zh: '候选', en: 'Candidate' },
    detail: {
      zh: '扫描或模型产出，需作者确认后才具备权威',
      en: 'Scan or model output; carries authority only after author confirmation',
    },
  },
  {
    status: 'background',
    label: { zh: '后台', en: 'Background' },
    detail: {
      zh: '按相关性调用，不默认整篇注入',
      en: 'Called by relevance, never bulk-injected',
    },
  },
  {
    status: 'deprecated',
    label: { zh: '废止', en: 'Deprecated' },
    detail: {
      zh: '保留追溯，严禁注入上下文',
      en: 'Retained for traceability, never injected into context',
    },
  },
  {
    status: 'reference',
    label: { zh: '参考', en: 'Reference' },
    detail: {
      zh: '创作方法与禁区，不是故事内事实',
      en: 'Methodology and taboo boundaries, not in-story facts',
    },
  },
  {
    status: 'material',
    label: { zh: '素材', en: 'Material' },
    detail: {
      zh: '可取材的原始素材，不作为设定',
      en: 'Raw material for sourcing, not settings',
    },
  },
]
