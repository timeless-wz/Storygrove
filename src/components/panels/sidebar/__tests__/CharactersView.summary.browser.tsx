import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProjectData } from '../../../../shared/ipc-channels'
import { EMPTY_STATE, useCharacterStore, type CharacterCard } from '../../../../stores/character-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectStore } from '../../../../stores/project-store'
import CharactersView from '../CharactersView'

const PROJECT_PATH = 'C:\\novels\\character-summary'
const originalCharacterState = useCharacterStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

function project(): ProjectData {
  return {
    id: 'character-summary',
    sessionLease: 'character-summary-lease',
    name: 'Character Summary',
    path: PROJECT_PATH,
    novelConfig: {
      genre: '玄幻', subGenre: '', targetAudience: '全龄', totalChapters: 10,
      wordsPerChapter: 2500, plotStructure: 'three_act', narrativePOV: 'third_limited',
      coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
    },
    characterStates: '', createdAt: '', updatedAt: '',
  }
}

function card(name: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    name, role: 'supporting', gender: '', age: '', appearance: '', personality: '',
    background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '',
    ...overrides,
  }
}

beforeEach(async () => {
  useCharacterStore.setState(originalCharacterState)
  useLocaleStore.setState({ ...originalLocaleState, locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ ...originalProjectState, currentProject: project() })
  useCharacterStore.setState({
    characters: [
      card('沈砺', {
        role: 'protagonist',
        currentState: {
          ...EMPTY_STATE,
          location: '青云城',
          recentEvents: '与陆云飞决裂',
        },
      }),
      card('陆云飞', {
        role: 'antagonist',
        currentState: { ...EMPTY_STATE, recentEvents: '被逐出师门', updatedAtChapter: 3 },
      }),
      card('苏璃'),
    ],
    dataProjectKey: PROJECT_PATH,
    loadingProjectKey: null,
    lastError: null,
    identityBusy: false,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<CharactersView />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useCharacterStore.setState(originalCharacterState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
})

describe('character list state summary', () => {
  it('shows the role and a useful current-state summary for each card', () => {
    expect(container.textContent).toContain('沈砺')
    expect(container.textContent).toContain('主角')
    expect(container.textContent).toContain('位置：青云城')

    expect(container.textContent).toContain('陆云飞')
    expect(container.textContent).toContain('反派')
    expect(container.textContent).toContain('最近事件：被逐出师门')
    expect(container.textContent).toContain('第3章更新')

    // 没有状态的角色不会凭空多出一行，也不会只报一个“第0章更新”。
    expect(container.querySelectorAll('[data-testid="character-state-summary"]')).toHaveLength(2)
    expect(container.textContent).not.toContain('第0章更新')
  })

  it('keeps the summary visible while the author searches the roster', async () => {
    const search = container.querySelector('input[aria-label="搜索角色"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, '陆云')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.textContent).toContain('陆云飞')
    expect(container.textContent).not.toContain('沈砺')
    expect(container.querySelectorAll('[data-testid="character-state-summary"]')).toHaveLength(1)
  })
})
