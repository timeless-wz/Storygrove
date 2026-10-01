import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import { getBlueprintV2Scenes, type ChapterBlueprintV2Content } from '../../../shared/blueprint-v2'
import { parseChapterBlueprintMarkdown } from '../../../shared/blueprint-v2-markdown'
import { useLocaleStore } from '../../../stores/locale-store'
import BlueprintV2ImportDialog from '../BlueprintV2ImportDialog'
import chapterOneMarkdown from '../../../../test/fixtures/blueprint-v2/chapter-01.md?raw'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT_PATH = 'C:\\novels\\blueprint-import-dialog'
const PROJECT_SESSION: ProjectSessionContext = {
  projectId: 'blueprint-import-dialog',
  leaseId: 'blueprint-import-dialog-lease',
  projectPath: PROJECT_PATH,
}
const MARKDOWN = [
  '# 第2章｜导入预览',
  '',
  '#### 【本章定位与四维指标】',
  '- **核心使命**：保留人物选择带来的后果。',
  '',
  '#### 【逐场分镜拆解】',
  '##### 场景一：雨夜站台',
  '- **动作与对白**：',
  '  - 许渡：“谁在那里？”',
  '',
  '#### 自定义要求',
  '这一段没有对应规范分区，保留原文。',
].join('\n')

let root: Root | undefined
let container: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn>
const onClose = vi.fn(() => {})
const onImported = vi.fn((_chapterNumber: number) => {})
let persistedContent: ChapterBlueprintV2Content | null
const originalLocaleState = useLocaleStore.getState()

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN' })
  setActiveProjectSessionContext(PROJECT_SESSION)
  persistedContent = null
  invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:blueprint-v2-get') return null
    if (channel === 'db:blueprint-v2-save') {
      persistedContent = (args[0] as { content: ChapterBlueprintV2Content }).content
      return { success: true, revision: 1, contentHash: 'test' }
    }
    throw new Error(`unexpected IPC ${channel}`)
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })
  onClose.mockClear()
  onImported.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(
    <BlueprintV2ImportDialog
      open
      onClose={onClose}
      chapters={[{ chapterNumber: 1, title: '接错的人' }, { chapterNumber: 2, title: '旧标题' }]}
      projectSession={PROJECT_SESSION}
      projectKey={PROJECT_PATH}
      onImported={onImported}
    />,
  ))
})

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount())
    root = undefined
  }
  container?.remove()
  container = undefined
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useLocaleStore.setState(originalLocaleState)
})

async function clickButton(testId: string) {
  const button = await vi.waitFor(() => {
    const found = document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
    if (!found) throw new Error(`button ${testId} not found`)
    return found
  })
  await act(async () => button.click())
}

describe('BlueprintV2ImportDialog', () => {
  it('previews target project, canonical mappings and unclassified content; cancel writes nothing', async () => {
    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-testid="blueprint-v2-import-raw"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, MARKDOWN)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton('blueprint-v2-import-preview-btn')

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'db:blueprint-v2-get', 2, PROJECT_PATH, PROJECT_SESSION,
    ))
    expect(document.body.querySelector('[data-testid="blueprint-v2-import-project"]')?.textContent).toContain(PROJECT_PATH)
    expect(document.body.querySelector('[data-testid="blueprint-v2-preview-canonical"]')?.textContent).toContain('本章定位与四维指标')
    expect(document.body.querySelector('[data-testid="blueprint-v2-preview-custom"]')?.textContent).toContain('自定义要求')
    expect(document.body.querySelector('[data-testid="blueprint-v2-preview-custom"]')?.textContent).toContain('这一段没有对应规范分区')
    expect(document.body.querySelector('[data-testid="blueprint-v2-preview-scenes"]')?.textContent).toContain('场景一：雨夜站台')

    await clickButton('blueprint-v2-import-cancel-preview')
    expect(onClose).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalledWith('db:blueprint-v2-save', expect.anything(), expect.anything())
  })

  it('imports the full Chapter 1 fixture after preview with all seven sections and four scene bodies intact', async () => {
    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-testid="blueprint-v2-import-raw"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, chapterOneMarkdown)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton('blueprint-v2-import-preview-btn')

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'db:blueprint-v2-get', 1, PROJECT_PATH, PROJECT_SESSION,
    ))
    expect(document.body.querySelectorAll('[data-testid="blueprint-v2-preview-canonical"]')).toHaveLength(7)
    expect(document.body.querySelector('[data-testid="blueprint-v2-preview-scenes"]')?.textContent)
      .toContain('场景四：开出地图的末班车')
    await clickButton('blueprint-v2-import-confirm')

    await vi.waitFor(() => expect(persistedContent).not.toBeNull())
    expect(persistedContent!.chapterNumber).toBe(1)
    expect(persistedContent!.sections.filter(section => section.kind === 'canonical')).toHaveLength(7)
    const importedScenes = getBlueprintV2Scenes(persistedContent!)
    const expectedScenes = getBlueprintV2Scenes(parseChapterBlueprintMarkdown(chapterOneMarkdown).content)
    expect(importedScenes.map(scene => scene.title)).toEqual(expectedScenes.map(scene => scene.title))
    expect(importedScenes.map(scene => scene.markdown)).toEqual(expectedScenes.map(scene => scene.markdown))
    expect(importedScenes[3].markdown).toContain('周晓：“……值守员同志，我想报警。”')
    expect(importedScenes[3].markdown).toContain('这辆车在往天上开！')
    expect(onImported).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
