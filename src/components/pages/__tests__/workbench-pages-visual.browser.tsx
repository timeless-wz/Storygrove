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

import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useWorldMapStore } from '../../../stores/world-map-store'
import { useStoryTimelineStore } from '../../../stores/story-timeline-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useEditorStore } from '../../../stores/editor-store'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TEST_PROJECT_PATH = 'D:/novels/unwritten-book'

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(async () => {
  await page.viewport(1280, 860)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  document.documentElement.setAttribute('data-theme', 'storyforge')
  document.documentElement.className = ''

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
  it('渲染并截图书斋首页（含最近项目、新书插槽与焦点作品）', async () => {
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
        <WelcomePage
          onNewProject={() => {}}
          onOpenProject={() => {}}
          onImportNovel={() => {}}
        />,
      )
    })

    // 等待渲染稳定
    await new Promise((r) => setTimeout(r, 100))
    expect(container?.textContent).toContain('继续创作')
    await page.screenshot({ path: 'screenshots/welcome-page.png' })

    const heroTitle = container?.querySelector('#welcome-hero-title') as HTMLElement
    const inkProbe = document.createElement('span')
    document.body.append(inkProbe)
    for (const theme of ['inkwash', 'starlight', 'storyforge']) {
      document.documentElement.setAttribute('data-theme', theme)
      inkProbe.style.color = 'var(--sample-ink)'
      expect(getComputedStyle(heroTitle).color).toBe(getComputedStyle(inkProbe).color)
    }
    document.documentElement.setAttribute('data-theme', 'paper')
    inkProbe.style.color = 'var(--color-text)'
    expect(getComputedStyle(heroTitle).color).toBe(getComputedStyle(inkProbe).color)
    inkProbe.remove()
    document.documentElement.setAttribute('data-theme', 'storyforge')

    const heroSecondary = container?.querySelector<HTMLButtonElement>('.literary-hero-actions button:not(.literary-hero-primary-btn)')
    expect(getComputedStyle(heroSecondary!).color).toBe('rgb(236, 240, 220)')
    expect(getComputedStyle(heroSecondary!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')

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
    await page.screenshot({ path: 'screenshots/welcome-empty.png' })
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
