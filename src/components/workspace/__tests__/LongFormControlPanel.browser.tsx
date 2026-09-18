import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LongFormControlPanel from '../LongFormControlPanel'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryDataStore } from '../../../stores/story-data-store'
import type { StoryFact } from '../../../shared/story-domain'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const provenance = { sourceId: 's', sourceSnapshotId: 'ss', sourceFragmentId: 'f', sourceFile: 'x.md', sourceHeadingPath: '#', startLine: 1, endLine: 1, contentHash: 'h' }
const fact = (entityType: StoryFact['entityType'], payload: Record<string, unknown>): StoryFact => ({ factId: `${entityType}-1`, projectId: 'main', entityType, canonicalName: entityType, summary: '', payload, status: 'confirmed', confidence: 1, revision: 1, provenance, createdAt: '', updatedAt: '' })
const originalLocale = useLocaleStore.getState()
const originalProject = useProjectStore.getState()
const originalStoryData = useStoryDataStore.getState()
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: { id: 'main', name: '测试长篇', path: 'C:\\novel', sessionLease: 'lease-1', novelConfig: { totalChapters: 100, wordsPerChapter: 3000 } } as never })
  useStoryDataStore.setState({ facts: [fact('timeline_event', { chapterNumber: 31 }), fact('narrative_thread', { status: 'active' }), fact('foreshadowing', { recoveryStatus: 'planted' })] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<LongFormControlPanel />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLocaleStore.setState(originalLocale, true)
  useProjectStore.setState(originalProject, true)
  useStoryDataStore.setState(originalStoryData, true)
})

describe('LongFormControlPanel browser acceptance', () => {
  it('shows progress, long-range metrics, and next actions from authoritative facts', () => {
    expect(container.textContent).toContain('长篇叙事控制台')
    expect(container.textContent).toContain('时间轴覆盖进度')
    expect(container.textContent).toContain('未回收伏笔')
    expect(container.textContent).toContain('优先检查未回收伏笔')
  })
})
