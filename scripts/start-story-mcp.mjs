#!/usr/bin/env node
/* eslint-env node */
/** Start the STDIO MCP server under Electron's Node runtime so it can share the
 * app's better-sqlite3 native binding without rewriting node_modules. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
if (typeof electronPath !== 'string' || !electronPath) {
  process.stderr.write('Could not resolve the Electron runtime path; reinstall project dependencies and retry.\n')
  process.exit(1)
}
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'story-mcp-server.mjs')
// Development/test installs may have a Node binding. Prefer this actual runtime
// when it can open SQLite; packaged Electron bindings keep the Electron fallback.
let runtimePath = electronPath
const runtimeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
try {
  const Database = require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  runtimePath = process.execPath
  delete runtimeEnv.ELECTRON_RUN_AS_NODE
} catch { /* The app's Electron runtime owns the installed native binding. */ }
// Pipe the protocol through instead of sharing stdio handles: when this wrapper
// dies or its stdin closes, the child's pipes break too, so the Electron process
// never outlives the MCP client while holding the project database open.
const child = spawn(runtimePath, [serverPath], {
  env: runtimeEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
child.stdin.on('error', () => { /* a dead MCP client tears the pipe down; the child exit handler reports the code */ })
process.stdin.on('error', () => { /* the client is gone; nothing left to report to */ })
process.stdin.pipe(child.stdin)
process.stdin.on('end', () => child.stdin.end())
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.on('error', error => {
  process.stderr.write(`Could not start local MCP server: ${error.message}\n`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
