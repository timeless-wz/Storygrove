#!/usr/bin/env node
/* eslint-env node */
/**
 * Local STDIO MCP endpoint for AI-Novel-Writer.
 * The process is the domain boundary: callers receive projections and
 * proposals, never a SQLite connection or arbitrary SQL/file access.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const configuredProjectPath = process.env.AI_NOVEL_PROJECT_PATH?.trim() || ''
const projectPath = configuredProjectPath ? path.resolve(configuredProjectPath) : ''
const projectId = process.env.AI_NOVEL_PROJECT_ID?.trim() || ''
const blockedRoots = [process.env.SystemRoot, process.env.ProgramFiles, process.env.ProgramFilesX86].filter(Boolean).map(value => path.resolve(value))
const isBlockedPath = projectPath && blockedRoots.some(root => projectPath === root || projectPath.startsWith(`${root}${path.sep}`))
if (!projectPath || !projectId || isBlockedPath || !fs.existsSync(projectPath) || !fs.existsSync(path.join(projectPath, '.vela'))) {
  process.stderr.write('AI_NOVEL_PROJECT_PATH and AI_NOVEL_PROJECT_ID must bind one initialized local project\n')
  process.exit(2)
}
const dbPath = path.join(projectPath, '.vela', 'vela.db')
const db = new Database(dbPath)
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_sessions (session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_name TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '{"read":true,"propose":true,"commit":false}', expected_revision TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS agent_proposals (proposal_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL, proposal_type TEXT NOT NULL, payload_json TEXT NOT NULL, base_revision TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT, approved_by TEXT);
  CREATE TABLE IF NOT EXISTS mcp_audit_log (call_id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT, tool_name TEXT NOT NULL, input_summary TEXT NOT NULL DEFAULT '', result_summary TEXT NOT NULL DEFAULT '', write_receipt TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS knowledge_index_queue (queue_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chunk_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`)
const sessionId = randomUUID()
const revision = () => String(db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM story_facts WHERE project_id = ?").get(projectId)?.revision ?? 0)
db.prepare(`INSERT OR REPLACE INTO agent_sessions (session_id, project_id, agent_name, expected_revision, expires_at) VALUES (?, ?, ?, ?, datetime('now','+1 hour'))`).run(sessionId, projectId, 'stdio-mcp-agent', revision())

const projectIdProperty = {
  projectId: {
    type: 'string',
    const: projectId,
    description: 'Optional caller assertion. The local MCP session is already bound to this project at launch; a different value is rejected.',
  },
}
const tool = (name, description, properties = {}, required = []) => ({
  name, description,
  inputSchema: { type: 'object', additionalProperties: false, properties: { ...projectIdProperty, ...properties }, required },
})
const tools = [
  tool('get_project_state', 'Read the authoritative project state.'),
  tool('get_chapter_context', 'Read a sourced chapter context snapshot.', { chapterNumber: { type: 'integer', minimum: 1 } }, ['chapterNumber']),
  tool('search_knowledge', 'Search confirmed facts only; candidate and deprecated records are excluded.', { query: { type: 'string', minLength: 1, maxLength: 1000 }, topK: { type: 'integer', minimum: 1, maximum: 50 } }, ['query']),
  tool('get_character_state', 'Read confirmed character facts.', { name: { type: 'string', minLength: 1, maxLength: 200 } }),
  tool('get_story_timeline', 'Read confirmed story events.'),
  tool('get_open_threads', 'Read unresolved confirmed narrative threads and foreshadowing.'),
  tool('audit_chapter', 'Run deterministic continuity checks without changing prose.', { chapterNumber: { type: 'integer', minimum: 1 }, content: { type: 'string', minLength: 1, maxLength: 500000 } }, ['chapterNumber', 'content']),
  tool('get_audit_findings', 'Read sourced audit findings.'),
  tool('propose_fact_update', 'Create a pending proposal; never writes confirmed facts.', { payload: { type: 'object' } }, ['payload']),
  tool('propose_event_update', 'Create a pending event proposal; never writes confirmed events.', { payload: { type: 'object' } }, ['payload']),
  tool('propose_draft_update', 'Create a pending draft proposal; never writes author prose.', { payload: { type: 'object' } }, ['payload']),
  tool('propose_audit_waiver', 'Create a pending audit-waiver proposal.', { payload: { type: 'object' } }, ['payload']),
  tool('commit_approved_change', 'Commit only a separately author-approved, version-current proposal.', { proposalId: { type: 'string', minLength: 1 }, authorApproved: { type: 'boolean', const: true } }, ['proposalId', 'authorApproved']),
  tool('rebuild_knowledge_index', 'Queue a confirmed, incremental index rebuild; does not transmit prose.', { authorAuthorized: { type: 'boolean', const: true } }, ['authorAuthorized']),
]

function guard(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object')
  if (args.projectId !== undefined && args.projectId !== projectId) throw new Error('projectId must match the active local MCP session')
  // Some local MCP clients omit constant-valued schema fields. This is safe only
  // because this stdio process is already pinned to one project path and ID.
  return { ...args, projectId }
}
function rows(sql, ...args) { return db.prepare(sql).all(...args) }
function result(data) { return { content: [{ type: 'text', text: JSON.stringify(data) }] } }
function audit(toolName, input, output) { db.prepare('INSERT INTO mcp_audit_log (call_id, session_id, project_id, tool_name, input_summary, result_summary) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionId, projectId, toolName, JSON.stringify(input).slice(0, 1000), JSON.stringify(output).slice(0, 2000)) }

function callTool(name, args = {}) {
  args = guard(args)
  let output
  if (name === 'get_project_state') output = { projectId, revision: revision(), facts: rows('SELECT fact_id AS factId, entity_type AS entityType, canonical_name AS canonicalName, summary, status, revision FROM story_facts WHERE project_id = ? AND status = \'confirmed\' ORDER BY entity_type, canonical_name', projectId) }
  else if (name === 'get_chapter_context') output = rows('SELECT id, chapter_number AS chapterNumber, bundle_text AS text, sources_json AS sources, updated_at AS updatedAt FROM chapter_context_snapshots WHERE project_id = ? AND chapter_number = ? ORDER BY updated_at DESC LIMIT 1', projectId, Number(args.chapterNumber)).map(row => ({ ...row, sources: JSON.parse(row.sources || '[]') }))
  else if (name === 'search_knowledge') { const q = String(args.query || '').trim(); if (!q) throw new Error('query is required'); const like = `%${q}%`; output = rows('SELECT fact_id AS factId, canonical_name AS canonicalName, summary, status, source_file AS sourceFile, source_start_line AS startLine, source_end_line AS endLine FROM story_facts WHERE project_id = ? AND status = \'confirmed\' AND (canonical_name LIKE ? OR summary LIKE ? OR payload_json LIKE ?) ORDER BY canonical_name LIMIT ?', projectId, like, like, like, Math.min(50, Math.max(1, Number(args.topK) || 10))) }
  else if (name === 'get_character_state') output = rows('SELECT fact_id AS factId, canonical_name AS canonicalName, summary, payload_json AS payload, source_file AS sourceFile, source_start_line AS startLine, source_end_line AS endLine FROM story_facts WHERE project_id = ? AND entity_type = \'character\' AND status = \'confirmed\' AND (? IS NULL OR canonical_name = ?) ORDER BY canonical_name', projectId, args.name || null, args.name || null).map(row => ({ ...row, payload: JSON.parse(row.payload) }))
  else if (name === 'get_story_timeline') output = rows('SELECT event_id AS eventId, title, chapter_number AS chapterNumber, story_time AS storyTime, location, status, source_json AS source FROM story_events WHERE project_id = ? AND status = \'confirmed\' ORDER BY chapter_number, event_id', projectId).map(row => ({ ...row, source: JSON.parse(row.source) }))
  else if (name === 'get_open_threads') output = rows("SELECT fact_id AS factId, entity_type AS entityType, canonical_name AS canonicalName, summary, payload_json AS payload FROM story_facts WHERE project_id = ? AND status = 'confirmed' AND entity_type IN ('narrative_thread','mystery','foreshadowing') AND lower(payload_json) NOT LIKE '%resolved%' ORDER BY entity_type, canonical_name", projectId).map(row => ({ ...row, payload: JSON.parse(row.payload) }))
  else if (name === 'get_audit_findings') output = rows('SELECT finding_id AS findingId, run_id AS runId, severity, rule_code AS ruleCode, status, location_json AS location, evidence_json AS evidence, explanation, suggestion FROM audit_findings WHERE project_id = ? ORDER BY created_at DESC LIMIT 200', projectId).map(row => ({ ...row, location: JSON.parse(row.location), evidence: JSON.parse(row.evidence) }))
  else if (name === 'audit_chapter') { const content = String(args.content || ''); const chars = rows("SELECT canonical_name AS name, summary, source_file AS sourceFile, source_start_line AS startLine FROM story_facts WHERE project_id = ? AND entity_type = 'character' AND status = 'confirmed'", projectId); output = { chapterNumber: Number(args.chapterNumber), findings: chars.filter(row => /(死亡|身亡|牺牲|去世|已死|dead|deceased|died)/iu.test(`${row.summary}`) && content.includes(row.name)).map(row => ({ severity: 'high', ruleCode: 'P4-FR-002', location: { chapter: Number(args.chapterNumber) }, evidence: [{ chapter: Number(args.chapterNumber), quote: row.name }, { sourceFile: row.sourceFile, startLine: row.startLine, quote: row.summary }], explanation: `角色“${row.name}”已确认处于终态却在本章出现`, suggestion: '确认是否为回忆、幻象或有意误导' })) } }
  else if (['propose_fact_update', 'propose_event_update', 'propose_draft_update', 'propose_audit_waiver'].includes(name)) { const proposalId = randomUUID(); db.prepare('INSERT INTO agent_proposals (proposal_id, project_id, session_id, proposal_type, payload_json, base_revision) VALUES (?, ?, ?, ?, ?, ?)').run(proposalId, projectId, sessionId, name, JSON.stringify(args), revision()); output = { proposalId, status: 'pending', requiresAuthorApproval: true, baseRevision: revision() } }
  else if (name === 'commit_approved_change') { const proposal = db.prepare("SELECT * FROM agent_proposals WHERE proposal_id = ? AND project_id = ? AND session_id = ?").get(String(args.proposalId), projectId, sessionId); if (!proposal || proposal.status !== 'approved' || args.authorApproved !== true || proposal.base_revision !== revision()) throw new Error('提交被拒绝：需要作者确认且版本未变化'); db.prepare("UPDATE agent_proposals SET status = 'committed', reviewed_at = datetime('now') WHERE proposal_id = ?").run(proposal.proposal_id); output = { proposalId: proposal.proposal_id, status: 'committed' } }
  else if (name === 'rebuild_knowledge_index') { if (args.authorAuthorized !== true) throw new Error('索引重建需要作者明确授权'); const stale = rows('SELECT chunk_id FROM knowledge_chunks WHERE project_id = ? AND stale = 1', projectId); const enqueue = db.prepare("INSERT INTO knowledge_index_queue (queue_id, project_id, chunk_id, reason) VALUES (?, ?, ?, 'explicit-mcp-rebuild')"); const tx = db.transaction(() => stale.forEach(row => enqueue.run(randomUUID(), projectId, row.chunk_id))); tx(); output = { status: 'queued', projectId, reason: 'explicit-authorized-request', staleChunks: stale.length } }
  else throw new Error(`unknown tool: ${name}`)
  audit(name, args, output); return result(output)
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => { if (!line.trim()) return; let request; try { request = JSON.parse(line); const id = request.id; let response; if (request.method === 'initialize') response = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'AI-Novel-Writer MCP Server', version: '1.0.0' } }; else if (request.method === 'notifications/initialized') return; else if (request.method === 'tools/list') response = { tools }; else if (request.method === 'tools/call') response = callTool(String(request.params?.name || ''), request.params?.arguments || {}); else throw new Error(`method not found: ${request.method}`); if (id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: response })}\n`) } catch (error) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })}\n`) } })
process.on('exit', () => db.close())
