import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

import WelcomePage from '../WelcomePage'
import ProjectOverviewPage from '../ProjectOverviewPage'
import NewProjectDialog from '../../dialogs/NewProjectDialog'
import TitleBar from '../../layout/TitleBar'
import HomeSidebarPanel from '../../panels/sidebar/HomeSidebarPanel'

import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useHomeSurfaceStore } from '../../../stores/home-surface-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TEST_PROJECT_PATH = 'D:/novels/unwritten-book'

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(async () => {
  await page.viewport(1280, 860)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useHomeSurfaceStore.setState({ surface: 'home', category: 'notes', notes: [] })
  useLayoutStore.setState({ sidebarView: 'home' })
  document.documentElement.setAttribute('data-theme', 'storyforge')
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-backdrop-blur')
  document.documentElement.removeAttribute('data-page-wallpaper')

  container = document.createElement('div')
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.position = 'relative'
  container.style.display = 'flex'
  container.style.flexDirection = 'column'
  container.style.overflow = 'hidden'
  container.style.backgroundColor = 'var(--color-bg)'
  container.style.color = 'var(--color-text)'

  document.body.style.margin = '0'
  document.body.style.padding = '0'
  document.body.style.width = '100%'
  document.body.style.height = '100%'
  document.body.style.overflow = 'hidden'
  document.body.append(container)
  root = createRoot(container)

  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:draft-get-full') return { content: '# 第七章\n已保存正文' }
    if (channel === 'db:draft-get-meta') return { id: 7, chapterNumber: 7, version: 1, status: 'draft' }
    if (channel === 'db:blueprint-get-all') {
      return [
        { chapterNumber: 1, title: '初涉灵渊', userGuidance: '主角踏入古遗迹' },
        { chapterNumber: 2, title: '剑魄初醒', userGuidance: '激活上古残剑' },
        { chapterNumber: 3, title: '风起云涌', userGuidance: '各方势力齐聚青石城' },
      ]
    }
    if (channel === 'dialog:select-folder') {
      return 'D:/novels/my-new-story'
    }
    return null
  })

  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      setZoomLevel: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
  })
})

afterEach(() => {
  setActiveProjectSessionContext(null)
  if (root) {
    act(() => {
      root?.unmount()
    })
    root = undefined
  }
  container?.remove()
  container = undefined
  vi.restoreAllMocks()
})

describe('工作台首页与项目总览视觉渲染与截图', () => {
  it('渲染并截图书斋首页（含最近项目、双入口与焦点作品）', async () => {
    document.documentElement.setAttribute('data-theme', 'inkwash')
    document.documentElement.setAttribute('data-backdrop-blur', 'standard')
    document.documentElement.setAttribute('data-page-wallpaper', 'visible')
    useProjectStore.setState({
      currentProject: {
        id: 'proj-unwritten-book',
        name: '未竟之书：苍穹之下极北远征长歌行',
        path: TEST_PROJECT_PATH,
        sessionLease: 'lease-test-1',
        characterStates: '',
        createdAt: '2026-09-24T12:00:00Z',
        updatedAt: '2026-09-26T12:00:00Z',
        novelConfig: {
          writingLanguage: 'zh-CN',
          genre: '东方玄幻',
          subGenre: '古典仙侠',
          targetAudience: '传统奇幻爱好者',
          totalChapters: 58,
          wordsPerChapter: 3000,
          plotStructure: 'three_act',
          narrativePOV: 'third_limited',
          coreOutline: '主角于乱世之中探索古仙门覆灭真相，孤舟逆流，执剑向天。',
          worldSetting: '九荒十域，灵气衰竭的末法余烬时代。',
          goldenFinger: '识海中的推演残镜',
          protagonistProfile: '性格沉稳，杀伐果决，唯念旧约。',
          globalGuidance: '',
        },
      },
      recentProjects: [
        {
          name: '未竟之书：苍穹之下极北远征长歌行',
          path: TEST_PROJECT_PATH,
          updatedAt: '2026-09-26T12:00:00.000Z',
        },
        {
          name: '玻璃天文台与隐秘之海',
          path: 'D:/novels/glass-observatory',
          updatedAt: '2026-09-25T18:30:00.000Z',
        },
        {
          name: '蒸汽纪元的发条炼金师',
          path: 'D:/novels/clockwork-alchemist',
          updatedAt: '2026-09-24T09:15:00.000Z',
        },
      ],
    })
    setActiveProjectSessionContext({ projectId: 'proj-unwritten-book', leaseId: 'lease-test-1', projectPath: TEST_PROJECT_PATH })

    useDraftStore.setState({
      dataProjectKey: TEST_PROJECT_PATH,
      draftsByChapter: {
        7: [{
          id: 7, chapterNumber: 7, version: 1, status: 'draft', source: 'write',
          wordCount: 1200, createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-26T10:00:00Z',
          fileName: 'draft_v1.md', filePath: 'vela://draft/7',
        }],
      },
    })

    await act(async () => {
      root?.render(
        <div className="app-skin-root flex flex-col w-full h-full overflow-hidden" data-skin="classic" data-theme="inkwash">
          <div className="app-skin-background" aria-hidden="true" />
          <TitleBar />
          <div className="writer-desktop-shell flex flex-1 min-h-0 overflow-hidden">
            <div className="literary-sidebar w-[260px] shrink-0"><HomeSidebarPanel /></div>
            <WelcomePage onNewProject={() => {}} onOpenProject={() => {}} onImportNovel={() => {}} />
          </div>
        </div>,
      )
    })

    // 等待渲染稳定
    await new Promise((r) => setTimeout(r, 100))
    expect(container?.textContent).toContain('继续创作')
    await page.screenshot({ path: '../../../../output/playwright/hero-home-desktop.png' })
    await page.viewport(1600, 960)
    await page.screenshot({ path: '../../../../output/playwright/hero-home-wide-wallpaper.png' })
    await page.viewport(1280, 860)

    const heroTitle = container?.querySelector('#welcome-hero-title') as HTMLElement
    const wallpaper = container?.querySelector('.app-skin-background') as HTMLElement
    const homeSurface = container?.querySelector('.writer-shell-surface.literary-home') as HTMLElement
    expect(getComputedStyle(homeSurface).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    let inkwashBackground = ''
    for (const theme of ['inkwash', 'starlight', 'storyforge', 'paper']) {
      document.documentElement.setAttribute('data-theme', theme)
      expect(getComputedStyle(heroTitle).color).toBe('rgb(243, 246, 239)')
      if (theme === 'inkwash') inkwashBackground = getComputedStyle(wallpaper).backgroundImage
      if (theme === 'storyforge') expect(getComputedStyle(wallpaper).backgroundImage).not.toBe(inkwashBackground)
    }
    document.documentElement.style.setProperty('--shell-background', 'var(--color-bg)')
    expect(getComputedStyle(wallpaper).backgroundImage).toBe('none')
    document.documentElement.style.removeProperty('--shell-background')
    document.documentElement.setAttribute('data-theme', 'storyforge')

    document.documentElement.setAttribute('data-backdrop-blur', 'off')
    document.documentElement.setAttribute('data-page-wallpaper', 'visible')
    const shell = container?.querySelector('.app-skin-root') as HTMLElement
    for (const theme of ['storyforge', 'gilded', 'verdant']) {
      document.documentElement.setAttribute('data-theme', theme)
      shell.setAttribute('data-theme', theme)
      expect(getComputedStyle(wallpaper).backgroundImage).toContain('url(')
      await page.screenshot({ path: `../../../../output/playwright/home-${theme}-clear.png` })
    }
    // Simulate the persisted anime skin arriving after the initial classic render.
    // The theme wallpaper must not blink away when the async skin state resolves.
    document.documentElement.setAttribute('data-theme', 'storyforge')
    shell.setAttribute('data-theme', 'storyforge')
    const themeWallpaperBeforeSkinRestore = getComputedStyle(wallpaper).backgroundImage
    shell.setAttribute('data-skin', 'anime')
    shell.setAttribute('data-skin-readability', 'high-contrast')
    const animeArt = document.createElement('img')
    animeArt.className = 'app-skin-background-image'
    animeArt.src = './skins/anime-night.webp'
    wallpaper.appendChild(animeArt)
    expect(getComputedStyle(wallpaper).backgroundImage).toBe(themeWallpaperBeforeSkinRestore)
    expect(getComputedStyle(homeSurface).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(animeArt).maskImage).toContain('linear-gradient')
    expect(getComputedStyle(animeArt).mixBlendMode).toBe('luminosity')
    await page.screenshot({ path: '../../../../output/playwright/home-storyforge-anime-restored.png' })
    document.documentElement.setAttribute('data-page-wallpaper', 'hidden')
    document.documentElement.style.setProperty('--shell-background', 'var(--color-bg)')
    expect(getComputedStyle(wallpaper).backgroundImage).toBe('none')
    expect(getComputedStyle(animeArt).display).toBe('none')
    document.documentElement.style.removeProperty('--shell-background')
    document.documentElement.removeAttribute('data-backdrop-blur')
    document.documentElement.removeAttribute('data-page-wallpaper')
    shell.setAttribute('data-theme', 'inkwash')
    document.documentElement.setAttribute('data-theme', 'storyforge')

    expect(container?.querySelector('.literary-deconstruct-card')).not.toBeNull()
    expect(container?.querySelectorAll('.literary-project-card')).toHaveLength(3)
    expect(container?.querySelector('.literary-tip-card')).toBeNull()

    await act(async () => {
      (container?.querySelector('.literary-hero-primary-btn') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => expect(useEditorStore.getState().tabs).toContainEqual(expect.objectContaining({
      draftId: 7,
      chapterNumber: 7,
      projectKey: TEST_PROJECT_PATH,
      content: '# 第七章\n已保存正文',
    })))
  })

  it('渲染并截图书斋首页空书架状态', async () => {
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [],
    })

    await act(async () => {
      root?.render(
        <WelcomePage
          onNewProject={() => {}}
          onOpenProject={() => {}}
          onImportNovel={() => {}}
        />,
      )
    })

    await new Promise((r) => setTimeout(r, 100))
    await page.screenshot({ path: 'screenshots/codex-home-redesign-empty.png' })
  })

  it('灵感便签可在本次会话保存并从全局素材库查看，拆书入口调用既有向导', async () => {
    useProjectStore.setState({ currentProject: null, recentProjects: [] })
    const onImportNovel = vi.fn()
    await act(async () => {
      root?.render(<WelcomePage onNewProject={vi.fn()} onOpenProject={vi.fn()} onImportNovel={onImportNovel} />)
    })
    await act(async () => { await page.getByRole('button', { name: '记下一条灵感' }).click() })
    await act(async () => { await page.getByPlaceholder('写下灵感……').fill('雨夜里无人认得归来的主角') })
    await act(async () => { await page.getByPlaceholder('标签，用逗号分隔').fill('主角, 场景') })
    await act(async () => { await page.getByRole('button', { name: '保存到本次会话' }).click() })
    expect(useHomeSurfaceStore.getState().notes).toMatchObject([{ content: '雨夜里无人认得归来的主角', tags: ['主角', '场景'] }])
    await act(async () => { await page.getByRole('button', { name: '打开素材库' }).click() })
    expect(container?.textContent).toContain('雨夜里无人认得归来的主角')
    await act(async () => { await page.getByRole('button', { name: '对标作品' }).click() })
    await act(async () => { await page.getByRole('button', { name: '导入到项目' }).click() })
    expect(onImportNovel).toHaveBeenCalledOnce()
  })

  it('窄容器把双入口和素材区按阅读顺序排列', async () => {
    await page.viewport(720, 860)
    useProjectStore.setState({ currentProject: null, recentProjects: [] })
    await act(async () => {
      root?.render(<WelcomePage onNewProject={vi.fn()} onOpenProject={vi.fn()} onImportNovel={vi.fn()} />)
    })
    const continueCard = container?.querySelector('.literary-continue-card')?.getBoundingClientRect()
    const deconstructCard = container?.querySelector('.literary-deconstruct-card')?.getBoundingClientRect()
    const inspiration = container?.querySelector('.literary-inspiration-section')?.getBoundingClientRect()
    const library = container?.querySelector('.literary-resource-library-card')?.getBoundingClientRect()
    expect(deconstructCard!.top).toBeGreaterThanOrEqual(continueCard!.bottom - 1)
    expect(library!.top).toBeGreaterThanOrEqual(inspiration!.bottom - 1)
  })

  it('14 套文学主题都为拆书标题提供可读的面板对比度', async () => {
    useProjectStore.setState({ currentProject: null, recentProjects: [] })
    await act(async () => {
      root?.render(<WelcomePage onNewProject={vi.fn()} onOpenProject={vi.fn()} onImportNovel={vi.fn()} />)
    })
    const panel = container?.querySelector<HTMLElement>('.literary-deconstruct-card')
    const title = container?.querySelector<HTMLElement>('#deconstruct-title')
    const action = container?.querySelector<HTMLElement>('.literary-deconstruct-card button')
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0]
      const linear = channels.map(value => {
        const channel = color.startsWith('color(srgb ') ? value : value / 255
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
      })
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
    }
    for (const theme of ['storyforge', 'inkwash', 'mist', 'paper-ink', 'apricot', 'vellum', 'gilded', 'verdant', 'silver-blue', 'dusk', 'ember', 'starlight', 'starlight-dark', 'cosmic-glass']) {
      document.documentElement.setAttribute('data-theme', theme)
      const foreground = luminance(getComputedStyle(title!).color)
      const background = luminance(getComputedStyle(panel!).backgroundColor)
      const ratio = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
      expect(ratio, theme).toBeGreaterThanOrEqual(3)
      const actionForeground = luminance(getComputedStyle(action!).color)
      const actionBackground = luminance(getComputedStyle(action!).backgroundColor)
      const actionRatio = (Math.max(actionForeground, actionBackground) + .05) / (Math.min(actionForeground, actionBackground) + .05)
      expect(actionRatio, theme).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('渲染并截图项目总览（含 4 步创作阶梯、真实指标与阶段分组）', async () => {
    useProjectStore.setState({
      currentProject: {
        id: 'proj-unwritten-book',
        name: '未竟之书：苍穹之下极北远征长歌行',
        path: TEST_PROJECT_PATH,
        sessionLease: 'lease-test-1',
        characterStates: '',
        createdAt: '2026-09-24T12:00:00Z',
        updatedAt: '2026-09-26T12:00:00Z',
        novelConfig: {
          writingLanguage: 'zh-CN',
          genre: '东方玄幻',
          subGenre: '古典仙侠',
          targetAudience: '传统奇幻读者',
          totalChapters: 58,
          wordsPerChapter: 3000,
          plotStructure: 'three_act',
          narrativePOV: 'third_limited',
          coreOutline: '主角苏砚踏入古遗迹，探寻宗族覆灭的终极隐秘。',
          worldSetting: '九荒十域，灵气衰竭时代。',
          goldenFinger: '推演残镜',
          protagonistProfile: '心坚如铁，执念求真。',
          globalGuidance: '',
        },
      },
    })

    useDraftStore.setState({
      draftsByChapter: {
        1: [
          {
            id: 1,
            chapterNumber: 1,
            version: 1,
            fileName: '第 1 章 逆流之航.md',
            filePath: `${TEST_PROJECT_PATH}/chapters/ch-1.md`,
            wordCount: 3450,
            status: 'draft',
            source: 'write',
            createdAt: '2026-09-25T10:00:00Z',
            updatedAt: '2026-09-25T12:00:00Z',
          },
        ],
        2: [
          {
            id: 2,
            chapterNumber: 2,
            version: 1,
            fileName: '第 2 章 剑魄初醒.md',
            filePath: `${TEST_PROJECT_PATH}/chapters/ch-2.md`,
            wordCount: 3280,
            status: 'draft',
            source: 'write',
            createdAt: '2026-09-25T14:00:00Z',
            updatedAt: '2026-09-25T16:00:00Z',
          },
        ],
      },
    })

    useWorldMapStore.setState({
      maps: [
        { id: 'm-1', name: '青石城与沧澜江流域', parentMapId: null, sortOrder: 1, image: null },
        { id: 'm-2', name: '太苍古遗迹层级', parentMapId: null, sortOrder: 2, image: null },
      ],
      nodes: [
        { id: 'n-1', mapId: 'm-1', name: '青石古渡', x: 200, y: 300, type: 'city', description: '', parentId: null, sourceRefs: [] },
        { id: 'n-2', mapId: 'm-1', name: '归墟暗流', x: 450, y: 550, type: 'relic', description: '', parentId: null, sourceRefs: [] },
        { id: 'n-3', mapId: 'm-2', name: '断剑残冢', x: 800, y: 700, type: 'relic', description: '', parentId: null, sourceRefs: [] },
      ],
      edges: [
        { id: 'e-1', mapId: 'm-1', fromNodeId: 'n-1', toNodeId: 'n-2', type: 'route', description: '渡船水道', status: 'active' },
      ],
      loadAll: vi.fn(async () => {}),
    })

    useStoryTimelineStore.setState({
      dataProjectKey: TEST_PROJECT_PATH,
      events: [
        { id: 'ev-1', title: '夜半登渡船', status: 'drafted', sortOrder: 1, timeLabel: '', precision: 'unknown', description: '', chapterNumbers: [1], characterNames: [], locationNodeIds: [] },
        { id: 'ev-2', title: '残剑破空出世', status: 'planned', sortOrder: 2, timeLabel: '', precision: 'unknown', description: '', chapterNumbers: [2], characterNames: [], locationNodeIds: [] },
        { id: 'ev-3', title: '青石镇旧案真相', status: 'finalized', sortOrder: 3, timeLabel: '', precision: 'unknown', description: '', chapterNumbers: [3], characterNames: [], locationNodeIds: [] },
      ],
    })

    useCharacterStore.setState({
      characters: [
        { name: '苏砚', role: 'protagonist', gender: '男', age: '二十三', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '' },
        { name: '云清浅', role: 'supporting', gender: '女', age: '二十一', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '' },
        { name: '灰袍老者', role: 'supporting', gender: '男', age: '六十', appearance: '', personality: '', background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '' },
      ],
      loadCharacters: vi.fn(async () => {}),
    })

    await act(async () => {
      root?.render(<ProjectOverviewPage />)
    })

    await new Promise((r) => setTimeout(r, 120))
    expect(container?.textContent).toContain('2 张图')
    expect(container?.textContent).toContain('3 个事件')
    await page.screenshot({ path: 'screenshots/project-overview.png' })

    const populatedDrafts = useDraftStore.getState().draftsByChapter
    await act(async () => useDraftStore.setState({ draftsByChapter: {} }))
    await act(async () => {
      (container?.querySelector('.literary-hero-primary-btn') as HTMLButtonElement).click()
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('新建章节草稿')
    await act(async () => useDraftStore.setState({ draftsByChapter: populatedDrafts }))
  })

  it('渲染并截图窄窗口紧凑响应式总览', async () => {
    await page.viewport(720, 860)

    await act(async () => {
      root?.render(<ProjectOverviewPage />)
    })

    await new Promise((r) => setTimeout(r, 120))
    await page.screenshot({ path: 'screenshots/overview-compact.png' })
  })

  it('渲染并截图新书立项弹窗', async () => {
    await act(async () => {
      root?.render(<NewProjectDialog open={true} onClose={() => {}} />)
    })

    await new Promise((r) => setTimeout(r, 100))
    await page.screenshot({ path: 'screenshots/new-project-dialog.png' })

    await page.getByLabelText('保存位置').fill('D:/novels/old-location')
    await act(async () => root?.render(<NewProjectDialog open={false} onClose={() => {}} />))
    await act(async () => root?.render(<NewProjectDialog open={true} onClose={() => {}} />))
    expect((document.querySelector('#novel-project-path') as HTMLInputElement).value).toBe('')
  })
})
