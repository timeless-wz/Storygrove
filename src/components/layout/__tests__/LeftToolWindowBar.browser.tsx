import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import LeftToolWindowBar from '../LeftToolWindowBar'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()

let root: Root
let container: HTMLDivElement

function findButton(label: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label)
}

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useLayoutStore.setState({
    sidebarOpen: true,
    sidebarView: 'home',
    activeRailItem: 'home',
    bottomPanelOpen: false,
    bottomTab: 'tasks',
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<LeftToolWindowBar />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLayoutStore.setState(originalLayoutState, true)
  useLocaleStore.setState(originalLocaleState, true)
})

describe('LeftToolWindowBar navigation hierarchy', () => {
  it('keeps only workspace-level destinations on the primary rail', async () => {
    // 知识检索与角色档案是资料库/角色入口的最终命名。
    for (const label of ['首页', '创作', '资料', '知识检索', '角色档案']) {
      expect(findButton(label), `${label} should be a primary destination`).toBeDefined()
    }
    expect(findButton('蓝图')).toBeUndefined()
    expect(findButton('世界')).toBeUndefined()
    expect(findButton('剧情')).toBeUndefined()

    const writing = findButton('创作')
    await act(async () => writing?.click())
    expect(useLayoutStore.getState()).toMatchObject({
      sidebarOpen: true,
      sidebarView: 'project',
      activeRailItem: 'project',
    })
  })
})
