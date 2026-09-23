/**
 * 伏笔正文重定位算法服务
 *
 * 优先级规则：
 * 1. 原始起止位置处的文本仍与 selectedText 一致；
 * 2. 使用 contextBefore + selectedText + contextAfter 在最新正文中匹配；
 * 3. 仅在能唯一、安全定位时返回坐标；
 * 4. 不能可靠定位时返回 located: false，不进行错误高亮。
 */

export interface ForeshadowingLocationCandidate {
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore?: string
  contextAfter?: string
}

export interface ForeshadowingLocationResult {
  located: boolean
  startOffset?: number
  endOffset?: number
  reason: 'exact_offset' | 'context_match' | 'unique_fallback' | 'not_found' | 'ambiguous'
}

function countOccurrences(text: string, pattern: string): number[] {
  if (!pattern) return []
  const indices: number[] = []
  let pos = 0
  while (pos <= text.length - pattern.length) {
    const found = text.indexOf(pattern, pos)
    if (found === -1) break
    indices.push(found)
    pos = found + 1
  }
  return indices
}

export function locateForeshadowingInText(
  text: string,
  candidate: ForeshadowingLocationCandidate,
): ForeshadowingLocationResult {
  const { selectedText, startOffset, endOffset, contextBefore = '', contextAfter = '' } = candidate

  if (!selectedText || !selectedText.trim()) {
    return { located: false, reason: 'not_found' }
  }

  // ===== 优先级 1：原始起止偏移检查 =====
  if (
    startOffset >= 0
    && endOffset <= text.length
    && startOffset < endOffset
  ) {
    const rawSlice = text.slice(startOffset, endOffset)
    if (rawSlice === selectedText) {
      // 进一步校验上下文是否有剧烈矛盾
      const beforeMatches = !contextBefore || text.slice(Math.max(0, startOffset - contextBefore.length), startOffset) === contextBefore
      const afterMatches = !contextAfter || text.slice(endOffset, Math.min(text.length, endOffset + contextAfter.length)) === contextAfter
      if (beforeMatches || afterMatches) {
        return {
          located: true,
          startOffset,
          endOffset,
          reason: 'exact_offset',
        }
      }
    }
  }

  // ===== 优先级 2：完整上下文匹配 =====
  if (contextBefore || contextAfter) {
    const fullPattern = contextBefore + selectedText + contextAfter
    const fullMatches = countOccurrences(text, fullPattern)

    if (fullMatches.length === 1) {
      const matchStart = fullMatches[0]
      const newStart = matchStart + contextBefore.length
      const newEnd = newStart + selectedText.length
      return {
        located: true,
        startOffset: newStart,
        endOffset: newEnd,
        reason: 'context_match',
      }
    }

    if (fullMatches.length > 1) {
      return { located: false, reason: 'ambiguous' }
    }

    // 若完整上下文被小幅编辑，尝试单侧上下文唯一匹配
    if (contextBefore) {
      const beforePattern = contextBefore + selectedText
      const beforeMatches = countOccurrences(text, beforePattern)
      if (beforeMatches.length === 1) {
        const newStart = beforeMatches[0] + contextBefore.length
        const newEnd = newStart + selectedText.length
        return {
          located: true,
          startOffset: newStart,
          endOffset: newEnd,
          reason: 'context_match',
        }
      }
    }

    if (contextAfter) {
      const afterPattern = selectedText + contextAfter
      const afterMatches = countOccurrences(text, afterPattern)
      if (afterMatches.length === 1) {
        const newStart = afterMatches[0]
        const newEnd = newStart + selectedText.length
        return {
          located: true,
          startOffset: newStart,
          endOffset: newEnd,
          reason: 'context_match',
        }
      }
    }

    // 尝试就近单行上下文唯一匹配（应对渲染 DOM 与 Markdown 跨段换行差异）
    if (contextBefore && contextBefore.includes('\n')) {
      const lastLineBefore = contextBefore.split('\n').pop()?.trim()
      if (lastLineBefore) {
        const lineBeforePattern = lastLineBefore + selectedText
        const lineMatches = countOccurrences(text, lineBeforePattern)
        if (lineMatches.length === 1) {
          const newStart = lineMatches[0] + lastLineBefore.length
          const newEnd = newStart + selectedText.length
          return {
            located: true,
            startOffset: newStart,
            endOffset: newEnd,
            reason: 'context_match',
          }
        }
      }
    }

    if (contextAfter && contextAfter.includes('\n')) {
      const firstLineAfter = contextAfter.split('\n')[0]?.trim()
      if (firstLineAfter) {
        const lineAfterPattern = selectedText + firstLineAfter
        const lineMatches = countOccurrences(text, lineAfterPattern)
        if (lineMatches.length === 1) {
          const newStart = lineMatches[0]
          const newEnd = newStart + selectedText.length
          return {
            located: true,
            startOffset: newStart,
            endOffset: newEnd,
            reason: 'context_match',
          }
        }
      }
    }
  }

  // ===== 优先级 3：仅在原文唯一出现时安全回退 =====
  const textMatches = countOccurrences(text, selectedText)
  if (textMatches.length === 1) {
    const newStart = textMatches[0]
    const newEnd = newStart + selectedText.length
    return {
      located: true,
      startOffset: newStart,
      endOffset: newEnd,
      reason: 'unique_fallback',
    }
  }

  if (textMatches.length > 1) {
    return { located: false, reason: 'ambiguous' }
  }

  // ===== 优先级 4：未找到 =====
  return { located: false, reason: 'not_found' }
}
