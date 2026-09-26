import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { useLocaleStore } from '../../../stores/locale-store'
import DraftEditor from '../DraftEditor'
import { ANIME_SKIN_URL } from '../../settings/AppearanceSettings'

// Import all styling
import '../../../index.css'
import '../../../styles/literary-themes.css'
import '../../../styles/literary-workbench.css'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\theme-capture'
const PROJECT_SESSION = Object.freeze({
  projectId: 'theme-capture-project',
  leaseId: 'theme-capture-lease',
  projectPath: PROJECT_PATH,
})
const TAB_ID = 'tab-theme-capture'
const FILE_PATH = 'vela://draft/1'

const NOVEL_CHAPTER_CONTENT = `# 第一章 逆流之航

江风如刀，割裂了漫天铅灰色的江雾。

苏砚站在残破的渡船舷侧，指尖触碰着冰冷的铁索。江水在他脚下汹涌撞击，激起层层惨白的水沫，沉入深不见底的旋涡之中。

> “凡入此江者，皆逆命而行，无退路，无归途。”

他低声默念着那卷古籍上残存的谶语。十年前，青石镇的一场大火吞噬了整座藏经阁，也抹去了宗族在这片大陆上存在过的最后痕迹。

风暴在天际线聚拢，第一滴雨终于落在了船板上。`

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  await page.viewport(1280, 820)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  container = document.createElement('div')
  container.style.width = '100vw'
  container.style.height = '100vh'
  container.style.position = 'relative'
  container.style.display = 'flex'
  container.style.flexDirection = 'column'
  container.style.overflow = 'hidden'
  document.body.style.margin = '0'
  document.body.style.padding = '0'
  document.body.style.width = '100vw'
  document.body.style.height = '100vh'
  document.body.style.overflow = 'hidden'
  document.body.append(container)
  root = createRoot(container)

  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:draft-get-meta') {
      return {
        id: 1,
        chapterNumber: 1,
        version: 1,
        status: 'draft',
        source: 'write',
        contentId: 100,
        wordCount: NOVEL_CHAPTER_CONTENT.length,
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
      }
    }
    if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 1, title: '逆流之航' }]
    if (channel === 'db:draft-list') return [{ id: 1, version: 1 }]
    if (channel === 'db:revision-get-pending' || channel === 'db:review-list') return []
    if (channel === 'db:foreshadowing-list-by-draft') return [
      {
        id: 'fs-1',
        draftId: 1,
        chapterNumber: 1,
        selectedText: '那卷古籍上残存的谶语',
        startOffset: 120,
        endOffset: 132,
        note: '主角身世与古籍之谜',
        completed: false,
        markerType: '埋伏',
        color: 'blue',
      }
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
      name: '逆流之航',
      path: PROJECT_PATH,
      sessionLease: PROJECT_SESSION.leaseId,
      novelConfig: {
        writingLanguage: 'zh-CN',
        genre: 'fantasy',
        subGenre: '东方玄幻',
        targetAudience: 'all',
        totalChapters: 80,
        wordsPerChapter: 3500,
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
      name: '第1章 v1',
      type: 'chapter',
      filePath: FILE_PATH,
      projectKey: PROJECT_PATH,
      content: NOVEL_CHAPTER_CONTENT,
      savedContent: NOVEL_CHAPTER_CONTENT,
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

async function waitReady(): Promise<void> {
  await act(async () => {
    await vi.waitFor(
      () => {
        const ready = container.querySelector('[data-vditor-ready="true"]')
        if (!ready) throw new Error('not ready')
      },
      { timeout: 15000 },
    )
  })
  // Give Vditor rendering and styling a moment to paint
  await new Promise((r) => setTimeout(r, 600))
}

describe('workbench theme screenshots capture', () => {
  it('captures light theme screenshot', async () => {
    document.documentElement.setAttribute('data-theme', 'storyforge')
    document.documentElement.className = ''
    await act(async () => {
      root.render(
        <DraftEditor
          key="light"
          tabId={TAB_ID}
          filePath={FILE_PATH}
          content={NOVEL_CHAPTER_CONTENT}
          projectKey={PROJECT_PATH}
        />
      )
    })
    await waitReady()
    await page.screenshot({ path: 'screenshots/screenshot-light.png' })
  })

  it('captures dark theme screenshot', async () => {
    document.documentElement.setAttribute('data-theme', 'ember')
    document.documentElement.className = 'dark'
    await act(async () => {
      root.render(
        <DraftEditor
          key="dark"
          tabId={TAB_ID}
          filePath={FILE_PATH}
          content={NOVEL_CHAPTER_CONTENT}
          projectKey={PROJECT_PATH}
        />
      )
    })
    await waitReady()
    await page.screenshot({ path: 'screenshots/screenshot-dark.png' })
  })

  it('captures starlight mixed theme screenshot', async () => {
    document.documentElement.setAttribute('data-theme', 'starlight')
    document.documentElement.className = ''
    await act(async () => {
      root.render(
        <DraftEditor
          key="starlight"
          tabId={TAB_ID}
          filePath={FILE_PATH}
          content={NOVEL_CHAPTER_CONTENT}
          projectKey={PROJECT_PATH}
        />
      )
    })
    await waitReady()
    await page.screenshot({ path: 'screenshots/screenshot-starlight.png' })
  })

  it.each(['anime', 'custom'] as const)('captures starlight with %s image skin', async (skin) => {
    document.documentElement.setAttribute('data-theme', 'starlight')
    document.documentElement.className = ''
    container.classList.add('app-skin-root')
    container.dataset.theme = 'starlight'
    container.dataset.skin = skin
    container.dataset.skinReadability = 'high-contrast'
    await act(async () => {
      root.render(<>
        <div className="app-skin-background" aria-hidden="true" style={skin === 'custom' ? { background: 'linear-gradient(130deg, #261d45, #b46888 55%, #e1b97d)' } : undefined}>
          {skin === 'anime' && <img src={ANIME_SKIN_URL} alt="" className="app-skin-background-image" />}
        </div>
        <DraftEditor
          key={`starlight-${skin}`}
          tabId={TAB_ID}
          filePath={FILE_PATH}
          content={NOVEL_CHAPTER_CONTENT}
          projectKey={PROJECT_PATH}
        />
      </>)
    })
    await waitReady()
    await page.screenshot({ path: `screenshots/screenshot-starlight-${skin}.png` })
  })
})
