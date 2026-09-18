import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import { StoryDomainRepository } from '../repositories/story-domain-repository'
import type { StoryFact } from '../../src/shared/story-domain'

export type AuditSeverity = 'error' | 'high' | 'warning' | 'info'
export interface AuditEvidence { chapter: number; quote: string; source?: StoryFact['provenance'] | Record<string, unknown> }
export interface AuditFinding {
  findingId: string; runId: string; projectId: string; severity: AuditSeverity; ruleCode: string
  status: 'open' | 'resolved' | 'waived' | 'dismissed'; location: { chapter: number; startLine?: number; endLine?: number }
  evidence: AuditEvidence[]; explanation: string; suggestion: string; createdAt: string
}

type PendingFinding = Omit<AuditFinding, 'findingId' | 'createdAt'>
type StateSnapshotRow = { entity_fact_id: string; chapter_number: number; state_json: string; source_json: string }
type KnowledgeRow = { character_fact_id: string; chapter_number: number; statement: string; source_json: string }
type EventRow = { chapter_number: number | null; story_time: string | null; title: string; result_json: string; source_json: string }

function db() { const value = getProjectDb(); if (!value) throw new Error('项目数据库未打开'); return value }
function text(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value ?? '') }
function payloadText(fact: StoryFact): string { return `${fact.summary} ${Object.values(fact.payload).map(text).join(' ')}` }
function parseObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} } catch { return {} } }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  const single = stringValue(value); return single ? [single] : []
}
function firstLine(lines: readonly string[], matcher: (line: string) => boolean): number { const index = lines.findIndex(matcher); return index < 0 ? 1 : index + 1 }
function sourceEvidence(fact: StoryFact): AuditEvidence { return { chapter: 0, quote: payloadText(fact).slice(0, 300), source: fact.provenance } }
function contentEvidence(chapter: number, lines: readonly string[], line: number): AuditEvidence { return { chapter, quote: (lines[line - 1] ?? '').slice(0, 300) } }
function add(findings: PendingFinding[], finding: PendingFinding): void {
  const key = `${finding.ruleCode}|${finding.location.chapter}|${finding.location.startLine ?? 0}|${finding.explanation}`
  if (!findings.some(current => `${current.ruleCode}|${current.location.chapter}|${current.location.startLine ?? 0}|${current.explanation}` === key)) findings.push(finding)
}
function numberFromChinese(value: string): number | null {
  const arabic = /\d+/u.exec(value); if (arabic) return Number(arabic[0])
  const map: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if ([...value].every(character => character in map)) {
    if (value === '十') return 10
    if (value.startsWith('十')) return 10 + (map[value[1]!] ?? 0)
    if (value.endsWith('十')) return (map[value[0]!] ?? 0) * 10
    if (value.length === 3 && value[1] === '十') return (map[value[0]!] ?? 0) * 10 + (map[value[2]!] ?? 0)
    return map[value] ?? null
  }
  return null
}
function dayNumbers(value: string): number[] {
  const values: number[] = []
  for (const match of value.matchAll(/第\s*([\d一二两三四五六七八九十]+)\s*天/gu)) {
    const parsed = numberFromChinese(match[1]!); if (parsed !== null) values.push(parsed)
  }
  return values
}
function numericLimit(payload: Record<string, unknown>): number | null {
  for (const key of ['maxLevel', 'max_level', 'upperBound', '最高境界', '最高等级', '上限', 'level', '等级']) {
    const value = payload[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') { const parsed = numberFromChinese(value); if (parsed !== null) return parsed }
  }
  return null
}
function observedLevels(value: string): number[] {
  const levels: number[] = []
  for (const match of value.matchAll(/(?:第\s*)?([\d一二两三四五六七八九十]+)\s*(?:阶|境|级)/gu)) {
    const parsed = numberFromChinese(match[1]!); if (parsed !== null) levels.push(parsed)
  }
  return levels
}
function normalizedTask(value: string): string { return value.replace(/[\s，,。；;：:、！？!?]/gu, '') }
function requirementTasks(payload: Record<string, unknown>): Array<{ task: string; strict: boolean }> {
  const strict = ['mustComplete', 'must_complete', 'hardGoals', 'hard_goals'].flatMap(key => stringValues(payload[key])).map(task => ({ task, strict: true }))
  const normal = ['requiredTasks', 'required_tasks', 'tasks'].flatMap(key => stringValues(payload[key])).map(task => ({ task, strict: false }))
  return [...strict, ...normal].filter(({ task }) => normalizedTask(task).length >= 2)
}

function findingFromRow(row: Record<string, unknown>): AuditFinding {
  return {
    findingId: String(row.finding_id), runId: String(row.run_id), projectId: String(row.project_id),
    severity: row.severity as AuditSeverity, ruleCode: String(row.rule_code), status: row.status as AuditFinding['status'],
    location: JSON.parse(String(row.location_json)) as AuditFinding['location'],
    evidence: JSON.parse(String(row.evidence_json)) as AuditEvidence[], explanation: String(row.explanation),
    suggestion: String(row.suggestion), createdAt: String(row.created_at),
  }
}

/**
 * Local deterministic continuity audit. It deliberately reads only confirmed
 * facts, confirmed ledger events and confirmed state/knowledge snapshots.
 * Candidate material can be displayed elsewhere, but never creates a hard
 * continuity rule before an author approval.
 */
export function auditChapter(input: { projectId: string; chapterNumber: number; content: string; ruleSet?: string }): { runId: string; findings: AuditFinding[] } {
  if (!input.projectId.trim()) throw new Error('必须提供显式 projectId')
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) throw new Error('章节号无效')
  const database = db(); const runId = randomUUID(); const projectId = input.projectId.trim()
  const facts = StoryDomainRepository.listFacts(projectId, 'confirmed')
  const factsById = new Map(facts.map(fact => [fact.factId, fact]))
  const characters = facts.filter(fact => fact.entityType === 'character')
  const places = facts.filter(fact => fact.entityType === 'place')
  const lines = input.content.split(/\r?\n/u)
  const findings: PendingFinding[] = []
  const snapshots = database.prepare(`
    SELECT snapshots.entity_fact_id, snapshots.chapter_number, snapshots.state_json, snapshots.source_json
    FROM entity_state_snapshots snapshots
    JOIN (
      SELECT entity_fact_id, MAX(chapter_number) AS chapter_number
      FROM entity_state_snapshots
      WHERE project_id = ? AND authority_status = 'confirmed' AND chapter_number < ?
      GROUP BY entity_fact_id
    ) latest ON latest.entity_fact_id = snapshots.entity_fact_id AND latest.chapter_number = snapshots.chapter_number
    WHERE snapshots.project_id = ? AND snapshots.authority_status = 'confirmed'
  `).all(projectId, input.chapterNumber, projectId) as StateSnapshotRow[]
  const snapshotByFactId = new Map(snapshots.map(row => [row.entity_fact_id, { ...row, state: parseObject(row.state_json), source: parseObject(row.source_json) }]))

  // P4-FR-001: explicit story-day regression and a character appearing at a
  // confirmed location while the same line explicitly puts them elsewhere.
  const priorEvents = database.prepare(`SELECT chapter_number, story_time, title, result_json, source_json FROM story_events WHERE project_id = ? AND status = 'confirmed' AND (chapter_number IS NULL OR chapter_number < ?)`).all(projectId, input.chapterNumber) as EventRow[]
  const lastDay = Math.max(0, ...priorEvents.flatMap(event => dayNumbers(`${event.story_time ?? ''} ${event.title} ${event.result_json}`)))
  for (const [index, line] of lines.entries()) {
    for (const day of dayNumbers(line)) if (lastDay > 0 && day < lastDay) {
      const sourceEvent = priorEvents.find(event => dayNumbers(`${event.story_time ?? ''} ${event.title} ${event.result_json}`).includes(lastDay))
      add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-001', status: 'open', location: { chapter: input.chapterNumber, startLine: index + 1, endLine: index + 1 }, evidence: [
        { chapter: 0, quote: `已确认事件时间至少到第${lastDay}天`, ...(sourceEvent ? { source: parseObject(sourceEvent.source_json) } : {}) },
        contentEvidence(input.chapterNumber, lines, index + 1),
      ], explanation: `本章写为第${day}天，但已确认事件账本已经推进到第${lastDay}天。`, suggestion: '确认是否为回忆、倒叙或明确的时间跳转；否则修正时间线。' })
    }
  }
  for (const character of characters) {
    if (!input.content.includes(character.canonicalName)) continue
    const snapshot = snapshotByFactId.get(character.factId)
    const knownLocation = stringValue(snapshot?.state.location ?? snapshot?.state.place ?? character.payload.location ?? character.payload.地点)
    if (!knownLocation) continue
    for (const [index, line] of lines.entries()) {
      if (!line.includes(character.canonicalName) || line.includes(knownLocation)) continue
      const otherLocation = places.find(place => place.canonicalName !== knownLocation && line.includes(place.canonicalName))
      if (!otherLocation) continue
      add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-001', status: 'open', location: { chapter: input.chapterNumber, startLine: index + 1, endLine: index + 1 }, evidence: [
        sourceEvidence(character),
        { chapter: snapshot?.chapter_number ?? 0, quote: `第${snapshot?.chapter_number ?? '?'}章结束时位置：${knownLocation}`, ...(snapshot ? { source: snapshot.source } : {}) },
        contentEvidence(input.chapterNumber, lines, index + 1),
      ], explanation: `角色“${character.canonicalName}”最近已确认位置为“${knownLocation}”，本章同一叙述行却出现在“${otherLocation.canonicalName}”。`, suggestion: '补充可行行程、时间跳转或修正地点。' })
    }
  }

  // P4-FR-002: terminal, missing and severe-action restrictions.
  for (const character of characters) {
    if (!input.content.includes(character.canonicalName)) continue
    const state = payloadText(character)
    const snapshot = snapshotByFactId.get(character.factId)
    const snapshotText = text(snapshot?.state)
    const terminal = /(死亡|身亡|牺牲|去世|已死|失踪|dead|deceased|died)/iu.test(`${state} ${snapshotText}`)
    if (terminal) {
      const line = firstLine(lines, value => value.includes(character.canonicalName))
      add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-002', status: 'open', location: { chapter: input.chapterNumber, startLine: line, endLine: line }, evidence: [sourceEvidence(character), contentEvidence(input.chapterNumber, lines, line)], explanation: `角色“${character.canonicalName}”的已确认资料包含终态描述，但本章再次出现该角色。`, suggestion: '确认是否为回忆、幻象或有意误导；否则修正人物状态。' })
    }
    const immobilized = /(重伤|昏迷|瘫痪|失去行动能力|无法行动|昏迷不醒)/u.test(`${state} ${snapshotText}`)
    if (immobilized) {
      for (const [index, line] of lines.entries()) if (line.includes(character.canonicalName) && /(疾跑|狂奔|全力冲刺|挥舞|大战|施展|跳起)/u.test(line)) {
        add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-002', status: 'open', location: { chapter: input.chapterNumber, startLine: index + 1, endLine: index + 1 }, evidence: [sourceEvidence(character), contentEvidence(input.chapterNumber, lines, index + 1)], explanation: `角色“${character.canonicalName}”已确认处于重伤或无法行动状态，却在本章执行高强度动作。`, suggestion: '补充恢复、治疗或替代执行者；否则降低本章动作强度。' })
      }
    }
  }

  // P4-FR-003: explicit upper bounds and forbidden powers. Rules only fire
  // where the fact contains a machine-readable boundary, never on vague lore.
  for (const fact of facts.filter(item => item.entityType === 'power_system' || item.entityType === 'character' || item.entityType === 'world_rule')) {
    const maximum = numericLimit(fact.payload)
    if (maximum !== null) for (const [index, line] of lines.entries()) for (const observed of observedLevels(line)) if (observed > maximum && (fact.entityType !== 'character' || line.includes(fact.canonicalName))) {
      add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-003', status: 'open', location: { chapter: input.chapterNumber, startLine: index + 1, endLine: index + 1 }, evidence: [sourceEvidence(fact), contentEvidence(input.chapterNumber, lines, index + 1)], explanation: `已确认边界“${fact.canonicalName}”上限为${maximum}，本章出现${observed}阶/级的使用。`, suggestion: '修正能力等级，或先以作者确认的版本补充突破条件与代价。' })
    }
    for (const forbidden of ['forbiddenAbilities', 'forbidden', '禁用能力', '禁忌'].flatMap(key => stringValues(fact.payload[key]))) if (forbidden && input.content.includes(forbidden)) {
      const line = firstLine(lines, value => value.includes(forbidden))
      add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-003', status: 'open', location: { chapter: input.chapterNumber, startLine: line, endLine: line }, evidence: [sourceEvidence(fact), contentEvidence(input.chapterNumber, lines, line)], explanation: `本章使用了已确认禁用能力或禁忌“${forbidden}”。`, suggestion: '删除该用法，或先由作者确认例外、代价与版本来源。' })
    }
  }

  // P4-FR-004: a fact may only be known from its confirmed acquisition chapter.
  const futureKnowledge = database.prepare(`SELECT character_fact_id, chapter_number, statement, source_json FROM character_knowledge WHERE project_id = ? AND authority_status = 'confirmed' AND chapter_number > ?`).all(projectId, input.chapterNumber) as KnowledgeRow[]
  for (const knowledge of futureKnowledge) {
    const character = factsById.get(knowledge.character_fact_id); if (!character || !knowledge.statement.trim()) continue
    if (!input.content.includes(character.canonicalName) || !input.content.includes(knowledge.statement.trim())) continue
    const line = firstLine(lines, value => value.includes(character.canonicalName) && value.includes(knowledge.statement.trim()))
    add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-004', status: 'open', location: { chapter: input.chapterNumber, startLine: line, endLine: line }, evidence: [
      { chapter: knowledge.chapter_number, quote: `第${knowledge.chapter_number}章后才获得的信息：${knowledge.statement}`, source: parseObject(knowledge.source_json) }, contentEvidence(input.chapterNumber, lines, line),
    ], explanation: `角色“${character.canonicalName}”在第${knowledge.chapter_number}章才确认获得的信息“${knowledge.statement}”，却在第${input.chapterNumber}章使用。`, suggestion: '补充信息来源、调整章节顺序，或改为其他已知角色的行动。' })
  }

  // P4-FR-005: ownership and relationship wording require an explicit fact.
  const characterNames = characters.map(character => character.canonicalName)
  for (const item of facts.filter(fact => fact.entityType === 'item')) {
    const snapshot = snapshotByFactId.get(item.factId)
    const owner = stringValue(snapshot?.state.owner ?? snapshot?.state.holder ?? item.payload.owner ?? item.payload.holder ?? item.payload.持有人)
    if (!owner || !input.content.includes(item.canonicalName)) continue
    for (const [index, line] of lines.entries()) {
      if (!line.includes(item.canonicalName) || !/(持有|拿着|取出|佩戴|使用|交给)/u.test(line)) continue
      const otherOwner = characterNames.find(name => name !== owner && line.includes(name))
      if (!otherOwner) continue
      add(findings, { runId, projectId, severity: 'high', ruleCode: 'P4-FR-005', status: 'open', location: { chapter: input.chapterNumber, startLine: index + 1, endLine: index + 1 }, evidence: [sourceEvidence(item), contentEvidence(input.chapterNumber, lines, index + 1)], explanation: `物品“${item.canonicalName}”已确认由“${owner}”持有，本章却由“${otherOwner}”使用，且没有可追溯交接事件。`, suggestion: '补充交接事件并确认，或修正物品持有者。' })
    }
  }
  for (const relation of facts.filter(fact => fact.entityType === 'relationship')) {
    const prohibited = ['forbiddenTerms', 'forbidden', '禁用称谓'].flatMap(key => stringValues(relation.payload[key]))
    for (const term of prohibited) if (term && input.content.includes(term)) {
      const line = firstLine(lines, value => value.includes(term))
      add(findings, { runId, projectId, severity: 'warning', ruleCode: 'P4-FR-005', status: 'open', location: { chapter: input.chapterNumber, startLine: line, endLine: line }, evidence: [sourceEvidence(relation), contentEvidence(input.chapterNumber, lines, line)], explanation: `关系“${relation.canonicalName}”明确禁用称谓或关系描述“${term}”，本章仍出现该表述。`, suggestion: '确认称谓是否因剧情变化而应更新；否则改回已确认称呼。' })
    }
  }

  // P4-FR-006: only explicitly marked hard goals can block a finalization.
  for (const outline of facts.filter(fact => fact.entityType === 'outline')) {
    const target = Number(outline.payload.chapterNumber ?? outline.payload.chapter ?? outline.payload.chapterNo)
    if (target !== input.chapterNumber) continue
    for (const { task, strict } of requirementTasks(outline.payload)) {
      if (normalizedTask(input.content).includes(normalizedTask(task))) continue
      add(findings, { runId, projectId, severity: strict ? 'high' : 'warning', ruleCode: 'P4-FR-006', status: 'open', location: { chapter: input.chapterNumber }, evidence: [sourceEvidence(outline), { chapter: input.chapterNumber, quote: input.content.slice(0, 300) }], explanation: `本章${strict ? '硬性' : '待核对'}剧情任务“${task}”未在正文中找到可验证完成证据。`, suggestion: '完成该剧情任务，或将其标记为延后/有意偏离并由作者确认。' })
    }
  }

  const maxRevision = database.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM story_facts WHERE project_id = ?').get(projectId) as { revision: number }
  const index = database.prepare('SELECT COALESCE(MAX(index_generation), 0) AS generation FROM embedding_records WHERE project_id = ?').get(projectId) as { generation: number }
  database.transaction(() => {
    database.prepare(`INSERT INTO audit_runs (run_id, project_id, scope_json, database_revision, index_generation, rule_set, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')`).run(runId, projectId, JSON.stringify({ chapterNumber: input.chapterNumber }), String(maxRevision.revision), String(index.generation), input.ruleSet ?? 'deterministic-v2')
    const insert = database.prepare(`INSERT INTO audit_findings (finding_id, run_id, project_id, severity, rule_code, status, location_json, evidence_json, explanation, suggestion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const finding of findings) insert.run(randomUUID(), runId, projectId, finding.severity, finding.ruleCode, finding.status, JSON.stringify(finding.location), JSON.stringify(finding.evidence), finding.explanation, finding.suggestion)
    database.prepare(`UPDATE audit_runs SET completed_at = datetime('now') WHERE run_id = ?`).run(runId)
  })()
  const rows = database.prepare('SELECT * FROM audit_findings WHERE run_id = ? ORDER BY created_at, finding_id').all(runId) as Array<Record<string, unknown>>
  return { runId, findings: rows.map(findingFromRow) }
}

export function listAuditFindings(projectId: string, runId?: string): AuditFinding[] {
  const clauses = ['project_id = ?']; const args: string[] = [projectId]
  if (runId) { clauses.push('run_id = ?'); args.push(runId) }
  return (db().prepare(`SELECT * FROM audit_findings WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, finding_id`).all(...args) as Array<Record<string, unknown>>).map(findingFromRow)
}

export function waiveAuditFinding(input: { projectId: string; findingId: string; reason: string; approvedBy: string }): void {
  if (!input.reason.trim() || !input.approvedBy.trim()) throw new Error('有意矛盾必须填写理由和确认人')
  const database = db()
  const row = database.prepare('SELECT 1 FROM audit_findings WHERE finding_id = ? AND project_id = ?').get(input.findingId, input.projectId)
  if (!row) throw new Error('审核发现不存在或不属于当前项目')
  database.transaction(() => {
    database.prepare('INSERT INTO audit_waivers (waiver_id, project_id, finding_id, reason, approved_by) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), input.projectId, input.findingId, input.reason.trim(), input.approvedBy.trim())
    database.prepare("UPDATE audit_findings SET status = 'waived' WHERE finding_id = ? AND project_id = ?").run(input.findingId, input.projectId)
  })()
}
