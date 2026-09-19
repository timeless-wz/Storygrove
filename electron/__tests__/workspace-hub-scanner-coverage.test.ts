import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

const MAX_FILES_FIXTURE_COUNT = 1001
const MAX_FILES_FIXTURE_LIMIT = 1000

function accessError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = 'EACCES'
  return error
}

describe('Workspace Hub - Scanner Coverage & Boundary Conditions', () => {
  const testRoots: string[] = []
  let maxFilesFixtureDir = ''

  function createDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    testRoots.push(dir)
    return dir
  }

  /**
   * project_core is the per-database singleton ledger row (id = 'main'), created
   * by ProjectCoreRepository.init when a project is opened. The scan commit is
   * fail-closed: if that row is missing the whole transaction rolls back, so the
   * fixture must establish it exactly like every other workspace-hub test.
   */
  function initProjectDatabaseWithCoreRow(projectDir: string): void {
    initProjectDatabase(projectDir)
    getProjectDb()!
      .prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')")
      .run()
  }

  /**
   * Write the fixture files with bounded concurrency. 1001 simultaneous writes
   * queue behind the shared libuv threadpool and thrash the Windows file cache,
   * which measurably costs more than a bounded pool.
   */
  async function writeFixtureFiles(dir: string, count: number): Promise<void> {
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(32, count) }, async () => {
      while (nextIndex < count) {
        const index = nextIndex++
        const pad = String(index + 1).padStart(4, '0')
        await fs.promises.writeFile(path.join(dir, `file_${pad}.txt`), `C${index + 1}`, 'utf8')
      }
    })
    await Promise.all(workers)
  }

  /**
   * Creating 1001 real files is ~0.5s of pure filesystem work (measured, and
   * irreducible: bounded pools, a synchronous loop and hardlinks all cost the
   * same or more). It is fixture construction rather than the behaviour under
   * test, so it is built once here instead of being charged to the scenario's
   * own test timeout. The fixture is unchanged: 1001 real files on disk with an
   * allowed extension.
   */
  beforeAll(async () => {
    maxFilesFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-limit-files-'))
    await writeFixtureFiles(maxFilesFixtureDir, MAX_FILES_FIXTURE_COUNT)
  })

  afterAll(async () => {
    if (!maxFilesFixtureDir) return
    try {
      await fs.promises.rm(maxFilesFixtureDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    closeProjectDatabase()
    // Asynchronous cleanup: a recursive synchronous delete of a thousand files
    // freezes this worker's event loop and amplifies suite-wide disk contention.
    await Promise.all(testRoots.splice(0).map(async (root) => {
      try {
        await fs.promises.rm(root, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }))
  })

  it('1. 先完整扫描并批准 1001 个来源，再以 1000 上限扫描，第 1001 个保持健康', async () => {
    const projDir = createDir('proj-limit-files-')
    initProjectDatabaseWithCoreRow(projDir)

    // Fixture construction is outside this test's budget; the scenario still
    // operates on exactly 1001 real, allowed files.
    expect(fs.readdirSync(maxFilesFixtureDir).length).toBe(MAX_FILES_FIXTURE_COUNT)

    // 1a. 先以足够上限进行完整扫描并全量批准
    const fullScan = await WorkspaceScannerService.scanDirectory(maxFilesFixtureDir, 'main', { maxFiles: 2000 })
    expect(fullScan.success).toBe(true)
    expect(fullScan.enumerationComplete).toBe(true)
    expect(fullScan.scannedCount).toBe(1001)

    const approveResult = WorkspaceHubRepository.approveAllSources('main')
    expect(approveResult.success).toBe(true)
    expect(approveResult.count).toBe(1001)

    const sourcesBefore = WorkspaceHubRepository.listSources('main')
    expect(sourcesBefore.length).toBe(1001)
    const source1001Before = sourcesBefore.find(s => s.relativePath.includes('file_1001.txt'))!
    expect(source1001Before).toBeDefined()
    expect(source1001Before.importStatus).toBe('imported')
    expect(source1001Before.isMissing).toBe(false)
    expect(source1001Before.approvedSnapshotId).toBeTruthy()

    // 1b. 再以 1000 阈值上限扫描
    const limitedScan = await WorkspaceScannerService.scanDirectory(maxFilesFixtureDir, 'main', {
      maxFiles: MAX_FILES_FIXTURE_LIMIT,
    })
    expect(limitedScan.success).toBe(true)
    expect(limitedScan.truncated).toBe(true)
    expect(limitedScan.truncationReason).toBe('max_files_limit')
    expect(limitedScan.enumerationComplete).toBe(false)
    expect(limitedScan.scannedCount).toBe(1000)

    // 1c. 验证第 1001 个来源仍然在库中保持健康（未被错误标记为 missing）
    const sourcesAfter = WorkspaceHubRepository.listSources('main')
    expect(sourcesAfter.length).toBe(1001)
    const source1001After = sourcesAfter.find(s => s.relativePath.includes('file_1001.txt'))!
    expect(source1001After.isMissing).toBe(false)
    expect(source1001After.importStatus).toBe('imported')
    expect(source1001After.approvedSnapshotId).toBe(source1001Before.approvedSnapshotId)
  })

  it('2. 先批准全部来源，再以较低总字节预算扫描，未覆盖来源保持健康', async () => {
    const projDir = createDir('proj-limit-bytes-')
    const extDir = createDir('ext-limit-bytes-')
    initProjectDatabaseWithCoreRow(projDir)

    // 创建 3 个 20KB 文件
    const chunk20k = 'A'.repeat(20 * 1024)
    fs.writeFileSync(path.join(extDir, 'doc1.md'), `# Doc 1\n${chunk20k}`, 'utf8')
    fs.writeFileSync(path.join(extDir, 'doc2.md'), `# Doc 2\n${chunk20k}`, 'utf8')
    fs.writeFileSync(path.join(extDir, 'doc3.md'), `# Doc 3\n${chunk20k}`, 'utf8')

    // 2a. 先完整扫描并全量批准
    const initialScan = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(initialScan.success).toBe(true)
    expect(initialScan.enumerationComplete).toBe(true)
    expect(initialScan.scannedCount).toBe(3)

    WorkspaceHubRepository.approveAllSources('main')
    const beforeSources = WorkspaceHubRepository.listSources('main')
    expect(beforeSources.every(s => s.importStatus === 'imported' && !s.isMissing)).toBe(true)

    // 2b. 以 35KB 预算扫描（只能容纳 1 个文件，其余文件跳过）
    const res = await WorkspaceScannerService.scanDirectory(extDir, 'main', {
      maxTotalBytes: 35 * 1024,
    })
    expect(res.success).toBe(true)
    expect(res.truncated).toBe(true)
    expect(res.truncationReason).toBe('max_total_bytes_limit')
    expect(res.enumerationComplete).toBe(false)
    expect(res.scannedCount).toBeLessThan(3)

    // 2c. 验证未被本轮预算覆盖的来源依然保持健康，未被误判为 missing
    const afterSources = WorkspaceHubRepository.listSources('main')
    expect(afterSources.length).toBe(3)
    for (const src of afterSources) {
      expect(src.isMissing).toBe(false)
      expect(src.importStatus).toBe('imported')
    }
  })

  it('3. 真正模拟子目录 readdir 和文件 lstat 失败', async () => {
    const projDir = createDir('proj-fs-error-')
    const extDir = createDir('ext-fs-error-')
    initProjectDatabaseWithCoreRow(projDir)

    fs.writeFileSync(path.join(extDir, 'fileA.md'), '# File A\n正常文件内容', 'utf8')
    const subDir = path.join(extDir, 'unreadable_sub')
    fs.mkdirSync(subDir)
    fs.writeFileSync(path.join(subDir, 'subfile.md'), '# Subfile', 'utf8')
    const badLstatFile = path.join(extDir, 'bad_lstat.md')
    fs.writeFileSync(badLstatFile, '# Bad Lstat', 'utf8')
    fs.writeFileSync(path.join(extDir, 'fileB.md'), '# File B\n另一个正常文件', 'utf8')

    // 真实 spy fs.promises.readdir 和 fs.promises.lstat
    const originalReaddir = fs.promises.readdir.bind(fs.promises)
    const originalLstat = fs.promises.lstat.bind(fs.promises)

    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (...args) => {
      const [p] = args
      const pStr = String(p)
      if (pStr.includes('unreadable_sub')) {
        throw accessError('EACCES: permission denied, scandir')
      }
      return originalReaddir(...args)
    })

    vi.spyOn(fs.promises, 'lstat').mockImplementation(async (...args) => {
      const [p] = args
      const pStr = String(p)
      if (pStr.includes('bad_lstat.md')) {
        throw accessError('EACCES: permission denied, lstat')
      }
      return originalLstat(...args)
    })

    const scanResult = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(scanResult.success).toBe(true)
    expect(scanResult.enumerationComplete).toBe(false)
    expect(scanResult.truncated).toBe(true)
    expect(scanResult.truncationReason).toBe('access_error')
    expect(scanResult.scannedCount).toBeGreaterThanOrEqual(2)

    // 验证正常文件 fileA 和 fileB 成功入库
    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources.some(s => s.relativePath.includes('fileA.md'))).toBe(true)
    expect(sources.some(s => s.relativePath.includes('fileB.md'))).toBe(true)
  })

  it('4. 根目录读取失败不提交任何观察结果', async () => {
    const projDir = createDir('proj-root-err-')
    const extDir = createDir('ext-root-err-')
    initProjectDatabaseWithCoreRow(projDir)

    // 先存入一条现有数据
    fs.writeFileSync(path.join(extDir, 'pre_existing.md'), '# Pre Existing', 'utf8')
    const initialScan = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(initialScan.success).toBe(true)
    const initialSources = WorkspaceHubRepository.listSources('main')
    expect(initialSources.length).toBe(1)

    // 模拟根目录读取失败：spy readdir 在 canonicalRoot 时抛出致命错误
    const originalReaddir = fs.promises.readdir.bind(fs.promises)
    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (...args) => {
      const [p] = args
      const pStr = String(p).toLowerCase()
      if (pStr.includes('ext-root-err')) {
        throw accessError('EACCES: permission denied on root')
      }
      return originalReaddir(...args)
    })

    const failedScan = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(failedScan.success).toBe(false)
    expect(failedScan.error).toContain('无法读取工作区根目录')

    // 验证数据库状态未发生任何污染与改变
    const sourcesAfter = WorkspaceHubRepository.listSources('main')
    expect(sourcesAfter.length).toBe(1)
    expect(sourcesAfter[0].id).toBe(initialSources[0].id)
  })

  it('5. 完整扫描且文件真实删除时才标记 missing', async () => {
    const projDir = createDir('proj-del-detect-')
    const extDir = createDir('ext-del-detect-')
    initProjectDatabaseWithCoreRow(projDir)

    const fileA = path.join(extDir, '00_创作方向.md')
    const fileB = path.join(extDir, '01_已确认设定清单.md')
    const fileC = path.join(extDir, '02_剧情总纲.md')
    fs.writeFileSync(fileA, '# 创作方向\n永远遵守的原则', 'utf8')
    fs.writeFileSync(fileB, '# 设定清单\n第一条设定', 'utf8')
    fs.writeFileSync(fileC, '# 剧情总纲\n大纲内容', 'utf8')

    // 首次完整扫描并批准所有来源
    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    WorkspaceHubRepository.approveAllSources('main')

    const approvedSources = WorkspaceHubRepository.listSources('main')
    const fileBSource = approvedSources.find(s => s.relativePath.includes('01_已确认设定清单'))!
    const fileCSource = approvedSources.find(s => s.relativePath.includes('02_剧情总纲'))!
    expect(fileBSource.approvedSnapshotId).toBeTruthy()
    expect(fileCSource.approvedSnapshotId).toBeTruthy()
    const originalBSnapshotId = fileBSource.approvedSnapshotId

    // 物理删除 fileB（此时 fileC 仍存在，因此 maxFiles=1 会在发现 fileA 后触发截断）
    fs.unlinkSync(fileB)
    expect(fs.existsSync(fileB)).toBe(false)

    // 5a. 如果扫描被截断（例如 maxFiles = 1，只能扫描 fileA，fileC 触发截断），未扫到的删除文件不能被标记 missing
    const truncatedScan = await WorkspaceScannerService.scanDirectory(extDir, 'main', { maxFiles: 1 })
    expect(truncatedScan.enumerationComplete).toBe(false)
    const sourcesAfterTruncated = WorkspaceHubRepository.listSources('main')
    const bAfterTruncated = sourcesAfterTruncated.find(s => s.relativePath.includes('01_已确认设定清单'))!
    expect(bAfterTruncated.isMissing).toBe(false)
    expect(bAfterTruncated.importStatus).toBe('imported')

    // 物理删除 fileC
    fs.unlinkSync(fileC)
    expect(fs.existsSync(fileC)).toBe(false)

    // 5b. 当执行无截断的完整扫描（enumerationComplete = true）时，真实删除的文件才标记 missing
    const fullRescan = await WorkspaceScannerService.scanDirectory(extDir, 'main')
    expect(fullRescan.success).toBe(true)
    expect(fullRescan.enumerationComplete).toBe(true)

    const sourcesAfterFull = WorkspaceHubRepository.listSources('main')
    const bAfterFull = sourcesAfterFull.find(s => s.relativePath.includes('01_已确认设定清单'))!
    const cAfterFull = sourcesAfterFull.find(s => s.relativePath.includes('02_剧情总纲'))!
    expect(bAfterFull.isMissing).toBe(true)
    expect(bAfterFull.importStatus).toBe('missing')
    expect(cAfterFull.isMissing).toBe(true)
    expect(cAfterFull.importStatus).toBe('missing')

    // 核心快照完整保留在数据库中
    expect(bAfterFull.approvedSnapshotId).toBe(originalBSnapshotId)
    const db = getProjectDb()!
    const snapshotRow = db.prepare('SELECT snapshot_id FROM workspace_source_snapshots WHERE snapshot_id = ?').get(originalBSnapshotId)
    expect(snapshotRow).toBeDefined()
  })
})
