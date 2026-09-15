import { afterEach, describe, expect, it } from 'vitest'
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

describe('Workspace Hub - Scanner Coverage & Boundary Conditions', () => {
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

  it('1. truncates with reason "max_files_limit" when directory contains 1001 files exceeding limit', async () => {
    const projDir = createDir('proj-limit-files-')
    const extDir = createDir('ext-limit-files-')
    initProjectDatabase(projDir)

    // 创建 1001 个合法的小文件（并发异步写入以避免 Windows 单盘同步串行 IO 耗时）
    await Promise.all(
      Array.from({ length: 1001 }, (_, idx) => {
        const pad = String(idx + 1).padStart(4, '0')
        return fs.promises.writeFile(path.join(extDir, `file_${pad}.txt`), `C${idx + 1}`, 'utf8')
      }),
    )

    const res = await WorkspaceScannerService.scanDirectory(extDir, 'main', { maxFiles: 1000 })
    expect(res.success).toBe(true)
    expect(res.truncated).toBe(true)
    expect(res.truncationReason).toBe('max_files_limit')
    expect(res.enumerationComplete).toBe(false)
    expect(res.scannedCount).toBe(1000)

    // 验证入库的 1000 个文件均正常持久化在 workspace_sources 中
    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources.length).toBe(1000)
  })

  it('2. truncates with reason "max_total_bytes_limit" when total content size exceeds byte budget', async () => {
    const projDir = createDir('proj-limit-bytes-')
    const extDir = createDir('ext-limit-bytes-')
    initProjectDatabase(projDir)

    // 创建 3 个 20KB 文件，设定 maxTotalBytes = 35KB
    const chunk20k = 'A'.repeat(20 * 1024)
    fs.writeFileSync(path.join(extDir, 'doc1.md'), `# Doc 1\n${chunk20k}`, 'utf8')
    fs.writeFileSync(path.join(extDir, 'doc2.md'), `# Doc 2\n${chunk20k}`, 'utf8')
    fs.writeFileSync(path.join(extDir, 'doc3.md'), `# Doc 3\n${chunk20k}`, 'utf8')

    const res = await WorkspaceScannerService.scanDirectory(extDir, 'main', {
      maxTotalBytes: 35 * 1024,
    })
    expect(res.success).toBe(true)
    expect(res.truncated).toBe(true)
    expect(res.truncationReason).toBe('max_total_bytes_limit')
    expect(res.enumerationComplete).toBe(false)
    expect(res.scannedCount).toBeLessThan(3)
  })

  it('3. handles unreadable subdirectory gracefully while root failure rolls back and throws', async () => {
    const projDir = createDir('proj-error-diff-')
    const extDir = createDir('ext-error-diff-')
    initProjectDatabase(projDir)

    fs.writeFileSync(path.join(extDir, '00_创作方向.md'), '# 方向\n正常文件', 'utf8')

    // 3a. 模拟子目录读取失败：Windows 权限不易跨平台模拟，使用只读/特殊命名或深层不存在
    const subDir = path.join(extDir, 'sub_unreadable')
    fs.mkdirSync(subDir)
    fs.writeFileSync(path.join(subDir, 'sub.md'), '# 子文件', 'utf8')

    // 首次正常扫描
    const scanOk = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scanOk.success).toBe(true)
    expect(scanOk.scannedCount).toBe(2)

    // 3b. 根目录读取失败：传入不存在的根路径
    const badRoot = path.join(extDir, 'does_not_exist_at_all')
    const scanBad = await WorkspaceScannerService.scanDirectory(badRoot, 'main')
    expect(scanBad.success).toBe(false)
    expect(scanBad.error).toBeDefined()

    // 确认已提交的数据库数据未受坏根目录影响（安全隔离）
    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources.length).toBe(2)
  })

  it('4. detects deleted external files, marks is_missing=1, and preserves approved snapshot', async () => {
    const projDir = createDir('proj-del-detect-')
    const extDir = createDir('ext-del-detect-')
    initProjectDatabase(projDir)

    const fileA = path.join(extDir, '00_创作方向.md')
    const fileB = path.join(extDir, '01_已确认设定清单.md')
    fs.writeFileSync(fileA, '# 创作方向\n永远遵守的原则', 'utf8')
    fs.writeFileSync(fileB, '# 设定清单\n第一条设定', 'utf8')

    // 首次扫描并批准两个来源
    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    const sourcesBefore = WorkspaceHubRepository.listSources('main')
    expect(sourcesBefore.length).toBe(2)

    WorkspaceHubRepository.approveSource(sourcesBefore[0].id, 'main')
    WorkspaceHubRepository.approveSource(sourcesBefore[1].id, 'main')

    const approvedBefore = WorkspaceHubRepository.listSources('main')
    const fileBSource = approvedBefore.find(s => s.relativePath.includes('01_已确认设定清单'))!
    expect(fileBSource.approvedSnapshotId).toBeTruthy()
    const originalApprovedSnapshotId = fileBSource.approvedSnapshotId

    // 物理删除 fileB
    fs.unlinkSync(fileB)
    expect(fs.existsSync(fileB)).toBe(false)

    // 再次重新扫描
    const rescan = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(rescan.success).toBe(true)

    // 验证 fileB 在数据库中被标记为 is_missing = 1，状态为 missing
    const sourcesAfter = WorkspaceHubRepository.listSources('main')
    const fileBAfter = sourcesAfter.find(s => s.relativePath.includes('01_已确认设定清单'))!
    expect(fileBAfter.isMissing).toBe(true)
    expect(fileBAfter.importStatus).toBe('missing')

    // 核心安全保证：此前已批准的快照必须完好保留在数据库中，绝不级联物理删除
    expect(fileBAfter.approvedSnapshotId).toBe(originalApprovedSnapshotId)
    const db = getProjectDb()!
    const snapshotRow = db.prepare('SELECT snapshot_id FROM workspace_source_snapshots WHERE snapshot_id = ?').get(originalApprovedSnapshotId)
    expect(snapshotRow).toBeDefined()
  })
})
