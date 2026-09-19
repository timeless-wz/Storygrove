import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VditorProseEditor, { type VditorProseEditorProps } from '../VditorProseEditor'
import { useLocaleStore } from '../../../stores/locale-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalLocaleState = useLocaleStore.getState()

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
      '#vditor-icon-upload',
      '#vditor-icon-line',
      '#vditor-icon-code',
      '#vditor-icon-align-center',
      '#vditor-icon-fullscreen',
      '#vditor-icon-edit',
    ]))
    // 本地图标脚本加载成功才会出现图标脚本节点；这也证明没有走公网 CDN。
    expect(document.getElementById('vditorIconScript')).not.toBeNull()
    expect(document.querySelector('script[src*="unpkg.com"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
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

  it('keeps the prose truly read-only when editable is false', async () => {
    const onChange = vi.fn()
    await render({ content: '第 1 章已经定稿。', editable: false, onChange })

    const prose = proseElement()
    expect(prose.getAttribute('contenteditable')).toBe('false')
    // 会改写正文的工具栏动作全部被禁用。
    expect(container.querySelector('.vditor-toolbar .vditor-menu--disabled')).not.toBeNull()

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

    // 外层把作者输入回写为 content 时，不应再触发一次编辑器写入或 onChange。
    await act(async () => {
      root.render(<VditorProseEditor content={emitted} editable onChange={onChange} />)
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(proseElement().textContent).toContain('新的段落。')
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
})
