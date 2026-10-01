# 全功能验收：修复阶段交接（2026-10-01）

用户已要求停止，由其他 AI 接手。本文是实施和验证记录，**不是全功能验收通过报告**。

## 当前状态与边界

- 工作目录：`D:\ai\AI-Novel-Writer-master`。
- HEAD：`b1cf592a3b2720809b20eac84e8bfe132d797587`。
- 停止时 `git status --short` 有 212 个条目。开始的阶段一报告记录 189 个；包含大量既有改动和其他工作，不能全部归因于本轮。没有提交、合并或发布。
- 用户授权是“修复问题并继续推进验收”；最新指令是“停一下，汇总……让其他 AI 接手”。本轮两个完整回归进程已用 Ctrl+C 中断，返回退出码 1。其他正在运行的应用和任务没有被主动关闭。
- `D:\Desktop\小说` 绝对只读；未将真实母稿用作测试写入目标。
- 方案：`docs/plans/full-chain-functional-acceptance-2026-10-01.md`。阶段一原报告：本目录的 `2026-10-01-stage-1.md`；用户附件亦有阶段一交接文本。
- F01–F32、E01–E08 尚未取得整体业务验收通过。E00 是台架最小自证，不能代替业务验收。

## 已完成的修改

### 1. 验收台架误判修复

- `lib/fixtures.mjs`：运行目录创建排除 `runId` 字符串，避免在工作目录生成无关目录。
- `lib/storage-checker.mjs`：修复真实 schema 的列名（blueprints 主键是 chapter_number、characters 主键是 name、卷顺序是 sort_order）；查询错误直接失败，不能把错误对象当成功快照；快照回读全部 SQLite 表并稳定排序，草稿包括关联正文；数据库体检拒绝表计数 ERROR；隔离检查核对真实 project_name 和双方独特标记，而非不存在的 title/novel_title。
- `inventory/features.json`：重复的 `storage` 键改为状态 `storage` 与目标数组 `storageTargets`；补齐每个场景三维状态。未执行项保持 NOT_RUN。
- `lib/electron-driver.mjs`：启动失败关闭本次应用；退出监听在请求退出之前注册，避免退出竞态；增加 finally 原生模块恢复边界及可注入验证。
- `scenarios/e00-project-persistence.e2e.mjs`：每次构建当前源码，避免旧产物；异常也执行原生恢复；第二次启动前删除旧 marker，要求主进程生成新收据；核对必要业务表而非仅表数量；成功/失败证据按 runId 归档。
- `inventory/scan-inventory.mjs`：加入 scripts SQL（MCP 实际写入此前被漏扫）；用 TypeScript AST 提取 SQL 字符串，减少 import/comment 被识别成表名；输出明确属于静态候选，不宣称运行时全覆盖。
- 最新扫描：356 个声明调用通道、356 个唯一处理器，双方差集为 0；另有 6 个事件。表登记 111，写入归属候选 113；孤立表 1 个（legacy 迁移表），未知引用 3 个（旧迁移表名）。这些数字是静态结果。
- `__tests__/harness.node-test.mjs`：新增 4 个台架故障边界测试，覆盖真实 schema 回读、跨项目污染、SQL 错误、finally 恢复及登记字段完整性。

### 2. 运行环境隔离

完整 Node 回归开始前 SQLite 是 Node ABI 137；运行期间共享二进制变成 Electron ABI 145，随后恢复时报文件占用 EPERM。发现另有运行中的 Electron 实例，不能把这批数据库加载失败计为业务失败，也没有关闭别人的进程。

- 新增 `lib/isolated-node-runtime.mjs` 和 `run-isolated-node.mjs`。
- 从 npm 已缓存的 **相同版本** better-sqlite3 Node 预构建包提取独立二进制到 `.runtime/acceptance-native/`，记录缓存包 SHA-256；先真实内存数据库探测，再通过 Node 预加载 hook 指定 nativeBinding。
- 使用真实 SQLite 和原包 JavaScript，不 mock 数据库，也不改应用 node_modules 二进制。hook 仅对匹配的 Node ABI 生效；Electron ABI 不使用 Node 副本。
- 当前已验证：better-sqlite3 12.8.0 / Node ABI 137，4 个台架用例通过。
- 这是新增加的验收运行方式，完整回归还没有跑完。要求本机缓存存在相应版本的预构建包，缺失时直接失败；README 尚未完整更新到此方式。

### 3. 产品或运行链路修复

- `scripts/real-provider-generation-qualification.mjs`：Node esbuild 资格验证将 CSS 用 empty loader 处理，修复 UI 间接导入导致 Node 打包失败；没有发起真实模型请求。
- `src/components/layout/LeftToolWindowBar.tsx`：导航按钮增加 aria-label，使设置按钮有稳定可访问名称，可供现有 Electron E2E 定位。真实 renderer E2E 尚未重跑。
- `scripts/start-story-mcp.mjs`：先探测当前 Node SQLite 能否加载；可加载则用 Node，不能则用已有 Electron Node runtime。避免固定 Electron 运行时与 Node 原生 ABI 冲突造成 MCP 启动失败。此前针对性 MCP 回归已通过，完整回归尚未完成。
- `src/shared/finalization.ts`：提取 FinalizationSnapshot / FinalizationResult 共享契约；`ipc-channels.ts` 补登记 finalization 三个窄类型通道；客户端与 Electron 服务使用同一契约。类型检查通过；修改后的 finalization 相关回归仍需最终核对。
- `src/index.css`：浏览器确认图片皮肤文字表面透明度不足；为高对比图片皮肤的欢迎、卡片、页面表面增加最低 88% 不透明度。一次验证已消除原先的主题表面对比度失败，4.5 阈值保留。
- `src/components/editor/vditor-prose.css`：`.vditor-content` 的桌面背景 fallback 补入 `--bg-base`，与同文件其余桌面容器一致，修复 starlight 深色桌面误用浅色纸面。**这是最后一项产品修改，尚未验证。**

### 4. 旧测试契约修复

依据现有实现补齐 fixture，不放宽业务失败、绑定、确认等检查：

- issue-90-agent-project-actions：兼容实际使用的 blueprint-list-summary，并显式返回 v2 空值。
- mutation-failure-boundary：提供冻结的真实草稿正文、绑定及 v2/v1 fixture；缺少细纲测试断言 unavailable，保留项数/字数/失败边界。
- finalize-postprocess-character integration：补 v2 查询空值 stub。
- project-service-refresh-context：补 proposal sync 所需 on 订阅；project-refresh-context：补 v1/v2 summary 查询。
- agent-proposal-service：审批 fixture 改为受支持 blueprint 类型并具备有效会话；保留作者和重复审批检查。
- creative-workbench-closure：按已冻结蓝图契约断言摘要来源 purpose/keyEvents，不把 userGuidance 指令混进剧情摘要。
- `test/source-contract.ts` / `.test.ts`：仅允许 AST 验证过的不可见、静态几何 SVG clip definitions；实际显示 SVG、其他标签、动态路径仍拒绝。两个视觉源码契约使用该过滤器。
- app-skin-background：跟随已有 frost surface fallback 契约更新旧期望。
- agent-tools-contrast browser：light/paper 普通文字颜色改为现有主题真实值 rgb(31,41,55)；**此最终修改尚未验证。**
- theme-computed-contrast browser：starlight 桌面仍断言深色 [16,23,34]，未降低对比度标准。中途尝试将期望改成浅色后已撤回，最终修复在 CSS。

## 验证结果（不要合并成“全绿”）

证据均位于 `test/acceptance/evidence/`。

| 证据 | 结果 / 有效范围 |
|---|---|
| repair-node-final-focus.log | 3 文件、70 用例通过；mutation / project refresh / source-contract 的针对性检查 |
| repair-harness-node.log | 4 个台架用例通过 |
| repair-harness-isolated.log | 独立 SQLite 环境中同样 4/4 通过 |
| repair-typecheck-final.log | tsc --noEmit 退出码 0；日志空是正常成功；发生在最后 CSS 改动之前 |
| repair-focused-01/02、repair-failed-node-files、repair-node-remaining 等日志 | 是逐步修复的中间结果，各有历史失败；不能当当前完整通过证据 |
| repair-full-node.log | 78 文件失败、303 通过、2 跳过；614 用例失败，大量为运行时 ABI 被切换。**环境污染，无有效业务总判定** |
| repair-full-node-isolated.log | 用户叫停后中断，**无最终汇总，不算通过** |
| repair-contrast-first.log | 29 失败 / 49 通过，确认原表面对比度问题及 starlight 桌面问题 |
| repair-contrast-second.log | 3 失败 / 79 通过；剩余为 starlight 桌面及 light/paper 两个文字色期望；其后的 CSS/期望修改尚未重跑 |
| repair-full-browser.log | 用户叫停后中断，**无最终汇总，不算通过** |
| 原阶段一 E00 结果 | 只能证明旧台架运行；修复后的 E00 尚未重跑，不能沿用旧 PASS |

## 未完成事项和建议接手顺序

1. 先核对最新 dirty diff，保留既有改动。不要 reset、覆盖、清理用户文件或关闭其他任务进程。新加 shared IPC 的 import 排列可随后按项目风格整理。
2. 使用独立 SQLite runner 重跑对比度两个 browser 文件和源码 app-skin 契约；88% 新 token 可能使旧源码字符串期望需要更新，应保留实际浏览器 4.5 标准。
3. 完整 Node 回归和完整 browser 回归跑到最终汇总；先区分环境问题、过期 fixture 与真实产品缺陷。浏览器多数旧失败还没有处理，不可声称仅剩 3 个。
4. E00 用独立 Node runner 重跑；注意它仍执行 rebuild:electron，若共享应用二进制需要被改写，须处理占用，不能关闭无关进程。Node 预加载 hook 使恢复脚本探测独立副本；证据中应明确这是独立 Node ABI 验证，不是已把共享二进制改回 Node。
5. 重跑 `scripts/renderer-surface-e2e.mjs`，验证 aria-label 修复及真实主题/设置链路。脚本有自己的视觉证据目录约束，应阅读脚本和对应测试后运行。
6. 开始实现 E01。**本轮只研究了 UI 入口，没有创建 E01 场景文件，也没有跑任何 E01 业务步骤。**可先完成“手动自由草稿新建→编辑→保存→退出重开→独立 SQLite→A/B 隔离”，独立登记为部分分支。
7. 完整 E01 仍需设置/角色、两卷蓝图/v2 细纲、画布、绑定、生成、审稿、人工确认、修稿差异、定稿/实体发布、按卷导出和重开；随后 E02–E08。AI provider 的真实能力与凭据仍未验证，本轮未调用模型服务。
8. 插件回归原有两个 symlink 失败未处理；导入/导出、备份恢复、LanceDB 检索、全局设置、异常/取消/跨会话等业务验收未完成。
9. 更新 README、features.json 状态及阶段报告时，每个 PASS 必须对应本次明确证据；F01–F32 仍不能整体标 PASS。

### 接手命令（仓库根 PowerShell）

```powershell
node test/acceptance/run-isolated-node.mjs --test test/acceptance/__tests__/harness.node-test.mjs
node node_modules/typescript/bin/tsc --noEmit
node test/acceptance/run-isolated-node.mjs node_modules/vitest/vitest.mjs run --reporter=dot
node test/acceptance/run-isolated-node.mjs node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/settings/__tests__/theme-computed-contrast.browser.tsx src/components/panels/agent/__tests__/agent-tools-contrast.browser.tsx --reporter=dot
node test/acceptance/run-isolated-node.mjs node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts --reporter=dot
node test/acceptance/run-isolated-node.mjs test/acceptance/scenarios/e00-project-persistence.e2e.mjs
node test/acceptance/inventory/scan-inventory.mjs
```

完整回归建议顺序执行，日志写不同文件。之前本机 `pnpm exec vitest` 命令解析失败，以上使用本地显式 Node 入口。浏览器 API 端口可通过 `AI_NOVEL_VITEST_BROWSER_API_PORT` 设置以避开其他任务。

### E01 已查到的 UI 路径

- `src/components/panels/sidebar/DraftBoxGroup.tsx` 的“新建草稿”按钮打开 `NewDraftDialog.tsx`。
- 对话框章节输入 id：`new-draft-chapter-number`，提交文案：“创建并开始写作”；走真实 next-version/create IPC 后打开 vela://draft/id。
- `src/components/editor/VditorProseEditor.tsx` 根标记 `[data-vditor-prose-editor="true"]`；可见编辑面在 `.vditor-ir` 或 `.vditor-wysiwyg` 的 `pre[contenteditable="true"]`。
- `DraftEditor.tsx` 保存走真实 session-scoped IPC；按钮文案“保存”，标题“保存（⌘S）”。以成功保存后的 DB 正文及重开 UI 为判据，不能只检查按钮点击。

## 对阶段一疑点的纠正

- `mcp_audit_log` 有实际脚本写入，不能因旧扫描漏掉 scripts 就判定没有 writer。
- zoom 当前由 theme-store 的 `ai-novel-writer-theme.zoom` 持久化；`vela-zoom-level` 是旧键。旧键与新键恢复优先级仍待验证，不能简单判定“只读无写，所以缩放没有存储”。
- `provider-presets.json` 和日志目录的存在或注释不足以证明功能完善或失效；应按真实调用和合同验证。
