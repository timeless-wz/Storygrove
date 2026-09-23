import { describe, expect, it } from 'vitest'
import { locateForeshadowingInText } from '../foreshadowing-locator'

describe('foreshadowing-locator', () => {
  const originalText = '夜色如墨，李玄机握紧了手中的青铜残片，眼中闪过一丝决然。这是师尊临终前交给他的唯一遗物。'

  it('locates text via Priority 1 (exact offset)', () => {
    const selectedText = '青铜残片'
    const startOffset = originalText.indexOf(selectedText)
    const endOffset = startOffset + selectedText.length

    const res = locateForeshadowingInText(originalText, {
      selectedText,
      startOffset,
      endOffset,
      contextBefore: '握紧了手中的',
      contextAfter: '，眼中闪过',
    })

    expect(res.located).toBe(true)
    expect(res.reason).toBe('exact_offset')
    expect(res.startOffset).toBe(startOffset)
    expect(res.endOffset).toBe(endOffset)
  })

  it('relocates text via Priority 2 (context match) when text is inserted before', () => {
    const selectedText = '青铜残片'
    const oldStart = originalText.indexOf(selectedText)
    const oldEnd = oldStart + selectedText.length

    // Insert 10 characters at the beginning
    const editedText = '【第十章开始】' + originalText

    const res = locateForeshadowingInText(editedText, {
      selectedText,
      startOffset: oldStart,
      endOffset: oldEnd,
      contextBefore: '握紧了手中的',
      contextAfter: '，眼中闪过',
    })

    expect(res.located).toBe(true)
    expect(res.reason).toBe('context_match')
    expect(res.startOffset).toBe(editedText.indexOf(selectedText))
    expect(res.endOffset).toBe(editedText.indexOf(selectedText) + selectedText.length)
  })

  it('relocates text via Priority 2 (single-sided context) when after context is modified', () => {
    const selectedText = '青铜残片'
    const oldStart = originalText.indexOf(selectedText)
    const oldEnd = oldStart + selectedText.length

    const editedText = '新段落：李玄机握紧了手中的青铜残片，但此时神色却异常平静。'

    const res = locateForeshadowingInText(editedText, {
      selectedText,
      startOffset: oldStart,
      endOffset: oldEnd,
      contextBefore: '握紧了手中的',
      contextAfter: '，眼中闪过',
    })

    expect(res.located).toBe(true)
    expect(res.reason).toBe('context_match')
    expect(res.startOffset).toBe(editedText.indexOf(selectedText))
  })

  it('falls back to Priority 3 (unique occurrence) when context was changed but text is unique', () => {
    const uniqueText = '七绝天罡剑'
    const text = '群山之间风云变色。他在古刹深处发现了七绝天罡剑，寒芒吞吐不定。'

    const res = locateForeshadowingInText(text, {
      selectedText: uniqueText,
      startOffset: 0, // completely off
      endOffset: 5,
      contextBefore: '旧的上下文前缀',
      contextAfter: '旧的上下文后缀',
    })

    expect(res.located).toBe(true)
    expect(res.reason).toBe('unique_fallback')
    expect(res.startOffset).toBe(text.indexOf(uniqueText))
    expect(res.endOffset).toBe(text.indexOf(uniqueText) + uniqueText.length)
  })

  it('rejects with ambiguous when multiple matches exist without unique context', () => {
    const nonUnique = '残片'
    const text = '第一枚残片在山顶，第二枚残片在深渊，第三枚残片在魔宫。'

    const res = locateForeshadowingInText(text, {
      selectedText: nonUnique,
      startOffset: 100, // off
      endOffset: 102,
      contextBefore: '无相关上下文',
      contextAfter: '无相关上下文',
    })

    expect(res.located).toBe(false)
    expect(res.reason).toBe('ambiguous')
  })

  it('returns not_found when selected text is deleted', () => {
    const text = '这里所有的线索都已经被销毁了。'

    const res = locateForeshadowingInText(text, {
      selectedText: '青铜残片',
      startOffset: 10,
      endOffset: 14,
      contextBefore: '手中的',
      contextAfter: '，眼中',
    })

    expect(res.located).toBe(false)
    expect(res.reason).toBe('not_found')
  })
})
