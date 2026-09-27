import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { useLocaleStore } from '../../../stores/locale-store'
import {
  draftEditorPositionKey,
  readDraftEditorPosition,
  rememberDraftEditorPosition,
  resetDraftEditorPositions,
} from '../../../services/draft-editor-position'
import DraftEditor from '../DraftEditor'

vi.mock('../../ui/Confirm', () => ({
  confirm: vi.fn(async () => true),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\chapter-context'
const OTHER_PROJECT_PATH = 'C:\\novels\\chapter-context-other'
const PROJECT_SESSION = Object.freeze({
  projectId: 'chapter-context-project',
  leaseId: 'chapter-context-lease',
  projectPath: PROJECT_PATH,
})
const TAB_ID = 'tab-chapter-context'
const DRAFT_ID = 41
const OTHER_DRAFT_ID = 66
const FILE_PATH = `vela://draft/${DRAFT_ID}`
const OTHER_FILE_PATH = `vela://draft/${OTHER_DRAFT_ID}`
const INITIAL_CONTENT = '# 第四章 风暴降临\n\n海风呼啸着卷过港口。'
const READY_TIMEOUT = 20000
const CHAPTER_CARD_TAB_ID = `chapter-card-editor:${encodeURIComponent(PROJECT_PATH)}`

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
const originalLocaleState = useLocaleStore.getState()
const originalEditorState = useEditorStore.getState()
const originalProjectState = useProjectStore.getState()
const originalWorkflowState = useWorkflowStore.getState()
const originalLayoutState = useLayoutStore.getState()

/** 草稿行：绑定时带 blueprintChapterNumber，未绑定时该字段由 DB 层整个省略。 */
function draftMeta(blueprintChapterNumber?: number) {
  return {
    id: DRAFT_ID,
    chapterNumber: 4,
    ...(blueprintChapterNumber === undefined ? {} : { blueprintChapterNumber }),
    version: 1,
    status: 'draft',
    source: 'write',
    contentId: 100,
    wordCount: INITIAL_CONTENT.length,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  }
}

function blueprintRow(overrides: Record<string, unknown> = {}) {
  return {
    chapterNumber: 4,
    title: '风暴降临',
    role: '冲突',
    purpose: '让主角在码头拿到账本',
    keyEvents: '夜探码头\n拿到账本；被巡查撞见',
    characters: ['林晚', '赵九'],
    suspenseHook: '账本缺了最后一页',
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
    ...overrides,
  }
}

const SCENE_NODES = [
  {
    id: 'scene-2', canvasId: 'cha-4', type: 'scene', title: '被巡查撞见', summary: '冲突升级',
    colorKey: 'default', role: '冲突', order: 2, refs: {}, x: 200, y: 0,
  },
  {
    id: 'scene-1', canvasId: 'cha-4', type: 'scene', title: '夜探码头', summary: '',
    colorKey: 'default', role: '铺垫', order: 1, refs: {}, x: 0, y: 0,
  },
]

function installApi(handler: (channel: string, args: unknown[]) => unknown) {
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => handler(channel, args))
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      setZoomLevel: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
  })
}

/**
 * 默认 IPC 行为。
 *
 * `boundBlueprintChapter` 为 undefined 表示草稿未绑定蓝图；`blueprintValue`
 * 为 null 表示绑定指向的蓝图已被删除。
 */
function installIpc(options: {
  boundBlueprintChapter?: number
  draftId?: number
  chapterNumber?: number
  blueprintValue?: Record<string, unknown> | null
  scenes?: unknown[]
  delayBlueprintGet?: boolean
} = {}) {
  const {
    boundBlueprintChapter,
    draftId = DRAFT_ID,
    chapterNumber = 4,
    blueprintValue,
    scenes = SCENE_NODES,
    delayBlueprintGet = false,
  } = options

  installApi(channel => {
    if (channel === 'db:draft-get-meta') {
      return { ...draftMeta(boundBlueprintChapter), id: draftId, chapterNumber }
    }
    if (channel === 'db:blueprint-get-all') {
      return boundBlueprintChapter === undefined ? [] : [{ chapterNumber: boundBlueprintChapter, title: '风暴降临' }]
    }
    if (channel === 'db:blueprint-get') {
      if (blueprintValue === null) return null
      if (blueprintValue !== undefined) return blueprintValue
      return delayBlueprintGet ? new Promise(() => {}) : blueprintRow()
    }
    if (channel === 'db:chapter-canvas-get') return { canvas: null, nodes: scenes, edges: [] }
    if (channel === 'db:draft-list') return [{ id: draftId, version: 1 }]
    if (channel === 'db:review-list') return []
    if (channel === 'db:foreshadowing-list-by-draft') return []
    return { success: true }
  })
}

function openDraftTab(options: {
  filePath: string
  draftId: number
  chapterNumber: number
  blueprintChapterNumber?: number
  content?: string
}) {
  useEditorStore.setState({
    tabs: [{
      id: options.filePath,
      name: `Chapter ${options.chapterNumber}`,
      type: 'chapter',
      filePath: options.filePath,
      content: options.content ?? INITIAL_CONTENT,
      savedContent: options.content ?? INITIAL_CONTENT,
      dirty: false,
      draftId: options.draftId,
      draftStatus: 'draft',
      chapterNumber: options.chapterNumber,
      ...(options.blueprintChapterNumber === undefined
        ? {}
        : { blueprintChapterNumber: options.blueprintChapterNumber }),
      projectKey: PROJECT_PATH,
      projectSessionLease: PROJECT_SESSION.leaseId,
      contentRevision: 0,
    }],
    activeTabId: options.filePath,
  })
}

function renderEditor(props: Partial<{ tabId: string; filePath: string; content: string; projectKey: string }> = {}) {
  return act(async () => root.render(
    <DraftEditor
      tabId={props.tabId ?? TAB_ID}
      filePath={props.filePath ?? FILE_PATH}
      content={props.content ?? INITIAL_CONTENT}
      projectKey={props.projectKey ?? PROJECT_PATH}
    />,
  ))
}

async function waitForVditorReady(): Promise<HTMLElement> {
  await act(async () => {
    await vi.waitFor(
      () => expect(container.querySelector('[data-vditor-ready="true"]')).not.toBeNull(),
      { timeout: READY_TIMEOUT },
    )
  })
  const prose = container.querySelector('.vditor-ir pre.vditor-reset')
  expect(prose).not.toBeNull()
  return prose as HTMLElement
}

/** 等待侧栏进入指定状态。 */
async function waitForSidebar(testId: string): Promise<HTMLElement> {
  await act(async () => {
    await vi.waitFor(
      () => expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull(),
      { timeout: READY_TIMEOUT },
    )
  })
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement
}

function sidebarRoot(): HTMLElement | null {
  return container.querySelector(
    '[data-testid="chapter-context-sidebar"], [data-testid="chapter-context-drawer"]',
  )
}

async function clickTestId(testId: string) {
  const element = await vi.waitFor(() => {
    const found = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
    if (!found) throw new Error(`element not found: ${testId}`)
    return found
  })
  await act(async () => element.click())
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(async () => {
  await page.viewport(1440, 900)
  setViewportWidth(1440)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  resetDraftEditorPositions()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  installIpc({ boundBlueprintChapter: 4 })
  useProjectStore.setState({
    currentProject: {
      id: PROJECT_SESSION.projectId,
      name: 'Chapter context novel',
      path: PROJECT_PATH,
      sessionLease: PROJECT_SESSION.leaseId,
      novelConfig: {
        writingLanguage: 'zh-CN',
        genre: 'fantasy',
        subGenre: '',
        targetAudience: 'all',
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
    },
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4, blueprintChapterNumber: 4 })
  useLayoutStore.setState({ chapterContextOpen: true })
  useWorkflowStore.setState({ activeRuns: [], startWorkflow: vi.fn(async () => 'run') as never })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLocaleStore.setState(originalLocaleState)
  useEditorStore.setState(originalEditorState)
  useProjectStore.setState(originalProjectState)
  useWorkflowStore.setState(originalWorkflowState)
  useLayoutStore.setState(originalLayoutState)
  setActiveProjectSessionContext(null)
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('DraftEditor 本章创作上下文', () => {
  it('已绑定：展示真实的目标、节拍、场景顺序与章尾悬念，且全程只读', async () => {
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    expect(sidebarRoot()?.textContent).toContain('让主角在码头拿到账本')
    expect(sidebarRoot()?.textContent).toContain('账本缺了最后一页')

    // 节拍按换行与分号拆开，不做改写。
    const beats = container.querySelectorAll('[data-testid="chapter-context-beats"] li')
    expect(Array.from(beats).map(beat => beat.textContent)).toEqual([
      '夜探码头', '拿到账本', '被巡查撞见',
    ])

    // 场景顺序按 order 升序，而不是按画布返回顺序。
    const scenes = container.querySelectorAll('[data-testid="chapter-context-scenes"] li')
    expect(scenes.length).toBe(2)
    expect(scenes[0].textContent).toContain('夜探码头')
    expect(scenes[1].textContent).toContain('被巡查撞见')

    // 读取用的是草稿绑定的章号。
    expect(invoke.mock.calls).toContainEqual(['db:blueprint-get', 4, PROJECT_PATH, PROJECT_SESSION])
    expect(invoke.mock.calls).toContainEqual(['db:chapter-canvas-get', 4, PROJECT_PATH, PROJECT_SESSION])

    // 侧栏是只读的：期间没有写入草稿、蓝图或画布。
    const writeChannels = invoke.mock.calls
      .map(([channel]) => channel as string)
      .filter(channel => /set-blueprint|update-content|node-upsert|edge-upsert|viewport-save/.test(channel))
    expect(writeChannels).toEqual([])
  })

  it('蓝图字段缺失时显示空状态，不编造内容', async () => {
    installIpc({
      boundBlueprintChapter: 4,
      blueprintValue: blueprintRow({ purpose: '', keyEvents: '', suspenseHook: '', role: '', characters: [] }),
      scenes: [],
    })

    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-blueprint-head')

    const body = sidebarRoot()?.textContent ?? ''
    expect(body).toContain('蓝图未填写本章目标')
    expect(body).toContain('蓝图未填写关键事件')
    expect(body).toContain('本章还没有场景卡')
    expect(body).toContain('蓝图未填写章尾悬念')
  })

  it('已绑定但指向的蓝图已被删除：说明目标不存在并给出重新绑定入口，不用其他资料顶替', async () => {
    installIpc({ boundBlueprintChapter: 9, blueprintValue: null })
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4, blueprintChapterNumber: 9 })

    await renderEditor()
    await waitForVditorReady()
    const notice = await waitForSidebar('chapter-context-target-missing')

    expect(notice.textContent).toContain('绑定目标已不存在')
    expect(notice.textContent).toContain('第 9 章')
    // 没有读取画布，也没有拿第 4 章的蓝图顶替。
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:chapter-canvas-get')).toBe(false)
    expect(sidebarRoot()?.textContent).not.toContain('让主角在码头拿到账本')

    await clickTestId('chapter-context-rebind')
    await expect.element(page.getByRole('heading', { name: '绑定章节蓝图' })).toBeVisible()
  })

  it('未绑定蓝图：明确显示未绑定并给出绑定入口，不按章号猜一份蓝图', async () => {
    installIpc({})
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4 })

    await renderEditor()
    await waitForVditorReady()
    const notice = await waitForSidebar('chapter-context-unbound')

    expect(notice.textContent).toContain('未绑定蓝图')
    // 关键红线：未绑定时一次蓝图/画布读取都不能发生。
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-get')).toBe(false)
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:chapter-canvas-get')).toBe(false)
    // 也不提供到别的资料的跳转。
    expect(container.querySelector('[data-testid="chapter-context-open-blueprint"]')).toBeNull()
    expect(container.querySelector('[data-testid="chapter-context-open-canvas"]')).toBeNull()
    expect(container.querySelector('[data-testid="chapter-context-bind"]')).not.toBeNull()

    await clickTestId('chapter-context-bind')
    await expect.element(page.getByRole('heading', { name: '绑定章节蓝图' })).toBeVisible()
  })

  it('通过侧栏入口绑定成功后，侧栏立即反映新绑定，不必重新打开草稿', async () => {
    installIpc({})
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4 })

    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-unbound')

    // 从侧栏入口打开既有的绑定对话框（蓝图选项来自 db:blueprint-get-all）。
    installIpc({ boundBlueprintChapter: 4 })
    await clickTestId('chapter-context-bind')
    await expect.element(page.getByRole('heading', { name: '绑定章节蓝图' })).toBeVisible()

    // 选中第 4 章蓝图并保存：真实调用 db:draft-set-blueprint。
    await act(async () => {
      const select = document.body.querySelector<HTMLSelectElement>('select')
      expect(select).not.toBeNull()
      select!.value = '4'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      const save = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent?.includes('保存绑定'))
      expect(save).toBeDefined()
      save!.click()
    })

    expect(invoke.mock.calls).toContainEqual([
      'db:draft-set-blueprint', DRAFT_ID, 4, PROJECT_PATH, PROJECT_SESSION,
    ])

    // 关闭对话框后重新读取元数据，侧栏立刻显示绑定后的蓝图要点。
    await waitForSidebar('chapter-context-purpose')
    expect(sidebarRoot()?.textContent).toContain('让主角在码头拿到账本')
  })

  it('同一草稿改绑蓝图期间隐藏旧章要点，元数据重读后才显示新章', async () => {
    let boundChapter = 4
    let deferMeta = false
    let resolveMeta: ((value: unknown) => void) | null = null
    installApi((channel, args) => {
      if (channel === 'db:draft-get-meta') {
        return deferMeta
          ? new Promise(resolve => { resolveMeta = resolve })
          : draftMeta(boundChapter)
      }
      if (channel === 'db:blueprint-get-all') return [
        blueprintRow({ chapterNumber: 4, title: '旧章' }),
        blueprintRow({ chapterNumber: 12, title: '新章' }),
      ]
      if (channel === 'db:blueprint-get') return blueprintRow({
        chapterNumber: Number(args[0]),
        purpose: Number(args[0]) === 4 ? '旧章目标' : '新章目标',
      })
      if (channel === 'db:chapter-canvas-get') return { canvas: null, nodes: [], edges: [] }
      if (channel === 'db:draft-set-blueprint') {
        boundChapter = Number(args[1])
        deferMeta = true
        return { success: true }
      }
      if (channel === 'db:review-list' || channel === 'db:foreshadowing-list-by-draft') return []
      if (channel === 'db:draft-list') return [{ id: DRAFT_ID, version: 1 }]
      return { success: true }
    })
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4, blueprintChapterNumber: 4 })
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')
    expect(sidebarRoot()?.textContent).toContain('旧章目标')

    await act(async () => {
      const button = document.body.querySelector<HTMLButtonElement>('[title="绑定或更换章节蓝图"]')
      expect(button).not.toBeNull()
      button!.click()
    })
    await expect.element(page.getByRole('heading', { name: '绑定章节蓝图' })).toBeVisible()
    await act(async () => {
      const select = document.body.querySelector<HTMLSelectElement>('select')!
      select.value = '12'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      const save = Array.from(document.body.querySelectorAll('button'))
        .find(button => button.textContent?.includes('保存绑定'))
      save?.click()
    })
    await waitForSidebar('chapter-context-loading')
    expect(sidebarRoot()?.textContent).not.toContain('旧章目标')

    await act(async () => { resolveMeta?.(draftMeta(12)) })
    await waitForSidebar('chapter-context-purpose')
    expect(sidebarRoot()?.textContent).toContain('新章目标')
  })

  it('跳转到蓝图与场景画布：打开同一章节蓝图 Tab，并带上绑定章号与目标视图', async () => {
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    await clickTestId('chapter-context-open-blueprint')
    let tab = useEditorStore.getState().tabs.find(item => item.id === CHAPTER_CARD_TAB_ID)
    expect(tab).toBeDefined()
    expect(tab?.type).toBe('chapter-card')
    expect(tab?.chapterNumber).toBe(4)
    expect(tab?.chapterView).toBe('blueprint')
    expect(useEditorStore.getState().activeTabId).toBe(CHAPTER_CARD_TAB_ID)

    // 返回正文：草稿 Tab 仍在，内容与身份不变。
    await act(async () => useEditorStore.getState().setActiveTab(FILE_PATH))
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')
    expect(useEditorStore.getState().tabs.find(item => item.id === FILE_PATH)?.filePath).toBe(FILE_PATH)

    // 再跳场景画布：复用同一 Tab，视图切到 canvas 且请求计数递增。
    const requestBefore = useEditorStore.getState().tabs
      .find(item => item.id === CHAPTER_CARD_TAB_ID)?.chapterViewRequest ?? 0
    await clickTestId('chapter-context-open-canvas')
    tab = useEditorStore.getState().tabs.find(item => item.id === CHAPTER_CARD_TAB_ID)
    expect(tab?.chapterView).toBe('canvas')
    expect(tab?.chapterViewRequest).toBeGreaterThan(requestBefore)
  })

  it('跳转用的是草稿绑定的章号，而不是草稿自身章号', async () => {
    // 草稿在第 4 章，但绑定的是第 12 章的蓝图。
    installIpc({ boundBlueprintChapter: 12, chapterNumber: 4, blueprintValue: blueprintRow({ chapterNumber: 12 }) })
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4, blueprintChapterNumber: 12 })

    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    expect(invoke.mock.calls).toContainEqual(['db:blueprint-get', 12, PROJECT_PATH, PROJECT_SESSION])
    await clickTestId('chapter-context-open-blueprint')
    const tab = useEditorStore.getState().tabs.find(item => item.id === CHAPTER_CARD_TAB_ID)
    expect(tab?.chapterNumber).toBe(12)
  })

  it('切到未绑定蓝图的新章：不显示上一章的要点', async () => {
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    installIpc({ boundBlueprintChapter: undefined, draftId: OTHER_DRAFT_ID, chapterNumber: 6, scenes: [] })
    openDraftTab({ filePath: OTHER_FILE_PATH, draftId: OTHER_DRAFT_ID, chapterNumber: 6 })
    await renderEditor({ filePath: OTHER_FILE_PATH, tabId: OTHER_FILE_PATH })
    await waitForVditorReady()

    // 新章未绑定：既没有未绑定提示之外的蓝图内容，也没有上一章的点。
    expect(container.textContent).not.toContain('让主角在码头拿到账本')
    expect(container.textContent).not.toContain('夜探码头')
    await waitForSidebar('chapter-context-unbound')
  })

  it('读取竞态：切章后上一章迟到的蓝图结果不会进入新章侧栏', async () => {
    let resolveBlueprint: ((value: unknown) => void) | null = null
    installApi((channel, args) => {
      if (channel === 'db:draft-get-meta') return draftMeta(4)
      if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 4, title: '风暴降临' }]
      if (channel === 'db:blueprint-get') {
        if (Number(args[0]) === 4) return new Promise(resolve => { resolveBlueprint = resolve })
        return null
      }
      if (channel === 'db:chapter-canvas-get') return { canvas: null, nodes: SCENE_NODES, edges: [] }
      if (channel === 'db:draft-list') return [{ id: DRAFT_ID, version: 1 }]
      if (channel === 'db:review-list') return []
      if (channel === 'db:foreshadowing-list-by-draft') return []
      return { success: true }
    })

    await renderEditor()
    await waitForVditorReady()

    // 切到第 6 章（未绑定）并完成渲染。
    installIpc({ boundBlueprintChapter: undefined, draftId: OTHER_DRAFT_ID, chapterNumber: 6, scenes: [] })
    openDraftTab({ filePath: OTHER_FILE_PATH, draftId: OTHER_DRAFT_ID, chapterNumber: 6 })
    await renderEditor({ filePath: OTHER_FILE_PATH, tabId: OTHER_FILE_PATH })
    await waitForVditorReady()
    await waitForSidebar('chapter-context-unbound')

    // 第 4 章的读取现在才返回；身份键不匹配，必须被丢弃。
    await act(async () => {
      resolveBlueprint?.(blueprintRow())
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('让主角在码头拿到账本')
    await waitForSidebar('chapter-context-unbound')
  })

  it('跨项目：旧会话失效后不显示上一项目的要点', async () => {
    let resolveBlueprint: ((value: unknown) => void) | null = null
    installApi((channel, args) => {
      if (channel === 'db:draft-get-meta') return draftMeta(4)
      if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 4, title: '风暴降临' }]
      if (channel === 'db:blueprint-get') {
        if (Number(args[0]) === 4) return new Promise(resolve => { resolveBlueprint = resolve })
        return null
      }
      if (channel === 'db:chapter-canvas-get') return { canvas: null, nodes: SCENE_NODES, edges: [] }
      if (channel === 'db:draft-list') return [{ id: DRAFT_ID, version: 1 }]
      if (channel === 'db:review-list') return []
      if (channel === 'db:foreshadowing-list-by-draft') return []
      return { success: true }
    })

    await renderEditor()
    await waitForVditorReady()

    // 项目被切换：会话注册表换成另一个项目。
    await act(async () => {
      setActiveProjectSessionContext({
        projectId: 'other-project',
        leaseId: 'other-lease',
        projectPath: OTHER_PROJECT_PATH,
      })
      await Promise.resolve()
    })

    // 旧项目的蓝图结果此时才回来，必须被丢弃。
    await act(async () => {
      resolveBlueprint?.(blueprintRow())
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('让主角在码头拿到账本')
    expect(container.textContent).not.toContain('账本缺了最后一页')
  })

  it('窄屏以抽屉呈现并可用 Esc 收起，宽屏是内联列；正文始终保留', async () => {
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    expect(container.querySelector('[data-testid="chapter-context-sidebar"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="chapter-context-drawer"]')).toBeNull()

    // 收窄到窄屏：改为抽屉 + 遮罩。
    await act(async () => setViewportWidth(900))
    await waitForSidebar('chapter-context-drawer')
    expect(container.querySelector('[data-testid="chapter-context-sidebar"]')).toBeNull()
    expect(container.querySelector('[data-testid="chapter-context-backdrop"]')).not.toBeNull()
    expect(useLayoutStore.getState().chapterContextOpen).toBe(true)

    // Esc 收起抽屉，正文编辑器仍在。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(useLayoutStore.getState().chapterContextOpen).toBe(false)
    expect(container.querySelector('[data-testid="chapter-context-drawer"]')).toBeNull()
    expect(container.querySelector('[data-vditor-prose-editor="true"]')).not.toBeNull()

    // 工具栏开关重新打开。
    await clickTestId('draft-chapter-context-toggle')
    expect(useLayoutStore.getState().chapterContextOpen).toBe(true)
    await waitForSidebar('chapter-context-drawer')
  })

  it('工具栏可以收起侧栏，且不触发任何草稿写入或保存', async () => {
    await renderEditor()
    await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    const tabBefore = useEditorStore.getState().tabs[0]
    await clickTestId('draft-chapter-context-toggle')

    expect(useLayoutStore.getState().chapterContextOpen).toBe(false)
    expect(container.querySelector('[data-testid="chapter-context-sidebar"]')).toBeNull()
    expect(container.querySelector('[data-vditor-prose-editor="true"]')).not.toBeNull()

    const tabAfter = useEditorStore.getState().tabs[0]
    expect(tabAfter.content).toBe(tabBefore.content)
    expect(tabAfter.dirty).toBe(tabBefore.dirty)
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:draft-update-content')).toBe(false)
  })

  it('跳到蓝图再返回正文：还原到原来的段落，且不改动正文', async () => {
    await renderEditor()
    const prose = await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    // 把光标放到正文最后一个块里，模拟作者正在写的位置。
    const blocks = Array.from(prose.children) as HTMLElement[]
    expect(blocks.length).toBeGreaterThan(1)
    const lastBlock = blocks[blocks.length - 1]
    await act(async () => {
      const textNode = lastBlock.firstChild ?? lastBlock
      const range = document.createRange()
      range.setStart(textNode, 0)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      prose.focus()
      document.dispatchEvent(new Event('selectionchange'))
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    })

    // 跳到蓝图：离开前记录位置，然后切到章节蓝图 Tab。
    await clickTestId('chapter-context-open-blueprint')
    expect(useEditorStore.getState().activeTabId).toBe(CHAPTER_CARD_TAB_ID)

    // 从蓝图返回正文。
    await act(async () => useEditorStore.getState().setActiveTab(FILE_PATH))
    await renderEditor()
    const restoredProse = await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    // 光标被放回原来的段落，而不是文档开头。
    const selection = window.getSelection()
    expect(selection?.rangeCount ?? 0).toBeGreaterThan(0)
    const anchor = selection?.anchorNode ?? null
    expect(anchor).not.toBeNull()
    const restoredBlocks = Array.from(restoredProse.children) as HTMLElement[]
    expect(restoredBlocks.some(block => block.contains(anchor))).toBe(true)
    expect(restoredBlocks[0].contains(anchor)).toBe(false)

    // 还原不是编辑：正文与草稿状态都没变。
    expect(useEditorStore.getState().tabs[0].content).toBe(INITIAL_CONTENT)
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:draft-update-content')).toBe(false)
  })

  it('只记下滚动距离、没有光标落点时：不要因此把光标丢到文档开头', async () => {
    const content = `# 第四章 风暴降临

海风呼啸着卷过港口。`
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4, blueprintChapterNumber: 4, content })
    // 作者只是滚动过、没有留下落点：这类记忆只还原滚动位置。
    rememberDraftEditorPosition(draftEditorPositionKey(PROJECT_PATH, DRAFT_ID), {
      mode: 'ir', blockIndex: -1, offsetInBlock: 0, blockText: '', sourceOffset: 0, scrollTop: 0,
    })

    await renderEditor({ content })
    const prose = await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    // 记忆已被消费，且没有把光标放进任何段落里（落到 body 上属于「没有落点」）。
    expect(readDraftEditorPosition(draftEditorPositionKey(PROJECT_PATH, DRAFT_ID))).toBeNull()
    const blocks = Array.from(prose.children) as HTMLElement[]
    const anchor: Node | null = window.getSelection()?.anchorNode ?? null
    expect(blocks.some(block => block.contains(anchor))).toBe(false)
  })

  it('正文段落被改动、块序号偏移时：按段落快照找回原来的那一段', async () => {
    // 作者离开时的快照来自第三段；返回时正文开头多了一段，块序号已经偏移。
    const content = `# 第四章 风暴降临

新增的开场段。

海风呼啸着卷过港口。`
    openDraftTab({ filePath: FILE_PATH, draftId: DRAFT_ID, chapterNumber: 4, blueprintChapterNumber: 4, content })
    rememberDraftEditorPosition(draftEditorPositionKey(PROJECT_PATH, DRAFT_ID), {
      mode: 'ir',
      blockIndex: 2,
      offsetInBlock: 3,
      blockText: '海风呼啸着卷过港口。',
      sourceOffset: 0,
      scrollTop: 0,
    })

    await renderEditor({ content })
    const prose = await waitForVditorReady()
    await waitForSidebar('chapter-context-purpose')

    const blocks = Array.from(prose.children) as HTMLElement[]
    const anchor = window.getSelection()?.anchorNode ?? null
    expect(anchor).not.toBeNull()
    // 落在快照对应的段落里，而不是旧块序号指向的「新增的开场段」。
    const anchorBlock = blocks.find(block => block.contains(anchor))
    expect(anchorBlock?.textContent ?? '').toContain('海风呼啸着卷过港口。')
    expect(anchorBlock?.textContent ?? '').not.toContain('新增的开场段')
  })
})
