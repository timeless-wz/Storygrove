# 基础设定与 AI 工作流：现状检索与归纳

日期：2026-10-03。范围：当前本地源码中的基础设定、AI 生成入口、执行流程、持久化与主要下游读取。

本报告不是改造指令。本次未修改应用源码、未执行模型调用、未写用户项目数据、未运行端到端测试。结论属于代码静态核查；有实现不等于已经在真实模型和当前运行程序中验证成功。之前菜单拆分文档不应当作本次重新确认的最终方案。

## 一、三个层面必须分开理解

| 层面 | 当前对象 | 实际职责 |
| --- | --- | --- |
| 内容 | 创作方向、故事前提、世界观、角色、大纲等 | 保存和维护作者的资料 |
| 生成入口 | 单字段按钮、单篇文档按钮、AI 生成故事设定总览、Agent 工具 | 选择目标、范围、指导并启动操作 |
| 执行与观察 | workflow-store、右侧 AI 工作流/输出面板、底部任务进度 | 执行步骤、记录状态、流式输出、取消、历史和部分恢复 |

侧栏“AI 生成故事设定”与右侧“AI 工作流”不是同一页面。前者是架构生成管理页；后者由 Agent 工具栏打开 ai-output，消费 activeRuns/history，主要呈现执行过程。它们没有各自复制一套正式设定库。

## 二、基础内容盘点

### 1. 创作方向

页面：NovelConfigEditor。数据：NovelConfig，经 project-store.saveProject → project:save → 主进程 project_core 更新。

| 类别 | 主要字段 | 用途 |
| --- | --- | --- |
| 作品参数 | writingLanguage、genre、subGenre、targetAudience、totalChapters、wordsPerChapter、narrativePOV | 语言、题材、读者、篇幅和视角 |
| 内容构想 | coreOutline、worldSetting、goldenFinger、protagonistProfile | 故事构想、背景、主角优势、主角构想 |
| 写作要求 | globalGuidance、writingStyle、referenceWorks | 持续写作约束、文风及参考 |
| 结构与其他控制 | plotStructure、creativeStrategy、narrativeThreadDormantChapterThreshold | 大纲组织方式、创作策略、章节脉络提醒等；字段存在不代表每项都在同一表单直接显示 |

它不只是书籍元数据，也不只是一次性的起步向导。构想字段继续参与设定生成；生成正文时还被装入 authorProjectFacts。UI 称其为“初始构想”，不意味着已经退出后续上下文。

AI 填充整套配置通过 createConfigGenerationWorkflow 启动；单字段生成由页面直接执行 GenerateFieldCommand，随后更新配置并保存。不能据工作流面板是否有任务就判断该字段是否调用过 AI。

### 2. 故事前提

事实位置：project_core.premise；文档 URI：vela://core/premise。

描述核心故事、冲突、钩子与主角优势。可手动编辑，也可由 AI 根据配置、指导和模板生成。生成成功写回该文档字段，后续角色、世界观、大纲、蓝图和正文读取它。

与 coreOutline 区别是数据和用途，不是当前系统已经建立了严格的“草案 → 审核正式化”转换。两份内容可以同时存在并变化。

### 3. 世界观总纲

事实位置：project_core.worldbuilding；URI：vela://core/worldbuilding。

是整体规则与背景长文。生成主要读取 premise 与配置中的 worldSetting/goldenFinger/protagonistProfile/globalGuidance 等。未完成输出保存为候选；恢复时校验来源和正式文档是否变化，符合条件的完成结果才写回正式字段。

它与世界管理里的 worlds/factions/relics 等结构化记录不同。本次检查的架构生成链未发现将总纲自动拆成世界、势力、秘境实体的落库步骤，也未发现该链直接读取整个世界工作台快照。不能宣传二者自动同步或全量自动消费。

### 4. 角色档案及角色图谱

角色名单/档案是正式角色资料来源。角色图谱文档是名单的只读投影，不能将其当作另一套自由编辑的角色正文。

架构流程的 characters 步骤生成身份与详细资料，通过 db:character-roster-commit 保存。情节大纲当前读取 project_core.charactersArch 投影；生成正文则读取 roster，按章节相关人物筛选，并解析已绑定修炼等级。

### 5. 情节大纲

事实位置：project_core.synopsis；URI：vela://core/synopsis。

是全书剧情计划，可以手写或生成。生成要求有故事前提、角色投影和世界观，并使用总章数、结构偏好、视角与指导。支持章范围和中断续写；提交通过 db:project-core-synopsis-commit 检查预期来源。

下游：蓝图生成读取它；正文生成对可识别的章节结构作当前章投影，无法安全分段时保留整体文本。情节大纲不是蓝图的别名，也不是正文。

### 6. 世界、地图与修炼

- 世界管理：各世界介绍、势力、秘境、规则、通道、人物关联、历史关联与行踪，走自己的 world IPC/repository。
- 地图：空间表达及地点记录；不是世界实体本身，一个世界可以关联多张地图。
- 修炼：当前项目单套结构化等级及角色绑定。正文角色材料可以解析绑定等级；不能把“修炼没有单独的大生成流程”误写为“AI 完全不会读取等级”。

以上是基础资料相关功能，但其 AI 接入程度不同。新世界 UI 的存在不证明生成器会自动使用每条实体记录。

## 三、AI 能力与入口盘点

| 能力 | 主要入口/路径 | 产物与限制 |
| --- | --- | --- |
| AI 填充配置 | GenerateConfigDialog → createConfigGenerationWorkflow | 更新配置，不等于生成全部正式设定 |
| 单字段生成 | NovelConfigEditor → GenerateFieldCommand | 更新选定配置字段并保存；没有复用完整 startWorkflow 入口 |
| 故事架构生成 | WorldBuildingEditor / ArchFileViewer → ArchitectureConfirmDialog → launchCreativeWorkflow | 四个可选步骤：premise、characters、worldbuilding、synopsis |
| 世界观、大纲恢复 | 总览及相关恢复入口 → 同一架构流程的恢复参数 | 只在相应候选/检查点与来源条件满足时继续 |
| 章节蓝图生成 | createDirectoryWorkflow | 根据已有架构生成章节规划；不是生成世界实体 |
| 写稿、审稿、修稿、定稿 | chapter-workflow 中不同工厂与编辑器入口 | 写稿用蓝图；审改等需要明确草稿与不可变快照，不是只传章号就都能执行 |
| 批量章节 | batch-chapter-workflow | 编排章节执行，不能等同无条件一键完成全书 |
| 创作资料导入与提取角色 | planning-material-workflow | 导入知识库；另有角色候选生成、确认合并流程 |
| 小说导入与后处理 | import-workflow 等 | 导入和派生处理，属于相关能力，不应混入基础设定分类 |
| Agent 发起工作流 | start-workflow.tool → creative-workflow-launcher | 复用已有执行链；枚举有 review/refine/finalize，但通用启动器会要求从编辑器提供明确草稿上下文，不能声称全部枚举均可独立启动 |

工作流可以包含普通导入、提交和刷新步骤，不是每一步都调用模型。

## 四、三张卡片为什么让人困惑

总览只显示 premise/worldbuilding/synopsis 三份文档，代码明确过滤 characters；但生成步骤选择器包含四项。其“3/3 有内容”只数三份文档非空，与四步工作流完成度、人工确认、生成来源不是同一个指标。

同一正式文档可通过侧栏、总览卡片、文档页面访问。单篇文档页面本来就有 AI 生成/重新生成按钮；不是本次讨论才提出的新能力。

此外，单篇入口通过 initialSelectedSteps 预选目标；默认选择函数还会选上缺失步骤。因此“从世界观页点生成”不必然意味着弹窗只选世界观，要以确认弹窗实际勾选为准。这是应解释清楚的交互事实，不应假设它绕过了依赖。

## 五、真正的前置条件

| 操作 | 当前核对到的检查 |
| --- | --- |
| 启动架构生成 | 当前项目有效；配置中故事/主角/背景构想至少一项有内容 |
| 生成世界观 | premise 非空、不含待生成且达到代码长度要求；还受恢复来源校验约束 |
| 生成情节大纲 | premise、charactersArch、worldbuilding 存在且非待生成；总章数有效 |
| 生成章节蓝图 | guard 要求有效前提（长度大于 50 等）及至少一张角色卡；其他架构缺失可以返回警告但允许继续 |
| AI 写稿 | 目标蓝图存在；后续章节还受前章定稿来源等上下文约束 |

检查大多依据内容及状态，不是检验“是否由 AI 生成”。因此文案“尚未生成，请生成”容易把可以手工填写的资料误导为必须使用 AI。

入口 guard、具体命令、提交阶段的校验不是完全同一层；不能只看菜单按钮是否可点，就判定某流程能完成。

## 六、内容如何进入后续写作

```text
创作方向的参数/构想/写作要求
  ├─→ 故事前提生成
  ├─→ 角色与世界观生成
  ├─→ 大纲生成的篇幅/视角/结构约束
  └─→ 正文材料中的作者项目事实与指导

故事前提 + 角色投影 + 世界观 + 配置
  └─→ 情节大纲

前提/角色/世界观/大纲等已有架构
  └─→ 章节蓝图（有独立前置条件，并非必须四项全部齐全）

蓝图 + 正式架构 + 作者配置事实 + 相关角色档案
  + 文风/全局指导 + 相关资料 + 前文/候选来源等
  └─→ 正文生成
```

generate-draft 将四个构想字段排除出普通配置 JSON，但又明确通过 assembleChapterMaterials.authorProjectFacts 注入；不能因看到 JSON 排除就下结论“旧构想不再被使用”。正式架构做精确重复段落去重，这不是语义冲突处理。

## 七、已经确认的混乱点

1. **内容导航与操作导航并列。** 作者找世界观时要判断去文档、总览还是工作流面板，实际上其职责应分别是内容、发起、过程。
2. **构想与正式资料重复且同时有效。** 背景构想/世界观/世界实体，主角构想/角色档案，故事构想/前提/大纲，都缺少作者容易理解的边界。
3. **三份文档状态与四个生成步骤不一致。** 有内容、生成完成、已确认不能共用一种完成含义。
4. **生成按钮已存在多处。** 继续新增入口未必改善体验，需要统一操作反馈与定位结果。
5. **保存和确认方式并不统一。** 配置与单字段会更新保存，前提会直接写文档；世界观有未完成候选保护，大纲有来源校验，资料提取角色有确认步骤。不能笼统说“所有 AI 结果都先预览再确认”。
6. **实体资料与长文档的 AI 覆盖不对称。** 角色有明确结构化写入和读取链，世界总纲没有在本次核查链中自动展开成多世界实体。
7. **手写内容被“未生成”文案弱化。** 当前系统实际上允许编辑文档，但多个前置提示仍以 AI 生成措辞表达。
8. **工作流观察入口不是所有 AI 调用的完整目录。** 单字段命令与统一运行任务的路径不同，面板空白不证明无 AI 功能。

## 八、归纳结论与下一步顺序

基础设定是作者长期维护的内容；AI 工作流是围绕这些内容及章节执行的操作系统；右侧输出面板是运行过程的观察与控制界面。三者需要关联，但不能按同一种维度拆菜单。

暂不确定最终菜单树，也不合并数据字段。先确定以下产品规则：

1. 每份内容回答什么问题，哪些内容具有当前有效设定身份；旧构想何时仍参与生成。
2. 单页生成与批量生成使用同一套目标/前置/覆盖说明；运行后能跳到真实结果。
3. 有内容、候选、执行状态、作者确认分别表达。
4. 世界实体与总纲的写作上下文边界明确后，再设计世界级 AI 功能。
5. 最后决定将哪些入口放侧栏、页面按钮或工作流中心，避免先重排菜单再发现依赖不符。

原实现的工作流执行引擎有必要保留；是否保留独立“架构生成总览”页面是产品选择，不能由“底层有工作流”直接推导出“侧栏必须有 AI 生成故事设定”。

## 九、可复核源码索引

- `src/shared/ipc-channels.ts:696`：NovelConfig 字段。
- `src/components/editor/NovelConfigEditor.tsx:133`：单字段 AI 执行入口。
- `src/components/dialogs/GenerateConfigDialog.tsx:105`：整套配置工作流入口。
- `electron/controllers/project-controller.ts:609`：配置持久化字段映射。
- `src/services/vela-protocol.ts:13`：正式文档与字段映射、角色只读投影。
- `src/components/editor/WorldBuildingEditor.tsx:58`：三卡片过滤。
- `src/components/editor/ArchFileViewer.tsx:523`：文档页已有 AI 生成按钮。
- `src/services/architecture-step-selection.ts:1`：四步与默认勾选。
- `src/services/workflows/architecture-workflow.ts:105`：四步执行工厂。
- `src/services/workflows/commands/architecture.command.ts:1180`：前提生成及保存；其后包含角色、世界观、大纲命令。
- `src/services/workflow-guards.ts:54`：入口前置检查。
- `src/services/workflows/creative-workflow-launcher.ts:121`：统一启动器与草稿上下文限制。
- `src/components/panels/agent/AgentConversation.tsx:205`：AI 工作流按钮打开 ai-output。
- `src/components/panels/AIOutputPanel.tsx:39`：运行与历史来源。
- `src/stores/workflow-store.ts:317`：取消、暂停、恢复等执行能力。
- `src/services/workflows/commands/generate-draft.command.ts:446`、`:504`、`:668`、`:1310`：构想事实、配置过滤、材料装配、架构读取。
- `src/services/workflows/directory-workflow.ts:413`：蓝图读取已有架构。
- `src/services/workflows/planning-material-workflow.ts:94`：资料角色提取与确认流程。
- `src/shared/world-workbench.ts`、`src/shared/cultivation.ts`：实体与等级数据边界。

以上行号为检索时定位参考，后续代码变化可能偏移。本报告未声称全系统所有生成入口已穷尽；重点覆盖用户指定的基础设定及其直接关联流程。
