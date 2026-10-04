import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import type { ProjectData } from '../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { EMPTY_WORLD_SNAPSHOT, useWorldWorkbenchStore } from '../../../stores/world-workbench-store'
import type {
  WorldCharacterLocation,
  WorldCharacterTrail,
  WorldFaction,
  WorldFactionRelation,
  WorldPortal,
  WorldRecord,
  WorldRelic,
  WorldWorkbenchSnapshot,
} from '../../../shared/world-workbench'
import { DEFAULT_TIMELINE_SETTINGS, STORY_TIMELINE_MAIN_BRANCH_ID } from '../../../shared/story-timeline'
import WorldWorkbenchView from '../WorldWorkbenchView'
import '../../../index.css'

const PROJECT_PATH = 'C:\\novels\\world-workbench'
const PROJECT_SESSION = { projectId: 'world-workbench', leaseId: 'lease-1', projectPath: PROJECT_PATH }

const project: ProjectData = {
  id: PROJECT_SESSION.projectId,
  sessionLease: PROJECT_SESSION.leaseId,
  name: 'World workbench',
  path: PROJECT_PATH,
  novelConfig: { genre: '', subGenre: '', targetAudience: '', totalChapters: 0, wordsPerChapter: 0 } as ProjectData['novelConfig'],
  characterStates: '',
  createdAt: '',
  updatedAt: '',
}

const MORTAL_MAP = 'map-11111111-1111-4111-8111-111111111111'
const IMMORTAL_MAP = 'map-22222222-2222-4222-8222-222222222222'

let container: HTMLDivElement
let root: Root

interface FakeBackend {
  snapshot: WorldWorkbenchSnapshot
  maps: Array<{ id: string; name: string; parentMapId: null; sortOrder: number; image: null; worldId: string | null }>
  nodes: Array<{ id: string; name: string; type: 'city'; description: string; parentId: null; mapId: string; x: number; y: number; sourceRefs: string[] }>
  /** 记录每一次写通道的调用与参数，用来断言界面真的发了正确的请求。 */
  writes: Array<{ channel: string; args: unknown[] }>
}

function makeBackend(): FakeBackend {
  return {
    snapshot: {
      ...EMPTY_WORLD_SNAPSHOT,
      worlds: [],
      characterRefs: [{ id: 'char-1', name: '林尘', role: 'protagonist', locationText: '' }],
    },
    maps: [
      { id: MORTAL_MAP, name: '凡人界总图', parentMapId: null, sortOrder: 1, image: null, worldId: null },
      { id: IMMORTAL_MAP, name: '修真界总图', parentMapId: null, sortOrder: 2, image: null, worldId: null },
    ],
    nodes: [
      { id: 'node-qtc', name: '青石村', type: 'city', description: '', parentId: null, mapId: MORTAL_MAP, x: 10, y: 10, sourceRefs: [] },
      { id: 'node-tmc', name: '天门城', type: 'city', description: '', parentId: null, mapId: IMMORTAL_MAP, x: 20, y: 20, sourceRefs: [] },
    ],
    writes: [],
  }
}

let backend: FakeBackend
let nextId = 0

function worldOf(id: string): WorldRecord | undefined {
  return backend.snapshot.worlds.find(world => world.id === id)
}

function seedTwoWorldFixture(): { worldA: WorldRecord; worldB: WorldRecord } {
  const worldA: WorldRecord = {
    id: 'world-fixture-a', name: '雾海诸境', summary: '潮汐决定航路，古老灯塔守望群岛。',
    background: '雾海环绕着七座群岛。潮汐每七年改道一次，商船与流亡者都沿灯塔寻找归路。',
    notes: '旧航海日志仍由港口公会保管。', sortOrder: 0,
  }
  const worldB: WorldRecord = {
    id: 'world-fixture-b', name: '烬原王朝', summary: '赤色荒原上的流亡王朝。',
    background: '烬原在三百年前的火雨后分裂成诸侯领地，失去王冠的家族仍守着边境城墙。',
    notes: '王朝纪年沿用旧历。', sortOrder: 1,
  }
  const factionA: WorldFaction = {
    id: 'faction-fixture-a', worldId: worldA.id, name: '雾灯公会', type: '商会',
    summary: '维护航标与灯塔。', description: '控制沉船湾的旧灯塔。', seat: '沉船湾',
    domainNote: '北群岛航线', notes: '',
  }
  const factionB: WorldFaction = {
    id: 'faction-fixture-b', worldId: worldB.id, name: '赤烬同盟', type: '诸侯联盟',
    summary: '寻找失落的王冠。', description: '由边境诸侯结盟而成。', seat: '赤城关',
    domainNote: '烬原北部', notes: '',
  }
  const relicA: WorldRelic = {
    id: 'relic-fixture-a', worldId: worldA.id, name: '潮汐镜宫', type: '遗迹',
    summary: '只有退潮时才显露的镜面宫殿。', description: '墙面映出尚未发生的航程。',
    locationNote: '沉船湾外海', nodeId: 'node-qtc', entranceNodeId: 'node-qtc',
    entryCondition: '退潮后持灯靠岸', danger: '镜像会误导方向', rewards: '古航图',
    availabilityNote: '每七年开放一次', status: 'sealed', customStatusLabel: '', notes: '',
  }
  const relicB: WorldRelic = {
    id: 'relic-fixture-b', worldId: worldB.id, name: '王冠熔窟', type: '禁区',
    summary: '火雨遗留下来的地下熔窟。', description: '同盟禁止私自进入。',
    locationNote: '赤城关以北', nodeId: 'node-tmc', entranceNodeId: null,
    entryCondition: '需持有边境通行牌', danger: '地层仍不稳定', rewards: '失落王纹',
    availabilityNote: '开放状况由各领主公告', status: 'opening', customStatusLabel: '', notes: '',
  }
  const relation: WorldFactionRelation = {
    id: 'relation-fixture-a-b', worldId: worldA.id,
    fromFactionId: factionA.id, toFactionId: factionB.id,
    relation: 'hostile', customLabel: '', directed: false, note: '争夺旧灯塔下的航路税权。',
  }
  const portal: WorldPortal = {
    id: 'portal-fixture-a-b', name: '沉船湾裂隙', type: 'rift', customTypeLabel: '',
    fromWorldId: worldA.id, toWorldId: worldB.id, fromNodeId: 'node-qtc', toNodeId: 'node-tmc',
    bidirectional: false, condition: '退潮时点燃三座灯塔', cost: '一枚潮汐石', scheduleNote: '每月初三',
    status: 'unstable', customStatusLabel: '', description: '旧王朝战争后出现的裂隙。', notes: '',
  }
  backend.snapshot = {
    ...EMPTY_WORLD_SNAPSHOT,
    worlds: [worldA, worldB],
    factions: [factionA, factionB],
    factionRelations: [relation],
    relics: [relicA, relicB],
    portals: [portal],
    mapWorldLinks: [
      { mapId: MORTAL_MAP, worldId: worldA.id },
      { mapId: IMMORTAL_MAP, worldId: worldB.id },
    ],
    characterRefs: [{ id: 'char-1', name: '林尘', role: 'protagonist', locationText: '' }],
    characterLinks: [
      { id: 'world-char-a-1', worldId: worldA.id, characterId: 'char-1', relation: '灯塔见习生', note: '' },
      { id: 'world-char-a-2', worldId: worldA.id, characterId: 'char-1', relation: '失踪船员', note: '' },
      { id: 'world-char-b-1', worldId: worldB.id, characterId: 'char-1', relation: '流亡者', note: '' },
    ],
    eventWorlds: [
      { eventId: 'event-fixture-migration', worldId: worldA.id },
      { eventId: 'event-fixture-migration', worldId: worldA.id },
    ],
  }
  backend.maps.push({
    id: 'map-fixture-unassigned', name: '未归属草图', parentMapId: null,
    sortOrder: 3, image: null, worldId: null,
  })
  return { worldA, worldB }
}

/** 一个最小的「主进程」：只实现本测试真正用到的校验与副作用。 */
function stubApi(): void {
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
        const payload = args[0]
        switch (channel) {
          case 'db:world-get-all':
            return backend.snapshot
          case 'db:map-get-all':
            return { maps: backend.maps, nodes: backend.nodes, edges: [], migration: null }
          case 'db:timeline-get-all':
            return {
              settings: DEFAULT_TIMELINE_SETTINGS,
              branches: [{ id: STORY_TIMELINE_MAIN_BRANCH_ID, name: '主时间轴', sortOrder: 0 }],
              events: [{
                id: 'event-fixture-migration', branchId: STORY_TIMELINE_MAIN_BRANCH_ID,
                title: '灯塔迁徙之夜', timeLabel: '三百年前', sortOrder: 0, precision: 'unknown',
                description: '群岛居民沿着旧灯塔迁往北岸。', chapterNumbers: [],
                characterNames: ['林尘'], locationNodeIds: ['node-qtc'], status: 'finalized', isHistorical: true,
              }],
            }
          case 'db:world-upsert': {
            backend.writes.push({ channel, args })
            const incoming = payload as WorldRecord
            const name = incoming.name.trim()
            if (!name) return { success: false, error: '世界名称不能为空' }
            if (backend.snapshot.worlds.some(world => world.name.toLocaleLowerCase() === name.toLocaleLowerCase() && world.id !== incoming.id)) {
              return { success: false, error: `已存在同名世界「${name}」` }
            }
            const alreadyExists = backend.snapshot.worlds.some(world => world.id === incoming.id)
            const saved: WorldRecord = {
              ...incoming,
              id: incoming.id && incoming.id.startsWith('world-') ? incoming.id : `world-${nextId += 1}`,
            }
            backend.snapshot = {
              ...backend.snapshot,
              worlds: alreadyExists
                ? backend.snapshot.worlds.map(world => world.id === incoming.id ? saved : world)
                : [...backend.snapshot.worlds, saved],
            }
            return { success: true, world: saved }
          }
          case 'db:world-faction-upsert': {
            backend.writes.push({ channel, args })
            const incoming = payload as WorldFaction
            const name = incoming.name.trim()
            if (!name) return { success: false, error: '势力名称不能为空' }
            if (!worldOf(incoming.worldId)) return { success: false, error: '所属世界不存在或已删除' }
            const saved: WorldFaction = { ...incoming, id: incoming.id || `wfact-${nextId += 1}` }
            backend.snapshot = {
              ...backend.snapshot,
              factions: [...backend.snapshot.factions, saved],
            }
            return { success: true, faction: saved }
          }
          case 'db:world-relic-upsert': {
            backend.writes.push({ channel, args })
            const incoming = payload as Record<string, unknown> & { worldId: string; name: string }
            if (!incoming.name.trim()) return { success: false, error: '秘境名称不能为空' }
            if (!worldOf(incoming.worldId)) return { success: false, error: '所属世界不存在或已删除' }
            const saved = { ...incoming, id: String(incoming.id || `wrelic-${nextId += 1}`) }
            backend.snapshot = {
              ...backend.snapshot,
              relics: [...backend.snapshot.relics, saved as never],
            }
            return { success: true, relic: saved }
          }
          case 'db:world-faction-character-upsert': {
            backend.writes.push({ channel, args })
            const incoming = payload as { factionId: string; characterId: string; relation: string }
            backend.snapshot = {
              ...backend.snapshot,
              factionCharacters: [...backend.snapshot.factionCharacters, {
                id: `wfacch-${nextId += 1}`,
                factionId: incoming.factionId,
                characterId: incoming.characterId,
                relation: incoming.relation,
                tenureNote: '',
                note: '',
              }],
            }
            return { success: true }
          }
          case 'db:world-faction-place-upsert': {
            backend.writes.push({ channel, args })
            const incoming = payload as { factionId: string; nodeId: string }
            const node = backend.nodes.find(item => item.id === incoming.nodeId)
            const map = backend.maps.find(item => item.id === node?.mapId)
            const faction = backend.snapshot.factions.find(item => item.id === incoming.factionId)
            if (!node || !map || !faction) return { success: false, error: '势力地点不存在或已删除' }
            if (map.worldId !== faction.worldId) {
              return { success: false, error: `势力地点「${node.name}」不属于当前世界，已拒绝跨世界引用` }
            }
            backend.snapshot = {
              ...backend.snapshot,
              factionPlaces: [...backend.snapshot.factionPlaces, {
                id: `wfacpl-${nextId += 1}`, factionId: incoming.factionId, nodeId: incoming.nodeId, note: '',
              }],
            }
            return { success: true }
          }
          case 'db:world-character-link-upsert': {
            backend.writes.push({ channel, args })
            const incoming = payload as { worldId: string; characterId: string; relation: string }
            backend.snapshot = {
              ...backend.snapshot,
              characterLinks: [...backend.snapshot.characterLinks, {
                id: `wchlink-${nextId += 1}`,
                worldId: incoming.worldId,
                characterId: incoming.characterId,
                relation: incoming.relation,
                note: '',
              }],
            }
            return { success: true }
          }
          case 'db:world-character-location-birth-save': {
            backend.writes.push({ channel, args })
            const incoming = payload as WorldCharacterLocation
            backend.snapshot = {
              ...backend.snapshot,
              characterLocations: [...backend.snapshot.characterLocations, { ...incoming, id: `wchloc-${nextId += 1}` }],
            }
            return { success: true }
          }
          case 'db:world-map-assignment-plan': {
            backend.writes.push({ channel, args })
            const [mapId, nextWorldId] = args as [string, string | null]
            const map = backend.maps.find(item => item.id === mapId)
            if (!map) return { success: false, error: '要修改归属的地图不存在' }
            const mapIds = new Set(backend.maps.filter(item => item.id === mapId).map(item => item.id))
            const nodeIds = new Set(backend.nodes.filter(node => mapIds.has(node.mapId)).map(node => node.id))
            const blockers = backend.snapshot.factionPlaces
              .filter(place => nodeIds.has(place.nodeId))
              .map(place => {
                const faction = backend.snapshot.factions.find(item => item.id === place.factionId)
                return faction && faction.worldId !== nextWorldId
                  ? { kind: 'faction-place', label: `势力驻地 / 控制地点「${faction.name}」`, count: 1, ids: [place.id] }
                  : null
              })
              .filter((item): item is { kind: string; label: string; count: number; ids: string[] } => item !== null)
            return { success: true, plan: { mapId, nextWorldId, descendantMapIds: [], blockers } }
          }
          case 'db:world-map-assignment-apply': {
            backend.writes.push({ channel, args })
            const [mapId, nextWorldId] = args as [string, string | null]
            backend.maps = backend.maps.map(map => (map.id === mapId ? { ...map, worldId: nextWorldId } : map))
            backend.snapshot = {
              ...backend.snapshot,
              mapWorldLinks: nextWorldId
                ? [...backend.snapshot.mapWorldLinks.filter(link => link.mapId !== mapId), { mapId, worldId: nextWorldId }]
                : backend.snapshot.mapWorldLinks.filter(link => link.mapId !== mapId),
            }
            return { success: true }
          }
          case 'db:world-faction-delete-plan':
          case 'db:world-relic-delete-plan':
          case 'db:world-rule-delete-plan':
          case 'db:world-portal-delete-plan':
            return {
              success: true,
              plan: {
                entityKind: channel.replace('db:world-', '').replace('-delete-plan', ''),
                entityId: String(args[0]),
                entityName: '玄霄宗',
                blockers: [{ kind: '历史事件引用', label: '历史事件引用', count: 1, ids: ['evt-1'] }],
                cascadedRelationCount: 0,
                removedRowCount: 1,
              },
            }
          case 'db:world-trail-commit': {
            backend.writes.push({ channel, args })
            const request = payload as { trail: WorldCharacterTrail; alsoSetCurrentLocation: boolean }
            if (!request.trail.characterId) {
              return { success: false, error: '行踪人物未选择' }
            }
            const savedTrail: WorldCharacterTrail = { ...request.trail, id: request.trail.id || `wtrail-${nextId += 1}` }
            backend.snapshot = {
              ...backend.snapshot,
              trails: [...backend.snapshot.trails, savedTrail],
            }
            if (request.alsoSetCurrentLocation) {
              backend.snapshot = {
                ...backend.snapshot,
                characterLocationViews: [{
                  characterId: request.trail.characterId,
                  characterName: '林尘',
                  birth: null,
                  current: {
                    id: 'wchloc-current', characterId: request.trail.characterId, kind: 'current',
                    worldId: request.trail.worldId, nodeId: request.trail.nodeId, note: '',
                    storyTimeLabel: '', timePrecision: 'unknown', chapterNumber: null,
                    boundLocationText: '凡人界 · 青石村', boundProvenanceKind: 'author', boundAt: '2026-01-01T00:00:00.000Z',
                  },
                  currentState: 'bound',
                  locationText: '凡人界 · 青石村',
                  locationProvenanceKind: 'author',
                }],
              }
            }
            return { success: true, trail: savedTrail }
          }
          default:
            return { success: true }
        }
      }),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
    },
  })
}

async function render(): Promise<void> {
  await act(async () => root.render(<WorldWorkbenchView projectKey={PROJECT_PATH} />))
  await act(async () => { await Promise.resolve() })
}

/**
 * 关闭后的 Radix 对话框可能仍留在 DOM 里等待退出动画，因此任何查询都必须
 * 排除「已关闭」的对话框，否则会命中上一次打开时的陈旧元素。
 */
function isInsideClosedDialog(element: Element): boolean {
  return Boolean(element.closest('[role="dialog"][data-state="closed"]'))
}

function pageText(): string {
  return Array.from(document.body.querySelectorAll('[role="dialog"][data-state="open"], body > *:not([role="dialog"])'))
    .map(element => element.textContent ?? '')
    .join(' ')
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .filter(button => !isInsideClosedDialog(button))
    .find(
      button => button.title === label || button.getAttribute('aria-label') === label || button.textContent?.trim() === label,
    )
}

async function click(element: Element | undefined | null): Promise<void> {
  expect(element, '要点击的元素必须存在').toBeTruthy()
  await act(async () => {
    (element as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

/** 与既有浏览器测试同一套受控输入写法：绕过 value tracker 并派发原生 input 事件。 */
async function setInput(selector: string, value: string): Promise<void> {
  const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector))
    .find(candidate => !isInsideClosedDialog(candidate))
  expect(input, `输入框 ${selector} 必须存在`).toBeTruthy()
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function selectOption(selector: string, value: string): Promise<void> {
  const select = Array.from(document.querySelectorAll<HTMLSelectElement>(selector))
    .find(candidate => !isInsideClosedDialog(candidate))
  expect(select, `下拉框 ${selector} 必须存在`).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value)
    select?.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  backend = makeBackend()
  nextId = 0
  Object.defineProperty(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project, projectSessionEpoch: 1, fileTree: [], loading: false })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useWorldWorkbenchStore.getState().reset()
  useWorldMapStore.setState({
    maps: [], nodes: [], edges: [], candidates: [], migration: null,
    selectedMapId: null, selectedNodeId: null, selectedEdgeId: null, viewMode: 'canvas',
    focusNodeRequest: null, loading: false, candidatesLoading: false,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  stubApi()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useProjectStore.setState({ currentProject: null })
  useWorldWorkbenchStore.getState().reset()
  vi.restoreAllMocks()
  document.body.style.margin = ''
  await page.viewport(1280, 850)
})

describe('世界工作台', () => {
  it('starts empty and selects a newly created world on its introduction section', async () => {
    await render()
    expect(container.querySelector('h1')?.textContent).toBe('世界管理')
    expect(container.querySelector('nav[aria-label="返回路径"]')?.textContent)
      .toContain('故事设定')
    expect(container.textContent).toContain('还没有任何世界')

    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await setInput('#world-field-summary', '灵气稀薄的凡俗世界')
    await click(findButton('创建'))

    expect(backend.snapshot.worlds.map(world => world.name)).toEqual(['凡人界'])
    expect(container.textContent).toContain('凡人界')
    expect(container.textContent).toContain('灵气稀薄的凡俗世界')

    await act(async () => { useWorldWorkbenchStore.getState().setSection('factions') })
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '修真界')
    await click(findButton('创建'))
    expect(useWorldWorkbenchStore.getState().selectedWorldId).toBe(backend.snapshot.worlds[1].id)
    expect(useWorldWorkbenchStore.getState().section).toBe('overview')
  })

  it('keeps each world’s records separate when switching worlds', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '修真界')
    await click(findButton('创建'))
    expect(backend.snapshot.worlds).toHaveLength(2)

    // 在凡人界创建势力。
    const mortalId = backend.snapshot.worlds[0].id
    const immortalId = backend.snapshot.worlds[1].id
    await act(async () => { useWorldWorkbenchStore.getState().setSelectedWorldId(mortalId) })
    await act(async () => { useWorldWorkbenchStore.getState().setSection('factions') })
    await click(findButton('新建势力'))
    await setInput('#world-field-name', '青云门')
    await click(findButton('保存'))
    expect(backend.snapshot.factions.map(faction => faction.name)).toEqual(['青云门'])
    expect(container.textContent).toContain('青云门')

    // 切到修真界：不应看到凡人界的势力。
    await act(async () => {
      useWorldWorkbenchStore.getState().setSelectedWorldId(immortalId)
      useWorldWorkbenchStore.getState().setSection('factions')
    })
    expect(container.textContent).not.toContain('青云门')

    const faction = backend.snapshot.factions.find(item => item.name === '青云门')
    expect(faction?.worldId).toBe(mortalId)
  })

  it('integrates the two-world fixture, preserves stable links, and captures the four review pages', async () => {
    const { worldA, worldB } = seedTwoWorldFixture()
    const oldBodyMargin = document.body.style.margin
    document.body.style.margin = '0'
    container.style.width = '100vw'
    container.style.height = '100vh'
    await page.viewport(1360, 900)
    await render()

    expect(useWorldWorkbenchStore.getState().selectedWorldId).toBe(worldA.id)
    expect(useWorldWorkbenchStore.getState().section).toBe('overview')
    expect(container.textContent).toContain('潮汐决定航路')
    expect(container.textContent).toContain('雾海环绕着七座群岛')
    expect(container.textContent).toContain('灯塔迁徙之夜')
    expect(container.querySelector('[aria-label="进入相关人物分区"]')?.textContent).toContain('1 项')
    expect(container.querySelector('[aria-label="进入历史事件分区"]')?.textContent).toContain('1 项')
    expect(container.textContent).not.toContain('未归属草图')
    await page.screenshot({ path: '../../../../screenshots/world-management-introduction.png' })

    await click(container.querySelector('[data-testid="world-section-factions"]'))
    expect(container.querySelector('[data-testid="world-faction-faction-fixture-a"]')).toBeTruthy()
    expect(container.textContent).not.toContain('赤烬同盟 · 诸侯联盟')
    expect(container.textContent).toContain('赤烬同盟（烬原王朝）')
    const crossWorldTarget = container.querySelector<HTMLSelectElement>('select[aria-label="选择对端势力"]')
    expect(Array.from(crossWorldTarget?.options ?? []).map(option => option.textContent)).toContain('赤烬同盟（烬原王朝）')
    await page.screenshot({ path: '../../../../screenshots/world-management-factions.png' })

    await click(container.querySelector('[data-testid="world-section-relics"]'))
    expect(container.querySelector('[data-testid="world-relic-relic-fixture-a"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="world-relic-relic-fixture-b"]')).toBeNull()
    await page.screenshot({ path: '../../../../screenshots/world-management-relics.png' })

    await click(container.querySelector('[data-testid="world-navigation-item-world-fixture-b"]'))
    expect(useWorldWorkbenchStore.getState().selectedWorldId).toBe(worldB.id)
    expect(useWorldWorkbenchStore.getState().section).toBe('overview')
    expect(container.textContent).toContain('烬原在三百年前的火雨后分裂')
    expect(container.textContent).not.toContain('雾海环绕着七座群岛')
    await click(container.querySelector('[data-testid="world-section-portals"]'))
    const inboundPortal = container.querySelector('[data-testid="world-connection-portal-fixture-a-b"]')
    expect(inboundPortal?.textContent).toContain('雾海诸境')
    expect(inboundPortal?.textContent).toContain('烬原王朝')
    expect(inboundPortal?.textContent).toContain('沉船湾裂隙')
    expect(inboundPortal?.textContent).toContain('退潮时点燃三座灯塔')
    expect(container.querySelectorAll('[data-testid="world-connection-portal-fixture-a-b"]')).toHaveLength(1)
    await page.screenshot({ path: '../../../../screenshots/world-management-cross-world-links.png' })
    await page.viewport(620, 900)
    const narrowNavigation = container.querySelector<HTMLElement>('[data-testid="world-navigation"]')!.getBoundingClientRect()
    const narrowMain = container.querySelector<HTMLElement>('.planning-page__main')!.getBoundingClientRect()
    expect(narrowNavigation.y).toBeLessThan(narrowMain.y)
    expect(narrowNavigation.x).toBeCloseTo(narrowMain.x, 0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(620)
    await page.screenshot({ path: '../../../../screenshots/world-management-narrow.png' })
    await page.viewport(1360, 900)
    container.classList.add('dark')
    expect(getComputedStyle(container).getPropertyValue('--color-bg').trim()).toBe('#1E1E1E')
    await page.screenshot({ path: '../../../../screenshots/world-management-cross-world-links-dark.png' })
    container.classList.remove('dark')

    // A 在目标端也看到同一条通道。直接新建仍回到 A 的介绍，并把表单 worldId 固定为 A。
    await click(container.querySelector('[data-testid="world-navigation-item-world-fixture-a"]'))
    await click(findButton('添加秘境'))
    expect(pageText()).toContain(`所属世界：${worldA.name}`)
    await setInput('#world-field-name', '新建的潮汐密室')
    await click(findButton('保存'))
    const savedRelic = backend.snapshot.relics.find(relic => relic.name === '新建的潮汐密室')
    expect(savedRelic?.worldId).toBe(worldA.id)

    // 编辑完整背景后重新读回：名称 ID、未编辑字段和关联表都保留。
    await click(container.querySelector('[data-testid="world-section-overview"]'))
    await click(findButton('编辑世界介绍'))
    await setInput('#world-introduction-background', '雾海新的背景段落。')
    await click(findButton('保存介绍'))
    const savedWorld = backend.snapshot.worlds.find(world => world.id === worldA.id)
    expect(savedWorld).toMatchObject({
      id: worldA.id,
      name: worldA.name,
      summary: worldA.summary,
      notes: worldA.notes,
      background: '雾海新的背景段落。',
    })
    expect(backend.snapshot.factionRelations).toHaveLength(1)
    expect(backend.snapshot.characterLinks.filter(link => link.worldId === worldA.id)).toHaveLength(2)

    // 草稿期间切换世界必须先明确确认；取消保留原草稿，确认后不向 B 串写。
    await click(container.querySelector('[data-testid="world-section-factions"]'))
    await click(findButton('新建势力'))
    await setInput('#world-field-name', '尚未保存的雾海势力')
    await click(container.querySelector('[data-testid="world-navigation-item-world-fixture-b"]'))
    expect(document.querySelector('.vela-feedback-overlay .vela-feedback-panel')?.textContent).toContain('还有未保存内容')
    const guardButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.vela-feedback-overlay .vela-feedback-panel button'))
    await click(guardButtons().find(button => button.textContent?.trim() === '取消'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)) })
    expect(useWorldWorkbenchStore.getState().selectedWorldId).toBe(worldA.id)
    expect((document.querySelector('#world-field-name') as HTMLInputElement | null)?.value).toBe('尚未保存的雾海势力')
    await click(container.querySelector('[data-testid="world-navigation-item-world-fixture-b"]'))
    await click(guardButtons().find(button => button.textContent?.trim() === '放弃并离开'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)) })
    expect(useWorldWorkbenchStore.getState().selectedWorldId).toBe(worldB.id)
    expect(backend.snapshot.factions.some(faction => faction.name === '尚未保存的雾海势力')).toBe(false)

    container.style.width = ''
    container.style.height = ''
    document.body.style.margin = oldBodyMargin
    await page.viewport(1280, 850)
  })

  it('links the static and current locations of a character through the world', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))
    const worldId = backend.snapshot.worlds[0].id

    await act(async () => { useWorldWorkbenchStore.getState().setSection('characters') })
    // 关联已有角色。
    await selectOption('select[aria-label="选择项目角色"]', 'char-1')
    await click(findButton('关联'))
    expect(backend.snapshot.characterLinks).toHaveLength(1)
    expect(backend.snapshot.characterLinks[0]).toMatchObject({ worldId, characterId: 'char-1' })
    expect(container.textContent).toContain('林尘')

    // 出生地：点该人物行里的「编辑」，而不是世界标题上的编辑。
    const memberRow = container.querySelector('[data-testid^="world-character-"]')
    const memberEdit = Array.from(memberRow?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.trim() === '编辑')
    await click(memberEdit)
    await setInput('#world-field-note', '村中老屋')
    await click(findButton('保存'))
    const birth = backend.snapshot.characterLocations.find(item => item.kind === 'birth')
    expect(birth).toMatchObject({ worldId, note: '村中老屋' })
  })

  it('records a trail without changing the current location unless explicitly asked', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))

    await act(async () => { useWorldWorkbenchStore.getState().setSection('trails') })
    await click(findButton('补录行踪'))
    await setInput('#world-field-arrivedLabel', '大荒历 300 年')
    await setInput('#world-field-reason', '随师下山')
    // 人物选择：默认取第一个角色。
    await click(findButton('保存'))

    const trailWrite = backend.writes.find(entry => entry.channel === 'db:world-trail-commit')
    expect(trailWrite, '必须通过 db:world-trail-commit 保存行踪').toBeTruthy()
    const request = trailWrite?.args[0] as { trail: { arrivedLabel: string; reason: string }; alsoSetCurrentLocation: boolean }
    expect(request.trail.arrivedLabel).toBe('大荒历 300 年')
    expect(request.trail.reason).toBe('随师下山')
    // 默认不改变目前所在地。
    expect(request.alsoSetCurrentLocation).toBe(false)
    expect(backend.snapshot.characterLocationViews).toEqual([])
  })

  it('shows the reference list and refuses to delete a referenced entity', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))
    const worldId = backend.snapshot.worlds[0].id
    await act(async () => {
      useWorldWorkbenchStore.getState().setSection('factions')
      await useWorldWorkbenchStore.getState().saveFaction({
        worldId, name: '玄霄宗', type: '宗门', summary: '', description: '', seat: '', domainNote: '', notes: '',
      }, PROJECT_PATH)
    })
    await act(async () => { await Promise.resolve() })

    const deleteButton = container.querySelector<HTMLButtonElement>('button[title="删除势力"]')
    await click(deleteButton)
    expect(pageText()).toContain('删除影响预览')
    expect(pageText()).toContain('历史事件引用')
    // blockers 非空时确认按钮被禁用，且没有任何删除请求被发出。
    const confirm = findButton('确认删除')
    expect((confirm as HTMLButtonElement | undefined)?.disabled).toBe(true)
    expect(backend.writes.some(entry => entry.channel === 'db:world-faction-delete')).toBe(false)
  })

  it('blocks a map assignment that would make world records inconsistent', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))
    const mortalId = backend.snapshot.worlds[0].id

    // 把凡人界总图关联到这个世界。
    await act(async () => { useWorldWorkbenchStore.getState().setSection('maps') })
    await click(findButton('关联到世界'))
    await click(findButton('确认变更'))
    expect(backend.maps.find(map => map.id === MORTAL_MAP)?.worldId).toBe(mortalId)

    // 势力控制青石村（属于凡人界总图）。
    await act(async () => {
      await useWorldWorkbenchStore.getState().saveFaction({
        worldId: mortalId, name: '青云门', type: '宗门', summary: '', description: '', seat: '', domainNote: '', notes: '',
      }, PROJECT_PATH)
      const faction = useWorldWorkbenchStore.getState().data.factions[0]
      await useWorldWorkbenchStore.getState().saveFactionPlace({ id: '', factionId: faction.id, nodeId: 'node-qtc', note: '' }, PROJECT_PATH)
    })
    await act(async () => { await Promise.resolve() })

    // 解除关联：势力驻地仍引用这张地图的地点，预览必须拦下。
    await click(findButton('解除关联'))
    await click(findButton('确认变更'))
    expect(pageText()).toContain('地图归属变更预览')
    expect(pageText()).toContain('已拒绝修改')
    const apply = findButton('确认变更')
    expect((apply as HTMLButtonElement | undefined)?.disabled).toBe(true)
  })

  it('jumps to the atlas at the exact map and place', async () => {
    await render()
    const worldId = await act(async () => {
      const saved = await useWorldWorkbenchStore.getState().saveWorld({ name: '凡人界' }, PROJECT_PATH)
      return saved?.id ?? ''
    })
    await act(async () => {
      await useWorldWorkbenchStore.getState().applyMapAssignment(MORTAL_MAP, worldId, PROJECT_PATH)
      await useWorldWorkbenchStore.getState().saveRelic({
        worldId,
        name: '古剑秘境',
        type: '秘境',
        summary: '',
        description: '',
        locationNote: '',
        nodeId: 'node-qtc',
        entranceNodeId: 'node-qtc',
        entryCondition: '',
        danger: '',
        rewards: '',
        availabilityNote: '',
        status: 'sealed',
        customStatusLabel: '',
        notes: '',
      }, PROJECT_PATH)
    })
    await act(async () => { useWorldWorkbenchStore.getState().setSection('relics') })
    await act(async () => { await Promise.resolve() })

    const jump = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === '青石村')
    await click(jump)

    // 跳转必须同时选中正确的地图与地点，并切到画布视图。
    const mapState = useWorldMapStore.getState()
    expect(mapState.selectedMapId).toBe(MORTAL_MAP)
    expect(mapState.selectedNodeId).toBe('node-qtc')
    expect(mapState.viewMode).toBe('canvas')
    expect(mapState.focusNodeRequest?.nodeId).toBe('node-qtc')
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'world-map')).toBe(true)
  })

  it('renders English copy without Han characters when the UI locale is en-US', async () => {
    useLocaleStore.setState({ locale: 'en-US', initialized: true })
    await render()
    expect(container.textContent).toContain('World Management')
    expect(container.textContent).toContain('New world')

    await click(findButton('New world'))
    await setInput('#world-field-name', 'Mortal realm')
    await click(findButton('Create'))
    expect(backend.snapshot.worlds.map(world => world.name)).toEqual(['Mortal realm'])

    // 新界面里的可见文案必须全部走 text()，因此英文界面不应残留中文。
    const han = /[\u4e00-\u9fff]/
    const visible = [container.textContent ?? '', pageText()].join(' ')
    expect(han.test(visible), `英文界面不应出现中文：${visible.slice(0, 200)}`).toBe(false)
  })

  it('states the missing-map state for a world that has no map at all', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))

    await act(async () => { useWorldWorkbenchStore.getState().setSection('maps') })
    // 没有地图时也要能继续录入资料：这里明确说明如何关联地图，而不是空白。
    expect(container.textContent).toContain('这个世界还没有地图')
    expect(container.textContent).toContain('未关联世界')

    await act(async () => { useWorldWorkbenchStore.getState().setSection('factions') })
    await click(findButton('新建势力'))
    await setInput('#world-field-name', '青云门')
    await click(findButton('保存'))
    // 没有地图不影响势力录入。
    expect(backend.snapshot.factions.map(faction => faction.name)).toEqual(['青云门'])
  })

  it('surfaces a real write failure without pretending it succeeded', async () => {
    await render()
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))
    const before = backend.snapshot.worlds.length

    // 同名世界：主进程拒绝，界面必须保留在表单里而不是显示成功。
    await click(findButton('新建世界'))
    await setInput('#world-field-name', '凡人界')
    await click(findButton('创建'))
    await act(async () => { await Promise.resolve() })

    expect(backend.snapshot.worlds).toHaveLength(before)
    expect(useWorldWorkbenchStore.getState().lastError).toContain('已存在同名世界')
  })
})
