import { describe, expect, it } from 'vitest'
import {
  buildRevisionLearningSkillMarkdown,
  createInitialRevisionLearningReview,
  parseRevisionLearningResult,
  revisionLearningSkillName,
} from '../revision-learning'
import { computeRevisionLearningDiff } from '../revision-learning-diff'

describe('revision learning paragraph evidence', () => {
  it('detects exact paragraph replacements and retains author selection by stable evidence identity', () => {
    const before = '开场。\n\n人物走进房间。\n\n灯灭了。'
    const after = '开场。\n\n人物停在门边，先听了一会儿。\n\n灯灭了。'
    const first = computeRevisionLearningDiff(before, after)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      kind: 'replaced',
      beforeStartParagraph: 2,
      afterStartParagraph: 2,
      beforeText: '人物走进房间。\n\n',
      afterText: '人物停在门边，先听了一会儿。\n\n',
      coarse: false,
    })

    const edited = [{ ...first[0]!, included: false, authorReason: '这里需要先建立警觉感' }]
    const second = computeRevisionLearningDiff(before, after, edited)
    expect(second[0]).toMatchObject({ id: first[0]!.id, included: false, authorReason: '这里需要先建立警觉感' })
  })

  it('reports insertions and deletions, and marks oversized comparisons as coarse', () => {
    const changes = computeRevisionLearningDiff('留下的段落。\n\n删除段落。\n\n结尾段落。', '新增段落。\n\n留下的段落。\n\n结尾段落。')
    expect(changes.map(change => change.kind)).toEqual(['added', 'removed'])
    expect(computeRevisionLearningDiff('same', 'same')).toEqual([])

    const coarse = computeRevisionLearningDiff('a'.repeat(260_000), 'b'.repeat(260_000))
    expect(coarse).toHaveLength(1)
    expect(coarse[0]?.coarse).toBe(true)
  })
})

describe('revision learning result validation and deterministic skill preview', () => {
  const changes = [
    { id: 'included-change', kind: 'replaced' as const, beforeStartParagraph: 1, afterStartParagraph: 1, beforeEndParagraph: 1, afterEndParagraph: 1, beforeText: 'old', afterText: 'new', contextBefore: '', contextAfter: '', coarse: false, included: true, authorReason: '避免重复解释' },
    { id: 'excluded-change', kind: 'replaced' as const, beforeStartParagraph: 2, afterStartParagraph: 2, beforeEndParagraph: 2, afterEndParagraph: 2, beforeText: 'detail old', afterText: 'detail new', contextBefore: '', contextAfter: '', coarse: false, included: false, authorReason: '' },
  ]

  it('rejects rules that cite excluded or unknown evidence and accepts bounded candidates', () => {
    const invalid = {
      summary: '减少重复解释',
      rules: [{ id: 'r1', title: '收束重复解释', guidance: '每段只保留推进场景所需的信息。', appliesWhen: '同一信息重复出现时', exceptions: '', evidenceChangeIds: ['excluded-change'], reasonSource: 'model_inferred', limitations: '保留必要复述' }],
      nonGeneralizableChanges: [],
      suggestedSkill: { displayName: '克制修稿', description: '让修改优先服务场景推进。' },
    }
    expect(() => parseRevisionLearningResult(JSON.stringify(invalid), changes, '')).toThrow(/未纳入/)

    invalid.rules[0]!.evidenceChangeIds = ['included-change']
    invalid.rules[0]!.reasonSource = 'author_explicit'
    expect(parseRevisionLearningResult(JSON.stringify(invalid), changes, '')).toMatchObject({
      rules: [{ evidenceChangeIds: ['included-change'], reasonSource: 'author_explicit' }],
    })
  })

  it('keeps model candidates unselected and publishes only author-selected rules', () => {
    const result = parseRevisionLearningResult(JSON.stringify({
      summary: '减少重复解释并保持场景张力。',
      rules: [{
        id: 'r1', title: '压缩重复信息', guidance: '删去重复解释，把句子留给当前动作和感受。',
        appliesWhen: '同一段意图被反复说明时', exceptions: '必要的读者提示可保留',
        evidenceChangeIds: ['included-change'], reasonSource: 'author_explicit', limitations: '不要删掉推动因果的线索',
      }],
      nonGeneralizableChanges: [{ changeIds: ['included-change'], reason: '本次的人物选择只属于这一场景。' }],
      suggestedSkill: { displayName: '场景修稿', description: '减少重复表达并保留场景张力。' },
    }), changes, '')
    const attempt = { id: 'attempt-1', inputHash: 'a'.repeat(64) }
    const review = createInitialRevisionLearningReview(result, attempt)
    expect(review.rules[0]?.selected).toBe(false)
    review.rules[0]!.selected = true
    const markdown = buildRevisionLearningSkillMarkdown('f123456789abcdef1234567890abcdef', review, 'zh-CN')
    expect(revisionLearningSkillName('f123456789abcdef1234567890abcdef', 3)).toBe('revision-f123456789abcdef12345678-r3')
    expect(markdown).toContain('压缩重复信息')
    expect(markdown).not.toContain('excluded-change')
  })
})
