import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ProjectData } from '../../../shared/ipc-channels'
import {
  chapterCanvasId,
  createChapterCanvasNodeId,
  type ChapterCanvasNodeData,
} from '../../../shared/chapter-canvas'
import {
  getBlueprintV2Scenes,
  type BlueprintV2Section,
  type ChapterBlueprintV2Content,
  type ChapterBlueprintV2Detail,
} from '../../../shared/blueprint-v2'
import { parseChapterBlueprintMarkdown } from '../../../shared/blueprint-v2-markdown'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import ChapterCanvasWorkbench from '../ChapterCanvasWorkbench'
import chapterOneMarkdown from '../../../../test/fixtures/blueprint-v2/chapter-01.md?raw'

const PROJECT_PATH = 'C:\\novels\\chapter-canvas-blueprint'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()

/* ===== 固定分镜 ID，便于断言画布卡 ↔ 蓝图分镜的绑定 ===== */

const SCENE_IDS = [
  'bps-11111111-1111-4111-8111-111111111111',
  'bps-22222222-2222-4222-8222-222222222222',
  'bps-33333333-3333-4333-8333-333333333333',
]

function sceneSection(items: Array<{ id: string; title: string; markdown: string; presence?: 'on-canvas' | 'off-canvas'; canvasNodeId?: string }>): BlueprintV2Section {
  return {
    kind: 'canonical',
    id: 'storyboard',
    title: '【逐场分镜拆解】',
    level: 4,
    preamble: '',
    postamble: '',
    items: items.map(item => ({
      kind: 'scene' as const,
      level: 5,
      presence: 'off-canvas' as const,
      ...item,
    })),
  }
}

function blueprintContent(): ChapterBlueprintV2Content {
  return {
    schemaVersion: 2,
    chapterNumber: 2,
    chapterTitle: '第2章｜测试章',
    docPreamble: '',
    origin: 'import',
    sections: [
      sceneSection([
        { id: SCENE_IDS[0], title: '场景一：雨夜到站', markdown: '- **时空与环境**：深夜站台。\n' },
        { id: SCENE_IDS[1], title: '场景二：候车厅对峙', markdown: '- **对白推进**：\n  - 甲：“谁？”\n' },
        { id: SCENE_IDS[2], title: '场景三：末班车驶离', markdown: '- **动作定格**：车灯远去。\n' },
      ]),
    ],
  }
}

function detailOf(content: ChapterBlueprintV2Content, revision: number): ChapterBlueprintV2Detail {
  return { ...content, revision, contentHash: 'test-hash' }
}

/* ===== 可变 fixture：模拟项目数据库 ===== */

interface FixtureDb {
  chapterNodes: ChapterCanvasNodeData[]
  chapterEdges: Array<{ id: string; canvasId: string; sourceNodeId: string; targetNodeId: string; label: string; kind: string }>
  blueprintContent: ChapterBlueprintV2Content
  blueprintRevision: number
  failChannel: string | null
}

let db: FixtureDb
let invoke: ReturnType<typeof vi.fn>

function freshDb(): FixtureDb {
  const content = blueprintContent()
  return {
    chapterNodes: [],
    chapterEdges: [],
    blueprintContent: content,
    blueprintRevision: 1,
    failChannel: null,
  }
}

function seedLinkedSceneNode(sceneIndex: number): ChapterCanvasNodeData {
  const content = db.blueprintContent
  const storyboard = content.sections[0]
  if (storyboard.kind !== 'canonical') throw new Error('fixture 无 storyboard 分区')
  const scene = storyboard.items[sceneIndex]
  if (scene.kind !== 'scene') throw new Error('fixture 条目不是分镜')
  const node: ChapterCanvasNodeData = {
    id: createChapterCanvasNodeId(),
    canvasId: chapterCanvasId(2),
    type: 'scene',
    title: scene.title,
    summary: '',
    colorKey: 'default',
    role: '',
    order: 1,
    refs: { sceneId: scene.id },
    x: 100,
    y: 300,
  }
  db.chapterNodes.push(node)
  db.blueprintContent = {
    ...content,
    sections: content.sections.map(section => (
      section.kind === 'canonical' && section.id === 'storyboard'
        ? {
          ...section,
          items: section.items.map(item => (
            item.kind === 'scene' && item.id === scene.id
              ? { ...item, presence: 'on-canvas' as const, canvasNodeId: node.id }
              : item
          )),
        }
        : section
    )),
  }
  return node
}

function installIpc() {
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (db.failChannel === channel) throw new Error(`模拟保存失败：${channel}`)
    switch (channel) {
      case 'db:chapter-canvas-get': {
        const [chapterNumber] = args as [number]
        return {
          canvas: db.chapterNodes.length > 0
            ? { id: chapterCanvasId(chapterNumber), chapterNumber, viewport: null }
            : null,
          nodes: db.chapterNodes.filter(node => node.canvasId === chapterCanvasId(chapterNumber)),
          edges: db.chapterEdges,
        }
      }
      case 'db:chapter-canvas-node-upsert': {
        const input = args[0] as ChapterCanvasNodeData & { chapterNumber: number }
        const node: ChapterCanvasNodeData = { ...input, canvasId: chapterCanvasId(input.chapterNumber) }
        const existing = db.chapterNodes.find(item => item.id === node.id)
        if (existing) Object.assign(existing, node)
        else db.chapterNodes.push(node)
        return { success: true, node }
      }
      case 'db:chapter-canvas-node-delete': {
        const [, nodeId] = args as [number, string]
        db.chapterNodes = db.chapterNodes.filter(node => node.id !== nodeId)
        db.chapterEdges = db.chapterEdges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
        return { success: true }
      }
      case 'db:chapter-canvas-nodes-reposition':
      case 'db:chapter-canvas-viewport-save':
        return { success: true }
      case 'db:character-roster-read':
        return {
          schemaVersion: 1, revision: 1, migrationState: {}, status: 'ready', entries: [],
          renderedMarkdown: '', projectionHash: '', factHash: '',
        }
      case 'db:foreshadowing-list':
        return []
      case 'db:blueprint-v2-get':
        return detailOf(db.blueprintContent, db.blueprintRevision)
      case 'db:blueprint-v2-save': {
        const input = args[0] as { chapterNumber: number; baseRevision: number; content: ChapterBlueprintV2Content }
        if (input.baseRevision !== db.blueprintRevision) {
          return { success: false, conflict: true, currentRevision: db.blueprintRevision }
        }
        db.blueprintContent = input.content
        db.blueprintRevision += 1
        return { success: true, revision: db.blueprintRevision, contentHash: 'next-hash' }
      }
      case 'db:blueprint-v2-scene-order-save': {
        const input = args[0] as { chapterNumber: number; baseRevision: number; orderedSceneIds: string[] }
        if (input.baseRevision !== db.blueprintRevision) {
          return { success: false, conflict: true, currentRevision: db.blueprintRevision }
        }
        const content = db.blueprintContent
        const storyboard = content.sections.find(section => section.kind === 'canonical' && section.id === 'storyboard')
        if (!storyboard || storyboard.kind !== 'canonical') return { success: false, error: 'fixture 无 storyboard 分区' }
        const sceneItems = storyboard.items.filter((item): item is Extract<typeof item, { kind: 'scene' }> => item.kind === 'scene')
        const ordered = input.orderedSceneIds
          .map(id => sceneItems.find(scene => scene.id === id))
          .filter((scene): scene is NonNullable<typeof scene> => Boolean(scene))
        let cursor = 0
        db.blueprintContent = {
          ...content,
          sections: content.sections.map(section => (
            section.kind === 'canonical' && section.id === 'storyboard'
              ? { ...section, items: section.items.map(item => (item.kind === 'scene' ? ordered[cursor++] : item)) }
              : section
          )),
        }
        db.blueprintRevision += 1
        return { success: true, revision: db.blueprintRevision, contentHash: 'order-hash' }
      }
      default:
        throw new Error(`unexpected IPC ${channel}`)
    }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
}

function project(): ProjectData {
  return {
    id: 'chapter-canvas-blueprint',
    sessionLease: 'chapter-canvas-blueprint-lease',
    name: '画布蓝图测试项目',
    path: PROJECT_PATH,
    novelConfig: {
      genre: '', subGenre: '', targetAudience: '', totalChapters: 10, wordsPerChapter: 2000,
      plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '',
      goldenFinger: '', protagonistProfile: '', globalGuidance: '',
    },
    characterStates: '',
    createdAt: '',
    updatedAt: '',
  }
}

beforeEach(() => {
  db = freshDb()
  useLocaleStore.setState({ locale: 'zh-CN' })
  useProjectStore.setState({ currentProject: project(), fileTree: [], loading: false })
  setActiveProjectSessionContext({ projectId: 'chapter-canvas-blueprint', leaseId: 'chapter-canvas-blueprint-lease', projectPath: PROJECT_PATH })
  installIpc()
  container = document.createElement('div')
  container.style.width = '1280px'
  container.style.height = '800px'
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => { root?.unmount() })
    root = undefined
  }
  container?.remove()
  container = undefined
  Reflect.deleteProperty(window, 'velaAPI')
  useProjectStore.setState(originalProjectState)
  useLocaleStore.setState(originalLocaleState)
  setActiveProjectSessionContext(null)
})

async function renderWorkbench(chapterNumber = 2, chapterTitle = '测试章') {
  await act(async () => {
    root?.render(
      <ChapterCanvasWorkbench
        projectKey={PROJECT_PATH}
        chapterNumber={chapterNumber}
        chapterTitle={chapterTitle}
        canOpenDraft={false}
        openDraftLabel=""
        onOpenDraft={() => {}}
      />,
    )
  })
}

async function refreshWorkbench(chapterNumber: number, chapterTitle: string) {
  await act(async () => { root?.unmount() })
  container?.remove()
  container = document.createElement('div')
  container.style.width = '1280px'
  container.style.height = '800px'
  document.body.appendChild(container)
  root = createRoot(container)
  await renderWorkbench(chapterNumber, chapterTitle)
}

async function clickButton(matcher: (button: HTMLButtonElement) => boolean) {
  const button = await vi.waitFor(() => {
    const found = Array.from(document.body.querySelectorAll('button')).find(matcher)
    if (!found) throw new Error('button not found')
    return found
  })
  await act(async () => { button.click() })
}

async function clickDialogButton(label: string) {
  const button = await vi.waitFor(() => {
    const dialog = document.body.querySelector('[role="dialog"]')
    const found = Array.from(dialog?.querySelectorAll('button') ?? []).find(item => item.textContent?.trim() === label)
    if (!found) throw new Error(`dialog button ${label} not found`)
    return found
  })
  await act(async () => { button.click() })
}

/** 点击 React Flow 节点使其选中（点击节点内部元素会冒泡到 RF 的包装器）。 */
async function selectNodeByTestId(selector: string) {
  const node = await vi.waitFor(() => {
    const found = container!.querySelector<HTMLElement>(selector)
    if (!found) throw new Error(`node ${selector} not found`)
    return found
  })
  const wrapper = node.closest<HTMLElement>('.react-flow__node') ?? node
  await act(async () => { wrapper.click() })
}

function storyboardScenes() {
  const section = db.blueprintContent.sections.find(item => item.kind === 'canonical' && item.id === 'storyboard')
  if (!section || section.kind !== 'canonical') throw new Error('fixture 无 storyboard 分区')
  return section.items.filter((item): item is Extract<typeof item, { kind: 'scene' }> => item.kind === 'scene')
}

function seedFullChapterOne() {
  const parsed = parseChapterBlueprintMarkdown(chapterOneMarkdown).content
  db.blueprintContent = { ...parsed, chapterNumber: 1 }
  const scenes = getBlueprintV2Scenes(db.blueprintContent)
  db.chapterNodes = scenes.map(scene => ({
    id: createChapterCanvasNodeId(),
    canvasId: chapterCanvasId(1),
    type: 'scene' as const,
    title: scene.title,
    summary: '',
    colorKey: 'default',
    role: '',
    order: scene.order,
    refs: { sceneId: scene.sceneId },
    x: 100 + (scene.order - 1) * 460,
    y: 300,
  }))
  db.blueprintContent = {
    ...db.blueprintContent,
    sections: db.blueprintContent.sections.map(section => (
      section.kind === 'canonical' && section.id === 'storyboard'
        ? {
          ...section,
          items: section.items.map(item => {
            if (item.kind !== 'scene') return item
            const node = db.chapterNodes.find(candidate => candidate.refs.sceneId === item.id)!
            return { ...item, presence: 'on-canvas' as const, canvasNodeId: node.id }
          }),
        }
        : section
    )),
  }
  db.blueprintRevision = 1
  return scenes
}

describe('ChapterCanvasWorkbench 蓝图 v2 分镜编排', () => {
  it('排上画布：新建场景卡绑定 bps 分镜 ID，蓝图 presence 同步为 on-canvas（§8.2）', async () => {
    const linked = seedLinkedSceneNode(0)
    await renderWorkbench()
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(1))
    expect(container!.querySelector('[data-testid="chapter-canvas-linked-badge"]')).toBeTruthy()

    await clickButton(findButtonOf('排上画布'))
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chapter-canvas-place-dialog"]')).toBeTruthy())
    // 对话框只列出未排上的分镜（场景二、场景三）。
    await clickButton(button => button.getAttribute('data-testid') === `chapter-canvas-place-${SCENE_IDS[1]}`)
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(2))

    // 画布卡绑定正式分镜 ID；蓝图 presence/canvasNodeId 已写回。
    const placedNode = db.chapterNodes.find(node => node.refs.sceneId === SCENE_IDS[1])
    expect(placedNode).toBeTruthy()
    expect(placedNode!.title).toBe('场景二：候车厅对峙')
    const placedScene = storyboardScenes().find(scene => scene.id === SCENE_IDS[1])
    expect(placedScene?.presence).toBe('on-canvas')
    expect(placedScene?.canvasNodeId).toBe(placedNode!.id)
    // 排上画布不灌入分镜正文：summary 保持画布侧手工字段。
    expect(placedNode!.summary).toBe('')
    void linked
  })

  it('移出画布：删画布卡并写回 presence=off-canvas，蓝图分镜保留（§8.2 移出 ≠ 删除）', async () => {
    const linked = seedLinkedSceneNode(0)
    await renderWorkbench()
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(1))

    await selectNodeByTestId('[data-testid="chapter-canvas-scene"]')
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chapter-canvas-detail"]')).toBeTruthy())
    await clickButton(findButtonOf('移出画布'))
    // 确认对话框（portal）。
    await clickDialogButton('移出画布')

    await vi.waitFor(() => expect(db.chapterNodes).toHaveLength(0))
    const scene = storyboardScenes().find(item => item.id === SCENE_IDS[0])
    expect(scene?.presence).toBe('off-canvas')
    expect(scene?.canvasNodeId).toBeUndefined()
    expect(scene?.title).toBe('场景一：雨夜到站')
    expect(scene?.markdown).toContain('深夜站台')
    void linked
  })

  it('删除蓝图分镜：破坏性确认后移除条目，场景卡保留并显示引用失效（§8.2）', async () => {
    seedLinkedSceneNode(0)
    await renderWorkbench()
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(1))

    await selectNodeByTestId('[data-testid="chapter-canvas-scene"]')
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chapter-canvas-detail"]')).toBeTruthy())
    await clickButton(findButtonOf('删除蓝图分镜'))
    await clickDialogButton('删除分镜')

    // 蓝图分镜被删除。
    await vi.waitFor(() => expect(
      storyboardScenes().some(scene => scene.id === SCENE_IDS[0]),
    ).toBe(false))
    // 场景卡不自动删除，转为悬空引用徽标；node-delete 通道未被调用。
    await vi.waitFor(() => expect(
      container!.querySelector('[data-testid="chapter-canvas-dangling-badge"]'),
    ).toBeTruthy())
    expect(db.chapterNodes).toHaveLength(1)
    expect(invoke).not.toHaveBeenCalledWith('db:chapter-canvas-node-delete', expect.anything(), expect.anything(), expect.anything())
  })

  it('顺序权威：上移写入蓝图 scene-order-save，画布卡 order 镜像新值（§8.3）', async () => {
    seedLinkedSceneNode(0)
    seedLinkedSceneNode(1)
    await renderWorkbench()
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(2))

    // 选中场景二的卡片（badges 显示 #2）。
    const scene2Node = db.chapterNodes.find(node => node.refs.sceneId === SCENE_IDS[1])!
    await selectNodeByTestId(`[data-node-id="${scene2Node.id}"]`)
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chapter-canvas-detail"]')).toBeTruthy())
    await clickButton(button => button.textContent?.includes('上移') ?? false)

    await vi.waitFor(() => expect(db.blueprintRevision).toBe(2))
    const scenes = storyboardScenes()
    expect(scenes[0].id).toBe(SCENE_IDS[1])
    expect(scenes[1].id).toBe(SCENE_IDS[0])
    // node.order 镜像蓝图顺序。
    await vi.waitFor(() => {
      const mirrored = db.chapterNodes.find(node => node.refs.sceneId === SCENE_IDS[1])
      expect(mirrored?.order).toBe(1)
    })
  })

  it('第1章完整 Markdown：四场绑定正式 ID，可重排并刷新后保留场景正文（§11）', async () => {
    const importedScenes = seedFullChapterOne()
    expect(importedScenes).toHaveLength(4)
    const originalMarkdownById = new Map(importedScenes.map(scene => [scene.sceneId, scene.markdown]))
    await renderWorkbench(1, '第1章｜接错的人')
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(4))

    const movedSceneId = importedScenes[1].sceneId
    const movedNode = db.chapterNodes.find(node => node.refs.sceneId === movedSceneId)!
    await selectNodeByTestId(`[data-node-id="${movedNode.id}"]`)
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chapter-canvas-detail"]')).toBeTruthy())
    await clickButton(button => button.textContent?.includes('上移') ?? false)

    await vi.waitFor(() => expect(db.blueprintRevision).toBe(2))
    const reordered = storyboardScenes()
    expect(reordered.map(scene => scene.id)).toEqual([
      importedScenes[1].sceneId,
      importedScenes[0].sceneId,
      importedScenes[2].sceneId,
      importedScenes[3].sceneId,
    ])
    for (const scene of reordered) expect(scene.markdown).toBe(originalMarkdownById.get(scene.id))
    expect(reordered[3].markdown).toContain('我想报警。')
    expect(reordered[3].markdown).toContain('这辆车在往天上开！')
    await vi.waitFor(() => {
      expect(db.chapterNodes.find(node => node.refs.sceneId === movedSceneId)?.order).toBe(1)
      expect(db.chapterNodes.find(node => node.refs.sceneId === importedScenes[0].sceneId)?.order).toBe(2)
    })

    await refreshWorkbench(1, '第1章｜接错的人')
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(4))
    const refreshedMovedNode = db.chapterNodes.find(node => node.refs.sceneId === movedSceneId)!
    const refreshedFirstNode = db.chapterNodes.find(node => node.refs.sceneId === importedScenes[0].sceneId)!
    expect(container!.querySelector(`[data-node-id="${refreshedMovedNode.id}"]`)?.textContent).toContain('#1')
    expect(container!.querySelector(`[data-node-id="${refreshedMovedNode.id}"]`)?.textContent).toContain(importedScenes[1].title)
    expect(container!.querySelector(`[data-node-id="${refreshedFirstNode.id}"]`)?.textContent).toContain('#2')
    const reread = storyboardScenes()
    expect(reread.map(scene => scene.id)).toEqual(reordered.map(scene => scene.id))
    for (const scene of reread) expect(scene.markdown).toBe(originalMarkdownById.get(scene.id))
  })

  it('保存失败：蓝图写回失败时场景卡不丢失，错误可见', async () => {
    seedLinkedSceneNode(0)
    await renderWorkbench()
    await vi.waitFor(() => expect(container!.querySelectorAll('[data-testid="chapter-canvas-scene"]')).toHaveLength(1))

    db.failChannel = 'db:blueprint-v2-save'
    await selectNodeByTestId('[data-testid="chapter-canvas-scene"]')
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="chapter-canvas-detail"]')).toBeTruthy())
    await clickButton(findButtonOf('移出画布'))
    await clickDialogButton('移出画布')
    await vi.waitFor(() => {
      expect(document.body.textContent ?? '').toContain('保存蓝图细纲失败')
    })
    // 蓝图写回失败：presence 未变、分镜仍在蓝图中（不丢内容）。
    const scene = storyboardScenes().find(item => item.id === SCENE_IDS[0])
    expect(scene?.presence).toBe('on-canvas')
    expect(scene?.markdown).toContain('深夜站台')
    expect(db.chapterNodes).toHaveLength(1)
    expect(container!.querySelector('[data-testid="chapter-canvas-scene"]')).toBeTruthy()
    expect(invoke).not.toHaveBeenCalledWith('db:chapter-canvas-node-delete', expect.anything(), expect.anything(), expect.anything())
    db.failChannel = null
  })
})

function findButtonOf(label: string): (button: HTMLButtonElement) => boolean {
  return button => button.textContent?.includes(label) ?? false
}
