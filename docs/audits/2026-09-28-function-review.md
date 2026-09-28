# 2026-09-28 全项目功能审查

## 审查范围与判定

本清单独立于 Markdown 功能修复验收。依据实际入口、IPC、服务、仓储、文件边界和本次执行的自动化测试整理；浏览器用例运行在 Vitest Browser/Playwright 中，使用隔离状态与 IPC 替身，不等同于启动完整 Electron 应用。未在本轮操作的功能一律标“尚未测试”。

状态只使用：**通过／失败／环境阻断／未实现／尚未测试**。通过项在“证据”列列出源代码或本轮测试；仅有入口代码而无行为验证的项目不写通过。

审查开始时运行 `git status --short`，初始修改清单如下；均予以保留：

```text
 M src/App.tsx
 M src/components/dialogs/__tests__/import-novel-dialog-copy.test.ts
 M src/components/layout/__tests__/LeftToolWindowBar.test.tsx
 M src/components/pages/WelcomePage.tsx
 M src/components/pages/__tests__/workbench-literary-pages.test.ts
 M src/components/pages/__tests__/workbench-pages-visual.browser.tsx
 M src/components/panels/Sidebar.tsx
 M src/components/panels/sidebar/HomeSidebarPanel.tsx
 M src/components/panels/sidebar/__tests__/HomeSidebarPanel.recent-removal.browser.tsx
 M src/i18n/messages/en-US.ts
 M src/i18n/messages/zh-CN.ts
 M src/styles/literary-workbench.css
?? check_missing_assets.py
?? docs/plans/homepage-redesign-spec.md
?? download_cdn_assets.py
?? download_inkspires.py
?? download_recursive.py
?? find_external.py
?? screenshots/
?? src/components/pages/__tests__/output/
?? src/stores/home-surface-store.ts
```

审查中新增或并发出现的工作区文件同样未清理。`src/components/__tests__/nav-browser-audit.browser.tsx` 在审查过程中有并发编辑，本轮未覆盖该文件。

## 功能链路清单

| 状态 | 入口路径 → 页面／按钮 | IPC／服务 | 数据／文件目标 | 成功回显 | 关闭重开后回读 | 异常路径 | 测试证据 |
|---|---|---|---|---|---|---|---|
| 失败 | 首页 →「新书立项／打开本地项目／导入作品／继续创作」 | `WelcomePage` 回调 → `App` 对话框、`project:open`；最近项目由 `project-store` 装载 | 最近项目清单、用户选定的项目目录 | 最新导航浏览器夹具未能找到参考作品入口按钮，其余入口的实际回显未完成逐项验收 | 首页入口没有在完整 Electron 操作后重启回读 | 当前失败可能来自并发变化的测试夹具或入口文案／选择器不匹配，尚未判明根因 | `nav-browser-audit.browser.tsx` 最新执行 13 通过／4 失败，其中参考作品入口查询失败；IPC/store 替身运行 |
| 通过 | 左侧资源树 → 规划、正文、设定、资料库、管理父组及章节蓝图等子项 | `ProjectTreeCollapsibleGroup`、`setProjectTreeGroupOpen`、`openBuiltinEditor` | 布局 store；子项打开编辑器标签，实际持久化由对应视图负责 | 父组独立展开／收起、子项打开对应 tab 或侧栏页 | 浏览器断言当前 store/tab，不验证应用重启后的编辑器状态 | 键盘 Enter 有测试；异步刷新错误未覆盖 | `ProjectTree.sidebar-groups.browser.tsx`、`ProjectTree.information-architecture.browser.tsx` 与文档／drop 稳定组共 54 项通过；`ProjectTree.tsx`、`sidebar-file-openers.ts` |
| 通过 | 项目总览 → 蓝图、地图册、时间线、创作参数快捷按钮 | `ProjectOverviewPage` → `openBuiltinEditor`／`editor-store` | 对应编辑器 tab 与当前项目数据库视图 | 点击后生成正确类型的 tab | 仅断言 tab；关闭 Electron 后恢复未验证 | 快速入口与资源树入口的一致性有按钮级覆盖 | 信息架构浏览器用例确认快捷入口；完整重启未测；`ProjectOverviewPage.tsx` |
| 失败 | 首页／资源树 → 打开、切换项目、返回首页／返回创作 | `project-store.openProject`、`project-service`、项目会话／租约 IPC | 每个项目独立 `.vela/vela.db`、项目文件 | 最新导航浏览器流程未找到返回创作按钮 | 未真实启动 Electron 连续切换后重开；隔离数据库双项目重开已通过 | 旧会话失效有 Markdown 导入流程测试；返回按钮 UI 查询失败，产品与测试根因待复核 | `nav-browser-audit.browser.tsx` 最新执行 13 通过／4 失败；`test/nav-backend-audit.test.ts` 双项目 SQLite 隔离／重开通过，但不证明 UI 切换通过 |
| 通过 | 资源树 → 创作规划 → 章节蓝图／卷 | `db:blueprint-volume-list`、`db:blueprint-get-all`；`BlueprintRepository` | `blueprint_volumes`、`blueprints.volume_id` | 蓝图标题和卷名从仓储读取 | 隔离项目关闭并重新打开 SQLite 后回读卷和蓝图 | 未关联卷、冲突数据的界面操作尚未覆盖；卷导出冲突另见 Markdown 行 | `electron/repositories/blueprint-repository.ts`；`test/nav-backend-audit.test.ts` 的隔离 DB 重开读回测试通过；导航入口见 NAV-04 |
| 尚未测试 | 资源树 → 正文创作 → 草稿箱 → 打开某章／版本历史 | `DraftBoxGroup`、`DraftEditor`、`db:draft-list-all`、`db:draft-get-full` | SQLite `drafts` 与 `contents.body` | 章号、标题、版本、状态显示在草稿箱／编辑器 | 本轮未验证编辑器保存后退出再进项目回读 | 缺内容、陈旧版本、项目切换中的编辑保护未端到端覆盖 | `src/components/panels/sidebar/DraftBoxGroup.tsx`、`src/components/editor/DraftEditor.tsx`、`electron/repositories/draft-repository.ts`；相关现有测试未纳入本轮定向集 |
| 尚未测试 | 资源树 → 正文创作 → 正文章节 | `ManuscriptGroup`、定稿工作流、`FinalizationRepository` | `drafts.status='finalized'`、`contents.body`、`finalization_outbox` | 侧栏只列当前定稿章节 | 未操作保存后关闭重开回读 | 哈希不匹配、定稿并发变化需通过最终化保护 | `src/components/panels/sidebar/ManuscriptGroup.tsx`、`electron/repositories/finalization-repository.ts`；定稿浏览器流程未运行 |
| 尚未测试 | 编辑器 → 正文／蓝图 → 保存／版本／审稿 | `VditorProseEditor`、`DraftEditor`、`db:draft-*`、`db:revision-*`、`db:review-*` | SQLite 正文、草稿版本、修订／审稿记录 | 保存状态和编辑器标签更新 | 本轮未完整操作编辑→保存→关闭→重开 | 未保存退出、冲突合并、取消审稿覆盖未核查 | `src/components/editor/VditorProseEditor.tsx`、`DraftEditor.tsx`、`VersionHistory.tsx`、`ThreeWayMerge.tsx`；本轮无该流程证据 |
| 尚未测试 | 资源树 → 故事设定 → 创作参数／故事架构 | `NovelConfigEditor`、`WorldBuildingEditor`、`project-core`／架构文件服务 | `project_core` 与受控架构 Markdown 文件 | 配置和架构页各自读取当前项目数据 | 本轮未验证修改、重启后的回读 | 文件授权失败与配置冲突未端到端核查 | `src/components/editor/NovelConfigEditor.tsx`、`WorldBuildingEditor.tsx`、`electron/repositories/project-core-repository.ts` |
| 尚未测试 | 资源树／侧栏角色 → 角色图谱、档案、关系 | `CharactersView`、`CharacterEditor`、`db:character-*`、`db:character-roster-read` | 结构化 `characters`、关系数据、角色名单投影 | 列表／档案／关系图单独展示 | 本轮只验证导航打开，不验证实际保存重开 | 名单投影损坏、关系端点删除及修复路径未操作 | `src/components/panels/sidebar/CharactersView.tsx`、`src/components/editor/CharacterEditor.tsx`、`electron/repositories/character-repository.ts`、`character-roster-repository.ts`；NAV-04 只覆盖入口 |
| 尚未测试 | 资源树 → 创作规划 → 章节脉络、时间线、伏笔、地图册 | `NarrativeThreadEditor`、`StoryTimelineView`、`ForeshadowingManagementView`、`WorldMapView`；对应 `db:*` 仓储 | `narrative_threads`、时间线、伏笔、地图节点／边及图片授权目录 | 各 tab／选择项在面板中回显 | 本轮只验证地图、时间线、伏笔和脉络入口开 tab；实际资料重开未测 | 越权图片、错误引用、无效时间刻度未操作 | NAV-04 覆盖入口；仓储测试文件存在但未用本轮结果替代实际流程验收；源码分别位于 `src/components/editor/`、`src/components/timeline/`、`src/components/world-map/` |
| 通过 | 侧栏 → 项目文档 → 新建／导入／打开／重命名／删除 | `ProjectDocumentsView` → `docs:list/read/write/import/rename/delete` → `project-documents-controller` | 项目自己的 `project-documents/` 受控目录；来源文件只读复制 | 文档列表和编辑器回显 | 控制器测试在隔离目录中写后通过 `docs:read/list` 回读；不进入正文数据库 | 路径逃逸拒绝、取消与跨项目读取拒绝有控制器覆盖 | `electron/__tests__/project-documents-controller.test.ts` 在本轮所选命令中通过；组件提示“不会加入章节草稿或正文数据库”；项目文档浏览器编辑流程未运行 |
| 尚未测试 | 资源树 → 资料来源与审核 → 资料、规则、章节上下文 | `WorkspaceSidebarPanel`、`workspace-hub` 服务／IPC | 外部来源指纹、批准快照、规则与上下文片段，保留 provenance | 来源数、变化／缺失数、待确认候选回显 | 本轮未实际批准来源后关闭重开 | 外部文件变化、失效快照和跨项目来源隔离未操作 | `src/components/panels/sidebar/WorkspaceSidebarPanel.tsx`、`electron/controllers/workspace-hub-controller.ts`、`src/stores/workspace-hub-store.ts`；本轮无流程通过结论 |
| 尚未测试 | 资源树 → 知识检索 → 搜索／重建索引 | `KnowledgePanel`、`knowledge-service`、`kb:*` | 明确加入的项目资料及项目级向量索引 | 检索结果和索引状态显示 | 本轮没有项目级索引重开操作 | 空索引、损坏索引、重建中取消未端到端覆盖 | `src/components/panels/KnowledgePanel.tsx`、`src/services/knowledge-service.ts`、`electron/controllers/kb-controller.ts`；相关测试未纳入本轮定向运行 |
| 尚未测试 | 首页／项目管理 → 参考作品拆解；作者原稿恢复／导入 | `ImportNovelDialog`、`import-novel` workflow、`import-controller`、`ImportRun` 状态机 | 参考来源文件只读；解析与确认后的项目资料／连续正文提交走原有 authority 路径 | 解析报告、导入进度与恢复状态 | 本轮未完整实际解析并重开验证 | 冲突拒绝、续传、作者原稿连续定稿和哈希门槛需单独验证 | `src/components/dialogs/ImportNovelDialog.tsx`、`electron/controllers/import-controller.ts`、`electron/repositories/import-run-repository.ts`；本轮仅运行文案／路径定向用例，未宣称导入成功 |
| 通过 | 首页拖入区 → `.md`／`.markdown`，再从受控系统选择器确认 | `WelcomePage.handleDrop` 只校验后缀并打开导入入口；文件读取仍由主进程授权选择器完成 | 外部文件来源保持只读；renderer `File` 不传给主进程作为路径 | 显示需要在安全文件框中重新选刚拖入文件的说明 | 此入口不写数据库 | 非 `.txt/.epub/.md/.markdown` 拒绝；没有文件拒绝 | `src/components/pages/WelcomePage.tsx`、`src/i18n/messages/{zh-CN,en-US}.ts`；drop 测试 3 项及取消流程合组 5 项通过 |
| 通过 | 项目管理／导入对话框 →「作为我的章节内容导入」 | 主进程原生选择 `.md/.markdown` → external-file read grant → `parseChapterMarkdownFiles` → 带窗口和项目租约的预览 token → `db:draft-import-markdown` → `DraftRepository.createImportedBatch` | 只读外部 Markdown；单事务新增 `drafts` 与 `contents.body`，状态固定 `draft`，标题写入 `drafts.imported_title`；不覆盖定稿、不定稿 | 预览目标项目、章号、标题、正文长度与现有版本；确认后显示新增版本并调用 `db:draft-get-full` 回读 | 隔离真实 SQLite 项目关闭重开后回读标题、正文和 draft 状态；随后写出 UTF-8 Markdown 文件 | 空文件／无章号／重复章号／无正文／非法 UTF-8／大文件／取消／项目切换失效有覆盖；半写入依赖事务 | `chapter-draft-import.ts`、`import-controller.ts`、`db-controller.ts`、`draft-repository.ts`、`ImportChapterDraftDialog.tsx`；控制器／仓储／解析器／隔离项目测试与浏览器流程通过；详细见本报告“Markdown 与设置范围” |
| 通过 | 项目管理／导出对话框 → 单章、单卷、基础设定 | `ExportDialog` → `exportSelectedMarkdown` → `db:draft-export-selection/current`、蓝图卷 IPC、项目设置 IPC → 受限写授权 | 从 SQLite `contents.body` 读取选择版本；基础设定从 `project_core`、角色名单快照及结构化角色档案读取 | 预览明确列出实际章节／版本和缺项；成功列出导出路径；每次写入新 UUID 子目录 | 隔离临时目录实写 UTF-8；隔离 SQLite 导入正文关闭重开后再回读并导出 | 版本或标题哈希变化拒绝；卷成员变化、缺章、未归卷、重复选择拒绝／提示；失败包含已写文件状态 | `ExportDialog.tsx`、`export-service.ts`、`finalization-repository.ts`；服务和浏览器混合版本用例通过；单章正文中的换行保持 |
| 通过 | 项目管理 → 导出项目 → 全书合并 Markdown／分章 Markdown／TXT／Word | 兼容路径 `exportNovel` → `db:draft-export-snapshot`、authority receipt、`fs:grant-write-file/base64` | 当前已定稿章节数据库快照，导出目录受限授权 | 服务返回各目标文件与结果 | 新模式集成用例验证隔离目录 UTF-8 落盘读回；旧模式本轮用服务测试替身验证，未在 Electron 内实际选目录 | 无定稿、快照变化、部分分章写入失败由服务处理 | 全书 Markdown/TXT/Word 与 session 回归 6 文件／42 项通过；旧模式服务保留 `exportNovel` |
| 尚未测试 | 编辑区 → 多标签切换／关闭／未保存离开确认 | `EditorArea`、`editor-store`、各 editor 子组件 | 项目内 editor tab 状态、草稿缓冲与对应持久层 | active tab 和关闭确认 | 本轮未完整验证退出应用后标签／缓冲恢复 | 未保存关闭、跨项目旧 tab 清理尚未覆盖 | `src/components/panels/EditorArea.tsx`、`src/stores/editor-store.ts`；没有本轮端到端证据 |
| 尚未测试 | 右侧上下文栏 → 角色／蓝图／地图／资料／任务快捷链接 | `ProjectReferencePanel` → 角色 store、项目会话 IPC、layout/editor store | 当前章节蓝图、审稿、角色、地图和任务只读投影 | 点击转到对应侧栏或编辑器 | 本轮未对保存／重开回读 | 异步读取期间切换项目和错误提示未进行真实操作 | `src/components/panels/ProjectReferencePanel.tsx`；本轮无该面板浏览器操作用例 |
| 尚未测试 | AI 面板 → Agent、生成、改写、提示词、工作流执行 | `AIPanel`、agent command registry、workflow engine、`llm:generate(-stream)` | 实际输出先进入候选／编辑缓冲；正文仍由作者保存／权威流程提交 | 面板流式输出、工作流步骤和任务回显 | 本轮没有真实模型调用或模型结果数据库重开读回 | provider 错误、取消、超时和预算保护仅静态列出 | `src/components/panels/AIPanel.tsx`、`src/services/agent/`、`electron/controllers/llm-controller.ts`；真实模型 0 次；未运行针对模型的定向模拟统计 |
| 尚未测试 | 底部工具栏／状态栏 → 任务、日志、模型状态 | `BottomToolWindowBar`、`StatusBar`、`workflow-store`／`llm-store` | 运行状态、日志和模型配置 | 任务／日志／模型页签切换 | 仅运行态或设置状态，未做重开回读 | 工作流失败及状态恢复未端到端操作 | `src/components/layout/BottomToolWindowBar.tsx`、`StatusBar.tsx`；本轮无 UI 操作证据 |
| 尚未测试 | 标题栏／首页设置 → 外观、编辑器、模型／提供方、提示词、写作技能 | `SettingsModal`、settings stores、`config:*`、`llm:*`、`skills:*` | 应用配置／模型配置／技能文件；不属于小说正文 | 配置保存提示 | 本轮没有真实设置写入再启动回读 | 配置损坏和无模型连接尚未执行错误路径 | `src/components/settings/SettingsModal.tsx`、`electron/controllers/config-controller.ts`、`llm-controller.ts`；本轮没有设置 UI 流程测试 |
| 尚未测试 | 项目管理 → 备份／恢复／清除项目数据 | `ProjectTree`、`backup-controller`、`ClearProjectDataDialog`、项目清理服务 | 用户选择的备份目录；恢复目标须新项目目录；清理当前项目数据 | 成功数／完成状态 | 未实际备份后另目录恢复并回读 | 用户取消清理对话框的弹窗关闭在导航测试通过；磁盘错误、恢复冲突未测试 | `ProjectTree.tsx`、`electron/controllers/backup-controller.ts`；NAV-08 只验证取消关闭，不证明备份／恢复成功 |
| 尚未测试 | 标题栏 → 更新通知／检查更新 | `UpdateNotifier`、`update-controller` | 应用版本与更新状态，不访问小说正文 | 通知／更新状态 | 未执行安装后重启回读 | 网络失败、签名／更新失败未测试 | `src/components/updates/UpdateNotifier.tsx`、`electron/controllers/update-controller.ts`；本轮未操作 |

## Markdown 与设置范围

- **自由文档 A：** 已明确为“复制为项目自由文档”，落在受控项目文档目录；不会表示为正文数据库内容。控制器隔离项目测试覆盖复制、列表／读取及路径／项目边界；本轮没有跑完整编辑器保存重开浏览器流程。
- **参考作品 B：** 仍走现有拆解／仿写与 ImportRun 流程；新增章节草稿入口不绕过原始稿的冲突、连续定稿和 authority 检查。本轮没有宣称参考作品实际落库流程已通过。
- **章节内容 C：** 已实现选择、解析预览、显式确认、事务性新增草稿、读回。解析覆盖 `.md`、`.markdown`、空文件、无标题/章号、重复章号、多标题、非法 UTF-8、128 MiB 限制；输入文件只读。导入章标题单独保存于 `drafts.imported_title`，不修改 `blueprints`。隔离数据库测试覆盖关闭重开后正文和标题回读，服务测试覆盖 UTF-8 输出与再次导出使用全新目录。
- **单章导出：** 单一选择某个非定稿版本（`draft/revised/reviewed`）或当前权威定稿，预览标题／版本／正文，读所选 `contents.body`；避免重复章节标题。
- **单卷导出：** 按 `blueprints.volume_id` 组成清单；每章只要求一个显式来源，可混合草稿与当前正文；合并／逐章两个 Markdown 格式均实现。蓝图外正文单独列为未归卷提示；提交前复核卷成员和选中版本。
- **全书旧模式：** UI 保留原合并／分章 Markdown、TXT、Word 与大纲开关；回归状态见测试章节，不能把新模式通过当成旧模式结论。
- **基础设定：** 只实现故事前提、世界观（`project_core.worldSetting/worldbuilding`）、角色图谱（`renderedMarkdown` 优先，旧数据回退 `legacyMarkdown`）、结构化角色档案；可勾选、合并或逐文件导出，空值明确输出“暂无内容”。不包括自动解析／导入设定。
- **待确认范围：** 用户只确认到“世界观”；世界地图、地点、势力等结构化世界资料不纳入本次实现。若要导入基础设定，还需先确定字段确认和冲突规则，本次未做自动改写。

## 全项目功能审查的发现与限制

1. 本轮检查前工作区有既存首页、侧栏、样式、测试和本地脚本改动；均保留。对 `WelcomePage.tsx` 仅叠加 `.md/.markdown` 后缀与明确重选文案，未覆盖首页设计改动。
2. 导入标题起初只进入预览，没有落在新草稿的持久数据中；已修正为 `drafts.imported_title` 并加入 SQLite migration 与重开回读测试。
3. 较早导航夹具曾有 23 项通过，但文件随后并发变化；本轮最新导航执行是 13 项通过、4 项失败。参考入口和返回按钮查询失败，不能沿用旧结果，也尚不能仅据此认定产品缺陷。稳定的资源树、文档和编辑器浏览器测试另有 54 项通过。
4. 除 Markdown 相关用例、导航专项浏览器用例、隔离 SQLite 回读及所列控制器用例外，工作流实际写作、定稿发布、知识索引、设置、备份恢复、完整 Electron 项目切换和重开均未作真实操作验收。
5. **模型调用计数：** 本轮真实 provider/model 调用 **0 次，费用 0**。新增 Markdown、导航及 SQLite 定向范围没有模拟模型调用；全项目现有模拟模型测试的调用次数未由 Vitest instrumentation 统计，因此不推算为 0。
6. 没有操作 `D:\Desktop\小说`，没有对正式小说项目数据库写入；所有文件和数据库写入验证均用系统临时目录下的隔离项目／输出目录。

## 本轮测试记录

| 命令 | 结果 | 范围 |
|---|---:|---|
| `pnpm run typecheck` | 失败，6 项 TS 错误 | 错误均在并发未跟踪的 `src/components/__tests__/nav-browser-audit.browser.tsx`：2 个未使用导入、`FileNode.isDirectory` 不存在、`StoryTimelineSettings.calendarType` 不存在、`bottomTab: null` 类型不匹配、1 个未使用参数；该文件未被修改 |
| `pnpm run build` | 失败，`tsc` 退出码 2 | 被同一导航测试文件的上述 6 项错误阻断，尚未进入 Vite 的标准 build 阶段 |
| `node node_modules/vite/bin/vite.js build` | 通过，退出码 0 | Vite renderer、Electron main、preload bundle 完成；有 alias/freeze 配置、chunk 大小及 dynamic import 警告。此结果不替代被阻断的标准 `pnpm run build` |
| `node node_modules/vitest/vitest.mjs run electron/controllers/__tests__/chapter-markdown-import-controller.test.ts electron/services/__tests__/chapter-draft-import.test.ts electron/repositories/__tests__/draft-markdown-import.test.ts src/services/__tests__/export-service-markdown.test.ts src/services/__tests__/export-service-project-session.test.ts` | 5 文件／46 项通过 | 解析、授权预览、SQLite 仓储事务、导出服务与 session；本条为首次标题字段补充前运行 |
| `node node_modules/vitest/vitest.mjs run electron/__tests__/markdown-exchange-isolated.integration.test.ts electron/repositories/__tests__/draft-markdown-import.test.ts electron/controllers/__tests__/chapter-markdown-import-controller.test.ts electron/services/__tests__/chapter-draft-import.test.ts src/services/__tests__/export-service-markdown.test.ts` | 5 文件／17 项通过 | 含真实临时 SQLite 项目重开、标题与正文回读、临时目录 UTF-8 Markdown 文件落盘 |
| `node node_modules/vitest/vitest.mjs run electron/controllers/__tests__/chapter-markdown-import-controller.test.ts electron/services/__tests__/chapter-draft-import.test.ts electron/repositories/__tests__/draft-markdown-import.test.ts electron/__tests__/markdown-exchange-isolated.integration.test.ts src/services/__tests__/export-service-markdown.test.ts src/services/__tests__/export-service-project-session.test.ts electron/__tests__/project-documents-controller.test.ts src/components/dialogs/__tests__/import-novel-dialog-copy.test.ts src/components/dialogs/__tests__/import-novel-paths.test.ts` | 9 文件／61 项通过 | 最新 Markdown 核心、会话边界、临时数据库／文件及旧导入兼容定向组合 |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/dialogs/__tests__/markdown-export.browser.tsx src/components/dialogs/__tests__/markdown-chapter-import.browser.tsx` | 最新 2 文件／6 项通过 | UI 预览、混合版本卷导出、正文无蓝图提示、缺少可选版本禁导出、取消、确认、重开读回 IPC 路径与项目切换中断；IPC 为隔离替身 |
| `node node_modules/vitest/vitest.mjs run electron/controllers/__tests__/db-controller-project-context.test.ts src/services/__tests__/export-service-markdown.test.ts` | 2 文件／40 项通过 | 单章草稿、单章当前正文、同章多版本 IPC 拒绝、单卷缺少明确版本拒绝、四类设定、重复导出目录隔离 |
| `node node_modules/vitest/vitest.mjs run src/components/__tests__/ui-project-session-gates.test.ts src/services/__tests__/export-service-integration.test.ts src/services/__tests__/docx-export.test.ts src/services/__tests__/export-service-project-session.test.ts src/services/__tests__/export-service-markdown.test.ts electron/__tests__/markdown-exchange-isolated.integration.test.ts` | 6 文件／42 项通过 | ExportDialog 会话门禁修复、原全书 Markdown／TXT／Word 服务回归与 isolated UTF-8 文件／SQLite 回读 |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/__tests__/nav-browser-audit.browser.tsx` | 1 文件／13 通过、4 失败 | 最新并发夹具结果；首页参考入口、项目返回和两个取消查询失败；文件未覆盖 |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/pages/__tests__/welcome-markdown-drop.browser.tsx src/components/panels/sidebar/__tests__/ProjectTree.sidebar-groups.browser.tsx src/components/panels/sidebar/__tests__/ProjectTree.information-architecture.browser.tsx src/components/panels/sidebar/__tests__/ProjectDocumentsView.boundaries.browser.tsx src/components/editor/__tests__/ProjectDocumentEditor.unsaved-close.browser.tsx src/components/dialogs/__tests__/import-novel-resume.browser.tsx` | 6 文件／54 项通过 | 独立稳定的资源树、文档边界、编辑器关闭与导入恢复流程 |
| `node node_modules/vitest/vitest.mjs run --config vitest.browser.config.ts src/components/dialogs/__tests__/dialog-cancel-flows.browser.tsx src/components/pages/__tests__/welcome-markdown-drop.browser.tsx` | 2 文件／5 项通过 | 新建项目／导出对话框取消关闭以及首页 Markdown drop 提示 |
| `node node_modules/vitest/vitest.mjs run test/nav-backend-audit.test.ts electron/__tests__/project-documents-controller.test.ts src/components/dialogs/__tests__/import-novel-dialog-copy.test.ts src/components/dialogs/__tests__/import-novel-paths.test.ts` | 4 文件／16 项通过 | 临时数据库重开与项目数据层隔离、自由文档文件边界、导入文案／路径契约 |
| `node node_modules/vitest/vitest.mjs run` | 365 文件：362 通过、1 失败、2 跳过；3331 项：3302 通过、2 失败、27 跳过 | 最新全量复跑，519.46 秒。唯一失败文件 `src/__tests__/app-skin-background.test.tsx` 的 2 个断言期望旧 CSS 透明度 56%／60%／64%，当前工作区 CSS 值为 84%；`src/styles/literary-workbench.css` 在审查开始前已是修改状态，本轮保留未改 |
