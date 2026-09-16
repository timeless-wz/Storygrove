import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  initProjectDatabase,
  closeProjectDatabase,
  getProjectDb,
} from '../database'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import {
  WorkspaceScannerService,
  SCAN_LIMITS,
  validateWorkspacePath,
  isPathContained,
} from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'
import { CharacterRosterRepository } from '../repositories/character-roster-repository'
import { ExternalFileGrantService } from '../services/external-file-grant-service'

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  closeProjectDatabase()
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('Workspace Hub Security & Boundary Defenses', () => {
  it('1. 安全校验真实调用链：拒绝磁盘根目录、敏感系统目录、项目根目录及内部.vela', () => {
    const projDir = createTempDir('sec-proj-')
    const velaDir = path.join(projDir, '.vela')
    fs.mkdirSync(velaDir, { recursive: true })

    // 拒绝磁盘根目录
    expect(validateWorkspacePath('C:\\', projDir).valid).toBe(false)
    expect(validateWorkspacePath('D:\\', projDir).valid).toBe(false)

    // 拒绝 Windows 敏感系统核心目录
    expect(validateWorkspacePath('C:\\Windows', projDir).valid).toBe(false)
    expect(validateWorkspacePath('C:\\Windows\\System32', projDir).valid).toBe(false)
    expect(validateWorkspacePath('C:\\Program Files', projDir).valid).toBe(false)

    // 拒绝当前项目根目录以及内部 .vela 目录
    expect(validateWorkspacePath(projDir, projDir).valid).toBe(false)
    expect(validateWorkspacePath(velaDir, projDir).valid).toBe(false)
    expect(validateWorkspacePath(path.join(projDir, '.vela', 'subdir'), projDir).valid).toBe(false)

    // 接受合法外部目录
    const validExt = createTempDir('sec-valid-ext-')
    const res = validateWorkspacePath(validExt, projDir)
    expect(res.valid).toBe(true)
    expect(res.canonicalPath).toBeDefined()
  })

  it('2. 伪造授权与过期授权被拒绝：ExternalFileGrantService 防护', () => {
    let fakeTime = 1000000
    const grants = new ExternalFileGrantService({ now: () => fakeTime })
    const extDir = createTempDir('sec-grant-dir-')

    const issued = grants.issueDirectory({
      webContentsId: 42,
      directoryPath: extDir,
      operations: ['list', 'read'],
      ttlMs: 5000,
      maxUses: 2,
    })

    // 伪造 grantId 必须被拒绝
    expect(() => {
      grants.resolve({
        grantId: 'forged-grant-id',
        webContentsId: 42,
        operation: 'list',
      })
    }).toThrow('外部文件授权不存在或已失效')

    // 错误窗口使用必须被拒绝
    expect(() => {
      grants.resolve({
        grantId: issued.grantId,
        webContentsId: 999, // wrong window
        operation: 'list',
      })
    }).toThrow('外部文件授权不属于当前窗口')

    // 未授予操作被拒绝
    expect(() => {
      grants.resolve({
        grantId: issued.grantId,
        webContentsId: 42,
        operation: 'write', // not granted
      })
    }).toThrow('未授予 write 操作')

    // 路径穿越被拒绝
    expect(() => {
      grants.resolve({
        grantId: issued.grantId,
        webContentsId: 42,
        operation: 'list',
        relativePath: '../escape',
      })
    }).toThrow('父目录遍历')

    // 正常解析消耗 1 次
    const resolved = grants.resolve({
      grantId: issued.grantId,
      webContentsId: 42,
      operation: 'list',
    })
    expect(resolved.rootPath).toBeDefined()

    // 过期后被拒绝
    fakeTime += 6000
    expect(() => {
      grants.resolve({
        grantId: issued.grantId,
        webContentsId: 42,
        operation: 'list',
      })
    }).toThrow('外部文件授权已过期')
  })

  it('3. 符号链接逃逸与目录联接检查', () => {
    const externalRoot = createTempDir('sec-contain-root-')
    const insideDir = path.join(externalRoot, 'inside')
    fs.mkdirSync(insideDir)
    const outsideDir = createTempDir('sec-outside-')

    expect(isPathContained(insideDir, externalRoot)).toBe(true)
    expect(isPathContained(path.join(insideDir, 'file.md'), externalRoot)).toBe(true)
    expect(isPathContained(outsideDir, externalRoot)).toBe(false)
    expect(isPathContained(path.join(externalRoot, '..'), externalRoot)).toBe(false)
  })

  it('4. 扫描取消与任务ID中止支持', async () => {
    const projDir = createTempDir('sec-proj-cancel-')
    const extDir = createTempDir('sec-ext-cancel-')
    initProjectDatabase(projDir)

    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(extDir, `doc_${i}.md`), `# Doc ${i}\nContent ${i}`)
    }

    const controller = new AbortController()
    controller.abort() // pre-aborted

    const result = await WorkspaceScannerService.scanDirectory(extDir, 'main', {
      signal: controller.signal,
      taskId: 'task-test-cancel',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('取消')

    // 任务注册与取消
    const liveController = new AbortController()
    WorkspaceScannerService.registerScanTask('task-live-1', 'main', liveController)
    expect(WorkspaceScannerService.cancelScanTask('task-live-1')).toBe(true)
    expect(liveController.signal.aborted).toBe(true)
  })

  it('5. 扫描失败完整回滚：事务失败时不破坏既有健康快照', async () => {
    const projDir = createTempDir('sec-proj-rollback-')
    const extDir = createTempDir('sec-ext-rollback-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    fs.writeFileSync(path.join(extDir, '00_创作方向.md'), '# 核心总则\n必须坚持硬核')
    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    WorkspaceHubRepository.approveAllSources('main')

    const sourcesBefore = WorkspaceHubRepository.listSources('main')
    expect(sourcesBefore.length).toBe(1)
    expect(sourcesBefore[0].approvedSnapshotId).toBeDefined()

    // 模拟构造非法 payload 触发 SQL 异常回滚
    expect(() => {
      WorkspaceHubRepository.commitScanPayload({
        projectId: 'main',
        items: [
          {
            source: {
              ...sourcesBefore[0],
              // @ts-expect-error test illegal constraint
              id: null,
            },
          },
        ],
        activeSourceIds: [],
        scanTime: new Date().toISOString(),
      })
    }).toThrow()

    // 回滚后健康来源数据完全保留
    const sourcesAfter = WorkspaceHubRepository.listSources('main')
    expect(sourcesAfter.length).toBe(1)
    expect(sourcesAfter[0].approvedSnapshotId).toBe(sourcesBefore[0].approvedSnapshotId)
  })

  it('6. 单文件失败保留旧快照：局部文件损坏不覆盖既有有效快照与片段', async () => {
    const projDir = createTempDir('sec-proj-err-')
    const extDir = createTempDir('sec-ext-err-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    const goodFile = path.join(extDir, '00_创作方向.md')
    const brokenFile = path.join(extDir, '01_已确认设定清单.md')
    fs.writeFileSync(goodFile, '# 创作方向\n正常文件内容')
    fs.writeFileSync(brokenFile, '# 设定清单\n第1版正常内容')

    // 首次扫描并批准
    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    WorkspaceHubRepository.approveAllSources('main')

    const beforeDetail = WorkspaceHubRepository.getSourceDetail(
      WorkspaceHubRepository.listSources('main').find(s => s.relativePath.includes('01_已确认设定清单.md'))!.id,
      'main',
    )
    expect(beforeDetail.fragments.length).toBeGreaterThan(0)
    const approvedSnapId = beforeDetail.source!.approvedSnapshotId

    // 记录解析异常并更新
    WorkspaceHubRepository.recordFileParseError(
      beforeDetail.source!.id,
      beforeDetail.source!.relativePath,
      'SyntaxError: Failed to parse corrupted markdown',
      'main',
    )

    const afterDetail = WorkspaceHubRepository.getSourceDetail(beforeDetail.source!.id, 'main')
    expect(afterDetail.source!.parseError).toContain('SyntaxError')
    // 旧片段与批准版本完整保留
    expect(afterDetail.source!.approvedSnapshotId).toBe(approvedSnapId)
    expect(afterDetail.fragments.length).toBe(beforeDetail.fragments.length)
  })

  it('7. approved/rejected 候选状态重扫保持不变；内容变化生成新候选版本', async () => {
    const projDir = createTempDir('proj-cand-ver-')
    const extDir = createTempDir('ext-cand-ver-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    const charFile = path.join(extDir, '05_人物与关系.md')
    fs.writeFileSync(charFile, '# 角色档案\n## 顾沉\n性别：男\n年龄：32\n定位：主角\n身份：物理学家')

    // 首次扫描生成 candidate
    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    let candidates = WorkspaceHubRepository.listCandidates({ projectId: 'main', candidateType: 'character' })
    expect(candidates.length).toBe(1)
    const originalCandId = candidates[0].candidateId

    // 作者批准该候选
    WorkspaceHubRepository.approveCandidate(originalCandId)
    expect(WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0].status).toBe('approved')

    // 再次扫描（内容未变）：status 必须依然是 approved，不得重置为 pending
    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    candidates = WorkspaceHubRepository.listCandidates({ projectId: 'main', candidateType: 'character' })
    expect(candidates.find(c => c.candidateId === originalCandId)!.status).toBe('approved')

    // 内容发生变化：必须生成新的 pending candidate 版本，旧的 approved candidate 保持保留
    fs.writeFileSync(charFile, '# 角色档案\n## 顾沉\n性别：男\n年龄：33\n定位：主角\n身份：工程领航员（更新）')
    await WorkspaceScannerService.scanDirectory(extDir, 'main')

    const allCandidates = WorkspaceHubRepository.listCandidates({ projectId: 'main', candidateType: 'character' })
    expect(allCandidates.length).toBe(2)

    const oldCandidate = allCandidates.find(c => c.candidateId === originalCandId)
    expect(oldCandidate!.status).toBe('approved')

    const newCandidate = allCandidates.find(c => c.candidateId !== originalCandId)
    expect(newCandidate).toBeDefined()
    expect(newCandidate!.status).toBe('pending')
    expect(newCandidate!.suggestedData).toContain('工程领航员')
  })

  it('8. stale 新版本内容绝不进入上下文，继续使用 approved 快照', async () => {
    const projDir = createTempDir('proj-stale-ctx-')
    const extDir = createTempDir('ext-stale-ctx-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    const ruleFile = path.join(extDir, '00_创作方向.md')
    fs.writeFileSync(ruleFile, '# 核心创作总则\n【第一版定案】灵肉不可互换')

    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    // 首次批准
    WorkspaceHubRepository.approveAllSources('main')

    let bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).toContain('【第一版定案】灵肉不可互换')

    // 外部修改该文件为未批准的新内容
    fs.writeFileSync(ruleFile, '# 核心创作总则\n【未批准的新版本草稿】灵肉可以互换')
    await WorkspaceScannerService.scanDirectory(extDir, 'main')

    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources[0].importStatus).toBe('stale')

    // 装配上下文：绝不读取新版本草稿，依然读取第一版定案，并给出包含 approved 快照 ID 的 stale 警告
    bundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(bundle.fullAssembledText).toContain('【第一版定案】灵肉不可互换')
    expect(bundle.fullAssembledText).not.toContain('【未批准的新版本草稿】')
    expect(bundle.staleWarnings.length).toBeGreaterThan(0)
    expect(bundle.staleWarnings[0]).toContain(sources[0].approvedSnapshotId!)
  })

  it('9. 候选内容默认绝不进入正文上下文（includeCandidates 默认为 false）', async () => {
    const projDir = createTempDir('proj-cand-ctx-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    // 存入一条候选规则
    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-cand-1',
      projectId: 'main',
      title: '候选灵压上限猜想',
      content: '灵压极限可能达到九万帕',
      status: 'candidate',
      constraintType: 'soft',
      scope: 'global',
      sourceFile: '01_设定.md',
      sourceHeadingPath: '猜想',
      sourceLineRange: '1-5',
    })

    // 默认不传 includeCandidates，不得进入上下文
    const defaultBundle = ChapterContextAssembler.assemble({ chapterNumber: 1 })
    expect(defaultBundle.fullAssembledText).not.toContain('候选灵压上限猜想')
    expect(defaultBundle.candidateWarnings.length).toBe(0)

    // 明确传 false，也不得进入
    const falseBundle = ChapterContextAssembler.assemble({ chapterNumber: 1, includeCandidates: false })
    expect(falseBundle.fullAssembledText).not.toContain('候选灵压上限猜想')

    // 仅当明确传 true 时，才作为候选预览进入并带有警告
    const trueBundle = ChapterContextAssembler.assemble({ chapterNumber: 1, includeCandidates: true })
    expect(trueBundle.fullAssembledText).toContain('候选灵压上限猜想')
    expect(trueBundle.candidateWarnings.length).toBeGreaterThan(0)
  })

  it('10. 角色 commit 成功但回执仍为 prepared 时，以冻结负载幂等恢复并保留中间编辑', () => {
    const projDir = createTempDir('proj-crash-rec-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    const candidateId = 'cand-char-crash-test'
    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '姓名：易青\n身份：学者',
      suggestedData: JSON.stringify({
        name: '易青',
        role: 'supporting',
        gender: '男',
        age: '29',
        appearance: '',
        personality: '冷静敏锐',
        background: '地质学博士',
        abilities: '岩层遥感',
        motivation: '解开深井之谜',
        relationships: [],
        arc: '',
        notes: '第一轮关键人物',
      }),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '角色 > 易青',
      sourceLineRange: '1-10',
      evidence: '学者',
      confidence: 1.0,
      status: 'pending',
    })

    // 模拟最危险窗口：角色库 commit 已成功，workspace 回执尚未来得及推进。
    const crashHook = (stage: 'prepared' | 'roster_committed' | 'after_roster_commit_before_receipt') => {
      if (stage === 'after_roster_commit_before_receipt') {
        throw new Error('SIMULATED_CRASH_BEFORE_WORKSPACE_RECEIPT_UPDATE')
      }
    }

    // 第一次执行，触发崩溃
    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'author', crashHook)
    expect(firstTry.success).toBe(false)
    expect(firstTry.error).toContain('SIMULATED_CRASH')

    // 此时角色名单已写入，但候选与 workspace 回执都仍停留在提交前状态。
    const rosterAfterCrash = CharacterRosterRepository.read()
    expect(rosterAfterCrash.entries.length).toBe(1)
    expect(rosterAfterCrash.entries[0].name).toBe('易青')

    const candidateAfterCrash = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candidateAfterCrash.status).toBe('pending')

    const preparedReceipt = db.prepare(`
      SELECT operation_id, payload_hash, frozen_payload, stage
      FROM workspace_approval_receipts WHERE candidate_id = ?
    `).get(candidateId) as {
      operation_id: string
      payload_hash: string
      frozen_payload: string
      stage: string
    }
    expect(preparedReceipt.stage).toBe('prepared')
    expect(preparedReceipt.operation_id).toMatch(/^workspace-approve-cand-char-crash-test-[a-f0-9]{8}$/u)
    expect(preparedReceipt.payload_hash).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.parse(preparedReceipt.frozen_payload).operationId).toBe(preparedReceipt.operation_id)

    // 崩溃后发生另一笔合法作者编辑；恢复不得重新计算合并请求或卡在旧 revision。
    const intervening = CharacterRosterRepository.read()
    CharacterRosterRepository.commit({
      operationId: 'manual-edit-between-workspace-retries',
      expectedRevision: intervening.revision,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [
        ...intervening.entries,
        { ...intervening.entries[0], name: '旁观者', notes: '崩溃后的独立作者编辑' },
      ],
    })

    // 重试审批：崩溃恢复机制必须检测到已提交，跳过角色名单重复追加，直接推进到 completed
    const secondTry = WorkspaceHubRepository.approveCandidate(candidateId, 'author')
    expect(secondTry.success).toBe(true)

    // 验证角色名单没有被重复插入或追加重复 notes
    const rosterAfterRecovery = CharacterRosterRepository.read()
    expect(rosterAfterRecovery.entries.length).toBe(2)
    expect(rosterAfterRecovery.entries.filter(entry => entry.name === '易青')).toHaveLength(1)
    expect(rosterAfterRecovery.entries.find(entry => entry.name === '易青')!.notes).toBe('第一轮关键人物')
    expect(rosterAfterRecovery.entries.find(entry => entry.name === '旁观者')!.notes).toBe('崩溃后的独立作者编辑')

    // 候选最终成功 approved
    const candidateRecovered = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candidateRecovered.status).toBe('approved')
  })

  it('11. 超过 16MB 的稀疏参考小说被发现但不读取全文、不生成片段', async () => {
    const projDir = createTempDir('proj-large-file-')
    const extDir = createTempDir('ext-large-file-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    // 创建素材目录下的参考小说文件
    const matDir = path.join(extDir, '素材')
    fs.mkdirSync(matDir, { recursive: true })
    const largeNovel = path.join(matDir, '参考样章_长篇.txt')
    const handle = fs.openSync(largeNovel, 'w')
    fs.ftruncateSync(handle, SCAN_LIMITS.MAX_FILE_SIZE_BYTES + 4096)
    fs.closeSync(handle)
    const readFileSpy = vi.spyOn(fs.promises, 'readFile')

    await WorkspaceScannerService.scanDirectory(extDir, 'main')
    const sources = WorkspaceHubRepository.listSources('main')
    expect(sources.length).toBe(1)
    expect(sources[0].category).toBe('reference_novel')
    expect(sources[0].parseStatus).toBe('metadata_only')
    expect(sources[0].skipReason).toBe('reference_novel_metadata_only')

    // 详情中片段数必须为 0，全文不被切分为碎片
    const detail = WorkspaceHubRepository.getSourceDetail(sources[0].id, 'main')
    expect(detail.fragments.length).toBe(0)
    expect(detail.source!.fileSize).toBe(SCAN_LIMITS.MAX_FILE_SIZE_BYTES + 4096)
    expect(readFileSpy.mock.calls.some(call => path.resolve(String(call[0])) === path.resolve(largeNovel))).toBe(false)
  })

  it('12. 超预算上下文明确计算超额字符并阻止普通快照保存', () => {
    const projDir = createTempDir('proj-budget-limit-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()

    WorkspaceHubRepository.upsertRule({
      ruleId: 'rule-big-1',
      projectId: 'main',
      title: '超长规则',
      content: 'X'.repeat(500),
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: 'rules.md',
      sourceHeadingPath: '规则',
      sourceLineRange: '1-10',
    })

    const bundle = ChapterContextAssembler.assemble({
      chapterNumber: 1,
      budgetChars: 100, // 超出限制
    })

    expect(bundle.isOverBudget).toBe(true)
    expect(bundle.exceededChars).toBeGreaterThan(0)
  })

  it('13. UI文案清理验证：源码不再包含旧蓝图材料文案与方法', () => {
    const tabCode = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/workspace/WorkspaceChapterContextTab.tsx'),
      'utf8',
    )
    expect(tabCode).not.toContain('saveAsChapterMaterial')
    expect(tabCode).not.toContain('蓝图工作流预设材料')
    expect(tabCode).toContain('确定保存第${bundle.chapterNumber}章的只读上下文快照吗？该操作不会修改章节蓝图，也不会自动触发正文生成。')
    expect(tabCode).toContain('上下文快照已保存。')
  })
})
