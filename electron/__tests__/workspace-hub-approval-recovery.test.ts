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
})
