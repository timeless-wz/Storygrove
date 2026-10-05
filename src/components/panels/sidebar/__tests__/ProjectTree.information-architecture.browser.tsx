import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useDraftStore } from '../../../../stores/draft-store'
import { createProjectScopedEditorTabId, useEditorStore } from '../../../../stores/editor-store'
import { useLayoutStore } from '../../../../stores/layout-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectStore } from '../../../../stores/project-store'
import { useWorkflowStore } from '../../../../stores/workflow-store'
import ProjectTree from '../ProjectTree'

const PROJECT_PATH = 'C:\\novels\\information-architecture'
const PROJECT_SESSION = {
  projectId: 'information-architecture',
  leaseId: 'information-architecture-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Information architecture',
  path: PROJECT_PATH,
  novelConfig: {
    genre: '', subGenre: '', targetAudience: '', totalChapters: 4, wordsPerChapter: 2500,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: 'Configured',
    worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const originalDraftState = useDraftStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalLayoutState = useLayoutStore.getState()

let container: HTMLDivElement
let root: Root
let coreContent: { premise: string; charactersArch: string; worldbuilding: string; synopsis: string }
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function rowLabels(): string[] {
  return Array.from(container.querySelectorAll('.writer-tree-item, .tree-item'))
    .map(element => element.textContent ?? '')
}

beforeEach(() => {
  coreContent = { premise: 'P'.repeat(60), charactersArch: '', worldbuilding: '', synopsis: '' }
  useLocaleStore.setState({ locale: 'en-US', initialized: true })
  useProjectStore.setState({
    currentProject: project,
    projectSessionEpoch: 1,
    fileTree: [],
    loading: false,
  })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useDraftStore.setState({
    draftsByChapter: {},
    loading: false,
    dataProjectKey: null,
    dataProjectSession: null,
    loadingProjectKey: null,
    loadingProjectSession: null,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useLayoutStore.setState({
    sidebarView: 'project',
    activeRailItem: 'project',
    characterViewRequest: null,
    projectTreeGroupOpen: { ...useLayoutStore.getInitialState().projectTreeGroupOpen },
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'fs:list-dir' || channel === 'db:draft-list-all' || channel === 'db:map-get-all') return []
    if (channel === 'db:blueprint-get-all') return []
    if (channel === 'db:project-core-get') return coreContent
    if (channel === 'db:project-core-update') {
      coreContent = { ...coreContent, ...(args[0] as Partial<typeof coreContent>) }
      return { success: true }
    }
    if (channel === 'db:character-roster-read') {
      return { status: 'ready', revision: 1, entries: [], renderedMarkdown: 'Character roster' }
    }
    if (channel === 'chapter:list-incomplete-deletions') return { success: true, operations: [] }
    return []
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
    },
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
  useDraftStore.setState(originalDraftState)
  useEditorStore.setState(originalEditorState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  useLayoutStore.setState(originalLayoutState)
  vi.restoreAllMocks()
})

describe('ProjectTree information architecture', () => {
  it('keeps character profiles as the only character entry and drops the standalone character graph', async () => {
    await act(async () => root.render(<ProjectTree />))
    await act(async () => { await Promise.resolve() })

    const text = container.textContent ?? ''
    // 角色档案仍然存在，且是唯一入口。
    expect(text).toContain('Character profile')
    expect(text.match(/Basic settings overview/g)).toHaveLength(1)
    expect(text).not.toContain('Generate story setup')
    // 「角色图谱」不再作为故事架构下的独立菜单项。
    expect(text).not.toContain('Character graph')
    expect(rowLabels().some(label => label.includes('Character graph'))).toBe(false)
  })

  it('keeps premise/worldbuilding in setup and routes the shared book outline through Chapter Blueprints', async () => {
    await act(async () => root.render(<ProjectTree />))
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-arch-file-key="premise"]')?.textContent).toContain('Has content'))
    })

    const setting = container.querySelector('[data-group-level="1"][data-group-id="setting"]')!
    const plan = container.querySelector('[data-group-level="1"][data-group-id="plan"]')!
    const worldSetup = setting.querySelector('[data-group-level="2"][data-group-id="worldSetup"]')!
    expect(setting.querySelectorAll('[data-arch-file-key="premise"]')).toHaveLength(1)
    expect(plan.querySelectorAll('[data-arch-file-key="synopsis"]')).toHaveLength(0)
    expect(plan.textContent).toContain('Chapter blueprints')
    expect(plan.textContent).not.toContain('Book outline')
    expect(plan.textContent).not.toContain('Map atlas')
    expect(plan.textContent).not.toContain('World records')
    expect(container.textContent).not.toContain('Story architecture')

    await act(async () => worldSetup.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    expect(worldSetup.querySelector('[data-arch-file-key="worldbuilding"]')?.textContent).toContain('Needs content')
    expect(worldSetup.querySelectorAll('[data-arch-file-key="worldbuilding"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-arch-file-key="premise"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-arch-file-key="worldbuilding"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-arch-file-key="synopsis"]')).toHaveLength(0)
  })

  it('renames the writing-plan and library entries without dropping them', async () => {
    await act(async () => root.render(<ProjectTree />))
    await act(async () => { await Promise.resolve() })

    const worldSetup = container.querySelector('[data-group-level="2"][data-group-id="worldSetup"]')!
    await act(async () => worldSetup.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    const library = container.querySelector('[data-group-level="1"][data-group-id="library"]')!
    await act(async () => library.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    const text = container.textContent ?? ''

    expect(text).toContain('Chapter thread')
    expect(text).not.toContain('Plot tree')
    expect(text).toContain('Creative direction')
    expect(text).not.toContain('Creative parameters')
    expect(text).toContain('Basic settings overview')
    expect(text).not.toContain('Generate story setup')
    expect(text).toContain('World management')
    expect(text).toContain('Map atlas')
    expect(text).toContain('Power system')
    expect(text).toContain('Project documents')
    expect(text).toContain('Sources & review')
    expect(text).toContain('Knowledge retrieval')
    expect(text).toContain('Chapter blueprints')
    expect(text).toContain('Story timeline')

    const creativeDirection = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(row => row.textContent?.includes('Creative direction'))
    expect(creativeDirection?.textContent).toContain('Idea present')
    expect(creativeDirection?.textContent).not.toContain('Complete')
  })

  it('opens the renamed overview in the existing stable editor tab and keeps its unsaved state', async () => {
    const stableTabId = createProjectScopedEditorTabId('world-building-editor', 'world-building', PROJECT_PATH)
    useEditorStore.setState({
      tabs: [{
        id: stableTabId,
        name: 'Generate story setup',
        type: 'world-building',
        projectKey: PROJECT_PATH,
        dirty: true,
      } as never],
      activeTabId: stableTabId,
    })
    await act(async () => root.render(<ProjectTree />))
    const overviewRow = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(row => row.textContent?.includes('Basic settings overview'))
    expect(overviewRow).toBeDefined()

    await act(async () => overviewRow?.click())

    const overviewTabs = useEditorStore.getState().tabs.filter(tab => tab.type === 'world-building')
    expect(overviewTabs).toHaveLength(1)
    expect(overviewTabs[0]).toMatchObject({ id: stableTabId, name: 'Basic settings overview', dirty: true })
    expect(useEditorStore.getState().activeTabId).toBe(stableTabId)
  })

  it('uses an idea-specific empty status when coreOutline and protagonistProfile are empty', async () => {
    useProjectStore.setState({
      currentProject: {
        ...project,
        novelConfig: { ...project.novelConfig, coreOutline: '', protagonistProfile: '' },
      },
    })
    await act(async () => root.render(<ProjectTree />))
    await act(async () => { await Promise.resolve() })

    const creativeDirection = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .find(row => row.textContent?.includes('Creative direction'))
    expect(creativeDirection?.textContent).toContain('Add an idea')
    expect(creativeDirection?.textContent).not.toContain('Complete')
    expect(creativeDirection?.textContent).not.toContain('Pending')
  })

  it('opens the character profile in edit mode without creating a separate graph editor', async () => {
    await act(async () => root.render(<ProjectTree />))
    await act(async () => { await Promise.resolve() })

    const characterRow = Array.from(container.querySelectorAll<HTMLElement>('.tree-item, .writer-tree-item'))
      .find(element => (element.textContent ?? '').includes('Character profile'))
    expect(characterRow).toBeDefined()

    await act(async () => {
      characterRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(useLayoutStore.getState().sidebarView).toBe('characters')
    expect(useLayoutStore.getState().characterViewRequest?.view).toBe('edit')
  })

  it('keeps the document clear action confirmed and limited to the selected core field', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    coreContent = {
      premise: 'P'.repeat(60),
      charactersArch: 'legacy projection',
      worldbuilding: 'W'.repeat(60),
      synopsis: 'S'.repeat(60),
    }
    await act(async () => root.render(<ProjectTree />))
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[data-arch-file-key="premise"] button[aria-label="Clear Story premise"]')).not.toBeNull())
    })

    const clearButton = container.querySelector<HTMLButtonElement>('[data-arch-file-key="premise"] button[aria-label="Clear Story premise"]')!
    await act(async () => clearButton.click())
    await act(async () => {
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('only this setup document')

    const confirmButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find(button => button.textContent === 'Clear')!
    await act(async () => confirmButton.click())
    await act(async () => {
      await vi.waitFor(() => expect(coreContent.premise).toBe(''))
    })

    expect(coreContent).toEqual({
      premise: '',
      charactersArch: 'legacy projection',
      worldbuilding: 'W'.repeat(60),
      synopsis: 'S'.repeat(60),
    })
    expect(invoke).toHaveBeenCalledWith(
      'db:project-core-update',
      { premise: '' },
      PROJECT_PATH,
      PROJECT_SESSION,
    )
  })
})
