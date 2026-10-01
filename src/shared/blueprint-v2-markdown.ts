/**
 * 章节蓝图 v2 的 Markdown 导入/导出（docs/blueprint-v2-contract.md §4）。
 *
 * 全部为纯函数：不触 IPC、不触 DB。只 import src/shared/blueprint-v2.ts。
 *
 * 保真原则（红线 3）：解析、序列化对未编辑内容逐字保留（仅允许 CRLF→LF 归一化）；
 * 解析永不因「看不懂」而失败——看不懂 = 原样保留；只因超限/类型错误而失败。
 */

import {
  BLUEPRINT_V2_CANONICAL_SECTIONS,
  BLUEPRINT_V2_SCHEMA_VERSION,
  MAX_BLUEPRINT_V2_RAW_MARKDOWN,
  MAX_BLUEPRINT_V2_SCENE_TITLE,
  createBlueprintV2ItemId,
  createBlueprintV2SceneId,
  customBlueprintV2SectionId,
  getBlueprintV2Scenes,
  normalizeBlueprintV2SectionTitle,
  isBlueprintV2SectionId,
  type BlueprintV2BlockItem,
  type BlueprintV2BulletItem,
  type BlueprintV2CheckMode,
  type BlueprintV2FieldItem,
  type BlueprintV2SceneItem,
  type BlueprintV2Section,
  type BlueprintV2SectionId,
  type BlueprintV2SectionItem,
  type ChapterBlueprintV2Content,
} from './blueprint-v2'

/** 归一化分镜标题（用于重导入匹配；不改动原文）。 */
function normalizeSceneTitle(title: string): string {
  return normalizeBlueprintV2SectionTitle(title)
}

// ===== 解析 =====

export interface ChapterBlueprintMarkdownParseResult {
  content: ChapterBlueprintV2Content
  /** 仅建议；映射到哪章由调用方决定（契约 §4.1.2）。 */
  suggestedChapterNumber: number | null
}

interface HeadingLine {
  lineIndex: number
  level: number
  /** `#` 序列与首个空白之后的原文（保留多余空格以逐字还原）。 */
  text: string
}

interface ListLine {
  indent: number
  content: string
}

const CHAPTER_TITLE_PATTERN = /^第\s*([0-9０-９]+|零?[一二三四五六七八九十]{1,3})\s*章/u

function headingOf(line: string): HeadingLine | null {
  const match = /^(#{1,6})\s(.*)$/.exec(line)
  if (!match) return null
  return { lineIndex: -1, level: match[1].length, text: match[2] }
}

function listLineOf(line: string): ListLine | null {
  const match = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line)
  if (!match) return null
  return { indent: match[1].length, content: match[2] }
}

function chineseNumeralToNumber(text: string): number | null {
  const digits: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  const normalized = text.replace(/^零/u, '')
  if (/^[0-9]+$/u.test(normalized)) return Number.parseInt(normalized, 10)
  if (/^[０-９]+$/u.test(normalized)) {
    return Number.parseInt(normalized.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)), 10)
  }
  if (!/^[一二三四五六七八九十]{1,3}$/u.test(normalized)) return null
  const tenIndex = normalized.indexOf('十')
  if (tenIndex < 0) return digits[normalized] ?? null
  const tens = tenIndex === 0 ? 1 : digits[normalized[tenIndex - 1]] ?? 0
  const onesSource = normalized.slice(tenIndex + 1)
  const ones = onesSource ? digits[onesSource] ?? null : 0
  if (ones === null) return null
  return tens * 10 + ones
}

function suggestedChapterNumberFromTitle(title: string): number | null {
  const match = CHAPTER_TITLE_PATTERN.exec(title)
  if (!match) return null
  return chineseNumeralToNumber(match[1])
}

/** 检查语义推断（契约 §10.2，仅 foreshadow / taboos 分区）。 */
function inferCheckFromMarkdown(markdown: string): { mode: BlueprintV2CheckMode; source: 'explicit' | 'inferred' } {
  const firstLine = markdown.split('\n')[0] ?? ''
  const withoutMarker = firstLine.replace(/^(\s*)(?:[-*+]|\d{1,9}[.)])\s+/, '')
  const explicit = /^【(必达|参考|禁写)】/u.exec(withoutMarker.replace(/^\*\*[^*]*\*\*\s*[：:]?\s*/, ''))
  if (explicit) {
    const mode: BlueprintV2CheckMode = explicit[1] === '必达' ? 'must' : explicit[1] === '禁写' ? 'forbid' : 'reference'
    return { mode, source: 'explicit' }
  }
  if (/严禁|禁止|不得|不允许|切勿/u.test(markdown)) return { mode: 'forbid', source: 'inferred' }
  if (/必达|必须|务必|一定要/u.test(markdown)) return { mode: 'must', source: 'inferred' }
  return { mode: 'reference', source: 'inferred' }
}

type ListAccumItem = BlueprintV2FieldItem | BlueprintV2BulletItem

type SectionAccum =
  | { type: 'none' }
  | { type: 'scene'; item: BlueprintV2SceneItem }
  | { type: 'list'; item: ListAccumItem; indent: number }
  | { type: 'block'; parts: string[] }

interface CanonicalBody {
  preamble: string
  items: BlueprintV2SectionItem[]
  postamble: string
}

/**
 * canonical 分区正文解析：把每一行的文本贡献（含行尾换行）划归唯一的归属
 * （preamble / 条目 / postamble），保证拼接即可无损还原。
 */
function parseCanonicalBody(
  contributions: readonly string[],
  lines: readonly string[],
  sectionLevel: number,
  sectionId: BlueprintV2SectionId,
): CanonicalBody {
  const preambleParts: string[] = []
  const items: BlueprintV2SectionItem[] = []
  let accum: SectionAccum = { type: 'none' }

  const flush = () => {
    if (accum.type === 'scene') {
      items.push(accum.item)
    } else if (accum.type === 'list') {
      items.push(accum.item)
    } else if (accum.type === 'block') {
      items.push({ kind: 'block', id: createBlueprintV2ItemId(), markdown: accum.parts.join('') })
    }
    accum = { type: 'none' }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const contribution = contributions[index]
    const heading = headingOf(line)
    if (heading) {
      const startsScene = sectionId === 'storyboard'
        && heading.level > sectionLevel
        && heading.text.trimStart().startsWith('场景')
      if (startsScene) {
        flush()
        const title = heading.text
        if (title.length > MAX_BLUEPRINT_V2_SCENE_TITLE) {
          throw new Error(`分镜标题超限（≤${MAX_BLUEPRINT_V2_SCENE_TITLE} 字符）：${title.slice(0, 60)}…`)
        }
        accum = {
          type: 'scene',
          item: {
            kind: 'scene',
            id: createBlueprintV2SceneId(),
            level: heading.level,
            title,
            markdown: '',
            presence: 'off-canvas',
          },
        }
        continue
      }
      // A scene owns every following heading and block until the next scene
      // heading (or the next canonical section boundary). Subheadings such as
      // “时空与环境” are part of the scene Markdown, not separate outline items.
      if (accum.type === 'scene') {
        accum.item.markdown += contribution
        continue
      }
      flush()
      accum = { type: 'block', parts: [contribution] }
      continue
    }
    // 分镜正文 = 标题行后到下一标题前的全部内容（含列表），逐字并入 markdown。
    if (accum.type === 'scene') {
      accum.item.markdown += contribution
      continue
    }
    const list = listLineOf(line)
    if (list) {
      if (accum.type === 'list' && list.indent > accum.indent) {
        accum.item.markdown += contribution
        continue
      }
      flush()
      const fieldMatch = /^\*\*(.+?)\*\*\s*[：:]/u.exec(list.content)
      const item: ListAccumItem = fieldMatch
        ? { kind: 'field', id: createBlueprintV2ItemId(), label: fieldMatch[1], markdown: contribution }
        : { kind: 'bullet', id: createBlueprintV2ItemId(), label: null, markdown: contribution }
      accum = { type: 'list', item, indent: list.indent }
      continue
    }
    if (accum.type === 'list') {
      if (line.trim() === '') {
        accum.item.markdown += contribution
        continue
      }
      if (line.length - line.trimStart().length > accum.indent) {
        accum.item.markdown += contribution
        continue
      }
      flush()
      accum = { type: 'block', parts: [contribution] }
      continue
    }
    if (accum.type === 'block') {
      accum.parts.push(contribution)
      continue
    }
    preambleParts.push(contribution)
  }
  flush()

  if (sectionId === 'foreshadow' || sectionId === 'taboos') {
    for (const item of items) {
      if (item.kind === 'field' || item.kind === 'bullet') {
        item.check = inferCheckFromMarkdown(item.markdown)
      }
    }
  }

  // 末个条目之后的散块（含结尾 --- 等）→ postamble。
  let postamble = ''
  while (items.length > 0 && items[items.length - 1].kind === 'block') {
    const block = items.pop() as BlueprintV2BlockItem
    postamble = block.markdown + postamble
  }

  return { preamble: preambleParts.join(''), items, postamble }
}

export function parseChapterBlueprintMarkdown(raw: string): ChapterBlueprintMarkdownParseResult {
  if (typeof raw !== 'string') throw new Error('细纲内容必须是文本')
  if (raw.length > MAX_BLUEPRINT_V2_RAW_MARKDOWN) {
    throw new Error(`细纲内容超限：${raw.length} > ${MAX_BLUEPRINT_V2_RAW_MARKDOWN} 字符`)
  }
  // 统一换行符归一化（契约允许的唯一改写）。
  const md = raw.replace(/\r\n?/g, '\n')
  const lines = md.split('\n')
  // 每行拥有自己的行尾换行；文档末行（split 出的空串或不带换行的尾行）不带换行。
  const contributions = lines.map((line, index) => (index < lines.length - 1 ? `${line}\n` : line))

  // 章题：首个匹配 `第…章` 的 H1–H3 标题行（契约 §4.1.2）。它必须位于首个
  // 一级分区之前，否则视为普通内容保留，避免序列化时重复输出。
  let chapterTitle = ''
  let chapterTitleLevel: number | undefined
  let suggestedChapterNumber: number | null = null
  let chapterTitleLineIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const heading = headingOf(lines[index])
    if (!heading || heading.level > 3) continue
    const suggested = suggestedChapterNumberFromTitle(heading.text)
    if (suggested !== null) {
      chapterTitle = heading.text
      chapterTitleLevel = heading.level
      suggestedChapterNumber = suggested
      chapterTitleLineIndex = index
      break
    }
  }

  // 一级分区 = H2–H4 标题；分区 = 相邻两个 H2–H4 标题之间的整块。
  // 章题行（H1–H3 与 H2–H4 在 H3 重叠）不得成为分区起始。
  const sectionHeadings: Array<{ heading: HeadingLine; index: number }> = []
  for (let index = 0; index < lines.length; index += 1) {
    if (index === chapterTitleLineIndex) continue
    const heading = headingOf(lines[index])
    if (heading && heading.level >= 2 && heading.level <= 4) {
      sectionHeadings.push({ heading, index })
    }
  }
  if (chapterTitleLineIndex >= 0 && sectionHeadings.length > 0
    && chapterTitleLineIndex > sectionHeadings[0].index) {
    // 章题行落在分区之后：按普通内容处理（保留在分区正文中）。
    chapterTitle = ''
    chapterTitleLevel = undefined
    suggestedChapterNumber = null
    chapterTitleLineIndex = -1
    const sectionHeadingsRebuilt: Array<{ heading: HeadingLine; index: number }> = []
    for (let index = 0; index < lines.length; index += 1) {
      const heading = headingOf(lines[index])
      if (heading && heading.level >= 2 && heading.level <= 4) {
        sectionHeadingsRebuilt.push({ heading, index })
      }
    }
    sectionHeadings.length = 0
    sectionHeadings.push(...sectionHeadingsRebuilt)
  }

  const docPreambleParts: string[] = []
  const sections: BlueprintV2Section[] = []

  for (let s = 0; s < sectionHeadings.length; s += 1) {
    const { heading, index } = sectionHeadings[s]
    const bodyEnd = s + 1 < sectionHeadings.length ? sectionHeadings[s + 1].index : lines.length
    if (s === 0) {
      // 首个分区之前：除章题行以外的全部散块。
      for (let i = 0; i < index; i += 1) {
        if (i === chapterTitleLineIndex) continue
        docPreambleParts.push(contributions[i])
      }
    }
    const bodyLines = lines.slice(index + 1, bodyEnd)
    const bodyContributions = contributions.slice(index + 1, bodyEnd)
    const normalized = normalizeBlueprintV2SectionTitle(heading.text)
    const canonical = (BLUEPRINT_V2_CANONICAL_SECTIONS as readonly { id: string; title: string }[])
      .find(entry => normalizeBlueprintV2SectionTitle(entry.title) === normalized)
    if (canonical && isBlueprintV2SectionId(canonical.id)) {
      const body = parseCanonicalBody(bodyContributions, bodyLines, heading.level, canonical.id)
      sections.push({
        kind: 'canonical',
        id: canonical.id,
        title: heading.text,
        level: heading.level,
        preamble: body.preamble,
        items: body.items,
        postamble: body.postamble,
      })
    } else {
      sections.push({
        kind: 'custom',
        id: customBlueprintV2SectionId(heading.text),
        title: heading.text,
        level: heading.level,
        body: bodyContributions.join(''),
      })
    }
  }

  // 没有任何一级分区时：全部内容留在前导散块（章题行除外），绝不丢弃。
  if (sectionHeadings.length === 0) {
    for (let i = 0; i < contributions.length; i += 1) {
      if (i === chapterTitleLineIndex) continue
      docPreambleParts.push(contributions[i])
    }
  }

  const content: ChapterBlueprintV2Content = {
    schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
    chapterNumber: suggestedChapterNumber ?? 0,
    chapterTitle,
    ...(chapterTitleLevel === undefined ? {} : { chapterTitleLevel }),
    docPreamble: docPreambleParts.join(''),
    sections,
    origin: 'import',
  }
  return { content, suggestedChapterNumber }
}

// ===== 序列化 =====

export function serializeChapterBlueprintV2(content: ChapterBlueprintV2Content): string {
  const parts: string[] = []
  parts.push(content.docPreamble)
  if (content.chapterTitle) {
    parts.push(`${'#'.repeat(content.chapterTitleLevel ?? 3)} ${content.chapterTitle}\n`)
  }
  for (const section of content.sections) {
    if (section.kind === 'custom') {
      parts.push(`${'#'.repeat(section.level)} ${section.title}\n`)
      parts.push(section.body)
      continue
    }
    parts.push(`${'#'.repeat(section.level ?? 4)} ${section.title}\n`)
    parts.push(section.preamble)
    for (const item of section.items) {
      if (item.kind === 'scene') {
        parts.push(`${'#'.repeat(item.level)} ${item.title}\n`)
        parts.push(item.markdown)
      } else {
        parts.push(item.markdown)
      }
    }
    parts.push(section.postamble)
  }
  return parts.join('')
}

/**
 * 无损自检（契约 §4.2.4，每次导出前必须调用）：serialize → 再 parse → 逐项比对。
 * 每条目 markdown、scene title/level、custom body 完全相等（换行已归一化）。
 * check/presence/canvasNodeId/id 是应用元数据，不参与比对（契约 §4.2.3 已知限制）。
 */
export function assertNoLossOnSerialize(content: ChapterBlueprintV2Content): string {
  const markdown = serializeChapterBlueprintV2(content)
  const reparsed = parseChapterBlueprintMarkdown(markdown).content
  const describe = (where: string) => `导出自检失败（${where}）：内容无法无损往返`
  if (reparsed.chapterTitle !== content.chapterTitle) throw new Error(describe('章题'))
  if (reparsed.docPreamble !== content.docPreamble) throw new Error(describe('前导散块'))
  if (reparsed.sections.length !== content.sections.length) {
    throw new Error(describe(`分区数量 ${content.sections.length} → ${reparsed.sections.length}`))
  }
  for (let s = 0; s < content.sections.length; s += 1) {
    const source = content.sections[s]
    const target = reparsed.sections[s]
    const sectionWhere = `分区「${source.title}」`
    if (source.kind !== target.kind) throw new Error(describe(`${sectionWhere} 类型`))
    if (source.title !== target.title) throw new Error(describe(`${sectionWhere} 标题`))
    if (source.kind === 'custom' && target.kind === 'custom') {
      if (source.body !== target.body) throw new Error(describe(sectionWhere))
      continue
    }
    if (source.kind !== 'canonical' || target.kind !== 'canonical') continue
    if (source.preamble !== target.preamble || source.postamble !== target.postamble) {
      throw new Error(describe(`${sectionWhere} 前后散块`))
    }
    if (source.items.length !== target.items.length) {
      throw new Error(describe(`${sectionWhere} 条目数量 ${source.items.length} → ${target.items.length}`))
    }
    for (let i = 0; i < source.items.length; i += 1) {
      const sourceItem = source.items[i]
      const targetItem = target.items[i]
      const itemWhere = `${sectionWhere} 第 ${i + 1} 条（${sourceItem.id}）`
      if (sourceItem.kind !== targetItem.kind) throw new Error(describe(itemWhere))
      if (sourceItem.kind === 'scene' && targetItem.kind === 'scene') {
        if (sourceItem.title !== targetItem.title || sourceItem.level !== targetItem.level) {
          throw new Error(describe(`${itemWhere} 分镜标题`))
        }
      }
      if (sourceItem.markdown !== targetItem.markdown) throw new Error(describe(itemWhere))
    }
  }
  return markdown
}

// ===== 重复导入（契约 §4.3） =====

export interface BlueprintV2SceneMatchEntry {
  /** 新文档分镜（按文档顺序）。 */
  sceneId: string
  title: string
  level: number
  markdown: string
  /** 匹配到的旧分镜 ID；沿用旧 id 时画布链接存活（契约 §4.3.2）。 */
  matchedSceneId: string | null
}

export interface BlueprintV2ReimportMatch {
  incoming: BlueprintV2SceneMatchEntry[]
  /** 旧有新无 → 将被移除，逐条展示原文（契约 §4.3.2）。 */
  removed: Array<{ sceneId: string; title: string; markdown: string }>
  /** 旧文档分镜数量（供预览展示）。 */
  currentSceneCount: number
}

/**
 * 分镜匹配（冻结规则）：normalize(scene.title) 相等（章号相同由调用方保证）→
 * 沿用旧 scene id；旧有新无 → removed；新有旧无 → 新 id。
 */
export function matchScenesForReimport(
  current: ChapterBlueprintV2Content,
  incoming: ChapterBlueprintV2Content,
): BlueprintV2ReimportMatch {
  const currentScenes = getBlueprintV2Scenes(current)
  const incomingScenes = getBlueprintV2Scenes(incoming)
  const consumed = new Set<string>()
  const incomingEntries = incomingScenes.map(scene => {
    const matched = currentScenes.find(
      candidate => !consumed.has(candidate.sceneId) && normalizeSceneTitle(candidate.title) === normalizeSceneTitle(scene.title),
    )
    if (matched) consumed.add(matched.sceneId)
    return {
      sceneId: scene.sceneId,
      title: scene.title,
      level: 5,
      markdown: scene.markdown,
      matchedSceneId: matched?.sceneId ?? null,
    }
  })
  return {
    incoming: incomingEntries,
    removed: currentScenes
      .filter(scene => !consumed.has(scene.sceneId))
      .map(scene => ({ sceneId: scene.sceneId, title: scene.title, markdown: scene.markdown })),
    currentSceneCount: currentScenes.length,
  }
}

/**
 * 应用重导入：整章以导入文档为准（用户已在预览确认），已匹配分镜沿用旧
 * scene id / presence / canvasNodeId，画布链接因此存活；新分镜默认不在画布上。
 */
export function applyBlueprintV2Reimport(
  current: ChapterBlueprintV2Content,
  incoming: ChapterBlueprintV2Content,
  chapterNumber: number,
): ChapterBlueprintV2Content {
  const match = matchScenesForReimport(current, incoming)
  const matchedByIncomingId = new Map(
    match.incoming.filter(entry => entry.matchedSceneId).map(entry => [entry.sceneId, entry.matchedSceneId as string]),
  )
  const currentScenes = getBlueprintV2Scenes(current)
  const currentById = new Map(currentScenes.map(scene => [scene.sceneId, scene]))
  const sections = incoming.sections.map(section => {
    if (!(section.kind === 'canonical' && section.id === 'storyboard')) return section
    const items = section.items.map((item): BlueprintV2SectionItem => {
      if (item.kind !== 'scene') return item
      const oldSceneId = matchedByIncomingId.get(item.id)
      const oldScene = oldSceneId ? currentById.get(oldSceneId) : undefined
      if (!oldScene) return item
      return {
        ...item,
        id: oldScene.sceneId,
        presence: oldScene.presence,
        ...(oldScene.canvasNodeId ? { canvasNodeId: oldScene.canvasNodeId } : {}),
      }
    })
    return { ...section, items }
  })
  return { ...incoming, chapterNumber, sections }
}
