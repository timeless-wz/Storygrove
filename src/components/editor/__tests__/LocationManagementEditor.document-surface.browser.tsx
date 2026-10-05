import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import '../../../index.css'
import '../../../styles/literary-themes.css'
import type { ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import type { WorldMapAtlas } from '../../../shared/world-map'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import LocationManagementEditor from '../LocationManagementEditor'

declare module 'vitest/browser' {
  interface BrowserCommands { locationIpc: (channel: string, ...args: unknown[]) => Promise<unknown> }
}

const originalEditor = useEditorStore.getState()
const originalProject = useProjectStore.getState()
const originalLocale = useLocaleStore.getState()
let root: Root
let container: HTMLDivElement
let session: ProjectSessionContext
let originalVelaAPI: unknown

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tabId = 'location-editor-location'
const project: ProjectData = {
  id: 'location-browser', sessionLease: '', name: 'Location editor isolated test project', path: '',
  novelConfig: {
    genre: '悬疑', subGenre: '', targetAudience: '成年读者', totalChapters: 12,
    wordsPerChapter: 2400, plotStructure: 'three_act', narrativePOV: 'third_limited',
    coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '', createdAt: '', updatedAt: '',
}

async function render(initialContent = ''): Promise<void> {
  await act(async () => root.render(
    <LocationManagementEditor projectKey={session.projectPath} tabId={tabId} initialContent={initialContent} />,
  ))
  await expect.element(page.getByRole('heading', { name: '地点与区域', exact: true })).toBeVisible()
  await vi.waitFor(() => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(), { timeout: 20_000 })
}

function currentMarkdown(): string {
  const content = useEditorStore.getState().tabs.find(tab => tab.id === tabId)?.content ?? ''
  return (JSON.parse(content) as { draft?: { markdown?: string } }).draft?.markdown ?? ''
}

async function appendMarkdown(markdown: string): Promise<void> {
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
}

beforeEach(async () => {
  await page.viewport(1200, 920)
  session = await commands.locationIpc('fixture:reset') as ProjectSessionContext
  setActiveProjectSessionContext(session)
  useProjectStore.setState({ currentProject: { ...project, id: session.projectId, path: session.projectPath, sessionLease: session.leaseId }, projectSessionEpoch: 1 })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useEditorStore.setState({
    ...originalEditor,
    tabs: [{ id: tabId, type: 'locations', name: '地点与区域', projectKey: session.projectPath, dirty: false, content: '', savedContent: '' }],
    activeTabId: tabId,
  })
  originalVelaAPI = (window as unknown as { velaAPI?: unknown }).velaAPI
  ;(window as unknown as { velaAPI: unknown }).velaAPI = {
    invoke: (channel: string, ...args: unknown[]) => commands.locationIpc(channel, ...args),
    on: () => () => {}, once: () => {}, send: () => {},
  }
  container = document.createElement('div')
  container.style.height = '880px'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await commands.locationIpc('fixture:dispose')
  setActiveProjectSessionContext(null)
  useEditorStore.setState(originalEditor)
  useProjectStore.setState(originalProject)
  useLocaleStore.setState(originalLocale)
  if (originalVelaAPI === undefined) delete (window as unknown as { velaAPI?: unknown }).velaAPI
  else (window as unknown as { velaAPI: unknown }).velaAPI = originalVelaAPI
  document.getElementById('vditorIconScript')?.remove()
})

it('edits a location in the live page, saves through project IPC to isolated SQLite, switches identity, and reads back after reopening', async () => {
  await render()
  const initialIdentity = container.querySelector<HTMLElement>('[data-document-identity]')?.dataset.documentIdentity
  expect(initialIdentity).toContain('entity/location/location-tide-harbor/field/markdown')

  const appended = '\n\n## 潮汐回廊\n\n潮声沿着石阶回旋。'
  await appendMarkdown(appended)
  await vi.waitFor(() => expect(currentMarkdown()).toContain('## 潮汐回廊'), { timeout: 10_000 })
  expect(currentMarkdown()).toContain('潮声沿着石阶回旋。')
  await expect.element(page.getByText('未保存', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.element(page.getByText('已保存', { exact: true })).toBeVisible()
  const persisted = await commands.locationIpc('fixture:readback', session.projectPath, session) as WorldMapAtlas
  expect(persisted.nodes.find(node => node.id === 'location-tide-harbor')?.description).toContain('## 潮汐回廊')
  expect(persisted.nodes.find(node => node.id === 'location-tide-harbor')?.description).toContain('潮声沿着石阶回旋。')
  await page.screenshot({ path: '../../../../output/playwright/location-management-editor.png' })

  await page.getByRole('button', { name: /盐市/ }).click()
  await vi.waitFor(() => expect(container.querySelector<HTMLElement>('[data-document-identity]')?.dataset.documentIdentity).not.toBe(initialIdentity))
  await vi.waitFor(() => expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('盐市旧内容。'))
  expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).not.toContain('潮声沿着石阶回旋。')

  await page.getByRole('button', { name: /潮汐港/ }).click()
  await vi.waitFor(() => expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('潮声沿着石阶回旋。'))
  await act(async () => root.unmount())
  root = createRoot(container)
  const savedTabContent = useEditorStore.getState().tabs.find(tab => tab.id === tabId)?.content ?? ''
  await render(savedTabContent)
  await vi.waitFor(() => expect(container.querySelector('.vditor-ir pre.vditor-reset')?.textContent).toContain('潮声沿着石阶回旋。'))
  const reopened = await commands.locationIpc('fixture:readback', session.projectPath, session) as WorldMapAtlas
  expect(reopened.nodes.find(node => node.id === 'location-tide-harbor')?.description).toBe(persisted.nodes.find(node => node.id === 'location-tide-harbor')?.description)
})
