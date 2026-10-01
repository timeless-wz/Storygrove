# 蓝图 v2 后续修复与复验

基线：`b1cf592a3b2720809b20eac84e8bfe132d797587` 加主工作区现有未提交修改。未提交、合并或清理工作树。未操作 `ChapterOutlineSidebar.tsx`；后续发现它被外部恢复，见第 6 节。A、D、E 工作树未操作。

**结论：指定章节写作入口的 v2/旧版两条链路通过；本轮整体验收仍受主目录 Node ABI 恢复阻塞，不能宣布全部端到端验收完成。**

最新补验见第 6 节：同项目 UI 连续链路及最终构建普通启动/重启通过；主目录 ABI 仍未恢复。此前失败与限制作为历史记录保留。

## 1. 原生模块

- 本轮实测 Node `24.14.0` / ABI `137`；主目录 `better_sqlite3.node` 仍为 ABI `145`，普通实例化仍报版本不匹配。
- 最后查询仍返回 PID `30800`、`34604` 为 Electron；未假定它们退出，未终止它们，未尝试覆盖正在使用的原生文件。
- 使用现有 `test/acceptance/run-isolated-node.mjs`，从缓存中的同版本 `better-sqlite3 12.8.0` 建立独立 Node ABI 137 副本，真实 SQLite 探测成功。此方式不修复主目录 ABI。
- 三个受影响文件重新运行：**3 文件、33 项通过**。当前测试数与旧报告的 28 项不同，结果以本轮日志为准。
- 占用者由所有者安全关闭之后，仍必须执行普通 `node scripts/prepare-native-for-node.mjs`、普通 SQLite 实例化探测，再用普通 Node 运行这三个文件；独立副本结果不能替代这一步。

证据：[三文件重跑](../../test/acceptance/evidence/followup-blueprint-native-isolated.log)。

## 2. 恢复两个产品入口

源码核对发现，HEAD 基线和当前工作区都没有审稿 AI 修稿按钮，且 `openChapterCreation` 为空函数、App 未挂载章节创作弹窗。用户分别授权恢复这两个入口后实施：

- `ReviewReport.tsx`：恢复“按确认意见修稿”、单次模型选择、按项目写作语言展示确认指导、生成独立修订稿。启动前回读持久化确认记录，核对冻结源稿、当前正文、未保存的编辑器正文、蓝图绑定/版本/哈希；无纳入事项或清单正在编辑时不能启动。修稿命令自身的权威记录校验仍保留。
- `ReviewReport.confirmation.browser.tsx`：按真实“修改决策清单”“恢复”交互更新；mock 保存并回读确认记录。保留原始 AI 报告、忽略/重新纳入、人工问题、重新确认、持久化重开、英文预览、模型选择、全忽略阻断、草稿变化覆盖；新增持久化记录变化、蓝图版本变化和未保存正文保护。等待确认记录真正写入后再模拟编辑，避免把异步确认未完成误当成已确认。
- `ChapterCardEditor.tsx`、`layout-store.ts`、`App.tsx`：在 v2 和旧版蓝图页恢复“写作此章”及原有 `ChapterCreationDialog`；只允许权威下一章启动，未保存蓝图先显式保存。
- `ChapterCreationDialog.tsx`：接纳蓝图传入的预算；补齐“建置”定位选项。v2 的 4200 字不再在弹窗里显示为默认 3000。
- 组合回归发现目录角色同步测试覆盖了旧的完整蓝图查询、遗漏当前 `db:blueprint-list-summary` 查询，导致 mock 返回对象而不是列表。只补齐该测试的列表 mock，未改目录生成业务。

## 3. 实际章节写作入口

独立运行目录：

`D:\ai\AI-Novel-Writer-master\.runtime\writing-entry-1790851145178`

真实 main/preload/renderer、IPC、项目 schema、SQLite 和保存路径；仅模型供应商替换为本地确定性 HTTP fixture。蓝图测试数据在产品创建的空 schema 中预置；本项不重复声称验证了 Markdown 导入。测试角色由真实 UI 创建、保存，能力字段写入独特标记，再在创作弹窗的“作者微操指导”实际输入新的指导文字。

操作路径：项目总览 → 打开章节蓝图 → **写作此章** → 核对章号/预算/指导 → **开始创作** → 自动保存并打开正文 → 独立只读 SQLite 回读 → 标题栏关闭。没有用 Agent `start_workflow` 启动。

| 检查 | v2 | 旧版 |
| --- | --- | --- |
| 弹窗章号 | 1 | 1 |
| 弹窗预算 | 4200 | 3000 |
| 实际请求 | 四场 Markdown 全文按原顺序进入请求，预算合同 3360–5040 | keyEvents 标记进入请求，预算合同 2400–3600 |
| 旧字段覆盖 | 写作请求不含预置旧 keyEvents 标记 | 正常使用旧 keyEvents 回退 |
| 弹窗手工指导 | 新输入 UI-V2-GUIDANCE 进入请求 | 新输入 UI-LEGACY-GUIDANCE 进入请求 |
| 独立落盘 | draft，第 1 章，绑定第 1 章，4003 计数单位 | draft，第 1 章，绑定第 1 章，2955 计数单位 |
| 原资料 | 蓝图行、细纲行、全部角色字段前后逐项一致 | 蓝图行、全部角色字段前后逐项一致 |
| 退出/数据库 | 窗口关闭、退出码 0，无强制退出；integrity_check=ok | 同左 |

当前代码实际 LLM `purpose` 是 **`chapter-draft`（两种格式共用）**。由独立 SQLite `llm_calls` 回读核实；v2 资格依据请求中的四场全文、预算和旧字段不覆盖，不能仅依据旧报告的 `chapter-draft-v2` 名称。

独立检查器：[blueprint-writing-entry-verify.mjs](../../test/acceptance/scenarios/blueprint-writing-entry-verify.mjs)。运行命令：

```powershell
node test/acceptance/scenarios/blueprint-writing-entry-verify.mjs .runtime/writing-entry-1790851145178
```

关键证据均保留于上述运行目录的 `evidence/`：`verification.json`、`provider-requests.json`、`input-actions.jsonl`、两个 `*-before-writing.json`、两个 `*-readback.json`、`lifecycle.jsonl`、产物哈希及输入/生成后截图。四张创作弹窗和生成后画面已实际打开检查，章号、预算、指导和草稿视图可见。输出是机械验收 fixture，不能据此评价文学质量或真实供应商稳定性。

## 4. P4 篇幅与稳定性

P4 的 4132 计数单位超过 3600 上限约 14.8%；4621 字符与生成门槛使用的计数单位不是同一口径。该结果违反提示范围，旧代码确实只有最低门槛。

本轮选择**增加超限检测与任务日志提示，保留完整草稿；不增加硬性拒绝保存或自动截断**。原因是现有生成流程允许模型越过目标后续写完整结尾，直接硬拒绝将改变恢复/提交行为。提示要求作者检查并精简，不能把超限称为达到了篇幅合同。新增上限减一、等于上限、上限加一三个边界测试，保证只在超出时提示，正文和统计值完整保存。若产品后续要求硬范围，需明确严格模式及恢复候选流程，不能用截断冒充完整章节。

P4 项目、记录及 `苏砚.abilities` 污染证据未改动。新验收项目的能力标记前后完全一致只证明本次正确输入路径，不能抹去 P4 的问题。P4 成功前两次退出原因仍未明，brand-icon 失败及当时截图未做视觉检查的限制仍保留。

本轮初始 Electron 启动另见 renderer crash、CDP attach 超时；成功验收使用 `--no-sandbox --disable-gpu --in-process-gpu` 的测试启动参数，未修改产品启动配置。这不能证明普通启动稳定性问题已排除。初期另有驱动参数错误，修正后才完成成功链路；失败目录和记录均保留。本轮成功实例仍有 `ERR_FILE_NOT_FOUND` 和 Electron CSP 警告，未声称资源加载问题已解决。

## 5. 最终回归

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| 蓝图/确认快照/写稿/修稿 Node 组合 | 21 文件，291 项通过；独立原生副本 | `followup-blueprint-node-final.log` |
| 受影响三文件专项 | 3 文件，33 项通过；独立原生副本 | `followup-blueprint-native-isolated.log` |
| 相关浏览器组合 | 7 文件，60 项通过；含 ReviewReport 13 项 | `followup-blueprint-browser-final.log` |
| TypeScript | 退出码 0 | `followup-typecheck.log` |
| i18n | 通过 | `followup-i18n.log` |
| git diff --check | 退出码 0；保留已有 CRLF/LF 提示 | `followup-diff-check.log` |

日志目录：`D:\ai\AI-Novel-Writer-master\test\acceptance\evidence`。没有沿用旧测试通过数。

浏览器仍输出 React `act(...)` 警告及 `ResizeObserver loop completed with undelivered notifications`，未压制这些日志。该组最终日志没有观察到 `db:foreshadowing-list-by-draft` mock 错误；审稿测试仍显式将该通道 mock 为 `[]`。历史其他组的相关 mock 日志不能据此判定已解决。

整体验收仍未关闭，以下四项不能由上述分段 PASS 替代：

1. 两个原占用测试进程由其所有者安全结束后，运行 `node scripts/prepare-native-for-node.mjs`，用普通 Node 验证 SQLite，再重跑受影响三文件。独立 ABI 副本结果不能代替主目录恢复。
2. 在同一个临时项目里完成 UI Markdown 导入、画布操作、章节写作入口、审查、退出后的独立落盘回读和重启回读。本轮写作项目预置蓝图，与此前导入验收项目不同，不能合并宣称严格端到端通过。
3. 排查普通 Electron 启动的 renderer crash/CDP 超时，以及资源加载和 CSP 日志。特殊启动参数的成功不能证明普通产品启动稳定。
4. 当前篇幅检测仅提醒并保留完整草稿。如果产品要求硬上限，仍需定义超限后的恢复与修订流程，不能把现状表述成硬范围保证。

补充源码核对：`project:create` 在初始化数据库前建立 `.vela/prompts`；验收的 `createProjectSkeleton` 仅建立 `.vela` 和 manifest，因此此次 ENOENT 存在测试骨架缺目录这一原因。尚未通过实际新建项目复验，不能据此排除旧项目打开路径的问题。构建后的 HTML 图标路径为 `./brand-icon.png`，但 `TitleBar.tsx` 的 React 图标仍为 `/brand-icon.png`，在 `file://` 下存在文件根路径解析问题；旧诊断未记录失败请求 URL，尚不能将所有 `ERR_FILE_NOT_FOUND` 归于此处。当前 HTML 没有 CSP 声明，警告仍保留。

P4 历史字段污染、未视觉检查的旧截图、brand-icon 失败记录及未明原因退出均保留；新项目字段干净不能覆盖这些历史限制。

## 6. 再次修复与同项目连续复验

产品修复：

- `TitleBar.tsx` 用 `import.meta.env.BASE_URL` 构造品牌图标路径，适配构建后的 `file://` 页面。
- `project:open` 在验证项目身份、初始化数据库后补齐可选 `.vela/prompts` 目录，旧项目和最小 manifest 项目不再因目录缺失产生该读取错误；项目创建路径本来已经建目录。项目 Controller 回归同时核对补齐行为。
- Vite 的生产构建为 HTML 加入 CSP，脚本仅允许同源和启动主题脚本的精确哈希，不开放 eval。实际正文测试发现 Vditor 还会同步读取随包 `ant.js` 图标文件并内联执行；最终构建为该文件追加精确哈希。初始 CSP 拦截诊断仍保留，最终正文截图中工具栏图标恢复可见。开发服务器未套用这份生产 CSP。

连续链路项目：`D:\ai\AI-Novel-Writer-master\.runtime\writing-entry-1790854383777\v2`。启动模式 `BLUEPRINT_CONTINUOUS_CHAIN=1` 跳过全部蓝图数据库预置：

1. 实际 UI 新建卷和第 1 章，填入旧事件标记、作者指导及章节要点并保存。
2. 粘贴 `test/fixtures/blueprint-v2/chapter-01.md`，解析预览并确认导入，显示四场分镜及 4200 字预算。
3. 进入场景画布，通过“排上画布”逐一添加四个正式分镜，保存对应节点。
4. 实际角色 UI 新建验收角色，仅在“能力/技能”框写入 `CHAIN-ABILITY-KEEP-CLEAN` 并保存；回到蓝图点击“写作此章”，核对第 1 章、4200 预算及预填指导，再在实际指导框写入本次写作标记后点击“开始创作”。
5. 实际草稿编辑器启动 AI 审稿，随后确认审稿清单，生成原始报告和不可变确认记录。供应商仍为确定性本地 HTTP fixture；报告明确包含待核实项目，不能据此称文学内容或蓝图兑现已通过。
6. 标题栏退出，独立只读 SQLite 回读；最终构建普通重启同项目，重新打开第 1 章正文、已有确认清单和四节点画布，再独立回读并正常退出。

独立检查器 `blueprint-chain-readback.mjs` 的 `after-exit` 和 `after-restart` 均 PASS：草稿 4003 计数单位，章号和蓝图绑定均为 1；四场 Markdown 原文按序进入实际写作请求，篇幅合同为 3360–5040；本次指导正确进入请求，旧事件标记未进入写作提示。全部蓝图、细纲、角色字段与写作前严格相等，指导与要点仍为原人工标记；四个画布节点、两条审稿记录及冻结正文一致。重启前后检查的数据整体严格相等，数据库完整性为 `ok`。独立检查使用 ABI 副本，仍不证明主目录 ABI 恢复。

证据目录为同一运行根的 `evidence/`：`chain-before-writing.json`、`chain-after-exit.json`、`chain-after-restart.json`、`provider-requests.json`、`input-actions.jsonl`、`chain-ui.jsonl`、`restart-ui.jsonl`、`lifecycle.jsonl`、构建哈希和截图。导入预览、初始画布、创作弹窗、生成草稿、确认清单、重启正文、重启审稿及适应视图后的四节点画布截图均已实际打开视觉检查。

普通启动排查：工具沙箱内普通参数启动仍超时，失败目录 `.runtime/writing-entry-1790854198802` 保留。获准在工具沙箱外执行后，普通 Electron 参数可以进入隔离项目；连续链路及最终构建重启均未使用 `--no-sandbox`、`--disable-gpu`、`--in-process-gpu`。最终 `restart-diagnostics.json` 没有观察到 CSP 拦截、资源缺失、prompts ENOENT 或 renderer crash；品牌图片 DOM 核验 `naturalWidth=1254`，正文工具栏可见。证据支持工具沙箱环境影响启动的判断，但没有证明历史 P4 两次退出的原因；这些历史限制仍未排除。

本轮重新运行 Node 组合 **22 文件 / 324 项通过**（包含受影响三文件，独立 ABI），浏览器 **7 文件 / 60 项通过**，TypeScript、i18n、`git diff --check` 通过。日志为 `repair-blueprint-node.log`、`repair-blueprint-browser.log`、`repair-typecheck-final.log`、`repair-i18n.log`、`repair-diff-check.log`；React act 与 ResizeObserver 警告保留。

主目录最终 SQLite 探测仍失败：ABI 145 对 137。PID 30800 仍为 Electron；PID 34604 查询明确返回找不到进程。未终止原占用者，未覆盖其原生模块，恢复步骤仍等待 E01 所有者安全结束实例。篇幅处理维持超限提示与完整保存，没有擅自加入截断或硬拒绝流程。

工作区并发变化：`ChapterOutlineSidebar.tsx` 于 19:44 被外部恢复，目前为修改状态，差异为改用 `db:blueprint-list-summary`。用户随后明确授权保留这次恢复；本轮未编辑或移除这个文件。此前“删除保留”的约束已由这条新授权更新。
