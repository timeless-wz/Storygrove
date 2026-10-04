# 章节蓝图三级规划契约

状态：冻结，2026-10-03。实现以本文件和 `docs/blueprint-v2-contract.md` 为准。

## 1. 现状核验与范围

本契约先核对现有 schema 与调用链后冻结：

- `project_core.synopsis` 是既有总纲字段；`db:project-core-get` 读取，`db:project-core-synopsis-commit` 通过 `ProjectCoreRepository.commitSynopsis` 做同记录比较并提交。
- `blueprint_volumes` 现有列只有 `id`、`name`、`sort_order`、`created_at`、`updated_at`，没有卷纲正文或同义简介字段。卷记录 ID 是稳定身份，重命名只改 `name`。
- `blueprints.volume_id` 是蓝图章节归卷事实；`ChapterVolumeRepository` 的 `chapter_volume_assignments` 是正文归卷，二者独立。
- `blueprint_details.detail_json/raw_markdown` 是现有章节 v2 权威；保留其 revision/contentHash、原文保真及不得覆盖 `notes`、`user_guidance`、人物事实的规则。
- `drafts.blueprint_chapter_number` 是正文绑定蓝图章号的唯一依据；不可从正文卷或显示章号推断。
- 现有总纲分章范围续写、检查点和 `directory` 批量章纲生成均保持原范围语义，不复用为分卷计划。

交付建立“全书总纲 → 分卷卷纲 → 每章细纲”。不迁移、重写或拆解旧总纲；不自动新增卷；不推断旧卷或章节归属。

## 2. 字段权威

| 内容 | 唯一权威 | 允许的派生内容 |
| --- | --- | --- |
| 全书总纲正文 | `project_core.synopsis` 原文 | 只读卷任务摘要、来源 hash、候选和检查报告 |
| 卷目录 | `blueprint_volumes` 的 `id/name/sort_order` | 搜索计数和章节计数 |
| 卷纲正文 | `blueprint_volume_outlines.markdown`，按 `volume_id` | 九项分区导航、面向总纲/正文的有界摘要 |
| 章节归属与旧简纲字段 | `blueprints`，以 `chapter_number`、`volume_id` 为准 | 章节树与轻量摘要 |
| 章节 v2 细纲/分镜 | `blueprint_details.detail_json/raw_markdown` | v1 只读投影、轻量摘要、画布投影 |
| 规划生成/来源/检查 | 本契约新增的候选、来源与检查记录 | 不作为第二份可编辑正式总纲/卷纲/细纲 |

总纲 Markdown 必须原样读写，不作自动格式标准化。九项卷纲可用标题模板，但 Markdown 正文是唯一权威；空节和自定义节有效。卷名和排序仍使用 `blueprint_volumes`，不得另存同义卷简介。

章节 v2 在 `ChapterBlueprintV2Content` 上增设可选、稳定语义对象 `planning`：`volumeTask`、`handoff`、`expectedEndChange`。这是 v2 正文的一部分，参与 revision/contentHash；旧 v2 读回时字段缺省，不改 `raw_markdown`。`plan` 阶段的候选在候选表中保存，不伪装成 v2；确认章节安排创建蓝图 v1 行及来源记录，执行“展开细纲”并确认后才写入正式 v2。此阶段的三项规划字段随完整 v2 保存。

## 3. 新增持久化 schema

数据库初始化采用幂等 `CREATE TABLE IF NOT EXISTS`/增列迁移；迁移不更新旧 `synopsis`、不重分配任何卷/章/草稿、不回填假快照。正式内容不进入 localStorage。

### 3.1 `blueprint_volume_outlines`

```sql
volume_id TEXT PRIMARY KEY,                -- 对应 blueprint_volumes.id；删除卷前显式处理
schema_version INTEGER NOT NULL DEFAULT 1,
markdown TEXT NOT NULL,
revision INTEGER NOT NULL,
content_hash TEXT NOT NULL,                -- SHA-256(UTF-8 markdown 原文)
origin TEXT NOT NULL,                      -- manual | import | ai | template
source_snapshot_id TEXT DEFAULT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

不存在的行表示“尚无卷纲”，不创建空占位。首次保存使用 `expectedRevision: 0`；已存在记录必须传现有 revision。CAS 冲突返回明确错误并保留编辑器输入。卷纲导入/模板也遵守同一保存边界。

### 3.2 `blueprint_planning_candidates`

```sql
operation_id TEXT PRIMARY KEY,
kind TEXT NOT NULL,
scope_json TEXT NOT NULL,
state TEXT NOT NULL,                         -- candidate | stale | committed | cancelled
schema_version INTEGER NOT NULL,
payload_hash TEXT NOT NULL,
candidate_json TEXT NOT NULL,
source_snapshot_json TEXT NOT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
committed_at TEXT DEFAULT NULL,
commit_receipt_json TEXT DEFAULT NULL
```

候选持久保存可恢复的模型结果、作者修改、输入来源及版本。重用 `operation_id` 时载荷 hash 相同才可幂等返回原结果；相同 ID 不同载荷返回 `OPERATION_ID_REUSE`。候选只在确认 IPC 中成为正式数据。来源改变时状态变为 `stale`，候选和预览保留，不能强制覆盖或静默刷新快照。

### 3.3 `blueprint_planning_sources`

```sql
snapshot_id TEXT PRIMARY KEY,
operation_id TEXT DEFAULT NULL,
target_kind TEXT NOT NULL,                  -- book | volume | chapter
target_id TEXT NOT NULL,
target_revision INTEGER DEFAULT NULL,
target_hash TEXT NOT NULL,
sources_json TEXT NOT NULL,
created_at TEXT NOT NULL
```

`sources_json` 是只读版本清单：总纲精确 body hash；卷纲 `volumeId/revision/contentHash`；引用章纲 `chapterNumber/revision/contentHash`；章归属 `volumeId`；使用的输入、模板和来源范围。它不含可编辑副本。总纲没有 revision 列时，hash 是其版本身份。无历史快照的旧内容状态为“尚未建立来源关联”。

### 3.4 `blueprint_planning_checks`

```sql
check_id TEXT PRIMARY KEY,
kind TEXT NOT NULL,                          -- book-volume | volume-chapters
target_kind TEXT NOT NULL,
target_id TEXT NOT NULL,
target_revision INTEGER DEFAULT NULL,
target_hash TEXT NOT NULL,
source_snapshot_json TEXT NOT NULL,
report_json TEXT NOT NULL,
created_at TEXT NOT NULL
```

检查报告分开保存确定性检查与 AI 建议，含引用来源、卷/章、问题与建议。只读报告不自动改规划。读取报告时必须比对目标版本和 source snapshot；任何相关源或目标改变，状态为“上层已变化，建议检查”或“检查结果已过期”。

## 4. IPC 与并发

所有 DB IPC 带 `expectedProjectPath`，由渲染侧 `invokeWithProjectSession` 调用并由主进程验证。类型和结果集中声明在 shared IPC 模块，仓库事务位于主进程。

新增通道：

- `db:blueprint-volume-outline-get(volumeId, expectedProjectPath)` → `{ volumeId, schemaVersion, markdown, revision, contentHash, origin, sourceSnapshotId, createdAt, updatedAt } | null`。
- `db:blueprint-volume-outline-list-summaries(expectedProjectPath)` → 按目录顺序的 `{ volumeId, revision, contentHash, origin, updatedAt, summary }[]`；摘要限长，不读全量正文。
- `db:blueprint-volume-outline-save({ volumeId, expectedRevision, markdown, origin, sourceSnapshotId? }, expectedProjectPath)` → `{ success, outline? } | { success:false, code, error, current? }`。
- `db:blueprint-planning-candidate-save(candidate, expectedProjectPath)`、`-get(operationId, ...)`、`-list(scope, ...)`、`-cancel(operationId, ...)`；候选写入须校验 schema、长度和 hash。
- `db:blueprint-planning-confirm({ operationId, expectedSourceSnapshot, selection, edits }, expectedProjectPath)` → 幂等收据；在一个事务中复核来源、CAS 更新并保存卷/章及来源记录。
- `db:blueprint-planning-check-save(report, expectedProjectPath)`、`-check-list(scope, ...)` → 保存与读取绑定精确版本的检查报告。
- `db:blueprint-planning-export(expectedProjectPath)` → 带版本 manifest、总纲、卷/卷纲、章归属、章 v2 的规划包，不含正文。

总纲仍只写 `project_core.synopsis`。所有包含 synopsis 的写操作必须在同一 DB 事务内验证调用开始时读到的精确 synopsis hash，再写入；总纲更新不得仅依赖新页面的锁：

1. `db:project-core-synopsis-commit` 增加/复用 expected synopsis body hash，并继续核对现有生成输入快照。
2. `db:project-core-update` 在 data 含 `synopsis` 时强制调用方传 `expectedSynopsisHash`；不传或不匹配时拒绝，不影响其他 core 字段更新。
3. `ArchFileViewer`/`vela-protocol` 保留开始编辑时的 synopsis 原文/hash，不能在保存时先读最新值再以它覆盖旧编辑。
4. `ImportGlobalFactsRepository.commit` 的幂等事务将输入快照带入并在提交前 CAS；角色名单失败时 synopsis/core 同事务回滚。
5. 旧架构生成保存仍走 `db:project-core-synopsis-commit`。新的总纲候选确认也走同一个受保护仓库 seam。

错误码：`REVISION_CONFLICT`、`STALE_SOURCE`、`OPERATION_ID_REUSE`、`CANDIDATE_NOT_FOUND`、`VOLUME_NOT_FOUND`、`CHAPTER_NUMBER_CONFLICT`、`INVALID_SELECTION`、`UNSUPPORTED_SCHEMA`、`INVALID_CONTENT`、`PROJECT_SESSION_MISMATCH`、`STORAGE_ERROR`。不能把冲突折叠成普通成功或清除候选。

## 5. 候选与事务

候选 kind 至少为 `book-outline`、`volume-plan`、`volume-outline`、`chapter-plan`、`chapter-expand`、`connection-check`。均由现有模型选择、workflow engine、lease、进度、取消和错误记录驱动；不得创建独立后台队列。

- 总纲生成/改进：生成候选并显示差异；确认前不写 synopsis。旧按章范围续写/检查点仍为独立兼容模式。
- 规划分卷：输入冻结总纲、作者篇幅/数量/偏好和既有卷摘要。完整候选可编辑/选择；已有卷只按显式 `volumeId` 更新；同名不合并。确认时在一个事务内创建所选新卷和卷纲，取消不落空卷。
- 单卷卷纲生成：输入冻结总纲、目标卷现有稿、相邻卷有限摘要和作者指导；只提交目标卷，CAS 该卷 revision。
- 规划本卷章节：全书唯一章节号，目标是精确 `volumeId`；用有界章摘要与可选明确读取的单章 detail。默认只新增章节，绝不覆盖已有人工/导入简纲或 v2。已有章节改进须逐章明确选择、版本 diff 和 CAS。
- 确认章节安排通过既有蓝图批量提交边界创建蓝图行并设置 `volume_id`，同时写来源记录。章号不得按卷归一；不得改变 prose volume、草稿绑定或 `notes/user_guidance/characters/role`。
- “展开细纲”生成完整 v2 候选，确认前不保存；提交走 `BlueprintDetailRepository` revision/hash 边界，并保持 `raw_markdown`/分镜正文规则。可选 `planning` 三字段随 v2 canonical JSON 保存。
- 长任务分批保存候选；部分结果只能显示“候选未提交”，不能报告整批正式保存成功。

## 6. 选中对象与工作区接口

```ts
type BlueprintPlanningSelection =
  | { kind: 'book' }
  | { kind: 'volume'; volumeId: string }
  | { kind: 'chapter'; chapterNumber: number }
```

工作区父层持有 `selection`，编辑器接收正式数据和版本、`dirty` 状态、`onSave(candidate)`、`onDiscard()`、`onGenerate()`、`onCheck()`。保存失败不能触发选择变更；卷标题文字选择卷纲，折叠按钮只折叠。项目会话变更立即清理旧选择和未读响应。每项目记忆有效 selection 只属于 UI 偏好，不保存正式正文。

搜索时总纲和所有卷纲节点常驻；匹配章数为卷级计数。章节来自真实 `blueprints.volume_id`；预计数是卷纲计划文本提取/用户值，必须与实际数分开展示，不能用它改分配。

## 7. 版本变化、来源和衔接检查

上级编辑后按 source snapshot 显示受影响子项“上层已变化，建议检查”。没有 snapshot 的旧卷纲/章节显示“尚未建立来源关联”，不显示过期。重新运行检查产生新报告，但不会改写旧报告的检查版本或将内容来源静默更新。

确定性检查仅报告可证明事项（归属不存在、快照缺失/变化、必要章节/卷纲为空、章不属于目标卷）；剧情目标、人物计划、节奏和卷末衔接由 AI 提建议，明确标记为建议而非硬错误。证据中标注来源版本与引文位置。

## 8. 写作材料

生成、审稿、修稿等流程只按明确的 `drafts.blueprint_chapter_number` 读取目标蓝图，再按该章实际 `blueprints.volume_id` 读取当前卷纲。不得用 `chapter_volume_assignments`、正文显示章号或章号范围推卷。注入当前卷纲有界片段及相关章节摘要；不注入全书卷纲/章 detail。没有卷纲时保持既有 prompt/context；明确标注这是“计划”。读取覆盖逐个入口列入验收结果，未接入的流程不得声称覆盖。

## 9. 导入导出、删除与清空

- 总纲继续导入/导出原 Markdown 和现有 preview/confirm 路径，共用 synopsis CAS。
- 卷纲有独立 Markdown 导入预览/确认与导出；预览目标 `volumeId`、当前 revision/hash、导入 hash，确认 CAS 保存。支持自由节、空节和原文保真。
- 规划导出含 manifest/version、总纲原文、卷目录、卷纲原文、章归属、已有章 v2 内容，不含 prose、草稿或定稿。无整体导入按钮，除非之后另立契约实现实体映射、冲突预览和原子确认。
- 删除卷前返回影响预览（卷纲、章数、来源/检查）；确认时要求选“迁移子章至明确 volumeId”或“保留卷”。默认保留章细纲与正文，不级联删章/稿/定稿。改名保留 ID 和卷纲。
- 总纲清空、卷纲清空、章细纲清空分别操作与确认；既有 `db:blueprint-clear-all` 范围不扩大，规划新增表不能随之误清空。

## 10. 旧库迁移和兼容

新表空启动；旧长 synopsis、旧卷、章节 v2/raw Markdown、章卷归属、正文卷、草稿蓝图绑定逐字/逐项不变。旧库的 v2 content 缺 `planning` 时默认空。不会为旧卷自动插入卷纲行、拆解 synopsis、生成来源快照或改 chapter number。非法/失效卷 ID 留作可见修复状态，不按卷名、范围或正文归属猜测。迁移重复运行与事务失败必须验证原内容仍在。

## 11. 验收证据

使用临时目录/临时 SQLite 项目数据，覆盖旧长 synopsis、两卷、人工/导入 v2、无卷纲卷、空卷、独立 prose volume、绑定草稿、多版草稿、并发写和故障回滚。按用户执行指令第 10 节矩阵逐项验证：迁移原文；三类编辑保存/重开；候选取消/确认/幂等；唯一章号/卷归属/人工保护；v2 展开和 raw markdown；来源 stale；只读检查；实际写作材料；旧入口同源；删除/清空/导入导出；窄屏、深色、英文、搜索、键盘与失败状态。

测试从 `package.json` 选取聚焦 Vitest/类型检查入口，直接调用 Vitest 时不得经 `pnpm test` 的 native ABI pretest 覆盖正在被 Electron 使用的绑定。不得终止用户进程、操作真实项目 DB、运行真实生成、发布或推送。
