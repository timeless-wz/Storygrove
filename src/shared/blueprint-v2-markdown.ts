/**
 * 章节蓝图 v2 的 Markdown 导入/导出（docs/blueprint-v2-contract.md §4）。
 *
 * 红线：解析、序列化对未编辑内容逐字保留（仅允许 CRLF→LF 归一化）。实现上把
 * 文档切成连续的原始字符串切片（preamble / 条目 markdown / postamble），序列化
 * 时按原样拼接，因此 parse∘serialize 是字节恒等的拼接还原；`assertNoLossOnSerialize`
 * 在每次导出前强制复核。全部为纯函数：只 import blueprint-v2.ts，不触 IPC、不触 DB。
 */

import {
  MAX_BLUEPRINT_V2_RAW_MARKDOWN,
  createBlueprintV2ItemId,
  createBlueprintV2SceneId,
  customBlueprintV2SectionId,
  getBlueprintV2Scenes,
  normalizeBlueprintV2SectionTitle,
  BLUEPRINT_V2_CANONICAL_SECTIONS,
} from './blueprint-v2'
import type {
  BlueprintV2CanonicalSection,
  BlueprintV2CheckMode,
  BlueprintV2Section,
  BlueprintV2SectionItem,
  ChapterBlueprintV2Content,
} from './blueprint-v2'

// ===== 解析 =====

export interface ChapterBlueprintV2MarkdownParseResult {
  /** 文档 H1–H3 章题行原文（含「第N章」前缀）；无章题时为空串。 */
  chapterTitle: string
  /** 仅建议：来自章题的章号；无章题或无法识别时为 null（映射到哪章由调用方决定）。 */
  suggestedChapterNumber: number | null
  /** 结构化内容；chapterNumber = suggestedChapterNumber ?? 0，保存前由调用方按目标章改写。 */
  content: ChapterBlueprintV2Content
}

interface DocLine {
  /** 不含换行符的行内容。 */
  text: string
  /** 行首在文档中的偏移。 */
  start: number
  /** 下一行首偏移（含本行换行符）。 */
  next: number
}

interface HeadingInfo {
  lineIndex: number
  level: number
  /** 标题行 `#` 标记后的原文（未去空白，保留行尾空白）。 */
  text: string
}

const HEADING_LINE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/u
const LIST_MARKER_LINE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/u
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u
const FIELD_LABEL = /^\*\*(.+?)\*\*[：:]/u
const CHAPTER_TITLE = /^第\s*([0-9０-９]+|[零〇一二两三四五六七八九十百千]+)\s*章/u

function splitLines(md: string): DocLine[] {
  const lines: DocLine[] = []
  let start = 0
  while (start <= md.length) {
    const newlineIndex = md.indexOf('\n', start)
    if (newlineIndex === -1) {
      if (start < md.length) lines.push({ text: md.slice(start), start, next: md.length })
      break
    }
    lines.push({ text: md.slice(start, newlineIndex), start, next: newlineIndex + 1 })
    start = newlineIndex + 1
  }
  return lines
}

/** 每行是否处于围栏代码块内部（围栏开/闭行本身不算内部）。 */
function computeFenceLines(lines: DocLine[]): boolean[] {
  const inside = new Array<boolean>(lines.length).fill(false)
  let fenceChar: string | null = null
  let fenceLength = 0
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = FENCE_LINE.exec(lines[index].text)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fenceChar === null) {
        fenceChar = marker[0]
        fenceLength = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        fenceChar = null
        fenceLength = 0
      }
      continue
    }
    inside[index] = fenceChar !== null
  }
  return inside
}

function collectHeadings(lines: DocLine[], fenceLines: boolean[]): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (fenceLines[index]) continue
    const match = HEADING_LINE.exec(lines[index].text)
    if (match) headings.push({ lineIndex: index, level: match[1].length, text: match[2] ?? '' })
  }
  return headings
}

const CHINESE_DIGITS = new Map<string, number>([
  ['零', 0], ['〇', 0], ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4],
  ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9],
])
const CHINESE_UNITS = new Map<string, number>([['十', 10], ['百', 100], ['千', 1000]])

function parseChapterNumberToken(token: string): number | null {
  const ascii = token.replace(/[０-９]/gu, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  if (/^\d+$/u.test(ascii)) {
    const value = Number.parseInt(ascii, 10)
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  let total = 0
  let section = 0
  for (const char of token) {
    const digit = CHINESE_DIGITS.get(char)
    if (digit !== undefined) {
      section = digit
      continue
    }
    const unit = CHINESE_UNITS.get(char)
    if (unit !== undefined) {
      total += (section === 0 ? 1 : section) * unit
      section = 0
      continue
    }
    return null
  }
  const value = total + section
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/** 「第N章」→ N；支持阿拉伯数字（含全角）与零〇一二两三…十百千。 */
export function parseChapterNumberFromTitle(title: string): number | null {
  const match = CHAPTER_TITLE.exec(title.trim())
  if (!match) return null
  return parseChapterNumberToken(match[1])
}

interface RawAtom {
  kind: 'scene' | 'list' | 'text'
  /** 条目起始行（scene/list 为标题行/列表标记行；text 为首行内容行）。 */
  startLine: number
  /** 结束（不含）：下一原子起始行或分区结束行。 */
  endLine: number
  heading?: HeadingInfo
  marker?: { indent: number }
}

function nextHeadingLine(
  lines: DocLine[],
  fenceLines: boolean[],
  from: number,
  to: number,
): number {
  for (let index = from; index < to; index += 1) {
    if (fenceLines[index]) continue
    if (HEADING_LINE.test(lines[index].text)) return index
  }
  return to
}

/**
 * 扫描 canonical 分区正文 [bodyStart, sectionEnd) 的原子序列。
 * 切片连续且无缝：preamble + 条目 + block + postamble 拼接 === 分区正文原文。
 */
function scanSectionAtoms(
  lines: DocLine[],
  fenceLines: boolean[],
  bodyStart: number,
  sectionEnd: number,
  sectionLevel: number,
  isStoryboard: boolean,
): RawAtom[] {
  const atoms: RawAtom[] = []
  let index = bodyStart
  while (index < sectionEnd) {
    const line = lines[index]
    const heading = fenceLines[index] ? null : HEADING_LINE.exec(line.text)
    if (heading) {
      const level = heading[1].length
      const text = heading[2] ?? ''
      if (isStoryboard && level > sectionLevel && text.trim().startsWith('场景')) {
        const end = nextHeadingLine(lines, fenceLines, index + 1, sectionEnd)
        atoms.push({ kind: 'scene', startLine: index, endLine: end, heading: { lineIndex: index, level, text } })
        index = end
        continue
      }
      // 非分镜标题（含更深一级的杂项标题）一律按内容行处理。
    }
    const marker = fenceLines[index] ? null : LIST_MARKER_LINE.exec(line.text)
    if (marker) {
      const indent = marker[1].length
      let cursor = index + 1
      while (cursor < sectionEnd) {
        if (fenceLines[cursor]) {
          // 围栏内容与围栏行都是普通文本：缩进超过标记行缩进才算列表项续行。
          if (lines[cursor].text.length - lines[cursor].text.trimStart().length > indent) {
            cursor += 1
            continue
          }
          break
        }
        if (/^\s*$/u.test(lines[cursor].text)) {
          cursor += 1
          continue
        }
        if (HEADING_LINE.test(lines[cursor].text)) break
        const nestedMarker = LIST_MARKER_LINE.exec(lines[cursor].text)
        if (nestedMarker && nestedMarker[1].length <= indent) break
        if (lines[cursor].text.length - lines[cursor].text.trimStart().length > indent) {
          cursor += 1
          continue
        }
        break
      }
      atoms.push({ kind: 'list', startLine: index, endLine: cursor, marker: { indent } })
      index = cursor
      continue
    }
    if (/^\s*$/u.test(line.text)) {
      // 空行：并入相邻原子（由 text 原子的扫描吞掉；此处只兜底空行开头）。
      let cursor = index
      while (cursor < sectionEnd && /^\s*$/u.test(lines[cursor].text)) cursor += 1
      atoms.push({ kind: 'text', startLine: index, endLine: cursor })
      index = cursor
      continue
    }
    // 普通内容块：吞到下一个标题/列表标记/分区结束，尾部空行并入本块。
    let cursor = index + 1
    while (cursor < sectionEnd) {
      if (fenceLines[cursor]) {
        cursor += 1
        continue
      }
      if (/^\s*$/u.test(lines[cursor].text)) {
        cursor += 1
        continue
      }
      if (HEADING_LINE.test(lines[cursor].text)) break
      if (LIST_MARKER_LINE.test(lines[cursor].text)) break
      cursor += 1
    }
    atoms.push({ kind: 'text', startLine: index, endLine: cursor })
    index = cursor
  }
  return atoms
}

function sliceLines(lines: DocLine[], from: number, to: number, md: string): string {
  if (to <= from) return ''
  return md.slice(lines[from].start, lines[to - 1].next)
}

const EXPLICIT_CHECK_TOKENS: Array<[RegExp, BlueprintV2CheckMode]> = [
  [/【禁写】/u, 'forbid'],
  [/【必达】/u, 'must'],
  [/【参考】/u, 'reference'],
]

function inferCheckMode(markdown: string): BlueprintV2CheckMode {
  if (/严禁|禁止|不得|不允许|切勿/u.test(markdown)) return 'forbid'
  if (/必达|必须|务必|一定要/u.test(markdown)) return 'must'
  return 'reference'
}

function checkFor(sectionId: BlueprintV2CanonicalSection['id'], markdown: string):
  { mode: BlueprintV2CheckMode; source: 'explicit' | 'inferred' } | undefined {
  if (sectionId !== 'foreshadow' && sectionId !== 'taboos') return undefined
  const firstLine = markdown.split('\n', 1)[0] ?? ''
  for (const [pattern, mode] of EXPLICIT_CHECK_TOKENS) {
    if (pattern.test(firstLine)) return { mode, source: 'explicit' }
  }
  return { mode: inferCheckMode(markdown), source: 'inferred' }
}

function lineStartOffset(lines: DocLine[], md: string, lineIndex: number): number {
  return lineIndex < lines.length ? lines[lineIndex].start : md.length
}

function buildSectionItems(
  atoms: RawAtom[],
  lines: DocLine[],
  md: string,
  bodyStart: number,
  sectionEnd: number,
  sectionId: BlueprintV2CanonicalSection['id'],
): { preamble: string; items: BlueprintV2SectionItem[]; postamble: string } {
  const firstItemIndex = atoms.findIndex(atom => atom.kind !== 'text')
  const lastItemIndex = (() => {
    for (let index = atoms.length - 1; index >= 0; index -= 1) {
      if (atoms[index].kind !== 'text') return index
    }
    return -1
  })()

  // 原子切片连续且覆盖 [bodyStart, sectionEnd)：preamble/postamble 直接取首/末条目
  // 之外的连续原文，保证 preamble + 条目 + postamble 拼接 === 分区正文原文。
  const preamble = firstItemIndex < 0
    ? sliceLines(lines, bodyStart, sectionEnd, md)
    : md.slice(lineStartOffset(lines, md, bodyStart), lineStartOffset(lines, md, atoms[firstItemIndex].startLine))
  const postamble = lastItemIndex < 0
    ? ''
    : md.slice(lineStartOffset(lines, md, atoms[lastItemIndex].endLine), lineStartOffset(lines, md, sectionEnd))

  const items: BlueprintV2SectionItem[] = []
  for (let index = firstItemIndex; firstItemIndex >= 0 && index <= lastItemIndex; index += 1) {
    const atom = atoms[index]
    if (atom.kind === 'scene') {
      items.push({
        kind: 'scene',
        id: createBlueprintV2SceneId(),
        level: atom.heading!.level,
        title: atom.heading!.text,
        markdown: sliceLines(lines, atom.startLine + 1, atom.endLine, md),
        presence: 'off-canvas',
      })
      continue
    }
    const markdown = sliceLines(lines, atom.startLine, atom.endLine, md)
    if (atom.kind === 'list') {
      const firstContentLine = (markdown.split('\n', 1)[0] ?? '').replace(/^[\t ]*(?:[-*+]|\d{1,9}[.)])[ \t]*/u, '')
      const labelMatch = FIELD_LABEL.exec(firstContentLine)
      const check = checkFor(sectionId, markdown)
      if (labelMatch) {
        items.push({
          kind: 'field',
          id: createBlueprintV2ItemId(),
          label: labelMatch[1],
          markdown,
          ...(check ? { check } : {}),
        })
      } else {
        items.push({
          kind: 'bullet',
          id: createBlueprintV2ItemId(),
          label: null,
          markdown,
          ...(check ? { check } : {}),
        })
      }
      continue
    }
    items.push({ kind: 'block', id: createBlueprintV2ItemId(), markdown })
  }
  return { preamble, items, postamble }
}

/** 解析完整章节细纲 Markdown。解析永不因"看不懂"而失败（看不懂 = 原样保留）。 */
export function parseChapterBlueprintMarkdown(input: string): ChapterBlueprintV2MarkdownParseResult {
  if (typeof input !== 'string') {
    throw new Error(`细纲导入内容必须是字符串，收到：${typeof input}`)
  }
  if (input.length > MAX_BLUEPRINT_V2_RAW_MARKDOWN) {
    throw new Error(`细纲导入内容超限：${input.length} > ${MAX_BLUEPRINT_V2_RAW_MARKDOWN} 字符`)
  }
  const md = input.replace(/\r\n?/gu, '\n')
  const lines = splitLines(md)
  const fenceLines = computeFenceLines(lines)
  const headings = collectHeadings(lines, fenceLines)

  // 分区边界：H2–H4 标题（章题行之后的第一行起算）。
  const registryByTitle = new Map(
    BLUEPRINT_V2_CANONICAL_SECTIONS.map(entry => [normalizeBlueprintV2SectionTitle(entry.title), entry.id] as const),
  )

  // 章题：首个分区（H2–H4）开始之前的 H1–H3 标题中，第一个匹配「第N章」的。
  // 匹配「第N章」的标题优先作章题（H3 同时落在分区候选区间，必须先判章题）。
  let chapterTitleLine = -1
  let chapterTitle = ''
  let chapterTitleLevel: number | undefined
  let firstSectionLine = lines.length
  for (const heading of headings) {
    if (chapterTitleLine < 0 && heading.level <= 3
      && parseChapterNumberFromTitle(heading.text) !== null) {
      chapterTitleLine = heading.lineIndex
      chapterTitle = heading.text
      chapterTitleLevel = heading.level
      continue
    }
    if (heading.level >= 2 && heading.level <= 4) {
      firstSectionLine = heading.lineIndex
      break
    }
  }
  const suggestedChapterNumber = chapterTitleLine >= 0 ? parseChapterNumberFromTitle(chapterTitle) : null

  interface PendingSection { heading: HeadingInfo; bodyStart: number; bodyEnd: number }
  // 分区边界是下一个 H2–H4 标题；更深一级的标题（如 ##### 分镜）属于分区内文。
  const sectionHeadings = headings.filter(heading =>
    heading.level >= 2 && heading.level <= 4 && heading.lineIndex > chapterTitleLine)
  const pendingSections: PendingSection[] = sectionHeadings.map((heading, index) => ({
    heading,
    bodyStart: heading.lineIndex + 1,
    bodyEnd: index + 1 < sectionHeadings.length ? sectionHeadings[index + 1].lineIndex : lines.length,
  }))
  const docPreamble = sliceLines(lines, 0, chapterTitleLine >= 0 ? chapterTitleLine : firstSectionLine, md)
  // 章题行之后、首个分区标题行之前的散块（契约冻结模型没有这个位置，见缺口 §13.6）。
  const chapterPostamble = chapterTitleLine >= 0
    ? sliceLines(lines, chapterTitleLine + 1, firstSectionLine, md)
    : ''

  const customTitleSeen = new Map<string, number>()
  const sections: BlueprintV2Section[] = pendingSections.map(({ heading, bodyStart, bodyEnd }) => {
    const normalized = normalizeBlueprintV2SectionTitle(heading.text)
    const registryId = registryByTitle.get(normalized)
    if (registryId) {
      const atoms = scanSectionAtoms(lines, fenceLines, bodyStart, bodyEnd, heading.level, registryId === 'storyboard')
      const { preamble, items, postamble } = buildSectionItems(atoms, lines, md, bodyStart, bodyEnd, registryId)
      const section: BlueprintV2CanonicalSection = {
        kind: 'canonical',
        id: registryId,
        title: heading.text,
        preamble,
        items,
        postamble,
        level: heading.level,
      }
      return section
    }
    const occurrence = customTitleSeen.get(normalized) ?? 0
    customTitleSeen.set(normalized, occurrence + 1)
    return {
      kind: 'custom',
      id: customBlueprintV2SectionId(heading.text, occurrence),
      title: heading.text,
      level: heading.level,
      body: sliceLines(lines, bodyStart, bodyEnd, md),
    }
  })

  return {
    chapterTitle,
    suggestedChapterNumber,
    content: {
      schemaVersion: 2,
      chapterNumber: suggestedChapterNumber ?? 0,
      chapterTitle,
      ...(chapterTitleLevel !== undefined ? { chapterTitleLevel } : {}),
      docPreamble,
      ...(chapterPostamble ? { chapterPostamble } : {}),
      sections,
      origin: 'import',
    },
  }
}

// ===== 序列化 =====

function headingLine(level: number, title: string): string {
  return title ? `${'#'.repeat(level)} ${title}\n` : `${'#'.repeat(level)}\n`
}

/** 规范导出：docPreamble → 章题行 → 章题后散块 → 依序各分区（title 行 + preamble + 条目 + postamble）。 */
export function serializeChapterBlueprintV2(content: ChapterBlueprintV2Content): string {
  const parts: string[] = [content.docPreamble]
  if (content.chapterTitle) {
    parts.push(headingLine(content.chapterTitleLevel ?? 3, content.chapterTitle))
    parts.push(content.chapterPostamble ?? '')
  }
  for (const section of content.sections) {
    if (section.kind === 'custom') {
      parts.push(headingLine(section.level, section.title))
      parts.push(section.body)
      continue
    }
    parts.push(headingLine(section.level ?? 4, section.title))
    parts.push(section.preamble)
    for (const item of section.items) {
      if (item.kind === 'scene') parts.push(headingLine(item.level, item.title))
      parts.push(item.markdown)
    }
    parts.push(section.postamble)
  }
  return parts.join('')
}

// ===== 无损自检（导出前必须通过；契约 §4.2.4） =====

function assertSameText(left: string, right: string, where: string): void {
  if (left !== right) {
    throw new Error(`导出自检失败（${where}）：内容在往返中发生了改写`)
  }
}

/**
 * serialize → 再 parse → 逐项比对：custom body、每个条目 markdown、每个 scene 的
 * title/markdown/level 完全相等（id/presence/check 是应用元数据，不写入 Markdown，
 * 不参与比对）。禁止把未通过自检的导出结果交给用户。
 */
export function assertNoLossOnSerialize(content: ChapterBlueprintV2Content): void {
  const reparsed = parseChapterBlueprintMarkdown(serializeChapterBlueprintV2(content)).content
  assertSameText(content.chapterTitle, reparsed.chapterTitle, '章题')
  assertSameText(content.docPreamble, reparsed.docPreamble, '文档前导')
  assertSameText(content.chapterPostamble ?? '', reparsed.chapterPostamble ?? '', '章题后散块')
  if (content.sections.length !== reparsed.sections.length) {
    throw new Error(`导出自检失败：分区数量 ${content.sections.length} → ${reparsed.sections.length}`)
  }
  content.sections.forEach((section, sectionIndex) => {
    const other = reparsed.sections[sectionIndex]
    const where = `分区「${section.title}」`
    if (section.kind !== other.kind) throw new Error(`导出自检失败（${where}）：分区类型改变`)
    if (section.kind === 'custom' && other.kind === 'custom') {
      assertSameText(section.body, other.body, where)
      return
    }
    if (section.kind !== 'canonical' || other.kind !== 'canonical') {
      throw new Error(`导出自检失败（${where}）：分区类型改变`)
    }
    if (section.id !== other.id) throw new Error(`导出自检失败（${where}）：分区 ID 改变`)
    assertSameText(section.title, other.title, where)
    assertSameText(section.preamble, other.preamble, `${where} 前导`)
    assertSameText(section.postamble, other.postamble, `${where} 尾部`)
    if (section.items.length !== other.items.length) {
      throw new Error(`导出自检失败（${where}）：条目数量 ${section.items.length} → ${other.items.length}`)
    }
    section.items.forEach((item, itemIndex) => {
      const otherItem = other.items[itemIndex]
      const itemWhere = `${where} 条目 ${item.id}`
      if (item.kind !== otherItem.kind) throw new Error(`导出自检失败（${itemWhere}）：条目类型改变`)
      assertSameText(item.markdown, otherItem.markdown, itemWhere)
      if (item.kind === 'scene' && otherItem.kind === 'scene') {
        assertSameText(item.title, otherItem.title, itemWhere)
        if (item.level !== otherItem.level) throw new Error(`导出自检失败（${itemWhere}）：标题级改变`)
      }
      if (item.kind === 'field' && otherItem.kind === 'field') {
        assertSameText(item.label, otherItem.label, itemWhere)
      }
    })
  })
}

// ===== 重复导入（契约 §4.3） =====

export interface BlueprintV2ReimportSceneMatch {
  /** 标题匹配成功、沿用旧 scene id 的分镜（画布链接因此存活）。 */
  kept: Array<{ sceneId: string; title: string; existingOrder: number; incomingOrder: number }>
  /** 旧有新无：将被移除，逐条展示原文。 */
  removed: Array<{ sceneId: string; title: string; markdown: string }>
  /** 新有旧无：将分配新 id。 */
  added: Array<{ title: string; markdown: string }>
}

/**
 * 分镜级匹配（冻结规则）：normalizeBlueprintV2SectionTitle(title) 相等 → 沿用旧
 * scene id；旧有新无 → removed；新有旧无 → added。不重排、不改写编号文字。
 */
export function matchScenesForReimport(
  existing: ChapterBlueprintV2Content,
  incoming: ChapterBlueprintV2Content,
): BlueprintV2ReimportSceneMatch {
  const existingScenes = getBlueprintV2Scenes(existing)
  const incomingScenes = getBlueprintV2Scenes(incoming)
  const existingByTitle = new Map<string, (typeof existingScenes)[number]>()
  existingScenes.forEach(scene => {
    const key = normalizeBlueprintV2SectionTitle(scene.title)
    if (!existingByTitle.has(key)) existingByTitle.set(key, scene)
  })
  const matchedExisting = new Set<string>()
  const kept: BlueprintV2ReimportSceneMatch['kept'] = []
  const added: BlueprintV2ReimportSceneMatch['added'] = []
  incomingScenes.forEach(scene => {
    const match = existingByTitle.get(normalizeBlueprintV2SectionTitle(scene.title))
    if (match) {
      matchedExisting.add(match.sceneId)
      kept.push({
        sceneId: match.sceneId,
        title: scene.title,
        existingOrder: match.order,
        incomingOrder: scene.order,
      })
      return
    }
    added.push({ title: scene.title, markdown: scene.markdown })
  })
  const removed = existingScenes
    .filter(scene => !matchedExisting.has(scene.sceneId))
    .map(scene => ({ sceneId: scene.sceneId, title: scene.title, markdown: scene.markdown }))
  return { kept, removed, added }
}

/** 把匹配到的旧 scene id 回填进待导入内容（用户确认后保存，画布链接存活）。 */
export function applyBlueprintV2SceneIdReuse(
  incoming: ChapterBlueprintV2Content,
  existing: ChapterBlueprintV2Content,
): ChapterBlueprintV2Content {
  const reuseByTitle = new Map<string, string>()
  for (const scene of getBlueprintV2Scenes(existing)) {
    const key = normalizeBlueprintV2SectionTitle(scene.title)
    if (!reuseByTitle.has(key)) reuseByTitle.set(key, scene.sceneId)
  }
  return {
    ...incoming,
    sections: incoming.sections.map(section => {
      if (section.kind !== 'canonical') return section
      let changed = false
      const items = section.items.map(item => {
        if (item.kind !== 'scene') return item
        const reused = reuseByTitle.get(normalizeBlueprintV2SectionTitle(item.title))
        if (!reused || reused === item.id) return item
        changed = true
        return { ...item, id: reused }
      })
      return changed ? { ...section, items } : section
    }),
  }
}

export interface BlueprintV2ReimportSectionDiff {
  /** canonical 分区 id 或 custom 分区 id。 */
  sectionKey: string
  sectionTitle: string
  status: 'unchanged' | 'update' | 'add' | 'remove'
}

function sectionFingerprint(section: BlueprintV2Section): string {
  if (section.kind === 'custom') return `custom\n${section.body}`
  return `canonical\n${section.preamble}\n${section.items.map(item => `${item.kind}\n${item.markdown}`).join('\n')}\n${section.postamble}`
}

/** 分区级预览差异：标题匹配 → unchanged/update，旧有新无 → remove，新有旧无 → add。 */
export function diffChapterBlueprintV2ForReimport(
  existing: ChapterBlueprintV2Content,
  incoming: ChapterBlueprintV2Content,
): BlueprintV2ReimportSectionDiff[] {
  const existingByKey = new Map<string, BlueprintV2Section>()
  for (const section of existing.sections) {
    const key = section.kind === 'canonical' ? section.id : section.id
    if (!existingByKey.has(key)) existingByKey.set(key, section)
  }
  const incomingKeys = new Set<string>()
  const diffs: BlueprintV2ReimportSectionDiff[] = []
  for (const section of incoming.sections) {
    const key = section.id
    incomingKeys.add(key)
    const current = existingByKey.get(key)
    if (!current) {
      diffs.push({ sectionKey: key, sectionTitle: section.title, status: 'add' })
      continue
    }
    diffs.push({
      sectionKey: key,
      sectionTitle: section.title,
      status: sectionFingerprint(current) === sectionFingerprint(section) ? 'unchanged' : 'update',
    })
  }
  for (const section of existing.sections) {
    if (!incomingKeys.has(section.id)) {
      diffs.push({ sectionKey: section.id, sectionTitle: section.title, status: 'remove' })
    }
  }
  return diffs
}

// ===== 无法归类内容预览（导入向导用；内容本身已逐字保留） =====

export interface BlueprintV2UnclassifiedEntry {
  kind: 'custom-section' | 'unrecognized-block'
  /** 分区标题或条目所在分区标题。 */
  title: string
  preview: string
}

const PREVIEW_LENGTH = 80

/** 列出 custom 分区与 canonical 分区中的 block 散块（均已逐字保留，此处仅供预览定位）。 */
export function collectBlueprintV2Unclassified(content: ChapterBlueprintV2Content): BlueprintV2UnclassifiedEntry[] {
  const entries: BlueprintV2UnclassifiedEntry[] = []
  for (const section of content.sections) {
    if (section.kind === 'custom') {
      entries.push({
        kind: 'custom-section',
        title: section.title,
        preview: section.body.trimStart().slice(0, PREVIEW_LENGTH),
      })
      continue
    }
    for (const item of section.items) {
      if (item.kind !== 'block') continue
      entries.push({
        kind: 'unrecognized-block',
        title: section.title,
        preview: item.markdown.trimStart().slice(0, PREVIEW_LENGTH),
      })
    }
  }
  return entries
}
