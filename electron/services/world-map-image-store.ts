import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  LEGACY_WORLD_MAP_DIRECTORY,
  MAX_WORLD_MAP_IMAGE_BYTES,
  WORLD_MAP_IMAGE_MIME_TYPES,
  WORLD_MAPS_DIRECTORY,
  isSafeWorldMapId,
  isSafeWorldMapImageFileName,
  type WorldMapImage,
} from '../../src/shared/world-map'
import { assertProjectFilePath } from '../utils/project-context'

/**
 * 每张地图的图片都保存在项目受控目录 `.vela/world-maps/<map-id>/`。
 * 用户选择的原始图片只被读取，永不删除、永不把绝对路径交给渲染层。
 *
 * 文件系统操作通过 {@link WorldMapImageFileSystem} 注入，测试可以替换单个操作
 * 来真实复现复制、校验、改名、删除失败，而不必伪造整个文件系统。
 */

export interface WorldMapImageFileSystem {
  existsSync(targetPath: string): boolean
  mkdirSync(directoryPath: string): void
  copyFileSync(sourcePath: string, targetPath: string, options?: { exclusive?: boolean }): void
  statSync(targetPath: string): { isFile(): boolean; size: number }
  readFileSync(targetPath: string): Buffer
  unlinkSync(targetPath: string): void
  renameSync(fromPath: string, toPath: string): void
  readdirSync(directoryPath: string): string[]
  rmdirSync(directoryPath: string): void
}

export const nodeWorldMapImageFileSystem: WorldMapImageFileSystem = {
  existsSync: targetPath => fs.existsSync(targetPath),
  mkdirSync: directoryPath => { fs.mkdirSync(directoryPath, { recursive: true }) },
  copyFileSync: (sourcePath, targetPath, options) => {
    fs.copyFileSync(sourcePath, targetPath, options?.exclusive ? fs.constants.COPYFILE_EXCL : 0)
  },
  statSync: targetPath => fs.statSync(targetPath),
  readFileSync: targetPath => fs.readFileSync(targetPath),
  unlinkSync: targetPath => { fs.unlinkSync(targetPath) },
  renameSync: (fromPath, toPath) => { fs.renameSync(fromPath, toPath) },
  readdirSync: directoryPath => fs.readdirSync(directoryPath),
  rmdirSync: directoryPath => { fs.rmdirSync(directoryPath) },
}

/** 项目内的恢复目录；与 project-clear 的软删除暂存区保持同一约定。 */
export const WORLD_MAP_IMAGE_TRASH_DIRECTORY = '.vela/trash'

export function mapImageDirectory(rootPath: string, mapId: string): string {
  if (!isSafeWorldMapId(mapId)) throw new Error('地图标识无效，已拒绝访问地图图片目录')
  return path.join(rootPath, WORLD_MAPS_DIRECTORY, mapId)
}

function legacyDirectory(rootPath: string): string {
  return path.join(rootPath, LEGACY_WORLD_MAP_DIRECTORY)
}

function assertReadableFile(
  filePath: string,
  rootPath: string,
  fileSystem: WorldMapImageFileSystem,
): { isFile(): boolean; size: number } | null {
  try {
    assertProjectFilePath(filePath, rootPath, 'existing')
    const stats = fileSystem.statSync(filePath)
    return stats.isFile() ? stats : null
  } catch {
    return null
  }
}

/**
 * 读取迁移前遗留在旧扁平目录中的托管副本。旧项目只把文件搬过一次，这里作为
 * 兜底读取路径，避免迁移搬运失败时图片从界面上消失。只读，绝不移动或删除。
 */
function readLegacyManagedPath(
  rootPath: string,
  image: WorldMapImage,
  fileSystem: WorldMapImageFileSystem,
): string | null {
  if (!isSafeWorldMapImageFileName(image.fileName)) return null
  const candidate = path.join(legacyDirectory(rootPath), image.fileName)
  const stats = assertReadableFile(candidate, rootPath, fileSystem)
  if (!stats || stats.size !== image.bytes || stats.size > MAX_WORLD_MAP_IMAGE_BYTES) return null
  return candidate
}

/** 读取一张地图自己的图片；只返回 data URL，不暴露任何文件系统路径。 */
export function readMapImageDataUrl(
  rootPath: string,
  mapId: string,
  image: WorldMapImage,
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): string | null {
  if (!isSafeWorldMapId(mapId) || !isSafeWorldMapImageFileName(image.fileName)) return null
  const managed = path.join(mapImageDirectory(rootPath, mapId), image.fileName)
  const managedStats = assertReadableFile(managed, rootPath, fileSystem)
  if (managedStats && managedStats.size === image.bytes && managedStats.size <= MAX_WORLD_MAP_IMAGE_BYTES) {
    return `data:${image.mimeType};base64,${fileSystem.readFileSync(managed).toString('base64')}`
  }
  const legacy = readLegacyManagedPath(rootPath, image, fileSystem)
  if (!legacy) return null
  return `data:${image.mimeType};base64,${fileSystem.readFileSync(legacy).toString('base64')}`
}

export function resolveImageMimeType(sourcePath: string): string | null {
  return WORLD_MAP_IMAGE_MIME_TYPES[path.extname(sourcePath).toLocaleLowerCase('en-US')] ?? null
}

export function readSourceImageStats(sourcePath: string, fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem): { isFile(): boolean; size: number } {
  return fileSystem.statSync(sourcePath)
}

/**
 * 把用户选择的图片复制进该地图自己的受控目录。目标文件名为新的 `map-<uuid><ext>`，
 * 因此替换图片不会覆盖或影响任何其他地图的图片。
 */
export function copyImageIntoMapDirectory(
  rootPath: string,
  mapId: string,
  sourcePath: string,
  extension: string,
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): WorldMapImage {
  const directory = mapImageDirectory(rootPath, mapId)
  assertProjectFilePath(directory, rootPath, 'writable')
  fileSystem.mkdirSync(directory)
  assertProjectFilePath(directory, rootPath, 'existing')

  const fileName = `map-${randomUUID()}${extension}`
  const target = path.join(directory, fileName)
  assertProjectFilePath(target, rootPath, 'writable')
  try {
    fileSystem.copyFileSync(sourcePath, target, { exclusive: true })
    const copied = fileSystem.statSync(target)
    if (!copied.isFile() || copied.size <= 0 || copied.size > MAX_WORLD_MAP_IMAGE_BYTES) {
      throw new Error('复制后的地图图片无效')
    }
    return { fileName, mimeType: WORLD_MAP_IMAGE_MIME_TYPES[extension], bytes: copied.size, updatedAt: new Date().toISOString() }
  } catch (error) {
    // 失败时只清掉这张地图自己刚写下的新副本；其他地图与用户原始图片都不受影响。
    removeMapImageCopies(rootPath, mapId, [fileName], fileSystem)
    throw error
  }
}

interface MapImageCopyScope {
  mapId: string
  fileNames: string[]
  includeLegacyDirectory: boolean
}

/** 列出给定范围内实际存在的受控副本路径；不存在的范围直接跳过，不抛错。 */
function existingManagedCopyPaths(
  rootPath: string,
  scope: MapImageCopyScope,
  fileSystem: WorldMapImageFileSystem,
): string[] {
  const paths: string[] = []
  const directories = [mapImageDirectory(rootPath, scope.mapId)]
  if (scope.includeLegacyDirectory) directories.push(legacyDirectory(rootPath))
  for (const fileName of scope.fileNames) {
    if (!isSafeWorldMapImageFileName(fileName)) continue
    for (const directory of directories) {
      const target = path.join(directory, fileName)
      if (!fileSystem.existsSync(target)) continue
      assertProjectFilePath(target, rootPath, 'existing')
      paths.push(target)
    }
  }
  return paths
}

function unlinkManagedCopies(paths: string[], fileSystem: WorldMapImageFileSystem): void {
  for (const target of paths) {
    try {
      fileSystem.unlinkSync(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/**
 * 直接删除这张地图自己目录下的受控副本。只用于可以安全丢弃的文件（例如刚写入、
 * 尚未被任何记录引用的新副本回滚）。
 *
 * 刻意不触碰旧版扁平目录 `.vela/world-map/`：那里的文件是尚未完成的迁移的源文件，
 * 删掉它会让旧底图无法再访问、迁移也无法重试。需要清理迁移源时请使用
 * {@link stageLegacyMapImageRemoval}。
 */
export function removeMapImageCopies(
  rootPath: string,
  mapId: string,
  fileNames: string[],
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): void {
  if (!isSafeWorldMapId(mapId)) return
  unlinkManagedCopies(
    existingManagedCopyPaths(rootPath, { mapId, fileNames, includeLegacyDirectory: false }, fileSystem),
    fileSystem,
  )
}

/**
 * 只在目录已经空了的时候移除它；非空或目录不存在都不是错误状态。
 * 用于「副本尚未提交就被放弃」的场景，避免留下无记录的空目录。
 */
export function pruneEmptyMapImageDirectory(
  rootPath: string,
  mapId: string,
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): void {
  if (!isSafeWorldMapId(mapId)) return
  const directory = mapImageDirectory(rootPath, mapId)
  try {
    if (!fileSystem.existsSync(directory)) return
    assertProjectFilePath(directory, rootPath, 'existing')
    if (fileSystem.readdirSync(directory).length > 0) return
    fileSystem.rmdirSync(directory)
  } catch (error) {
    console.warn('[WorldMapImage] 清理空的地图图片目录失败', directory, error)
  }
}

export interface StagedMapImageCopy {
  /** 暂存前的受控路径。 */
  from: string
  /** 项目内的恢复路径；正式删除前一直存在，可用于恢复文件名。 */
  to: string
}

function newTrashDirectory(rootPath: string): string {
  return path.join(rootPath, WORLD_MAP_IMAGE_TRASH_DIRECTORY, `world-map-image-${randomUUID()}`)
}

/**
 * 恢复目录里的暂存名字。
 *
 * 同一张图片可能同时存在于 `.vela/world-maps/<map-id>/` 和迁移前的 `.vela/world-map/`，
 * 两个路径的 basename 完全相同。因此暂存名字绝不能只取 basename：那会让后一份副本
 * 覆盖前一份，既丢掉内容，也让恢复时第二次改名找不到文件。序号 + UUID 保证每次暂存
 * 名字唯一，同时保留扩展名便于人工辨认。
 */
function stagedFileName(source: string, index: number): string {
  return `${index + 1}-${randomUUID()}${path.extname(source)}`
}

/**
 * 把受控副本改名进项目内的恢复目录。改名本身失败时，先把已经改名的文件还原回去，
 * 再抛错，让调用方在「文件与数据库都保持原样」的前提下中止操作。
 */
function stageManagedCopies(
  rootPath: string,
  paths: string[],
  fileSystem: WorldMapImageFileSystem,
): StagedMapImageCopy[] {
  const staged: StagedMapImageCopy[] = []
  let trashDirectory: string | null = null
  try {
    for (const [index, source] of paths.entries()) {
      if (!trashDirectory) {
        trashDirectory = newTrashDirectory(rootPath)
        assertProjectFilePath(trashDirectory, rootPath, 'writable')
        fileSystem.mkdirSync(trashDirectory)
        assertProjectFilePath(trashDirectory, rootPath, 'existing')
      }
      const target = path.join(trashDirectory, stagedFileName(source, index))
      fileSystem.renameSync(source, target)
      staged.push({ from: source, to: target })
    }
    return staged
  } catch (error) {
    restoreStagedMapImageRemoval(staged, fileSystem)
    throw error
  }
}

/** 暂存这张地图自己的受控副本（含迁移前遗留在旧扁平目录中的同名副本）。 */
export function stageMapImageRemoval(
  rootPath: string,
  mapId: string,
  fileNames: string[],
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): StagedMapImageCopy[] {
  if (!isSafeWorldMapId(mapId)) throw new Error('地图标识无效，已拒绝访问地图图片目录')
  return stageManagedCopies(
    rootPath,
    existingManagedCopyPaths(rootPath, { mapId, fileNames, includeLegacyDirectory: true }, fileSystem),
    fileSystem,
  )
}

/** 只暂存旧版扁平目录中的副本；迁移收尾绝不能碰新目录里的权威副本。 */
export function stageLegacyMapImageRemoval(
  rootPath: string,
  fileNames: string[],
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): StagedMapImageCopy[] {
  const paths = fileNames
    .filter(fileName => isSafeWorldMapImageFileName(fileName))
    .map(fileName => path.join(legacyDirectory(rootPath), fileName))
    .filter(target => fileSystem.existsSync(target))
    .map(target => {
      assertProjectFilePath(target, rootPath, 'existing')
      return target
    })
  return stageManagedCopies(rootPath, paths, fileSystem)
}

/**
 * 数据库写入失败时把文件名恢复原状。父目录不存在会先补建，尽最大努力让
 * 元数据与文件重新对齐；恢复本身失败也不抛错，由调用方保留原始错误。
 */
export function restoreStagedMapImageRemoval(
  staged: StagedMapImageCopy[],
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): void {
  for (const entry of staged) {
    try {
      if (fileSystem.existsSync(entry.from)) continue
      fileSystem.mkdirSync(path.dirname(entry.from))
      fileSystem.renameSync(entry.to, entry.from)
    } catch (error) {
      console.error('[WorldMapImage] 恢复受控副本失败', entry, error)
    }
  }
}

/**
 * 正式删除已暂存副本，并清理因此产生的空恢复目录。
 *
 * 返回仍然没能删除的文件数量。这里刻意不抛错：调用方通常已经提交了数据库写入，
 * 抛错会让上层误以为操作整体失败。删不掉的副本留在恢复目录中，仍然可人工找回。
 */
export function finalizeStagedMapImageRemoval(
  staged: StagedMapImageCopy[],
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): number {
  let remaining = 0
  const directories = new Set<string>()
  for (const entry of staged) {
    directories.add(path.dirname(entry.to))
    try {
      fileSystem.unlinkSync(entry.to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        remaining += 1
        // 暂存名字是唯一的，因此日志必须同时给出原路径，才能人工定位留下的副本。
        console.warn('[WorldMapImage] 受控副本未能删除，已保留在恢复目录中', { from: entry.from, retainedAt: entry.to }, error)
      }
    }
  }
  for (const directory of directories) {
    try {
      if (fileSystem.readdirSync(directory).length === 0) fileSystem.rmdirSync(directory)
    } catch {
      // 目录非空或已被清理：都不是错误状态。
    }
  }
  return remaining
}

/** 删除地图之后清理它们的托管图片副本；失败只留下可恢复副本，绝不影响其他地图。 */
export function removeDeletedMapImages(
  rootPath: string,
  images: Array<{ mapId: string; fileName: string }>,
  fileSystem: WorldMapImageFileSystem = nodeWorldMapImageFileSystem,
): void {
  for (const image of images) {
    try {
      const staged = stageMapImageRemoval(rootPath, image.mapId, [image.fileName], fileSystem)
      finalizeStagedMapImageRemoval(staged, fileSystem)
    } catch (error) {
      console.error('[WorldMapImage] 清理已删除地图的托管副本失败', error)
    }
  }
}
