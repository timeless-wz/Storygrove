#!/usr/bin/env node
// E01 部分分支（方案 E01 完整创作闭环的第一个已登记切片）：
//   手动自由草稿：新建 → 编辑（独特标记正文）→ 显式保存 → 退出重开 → UI 与独立 SQLite 双回读 → A/B 隔离。
// 判据以落盘数据为准（方案第 1 节）：保存按钮消失/状态栏仅作辅助，正文必须经只读连接回读。
// 前置：本脚本自行构建当前源码并切换 Electron ABI（结束后恢复；在隔离 runner 下
// prepare:native-node 探测的是独立副本，共享二进制不会被改动——证据中如实标注）。
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import {
  assertBuildOutputs,
  assertProjectOpened,
  createIsolationEnv,
  launchApp,
  quitApp,
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
import { checkProjectDb, readProjectManifest, snapshotProject } from '../lib/storage-checker.mjs'

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..')
const UI_TIMEOUT = 45_000

const steps = []
const record = (name, data, ok) => {
  steps.push({ name, ok, data })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && data?.error) console.log(`      ${data.error}`)
}
const diagnostics = []
let activeDirs

async function main() {
  const dirs = createRunRoot({ label: 'e01' })
  activeDirs = dirs
  const proseMarker = `${dirs.runId}-E01-林渊在山门前拾到玄铁令`
  console.log(`runId: ${dirs.runId}\nrunRoot: ${dirs.root}\nproseMarker: ${proseMarker}\n`)

  // 1. fixture
  const manifest = createProjectSkeleton(dirs.projectA, { marker: 'E01-PROJECT-A' })
  createProjectSkeleton(dirs.projectB, { marker: 'E01-PROJECT-B' })
  const fixtures = createSourceFixtures(dirs.sourceFixtures, { runMarker: dirs.runId })
  const fixtureHashesBefore = hashDirFiles(dirs.sourceFixtures)
  record('fixture.created', { projectId: manifest.projectId, sources: Object.keys(fixtures.files).length }, true)

  const markerPath = path.join(dirs.root, 'project-a-opened.json')

  // 2. 构建当前源码 + Electron ABI
  const build = runProjectScript(repoRoot, 'build', path.join(dirs.evidence, 'build.log'))
  record('build.current-source', build, build.ok)
  const gate = assertBuildOutputs(repoRoot)
  record('build.gate', gate, gate.ok)
  if (!build.ok || !gate.ok) throw new Error('Current product build failed')

  let restore
  try {
    await withNodeNativeRestore(async () => {
      const t0 = Date.now()
      const rebuild = runProjectScript(repoRoot, 'rebuild:electron', path.join(dirs.evidence, 'abi.log'))
      record('abi.rebuild-electron', { ...rebuild, ms: Date.now() - t0 }, rebuild.ok)
      if (!rebuild.ok) throw new Error('Electron native preparation failed')

      const launchEnv = () => createIsolationEnv({
        globalHome: dirs.globalHome,
        markerPath,
        projectPath: dirs.projectA,
      })

      // 3. 第一次启动：新建自由草稿 → 编辑 → 保存
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

        const page = session.page
        await page.locator('button[title="新建自由草稿"]').first()
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        await page.locator('button[title="新建自由草稿"]').first().click()

        const chapterInput = page.locator('#new-draft-chapter-number')
        await chapterInput.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        await chapterInput.fill('1')
        await page.getByRole('button', { name: /创建并开始写作|Create and start writing/ }).click()

        const editorRoot = page.locator('[data-vditor-prose-editor="true"]')
        await editorRoot.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        // vditor 会渲染隐藏的同名节点（量测/源码模式），必须取可见编辑面
        const prose = editorRoot.locator('pre[contenteditable="true"]:visible').first()
        await prose.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        await prose.click()
        await page.keyboard.insertText(proseMarker)
        record('ui.draft-created-and-edited', { chapter: 1, proseLength: proseMarker.length }, true)
        await page.locator('body').screenshot({ path: path.join(dirs.evidence, '02-draft-edited.png') }).catch(() => {})

        // 保存按钮仅在 isDirty 时出现；点击后消失即为本端确认
        const saveButton = page.locator('button.draft-action--save')
        await saveButton.waitFor({ state: 'visible', timeout: 20_000 })
        await saveButton.click()
        await saveButton.waitFor({ state: 'detached', timeout: 20_000 })
        record('ui.explicit-save', { buttonAppeared: true, buttonCleared: true }, true)
        await page.locator('body').screenshot({ path: path.join(dirs.evidence, '03-draft-saved.png') }).catch(() => {})
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

      // 4. 第二次启动：重启后草稿仍在 UI 中
      fs.rmSync(markerPath, { force: true })
      let session2
      try {
        session2 = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: launchEnv(), diagnostics })
        const ui2 = await assertProjectOpened(session2.page, {
          screenshotPath: path.join(dirs.evidence, '04-relaunch-project-a.png'),
        })
        record('ui.launch2.reopened', ui2, ui2.ok)
        const marker2 = readSmokeMarker(markerPath)
        record('main.relaunch-fresh-marker', marker2, marker2.ok && marker2.marker?.projectPath === dirs.projectA)

        const page = session2.page
        // 草稿项（DraftItem）不带 .tree-item 类，按文本在树内定位
        const draftItem = page.locator('.writer-project-tree').getByText(/第\s*1\s*章/).first()
        await draftItem.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        await draftItem.click()
        const editorRoot = page.locator('[data-vditor-prose-editor="true"]')
        await editorRoot.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        const prose = editorRoot.locator('pre[contenteditable="true"]:visible').first()
        await prose.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        const reopenedText = await prose.innerText()
        record('ui.reopened-draft-content', {
          length: reopenedText.length,
          containsMarker: reopenedText.includes(proseMarker),
        }, reopenedText.includes(proseMarker))
        await page.locator('body').screenshot({ path: path.join(dirs.evidence, '05-relaunch-draft-content.png') }).catch(() => {})
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
      // 隔离 runner 下此探测命中独立副本；共享二进制不被改动（已知边界，如实记录）
      restore = runProjectScript(repoRoot, 'prepare:native-node', path.join(dirs.evidence, 'abi.log'))
      record('abi.restore-node', { ...restore, caveat: 'isolated-runner: probes independent copy' }, restore.ok)
      return restore
    })
  } catch (error) {
    record('execution.error', { error: String(error) }, false)
  }

  // 5. 独立只读回读（Node ABI；隔离 runner 下用独立二进制）
  if (restore?.ok) {
    const manifestCheck = readProjectManifest(dirs.projectA)
    record('storage.project-a.manifest', { ok: manifestCheck.ok }, manifestCheck.ok)

    const dbCheck = checkProjectDb(dirs.projectA)
    record('storage.project-a.sqlite', {
      integrity: dbCheck.integrity,
      foreignKeyViolations: dbCheck.foreignKeyViolations?.length ?? 0,
      tableCount: dbCheck.tableCount,
    }, dbCheck.ok === true)

    const snap = snapshotProject(dirs.projectA)
    const draftRows = snap.drafts
    const bodyOk = draftRows.length === 1
      && Number(draftRows[0]?.chapter_number) === 1
      && typeof draftRows[0]?.body === 'string'
      && draftRows[0].body.includes(proseMarker)
    record('storage.draft-readback', {
      draftCount: draftRows.length,
      chapterNumber: draftRows[0]?.chapter_number,
      containsMarker: Boolean(draftRows[0]?.body?.includes(proseMarker)),
      bodyLength: draftRows[0]?.body?.length ?? 0,
    }, bodyOk)

    record('storage.no-project-b-marker-in-a', {
      clean: !JSON.stringify(snap.tables).includes('E01-PROJECT-B'),
    }, !JSON.stringify(snap.tables).includes('E01-PROJECT-B'))

    const bDb = path.join(dirs.projectB, '.vela', 'vela.db')
    record('isolation.project-b-untouched', { dbExists: fs.existsSync(bDb) }, !fs.existsSync(bDb))

    const recentPath = path.join(dirs.globalHome, 'recent-projects.json')
    let recentOk = false
    if (fs.existsSync(recentPath)) {
      const list = JSON.parse(fs.readFileSync(recentPath, 'utf8'))
      recentOk = Array.isArray(list)
        && list.some((p) => p?.path && path.resolve(p.path) === path.resolve(dirs.projectA))
    }
    record('storage.global-home.recent-projects', { containsProjectA: recentOk }, recentOk)

    const fixtureHashesAfter = hashDirFiles(dirs.sourceFixtures)
    record('storage.source-fixtures.readonly',
      { unchanged: JSON.stringify(fixtureHashesBefore) === JSON.stringify(fixtureHashesAfter) },
      JSON.stringify(fixtureHashesBefore) === JSON.stringify(fixtureHashesAfter))
  }

  // 6. 汇总
  const failed = steps.filter((s) => !s.ok)
  const result = {
    scenario: 'E01-draft-persistence (partial: manual free draft)',
    runId: dirs.runId,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    failedSteps: failed.map((s) => s.name),
    steps,
    diagnostics: diagnostics.slice(-40),
  }
  writeEvidence(dirs, 'e01-result.json', result)
  const summary = writeEvidence(dirs, 'e01-result-summary.txt',
    steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`).join('\n'))
  fs.cpSync(dirs.evidence, path.join(repoRoot, 'test/acceptance/evidence', dirs.runId), { recursive: true })
  console.log(`\nverdict: ${result.verdict}（${steps.length - failed.length}/${steps.length} 步通过）`)
  console.log(`runRoot（保留供检查）: ${dirs.root}`)
  console.log(`evidence: ${summary}`)
  if (failed.length) process.exitCode = 1
}

main().catch((err) => {
  console.error('E01 crashed:', err)
  const dirs = activeDirs ?? { evidence: path.join(repoRoot, 'test/acceptance/evidence') }
  writeEvidence(dirs, 'e01-crash.log', String(err?.stack || err))
  if (activeDirs) {
    writeEvidence(dirs, 'e01-result.json', { scenario: 'E01-draft-persistence (partial)', runId: dirs.runId,
      verdict: 'FAIL', failedSteps: [...steps.filter(step => !step.ok).map(step => step.name), 'execution.crashed'],
      steps, error: String(err) })
    fs.cpSync(dirs.evidence, path.join(repoRoot, 'test/acceptance/evidence', dirs.runId), { recursive: true })
  }
  process.exitCode = 1
})
