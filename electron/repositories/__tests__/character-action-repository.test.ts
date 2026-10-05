/**
 * 人物行动线仓库测试 — 临时项目库（knowledge-action-outline-sync-contract §4）。
 * 覆盖验收矩阵 5/6：共享事件但各自目的不同、不复制时间线节点；
 * 幕后行动不自动变成计划或读者已见；排入时间线幂等。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../database'
import { CharacterActionRepository } from '../character-action-repository'
import { StoryTimelineRepository } from '../story-timeline-repository'

const testRoot = path.resolve('.runtime/.cache/character-action-repository-tests')

let projectRoot = ''

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
})

function actionDraft(overrides = {}) {
  return {
    characterId: 'ch-1',
    title: '夜探藏书楼',
    goal: '在身份暴露前找到父亲留下的名册',
    resources: '后门钥匙、夜行衣',
    constraints: '不能惊动巡夜人',
    basedOnKnowledgeIds: [],
    plannedNote: '计划在初三夜里有雾时行动',
    storyPosition: { kind: 'unplaced' as const },
    narrativePosition: { kind: 'unplaced' as const },
    visibility: 'off-stage' as const,
    status: 'plan' as const,
    relatedChapterNumbers: [3, 4],
    ...overrides,
  }
}

describe('CharacterActionRepository', () => {
  it('保存与读取：复杂字段在往返后保持一致，事件投影从时间线 join', () => {
    const event = StoryTimelineRepository.upsertEvent({
      id: 'evt-1',
      title: '藏书楼夜火',
      timeLabel: '三月初三夜',
      sortOrder: 10,
      precision: 'exact',
      description: '',
      chapterNumbers: [4],
      characterNames: ['周晓'],
      locationNodeIds: [],
      status: 'planned',
      isHistorical: false,
      outcome: '名册烧毁一半',
      aftermath: '巡夜人开始怀疑',
    })
    const saved = CharacterActionRepository.saveAction(actionDraft({
      eventId: event.id,
      plannedNote: undefined,
      storyPosition: { kind: 'timeline-event', eventId: event.id },
      outcome: '拿到残页',
    }))
    expect(saved.success).toBe(true)

    const list = CharacterActionRepository.listActions({ characterId: 'ch-1' })
    expect(list).toHaveLength(1)
    const view = list[0]!
    expect(view.title).toBe('夜探藏书楼')
    expect(view.resources).toBe('后门钥匙、夜行衣')
    expect(view.relatedChapterNumbers).toEqual([3, 4])
    expect(view.visibility).toBe('off-stage')
    // 事件信息是只读投影：标题/结果从事件记录展示，不在行动线复制。
    expect(view.event?.title).toBe('藏书楼夜火')
    expect(view.event?.outcome).toBe('名册烧毁一半')
    expect(view.eventDangling).toBeFalsy()

    // 幕后行动仍是 plan 状态：不因幕后而自动变成"未发生"。
    expect(view.status).toBe('plan')
  })

  it('两人参与同一事件：共享事件 ID，各自目的不同，时间线节点不复制', () => {
    const event = StoryTimelineRepository.upsertEvent({
      id: 'evt-2',
      title: '城门对峙',
      timeLabel: '翌日清晨',
      sortOrder: 20,
      precision: 'unknown',
      description: '',
      chapterNumbers: [5],
      characterNames: ['周晓', '许渡'],
      locationNodeIds: [],
      status: 'planned',
      isHistorical: false,
    })
    CharacterActionRepository.saveAction(actionDraft({ characterId: 'ch-A', eventId: event.id, goal: '拖住守卫', plannedNote: undefined, storyPosition: { kind: 'timeline-event', eventId: event.id } }))
    CharacterActionRepository.saveAction(actionDraft({ characterId: 'ch-B', eventId: event.id, goal: '趁乱入城', plannedNote: undefined, storyPosition: { kind: 'timeline-event', eventId: event.id } }))
    const all = CharacterActionRepository.listActions()
    expect(all).toHaveLength(2)
    expect(all.filter(action => action.eventId === event.id)).toHaveLength(2)
    expect(all.map(action => action.goal).sort()).toEqual(['拖住守卫', '趁乱入城'])
    const snapshot = StoryTimelineRepository.getAll()
    expect(snapshot.events.filter(event => event.id === event.id)).toHaveLength(1)
  })

  it('promoteToTimeline 幂等：重复操作不重复创建事件', () => {
    const saved = CharacterActionRepository.saveAction(actionDraft({}))
    expect(saved.id).toBeTruthy()
    const first = CharacterActionRepository.promoteToTimeline({ id: saved.id!, characterName: '周晓', chapterNumbers: [3] })
    expect(first.success).toBe(true)
    expect(first.alreadyLinked).toBeFalsy()
    const second = CharacterActionRepository.promoteToTimeline({ id: saved.id!, characterName: '周晓' })
    expect(second.alreadyLinked).toBe(true)
    expect(second.eventId).toBe(first.eventId)
    const snapshot = StoryTimelineRepository.getAll()
    const created = snapshot.events.filter(event => event.title === '夜探藏书楼')
    expect(created).toHaveLength(1)
    expect(created[0]!.status).toBe('planned')
    expect(created[0]!.characterNames).toEqual(['周晓'])
  })

  it('未排入时间线的行动必须带计划说明；无正文依据不得伪造成 prose', () => {
    expect(() => CharacterActionRepository.saveAction(actionDraft({ plannedNote: undefined }))).toThrow(/计划/)
    expect(() => CharacterActionRepository.saveAction(actionDraft({ status: 'prose' }))).toThrow(/锚点/)
  })

  it('按章节过滤：叙事位置或关联章命中', () => {
    CharacterActionRepository.saveAction(actionDraft({ title: 'A', narrativePosition: { kind: 'chapter-scene', chapterNumber: 3 } }))
    CharacterActionRepository.saveAction(actionDraft({ title: 'B', narrativePosition: { kind: 'unplaced' }, relatedChapterNumbers: [7] }))
    const at3 = CharacterActionRepository.listActions({ chapterNumber: 3 })
    expect(at3.map(action => action.title)).toEqual(['A'])
    const at7 = CharacterActionRepository.listActions({ chapterNumber: 7 })
    expect(at7.map(action => action.title)).toEqual(['B'])
  })
})
