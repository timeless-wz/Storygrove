import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import NewProjectDialog from '../NewProjectDialog'
import ExportDialog from '../ExportDialog'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn>

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: null })
  useLayoutStore.setState({ settingsOpen: false, newProjectOpen: false, exportOpen: false })
  setActiveProjectSessionContext(null)
  invoke = vi.fn(async () => null)
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  setActiveProjectSessionContext(null)
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('project dialog cancellation', () => {
  it('closes NewProjectDialog without creating or switching a project', async () => {
    const onClose = vi.fn()
    await act(async () => root?.render(<NewProjectDialog open onClose={onClose} />))
    await act(async () => page.getByRole('button', { name: '取消' }).click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('closes ExportDialog through its accessible close button without writing files', async () => {
    const onClose = vi.fn()
    await act(async () => root?.render(<ExportDialog isOpen onClose={onClose} />))
    await act(async () => page.getByRole('button', { name: '关闭' }).click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })
})
