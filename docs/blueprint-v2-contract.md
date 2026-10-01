# 章节蓝图 v2 契约（blueprint-v2-contract）

> 状态：**冻结**（任务 0 产出）。任务 A～E 必须遵守本文档的数据结构、版本、ID、读写与兼容规则，**禁止各自另设计一套格式**。
> 发现契约缺口时：在本文档 §13 登记 + 通知集成任务协调，不得自行发明不兼容字段。
> 验收样例：`test/fixtures/blueprint-v2/chapter-01.md`（《第1章｜接错的人》完整细纲原文，逐字保存）。

---

## 0. 任务范围与红线

- 本契约只定义跨模块契约与验收样例，不含业务实现。任务 A～E 从**包含本契约的同一基线**开工，各自使用独立 worktree/分支，不得在主工作树并发编辑。
- 主工作树现有与本任务无关的未提交修改/删除（如 `src/components/editor/ChapterOutlineSidebar.tsx` 的删除），任何任务不得重置、恢复或顺手修改它们。
- 全程红线（重复出现于各节，这里先总述）：
  1. `blueprints.notes` 是**定稿后实际章节记录**（`finalize-chapter.command.ts:389` 定稿流程写入，UI 标注"定稿后自动生成"），蓝图导入/编辑**永不写它**，也永不写 `notes_updated_at`、`user_guidance`。
  2. 分镜正文属于**章节蓝图（内容权威）**；章节画布是同一批分镜的**编排视图**；剧情画布是跨章节工具，`plot_canvas_*` 表不得出现任何 v2 分镜数据。
  3. 不得改写用户小说内容：解析、存储、导出对未编辑内容逐字保留（仅允许统一换行符归一化）。
  4. 已有人工/导入细纲的章节，AI 生成流程不得静默覆盖（§7.4）。

---

## 1. 实测现状（任务 0 勘察结论，A～E 共享同一地图）

以下为 2026-09-30 在工作区实际读取的调用链，禁止凭旧报告臆测。

### 1.1 蓝图 v1 数据链

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 表 | `electron/database.ts:291` | `blueprints(chapter_number PK, volume_id, title, role, purpose, key_events, characters JSON, suspense_hook, user_guidance, notes, notes_updated_at, …)` |
| 仓库 | `electron/repositories/blueprint-repository.ts` | `BlueprintData`（:31）、`commitRange`（:684，幂等操作账本）、`updateNotes`（:883） |
| IPC | `src/shared/ipc-channels.ts:985-1013` | `db:blueprint-get-all / -volume-list / -volume-upsert / -get / -upsert / -upsert-many / -commit-range / -character-sync-* / -update-notes / -delete / -clear-all`，处理器在 `electron/controllers/db-controller.ts:550-660` |
| 编辑器 | `src/components/editor/ChapterCardEditor.tsx` | ROLES 词表（:70）`建置/铺垫/发展/冲突/高潮/转折/收尾`；可编辑字段 title/volumeId/role/characters/purpose/keyEvents/suspenseHook/userGuidance/notes（:1249-1370）；:899 自述"逐章细纲……章节号是稳定标识" |
| AI 生成 | `src/shared/blueprint-semantic-contract.ts` | `BlueprintSemanticItem`（title/role/purpose/keyEvents/characters/newCharacterCandidates/relationshipHints/suspenseHook），输出长度上限见 :18 MANIFEST |
| 提交入口 | `src/services/workflows/directory-workflow.ts:182`、`src/services/workflows/commands/import-novel.command.ts:833` | 走 `db:blueprint-commit-range` / `db:blueprint-upsert(-many)` |
| 智能体提案 | `src/services/agent/tools/propose-chapter-blueprint.tool.ts` | 用户批准后 `db:blueprint-upsert` 全量合并写回 |

### 1.2 写作调用链（对 v1 字段的消费）

- `src/services/chapter-context.ts`：写作侧栏 `loadChapterContext`（:140）读 `db:blueprint-get` + `db:chapter-canvas-get`；`splitChapterBeats(keyEvents)`（:85）按 **换行与 `；`/`;`** 拆节拍。
- `src/services/workflows/commands/generate-draft.command.ts`：prompt 注入"必需事件"（keyEvents）、"章节钩子"（suspenseHook）、"作者本章指导"（userGuidance，:561 `.withUserGuidance(...)` 注入为最高优先级，:646-648）。
- `src/services/auto-next-chapter.ts`：下一章生成携带 `keyEvents/userGuidance`。

### 1.3 章节画布（编排视图）

- 共享契约 `src/shared/chapter-canvas.ts`：节点类型 `scene/character/foreshadow/idea/snippet`（:31）；场景定位词表与蓝图 ROLES 一致（:119）；上限 title≤160、summary≤2000、节点≤200（:114-117）；画布 ID `cha-<n>`、节点 `ccn-<uuid>`。
- 红线原文（:7-12）：**"场景卡是编排单元，不持有正文"**；引用失效只显示状态，绝不反向改写权威资料。仓库层 `chapter-canvas-repository.ts`：删卡"绝不触碰权威资料"（:253）、场景卡之间禁止连线，主线顺序由 `scene_order` 表达（:318）。
- IPC：`db:chapter-canvas-get / -viewport-save / -node-upsert / -node-delete / -nodes-reposition / -edge-upsert / -edge-delete`（`src/shared/ipc-channels.ts:1322-1328`）。
- 结论：**v1 时代画布场景卡与蓝图互不感知**（`ChapterCanvasWorkbench.tsx:269` 删卡提示"蓝图与正文不受影响"）。v2 的联动是**新增能力**，见 §8。

### 1.4 一致性检查

- `src/shared/consistency-preflight.ts`：`findBlueprintContinuityRisks`（:84）——定稿事实 vs 蓝图出场角色的确定性预检，产出 `severity: 'warning'` 的**证据**，"Findings are evidence, never a writing prohibition"。
- `BlueprintForPreflight`（:24）消费 v1 字段 + `notes`。v2 检查条目是**新增层**，见 §10。

### 1.5 关键既有语义（冻结，不得改变）

- `blueprints.notes` = 定稿后章节要点（自动生成，可提前人工填写作 AI 参考）；`user_guidance` = 作者微操指导，写稿时最高优先级；`role` ∈ ROLES 词表。
- 章节号 `chapter_number` 是项目内稳定标识；蓝图与正文草稿不共用存储。

---

## 2. 术语与权威边界

| 概念 | 权威载体 | 说明 |
| --- | --- | --- |
| 章节蓝图 v2（细纲内容） | `blueprint_details.detail_json`（结构化）+ `raw_markdown`（原文） | **分镜正文、规则、禁忌、检查条目的唯一权威** |
| 蓝图 v1 字段（title/purpose/keyEvents/suspenseHook） | `blueprints` 表 | v2 存在时是 v2 的**只读投影**（§6.3）；v2 不存在时仍由 v1 流程写 |
| `userGuidance` | `blueprints.user_guidance` | 永远是作者手工字段，v2 不投影、不覆盖 |
| `notes` | `blueprints.notes` | 定稿后实际记录，v2 永不触碰（红线 1） |
| 章节画布 | `chapter_canvases/nodes/edges` | 同一批分镜的**编排视图**：卡片持有标题快照与短摘要，正文始终通过 `refs.sceneId` 指向蓝图分镜 |
| 剧情画布 | `plot_canvases/nodes/edges` | 跨章节剧情工具，与 v2 无数据交集（红线 2） |

---

## 3. 数据结构（冻结）

唯一权威类型模块：`src/shared/blueprint-v2.ts`（任务 A 拥有；B/C/D/E **只许 import，不许复制/分叉定义**）。以下类型与常量为冻结契约，字段只增不改名，新增字段必须可选。

```ts
// src/shared/blueprint-v2.ts
export const BLUEPRINT_V2_SCHEMA_VERSION = 2

/** 分镜 ID 前缀（复用 src/shared/canvas-ids.ts 的随机 UUID 机制）。 */
export const BLUEPRINT_V2_SCENE_ID_PREFIX = 'bps'      // 形如 bps-<uuid>
export const BLUEPRINT_V2_CHECK_ID_PREFIX = 'bpc'      // 形如 bpc-<uuid>

/** 防失控上限（远高于验收样例 ~2.8K 字符；防止粘贴失控而非限制正常内容）。 */
export const MAX_BLUEPRINT_V2_SCENE_TITLE = 160
export const MAX_BLUEPRINT_V2_SCENE_MARKDOWN = 100_000
export const MAX_BLUEPRINT_V2_RAW_MARKDOWN = 400_000

/** 七个一级部分的注册表（顺序 = 新建文档的规范顺序；解析时按文档实际顺序保留）。 */
export const BLUEPRINT_V2_CANONICAL_SECTIONS = [
  { id: 'positioning', title: '本章定位与四维指标' },
  { id: 'conflict',    title: '核心矛盾与博弈结构' },
  { id: 'storyboard',  title: '逐场分镜拆解' },
  { id: 'rules',       title: '超凡物理与规则交互细节' },
  { id: 'cliffhanger', title: '章末爆点与断章定格' },
  { id: 'foreshadow',  title: '线索埋设与伏笔自检' },
  { id: 'taboos',      title: '写作禁忌与防坑自检' },
] as const

export type BlueprintV2SectionId =
  | 'positioning' | 'conflict' | 'storyboard' | 'rules'
  | 'cliffhanger' | 'foreshadow' | 'taboos'

/** 检查语义（§10）。 */
export type BlueprintV2CheckMode = 'must' | 'reference' | 'forbid'   // 必达 | 参考 | 禁写

export interface BlueprintV2SceneItem {
  kind: 'scene'
  id: string                       // bps-<uuid>，跨编辑/拖动/重排稳定
  level: number                    // 分镜标题的标题级（样例为 5，即 #####）
  title: string                    // 标题行原文（含「场景一：」编号），永不改写编号文字
  markdown: string                 // 标题行后到下一标题前的全部正文，逐字保留（小标题各异、嵌套列表原样）
  presence: 'on-canvas' | 'off-canvas'   // 移出画布切换此值；删除分镜才是移除条目
  canvasNodeId?: string            // presence='on-canvas' 时指向 ccn- 节点；允许悬空（§8.4）
}

/** 已识别的具名字段条目：首个形如 `- **标签**：` 的列表项。markdown 含该行原文与嵌套子列表，逐字保留。 */
export interface BlueprintV2FieldItem {
  kind: 'field'
  id: string                       // bpc- 之外的普通 uuid 条目 ID（bps- 前缀仅用于分镜）
  label: string                    // 标签原文，如「核心使命」「源-锚-桥-能参数」「视觉定格」「新线索」
  markdown: string
}

/** 未识别的列表条目（无粗体标签的普通列表项），逐字保留。 */
export interface BlueprintV2BulletItem {
  kind: 'bullet'
  id: string
  label: string | null
  markdown: string
  /** 仅 foreshadow / taboos 分区携带；其余分区必须为 undefined（§10）。 */
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
      /** additive：规范分区标题行的标题级（2–4），缺省时按原契约标题级处理。 */
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
  /** additive：章题行的标题级（1–3）；缺省时序列化为 ###。 */
  chapterTitleLevel?: number
  /** additive：章题行后、首个分区前的原文，导入、保存、读取和导出都必须保留。 */
  chapterPostamble?: string
}

export interface ChapterBlueprintV2Detail extends ChapterBlueprintV2Content {
  revision: number             // 服务端维护：每章从 1 起，成功保存 +1
  contentHash: string          // sha256(canonicalJSON(章题、存在时的标题级、存在时的章题后正文、前导正文与分区))，hex
  createdAt?: string
  updatedAt?: string
}

/** 轻量摘要（§5.2）：绝不含分镜正文 / rawMarkdown。 */
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
  /** 乐观并发：0 = 期望不存在；否则必须等于当前 revision（§7.2）。 */
  baseRevision: number
  content: ChapterBlueprintV2Content
}
```

`src/shared/blueprint-v2.ts` 还必须提供以下**纯函数**（实现归 A，签名冻结）：

```ts
export function createBlueprintV2SceneId(): string
export function createBlueprintV2ItemId(): string
export function normalizeBlueprintV2SectionTitle(title: string): string  // 去空白与【】
export function getBlueprintV2Scenes(detail: ChapterBlueprintV2Content): Array<{
  sceneId: string; order: number /* 1 起稠密 */; title: string; markdown: string;
  presence: 'on-canvas' | 'off-canvas'; canvasNodeId?: string
}>                                                            // storyboard 分区 scene 条目的扁平视图
export function moveBlueprintV2Scene(content: ChapterBlueprintV2Content, sceneId: string, toOrder: number): ChapterBlueprintV2Content
// 仅调整该 scene 条目在 storyboard.items 中的位次，其余条目相对连续性不变；越界时夹取
export function computeBlueprintV2ContentHash(content: ChapterBlueprintV2Content): string
export function projectV2ToV1(content: ChapterBlueprintV2Content, current: BlueprintData):
  Pick<BlueprintData, 'title' | 'purpose' | 'keyEvents' | 'suspenseHook'>   // §6.3
```

---

## 4. Markdown 导入/导出契约（任务 B）

实现模块：`src/shared/blueprint-v2-markdown.ts`，**只 import `src/shared/blueprint-v2.ts` 的类型**。全部为纯函数，不触 IPC、不触 DB。

### 4.1 解析 `parseChapterBlueprintMarkdown(md: string)`

1. 输入超 `MAX_BLUEPRINT_V2_RAW_MARKDOWN` 或非字符串 → 抛错（附长度），**不产生任何写入**。
2. 结构切分：按标题行（`^#{1,6}\s`）切段。首个 H1–H3 标题若匹配 `第…章` 模式 → `chapterTitle` 原文 + `suggestedChapterNumber`（仅建议，映射到哪章由调用方决定；建议号与目标章不一致时是**警告不是错误**）。
3. 一级分区识别：H2–H4 标题，`normalizeBlueprintV2SectionTitle` 后与注册表精确相等 → `canonical` 分区（`title` 保留原文含【】）；其余 H2–H4 标题 → `custom` 分区，`body` 逐字保留。
4. canonical 分区内条目识别（按原文顺序）：
   - **storyboard**：更深一级标题（样例 `#####`）且标题文本以 `场景` 开头 → `scene` 条目（`title` = 标题行 `#` 后的原文，`markdown` = 标题行后到下一标题前的全部内容）。**不要求编号连续，不重排、不改写编号文字**（拖动后允许出现"场景三"排在第二位——编号是小说内容的一部分）。
   - 任意 canonical 分区：列表项首行匹配 `**(.+?)**[：:]` → `field`（label 原文；嵌套子列表整块并入 markdown 逐字保留——样例中"源-锚-桥-能参数"的源/锚/桥/能/错误参数子列表、"对白推进"的五条周晓/许渡对白子列表都靠这条保真）。
   - 其余列表项 → `bullet`；非列表连续块 → `block`。
   - 分区内**任何识别不了的内容都不丢弃**：落在条目之间无法归属时归并到最近的 `block`/`preamble`/`postamble`。
5. 检查语义推断（仅 foreshadow / taboos 分区的 field/bullet 条目，§10.2）。
6. 解析**永不因"看不懂"而失败**（看不懂 = 原样保留）；只因超限/类型错误而失败。

### 4.2 序列化 `serializeChapterBlueprintV2(content): string`

1. `docPreamble` → `chapterTitle` 行（原文）→ 依序输出各分区：标题行原文 + `preamble` + 条目 + `postamble`。
2. `scene` 条目输出 `'#'.repeat(level) + ' ' + title` + 换行 + `markdown`；`field`/`bullet`/`block` 输出 markdown 原文；`custom` 输出标题行 + `body`。
3. `presence`/`canvasNodeId`/`check`/各条目 `id` 是应用元数据，**不写入 Markdown**（避免向小说内容添加标记）。由此产生的已知限制：导出文件再导入后，用户手工调整过的 check mode 会回到推断值——主数据在 DB 的 `detail_json` 中，应用内永不丢失；若未来需要文件级保留 mode，走 sidecar JSON，**不得往正文里插标记**。
4. **无损自检 `assertNoLossOnSerialize(content)`（B 必须实现并在每次导出前调用）**：serialize → 再 parse → 逐项比对：每个 custom `body`、每个条目 `markdown`、每个 scene `title`/`markdown`/`level` 完全相等（仅允许 CRLF→LF 归一化）；不等则抛错并给出分区/条目 id。禁止把未通过自检的导出结果交给用户。

### 4.3 重复导入

1. 目标章已有 v2 细纲时，导入必须先出**预览差异**：分区级（标题匹配→更新/新增/移除）+ 分镜级匹配。
2. 分镜匹配规则（冻结）：`normalizeBlueprintV2SectionTitle(scene.title)` 相等（且章号相同）→ 沿用**旧 scene id**（画布链接因此存活）；旧有新无 → 列入"将被移除"，逐条展示原文；新有旧无 → 分配新 id。
3. 应用 = 用户确认后以 `baseRevision = 当前 revision` 走 `db:blueprint-v2-save`；取消 = 零写入。禁止静默合并、禁止未经确认的整章替换。

---

## 5. 存储与迁移（任务 A）

### 5.1 表

`electron/database.ts` 新增（沿用库内 `CREATE TABLE IF NOT EXISTS` 惯例）：

```sql
CREATE TABLE IF NOT EXISTS blueprint_details (
  chapter_number INTEGER PRIMARY KEY,          -- 与 blueprints.chapter_number 一一对应
  schema_version INTEGER NOT NULL DEFAULT 2,
  detail_json   TEXT NOT NULL,                 -- ChapterBlueprintV2Detail 的 canonical JSON（含 rawMarkdown 同值的结构化部分）
  raw_markdown  TEXT NOT NULL,                 -- 最近一次导入/规范导出的完整原文，逐字，供核对
  revision      INTEGER NOT NULL,              -- 冗余列：免解析 JSON 的乐观并发/摘要读取
  content_hash  TEXT NOT NULL,                 -- 冗余列：同上
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
```

- `blueprints` 表**不加列、不改列**；v1 读取方零迁移风险。
- 写入事务：同一事务内写 `blueprint_details` + 按 §6.3 更新 `blueprints` 投影列。
- 读取容错：`detail_json` 损坏或 `schema_version > BLUEPRINT_V2_SCHEMA_VERSION` 时，读取接口返回 `corrupt`/`needs-newer-app` 状态并**附上 `raw_markdown` 原文**，绝不静默丢弃；只有 §7.3 的显式删除能清掉该行。
- 完整性哈希覆盖所有可见文档内容：基础字段为 `chapterTitle`、`docPreamble`、`sections`；存在时还包括 `chapterTitleLevel` 与 `chapterPostamble`。省略的可选字段不进入 canonical JSON，兼容未设置它们的旧 detail。

### 5.2 轻量列表与单章完整读取（冻结的读写粒度）

- 列表场景（大纲分组、画布入口、导入向导等）一律用 `db:blueprint-v2-summary-list`：主进程解析 JSON 后只返回 `ChapterBlueprintV2Summary`，**载荷中不得出现分镜正文与 rawMarkdown**。
- 单章编辑/写作组装才允许 `db:blueprint-v2-get` 拉全量。禁止新增"一次返回所有章完整细纲"的通道。

### 5.3 最终读取行为

- `db:blueprint-v2-get` 的实现读取类型为 additive 的 `ChapterBlueprintV2DetailRead | null`：正常读取返回 detail、revision 与 contentHash；损坏或需要较新应用时返回 `readStatus`、存储的 `rawMarkdown` 与可选 `storedSchemaVersion`，不得降级成 v1 简纲。
- 章节上下文侧栏与 Agent 的单章 `read_blueprint` 使用完整 detail 无损重建 Markdown；序列化自检失败时不得把可能丢字的结构化结果展示或交给 Agent。异常读取仅可展示存储的 `rawMarkdown` 并标明状态。Agent 不带章号时只能读有界摘要，不含分镜正文。
- 一致性审查只读取草稿 `drafts.blueprint_chapter_number` 绑定的章节；启动时冻结该 detail 的 `chapterNumber/revision/contentHash`。报告中的分镜、禁忌与正文证据必须来自同一份冻结蓝图和同一份正文快照。
- `chapterPostamble` 是章节 Markdown 的可见原文，不是应用元数据：解析、结构化存储、无损序列化、全文读取和导出都须保留它；修改它必须改变 contentHash。

---

## 6. IPC 契约（任务 A；加入 `src/shared/ipc-channels.ts` + `electron/controllers/db-controller.ts`，沿用 `expectedProjectPath` 会话校验惯例）

```ts
'db:blueprint-v2-get': {
  args: [chapterNumber: number, expectedProjectPath: string]
  return: ChapterBlueprintV2Detail | null       // null = 该章暂无 v2 细纲（v1 字段照常可用）
}
'db:blueprint-v2-summary-list': {
  args: [expectedProjectPath: string]
  return: ChapterBlueprintV2Summary[]           // 仅含已有 v2 的章；v1-only 章缺席即 hasDetail=false
}
'db:blueprint-v2-save': {
  args: [input: ChapterBlueprintV2SaveInput, expectedProjectPath: string]
  return: { success: boolean; revision?: number; contentHash?: string;
            conflict?: boolean; currentRevision?: number; error?: string }
}
'db:blueprint-v2-scene-order-save': {
  args: [input: { chapterNumber: number; baseRevision: number; orderedSceneIds: string[] },
         expectedProjectPath: string]
  return: 同 save                               // 拖动专用：仅改 storyboard 条目位次（§8.3）
}
'db:blueprint-v2-delete': {
  args: [chapterNumber: number, expectedProjectPath: string]
  return: { success: boolean; error?: string }  // 仅删 detail 行；blueprints v1 字段不动（§8.2）
}
```

### 6.3 投影规则（`projectV2ToV1`，冻结）

v2 保存成功时，**同一事务**内更新 `blueprints` 的且仅更新以下四列（推导值为空 → 保持旧值，即"新字段为空不抹旧字段"）：

| v1 列 | 推导 |
| --- | --- |
| `title` | `chapterTitle` 去掉与目标章号一致的 `第N章` 前缀及随后的 `｜:：、.-` 分隔符（样例 → "接错的人"）；无章题则不动 |
| `purpose` | positioning 分区 label=「核心使命」的 field 正文文本 |
| `keyEvents` | **分镜标题逐行拼接**（每行一个分镜 title，按 order；不加工、不摘要——写作侧 `splitChapterBeats` 恰好按行拆回节拍） |
| `suspenseHook` | cliffhanger 分区 label=「章末钩子」field 正文中的引用行文本，按行拼接 |

永不投影：`role`（v2 无对应概念，不猜）、`characters`（v2 无显式清单，**禁止从正文抽取**）、`volume_id`、`user_guidance`、`notes`、`notes_updated_at`。

---

## 7. 行为语义：并发 / 失败 / 升级 / 覆盖防护

### 7.1 失败

- 解析失败（超限/类型错）：零写入，错误含行号或长度。
- 保存失败（DB 错误、投影回读不一致）：事务回滚，`revision` 不变，错误原样上抛给 UI。
- 读取失败与"细纲不存在"必须可区分（沿用 `chapter-context.ts` 的 `load-error` vs `target-missing` 模式）。

### 7.2 并发修改

- 乐观并发：`baseRevision` ≠ 当前 `revision` → 返回 `conflict: true` + `currentRevision`，**拒绝写入**。
- UI 收到 conflict 后重新 `get`，让用户选择：以最新为基底合并（B 的预览差异复用）/ 直接覆盖（覆盖 = 以最新 `revision` 为 `baseRevision` 再存，必须经用户显式确认）。
- 画布侧的拖动重排走 `scene-order-save`，同样携带 `baseRevision`；冲突时画布刷新分镜顺序，不自动重放旧顺序。

### 7.3 删除与重复导入

- 删除 v2 细纲 = 独立的用户动作（UI 二次确认），只删 `blueprint_details` 行；`blueprints` v1 字段保持删除前的投影值，画布卡片保留（其 `refs.sceneId` 悬空显示"引用失效"，§8.4）。
- 重复导入按 §4.3 执行。

### 7.4 升级与 AI 覆盖防护（红线 4）

- **渐进升级**：v1-only 章可由用户显式"升级为 v2"（`origin: 'upgrade'`）：生成章节脚手架——`chapterTitle = 第N章｜<title>`、positioning 的核心使命←purpose、番茄追读钩子←suspenseHook、storyboard **留空**（**禁止把 keyEvents 节拍伪造成分镜**），另建 custom 分区逐字保存 role/characters/userGuidance 旧值以便细纲界面可见；`rawMarkdown` = serialize 结果；v1 字段一律不动。
- **AI 覆盖防护**：A 在仓库层提供 `BlueprintDetailRepository.chaptersWithDetails(chapterNumbers: number[]): Set<number>`。所有会写 v1 字段的既有流程**必须先调用它过滤**，被跳过的章在流程结果中明示：
  - `directory-workflow.ts`（批量蓝图生成）→ 归属 C 的流程面；
  - `import-novel.command.ts`（导入小说）→ 归属 B 的流程面；
  - `propose-chapter-blueprint.tool.ts`（智能体提案）→ 归属 E：目标章有 v2 时 diff 面板必须提示"该章已有 v2 细纲，此提案会覆盖其投影字段"。
  - 用户**显式选择"替换细纲"**时，流程先调 `db:blueprint-v2-delete` 再写 v1，不得绕行。
- 例外说明：`db:blueprint-upsert` / `db:blueprint-commit-range` 通道签名冻结、不加守卫参数，防护在调用方实施（已登记 §13 缺口 1）。

---

## 8. 章节画布联动（任务 D；`src/shared/chapter-canvas.ts` 唯一授权的增量修改）

### 8.1 引用字段（additive）

```ts
// ChapterCanvasNodeRefs 增加一个可选字段（D 拥有该文件此次修改，需与 A 协调）：
export interface ChapterCanvasNodeRefs {
  characterName?: string
  foreshadowingId?: string
  /** 蓝图 v2 分镜 ID（bps-…，≤80 字符不透明串）。悬空时画布只显示"引用失效"。 */
  sceneId?: string
}
```

`parseChapterCanvasNodeRefs` 相应放行该字段；其余解析行为不变。

### 8.2 「移出画布」≠「删除分镜」（冻结）

| 操作 | 蓝图 v2 | 章节画布 |
| --- | --- | --- |
| **移出画布** | 分镜条目**保留**，`presence: 'off-canvas'`，清空 `canvasNodeId` | 删除对应场景卡（画布侧删除本来就"蓝图与正文不受影响"）；顺序位次收缩由画布既有所然 |
| **删除分镜** | 从 storyboard 移除条目（**破坏性，UI 二次确认并展示原文**） | 关联的场景卡**不自动删除**：保留为普通卡，`refs.sceneId` 悬空 → 渲染"引用失效"徽标（沿用画布"引用失效只显示、不反向改写"红线）；D 可提供清理按钮 |
| **拖动** | 只改 storyboard 条目位次（= 分镜 order，§8.3） | 节点 x/y 走既有 `nodes-reposition`；`node.order` 镜像分镜 order |
| **排上画布** | `presence: 'on-canvas'` + 记录 `canvasNodeId` | 新建场景卡：`type='scene'`、`title`=分镜标题快照（≤160 截断）、`order`=分镜 order、`refs.sceneId`=分镜 id；`summary` 保持画布侧手工字段（≤2000），**不自动灌入分镜正文** |

### 8.3 顺序权威

分镜 `order` 的唯一权威是 storyboard 条目位次（`getBlueprintV2Scenes().order`）。已关联卡片：拖动结束后 D 先调 `db:blueprint-v2-scene-order-save`，成功后把受影响卡片的 `node.order` 镜像为新值；加载时若发现镜像漂移，**以蓝图顺序为准**渲染主线，允许异步修复节点列。

### 8.4 边界

- 场景卡正文永不落地到画布表（summary≤2000 的既有上限即物理边界）；画布面板展示分镜全文时实时 `db:blueprint-v2-get` 按 id 取用。
- 悬空 `refs.sceneId` 不自动清除、不自动重挂；只在渲染层标示。
- 剧情画布零改动（红线 2）。

---

## 9. 写作输入的可见性（任务 E）

1. **优先级不变**：`userGuidance`（作者微操指导）仍是最高优先级注入；v2 各节不得凌驾其上。
2. v2 章的写作组装（`generate-draft.command.ts` 一线）在 detail 存在时注入，顺序：分镜全文（按 order，含各异小标题与对白）→ rules 分区条目 → cliffhanger（视觉定格 + 章末钩子）→ 冲突条目 → 检查条目（带 must/reference/forbid 标注）→ `wordBudget` 作为字数目标。
3. **规则与禁忌是约束不是题材**：prompt 固定脚手架必须声明——规则/禁忌约束事件与现象的走向；正文**不得**直接讲解世界观、系统、神明名号（与样例"正文只呈现石页摩擦与模糊书影，不出现任何旁白讲解"一致）。该脚手架文本是常量，不得由内容动态生成。
4. 投影字段照旧注入（keyEvents 节拍 = 分镜标题行）；同一消费方对同一章**只走一条注入路径**：detail 存在 → v2 路径；不存在 → 原 v1 路径。禁止两路同时注入造成重复。
5. `auto-next-chapter.ts` 继续消费投影字段，不需要改（由 A 的投影保证一致性）。

---

## 10. 一致性检查语义（任务 E；扩展现有层，不改变既有发现）

### 10.1 三种模式

| mode | 含义 | 检查行为 |
| --- | --- | --- |
| `must`（必达） | 作者明确标为必须达成的条目 | 未达成 → 产出 **warning 级证据**（沿用 `ConsistencyFinding`，绝不阻断写作/定稿） |
| `reference`（参考） | 背景信息 | 只作为上下文，**永不产生发现** |
| `forbid`（禁写） | 禁止出现的内容 | 正文命中 → 产出 warning 级证据 |

### 10.2 表示与推断（冻结）

- mode 存于条目元数据 `check.mode`；`source: 'explicit'`（用户在 UI 标注，或原文显式前缀 `【必达】/【参考】/【禁写】`）| `'inferred'`。
- 推断规则（词面匹配，仅限 foreshadow/taboos 分区）：含 `严禁/禁止/不得/不允许/切勿` → `forbid`；含 `必达/必须/务必/一定要` → `must`；**其余一律 `reference`**。
- **保守判负规则**：只有 `source='explicit'` 或字面含必达词的 `must` 条目可判"未达成"；`reference` 条目、rules 分区的环境细节、以及任何未标必达的内容，**不得仅凭正文字面缺失判失败**（样例中"新线索/主线咬合"两条即 reference）。
- 与 v1 预检的关系：`findBlueprintContinuityRisks` 行为不变；检查条目层是**附加**发现源，输出合并沿用 `mergeConsistencyFindingsIntoReview`。

---

## 11. 验收断言清单（A～E 的测试必须覆盖；fixture = `test/fixtures/blueprint-v2/chapter-01.md`）

1. `parseChapterBlueprintMarkdown(fixture)`：`chapterTitle === '第1章｜接错的人'`、`suggestedChapterNumber === 1`。
2. 七个 canonical 分区按文档顺序全部命中：positioning / conflict / storyboard / rules / cliffhanger / foreshadow / taboos，`title` 保留【】原文。
3. storyboard 恰好 4 个 scene 条目，title 逐字等于四条 `场景一：02:14的冷汗与声学隔离席` ～ `场景四：开出地图的末班车`。
4. 各分镜正文逐字保留**各不相同**的小标题集：场景一（时空与环境/动作与生理细节/心理流）、场景二（物证搜查/桌下异物/声学捕捉/有限研判）、场景三（冲突爆发/屏幕信息/动作定格）、场景四（对白推进 + 5 条嵌套对白子列表/边缘感应）；嵌套缩进逐字符保留。
5. positioning：`wordBudget === 4200`；核心使命/情绪曲线/番茄追读钩子原文非空，情绪曲线含 `（25度）` 与 `（98度）`。
6. rules：「源-锚-桥-能参数」field 的 5 条嵌套子项（源/锚/桥/能/错误参数）与「周晓的清醒机制」逐字保留。
7. cliffhanger：视觉定格原文；章末钩子含两行引用（含行尾硬换行空格）；投影 `suspenseHook` = 两行引用按 `\n` 拼接。
8. checks：taboos 两条 `forbid`（两条"严禁…"），foreshadow 两条 `reference`（新线索/主线咬合）。
9. `assertNoLossOnSerialize(serialize(parse(fixture)))` 通过；再 parse 后与首次 parse 的全部条目 markdown 相等。
10. 导入到第 1 章并保存后的投影：`title === '接错的人'`、`purpose` = 核心使命正文、`keyEvents` = 4 行分镜标题、`role/characters/userGuidance/notes` **与导入前完全一致**。
11. save→get 往返 `contentHash` 相等、revision+1；用过期 `baseRevision` 再存 → `conflict`。
12. `summary-list` 含该章：`sceneCount === 4`、`wordBudget === 4200`，载荷不含任何分镜正文/rawMarkdown。

---

## 12. 任务 A～E 最小接口、文件归属与交叉依赖

> 字母→能力的对应按任务书描述归属；若编排方字母分配不同，**以能力与文件归属为准**，接口签名不变。

### 12.1 归属表

| 任务 | 拥有文件（新建✚ / 修改✎） | 交付的最小接口 |
| --- | --- | --- |
| **A 数据与契约层** | ✚ `src/shared/blueprint-v2.ts`（§3 全部类型/常量/纯函数）；✚ `electron/repositories/blueprint-detail-repository.ts`；✎ `electron/database.ts`（blueprint_details DDL）；✎ `src/shared/ipc-channels.ts`、`electron/controllers/db-controller.ts`（§6 五通道） | §3 类型与纯函数；`BlueprintDetailRepository.get / getSummaryList / save(乐观并发+投影事务) / delete / chaptersWithDetails`；五条 IPC |
| **B 导入导出** | ✚ `src/shared/blueprint-v2-markdown.ts`（parse/serialize/assertNoLoss/matchScenesForReimport）；✚ 导入预览与差异 UI（对话框/面板位置自定，必须复用共享模块）；流程面：`import-novel.command.ts` 的跳过守卫 | §4 全部纯函数；重复导入预览差异；导入守卫报告 |
| **C 章节蓝图编辑器** | ✎ `src/components/editor/ChapterCardEditor.tsx`（v2 编辑态：分区/分镜/检查 mode 编辑、增删分镜、拖动重排、"升级为 v2"入口、导出入口）；流程面：`directory-workflow.ts` 跳过守卫 | 消费 A 通道 + B 的 serialize/parse；对已有 detail 的章，v1 字段编辑改为经由 v2 保存 |
| **D 章节画布** | ✎ `src/components/canvas/ChapterCanvasWorkbench.tsx`；✎ `src/shared/chapter-canvas.ts`（仅 §8.1 的 `sceneId` 一处 additive 修改，与 A 协调） | 排上画布/移出画布/删除分镜三动作（§8.2 表）；顺序权威与镜像（§8.3）；悬空引用渲染 |
| **E 写作调用与一致性检查** | ✎ `src/services/workflows/commands/generate-draft.command.ts`（v2 注入路径 + 常量脚手架）；✎ `src/shared/consistency-preflight.ts` 或其旁路模块（检查条目层）；✎ `src/services/agent/tools/propose-chapter-blueprint.tool.ts`（v2 警示）；✚ 智能体"Codex 导入细纲"工具（复用 B parser + A save） | §9 注入契约；§10 检查语义；§7.4 提案警示 |

### 12.2 依赖方向（禁止反向）

```
A（类型/存储/IPC，最先合入）
├─ B：import A 类型；产出 parse/serialize
│   ├─ C：编辑器、导出入口、批量生成守卫
│   └─ E：Codex 导入工具
├─ D：import A 通道；自持 chapter-canvas.ts 的 sceneId 增量
└─ E：写作注入 + 检查层 + 提案警示
C、D、E 之间无直接依赖；任何跨任务需求 → §13 登记缺口，由集成协调。
```

### 12.3 各任务测试底线（临时项目库/临时数据验证写操作，禁碰真实项目库）

- A：仓库层 save/conflict/投影/升级/损坏读取测试（临时 DB）。
- B：fixture 往返（§11.9）、custom 分区与散块保留、重复导入 id 存活。
- C：编辑保存后 `raw_markdown` 与 detail 同步、投影四列更新、notes/userGuidance 零变化。
- D：移出画布 vs 删除分镜的两侧结果断言；悬空引用渲染。
- E：注入路径单一性、规则脚手架常量、must/reference/forbid 判负保守性。

统一命令：`node node_modules/vitest/vitest.mjs run <相关测试文件>`；类型检查 `node node_modules/typescript/bin/tsc --noEmit`；i18n `pnpm run check:i18n`。

---

## 13. 契约缺口登记（任务 0 发现，已通知集成协调）

| # | 缺口 | 处置 |
| --- | --- | --- |
| 1 | `db:blueprint-upsert` / `db:blueprint-commit-range` 通道签名已冻结，仓库层无法对"已有 v2 的章"强制拒绝 v1 写入；防护只能落在调用方（§7.4 三个流程面） | 接受；A 提供守卫查询，C/B/E 落实；若有流程绕过，属违契 |
| 2 | `splitChapterBeats` 按 `；`/`;` 再拆分：分镜标题若含分号，v1 侧栏节拍视图会多拆一行（仅展示层，正文与写作 v2 路径不受影响） | 接受；C 可在标题输入提示中说明，禁止改 `splitChapterBeats` 冻结行为 |
| 3 | 章节画布 `parseChapterCanvasNodeRefs` 现静默丢弃未知 refs 字段 | D 落地 §8.1 时必须显式处理 `sceneId`，不得依赖丢弃行为 |
| 4 | check mode 不写入 Markdown（§4.2.3）：导出文件再导入会丢用户手工标注（DB 主数据不丢） | 接受；未来如需文件级保留，走 sidecar JSON 方案再修约 |
| 5 | §5.1 要求读取容错返回 `corrupt` / `needs-newer-app` 状态并附 `raw_markdown`，但 §6 冻结的 `db:blueprint-v2-get` return 是 `ChapterBlueprintV2Detail \| null`，两个正常状态装不下 | 接受；读取类型为 additive 的 `ChapterBlueprintV2DetailRead`（= Detail + 可选 `readStatus`/`rawMarkdown`/`storedSchemaVersion`）。正常读取时形状与冻结契约逐字段一致，消费方先判 `readStatus` |
| 6 | §3 冻结类型缺标题行级别信息：章题行与 canonical 分区标题行只存文字不存 `#` 级别，序列化无法逐字重建 `### / ####` 行，无损自检会失败 | 接受；按"新增字段必须可选"补 `chapterTitleLevel?: number` 与 canonical 分区 `level?: number`（仅 additve，不影响任何冻结字段） |
| 7 | §3 未登记章题与首个分区之间的原文，也未说明新增可选原文对哈希和最终读取的影响 | 接受：`chapterPostamble?: string` 在导入、保存、读取、序列化与导出中逐字保留；可选的 `chapterTitleLevel`/`chapterPostamble` 仅在存在时纳入 contentHash；全量读取、异常回退和审查快照遵守 §5.3 |

---

## 14. 与旧字段的权威关系总表

| 字段 | v2 存在时 | v2 不存在时 |
| --- | --- | --- |
| title / purpose / keyEvents / suspenseHook | v2 投影（保存时同事务刷新；空推导不抹旧值） | v1 流程权威 |
| role / characters / volume_id | v1 独立权威，v2 永不写 | 同左 |
| userGuidance | 作者权威，v2 永不写 | 同左 |
| notes / notes_updated_at | 定稿记录权威，v2 永不写（红线 1） | 同左 |
| 分镜正文/规则/禁忌/检查条目/字数预算/情绪曲线 | `blueprint_details` 唯一权威 | 不存在 |
| 章节画布卡片 | 编排视图，正文引用 v2 | 独立编排（现状） |
| 剧情画布 | 零交集 | 零交集 |
