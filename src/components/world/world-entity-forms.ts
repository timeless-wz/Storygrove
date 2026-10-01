/**
 * 世界资料的实体表单描述。
 *
 * 每个实体只有一处字段定义，列表/表单/校验都从这里读，避免同一实体出现
 * 两三套互相矛盾的字段。字段与仓库的写入契约一一对应；空值一律表示
 * 「未设定」，界面不预填任何编造的默认设定。
 */
import {
  WORLD_PORTAL_STATUSES,
  WORLD_PORTAL_STATUS_LABELS,
  WORLD_PORTAL_TYPES,
  WORLD_PORTAL_TYPE_LABELS,
  WORLD_RELIC_CHARACTER_RELATIONS,
  WORLD_RELIC_CHARACTER_RELATION_LABELS,
  WORLD_RELIC_FACTION_RELATIONS,
  WORLD_RELIC_FACTION_RELATION_LABELS,
  WORLD_RELIC_STATUSES,
  WORLD_RELIC_STATUS_LABELS,
  WORLD_RULE_CATEGORIES,
  WORLD_RULE_CATEGORY_LABELS,
  WORLD_PORTAL_CHARACTER_RELATIONS,
  WORLD_PORTAL_CHARACTER_RELATION_LABELS,
  WORLD_PORTAL_FACTION_RELATIONS,
  WORLD_PORTAL_FACTION_RELATION_LABELS,
  WORLD_FACTION_RELATIONS,
  WORLD_FACTION_RELATION_LABELS,
  type WorldFaction,
  type WorldPortal,
  type WorldRelic,
  type WorldRule,
} from '../../shared/world-workbench'
import type { FormFieldOption, FormFieldSpec, FormValues } from './world-forms'
import { fieldFlag, fieldValue, withUnset } from './world-forms'

type Translate = (zh: string, en: string) => string

function optionsOf<T extends string>(
  values: readonly T[],
  labels: Record<T, { zh: string; en: string }>,
  text: Translate,
): FormFieldOption[] {
  return values.map(value => ({ value, label: text(labels[value].zh, labels[value].en) }))
}

const bool = (value: boolean): string | boolean => value
void bool

export const UNKNOWN_VALUE = {
  zh: '未设定',
  en: 'Not set',
} as const

// ---------- 势力 ----------

export function factionFields(text: Translate, nodeOptions: FormFieldOption[], characterOptions: FormFieldOption[]): FormFieldSpec[] {
  void nodeOptions
  void characterOptions
  return [
    { key: 'name', label: text('名称', 'Name'), kind: 'text', placeholder: text('例如：玄霄宗', 'For example: Xuanxiao Sect') },
    { key: 'type', label: text('类型', 'Type'), kind: 'text', placeholder: text('宗门 / 家族 / 国家 / 组织…', 'Sect / family / state / organization…') },
    { key: 'summary', label: text('简介', 'Summary'), kind: 'text' },
    { key: 'description', label: text('详细介绍', 'Description'), kind: 'textarea' },
    { key: 'seat', label: text('驻地', 'Seat'), kind: 'text', hint: text('驻地是文字描述；精确地点在详情里关联地图地点。', 'Seat is free text; link exact places from the detail panel.') },
    { key: 'domainNote', label: text('范围说明', 'Territory note'), kind: 'textarea' },
    { key: 'notes', label: text('备注', 'Notes'), kind: 'textarea' },
  ]
}

export function factionDefaults(faction: WorldFaction | null): FormValues {
  return {
    name: faction?.name ?? '',
    type: faction?.type ?? '',
    summary: faction?.summary ?? '',
    description: faction?.description ?? '',
    seat: faction?.seat ?? '',
    domainNote: faction?.domainNote ?? '',
    notes: faction?.notes ?? '',
  }
}

export function factionPayload(values: FormValues, worldId: string, existing: WorldFaction | null): WorldFaction {
  return {
    id: existing?.id ?? '',
    worldId,
    name: fieldValue(values, 'name'),
    type: fieldValue(values, 'type'),
    summary: fieldValue(values, 'summary'),
    description: fieldValue(values, 'description'),
    seat: fieldValue(values, 'seat'),
    domainNote: fieldValue(values, 'domainNote'),
    notes: fieldValue(values, 'notes'),
    createdAt: existing?.createdAt,
  }
}

// ---------- 秘境 ----------

export function relicFields(text: Translate, nodeOptions: FormFieldOption[]): FormFieldSpec[] {
  return [
    { key: 'name', label: text('名称', 'Name'), kind: 'text', placeholder: text('例如：古剑秘境', 'For example: Ancient Sword relic') },
    { key: 'type', label: text('类型', 'Type'), kind: 'text' },
    { key: 'status', label: text('状态', 'Status'), kind: 'select', options: optionsOf(WORLD_RELIC_STATUSES, WORLD_RELIC_STATUS_LABELS, text) },
    { key: 'customStatusLabel', label: text('自定义状态名称', 'Custom status name'), kind: 'text', visibleWhen: values => fieldValue(values, 'status') === 'custom' },
    { key: 'summary', label: text('简介', 'Summary'), kind: 'text' },
    { key: 'description', label: text('详细介绍', 'Description'), kind: 'textarea' },
    { key: 'locationNote', label: text('位置说明', 'Location note'), kind: 'textarea' },
    { key: 'nodeId', label: text('地图地点', 'Map place'), kind: 'select', options: withUnset(nodeOptions, text(UNKNOWN_VALUE.zh, UNKNOWN_VALUE.en)) },
    { key: 'entranceNodeId', label: text('入口地点', 'Entrance place'), kind: 'select', options: withUnset(nodeOptions, text(UNKNOWN_VALUE.zh, UNKNOWN_VALUE.en)) },
    { key: 'entryCondition', label: text('进入条件', 'Entry condition'), kind: 'textarea' },
    { key: 'danger', label: text('危险', 'Danger'), kind: 'textarea' },
    { key: 'rewards', label: text('资源 / 奖励', 'Resources & rewards'), kind: 'textarea' },
    { key: 'availabilityNote', label: text('开放时间说明', 'Availability note'), kind: 'textarea', hint: text('状态与开放时间都由作者维护，不会按电脑时间自动开启或关闭。', 'Status and availability are author-maintained; nothing opens or closes by clock time.') },
    { key: 'notes', label: text('备注', 'Notes'), kind: 'textarea' },
  ]
}

export function relicDefaults(relic: WorldRelic | null): FormValues {
  return {
    name: relic?.name ?? '',
    type: relic?.type ?? '',
    status: relic?.status ?? 'undiscovered',
    customStatusLabel: relic?.customStatusLabel ?? '',
    summary: relic?.summary ?? '',
    description: relic?.description ?? '',
    locationNote: relic?.locationNote ?? '',
    nodeId: relic?.nodeId ?? '',
    entranceNodeId: relic?.entranceNodeId ?? '',
    entryCondition: relic?.entryCondition ?? '',
    danger: relic?.danger ?? '',
    rewards: relic?.rewards ?? '',
    availabilityNote: relic?.availabilityNote ?? '',
    notes: relic?.notes ?? '',
  }
}

export function relicPayload(values: FormValues, worldId: string, existing: WorldRelic | null): WorldRelic {
  return {
    id: existing?.id ?? '',
    worldId,
    name: fieldValue(values, 'name'),
    type: fieldValue(values, 'type'),
    summary: fieldValue(values, 'summary'),
    description: fieldValue(values, 'description'),
    locationNote: fieldValue(values, 'locationNote'),
    nodeId: fieldValue(values, 'nodeId') || null,
    entranceNodeId: fieldValue(values, 'entranceNodeId') || null,
    entryCondition: fieldValue(values, 'entryCondition'),
    danger: fieldValue(values, 'danger'),
    rewards: fieldValue(values, 'rewards'),
    availabilityNote: fieldValue(values, 'availabilityNote'),
    status: (fieldValue(values, 'status') || 'undiscovered') as WorldRelic['status'],
    customStatusLabel: fieldValue(values, 'customStatusLabel'),
    notes: fieldValue(values, 'notes'),
    createdAt: existing?.createdAt,
  }
}

// ---------- 通道 ----------

export function portalFields(
  text: Translate,
  worldOptions: FormFieldOption[],
  nodeOptionsByWorld: (worldId: string) => FormFieldOption[],
): FormFieldSpec[] {
  const unset = (label: string) => [{ value: '', label }, ...[]] as FormFieldOption[]
  void unset
  return [
    { key: 'name', label: text('名称', 'Name'), kind: 'text', placeholder: text('例如：登天梯', 'For example: Heaven’s Stair') },
    { key: 'type', label: text('类型', 'Type'), kind: 'select', options: optionsOf(WORLD_PORTAL_TYPES, WORLD_PORTAL_TYPE_LABELS, text) },
    { key: 'customTypeLabel', label: text('自定义类型名称', 'Custom type name'), kind: 'text', visibleWhen: values => fieldValue(values, 'type') === 'custom' },
    { key: 'fromWorldId', label: text('起点世界', 'From world'), kind: 'select', options: worldOptions },
    { key: 'toWorldId', label: text('终点世界', 'To world'), kind: 'select', options: worldOptions, hint: text('第一版两端世界必须不同。', 'The two ends must be different worlds.') },
    {
      key: 'fromNodeId',
      label: text('起点入口地点', 'Entry place in the from-world'),
      kind: 'select',
      options: values => withUnset(nodeOptionsByWorld(fieldValue(values, 'fromWorldId')), text('入口地点未设定', 'Entry place not set')),
      hint: text('留空表示世界级通道：两端都显示「入口地点未设定」。', 'Leave empty for a world-level portal; both ends then show “endpoint not set”.'),
    },
    {
      key: 'toNodeId',
      label: text('终点出口地点', 'Exit place in the to-world'),
      kind: 'select',
      options: values => withUnset(nodeOptionsByWorld(fieldValue(values, 'toWorldId')), text('出口地点未设定', 'Exit place not set')),
    },
    { key: 'bidirectional', label: text('双向通行', 'Both directions'), kind: 'switch', placeholder: text('关闭时只有起点 → 终点可通行', 'When off, only from → to is passable') },
    { key: 'condition', label: text('通行条件', 'Condition'), kind: 'textarea' },
    { key: 'cost', label: text('代价', 'Cost'), kind: 'textarea' },
    { key: 'scheduleNote', label: text('开启时间说明', 'Availability note'), kind: 'textarea' },
    { key: 'status', label: text('状态', 'Status'), kind: 'select', options: optionsOf(WORLD_PORTAL_STATUSES, WORLD_PORTAL_STATUS_LABELS, text) },
    { key: 'customStatusLabel', label: text('自定义状态名称', 'Custom status name'), kind: 'text', visibleWhen: values => fieldValue(values, 'status') === 'custom' },
    { key: 'description', label: text('介绍', 'Description'), kind: 'textarea' },
    { key: 'notes', label: text('备注', 'Notes'), kind: 'textarea' },
  ]
}

export function portalDefaults(portal: WorldPortal | null, fallbackWorldId: string): FormValues {
  return {
    name: portal?.name ?? '',
    type: portal?.type ?? 'teleport',
    customTypeLabel: portal?.customTypeLabel ?? '',
    fromWorldId: portal?.fromWorldId ?? fallbackWorldId,
    toWorldId: portal?.toWorldId ?? '',
    fromNodeId: portal?.fromNodeId ?? '',
    toNodeId: portal?.toNodeId ?? '',
    bidirectional: portal?.bidirectional ?? true,
    condition: portal?.condition ?? '',
    cost: portal?.cost ?? '',
    scheduleNote: portal?.scheduleNote ?? '',
    status: portal?.status ?? 'active',
    customStatusLabel: portal?.customStatusLabel ?? '',
    description: portal?.description ?? '',
    notes: portal?.notes ?? '',
  }
}

export function portalPayload(values: FormValues, existing: WorldPortal | null): WorldPortal {
  return {
    id: existing?.id ?? '',
    name: fieldValue(values, 'name'),
    type: (fieldValue(values, 'type') || 'teleport') as WorldPortal['type'],
    customTypeLabel: fieldValue(values, 'customTypeLabel'),
    fromWorldId: fieldValue(values, 'fromWorldId'),
    toWorldId: fieldValue(values, 'toWorldId'),
    fromNodeId: fieldValue(values, 'fromNodeId') || null,
    toNodeId: fieldValue(values, 'toNodeId') || null,
    bidirectional: fieldFlag(values, 'bidirectional'),
    condition: fieldValue(values, 'condition'),
    cost: fieldValue(values, 'cost'),
    scheduleNote: fieldValue(values, 'scheduleNote'),
    status: (fieldValue(values, 'status') || 'active') as WorldPortal['status'],
    customStatusLabel: fieldValue(values, 'customStatusLabel'),
    description: fieldValue(values, 'description'),
    notes: fieldValue(values, 'notes'),
    createdAt: existing?.createdAt,
  }
}

// ---------- 规则 ----------

export function ruleFields(text: Translate, nodeOptions: FormFieldOption[]): FormFieldSpec[] {
  void nodeOptions
  return [
    { key: 'name', label: text('名称', 'Name'), kind: 'text', placeholder: text('例如：灵气上限', 'For example: Qi ceiling') },
    { key: 'category', label: text('分类', 'Category'), kind: 'select', options: optionsOf(WORLD_RULE_CATEGORIES, WORLD_RULE_CATEGORY_LABELS, text) },
    { key: 'customCategoryLabel', label: text('自定义分类名称', 'Custom category name'), kind: 'text', visibleWhen: values => fieldValue(values, 'category') === 'custom' },
    { key: 'content', label: text('规则内容', 'Rule content'), kind: 'textarea' },
    { key: 'scopeNote', label: text('适用范围说明', 'Scope note'), kind: 'textarea', hint: text('默认适用整个世界；精确范围在详情里关联地点或秘境。', 'Applies to the whole world by default; link places or relics from the detail panel.') },
    { key: 'restriction', label: text('限制 / 禁忌', 'Restrictions'), kind: 'textarea' },
    { key: 'consequence', label: text('违反后果', 'Consequences'), kind: 'textarea' },
    { key: 'notes', label: text('备注', 'Notes'), kind: 'textarea' },
    { key: 'sourceKind', label: text('来源', 'Source'), kind: 'select', options: [
      { value: 'author', label: text('作者手写', 'Author-written') },
      { value: 'setting-rule', label: text('引用已有审核规则', 'Existing reviewed rule') },
      { value: 'story-fact', label: text('引用故事事实', 'Existing story fact') },
    ] },
    {
      key: 'sourceRefId',
      label: text('原事实 ID', 'Source fact ID'),
      kind: 'text',
      visibleWhen: values => fieldValue(values, 'sourceKind') !== 'author',
      hint: text('引用已有事实时必须保留它的事实 ID；这里不会伪造文件、快照或确认记录。', 'When citing an existing fact you must keep its fact ID; nothing is fabricated here.'),
    },
    {
      key: 'sourceStatus',
      label: text('来源状态', 'Source status'),
      kind: 'text',
      visibleWhen: values => fieldValue(values, 'sourceKind') !== 'author',
      hint: text('例如 confirmed / candidate，按原事实的状态填写。', 'E.g. confirmed / candidate, copied from the original fact.'),
    },
  ]
}

export function ruleDefaults(rule: WorldRule | null): FormValues {
  return {
    name: rule?.name ?? '',
    category: rule?.category ?? 'cultivation',
    customCategoryLabel: rule?.customCategoryLabel ?? '',
    content: rule?.content ?? '',
    scopeNote: rule?.scopeNote ?? '',
    restriction: rule?.restriction ?? '',
    consequence: rule?.consequence ?? '',
    notes: rule?.notes ?? '',
    sourceKind: rule?.sourceKind ?? 'author',
    sourceRefId: rule?.sourceRefId ?? '',
    sourceStatus: rule?.sourceStatus ?? '',
  }
}

export function rulePayload(values: FormValues, worldId: string, existing: WorldRule | null): WorldRule {
  return {
    id: existing?.id ?? '',
    worldId,
    name: fieldValue(values, 'name'),
    category: (fieldValue(values, 'category') || 'custom') as WorldRule['category'],
    customCategoryLabel: fieldValue(values, 'customCategoryLabel'),
    content: fieldValue(values, 'content'),
    scopeNote: fieldValue(values, 'scopeNote'),
    restriction: fieldValue(values, 'restriction'),
    consequence: fieldValue(values, 'consequence'),
    notes: fieldValue(values, 'notes'),
    sourceKind: (fieldValue(values, 'sourceKind') || 'author') as WorldRule['sourceKind'],
    sourceRefId: fieldValue(values, 'sourceRefId'),
    sourceStatus: fieldValue(values, 'sourceStatus'),
    createdAt: existing?.createdAt,
  }
}

// ---------- 关系表单选项 ----------

export const RELATION_OPTIONS = {
  factionToFaction: (text: Translate) => optionsOf(WORLD_FACTION_RELATIONS, WORLD_FACTION_RELATION_LABELS, text),
  relicFaction: (text: Translate) => optionsOf(WORLD_RELIC_FACTION_RELATIONS, WORLD_RELIC_FACTION_RELATION_LABELS, text),
  relicCharacter: (text: Translate) => optionsOf(WORLD_RELIC_CHARACTER_RELATIONS, WORLD_RELIC_CHARACTER_RELATION_LABELS, text),
  portalFaction: (text: Translate) => optionsOf(WORLD_PORTAL_FACTION_RELATIONS, WORLD_PORTAL_FACTION_RELATION_LABELS, text),
  portalCharacter: (text: Translate) => optionsOf(WORLD_PORTAL_CHARACTER_RELATIONS, WORLD_PORTAL_CHARACTER_RELATION_LABELS, text),
}

/** 关系展示文本；自定义关系显示作者填写的名称。 */
export function relationLabel(
  relation: string,
  customLabel: string,
  labels: Record<string, { zh: string; en: string }>,
  text: Translate,
): string {
  if (relation === 'custom') return customLabel || text('自定义', 'Custom')
  const entry = labels[relation]
  return entry ? text(entry.zh, entry.en) : relation
}

/** 关系种类对应的标签映射；调用方直接传入，避免在渲染里重复构造。 */
export const RELATION_LABEL_MAPS = {
  factionToFaction: WORLD_FACTION_RELATION_LABELS as Record<string, { zh: string; en: string }>,
  relicFaction: WORLD_RELIC_FACTION_RELATION_LABELS as Record<string, { zh: string; en: string }>,
  relicCharacter: WORLD_RELIC_CHARACTER_RELATION_LABELS as Record<string, { zh: string; en: string }>,
  portalFaction: WORLD_PORTAL_FACTION_RELATION_LABELS as Record<string, { zh: string; en: string }>,
  portalCharacter: WORLD_PORTAL_CHARACTER_RELATION_LABELS as Record<string, { zh: string; en: string }>,
}
