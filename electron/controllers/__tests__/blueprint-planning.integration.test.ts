import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { projectAccess } from '../../services/project-access'
import { blueprintPlanningSha256 } from '../../repositories/blueprint-planning-repository'
import { registerDatabaseController } from '../db-controller'
import { ipc } from '../../../src/services/ipc-client'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const bridge = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => bridge.handlers.set(channel, handler) },
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false },
}))

let root = ''
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-blueprint-planning-ipc-'))
  registerDatabaseController()
  vi.stubGlobal('window', { velaAPI: { invoke: async (channel: string, ...args: unknown[]) => {
    const handler = bridge.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler ${channel}`)
    return handler({ sender: { id: 1 } }, ...args)
  } } })
})
afterEach(() => {
  closeProjectDatabase()
  projectAccess.invalidateCurrentSession()
})
afterAll(() => {
  vi.unstubAllGlobals()
  fs.rmSync(root, { recursive: true, force: true })
})

it('saves, edits, confirms, reads back, and rechecks planning through session-gated IPC', async () => {
  initProjectDatabase(root)
  const projectId = randomUUID()
  const lease = projectAccess.beginSession({ kind: 'manifest', projectId, rootPath: root })
  const session = { projectId, projectPath: root, leaseId: lease.leaseId }
  const volumeId = 'integration-volume'

  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-upsert', {
    id: volumeId, name: '集成卷', sortOrder: 1,
  }, root)).toEqual({ success: true })

  const firstOutline = await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-save', {
    volumeId, expectedRevision: 0, markdown: '初始卷纲\r\n保留换行。\r\n', origin: 'manual',
  }, root)
  expect(firstOutline).toMatchObject({ success: true, outline: { revision: 1, markdown: '初始卷纲\r\n保留换行。\r\n' } })
  if (!firstOutline.success) return
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-get', volumeId, root))
    .toMatchObject({ revision: 1, contentHash: blueprintPlanningSha256(firstOutline.outline.markdown) })
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-save', {
    volumeId, expectedRevision: 0, markdown: '旧 revision 不得覆盖', origin: 'manual',
  }, root)).toMatchObject({ success: false, code: 'REVISION_CONFLICT', current: { revision: 1 } })

  const sourceSnapshot = {
    snapshotId: 'ipc-volume-candidate-source-v1',
    targetKind: 'volume' as const,
    targetId: volumeId,
    targetRevision: 1,
    targetHash: firstOutline.outline.contentHash,
    sources: [],
  }
  const saved = await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-candidate-save', {
    operationId: 'ipc-volume-candidate', kind: 'volume-outline', scope: { kind: 'volume', volumeId },
    schemaVersion: 1, candidate: { volumeId, expectedRevision: 1, markdown: '模型初稿' }, sourceSnapshot,
  }, root)
  expect(saved).toMatchObject({ success: true, idempotent: false })
  if (!saved.success) return

  const updated = await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-candidate-update', {
    operationId: saved.candidate.operationId,
    expectedPayloadHash: saved.candidate.payloadHash,
    candidate: { volumeId, expectedRevision: 1, markdown: '作者修改并确认的卷纲' },
  }, root)
  expect(updated).toMatchObject({ success: true, candidate: { candidate: { markdown: '作者修改并确认的卷纲' } } })
  if (!updated.success) return

  const confirmation = {
    operationId: updated.candidate.operationId,
    expectedSourceSnapshot: updated.candidate.sourceSnapshot,
    selection: { targetVolumeId: volumeId },
  }
  const committed = await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-confirm', confirmation, root)
  expect(committed).toMatchObject({ success: true, receipt: { idempotent: false, selectedVolumeIds: [volumeId] } })
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-get', volumeId, root))
    .toMatchObject({ revision: 2, markdown: '作者修改并确认的卷纲', origin: 'ai' })
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-confirm', confirmation, root))
    .toMatchObject({ success: true, receipt: { idempotent: true } })

  const nextOutline = await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-get', volumeId, root)
  expect(nextOutline?.revision).toBe(2)
  if (!nextOutline) return
  const staleSnapshot = {
    snapshotId: 'ipc-volume-candidate-source-v2',
    targetKind: 'volume' as const,
    targetId: volumeId,
    targetRevision: nextOutline.revision,
    targetHash: nextOutline.contentHash,
    sources: [],
  }
  const staleCandidate = await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-candidate-save', {
    operationId: 'ipc-volume-stale-candidate', kind: 'volume-outline', scope: { kind: 'volume', volumeId },
    schemaVersion: 1, candidate: { volumeId, expectedRevision: nextOutline.revision, markdown: '过期候选' },
    sourceSnapshot: staleSnapshot,
  }, root)
  expect(staleCandidate.success).toBe(true)
  if (!staleCandidate.success) return

  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-save', {
    volumeId, expectedRevision: nextOutline.revision, markdown: '人工并发更新', origin: 'manual',
  }, root)).toMatchObject({ success: true, outline: { revision: 3 } })
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-confirm', {
    operationId: staleCandidate.candidate.operationId,
    expectedSourceSnapshot: staleCandidate.candidate.sourceSnapshot,
    selection: { targetVolumeId: volumeId },
  }, root)).toMatchObject({ success: false, code: 'STALE_SOURCE' })
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-candidate-get', staleCandidate.candidate.operationId, root))
    .toMatchObject({ state: 'stale' })
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-source-status', [staleSnapshot.snapshotId], root))
    .toEqual([{ snapshotId: staleSnapshot.snapshotId, state: 'stale' }])
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-target-source-status', [
    { targetKind: 'volume', targetId: volumeId },
  ], root)).toMatchObject([{ targetKind: 'volume', targetId: volumeId, state: 'stale' }])

  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-get', volumeId, root))
    .toMatchObject({ revision: 3, markdown: '人工并发更新', origin: 'manual' })
})

it('keeps book and volume planning records when the legacy chapter-blueprint clear channel runs', async () => {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-blueprint-clear-boundary-'))
  try {
    initProjectDatabase(isolatedRoot)
    const projectId = randomUUID()
    const lease = projectAccess.beginSession({ kind: 'manifest', projectId, rootPath: isolatedRoot })
    const session = { projectId, projectPath: isolatedRoot, leaseId: lease.leaseId }
    const volumeId = 'clear-boundary-volume'

    expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-upsert', {
      id: volumeId, name: '规划保留卷', sortOrder: 1,
    }, isolatedRoot)).toEqual({ success: true })
    const savedOutline = await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-save', {
      volumeId, expectedRevision: 0, markdown: '清空章细纲后仍保留的正式卷纲。', origin: 'manual',
    }, isolatedRoot)
    expect(savedOutline).toMatchObject({ success: true, outline: { revision: 1 } })
    if (!savedOutline.success) return

    const sourceSnapshot = {
      snapshotId: 'clear-boundary-candidate-source',
      targetKind: 'volume' as const,
      targetId: volumeId,
      targetRevision: 1,
      targetHash: savedOutline.outline.contentHash,
      sources: [],
    }
    const savedCandidate = await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-candidate-save', {
      operationId: 'clear-boundary-candidate', kind: 'volume-outline',
      scope: { kind: 'volume', volumeId }, schemaVersion: 1,
      candidate: { volumeId, expectedRevision: 1, markdown: '待审的卷纲候选' }, sourceSnapshot,
    }, isolatedRoot)
    expect(savedCandidate).toMatchObject({ success: true })
    if (!savedCandidate.success) return

    expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-clear-all', isolatedRoot))
      .toEqual({ success: true })
    expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-outline-get', volumeId, isolatedRoot))
      .toMatchObject({ revision: 1, markdown: '清空章细纲后仍保留的正式卷纲。' })
    expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-planning-candidate-get', 'clear-boundary-candidate', isolatedRoot))
      .toMatchObject({ state: 'candidate', candidate: { markdown: '待审的卷纲候选' } })
    expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-get-all', isolatedRoot)).toEqual([])
  } finally {
    closeProjectDatabase()
    projectAccess.invalidateCurrentSession()
    fs.rmSync(isolatedRoot, { recursive: true, force: true })
  }
})
