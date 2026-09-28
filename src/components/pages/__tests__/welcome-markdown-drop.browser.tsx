import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WelcomePage from '../WelcomePage'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useHomeSurfaceStore } from '../../../stores/home-surface-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: null, recentProjects: [] })
  useDraftStore.setState({ draftsByChapter: {}, dataProjectKey: null } as never)
  useHomeSurfaceStore.setState({ surface: 'home', category: 'notes', notes: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
})

async function dropFile(name: string, onImportNovel: () => void) {
  await act(async () => root?.render(
    <WelcomePage onNewProject={() => {}} onOpenProject={() => {}} onImportNovel={onImportNovel} />,
  ))
  const target = container?.querySelector('.literary-deconstruct-card')
  if (!target) throw new Error('Missing reference import drop target')
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(new File(['# 第1章 测试\n正文'], name, { type: 'text/markdown' }))
  await act(async () => {
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
}

describe('WelcomePage Markdown drop handling', () => {
  it.each(['第1章.md', '第1章.markdown'])('accepts %s and explains secure picker reselection', async name => {
    const onImportNovel = vi.fn()
    await dropFile(name, onImportNovel)
    expect(onImportNovel).toHaveBeenCalledOnce()
    expect(container?.textContent).toContain('请在安全文件选择框中确认刚拖入的文件')
  })

  it('rejects unsupported dropped extensions without opening import', async () => {
    const onImportNovel = vi.fn()
    await dropFile('chapter.docx', onImportNovel)
    expect(onImportNovel).not.toHaveBeenCalled()
    expect(container?.textContent).toContain('这里只接受 .txt、.epub、.md 或 .markdown 文件')
  })
})
