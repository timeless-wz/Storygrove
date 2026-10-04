import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useStoryTimelineStore } from '../story-timeline-store'
import { useProjectStore } from '../project-store'
import { setActiveProjectSessionContext } from '../../shared/project-session-context'
import type { ProjectData, ProjectSessionContext } from '../../shared/ipc-channels'
import { DEFAULT_TIMELINE_SETTINGS, STORY_TIMELINE_MAIN_BRANCH_ID, type StoryTimelineEvent } from '../../shared/story-timeline'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../services/ipc-client', () => ({ ipc: { invokeWithProjectSession: invoke } }))
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ toast: { error: toastError } }))

const a: ProjectSessionContext = { projectId: 'a', projectPath: 'C:\\test\\a', leaseId: 'a-1' }
const aReopened: ProjectSessionContext = { projectId: 'a', projectPath: 'C:\\test\\a', leaseId: 'a-2' }
const b: ProjectSessionContext = { projectId: 'b', projectPath: 'C:\\test\\b', leaseId: 'b-1' }

const mainBranch = { id: STORY_TIMELINE_MAIN_BRANCH_ID, name: '主时间轴', sourceEventId: null, sortOrder: 0 }
const branchB1 = { id: 'branch-b1', name: '级联支线', sourceEventId: 'm1', sortOrder: 1 }
const branchB2 = { id: 'branch-b2', name: '嵌套支线', sourceEventId: 'a1', sortOrder: 2 }
const eventM1: StoryTimelineEvent = {
  id: 'm1', branchId: 'main', title: '主干事件', timeLabel: '第一年', sortOrder: 10,
  precision: 'exact', description: '', chapterNumbers: [], characterNames: [], locationNodeIds: [], status: 'planned',
}
const eventA1: StoryTimelineEvent = {
  id: 'a1', branchId: 'branch-b1', title: '支线事件', timeLabel: '第二年', sortOrder: 12,
  precision: 'exact', description: '', chapterNumbers: [], characterNames: [], locationNodeIds: [], status: 'planned',
}
const eventA2: StoryTimelineEvent = {
  id: 'a2', branchId: 'branch-b2', title: '嵌套事件', timeLabel: '第三年', sortOrder: 15,
  precision: 'exact', description: '', chapterNumbers: [], characterNames: [], locationNodeIds: [], status: 'planned',
}

function makeProject(session: ProjectSessionContext): ProjectData {
  return {
    id: session.projectId,
    path: session.projectPath,
    sessionLease: session.leaseId,
  } as ProjectData
}

function activate(session: ProjectSessionContext): void {
  useProjectStore.setState({ currentProject: makeProject(session) })
  setActiveProjectSessionContext(session)
}

const initialStoreState = useStoryTimelineStore.getState()
const initialProjectState = useProjectStore.getState()

beforeEach(() => {
  activate(a)
  invoke.mockReset()
  toastError.mockReset()
  useStoryTimelineStore.setState({
    ...initialStoreState,
    settings: DEFAULT_TIMELINE_SETTINGS,
    branches: [mainBranch],
    events: [],
    expandedBranchIds: [STORY_TIMELINE_MAIN_BRANCH_ID],
    loading: false,
    dataProjectKey: a.projectPath,
  })
})

afterEach(() => {
  useStoryTimelineStore.setState(initialStoreState)
  useProjectStore.setState(initialProjectState)
  setActiveProjectSessionContext(null)
})

describe('story-timeline-store 原子创建支线', () => {
  it('成功后仅在确认成功且会话仍有效时更新 branches/events/expandedBranchIds', async () => {
    const committedBranch = { ...branchB1 }
    const committedEvent = { ...eventA1 }
    invoke.mockResolvedValue({ success: true, branch: committedBranch, event: committedEvent })

    const result = await useStoryTimelineStore.getState().createBranchWithEvent(
      { ...branchB1 },
      { ...eventA1 },
    )

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1]).toBe('db:timeline-branch-create-with-event')
    // mock 参数：[session, channel, branch, event, projectPath]
    expect(invoke.mock.calls[0][4]).toBe(a.projectPath)
    expect(result.success).toBe(true)
    const state = useStoryTimelineStore.getState()
    expect(state.branches.map(branch => branch.id)).toEqual(['main', 'branch-b1'])
    expect(state.events.map(event => event.id)).toEqual(['a1'])
    // 新支线默认展开，保证创建后可发现
    expect(state.expandedBranchIds).toContain('branch-b1')
  })

  it('后端失败时返回明确错误并保持原状态可供重试', async () => {
    invoke.mockResolvedValue({ success: false, error: '分叉来源事件不存在于当前项目：m1' })

    const result = await useStoryTimelineStore.getState().createBranchWithEvent(
      { ...branchB1, sourceEventId: 'm1' },
      { ...eventA1 },
    )

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('来源事件不存在') })
    const state = useStoryTimelineStore.getState()
    expect(state.branches.map(branch => branch.id)).toEqual(['main'])
    expect(state.events).toEqual([])
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('迟到响应不能污染新项目：旧 lease 的创建成功被丢弃', async () => {
    let resolveCreate!: (value: unknown) => void
    invoke.mockImplementationOnce(() => new Promise<unknown>(resolve => { resolveCreate = resolve }))

    const pending = useStoryTimelineStore.getState().createBranchWithEvent({ ...branchB1 }, { ...eventA1 })
    // 同路径重开获得新 lease（旧 lease 失效），模拟“关闭再重开”
    activate(aReopened)
    resolveCreate({ success: true, branch: { ...branchB1 }, event: { ...eventA1 } })
    const result = await pending

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('会话已切换') })
    const state = useStoryTimelineStore.getState()
    expect(state.branches.map(branch => branch.id)).toEqual(['main'])
    expect(state.events).toEqual([])
  })

  it('跨项目切换后，旧项目的失败结果也不会写当前状态或误报当前项目', async () => {
    invoke.mockResolvedValue({ success: false, error: 'boom' })
    const pending = useStoryTimelineStore.getState().createBranchWithEvent({ ...branchB1 }, { ...eventA1 })
    activate(b)
    const result = await pending

    expect(result.success).toBe(false)
    expect(toastError).not.toHaveBeenCalled()
    expect(useStoryTimelineStore.getState().dataProjectKey).toBe(a.projectPath)
  })
})

describe('story-timeline-store 删除影响预览与确认删除', () => {
  beforeEach(() => {
    useStoryTimelineStore.setState({
      branches: [mainBranch, branchB1, branchB2],
      events: [eventM1, eventA1, eventA2],
      expandedBranchIds: [STORY_TIMELINE_MAIN_BRANCH_ID, 'branch-b1'],
    })
  })

  it('预览透传主进程的真实级联影响，不做本地猜测', async () => {
    const preview = {
      kind: 'event',
      targetId: 'm1',
      targetLabel: '主干事件',
      eventIds: ['m1', 'a1', 'a2'],
      branchIds: ['branch-b1', 'branch-b2'],
      branchNames: ['级联支线', '嵌套支线'],
      eventCount: 3,
      branchCount: 2,
      fingerprint: 'fnv1a-00000000-0',
    }
    invoke.mockResolvedValue({ success: true, preview })

    const result = await useStoryTimelineStore.getState().previewEventDelete('m1')
    expect(invoke.mock.calls[0][1]).toBe('db:timeline-event-delete-preview')
    expect(result).toMatchObject({ success: true, preview })

    await useStoryTimelineStore.getState().previewBranchDelete('branch-b1')
    expect(invoke.mock.calls[1][1]).toBe('db:timeline-branch-delete-preview')
  })

  it('确认删除成功后按主进程返回的精确 ID 集合清理状态', async () => {
    invoke.mockResolvedValue({
      success: true,
      deletedEventIds: ['m1', 'a1', 'a2'],
      deletedBranchIds: ['branch-b1', 'branch-b2'],
    })

    const result = await useStoryTimelineStore.getState().deleteEventConfirmed('m1', 'fingerprint-1')

    expect(invoke.mock.calls[0][1]).toBe('db:timeline-event-delete-confirmed')
    expect(result.success).toBe(true)
    const state = useStoryTimelineStore.getState()
    expect(state.events).toEqual([])
    expect(state.branches.map(branch => branch.id)).toEqual(['main'])
    expect(state.expandedBranchIds).toEqual([STORY_TIMELINE_MAIN_BRANCH_ID])
  })

  it('影响集合变化时返回 needsReconfirmation，不删除数据、不报错误打扰', async () => {
    const freshPreview = {
      kind: 'event',
      targetId: 'm1',
      targetLabel: '主干事件',
      eventIds: ['m1', 'a1', 'a2', 'a3'],
      branchIds: ['branch-b1', 'branch-b2'],
      branchNames: ['级联支线', '嵌套支线'],
      eventCount: 4,
      branchCount: 2,
      fingerprint: 'fnv1a-ffffffff-0',
    }
    invoke.mockResolvedValue({
      success: false,
      needsReconfirmation: true,
      error: '删除影响自预览后已变化，请基于最新影响重新确认',
      preview: freshPreview,
    })

    const result = await useStoryTimelineStore.getState().deleteEventConfirmed('m1', 'stale-fingerprint')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.needsReconfirmation).toBe(true)
      expect(result.preview?.eventIds).toContain('a3')
    }
    // 数据与展开状态原样保留，UI 可基于最新预览重新确认
    const state = useStoryTimelineStore.getState()
    expect(state.events).toHaveLength(3)
    expect(state.branches).toHaveLength(3)
    expect(state.expandedBranchIds).toEqual([STORY_TIMELINE_MAIN_BRANCH_ID, 'branch-b1'])
    expect(toastError).not.toHaveBeenCalled()
  })

  it('确认删除的硬失败保留状态并给出可理解错误', async () => {
    invoke.mockResolvedValue({ success: false, error: 'database is locked' })

    const result = await useStoryTimelineStore.getState().deleteBranchConfirmed('branch-b1', 'fingerprint-2')

    expect(result).toMatchObject({ success: false, error: 'database is locked' })
    expect(useStoryTimelineStore.getState().branches).toHaveLength(3)
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('database is locked'))
  })

  it('确认删除在会话失效时不触碰当前状态', async () => {
    let resolveDelete!: (value: unknown) => void
    invoke.mockImplementationOnce(() => new Promise<unknown>(resolve => { resolveDelete = resolve }))

    const pending = useStoryTimelineStore.getState().deleteEventConfirmed('m1', 'fingerprint-3')
    activate(b)
    resolveDelete({ success: true, deletedEventIds: ['m1'], deletedBranchIds: [] })
    const result = await pending

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('会话已切换') })
    expect(useStoryTimelineStore.getState().events).toHaveLength(3)
    expect(useStoryTimelineStore.getState().branches).toHaveLength(3)
  })
})

describe('story-timeline-store 旧布尔 API 兼容', () => {
  beforeEach(() => {
    useStoryTimelineStore.setState({
      branches: [mainBranch, branchB1, branchB2],
      events: [eventM1, eventA1, eventA2],
      expandedBranchIds: [STORY_TIMELINE_MAIN_BRANCH_ID, 'branch-b1'],
    })
  })

  it('upsertEvent 失败必须返回 false，绝不能把失败当作成功 Promise', async () => {
    invoke.mockResolvedValue({ success: false, error: 'disk full' })

    const saved = await useStoryTimelineStore.getState().upsertEvent({ ...eventM1, title: '修改后的事件' })

    expect(saved).toBe(false)
    // 保存失败：原事件保持原内容，修改没有被应用
    const state = useStoryTimelineStore.getState()
    expect(state.events).toHaveLength(3)
    expect(state.events.find(event => event.id === 'm1')?.title).toBe('主干事件')
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('upsertEvent 成功返回 true 并应用返回的事件数据', async () => {
    invoke.mockResolvedValue({ success: true, event: { ...eventM1, title: '已保存标题' } })

    const saved = await useStoryTimelineStore.getState().upsertEvent({ ...eventM1 })

    expect(saved).toBe(true)
    const events = useStoryTimelineStore.getState().events
    expect(events).toHaveLength(3)
    expect(events.find(event => event.id === 'm1')?.title).toBe('已保存标题')
  })

  it('旧 deleteEvent 在会话失效时不写状态（旧 lease 删除结果被丢弃）', async () => {
    let resolveDelete!: (value: unknown) => void
    invoke.mockImplementationOnce(() => new Promise<unknown>(resolve => { resolveDelete = resolve }))

    const pending = useStoryTimelineStore.getState().deleteEvent('m1')
    activate(b)
    resolveDelete({ success: true })
    const deleted = await pending

    expect(deleted).toBe(false)
    // 状态不被旧会话结果污染
    expect(useStoryTimelineStore.getState().events).toHaveLength(3)
  })

  it('旧 deleteEvent 删除成功但快照刷新失败时，仍如实报告删除成功', async () => {
    invoke.mockImplementation((_session, channel) => {
      if (channel === 'db:timeline-event-delete') return Promise.resolve({ success: true })
      return Promise.reject(new Error('snapshot read failed'))
    })

    const deleted = await useStoryTimelineStore.getState().deleteEvent('m1')

    expect(deleted).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('旧 deleteBranch 拒绝主时间轴且不发起 IPC', async () => {
    const deleted = await useStoryTimelineStore.getState().deleteBranch(STORY_TIMELINE_MAIN_BRANCH_ID)

    expect(deleted).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('主时间轴不可删除'))
  })
})
