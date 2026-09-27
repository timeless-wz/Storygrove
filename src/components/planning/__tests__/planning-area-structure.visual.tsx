/**
 * planning-area-structure.visual.tsx
 *
 * 创作规划区域的结构契约：五个页面都必须给出同一条返回路径、同级标题、
 * 左侧列表、筛选与工具栏；空状态必须说明如何开始，有数据状态必须展示真实内容。
 *
 * 与 planning-area-screenshots.visual.tsx 一样用专用配置运行：
 *   npx vitest run --config vitest.planning-visual.config.ts
 *
 * 放在专门的配置里有两个原因：需要 @tailwindcss/vite 才有真实布局；并且把新增的
 * 浏览器测试与既有测试隔离，避免同一次运行里相互干扰（见交接报告）。
 */

import { describe, expect, it } from 'vitest'

import ChapterCardEditor from '../../editor/ChapterCardEditor'
import ForeshadowingManagementView from '../../editor/ForeshadowingManagementView'
import NarrativeThreadEditor from '../../editor/NarrativeThreadEditor'
import ProjectTree from '../../panels/sidebar/ProjectTree'
import StoryTimelineView from '../../timeline/StoryTimelineView'
import WorldMapView from '../../map/WorldMapView'
import { Sidebar, SidebarContent } from '../../ui/sidebar'
import {
  installApi,
  planningVisualHarness,
  registerPlanningVisualHooks,
  DRAFTS_BY_CHAPTER,
  PROJECT_PATH,
} from './planning-visual-fixtures'
import { useDraftStore } from '../../../stores/draft-store'

registerPlanningVisualHooks()
const { mount, pageText, expectSharedChrome, container } = planningVisualHarness()

describe('planning area visual contract', () => {
  it('project tree: five author-task areas in author order', async () => {
    installApi({ withData: true })
    useDraftStore.setState({ draftsByChapter: DRAFTS_BY_CHAPTER })
    // 与真实侧边栏同一套容器，截图才反映作者实际看到的项目树。
    await mount(
      <div style={{ width: '280px', height: '100%', borderRight: '1px solid var(--color-border)' }}>
        <Sidebar>
          <SidebarContent className="flex-1 py-1">
            <ProjectTree />
          </SidebarContent>
        </Sidebar>
      </div>,
    )

    const text = pageText()
    for (const label of ['项目总览', '创作规划', '正文创作', '故事设定', '资料库', '项目管理']) {
      expect(text, `project tree must present ${label}`).toContain(label)
    }
    for (const entry of ['章节蓝图', '章节脉络', '故事时间线', '伏笔管理', '多地图地图册', '草稿箱', '正文章节']) {
      expect(text, `project tree must keep the ${entry} entry`).toContain(entry)
    }
    // 作者任务顺序：总览 → 创作规划 → 正文创作 → 故事设定 → 资料库 → 项目管理
    const positions = ['项目总览', '创作规划', '正文创作', '故事设定', '资料库', '项目管理']
      .map(label => text.indexOf(label))
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('project tree: same five areas before anything is generated', async () => {
    installApi({ withData: false })
    await mount(
      <div style={{ width: '280px', height: '100%', borderRight: '1px solid var(--color-border)' }}>
        <Sidebar>
          <SidebarContent className="flex-1 py-1">
            <ProjectTree />
          </SidebarContent>
        </Sidebar>
      </div>,
    )

    const text = pageText()
    // 空项目里五个任务区同样在，且都给出「待生成 / 待创建 / 待配置」的真实状态。
    for (const label of ['项目总览', '创作规划', '正文创作', '故事设定', '资料库', '项目管理']) {
      expect(text, `empty project tree must present ${label}`).toContain(label)
    }
    expect(text).toContain('待生成')
    expect(text).toContain('待创建')
  })

  it('chapter blueprints: empty state explains how to start', async () => {
    installApi({ withData: false })
    await mount(<ChapterCardEditor projectKey={PROJECT_PATH} />)

    expectSharedChrome('章节蓝图')
    const text = pageText()
    expect(text).toContain('暂无蓝图')
    expect(text).toContain('点上方文件夹图标新建一卷')
    expect(text).toContain('在右侧填写本章小目标、冲突与钩子')
    expect(text).toContain('卷与章节')
    expect(container().querySelector<HTMLInputElement>('input[type="search"]')?.placeholder)
      .toBe('搜索章节号或标题…')
  })

  it('chapter blueprints: list, filter and toolbar with data', async () => {
    installApi({ withData: true })
    useDraftStore.setState({ draftsByChapter: DRAFTS_BY_CHAPTER })
    await mount(<ChapterCardEditor projectKey={PROJECT_PATH} />)

    expectSharedChrome('章节蓝图')
    const text = pageText()
    expect(text).toContain('灰潮初现')
    expect(text).toContain('灯塔停摆')
    expect(text).toContain('有指导')
    // 正文入口与蓝图进度都在工具栏上
    expect(text).toContain('正文创作')
    expect(text).toContain('3 章蓝图 · 1 章已写正文')
  })

  it('chapter thread: plans view empty then with a thread plan', async () => {
    installApi({ withData: false })
    await mount(<NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="plans" />)

    expectSharedChrome('章节脉络')
    expect(pageText()).toContain('暂无伏笔或叙事线索')
    expect(pageText()).toContain('在右侧「新建计划」里填写标题、类型与埋设/回收章节')
    expect(pageText()).toContain('计划清单')

    installApi({ withData: true })
    await mount(<NarrativeThreadEditor key="with-data" projectKey={PROJECT_PATH} initialView="plans" />)
    const text = pageText()
    expect(text).toContain('铜哨的来历')
    expect(text).toContain('埋设/开始 1 · 预计回收/结束 8')
  })

  it('chapter thread breadcrumb keeps arrows beside text and clear of the title', async () => {
    installApi({ withData: true })
    await mount(<NarrativeThreadEditor projectKey={PROJECT_PATH} initialView="canvas" />)
    const breadcrumb = container().querySelector<HTMLElement>('.planning-page__breadcrumb')!
    const title = container().querySelector<HTMLElement>('.planning-page__title-row')!
    expect(title.getBoundingClientRect().top - breadcrumb.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(6)
    for (const item of breadcrumb.querySelectorAll<HTMLElement>('.planning-page__crumb-item')) {
      const arrow = item.querySelector<SVGElement>('.planning-page__crumb-sep')
      const label = item.querySelector<HTMLElement>('.planning-page__crumb')
      if (!arrow || !label) continue
      const arrowRect = arrow.getBoundingClientRect()
      const labelRect = label.getBoundingClientRect()
      expect(labelRect.left - arrowRect.right).toBeGreaterThanOrEqual(4)
      expect(Math.abs((arrowRect.top + arrowRect.bottom) / 2 - (labelRect.top + labelRect.bottom) / 2)).toBeLessThan(3)
    }
  })

  it('story timeline: empty state then a populated canvas', async () => {
    installApi({ withData: false })
    await mount(<StoryTimelineView projectKey={PROJECT_PATH} />)

    expectSharedChrome('故事时间线')
    const text = pageText()
    expect(text).toContain('时间线上还没有事件')
    expect(text).toContain('先在「刻度设置」里确定故事开端与结束')
    // 即便没有事件，真实画布（主轴与锚点）依然渲染，不伪造数据。
    expect(container().querySelector('[data-testid="timeline-axis"]')).not.toBeNull()
    expect(container().querySelector('[data-testid="timeline-anchor-start"]')).not.toBeNull()
    expect(container().querySelectorAll('[data-testid="timeline-event-label"]')).toHaveLength(0)

    installApi({ withData: true })
    await mount(<StoryTimelineView key="with-data" projectKey={PROJECT_PATH} />)
    expect(container().querySelectorAll('[data-testid="timeline-event-label"]')).toHaveLength(3)
    expect(Array.from(container().querySelectorAll('.planning-pane__group-label'))
      .filter(label => label.textContent === '主轴事件')).toHaveLength(1)
    expect(Array.from(container().querySelectorAll('button'))
      .filter(button => button.textContent?.trim() === '仅主轴')).toHaveLength(1)
    expect(pageText()).toContain('3 个事件')
    expect(pageText()).toContain('灰潮初现')
  })

  it('foreshadowing: empty state then list with detail', async () => {
    installApi({ withData: false })
    await mount(<ForeshadowingManagementView projectKey={PROJECT_PATH} />)

    expectSharedChrome('伏笔管理')
    const text = pageText()
    expect(text).toContain('还没有伏笔')
    expect(text).toContain('在正文编辑器里选中一句话')
    expect(text).toContain('全部')
    expect(text).toContain('待回收 / 未完成')
    expect(text).toContain('已回收 / 已完成')

    installApi({ withData: true })
    await mount(<ForeshadowingManagementView key="with-data" projectKey={PROJECT_PATH} />)
    const withDataText = pageText()
    expect(withDataText).toContain('第三章揭示铜哨的来历')
    expect(withDataText).toContain('名册上的第七个名字是空的')
    expect(withDataText).toContain('标记为已回收')
  })

  it('map atlas: empty state then atlas tree with a map selected', async () => {
    installApi({ withData: false })
    await mount(<WorldMapView projectKey={PROJECT_PATH} />)

    expectSharedChrome('多地图地图册')
    const text = pageText()
    expect(text).toContain('先新建一张地图')
    expect(text).toContain('新建一张顶层地图（可作为世界总图）')
    expect(text).toContain('地图册')

    installApi({ withData: true })
    await mount(<WorldMapView key="with-data" projectKey={PROJECT_PATH} />)
    const withDataText = pageText()
    expect(withDataText).toContain('潮汐世界总图')
    expect(withDataText).toContain('雾港城地图')
    expect(withDataText).toContain('3 个地点')
    expect(withDataText).toContain('1 条连接')
    expect(container().querySelector('[data-testid="world-map-breadcrumb"]')?.textContent)
      .toContain('潮汐世界总图')
  })
})
