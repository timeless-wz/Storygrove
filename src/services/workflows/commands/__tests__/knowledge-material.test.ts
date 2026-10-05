/**
 * 信息差写作材料构建测试（knowledge-action-outline-sync-contract §8）。
 * 覆盖验收矩阵 13：早期角色拿不到后期认知；未定真相不作为客观答案；
 * 位置未知的记录单独标注为计划，不冒充既定事实。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildKnowledgeGapMaterial } from '../knowledge-material'
import { ipc } from '../../../ipc-client'
import type { ProjectSessionContext } from '../../../../shared/ipc-channels'
import type { InfoEntry, KnowledgeRecord } from '../../../../shared/knowledge-gap'

vi.mock('../../../ipc-client', () => ({
  ipc: { invokeWithProjectSession: vi.fn() },
}))

const session: ProjectSessionContext = {
  projectId: 'knowledge-material-project',
  leaseId: 'knowledge-material-lease',
  projectPath: 'C:/novels/knowledge-material',
}

const invokeMock = vi.mocked(ipc.invokeWithProjectSession)

function record(overrides: Partial<KnowledgeRecord>): KnowledgeRecord {
  return {
    id: 'knw-x',
    infoId: 'info-1',
    subjectKind: 'character',
    characterId: 'id-zhou',
    knownContent: '内容',
    cognition: 'confident',
    believedStatement: '相信',
    truthRelation: 'misconstrued',
    learningChannel: '亲历',
    channelSourceNote: '',
    storyPosition: { kind: 'unplaced' },
    narrativePosition: { kind: 'unplaced' },
    concealment: null,
    basis: 'plan',
    reader: null,
    revision: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function entry(overrides: Partial<InfoEntry>): InfoEntry {
  return {
    id: 'info-1',
    title: '铜钥匙',
    summary: '',
    truth: '钥匙是许渡父亲留下的',
    truthStatus: 'confirmed',
    sourceRefs: [],
    relatedThreadPlanIds: [],
    revision: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

beforeEach(() => {
  invokeMock.mockReset()
})

describe('buildKnowledgeGapMaterial', () => {
  it('位置晚于本章的人物记录不注入（早期角色拿不到后期认知）', async () => {
    invokeMock.mockImplementation((async (_session: ProjectSessionContext, channel: string) => {
      if (channel === 'db:character-identities-get') return { 周晓: 'id-zhou' }
      if (channel === 'db:info-entry-list') return [entry({})]
      if (channel === 'db:knowledge-record-list') {
        return [
          record({ id: 'knw-early', narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 } }),
          record({ id: 'knw-late', narrativePosition: { kind: 'chapter-scene', chapterNumber: 9 } }),
        ]
      }
      throw new Error(`unexpected channel ${channel}`)
    }) as never)
    const result = await buildKnowledgeGapMaterial(session, 2, ['周晓'])
    expect(result).not.toBeNull()
    expect(result!.text).toContain('截至本章')
    expect(result!.text).not.toContain('knw-late')
    expect(result!.characterRecordCount).toBe(1)
  })

  it('未定真相只提示"作者尚未确定"，不给出客观答案；废止条目不出现', async () => {
    invokeMock.mockImplementation((async (_session: ProjectSessionContext, channel: string) => {
      if (channel === 'db:character-identities-get') return { 周晓: 'id-zhou' }
      if (channel === 'db:info-entry-list') {
        return [
          entry({ truthStatus: 'undecided', truth: '' }),
          entry({ id: 'info-2', title: '废案线索', truthStatus: 'retired', truth: '曾经设定的真相' }),
        ]
      }
      if (channel === 'db:knowledge-record-list') {
        return [
          record({ narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 }, infoId: 'info-1' }),
          record({ id: 'knw-2', narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 }, infoId: 'info-2' }),
        ]
      }
      throw new Error(`unexpected channel ${channel}`)
    }) as never)
    const result = await buildKnowledgeGapMaterial(session, 1, ['周晓'])
    expect(result!.text).toContain('作者尚未确定')
    expect(result!.text).not.toContain('曾经设定的真相')
    expect(result!.backgroundEntryCount).toBe(1)
  })

  it('位置未知的记录归入"计划"段；读者记录按叙事位置注入；真相标为不可直接泄露', async () => {
    invokeMock.mockImplementation((async (_session: ProjectSessionContext, channel: string) => {
      if (channel === 'db:character-identities-get') return { 周晓: 'id-zhou', 许渡: 'id-xu' }
      if (channel === 'db:info-entry-list') return [entry({})]
      if (channel === 'db:knowledge-record-list') {
        return [
          record({ id: 'knw-plan', narrativePosition: { kind: 'unplaced' } }),
          record({ id: 'knw-ch1', narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 } }),
          record({
            id: 'knw-reader',
            subjectKind: 'reader',
            narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 },
            reader: { shownEvidence: '第一页的钥匙特写', expectedUnderstanding: '读者预期钥匙重要', revealPlanNote: '' },
          }),
        ]
      }
      throw new Error(`unexpected channel ${channel}`)
    }) as never)
    const result = await buildKnowledgeGapMaterial(session, 1, ['周晓'])
    expect(result!.text).toContain('位置未知')
    expect(result!.text).toContain('不是已确认的正文事实')
    expect(result!.text).toContain('第一页的钥匙特写')
    expect(result!.text).toContain('不可直接泄露')
    // 非本章出场人物（许渡）的记录不被注入。
    expect(result!.text).not.toContain('许渡｜')
  })
})
