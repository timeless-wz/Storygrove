import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearDraftEditorPosition,
  draftEditorPositionKey,
  readDraftEditorPosition,
  rememberDraftEditorPosition,
  rememberDraftEditorPositionIfAbsent,
  resetDraftEditorPositions,
  takeDraftEditorPosition,
  type DraftEditorPosition,
} from '../draft-editor-position'

const PROJECT_A = 'C:\\novels\\position-a'
const PROJECT_B = 'C:\\novels\\position-b'

function position(overrides: Partial<DraftEditorPosition> = {}): DraftEditorPosition {
  return {
    mode: 'ir',
    blockIndex: 3,
    offsetInBlock: 12,
    blockText: '浪涛拍打着防波堤。',
    sourceOffset: 0,
    scrollTop: 640,
    ...overrides,
  }
}

beforeEach(() => {
  resetDraftEditorPositions()
})

describe('draft-editor-position', () => {
  it('按项目路径 + 草稿 ID 隔离：切项目、切草稿都读不到对方的位置', () => {
    rememberDraftEditorPosition(draftEditorPositionKey(PROJECT_A, 10), position())
    rememberDraftEditorPosition(draftEditorPositionKey(PROJECT_B, 10), position({ blockIndex: 99 }))

    expect(readDraftEditorPosition(draftEditorPositionKey(PROJECT_A, 10))?.blockIndex).toBe(3)
    expect(readDraftEditorPosition(draftEditorPositionKey(PROJECT_B, 10))?.blockIndex).toBe(99)
    // 同一项目不同草稿互不影响。
    expect(readDraftEditorPosition(draftEditorPositionKey(PROJECT_A, 11))).toBeNull()
  })

  it('还原只发生一次：take 之后记忆被清空', () => {
    const key = draftEditorPositionKey(PROJECT_A, 10)
    rememberDraftEditorPosition(key, position())
    expect(takeDraftEditorPosition(key)?.scrollTop).toBe(640)
    expect(readDraftEditorPosition(key)).toBeNull()
    expect(takeDraftEditorPosition(key)).toBeNull()
  })

  it('卸载兜底记录不覆盖跳转前记录的更准位置', () => {
    const key = draftEditorPositionKey(PROJECT_A, 10)
    rememberDraftEditorPosition(key, position({ scrollTop: 640 }))

    // 卸载时正文已脱离文档，滚动距离读不到；兜底写入必须被忽略。
    rememberDraftEditorPositionIfAbsent(key, position({ scrollTop: 0, blockIndex: 4 }))

    expect(readDraftEditorPosition(key)?.scrollTop).toBe(640)
    expect(readDraftEditorPosition(key)?.blockIndex).toBe(3)
  })

  it('没有记忆时兜底记录生效（作者用其他方式离开正文也能回到原处）', () => {
    const key = draftEditorPositionKey(PROJECT_A, 10)
    rememberDraftEditorPositionIfAbsent(key, position({ scrollTop: 0 }))
    expect(readDraftEditorPosition(key)?.blockIndex).toBe(3)
  })

  it('非法记录一律拒绝：不写入，也读不出', () => {
    const key = draftEditorPositionKey(PROJECT_A, 10)
    rememberDraftEditorPosition(key, { mode: 'html' } as unknown as DraftEditorPosition)
    expect(readDraftEditorPosition(key)).toBeNull()

    rememberDraftEditorPosition(key, position())
    expect(readDraftEditorPosition(key)).not.toBeNull()
    // 空键不写入。
    rememberDraftEditorPosition('', position())
    expect(readDraftEditorPosition('')).toBeNull()
  })

  it('clear 与 reset 都能彻底丢弃记忆', () => {
    const keyA = draftEditorPositionKey(PROJECT_A, 10)
    const keyB = draftEditorPositionKey(PROJECT_B, 20)
    rememberDraftEditorPosition(keyA, position())
    rememberDraftEditorPosition(keyB, position())

    clearDraftEditorPosition(keyA)
    expect(readDraftEditorPosition(keyA)).toBeNull()
    expect(readDraftEditorPosition(keyB)).not.toBeNull()

    resetDraftEditorPositions()
    expect(readDraftEditorPosition(keyB)).toBeNull()
  })

  it('三种编辑器模式都能往返（分屏预览存源文本偏移）', () => {
    const key = draftEditorPositionKey(PROJECT_A, 10)
    rememberDraftEditorPosition(key, position({
      mode: 'sv', blockIndex: -1, offsetInBlock: 0, sourceOffset: 128, scrollTop: 0,
    }))
    const stored = readDraftEditorPosition(key)
    expect(stored?.mode).toBe('sv')
    expect(stored?.sourceOffset).toBe(128)
  })
})
