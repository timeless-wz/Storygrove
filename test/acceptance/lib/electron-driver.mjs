// Electron 隔离驱动（方案 L3）：真实 main/preload/renderer，进程与全局 home 双隔离。
// 启动方式：裸启 electron.exe + --remote-debugging-port，然后 playwright connectOverCDP。
// 不走 playwright _electron 的 -r loader.js/--inspect 通道：本机常有并发的其他验收任务
// 也在调试 Electron（2026-10-01 实测 6 个 --inspect 实例），inspector 握手会长期挂起；
// 裸启 + CDP attach 在同样负载下稳定（scripts/probe-legacy-project-open.mjs 同思路）。
//
// 生命周期约定：
// - 启动任何一步失败，立即终止本进程创建的 electron 子进程并清理监听，再抛错。
// - 子进程早退必须立即失败，不允许继续等待完整启动超时。
// - 退出按阶段记录：titlebarClose / exitConfirm / gracefulKill / forceKill / forced。
// - 验收场景的"用户正常退出"必须拒绝 forced 与非零退出码。
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)

// 本机常驻其他任务（用户未关闭的应用与进程），启动余量放宽到 180s。

// 验收产物锁：构建一次后记录 dist 关键文件哈希；每次 Electron 启动前校验，
// 防止并发构建覆盖导致"测的产物不是构建的产物"。哈希变化立即失败。
const ARTIFACT_FILES = ['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.mjs']

export function recordArtifactHashes(repoRoot) {
  const hashes = {}
  for (const rel of ARTIFACT_FILES) {
    const full = path.join(repoRoot, rel)
    if (!fs.existsSync(full)) throw new Error(`artifact missing: ${rel}`)
    hashes[rel] = createHash('sha256').update(fs.readFileSync(full)).digest('hex')
  }
  return hashes
}

export function assertArtifactsUnchanged(repoRoot, recorded) {
  const current = recordArtifactHashes(repoRoot)
  const changed = Object.keys(current).filter((rel) => current[rel] !== recorded[rel])
  if (changed.length) {
    throw new Error(`dist artifacts changed underneath the acceptance run (concurrent build?): ${changed.join(', ')}`)
  }
  return current
}

export const LAUNCH_TIMEOUT_MS = 180_000
export const UI_TIMEOUT_MS = 45_000

// 构建门（与 renderer-surface-e2e 一致）：e2e 必须针对已构建产物。
export function assertBuildOutputs(repoRoot) {
  const missing = ['dist/index.html', 'dist-electron/main.js']
    .map((rel) => path.join(repoRoot, rel))
    .filter((full) => !fs.existsSync(full))
  return { ok: missing.length === 0, missing }
}

export function runProjectScript(repoRoot, script, logFile) {
  const npmExecpath = process.env.npm_execpath
  const result = npmExecpath
    ? spawnSync(process.execPath, [npmExecpath, 'run', script], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })
    : spawnSync('pnpm', ['run', script], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' })
  if (logFile) {
    fs.appendFileSync(logFile, `\n===== pnpm run ${script} exit=${result.status} =====\n${result.stdout || ''}\n${result.stderr || ''}\n`)
  }
  return { script, exitCode: result.status, ok: result.status === 0 }
}

export function createIsolationEnv({ globalHome, markerPath, projectPath }) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.AI_NOVEL_VELA_HOME = globalHome
  if (projectPath) env.AI_NOVEL_SMOKE_OPEN_PROJECT = projectPath
  if (markerPath) env.AI_NOVEL_SMOKE_PROJECT_MARKER = markerPath
  return env
}

// 每次启动独立的诊断收集（主进程输出 + 渲染进程 console/pageerror）。
function makeSink(sink) {
  const push = (kind, text) => {
    sink.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 2000) })
    if (sink.length > 200) sink.shift()
  }
  return push
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

function fetchJsonList(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', timeout: 2000 }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('json/list timeout')) })
    req.on('error', reject)
  })
}

async function waitForPageTarget(port, timeoutMs, child, onIdleCheck) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    // 子进程一旦退出必须立即失败，不能傻等到超时
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`electron exited during launch: code=${child.exitCode} signal=${child.signalCode}`)
    }
    if (onIdleCheck) await onIdleCheck()
    try {
      const targets = await fetchJsonList(port)
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch (e) {
      lastError = e
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`CDP page target not ready within ${timeoutMs}ms: ${lastError}`)
}

export async function launchApp({ repoRoot, electronProfile, env, diagnostics }) {
  const push = makeSink(diagnostics)
  const port = await findFreePort()
  const electronExe = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (!fs.existsSync(electronExe)) throw new Error(`electron.exe not found: ${electronExe}`)
  const child = spawn(electronExe, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${electronProfile}`], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const onStdout = (c) => push('main-stdout', c.toString())
  const onStderr = (c) => push('main-stderr', c.toString())
  const onError = (e) => push('main-error', String(e))
  child.stdout.on('data', onStdout)
  child.stderr.on('data', onStderr)
  child.on('error', onError)

  const cleanup = () => {
    child.stdout.off('data', onStdout)
    child.stderr.off('data', onStderr)
    child.off('error', onError)
  }
  const killChild = () => {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { child.kill() } catch { /* already gone */ }
    }
  }

  try {
    await waitForPageTarget(port, LAUNCH_TIMEOUT_MS, child)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60_000 })
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 60_000 })
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') push(`renderer-console-${msg.type()}`, msg.text())
    })
    page.on('pageerror', (err) => push('renderer-pageerror', err?.stack || String(err)))
    await page.waitForLoadState('domcontentloaded')
    return { electronApp: { browser, child, cdpPort: port }, page }
  } catch (error) {
    killChild()
    cleanup()
    throw error
  }
}

// 等待子进程退出；进程已退出时立即返回，不等待、不重复 taskkill。
export function waitForChildExit(child, timeoutMs = 30_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode, alreadyExited: true })
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('electron app quit timeout')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, alreadyExited: false })
    })
  })
}

// 退出结果分类（纯函数，供验收断言与驱动测试共用）：
// 用户正常退出 = 走到 titlebarClose/gracefulKill 且进程 exit code 0，且未触发 forceKill。
export function classifyQuit(stages, exit) {
  const forced = Boolean(stages?.forceKill)
  const codeOk = exit?.code === 0 && exit?.signal === null
  return {
    forced,
    ok: !forced && codeOk,
    reason: forced ? 'forceKill used'
      : !codeOk ? `exit code=${exit?.code} signal=${exit?.signal}`
      : null,
  }
}

function gracefulKill(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return 'skipped'
  const result = spawnSync('taskkill', ['/PID', String(child.pid)], { windowsHide: true, encoding: 'utf8' })
  return result.status === 0 ? 'signalled' : `taskkill-exit-${result.status}`
}

function forceKill(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return false
  const result = spawnSync('taskkill', ['/PID', String(child.pid), '/F'], { windowsHide: true, encoding: 'utf8' })
  return result.status === 0
}

// 用户路径退出：点标题栏真实关闭按钮 → 关闭守卫若有未保存项会弹退出确认框，
// 点「保存并退出」走真实会话保存；无未保存项则自动放行。兜底 taskkill 优雅关闭。
// 返回 { exit, stages }：stages 区分 titlebarClose / exitConfirm / gracefulKill / forceKill。
export async function quitViaUI(page, handle, { timeoutMs = 45_000 } = {}) {
  const { browser, child } = handle.electronApp
  const stages = { titlebarClose: 'absent', exitConfirm: 'absent', gracefulKill: 'skipped', forceKill: false }
  const exitPromise = waitForChildExit(child, timeoutMs)
  try {
    const closeButton = page.locator('button[aria-label="关闭"], button[aria-label="Close"]').first()
    if (await closeButton.count().catch(() => 0)) {
      try {
        await closeButton.click({ timeout: 10_000 })
        stages.titlebarClose = 'clicked'
      } catch (error) {
        stages.titlebarClose = `click-failed: ${String(error).slice(0, 120)}`
      }
    } else {
      stages.titlebarClose = 'not-found'
    }
    if (stages.titlebarClose === 'clicked') {
      try {
        const saveExit = page.getByRole('button', { name: /保存并退出|Save and exit/ })
        await saveExit.waitFor({ state: 'visible', timeout: 8000 })
        await saveExit.click()
        stages.exitConfirm = 'save-and-exit-clicked'
      } catch {
        // 未出现退出确认框（自动放行）
        stages.exitConfirm = 'auto-proceed'
      }
    }
    if (stages.titlebarClose !== 'clicked') {
      stages.gracefulKill = gracefulKill(child)
    }
    let exit
    try {
      exit = await exitPromise
    } catch {
      stages.forceKill = forceKill(child)
      exit = await waitForChildExit(child, 15_000)
    }
    if (browser) await browser.close().catch(() => {})
    return { exit: { code: exit.code, signal: exit.signal }, stages, ...classifyQuit(stages, exit) }
  } catch (error) {
    stages.forceKill = forceKill(child)
    if (browser) await browser.close().catch(() => {})
    throw error
  }
}

// 兼容旧调用：直接优雅关闭（不点击 UI），返回同构结果。已退出的进程立即返回。
export async function quitApp(handle, { timeoutMs = 30_000 } = {}) {
  const { browser, child } = handle?.electronApp ?? handle ?? {}
  const stages = { titlebarClose: 'skipped', exitConfirm: 'skipped', gracefulKill: gracefulKill(child), forceKill: false }
  let exit
  try {
    exit = await waitForChildExit(child, timeoutMs)
  } catch {
    stages.forceKill = forceKill(child)
    exit = await waitForChildExit(child, 15_000)
  }
  if (browser) await browser.close().catch(() => {})
  return { exit: { code: exit.code, signal: exit.signal }, stages, ...classifyQuit(stages, exit) }
}

// 打开断言：项目树可见、无可见对话框、无失败文案（沿用 renderer-surface-e2e 判据）。
export async function assertProjectOpened(page, { screenshotPath } = {}) {
  await page.locator('.writer-project-tree').first().waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
  const visibleDialogCount = await page.locator('[role="dialog"]:visible').count()
  const bodyText = await page.locator('body').innerText()
  const failureMatch = bodyText.match(/打开项目失败|Failed to open project|加载失败|Failed to load|发生错误|An error occurred/i)
  if (screenshotPath) {
    await page.locator('body').screenshot({ path: screenshotPath }).catch(() => page.screenshot({ path: screenshotPath }))
  }
  return {
    projectTreeVisible: true,
    visibleDialogCount,
    failureText: failureMatch ? failureMatch[0] : null,
    ok: visibleDialogCount === 0 && !failureMatch,
    screenshotPath: screenshotPath || null,
  }
}

export function readSmokeMarker(markerPath) {
  if (!fs.existsSync(markerPath)) return { ok: false, error: 'marker not written by main' }
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    return { ok: typeof marker.projectPath === 'string', marker }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// 原生模块恢复边界：先执行业务（可能改写共享二进制），无论成败都执行恢复；
// 恢复失败本身即失败，防止后续 Node 套件踩 ABI 错位。
export async function withNodeNativeRestore(work, restore) {
  let workError
  let result
  try {
    result = await work()
    return result
  } catch (error) {
    workError = error
    throw error
  } finally {
    let restoreResult
    try {
      restoreResult = await restore(workError)
    } catch (error) {
      throw new Error(`restoration failed: ${error instanceof Error ? error.message : String(error)}${workError ? ` (work error: ${String(workError)})` : ''}`)
    }
    if (!restoreResult || restoreResult.ok !== true) {
      throw new Error(`restoration failed: exitCode=${restoreResult?.exitCode}${workError ? ` (work error: ${String(workError)})` : ''}`)
    }
  }
}
