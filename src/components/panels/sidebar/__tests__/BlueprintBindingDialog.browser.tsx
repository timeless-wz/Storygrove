import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BlueprintBindingDialog } from '../BlueprintBindingDialog'
import { useProjectStore } from '../../../../stores/project-store'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import type { ProjectData } from '../../../../shared/ipc-channels'
import '../../../../index.css'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.fn()


const session = { projectId: 'binding-test', leaseId: 'binding-lease', projectPath: 'C:\\novels\\binding-test' }
const initialProject = useProjectStore.getState()
const close = vi.fn()
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  close.mockReset()
  invoke.mockReset()
  invoke.mockImplementation(async (channel) => {
    if (channel === 'db:blueprint-list-summary') return Array.from({ length: 58 }, (_, i) => ({
      chapterNumber: i + 1, volumeId: i < 20 ? 'volume-1' : i < 50 ? 'volume-2' : undefined, title: i === 17 ? '不属于故事的解法' : `雨夜来信 ${i + 1}`,
    }))
    if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }, { id: 'volume-2', name: '第2卷', sortOrder: 2 }]
    if (channel === 'db:blueprint-v2-summary-list') return []
    if (channel === 'db:draft-set-blueprint') return { success: true }
    throw new Error(channel)
  })
  useProjectStore.setState({ currentProject: { id: session.projectId, path: session.projectPath, sessionLease: session.leaseId } as ProjectData })
  setActiveProjectSessionContext(session)
  Object.defineProperty(window, 'velaAPI', { configurable: true, value: { invoke, on: () => () => {} } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  Reflect.deleteProperty(window, 'velaAPI')
  useProjectStore.setState(initialProject)
  setActiveProjectSessionContext(null)
})

async function render(bound?: number) {
  await act(async () => root.render(<BlueprintBindingDialog open target={{ draftId: 7, chapterNumber: 1, label: '第1章 · 接错的人', blueprintChapterNumber: bound }} onOpenChange={close} />))
  await vi.waitFor(() => expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(58))
}

it('searches chapters, keeps a pending selection through filtering, and writes only on confirmation', async () => {
  await render()
  await act(async () => { await page.getByRole('textbox', { name: '搜索章号或标题' }).fill('18') })
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(1)
  await act(async () => { await page.getByText('不属于故事的解法', { exact: true }).click() })
  await act(async () => { await page.getByRole('textbox').fill('不存在的章节') })
  await expect.element(page.getByText('没有匹配的章节，试试其他卷、章号或标题。')).toBeVisible()
  await expect.element(page.getByText('待绑定：第18章 · 不属于故事的解法')).toBeVisible()
  expect(invoke.mock.calls.some(call => call[0] === 'db:draft-set-blueprint')).toBe(false)
  await act(async () => { await page.getByRole('button', { name: '确认绑定', exact: true }).click() })
  expect(invoke.mock.calls).toContainEqual(['db:draft-set-blueprint', 7, 18, session.projectPath, session])
  expect(close).toHaveBeenCalledWith(false)
})

it('locates the current binding, supports keyboard selection, and cancels without writing', async () => {
  await render(45)
  expect(document.querySelector('.blueprint-binding__list')!.scrollTop).toBeGreaterThan(0)
  const selected = document.querySelector<HTMLInputElement>('input:checked')!
  selected.focus()
  await act(async () => { await userEvent.keyboard('{ArrowDown}') })
  expect(document.querySelector<HTMLInputElement>('input:checked')!.value).toBe('46')
  await act(async () => { await page.getByRole('button', { name: '取消', exact: true }).click() })
  expect(invoke.mock.calls.some(call => call[0] === 'db:draft-set-blueprint')).toBe(false)
})

it('requires confirmation to unlink and preserves the dialog when saving fails', async () => {
  await render(18)
  await act(async () => { await page.getByRole('button', { name: '解除绑定', exact: true }).click() })
  expect(invoke.mock.calls.some(call => call[0] === 'db:draft-set-blueprint')).toBe(false)
  invoke.mockResolvedValueOnce({ success: false, error: '保存失败' })
  await act(async () => { await page.getByRole('button', { name: '确认解绑', exact: true }).click() })
  expect(close).not.toHaveBeenCalled()
  await expect.element(page.getByText('待解除当前绑定')).toBeVisible()
  await act(async () => { await page.getByRole('button', { name: '确认解绑', exact: true }).click() })
  expect(invoke.mock.calls).toContainEqual(['db:draft-set-blueprint', 7, null, session.projectPath, session])
  expect(close).toHaveBeenCalledWith(false)
})

it('filters by actual volume membership together with search and keeps pending selection across volumes', async () => {
  await render()
  await act(async () => { await page.getByRole('combobox', { name: '按卷筛选' }).selectOptions('volume:volume-1') })
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(20)
  await act(async () => { await page.getByRole('textbox').fill('18') })
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(1)
  await act(async () => { await page.getByText('不属于故事的解法', { exact: false }).first().click() })
  await act(async () => { await page.getByRole('combobox').selectOptions('volume:volume-2') })
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0)
  await expect.element(page.getByText('待绑定：第18章 · 不属于故事的解法')).toBeVisible()
  await act(async () => { await page.getByRole('textbox').fill('') })
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(30)
  await act(async () => { await page.getByRole('combobox').selectOptions('unassigned') })
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(8)
  expect(invoke.mock.calls.some(call => call[0] === 'db:draft-set-blueprint')).toBe(false)
})
