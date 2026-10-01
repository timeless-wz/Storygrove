import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import DraftEditor from '../DraftEditor'

// Import all styling
import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\chapter-chrome'
const PROJECT_SESSION = Object.freeze({
  projectId: 'chapter-chrome-project',
  leaseId: 'chapter-chrome-lease',
  projectPath: PROJECT_PATH,
})
const TAB_ID = 'tab-chapter-chrome'
const FILE_PATH = 'vela://draft/1'

const CHAPTER_CONTENT = `# 第一章 接错的人

雨是从后半夜开始下的，落在青石板上，像有人在屋檐下数着一串铜钱。

陈屿把最后一盏灯吹灭，坐在黑暗里等。他知道那个人会来，只是不确定来的会是哪一个。

门外响起三下叩门声，不轻不重，刚好能让人听见。`

const CHAPTER_CHROME_LABELS = [
  '标记为伏笔',
  '绑定蓝图',
  '本章上下文',
  '参考上下文',
  'AI 审稿',
  '发布到正文',
]

let root: Root
let container: HTMLDivElement

/** color-mix() 的计算值会以 color(srgb 0..1 0..1 0..1) 形式出现，这里两种写法都收 */
function rgbOf(css: string): [number, number, number] {
  const modern = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (modern) {
    return [1, 2, 3].map(index => Number.parseFloat(modern[index]) * 255) as [number, number, number]
  }
  const legacy = css.match(/rgba?\(([^)]+)\)/)
  if (!legacy) throw new Error(`not an rgb color: ${css}`)
  const [r, g, b] = legacy[1].split(',').map(part => Number.parseFloat(part.trim()))
  return [r, g, b]
}

function relativeLuminance(css: string): number {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgbOf(css)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function mountEditor(theme: string, content: string = CHAPTER_CONTENT) {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.className = theme === 'ember' ? 'dark' : ''
  return act(async () => {
    root.render(
      <DraftEditor
        key={theme}
        tabId={TAB_ID}
        filePath={FILE_PATH}
        content={content}
        projectKey={PROJECT_PATH}
      />,
    )
  })
}

async function waitReady(): Promise<void> {
  await act(async () => {
    await vi.waitFor(
      () => {
        if (!container.querySelector('[data-vditor-ready="true"]')) throw new Error('not ready')
      },
      { timeout: 15000 },
    )
  })
  await new Promise(resolve => setTimeout(resolve, 600))
}

function bar(): HTMLElement {
  return container.querySelector<HTMLElement>('.draft-chapter-bar')!
}

function paper(): HTMLElement {
  return container.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')!
}

beforeEach(async () => {
  await page.viewport(1600, 1000)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  container.style.cssText = 'width:100vw;height:100vh;display:flex;flex-direction:column;overflow:hidden;'
  document.body.style.cssText = 'margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;'
  document.body.append(container)
  root = createRoot(container)

  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:draft-get-meta') {
      return {
        id: 1,
        chapterNumber: 1,
        version: 2,
        status: 'draft',
        source: 'write',
        contentId: 100,
        wordCount: CHAPTER_CONTENT.length,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
      }
    }
    if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 1, title: '接错的人' }]
    if (channel === 'db:blueprint-list-summary') return [{ chapterNumber: 1, title: '接错的人' }]
    if (channel === 'db:draft-list') return [{ id: 1, version: 2 }]
    if (channel === 'db:revision-get-pending' || channel === 'db:review-list') return []
    if (channel === 'db:foreshadowing-list-by-draft') return [
      { id: 'fs-1', draftId: 1, chapterNumber: 1, selectedText: '像有人在屋檐下数着一串铜钱', startOffset: 20, endOffset: 34, note: '雨声与铜钱', completed: false, markerType: '埋伏', color: 'blue' },
      { id: 'fs-2', draftId: 1, chapterNumber: 1, selectedText: '门外响起三下叩门声', startOffset: 96, endOffset: 105, note: '来客身份', completed: false, markerType: '悬念', color: 'red' },
    ]
    if (channel === 'db:draft-update-content') return { success: true }
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

  useProjectStore.setState({
    currentProject: {
      id: PROJECT_SESSION.projectId,
      name: '接错的人',
      path: PROJECT_PATH,
      sessionLease: PROJECT_SESSION.leaseId,
      novelConfig: {
        writingLanguage: 'zh-CN',
        genre: 'fantasy',
        subGenre: '悬疑',
        targetAudience: 'all',
        totalChapters: 60,
        wordsPerChapter: 3000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
      },
      characterStates: '',
      createdAt: '',
      updatedAt: '',
    },
  })
  setActiveProjectSessionContext(PROJECT_SESSION)
  useEditorStore.setState({
    tabs: [{
      id: TAB_ID,
      name: '第1章 v2',
      type: 'chapter',
      filePath: FILE_PATH,
      projectKey: PROJECT_PATH,
      content: CHAPTER_CONTENT,
      savedContent: CHAPTER_CONTENT,
      contentRevision: 0,
      dirty: false,
      draftId: 1,
      chapterNumber: 1,
      draftStatus: 'draft',
    }],
    activeTabId: TAB_ID,
    draftLedgers: {},
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
})

describe('chapter creation page chrome', () => {
  it('keeps every chapter action reachable and gives the page a single solid commit action', async () => {
    await mountEditor('storyforge')
    await waitReady()

    // 每个章节动作依然按无障碍名可找到
    for (const label of CHAPTER_CHROME_LABELS) {
      await expect.element(page.getByRole('button', { name: label })).toBeVisible()
    }

    // 栏够宽时次要动作带文字（窄栏收起文字的规则见下一个用例）
    const quietLabel = bar().querySelector<HTMLElement>('.draft-action--quiet .draft-action-label')!
    expect(getComputedStyle(quietLabel).display).not.toBe('none')

    // 全页只有一个实心强调色按钮：发布到正文；AI 审稿改用主题色描边
    const publish = page.getByRole('button', { name: '发布到正文' }).element() as HTMLElement
    const review = page.getByRole('button', { name: 'AI 审稿' }).element() as HTMLElement
    expect(getComputedStyle(publish).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(review).backgroundColor).toBe('rgba(0, 0, 0, 0)')

    await page.screenshot({ path: '../../../../output/playwright/creation-page-storyforge.png' })
  })

  it('reads the chapter identity before the actions and keeps the sheet above the desk', async () => {
    await mountEditor('storyforge')
    await waitReady()

    const barElement = bar()
    const identity = barElement.querySelector<HTMLElement>('.draft-chapter-identity')!
    const actions = barElement.querySelector<HTMLElement>('.draft-chapter-actions')!

    expect(identity.textContent).toContain('第 1 章')
    expect(identity.textContent).toContain('接错的人')
    expect(identity.textContent).toContain('v2')
    expect(identity.textContent).toContain('草稿')
    expect(identity.getBoundingClientRect().right).toBeLessThanOrEqual(actions.getBoundingClientRect().left)

    // 桌面 < 外壳 ≤ 纸面：纸面始终是整页最亮的一层
    const deskTone = relativeLuminance(getComputedStyle(container.querySelector<HTMLElement>('.vditor-ir')!).backgroundColor)
    const chromeTone = relativeLuminance(getComputedStyle(barElement).backgroundColor)
    const paperTone = relativeLuminance(getComputedStyle(paper()).backgroundColor)
    expect(deskTone).toBeLessThan(chromeTone)
    expect(paperTone).toBeGreaterThanOrEqual(chromeTone)

    // 外壳区配外壳墨色：标题必须在外壳底色上读得清
    const title = barElement.querySelector<HTMLElement>('.draft-chapter-title')!
    expect(contrastRatio(getComputedStyle(title).color, getComputedStyle(barElement).backgroundColor)).toBeGreaterThanOrEqual(4.5)

    // 中文占位符不再用浏览器合成的斜体
    expect(getComputedStyle(paper(), '::before').fontStyle).toBe('normal')

    // 纸面比外壳圆一档，控件比纸面锐一档
    expect(getComputedStyle(paper()).borderTopLeftRadius).toBe('8px')
  })

  // ember 是深色外壳配深色纸面，starlight 是深色外壳配象牙纸面（混合主题）。
  // 后者最容易出事：把纸面的深墨放到深色外壳上就等于让标题消失。
  it.each(['ember', 'starlight'])('keeps the surface order and the bar ink readable in %s', async (theme) => {
    await mountEditor(theme)
    await waitReady()

    const barElement = bar()
    const deskTone = relativeLuminance(getComputedStyle(container.querySelector<HTMLElement>('.vditor-ir')!).backgroundColor)
    const chromeTone = relativeLuminance(getComputedStyle(barElement).backgroundColor)
    const paperTone = relativeLuminance(getComputedStyle(paper()).backgroundColor)
    expect(deskTone).toBeLessThan(chromeTone)
    expect(paperTone).toBeGreaterThanOrEqual(chromeTone)

    for (const selector of ['.draft-chapter-title', '.draft-chapter-index', '.draft-chapter-version', '.draft-chapter-status']) {
      const node = barElement.querySelector<HTMLElement>(selector)!
      expect(
        contrastRatio(getComputedStyle(node).color, getComputedStyle(barElement).backgroundColor),
        `${theme} ${selector} on the chapter bar`,
      ).toBeGreaterThanOrEqual(4.5)
    }

    await page.screenshot({ path: `../../../../output/playwright/creation-page-${theme}.png` })
  })

  it('sets an empty chapter on a quiet sheet instead of an italicised prompt', async () => {
    useEditorStore.setState({
      tabs: [{
        id: TAB_ID,
        name: '第1章 v2',
        type: 'chapter',
        filePath: FILE_PATH,
        projectKey: PROJECT_PATH,
        content: '',
        savedContent: '',
        contentRevision: 0,
        dirty: false,
        draftId: 1,
        chapterNumber: 1,
        draftStatus: 'draft',
      }],
      activeTabId: TAB_ID,
      draftLedgers: {},
    })
    await mountEditor('storyforge', '')
    await waitReady()

    const placeholder = getComputedStyle(paper(), '::before')
    expect(placeholder.fontStyle).toBe('normal')
    expect(placeholder.opacity).toBe('1')
    // 纸面不得比章节栏更暗（空格子不该变成一块灰板）。现行设计契约：
    // 章节栏与正文工具栏共用同一块纸面（document-toolbar.css「共用一块纸面」），
    // 因此两者同色即为达标，不再要求纸面严格更亮。
    expect(relativeLuminance(getComputedStyle(paper()).backgroundColor)).toBeGreaterThanOrEqual(
      relativeLuminance(getComputedStyle(bar()).backgroundColor),
    )

    await page.screenshot({ path: '../../../../output/playwright/creation-page-empty-chapter.png' })
  })

  it('drops the secondary action labels before the chapter bar has to wrap', async () => {
    await page.viewport(1100, 820)
    await mountEditor('storyforge')
    await waitReady()

    const quietLabel = bar().querySelector<HTMLElement>('.draft-action--quiet .draft-action-label')!
    expect(getComputedStyle(quietLabel).display).toBe('none')

    // 落笔动作在任何宽度下都保留文字
    const publishLabel = page.getByRole('button', { name: '发布到正文' }).element() as HTMLElement
    expect(publishLabel.textContent).toContain('发布到正文')
    expect(getComputedStyle(publishLabel).whiteSpace).toBe('nowrap')

    // 章节栏仍然是一行
    await expect.element(page.getByRole('button', { name: '下一章' })).toBeVisible()
    await page.screenshot({ path: '../../../../output/playwright/creation-page-compact.png' })
  })
})
