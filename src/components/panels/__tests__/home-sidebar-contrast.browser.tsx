import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'

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
        <div className="app-skin-root flex flex-col w-full h-full overflow-hidden" data-theme="storyforge" data-skin="anime" data-skin-readability="high-contrast">
          <div className="app-skin-background" aria-hidden="true"><img className="app-skin-background-image" src="./skins/anime-night.webp" alt="" /></div>
          <TitleBar />
          <div className="flex flex-1 min-h-0"><div className="w-[260px] shrink-0"><Sidebar /></div></div>
        </div>,
      ))

      const sidebar = host.querySelector<HTMLElement>('.literary-sidebar[data-sidebar-view="home"]')!
      const titlebar = host.querySelector<HTMLElement>('.writer-topbar')!
      const homeLink = sidebar.querySelector<HTMLElement>('.literary-home-sidebar-nav button')!
      const secondaryLink = sidebar.querySelector<HTMLElement>('.literary-home-sidebar-nav button:nth-child(2)')!

      expect(sidebar.querySelector('[data-sidebar="header"]')).toBeNull()
      expect(homeLink.textContent).toContain('工作台首页')
      expect(homeLink.getBoundingClientRect().top - titlebar.getBoundingClientRect().bottom).toBeLessThan(30)
      expect(getComputedStyle(sidebar).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(secondaryLink).color).not.toBe(getComputedStyle(document.documentElement).color)
      expect(sidebar.textContent).toContain('D:/novels/unwritten-book')
      document.documentElement.style.setProperty('--surface-blur', 'blur(26px)')
      document.documentElement.style.setProperty('--chrome-surface-opacity', '82%')
      expect(getComputedStyle(titlebar).backgroundColor).toBe(getComputedStyle(sidebar).backgroundColor)
      expect(getComputedStyle(titlebar).backdropFilter).toBe(getComputedStyle(sidebar).backdropFilter)
      sidebar.setAttribute('data-sidebar-view', 'project')
      expect(getComputedStyle(titlebar).backgroundColor).toBe(getComputedStyle(sidebar).backgroundColor)
      sidebar.setAttribute('data-sidebar-view', 'home')
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-contrast.png' })

      document.documentElement.setAttribute('data-theme', 'starlight-dark')
      host.querySelector('.app-skin-root')?.setAttribute('data-theme', 'starlight-dark')
      expect(sidebar.querySelector('[data-sidebar="header"]')).toBeNull()
      expect(getComputedStyle(secondaryLink).color).not.toBe(getComputedStyle(sidebar).backgroundColor)
      await page.screenshot({ path: '../../../../output/playwright/home-sidebar-contrast-dark.png' })
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
