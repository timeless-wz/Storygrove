/**
 * VditorProseEditor — 正文写作页与文档页的通用 Vditor 编辑内核包装组件
 *
 * 设计约束：
 * - Vditor 的运行时资源（Lute 解析器、中文语言包、图标、代码高亮、内容主题）
 *   随仓库发布在 public/vditor/dist 下，`cdn` 必须指向这个本地目录；
 *   编辑器因此不会请求任何第三方地址。
 * - 不接入任何上传服务：图片按钮走本地 handler，只给出“待接入”提示。
 * - 字数统计沿用项目既有的 countDraftUnits，不使用 Vditor 自带的计数器口径。
 * - 组件是受控的：外部 content 真正变化时才调用 setValue，
 *   避免作者输入过程中被回写重置光标、滚动位置与撤销栈。
 * - 快捷键扩展：全模式（IR、WYSIWYG、SV）支持 Ctrl/Cmd+1~6 设置对应级别标题、Ctrl/Cmd+0 恢复正文。
 * - 选区 AI 赋能：选中文本后悬浮 AI 气泡菜单（润色、扩写、续写、对话），生成预览后可原子替换。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Check, Bookmark, CheckCircle2, Circle, ExternalLink, X } from 'lucide-react'

import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './vditor-prose.css'
import './document-toolbar.css'
import './foreshadowing.css'

import { locateForeshadowingInText } from '../../services/foreshadowing-locator'
import type { ForeshadowingRecord } from '../../shared/foreshadowing'
import {
  rememberDraftEditorPosition,
  rememberDraftEditorPositionIfAbsent,
  type DraftEditorMode,
  type DraftEditorPosition,
} from '../../services/draft-editor-position'

import { countDraftUnits } from '../../shared/draft-units'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { createGenerationRuntime } from '../../services/generation/generation-runtime'
import { toast } from '../ui/Toast'
import type { GenerationReasoningStage } from '../../shared/reasoning-types'
import { getActiveProjectSessionContext } from '../../shared/project-session-context'
import { resolveWritingLanguage } from '../../shared/writing-language'
import { promptLanguageText } from '../../services/prompt-language'
import { composePromptSystemRole, renderPrompt, resolvePromptTemplate } from '../../services/prompt-templates'
import { cn } from '../../lib/utils'

/**
 * 本地资源根目录。构建产物用 `./` 前缀（file:// 加载），
 * 浏览器测试与开发服务器用 `/` 前缀，两者都能解析到 public/vditor。
 */
const VDITOR_ASSET_BASE = `${import.meta.env.BASE_URL}vditor`

/** 文档式工具栏沿用 Vditor 的原生编辑命令，避免绕开其撤销栈与 Markdown 转换。 */
const VDITOR_TOOLBAR = [
  {
    name: 'insert',
    tip: '插入内容',
    tipPosition: 'ne',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v10M7 12h10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    toolbar: ['table', 'upload', 'code', 'line'],
    click: () => {},
  },
  '|',
  'undo',
  'redo',
  '|',
  {
    name: 'headings',
    icon: '<span class="doc-toolbar-heading-label">标题</span><svg aria-hidden="true"><use xlink:href="#vditor-icon-headings"></use></svg>',
  },
  '|',
  'bold',
  'italic',
  'strike',
  '|',
  'list',
  'ordered-list',
  'check',
  'outdent',
  'indent',
  '|',
  'link',
  'quote',
  'line',
  'table',
  '|',
  'outline',
  'edit-mode',
  'fullscreen',
]

type EditorAIAction = {
  key: 'refine' | 'expand' | 'continue' | 'dialogue'
  label: readonly [string, string]
  color: string
  prompt: readonly [string, string]
  reasoningStage: GenerationReasoningStage
}

const AI_ACTIONS = [
  { key: 'refine', label: ['润色', 'Refine'], color: 'text-[var(--color-category-progress-text)]', prompt: ['润色这部分，使语言自然、具体并增强场景表现力。', 'Refine this passage for natural, specific language and stronger scene craft.'], reasoningStage: 'review' },
  { key: 'expand', label: ['扩写', 'Expand'], color: 'text-[var(--color-warning-text)]', prompt: ['扩写这部分，补充与情节有关的动作、感官和环境细节。', 'Expand this passage with plot-relevant action, sensory detail, and setting.'], reasoningStage: 'drafting' },
  { key: 'continue', label: ['续写', 'Continue'], color: 'text-[var(--color-category-review-text)]', prompt: ['根据现有因果和人物动机，自然续写接下来的情节。', 'Continue naturally from the established causality and character motivation.'], reasoningStage: 'drafting' },
  { key: 'dialogue', label: ['对话', 'Dialogue'], color: 'text-[var(--color-success-text)]', prompt: ['将这部分改写为有区分度、能推动冲突的自然对话。', 'Rewrite this passage as distinct, natural dialogue that advances the conflict.'], reasoningStage: 'drafting' },
] satisfies readonly EditorAIAction[]

const EDITOR_AI_GENERATION_BUDGET = Object.freeze({
  maxAttempts: 1,
  maxRequestedOutputTokens: 4096,
  maxRequestedOutputTokensPerAttempt: 4096,
  deadlineMs: 120_000,
})

/** 解除编辑模式切换按钮的禁用状态，允许作者切换 IR / 分屏预览 / 所见即所得。 */
function unblockEditModeMenu(host: HTMLElement): void {
  const editModeBtn = host.querySelector<HTMLButtonElement>(
    '.vditor-toolbar button[data-type="edit-mode"]',
  ) ?? host.querySelector<HTMLButtonElement>(
    '.vditor-toolbar button[data-mode]',
  )?.closest('.vditor-toolbar__item')?.firstElementChild as HTMLButtonElement | null
  if (editModeBtn) {
    editModeBtn.classList.remove('vditor-menu--disabled')
    editModeBtn.removeAttribute('disabled')
  }
}

/**
 * Vditor 的 enable()/disabled() 会直接读取其尚未公开、且会在资源加载期间短暂缺失的
 * 内部 `currentMode.element`。正文页只操作已经出现在 DOM 中的节点，避免该时序问题把
 * React 编辑区带进错误边界。
 */
function setEditingToolbarEnabled(host: HTMLElement, enabled: boolean): void {
  for (const button of host.querySelectorAll<HTMLButtonElement>('.vditor-toolbar button[data-type]')) {
    if (button.dataset.type === 'edit-mode') continue
    button.classList.toggle('vditor-menu--disabled', !enabled)
    if (enabled) button.removeAttribute('disabled')
    else button.setAttribute('disabled', 'true')
  }
}

/** 只读状态下加固：正文各模式严格不可写，改写类工具栏禁用，但保留模式切换。 */
function enforceReadOnlyState(host: HTMLElement): void {
  setEditingToolbarEnabled(host, false)
  unblockEditModeMenu(host)

  // 严格确保三种编辑模式下的元素都处于只读/禁用状态
  const irPre = host.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')
  if (irPre) irPre.setAttribute('contenteditable', 'false')

  const wysiwygPre = host.querySelector<HTMLElement>('.vditor-wysiwyg pre.vditor-reset')
  if (wysiwygPre) wysiwygPre.setAttribute('contenteditable', 'false')

  const svTextarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
  if (svTextarea) {
    svTextarea.disabled = true
    svTextarea.setAttribute('readonly', 'true')
  }
}

function enforceEditableState(host: HTMLElement): void {
  setEditingToolbarEnabled(host, true)
  for (const pre of host.querySelectorAll<HTMLElement>('.vditor-ir pre.vditor-reset, .vditor-wysiwyg pre.vditor-reset')) {
    pre.setAttribute('contenteditable', 'true')
  }
  const svTextarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
  if (svTextarea) {
    svTextarea.disabled = false
    svTextarea.removeAttribute('readonly')
  }
}

/**
 * Vditor 会先异步加载语言包，加载完成前其内部 `vditor` 对象不存在；React StrictMode
 * 的演练性卸载若直接调用 destroy()，库本身会读取 undefined.element 并抛错。
 */
function disposeVditor(vditor: Vditor, host: HTMLElement): void {
  const internal = vditor as unknown as { vditor?: unknown; isDestroyed?: boolean }
  if (!internal.vditor) {
    // 标记实例已废弃，使语言包异步回调中的 init() 直接返回；不调用有缺陷的 destroy()。
    internal.isDestroyed = true
    host.replaceChildren()
    return
  }
  try {
    vditor.destroy()
  } catch (error) {
    console.warn('[VditorProseEditor] 销毁未完全初始化的编辑器失败，已清空宿主节点', error)
    internal.isDestroyed = true
    host.replaceChildren()
  }
}

/** 统一在各模式下应用标题层级或恢复段落 */
function applyHeadingToEditor(
  vditor: Vditor,
  host: HTMLElement,
  level: number,
): void {
  const internal = vditor as unknown as { vditor?: { currentMode?: 'ir' | 'wysiwyg' | 'sv' } }
  const currentMode = internal.vditor?.currentMode ?? 'ir'

  if (currentMode === 'sv') {
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const val = textarea.value
    const lineStart = val.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = val.indexOf('\n', end)
    const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx
    const selectedLines = val.substring(lineStart, lineEnd)
    const stripped = selectedLines.replace(/^#{1,6}\s+/, '')
    const heading = level === 0 ? stripped : `${'#'.repeat(level)} ${stripped}`
    textarea.setRangeText(heading, lineStart, lineEnd, 'select')
    textarea.focus()
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }

  if (level >= 1 && level <= 6) {
    const headingBtn = host.querySelector<HTMLButtonElement>(
      `.vditor-toolbar button[data-tag="h${level}"]`,
    )
    if (headingBtn) {
      headingBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return
    }
  }

  if (level === 0) {
    const actionBtn = host.querySelector<HTMLButtonElement>(
      '.vditor-toolbar button[data-type="headings"]',
    )
    if (actionBtn) {
      actionBtn.classList.add('vditor-menu--current')
      actionBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
  }
}

export interface ForeshadowingSelectionInfo {
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
}

export type ForeshadowingSelectionResult =
  | { success: true; info: ForeshadowingSelectionInfo }
  | { success: false; reason: 'empty' | 'ambiguous' | 'not_found'; message?: string }

export interface VditorProseEditorRef {
  getSelectionInfo: () => ForeshadowingSelectionResult
  /**
   * 主动把当前光标与滚动位置记到 `positionMemoryKey` 下。
   *
   * 跳转到蓝图/场景画布**之前**调用：此时正文仍在文档中，滚动距离是准的。
   * 未设置记忆键或编辑器未就绪时静默不做任何事。
   */
  rememberPosition: () => void
}

/** 外部请求把光标与滚动位置放回先前记录的位置；只在 requestId 变化时执行一次。 */
export type VditorRestorePositionRequest = DraftEditorPosition & { requestId: number }

export interface VditorProseEditorProps {
  content: string
  editable?: boolean
  placeholder?: string
  onChange?: (markdown: string) => void
  onSave?: (markdown: string) => void | Promise<void>
  onCharCountChange?: (count: number) => void
  className?: string
  /**
   * 外部请求跳到某个标题或行。只在 requestId 变化时执行一次，
   * 目录点击不会在每次渲染时重复触发滚动。
   */
  jumpTarget?: { line?: number; index?: number; text?: string; requestId: number } | null
  /**
   * 外部请求在光标处插入文本（例如插入图片引用）；只在 requestId 变化时执行一次。
   */
  insertRequest?: { text: string; requestId: number } | null
  /**
   * 编辑位置记忆键。设置后，编辑器卸载时会把光标与滚动位置记到该键下，
   * 供作者从蓝图/场景画布返回正文时还原。不设置则完全不影响编辑器。
   */
  positionMemoryKey?: string
  /**
   * 外部请求还原编辑位置；只在 requestId 变化时执行一次。
   * 与 `positionMemoryKey` 配对使用：本组件负责还原，不负责跨挂载持久化。
   */
  restorePosition?: VditorRestorePositionRequest | null
  /** 伏笔数据与交互回调 */
  foreshadowings?: ForeshadowingRecord[]
  onToggleForeshadowingCompleted?: (id: string, completed: boolean) => void
  onOpenForeshadowingManager?: () => void
  onMarkForeshadowing?: (info: ForeshadowingSelectionInfo) => void
  editorRef?: React.RefObject<VditorProseEditorRef | null> | React.MutableRefObject<VditorProseEditorRef | null>
}

export default function VditorProseEditor({
  content,
  editable = true,
  placeholder,
  onChange,
  onSave,
  onCharCountChange,
  className,
  jumpTarget,
  insertRequest,
  positionMemoryKey,
  restorePosition,
  foreshadowings,
  onToggleForeshadowingCompleted,
  onOpenForeshadowingManager,
  onMarkForeshadowing,
  editorRef,
}: VditorProseEditorProps) {
  const text = useLocaleStore(s => s.text)
  const hostRef = useRef<HTMLDivElement>(null)
  const vditorRef = useRef<Vditor | null>(null)
  /** 记录失焦前最后的光标选区，供外部工具栏按钮（例如“插入图片”）定位 */
  const lastRangeRef = useRef<Range | null>(null)
  const lastSvRangeRef = useRef<{ start: number; end: number } | null>(null)
  /** 编辑器当前内容（含作者刚输入的值），用于判断外部内容是否真的变了。 */
  const syncedContentRef = useRef(content)
  /** 最近一次收到的 content prop；初始化期间的变化也要在就绪后补上。 */
  const pendingContentRef = useRef(content)
  const readyRef = useRef(false)
  /** 上一次已应用的编辑状态；只在状态真的切换时同步 DOM。 */
  const appliedEditableRef = useRef<boolean | null>(null)

  // 回调放进 ref：编辑器只创建一次，父组件重渲染不应重建实例。
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCharCountRef = useRef(onCharCountChange)
  const editableRef = useRef(editable)
  const placeholderTextRef = useRef(placeholder)
  const uploadNoticeRef = useRef('')
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onCharCountRef.current = onCharCountChange
    editableRef.current = editable
    placeholderTextRef.current = placeholder
    uploadNoticeRef.current = text('图片导入功能待接入', 'Image import is not connected yet')
  })

  // ===== Bubble Menu 状态 =====
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [bubblePos, setBubblePos] = useState({ top: 0, left: 0 })
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [activeAIAction, setActiveAIAction] = useState<string | null>(null)
  const [loadingDots, setLoadingDots] = useState('.')
  const aiRequestSequenceRef = useRef(0)
  const aiResultRef = useRef<string | null>(null)
  useEffect(() => {
    aiResultRef.current = aiResult
  }, [aiResult])

  const aiTargetRef = useRef<{
    requestSequence: number
    mode: 'ir' | 'wysiwyg' | 'sv'
    selectedText: string
    documentText: string
    svRange: { start: number; end: number } | null
    domRange: Range | null
  } | null>(null)

  useEffect(() => {
    if (aiResult === '') {
      const timer = setInterval(() => setLoadingDots(d => d.length >= 3 ? '.' : d + '.'), 400)
      return () => clearInterval(timer)
    }
  }, [aiResult])

  // ===== 伏笔高亮与气泡卡片状态 =====
  const foreshadowingsRef = useRef(foreshadowings)
  useEffect(() => {
    foreshadowingsRef.current = foreshadowings
  })

  const activeHighlightsRef = useRef<Array<{
    foreshadowing: ForeshadowingRecord
    range: Range
  }>>([])

  const [popover, setPopover] = useState<{
    open: boolean
    foreshadowing: ForeshadowingRecord | null
    pos: { top: number; left: number }
  }>({
    open: false,
    foreshadowing: null,
    pos: { top: 0, left: 0 },
  })

  const getSelectionInfo = useCallback((): ForeshadowingSelectionResult => {
    const host = hostRef.current
    const vditor = vditorRef.current
    if (!host) return { success: false, reason: 'empty' }

    const internal = vditor as unknown as { vditor?: { currentMode?: 'ir' | 'wysiwyg' | 'sv' } }
    const currentMode = internal?.vditor?.currentMode ?? 'ir'

    if (currentMode === 'sv') {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
      if (textarea && textarea.selectionEnd > textarea.selectionStart) {
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const selectedText = textarea.value.substring(start, end).trim()
        if (!selectedText) return { success: false, reason: 'empty' }
        const contextBefore = textarea.value.slice(Math.max(0, start - 100), start)
        const contextAfter = textarea.value.slice(end, Math.min(textarea.value.length, end + 100))
        return {
          success: true,
          info: { selectedText, startOffset: start, endOffset: end, contextBefore, contextAfter },
        }
      }
      return { success: false, reason: 'empty' }
    }

    // ir / wysiwyg 模式
    const sel = window.getSelection()
    let targetRange: Range | null = null
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.anchorNode && host.contains(sel.anchorNode)) {
      targetRange = sel.getRangeAt(0)
    } else if (lastRangeRef.current && !lastRangeRef.current.collapsed) {
      targetRange = lastRangeRef.current
    }

    if (!targetRange || targetRange.collapsed) return { success: false, reason: 'empty' }
    const selectedText = targetRange.toString().trim()
    if (!selectedText) return { success: false, reason: 'empty' }

    const editorEl = host.querySelector<HTMLElement>(
      '.vditor-ir:not([style*="display: none"]) pre.vditor-reset, .vditor-wysiwyg:not([style*="display: none"]) pre.vditor-reset'
    )
    if (!editorEl) return { success: false, reason: 'empty' }

    let domContextBefore = ''
    let domContextAfter = ''
    let approxStart = 0

    try {
      const rangeBefore = document.createRange()
      rangeBefore.setStart(editorEl, 0)
      rangeBefore.setEnd(targetRange.startContainer, targetRange.startOffset)
      const fullTextBefore = rangeBefore.toString()
      domContextBefore = fullTextBefore.slice(-100)
      approxStart = fullTextBefore.length

      const rangeAfter = document.createRange()
      rangeAfter.setStart(targetRange.endContainer, targetRange.endOffset)
      rangeAfter.setEnd(editorEl, editorEl.childNodes.length)
      const fullTextAfter = rangeAfter.toString()
      domContextAfter = fullTextAfter.slice(0, 100)
    } catch {
      // 容错忽略
    }

    const docText = vditor ? vditor.getValue() : syncedContentRef.current
    const approxEnd = approxStart + selectedText.length

    // 统计所选文字在 Markdown 原文中出现的所有位置
    const occurrences: number[] = []
    let pos = 0
    while (pos <= docText.length - selectedText.length) {
      const found = docText.indexOf(selectedText, pos)
      if (found === -1) break
      occurrences.push(found)
      pos = found + 1
    }

    if (occurrences.length === 0) {
      return {
        success: false,
        reason: 'not_found',
        message: text('未在正文中找到所选文字，请重新选择', 'The selected text was not found in the prose. Please reselect.'),
      }
    }

    // 尝试安全定位
    const loc = locateForeshadowingInText(docText, {
      selectedText,
      startOffset: approxStart,
      endOffset: approxEnd,
      contextBefore: domContextBefore,
      contextAfter: domContextAfter,
    })

    let startOffset: number
    let endOffset: number

    if (loc.located && loc.startOffset !== undefined && loc.endOffset !== undefined) {
      startOffset = loc.startOffset
      endOffset = loc.endOffset
    } else if (occurrences.length === 1) {
      // 只有在 Markdown 原文中唯一出现时，才允许唯一回退
      startOffset = occurrences[0]
      endOffset = occurrences[0] + selectedText.length
    } else {
      // 存在多个位置且上下文无法安全唯一定位：拒绝创建，提示作者
      return {
        success: false,
        reason: 'ambiguous',
        message: text('所选文字存在多个位置，请缩短选择范围或重新选择', 'The selected text appears in multiple locations. Please narrow your selection or reselect.'),
      }
    }

    // 保存的 startOffset/endOffset/contextBefore/contextAfter 严格取自同一份 Markdown 原文 docText
    const contextBefore = docText.slice(Math.max(0, startOffset - 100), startOffset)
    const contextAfter = docText.slice(endOffset, Math.min(docText.length, endOffset + 100))

    return {
      success: true,
      info: {
        selectedText,
        startOffset,
        endOffset,
        contextBefore,
        contextAfter,
      },
    }
  }, [text])

  // ===== 编辑位置记忆：作者去蓝图/场景画布再回来时放回原处 =====

  // 位置记忆键经 ref 读取，创建编辑器的 effect 才能保持「只执行一次」。
  const positionMemoryKeyRef = useRef(positionMemoryKey)
  useEffect(() => {
    positionMemoryKeyRef.current = positionMemoryKey
  }, [positionMemoryKey])

  /** 当前可见模式的滚动容器（正文滚动发生在 .vditor-ir / .vditor-wysiwyg / .vditor-sv 上）。 */
  const findScrollContainer = useCallback((host: HTMLElement, mode: DraftEditorMode): HTMLElement | null => {
    const selector = mode === 'sv'
      ? '.vditor-sv'
      : mode === 'wysiwyg' ? '.vditor-wysiwyg' : '.vditor-ir'
    return host.querySelector<HTMLElement>(selector)
  }, [])

  /** 当前可见模式的正文可编辑元素。 */
  const findActiveEditorElement = useCallback((host: HTMLElement): HTMLElement | null => (
    host.querySelector<HTMLElement>(
      '.vditor-ir:not([style*="display: none"]) pre.vditor-reset, .vditor-wysiwyg:not([style*="display: none"]) pre.vditor-reset',
    )
  ), [])

  /**
   * 记录作者离开时的光标与滚动位置。
   *
   * 正常路径由父组件在**跳转前**调用（见 `rememberPosition`）：那时正文还在文档里，
   * 滚动距离是准的。卸载清理里只作为兜底 —— 此刻元素可能已脱离文档、滚动距离读不到
   * 真实值，所以它不会覆盖跳转前记下的位置。
   *
   * 记录失败（未就绪 / 没有正文元素）时不写入：宁可没有记忆，也不要一个错的位置。
   */
  const captureEditorPosition = useCallback((): DraftEditorPosition | null => {
    const host = hostRef.current
    if (!host || !readyRef.current) return null

    const internal = vditorRef.current as unknown as { vditor?: { currentMode?: DraftEditorMode } }
    const mode = internal?.vditor?.currentMode ?? 'ir'
    const scrollTop = findScrollContainer(host, mode)?.scrollTop ?? 0

    if (mode === 'sv') {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
      if (!textarea) return null
      const sourceOffset = document.activeElement === textarea
        ? textarea.selectionStart
        : lastSvRangeRef.current?.start ?? textarea.selectionStart
      return { mode, blockIndex: -1, offsetInBlock: 0, blockText: '', sourceOffset, scrollTop }
    }

    const editorEl = findActiveEditorElement(host)
    if (!editorEl) return null
    // 失焦后 window.getSelection() 可能已经被清空，此时退回最后一次记录的选区。
    const selection = window.getSelection()
    let range: Range | null = null
    if (selection && selection.rangeCount > 0 && selection.anchorNode && editorEl.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0).cloneRange()
    } else if (lastRangeRef.current && editorEl.contains(lastRangeRef.current.startContainer)) {
      range = lastRangeRef.current.cloneRange()
    }
    if (!range) return { mode, blockIndex: -1, offsetInBlock: 0, blockText: '', sourceOffset: 0, scrollTop }

    const blocks = Array.from(editorEl.children)
    const container = range.startContainer
    const blockIndex = blocks.findIndex(block => block === container || block.contains(container))
    if (blockIndex < 0) return { mode, blockIndex: -1, offsetInBlock: 0, blockText: '', sourceOffset: 0, scrollTop }

    const block = blocks[blockIndex]
    let offsetInBlock = 0
    try {
      const beforeCaret = document.createRange()
      beforeCaret.setStart(block, 0)
      beforeCaret.setEnd(range.startContainer, range.startOffset)
      offsetInBlock = beforeCaret.toString().length
    } catch {
      offsetInBlock = 0
    }
    return {
      mode,
      blockIndex,
      offsetInBlock,
      blockText: (block.textContent ?? '').trim().slice(0, 40),
      sourceOffset: 0,
      scrollTop,
    }
  }, [findActiveEditorElement, findScrollContainer])

  /** 卸载时的兜底记录：只在作者离开前没有主动记录时生效。 */
  const rememberPositionOnUnmount = useCallback(() => {
    const memoryKey = positionMemoryKeyRef.current
    if (!memoryKey) return
    const position = captureEditorPosition()
    if (position) rememberDraftEditorPositionIfAbsent(memoryKey, position)
  }, [captureEditorPosition])

  /** 供外部在跳转前主动记录位置（例如从正文跳到章节蓝图）。 */
  const rememberPosition = useCallback(() => {
    const memoryKey = positionMemoryKeyRef.current
    if (!memoryKey) return
    const position = captureEditorPosition()
    if (position) rememberDraftEditorPosition(memoryKey, position)
  }, [captureEditorPosition])

  /** 待还原的位置请求；就绪前到达时由 Vditor 的 after 回调补做。 */
  const pendingRestoreRef = useRef<VditorRestorePositionRequest | null>(null)
  const appliedRestoreIdRef = useRef<number | null>(null)

  /**
   * 还原光标与滚动位置。
   *
   * 优先把光标放回原来的段落：浏览器把它带进视野比死记滚动距离更贴近作者的
   * 「刚才写到这里」。只有完全找不到落点时，才退回记录过的滚动距离。
   * 任何情况下都不改动正文。
   */
  const applyRestorePosition = useCallback(() => {
    const request = pendingRestoreRef.current
    if (!request) return
    if (appliedRestoreIdRef.current === request.requestId) return
    const host = hostRef.current
    if (!host || !readyRef.current) return
    appliedRestoreIdRef.current = request.requestId
    pendingRestoreRef.current = null

    const restoreScrollOnly = () => {
      const scroller = findScrollContainer(host, request.mode)
      if (scroller) scroller.scrollTop = Math.max(0, request.scrollTop)
    }

    if (request.mode === 'sv') {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
      if (!textarea) {
        restoreScrollOnly()
        return
      }
      const offset = Math.min(Math.max(0, request.sourceOffset), textarea.value.length)
      textarea.focus()
      textarea.setSelectionRange(offset, offset)
      lastSvRangeRef.current = { start: offset, end: offset }
      return
    }

    const editorEl = findActiveEditorElement(host)
    if (!editorEl) {
      restoreScrollOnly()
      return
    }
    const blocks = Array.from(editorEl.children)
    if (blocks.length === 0) {
      restoreScrollOnly()
      return
    }

    // 段落快照优先：块序号在正文被改动后会偏移，快照能确认我们找的是同一段。
    const snapshot = request.blockText
    // 只记下滚动距离（作者当时只是滚动、没有落点）：不要因此把光标丢到文档开头。
    if (request.blockIndex < 0 && !snapshot) {
      restoreScrollOnly()
      return
    }
    let target: Element | undefined = blocks[request.blockIndex]
    if (!target || (snapshot && !(target.textContent ?? '').trim().startsWith(snapshot))) {
      target = snapshot
        ? blocks.find(block => (block.textContent ?? '').trim().startsWith(snapshot))
        : undefined
    }
    const resolved: Element | undefined = target
      ?? blocks[Math.min(Math.max(0, request.blockIndex), blocks.length - 1)]
    if (!resolved) {
      restoreScrollOnly()
      return
    }

    editorEl.focus()
    const range = document.createRange()
    let placed = false
    const walker = document.createTreeWalker(resolved, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    let remaining = Math.max(0, request.offsetInBlock)
    while (node) {
      const length = node.nodeValue?.length ?? 0
      if (remaining <= length) {
        range.setStart(node, remaining)
        range.collapse(true)
        placed = true
        break
      }
      remaining -= length
      node = walker.nextNode()
    }
    if (!placed) {
      // 段落变短：停在段落末尾，而不是跳回文档开头。
      range.selectNodeContents(resolved)
      range.collapse(false)
    }
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
    lastRangeRef.current = range.cloneRange()
    // 把落点带进视野；死记滚动距离在段落被改动后会指到别处。
    const resolvedElement = resolved as HTMLElement
    if (typeof resolvedElement.scrollIntoView === 'function') {
      resolvedElement.scrollIntoView({ block: 'center' })
    } else {
      restoreScrollOnly()
    }
  }, [findActiveEditorElement, findScrollContainer])

  // 请求可能在编辑器就绪前到达：先存起来，就绪后由 after() 补做。
  useEffect(() => {
    pendingRestoreRef.current = restorePosition ?? null
    applyRestorePosition()
  }, [applyRestorePosition, restorePosition])

  // 暴露给父组件的命令式接口。
  useEffect(() => {
    if (editorRef) {
      editorRef.current = { getSelectionInfo, rememberPosition }
    }
  }, [editorRef, getSelectionInfo, rememberPosition])

  const updateHighlights = useCallback(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
    const host = hostRef.current
    if (!host || !readyRef.current) return

    const editorEl = host.querySelector<HTMLElement>(
      '.vditor-ir:not([style*="display: none"]) pre.vditor-reset, .vditor-wysiwyg:not([style*="display: none"]) pre.vditor-reset'
    )
    if (!editorEl) return

    const currentForeshadowings = foreshadowingsRef.current
    if (!currentForeshadowings || currentForeshadowings.length === 0) {
      for (const color of ['blue', 'red', 'yellow', 'green', 'purple', 'completed']) {
        CSS.highlights.delete(`foreshadowing-${color}`)
      }
      activeHighlightsRef.current = []
      return
    }

    const charMap: Array<{ node: Text; offset: number }> = []
    let fullText = ''
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null)
    let textNode: Node | null
    while ((textNode = walker.nextNode())) {
      const tn = textNode as Text
      const val = tn.nodeValue || ''
      for (let i = 0; i < val.length; i++) {
        charMap.push({ node: tn, offset: i })
        fullText += val[i]
      }
    }

    if (fullText.length === 0) {
      activeHighlightsRef.current = []
      return
    }

    const highlightGroups = new Map<string, Range[]>()
    const nextActiveHighlights: Array<{ foreshadowing: ForeshadowingRecord; range: Range }> = []

    for (const f of currentForeshadowings) {
      const loc = locateForeshadowingInText(fullText, {
        selectedText: f.selectedText,
        startOffset: f.startOffset,
        endOffset: f.endOffset,
        contextBefore: f.contextBefore,
        contextAfter: f.contextAfter,
      })

      if (loc.located && loc.startOffset !== undefined && loc.endOffset !== undefined) {
        if (loc.startOffset >= 0 && loc.endOffset <= charMap.length && loc.startOffset < loc.endOffset) {
          const startChar = charMap[loc.startOffset]
          const lastChar = charMap[loc.endOffset - 1]
          if (startChar && lastChar) {
            try {
              const range = document.createRange()
              range.setStart(startChar.node, startChar.offset)
              range.setEnd(lastChar.node, lastChar.offset + 1)

              const groupName = f.completed ? 'foreshadowing-completed' : `foreshadowing-${f.color || 'blue'}`
              if (!highlightGroups.has(groupName)) {
                highlightGroups.set(groupName, [])
              }
              highlightGroups.get(groupName)!.push(range)
              nextActiveHighlights.push({ foreshadowing: f, range })
            } catch {
              // 容错忽略
            }
          }
        }
      }
    }

    activeHighlightsRef.current = nextActiveHighlights

    for (const color of ['blue', 'red', 'yellow', 'green', 'purple', 'completed']) {
      const groupName = `foreshadowing-${color}`
      const ranges = highlightGroups.get(groupName)
      if (ranges && ranges.length > 0) {
        CSS.highlights.set(groupName, new Highlight(...ranges))
      } else {
        CSS.highlights.delete(groupName)
      }
    }
  }, [])

  useEffect(() => {
    updateHighlights()
  }, [updateHighlights, foreshadowings])

  useEffect(() => {
    return () => {
      if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
        for (const color of ['blue', 'red', 'yellow', 'green', 'purple', 'completed']) {
          CSS.highlights.delete(`foreshadowing-${color}`)
        }
      }
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handleHostClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.foreshadowing-popover-card')) return

      const x = event.clientX
      const y = event.clientY

      let matched: { foreshadowing: ForeshadowingRecord; rect: DOMRect } | null = null
      for (const item of activeHighlightsRef.current) {
        const rects = item.range.getClientRects()
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i]
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            matched = { foreshadowing: item.foreshadowing, rect: r }
            break
          }
        }
        if (matched) break
      }

      if (matched) {
        const rect = matched.rect
        setPopover({
          open: true,
          foreshadowing: matched.foreshadowing,
          pos: {
            top: rect.bottom + 8,
            left: Math.max(160, rect.left + rect.width / 2),
          },
        })
      } else {
        setPopover(prev => (prev.open ? { ...prev, open: false } : prev))
      }
    }

    host.addEventListener('click', handleHostClick)
    return () => {
      host.removeEventListener('click', handleHostClick)
    }
  }, [])

  /** 把编辑器内容上报给外层；相同的值不会重复上报。 */
  const emitInput = useCallback((markdown: string) => {
    if (markdown === syncedContentRef.current) return
    syncedContentRef.current = markdown
    onCharCountRef.current?.(countDraftUnits(markdown))
    onChangeRef.current?.(markdown)
    updateHighlights()
  }, [updateHighlights])

  /** 外部内容变化：只有确实不同才写回编辑器。 */
  const applyExternalContent = useCallback(() => {
    const vditor = vditorRef.current
    if (!vditor || !readyRef.current) return
    const next = pendingContentRef.current
    if (next === syncedContentRef.current) return
    syncedContentRef.current = next
    // setValue 不触发 input 回调，因此不会把外部写入当成作者输入再抛回去。
    vditor.setValue(next)
    onCharCountRef.current?.(countDraftUnits(next))
    updateHighlights()
  }, [updateHighlights])

  /** 只读时除 Vditor 自带的 disabled() 外，再拦住输入、粘贴与拖放，但放行模式切换。 */
  const applyEditableState = useCallback(() => {
    const vditor = vditorRef.current
    const host = hostRef.current
    if (!vditor || !readyRef.current || !host) return
    if (editableRef.current && appliedEditableRef.current === false) enforceEditableState(host)
    if (!editableRef.current) enforceReadOnlyState(host)
    appliedEditableRef.current = editableRef.current
  }, [])

  // 创建编辑器：只在挂载时执行一次。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    readyRef.current = false
    syncedContentRef.current = pendingContentRef.current
    let disposed = false
    let vditor: Vditor | null = null

    // StrictMode 会同步执行一次 effect 的挂载和清理。延后到下一轮事件循环后再创建，
    // 那次演练性挂载会在构造前被取消，不会触发 Vditor 的异步语言包/销毁竞态。
    const timer = window.setTimeout(() => {
      if (disposed) return
      const instance = new Vditor(host, {
        // 本地资源目录，绝不指向公网 CDN。
        cdn: VDITOR_ASSET_BASE,
        lang: 'zh_CN',
        // 默认即时渲染（IR）；工具栏的 edit-mode 仍可切到所见即所得与分屏预览。
        mode: 'ir',
        value: pendingContentRef.current,
        height: '100%',
        placeholder: placeholderTextRef.current ?? '',
        // 章节草稿以数据库与编辑器 store 为准，不使用 Vditor 的 localStorage 缓存。
        cache: { enable: false },
        // 字数与目标统一走 countDraftUnits，关闭 Vditor 自带计数器。
        counter: { enable: false },
        toolbar: VDITOR_TOOLBAR,
        preview: {
          // 正文最大宽度约 800px。
          maxWidth: 800,
        },
        upload: {
          // 没有任何远程上传地址：图片按钮只提示本地素材管理尚未接入。
          accept: 'image/*',
          multiple: false,
          handler: () => uploadNoticeRef.current,
        },
        input: (markdown: string) => {
          if (vditorRef.current !== instance) return
          emitInput(markdown)
        },
        after: () => {
          if (vditorRef.current !== instance) return
          readyRef.current = true
          host.setAttribute('data-vditor-ready', 'true')
          // 初始化期间到达的外部内容在这里补写。
          applyExternalContent()
          onCharCountRef.current?.(countDraftUnits(instance.getValue()))
          applyEditableState()
          updateHighlights()
          // 还原请求可能早于就绪到达（跳回正文时组件刚重新挂载）。
          applyRestorePosition()
        },
      })
      if (disposed) {
        disposeVditor(instance, host)
        return
      }
      vditor = instance
      vditorRef.current = instance
    }, 0)
    return () => {
      // 兜底记录编辑位置：作者跳转前已主动记录过时不会覆盖那份更准的位置。
      rememberPositionOnUnmount()
      disposed = true
      window.clearTimeout(timer)
      if (vditorRef.current === vditor) vditorRef.current = null
      readyRef.current = false
      appliedEditableRef.current = null
      host.removeAttribute('data-vditor-ready')
      if (vditor) disposeVditor(vditor, host)
    }
  }, [
    applyEditableState,
    applyExternalContent,
    applyRestorePosition,
    emitInput,
    rememberPositionOnUnmount,
  ])

  // 外部内容更新（打开其他章节、保存后归一化、AI 写回）。
  useEffect(() => {
    pendingContentRef.current = content
    applyExternalContent()
  }, [applyExternalContent, content])

  // 只读状态切换。
  useEffect(() => {
    applyEditableState()
  }, [applyEditableState, editable])

  // 外部目录跳转：只在 requestId 变化时执行一次。
  const lastJumpRequestRef = useRef<number | null>(null)
  useEffect(() => {
    if (!jumpTarget) return
    if (lastJumpRequestRef.current === jumpTarget.requestId) return
    const vditor = vditorRef.current
    const host = hostRef.current
    if (!vditor || !host || !readyRef.current) return

    lastJumpRequestRef.current = jumpTarget.requestId

    const internal = vditor as unknown as { vditor?: { currentMode?: 'ir' | 'wysiwyg' | 'sv' } }
    const currentMode = internal.vditor?.currentMode ?? 'ir'

    if (currentMode === 'sv') {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
      if (textarea && jumpTarget.line !== undefined) {
        const lines = textarea.value.split('\n')
        const targetLine = Math.min(Math.max(0, jumpTarget.line), lines.length - 1)
        let charPos = 0
        for (let i = 0; i < targetLine; i++) {
          charPos += lines[i].length + 1
        }
        textarea.focus()
        textarea.setSelectionRange(charPos, charPos)
        const approxLineHeight = 22
        textarea.scrollTop = Math.max(0, targetLine * approxLineHeight - 40)
      }
      return
    }

    const selector = currentMode === 'wysiwyg'
      ? '.vditor-wysiwyg h1, .vditor-wysiwyg h2, .vditor-wysiwyg h3, .vditor-wysiwyg h4, .vditor-wysiwyg h5, .vditor-wysiwyg h6'
      : '.vditor-ir h1, .vditor-ir h2, .vditor-ir h3, .vditor-ir h4, .vditor-ir h5, .vditor-ir h6'
    const headingElements = Array.from(host.querySelectorAll<HTMLElement>(selector))

    let targetElement: HTMLElement | undefined
    if (jumpTarget.index !== undefined && headingElements[jumpTarget.index]) {
      targetElement = headingElements[jumpTarget.index]
    } else if (jumpTarget.text) {
      targetElement = headingElements.find(el => el.textContent?.trim().includes(jumpTarget.text!.trim()))
    }

    if (targetElement) {
      targetElement.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    }
  }, [jumpTarget])

  // 外部插入：只在 requestId 变化时执行一次，插入在当前光标位置后把光标停在插入内容之后。
  const lastInsertRequestRef = useRef<number | null>(null)
  useEffect(() => {
    if (!insertRequest) return
    if (lastInsertRequestRef.current === insertRequest.requestId) return
    const vditor = vditorRef.current
    const host = hostRef.current
    if (!vditor || !host || !readyRef.current) return
    if (!editableRef.current) return

    lastInsertRequestRef.current = insertRequest.requestId

    const internal = vditor as unknown as { vditor?: { currentMode?: 'ir' | 'wysiwyg' | 'sv' } }
    const currentMode = internal.vditor?.currentMode ?? 'ir'

    if (currentMode === 'sv') {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
      if (textarea) {
        textarea.focus()
        const start = lastSvRangeRef.current?.start ?? textarea.selectionStart
        const end = lastSvRangeRef.current?.end ?? textarea.selectionEnd
        textarea.setRangeText(insertRequest.text, start, end, 'end')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        const nextPos = start + insertRequest.text.length
        lastSvRangeRef.current = { start: nextPos, end: nextPos }
        textarea.setSelectionRange(nextPos, nextPos)
      }
      return
    }

    const activePre = host.querySelector<HTMLElement>(
      '.vditor-ir:not([style*="display: none"]) pre.vditor-reset, .vditor-wysiwyg:not([style*="display: none"]) pre.vditor-reset',
    )
    if (activePre) {
      activePre.focus()
      if (lastRangeRef.current) {
        const sel = window.getSelection()
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(lastRangeRef.current)
        }
      }
    }

    const inserted = document.execCommand('insertText', false, insertRequest.text)
    if (!inserted) {
      vditor.insertValue(insertRequest.text, true)
    }

    emitInput(vditor.getValue())
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      lastRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
  }, [emitInput, insertRequest])

  // 快捷键处理与 DOM 交互拦截
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey
      if (!isMod) return

      const vditor = vditorRef.current

      // Ctrl/Cmd + S 保存
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSaveRef.current?.(vditor ? vditor.getValue() : pendingContentRef.current)
        return
      }

      // Ctrl/Cmd + 1~6 标题级别、Ctrl/Cmd + 0 恢复正文
      if (!event.altKey && !event.shiftKey) {
        if (event.key >= '1' && event.key <= '6') {
          event.preventDefault()
          event.stopPropagation()
          if (!editableRef.current || !vditor) return
          const level = parseInt(event.key, 10)
          applyHeadingToEditor(vditor, host, level)
          return
        }
        if (event.key === '0') {
          event.preventDefault()
          event.stopPropagation()
          if (!editableRef.current || !vditor) return
          applyHeadingToEditor(vditor, host, 0)
          return
        }
      }
    }

    const blockWhileReadonly = (event: Event) => {
      if (editableRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    const handleModeSwitchClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const modeBtn = target?.closest('.vditor-toolbar button[data-mode]')
      if (modeBtn && !editableRef.current) {
        queueMicrotask(() => {
          if (!editableRef.current && vditorRef.current && hostRef.current) {
            enforceReadOnlyState(hostRef.current)
          }
        })
        setTimeout(() => {
          if (!editableRef.current && vditorRef.current && hostRef.current) {
            enforceReadOnlyState(hostRef.current)
          }
        }, 0)
      }
    }

    let isApplying = false
    const observer = new MutationObserver(() => {
      if (isApplying || editableRef.current || !readyRef.current) return
      const vditor = vditorRef.current
      if (!vditor) return
      const irEditable = host.querySelector('.vditor-ir:not([style*="display: none"]) pre[contenteditable="true"]')
      const wysiwygEditable = host.querySelector('.vditor-wysiwyg:not([style*="display: none"]) pre[contenteditable="true"]')
      const svEditable = host.querySelector('textarea.vditor-sv:not([style*="display: none"]):not(:disabled)')
      const editButtonsEnabled = host.querySelector(
        '.vditor-toolbar button[data-type="bold"]:not(.vditor-menu--disabled)',
      )
      if (irEditable || wysiwygEditable || svEditable || editButtonsEnabled) {
        isApplying = true
        try {
          enforceReadOnlyState(host)
        } finally {
          isApplying = false
        }
      }
    })
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'contenteditable', 'disabled'],
    })

    host.addEventListener('click', handleModeSwitchClick, true)
    host.addEventListener('keydown', handleKeyDown, true)
    host.addEventListener('beforeinput', blockWhileReadonly, true)
    host.addEventListener('paste', blockWhileReadonly, true)
    host.addEventListener('drop', blockWhileReadonly, true)
    return () => {
      observer.disconnect()
      host.removeEventListener('click', handleModeSwitchClick, true)
      host.removeEventListener('keydown', handleKeyDown, true)
      host.removeEventListener('beforeinput', blockWhileReadonly, true)
      host.removeEventListener('paste', blockWhileReadonly, true)
      host.removeEventListener('drop', blockWhileReadonly, true)
    }
  }, [])

  // 监听选区变化以显示 AI 悬浮菜单
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let rafId: number

    const handleSelectionCheck = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const vditor = vditorRef.current
        if (!host || !vditor || !readyRef.current) return

        if (aiResultRef.current !== null) return

        const internal = vditor as unknown as { vditor?: { currentMode?: 'ir' | 'wysiwyg' | 'sv' } }
        const currentMode = internal.vditor?.currentMode ?? 'ir'

        if (currentMode === 'sv') {
          const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
          if (textarea && document.activeElement === textarea) {
            lastSvRangeRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            if (end > start) {
              const selectedText = textarea.value.substring(start, end).trim()
              if (selectedText.length > 0) {
                const rect = textarea.getBoundingClientRect()
                setBubblePos({
                  top: Math.max(rect.top + 30, 20),
                  left: rect.left + rect.width / 2,
                })
                setBubbleOpen(true)
                return
              }
            }
          }
          setBubbleOpen(false)
          return
        }

        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const anchor = sel.anchorNode
          if (anchor && host.contains(anchor)) {
            lastRangeRef.current = sel.getRangeAt(0).cloneRange()
          }
        }

        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setBubbleOpen(false)
          return
        }

        const anchor = sel.anchorNode
        if (!anchor || !host.contains(anchor)) {
          setBubbleOpen(false)
          return
        }

        const selectedText = sel.toString().trim()
        if (selectedText.length < 1) {
          setBubbleOpen(false)
          return
        }

        const range = sel.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()

        if (rect.bottom < hostRect.top || rect.top > hostRect.bottom || rect.width === 0) {
          setBubbleOpen(false)
          return
        }

        let top = rect.top - 5
        const left = rect.left + rect.width / 2

        if (top < hostRect.top + 45) {
          top = Math.min(hostRect.top + 45, rect.bottom - 10)
        }

        setBubblePos({ top, left })
        setBubbleOpen(true)
      })
    }

    document.addEventListener('selectionchange', handleSelectionCheck)
    host.addEventListener('mouseup', handleSelectionCheck)
    host.addEventListener('keyup', handleSelectionCheck)

    return () => {
      cancelAnimationFrame(rafId)
      document.removeEventListener('selectionchange', handleSelectionCheck)
      host.removeEventListener('mouseup', handleSelectionCheck)
      host.removeEventListener('keyup', handleSelectionCheck)
    }
  }, [])

  // AI 菜单处理（流式调用，实时显示生成内容）
  const handleAIAction = async (action: EditorAIAction) => {
    const vditor = vditorRef.current
    const host = hostRef.current
    if (!vditor || !host) return

    const internal = vditor as unknown as { vditor?: { currentMode?: 'ir' | 'wysiwyg' | 'sv' } }
    const currentMode = internal.vditor?.currentMode ?? 'ir'

    let selectedText = ''
    let svRange: { start: number; end: number } | null = null
    let domRange: Range | null = null

    if (currentMode === 'sv') {
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
      if (!textarea) return
      svRange = { start: textarea.selectionStart, end: textarea.selectionEnd }
      selectedText = textarea.value.substring(svRange.start, svRange.end)
    } else {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
      domRange = sel.getRangeAt(0).cloneRange()
      selectedText = sel.toString()
    }

    if (!selectedText.trim()) return

    const requestSequence = ++aiRequestSequenceRef.current
    aiTargetRef.current = {
      requestSequence,
      mode: currentMode,
      selectedText,
      documentText: vditor.getValue(),
      svRange,
      domRange,
    }

    let runtime: Awaited<ReturnType<typeof createGenerationRuntime>> | null = null
    try {
      const writingLanguage = resolveWritingLanguage(
        useProjectStore.getState().currentProject?.novelConfig.writingLanguage,
      )
      const template = await resolvePromptTemplate(
        'edit_selected_text',
        getActiveProjectSessionContext() ?? undefined,
        writingLanguage,
      )
      if (!template) throw new Error(text('未找到编辑器提示词', 'Editor prompt is unavailable'))

      setActiveAIAction(text(...action.label))
      setAiResult('')
      setAiError(null)

      runtime = await createGenerationRuntime({ budget: EDITOR_AI_GENERATION_BUDGET })
      const outcome = await runtime.execute(({ session }) => session.complete({
        purpose: `editor-ai-${action.key}`,
        reasoningStage: action.reasoningStage,
        output: 'visible-text',
        messages: [
          { role: 'system', content: composePromptSystemRole(template, writingLanguage) },
          { role: 'user', content: renderPrompt(template, {
            edit_instruction: promptLanguageText(writingLanguage, ...action.prompt),
            selected_text: selectedText,
          }, writingLanguage) },
        ],
      }))

      if (outcome.status !== 'completed' || outcome.finishReason !== 'stop') {
        if (requestSequence !== aiRequestSequenceRef.current) return
        setAiResult('')
        setAiError(text('生成未完整完成，结果不可应用', 'Generation did not complete; the result cannot be applied.'))
        return
      }

      if (requestSequence !== aiRequestSequenceRef.current) return
      setAiResult(outcome.content)
    } catch (e) {
      console.error(e)
      if (requestSequence !== aiRequestSequenceRef.current) return
      setAiResult('')
      setAiError(text('生成失败，结果不可应用', 'Generation failed; the result cannot be applied.'))
    } finally {
      await runtime?.close().catch(() => {})
    }
  }

  const handleAcceptAI = () => {
    const target = aiTargetRef.current
    const vditor = vditorRef.current
    const host = hostRef.current
    if (target && aiResult && vditor && host) {
      if (!editableRef.current) {
        setAiError(text(
          '正文已变为只读，结果未应用；你仍可复制预览内容',
          'The document is now read-only. The result was not applied; you can still copy the preview.',
        ))
        return
      }
      const targetStillCurrent = (
        target.requestSequence === aiRequestSequenceRef.current
        && vditor.getValue() === target.documentText
      )
      if (!targetStillCurrent) {
        setAiError(text(
          '正文或原目标已变化，结果未应用；你仍可复制预览内容',
          'The document or original target changed. The result was not applied; you can still copy the preview.',
        ))
        return
      }

      if (target.mode === 'sv' && target.svRange) {
        const textarea = host.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
        if (textarea) {
          textarea.focus()
          textarea.setRangeText(aiResult, target.svRange.start, target.svRange.end, 'end')
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
      } else if (target.domRange) {
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(target.domRange)
        document.execCommand('insertText', false, aiResult)
      }
    }
    aiTargetRef.current = null
    setAiResult(null)
    setBubbleOpen(false)
  }

  const handleRejectAI = () => {
    aiRequestSequenceRef.current += 1
    aiTargetRef.current = null
    setAiResult(null)
    setAiError(null)
    setBubbleOpen(false)
  }

  return (
    <div className={cn('relative h-full min-h-0', className)}>
      <div ref={hostRef} className="vditor-prose-host h-full min-h-0" data-vditor-prose-editor="true" />

      {/* Bubble Menu */}
      {bubbleOpen && (editable || aiResult !== null) && bubblePos.top !== 0 && (
        <div
          className="fixed z-50 flex items-center gap-0.5 p-1 rounded-xl border select-none shadow-xl transform -translate-x-1/2 -translate-y-full"
          style={{
            top: bubblePos.top,
            left: bubblePos.left,
            backgroundColor: 'var(--color-sidebar)',
            borderColor: 'var(--color-border)',
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {aiResult !== null ? (
            <div className="w-[360px] max-h-[260px] overflow-y-auto p-2">
              <div
                className="text-[10px] mb-1.5 font-medium flex items-center gap-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Sparkles size={11} style={{ color: 'var(--color-accent)' }} />
                {activeAIAction
                  ? text(`${activeAIAction}预览`, `${activeAIAction} preview`)
                  : text('AI 预览', 'AI preview')}
              </div>
              {aiError ? (
                <>
                  <div
                    className="text-xs leading-relaxed mb-3"
                    style={{ color: 'var(--color-error-text)' }}
                  >
                    {aiError}
                  </div>
                  {aiResult && (
                    <div
                      className="text-xs whitespace-pre-wrap leading-relaxed mb-3"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {aiResult}
                    </div>
                  )}
                </>
              ) : aiResult === '' ? (
                <div
                  className="text-xs leading-relaxed mb-3"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {text('正在生成', 'Generating')} {loadingDots}
                </div>
              ) : (
                <div
                  className="text-xs whitespace-pre-wrap leading-relaxed mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {aiResult}
                </div>
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs rounded-md transition-colors"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={handleRejectAI}
                >
                  {text('取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-foreground)' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  disabled={aiResult === '' || aiError !== null}
                  onClick={handleAcceptAI}
                >
                  <Check size={12} aria-hidden="true" />
                  {text('替换', 'Replace')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="flex items-center gap-0.5 pl-0.5 pr-1 text-[10px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Sparkles size={11} />AI
              </div>
              {AI_ACTIONS.map(action => (
                <button
                  key={action.key}
                  type="button"
                  className={cn('p-1.5 rounded flex items-center gap-1 transition-colors', action.color)}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={() => handleAIAction(action)}
                >
                  <span className="text-[10px] tracking-widest">{text(...action.label)}</span>
                </button>
              ))}
              <div className="w-[1px] h-3.5 mx-0.5" style={{ backgroundColor: 'var(--color-border)' }} />
              <button
                type="button"
                className="p-1.5 rounded flex items-center gap-1 transition-colors text-[var(--color-accent)]"
                title={text('标记为伏笔', 'Mark as Foreshadowing')}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => {
                  const res = getSelectionInfo()
                  if (!res.success) {
                    if (res.reason === 'ambiguous') {
                      toast.warning(res.message || text('所选文字存在多个位置，请缩短选择范围或重新选择', 'The selected text appears in multiple locations. Please narrow your selection or reselect.'))
                    } else if (res.reason === 'not_found') {
                      toast.warning(res.message || text('未在正文中找到所选文字，请重新选择', 'The selected text was not found in the prose. Please reselect.'))
                    }
                    return
                  }
                  setBubbleOpen(false)
                  onMarkForeshadowing?.(res.info)
                }}
              >
                <Bookmark size={11} />
                <span className="text-[10px] tracking-widest">{text('伏笔', 'Foreshadow')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 伏笔高亮气泡浮层卡片 */}
      {popover.open && popover.foreshadowing && (
        <div
          className="foreshadowing-popover-card fixed z-50 w-72 rounded-xl p-3 border shadow-xl select-none"
          style={{
            top: popover.pos.top,
            left: popover.pos.left,
            backgroundColor: 'var(--color-surface, var(--color-sidebar))',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Bookmark size={13} style={{ color: 'var(--color-accent)' }} />
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium truncate"
                style={{
                  backgroundColor: popover.foreshadowing.completed
                    ? 'var(--color-hover)'
                    : 'rgba(var(--color-accent-rgb, 99 102 241), 0.12)',
                  color: popover.foreshadowing.completed
                    ? 'var(--color-text-muted)'
                    : 'var(--color-accent)',
                }}
              >
                {popover.foreshadowing.markerType || text('伏笔', 'Foreshadowing')}
              </span>
              {popover.foreshadowing.completed ? (
                <span className="text-[10px] text-[var(--color-success-text)] font-medium">
                  {text('已完成', 'Completed')}
                </span>
              ) : (
                <span className="text-[10px] text-[var(--color-warning-text)] font-medium">
                  {text('待回收', 'Pending')}
                </span>
              )}
            </div>
            <button
              type="button"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-0.5 rounded transition-colors"
              onClick={() => setPopover(prev => ({ ...prev, open: false }))}
              title={text('关闭', 'Close')}
            >
              <X size={12} />
            </button>
          </div>

          <div
            className="text-xs italic line-clamp-2 px-2 py-1 rounded mb-2 border text-[var(--color-text-secondary)]"
            style={{
              backgroundColor: 'var(--color-hover)',
              borderColor: 'var(--color-border)',
            }}
          >
            "{popover.foreshadowing.selectedText}"
          </div>

          {popover.foreshadowing.note && (
            <div className="text-xs leading-relaxed mb-3 text-[var(--color-text)] break-words">
              {popover.foreshadowing.note}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text-secondary)' }}
              onClick={() => {
                if (popover.foreshadowing) {
                  onToggleForeshadowingCompleted?.(popover.foreshadowing.id, !popover.foreshadowing.completed)
                  setPopover(prev => prev.foreshadowing ? ({
                    ...prev,
                    foreshadowing: { ...prev.foreshadowing, completed: !prev.foreshadowing.completed }
                  }) : prev)
                }
              }}
            >
              {popover.foreshadowing.completed ? (
                <>
                  <Circle size={12} />
                  <span>{text('标记为未完成', 'Mark as Pending')}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={12} className="text-[var(--color-success-text)]" />
                  <span>{text('标记为已完成', 'Mark as Completed')}</span>
                </>
              )}
            </button>

            {onOpenForeshadowingManager && (
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-accent)' }}
                onClick={() => {
                  setPopover(prev => ({ ...prev, open: false }))
                  onOpenForeshadowingManager()
                }}
              >
                <ExternalLink size={12} />
                <span>{text('管理伏笔', 'Manage')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export { VDITOR_ASSET_BASE, VDITOR_TOOLBAR }
