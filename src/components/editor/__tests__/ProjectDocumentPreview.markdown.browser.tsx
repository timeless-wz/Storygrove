import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import ProjectDocumentPreview from '../ProjectDocumentPreview'

const PROJECT_PATH = 'C:\\novels\\preview'
const PROJECT_SESSION = {
  projectId: 'preview',
  leaseId: 'preview-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Preview',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '', subGenre: '', targetAudience: '', totalChapters: 4, wordsPerChapter: 2500,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '',
    worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function render(markdown: string, documentPath = '笔记.md'): Promise<void> {
  await act(async () => {
    root.render(
      <ProjectDocumentPreview
        markdown={markdown}
        documentPath={documentPath}
        projectKey={PROJECT_PATH}
      />,
    )
  })
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project })
  setActiveProjectSessionContext(PROJECT_SESSION)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'docs:read-asset') {
      return { success: true, dataUrl: 'data:image/png;base64,AAAA' }
    }
    return { success: false, error: 'unexpected channel' }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  vi.restoreAllMocks()
})

describe('project document preview', () => {
  it('renders GFM tables and task lists', async () => {
    await render([
      '| 章节 | 状态 |',
      '| --- | --- |',
      '| 第一章 | 已定稿 |',
      '',
      '- [x] 完成卷纲',
      '- [ ] 补写灵感',
    ].join('\n'))

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('th')).toHaveLength(2)
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(table?.textContent).toContain('第一章')

    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false)
  })

  it('renders headings and other block markup without dropping content', async () => {
    await render([
      '# 一级',
      '## 二级',
      '> 引用',
      '',
      '**粗体** 与 *斜体* 与 `代码`',
      '',
      '- 项目一',
      '1. 有序项',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n'))

    expect(container.querySelector('h1')?.textContent).toBe('一级')
    expect(container.querySelector('h2')?.textContent).toBe('二级')
    expect(container.querySelector('blockquote')?.textContent).toContain('引用')
    expect(container.querySelectorAll('ul li')).toHaveLength(1)
    expect(container.querySelectorAll('ol li')).toHaveLength(1)
    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1')
  })

  it('never executes or renders raw HTML and scripts', async () => {
    await render([
      '# 标题',
      '<script>window.__projectDocumentXss = "script"</script>',
      '<img src="x" onerror="window.__projectDocumentXss = \'img\'">',
      '<iframe src="https://example.com"></iframe>',
      '',
      '正文',
    ].join('\n'))

    const globals = window as unknown as { __projectDocumentXss?: string }
    expect(globals.__projectDocumentXss).toBeUndefined()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    // 只有 Markdown 里真正的图片会被渲染；原始 HTML 属性不会变成 DOM。
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.textContent).toContain('标题')
    expect(container.textContent).toContain('正文')
  })

  it('refuses images outside the managed documents directory', async () => {
    await render('![越界](../../secret.png)\n\n![远程](https://example.com/a.png)\n')

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelectorAll('[data-project-document-image="unavailable"]')).toHaveLength(2)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('loads a managed asset through the project-scoped reader', async () => {
    await render('![地图](assets/地图.png)\n')

    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    })
    expect(invoke).toHaveBeenCalledWith(
      'docs:read-asset',
      '笔记.md',
      'assets/地图.png',
      PROJECT_PATH,
      PROJECT_SESSION,
    )
    expect(container.querySelector('img')?.getAttribute('src'))
      .toBe('data:image/png;base64,AAAA')
  })

  it('surfaces missing assets as a notice instead of crashing the preview', async () => {
    invoke.mockImplementation(async () => ({ success: false, error: '图片不存在' }))
    await render('![地图](assets/不存在.png)\n')

    await act(async () => {
      await vi.waitFor(() => expect(
        container.querySelector('[data-project-document-image="unavailable"]'),
      ).not.toBeNull())
    })
    expect(container.querySelector('img')).toBeNull()
    // 预览没有因此崩溃：提示仍在，编辑器可以继续用。
    expect(container.textContent).toContain('不可用')
  })

  it('reports malformed markdown with a notice while keeping the rest readable', async () => {
    await render('# 正常标题\n\n```\n未闭合的代码围栏\n')

    expect(container.textContent).toContain('Markdown 结构提示')
    expect(container.textContent).toContain('未闭合')
    expect(container.textContent).toContain('正常标题')
  })

  it('blocks javascript: links while keeping ordinary links', async () => {
    await render('[危险](javascript:alert(1)) 与 [正常](https://example.com)\n')

    const anchors = Array.from(container.querySelectorAll('a'))
    expect(anchors.some(anchor => (anchor.getAttribute('href') ?? '').startsWith('javascript:'))).toBe(false)
    expect(anchors.some(anchor => anchor.getAttribute('href') === 'https://example.com')).toBe(true)
  })
})
