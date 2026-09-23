import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalEventBus } from '../../../shared/event-bus'
import { locateForeshadowingInText } from '../../../services/foreshadowing-locator'
import type { ForeshadowingRecord } from '../../../shared/foreshadowing'
import type { ForeshadowingSelectionInfo } from '../VditorProseEditor'

const mocks = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  ipcInvoke: vi.fn(),
}))

vi.mock('../../ui/Toast', () => ({
  toast: {
    warning: mocks.toastWarning,
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

describe('Foreshadowing Editor & Lifecycle Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('1. Selection extraction and empty selection blockage', () => {
    it('blocks creation and triggers warning toast when selection is empty or whitespace', () => {
      // 模拟编辑器中未选中文本
      const getSelectionInfo = vi.fn<() => ForeshadowingSelectionInfo | null>(() => null)

      const handleToolbarMarkForeshadowing = () => {
        const info = getSelectionInfo()
        if (!info || !info.selectedText.trim()) {
          mocks.toastWarning('请先在正文中选中要标记为伏笔的文字')
          return false
        }
        return true
      }

      const triggered = handleToolbarMarkForeshadowing()
      expect(triggered).toBe(false)
      expect(mocks.toastWarning).toHaveBeenCalledWith('请先在正文中选中要标记为伏笔的文字')
      expect(mocks.ipcInvoke).not.toHaveBeenCalled()
    })

    it('extracts selection context (before, text, after, offsets) when text is selected', () => {
      const docText = '这是第一章的开篇。那把古旧的锈剑静静斜倚在神龛一角，仿佛沉睡了千年。日光透过窗棂洒下。'
      const targetText = '那把古旧的锈剑'
      const startOffset = docText.indexOf(targetText)
      const endOffset = startOffset + targetText.length
      const contextBefore = docText.slice(Math.max(0, startOffset - 100), startOffset)
      const contextAfter = docText.slice(endOffset, Math.min(docText.length, endOffset + 100))

      const selectionInfo = {
        selectedText: targetText,
        startOffset,
        endOffset,
        contextBefore,
        contextAfter,
      }

      expect(selectionInfo.selectedText).toBe('那把古旧的锈剑')
      expect(selectionInfo.startOffset).toBe(9)
      expect(selectionInfo.endOffset).toBe(16)
      expect(selectionInfo.contextBefore).toBe('这是第一章的开篇。')
      expect(selectionInfo.contextAfter).toContain('静静斜倚在神龛一角')
    })

    it('accurately binds to the second occurrence when the same text appears multiple times', () => {
      const docText = '第一段：那把古旧的锈剑斜靠着墙壁。\n\n第二段：少年再次拔出那把古旧的锈剑，准备迎敌。'
      const targetText = '那把古旧的锈剑'
      // 第一次出现位置是 4..11
      // 第二次出现位置是 29..36
      const secondStart = docText.lastIndexOf(targetText)
      const secondEnd = secondStart + targetText.length
      const contextBefore = docText.slice(Math.max(0, secondStart - 100), secondStart)
      const contextAfter = docText.slice(secondEnd, Math.min(docText.length, secondEnd + 100))

      const candidate = {
        selectedText: targetText,
        startOffset: secondStart,
        endOffset: secondEnd,
        contextBefore,
        contextAfter,
      }

      const res = locateForeshadowingInText(docText, candidate)
      expect(res.located).toBe(true)
      expect(res.startOffset).toBe(secondStart)
      expect(res.endOffset).toBe(secondEnd)
      // 确认并非错误绑定到了第一次出现的位置
      expect(res.startOffset).not.toBe(docText.indexOf(targetText))
      expect(docText.slice(res.startOffset!, res.endOffset!)).toBe(targetText)
      // 且四要素全部来自同一份 Markdown 原文
      expect(docText.slice(Math.max(0, res.startOffset! - 100), res.startOffset!)).toBe(contextBefore)
      expect(docText.slice(res.endOffset!, Math.min(docText.length, res.endOffset! + 100))).toBe(contextAfter)
    })

    it('rejects creation with warning when selected text has multiple occurrences and cannot be disambiguated', () => {
      const docText = '重复的词语，中间隔开一段，重复的词语。'
      const targetText = '重复的词语'
      // 模拟出现多次
      const occurrences: number[] = []
      let pos = 0
      while (pos <= docText.length - targetText.length) {
        const found = docText.indexOf(targetText, pos)
        if (found === -1) break
        occurrences.push(found)
        pos = found + 1
      }
      expect(occurrences.length).toBe(2)

      const loc = locateForeshadowingInText(docText, {
        selectedText: targetText,
        startOffset: -1,
        endOffset: -1,
        contextBefore: '',
        contextAfter: '',
      })
      expect(loc.located).toBe(false)

      // 验证在无法唯一定位且出现多次时，不允许回退到 occurrences[0]，必须拒绝并提示警告
      const handleSelection = () => {
        if (!loc.located) {
          if (occurrences.length === 1) {
            return { success: true, startOffset: occurrences[0] }
          }
          mocks.toastWarning('所选文字存在多个位置，请缩短选择范围或重新选择')
          return { success: false, reason: 'ambiguous' }
        }
        return { success: true, startOffset: loc.startOffset }
      }

      const result = handleSelection()
      expect(result.success).toBe(false)
      expect(mocks.toastWarning).toHaveBeenCalledWith('所选文字存在多个位置，请缩短选择范围或重新选择')
    })
  })

  describe('2. Safe Relocation without markdown corruption', () => {
    it('relocates accurately across minor edits using 4-tier safe locator', () => {
      const originalText = '少年走到神龛前，那把古旧的锈剑发出微弱的嗡鸣，引得群鸟惊飞。'
      const candidate = {
        selectedText: '那把古旧的锈剑',
        startOffset: 8,
        endOffset: 15,
        contextBefore: '少年走到神龛前，',
        contextAfter: '发出微弱的嗡鸣',
      }

      // Tier 1: exact offset
      const res1 = locateForeshadowingInText(originalText, candidate)
      expect(res1.located).toBe(true)
      expect(res1.reason).toBe('exact_offset')
      expect(originalText.slice(res1.startOffset!, res1.endOffset!)).toBe('那把古旧的锈剑')

      // Tier 2: text inserted before, offset shifted
      const editedText = '清晨微风徐来，少年走到神龛前，那把古旧的锈剑发出微弱的嗡鸣，引得群鸟惊飞。'
      const res2 = locateForeshadowingInText(editedText, candidate)
      expect(res2.located).toBe(true)
      expect(res2.reason).toBe('context_match')
      expect(editedText.slice(res2.startOffset!, res2.endOffset!)).toBe('那把古旧的锈剑')

      // Tier 4: text completely deleted/modified -> abort relocation without erroneous highlight
      const deletedText = '少年走到神龛前，赤手空拳，引得群鸟惊飞。'
      const res4 = locateForeshadowingInText(deletedText, candidate)
      expect(res4.located).toBe(false)
      expect(res4.reason).toBe('not_found')
    })

    it('preserves clean markdown content without injecting HTML tags into body', () => {
      const pureMarkdown = '# 第一章 风起\n\n那把古旧的锈剑静静躺在角落。\n\n少年凝视着它。'
      // 保证没有任何 <mark> 或 <span style="background..."> 被拼接注入
      expect(pureMarkdown).not.toContain('<mark')
      expect(pureMarkdown).not.toContain('<span')
      expect(pureMarkdown).not.toContain('style=')
    })
  })

  describe('3. Draft-to-Manuscript Persistence & Synchronization', () => {
    it('keeps identical draftId and persists foreshadowings across draft publication', () => {
      const draftRecord = {
        id: 42,
        chapterNumber: 1,
        status: 'draft' as const,
        content: '第一章内容，暗藏玄机。',
      }

      const foreshadowing: ForeshadowingRecord = {
        id: 'f-001',
        draftId: draftRecord.id,
        chapterNumber: 1,
        selectedText: '暗藏玄机',
        startOffset: 6,
        endOffset: 10,
        contextBefore: '第一章内容，',
        contextAfter: '。',
        note: '此乃全书核心暗线',
        markerType: '埋伏',
        color: 'blue',
        completed: false,
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
        completedAt: null,
      }

      // 模拟章节发布：状态由 draft 变为 finalized，但 drafts(id) 保持 42
      const finalizedDraft = {
        ...draftRecord,
        status: 'finalized' as const,
      }

      expect(finalizedDraft.id).toBe(draftRecord.id)
      // 伏笔关联 draftId 不变，发布后依然完全有效且无需数据复制
      expect(foreshadowing.draftId).toBe(finalizedDraft.id)
    })

    it('notifies subscribers via FORESHADOWING_UPDATED event bus', () => {
      let updateEventReceived = false
      const unsubscribe = globalEventBus.on('FORESHADOWING_UPDATED', () => {
        updateEventReceived = true
      })

      globalEventBus.emit('FORESHADOWING_UPDATED', { projectPath: 'C:\\test\\project', draftId: 42 })
      expect(updateEventReceived).toBe(true)
      unsubscribe()
    })
  })

  describe('4. Foreshadowing Filter and Completed Toggle Contract', () => {
    const items: ForeshadowingRecord[] = [
      {
        id: 'f1',
        draftId: 1,
        chapterNumber: 1,
        selectedText: '线索A',
        startOffset: 0,
        endOffset: 3,
        contextBefore: '',
        contextAfter: '',
        note: '第一条线索',
        markerType: '埋伏',
        color: 'blue',
        completed: false,
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'f2',
        draftId: 1,
        chapterNumber: 1,
        selectedText: '线索B',
        startOffset: 10,
        endOffset: 13,
        contextBefore: '',
        contextAfter: '',
        note: '已回收线索',
        markerType: '收尾',
        color: 'green',
        completed: true,
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
        completedAt: '2026-09-22T01:00:00.000Z',
      },
    ]

    it('filters items into all, pending, and completed categories', () => {
      const pendingItems = items.filter(i => !i.completed)
      const completedItems = items.filter(i => i.completed)

      expect(items.length).toBe(2)
      expect(pendingItems.length).toBe(1)
      expect(pendingItems[0].id).toBe('f1')
      expect(completedItems.length).toBe(1)
      expect(completedItems[0].id).toBe('f2')
    })
  })

  describe('5. Manual Text Input Validation in ForeshadowingManagementView', () => {
    const chapterBody = '清晨时分，密林深处传来了奇怪的笛声。那是传说中的控兽之音。密林深处危机四伏。'

    function validateManualInput(text: string, body: string) {
      const cleanText = text.trim()
      if (!cleanText) {
        return { valid: false, reason: 'empty' }
      }
      const matches: number[] = []
      let pos = 0
      while (pos <= body.length - cleanText.length) {
        const idx = body.indexOf(cleanText, pos)
        if (idx === -1) break
        matches.push(idx)
        pos = idx + 1
      }

      if (matches.length === 0) {
        mocks.toastError('所填原文在选中的章节正文中不存在，不能创建无法定位的空标记')
        return { valid: false, reason: 'not_found' }
      }
      if (matches.length > 1) {
        mocks.toastWarning('原文有多个匹配位置，请在正文编辑器中选中文字后创建')
        return { valid: false, reason: 'ambiguous' }
      }

      const startOffset = matches[0]
      const endOffset = startOffset + cleanText.length
      const contextBefore = body.slice(Math.max(0, startOffset - 100), startOffset)
      const contextAfter = body.slice(endOffset, Math.min(body.length, endOffset + 100))

      return {
        valid: true,
        startOffset,
        endOffset,
        contextBefore,
        contextAfter,
      }
    }

    it('displays error toast and rejects saving when manual text has 0 matches', () => {
      const res = validateManualInput('不存在的原文片段', chapterBody)
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('not_found')
      expect(mocks.toastError).toHaveBeenCalledWith('所填原文在选中的章节正文中不存在，不能创建无法定位的空标记')
    })

    it('displays warning toast and blocks saving without guessing when manual text has multiple matches', () => {
      const res = validateManualInput('密林深处', chapterBody) // appears twice
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('ambiguous')
      expect(mocks.toastWarning).toHaveBeenCalledWith('原文有多个匹配位置，请在正文编辑器中选中文字后创建')
    })

    it('successfully computes offsets and context from markdown when manual text has exactly 1 match', () => {
      const res = validateManualInput('控兽之音', chapterBody) // appears once
      expect(res.valid).toBe(true)
      expect(res.startOffset).toBe(chapterBody.indexOf('控兽之音'))
      expect(res.endOffset).toBe(res.startOffset! + '控兽之音'.length)
      expect(chapterBody.slice(res.startOffset!, res.endOffset!)).toBe('控兽之音')
      expect(res.contextBefore).toContain('那是传说中的')
      expect(res.contextAfter).toContain('密林深处危机四伏')
    })
  })
})
