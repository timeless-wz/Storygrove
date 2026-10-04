# 故事时间线 · 任务 D 验收报告（页面编排、折叠侧栏、集成与验收）

日期：2026-10-03。项目：`D:\ai\AI-Novel-Writer-master`。
依据：`docs/handoffs/story-timeline-redesign-parallel-2026-10-03.md` 第 9 节（任务 D）与第 10 节（验收矩阵）。

## 0. 结论摘要

- 时间线页面已完成编排、折叠侧栏、真实组件接入与删除可靠性对接，四条边界（A 画布 / B 浮窗表单 / C 数据层 / D 编排）通过 `timeline-ui-contract.ts`、`StoryTimelineScene` props、store 与 `db:timeline-*` IPC 连通。
- 全部实现路径都是真实页面 + 真实 store + 真实 IPC：没有为截图造影子页面，没有为对齐样式图改用户数据（故事时间、标题、排序一律不动）。
- 时间线相关测试与类型检查结果见第 4 节；截图证据见第 5 节；与其他任务的待办与耦合见第 6 节。

## 1. 改了哪些文件，以及为什么

独占文件（本任务负责）：

| 文件 | 说明 |
| --- | --- |
| `src/components/timeline/StoryTimelineView.tsx` | 页面编排：主干工具栏、画布/侧栏/浮窗/菜单/模态的单一状态源、写入适配、删除确认、项目隔离的 UI 偏好、读取失败重试。 |
| `src/components/timeline/TimelineEventSidebar.tsx`（新建） | 「事件与支线」内侧栏：主线/支线分组、空支线占位、支线重命名/加事件/折叠/删除、筛选与统计、折叠后的悬浮展开导轨。 |
| `src/components/timeline/story-timeline-workbench.css`（新建） | D 作用域样式：宿主盒契约、侧栏分组与支线操作、删除确认区、悬浮导轨、读取失败态。全部类名以 `.timeline-sidebar*` / `.timeline-workbench*` / `.writer-timeline-flow`（A 的宿主契约）限定。 |
| `src/components/timeline/__tests__/StoryTimelineView.browser.tsx` | 33 个集成用例：布局、选中/浮窗、键盘、支线分组与操作、祖先展开、删除预览与重新确认、偏好持久化与校验、读取失败重试、视觉契约断言、普通状态更新不重新适配。 |
| `src/components/timeline/__tests__/StoryTimelineView.visual.browser.tsx` | 真实页面截图夹具：八类验收画面 + 窄画布浮窗边界断言；并扮演主进程提供权威删除预览，让删除链路在截图夹具里也是完整的。 |
| `screenshots/timeline-*.png` | 本任务生成的验收截图（见第 5 节）。 |

必要的集成性最小改动（非本任务独占文件，只有断言/结构适配，未改业务实现）：

| 文件 | 改动 |
| --- | --- |
| `src/components/planning/__tests__/planning-area-structure.visual.tsx` | 时间线一节仍断言旧侧栏类名 `.planning-pane__group-label` 与「仅主轴」胶囊；改为断言新的分组结构（`timeline-branch-group` / `data-is-main` / 事件行）与筛选范围说明，数据语义断言（3 个事件、'灰潮初现'）全部保留。该文件的时间线断言在改造前就已与实现不符（共享 fixture 的 `branches` 恒为 `[]`，`仅主轴` 不会渲染）。 |

未改动（尊重边界）：`StoryTimelineScene.tsx`、`story-timeline-scene.css`、`story-timeline-layout.ts`、`TimelineEventFloat.tsx`、`TimelineEventForm.tsx`、`TimelineEventModal.tsx`、`TimelineContextMenu.tsx`、`TimelineRangeModal.tsx`、store/shared/IPC/仓库、`src/index.css` 与全局外壳。

## 2. 保留的既有行为与对接接口

保留：

- 位置永远由 `sortOrder` + 分支归属推导，事件不可拖动，不把视觉排布写回数据；轴点、锚点、支线名、折叠徽标、右键、双击、键盘（Enter / Shift+F10 / Escape 回焦）语义不变。
- 面包屑与真实页面入口（总览 / 创作规划 / 故事时间线）保留；`onNavigateMention`（`@人物` / `[[人物]]`）跳转链路保留。
- 创建事件、创建后续事件、从事件创建支线、范围与刻度设置全部走原表单与真实 IPC。
- 范围锚点（故事开端/结束）仍来自项目设置，删除入口对它一律拒绝。

对接接口：

- A：`StoryTimelineScene`（props：`layout` / `selectedId` / `contentReady` / `viewportIntent` / `initialViewport` / `callbacks`；回调：`onSelectEvent`、`onOpenEventFloat`、`onToggleBranch`、`onCanvasContextMenu`、`onAnchorContextMenu`、`onOpenRangeEditor`、`onInteractStart`、`onViewportChange`）。D 只发 `initial` / `fit-all` / `focus-event` 三种视口意图。
- B：`TimelineEventFloat`（`cascade` 展示 + `onSaveEvent` / `onDeleteEvent` / `onCreateBranch` / `onCreateNext` / `onToggleBranches` / `onNavigateMention`）、`TimelineEventModal`（`create-main` / `create-next` / `create-branch`）、`TimelineContextMenu`、`TimelineRangeModal`。
- C：`upsertEventResult`、`createBranchWithEvent`、`upsertBranch`、`previewEventDelete` / `previewBranchDelete`、`deleteEventConfirmed` / `deleteBranchConfirmed`、`pruneAfterConfirmedDelete`、`db:timeline-*-delete-preview` / `db:timeline-*-delete-confirmed`。
- 契约：所有写操作统一收敛为 `TimelineUiResult`；删除影响使用共享类型 `StoryTimelineDeleteImpact`；侧栏删除结果类型 `TimelineDeleteBranchResult` 由 D 定义并导出。

## 3. 逐条对照任务 D 的 12 项要求

1. **迁往 A 的 Scene，不留两套** ✅ 旧的 `TimelineScene.tsx` 已由 A 移除，页面只挂 `StoryTimelineScene`；DOM 断言 `container.querySelectorAll('.react-flow').length === 1`，选中态只有页面里唯一的 `selectedId`（断言页面内 `.writer-timeline-label.is-selected` 恒为 1 个）。
2. **删除底部常驻详情，接入 B 的单一画布内浮窗** ✅ 没有底部详情容器；浮窗 DOM 断言位于 `timeline-flow` 之内、无 `aria-modal`、画布其它节点仍可聚焦，不是 `display:none` 的重复控件。
3. **内侧栏默认展开、可收起、不影响全局导航、收起无占位、状态不丢** ✅ 收起后 `.planning-pane` 卸载、画布宽度变大（断言 `width` 增大）、展开按钮悬浮在画布左缘；筛选词、选中、分支展开、zoom 在收起/展开之间保持（断言 `canvasZoom()` 折叠前后一致）。
4. **主线/支线分组、空支线可见、主线无危险操作、支线有四个入口** ✅ 分组顺序 `main → 各支线`；真实空支线渲染「暂无事件」占位；主线组没有重命名/删除按钮；支线组有重命名、添加事件、折叠、删除。
5. **支线数排除 main；筛选结果与总数区分；筛选语义有说明** ✅ 页头与页脚都用 `nonMainBranches`；页脚为「显示 X / Y 个事件」；筛选区固定说明「筛选只作用于这份列表；画布始终显示全部事件」，并有断言证明筛掉全部后画布事件数不变。
6. **列表定位展开所有祖先支线并调用可读比例 focus intent** ✅ 两层嵌套支线折叠时点击子支线事件，祖先链全部展开（断言 store 的 `expandedBranchIds` 同时含父与子），且定位后 `canvasZoom() ≥ 0.85`。
7. **创建分支成功后展开祖先与新支线、选中并定位首事件** ✅ 创建成功后 `expandBranchChain + setBranchExpanded + setSelectedId + focus-event`；不新增「创建空支线」的独立流程（空支线的第一个事件通过支线标题的「添加事件」补写，仍走同一个真实表单）。
8. **保存适配显式读取 success；失败不关浮窗；成功应用返回数据；不整页重载；不因状态更新重新 fitView** ✅ 适配层只在 `result.success` 后应用状态；浮窗失败保留输入与焦点（B 的用例）；保存成功后 store 用返回的事件就地更新；视口意图只在进入项目、查看全部、定位、首事件创建时发出，选中/筛选/侧栏/保存都不会触发 fitView。
9. **删除全部走 C 的影响预览与确认；提示「将删除 X 个事件、Y 条支线」；失败保留上下文；成功清理失效选中/浮窗** ✅ 事件删除：浮窗打开时取权威预览（拿不到时用同规则本地估算作过渡显示），确认瞬间重新取预览并用其指纹提交；`needsReconfirmation` 时把最新影响交回浮窗并要求重新确认。支线删除：确认区实时显示「将删除 X 个事件、Y 条支线」+ 支线名，预览失败时确认按钮禁用（绝不用猜的数字删数据），确认失败/需重确认都保留确认区与最新预览。成功后按返回的 ID 集合清理失效选中、浮窗与菜单。
10. **侧栏折叠与视口保存为项目隔离 UI 偏好；校验数字与 zoom 边界；切项目不复用选中/浮窗** ✅ `localStorage` 键 `ai-novel-writer-timeline-ui-prefs`，按项目路径分桶（最多保留 12 个项目）；读取时逐字段校验 `x/y`（有限、|值| ≤ 1e7）与 `zoom`（∈ [0.05, 2]），非法即丢弃；切项目时清空选中与全部浮层，恢复的选中事件必须真实存在于该项目数据中。
11. **工具栏四项；无选中时定位禁用；保留面包屑与真实入口** ✅ 新建事件、定位选中（无选中 `disabled`）、查看全部、刻度设置；面包屑与返回入口保留。
12. **loading、读取失败可重试、空时间线首事件创建；失败不伪装成空项目** ✅ 未就绪且失败时显示「读取故事时间线失败 + 重试读取」，并明确写出「空画布不代表你的时间线是空的」；侧栏在数据未就绪时显示「这个项目的事件还没有读入」，不显示「时间线上还没有事件」；重试成功后回到真实空状态与首事件创建入口。

最终禁止项：未通过修改用户故事时间/标题/排序来对齐样式图（无任何对事件字段的写入型改动）；截图为真实页面 + 真实 store（仅 IPC 夹具数据来自测试）；集成完成不是「静态 mock」——33 个用例覆盖 IPC 调用参数与 store 回读。

## 4. 实际执行的命令与结果

| 命令 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | **exit 0：全工作区类型检查通过**（B 交付后已修掉 `TimelineAssociationPicker.tsx` 的未使用导入与其测试文件的类型错误）。 |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/timeline/__tests__/StoryTimelineView.browser.tsx` | **33 passed**，exit 0（含删除指纹、重新确认、偏好校验、读取失败重试、视觉契约断言、不重新适配断言） |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/timeline/__tests__/StoryTimelineView.visual.browser.tsx` | **5 passed**，exit 0，并重新生成第 5 节截图 |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/timeline/__tests__/StoryTimelineScene.browser.tsx` | **2 passed**，exit 0（A 的 Scene 用例，验证 D 提供的宿主盒不破坏其契约） |
| `node node_modules/vitest/vitest.mjs run src/components/timeline/__tests__/story-timeline-layout.test.ts` | **35 passed**，exit 0 |
| `node node_modules/vitest/vitest.mjs run --config vitest.planning-visual.config.ts src/components/planning/__tests__/planning-area-structure.visual.tsx` | **9 passed**，exit 0（含时间线一节） |
| `node node_modules/vitest/vitest.mjs run --config vitest.planning-visual.config.ts src/components/planning/__tests__/planning-area-screenshots.visual.tsx` | **1 passed**，顺带刷新了 `output/planning-visual/` 里共享外壳的时间线截图（不覆盖其他任务的 fixture 目录） |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/timeline/__tests__/` | 合并运行：**53 passed / 3 failed**。3 个失败全部在 **B 的 `TimelineFloatingPanel.browser.tsx`**（组件级夹具，不挂 D 的页面：角落右键、关联保留/重试、支线名称校验文案）。D 的三个套件（33 + 5 + 2 = 40）全部通过且 exit 0；该文件属 B，仍在收敛中。 |

测试适配说明：B 在本次集成期间把表单字段 `排序刻度` 改名为 `排列位置`、把支线名称改为**必填且不预填**（不再静默兜底成「支线」）、并把关联章节/角色换成结构化选择器。D 的用例已按 B 的最终实现改为读 `排列位置`、断言支线名称默认为空、并通过 `timeline-chapter-chip` / `timeline-character-chip` 断言真实关联，数据语义断言一字未减。

未运行/被阻塞：仓库层与 IPC 的 Node ABI 测试属 C 的范围，本任务未运行。全量 `tsc --noEmit` 已 exit 0；时间线目录合并运行仅剩 B 的组件夹具 3 个失败用例，与本任务是不同夹具、不同断言对象，可由 B 或总协调者单独收敛。

## 5. 截图与数据读回证据

真实页面截图（`screenshots/`，1600×900 或 620×500 窄画布，由 `StoryTimelineView.visual.browser.tsx` 用真实页面 + 真实 store 生成）：

| 文件 | 画面 |
| --- | --- |
| `timeline-canvas-default.png` | 整体：纸面画布 + 墨绿主轴 + 支线泳道 + 内侧栏 |
| `timeline-selected.png` | 单击只选中（无浮窗、无底部详情） |
| `timeline-float-details.png` | 右键后的画布内详情浮窗 |
| `timeline-float-edit.png` | 浮窗内编辑态 |
| `timeline-sidebar-collapsed.png` | 收起内侧栏：画布占满、悬浮展开按钮 |
| `timeline-dense-branches.png` | 密集分支：同源三支线 + 嵌套 + 真实空支线 |
| `timeline-dark-float-edit.png` / `timeline-canvas-dark.png` | 深色主题下的画布与编辑浮窗 |
| `timeline-narrow-canvas-float.png` | 约 620×500 窄画布：浮窗四边都在画布内 |
| `timeline-long-text.png` / `timeline-empty.png` | 长文本节点；空时间线的锚点与首事件入口 |
| `timeline-sidebar-rename.png` | 支线重命名的行内入口 |

数据读回证据（测试内断言，非人工）：`db:timeline-event-delete-confirmed` / `db:timeline-branch-delete-confirmed` 的实参（含指纹）、`db:timeline-branch-upsert` 载荷保留 `sourceEventId` 与 `id`、创建支线走 `db:timeline-branch-create-with-event` 单通道原子提交、空支线加事件的 `branchId` 落在该支线、偏好非法值被拒绝。

### 截图的可核验边界（诚实说明）

- 截图由真实页面在真实 store 上生成，但生成者（模型 D）无法直接查看像素：因此另有程序化断言覆盖可机检的视觉契约——常态节点背景透明且无阴影、时间 12–13.5px / 标题 15.5–18.5px、主轴非渐变非虚线、选中态换底而非亮蓝外框、画布非纯白、浮窗四边不越出画布。像素级审美仍需人工按参考图确认。
- `screenshots/timeline-canvas-collapsed.png` 是更早一轮（A 侧）留下的旧图，已被本轮的 `timeline-sidebar-collapsed.png` 取代；D 未删除其他任务的产物，请总协调者清理或确认。

## 6. 与其他任务的接口、耦合与待办（不藏在「完成」里）

1. **A · `onInteractStart` 的语义**：它由 React Flow `onMoveStart` 直连，程序化视口变化（初始适配、恢复视口、定位）同样会触发，会关掉刚打开的详情浮窗。D 侧已用「真实滚轮手势」标记过滤，指针手势交给 B 浮窗自身的点外部关闭逻辑。建议 A 改为只在用户实际平移/缩放时触发（例如结合 `onMoveStart` 的事件来源），D 便能去掉这层过滤。
2. **A · 视口恢复约定**：`initialViewport` 只在 React Flow 首次挂载生效，而 Scene 的 `initial` 意图仍会在数据就绪时执行一次适配，从而覆盖恢复值。D 现在用 `RESTORE_VIEWPORT_NONCE = -1`（Scene 内部把 -1 视为已处理）表达「本帧不动画布」。这是对 A 内部约定的耦合，建议 A 显式提供一个「恢复」意图类型或一个跳过首次适配的开关。
3. **A · 画布宿主盒**：A 把 `.writer-timeline-flow` 的宿主盒（`position` / `min-width` / `min-height` / 圆角 / 裁切）列为本页面的契约；D 已在 `story-timeline-workbench.css` 补齐。若 A 之后又想在 Scene 侧定义，请先通知，避免两处重复。
4. **B · 删除确认文案**：要求中的原句「将删除 X 个事件、Y 条支线」由 D 的侧栏确认区提供且数字来自 C 的权威预览；浮窗内的删除确认由 B 渲染，文案是「将同时删除支线「…」及其中 N 个事件」——数字同样来自 C 的权威预览（D 通过 `cascade` 传入），但缺少「Y 条支线」的直述。若要对齐原句，需要 B 在浮窗内改一行文案（D 未抢改 B 的文件）。
5. **B · typecheck 已绿**：B 修掉了 `TimelineAssociationPicker.tsx` 的未使用导入，`tsc --noEmit` 现为 exit 0，`pnpm build` 的这道门槛已解除。
6. **B · 浮动面板自带测试**：B 最终保留了 `TimelineEventFloat.tsx`（新增 `timeline-floating-panel.css` 与 `TimelineAssociationPicker.tsx`），回调契约未变，D 的接入无需改动。B 的 `__tests__/TimelineFloatingPanel.browser.tsx` 仍有 3 个失败用例（角落右键、关联保留/重试、以及「空支线名称要出现『请填写支线名称』」——当前实现是禁用保存按钮而不弹错误文案）。这些都在 B 的组件夹具里，与 D 的页面接入无关。
7. **C · 旧布尔删除接口**：页面已全部改走 `preview*` + `*Confirmed` 指纹路径，不再使用 `deleteEvent` / `deleteBranch` 布尔接口；这两个接口保留给其他调用方，未被本任务删除。
8. **共享外壳**：`src/index.css` 与 `src/styles/literary-workbench.css` 未由本任务修改；旧的 `.writer-timeline-*` 全局样式已由 A 迁出到 `story-timeline-scene.css`，D 只补了宿主盒与侧栏/导轨样式。
