import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { StoryTimelineRepository } from '../story-timeline-repository'
import { fingerprintStoryTimelineIds, type StoryTimelineEvent } from '../../../src/shared/story-timeline'

let projectRoot = ''
const testRoot = path.resolve('.runtime/.cache/story-timeline-repository-tests')

function makeEvent(overrides: Partial<StoryTimelineEvent> = {}): StoryTimelineEvent {
  return {
    id: 'arrival',
    title: '抵达雾港',
    timeLabel: '大荒历 317 年冬',
    sortOrder: 2,
    precision: 'exact',
    description: '主角第一次进入雾港。',
    chapterNumbers: [3],
    characterNames: ['许渡'],
    locationNodeIds: ['mist-port'],
    status: 'planned',
    ...overrides,
  }
}

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
  // 本地验证须用 Electron ABI；该进程退出前 Windows 会保留 SQLite WAL 句柄。
  // 测试目录位于可再生的 .runtime 缓存，交由后续缓存清理处理。
})

describe('StoryTimelineRepository', () => {
  it('starts with an empty project-scoped timeline and sensible manual ruler defaults', () => {
    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.events).toEqual([])
    expect(snapshot.settings).toMatchObject({
      title: '故事时间线',
      rulerLabel: '故事时间',
      rulerUnit: '刻度',
    })
  })

  it('persists custom ruler settings and fully author-supplied event data', () => {
    const settings = StoryTimelineRepository.saveSettings({
      title: '未竟之书纪年',
      rulerLabel: '大荒纪年',
      rulerUnit: '季',
    })
    expect(settings).toMatchObject({ title: '未竟之书纪年', rulerLabel: '大荒纪年', rulerUnit: '季' })

    StoryTimelineRepository.upsertEvent(makeEvent({
      precision: 'range',
      rangeEndLabel: '大荒历 318 年春',
      chapterNumbers: [3, 3, 4],
      characterNames: ['许渡', '许渡', '周晓'],
      locationNodeIds: ['mist-port', 'mist-port'],
    }))

    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.settings.title).toBe('未竟之书纪年')
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]).toMatchObject({
      timeLabel: '大荒历 317 年冬',
      rangeEndLabel: '大荒历 318 年春',
      chapterNumbers: [3, 4],
      characterNames: ['许渡', '周晓'],
      locationNodeIds: ['mist-port'],
    })
  })

  it('orders independent story events by manual ruler position and supports reordering', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'arrival', sortOrder: 20 }))
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'prologue', title: '序幕', timeLabel: '大荒历 316 年秋', sortOrder: 10 }))

    expect(StoryTimelineRepository.getAll().events.map(event => event.id)).toEqual(['prologue', 'arrival'])

    StoryTimelineRepository.reorderEvents(['arrival', 'prologue'])
    expect(StoryTimelineRepository.getAll().events.map(event => event.id)).toEqual(['arrival', 'prologue'])

    StoryTimelineRepository.deleteEvent('arrival')
    expect(StoryTimelineRepository.getAll().events.map(event => event.id)).toEqual(['prologue'])
  })

  it('supports creating, retrieving, and cascading deleting branches and their events', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10, title: '主干事件' }))

    const branch = StoryTimelineRepository.upsertBranch({
      id: 'branch-1',
      name: '暗河秘辛',
      sourceEventId: 'main-1',
      sortOrder: 1,
    })
    expect(branch).toMatchObject({ id: 'branch-1', name: '暗河秘辛', sourceEventId: 'main-1' })

    StoryTimelineRepository.upsertEvent(makeEvent({
      id: 'branch-event-1',
      branchId: 'branch-1',
      parentEventId: 'main-1',
      sortOrder: 15,
      title: '支线事件',
    }))

    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.branches).toHaveLength(2)
    expect(snapshot.branches).toMatchObject([
      { id: 'main', name: '主时间轴' },
      { id: 'branch-1', name: '暗河秘辛' },
    ])
    expect(snapshot.events).toHaveLength(2)

    StoryTimelineRepository.deleteBranch('branch-1')
    const afterDelete = StoryTimelineRepository.getAll()
    expect(afterDelete.branches).toEqual([
      expect.objectContaining({ id: 'main', name: '主时间轴' }),
    ])
    expect(afterDelete.events).toHaveLength(1)
    expect(afterDelete.events[0].id).toBe('main-1')
  })

  it('creates a branch and its first event atomically, never leaving an empty branch', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10, title: '主干事件' }))

    const committed = StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-atomic', name: '雾港暗线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({
        id: 'branch-atomic-1',
        branchId: 'branch-atomic',
        parentEventId: 'main-1',
        sortOrder: 12,
        title: '暗线首事件',
      }),
    )
    // 事务提交返回归一化后的支线与事件
    expect(committed.branch).toMatchObject({ id: 'branch-atomic', name: '雾港暗线', sourceEventId: 'main-1' })
    expect(committed.event).toMatchObject({ id: 'branch-atomic-1', branchId: 'branch-atomic', title: '暗线首事件' })

    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.branches.map(branch => branch.id)).toEqual(['main', 'branch-atomic'])
    expect(snapshot.events.map(event => event.id)).toEqual(['main-1', 'branch-atomic-1'])
  })

  it('rejects atomic creation that would occupy the main branch identity', () => {
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'main', name: '冒充主轴', sourceEventId: null, sortOrder: 9 },
      makeEvent({ id: 'fake-main-1', branchId: 'main', sortOrder: 11 }),
    )).toThrow()
    // 校验失败时不能留下半提交状态
    expect(StoryTimelineRepository.getAll().branches.map(branch => branch.id)).toEqual(['main'])
    expect(StoryTimelineRepository.getAll().events).toHaveLength(0)
  })

  it('rejects atomic creation when the source event does not exist in the current project', () => {
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-orphan', name: '无源支线', sourceEventId: 'ghost-event', sortOrder: 1 },
      makeEvent({ id: 'branch-orphan-1', branchId: 'branch-orphan', sortOrder: 2 }),
    )).toThrow(/来源事件不存在/)
    // 来源校验失败时支线与首事件都不能落库
    expect(StoryTimelineRepository.getAll().branches.map(branch => branch.id)).toEqual(['main'])
    expect(StoryTimelineRepository.getAll().events).toHaveLength(0)
  })

  it('rejects atomic creation when the first event claims a different branch', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-owner', name: '归属冲突支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'branch-owner-1', branchId: 'another-branch', sortOrder: 12 }),
    )).toThrow(/不一致/)
    expect(StoryTimelineRepository.getAll().branches.map(branch => branch.id)).toEqual(['main'])
    expect(StoryTimelineRepository.getAll().events.map(event => event.id)).toEqual(['main-1'])
  })

  it('normalizes an unassigned first event to the new branch while keeping strict backend validation', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    const committed = StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-lenient', name: '未声明归属', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'branch-lenient-1', sortOrder: 12 }),
    )
    expect(committed.event).toMatchObject({ id: 'branch-lenient-1', branchId: 'branch-lenient' })
    expect(StoryTimelineRepository.getAll().events.map(event => event.id)).toEqual(['main-1', 'branch-lenient-1'])
  })

  it('rejects atomic creation with invalid precision or status values', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-bad-precision', name: '坏精度', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'branch-bad-precision-1', sortOrder: 12, precision: 'someday' as StoryTimelineEvent['precision'] }),
    )).toThrow(/时间精度无效/)
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-bad-status', name: '坏状态', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'branch-bad-status-1', sortOrder: 12, status: 'archived' as StoryTimelineEvent['status'] }),
    )).toThrow(/状态无效/)
    expect(StoryTimelineRepository.getAll().branches.map(branch => branch.id)).toEqual(['main'])
    expect(StoryTimelineRepository.getAll().events.map(event => event.id)).toEqual(['main-1'])
  })

  it('rolls back the whole transaction when the second write step fails (fault injection)', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    // 第二步（写入首事件）注入故障：支线写入已在事务内完成，之后抛错必须整体回滚
    const spy = vi.spyOn(StoryTimelineRepository, 'upsertEvent')
      .mockImplementation(() => { throw new Error('injected second-step failure') })
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-injected', name: '注入故障支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'branch-injected-1', branchId: 'branch-injected', sortOrder: 12 }),
    )).toThrow('injected second-step failure')
    spy.mockRestore()

    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.branches.map(branch => branch.id)).toEqual(['main'])
    expect(snapshot.events).toHaveLength(1)

    // 故障解除后同一稳定 ID 重试可以完整成功
    const retry = StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-injected', name: '注入故障支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'branch-injected-1', branchId: 'branch-injected', sortOrder: 12 }),
    )
    expect(retry.branch).toMatchObject({ id: 'branch-injected' })
    expect(StoryTimelineRepository.getAll().branches.map(branch => branch.id)).toEqual(['main', 'branch-injected'])
  })

  it('converges duplicate submissions with stable IDs into one branch and one event', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    const payload = {
      branch: { id: 'branch-stable', name: '稳定重试支线', sourceEventId: 'main-1', sortOrder: 1 },
      event: makeEvent({ id: 'branch-stable-1', branchId: 'branch-stable', sortOrder: 12 }),
    }
    StoryTimelineRepository.createBranchWithEvent(payload.branch, payload.event)
    // 双击/网络重试：同一稳定 ID 再次提交，不产生重复支线
    StoryTimelineRepository.createBranchWithEvent(payload.branch, payload.event)

    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.branches.filter(branch => branch.id === 'branch-stable')).toHaveLength(1)
    expect(snapshot.events.filter(event => event.id === 'branch-stable-1')).toHaveLength(1)
    expect(snapshot.branches).toHaveLength(2)
    expect(snapshot.events).toHaveLength(2)
  })

  it('rejects branch source changes that would form a cycle through nested branches', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-outer', name: '外层支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'outer-1', branchId: 'branch-outer', sortOrder: 12 }),
    )
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-inner', name: '内层支线', sourceEventId: 'outer-1', sortOrder: 2 },
      makeEvent({ id: 'inner-1', branchId: 'branch-inner', sortOrder: 14 }),
    )

    // 把外层支线的来源改到内层支线的事件上：外层会成为自己的后代，必须拒绝
    expect(() => StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-outer', name: '外层支线', sourceEventId: 'inner-1', sortOrder: 1 },
      makeEvent({ id: 'outer-2', branchId: 'branch-outer', sortOrder: 13 }),
    )).toThrow(/形成环/)

    // 普通支线 upsert 变更来源同样接受环检测
    expect(() => StoryTimelineRepository.upsertBranch({
      id: 'branch-outer',
      name: '外层支线',
      sourceEventId: 'inner-1',
      sortOrder: 1,
    })).toThrow(/形成环/)

    // 来源未变化的重命名不受影响
    const renamed = StoryTimelineRepository.upsertBranch({
      id: 'branch-outer',
      name: '外层支线·改名',
      sourceEventId: 'main-1',
      sortOrder: 1,
    })
    expect(renamed).toMatchObject({ id: 'branch-outer', name: '外层支线·改名', sourceEventId: 'main-1' })
    // 拒绝后支线来源保持不变
    expect(StoryTimelineRepository.getAll().branches.find(branch => branch.id === 'branch-outer')?.sourceEventId).toBe('main-1')
  })

  it('previews event deletion impact over nested branches using the shared collection logic', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', title: '主干事件', sortOrder: 10 }))
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-n1', name: '一级支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'n1-a', branchId: 'branch-n1', sortOrder: 12 }),
    )
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'n1-b', branchId: 'branch-n1', sortOrder: 13 }))
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-n2', name: '二级支线', sourceEventId: 'n1-a', sortOrder: 2 },
      makeEvent({ id: 'n2-a', branchId: 'branch-n2', sortOrder: 15 }),
    )

    const preview = StoryTimelineRepository.previewEventDelete('main-1')
    expect(preview).toMatchObject({
      kind: 'event',
      targetId: 'main-1',
      targetLabel: '主干事件',
      eventIds: ['main-1', 'n1-a', 'n1-b', 'n2-a'],
      branchIds: ['branch-n1', 'branch-n2'],
      branchNames: ['一级支线', '二级支线'],
      eventCount: 4,
      branchCount: 2,
    })
    expect(preview.fingerprint).toBe(fingerprintStoryTimelineIds(preview.eventIds, preview.branchIds))

    // 中段事件删除：只连带自己的下游，不波及兄弟事件
    const midPreview = StoryTimelineRepository.previewEventDelete('n1-a')
    expect(midPreview.eventIds).toEqual(['n1-a', 'n2-a'])
    expect(midPreview.branchIds).toEqual(['branch-n2'])
  })

  it('previews branch deletion impact including nested descendants', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-b1', name: '根支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'b1-a', branchId: 'branch-b1', sortOrder: 12 }),
    )
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-b2', name: '嵌套支线', sourceEventId: 'b1-a', sortOrder: 2 },
      makeEvent({ id: 'b2-a', branchId: 'branch-b2', sortOrder: 15 }),
    )

    const preview = StoryTimelineRepository.previewBranchDelete('branch-b1')
    expect(preview).toMatchObject({
      kind: 'branch',
      targetId: 'branch-b1',
      targetLabel: '根支线',
      eventIds: ['b1-a', 'b2-a'],
      branchIds: ['branch-b1', 'branch-b2'],
      eventCount: 2,
      branchCount: 2,
    })
  })

  it('requires reconfirmation when the impact set changed after the preview', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-c1', name: '级联支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'c1-a', branchId: 'branch-c1', sortOrder: 12 }),
    )

    const preview = StoryTimelineRepository.previewEventDelete('main-1')
    expect(preview.eventIds).toEqual(['c1-a', 'main-1'])

    // 确认之前，预览范围内的下游支线上新增了事件
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'c1-b', branchId: 'branch-c1', sortOrder: 16 }))

    const result = StoryTimelineRepository.deleteEventConfirmed('main-1', preview.fingerprint)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.needsReconfirmation).toBe(true)
      expect(result.preview?.eventIds).toEqual(['c1-a', 'c1-b', 'main-1'])
      expect(result.preview?.eventCount).toBe(3)
    }
    // 未静默扩大删除范围：数据原样保留
    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.events.map(event => event.id).sort()).toEqual(['c1-a', 'c1-b', 'main-1'])
    expect(snapshot.branches.map(branch => branch.id).sort()).toEqual(['branch-c1', 'main'])

    // 用返回的最新预览重新确认后成功删除
    const freshFingerprint = result.success === false && result.preview
      ? result.preview.fingerprint
      : ''
    const committed = StoryTimelineRepository.deleteEventConfirmed('main-1', freshFingerprint)
    expect(committed.success).toBe(true)
    if (committed.success) {
      expect(committed.deletedEventIds.sort()).toEqual(['c1-a', 'c1-b', 'main-1'])
      expect(committed.deletedBranchIds).toEqual(['branch-c1'])
    }
    const afterDelete = StoryTimelineRepository.getAll()
    expect(afterDelete.events).toHaveLength(0)
    expect(afterDelete.branches.map(branch => branch.id)).toEqual(['main'])
  })

  it('deletes exactly the confirmed impact set and survives a database restart', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-2', sortOrder: 20 }))
    StoryTimelineRepository.createBranchWithEvent(
      { id: 'branch-r1', name: '重启支线', sourceEventId: 'main-1', sortOrder: 1 },
      makeEvent({ id: 'r1-a', branchId: 'branch-r1', sortOrder: 12 }),
    )

    const preview = StoryTimelineRepository.previewEventDelete('main-1')
    const committed = StoryTimelineRepository.deleteEventConfirmed('main-1', preview.fingerprint)
    expect(committed.success).toBe(true)

    // 模拟应用重启：关闭并重新打开同一项目数据库后读回
    closeProjectDatabase()
    initProjectDatabase(projectRoot)
    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.events.map(event => event.id)).toEqual(['main-2'])
    expect(snapshot.branches.map(branch => branch.id)).toEqual(['main'])
  })

  it('rejects deleting the main branch through preview, confirmed and legacy channels', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    expect(() => StoryTimelineRepository.previewBranchDelete('main')).toThrow(/不可删除/)
    expect(() => StoryTimelineRepository.deleteBranchConfirmed('main', 'any-fingerprint')).toThrow(/不可删除/)
    expect(() => StoryTimelineRepository.deleteBranch('main')).toThrow(/不可删除/)
    // 主时间轴事件仍在
    expect(StoryTimelineRepository.getAll().events).toHaveLength(1)
  })

  it('rejects deleting timeline range anchors instead of silently no-oping', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    for (const anchorId of ['timeline-anchor-start', 'timeline-anchor-end']) {
      expect(() => StoryTimelineRepository.previewEventDelete(anchorId)).toThrow(/锚点.*不可删除/)
      expect(() => StoryTimelineRepository.deleteEventConfirmed(anchorId, 'any-fingerprint')).toThrow(/锚点.*不可删除/)
      expect(() => StoryTimelineRepository.deleteEvent(anchorId)).toThrow(/锚点.*不可删除/)
    }
    expect(StoryTimelineRepository.getAll().events).toHaveLength(1)
  })

  it('keeps empty branches valid and readable, and deletes them cleanly', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    StoryTimelineRepository.upsertBranch({ id: 'branch-empty', name: '空支线', sourceEventId: 'main-1', sortOrder: 1 })

    // 空支线保持有效、可读取，不被静默清理
    const withEmpty = StoryTimelineRepository.getAll()
    expect(withEmpty.branches.map(branch => branch.id)).toEqual(['main', 'branch-empty'])
    expect(withEmpty.branches.find(branch => branch.id === 'branch-empty')?.name).toBe('空支线')

    const preview = StoryTimelineRepository.previewBranchDelete('branch-empty')
    expect(preview.eventCount).toBe(0)
    expect(preview.branchIds).toEqual(['branch-empty'])

    const committed = StoryTimelineRepository.deleteBranchConfirmed('branch-empty', preview.fingerprint)
    expect(committed.success).toBe(true)
    if (committed.success) {
      expect(committed.deletedEventIds).toEqual([])
      expect(committed.deletedBranchIds).toEqual(['branch-empty'])
    }
    expect(StoryTimelineRepository.getAll().branches.map(branch => branch.id)).toEqual(['main'])
  })

  it('reports missing preview targets with clear errors', () => {
    StoryTimelineRepository.upsertEvent(makeEvent({ id: 'main-1', sortOrder: 10 }))
    expect(() => StoryTimelineRepository.previewEventDelete('ghost-event')).toThrow(/不存在或已被删除/)
    expect(() => StoryTimelineRepository.previewBranchDelete('ghost-branch')).toThrow(/不存在或已被删除/)
    expect(() => StoryTimelineRepository.deleteEventConfirmed('ghost-event', 'fingerprint')).toThrow(/不存在或已被删除/)
  })
})
