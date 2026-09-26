import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../../index.css'
import type { CharacterCard } from '../../../../stores/character-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import CharacterProfileOverview from '../CharacterProfileOverview'

/** 一段没有任何空格的长文本：换行必须由容器负责，不能撑出横向滚动。 */
const LONG_UNBROKEN_TEXT = `外貌${'A'.repeat(240)}`
const LONG_MULTILINE_TEXT = `第一行${'长'.repeat(60)}\n第二行${'长'.repeat(60)}`

const originalLocaleState = useLocaleStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

function card(overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    name: '沈砺',
    role: 'protagonist',
    gender: '男',
    age: '二十三',
    appearance: '',
    personality: '',
    background: '',
    abilities: '',
    motivation: '',
    relationships: '',
    arc: '',
    notes: '',
    ...overrides,
  }
}

const SHEN_ID = 'id-shen-li'

const DETAIL_SECTION_IDS = ['appearance', 'abilities', 'background', 'arc', 'notes'] as const

function section(id: string): HTMLDetailsElement {
  const element = container?.querySelector<HTMLDetailsElement>(`details[data-section="${id}"]`)
  if (!element) throw new Error(`missing detail section ${id}`)
  return element
}

function summaryOf(id: string): HTMLElement {
  const element = section(id).querySelector<HTMLElement>('summary')
  if (!element) throw new Error(`missing summary for ${id}`)
  return element
}

function bodyOf(id: string): HTMLElement {
  const element = section(id).querySelector<HTMLElement>('[data-testid="profile-detail-body"]')
  if (!element) throw new Error(`missing body for ${id}`)
  return element
}

const OVERVIEW_CHARACTER_ID = 'id-overview-character'

async function renderOverview(overrides: Partial<CharacterCard> = {}): Promise<void> {
  await act(async () => {
    root?.render(
      <CharacterProfileOverview
        card={card(overrides)}
        characters={[card(overrides)]}
        characterId={OVERVIEW_CHARACTER_ID}
        sharedRelationships={[]}
        onOpenCharacter={() => {}}
      />,
    )
  })
}

/** 点击标题行本身（不是箭头内部元素），验证整行都是可点区域。 */
async function clickSummaryRow(index: number): Promise<void> {
  await act(async () => {
    await page.getByTestId('profile-detail-summary').nth(index).click()
  })
}

beforeEach(() => {
  useLocaleStore.setState({ ...originalLocaleState, locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  useLocaleStore.setState(originalLocaleState)
})

describe('character profile detail sections', () => {
  it('starts collapsed without any正文 preview on the title row', async () => {
    await renderOverview({ appearance: LONG_MULTILINE_TEXT, abilities: '御水术' })

    expect(DETAIL_SECTION_IDS.map(id => section(id).hasAttribute('open')))
      .toEqual([false, false, false, false, false])

    // 折叠行只有字段标题：没有摘要，也没有被截断的正文。
    expect(summaryOf('appearance').textContent).toBe('外貌描写')
    expect(summaryOf('appearance').textContent).not.toContain('第一行')
    expect(summaryOf('appearance').textContent).not.toContain('…')
    expect(summaryOf('abilities').textContent).not.toContain('御水术')
    // 空字段在折叠行上直接标出“未填写”。
    expect(summaryOf('notes').textContent).toBe('备注未填写')

    for (const id of DETAIL_SECTION_IDS) {
      // 正文不在可见区域……
      expect(bodyOf(id).checkVisibility()).toBe(false)
      // ……并且折叠后的卡片高度就等于标题行高度，没有预留出内容区。
      const details = section(id)
      const border = getComputedStyle(details)
      const borderHeight = Number.parseFloat(border.borderTopWidth) + Number.parseFloat(border.borderBottomWidth)
      expect(details.getBoundingClientRect().height - borderHeight)
        .toBeCloseTo(summaryOf(id).getBoundingClientRect().height, 0)
    }
    await expect.element(page.getByTestId('profile-detail-body').nth(0)).not.toBeVisible()
  })

  it('reveals the正文 directly below its own标题 when the row is clicked', async () => {
    await renderOverview({ appearance: LONG_MULTILINE_TEXT })

    await clickSummaryRow(0)

    expect(section('appearance').hasAttribute('open')).toBe(true)
    const summaryRect = summaryOf('appearance').getBoundingClientRect()
    const bodyRect = bodyOf('appearance').getBoundingClientRect()
    await expect.element(page.getByTestId('profile-detail-body').nth(0)).toBeVisible()
    expect(bodyOf('appearance').checkVisibility()).toBe(true)
    expect(bodyRect.height).toBeGreaterThan(0)
    // 正文紧贴标题下方，并与标题行同宽（不会横向错位）。
    expect(bodyRect.top).toBeGreaterThanOrEqual(summaryRect.bottom - 1)
    expect(bodyRect.left).toBeCloseTo(summaryRect.left, 0)
    expect(bodyRect.right).toBeCloseTo(summaryRect.right, 0)
    // 完整正文只出现一次；标题行仍然只带标题。
    expect(bodyOf('appearance').textContent).toBe(LONG_MULTILINE_TEXT)
    expect(summaryOf('appearance').textContent).toBe('外貌描写')

    // 区块之间互不影响。
    expect(section('abilities').hasAttribute('open')).toBe(false)
    expect(bodyOf('abilities').checkVisibility()).toBe(false)
  })

  it('hides the正文 again when the row is clicked a second time', async () => {
    await renderOverview({ appearance: '一袭青衫' })

    await clickSummaryRow(0)
    await expect.element(page.getByTestId('profile-detail-body').nth(0)).toBeVisible()

    await clickSummaryRow(0)

    expect(section('appearance').hasAttribute('open')).toBe(false)
    expect(bodyOf('appearance').checkVisibility()).toBe(false)
    await expect.element(page.getByTestId('profile-detail-body').nth(0)).not.toBeVisible()
    const details = section('appearance')
    const border = getComputedStyle(details)
    const borderHeight = Number.parseFloat(border.borderTopWidth) + Number.parseFloat(border.borderBottomWidth)
    expect(details.getBoundingClientRect().height - borderHeight)
      .toBeCloseTo(summaryOf('appearance').getBoundingClientRect().height, 0)
    expect(summaryOf('appearance').textContent).toBe('外貌描写')
  })

  it('wraps long unbroken正文 without overflowing the card', async () => {
    await renderOverview({ appearance: LONG_UNBROKEN_TEXT })

    await clickSummaryRow(0)
    await expect.element(page.getByTestId('profile-detail-body').nth(0)).toBeVisible()

    const body = bodyOf('appearance')
    const paragraph = body.querySelector<HTMLElement>('[data-testid="profile-detail-text"]')
    if (!paragraph) throw new Error('missing detail text')
    // 正文完整显示（没有被截断），但必须换行而不是撑宽卡片。
    expect(paragraph.textContent).toBe(LONG_UNBROKEN_TEXT)
    expect(paragraph.scrollWidth).toBeLessThanOrEqual(paragraph.clientWidth)
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth)
    expect(section('appearance').scrollWidth)
      .toBeLessThanOrEqual(section('appearance').clientWidth)
    expect(summaryOf('appearance').scrollWidth)
      .toBeLessThanOrEqual(summaryOf('appearance').clientWidth)
  })

  it('keeps an empty section compact instead of leaving a large blank block', async () => {
    await renderOverview({ abilities: '' })

    await clickSummaryRow(1)

    expect(bodyOf('abilities').textContent).toBe('未填写')
    expect(bodyOf('abilities').checkVisibility()).toBe(true)
    // 空字段展开后只是一行提示，不会留下大块留白。
    expect(bodyOf('abilities').getBoundingClientRect().height).toBeLessThan(60)
  })
})

describe('character profile associated characters section', () => {
  it('shows clear empty state when no relationships are set', async () => {
    await renderOverview({ relationships: '' })
    expect(container?.textContent).toContain('关系')
    expect(container?.textContent).toContain('尚未填写关系')
  })

  it('renders associated characters from the shared relationship table only', async () => {
    const onOpen = vi.fn()
    const companionCard = card({ name: '陆云飞', role: 'antagonist' })
    const mainCard = card({ name: '沈砺' })

    await act(async () => {
      root?.render(
        <CharacterProfileOverview
          card={mainCard}
          characters={[mainCard, companionCard]}
          characterId={SHEN_ID}
          sharedRelationships={[{
            id: 'rel-1',
            character1Id: SHEN_ID,
            character2Id: 'id-lu',
            character1Name: '沈砺',
            character2Name: '陆云飞',
            relation: '师徒',
            description: '自幼抚养',
          }]}
          onOpenCharacter={onOpen}
        />,
      )
    })

    const targetBtn = container?.querySelector<HTMLButtonElement>('[data-testid="relationship-target"]')
    expect(targetBtn).toBeTruthy()
    expect(targetBtn?.textContent).toBe('陆云飞')

    const chip = container?.querySelector<HTMLElement>('[data-testid="relationship-chip"]')
    expect(chip).toBeTruthy()
    expect(chip?.textContent).toBe('师徒')
    expect(container?.textContent).toContain('自幼抚养')

    await act(async () => {
      targetBtn?.click()
    })
    expect(onOpen).toHaveBeenCalledWith('陆云飞')
  })

  it('never derives the associated list from the legacy card JSON', async () => {
    const mainCard = card({
      name: '沈砺',
      // 旧字段里的结构化关系不是事实源：共享表为空时不应显示任何关联人物。
      relationships: JSON.stringify([{ target: '陆云飞', relation: '师徒' }]),
    })

    await act(async () => {
      root?.render(
        <CharacterProfileOverview
          card={mainCard}
          characters={[mainCard, card({ name: '陆云飞' })]}
          characterId={SHEN_ID}
          sharedRelationships={[]}
          onOpenCharacter={() => {}}
        />,
      )
    })

    expect(container?.querySelectorAll('[data-testid="relationship-chip"]')).toHaveLength(0)
    expect(container?.querySelector('[data-testid="relationship-target"]')).toBeNull()
    expect(container?.textContent).toContain('尚未填写关系')
  })

  it('keeps free-form legacy relationship text as verbatim evidence', async () => {
    const legacyText = '陆云飞与沈砺表面合作，实际彼此试探。'
    const mainCard = card({ name: '沈砺', relationships: legacyText })

    await act(async () => {
      root?.render(
        <CharacterProfileOverview
          card={mainCard}
          characters={[mainCard]}
          characterId={SHEN_ID}
          sharedRelationships={[]}
          onOpenCharacter={() => {}}
        />,
      )
    })

    const legacyBlock = container?.querySelector('[data-testid="overview-legacy-relationships"]')
    expect(legacyBlock?.textContent).toContain(legacyText)
    expect(legacyBlock?.textContent).toContain('未解析')
  })
})
