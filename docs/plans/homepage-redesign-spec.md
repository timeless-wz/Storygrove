# 书斋首页重构设计规格

状态：提案，尚未开始实施
范围：`WelcomePage`（书斋首页）的区块结构、层级、交互与主题适配规则。不改动数据库、IPC、领域服务、项目会话边界与任何创作数据的写入语义。
上游依据：
- [`navigation-information-architecture.md`](../navigation-information-architecture.md)（功能归属与命名）
- [`inkspire-inspired-frontend-rebuild.md`](inkspire-inspired-frontend-rebuild.md) 阶段 2“书架首页和项目入口”（本文件是其细化，不取代它）

本文件只描述渲染层。第 11 节是唯一涉及持久化的部分，已明确标记为需要先建数据层。

---

## 1. 设计判读与档位

这不是营销页，是本地优先写作工具的工作台首页，观众就是作者本人。因此套用组件化的产品界面规则，不套用营销页规则。

| 档位 | 取值 | 理由 |
| --- | --- | --- |
| `DESIGN_VARIANCE` | 5 | 现状约 4。首屏改为非对称双引擎分栏，书架引入一条宽卡节奏。不做艺术化排版：作者每天要看这个页面 |
| `MOTION_INTENSITY` | 4 | 现状约 3。只有 CSS 过渡，`transform` / `opacity` 两个属性。无滚动劫持、无无限循环动画 |
| `VISUAL_DENSITY` | 4 | 现状约 3。补齐真实数据后信息量上升，但仍保留大量留白 |

Redesign 模式：**Preserve**。14 套文学皮肤、`--color-*` 语义令牌体系、霞鹜文楷 / Noto Serif SC 字体栈全部原样保留。

---

## 2. 不可逾越的数据边界（硬约束）

以下结论来自对 56 张表、`draft-store` 装载时机与现有测试的核查。任何设计不得假设这些数据存在。

### 2.1 首页拿不到任何字数

`draftsByChapter` 由 `loadAllDrafts(projectPath, projectSession)` 装载，未打开项目时该 store 被重置为空对象（`src/stores/draft-store.ts:104-116`）。因此**首页上“已写正文字数”也算不出来**。

首页可用的全局真实数据只有 `~/.vela/recent-projects.json` 的 `{ name, path, updatedAt }`。

结论：项目级统计只能出现在项目已打开时。首页的统计区块要么省略，要么只展示全局级事实。

### 2.2 按日写作数据不存在

- 没有任何按日统计表。`drafts.word_count` 被 `UPDATE drafts SET word_count = ?` 原地覆盖（`electron/repositories/draft-repository.ts:496`），历史增量不留痕。
- 不存在 `stats` / `daily` / `activity` / `writing_log` / `session` / `goal` / `streak` 表。
- 无法从 `drafts.created_at` 回填：草稿的每个新版本是新行，按日求和会把 v1 与 v2 的字数重复累加。用这种方法“补”出来的热力图是伪造的。

结论：**「今日落墨」「心流时长」「九十日墨痕热力图」在建立新数据层之前无法交付**。第 11 节给出数据合同，但它是独立任务。

### 2.3 既有的架构立场

`src/components/workspace/__tests__/WorkspaceHub.navigation.browser.tsx` 断言工作台摘要中不得出现 `写作时长` 与 `今日字数`，注释写明理由是“不以这类无法从资料计算的数据充当摘要”。

该断言作用域是 Workspace Hub，不是首页，所以在首页加这些指标不会让它失败。但它记录了本项目的一条原则。若第 11 节落地前就在首页展示这两个指标，需要在评审中明确说明原则为何被推翻，并给出数据来源。本规格的立场是：先建数据，再上指标。

### 2.4 字数单位

项目用 `countDraftUnits()`（`src/shared/draft-units.ts`，算法版本 3）计数：汉字码点加 Unicode 单词，忽略标点、空白与 emoji。标签必须与 `ProjectOverviewPage` 的「已写正文字数」口径一致，热力图图例不得声称是原始文本长度。

---

## 3. 目标结构：四个乐章

```
① 页头          品牌与书斋定位；唯一的 eyebrow；右侧仅保留「打开项目」
② 双引擎首屏    左：继续创作（层级最高）  右：名作解构与仿写工坊（升维为一级入口）
③ 书架          「新书立项」移出网格成为独立入口；真实项目卡；宽卡补节奏
④ 近期足迹      由 recentProjects.updatedAt 推导的真实时间回声
⑤ 页脚          品牌与本地存储声明
```

区块数 4（页头/首屏/书架/足迹），eyebrow 上限 `ceil(4/3) = 2`。**本规格只用 1 条**（页头品牌），hero 与书架区块的 eyebrow 全部删除。

---

## 4. 逐区块规格

### 4.1 ① 页头

保留 `.literary-home-heading`。改动：

- 左侧：保留 `.literary-eyebrow`（品牌名 + 羽毛图标）与「书斋 · 让灵感落于纸上」。这是全页唯一 eyebrow。
- 右侧：**只保留「打开项目」**（`variant="outline" size="sm"`）。
- **删除「拆解仿写」按钮**：该意图升维为 ② 的解构工坊卡片，页头不再重复。

### 4.2 ② 双引擎首屏

把 `.literary-hero` 从「文案 + 右浮动书册」改为**非对称双引擎分栏**。当前 `justify-content: space-between` 配 220px 固定画稿，导致中段大面积空置，这是要修的主要构图问题。

```
┌─────────────────────────────────────────────┬──────────────────────┐
│ 继续创作 · 58%                               │ 名作解构与仿写工坊 · 42% │
│                                              │                      │
│ 未竟之书                    ← 项目名，衬线    │ 深度拆书 · 仿写研习    │
│ 保存于 D:\...               ← 真实路径        │ 导入对标作品，逆推世界观 │
│                               黄金三章与节奏  │                      │
│ [ 继续创作 → ]  新书立项（文字链）            │ [ 导入作品开始拆解 ]   │
│                                              │  ⇣ 拖入 .txt / .epub  │
└─────────────────────────────────────────────┴──────────────────────┘
```

**左区（继续创作）**：沿用 `.literary-hero-copy` 与 `.literary-hero-primary-btn`，不新增组件。删除其 eyebrow。主按钮文案随状态变化（见 4.2.1）。次要动作降级为 12px 文字链，不再与主按钮争夺视觉权重。

**右区（解构工坊）**：新组件 `.literary-deconstruct-card`。

- 它是一张**独立卡片**，背景用 `var(--color-panel)`，文字用 `var(--color-text)`，**不得继承 hero 的 `--literary-hero-ink`**。原因：hero 依赖各主题的 `--sample-ink` 覆写，而卡片需要在其上再叠一层自身底色，跨 14 套主题时用 hero ink 会出现对比度不可控。用标准面板令牌是最稳的。
- 与左侧的边界用 `1px solid var(--color-border)` 分隔，不用阴影（阴影留给 hover）。
- 视觉图腾：水墨卷轴质感用 `color-mix(in srgb, var(--color-accent) 8%, transparent)` 做底纹，不引入外部图片资源。
- 主 CTA 复用 `.literary-hero-primary-btn`，文案「导入作品开始拆解」，**与页头删除的按钮是同一意图，故全页仅此一处**。
- 拖放区：整卡为投放目标（见 4.2.2）。

#### 4.2.1 左区四种状态

| 状态 | 判定 | 标题 | 副文案 | 主按钮 |
| --- | --- | --- | --- | --- |
| 项目已打开且有可续写草稿 | `currentProject` 且存在非 archived/finalized 草稿 | 项目名 | 项目已就绪，可返回章节草稿 | 继续创作 |
| 项目已打开但无草稿 | `currentProject` | 项目名 | 项目已就绪 | 前往项目创作 |
| 无当前项目但有最近记录 | `recentProjects[0]` | 项目名 | 保存于 {path} | 翻开最近作品 |
| 全新安装 | 无 | 每个故事，都从一页空白开始 | 构筑一个世界，遇见笔下的人 | 新书立项 |

判定逻辑直接复用现有 `isCurrentProjectActive` 与 `hasResumableDraft`，不新增推导。

#### 4.2.2 拖放规格

现状：代码库中**没有任何文件拖放处理**（`webUtils`、`onDrop`、`dataTransfer.files` 均无出现）。这属于新增能力，不是换皮，因此单列。

- Electron 41 支持 `webUtils.getPathForFile(file)`。Electron 32 起 `File.path` 已被移除，**必须用 `webUtils`**，且只能在渲染进程通过 `preload` 暴露的桥接调用。
- 前置依赖：`ImportNovelDialog` 需要新增一个可选入参（如 `presetPaths`），以便拖入后直接进入既有的解析与确认流程。当前 dialog 只有 `{ open, onClose }`。
- 接受扩展名：`.txt` / `.epub`。其余类型在投放时给出内联提示，不静默忽略。
- 投放态：卡片边框换 `var(--color-accent)`，底色提亮至 `var(--color-hover)`。这是唯一为拖放新增的视觉状态。
- 拖放导入必须走 `ImportNovelDialog` 现有的用途选择与确认边界，**不得绕过 `import_runs` 的登录与阶段流转**。

若本轮不做拖放，卡片只保留 CTA，并按 4.2.3 提供禁用态。

#### 4.2.3 解构工坊的边界状态

- `onImportNovel` 未传入时（`WelcomePage` 已是可选 prop）：整卡不渲染，左区占满宽度。不要把一张不可用的卡片留在页面上。
- 已收纳对标作品数：数据在 `import_runs`（`purpose='reference'` 且 `stage='completed'`，含 `source_display_json`、`manifest_word_count`、`manifest_chapter_count`、`created_at`），但**当前没有可用的列表 IPC**（只有 `db:import-run-list-resumable`）。因此在新增只读 IPC 之前，卡片**不显示任何计数**。不要用一个占位数字充数。

### 4.3 ③ 书架

#### 4.3.1 修掉孤卡

现状 `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`，1240px 下排 3 列。而网格里当前有 4 个格子（「新书立项」+ 3 个项目），第 4 个必然独占一行。这是截图里大片留白的直接成因。

两项改动：

1. **「新书立项」移出网格**，改为区块标题右侧的按钮。网格只放真实项目。这样 3 本书正好一行。同时消除了「新书立项」在全页出现两次的重复意图（当前 hero 与书架各一处）。
2. **宽卡补节奏**：当项目数 `% 3 === 1` 且大于 3 时，最后一张卡改用宽卡变体 `.literary-project-card--wide`，横向占满一行（书脊缩略图在左，信息在右）。这样避免 4 本书出现「3 + 1 孤卡」，也让书架多一种节奏，不是同一种卡片重复 N 次。

#### 4.3.2 区块标题

- 删除 `.literary-eyebrow`「本地作品陈列」（`我的书架` 已经说清，属冗余）。
- 右侧原本是只读的「N 部最近作品」文本，改为「N 部作品」+ 「新书立项」按钮。

#### 4.3.3 卡片拟物保留项

保留现有 `.literary-book-cover` 的书脊压纹（`inset 3px 0 0`）、圆角 `2px 7px 7px 2px`、衬线书名。图标全部沿用 lucide，当前首页无 emoji，**不需要“移除 emoji”**。

hover 沿用 `translateY(-2px)` + `var(--shadow-md)`。阴影必须是主题令牌，不得新增黑色硬编码投影。

空书架状态 `.literary-empty-shelf` 保留，圆角从 14px 归一到 12px（见 5.2）。

### 4.4 ④ 近期足迹（替换检索提示条）

**删除 `.literary-tip-card`**。它承载的是操作说明（“点侧栏搜索图标去检索资料”），不是数据展示，美化它没有意义，它占的是本该放真实回声的位置。

替换为 `.literary-footprint-strip`，数据源仅为 `recentProjects[].updatedAt`（真实存在）：

```
近期足迹     未竟之书 · 今天      ce · 3 天前      未竟之书 · 上周
```

- 显示最近 3 条，按 `updatedAt` 倒序。
- 时间用相对表述（今天 / 昨天 / N 天前 / 上周），由 `updatedAt` 与当前时间计算。
- 每条点击直接 `openProject(path)`，复用书架卡片的行为。
- **不显示字数、不显示增量、不显示“完善了第 N 章”**。`recentProjects` 没有章节级信息，写了就是编的。
- 若 `recentProjects` 为空则整个区块不渲染（空书架状态已经承担了引导职责）。

### 4.5 ⑤ 页脚

保留 `.literary-home-footer`，文案不变。`padding-top` 从 36px 收到 24px，因为 ④ 已经把页面节奏收紧了。

---

## 5. 跨区块规则

### 5.1 颜色

- 全部经 `var(--color-*)` 语义令牌与 `color-mix()`，沿用 `literary-workbench.css` 既有做法。当前实现**已经做到了**，这是必须保持的既有成果，不是待办项。
- 不接受任何新增硬编码色值，包括 hero 内的子卡片。
- 单页单一强调色，即 `var(--color-accent)`。解构工坊卡片、宽卡高亮、投放态都用它，不引入第二个强调色。

### 5.2 圆角（统一并写下规则）

现状混用 16 / 14 / 12 / 10 / 8px。归一到一条可复述的规则：

| 用途 | 圆角 |
| --- | --- |
| 首屏大区容器 | 16px |
| 卡片、面板、区块容器 | 12px |
| 按钮、输入控件 | 8px |
| 徽标、状态药丸 | full |

据此：`.literary-tip-card` 与 `.literary-empty-shelf` 的 14px / 10px 归到 12px。

### 5.3 图标

沿用 lucide-react。项目已全面依赖该库（`WelcomePage`、`HomeSidebarPanel`、`ProjectOverviewPage` 均为 lucide），**不引入第二个图标家族**，避免同一棵树里混用两套描边风格。`strokeWidth` 统一：区块内图标 1.5，按钮内图标随按钮尺寸。

### 5.4 CTA 意图唯一

| 意图 | 唯一归属 | 删除 |
| --- | --- | --- |
| 继续创作 / 翻开作品 | 首屏左区主按钮 | - |
| 新书立项 | 书架区块标题右侧 | 首屏幽灵按钮里的那一处 |
| 打开已有项目 | 页头右侧 | 首屏 actions 里的那一处 |
| 导入作品开始拆解 | 首屏右区解构工坊卡片 | 页头「拆解仿写」按钮 |

侧栏的「新建项目 / 打开项目」属于常驻导航面板，是另一个界面层级，不计入本页去重，保持现状。

### 5.5 无障碍

- 主按钮对比度：`--color-accent` 上的文字用 `--accent-foreground`，沿用现状。hero 内子卡片不复用 hero ink（见 4.2 右区说明）即为避免跨主题对比度失控。
- 书架卡片与足迹条都是 `<button>`，保留可见键盘焦点。`.literary-home button:focus-visible` 已有规则，新组件必须继承而不是覆盖。
- 解构工坊卡片的投放目标需要键盘等价路径：纯键盘用户必须能通过卡内 CTA 完成同一件事。拖放是增强，不是唯一入口。
- 装饰元素（书册画稿、卷轴底纹）保持 `aria-hidden`。

### 5.6 响应式

首页容器已有 `container-type: inline-size`，优先用容器查询而非视口查询。

- 首屏双引擎：`< 900px` 折叠为单列，解构工坊卡片置于继续创作之下。
- 书架：`< 768px` 单列，宽卡变体自动退回标准竖卡。
- 足迹条：`< 768px` 改为纵向列表。
- 首页不使用 `h-screen`。外层已是 `h-full overflow-y-auto`，保持。

### 5.7 动效

`MOTION_INTENSITY: 4`，只保留现有那套：`.2s` 过渡、hover 上移 2px、书册 `rotate(4deg) → rotate(1deg)`。新增的解构工坊卡片沿用同一过渡曲线，**不加披露动画、不加无限循环**。全部动效置于 `@media (prefers-reduced-motion: no-preference)` 之下，减少动态时退化为静态。

---

## 6. 状态清单

每个新组件必须实现：

| 组件 | 空 | 加载 | 错误 | 不可用 |
| --- | --- | --- | --- | --- |
| 首屏左区 | 全新安装文案（4.2.1） | 无需（数据同步可得） | 项目路径失效时按钮禁用并提示 | - |
| 解构工坊 | 不显示计数 | 不显示骨架，直接无计数 | 导入失败由既有 dialog 承担 | 无 `onImportNovel` 时整卡不渲染 |
| 书架 | `.literary-empty-shelf` 现成 | 沿用现有刷新态 | 沿用现有 | - |
| 足迹 | 整块不渲染 | 无 | 无 | - |

---

## 7. 文案表

新增或改写的字符串，中英同步，全部写入 `src/i18n/messages/`。文案不得使用 em dash，不得出现无数据支撑的数字。

| 位置 | 中文 | 英文 |
| --- | --- | --- |
| 解构工坊标题 | 深度拆书 · 仿写研习 | Deconstruct · Imitate |
| 解构工坊副标 | 导入对标作品，逆推世界观、黄金三章与节奏节拍 | Import a benchmark novel and reverse-engineer its world, opening hooks, and pacing |
| 解构工坊 CTA | 导入作品开始拆解 | Import a novel to analyze |
| 解构工坊拖放提示 | 拖入 .txt 或 .epub 直接开始 | Drop a .txt or .epub to begin |
| 书架区块标题右侧 | 新书立项 | New project |
| 书架计数 | N 部作品 | N projects |
| 足迹标题 | 近期足迹 | Recent |

删除的字符串：`本地作品陈列`、`项目资料检索：`、`打开项目后，点击侧栏顶部的搜索图标…`、页头 `拆解仿写`。

---

## 8. 从现状迁移

| 文件 / 选择器 | 动作 |
| --- | --- |
| `.literary-tip-card` 及其 JSX | 删除 |
| 页头「拆解仿写」按钮 | 删除，意图移入解构工坊 |
| 首屏 `新书立项` 幽灵按钮 | 删除，意图移入书架标题 |
| 首屏 actions 的「打开项目」 | 删除，保留页头那处 |
| `.literary-eyebrow`（hero 内、书架内） | 删除，全页保留页头 1 条 |
| `.literary-new-book-slot` | 移出网格，改为标题右侧按钮（样式可复用，位置变） |
| `.literary-bookshelf` 网格 | 保留 `auto-fill`，配合 4.3.1 的宽卡规则 |
| `.literary-hero` | 改为双引擎分栏，`justify-content: space-between` 单列布局废除此用法 |
| `.literary-project-card` / `.literary-book-cover` | 保留，新增 `--wide` 变体 |
| 全部颜色令牌与 14 套主题 | 不动 |

新增 CSS 选择器：`.literary-hero-engines`、`.literary-deconstruct-card`、`.literary-project-card--wide`、`.literary-footprint-strip`。

---

## 9. 分期与验收

### 阶段 1：结构整肃（无新增依赖）

范围：4.1、4.3、4.4、5.4、5.2、7 中的文案收敛。

验收：
- 首屏与书架不再出现重复意图的按钮（按 5.4 表格逐条核对）。
- 全页 eyebrow 计数为 1。
- 3 个最近项目时书架正好一行，无孤卡。
- 首页不含任何字数、时长、增量数字。
- 现有浏览器测试全绿；`.literary-tip-card` 相关断言同步更新。

### 阶段 2：解构工坊升维

范围：4.2，不含拖放。

验收：
- 解构工坊占据首屏右侧，与继续创作形成双引擎。
- 点击 CTA 打开既有 `ImportNovelDialog`，用途选择与确认边界与页头入口完全一致。
- 14 套主题下卡片文字对比度均达 WCAG AA（`--color-text` on `--color-panel`）。
- 窄于 900px 折叠为单列。

### 阶段 3：拖放（可选，独立评估）

范围：4.2.2。

前置：`ImportNovelDialog` 支持 `presetPaths`；preload 暴露 `webUtils.getPathForFile`。

验收：拖入 `.txt` / `.epub` 进入既有导入流程；非支持类型给出内联提示；纯键盘用户仍可通过 CTA 完成同一流程。

### 阶段 4：对标作品计数（可选）

范围：4.2.3 的计数。

前置：新增只读 IPC，查询 `import_runs`（`purpose='reference'`、`stage='completed'`），返回源名、字数、章节数、完成时间。数据已存在，缺的只是查询与通道。

验收：计数来自真实已完成参考导入；无记录时显示 0 而非占位数字；不新增写路径。

### 阶段 5：写作热力图（需先建数据层，见第 11 节）

不属于本页重构的交付范围，单独排期。

---

## 10. 明确不做

- 不引入 Emoji（现无，保持无）。
- 不改 14 套主题的任何色值，不改 `--sample-ink` 体系。
- 不引入第二套图标库。
- 不引入 GSAP、Three.js、marquee、滚动劫持、视差、自定义光标。
- 不做营销页式 hero（大标语、信任条、logo 墙、滚动提示、装饰性状态点）。
- 不动 `layout-store` 的 `SidebarView` 取值与侧栏面板结构。
- 不改 `ProjectOverviewPage` 已有的 6 项真实指标。
- 不为首页新建“总览数据”store 去规避 2.1 的装载时机问题。那等于绕开项目会话边界，属于架构改动，需要单独立项。

---

## 11. 附：写作热力图的数据合同（独立任务）

只有当本节落地后，才可以在界面上出现「今日落墨」与「九十日墨痕」。这一步改 Electron 主进程表结构，必须独立评审。

### 11.1 表结构

沿用 `electron/database.ts` 既有的幂等建表方式（56 张表同款 `CREATE TABLE IF NOT EXISTS`）：

```sql
CREATE TABLE IF NOT EXISTS writing_daily_totals (
  project_id  TEXT    NOT NULL,
  local_date  TEXT    NOT NULL,          -- YYYY-MM-DD，作者本地日期
  net_words   INTEGER NOT NULL DEFAULT 0,-- 有符号净增，删改会减少
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, local_date)
);
```

### 11.2 写入点

`electron/repositories/draft-repository.ts` 中执行 `UPDATE drafts SET word_count = ?` 之前，先读取旧值，算出 `delta = new - old`，在同一事务内累加当天 `net_words`。写入点只有保存草稿这一处，不得在渲染层另开写路径。

### 11.3 必须记录在案的局限

1. **只覆盖 App 内可观测的增量。** 在外部编辑器改稿、重新导入、删除项目都会造成断层。跨项目汇总需要另建全局索引，首页（未打开项目）当前只有 `recent-projects.json`。
2. **净增是有符号的。** 修订导致字数下降时当天合计会减少。界面不得静默截断为 0，否则会与各章 `word_count` 之和互相矛盾。
3. **不回填。** 新装用户就是「初辟书斋，静待君落墨」。不得用 `drafts.created_at` 求和伪造历史（会把草稿版本重复计数）。
4. **单位口径**：见 2.4，`countDraftUnits()` 算法版本 3。
5. **测试同步**：若在工作台或首页引入这两个指标，需一并处理 2.3 记录的断言与原则说明。

### 11.4 界面侧（待数据就位后）

- 热力图色阶由 `color-mix(in srgb, var(--color-accent) N%, transparent)` 逐级取，天然跟随 14 套皮肤，不新增色板。
- 四个指标建议为：已写正文字数、已起草章节、已起草占比、规划细纲。这四项在 `ProjectOverviewPage.tsx:96-121` 已有成熟实现，直接复用推导，不重新发明。
- **建议砍掉「心流时长」。** 它需要额外的焦点与空闲会话追踪，且度量的是“窗口开着”而不是“在写”，是四个指标里最不诚实的一个。
- 承载位置优先放 `ProjectOverviewPage`（数据已就绪，零新增持久化），首页仅做入口。这与上游 rebuild 计划把 `ProjectOverviewPage` 定位为“项目仪表盘/创作主页”一致。

---

## 12. 与既有文档的关系

- 不修改 [`navigation-information-architecture.md`](../navigation-information-architecture.md) 的功能归属表，但本规格把「导入小说」在首页新增了一个一级入口。该文档将导入归入顶部栏的低频操作，属于**有意偏离**，需要评审确认后在 IA 文档中补记，否则文档与实现会不一致。
- 本规格是 [`inkspire-inspired-frontend-rebuild.md`](inkspire-inspired-frontend-rebuild.md) 阶段 2 的细化。若两者冲突，以本文件为准，并回写上游计划。
