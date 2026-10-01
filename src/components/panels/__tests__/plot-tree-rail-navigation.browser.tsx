import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Panel, Group as PanelGroup } from 'react-resizable-panels'

import '../../../index.css'
import '../../../styles/literary-workbench.css'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { ProjectData } from '../../../shared/ipc-channels'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import LeftToolWindowBar from '../../layout/LeftToolWindowBar'
import { openBuiltinEditor } from '../sidebar/sidebar-file-openers'
import EditorArea from '../EditorArea'

const PROJECT_PATH = 'C:\\novels\\plot-tree-rail'
const PROJECT_B_PATH = 'C:\\novels\\plot-tree-rail-b'
let root: Root | undefined
let container: HTMLDivElement | undefined

const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLLMState = useLLMStore.getState()
const originalProjectState = useProjectStore.getState()
const originalStoryTimelineState = useStoryTimelineStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function button(label: string): HTMLButtonElement {
  const match = Array.from(container!.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.trim() === label)
  if (!match) throw new Error(`button not found: ${label}`)
  return match
}

function selectedTab(label: string): boolean {
  return container!
    .querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`)
    ?.textContent?.trim() === label
}

function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(async () => {
  await page.viewport(1280, 800)
  document.documentElement.setAttribute('data-theme', 'storyforge')
  const project: ProjectData = {
    id: 'plot-tree-rail-project',
    name: '剧情树导航测试',
    path: PROJECT_PATH,
    sessionLease: 'plot-tree-rail-lease',
    novelConfig: {
      genre: '',
      subGenre: '',
      targetAudience: '',
      totalChapters: 10,
      wordsPerChapter: 3000,
      plotStructure: 'three_act',
      narrativePOV: 'third_limited',
      coreOutline: '',
      worldSetting: '',
      goldenFinger: '',
      protagonistProfile: '',
      globalGuidance: '',
    },
    characterStates: '',
    createdAt: '',
    updatedAt: '',
  }
  useProjectStore.setState({ currentProject: project, fileTree: [], loading: false })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useLayoutStore.setState({ sidebarOpen: true, sidebarView: 'project', activeRailItem: 'project' })
  useLLMStore.setState({
    models: [],
    defaultModelId: null,
    loaded: true,
  })
  useStoryTimelineStore.setState({ events: [], dataProjectKey: null, loading: false })
  setActiveProjectSessionContext({
    projectId: project.id,
    leaseId: project.sessionLease!,
    projectPath: project.path,
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'db:plot-tree-read') {
          return {
            writingLanguage: 'zh-CN',
            synopsis: { content: '' },
            blueprints: [],
            finalizedChapters: [],
            narrativeThreads: [],
            sourceRevision: '0'.repeat(64),
            snapshot: null,
          }
        }
        if (channel === 'db:narrative-thread-list') return []
        if (channel === 'db:draft-list-all') return []
        if (channel === 'db:blueprint-get-all') return []
        if (channel === 'db:blueprint-volume-list') return []
        if (channel === 'db:map-get-all') return []
        if (channel === 'story-data:list-agent-proposals') return []
        if (channel === 'db:timeline-get-all') {
          return {
            settings: { title: '故事时间线', rulerLabel: '故事时间', rulerUnit: '刻度' },
            events: [],
          }
        }
        throw new Error(`unexpected IPC ${channel}`)
      }),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
    },
  })
  container = document.createElement('div')
  container.style.cssText = 'width:100vw;height:100vh;display:flex;background:var(--color-bg)'
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(
    <div className="app-skin-root" data-theme="storyforge" style={{ display: 'flex', width: '100%', height: '100%' }}>
      <LeftToolWindowBar />
      <PanelGroup orientation="horizontal" style={{ flex: 1, minWidth: 0 }}>
        <Panel id="editor" className="writer-project-editor-panel">
          <EditorArea onNewProject={vi.fn()} />
        </Panel>
      </PanelGroup>
    </div>,
  ))
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useEditorStore.setState(originalEditorState)
  useLayoutStore.setState(originalLayoutState)
  useLLMStore.setState(originalLLMState)
  useProjectStore.setState(originalProjectState)
  useStoryTimelineStore.setState(originalStoryTimelineState)
  document.documentElement.removeAttribute('data-theme')
})

describe('plot-tree left rail navigation', () => {
  it('rounds the shared editor surface on project overview and chapter blueprint', async () => {
    const editor = container!.querySelector<HTMLElement>('.writer-project-editor-panel')!
    expect(getComputedStyle(editor).borderTopLeftRadius).toBe('12px')
    expect(getComputedStyle(editor).borderBottomLeftRadius).toBe('12px')
    expect(getComputedStyle(editor).overflow).toBe('hidden')
    expect(selectedTab('项目总览')).toBe(true)
    await page.screenshot({ path: '../../../../output/playwright/project-editor-overview-rounded.png' })

    await act(async () => button('章节蓝图').click())
    await vi.waitFor(() => expect(selectedTab('章节蓝图')).toBe(true))
    expect(getComputedStyle(editor).borderTopRightRadius).toBe('12px')
    expect(getComputedStyle(editor).borderBottomRightRadius).toBe('12px')
    await page.screenshot({ path: '../../../../output/playwright/project-editor-blueprint-rounded.png' })

    document.documentElement.setAttribute('data-theme', 'starlight-dark')
    container!.firstElementChild?.setAttribute('data-theme', 'starlight-dark')
    expect(getComputedStyle(editor).borderTopLeftRadius).toBe('12px')
    expect(getComputedStyle(editor).borderBottomRightRadius).toBe('12px')
  })
  it('places story timeline in the project overview as a primary card', async () => {
    const timelineCard = container?.querySelector<HTMLElement>('[aria-label="打开故事时间线"]')
    expect(timelineCard?.textContent).toContain('故事时间线')

    await act(async () => timelineCard?.click())
    await vi.waitFor(() => expect(useEditorStore.getState().tabs)
      .toContainEqual(expect.objectContaining({ type: 'story-timeline', projectKey: PROJECT_PATH })))
  })

  it('opens a project-scoped chapter blueprint tab after switching projects', async () => {
    // 项目首次打开应先落在总览，而不是小说配置。
    expect(selectedTab('项目总览')).toBe(true)

    await act(async () => button('章节蓝图').click())
    await vi.waitFor(() => expect(useEditorStore.getState().tabs)
      .toContainEqual(expect.objectContaining({ type: 'chapter-card', projectKey: PROJECT_PATH })))

    const projectA = useProjectStore.getState().currentProject!
    const projectB = {
      ...projectA,
      id: 'plot-tree-rail-project-b',
      name: '剧情树导航测试 B',
      path: PROJECT_B_PATH,
      sessionLease: 'plot-tree-rail-lease-b',
    }
    await act(async () => {
      useProjectStore.setState({ currentProject: projectB })
      setActiveProjectSessionContext({
        projectId: projectB.id,
        leaseId: projectB.sessionLease,
        projectPath: projectB.path,
      })
    })

    await act(async () => button('章节蓝图').click())
    await vi.waitFor(() => {
      const state = useEditorStore.getState()
      expect(state.tabs.find(tab => tab.id === state.activeTabId))
        .toMatchObject({ type: 'chapter-card', projectKey: PROJECT_B_PATH })
    })

    expect(useEditorStore.getState().tabs.filter(tab => tab.type === 'chapter-card'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ projectKey: PROJECT_PATH }),
        expect.objectContaining({ projectKey: PROJECT_B_PATH }),
      ]))
    expect(container?.textContent).not.toContain('此标签属于另一个项目')
  })

  it('returns an existing narrative editor to plot tree without losing the plan form', async () => {
    await act(async () => button('章节脉络').click())
    await vi.waitFor(() => expect(selectedTab('章节脉络')).toBe(true))

    await act(async () => button('计划清单').click())
    expect(selectedTab('章节脉络')).toBe(true)
    const title = container!.querySelector<HTMLInputElement>('input')!
    await act(async () => setInputValue(title, '不应丢失的计划'))
    expect(title.value).toBe('不应丢失的计划')

    await act(async () => openBuiltinEditor(
      'narrative-thread-editor',
      '章节脉络',
      'narrative-thread',
      'plot-tree',
    ))
    await vi.waitFor(() => expect(selectedTab('章节脉络')).toBe(true))

    await act(async () => button('计划清单').click())
    expect(container!.querySelector<HTMLInputElement>('input')?.value)
      .toBe('不应丢失的计划')

    await act(async () => openBuiltinEditor(
      'narrative-thread-editor',
      '章节脉络',
      'narrative-thread',
    ))
    await vi.waitFor(() => expect(selectedTab('章节脉络')).toBe(true))
    expect(container!.querySelector<HTMLInputElement>('input')?.value)
      .toBe('不应丢失的计划')
  })
})
