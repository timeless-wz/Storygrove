import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ProjectData } from '../../../shared/ipc-channels'
import type { CharacterRosterCommitRequest } from '../../../shared/character-roster'
import type { CharacterSharedRelationship } from '../../../shared/character-relationship'
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
const SHEN_ID = 'id-shen-li'
const LU_ID = 'id-lu-yunfei'
const SU_ID = 'id-su-li'
const JIU_ID = 'id-jiu-ren'
const YI_ID = 'id-yi-yun'

const originalCharacterState = useCharacterStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
let invoke: ReturnType<typeof vi.fn>
let commitPayload: CharacterRosterCommitRequest | undefined
let upsertPayload: Record<string, unknown> | undefined
let deletedRelationshipId: string | undefined

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

const SHARED_RELATIONSHIPS: CharacterSharedRelationship[] = [
  {
    id: 'rel-shen-lu',
    character1Id: LU_ID,
    character2Id: SHEN_ID,
    character1Name: '陆云飞',
    character2Name: '沈砺',
    relation: '竞争对手',
    description: '权力斗争',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
  {
    id: 'rel-shen-su',
    character1Id: SHEN_ID,
    character2Id: SU_ID,
    character1Name: '沈砺',
    character2Name: '苏璃',
    relation: '盟友',
    description: '',
    createdAt: '2024-01-02',
    updatedAt: '2024-01-02',
  },
]

const legacyRelationshipText = '陆云飞与沈砺表面合作，实际彼此试探。'
const unknownRelationshipJson = '[{"participant":"陆云飞","status":"待确认"}]'

/*
 * 关键前提：沈砺、陆云飞、苏璃三张卡的旧 relationships 字段都是空的，
 * 概览与编辑入口展示的关系全部来自共享关系表。
 */
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
  currentState: {
    ...EMPTY_STATE,
    location: '青云城',
    recentEvents: '与陆云飞决裂',
    updatedAtChapter: 3,
  },
})
const luYunfei = character('陆云飞', { role: 'antagonist' })
const suLi = character('苏璃')
const legacyCard = character('旧人', { relationships: legacyRelationshipText })
const unknownJsonCard = character('疑云', { relationships: unknownRelationshipJson })

const IDENTITIES = {
  沈砺: SHEN_ID,
  陆云飞: LU_ID,
  苏璃: SU_ID,
  旧人: JIU_ID,
  疑云: YI_ID,
}

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
  useLayoutStore.setState({ characterViewRequest: { view: 'overview', requestId: 1 } })
  useCharacterStore.setState({
    characters: [shenLi, luYunfei, suLi, legacyCard, unknownJsonCard],
    selectedName: '沈砺',
    loaded: true,
    dataProjectKey: PROJECT_PATH,
    loadingProjectKey: null,
    lastError: null,
    saving: false,
    identityBusy: false,
    rosterRevision: 1,
    dataProjectSession: PROJECT_SESSION,
    loadingProjectSession: null,
    characterIdentities: IDENTITIES,
    relationships: SHARED_RELATIONSHIPS,
    graphPositions: {},
  })
  setActiveProjectSessionContext(PROJECT_SESSION)

  commitPayload = undefined
  upsertPayload = undefined
  deletedRelationshipId = undefined
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
    if (channel === 'db:character-identities-ensure') {
      return IDENTITIES
    }
    if (channel === 'db:character-relationships-get-all') {
      return SHARED_RELATIONSHIPS
    }
    if (channel === 'db:character-graph-positions-get') {
      return {}
    }
    if (channel === 'db:character-relationship-upsert') {
      upsertPayload = payload as Record<string, unknown>
      return {
        success: true,
        relationship: {
          id: 'rel-created',
          character1Id: (payload as { character1Id: string }).character1Id,
          character2Id: (payload as { character2Id: string }).character2Id,
          character1Name: '沈砺',
          character2Name: '林晚',
          relation: (payload as { relation: string }).relation,
          description: (payload as { description?: string }).description ?? '',
          createdAt: '',
          updatedAt: '',
        },
      }
    }
    if (channel === 'db:character-relationship-delete') {
      deletedRelationshipId = payload as string
      return { success: true }
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
  it('supports explicitly opening the read-only overview', async () => {
    await renderEditor()

    expect(container?.textContent).toContain('人物概览')
    // 概览是只读优先：没有任何 textarea/input 撑满屏幕。
    expect(container?.querySelectorAll('textarea')).toHaveLength(0)
    expect(container?.querySelectorAll('input')).toHaveLength(0)

    const summary = container?.querySelector('[data-testid="character-summary"]')
    expect(summary?.textContent).toContain('沈砺')
    expect(summary?.textContent).toContain('主角')
    expect(summary?.textContent).toContain('男')
    expect(summary?.textContent).toContain('二十三')

    const sections = Array.from(container?.querySelectorAll('section') ?? [])
      .map(section => section.querySelector('h4')?.textContent ?? '')
    expect(sections).toEqual(['修炼等级', '核心动机', '性格特征与弱点', '当前状态', '关系'])
    expect(container?.textContent).toContain('为父复仇')
    expect(container?.textContent).toContain('青云城')
  })

  it('shows relationships from the shared table and opens the target character card', async () => {
    await renderEditor()

    // 角色卡里的旧 relationships 字段是空的，关系完全来自共享关系表。
    expect(useCharacterStore.getState().characters[0].relationships).toBe('')
    const chips = Array.from(container?.querySelectorAll('[data-testid="relationship-chip"]') ?? [])
      .map(chip => chip.textContent)
    expect(chips).toEqual(['竞争对手', '盟友'])
    expect(container?.textContent).toContain('权力斗争')
    const aside = container?.querySelector('section:has([data-testid="relationship-chip"]) h4')
      ?.parentElement?.textContent
    expect(aside).toContain('2 位关联人物')

    await act(async () => {
      await page.getByRole('button', { name: '陆云飞' }).click()
    })
    expect(useCharacterStore.getState().selectedName).toBe('陆云飞')
    expect(container?.querySelector('[data-testid="character-profile-form"]')).not.toBeNull()
  })

  it('keeps legacy relationship text verbatim instead of guessing at structure', async () => {
    useCharacterStore.setState({ selectedName: '旧人' })
    await renderEditor()

    const legacyBlock = container?.querySelector('[data-testid="overview-legacy-relationships"]')
    expect(legacyBlock?.textContent).toContain(legacyRelationshipText)
    expect(legacyBlock?.textContent).toContain('未解析')
    expect(container?.querySelectorAll('[data-testid="relationship-chip"]')).toHaveLength(0)
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
    expect(legacyField?.readOnly).toBe(true)
    expect(useCharacterStore.getState().characters.find(card => card.name === '疑云')?.relationships)
      .toBe(unknownRelationshipJson)
  })
})

describe('character profile edit mode', () => {
  it('edits every stored field', async () => {
    await renderEditor()

    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })

    expect(container?.querySelector('[data-testid="character-profile-form"]')).toBeTruthy()
    expect(textareaValues()).toEqual(expect.arrayContaining([
      '一袭青衫', '沉稳多疑', '南渡遗孤', '御水术', '为父复仇', '从复仇到放下',
      '作者备注', '青云城', '与陆云飞决裂',
    ]))
  })

  it('edits relationships through the shared table instead of a second JSON row editor', async () => {
    await renderEditor()
    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })

    // 编辑入口列出的是共享关系，而不是角色卡里的 JSON 行。
    expect(container?.querySelector('[data-testid="shared-relationships-field"]')).toBeTruthy()
    const rows = Array.from(container?.querySelectorAll('[data-testid="shared-relationship-row"]') ?? [])
    expect(rows.map(row => row.getAttribute('data-target-name'))).toEqual(['陆云飞', '苏璃'])
    expect(rows[0].textContent).toContain('竞争对手')

    // 修改已有关系：复用同一条共享关系（同一对人物不会出现第二条线）。
    await act(async () => {
      const editButton = rows[0].querySelector<HTMLElement>('[aria-label="编辑关系"]')
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await expect.element(page.getByTestId('relationship-modal')).toBeVisible()
    expect(document.body.textContent).toContain('沈砺 ↔ 陆云飞')

    await act(async () => {
      const input = page.getByTestId('relationship-name-input').element() as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '宿敌')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      page.getByTestId('relationship-save-button').element()
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(upsertPayload).toEqual({
      id: 'rel-shen-lu',
      character1Id: SHEN_ID,
      character2Id: LU_ID,
      relation: '宿敌',
      description: '权力斗争',
    })

    // 删除关系同样按共享关系 ID 走同一条事实源。
    await act(async () => {
      const deleteButton = rows[1].querySelector<HTMLElement>('[aria-label="删除关系"]')
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(deletedRelationshipId).toBe('rel-shen-su')

    // 旧的 JSON 行编辑器（按目标选角色 + 关系说明输入框）已经不存在。
    expect(container?.querySelector('select[aria-label="关系说明"]')).toBeNull()
  })

  it('creates a relationship for the selected target with character IDs', async () => {
    await renderEditor()
    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })

    await act(async () => {
      const select = container?.querySelector<HTMLSelectElement>('select[aria-label="关系目标"]')
      if (select) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, '苏璃')
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    await act(async () => {
      container?.querySelector<HTMLElement>('[data-testid="shared-relationship-create"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await expect.element(page.getByTestId('relationship-modal')).toBeVisible()
    // 已有关系时打开编辑；这里苏璃已有关系，因此没有新增表单。
    expect(document.body.textContent).toContain('编辑人物关系')
  })

  it('saves every edited field and preserves legacy relationship evidence through the commit', async () => {
    await renderEditor()
    await act(async () => {
      await page.getByRole('button', { name: '编辑档案' }).click()
    })
    await act(async () => {
      await page.getByLabelText('核心动机').fill('重建宗门')
      await page.getByLabelText('当前位置/阵营').fill('黑水城')
    })
    await act(async () => {
      await page.getByRole('button', { name: '完成' }).click()
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    expect(commitPayload?.intent).toBe('manual_edit')
    const entries = commitPayload?.entries ?? []
    const shen = entries.find(entry => entry.name === '沈砺')
    expect(shen).toMatchObject({ motivation: '重建宗门' })
    expect(shen?.currentState).toMatchObject({ location: '黑水城', updatedAtChapter: 3 })

    // 旧项目无法解析的关系文本必须原样进入提交，不能静默丢失。
    const legacy = entries.find(entry => entry.name === '旧人')
    expect(legacy?.relationships).toEqual([])
    expect(legacy?.legacyRelationshipNotes).toBe(legacyRelationshipText)

    // 保存成功后仍停留在编辑档案。
    await expect.element(page.getByTestId('character-profile-form')).toBeVisible()
    expect(container?.querySelector('[data-testid="character-summary"]')).toBeNull()
  })
})

describe('character relationship canvas entry', () => {
  it('opens the relationship canvas backed by the shared table', async () => {
    await renderEditor()

    await act(async () => page.getByRole('button', { name: '关系图谱' }).click())
    await expect.element(page.getByText('2 条关系')).toBeVisible()
    expect(container?.querySelector('.react-flow')).toBeTruthy()
    await expect.element(page.getByRole('button', { name: '适合视图' })).toBeVisible()
    expect(container?.querySelectorAll('[data-testid="relationship-edge-chip"]')).toHaveLength(2)
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
