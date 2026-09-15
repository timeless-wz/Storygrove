import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { WorkspaceHubRepository } from '../repositories/workspace-hub-repository'
import { WorkspaceScannerService } from '../services/workspace-scanner-service'
import { ChapterContextAssembler } from '../services/chapter-context-assembler'
import { CharacterRosterRepository } from '../repositories/character-roster-repository'
import { NarrativeThreadRepository } from '../repositories/narrative-thread-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { FinalizationRepository } from '../repositories/finalization-repository'
import type { ChapterContextBlock, ChapterContextSourceRef } from '../../src/shared/workspace-hub'

/**
 * Stages 6-9 are filled from project-internal relational tables (character
 * roster, narrative threads, finalized drafts), not from the read-only external
 * novel material. Their source refs therefore live in a different identity
 * namespace than the workspace snapshot provenance used by the file-backed
 * stages: the (sourceId, approvedSnapshotId, fragmentId) triple identifies an
 * immutable approved snapshot fragment of an external file, and those rows do
 * not exist for internal entities.
 *
 * The constraint these tests lock in is that internal stages must report that
 * identity honestly as absent. Fabricating it would let a project-internal row
 * masquerade as external approved-file evidence and bypass the four-way
 * provenance validation that protects every file-backed stage.
 */

const SESSION_PROJECT_ID = 'main'
const INTERNAL_SOURCE_NAMESPACES = new Set([
  'characters',
  'characters.currentState',
  'narrative_thread_plans',
  'drafts',
])

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function buildRosterEntry(name: string, updatedAtChapter: number) {
  return {
    name,
    role: 'protagonist' as const,
    gender: '男',
    age: '24',
    appearance: '瘦高',
    personality: '克制',
    background: '幸存调查员',
    abilities: '痕迹分析',
    motivation: '查明真相',
    relationships: [],
    arc: '从旁观到承担',
    notes: '溯源验收角色',
    currentState: {
      location: '末班车',
      powerLevel: '未觉醒',
      physicalState: '轻伤',
      mentalState: '警觉',
      keyItems: '旧车票',
      recentEvents: '驶出地图',
      updatedAtChapter,
    },
  }
}

describe('Workspace Hub - Stage 6-9 internal provenance namespace', () => {
  const testRoots: string[] = []

  function createDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    testRoots.push(dir)
    return dir
  }

  function writeWorkspaceFiles(extDir: string): void {
    fs.writeFileSync(path.join(extDir, '00_创作方向.md'), '# 核心创作原则\n第一条：行文克制冷峻。\n', 'utf8')
    fs.writeFileSync(path.join(extDir, '02_剧情总纲.md'), '# 全书规划\n第一卷主线：调查末班车失踪案。\n', 'utf8')
    fs.writeFileSync(path.join(extDir, '10_第一卷剧情大纲.md'), '# 第一卷剧情大纲\n第1章至第8章驶出地图。\n', 'utf8')
    fs.writeFileSync(path.join(extDir, '11_第一阶段_第01-08章_驶出地图的末班车.md'), '# 第2章 雾气弥漫\n许渡在末班车上醒来。\n', 'utf8')
  }

  function seedProjectEntities(chapterNumber: number): void {
    const roster = CharacterRosterRepository.read()
    CharacterRosterRepository.commit({
      operationId: 'stage6-9-provenance-roster',
      expectedRevision: roster.revision,
      schemaVersion: 1,
      intent: 'manual_edit',
      entries: [buildRosterEntry('许渡', chapterNumber - 1)],
    })

    NarrativeThreadRepository.createPlan({
      title: '末班车失踪案',
      type: '伏笔',
      targetStartChapter: 1,
      targetEndChapter: 5,
      authorIntent: '在本章埋下换乘站的异常线索。',
    })

    const previousContent = `第${chapterNumber - 1}章定稿正文：许渡在末班车上醒来。`
    const draftId = DraftRepository.create({
      chapterNumber: chapterNumber - 1,
      source: 'write',
      content: previousContent,
      wordCount: previousContent.length,
    })
    FinalizationRepository.commit({
      finalizationId: 'stage6-9-provenance-finalization',
      draftId,
      chapterNumber: chapterNumber - 1,
      chapterTitle: `第${chapterNumber - 1}章`,
      content: previousContent,
      contentHash: sha256(previousContent),
      contentRevision: 1,
      targetFileName: `chapter-${chapterNumber - 1}.md`,
    })
  }

  function findBlock(blocks: ChapterContextBlock[], stage: number): ChapterContextBlock {
    const block = blocks.find(b => b.stage === stage)
    expect(block, `stage ${stage} block must be assembled`).toBeDefined()
    return block!
  }

  function hasWorkspaceSnapshotProvenance(ref: ChapterContextSourceRef): boolean {
    return Boolean(
      ref.sourceId
      || ref.approvedSnapshotId
      || ref.snapshotId
      || ref.sourceSnapshotFragmentId
      || ref.fragmentId,
    )
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

  it('keeps file-backed stages on complete, database-verifiable workspace snapshot provenance', async () => {
    const projDir = createDir('proj-stage69-file-')
    const extDir = createDir('ext-stage69-file-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()
    writeWorkspaceFiles(extDir)
    seedProjectEntities(2)

    WorkspaceHubRepository.bindWorkspaceDirectory(extDir, SESSION_PROJECT_ID)
    const scan = await WorkspaceScannerService.scanDirectory(extDir, SESSION_PROJECT_ID)
    expect(scan.success).toBe(true)
    WorkspaceHubRepository.approveAllSources(SESSION_PROJECT_ID)

    const bundle = ChapterContextAssembler.assemble({
      chapterNumber: 2,
      projectId: SESSION_PROJECT_ID,
    })
    const db = getProjectDb()!

    for (const stage of [1, 3, 4, 5]) {
      const block = findBlock(bundle.blocks, stage)
      expect(block.sourceType).toBe('file')
      expect(block.sources.length).toBeGreaterThan(0)
      for (const ref of block.sources) {
        expect(ref.provenanceStatus).toBe('found')
        expect(ref.sourceId).toBeTruthy()
        expect(ref.approvedSnapshotId).toBeTruthy()
        expect(ref.sourceSnapshotFragmentId).toBeTruthy()
        expect(ref.fragmentId).toBe(ref.sourceSnapshotFragmentId)

        // The four-way identity must resolve to a real approved snapshot fragment.
        const row = db.prepare(`
          SELECT id, fragment_hash
          FROM workspace_source_snapshot_fragments
          WHERE id = ? AND snapshot_id = ? AND source_id = ? AND project_id = ?
        `).get(
          ref.fragmentId,
          ref.snapshotId,
          ref.sourceId,
          SESSION_PROJECT_ID,
        ) as { id: string; fragment_hash: string } | undefined
        expect(row, `stage ${stage} ref must resolve in the snapshot fragment table`).toBeDefined()
        expect(row!.fragment_hash).toBe(ref.contentHash)
      }
    }
  })

  it('reports Stage 6-9 provenance as honestly absent instead of fabricating external snapshot evidence', async () => {
    const projDir = createDir('proj-stage69-internal-')
    const extDir = createDir('ext-stage69-internal-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()
    writeWorkspaceFiles(extDir)
    seedProjectEntities(2)

    WorkspaceHubRepository.bindWorkspaceDirectory(extDir, SESSION_PROJECT_ID)
    await WorkspaceScannerService.scanDirectory(extDir, SESSION_PROJECT_ID)
    WorkspaceHubRepository.approveAllSources(SESSION_PROJECT_ID)

    const bundle = ChapterContextAssembler.assemble({
      chapterNumber: 2,
      projectId: SESSION_PROJECT_ID,
    })
    const db = getProjectDb()!

    for (const stage of [6, 7, 8, 9]) {
      const block = findBlock(bundle.blocks, stage)
      expect(block.sourceType).toBe('database')
      expect(block.sources.length).toBeGreaterThan(0)

      for (const ref of block.sources) {
        // Internal rows have no workspace snapshot identity to report.
        expect(hasWorkspaceSnapshotProvenance(ref)).toBe(false)
        expect(ref.provenanceStatus).toBeUndefined()
        expect(ref.provenanceError).toBeUndefined()

        // The relative path must name an internal namespace, never an external file.
        expect(INTERNAL_SOURCE_NAMESPACES.has(ref.relativePath)).toBe(true)
        const externalSource = db.prepare(`
          SELECT id FROM workspace_sources WHERE project_id = ? AND relative_path = ?
        `).get(SESSION_PROJECT_ID, ref.relativePath)
        expect(externalSource, `stage ${stage} ref must not claim an external workspace source`).toBeUndefined()

        // A fabricated triple would be silently attributable to an approved
        // snapshot; no such fragment may exist for an internal ref.
        const fabricated = db.prepare(`
          SELECT id FROM workspace_source_snapshot_fragments
          WHERE project_id = ? AND (snapshot_id = ? OR source_id = ? OR heading_path = ?)
        `).get(
          SESSION_PROJECT_ID,
          ref.snapshotId ?? '__none__',
          ref.sourceId ?? '__none__',
          ref.headingPath,
        )
        expect(fabricated, `stage ${stage} ref must not resolve as an external snapshot fragment`).toBeUndefined()
      }
    }
  })

  it('assembles Stage 6-9 with no external workspace bound and never invents file provenance', () => {
    const projDir = createDir('proj-stage69-unbound-')
    initProjectDatabase(projDir)
    getProjectDb()!.prepare("INSERT OR IGNORE INTO project_core (id) VALUES ('main')").run()
    seedProjectEntities(2)

    // No external directory is bound or scanned at all: stages 6-9 depend only on
    // the project database, so they must still assemble without workspace provenance.
    const bundle = ChapterContextAssembler.assemble({
      chapterNumber: 2,
      projectId: SESSION_PROJECT_ID,
    })

    expect(bundle.blocks.some(b => b.sourceType === 'file')).toBe(false)

    for (const stage of [6, 7, 8, 9]) {
      const block = findBlock(bundle.blocks, stage)
      expect(block.sourceType).toBe('database')
      for (const ref of block.sources) {
        expect(hasWorkspaceSnapshotProvenance(ref)).toBe(false)
      }
    }

    // The internal stages remain project-scoped: the assembly still refuses to
    // import any rule or fragment claimed by a different project.
    const foreignRuleProject = getProjectDb()!.prepare(`
      INSERT INTO setting_rules (rule_id, project_id, title, content, status, constraint_type, scope, created_at)
      VALUES ('rule-foreign', 'other-project', '外来规则', '不得注入', 'confirmed', 'hard', 'global', datetime('now'))
    `).run()
    expect(foreignRuleProject.changes).toBe(1)

    const afterForeignInsert = ChapterContextAssembler.assemble({
      chapterNumber: 2,
      projectId: SESSION_PROJECT_ID,
    })
    expect(afterForeignInsert.fullAssembledText).not.toContain('不得注入')
  })
})
