/**
 * 信息与揭露（信息差）仓库测试 — 临时项目库（knowledge-action-outline-sync-contract §3）。
 * 覆盖验收矩阵 1/2/4：真相未定不冒充已确认；同一条目多人物记录互不污染；
 * 稳定 ID 关联在人物改名后不漂移（记录按 characterId 存取）。
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../../database'
import { KnowledgeGapRepository } from '../knowledge-gap-repository'
import type { KnowledgeRecordDraft } from '../../../src/shared/knowledge-gap'

const testRoot = path.resolve('.runtime/.cache/knowledge-gap-repository-tests')

let projectRoot = ''

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true })
})

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(testRoot, 'case-'))
  initProjectDatabase(projectRoot)
})

afterEach(() => {
  closeProjectDatabase()
})

function characterDraft(characterId: string, overrides: Partial<KnowledgeRecordDraft> = {}): KnowledgeRecordDraft {
  return {
    infoId: '',
    subjectKind: 'character',
    characterId,
    knownContent: '知道密室的入口在书架后',
    cognition: 'confident',
    believedStatement: '密室里藏着父亲的遗物',
    truthRelation: 'misconstrued',
    learningChannel: '调查',
    channelSourceNote: '第2章书房夜谈',
    storyPosition: { kind: 'unplaced' },
    narrativePosition: { kind: 'chapter-scene', chapterNumber: 2 },
    concealment: null,
    basis: 'plan',
    reader: null,
    ...overrides,
  }
}

describe('KnowledgeGapRepository — 信息条目', () => {
  it('未决定真相的条目不允许 confirmed 状态（未知不虚构真相）', () => {
    expect(() => KnowledgeGapRepository.saveInfoEntry({
      title: '密室的秘密',
      summary: '关于密室真正用途的信息',
      truth: '',
      truthStatus: 'confirmed',
      sourceRefs: [],
      relatedThreadPlanIds: [],
    })).toThrow(/已确认/)
  })

  it('新建条目写入首个真相版本；真相修改追加历史并返回受影响记录数', () => {
    const saved = KnowledgeGapRepository.saveInfoEntry({
      title: '密室的秘密',
      summary: '',
      truth: '密室是母亲的实验室',
      truthStatus: 'confirmed',
      sourceRefs: [{ kind: 'chapter', chapterNumber: 1 }],
      relatedThreadPlanIds: [],
    })
    expect(saved.success).toBe(true)
    expect(saved.revision).toBe(1)

    const record = KnowledgeGapRepository.saveKnowledgeRecord({
      ...characterDraft('ch-1'),
      infoId: saved.id!,
    })
    expect(record.success).toBe(true)

    const updated = KnowledgeGapRepository.saveInfoEntry({
      id: saved.id,
      baseRevision: 1,
      title: '密室的秘密',
      summary: '',
      truth: '密室是父亲的藏身所',
      truthStatus: 'confirmed',
      sourceRefs: [],
      relatedThreadPlanIds: [],
      truthChangeNote: '作者改稿',
    })
    expect(updated.success).toBe(true)
    expect(updated.revision).toBe(2)
    expect(updated.knowledgeRecordsAffected).toBe(1)

    const history = KnowledgeGapRepository.listTruthHistory(saved.id!)
    expect(history).toHaveLength(2)
    expect(history[0]!.truth).toBe('密室是父亲的藏身所')
    expect(history[1]!.truth).toBe('密室是母亲的实验室')
  })

  it('乐观并发：baseRevision 过期返回 conflict，不写入', () => {
    const saved = KnowledgeGapRepository.saveInfoEntry({
      title: 'A', summary: '', truth: 'T', truthStatus: 'confirmed',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    const stale = KnowledgeGapRepository.saveInfoEntry({
      id: saved.id, baseRevision: 0,
      title: 'B', summary: '', truth: 'T2', truthStatus: 'confirmed',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    expect(stale.conflict).toBe(true)
    expect(stale.currentRevision).toBe(1)
    const current = KnowledgeGapRepository.getInfoEntry(saved.id!)
    expect(current?.title).toBe('A')
  })

  it('删除条目只删条目、历史与该条目记录，并返回删除的记录数', () => {
    const saved = KnowledgeGapRepository.saveInfoEntry({
      title: 'S', summary: '', truth: '', truthStatus: 'undecided',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    KnowledgeGapRepository.saveKnowledgeRecord({ ...characterDraft('ch-1'), infoId: saved.id! })
    const result = KnowledgeGapRepository.deleteInfoEntry(saved.id!)
    expect(result.deletedRecords).toBe(1)
    expect(KnowledgeGapRepository.getInfoEntry(saved.id!)).toBeNull()
    expect(KnowledgeGapRepository.listKnowledgeRecords({ infoId: saved.id! })).toHaveLength(0)
  })
})

describe('KnowledgeGapRepository — 知情记录', () => {
  it('同一秘密：A 确信错误说法、B 未知、读者只见线索——分别保存且互不污染', () => {
    const entry = KnowledgeGapRepository.saveInfoEntry({
      title: '身世', summary: '', truth: 'B 是兄长', truthStatus: 'confirmed',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    const a = KnowledgeGapRepository.saveKnowledgeRecord({
      ...characterDraft('ch-A'),
      infoId: entry.id!,
      cognition: 'confident',
      truthRelation: 'misconstrued',
      believedStatement: 'B 是弟弟',
    })
    const b = KnowledgeGapRepository.saveKnowledgeRecord({
      ...characterDraft('ch-B'),
      infoId: entry.id!,
      cognition: 'unknown',
      truthRelation: 'undetermined',
      knownContent: '',
    })
    const reader = KnowledgeGapRepository.saveKnowledgeRecord({
      infoId: entry.id!,
      subjectKind: 'reader',
      knownContent: '',
      cognition: 'suspected',
      believedStatement: '',
      truthRelation: 'undetermined',
      learningChannel: '',
      channelSourceNote: '',
      storyPosition: { kind: 'unplaced' },
      narrativePosition: { kind: 'chapter-scene', chapterNumber: 1 },
      concealment: null,
      basis: 'plan',
      reader: { shownEvidence: 'B 的旧照片', expectedUnderstanding: '读者怀疑两人是兄弟', revealPlanNote: '第10章揭露' },
    })
    expect(a.id).not.toBe(b.id)

    const list = KnowledgeGapRepository.listKnowledgeRecords({ infoId: entry.id! })
    expect(list).toHaveLength(3)
    const byId = new Map(list.map(record => [record.id, record]))
    expect(byId.get(a.id!)?.truthRelation).toBe('misconstrued')
    expect(byId.get(b.id!)?.cognition).toBe('unknown')
    expect(byId.get(reader.id!)?.subjectKind).toBe('reader')
    expect(byId.get(reader.id!)?.reader?.expectedUnderstanding).toBe('读者怀疑两人是兄弟')
  })

  it('正文章节过滤：按叙事位置章节筛选记录', () => {
    const entry = KnowledgeGapRepository.saveInfoEntry({
      title: 'E', summary: '', truth: '', truthStatus: 'undecided',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    KnowledgeGapRepository.saveKnowledgeRecord({ ...characterDraft('ch-1'), infoId: entry.id!, narrativePosition: { kind: 'chapter-scene', chapterNumber: 3 } })
    KnowledgeGapRepository.saveKnowledgeRecord({ ...characterDraft('ch-2'), infoId: entry.id!, narrativePosition: { kind: 'chapter-scene', chapterNumber: 7 } })
    const at3 = KnowledgeGapRepository.listKnowledgeRecords({ chapterNumber: 3 })
    expect(at3).toHaveLength(1)
    expect(at3[0]!.characterId).toBe('ch-1')
  })

  it('正文依据的记录必须带锚点', () => {
    const entry = KnowledgeGapRepository.saveInfoEntry({
      title: 'E', summary: '', truth: '', truthStatus: 'undecided',
      sourceRefs: [], relatedThreadPlanIds: [],
    })
    expect(() => KnowledgeGapRepository.saveKnowledgeRecord({
      ...characterDraft('ch-1'), infoId: entry.id!, basis: 'prose',
    })).toThrow(/锚点/)
  })
})
