import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StoryDataCenter from '../StoryDataCenter'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryDataStore } from '../../../stores/story-data-store'
import type { StoryFact, StoryFactRelation, StoryProvenance } from '../../../shared/story-domain'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const provenance: StoryProvenance = {
  sourceId: 'source-1', sourceSnapshotId: 'snapshot-1', sourceFragmentId: 'fragment-1',
  sourceFile: '人物.md', sourceHeadingPath: '角色 / 林舟', startLine: 1, endLine: 4, contentHash: 'hash-1',
}
const facts: StoryFact[] = [
  { factId: 'fact-character', projectId: 'main', entityType: 'character', canonicalName: '林舟', summary: '主角', payload: { role: '主角', status: '清醒', location: '雾港', condition: '轻伤', motivation: '寻找真相' }, status: 'confirmed', confidence: 0.99, revision: 1, provenance, createdAt: '', updatedAt: '' },
  { factId: 'fact-event', projectId: 'main', entityType: 'timeline_event', canonicalName: '雾港冲突', summary: '第31章发生冲突', payload: { chapterNumber: 31, date: '第三日' }, status: 'confirmed', confidence: 0.9, revision: 1, provenance, createdAt: '', updatedAt: '' },
  { factId: 'fact-foreshadowing', projectId: 'main', entityType: 'foreshadowing', canonicalName: '黑钟秘密', summary: '黑钟将在终卷揭晓', payload: { recoveryStatus: 'planted' }, status: 'confirmed', confidence: 0.85, revision: 1, provenance, createdAt: '', updatedAt: '' },
]
const relation: StoryFactRelation = { relationId: 'relation-1', projectId: 'main', fromFactId: 'fact-character', toFactId: 'fact-event', relationType: '参与', status: 'confirmed', provenance, createdAt: '' }
let root: Root
let container: HTMLDivElement
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalStoryDataState = useStoryDataStore.getState()

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
  useStoryDataStore.setState({ candidates: [], facts, selectedFactId: 'fact-character', versions: [], impacts: [], relations: [], allRelations: [relation], loading: false, error: null, load: vi.fn(async () => undefined), selectFact: vi.fn(async () => undefined) })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<StoryDataCenter />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLocaleStore.setState(originalLocaleState, true)
  useProjectStore.setState(originalProjectState, true)
  useStoryDataStore.setState(originalStoryDataState, true)
})

describe('StoryDataCenter browser acceptance', () => {
  it('switches among character, timeline, graph, and foreshadowing views', async () => {
    const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label)) as HTMLButtonElement | undefined
    expect(container.textContent).toContain('人物卡字段')
    await act(async () => button('时间轴')?.click())
    expect(container.textContent).toContain('全书时间轴 / 事件 Ledger')
    expect(container.textContent).toContain('雾港冲突')
    await act(async () => button('关系图')?.click())
    expect(container.querySelector('svg[aria-label="story fact relationship graph"]')).toBeTruthy()
    await act(async () => button('伏笔回收')?.click())
    expect(container.textContent).toContain('黑钟秘密')
    expect(container.textContent).toContain('planted')
  })
})
