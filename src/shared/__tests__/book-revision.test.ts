import { describe, expect, it } from 'vitest'
import { analyzeBook } from '../book-revision'

describe('whole-book revision analysis', () => {
  it('locates duplicate prose, low-progress chapters and open foreshadowing', () => {
    const report = analyzeBook([
      { chapterNumber: 1, title: '第1章 初见', content: '伏笔：门后的钟声。\n\n这是一个足够长的段落，用来作为后续章节重复检测的稳定证据，并且这里还有额外内容。' },
      { chapterNumber: 2, title: '错误标题', content: '这是一个足够长的段落，用来作为后续章节重复检测的稳定证据，并且这里还有额外内容。' },
    ], 20)
    expect(report.chapterCount).toBe(2); expect(report.totalWords).toBeGreaterThan(0)
    expect(report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining(['duplicate-paragraph', 'title-mismatch']))
    expect(report.foreshadowing[0]).toMatchObject({ chapterNumber: 1, status: 'open' })
  })

  it('flags author-configured term drift plus platform and professional-detail risks with chapter evidence', () => {
    const report = analyzeBook([{ chapterNumber: 3, title: '第3章 复查', content: '阿明说：加群后领取资料。医生建议服用 20mg 的药物。' }], {
      lowProgressWordThreshold: 1,
      controlledTerms: [{ canonical: '林明', discouragedVariants: ['阿明'] }],
      platformRiskTerms: ['领取资料'],
    })
    expect(report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'term-drift', 'platform-risk', 'professional-detail-risk',
    ]))
    expect(report.findings.every(finding => finding.chapters.includes(3))).toBe(true)
  })
})
