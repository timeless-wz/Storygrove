import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectData } from '../../../../shared/ipc-channels'
import { setActiveProjectSessionContext } from '../../../../shared/project-session-context'
import { useCharacterStore, type CharacterCard } from '../../../../stores/character-store'
import { useLayoutStore } from '../../../../stores/layout-store'
import { useLocaleStore } from '../../../../stores/locale-store'
import { useProjectStore } from '../../../../stores/project-store'
import CharacterEditor from '../../../editor/CharacterEditor'
import CharactersView from '../CharactersView'

const PROJECT_PATH = 'C:\\novels\\character-create'
const PROJECT_SESSION = {
  projectId: 'character-create',
  leaseId: 'character-create-lease',
  projectPath: PROJECT_PATH,
}
const originalCharacterState = useCharacterStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

function project(): ProjectData {
  return {
    id: PROJECT_SESSION.projectId,
    sessionLease: PROJECT_SESSION.leaseId,
    name: '角色创建测试项目',
    path: PROJECT_PATH,
    novelConfig: {
      genre: '玄幻', subGenre: '', targetAudience: '全龄', totalChapters: 10,
      wordsPerChapter: 2500, plotStructure: 'three_act', narrativePOV: 'third_limited',
      coreOutline: '', worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
    },
    characterStates: '', createdAt: '', updatedAt: '',
  }
}

function card(name: string, role: CharacterCard['role'] = 'supporting'): CharacterCard {
  return {
    name, role, gender: '', age: '', appearance: '', personality: '',
    background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '',
  }
}

beforeEach(async () => {
  useCharacterStore.setState(originalCharacterState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState({ ...originalLocaleState, locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ ...originalProjectState, currentProject: project() })
  useLayoutStore.setState({ characterViewRequest: null, sidebarView: 'characters' })
  useCharacterStore.setState({
    characters: [card('陆云飞', 'antagonist')],
    selectedName: '陆云飞',
    loaded: true,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    rosterRevision: 1,
    loadingProjectKey: null,
    loadingProjectSession: null,
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
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useCharacterStore.setState(originalCharacterState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
})

async function openCreateDialog(): Promise<void> {
  await act(async () => {
    await page.getByRole('button', { name: '新建角色' }).click()
  })
}

/** Radix 浮层挂在 document 上，不在列表容器里。 */
function dialogRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="character-create-dialog"]')
}

function dialogRoleSelect(): HTMLSelectElement | null {
  return dialogRoot()?.querySelector<HTMLSelectElement>('select[aria-label="角色定位"]') ?? null
}

describe('new character creation flow', () => {
  it('opens a compact dialog instead of immediately writing a supporting placeholder', async () => {
    await openCreateDialog()

    await expect.element(page.getByTestId('character-create-dialog')).toBeVisible()
    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual(['陆云飞'])

    // 默认定位是“暂未设定”，不是配角。
    const roleSelect = dialogRoleSelect()
    expect(roleSelect?.value).toBe('unassigned')
    expect(Array.from(roleSelect?.options ?? []).map(option => option.textContent)).toEqual([
      '主角', '反派', '配角', '其他', '暂未设定',
    ])
  })

  it('creates an unassigned character when no role is chosen and opens it for editing', async () => {
    await openCreateDialog()

    await act(async () => {
      await page.getByLabelText('角色姓名').fill('沈砺')
    })
    await act(async () => {
      await page.getByRole('button', { name: '创建角色' }).click()
    })

    expect(useCharacterStore.getState().characters.map(entry => [entry.name, entry.role])).toEqual([
      ['陆云飞', 'antagonist'],
      ['沈砺', 'unassigned'],
    ])
    expect(useCharacterStore.getState().selectedName).toBe('沈砺')
    // 创建后直接进入可编辑档案，而不是只读概览。
    expect(useLayoutStore.getState().characterViewRequest?.view).toBe('edit')
    await expect.element(page.getByTestId('character-create-dialog')).not.toBeInTheDocument()
    expect(container.textContent).toContain('沈砺')
  })

  it('creates with the chosen role', async () => {
    await openCreateDialog()

    await act(async () => {
      await page.getByLabelText('角色姓名').fill('沈砺')
    })
    await act(async () => {
      await page.getByLabelText('角色定位').selectOptions('protagonist')
    })
    await act(async () => {
      await page.getByRole('button', { name: '创建角色' }).click()
    })

    expect(useCharacterStore.getState().characters[1]).toMatchObject({
      name: '沈砺',
      role: 'protagonist',
    })
  })

  it('refuses an empty name without creating a ghost character', async () => {
    await openCreateDialog()

    await act(async () => {
      await page.getByRole('button', { name: '创建角色' }).click()
    })

    await expect.element(page.getByTestId('character-create-error')).toBeVisible()
    expect(dialogRoot()?.textContent).toContain('请填写角色姓名')
    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual(['陆云飞'])
    expect(useCharacterStore.getState().selectedName).toBe('陆云飞')
    expect(useLayoutStore.getState().characterViewRequest).toBeNull()
  })

  it('refuses a duplicated name and keeps the roster untouched', async () => {
    await openCreateDialog()

    await act(async () => {
      await page.getByLabelText('角色姓名').fill('  陆云飞 ')
    })

    await expect.element(page.getByTestId('character-create-error')).toBeVisible()
    expect(dialogRoot()?.textContent).toContain('该姓名已存在')

    await act(async () => {
      await page.getByRole('button', { name: '创建角色' }).click()
    })
    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual(['陆云飞'])
    expect(useLayoutStore.getState().characterViewRequest).toBeNull()
  })

  it('clears the previous input when reopened', async () => {
    await openCreateDialog()
    await act(async () => {
      await page.getByLabelText('角色姓名').fill('沈砺')
    })
    await act(async () => {
      await page.getByRole('button', { name: '取消' }).click()
    })

    await openCreateDialog()
    expect(dialogRoot()?.querySelector<HTMLInputElement>('input[aria-label="角色姓名"]')?.value)
      .toBe('')
    expect(dialogRoleSelect()?.value).toBe('unassigned')
  })

  it('lands in the editable profile right after creation', async () => {
    // 像真实工作区那样同时挂载侧栏列表与主区角色档案。
    setActiveProjectSessionContext(PROJECT_SESSION)
    Object.defineProperty(window, 'velaAPI', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string) => (
          channel === 'db:character-roster-read'
            ? {
                schemaVersion: 1,
                revision: 1,
                migrationState: 'ready',
                status: 'ready',
                entries: [],
                renderedMarkdown: '',
                projectionHash: 'projection',
                factHash: 'facts',
              }
            : { success: false, error: channel }
        )),
        on: vi.fn(() => () => {}),
        once: vi.fn(),
        send: vi.fn(),
      },
    })
    await act(async () => {
      root.render(
        <div>
          <CharactersView />
          <CharacterEditor projectKey={PROJECT_PATH} />
        </div>,
      )
    })

    await openCreateDialog()
    await act(async () => {
      await page.getByLabelText('角色姓名').fill('沈砺')
    })
    await act(async () => {
      await page.getByRole('button', { name: '创建角色' }).click()
    })

    // 直接落在可编辑表单上，而不是只读概览。
    await expect.element(page.getByTestId('character-profile-form')).toBeVisible()
    expect(container.querySelector('[data-testid="character-summary"]')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="姓名"]')?.value).toBe('沈砺')
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="定位"]')?.value)
      .toBe('unassigned')
    // 概览里显示的是同一张卡片，说明确实选中了新角色。
    expect(useCharacterStore.getState().selectedName).toBe('沈砺')
  })
})
