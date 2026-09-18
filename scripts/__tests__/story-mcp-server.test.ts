import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../electron/database'

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
})
