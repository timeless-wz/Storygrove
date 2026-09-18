import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupProject, restoreProject } from '../project-backup-service'

describe('project backup service', () => {
  it('round-trips only .vela state and rejects in-project destinations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-backup-')); const backup = `${root}-backup`; const target = `${root}-restored`
    fs.mkdirSync(path.join(root, '.vela'), { recursive: true }); fs.writeFileSync(path.join(root, '.vela', 'vela.db'), 'db'); fs.writeFileSync(path.join(root, 'linked-manuscript.md'), 'do not copy')
    expect(() => backupProject(root, root)).toThrow(/不能位于项目目录内/u)
    const manifest = backupProject(root, backup); expect(manifest.files.map(file => file.relativePath)).toContain('.vela/vela.db'); expect(fs.existsSync(path.join(backup, 'linked-manuscript.md'))).toBe(false)
    restoreProject(backup, target); expect(fs.readFileSync(path.join(target, '.vela', 'vela.db'), 'utf8')).toBe('db')
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(backup, { recursive: true, force: true }); fs.rmSync(target, { recursive: true, force: true })
  })

  it('validates all backup files before publishing and never overwrites an existing project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-backup-safe-'))
    const backup = `${root}-backup`; const target = `${root}-restored`; const occupied = `${root}-occupied`
    fs.mkdirSync(path.join(root, '.vela'), { recursive: true })
    fs.writeFileSync(path.join(root, '.vela', 'vela.db'), 'healthy')
    backupProject(root, backup)
    fs.writeFileSync(path.join(backup, '.vela', 'vela.db'), 'tampered')
    expect(() => restoreProject(backup, target)).toThrow(/校验失败/u)
    expect(fs.existsSync(path.join(target, '.vela'))).toBe(false)
    fs.mkdirSync(path.join(occupied, '.vela'), { recursive: true })
    expect(() => restoreProject(backup, occupied)).toThrow(/新的空项目目录/u)
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(backup, { recursive: true, force: true }); fs.rmSync(target, { recursive: true, force: true }); fs.rmSync(occupied, { recursive: true, force: true })
  })
})
