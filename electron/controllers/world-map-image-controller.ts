import path from 'node:path'
import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isProjectSessionContext } from '../../src/shared/project-session-context'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { MAX_WORLD_MAP_IMAGE_BYTES } from '../../src/shared/world-map'
import { getCurrentProjectPath } from '../database'
import { WorldMapRepository } from '../repositories/world-map-repository'
import { projectAccess } from '../services/project-access'
import {
  copyImageIntoMapDirectory,
  finalizeStagedMapImageRemoval,
  nodeWorldMapImageFileSystem,
  readMapImageDataUrl,
  readSourceImageStats,
  removeMapImageCopies,
  resolveImageMimeType,
  restoreStagedMapImageRemoval,
  stageMapImageRemoval,
  type StagedMapImageCopy,
  type WorldMapImageFileSystem,
} from '../services/world-map-image-store'
import { mainText } from '../i18n'
import { assertRequiredExpectedProjectPath } from '../utils/project-context'

function text(zhCNText: string, enUSText: string): string {
  return mainText(app.getLocale(), zhCNText, enUSText)
}

function activeRoot(context: ProjectSessionContext, expectedProjectPath: string): string {
  const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
  assertRequiredExpectedProjectPath(active.rootPath, expectedProjectPath)
  return active.rootPath
}

function registerProjectMapImageHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, context: ProjectSessionContext, ...args: string[]) => Promise<unknown>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const context = args.at(-1)
    if (!isProjectSessionContext(context)) return { success: false, error: text('项目会话已失效，请重新打开项目。', 'The project session has expired. Reopen the project.') }
    args.pop()
    try {
      return await handler(event, context, ...(args as string[]))
    } catch (error) {
      console.error(`[WorldMapImage] ${channel} failed`, error)
      return { success: false, error: text('无法完成地图图片操作。', 'Could not complete the map image operation.') }
    }
  })
}

/** 读取一张地图自己的图片；对每一张地图独立生效，互不影响。 */
function getMapImage(rootPath: string, mapId: string, fileSystem: WorldMapImageFileSystem) {
  const map = WorldMapRepository.getAll().maps.find(candidate => candidate.id === mapId)
  if (!map) return { success: false, error: text('地图不存在。', 'The map does not exist.') }
  if (!map.image) return { success: true, image: null, dataUrl: undefined }
  const dataUrl = readMapImageDataUrl(rootPath, map.id, map.image, fileSystem)
  if (dataUrl) return { success: true, image: map.image, dataUrl }
  // 项目托管副本已丢失（例如被外部清理）：清掉元数据，界面回到「未导入图片」。
  WorldMapRepository.saveMapImage(map.id, null)
  return { success: true, image: null, dataUrl: undefined }
}

/**
 * 每张地图独立持有一张项目托管图片。导入只把用户选择的原始文件复制进该地图自己的
 * 受控目录，替换只清理该地图此前的托管副本，绝不触碰其他地图，也绝不删除原始文件。
 */
export function registerWorldMapImageController(
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): void {
  registerProjectMapImageHandler('world-map-image:get', async (_event, context, mapId: string, expectedProjectPath: string) => {
    const rootPath = activeRoot(context, expectedProjectPath)
    return getMapImage(rootPath, mapId, fileSystem)
  })

  registerProjectMapImageHandler('world-map-image:select-and-import', async (_event, context, mapId: string, expectedProjectPath: string) => {
    const rootPath = activeRoot(context, expectedProjectPath)
    const target = WorldMapRepository.getAll().maps.find(map => map.id === mapId)
    if (!target) return { success: false, error: text('地图不存在。', 'The map does not exist.') }

    const selection = await dialog.showOpenDialog({
      title: text(`为「${target.name}」导入地图图片`, `Import an image for “${target.name}”`),
      properties: ['openFile'],
      filters: [{ name: text('地图图片', 'Map images'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (selection.canceled || selection.filePaths.length === 0) return { success: true, cancelled: true }

    const source = selection.filePaths[0]
    const extension = path.extname(source).toLocaleLowerCase('en-US')
    const mimeType = resolveImageMimeType(source)
    const stats = readSourceImageStats(source, fileSystem)
    if (!mimeType || !stats.isFile() || stats.size <= 0 || stats.size > MAX_WORLD_MAP_IMAGE_BYTES) {
      return { success: false, error: text('请选择不超过 32 MB 的 PNG、JPG 或 WebP 图片。', 'Choose a PNG, JPG or WebP image no larger than 32 MB.') }
    }

    const previous = target.image
    const image = copyImageIntoMapDirectory(rootPath, target.id, source, extension, fileSystem)

    try {
      activeRoot(context, expectedProjectPath)
      WorldMapRepository.saveMapImage(target.id, image)
    } catch (error) {
      // 新图没能落库：只清掉这张地图刚写下的新副本，旧图与旧元数据完全不受影响。
      removeMapImageCopies(rootPath, target.id, [image.fileName], fileSystem)
      throw error
    }

    // 新图已经落库并可用，此时才允许清理这张地图此前的托管副本。清理失败只会
    // 留下一个可恢复副本，绝不影响新图的可用性，也绝不回滚新元数据。
    if (previous && previous.fileName !== image.fileName) {
      try {
        const staged = stageMapImageRemoval(rootPath, target.id, [previous.fileName], fileSystem)
        const remaining = finalizeStagedMapImageRemoval(staged, fileSystem)
        if (remaining > 0) {
          console.warn('[WorldMapImage] 被替换的图片副本未能删除，已保留在项目恢复目录中', {
            mapId: target.id,
            fileName: previous.fileName,
          })
        }
      } catch (error) {
        console.warn('[WorldMapImage] 被替换的图片副本未能清理，已保留原文件', target.id, error)
      }
    }

    return { success: true, image, dataUrl: readMapImageDataUrl(rootPath, target.id, image, fileSystem) ?? undefined }
  })

  /**
   * 移除图片是一致性操作：先把受控副本改名进项目内的恢复目录，数据库成功清空元数据后
   * 才正式删除。改名失败则整个操作中止，元数据与文件都保持原样；数据库写入失败则把
   * 文件名恢复原状；正式删除失败只留下可恢复副本。任何一步都不会碰用户原始图片。
   */
  registerProjectMapImageHandler('world-map-image:remove', async (_event, context, mapId: string, expectedProjectPath: string) => {
    const rootPath = activeRoot(context, expectedProjectPath)
    const target = WorldMapRepository.getAll().maps.find(map => map.id === mapId)
    if (!target) return { success: false, error: text('地图不存在。', 'The map does not exist.') }
    if (!target.image) return { success: true }

    let staged: StagedMapImageCopy[]
    try {
      staged = stageMapImageRemoval(rootPath, target.id, [target.image.fileName], fileSystem)
    } catch (error) {
      console.error('[WorldMapImage] 地图图片副本无法暂存，已保留原有记录', error)
      return {
        success: false,
        error: text('无法移除地图图片：受控副本无法移动到恢复目录，原有图片记录已保留。', 'Could not remove the map image: the managed copy could not be moved, so the existing record was kept.'),
      }
    }

    try {
      activeRoot(context, expectedProjectPath)
      WorldMapRepository.saveMapImage(target.id, null)
    } catch (error) {
      // 数据库没有清空成功：把文件名恢复原状，元数据与文件继续保持一致。
      restoreStagedMapImageRemoval(staged, fileSystem)
      throw error
    }

    const remaining = finalizeStagedMapImageRemoval(staged, fileSystem)
    if (remaining > 0) {
      console.warn('[WorldMapImage] 已移除记录，但受控副本未能删除，已保留在项目恢复目录中', {
        mapId: target.id,
        fileName: target.image.fileName,
      })
    }
    return { success: true }
  })
}
