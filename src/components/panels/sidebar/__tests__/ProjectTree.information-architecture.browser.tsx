import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useDraftStore } from '../../../../stores/draft-store'
import { useEditorStore } from '../../../../stores/editor-store'
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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function rowLabels(): string[] {
  return Array.from(container.querySelectorAll('.writer-tree-item, .tree-item'))
    .map(element => element.textContent ?? '')
}

beforeEach(() => {
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
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'fs:list-dir' || channel === 'db:draft-list-all' || channel === 'db:map-get-all') return []
        if (channel === 'db:blueprint-get-all') return []
        if (channel === 'db:project-core-get') {
          return { premise: 'P'.repeat(60), charactersArch: '', worldbuilding: '', synopsis: '' }
        }
        if (channel === 'db:character-roster-read') {
          return { status: 'ready', revision: 1, entries: [], renderedMarkdown: 'Character roster' }
        }
        if (channel === 'chapter:list-incomplete-deletions') return { success: true, operations: [] }
        return []
      }),
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
    // 「角色图谱」不再作为故事架构下的独立菜单项。
    expect(text).not.toContain('Character graph')
    expect(rowLabels().some(label => label.includes('Character graph'))).toBe(false)
  })

  it('keeps exactly the three editable architecture documents under story setup', async () => {
    await act(async () => root.render(<ProjectTree />))
    // 架构状态来自异步读取：等它落地后再断言进度。
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('Story architecture1/3'))
    })

    const text = container.textContent ?? ''
    expect(text).toContain('Premise')
    expect(text).toContain('World building')
    expect(text).toContain('Plot outline')
    // 架构进度按三项统计，不再是 3/4 之类的四项。
    expect(text).not.toContain('/4')
  })

  it('renames the writing-plan and library entries without dropping them', async () => {
    await act(async () => root.render(<ProjectTree />))
    await act(async () => { await Promise.resolve() })

    const text = container.textContent ?? ''
    expect(text).toContain('Chapter thread')
    expect(text).not.toContain('Plot tree')
    expect(text).toContain('Creative parameters')
    expect(text).not.toContain('Novel configuration')
    expect(text).toContain('Project documents')
    expect(text).toContain('Sources & review')
    expect(text).toContain('Knowledge retrieval')
    // 既有能力没有被这次收口删掉。
    expect(text).toContain('Map atlas')
    expect(text).toContain('Chapter blueprints')
    expect(text).toContain('Story timeline')
  })

  it('opens the character profile graph view instead of a separate graph editor', async () => {
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
})
