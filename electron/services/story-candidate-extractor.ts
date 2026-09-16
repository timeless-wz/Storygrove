import { createHash } from 'node:crypto'
import type {
  StoryCandidate,
  StoryCandidateSource,
  StoryCandidateType,
  StoryChangeProposal,
} from '../../src/shared/story-candidate'

export interface StoryCandidateSourceInput {
  /** Existing snapshot fragments use `id`; callers may provide the explicit alias. */
  id?: string
  projectId?: string
  sourceId: string
  snapshotId: string
  fragmentId?: string
  relativePath?: string
  headingPath: string
  startLine: number
  endLine: number
  fragmentHash: string
  content: string
}

export interface StoryCandidateExtractionInput {
  projectId: string
  /** Preferred shape. The flat fields below remain accepted for existing callers. */
  source?: StoryCandidateSourceInput
  sourceId?: string
  snapshotId?: string
  fragmentId?: string
  relativePath?: string
  headingPath?: string
  startLine?: number
  endLine?: number
  fragmentHash?: string
  content?: string
  /** Optional stable timestamp supplied by the caller for reproducible proposals. */
  createdAt?: string
}

function normalizedSource(input: StoryCandidateExtractionInput): StoryCandidateSourceInput {
  if (input.source) return input.source
  return {
    projectId: input.projectId,
    sourceId: input.sourceId ?? '',
    snapshotId: input.snapshotId ?? '',
    fragmentId: input.fragmentId,
    relativePath: input.relativePath,
    headingPath: input.headingPath ?? '',
    startLine: input.startLine ?? 0,
    endLine: input.endLine ?? 0,
    fragmentHash: input.fragmentHash ?? '',
    content: input.content ?? '',
  }
}

export interface StoryCandidateExtractor {
  extract(input: StoryCandidateExtractionInput): StoryChangeProposal
}

const MAX_CANDIDATES = 100
const MAX_SUBJECT_LENGTH = 120
const MAX_EVIDENCE_LENGTH = 600

const LABEL_PATTERNS: ReadonlyArray<{
  type: StoryCandidateType
  pattern: RegExp
  confidence: number
  key: string
}> = [
  { type: 'character', pattern: /^(?:人物|角色|姓名|主角|配角)\s*[：:]\s*(.+)$/u, confidence: 0.92, key: 'name' },
  { type: 'location', pattern: /^(?:地点|场所|城市|国家|区域)\s*[：:]\s*(.+)$/u, confidence: 0.9, key: 'name' },
  { type: 'organization', pattern: /^(?:组织|机构|门派|公会)\s*[：:]\s*(.+)$/u, confidence: 0.9, key: 'name' },
  { type: 'faction', pattern: /^(?:势力|阵营)\s*[：:]\s*(.+)$/u, confidence: 0.88, key: 'name' },
  { type: 'item', pattern: /^(?:物品|道具|遗物|武器)\s*[：:]\s*(.+)$/u, confidence: 0.88, key: 'name' },
  { type: 'civilization', pattern: /^(?:文明|种族)\s*[：:]\s*(.+)$/u, confidence: 0.86, key: 'name' },
  { type: 'ability', pattern: /^(?:能力|技能|力量|境界)\s*[：:]\s*(.+)$/u, confidence: 0.88, key: 'name' },
  { type: 'setting', pattern: /^(?:设定|规则|世界观|限制|代价|禁忌|废案|废止)\s*[：:]\s*(.+)$/u, confidence: 0.84, key: 'content' },
  { type: 'event', pattern: /^(?:事件|发生|经过)\s*[：:]\s*(.+)$/u, confidence: 0.78, key: 'content' },
  { type: 'timeline_event', pattern: /^(?:时间线|时间轴|日期|第\s*[\d一二三四五六七八九十百千]+\s*章)\s*[：:]\s*(.+)$/u, confidence: 0.82, key: 'content' },
  { type: 'narrative_thread', pattern: /^(?:叙事线|主线|暗线|人物线)\s*[：:]\s*(.+)$/u, confidence: 0.82, key: 'content' },
  { type: 'mystery', pattern: /^(?:谜题|疑问|悬念)\s*[：:]\s*(.+)$/u, confidence: 0.8, key: 'content' },
  { type: 'foreshadowing', pattern: /^(?:伏笔|线索|回收)\s*[：:]\s*(.+)$/u, confidence: 0.9, key: 'content' },
  { type: 'outline', pattern: /^(?:大纲|目标|任务|本章任务)\s*[：:]\s*(.+)$/u, confidence: 0.78, key: 'content' },
]

const RELATION_PATTERN = /^(.{1,60})\s*(?:与|和|同)\s*(.{1,60})\s*(?:是|为|存在|保持|关系为)\s*(.{1,120})$/u

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/^[-*+\d.)、]+\s*/u, '').replace(/\s+/gu, ' ').trim().slice(0, maxLength)
}

function lineRangeForEvidence(lines: string[], index: number, startLine: number): { start: number; end: number; text: string } {
  // Preserve the actual source line for provenance. Only apply a hard bound so
  // a pathological Markdown line cannot create an unbounded proposal payload.
  const text = lines[index].trim().slice(0, MAX_EVIDENCE_LENGTH)
  return { start: startLine + index, end: startLine + index, text }
}

function sourceRef(input: StoryCandidateExtractionInput, evidence: { start: number; end: number; text: string }): StoryCandidateSource {
  const source = normalizedSource(input)
  const fragmentId = source.fragmentId ?? source.id
  if (!fragmentId) throw new Error('候选来源缺少 fragmentId')
  return {
    projectId: input.projectId,
    sourceId: source.sourceId,
    snapshotId: source.snapshotId,
    fragmentId,
    relativePath: source.relativePath ?? '',
    headingPath: source.headingPath,
    startLine: source.startLine,
    endLine: source.endLine,
    fragmentHash: source.fragmentHash,
    evidence: evidence.text,
    evidenceStartLine: evidence.start,
    evidenceEndLine: evidence.end,
    evidenceHash: sha256(evidence.text),
  }
}

function conflictsFor(type: StoryCandidateType, subject: string, evidence: string): string[] {
  const conflicts: string[] = []
  if (/废止|废案|删除|不采用|作废/u.test(evidence)) conflicts.push('来源包含废止或废案措辞，作者确认前不得生效')
  if (type === 'character' && /死亡|已死|失踪/u.test(evidence) && /存活|活着|回归/u.test(evidence)) {
    conflicts.push(`角色“${subject}”同时出现生死或状态相反的表述`)
  }
  if (/可能|也许|或许|暂定|未确定|候选/u.test(evidence)) conflicts.push('来源使用不确定措辞，置信度已降低')
  return conflicts
}

function buildCandidate(
  input: StoryCandidateExtractionInput,
  type: StoryCandidateType,
  subject: string,
  value: string,
  evidence: { start: number; end: number; text: string },
  confidence: number,
  key: string,
): StoryCandidate {
  const source = sourceRef(input, evidence)
  const conflicts = conflictsFor(type, subject, evidence.text)
  const adjustedConfidence = conflicts.some(conflict => conflict.includes('不确定')) ? confidence * 0.7 : confidence
  const identity = [input.projectId, source.sourceId, source.snapshotId, source.fragmentId, type, evidence.start, subject, value].join('|')
  return {
    candidateId: `story-candidate-${sha256(identity).slice(0, 24)}`,
    projectId: input.projectId,
    candidateType: type,
    subject,
    proposedData: { [key]: value, subject },
    source,
    confidence: Number(Math.max(0, Math.min(1, adjustedConfidence)).toFixed(4)),
    conflicts,
    status: 'pending',
  }
}

function validateInput(input: StoryCandidateExtractionInput): void {
  if (!input.projectId.trim()) throw new Error('提取候选必须提供显式 projectId')
  const source = normalizedSource(input)
  if (source.projectId !== undefined && source.projectId !== input.projectId) {
    throw new Error('候选来源 projectId 与提取 projectId 不一致')
  }
  for (const field of ['sourceId', 'snapshotId', 'fragmentHash'] as const) {
    if (!source[field].trim()) throw new Error(`候选来源缺少 ${field}`)
  }
  if (!(source.fragmentId ?? source.id)?.trim()) throw new Error('候选来源缺少 fragmentId')
  if (!Number.isInteger(source.startLine) || !Number.isInteger(source.endLine)
    || source.startLine < 1 || source.endLine < source.startLine) {
    throw new Error('候选来源行号范围无效')
  }
}

export function extractStoryCandidates(input: StoryCandidateExtractionInput): StoryChangeProposal {
  validateInput(input)
  const source = normalizedSource(input)
  const lines = source.content.split(/\r?\n/u)
  const candidates: StoryCandidate[] = []

  lines.forEach((line, index) => {
    if (candidates.length >= MAX_CANDIDATES) return
    const normalized = line.trim().replace(/^#{1,6}\s+/u, '')
    if (!normalized || /^#{1,6}\s*$/u.test(normalized)) return
    const evidence = lineRangeForEvidence(lines, index, source.startLine)

    for (const rule of LABEL_PATTERNS) {
      const match = rule.pattern.exec(normalized)
      if (!match) continue
      const value = cleanText(match[1], MAX_SUBJECT_LENGTH)
      if (!value) continue
      const subject = rule.key === 'name' ? value : cleanText(value.split(/[，,。；;]/u)[0], MAX_SUBJECT_LENGTH)
      candidates.push(buildCandidate(input, rule.type, subject, value, evidence, rule.confidence, rule.key))
      break
    }

    const relation = RELATION_PATTERN.exec(normalized)
    if (relation && candidates.length < MAX_CANDIDATES) {
      const from = cleanText(relation[1], MAX_SUBJECT_LENGTH)
      const to = cleanText(relation[2], MAX_SUBJECT_LENGTH)
      const relationType = cleanText(relation[3], MAX_SUBJECT_LENGTH)
      candidates.push(buildCandidate(input, 'relationship', `${from}—${to}`, relationType, evidence, 0.76, 'relation'))
    }
  })

  const seen = new Set<string>()
  const uniqueCandidates = candidates.filter(candidate => {
    const key = `${candidate.candidateType}|${candidate.subject}|${candidate.source.evidenceStartLine}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // A single fragment can state two different values for the same named fact.
  // Keep both proposals for author comparison, but make the contradiction explicit.
  const valuesBySubject = new Map<string, Set<string>>()
  uniqueCandidates.forEach(candidate => {
    const key = `${candidate.candidateType}|${candidate.subject}`
    const values = valuesBySubject.get(key) ?? new Set<string>()
    values.add(JSON.stringify(candidate.proposedData))
    valuesBySubject.set(key, values)
  })
  uniqueCandidates.forEach(candidate => {
    const key = `${candidate.candidateType}|${candidate.subject}`
    if ((valuesBySubject.get(key)?.size ?? 0) > 1) {
      candidate.conflicts.push('同一来源对该资料给出了多个不同候选值，需作者裁决')
    }
  })
  const proposalId = `story-proposal-${sha256([
    input.projectId, source.snapshotId, source.fragmentId ?? source.id, ...uniqueCandidates.map(candidate => candidate.candidateId),
  ].join('|')).slice(0, 24)}`
  const conflicts = uniqueCandidates.flatMap(candidate => candidate.conflicts.map(conflict => `${candidate.subject}：${conflict}`))
  return {
    proposalId,
    projectId: input.projectId,
    status: 'pending',
    candidates: uniqueCandidates,
    conflicts: [...new Set(conflicts)],
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function createStoryCandidateExtractor(): StoryCandidateExtractor {
  return { extract: extractStoryCandidates }
}

export const storyCandidateExtractor = createStoryCandidateExtractor()
