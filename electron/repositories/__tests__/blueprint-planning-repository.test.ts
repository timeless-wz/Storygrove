import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { BlueprintDetailRepository } from '../blueprint-detail-repository'
import { BlueprintPlanningRepository, blueprintPlanningSha256 } from '../blueprint-planning-repository'
import { BlueprintRepository } from '../blueprint-repository'
import { ProjectCoreRepository, hashProjectSynopsis } from '../project-core-repository'
import type {
  BlueprintPlanningCandidateSaveInput,
  BlueprintPlanningSourceSnapshot,
} from '../../../src/shared/blueprint-planning'
import { parseChapterBlueprintMarkdown } from '../../../src/shared/blueprint-v2-markdown'
import {
  blueprintPlanningChapterIndexHash,
  blueprintPlanningChapterVolumeHash,
  blueprintPlanningVolumeIndexHash,
} from '../../../src/shared/blueprint-planning'

let root = ''

function sourceSnapshot(
  targetHash = hashProjectSynopsis(ProjectCoreRepository.get()?.synopsis ?? ''),
  sources: BlueprintPlanningSourceSnapshot['sources'] = [],
  snapshotId = 'snapshot-book-v1',
): BlueprintPlanningSourceSnapshot {
  return {
    snapshotId,
    targetKind: 'book',
    targetId: 'main',
    targetRevision: null,
    targetHash,
    sources,
  }
}

function saveCandidate(
  overrides: Partial<BlueprintPlanningCandidateSaveInput> & Pick<BlueprintPlanningCandidateSaveInput, 'kind' | 'candidate'>,
) {
  return BlueprintPlanningRepository.saveCandidate({
    operationId: 'plan-operation-1',
    kind: overrides.kind,
    scope: overrides.scope ?? { kind: 'book' },
    schemaVersion: 1,
    candidate: overrides.candidate,
    sourceSnapshot: overrides.sourceSnapshot ?? sourceSnapshot(),
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-planning-'))
  initProjectDatabase(root)
  ProjectCoreRepository.init('层级规划测试')
  const initial = ProjectCoreRepository.get()
  expect(initial).not.toBeNull()
  expect(ProjectCoreRepository.update({
    synopsis: '旧项目的长总纲\n保留原始换行与章节安排。',
    expectedSynopsisHash: hashProjectSynopsis(initial!.synopsis),
  }).success).toBe(true)
  BlueprintRepository.upsertVolume({ id: 'volume-2', name: '第二卷', sortOrder: 2 })
})

afterEach(() => {
  closeProjectDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('BlueprintPlanningRepository volume outline CAS', () => {
  it('does not backfill old volumes and saves original Markdown with revision/hash read-back', () => {
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-1')).toBeNull()
    const body = '## 自定义卷纲\r\n\r\n不标准化空行。\r\n'
    const first = BlueprintPlanningRepository.saveVolumeOutline({
      volumeId: 'volume-1', expectedRevision: 0, markdown: body, origin: 'manual',
    })
    expect(first).toMatchObject({ success: true, outline: {
      volumeId: 'volume-1', markdown: body, revision: 1, contentHash: blueprintPlanningSha256(body), origin: 'manual',
    } })
    expect(BlueprintPlanningRepository.saveVolumeOutline({
      volumeId: 'volume-1', expectedRevision: 0, markdown: 'stale', origin: 'manual',
    })).toMatchObject({ success: false, code: 'REVISION_CONFLICT', current: { revision: 1, markdown: body } })

    const summaries = BlueprintPlanningRepository.listVolumeOutlineSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ volumeId: 'volume-1', revision: 1, contentHash: blueprintPlanningSha256(body) })
    expect(summaries[0]).not.toHaveProperty('markdown')
    expect(ProjectCoreRepository.get()?.synopsis).toBe('旧项目的长总纲\n保留原始换行与章节安排。')
  })

  it('rejects an outline for a missing stable volume id without inserting an orphan row', () => {
    expect(BlueprintPlanningRepository.saveVolumeOutline({
      volumeId: 'missing-volume', expectedRevision: 0, markdown: 'not saved', origin: 'import',
    })).toMatchObject({ success: false, code: 'VOLUME_NOT_FOUND' })
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM blueprint_volume_outlines').get())
      .toEqual({ count: 0 })
  })

  it('deletes only the volume outline with revision CAS and treats absent revision zero as a no-op', () => {
    const absent = BlueprintPlanningRepository.deleteVolumeOutline({ volumeId: 'volume-2', expectedRevision: 0 })
    expect(absent).toEqual({ success: true, deleted: false })

    BlueprintRepository.upsert({
      chapterNumber: 7, title: '保留的章节', role: '推进', purpose: '保留章节蓝图', keyEvents: '关键事件',
      characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', volumeId: 'volume-2',
    })
    const saved = BlueprintPlanningRepository.saveVolumeOutline({
      volumeId: 'volume-2', expectedRevision: 0, markdown: '待清空卷纲', origin: 'manual',
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return

    expect(BlueprintPlanningRepository.deleteVolumeOutline({ volumeId: 'volume-2', expectedRevision: 0 }))
      .toMatchObject({ success: false, code: 'REVISION_CONFLICT', current: { revision: 1 } })
    expect(BlueprintPlanningRepository.deleteVolumeOutline({ volumeId: 'volume-2', expectedRevision: 1 }))
      .toEqual({ success: true, deleted: true })
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-2')).toBeNull()
    expect(BlueprintRepository.getByChapter(7)).toMatchObject({ chapterNumber: 7, volumeId: 'volume-2', title: '保留的章节' })
    expect(getProjectDb()!.prepare('SELECT id FROM blueprint_volumes WHERE id = ?').get('volume-2'))
      .toEqual({ id: 'volume-2' })
  })
})

describe('BlueprintPlanningRepository persisted candidates and atomic confirmation', () => {
  it('keeps candidate saves idempotent and rejects reuse with another payload', () => {
    const input = {
      operationId: 'op-candidate', kind: 'book-outline' as const, scope: { kind: 'book' as const },
      schemaVersion: 1, candidate: { markdown: '候选总纲' }, sourceSnapshot: sourceSnapshot(undefined, [], 'snap-candidate'),
    }
    const first = BlueprintPlanningRepository.saveCandidate(input)
    expect(first).toMatchObject({ success: true, idempotent: false, candidate: { state: 'candidate' } })
    expect(BlueprintPlanningRepository.saveCandidate(input)).toMatchObject({ success: true, idempotent: true })
    expect(BlueprintPlanningRepository.saveCandidate({ ...input, candidate: { markdown: '另一个候选' } }))
      .toMatchObject({ success: false, code: 'OPERATION_ID_REUSE' })
    expect(BlueprintPlanningRepository.getCandidate('op-candidate')?.candidate).toEqual({ markdown: '候选总纲' })
  })

  it('persists candidate edits through payload-hash CAS', () => {
    const saved = saveCandidate({ kind: 'volume-outline', candidate: { volumeId: 'volume-2', markdown: '初稿' } })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    const updated = BlueprintPlanningRepository.updateCandidate({
      operationId: saved.candidate.operationId,
      expectedPayloadHash: saved.candidate.payloadHash,
      candidate: { volumeId: 'volume-2', markdown: '作者修改稿' },
    })
    expect(updated).toMatchObject({ success: true, candidate: { candidate: { markdown: '作者修改稿' } } })
    expect(BlueprintPlanningRepository.updateCandidate({
      operationId: saved.candidate.operationId,
      expectedPayloadHash: saved.candidate.payloadHash,
      candidate: { volumeId: 'volume-2', markdown: '旧版本覆盖' },
    })).toMatchObject({ success: false, code: 'REVISION_CONFLICT' })
  })

  it('commits only selected volumes, saves their outlines atomically, and returns an idempotent receipt', () => {
    const existingVolumes = BlueprintRepository.getVolumes().map(volume => ({
      id: volume.id, name: volume.name, sortOrder: volume.sortOrder,
    }))
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-volume-plan', kind: 'volume-plan', scope: { kind: 'book' }, schemaVersion: 1,
      candidate: { volumes: [
        { volumeId: 'volume-new-a', isNew: true, name: '新卷甲', sortOrder: 3, markdown: '# 甲卷纲', expectedOutlineRevision: 0 },
        { volumeId: 'volume-new-b', isNew: true, name: '新卷乙', sortOrder: 4, markdown: '# 乙卷纲', expectedOutlineRevision: 0 },
      ] },
      sourceSnapshot: sourceSnapshot(undefined, [{
        kind: 'volume-index', targetId: 'main', contentHash: blueprintPlanningVolumeIndexHash(existingVolumes),
      }], 'snap-volume-plan'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    const confirm = {
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { volumeIds: ['volume-new-a'] },
    }
    expect(BlueprintPlanningRepository.confirm(confirm)).toMatchObject({
      success: true, receipt: { selectedVolumeIds: ['volume-new-a'], idempotent: false },
    })
    expect(BlueprintRepository.getVolumes().map(volume => volume.id)).toContain('volume-new-a')
    expect(BlueprintRepository.getVolumes().map(volume => volume.id)).not.toContain('volume-new-b')
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-new-a')?.markdown).toBe('# 甲卷纲')
    const outputSnapshot = getProjectDb()!.prepare(`
      SELECT snapshot_id FROM blueprint_planning_sources
      WHERE operation_id = ? AND target_kind = 'volume' AND target_id = 'volume-new-a'
    `).get(saved.candidate.operationId) as { snapshot_id: string }
    expect(BlueprintPlanningRepository.getSourceStatuses([outputSnapshot.snapshot_id]))
      .toEqual([{ snapshotId: outputSnapshot.snapshot_id, state: 'current' }])

    BlueprintRepository.upsertVolume({ id: 'volume-later', name: '后续新增卷', sortOrder: 5 })
    expect(BlueprintPlanningRepository.getSourceStatuses([outputSnapshot.snapshot_id]))
      .toEqual([{ snapshotId: outputSnapshot.snapshot_id, state: 'stale' }])
    expect(BlueprintPlanningRepository.confirm(confirm)).toMatchObject({ success: true, receipt: { idempotent: true } })
    expect(BlueprintPlanningRepository.confirm({
      ...confirm, selection: { volumeIds: ['volume-new-b'] },
    })).toMatchObject({ success: false, code: 'OPERATION_ID_REUSE' })
  })

  it('updates only explicitly selected existing volume metadata and outline', () => {
    const before = BlueprintRepository.getVolumes()
    const selectedBefore = before.find(volume => volume.id === 'volume-2')!
    const unselectedBefore = before.find(volume => volume.id === 'volume-1')!
    const volumeIndexHash = blueprintPlanningVolumeIndexHash(before.map(volume => ({
      id: volume.id, name: volume.name, sortOrder: volume.sortOrder,
    })))
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-update-selected-volume', kind: 'volume-plan', scope: { kind: 'book' }, schemaVersion: 1,
      candidate: { volumes: [
        { volumeId: 'volume-2', isNew: false, name: '明确改名的第二卷', sortOrder: 8, markdown: '# 新卷纲', expectedOutlineRevision: 0 },
        { volumeId: 'volume-1', isNew: false, name: '未选中不应改名', sortOrder: 99, markdown: '# 未选卷纲', expectedOutlineRevision: 0 },
      ] },
      sourceSnapshot: sourceSnapshot(undefined, [
        { kind: 'volume-index', targetId: 'main', contentHash: volumeIndexHash },
      ], 'snap-update-selected-volume'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return

    expect(BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { volumeIds: ['volume-2'] },
    })).toMatchObject({ success: true, receipt: { selectedVolumeIds: ['volume-2'] } })

    expect(BlueprintRepository.getVolumes()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'volume-2', name: '明确改名的第二卷', sortOrder: 8 }),
      expect.objectContaining({ id: unselectedBefore.id, name: unselectedBefore.name, sortOrder: unselectedBefore.sortOrder }),
    ]))
    expect(BlueprintRepository.getVolumes().find(volume => volume.id === selectedBefore.id)?.name)
      .toBe('明确改名的第二卷')
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-2')?.markdown).toBe('# 新卷纲')
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-1')).toBeNull()
  })

  it('marks candidates stale if the frozen synopsis source changes and preserves the candidate', () => {
    const synopsis = ProjectCoreRepository.get()!.synopsis
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-stale-plan', kind: 'volume-plan', scope: { kind: 'book' }, schemaVersion: 1,
      candidate: { volumes: [{ volumeId: 'must-not-create', isNew: true, name: '不应创建', markdown: '' }] },
      sourceSnapshot: sourceSnapshot(blueprintPlanningSha256(synopsis), [
        { kind: 'synopsis', targetId: 'main', contentHash: blueprintPlanningSha256(synopsis) },
      ], 'snap-stale-plan'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    expect(ProjectCoreRepository.update({ synopsis: '并发修改后的总纲', expectedSynopsisHash: hashProjectSynopsis(synopsis) }).success).toBe(true)
    expect(BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { volumeIds: ['must-not-create'] },
    })).toMatchObject({ success: false, code: 'STALE_SOURCE' })
    expect(BlueprintPlanningRepository.getCandidate('op-stale-plan')?.state).toBe('stale')
    expect(BlueprintRepository.getVolumes().map(volume => volume.id)).not.toContain('must-not-create')
  })

  it('derives live source status and marks pending candidates stale on get/list', () => {
    const synopsis = ProjectCoreRepository.get()!.synopsis
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-live-freshness', kind: 'book-outline', scope: { kind: 'book' }, schemaVersion: 1,
      candidate: { markdown: '待审核总纲' },
      sourceSnapshot: sourceSnapshot(blueprintPlanningSha256(synopsis), [
        { kind: 'synopsis', targetId: 'main', contentHash: blueprintPlanningSha256(synopsis) },
      ], 'snap-live-freshness'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    expect(BlueprintPlanningRepository.getSourceStatuses(['snap-live-freshness', 'missing-snapshot']))
      .toEqual([
        { snapshotId: 'snap-live-freshness', state: 'current' },
        { snapshotId: 'missing-snapshot', state: 'unlinked' },
      ])

    expect(ProjectCoreRepository.update({ synopsis: '变更后的总纲', expectedSynopsisHash: hashProjectSynopsis(synopsis) }).success)
      .toBe(true)
    expect(BlueprintPlanningRepository.getSourceStatuses(['snap-live-freshness']))
      .toEqual([{ snapshotId: 'snap-live-freshness', state: 'stale' }])
    expect(BlueprintPlanningRepository.getCandidate('op-live-freshness')?.state).toBe('stale')
    expect(BlueprintPlanningRepository.listCandidates({ states: ['stale'] }).map(item => item.operationId))
      .toContain('op-live-freshness')
  })

  it('marks candidate stale when the frozen volume index changes or an absent outline appears', () => {
    const currentVolumes = BlueprintRepository.getVolumes().map(volume => ({
      id: volume.id, name: volume.name, sortOrder: volume.sortOrder,
    }))
    const volumeIndexHash = blueprintPlanningVolumeIndexHash(currentVolumes)
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-volume-index', kind: 'volume-plan', scope: { kind: 'book' }, schemaVersion: 1,
      candidate: { volumes: [{ volumeId: 'volume-index-new', isNew: true, name: '待选卷', markdown: '' }] },
      sourceSnapshot: sourceSnapshot(undefined, [
        { kind: 'volume-index', targetId: 'main', contentHash: volumeIndexHash },
        { kind: 'volume-outline', targetId: 'volume-2', revision: 0, contentHash: blueprintPlanningSha256('') },
      ], 'snap-volume-index'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    BlueprintRepository.upsertVolume({ id: 'volume-concurrent', name: '并发新增卷', sortOrder: 8 })
    expect(BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { volumeIds: ['volume-index-new'] },
    })).toMatchObject({ success: false, code: 'STALE_SOURCE' })
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-2')).toBeNull()
    expect(BlueprintRepository.getVolumes().map(volume => volume.id)).not.toContain('volume-index-new')
  })

  it('treats a chapter summary absence sentinel as stale if that global chapter is added', () => {
    const synopsis = ProjectCoreRepository.get()!.synopsis
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-absent-chapter', kind: 'chapter-plan', scope: { kind: 'volume', volumeId: 'volume-2' }, schemaVersion: 1,
      candidate: { volumeId: 'volume-2', chapters: [{ chapterNumber: 401, title: '候选章', purpose: '目标', keyEvents: '事件' }] },
      sourceSnapshot: sourceSnapshot(blueprintPlanningSha256(synopsis), [
        { kind: 'synopsis', targetId: 'main', contentHash: blueprintPlanningSha256(synopsis) },
        { kind: 'chapter-summary', targetId: '401', chapterNumber: 401, revision: 0, contentHash: blueprintPlanningSha256('') },
      ], 'snap-absent-chapter'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    BlueprintRepository.upsert({
      chapterNumber: 401, volumeId: 'volume-1', title: '并发人工章', role: '', purpose: '已新增', keyEvents: '',
      characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '',
    })
    expect(BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { targetVolumeId: 'volume-2', chapterNumbers: [401] },
    })).toMatchObject({ success: false, code: 'STALE_SOURCE' })
    expect(BlueprintRepository.getByChapter(401)?.title).toBe('并发人工章')
  })

  it('creates globally numbered chapter rows under only the selected blueprint volume', () => {
    const synopsis = ProjectCoreRepository.get()!.synopsis
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-chapter-plan', kind: 'chapter-plan', scope: { kind: 'volume', volumeId: 'volume-2' }, schemaVersion: 1,
      candidate: { volumeId: 'volume-2', chapters: [
        { chapterNumber: 201, title: '越界', purpose: '推进', keyEvents: '变化', suspenseHook: '追问' },
      ] },
      sourceSnapshot: sourceSnapshot(blueprintPlanningSha256(synopsis), [
        { kind: 'synopsis', targetId: 'main', contentHash: blueprintPlanningSha256(synopsis) },
      ], 'snap-chapter-plan'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    expect(BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { targetVolumeId: 'volume-2', chapterNumbers: [201] },
    })).toMatchObject({ success: true, receipt: { chapterNumbers: [201], selectedVolumeIds: ['volume-2'] } })
    expect(BlueprintRepository.getByChapter(201)).toMatchObject({
      chapterNumber: 201, volumeId: 'volume-2', title: '越界', purpose: '推进', keyEvents: '变化',
      suspenseHook: '追问', role: '', characters: [], userGuidance: '', notes: '',
    })
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM chapter_volume_assignments WHERE chapter_number = 201').get())
      .toEqual({ count: 0 })
  })

  it('tracks chapter-plan targets against v1 blueprint rows, not missing v2 details', () => {
    const chapterIndexHash = blueprintPlanningChapterIndexHash([])
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-chapter-target-v1', kind: 'chapter-plan', scope: { kind: 'volume', volumeId: 'volume-2' }, schemaVersion: 1,
      candidate: { volumeId: 'volume-2', chapters: [{ chapterNumber: 4, title: '第四章', purpose: '目标', keyEvents: '事件' }] },
      sourceSnapshot: {
        snapshotId: 'snap-chapter-target-v1', targetKind: 'volume', targetId: 'volume-2', targetRevision: 0,
        targetHash: blueprintPlanningSha256(''), sources: [
          { kind: 'chapter-index', targetId: 'volume-2', contentHash: chapterIndexHash },
          { kind: 'chapter-summary', targetId: '4', chapterNumber: 4, revision: 0, contentHash: blueprintPlanningSha256('') },
          { kind: 'chapter-volume', targetId: '4', chapterNumber: 4, revision: 0, volumeId: null, contentHash: blueprintPlanningChapterVolumeHash('') },
        ],
      },
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    const committed = BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { targetVolumeId: 'volume-2', chapterNumbers: [4] },
    })
    expect(committed).toMatchObject({ success: true, receipt: { chapterNumbers: [4] } })
    const derivedSnapshot = getProjectDb()!.prepare(`
      SELECT snapshot_id FROM blueprint_planning_sources WHERE operation_id = ? AND target_kind = 'chapter'
    `).get(saved.candidate.operationId) as { snapshot_id: string } | undefined
    const derivedSnapshotId = derivedSnapshot!.snapshot_id
    expect(BlueprintPlanningRepository.getSourceStatuses([derivedSnapshotId]))
      .toEqual([{ snapshotId: derivedSnapshotId, state: 'current' }])
    expect(BlueprintPlanningRepository.getTargetSourceStatuses([
      { targetKind: 'chapter', targetId: '4' },
    ])).toEqual([{
      targetKind: 'chapter', targetId: '4', snapshotId: derivedSnapshotId,
      operationId: saved.candidate.operationId, state: 'current',
    }])

    const committedOutput = getProjectDb()!.prepare('SELECT sources_json FROM blueprint_planning_sources WHERE snapshot_id = ?')
      .get(derivedSnapshotId) as { sources_json: string }
    const settledSources = JSON.parse(committedOutput.sources_json) as Array<{ kind: string; targetId: string; contentHash: string }>
    expect(settledSources.find(source => source.kind === 'chapter-index')?.contentHash)
      .toBe(blueprintPlanningChapterIndexHash([{
        chapterNumber: 4, volumeId: 'volume-2', title: '第四章', purpose: '目标', keyEvents: '事件',
      }]))
    expect(settledSources.find(source => source.kind === 'chapter-summary' && source.targetId === '4')?.contentHash)
      .toBe(blueprintPlanningSha256(JSON.stringify({ keyEvents: '事件', purpose: '目标', title: '第四章' })))

    getProjectDb()!.prepare("UPDATE blueprints SET title = '人工修改' WHERE chapter_number = 4").run()
    expect(BlueprintPlanningRepository.getSourceStatuses([derivedSnapshotId]))
      .toEqual([{ snapshotId: derivedSnapshotId, state: 'stale' }])
    expect(BlueprintPlanningRepository.getTargetSourceStatuses([
      { targetKind: 'chapter', targetId: '4' },
    ])).toMatchObject([{ snapshotId: derivedSnapshotId, state: 'stale' }])
  })

  it('rebases a committed book-outline source link while keeping later synopsis edits stale', () => {
    const previousSynopsis = ProjectCoreRepository.get()!.synopsis
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-book-outline-rebase', kind: 'book-outline', scope: { kind: 'book' }, schemaVersion: 1,
      candidate: { markdown: '新的正式总纲' },
      sourceSnapshot: sourceSnapshot(blueprintPlanningSha256(previousSynopsis), [{
        kind: 'synopsis', targetId: 'main', contentHash: blueprintPlanningSha256(previousSynopsis),
      }], 'snap-book-outline-rebase'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return

    const confirmed = BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: {},
    })
    expect(confirmed.success).toBe(true)
    const outputSnapshot = getProjectDb()!.prepare(`
      SELECT snapshot_id FROM blueprint_planning_sources
      WHERE operation_id = ? AND target_kind = 'book' AND snapshot_id <> ?
    `).get(saved.candidate.operationId, saved.candidate.sourceSnapshot.snapshotId) as { snapshot_id: string }
    expect(BlueprintPlanningRepository.getSourceStatuses([outputSnapshot.snapshot_id]))
      .toEqual([{ snapshotId: outputSnapshot.snapshot_id, state: 'current' }])

    const currentSynopsis = ProjectCoreRepository.get()!.synopsis
    expect(ProjectCoreRepository.update({
      synopsis: '稍后作者又改了总纲', expectedSynopsisHash: hashProjectSynopsis(currentSynopsis),
    }).success).toBe(true)
    expect(BlueprintPlanningRepository.getSourceStatuses([outputSnapshot.snapshot_id]))
      .toEqual([{ snapshotId: outputSnapshot.snapshot_id, state: 'stale' }])
  })

  it('rolls back earlier chapter inserts when a selected global chapter number already exists', () => {
    BlueprintRepository.upsert({
      chapterNumber: 301, title: '人工章', role: '转折', purpose: '人工目的', keyEvents: '人工事件',
      characters: ['主角'], suspenseHook: '人工钩子', userGuidance: '保留指导', notes: '保留定稿事实', notesUpdatedAt: 'before',
    })
    const saved = BlueprintPlanningRepository.saveCandidate({
      operationId: 'op-number-conflict', kind: 'chapter-plan', scope: { kind: 'volume', volumeId: 'volume-2' }, schemaVersion: 1,
      candidate: { volumeId: 'volume-2', chapters: [
        { chapterNumber: 300, title: '新章', purpose: '目的', keyEvents: '事件' },
        { chapterNumber: 301, title: '不得覆盖', purpose: '覆盖', keyEvents: '覆盖' },
      ] },
      sourceSnapshot: sourceSnapshot(undefined, [], 'snap-number-conflict'),
    })
    expect(saved.success).toBe(true)
    if (!saved.success) return
    expect(BlueprintPlanningRepository.confirm({
      operationId: saved.candidate.operationId,
      expectedSourceSnapshot: saved.candidate.sourceSnapshot,
      selection: { targetVolumeId: 'volume-2', chapterNumbers: [300, 301] },
    })).toMatchObject({ success: false, code: 'CHAPTER_NUMBER_CONFLICT' })
    expect(BlueprintRepository.getByChapter(300)).toBeNull()
    expect(BlueprintRepository.getByChapter(301)).toMatchObject({
      title: '人工章', role: '转折', characters: ['主角'],
      userGuidance: '保留指导', notes: '保留定稿事实',
    })
    expect(getProjectDb()!.prepare('SELECT volume_id FROM blueprints WHERE chapter_number = 301').get())
      .toEqual({ volume_id: 'volume-1' })
  })

  it('reopens a legacy project twice without rewriting synopsis, v2 Markdown, ownership, or draft bindings', () => {
    const db = getProjectDb()!
    const longSynopsis = ProjectCoreRepository.get()!.synopsis
    const legacyImportedMarkdown = fs.readFileSync(
      path.join(__dirname, '../../../test/fixtures/blueprint-v2/chapter-01.md'),
      'utf8',
    )
    const parsed = parseChapterBlueprintMarkdown(legacyImportedMarkdown)
    BlueprintRepository.upsert({
      chapterNumber: 41, title: '旧项目第二卷人工章', role: '转折', purpose: '保留人工目的', keyEvents: '保留事件',
      characters: ['许渡'], suspenseHook: '未完成钩子', userGuidance: '作者指导原文', notes: '定稿后记录',
      notesUpdatedAt: '2026-09-30 10:00:00', volumeId: 'volume-2',
    })
    BlueprintRepository.upsert({
      chapterNumber: 42, title: '旧项目第一卷章', role: '建置', purpose: '另一卷内容', keyEvents: '另一卷事件',
      characters: [], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', volumeId: 'volume-1',
    })
    const v2Content = {
      ...parsed.content,
      chapterNumber: 41,
      planning: {
        volumeTask: '接续第二卷卷内任务',
        handoff: '承接旧项目的前章冲突',
        expectedEndChange: '主角失去一项保障',
      },
    }
    expect(BlueprintDetailRepository.save({ chapterNumber: 41, baseRevision: 0, content: v2Content }).success).toBe(true)
    expect(BlueprintDetailRepository.save({
      chapterNumber: 42, baseRevision: 0, content: { ...parsed.content, chapterNumber: 42 },
    }).success).toBe(true)

    const dbInsertContent = db.prepare('INSERT INTO contents (body) VALUES (?)')
    const dbInsertDraft = db.prepare(`
      INSERT INTO drafts (id, chapter_number, blueprint_chapter_number, version, status, source, content_id, word_count)
      VALUES (?, ?, ?, ?, ?, 'write', ?, ?)
    `)
    const versionOne = Number(dbInsertContent.run('第一版正文，不能受规划迁移影响。').lastInsertRowid)
    const versionTwo = Number(dbInsertContent.run('第二版正文，仍绑定原蓝图章。').lastInsertRowid)
    dbInsertDraft.run(4101, 410, 41, 1, 'draft', versionOne, 18)
    dbInsertDraft.run(4102, 410, 41, 2, 'revised', versionTwo, 16)
    db.prepare('INSERT INTO chapter_volume_assignments (chapter_number, volume_id) VALUES (?, ?)')
      .run(410, 'prose-volume-archive')

    const expected = {
      volumes: db.prepare('SELECT id, name, sort_order FROM blueprint_volumes ORDER BY id').all(),
      blueprints: db.prepare('SELECT chapter_number, volume_id, title, user_guidance, notes FROM blueprints ORDER BY chapter_number').all(),
      details: db.prepare('SELECT chapter_number, detail_json, raw_markdown, revision, content_hash FROM blueprint_details ORDER BY chapter_number').all(),
      assignments: db.prepare('SELECT chapter_number, volume_id FROM chapter_volume_assignments ORDER BY chapter_number').all(),
      drafts: db.prepare(`
        SELECT drafts.id, drafts.chapter_number, drafts.blueprint_chapter_number, drafts.version,
               drafts.status, drafts.content_id, contents.body
        FROM drafts JOIN contents ON contents.id = drafts.content_id ORDER BY drafts.id
      `).all(),
    }

    // Simulate a database created before the hierarchy-planning tables existed.
    db.exec(`
      DROP TABLE blueprint_planning_checks;
      DROP TABLE blueprint_planning_sources;
      DROP TABLE blueprint_planning_candidates;
      DROP TABLE blueprint_volume_outlines;
    `)
    closeProjectDatabase()

    initProjectDatabase(root)
    expect(ProjectCoreRepository.get()?.synopsis).toBe(longSynopsis)
    expect(BlueprintPlanningRepository.getVolumeOutline('volume-1')).toBeNull()
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM blueprint_planning_sources').get())
      .toEqual({ count: 0 })
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM blueprint_volume_outlines').get())
      .toEqual({ count: 0 })

    closeProjectDatabase()
    initProjectDatabase(root)
    const reopenedDb = getProjectDb()!
    expect(ProjectCoreRepository.get()?.synopsis).toBe(longSynopsis)
    expect(reopenedDb.prepare('SELECT id, name, sort_order FROM blueprint_volumes ORDER BY id').all()).toEqual(expected.volumes)
    expect(reopenedDb.prepare('SELECT chapter_number, volume_id, title, user_guidance, notes FROM blueprints ORDER BY chapter_number').all())
      .toEqual(expected.blueprints)
    expect(reopenedDb.prepare('SELECT chapter_number, detail_json, raw_markdown, revision, content_hash FROM blueprint_details ORDER BY chapter_number').all())
      .toEqual(expected.details)
    expect(reopenedDb.prepare('SELECT chapter_number, volume_id FROM chapter_volume_assignments ORDER BY chapter_number').all())
      .toEqual(expected.assignments)
    expect(reopenedDb.prepare(`
      SELECT drafts.id, drafts.chapter_number, drafts.blueprint_chapter_number, drafts.version,
             drafts.status, drafts.content_id, contents.body
      FROM drafts JOIN contents ON contents.id = drafts.content_id ORDER BY drafts.id
    `).all()).toEqual(expected.drafts)
    expect(reopenedDb.prepare('SELECT COUNT(*) AS count FROM blueprint_volume_outlines').get())
      .toEqual({ count: 0 })
    expect(reopenedDb.prepare('SELECT COUNT(*) AS count FROM blueprint_planning_candidates').get())
      .toEqual({ count: 0 })
  })

  it('exports the versioned planning package with exact hierarchy sources and without prose or drafts', () => {
    const db = getProjectDb()!
    const body = '## 第二卷卷纲\r\n保留原文换行。\r\n'
    expect(BlueprintPlanningRepository.saveVolumeOutline({
      volumeId: 'volume-2', expectedRevision: 0, markdown: body, origin: 'manual',
    }).success).toBe(true)
    BlueprintRepository.upsert({
      chapterNumber: 51, title: '导出章', role: '转折', purpose: '保持真实卷归属', keyEvents: '推进主线',
      characters: ['林澈'], suspenseHook: '卷末悬念', userGuidance: '作者指导', notes: '定稿事实',
      notesUpdatedAt: '2026-10-03 10:00:00', volumeId: 'volume-2',
    })
    const fixturePath = path.join(__dirname, '../../../test/fixtures/blueprint-v2/chapter-01.md')
    const parsed = parseChapterBlueprintMarkdown(fs.readFileSync(fixturePath, 'utf8'))
    expect(BlueprintDetailRepository.save({
      chapterNumber: 51,
      baseRevision: 0,
      content: { ...parsed.content, chapterNumber: 51 },
    }).success).toBe(true)
    db.prepare('INSERT INTO contents (id, body) VALUES (?, ?)').run(1, '不得导出的正文内容')
    db.prepare(`
      INSERT INTO drafts (id, chapter_number, blueprint_chapter_number, version, status, source, content_id, word_count)
      VALUES (1, 510, 51, 1, 'draft', 'write', 1, 9)
    `).run()
    db.prepare('INSERT INTO chapter_volume_assignments (chapter_number, volume_id) VALUES (?, ?)')
      .run(510, 'prose-volume-not-blueprint-volume')
    const exactRawMarkdown = (db.prepare(
      'SELECT raw_markdown FROM blueprint_details WHERE chapter_number = 51',
    ).get() as { raw_markdown: string }).raw_markdown

    const planningPackage = BlueprintPlanningRepository.exportPlanningPackage()
    expect(planningPackage.manifest.schemaVersion).toBe(1)
    expect(planningPackage.synopsis).toBe('旧项目的长总纲\n保留原始换行与章节安排。')
    expect(planningPackage.volumes).toEqual([
      expect.objectContaining({ volumeId: 'volume-1', outline: null }),
      expect.objectContaining({
        volumeId: 'volume-2',
        outline: expect.objectContaining({ markdown: body, volumeId: 'volume-2' }),
      }),
    ])
    expect(planningPackage.chapters).toHaveLength(1)
    expect(planningPackage.chapters[0]).toMatchObject({
      chapterNumber: 51,
      volumeId: 'volume-2',
      detail: { rawMarkdown: exactRawMarkdown, revision: 1 },
    })
    const serialized = JSON.stringify(planningPackage)
    expect(serialized).not.toContain('不得导出的正文内容')
    expect(serialized).not.toContain('prose-volume-not-blueprint-volume')
    expect(serialized).not.toContain('drafts')
  })
})
