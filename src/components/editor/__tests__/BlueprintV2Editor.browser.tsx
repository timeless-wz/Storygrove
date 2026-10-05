import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'

import type { ChapterBlueprintV2Content } from '../../../shared/blueprint-v2'
import type { ProjectData, ProjectSessionContext } from '../../../shared/ipc-channels'
import { createBusinessFieldDocumentIdentity } from '../../../shared/document-editing'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import '../../../index.css'
import '../../../styles/literary-themes.css'
import BlueprintV2Editor from '../BlueprintV2Editor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const projectSession: ProjectSessionContext = {
  projectId: 'blueprint-v2-document-editor-project',
  leaseId: 'blueprint-v2-document-editor-lease',
  projectPath: 'C:/fixtures/document-editor-pages/blueprint-v2',
}
const project = {
  id: projectSession.projectId,
  path: projectSession.projectPath,
  sessionLease: projectSession.leaseId,
} as ProjectData
let latestEmittedContent: ChapterBlueprintV2Content | undefined
const FIRST_SCENE_ID = 'bps-11111111-1111-4111-8111-111111111111'
const SECOND_SCENE_ID = 'bps-22222222-2222-4222-8222-222222222222'
const CUSTOM_SECTION_ID = 'custom-a1b2c3d4'

function editorContent(): ChapterBlueprintV2Content {
  return {
    schemaVersion: 2,
    chapterNumber: 12,
    chapterTitle: '第12章｜熄火',
    docPreamble: '',
    origin: 'import',
    sections: [{
      kind: 'canonical',
      id: 'storyboard',
      title: '【逐场分镜拆解】',
      level: 4,
      preamble: '',
      postamble: '',
      items: [
        {
          kind: 'scene',
          id: FIRST_SCENE_ID,
          level: 5,
          title: '场景一：站台',
          markdown: '## 时空与环境\n\n- **时空与环境**：雨夜。\n  - 末班车即将进站。\n\n### 现场迹象\n\n站牌正在漏电。\n',
          presence: 'off-canvas',
        },
        { kind: 'block', id: 'bpc-11111111-1111-4111-8111-111111111111', markdown: '\n场景间的自由说明。\n' },
        {
          kind: 'scene',
          id: SECOND_SCENE_ID,
          level: 5,
          title: '场景二：候车厅',
          markdown: '## 对白推进\n\n- **对白推进**：\n  - 许渡：“谁？”\n',
          presence: 'off-canvas',
        },
      ],
    }, {
      kind: 'custom',
      id: CUSTOM_SECTION_ID,
      title: '【未归类背景】',
      level: 2,
      body: '## 自定义正文\n\n保留为独立 Markdown 字段。\n',
    }],
  }
}

function Harness() {
  const [content, setContent] = useState(editorContent)
  return <BlueprintV2Editor content={content} onChange={next => {
    latestEmittedContent = next
    setContent(next)
  }} />
}

function sceneContent(content: ChapterBlueprintV2Content, sceneId: string): string {
  const item = content.sections.flatMap(section => section.kind === 'canonical' ? section.items : [])
    .find(candidate => candidate.kind === 'scene' && candidate.id === sceneId)
  return item?.kind === 'scene' ? item.markdown : ''
}

function customBody(content: ChapterBlueprintV2Content): string {
  return content.sections.find(section => section.kind === 'custom')?.body ?? ''
}

async function typeAtEndOfMarkdown(testId: string, value: string): Promise<void> {
  const scope = container?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const prose = scope?.querySelector<HTMLElement>('.vditor-ir pre.vditor-reset')
  expect(scope).not.toBeNull()
  expect(prose).not.toBeNull()
  await act(async () => {
    prose!.focus()
    const range = document.createRange()
    range.selectNodeContents(prose!.lastElementChild ?? prose!)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    await userEvent.keyboard(value)
  })
}

beforeEach(async () => {
  await page.viewport(1280, 960)
  latestEmittedContent = undefined
  setActiveProjectSessionContext(projectSession)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ ...originalProjectState, currentProject: project, projectSessionEpoch: 1 })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  await act(async () => {
    await vi.waitFor(() => {
      expect(container?.querySelectorAll('[data-vditor-prose-editor][data-vditor-ready="true"]')).toHaveLength(3)
    }, { timeout: 20_000 })
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount())
    root = undefined
  }
  container?.remove()
  container = undefined
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  setActiveProjectSessionContext(null)
})

describe('BlueprintV2Editor', () => {
  it('keeps chapter title and scene identities while exposing long Markdown editors for each scene and custom section', async () => {
    expect(container!.querySelectorAll('[data-testid^="blueprint-v2-section-"]')).toHaveLength(1)
    expect(container!.querySelectorAll('[data-testid^="blueprint-v2-missing-section-"]')).toHaveLength(6)
    expect(container!.querySelector('[data-testid="blueprint-v2-section-storyboard"]')).toBeTruthy()

    const scenes = Array.from(container!.querySelectorAll<HTMLElement>('[data-testid="blueprint-v2-scene"]'))
    expect(scenes.map(scene => scene.dataset.sceneId)).toEqual([FIRST_SCENE_ID, SECOND_SCENE_ID])
    expect(scenes.map(scene => scene.querySelector<HTMLInputElement>('.blueprint-v2__scene-title')?.value)).toEqual([
      '场景一：站台', '场景二：候车厅',
    ])
    expect(container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${FIRST_SCENE_ID}"]`)?.getAttribute('data-document-identity')).toBe(
      createBusinessFieldDocumentIdentity({
        projectId: projectSession.projectId,
        entityType: 'blueprint-v2-scene',
        entityId: `chapter-12:${FIRST_SCENE_ID}`,
        fieldId: 'markdown',
      }),
    )
    expect(container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${SECOND_SCENE_ID}"]`)?.getAttribute('data-document-identity')).toBe(
      createBusinessFieldDocumentIdentity({
        projectId: projectSession.projectId,
        entityType: 'blueprint-v2-scene',
        entityId: `chapter-12:${SECOND_SCENE_ID}`,
        fieldId: 'markdown',
      }),
    )
    expect(container!.querySelector('[data-testid="blueprint-v2-custom-body-editor"]')?.getAttribute('data-document-identity')).toBe(
      createBusinessFieldDocumentIdentity({
        projectId: projectSession.projectId,
        entityType: 'blueprint-v2-custom-section',
        entityId: `chapter-12:${CUSTOM_SECTION_ID}`,
        fieldId: 'body',
      }),
    )
    expect(container!.querySelectorAll('[data-document-layout="business-field"][data-heading-toc="enabled"]')).toHaveLength(0)
    expect(container!.querySelectorAll('[data-document-layout="business-field"][data-heading-toc="disabled"]')).toHaveLength(3)
    for (const field of container!.querySelectorAll<HTMLElement>('.blueprint-v2__markdown-field')) {
      expect(field.style.height).toBe('')
      expect(getComputedStyle(field.querySelector('.vditor-toolbar')!).display).toBe('none')
    }
    expect(container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${FIRST_SCENE_ID}"] .vditor-ir h2`)?.textContent)
      .toContain('时空与环境')
    const compactSceneHeight = container!.querySelector<HTMLElement>(
      `[data-testid="blueprint-v2-scene-markdown-${SECOND_SCENE_ID}"]`,
    )!.getBoundingClientRect().height
    expect(compactSceneHeight).toBeLessThan(210)
  })

  it('routes scene and custom-body edits only to their matching stable fields', async () => {
    const firstSurface = container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${FIRST_SCENE_ID}"]`)
    const secondSurface = container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${SECOND_SCENE_ID}"]`)
    const customSurface = container!.querySelector('[data-testid="blueprint-v2-custom-body-editor"]')
    expect(firstSurface).not.toBeNull()
    expect(secondSurface).not.toBeNull()
    expect(customSurface).not.toBeNull()

    await typeAtEndOfMarkdown(`blueprint-v2-scene-markdown-${FIRST_SCENE_ID}`, '\n场景一的新动作')
    await vi.waitFor(() => expect(latestEmittedContent).toBeDefined())
    expect(latestEmittedContent?.chapterNumber).toBe(12)
    expect(latestEmittedContent?.chapterTitle).toBe('第12章｜熄火')
    expect(sceneContent(latestEmittedContent!, FIRST_SCENE_ID)).toContain('场景一的新动作')
    expect(sceneContent(latestEmittedContent!, SECOND_SCENE_ID)).toBe(sceneContent(editorContent(), SECOND_SCENE_ID))
    expect(customBody(latestEmittedContent!)).toBe(customBody(editorContent()))

    await typeAtEndOfMarkdown('blueprint-v2-custom-body-editor', '\n自定义备注新增内容')
    await vi.waitFor(() => expect(latestEmittedContent && customBody(latestEmittedContent)).toContain('自定义备注新增内容'))
    expect(sceneContent(latestEmittedContent!, FIRST_SCENE_ID)).toContain('场景一的新动作')
    expect(sceneContent(latestEmittedContent!, SECOND_SCENE_ID)).toBe(sceneContent(editorContent(), SECOND_SCENE_ID))
    expect(customBody(latestEmittedContent!)).toContain('自定义备注新增内容')
  })

  it('drag reorders official scene items while preserving prose and intervening blocks', () => {
    const first = FIRST_SCENE_ID
    const second = SECOND_SCENE_ID
    const source = container!.querySelector<HTMLButtonElement>(`[data-testid="blueprint-v2-scene-drag-${first}"]`)!
    const target = container!.querySelector<HTMLElement>(`[data-scene-id="${second}"]`)!
    const dataTransfer = new DataTransfer()

    act(() => {
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    })

    const order = Array.from(container!.querySelectorAll<HTMLElement>('[data-testid="blueprint-v2-scene"]'))
      .map(scene => scene.dataset.sceneId)
    expect(order).toEqual([second, first])
    expect(container!.querySelector<HTMLTextAreaElement>('[data-testid="blueprint-v2-block-item"] textarea')?.value)
      .toBe('\n场景间的自由说明。\n')
    expect(container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${second}"] .vditor-ir pre.vditor-reset`)?.textContent)
      .toContain('许渡')
    expect(container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${first}"] .vditor-ir pre.vditor-reset`)?.textContent)
      .toContain('末班车即将进站')
    expect(container!.querySelector(`[data-testid="blueprint-v2-scene-markdown-${first}"]`)?.getAttribute('data-document-identity')).toBe(
      createBusinessFieldDocumentIdentity({
        projectId: projectSession.projectId,
        entityType: 'blueprint-v2-scene',
        entityId: `chapter-12:${first}`,
        fieldId: 'markdown',
      }),
    )
  })
})
