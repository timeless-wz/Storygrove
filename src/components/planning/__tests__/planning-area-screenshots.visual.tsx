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

registerPlanningVisualHooks()
const { mount, container } = planningVisualHarness()

/** 截图写到仓库根目录的 output/planning-visual/，供报告直接引用。 */
const SCREENSHOT_DIR = '../../../../output/planning-visual'

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

    // 6. 多地图地图册
    installApi({ withData: false })
    await mount(<WorldMapView key="empty" projectKey={PROJECT_PATH} />)
    await shoot('10-map-atlas-empty')

    installApi({ withData: true })
    await mount(<WorldMapView key="data" projectKey={PROJECT_PATH} />)
    await shoot('11-map-atlas-data')
  })
})
