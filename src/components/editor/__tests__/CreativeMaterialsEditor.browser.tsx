import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import '../../../index.css'
import '../../../styles/literary-themes.css'
import type { ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import type { CreativeMaterialEntry } from '../../../shared/creative-content'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
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

async function render(): Promise<void> {
  await act(async () => root.render(
    <CreativeMaterialsEditor
      tabId={tabId}
      projectKey={session.projectPath}
      initialView="materials"
      initialContent=""
    />,
  ))
  await expect.element(page.getByRole('heading', { name: '素材与候选', exact: true })).toBeVisible()
  await vi.waitFor(() => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(), { timeout: 20_000 })
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
