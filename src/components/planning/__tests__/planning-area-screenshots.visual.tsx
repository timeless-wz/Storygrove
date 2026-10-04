/**
 * planning-area-screenshots.visual.tsx
 *
 * 创作规划区域「空态 / 有数据」截图采集。用专用配置运行，因为
 * vitest.browser.config.ts 没有挂 Tailwind 插件，直接在其中截图会丢掉全部
 * Tailwind 布局，页面看起来像坏掉一样：
 *
 *   npx vitest run --config vitest.planning-visual.config.ts
 *
 * 截图输出到仓库根目录 output/planning-visual/。
 */

import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import ChapterCardEditor from '../../editor/ChapterCardEditor'
import ForeshadowingManagementView from '../../editor/ForeshadowingManagementView'
import NovelConfigEditor from '../../editor/NovelConfigEditor'
import NarrativeThreadEditor from '../../editor/NarrativeThreadEditor'
import ProjectTree from '../../panels/sidebar/ProjectTree'
import StoryTimelineView from '../../timeline/StoryTimelineView'
import WorldMapView from '../../map/WorldMapView'
import { Sidebar, SidebarContent } from '../../ui/sidebar'
import {
  DRAFTS_BY_CHAPTER,
  PROJECT_PATH,
  installApi,
  planningVisualHarness,
  registerPlanningVisualHooks,
} from './planning-visual-fixtures'
import { useDraftStore } from '../../../stores/draft-store'
import { createProjectScopedEditorTabId, useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'

registerPlanningVisualHooks()
const { mount, container } = planningVisualHarness()

/** 截图写到仓库根目录的 output/planning-visual/，供报告直接引用。 */
const SCREENSHOT_DIR = '../../../../output/planning-visual'
const STORY_SETUP_SCREENSHOT_DIR = '../../../../output/story-setup-reorganization'

/**
 * 项目树的数量徽章来自带防抖的 refreshAll（80ms），必须多等一会儿，
 * 否则截图会停在「待生成 / 待创建」的初始态。
 */
async function settleTreeRefresh(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => { setTimeout(resolve, 350) })
  })
}

async function shoot(name: string): Promise<void> {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` })
}

function sidebarTree(key: string) {
  return (
    <div key={key} style={{ width: '280px', height: '100%', borderRight: '1px solid var(--color-border)' }}>
      <Sidebar>
        <SidebarContent className="flex-1 py-1">
          <ProjectTree />
        </SidebarContent>
      </Sidebar>
    </div>
  )
}

describe('planning area screenshots', () => {
  it('captures the creative direction page at desktop and narrow widths in Chinese light and English dark', async () => {
    const originalWidth = window.innerWidth
    const originalHeight = window.innerHeight
    const originalBodyWidth = document.body.style.width
    const originalBodyHeight = document.body.style.height
    const originalTheme = document.documentElement.getAttribute('data-theme')
    const originalDark = document.documentElement.classList.contains('dark')
    const tabId = createProjectScopedEditorTabId('config', 'config', PROJECT_PATH)

    try {
      document.documentElement.setAttribute('data-theme', 'storyforge')
      document.documentElement.classList.remove('dark')
      installApi({ withData: true })
      useEditorStore.setState({
        tabs: [{ id: tabId, name: '创作方向', type: 'config', projectKey: PROJECT_PATH, dirty: false }],
        activeTabId: tabId,
        draftLedgers: {},
      })

      await page.viewport(1440, 980)
      document.body.style.width = '1440px'
      document.body.style.height = '980px'
      container().style.width = '1440px'
      container().style.height = '980px'
      await mount(<NovelConfigEditor projectKey={PROJECT_PATH} />)
      expect(container().querySelector('h2')?.textContent).toBe('创作方向')
      await page.screenshot({ path: `${STORY_SETUP_SCREENSHOT_DIR}/creative-direction-zh-light-desktop.png`, timeout: 10000 })

      await page.viewport(390, 844)
      document.body.style.width = '390px'
      document.body.style.height = '844px'
      container().style.width = '390px'
      container().style.height = '844px'
      await page.screenshot({ path: `${STORY_SETUP_SCREENSHOT_DIR}/creative-direction-zh-light-narrow.png`, timeout: 10000 })

      document.documentElement.setAttribute('data-theme', 'starlight-dark')
      document.documentElement.classList.add('dark')
      await act(async () => useLocaleStore.getState().setLocale('en-US'))
      await page.viewport(1440, 980)
      document.body.style.width = '1440px'
      document.body.style.height = '980px'
      container().style.width = '1440px'
      container().style.height = '980px'
      expect(container().querySelector('h2')?.textContent).toBe('Creative direction')
      expect(container().textContent).toContain('Initial ideas')
      await page.screenshot({ path: `${STORY_SETUP_SCREENSHOT_DIR}/creative-direction-en-dark-desktop.png`, timeout: 10000 })
    } finally {
      await page.viewport(originalWidth, originalHeight)
      document.body.style.width = originalBodyWidth
      document.body.style.height = originalBodyHeight
      container().style.width = `${originalWidth}px`
      container().style.height = `${originalHeight}px`
      if (originalTheme) document.documentElement.setAttribute('data-theme', originalTheme)
      else document.documentElement.removeAttribute('data-theme')
      if (originalDark) document.documentElement.classList.add('dark')
      else document.documentElement.classList.remove('dark')
    }
  }, 30_000)

  it('captures the reorganized story setup navigation in Chinese light and English dark at desktop and narrow widths', async () => {
    const originalWidth = window.innerWidth
    const originalHeight = window.innerHeight
    const originalBodyWidth = document.body.style.width
    const originalBodyHeight = document.body.style.height
    const originalTheme = document.documentElement.getAttribute('data-theme')
    const originalDark = document.documentElement.classList.contains('dark')

    try {
      document.documentElement.setAttribute('data-theme', 'storyforge')
      document.documentElement.classList.remove('dark')
      useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
      await page.viewport(1440, 900)
      document.body.style.width = '1440px'
      document.body.style.height = '900px'
      container().style.width = '1440px'
      container().style.height = '900px'
      installApi({ withData: true })
      useDraftStore.setState({ draftsByChapter: DRAFTS_BY_CHAPTER })
      await mount(sidebarTree('story-setup-desktop'))
      await settleTreeRefresh()
      await page.screenshot({ path: `${STORY_SETUP_SCREENSHOT_DIR}/sidebar-zh-light-desktop.png` })

      const worldSetupToggle = container().querySelector<HTMLButtonElement>(
        '[data-group-id="worldSetup"] button[aria-label="世界设定"]',
      )
      expect(worldSetupToggle?.getAttribute('aria-expanded')).toBe('false')
      await act(async () => worldSetupToggle?.click())
      expect(container().querySelector('[data-group-id="worldSetup"]')?.textContent)
        .toContain('修炼体系')
      await page.screenshot({ path: `${STORY_SETUP_SCREENSHOT_DIR}/sidebar-zh-light-expanded.png` })

      await page.viewport(420, 900)
      document.body.style.width = '420px'
      document.body.style.height = '900px'
      container().style.width = '420px'
      container().style.height = '900px'
      document.documentElement.setAttribute('data-theme', 'starlight-dark')
      document.documentElement.classList.add('dark')
      useLocaleStore.setState({ locale: 'en-US', initialized: true })
      useLayoutStore.getState().setProjectTreeGroupOpen('worldSetup', true)
      await page.screenshot({ path: `${STORY_SETUP_SCREENSHOT_DIR}/sidebar-en-dark-narrow.png` })
      expect(container().textContent).toContain('World management')
      expect(container().textContent).toContain('Cultivation system')
    } finally {
      await page.viewport(originalWidth, originalHeight)
      document.body.style.width = originalBodyWidth
      document.body.style.height = originalBodyHeight
      container().style.width = `${originalWidth}px`
      container().style.height = `${originalHeight}px`
      if (originalTheme) document.documentElement.setAttribute('data-theme', originalTheme)
      else document.documentElement.removeAttribute('data-theme')
      if (!originalDark) document.documentElement.classList.remove('dark')
    }
  })

  it('captures every page in its empty and populated state', async () => {
    // 1. 项目树：空项目 / 有内容
    installApi({ withData: false })
    await mount(sidebarTree('empty'))
    await settleTreeRefresh()
    await shoot('01b-project-tree-empty')

    installApi({ withData: true })
    useDraftStore.setState({ draftsByChapter: DRAFTS_BY_CHAPTER })
    await mount(sidebarTree('data'))
    await settleTreeRefresh()
    expect(container().textContent).toContain('3/24 章')
    expect(container().textContent).toContain('3 处地点')
    await shoot('01-project-tree')

    // 2. 章节蓝图
    installApi({ withData: false })
    await mount(<ChapterCardEditor key="empty" projectKey={PROJECT_PATH} />)
    await shoot('02-chapter-blueprints-empty')

    installApi({ withData: true })
    useDraftStore.setState({ draftsByChapter: DRAFTS_BY_CHAPTER })
    await mount(<ChapterCardEditor key="data" projectKey={PROJECT_PATH} />)
    await shoot('03-chapter-blueprints-data')

    // 3. 章节脉络（计划清单视图）
    installApi({ withData: false })
    await mount(<NarrativeThreadEditor key="empty" projectKey={PROJECT_PATH} initialView="plans" />)
    await shoot('04-chapter-thread-empty')

    installApi({ withData: true })
    await mount(<NarrativeThreadEditor key="data" projectKey={PROJECT_PATH} initialView="plans" />)
    await shoot('05-chapter-thread-data')

    // 4. 故事时间线
    installApi({ withData: false })
    await mount(<StoryTimelineView key="empty" projectKey={PROJECT_PATH} />)
    await shoot('06-story-timeline-empty')

    installApi({ withData: true })
    await mount(<StoryTimelineView key="data" projectKey={PROJECT_PATH} />)
    await shoot('07-story-timeline-data')

    // 5. 伏笔管理
    installApi({ withData: false })
    await mount(<ForeshadowingManagementView key="empty" projectKey={PROJECT_PATH} />)
    await shoot('08-foreshadowing-empty')

    installApi({ withData: true })
    await mount(<ForeshadowingManagementView key="data" projectKey={PROJECT_PATH} />)
    await shoot('09-foreshadowing-data')

    // 6. 地图册属于故事设定，但沿用规划工具的工作台外壳。
    installApi({ withData: false })
    await mount(<WorldMapView key="empty" projectKey={PROJECT_PATH} />)
    await shoot('10-map-atlas-empty')

    installApi({ withData: true })
    await mount(<WorldMapView key="data" projectKey={PROJECT_PATH} />)
    await shoot('11-map-atlas-data')
  })
})
