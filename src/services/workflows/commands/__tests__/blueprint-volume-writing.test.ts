import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatBlueprintVolumeWritingMaterial,
  loadBlueprintVolumeWritingMaterial,
} from '../blueprint-volume-writing'
import { ipc } from '../../../ipc-client'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import type { ProjectSessionContext } from '../../../../shared/ipc-channels'

const session: ProjectSessionContext = {
  projectId: 'volume-writing-project',
  leaseId: 'volume-writing-lease',
  projectPath: 'C:/novels/volume-writing',
}

vi.mock('../../../ipc-client', () => ({
  ipc: { invokeWithProjectSession: vi.fn() },
}))

vi.mock('../../../../stores/project-store', () => ({
  useProjectStore: {
    getState: () => ({ currentProject: {
      id: session.projectId, path: session.projectPath, sessionLease: session.leaseId,
    } }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  setActiveProjectSessionContext(session)
})

afterEach(() => {
  setActiveProjectSessionContext(null)
})

describe('volume planning material for chapter writing', () => {
  it('uses the bound chapter blueprint volume, filters sibling summaries to that volume, and labels the outline as a plan', async () => {
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (
      _session: ProjectSessionContext,
      channel: string,
      ...args: unknown[]
    ) => {
      if (channel === 'db:blueprint-get') return { chapterNumber: args[0], volumeId: 'blueprint-volume-2' }
      if (channel === 'db:blueprint-volume-outline-get') return {
        volumeId: args[0], revision: 4, contentHash: 'a'.repeat(64), markdown: '## 本卷计划\n本卷冲突逐步升级。',
      }
      if (channel === 'db:blueprint-list-summary') return [
        { chapterNumber: 20, volumeId: 'blueprint-volume-2', title: '同卷前章', purpose: '前因', keyEvents: '留下线索' },
        { chapterNumber: 21, volumeId: 'prose-volume-only', title: '正文归卷章', purpose: '不应读入', keyEvents: '不相关' },
        { chapterNumber: 22, volumeId: 'blueprint-volume-2', title: '同卷后章', purpose: '后果', keyEvents: '付出代价' },
      ]
      throw new Error(`Unexpected IPC channel: ${channel}`)
    }) as never)

    const material = await loadBlueprintVolumeWritingMaterial(session, 20)
    expect(material).toEqual({
      volumeId: 'blueprint-volume-2',
      outline: { revision: 4, contentHash: 'a'.repeat(64), markdown: '## 本卷计划\n本卷冲突逐步升级。' },
      relatedChapters: [
        { chapterNumber: 20, title: '同卷前章', purpose: '前因', keyEvents: '留下线索' },
        { chapterNumber: 22, title: '同卷后章', purpose: '后果', keyEvents: '付出代价' },
      ],
    })
    expect(ipc.invokeWithProjectSession).toHaveBeenNthCalledWith(1, session, 'db:blueprint-get', 20, session.projectPath)
    expect(ipc.invokeWithProjectSession).not.toHaveBeenCalledWith(
      session, 'db:chapter-volume-list', expect.anything(), expect.anything(),
    )
    const promptBlock = formatBlueprintVolumeWritingMaterial(material, 'zh-CN')
    expect(promptBlock).toContain('当前卷的卷纲计划')
    expect(promptBlock).toContain('创作计划，不是已发生事实')
    expect(promptBlock).toContain('卷 blueprint-volume-2，r4')
    expect(promptBlock).toContain('同卷后章')
    expect(promptBlock).not.toContain('正文归卷章')
  })

  it('uses no chapter-range or prose-volume inference and keeps the legacy path when the bound blueprint has no outline', async () => {
    vi.mocked(ipc.invokeWithProjectSession).mockImplementation((async (
      _session: ProjectSessionContext,
      channel: string,
      ...args: unknown[]
    ) => {
      if (channel === 'db:blueprint-get') return { chapterNumber: args[0], volumeId: 'blueprint-volume-1' }
      if (channel === 'db:blueprint-volume-outline-get') return null
      throw new Error(`Unexpected IPC channel: ${channel}`)
    }) as never)

    await expect(loadBlueprintVolumeWritingMaterial(session, 1)).resolves.toEqual({
      volumeId: 'blueprint-volume-1', outline: null, relatedChapters: [],
    })
    expect(formatBlueprintVolumeWritingMaterial(null, 'zh-CN')).toBe('')
    expect(ipc.invokeWithProjectSession).not.toHaveBeenCalledWith(
      session, 'db:blueprint-list-summary', expect.anything(), expect.anything(),
    )
  })
})
