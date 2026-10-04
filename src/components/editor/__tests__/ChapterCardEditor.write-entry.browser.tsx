import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ProjectData } from '../../../shared/ipc-channels'
import type { AuthoritativeChapterSequence } from '../../../shared/author-manuscript-import'
import type { ChapterBlueprint } from '../../../services/workflows/directory-workflow'
import { useEditorStore, saveDirtyEditorChangesForExit } from '../../../stores/editor-store'
import { buildBlueprintV2MigrationContent } from '../../../shared/blueprint-v2'
import { CHAPTER_CARD_V2_TAB_ID } from '../chapter-card-draft-ledger'
import { useLayoutStore } from '../../../stores/layout-store'
import { useProjectStore } from '../../../stores/project-store'
import { toast } from '../../ui/Toast'
import ChapterCardEditor from '../ChapterCardEditor'

const PROJECT_PATH = 'C:\\novels\\chapter-write-entry'
const originalEditorState = useEditorStore.getState()
const originalLayoutState = useLayoutStore.getState()
const originalProjectState = useProjectStore.getState()

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

function project(): ProjectData {
  return {
    id: 'chapter-write-entry',
    sessionLease: 'chapter-write-entry-lease',
    name: '章节入口测试项目',
    path: PROJECT_PATH,
    novelConfig: {
      genre: '玄幻',
      subGenre: '',
      targetAudience: '全龄',
      totalChapters: 1,
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

function blueprint(chapterNumber: number): ChapterBlueprint {
  return {
    chapterNumber,
    title: '雨夜启程',
    role: '建置',
    purpose: '建立主角的首个目标。',
    keyEvents: '收到匿名信。',
    characters: ['沈砺'],
    suspenseHook: '信封背面出现陌生署名。',
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
  }
}

function installIpc(options: {
  blueprints?: ChapterBlueprint[]
  finalizedChapter?: (chapterNumber: number) => unknown
  onClearGeneratedText?: () => void
  authoritySequence?: AuthoritativeChapterSequence | (() => AuthoritativeChapterSequence)
  saveOutline?: () => unknown
} = {}) {
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:blueprint-get-all') return options.blueprints ?? [blueprint(1)]
    if (channel === 'db:blueprint-v2-get') return null
    if (channel === 'db:blueprint-v2-save') return options.saveOutline?.() ?? { success: true, revision: 1, contentHash: 'a'.repeat(64) }
    if (channel === 'db:blueprint-upsert-many') return { success: true }
    if (channel === 'db:blueprint-volume-list') return [{ id: 'volume-1', name: '第1卷', sortOrder: 1 }]
    if (channel === 'db:blueprint-volume-outline-list-summaries') return []
    if (channel === 'db:blueprint-planning-candidate-list') return []
    if (channel === 'db:blueprint-planning-check-list') return []
    if (channel === 'db:blueprint-planning-source-status') return (args[0] as string[]).map(snapshotId => ({ snapshotId, state: 'unlinked' }))
    if (channel === 'db:blueprint-planning-target-source-status') return (args[0] as Array<{ targetKind: string; targetId: string }>).map(target => ({ ...target, snapshotId: null, operationId: null, state: 'unlinked' }))
    if (channel === 'db:project-core-get') return { synopsis: '' }
    if (channel === 'db:draft-list') return []
    if (channel === 'db:draft-create') return { success: true, id: 101 }
    if (channel === 'db:draft-authority-sequence') return typeof options.authoritySequence === 'function'
      ? options.authoritySequence()
      : options.authoritySequence ?? {
          status: 'empty',
          lastChapterNumber: 0,
          nextChapterNumber: 1,
          duplicateChapterNumbers: [],
          authorityFingerprint: 'a'.repeat(64),
        }
    if (channel === 'db:draft-get-finalized') {
      const chapterNumber = args[0] as number
      return options.finalizedChapter?.(chapterNumber) ?? null
    }
    if (channel === 'db:project-clear-generated-data') {
      options.onClearGeneratedText?.()
      return { success: true, cleared: ['generatedText'] }
    }
    if (channel === 'fs:list-dir') return []
    throw new Error(`unexpected IPC ${channel}`)
  })
  Object.defineProperty(window, 'velaAPI', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      setZoomLevel: vi.fn(),
      setZoomFactor: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
    },
  })
  return invoke
}

async function renderEditor() {
  await act(async () => {
    root?.render(<ChapterCardEditor projectKey={PROJECT_PATH} />)
  })
}

beforeEach(() => {
  localStorage.removeItem('blueprint-planning-selection:chapter-write-entry')
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  useLayoutStore.setState({ chapterCreationOpen: false, chapterCreationPrefill: null })
  useProjectStore.setState({ currentProject: project(), fileTree: [], loading: false })
  installIpc()
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
  useEditorStore.setState(originalEditorState)
  useLayoutStore.setState(originalLayoutState)
  useProjectStore.setState(originalProjectState)
})

describe('ChapterCardEditor writing entry', () => {
  function seedOutlineDraft() {
    useEditorStore.setState({ draftLedgers: {
      [CHAPTER_CARD_V2_TAB_ID]: JSON.stringify({ version: 1, projects: [{ projectKey: PROJECT_PATH, drafts: [{
        chapterNumber: 1, baseRevision: 0, content: buildBlueprintV2MigrationContent(blueprint(1)),
      }] }] }),
    } })
  }

  it('saves the unified outline ledger through the real editor exit handler', async () => {
    seedOutlineDraft()
    const invoke = installIpc()
    await renderEditor()
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-v2-view"]')).toBeTruthy())
    await act(async () => { await saveDirtyEditorChangesForExit(PROJECT_PATH) })
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-v2-save')).toBe(true)
    expect(JSON.parse(useEditorStore.getState().draftLedgers[CHAPTER_CARD_V2_TAB_ID]).projects).toEqual([])
  })

  it('blocks exit on an outline conflict and preserves the draft without writing legacy projections', async () => {
    seedOutlineDraft()
    const invoke = installIpc({ saveOutline: () => ({ success: false, conflict: true, currentRevision: 2 }) })
    await renderEditor()
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-v2-view"]')).toBeTruthy())
    await act(async () => {
      await expect(saveDirtyEditorChangesForExit(PROJECT_PATH)).rejects.toThrow('细纲仍有未保存')
    })
    expect(JSON.parse(useEditorStore.getState().draftLedgers[CHAPTER_CARD_V2_TAB_ID]).projects[0].drafts).toHaveLength(1)
    expect(invoke.mock.calls.some(([channel]) => channel === 'db:blueprint-upsert-many')).toBe(false)
  })
  it('opens AI writing from the authoritative blueprint with the author fields intact', async () => {
    installIpc({ blueprints: [{ ...blueprint(1), userGuidance: '保留人工指导', notes: '既有章节记录' }] })
    await renderEditor()
    await vi.waitFor(() => expect(container?.textContent).toContain('写作此章'))
    const button = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '写作此章')!
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    await act(async () => button.click())
    expect(useLayoutStore.getState()).toMatchObject({ chapterCreationOpen: true, chapterCreationPrefill: {
      chapterNumber: 1, title: '雨夜启程', keyEvents: '收到匿名信。', userGuidance: '保留人工指导',
    } })
    expect(useLayoutStore.getState().chapterCreationPrefill).not.toHaveProperty('notes')
  })

  it('uses finalized authority to expose Chapter 10 even when imported Chapters 1 through 9 have no blueprints', async () => {
    installIpc({
      blueprints: [blueprint(10)],
      authoritySequence: {
        status: 'continuous',
        lastChapterNumber: 9,
        nextChapterNumber: 10,
        duplicateChapterNumbers: [],
        authorityFingerprint: 'b'.repeat(64),
      },
    })

    await renderEditor()

    await vi.waitFor(() => {
      expect(container?.textContent).toContain('新建第10章正文')
    })
  })

  it('creates a manual blueprint at the authoritative next chapter instead of the blueprint maximum', async () => {
    installIpc({
      blueprints: [],
      authoritySequence: {
        status: 'continuous',
        lastChapterNumber: 9,
        nextChapterNumber: 10,
        duplicateChapterNumbers: [],
        authorityFingerprint: 'b'.repeat(64),
      },
    })

    await renderEditor()
    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-planning-tree"]')).toBeTruthy())
    const volumeButton = container?.querySelector<HTMLButtonElement>('[data-testid="blueprint-planning-select-volume-volume-1"]')
    await act(async () => volumeButton?.click())
    await vi.waitFor(() => expect(container?.querySelector('[data-volume-id="volume-1"] .blueprint-planning-tree__volume-row')?.className).toContain('is-selected'))
    const addButton = container?.querySelector<HTMLButtonElement>('[data-testid="blueprint-planning-add-chapter"]')
    expect(addButton).toBeDefined()
    await act(async () => addButton?.click())

    await vi.waitFor(() => expect(container?.querySelector('[data-testid="blueprint-planning-select-chapter-10"]')).toBeTruthy())
  })

  it('appends after the blueprint maximum when the authoritative next blueprint already exists', async () => {
    const info = vi.spyOn(toast, 'info').mockImplementation(() => undefined)
    installIpc({
      blueprints: [blueprint(10), blueprint(11)],
      authoritySequence: {
        status: 'continuous',
        lastChapterNumber: 9,
        nextChapterNumber: 10,
        duplicateChapterNumbers: [],
        authorityFingerprint: 'b'.repeat(64),
      },
    })

    await renderEditor()
    await vi.waitFor(() => expect(container?.textContent).toContain('新建第10章正文'))
    const addButton = container?.querySelector<HTMLButtonElement>('[data-testid="blueprint-planning-add-chapter"]')
    expect(addButton).toBeDefined()
    await act(async () => addButton?.click())

    expect(container?.textContent).toContain('第 12 章：')
    expect(container?.textContent).not.toContain('新建第12章正文')
    expect(info).toHaveBeenCalledWith(expect.stringContaining('写作入口仍为第 10 章'))
  })

  it('blocks card writing and explains duplicate finalized authority', async () => {
    installIpc({
      blueprints: [blueprint(3)],
      authoritySequence: {
        status: 'invalid',
        lastChapterNumber: 3,
        duplicateChapterNumbers: [3],
        authorityFingerprint: 'c'.repeat(64),
      },
    })

    await renderEditor()

    await vi.waitFor(() => {
      expect(container?.textContent).toMatch(/第 3 章存在重复记录/u)
    })
    expect(container?.textContent).not.toContain('新建第3章正文')
  })

  it('creates and opens the authoritative Chapter 1 draft directly from its blueprint', async () => {
    const invoke = installIpc()
    await renderEditor()

    await vi.waitFor(() => {
      expect(container?.textContent).toContain('新建第1章正文')
    })
    const writeButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('新建第1章正文'))

    expect(writeButton).toBeDefined()
    await act(async () => writeButton?.click())

    await vi.waitFor(() => {
      expect(useEditorStore.getState().tabs.some(tab => tab.filePath === 'vela://draft/101')).toBe(true)
    })
    expect(invoke).toHaveBeenCalledWith(
      'db:draft-create',
      expect.objectContaining({ chapterNumber: 1, blueprintChapterNumber: 1 }),
      PROJECT_PATH,
      expect.objectContaining({ projectPath: PROJECT_PATH }),
    )
    expect(useLayoutStore.getState().chapterCreationOpen).toBe(false)
  })

  it('requires explicit recovery before writing Chapter 1 when legacy-imported finalized text exists for Chapters 2 through 5', async () => {
    let legacyImportedTextExists = true
    const invoke = installIpc({
      blueprints: [1, 2, 3, 4, 5].map(blueprint),
      authoritySequence: () => legacyImportedTextExists
        ? {
            status: 'invalid',
            lastChapterNumber: 5,
            firstGapChapterNumber: 1,
            duplicateChapterNumbers: [],
            authorityFingerprint: 'd'.repeat(64),
          }
        : {
            status: 'empty',
            lastChapterNumber: 0,
            nextChapterNumber: 1,
            duplicateChapterNumbers: [],
            authorityFingerprint: 'e'.repeat(64),
          },
      finalizedChapter: (chapterNumber) => (
        legacyImportedTextExists && chapterNumber >= 2 ? { id: chapterNumber } : null
      ),
      onClearGeneratedText: () => { legacyImportedTextExists = false },
    })

    await renderEditor()

    await vi.waitFor(() => {
      expect(container?.textContent).toContain('检测到后续正文但第 1 章尚未写作')
    })
    expect(container?.textContent).not.toContain('新建第1章正文')
    expect(invoke).not.toHaveBeenCalledWith(
      'db:project-clear-generated-data',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )

    const recoveryButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('清除误导入正文'))
    expect(recoveryButton).toBeDefined()
    await act(async () => recoveryButton?.click())

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    })
    const confirmationButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.includes('清除误导入正文'))
    expect(confirmationButton).toBeDefined()
    await act(async () => {
      confirmationButton?.click()
      await new Promise(resolve => setTimeout(resolve, 250))
    })

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'db:project-clear-generated-data',
        expect.objectContaining({ generatedText: true }),
        PROJECT_PATH,
        expect.objectContaining({ projectPath: PROJECT_PATH }),
      )
      expect(container?.textContent).toContain('新建第1章正文')
    })

    expect(container?.textContent).not.toContain('检测到后续正文但第 1 章尚未写作')
  })
})
