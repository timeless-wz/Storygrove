import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceHub from '../WorkspaceHub'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkspaceHubStore } from '../../../stores/workspace-hub-store'
import type { WorkspaceSource } from '../../../shared/workspace-hub'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalProjectState = useProjectStore.getState()
const originalLocaleState = useLocaleStore.getState()
const originalWorkspaceState = useWorkspaceHubStore.getState()
let root: Root
let container: HTMLDivElement

function source(overrides: Partial<WorkspaceSource>): WorkspaceSource {
  return {
    id: 'source-1',
    projectId: 'main',
    absolutePath: 'C:\\novel\\01_已确认设定清单.md',
    relativePath: '01_已确认设定清单.md',
    category: 'confirmed_settings',
    authorityStatus: 'confirmed',
    contentHash: 'hash',
    mtime: 0,
    lastScannedAt: '',
    importStatus: 'imported',
    isMissing: false,
    isDisabled: false,
    ...overrides,
  }
}

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
  useWorkspaceHubStore.setState({
    status: {
      externalWorkspacePath: 'C:\\external-novel',
      lastScannedAt: '2026-09-15T10:00:00.000Z',
      totalFiles: 10,
      recognizedFiles: 8,
      missingFiles: 1,
      changedFiles: 2,
      pendingCandidates: 4,
      confirmedRulesCount: 3,
    },
    sources: [
      source({ id: 'a' }),
      source({ id: 'b', authorityStatus: 'candidate', category: 'character_data' }),
      source({ id: 'c', authorityStatus: 'deprecated', category: 'deprecated' }),
    ],
    scanning: false,
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

describe('WorkspaceHub reading order and data boundaries', () => {
  it('groups the eight surfaces and keeps fact management out of the long-form group', () => {
    const text = container.textContent ?? ''
    for (const label of ['资料与来源', '事实与检索', '长篇控制与修订']) {
      expect(text).toContain(label)
    }

    const buttons = [...container.querySelectorAll('button')]
    const storyData = buttons.find(button => button.textContent?.includes('故事资料中心'))!
    const audit = buttons.find(button => button.textContent?.includes('审核与检索'))!
    const control = buttons.find(button => button.textContent?.includes('长篇控制台'))!

    // 故事资料中心与审核同组，且位于长篇控制台之前：事实与来源先读，统计与控制后读。
    expect(storyData.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(storyData.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('summarises real counters including the pending candidate queue', () => {
    const text = container.textContent ?? ''
    expect(text).toContain('8 / 10')
    expect(text).toContain('待确认候选')
    expect(text).toContain('已变化')
    expect(text).toContain('缺失')
    // 不以“今日字数 / 写作时长”这类无法从资料计算的数据充当摘要
    expect(text).not.toContain('写作时长')
    expect(text).not.toContain('今日字数')
  })

  it('states the source authority boundary with real per-status counts', () => {
    const legend = container.querySelector('[data-testid="workspace-authority-legend"]')!
    const text = legend.textContent ?? ''
    expect(text).toContain('来源权威状态（按已关联文件统计）')
    expect(text).toContain('已确认')
    expect(text).toContain('候选')
    expect(text).toContain('废止')
    expect(text).toContain('扫描只会产生候选与素材，不会直接产生已确认来源。')
    // 已确认 1、候选 1、废止 1（其余状态为 0，仍显式列出）
    expect(text.match(/1/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
})
