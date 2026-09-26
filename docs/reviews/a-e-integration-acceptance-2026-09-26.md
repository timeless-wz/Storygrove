# A–E 前端集成验收（2026-09-26）

## 范围与工作树保护

开始前执行了 `git status --porcelain=v1 -uall`、`git diff --numstat`、`git diff --check`，并保存当时完整的 tracked diff（10,701 行）供逐项核对。基线已有 39 个 tracked 修改和多项 untracked 文件，包括角色档案/角色库改动、A–E 测试与截图、下载辅助脚本、既有验收记录。未 reset、stash、删除、覆盖或整理这些既有内容；本轮仅追加集成修复与测试。

| 任务 | 主要文件所有权 | 本轮状态 |
| --- | --- | --- |
| A 主题与外观 | `AppearanceSettings.tsx`、`ThemeGallery.tsx`、`literary-themes.css`、`literary-themes.ts` | 定向通过；共享 `index.css` 的图片皮肤令牌与遮罩已修复 |
| B 书斋/总览/立项 | `WelcomePage.tsx`、`ProjectOverviewPage.tsx`、`NewProjectDialog.tsx`、`literary-workbench.css` | 定向通过；继续创作正文读取与 Hero 辅助按钮已修复 |
| C 正文工作台 | `DraftEditor.tsx`、`EditorArea.tsx`、`vditor-prose.css` | 定向通过；保存、跨章、发布浏览器行为仍成立 |
| D 创作规划 | `ProjectTree.tsx`、五个规划视图及 `planning/` 公共壳 | 定向通过；结构、时间线、地图、蓝图入口已验证 |
| E 资料与来源 | `WorkspaceHub.tsx`、`StoryDataCenter.tsx`、`KnowledgeOverview.tsx` 及专用辅助文件 | 定向通过；事实/候选/来源/废止隔离与候选审批 store 行为已验证 |

共享冲突重点：`index.css` 图片皮肤先前只给四套基础主题定义 `--skin-text-*`，文学主题下引用会失效；半透明首页和面板在极端底图上低于 4.5:1。`literary-workbench.css` 的 Hero 辅助按钮又被 Button 工具类覆盖，实际出现深色文字压在深色背景。上述三处均按实际计算样式/截图修复。导航共享处保留了 `Sidebar`/`EditorArea` 现有入口与项目会话门控，未改业务数据格式。

## 本轮修复与真实行为证据

1. `workbench-draft-entry.ts` 原先直接调用 `openFile`，只传草稿元数据，不读正文。书斋和总览的“继续创作”现统一调用既有 `openChapterFile(vela://draft/id)`；该入口先读 `db:draft-get-full` 正文和 `db:draft-get-meta`，成功后再开 Tab，读取失败不产生空白草稿。书斋浏览器测试实际点击 Hero CTA，断言第 7 章 Tab 含数据库返回的正文。项目会话重开时的异步旧结果隔离由 `sidebar-file-openers-session` 测试覆盖。
2. 图片皮肤为文学主题补齐壳层文字、次级文字和边框令牌默认值，并把可读表面遮罩提高到经测试足够的强度。Chromium 在 18 个主题 × classic/anime/custom 的 54 种组合中检查主按钮、Hero 辅助按钮与正文纸面；Hero 辅助按钮在纯黑和纯白底图上均达 4.5:1。对 36 个图片皮肤组合，另把首页、工作区面板、卡片分别叠在纯黑和纯白底图上计算文字对比度，均达到 4.5:1。starlight 的深桌面、浅纸面、正文墨色与光标仍通过原有计算样式断言。
3. Hero 辅助按钮使用与 Hero 背景配套的墨色和底色，限定于该组件；实际 Chromium 样式和更新后的首页截图确认。入口仍是原有的项目中枢、新书立项动作。
4. 蓝图“新建第 N 章正文”入口的六项浏览器行为测试通过；项目树结构、时间线、地图及规划 12 张空态/有数据截图测试通过。资料中心浏览器断言候选和废止记录不会混入正式事实，来源批准快照变化会被标记；知识库未检索/未命中不会伪造结果。源码定向检索未发现参考项目 Vue bundle、登录/计费页面或假统计被迁入这些运行时页面。

## 本轮修改文件

| 文件 | 修改 |
| --- | --- |
| `src/index.css` | 文学主题图片皮肤默认令牌与阅读表面遮罩 |
| `src/styles/literary-workbench.css` | Hero 辅助按钮颜色和优先级 |
| `src/components/pages/workbench-draft-entry.ts` | 继续创作接入实际正文读取 |
| `src/components/pages/WelcomePage.tsx`、`ProjectOverviewPage.tsx` | 等待异步草稿打开；保留原 CTA 流程 |
| `src/components/pages/__tests__/workbench-draft-entry.test.ts`、`workbench-pages-visual.browser.tsx` | 验证目标草稿与已加载正文 |
| `src/components/panels/sidebar/__tests__/sidebar-file-openers-session.test.ts` | 验证 DB 正文载入后再开 Tab |
| `src/components/settings/__tests__/theme-computed-contrast.browser.tsx` | 54 种组合及极端图片底色对比度 |
| `src/components/editor/__tests__/workbench-theme-screenshots.browser.tsx` | starlight 图片皮肤截图 |

## 验证命令与结果

以下命令均从仓库根目录运行；浏览器命令每次设置不同 `AI_NOVEL_VITEST_BROWSER_API_PORT`，以单文件串行执行。`node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts <文件>` 为实际浏览器测试命令形式。

| 命令/测试组 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | 通过，0 错误 |
| `node node_modules/eslint/bin/eslint.js <本轮 8 个 TS/TSX 文件>` | 通过，0 错误 |
| `node scripts/check-i18n-coverage.mjs` | 通过 |
| `git diff --check` | 通过；仅已有 CRLF 提示 |
| `node node_modules/vitest/vitest.mjs run <保存/项目会话/皮肤/工作台 9 文件>` | 49/49 通过 |
| `node node_modules/vitest/vitest.mjs run <主题/事实/知识范围/定稿 9 文件>` | 112/112 通过 |
| `node node_modules/vitest/vitest.mjs run workspace-hub-store.test.ts explicit-editor-store-dirty.test.ts` | 33/33 通过 |
| `theme-computed-contrast.browser.tsx` | 78/78 通过，包含 54 种主题/皮肤组合 |
| `workbench-theme-screenshots.browser.tsx` | 5/5 通过 |
| `workbench-pages-visual.browser.tsx` | 5/5 通过，含 Hero CTA 实际正文载入 |
| `DraftEditor-vditor-integration.browser.tsx` | 4/4 通过，含脏状态、保存、跨章先保存、发布 |
| `ChapterCardEditor.write-entry.browser.tsx` | 6/6 通过 |
| `StoryDataCenter.boundaries.browser.tsx`、`WorkspaceHub.navigation.browser.tsx`、`KnowledgeOverview.scope.browser.tsx` | 15/15 通过 |
| `node node_modules/vitest/vitest.mjs run --config vitest.planning-visual.config.ts` | 9/9 通过，生成规划截图 |
| `ProjectTree.information-architecture.browser.tsx`、`StoryTimelineView.browser.tsx`、`world-map-atlas.browser.tsx` | 31/31 通过 |
| `AIOutputPanel.recovery.browser.tsx`、`KnowledgeOverview.planning-material.browser.tsx`、`WorkspaceHub.browser.tsx`、`StoryDataCenter.browser.tsx` | 17/17 通过 |

两组多文件浏览器测试并行运行时启动后长时间无输出，已中止，不计通过；随后同一批关键文件逐个串行通过。部分浏览器夹具打印 React `act` 或未注入 Electron IPC 的警告；这些警告未转为断言失败。

## 主题与页面截图

- 书斋首页：[welcome-page.png](../../src/components/pages/__tests__/screenshots/welcome-page.png)
- 项目总览：[project-overview.png](../../src/components/pages/__tests__/screenshots/project-overview.png)
- starlight 经典皮肤：[screenshot-starlight.png](../../src/components/editor/__tests__/screenshots/screenshot-starlight.png)
- starlight anime 皮肤：[screenshot-starlight-anime.png](../../src/components/editor/__tests__/screenshots/screenshot-starlight-anime.png)
- starlight custom 代表底图：[screenshot-starlight-custom.png](../../src/components/editor/__tests__/screenshots/screenshot-starlight-custom.png)
- 规划空态/有数据截图：`output/planning-visual/` 下 12 张（该目录受 `.gitignore` 忽略，只在本机磁盘）。

## 剩余风险与未验证项

- 没有在 Electron 成品里完整点击“首页→总览→规划→蓝图→正文”的单一端到端会话；本轮分别验证了入口与状态链路、蓝图浏览器行为、正文读取与保存。实际项目资料库的写入/审核和本机文件系统发布也由测试夹具与 store 测试验证，未对用户真实项目执行写操作。
- custom 皮肤可由用户提供任意图片；本轮用纯黑/纯白极端底图证明指定阅读表面的对比度，未逐张检查用户实际图片的每个像素或覆盖所有控件。编辑器皮肤截图主要展示纸面和工具栏，背景图片在该视图里被工作台覆盖。
- 先前验收记录指出 `NarrativeThreadEditor.browser.tsx` 仍含 15 条过时的模型生成剧情树断言，`ReviewReport.confirmation.browser.tsx` 有旧按钮文案断言。本轮未重跑这两个旧套件，不能据此宣称其通过；不为旧规格恢复模型路径。
- 未运行全量测试、安装包构建、打包发布或安装启动验证。
