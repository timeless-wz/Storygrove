/**
 * 故事资料中心的权威状态可视化。
 *
 * 目的只有一个：让「正式事实 / 候选资料 / 已废止内容 / 来源快照」在视觉上
 * 不可能被读成同一个列表。所有颜色取自语义令牌，随主题切换。
 */

import { AlertTriangle, Ban, Check, CircleDashed, HelpCircle, ShieldQuestion } from 'lucide-react'
import type { StoryCandidateReviewStatus, StoryRecordStatus } from '../../shared/story-domain'
import {
  STORY_RECORD_STATUS_LABELS,
  STORY_REVIEW_STATUS_LABELS,
  type FactSourceSnapshotCheck,
  type SourceSnapshotVerdict,
} from './story-data-taxonomy'

type Text = (zhCN: string, enUS: string) => string

interface StatusTone {
  color: string
  background: string
}

function tone(token: 'success' | 'warning' | 'error' | 'info' | 'muted'): StatusTone {
  const base = token === 'muted' ? 'var(--color-text-muted)' : `var(--color-${token})`
  return {
    color: token === 'muted' ? 'var(--color-text-muted)' : `var(--color-${token}-text)`,
    background: `color-mix(in srgb, ${base} 16%, transparent)`,
  }
}

const RECORD_TONES: Record<StoryRecordStatus, StatusTone> = {
  confirmed: tone('success'),
  candidate: tone('warning'),
  deprecated: tone('error'),
}

const REVIEW_TONES: Record<StoryCandidateReviewStatus, StatusTone> = {
  pending: tone('warning'),
  approved: tone('success'),
  rejected: tone('muted'),
}

function Chip({
  label,
  style,
  icon,
  title,
}: {
  label: string
  style: StatusTone
  icon?: React.ReactNode
  title?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
      style={{ color: style.color, backgroundColor: style.background }}
      title={title}
    >
      {icon}
      {label}
    </span>
  )
}

/** 正式资料库记录的状态：只有 confirmed 具备事实权威。 */
export function StoryRecordStatusChip({ status, text }: { status: StoryRecordStatus; text: Text }) {
  const label = STORY_RECORD_STATUS_LABELS[status]
  return <Chip label={text(label.zh, label.en)} style={RECORD_TONES[status]} />
}

/** 候选资料的审核状态。候选永远不是事实。 */
export function StoryReviewStatusChip({
  reviewStatus,
  text,
}: {
  reviewStatus: StoryCandidateReviewStatus
  text: Text
}) {
  const label = STORY_REVIEW_STATUS_LABELS[reviewStatus]
  return <Chip label={text(label.zh, label.en)} style={REVIEW_TONES[reviewStatus]} />
}

const SNAPSHOT_LABELS: Record<SourceSnapshotVerdict, { zh: string; en: string; tone: StatusTone }> = {
  matched: {
    zh: '批准快照一致',
    en: 'Matches approved snapshot',
    tone: tone('success'),
  },
  changed: {
    zh: '母稿已变化',
    en: 'Source changed',
    tone: tone('warning'),
  },
  unapproved: {
    zh: '母稿快照未批准',
    en: 'Snapshot not approved',
    tone: tone('info'),
  },
  'source-unknown': {
    zh: '来源未收录',
    en: 'Source not indexed',
    tone: tone('muted'),
  },
}

const SNAPSHOT_HINTS: Record<SourceSnapshotVerdict, { zh: string; en: string }> = {
  matched: {
    zh: '这条资料所依据的快照与来源当前被批准的快照一致。',
    en: 'The snapshot this fact was written from matches the source snapshot the author approved.',
  },
  changed: {
    zh: '母稿来源已产生新的批准快照，这条资料仍依据旧快照；复核前不要当作最新事实。',
    en: 'The source has a newer approved snapshot; this fact still cites the older one. Re-check before treating it as current.',
  },
  unapproved: {
    zh: '母稿来源尚未被作者批准任何快照，因此这条资料的依据未被作者确认。',
    en: 'The source has no author-approved snapshot yet, so this fact has no author-confirmed basis.',
  },
  'source-unknown': {
    zh: '当前项目的资料清单里找不到这条资料的来源，无法核对快照。',
    en: 'The source of this fact is not present in the current project source list, so the snapshot cannot be checked.',
  },
}

export function SourceSnapshotBadge({
  check,
  text,
}: {
  check: FactSourceSnapshotCheck
  text: Text
}) {
  const label = SNAPSHOT_LABELS[check.verdict]
  const hint = SNAPSHOT_HINTS[check.verdict]
  const icon = check.verdict === 'matched'
    ? <Check size={10} />
    : check.verdict === 'changed'
      ? <AlertTriangle size={10} />
      : check.verdict === 'unapproved'
        ? <CircleDashed size={10} />
        : <HelpCircle size={10} />
  return <Chip label={text(label.zh, label.en)} style={label.tone} icon={icon} title={text(hint.zh, hint.en)} />
}

/**
 * 资料边界说明。
 *
 * 这是页面的常驻文案而不是提示气泡：资料密集页最容易出错的地方就是
 * 把候选或废止内容当作已确认设定使用。
 */
export function StoryAuthorityBoundaryNote({ text }: { text: Text }) {
  const rules = [
    {
      icon: <Check size={13} />,
      tone: tone('success'),
      zh: '正式事实（已确认）：唯一具备事实权威的条目，可进入正文与生成上下文。',
      en: 'Authoritative facts (confirmed): the only entries with fact authority; allowed into prose and generation context.',
    },
    {
      icon: <ShieldQuestion size={13} />,
      tone: tone('warning'),
      zh: '候选资料：模型与扫描只能提交候选，未获作者确认前不是设定。',
      en: 'Candidates: models and scans may only submit candidates; they are not settings until the author confirms them.',
    },
    {
      icon: <Ban size={13} />,
      tone: tone('error'),
      zh: '已废止内容：保留追溯，但严禁进入正文与生成上下文。',
      en: 'Deprecated content: retained for traceability, strictly excluded from prose and generation context.',
    },
  ]
  return (
    <ul className="flex flex-col gap-1" data-testid="story-data-boundary-note">
      {rules.map(rule => (
        <li key={rule.zh} className="flex items-start gap-1.5 text-[11px] leading-snug">
          <span className="mt-0.5 shrink-0" style={{ color: rule.tone.color }}>{rule.icon}</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>{text(rule.zh, rule.en)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 资料区的空状态。
 *
 * 空状态必须回答两件事：这里为什么是空的，以及作者做哪个真实动作才会
 * 有内容。绝不用占位数据填充列表。
 */
export function StoryEmptyState({
  icon,
  title,
  description,
  steps,
  actions,
}: {
  icon: React.ReactNode
  title: string
  description: string
  steps?: readonly string[]
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-8" data-testid="story-empty-state">
      <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{title}</span>
      <span className="text-[11px] max-w-md leading-snug" style={{ color: 'var(--color-text-muted)' }}>{description}</span>
      {steps && steps.length > 0 && (
        <ol className="text-[11px] text-left space-y-1 mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          {steps.map((step, index) => (
            <li key={step} className="flex gap-1.5">
              <span className="tabular-nums opacity-60">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {actions && <div className="flex flex-wrap items-center justify-center gap-2 mt-2">{actions}</div>}
    </div>
  )
}
