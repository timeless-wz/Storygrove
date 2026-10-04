# 信息差 · 人物行动线 · 正文反向修纲 契约（knowledge-action-outline-sync-contract）

> 状态：**冻结**（任务 0 产出）。任务 A/B/C/D 必须遵守本文档的数据结构、ID、版本、读写与兼容规则，禁止各自另设计一套格式。
> 上游契约：`docs/blueprint-v2-contract.md`（章节细纲 v2 的结构、revision/contentHash、投影与红线全部继续生效；本文不重复、只引用）。
> 发现契约缺口时：在本文 §11 登记，不得自行发明不兼容字段。

---

## 0. 范围与红线

本契约定义四个新增能力的跨模块数据与行为边界：

1. **A 信息与揭露**：信息条目（作者真相）+ 主体知情记录（人物）+ 读者记录（作者预期的读者理解）。
2. **B 人物行动线**：角色目标/资源/限制/台前幕后行动，与原故事时间线按事件 ID 关联。
3. **C 正文反向修纲**：正文 → 章节细纲 v2 的对照同步（候选补丁 → 作者逐项确认 → 原子提交回 v2）。
4. **D 伏笔复用与公共注册**：伏笔标记 ↔ 章节脉络计划的关系表、检查报告存储、公共注册与迁移汇总。

总红线（全部沿袭既有权威边界，任何任务不得绕过）：

1. **不建第二套剧情事实库**。世界/人物正式资料仍是角色与世界模块；本章事件权威仍是章节蓝图 v2；正文权威仍是 drafts/contents 与定稿快照；长线计划与推进/兑现状态仍是 narrative_thread_*；伏笔原文证据仍是 foreshadowing 标记。新表只存：信息条目及知情记录、人物行动记录、同步候选补丁、检查报告、标记↔计划关系。
2. `blueprints.notes` / `notes_updated_at` / `user_guidance` 是定稿要点与作者指导权威，C 的同步流程**永不写**（blueprint-v2-contract 红线 1 继续生效）。同步流程不把 notes 当完整细纲。
3. AI 永远只产生**候选**（信息候选、知情记录候选、行动候选、补丁条目、检查发现）。作者确认前不写正式表；确认时关联既有实体，不自动创建同名角色或时间线事件。
4. 稳定 ID 关联优先：新表之间、新表对时间线/蓝图/草稿的引用一律存稳定 ID（人物用 characterIdentities 的稳定人物 ID；时间线用事件 id；细纲条目用 v2 条目 id）。禁止按人名/章节号猜测匹配。
5. `D:\Desktop\小说` 与用户真实项目只读；测试只用临时项目库。

---

## 1. 实测基线（任务 0 勘察，A/B/C/D 共享）

| 事实 | 位置 |
| --- | --- |
| 稳定人物 ID：姓名→ID 映射，IPC `db:character-identities-get/-ensure` | `src/stores/character-store.ts:324`、`src/shared/ipc-channels.ts:1177-1185` |
| 时间线事件：`StoryTimelineEvent`（`characterNames` 为姓名数组，`sortOrder` 排序，`status: planned/drafted/finalized`），IPC `db:timeline-*` | `src/shared/story-timeline.ts:108-144`、`ipc-channels.ts:1428-1441` |
| 章节脉络：`NarrativeThreadPlan/Event/View`（计划 id 为 number，`type` 自由文本，`targetStart/EndChapter`），IPC `db:narrative-thread-*` | `src/shared/narrative-thread.ts`、`ipc-channels.ts:1287-1309` |
| 伏笔标记：`ForeshadowingRecord`（draftId+offset/context 定位原文，`markerType`，`completed`），IPC `db:foreshadowing-*` | `src/shared/foreshadowing.ts`、`ipc-channels.ts:1238-1261` |
| 草稿：`drafts(chapter_number, blueprint_chapter_number 显式绑定, version, status)`；版本=行；正文在 `contents.body`；`db:draft-update-content` 原地更新不换行 | `electron/database.ts:451-473`、`draft-repository.ts:560/575` |
| 定稿快照：`finalization_outbox`（finalizationId、contentHash、content_snapshot 不可变） | `finalization-repository.ts:6-33` |
| 细纲 v2：`blueprint_details`（revision/contentHash 冗余列、乐观并发、v1 投影同事务），IPC `db:blueprint-v2-*` | `blueprint-detail-repository.ts:283-365`、`ipc-channels.ts:1131-1145` |
| 纯文本 sha256（渲染/主进程通用） | `src/shared/blueprint-v2.ts` `computeBlueprintV2TextHash` |
| 工作流命令基座：`BaseWorkflowCommand` + 动态 import 工厂 + `startWorkflow` | `src/services/workflows/commands/base-command.ts:160` |
| 正文侧材料注入点：`assembleChapterMaterials({ references: [...] })` | `generate-draft.command.ts:683-699`、`chapter-materials.ts:30-34` |

---

## 2. 故事位置与叙事位置（A/B 共用的定位词表，冻结）

**故事位置**（信息生效/行动发生的剧情内时点）与**叙事位置**（读者看到它的章节/分镜）是两个独立字段，任何模块不得用章号互相推断。

```ts
// src/shared/prose-anchor.ts —— 全项目唯一的正文片段锚点类型（A/B/C 复用，禁止另造）
export interface ProseAnchor {
  draftId: number
  /** 草稿版本号（drafts.version）；定稿后不变。 */
  version: number
  status: 'draft' | 'finalized'
  /** status='finalized' 时的定稿身份；未定稿缺省。 */
  finalizationId?: string
  /** 锚定时的正文 sha256（computeBlueprintV2TextHash）；校验依据，非权威字段。 */
  contentHash: string
  excerpt: string            // 原文片段（≤600 字符）
  startOffset?: number       // 锚定时偏移；仅提示用，重定位以 excerpt 为准
  endOffset?: number
  sourceType?: 'draft' | 'manuscript'
}
export type ProseAnchorValidity = 'intact' | 'stale'   // stale = excerpt 不在当前正文 → 显示「需重新定位」，绝不悄悄替换
export function validateProseAnchor(anchor: ProseAnchor, currentContent: string): ProseAnchorValidity

// 故事位置：优先引用时间线事件；无法定位时 unplaced，绝不猜
export type StoryPosition =
  | { kind: 'timeline-event'; eventId: string }
  | { kind: 'manual'; sortOrder: number; label: string }   // 作者自定义顺序（小者在前）
  | { kind: 'unplaced' }
// 叙事位置：章 + 可选 v2 分镜 + 可选作者序；缺章时 unplaced
export type NarrativePosition =
  | { kind: 'chapter-scene'; chapterNumber: number; sceneId?: string; authorOrdinal?: number }
  | { kind: 'unplaced' }
```

规则：

- 查询"某故事事件之前人物知道什么"只能用 storyPosition 的时间线 `sortOrder` 或 manual.sortOrder 比较；两者不可比时一律视为**位置未知**（不参与筛选、单独标注），禁止用录入时间或当天日期顶替故事时间。
- 叙事顺序筛选（读者已见）用 `chapterNumber`（+可选 sceneOrder/authorOrdinal）；同章多场景时用 v2 分镜 order 比较，sceneId 无法解析时同样标注位置未知。
- `unplaced` 记录在"截至第 N 章"类视图里显示为"位置未知"，由作者补充，不自动归入章首或章末。

---

## 3. 信息与揭露（任务 A 拥有类型与存储）

类型模块：`src/shared/knowledge-gap.ts`。仓库：`electron/repositories/knowledge-gap-repository.ts`。表前缀 `info_` / `knw_`，ID 前缀 `info-`（条目）、`knw-`（记录）。

### 3.1 信息条目（作者真相）

```ts
export type InfoTruthStatus = 'confirmed' | 'undecided' | 'retired'
// confirmed=作者已确认；undecided=尚未决定（禁止虚构真相）；retired=作者废止（保留历史，不参与写作材料）
export interface InfoEntry {
  id: string                 // info-<uuid>
  title: string              // ≤120
  summary: string            // 主题说明 ≤2000
  truth: string              // 实际真相 ≤8000；undecided 时允许为空
  truthStatus: InfoTruthStatus
  sourceRefs: InfoSourceRef[]
  relatedThreadPlanIds: number[]   // 可选关联的章节脉络计划 id（只存 id，状态以脉络为准）
  revision: number           // 乐观并发，从 1 起
  createdAt: string
  updatedAt: string
}
export type InfoSourceRef =
  | { kind: 'document'; documentId: string; note?: string }   // 项目自由文档
  | { kind: 'character'; characterId: string; note?: string } // 人物实体（存稳定 ID）
  | { kind: 'chapter'; chapterNumber: number; note?: string } // 章节
  | { kind: 'note'; text: string }                            // 纯文字来源说明
```

- **真相版本历史**：每次成功修改 `truth` 或 `truthStatus`，仓库在同一事务内向 `info_truth_versions` 追加一行（entryId、revision、truth、truthStatus、note?、createdAt），旧行永不改写。修改真相时仓库返回 `knowledgeRecordsAffected: number`（该条目下知情记录数）供 UI 提示"已有知情记录可能需要检查"；**绝不批量改写人物认知**。
- `undecided` 的条目可以没有任何真相文本；写作材料（§8）中它们只以"作者尚未确定"身份出现。

### 3.2 主体知情记录（人物 / 读者同一张表）

```ts
export type KnowledgeSubjectKind = 'character' | 'reader'
export type KnowledgeCognition = 'unknown' | 'heard' | 'suspected' | 'partial' | 'confident'
// 人物认知状态，只描述人物主观状态，不保证正确（确信 ≠ 真相）
export type KnowledgeTruthRelation = 'consistent' | 'partial' | 'misconstrued' | 'undetermined'
// 人物相信的说法与作者真相的关系；作者 truthStatus='undecided' 时只允许 'undetermined'
export type KnowledgeBasis = 'plan' | 'prose'   // 计划 / 有正文依据（prose 必须带 anchor）

export interface KnowledgeRecord {
  id: string                       // knw-<uuid>
  infoId: string                   // FK info_entries.id
  subjectKind: KnowledgeSubjectKind
  characterId?: string             // subjectKind='character' 必填；稳定人物 ID
  knownContent: string             // 知道的具体内容/部分（不是布尔"知道"）≤4000
  cognition: KnowledgeCognition
  believedStatement: string        // 人物相信的说法 ≤2000
  truthRelation: KnowledgeTruthRelation
  learningChannel: string          // 亲历/他人告知/调查/推断…自由文本 ≤120
  channelSourceNote: string        // 途径来源说明（事件/章节/人物）≤500
  storyPosition: StoryPosition
  narrativePosition: NarrativePosition
  concealment?: {
    fromCharacterIds: string[]     // 向谁隐瞒（稳定人物 ID）
    publicStatement: string        // 公开说法 ≤1000
  } | null                         // 隐瞒与误解互不排斥（误解可与隐瞒并存）
  basis: KnowledgeBasis
  proseAnchor?: ProseAnchor        // basis='prose' 时必填（记录来源版本与片段锚点）
  reader?: {                       // subjectKind='reader' 时使用
    shownEvidence: string          // 已展示给读者的证据 ≤4000
    expectedUnderstanding: string  // 作者预期的读者理解 ≤2000（不是断言真实读者猜到什么）
    revealPlanNote: string         // 计划揭露位置说明 ≤500
  } | null
  revision: number
  createdAt: string
  updatedAt: string
}
```

- 人物改名**不触碰**记录（characterId 稳定）；渲染层解析不到 characterId → 显示"引用的人物已删除/失效"徽标，可由作者手动改挂或删除记录。
- 重名人物用 characterIdentities 的 ID 区分；UI 选择人物时必须列出全部同名卡让作者挑，不自动匹配。
- 读者记录不引用人物；`storyPosition` 对读者记录通常为 unplaced（读者活在叙事顺序里），`narrativePosition` 是"计划揭露位置"。
- 删除信息条目 = 显式动作（UI 二次确认，展示受影响记录数）；只删 `info_entries`/`info_truth_versions`/本条目的 `knowledge_records`，**绝不**删除人物、时间线事件或正文；人物行动线对 knw- 的引用变成悬空并显示失效提示。

### 3.3 IPC（加入 DatabaseChannels）

```ts
'db:info-entry-list':        { args: [filter: { truthStatus?: InfoTruthStatus; query?: string; chapterNumber?: number }, expectedProjectPath: string]; return: InfoEntry[] }
'db:info-entry-get':         { args: [id: string, expectedProjectPath: string]; return: InfoEntry | null }
'db:info-entry-save':        { args: [input: { id?: string; baseRevision?: number } & InfoEntryDraft, expectedProjectPath: string]; return: { success: boolean; id?: string; revision?: number; conflict?: boolean; currentRevision?: number; knowledgeRecordsAffected?: number; error?: string } }
'db:info-entry-delete':      { args: [id: string, expectedProjectPath: string]; return: { success: boolean; deletedRecords?: number; error?: string } }
'db:info-entry-truth-history': { args: [id: string, expectedProjectPath: string]; return: InfoTruthVersion[] }
'db:knowledge-record-list':  { args: [query: { infoId?: string; characterId?: string; chapterNumber?: number }, expectedProjectPath: string]; return: KnowledgeRecord[] }
'db:knowledge-record-save':  { args: [input: { id?: string; baseRevision?: number } & KnowledgeRecordDraft, expectedProjectPath: string]; return: { success: boolean; id?: string; revision?: number; conflict?: boolean; currentRevision?: number; error?: string } }
'db:knowledge-record-delete':{ args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
```

语义：save 无 `id` = 新建（baseRevision 忽略）；有 `id` 时 `baseRevision` ≠ 当前 revision → `conflict: true` + `currentRevision`，拒绝写入。所有写通道加入 `MUTATING_DATABASE_CHANNELS`，失败返回 `{ success:false, error }`。

---

## 4. 人物行动线（任务 B 拥有类型与存储）

类型模块：`src/shared/character-action.ts`。仓库：`electron/repositories/character-action-repository.ts`。表 `character_actions`，ID 前缀 `act-`。

```ts
export type CharacterActionVisibility = 'on-stage' | 'off-stage'
// off-stage = 幕后：尚未向读者展示，不等于没发生。故事内状态与叙事呈现状态同时成立：
//   故事内状态由 status/eventId 表达；叙事呈现由 narrativePosition 表达（unplaced=尚未排入任何章）。
export type CharacterActionStatus = 'plan' | 'prose'   // 计划 / 有正文依据（prose 必须带 anchor）

export interface CharacterAction {
  id: string                    // act-<uuid>
  characterId: string           // 稳定人物 ID（必填）
  title: string                 // ≤160
  goal: string                  // 目标/行动意图 ≤4000
  resources: string             // 掌握的资源 ≤2000
  constraints: string           // 限制 ≤2000
  basedOnKnowledgeIds: string[] // 所据认知 → knw- id（只存 id）
  eventId?: string              // 已排入的时间线事件 id；与 plannedNote 互斥
  plannedNote?: string          // 尚未排入事件的行动计划说明 ≤2000
  storyPosition: StoryPosition  // eventId 存在时冗余为 { kind:'timeline-event', eventId }，由仓库维护
  narrativePosition: NarrativePosition  // 叙事呈现位置（幕后行动通常 unplaced）
  visibility: CharacterActionVisibility
  outcome?: string              // 结果 ≤2000（事件结果本身以时间线为准，这里只写人物侧结果）
  aftermath?: string            // 后续影响 ≤2000
  status: CharacterActionStatus
  proseAnchor?: ProseAnchor     // status='prose' 时必填
  relatedChapterNumbers: number[] // 受影响的章（提示用，非权威）
  revision: number
  createdAt: string
  updatedAt: string
}
```

### 4.1 与时间线的关系（冻结）

- `eventId` 引用 `story_timeline_events.id`。事件标题/时间/结果/影响**只从事件记录读取展示**（仓库 list 时 join 出只读 `event?: { id, title, timeLabel, sortOrder, status, outcome, aftermath }`，事件已删则 `eventDangling: true`），行动线表不复制这些字段为可编辑数据。
- 同一事件可被多条行动引用（多人物各自目的），事件行**永不**被行动线修改。
- **排入时间线**走单通道 `db:character-action-promote-to-timeline`：主进程在**同一个 better-sqlite3 事务**内（1）若 action.eventId 已存在 → 幂等直接返回成功，不重复创建事件；（2）否则用行动的人物当前名 + 标题/计划说明创建 `story_timeline_events` 行（`status:'planned'`，characterNames=[人物名]——时间线的数据模型就是姓名，这是兼容现实，不是新的一套）；（3）回填 action.eventId 与 storyPosition。
- 按角色过滤时间线：展示层 = 「行动已关联的事件」∪「characterNames 含该人物名的原时间线事件」。重名人物时列出全部同名命中并提示作者显式确认归属，不自动合并；**不建**人物专属时间轴数据库。

### 4.2 IPC

```ts
'db:character-action-list':   { args: [query: { characterId?: string; chapterNumber?: number }, expectedProjectPath: string]; return: CharacterActionView[] }
'db:character-action-save':   { args: [input: { id?: string; baseRevision?: number } & CharacterActionDraft, expectedProjectPath: string]; return: { success: boolean; id?: string; revision?: number; conflict?: boolean; currentRevision?: number; error?: string } }
'db:character-action-delete': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
'db:character-action-promote-to-timeline': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; eventId?: string; alreadyLinked?: boolean; error?: string } }
```

- 行动计划改变**永不**自动改世界事实、其他人物关系或时间线既有事件；`relatedChapterNumbers` 只用于提示跳转。

---

## 5. 正文反向修纲（任务 C 拥有类型与存储）

类型模块：`src/shared/outline-sync.ts`（含纯函数 `applyOutlineSyncPatchItems`）。仓库：`electron/repositories/outline-sync-repository.ts`。表 `outline_sync_candidates`、`outline_sync_commits`、`outline_sync_pending`。ID 前缀 `osy-`（候选）、`osi-`（补丁条目）。

### 5.1 候选与补丁条目

```ts
export type OutlineSyncChangeKind =
  | 'scene-order' | 'scene-content' | 'scene-added' | 'scene-omitted'
  | 'character-action' | 'location-time' | 'knowledge' | 'conflict-outcome'
  | 'hook' | 'field-content' | 'no-change'

export type OutlineSyncPatchOp =
  | { kind: 'replace-item'; sectionId: BlueprintV2SectionId; itemId: string; beforeMarkdown: string; afterMarkdown: string; afterTitle?: string }
    // afterTitle 仅对 scene 条目有效：分镜标题变化（keyEvents 投影随之更新）；其余条目忽略
  | { kind: 'add-scene'; afterSceneId: string | null; title: string; markdown: string }  // itemId 提交时分配 bps-
  | { kind: 'remove-item'; sectionId: BlueprintV2SectionId; itemId: string; beforeMarkdown: string }
  | { kind: 'reorder-scenes'; orderedSceneIds: string[] }

export interface OutlineSyncPatchItem {
  id: string                        // osi-<uuid>
  changeKind: OutlineSyncChangeKind
  explanation: string               // 变化说明（含证据引用）≤2000
  proseEvidence: string             // 正文证据片段 ≤1200
  proseEvidenceOffset?: number
  op: OutlineSyncPatchOp
  status: 'pending' | 'accepted' | 'rejected'   // 作者逐项决定；提交时持久化
}

export interface OutlineSyncProseSource {
  draftId: number
  version: number
  status: 'draft' | 'finalized'     // finalizedName: 定稿快照
  finalizationId?: string
  contentHash: string               // 冻结时对正文全文计算（computeBlueprintV2TextHash）
  unfinishedDraft: boolean          // 作者标记「未完成稿」：未写到的后半段不得推断为删掉
}

export interface OutlineSyncCandidate {
  id: string                        // osy-<uuid>
  chapterNumber: number             // = drafts.blueprint_chapter_number（显式绑定），从不用正文章号猜
  prose: OutlineSyncProseSource
  blueprint: { chapterNumber: number; revision: number; contentHash: string }
  items: OutlineSyncPatchItem[]
  /** AI/人工都没发现实质变化时 true；提交=记录一次“已核对”，不改细纲。 */
  noSubstantiveChange: boolean
  summaryNote: string
  status: 'pending' | 'committed' | 'discarded' | 'stale'
  createdAt: string
  updatedAt: string
}
```

### 5.2 生命周期（冻结）

```
[入口] DraftEditor「检查并同步细纲」/ ChapterCardEditor「对照关联正文」
   │  冻结：正文 draftId+version+contentHash（先保存成功后才允许创建候选）、
   │       蓝图 chapterNumber+revision+contentHash（db:blueprint-v2-get 读取）、
   │       绑定（drafts.blueprint_chapter_number）；无绑定 → 只提示绑定，不读写假定目标。
   ▼
[建议生成] OutlineSyncSuggestCommand（AI，structured）：逐项输出 OutlineSyncPatchItem。
   │  仅措辞变化 → noSubstantiveChange 候选，零补丁。未完成稿 → 禁止把未出现的后半段判为 scene-omitted。
   │  校验：itemId 必须存在于冻结蓝图；beforeMarkdown 必须与该条目当前 markdown 相等，否则该条目标记 stale 拒收。
   ▼
[候选落库] status='pending'（作者确认前不碰 blueprint_details）
   ▼
[补丁审查 UI] 并排：正文证据 / 原细纲条目 / 新细纲建议；逐项接受/拒绝。
   ▼
[提交] db:outline-sync-commit(candidateId, acceptedItemIds, expectedProseContentHash?)
   事务内复核：候选 status='pending'；正文 contentHash 仍等于冻结值（正文又改过 → 阻止，
   候选保留 status 不变，返回 needsRecompare）；蓝图 revision/contentHash 仍等于冻结值
   （蓝图被改过 → 同样阻止）；然后 applyOutlineSyncPatchItems → BlueprintDetailRepository.save
   （baseRevision=冻结 revision，投影事务照旧）→ 候选 status='committed' → 写 outline_sync_commits 审计行
   （源版本/目标版本/接受的条目 id/时间）。全部成功或全部回滚；重复提交同一候选 → 幂等返回已提交结果，不双写。
   ▼
[下游提示] 同步成功后返回 affected: { laterChapterNumbers, knowledgeRecordIds, actionIds,
   foreshadowingIds, threadPlanIds }（只查询不改写）；knowledge 记录的 proseAnchor 对当前正文
   校验失效的 → 前端展示「需重新定位」。锚点本体保留原值，绝不悄悄改指别的句子。
```

- `outline_sync_pending`（"细纲待核对"标记）：正文保存成功后由 DraftEditor 显式调用 `db:outline-sync-mark-pending` 写入（chapterNumber、draftId、proseHash、markedAt）；候选创建/提交/作者"忽略"时清除。它**不是**自动 AI 触发器，只是一个徽标。
- 撤销：v2 契约没有细纲撤销链，本任务**不新增**回滚写入；需要撤销时作者在蓝图编辑器里以修订方式处理，`outline_sync_commits` 提供追溯依据（之后版本如做恢复，必须带版本校验，不覆盖后续人工改动）。

### 5.3 IPC

```ts
'db:outline-sync-mark-pending':    { args: [input: { chapterNumber: number; draftId: number; proseHash: string }, expectedProjectPath: string]; return: { success: boolean; error?: string } }
'db:outline-sync-clear-pending':   { args: [chapterNumber: number, expectedProjectPath: string]; return: { success: boolean; error?: string } }
'db:outline-sync-list-pending':    { args: [expectedProjectPath: string]; return: Array<{ chapterNumber: number; draftId: number; proseHash: string; markedAt: string }> }
'db:outline-sync-create-candidate':{ args: [input: { chapterNumber: number; draftId: number; unfinishedDraft: boolean; items: OutlineSyncPatchItem[]; noSubstantiveChange: boolean; summaryNote: string }, expectedProjectPath: string]; return: { success: boolean; candidate?: OutlineSyncCandidate; error?: string } }
  // 主进程负责重新冻结：读 draft 全文算 contentHash、读蓝图 revision/contentHash、校验条目 beforeMarkdown
'db:outline-sync-get-candidate':   { args: [id: string, expectedProjectPath: string]; return: OutlineSyncCandidate | null }
'db:outline-sync-list-candidates': { args: [query: { chapterNumber?: number; status?: OutlineSyncCandidate['status'] }, expectedProjectPath: string]; return: OutlineSyncCandidate[] }
'db:outline-sync-discard-candidate': { args: [id: string, expectedProjectPath: string]; return: { success: boolean; error?: string } }
'db:outline-sync-commit':          { args: [input: { candidateId: string; acceptedItemIds: string[] }, expectedProjectPath: string]; return: { success: boolean; revision?: number; contentHash?: string; committed?: boolean; alreadyCommitted?: boolean; needsRecompare?: boolean; reason?: string; affected?: OutlineSyncAffected; error?: string } }
'db:outline-sync-affected-preview':{ args: [chapterNumber: number, expectedProjectPath: string]; return: OutlineSyncAffected }
```

---

## 6. AI 检查报告（任务 D 拥有存储，C/A/B 提供数据读取）

类型模块：`src/shared/knowledge-check.ts`。仓库：`electron/repositories/knowledge-check-repository.ts`。表 `knowledge_check_reports`，ID 前缀 `kcr-`。报告是**证据**不是事实：作者确认前不改任何正式对象。

```ts
export type KnowledgeCheckKind = 'info-gap' | 'action-line'
export interface KnowledgeCheckFinding {
  id: string                       // kcf-<uuid>
  severity: 'suggestion'           // 语义判断一律建议级，不阻断、不判错作者剧情
  title: string                    // ≤200
  detail: string                   // ≤4000
  citations: KnowledgeCheckCitation[]
}
export type KnowledgeCheckCitation =
  | { kind: 'info-entry'; id: string; note?: string }
  | { kind: 'knowledge-record'; id: string; note?: string }
  | { kind: 'character-action'; id: string; note?: string }
  | { kind: 'timeline-event'; id: string; note?: string }
  | { kind: 'chapter'; chapterNumber: number; note?: string }
  | { kind: 'thread-plan'; id: number; note?: string }
  | { kind: 'draft'; draftId: number; note?: string }
export interface KnowledgeCheckReport {
  id: string
  kind: KnowledgeCheckKind
  scope: string                    // 例：'chapter:3' / 'character:<characterId>'
  findings: KnowledgeCheckFinding[]
  modelNote: string                // 输入范围与目标说明 ≤500
  createdAt: string
}
```

IPC：`db:knowledge-check-report-save` / `db:knowledge-check-report-list`（`{ kind?, scope? }`）/ `db:knowledge-check-report-delete`。三类检查共用工作流引擎与模型 runtime；报告落在信息与揭露页（info-gap）与角色行动线页（action-line）展示。

---

## 7. 伏笔 ↔ 章节脉络关系（任务 D）

表 `thread_marker_links`（仓库 `electron/repositories/thread-marker-link-repository.ts`，ID 前缀 `tml-`）：

```ts
export interface ThreadMarkerLink {
  id: string
  threadPlanId: number             // narrative_thread_plans.id
  foreshadowingId: string          // foreshadowing.id（原文标记本体，绝不复制选段）
  kind: 'evidence' | 'reference'   // 证据（对应某次埋设/深化/回收）/ 参考
  note: string                     // ≤500
  createdAt: string
}
```

- 允许一条标记关联多个计划、一个计划关联多条标记；关系行删除不影响两侧本体。
- 伏笔的 `completed` 布尔与脉络的 `resolved` 事件**互不自动改写**："秘密揭露"≠"所有人物知情"，一次 callback ≠ 整条承诺兑现；状态变更仍走各自的作者显式确认流程。
- 长线远景承诺用既有 `NarrativeThreadPlanInput.type/authorIntent` 表达；没有正文证据允许计划存在，但**不得**伪造 foreshadowing 选段或 narrative_thread_confirmations 证据。
- IPC：`db:thread-marker-link-list`（`{ threadPlanId?, foreshadowingId? }`）/ `-link` / `-unlink`。

---

## 8. 写作材料注入（任务 C 实施，全部经 generate-draft 一线）

新增参考块（进入 `assembleChapterMaterials` 的 `references`，预算沿用既有 6000 字符总闸）：

- 头部：【信息差材料（信息与揭露模块）· 只含截至本章的可知内容】
- 三个子段：
  1. **角色可知**（按本章出场人物）：每条 = 人物名 + 认知状态 + knownContent + believedStatement（标注"与真相：一致/部分/误解"是**人物主观状态**）；筛选 = `narrativePosition.chapterNumber ≤ 当前章`，storyPosition 无法比较或 unplaced → 归入"位置未知（计划），谨慎使用"。
  2. **读者已见**：读者记录中 `narrativePosition.chapterNumber ≤ 当前章` 的 shownEvidence + expectedUnderstanding。
  3. **作者后台约束（不可直接泄露）**：相关条目的作者真相文本（confirmed 才入内），明确标注"仅约束剧情走向，正文不得直接讲出"；`undecided` 真相**不进入**本段，只列条目名并标"作者尚未确定"；`retired` 完全排除。
- 未通过位置筛选的记录不注入；无法判断时材料块标注"缺少可定位的信息记录"，绝不把全书末期认知用于开篇。
- 写稿（generate-draft）/审稿（review-chapter）/修稿各自接入点独立核对：本次只接 generate-draft 的材料引用；其余两个入口维持现状，不在本次声称覆盖。

---

## 9. 存储与迁移汇总

| 表 | 归属任务 | DDL 位置 |
| --- | --- | --- |
| `info_entries` / `info_truth_versions` / `knowledge_records` | A | `ensureKnowledgeGapSchema`（electron/services/knowledge-gap-schema.ts） |
| `character_actions` | B | `ensureCharacterActionSchema`（electron/services/character-action-schema.ts） |
| `outline_sync_candidates` / `outline_sync_commits` / `outline_sync_pending` | C | `ensureOutlineSyncSchema`（electron/services/outline-sync-schema.ts） |
| `knowledge_check_reports` | D | `ensureKnowledgeCheckSchema`（electron/services/knowledge-check-schema.ts） |
| `thread_marker_links` | D | `ensureThreadMarkerLinkSchema`（electron/services/thread-marker-link-schema.ts） |

- 全部 `CREATE TABLE IF NOT EXISTS` + 索引同惯例；`initProjectDatabase` 按上表顺序调用五个 ensure（A→B→C→D→D），互不依赖列改写，无 `user_version`。
- 旧记录默认状态：本项目五张表均为全新表，无旧行；**外部来源**（导入/AI/未来迁移）写入时 `basis/status` 缺省一律 `plan`/`pending`，`truthStatus` 缺省 `undecided`——来源未知不得自动确认为事实。
- 候选持久化于 SQLite（可跨重启恢复），localStorage 只允许存 UI 偏好（分栏宽度等），不作事实源。
- 删除预览：删信息条目前返回受影响 knw- 数；删人物/时间线事件时本模块的引用悬空显示，不做级联。

## 10. 文件归属（并行分工；公共文件单主）

| 任务 | 新建 | 修改（独占） |
| --- | --- | --- |
| A | `src/shared/knowledge-gap.ts`、`src/shared/prose-anchor.ts`、`electron/repositories/knowledge-gap-repository.ts`、`electron/services/knowledge-gap-schema.ts`、`src/components/planning/knowledge-gap/*`、`src/components/editor/character-profile/CharacterKnowledgeSummary.tsx`、测试 | `src/shared/ipc-channels.ts`（info/knowledge 段）、`electron/controllers/db-controller.ts`（info/knowledge handlers）、`electron/database.ts`（ensure 调用）——实际由 D 统一登记，见下 |
| B | `src/shared/character-action.ts`、`electron/repositories/character-action-repository.ts`、`electron/services/character-action-schema.ts`、`src/components/editor/character-action/*`、测试 | `src/stores/layout-store.ts`（CharacterProfileView + 'actions'）、`src/components/editor/CharacterEditor.tsx`（行动线分支） |
| C | `src/shared/outline-sync.ts`、`electron/repositories/outline-sync-repository.ts`、`electron/services/outline-sync-schema.ts`、`src/services/workflows/commands/outline-sync.command.ts`、`src/services/workflows/outline-sync-workflow.ts`、`src/components/editor/outline-sync/*`、测试 | `src/components/editor/DraftEditor.tsx`（入口+待核对标记）、`src/components/editor/ChapterCardEditor.tsx`（对照关联正文入口）、`generate-draft.command.ts`（材料注入） |
| D | `src/shared/knowledge-check.ts`、`src/shared/thread-marker-link.ts`、`electron/repositories/knowledge-check-repository.ts`、`electron/repositories/thread-marker-link-repository.ts`、`electron/services/knowledge-check-schema.ts`、`electron/services/thread-marker-link-schema.ts` | `src/shared/ipc-channels.ts`、`electron/controllers/db-controller.ts`、`electron/database.ts`、`src/components/panels/sidebar/ProjectTree.tsx`、`src/stores/editor-store.ts`、`src/components/panels/sidebar/sidebar-file-openers.ts`、`src/components/panels/EditorArea.tsx`、`src/components/editor/ForeshadowingManagementView.tsx`、`src/components/editor/NarrativeThreadEditor.tsx` |

> 本轮为单一执行模型顺序实施：以上"独占"边界用于保证修改不互踩；ipc-channels/db-controller/database/导航注册五处公共文件统一按 §9/§3.3/§4.2/§5.3/§6/§7 的冻结清单一次落位，不留半注册状态。

## 11. 契约缺口登记

| # | 缺口 | 处置 |
| --- | --- | --- |
| 1 | 时间线事件模型只有 characterNames（姓名），无人物 ID 列；行动线按 ID 关联、时间线侧仍按姓名过滤 | 接受（§4.1）：新关联以行动线表的 characterId 为准；时间线过滤展示层用姓名匹配 + 重名显式提示；不改 story_timeline 表 |
| 2 | 章节脉络计划 id 为自增 number，跨项目无全局唯一性 | 接受：只在项目库内引用（relatedThreadPlanIds / thread_marker_links 均项目内有效） |
| 3 | `assembleChapterMaterials` 预算 6000 字符为既有总闸，信息差材料与其他材料竞争预算 | 接受：作为 references 参与既有裁剪，超出时按既有省略机制提示，不扩闸 |
| 4 | v2 细纲无撤销链（blueprint-v2-contract §7.3 只有显式删除），本任务的提交也不做自动回滚 | 接受（§5.2）：审计行提供追溯；恢复必须带版本校验，留待后续契约 |
| 5 | AI 补丁建议对"人物行动/获知信息"等语义变化的判断属建议级 | 接受：finding/op 均带 evidence，作者逐项确认；模型判错不自动否决作者剧情 |
