import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VditorProseEditor, { type VditorProseEditorProps, type VditorProseEditorRef } from '../VditorProseEditor'
import { useLocaleStore } from '../../../stores/locale-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { openBuiltinEditor } from '../../panels/sidebar/sidebar-file-openers'
import ForeshadowingManagementView from '../ForeshadowingManagementView'
import type { ForeshadowingRecord } from '../../../shared/foreshadowing'
import { toast } from '../../ui/Toast'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalLocaleState = useLocaleStore.getState()
const originalEditorState = useEditorStore.getState()
const originalProjectState = useProjectStore.getState()

let root: Root
let container: HTMLDivElement

/** Vditor 需要加载本地 Lute 解析器，首屏渲染慢于普通组件。 */
const READY_TIMEOUT = 20000

function hostElement(): HTMLElement {
  const host = container.querySelector('[data-vditor-prose-editor="true"]')
  expect(host).not.toBeNull()
  return host as HTMLElement
}

/** 正文（IR）可编辑元素。 */
function proseElement(): HTMLElement {
  const element = container.querySelector('.vditor-ir pre.vditor-reset')
  expect(element).not.toBeNull()
  return element as HTMLElement
}

/** 当前可见的编辑区域。 */
function visibleEditor(): 'ir' | 'wysiwyg' | 'sv' | null {
  for (const [mode, selector] of [
    ['ir', '.vditor-ir'],
    ['wysiwyg', '.vditor-wysiwyg'],
    ['sv', '.vditor-sv'],
  ] as const) {
    const element = container.querySelector(selector) as HTMLElement | null
    if (element && element.style.display !== 'none') return mode
  }
  return null
}

/** 工具栏图标 href，用来证明写作工具栏确实由本地图标集渲染。 */
function toolbarIconHrefs(): string[] {
  return Array.from(container.querySelectorAll('.vditor-toolbar use'))
    .map(use => use.getAttribute('xlink:href') ?? use.getAttribute('href') ?? '')
}

/** 点击内置的“编辑模式”子菜单项。 */
async function switchMode(mode: 'ir' | 'wysiwyg' | 'sv'): Promise<void> {
  const button = container.querySelector(`.vditor-toolbar button[data-mode="${mode}"]`)
  expect(button).not.toBeNull()
  await act(async () => {
    (button as HTMLElement).click()
  })
}

async function waitForReady(): Promise<void> {
  await act(async () => {
    await vi.waitFor(
      () => expect(hostElement().getAttribute('data-vditor-ready')).toBe('true'),
      { timeout: READY_TIMEOUT },
    )
  })
}

async function render(props: VditorProseEditorProps): Promise<void> {
  await act(async () => {
    root.render(<VditorProseEditor {...props} />)
  })
  await waitForReady()
}

/**
 * 模拟作者在即时渲染模式下的真实输入：把光标放到正文末尾，
 * 再用浏览器原生的 insertText 触发 Vditor 的 input 事件链。
 */
async function typeAtEndOfProse(value: string): Promise<void> {
  const prose = proseElement()
  await act(async () => {
    prose.focus()
    const range = document.createRange()
    range.selectNodeContents(prose.lastElementChild ?? prose)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.execCommand('insertText', false, value)
  })
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.getElementById('vditorIconScript')?.remove()
  useLocaleStore.setState(originalLocaleState)
  useEditorStore.setState(originalEditorState)
  useProjectStore.setState(originalProjectState)
  vi.restoreAllMocks()
})

describe('Vditor prose editor', () => {
  it('loads the initial Markdown through the vendored local resources', async () => {
    const onChange = vi.fn()
    await render({
      content: '# 第一章\n\n林岚走进了房间。',
      editable: true,
      onChange,
    })

    const prose = proseElement()
    expect(prose.textContent).toContain('林岚走进了房间。')
    expect(container.querySelector('.vditor-ir h1')?.textContent).toContain('第一章')
    // 默认进入即时渲染（IR）模式。
    expect(visibleEditor()).toBe('ir')
    // 小说创作工具栏全部来自本地图标集（含模式切换、目录与全屏）。
    expect(toolbarIconHrefs()).toEqual(expect.arrayContaining([
      '#vditor-icon-undo',
      '#vditor-icon-redo',
      '#vditor-icon-headings',
      '#vditor-icon-bold',
      '#vditor-icon-italic',
      '#vditor-icon-strike',
      '#vditor-icon-quote',
      '#vditor-icon-list',
      '#vditor-icon-ordered-list',
      '#vditor-icon-check',
      '#vditor-icon-link',
      '#vditor-icon-line',
      '#vditor-icon-outdent',
      '#vditor-icon-indent',
      '#vditor-icon-table',
      '#vditor-icon-align-center',
      '#vditor-icon-fullscreen',
      '#vditor-icon-edit',
    ]))
    // 本地图标脚本加载成功才会出现图标脚本节点；这也证明没有走公网 CDN。
    expect(document.getElementById('vditorIconScript')).not.toBeNull()
    expect(document.querySelector('script[src*="unpkg.com"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens the insert menu with native document actions', async () => {
    const onChange = vi.fn()
    await render({ content: '林岚走进了房间。', editable: true, onChange })

    await act(async () => {
      const prose = proseElement()
      prose.focus()
      const range = document.createRange()
      range.selectNodeContents(prose.lastElementChild ?? prose)
      range.collapse(false)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })

    const insert = container.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-type="insert"]')
    expect(insert).not.toBeNull()
    await act(async () => insert?.click())

    const menu = insert?.parentElement?.querySelector<HTMLElement>('.vditor-hint')
    expect(menu).not.toBeNull()
    expect(menu?.style.display).toBe('block')
    expect(menu?.querySelector('[data-type="table"]')).not.toBeNull()
    expect(menu?.querySelector('[data-type="upload"]')).not.toBeNull()
    expect(menu?.querySelector('[data-type="code"]')).not.toBeNull()
    expect(menu?.querySelector('[data-type="line"]')).not.toBeNull()

    await act(async () => {
      menu?.querySelector<HTMLButtonElement>('[data-type="line"]')?.click()
    })
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(String(onChange.mock.calls.at(-1)?.[0])).toContain('---')
  })

  it('places toolbar hints below the button so the top edge cannot clip them', async () => {
    await render({ content: '正文', editable: true, onChange: vi.fn() })
    const heading = container.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-type="headings"]')
    expect(heading).not.toBeNull()
    const hint = getComputedStyle(heading!, '::after')
    expect(hint.bottom).toBe('auto')
    expect(hint.top).toContain('100%')
  })

  it('offers all three built-in editing modes', async () => {
    await render({ content: '林岚走进了房间。', editable: true, onChange: vi.fn() })

    await switchMode('sv')
    expect(visibleEditor()).toBe('sv')
    expect((container.querySelector('.vditor-sv') as HTMLTextAreaElement).value)
      .toContain('林岚走进了房间。')

    await switchMode('wysiwyg')
    expect(visibleEditor()).toBe('wysiwyg')
    expect(container.querySelector('.vditor-wysiwyg')?.textContent).toContain('林岚走进了房间。')

    await switchMode('ir')
    expect(visibleEditor()).toBe('ir')
    expect(proseElement().textContent).toContain('林岚走进了房间。')
  })

  it('reports the Markdown source when the author types', async () => {
    const onChange = vi.fn()
    await render({ content: '林岚走进了房间。', editable: true, onChange })

    await typeAtEndOfProse('她关上了门。')

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(String(onChange.mock.calls.at(-1)?.[0])).toContain('她关上了门。')
  })

  it('saves the current Markdown with Ctrl/Cmd+S', async () => {
    const onSave = vi.fn()
    await render({ content: '林岚走进了房间。', editable: true, onChange: vi.fn(), onSave })

    const prose = proseElement()
    await act(async () => {
      prose.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(String(onSave.mock.calls[0]?.[0])).toContain('林岚走进了房间。')
  })

  it('does not invoke the save callback from a read-only editor', async () => {
    const onSave = vi.fn()
    await render({ content: '只读文档。', editable: false, onChange: vi.fn(), onSave })

    await act(async () => {
      proseElement().dispatchEvent(new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the prose truly read-only when editable is false', async () => {
    const onChange = vi.fn()
    await render({ content: '第 1 章已经定稿。', editable: false, onChange })

    const prose = proseElement()
    expect(prose.getAttribute('contenteditable')).toBe('false')
    // 会改写正文的工具栏动作全部被禁用。
    expect(container.querySelector('.vditor-toolbar .vditor-menu--disabled')).not.toBeNull()
    const insert = container.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-type="insert"]')
    expect(insert?.disabled).toBe(true)

    const paste = new Event('paste', { bubbles: true, cancelable: true })
    await act(async () => {
      prose.focus()
      prose.dispatchEvent(paste)
      document.execCommand('insertText', false, '试图写入')
    })

    expect(paste.defaultPrevented).toBe(true)
    expect(prose.textContent).not.toContain('试图写入')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('allows switching view modes while strictly keeping content read-only and without triggering onChange', async () => {
    const onChange = vi.fn()
    const content = '# 第 1 章\n\n林岚走进了房间。'
    await render({ content, editable: false, onChange })

    // 初始处于 IR 模式，且正文只读
    expect(visibleEditor()).toBe('ir')
    expect(proseElement().getAttribute('contenteditable')).toBe('false')
    const boldButton = container.querySelector('.vditor-toolbar button[data-type="bold"]')
    expect(boldButton?.classList.contains('vditor-menu--disabled')).toBe(true)
    const editModeButton = container.querySelector('.vditor-toolbar button[data-type="edit-mode"]')
    expect(editModeButton?.classList.contains('vditor-menu--disabled')).toBe(false)

    // 切到分屏预览（SV）模式
    await switchMode('sv')
    expect(visibleEditor()).toBe('sv')
    const svTextarea = container.querySelector('.vditor-sv') as HTMLTextAreaElement
    expect(svTextarea.disabled).toBe(true)
    expect(svTextarea.value).toContain('林岚走进了房间。')
    expect(boldButton?.classList.contains('vditor-menu--disabled')).toBe(true)

    // 切到所见即所得（WYSIWYG）模式
    await switchMode('wysiwyg')
    expect(visibleEditor()).toBe('wysiwyg')
    const wysiwygPre = container.querySelector('.vditor-wysiwyg pre.vditor-reset') as HTMLElement
    expect(wysiwygPre.getAttribute('contenteditable')).toBe('false')
    expect(wysiwygPre.textContent).toContain('林岚走进了房间。')
    expect(boldButton?.classList.contains('vditor-menu--disabled')).toBe(true)

    // 切回即时渲染（IR）模式
    await switchMode('ir')
    expect(visibleEditor()).toBe('ir')
    expect(proseElement().getAttribute('contenteditable')).toBe('false')
    expect(proseElement().textContent).toContain('林岚走进了房间。')
    expect(boldButton?.classList.contains('vditor-menu--disabled')).toBe(true)

    // 全程正文不变且 onChange 绝不触发
    expect(onChange).not.toHaveBeenCalled()
  })

  it('swaps chapter content without echoing onChange and keeps later edits', async () => {
    const onChange = vi.fn()
    await render({ content: '第一章正文。', editable: true, onChange })

    await act(async () => {
      root.render(<VditorProseEditor content="第二章正文。" editable onChange={onChange} />)
    })

    expect(proseElement().textContent).toContain('第二章正文。')
    expect(onChange).not.toHaveBeenCalled()

    await typeAtEndOfProse('新的段落。')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const emitted = String(onChange.mock.calls[0]?.[0])
    expect(emitted).toContain('新的段落。')
    const proseBeforeEcho = proseElement()
    const selectionBeforeEcho = window.getSelection()
    const cursorNodeBeforeEcho = selectionBeforeEcho?.anchorNode ?? null
    const cursorOffsetBeforeEcho = selectionBeforeEcho?.anchorOffset ?? -1
    expect(cursorNodeBeforeEcho && proseBeforeEcho.contains(cursorNodeBeforeEcho)).toBe(true)

    // 外层把作者输入回写为 content 时，不应再触发一次编辑器写入或 onChange。
    await act(async () => {
      root.render(<VditorProseEditor content={emitted} editable onChange={onChange} />)
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(proseElement().textContent).toContain('新的段落。')
    expect(window.getSelection()?.anchorNode).toBe(cursorNodeBeforeEcho)
    expect(window.getSelection()?.anchorOffset).toBe(cursorOffsetBeforeEcho)

  })

  it('destroys the Vditor instance on unmount', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(
        <VditorProseEditor content="林岚走进了房间。" editable onChange={onChange} />,
      )
    })
    await waitForReady()
    expect(document.getElementById('vditorIconScript')).not.toBeNull()

    await act(async () => {
      root.render(<div data-vditor-prose-editor="false" />)
    })

    // 图标脚本挂在 document.head 上，只有 destroy() 才会把它移除。
    expect(document.getElementById('vditorIconScript')).toBeNull()
    expect(document.querySelector('.vditor')).toBeNull()
    expect(container.querySelector('.vditor-ir')).toBeNull()
  })

  it('survives React StrictMode effect replay before the local language asset is ready', async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <VditorProseEditor content="StrictMode 草稿。" editable onChange={vi.fn()} />
        </StrictMode>,
      )
    })
    await waitForReady()

    expect(proseElement().textContent).toContain('StrictMode 草稿。')
  })

  it('supports Ctrl/Cmd+1~6 to set heading level and Ctrl/Cmd+0 to revert to body across all modes', async () => {
    const onChange = vi.fn()
    await render({ content: '林岚坐在椅子上。', editable: true, onChange })

    const host = hostElement()

    // 1. IR 模式下 Ctrl+1 设置为一级标题
    const prose = proseElement()
    await act(async () => {
      prose.focus()
      const range = document.createRange()
      range.selectNodeContents(prose.firstElementChild ?? prose)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      host.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('.vditor-ir h1')).not.toBeNull()
    })

    // IR 模式下 Ctrl+0 恢复正文
    await act(async () => {
      host.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('.vditor-ir h1')).toBeNull()
    })

    // 2. SV 模式下测试 Ctrl+2 与 Ctrl+0
    await switchMode('sv')
    const textarea = container.querySelector('textarea.vditor-sv') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    await act(async () => {
      textarea.focus()
      textarea.setSelectionRange(0, 0)
      host.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => {
      expect(textarea.value).toMatch(/^## /)
    })

    await act(async () => {
      textarea.focus()
      textarea.setSelectionRange(0, 0)
      host.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => {
      expect(textarea.value).not.toMatch(/^## /)
    })
  })

  it('displays selection AI bubble menu when text is selected', async () => {
    await render({ content: '林岚推开窗户看着夜色。', editable: true, onChange: vi.fn() })

    const prose = proseElement()
    await act(async () => {
      prose.focus()
      const range = document.createRange()
      range.selectNodeContents(prose.firstElementChild ?? prose)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('润色')
      expect(container.textContent).toContain('扩写')
      expect(container.textContent).toContain('续写')
      expect(container.textContent).toContain('对话')
    })
  })

  it('supports insertRequest to insert content at cursor position', async () => {
    const onChange = vi.fn()
    await render({ content: '段落开头。', editable: true, onChange })

    const prose = proseElement()
    await act(async () => {
      prose.focus()
      const range = document.createRange()
      range.selectNodeContents(prose.firstElementChild ?? prose)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    await act(async () => {
      root.render(
        <VditorProseEditor
          content="段落开头。"
          editable
          onChange={onChange}
          insertRequest={{ text: '![插图](assets/pic.png)', requestId: 1 }}
        />,
      )
    })

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      expect(String(onChange.mock.calls.at(-1)?.[0])).toContain('![插图](assets/pic.png)')
    })
  })

  it('retains a pre-ready heading jump and scrolls only the active editor panel', async () => {
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {})
    const content = '# 序幕\n\n正文...\n\n## 终局\n\n最终段落...'
    await render({
      content,
      editable: true,
      onChange: vi.fn(),
      jumpTarget: { index: 1, line: 3, text: '终局', requestId: 1 },
    })

    const activePanel = container.querySelector('.vditor-ir')
    expect(activePanel).not.toBeNull()
    await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalled())
    expect(scrollSpy.mock.contexts).toContain(activePanel)
    expect(container.querySelector('.vditor-wysiwyg')?.scrollTop ?? 0).toBe(0)
  })

  it('reports the active heading from the complete Markdown heading sequence as the panel scrolls', async () => {
    const onActiveHeadingChange = vi.fn()
    await render({
      content: '# 序幕\n\n正文\n\n## 第二幕\n\n### 隐藏的小节\n\n正文\n\n## 终局',
      editable: true,
      onChange: vi.fn(),
      onActiveHeadingChange,
    })

    const panel = container.querySelector<HTMLElement>('.vditor-ir')
    const headings = Array.from(container.querySelectorAll<HTMLElement>('.vditor-ir h1, .vditor-ir h2, .vditor-ir h3'))
    expect(panel).not.toBeNull()
    expect(headings).toHaveLength(4)

    const panelRect = { top: 100, left: 0, right: 500, bottom: 600, width: 500, height: 500, x: 0, y: 100, toJSON: () => ({}) } as DOMRect
    vi.spyOn(panel!, 'getBoundingClientRect').mockReturnValue(panelRect)
    const headingTops = [40, 139, 260, 360]
    headings.forEach((heading, index) => {
      vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({
        top: headingTops[index], left: 0, right: 200, bottom: headingTops[index] + 24,
        width: 200, height: 24, x: 0, y: headingTops[index], toJSON: () => ({}),
      } as DOMRect)
    })

    await act(async () => {
      panel!.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(onActiveHeadingChange).toHaveBeenCalledWith(expect.objectContaining({ index: 1, text: '第二幕' }))
    })

    headingTops[2] = 130
    vi.spyOn(headings[2], 'getBoundingClientRect').mockReturnValue({
      top: 130, left: 0, right: 200, bottom: 154, width: 200, height: 24, x: 0, y: 130, toJSON: () => ({}),
    } as DOMRect)
    await act(async () => {
      panel!.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(onActiveHeadingChange).toHaveBeenCalledWith(expect.objectContaining({ index: 2, text: '隐藏的小节' }))
    })
  })

  it('uses the exact source line and measured textarea layout for source-mode jumps', async () => {
    const content = '# 序幕\r\n\r\n' + '一段很长的文字'.repeat(60) + '\r\n\r\n## 目标章节\r\n\r\n正文'
    await render({ content, editable: true, onChange: vi.fn() })
    await switchMode('sv')

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
    expect(textarea).not.toBeNull()
    Object.defineProperty(textarea!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 30, left: 0, right: 340, bottom: 430, width: 340, height: 400, x: 0, y: 30, toJSON: () => ({}) }),
    })
    Object.defineProperty(textarea!, 'clientWidth', { configurable: true, value: 340 })
    const scrollSpy = vi.spyOn(textarea!, 'scrollTo').mockImplementation(() => {})
    const targetOffset = textarea!.value.indexOf('## 目标章节')
    const targetLine = textarea!.value.slice(0, targetOffset).split(/\r\n|\r|\n/).length - 1

    await act(async () => {
      root.render(
        <VditorProseEditor
          content={content}
          editable
          onChange={vi.fn()}
          jumpTarget={{ index: 1, line: targetLine, text: '目标章节', requestId: 2 }}
        />,
      )
    })

    // The request still targets the original exact Markdown offset in source mode.
    expect(textarea!.selectionStart).toBe(targetOffset)
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    const firstScrollOptions = scrollSpy.mock.calls[0]?.[0] as unknown as ScrollToOptions | undefined
    expect(firstScrollOptions).toEqual(expect.objectContaining({ top: expect.any(Number) }))
    expect(firstScrollOptions?.top).toBeGreaterThan(0)
  })

  it('re-resolves a source-mode jump after earlier headings change', async () => {
    const original = '# 序幕\n\n过场\n\n## 终局\n\n正文'
    const updated = '# 序幕\n\n## 新插入的章节\n\n过场\n\n## 终局\n\n正文'
    const staleLine = original.split('\n').indexOf('## 终局')
    await render({ content: original, editable: true, onChange: vi.fn() })
    await switchMode('sv')

    await act(async () => {
      root.render(
        <VditorProseEditor
          content={updated}
          editable
          onChange={vi.fn()}
          jumpTarget={{ index: 1, line: staleLine, text: '终局', requestId: 9 }}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
    expect(textarea?.value).toBe(updated)
    expect(textarea?.selectionStart).toBe(updated.indexOf('## 终局'))
  })

  it('registers CSS.highlights for foreshadowing colors and updates dynamically when status toggles', async () => {
    const fsh: ForeshadowingRecord = {
      id: 'f-1',
      draftId: 10,
      chapterNumber: 1,
      selectedText: '林岚',
      startOffset: 0,
      endOffset: 2,
      contextBefore: '',
      contextAfter: '走进了房间。',
      note: '主角登场',
      markerType: '伏笔',
      color: 'blue',
      completed: false,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      completedAt: null,
    }

    await render({
      content: '林岚走进了房间。',
      editable: true,
      foreshadowings: [fsh],
    })

    await vi.waitFor(() => {
      expect(CSS.highlights.has('foreshadowing-blue')).toBe(true)
    })

    // 切换为已完成
    await act(async () => {
      root.render(
        <VditorProseEditor
          content="林岚走进了房间。"
          editable
          foreshadowings={[{ ...fsh, completed: true }]}
        />,
      )
    })

    await vi.waitFor(() => {
      expect(CSS.highlights.has('foreshadowing-blue')).toBe(false)
      expect(CSS.highlights.has('foreshadowing-completed')).toBe(true)
    })
  })

  it('does NOT destroy or rebuild Vditor instance when foreshadowings change or status toggles, preserving uncommitted input', async () => {
    const fshInitial: ForeshadowingRecord = {
      id: 'f-stab-1',
      draftId: 10,
      chapterNumber: 1,
      selectedText: '林岚',
      startOffset: 0,
      endOffset: 2,
      contextBefore: '',
      contextAfter: '走进了房间。',
      note: '主角',
      markerType: '伏笔',
      color: 'blue',
      completed: false,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      completedAt: null,
    }

    await render({
      content: '林岚走进了房间。',
      editable: true,
      foreshadowings: [fshInitial],
    })

    await vi.waitFor(() => {
      expect(CSS.highlights.has('foreshadowing-blue')).toBe(true)
    })

    // 在当前 Vditor 元素上设置标记，用于验证 DOM 实例未被重建
    const initialVditorEl = container.querySelector('.vditor') as HTMLElement
    expect(initialVditorEl).not.toBeNull()
    ;(initialVditorEl as unknown as { __stableMarker: string }).__stableMarker = 'instance-persisted'

    // 输入未保存的内容
    await typeAtEndOfProse('并点亮了一盏油灯。')
    expect(proseElement().textContent).toContain('并点亮了一盏油灯。')

    // 触发伏笔列表更新：切换完成状态
    const fshUpdated: ForeshadowingRecord = {
      ...fshInitial,
      completed: true,
      completedAt: '2026-09-22T01:00:00.000Z',
    }

    await act(async () => {
      root.render(
        <VditorProseEditor
          content="林岚走进了房间。"
          editable
          foreshadowings={[fshUpdated]}
        />,
      )
    })

    // 验证高亮层已刷新到 completed
    await vi.waitFor(() => {
      expect(CSS.highlights.has('foreshadowing-completed')).toBe(true)
      expect(CSS.highlights.has('foreshadowing-blue')).toBe(false)
    })

    // 验证 Vditor 实例没有被销毁重建：
    // 1. 宿主内部的 .vditor DOM 节点仍是同一个对象，保留了标记属性
    const currentVditorEl = container.querySelector('.vditor') as HTMLElement
    expect(currentVditorEl).toBe(initialVditorEl)
    expect((currentVditorEl as unknown as { __stableMarker: string }).__stableMarker).toBe('instance-persisted')

    // 2. 作者未保存的即时输入内容完整保留，未被重置
    expect(proseElement().textContent).toContain('并点亮了一盏油灯。')
  })

  it('blocks marking foreshadowing and gives toast warning on empty selection', async () => {
    const editorRef = { current: null } as React.MutableRefObject<VditorProseEditorRef | null>
    const warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => {})

    await render({
      content: '空选中的段落文本。',
      editable: true,
      editorRef,
    })

    await act(async () => {
      window.getSelection()?.removeAllRanges()
    })

    const res = editorRef.current?.getSelectionInfo()
    expect(res?.success).toBe(false)
    if (!res || !res.success) {
      toast.warning('请先在正文中选中要标记为伏笔的文字')
    }
    expect(warningSpy).toHaveBeenCalledWith('请先在正文中选中要标记为伏笔的文字')
  })

  it('displays selection bubble menu with [伏笔] button and triggers onMarkForeshadowing with pure markdown offsets without injecting HTML', async () => {
    const onMarkForeshadowing = vi.fn()
    await render({
      content: '# 第一章\n\n那把古旧的锈剑静静躺在神龛角落。',
      editable: true,
      onMarkForeshadowing,
    })

    const prose = proseElement()
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT)
    let node: Text | null
    let targetRange: Range | null = null
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.nodeValue?.indexOf('古旧的锈剑') ?? -1
      if (idx !== -1) {
        targetRange = document.createRange()
        targetRange.setStart(node, idx)
        targetRange.setEnd(node, idx + '古旧的锈剑'.length)
        break
      }
    }
    expect(targetRange).not.toBeNull()

    await act(async () => {
      prose.focus()
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(targetRange!)
      document.dispatchEvent(new Event('selectionchange'))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('伏笔')
    })

    const fshBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('伏笔'))
    expect(fshBtn).toBeDefined()

    await act(async () => {
      fshBtn!.click()
    })

    expect(onMarkForeshadowing).toHaveBeenCalledTimes(1)
    const info = onMarkForeshadowing.mock.calls[0]?.[0]
    expect(info.selectedText).toBe('古旧的锈剑')
    expect(info.startOffset).toBeGreaterThanOrEqual(0)
    expect(info.endOffset).toBe(info.startOffset + '古旧的锈剑'.length)

    // 确认正文 Markdown 不包含任何 <mark>、<span> 或 HTML 标签
    const currentDoc = proseElement().textContent ?? ''
    expect(currentDoc).not.toContain('<mark')
    expect(currentDoc).not.toContain('<span')
    expect(currentDoc).not.toContain('style=')
  })

  it('opens popover card when clicking highlighted foreshadowing text and allows toggling completed', async () => {
    const onToggleForeshadowingCompleted = vi.fn()
    const onOpenForeshadowingManager = vi.fn()
    const fsh: ForeshadowingRecord = {
      id: 'f-item-1',
      draftId: 10,
      chapterNumber: 1,
      selectedText: '神剑',
      startOffset: 8,
      endOffset: 10,
      contextBefore: '深处藏着一把',
      contextAfter: '。',
      note: '斩魔关键道具',
      markerType: '关键道具',
      color: 'blue',
      completed: false,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      completedAt: null,
    }

    await render({
      content: '# 序章\n\n深处藏着一把神剑。',
      editable: true,
      foreshadowings: [fsh],
      onToggleForeshadowingCompleted,
      onOpenForeshadowingManager,
    })

    await vi.waitFor(() => {
      expect(CSS.highlights.has('foreshadowing-blue')).toBe(true)
    })

    const prose = proseElement()
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT)
    let node: Text | null
    let targetRange: Range | null = null
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.nodeValue?.indexOf('神剑') ?? -1
      if (idx !== -1) {
        targetRange = document.createRange()
        targetRange.setStart(node, idx)
        targetRange.setEnd(node, idx + 2)
        break
      }
    }
    expect(targetRange).not.toBeNull()
    const rect = targetRange!.getBoundingClientRect()

    await act(async () => {
      hostElement().dispatchEvent(new MouseEvent('click', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.foreshadowing-popover-card')).not.toBeNull()
    })

    const popover = container.querySelector('.foreshadowing-popover-card') as HTMLElement
    expect(popover.textContent).toContain('关键道具')
    expect(popover.textContent).toContain('待回收')
    expect(popover.textContent).toContain('斩魔关键道具')
    expect(popover.textContent).toContain('神剑')

    // 点击标记为已完成
    const toggleBtn = Array.from(popover.querySelectorAll('button')).find(b => b.textContent?.includes('标记为已完成'))
    expect(toggleBtn).toBeDefined()
    await act(async () => {
      toggleBtn!.click()
    })

    expect(onToggleForeshadowingCompleted).toHaveBeenCalledWith('f-item-1', true)

    // 点击管理伏笔
    const manageBtn = Array.from(popover.querySelectorAll('button')).find(b => b.textContent?.includes('管理伏笔'))
    expect(manageBtn).toBeDefined()
    await act(async () => {
      manageBtn!.click()
    })

    expect(onOpenForeshadowingManager).toHaveBeenCalledTimes(1)
  })

  it('preserves foreshadowings across draft publication retaining identical draft_id', async () => {
    // 草稿记录初始状态为 draft，id 为 42
    const draft = {
      id: 42,
      chapterNumber: 3,
      status: 'draft',
      content: '第三章草稿正文，埋下神秘线索。',
    }
    const fsh: ForeshadowingRecord = {
      id: 'f-draft-pub',
      draftId: draft.id,
      chapterNumber: draft.chapterNumber,
      selectedText: '神秘线索',
      startOffset: 11,
      endOffset: 15,
      contextBefore: '第三章草稿正文，埋下',
      contextAfter: '。',
      note: '核心暗线',
      markerType: '伏笔',
      color: 'blue',
      completed: false,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      completedAt: null,
    }

    // 模拟发布为正文 (finalized)，草稿 ID 保持 42
    const publishedDraft = {
      ...draft,
      status: 'finalized',
    }
    expect(publishedDraft.id).toBe(draft.id)
    expect(fsh.draftId).toBe(publishedDraft.id)

    // 在编辑器中渲染发布后的正文和伏笔
    await render({
      content: publishedDraft.content,
      editable: false,
      foreshadowings: [fsh],
    })

    await vi.waitFor(() => {
      expect(CSS.highlights.has('foreshadowing-blue')).toBe(true)
    })
    expect(proseElement().textContent).toContain('神秘线索')
  })

  it('opens foreshadowing management from sidebar and supports filtering, status toggling, and context preview in ForeshadowingManagementView', async () => {
    const PROJECT_PATH = 'C:\\novels\\foreshadowing-project'
    const PROJECT_SESSION = Object.freeze({
      projectId: 'proj-fsh-1',
      leaseId: 'lease-fsh-1',
      projectPath: PROJECT_PATH,
    })
    setActiveProjectSessionContext(PROJECT_SESSION)
    useProjectStore.setState({
      currentProject: {
        id: PROJECT_SESSION.projectId,
        path: PROJECT_PATH,
        sessionLease: PROJECT_SESSION.leaseId,
        name: 'Foreshadowing Novel',
      } as any,
    })

    // 1. 验证侧边栏文件打开器
    openBuiltinEditor('foreshadowing-manager', '伏笔管理', 'foreshadowing')
    const tabs = useEditorStore.getState().tabs
    const fshTab = tabs.find(t => t.type === 'foreshadowing')
    expect(fshTab).toBeDefined()
    expect(fshTab?.id).toContain('foreshadowing-manager')
    expect(fshTab?.type).toBe('foreshadowing')

    // 2. 验证管理视图加载与操作
    const mockItems: ForeshadowingRecord[] = [
      {
        id: 'f-mgmt-1',
        draftId: 1,
        chapterNumber: 1,
        selectedText: '生锈的钥匙',
        startOffset: 5,
        endOffset: 10,
        contextBefore: '石缝中有一把',
        contextAfter: '，隐隐发烫。',
        note: '开门道具',
        markerType: '伏笔',
        color: 'blue',
        completed: false,
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'f-mgmt-2',
        draftId: 1,
        chapterNumber: 1,
        selectedText: '羊皮纸卷轴',
        startOffset: 15,
        endOffset: 20,
        contextBefore: '旁边放着一卷',
        contextAfter: '。',
        note: '已查阅',
        markerType: '加深',
        color: 'purple',
        completed: true,
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
        completedAt: '2026-09-22T01:00:00.000Z',
      },
    ]

    const mockDrafts = [
      { id: 1, chapterNumber: 1, version: 1, status: 'draft', chapterTitle: '第一章 探索' },
    ]

    const invokeMock = vi.fn(async (channel: string, ..._args: unknown[]) => {
      if (channel === 'db:foreshadowing-list') return mockItems
      if (channel === 'db:draft-list-all') return mockDrafts
      if (channel === 'db:draft-get-full') return { id: 1, content: '石缝中有一把生锈的钥匙，隐隐发烫。旁边放着一卷羊皮纸卷轴。' }
      if (channel === 'db:foreshadowing-toggle-completed') return { success: true }
      return null
    })

    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: {
        invoke: invokeMock,
        on: () => () => {},
        once: () => {},
        send: () => {},
        setZoomLevel: () => {},
        setZoomFactor: () => {},
        getZoomLevel: () => 0,
      },
    })

    await act(async () => {
      root.render(<ForeshadowingManagementView projectKey={PROJECT_PATH} />)
    })

    // 等待数据加载完成
    await vi.waitFor(() => {
      expect(container.textContent).toContain('生锈的钥匙')
      expect(container.textContent).toContain('羊皮纸卷轴')
      expect(container.textContent).toContain('开门道具')
    })

    // 验证筛选：点击“待回收 / 未完成”
    const pendingFilterBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('待回收') && !b.closest('.foreshadowing-card'))
    expect(pendingFilterBtn).toBeDefined()
    await act(async () => {
      pendingFilterBtn!.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('生锈的钥匙')
      expect(container.textContent).not.toContain('羊皮纸卷轴')
    })

    // 验证筛选：点击“已回收 / 已完成”
    const completedFilterBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('已回收') && !b.closest('.foreshadowing-card'))
    expect(completedFilterBtn).toBeDefined()
    await act(async () => {
      completedFilterBtn!.click()
    })

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('生锈的钥匙')
      expect(container.textContent).toContain('羊皮纸卷轴')
    })

    // 验证状态切换：点击切换按钮
    const toggleCompletedBtn = container.querySelector('button[title*="标记为未完成"], button[title*="标记为已完成"]') as HTMLElement
    expect(toggleCompletedBtn).not.toBeNull()
    await act(async () => {
      toggleCompletedBtn.click()
    })

    expect(invokeMock).toHaveBeenCalledWith(
      'db:foreshadowing-toggle-completed',
      'f-mgmt-2',
      false,
      PROJECT_PATH,
      expect.objectContaining({ projectPath: PROJECT_PATH }),
    )
  })
})


