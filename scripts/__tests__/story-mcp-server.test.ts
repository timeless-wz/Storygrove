import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../electron/database'
import { approveAgentProposal, getAgentProposalCommitState, listPendingAgentProposals, rejectAgentProposal } from '../../electron/services/agent-proposal-service'
import { BlueprintRepository } from '../../electron/repositories/blueprint-repository'
import { DraftRepository } from '../../electron/repositories/draft-repository'
import { countDraftUnits } from '../../src/shared/draft-units'

const roots: string[] = []
const processes: Array<ReturnType<typeof spawn>> = []

async function stop(process: ReturnType<typeof spawn>): Promise<void> {
  if (process.exitCode !== null || process.killed) return
  const exited = once(process, 'exit').then(() => undefined)
  process.stdin?.end()
  process.kill()
  await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 3_000))])
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  closeProjectDatabase()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function request(proc: ReturnType<typeof spawn>, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer) => { buffer += chunk.toString(); const line = buffer.split(/\r?\n/u)[0]; if (!line) return; proc.stdout?.off('data', onData); try { resolve(JSON.parse(line) as Record<string, unknown>) } catch (error) { reject(error) } }
    proc.stdout?.on('data', onData); proc.stdin?.write(`${JSON.stringify(payload)}\n`)
  })
}

async function call(proc: ReturnType<typeof spawn>, id: number, name: string, args: Record<string, unknown> = {}) {
  const response = await request(proc, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  if (response.error) return response
  return JSON.parse(((response.result as { content: Array<{ text: string }> }).content[0]).text) as Record<string, unknown>
}

describe('local story MCP server', () => {
  it('requires an explicit project binding at server launch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: '' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    let stderr = ''
    proc.stderr?.on('data', chunk => { stderr += chunk.toString() })
    await once(proc, 'exit')
    expect(proc.exitCode).toBe(2)
    expect(stderr).toContain('AI_NOVEL_PROJECT_PATH and AI_NOVEL_PROJECT_ID must bind one initialized local project')
  })

  it('rejects a project ID that does not match the bound database', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'other' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    let stderr = ''
    proc.stderr?.on('data', chunk => { stderr += chunk.toString() })
    await once(proc, 'exit')
    expect(proc.exitCode).toBe(2)
    expect(stderr).toContain('does not match project_core')
  })

  it('exposes read tools and keeps writes in pending proposals', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!; database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const initialized = await request(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }); expect(initialized.result).toBeTruthy()
    const listed = await request(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }); const listedTools = (listed.result as { tools: Array<{ name: string; inputSchema: { required: string[]; properties: Record<string, unknown> } }> }).tools; const names = listedTools.map(tool => tool.name); expect(names).toContain('get_chapter_context'); expect(names).toContain('commit_approved_change')
    const auditSchema = listedTools.find(tool => tool.name === 'audit_chapter')?.inputSchema
    expect(auditSchema?.required).toEqual(expect.arrayContaining(['chapterNumber', 'content']))
    expect(auditSchema?.required).not.toContain('projectId')
    expect(auditSchema?.properties).toHaveProperty('projectId')
    expect(listedTools.find(tool => tool.name === 'rebuild_knowledge_index')?.inputSchema.properties).toHaveProperty('authorAuthorized')
    const stateWithoutProjectId = await request(proc, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_project_state', arguments: {} } })
    const stateText = ((stateWithoutProjectId.result as { content: Array<{ text: string }> }).content[0].text)
    expect(JSON.parse(stateText)).toMatchObject({ projectId: 'main' })
    const mismatchedProjectId = await request(proc, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_project_state', arguments: { projectId: 'another-project' } } })
    expect(JSON.stringify(mismatchedProjectId)).toContain('projectId must match the active local MCP session')
    const proposed = await request(proc, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'propose_fact_update', arguments: { payload: { summary: 'candidate' } } } }); expect(JSON.stringify(proposed)).toContain('requiresAuthorApproval')
  })

  it('stamps agent rows with the app manifest identity so the author review can find them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!
    database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const manifestId = '123e4567-e89b-42d3-a456-426614174000'
    fs.mkdirSync(path.join(root, '.vela'), { recursive: true })
    fs.writeFileSync(path.join(root, '.vela', 'project.json'), JSON.stringify({ schemaVersion: 1, kind: 'ai-novel-project', projectId: manifestId, createdAt: '2026-09-29T00:00:00.000Z' }))
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const state = await call(proc, 1, 'get_project_state', {})
    expect(state).toMatchObject({ projectId: manifestId })
    const proposed = await call(proc, 2, 'propose_fact_update', { payload: { summary: 'identity check' } })
    const row = database.prepare('SELECT project_id FROM agent_proposals WHERE proposal_id = ?').get(proposed.proposalId as string) as { project_id: string }
    expect(row.project_id).toBe(manifestId)
    // The app review path uses the manifest identity end to end.
    const blueprint = await call(proc, 3, 'propose_blueprint_update', { chapterNumber: 9, baseRevision: null, blueprint: { chapterNumber: 9, title: '身份验证蓝图', role: '', purpose: '', keyEvents: '', characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' } })
    expect(listPendingAgentProposals(manifestId).some(item => item.proposalId === blueprint.proposalId)).toBe(true)
    approveAgentProposal(manifestId, blueprint.proposalId as string, 'author')
    const committed = await call(proc, 4, 'commit_approved_change', { proposalId: blueprint.proposalId as string, authorApproved: true })
    expect(committed).toMatchObject({ status: 'committed', receipt: { resource: 'blueprint', chapterNumber: 9 } })
    const receipt = await call(proc, 5, 'get_proposal_receipt', { proposalId: blueprint.proposalId as string })
    expect(receipt).toMatchObject({ proposalId: blueprint.proposalId, status: 'committed' })
  })

  it('commits an approved blueprint through the project data read-back path and rejects stale revisions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!
    database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const initial = await call(proc, 1, 'get_blueprint', { chapterNumber: 1 })
    expect(initial.revision).toBeNull()
    const blueprint = { chapterNumber: 1, title: '外部提案第一章', role: 'opening', purpose: '建立冲突', keyEvents: '相遇', characters: ['甲'], suspenseHook: '来电', userGuidance: '', notes: '', notesUpdatedAt: '' }
    const proposal = await call(proc, 2, 'propose_blueprint_update', { chapterNumber: 1, baseRevision: null, blueprint })
    const proposalId = proposal.proposalId as string
    expect(BlueprintRepository.getByChapter(1)).toBeNull()
    expect(listPendingAgentProposals('main')).toEqual(expect.arrayContaining([
      expect.objectContaining({ proposalId, approvable: true }),
    ]))
    expect(await call(proc, 3, 'commit_approved_change', { proposalId, authorApproved: true })).toHaveProperty('error')
    approveAgentProposal('main', proposalId, 'author')
    const committed = await call(proc, 4, 'commit_approved_change', { proposalId, authorApproved: true })
    expect(committed).toMatchObject({ status: 'committed', receipt: { resource: 'blueprint', chapterNumber: 1 } })
    expect(BlueprintRepository.getByChapter(1)?.title).toBe('外部提案第一章')
    const readBack = await call(proc, 5, 'get_blueprint', { chapterNumber: 1 })
    expect((readBack.blueprint as { title: string }).title).toBe('外部提案第一章')
    const stale = await call(proc, 6, 'propose_blueprint_update', { chapterNumber: 1, baseRevision: readBack.revision, blueprint: { ...blueprint, title: '旧提案' } })
    approveAgentProposal('main', stale.proposalId as string, 'author')
    BlueprintRepository.upsert({ ...blueprint, title: '作者新改动' })
    expect(await call(proc, 7, 'commit_approved_change', { proposalId: stale.proposalId, authorApproved: true })).toHaveProperty('error')
    expect(BlueprintRepository.getByChapter(1)?.title).toBe('作者新改动')
    const latest = await call(proc, 8, 'get_blueprint', { chapterNumber: 1 })
    const rejected = await call(proc, 9, 'propose_blueprint_update', { chapterNumber: 1, baseRevision: latest.revision, blueprint: { ...blueprint, title: '拒绝的提案' } })
    rejectAgentProposal('main', rejected.proposalId as string)
    expect(listPendingAgentProposals('main').some(item => item.proposalId === rejected.proposalId)).toBe(false)
  })

  it('commits an approved non-finalized draft and preserves the app word-count contract', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!
    database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const draftId = DraftRepository.create({ chapterNumber: 1, source: 'write', content: '旧稿', wordCount: 2 })
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const initial = await call(proc, 1, 'get_draft', { draftId })
    const proposal = await call(proc, 2, 'propose_draft_update', { draftId, baseRevision: initial.revision, content: '新稿 hello 2026。' })
    approveAgentProposal('main', proposal.proposalId as string, 'author')
    const committed = await call(proc, 3, 'commit_approved_change', { proposalId: proposal.proposalId, authorApproved: true })
    expect(committed).toMatchObject({ status: 'committed', receipt: { resource: 'draft', draftId } })
    expect(DraftRepository.getFull(draftId)?.content).toBe('新稿 hello 2026。')
    expect(DraftRepository.getMeta(draftId)?.wordCount).toBe(countDraftUnits('新稿 hello 2026。'))
    const audit = database.prepare("SELECT input_summary FROM mcp_audit_log WHERE tool_name = 'propose_draft_update'").get() as { input_summary: string }
    expect(audit.input_summary).not.toContain('新稿')
  })

  it('serves initialize, tools and calls when started through the launcher wrapper', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const proc = spawn('node', [path.resolve('scripts/start-story-mcp.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    let stderr = ''
    proc.stderr?.on('data', chunk => { stderr += chunk.toString() })
    const initialized = await request(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect((initialized.result as { serverInfo: { name: string } }).serverInfo.name).toContain('AI-Novel-Writer')
    const listed = await request(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const names = (listed.result as { tools: Array<{ name: string }> }).tools.map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['get_blueprint', 'get_draft', 'propose_blueprint_update', 'propose_draft_update', 'commit_approved_change']))
    const state = await request(proc, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_project_state', arguments: {} } })
    expect(JSON.parse(((state.result as { content: Array<{ text: string }> }).content[0]).text)).toMatchObject({ projectId: 'main' })
    // Close stdin so the wrapper and its Electron child exit through the EOF path
    // instead of being force-killed while the child still holds the database.
    proc.stdin?.end()
    await Promise.race([once(proc, 'exit'), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('MCP launcher did not exit after stdin closed')), 5_000))])
    expect(proc.exitCode).toBe(0)
    expect(stderr).toBe('')
  })

  it('blocks approval and commit after the session expires or the proposal is rejected', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!
    database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const blueprint = { chapterNumber: 3, title: '待批准蓝图', role: '', purpose: '', keyEvents: '', characters: [] as string[], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '' }
    const approved = await call(proc, 1, 'propose_blueprint_update', { chapterNumber: 3, baseRevision: null, blueprint })
    approveAgentProposal('main', approved.proposalId as string, 'author')
    const rejected = await call(proc, 2, 'propose_blueprint_update', { chapterNumber: 4, baseRevision: null, blueprint: { ...blueprint, chapterNumber: 4, title: '被拒绝蓝图' } })
    rejectAgentProposal('main', rejected.proposalId as string)
    expect(await call(proc, 3, 'commit_approved_change', { proposalId: rejected.proposalId as string, authorApproved: true })).toHaveProperty('error')
    database.prepare("UPDATE agent_sessions SET expires_at = datetime('now', '-1 minute')").run()
    expect(await call(proc, 4, 'commit_approved_change', { proposalId: approved.proposalId as string, authorApproved: true })).toHaveProperty('error')
    expect(BlueprintRepository.getByChapter(3)).toBeNull()
    const expired = await call(proc, 5, 'propose_blueprint_update', { chapterNumber: 5, baseRevision: null, blueprint: { ...blueprint, chapterNumber: 5, title: '过期后提案' } })
    expect(listPendingAgentProposals('main').find(item => item.proposalId === expired.proposalId)?.approvable).toBe(false)
    expect(() => approveAgentProposal('main', expired.proposalId as string, 'author')).toThrow('提案会话已过期')
    expect(await call(proc, 6, 'commit_approved_change', { proposalId: expired.proposalId as string, authorApproved: true })).toHaveProperty('error')
    expect(BlueprintRepository.getByChapter(5)).toBeNull()
  })

  it('keeps finalized drafts out of external proposals and commits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!
    database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const finalizedId = DraftRepository.create({ chapterNumber: 1, source: 'write', content: '已定稿正文', wordCount: 5 })
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const initial = await call(proc, 1, 'get_draft', { draftId: finalizedId })
    database.prepare("UPDATE drafts SET status = 'finalized' WHERE id = ?").run(finalizedId)
    const refused = await call(proc, 2, 'propose_draft_update', { draftId: finalizedId, baseRevision: initial.revision as string, content: '外部改稿' })
    expect(JSON.stringify(refused)).toContain('只能修改未定稿的有效草稿')
    const activeId = DraftRepository.create({ chapterNumber: 2, source: 'write', content: '写作中的草稿', wordCount: 6 })
    const activeInitial = await call(proc, 3, 'get_draft', { draftId: activeId })
    const proposal = await call(proc, 4, 'propose_draft_update', { draftId: activeId, baseRevision: activeInitial.revision as string, content: '外部新稿' })
    approveAgentProposal('main', proposal.proposalId as string, 'author')
    database.prepare("UPDATE drafts SET status = 'finalized' WHERE id = ?").run(activeId)
    expect(await call(proc, 5, 'commit_approved_change', { proposalId: proposal.proposalId as string, authorApproved: true })).toHaveProperty('error')
    expect(DraftRepository.getFull(activeId)?.content).toBe('写作中的草稿')
  })

  it('persists commit receipts, replays repeat commits, and keeps receipts queryable after restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mcp-')); roots.push(root); initProjectDatabase(root)
    const database = getProjectDb()!
    database.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main','MCP fixture')").run()
    const draftId = DraftRepository.create({ chapterNumber: 1, source: 'write', content: '初稿', wordCount: 2 })
    const proc = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(proc)
    const initial = await call(proc, 1, 'get_draft', { draftId })
    const proposal = await call(proc, 2, 'propose_draft_update', { draftId, baseRevision: initial.revision as string, content: '回执验证新稿' })
    const proposalId = proposal.proposalId as string
    approveAgentProposal('main', proposalId, 'author')
    const committed = await call(proc, 3, 'commit_approved_change', { proposalId, authorApproved: true })
    expect(committed).toMatchObject({ status: 'committed', receipt: { resource: 'draft', draftId } })
    const receipt = committed.receipt as Record<string, unknown>
    // 重复提交（如响应丢失后的重试）必须回放原回执，不能二次写入。
    const replay = await call(proc, 4, 'commit_approved_change', { proposalId, authorApproved: true })
    expect(replay).toMatchObject({ status: 'committed', alreadyCommitted: true })
    expect(replay.receipt).toEqual(receipt)
    expect(DraftRepository.getFull(draftId)?.content).toBe('回执验证新稿')
    // 回执在当前会话内可查询，应用侧也能读到绑定项目/提案/资源的完整回执。
    const queried = await call(proc, 5, 'get_proposal_receipt', { proposalId })
    expect(queried).toMatchObject({ proposalId, status: 'committed', committedAt: expect.any(String) })
    expect(queried.receipt).toEqual(receipt)
    const watchState = getAgentProposalCommitState('main', proposalId)
    expect(watchState).toMatchObject({ status: 'committed', sessionLive: true, committedAt: expect.any(String) })
    expect(watchState?.receipt).toMatchObject({ proposalId, projectId: 'main', resource: 'draft', draftId })
    // 未提交的提案只能查到状态，没有回执；未知提案 ID 报错。
    const pending = await call(proc, 6, 'propose_draft_update', { draftId, baseRevision: receipt.revision as string, content: '第二个提案' })
    expect(await call(proc, 7, 'get_proposal_receipt', { proposalId: pending.proposalId as string })).toMatchObject({ status: 'pending', receipt: null })
    expect(await call(proc, 8, 'get_proposal_receipt', { proposalId: 'does-not-exist' })).toHaveProperty('error')
    // 服务重启后回执仍可查询，但旧会话的提案永远不能再次提交。
    await stop(proc)
    const restarted = spawn(process.execPath, [path.resolve('scripts/story-mcp-server.mjs')], { cwd: path.resolve('.'), env: { ...process.env, AI_NOVEL_PROJECT_PATH: root, AI_NOVEL_PROJECT_ID: 'main' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); processes.push(restarted)
    const afterRestart = await call(restarted, 1, 'get_proposal_receipt', { proposalId })
    expect(afterRestart).toMatchObject({ status: 'committed' })
    expect(afterRestart.receipt).toEqual(receipt)
    expect(await call(restarted, 2, 'commit_approved_change', { proposalId: pending.proposalId as string, authorApproved: true })).toHaveProperty('error')
    approveAgentProposal('main', pending.proposalId as string, 'author')
    expect(await call(restarted, 3, 'commit_approved_change', { proposalId: pending.proposalId as string, authorApproved: true })).toHaveProperty('error')
    expect(DraftRepository.getFull(draftId)?.content).toBe('回执验证新稿')
    database.prepare("UPDATE agent_sessions SET expires_at = datetime('now', '-1 minute')").run()
    expect(getAgentProposalCommitState('main', proposalId)?.sessionLive).toBe(false)
  })
})
