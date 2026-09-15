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
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'UUID Test Novel')").run()

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

  it('2. missing project_core row causes bind, unbind, and scan to fail closed with rollback and zero silent INSERT OR IGNORE', async () => {
    const projectRoot = createDir('proj-failclosed-')
    const externalRoot = createDir('ext-failclosed-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!

    // 此时 project_core 未做任何初始化，无任何行记录
    expect(db.prepare('SELECT COUNT(*) AS c FROM project_core').get()).toEqual({ c: 0 })

    // 1. 尝试绑定外部目录：必须在事务内失败关闭，并抛出明确主记录缺失异常
    expect(() => {
      WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot, 'main')
    }).toThrow(/未能绑定外部目录到 project_core: 未找到 id = 'main' 的项目主记录/u)

    // 2. 尝试解绑外部目录：必须失败关闭并回滚
    expect(() => {
      WorkspaceHubRepository.unbindWorkspaceDirectory('main')
    }).toThrow(/未能更新 project_core 主记录: 未找到 id = 'main' 的项目主记录/u)

    // 3. 尝试记录扫描时间：必须失败关闭并回滚
    expect(() => {
      WorkspaceHubRepository.recordScanTime(new Date().toISOString(), 'main')
    }).toThrow(/未能更新 project_core 扫描时间: 未找到 id = 'main' 的项目主记录/u)

    // 4. 尝试执行扫描：在原子提交扫描完成时间阶段必须因主记录缺失完整回滚
    const doc = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(doc, '# 规则\n内容说明\n', 'utf8')

    const scanRes = await WorkspaceScannerService.scanDirectory(externalRoot, 'main')
    expect(scanRes.success).toBe(false)
    expect(scanRes.error).toContain("未能更新 project_core 扫描时间: 未找到 id = 'main' 的项目主记录")

    expect(() => {
      WorkspaceHubRepository.commitScanPayload({
        projectId: 'main',
        items: [],
        activeSourceIds: [],
        scanTime: new Date().toISOString(),
      })
    }).toThrow(/未能更新 project_core 扫描时间: 未找到 id = 'main' 的项目主记录/u)

    // 5. 核心断言：整个流程中严禁任何静默 INSERT OR IGNORE，project_core 记录数必须严格保持为 0
    const countAfter = (db.prepare('SELECT COUNT(*) AS c FROM project_core').get() as { c: number }).c
    expect(countAfter).toBe(0)

    // 事务完整回滚，来源表未残留任何已提交数据
    expect(WorkspaceHubRepository.listSources('main').length).toBe(0)
  })

  it('3. candidate query, approval, and rejection are strictly isolated by session UUID with zero fallback to main', () => {
    const projectRoot = createDir('proj-multi-tenant-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Multi Tenant Test')").run()

    const projectA = 'proj-tenant-aaaa-1111'
    const projectB = 'proj-tenant-bbbb-2222'

    const candId = 'cand-tenant-isolated-001'
    const settingPayload = {
      title: '天道禁令',
      content: '禁止任何凡人飞升。',
      constraintType: 'hard',
      scope: 'global',
    }

    // 在项目 A 会话下保存候选
    WorkspaceHubRepository.saveCandidate({
      candidateId: candId,
      projectId: projectA,
      candidateType: 'setting',
      rawData: '天道禁令原文',
      suggestedData: JSON.stringify(settingPayload),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '法则 > 天道禁令',
      sourceLineRange: '1-5',
      evidence: '天道禁令',
      confidence: 1.0,
      status: 'pending',
    })

    // 1. 项目 B 查询候选列表：必须完全隔离，不可见项目 A 的候选
    const listB = WorkspaceHubRepository.listCandidates({ projectId: projectB })
    expect(listB).toHaveLength(0)

    const listA = WorkspaceHubRepository.listCandidates({ projectId: projectA })
    expect(listA).toHaveLength(1)
    expect(listA[0].candidateId).toBe(candId)

    // 2. 项目 B 尝试批准项目 A 的候选：必须严格拒绝，严禁向 main 或其他项目兼容回退
    const approveTryB = WorkspaceHubRepository.approveCandidate(candId, projectB)
    expect(approveTryB.success).toBe(false)
    expect(approveTryB.error).toBe('候选项目不存在')

    // 候选在项目 A 中依然严格保持 pending
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectA })[0].status).toBe('pending')

    // 3. 项目 B 尝试拒绝项目 A 的候选：必须严格拒绝
    const rejectTryB = WorkspaceHubRepository.rejectCandidate(candId, projectB)
    expect(rejectTryB.success).toBe(false)
    expect(rejectTryB.error).toBe('候选项目不存在')
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectA })[0].status).toBe('pending')

    // 4. 项目 A 正常批准自己的候选：成功且规则归属项目 A
    const approveA = WorkspaceHubRepository.approveCandidate(candId, projectA)
    expect(approveA.success).toBe(true)
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectA })[0].status).toBe('approved')

    // 规则严格进入项目 A，项目 B 不可见
    expect(WorkspaceHubRepository.listRules(projectA)).toHaveLength(1)
    expect(WorkspaceHubRepository.listRules(projectB)).toHaveLength(0)
  })

  it('4. setting_rules composite primary key (project_id, rule_id) prevents cross-project collision and enforces changes===1', () => {
    const projectRoot = createDir('proj-rules-isolation-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Rules Isolation Test')").run()

    const projectA = 'proj-tenant-aaaa-1111'
    const projectB = 'proj-tenant-bbbb-2222'
    const sharedRuleId = 'rule-shared-conflict-key'

    // 1. 项目 A 写入规则
    WorkspaceHubRepository.upsertRule({
      ruleId: sharedRuleId,
      projectId: projectA,
      title: '项目A规则：不可直视星空',
      content: '凡直视星空者，San值归零。',
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '法则',
      sourceLineRange: '1-10',
    })

    // 2. 项目 B 写入具有相同 ruleId 的完全不同规则
    WorkspaceHubRepository.upsertRule({
      ruleId: sharedRuleId,
      projectId: projectB,
      title: '项目B规则：欢迎仰望星空',
      content: '仰望星空获得星辉祝福。',
      status: 'confirmed',
      constraintType: 'soft',
      scope: 'chapter_range',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '法则',
      sourceLineRange: '1-10',
    })

    // 3. 验证复合主键隔离：两笔规则共存，绝无覆盖
    const rulesA = WorkspaceHubRepository.listRules(projectA)
    const rulesB = WorkspaceHubRepository.listRules(projectB)
    expect(rulesA).toHaveLength(1)
    expect(rulesB).toHaveLength(1)
    expect(rulesA[0].title).toBe('项目A规则：不可直视星空')
    expect(rulesA[0].content).toBe('凡直视星空者，San值归零。')
    expect(rulesB[0].title).toBe('项目B规则：欢迎仰望星空')
    expect(rulesB[0].content).toBe('仰望星空获得星辉祝福。')

    // 4. 项目 B 更新其规则状态为 deprecated，项目 A 规则不受影响
    WorkspaceHubRepository.updateRuleStatus(sharedRuleId, projectB, 'deprecated')
    expect(WorkspaceHubRepository.listRules(projectB)[0].status).toBe('deprecated')
    expect(WorkspaceHubRepository.listRules(projectA)[0].status).toBe('confirmed')

    // 5. 验证受影响行数校验 (changes === 1)：尝试更新不存在的项目规则抛出异常
    expect(() => {
      WorkspaceHubRepository.updateRuleStatus('non-existent-rule', projectA, 'confirmed')
    }).toThrow(/未找到属于项目 proj-tenant-aaaa-1111 的规则/u)

    expect(() => {
      WorkspaceHubRepository.deleteRule('non-existent-rule', projectA)
    }).toThrow(/未找到属于项目 proj-tenant-aaaa-1111 的规则/u)

    // 6. 验证 upsertRule 参数校验
    expect(() => {
      WorkspaceHubRepository.upsertRule({
        ruleId: '',
        projectId: projectA,
        title: '空ID规则',
        content: '内容',
        status: 'confirmed',
        constraintType: 'hard',
        scope: 'global',
        sourceFile: '01_已确认设定清单.md',
        sourceHeadingPath: '法则',
        sourceLineRange: '1-10',
      })
    }).toThrow(/设定规则 ruleId 不能为空/u)

    expect(() => {
      WorkspaceHubRepository.upsertRule({
        ruleId: 'valid-id',
        projectId: '',
        title: '空项目规则',
        content: '内容',
        status: 'confirmed',
        constraintType: 'hard',
        scope: 'global',
        sourceFile: '01_已确认设定清单.md',
        sourceHeadingPath: '法则',
        sourceLineRange: '1-10',
      })
    }).toThrow(/设定规则 projectId 不能为空/u)

    // 7. 项目 B 删除其规则，项目 A 规则毫发无损
    WorkspaceHubRepository.deleteRule(sharedRuleId, projectB)
    expect(WorkspaceHubRepository.listRules(projectB)).toHaveLength(0)
    expect(WorkspaceHubRepository.listRules(projectA)).toHaveLength(1)
    expect(WorkspaceHubRepository.listRules(projectA)[0].title).toBe('项目A规则：不可直视星空')
  })

  it('5. approved snapshots remain immutable and cannot be corrupted or mutated by rescans', async () => {
    const projectRoot = createDir('proj-snap-immutable-')
    const externalRoot = createDir('ext-snap-immutable-')
    initProjectDatabase(projectRoot)
    getProjectDb()!.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Snapshot Test')").run()
    const db = getProjectDb()!

    const doc = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(doc, '# 恒定法则\n第一条法则正文。\n', 'utf8')

    // 1. 绑定并首次扫描
    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot, 'main')
    const scan1 = await WorkspaceScannerService.scanDirectory(externalRoot, 'main')
    expect(scan1.success).toBe(true)

    // 2. 批准该快照 (V1)
    const sourceV1 = WorkspaceHubRepository.listSources('main')[0]
    expect(sourceV1).toBeDefined()
    const approveRes = WorkspaceHubRepository.approveSource(sourceV1.id, 'main')
    expect(approveRes.success).toBe(true)

    const approvedSource = WorkspaceHubRepository.listSources('main')[0]
    const approvedSnapId = approvedSource.approvedSnapshotId!
    expect(approvedSnapId).toBeDefined()

    // 记录 V1 批准快照在数据库中的确切数据
    const snapRowV1 = db.prepare(`
      SELECT snapshot_id, content_hash, fragment_count, file_size
      FROM workspace_source_snapshots WHERE snapshot_id = ?
    `).get(approvedSnapId) as { snapshot_id: string; content_hash: string; fragment_count: number; file_size: number }
    expect(snapRowV1).toBeDefined()

    const fragmentsV1 = db.prepare(`
      SELECT id, heading_path, content, fragment_hash
      FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?
    `).all(approvedSnapId) as Array<{ id: string; heading_path: string; content: string; fragment_hash: string }>
    expect(fragmentsV1.length).toBeGreaterThan(0)

    // 3. 修改外部文件正文并重新扫描
    fs.writeFileSync(doc, '# 恒定法则\n恶意篡改或重写的内容，尚未经过批准！\n', 'utf8')
    const scan2 = await WorkspaceScannerService.scanDirectory(externalRoot, 'main')
    expect(scan2.success).toBe(true)

    // 4. 核心断言：已批准快照元数据与片段记录必须严格不可变
    const snapRowAfter = db.prepare(`
      SELECT snapshot_id, content_hash, fragment_count, file_size
      FROM workspace_source_snapshots WHERE snapshot_id = ?
    `).get(approvedSnapId) as typeof snapRowV1
    expect(snapRowAfter.content_hash).toBe(snapRowV1.content_hash)
    expect(snapRowAfter.fragment_count).toBe(snapRowV1.fragment_count)
    expect(snapRowAfter.file_size).toBe(snapRowV1.file_size)

    const fragmentsAfter = db.prepare(`
      SELECT id, heading_path, content, fragment_hash
      FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?
    `).all(approvedSnapId) as typeof fragmentsV1
    expect(fragmentsAfter).toEqual(fragmentsV1)
    expect(fragmentsAfter[0].content).toContain('第一条法则正文')
    expect(fragmentsAfter[0].content).not.toContain('恶意篡改')

    // 5. 运行时查询已批准片段，只返回 V1 正文，绝不泄露未批准的 V2 正文
    const queryFragments = WorkspaceHubRepository.queryFragments({ projectId: 'main' })
    expect(queryFragments.length).toBeGreaterThan(0)
    expect(queryFragments[0].content).toContain('第一条法则正文')
    expect(queryFragments[0].content).not.toContain('恶意篡改')
  })

  it('6. error UUID including "author" cannot operate on "main" candidate', () => {
    const projectRoot = createDir('proj-err-uuid-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candId = 'cand-main-sec-01'
    WorkspaceHubRepository.saveCandidate({
      candidateId: candId,
      projectId: 'main',
      candidateType: 'setting',
      rawData: '法则内容',
      suggestedData: JSON.stringify({ title: '天地律', content: '万物有灵' }),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则',
      sourceLineRange: '1-5',
      evidence: '天地律',
      confidence: 1.0,
      status: 'pending',
    })

    // 1. 尝试以 'author' 作为 projectId 批准 'main' 下的候选：必须失败且明确指示候选不存在，禁止误当回退
    const approveAuthor = WorkspaceHubRepository.approveCandidate(candId, 'author')
    expect(approveAuthor.success).toBe(false)
    expect(approveAuthor.error).toBe('候选项目不存在')

    // 2. 尝试以未知的 random UUID 批准：必须失败
    const approveRandom = WorkspaceHubRepository.approveCandidate(candId, 'proj-random-uuid-9999')
    expect(approveRandom.success).toBe(false)
    expect(approveRandom.error).toBe('候选项目不存在')

    // 3. 尝试以 'author' 或未知 UUID 拒绝：必须失败
    const rejectAuthor = WorkspaceHubRepository.rejectCandidate(candId, 'author')
    expect(rejectAuthor.success).toBe(false)
    expect(rejectAuthor.error).toBe('候选项目不存在')

    const rejectRandom = WorkspaceHubRepository.rejectCandidate(candId, 'proj-random-uuid-9999')
    expect(rejectRandom.success).toBe(false)
    expect(rejectRandom.error).toBe('候选项目不存在')

    // 4. 'main' 候选状态必须依然严格保持 pending
    const mainCandidates = WorkspaceHubRepository.listCandidates({ projectId: 'main' })
    expect(mainCandidates).toHaveLength(1)
    expect(mainCandidates[0].status).toBe('pending')

    // 5. 使用合法的 'main' 才能成功批准
    const approveMain = WorkspaceHubRepository.approveCandidate(candId, 'main')
    expect(approveMain.success).toBe(true)
    expect(WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0].status).toBe('approved')
  })

  it('7. identical candidateId coexists across project A and project B independently without collision', () => {
    const projectRoot = createDir('proj-cand-coexist-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const projectA = 'proj-tenant-alpha-111'
    const projectB = 'proj-tenant-beta-222'
    const sharedCandId = 'cand-identical-shared-id'

    // 1. 项目 A 保存候选
    WorkspaceHubRepository.saveCandidate({
      candidateId: sharedCandId,
      projectId: projectA,
      candidateType: 'setting',
      rawData: '项目A设定原文',
      suggestedData: JSON.stringify({ title: '天道律', content: '顺天者昌' }),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '法则 > 天道',
      sourceLineRange: '1-5',
      evidence: '天道律',
      confidence: 1.0,
      status: 'pending',
    })

    // 2. 项目 B 使用完全相同的 candidateId 保存不同内容的候选
    WorkspaceHubRepository.saveCandidate({
      candidateId: sharedCandId,
      projectId: projectB,
      candidateType: 'setting',
      rawData: '项目B设定原文',
      suggestedData: JSON.stringify({ title: '人道律', content: '人定胜天' }),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '法则 > 人道',
      sourceLineRange: '1-5',
      evidence: '人道律',
      confidence: 1.0,
      status: 'pending',
    })

    // 3. 验证复合主键隔离：两笔候选独立共存
    const listA = WorkspaceHubRepository.listCandidates({ projectId: projectA })
    const listB = WorkspaceHubRepository.listCandidates({ projectId: projectB })
    expect(listA).toHaveLength(1)
    expect(listB).toHaveLength(1)
    expect(listA[0].candidateId).toBe(sharedCandId)
    expect(listB[0].candidateId).toBe(sharedCandId)
    expect(listA[0].rawData).toBe('项目A设定原文')
    expect(listB[0].rawData).toBe('项目B设定原文')

    // 4. 项目 A 批准其候选：项目 A 变为 approved，项目 B 保持 pending
    const approveA = WorkspaceHubRepository.approveCandidate(sharedCandId, projectA)
    expect(approveA.success).toBe(true)
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectA })[0].status).toBe('approved')
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectB })[0].status).toBe('pending')

    // 5. 项目 B 拒绝其候选：项目 B 变为 rejected，项目 A 依然保持 approved
    const rejectB = WorkspaceHubRepository.rejectCandidate(sharedCandId, projectB)
    expect(rejectB.success).toBe(true)
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectA })[0].status).toBe('approved')
    expect(WorkspaceHubRepository.listCandidates({ projectId: projectB })[0].status).toBe('rejected')
  })

  it('8. tampered fragment content with untouched fragment_hash fails source snapshot approval', async () => {
    const projectRoot = createDir('proj-tamper-frag-')
    const externalRoot = createDir('ext-tamper-frag-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const doc = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(doc, '# 恒定法则\n原始可信正文内容。\n', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot, sessionProjectId)
    const scan = await WorkspaceScannerService.scanDirectory(externalRoot, sessionProjectId)
    expect(scan.success).toBe(true)

    const source = WorkspaceHubRepository.listSources(sessionProjectId)[0]
    expect(source.observedSnapshotId).toBeDefined()

    // 恶意篡改 snapshot_fragments 的正文内容，但保持原 fragment_hash 不动
    const originalFrag = db.prepare(`
      SELECT id, content, fragment_hash FROM workspace_source_snapshot_fragments
      WHERE snapshot_id = ?
    `).get(source.observedSnapshotId) as { id: string; content: string; fragment_hash: string }
    expect(originalFrag).toBeDefined()

    db.prepare(`
      UPDATE workspace_source_snapshot_fragments
      SET content = '被恶意篡改的片段正文！'
      WHERE id = ?
    `).run(originalFrag.id)

    // 尝试批准来源：必须在片段 SHA-256 哈希完整性校验处失败关闭并拦截
    const approveResult = WorkspaceHubRepository.approveSource(source.id, sessionProjectId)
    expect(approveResult.success).toBe(false)
    expect(approveResult.error).toMatch(/哈希校验失败|篡改/u)

    // 来源的 approvedSnapshotId 必须保持未被批准状态
    const sourceAfter = WorkspaceHubRepository.listSources(sessionProjectId)[0]
    expect(sourceAfter.approvedSnapshotId).toBeNull()
  })

  it('9. mismatched snapshot/content/project/source relational associations fail approval', async () => {
    const projectRoot = createDir('proj-rel-mismatch-')
    const externalRoot = createDir('ext-rel-mismatch-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const doc = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(doc, '# 核心设定\n一段测试设定正文。\n## 第二条\n第二条设定正文。\n', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot, sessionProjectId)
    const scan = await WorkspaceScannerService.scanDirectory(externalRoot, sessionProjectId)
    expect(scan.success).toBe(true)

    const source = WorkspaceHubRepository.listSources(sessionProjectId)[0]
    const snapId = source.observedSnapshotId!

    // 1. 篡改 content_hash 不一致：触发拒绝
    db.prepare("UPDATE workspace_source_snapshots SET content_hash = 'tampered-fake-hash' WHERE snapshot_id = ?").run(snapId)
    const res1 = WorkspaceHubRepository.approveSource(source.id, sessionProjectId)
    expect(res1.success).toBe(false)
    expect(res1.error).toMatch(/content_hash 与来源观察哈希不一致/u)

    // 恢复 content_hash
    db.prepare("UPDATE workspace_source_snapshots SET content_hash = ? WHERE snapshot_id = ?").run(source.observedFileHash, snapId)

    // 2. 篡改 snapshot project_id 关联不一致：触发拒绝
    db.prepare("UPDATE workspace_source_snapshots SET project_id = 'alien-project' WHERE snapshot_id = ?").run(snapId)
    const res2 = WorkspaceHubRepository.approveSource(source.id, sessionProjectId)
    expect(res2.success).toBe(false)
    expect(res2.error).toMatch(/快照关联不一致/u)

    // 恢复 project_id
    db.prepare("UPDATE workspace_source_snapshots SET project_id = ? WHERE snapshot_id = ?").run(sessionProjectId, snapId)

    // 3. 篡改 snapshot source_id 关联不一致：触发拒绝
    db.prepare(`
      INSERT INTO workspace_sources (id, project_id, absolute_path, relative_path, category, authority_status, content_hash, last_scanned_at)
      VALUES ('alien-source', ?, '', '', 'other', 'material', '', datetime('now'))
    `).run(sessionProjectId)
    db.prepare("UPDATE workspace_source_snapshots SET source_id = 'alien-source' WHERE snapshot_id = ?").run(snapId)
    const res3 = WorkspaceHubRepository.approveSource(source.id, sessionProjectId)
    expect(res3.success).toBe(false)
    expect(res3.error).toMatch(/快照关联不一致/u)

    // 恢复 source_id
    db.prepare("UPDATE workspace_source_snapshots SET source_id = ? WHERE snapshot_id = ?").run(source.id, snapId)

    // 4. 快照片段数与 fragment_count 不一致：删除一个片段行
    const fragments = db.prepare('SELECT id FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').all(snapId) as Array<{ id: string }>
    expect(fragments.length).toBeGreaterThanOrEqual(2)
    db.prepare('DELETE FROM workspace_source_snapshot_fragments WHERE id = ?').run(fragments[0].id)

    const res4 = WorkspaceHubRepository.approveSource(source.id, sessionProjectId)
    expect(res4.success).toBe(false)
    expect(res4.error).toMatch(/快照片段数不一致/u)
  })

  it('10. approved snapshot remains read-only and immutable against subsequent same-snapshotId commits', async () => {
    const projectRoot = createDir('proj-same-id-snap-')
    const externalRoot = createDir('ext-same-id-snap-')
    initProjectDatabase(projectRoot)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Snapshot Test')").run()

    const doc = path.join(externalRoot, '01_已确认设定清单.md')
    fs.writeFileSync(doc, '# 绝对只读法则\n第一条正式正文。\n', 'utf8')

    WorkspaceHubRepository.bindWorkspaceDirectory(externalRoot, sessionProjectId)
    const scan1 = await WorkspaceScannerService.scanDirectory(externalRoot, sessionProjectId)
    expect(scan1.success).toBe(true)

    const source = WorkspaceHubRepository.listSources(sessionProjectId)[0]
    const approveRes = WorkspaceHubRepository.approveSource(source.id, sessionProjectId)
    expect(approveRes.success).toBe(true)

    const approvedSnapId = source.observedSnapshotId!
    const originalFragments = db.prepare('SELECT id, content FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').all(approvedSnapId) as Array<{ id: string; content: string }>

    // 尝试构造相同 snapshot_id 的 StagedScanPayload 再次提交，试图覆写快照和片段正文
    WorkspaceHubRepository.commitScanPayload({
      projectId: sessionProjectId,
      items: [{
        source: {
          id: source.id,
          projectId: sessionProjectId,
          absolutePath: source.absolutePath,
          relativePath: source.relativePath,
          category: source.category,
          authorityStatus: source.authorityStatus,
          contentHash: 'new-different-content-hash',
          observedFileHash: 'new-different-content-hash',
          mtime: Date.now(),
          fileSize: 9999,
          parseStatus: 'parsed',
          parseError: null,
          skipReason: null,
          observedSnapshotId: approvedSnapId,
          approvedSnapshotId: approvedSnapId,
          lastScannedAt: new Date().toISOString(),
          importStatus: 'imported',
          isMissing: false,
          isDisabled: false,
        },
        snapshot: {
          snapshotId: approvedSnapId,
          sourceId: source.id,
          projectId: sessionProjectId,
          contentHash: 'new-different-content-hash',
          fileSize: 9999,
          fragmentCount: 999,
          parserSchemaVersion: 1,
        },
        fragments: [{
          id: originalFragments[0].id,
          snapshotId: approvedSnapId,
          sourceId: source.id,
          projectId: sessionProjectId,
          headingPath: '恶意覆盖',
          content: '尝试覆写已批准快照的片段正文',
          startLine: 1,
          endLine: 10,
          fragmentHash: 'fake-hash',
          chapterStart: null,
          chapterEnd: null,
          purpose: 'tamper',
          status: 'active',
        }],
        rules: [],
        candidates: [],
      }],
      activeSourceIds: [source.id],
      scanTime: new Date().toISOString(),
    })

    // 验证：已批准快照记录未被覆盖，片段正文严格保持原样
    const fragmentsAfter = db.prepare('SELECT id, content FROM workspace_source_snapshot_fragments WHERE snapshot_id = ?').all(approvedSnapId) as Array<{ id: string; content: string }>
    expect(fragmentsAfter).toEqual(originalFragments)
    expect(fragmentsAfter[0].content).toBe(originalFragments[0].content)
    expect(fragmentsAfter[0].content).not.toContain('恶意覆盖')

    const snapRow = db.prepare('SELECT fragment_count FROM workspace_source_snapshots WHERE snapshot_id = ?').get(approvedSnapId) as { fragment_count: number }
    expect(snapRow.fragment_count).toBe(originalFragments.length)
    expect(snapRow.fragment_count).not.toBe(999)
  })
})
