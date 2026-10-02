# 任务 D 验收报告：章节蓝图统一版本

- 日期：2026-10-02
- 性质声明：本报告是**实施与验证记录**，不是验收通过证书。所有 PASS 均附执行证据；未执行项如实标注 NOT_RUN。
- 基线：commit `7331f45`（main）。工作区同时含有任务 A/B/C 的未提交交付物（character-save / sidebar-order / cultivation-menu-icon），本任务未改动这些文件；本轮构建与验收基于包含它们的当前工作区。
- 迁移映射说明：`docs/blueprint-unification-migration.md`；契约修订：`docs/blueprint-v2-contract.md` §7.4。
- 证据目录：`test/acceptance/evidence/task-d-blueprint-unification/`（runId `vela-acc-task-d-2026-10-02T04-09-56-624Z-5575cd92`）。

## 首页结论

- 章节蓝图的权威数据统一为 v2 细纲（`blueprint_details`），旧版编辑分支、「升级为 v2 细纲」按钮与面向用户的 v1/v2 版本字样全部移除；旧项目在打开时自动安全迁移，无需任何用户动作。
- 真实 Electron 界面场景 23/23 PASS：旧项目（仅 v1 行、0 条细纲）打开即迁移，统一编辑器完整显示原细纲、作者指导、事件、钩子；保存、取消、重开、Markdown 导入、场景画布、正文参考全部验证通过。
- 本轮发现并修复两个既有缺陷：① 旧「升级为 v2」脚手架缺尾随换行导致任何有内容的章升级必失败（`assertNoLossOnSerialize` 分区数 8→7）；② 导入对话框重复选择同一目标章会把 existingDetail 清空且不再重读，导致 baseRevision 0 冲突并绕过重导入合并。

## 1. 本轮实际修改

| 层 | 文件 | 修改 |
| --- | --- | --- |
| 共享层 | `src/shared/blueprint-v2.ts` | `buildBlueprintV2UpgradeScaffold` 重写为 `buildBlueprintV2MigrationContent`：title→章题行、purpose→positioning「核心使命」、suspenseHook→cliffhanger「章末钩子」、keyEvents→conflict「实质冲突与转折」逐字存档；storyboard 留空；条目 markdown 以换行结尾；条目 ID 由章节号确定性派生（`bpc-mig-<章号>-<slug>`）；支持 `origin: 'upgrade' \| 'manual'` |
| 仓库层 | `electron/repositories/blueprint-detail-repository.ts` | 新增 `migrateLegacyRows()`：迁移 `blueprints` 有行且 `blueprint_details` 缺行的章；内容全空行跳过；单章失败只记录并保留原行；走 `save`（baseRevision 0 乐观并发） |
| 主进程 | `electron/database.ts` | `initProjectDatabase` 挂载启动迁移（幂等，失败不阻断项目打开，含迁移日志） |
| 写作路径 | `src/services/workflows/commands/generate-draft.command.ts` | v2 注入块存在时保留 purpose 注入（v2 块不携带目标信息，迁移后的章不丢目标上下文）；keyEvents/suspenseHook 仍不重复注入 |
| 编辑器 | `src/components/editor/ChapterCardEditor.tsx` | 删除 v1 表单分支、`handleUpgradeToV2`、`blueprint-v1-hint`、v1 投影预览；统一为 v2 编辑器 + 「章节信息与作者指导」区（原 v1 独立字段中性化）+ 关联地图节点；无 v2 行的章以确定性种子展示（未编辑种子可直接写作）；切章清空上一章事实避免串显 |
| 导入对话框 | `src/components/editor/BlueprintV2ImportDialog.tsx` | 修复重复选择同一目标章清空 existingDetail 且不重读的缺陷（`existingLookupNonce`）；文案去版本化 |
| 文案 | 绑定对话框/参考面板/上下文侧栏/审查报告/提案 diff/配置影响预览/章节画布/目录工作流/智能体工具输出 | 「v2 细纲/旧版简纲/旧版字段提案」等用户可见字样全部中性化（详见映射说明 §4） |
| 文档 | `docs/blueprint-v2-contract.md`、`docs/blueprint-unification-migration.md` | §7.4 修订为统一迁移语义；新增迁移映射说明 |
| 测试 | 新增 3 个测试文件 + 更新 4 个既有测试 | 见 §5 |

## 2. 迁移前后数据对比（摘自证据 JSON）

**迁移前**（`task-d-before.json`）：`blueprints` 3 行（ch1/ch2 内容完整，ch3 占位空行），`blueprint_details` **0 行**——纯 v1 旧项目。

**迁移后**（`task-d-after.json`）：`blueprints` 3 行**原样保留**（user_guidance/notes/key_events/characters/volume_id 均未变），`blueprint_details` 2 行：

| 章 | revision | origin | 内容 |
| --- | --- | --- | --- |
| 1 | 2（迁移 r1 + 界面保存 r2） | upgrade | 七分区齐全；核心使命/实质冲突与转折/章末钩子逐字在位；storyboard 留空 |
| 2 | 2（迁移 r1 + Markdown 导入 r2） | import | 2 个分镜（场景一/场景二）+ 字数预算 4200 |
| 3 | 无行 | — | 占位空章按设计不迁移（保持可被工作流批量写入） |

`drafts` 表 1 行（场景中新建），`blueprint_chapter_number=1` 绑定完好；正文草稿历史与审查快照未被触碰。

## 3. 真实界面场景结果（23/23 PASS）

场景：`test/acceptance/scenarios/blueprint-unified-editor.mjs`（隔离 runner：`node test/acceptance/run-isolated-node.mjs test/acceptance/scenarios/blueprint-unified-editor.mjs`）。证据为 evidence 目录内 `task-d-steps.json` + 截图 12 张 + `ui-actions.jsonl` + `diagnostics.json`。

| # | 步骤 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 当前源码构建 | PASS | build.log |
| 2 | Electron ABI 切换 | PASS | abi.log |
| 3-4 | 首次启动建库 + 正常退出 | PASS | 01-first-launch.png |
| 5 | 写入 v1-only 旧项目 fixture | PASS | task-d-before.json |
| 6 | 二次启动（迁移发生） | PASS | 02-launch-2.png |
| 7 | 统一编辑器唯一（升级按钮 0、旧版提示 0、状态行无 v2 字样） | PASS | 03-unified-editor-ch1.png |
| 8 | 迁移内容可见（章题/核心使命/事件/钩子） | PASS | 03 同页 |
| 9 | 独立字段保留（作者指导/章节要点） | PASS | 03 同页 textarea |
| 10 | 占位空章种子展示（r0）且零数据库写入 | PASS | task-d-after.json ch3 无行 |
| 11 | 保存产生 r2 | PASS | 04-after-save-and-cancel-check.png |
| 12 | 取消不保存：哨兵输入切章往返保留、数据库保持 r2 保存值 | PASS | 同上 |
| 13 | 场景画布打开 | PASS | 05-canvas.png |
| 14 | Markdown 导入（解析预览→确认→分镜可见 r2） | PASS | 06/06b/07-imported-scenes.png |
| 15 | 正文参考：新建正文 → 本章创作上下文显示目标与钩子 | PASS | 08-prose-reference.png |
| 16-17 | 退出（正常路径，非强制） | PASS | ui-actions/lifecycle |
| 18 | 退出后数据库回读（映射/独立字段/占位章/草稿绑定） | PASS | task-d-after.json |
| 19-20 | 三次启动：统一界面保持、显示最后一次保存值 | PASS | 09-restart.png |
| 21 | 重启后数据逐字节不变（迁移幂等） | PASS | after vs restart 对比 |
| 22-23 | 正常退出 + Node ABI 恢复 | PASS | abi-restore.log |

迁移前后数据对比结论：原细纲、作者指导、事件、钩子、场景内容**完整保留**；章节/卷/场景引用稳定（章节号主键、卷归属、画布 `refs.sceneId` 均未变动）。

## 4. 本轮发现并修复的缺陷

| # | 缺陷 | 位置 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | 旧升级脚手架条目 markdown 无尾随换行：purpose+钩子同时存在时两条目拼行、相邻分区标题被吞，`assertNoLossOnSerialize` 必然失败——即旧「升级为 v2 细纲」按钮对任何有内容的章实际无法完成升级 | 旧 `buildBlueprintV2UpgradeScaffold`（实测复现：分区数 8→7） | 新迁移构建器所有条目以换行结尾、多行续行缩进；迁移内容必须通过无损自检才能落库 | `blueprint-v2-migration.test.ts`（含回归用例）；场景 PASS |
| 2 | 导入对话框重复选择同一目标章：onChange 无条件 `setExistingDetail(null)` 而 effect 以 targetChapter 为键不重跑 → existingDetail 永久为 null → 保存以 baseRevision 0 发出（与现有 r1 冲突），并绕过重导入合并基底（同名分镜 ID 保留失效） | `BlueprintV2ImportDialog.tsx` onChange/effect | 引入 `existingLookupNonce`：每次手动选择都强制重读现有细纲 | 新增浏览器回归用例；场景步骤 14 由 FAIL 转 PASS |
| 3 | （顺应修复）v2 注入块存在时 purpose 被一并清空，迁移后的章丢失「主角小目标」上下文 | `generate-draft.command.ts` | purpose 恢复保留注入；keyEvents/suspenseHook 维持不重复注入 | `generate-draft.command.test.ts` 断言更新并通过 |

基线既有失败（与本任务无关，已用基线工作树/导入分析双重确认）：`draft-repository-finalization-guard.test.ts`（fixture 缺 `source_dependencies` 列）、`creative-workbench-closure.test.ts`（layout-store `openChapterCreation` 在 HEAD 即为无条件打开，测试固定旧行为）。

## 5. 最终验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | PASS（0 错误） |
| `npx vitest run`（全量 node 回归，3540 用例） | 3511 passed / 2 failed（均为上述基线既有失败）/ 27 skipped |
| 蓝图相关 node 套件（10 文件：契约/迁移/仓库/写作/目录/智能体工具） | 214/214 PASS |
| 蓝图相关浏览器套件（5 文件：导入对话框/编辑器/写作入口/参考面板/画布） | 25/25 PASS |
| `node test/acceptance/run-isolated-node.mjs test/acceptance/scenarios/blueprint-unified-editor.mjs` | 23/23 PASS |

## 6. 覆盖矩阵（分母含 NOT_RUN）

| 维度 | 本轮覆盖 | NOT_RUN（未执行，不折算） |
| --- | --- | --- |
| 统一界面（旧/新项目） | 场景 7/19/20（旧项目迁移后 + 全新项目均为统一编辑器） | — |
| 内容保留 | 场景 8/9 + task-d-before/after.json 逐字段对比 | — |
| 保存/取消/重开 | 场景 11/12/19/20/21 | — |
| Markdown 导入 | 场景 14 + 导入对话框浏览器测试 3 例 | — |
| 场景画布 | 场景 13（打开）；画布编排的写路径由既有 `chapter-canvas-blueprint.browser.tsx` 覆盖 | 排上/移出画布对迁移章的端到端操作 NOT_RUN |
| 正文参考 | 场景 15（本章创作上下文） | ProjectReferencePanel 在真实 Electron 中的打开 NOT_RUN（组件级浏览器测试 7 例覆盖） |
| 幂等/失败保留 | 仓库测试 7 例（重复执行、失败保留原行、空行跳过、已有细纲不动、缺表容错） | 启动迁移在真实损坏 DB 上的重试 NOT_RUN |
| AI 写作注入 | 单测层面（v2 块注入 + purpose 保留） | 迁移章的真实 AI 生成端到端 NOT_RUN（需 LLM stub 全链路场景） |

## 7. 环境与协作记录

- Windows 10.0.26200 x64；隔离 runner（独立 Node ABI SQLite 12.8.0 ABI 137）；Electron 裸启 + CDP attach；三次启动/退出全部为用户正常路径（非强制结束）。
- 运行根：`%TEMP%\vela-acc-task-d-2026-10-02T04-09-56-624Z-5575cd92`（证据已归档至仓库）。
- 工作区含任务 A/B/C 并行交付物；本轮未触碰其文件，其浏览器审计快照改动（nav-browser-audit 等）保留原样。

## 8. 下一步（按优先级）

1. 将本任务与任务 A/B/C 交付物一并提交，避免后续验收基线漂移。
2. 基线既有失败两项（draft-repository fixture、creative-workbench-closure 旧行为断言）建议单独立项修复。
3. 评估把 v2 草稿账本纳入退出保存清单（`BACKGROUND_LEDGER_BY_EDITOR_TYPE`）——当前退出时不保存未保存细纲草稿为既有语义，统一编辑器后用户在细纲上的未保存输入占比上升，值得复核。
