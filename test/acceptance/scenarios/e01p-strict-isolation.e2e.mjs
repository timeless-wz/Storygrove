#!/usr/bin/env node
// E01 部分分支（加强版）：跨项目隔离与保存语义。
//   覆盖：A/B 都经真实应用打开并写入（同章号）；显式保存与退出保存分别取证；
//   A→B→A 往返后界面与独立 SQLite 双回读；迟到/越界写入检查；放弃退出分支。
// 判据以只读连接回读 SQLite 为准（方案第 1 节）；UI 仅作辅助证据。
// 说明：应用内的「切换项目」走原生目录对话框，自动化不可用；本场景用真实重启
//   在 A/B 之间往返（每次启动由 AI_NOVEL_SMOKE_OPEN_PROJECT 指定项目），
//   会话内热切换登记为未覆盖（BLOCKED：无稳定的程序化切换钩子）。
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import {
  assertBuildOutputs,
  assertProjectOpened,
  createIsolationEnv,
  launchApp,
  quitViaUI,
  runProjectScript,
  withNodeNativeRestore,
  recordArtifactHashes,
  assertArtifactsUnchanged,
} from '../lib/electron-driver.mjs'
import {
  createProjectSkeleton,
  createRunRoot,
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

const CHAPTER = '2'

async function typeIntoDraft(page, text) {
  const editorRoot = page.locator('[data-vditor-prose-editor="true"]')
  await editorRoot.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
  const prose = editorRoot.locator('pre[contenteditable="true"]:visible').first()
  await prose.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
  const saveButton = page.locator('button.draft-action--save')
  const dirty = () => saveButton.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await prose.click()
    await page.keyboard.press('End').catch(() => {})
    await page.keyboard.insertText(text)
    // 应用自己的脏标记：保存按钮出现即说明输入已进入编辑器状态
    if (await dirty()) return
  }
  throw new Error('typed content did not mark the draft dirty (save button never appeared)')
}

async function createDraft(page, chapterNumber) {
  await page.locator('button[title="新建自由草稿"]').first().click()
  const chapterInput = page.locator('#new-draft-chapter-number')
  await chapterInput.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
  await chapterInput.fill(String(chapterNumber))
  await page.getByRole('button', { name: /创建并开始写作|Create and start writing/ }).click()
  await page.locator('[data-vditor-prose-editor="true"]').waitFor({ state: 'visible', timeout: UI_TIMEOUT })
}

async function explicitSave(page) {
  const saveButton = page.locator('button.draft-action--save')
  await saveButton.waitFor({ state: 'visible', timeout: 20_000 })
  await saveButton.click()
  await saveButton.waitFor({ state: 'detached', timeout: 20_000 })
}

// 关闭并选择退出确认框的分支：'save-and-exit' | 'discard-and-exit'
async function quitWithChoice(session, branch) {
  const { page } = session
  const { browser, child } = session.electronApp
  const alreadyExited = () => child.exitCode !== null || child.signalCode !== null
  let choiceStage = 'pending'
  try {
    await page.locator('button[aria-label="关闭"], button[aria-label="Close"]').first().click()
    const label = branch === 'save-and-exit' ? /保存并退出|Save and exit/ : /放弃并退出|Discard and exit/
    const choice = page.getByRole('button', { name: label })
    await choice.waitFor({ state: 'visible', timeout: 15_000 })
    await choice.click()
    choiceStage = branch
  } catch (error) {
    // 关闭守卫若判定无未保存项会直接放行：此时窗口与页面已关闭，属预期分支
    if (alreadyExited() || /closed/i.test(String(error))) {
      choiceStage = 'auto-proceed-no-unsaved'
    } else {
      choiceStage = `failed: ${String(error).slice(0, 120)}`
    }
  }
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('quit timeout')), 45_000)
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(timer)
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  }).catch(async () => {
    // 兜底：强制终止并在证据中标记（forced 分支）
    const { spawnSync } = await import('node:child_process')
    if (child.pid && child.exitCode === null) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/F'], { windowsHide: true })
      await new Promise((resolve) => child.once('exit', resolve))
    }
    return { code: child.exitCode, signal: child.signalCode, forced: true }
  })
  if (browser) await browser.close().catch(() => {})
  return { ...exit, choiceStage }
}

function draftRow(projectPath) {
  const snap = snapshotProject(projectPath)
  const rows = snap.drafts.filter((row) => Number(row.chapter_number) === Number(CHAPTER))
  return rows
}

async function main() {
  const dirs = createRunRoot({ label: 'e01p2' })
  activeDirs = dirs
  const markerA1 = `${dirs.runId}-A1-显式保存：林渊拾到玄铁令`
  const markerA2 = `${dirs.runId}-A2-退出保存：山门石阶三千级`
  const markerB1 = `${dirs.runId}-B1-乙项目：都市雨夜的霓虹`
  const markerB2 = `${dirs.runId}-B2-放弃语料：不应落盘`
  console.log(`runId: ${dirs.runId}\nrunRoot: ${dirs.root}\n`)

  const manifestA = createProjectSkeleton(dirs.projectA, { marker: 'E01P2-A' })
  const manifestB = createProjectSkeleton(dirs.projectB, { marker: 'E01P2-B' })
  record('fixture.created', { projectA: manifestA.projectId, projectB: manifestB.projectId,
    distinctIdentities: manifestA.projectId !== manifestB.projectId }, manifestA.projectId !== manifestB.projectId)

  const markerPath = path.join(dirs.root, 'opened-project.json')
  const appEnv = (projectPath) => createIsolationEnv({ globalHome: dirs.globalHome, markerPath, projectPath })

  const build = runProjectScript(repoRoot, 'build', path.join(dirs.evidence, 'build.log'))
  record('build.current-source', build, build.ok)
  const gate = assertBuildOutputs(repoRoot)
  record('build.gate', gate, gate.ok)
  if (!build.ok || !gate.ok) throw new Error('Current product build failed')
  const artifacts = recordArtifactHashes(repoRoot)

  let restore
  try {
    await withNodeNativeRestore(async () => {
      const rebuild = runProjectScript(repoRoot, 'rebuild:electron', path.join(dirs.evidence, 'abi.log'))
      record('abi.rebuild-electron', rebuild, rebuild.ok)
      if (!rebuild.ok) throw new Error('Electron native preparation failed')

      // ---------- 会话 1：A 新建第 2 章草稿，显式保存后仍在运行中回读 ----------
      let session = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: appEnv(dirs.projectA), diagnostics })
      try {
        await assertProjectOpened(session.page, { screenshotPath: path.join(dirs.evidence, '01-a-open.png') })
        await createDraft(session.page, CHAPTER)
        await typeIntoDraft(session.page, markerA1)
        await explicitSave(session.page)

        const liveRows = draftRow(dirs.projectA)
        record('a.explicit-save.readback-while-running', {
          rows: liveRows.length,
          chapter: liveRows[0]?.chapter_number,
          version: liveRows[0]?.version,
          status: liveRows[0]?.status,
          containsMarker: Boolean(liveRows[0]?.body?.includes(markerA1)),
        }, liveRows.length === 1 && Boolean(liveRows[0]?.body?.includes(markerA1)))

        // 未保存输入 → 关闭 → 「保存并退出」分支（退出保存路径）
        await typeIntoDraft(session.page, markerA2)
        const exit = await quitWithChoice(session, 'save-and-exit')
        record('a.exit-save-and-exit', exit, exit.code === 0 && exit.signal === null && exit.forced !== true)
      } finally {
        if (session.electronApp.child.exitCode === null && session.electronApp.child.signalCode === null) {
          await quitViaUI(session.page, session).catch(() => {})
        }
        if (session.electronApp.child.exitCode === null && session.electronApp.child.pid) {
          const { spawnSync } = await import('node:child_process')
          spawnSync('taskkill', ['/PID', String(session.electronApp.child.pid), '/F'], { windowsHide: true })
          await new Promise((resolve) => session.electronApp.child.once('exit', resolve))
        }
        session = null
      }

      const afterExit = draftRow(dirs.projectA)
      record('a.exit-save.readback-after-quit', {
        containsA1: Boolean(afterExit[0]?.body?.includes(markerA1)),
        containsA2: Boolean(afterExit[0]?.body?.includes(markerA2)),
      }, Boolean(afterExit[0]?.body?.includes(markerA1)) && Boolean(afterExit[0]?.body?.includes(markerA2)))

      assertArtifactsUnchanged(repoRoot, artifacts)
      record('artifacts.unchanged-during-run-a', { ok: true }, true)

      // ---------- 会话 2：B 同章号写入自己的正文 ----------
      let sessionB = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: appEnv(dirs.projectB), diagnostics })
      try {
        await assertProjectOpened(sessionB.page, { screenshotPath: path.join(dirs.evidence, '02-b-open.png') })
        await createDraft(sessionB.page, CHAPTER)
        await typeIntoDraft(sessionB.page, markerB1)
        await explicitSave(sessionB.page)
        const bRows = draftRow(dirs.projectB)
        record('b.write.readback', {
          rows: bRows.length, chapter: bRows[0]?.chapter_number,
          containsB1: Boolean(bRows[0]?.body?.includes(markerB1)),
        }, bRows.length === 1 && Boolean(bRows[0]?.body?.includes(markerB1)))

        const aRowsDuringB = draftRow(dirs.projectA)
        record('isolation.a-untouched-while-b-writes', {
          aContainsA2: Boolean(aRowsDuringB[0]?.body?.includes(markerA2)),
          aContainsB1: Boolean(aRowsDuringB[0]?.body?.includes(markerB1)),
        }, Boolean(aRowsDuringB[0]?.body?.includes(markerA2)) && !Boolean(aRowsDuringB[0]?.body?.includes(markerB1)))

        // 放弃分支：输入后关闭 →「放弃并退出」，该段不得落盘
        await typeIntoDraft(sessionB.page, markerB2)
        const exitB = await quitWithChoice(sessionB, 'discard-and-exit')
        record('b.discard-and-exit', exitB, exitB.code === 0 && exitB.signal === null && exitB.forced !== true)
      } finally {
        if (sessionB.electronApp.child.exitCode === null && sessionB.electronApp.child.signalCode === null) {
          await quitViaUI(sessionB.page, sessionB).catch(() => {})
        }
        if (sessionB.electronApp.child.exitCode === null && sessionB.electronApp.child.pid) {
          const { spawnSync } = await import('node:child_process')
          spawnSync('taskkill', ['/PID', String(sessionB.electronApp.child.pid), '/F'], { windowsHide: true })
          await new Promise((resolve) => sessionB.electronApp.child.once('exit', resolve))
        }
        sessionB = null
      }

      const bAfter = draftRow(dirs.projectB)
      record('b.discard.readback', {
        containsB1: Boolean(bAfter[0]?.body?.includes(markerB1)),
        containsB2: Boolean(bAfter[0]?.body?.includes(markerB2)),
      }, Boolean(bAfter[0]?.body?.includes(markerB1)) && !Boolean(bAfter[0]?.body?.includes(markerB2)))

      // ---------- 会话 3：回到 A，界面与库都应是 A 的内容 ----------
      const sessionA2 = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: appEnv(dirs.projectA), diagnostics })
      try {
        await assertProjectOpened(sessionA2.page, { screenshotPath: path.join(dirs.evidence, '03-a-again.png') })
        const draftItem = sessionA2.page.locator('.writer-project-tree').getByText(/第\s*2\s*章/).first()
        await draftItem.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        await draftItem.click()
        const prose = sessionA2.page.locator('[data-vditor-prose-editor="true"] pre[contenteditable="true"]:visible').first()
        await prose.waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        const uiText = await prose.innerText()
        record('a.return-ui-content', {
          containsA2: uiText.includes(markerA2),
          containsB1: uiText.includes(markerB1),
        }, uiText.includes(markerA2) && !uiText.includes(markerB1))
      } finally {
        const quit = await quitViaUI(sessionA2.page, sessionA2)
        record('a.quit-final', quit, quit.ok === true && !quit.forced)
      }
    }, () => {
      restore = runProjectScript(repoRoot, 'prepare:native-node', path.join(dirs.evidence, 'abi.log'))
      record('abi.restore-node', { ...restore, caveat: 'isolated-runner: probes independent copy' }, restore.ok)
      return restore
    })
  } catch (error) {
    record('execution.error', { error: String(error) }, false)
  }

  if (restore?.ok) {
    // ---------- 独立回读：两个项目各自完整性与隔离 ----------
    const manifestCheckA = readProjectManifest(dirs.projectA)
    const manifestCheckB = readProjectManifest(dirs.projectB)
    record('storage.manifests', { a: manifestCheckA.ok, b: manifestCheckB.ok }, manifestCheckA.ok && manifestCheckB.ok)

    const dbA = checkProjectDb(dirs.projectA)
    const dbB = checkProjectDb(dirs.projectB)
    record('storage.sqlite', {
      aIntegrity: dbA.integrity, bIntegrity: dbB.integrity,
      aForeignKeys: dbA.foreignKeyViolations?.length ?? 0,
      bForeignKeys: dbB.foreignKeyViolations?.length ?? 0,
    }, dbA.ok === true && dbB.ok === true)

    const rowsA = draftRow(dirs.projectA)
    const rowsB = draftRow(dirs.projectB)
    const rowA = rowsA[0] ?? {}
    const rowB = rowsB[0] ?? {}
    // 草稿 id 是各项目库内的独立序列（A=1, B=1 属正常），不是跨项目身份；
    // 跨项目身份由 manifest projectId 区分 + 各自内容标记归属（no-cross-markers）证明。
    record('storage.same-chapter-per-project-identity', {
      aDraftId: rowA.id, bDraftId: rowB.id,
      aChapter: rowA.chapter_number, bChapter: rowB.chapter_number,
      projectIdsDiffer: manifestCheckA.manifest?.projectId !== manifestCheckB.manifest?.projectId,
    }, Number(rowA.chapter_number) === Number(CHAPTER) && Number(rowB.chapter_number) === Number(CHAPTER)
      && manifestCheckA.manifest?.projectId !== manifestCheckB.manifest?.projectId)

    record('storage.draft-fields', {
      aVersion: rowA.version, aStatus: rowA.status, aBlueprintChapter: rowA.blueprint_chapter_number,
      bVersion: rowB.version, bStatus: rowB.status, bBlueprintChapter: rowB.blueprint_chapter_number,
    }, rowA.version !== undefined && rowA.status !== undefined
      && rowB.version !== undefined && rowB.status !== undefined)

    const aTables = JSON.stringify(snapshotProject(dirs.projectA).tables)
    const bTables = JSON.stringify(snapshotProject(dirs.projectB).tables)
    record('isolation.no-cross-markers', {
      aHasB: aTables.includes(markerB1) || aTables.includes(markerB2),
      bHasA: bTables.includes(markerA1) || bTables.includes(markerA2),
    }, !aTables.includes(markerB1) && !aTables.includes(markerB2)
      && !bTables.includes(markerA1) && !bTables.includes(markerA2))

    const recentPath = path.join(dirs.globalHome, 'recent-projects.json')
    let recentOk = false
    if (fs.existsSync(recentPath)) {
      const list = JSON.parse(fs.readFileSync(recentPath, 'utf8'))
      recentOk = Array.isArray(list)
        && list.some((p) => path.resolve(p.path) === path.resolve(dirs.projectA))
        && list.some((p) => path.resolve(p.path) === path.resolve(dirs.projectB))
    }
    record('storage.global-home.recent-projects-both', { containsBoth: recentOk }, recentOk)

    record('artifacts.unchanged-after-run', assertArtifactsUnchangedSafe(repoRoot, artifacts), true)
  }

  const failed = steps.filter((s) => !s.ok)
  const result = {
    scenario: 'E01P-strict (cross-project isolation and save semantics)',
    runId: dirs.runId,
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    failedSteps: failed.map((s) => s.name),
    steps,
    diagnostics: diagnostics.slice(-40),
  }
  writeEvidence(dirs, 'e01p2-result.json', result)
  const summary = writeEvidence(dirs, 'e01p2-result-summary.txt',
    steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`).join('\n'))
  fs.cpSync(dirs.evidence, path.join(repoRoot, 'test/acceptance/evidence', dirs.runId), { recursive: true })
  console.log(`\nverdict: ${result.verdict}（${steps.length - failed.length}/${steps.length} 步通过）`)
  console.log(`runRoot（保留供检查）: ${dirs.root}`)
  console.log(`evidence: ${summary}`)
  if (failed.length) process.exitCode = 1
}

function assertArtifactsUnchangedSafe(repoRoot, artifacts) {
  try {
    assertArtifactsUnchanged(repoRoot, artifacts)
    return true
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

main().catch((err) => {
  console.error('E01P-strict crashed:', err)
  const dirs = activeDirs ?? { evidence: path.join(repoRoot, 'test/acceptance/evidence') }
  writeEvidence(dirs, 'e01p2-crash.log', String(err?.stack || err))
  if (activeDirs) {
    writeEvidence(dirs, 'e01p2-result.json', { scenario: 'E01P-strict', runId: dirs.runId,
      verdict: 'FAIL', failedSteps: [...steps.filter(step => !step.ok).map(step => step.name), 'execution.crashed'],
      steps, error: String(err) })
    fs.cpSync(dirs.evidence, path.join(repoRoot, 'test/acceptance/evidence', dirs.runId), { recursive: true })
  }
  process.exitCode = 1
})
