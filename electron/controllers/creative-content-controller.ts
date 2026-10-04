import { ipcMain } from 'electron'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import type {
  CreativeLegacyOrganizationInput,
  CreativeMaterialSaveInput,
} from '../../src/shared/creative-content'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import { CreativeContentRepository } from '../repositories/creative-content-repository'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { assertRequiredExpectedProjectPath } from '../utils/project-context'

function registerProjectHandler(
  channel: string,
  handler: (projectId: string, projectPath: string, context: ProjectSessionContext, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...incoming: unknown[]) => {
    const context = incoming.at(-1)
    if (!isProjectSessionContext(context)) throw new Error('缺少冻结的项目会话')
    incoming.pop()
    const currentPath = getCurrentProjectPath()
    const session = projectAccess.assertCurrentProjectContext(context, currentPath)
    assertRequiredExpectedProjectPath(currentPath, context.projectPath)
    return handler(session.projectId, session.rootPath, context, ...incoming)
  })
}

export function registerCreativeContentController(): void {
  registerProjectHandler('db:creative-legacy-list', (_projectId, _projectPath, _context, expectedPath) => {
    if (typeof expectedPath !== 'string') throw new Error('缺少项目路径')
    assertRequiredExpectedProjectPath(getCurrentProjectPath(), expectedPath)
    const core = ProjectCoreRepository.get()
    return core ? CreativeContentRepository.listLegacySources(core) : []
  })

  registerProjectHandler('db:creative-legacy-organize', (_projectId, _projectPath, _context, rawInput, expectedPath) => {
    if (typeof expectedPath !== 'string') throw new Error('缺少项目路径')
    assertRequiredExpectedProjectPath(getCurrentProjectPath(), expectedPath)
    CreativeContentRepository.organizeLegacySource(rawInput as CreativeLegacyOrganizationInput)
    return { success: true }
  })

  registerProjectHandler('db:creative-material-list', (_projectId, _projectPath, _context, rawFilter, expectedPath) => {
    if (typeof expectedPath !== 'string') throw new Error('缺少项目路径')
    assertRequiredExpectedProjectPath(getCurrentProjectPath(), expectedPath)
    const filter = rawFilter && typeof rawFilter === 'object' && !Array.isArray(rawFilter)
      ? rawFilter as { entryKind?: 'material' | 'retired' | 'issue'; status?: 'candidate' | 'adopted' | 'rejected' | 'open' | 'resolved' | 'retired' }
      : undefined
    return CreativeContentRepository.listMaterials(filter)
  })

  registerProjectHandler('db:creative-material-save', (_projectId, _projectPath, _context, rawInput, expectedPath) => {
    try {
      if (typeof expectedPath !== 'string') throw new Error('缺少项目路径')
      assertRequiredExpectedProjectPath(getCurrentProjectPath(), expectedPath)
      return { success: true, entry: CreativeContentRepository.saveMaterial(rawInput as CreativeMaterialSaveInput) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
