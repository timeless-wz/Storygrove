import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  resolve: vi.fn(),
  restoreProject: vi.fn(),
  backupProject: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: Handler) => mocks.handlers.set(channel, handler)) },
}))
vi.mock('../../database', () => ({ getCurrentProjectPath: vi.fn() }))
vi.mock('../../services/external-file-grant-service', () => ({ externalFileGrants: { resolve: mocks.resolve } }))
vi.mock('../../services/project-backup-service', () => ({
  backupProject: mocks.backupProject,
  restoreProject: mocks.restoreProject,
}))
vi.mock('../../services/project-access', () => ({ projectAccess: { assertCurrentProjectContext: vi.fn() } }))

import { registerBackupController } from '../backup-controller'

const event = { sender: { id: 7 } }

describe('project backup restore controller', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.resolve.mockReset()
    mocks.restoreProject.mockReset()
    registerBackupController()
  })

  it('restores only between opaque directory grants and reports manifest metadata', async () => {
    mocks.resolve
      .mockReturnValueOnce({ scope: 'directory', relativePath: '', rootPath: 'C:\\backup' })
      .mockReturnValueOnce({ scope: 'directory', relativePath: '', rootPath: 'C:\\fresh-project' })
    mocks.restoreProject.mockReturnValue({ backupId: 'backup-1', projectId: 'novel-1', files: [{ relativePath: '.vela/vela.db' }] })

    const handler = mocks.handlers.get('project:restore-backup')
    await expect(handler?.(event, 'backup-grant', 'target-grant')).resolves.toEqual({
      success: true, backupId: 'backup-1', projectId: 'novel-1', fileCount: 1,
    })
    expect(mocks.resolve).toHaveBeenNthCalledWith(1, {
      grantId: 'backup-grant', webContentsId: 7, operation: 'read',
    })
    expect(mocks.resolve).toHaveBeenNthCalledWith(2, {
      grantId: 'target-grant', webContentsId: 7, operation: 'create',
    })
    expect(mocks.restoreProject).toHaveBeenCalledWith('C:\\backup', 'C:\\fresh-project')
  })

  it('rejects a file grant before it reaches the restore service', async () => {
    mocks.resolve
      .mockReturnValueOnce({ scope: 'file', relativePath: 'manifest.json', rootPath: 'C:\\backup' })
      .mockReturnValueOnce({ scope: 'directory', relativePath: '', rootPath: 'C:\\fresh-project' })
    const handler = mocks.handlers.get('project:restore-backup')
    await expect(handler?.(event, 'backup-grant', 'target-grant')).resolves.toMatchObject({ success: false })
    expect(mocks.restoreProject).not.toHaveBeenCalled()
  })
})
