export interface RevisionChapter { chapterNumber: number; title: string; content: string }
export interface ControlledTerm { canonical: string; discouragedVariants: readonly string[] }
export interface RevisionAnalysisOptions {
  lowProgressWordThreshold?: number
  controlledTerms?: readonly ControlledTerm[]
  /** Extra platform-sensitive phrases supplied by the author or publisher. */
  platformRiskTerms?: readonly string[]
}
export interface RevisionFinding {
  code: 'duplicate-paragraph' | 'repeated-explanation' | 'low-progress' | 'title-mismatch' | 'term-drift' | 'style-drift' | 'platform-risk' | 'professional-detail-risk'
  severity: 'warning' | 'info'
  chapters: number[]
  evidence: string
  suggestion: string
}
export interface BookRevisionReport {
  totalWords: number
  chapterCount: number
  findings: RevisionFinding[]
  foreshadowing: Array<{ chapterNumber: number; text: string; status: 'open' | 'resolved' }>
}

function words(content: string): number {
  const chinese = content.match(/[\u3400-\u9fff]/gu)?.length ?? 0
  const latin = content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu)?.length ?? 0
  return chinese + latin
}

function normalized(value: string): string { return value.replace(/[\s\p{P}\p{S}]+/gu, '').toLocaleLowerCase() }

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(Array.from(normalized(left)))
  const rightTokens = new Set(Array.from(normalized(right)))
  const union = new Set([...leftTokens, ...rightTokens])
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return union.size === 0 ? 0 : intersection / union.size
}

function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') }

/** Deterministic whole-book checks. Findings are evidence-led and never modify prose. */
export function analyzeBook(
  chapters: readonly RevisionChapter[],
  optionsOrThreshold: RevisionAnalysisOptions | number = 120,
): BookRevisionReport {
  const options: RevisionAnalysisOptions = typeof optionsOrThreshold === 'number'
    ? { lowProgressWordThreshold: optionsOrThreshold }
    : optionsOrThreshold
  const lowProgressWordThreshold = options.lowProgressWordThreshold ?? 120
  const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)
  const findings: RevisionFinding[] = []
  const paragraphOwners = new Map<string, { chapterNumber: number; text: string }>()
  const sentenceLengths: Array<{ chapterNumber: number; length: number }> = []
  for (const chapter of ordered) {
    const titleExpected = new RegExp(`(?:第\\s*)?${chapter.chapterNumber}(?:\\s*章|\\b)`, 'u').test(chapter.title)
    if (!titleExpected) findings.push({ code: 'title-mismatch', severity: 'warning', chapters: [chapter.chapterNumber], evidence: `第${chapter.chapterNumber}章标题：${chapter.title || '(空)'}`, suggestion: '统一章节编号与标题。' })
    const chapterWords = words(chapter.content)
    if (chapterWords < lowProgressWordThreshold) findings.push({ code: 'low-progress', severity: 'warning', chapters: [chapter.chapterNumber], evidence: `第${chapter.chapterNumber}章约 ${chapterWords} 字词`, suggestion: '复核是否缺少新事件、选择或后果；不要仅为增加字数而扩写。' })
    const sentences = chapter.content.split(/[。！？!?]+/u).map(value => normalized(value)).filter(Boolean)
    if (sentences.length > 0) sentenceLengths.push({ chapterNumber: chapter.chapterNumber, length: sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length })
    for (const paragraph of chapter.content.split(/\r?\n\s*\r?\n/u).map(value => value.trim()).filter(value => value.length >= 30)) {
      const key = normalized(paragraph)
      const previous = paragraphOwners.get(key)
      if (previous && previous.chapterNumber !== chapter.chapterNumber) findings.push({ code: 'duplicate-paragraph', severity: 'warning', chapters: [previous.chapterNumber, chapter.chapterNumber], evidence: `第${previous.chapterNumber}章与第${chapter.chapterNumber}章存在相同段落：${paragraph.slice(0, 120)}`, suggestion: '确认是否为有意回放；否则删除重复解释或改为推进信息。' })
      else if (!previous) {
        const near = [...paragraphOwners.values()].find(owner => owner.chapterNumber !== chapter.chapterNumber && tokenOverlap(owner.text, paragraph) >= 0.9)
        if (near) findings.push({ code: 'repeated-explanation', severity: 'warning', chapters: [near.chapterNumber, chapter.chapterNumber], evidence: `第${near.chapterNumber}章与第${chapter.chapterNumber}章存在高度相似解释：${paragraph.slice(0, 120)}`, suggestion: '保留首次解释，并把后续段落改为新的行动、信息或后果。' })
        paragraphOwners.set(key, { chapterNumber: chapter.chapterNumber, text: paragraph })
      }
    }
    for (const term of options.controlledTerms ?? []) for (const variant of term.discouragedVariants) {
      if (variant && new RegExp(escaped(variant), 'u').test(chapter.content)) findings.push({ code: 'term-drift', severity: 'warning', chapters: [chapter.chapterNumber], evidence: `第${chapter.chapterNumber}章使用“${variant}”，规范称呼为“${term.canonical}”。`, suggestion: '确认这是别名、口语还是命名漂移；必要时统一为作者确认的称呼。' })
    }
    const riskTerms = [...(options.platformRiskTerms ?? []), '加群', '关注公众号', '私信领取', '扫码领取']
    for (const term of riskTerms) if (term && chapter.content.includes(term)) findings.push({ code: 'platform-risk', severity: 'warning', chapters: [chapter.chapterNumber], evidence: `第${chapter.chapterNumber}章包含平台风险短语“${term}”。`, suggestion: '按目标平台规则复核；如为正文设定，请保留语境和必要性说明。' })
    const professional = /(?:服用|注射|手术|剂量|判处|刑期|电压|承重|爆炸当量).{0,36}\d+(?:\.\d+)?\s*(?:mg|毫克|毫升|伏特|千伏|年|个月|公里\/小时|km\/h)/u
    const detail = chapter.content.match(professional)?.[0]
    if (detail) findings.push({ code: 'professional-detail-risk', severity: 'warning', chapters: [chapter.chapterNumber], evidence: `第${chapter.chapterNumber}章存在可验证的专业数值：“${detail}”。`, suggestion: '核对医学、工程、司法等专业来源；本检查不替代专业意见。' })
  }
  if (sentenceLengths.length >= 3) {
    const mean = sentenceLengths.reduce((sum, item) => sum + item.length, 0) / sentenceLengths.length
    const deviation = Math.sqrt(sentenceLengths.reduce((sum, item) => sum + (item.length - mean) ** 2, 0) / sentenceLengths.length)
    if (deviation > 0) for (const item of sentenceLengths) if (Math.abs(item.length - mean) > deviation * 2.5) findings.push({ code: 'style-drift', severity: 'info', chapters: [item.chapterNumber], evidence: `第${item.chapterNumber}章平均句长 ${item.length.toFixed(1)}，全书均值 ${mean.toFixed(1)}。`, suggestion: '这是风格漂移提示，不代表错误；结合叙事意图决定是否统一节奏。' })
  }
  const foreshadowing = ordered.flatMap(chapter => chapter.content.split(/\r?\n/u).filter(line => /伏笔|线索|悬念|谜题/u.test(line)).map(text => ({ chapterNumber: chapter.chapterNumber, text: text.trim().slice(0, 240), status: /回收|揭晓|解决/u.test(text) ? 'resolved' as const : 'open' as const })))
  return { totalWords: ordered.reduce((sum, chapter) => sum + words(chapter.content), 0), chapterCount: ordered.length, findings, foreshadowing }
}
