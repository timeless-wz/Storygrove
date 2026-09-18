import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ProjectReferencePanel from '../ProjectReferencePanel'
import { useCharacterStore } from '../../../stores/character-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalCharacterState = useCharacterStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()

let root: Root
let container: HTMLDivElement

function findButton(label: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.includes(label))
}

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({
    currentProject: {
      id: 'reference-project',
      sessionLease: 'reference-lease',
      name: '星辰之下',
      path: 'C:\\novels\\reference-project',
      novelConfig: { totalChapters: 24 },
    } as never,
  })
  useCharacterStore.setState({
    dataProjectKey: 'C:\\novels\\reference-project',
    dataProjectSession: {
      projectId: 'reference-project',
      leaseId: 'reference-lease',
      projectPath: 'C:\\novels\\reference-project',
    },
    loadingProjectSession: null,
    lastError: null,
    characters: [{ name: '林默', role: 'protagonist', age: '17' }] as never,
    selectedName: null,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useWorkflowStore.setState({ activeRuns: [] })
  useLayoutStore.setState({
    sidebarOpen: true,
    sidebarView: 'project',
    activeRailItem: 'project',
    aiPanelOpen: false,
    rightView: 'agent',
    referencePanelOpen: true,
    focusMode: false,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ProjectReferencePanel />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useCharacterStore.setState(originalCharacterState, true)
  useEditorStore.setState(originalEditorState, true)
  useLayoutStore.setState(originalLayoutState, true)
  useLocaleStore.setState(originalLocaleState, true)
  useProjectStore.setState(originalProjectState, true)
  useWorkflowStore.setState(originalWorkflowState, true)
})

describe('ProjectReferencePanel writer desktop workbench', () => {
  it('renders real character data and routes reference links to existing domain tools', async () => {
    expect(container.textContent).toContain('上下文')
    expect(container.textContent).toContain('项目设定')
    expect(container.textContent).toContain('林默')
    expect(container.textContent).toContain('17')

    const configuration = findButton('小说配置')
    expect(configuration).toBeDefined()
    await act(async () => configuration?.click())
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ type: 'config', projectKey: 'C:\\novels\\reference-project' })

    const blueprint = findButton('卷纲与章节细纲')
    expect(blueprint).toBeDefined()
    await act(async () => blueprint?.click())
    const tabs = useEditorStore.getState().tabs
    expect(tabs[tabs.length - 1]).toMatchObject({ type: 'chapter-card', projectKey: 'C:\\novels\\reference-project' })

    const workspace = findButton('创作资料中枢')
    expect(workspace).toBeDefined()
    await act(async () => workspace?.click())
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')
  })

  it('opens the existing AI agent and lets the compact reference rail be collapsed', async () => {
    const aiAssistant = findButton('打开 AI 助手')
    expect(aiAssistant).toBeDefined()
    await act(async () => aiAssistant?.click())
    expect(useLayoutStore.getState()).toMatchObject({ aiPanelOpen: true, rightView: 'agent' })

    const collapse = container.querySelector('[aria-label="收起上下文"]') as HTMLButtonElement | null
    expect(collapse).not.toBeNull()
    await act(async () => collapse?.click())
    expect(useLayoutStore.getState().referencePanelOpen).toBe(false)
  })

  it('selects the clicked character and keeps the full character roster open', async () => {
    const character = container.querySelector('.writer-reference-character') as HTMLButtonElement | null
    expect(character).not.toBeNull()
    await act(async () => character?.click())
    expect(useCharacterStore.getState().selectedName).toBe('林默')
    expect(useLayoutStore.getState()).toMatchObject({ sidebarView: 'characters', sidebarOpen: true })

    // 点击“查看全部角色”时，即使已在角色页，也不能把左栏意外收起。
    useLayoutStore.setState({ sidebarOpen: false })
    const viewAll = findButton('查看全部角色')
    expect(viewAll).toBeDefined()
    await act(async () => viewAll?.click())
    expect(useLayoutStore.getState()).toMatchObject({ sidebarView: 'characters', sidebarOpen: true })
  })
})
