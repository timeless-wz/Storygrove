import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'

const invokeWithProjectSession = vi.fn()
const invoke = vi.fn()
const projectState = vi.hoisted(() => ({
  currentProject: null as { id: string; path: string; sessionLease: string } | null,
}))

vi.mock('../../ipc-client', () => ({
  ipc: { isElectron: true, invoke, invokeWithProjectSession },
}))

vi.mock('../../../stores/project-store', () => ({
  useProjectStore: { getState: () => projectState },
}))

const session: ProjectSessionContext = {
  projectId: 'project-1',
  projectPath: 'C:/novels/project-1',
  leaseId: 'lease-1',
}

describe('writing skill project bindings', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue([])
    invokeWithProjectSession.mockReset()
    projectState.currentProject = null
  })

  it('treats an absent binding file as no bindings', async () => {
    invokeWithProjectSession.mockResolvedValue(false)

    const { loadWritingSkillBindings } = await import('../writing-skill-bindings')
    await expect(loadWritingSkillBindings(session)).resolves.toEqual({ version: 1, bindings: {} })
    expect(invokeWithProjectSession).toHaveBeenCalledOnce()
    expect(invokeWithProjectSession).toHaveBeenCalledWith(
      session,
      'fs:check-exists',
      'C:/novels/project-1/.vela/writing-skills.json',
      session.projectPath,
    )
  })

  it('rejects a binding file that exists but is malformed', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ success: true, content: '{broken' })

    const { loadWritingSkillBindings } = await import('../writing-skill-bindings')
    await expect(loadWritingSkillBindings(session)).rejects.toThrow(/binding/i)
  })

  it('rejects a frozen snapshot whose selected skill is missing', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ version: 1, bindings: { drafting: 'user:missing-skill' } }),
      })

    const { freezeWritingSkillsSnapshot } = await import('../writing-skill-bindings')
    await expect(freezeWritingSkillsSnapshot(session, 'en-US')).rejects.toThrow(/missing-skill/)
  })

  it('rejects a frozen snapshot whose selected skill is incompatible', async () => {
    invoke.mockResolvedValue([{
      name: 'unsafe-skill',
      baseDir: 'managed://skills/unsafe-skill',
      filePath: 'managed://skills/unsafe-skill/SKILL.md',
      content: '---\nname: unsafe-skill\ndescription: Unsafe\nstage: drafting\n---\nRun scripts/install.js before writing.',
    }])
    invokeWithProjectSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ version: 1, bindings: { drafting: 'user:unsafe-skill' } }),
      })

    const { freezeWritingSkillsSnapshot } = await import('../writing-skill-bindings')
    await expect(freezeWritingSkillsSnapshot(session, 'en-US')).rejects.toThrow(/incompatible/i)
  })

  it('updates one stage through an atomic compare-and-set request', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce({ success: true })

    const { saveWritingSkillBinding } = await import('../writing-skill-bindings')
    await saveWritingSkillBinding(session, 'drafting', 'user:scene-craft')

    expect(invokeWithProjectSession).toHaveBeenLastCalledWith(
      session,
      'revision-learning:binding-cas',
      { stage: 'drafting', skillId: 'user:scene-craft', expectedCurrentSkillId: null },
    )
  })

  it('freezes the selected compatible skill content for one workflow start', async () => {
    invokeWithProjectSession.mockResolvedValue({
      success: true,
      content: JSON.stringify({ version: 1, bindings: { refinement: 'builtin:natural-prose-refinement' } }),
    })

    const { skillRegistry } = await import('../skill-registry')
    const { freezeWritingSkill } = await import('../writing-skill-bindings')
    await skillRegistry.loadAll()
    const frozen = await freezeWritingSkill(session, 'refinement', 'en-US')

    expect(frozen).toMatchObject({
      skillId: 'builtin:natural-prose-refinement',
      stage: 'refinement',
      source: 'builtin',
      writingLanguage: 'en-US',
    })
    expect(frozen?.content).toContain('Revise the prose')
    expect(Object.isFrozen(frozen)).toBe(true)
  })

  it('uses the observed old binding when unbinding, preserving concurrent updates', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ version: 1, bindings: { planning: 'builtin:long-form-continuity', drafting: 'user:scene-craft' } }),
      })
      .mockResolvedValueOnce({ success: true, currentSkillId: null })

    const { saveWritingSkillBinding } = await import('../writing-skill-bindings')
    await saveWritingSkillBinding(session, 'drafting', null)

    expect(invokeWithProjectSession).toHaveBeenLastCalledWith(
      session,
      'revision-learning:binding-cas',
      { stage: 'drafting', skillId: null, expectedCurrentSkillId: 'user:scene-craft' },
    )
  })

  it('surfaces a binding compare-and-set conflict instead of overwriting it', async () => {
    invokeWithProjectSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ version: 1, bindings: { drafting: 'user:scene-craft' } }),
      })
      .mockResolvedValueOnce({ success: false, conflict: true, currentSkillId: 'user:other' })

    const { saveWritingSkillBinding } = await import('../writing-skill-bindings')
    await expect(saveWritingSkillBinding(session, 'drafting', null)).rejects.toThrow(/重新加载/)
    expect(invokeWithProjectSession).toHaveBeenLastCalledWith(
      session,
      'revision-learning:binding-cas',
      { stage: 'drafting', skillId: null, expectedCurrentSkillId: 'user:scene-craft' },
    )
  })

  it('reloads a project refinement skill and freezes its persisted binding for the workflow', async () => {
    const skillsPath = 'C:/novels/project-1/.vela/skills'
    const skillPath = `${skillsPath}/revision-sample/SKILL.md`
    const skillContent = [
      '---',
      'name: revision-sample',
      'display_name: Revision sample',
      'description: Author-reviewed revision guidance',
      'version: 1.0.0',
      'language: en-US',
      'stage: refinement',
      '---',
      '',
      'REVISION_SKILL_RELOAD_SENTINEL: keep actions tied to a clear point of view.',
    ].join('\n')
    projectState.currentProject = {
      id: session.projectId,
      path: session.projectPath,
      sessionLease: session.leaseId,
    }
    invoke.mockResolvedValue([])
    invokeWithProjectSession.mockImplementation(async (_context: ProjectSessionContext, channel: string, ...args: unknown[]) => {
      if (channel === 'fs:check-exists') return args[0] === skillsPath || args[0] === `${session.projectPath}/.vela/writing-skills.json`
      if (channel === 'fs:list-dir') return [{ name: 'revision-sample', path: `${skillsPath}/revision-sample`, isDir: true }]
      if (channel === 'fs:read-file' && args[0] === skillPath) return { success: true, content: skillContent }
      if (channel === 'fs:read-file' && args[0] === `${session.projectPath}/.vela/writing-skills.json`) {
        return { success: true, content: JSON.stringify({ version: 1, bindings: { refinement: 'project:revision-sample' } }) }
      }
      throw new Error(`unexpected project IPC: ${channel} ${String(args[0])}`)
    })

    const { skillRegistry } = await import('../skill-registry')
    const { freezeWritingSkill } = await import('../writing-skill-bindings')
    await skillRegistry.loadAll()
    const frozen = await freezeWritingSkill(session, 'refinement', 'en-US')

    expect(frozen).toMatchObject({
      skillId: 'project:revision-sample',
      name: 'Revision sample',
      stage: 'refinement',
      source: 'project',
      writingLanguage: 'en-US',
    })
    expect(frozen?.content).toContain('REVISION_SKILL_RELOAD_SENTINEL')
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(invokeWithProjectSession).toHaveBeenCalledWith(
      session,
      'fs:read-file',
      skillPath,
      session.projectPath,
    )
  })
})
