import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import DocumentEditingSurface, { type DocumentEditingSurfaceProps } from '../DocumentEditingSurface'
import { useLocaleStore } from '../../../stores/locale-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalLocaleState = useLocaleStore.getState()
const READY_TIMEOUT = 20000

let root: Root
let panel: HTMLDivElement

function nav(): HTMLElement {
  const element = panel.querySelector('[aria-label="文档目录"]')
  expect(element).not.toBeNull()
  return element as HTMLElement
}

function outlineHeadings(): HTMLButtonElement[] {
  return Array.from(nav().querySelectorAll<HTMLButtonElement>('.document-editing-surface__heading'))
}

async function waitForReady(): Promise<void> {
  await vi.waitFor(() => {
    expect(panel.querySelector('[data-vditor-ready="true"]')).not.toBeNull()
  }, { timeout: READY_TIMEOUT })
}

async function renderSurface(props: DocumentEditingSurfaceProps, width = 1100): Promise<void> {
  panel.style.width = `${width}px`
  await act(async () => {
    root.render(
      <DocumentEditingSurface {...props} className="document-surface-test-editor" />,
    )
  })
  await waitForReady()
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  panel = document.createElement('div')
  panel.style.cssText = 'width: 1100px; height: 680px; overflow: hidden;'
  document.body.append(panel)
  root = createRoot(panel)
})

afterEach(async () => {
  await act(async () => root.unmount())
  panel.remove()
  document.getElementById('vditorIconScript')?.remove()
  useLocaleStore.setState(originalLocaleState)
  vi.restoreAllMocks()
})

describe('DocumentEditingSurface', () => {
  it('builds the outline from real Markdown headings, keeping duplicates, inline text, and H3 folding', async () => {
    const content = [
      '# 总览',
      '## 重复标题',
      '### 子节',
      '#### 子节细节',
      '## 重复标题',
      '### 第二组',
      '## 带 **格式** 与 [链接](https://example.com) 的标题',
      '```markdown',
      '## 代码中的伪标题',
      '```',
    ].join('\n')
    await renderSurface({
      documentIdentity: 'project/test/document/outline.md',
      layout: 'long-document',
      content,
    })

    const labels = outlineHeadings().map(button => button.textContent?.trim())
    expect(labels).toEqual([
      '总览', '重复标题', '子节', '子节细节', '重复标题', '第二组', '带 格式 与 链接 的标题',
    ])
    expect(outlineHeadings()[1].classList.contains('is-primary')).toBe(true)

    const rows = Array.from(nav().querySelectorAll<HTMLElement>('.document-editing-surface__heading-row'))
    const firstH2Row = rows.find(row => row.dataset.headingLevel === '2' && row.querySelector('.document-editing-surface__heading')?.textContent?.trim() === '重复标题')
    const firstGroupToggle = firstH2Row?.querySelector<HTMLButtonElement>('.document-editing-surface__group-toggle')
    expect(firstGroupToggle?.getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      firstGroupToggle?.focus()
      await userEvent.keyboard('{Enter}')
    })
    expect(firstGroupToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(outlineHeadings().some(button => button.textContent?.trim() === '子节')).toBe(false)
    expect(outlineHeadings().some(button => button.textContent?.trim() === '第二组')).toBe(true)
  })

  it('keeps headings navigable when there is no H2 and responds to the actual panel width', async () => {
    await renderSurface({
      documentIdentity: 'project/test/document/no-h2.md',
      layout: 'long-document',
      content: '### 只有三级\n\n#### 四级细节\n\n###### 六级细节',
    }, 680)

    expect(outlineHeadings().map(button => button.textContent?.trim())).toEqual([
      '只有三级', '四级细节', '六级细节',
    ])
    const outline = panel.querySelector<HTMLElement>('.document-editing-surface__outline')
    expect(outline?.getAttribute('data-outline-panel')).toBe('collapsed')
    const toggle = panel.querySelector<HTMLButtonElement>('.document-editing-surface__outline-toggle')
    await act(async () => toggle?.click())
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(nav().hidden).toBe(false)

    await act(async () => {
      panel.style.width = '1100px'
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    await vi.waitFor(() => expect(outline?.getAttribute('data-outline-panel')).toBe('open'))

    await renderSurface({
      documentIdentity: 'project/test/document/empty.md',
      layout: 'long-document',
      content: '正文中没有 Markdown 标题。',
    }, 1100)
    expect(nav().textContent).toContain('使用 # 至 ###### 添加标题后即可生成目录。')
  })

  it('keeps a long outline independently scrollable', async () => {
    const content = Array.from({ length: 90 }, (_, index) => `## 第${index + 1}节`).join('\n\n')
    await renderSurface({
      documentIdentity: 'project/test/document/long-outline.md',
      layout: 'long-document',
      content,
    })

    const outline = nav()
    const style = getComputedStyle(outline)
    expect(style.overflowY).toBe('auto')
    expect(outline.scrollHeight).toBeGreaterThan(outline.clientHeight)
  })

  it('updates the outline from live, unsaved source-mode edits', async () => {
    const onChange = vi.fn()
    await renderSurface({
      documentIdentity: 'project/test/document/unsaved.md',
      layout: 'long-document',
      content: '# 原标题\n\n原文',
      onChange,
    })

    const modeButton = panel.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-mode="sv"]')
    expect(modeButton).not.toBeNull()
    await act(async () => modeButton?.click())
    const source = panel.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')
    expect(source).not.toBeNull()
    const inserted = '\n\n## 未保存目录标题'
    await act(async () => {
      const end = source!.value.length
      source!.setRangeText(inserted, end, end, 'end')
      source!.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: inserted,
      }))
    })

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled()
      expect(outlineHeadings().some(button => button.textContent?.trim() === '未保存目录标题')).toBe(true)
    })
    expect(String(onChange.mock.calls.at(-1)?.[0])).toContain('## 未保存目录标题')
  })

  it('keeps the outline navigable in read-only mode without sending edits or saves', async () => {
    const onChange = vi.fn()
    const onSave = vi.fn()
    await renderSurface({
      documentIdentity: 'project/test/document/readonly.md',
      layout: 'long-document',
      content: '# 只读文档\n\n## 可导航标题\n\n正文',
      editable: false,
      onChange,
      onSave,
    })

    const target = outlineHeadings().find(button => button.textContent?.trim() === '可导航标题')
    expect(target).not.toBeNull()
    await act(async () => target?.click())
    expect(panel.querySelector('[data-editable="false"]')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders business fields without document chrome and expands or contracts with live Markdown', async () => {
    const onChange = vi.fn()
    const props: DocumentEditingSurfaceProps = {
      documentIdentity: 'project/test/form/character/background',
      layout: 'business-field',
      ariaLabel: '背景故事',
      content: '短文',
      onChange,
    }
    await renderSurface(props)

    const surface = panel.querySelector<HTMLElement>('[data-document-layout="business-field"]')!
    const toolbar = surface.querySelector<HTMLElement>('.vditor-toolbar')!
    const editor = surface.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')!
    expect(surface.dataset.headingToc).toBe('disabled')
    expect(surface.querySelector('nav[aria-label="文档目录"]')).toBeNull()
    expect(getComputedStyle(toolbar).display).toBe('none')
    expect(surface.getAttribute('aria-label')).toBe('背景故事')
    expect(editor.getAttribute('aria-label')).toBe('背景故事')
    const shortHeight = editor.getBoundingClientRect().height

    const longText = Array.from({ length: 80 }, (_, index) => `第${index + 1}段内容继续展开，保持表单正文自然增高。`).join('\n')
    await act(async () => {
      editor.focus()
      editor.textContent = longText
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: longText }))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    const longHeight = editor.getBoundingClientRect().height
    expect(longHeight).toBeGreaterThan(shortHeight * 3)

    await act(async () => {
      editor.textContent = '回缩后的短文'
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }))
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    await vi.waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(1))
    expect(editor.getBoundingClientRect().height).toBeLessThan(longHeight)
    expect(getComputedStyle(surface).overflowY).toBe('visible')
  })

  it('keeps a long-document outline collapsed on its page control until asked to open', async () => {
    await renderSurface({
      documentIdentity: 'project/test/document/page-outline.md',
      layout: 'long-document',
      outlineControl: 'page',
      content: '## 机制标题\n\n规则正文',
    })
    const toggle = panel.querySelector<HTMLButtonElement>('.document-editing-surface__page-outline-control button')
    expect(toggle?.textContent).toContain('目录')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(panel.querySelector<HTMLElement>('aside.document-editing-surface__outline')?.hidden).toBe(true)
    await act(async () => toggle?.click())
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelector<HTMLElement>('aside.document-editing-surface__outline')?.hidden).toBe(false)
  })

  it('shows a full-width editor under a right floating outline and leaves no rail when closed', async () => {
    const content = Array.from({ length: 42 }, (_, index) => '## 第' + (index + 1) + '节').join('\n\n')
    await renderSurface({
      documentIdentity: 'project/test/document/floating-outline.md',
      layout: 'long-document',
      outlineControl: 'floating',
      appearance: 'full-bleed',
      content,
    })

    const surface = panel.querySelector<HTMLElement>('.document-editing-surface')!
    const editor = surface.querySelector<HTMLElement>('.document-editing-surface__editor')!
    const editorHost = surface.querySelector<HTMLElement>('.vditor-prose-host')!
    const editable = surface.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')!
    const toggle = surface.querySelector<HTMLButtonElement>('.document-editing-surface__page-outline-control button')!
    const editorWidth = editor.getBoundingClientRect().width
    expect(surface.dataset.editorAppearance).toBe('full-bleed')
    expect(getComputedStyle(surface).backgroundColor)
      .toBe(getComputedStyle(editorHost).backgroundColor)
    expect(getComputedStyle(editable).maxWidth).toBe('none')
    expect(getComputedStyle(editable).borderRadius).toBe('0px')
    expect(getComputedStyle(editable).boxShadow).toBe('none')
    expect(getComputedStyle(surface.querySelector<HTMLElement>('.vditor-ir')!).overflowY).toBe('auto')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await act(async () => toggle.click())
    const outline = surface.querySelector<HTMLElement>('aside.document-editing-surface__outline')!
    const nav = outline.querySelector<HTMLElement>('nav[aria-label="文档目录"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(outline.hidden).toBe(false)
    expect(getComputedStyle(outline).position).toBe('absolute')
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight)
    expect(editor.getBoundingClientRect().width).toBe(editorWidth)
    expect(surface.querySelector('.vditor-prose-host')).toBe(editorHost)
    expect(nav.querySelectorAll('.document-editing-surface__heading')).toHaveLength(42)

    const close = outline.querySelector<HTMLButtonElement>('button[aria-label="关闭文档目录"]')!
    await act(async () => close.click())
    expect(outline.hidden).toBe(true)
    expect(outline.getBoundingClientRect().width).toBe(0)
    expect(surface.querySelector('.document-editing-surface__outline.is-open')).toBeNull()
    expect(editor.getBoundingClientRect().width).toBe(editorWidth)
    expect(document.activeElement).toBe(toggle)

    await act(async () => toggle.click())
    await act(async () => {
      outline.querySelector<HTMLButtonElement>('nav button')?.focus()
      await userEvent.keyboard('{Escape}')
    })
    expect(outline.hidden).toBe(true)
    expect(document.activeElement).toBe(toggle)
    expect(editor.getBoundingClientRect().width).toBe(editorWidth)
  })

  it('opens an empty floating outline without changing an untitled document', async () => {
    const onChange = vi.fn()
    await renderSurface({
      documentIdentity: 'project/test/document/floating-empty.md',
      layout: 'long-document',
      outlineControl: 'floating',
      appearance: 'full-bleed',
      content: '这份文档目前没有标题。',
      onChange,
    })
    const toggle = panel.querySelector<HTMLButtonElement>('.document-editing-surface__page-outline-control button')!
    await act(async () => toggle.click())
    const nav = panel.querySelector<HTMLElement>('nav[aria-label="文档目录"]')!
    expect(nav.textContent).toContain('使用 # 至 ###### 添加标题后即可生成目录。')
    expect(outlineHeadings()).toHaveLength(0)
    expect(onChange).not.toHaveBeenCalled()
    expect(panel.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('这份文档目前没有标题。')
  })

})
