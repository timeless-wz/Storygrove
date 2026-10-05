#!/usr/bin/env node
// 任务 D「章节蓝图统一版本」验收场景：
//   旧项目（仅 v1 简纲行、无任何 v2 细纲）→ 打开应用 → 启动迁移自动完成 →
//   统一编辑界面（无升级按钮/无旧版表单）→ 原内容完整可见 → 保存/取消/画布/
//   Markdown 导入/正文参考 → 退出重启 → 数据回读与幂等复核。
// 证据：evidence/task-d-before.json / task-d-after.json（迁移前后对比）、
//       截图、ui-actions.jsonl、lifecycle.jsonl。
// 运行：node test/acceptance/run-isolated-node.mjs test/acceptance/scenarios/blueprint-unified-editor.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import url from 'node:url'
import assert from 'node:assert/strict'

import {
  assertProjectOpened,
  createIsolationEnv,
  launchApp,
  quitViaUI,
  runProjectScript,
  withNodeNativeRestore,
} from '../lib/electron-driver.mjs'
import { createProjectSkeleton, createRunRoot, writeEvidence } from '../lib/fixtures.mjs'
import { prepareIsolatedNodeRuntime } from '../lib/isolated-node-runtime.mjs'

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(import.meta.url)

const steps = []
const record = (name, data, ok) => {
  steps.push({ name, ok, data: data ?? null })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) throw new Error(`step failed: ${name}: ${JSON.stringify(data)}`)
}
const diagnostics = []

async function main() {
  const dirs = createRunRoot({ label: 'task-d' })
  const evidence = dirs.evidence
  console.log(`runId: ${dirs.runId}\nrunRoot: ${dirs.root}\n`)
  const projectRoot = dirs.projectA
  createProjectSkeleton(projectRoot, { marker: 'TASK-D-LEGACY-PROJECT' })
  const dbPath = path.join(projectRoot, '.vela', 'vela.db')
  const markerPath = path.join(dirs.root, 'task-d-opened.json')

  // 0. 构建当前源码（验收只针对当前产物）。
  const build = runProjectScript(repoRoot, 'build', path.join(evidence, 'build.log'))
  record('build.current-source', build, build.ok)

  await withNodeNativeRestore(async () => {
    const rebuild = runProjectScript(repoRoot, 'rebuild:electron', path.join(evidence, 'abi.log'))
    record('abi.rebuild-electron', rebuild, rebuild.ok)
    if (!rebuild.ok) throw new Error('Electron native preparation failed')

    const launchEnv = () => createIsolationEnv({
      globalHome: dirs.globalHome,
      markerPath,
      projectPath: projectRoot,
    })

    // 1. 首次启动：由应用真实创建 schema（等价旧版本留下的空库骨架）。
    let session = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: launchEnv(), diagnostics })
    try {
      const opened = await assertProjectOpened(session.page, {
        screenshotPath: path.join(evidence, '01-first-launch.png'),
      })
      record('launch1.project-opened', opened, opened.ok)
    } finally {
      const quit = await quitViaUI(session.page, session)
      record('launch1.quit', quit, quit.ok === true && !quit.forced)
      session = null
    }

    // 2. 写入「旧项目」fixture：仅 v1 简纲行（含独立字段），无任何 blueprint_details 行。
    const runtime = prepareIsolatedNodeRuntime()
    const Database = require('better-sqlite3')
    {
      const db = new Database(dbPath, { nativeBinding: runtime.binding })
      try {
        db.pragma('journal_mode = WAL')
        db.prepare("UPDATE project_core SET project_name='任务D验收·旧版项目', words_per_chapter=3000, total_chapters=5 WHERE id='main'").run()
        const insert = db.prepare(`
          INSERT INTO blueprints (chapter_number, volume_id, title, role, purpose, key_events, characters, suspense_hook, user_guidance, notes, notes_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
        `)
        // 第 1 章：内容完整（标题/目的/关键事件/钩子/作者指导/章节要点/出场角色）。
        insert.run(1, 'volume-1', '雨夜追击', '冲突', '主角必须在雨夜前拿到账本。', '主角伪装成司机混入码头。\n遭遇第一次反转，接头人失踪。\n  缩进行保持原样。', JSON.stringify(['沈砺', '账房']), '账本里夹着第二张名单。', 'TASK-D-GUIDANCE-保留雨夜的压迫感，不要提前揭底。', 'TASK-D-NOTES-既有章节记录')
        // 第 2 章：内容完整（用于 Markdown 导入）。
        insert.run(2, 'volume-1', '码头接头', '发展', '与账房核对名单。', '账房交出半页名单后消失。', '[]', '名单背面画着一只眼睛。', 'TASK-D-GUIDANCE-CH2', 'TASK-D-NOTES-CH2')
        // 第 3 章：占位空行（不应被迁移，保持可被工作流填充；编辑器以种子展示）。
        insert.run(3, 'volume-1', '', '', '', '', '[]', '', '', '')
      } finally { db.close() }
    }
    const readDb = () => {
      const db = new Database(dbPath, { readonly: true, nativeBinding: runtime.binding })
      try {
        return {
          integrity: db.pragma('integrity_check', { simple: true }),
          blueprints: db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all(),
          details: db.prepare('SELECT chapter_number, schema_version, detail_json, raw_markdown, revision, content_hash FROM blueprint_details ORDER BY chapter_number').all(),
          drafts: db.prepare('SELECT id, chapter_number, blueprint_chapter_number, version, status, source FROM drafts ORDER BY id').all(),
          volumes: db.prepare('SELECT id, name, sort_order FROM blueprint_volumes ORDER BY sort_order').all(),
        }
      } finally { db.close() }
    }
    const before = readDb()
    assert.equal(before.integrity, 'ok')
    assert.equal(before.blueprints.length, 3)
    assert.equal(before.details.length, 0, 'fixture must be a v1-only legacy project')
    writeEvidence(dirs, 'task-d-before.json', before)
    record('fixture.legacy-project-written', { chapters: before.blueprints.length, details: 0 }, true)

    let launchCount = 0
    const launch = async () => {
      const s = await launchApp({ repoRoot, electronProfile: dirs.electronProfile, env: launchEnv(), diagnostics })
      launchCount += 1
      const opened = await assertProjectOpened(s.page, { screenshotPath: path.join(evidence, `02-launch-${launchCount}.png`) })
      record(`launch${launchCount}.project-opened`, opened, opened.ok)
      return s
    }

    // 3. 第二次启动：启动迁移应自动完成；UI 应只有统一编辑入口。
    session = await launch()
    const page = session.page
    const uiActions = []
    const logAction = async (name, fn) => {
      const value = await fn()
      uiActions.push({ at: new Date().toISOString(), name, ok: true })
      fs.writeFileSync(path.join(evidence, 'ui-actions.jsonl'), uiActions.map(item => JSON.stringify(item)).join('\n'))
      return value
    }
    const shot = name => page.screenshot({ path: path.join(evidence, name), fullPage: true })
    const consoleLog = []
    page.on('console', message => {
      if (message.text().includes('[ipc-client.invoke]')) consoleLog.push({ at: new Date().toISOString(), text: message.text() })
    })
    const listRow = chapterNumber => page.getByTestId(`blueprint-planning-select-chapter-${chapterNumber}`)
    // 统一视图的内容大多在受控输入（章题/分区条目/分镜）的 value 里，而非文本节点。
    const viewContent = () => page.locator('[data-testid="blueprint-v2-view"]').evaluateAll((views) => {
      const view = views[0]
      const controls = [...view.querySelectorAll('input, textarea')].map(el => el.value)
      return `${view.innerText}\n${controls.join('\n')}`
    })
    try {
      // 打开章节蓝图页（总览卡片）；总览入口先打开全书总纲，再显式选择第 1 章。
      // 挂 IPC 追踪：记录蓝图相关通道的调用参数（冲突取证用）。
      await page.evaluate(() => {
        const api = window.velaAPI
        const original = api.invoke.bind(api)
        window.__ipcTrace = []
        api.invoke = (channel, ...rest) => {
          try {
            window.__ipcTrace.push({ channel, args: JSON.stringify(rest, (_k, v) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…` : v)).slice(0, 500) })
          } catch { window.__ipcTrace.push({ channel, args: '<unserializable>' }) }
          return original(channel, ...rest)
        }
      })
      await logAction('open-blueprint-page', () => page.locator('[aria-label="打开章节蓝图"], [aria-label="Open chapter blueprints"]').first().click())
      await page.locator('[data-testid="blueprint-book-outline-editor"]').first().waitFor({ timeout: 45000 })
      await logAction('select-chapter-1', () => listRow(1).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })

      // 统一界面断言：无升级按钮、无旧版提示、状态行不带 v2 字样且显示迁移产物 r1。
      const unified = {
        upgradeButtonCount: await page.locator('[data-testid="blueprint-v2-upgrade"]').count(),
        legacyHintCount: await page.locator('[data-testid="blueprint-v1-hint"]').count(),
        unifiedViewCount: await page.locator('[data-testid="blueprint-v2-view"]').count(),
        statusText: await page.locator('[data-testid="blueprint-v2-status"]').first().innerText(),
      }
      record('ui.unified-editor-only', unified,
        unified.upgradeButtonCount === 0 && unified.legacyHintCount === 0
        && unified.unifiedViewCount >= 1 && unified.statusText.includes('正式细纲 r1')
        && !unified.statusText.includes('v2'))
      await logAction('screenshot', () => shot('03-unified-editor-ch1.png'))

      // 迁移映射在界面上的完整性：章题 / 核心使命 / 关键事件 / 章末钩子 / 独立字段。
      const chapterTitle = await page.locator('[data-testid="blueprint-v2-chapter-title"]').inputValue()
      const bodyText = await viewContent()
      const mapping = {
        chapterTitle,
        hasMission: bodyText.includes('主角必须在雨夜前拿到账本。'),
        hasKeyEvents: bodyText.includes('主角伪装成司机混入码头。') && bodyText.includes('遭遇第一次反转，接头人失踪。'),
        hasHook: bodyText.includes('账本里夹着第二张名单。'),
      }
      record('ui.migrated-content-visible', mapping,
        mapping.chapterTitle === '第1章｜雨夜追击' && mapping.hasMission && mapping.hasKeyEvents && mapping.hasHook)
      const textareaValues = await page.locator('[data-testid="blueprint-v2-view"] textarea').evaluateAll(textareas =>
        textareas.map(element => element.value))
      const aux = {
        guidanceKept: textareaValues.some(value => value.includes('TASK-D-GUIDANCE-保留雨夜的压迫感')),
        notesKept: textareaValues.some(value => value.includes('TASK-D-NOTES-既有章节记录')),
      }
      record('ui.aux-fields-preserved', aux, aux.guidanceKept && aux.notesKept)

      // 第 3 章（占位空行）：统一编辑器以种子（r0、未落库）展示，选择行为零数据库写入。
      await logAction('select-chapter-3', () => listRow(3).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })
      const ch3Status = await page.locator('[data-testid="blueprint-v2-status"]').first().innerText()
      record('ui.empty-chapter-seeded', { statusText: ch3Status }, ch3Status.includes('正式细纲 r0'))
      const ch3Read = readDb()
      assert.equal(ch3Read.details.filter(row => row.chapter_number === 3).length, 0, 'empty chapter must not be migrated by selection')
      record('ui.empty-chapter-no-db-write', { details: ch3Read.details.map(row => row.chapter_number) }, true)
      await logAction('back-to-chapter-1', () => listRow(1).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })

      // 保存语义：修改章题 → 保存 → r2；继续输入哨兵值 → 切章再切回（本地输入保留、数据库未变）。
      const titleInput = page.locator('[data-testid="blueprint-v2-chapter-title"]')
      await logAction('edit-chapter-title', () => titleInput.fill('第1章｜雨夜追击（修订）'))
      await logAction('save-outline', () => page.locator('[data-testid="blueprint-v2-save"]').click())
      await page.locator('[data-testid="blueprint-v2-status"]', { hasText: 'r2' }).waitFor({ timeout: 45000 })
      record('ui.save-produces-r2', { statusText: 'r2 visible' }, true)

      const sentinel = '第1章｜雨夜追击（未保存哨兵）'
      await logAction('type-unsaved-sentinel', () => titleInput.fill(sentinel))
      await logAction('switch-to-chapter-2', () => listRow(2).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })
      await logAction('switch-back-to-chapter-1', () => listRow(1).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })
      const retainedValue = await page.locator('[data-testid="blueprint-v2-chapter-title"]').inputValue()
      const afterSwitchDb = readDb()
      const savedTitle = JSON.parse(afterSwitchDb.details.find(row => row.chapter_number === 1).detail_json).chapterTitle
      record('ui.switch-saves-and-restores-input', { retainedValue, savedTitle },
        retainedValue === sentinel && savedTitle === sentinel)
      await logAction('screenshot', () => shot('04-after-save-and-cancel-check.png'))

      // 场景画布：切换可用。
      await logAction('open-canvas', () => page.locator('[data-testid="chapter-canvas-toggle"]').click())
      await page.locator('[data-testid="chapter-canvas-workbench"]').waitFor({ timeout: 45000 })
      record('ui.canvas-opens', { canvas: true }, true)
      await logAction('screenshot', () => shot('05-canvas.png'))
      await logAction('back-to-blueprint', () => page.getByRole('button', { name: '蓝图', exact: true }).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })

      // Markdown 导入（第 2 章）：解析预览 → 确认 → 分镜在界面可见。
      const importMarkdown = [
        '### 第2章｜码头接头',
        '#### 【本章定位与四维指标】',
        '- **核心使命**：与账房核对名单，发现内鬼。',
        '- **正文字数预算**：4200',
        '#### 【核心矛盾与博弈结构】',
        '- **实质冲突与转折**：账房交出半页名单后消失，酒馆老板翻脸。',
        '#### 【逐场分镜拆解】',
        '##### 场景一：雨棚下的接头',
        '苏砚压低帽檐，观察码头入口的人流。账房迟到十七分钟，袖口沾着煤灰。',
        '##### 场景二：仓库后的追逐',
        '账房突然折返仓库，苏砚翻窗追入，发现成箱的同款信封。',
        '#### 【章末爆点与断章定格】',
        '- **章末钩子**：名单背面画着一只眼睛。',
        '',
      ].join('\n')
      await logAction('select-chapter-2', () => listRow(2).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })
      await logAction('screenshot', () => shot('05b-chapter2-view.png'))
      const ch2StatusText = await page.locator('[data-testid="blueprint-v2-status"]').first().innerText()
      uiActions.push({ at: new Date().toISOString(), name: 'ch2-status-before-import', ok: true, data: { statusText: ch2StatusText } })
      fs.writeFileSync(path.join(evidence, 'ui-actions.jsonl'), uiActions.map(item => JSON.stringify(item)).join(String.fromCharCode(10)))
      await logAction('open-import-dialog', () => page.locator('[data-testid="blueprint-v2-import"]').click())
      await page.locator('[data-testid="blueprint-v2-import-dialog"]').waitFor({ timeout: 45000 })
      await logAction('paste-markdown', () => page.locator('#blueprint-v2-import-raw').fill(importMarkdown))
      await logAction('parse-preview', () => page.locator('[data-testid="blueprint-v2-import-preview-btn"]').click())
      await page.locator('[data-testid="blueprint-v2-import-preview"]').waitFor({ timeout: 45000 })
      await new Promise(resolve => setTimeout(resolve, 1500))
      // 轮询「已有细纲」提示：判别 existingDetail 是否曾被填充（取消竞态 vs 恒 null）。
      const poll = []
      for (let i = 0; i < 12; i += 1) {
        poll.push({
          t: i * 400,
          existingLine: (await page.locator('[data-testid="blueprint-v2-import-dialog"]').innerText().catch(() => '')).includes('该章已有细纲'),
          confirmDisabled: await page.locator('[data-testid="blueprint-v2-import-confirm"]').isDisabled().catch(() => 'gone'),
        })
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      uiActions.push({ at: new Date().toISOString(), name: 'existing-line-poll', ok: true, data: poll })
      fs.writeFileSync(path.join(evidence, 'ui-actions.jsonl'), uiActions.map(item => JSON.stringify(item)).join(String.fromCharCode(10)))
      await logAction('choose-target-chapter-2', () => page.locator('[data-testid="blueprint-v2-import-target"]').selectOption('2'))
      await new Promise(resolve => setTimeout(resolve, 1500))
      const targetState = {
        value: await page.locator('[data-testid="blueprint-v2-import-target"]').inputValue(),
        confirmDisabled: await page.locator('[data-testid="blueprint-v2-import-confirm"]').isDisabled(),
      }
      uiActions.push({ at: new Date().toISOString(), name: 'target-state', ok: true, data: targetState })
      await logAction('screenshot', () => shot('06-import-preview.png'))
      await logAction('confirm-import', () => page.locator('[data-testid="blueprint-v2-import-confirm"]').click())
      await new Promise(resolve => setTimeout(resolve, 4000))
      const postConfirm = {
        dialogOpen: await page.locator('[data-testid="blueprint-v2-import-dialog"]').count(),
        alerts: await page.locator('[role="alert"]').allInnerTexts(),
        recentIpc: consoleLog.slice(-14).map(item => item.text),
        ipcTrace: await page.evaluate(() => (window.__ipcTrace ?? []).filter(item => String(item.channel).includes('blueprint'))),
      }
      uiActions.push({ at: new Date().toISOString(), name: 'post-confirm-state', ok: true, data: postConfirm })
      fs.writeFileSync(path.join(evidence, 'ui-actions.jsonl'), uiActions.map(item => JSON.stringify(item)).join(String.fromCharCode(10)))
      await page.screenshot({ path: path.join(evidence, '06b-after-confirm.png'), fullPage: true })
      await page.locator('[data-testid="blueprint-v2-view"]').waitFor({ timeout: 45000 })
      await page.locator('[data-testid="blueprint-v2-status"]', { hasText: 'r2' }).waitFor({ timeout: 45000 })
      const importedContent = await viewContent()
      const sceneVisible = importedContent.includes('场景一：雨棚下的接头')
        && importedContent.includes('苏砚压低帽檐，观察码头入口的人流。')
        && importedContent.includes('场景二：仓库后的追逐')
      record('ui.markdown-import-applied', { sceneVisible }, sceneVisible)
      await logAction('screenshot', () => shot('07-imported-scenes.png'))

      // 正文参考：从蓝图页新建第 1 章正文，打开「本章创作上下文」侧栏核对细纲参考。
      await logAction('select-chapter-1', () => listRow(1).click())
      await page.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })
      await logAction('new-draft-ch1', () => page.getByRole('button', { name: /新建第1章正文/ }).first().click())
      const contextPurpose = page.locator('[data-testid="chapter-context-purpose"]')
      try {
        await contextPurpose.waitFor({ timeout: 4000, state: 'visible' })
      } catch {
        // 抽屉变体默认收起：展开后再读。
        await logAction('open-chapter-context', () => page.locator('[data-testid="draft-chapter-context-toggle"]').first().click())
        await contextPurpose.waitFor({ timeout: 45000 })
      }
      const contextText = await page.locator('body').innerText()
      const reference = {
        purposeVisible: contextText.includes('主角必须在雨夜前拿到账本。'),
        hookVisible: contextText.includes('账本里夹着第二张名单。'),
      }
      record('ui.prose-reference-works', reference, reference.purposeVisible && reference.hookVisible)
      await logAction('screenshot', () => shot('08-prose-reference.png'))
      const proseDirectory = page.locator('.chapter-outline-sidebar')
      const expandDirectory = proseDirectory.locator('[aria-label="展开卷章目录"]')
      if (await expandDirectory.count()) await expandDirectory.click()
      const collapsedVolume = proseDirectory.locator('.chapter-outline-arrow[aria-expanded="false"]').first()
      if (await collapsedVolume.count()) await collapsedVolume.click()
      await page.locator('.chapter-outline-chapter').first().waitFor()
      const proseDirectoryState = {
        chapters: await page.locator('.chapter-outline-chapter').count(),
        text: await proseDirectory.innerText(),
        count: await page.locator('.chapter-outline-volume-button small').first().innerText(),
      }
      record('ui.prose-directory-excludes-blueprints', proseDirectoryState,
        proseDirectoryState.chapters === 1 && proseDirectoryState.count === '1'
        && !proseDirectoryState.text.includes('章节蓝图') && !proseDirectoryState.text.includes('第 2 章'))
    } finally {
      fs.writeFileSync(path.join(evidence, 'ui-actions.jsonl'), uiActions.map(item => JSON.stringify(item)).join('\n'))
      fs.writeFileSync(path.join(evidence, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2))
      const quit = await quitViaUI(page, session)
      record('launch2.quit', quit, quit.ok === true && !quit.forced)
    }

    // 4. 退出后回读：选择“保存并退出”后哨兵成为 r3；未编辑占位章不落库；草稿绑定完好。
    const after = readDb()
    writeEvidence(dirs, 'task-d-after.json', after)
    assert.equal(after.integrity, 'ok')
    const detailRow1 = after.details.find(row => row.chapter_number === 1)
    const detailRow2 = after.details.find(row => row.chapter_number === 2)
    const detail1 = JSON.parse(detailRow1.detail_json)
    const detail2 = JSON.parse(detailRow2.detail_json)
    const legacyRow1 = after.blueprints.find(row => row.chapter_number === 1)
    const summary = {
      detailChapters: after.details.map(row => row.chapter_number),
      chapter1: { revision: detailRow1.revision, title: detail1.chapterTitle, origin: detail1.origin },
      chapter2: { revision: detailRow2.revision, title: detail2.chapterTitle, scenes: detail2.sections.flatMap(s => s.items ?? []).filter(item => item.kind === 'scene').length, origin: detail2.origin },
      chapter3HasDetail: after.details.some(row => row.chapter_number === 3),
      chapter1Legacy: {
        userGuidance: legacyRow1.user_guidance,
        notes: legacyRow1.notes,
        keyEvents: legacyRow1.key_events,
        suspenseHook: legacyRow1.suspense_hook,
        purpose: legacyRow1.purpose,
        characters: legacyRow1.characters,
        volumeId: legacyRow1.volume_id,
      },
      drafts: after.drafts,
    }
    record('db.after-readback', summary,
      summary.detailChapters.includes(1) && summary.detailChapters.includes(2)
      && summary.chapter1.title === '第1章｜雨夜追击（未保存哨兵）' && summary.chapter1.revision === 3 && summary.chapter1.origin === 'upgrade'
      && summary.chapter2.scenes === 2
      && summary.chapter1Legacy.userGuidance === 'TASK-D-GUIDANCE-保留雨夜的压迫感，不要提前揭底。'
      && summary.chapter1Legacy.notes === 'TASK-D-NOTES-既有章节记录'
      && summary.chapter1Legacy.keyEvents.includes('主角伪装成司机混入码头。')
      && summary.chapter1Legacy.suspenseHook === '账本里夹着第二张名单。'
      && summary.chapter1Legacy.purpose === '主角必须在雨夜前拿到账本。'
      && summary.chapter1Legacy.characters.includes('沈砺')
      && !summary.chapter3HasDetail
      && after.drafts.length === 1 && after.drafts[0].blueprint_chapter_number === 1)

    // 5. 重启复核：统一界面显示退出时保存的 r3；迁移幂等（无新增行/revision 不变）。
    session = await launch()
    try {
      const page3 = session.page
      await logAction('reopen-blueprint-page', () => page3.locator('[aria-label="打开章节蓝图"], [aria-label="Open chapter blueprints"]').first().click())
      await page3.locator('[data-testid="blueprint-book-outline-editor"]').first().waitFor({ timeout: 45000 })
      await logAction('reselect-chapter-1-after-reopen', () => page3.getByTestId('blueprint-planning-select-chapter-1').click())
      await page3.locator('[data-testid="blueprint-v2-view"]').first().waitFor({ timeout: 45000 })
      const restart = {
        upgradeButtonCount: await page3.locator('[data-testid="blueprint-v2-upgrade"]').count(),
        legacyHintCount: await page3.locator('[data-testid="blueprint-v1-hint"]').count(),
        statusText: await page3.locator('[data-testid="blueprint-v2-status"]').first().innerText(),
        chapterTitle: await page3.locator('[data-testid="blueprint-v2-chapter-title"]').inputValue(),
      }
      // 重启后必须显示“保存并退出”提交的值，不能依赖跨进程内存草稿。
      record('restart.unified-and-stable', restart,
        restart.upgradeButtonCount === 0 && restart.legacyHintCount === 0
        && restart.statusText.includes('正式细纲 r3') && !restart.statusText.includes('有未保存修改')
        && restart.chapterTitle === '第1章｜雨夜追击（未保存哨兵）')
      await logAction('screenshot', () => page3.screenshot({ path: path.join(evidence, '09-restart.png'), fullPage: true }))

      const afterRestart = readDb()
      const restartDetail1 = JSON.parse(afterRestart.details.find(row => row.chapter_number === 1).detail_json)
      const unchanged = JSON.stringify({ blueprints: after.blueprints, details: after.details, drafts: after.drafts })
        === JSON.stringify({ blueprints: afterRestart.blueprints, details: afterRestart.details, drafts: afterRestart.drafts })
      record('restart.data-unchanged', { unchanged, dbTitle: restartDetail1.chapterTitle },
        unchanged && restartDetail1.chapterTitle === '第1章｜雨夜追击（未保存哨兵）')
    } finally {
      const quit = await quitViaUI(session.page, session)
      record('launch3.quit', quit, quit.ok === true && !quit.forced)
    }
  }, () => {
    const restore = runProjectScript(repoRoot, 'prepare:native-node', path.join(evidence, 'abi-restore.log'))
    record('abi.restore-node', restore, restore.ok)
    return restore
  })

  writeEvidence(dirs, 'task-d-steps.json', steps)
  console.log(`\nALL ${steps.length} STEPS PASS\nevidence: ${dirs.evidence}`)
}

main().catch((error) => {
  console.error('SCENARIO FAILED:', error)
  process.exitCode = 1
})
