/**
 * 故事资料中心的分类与权威状态映射。
 *
 * 本模块只做纯计算与文案映射，不持有任何资料：事实、候选、来源快照
 * 始终以 story-data-store 与 workspace-hub-store 的数据为准。
 *
 * 边界约定（与 shared/story-domain.ts 一致）：
 *   - `StoryFactCandidate` 是模型/扫描提交的候选，只有 reviewStatus；
 *   - `StoryFact` 是正式资料库记录，status 为 confirmed / candidate / deprecated；
 *   - 仅 `confirmed` 记录具备事实权威，`deprecated` 记录不进入正文与生成上下文。
 */

import type {
  StoryCandidateReviewStatus,
  StoryEntityType,
  StoryFact,
  StoryFactCandidate,
  StoryProvenance,
  StoryRecordStatus,
} from '../../shared/story-domain'
import type { WorkspaceSource } from '../../shared/workspace-hub'

export interface BilingualLabel {
  zh: string
  en: string
}

export const STORY_ENTITY_LABELS: Record<StoryEntityType, BilingualLabel> = {
  character: { zh: '人物', en: 'Character' },
  relationship: { zh: '关系', en: 'Relationship' },
  world_rule: { zh: '世界规则', en: 'World rule' },
  place: { zh: '地点', en: 'Place' },
  organization: { zh: '组织', en: 'Organization' },
  faction: { zh: '势力', en: 'Faction' },
  item: { zh: '物品', en: 'Item' },
  civilization: { zh: '文明', en: 'Civilization' },
  power_system: { zh: '力量体系', en: 'Power system' },
  timeline_event: { zh: '时间事件', en: 'Timeline event' },
  narrative_thread: { zh: '叙事线', en: 'Narrative thread' },
  mystery: { zh: '谜题', en: 'Mystery' },
  foreshadowing: { zh: '伏笔', en: 'Foreshadowing' },
  outline: { zh: '大纲', en: 'Outline' },
}

/** 状态文案沿用 WorkspaceRulesTab 的既有词汇，避免同一状态出现两套叫法。 */
export const STORY_RECORD_STATUS_LABELS: Record<StoryRecordStatus, BilingualLabel> = {
  confirmed: { zh: '已确认', en: 'Confirmed' },
  candidate: { zh: '候选', en: 'Candidate' },
  deprecated: { zh: '已废止', en: 'Deprecated' },
}

export const STORY_REVIEW_STATUS_LABELS: Record<StoryCandidateReviewStatus, BilingualLabel> = {
  pending: { zh: '待作者确认', en: 'Pending author review' },
  approved: { zh: '作者已确认', en: 'Author-approved' },
  rejected: { zh: '作者已驳回', en: 'Author-rejected' },
}

export interface StoryEntityGroup {
  id: string
  label: BilingualLabel
  entityTypes: readonly StoryEntityType[]
}

/**
 * 分类档案导航。分组只影响阅读顺序与筛选，不改变资料的权威状态，
 * 也不会把不同状态的条目合并成同一个列表。
 */
export const STORY_ENTITY_GROUPS: readonly StoryEntityGroup[] = [
  {
    id: 'people',
    label: { zh: '人物与关系', en: 'People & relations' },
    entityTypes: ['character', 'relationship'],
  },
  {
    id: 'world',
    label: { zh: '世界设定', en: 'World settings' },
    entityTypes: [
      'world_rule', 'place', 'organization', 'faction', 'item', 'civilization', 'power_system',
    ],
  },
  {
    id: 'narrative',
    label: { zh: '叙事结构', en: 'Narrative structure' },
    entityTypes: ['narrative_thread', 'mystery', 'foreshadowing', 'outline'],
  },
  {
    id: 'events',
    label: { zh: '时间与事件', en: 'Time & events' },
    entityTypes: ['timeline_event'],
  },
]

export function findEntityGroup(groupId: string): StoryEntityGroup | null {
  return STORY_ENTITY_GROUPS.find(group => group.id === groupId) ?? null
}

export function entityLabel(entityType: string): BilingualLabel {
  return STORY_ENTITY_LABELS[entityType as StoryEntityType] ?? { zh: entityType, en: entityType }
}

/** 单条资料的可编辑 payload 字段定义，供详情表单按实体类型渲染。 */
export interface StoryPayloadFieldSpec {
  key: string
  label: BilingualLabel
  kind: 'text' | 'number'
  options?: readonly { value: string; label: BilingualLabel }[]
}

const CHARACTER_FIELDS: readonly StoryPayloadFieldSpec[] = [
  { key: 'role', label: { zh: '定位', en: 'Role' }, kind: 'text' },
  { key: 'status', label: { zh: '状态', en: 'Status' }, kind: 'text' },
  { key: 'location', label: { zh: '所在地', en: 'Location' }, kind: 'text' },
  { key: 'condition', label: { zh: '身体/处境', en: 'Condition' }, kind: 'text' },
  { key: 'motivation', label: { zh: '动机', en: 'Motivation' }, kind: 'text' },
]

const TIMELINE_FIELDS: readonly StoryPayloadFieldSpec[] = [
  { key: 'chapterNumber', label: { zh: '章节号', en: 'Chapter' }, kind: 'number' },
  { key: 'date', label: { zh: '故事内时间', en: 'In-story time' }, kind: 'text' },
]

const FORESHADOWING_FIELDS: readonly StoryPayloadFieldSpec[] = [
  {
    key: 'recoveryStatus',
    label: { zh: '伏笔回收状态', en: 'Recovery status' },
    kind: 'text',
    options: [
      { value: 'open', label: { zh: 'open · 未推进', en: 'open' } },
      { value: 'planted', label: { zh: 'planted · 已埋设', en: 'planted' } },
      { value: 'misdirected', label: { zh: 'misdirected · 已误导', en: 'misdirected' } },
      { value: 'resolved', label: { zh: 'resolved · 已回收', en: 'resolved' } },
      { value: 'abandoned', label: { zh: 'abandoned · 废止', en: 'abandoned' } },
    ],
  },
]

export function payloadFieldsFor(entityType: StoryEntityType): readonly StoryPayloadFieldSpec[] {
  if (entityType === 'character') return CHARACTER_FIELDS
  if (entityType === 'timeline_event') return TIMELINE_FIELDS
  if (entityType === 'foreshadowing') return FORESHADOWING_FIELDS
  return []
}

/** 结构化字段分组的标题；无专用字段的实体类型返回 null。 */
export function payloadGroupLabelFor(entityType: StoryEntityType): BilingualLabel | null {
  if (entityType === 'character') return { zh: '人物卡字段', en: 'Character card fields' }
  if (entityType === 'timeline_event') return { zh: '事件 Ledger 字段', en: 'Event ledger fields' }
  return null
}

/**
 * 来源快照核对结论。
 *
 * 正式资料的 provenance.sourceSnapshotId 是它被写入时所依据的母稿快照；
 * 母稿来源上的 approvedSnapshotId 是作者当前批准的快照。两者只能比较，
 * 不能互相改写：本模块仅报告结论，修正动作仍由「资料清单与片段」页承担。
 */
export type SourceSnapshotVerdict = 'matched' | 'changed' | 'unapproved' | 'source-unknown'

export interface FactSourceSnapshotCheck {
  verdict: SourceSnapshotVerdict
  /** 资料记录里保存的依据快照。 */
  provenanceSnapshotId: string
  /** 来源文件当前被作者批准的快照；未批准或来源缺失时为 null。 */
  approvedSnapshotId: string | null
  /** 来源文件在创作资料中枢中的相对路径；未收录时为 null。 */
  relativePath: string | null
}

export function checkFactSourceSnapshot(
  record: { provenance: StoryProvenance },
  sources: readonly WorkspaceSource[],
): FactSourceSnapshotCheck {
  const provenanceSnapshotId = record.provenance.sourceSnapshotId
  const source = sources.find(candidate => candidate.id === record.provenance.sourceId)
  if (!source) {
    return {
      verdict: 'source-unknown',
      provenanceSnapshotId,
      approvedSnapshotId: null,
      relativePath: null,
    }
  }
  if (!source.approvedSnapshotId) {
    return {
      verdict: 'unapproved',
      provenanceSnapshotId,
      approvedSnapshotId: null,
      relativePath: source.relativePath,
    }
  }
  return {
    verdict: source.approvedSnapshotId === provenanceSnapshotId ? 'matched' : 'changed',
    provenanceSnapshotId,
    approvedSnapshotId: source.approvedSnapshotId,
    relativePath: source.relativePath,
  }
}

/** 需要作者复核的来源状态；matched 之外的结论都意味着依据与批准快照不一致。 */
export function needsSnapshotReview(check: FactSourceSnapshotCheck): boolean {
  return check.verdict !== 'matched'
}

export function matchesStoryQuery(
  item: Pick<StoryFact | StoryFactCandidate, 'canonicalName' | 'summary' | 'entityType' | 'payload'>,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  if (item.canonicalName.toLowerCase().includes(query)) return true
  if (item.summary.toLowerCase().includes(query)) return true
  return Object.values(item.payload).some(
    value => typeof value === 'string' && value.toLowerCase().includes(query),
  )
}

/** 按权威状态拆分正式资料库记录；三个桶互不相交。 */
export function splitFactsByStatus(facts: readonly StoryFact[]): {
  confirmed: StoryFact[]
  candidate: StoryFact[]
  deprecated: StoryFact[]
} {
  return {
    confirmed: facts.filter(fact => fact.status === 'confirmed'),
    candidate: facts.filter(fact => fact.status === 'candidate'),
    deprecated: facts.filter(fact => fact.status === 'deprecated'),
  }
}
