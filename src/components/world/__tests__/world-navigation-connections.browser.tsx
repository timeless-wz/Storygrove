import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorldPortal, WorldRecord } from '../../../shared/world-workbench'
import { useLocaleStore } from '../../../stores/locale-store'
import WorldConnectionsSection from '../WorldConnectionsSection'
import WorldNavigationPanel from '../WorldNavigationPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const currentWorld = world('world-current', '霜海界', '北境群岛与雾海航路')
const otherWorld = world('world-other', '烬原界', '流亡王朝与赤色荒原')

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(node: ReactNode): Promise<void> {
  await act(async () => root.render(node))
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy()
  await act(async () => (element as HTMLElement).click())
}

async function setSearch(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('[data-testid="world-navigation-search"]')
  expect(input).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('WorldNavigationPanel', () => {
  it('searches name and summary, truncates long labels with a full-name title, and keeps search across collapse', async () => {
    const longName = `霜海界${'北境航路'.repeat(14)}`
    const longWorld = world('world-long', longName, '北境群岛的旧航线')
    const selectedWorld = world('world-selected', '烬原界', '流亡王朝与赤色荒原')
    const onSelect = vi.fn()
    const onRetry = vi.fn()

    await render(
      <WorldNavigationPanel
        worlds={[longWorld, selectedWorld]}
        selectedWorldId={selectedWorld.id}
        loading={false}
        loadError={null}
        onSelect={onSelect}
        onRetry={onRetry}
      />,
    )

    const longItem = container.querySelector<HTMLButtonElement>('[data-testid="world-navigation-item-world-long"]')
    const selectedItem = container.querySelector<HTMLButtonElement>('[data-testid="world-navigation-item-world-selected"]')
    expect(longItem?.textContent).toContain(longName)
    expect(longItem?.title).toBe(longName)
    expect(longItem?.querySelector('span')?.className).toContain('truncate')
    expect(longItem?.querySelector('span')?.getAttribute('title')).toBe(longName)
    expect(selectedItem?.getAttribute('aria-pressed')).toBe('true')

    await setSearch('流亡王朝')
    expect(container.querySelector('[data-testid="world-navigation-item-world-selected"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="world-navigation-item-world-long"]')).toBeNull()
    await click(container.querySelector('[data-testid="world-navigation-item-world-selected"]'))
    expect(onSelect).toHaveBeenCalledWith(selectedWorld.id)

    await click(container.querySelector('[data-testid="world-navigation-collapse"]'))
    expect(container.querySelector('[data-testid="world-navigation-search"]')).toBeNull()
    const reopen = container.querySelector<HTMLButtonElement>('[data-testid="world-navigation-expand"]')
    expect(reopen?.getAttribute('aria-expanded')).toBe('false')
    expect(reopen?.getAttribute('aria-label')).toBe('展开世界导航')
    expect(reopen?.type).toBe('button')
    expect(document.getElementById(reopen?.getAttribute('aria-controls') ?? '')).toBeTruthy()

    await click(reopen)
    expect(container.querySelector<HTMLInputElement>('[data-testid="world-navigation-search"]')?.value).toBe('流亡王朝')
    expect(container.querySelector('[data-testid="world-navigation-item-world-selected"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="world-navigation-item-world-long"]')).toBeNull()
  })

  it('shows separate loading, load-error, empty, and no-match states', async () => {
    const onRetry = vi.fn()
    const text = useLocaleStore.getState().text
    const base = {
      selectedWorldId: null,
      onSelect: vi.fn(),
      onRetry,
    }
    await render(<WorldNavigationPanel {...base} worlds={[]} loading loadError={null} />)
    expect(container.textContent).toContain('正在加载世界')

    await render(<WorldNavigationPanel {...base} worlds={[]} loading={false} loadError={text('数据库暂不可用', 'Database is temporarily unavailable')} />)
    expect(container.textContent).toContain('世界加载失败')
    expect(container.textContent).toContain('数据库暂不可用')
    await click(container.querySelector('[data-testid="world-navigation-retry"]'))
    expect(onRetry).toHaveBeenCalledTimes(1)

    await render(<WorldNavigationPanel {...base} worlds={[]} loading={false} loadError={null} />)
    expect(container.textContent).toContain('还没有创建世界')

    await render(<WorldNavigationPanel {...base} worlds={[currentWorld]} loading={false} loadError={null} />)
    await setSearch('不存在的世界')
    expect(container.textContent).toContain('没有匹配的世界')
  })
})

describe('WorldConnectionsSection', () => {
  it('shows inbound and outbound portals once, with explicit endpoints, direction, and relation slots', async () => {
    const outbound = portal({
      id: 'portal-out', name: '霜海渡门', fromWorldId: currentWorld.id, fromNodeId: 'node-harbor',
      toWorldId: otherWorld.id, toNodeId: 'node-ember', condition: '潮汐转弱时', cost: '一枚潮汐石',
      scheduleNote: '每月初三', description: '沉船湾底的古门。',
    })
    const inbound = portal({
      id: 'portal-in', name: '归烬裂隙', fromWorldId: otherWorld.id, fromNodeId: 'node-ember',
      toWorldId: currentWorld.id, toNodeId: 'node-harbor', bidirectional: true,
    })
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const onOpenMapAt = vi.fn()
    const text = useLocaleStore.getState().text
    const renderRelations = vi.fn((item: WorldPortal) => <span>{text('关联：', 'Relation: ')}{item.id}</span>)

    await render(
      <WorldConnectionsSection
        worldId={currentWorld.id}
        worlds={[currentWorld, otherWorld]}
        portals={[outbound, inbound, { ...outbound }]}
        nodes={[
          { id: 'node-harbor', name: '沉船湾', mapId: 'map-frost' },
          { id: 'node-ember', name: '赤城关', mapId: 'map-ember' },
        ]}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpenMapAt={onOpenMapAt}
        renderRelations={renderRelations}
      />,
    )

    expect(container.querySelectorAll('li[data-testid^="world-connection-portal-"]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="world-connection-portal-out"]')?.textContent).toContain('来源世界 / 入口')
    expect(container.querySelector('[data-testid="world-connection-portal-out"]')?.textContent).toContain('目标世界 / 出口')
    expect(container.querySelector('[data-testid="world-connection-portal-out"]')?.textContent).toContain('沉船湾')
    expect(container.querySelector('[data-testid="world-connection-portal-out"]')?.textContent).toContain('赤城关')
    expect(container.querySelector('[data-testid="world-connection-direction-portal-out"]')?.textContent).toContain('单向：来源 → 目标')
    expect(container.querySelector('[data-testid="world-connection-direction-portal-in"]')?.textContent).toContain('双向：来源 ↔ 目标')
    for (const detail of ['潮汐转弱时', '一枚潮汐石', '每月初三', '沉船湾底的古门。']) {
      expect(container.textContent).toContain(detail)
    }
    expect(renderRelations).toHaveBeenCalledWith(outbound)
    expect(container.textContent).toContain('关联：portal-in')

    await click(container.querySelector('button[aria-label="打开地图地点：沉船湾"]'))
    expect(onOpenMapAt).toHaveBeenCalledWith('map-frost', 'node-harbor')

    await click(container.querySelector('[data-testid="world-connection-edit-portal-in"]'))
    await click(container.querySelector('[data-testid="world-connection-delete-portal-out"]'))
    expect(onEdit).toHaveBeenCalledWith(inbound.id)
    expect(onDelete).toHaveBeenCalledWith(outbound.id)
  })

  it('labels missing world and place references instead of presenting IDs as names', async () => {
    const broken = portal({
      id: 'portal-broken', name: '断裂通路', fromWorldId: currentWorld.id, fromNodeId: 'node-existing',
      toWorldId: 'world-missing', toNodeId: 'node-missing', status: 'unstable',
    })
    await render(
      <WorldConnectionsSection
        worldId={currentWorld.id}
        worlds={[currentWorld]}
        portals={[broken]}
        nodes={[{ id: 'node-existing', name: '旧港口', mapId: 'map-current' }]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onOpenMapAt={vi.fn()}
      />,
    )

    const card = container.querySelector('[data-testid="world-connection-portal-broken"]')
    expect(card?.textContent).toContain('缺少世界引用（world-missing）')
    expect(card?.textContent).toContain('缺少地点引用（node-missing）')
    expect(card?.textContent).toContain('不稳定')
    expect(card?.textContent).not.toContain('赤城界')
  })

  it('deduplicates by stable portal ID and ignores portals that touch neither endpoint', async () => {
    const linked = portal({ id: 'portal-shared', fromWorldId: currentWorld.id, toWorldId: otherWorld.id })
    const unrelated = portal({ id: 'portal-unrelated', fromWorldId: 'world-third', toWorldId: 'world-fourth' })
    await render(
      <WorldConnectionsSection
        worldId={currentWorld.id}
        worlds={[currentWorld, otherWorld]}
        portals={[linked, { ...linked, name: '重复副本' }, unrelated]}
        nodes={[]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onOpenMapAt={vi.fn()}
      />,
    )

    expect(container.querySelectorAll('[data-testid^="world-connection-portal-"]')).toHaveLength(1)
    expect(container.textContent).toContain('稳定通道')
    expect(container.textContent).not.toContain('重复副本')
    expect(container.textContent).not.toContain('其他通道')
  })

  it('shows an explicit empty state when no supplied portal touches the selected world', async () => {
    await render(
      <WorldConnectionsSection
        worldId={currentWorld.id}
        worlds={[currentWorld, otherWorld]}
        portals={[portal({ fromWorldId: otherWorld.id, toWorldId: 'world-third' })]}
        nodes={[]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onOpenMapAt={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-testid="world-connections-empty"]')?.textContent).toContain('还没有关联通道')
  })
})

function world(id: string, name: string, summary: string): WorldRecord {
  return { id, name, summary, background: '', notes: '', sortOrder: 0 }
}

function portal(overrides: Partial<WorldPortal> = {}): WorldPortal {
  return {
    id: 'portal-default', name: '稳定通道', type: 'rift', customTypeLabel: '',
    fromWorldId: currentWorld.id, toWorldId: otherWorld.id, fromNodeId: null, toNodeId: null,
    bidirectional: false, condition: '', cost: '', scheduleNote: '', status: 'active',
    customStatusLabel: '', description: '', notes: '',
    ...overrides,
  }
}
