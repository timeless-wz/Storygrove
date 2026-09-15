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

describe('Workspace Hub - Session UUID & project_core Row Identity Persistence', () => {
  const testRoots: string[] = []
  const sessionProjectId = 'proj-a1b2c3d4-e5f6-7890-abcd-ef1234567890'

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
        // ignore cleanup error
      }
    }
    testRoots.length = 0
  })

  it('binds directory to project_core row "main" while sources isolate by session UUID, surviving DB reopen', async () => {
    const projectRoot = createDir('proj-uuid-test-')
    const externalRoot = createDir('ext-uuid-test-')

    initProjectDatabase(projectRoot)
    const db = getProjectDb()!

    // 写入测试资料
    const doc1 = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(doc1, '# 灵能体系\n灵能等级分为 1 到 9 阶。\n', 'utf8')

    const doc2 = path.join(externalRoot, '05_人物与关系.md')
    fs.writeFileSync(doc2, '# 角色名单\n## 苏晨\n定位：主角\n身份：守秘人\n性格：沉着冷静\n', 'utf8')

    // 1. 绑定外部目录（传入真实项目会话 UUID）
    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot, sessionProjectId)

    // 验证：project_core 主记录 id 严格为 "main"
    const coreRowMain = db.prepare('SELECT id, external_workspace_path FROM project_core WHERE id = ?').get('main') as {
      id: string
      external_workspace_path: string
    }
    expect(coreRowMain).toBeDefined()
    expect(coreRowMain.id).toBe('main')
    expect(coreRowMain.external_workspace_path).toBe(externalRoot)

    // 验证：严禁将 sessionProjectId 写入 project_core.id
    const coreRowUuid = db.prepare('SELECT id FROM project_core WHERE id = ?').get(sessionProjectId)
    expect(coreRowUuid).toBeUndefined()

    // 2. 首次扫描（使用真实会话 UUID）
    const scan1 = await WorkspaceScannerService.scanDirectory(externalRoot, sessionProjectId)
    expect(scan1.success).toBe(true)
    expect(scan1.scannedCount).toBe(2)

    // 验证：workspace_sources 的 project_id 严格为真实会话 UUID，绝非 "main"
    const sources = WorkspaceHubRepository.listSources(sessionProjectId)
    expect(sources.length).toBe(2)
    for (const s of sources) {
      expect(s.projectId).toBe(sessionProjectId)
    }

    const mainSources = WorkspaceHubRepository.listSources('main')
    expect(mainSources.length).toBe(0)

    // 验证：候选的 project_id 严格为真实会话 UUID
    const candidates = WorkspaceHubRepository.listCandidates({ projectId: sessionProjectId })
    expect(candidates.length).toBe(1)
    expect(candidates[0].projectId).toBe(sessionProjectId)

    // 3. 模拟应用重启：关闭项目数据库并重新打开
    closeProjectDatabase()
    initProjectDatabase(projectRoot)

    // 验证重启后依然能正确读取绑定的外部目录
    const boundPathAfterReopen = WorkspaceHubRepository.getBoundWorkspacePath(sessionProjectId)
    expect(boundPathAfterReopen).toBe(externalRoot)

    const statusAfterReopen = WorkspaceHubRepository.getStatus(sessionProjectId)
    expect(statusAfterReopen.externalWorkspacePath).toBe(externalRoot)
    expect(statusAfterReopen.totalFiles).toBe(2)
    expect(statusAfterReopen.pendingCandidates).toBe(1)

    // 4. 修改外部文件并重新扫描
    fs.appendFileSync(doc1, '\n## 附加补充\n新增灵能节点补充说明。\n', 'utf8')
    const scan2 = await WorkspaceScannerService.scanDirectory(externalRoot, sessionProjectId)
    expect(scan2.success).toBe(true)

    // 验证重新扫描后，数据依然完整绑定在 sessionProjectId 下
    const reloadedSources = WorkspaceHubRepository.listSources(sessionProjectId)
    expect(reloadedSources.length).toBe(2)
    for (const s of reloadedSources) {
      expect(s.projectId).toBe(sessionProjectId)
    }

    // 确认 project_core 依然只有唯一的 "main" 记录
    const projectDbNow = getProjectDb()!
    const allCoreRows = projectDbNow.prepare('SELECT id FROM project_core').all() as Array<{ id: string }>
    expect(allCoreRows.length).toBe(1)
    expect(allCoreRows[0].id).toBe('main')
  })
})
