# 任务 B：主侧边栏顺序与命名 — 实施与验收报告

日期：2026-10-02。**性质：任务级实施与验证记录。**

目标（任务书原文）：

1. 「项目总览」保持顶部，其后调整为：**故事设定 → 创作规划 → 正文写作 → 资料库 → 项目管理**。
2. 将分组名称「正文创作」改为「正文写作」，**内部功能归属不变**。
3. 单独验收：菜单顺序、各菜单打开正确页面、折叠/选中/计数/新建、其他侧边栏布局模式、不影响已打开标签页与项目数据。
4. 交付证据：修改文件、最终侧边栏截图、导航验证结果。

## 首页结论

- **顺序与命名：已实施并验证通过。** 主侧边栏（项目树）一级分组 DOM 顺序为 `setting → plan → manuscript → library → management`，「项目总览」固定在顶部先于全部分组；分组标题显示「正文写作」，其内部（草稿箱、正文章节）归属不变。
- **五项单项验收全部通过**（逐项证据见第 2 节）：顺序一致、各菜单打开正确页面（nav 审计 11/11）、折叠/键盘/计数/新建正常、其他侧边栏布局模式已核对（图标栏 / 首页侧栏 / 资料·知识·角色·文档子视图 / 右侧参考栏）、不影响标签页与项目数据（改动仅涉及渲染顺序与文案，未触碰任何 store 键、数据写入与标签页逻辑）。
- **交付证据**：2 张最终侧边栏截图 + 6 份验证日志，归档在 `test/acceptance/evidence/task-b-sidebar-order/`。
- **验证中发现 5 个预先存在的失败**（本任务改动前即在纯净基线上同样失败，与任务 B 无因果关系），其中 3 个源于「蓝图 v2 迁移后视觉测试夹具未同步」——如实记录于第 5 节，供对应任务修复。

## 1. 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/components/panels/sidebar/ProjectTree.tsx` | ① 把「故事设定」分组整体前移到「创作规划」之前；② 「正文写作」分组（`id="manuscript"`）标题由 `正文创作` 改为 `正文写作`；③ 同步五个分组的序号注释（1 故事设定 → 2 创作规划 → 3 正文写作 → 4 资料库 → 5 项目管理）。分组 `id`（`plan/setting/library/management/manuscript`）与组内条目、徽章、折叠状态键全部未动。 |
| `src/components/editor/ChapterCardEditor.tsx` | 引用该分组的两个入口按钮同步改名：工具栏 `正文创作`→`正文写作`（tooltip 不变，仍是「在项目树中展开草稿箱与正文章节」）、空态 `打开正文创作`→`打开正文写作`；点击行为（`revealSidebarGroup('manuscript')`）不变。英文文案保持 `Manuscript`（本次改名对象为中文分组名）。 |
| `src/components/panels/sidebar/__tests__/ProjectTree.sidebar-groups.browser.tsx` | ① 五个分组的预期名称与顺序更新；② 断言分组总数恰为 5；③ **新增用例**「renders the required author-task order」：断言 `[data-group-id]` 的 DOM 顺序为 `setting, plan, manuscript, library, management`，且「项目总览」经 `compareDocumentPosition` 确认先于所有分组。 |
| `src/components/planning/__tests__/planning-area-structure.visual.tsx` | 「五个作者任务区」顺序断言与名称列表更新为新顺序/新名；空态用例新增断言「工具栏存在 `正文写作` 入口」（该按钮无条件渲染，用例可通过）。 |
| `src/components/__tests__/nav-browser-audit.browser.tsx` | 两处注释措辞 `正文创作`→`正文写作`（NAV-TREE-17 / NAV-TREE-19），断言逻辑不变。 |
| `src/components/panels/ProjectReferencePanel.tsx` | 代码注释措辞统一为「正文写作」（非用户可见文案）。 |
| `test/acceptance/evidence/task-b-sidebar-order/`（新增） | 最终侧边栏截图 2 张 + 验证日志 6 份（见第 3、4 节）。 |
| `test/acceptance/reports/2026-10-02-task-b-sidebar-order.md`（新增） | 本报告。 |

未改动：任何 store（`layout-store` 的 `projectTreeGroupOpen` 键未变）、任何 IPC 通道、任何项目数据文件、路由/标签页逻辑、分组内条目与徽章计算。

## 2. 单项验收结果

### 2.1 实际菜单顺序与要求一致 — PASS

- 截图（`task-b-02-sidebar-data.png`）目视顺序：项目总览 → 故事设定 → 创作规划 → 正文写作 → 资料库 → 项目管理。
- 自动断言：`ProjectTree.sidebar-groups.browser.tsx` 新增 DOM 顺序用例 PASS；`planning-area-structure.visual.tsx`「project tree: five author-task areas in author order」按文本位置断言 `项目总览 → 故事设定 → 创作规划 → 正文写作 → 资料库 → 项目管理` PASS。

### 2.2 各菜单仍打开正确页面 — PASS

- `nav-browser-audit.browser.tsx` 11/11 PASS（`verification-browser-nav-audit.txt`），其中：
  - `ProjectTree Leaf Entries and Editor Mounting (NAV-TREE-01 ~ NAV-TREE-31)`：逐一点击项目树每个叶条目/子文档（创作参数、修炼等级、故事前提/世界观/情节大纲、角色档案、章节蓝图、章节脉络、故事时间线、伏笔管理、多地图地图册、世界、草稿项、正文章节、项目文档、资料来源与审核、知识检索、导入/导出等），断言挂载正确编辑器/视图并验证关闭返回路径；
  - `Keyboard & Context Menu Navigation`：Enter/Space 激活与右键菜单打开同一目标。
- 分组顺序变化不影响点击目标：条目点击逻辑与分组位置无关（`id` 未变，`revealSidebarGroup('manuscript')` 等按 `id` 定位）。

### 2.3 折叠、选中、计数和新建操作正常 — PASS

- 折叠/展开（`verification-browser-sidebar-groups.txt`，8/8 PASS）：
  - 点击分组标题：`aria-expanded` 与 `layout-store.projectTreeGroupOpen` 双向同步、子项显隐正确；
  - 真实键盘：聚焦后 Enter/Space 各只触发一次切换；叶子项 Enter 激活；
  - 折叠一个分组不影响其他分组的条目点击（故事设定/资料库条目照常打开）。
- 计数（见截图）：创作规划徽章 `3 章蓝图`、章节蓝图 `3/24 章`、多地图地图册 `3 处地点`、正文写作 `1 章草稿 · 0 章正文`，空态则为 `待生成/待创建`；徽章仍按分组 `id` 挂载，位置随新顺序移动。
- 新建：`新建草稿`（草稿箱）与`新建章节`（正文章节）按钮保留在组内且可点击（用例「preserves inner "+" buttons…」PASS）；五个分组标题栏内确认无「+」按钮（用例「renders exactly 5 level-1 collapsible groups …」PASS）。

### 2.4 项目存在的其他侧边栏布局模式已核对 — PASS

除主项目树外，仓库中还存在以下侧边栏/导航布局，均已运行其对应用例，结果与改动前一致（未被任务 B 触及）：

| 布局模式 | 位置 | 核对结果 |
| --- | --- | --- |
| 左侧图标栏（创作/资料/知识检索/角色 + 底部 任务/日志/模型） | `LeftToolWindowBar.tsx` | `NAV-RAIL-01~09` PASS（含返回路径） |
| 首页侧栏（项目管理入口 + 最近项目） | `HomeSidebarPanel.tsx` | `NAV-HOME-SIDE-01~13` PASS；`home-sidebar-contrast.browser.tsx` PASS |
| 侧边栏子视图容器与头部返回（workspace/knowledge/characters/documents 切换） | `Sidebar.tsx` | `NAV-SIDE-TOP/SUB` PASS |
| 资料来源与审核子栏 / 知识检索子栏 | `WorkspaceSidebarPanel.tsx` / `KnowledgePanel.tsx` | 无专用渲染用例（现状如此）；由 `NAV-SIDE` 子视图切换覆盖“可进入/可返回”；本任务未触碰这两个文件 |
| 角色档案视图 | `CharactersView.tsx` | 除 1 个预先存在失败外 PASS（见第 5 节） |
| 项目文档视图 | `ProjectDocumentsView.tsx` | 除 1 个预先存在失败外 PASS（见第 5 节） |
| 创作规划画布侧 plot 树 rail | `plot-tree-rail-navigation.browser.tsx` 覆盖 | PASS |
| 右侧项目参考栏（其自身「项目设定」分组） | `ProjectReferencePanel.tsx` | `ProjectReferencePanel.browser.tsx` PASS；与本任务分组命名体系相互独立 |

### 2.5 不影响已打开标签页与项目数据 — PASS（设计性 + 证据）

- 改动仅为 `ProjectTree.tsx` 的 JSX 顺序与文案、以及两个引用该分组的按钮文案；**未改动**任何 store 键、持久化结构（`projectTreeGroupOpen` 仅内存态）、IPC 通道、项目数据读写路径。
- 分组 `id` 未变 ⇒ 用户已保存的折叠偏好（按 `id` 索引）继续生效；编辑器标签由 `editor-store` 管理，与分组渲染顺序无关。
- 证据：nav 审计中「打开草稿/正文章节 → 关闭返回」链路逐条通过（NAV-TREE-17/19），说明标签页开启/关闭未受影响。

## 3. 最终侧边栏截图

归档位置：`test/acceptance/evidence/task-b-sidebar-order/`

| 截图 | 状态 | 说明 |
| --- | --- | --- |
| `task-b-01-sidebar-empty.png` | 空项目 | 六项入口齐全，五组给出 `待生成/待创建/待配置` 真实状态 |
| `task-b-02-sidebar-data.png` | 有数据（主交付截图） | 显示计数徽章（`3 章蓝图`、`3/24 章`、`3 处地点`、`1 章草稿 · 0 章正文`）与组内新建按钮 |

采集方式说明：仓库原有的 `planning-area-screenshots.visual.tsx` 因预先存在的夹具漂移（第 5 节 #2）在当前分支无法完成项目树截图步骤，因此本次用一次性采集用例（复用同一 `planningVisualHarness` 与真实 `Sidebar` 容器，另补 `db:blueprint-list-summary`/`db:blueprint-v2-summary-list` 计数桩）产出上述两张图；采集完成后临时文件已删除，未留在仓库。图中样式与真实应用一致（`vitest.planning-visual.config.ts` 挂载 Tailwind 与主题 CSS）。

## 4. 验证命令与结果（日志在证据目录）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | 任务 B 文件 0 错误。全量唯一错误来自并发任务在途未跟踪文件 `electron/controllers/__tests__/character-save-repro.integration.test.ts(30,7)`（TS6133），非本任务改动 | `verification-typecheck.txt` |
| `vitest run … project-tree-refresh-policy.test.ts sidebar-file-openers-session.test.ts source-contract.test.ts` | 3 文件 / 9 用例 PASS | `verification-node-sidebar-tests.txt` |
| `vitest run --config vitest.browser.config.ts …/ProjectTree.sidebar-groups.browser.tsx` | 8/8 PASS（含新增顺序用例） | `verification-browser-sidebar-groups.txt` |
| `vitest run --config vitest.browser.config.ts src/components/__tests__/nav-browser-audit.browser.tsx` | 11/11 PASS | `verification-browser-nav-audit.txt` |
| `vitest run --config vitest.browser.config.ts src/components/panels` | 86 PASS / 3 FAIL（3 个失败均为预先存在，见第 5 节；改动前基线同样 3 失败，仅少新增顺序用例的 1 个通过） | `verification-browser-panels-batch.txt` |
| `vitest run --config vitest.planning-visual.config.ts` | 8 PASS / 2 FAIL（2 个失败均为预先存在；其中「five author-task areas in author order」「same five areas before anything is generated」「chapter blueprints: empty state…」3 个与任务 B 相关的用例 PASS） | `verification-planning-visual-suite.txt` |

## 5. 预先存在的失败（与任务 B 无因果关系，如实记录）

以下失败在**改动前的纯净基线**（`git stash` 后于 HEAD 运行同命令）复现同一批失败项，属当前分支已有问题：

1. `planning-area-structure.visual.tsx > chapter blueprints: list, filter and toolbar with data` — `TypeError: Cannot read properties of undefined (reading 'find')`，`src/shared/blueprint-v2.ts:188 findBlueprintV2CanonicalSection`，经 `ChapterCardEditor.tsx:1715` 触发。根因：`planning-visual-fixtures.tsx` 仍只桩 `db:blueprint-get-all`，对 `db:blueprint-v2-get` 返回 `[]`，编辑器把数组当成 v2 detail 读取 `sections` 崩溃。
2. `planning-area-screenshots.visual.tsx > captures every page…` — `expect(textContent).toContain('3/24 章')` 失败。同源：`getBlueprintCount` 现读 `db:blueprint-list-summary` + `db:blueprint-v2-summary-list`（夹具未桩，返回 `[]`）⇒ 蓝图徽章停在「待生成」，用例在截图前中断（因此 `output/planning-visual/01-project-tree.png` 停留在旧顺序的旧图；任务 B 的最终截图以上表两张为准）。
3. `ProjectTree.arch-status-refresh.browser.tsx > reflects committed blueprint count…` — 同源通道漂移：用例桩/计数 `db:blueprint-get-all`（测试文件第 71/145 行），而生产代码已改读 summary 通道。
4. `CharactersView.create.browser.tsx > clears the previous input when reopened`。
5. `ProjectDocumentsView.project-binding.browser.tsx > offers new/import actions in the empty state`。

建议：由蓝图 v2 相关任务统一更新 `planning-visual-fixtures.tsx` 与 `ProjectTree.arch-status-refresh` 的通道桩（`db:blueprint-list-summary` / `db:blueprint-v2-summary-list` / `db:blueprint-v2-get` 返回合法 detail 或 `null`），即可让 #1~#3 恢复；#4~#5 属各自视图已有问题，需单独排查。

## 6. 环境与协作记录（必须如实保留）

- **并发代理活跃**：执行期间同一工作树上有其他代理的改动出现——`src/components/panels/sidebar/sidebar-icons.ts`（新增 `bar-chart-3` 图标映射）及 `ProjectTree.tsx` 中「修炼等级设置」一行改用该图标（与本任务的顺序/命名改动共存，相关测试在本状态上复跑通过）；另有未跟踪文件 `electron/controllers/__tests__/character-save-repro.integration.test.ts` 与未提交的 `test/acceptance/reports/2026-10-01-stage-3.md` 修改。本任务未触碰上述文件。
- **未提交**：本任务全部改动留在工作树，未创建任何 git commit。
- 验证均在上述并发状态下执行；浏览器套件与 Electron 场景未并发运行（本任务只运行了 vitest 浏览器/Node 套件）。

## 7. 遗留与建议

1. 修复第 5 节 #1~#3 的夹具漂移后，`planning-area-screenshots.visual.tsx` 将自动恢复采集新顺序的 `01-project-tree.png`。
2. `docs/navigation-information-architecture.md` 仍是旧结构（“项目设定/创作规划/正文创作”），与现状（五分组 + 项目总览、故事设定）不符，属陈旧文档，本任务未改动；如该文档仍是现行规范，建议单独任务同步。
3. `src/services/workflows/commands/generate-draft.command.ts:1098` 用户可见提示中的「正文创作」指模型能力（“更适合正文创作的非推理模型”），非分组名，本任务有意保留；如需全局统一术语可另行处理。
