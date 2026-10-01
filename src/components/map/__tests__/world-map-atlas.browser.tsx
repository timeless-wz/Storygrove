import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../shared/ipc-channels'
import type { WorldMap, WorldMapEdge, WorldMapNode } from '../../../shared/world-map'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import WorldMapView from '../WorldMapView'
import { getMapImageFitTransform } from '../world-map-canvas-fit'

const PROJECT_PATH = 'C:\\novels\\map-atlas'
const PROJECT_SESSION = {
  projectId: 'map-atlas',
  leaseId: 'map-atlas-lease',
  projectPath: PROJECT_PATH,
}
const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'Map atlas',
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

const WORLD_MAP_ID = 'map-b0000001-1111-4111-8111-111111111111'
const ASTRAL_MAP_ID = 'map-b0000002-2222-4222-8222-222222222222'
const NORTH_MAP_ID = 'map-b0000003-3333-4333-8333-333333333333'

const MAPS: WorldMap[] = [
  { id: WORLD_MAP_ID, name: '世界总图', parentMapId: null, sortOrder: 1, image: null },
  { id: ASTRAL_MAP_ID, name: '苍穹星地图', parentMapId: WORLD_MAP_ID, sortOrder: 1, image: null },
  { id: NORTH_MAP_ID, name: '北境大陆地图', parentMapId: ASTRAL_MAP_ID, sortOrder: 1, image: null },
]

const NODES: WorldMapNode[] = [
  { id: 'node-world-crown', name: '世界之冠', type: 'world', description: '', parentId: null, mapId: WORLD_MAP_ID, x: 100, y: 100, sourceRefs: [] },
  { id: 'node-astral-gate', name: '苍穹星门', type: 'landmark', description: '', parentId: null, mapId: ASTRAL_MAP_ID, x: 120, y: 120, sourceRefs: [] },
  { id: 'node-north-keep', name: '北境要塞', type: 'city', description: '', parentId: null, mapId: NORTH_MAP_ID, x: 140, y: 140, sourceRefs: [] },
  { id: 'node-north-village', name: '雪原村落', type: 'landmark', description: '', parentId: 'node-north-keep', mapId: NORTH_MAP_ID, x: 160, y: 160, sourceRefs: [] },
]

const EDGES: WorldMapEdge[] = [
  { id: 'edge-north-internal', fromNodeId: 'node-north-keep', toNodeId: 'node-north-village', type: 'subordinate', description: '要塞与村落', status: 'active', mapId: NORTH_MAP_ID },
]

const originalWorldMapState = useWorldMapStore.getState()
const originalEditorState = useEditorStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalLayoutState = useLayoutStore.getState()

let container: HTMLDivElement
let root: Root
let invokedChannels: string[]
let mapDeleteCalls: Array<{ mapId: string; strategy: string }>
let mapImageDataUrl: string | undefined
let savedNodes: WorldMapNode[]

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stubApi(): void {
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
        invokedChannels.push(channel)
        if (channel === 'db:map-get-all') {
          return { maps: MAPS, nodes: savedNodes, edges: EDGES, migration: null }
        }
        if (channel === 'db:map-node-upsert') {
          const node = args[0] as WorldMapNode
          savedNodes = [...savedNodes.filter(item => item.id !== node.id), node]
          return { success: true, node }
        }
        if (channel === 'db:map-candidates-get') return []
        if (channel === 'world-map-image:get') return { success: true, image: null, dataUrl: mapImageDataUrl }
        if (channel === 'db:map-delete') {
          mapDeleteCalls.push({ mapId: String(args[0]), strategy: String(args[1]) })
          return { success: true, removedMapIds: [String(args[0])] }
        }
        return { success: true }
      }),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
    },
  })
}

async function render(): Promise<void> {
  await act(async () => root.render(<WorldMapView projectKey={PROJECT_PATH} />))
  // 首帧的异步加载完成后需要再渲染一次，才能观察到加载结果。
  await act(async () => { await Promise.resolve() })
}

function text(): string {
  return container.textContent ?? ''
}

/** 对话框通过 portal 渲染到 document.body，断言必须看整页文本。 */
function pageText(): string {
  return document.body.textContent ?? ''
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    button => button.title === label || button.getAttribute('aria-label') === label || button.textContent?.trim() === label,
  )
}

async function clickButton(label: string): Promise<void> {
  const target = findButton(label)
  if (!target) throw new Error(`Missing button: ${label}`)
  await act(async () => {
    target.click()
  })
}

async function settleLayout(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

function readCanvasTransform(): { x: number; y: number; zoom: number } {
  const transform = container.querySelector<SVGSVGElement>('[data-testid="world-map-surface"]')?.style.transform
  const values = transform?.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)
  if (!values) throw new Error(`Unable to read canvas transform: ${transform}`)
  return { x: Number(values[1]), y: Number(values[2]), zoom: Number(values[3]) }
}

beforeEach(() => {
  savedNodes = NODES.map(node => ({ ...node }))
  invokedChannels = []
  mapDeleteCalls = []
  mapImageDataUrl = undefined
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1, fileTree: [], loading: false })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useLayoutStore.setState({ sidebarView: 'project', activeRailItem: 'project', characterViewRequest: null })
  useWorldMapStore.setState({
    ...originalWorldMapState,
    maps: [], nodes: [], edges: [], candidates: [], migration: null,
    selectedMapId: null, selectedNodeId: null, selectedEdgeId: null,
    viewMode: 'canvas', loading: false, candidatesLoading: false,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  stubApi()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useWorldMapStore.setState(originalWorldMapState)
  useEditorStore.setState(originalEditorState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useLayoutStore.setState(originalLayoutState)
  vi.restoreAllMocks()
})

describe('world map atlas view', () => {
  it('lets buildings of the same location type use distinct persisted markers', async () => {
    await render()
    await clickButton('北境大陆地图')
    const marker = container.querySelector('#map-node-node-north-keep')!
    expect(marker.querySelector('.lucide-castle')).not.toBeNull()
    await act(async () => { marker.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const templeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="神殿"]')!
    expect(templeButton).not.toBeNull()
    await act(async () => { templeButton.click() })
    expect(templeButton.getAttribute('aria-pressed')).toBe('true')
    const save = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '保存地点')!
    const saveBounds = save.getBoundingClientRect()
    expect(saveBounds.top).toBeGreaterThanOrEqual(0)
    expect(saveBounds.bottom).toBeLessThanOrEqual(window.innerHeight)
    await act(async () => { save.click() })
    expect(useWorldMapStore.getState().nodes.find(node => node.id === 'node-north-keep'))
      .toMatchObject({ type: 'city', markerIcon: 'temple' })
    expect(container.querySelector('#map-node-node-north-keep .lucide-landmark')).not.toBeNull()
    // 重开编辑器仍能看到已保存图标；自动选项会明确清除自定义图标。
    await act(async () => {
      container.querySelector('#map-node-node-north-keep')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(document.body.querySelector('button[aria-label="神殿"]')?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => { document.body.querySelector<HTMLButtonElement>('button[aria-label="自动"]')!.click() })
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent?.trim() === '保存地点')!.click()
    })
    expect(container.querySelector('#map-node-node-north-keep .lucide-castle')).not.toBeNull()
  })

  it('fits the full base image into the narrowed canvas used with a sidebar', () => {
    // 侧边栏展开后的可用区域比底图窄；适配后左右都应保留边距，不能裁掉右侧。
    const fitted = getMapImageFitTransform(900, 1000)

    expect(fitted.zoom).toBeCloseTo(0.71)
    expect(fitted.pan.x).toBeCloseTo(24)
    expect(fitted.pan.y).toBeCloseTo(180.5)
    expect(1200 * fitted.zoom).toBeLessThanOrEqual(900 - 48)
  })

  it('uses the real portrait image bounds instead of shrinking its empty SVG margins', () => {
    // 竖版底图被放进 1200×900 的逻辑区域后，两侧是 SVG 留白；缩放应以实际
    // 图片的 5:8 内容为准，不能以包含留白的 4:3 逻辑区域为准。
    const fitted = getMapImageFitTransform(900, 1000, { width: 800, height: 1280 })

    expect(fitted.zoom).toBeCloseTo(952 / 900)
    expect(fitted.pan.x).toBeCloseTo((900 - 1200 * fitted.zoom) / 2)
    expect(fitted.pan.y).toBeCloseTo(24)
  })

  it('refits the map after the map-management panel changes the canvas width', async () => {
    mapImageDataUrl = 'data:image/png;base64,aW1hZ2U='
    await render()
    await settleLayout()

    const canvas = container.querySelector<HTMLElement>('[data-testid="world-map-canvas"]')
    expect(canvas).toBeDefined()
    let viewport = { width: 1200, height: 800 }
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: viewport.width, height: viewport.height }),
    })

    // 默认显示地图册树；先收起再展开，模拟该固定栏使画布从 1200px 缩到 760px。
    await clickButton('显示或隐藏地图册树')
    await settleLayout()
    const expandedExpected = getMapImageFitTransform(viewport.width, viewport.height)
    const expandedTransform = readCanvasTransform()

    expect(expandedTransform.zoom).toBeCloseTo(expandedExpected.zoom)
    expect(expandedTransform.x).toBeCloseTo(expandedExpected.pan.x)
    expect(expandedTransform.y).toBeCloseTo(expandedExpected.pan.y)

    viewport = { width: 760, height: 800 }
    await clickButton('显示或隐藏地图册树')
    await settleLayout()
    const collapsedExpected = getMapImageFitTransform(viewport.width, viewport.height)
    const collapsedTransform = readCanvasTransform()

    expect(collapsedTransform.zoom).toBeCloseTo(collapsedExpected.zoom)
    expect(collapsedTransform.x).toBeCloseTo(collapsedExpected.pan.x)
    expect(collapsedTransform.y).toBeCloseTo(collapsedExpected.pan.y)
  })

  it('renders the atlas tree and defaults to the first map', async () => {
    await render()

    expect(text()).toContain('地图册')
    expect(text()).toContain('世界总图')
    expect(text()).toContain('苍穹星地图')
    expect(text()).toContain('北境大陆地图')

    // 默认选中第一张地图，并且只显示它自己的地点。
    expect(useWorldMapStore.getState().selectedMapId).toBe(WORLD_MAP_ID)
    expect(text()).toContain('世界之冠')
    expect(text()).not.toContain('苍穹星门')
    expect(text()).not.toContain('北境要塞')
  })

  it('shows only the selected map’s locations and internal connections', async () => {
    await render()

    // 切换到「北境大陆地图」：主区域变成它自己的地点与内部连接。
    await clickButton('北境大陆地图')

    expect(useWorldMapStore.getState().selectedMapId).toBe(NORTH_MAP_ID)
    expect(text()).toContain('北境要塞')
    expect(text()).toContain('雪原村落')
    expect(text()).toContain('要塞与村落')
    // 其他地图的地点绝不会同时出现。
    expect(text()).not.toContain('世界之冠')
    expect(text()).not.toContain('苍穹星门')

    // 顶栏计数也只统计这张地图。
    expect(text()).toContain('2 个地点')
    expect(text()).toContain('1 条连接')
  })

  it('renders an imported base image even before the map has locations', async () => {
    // "世界总图" 有地点；切到没有地点的地图后，图片仍必须直接进入画布，
    // 而不是被空状态遮住。
    mapImageDataUrl = 'data:image/png;base64,aW1hZ2U='
    await render()
    await clickButton('苍穹星地图')

    expect(text()).not.toContain('这张地图还是空的')
    expect(container.querySelector('image')?.getAttribute('href')).toBe(mapImageDataUrl)
  })

  it('keeps the complete logical map surface when side panels narrow the viewport', async () => {
    mapImageDataUrl = 'data:image/png;base64,aW1hZ2U='
    await render()

    const surface = container.querySelector<SVGSVGElement>('[data-testid="world-map-surface"]')
    // 画布外层负责裁切；SVG 自身不能再按可视宽度缩小，否则右半张图会在缩放前丢失。
    expect(surface?.getAttribute('width')).toBe('1200')
    expect(surface?.getAttribute('height')).toBe('900')
    expect(surface?.classList.contains('w-full')).toBe(false)
    expect(surface?.classList.contains('h-full')).toBe(false)
  })

  it('pans the zoomed map when dragging its image or grid background', async () => {
    mapImageDataUrl = 'data:image/png;base64,aW1hZ2U='
    await render()
    await settleLayout()

    // 先放大，模拟作者查看大地图时的操作。
    await clickButton('+')
    const canvas = container.querySelector<HTMLElement>('[data-testid="world-map-canvas"]')
    const grid = canvas?.querySelector<SVGRectElement>('svg rect')
    const surface = container.querySelector<SVGSVGElement>('[data-testid="world-map-surface"]')
    expect(canvas).toBeDefined()
    expect(grid).toBeDefined()
    expect(surface).toBeDefined()
    const beforePan = surface?.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)
    expect(beforePan).not.toBeNull()

    // 底图 pointer-events=none 时事件会落到网格 rect；仍应开始平移。
    await act(async () => {
      grid?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 300, clientY: 180 }))
    })
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 430, clientY: 245 }))
    })
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    })

    const afterPan = surface?.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)
    expect(afterPan).not.toBeNull()
    expect(Number(afterPan?.[1])).toBeCloseTo(Number(beforePan?.[1]) + 130)
    expect(Number(afterPan?.[2])).toBeCloseTo(Number(beforePan?.[2]) + 65)
    expect(afterPan?.[3]).toBe(beforePan?.[3])
  })

  it('renders a breadcrumb trail from the atlas root to the selected map', async () => {
    await render()

    await clickButton('北境大陆地图')

    const breadcrumb = container.querySelector('[data-testid="world-map-breadcrumb"]')
    expect(breadcrumb?.textContent).toContain('世界总图')
    expect(breadcrumb?.textContent).toContain('苍穹星地图')
    expect(breadcrumb?.textContent).toContain('北境大陆地图')
    // 面包屑按根到叶的顺序排列，并且最后一项是当前位置。
    expect(breadcrumb?.textContent?.indexOf('世界总图')).toBeLessThan(breadcrumb?.textContent?.indexOf('苍穹星地图') ?? 0)
    expect(breadcrumb?.textContent?.indexOf('苍穹星地图')).toBeLessThan(breadcrumb?.textContent?.indexOf('北境大陆地图') ?? 0)

    // 通过面包屑可以回到上层地图。
    await act(async () => {
      const target = Array.from(breadcrumb?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find(button => button.textContent?.trim() === '世界总图')
      target?.click()
    })
    expect(useWorldMapStore.getState().selectedMapId).toBe(WORLD_MAP_ID)
  })

  it('explains child maps, locations, connections, and images before deleting a map', async () => {
    await render()

    // 打开「苍穹星地图」的删除对话框（它有一张子地图和两个内部地点）。
    await clickButton('删除「苍穹星地图」')

    expect(pageText()).toContain('删除地图「苍穹星地图」')
    // 地点、连接、图片与子地图的处理方式都必须逐项说明。
    expect(pageText()).toContain('内部的 1 个地点会在删除后一并移除')
    expect(pageText()).toContain('地图内部连接 0 条会被删除')
    expect(pageText()).toContain('这张地图没有图片，不会触碰文件')
    expect(pageText()).toContain('子地图处理方式（共 1 张直接子地图）')
    expect(pageText()).toContain('保留子地图，改挂到上层')
    expect(pageText()).toContain('连同整棵子树一起删除')
    // 在作者确认之前，绝不发生任何删除。
    expect(mapDeleteCalls).toEqual([])

    const confirmButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '确认删除')
    expect(confirmButton).toBeDefined()
    await act(async () => {
      confirmButton?.click()
    })

    // 默认策略保留子地图；只有作者显式选择才会级联删除整棵子树。
    expect(mapDeleteCalls).toEqual([{ mapId: ASTRAL_MAP_ID, strategy: 'promote-children' }])
  })
})
