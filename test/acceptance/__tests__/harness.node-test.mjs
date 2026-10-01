import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkProjectDb, snapshotProject, assertIsolation } from '../lib/storage-checker.mjs'
import { EventEmitter } from 'node:events'
import { withNodeNativeRestore, classifyQuit, waitForChildExit, quitApp } from '../lib/electron-driver.mjs'
import { prepareIsolatedNodeRuntime } from '../lib/isolated-node-runtime.mjs'


function project(root, name) {
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, '.vela'), { recursive: true })
  const db = new Database(path.join(dir, '.vela', 'vela.db'))
  // Match the product's real PK/column names, including the absence of id
  // on blueprints and characters and sort_order on blueprint_volumes.
  db.exec(`
    CREATE TABLE project_core(id TEXT PRIMARY KEY, project_name TEXT);
    CREATE TABLE contents(id INTEGER PRIMARY KEY, body TEXT);
    CREATE TABLE drafts(id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER, status TEXT, blueprint_chapter_number INTEGER, content_id INTEGER REFERENCES contents(id));
    CREATE TABLE blueprints(chapter_number INTEGER PRIMARY KEY, volume_id TEXT, title TEXT);
    CREATE TABLE blueprint_volumes(id TEXT PRIMARY KEY, name TEXT, sort_order REAL);
    CREATE TABLE characters(name TEXT PRIMARY KEY, notes TEXT);
    CREATE TABLE world_rules(id TEXT PRIMARY KEY, description TEXT);
  `)
  db.prepare('INSERT INTO project_core VALUES (?, ?)').run('main', name)
  db.prepare('INSERT INTO contents VALUES (?, ?)').run(1, `${name}: 原始正文`)
  db.prepare('INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?)').run(1, 7, 2, 'draft', 7, 1)
  db.prepare('INSERT INTO blueprints VALUES (?, ?, ?)').run(7, 'volume-1', `${name}: 细纲`)
  db.prepare('INSERT INTO blueprint_volumes VALUES (?, ?, ?)').run('volume-1', name, 5)
  db.prepare('INSERT INTO characters VALUES (?, ?)').run('同名角色', `${name}: 作者资料`)
  db.prepare('INSERT INTO world_rules VALUES (?, ?)').run('rule-1', `${name}: 规则`)
  db.close()
  return dir
}

test('independent readback returns actual prose and every domain, and detects cross-project contamination', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-harness-check-'))
  try {
    const a = project(root, '独特甲标记')
    const b = project(root, '独特乙标记')
    assert.equal(checkProjectDb(a).ok, true)
    const first = snapshotProject(a)
    assert.equal(first.blueprints[0].chapter_number, 7)
    assert.equal(first.volumes[0].sort_order, 5)
    assert.equal(first.characters[0].name, '同名角色')
    assert.equal(first.drafts[0].body, '独特甲标记: 原始正文')
    assert.equal(first.tables.world_rules[0].description, '独特甲标记: 规则')
    assert.deepEqual(snapshotProject(a), first)
    assert.equal(assertIsolation(a, b).ok, true)
    const Database = createRequire(import.meta.url)('better-sqlite3')
    const db = new Database(path.join(b, '.vela', 'vela.db'))
    db.prepare('UPDATE contents SET body = ?').run('独特甲标记: 串项目正文')
    db.close()
    assert.equal(assertIsolation(a, b).ok, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('schema/query errors cannot masquerade as successful snapshot data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-harness-schema-'))
  try {
    const a = project(root, 'schema-fixture')
    const Database = createRequire(import.meta.url)('better-sqlite3')
    const db = new Database(path.join(a, '.vela', 'vela.db'))
    db.exec('ALTER TABLE blueprint_volumes RENAME COLUMN sort_order TO wrong_order')
    db.close()
    assert.throws(() => snapshotProject(a), /sort_order/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('native restoration executes after launch/assertion failure and restoration failure blocks success', async () => {
  const calls = []
  await assert.rejects(withNodeNativeRestore(async () => {
    calls.push('electron-phase')
    throw new Error('injected launch failure')
  }, async () => {
    calls.push('restore-node')
    return { ok: true, exitCode: 0 }
  }), /injected launch failure/)
  assert.deepEqual(calls, ['electron-phase', 'restore-node'])
  await assert.rejects(withNodeNativeRestore(async () => 'success', async () => ({ ok: false, exitCode: 1 })), /restoration failed/)
})

test('feature inventory preserves status separately from storage locations in every registered scenario', () => {
  const text = fs.readFileSync(new URL('../inventory/features.json', import.meta.url), 'utf8')
  const inventory = JSON.parse(text)
  assert.equal(inventory.features.length, 32)
  assert.equal(inventory.scenarios.length, 10)
  for (const entry of [...inventory.features, ...inventory.scenarios]) {
    for (const dimension of ['chain', 'storage', 'completeness']) {
      assert.match(entry[dimension], /^(PASS|FAIL|BLOCKED|NOT_RUN|MANUAL_PENDING)$/)
    }
  }
  for (const entry of inventory.features) assert.ok(Array.isArray(entry.storageTargets))
  assert.equal([...text.matchAll(/"storage"\s*:/g)].length, 42)
})

test('quit classification rejects forced and non-zero exits, accepts clean user exits', () => {
  assert.equal(classifyQuit({ forceKill: false }, { code: 0, signal: null }).ok, true)
  const forced = classifyQuit({ forceKill: true }, { code: 0, signal: null })
  assert.equal(forced.ok, false)
  assert.match(forced.reason, /forceKill/)
  const dirty = classifyQuit({ forceKill: false }, { code: 1, signal: null })
  assert.equal(dirty.ok, false)
  assert.match(dirty.reason, /exit code=1/)
})

test('waitForChildExit resolves immediately for already-exited children', async () => {
  const exited = new EventEmitter()
  exited.exitCode = 0
  exited.signalCode = null
  const started = Date.now()
  const result = await waitForChildExit(exited, 50)
  assert.equal(result.alreadyExited, true)
  assert.equal(result.code, 0)
  assert.ok(Date.now() - started < 50)
})

test('quitApp on an already-exited child records skipped stages without killing', async () => {
  const exited = new EventEmitter()
  exited.exitCode = 1
  exited.signalCode = null
  exited.pid = 424242
  const result = await quitApp({ electronApp: { child: exited } }, { timeoutMs: 50 })
  assert.equal(result.stages.gracefulKill, 'skipped')
  assert.equal(result.stages.forceKill, false)
  assert.equal(result.forced, false)
  assert.equal(result.ok, false)
  assert.match(result.reason, /exit code=1/)
})

test('isolated sqlite runtime hooks cover CJS require, ESM import, and record their provenance', async () => {
  // 契约：ESM 裸名 import 由生成的 resolve hook 指到独立垫片（sqlite-shim.cjs），CJS require 由
  // Module._load 补丁包装；两条路径都得到 IsolatedDatabase，且与加载顺序无关。独立副本不等于
  // "共享 better-sqlite3 已恢复 Node ABI"——本 runner 从不改写共享二进制。
  const esm = await import('better-sqlite3')
  assert.equal(esm.default.name, 'IsolatedDatabase')
  const esmDb = new esm.default(':memory:')
  assert.equal(esmDb.prepare('SELECT 1 AS v').get().v, 1)
  esmDb.close()
  // CJS 路径（Module._load 补丁）
  const DatabaseCjs = createRequire(import.meta.url)('better-sqlite3')
  assert.equal(DatabaseCjs.name, 'IsolatedDatabase')
  const cjsDb = new DatabaseCjs(':memory:')
  assert.equal(cjsDb.prepare('SELECT 1 AS v').get().v, 1)
  cjsDb.close()
  // 独立副本的出处必须落在 .runtime/acceptance-native，且与"共享二进制已恢复"是两回事
  const runtime = prepareIsolatedNodeRuntime()
  assert.equal(runtime.version, '12.8.0')
  assert.equal(runtime.abi, process.versions.modules)
  const runtimeRoot = runtime.root.replaceAll(String.fromCharCode(92), '/')
  assert.ok(runtime.binding.replaceAll(String.fromCharCode(92), '/').includes('.runtime/acceptance-native'))
  assert.ok(runtimeRoot.includes('.runtime/acceptance-native'))
  assert.ok(runtime.archiveSha256 && runtime.archiveSha256.length === 64)
  // 生成的 CJS hook 必须带 ABI 守卫与包管理器护栏
  const cjsHook = fs.readFileSync(runtime.hooks.cjs, 'utf8')
  assert.match(cjsHook, /process\.versions\.modules !== /)
  assert.match(cjsHook, /isPackageManagerCli/)
  assert.match(cjsHook, /pnpm\|npm-cli|node_modules\\\/\(pnpm/)
  // ESM hook：resolve 把裸名指到垫片（这才是让 ESM 与加载顺序无关的关键），load 保留作兜底
  const esmHook = fs.readFileSync(runtime.hooks.esm, 'utf8')
  assert.match(esmHook, /export async function resolve\(/)
  assert.match(esmHook, /specifier !== 'better-sqlite3'/)
  assert.match(esmHook, /process\.versions\.modules !== ABI/)
  assert.match(esmHook, /better-sqlite3\/lib\/index\.js/)
  // 垫片按绝对路径 require 真模块，并把独立 nativeBinding 强加给真类；ABI 不符时原样透传
  const shim = fs.readFileSync(runtime.hooks.shim, 'utf8')
  assert.match(shim, /process\.versions\.modules !== ABI/)
  assert.match(shim, /require\(REAL\)/)
  assert.match(shim, /nativeBinding: BINDING/)
  // 回归护栏：自包含子进程复现"先 require 后 import"的顺序（不依赖 .runtime/ 下的临时探针文件，
  // 该目录随时可能被清理）。修复前这个顺序会拿到真类 Database，并去加载被 Electron 独占的共享二进制。
  const entryFromRepo = fileURLToPath(new URL('../../../package.json', import.meta.url))
  const regression = `
const { createRequire } = require('node:module')
const requireFromRepo = createRequire(${JSON.stringify(entryFromRepo)})
const Database = requireFromRepo('better-sqlite3')
console.log('CJS_FIRST_NAME=' + Database.name)
;(async () => {
  const esm = await import('better-sqlite3')
  console.log('ESM_AFTER_CJS_NAME=' + esm.default.name)
  const db = new esm.default(':memory:')
  console.log('ESM_DB_OK=' + db.prepare('select 1 as ok').get().ok)
  db.close()
})().catch(error => { console.error(error); process.exitCode = 1 })
`
  const child = spawnSync(process.execPath, ['-e', regression], { env: runtime.env, encoding: 'utf8', windowsHide: true })
  assert.equal(child.status, 0, `require-first child failed (status ${child.status}): ${child.stderr}`)
  assert.match(child.stdout, /CJS_FIRST_NAME=IsolatedDatabase/)
  assert.match(child.stdout, /ESM_AFTER_CJS_NAME=IsolatedDatabase/)
  assert.match(child.stdout, /ESM_DB_OK=1/)
})
