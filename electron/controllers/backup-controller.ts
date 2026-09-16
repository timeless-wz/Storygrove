import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { getCurrentProjectPath } from '../database'
import { externalFileGrants } from '../services/external-file-grant-service'
import { backupProject, restoreProject } from '../services/project-backup-service'
import { projectAccess } from '../services/project-access'
import { isProjectSessionContext } from '../../src/shared/project-session-context'

/** Project backup is deliberately a main-process operation over a short-lived directory grant. */
export function registerBackupController(): void {
  ipcMain.handle('project:backup', async (event: IpcMainInvokeEvent, grantId: string, candidate: unknown) => {
    try {
      const context = isProjectSessionContext(candidate) ? candidate : undefined
      const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
      if (typeof grantId !== 'string' || grantId.trim().length === 0) throw new Error('缺少备份目标授权')
      const destination = externalFileGrants.resolve({
        grantId,
        webContentsId: event.sender.id,
        operation: 'create',
      })
      if (destination.scope !== 'directory' || destination.relativePath !== '') {
        throw new Error('备份目标必须是已授权目录')
      }
      const manifest = backupProject(active.rootPath, destination.rootPath, active.projectId)
      return { success: true, backupId: manifest.backupId, fileCount: manifest.files.length }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * Import only an app-owned backup into a newly selected project directory.
   * This has no active-session or manuscript dependency: restoring is a
   * migration operation, and the service refuses to overwrite `.vela`.
   */
  ipcMain.handle('project:restore-backup', async (event: IpcMainInvokeEvent, backupGrantId: string, targetGrantId: string) => {
    try {
      if (typeof backupGrantId !== 'string' || typeof targetGrantId !== 'string' || !backupGrantId || !targetGrantId) {
        throw new Error('缺少恢复目录授权')
      }
      const backup = externalFileGrants.resolve({
        grantId: backupGrantId,
        webContentsId: event.sender.id,
        operation: 'read',
      })
      const target = externalFileGrants.resolve({
        grantId: targetGrantId,
        webContentsId: event.sender.id,
        operation: 'create',
      })
      if (backup.scope !== 'directory' || backup.relativePath !== '' || target.scope !== 'directory' || target.relativePath !== '') {
        throw new Error('恢复目录必须是已授权目录')
      }
      const manifest = restoreProject(backup.rootPath, target.rootPath)
      return { success: true, backupId: manifest.backupId, projectId: manifest.projectId, fileCount: manifest.files.length }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
