import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import '../../../index.css'
import ArchitectureConfirmDialog from '../ArchitectureConfirmDialog'
import DirectoryConfigDialog from '../DirectoryConfigDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let invoke: ReturnType<typeof vi.fn>
let authoritativeNextChapter: number
let authorityGap: number | null
let blueprintChapterNumbers: number[]

const project = {
  id: 'dialogs', sessionLease: 'lease-dialogs', name: 'Dialogs', path: 'C:\\novels\\dialogs',
  novelConfig: {
    genre: '奇幻', subGenre: '', targetAudience: '', totalChapters: 10, wordsPerChapter: 3000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '完整的故事构想',
    worldSetting: '', goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
}

beforeEach(() => {
  authoritativeNextChapter = 1
  authorityGap = null
  blueprintChapterNumbers = []
  useLocaleStore.setState({ locale: 'zh-CN' })
  useProjectStore.setState({ currentProject: project as never })
  useWorkflowStore.setState({
    activeRuns: [], history: [], globalLogs: [], waitingRuns: {}, currentRun: null,
    waitingForConfirm: false, waitingAfterStepIndex: -1,
  })
  useEditorStore.setState({ tabs: [], activeTabId: null, draftLedgers: {} })
  const previousToastRoot = document.getElementById('vela-toast-root')
  if (previousToastRoot) previousToastRoot.style.display = 'none'
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:blueprint-character-sync-list-pending') return []
    if (channel === 'db:blueprint-get-all') {
      return blueprintChapterNumbers.map(chapterNumber => ({ chapterNumber }))
    }
    if (channel === 'db:blueprint-list-summary') {
      return blueprintChapterNumbers.map(chapterNumber => ({ chapterNumber }))
    }
    if (channel === 'db:draft-authority-sequence') return authorityGap === null
      ? {
          status: authoritativeNextChapter === 1 ? 'empty' : 'continuous',
          lastChapterNumber: authoritativeNextChapter - 1,
          nextChapterNumber: authoritativeNextChapter,
          duplicateChapterNumbers: [],
          authorityFingerprint: 'a'.repeat(64),
        }
      : {
          status: 'invalid',
          lastChapterNumber: 9,
          firstGapChapterNumber: authorityGap,
          duplicateChapterNumbers: [],
          authorityFingerprint: 'b'.repeat(64),
        }
    return { success: true }
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
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useProjectStore.setState({ currentProject: null })
  Reflect.deleteProperty(window, 'velaAPI')
})

describe('workflow launch dialogs', () => {
  it('does not mistake an active batch-writing task for blueprint generation', async () => {
    useWorkflowStore.setState({
      activeRuns: [{
        id: 'active-batch-writing',
        projectPath: project.path,
        projectSession: {
          projectId: project.id,
          leaseId: project.sessionLease,
          projectPath: project.path,
        },
        type: 'batch_generate',
        title: '批量创作',
        status: 'running',
        currentStepIndex: 0,
        createdAt: new Date().toISOString(),
        writingLanguage: 'zh-CN',
        uiLocale: 'zh-CN',
        resourceKeys: ['chapter:1'],
        steps: [],
      }],
    })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <DirectoryConfigDialog isOpen onClose={vi.fn()} existingCount={0} onConfirm={onConfirm} />,
    ))

    await act(async () => page.getByRole('button', { name: '开始生成' }).click())

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  })

  it('defaults blueprint append generation to Chapter 10 after imported finalized Chapters 1 through 9', async () => {
    authoritativeNextChapter = 10
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <DirectoryConfigDialog
        isOpen
        onClose={vi.fn()}
        existingCount={0}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByText(/从第 10 章起往后生成/)).toBeVisible()
    await act(async () => page.getByRole('button', { name: '开始生成' }).click())

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'append',
      startChapter: 10,
      count: 1,
    }))
  })

  it('appends after existing blueprints when finalized manuscript authority is behind', async () => {
    authoritativeNextChapter = 1
    blueprintChapterNumbers = [1, 2, 3, 4]
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <DirectoryConfigDialog
        isOpen
        onClose={vi.fn()}
        existingCount={4}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByText(/从第 5 章起往后生成/)).toBeVisible()
    await act(async () => page.getByRole('spinbutton').nth(0).fill('4'))
    await act(async () => page.getByRole('button', { name: '开始生成' }).click())

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'append',
      startChapter: 5,
      count: 4,
    }))
  })

  it('appends after the highest existing blueprint when chapter numbers are non-consecutive', async () => {
    authoritativeNextChapter = 1
    blueprintChapterNumbers = [1, 3, 4]
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <DirectoryConfigDialog
        isOpen
        onClose={vi.fn()}
        existingCount={3}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByText(/从第 5 章起往后生成/)).toBeVisible()
    await act(async () => page.getByRole('button', { name: '开始生成' }).click())

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'append',
      startChapter: 5,
    }))
  })

  it('blocks blueprint generation when finalized authority has a gap', async () => {
    authorityGap = 4
    const onConfirm = vi.fn()
    await act(async () => root.render(
      <DirectoryConfigDialog
        isOpen
        onClose={vi.fn()}
        existingCount={0}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByText(/权威定稿缺少第 4 章/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: '开始生成' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps architecture confirmation open and reports launcher rejection', async () => {
    const onClose = vi.fn()
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={onClose}
        launchMode={{ kind: 'single', step: 'premise' }}
        archStatus={{ premise: false, characters: false, worldbuilding: false, synopsis: false }}
        onConfirm={vi.fn().mockRejectedValue(new Error('架构启动被领域门禁拒绝'))}
      />,
    ))

    await act(async () => page.getByRole('button', { name: /确认生成/ }).click())

    await expect.element(page.getByText('架构启动被领域门禁拒绝')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })

  it('defaults a large-book synopsis batch to chapters 1-20', async () => {
    useProjectStore.setState({
      currentProject: {
        ...project,
        novelConfig: { ...project.novelConfig, totalChapters: 100 },
      } as never,
    })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'synopsis' }}
        archStatus={{ premise: true, characters: true, worldbuilding: true, synopsis: false }}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByRole('spinbutton', { name: '本次生成范围的起始章' })).toHaveValue(1)
    await expect.element(page.getByRole('spinbutton', { name: '本次生成范围的结束章' })).toHaveValue(20)
    await act(async () => page.getByRole('button', { name: /确认生成/ }).click())

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      ['synopsis'],
      {},
      { from: 1, to: 20 },
      { kind: 'single', step: 'synopsis' },
    ))
  })

  it('preserves the stored continuation range when reopening the synopsis dialog', async () => {
    useProjectStore.setState({
      currentProject: {
        ...project,
        novelConfig: { ...project.novelConfig, totalChapters: 100 },
      } as never,
    })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'synopsis' }}
        archStatus={{ premise: true, characters: true, worldbuilding: true, synopsis: true }}
        initialSynopsisRange={{ from: 21, to: 40 }}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByRole('spinbutton', { name: '本次生成范围的起始章' })).toHaveValue(21)
    await expect.element(page.getByRole('spinbutton', { name: '本次生成范围的结束章' })).toHaveValue(40)
    await act(async () => page.getByRole('button', { name: /确认生成/ }).click())

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      ['synopsis'],
      {},
      { from: 21, to: 40 },
      { kind: 'single', step: 'synopsis' },
    ))
  })

  it.each(['0', '-1', '1.5'])('rejects non-empty invalid synopsis range value %s', async invalidFrom => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'synopsis' }}
        archStatus={{ premise: true, characters: true, worldbuilding: true, synopsis: false }}
        onConfirm={onConfirm}
      />,
    ))

    await act(async () => page.getByRole('spinbutton', { name: '本次生成范围的起始章' }).fill(invalidFrom))
    await act(async () => page.getByRole('button', { name: /确认生成/ }).click())

    await expect.element(page.getByText(/全书总纲兼容模式的按章范围无效/)).toBeVisible()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('starts batch mode with no checked steps and supports keyboard selection', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'batch' }}
        archStatus={{ premise: false, characters: false, worldbuilding: false, synopsis: false }}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByRole('button', { name: '确认生成（0/4）' })).toBeDisabled()
    const premiseCheckbox = page.getByRole('checkbox', { name: '故事前提生成步骤' }).element() as HTMLInputElement
    await act(async () => {
      premiseCheckbox.focus()
      await userEvent.keyboard('{Space}')
    })
    await expect.element(page.getByRole('checkbox', { name: '故事前提生成步骤' })).toBeChecked()
    await expect.element(page.getByRole('button', { name: '确认生成（1/4）' })).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('preselects only the single target and explains its write effect', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await page.viewport(1280, 900)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'premise' }}
        archStatus={{ premise: true, characters: true, worldbuilding: true, synopsis: true }}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByRole('checkbox', { name: '故事前提生成步骤' })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: '角色资料生成步骤' })).not.toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: '世界观总纲生成步骤' })).not.toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: '兼容模式：全书总纲（按章范围）生成步骤' })).not.toBeChecked()
    await expect.element(page.getByText('输出：故事前提文档；成功后替换当前故事前提。', { exact: true })).toBeVisible()
    await page.screenshot({ path: '../../../../screenshots/basic-settings-single-confirm.png' })

    await act(async () => page.getByRole('button', { name: '确认生成（1/4）' }).click())
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm).toHaveBeenCalledWith(
      ['premise'],
      {},
      undefined,
      { kind: 'single', step: 'premise' },
    )
  })

  it('blocks a missing dependency until the author explicitly includes it or opens it to edit', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await page.viewport(1280, 900)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'synopsis' }}
        archStatus={{ premise: false, characters: false, worldbuilding: false, synopsis: false }}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByRole('alert').getByText(/所选步骤缺少前置内容/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: '确认生成（1/4）' })).toBeDisabled()
    page.getByRole('button', { name: '加入所需生成步骤' }).element().scrollIntoView({ block: 'center' })
    await page.screenshot({ path: '../../../../screenshots/basic-settings-dependency-missing.png' })

    await act(async () => page.getByRole('button', { name: '加入所需生成步骤' }).click())
    for (const name of ['故事前提', '角色资料', '世界观总纲', '兼容模式：全书总纲（按章范围）']) {
      await expect.element(page.getByRole('checkbox', { name: `${name}生成步骤` })).toBeChecked()
    }
    await expect.element(page.getByRole('button', { name: '确认生成（4/4）' })).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()

    await act(async () => page.getByRole('button', { name: '去填写' }).first().click())
    await vi.waitFor(() => expect(useEditorStore.getState().tabs.some(tab => (
      tab.type === 'arch-file' && tab.filePath === 'vela://core/premise'
    ))).toBe(true))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps a resume pinned to one checkpoint step and hides the new-batch range', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'resume', step: 'synopsis' }}
        archStatus={{ premise: true, characters: true, worldbuilding: true, synopsis: true }}
        initialSynopsisRange={{ from: 21, to: 40 }}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByRole('checkbox', { name: '兼容模式：全书总纲（按章范围）生成步骤' })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: '故事前提生成步骤' })).toBeDisabled()
    await expect.element(page.getByRole('spinbutton', { name: '本次生成范围的起始章' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: '继续检查点（1/4）' })).toBeEnabled()
    await act(async () => page.getByRole('button', { name: '继续检查点（1/4）' }).click())
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      ['synopsis'],
      {},
      undefined,
      { kind: 'resume', step: 'synopsis' },
    ))
  })

  it('resets selection when the same open dialog changes launch mode', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const archStatus = { premise: true, characters: true, worldbuilding: true, synopsis: true }
    const renderMode = async (launchMode: {
      kind: 'single'; step: 'premise' | 'synopsis'
    } | { kind: 'batch' } | { kind: 'resume'; step: 'worldbuilding' | 'synopsis' }) => {
      await act(async () => root.render(
        <ArchitectureConfirmDialog
          isOpen
          onClose={vi.fn()}
          launchMode={launchMode}
          archStatus={archStatus}
          onConfirm={onConfirm}
        />,
      ))
    }
    const expectSelected = async (selectedSteps: string[]) => {
      for (const [name, step] of [
        ['故事前提生成步骤', 'premise'],
        ['角色资料生成步骤', 'characters'],
        ['世界观总纲生成步骤', 'worldbuilding'],
        ['兼容模式：全书总纲（按章范围）生成步骤', 'synopsis'],
      ] as const) {
        if (selectedSteps.includes(step)) {
          await expect.element(page.getByRole('checkbox', { name })).toBeChecked()
        } else {
          await expect.element(page.getByRole('checkbox', { name })).not.toBeChecked()
        }
      }
    }
    const toggleByKeyboard = async (name: string) => {
      await act(async () => {
        ;(page.getByRole('checkbox', { name }).element() as HTMLInputElement).focus()
        await userEvent.keyboard('{Space}')
      })
    }

    await renderMode({ kind: 'single', step: 'premise' })
    await expectSelected(['premise'])
    await toggleByKeyboard('兼容模式：全书总纲（按章范围）生成步骤')
    await expectSelected(['premise', 'synopsis'])

    await renderMode({ kind: 'single', step: 'synopsis' })
    await expectSelected(['synopsis'])
    await toggleByKeyboard('故事前提生成步骤')
    await expectSelected(['premise', 'synopsis'])

    await renderMode({ kind: 'batch' })
    await expectSelected([])
    await expect.element(page.getByRole('button', { name: '确认生成（0/4）' })).toBeDisabled()
    await toggleByKeyboard('角色资料生成步骤')
    await expectSelected(['characters'])

    await renderMode({ kind: 'resume', step: 'worldbuilding' })
    await expectSelected(['worldbuilding'])
    await expect.element(page.getByRole('checkbox', { name: '故事前提生成步骤' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('localizes the selector and dependency explanation in English', async () => {
    useLocaleStore.setState({ locale: 'en-US' })
    useProjectStore.setState({
      currentProject: {
        ...project,
        novelConfig: { ...project.novelConfig, genre: 'Fantasy', coreOutline: 'A story about a quiet village and a changing world.' },
      } as never,
    })
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'worldbuilding' }}
        archStatus={{ premise: false, characters: false, worldbuilding: false, synopsis: false }}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    ))

    await expect.element(page.getByRole('heading', { name: 'Generate Basic Settings' })).toBeVisible()
    await expect.element(page.getByRole('alert').getByText(/selected steps are missing prerequisites/i)).toBeVisible()
    expect(page.getByRole('dialog').element().textContent).not.toMatch(/[\u4e00-\u9fff]/u)
  })

  it('opens Creative Direction when its required input is missing', async () => {
    useProjectStore.setState({
      currentProject: {
        ...project,
        novelConfig: {
          ...project.novelConfig,
          coreOutline: '',
          protagonistProfile: '',
          worldSetting: '',
        },
      } as never,
    })
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'single', step: 'premise' }}
        archStatus={{ premise: false, characters: false, worldbuilding: false, synopsis: false }}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    ))

    await expect.element(page.getByRole('alert').getByText(/请先在「创作方向」填写/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: '确认生成（1/4）' })).toBeDisabled()
    await act(async () => page.getByRole('button', { name: '去填写创作方向' }).click())
    expect(useEditorStore.getState().tabs.some(tab => tab.type === 'config')).toBe(true)
  })

  it('keeps the selector within a narrow viewport', async () => {
    await page.viewport(375, 820)
    await act(async () => root.render(
      <ArchitectureConfirmDialog
        isOpen
        onClose={vi.fn()}
        launchMode={{ kind: 'batch' }}
        archStatus={{ premise: false, characters: false, worldbuilding: false, synopsis: false }}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    ))

    const dialog = page.getByRole('dialog').element()
    const bounds = dialog.getBoundingClientRect()
    expect(bounds.width).toBeLessThanOrEqual(window.innerWidth)
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
    await expect.element(page.getByRole('button', { name: '确认生成（0/4）' })).toBeDisabled()
  })

  it('keeps directory configuration open and reports launcher rejection', async () => {
    const onClose = vi.fn()
    await act(async () => root.render(
      <DirectoryConfigDialog
        isOpen
        onClose={onClose}
        existingCount={0}
        onConfirm={vi.fn().mockRejectedValue(new Error('故事前提尚未生成'))}
      />,
    ))

    await expect.element(page.getByText(/预计至少 1 次模型调用/)).toBeVisible()

    await act(async () => page.getByRole('button', { name: '开始生成' }).click())

    await expect.element(page.getByText('故事前提尚未生成')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })

  it('shows and completes a durable character-sync repair without launching generation', async () => {
    let pending = true
    const operation = {
      operationId: 'blueprint-sync-directory-restart',
      blueprintCommitOperationId: 'directory-restart',
      blueprintCommitPayloadHash: 'a'.repeat(64),
      status: 'pending' as const,
      startChapter: 1,
      endChapter: 2,
      characterSyncInput: [],
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    }
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:blueprint-get-all') return []
      if (channel === 'db:blueprint-list-summary') return []
      if (channel === 'db:draft-authority-sequence') return {
        status: 'empty',
        lastChapterNumber: 0,
        nextChapterNumber: 1,
        duplicateChapterNumbers: [],
        authorityFingerprint: 'c'.repeat(64),
      }
      if (channel === 'db:blueprint-character-sync-list-pending') return pending ? [operation] : []
      if (channel === 'db:blueprint-character-sync-get') return operation
      if (channel === 'db:blueprint-character-sync-complete') {
        pending = false
        return {
          success: true,
          operation: {
            ...operation,
            status: 'completed',
            completionReceipt: args[1],
          },
        }
      }
      return { success: true }
    })
    const onConfirm = vi.fn()
    await act(async () => root.render(
      <DirectoryConfigDialog
        isOpen
        onClose={vi.fn()}
        existingCount={2}
        onConfirm={onConfirm}
      />,
    ))

    await expect.element(page.getByText(/1 次角色同步待修复/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: '开始生成' })).toBeEnabled()
    await act(async () => page.getByRole('button', { name: '重试角色同步' }).click())

    expect(invoke.mock.calls.some(([channel]) => (
      channel === 'db:blueprint-character-sync-complete'
    ))).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
    await expect.element(page.getByRole('button', { name: '开始生成' })).toBeEnabled()
  })
})
