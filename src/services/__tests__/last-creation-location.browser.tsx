import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import {
  formatLocationKind,
  formatSavedAt,
  readLastCreationLocation,
  recordLastCreationLocation,
} from '../last-creation-location'

const PROJECT_A = 'D:/novels/project-a'
const PROJECT_B = 'D:/novels/project-b'

beforeEach(async () => {
  await page.viewport(1280, 860)
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('last-creation-location', () => {
  it('记录后原样读回（真实保存 → 读取展示的字段往返）', () => {
    const savedAt = new Date('2026-09-27T10:00:00+08:00').toISOString()
    recordLastCreationLocation(PROJECT_A, {
      kind: 'draft',
      chapterNumber: 3,
      title: '刻痕之谜',
      savedAt,
      draftId: 7,
    })
    expect(readLastCreationLocation(PROJECT_A)).toEqual({
      kind: 'draft',
      chapterNumber: 3,
      title: '刻痕之谜',
      savedAt,
      draftId: 7,
    })

    recordLastCreationLocation(PROJECT_A, {
      kind: 'blueprint',
      chapterNumber: 5,
      title: '外门大比',
      savedAt,
    })
    expect(readLastCreationLocation(PROJECT_A)?.kind).toBe('blueprint')
    expect(readLastCreationLocation(PROJECT_A)?.draftId).toBeUndefined()
  })

  it('按项目路径隔离：切换项目读不到另一个项目的记录', () => {
    const savedAt = new Date().toISOString()
    recordLastCreationLocation(PROJECT_A, {
      kind: 'chapter-canvas',
      chapterNumber: 2,
      title: '验牌',
      savedAt,
    })
    expect(readLastCreationLocation(PROJECT_B)).toBeNull()
    expect(readLastCreationLocation(PROJECT_A)?.chapterNumber).toBe(2)
  })

  it('损坏或非法的记录一律返回 null，由概览回退既有流程', () => {
    window.localStorage.setItem('vela:last-creation-location:' + PROJECT_A, '{not-json')
    expect(readLastCreationLocation(PROJECT_A)).toBeNull()

    window.localStorage.setItem(
      'vela:last-creation-location:' + PROJECT_A,
      JSON.stringify({ kind: 'browsing', chapterNumber: 1, title: 'x', savedAt: new Date().toISOString() }),
    )
    expect(readLastCreationLocation(PROJECT_A)).toBeNull()

    window.localStorage.setItem(
      'vela:last-creation-location:' + PROJECT_A,
      JSON.stringify({ kind: 'draft', chapterNumber: 0, title: 'x', savedAt: new Date().toISOString() }),
    )
    expect(readLastCreationLocation(PROJECT_A)).toBeNull()

    window.localStorage.setItem(
      'vela:last-creation-location:' + PROJECT_A,
      JSON.stringify({ kind: 'draft', chapterNumber: 1, title: 'x', savedAt: 'not-a-date' }),
    )
    expect(readLastCreationLocation(PROJECT_A)).toBeNull()
  })

  it('无效输入不写入；项目路径缺失不写入', () => {
    recordLastCreationLocation(PROJECT_A, {
      kind: 'draft',
      chapterNumber: -1,
      title: 'x',
      savedAt: new Date().toISOString(),
    })
    expect(readLastCreationLocation(PROJECT_A)).toBeNull()

    recordLastCreationLocation(null, {
      kind: 'draft',
      chapterNumber: 1,
      title: 'x',
      savedAt: new Date().toISOString(),
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('时间展示分级：刚刚 / 分钟 / 小时 / 昨天 / 天数 / 日期', () => {
    const now = new Date('2026-09-27T12:00:00+08:00').getTime()
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString()

    expect(formatSavedAt(at(0), now)).toEqual({ zh: '刚刚', en: 'just now' })
    expect(formatSavedAt(at(5), now)).toEqual({ zh: '5 分钟前', en: '5 min ago' })
    expect(formatSavedAt(at(90), now)).toEqual({ zh: '1 小时前', en: '1 h ago' })
    expect(formatSavedAt(at(60 * 26), now)).toEqual({ zh: '昨天', en: 'yesterday' })
    expect(formatSavedAt(at(60 * 24 * 5), now)).toEqual({ zh: '5 天前', en: '5 d ago' })
    expect(formatSavedAt(at(60 * 24 * 45), now).zh).toBe('2026/8/13')
    expect(formatSavedAt('not-a-date', now)).toEqual({ zh: '', en: '' })
  })

  it('类别展示名覆盖三种目标', () => {
    expect(formatLocationKind('draft').zh).toBe('正文')
    expect(formatLocationKind('blueprint').zh).toBe('章节蓝图')
    expect(formatLocationKind('chapter-canvas').zh).toBe('场景画布')
  })
})
