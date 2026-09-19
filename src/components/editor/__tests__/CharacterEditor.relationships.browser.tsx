import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ProjectData } from '../../../shared/ipc-channels'
import type { CharacterRosterCommitRequest } from '../../../shared/character-roster'
import { setActiveProjectSessionContext } from '../../../shared/project-session-context'
import { EMPTY_STATE, useCharacterStore, type CharacterCard } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import CharacterEditor from '../CharacterEditor'

const PROJECT_PATH = 'C:\\novels\\relationship-editor'
const PROJECT_SESSION = {
  projectId: 'relationship-editor',
  leaseId: 'relationship-editor-lease',
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

function project(): ProjectData {
  return {
    id: PROJECT_SESSION.projectId,
    sessionLease: PROJECT_SESSION.leaseId,
    name: '关系网测试项目',
    path: PROJECT_PATH,
    novelConfig: {
      genre: '玄幻',
      subGenre: '',
      targetAudience: '全龄',
      totalChapters: 10,
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
  }
}

function character(name: string, overrides: Partial<CharacterCard> = {}): CharacterCard {
  return {
    name,
    role: 'supporting',
    gender: '',
    age: '',
    appearance: '',
    personality: '',
    background: '',
    abilities: '',
    motivation: '',
    relationships: '',
    arc: '',
    notes: '',
    ...overrides,
  }
}

const structuredRelationships = JSON.stringify([
  { target: '陆云飞', relation: '关系类型：竞争对手；矛盾张力：权力斗争' },
  { target: '苏璃', relation: '盟友' },
])
const legacyRelationshipText = '陆云飞与沈砺表面合作，实际彼此试探。'
const unknownRelationshipJson = '[{"participant":"陆云飞","status":"待确认"}]'

const shenLi = character('沈砺', {
  role: 'protagonist',
  gender: '男',
  age: '二十三',
  appearance: '一袭青衫',
  personality: '沉稳多疑',
  background: '南渡遗孤',
  abilities: '御水术',
  motivation: '为父复仇',
  arc: '从复仇到放下',
  notes: '作者备注',
  relationships: structuredRelationships,
  currentState: {
    ...EMPTY_STATE,
    location: '青云城',
    recentEvents: '与陆云飞决裂',
    updatedAtChapter: 3,
  },
})
const luYunfei = character('陆云飞', {
  role: 'antagonist',
  relationships: JSON.stringify([{ target: '旧友', relation: '失联' }]),
})
const suLi = character('苏璃')
const legacyCard = character('旧人', { relationships: legacyRelationshipText })
const unknownJsonCard = character('疑云', { relationships: unknownRelationshipJson })

async function renderEditor(): Promise<void> {
  await act(async () => {
    root?.render(<CharacterEditor projectKey={PROJECT_PATH} />)
  })
}

function textareaValues(): string[] {
  return Array.from(container?.querySelectorAll('textarea') ?? []).map(field => field.value)
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
    characters: [shenLi, luYunfei, suLi, legacyCard, unknownJsonCard],
    selectedName: '沈砺',
    dataProjectKey: PROJECT_PATH,
    loadingProjectKey: null,
    lastError: null,
    saving: false,
    identityBusy: false,
    rosterRevision: 1,
    dataProjectSession: PROJECT_SESSION,
    loadingProjectSession: null,
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  commitPayload = undefined
  invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === 'db:character-roster-read') {
      return {
        schemaVersion: 1,
        revision: 1,
        migrationState: 'ready',
        status: 'ready',
        entries: [],
        renderedMarkdown: '',
        projectionHash: 'projection',
        factHash: 'facts',
      }
    }
    if (channel === 'db:character-roster-commit') {
      const request = payload as CharacterRosterCommitRequest
      commitPayload = request
      return {
        success: true,
        receipt: {
          operationId: request.operationId,
          payloadHash: 'payload-hash',
          revision: 2,
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
})

describe('character profile overview', () => {
  it('opens on the overview with a summary instead of a screen full of inputs', async () => {
    await renderEditor()

    expect(container?.textContent).toContain('人物概览')
    // 概览是只读优先：没有任何 textarea/input 撑满屏幕。
    expect(container?.querySelectorAll('textarea')).toHaveLength(0)
    expect(container?.querySelectorAll('input')).toHaveLength(0)

    const summary = container?.querySelector('[data-testid="character-summary"]')
    expect(summary?.textContent).toContain('沈砺')
    expect(summary?.textContent).toContain('定位')
    expect(summary?.textContent).toContain('主角')
    expect(summary?.textContent).toContain('性别')
    expect(summary?.textContent).toContain('男')
    expect(summary?.textContent).toContain('年龄')
    expect(summary?.textContent).toContain('二十三')
    // 没有正式 faction 字段时不得凭空多出一个阵营字段。
    expect(summary?.textContent).not.toContain('阵营')

    // 优先项按需求顺序出现。
    const sections = Array.from(container?.querySelectorAll('section') ?? [])
      .map(section => section.querySelector('h4')?.textContent ?? '')
    expect(sections).toEqual([
      '核心动机', '性格特征与弱点', '当前状态', '关系',
    ])
    expect(container?.textContent).toContain('为父复仇')
    expect(container?.textContent).toContain('沉稳多疑')
    expect(container?.textContent).toContain('青云城')
    // 状态字段没有来源记录时按“来源未知”呈现，不假装它是作者写的。
    expect(container?.textContent).toContain('来源未知')
    expect(container?.textContent).toContain('第 3 章更新')

    // 次要字段保留但默认折叠。
    const details = Array.from(container?.querySelectorAll('details[data-testid="profile-detail-section"]') ?? [])
    expect(details.map(item => item.getAttribute('data-section'))).toEqual([
      'appearance', 'abilities', 'background', 'arc', 'notes',
    ])
    expect(details.every(item => !item.hasAttribute('open'))).toBe(true)
    expect(details[0]?.textContent).toContain('一袭青衫')
  })

  it('shows relationships as target plus relation and opens the target character card', async () => {
    await renderEditor()

    const relationTargets = Array.from(container?.querySelectorAll('[data-testid="relationship-target"]') ?? [])
      .map(node => node.textContent)
    expect(relationTargets).toEqual(['陆云飞', '苏璃'])
    expect(container?.textContent).toContain('关系类型：竞争对手；矛盾张力：权力斗争')
    expect(container?.textContent).toContain('盟友')

    await act(async () => {
      await page.getByRole('button', { name: '陆云飞' }).click()
    })

    expect(useCharacterStore.getState().selectedName).toBe('陆云飞')
    expect(container?.querySelector('[data-testid="character-summary"]')?.textContent).toContain('陆云飞')

    // 目标已不在名单中的关系仍然展示，但不会是可跳转的按钮。
    const danglingTargets = Array.from(container?.querySelectorAll('[data-testid="relationship-target"]') ?? [])
      .map(node => node.textContent)
    expect(danglingTargets).not.toContain('旧友')
    expect(container?.textContent).toContain('旧友')
    expect(container?.textContent).toContain('（不在名单中）')
  })

  it('keeps legacy relationship text verbatim instead of guessing at structure', async () => {
    useCharacterStore.setState({ selectedName: '旧人' })
    await renderEditor()

    const legacyBlock = container?.querySelector('[data-testid="overview-legacy-relationships"]')
    expect(legacyBlock?.textContent).toContain(legacyRelationshipText)
    expect(legacyBlock?.textContent).toContain('未解析')
    expect(container?.querySelectorAll('[data-testid="relationship-row"]')).toHaveLength(0)
    expect(useCharacterStore.getState().characters.find(card => card.name === '旧人')?.relationships)
      .toBe(legacyRelationshipText)
  })

  it('keeps unrecognised relationship JSON visible and byte-for-byte unchanged', async () => {
    useCharacterStore.setState({ selectedName: '疑云' })
    await renderEditor()

    expect(container?.querySelector('[data-testid="overview-legacy-relationships"]')?.textContent)
      .toContain(unknownRelationshipJson)

    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })

    const legacyField = container?.querySelector<HTMLTextAreaElement>('[data-testid="legacy-relationships"] textarea')
    expect(legacyField?.value).toBe(unknownRelationshipJson)
    expect(container?.textContent).toContain('关系数据格式无法识别')
    expect(useCharacterStore.getState().characters.find(card => card.name === '疑云')?.relationships)
      .toBe(unknownRelationshipJson)
  })
})

describe('character profile edit mode', () => {
  it('edits every stored field, including structured relationship rows', async () => {
    await renderEditor()

    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })

    expect(container?.querySelector('[data-testid="character-profile-form"]')).toBeTruthy()
    // 原有字段一个都不能少：基础资料 + 当前状态都在编辑模式里可覆盖。
    expect(textareaValues()).toEqual(expect.arrayContaining([
      '一袭青衫', '沉稳多疑', '南渡遗孤', '御水术', '为父复仇', '从复仇到放下',
      '作者备注', '青云城', '与陆云飞决裂',
    ]))

    const rows = container?.querySelectorAll('[data-testid="relationship-row"]') ?? []
    expect(rows).toHaveLength(2)

    await act(async () => {
      await page.getByLabelText('关系说明').nth(0).fill('死敌')
    })
    expect(JSON.parse(useCharacterStore.getState().characters[0].relationships)).toEqual([
      { target: '陆云飞', relation: '死敌' },
      { target: '苏璃', relation: '盟友' },
    ])

    await act(async () => {
      await page.getByRole('button', { name: '添加关系' }).click()
    })
    const nextRows = container?.querySelectorAll('[data-testid="relationship-row"]') ?? []
    expect(nextRows).toHaveLength(3)
    // 不完整的关系行不会写进存储，角色名单事务因此不会被残行打断。
    expect(JSON.parse(useCharacterStore.getState().characters[0].relationships)).toHaveLength(2)

    await act(async () => {
      await page.getByLabelText('关系目标').nth(2).selectOptions('苏璃')
      await page.getByLabelText('关系说明').nth(2).fill('旧识')
    })
    expect(JSON.parse(useCharacterStore.getState().characters[0].relationships)).toEqual([
      { target: '陆云飞', relation: '死敌' },
      { target: '苏璃', relation: '盟友' },
      { target: '苏璃', relation: '旧识' },
    ])

    await act(async () => {
      await page.getByLabelText('关系说明').nth(1).fill('')
    })
    expect(JSON.parse(useCharacterStore.getState().characters[0].relationships)).toEqual([
      { target: '陆云飞', relation: '死敌' },
      { target: '苏璃', relation: '旧识' },
    ])
    expect(container?.textContent).toContain('请填写关系说明')

    await act(async () => {
      await page.getByRole('button', { name: '删除关系' }).nth(0).click()
    })
    expect(JSON.parse(useCharacterStore.getState().characters[0].relationships)).toEqual([
      { target: '苏璃', relation: '旧识' },
    ])
  })

  it('saves every edited field and preserves legacy relationship evidence through the commit', async () => {
    await renderEditor()
    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })
    await act(async () => {
      await page.getByLabelText('关系说明').nth(0).fill('死敌')
      await page.getByLabelText('当前位置/阵营').fill('黑水城')
    })
    await act(async () => {
      await page.getByRole('button', { name: '保存' }).click()
    })

    expect(commitPayload?.intent).toBe('manual_edit')
    const entries = commitPayload?.entries ?? []
    const shen = entries.find(entry => entry.name === '沈砺')
    expect(shen).toMatchObject({
      role: 'protagonist',
      gender: '男',
      age: '二十三',
      appearance: '一袭青衫',
      personality: '沉稳多疑',
      background: '南渡遗孤',
      abilities: '御水术',
      motivation: '为父复仇',
      arc: '从复仇到放下',
      notes: '作者备注',
    })
    expect(shen?.relationships).toEqual([
      { target: '陆云飞', relation: '死敌' },
      { target: '苏璃', relation: '盟友' },
    ])
    expect(shen?.currentState).toMatchObject({
      location: '黑水城',
      recentEvents: '与陆云飞决裂',
      updatedAtChapter: 3,
    })
    expect(shen?.currentState?.provenance?.location).toEqual({ kind: 'author', chapterNumber: 3 })

    // 旧项目无法解析的关系文本必须原样进入提交，不能静默丢失。
    const legacy = entries.find(entry => entry.name === '旧人')
    expect(legacy?.relationships).toEqual([])
    expect(legacy?.legacyRelationshipNotes).toBe(legacyRelationshipText)
  })
})

describe('character relationship graph entry', () => {
  it('opens the directed relationship graph and fits its current view', async () => {
    await renderEditor()

    await act(async () => page.getByRole('button', { name: '关系图谱' }).click())
    await expect.element(page.getByText('2 条有向关系')).toBeVisible()
    expect(container?.querySelector('.react-flow')).toBeTruthy()
    await expect.element(page.getByRole('button', { name: '适合视图' })).toBeVisible()
  })

  it('requires confirmation before clearing every character through the roster action', async () => {
    const clearAllCharacters = vi.fn().mockResolvedValue(true)
    useCharacterStore.setState({ clearAllCharacters })
    await renderEditor()

    await act(async () => page.getByRole('button', { name: '关系图谱' }).click())
    await act(async () => page.getByRole('button', { name: '删除全部角色与关系' }).click())
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(clearAllCharacters).not.toHaveBeenCalled()

    await act(async () => {
      await page.getByRole('button', { name: '取消' }).click()
      await new Promise(resolve => setTimeout(resolve, 220))
    })
    expect(clearAllCharacters).not.toHaveBeenCalled()

    await act(async () => page.getByRole('button', { name: '删除全部角色与关系' }).click())
    await act(async () => {
      await page.getByRole('button', { name: '确认删除全部' }).click()
      await new Promise(resolve => setTimeout(resolve, 220))
    })
    expect(clearAllCharacters).toHaveBeenCalledWith(
      PROJECT_PATH,
      expect.objectContaining({
        projectId: 'relationship-editor',
        leaseId: 'relationship-editor-lease',
      }),
    )
  })
})
