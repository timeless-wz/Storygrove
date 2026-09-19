import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest'
import { page } from 'vitest/browser'

import RelationshipGraph, { type RelationshipGraphCharacter } from '../RelationshipGraph'
import { useCharacterStore } from '../../../stores/character-store'
import { useLocaleStore } from '../../../stores/locale-store'
import type { CharacterSharedRelationship } from '../../../shared/character-relationship'

const PROJECT_KEY = 'C:\\fiction\\relationship-canvas'
const SHEN_ID = 'id-shen'
const XU_ID = 'id-xu'
const LIN_ID = 'id-lin'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHARACTERS: RelationshipGraphCharacter[] = [
  { id: SHEN_ID, name: '沈砚', role: 'protagonist' },
  { id: XU_ID, name: '许渡', role: 'supporting' },
  { id: LIN_ID, name: '林晚', role: 'supporting' },
]

function sharedRelationship(
  overrides: Partial<CharacterSharedRelationship> = {},
): CharacterSharedRelationship {
  return {
    id: 'rel-1',
    character1Id: SHEN_ID,
    character2Id: XU_ID,
    character1Name: '沈砚',
    character2Name: '许渡',
    relation: '师徒',
    description: '自幼抚养',
    ...overrides,
  }
}

type UpsertInput = {
  id?: string
  character1Id: string
  character2Id: string
  relation: string
  description?: string
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let upsertRelationship: MockedFunction<(data: UpsertInput) => Promise<CharacterSharedRelationship | null>>
let deleteRelationship: MockedFunction<(id: string) => Promise<boolean>>
let saveGraphPositions: MockedFunction<
  (positions: Record<string, { x: number; y: number }>) => Promise<void>
>

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  upsertRelationship = vi.fn(async () => sharedRelationship())
  deleteRelationship = vi.fn(async () => true)
  saveGraphPositions = vi.fn(async () => {})
  useCharacterStore.setState({
    characterIdentities: { 沈砚: SHEN_ID, 许渡: XU_ID, 林晚: LIN_ID },
    relationships: [sharedRelationship()],
    graphPositions: {
      [SHEN_ID]: { x: 120, y: 90 },
      [XU_ID]: { x: 420, y: 90 },
      [LIN_ID]: { x: 260, y: 320 },
    },
    upsertRelationship,
    deleteRelationship,
    saveGraphPositions,
  })
  container = document.createElement('div')
  container.style.width = '900px'
  container.style.height = '600px'
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (root) {
    await act(async () => { root?.unmount() })
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
})

async function renderGraph(
  options: { onCharacterSelect?: (name: string) => void; expectEdges?: number } = {},
): Promise<void> {
  await act(async () => {
    root?.render(
      <RelationshipGraph
        characters={CHARACTERS}
        projectKey={PROJECT_KEY}
        onCharacterSelect={options.onCharacterSelect}
      />,
    )
  })
  await vi.waitFor(() => {
    expect(container?.querySelectorAll('[data-testid="relationship-graph-node"]').length).toBe(3)
  })
  const expectedEdges = options.expectEdges ?? 1
  if (expectedEdges > 0) {
    await vi.waitFor(() => {
      expect(container?.querySelectorAll('[data-testid="relationship-edge-chip"]').length).toBe(expectedEdges)
    })
  }
}

function nodeOf(characterId: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-character-id="${characterId}"]`) ?? null
}

async function click(element: Element | null): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * 模拟真实拖拽：React Flow 的拖拽基于 d3-drag，会监听节点上的 mousedown，
 * 再到 window 上跟随 mousemove / mouseup。
 */
function dragNode(node: HTMLElement, dx: number, dy: number): void {
  const rect = node.getBoundingClientRect()
  const startX = rect.left + rect.width / 2
  const startY = rect.top + rect.height / 2
  // d3-drag 通过 event.view 挂载后续监听，合成事件必须带上 view: window。
  node.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, view: window, clientX: startX, clientY: startY, buttons: 1,
  }))
  window.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, view: window, clientX: startX + dx / 2, clientY: startY + dy / 2, buttons: 1,
  }))
  window.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, view: window, clientX: startX + dx, clientY: startY + dy, buttons: 1,
  }))
  window.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true, view: window, clientX: startX + dx, clientY: startY + dy,
  }))
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('relationship canvas', () => {
  it('renders circular nodes identified by stable character ID', async () => {
    await renderGraph()

    const shenNode = nodeOf(SHEN_ID)
    expect(shenNode).toBeTruthy()
    expect(shenNode?.textContent).toContain('沈砚')
    expect(shenNode?.textContent).toContain('主角')
    expect(shenNode?.querySelector('.rounded-full')).toBeTruthy()

    expect(nodeOf(XU_ID)?.textContent).toContain('许渡')
    expect(nodeOf(LIN_ID)?.textContent).toContain('林晚')
  })

  it('draws one labelled line per shared relationship', async () => {
    await renderGraph()

    const chips = Array.from(container?.querySelectorAll('[data-testid="relationship-edge-chip"]') ?? [])
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toContain('师徒')
    expect(container?.textContent).toContain('1 条关系')
  })

  it('opens the existing relationship for editing instead of adding a duplicate line', async () => {
    await renderGraph()

    await click(container?.querySelector('[data-testid="relationship-edge-chip"]') ?? null)

    await expect.element(page.getByTestId('relationship-modal')).toBeVisible()
    expect(document.body.textContent).toContain('编辑人物关系')
    expect(document.body.textContent).toContain('沈砚 ↔ 许渡')
    expect((page.getByTestId('relationship-name-input').element() as HTMLInputElement).value).toBe('师徒')

    await act(async () => {
      page.getByTestId('relationship-save-button').element()
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(upsertRelationship).toHaveBeenCalledWith({
      id: 'rel-1',
      character1Id: SHEN_ID,
      character2Id: XU_ID,
      relation: '师徒',
      description: '自幼抚养',
    })
  })

  it('connects two nodes with the character IDs', async () => {
    await renderGraph()

    await click(container?.querySelector('[data-testid="relationship-connect-mode-button"]') ?? null)
    expect(document.body.textContent).toContain('连线模式：请先点击第一个人物节点')

    await click(nodeOf(LIN_ID))
    expect(document.body.textContent).toContain('已选「林晚」')

    await click(nodeOf(SHEN_ID))
    await expect.element(page.getByTestId('relationship-modal')).toBeVisible()
    expect(document.body.textContent).toContain('建立人物关系')
    expect(document.body.textContent).toContain('林晚 ↔ 沈砚')

    await act(async () => {
      setInputValue(page.getByTestId('relationship-name-input').element() as HTMLInputElement, '同门')
    })
    await act(async () => {
      page.getByTestId('relationship-save-button').element()
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(upsertRelationship).toHaveBeenCalledWith({
      id: undefined,
      character1Id: LIN_ID,
      character2Id: SHEN_ID,
      relation: '同门',
      description: '',
    })
  })

  it('opens the existing relationship when the same pair is connected twice', async () => {
    await renderGraph()

    await click(container?.querySelector('[data-testid="relationship-connect-mode-button"]') ?? null)
    await click(nodeOf(SHEN_ID))
    await click(nodeOf(XU_ID))

    await expect.element(page.getByTestId('relationship-modal')).toBeVisible()
    // 同一对人物只有一条关系：再次连线打开已有关系编辑。
    expect(document.body.textContent).toContain('编辑人物关系')
    expect((page.getByTestId('relationship-name-input').element() as HTMLInputElement).value).toBe('师徒')
  })

  it('persists a dragged node position under the character ID', async () => {
    await renderGraph()

    const shenNode = nodeOf(SHEN_ID)
    expect(shenNode).toBeTruthy()

    await act(async () => {
      dragNode(shenNode!, 80, 60)
      await new Promise(resolve => setTimeout(resolve, 40))
    })

    expect(saveGraphPositions).toHaveBeenCalled()
    const saved = saveGraphPositions.mock.calls.at(-1)?.[0] as Record<string, { x: number; y: number }>
    expect(Object.keys(saved)).toContain(SHEN_ID)
    expect(Object.keys(saved)).not.toContain('沈砚')
  })

  it('keeps a not yet persisted character visible but refuses to connect it', async () => {
    await act(async () => {
      root?.render(
        <RelationshipGraph
          characters={[...CHARACTERS, { id: '', name: '初稿角色', role: 'supporting' }]}
          projectKey={PROJECT_KEY}
        />,
      )
    })
    await vi.waitFor(() => {
      expect(container?.querySelectorAll('[data-testid="relationship-graph-node"]').length).toBe(4)
    })

    await click(container?.querySelector('[data-testid="relationship-connect-mode-button"]') ?? null)
    const pendingNode = Array.from(
      container?.querySelectorAll<HTMLElement>('[data-testid="relationship-graph-node"]') ?? [],
    ).find(node => node.dataset.characterName === '初稿角色')
    await click(pendingNode ?? null)

    await expect.element(page.getByTestId('relationship-connect-notice')).toBeVisible()
    expect(document.body.textContent).toContain('该角色尚未保存')
    expect(upsertRelationship).not.toHaveBeenCalled()
  })

  it('opens the character card from the node and from the node context menu', async () => {
    const onCharacterSelect = vi.fn()
    await renderGraph({ onCharacterSelect })

    await click(nodeOf(XU_ID))
    expect(onCharacterSelect).toHaveBeenCalledWith('许渡')

    await act(async () => {
      nodeOf(LIN_ID)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 150, clientY: 150 }))
    })
    expect(document.body.textContent).toContain('建立关系')
    expect(document.body.textContent).toContain('打开人物卡')

    const openCard = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.includes('打开人物卡'))
    await click(openCard ?? null)
    expect(onCharacterSelect).toHaveBeenCalledWith('林晚')
  })

  it('shows the canvas context menu with fit view', async () => {
    await renderGraph()

    const pane = container?.querySelector('.react-flow__pane')
    expect(pane).toBeTruthy()
    await act(async () => {
      pane?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
    })

    expect(document.body.textContent).toContain('适应视图')
  })

  it('draws no relationship line while the shared table has none', async () => {
    useCharacterStore.setState({ relationships: [] })
    await renderGraph({ expectEdges: 0 })

    expect(container?.querySelectorAll('[data-testid="relationship-edge-chip"]')).toHaveLength(0)
    expect(container?.textContent).toContain('0 条关系')
  })

  it('binds edge start and end points strictly to the circular avatar centers of characters', async () => {
    await renderGraph()

    const edgePath = container?.querySelector<SVGPathElement>('.react-flow__edge-path')
    expect(edgePath).toBeTruthy()
    const d = edgePath?.getAttribute('d')
    // 沈砚 at (120, 90) -> avatar center (120 + 32, 90 + 32) = (152, 122)
    // 许渡 at (420, 90) -> avatar center (420 + 32, 90 + 32) = (452, 122)
    expect(d).toBe('M 152,122 L 452,122')
  })

  it('keeps edge endpoints bound to circle center when node is dragged', async () => {
    await renderGraph()

    const initialD = container?.querySelector('.react-flow__edge-path')?.getAttribute('d')
    expect(initialD).toBe('M 152,122 L 452,122')

    const shenNode = nodeOf(SHEN_ID)
    expect(shenNode).toBeTruthy()

    await act(async () => {
      dragNode(shenNode!, 30, 60)
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    const edgePath = container?.querySelector<SVGPathElement>('.react-flow__edge-path')
    expect(edgePath).toBeTruthy()
    const d = edgePath?.getAttribute('d') ?? ''

    const match = d.match(/^M\s*(-?\d+),(-?\d+)\s*L\s*(-?\d+),(-?\d+)$/)
    expect(match).toBeTruthy()
    const [, startX, startY, endX, endY] = match!.map(Number)

    // 验证起点坐标与沈砚节点在画布上的实时圆心位置完全一致
    const nodeWrapper = shenNode?.closest<HTMLElement>('.react-flow__node')
    const transform = nodeWrapper?.style.transform ?? ''
    const matchTranslate = transform.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/)
    if (matchTranslate) {
      const nodeX = parseFloat(matchTranslate[1])
      const nodeY = parseFloat(matchTranslate[2])
      expect(startX).toBe(Math.round(nodeX + 32))
      expect(startY).toBe(Math.round(nodeY + 32))
    } else {
      expect(startX).toBeGreaterThan(152)
      expect(startY).toBeGreaterThan(122)
    }

    // 终点仍精准固定在未移动的许渡头像圆心 (452, 122)
    expect(endX).toBe(452)
    expect(endY).toBe(122)
  })

  it('renders circular nodes above relationship edge lines to occlude line endpoints inside circles', async () => {
    await renderGraph()

    const nodeElement = nodeOf(SHEN_ID)
    const circleElement = nodeElement?.querySelector('.rounded-full')
    expect(circleElement).toBeTruthy()

    // Circular avatar body is styled as opaque with higher stacking context
    const circleStyle = (circleElement as HTMLElement).style
    expect(circleStyle.backgroundColor).toBeTruthy()
    expect(circleStyle.zIndex).toBe('2')

    // Edge element is in .react-flow__edges which is rendered underneath nodes
    const edgeSvg = container?.querySelector('.react-flow__edges')
    const nodesContainer = container?.querySelector('.react-flow__nodes')
    expect(edgeSvg).toBeTruthy()
    expect(nodesContainer).toBeTruthy()

    // In DOM order inside .react-flow__viewport, edges SVG precedes nodes container
    const parent = edgeSvg?.parentElement
    const children = Array.from(parent?.children ?? [])
    expect(children.indexOf(edgeSvg!)).toBeLessThan(children.indexOf(nodesContainer!))
  })
})
