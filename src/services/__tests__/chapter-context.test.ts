import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { parseChapterBlueprintMarkdown } from '../../shared/blueprint-v2-markdown'

const mocks = vi.hoisted(() => ({
  invokeWithProjectSession: vi.fn(),
}))

vi.mock('../ipc-client', () => ({
  ipc: { invokeWithProjectSession: mocks.invokeWithProjectSession },
}))

const {
  boundBlueprintChapterNumber,
  loadChapterContext,
  splitChapterBeats,
} = await import('../chapter-context')

const PROJECT_A = 'C:\\novels\\chapter-context-a'
const PROJECT_B = 'C:\\novels\\chapter-context-b'

const SESSION_A: ProjectSessionContext = Object.freeze({
  projectId: 'project-a',
  leaseId: 'lease-a-1',
  projectPath: PROJECT_A,
})

/** 草稿行：`blueprintChapterNumber` 未绑定时由 DB 层整个省略。 */
const draftBoundTo = (blueprintChapterNumber?: number) => (
  blueprintChapterNumber === undefined ? {} : { blueprintChapterNumber }
)

function blueprintRow(overrides: Record<string, unknown> = {}) {
  return {
    chapterNumber: 4,
    title: '风暴降临',
    role: '冲突',
    purpose: '让主角在码头拿到证据',
    keyEvents: '主角夜探码头\n发现账本；被巡查发现',
    characters: ['林晚', '赵九'],
    suspenseHook: '账本缺了最后一页',
    userGuidance: '不要把赵九写成纯反派',
    notes: '',
    notesUpdatedAt: '',
    ...overrides,
  }
}

const fullOutlineMarkdown = `# 第4章｜风暴降临
## 【逐场分镜拆解】
##### 场景一：码头夜探
###### 声学捕捉
- 周晓：这里有人。
## 【写作禁忌与防坑自检】
- **禁写**：不要解释旧案真相。
`
const fullOutline = parseChapterBlueprintMarkdown(fullOutlineMarkdown).content
const fullOutlineDetail = { ...fullOutline, revision: 3, contentHash: 'f'.repeat(64) }

beforeEach(() => {
  mocks.invokeWithProjectSession.mockReset()
  setActiveProjectSessionContext(SESSION_A)
})

describe('boundBlueprintChapterNumber', () => {
  it('只认草稿显式绑定的章号，缺失或非法时返回 null', () => {
    expect(boundBlueprintChapterNumber(draftBoundTo(7))).toBe(7)
    // 未绑定：DB 层省略该字段，绝不回退到草稿自身章号。
    expect(boundBlueprintChapterNumber(draftBoundTo())).toBeNull()
    expect(boundBlueprintChapterNumber(null)).toBeNull()
    expect(boundBlueprintChapterNumber(undefined)).toBeNull()
    expect(boundBlueprintChapterNumber(draftBoundTo(0))).toBeNull()
    expect(boundBlueprintChapterNumber({ blueprintChapterNumber: -3 })).toBeNull()
    expect(boundBlueprintChapterNumber({ blueprintChapterNumber: 1.5 })).toBeNull()
    expect(boundBlueprintChapterNumber({ blueprintChapterNumber: Number.NaN })).toBeNull()
  })
})

describe('splitChapterBeats', () => {
  it('按换行与中英文分号拆分，去空白去空项，不改写作者文字', () => {
    expect(splitChapterBeats('甲\n乙；丙;丁')).toEqual(['甲', '乙', '丙', '丁'])
    expect(splitChapterBeats('  甲  \n\n  乙  ')).toEqual(['甲', '乙'])
    expect(splitChapterBeats('\n；; \n')).toEqual([])
    expect(splitChapterBeats('')).toEqual([])
    expect(splitChapterBeats(null)).toEqual([])
    expect(splitChapterBeats(undefined)).toEqual([])
    // 序号与破折号等作者写法原样保留。
    expect(splitChapterBeats('1. 开场\n- 转折')).toEqual(['1. 开场', '- 转折'])
  })
})

describe('loadChapterContext', () => {
  it('未绑定蓝图时直接返回 unbound，且不发起任何读取', async () => {
    await expect(loadChapterContext(SESSION_A, draftBoundTo())).resolves.toEqual({ status: 'unbound' })
    expect(mocks.invokeWithProjectSession).not.toHaveBeenCalled()
  })

  it('已绑定：按绑定章号读取蓝图与 v2 正式分镜，不读取另一套画布场景', async () => {
    mocks.invokeWithProjectSession.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-get') return blueprintRow()
      if (channel === 'db:blueprint-v2-get') return fullOutlineDetail
      throw new Error(`Unexpected channel: ${channel}`)
    })

    const state = await loadChapterContext(SESSION_A, draftBoundTo(4))
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return

    // 用绑定章号 4 去读，而不是草稿自身的章号。
    expect(mocks.invokeWithProjectSession.mock.calls).toEqual([
      [SESSION_A, 'db:blueprint-get', 4, PROJECT_A],
      [SESSION_A, 'db:blueprint-v2-get', 4, PROJECT_A],
    ])
    expect(state.blueprintChapterNumber).toBe(4)
    expect(state.blueprint).toEqual({
      chapterNumber: 4,
      title: '风暴降临',
      role: '冲突',
      purpose: '让主角在码头拿到证据',
      beats: ['主角夜探码头', '发现账本', '被巡查发现'],
      characters: ['林晚', '赵九'],
      suspenseHook: '账本缺了最后一页',
    })
    expect(state.scenes.map(scene => scene.title)).toEqual(['场景一：码头夜探'])
    expect(state.scenes[0]?.markdown).toContain('###### 声学捕捉')
    expect(state.detailMarkdown).toContain('**禁写**：不要解释旧案真相。')
    expect(state.detailReadStatus).toBeNull()
    expect(mocks.invokeWithProjectSession.mock.calls.some(([channel]) => channel === 'db:chapter-canvas-get')).toBe(false)
  })

  it('绑定目标已被删除：返回 target-missing，不拿草稿章号的同名蓝图顶替', async () => {
    mocks.invokeWithProjectSession.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-get') return null
      // 若实现按草稿章号兜底，这里会返回一份蓝图；必须断言它没有被读取。
      throw new Error(`Unexpected channel: ${channel}`)
    })

    await expect(loadChapterContext(SESSION_A, draftBoundTo(9))).resolves.toEqual({
      status: 'target-missing',
      blueprintChapterNumber: 9,
    })
    expect(mocks.invokeWithProjectSession.mock.calls).toEqual([
      [SESSION_A, 'db:blueprint-get', 9, PROJECT_A],
    ])
  })

  it('蓝图读取失败时显示读取错误，不把失败误判为目标被删除', async () => {
    mocks.invokeWithProjectSession.mockRejectedValue(new Error('temporary database error'))
    await expect(loadChapterContext(SESSION_A, draftBoundTo(4))).resolves.toEqual({ status: 'load-error' })
    expect(mocks.invokeWithProjectSession.mock.calls).toEqual([
      [SESSION_A, 'db:blueprint-get', 4, PROJECT_A],
    ])
  })

  it('v1 简纲可继续展示，v2 不存在时不以旧画布卡片冒充正式分镜', async () => {
    mocks.invokeWithProjectSession.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-get') return blueprintRow()
      if (channel === 'db:blueprint-v2-get') return null
      throw new Error(`Unexpected channel: ${channel}`)
    })

    const state = await loadChapterContext(SESSION_A, draftBoundTo(4))
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.scenes).toEqual([])
    expect(state.detailMarkdown).toBeNull()
    expect(state.detailReadStatus).toBeNull()
    expect(mocks.invokeWithProjectSession.mock.calls.some(([channel]) => channel === 'db:chapter-canvas-get')).toBe(false)
    expect(state.blueprint.purpose).toBe('让主角在码头拿到证据')
  })

  it('v2 详情读取失败不丢弃仍可用的 v1 简纲', async () => {
    mocks.invokeWithProjectSession.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-get') return blueprintRow()
      if (channel === 'db:blueprint-v2-get') throw new Error('detail read failed')
      throw new Error(`Unexpected channel: ${channel}`)
    })
    const state = await loadChapterContext(SESSION_A, draftBoundTo(4))
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.detailReadStatus).toBe('load-error')
    expect(state.blueprint.purpose).toBe('让主角在码头拿到证据')
  })

  it('读取途中项目会话失效：返回 session-lost，绝不让旧项目数据进入新会话', async () => {
    mocks.invokeWithProjectSession.mockImplementation(async (_session: unknown, channel: string) => {
      // 蓝图读取返回前项目已切换（新 lease）。
      setActiveProjectSessionContext({
        projectId: 'project-a',
        leaseId: 'lease-a-2',
        projectPath: PROJECT_A,
      })
      if (channel === 'db:blueprint-get') return blueprintRow()
      throw new Error(`Unexpected channel: ${channel}`)
    })

    await expect(loadChapterContext(SESSION_A, draftBoundTo(4))).resolves.toEqual({
      status: 'session-lost',
    })
  })

  it('绑定到另一个项目的章号时按传入会话读取，不跨项目兜底', async () => {
    mocks.invokeWithProjectSession.mockImplementation(async (_session: unknown, channel: string) => {
      if (channel === 'db:blueprint-get') return blueprintRow({ chapterNumber: 12, title: '番外' })
      throw new Error(`Unexpected channel: ${channel}`)
    })

    const sessionB: ProjectSessionContext = Object.freeze({
      projectId: 'project-b',
      leaseId: 'lease-b-1',
      projectPath: PROJECT_B,
    })
    setActiveProjectSessionContext(sessionB)

    const state = await loadChapterContext(sessionB, draftBoundTo(12))
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.blueprint.title).toBe('番外')
    expect(mocks.invokeWithProjectSession.mock.calls).toEqual([
      [sessionB, 'db:blueprint-get', 12, PROJECT_B],
      [sessionB, 'db:blueprint-v2-get', 12, PROJECT_B],
    ])
  })
})
