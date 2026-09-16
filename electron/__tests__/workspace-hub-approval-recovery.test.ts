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
import { CharacterRosterRepository } from '../repositories/character-roster-repository'

describe('Workspace Hub - Candidate Approval Crash Recovery & Idempotency', () => {
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

  it('1. recovers character candidate approval when crash occurs after roster commit but before receipt completion', () => {
    const projDir = createDir('proj-char-recovery-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-char-crash-001'
    const characterData = {
      name: '白沐',
      role: 'protagonist',
      gender: '男',
      age: '24',
      appearance: '长衫黑发',
      background: '执灯人',
      personality: '谨慎冷峻',
      abilities: '时空折叠',
      motivation: '寻找真相',
      arc: '逐步觉醒',
      notes: '首次登场第一章',
      relationships: [],
    }

    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '角色原始卡片',
      suggestedData: JSON.stringify(characterData),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '角色档案 > 白沐',
      sourceLineRange: '1-10',
      evidence: '检测到角色卡：白沐',
      confidence: 0.95,
      status: 'pending',
    })

    // 模拟在角色库写入完成、但回执更新前崩溃
    const crashHook = (stage: string) => {
      if (stage === 'after_roster_commit_before_receipt') {
        throw new Error('SIMULATED_CRASH_AFTER_ROSTER_COMMIT')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)
    expect(firstTry.error).toBe('SIMULATED_CRASH_AFTER_ROSTER_COMMIT')

    // 验证崩溃发生时：角色库已写入，但回执仍为 prepared
    const rosterMid = CharacterRosterRepository.read()
    expect(rosterMid.entries.length).toBe(1)
    expect(rosterMid.entries[0].name).toBe('白沐')

    const receiptMid = db.prepare('SELECT stage FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { stage: string }
    expect(receiptMid.stage).toBe('prepared')

    // 崩溃期间作者进行了另一次独立的名单编辑
    CharacterRosterRepository.commit({
      operationId: 'manual-intervening-edit',
      expectedRevision: rosterMid.revision,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [
        ...rosterMid.entries,
        { ...rosterMid.entries[0], name: '独立角色', notes: '崩溃期间手工新增' },
      ],
    })

    // 重试审批：恢复逻辑必须检测已提交，跳过重复写入，闭合为 completed
    const retryResult = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryResult.success).toBe(true)

    // 验证名单 entries 没有被重复追加，独立编辑得到完整保留
    const rosterFinal = CharacterRosterRepository.read()
    expect(rosterFinal.entries.length).toBe(2)
    expect(rosterFinal.entries.filter(e => e.name === '白沐').length).toBe(1)
    expect(rosterFinal.entries.find(e => e.name === '独立角色')).toBeDefined()

    // 候选和回执状态正确闭合
    const candidateAfter = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candidateAfter.status).toBe('approved')

    const receiptFinal = db.prepare('SELECT stage FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { stage: string }
    expect(receiptFinal.stage).toBe('completed')
  })

  it('2. recovers setting rule candidate approval idempotently upon retry', () => {
    const projDir = createDir('proj-setting-recovery-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!

    const candidateId = 'cand-setting-crash-002'
    const settingData = {
      title: '深海三大律',
      content: '一、不可直视深渊。二、不可呼唤不可名状之名。',
      constraintType: 'hard',
      scope: 'global',
    }

    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'setting',
      rawData: '深海三大律原文',
      suggestedData: JSON.stringify(settingData),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 深海三大律',
      sourceLineRange: '5-12',
      evidence: '检测到设定规则：深海三大律',
      confidence: 0.9,
      status: 'pending',
    })

    // 模拟在候选 approved 与设定规则写入后、回执 completed 前崩溃
    const crashHook = (stage: string) => {
      if (stage === 'after_candidate_approved_before_receipt') {
        throw new Error('SIMULATED_CRASH_BEFORE_SETTING_RECEIPT')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)
    expect(firstTry.error).toBe('SIMULATED_CRASH_BEFORE_SETTING_RECEIPT')

    // 重试审批：恢复机制必须幂等闭合，规则不重复
    const retryResult = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryResult.success).toBe(true)

    // 验证设定规则表中仅有一条确定性规则
    const rules = WorkspaceHubRepository.listRules('main')
    expect(rules.length).toBe(1)
    expect(rules[0].title).toBe('深海三大律')
    expect(rules[0].status).toBe('confirmed')

    // 验证候选与回执一致闭合为 approved 与 completed
    const candAfter = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candAfter.status).toBe('approved')

    const receipt = db.prepare('SELECT stage FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { stage: string }
    expect(receipt.stage).toBe('completed')
  })

  it('3. rejects candidate at roster_committed is refused to protect domain consistency; retry recovers safely', () => {
    const projDir = createDir('proj-compensate-reject-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-char-compensate-003'
    const characterData = {
      name: '陈玄',
      role: 'supporting',
      gender: '男',
      age: '30',
      appearance: '黑袍佩剑',
      background: '无极阁',
      personality: '深沉隐忍',
      abilities: '剑意凝形',
      motivation: '宗门复兴',
      arc: '牺牲守护',
      notes: '首次登场第三章',
      relationships: [],
    }

    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '角色原始卡片：陈玄',
      suggestedData: JSON.stringify(characterData),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '角色档案 > 陈玄',
      sourceLineRange: '15-25',
      evidence: '检测到角色卡：陈玄',
      confidence: 0.95,
      status: 'pending',
    })

    // 模拟在 roster_committed 阶段崩溃
    const crashHook = (stage: string) => {
      if (stage === 'roster_committed') {
        throw new Error('SIMULATED_CRASH_AT_ROSTER_COMMITTED')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)
    expect(firstTry.error).toBe('SIMULATED_CRASH_AT_ROSTER_COMMITTED')

    // 验证崩溃发生时：角色已写入角色库，回执已处于 roster_committed，但候选仍为 pending
    const rosterMid = CharacterRosterRepository.read()
    expect(rosterMid.entries.some(e => e.name === '陈玄')).toBe(true)

    const receiptMid = db.prepare('SELECT stage FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { stage: string }
    expect(receiptMid.stage).toBe('roster_committed')

    const candidateMid = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candidateMid.status).toBe('pending')

    // 此时作者尝试拒绝处于 roster_committed 的候选：状态机防护必须拒绝直接驳回，防止产生脏状态或误删角色
    const rejectResult = WorkspaceHubRepository.rejectCandidate(candidateId, 'main')
    expect(rejectResult.success).toBe(false)
    expect(rejectResult.error).toContain('roster_committed')

    // 状态未被破坏：候选依然为 pending，角色依然保留在花名册中
    expect(WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0].status).toBe('pending')
    expect(CharacterRosterRepository.read().entries.some(e => e.name === '陈玄')).toBe(true)

    // 重试审批恢复闭合：必须顺利恢复并闭合为 completed
    const retryRes = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryRes.success).toBe(true)
    expect(WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0].status).toBe('approved')
    expect(CharacterRosterRepository.read().entries.some(e => e.name === '陈玄')).toBe(true)
  })

  it('4. pre-existing formal character prevents fake success, and rejection does not delete author character', () => {
    const projDir = createDir('proj-author-char-protect-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    // 作者已预先创建正式角色
    CharacterRosterRepository.commit({
      operationId: 'author-original-character',
      expectedRevision: 0,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [{
        name: '沈星河',
        role: 'protagonist',
        gender: '男',
        age: '28',
        appearance: '白衣胜雪',
        background: '星河剑派首徒',
        personality: '孤高决绝',
        abilities: '九天星辰剑',
        motivation: '斩破宿命',
        arc: '求道之路',
        notes: '作者亲手创建的核心角色',
        relationships: [],
      }],
    })

    expect(CharacterRosterRepository.read().entries).toHaveLength(1)

    // 此时扫描提取出同名候选
    const candidateId = 'cand-char-duplicate-name'
    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '外部角色卡片：沈星河',
      suggestedData: JSON.stringify({
        name: '沈星河',
        role: 'supporting',
        notes: '外部扫描提取内容',
      }),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '人物 > 沈星河',
      sourceLineRange: '1-10',
      evidence: '扫描角色：沈星河',
      confidence: 0.9,
      status: 'pending',
    })

    // 拒绝未进入 roster_committed 的候选：严禁删除作者原有的同名角色！
    const rejectRes = WorkspaceHubRepository.rejectCandidate(candidateId, 'main')
    expect(rejectRes.success).toBe(true)
    expect(WorkspaceHubRepository.listCandidates({ projectId: 'main', status: 'rejected' })).toHaveLength(1)

    // 核心验证：作者角色完好无损！
    const rosterAfterReject = CharacterRosterRepository.read()
    expect(rosterAfterReject.entries).toHaveLength(1)
    expect(rosterAfterReject.entries[0].name).toBe('沈星河')
    expect(rosterAfterReject.entries[0].notes).toBe('作者亲手创建的核心角色')
  })

  it('5. character approval crash at prepared stage fails closed if author edits roster, preventing overwrite of author edits', () => {
    const projDir = createDir('proj-roster-revision-conflict-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-char-rev-conflict'
    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '候选角色：叶无涯',
      suggestedData: JSON.stringify({
        name: '叶无涯',
        role: 'supporting',
        gender: '男',
        age: '30',
        appearance: '青衣佩剑',
        background: '无量山散修',
        personality: '清冷执着',
        abilities: '无相真气',
        motivation: '探求大道',
        arc: '隐居避世',
        notes: '第一版角色卡',
        relationships: [],
      }),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '人物 > 叶无涯',
      sourceLineRange: '10-20',
      evidence: '叶无涯',
      confidence: 0.95,
      status: 'pending',
    })

    // 模拟在 prepared 阶段崩溃（回执已生成，尚未提交到角色库）
    const crashHook = (stage: string) => {
      if (stage === 'prepared') {
        throw new Error('SIMULATED_CRASH_AT_PREPARED')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)
    expect(firstTry.error).toBe('SIMULATED_CRASH_AT_PREPARED')

    // 崩溃发生后，作者进行了新的角色编辑，使 revision 发生改变
    const rosterBeforeEdit = CharacterRosterRepository.read()
    CharacterRosterRepository.commit({
      operationId: 'author-intervening-new-character',
      expectedRevision: rosterBeforeEdit.revision,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [
        ...rosterBeforeEdit.entries,
        {
          name: '作者新角色',
          role: 'protagonist',
          gender: '女',
          age: '18',
          appearance: '素衣',
          background: '隐世家族',
          personality: '聪颖',
          abilities: '机关术',
          motivation: '探索世界',
          arc: '成长',
          notes: '崩溃后作者的新增角色',
          relationships: [],
        },
      ],
    })

    // 重试审批恢复：因为 operationId 未曾提交且 revision 已改变，必须失败关闭，严禁强行覆写作者编辑！
    const retryRes = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryRes.success).toBe(false)
    expect(retryRes.error).toMatch(/revision|已过期|已拒绝覆盖/u)

    // 验证作者的新增角色依然完好保留
    const rosterAfterRetry = CharacterRosterRepository.read()
    expect(rosterAfterRetry.entries.some(e => e.name === '作者新角色')).toBe(true)
  })

  it('6. setting candidate crash at prepared fails closed if author edits rule with same ID, preventing overwrite', () => {
    const projDir = createDir('proj-setting-conflict-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-setting-conflict-001'
    const settingData = {
      title: '禁空令',
      content: '凡人百里内禁止御剑腾空。',
      constraintType: 'hard',
      scope: 'global',
    }

    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'setting',
      rawData: '禁空令原文',
      suggestedData: JSON.stringify(settingData),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 禁空令',
      sourceLineRange: '1-5',
      evidence: '禁空令',
      confidence: 1.0,
      status: 'pending',
    })

    // 模拟在 prepared 阶段崩溃
    const crashHook = (stage: string) => {
      if (stage === 'prepared') {
        throw new Error('SIMULATED_CRASH_AT_SETTING_PREPARED')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)
    expect(firstTry.error).toBe('SIMULATED_CRASH_AT_SETTING_PREPARED')

    // 崩溃后作者手动修改了同 ID 规则的内容
    const receiptRow = db.prepare('SELECT frozen_payload FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { frozen_payload: string }
    expect(receiptRow).toBeDefined()
    const frozenObj = JSON.parse(receiptRow.frozen_payload) as { targetRule: { ruleId: string } }
    const targetRuleId = frozenObj.targetRule.ruleId

    // 作者在数据库中手动新增或修改了同名规则
    WorkspaceHubRepository.upsertRule({
      ruleId: targetRuleId,
      projectId: 'main',
      title: '作者修改的禁空令',
      content: '作者重写内容：元婴以上不受禁空限制。',
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 禁空令',
      sourceLineRange: '1-5',
    })

    // 重试审批恢复：检测到当前规则内容已被作者修改，必须失败关闭，拒绝覆盖！
    const retryRes = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryRes.success).toBe(false)
    expect(retryRes.error).toContain('设定规则已被作者修改')

    // 验证作者的规则内容未被覆盖
    const currentRule = WorkspaceHubRepository.listRules('main')[0]
    expect(currentRule.content).toBe('作者重写内容：元婴以上不受禁空限制。')
  })

  it('7. tampered frozen_payload or payload_hash prevents closing receipt', () => {
    const projDir = createDir('proj-tamper-test-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-tamper-001'
    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'setting',
      rawData: '法则原文',
      suggestedData: JSON.stringify({ title: '铁律', content: '绝对服从' }),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '法则 > 铁律',
      sourceLineRange: '1-5',
      evidence: '铁律',
      confidence: 1.0,
      status: 'pending',
    })

    // 崩溃在 prepared
    const crashHook = (stage: string) => {
      if (stage === 'prepared') throw new Error('CRASH_PREPARED')
    }
    WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)

    // 1. 篡改 frozen_payload
    db.prepare("UPDATE workspace_approval_receipts SET frozen_payload = '{\"tampered\":true}' WHERE candidate_id = ?").run(candidateId)
    const retry1 = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retry1.success).toBe(false)
    expect(retry1.error).toMatch(/哈希被篡改|完整性校验失败/u)

    // 2. 篡改 payload_hash
    db.prepare("UPDATE workspace_approval_receipts SET payload_hash = 'tampered-hash' WHERE candidate_id = ?").run(candidateId)
    const retry2 = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retry2.success).toBe(false)
    expect(retry2.error).toMatch(/哈希被篡改|完整性校验失败/u)
  })

  it('8. setting modification of ANY field (title, status, scope, constraintType) causes recovery failure and preserves author edits', () => {
    const projDir = createDir('proj-setting-field-change-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-setting-field-check-001'
    const settingData = {
      title: '玄元禁制',
      content: '禁制领域内法力递减。',
      constraintType: 'hard',
      scope: 'global',
    }

    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'setting',
      rawData: '玄元禁制原文',
      suggestedData: JSON.stringify(settingData),
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 玄元禁制',
      sourceLineRange: '1-5',
      evidence: '玄元禁制',
      confidence: 1.0,
      status: 'pending',
    })

    // 正常审批创建回执和规则
    const firstApproval = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(firstApproval.success).toBe(true)

    // 获取确定性 ruleId
    const receiptRow = db.prepare('SELECT frozen_payload FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { frozen_payload: string }
    const frozenObj = JSON.parse(receiptRow.frozen_payload) as { targetRule: { ruleId: string } }
    const targetRuleId = frozenObj.targetRule.ruleId

    // 回退状态以便重试恢复路径
    db.prepare("UPDATE workspace_import_candidates SET status = 'pending' WHERE candidate_id = ? AND project_id = ?").run(candidateId, 'main')
    db.prepare("UPDATE workspace_approval_receipts SET stage = 'prepared' WHERE candidate_id = ? AND project_id = ?").run(candidateId, 'main')

    // 场景 A: 作者只修改 title（content 不变）
    WorkspaceHubRepository.upsertRule({
      ruleId: targetRuleId,
      projectId: 'main',
      title: '作者改了标题的玄元禁制',
      content: '禁制领域内法力递减。',
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 玄元禁制',
      sourceLineRange: '1-5',
    })

    const retryA = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryA.success).toBe(false)
    expect(retryA.error).toContain('设定规则已被作者修改')

    // 验证作者的标题修改保留
    const ruleAfterA = WorkspaceHubRepository.listRules('main').find(r => r.ruleId === targetRuleId)
    expect(ruleAfterA?.title).toBe('作者改了标题的玄元禁制')

    // 场景 B: 恢复 title，改 constraintType
    WorkspaceHubRepository.upsertRule({
      ruleId: targetRuleId,
      projectId: 'main',
      title: '玄元禁制',
      content: '禁制领域内法力递减。',
      status: 'confirmed',
      constraintType: 'soft',
      scope: 'global',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 玄元禁制',
      sourceLineRange: '1-5',
    })

    const retryB = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryB.success).toBe(false)
    expect(retryB.error).toContain('设定规则已被作者修改')

    // 场景 C: 恢复 constraintType，改 scope
    WorkspaceHubRepository.upsertRule({
      ruleId: targetRuleId,
      projectId: 'main',
      title: '玄元禁制',
      content: '禁制领域内法力递减。',
      status: 'confirmed',
      constraintType: 'hard',
      scope: 'chapter-5',
      sourceFile: '01_已确认设定清单.md',
      sourceHeadingPath: '核心法则 > 玄元禁制',
      sourceLineRange: '1-5',
    })

    const retryC = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryC.success).toBe(false)
    expect(retryC.error).toContain('设定规则已被作者修改')
  })

  it('9. formal character deleted after roster operation → recovery receipt cannot close', () => {
    const projDir = createDir('proj-char-deleted-recovery-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    const candidateId = 'cand-char-deleted-001'
    const characterData = {
      name: '林墨',
      role: 'supporting',
      gender: '男',
      age: '35',
      appearance: '灰衣学士',
      background: '天机阁',
      personality: '睿智沉稳',
      abilities: '推演之术',
      motivation: '探寻天机',
      arc: '牺牲觉悟',
      notes: '第五章登场',
      relationships: [],
    }

    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '角色原始卡片：林墨',
      suggestedData: JSON.stringify(characterData),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '角色档案 > 林墨',
      sourceLineRange: '30-40',
      evidence: '检测到角色卡：林墨',
      confidence: 0.95,
      status: 'pending',
    })

    // 模拟在 roster_committed 阶段崩溃
    const crashHook = (stage: string) => {
      if (stage === 'roster_committed') {
        throw new Error('SIMULATED_CRASH_ROSTER_COMMITTED')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)

    // 验证角色已在名单中
    const rosterAfterCrash = CharacterRosterRepository.read()
    expect(rosterAfterCrash.entries.some(e => e.name === '林墨')).toBe(true)

    // 作者在崩溃后删除了该角色（通过提交不包含该角色的名单）
    CharacterRosterRepository.commit({
      operationId: 'author-delete-linmo',
      expectedRevision: rosterAfterCrash.revision,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [], // 全部删除
    })

    // 验证角色确实被删除
    expect(CharacterRosterRepository.read().entries.length).toBe(0)

    // 恢复审批：正式角色已被删除，必须失败关闭
    const retryRes = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author')
    expect(retryRes.success).toBe(false)
    expect(retryRes.error).toMatch(/正式角色已被删除或替换/u)

    // 角色名单仍为空，没有被错误地重新写入
    expect(CharacterRosterRepository.read().entries.length).toBe(0)
  })

  it('10. roster_committed reject does not produce rejected+formal character residue and does not mis-delete author character', () => {
    const projDir = createDir('proj-roster-committed-reject-residue-')
    initProjectDatabase(projDir)
    const db = getProjectDb()!
    db.prepare("INSERT INTO project_core (id, project_name) VALUES ('main', 'Test Novel')").run()

    // 作者预先创建一个同名正式角色
    CharacterRosterRepository.commit({
      operationId: 'author-original-char',
      expectedRevision: 0,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [{
        name: '萧逸',
        role: 'protagonist',
        gender: '男',
        age: '22',
        appearance: '剑眉星目',
        background: '萧家嫡子',
        personality: '洒脱不羁',
        abilities: '星辰剑法',
        motivation: '快意恩仇',
        arc: '浪子回头',
        notes: '作者亲手创建',
        relationships: [],
      }],
    })

    const candidateId = 'cand-char-residue-001'
    WorkspaceHubRepository.saveCandidate({
      candidateId,
      projectId: 'main',
      candidateType: 'character',
      rawData: '外部角色卡片：萧逸',
      suggestedData: JSON.stringify({
        name: '萧逸',
        role: 'supporting',
        gender: '男',
        age: '22',
        appearance: '黑衣',
        background: '扫描提取',
        personality: '沉默',
        abilities: '无',
        motivation: '无',
        arc: '无',
        notes: '扫描提取的同名角色',
        relationships: [],
      }),
      sourceFile: '05_人物与关系.md',
      sourceHeadingPath: '角色档案 > 萧逸',
      sourceLineRange: '1-10',
      evidence: '检测到角色卡：萧逸',
      confidence: 0.9,
      status: 'pending',
    })

    // 模拟在 roster_committed 阶段崩溃
    const crashHook = (stage: string) => {
      if (stage === 'roster_committed') {
        throw new Error('CRASH_ROSTER_COMMITTED')
      }
    }

    const firstTry = WorkspaceHubRepository.approveCandidate(candidateId, 'main', 'author', crashHook)
    expect(firstTry.success).toBe(false)

    // 此时候选处于 pending，回执处于 roster_committed
    const candidateMid = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candidateMid.status).toBe('pending')

    const receiptMid = db.prepare('SELECT stage FROM workspace_approval_receipts WHERE candidate_id = ?').get(candidateId) as { stage: string }
    expect(receiptMid.stage).toBe('roster_committed')

    // 尝试拒绝：状态机防护必须拒绝
    const rejectRes = WorkspaceHubRepository.rejectCandidate(candidateId, 'main')
    expect(rejectRes.success).toBe(false)
    expect(rejectRes.error).toContain('roster_committed')

    // 核心验证：候选不应被标记为 rejected（没有产生 rejected + 正式角色共存的残留状态）
    const candidateAfterReject = WorkspaceHubRepository.listCandidates({ projectId: 'main' })[0]
    expect(candidateAfterReject.status).toBe('pending')

    // 核心验证：作者角色未被删除（禁止按名字删角色）
    const rosterAfterReject = CharacterRosterRepository.read()
    expect(rosterAfterReject.entries.some(e => e.name === '萧逸')).toBe(true)
    expect(rosterAfterReject.entries.find(e => e.name === '萧逸')?.notes).not.toBe('扫描提取的同名角色')
  })
})
