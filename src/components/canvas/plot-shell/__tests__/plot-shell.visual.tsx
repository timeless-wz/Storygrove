/**
 * plot-shell.visual.tsx — 剧情画布展示外壳的结构测试与截图采集。
 *
 * 用专用配置运行（vitest.plot-shell-visual.config.ts，带 Tailwind 插件，
 * 与 planning-visual 同一套做法）：
 *
 *   npx vitest run --config vitest.plot-shell-visual.config.ts
 *
 * 行为断言覆盖各组件导出接口的回调语义；截图输出到仓库根目录
 * output/plot-shell-visual/，覆盖 1264×900 / 2516×1289 与深色主题。
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import '../../../../index.css'
import {
  CreatePlotCanvasDialog,
  PlotCanvasEmptyState,
  PlotCanvasInfoPanel,
  PlotCanvasShell,
  PlotCanvasSidebar,
  PlotCanvasToolRail,
  PlotCanvasTopbar,
  createDefaultPlotCanvasToolGroups,
  emptyPlotCanvasFixtures,
  plotCanvasSidebarFixtures,
  type PlotCanvasSidebarEntry,
  type PlotCanvasSidebarTab,
} from '../index'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SCREENSHOT_DIR = '../../../../../output/plot-shell-visual'

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  document.body.style.margin = '0'
  document.body.style.width = '100vw'
  document.body.style.height = '100vh'
  document.body.style.overflow = 'hidden'
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
  await page.viewport(1264, 900)
  container = document.createElement('div')
  container.style.width = '100vw'
  container.style.height = '100vh'
  container.style.position = 'relative'
  container.style.overflow = 'hidden'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})

async function mount(node: React.ReactNode) {
  await act(async () => { root.render(node) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
}

function query<T extends Element = HTMLElement>(testId: string): T {
  // Radix Dialog 渲染在 body 级 portal，先查容器再回退全文档。
  const node = container.querySelector<T>(`[data-testid="${testId}"]`)
    ?? document.body.querySelector<T>(`[data-testid="${testId}"]`)
  if (!node) throw new Error(`missing [data-testid="${testId}"]`)
  return node
}

async function setInputValue(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')?.set?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/* ===== 演示装配：一个接线完整的展示壳，回调全部上抛到本组件状态 ===== */

interface PlotShellDemoProps {
  canvases?: PlotCanvasSidebarEntry[]
  initialSearch?: string
  initialSelectedId?: string | null
  initialCollapsed?: boolean
  initialInfoOpen?: boolean
  initialDialogOpen?: boolean
  emptyMode?: 'no-canvas' | 'empty-canvas'
}

function PlotShellDemo({
  canvases = plotCanvasSidebarFixtures,
  initialSearch = '',
  initialSelectedId = null,
  initialCollapsed = false,
  initialInfoOpen = false,
  initialDialogOpen = false,
  emptyMode,
}: PlotShellDemoProps) {
  const [tab, setTab] = useState<PlotCanvasSidebarTab>('plot')
  const [search, setSearch] = useState(initialSearch)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [infoOpen, setInfoOpen] = useState(initialInfoOpen)
  const [dialogOpen, setDialogOpen] = useState(initialDialogOpen)
  const [activeTool, setActiveTool] = useState<string | null>('pan')
  const [createdTitle, setCreatedTitle] = useState('')
  const [events, setEvents] = useState<string[]>([])

  const queryText = search.trim().toLowerCase()
  const visible = queryText
    ? canvases.filter(canvas => canvas.name.toLowerCase().includes(queryText))
    : canvases
  const selected = canvases.find(canvas => canvas.id === selectedId) ?? null
  const breadcrumb = selected?.level
    ? canvases.filter(item => item.level === 0).slice(0, selected.level)
    : []
  const resolvedEmptyMode = emptyMode ?? (selected ? 'empty-canvas' : canvases.length === 0 ? 'no-canvas' : 'no-canvas')

  return (
    <>
      <PlotCanvasShell
        sidebarCollapsed={collapsed}
        onSidebarExpand={() => setCollapsed(false)}
        sidebar={
          <PlotCanvasSidebar
            activeTab={tab}
            onTabChange={setTab}
            canvases={visible}
            totalCount={canvases.length}
            searchValue={search}
            onSearchChange={setSearch}
            selectedCanvasId={selectedId}
            onSelectCanvas={setSelectedId}
            onCreateCanvas={() => setDialogOpen(true)}
            onCollapse={() => setCollapsed(true)}
          />
        }
        topbar={
          <PlotCanvasTopbar
            canvasName={selected?.name ?? null}
            breadcrumb={breadcrumb}
            onBreadcrumbSelect={id => setSelectedId(id)}
            onOpenCanvasSelector={() => setDialogOpen(true)}
            onAddEvent={() => setEvents(previous => [...previous, 'event'])}
            addEventDisabled={!selected}
            onToggleSearch={() => setSearch(search ? '' : '归墟')}
            filtersDisabled={!selected}
            onOpenInfo={() => setInfoOpen(previous => !previous)}
            infoActive={infoOpen}
          />
        }
        toolRail={
          <PlotCanvasToolRail
            groups={createDefaultPlotCanvasToolGroups({ activeToolId: activeTool, dotGridActive: true })}
            onToolSelect={setActiveTool}
            collapsed={false}
            onToggleCollapsed={() => setActiveTool(null)}
          />
        }
        canvas={null}
        emptyOverlay={
          <PlotCanvasEmptyState
            mode={resolvedEmptyMode}
            onCreateCanvas={() => setDialogOpen(true)}
            onAddEvent={() => setEvents(previous => [...previous, 'event'])}
          />
        }
        rightPanel={
          infoOpen ? (
            <PlotCanvasInfoPanel
              canvasName={selected?.name ?? null}
              description={selected?.description ?? null}
              nodeCount={events.length}
              edgeCount={0}
              onClose={() => setInfoOpen(false)}
            />
          ) : null
        }
      />
      <CreatePlotCanvasDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={values => {
          setCreatedTitle(values.title)
          setDialogOpen(false)
        }}
      />
      <span data-testid="plot-shell-demo-created" hidden>{createdTitle}</span>
    </>
  )
}

/* ===== 行为断言 ===== */

describe('PlotCanvasSidebar', () => {
  it('渲染目录：页签、计数、选中高亮、层级缩进与描述，回调上抛', async () => {
    const onSelectCanvas = vi.fn()
    const onSearchChange = vi.fn()
    const onTabChange = vi.fn()
    await mount(
      <PlotCanvasSidebar
        activeTab="plot"
        onTabChange={onTabChange}
        canvases={plotCanvasSidebarFixtures}
        totalCount={plotCanvasSidebarFixtures.length}
        searchValue=""
        onSearchChange={onSearchChange}
        selectedCanvasId="pca-1"
        onSelectCanvas={onSelectCanvas}
        onCreateCanvas={() => {}}
      />,
    )
    expect(query('plot-canvas-sidebar').textContent).toContain('剧情编排')
    expect(query('plot-canvas-sidebar').textContent).toContain('剧情画布 / 子画布')
    expect(query('plot-canvas-sidebar-count').textContent).toContain('4 个画布')
    expect(query('plot-canvas-sidebar-tab-plot').getAttribute('aria-selected')).toBe('true')
    expect(query('plot-canvas-sidebar-tab-chapter').getAttribute('aria-selected')).toBe('false')

    const items = container.querySelectorAll('[data-testid="plot-canvas-sidebar-item"]')
    expect(items).toHaveLength(plotCanvasSidebarFixtures.length)
    expect(items[0].querySelector('button')?.getAttribute('aria-current')).toBe('true')
    expect(items[0].textContent).toContain('第一卷 · 归墟主线')
    expect(items[0].textContent).toContain('渔村灭门')
    // 子画布缩进
    const secondBtn = items[1].querySelector('button')
    expect(secondBtn).toBeTruthy()
    expect(items[1].querySelector('.plot-canvas-sidebar__item-indent')).toBeTruthy()

    await act(async () => { (items[2].querySelector('button') as HTMLButtonElement).click() })
    expect(onSelectCanvas).toHaveBeenCalledWith('pca-3')

    await setInputValue(query<HTMLInputElement>('plot-canvas-sidebar-search'), '归墟')
    expect(onSearchChange).toHaveBeenCalledWith('归墟')

    await act(async () => { query<HTMLButtonElement>('plot-canvas-sidebar-tab-chapter').click() })
    expect(onTabChange).toHaveBeenCalledWith('chapter')
  })

  it('搜索过滤态显示匹配数与空态，无画布显示📭空列表', async () => {
    await mount(
      <PlotCanvasSidebar
        activeTab="plot"
        canvases={plotCanvasSidebarFixtures.filter(item => item.id === 'pca-1')}
        totalCount={4}
        searchValue="归墟"
      />,
    )
    expect(query('plot-canvas-sidebar-count').textContent).toContain('1 匹配')

    await mount(
      <PlotCanvasSidebar activeTab="plot" canvases={[]} totalCount={4} searchValue="不存在" />,
    )
    expect(query('plot-canvas-sidebar-empty').textContent).toContain('未找到匹配的画布')

    await mount(
      <PlotCanvasSidebar activeTab="plot" canvases={emptyPlotCanvasFixtures} totalCount={0} searchValue="" />,
    )
    expect(query('plot-canvas-sidebar-empty').textContent).toContain('暂无剧情画布')
    expect(query('plot-canvas-sidebar-empty').textContent).toContain('📭')
  })
})

describe('PlotCanvasTopbar', () => {
  it('无回调时禁用操作入口，避免出现无效按钮', async () => {
    await mount(<PlotCanvasTopbar canvasName={null} />)
    expect(query<HTMLButtonElement>('plot-canvas-picker').disabled).toBe(true)
    expect(query<HTMLButtonElement>('plot-canvas-add-event').disabled).toBe(true)
    expect(query<HTMLButtonElement>('plot-canvas-topbar-search').disabled).toBe(true)
    expect(query<HTMLButtonElement>('plot-canvas-topbar-filters').disabled).toBe(true)
    expect(query<HTMLButtonElement>('plot-canvas-topbar-info').disabled).toBe(true)
  })
  it('无画布时显示占位并禁用新增事件；回调上抛选择器/新增/搜索/筛选/信息', async () => {
    const onOpenCanvasSelector = vi.fn()
    const onAddEvent = vi.fn()
    const onToggleSearch = vi.fn()
    const onOpenFilters = vi.fn()
    const onOpenInfo = vi.fn()
    await mount(
      <PlotCanvasTopbar
        canvasName={null}
        onOpenCanvasSelector={onOpenCanvasSelector}
        onAddEvent={onAddEvent}
        addEventDisabled
        onToggleSearch={onToggleSearch}
        onOpenFilters={onOpenFilters}
        filtersDisabled
        onOpenInfo={onOpenInfo}
      />,
    )
    expect(query('plot-canvas-picker').textContent).toContain('选择剧情画布')
    expect(query<HTMLButtonElement>('plot-canvas-add-event').disabled).toBe(true)
    expect(query<HTMLButtonElement>('plot-canvas-topbar-filters').disabled).toBe(true)

    await act(async () => { query<HTMLButtonElement>('plot-canvas-picker').click() })
    expect(onOpenCanvasSelector).toHaveBeenCalledTimes(1)
    await act(async () => { query<HTMLButtonElement>('plot-canvas-topbar-search').click() })
    expect(onToggleSearch).toHaveBeenCalledTimes(1)
    await act(async () => { query<HTMLButtonElement>('plot-canvas-topbar-info').click() })
    expect(onOpenInfo).toHaveBeenCalledTimes(1)
  })

  it('有画布时展示画布名与面包屑，面包屑可返回父级', async () => {
    const onBreadcrumbSelect = vi.fn()
    await mount(
      <PlotCanvasTopbar
        canvasName="藏书阁夜遇 · 子画布"
        breadcrumb={[{ id: 'pca-1', name: '第一卷 · 归墟主线' }]}
        onBreadcrumbSelect={onBreadcrumbSelect}
        onAddEvent={() => {}}
      />,
    )
    const breadcrumb = query('plot-canvas-breadcrumb')
    expect(breadcrumb.textContent).toContain('第一卷 · 归墟主线')
    await act(async () => { (breadcrumb.querySelector('button') as HTMLButtonElement).click() })
    expect(onBreadcrumbSelect).toHaveBeenCalledWith('pca-1')
  })
})

describe('PlotCanvasToolRail', () => {
  it('渲染分组与分隔线，active/disabled 生效，点击上抛工具 id', async () => {
    const onToolSelect = vi.fn()
    const groups = createDefaultPlotCanvasToolGroups({ activeToolId: 'pan', dotGridActive: true })
    groups[0].items[0].disabled = true
    await mount(<PlotCanvasToolRail groups={groups} onToolSelect={onToolSelect} onToggleCollapsed={() => {}} />)

    expect(query('plot-canvas-tool-pan').className).toContain('is-active')
    expect(query('plot-canvas-tool-dot-grid').className).toContain('is-active')
    expect(query<HTMLButtonElement>('plot-canvas-tool-inspiration-reserve').disabled).toBe(true)
    expect(query('plot-canvas-tool-pan').getAttribute('data-tip')).toBe('平移画布')
    expect(container.querySelectorAll('.plot-shell__toolrail-divider').length).toBeGreaterThanOrEqual(2)

    await act(async () => { query<HTMLButtonElement>('plot-canvas-tool-select').click() })
    expect(onToolSelect).toHaveBeenCalledWith('select')
  })
})

describe('PlotCanvasEmptyState', () => {
  it('no-canvas 引导新建画布；empty-canvas 引导手动新增事件且不渲染假 AI 入口', async () => {
    const onCreateCanvas = vi.fn()
    await mount(<PlotCanvasEmptyState mode="no-canvas" onCreateCanvas={onCreateCanvas} />)
    const card = query('plot-canvas-empty-card')
    expect(card.textContent).toContain('选择一个剧情画布')
    expect(card.textContent).toContain('从左侧目录选择一个剧情画布')
    await act(async () => { query<HTMLButtonElement>('plot-canvas-empty-create').click() })
    expect(onCreateCanvas).toHaveBeenCalledTimes(1)

    const onAddEvent = vi.fn()
    await mount(<PlotCanvasEmptyState mode="empty-canvas" onAddEvent={onAddEvent} />)
    const guide = query('plot-canvas-empty-card')
    expect(guide.textContent).toContain('开始构建剧情')
    expect(guide.textContent).toContain('新增剧情事件')
    expect(container.textContent).not.toContain('AI 智能初始化')
    await act(async () => { query<HTMLButtonElement>('plot-canvas-empty-add-event').click() })
    expect(onAddEvent).toHaveBeenCalledTimes(1)

    // aiSlot 扩展位：提供时才渲染。
    await mount(<PlotCanvasEmptyState mode="empty-canvas" aiSlot={<span>预留位</span>} />)
    expect(container.textContent).toContain('预留位')
  })
})

describe('CreatePlotCanvasDialog', () => {
  it('标题必填校验、聚焦、提交上抛 trim 值，Escape 关闭', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn()
    await mount(<CreatePlotCanvasDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    const dialog = query('plot-canvas-create-dialog')
    expect(dialog.textContent).toContain('新增剧情画布')
    expect(query('plot-canvas-create-title-hint').textContent).toContain('请填写画布标题')
    expect(query<HTMLInputElement>('plot-canvas-create-title-input').maxLength).toBe(120)
    expect(query<HTMLTextAreaElement>('plot-canvas-create-description-input').maxLength).toBe(2000)
    expect(query<HTMLButtonElement>('plot-canvas-create-submit').disabled).toBe(true)
    // 打开后自动聚焦标题输入框
    expect(document.activeElement?.id).toBe('plot-canvas-create-title')

    await setInputValue(query<HTMLInputElement>('plot-canvas-create-title-input'), '  第一卷主线  ')
    await setInputValue(query<HTMLTextAreaElement>('plot-canvas-create-description-input'), ' 主线剧情 ')
    await act(async () => { query<HTMLButtonElement>('plot-canvas-create-submit').click() })
    expect(onSubmit).toHaveBeenCalledWith({ title: '第一卷主线', description: '主线剧情' })

    // Escape 关闭：Radix 的 DismissableLayer 监听 document keydown。
    await mount(<PlotShellDemo key="dialog-escape" initialDialogOpen />)
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    expect(container.querySelector('[data-testid="plot-canvas-create-dialog"]')).toBeNull()

    // 提交后由父级关闭：Radix 的 Presence 会等关闭动画结束再卸载。
    await mount(<PlotShellDemo key="dialog-close" initialDialogOpen />)
    await setInputValue(query<HTMLInputElement>('plot-canvas-create-title-input'), '第一卷主线')
    await act(async () => { query<HTMLButtonElement>('plot-canvas-create-submit').click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    expect(query('plot-shell-demo-created').textContent).toContain('第一卷主线')
    expect(container.querySelector('[data-testid="plot-canvas-create-dialog"]')).toBeNull()
  })
  it('initialTitle/initialDescription 打开时预填（重命名复用）', async () => {
    await mount(
      <CreatePlotCanvasDialog
        open
        onOpenChange={() => {}}
        initialTitle="已有画布"
        initialDescription="旧描述"
        onSubmit={() => {}}
      />,
    )
    expect(query<HTMLInputElement>('plot-canvas-create-title-input').value).toBe('已有画布')
    expect(query<HTMLTextAreaElement>('plot-canvas-create-description-input').value).toBe('旧描述')
  })
})

describe('PlotCanvasInfoPanel', () => {
  it('展示标题/描述/统计，空画布给出新增事件引导，关闭回调上抛', async () => {
    const onClose = vi.fn()
    await mount(
      <PlotCanvasInfoPanel canvasName="第一卷 · 归墟主线" description="铜牌指引的归墟之门。" nodeCount={4} edgeCount={3} onClose={onClose} />,
    )
    expect(query('plot-canvas-info-name').textContent).toContain('第一卷 · 归墟主线')
    expect(query('plot-canvas-info-stats').textContent).toContain('4 个节点')
    expect(query('plot-canvas-info-stats').textContent).toContain('3 条连线')
    expect(container.querySelector('[data-testid="plot-canvas-info-empty"]')).toBeNull()
    await act(async () => { query<HTMLButtonElement>('plot-canvas-info-close').click() })
    expect(onClose).toHaveBeenCalledTimes(1)

    await mount(<PlotCanvasInfoPanel canvasName={null} nodeCount={0} edgeCount={0} />)
    expect(container.textContent).toContain('该画布还没有节点')
    expect(container.textContent).toContain('新增事件')
  })
})

describe('PlotCanvasShell assembly', () => {
  it('插槽装配：折叠目录、展开、信息面板开关、新增事件计数', async () => {
    await mount(<PlotShellDemo initialSelectedId="pca-1" initialInfoOpen />)
    expect(query('plot-canvas-shell')).toBeTruthy()
    expect(query('plot-canvas-sidebar').textContent).toContain('第一卷 · 归墟主线')
    expect(query('plot-canvas-picker').textContent).toContain('第一卷 · 归墟主线')
    expect(query('plot-canvas-info-name').textContent).toContain('第一卷 · 归墟主线')
    expect(container.querySelectorAll('.plot-shell__right-panel')).toHaveLength(1)

    await act(async () => { query<HTMLButtonElement>('plot-canvas-add-event').click() })
    expect(query('plot-canvas-info-stats').textContent).toContain('1 个节点')

    await act(async () => { query<HTMLButtonElement>('plot-canvas-sidebar-collapse').click() })
    expect(query('plot-canvas-shell-sidebar-rail')).toBeTruthy()
    expect(container.querySelector('[data-testid="plot-canvas-sidebar"]')).toBeNull()

    await act(async () => { query<HTMLButtonElement>('plot-canvas-shell-sidebar-expand').click() })
    expect(query('plot-canvas-sidebar')).toBeTruthy()
  })

  it('完整装配走一遍：搜索过滤 → 选中 → 空画布新增事件 → 打开创建对话框提交', async () => {
    await mount(<PlotShellDemo />)
    // 空状态：尚未选中画布
    expect(query('plot-canvas-empty-state').getAttribute('data-mode')).toBe('no-canvas')

    // 选中一个空画布 → empty-canvas 引导
    await act(async () => { (query('plot-canvas-sidebar-item').querySelector('button') as HTMLButtonElement).click() })
    expect(query('plot-canvas-empty-state').getAttribute('data-mode')).toBe('empty-canvas')
    await act(async () => { query<HTMLButtonElement>('plot-canvas-empty-add-event').click() })

    // 新建画布对话框
    await act(async () => { query<HTMLButtonElement>('plot-canvas-create-entry').click() })
    await setInputValue(query<HTMLInputElement>('plot-canvas-create-title-input'), '第三卷 · 潮汐暗流')
    await act(async () => { query<HTMLButtonElement>('plot-canvas-create-submit').click() })
    expect(query('plot-shell-demo-created').textContent).toContain('第三卷 · 潮汐暗流')
    expect(container.querySelector('[data-testid="plot-canvas-create-dialog"]')).toBeNull()
  })
})

/* ===== 截图采集 ===== */

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)) })
}

async function shoot(name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` })
}

describe('plot shell screenshots', () => {
  it('captures light 1264×900 (empty canvas guide + no-canvas), 2516×1289, dark, dialog', async () => {
    // 1) 主视觉目标：1264×900，已选空画布 → “开始构建剧情”引导卡片
    await page.viewport(1264, 900)
    await mount(<PlotShellDemo initialSelectedId="pca-1" />)
    await settle()
    await shoot('plot-shell-light-1264-empty-canvas')

    // 2) 参考辅助截图：空目录 → “选择一个剧情画布”
    await mount(<PlotShellDemo key="no-canvas" canvases={emptyPlotCanvasFixtures} emptyMode="no-canvas" />)
    await settle()
    await shoot('plot-shell-light-1264-no-canvas')

    // 3) 宽屏 2516×1289
    await page.viewport(2516, 1289)
    await mount(<PlotShellDemo key="wide" initialSelectedId="pca-1" initialInfoOpen />)
    await settle()
    await shoot('plot-shell-light-2516-empty-canvas')

    // 4) 创建对话框
    await page.viewport(1264, 900)
    await mount(<PlotShellDemo key="dialog" initialSelectedId="pca-1" initialDialogOpen />)
    await settle()
    await shoot('plot-shell-light-1264-dialog')

    // 5) 深色主题（ember）
    document.documentElement.setAttribute('data-theme', 'ember')
    document.documentElement.className = 'dark'
    await mount(<PlotShellDemo key="dark" initialSelectedId="pca-1" initialInfoOpen />)
    await settle()
    await shoot('plot-shell-dark-1264-empty-canvas')
  })
})
