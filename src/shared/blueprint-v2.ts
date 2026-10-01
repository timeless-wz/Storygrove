/**
 * 章节蓝图 v2（细纲）— 跨模块唯一权威类型模块（docs/blueprint-v2-contract.md §3）。
 *
 * 权威边界（冻结，详见契约 §0/§2）：
 * - 分镜正文、规则、禁忌、检查条目的唯一权威是 `blueprint_details`（本模块类型）；
 * - `blueprints` 表的 title/purpose/keyEvents/suspenseHook 在 v2 存在时只是只读投影；
 * - `userGuidance`/`notes`/`role`/`characters`/`volume_id` 永远不属于 v2。
 *
 * 本模块必须是纯 TypeScript：渲染进程与主进程都会 import，因此 sha256 用
 * 纯 TS 实现（见 sha256Hex），不引入 node:crypto。
 */

import { randomCanvasUuid } from './canvas-ids'
import type { BlueprintData } from '../../electron/repositories/blueprint-repository'

export const BLUEPRINT_V2_SCHEMA_VERSION = 2

/** 分镜 ID 前缀（复用 src/shared/canvas-ids.ts 的随机 UUID 机制）。 */
export const BLUEPRINT_V2_SCENE_ID_PREFIX = 'bps'
export const BLUEPRINT_V2_CHECK_ID_PREFIX = 'bpc'

/** 防失控上限（远高于验收样例 ~2.8K 字符；防止粘贴失控而非限制正常内容）。 */
export const MAX_BLUEPRINT_V2_SCENE_TITLE = 160
export const MAX_BLUEPRINT_V2_SCENE_MARKDOWN = 100_000
export const MAX_BLUEPRINT_V2_RAW_MARKDOWN = 400_000

/** 七个一级部分的注册表（顺序 = 新建文档的规范顺序；解析时按文档实际顺序保留）。 */
export const BLUEPRINT_V2_CANONICAL_SECTIONS = [
  { id: 'positioning', title: '本章定位与四维指标' },
  { id: 'conflict', title: '核心矛盾与博弈结构' },
  { id: 'storyboard', title: '逐场分镜拆解' },
  { id: 'rules', title: '超凡物理与规则交互细节' },
  { id: 'cliffhanger', title: '章末爆点与断章定格' },
  { id: 'foreshadow', title: '线索埋设与伏笔自检' },
  { id: 'taboos', title: '写作禁忌与防坑自检' },
] as const

export type BlueprintV2SectionId =
  | 'positioning' | 'conflict' | 'storyboard' | 'rules'
  | 'cliffhanger' | 'foreshadow' | 'taboos'

/** 检查语义（契约 §10）。 */
export type BlueprintV2CheckMode = 'must' | 'reference' | 'forbid'

export interface BlueprintV2SceneItem {
  kind: 'scene'
  id: string                       // bps-<uuid>，跨编辑/拖动/重排稳定
  level: number                    // 分镜标题的标题级（样例为 5，即 #####）
  title: string                    // 标题行原文（含「场景一：」编号），永不改写编号文字
  markdown: string                 // 标题行后到下一标题前的全部正文，逐字保留
  presence: 'on-canvas' | 'off-canvas'   // 移出画布切换此值；删除分镜才是移除条目
  canvasNodeId?: string            // presence='on-canvas' 时指向 ccn- 节点；允许悬空（契约 §8.4）
}

/** 已识别的具名字段条目：首个形如 `- **标签**：` 的列表项。markdown 含该行原文与嵌套子列表，逐字保留。 */
export interface BlueprintV2FieldItem {
  kind: 'field'
  id: string                       // bpc- 之外的普通 uuid 条目 ID（bps- 前缀仅用于分镜）
  label: string                    // 标签原文，如「核心使命」「源-锚-桥-能参数」「视觉定格」「新线索」
  markdown: string
  /** 契约 §4.1.5/§10.2：仅 foreshadow / taboos 分区携带；其余分区必须为 undefined。 */
  check?: { mode: BlueprintV2CheckMode; source: 'explicit' | 'inferred' }
}

/** 未识别的列表条目（无粗体标签的普通列表项），逐字保留。 */
export interface BlueprintV2BulletItem {
  kind: 'bullet'
  id: string
  label: string | null
  markdown: string
  /** 仅 foreshadow / taboos 分区携带；其余分区必须为 undefined（契约 §10）。 */
  check?: { mode: BlueprintV2CheckMode; source: 'explicit' | 'inferred' }
}

/** 非列表散块（引用块、表格、段落、分隔线等），逐字保留。 */
export interface BlueprintV2BlockItem {
  kind: 'block'
  id: string
  markdown: string
}

export type BlueprintV2SectionItem =
  | BlueprintV2SceneItem | BlueprintV2FieldItem
  | BlueprintV2BulletItem | BlueprintV2BlockItem

export type BlueprintV2Section =
  | {
      kind: 'canonical'
      id: BlueprintV2SectionId
      title: string            // 标题行原文（含【】，如「【逐场分镜拆解】」）
      preamble: string         // 标题行后、首个条目前的散块，逐字保留
      items: BlueprintV2SectionItem[]
      postamble: string        // 末个条目后的散块（含结尾 `---` 等），逐字保留
      /**
       * additive（契约允许新增可选字段）：canonical 分区标题行的标题级（2–4）。
       * 没有 it 就无法在序列化时逐字重建 `#### 【…】` 行，无损自检会失败。
       */
      level?: number
    }
  | {
      kind: 'custom'           // 未识别的一级标题（H2–H4）：整节逐字保留
      id: string               // `custom-<8hex>`（标题归一化文本的稳定哈希截断）
      title: string            // 标题行原文
      level: number            // 2–4
      body: string             // 整节正文逐字保留
    }

/** 结构化内容（不含 revision/contentHash 等服务端维护字段）。 */
export interface ChapterBlueprintV2Content {
  schemaVersion: 2
  chapterNumber: number
  chapterTitle: string         // 文档 H1–H3 章题行原文，如「第1章｜接错的人」；无章题时为空串
  docPreamble: string          // 首个一级标题之前的散块，逐字保留
  sections: BlueprintV2Section[]   // 单一事实源：分镜=storyboard 分区内的 scene 条目，顺序=条目位次
  origin: 'import' | 'manual' | 'upgrade'
  /** additive：章题行的标题级（1–3），序列化时逐字重建 `### 第1章｜…` 需要。缺省按 3 处理。 */
  chapterTitleLevel?: number
}

export interface ChapterBlueprintV2Detail extends ChapterBlueprintV2Content {
  revision: number             // 服务端维护：每章从 1 起，成功保存 +1
  contentHash: string          // sha256(canonicalJSON({chapterTitle, docPreamble, sections}))，hex
  createdAt?: string
  updatedAt?: string
}

/** 轻量摘要（契约 §5.2）：绝不含分镜正文 / rawMarkdown。 */
export interface ChapterBlueprintV2Summary {
  chapterNumber: number
  revision: number
  contentHash: string
  origin: ChapterBlueprintV2Content['origin']
  updatedAt: string
  sceneCount: number
  sceneTitles: string[]
  wordBudget: number | null    // 解析自 positioning 分区「正文字数预算」（如 4200）
}

export interface ChapterBlueprintV2SaveInput {
  chapterNumber: number
  /** 乐观并发：0 = 期望不存在；否则必须等于当前 revision（契约 §7.2）。 */
  baseRevision: number
  content: ChapterBlueprintV2Content
}

/**
 * 契约 §5.1 的读取容错：detail_json 损坏或 schema_version 超前时绝不静默丢弃。
 * 冻结通道 `db:blueprint-v2-get` 的 return 是 `ChapterBlueprintV2Detail | null`，
 * 因此 corrupt / needs-newer-app 以 Detail 形状的附加可选字段表达（契约缺口 §15.5）。
 */
export interface ChapterBlueprintV2ReadState {
  /** 缺省 = 正常读取。 */
  readStatus?: 'corrupt' | 'needs-newer-app'
  rawMarkdown?: string
  storedSchemaVersion?: number
}

export type ChapterBlueprintV2DetailRead = ChapterBlueprintV2Detail & ChapterBlueprintV2ReadState

// ===== ID 与词表 =====

export function createBlueprintV2SceneId(): string {
  return `${BLUEPRINT_V2_SCENE_ID_PREFIX}-${randomCanvasUuid()}`
}

export function createBlueprintV2ItemId(): string {
  return `${BLUEPRINT_V2_CHECK_ID_PREFIX}-${randomCanvasUuid()}`
}

/** 去空白与【】，用于分区标题与分镜标题的匹配（契约 §4.1.3、§4.3.2）。 */
export function normalizeBlueprintV2SectionTitle(title: string): string {
  return title.replace(/[\s【】\[\]〔〕]/gu, '')
}

export function isBlueprintV2SectionId(value: unknown): value is BlueprintV2SectionId {
  return typeof value === 'string'
    && (BLUEPRINT_V2_CANONICAL_SECTIONS as readonly { id: string }[]).some(section => section.id === value)
}

export function findBlueprintV2CanonicalSection(
  content: ChapterBlueprintV2Content,
  id: BlueprintV2SectionId,
): Extract<BlueprintV2Section, { kind: 'canonical' }> | null {
  const section = content.sections.find(
    candidate => candidate.kind === 'canonical' && candidate.id === id,
  )
  return section && section.kind === 'canonical' ? section : null
}

/** storyboard 分区 scene 条目的扁平视图（order 1 起稠密）。 */
export function getBlueprintV2Scenes(content: ChapterBlueprintV2Content): Array<{
  sceneId: string; order: number; title: string; markdown: string;
  presence: 'on-canvas' | 'off-canvas'; canvasNodeId?: string
}> {
  const storyboard = findBlueprintV2CanonicalSection(content, 'storyboard')
  if (!storyboard) return []
  return storyboard.items
    .filter((item): item is BlueprintV2SceneItem => item.kind === 'scene')
    .map((scene, index) => ({
      sceneId: scene.id,
      order: index + 1,
      title: scene.title,
      markdown: scene.markdown,
      presence: scene.presence,
      ...(scene.canvasNodeId ? { canvasNodeId: scene.canvasNodeId } : {}),
    }))
}

/**
 * 仅调整该 scene 条目在 storyboard.items 中的位次，其余条目相对连续性不变；
 * toOrder 越界时夹取到 [1, 分镜数]。
 */
export function moveBlueprintV2Scene(
  content: ChapterBlueprintV2Content,
  sceneId: string,
  toOrder: number,
): ChapterBlueprintV2Content {
  const storyboard = findBlueprintV2CanonicalSection(content, 'storyboard')
  if (!storyboard) return content
  const sceneIndices = storyboard.items
    .map((item, index) => (item.kind === 'scene' && item.id === sceneId ? index : -1))
    .filter(index => index >= 0)
  if (sceneIndices.length === 0) return content
  const sceneItems = storyboard.items.filter(item => item.kind === 'scene')
  const targetOrder = Math.min(Math.max(Math.trunc(toOrder) || 1, 1), sceneItems.length)
  const currentOrder = sceneItems.findIndex(scene => scene.id === sceneId) + 1
  if (currentOrder === targetOrder) return content

  // 其余条目相对连续性不变：把 storyboard.items 里的 scene 子序列按目标顺序
  // 重排后，按原有位置逐槽回填（非分镜条目原地不动）。
  const sceneIdsInOrder = sceneItems
    .filter(scene => scene.id !== sceneId)
    .map(scene => scene.id)
  sceneIdsInOrder.splice(targetOrder - 1, 0, sceneId)
  const orderedSceneItems = sceneIdsInOrder
    .map(id => sceneItems.find(scene => scene.id === id))
    .filter((scene): scene is BlueprintV2SceneItem => Boolean(scene))
  // 重建：遍历原 items，scene 槽位按新顺序取用，其他条目原地不动。
  let orderCursor = 0
  const rebuilt = storyboard.items.map(
    item => (item.kind === 'scene' ? orderedSceneItems[orderCursor++] : item),
  )
  const sections = content.sections.map(section => {
    if (!(section.kind === 'canonical' && section.id === 'storyboard')) return section
    return { ...section, items: rebuilt }
  })
  return { ...content, sections }
}

// ===== 稳定哈希 =====

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const SHA256_H_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text)
  const withPadding = ((data.length + 9 + 63) >> 6) << 6
  const padded = new Uint8Array(withPadding)
  padded.set(data)
  padded[data.length] = 0x80
  const bitLength = data.length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(withPadding - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(withPadding - 4, bitLength >>> 0)

  const hash = SHA256_H_INIT.slice()
  const w = new Uint32Array(64)
  const add = (x: number, y: number) => (x + y) >>> 0
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0

  for (let offset = 0; offset < withPadding; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = add(add(w[i - 16], s0), add(w[i - 7], s1))
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = add(add(add(add(h, s1), ch), SHA256_K[i]), w[i])
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = add(s0, maj)
      h = g; g = f; f = e
      e = add(d, temp1)
      d = c; c = b; b = a
      a = add(temp1, temp2)
    }
    hash[0] = add(hash[0], a)
    hash[1] = add(hash[1], b)
    hash[2] = add(hash[2], c)
    hash[3] = add(hash[3], d)
    hash[4] = add(hash[4], e)
    hash[5] = add(hash[5], f)
    hash[6] = add(hash[6], g)
    hash[7] = add(hash[7], h)
  }
  return Array.from(hash, value => value.toString(16).padStart(8, '0')).join('')
}

/** 稳定键序 JSON（canonicalJSON）：对象键排序，数组保持顺序。 */
function canonicalJsonStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJsonStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** sha256(canonicalJSON({chapterTitle, docPreamble, sections}))，hex（契约 §3）。 */
export function computeBlueprintV2ContentHash(content: ChapterBlueprintV2Content): string {
  return sha256Hex(canonicalJsonStringify({
    chapterTitle: content.chapterTitle,
    docPreamble: content.docPreamble,
    sections: content.sections,
  }))
}

/** `custom-<8hex>`：标题归一化文本的稳定哈希截断（契约 §3）。 */
export function customBlueprintV2SectionId(title: string): string {
  return `custom-${sha256Hex(normalizeBlueprintV2SectionTitle(title)).slice(0, 8)}`
}

// ===== v1 投影（契约 §6.3，冻结） =====

/** 去掉与目标章号一致的 `第N章` 前缀及随后的 `｜:：、.-` 分隔符（样例 → "接错的人"）。 */
export function deriveV1TitleFromChapterTitle(chapterTitle: string, chapterNumber: number): string {
  if (!chapterTitle) return ''
  const pattern = new RegExp(`^\\s*第\\s*${chapterNumber}\\s*章\\s*[｜|:：、.\\-]\\s*`, 'u')
  const stripped = chapterTitle.replace(pattern, '').trim()
  if (stripped) return stripped
  // 「第N章」后没有分隔符也没有正文（或整串就是章号）→ 视为空推导。
  return new RegExp(`^\\s*第\\s*${chapterNumber}\\s*章\\s*$`, 'u').test(chapterTitle) ? '' : chapterTitle.trim()
}

function stripFieldLabelPrefix(markdown: string, label: string): string {
  const lines = markdown.split('\n')
  const first = lines[0] ?? ''
  const marker = /^(\s*)(?:[-*+]|\d+[.)])\s+/.exec(first)
  const withoutMarker = marker ? first.slice(marker[0].length) : first.trimStart()
  const labelPattern = new RegExp(`^\\*\\*\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*\\*\\s*[：:]?\\s*`, 'u')
  const withoutLabel = withoutMarker.replace(labelPattern, '')
  return [withoutLabel, ...lines.slice(1)].join('\n').replace(/^\n+/, '').trim()
}

/** field 条目正文文本：剥掉行首列表标记与 `**标签**：` 前缀。 */
export function blueprintV2FieldText(item: BlueprintV2FieldItem): string {
  return stripFieldLabelPrefix(item.markdown, item.label)
}

/**
 * v2 → v1 只读投影（契约 §6.3）。推导值为空时保持旧值（"新字段为空不抹旧字段"）。
 * 永不投影：role / characters / volume_id / userGuidance / notes / notes_updated_at。
 */
export function projectV2ToV1(
  content: ChapterBlueprintV2Content,
  current: BlueprintData,
): Pick<BlueprintData, 'title' | 'purpose' | 'keyEvents' | 'suspenseHook'> {
  const positioning = findBlueprintV2CanonicalSection(content, 'positioning')
  const missionField = positioning?.items.find(
    (item): item is BlueprintV2FieldItem => item.kind === 'field' && item.label === '核心使命',
  )
  const cliffhanger = findBlueprintV2CanonicalSection(content, 'cliffhanger')
  const hookField = cliffhanger?.items.find(
    (item): item is BlueprintV2FieldItem => item.kind === 'field' && item.label === '章末钩子',
  )
  const hookLines = (hookField ? blueprintV2FieldText(hookField) : '')
    .split('\n')
    .map(line => line.replace(/^\s*>\s?/u, '').trimEnd())
    .filter(line => line.trim().length > 0)
  const sceneTitles = getBlueprintV2Scenes(content).map(scene => scene.title)

  const derivedTitle = deriveV1TitleFromChapterTitle(content.chapterTitle, content.chapterNumber)
  const derivedPurpose = missionField ? blueprintV2FieldText(missionField) : ''
  const derivedKeyEvents = sceneTitles.join('\n')
  const derivedSuspenseHook = hookLines.join('\n')

  return {
    title: derivedTitle || current.title,
    purpose: derivedPurpose || current.purpose,
    keyEvents: derivedKeyEvents || current.keyEvents,
    suspenseHook: derivedSuspenseHook || current.suspenseHook,
  }
}

/** positioning 分区「正文字数预算」→ 数字（契约 §3 Summary.wordBudget）。 */
export function extractBlueprintV2WordBudget(content: ChapterBlueprintV2Content): number | null {
  const positioning = findBlueprintV2CanonicalSection(content, 'positioning')
  if (!positioning) return null
  const budgetField = positioning.items.find(
    (item): item is BlueprintV2FieldItem => item.kind === 'field' && item.label === '正文字数预算',
  )
  if (!budgetField) return null
  const match = blueprintV2FieldText(budgetField).match(/(\d[\d,，]*)/)
  if (!match) return null
  const value = Number.parseInt(match[1].replace(/[,，]/g, ''), 10)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

// ===== 内容校验（保存前的防线；契约 §7.1 超限/类型错零写入） =====

function assertItemShape(item: BlueprintV2SectionItem, sectionTitle: string): void {
  if (!item || typeof item !== 'object') throw new Error(`细纲条目无效（分区：${sectionTitle}）`)
  if (typeof item.id !== 'string' || !item.id) throw new Error(`细纲条目缺少 ID（分区：${sectionTitle}）`)
  if (item.kind === 'scene') {
    if (typeof item.title !== 'string' || item.title.length > MAX_BLUEPRINT_V2_SCENE_TITLE) {
      throw new Error(`分镜标题超限（≤${MAX_BLUEPRINT_V2_SCENE_TITLE} 字符）`)
    }
    if (typeof item.markdown !== 'string' || item.markdown.length > MAX_BLUEPRINT_V2_SCENE_MARKDOWN) {
      throw new Error(`分镜「${item.title}」正文超限（≤${MAX_BLUEPRINT_V2_SCENE_MARKDOWN} 字符）`)
    }
    if (item.presence !== 'on-canvas' && item.presence !== 'off-canvas') {
      throw new Error(`分镜「${item.title}」的画布状态无效`)
    }
    return
  }
  if (typeof item.markdown !== 'string' || item.markdown.length > MAX_BLUEPRINT_V2_SCENE_MARKDOWN) {
    throw new Error(`分区「${sectionTitle}」有条目正文超限（≤${MAX_BLUEPRINT_V2_SCENE_MARKDOWN} 字符）`)
  }
}

/** 保存前的结构性校验：只拒绝超限/类型错，不试图理解内容（契约 §4.1.6 精神）。 */
export function assertValidChapterBlueprintV2Content(content: ChapterBlueprintV2Content): void {
  if (!content || typeof content !== 'object') throw new Error('章节细纲内容无效')
  if (content.schemaVersion !== BLUEPRINT_V2_SCHEMA_VERSION) {
    throw new Error(`章节细纲 schema 版本不支持：${String(content.schemaVersion)}`)
  }
  if (!Number.isSafeInteger(content.chapterNumber) || content.chapterNumber < 1) {
    throw new Error('章节细纲章节号无效')
  }
  if (typeof content.chapterTitle !== 'string') throw new Error('章节细纲章题无效')
  if (typeof content.docPreamble !== 'string') throw new Error('章节细纲前导内容无效')
  if (!Array.isArray(content.sections)) throw new Error('章节细纲分区列表无效')
  if (content.chapterTitle.length > MAX_BLUEPRINT_V2_SCENE_TITLE) {
    throw new Error(`章题超限（≤${MAX_BLUEPRINT_V2_SCENE_TITLE} 字符）`)
  }
  if (content.docPreamble.length > MAX_BLUEPRINT_V2_SCENE_MARKDOWN) {
    throw new Error(`章节细纲前导内容超限`)
  }
  for (const section of content.sections) {
    if (section.kind === 'custom') {
      if (typeof section.title !== 'string' || typeof section.body !== 'string') {
        throw new Error('未归类分区内容无效')
      }
      if (section.body.length > MAX_BLUEPRINT_V2_SCENE_MARKDOWN) {
        throw new Error(`未归类分区「${section.title}」正文超限`)
      }
      continue
    }
    if (!isBlueprintV2SectionId(section.id)) throw new Error(`未知的规范分区：${String(section.id)}`)
    if (typeof section.title !== 'string' || typeof section.preamble !== 'string'
      || typeof section.postamble !== 'string' || !Array.isArray(section.items)) {
      throw new Error(`规范分区「${section.title}」内容无效`)
    }
    for (const item of section.items) assertItemShape(item, section.title)
  }
}

// ===== v1 → v2 显式升级脚手架（契约 §7.4） =====

/**
 * 渐进升级：storyboard 留空（禁止把 keyEvents 节拍伪造成分镜），role/
 * characters/userGuidance 以 custom 分区逐字保存；v1 字段一律不动。
 */
export function buildBlueprintV2UpgradeScaffold(v1: BlueprintData): ChapterBlueprintV2Content {
  const chapterTitle = v1.title ? `第${v1.chapterNumber}章｜${v1.title}` : `第${v1.chapterNumber}章`
  const positioning: BlueprintV2Section = {
    kind: 'canonical',
    id: 'positioning',
    title: '【本章定位与四维指标】',
    level: 4,
    preamble: '',
    items: [
      ...(v1.purpose.trim()
        ? [{
          kind: 'field' as const,
          id: createBlueprintV2ItemId(),
          label: '核心使命',
          markdown: `- **核心使命**：${v1.purpose.trim()}`,
        }]
        : []),
      ...(v1.suspenseHook.trim()
        ? [{
          kind: 'field' as const,
          id: createBlueprintV2ItemId(),
          label: '番茄追读钩子',
          markdown: `- **番茄追读钩子**：${v1.suspenseHook.trim()}`,
        }]
        : []),
    ],
    postamble: '',
  }
  const storyboard: BlueprintV2Section = {
    kind: 'canonical',
    id: 'storyboard',
    title: '【逐场分镜拆解】',
    level: 4,
    preamble: '',
    items: [],
    postamble: '',
  }
  const legacyLines = [
    v1.role.trim() ? `- **章节定位（role）**：${v1.role.trim()}` : '',
    v1.characters.length > 0 ? `- **出场角色（characters）**：${v1.characters.join('、')}` : '',
    v1.userGuidance.trim() ? `- **作者微操指导（userGuidance）**：${v1.userGuidance.trim()}` : '',
  ].filter(Boolean)
  const legacyArchive: BlueprintV2Section = {
    kind: 'custom',
    id: customBlueprintV2SectionId('旧版简纲字段（升级存档）'),
    title: '【旧版简纲字段（升级存档）】',
    level: 4,
    body: legacyLines.length > 0 ? `${legacyLines.join('\n')}\n` : '',
  }
  const sections: BlueprintV2Section[] = [positioning]
  for (const entry of BLUEPRINT_V2_CANONICAL_SECTIONS) {
    if (entry.id === 'positioning') continue
    if (entry.id === 'storyboard') {
      sections.push(storyboard)
      continue
    }
    sections.push({
      kind: 'canonical',
      id: entry.id,
      title: `【${entry.title}】`,
      level: 4,
      preamble: '',
      items: [],
      postamble: '',
    })
  }
  sections.push(legacyArchive)
  return {
    schemaVersion: BLUEPRINT_V2_SCHEMA_VERSION,
    chapterNumber: v1.chapterNumber,
    chapterTitle,
    chapterTitleLevel: 3,
    docPreamble: '',
    sections,
    origin: 'upgrade',
  }
}
