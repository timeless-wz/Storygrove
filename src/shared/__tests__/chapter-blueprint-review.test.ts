import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  getBlueprintV2Scenes,
  type BlueprintV2BulletItem,
  type BlueprintV2FieldItem,
  type BlueprintV2SectionItem,
  type ChapterBlueprintV2Detail,
} from '../blueprint-v2'
import { parseChapterBlueprintMarkdown } from '../blueprint-v2-markdown'
import {
  buildChapterBlueprintReviewPrompt,
  normalizeChapterBlueprintReview,
} from '../chapter-blueprint-review'

const fixture = readFileSync('test/fixtures/blueprint-v2/chapter-01.md', 'utf8')
const parsed = parseChapterBlueprintMarkdown(fixture)
const detail: ChapterBlueprintV2Detail = {
  ...parsed.content,
  revision: 4,
  contentHash: 'a'.repeat(64),
}
const scenes = getBlueprintV2Scenes(detail)
type CheckedItem = (BlueprintV2FieldItem | BlueprintV2BulletItem) & {
  check: NonNullable<BlueprintV2FieldItem['check']>
}
const isCheckedItem = (item: BlueprintV2SectionItem): item is CheckedItem => (
  (item.kind === 'field' || item.kind === 'bullet') && item.check !== undefined
)
const checkItems = detail.sections.flatMap(section => section.kind === 'canonical'
  && (section.id === 'foreshadow' || section.id === 'taboos')
  ? section.items.filter(isCheckedItem)
  : [])
const forbidItems = checkItems.filter(item => item.check?.mode === 'forbid')
const referenceItems = checkItems.filter(item => item.check?.mode === 'reference')

const prose = [
  '02:14时，许渡从冷汗中惊醒，工牌上的名字与自己相同，身体却完全陌生。',
  '他在抽屉里发现姓名被划烂的奖状，桌下圆盘残核仍在发热。',
  '求助红灯催他接线；许渡按下接入键，说：“请讲，我听着。”',
  '屏幕显示环城13路404号车已于23:45回库；周晓说：“环城13路末班车没有停，它正在往天上开。”',
].join('\n')

function completeAssessment(overrides: Record<string, unknown> = {}) {
  return {
    scenes: scenes.map((scene, index) => ({
      sceneId: scene.sceneId,
      presence: 'present',
      sequence: 'in-order',
      causality: 'supported',
      description: `第 ${index + 1} 场在正文中可定位。`,
      evidenceQuotes: [prose.split('\n')[index] ?? prose.split('\n')[0]],
      searchRange: { startLine: 1, endLine: prose.split('\n').length },
    })),
    checks: forbidItems.map(item => ({
      checkId: item.id,
      status: 'met',
      description: '正文未出现禁写内容。',
      searchRange: { startLine: 1, endLine: prose.split('\n').length },
    })),
    chapterHook: {
      status: 'lands',
      description: '公交异常在章末形成未解危机。',
      evidenceQuotes: ['环城13路末班车没有停，它正在往天上开。'],
      searchRange: { startLine: 4, endLine: 4 },
    },
    ...overrides,
  }
}

describe('章节蓝图 v2 一致性审查', () => {
  it('按稳定 sceneId 报告四场顺序、公交章末钩子与禁写检查', () => {
    const prompt = buildChapterBlueprintReviewPrompt(detail, 'zh-CN')
    const result = normalizeChapterBlueprintReview(completeAssessment(), detail, prose)

    expect(prompt).toContain('分镜全文按分号或短句切开')
    expect(prompt).toContain('环城13路末班车')
    expect(prompt).toContain('reference 永不产生发现')
    expect(result.review.scenes.map(scene => scene.sceneId)).toEqual(scenes.map(scene => scene.sceneId))
    expect(result.review.scenes.map(scene => scene.order)).toEqual([1, 2, 3, 4])
    expect(result.review.scenes.every(scene => scene.presence === 'present' && scene.sequence === 'in-order')).toBe(true)
    expect(result.review.chapterHook.status).toBe('lands')
    expect(result.review.evidence).toMatchObject({ chapterNumber: 1, revision: 4, contentHash: 'a'.repeat(64) })
    expect(result.review.chapterHook.evidence[0]).toMatchObject({ startLine: 4, quote: '环城13路末班车没有停，它正在往天上开。' })
    expect(result.review.checks.filter(check => check.mode === 'reference').every(check => check.status === 'context-only')).toBe(true)
    expect(result.findings).toEqual([])
  })

  it('只省略气味等未标必达的环境细节时不生成必达失败', () => {
    const result = normalizeChapterBlueprintReview(completeAssessment(), detail, prose)
    expect(referenceItems.length).toBeGreaterThan(0)
    expect(result.review.checks.filter(check => check.mode === 'reference').map(check => check.status))
      .toEqual(referenceItems.map(() => 'context-only'))
    expect(result.findings.some(finding => /必达|must/u.test(finding.category))).toBe(false)
    expect(result.findings).toEqual([])
  })

  it('只有明示必达项可形成 warning；禁写命中必须有正文逐字证据', () => {
    const required: BlueprintV2BulletItem = {
      kind: 'bullet',
      id: 'bpc-explicit-must',
      label: null,
      markdown: '- 【必达】正文必须出现公交车辆编号。',
      check: { mode: 'must', source: 'explicit' },
    }
    const taboos = detail.sections.find(section => section.kind === 'canonical' && section.id === 'taboos')
    if (!taboos || taboos.kind !== 'canonical') throw new Error('fixture is missing taboos')
    const withRequired: ChapterBlueprintV2Detail = {
      ...detail,
      sections: detail.sections.map(section => section === taboos
        ? { ...section, items: [...section.items, required] }
        : section),
    }
    const matchedForbidden = forbidItems[0]
    if (!matchedForbidden) throw new Error('fixture is missing a forbid check')
    const violatedProse = `${prose}\n传来系统提示音。`
    const raw = {
      ...completeAssessment(),
      checks: [
        ...forbidItems.map(item => ({
          checkId: item.id,
          status: item.id === matchedForbidden.id ? 'violated' : 'met',
          description: '正文命中禁写项。',
          ...(item.id === matchedForbidden.id ? { evidenceQuotes: ['系统提示音'] } : {}),
        })),
        { checkId: required.id, status: 'missing', description: '没有找到车辆编号。' },
      ],
    }
    const result = normalizeChapterBlueprintReview(raw, withRequired, violatedProse)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', checkId: matchedForbidden.id, checkMode: 'forbid', quote: '系统提示音' }),
      expect.objectContaining({ severity: 'warning', checkId: required.id, checkMode: 'must' }),
    ]))

    const unsupported = normalizeChapterBlueprintReview({
      ...raw,
      checks: [{ checkId: matchedForbidden.id, status: 'violated', description: '无效引文。', evidenceQuotes: ['正文没有的引文'] }],
    }, detail, prose)
    expect(unsupported.findings.some(finding => finding.checkId === matchedForbidden.id && finding.severity === 'warning')).toBe(false)
    expect(unsupported.review.checks.find(check => check.checkId === matchedForbidden.id)?.status).toBe('uncertain')
  })

  it('场景顺序疑点与蓝图内部矛盾保持待人工判断，不升级为正文错误', () => {
    const secondScene = scenes[1]!
    const result = normalizeChapterBlueprintReview({
      ...completeAssessment({
        scenes: completeAssessment().scenes.map((scene: Record<string, unknown>) => scene.sceneId === secondScene.sceneId
          ? { ...scene, sequence: 'out-of-order', description: '场景顺序可能倒置。', evidenceQuotes: ['他在抽屉里发现姓名被划烂的奖状'] }
          : scene),
        blueprintIssues: [{ description: '蓝图中的事件时间前后不一。' }],
      }),
    }, detail, prose)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'unknown', sceneId: secondScene.sceneId }),
      expect.objectContaining({ severity: 'unknown', category: '蓝图自身问题' }),
    ]))
    expect(result.findings).not.toContain(expect.objectContaining({ severity: 'error' }))
  })
})
