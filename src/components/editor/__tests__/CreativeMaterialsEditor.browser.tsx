import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import '../../../index.css'
import '../../../styles/literary-themes.css'
import type { ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import type { CreativeMaterialEntry, CreativeMaterialSaveInput } from '../../../shared/creative-content'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import ArchFileViewer from '../ArchFileViewer'
import CreativeMaterialsEditor from '../CreativeMaterialsEditor'

declare module 'vitest/browser' {
  interface BrowserCommands { creativeIpc: (channel: string, ...args: unknown[]) => Promise<unknown> }
}

const originalEditor = useEditorStore.getState()
const originalProject = useProjectStore.getState()
const originalLocale = useLocaleStore.getState()
let root: Root
let container: HTMLDivElement
let session: ProjectSessionContext

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tabId = 'creative-materials-materials'
type CreativeTestView = 'materials' | 'retired' | 'issues' | 'legacy'
const VIEW_TITLES: Record<CreativeTestView, string> = {
  materials: '素材与候选', retired: '废案', issues: '问题记录', legacy: '待整理旧内容',
}
const project: ProjectData = {
  id: 'creative-content-browser',
  sessionLease: '',
  name: 'Creative materials isolated test project',
  path: '',
  novelConfig: {
    genre: '悬疑', subGenre: '', targetAudience: '成年读者', totalChapters: 12,
    wordsPerChapter: 2400, plotStructure: 'three_act', narrativePOV: 'third_limited',
    coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '', createdAt: '', updatedAt: '',
}

async function render(view: CreativeTestView = 'materials'): Promise<void> {
  await act(async () => root.render(
    <CreativeMaterialsEditor
      tabId={tabId}
      projectKey={session.projectPath}
      initialView={view}
      initialContent=""
    />,
  ))
  await expect.element(page.getByRole('heading', { name: VIEW_TITLES[view], exact: true })).toBeVisible()
  await vi.waitFor(() => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(), { timeout: 20_000 })
}

async function seedEntry(input: CreativeMaterialSaveInput): Promise<CreativeMaterialEntry> {
  const response = await commands.creativeIpc(
    'db:creative-material-save', input, session.projectPath, session,
  ) as { success: boolean; entry?: CreativeMaterialEntry; error?: string }
  expect(response.success, response.error).toBe(true)
  return response.entry!
}

beforeEach(async () => {
  await page.viewport(1100, 900)
  session = await commands.creativeIpc('fixture:reset') as ProjectSessionContext
  setActiveProjectSessionContext(session)
  useProjectStore.setState({ currentProject: { ...project, id: session.projectId, path: session.projectPath, sessionLease: session.leaseId }, projectSessionEpoch: 1 })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useEditorStore.setState({
    ...originalEditor,
    tabs: [{ id: tabId, type: 'creative-materials', name: '素材与候选', projectKey: session.projectPath, creativeMaterialsView: 'materials', dirty: false, content: '', savedContent: '' }],
    activeTabId: tabId,
    draftLedgers: {},
  })
  ;(window as unknown as { velaAPI: unknown }).velaAPI = {
    invoke: (channel: string, ...args: unknown[]) => commands.creativeIpc(channel, ...args),
    on: () => () => {}, once: () => {}, send: () => {},
  }
  container = document.createElement('div')
  container.style.height = '800px'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await commands.creativeIpc('fixture:dispose')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  setActiveProjectSessionContext(null)
  useEditorStore.setState(originalEditor)
  useProjectStore.setState(originalProject)
  useLocaleStore.setState(originalLocale)
  document.getElementById('vditorIconScript')?.remove()
})

it('saves long Markdown through the project IPC boundary to SQLite and reads it back after reopening', async () => {
  const markdown = '# 潮汐井候选\n\n> 来源：04_事件与遗境库.md / 潮汐井\n\n| 线索 | 代价 |\n| --- | --- |\n| 中文场景文本 | 记忆损耗 |\n\n' + '港口的潮钟在午夜倒转。'.repeat(180)
  await render()
  await page.getByRole('button', { name: '新建', exact: false }).click()
  await page.getByRole('textbox', { name: '资料标题' }).fill('潮汐井')
  await page.getByRole('textbox', { name: '来源文件名' }).fill('04_事件与遗境库.md')
  await page.getByRole('textbox', { name: '原文标题' }).fill('潮汐井')
  await act(async () => {
    const prose = container.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')
    expect(prose).not.toBeNull()
    prose!.focus()
    const range = document.createRange()
    range.selectNodeContents(prose!.lastElementChild ?? prose!)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    document.execCommand('insertText', false, markdown)
  })
  let editorMarkdown = ''
  await vi.waitFor(() => {
    const content = useEditorStore.getState().tabs.find(tab => tab.id === tabId)?.content ?? ''
    const savedDraft = JSON.parse(content) as { draft?: { markdown?: string } }
    editorMarkdown = savedDraft.draft?.markdown ?? ''
    expect(editorMarkdown).toContain('# 潮汐井候选')
    expect(editorMarkdown).toContain('来源：04_事件与遗境库.md / 潮汐井')
    expect(editorMarkdown).toContain('| 中文场景文本 | 记忆损耗 |')
    expect(editorMarkdown.match(/港口的潮钟在午夜倒转。/g)).toHaveLength(180)
  }, { timeout: 10_000 })
  await expect.element(page.getByText('未保存', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.element(page.getByText('已保存', { exact: true })).toBeVisible()

  const stored = await commands.creativeIpc('db:creative-material-list', { entryKind: 'material' }, session.projectPath, session) as CreativeMaterialEntry[]
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({
    title: '潮汐井',
    sourceFileName: '04_事件与遗境库.md',
    sourceHeading: '潮汐井',
    markdown: editorMarkdown,
    revision: 1,
  })

  await act(async () => root.unmount())
  root = createRoot(container)
  await render()
  await expect.element(page.getByRole('textbox', { name: '资料标题' })).toHaveValue('潮汐井')
  await vi.waitFor(() => expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('潮汐井候选'))
  expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('港口的潮钟在午夜倒转。')
  const reopened = await commands.creativeIpc('db:creative-material-list', { entryKind: 'material' }, session.projectPath, session) as CreativeMaterialEntry[]
  expect(reopened[0]?.markdown).toBe(editorMarkdown)
})

it('keeps the material draft dirty and visible when storage rejects a save', async () => {
  await render()
  await page.getByRole('button', { name: '新建', exact: false }).click()
  await page.getByRole('textbox', { name: '资料标题' }).fill('失败后仍保留的资料')
  await expect.element(page.getByText('未保存', { exact: true })).toBeVisible()
  await commands.creativeIpc('fixture:reject-next-material-save')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.element(page.getByText('磁盘已满', { exact: true })).toBeVisible()
  await expect.element(page.getByText('未保存', { exact: true })).toBeVisible()

  const tab = useEditorStore.getState().tabs.find(item => item.id === tabId)
  expect(tab).toMatchObject({ dirty: true })
  expect(tab?.content).toContain('失败后仍保留的资料')
  const stored = await commands.creativeIpc('db:creative-material-list', { entryKind: 'material' }, session.projectPath, session) as CreativeMaterialEntry[]
  expect(stored).toHaveLength(0)
})

it.each([
  ['materials', 'material', 'candidate'],
  ['retired', 'retired', 'retired'],
  ['issues', 'issue', 'open'],
  ['legacy', null, null],
] as const)('keeps the %s page full-width, identity-bound, and independently scrollable', async (view, kind, status) => {
  document.documentElement.setAttribute('data-theme', view === 'legacy' ? 'ember' : 'storyforge')
  document.documentElement.classList.toggle('dark', view === 'legacy')
  const firstId = view + '-first-entry'
  const secondId = view + '-second-entry'

  if (kind && status) {
    await seedEntry({
      id: firstId, title: view + ' 第一条', entryKind: kind, status,
      materialType: 'event', markdown: '## ' + view + ' 第一条标题\n\n第一条正文。',
      expectedRevision: null,
    })
    await seedEntry({
      id: secondId, title: view + ' 第二条', entryKind: kind, status,
      materialType: 'event', markdown: '## ' + view + ' 第二条标题\n\n第二条正文。',
      expectedRevision: null,
    })
  } else {
    const seeded = await commands.creativeIpc(
      'db:project-core-update',
      { coreOutline: '# 旧核心构想\n\n旧核心正文。', worldSetting: '## 旧世界资料\n\n旧世界正文。' },
      session.projectPath,
      session,
    ) as { success: boolean; error?: string }
    expect(seeded.success, seeded.error).toBe(true)
  }

  await render(view)
  let surface = container.querySelector<HTMLElement>('.document-editing-surface')!
  expect(surface.dataset.outlineControl).toBe('floating')
  expect(surface.dataset.editorAppearance).toBe('full-bleed')
  expect(getComputedStyle(surface.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')!).maxWidth).toBe('none')

  if (kind) {
    const currentIdentity = surface.dataset.documentIdentity ?? ''
    const currentId = currentIdentity.includes(firstId) ? firstId : secondId
    const targetId = currentId === firstId ? secondId : firstId
    const targetTitle = targetId === firstId ? view + ' 第一条' : view + ' 第二条'
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.creative-materials-editor__list button'))
      .filter(row => row.textContent?.includes(view + ' 第一条') || row.textContent?.includes(view + ' 第二条'))
    expect(rows).toHaveLength(2)
    const targetRow = rows.find(row => row.textContent?.includes(targetTitle))
    expect(targetRow).toBeDefined()
    await act(async () => targetRow?.click())
    await vi.waitFor(() => expect(container.querySelector<HTMLElement>('.document-editing-surface')?.dataset.documentIdentity).toContain(targetId))
    surface = container.querySelector<HTMLElement>('.document-editing-surface')!
    expect(surface.querySelector('nav[aria-label="文档目录"]')?.textContent).toContain(targetTitle + '标题')
    expect(surface.querySelector('nav[aria-label="文档目录"]')?.textContent).not.toContain((targetId === firstId ? view + ' 第二条' : view + ' 第一条') + '标题')
  } else {
    expect(surface.dataset.documentIdentity).toContain('coreOutline')
    const sourceSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择旧配置来源"]')!
    await act(async () => {
      sourceSelect.value = 'worldSetting'
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector<HTMLElement>('.document-editing-surface')?.dataset.documentIdentity).toContain('worldSetting')
      expect(container.querySelector('.document-editing-surface [data-vditor-ready="true"]')).not.toBeNull()
    }, { timeout: 20_000 })
    surface = container.querySelector<HTMLElement>('.document-editing-surface')!
    expect(surface.querySelector('nav[aria-label="文档目录"]')?.textContent).toContain('旧世界资料')
    expect(surface.dataset.editable).toBe('false')
    expect(container.querySelector('.vditor-ir pre.vditor-reset')?.getAttribute('contenteditable')).toBe('false')
    expect(container.textContent).toContain('确认已归位')
    expect(container.textContent).toContain('标记不再使用')
    expect(container.textContent).toContain('重新读取')

    const prose = container.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')!
    const before = prose.textContent
    prose.focus()
    await userEvent.keyboard('x')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', '拖入的替换内容')
    prose.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dataTransfer }))
    prose.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    expect(prose.textContent).toBe(before)
  }

  surface = container.querySelector<HTMLElement>('.document-editing-surface')!
  const editor = surface.querySelector<HTMLElement>('.document-editing-surface__editor')!
  const editorHost = surface.querySelector<HTMLElement>('.vditor-prose-host')!
  await vi.waitFor(() => expect(surface.querySelector('.vditor-prose-host[data-vditor-ready="true"]')).not.toBeNull(), { timeout: 20_000 })
  const editorToolbar = surface.querySelector<HTMLElement>('.vditor-toolbar')!
  const toggle = surface.querySelector<HTMLButtonElement>('.document-editing-surface__page-outline-control button')!
  expect(surface.dataset.outlineControl).toBe('floating')
  expect(surface.dataset.editorAppearance).toBe('full-bleed')
  await page.viewport(1280, 900)
  container.style.height = '900px'
  await vi.waitFor(() => expect(editor.getBoundingClientRect().width).toBeGreaterThan(600))
  await page.screenshot({ path: '../../../../screenshots/document-pages/' + view + '-wide-closed.png' })
  const wideWidth = editor.getBoundingClientRect().width
  await act(async () => toggle.click())
  const outline = surface.querySelector<HTMLElement>('aside.document-editing-surface__outline')!
  const close = outline.querySelector<HTMLButtonElement>('button[aria-label="关闭文档目录"]')!
  expect(outline.hidden).toBe(false)
  expect(getComputedStyle(outline).position).toBe('absolute')
  expect(outline.getBoundingClientRect().top).toBeGreaterThanOrEqual(editorToolbar.getBoundingClientRect().bottom)
  expect(editor.getBoundingClientRect().width).toBe(wideWidth)
  expect(surface.querySelector('.vditor-prose-host')).toBe(editorHost)
  await page.screenshot({ path: '../../../../screenshots/document-pages/' + view + '-wide-open.png' })
  await act(async () => close.click())
  expect(outline.hidden).toBe(true)
  expect(outline.getBoundingClientRect().width).toBe(0)
  expect(editor.getBoundingClientRect().width).toBe(wideWidth)
  await page.screenshot({ path: '../../../../screenshots/document-pages/' + view + '-wide-closed-confirmed.png' })

  await page.viewport(620, 900)
  await vi.waitFor(() => expect(editor.getBoundingClientRect().width).toBeLessThan(wideWidth))
  if (kind) {
    expect(getComputedStyle(container.querySelector<HTMLElement>('.creative-materials-editor__workspace')!).flexDirection).toBe('column')
  }
  await act(async () => toggle.click())
  expect(outline.hidden).toBe(false)
  expect(outline.getBoundingClientRect().top).toBeGreaterThanOrEqual(editorToolbar.getBoundingClientRect().bottom)
  expect(outline.getBoundingClientRect().right).toBeLessThanOrEqual(surface.getBoundingClientRect().right)
  expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(outline.getBoundingClientRect().right)
  await page.screenshot({ path: '../../../../screenshots/document-pages/' + view + '-narrow-open.png' })
  await act(async () => close.click())
  expect(outline.hidden).toBe(true)
  expect(outline.getBoundingClientRect().width).toBe(0)
})

async function mountArchDocument(field: 'premise' | 'worldbuilding', content: string): Promise<void> {
  const archTabId = 'isolated-arch-' + field
  useEditorStore.setState({
    ...originalEditor,
    tabs: [{
      id: archTabId, type: 'arch-file', name: field === 'premise' ? '故事前提' : '世界观总纲',
      projectKey: session.projectPath, filePath: 'vela://core/' + field,
      content, savedContent: content, dirty: false,
    }],
    activeTabId: archTabId,
    draftLedgers: {},
  })
  await act(async () => root.render(
    <ArchFileViewer
      tabId={archTabId}
      filePath={'vela://core/' + field}
      projectKey={session.projectPath}
      content={content}
      savedContent={content}
    />,
  ))
  await vi.waitFor(() => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(), { timeout: 20_000 })
}

it.each(['premise', 'worldbuilding'] as const)('saves and reloads the %s architecture field through the isolated SQLite project core', async (field) => {
  document.documentElement.setAttribute('data-theme', 'storyforge')
  const otherField = field === 'premise' ? 'worldbuilding' : 'premise'
  const markdown = [
    '# ' + field + ' 回读验证',
    '',
    '## 重复标题',
    '正文保留中文、Markdown 标记 **格式** 与完整换行。',
    '',
    '## 重复标题',
    '这是第二个同名标题，仍保留在原字段。',
  ].join('\n')
  await page.viewport(1280, 900)
  container.style.height = '900px'
  const initial = await commands.creativeIpc('db:project-core-get', session.projectPath, session) as Record<string, unknown>
  const originalOtherValue = String(initial[otherField] ?? '')
  await mountArchDocument(field, String(initial[field] ?? ''))

  const modeButton = container.querySelector<HTMLButtonElement>('.vditor-toolbar button[data-mode="sv"]')!
  await act(async () => modeButton.click())
  const source = container.querySelector<HTMLTextAreaElement>('textarea.vditor-sv')!
  await act(async () => {
    source.value = markdown
    source.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: markdown,
    }))
  })
  await vi.waitFor(() => {
    const tab = useEditorStore.getState().tabs.find(item => item.id === 'isolated-arch-' + field)
    expect(tab?.content).toContain('# ' + field + ' 回读验证')
    expect(tab?.dirty).toBe(true)
  })
  const editorMarkdown = String(useEditorStore.getState().tabs.find(item => item.id === 'isolated-arch-' + field)?.content ?? '')
  expect(editorMarkdown.replace(/\n+$/u, '')).toBe(markdown)

  const saveButton = container.querySelector<HTMLButtonElement>('[title="保存（Cmd+S）"]')!
  await act(async () => saveButton.click())
  await vi.waitFor(() => {
    const tab = useEditorStore.getState().tabs.find(item => item.id === 'isolated-arch-' + field)
    expect(tab?.dirty).toBe(false)
  })
  const stored = await commands.creativeIpc('db:project-core-get', session.projectPath, session) as Record<string, unknown>
  expect(stored[field]).toBe(editorMarkdown)
  expect(stored[otherField]).toBe(originalOtherValue)

  await act(async () => root.unmount())
  root = createRoot(container)
  await mountArchDocument(field, String(stored[field] ?? ''))
  const surface = container.querySelector<HTMLElement>('.document-editing-surface')!
  const editor = surface.querySelector<HTMLElement>('.document-editing-surface__editor')!
  const editorToolbar = surface.querySelector<HTMLElement>('.vditor-toolbar')!
  expect(surface.dataset.outlineControl).toBe('floating')
  expect(surface.dataset.editorAppearance).toBe('full-bleed')
  await vi.waitFor(() => expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('第二个同名标题'))
  const editorHost = container.querySelector('.vditor-prose-host')
  const toggle = surface.querySelector<HTMLButtonElement>('.document-editing-surface__page-outline-control button')!
  await page.screenshot({ path: '../../../../screenshots/document-pages/story-' + field + '-wide-closed.png' })
  await act(async () => toggle.click())
  expect(container.querySelector('.vditor-prose-host')).toBe(editorHost)
  const outline = surface.querySelector<HTMLElement>('aside.document-editing-surface__outline')!
  expect(outline.getBoundingClientRect().top).toBeGreaterThanOrEqual(editorToolbar.getBoundingClientRect().bottom)
  await page.screenshot({ path: '../../../../screenshots/document-pages/story-' + field + '-wide-open.png' })
  const close = outline.querySelector<HTMLButtonElement>('button[aria-label="关闭文档目录"]')!
  await act(async () => close.click())
  expect(outline.hidden).toBe(true)
  expect(outline.getBoundingClientRect().width).toBe(0)

  const wideEditorWidth = editor.getBoundingClientRect().width
  await page.viewport(620, 900)
  await vi.waitFor(() => expect(editor.getBoundingClientRect().width).toBeLessThan(wideEditorWidth))
  await act(async () => toggle.click())
  expect(outline.hidden).toBe(false)
  expect(outline.getBoundingClientRect().top).toBeGreaterThanOrEqual(editorToolbar.getBoundingClientRect().bottom)
  expect(outline.getBoundingClientRect().right).toBeLessThanOrEqual(surface.getBoundingClientRect().right)
  expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(outline.getBoundingClientRect().right)
  await page.screenshot({ path: '../../../../screenshots/document-pages/story-' + field + '-narrow-open.png' })
  await act(async () => close.click())
  expect(outline.hidden).toBe(true)
  expect(outline.getBoundingClientRect().width).toBe(0)
})
