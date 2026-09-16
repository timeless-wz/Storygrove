import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { getCanonicalPath, WorkspaceScannerService } from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'
import { CharacterRosterRepository } from '../repositories/character-roster-repository'

const roots: string[] = []

afterEach(() => {
  closeProjectDatabase()
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

function initProject(projectRoot: string): void {
  initProjectDatabase(projectRoot)
  getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id, project_name) VALUES ('main', 'E2E Test Novel')").run()
}

describe('Workspace Hub - SQLite End-to-End & Read-Only Guarantee', () => {
  it('scans external workspace in strictly read-only mode without mutating files', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-proj-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-external-'))
    roots.push(projectRoot, externalRoot)

    initProject(projectRoot)

    const file1Path = path.join(externalRoot, '01_已确认设定清单.md')
    const file1Content = '# 力量体系\n\n超凡序列共有九阶。\n\n## 第一阶：信使\n掌握基础传信与感知。'
    fs.writeFileSync(file1Path, file1Content, 'utf8')

    const file2Path = path.join(externalRoot, '05_人物与关系.md')
    const file2Content = '# 主要角色\n\n## 林巡\n身份：守夜人巡查使\n性格：沉稳冷酷\n能力：暗影穿梭\n\n## 顾沉\n身份：学者\n性格：内敛博学'
    fs.writeFileSync(file2Path, file2Content, 'utf8')

    const file3Path = path.join(externalRoot, '06_废案与漏洞记录.md')
    const file3Content = '# 废案\n\n## 废弃设定：灵气复苏早期版本\n该版本因逻辑漏洞已作废，绝对不可在正文中出现。'
    fs.writeFileSync(file3Path, file3Content, 'utf8')

    const statBefore1 = fs.statSync(file1Path)
    const statBefore2 = fs.statSync(file2Path)
    const statBefore3 = fs.statSync(file3Path)

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot)
    const scanResult = await WorkspaceScannerService.scanDirectory(externalRoot)

    expect(scanResult.success).toBe(true)
    expect(scanResult.scannedCount).toBe(3)
    expect(scanResult.recognizedCount).toBe(3)

    // Verify Read-Only Guarantee: mtimes and contents strictly unchanged
    const statAfter1 = fs.statSync(file1Path)
    const statAfter2 = fs.statSync(file2Path)
    const statAfter3 = fs.statSync(file3Path)

    expect(statAfter1.mtimeMs).toBe(statBefore1.mtimeMs)
    expect(statAfter2.mtimeMs).toBe(statBefore2.mtimeMs)
    expect(statAfter3.mtimeMs).toBe(statBefore3.mtimeMs)
    expect(fs.readFileSync(file1Path, 'utf8')).toBe(file1Content)
    expect(fs.readFileSync(file2Path, 'utf8')).toBe(file2Content)
    expect(fs.readFileSync(file3Path, 'utf8')).toBe(file3Content)

    // Verify Database Persistence
    const sources = WorkspaceHubRepository.listSources()
    expect(sources.length).toBe(3)

    const categories = sources.map(s => s.category)
    expect(categories).toContain('confirmed_settings')
    expect(categories).toContain('character_data')
    expect(categories).toContain('deprecated')

    // Verify Candidate Extraction: Lin Xun and Gu Chen extracted as candidates
    const candidates = WorkspaceHubRepository.listCandidates({ projectId: 'main', candidateType: 'character' })
    expect(candidates.length).toBe(2)
    const names = candidates.map(c => JSON.parse(c.suggestedData).name)
    expect(names).toContain('林巡')
    expect(names).toContain('顾沉')
    for (const c of candidates) {
      expect(c.status).toBe('pending')
    }
  })

  it('requires author approval before committing candidates into CharacterRosterRepository', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-proj-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-external-'))
    roots.push(projectRoot, externalRoot)

    initProject(projectRoot)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    const charDoc = path.join(externalRoot, '05_人物与关系.md')
    fs.writeFileSync(charDoc, '# 核心人物\n\n## 陆言明\n身份：特事局局长\n性格：深谋远虑\n关系：林巡的上司\n', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot)
    await WorkspaceScannerService.scanDirectory(externalRoot)

    const candidates = WorkspaceHubRepository.listCandidates({ projectId: 'main', candidateType: 'character' })
    expect(candidates.length).toBe(1)
    const candidate = candidates[0]
    expect(candidate.suggestedData).toContain('陆言明')
    expect(candidate.status).toBe('pending')

    const rosterBefore = CharacterRosterRepository.read()
    expect(rosterBefore.entries.length).toBe(0)

    // Author approves candidate
    const approveResult = WorkspaceHubRepository.approveCandidate(candidate.candidateId, 'main')
    if (!approveResult.success) console.error('approveCandidate error:', approveResult.error)
    expect(approveResult.success).toBe(true)

    const candidatesAfter = WorkspaceHubRepository.listCandidates({ projectId: 'main', candidateType: 'character' })
    expect(candidatesAfter[0].status).toBe('approved')

    const rosterAfter = CharacterRosterRepository.read()
    expect(rosterAfter.entries.length).toBe(1)
    expect(rosterAfter.entries[0].name).toBe('陆言明')
    expect(rosterAfter.entries[0].background).toContain('特事局局长')
    expect(rosterAfter.entries[0].notes).toContain('林巡的上司')
    expect(rosterAfter.renderedMarkdown).toContain('陆言明')

    const db = getProjectDb()!
    const row = db.prepare('SELECT name FROM characters WHERE name = ?').get('陆言明') as { name: string } | undefined
    expect(row).toBeDefined()
    expect(row!.name).toBe('陆言明')
  })

  it('manages confirmed, candidate, background, and deprecated rules correctly in SQLite', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-proj-'))
    roots.push(projectRoot)
    initProject(projectRoot)

    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-confirmed-1',
      projectId: 'main',
      title: '灵性守恒定律',
      content: '能量不可凭空产生。',
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '规则 > 守恒',
      sourceLineRange: '1-10',
    })

    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-candidate-1',
      projectId: 'main',
      title: '第七阶魔药配方',
      content: '需要深渊之眼作为主材（待定）。',
      status: 'candidate',
      constraintType: 'soft',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '配方 > 第七阶',
      sourceLineRange: '11-20',
    })

    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-deprecated-1',
      projectId: 'main',
      title: '废弃：纯机械飞升路线',
      content: '此体系已被魔幻序列替代，绝不可在正文中再次使用。',
      status: 'deprecated',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: '06_废案与漏洞记录.md',
      sourceHeadingPath: '废案 > 机械飞升',
      sourceLineRange: '1-15',
    })

    const allRules = WorkspaceHubRepository.listRules('main')
    expect(allRules.length).toBe(3)

    const confirmedRules = WorkspaceHubRepository.listRules('main', 'confirmed')
    expect(confirmedRules.length).toBe(1)
    expect(confirmedRules[0].ruleId).toBe('rule-confirmed-1')

    const deprecatedRules = WorkspaceHubRepository.listRules('main', 'deprecated')
    expect(deprecatedRules.length).toBe(1)
    expect(deprecatedRules[0].ruleId).toBe('rule-deprecated-1')

    WorkspaceHubRepository.updateRuleStatus('rule-candidate-1', 'main', 'confirmed')
    const confirmedAfter = WorkspaceHubRepository.listRules('main', 'confirmed')
    expect(confirmedAfter.length).toBe(2)
  })

  it('deterministically executes 13 stages in exact order and strictly excludes deprecated content', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-proj-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-external-'))
    roots.push(projectRoot, externalRoot)

    initProject(projectRoot)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    fs.writeFileSync(path.join(externalRoot, '00_创作方向.md'), '# 创作方向\n硬核克苏鲁探险\n', 'utf8')
    fs.writeFileSync(path.join(externalRoot, '01_已确认设定清单.md'), '# 规则\n## 正式法则\n不可在雾夜独行\n', 'utf8')
    fs.writeFileSync(path.join(externalRoot, '02_剧情总纲.md'), '# 总纲\n主角林巡解开黑雾之谜\n', 'utf8')
    fs.writeFileSync(path.join(externalRoot, '05_人物与关系.md'), '# 人物\n## 林巡\n主角，巡查使\n', 'utf8')
    fs.writeFileSync(path.join(externalRoot, '06_废案与漏洞记录.md'), '# 废案\n## 纯机械飞升\n绝不可在正文出现\n', 'utf8')
    fs.writeFileSync(path.join(externalRoot, '11_第一卷逐章细纲.md'), '# 细纲\n## 第1章 雾夜启航 [第1章]\n林巡在码头遭遇袭击\n', 'utf8')
    fs.writeFileSync(path.join(externalRoot, '12_叙述风格与正文规范.md'), '# 风格规范\n冷峻克制，多白描，杜绝网络梗\n', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot)
    await WorkspaceScannerService.scanDirectory(externalRoot)
    WorkspaceHubRepository.approveAllSources('main')

    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-cand',
      projectId: 'main',
      title: '未定异能',
      content: '控火术（未经作者确认）',
      status: 'candidate',
      constraintType: 'soft',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '规则 > 异能',
      sourceLineRange: '1-5',
    })

    const bundle = ChapterContextAssembler.assemble({ chapterNumber: 1, budgetChars: 20000, includeCandidates: true })

    expect(bundle.chapterNumber).toBe(1)
    expect(bundle.blocks.length).toBeGreaterThan(0)

    const stages = bundle.blocks.map(b => b.stage)
    expect(stages).toContain(1) // Stage 1: 创作总则
    expect(stages).toContain(13) // Stage 13: 废案排除清单

    // Strict Exclusion: Deprecated content must NOT appear in positive prompt blocks
    expect(bundle.blocks.filter(b => b.stage < 13).some(b => b.authorityStatus === 'deprecated')).toBe(false)
    const positiveBlocks = bundle.blocks.filter(b => b.stage < 13).map(b => b.content).join('\n')
    expect(positiveBlocks).not.toContain('纯机械飞升')
    expect(bundle.excludedDeprecatedCount).toBeGreaterThan(0)

    // Candidate item must carry warning prefix
    expect(bundle.fullAssembledText).toContain('待确认/候选')

    // Budget Capping test
    const limitedBundle = ChapterContextAssembler.assemble({ chapterNumber: 1, budgetChars: 200 })
    expect(limitedBundle.omissions.length).toBeGreaterThan(0)

    // Save as chapter material into blueprints table
    const db = getProjectDb()!
    const saveResult = db.prepare(`
      INSERT INTO blueprints (chapter_number, title, role, purpose, key_events, characters, suspense_hook, user_guidance, notes)
      VALUES (?, '第1章', '', '', '', '[]', '', ?, '')
    `).run(1, bundle.fullAssembledText)
    expect(saveResult.changes).toBe(1)

    const saved = db.prepare('SELECT user_guidance FROM blueprints WHERE chapter_number = 1').get() as { user_guidance: string }
    expect(saved.user_guidance).toContain('硬核克苏鲁探险')
  })

  it('keeps unapproved V1/V2 fragments and scanned rules out of context, then atomically switches approved history', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-versioned-project-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-versioned-source-'))
    roots.push(projectRoot, externalRoot)
    initProject(projectRoot)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    WorkspaceHubRepository.upsertRule({
      ruleId: 'manual-rule-never-replaced',
      projectId: 'main',
      title: '作者手工规则',
      content: '作者手工确认内容必须保留',
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: 'manual',
      sourceHeadingPath: '作者规则',
      sourceLineRange: '1-1',
      confirmedBy: 'author',
    })

    const sourcePath = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(sourcePath, '# 规则\n## 天律\nV1：月相决定潮汐门开启', 'utf8')
    expect((await WorkspaceScannerService.scanDirectory(externalRoot)).success).toBe(true)

    const initialSource = WorkspaceHubRepository.listSources()[0]
    const v1SnapshotId = initialSource.observedSnapshotId!
    expect(initialSource.approvedSnapshotId).toBeNull()
    let bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).not.toContain('V1：月相决定潮汐门开启')
    expect(WorkspaceHubRepository.listRules('main', 'confirmed').map(rule => rule.title)).toEqual(['作者手工规则'])

    expect(WorkspaceHubRepository.approveSource(initialSource.id).success).toBe(true)
    bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).toContain('V1：月相决定潮汐门开启')
    expect(WorkspaceHubRepository.listRules('main', 'confirmed').some(rule => rule.content.includes('V1：'))).toBe(true)

    fs.writeFileSync(sourcePath, '# 规则\n## 天律\nV2：双月重合才开启潮汐门', 'utf8')
    expect((await WorkspaceScannerService.scanDirectory(externalRoot)).success).toBe(true)
    const staleSource = WorkspaceHubRepository.listSources()[0]
    const v2SnapshotId = staleSource.observedSnapshotId!
    expect(v2SnapshotId).not.toBe(v1SnapshotId)
    expect(staleSource.approvedSnapshotId).toBe(v1SnapshotId)
    expect(staleSource.importStatus).toBe('stale')

    const db = getProjectDb()!
    db.prepare(`
      INSERT INTO workspace_source_fragments (
        fragment_id, source_id, heading_path, content, start_line, end_line,
        fragment_hash, purpose, status
      ) VALUES ('legacy-stale-v2', ?, '旧表新版本', 'V2 旧表泄露探针', 1, 1, 'legacy-v2', '', 'active')
    `).run(initialSource.id)

    bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).toContain('V1：月相决定潮汐门开启')
    expect(bundle.fullAssembledText).not.toContain('V2：双月重合才开启潮汐门')
    expect(bundle.fullAssembledText).not.toContain('V2 旧表泄露探针')
    expect(WorkspaceHubRepository.listRules('main', 'confirmed').some(rule => rule.content.includes('V2：'))).toBe(false)

    // 模拟开发期同快照已登记但片段丢失；相同内容重扫必须自动补齐。
    db.prepare('DELETE FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').run(v2SnapshotId)
    expect((db.prepare('SELECT COUNT(*) AS count FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').get(v2SnapshotId) as { count: number }).count).toBe(0)
    expect((await WorkspaceScannerService.scanDirectory(externalRoot)).success).toBe(true)
    expect((db.prepare('SELECT COUNT(*) AS count FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').get(v2SnapshotId) as { count: number }).count).toBeGreaterThan(0)
    expect((db.prepare('SELECT COUNT(*) AS count FROM workspace_source_fragments WHERE source_id = ?').get(initialSource.id) as { count: number }).count).toBe(1)

    expect(WorkspaceHubRepository.approveSource(initialSource.id).success).toBe(true)
    bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).toContain('V2：双月重合才开启潮汐门')
    expect(bundle.fullAssembledText).not.toContain('V1：月相决定潮汐门开启')
    expect(bundle.staleWarnings.some(warning => warning.includes(initialSource.relativePath))).toBe(false)

    const effectiveRules = WorkspaceHubRepository.listRules('main', 'confirmed')
    expect(effectiveRules.some(rule => rule.content.includes('V2：'))).toBe(true)
    expect(effectiveRules.some(rule => rule.content.includes('V1：'))).toBe(false)
    expect(effectiveRules.find(rule => rule.ruleId === 'manual-rule-never-replaced')?.content).toBe('作者手工确认内容必须保留')

    const history = db.prepare(`
      SELECT snap.snapshot_id, COUNT(frag.id) AS fragment_count
      FROM workspace_source_snapshots snap
      LEFT JOIN workspace_source_snapshot_fragments frag ON frag.snapshot_id = snap.snapshot_id
      WHERE snap.source_id = ?
      GROUP BY snap.snapshot_id
      ORDER BY snap.snapshot_id
    `).all(initialSource.id) as Array<{ snapshot_id: string; fragment_count: number }>
    expect(history.map(row => row.snapshot_id).sort()).toEqual([v1SnapshotId, v2SnapshotId].sort())
    expect(history.every(row => row.fragment_count > 0)).toBe(true)
    for (const snapshotId of [v1SnapshotId, v2SnapshotId]) {
      const ids = db.prepare('SELECT id FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').all(snapshotId) as Array<{ id: string }>
      expect(ids.every(row => row.id.startsWith(`${snapshotId}-f-`))).toBe(true)
    }
  })

  it('returns empty when the approved snapshot query is empty even if the legacy fragment table contains data', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-no-fallback-project-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-no-fallback-source-'))
    roots.push(projectRoot, externalRoot)
    initProject(projectRoot)
    const sourcePath = path.join(externalRoot, '00_创作方向.md')
    fs.writeFileSync(sourcePath, '# 原则\n批准快照正文', 'utf8')
    await WorkspaceScannerService.scanDirectory(externalRoot)
    const source = WorkspaceHubRepository.listSources()[0]
    WorkspaceHubRepository.approveSource(source.id)

    const db = getProjectDb()!
    db.prepare('DELETE FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').run(source.observedSnapshotId)
    db.prepare(`
      INSERT INTO workspace_source_fragments (
        fragment_id, source_id, heading_path, content, start_line, end_line,
        fragment_hash, purpose, status
      ) VALUES ('legacy-leak', ?, '旧表', '绝不能泄露的旧表正文', 1, 2, 'legacy-hash', '', 'active')
    `).run(source.id)

    expect(WorkspaceHubRepository.queryFragments({ categories: ['creation_principles'] })).toEqual([])
    expect(ChapterContextAssembler.assemble({ chapterNumber: 1 }).fullAssembledText).not.toContain('绝不能泄露的旧表正文')
  })

  it('cancels before atomic scan commit and preserves the last healthy observed and approved snapshot', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cancel-project-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cancel-source-'))
    roots.push(projectRoot, externalRoot)
    initProject(projectRoot)
    const sourcePath = path.join(externalRoot, '00_创作方向.md')
    fs.writeFileSync(sourcePath, '# 原则\nV1 健康快照', 'utf8')
    await WorkspaceScannerService.scanDirectory(externalRoot)
    const scanned = WorkspaceHubRepository.listSources()[0]
    WorkspaceHubRepository.approveSource(scanned.id)
    const healthy = WorkspaceHubRepository.listSources()[0]

    fs.writeFileSync(sourcePath, '# 原则\nV2 不得形成半成品', 'utf8')
    const controller = new AbortController()
    const pending = WorkspaceScannerService.scanDirectory(externalRoot, 'main', { signal: controller.signal })
    controller.abort()
    const cancelled = await pending
    expect(cancelled.success).toBe(false)
    expect(cancelled.error).toContain('取消')

    const after = WorkspaceHubRepository.listSources()[0]
    expect(after.observedSnapshotId).toBe(healthy.observedSnapshotId)
    expect(after.approvedSnapshotId).toBe(healthy.approvedSnapshotId)
    const bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).toContain('V1 健康快照')
    expect(bundle.fullAssembledText).not.toContain('V2 不得形成半成品')
  })

  it('audits a one-time legacy migration and migrates only explicitly imported sources', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-legacy-migration-'))
    roots.push(projectRoot)
    initProject(projectRoot)
    const db = getProjectDb()!
    db.prepare(`
      INSERT INTO workspace_sources (
        id, project_id, absolute_path, relative_path, category, authority_status,
        content_hash, import_status
      ) VALUES (?, 'main', ?, ?, 'creation_principles', 'confirmed', ?, ?)
    `).run('legacy-approved-source', 'C:/legacy/approved.md', 'approved.md', 'hash-approved', 'imported')
    db.prepare(`
      INSERT INTO workspace_sources (
        id, project_id, absolute_path, relative_path, category, authority_status,
        content_hash, import_status
      ) VALUES (?, 'main', ?, ?, 'creation_principles', 'confirmed', ?, ?)
    `).run('legacy-unapproved-source', 'C:/legacy/unapproved.md', 'unapproved.md', 'hash-unapproved', 'scanned')
    const insertLegacy = db.prepare(`
      INSERT INTO workspace_source_fragments (
        fragment_id, source_id, heading_path, content, start_line, end_line,
        fragment_hash, purpose, status
      ) VALUES (?, ?, 'legacy', ?, 1, 1, ?, '', 'active')
    `)
    insertLegacy.run('legacy-approved-fragment', 'legacy-approved-source', '明确批准的旧正文', 'frag-approved')
    insertLegacy.run('legacy-unapproved-fragment', 'legacy-unapproved-source', '未经批准的旧正文', 'frag-unapproved')
    db.prepare("DELETE FROM workspace_hub_migration_audit WHERE migration_id = 'workspace-hub-approved-snapshots-v1'").run()
    closeProjectDatabase()
    initProject(projectRoot)

    const migrated = WorkspaceHubRepository.queryFragments({ categories: ['creation_principles'] })
    expect(migrated.map(fragment => fragment.content)).toEqual(['明确批准的旧正文'])
    const audit = getProjectDb()!.prepare(`
      SELECT migrated_source_count, migrated_fragment_count
      FROM workspace_hub_migration_audit
      WHERE migration_id = 'workspace-hub-approved-snapshots-v1'
    `).get() as { migrated_source_count: number; migrated_fragment_count: number }
    expect(audit).toEqual({ migrated_source_count: 1, migrated_fragment_count: 1 })
  })

  it('handles deleted external files gracefully and preserves external files on unbind', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-proj-'))
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-external-'))
    roots.push(projectRoot, externalRoot)

    initProject(projectRoot)

    const fileA = path.join(externalRoot, '01_已确认设定清单.md')
    const fileB = path.join(externalRoot, '02_剧情总纲.md')
    fs.writeFileSync(fileA, '# 设定A\n内容A', 'utf8')
    fs.writeFileSync(fileB, '# 设定B\n内容B', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot)
    await WorkspaceScannerService.scanDirectory(externalRoot)

    expect(WorkspaceHubRepository.listSources().length).toBe(2)

    fs.unlinkSync(fileB)

    const rescanResult = await WorkspaceScannerService.scanDirectory(externalRoot)
    expect(rescanResult.success).toBe(true)

    const sourcesAfter = WorkspaceHubRepository.listSources()
    const missingSource = sourcesAfter.find(s => s.relativePath.includes('02_剧情总纲.md'))
    expect(missingSource).toBeDefined()
    expect(missingSource!.isMissing).toBe(true)

    WorkspaceHubRepository.unbindWorkspaceDirectory('main')
    const status = WorkspaceHubRepository.getStatus()
    expect(status.externalWorkspacePath).toBe('')

    expect(fs.existsSync(fileA)).toBe(true)
    expect(fs.readFileSync(fileA, 'utf8')).toBe('# 设定A\n内容A')
  })

  it('transactionally restores the last healthy binding after a cancelled compensation scan without mixing projects', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-recovery-project-'))
    const directoryA = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-recovery-a-'))
    const directoryB = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-recovery-b-'))
    roots.push(projectRoot, directoryA, directoryB)
    initProject(projectRoot)

    const projectId = 'session-recovery-a'
    const fileA = path.join(directoryA, '00_创作方向.md')
    const fileB = path.join(directoryB, '00_创作方向.md')
    fs.writeFileSync(fileA, '# 原则\n目录 A 的已批准健康内容', 'utf8')
    fs.writeFileSync(fileB, '# 原则\n目录 B 的未批准内容', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(directoryA, projectId)
    expect((await WorkspaceScannerService.scanDirectory(directoryA, projectId)).success).toBe(true)
    const scannedA = WorkspaceHubRepository.listSources(projectId)[0]
    expect(WorkspaceHubRepository.approveSource(scannedA.id, projectId).success).toBe(true)
    const healthyA = WorkspaceHubRepository.listSources(projectId)[0]
    const approvedSnapshotId = healthyA.approvedSnapshotId!
    expect(approvedSnapshotId).toBeTruthy()

    // B is bound for a compensation attempt, but cancellation happens before
    // commit; the repository must still remember A as the healthy binding.
    WorkspaceHubRepository.bindWorkspaceDirectory(directoryB, projectId)
    const abortController = new AbortController()
    const pendingScan = WorkspaceScannerService.scanDirectory(directoryB, projectId, { signal: abortController.signal })
    abortController.abort()
    const cancelled = await pendingScan
    expect(cancelled.success).toBe(false)
    expect(cancelled.error).toContain('取消')

    WorkspaceHubRepository.unbindWorkspaceDirectory(projectId)
    const restored = WorkspaceHubRepository.restoreWorkspaceDirectory(projectId)
    expect(restored).toEqual({ success: true })

    const status = WorkspaceHubRepository.getStatus(projectId)
    expect(status.externalWorkspacePath).toBe(directoryA)
    expect(status.missingFiles).toBe(0)

    const sourcesAfterRestore = WorkspaceHubRepository.listSources(projectId)
    expect(sourcesAfterRestore).toHaveLength(1)
    expect(sourcesAfterRestore[0].absolutePath).toBe(getCanonicalPath(fileA))
    expect(sourcesAfterRestore[0].isMissing).toBe(false)
    expect(sourcesAfterRestore[0].approvedSnapshotId).toBe(approvedSnapshotId)
    expect(WorkspaceHubRepository.listSources('another-session')).toEqual([])

    const db = getProjectDb()!
    expect(db.prepare(`
      SELECT snapshot_id FROM workspace_source_snapshots
      WHERE snapshot_id = ? AND source_id = ? AND project_id = ?
    `).get(approvedSnapshotId, healthyA.id, projectId)).toBeDefined()
    const effectiveFragments = WorkspaceHubRepository.queryFragments({ projectId })
    expect(effectiveFragments.map(fragment => fragment.content)).toEqual(['# 原则\n目录 A 的已批准健康内容'])
    expect(effectiveFragments.some(fragment => fragment.content.includes('目录 B'))).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_sources WHERE project_id = ? AND absolute_path = ?')
      .get(projectId, getCanonicalPath(fileB))).toEqual({ count: 0 })
  })
})
