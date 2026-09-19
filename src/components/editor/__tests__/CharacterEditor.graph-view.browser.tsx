import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useCharacterStore, type CharacterCard } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import CharacterEditor from '../CharacterEditor'
import { openArchFile } from '../../panels/sidebar/sidebar-file-openers'

const PROJECT_PATH = 'C:\\novels\\character-graph'
const PROJECT_SESSION = {
  projectId: 'character-graph',
  leaseId: 'character-graph-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Character graph',
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

const protagonist: CharacterCard = {
  name: '沈砚',
  role: 'protagonist',
  age: '',
  gender: '',
  appearance: '',
  personality: '',
  background: '',
  abilities: '',
  motivation: '',
  relationships: '林晚：并肩作战的同伴',
  arc: '',
  notes: '',
}

const companion: CharacterCard = {
  name: '林晚',
  role: 'supporting',
  age: '',
  gender: '',
  appearance: '',
  personality: '',
  background: '',
  abilities: '',
  motivation: '',
  relationships: '',
  arc: '',
  notes: '',
}

const originalCharacterState = useCharacterStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()

let container: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1 })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useCharacterStore.setState({
    characters: [protagonist, companion],
    selectedName: protagonist.name,
    saving: false,
    identityBusy: false,
    loaded: true,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    rosterRevision: 1,
    loadingProjectKey: null,
    loadingProjectSession: null,
    lastError: null,
    // 画布节点与坐标都按稳定人物 ID 渲染。
    characterIdentities: { 沈砚: 'id-shen-yan', 林晚: 'id-lin-wan' },
    relationships: [],
    graphPositions: {},
  })
  useLayoutStore.setState({ sidebarView: 'project', characterViewRequest: null })
  setActiveProjectSessionContext(PROJECT_SESSION)

  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:character-roster-read') {
      return { status: 'ready', revision: 1, entries: [], renderedMarkdown: 'Character roster' }
    }
    if (channel === 'db:character-identities-ensure') {
      return { 沈砚: 'id-shen-yan', 林晚: 'id-lin-wan' }
    }
    if (channel === 'db:character-relationships-get-all') return []
    if (channel === 'db:character-graph-positions-get') return {}
    return { success: false, error: `unexpected channel ${channel}` }
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
  useCharacterStore.setState(originalCharacterState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  vi.restoreAllMocks()
})

describe('character profile as the only character entry', () => {
  it('redirects legacy character graph opens to the profile graph view without reading characters.md', async () => {
    for (const legacyPath of ['vela://core/characters', 'C:\\novels\\x\\characters.md']) {
      useLayoutStore.setState({ sidebarView: 'project', characterViewRequest: null })
      invoke.mockClear()

      await act(async () => {
        await openArchFile(legacyPath, '角色图谱')
      })

      const layout = useLayoutStore.getState()
      expect(layout.sidebarView, legacyPath).toBe('characters')
      expect(layout.characterViewRequest?.view, legacyPath).toBe('graph')
      // 兼容跳转不读取旧文件，也不创建 arch-file 标签页。
      expect(invoke, legacyPath).not.toHaveBeenCalled()
    }
  })

  it('shows the relationship graph inside the profile as a read-only projection', async () => {
    await act(async () => root.render(<CharacterEditor projectKey={PROJECT_PATH} />))
    // 先确认默认是人物概览，再通过显式请求切到关系图谱。
    expect(container.textContent).toContain('人物概览')
    expect(container.textContent).toContain('编辑档案')

    await act(async () => {
      useLayoutStore.setState({
        characterViewRequest: { view: 'graph', requestId: 1 },
      })
    })

    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('关系图谱'))
    })
    expect(container.textContent).toContain('只读投影')
    expect(container.textContent).toContain('角色档案 — 关系图谱')
    // 关系图谱是只读投影：仍有明确的返回档案入口，且不出现保存按钮。
    expect(container.textContent).toContain('返回档案')
  })

  it('opens the matching character card when a graph node is clicked', async () => {
    await act(async () => root.render(<CharacterEditor projectKey={PROJECT_PATH} />))
    await act(async () => {
      useLayoutStore.setState({ characterViewRequest: { view: 'graph', requestId: 3 } })
    })
    await act(async () => {
      await vi.waitFor(() => {
        expect(container.querySelectorAll('[data-testid="relationship-graph-node"]').length).toBe(2)
      })
    })

    const companionNode = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="relationship-graph-node"]'),
    ).find(node => node.dataset.characterName === '林晚')
    expect(companionNode).toBeTruthy()

    await act(async () => {
      companionNode?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(useCharacterStore.getState().selectedName).toBe('林晚')
    // 图谱点击只是选中/打开人物卡：焦点回到该角色的档案视图。
    expect(container.querySelector('[data-testid="character-summary"]')?.textContent).toContain('林晚')
    expect(container.textContent).toContain('人物概览')
  })

  it('lets the author switch back to the profile from the graph', async () => {
    await act(async () => root.render(<CharacterEditor projectKey={PROJECT_PATH} />))
    await act(async () => {
      useLayoutStore.setState({ characterViewRequest: { view: 'graph', requestId: 1 } })
    })
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('返回档案'))
    })

    const backButton = Array.from(container.querySelectorAll('button'))
      .find(button => (button.textContent ?? '').includes('返回档案'))
    await act(async () => {
      backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('人物概览')
    expect(container.textContent).toContain('编辑档案')
  })
})
