import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initProjectDatabase,
  closeProjectDatabase,
  getProjectDb,
} from '../database'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { WorkspaceScannerService } from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'
import { registerWorkspaceHubController } from '../controllers/workspace-hub-controller'
import { projectAccess } from '../services/project-access'
import type { ChapterContextBundle } from '../../src/shared/workspace-hub'

type IpcHandler = (...args: unknown[]) => Promise<unknown>
const ipcHandlers = new Map<string, IpcHandler>()

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler)
    }),
  },
}))

describe('Workspace Hub - End-to-End Traceability & Snapshot Context Isolation', () => {
  beforeAll(() => {
    registerWorkspaceHubController()
  })

  const testRoots: string[] = []

  function createDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    testRoots.push(dir)
    return dir
  }

  afterEach(() => {
    closeProjectDatabase()
    for (const r of testRoots) {
      try {
        fs.rmSync(r, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    testRoots.length = 0
  })

  it('verifies strict snapshot isolation: V2 edits never leak before approval, and updates reflect after approval', async () => {
    const projDir = createDir('proj-trace-')
    const extDir = createDir('ext-trace-')
    initProjectDatabase(projDir)

    const docPrinciples = path.join(extDir, '00_创作方向.md')
    fs.writeFileSync(docPrinciples, '# 核心原则\n第一条：行文克制冷峻。\n', 'utf8')

    const docPlot = path.join(extDir, '02_剧情总纲.md')
    fs.writeFileSync(docPlot, '# 第一卷主线\n主角调查神秘失踪案。\n', 'utf8')

    // 1. 绑定并扫描
    WorkspaceHubRepository.bindWorkspaceDirectory(extDir, 'main')
    const scan1 = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scan1.success).toBe(true)

    // 2. 批准初始版本快照 (V1)
    const sourcesV1 = WorkspaceHubRepository.listSources('main')
    expect(sourcesV1.length).toBe(2)
    const principlesSource = sourcesV1.find(s => s.relativePath.includes('00_创作方向'))!
    const plotSource = sourcesV1.find(s => s.relativePath.includes('02_剧情总纲'))!

    WorkspaceHubRepository.approveSource(principlesSource.id, 'main')
    WorkspaceHubRepository.approveSource(plotSource.id, 'main')

    const approvedV1Sources = WorkspaceHubRepository.listSources('main')
    const principlesV1SnapId = approvedV1Sources.find(s => s.id === principlesSource.id)!.approvedSnapshotId!
    expect(principlesV1SnapId).toBeTruthy()

    // 3. 首次装配章节上下文：验证正文与溯源引用
    const bundleV1 = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundleV1.fullAssembledText).toContain('第一条：行文克制冷峻。')
    expect(bundleV1.fullAssembledText).toContain('主角调查神秘失踪案。')

    const principlesBlockV1 = bundleV1.blocks.find(b => b.stage === 1)
    expect(principlesBlockV1).toBeDefined()
    expect(principlesBlockV1!.sources.length).toBeGreaterThan(0)
    expect(principlesBlockV1!.sources[0].snapshotId).toBe(principlesV1SnapId)
    expect(bundleV1.staleWarnings.length).toBe(0)

    // 4. 修改外部文件写入 V2 未批准内容
    fs.writeFileSync(docPrinciples, '# 核心原则\n第一条：行文改为了狂放暴烈（V2草稿绝对不可泄露）。\n', 'utf8')

    // 重新扫描
    const scan2 = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scan2.success).toBe(true)

    // 验证状态标记为 stale
    const sourcesV2 = WorkspaceHubRepository.listSources('main')
    const principlesV2State = sourcesV2.find(s => s.id === principlesSource.id)!
    expect(principlesV2State.importStatus).toBe('stale')
    expect(principlesV2State.observedSnapshotId).not.toBe(principlesV1SnapId)
    expect(principlesV2State.approvedSnapshotId).toBe(principlesV1SnapId)

    // 5. 再次装配：核心安全边界！未批准的 V2 草稿绝不能泄露进正文装配
    const bundleV2Unapproved = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundleV2Unapproved.fullAssembledText).toContain('第一条：行文克制冷峻。')
    expect(bundleV2Unapproved.fullAssembledText).not.toContain('狂放暴烈')
    expect(bundleV2Unapproved.staleWarnings.length).toBeGreaterThan(0)
    expect(bundleV2Unapproved.staleWarnings.some(w => w.includes('00_创作方向'))).toBe(true)

    // 6. 作者批准 V2 快照
    const approveV2Result = WorkspaceHubRepository.approveSource(principlesSource.id, 'main')
    expect(approveV2Result.success).toBe(true)

    const principlesV2ApprovedSnapId = WorkspaceHubRepository.listSources('main')
      .find(s => s.id === principlesSource.id)!.approvedSnapshotId!
    expect(principlesV2ApprovedSnapId).toBe(principlesV2State.observedSnapshotId)

    // 7. 批准后装配：正文更新且溯源引用正确指向 V2 快照
    const bundleV2Approved = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundleV2Approved.fullAssembledText).toContain('狂放暴烈（V2草稿绝对不可泄露）。')
    expect(bundleV2Approved.fullAssembledText).not.toContain('行文克制冷峻')

    const principlesBlockV2 = bundleV2Approved.blocks.find(b => b.stage === 1)
    expect(principlesBlockV2).toBeDefined()
    expect(principlesBlockV2!.sources[0].snapshotId).toBe(principlesV2ApprovedSnapId)
    expect(bundleV2Approved.staleWarnings.length).toBe(0)
  })

  it('verifies Stage 2 confirmed rules and Stage 13 deprecated exclusions full provenance, V1/V2 lifecycle, and DB reverse lookup', async () => {
    const projDir = createDir('proj-trace-rules-')
    const extDir = createDir('ext-trace-rules-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!

    const docPrinciples = path.join(extDir, '00_创作方向.md')
    fs.writeFileSync(docPrinciples, '# 核心原则\n第一条：行文克制冷峻。\n', 'utf8')

    const docRules = path.join(extDir, '01_已确认设定清单.md')
    fs.writeFileSync(
      docRules,
      '# 灵力系统\n## 灵力不可逆转化律\n灵力消耗后只能转化为不可回收的辐射热，不可直接回充体内。\n\n## 魂契誓约限制\n高位契约一旦确立，违背者神魂将被天地规则直接湮灭。\n',
      'utf8',
    )

    const docWorld = path.join(extDir, '03_里世界探索.md')
    fs.writeFileSync(
      docWorld,
      '# 遗境档案\n## 沉沦之塔结构\n沉沦之塔分为九层，每一层受重力规则畸变影响。\n',
      'utf8',
    )

    const docDeprecated = path.join(extDir, '06_废案与漏洞记录.md')
    fs.writeFileSync(
      docDeprecated,
      '# 废弃设定记录\n## 双丹田互冲构想\n双丹田同时运转方案因存在严重逻辑矛盾，已永久废止。\n\n## 灵力永动机\n灵力无限循环方案违背守恒，已明确废案。\n',
      'utf8',
    )

    // 1. 绑定并扫描 V1
    WorkspaceHubRepository.bindWorkspaceDirectory(extDir, 'main')
    const scan1 = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scan1.success).toBe(true)

    // 2. 批准所有 V1 快照
    const sourcesV1 = WorkspaceHubRepository.listSources('main')
    expect(sourcesV1.length).toBe(4)
    for (const s of sourcesV1) {
      const res = WorkspaceHubRepository.approveSource(s.id, 'main')
      expect(res.success).toBe(true)
    }

    const approvedSourcesV1 = WorkspaceHubRepository.listSources('main')
    const ruleSourceV1 = approvedSourcesV1.find(s => s.relativePath.includes('01_已确认设定清单'))!
    const deprecatedSourceV1 = approvedSourcesV1.find(s => s.relativePath.includes('06_废案与漏洞记录'))!
    const worldSourceV1 = approvedSourcesV1.find(s => s.relativePath.includes('03_里世界探索'))!

    expect(ruleSourceV1.approvedSnapshotId).toBeTruthy()
    expect(deprecatedSourceV1.approvedSnapshotId).toBeTruthy()
    expect(worldSourceV1.approvedSnapshotId).toBeTruthy()

    // 3. 首次装配 V1
    const bundleV1 = ChapterContextAssembler.assemble({ chapterNumber: 1, includeBackgroundLore: true })
    expect(bundleV1.fullAssembledText).toContain('灵力消耗后只能转化为不可回收的辐射热')
    expect(bundleV1.fullAssembledText).toContain('高位契约一旦确立')
    expect(bundleV1.fullAssembledText).toContain('【双丹田互冲构想】')
    expect(bundleV1.fullAssembledText).toContain('【灵力永动机】')
    // 关键安全约束：废案正文全文严禁泄露注入正文
    expect(bundleV1.fullAssembledText).not.toContain('双丹田同时运转方案因存在严重逻辑矛盾')

    // 验证 Stage 2 (已确认规则) 完整溯源字段
    const stage2 = bundleV1.blocks.find(b => b.stage === 2)!
    expect(stage2).toBeDefined()
    expect(stage2.sources.length).toBe(3)
    for (const s of stage2.sources) {
      // 必须返回：sourceId, approvedSnapshotId, sourceSnapshotFragmentId, 文件路径, 标题路径, 行号范围, 内容哈希
      expect(s.sourceId).toBe(ruleSourceV1.id)
      expect(s.approvedSnapshotId).toBe(ruleSourceV1.approvedSnapshotId)
      expect(s.snapshotId).toBe(ruleSourceV1.approvedSnapshotId)
      expect(s.sourceSnapshotFragmentId).toBeTruthy()
      expect(s.sourceSnapshotFragmentId).not.toBe('')
      expect(typeof s.sourceSnapshotFragmentId).toBe('string')
      expect(s.fragmentId).toBe(s.sourceSnapshotFragmentId)
      expect(s.relativePath).toBe('01_已确认设定清单.md')
      expect(s.filePath).toBe('01_已确认设定清单.md')
      expect(s.headingPath).toBeTruthy()
      expect(s.titlePath).toBe(s.headingPath)
      expect(s.lineRange).toMatch(/^\d+-\d+$/)
      expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/)
    }

    // 验证 Stage 10 统一补齐 approvedSnapshotId
    const stage10 = bundleV1.blocks.find(b => b.stage === 10)
    if (stage10) {
      for (const s of stage10.sources) {
        expect(s.sourceId).toBe(worldSourceV1.id)
        expect(s.approvedSnapshotId).toBe(worldSourceV1.approvedSnapshotId)
        expect(s.snapshotId).toBe(worldSourceV1.approvedSnapshotId)
        expect(s.sourceSnapshotFragmentId).toBeTruthy()
        expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/)
        expect(s.lineRange).toMatch(/^\d+-\d+$/)
      }
    }

    // 验证 Stage 13 废案片段完整批准快照来源（不能只有 fragmentId）
    const stage13 = bundleV1.blocks.find(b => b.stage === 13)!
    expect(stage13).toBeDefined()
    expect(stage13.sources.length).toBeGreaterThan(0)
    for (const s of stage13.sources) {
      expect(s.sourceId).toBeTruthy()
      expect(s.approvedSnapshotId).toBe(deprecatedSourceV1.approvedSnapshotId)
      expect(s.snapshotId).toBe(deprecatedSourceV1.approvedSnapshotId)
      expect(s.sourceSnapshotFragmentId).toBeTruthy()
      expect(s.sourceSnapshotFragmentId).not.toBe('')
      expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(s.lineRange).toMatch(/^\d+-\d+$/)
      expect(s.relativePath).toBeTruthy()
      expect(s.headingPath).toBeTruthy()
    }

    // 验证数据库真实反查：每个来源引用都能在 SQLite 中真实反查到快照片段
    const allCitations = [...stage2.sources, ...(stage10 ? stage10.sources : []), ...stage13.sources]
    for (const c of allCitations) {
      const fragId = c.sourceSnapshotFragmentId || c.fragmentId
      const snapId = c.approvedSnapshotId || c.snapshotId
      expect(fragId).toBeTruthy()
      expect(snapId).toBeTruthy()

      const row = db.prepare(`
        SELECT id, snapshot_id, source_id, fragment_hash, heading_path
        FROM workspace_source_snapshot_fragments
        WHERE id = ? AND snapshot_id = ?
      `).get(fragId, snapId) as {
        id: string
        snapshot_id: string
        source_id: string
        fragment_hash: string
        heading_path: string
      } | undefined

      expect(row).toBeDefined()
      expect(row!.fragment_hash).toBe(c.contentHash)
      expect(row!.heading_path).toBe(c.headingPath)
    }

    // 4. 修改外部文件写入 V2 未批准内容
    fs.writeFileSync(
      docRules,
      '# 灵力系统\n## 灵力不可逆转化律\n灵力可以与气血实现自由无损双向逆转（V2草稿绝对不可泄露）。\n\n## 魂契誓约限制\n契约誓约限制改为可以缴纳赎金解除（V2未批准）。\n',
      'utf8',
    )
    fs.writeFileSync(
      docDeprecated,
      '# 废弃设定记录\n## 三丹田共鸣废案\n三丹田方案违背法则。\n',
      'utf8',
    )

    // 重新扫描 V2
    const scan2 = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scan2.success).toBe(true)

    // 验证状态标记为 stale
    const sourcesV2 = WorkspaceHubRepository.listSources('main')
    const ruleSourceV2State = sourcesV2.find(s => s.id === ruleSourceV1.id)!
    expect(ruleSourceV2State.importStatus).toBe('stale')
    expect(ruleSourceV2State.observedSnapshotId).not.toBe(ruleSourceV1.approvedSnapshotId)
    expect(ruleSourceV2State.approvedSnapshotId).toBe(ruleSourceV1.approvedSnapshotId)

    // 5. 扫描 V2 但不批准，正文和来源仍严格指向 V1
    const bundleV2Unapproved = ChapterContextAssembler.assemble({ chapterNumber: 1, includeBackgroundLore: true })
    expect(bundleV2Unapproved.fullAssembledText).toContain('只能转化为不可回收的辐射热')
    expect(bundleV2Unapproved.fullAssembledText).not.toContain('自由无损双向逆转')
    expect(bundleV2Unapproved.fullAssembledText).toContain('【双丹田互冲构想】')
    expect(bundleV2Unapproved.fullAssembledText).not.toContain('【三丹田共鸣废案】')

    const stage2Unapproved = bundleV2Unapproved.blocks.find(b => b.stage === 2)!
    expect(stage2Unapproved.sources[0].approvedSnapshotId).toBe(ruleSourceV1.approvedSnapshotId)

    const stage13Unapproved = bundleV2Unapproved.blocks.find(b => b.stage === 13)!
    expect(stage13Unapproved.sources[0].approvedSnapshotId).toBe(deprecatedSourceV1.approvedSnapshotId)

    expect(bundleV2Unapproved.staleWarnings.length).toBeGreaterThan(0)
    expect(bundleV2Unapproved.staleWarnings.some(w => w.includes('01_已确认设定清单'))).toBe(true)
    expect(bundleV2Unapproved.staleWarnings.some(w => w.includes('06_废案与漏洞记录'))).toBe(true)

    // 6. 批准 V2 快照
    WorkspaceHubRepository.approveSource(ruleSourceV1.id, 'main')
    WorkspaceHubRepository.approveSource(deprecatedSourceV1.id, 'main')

    const sourcesV2Approved = WorkspaceHubRepository.listSources('main')
    const ruleSourceV2ApprovedSnapId = sourcesV2Approved.find(s => s.id === ruleSourceV1.id)!.approvedSnapshotId!
    const depSourceV2ApprovedSnapId = sourcesV2Approved.find(s => s.id === deprecatedSourceV1.id)!.approvedSnapshotId!

    expect(ruleSourceV2ApprovedSnapId).toBe(ruleSourceV2State.observedSnapshotId)
    expect(ruleSourceV2ApprovedSnapId).not.toBe(ruleSourceV1.approvedSnapshotId)

    // 7. 批准 V2 后正文和来源同时切换到 V2
    const bundleV2Approved = ChapterContextAssembler.assemble({ chapterNumber: 1, includeBackgroundLore: true })
    expect(bundleV2Approved.fullAssembledText).toContain('自由无损双向逆转（V2草稿绝对不可泄露）。')
    expect(bundleV2Approved.fullAssembledText).not.toContain('只能转化为不可回收的辐射热')
    expect(bundleV2Approved.fullAssembledText).toContain('【三丹田共鸣废案】')
    expect(bundleV2Approved.fullAssembledText).not.toContain('【双丹田互冲构想】')

    const stage2V2 = bundleV2Approved.blocks.find(b => b.stage === 2)!
    expect(stage2V2.sources[0].approvedSnapshotId).toBe(ruleSourceV2ApprovedSnapId)

    const stage13V2 = bundleV2Approved.blocks.find(b => b.stage === 13)!
    expect(stage13V2.sources[0].approvedSnapshotId).toBe(depSourceV2ApprovedSnapId)

    // 8. 历史 V1 快照仍可查看，不能被 V2 覆盖
    const historicalV1Snap = db.prepare(`
      SELECT * FROM workspace_source_snapshots WHERE snapshot_id = ?
    `).get(ruleSourceV1.approvedSnapshotId) as { snapshot_id: string; fragment_count: number } | undefined
    expect(historicalV1Snap).toBeDefined()
    expect(historicalV1Snap!.snapshot_id).toBe(ruleSourceV1.approvedSnapshotId)

    const historicalV1Fragments = db.prepare(`
      SELECT * FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?
    `).all(ruleSourceV1.approvedSnapshotId) as Array<{ id: string; content: string }>
    expect(historicalV1Fragments.length).toBe(3)
    expect(historicalV1Fragments.some(f => f.content.includes('只能转化为不可回收的辐射热'))).toBe(true)

    // 9. 验证候选内容与废案边界：默认不进入正式上下文，废案仅作为负向排除约束
    // 手工新增一条候选规则
    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-test-candidate-1',
      projectId: 'main',
      title: '候选暗影界',
      content: '暗影界允许瞬移（候选试验设定）。',
      status: 'candidate',
      constraintType: 'soft',
      scope: 'global',
      sourceFile: '07_世界观后台.md',
      sourceHeadingPath: '世界观后台 > 候选暗影界',
      sourceLineRange: '10-20',
    })

    // 默认 includeCandidates = false
    const bundleDefaultCandidates = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundleDefaultCandidates.fullAssembledText).not.toContain('候选暗影界')
    expect(bundleDefaultCandidates.blocks.some(b => b.title.includes('候选暗影界'))).toBe(false)

    // 显式开启 includeCandidates = true
    const bundleWithCandidates = ChapterContextAssembler.assemble({ chapterNumber: 1, includeCandidates: true })
    expect(bundleWithCandidates.fullAssembledText).toContain('【候选世界设定（待确认/软参考）】')
    expect(bundleWithCandidates.fullAssembledText).toContain('暗影界允许瞬移（候选试验设定）。')
    expect(bundleWithCandidates.candidateWarnings.length).toBeGreaterThan(0)

    // 验证废案绝不作为正向事实出现在前 12 阶段
    for (let st = 1; st <= 12; st++) {
      const blk = bundleDefaultCandidates.blocks.find(b => b.stage === st)
      if (blk) {
        expect(blk.authorityStatus).not.toBe('deprecated')
        expect(blk.content).not.toContain('双丹田设定已废止')
      }
    }
  })

  it('guarantees scanned rules never produce empty snapshot fragment ID even with simulated DB omission', async () => {
    const projDir = createDir('proj-frag-id-')
    const extDir = createDir('ext-frag-id-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!

    const docRules = path.join(extDir, '01_已确认设定清单.md')
    fs.writeFileSync(
      docRules,
      '# 核心世界准则\n## 空间折叠限度\n折叠距离不得超过三千里，超过即引起空间坍缩。\n\n## 时间回溯铁律\n时间不可逆向回溯，任何回溯迹象均会被天道修正抹杀。\n',
      'utf8',
    )

    WorkspaceHubRepository.bindWorkspaceDirectory(extDir, 'main')
    const scanResult = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scanResult.success).toBe(true)

    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources.length).toBe(1)
    WorkspaceHubRepository.approveSource(sources[0].id, 'main')

    // 1. 正常批准后检查：数据库中所有 scan 规则的 source_snapshot_fragment_id 均非空
    const scanRulesInDb = db.prepare(`
      SELECT rule_id, source_snapshot_fragment_id, source_snapshot_id, source_id
      FROM setting_rules
      WHERE project_id = 'main' AND origin_type = 'scan'
    `).all() as Array<{
      rule_id: string
      source_snapshot_fragment_id: string | null
      source_snapshot_id: string | null
      source_id: string | null
    }>

    expect(scanRulesInDb.length).toBeGreaterThan(0)
    for (const r of scanRulesInDb) {
      expect(r.source_snapshot_fragment_id).toBeTruthy()
      expect(r.source_snapshot_fragment_id).not.toBe('')
      expect(r.source_snapshot_id).toBeTruthy()
      expect(r.source_id).toBeTruthy()
    }

    // 2. 正常装配检查：Stage 2 来源的 sourceSnapshotFragmentId 必须完整非空
    const bundleNormal = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    const stage2Normal = bundleNormal.blocks.find(b => b.stage === 2)!
    expect(stage2Normal).toBeDefined()
    expect(stage2Normal.sources.length).toBeGreaterThan(0)
    for (const s of stage2Normal.sources) {
      expect(s.sourceSnapshotFragmentId).toBeTruthy()
      expect(s.sourceSnapshotFragmentId).not.toBe('')
      expect(s.approvedSnapshotId).toBeTruthy()
      expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/)
    }

    // 3. 边界防护验证：模拟异常数据（手动将 setting_rules 中的 source_snapshot_fragment_id 清空为 NULL）
    db.prepare(`
      UPDATE setting_rules
      SET source_snapshot_fragment_id = NULL, source_fragment_id = NULL
      WHERE project_id = 'main' AND origin_type = 'scan'
    `).run()

    // 装配器必须具备自愈回查能力，绝不向正文上下文输出空的 snapshot fragment ID
    const bundleRecovered = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    const stage2Recovered = bundleRecovered.blocks.find(b => b.stage === 2)!
    expect(stage2Recovered).toBeDefined()
    expect(stage2Recovered.sources.length).toBeGreaterThan(0)
    for (const s of stage2Recovered.sources) {
      expect(s.sourceSnapshotFragmentId).toBeTruthy()
      expect(s.sourceSnapshotFragmentId).not.toBe('')
      expect(s.approvedSnapshotId).toBeTruthy()
      expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/)

      // 反查确认自愈得到的快照片段在数据库中真实存在
      const matchedRow = db.prepare(`
        SELECT id FROM workspace_source_snapshot_fragments
        WHERE id = ? AND snapshot_id = ?
      `).get(s.sourceSnapshotFragmentId, s.approvedSnapshotId)
      expect(matchedRow).toBeDefined()
    }
  })

  it('guarantees Stage 13 deprecated exclusions are never omitted even with minimal budgetChars and include titles and forbidden-use semantics', async () => {
    // 使用隔离临时目录与独立数据库
    const projDir = createDir('proj-tight-budget-')
    const extDir = createDir('ext-tight-materials-')
    initProjectDatabase(projDir)

    // 写入包含正常规则、正文素材与废止设定记录的文件
    const docRules = path.join(extDir, '01_已确认设定清单.md')
    const docMaterials = path.join(extDir, '03_里世界探索.md')
    const docDeprecated = path.join(extDir, '06_废案与漏洞记录.md')

    fs.writeFileSync(
      docRules,
      '# 灵力系统\n## 灵力不可逆转化律\n灵力消耗后只能转化为不可回收的辐射热，不可逆转。\n',
      'utf8',
    )
    fs.writeFileSync(
      docMaterials,
      '# 里世界\n## 荒古遗迹\n遗迹深处埋藏着第一纪元的大型机械构件，散发着微弱灵力波纹。\n',
      'utf8',
    )
    fs.writeFileSync(
      docDeprecated,
      '# 废案与漏洞记录\n## 双丹田互冲构想\n双丹田同时运转方案因存在严重逻辑矛盾，已于设定评审中废止。\n\n## 灵力永动机\n违背热力学与不可逆律，坚决禁止采用。\n',
      'utf8',
    )

    // 扫描并批准所有源文件
    const scanResult = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scanResult.success).toBe(true)

    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources.length).toBe(3)
    for (const s of sources) {
      const res = WorkspaceHubRepository.approveSource(s.id, 'main')
      expect(res.success).toBe(true)
    }

    // 1. 使用极小的 budgetChars (30 字符)，验证 Stage 13 绝不被省略
    const tightBundle = ChapterContextAssembler.assemble({
      chapterNumber: 1,
      budgetChars: 30,
      includeBackgroundLore: true,
    })

    // 验证 Stage 13 存在于 blocks 中，且绝未被推入 omissions
    const stage13Block = tightBundle.blocks.find(b => b.stage === 13)
    expect(stage13Block).toBeDefined()
    expect(tightBundle.omissions.some(o => o.stage === 13)).toBe(false)

    // 验证包含废案标题
    expect(stage13Block!.content).toContain('【双丹田互冲构想】')
    expect(stage13Block!.content).toContain('【灵力永动机】')

    // 验证包含禁止采用语义
    expect(stage13Block!.content).toMatch(/禁止.*采用|严禁.*采用/)

    // 关键安全防线：不得将废案正文全文注入上下文
    expect(stage13Block!.content).not.toContain('双丹田同时运转方案因存在严重逻辑矛盾')
    expect(tightBundle.fullAssembledText).not.toContain('双丹田同时运转方案因存在严重逻辑矛盾')

    // 验证来源凭证仍然完整
    expect(stage13Block!.sources.length).toBeGreaterThan(0)
    for (const s of stage13Block!.sources) {
      expect(s.sourceId).toBeTruthy()
      expect(s.approvedSnapshotId).toBeTruthy()
      expect(s.sourceSnapshotFragmentId).toBeTruthy()
      expect(s.contentHash).toMatch(/^[a-f0-9]{64}$/)
    }

    // 2. 验证保留最低预算机制：适中预算下，素材片段被省略以保留 Stage 13
    const midBundle = ChapterContextAssembler.assemble({
      chapterNumber: 1,
      budgetChars: 350,
      includeBackgroundLore: true,
    })
    const midStage13 = midBundle.blocks.find(b => b.stage === 13)
    expect(midStage13).toBeDefined()
    expect(midStage13!.content).toContain('【双丹田互冲构想】')
    expect(midStage13!.content).toMatch(/禁止.*采用|严禁.*采用/)
  })

  it('verifies locate source detail respects approved V1 when unapproved V2 exists, highlights exact fragment, and returns provenance-missing on mismatch', async () => {
    const projDir = createDir('proj-locate-trace-')
    const extDir = createDir('ext-locate-materials-')
    initProjectDatabase(projDir)

    const docRules = path.join(extDir, '01_已确认设定清单.md')
    const docDeprecated = path.join(extDir, '06_废案与漏洞记录.md')

    fs.writeFileSync(
      docRules,
      '# 灵力系统\n## 灵力不可逆转化律\n灵力消耗后只能转化为不可回收的辐射热（V1已批准原稿）。\n\n## 契约誓约\n高位契约一旦确立不可单方解除（V1已批准原稿）。\n',
      'utf8',
    )
    fs.writeFileSync(
      docDeprecated,
      '# 废案记录\n## 双丹田互冲构想\n双丹田同时运转方案因存在严重逻辑矛盾，已废止。\n',
      'utf8',
    )

    // 1. 扫描并批准 V1
    const scan1 = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scan1.success).toBe(true)

    const sourcesV1 = WorkspaceHubRepository.listSources('main')
    for (const s of sourcesV1) {
      WorkspaceHubRepository.approveSource(s.id, 'main')
    }

    const approvedSourcesV1 = WorkspaceHubRepository.listSources('main')
    const ruleSource = approvedSourcesV1.find(s => s.relativePath.includes('01_已确认设定清单'))!
    const v1SnapshotId = ruleSource.approvedSnapshotId!
    expect(v1SnapshotId).toBeTruthy()

    // 获取 V1 详情与快照片段
    const detailV1 = WorkspaceHubRepository.getSourceDetail(ruleSource.id, 'main')
    expect(detailV1.source).toBeDefined()
    expect(detailV1.targetSnapshotId).toBe(v1SnapshotId)
    expect(detailV1.provenanceStatus).toBe('found')
    expect(detailV1.fragments.length).toBe(3)
    const targetV1Fragment = detailV1.fragments.find(f => f.headingPath.includes('灵力不可逆转化律'))!
    expect(targetV1Fragment).toBeDefined()
    expect(targetV1Fragment.content).toContain('V1已批准原稿')

    // 2. 外部文件产生 V2 变更（未批准），产生 observedSnapshotId
    fs.writeFileSync(
      docRules,
      '# 灵力系统\n## 灵力不可逆转化律\n灵力可以与气血实现自由无损双向逆转（V2草稿绝对不可泄露）。\n\n## 契约誓约\n契约誓约限制改为可以缴纳赎金解除（V2未批准）。\n',
      'utf8',
    )

    const scan2 = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scan2.success).toBe(true)

    const sourcesV2 = WorkspaceHubRepository.listSources('main')
    const ruleSourceV2 = sourcesV2.find(s => s.id === ruleSource.id)!
    expect(ruleSourceV2.observedSnapshotId).not.toBe(v1SnapshotId)
    expect(ruleSourceV2.approvedSnapshotId).toBe(v1SnapshotId)

    // 3. 核心验收断言：未批准 V2 存在时，调用资料详情接口不得默认展示 observed_snapshot_id，必须仍展示 V1
    const detailAfterV2Observed = WorkspaceHubRepository.getSourceDetail(ruleSource.id, 'main')
    expect(detailAfterV2Observed.targetSnapshotId).toBe(v1SnapshotId)
    expect(detailAfterV2Observed.targetSnapshotId).not.toBe(ruleSourceV2.observedSnapshotId)
    expect(detailAfterV2Observed.fragments.length).toBe(3)
    const fragAfterObserved = detailAfterV2Observed.fragments.find(f => f.headingPath.includes('灵力不可逆转化律'))!
    expect(fragAfterObserved.content).toContain('V1已批准原稿')
    expect(fragAfterObserved.content).not.toContain('自由无损双向逆转')

    // 4. 指定 snapshotId 与 fragmentId 进行反查定位
    const detailWithExactRef = WorkspaceHubRepository.getSourceDetail(
      ruleSource.id,
      'main',
      v1SnapshotId,
      targetV1Fragment.fragmentId,
    )
    expect(detailWithExactRef.targetSnapshotId).toBe(v1SnapshotId)
    expect(detailWithExactRef.provenanceStatus).toBe('found')
    expect(detailWithExactRef.fragments.some(f => f.fragmentId === targetV1Fragment.fragmentId)).toBe(true)

    // 5. 校验 snapshot_id, source_id, fragment_id 三者一致性：若 fragmentId 不匹配，绝不静默回退，返回 provenance-missing
    const detailWithMismatchedFrag = WorkspaceHubRepository.getSourceDetail(
      ruleSource.id,
      'main',
      v1SnapshotId,
      'non-existent-or-corrupted-fragment-id',
    )
    expect(detailWithMismatchedFrag.provenanceStatus).toBe('provenance-missing')

    // 6. 限制 project_id：跨项目隔离查询必须返回空且标记 provenance-missing
    const detailCrossProject = WorkspaceHubRepository.getSourceDetail(
      ruleSource.id,
      'other-project-scope',
      v1SnapshotId,
      targetV1Fragment.fragmentId,
    )
    expect(detailCrossProject.source).toBeNull()
    expect(detailCrossProject.fragments.length).toBe(0)
    expect(detailCrossProject.provenanceStatus).toBe('provenance-missing')

    // 7. 章节上下文装配器生成的来源引用必须携带三要素且能直接定位至 V1
    const bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    const stage2 = bundle.blocks.find(b => b.stage === 2)!
    expect(stage2).toBeDefined()
    const targetSourceRef = stage2.sources.find(s => s.headingPath.includes('灵力不可逆转化律'))!
    expect(targetSourceRef).toBeDefined()
    expect(targetSourceRef.projectId).toBe('main')
    expect(targetSourceRef.approvedSnapshotId).toBe(v1SnapshotId)
    expect(targetSourceRef.sourceSnapshotFragmentId).toBe(targetV1Fragment.fragmentId)
    expect(targetSourceRef.provenanceStatus).toBe('found')

    // 用上下文来源引用的三要素反查资料详情
    const reverseDetail = WorkspaceHubRepository.getSourceDetail(
      targetSourceRef.sourceId!,
      targetSourceRef.projectId!,
      targetSourceRef.approvedSnapshotId,
      targetSourceRef.sourceSnapshotFragmentId,
    )
    expect(reverseDetail.targetSnapshotId).toBe(v1SnapshotId)
    expect(reverseDetail.provenanceStatus).toBe('found')
    expect(reverseDetail.fragments.find(f => f.fragmentId === targetSourceRef.sourceSnapshotFragmentId)!.content)
      .toContain('V1已批准原稿')
  })

  it('enforces strict cross-project isolation, 4-way SQL validation, and fail-closed defense via Controller/IPC project session', async () => {
    // 1. 真实准备双项目目录与外部资料：项目 A 与项目 B 各有同名规则
    const projDirA = fs.realpathSync.native(createDir('proj-isolate-A-'))
    const extDirA = fs.realpathSync.native(createDir('ext-isolate-A-'))
    const projDirB = fs.realpathSync.native(createDir('proj-isolate-B-'))
    const extDirB = fs.realpathSync.native(createDir('ext-isolate-B-'))

    // 建立项目清单
    fs.mkdirSync(path.join(projDirA, '.vela'), { recursive: true })
    fs.writeFileSync(
      path.join(projDirA, '.vela', 'project.json'),
      JSON.stringify({ schemaVersion: 1, kind: 'ai-novel-project', projectId: 'project-A', createdAt: new Date().toISOString() }),
    )
    fs.mkdirSync(path.join(projDirB, '.vela'), { recursive: true })
    fs.writeFileSync(
      path.join(projDirB, '.vela', 'project.json'),
      JSON.stringify({ schemaVersion: 1, kind: 'ai-novel-project', projectId: 'project-B', createdAt: new Date().toISOString() }),
    )

    // 项目 A 与项目 B 同名规则文件
    const docRulesA = path.join(extDirA, '01_已确认设定清单.md')
    const docRulesB = path.join(extDirB, '01_已确认设定清单.md')

    fs.writeFileSync(
      docRulesA,
      '# 灵力系统\n## 同名核心法则\n【项目A专属核心法则】天地灵气不可逆律，灵力消耗只能转化为不可回收的辐射热（绝密A）。\n',
      'utf8',
    )
    fs.writeFileSync(
      docRulesB,
      '# 灵力系统\n## 同名核心法则\n【项目B专属核心法则】法宝禁止双向转化律，灵气与气血禁止以任何形式转化（绝密B）。\n',
      'utf8',
    )

    // 2. 初始化并扫描项目 B
    initProjectDatabase(projDirB)
    const leaseB = projectAccess.beginSession({ kind: 'manifest', projectId: 'project-B', rootPath: projDirB })
    const sessionB = { projectId: 'project-B', leaseId: leaseB.leaseId, projectPath: projDirB }

    const scanB = await WorkspaceScannerService.scanDirectory(extDirB, 'project-B')
    expect(scanB.success).toBe(true)
    WorkspaceHubRepository.approveAllSources('project-B')

    const rulesB = WorkspaceHubRepository.listRules('project-B')
    const ruleB = rulesB.find(r => r.title === '同名核心法则')!
    expect(ruleB).toBeDefined()
    expect(ruleB.content).toContain('绝密B')
    const fragIdB = ruleB.sourceSnapshotFragmentId!
    const snapIdB = ruleB.sourceSnapshotId!
    const srcIdB = ruleB.sourceId!
    expect(fragIdB).toBeTruthy()
    expect(snapIdB).toBeTruthy()
    expect(srcIdB).toBeTruthy()

    // 通过 Controller/IPC 装配项目 B
    const assembleHandler = ipcHandlers.get('workspace:assemble-chapter-context')!
    const detailHandler = ipcHandlers.get('workspace:get-source-detail')!

    const bundleB = await assembleHandler(
      { sender: {} },
      1,
      undefined,
      false,
      sessionB,
    ) as ChapterContextBundle

    expect(bundleB.fullAssembledText).toContain('绝密B')
    expect(bundleB.fullAssembledText).not.toContain('绝密A')

    // 3. 切换到项目 A 并扫描
    closeProjectDatabase()
    initProjectDatabase(projDirA)
    const leaseA = projectAccess.beginSession({ kind: 'manifest', projectId: 'project-A', rootPath: projDirA })
    const sessionA = { projectId: 'project-A', leaseId: leaseA.leaseId, projectPath: projDirA }

    const scanA = await WorkspaceScannerService.scanDirectory(extDirA, 'project-A')
    expect(scanA.success).toBe(true)
    WorkspaceHubRepository.approveAllSources('project-A')

    const rulesA = WorkspaceHubRepository.listRules('project-A')
    const ruleA = rulesA.find(r => r.title === '同名核心法则')!
    expect(ruleA).toBeDefined()
    expect(ruleA.content).toContain('绝密A')
    const fragIdA = ruleA.sourceSnapshotFragmentId!
    const snapIdA = ruleA.sourceSnapshotId!
    const srcIdA = ruleA.sourceId!
    expect(fragIdA).toBeTruthy()
    expect(snapIdA).toBeTruthy()
    expect(srcIdA).toBeTruthy()

    // 通过 Controller/IPC 正常装配项目 A：验证只读取项目 A 内容
    const bundleA1 = await assembleHandler(
      { sender: {} },
      1,
      undefined,
      false,
      sessionA,
    ) as ChapterContextBundle

    expect(bundleA1.fullAssembledText).toContain('绝密A')
    expect(bundleA1.fullAssembledText).not.toContain('绝密B')
    expect(bundleA1.omissions.length).toBe(0)

    const dbA = getProjectDb()!

    // 4. 交叉污染测试场景 1：片段 ID 被错误交叉使用（项目 A 规则被篡改为使用项目 B 的 fragmentId）
    dbA.prepare(`
      UPDATE setting_rules
      SET source_snapshot_fragment_id = ?, source_fragment_id = NULL
      WHERE rule_id = ? AND project_id = 'project-A'
    `).run(fragIdB, ruleA.ruleId)

    // 装配项目 A：严格禁止跨项目读取，来源与快照片段不一致时必须失败关闭，装配结果绝不得读取项目 B 内容
    const bundleA2 = await assembleHandler(
      { sender: {} },
      1,
      undefined,
      false,
      sessionA,
    ) as ChapterContextBundle

    expect(bundleA2.fullAssembledText).not.toContain('绝密B')
    expect(bundleA2.fullAssembledText).not.toContain('法宝禁止双向转化律')
    // 失败关闭：该规则必须从正文上下文排除，并进入 omissions
    expect(bundleA2.omissions.some(o => o.title === '同名核心法则' && o.reason === 'provenance-mismatch')).toBe(true)
    expect(bundleA2.staleWarnings.some(w => w.includes('同名核心法则'))).toBe(true)

    // 5. 交叉污染测试场景 2：快照 ID 被错误交叉使用（项目 A 规则被篡改为使用项目 B 的 snapshotId）
    dbA.prepare(`
      UPDATE setting_rules
      SET source_snapshot_fragment_id = ?, source_fragment_id = NULL, source_snapshot_id = ?
      WHERE rule_id = ? AND project_id = 'project-A'
    `).run(fragIdA, snapIdB, ruleA.ruleId)

    const bundleA3 = await assembleHandler(
      { sender: {} },
      1,
      undefined,
      false,
      sessionA,
    ) as ChapterContextBundle

    expect(bundleA3.fullAssembledText).not.toContain('绝密B')
    expect(bundleA3.omissions.some(o => o.title === '同名核心法则' && o.reason === 'provenance-mismatch')).toBe(true)

    // 6. 交叉污染测试场景 3：规则 ID / 规则内容被错误跨项目交叉写入
    dbA.prepare(`
      INSERT INTO setting_rules (
        rule_id, project_id, title, content, status, constraint_type, scope,
        source_fragment_id, source_snapshot_fragment_id, source_file, source_heading_path, source_line_range,
        origin_type, source_id, source_snapshot_id
      ) VALUES (
        ?, 'project-B', '同名核心法则', '【项目B绝密侵入正文】跨项目规则内容', 'confirmed', 'hard', 'global',
        NULL, ?, '01_已确认设定清单.md', '灵力系统 > 同名核心法则', '1-5',
        'scan', ?, ?
      )
    `).run(ruleB.ruleId, fragIdB, srcIdB, snapIdB)

    const bundleA4 = await assembleHandler(
      { sender: {} },
      1,
      undefined,
      false,
      sessionA,
    ) as ChapterContextBundle

    expect(bundleA4.fullAssembledText).not.toContain('【项目B绝密侵入正文】')
    expect(bundleA4.fullAssembledText).not.toContain('绝密B')

    // 7. 资料详情反查接口通过 Controller/IPC 校验
    // 7.1 项目 A 来源 + 项目 A 快照 + 项目 B 片段 ID 交叉：返回明确的 provenance-missing 状态，不静默回退
    const detailCrossFragment = await detailHandler(
      { sender: {} },
      srcIdA,
      snapIdA,
      fragIdB,
      sessionA,
    ) as { provenanceStatus: string; targetSnapshotId: string; fragments: Array<{ fragmentId: string }> }

    expect(detailCrossFragment.provenanceStatus).toBe('provenance-missing')
    expect(detailCrossFragment.targetSnapshotId).toBe(snapIdA)

    // 7.2 显式跨项目来源 ID 查询：在项目 A 会话下查询不存在或属于其他项目的来源 ID，必须返回 null，严格禁止跨项目读取
    const detailCrossProject = await detailHandler(
      { sender: {} },
      'src-project-b-isolated-unique',
      snapIdB,
      fragIdB,
      sessionA,
    ) as { source: unknown; fragments: unknown[]; provenanceStatus: string }

    expect(detailCrossProject.source).toBeNull()
    expect(detailCrossProject.fragments.length).toBe(0)
    expect(detailCrossProject.provenanceStatus).toBe('provenance-missing')

    // 7.3 同名来源但交叉使用项目 B 的快照与片段 ID：快照隔离生效，在项目 A 中找不到该快照片段，标记 provenance-missing
    const detailCrossSnapshot = await detailHandler(
      { sender: {} },
      srcIdA,
      snapIdB,
      fragIdB,
      sessionA,
    ) as { source: unknown; fragments: unknown[]; provenanceStatus: string }

    expect(detailCrossSnapshot.source).toBeDefined()
    expect(detailCrossSnapshot.fragments.length).toBe(0)
    expect(detailCrossSnapshot.provenanceStatus).toBe('provenance-missing')

    // 7.4 正确的项目 A 来源回查：正常返回 found 且匹配项目 A 正文
    const detailNormalA = await detailHandler(
      { sender: {} },
      srcIdA,
      snapIdA,
      fragIdA,
      sessionA,
    ) as { provenanceStatus: string; targetSnapshotId: string; fragments: Array<{ fragmentId: string; content: string }> }

    expect(detailNormalA.provenanceStatus).toBe('found')
    expect(detailNormalA.targetSnapshotId).toBe(snapIdA)
    const fragAInDetail = detailNormalA.fragments.find(f => f.fragmentId === fragIdA)!
    expect(fragAInDetail).toBeDefined()
    expect(fragAInDetail.content).toContain('绝密A')
  })
})



