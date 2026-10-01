import { act, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'

import '../../../index.css'
import Sidebar from '../Sidebar'
import TitleBar from '../../layout/TitleBar'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('home sidebar over a literary wallpaper', () => {
  it('starts with navigation and keeps its text legible over the artwork', async () => {
    await page.viewport(1280, 800)
    document.documentElement.setAttribute('data-theme', 'storyforge')
    document.documentElement.setAttribute('data-page-wallpaper', 'visible')
    document.documentElement.style.setProperty('--shell-wash-scale', '0%')
    useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
    useLayoutStore.setState({ sidebarView: 'home' })
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [{ name: '未竟之书', path: 'D:/novels/unwritten-book', updatedAt: '2026-09-28T10:00:00.000Z' }],
    })

    const host = document.createElement('div')
    host.style.cssText = 'width:100vw;height:100vh;'
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(
        <div className="app-skin-root flex flex-col w-full h-full overflow-hidden" data-theme="storyforge" data-literary-theme="true" data-skin="anime" data-skin-readability="high-contrast" style={{ '--writer-sidebar-width': '261px' } as CSSProperties}>
          <div className="app-skin-background" aria-hidden="true"><img className="app-skin-background-image" src="./skins/anime-night.webp" alt="" /></div>
          <div className="writer-chrome-frost" aria-hidden="true" />
          <TitleBar />
          <div className="app-skin-main-region writer-desktop-shell flex flex-1 min-h-0 overflow-hidden">
            <PanelGroup orientation="horizontal" className="flex-1 h-full">
              <Panel id="sidebar" defaultSize="260px" minSize="200px" maxSize="380px" onResize={({ inPixels }) => {
                host.querySelector<HTMLElement>('.app-skin-root')?.style.setProperty('--writer-sidebar-width', `${inPixels + 1}px`)
              }}><Sidebar /></Panel>
              <PanelResizeHandle className="writer-sidebar-resize-handle" style={{ width: 1 }} />
              <Panel id="editor"><div className="h-full w-full" /></Panel>
            </PanelGroup>
          </div>
        </div>,
      ))

      const sidebar = host.querySelector<HTMLElement>('.literary-sidebar[data-sidebar-view="home"]')!
      const titlebar = host.querySelector<HTMLElement>('.writer-topbar')!
      const chrome = host.querySelector<HTMLElement>('.writer-chrome-frost')!
      const seam = host.querySelector<HTMLElement>('.writer-sidebar-resize-handle')!
      const homeLink = sidebar.querySelector<HTMLElement>('.literary-home-sidebar-nav button')!
      const secondaryLink = sidebar.querySelector<HTMLElement>('.literary-home-sidebar-nav button:nth-child(2)')!

      expect(sidebar.querySelector('[data-sidebar="header"]')).toBeNull()
      expect(homeLink.textContent).toContain('工作台首页')
      expect(homeLink.getBoundingClientRect().top - titlebar.getBoundingClientRect().bottom).toBeLessThan(30)
      expect(getComputedStyle(sidebar).borderTopRightRadius).toBe('0px')
      expect(getComputedStyle(chrome).maskImage).toContain('radial-gradient')
      expect(getComputedStyle(chrome).maskSize).toContain('261px 100%')
      expect(getComputedStyle(seam).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(seam).cursor).toBe('col-resize')
      expect(getComputedStyle(chrome).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(sidebar).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(titlebar).backdropFilter).toBe('none')
      expect(getComputedStyle(chrome).maskImage).not.toContain('transparent 100%')
      expect(getComputedStyle(secondaryLink).color).not.toBe(getComputedStyle(document.documentElement).color)
      expect(sidebar.textContent).toContain('D:/novels/unwritten-book')
      const skinRoot = host.querySelector<HTMLElement>('.app-skin-root')!
      skinRoot.style.setProperty('--writer-sidebar-width', '321px')
      expect(getComputedStyle(chrome).maskSize).toContain('321px')
      skinRoot.style.setProperty('--writer-sidebar-width', '0px')
      expect(getComputedStyle(chrome).maskSize).toContain('0px')
      skinRoot.style.setProperty('--writer-sidebar-width', '261px')
      document.documentElement.style.setProperty('--surface-blur', 'blur(26px)')
      document.documentElement.style.setProperty('--chrome-surface-opacity', '82%')
      expect(getComputedStyle(chrome).backdropFilter).toBe('blur(26px)')
      sidebar.setAttribute('data-sidebar-view', 'project')
      expect(getComputedStyle(sidebar).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      sidebar.setAttribute('data-sidebar-view', 'home')
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-contrast.png' })
      const sidebarWidthBeforeDrag = sidebar.getBoundingClientRect().width
      await act(async () => page.getByRole('separator').hover())
      expect(getComputedStyle(seam).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-hover.png' })
      const dragTarget = document.createElement('div')
      dragTarget.style.cssText = 'position:fixed;left:320px;top:350px;width:2px;height:2px;pointer-events:none'
      document.body.append(dragTarget)
      try {
        await act(async () => userEvent.dragAndDrop(seam, dragTarget))
      } finally {
        dragTarget.remove()
      }
      expect(sidebar.getBoundingClientRect().width).toBeGreaterThan(sidebarWidthBeforeDrag + 20)
      expect(getComputedStyle(chrome).maskSize).toContain(`${Math.round(sidebar.getBoundingClientRect().width) + 1}px`)
      expect(getComputedStyle(seam).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-drag.png' })
      expect(seam.matches(':focus-visible')).toBe(true)
      expect(getComputedStyle(seam).outlineStyle).toBe('none')
      expect(getComputedStyle(seam, '::after').height).toBe('22px')
      seam.setAttribute('data-separator', 'dragging')
      expect(getComputedStyle(seam).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      seam.setAttribute('data-separator', 'inactive')

      document.documentElement.setAttribute('data-theme', 'starlight-dark')
      host.querySelector('.app-skin-root')?.setAttribute('data-theme', 'starlight-dark')
      expect(sidebar.querySelector('[data-sidebar="header"]')).toBeNull()
      expect(getComputedStyle(secondaryLink).color).not.toBe(getComputedStyle(chrome).backgroundColor)
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-contrast-dark.png' })
      await act(async () => page.getByRole('separator').hover())
      expect(getComputedStyle(seam).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-hover-dark.png' })
      seam.setAttribute('data-separator', 'dragging')
      expect(getComputedStyle(seam).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      document.documentElement.removeAttribute('data-page-wallpaper')
      document.documentElement.removeAttribute('data-theme')
      document.documentElement.style.removeProperty('--shell-wash-scale')
      document.documentElement.style.removeProperty('--surface-blur')
      document.documentElement.style.removeProperty('--chrome-surface-opacity')
    }
  })
})
