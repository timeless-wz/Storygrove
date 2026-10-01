// Real Electron UI follow-up. Only the HTTP model provider is deterministic.
// Synthetic fixture preparation uses the product-created schema; assertions
// independently read SQLite through an isolated Node ABI, without renderer IPC.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { createProjectSkeleton } from '../lib/fixtures.mjs'
import { prepareIsolatedNodeRuntime } from '../lib/isolated-node-runtime.mjs'
import { quitViaUI, createIsolationEnv } from '../lib/electron-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const require = createRequire(import.meta.url)
export const root = path.join(repoRoot, '.runtime', `writing-entry-${Date.now()}`)
export const evidence = path.join(root, 'evidence')
export const requests = []
export const diagnostics = []
export let session
export let mode
let provider
let Database
let binding
let artifactHashes
function recordArtifactHashes() {
  return Object.fromEntries(['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.mjs'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex')]))
}
export let content
export const paths = Object.fromEntries(['v2', 'legacy'].map(kind => [kind, path.join(root, kind)]))
const home = path.join(root, 'global-home')
const prose = '窗外的雨声停了。苏砚握紧手中的纸条，沿着站台一步一步走向灯下。他记得约定，也记得那张陌生的脸。'
export function readback(kind = mode) {
  const db = new Database(path.join(paths[kind], '.vela', 'vela.db'), { readonly: true, nativeBinding: binding })
  try {
    const data = {
      integrity: db.pragma('integrity_check', { simple: true }),
      blueprints: db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all(),
      details: db.prepare('SELECT * FROM blueprint_details').all(),
      drafts: db.prepare('SELECT d.*, c.body FROM drafts d JOIN contents c ON c.id=d.content_id ORDER BY d.id').all(),
      characters: db.prepare('SELECT * FROM characters').all(),
    }
    fs.writeFileSync(path.join(evidence, `${kind}-readback.json`), JSON.stringify(data, null, 2))
    return data
  } finally { db.close() }
}
export async function open(kind) {
  if (JSON.stringify(recordArtifactHashes()) !== JSON.stringify(artifactHashes)) throw new Error('Built artifacts changed during acceptance')
  mode = kind
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
  const flags = process.env.BLUEPRINT_ORDINARY_LAUNCH === '1' ? [] : ['--no-sandbox', '--disable-gpu', '--in-process-gpu']
  const child = spawn(path.join(repoRoot, 'node_modules/electron/dist/electron.exe'), ['.', ...flags, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(root, `profile-${kind}`)}`], {
    cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: createIsolationEnv({ globalHome: home, projectPath: paths[kind], markerPath: path.join(root, `${kind}-opened.json`) }),
  })
  for (const [stream, streamName] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
    diagnostics.push({ kind: streamName, text: chunk.toString() })
    fs.writeFileSync(path.join(evidence, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
  })
  let browser
  try {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Electron exited at launch: ${child.exitCode}`)
      try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(target => target.type === 'page')) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60000 })
    const page = browser.contexts()[0].pages()[0]
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) diagnostics.push({ kind: message.type(), text: message.text() }) })
    page.on('pageerror', error => diagnostics.push({ kind: 'pageerror', text: String(error) }))
    page.on('crash', () => { diagnostics.push({ kind: 'renderer-crash', text: 'Renderer crashed' }); fs.writeFileSync(path.join(evidence, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2)) })
    page.on('requestfailed', request => diagnostics.push({ kind: 'requestfailed', url: request.url(), text: request.failure()?.errorText }))
    session = { child, browser, page, electronApp: { child, browser } }
    fs.appendFileSync(path.join(evidence, 'launches.jsonl'), JSON.stringify({ kind, pid: child.pid, port, flags }) + '\n')
  } catch (error) {
    fs.writeFileSync(path.join(evidence, 'launch-failure.json'), JSON.stringify({ error: String(error), diagnostics }, null, 2))
    await browser?.close().catch(() => {})
    child.kill() // Only this launcher-owned child.
    throw error
  }
  try {
    await session.page.locator('.writer-project-tree').first().waitFor({ timeout: 45000 })
  } catch (error) {
    fs.writeFileSync(path.join(evidence, 'launch-failure.json'), JSON.stringify({ error: String(error), diagnostics }, null, 2))
    await browser?.close().catch(() => {})
    if (child.exitCode === null) child.kill() // Only this failed launcher-owned child.
    throw error
  }
  return { pid: session.child.pid, url: session.page.url(), root }
}
export async function close() {
  if (!session) return
  const result = await quitViaUI(session.page, session)
  fs.appendFileSync(path.join(evidence, 'lifecycle.jsonl'), JSON.stringify({ mode, result }) + '\n')
  session = null
  fs.writeFileSync(path.join(evidence, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
  return result
}
export async function finish() { const result = await close(); await new Promise(resolve => provider.close(resolve)); return result }
export async function start() {
  fs.mkdirSync(evidence, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  artifactHashes = recordArtifactHashes()
  fs.writeFileSync(path.join(evidence, 'artifacts.json'), JSON.stringify(artifactHashes, null, 2))
  const runtime = prepareIsolatedNodeRuntime()
  binding = runtime.binding
  Database = require('better-sqlite3')
  provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    requests.push({ mode, url: req.url, payload })
    fs.writeFileSync(path.join(evidence, 'provider-requests.json'), JSON.stringify(requests, null, 2))
    if (req.url?.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'entry-fixture' }] })); return }
    const responseFile = path.join(evidence, 'provider-response.txt')
    const output = fs.existsSync(responseFile) ? fs.readFileSync(responseFile, 'utf8') : `${mode === 'v2' ? '接错的人。' : '旧版简纲起笔。'}\n\n${prose.repeat(mode === 'v2' ? 95 : 70)}\n\n他收起纸条，走进夜色。`
    const chunk = { id: 'entry-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: output }, finish_reason: null }] }
    if (payload.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      res.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'entry-fixture', choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }] }))
    }
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const modelId = 'writing-entry-fixture'
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ theme: 'dark', locale: 'zh-CN', defaultModelId: modelId, autoOpenNextChapterAfterFinalize: false, proxy: { enabled: false } }))
  fs.writeFileSync(path.join(home, 'models.json'), JSON.stringify([{ id: modelId, name: '入口验收模型', provider: 'custom', protocol: 'openai', modelName: 'entry-fixture', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, temperature: 0, maxTokens: 8192, capabilities: { contextWindowTokens: 65536, maxOutputTokens: 8192, reasoning: false }, purposes: ['generation'] }]))
  createProjectSkeleton(paths.v2)
  createProjectSkeleton(paths.legacy)
  await open('v2')
  if (process.env.BLUEPRINT_CONTINUOUS_CHAIN === '1') return { root, pid: session.child.pid, url: session.page.url() }
  await close()
  fs.copyFileSync(path.join(paths.v2, '.vela', 'vela.db'), path.join(paths.legacy, '.vela', 'vela.db'))
  const vite = await createServer({ configFile: false, server: { middlewareMode: true } })
  try {
    const parser = await vite.ssrLoadModule('/src/shared/blueprint-v2-markdown.ts')
    const shared = await vite.ssrLoadModule('/src/shared/blueprint-v2.ts')
    content = parser.parseChapterBlueprintMarkdown(fs.readFileSync(path.join(repoRoot, 'test/fixtures/blueprint-v2/chapter-01.md'), 'utf8')).content
    content.chapterNumber = 1
    for (const kind of ['v2', 'legacy']) {
      const db = new Database(path.join(paths[kind], '.vela', 'vela.db'), { nativeBinding: binding })
      try {
        db.prepare("UPDATE project_core SET project_name=?, core_outline=?, words_per_chapter=3000, total_chapters=5 WHERE id='main'").run(`章节入口验收-${kind}`, '苏砚在雨夜寻找接错的人。')
        db.prepare('INSERT INTO blueprints (chapter_number,title,role,purpose,key_events,characters,suspense_hook,user_guidance,notes) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(1, kind === 'v2' ? '接错的人' : '旧版简纲起笔', '建置', '推进雨夜接人', `${kind}-LEGACY-KEYEVENT-MARKER`, '[]', '雨夜悬念', `${kind}-AUTHOR-GUIDANCE-保持克制`, `${kind}-NOTES-人工章节记录`)
        if (kind === 'v2') {
          const hash = shared.computeBlueprintV2ContentHash(content)
          db.prepare('INSERT INTO blueprint_details (chapter_number,schema_version,detail_json,raw_markdown,revision,content_hash) VALUES (1,2,?,?,1,?)')
            .run(JSON.stringify({ ...content, revision: 1, contentHash: hash }), parser.serializeChapterBlueprintV2(content), hash)
        }
      } finally { db.close() }
      fs.writeFileSync(path.join(evidence, `${kind}-before.json`), JSON.stringify(readback(kind), null, 2))
    }
  } finally { await vite.close() }
  return open('v2')
}
