# 多世界资料管理功能：实施指令

请在 `D:\ai\AI-Novel-Writer-master` 实现以下功能。这是一份完整实施任务，要求交付可操作、可持久化、可重新打开验证的功能，不只给方案或静态页面。

本指令基于 2026-09-30 对当前工作区源代码的只读检查。执行前请再次检查实际代码与差异；下面的现有文件是真实入口，新增文件和类型名称属于建议，不能声称已经存在。

## 1. 用户已经确认的需求

一本小说项目可以创建多个世界，每个世界分别管理：

1. 世界名称、介绍和背景。
2. 区域与地点。
3. 势力及势力之间的关系。
4. 秘境。
5. 与项目已有角色的关联。
6. 人物出生地和目前所在地。
7. 关联地图。
8. 世界之间的通道。
9. 世界规则。
10. 重要历史事件。
11. 人物行踪。

各类资料可以相互关联和跳转。同一人物可以关联多个世界，但人物本身只有一份项目角色资料。

### 尚未被用户明确指定的实现细节

用户没有确定地图必须采用图片标记还是节点连线，也没有要求新增一级侧栏、自动生成内容或自动从正文提取行踪。此次采用以下默认实现，并在交付说明中标明这些是实现选择：

- 复用现有多地图地图册的图片、标记、列表和连线能力，不新造第二个地图编辑器。
- 增加一个明确的“世界”入口，放在现有项目树的创作规划区域，邻近地图册；保留原地图册和故事时间线入口。世界工作台内提供世界列表和所选世界的详情。
- 新功能以作者手工录入和关联为主，无模型调用依赖。
- 世界之间通道首先在两端地图上表现为入口标记和跳转，不要求一次绘制跨两张底图的连线。
- 势力和秘境默认分别有一个所属世界；人物及历史事件支持关联多个世界。跨世界势力分支本轮使用不同势力记录和“分支/附属”关系表达。
- 地理范围第一版用地点集合及说明表达，不要求绘制领土多边形。

不要以这些未确定细节为理由只交付部分功能；按默认选择完成，并说明实际选择。

## 2. 修改边界

- 当前工作区有大量未提交修改，包含地图、角色仓库、数据库、IPC、编辑器及蓝图。先执行 `git status --short`，阅读相关差异，保留已有成果；不得 reset、覆盖或清理其他人的修改。
- 修改程序源代码及测试，数据库验证用临时测试项目或副本；不得拿用户真实小说数据进行破坏性试验。
- `D:\Desktop\小说` 是只读母稿目录，禁止修改、移动、删除。
- 维持 SQLite 为结构化事实来源；不得把新增资料只存进 localStorage、Zustand 或独立的第二份角色 JSON。
- 不改变草稿、定稿、出版、章节蓝图绑定和正文生成流程。
- 不自动把候选资料变成已确认事实，不绕过资料审核和批准快照。
- 本任务不要求 AI 生成、云端同步、联网地图、全书模型抽取、发布、打包安装程序或全局重做界面。

## 3. 先阅读并复用现有代码

### 地图

- `src/shared/world-map.ts`：`WorldMap`、`WorldMapNode`、`WorldMapEdge`、地图图片与地图册契约。
- `electron/repositories/world-map-repository.ts`：`WorldMapRepository.getAll`、`upsertMap`、`upsertNode`、`upsertEdge`、`planMapDelete`、`deleteMap`、`deleteNode`。
- `src/stores/world-map-store.ts`：地图加载、保存与项目会话处理。
- `src/components/map/WorldMapView.tsx`、`WorldMapCanvas.tsx`、`WorldMapAtlasTree.tsx`、`WorldMapListView.tsx`、`WorldMapNodeDialog.tsx`。
- `electron/controllers/world-map-image-controller.ts`、`electron/services/world-map-image-store.ts`：图片选择、导入和项目内托管。
- `electron/services/world-map-atlas-migration.ts`：已有地图升级逻辑。

当前地图规则：一个地点有唯一且不可变的 `mapId`；父地点与普通边必须处于同一张地图。`WorldMapRepository.upsertEdge` 明确拒绝跨地图连接。节点虽已有 `world`、`faction`、`relic` 类型，它们仍是地图节点，不能据此当作完整的世界、势力或秘境资料实体。

### 人物

- `src/shared/character-roster.ts`：结构化角色名单、位置动态字段及 author/derived/legacy 来源。
- `src/shared/character-relationship.ts`：`CharacterIdentityMap` 及稳定人物 ID。
- `electron/repositories/character-relationship-repository.ts`：`character_identities`、`getIdentities`、`ensureIdentities`、`reconcileIdentities`、`applyRenames`、`deleteCharacterCascade`。
- `electron/repositories/character-repository.ts`：`CharacterData`、`saveAll`、`delete`、`updateState`；`characters` 当前以姓名为主键，已有 `cs_location`。
- `electron/repositories/character-roster-repository.ts`、`src/services/character-roster-client.ts`：角色提交、revision 与角色图谱投影契约。
- `src/stores/character-store.ts`、`src/components/editor/CharacterEditor.tsx`、`src/components/editor/character-profile/CharacterProfileForm.tsx`。
- `docs/adr/0007-structured-character-roster-fact-source.md`、`docs/adr/0017-source-bound-character-state-and-continuity.md`。

新关联使用既有稳定人物 ID，姓名只用于展示，不自建重复人物身份系统。不能只按姓名字符串关联，也不能绕过角色名单的版本和投影一致性直接更新 `cs_location`。

### 时间线、资料与规则

- `src/shared/story-timeline.ts`：`StoryTimelineEvent`，已有 `timeLabel`、`sortOrder`、`precision`、`chapterNumbers`、`characterNames`、`locationNodeIds`、支线字段。
- `electron/repositories/story-timeline-repository.ts`、`src/stores/story-timeline-store.ts`、`src/components/timeline/StoryTimelineView.tsx`。
- `electron/services/story-domain-schema.ts`、`electron/repositories/story-domain-repository.ts`：来源绑定的候选/正式故事事实，已有 world_rule、faction、place、timeline_event 等类别。
- `electron/database.ts` 中的 `setting_rules`：现有资料审核规则。先调查真实用途，不得静默将其与世界规则合并。

### 导航、保存与 IPC

- `src/components/panels/sidebar/ProjectTree.tsx`：当前地图册和时间线入口。
- `src/components/panels/sidebar/sidebar-file-openers.ts`：`openBuiltinEditor`。
- `src/stores/editor-store.ts`：`EditorTab` 类型、项目作用域、退出保存处理。
- `src/components/panels/EditorArea.tsx`、`src/components/panels/ProjectReferencePanel.tsx`。
- `src/components/editor/WorldBuildingEditor.tsx`：原故事架构编辑器，保留其原有文档与生成行为。
- `src/shared/ipc-channels.ts`、`src/services/ipc-client.ts`、`electron/controllers/db-controller.ts`、`electron/preload.ts`、`electron/ipc-handlers.ts`。
- `src/components/project-session-gate.ts`、`src/shared/project-session-context.ts`。

导航文档可能落后于工作区当前 UI，以当前代码为准，并在功能完成后更新相应导航说明。

## 4. 世界、地图和地点的关系

“世界”是小说设定实体，“地图”是世界中某一层空间的展示，两者不是同一个 ID，也不是一对一关系。

- 一个世界可以没有地图，也可以有多张地图，如世界总图、大陆图、城市图。
- 一张地图最多归属一个世界；旧地图允许暂未关联世界。
- 地点继续复用已有地图节点，并通过地图归属确定所属世界，避免重建一套同名地点事实。
- 世界中的区域/地点页按地图展示和筛选地点；创建地图节点时复用既有类型和父子结构。若补充地点类型，做向后兼容扩展。
- 没有地图时也能填写世界、势力和秘境资料，位置允许只选世界或补充文字说明。精确地点关联需要先创建地图和节点。
- 旧地图不根据名称、根节点类型或父地图自动推断世界归属；提供明确的“关联到世界”操作。
- 已绑定世界的父子地图树不能跨世界混挂；绑定旧地图子树或改变归属前做影响预览和显式操作。
- 修改地图世界归属时，应拒绝造成势力、秘境、人物位置或通道端点世界不一致的修改，并列出需要先处理的引用；不要静默搬移整批实体。
- 地点已有地图父子结构继续限定同图，跨图上下级通过地图树表达，不解除现有限制。

## 5. 各模块功能与字段

所有主要实体均有稳定 ID、创建/更新时间；名称必填，描述支持长文本。除有效引用所必需的内容外，字段允许未设定，不编造默认设定。

### 5.1 世界

支持新增、编辑、搜索、选择和删除影响预览。

字段：名称、简介、详细背景、备注、排序；关联地图和世界内各类资料。

世界概览展示真实介绍、关联地图和各模块数量，支持进入对应列表。无内容时展示明确空状态和创建入口。

### 5.2 势力

字段：所属世界、名称、类型（宗门/家族/国家/组织等，可自定义）、简介、详细介绍、驻地、控制地点集合、范围说明、备注。

支持：

- 与人物关联并记录身份/关系，如宗主、成员、弟子、叛徒，可补充任职时间。
- 关联掌控或争夺的秘境。
- 势力间联盟、敌对、附属、分支和自定义关系。
- 对称关系只存一次，附属/分支等有向关系保存方向；拒绝自身关系及同类型重复关系。
- 世界内列表只显示本世界势力，跨世界势力关系可在详情展示对端世界。

### 5.3 秘境

字段：所属世界、名称、类型、简介、详细介绍、位置说明、地图地点、入口地点、进入条件、危险、资源/奖励、开放时间说明、状态、备注。

状态至少包括未发现、封闭、即将开启、开放、崩毁；可扩展。

关联势力与人物时记录关系，如掌控、争夺、守护、发现、曾进入。秘境与“遗境”地图节点通过明确关联连接，不自动把所有 relic 节点改成秘境。

状态是作者维护的设定，不按电脑时间自动开启或关闭。

### 5.4 人物与世界

- 从已有项目角色选择，展示既有资料摘要并能跳转角色详情。
- 世界人物关联有关系说明，如出生于此、居住于此、曾经活动、外来者；出生地/当前位置关联也应纳入对应世界的人物展示，来源区别可见。
- 多个世界引用同一稳定人物 ID。人物改名后所有新关联仍有效。
- 删除世界中的人物关联不删除项目角色，不默认清空其出生地或当前位置；若这些位置仍指向本世界，人物仍可通过位置关联出现在列表中。

### 5.5 出生地和目前所在地

出生地字段：世界、可选地图地点、补充说明。出生地是可编辑的背景信息，与当前位置互不覆盖。

目前所在地字段：世界、可选地图地点、补充说明、剧情时间、可选关联章节。保留“未知/未设定”状态。

人物位置详情在角色页和世界页一致，地图页可查看处于某地点的人物。

重点处理现有 `currentState.location`：

- 旧文字位置原样保留，升级时不得自动匹配地图地点。
- 结构化位置属于同一角色位置事实的扩展。世界页和角色页通过同一业务提交更新，不能两套字段各自编辑、互相矛盾。
- 显式设置结构化当前位置时，以事务更新关联、角色位置显示所需字段和作者来源，并维持角色名单 revision/投影一致性。
- 旧角色页直接编辑位置文字或合法后处理改变位置后，原结构化绑定必须同步处理或标记失效，界面不能继续把旧地图地点显示为当前已确认位置。
- 不覆盖其他动态状态，不将旧 legacy 值标为作者确认；继续遵守作者值和定稿派生来源边界。
- 只补充位置关联、未改位置事实时，不得把 derived/legacy 来源伪装成 author。

### 5.6 世界之间的通道

作为独立业务实体管理，不能通过放开 `WorldMapEdge` 的跨地图限制实现。

字段：名称、类型（传送阵/飞升通道/裂隙等）、起点世界、终点世界、可选两端地图地点、单向/双向、通行条件、代价、开启时间说明、状态、介绍与备注。

关联控制势力和守护人物，并记录关系。

- 第一版世界间通道的两端世界必须不同；端点地点必须归属选定世界。
- 两个端点世界都能查看同一个通道，不复制两份。
- 图上选中入口可查看条件，并跳转对端世界/地图/地点。
- 未设具体地点时可保存世界级通道，明确显示“入口地点未设定”。
- 单向通道在 UI 明确显示方向，不将反向访问表示为可通行。

### 5.7 世界规则

字段：所属世界、名称、分类、规则内容、适用范围、限制/禁忌、违反后果、例外说明、备注。

支持分类：修炼体系、力量上限、自然规律、时间规律、禁忌，以及自定义分类。

- 默认适用整个世界，也可关联适用区域/地点/秘境。
- 例外作为同一规则的结构化例外记录或明确关联记录，注明例外范围与内容。
- 适用和例外目标必须属于该世界。
- 此处首先是设定管理，不增加自动干预写作或强制校验正文的机制。
- 新手写规则有明确的作者来源；引用已有审核规则或 story_facts 时保留原事实 ID 和来源状态。不能为了填写来源字段伪造文件、快照或确认记录。
- 禁止未经明确操作将新增规则自动写入现有 approved snapshot、知识库或正文提示词。

### 5.8 重要历史事件

优先扩展既有 `StoryTimelineEvent`，新增世界关联、历史事件标识、结果、后续影响及实体关系元数据；世界历史页和故事时间线使用同一个事件 ID 和事件内容。

字段：标题、时间文字、时间精度、排序刻度、经过、结果、后续影响、可选章节；关联一个或多个世界、地点、势力、秘境、人物及通道。

- 历史可以早于故事开端，也可晚于开端，不强制关联正文或正整数章节。
- 模糊纪年保留文字与精度，用独立刻度排序，不把虚构纪年强行解析为真实日期。
- 关联多个世界时，各世界历史页显示同一事件；删除某一世界关联不删除共享事件。
- 维持原时间线主轴、支线和父事件行为，不在迁移时改动原排序或把所有旧事件自动标为历史。
- 原 `characterNames` 保持兼容，新结构化人物关联复用稳定人物 ID，展示名随改名更新。
- 若历史事件需要在旧故事范围外展示，新增历史视图处理其范围，不为了显示历史强行覆盖作者配置的故事开端/结局范围。

### 5.9 人物行踪

字段：人物稳定 ID、所在世界、可选地图地点、位置说明、到达时间、离开时间、时间精度、独立排序刻度、行动原因、可选章节、备注；可关联经过的通道和参与事件。

- 在人物页查看该人物全部行踪；在世界页筛选本世界的记录；在地图地点查看相关行踪。
- 第一版以文字与列表展示为主，不要求自动生成路线或复杂播放动画。
- 新增/补录记录默认不改变目前所在地，提供“同时设为目前所在地”选项。
- 启用该选项时，行踪保存和位置更新必须在同一事务中成功或回滚，失败后不能显示已更新。
- 不按创建时间、最大章节号或排序刻度自动推断谁是当前地点。
- 编辑或删除被用于当前位置的行踪时，明确处理该依赖：取消绑定并提示重新确认，或要求用户显式确认修改当前位置；不能悄悄换成另一条行踪。
- 未知、相对时间允许保存；只有在存在可靠可比较刻度时才校验离开不早于到达。
- 关联通道时验证行踪世界/地点与通道端点相符；允许入口地点未设定的世界级匹配。

## 6. UI 与操作闭环

建议布局：世界列表 + 所选世界工作台，工作台提供概览、地图与地点、势力、秘境、人物、通道、规则、历史事件、人物行踪等分区。

必须满足：

- 世界和各实体具备创建、查看、编辑、搜索/筛选、删除或解除关联的真实操作。
- 表单保存后刷新列表和详情；重启应用或重开项目后结果仍正确。
- 各关联条目可跳转真实目标，地图跳转能选对地图并定位目标节点，不只打开地图首页。
- 来源视图与目标视图及时同步，反向关联采用查询同一关系，不重复保存两份互相矛盾的数据。
- 世界切换前对未保存编辑按既有保存/取消流程处理；保存失败留在原世界和原实体，保留输入。
- 载入中、无数据、未关联地图、对象不存在、保存失败分别显示实际状态。
- 地图已有图片导入、缩放、拖动、标记、列表、图标、圆角与主题样式保持可用。
- 使用项目现有组件与主题 token，支持中英文与深浅主题。列表较多时采用分区、搜索和详情面板，避免把全部字段堆到概览页。
- 新编辑器接入项目作用域、关闭/退出保存和未保存提示；没有打开项目时禁用写入。
- “删除关联”“删除实体”“删除项目角色”“删除地图”必须区分，避免误操作。

## 7. 数据模型、迁移与删除策略

先整理类型与关系，再实现仓库、IPC、store 和 UI。可以新增世界实体仓库与 schema 服务，建议 `src/shared/world-workbench.ts`、`electron/repositories/world-workbench-repository.ts`、`electron/services/world-workbench-schema.ts`、`src/stores/world-workbench-store.ts`、`src/components/world/`；这些文件当前尚不存在。

最少需要表达：世界、地图世界归属、势力、秘境、世界人物关联、角色出生地与当前位置扩展、势力关系、各类人物身份关系、秘境掌控关系、通道、规则与范围/例外、时间线事件世界关联及实体关系、人物行踪。

具体表名可调整，但必须：

- 关系使用稳定 ID；人物 ID 复用 `character_identities`，地点 ID 复用 `world_map_nodes`，事件 ID 复用 `story_timeline_events`。
- 所属世界、关系端点、引用对象在主进程校验，不能只靠前端下拉框。
- 设置外键/索引/唯一约束及必要事务；通用关联表若不能使用外键，提供等效的校验和删除完整性维护。
- 完成新建库和旧库的幂等迁移；迁移重复运行不丢内容，不制造多个默认世界。
- 旧地图、节点、连线、图片、角色、时间线、文字位置完整保留；未归属资料保留为未关联，不猜测归属。
- 手工实体与已有来源绑定事实保持可追溯关联，不制造第二套相互覆盖的确认流程。

删除默认采用保守策略：

- 世界被资料、地图、通道或人物位置引用时，先展示引用计数与清单，默认阻止直接删除，要求先解除/处理依赖。本轮不要求一键级联删除整个世界。
- 删除势力或秘境时预览依赖，阻止或显式处理引用，不删除其关联角色、地图节点或历史事件。
- 删除地图/地点前扩展现有影响预览，处理出生地、当前位置、秘境位置、势力驻地、规则范围、通道端点和行踪引用；默认阻止有新业务引用的破坏性删除。
- 删除项目角色接入既有 `deleteCharacterCascade`/角色提交流程，处理新引用。共享历史事件、世界、势力、秘境和通道不能随角色删除。若保留历史姓名证据，需要显式标注角色已删除且禁止跳转到不存在对象。
- 删除历史事件时处理行踪和其他引用，不遗留隐藏的有效引用。
- 多步关系更新、位置设定、解除引用与实体删除必须保持事务一致性；图片失败处理继续复用既有恢复逻辑。

## 8. IPC、权限与项目隔离

既有真实通道包括：`db:map-get-all`、`db:map-upsert`、`db:map-node-upsert`、`db:map-edge-upsert`、`db:timeline-get-all`、`db:timeline-event-upsert`、`world-map-image:select-and-import`。

新增通道在 `src/shared/ipc-channels.ts` 定义完整 args/return，可使用 `db:world-*` 命名；新名字属于设计，不要当作已有 API 使用。

- 通过主进程既有 `registerProjectDatabaseHandler` 或等效会话门禁注册；新增写通道纳入 `MUTATING_DATABASE_CHANNELS` 或对应统一错误处理。
- 对项目路径和 project session 一起校验；renderer 使用 `ipc.invokeWithProjectSession`，不得直接获取任意数据库或文件路径。
- store 在异步开始时捕获会话，完成时用 `isProjectSessionCurrent` 检查；A 项目请求晚返回不能写进 B 项目 store。
- 即使同一路径关闭后重新打开，也必须验证会话 generation，而不是只比路径。
- 世界/地图/人物选择状态与缓存按项目隔离；项目关闭与切换正确清理旧状态。
- 主进程校验不认识或已删除的世界、地图、人物、秘境、势力、事件及通道 ID。
- 图片仍经已有受控导入保存到 `.vela/world-maps/<map-id>/`，不删除原图，不把任意原图绝对路径交给 renderer，不绕过文件授权。
- 错误返回真实失败；前端不得只显示成功 toast 而数据库没有写入。

## 9. 实施顺序

1. 阅读现有相关代码和未提交差异，整理新增数据契约、实体关系及已有事实源的兼容方案。
2. 完成幂等 schema、迁移、仓库校验和删除依赖处理。
3. 完成 IPC 类型、注册、会话隔离和 store。
4. 完成世界工作台及模块表单、关联选择和列表。
5. 接入地图、角色资料、故事时间线和跨实体跳转；处理位置一致性及改名/删除。
6. 完成针对性的单元、仓库、store 与真实浏览器回归。
7. 汇报最终实现和验证证据。不得以某一个阶段结束为理由将其称为完整交付。

## 10. 必须验证的验收场景

1. 同一项目创建“凡人界”“修真界”，切换后各世界势力、秘境、规则列表不串数据。
2. 每个世界关联多张地图，同一地点保持唯一地图归属；旧地图未关联世界仍能正常打开。
3. 给“玄霄宗”关联已有宗主和弟子；从人物可反查势力，人物改名后关系仍有效。
4. 创建“古剑秘境”，关联入口、掌控势力和守护者；地图地点可查看关联资料并定位。
5. 主角出生于凡人界青石村，目前位于修真界天门城；角色页、世界页、地图展示一致。
6. 补录青石村早期行踪，不改变目前所在地；勾选更新当前位置时原子保存，模拟失败后全部回滚。
7. 角色页手工修改位置或合法派生状态变化时，旧地图位置不会继续被冒充为当前有效位置；旧文字和来源保留。
8. 创建单向/双向世界通道；双方世界都能看到同一个通道，地图入口可跳转对端，方向正确。
9. 跨世界通道允许，原地图边的跨图连接仍被拒绝。
10. 世界规则的区域/秘境例外可保存、重读；另一世界的地点作为范围时被仓库拒绝。
11. 创建涉及两个世界的“界门之战”，两世界显示同一个事件；在故事时间线编辑后同步更新，支线行为保留。
12. 历史事件可用虚构、模糊纪年和故事开端之前的刻度，不强迫填写章节，不重置作者故事范围。
13. 重启/重开项目后所有新增实体及关联均存在；用数据库读回证明并非只改 store。
14. 在 A 项目启动加载/保存后立刻切换 B 项目或关闭再重开 A，旧请求不能污染新会话。
15. 删除有引用的世界、地点、地图、人物和事件有清晰处理；删除关联不会误删目标实体，不存在可点击的悬空引用。
16. 对旧项目副本连续执行迁移，节点、连线、图片、角色、位置文本、来源和时间线保持完整；不自动生成世界归属或升级候选状态。
17. 编辑世界资料后切换，模拟保存失败，原输入和选中项保留；关闭编辑器的未保存提示符合既有行为。
18. 空项目、没有地图的世界、没有人物的位置、缺失旧引用、深浅主题及英文界面均可正常使用。

测试应覆盖核心数据约束、事务回滚、迁移和实际交互，不写只重复实现细节或只断言文字存在的测试。

## 11. 验证命令与现有回归入口

在仓库根目录使用项目的 pnpm 脚本。执行前确认当前环境，不安装替代测试栈。

```powershell
pnpm run typecheck
pnpm run prepare:native-node
pnpm exec vitest run electron/repositories/__tests__/world-map-repository.test.ts electron/repositories/__tests__/world-map-atlas-repository.test.ts electron/repositories/__tests__/character-repository.test.ts electron/repositories/__tests__/character-relationship-repository.test.ts electron/repositories/__tests__/character-roster-repository.test.ts electron/repositories/__tests__/story-timeline-repository.test.ts electron/services/__tests__/world-map-atlas-migration.test.ts src/services/__tests__/ipc-client-project-session.test.ts
pnpm exec vitest run --config vitest.browser.config.ts src/components/map/__tests__/world-map-atlas.browser.tsx src/components/timeline/__tests__/StoryTimelineView.browser.tsx src/components/editor/__tests__/CharacterEditor.profile-edit.browser.tsx src/components/panels/__tests__/plot-tree-rail-navigation.browser.tsx src/components/panels/__tests__/ProjectReferencePanel.browser.tsx
```

还需单独运行本次新增世界仓库、迁移、store、位置一致性和浏览器测试，交付时给出实际文件名与完整命令。修改到角色提交或派生后处理时，增加对应来源与版本一致性测试。

普通测试配置在 `vite.config.ts`，浏览器配置在 `vitest.browser.config.ts`。已有浏览器配置支持 `AI_NOVEL_VITEST_CHROMIUM` 与 `AI_NOVEL_VITEST_BROWSER_API_PORT`，仅在环境确有需要时使用，不猜测可执行文件路径。

测试中使用临时目录/临时项目。若环境阻止浏览器、SQLite 原生模块或其他检查，报告具体命令和错误；只能称为对应检查未完成，不能用静态截图、模拟成功返回或旧测试结果代替验收。

若开始时存在既有失败，记录基线并区分本次引入失败，不为消除全部旧问题进行无关重构。验证改变范围即可，不默认启动发布门禁或打包。

## 12. 最终交付报告

请报告：

1. 最终功能入口及用户操作路径。
2. 修改/新增文件与关键函数、类型、IPC 通道。
3. 数据事实源、人物 ID 复用、世界与地图归属、历史事件复用、位置一致性的实现方式。
4. 旧项目迁移、删除依赖和事务回滚策略。
5. 实际运行的命令、通过/失败结果与数据库读回证据。
6. 真实浏览器验证的路径和截图/测试结果。
7. 默认设计选择及仍未实现的部分；若有欠项，明确写出，不能宣称全部完成。

不要只回复“功能已完成”。以实际代码、数据库和本次运行的验证结果为准。
