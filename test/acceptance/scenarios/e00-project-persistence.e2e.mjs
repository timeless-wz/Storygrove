#!/usr/bin/env node
// E00 验收台架自证（方案第 7 节 L3 最小切片，对应 F01/F32 部分用例）：
//   隔离启动真实应用 → smoke 链路打开项目 A → UI 断言 → 退出重启 → UI 断言
//   → 恢复 Node ABI → 独立只读回读 SQLite / manifest / recent-projects / 来源哈希。
// 前置：pnpm run build 产物存在（缺失时本脚本会尝试执行构建）。
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import {
  assertBuildOutputs,
  assertProjectOpened,
  createIsolationEnv,
  launchApp,
  quitViaUI,
  readSmokeMarker,
  runProjectScript,
  withNodeNativeRestore,
} from '../lib/electron-driver.mjs'
import {
  createProjectSkeleton,
  createRunRoot,
  createSourceFixtures,
  hashDirFiles,
  writeEvidence,
} from '../lib/fixtures.mjs'
import { checkProjectDb, readProjectManifest } from '../lib/storage-checker.mjs'

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..')

const steps = []
const record = (name, data, ok) => {
  steps.push({ name, ok, data })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && data?.error) console.log(`      ${data.error}`)
}
const diagnostics = []
let activeDirs

async function main() {
  const dirs = createRunRoot({ label: 'e00' })
  activeDirs = dirs
  console.log(`runId: ${dirs.runId}\nrunRoot: ${dirs.root}\n`)

  // 1. fixture：项目骨架 + 只读来源 + 哈希基线
  const manifest = createProjectSkeleton(dirs.projectA, { marker: 'E00-PROJECT-A' })
  createProjectSkeleton(dirs.projectB, { marker: 'E00-PROJECT-B' })
  const fixtures = createSourceFixtures(dirs.sourceFixtures, { runMarker: dirs.runId })
  const fixtureHashesBefore = hashDirFiles(dirs.sourceFixtures)
  record('fixture.created', { projectId: manifest.projectId, sources: Object.keys(fixtures.files).length }, true)

  const markerPath = path.join(dirs.root, 'project-a-opened.json')

  // Always build this checkout; existence alone permits stale product binaries.
  const build = runProjectScript(repoRoot, 'build', path.join(dirs.evidence, 'build.log'))
  record('build.current-source', build, build.ok)
  const gate = assertBuildOutputs(repoRoot)
  record('build.gate', gate, gate.ok)
  if (!build.ok || !gate.ok) throw new Error('Current product build failed')

  let restore
  try {
  await withNodeNativeRestore(async () => {

  // 3. ABI 切到 Electron 并启动（第一次）
  const t0 = Date.now()
  const rebuild = runProjectScript(repoRoot, 'rebuild:electron', path.join(dirs.evidence, 'abi.log'))
  record('abi.rebuild-electron', { ...rebuild, ms: Date.now() - t0 }, rebuild.ok)
  if (!rebuild.ok) throw new Error('Electron native preparation failed')

  const launchEnv = () => createIsolationEnv({
    globalHome: dirs.globalHome,
    markerPath,
    projectPath: dirs.projectA,
  })

  let session
  try {
    session = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: launchEnv(), diagnostics })
    // CDP 驱动不做主进程内省；用文件事实替代——profile 目录由本次 Electron 写入。
    const profileFilesNow = fs.existsSync(dirs.electronProfile) ? fs.readdirSync(dirs.electronProfile) : []
    record('isolation.profile-dir-used', { files: profileFilesNow.length }, profileFilesNow.length > 0)

    const ui1 = await assertProjectOpened(session.page, {
      screenshotPath: path.join(dirs.evidence, '01-launch-open-project-a.png'),
    })
    record('ui.launch1.project-opened', ui1, ui1.ok)

    const marker = readSmokeMarker(markerPath)
    record('main.smoke-open-marker',
      { ...marker, expected: dirs.projectA },
      marker.ok && marker.marker?.projectPath === dirs.projectA)
  } finally {
    if (session) {
      try {
        const quit = await quitViaUI(session.page, session)
        record('app.quit1', quit, quit.ok === true && !quit.forced)
      } catch (e) {
        record('app.quit1', { error: String(e) }, false)
      }
    }
  }

  // 4. 重启：同一 fixture 再次真实启动
  fs.unlinkSync(markerPath)
  let session2
  try {
    session2 = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: launchEnv(), diagnostics })
    const ui2 = await assertProjectOpened(session2.page, {
      screenshotPath: path.join(dirs.evidence, '02-relaunch-reopen-project-a.png'),
    })
    record('ui.launch2.reopened', ui2, ui2.ok)
    const marker2 = readSmokeMarker(markerPath)
    record('main.relaunch-fresh-marker', marker2,
      marker2.ok && marker2.marker?.projectPath === dirs.projectA)
  } finally {
    if (session2) {
      try {
        const quit2 = await quitViaUI(session2.page, session2)
        record('app.quit2', quit2, quit2.ok === true && !quit2.forced)
      } catch (e) {
        record('app.quit2', { error: String(e) }, false)
      }
    }
  }

  }, () => {
    restore = runProjectScript(repoRoot, 'prepare:native-node', path.join(dirs.evidence, 'abi.log'))
    record('abi.restore-node', restore, restore.ok)
    return restore
  })
  } catch (error) {
    record('execution.error', { error: String(error) }, false)
  }

  // 5. Only read native SQLite after successful restoration.
  if (restore?.ok) {

  const dbCheck = checkProjectDb(dirs.projectA)
  record('storage.project-a.sqlite', {
    integrity: dbCheck.integrity,
    foreignKeyViolations: dbCheck.foreignKeyViolations?.length ?? 0,
    tableCount: dbCheck.tableCount,
  }, dbCheck.ok === true && ['project_core', 'contents', 'drafts', 'blueprints',
    'blueprint_details', 'blueprint_volumes', 'characters', 'worlds', 'cultivation_meta',
    'workspace_sources', 'knowledge_chunks', 'finalization_outbox']
      .every(table => dbCheck.tables.includes(table)))

  const manifestCheck = readProjectManifest(dirs.projectA)
  record('storage.project-a.manifest', { ok: manifestCheck.ok }, manifestCheck.ok)

  const recentPath = path.join(dirs.globalHome, 'recent-projects.json')
  let recentOk = false
  let recentData = null
  if (fs.existsSync(recentPath)) {
    recentData = JSON.parse(fs.readFileSync(recentPath, 'utf8'))
    // 注意不能用 JSON.stringify 文本做 includes：反斜杠会被转义成 \\ 导致永假
    recentOk = Array.isArray(recentData)
      && recentData.some((p) => p?.path && path.resolve(p.path) === path.resolve(dirs.projectA))
  }
  record('storage.global-home.recent-projects', { path: recentPath, containsProjectA: recentOk, recentData }, recentOk)

  const bDb = path.join(dirs.projectB, '.vela', 'vela.db')
  record('isolation.project-b-untouched', { dbExists: fs.existsSync(bDb) }, !fs.existsSync(bDb))

  const fixtureHashesAfter = hashDirFiles(dirs.sourceFixtures)
  record('storage.source-fixtures.readonly',
    { before: Object.keys(fixtureHashesBefore).length, unchanged: JSON.stringify(fixtureHashesBefore) === JSON.stringify(fixtureHashesAfter) },
    JSON.stringify(fixtureHashesBefore) === JSON.stringify(fixtureHashesAfter))

  const profileFiles = fs.existsSync(dirs.electronProfile) ? fs.readdirSync(dirs.electronProfile) : []
  record('isolation.electron-profile-used', { files: profileFiles.length }, profileFiles.length > 0)
  }

  // 6. 汇总
  const failed = steps.filter((s) => !s.ok)
  const result = {
    scenario: 'E00-project-persistence',
    runId: dirs.runId,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    failedSteps: failed.map((s) => s.name),
    steps,
    diagnostics: diagnostics.slice(-40),
  }
  writeEvidence(dirs, 'e00-result.json', result)
  const summary = writeEvidence(dirs, 'e00-result-summary.txt',
    steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`).join('\n'))
  fs.cpSync(dirs.evidence, path.join(repoRoot, 'test/acceptance/evidence', dirs.runId), { recursive: true })
  console.log(`\nverdict: ${result.verdict}（${steps.length - failed.length}/${steps.length} 步通过）`)
  console.log(`runRoot（保留供检查）: ${dirs.root}`)
  console.log(`evidence: ${summary}`)
  if (failed.length) process.exitCode = 1
}

main().catch((err) => {
  console.error('E00 crashed:', err)
  const dirs = activeDirs ?? { evidence: path.join(repoRoot, 'test/acceptance/evidence') }
  writeEvidence(dirs, 'e00-crash.log', String(err?.stack || err))
  if (activeDirs) {
    writeEvidence(dirs, 'e00-result.json', { scenario: 'E00-project-persistence', runId: dirs.runId,
      verdict: 'FAIL', failedSteps: [...steps.filter(step => !step.ok).map(step => step.name), 'execution.crashed'],
      steps, error: String(err) })
    fs.cpSync(dirs.evidence, path.join(repoRoot, 'test/acceptance/evidence', dirs.runId), { recursive: true })
  }
  process.exitCode = 1
})
