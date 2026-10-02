# 章节蓝图统一版本 — 迁移映射说明（任务 D）

> 生效范围：章节蓝图（chapter blueprint）的权威数据与编辑体验统一。v2 细纲
> （`blueprint_details` 表，`src/shared/blueprint-v2.ts` 类型）成为唯一权威；
> 旧版简纲编辑分支、「升级为 v2 细纲」按钮与面向用户的 v1/v2 版本区分全部移除。
> 数据契约见 `docs/blueprint-v2-contract.md`（§7.4 已按统一后语义修订）。

## 1. 迁移映射（v1 简纲行 → v2 细纲内容）

唯一实现：`buildBlueprintV2MigrationContent`（`src/shared/blueprint-v2.ts`）。
启动迁移（主进程）与编辑器种子（渲染进程）共用，保证两条路径产物一致。

| v1 字段（`blueprints` 列） | v2 去向 | 说明 |
| --- | --- | --- |
| `title` | 章题行 `第N章｜<title>`（H3，`chapterTitleLevel: 3`） | 空标题 → `第N章` |
| `purpose` | positioning 分区 field 条目「核心使命」 | `projectV2ToV1` 的 purpose 投影锚点 |
| `suspenseHook` | cliffhanger 分区 field 条目「章末钩子」 | 投影锚点 + 写作注入（§9.2 cliffhanger）+ 审查「章末钩子」检查的锚点 |
| `keyEvents` | conflict 分区 field 条目「实质冲突与转折」，**逐字存档**（多行续行缩进两空格） | 不伪造成分镜；storyboard 留空待作者补写/导入 |
| `role` / `characters` | 不进入 v2 | 保留在 v1 行；统一编辑器「章节信息与作者指导」区继续编辑；写作注入两条路径均保留 |
| `userGuidance` | 不进入 v2 | 同上（作者微操指导，写作时最高优先级注入） |
| `notes` / `notes_updated_at` | 不进入 v2 | 同上（章节要点，定稿后自动提取） |
| `volume_id` | 不进入 v2（v2 从不携带卷） | 保留在 v1 行；卷归属由「所属卷」下拉继续编辑 |
| `created_at` / `updated_at` | 不进入 v2 | v1 行保留 |

结构化产物：七个规范分区（positioning/conflict/storyboard/rules/cliffhanger/foreshadow/taboos）
按注册顺序齐全，`origin: 'upgrade'`（启动迁移）或 `'manual'`（编辑器种子/新建章）；
`raw_markdown` = serialize 结果；`revision` 从 1 起；`content_hash` 按 §3 计算。

**回归修复（验收中发现）**：导入对话框重复选择同一目标章曾把 existingDetail 清空且不再重读（effect 仅以 targetChapter 为键），导致保存以 baseRevision 0 发出并与现有细纲冲突，同时绕过重导入合并基底（同名分镜 ID 保留失效）。已通过 `existingLookupNonce` 强制每次手动选择重读现有细纲修复，并有浏览器回归用例覆盖（`BlueprintV2ImportDialog.browser.tsx`）。

**回归修复**：旧「升级为 v2 细纲」按钮生成的脚手架条目 markdown 缺少尾随换行，
purpose 与 suspenseHook 同时存在时两个条目拼行、相邻分区标题被吞，导致保存时
`assertNoLossOnSerialize` 必然失败（`分区数量 8 → 7`）——即旧按钮对任何有内容的章
实际无法完成升级。新构建器所有条目以换行结尾，迁移内容必须通过无损自检才能落库。

## 2. 迁移执行路径与安全语义

| 路径 | 触发点 | 实现 |
| --- | --- | --- |
| 启动迁移 | `initProjectDatabase`（项目打开） | `BlueprintDetailRepository.migrateLegacyRows()`：`blueprints` 有行且 `blueprint_details` 缺行的章逐章迁移 |
| 编辑器种子 | ChapterCardEditor 载入章发现无 v2 行（工作流本轮写入的简纲行、启动迁移失败章、本地新建章） | 同一映射生成种子内容 → 本地草稿账本；「保存细纲」经 `db:blueprint-v2-save`（baseRevision 0）落库 |

- **幂等**：目标集合以「`blueprint_details` 缺行」为准；重复执行/重启不会产生重复
  内容，也不会提升已迁移章的 revision。
- **失败保留**：单章迁移失败只记入 `failed` 并跳过，v1 行原样保留（无半截 v2 行），
  下次项目打开自动重试；迁移整体异常不阻断项目打开。
- **空行跳过**：title/purpose/keyEvents/suspenseHook 全空的 v1 行（新建占位章）不迁移，
  保持可被目录/拆书工作流批量写入（避免空脚手架章被 v2 覆盖防护挡住）。
- **并发**：落库走 `db:blueprint-v2-save` 的乐观并发（baseRevision 0 = 期望不存在），
  迁移期间被并发写入的章按 conflict 跳过，绝不覆盖。
- **保留承诺**：正文草稿历史（`drafts` 版本行）、审查确认快照中的蓝图版本证据
  （`BlueprintReviewEvidence { revision, contentHash }`）与画布节点引用一律不动。

## 3. 统一编辑界面（ChapterCardEditor）

- 渲染分支只剩：场景画布 / 细纲只读恢复（corrupt、schema 超前）/ 读取失败 /
  **统一细纲编辑器** / 载入态。旧版简纲表单分支、`blueprint-v1-hint` 提示、
  「升级为 v2 细纲」按钮（`blueprint-v2-upgrade`）与「v1 投影预览」全部删除。
- 统一编辑器组成：章题行输入、`BlueprintV2Editor`（七分区 + 自定义分区 + 逐场分镜）、
  「章节信息与作者指导」区（所属卷/章节定位/出场关键人/作者微操指导/章节要点，
  独立保存）、关联地图节点（只读识别展示）。
- 无 v2 行的章以确定性种子内容展示（条目 ID `bpc-mig-<章号>-<slug>` 派生自章节号），
  未编辑过的种子可直接启动写作（写作数据源 v1 行与种子一致）；一旦编辑即成为普通
  未保存草稿，取消不落库、保存失败保留输入。
- `data-testid` 命名（`blueprint-v2-*`）保持不变以兼容既有测试与验收脚本；测试 ID
  非用户可见文案，不属于"面向用户的版本区分"。

## 4. 面向用户的版本字样清理

| 位置 | 修改 |
| --- | --- |
| ChapterCardEditor | 删除升级按钮/旧版分支/v1 提示/投影预览；状态行「v2 正式细纲」→「正式细纲」；「v1 独立字段」→「章节信息与作者指导」；「保存 v1 字段」→「保存章节信息」；删除确认去掉 v2 字样 |
| BlueprintV2ImportDialog | 「该章已有 v2 细纲（版本 rN）」→「该章已有细纲…」；「损坏的 v2 细纲」→「细纲数据损坏」；「同步投影 v1 字段」→「同步更新章节概要字段」 |
| BlueprintBindingDialog | 绑定列表「第N章（v2）」后缀移除 |
| ProjectReferencePanel | 「阅读完整 v2 细纲」→「阅读完整细纲」 |
| ChapterContextSidebar | 「旧版简纲投影」→「章节概要投影」；「旧版简纲没有正式分镜数据」→「本章细纲暂无正式分镜数据」 |
| ReviewReport | 「绑定蓝图 v2 数据损坏/不可读取」→ 去掉 v2 |
| DomainProposalDiff / ConfigImpactPreview | 「v2 完整细纲」→「完整细纲」；「旧版字段提案」→「字段提案」 |
| 章节画布 / 工作流日志 / 智能体工具输出 | 「v2 细纲分镜」→「细纲分镜」；「已注入本章 v2 细纲」→「已注入本章细纲」；写作块头「【本章细纲（蓝图 v2 任务书）…】」→「【本章细纲任务书…】」；read-blueprint 输出段名中性化 |

保留的内部兼容（不面向用户）：`blueprint-v2-*` 通道与测试 ID、智能体工具参数
`v2_markdown`、`origin` 枚举值、`schemaVersion: 2`、`readStatus`（corrupt /
needs-newer-app 的前向兼容提示，属损坏处理而非版本区分）、ChapterCardEditor 源码
注释中的 v1/v2 术语（内部契约语言）。

## 5. 已知行为变化（有意为之）

1. **写作注入**：v2 注入块存在时，`keyEvents`/`suspenseHook` 的 v1 投影摘要仍被清除
   （避免重复注入），但 **purpose（主角小目标）恢复保留注入**——v2 块不携带目标信息，
   统一迁移后的章不丢失目标上下文；对已有完整细纲的章为纯增益。
2. **迁移后的章受 v2 覆盖防护**：启动迁移后所有有内容的章都有 v2 细纲，目录/拆书
   工作流的批量 v1 提交将跳过这些章（§7.4 既有语义的全面生效，防止覆盖作者细纲）；
   空占位章仍可被工作流填充。
3. **「删除细纲」后的回显**：删除 v2 行后重新载入章，编辑器按统一规则从 v1 行再次
   生成种子内容（v1 行从未被删除），不再出现旧版表单。
