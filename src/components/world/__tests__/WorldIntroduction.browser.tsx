import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import type { WorldRecord } from '../../../shared/world-workbench'
import type { WorldIntroductionProps } from '../world-management-contract'
import WorldIntroduction from '../WorldIntroduction'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORLD_ID = 'world-stable-a'

function world(overrides: Partial<WorldRecord> = {}): WorldRecord {
  return {
    id: WORLD_ID,
    name: '雾海诸境',
    summary: '潮汐决定航路。',
    background: '这里是一片被雾潮环绕的群岛。',
    notes: '航海历法尚未定稿。',
    sortOrder: 0,
    ...overrides,
  }
}

function props(overrides: Partial<WorldIntroductionProps> = {}): WorldIntroductionProps {
  return {
    world: world(),
    summaries: [],
    connections: [],
    editRequestToken: 0,
    saving: false,
    saveError: null,
    onSave: vi.fn(async updated => ({ ...world(), ...updated })),
    onNavigate: vi.fn(),
    onCreate: vi.fn(),
    onEditingChange: vi.fn(),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

async function render(input: WorldIntroductionProps = props()): Promise<void> {
  await act(async () => root.render(<WorldIntroduction {...input} />))
}

async function clickButton(name: string): Promise<void> {
  await act(async () => { await page.getByRole('button', { name, exact: true }).click() })
}

async function fillTextbox(name: string, value: string): Promise<void> {
  await act(async () => { await page.getByRole('textbox', { name, exact: true }).fill(value) })
}

beforeEach(async () => {
  await page.viewport(1280, 850)
  container = document.createElement('div')
  container.style.width = '100%'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await page.viewport(1280, 850)
})

describe('WorldIntroduction', () => {
  it('keeps complete legacy background and notes readable, including long text', async () => {
    const background = Array.from({ length: 14 }, (_, index) => `旧背景第 ${index + 1} 段：雾潮每七年转向一次。`).join('\n\n')
    const notes = `旧备注开头。\n${'保留的补充说明仍然完整可读。'.repeat(28)}\n旧备注结尾。`
    await render(props({ world: world({ background, notes }) }))

    expect(container.textContent).toContain('旧背景第 1 段：雾潮每七年转向一次。')
    expect(container.textContent).toContain('旧背景第 14 段：雾潮每七年转向一次。')
    expect(container.textContent).toContain('旧备注开头。')
    expect(container.textContent).toContain('旧备注结尾。')
    const reading = container.querySelector<HTMLElement>('.world-introduction__reading-text')
    expect(reading).not.toBeNull()
    expect(getComputedStyle(reading!).whiteSpace).toBe('pre-wrap')
  })

  it('shows genuine empty states and direct create and section-navigation actions', async () => {
    const onNavigate = vi.fn()
    const onCreate = vi.fn()
    await render(props({
      world: world({ summary: '', background: '', notes: '' }),
      summaries: [
        { section: 'factions', label: '势力', count: 0, preview: [] },
        { section: 'relics', label: '秘境', count: 1, preview: ['无名遗迹'] },
      ],
      onNavigate,
      onCreate,
    }))

    expect(container.textContent).toContain('尚未填写一句话介绍。')
    expect(container.textContent).toContain('尚未填写世界背景。')
    expect(container.textContent).toContain('尚未填写补充说明。')
    expect(container.textContent).toContain('暂无跨世界联系。')
    expect(container.textContent).toContain('暂无记录')

    await clickButton('填写世界介绍')
    expect(container.querySelector('form[aria-label="编辑世界介绍"]')).not.toBeNull()
    await clickButton('取消')
    await clickButton('进入势力分区')
    await clickButton('添加势力')
    await clickButton('添加秘境')

    expect(onNavigate).toHaveBeenCalledWith('factions')
    expect(onCreate).toHaveBeenNthCalledWith(1, 'factions')
    expect(onCreate).toHaveBeenNthCalledWith(2, 'relics')
  })

  it('keeps the same world edit open with all entered values after a failed save', async () => {
    let resolveSave!: (value: WorldRecord | null) => void
    const onSave = vi.fn(() => new Promise<WorldRecord | null>(resolve => { resolveSave = resolve }))
    const currentWorld = world()
    await render(props({ world: currentWorld, onSave, editRequestToken: 1 }))
    await fillTextbox('世界名称', '雾海诸境新名')
    await fillTextbox('一句话介绍', '新的摘要仍留在草稿中。')
    await fillTextbox('世界背景与介绍', '新的背景第一行。\n新的背景第二行。')
    await fillTextbox('补充说明', '新的补充说明。')
    await clickButton('保存介绍')

    expect(onSave).toHaveBeenCalledWith({
      id: WORLD_ID,
      name: '雾海诸境新名',
      summary: '新的摘要仍留在草稿中。',
      background: '新的背景第一行。\n新的背景第二行。',
      notes: '新的补充说明。',
    })
    await expect.element(page.getByRole('button', { name: '保存中…', exact: true })).toBeDisabled()

    await act(async () => { resolveSave(null) })
    await expect.element(page.getByRole('alert')).toHaveTextContent('保存失败，请检查后重试。')
    await expect.element(page.getByRole('textbox', { name: '世界名称' })).toHaveValue('雾海诸境新名')
    await expect.element(page.getByRole('textbox', { name: '一句话介绍' })).toHaveValue('新的摘要仍留在草稿中。')
    await expect.element(page.getByRole('textbox', { name: '世界背景与介绍' })).toHaveValue('新的背景第一行。\n新的背景第二行。')
    await expect.element(page.getByRole('textbox', { name: '补充说明' })).toHaveValue('新的补充说明。')
    expect(container.querySelector('form[aria-label="编辑世界介绍"]')).not.toBeNull()
  })

  it('shows parent save errors and lets the author cancel the inline edit', async () => {
    await render(props({
      world: world({ summary: '', background: '', notes: '' }),
      saveError: '数据库拒绝了这次保存。',
    }))
    await clickButton('填写世界介绍')

    await expect.element(page.getByRole('alert')).toHaveTextContent('数据库拒绝了这次保存。')
    await clickButton('取消')
    expect(container.querySelector('form[aria-label="编辑世界介绍"]')).toBeNull()
    expect(container.textContent).toContain('雾海诸境')
  })

  it('opens the inline editor when the persistent header edit token changes and reports edit state', async () => {
    const onEditingChange = vi.fn()
    const first = props({ onEditingChange })
    await render(first)
    expect(container.querySelector('form[aria-label="编辑世界介绍"]')).toBeNull()

    await render({ ...first, editRequestToken: 1 })
    expect(container.querySelector('form[aria-label="编辑世界介绍"]')).not.toBeNull()
    expect(onEditingChange).toHaveBeenCalledWith(true)

    await clickButton('取消')
    expect(onEditingChange).toHaveBeenLastCalledWith(false)
  })

  it('discards an old-world draft when the selected world changes', async () => {
    const onEditingChange = vi.fn()
    const first = props({ onEditingChange, editRequestToken: 1 })
    await render(first)
    await fillTextbox('世界背景与介绍', '只属于第一个世界的草稿。')

    await render({ ...first, world: world({ id: 'world-stable-b', name: '第二个世界' }) })

    expect(container.querySelector('form[aria-label="编辑世界介绍"]')).toBeNull()
    expect(container.textContent).toContain('第二个世界')
    expect(container.textContent).not.toContain('只属于第一个世界的草稿。')
    expect(onEditingChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps duplicate display names as separate entries and marks missing world references', async () => {
    const onNavigate = vi.fn()
    const repeatedPortal = (id: string, toWorldId: string, toWorldName: string | null) => ({
      id,
      name: '断界长桥',
      fromWorldId: WORLD_ID,
      fromWorldName: '忽略的旧名称',
      toWorldId,
      toWorldName,
      bidirectional: false,
      condition: '潮汐退去时',
      statusLabel: '不稳定',
    })
    await render(props({
      world: world({ name: '同名世界' }),
      summaries: [{ section: 'factions', label: '势力', count: 2, preview: ['晨星会', '晨星会'] }],
      connections: [
        repeatedPortal('portal-a', 'missing-world', null),
      { ...repeatedPortal('portal-b', 'world-b', '同名世界'), bidirectional: true },
        { ...repeatedPortal('portal-c', 'world-c', '无关世界'), fromWorldId: 'world-other' },
      ],
      onNavigate,
    }))

    expect(container.querySelectorAll('[data-testid="world-introduction-connection"]')).toHaveLength(2)
    expect(container.querySelectorAll('.world-introduction__preview-name')).toHaveLength(2)
    expect(container.textContent?.match(/断界长桥/g)).toHaveLength(2)
    expect(container.textContent).toContain('世界引用缺失')
    expect(container.textContent).toContain('同名世界 ↔ 同名世界')
    expect(container.textContent).not.toContain('portal-a')
    expect(container.textContent).not.toContain('portal-b')
    expect(container.textContent).not.toContain('忽略的旧名称')

    await clickButton('查看全部联系')
    expect(onNavigate).toHaveBeenCalledWith('portals')
  })

  it('fits a narrow viewport without horizontal overflow', async () => {
    await page.viewport(380, 850)
    await render(props({
      world: world({
        name: '雾海诸境与远航群岛'.repeat(2),
        background: `${'连续长文本'.repeat(80)}\n第二段仍能换行。`,
      }),
      summaries: [{ section: 'factions', label: '跨海势力名单', count: 3, preview: ['很长的势力名称'.repeat(3), '晨星会', '晨星会'] }],
    }))

    const introduction = container.querySelector<HTMLElement>('.world-introduction')!
    expect(window.innerWidth).toBe(380)
    expect(introduction.getBoundingClientRect().width).toBeLessThanOrEqual(380)
    expect(introduction.scrollWidth).toBeLessThanOrEqual(introduction.clientWidth)
    expect(container.textContent).toContain('添加势力')
  })
})
