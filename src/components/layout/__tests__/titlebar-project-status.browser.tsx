import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'

import '../../../index.css'
import TitleBar from '../TitleBar'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useThemeStore } from '../../../stores/theme-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('project status in the title bar', () => {
  it('keeps all controls on the brand row and gives the former footer height back to the workspace', async () => {
    await page.viewport(1280, 800)
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useLayoutStore.setState({ sidebarView: 'project', sidebarOpen: true, bottomPanelOpen: false })
    useProjectStore.setState({ currentProject: {
      id: 'skin-layout-fixture',
      name: '未竟之书',
      path: 'D:/novels/unwritten-book',
      updatedAt: '2026-09-28T10:00:00.000Z',
    } as NonNullable<ReturnType<typeof useProjectStore.getState>['currentProject']> })

    const host = document.createElement('div')
    host.style.cssText = 'display:flex;flex-direction:column;width:100vw;height:100vh;'
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<>
        <TitleBar />
        <main data-testid="workspace" style={{ flex: 1 }} />
      </>))

      const titlebar = host.querySelector<HTMLElement>('.writer-topbar')!
      const brand = host.querySelector<HTMLElement>('.writer-topbar-brand')!
      const status = host.querySelector<HTMLElement>('.writer-topbar-status')!
      const windows = host.querySelector<HTMLElement>('.writer-topbar-window-controls')!
      const workspace = host.querySelector<HTMLElement>('[data-testid="workspace"]')!
      expect(host.querySelector('.writer-statusbar')).toBeNull()
      expect(status.textContent).toContain('未竟之书')
      expect(status.textContent).toContain('已保存')
      const centerY = (element: HTMLElement) => element.getBoundingClientRect().y + element.getBoundingClientRect().height / 2
      expect(Math.abs(centerY(brand) - centerY(status))).toBeLessThan(2)
      expect(Math.abs(centerY(status) - centerY(windows))).toBeLessThan(2)
      expect(workspace.getBoundingClientRect().top).toBe(titlebar.getBoundingClientRect().bottom)
      await page.screenshot({ path: '../../../../output/playwright/titlebar-project-status-wide.png' })

      const previousZoom = useThemeStore.getState().zoom
      await act(async () => (host.querySelector('[title="放大"]') as HTMLButtonElement).click())
      expect(useThemeStore.getState().zoom).toBeGreaterThan(previousZoom)
      await act(async () => useThemeStore.getState().zoomReset())

      await act(async () => useLayoutStore.setState({ bottomPanelOpen: true, bottomTab: 'tasks' }))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      const taskPopover = document.querySelector<HTMLElement>('.writer-task-popover')!
      expect(taskPopover).not.toBeNull()
      expect(taskPopover.getBoundingClientRect().top).toBeGreaterThanOrEqual(titlebar.getBoundingClientRect().bottom)
      await act(async () => useLayoutStore.setState({ bottomPanelOpen: false }))

      await page.viewport(820, 650)
      expect(windows.getBoundingClientRect().right).toBeLessThanOrEqual(821)
      expect(host.querySelector<HTMLElement>('.writer-topbar-workspace')!.scrollWidth).toBeGreaterThan(0)
      await page.screenshot({ path: '../../../../output/playwright/titlebar-project-status-narrow.png' })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
