import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceHub from '../WorkspaceHub'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkspaceHubStore } from '../../../stores/workspace-hub-store'
import type { ProjectData } from '../../../shared/ipc-channels'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalWorkspaceState = useWorkspaceHubStore.getState()
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  vi.clearAllMocks()
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({
    currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as ProjectData,
  })
  useWorkspaceHubStore.setState({
    status: {
      externalWorkspacePath: 'C:\\external-novel',
      lastScannedAt: '',
      totalFiles: 1,
      recognizedFiles: 1,
      missingFiles: 0,
      changedFiles: 0,
      pendingCandidates: 0,
      confirmedRulesCount: 0,
    },
    sources: [],
    scanning: true,
    cancelling: false,
    loadAll: vi.fn().mockResolvedValue(undefined),
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<WorkspaceHub />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useProjectStore.setState(originalProjectState, true)
  useLocaleStore.setState(originalLocaleState, true)
  useWorkspaceHubStore.setState(originalWorkspaceState, true)
})

describe('WorkspaceHub scan cancellation UI', () => {
  it('shows a cancel button while scanning and invokes the current store cancellation action', async () => {
    const cancelScan = vi.fn(async () => {
      useWorkspaceHubStore.setState({ scanning: false, error: '扫描已取消' })
      return true
    })
    await act(async () => {
      useWorkspaceHubStore.setState({ cancelScan })
    })

    const cancelButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('取消扫描'))
    expect(cancelButton).toBeDefined()

    await act(async () => cancelButton!.click())

    expect(cancelScan).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('重新扫描')
    expect(container.textContent).not.toContain('取消扫描')
  })

  it('shows a cancel button during initial bind scan even when status externalWorkspacePath is empty', async () => {
    const cancelScan = vi.fn(async () => {
      useWorkspaceHubStore.setState({ scanning: false, error: '扫描已取消' })
      return true
    })

    await act(async () => {
      useWorkspaceHubStore.setState({
        status: null,
        scanning: true,
        cancelling: false,
        cancelScan,
      })
    })

    const cancelButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('取消扫描'))
    expect(cancelButton).toBeDefined()

    await act(async () => cancelButton!.click())

    expect(cancelScan).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('关联外部创作母稿目录')
    expect(container.textContent).not.toContain('取消扫描')
  })

  it('disables cancel button and shows "正在取消..." when cancelling is true', async () => {
    await act(async () => {
      useWorkspaceHubStore.setState({
        scanning: true,
        cancelling: true,
      })
    })

    const buttons = [...container.querySelectorAll('button')]
    const cancellingButton = buttons.find(button => button.textContent?.includes('正在取消...'))
    expect(cancellingButton).toBeDefined()
    expect(cancellingButton!.disabled).toBe(true)
  })

  it('isolates state on project switch without leaking previous project workspace details', async () => {
    await act(async () => {
      useWorkspaceHubStore.setState({
        status: {
          externalWorkspacePath: 'C:\\project-A-novel',
          lastScannedAt: '2026-01-01',
          totalFiles: 10,
          recognizedFiles: 8,
          missingFiles: 0,
          changedFiles: 0,
          pendingCandidates: 3,
          confirmedRulesCount: 5,
        },
        scanning: false,
      })
    })
    expect(container.textContent).toContain('C:\\project-A-novel')

    // 切换到新项目
    await act(async () => {
      useProjectStore.setState({
        currentProject: { id: 'proj-B', path: 'C:\\novel-B', sessionLease: 'lease-2' } as ProjectData,
      })
    })

    // 验证旧项目的绑定路径已从渲染树中完全清除
    expect(container.textContent).not.toContain('C:\\project-A-novel')
  })
})
