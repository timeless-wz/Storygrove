import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  rootPath: '',
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'zh-CN' },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

// 项目会话门禁由真实 utils 校验，这里只把「当前项目的根目录」接到测试夹具上。
vi.mock('../../services/project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext: vi.fn(() => ({ rootPath: mocks.rootPath })),
  },
}))

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { WorldMapRepository } from '../../repositories/world-map-repository'
import { registerWorldMapImageController } from '../world-map-image-controller'
import {
  nodeWorldMapImageFileSystem,
  readMapImageDataUrl,
  removeDeletedMapImages,
  type WorldMapImageFileSystem,
} from '../../services/world-map-image-store'
import type { ProjectSessionContext } from '../../../src/shared/ipc-channels'
import type { WorldMapImage } from '../../../src/shared/world-map'

const SUITE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-world-map-images-'))
const ORIGINAL_FILES = path.join(SUITE_ROOT, 'user-originals')

const MAP_A = 'map-a0000001-1111-4111-8111-111111111111'
const MAP_B = 'map-a0000002-2222-4222-8222-222222222222'

let projectRoot = ''
let projectBSessionCounter = 0

function handler(channel: string): IpcHandler {
  const registered = mocks.handlers.get(channel)
  if (!registered) throw new Error(`Missing IPC handler: ${channel}`)
  return registered
}

function event() {
  return { sender: { id: 17, once: vi.fn() } }
}

function sessionContext(projectPath: string): ProjectSessionContext {
  projectBSessionCounter += 1
  return { projectId: `project-${projectBSessionCounter}`, leaseId: `lease-${projectBSessionCounter}`, projectPath }
}

function writeOriginalImage(name: string, body: string): string {
  fs.mkdirSync(ORIGINAL_FILES, { recursive: true })
  const target = path.join(ORIGINAL_FILES, name)
  fs.writeFileSync(target, body)
  return target
}

function openProject(root: string): void {
  closeProjectDatabase()
  initProjectDatabase(root)
  mocks.rootPath = root
}

function createMap(mapId: string, name: string): void {
  WorldMapRepository.upsertMap({ id: mapId, name, parentMapId: null, sortOrder: 1, image: null })
}

function managedFiles(mapId: string): string[] {
  const directory = path.join(projectRoot, '.vela', 'world-maps', mapId)
  return fs.existsSync(directory) ? fs.readdirSync(directory) : []
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.showOpenDialog.mockReset()
  projectRoot = fs.mkdtempSync(path.join(SUITE_ROOT, 'case-'))
  openProject(projectRoot)
  createMap(MAP_A, '北境大陆地图')
  createMap(MAP_B, '白银城地图')
  registerWorldMapImageController()
})

afterAll(() => {
  closeProjectDatabase()
  // 同上的 Windows WAL 句柄保留问题：套件根目录位于系统临时目录，可安全放弃清理。
  try {
    fs.rmSync(SUITE_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // 交由操作系统回收临时目录。
  }
})

describe('per-map world map images', () => {
  it('imports a separate image for each map and keeps them independent', async () => {
    const originalA = writeOriginalImage('north.png', 'north-continent-image-bytes')
    const originalB = writeOriginalImage('silver.webp', 'silver-city-image-bytes')

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [originalA] })
    const importedA = await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as {
      success: boolean
      image: WorldMapImage
      dataUrl: string
    }
    expect(importedA.success).toBe(true)
    expect(importedA.image.mimeType).toBe('image/png')
    expect(importedA.dataUrl.startsWith('data:image/png;base64,')).toBe(true)

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [originalB] })
    const importedB = await handler('world-map-image:select-and-import')(event(), MAP_B, projectRoot, sessionContext(projectRoot)) as {
      success: boolean
      image: WorldMapImage
    }
    expect(importedB.success).toBe(true)
    expect(importedB.image.mimeType).toBe('image/webp')
    expect(importedB.image.fileName).not.toBe(importedA.image.fileName)

    // 两张地图各自持有自己的受控目录与文件。
    expect(managedFiles(MAP_A)).toEqual([importedA.image.fileName])
    expect(managedFiles(MAP_B)).toEqual([importedB.image.fileName])
    expect(fs.readFileSync(path.join(projectRoot, '.vela', 'world-maps', MAP_A, importedA.image.fileName)).toString())
      .toBe('north-continent-image-bytes')
    expect(fs.readFileSync(path.join(projectRoot, '.vela', 'world-maps', MAP_B, importedB.image.fileName)).toString())
      .toBe('silver-city-image-bytes')

    // 每张地图读回自己的图片。
    const readA = await handler('world-map-image:get')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage }
    const readB = await handler('world-map-image:get')(event(), MAP_B, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage }
    expect(readA.image.fileName).toBe(importedA.image.fileName)
    expect(readB.image.fileName).toBe(importedB.image.fileName)

    // 用户选择的原始图片从不被删除。
    expect(fs.existsSync(originalA)).toBe(true)
    expect(fs.readFileSync(originalA).toString()).toBe('north-continent-image-bytes')
    expect(fs.existsSync(originalB)).toBe(true)
  })

  it('replaces only the targeted map image and never touches the other map', async () => {
    const firstA = writeOriginalImage('north-v1.png', 'north-v1')
    const other = writeOriginalImage('silver-v1.png', 'silver-v1')
    const secondA = writeOriginalImage('north-v2.png', 'north-v2-image-bytes')

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [firstA] })
    const v1 = await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage }
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [other] })
    const otherImport = await handler('world-map-image:select-and-import')(event(), MAP_B, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage }

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [secondA] })
    const v2 = await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage }

    expect(v2.image.fileName).not.toBe(v1.image.fileName)
    // 被替换掉的只是 MAP_A 自己的旧托管副本。
    expect(managedFiles(MAP_A)).toEqual([v2.image.fileName])
    expect(fs.existsSync(path.join(projectRoot, '.vela', 'world-maps', MAP_A, v1.image.fileName))).toBe(false)
    // MAP_B 的图片与文件完全不受影响。
    expect(managedFiles(MAP_B)).toEqual([otherImport.image.fileName])
    expect(WorldMapRepository.getAll().maps.find(map => map.id === MAP_B)?.image?.fileName).toBe(otherImport.image.fileName)
    // 原始图片两个版本都还在。
    expect(fs.existsSync(firstA)).toBe(true)
    expect(fs.existsSync(secondA)).toBe(true)
  })

  it('removes only the targeted map image and leaves the original file in place', async () => {
    const originalA = writeOriginalImage('north.png', 'north-bytes')
    const originalB = writeOriginalImage('silver.png', 'silver-bytes')

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [originalA] })
    await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot))
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [originalB] })
    await handler('world-map-image:select-and-import')(event(), MAP_B, projectRoot, sessionContext(projectRoot))

    const removed = await handler('world-map-image:remove')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean }
    expect(removed.success).toBe(true)

    expect(managedFiles(MAP_A)).toEqual([])
    expect(WorldMapRepository.getAll().maps.find(map => map.id === MAP_A)?.image).toBeNull()
    // MAP_B 仍然完好。
    expect(managedFiles(MAP_B)).toHaveLength(1)
    expect(WorldMapRepository.getAll().maps.find(map => map.id === MAP_B)?.image).not.toBeNull()

    const readA = await handler('world-map-image:get')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage | null }
    expect(readA.image).toBeNull()

    expect(fs.existsSync(originalA)).toBe(true)
    expect(fs.existsSync(originalB)).toBe(true)
  })

  it('cancels without creating files or records', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const result = await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean; cancelled: boolean }
    expect(result).toEqual({ success: true, cancelled: true })
    expect(managedFiles(MAP_A)).toEqual([])
    expect(WorldMapRepository.getAll().maps.find(map => map.id === MAP_A)?.image).toBeNull()
  })

  it('rejects an unsupported image type without copying anything', async () => {
    const original = writeOriginalImage('notes.txt', 'not-an-image')
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [original] })
    const result = await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(managedFiles(MAP_A)).toEqual([])
    expect(fs.existsSync(original)).toBe(true)
  })

  it('refuses to touch a map that does not exist in the open project', async () => {
    const result = await handler('world-map-image:get')(event(), 'map-a0000999-9999-4999-8999-999999999999', projectRoot, sessionContext(projectRoot)) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('keeps each project’s map images isolated from one another', async () => {
    const projectB = fs.mkdtempSync(path.join(SUITE_ROOT, 'other-project-'))
    const originalA = writeOriginalImage('north.png', 'north-bytes-in-A')

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [originalA] })
    const importedA = await handler('world-map-image:select-and-import')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage }
    const fileA = path.join(projectRoot, '.vela', 'world-maps', MAP_A, importedA.image.fileName)
    expect(fs.existsSync(fileA)).toBe(true)

    // 切到另一个项目：A 的地图标识在这里完全不存在，读写都被拒绝。
    openProject(projectB)
    createMap(MAP_A, '同 id 但不同项目的地图')
    const crossProjectRead = await handler('world-map-image:get')(event(), MAP_A, projectB, sessionContext(projectB)) as { image: WorldMapImage | null }
    expect(crossProjectRead.image).toBeNull()
    expect(fs.existsSync(path.join(projectB, '.vela', 'world-maps', MAP_A))).toBe(false)

    // 回到项目 A：它的地图图片仍是原样。
    openProject(projectRoot)
    const readBack = await handler('world-map-image:get')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { image: WorldMapImage | null }
    expect(readBack.image?.fileName).toBe(importedA.image.fileName)
    expect(fs.readFileSync(fileA).toString()).toBe('north-bytes-in-A')
  })

  it('cleans managed copies from both the per-map and the legacy directory on map deletion', () => {
    const fileName = 'map-a0000003-3333-4333-8333-333333333333.png'
    const managed = path.join(projectRoot, '.vela', 'world-maps', MAP_A)
    const legacy = path.join(projectRoot, '.vela', 'world-map')
    fs.mkdirSync(managed, { recursive: true })
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(managed, fileName), 'managed')
    fs.writeFileSync(path.join(legacy, fileName), 'legacy-copy')

    removeDeletedMapImages(projectRoot, [{ mapId: MAP_A, fileName }])

    expect(fs.existsSync(path.join(managed, fileName))).toBe(false)
    expect(fs.existsSync(path.join(legacy, fileName))).toBe(false)
  })

  it('still reads a migrated image that only exists in the legacy managed directory', () => {
    const fileName = 'map-a0000004-4444-4444-8444-444444444444.png'
    const legacy = path.join(projectRoot, '.vela', 'world-map')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, fileName), 'legacy-bytes')

    const image: WorldMapImage = { fileName, mimeType: 'image/png', bytes: 'legacy-bytes'.length, updatedAt: 'x' }
    WorldMapRepository.saveMapImage(MAP_A, image)

    expect(readMapImageDataUrl(projectRoot, MAP_A, image))
      .toBe(`data:image/png;base64,${Buffer.from('legacy-bytes').toString('base64')}`)
    // 读取回退绝不删除或移动旧文件。
    expect(fs.existsSync(path.join(legacy, fileName))).toBe(true)
  })
})

/**
 * 失败路径专用：把某一次文件系统操作替换成真实抛错，其余操作仍然作用于真实文件。
 * 这样断言的是真实的文件状态，而不是对 mock 调用次数的猜测。
 */
function failingFileSystem(overrides: Partial<WorldMapImageFileSystem>): WorldMapImageFileSystem {
  return { ...nodeWorldMapImageFileSystem, ...overrides }
}

/** 让 world_maps 的图片元数据写入在真实 SQL 层失败（模拟磁盘/数据库写入错误）。 */
function armMapImageWriteFailure(): void {
  getProjectDb()!.exec(`
    CREATE TRIGGER map_image_write_failure BEFORE UPDATE OF image_file_name ON world_maps
    BEGIN SELECT RAISE(ABORT, 'simulated image metadata write failure'); END;
  `)
}

function disarmMapImageWriteFailure(): void {
  getProjectDb()!.exec('DROP TRIGGER IF EXISTS map_image_write_failure')
}

function mapImageDirectoryFiles(mapId: string): string[] {
  const directory = path.join(projectRoot, '.vela', 'world-maps', mapId)
  return fs.existsSync(directory) ? fs.readdirSync(directory) : []
}

function trashFiles(): string[] {
  const directory = path.join(projectRoot, '.vela', 'trash')
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return fs.readdirSync(entryPath).map(name => path.join(entryPath, name))
    return [entryPath]
  })
}

async function importImage(mapId: string, sourcePath: string): Promise<{ success: boolean; image?: WorldMapImage }> {
  mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [sourcePath] })
  return await handler('world-map-image:select-and-import')(event(), mapId, projectRoot, sessionContext(projectRoot)) as {
    success: boolean
    image?: WorldMapImage
  }
}

async function storedImage(mapId: string): Promise<WorldMapImage | null> {
  const result = await handler('world-map-image:get')(event(), mapId, projectRoot, sessionContext(projectRoot)) as {
    image: WorldMapImage | null
    dataUrl?: string
  }
  // 元数据有效就必须能读回实际图片，绝不允许指向不存在的文件。
  if (result.image) expect(result.dataUrl).toBeTruthy()
  return result.image
}

describe('world map image failure handling', () => {
  it('keeps the record and the file when the managed copy cannot be removed', async () => {
    const original = writeOriginalImage('north.png', 'north-bytes')
    const imported = await importImage(MAP_A, original)
    expect(imported.success).toBe(true)
    const fileName = imported.image!.fileName
    const managedPath = path.join(projectRoot, '.vela', 'world-maps', MAP_A, fileName)

    // 先把受控副本改名到恢复目录这一步就失败：数据库必须保持原样。
    registerWorldMapImageController(failingFileSystem({
      renameSync: () => { throw new Error('simulated rename failure') },
    }))
    const removed = await handler('world-map-image:remove')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as {
      success: boolean
      error?: string
    }

    expect(removed.success).toBe(false)
    // 记录没有被提前清空，文件也仍在原位，界面依旧可以管理它。
    expect(await storedImage(MAP_A)).toMatchObject({ fileName })
    expect(fs.existsSync(managedPath)).toBe(true)
    expect(trashFiles()).toEqual([])
    expect(fs.existsSync(original)).toBe(true)
    expect(await storedImage(MAP_B)).toBeNull()
  })

  it('restores the file name when clearing the image record fails in SQL', async () => {
    const original = writeOriginalImage('north.png', 'north-bytes')
    const imported = await importImage(MAP_A, original)
    const fileName = imported.image!.fileName
    const managedPath = path.join(projectRoot, '.vela', 'world-maps', MAP_A, fileName)

    armMapImageWriteFailure()
    try {
      const removed = await handler('world-map-image:remove')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean }
      expect(removed.success).toBe(false)

      // 数据库写入失败：文件名已恢复原状，元数据与文件继续一致。
      expect(fs.existsSync(managedPath)).toBe(true)
      expect(await storedImage(MAP_A)).toMatchObject({ fileName })
      // 恢复目录里不留下任何东西，这张地图的目录里也只有一个副本。
      expect(trashFiles()).toEqual([])
      expect(mapImageDirectoryFiles(MAP_A)).toEqual([fileName])
    } finally {
      disarmMapImageWriteFailure()
    }

    // 故障排除后同一个操作可以正常完成，不会再留下孤儿文件。
    const retried = await handler('world-map-image:remove')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean }
    expect(retried.success).toBe(true)
    expect(await storedImage(MAP_A)).toBeNull()
    expect(mapImageDirectoryFiles(MAP_A)).toEqual([])
    expect(trashFiles()).toEqual([])
    expect(fs.existsSync(original)).toBe(true)
  })

  it('restores both copies to their own directories when the legacy directory holds the same file name', async () => {
    const original = writeOriginalImage('north.png', 'north-bytes')
    const imported = await importImage(MAP_A, original)
    const fileName = imported.image!.fileName
    const managedPath = path.join(projectRoot, '.vela', 'world-maps', MAP_A, fileName)
    // 迁移完成前，旧扁平目录里可能同时留有一个同名副本。两份内容刻意不同，
    // 这样「各自归位」与「被对方的副本覆盖」可以区分开。
    const legacyDirectory = path.join(projectRoot, '.vela', 'world-map')
    fs.mkdirSync(legacyDirectory, { recursive: true })
    const legacyPath = path.join(legacyDirectory, fileName)
    fs.writeFileSync(legacyPath, 'legacy-directory-bytes')

    armMapImageWriteFailure()
    try {
      const removed = await handler('world-map-image:remove')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean }
      expect(removed.success).toBe(false)

      // 暂存必须为每个文件使用唯一名字，否则同名副本会在恢复目录里互相覆盖，
      // 导致其中一份内容丢失、甚至无法恢复回原目录。
      expect(fs.existsSync(managedPath)).toBe(true)
      expect(fs.readFileSync(managedPath).toString()).toBe('north-bytes')
      expect(fs.existsSync(legacyPath)).toBe(true)
      expect(fs.readFileSync(legacyPath).toString()).toBe('legacy-directory-bytes')
      // 数据库记录不变，图片仍然可管理。
      expect(await storedImage(MAP_A)).toMatchObject({ fileName })
      expect(mapImageDirectoryFiles(MAP_A)).toEqual([fileName])
      expect(trashFiles()).toEqual([])
    } finally {
      disarmMapImageWriteFailure()
    }
  })

  it('keeps a recoverable copy and never the user’s original when the final delete fails', async () => {
    const original = writeOriginalImage('north.png', 'north-bytes')
    await importImage(MAP_A, original)

    registerWorldMapImageController(failingFileSystem({
      unlinkSync: () => { throw new Error('simulated unlink failure') },
    }))
    const removed = await handler('world-map-image:remove')(event(), MAP_A, projectRoot, sessionContext(projectRoot)) as { success: boolean }

    // 元数据已经按作者意图清空，删不掉的副本留在项目内的恢复目录里，可人工找回。
    expect(removed.success).toBe(true)
    expect(await storedImage(MAP_A)).toBeNull()
    expect(mapImageDirectoryFiles(MAP_A)).toEqual([])
    // 暂存名字是唯一的（序号 + UUID + 原扩展名），因此用内容确认留下的正是这份副本。
    expect(trashFiles()).toHaveLength(1)
    expect(trashFiles()[0].endsWith('.png')).toBe(true)
    expect(fs.readFileSync(trashFiles()[0]).toString()).toBe('north-bytes')
    // 用户原始图片与其他地图都不受影响。
    expect(fs.existsSync(original)).toBe(true)
    expect(fs.readFileSync(original).toString()).toBe('north-bytes')
  })

  it('keeps the old image usable when replacing it fails to clean up the previous copy', async () => {
    const first = writeOriginalImage('north-v1.png', 'north-v1')
    const v1 = await importImage(MAP_A, first)
    const other = writeOriginalImage('silver.png', 'silver-bytes')
    const otherImage = await importImage(MAP_B, other)
    const second = writeOriginalImage('north-v2.png', 'north-v2-image-bytes')

    registerWorldMapImageController(failingFileSystem({
      unlinkSync: () => { throw new Error('simulated unlink failure') },
    }))
    const v2 = await importImage(MAP_A, second)

    // 新图必须可用，绝不能因为旧图清理失败而回滚。
    expect(v2.success).toBe(true)
    expect(v2.image!.fileName).not.toBe(v1.image!.fileName)
    expect(await storedImage(MAP_A)).toMatchObject({ fileName: v2.image!.fileName })
    expect(mapImageDirectoryFiles(MAP_A)).toEqual([v2.image!.fileName])
    // 旧副本只是被移进恢复目录，没有被抹掉。
    // 旧副本只是被移进恢复目录，内容与扩展名都保持原样。
    expect(trashFiles()).toHaveLength(1)
    expect(trashFiles()[0].endsWith('.png')).toBe(true)
    expect(fs.readFileSync(trashFiles()[0]).toString()).toBe('north-v1')
    // 其他地图与用户原始图片都完好。
    expect(await storedImage(MAP_B)).toMatchObject({ fileName: otherImage.image!.fileName })
    expect(fs.existsSync(first)).toBe(true)
    expect(fs.existsSync(second)).toBe(true)
  })

  it('keeps the previous image intact when the replacement cannot be recorded', async () => {
    const first = writeOriginalImage('north-v1.png', 'north-v1')
    const v1 = await importImage(MAP_A, first)
    const second = writeOriginalImage('north-v2.png', 'north-v2-image-bytes')

    armMapImageWriteFailure()
    try {
      const replaced = await importImage(MAP_A, second)
      expect(replaced.success).toBe(false)

      // 新图没能落库：旧图仍然可用，也没有留下新的无记录副本。
      expect(await storedImage(MAP_A)).toMatchObject({ fileName: v1.image!.fileName })
      expect(mapImageDirectoryFiles(MAP_A)).toEqual([v1.image!.fileName])
      expect(trashFiles()).toEqual([])
      expect(fs.existsSync(first)).toBe(true)
      expect(fs.existsSync(second)).toBe(true)
    } finally {
      disarmMapImageWriteFailure()
    }
  })
})
