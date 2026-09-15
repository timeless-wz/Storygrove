import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { initProjectDatabase, closeProjectDatabase, getProjectDb } from '../database'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { WorkspaceScannerService } from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'

function getDirectoryFingerprint(dir: string) {
  const result = new Map<string, { size: number; mtimeMs: number; hash: string }>()
  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(current, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile()) {
        const stat = fs.statSync(full)
        const content = fs.readFileSync(full)
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        result.set(full, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash,
        })
      }
    }
  }
  walk(dir)
  return result
}

const verifyPath = process.env.NOVEL_WORKSPACE_VERIFY_PATH
const canRunRealDirTest = Boolean(verifyPath && fs.existsSync(verifyPath))

// 1. 真实外部目录验证（仅当设置了 NOVEL_WORKSPACE_VERIFY_PATH 时执行，严禁硬编码路径）
describe.skipIf(!canRunRealDirTest)('Real Verification Directory Read-Only & Extraction Verification', () => {
  it('scans designated external directory without mutating any files and extracts facts', async () => {
    const targetDir = verifyPath!
    expect(fs.existsSync(targetDir)).toBe(true)

    const beforeFingerprint = getDirectoryFingerprint(targetDir)
    expect(beforeFingerprint.size).toBeGreaterThan(0)

    const tempProj = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-verify-desktop-'))
    initProjectDatabase(tempProj)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    try {
      WorkspaceHubRepository.bindWorkspaceDirectory(targetDir)
      const scanResult = await WorkspaceScannerService.scanDirectory(targetDir)
      expect(scanResult.success).toBe(true)
      expect(scanResult.scannedCount).toBe(beforeFingerprint.size)

      const sources = WorkspaceHubRepository.listSources()
      expect(sources.length).toBe(beforeFingerprint.size)

      // Verify read-only invariant: fingerprint must be identical
      const afterFingerprint = getDirectoryFingerprint(targetDir)
      expect(afterFingerprint.size).toBe(beforeFingerprint.size)
      for (const [filePath, beforeMeta] of beforeFingerprint.entries()) {
        const afterMeta = afterFingerprint.get(filePath)
        expect(afterMeta).toBeDefined()
        expect(afterMeta!.hash).toBe(beforeMeta.hash)
        expect(afterMeta!.size).toBe(beforeMeta.size)
      }
    } finally {
      closeProjectDatabase()
      try {
        fs.rmSync(tempProj, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })
})

// 2. 默认自动测试：使用隔离临时目录完整验证摄入、提取、只读保护与上下文装配
describe('Default Temporary Workspace Ingestion & Extraction Verification', () => {
  const tempDirs: string[] = []

  function createTempDir(prefix: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(d)
    return d
  }

  afterEach(() => {
    closeProjectDatabase()
    for (const d of tempDirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('scans mock novel directory without mutating files and extracts all categories', async () => {
    const projDir = createTempDir('proj-desktop-mock-')
    const workspaceDir = createTempDir('workspace-desktop-mock-')

    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    // Create 13 mock novel files corresponding to standard categories
    fs.writeFileSync(path.join(workspaceDir, '00_创作方向.md'), '# 核心创作总则\n## 真实硬核\n严禁伪科学')
    fs.writeFileSync(path.join(workspaceDir, '01_已确认设定清单.md'), '# 设定清单\n## 灵压守恒\n灵气在闭合空间内总量恒定')
    fs.writeFileSync(path.join(workspaceDir, '02_剧情总纲.md'), '# 剧情总纲\n第1阶段：驶出地图的末班车')
    fs.writeFileSync(path.join(workspaceDir, '03_世界资料.md'), '# 地理架构\n四域交错')
    fs.writeFileSync(path.join(workspaceDir, '04_事件素材.md'), '# 历史事件\n天坑陷落事件')
    fs.writeFileSync(path.join(workspaceDir, '05_人物与关系.md'), '# 角色档案\n## 许渡\n性别：男\n年龄：24\n定位：主角\n身份：幸存调查员')
    fs.writeFileSync(path.join(workspaceDir, '06_废案与漏洞记录.md'), '# 废案\n## 传送阵直达方案\n已明确废止')
    fs.writeFileSync(path.join(workspaceDir, '07_世界观后台.md'), '# 后台设定\n暗物质涌流')
    fs.writeFileSync(path.join(workspaceDir, '08_参考作品与借鉴边界.md'), '# 参考边界\n不可照搬既有硬科幻设想')
    fs.writeFileSync(path.join(workspaceDir, '09_爆点设计与情绪兑现.md'), '# 情绪爆点\n第1章悬念揭晓')
    fs.writeFileSync(path.join(workspaceDir, '10_第一卷剧情大纲.md'), '# 第一卷剧情大纲\n第1章至第8章展开')
    fs.writeFileSync(path.join(workspaceDir, '11_第一阶段_第01-08章_驶出地图的末班车.md'), '# 第1章 雾气弥漫\n许渡在末班车上醒来')
    fs.writeFileSync(path.join(workspaceDir, '12_语言风格与描写规范.md'), '# 语言风格\n克制冷峻')

    const beforeFingerprint = getDirectoryFingerprint(workspaceDir)
    expect(beforeFingerprint.size).toBe(13)

    WorkspaceHubRepository.bindWorkspaceDirectory(workspaceDir)
    const scanResult = await WorkspaceScannerService.scanDirectory(workspaceDir)
    expect(scanResult.success).toBe(true)
    expect(scanResult.scannedCount).toBe(13)
    expect(scanResult.recognizedCount).toBe(13)

    // Sources verification
    const sources = WorkspaceHubRepository.listSources()
    expect(sources.length).toBe(13)

    // Character candidates verification
    const candidates = WorkspaceHubRepository.listCandidates({ candidateType: 'character' })
    expect(candidates.length).toBeGreaterThan(0)
    const char = JSON.parse(candidates[0].suggestedData)
    expect(char.name).toBe('许渡')
    expect(char.role).toBe('protagonist')

    // 扫描提取规则仍在快照暂存层，批准前不得进入正式规则表。
    expect(WorkspaceHubRepository.listRules('main')).toEqual([])

    // Assemble chapter context (approve all sources first to test approved snapshot inclusion)
    WorkspaceHubRepository.approveAllSources('main')
    expect(WorkspaceHubRepository.listRules('main').length).toBeGreaterThan(0)
    const bundle = ChapterContextAssembler.assemble({ chapterNumber: 1, budgetChars: 16000 })
    expect(bundle.chapterNumber).toBe(1)
    expect(bundle.blocks.length).toBeGreaterThan(0)
    expect(bundle.excludedDeprecatedCount).toBeGreaterThan(0)

    // Verify Read-Only Invariant: Fingerprints must be bit-by-bit identical
    const afterFingerprint = getDirectoryFingerprint(workspaceDir)
    expect(afterFingerprint.size).toBe(beforeFingerprint.size)
    for (const [filePath, beforeMeta] of beforeFingerprint.entries()) {
      const afterMeta = afterFingerprint.get(filePath)
      expect(afterMeta).toBeDefined()
      expect(afterMeta!.hash).toBe(beforeMeta.hash)
      expect(afterMeta!.size).toBe(beforeMeta.size)
    }
  })
})
