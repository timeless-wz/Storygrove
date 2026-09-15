import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initProjectDatabase,
  closeProjectDatabase,
} from '../database'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { WorkspaceScannerService } from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'

describe('Workspace Hub - End-to-End Traceability & Snapshot Context Isolation', () => {
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
})
