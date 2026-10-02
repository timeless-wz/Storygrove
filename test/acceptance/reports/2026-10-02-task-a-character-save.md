# 任务 A：新建人物无法保存 — 排查与修复记录

日期：2026-10-02。性质：实施与验证记录。基线：HEAD `7331f45` + 工作树（工作树上另有并发代理的在途改动，见文末边界说明）。

## 1. 结论（TL;DR）

**“新建人物能编辑、无法保存”的根因不是渲染层后台状态限制本身，而是一个双门死锁**：当项目角色名单处于受保护/未校准状态（真实旧项目升级后为 `legacy_cards_preserved`，或 ready 名单校验哈希漂移）时，roster seam 按设计拒绝一切手工保存；而 UI 横幅上唯一 advertised 出口（“重建只读图谱”/“校准角色名单”）走 `RepairLegacyCharacterRosterCommand`，它把**整条**执行包进 `executeWithGenerationRuntime`，在未配置默认生成模型时于 `createGenerationRuntime` 处直接抛 `NO_DEFAULT_MODEL`（“未配置默认生成模型。”）——尽管**采用/校准分支本身零 LLM 调用**（纯数据库校验 + 一次 roster commit）。作者因此被永久卡死：能新建、能编辑（本地草稿），永远无法保存，修复按钮又要求先配置 AI 模型。

全链路复现拿到的实际报错（修复前，真实主进程 + 真实渲染层 store + 真实 SQLite）：

```
[legacy] saveAll  FAILED with: Error: 角色名单状态不一致，已拒绝覆盖；请保留原数据并联系支持
                 （真实 legacy_cards_preserved 变体为：已有角色数据受到保护；请使用后续的显式迁移或编辑流程）
[legacy] repair  FAILED with: Error: 未配置默认生成模型。
[legacy] 再保存   FAILED with: 同上，死锁闭环
```

关键状态取证（修复前回读）：`revision=0，migrationState='legacy_cards_preserved'（或 ready+fact_hash 缺失），status='inconsistent'，entries>0`。

## 2. 排查过程（为何“后台状态限制”只是线索）

1. 渲染层 `character-store.saveAll` 的门槛（`dataProjectSession`/`lastError`/`rosterRevision`，即此前发现的“后台状态限制”）与 `updateField`/`addCharacter` 的门槛基本同源：**作者既然能新建和编辑，这些门槛必然已放行**。故真正报错必然发生在主进程 `db:character-roster-commit` 返回的 `{success:false}`。
2. 搭建全链路复现台架（真实 `initProjectDatabase` + 真实 db/fs 控制器 + 真实 preload 桥 + 真实 `character-store`，经隔离原生模块 runner 运行）：
   - **全新项目（无模型、无修炼体系）保存成功**（revision 0→1，回读一致）→ happy path 无缺陷，排除“保存链路天然依赖模型/修炼设置”的猜测；
   - **ready 名单上继续新增角色保存成功**（revision 1→2）；
   - **受保护名单场景复现死锁**（见上）。
3. 修炼侧排查结论：`prepareCultivationFacts` 在 IPC 通道无调用方；`CultivationRepository.save` 的等级删除经 resolutions 走 roster seam 原子处理；`resolveName` 对已删除等级返回空串不抛错。手工保存对修炼设置**无**残留依赖；等级已删除且有绑定时提交会得到明确报错（“修炼等级已删除，请重新选择”），属既有数据保护语义，未改动。

## 3. 修改差异（全部改动）

| 文件 | 修改 | 目的 |
| --- | --- | --- |
| `src/services/workflows/commands/legacy-character-roster-repair.command.ts` | `execute()` 先做一次只读预检：`migrationState==='legacy_cards_preserved'` 或 `status==='inconsistent' && entries>0` 时直接走 `adoptExistingCards`（不进入 GenerationRuntime）；其余（旧 Markdown 提取）保持原运行时约束 | **核心修复**：采用/校准分支零 LLM 调用，不再要求默认模型；安全语义不变（`adoptExistingCards` 内部仍重读快照并二次断言，revision/证据门禁原样保留） |
| `src/stores/character-store.ts` | 新增 `rosterCommitErrorText`：剥离主进程 `String(error)` 带来的多余 `Error: ` 前缀 | 验收项“保存失败有明确提示”：toast 不再显示 `角色卡保存失败：Error: Error: …` 噪声 |
| `src/services/workflows/__tests__/legacy-character-roster-repair.test.ts` | 既有 7 例的通道序列断言加入预检读取；**新增 2 例**：无默认模型时采用成功（且 `llm:begin-execution-lease` 从未被调用）、无默认模型时旧 Markdown 提取仍被拒且零提交 | 回归锁定 |
| `electron/controllers/__tests__/character-manual-save.integration.test.ts`（新增） | 4 例端到端集成回归，覆盖验收全项（见第 5 节） | 交付证据 |

未改动：`CharacterEditor.tsx`（“保存留编辑页 / 完成后返回概览”行为本就正确且有浏览器测试覆盖）、`character-roster-repository.ts`、`character-roster-repair-state.ts`、所有会话与 revision 保护。

## 4. 相关测试与结果

运行方式：`node test/acceptance/run-isolated-node.mjs node_modules/vitest/vitest.mjs run …`（隔离原生模块副本，规避并发 Electron 任务的共享二进制翻转）。

| 范围 | 结果 |
| --- | --- |
| 新集成回归 `character-manual-save.integration.test.ts` | **4/4** |
| `legacy-character-roster-repair.test.ts`（含 2 例新增） | **9/9** |
| `src/stores` + `src/services/workflows/__tests__` 全量 | **45 文件 / 464 例全过** |
| `electron/controllers` + `electron/repositories` 全量 | 65/66 文件通过；唯一失败为 `draft-repository-finalization-guard.test.ts`（drafts 表 `source_dependencies` 列迁移问题，**stage-3 报告 §6.2 已登记的在途失败，与本任务无关**） |
| CharacterEditor 浏览器测试（3 文件） | 18/19；唯一失败为 overview 断言缺“修炼等级”区块（`CharacterCultivationField` 在 HEAD `7fc352c` 加入 overview、测试未同步，**HEAD 上即失败的契约漂移**，且并发代理正在做修炼 UI 任务 task-c，本报告不越界改动） |
| `tsc --noEmit` | **exit 0** |

证据日志：`test/acceptance/evidence/task-a-character-save.log`。

## 5. 验收对照（逐条）

| 验收项 | 结果与证据 |
| --- | --- |
| 无默认模型、无修炼体系时，新建人物可以保存 | ✅ 集成回归第 1、2、3 例均在 `defaultModelId=null`（真实 `createGenerationRuntime` 路径）下完成保存 |
| “保存”保留编辑页，“完成”保存成功后返回概览 | ✅ 未改动该逻辑；`CharacterEditor.profile-edit.browser.tsx` 的 "saves every edited field without leaving edit mode, and completes only after saving" 通过 |
| 重开项目后人物及字段仍存在 | ✅ 集成回归第 1、2 例含 `closeProjectDatabase → initProjectDatabase → load` 后断言人物与字段完整 |
| 旧人物、关系、旧图谱和未保存输入没有丢失 | ✅ 集成回归第 2 例：旧主角的自由文本关系备注、`characters_arch` 投影、未保存的“林小新”草稿在“保存被拒→采用→再保存”全程保留；旧图谱证据 `legacyMarkdown` 门禁未被绕过 |
| 保存失败有明确提示并保留输入 | ✅ 拒绝报错原文清晰（“已有角色数据受到保护…”）；`rosterCommitErrorText` 去除前缀噪声；失败后断言草稿完整仍在 |
| 未取消项目会话、revision 等保护 | ✅ 集成回归第 4 例：过期 lease 的读写被拒；第 2 例：过期 revision 的直接提交被拒（“revision 已过期”）；仓储层 34 例 roster 测试全过 |

## 6. 数据库回读/重开验证说明

集成回归在**真实 SQLite 项目库**上执行：保存后经 `db:character-roster-read` 回读断言 `revision/status/entries/renderedMarkdown`；`closeProjectDatabase + initProjectDatabase` 模拟重开项目后再 `load` 断言持久化。以上断言全部进入回归测试，非一次性手工验证。

## 7. 边界与协作记录

1. 工作树上存在并发代理在途改动（sidebar/planning/cultivation UI 等，附其自有验收报告 task-b/task-c）；本报告未触碰其文件。
2. 两个已存在的失败（draft-repository 列迁移、CharacterEditor overview 契约漂移）均为 HEAD 上即存在的问题，分别由相应在途任务的负责人处理；本报告如实登记、不擅自修复。
3. Electron 场景未运行（E00/E01 类）；本任务以全链路集成测试 + 真实 DB 回读作为验证层级。
