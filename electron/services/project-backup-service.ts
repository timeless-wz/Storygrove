import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export interface ProjectBackupManifest {
  format: 'ai-novel-writer-backup'
  version: 1
  backupId: string
  createdAt: string
  projectId: string
  files: Array<{ relativePath: string; sha256: string; bytes: number }>
}

function digest(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function copyFile(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function collectFiles(root: string, relative = ''): string[] {
  const directory = path.join(root, relative)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const next = path.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error('备份中不能包含符号链接')
    return entry.isDirectory() ? collectFiles(root, next) : [next]
  })
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function validatedManifest(value: unknown): ProjectBackupManifest {
  if (!value || typeof value !== 'object') throw new Error('备份清单无效')
  const manifest = value as Partial<ProjectBackupManifest>
  if (
    manifest.format !== 'ai-novel-writer-backup'
    || manifest.version !== 1
    || typeof manifest.backupId !== 'string'
    || typeof manifest.createdAt !== 'string'
    || typeof manifest.projectId !== 'string'
    || !Array.isArray(manifest.files)
  ) throw new Error('备份清单无效')
  const seen = new Set<string>()
  for (const entry of manifest.files) {
    if (
      !entry || typeof entry !== 'object'
      || typeof entry.relativePath !== 'string'
      || !entry.relativePath.startsWith('.vela/')
      || entry.relativePath.includes('\\')
      || entry.relativePath.split('/').some(part => part.length === 0 || part === '.' || part === '..')
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || seen.has(entry.relativePath)
    ) throw new Error('备份清单无效')
    seen.add(entry.relativePath)
  }
  return manifest as ProjectBackupManifest
}

/** Backs up project-owned state only; a linked manuscript is never copied or modified. */
export function backupProject(projectPath: string, destinationPath: string, projectId = 'main'): ProjectBackupManifest {
  const sourceRoot = path.resolve(projectPath)
  const destination = path.resolve(destinationPath)
  if (!fs.existsSync(path.join(sourceRoot, '.vela'))) throw new Error('项目尚未初始化')
  if (destination === sourceRoot || destination.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('备份目标不能位于项目目录内')
  fs.mkdirSync(destination, { recursive: true })
  const files = collectFiles(path.join(sourceRoot, '.vela')).filter(relative => !relative.includes(`${path.sep}tmp${path.sep}`))
  const entries = files.map(relative => {
    const source = path.join(sourceRoot, '.vela', relative)
    const targetRelative = path.join('.vela', relative)
    copyFile(source, path.join(destination, targetRelative))
    const stat = fs.statSync(source)
    return { relativePath: targetRelative.replaceAll(path.sep, '/'), sha256: digest(source), bytes: stat.size }
  })
  const manifest: ProjectBackupManifest = {
    format: 'ai-novel-writer-backup', version: 1, backupId: randomUUID(),
    createdAt: new Date().toISOString(), projectId, files: entries,
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

/**
 * Restores only to a fresh project folder. Hashes are verified before the
 * staged `.vela` directory is published, so bad backup data cannot partially
 * overwrite a database or anything outside the project directory.
 */
export function restoreProject(backupPath: string, targetProjectPath: string): ProjectBackupManifest {
  const backup = fs.realpathSync.native(path.resolve(backupPath))
  const target = path.resolve(targetProjectPath)
  const targetVela = path.join(target, '.vela')
  const manifestPath = path.join(backup, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('备份清单不存在')
  const manifest = validatedManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  if (!fs.statSync(backup).isDirectory()) throw new Error('备份目录无效')
  if (fs.existsSync(targetVela)) throw new Error('恢复目标已包含项目数据；请使用新的空项目目录')
  fs.mkdirSync(target, { recursive: true })
  const staging = path.join(target, `.vela.restore-${randomUUID()}`)
  try {
    for (const entry of manifest.files) {
      const source = path.resolve(backup, entry.relativePath)
      if (!isContained(backup, source) || !fs.existsSync(source)) throw new Error(`备份文件校验失败：${entry.relativePath}`)
      const details = fs.lstatSync(source)
      if (!details.isFile() || details.isSymbolicLink() || details.size !== entry.bytes || digest(source) !== entry.sha256) {
        throw new Error(`备份文件校验失败：${entry.relativePath}`)
      }
      const targetFile = path.resolve(staging, entry.relativePath.slice('.vela/'.length))
      if (!isContained(staging, targetFile)) throw new Error('备份路径越界')
      copyFile(source, targetFile)
    }
    if (fs.existsSync(targetVela)) throw new Error('恢复目标已包含项目数据；请使用新的空项目目录')
    fs.renameSync(staging, targetVela)
    return manifest
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}
