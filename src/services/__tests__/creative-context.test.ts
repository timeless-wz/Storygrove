import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSessionContext } from '../../shared/ipc-channels'
import { buildCreativeContextBundle } from '../../shared/creative-content'

const mocks = vi.hoisted(() => ({ invokeWithProjectSession: vi.fn() }))
vi.mock('../ipc-client', () => ({ ipc: { invokeWithProjectSession: mocks.invokeWithProjectSession } }))

import {
  buildCreativeCorePromptSources,
  loadInformationRevealPromptSources,
  loadSelectedCreativeMaterialPromptSources,
} from '../creative-context'

const session: ProjectSessionContext = { projectId: 'test-project', leaseId: 'lease-1', projectPath: 'C:\\test-project' }

describe('creative-context source selection', () => {
  beforeEach(() => mocks.invokeWithProjectSession.mockReset())

  it('uses formal premise and world sources without repeating matching pending legacy copies', () => {
    const sources = buildCreativeCorePromptSources({
      premise: '# 故事前提\n正式前提',
      worldbuilding: '# 世界设定\n正式规则',
      coreOutline: '# 旧前提\n不可重复注入',
      worldSetting: '# 旧背景\n不可重复注入',
    } as never, [
      { sourceField: 'coreOutline', label: '旧构想', content: '# 旧前提\n不可重复注入', contentHash: 'a', recommendedCategories: ['premise'], disposition: 'pending' },
      { sourceField: 'worldSetting', label: '旧背景', content: '# 旧背景\n不可重复注入', contentHash: 'b', recommendedCategories: ['world-setting'], disposition: 'pending' },
    ], ['premise', 'world-setting'])

    const prompt = buildCreativeContextBundle(sources, 'zh-CN').promptText
    expect(prompt).toContain('正式前提')
    expect(prompt).toContain('正式规则')
    expect(prompt).not.toContain('不可重复注入')
  })

  it('does not load candidate materials unless the author selected record IDs', async () => {
    expect(await loadSelectedCreativeMaterialPromptSources(session, session.projectPath, [])).toEqual([])
    expect(mocks.invokeWithProjectSession).not.toHaveBeenCalled()

    mocks.invokeWithProjectSession.mockResolvedValue([{
      id: 'cm-1', title: '潮门候选', entryKind: 'material', materialType: 'hook', status: 'candidate',
      markdown: '# 潮门\n\n只在逆潮时开启。', sourceFileName: '04_事件与遗境库.md', sourceHeading: '潮门', revision: 3,
    }])
    const sources = await loadSelectedCreativeMaterialPromptSources(session, session.projectPath, ['cm-1'])
    const prompt = buildCreativeContextBundle(sources, 'zh-CN').promptText
    expect(mocks.invokeWithProjectSession).toHaveBeenCalledWith(session, 'db:creative-material-list', { entryKind: 'material' }, session.projectPath)
    expect(prompt).toContain('作者选择的素材：潮门候选')
    expect(prompt).toContain('候选，不作为事实')
    expect(prompt).toContain('04_事件与遗境库.md / 潮门')
    expect(prompt).toContain('作者确认前不得作为正式事实')
  })

  it('keeps author-unconfirmed truth undecided and limits chapter reads to explicitly linked narrative positions', async () => {
    const confirmed = {
      id: 'info-confirmed', title: '门后真相', summary: '作者已决定门后是什么。', truth: '门后是旧城区。', truthStatus: 'confirmed', revision: 2,
    }
    const undecided = {
      id: 'info-open', title: '失踪者去向', summary: '尚未定案。', truth: '', truthStatus: 'undecided', revision: 1,
    }
    const planRecord = {
      id: 'knowledge-plan', infoId: 'info-confirmed', subjectKind: 'reader', knownContent: '看见门牌号码',
      cognition: 'suspected', believedStatement: '门后有人居住', truthRelation: 'partial', learningChannel: '现场观察',
      channelSourceNote: '', storyPosition: { kind: 'unplaced' }, narrativePosition: { kind: 'chapter-scene', chapterNumber: 5 },
      basis: 'plan', reader: { shownEvidence: '褪色门牌', expectedUnderstanding: '门后还有住户', revealPlanNote: '第5章末透露住户身份' }, revision: 4,
    }
    const undecidedRecord = {
      ...planRecord,
      id: 'knowledge-open',
      infoId: 'info-open',
      narrativePosition: { kind: 'chapter-scene', chapterNumber: 5 },
      reader: { shownEvidence: '', expectedUnderstanding: '', revealPlanNote: '作者尚未决定揭露方式' },
    }
    mocks.invokeWithProjectSession.mockImplementation(async (...args: unknown[]) => {
      const channel = args.find(arg => typeof arg === 'string' && arg.startsWith('db:'))
      if (typeof channel !== 'string') return []
      if (channel === 'db:info-entry-list') return [confirmed, undecided]
      if (channel === 'db:knowledge-record-list') return [planRecord, undecidedRecord]
      throw new Error(`Unexpected channel ${channel}`)
    })
    const sources = await loadInformationRevealPromptSources(session, session.projectPath, [5])
    const bundle = buildCreativeContextBundle(sources, 'zh-CN')
    expect(bundle.promptText).toContain('门后是旧城区')
    expect(bundle.promptText).toContain('作者尚未确定真相；不得自行补全。')
    expect(bundle.promptText).toContain('作者尚未确定，不得补全')
    expect(bundle.promptText).toContain('第5章末透露住户身份')
    expect(bundle.promptText).toContain('作者尚未决定揭露方式')
    expect(sources.map(source => source.id)).toContain('knowledge_records.knowledge-plan@r4')
    expect(mocks.invokeWithProjectSession).toHaveBeenCalledWith(session, 'db:info-entry-list', undefined, session.projectPath)
    expect(mocks.invokeWithProjectSession).toHaveBeenCalledWith(session, 'db:knowledge-record-list', undefined, session.projectPath)
  })
})
