# Markdown 编辑器集成验收（2026-10-05）

## 结论

编辑器范围内的定向 UI、共享目录、保存与重启回读验证通过；真实 Electron 蓝图场景 24 步通过。仓库全量 `pnpm test` 仍为失败状态（29/410 个测试文件、146/3,721 项失败），因此本分支不是全盘绿灯，建议先由用户审阅全量失败清单，再决定是否合入主目录。未发现本次改动文件中的已确认产品回归。

验收过程中只调整了验收测试：全书总纲测试等待目录节点更新后再截图；Electron 蓝图场景改用当前页面的稳定测试 ID，显式选择章节，并验证切章自动保存后读回。业务保存实现未因这些场景修订而改变。

## 基线与集成

- 原始基线：`3e1a12448963d19765d8d52c54ab92338e64a682`。
- 共同准备提交：`6d7c97776a3a33513659b2116b71b332ac59399f`。
- AI A 功能提交：`d4cb5a229bf11bc1c508475e35edf682dfdf79a5`、`9cf37a529779112fff8c9e99978a4ae427943c1f`、`46709ae52539527488d08959b475e3b88f2bb5dc`、`b09a17cb2c2f1a79ccfaa75fe9b75d85bd603118`、`1aa57cb0e185d9be88462cfe32a9865dff0dc06b`。
- AI B 功能提交：`8656d0ae71db3b8c02a47d2d6f13f46af677ff60`、`cf0c42e47d4d9f17b1f68db3acb98f1d18622bee`。
- 集成提交：`dc1cf62d653df687724e54fc4f87b2cd5f4a5493`、`022551b4ccf8e8a2fb46e41b2cae490570e43af3`、`2ed9ad6b656a1e1c0c3a738845c44c01fe973be8`、`1f2ec7207dded3622304aa6c358dab0b61ff4621`。
- 最终验收分支：`codex/document-editor-acceptance`，工作树 `C:\Users\Administrator\.codex\worktrees\document-editor-acceptance\AI-Novel-Writer-master`。
- A、B 的实际代码都合入；页面通过 `DocumentEditingSurface` 使用 A 的完整目录实现。未检测到准备阶段空包装、重复目录组件或临时代码。合并没有冲突。
- 主目录未合并或改写；三个工作树均保留。未访问正式小说项目数据库，也未访问 `D:\Desktop\小说`。

## 页面清单

| 页面 / 范围 | 状态 | 验收证据和边界 |
| --- | --- | --- |
| 创作方向、写作规范 | 通过（UI） | 浏览器测试覆盖字段隔离、编辑和保存调用；AI 提示上下文全链路因全量套件里的过期 fixture 未验证。 |
| 故事前提 | 通过（UI） | 实际页面空状态及编辑器目录截图；短文/无标题状态正常。 |
| 世界设定 | 通过（UI）；AI 生成未验证 | 页面恢复/编辑浏览器测试通过；AI 工作流测试的 mock 未支持当前 `db:creative-legacy-list` IPC。 |
| 力量体系 | 通过（UI）；生产 preload 集成待核 | 默认、深色、窄面板及表单操作浏览器测试通过。全量 IPC 测试因断言没有接受新增 `markdown` 字段而失败。 |
| 地点与区域 | 通过 | 新增页面级浏览器验收：编辑、保存调用、切换实体、重新读取；后端使用独立临时 SQLite fixture，不经 Electron preload。 |
| 人物背景、能力、备注 | 通过（UI） | 页面级编辑测试覆盖资料字段与身份隔离。 |
| 素材与候选、废案 | 通过 | 浏览器测试覆盖状态边界、编辑、保存和隔离 fixture 回读。 |
| 未解决问题、待整理旧内容、信息与揭露 | 通过（UI） | 浏览器测试覆盖查看、编辑、创建、取消、保存失败保留内容和项目切换隔离。底层保存 IPC 没有逐页运行 Electron 端到端。 |
| 全书总纲、本卷卷纲 | 通过（UI）；持久化端到端未验证 | 页面级测试覆盖冲突保留、未保存标题进入 TOC；父级原保存流程由页面持有。 |
| 逐章细纲 | 通过 | 真实 Electron 测试覆盖迁移、字段读回、空章选择不落库、保存生成 r2、切章保存回读、Markdown 导入、正文上下文、退出后 SQLite 回读和重启幂等。 |
| 项目文档 | 部分通过 | UI 测试验证原 `docs:write` 调用、保存失败及未保存退出保护；另有真实文件系统 controller IPC 测试覆盖写入、列表、读取回读。两者不是同一个 Electron 端到端场景。 |
| 草稿与正文 | 通过（定向回归） | Vditor / DraftEditor 浏览器回归覆盖编辑、撤销/历史、焦点和视图行为；真实 Electron 场景验证创建草稿、章节绑定与正文上下文。 |

## 验证结果

- `pnpm typecheck`：通过，退出码 0。
- 页面浏览器组：18 个文件、124 项通过；新增全书目录实际节点断言后，相关业务页测试再次通过。
- 定向 Markdown / 项目文档存储单元组：3 个文件、28 项通过。项目文档 controller 使用真实临时文件系统；fixture 写入系统临时目录并在每个测试后清理。
- 真实 Electron 场景：`test/acceptance/scenarios/blueprint-unified-editor.mjs`，24 步通过；隔离项目位于 `C:\Users\Administrator\AppData\Local\Temp\vela-acc-task-d-2026-10-05T05-35-19-727Z-bb3067f6`。该场景用真实 main/preload 和临时 SQLite 数据库，退出后重开并验证 revision、分镜、章节绑定和迁移幂等。
- 全量 `pnpm test`：410 个文件中 379 通过、29 失败、2 跳过；3,721 项中 3,549 通过、146 失败、26 跳过。原始日志：`.runtime/document-editor-acceptance/logs/full-unit-test.log`。
- 全量失败中的可确认例子：`world-building-recovery.command.test.ts` 的 mock 抛出未预期 IPC `db:creative-legacy-list`；`novel-config-field-workflow.test.ts` 的 mock 未提供 `powerSystem.realms`；`cultivation-ipc.integration.test.ts` 期望值遗漏返回对象中的 `markdown`；`chapter-card-draft-ledger.test.ts` 静态断言仍要求已不在源码中的 `onDoubleClick` 字符串。其余失败详见日志。没有在共同基线上重跑全量套件，所以不把这些失败断言为已存在于基线。
- 浏览器控制台有 React `act(...)` 测试警告；定向断言通过。Electron runner 有 Node 子进程参数弃用警告；最终场景退出成功。

## 修改后截图

截图均来自真实业务页面或隔离 Electron 项目：

- `screenshots/blueprint-planning-book-outline.png`：全书总纲未保存 H2 已出现在右侧目录。
- `output/playwright/project-document-editor.png`：项目文档页面。
- `output/playwright/arch-premise.png`、`output/playwright/arch-worldbuilding.png`：故事前提和世界设定。
- `output/playwright/cultivation-settings-desktop.png`、`output/playwright/cultivation-settings-dark.png`、`output/playwright/cultivation-settings-narrow.png`：力量体系默认、深色和窄面板。
- Electron 全书纲要页面：`C:\Users\Administrator\AppData\Local\Temp\vela-acc-task-d-2026-10-05T05-35-19-727Z-bb3067f6\evidence\03-unified-editor-ch1.png`。
- Electron 正文上下文：`C:\Users\Administrator\AppData\Local\Temp\vela-acc-task-d-2026-10-05T05-35-19-727Z-bb3067f6\evidence\08-prose-reference.png`。

## 已知问题与影响

1. 仓库全量单元套件为红，不能据此宣布全仓无回归；需要用户决定是否先修理或基线核验上述测试 fixture / 合同漂移。
2. 创作方向和世界设定的 AI 提示上下文调用没有得到完整 workflow 单测确认。页面字段隔离和 UI 调用通过，但相关 mock 在生成前失败。
3. 项目文档的 UI→Electron controller→文件写入→重新打开链路由页面浏览器测试与 controller 文件系统测试分段覆盖，没有单一 Electron E2E 覆盖。
4. 地点与力量体系的页面存储浏览器 fixture 通过；地点没有单独的生产 preload E2E，力量体系 preload 测试当前因返回类型断言不一致失败。

## 在 IDE 运行隔离试验版

在 PowerShell 终端：

```powershell
Set-Location 'C:\Users\Administrator\.codex\worktrees\document-editor-acceptance\AI-Novel-Writer-master'
$runtimeRoot = Join-Path (Get-Location) '.runtime\document-editor-acceptance'
$env:AI_NOVEL_VELA_HOME = Join-Path $runtimeRoot 'vela'
$env:AI_NOVEL_DEV_USER_DATA = Join-Path $runtimeRoot 'user-data'
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot 'projects\manual-trial') | Out-Null
pnpm dev -- --port 5183
```

在应用里仅打开或新建 `$runtimeRoot\projects\manual-trial` 下的临时项目。该端口、Vela 数据目录、Electron user-data 和单实例锁均属于验收工作树。

## 接受或保留

- 接受后：由用户在 IDE 审阅验收分支，再将 `codex/document-editor-acceptance` 合入主目录当前分支；不要从旧基线覆盖主目录已有资料入口改造。
- 暂不接受：保留三个开发/验收工作树和验收分支，后续继续修复或复验。未收到用户明确指示前不删除或归档任何工作树。
