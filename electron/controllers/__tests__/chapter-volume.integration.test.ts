import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { initProjectDatabase, closeProjectDatabase } from '../../database'
import { projectAccess } from '../../services/project-access'
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-volume-ipc-'))
  registerDatabaseController()
  vi.stubGlobal('window', { velaAPI: { invoke: async (channel: string, ...args: unknown[]) => {
    const handler = bridge.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler ${channel}`)
    return handler({ sender: { id: 1 } }, ...args)
  } } })
})
afterAll(() => { closeProjectDatabase(); projectAccess.invalidateCurrentSession(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }) })

it('runs volume creation, free chapter creation and moving through session-gated IPC and rejects old leases', async () => {
  initProjectDatabase(root)
  const projectId = randomUUID()
  const lease = projectAccess.beginSession({ kind: 'manifest', projectId, rootPath: root })
  const session = { projectId, projectPath: root, leaseId: lease.leaseId }
  expect(await ipc.invokeWithProjectSession(session, 'db:blueprint-volume-upsert', { id: 'first', name: '第1卷', sortOrder: 1 }, root)).toEqual({ success: true })
  const created = await ipc.invokeWithProjectSession(session, 'db:draft-create', { chapterNumber: 1, volumeId: 'first', chapterTitle: '独立章名', version: 1, source: 'write', content: '独立正文', wordCount: 4 }, root)
  expect(created.success).toBe(true)
  expect(await ipc.invokeWithProjectSession(session, 'db:chapter-volume-list', root)).toEqual([{ chapterNumber: 1, volumeId: 'first' }])
  expect(await ipc.invokeWithProjectSession(session, 'db:chapter-volume-set', 1, null, root)).toEqual({ success: true })
  closeProjectDatabase()
  initProjectDatabase(root)
  expect(await ipc.invokeWithProjectSession(session, 'db:chapter-volume-list', root)).toEqual([{ chapterNumber: 1, volumeId: null }])
  expect(await ipc.invokeWithProjectSession(session, 'db:draft-get-full', created.id!, root)).toMatchObject({ content: '独立正文', status: 'draft', chapterTitle: '独立章名' })
  expect(await ipc.invokeWithProjectSession(session, 'db:prose-directory-action', { type: 'rename-draft', draftId: created.id!, name: '新名称' }, root)).toMatchObject({ success: true })
  const trashed = await ipc.invokeWithProjectSession(session, 'db:prose-directory-action', { type: 'trash-draft', draftId: created.id! }, root)
  expect(trashed).toMatchObject({ success: true })
  expect(await ipc.invokeWithProjectSession(session, 'db:draft-list-all', root)).toEqual([])
  expect(await ipc.invokeWithProjectSession(session, 'db:prose-trash', root)).toHaveLength(1)
  expect(await ipc.invokeWithProjectSession(session, 'db:prose-directory-action', { type: 'restore', trashId: trashed.trashId! }, root)).toMatchObject({ success: true })
  expect((await ipc.invokeWithProjectSession(session, 'db:draft-get-full', created.id!, root))?.chapterTitle).toBe('新名称')
  expect(await ipc.invokeWithProjectSession(session, 'db:prose-volume-delete', 'first', root)).toEqual({ success: true })
  expect((await ipc.invokeWithProjectSession(session, 'db:prose-volume-list', root)).map(volume => volume.id)).not.toContain('first')
  projectAccess.beginSession({ kind: 'manifest', projectId, rootPath: root })
  expect(await ipc.invokeWithProjectSession(session, 'db:chapter-volume-set', 1, 'first', root)).toMatchObject({ success: false })
  await expect(ipc.invokeWithProjectSession(session, 'db:chapter-volume-list', root)).rejects.toThrow()
  expect(await ipc.invokeWithProjectSession(session, 'db:prose-volume-delete', 'volume-1', root)).toMatchObject({ success: false })
  expect(await ipc.invokeWithProjectSession(session, 'db:prose-directory-action', { type: 'trash-draft', draftId: created.id! }, root)).toMatchObject({ success: false })
})
