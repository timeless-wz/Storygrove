import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ProjectData } from '../../../shared/ipc-channels'
import type { CharacterRosterCommitRequest, CharacterRosterEntry } from '../../../shared/character-roster'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { EMPTY_STATE, useCharacterStore, type CharacterCard } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import CharacterEditor from '../CharacterEditor'

const PROJECT_PATH = 'C:\\novels\\character-edit'
const PROJECT_SESSION = {
  projectId: 'character-edit',
  leaseId: 'character-edit-lease',
  projectPath: PROJECT_PATH,
}
const originalCharacterState = useCharacterStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn>
let commitPayload: CharacterRosterCommitRequest | undefined
/** commit 之后由 read 回放，用来验证“重新加载后数据仍存在”。 */
let committedEntries: CharacterRosterEntry[] = []

function project(): ProjectData {
  return {
    id: PROJECT_SESSION.projectId,
    sessionLease: PROJECT_SESSION.leaseId,
    name: '角色编辑测试项目',
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
    name, role: 'unassigned', gender: '', age: '', appearance: '', personality: '',
    background: '', abilities: '', motivation: '', relationships: '', arc: '', notes: '',
    ...overrides,
  }
}

const shenLi = card('沈砺', {
  gender: '男',
  age: '二十三',
  appearance: '一袭青衫',
  personality: '沉稳多疑',
  background: '南渡遗孤',
  abilities: '御水术',
  motivation: '为父复仇',
  arc: '从复仇到放下',
  notes: '作者备注',
  currentState: { ...EMPTY_STATE, location: '青云城', updatedAtChapter: 2 },
})
const luYunfei = card('陆云飞', { role: 'antagonist' })

const EMPTY_DRAFT = { characters: [] as CharacterCard[] }

async function renderEditor(): Promise<void> {
  await act(async () => {
    root?.render(<CharacterEditor projectKey={PROJECT_PATH} />)
  })
}

async function enterEditMode(): Promise<void> {
  await act(async () => {
    await page.getByRole('button', { name: '编辑档案' }).click()
  })
  await expect.element(page.getByTestId('character-profile-form')).toBeVisible()
}

/**
 * 模拟真实逐字输入：每个字符都发给“当前焦点元素”。
 * 若表单因改名被重挂，输入框会失焦，后续字符就打不进去——这正是
 * “编辑档案无法编辑”的复现路径。
 */
async function typeIntoFocusedField(text: string): Promise<void> {
  for (const character of Array.from(text)) {
    await act(async () => {
      const target = document.activeElement
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
      const prototype = target instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(target, `${target.value}${character}`)
      target.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

beforeEach(() => {
  useCharacterStore.setState(originalCharacterState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: project(), fileTree: [], loading: false })
  useLayoutStore.setState({ characterViewRequest: null })
  useCharacterStore.setState({
    characters: [shenLi, luYunfei],
    selectedName: '沈砺',
    loaded: true,
    dataProjectKey: PROJECT_PATH,
    dataProjectSession: PROJECT_SESSION,
    rosterRevision: 1,
    loadingProjectKey: null,
    loadingProjectSession: null,
    lastError: null,
    saving: false,
    identityBusy: false,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  commitPayload = undefined
  committedEntries = []
  invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === 'db:character-roster-read') {
      return {
        schemaVersion: 1,
        revision: committedEntries.length > 0 ? 2 : 1,
        migrationState: 'ready',
        status: committedEntries.length > 0 ? 'ready' : 'empty',
        entries: committedEntries,
        renderedMarkdown: '',
        projectionHash: 'projection',
        factHash: 'facts',
      }
    }
    if (channel === 'db:character-roster-commit') {
      const request = payload as CharacterRosterCommitRequest
      commitPayload = request
      committedEntries = request.entries
      return {
        success: true,
        receipt: {
          operationId: request.operationId,
          payloadHash: 'payload-hash',
          revision: request.expectedRevision + 1,
          idempotent: false,
          snapshot: {
            schemaVersion: 1,
            revision: 2,
            migrationState: 'ready',
            status: 'ready',
            entries: request.entries,
            renderedMarkdown: '',
            projectionHash: 'projection',
            factHash: 'facts',
          },
        },
      }
    }
    return { success: false, error: `unexpected channel ${channel}` }
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}), once: vi.fn(), send: vi.fn() },
  })

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  Reflect.deleteProperty(window, 'velaAPI')
  setActiveProjectSessionContext(null)
  useCharacterStore.setState(originalCharacterState)
  useLayoutStore.setState(originalLayoutState)
  useLocaleStore.setState(originalLocaleState)
  useProjectStore.setState(originalProjectState)
  void EMPTY_DRAFT
})

describe('character profile edit mode', () => {
  it('opens a real editable form with every stored field', async () => {
    await renderEditor()
    await enterEditMode()

    expect(container?.querySelector('[data-testid="character-profile-form"]')).toBeTruthy()
    // 姓名/性别/年龄/定位都可输入或选择。
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="姓名"]')?.value).toBe('沈砺')
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="性别"]')?.value).toBe('男')
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="年龄"]')?.value).toBe('二十三')
    expect(container?.querySelector<HTMLSelectElement>('select[aria-label="定位"]')?.value).toBe('unassigned')
    // 动机/性格/背景/能力/外貌/弧光/备注与当前状态都保留在表单里。
    for (const [label, value] of [
      ['核心动机', '为父复仇'],
      ['性格特征', '沉稳多疑'],
      ['背景故事', '南渡遗孤'],
      ['能力/技能', '御水术'],
      ['外貌描写', '一袭青衫'],
      ['成长轨迹', '从复仇到放下'],
      ['备注', '作者备注'],
      ['当前位置/阵营', '青云城'],
    ] as const) {
      expect(
        container?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)?.value,
        label,
      ).toBe(value)
    }
    // 概览不会同时出现：这是可编辑表单，不是只读视图。
    expect(container?.querySelector('[data-testid="character-summary"]')).toBeNull()
  })

  it('keeps the name input focused and accumulating characters while renaming', async () => {
    await renderEditor()
    await enterEditMode()

    const nameInput = container?.querySelector<HTMLInputElement>('input[aria-label="姓名"]')
    await act(async () => {
      await page.getByLabelText('姓名').click()
    })
    await typeIntoFocusedField('之影')

    // 改名不再重挂表单：输入框仍在焦点上，逐字输入全部落地。
    const currentInput = container?.querySelector<HTMLInputElement>('input[aria-label="姓名"]')
    expect(currentInput?.value).toBe('沈砺之影')
    expect(document.activeElement).toBe(currentInput)
    expect(nameInput).toBe(currentInput)
    expect(useCharacterStore.getState().characters[0].name).toBe('沈砺之影')
    expect(container?.querySelector('[data-testid="character-profile-form"]')).toBeTruthy()
  })

  it('keeps half-typed relationship rows while another field is being edited', async () => {
    await renderEditor()
    await enterEditMode()

    await act(async () => {
      await page.getByRole('button', { name: '添加关系' }).click()
    })
    await act(async () => {
      await page.getByLabelText('关系目标').selectOptions('陆云飞')
    })
    expect(container?.querySelectorAll('[data-testid="relationship-row"]')).toHaveLength(1)

    await act(async () => {
      await page.getByLabelText('姓名').click()
    })
    await typeIntoFocusedField('之')

    // 行草稿属于本次编辑会话，不因为改名被清空。
    expect(container?.querySelectorAll('[data-testid="relationship-row"]')).toHaveLength(1)
    expect(container?.querySelector<HTMLSelectElement>('[data-testid="relationship-row"] select')?.value)
      .toBe('陆云飞')
  })

  it('refuses to rename onto an existing character name', async () => {
    await renderEditor()
    await enterEditMode()

    await act(async () => {
      await page.getByLabelText('姓名').fill('陆云飞')
    })

    expect(useCharacterStore.getState().characters.map(entry => entry.name)).toEqual(['沈砺', '陆云飞'])
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="姓名"]')?.value).toBe('沈砺')
  })

  it('saves every edited field, persists through reload and returns to the overview', async () => {
    await renderEditor()
    await enterEditMode()

    await act(async () => {
      await page.getByLabelText('姓名').fill('沈砺之')
      await page.getByLabelText('性别').fill('女')
      await page.getByLabelText('年龄').fill('二十四')
      await page.getByLabelText('定位').selectOptions('protagonist')
      await page.getByLabelText('核心动机').fill('重建宗门')
      await page.getByLabelText('当前位置/阵营').fill('黑水城')
    })
    await act(async () => {
      await page.getByRole('button', { name: '保存' }).click()
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    const saved = commitPayload?.entries.find(entry => entry.name === '沈砺之')
    expect(commitPayload?.intent).toBe('manual_edit')
    expect(saved).toMatchObject({
      name: '沈砺之',
      role: 'protagonist',
      gender: '女',
      age: '二十四',
      motivation: '重建宗门',
    })
    expect(saved?.currentState).toMatchObject({ location: '黑水城', updatedAtChapter: 2 })

    // 保存成功后回到只读概览。
    await expect.element(page.getByTestId('character-summary')).toBeVisible()
    expect(container?.querySelector('[data-testid="character-profile-form"]')).toBeNull()

    // 重新加载项目后，保存的字段仍然存在。
    await act(async () => {
      await useCharacterStore.getState().load(PROJECT_PATH, PROJECT_SESSION)
    })
    const reloaded = useCharacterStore.getState().characters.find(entry => entry.name === '沈砺之')
    expect(reloaded).toMatchObject({
      name: '沈砺之',
      role: 'protagonist',
      gender: '女',
      age: '二十四',
      motivation: '重建宗门',
      personality: '沉稳多疑',
    })
    expect(reloaded?.currentState?.location).toBe('黑水城')
    expect(container?.textContent).toContain('重建宗门')
  })
})
