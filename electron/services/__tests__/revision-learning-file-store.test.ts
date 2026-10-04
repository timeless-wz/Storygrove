import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSessionContext } from '../../../src/shared/ipc-channels'
import type { AtomicWriteConstraints, SecureFileCapability, SecureFileSystem } from '../../security/windows-safe-file-system'

const projectState = vi.hoisted(() => ({
  currentProjectPath: '',
  activeSession: null as ProjectSessionContext | null,
}))

vi.mock('../../database', () => ({
  getCurrentProjectPath: () => projectState.currentProjectPath,
}))

vi.mock('../project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext(context: ProjectSessionContext | undefined, currentProjectPath: string | null) {
      const active = projectState.activeSession
      if (!context || !active || !currentProjectPath
        || context.projectId !== active.projectId
        || context.leaseId !== active.leaseId
        || context.projectPath !== active.projectPath
        || currentProjectPath !== active.projectPath) {
        throw new Error('项目会话已失效，已拒绝操作')
      }
      return { rootPath: active.projectPath }
    },
  },
}))

import { RevisionLearningProjectFileStore } from '../revision-learning-file-store'

function targetPath(capability: SecureFileCapability): string {
  return capability.relativePath
    ? path.join(capability.rootPath, ...capability.relativePath.split('\\'))
    : capability.rootPath
}

function realTestFileSystem(): SecureFileSystem {
  return {
    async readBytes(capability, maxBytes) {
      const content = fs.readFileSync(targetPath(capability))
      if (maxBytes !== undefined && content.byteLength > maxBytes) throw new Error('SECURE_FS_FILE_TOO_LARGE')
      return content
    },
    async readText(capability, maxBytes) {
      const content = fs.readFileSync(targetPath(capability), 'utf8')
      if (maxBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxBytes) throw new Error('SECURE_FS_FILE_TOO_LARGE')
      return content
    },
    async writeTextAtomically(capability, content, beforeReplace, constraints?: AtomicWriteConstraints) {
      const target = targetPath(capability)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (constraints?.mustAlreadyExist && !fs.existsSync(target)) throw new Error('SECURE_FS_NOT_FOUND')
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}.tmp`)
      fs.writeFileSync(temporary, content, 'utf8')
      try {
        await beforeReplace?.()
        if (constraints?.mustNotAlreadyExist) {
          fs.linkSync(temporary, target)
          fs.unlinkSync(temporary)
        } else {
          fs.renameSync(temporary, target)
        }
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      }
    },
    async mkdir(capability) {
      fs.mkdirSync(targetPath(capability), { recursive: true })
    },
    async exists(capability) {
      return fs.existsSync(targetPath(capability))
    },
    async listDirectory(capability) {
      return fs.readdirSync(targetPath(capability), { withFileTypes: true })
        .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    },
  }
}

function markdown(body: string): string {
  return [
    '---',
    'name: revision-sample',
    'display_name: 修订样本',
    'description: 作者确认的修稿指导',
    'version: 1.0.0',
    'language: zh-CN',
    'stage: refinement',
    '---',
    '',
    body,
    '',
  ].join('\n')
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

let projectRoot = ''
let context: ProjectSessionContext
let store: RevisionLearningProjectFileStore
const temporaryRoots: string[] = []

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-learning-file-store-'))
  temporaryRoots.push(projectRoot)
  fs.mkdirSync(path.join(projectRoot, '.vela'), { recursive: true })
  context = { projectId: 'revision-learning-project', projectPath: projectRoot, leaseId: 'lease-one' }
  projectState.currentProjectPath = projectRoot
  projectState.activeSession = context
  store = new RevisionLearningProjectFileStore(realTestFileSystem())
})

afterEach(() => {
  projectState.currentProjectPath = ''
  projectState.activeSession = null
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('RevisionLearningProjectFileStore', () => {
  it('creates an exclusive project skill, recovers an interrupted publish, and refuses changed-content overwrite', async () => {
    const content = markdown('从纳入的修订中检查视角与动作是否一致。')
    const input = {
      relativePath: '.vela/skills/revision-sample/SKILL.md',
      skillId: 'project:revision-sample',
      content,
      contentHash: sha256(content),
    }
    const first = await store.publishSkill(context, projectRoot, input)
    expect(first).toEqual({ contentHash: input.contentHash, recovered: false })
    expect(fs.readFileSync(path.join(projectRoot, input.relativePath), 'utf8')).toBe(content)

    await expect(store.publishSkill(context, projectRoot, { ...input, content: markdown('另一版指导。'), contentHash: sha256(markdown('另一版指导。')) }))
      .rejects.toThrow('目标项目技能已存在且内容不同，未覆盖该文件')
    await expect(store.publishSkill(context, projectRoot, input)).resolves.toEqual({
      contentHash: input.contentHash,
      recovered: true,
    })
    expect(fs.readFileSync(path.join(projectRoot, input.relativePath), 'utf8')).toBe(content)

    const status = await store.status(context, projectRoot, [{
      skillId: input.skillId,
      relativePath: input.relativePath,
      contentHash: input.contentHash,
    }])
    expect(status).toMatchObject({
      refinementSkillId: null,
      skills: [{ exists: true, compatible: true, matchesPublishedHash: true, boundToRefinement: false }],
    })
  })

  it('rechecks an existing refinement binding, replaces only on the confirmed CAS, and reports later file edits', async () => {
    const content = markdown('只把人物当时能察觉的信息纳入描写。')
    const receipt = {
      skillId: 'project:revision-sample',
      relativePath: '.vela/skills/revision-sample/SKILL.md',
      contentHash: sha256(content),
    }
    fs.writeFileSync(path.join(projectRoot, '.vela/writing-skills.json'), JSON.stringify({
      version: 1,
      bindings: { refinement: 'builtin:natural-prose-refinement' },
    }), 'utf8')
    await store.publishSkill(context, projectRoot, { ...receipt, content })

    const initialStatus = await store.status(context, projectRoot, [receipt])
    expect(initialStatus.refinementSkillId).toBe('builtin:natural-prose-refinement')
    const staleConfirmation = await store.bindPublishedSkill(context, projectRoot, {
      ...receipt,
      expectedCurrentSkillId: null,
      mode: 'only-if-unbound',
    })
    expect(staleConfirmation).toEqual({ bound: false, conflict: true, currentSkillId: 'builtin:natural-prose-refinement' })

    await expect(store.bindPublishedSkill(context, projectRoot, {
      ...receipt,
      expectedCurrentSkillId: 'builtin:natural-prose-refinement',
      mode: 'replace',
    })).resolves.toEqual({ bound: true, conflict: false, currentSkillId: receipt.skillId })
    const boundStatus = await store.status(context, projectRoot, [receipt])
    expect(boundStatus).toMatchObject({
      refinementSkillId: receipt.skillId,
      skills: [{ boundToRefinement: true, matchesPublishedHash: true }],
    })

    fs.writeFileSync(path.join(projectRoot, receipt.relativePath), markdown('作者后来手工修改了文件。'), 'utf8')
    const changedStatus = await store.status(context, projectRoot, [receipt])
    expect(changedStatus.skills[0]).toMatchObject({ exists: true, compatible: true, matchesPublishedHash: false })
    await expect(store.bindPublishedSkill(context, projectRoot, {
      ...receipt,
      expectedCurrentSkillId: receipt.skillId,
      mode: 'replace',
    })).rejects.toThrow('项目技能缺失或内容已被外部修改，不能绑定')
  })

  it('rejects the same path when a project session lease has changed', async () => {
    const staleContext = context
    projectState.activeSession = { ...context, leaseId: 'lease-two' }
    const content = markdown('只作为当前项目的补充指导。')
    await expect(store.publishSkill(staleContext, projectRoot, {
      relativePath: '.vela/skills/revision-sample/SKILL.md',
      skillId: 'project:revision-sample',
      content,
      contentHash: sha256(content),
    })).rejects.toThrow('项目会话已失效')
  })
})
