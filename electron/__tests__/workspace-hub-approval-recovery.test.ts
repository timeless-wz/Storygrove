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
})
