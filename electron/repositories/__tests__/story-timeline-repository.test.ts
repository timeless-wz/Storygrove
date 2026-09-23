import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, initProjectDatabase } from '../../database'
import { StoryTimelineRepository } from '../story-timeline-repository'
import type { StoryTimelineEvent } from '../../../src/shared/story-timeline'

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
})
