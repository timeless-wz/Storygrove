import {
  blueprintV2FieldText,
  type BlueprintV2CheckMode,
  type BlueprintV2Section,
  type ChapterBlueprintV2Detail,
} from './blueprint-v2'
import { writingLanguageText, type WritingLanguage } from './writing-language'

export interface BlueprintReviewEvidence {
  chapterNumber: number
  revision: number
  contentHash: string
}

export interface BlueprintReviewTextEvidence {
  quote: string
  start: number
  end: number
  startLine: number
  endLine: number
}

export interface BlueprintReviewSearchRange {
  startLine: number
  endLine: number
}

export interface BlueprintSceneReview {
  sceneId: string
  order: number
  title: string
  presence: 'present' | 'missing' | 'uncertain'
  sequence: 'in-order' | 'out-of-order' | 'uncertain'
  causality: 'supported' | 'gap' | 'uncertain'
  description: string
  evidence: readonly BlueprintReviewTextEvidence[]
  searchRange: BlueprintReviewSearchRange
}

export interface BlueprintCheckReview {
  checkId: string
  mode: BlueprintV2CheckMode
  source: 'explicit' | 'inferred'
  requirement: string
  status: 'met' | 'missing' | 'violated' | 'uncertain' | 'context-only'
  strongConclusionAllowed: boolean
  description: string
  evidence: readonly BlueprintReviewTextEvidence[]
  searchRange: BlueprintReviewSearchRange
}

export interface BlueprintHookReview {
  status: 'lands' | 'weak' | 'uncertain' | 'not-configured'
  requirement: string
  description: string
  evidence: readonly BlueprintReviewTextEvidence[]
  searchRange: BlueprintReviewSearchRange
}

export interface ChapterBlueprintReview {
  evidence: BlueprintReviewEvidence
  scenes: readonly BlueprintSceneReview[]
  checks: readonly BlueprintCheckReview[]
  chapterHook: BlueprintHookReview
  blueprintIssues: readonly string[]
}

export interface BlueprintReviewFinding {
  category: string
  severity: 'warning' | 'unknown'
  description: string
  quote?: string
  sceneId?: string
  checkId?: string
  checkMode?: BlueprintV2CheckMode
}

interface BlueprintCheckSource {
  id: string
  sectionId: string
  mode: BlueprintV2CheckMode
  source: 'explicit' | 'inferred'
  markdown: string
}

function canonicalSection(
  detail: ChapterBlueprintV2Detail,
  id: string,
): Extract<BlueprintV2Section, { kind: 'canonical' }> | null {
  const section = detail.sections.find(candidate => candidate.kind === 'canonical' && candidate.id === id)
  return section?.kind === 'canonical' ? section : null
}

function checkSources(detail: ChapterBlueprintV2Detail): BlueprintCheckSource[] {
  const results: BlueprintCheckSource[] = []
  for (const section of detail.sections) {
    if (section.kind !== 'canonical' || (section.id !== 'foreshadow' && section.id !== 'taboos')) continue
    for (const item of section.items) {
      if ((item.kind !== 'field' && item.kind !== 'bullet') || !item.check) continue
      results.push({
        id: item.id,
        sectionId: section.id,
        mode: item.check.mode,
        source: item.check.source,
        markdown: item.markdown,
      })
    }
  }
  return results
}

function sectionMarkdown(section: Extract<BlueprintV2Section, { kind: 'canonical' }> | null): string {
  if (!section) return ''
  return [
    section.preamble,
    ...section.items.map(item => item.markdown),
    section.postamble,
  ].filter(Boolean).join('')
}

function hookRequirement(detail: ChapterBlueprintV2Detail): string {
  const section = canonicalSection(detail, 'cliffhanger')
  const hook = section?.items.find(item => item.kind === 'field' && item.label === '章末钩子')
  return hook?.kind === 'field' ? blueprintV2FieldText(hook) : ''
}

function itemValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null
}

function boundedDescription(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return Array.from(value.trim()).slice(0, 500).join('')
}

function locateEvidence(draft: string, value: unknown): BlueprintReviewTextEvidence[] {
  const quotes = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const seen = new Set<string>()
  const result: BlueprintReviewTextEvidence[] = []
  for (const rawQuote of quotes.slice(0, 3)) {
    if (typeof rawQuote !== 'string') continue
    const quote = rawQuote.trim()
    if (!quote || seen.has(quote)) continue
    const start = draft.indexOf(quote)
    if (start < 0) continue
    const end = start + quote.length
    result.push({
      quote,
      start,
      end,
      startLine: draft.slice(0, start).split('\n').length,
      endLine: draft.slice(0, end).split('\n').length,
    })
    seen.add(quote)
  }
  return result
}

function allLinesRange(draft: string): BlueprintReviewSearchRange {
  return { startLine: 1, endLine: Math.max(1, draft.split('\n').length) }
}

function searchRange(value: unknown, draft: string): BlueprintReviewSearchRange {
  const record = itemValue(value)
  const startLine = record?.startLine
  const endLine = record?.endLine
  const lineCount = Math.max(1, draft.split('\n').length)
  if (
    typeof startLine === 'number'
    && Number.isSafeInteger(startLine)
    && typeof endLine === 'number'
    && Number.isSafeInteger(endLine)
    && startLine >= 1
    && startLine <= endLine
    && endLine <= lineCount
  ) return { startLine, endLine }
  return allLinesRange(draft)
}

function rawEvidence(record: Record<string, unknown> | null): unknown {
  return record?.evidenceQuotes ?? record?.evidenceQuote
}

function mustHasExplicitWording(source: BlueprintCheckSource): boolean {
  return source.source === 'explicit' || /必达|必须|务必|一定要/u.test(source.markdown)
}

function formatRange(range: BlueprintReviewSearchRange): string {
  return range.startLine === range.endLine
    ? `正文第 ${range.startLine} 行`
    : `正文第 ${range.startLine}–${range.endLine} 行`
}

export function parseBlueprintReviewEvidence(value: unknown): BlueprintReviewEvidence | null {
  const record = itemValue(value)
  if (
    !record
    || typeof record.chapterNumber !== 'number'
    || !Number.isSafeInteger(record.chapterNumber)
    || record.chapterNumber < 1
    || typeof record.revision !== 'number'
    || !Number.isSafeInteger(record.revision)
    || record.revision < 1
    || typeof record.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/u.test(record.contentHash)
  ) return null
  return {
    chapterNumber: record.chapterNumber,
    revision: record.revision,
    contentHash: record.contentHash,
  }
}

function parseStoredTextEvidence(value: unknown): BlueprintReviewTextEvidence | null {
  const record = itemValue(value)
  if (
    !record
    || typeof record.quote !== 'string'
    || typeof record.start !== 'number'
    || typeof record.end !== 'number'
    || typeof record.startLine !== 'number'
    || typeof record.endLine !== 'number'
    || !Number.isSafeInteger(record.start)
    || !Number.isSafeInteger(record.end)
    || !Number.isSafeInteger(record.startLine)
    || !Number.isSafeInteger(record.endLine)
    || record.start < 0
    || record.start >= record.end
    || record.startLine < 1
    || record.startLine > record.endLine
  ) return null
  return {
    quote: record.quote,
    start: record.start,
    end: record.end,
    startLine: record.startLine,
    endLine: record.endLine,
  }
}

function parseStoredRange(value: unknown): BlueprintReviewSearchRange | null {
  const record = itemValue(value)
  if (
    !record
    || typeof record.startLine !== 'number'
    || typeof record.endLine !== 'number'
    || !Number.isSafeInteger(record.startLine)
    || !Number.isSafeInteger(record.endLine)
    || record.startLine < 1
    || record.startLine > record.endLine
  ) return null
  return { startLine: record.startLine, endLine: record.endLine }
}

function parseStoredEvidenceList(value: unknown): BlueprintReviewTextEvidence[] | null {
  if (!Array.isArray(value)) return null
  const evidence = value.map(parseStoredTextEvidence)
  return evidence.some(item => item === null) ? null : evidence as BlueprintReviewTextEvidence[]
}

/** Safely reads the normalized, persisted report block for ReviewReport. */
export function parseChapterBlueprintReview(value: unknown): ChapterBlueprintReview | null {
  const record = itemValue(value)
  const evidence = parseBlueprintReviewEvidence(record?.evidence)
  if (!record || !evidence || !Array.isArray(record.scenes) || !Array.isArray(record.checks)) return null
  const scenes: BlueprintSceneReview[] = []
  for (const raw of record.scenes) {
    const scene = itemValue(raw)
    const sceneEvidence = parseStoredEvidenceList(scene?.evidence)
    const range = parseStoredRange(scene?.searchRange)
    const presence = enumValue(scene?.presence, ['present', 'missing', 'uncertain'] as const)
    const sequence = enumValue(scene?.sequence, ['in-order', 'out-of-order', 'uncertain'] as const)
    const causality = enumValue(scene?.causality, ['supported', 'gap', 'uncertain'] as const)
    if (
      !scene
      || typeof scene.sceneId !== 'string'
      || typeof scene.order !== 'number'
      || !Number.isSafeInteger(scene.order)
      || scene.order < 1
      || typeof scene.title !== 'string'
      || !presence
      || !sequence
      || !causality
      || typeof scene.description !== 'string'
      || !sceneEvidence
      || !range
    ) return null
    scenes.push({
      sceneId: scene.sceneId,
      order: scene.order,
      title: scene.title,
      presence,
      sequence,
      causality,
      description: scene.description,
      evidence: sceneEvidence,
      searchRange: range,
    })
  }
  const checks: BlueprintCheckReview[] = []
  for (const raw of record.checks) {
    const check = itemValue(raw)
    const checkEvidence = parseStoredEvidenceList(check?.evidence)
    const range = parseStoredRange(check?.searchRange)
    const mode = enumValue(check?.mode, ['must', 'reference', 'forbid'] as const)
    const status = enumValue(check?.status, ['met', 'missing', 'violated', 'uncertain', 'context-only'] as const)
    if (
      !check
      || typeof check.checkId !== 'string'
      || !mode
      || (check.source !== 'explicit' && check.source !== 'inferred')
      || typeof check.requirement !== 'string'
      || !status
      || typeof check.strongConclusionAllowed !== 'boolean'
      || typeof check.description !== 'string'
      || !checkEvidence
      || !range
    ) return null
    checks.push({
      checkId: check.checkId,
      mode,
      source: check.source,
      requirement: check.requirement,
      status,
      strongConclusionAllowed: check.strongConclusionAllowed,
      description: check.description,
      evidence: checkEvidence,
      searchRange: range,
    })
  }
  const hook = itemValue(record.chapterHook)
  const hookEvidence = parseStoredEvidenceList(hook?.evidence)
  const hookRange = parseStoredRange(hook?.searchRange)
  const hookStatus = enumValue(hook?.status, ['lands', 'weak', 'uncertain', 'not-configured'] as const)
  if (
    !hook
    || !hookStatus
    || typeof hook.requirement !== 'string'
    || typeof hook.description !== 'string'
    || !hookEvidence
    || !hookRange
  ) return null
  const blueprintIssues = Array.isArray(record.blueprintIssues)
    && record.blueprintIssues.every(issue => typeof issue === 'string')
    ? record.blueprintIssues as string[]
    : null
  if (!blueprintIssues) return null
  return {
    evidence,
    scenes,
    checks,
    chapterHook: {
      status: hookStatus,
      requirement: hook.requirement,
      description: hook.description,
      evidence: hookEvidence,
      searchRange: hookRange,
    },
    blueprintIssues,
  }
}

/**
 * Build an additive review instruction for the v2 detail. It deliberately lives
 * outside prompt-templates.ts so the shared consistency template stays owned by
 * the prompt-template integration task.
 */
export function buildChapterBlueprintReviewPrompt(
  detail: ChapterBlueprintV2Detail,
  writingLanguage: WritingLanguage,
): string {
  const scenes = detail.sections
    .filter((section): section is Extract<BlueprintV2Section, { kind: 'canonical' }> => (
      section.kind === 'canonical' && section.id === 'storyboard'
    ))
    .flatMap(section => section.items.filter(item => item.kind === 'scene'))
    .map((scene, index) => ({ sceneId: scene.id, order: index + 1, title: scene.title, markdown: scene.markdown }))
  const checks = checkSources(detail).map(check => ({
    checkId: check.id,
    sectionId: check.sectionId,
    mode: check.mode,
    source: check.source,
    requirement: check.markdown,
  }))
  const conflict = sectionMarkdown(canonicalSection(detail, 'conflict'))
  const rules = sectionMarkdown(canonicalSection(detail, 'rules'))
  const hook = hookRequirement(detail)
  const blueprintSections = detail.sections.map(section => section.kind === 'canonical'
    ? {
      kind: section.kind,
      id: section.id,
      title: section.title,
      markdown: sectionMarkdown(section),
    }
    : { kind: section.kind, id: section.id, title: section.title, markdown: section.body })
  return [
    writingLanguageText(
      writingLanguage,
      '【章节蓝图 v2 一致性审查｜本章绑定蓝图的冻结快照】',
      '[Chapter Blueprint v2 consistency review | frozen bound-blueprint snapshot]',
    ),
    JSON.stringify({
      chapterNumber: detail.chapterNumber,
      revision: detail.revision,
      contentHash: detail.contentHash,
      blueprintSections,
      coreConflict: conflict,
      scenes,
      rulesAsContextOnly: rules,
      checks,
      chapterEndHook: hook,
    }, null, 2),
    writingLanguageText(
      writingLanguage,
      [
        '只审查上面的冻结蓝图与本次提供的冻结正文。',
        '把正文检查分成必达情节/场景、参考性细节、禁写内容三类。must/reference/forbid 以蓝图条目的 check.mode 为准；reference 永不产生发现。',
        '只有来源为 explicit 的 must，或条目原文明确含“必达/必须/务必/一定要”的 must，才能把缺失判为未达成；只有禁写条目被正文证据实际命中，才能判违规。其他细节一律建议或待人工判断。',
        '规则分区只是约束事件和现象的上下文，不要求正文复述规则。不要因为正文没有气味、光线、声响、环境纹理或措辞与蓝图不同，就判为必达失败。',
        '不要把分镜全文按分号或短句切开并逐句判缺失。逐个稳定 sceneId 评估场景是否出现、场景顺序、核心因果衔接；分别评估章末钩子。场景/因果/钩子判断属于审查建议，不能升级成强制错误。',
        '禁忌要检查正文是否提前讲解规则或违反作者禁写要求；样例包括提前解释原身死因、信标来源、石书真身，以及直接讲解世界观、系统或神明名号。规则存在本身不代表正文应该解释它。',
        '若蓝图内部时间线、计划或因果条目彼此矛盾，应标成 blueprintIssue（蓝图自身问题），不要报作正文违背蓝图。只有正文确有相反证据才报告执行问题。',
        '每个 present/out-of-order/gap/weak/violated 判断都给正文逐字引文 evidenceQuotes（1–3 条）；缺失场景/必达项可给 searchRange 行号。引文必须能从正文精确找到。证据不足就用 uncertain。',
        '仅返回与其他审稿字段同一 JSON 对象中的 blueprintReview 字段，形状为：',
        '{"scenes":[{"sceneId":"蓝图原 ID","presence":"present|missing|uncertain","sequence":"in-order|out-of-order|uncertain","causality":"supported|gap|uncertain","description":"简述","evidenceQuotes":["正文逐字引文"],"searchRange":{"startLine":1,"endLine":1}}],"checks":[{"checkId":"蓝图原 ID","status":"met|missing|violated|uncertain","description":"简述","evidenceQuotes":["正文逐字引文"],"searchRange":{"startLine":1,"endLine":1}}],"chapterHook":{"status":"lands|weak|uncertain","description":"简述","evidenceQuotes":["正文逐字引文"],"searchRange":{"startLine":1,"endLine":1}},"blueprintIssues":[{"description":"蓝图自身矛盾，不是正文问题"}]}.',
        '完整返回所有 sceneId 和 must/forbid checkId。不要为 reference 项生成发现。scene/check/hook 顺序必须跟随提供的稳定 ID 与 order。',
      ].join('\n'),
      [
        'Review only the frozen bound blueprint and the frozen prose snapshot supplied in this request.',
        'Classify prose checks as required plot/scenes, reference details, and forbidden content. Use each blueprint item check.mode as authoritative: reference never produces a finding.',
        'Only an explicit must, or a must whose source text literally contains “must/required”, may be called unmet. A forbidden item is violated only when the prose contains supporting evidence. Treat all other details as advice or human review.',
        'The rules section is context constraining events and phenomena; it does not require exposition. Do not fail a chapter for omitting scent, light, sound, atmosphere, or wording that differs from the outline.',
        'Do not split scene prose on semicolons or judge each sentence independently. Assess each stable sceneId for presence, scene order, and core causal continuity, then assess the chapter-end hook. These are advisory judgments, never hard errors.',
        'Check taboos against early exposition of the protagonist’s original death, beacon source, or the stone book’s identity, and against direct explanation of the world, a system, or divine names. The presence of a rule in the blueprint does not mean prose should explain it.',
        'If the blueprint contradicts itself in timeline, plan, or causality, report a blueprintIssue; do not call it a prose violation. Report an execution issue only when the prose itself conflicts with a clear requirement.',
        'For each present/out-of-order/gap/weak/violated judgment, cite 1–3 exact prose excerpts in evidenceQuotes. Missing scenes or explicit must items may include line searchRange. Quotes must occur verbatim in the prose. Use uncertain when evidence is insufficient.',
        'Return blueprintReview in the same JSON object as the other review fields with this shape:',
        '{"scenes":[{"sceneId":"original stable ID","presence":"present|missing|uncertain","sequence":"in-order|out-of-order|uncertain","causality":"supported|gap|uncertain","description":"brief assessment","evidenceQuotes":["exact prose quote"],"searchRange":{"startLine":1,"endLine":1}}],"checks":[{"checkId":"original stable ID","status":"met|missing|violated|uncertain","description":"brief assessment","evidenceQuotes":["exact prose quote"],"searchRange":{"startLine":1,"endLine":1}}],"chapterHook":{"status":"lands|weak|uncertain","description":"brief assessment","evidenceQuotes":["exact prose quote"],"searchRange":{"startLine":1,"endLine":1}},"blueprintIssues":[{"description":"outline contradiction, not a prose issue"}]}.',
        'Return every sceneId and each must/forbid checkId. Do not generate findings for reference items. Keep scene/check/hook order aligned with the supplied stable IDs and order.',
      ].join('\n'),
    ),
  ].join('\n\n')
}

/**
 * Validates model assessments against this exact detail and draft. Invalid IDs
 * and non-verbatim evidence are downgraded to uncertain instead of becoming
 * authoritative findings.
 */
export function normalizeChapterBlueprintReview(
  raw: unknown,
  detail: ChapterBlueprintV2Detail,
  draft: string,
): { review: ChapterBlueprintReview; findings: BlueprintReviewFinding[] } {
  const root = itemValue(raw)
  const rawScenes = Array.isArray(root?.scenes) ? root.scenes : []
  const rawChecks = Array.isArray(root?.checks) ? root.checks : []
  const sceneItems = detail.sections
    .filter((section): section is Extract<BlueprintV2Section, { kind: 'canonical' }> => (
      section.kind === 'canonical' && section.id === 'storyboard'
    ))
    .flatMap(section => section.items.filter(item => item.kind === 'scene'))
  const scenes: BlueprintSceneReview[] = sceneItems.map((scene, index) => {
    const model = rawScenes.map(itemValue).find(candidate => candidate?.sceneId === scene.id) ?? null
    const evidence = locateEvidence(draft, rawEvidence(model))
    const presenceRaw = enumValue(model?.presence, ['present', 'missing', 'uncertain'] as const)
    const sequenceRaw = enumValue(model?.sequence, ['in-order', 'out-of-order', 'uncertain'] as const)
    const causalityRaw = enumValue(model?.causality, ['supported', 'gap', 'uncertain'] as const)
    const presence = presenceRaw === 'present' && evidence.length === 0
      ? 'uncertain'
      : presenceRaw ?? 'uncertain'
    const sequence = sequenceRaw === 'out-of-order' && evidence.length === 0
      ? 'uncertain'
      : sequenceRaw ?? 'uncertain'
    const causality = causalityRaw === 'gap' && evidence.length === 0
      ? 'uncertain'
      : causalityRaw ?? 'uncertain'
    return {
      sceneId: scene.id,
      order: index + 1,
      title: scene.title,
      presence,
      sequence,
      causality,
      description: boundedDescription(model?.description, '未提供有效的正文证据，待人工判断。'),
      evidence,
      searchRange: searchRange(model?.searchRange, draft),
    }
  })

  const sourceChecks = checkSources(detail)
  const checks: BlueprintCheckReview[] = sourceChecks.map(source => {
    const model = rawChecks.map(itemValue).find(candidate => candidate?.checkId === source.id) ?? null
    const evidence = locateEvidence(draft, rawEvidence(model))
    const allowed = source.mode === 'must'
      ? mustHasExplicitWording(source)
      : source.mode === 'forbid'
    const requested = enumValue(model?.status, ['met', 'missing', 'violated', 'uncertain'] as const)
    let status: BlueprintCheckReview['status'] = source.mode === 'reference'
      ? 'context-only'
      : requested ?? 'uncertain'
    if (source.mode === 'must' && status === 'missing' && !allowed) status = 'uncertain'
    const requiresQuote = (source.mode === 'must' && status === 'met')
      || (source.mode === 'forbid' && status === 'violated')
    if (requiresQuote && evidence.length === 0) status = 'uncertain'
    return {
      checkId: source.id,
      mode: source.mode,
      source: source.source,
      requirement: source.markdown,
      status,
      strongConclusionAllowed: allowed,
      description: boundedDescription(model?.description, '未提供有效的正文证据，待人工判断。'),
      evidence,
      searchRange: searchRange(model?.searchRange, draft),
    }
  })

  const hookText = hookRequirement(detail)
  const hookModel = itemValue(root?.chapterHook)
  const hookEvidence = locateEvidence(draft, rawEvidence(hookModel))
  const hookRequested = enumValue(hookModel?.status, ['lands', 'weak', 'uncertain'] as const)
  const chapterHook: BlueprintHookReview = {
    status: !hookText
      ? 'not-configured'
      : hookRequested === 'weak' && hookEvidence.length === 0
        ? 'uncertain'
        : hookRequested ?? 'uncertain',
    requirement: hookText,
    description: boundedDescription(hookModel?.description, hookText ? '未提供有效的正文证据，待人工判断。' : '蓝图未设置章末钩子。'),
    evidence: hookEvidence,
    searchRange: searchRange(hookModel?.searchRange, draft),
  }
  const blueprintIssues = (Array.isArray(root?.blueprintIssues) ? root.blueprintIssues : [])
    .map(itemValue)
    .map(issue => issue?.description)
    .filter((description): description is string => typeof description === 'string' && Boolean(description.trim()))
    .slice(0, 20)
    .map(description => Array.from(description.trim()).slice(0, 500).join(''))

  const review: ChapterBlueprintReview = {
    evidence: {
      chapterNumber: detail.chapterNumber,
      revision: detail.revision,
      contentHash: detail.contentHash,
    },
    scenes,
    checks,
    chapterHook,
    blueprintIssues,
  }
  const findings: BlueprintReviewFinding[] = []
  for (const description of blueprintIssues) {
    findings.push({
      category: '蓝图自身问题',
      severity: 'unknown',
      description: `待人工判断：蓝图内部可能存在矛盾；这不是正文违背蓝图的结论。${description}`,
    })
  }
  for (const scene of scenes) {
    const deviates = scene.presence === 'missing'
      || scene.sequence === 'out-of-order'
      || scene.causality === 'gap'
    if (deviates) {
      const locator = scene.evidence[0]?.quote ?? formatRange(scene.searchRange)
      findings.push({
        category: `蓝图场景 ${scene.sceneId}`,
        severity: 'unknown',
        description: `待人工判断：${scene.title}；出现=${scene.presence}，顺序=${scene.sequence}，因果=${scene.causality}。${scene.description}（${locator}）`,
        ...(scene.evidence[0] ? { quote: scene.evidence[0].quote } : {}),
        sceneId: scene.sceneId,
      })
    }
  }
  for (const check of checks) {
    if (check.mode === 'reference' || check.status === 'met' || check.status === 'context-only') continue
    const isHardEvidence = check.strongConclusionAllowed
      && ((check.mode === 'must' && check.status === 'missing')
        || (check.mode === 'forbid' && check.status === 'violated' && check.evidence.length > 0))
    if (!isHardEvidence && check.status !== 'uncertain' && check.status !== 'missing' && check.status !== 'violated') continue
    const label = check.mode === 'forbid' ? '禁写命中' : '必达检查'
    const locator = check.evidence[0]?.quote ?? formatRange(check.searchRange)
    findings.push({
      category: `${label} ${check.checkId}`,
      severity: isHardEvidence ? 'warning' : 'unknown',
      description: `${isHardEvidence ? '' : '待人工判断：'}${check.description}（${locator}）`,
      ...(check.evidence[0] ? { quote: check.evidence[0].quote } : {}),
      checkId: check.checkId,
      checkMode: check.mode,
    })
  }
  if (chapterHook.status === 'weak') {
    const locator = chapterHook.evidence[0]?.quote ?? formatRange(chapterHook.searchRange)
    findings.push({
      category: '章末钩子',
      severity: 'unknown',
      description: `待人工判断：章末钩子可能未充分成立。${chapterHook.description}（${locator}）`,
      ...(chapterHook.evidence[0] ? { quote: chapterHook.evidence[0].quote } : {}),
    })
  }
  return { review, findings }
}
