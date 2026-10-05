import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { inspectWritingSkillMarkdown } from '../../src/shared/writing-skills'
import { getCurrentProjectPath } from '../database'
import {
  createSecureFileCapability,
  windowsSafeFileSystem,
  type SecureFileSystem,
} from '../security/windows-safe-file-system'
import { assertProjectFilePath } from '../utils/project-context'
import { projectAccess } from './project-access'

const PROJECT_SKILL_ID = /^project:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u
const VALID_STAGE = /^(planning|drafting|review|refinement)$/u

interface BindingsFile {
  version: 1
  bindings: Record<string, string>
}

export interface RevisionLearningFileStatus {
  skillId: string
  exists: boolean
  compatible: boolean
  contentHash: string | null
  matchesPublishedHash: boolean
  boundToRefinement: boolean
  actualRefinementSkillId: string | null
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function parseBindings(content: string): BindingsFile {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('写作 Skill 绑定文件已损坏，已拒绝修改')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('写作 Skill 绑定文件格式无效')
  const raw = value as { version?: unknown; bindings?: unknown }
  if (raw.version !== 1 || !raw.bindings || typeof raw.bindings !== 'object' || Array.isArray(raw.bindings)) {
    throw new Error('写作 Skill 绑定文件格式无效')
  }
  const bindings: Record<string, string> = {}
  for (const [stage, skillId] of Object.entries(raw.bindings as Record<string, unknown>)) {
    if (!VALID_STAGE.test(stage) || typeof skillId !== 'string'
      || !/^(?:builtin|user|project):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(skillId)) {
      throw new Error('写作 Skill 绑定文件包含无效条目')
    }
    bindings[stage] = skillId
  }
  return { version: 1, bindings }
}

async function withFileLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const locks = fileLocks
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => current)
  locks.set(key, queued)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(key) === queued) locks.delete(key)
  }
}

const fileLocks = new Map<string, Promise<void>>()

export class RevisionLearningProjectFileStore {
  constructor(private readonly fileSystem: SecureFileSystem = windowsSafeFileSystem) {}

  private assertSession(context: ProjectSessionContext, expectedProjectPath: string): string {
    const active = projectAccess.assertCurrentProjectContext(context, getCurrentProjectPath())
    if (path.resolve(expectedProjectPath).toLocaleLowerCase('en-US') !== active.rootPath.toLocaleLowerCase('en-US')) {
      throw new Error('项目上下文已切换或会话租约已失效')
    }
    return active.rootPath
  }

  private target(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    relativePath: string,
    mode: 'existing' | 'writable',
  ) {
    const rootPath = this.assertSession(context, expectedProjectPath)
    const segments = relativePath.split(/[\\/]/u)
    if (
      path.isAbsolute(relativePath)
      || relativePath.includes('\0')
      || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes(':'))
    ) throw new Error('修订学习文件路径无效')
    const absolutePath = path.resolve(rootPath, ...segments)
    assertProjectFilePath(absolutePath, rootPath, mode)
    return {
      rootPath,
      absolutePath,
      capability: createSecureFileCapability(rootPath, absolutePath),
    }
  }

  private async readProjectText(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    relativePath: string,
  ): Promise<string | null> {
    const target = this.target(context, expectedProjectPath, relativePath, 'writable')
    if (!await this.fileSystem.exists(target.capability)) return null
    const current = this.target(context, expectedProjectPath, relativePath, 'existing')
    const value = await this.fileSystem.readText(current.capability, 128 * 1024)
    this.assertSession(context, expectedProjectPath)
    return value
  }

  async publishSkill(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    input: { relativePath: string; skillId: string; content: string; contentHash: string },
  ): Promise<{ contentHash: string; recovered: boolean }> {
    const match = input.skillId.match(PROJECT_SKILL_ID)
    if (!match || input.relativePath !== `.vela/skills/${match[1]}/SKILL.md`) {
      throw new Error('修订学习发布目标不符合项目技能目录规则')
    }
    const actualHash = sha256(input.content)
    if (actualHash !== input.contentHash) throw new Error('修订学习技能预览哈希不一致')
    const inspection = inspectWritingSkillMarkdown(input.content)
    if (!inspection.compatible || inspection.metadata.stage !== 'refinement' || inspection.metadata.name !== match[1]) {
      throw new Error(`技能与修稿阶段不兼容：${inspection.reasons.join(', ') || 'metadata mismatch'}`)
    }
    const skillTarget = this.target(context, expectedProjectPath, input.relativePath, 'writable')
    const key = skillTarget.absolutePath.toLocaleLowerCase('en-US')
    return withFileLock(key, async () => {
      this.assertSession(context, expectedProjectPath)
      const existing = await this.readProjectText(context, expectedProjectPath, input.relativePath)
      if (existing !== null) {
        const existingHash = sha256(existing)
        if (existingHash !== input.contentHash) {
          throw new Error('目标项目技能已存在且内容不同，未覆盖该文件')
        }
        const existingInspection = inspectWritingSkillMarkdown(existing)
        if (!existingInspection.compatible || existingInspection.metadata.name !== match[1]) {
          throw new Error('现有技能文件不兼容，未恢复发布回执')
        }
        return { contentHash: existingHash, recovered: true }
      }

      const directory = this.target(context, expectedProjectPath, `.vela/skills/${match[1]}`, 'writable')
      await this.fileSystem.mkdir(directory.capability)
      this.assertSession(context, expectedProjectPath)
      // Recheck after creating the directory. An interrupted earlier publish is
      // recovered only when its exact content hash matches.
      const appeared = await this.readProjectText(context, expectedProjectPath, input.relativePath)
      if (appeared !== null) {
        if (sha256(appeared) !== input.contentHash) throw new Error('目标技能路径已被占用，未覆盖现有文件')
        return { contentHash: input.contentHash, recovered: true }
      }
      const file = this.target(context, expectedProjectPath, input.relativePath, 'writable')
      await this.fileSystem.writeTextAtomically(file.capability, input.content, () => {
        this.assertSession(context, expectedProjectPath)
      }, { mustNotAlreadyExist: true })
      this.assertSession(context, expectedProjectPath)
      const readBack = await this.readProjectText(context, expectedProjectPath, input.relativePath)
      if (readBack === null || sha256(readBack) !== input.contentHash) {
        throw new Error('技能文件写入后的独立读回校验失败')
      }
      const readInspection = inspectWritingSkillMarkdown(readBack)
      if (!readInspection.compatible || readInspection.metadata.stage !== 'refinement') {
        throw new Error('技能文件读回后不兼容，发布回执未完成')
      }
      return { contentHash: input.contentHash, recovered: false }
    })
  }

  async status(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    receipts: ReadonlyArray<{ skillId: string; relativePath: string; contentHash: string }>,
  ): Promise<{ refinementSkillId: string | null; skills: RevisionLearningFileStatus[] }> {
    const bindingContent = await this.readProjectText(context, expectedProjectPath, '.vela/writing-skills.json')
    const bindings = bindingContent === null ? { version: 1 as const, bindings: {} } : parseBindings(bindingContent)
    const refinementSkillId = bindings.bindings.refinement ?? null
    const skills: RevisionLearningFileStatus[] = []
    for (const receipt of receipts) {
      const content = await this.readProjectText(context, expectedProjectPath, receipt.relativePath)
      const match = receipt.skillId.match(PROJECT_SKILL_ID)
      const inspection = content !== null ? inspectWritingSkillMarkdown(content) : null
      const contentHash = content === null ? null : sha256(content)
      skills.push({
        skillId: receipt.skillId,
        exists: content !== null,
        compatible: inspection?.compatible === true && inspection.metadata.stage === 'refinement',
        contentHash,
        matchesPublishedHash: contentHash === receipt.contentHash,
        boundToRefinement: refinementSkillId === receipt.skillId,
        actualRefinementSkillId: refinementSkillId,
      })
      if (!match) throw new Error('修订学习发布回执包含无效项目技能身份')
    }
    return { refinementSkillId, skills }
  }

  async bindPublishedSkill(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    input: {
      skillId: string
      relativePath: string
      contentHash: string
      expectedCurrentSkillId: string | null
      mode: 'only-if-unbound' | 'replace'
    },
  ): Promise<{ bound: boolean; conflict: boolean; currentSkillId: string | null }> {
    const match = input.skillId.match(PROJECT_SKILL_ID)
    if (!match || input.relativePath !== `.vela/skills/${match[1]}/SKILL.md`) throw new Error('项目技能回执无效')
    if (input.mode !== 'only-if-unbound' && input.mode !== 'replace') throw new Error('修稿阶段绑定模式无效')
    if (input.mode === 'only-if-unbound' && input.expectedCurrentSkillId !== null) throw new Error('绑定确认状态无效')
    const bindingPath = '.vela/writing-skills.json'
    const bindingTarget = this.target(context, expectedProjectPath, bindingPath, 'writable')
    return withFileLock(bindingTarget.absolutePath.toLocaleLowerCase('en-US'), async () => {
      const skillContent = await this.readProjectText(context, expectedProjectPath, input.relativePath)
      if (skillContent === null || sha256(skillContent) !== input.contentHash) {
        throw new Error('项目技能缺失或内容已被外部修改，不能绑定')
      }
      const inspection = inspectWritingSkillMarkdown(skillContent)
      if (!inspection.compatible || inspection.metadata.stage !== 'refinement' || inspection.metadata.name !== match[1]) {
        throw new Error('项目技能当前内容不兼容，不能绑定')
      }
      const currentContent = await this.readProjectText(context, expectedProjectPath, bindingPath)
      const bindings = currentContent === null ? { version: 1 as const, bindings: {} } : parseBindings(currentContent)
      const current = bindings.bindings.refinement ?? null
      if (current === input.skillId) return { bound: true, conflict: false, currentSkillId: current }
      if (current !== input.expectedCurrentSkillId) return { bound: false, conflict: true, currentSkillId: current }
      if (current !== null && input.mode !== 'replace') return { bound: false, conflict: true, currentSkillId: current }
      if (current === null && input.mode === 'replace') return { bound: false, conflict: true, currentSkillId: current }
      const next = { ...bindings.bindings, refinement: input.skillId }
      await this.writeBindings(context, expectedProjectPath, bindingTarget.capability, next)
      return { bound: true, conflict: false, currentSkillId: input.skillId }
    })
  }

  async updateBindingWithCas(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    input: { stage: string; skillId: string | null; expectedCurrentSkillId: string | null },
  ): Promise<{ success: boolean; conflict?: boolean; currentSkillId?: string | null; error?: string }> {
    if (!VALID_STAGE.test(input.stage)) throw new Error('写作 Skill 阶段无效')
    if (input.skillId !== null && !/^(?:builtin|user|project):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.skillId)) {
      throw new Error('写作 Skill 身份无效')
    }
    const filePath = '.vela/writing-skills.json'
    const target = this.target(context, expectedProjectPath, filePath, 'writable')
    return withFileLock(target.absolutePath.toLocaleLowerCase('en-US'), async () => {
      if (input.skillId?.startsWith('project:')) {
        const name = input.skillId.slice('project:'.length)
        const skill = await this.readProjectText(context, expectedProjectPath, `.vela/skills/${name}/SKILL.md`)
        const inspected = skill === null ? null : inspectWritingSkillMarkdown(skill)
        if (!inspected?.compatible) throw new Error('目标项目 Skill 缺失或不兼容')
      }
      const currentContent = await this.readProjectText(context, expectedProjectPath, filePath)
      const bindings = currentContent === null ? { version: 1 as const, bindings: {} } : parseBindings(currentContent)
      const current = bindings.bindings[input.stage] ?? null
      if (current !== input.expectedCurrentSkillId) {
        return { success: false, conflict: true, currentSkillId: current }
      }
      const next = { ...bindings.bindings }
      if (input.skillId) next[input.stage] = input.skillId
      else delete next[input.stage]
      await this.writeBindings(context, expectedProjectPath, target.capability, next)
      return { success: true, currentSkillId: input.skillId }
    })
  }

  private async writeBindings(
    context: ProjectSessionContext,
    expectedProjectPath: string,
    capability: ReturnType<typeof createSecureFileCapability>,
    bindings: Record<string, string>,
  ): Promise<void> {
    await this.fileSystem.mkdir(this.target(context, expectedProjectPath, '.vela', 'writable').capability)
    this.assertSession(context, expectedProjectPath)
    const serialized = `${JSON.stringify({ version: 1, bindings }, null, 2)}\n`
    await this.fileSystem.writeTextAtomically(capability, serialized, () => {
      this.assertSession(context, expectedProjectPath)
    })
    this.assertSession(context, expectedProjectPath)
    const readBack = await this.readProjectText(context, expectedProjectPath, '.vela/writing-skills.json')
    if (readBack !== serialized) throw new Error('写作 Skill 绑定独立读回校验失败')
  }
}
