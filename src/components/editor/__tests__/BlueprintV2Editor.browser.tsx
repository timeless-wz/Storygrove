import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ChapterBlueprintV2Content } from '../../../shared/blueprint-v2'
import { useLocaleStore } from '../../../stores/locale-store'
import BlueprintV2Editor from '../BlueprintV2Editor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const originalLocaleState = useLocaleStore.getState()

function editorContent(): ChapterBlueprintV2Content {
  return {
    schemaVersion: 2,
    chapterNumber: 1,
    chapterTitle: '第1章｜接错的人',
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
          id: 'bps-11111111-1111-4111-8111-111111111111',
          level: 5,
          title: '场景一：站台',
          markdown: '- **时空与环境**：雨夜。\n  - 末班车即将进站。\n',
          presence: 'off-canvas',
        },
        { kind: 'block', id: 'bpc-11111111-1111-4111-8111-111111111111', markdown: '\n场景间的自由说明。\n' },
        {
          kind: 'scene',
          id: 'bps-22222222-2222-4222-8222-222222222222',
          level: 5,
          title: '场景二：候车厅',
          markdown: '- **对白推进**：\n  - 许渡：“谁？”\n',
          presence: 'off-canvas',
        },
      ],
    }],
  }
}

function Harness() {
  const [content, setContent] = useState(editorContent)
  return <BlueprintV2Editor content={content} onChange={setContent} />
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
})

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount())
    root = undefined
  }
  container?.remove()
  container = undefined
  useLocaleStore.setState(originalLocaleState)
})

describe('BlueprintV2Editor', () => {
  it('shows all seven canonical sections and edits the full Markdown bodies', () => {
    expect(container!.querySelectorAll('[data-testid^="blueprint-v2-section-"]')).toHaveLength(1)
    expect(container!.querySelectorAll('[data-testid^="blueprint-v2-missing-section-"]')).toHaveLength(6)
    expect(container!.querySelector('[data-testid="blueprint-v2-section-storyboard"]')).toBeTruthy()

    const bodies = Array.from(container!.querySelectorAll<HTMLTextAreaElement>('.blueprint-v2__scene-markdown'))
    expect(bodies.map(body => body.value)).toEqual([
      '- **时空与环境**：雨夜。\n  - 末班车即将进站。\n',
      '- **对白推进**：\n  - 许渡：“谁？”\n',
    ])
    expect(container!.querySelector('[data-testid="blueprint-v2-scene-drag-bps-11111111-1111-4111-8111-111111111111"]')).toBeTruthy()
  })

  it('drag reorders official scene items while preserving prose and intervening blocks', () => {
    const first = 'bps-11111111-1111-4111-8111-111111111111'
    const second = 'bps-22222222-2222-4222-8222-222222222222'
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
    expect(Array.from(container!.querySelectorAll<HTMLTextAreaElement>('.blueprint-v2__scene-markdown')).map(input => input.value)).toEqual([
      '- **对白推进**：\n  - 许渡：“谁？”\n',
      '- **时空与环境**：雨夜。\n  - 末班车即将进站。\n',
    ])
  })
})
