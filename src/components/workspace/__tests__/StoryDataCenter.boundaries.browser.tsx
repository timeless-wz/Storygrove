import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StoryDataCenter from '../StoryDataCenter'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStoryDataStore } from '../../../stores/story-data-store'
import { useWorkspaceHubStore } from '../../../stores/workspace-hub-store'
import type { StoryFact, StoryFactCandidate, StoryProvenance } from '../../../shared/story-domain'
import type { WorkspaceSource } from '../../../shared/workspace-hub'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const provenance: StoryProvenance = {
  sourceId: 'source-1',
  sourceSnapshotId: 'snapshot-approved',
  sourceFragmentId: 'fragment-1',
  sourceFile: '05_人物与关系.md',
  sourceHeadingPath: '角色 / 林舟',
  startLine: 1,
  endLine: 4,
  contentHash: 'hash-1',
}

const facts: StoryFact[] = [
  {
    factId: 'fact-confirmed', projectId: 'main', entityType: 'character', canonicalName: '林舟',
    summary: '主角', payload: {}, status: 'confirmed', confidence: 0.99, revision: 2,
    provenance, createdAt: '', updatedAt: '', confirmedBy: 'author', confirmedAt: '2026-01-02',
  },
  {
    factId: 'fact-candidate', projectId: 'main', entityType: 'relationship', canonicalName: '旧盟友',
    summary: '曾与主角同盟', payload: {}, status: 'candidate', confidence: 0.6, revision: 1,
    provenance, createdAt: '', updatedAt: '',
  },
  {
    factId: 'fact-deprecated', projectId: 'main', entityType: 'world_rule', canonicalName: '旧灵力上限',
    summary: '已被新设定取代', payload: {}, status: 'deprecated', confidence: 0.2, revision: 1,
    provenance, createdAt: '', updatedAt: '',
  },
]

const candidates: StoryFactCandidate[] = [
  {
    candidateId: 'cand-1', projectId: 'main', entityType: 'character', canonicalName: '雾港守卫',
    summary: '扫描得到的角色候选', payload: {}, confidence: 0.55, provenance,
    authorityStatus: 'candidate', reviewStatus: 'pending', createdAt: '',
  },
]

// 母稿来源已产生新的批准快照，因此依据旧快照的资料必须显示「母稿已变化」。
const sources: WorkspaceSource[] = [
  {
    id: 'source-1', projectId: 'main', absolutePath: 'C:\\novel\\05_人物与关系.md',
    relativePath: '05_人物与关系.md', category: 'character_data', authorityStatus: 'confirmed',
    contentHash: 'hash-1', mtime: 0, lastScannedAt: '', importStatus: 'imported',
    approvedSnapshotId: 'snapshot-newer', observedSnapshotId: 'snapshot-newer',
    isMissing: false, isDisabled: false,
  },
]

let root: Root
let container: HTMLDivElement
const originalLocaleState = useLocaleStore.getState()
const originalProjectState = useProjectStore.getState()
const originalStoryDataState = useStoryDataStore.getState()
const originalWorkspaceState = useWorkspaceHubStore.getState()

const region = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)
const statValue = (testId: string) => region(testId)?.textContent ?? ''
const regionText = (testId: string) => region(testId)?.textContent ?? ''

beforeEach(async () => {
  useLocaleStore.setState({ locale: 'zh-CN', initialized: true })
  useProjectStore.setState({ currentProject: { id: 'main', path: 'C:\\novel', sessionLease: 'lease-1' } as never })
  useStoryDataStore.setState({
    candidates, facts, selectedFactId: null, versions: [], impacts: [], relations: [], allRelations: [],
    loading: false, error: null,
    load: vi.fn(async () => undefined),
    selectFact: vi.fn(async () => undefined),
  })
  useWorkspaceHubStore.setState({ sources })
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
  useWorkspaceHubStore.setState(originalWorkspaceState, true)
})

describe('StoryDataCenter authority separation', () => {
  it('never mixes deprecated or candidate records into the confirmed facts list', () => {
    const confirmed = regionText('story-queue-confirmed')
    expect(confirmed).toContain('林舟')
    expect(confirmed).toContain('正式事实 · 已确认 (1)')
    expect(confirmed).not.toContain('旧灵力上限')
    expect(confirmed).not.toContain('旧盟友')
    expect(confirmed).not.toContain('雾港守卫')

    const candidatesQueue = regionText('story-queue-candidates')
    expect(candidatesQueue).toContain('雾港守卫')
    expect(candidatesQueue).toContain('候选 · 非设定')
    expect(candidatesQueue).toContain('待作者确认')
    expect(candidatesQueue).not.toContain('林舟')

    const candidateRecords = regionText('story-queue-candidate-records')
    expect(candidateRecords).toContain('旧盟友')
    expect(candidateRecords).not.toContain('林舟')
    expect(candidateRecords).not.toContain('旧灵力上限')
  })

  it('keeps deprecated content collapsed behind an explicit exclusion note', async () => {
    const deprecated = region('story-queue-deprecated')!
    expect(deprecated.textContent).toContain('已废止内容 (1)')
    expect(deprecated.textContent).toContain('严禁进入正文与生成上下文')
    // 折叠时不展示条目内容，但计数与禁止注入的说明始终可见
    expect(deprecated.textContent).not.toContain('旧灵力上限')

    const toggle = deprecated.querySelector('button')!
    await act(async () => toggle.click())
    expect(deprecated.textContent).toContain('旧灵力上限')
  })

  it('summarises the four boundaries with real counts', () => {
    expect(statValue('story-stat-confirmed')).toContain('1')
    expect(statValue('story-stat-confirmed')).toContain('正式事实（已确认）')
    expect(statValue('story-stat-candidates')).toContain('1')
    expect(statValue('story-stat-deprecated')).toContain('1')
    // 依据旧快照的条目：林舟、旧盟友、雾港守卫（废止内容不参与复核统计）
    expect(statValue('story-stat-snapshot-review')).toContain('3')
  })

  it('flags facts whose cited snapshot is not the approved source snapshot', () => {
    expect(regionText('story-queue-confirmed')).toContain('母稿已变化')
  })

  it('lists every category group in the navigation rail with counts including candidates', () => {
    const rail = container.querySelector('nav[aria-label="资料分类导航"]')!
    const railText = rail.textContent ?? ''
    expect(railText).toContain('分类档案（正式 + 候选）')
    expect(railText).toContain('权威状态')
    expect(railText).toContain('来源快照待复核')
    // 人物与关系 = 人物(林舟) + 关系(旧盟友) + 候选人物(雾港守卫)
    const peopleEntry = [...rail.querySelectorAll('button')].find(button => button.textContent?.includes('人物与关系'))!
    expect(peopleEntry.textContent).toContain('3')
  })

  it('states that scanning only produces candidates, never confirmed settings', () => {
    expect(container.textContent).toContain('模型与扫描只能提交候选')
    expect(regionText('story-queue-candidates')).toContain('来自模型或母稿扫描，尚未写入正式资料库')
  })

  it('resets the entity type filter when switching to another category group', async () => {
    const typeSelect = container.querySelector('select[aria-label="资料类型"]') as HTMLSelectElement
    const setSelectValue = (element: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    await act(async () => setSelectValue(typeSelect, 'character'))
    expect(typeSelect.value).toBe('character')

    const worldGroup = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="资料分类导航"] button')]
      .find(button => button.textContent?.includes('世界设定'))!
    await act(async () => worldGroup.click())

    // 分类档案的类型下拉只列出本组类型，因此必须同时重置类型筛选，避免不可见的空结果
    expect(typeSelect.value).toBe('all')
  })

  it('keeps the deprecated bucket out of the snapshot review counter', () => {
    // 废止内容本就禁止进入上下文，复核计数只统计仍在使用的记录。
    const reviewCount = (statValue('story-stat-snapshot-review').match(/\d+/) ?? [])[0]
    expect(reviewCount).toBe('3')
  })
})
