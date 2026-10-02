# 任务 C：「修炼等级设置」菜单图标 — 实施与验收报告

日期：2026-10-02。**性质：任务级实施与验证记录。**

目标（任务书原文）：

1. 在菜单文字前添加现有图标库中的等级或层级图标，保持相邻菜单的大小、颜色、间距和对齐。
2. 单独验收：默认、悬停、选中状态显示正常；图标与同层级菜单对齐；点击行为正常；未设置修炼等级时的设置引导保留。
3. 交付证据：修改差异及菜单截图。不需要额外编写仅验证图标存在的测试。

## 首页结论

- **图标已实施并验证通过。**「修炼等级设置」菜单文字前现在显示 lucide `BarChart3`（递增柱状，语义为「等级顺序」），注册名 `bar-chart-3`，与同组菜单图标同尺寸（14px）、同颜色（`--color-text-muted`）、同间距与对齐。
- **根因说明：该菜单此前实际没有可见图标。** 原 `iconName="settings"` 在 `sidebar-icons.ts` 的 `ICON_MAP` 中从未注册，`renderIcon` 对未注册名返回等宽空白占位（`sidebar-icons.ts` 注释「未找到时返回空占位」），因此图标位置一直是空的。本次按任务书换成等级图标并完成注册，图标真正可见。
- **四项单项验收全部通过**（逐项证据见第 2 节）。
- **未新增任何测试**（符合任务书）；截图经一次性临时夹具采集后删除，仓库无残留。
- **验证中发现 1 个与本任务无关的 typecheck 错误**，来自并发代理新增的未跟踪文件 `electron/controllers/__tests__/character-save-repro.integration.test.ts`（TS6133 未使用变量）；排除该文件后全仓 typecheck 通过（`verification-typecheck.txt`）。

## 1. 修改差异

本任务仅改 2 个文件、共 3 行：

**`src/components/panels/sidebar/sidebar-icons.ts`** — 注册图标（完整 diff）：

```diff
@@ import（lucide-react） @@
-  Compass, LayoutDashboard, Clock3, Bookmark, Globe2,
+  Compass, LayoutDashboard, Clock3, Bookmark, Globe2, BarChart3,
@@ ICON_MAP @@
   'rotate-ccw': RotateCcw,
+  'bar-chart-3': BarChart3,
 }
```

**`src/components/panels/sidebar/ProjectTree.tsx`** — 菜单项换用该图标（单行单属性，行号 386；该文件同时含并发任务 B 的分组重排，与本任务无关，本任务 diff 仅 `iconName` 一个词）：

```diff
-          <LeafItem iconName="settings" label={text('修炼等级设置', 'Cultivation settings')} …
+          <LeafItem iconName="bar-chart-3" label={text('修炼等级设置', 'Cultivation settings')} …
```

选型说明：`Layers`（层级）已被「创作规划」分组标题占用（`ProjectTree.tsx` `icon={Layers}`），复用会造成同屏歧义；`BarChart3` 的递增柱状在菜单语境中读作「等级/层级递进」，与菜单描述「项目境界体系、等级顺序与角色绑定」一致，且项目树中无重复。注册名沿用 `ICON_MAP` 现有 kebab-case 惯例（`git-branch`、`clock-3`、`globe-2` 同款）。

未改动：`LeafItem` 组件、`renderIcon` 尺寸/占位逻辑、其他任何菜单、设置页、store、IPC。

## 2. 单项验收结果

### 2.1 默认、悬停、选中状态显示正常 — PASS

截图（Chromium 真实渲染，`userEvent.hover` / `userEvent.tab` 驱动真实指针与键盘状态）：

- 默认：`task-c-01-menu-default.png`（特写 `task-c-01b-menu-closeup.png`）
- 悬停：`task-c-02-menu-hover.png` — 行背景按 `.tree-item:hover` 变化，图标不变形、不变色、不位移
- 选中：`task-c-03-menu-keyboard-focus.png` — 键盘聚焦环（`focus-visible` accent 环）正常

状态口径说明：`LeafItem`（`SidebarShared.tsx`）本身没有持久「选中」样式，`.tree-item.active` 类在项目树叶子菜单上从不使用——这一点对本组全部菜单一致，非本任务引入。叶子菜单的「选中」表现为键盘聚焦环；聚焦/悬停/默认三态下图标均保持 `--color-text-muted`、14px、位置稳定。

### 2.2 图标与同层级菜单对齐 — PASS

`task-c-01b-menu-closeup.png` 特写可见：故事设定组内「创作参数」（book-open）、「修炼等级设置」（bar-chart-3）、「角色档案」（users）三个菜单的图标同尺寸、同左缩进（LeafItem 的 `paddingLeft:10` + 12px 占位列 + 图标 14px）、同颜色，文字起点垂直对齐一致。

### 2.3 点击行为正常 — PASS

- 视觉证据：`task-c-04-settings-opened-guide.png` — 点击菜单后右侧按 `EditorArea` 对 `cultivation` 标签的同款条件渲染打开「修炼等级设置」页（`openFile` 逻辑未动）。
- 回归证据：NAV-TREE 浏览器导航审计（项目树叶子条目点击挂载 + 键盘 Enter/Space 激活）2/2 PASS（`verification-browser-nav-tree.txt`），换图标后项目树交互无回归。

### 2.4 未设置修炼等级时的设置引导保留 — PASS

`task-c-04-settings-opened-guide.png` 中设置页清晰显示引导文案「尚未设置修炼体系。新增大境界，开始创建自己的体系。」（`CultivationSettingsPage.tsx` 的空体系分支，本任务未触碰该文件）。

## 3. 交付证据清单

`test/acceptance/evidence/task-c-cultivation-menu-icon/`：

| 文件 | 内容 |
| --- | --- |
| `task-c-01-menu-default.png` | 侧边栏默认状态（1124×720 全视口） |
| `task-c-01b-menu-closeup.png` | 故事设定组菜单特写（对齐对比） |
| `task-c-02-menu-hover.png` | 悬停状态 |
| `task-c-03-menu-keyboard-focus.png` | 键盘聚焦（选中）状态 |
| `task-c-04-settings-opened-guide.png` | 点击后打开设置页 + 未设置引导 |
| `verification-typecheck.txt` | typecheck 日志（含并发文件无关性证明） |
| `verification-eslint-two-files.txt` | 两个修改文件的 eslint（--max-warnings 0）通过 |
| `verification-browser-nav-tree.txt` | NAV-TREE 导航审计回归日志 |

## 4. 截图采集方法（可复现说明）

按仓库既有 planning-visual 模式：vitest 浏览器模式（Playwright Chromium 1280×820）挂载真实 `ProjectTree`（280px 侧栏）+ 真实 `CultivationSettingsPage`，IPC 走 planning 视觉夹具统一桩并补 `db:cultivation-read → {revision:0, realms:[]}`（未设置体系态）。截图夹具为一次性文件（临时 `vitest.tmp-cultivation-icon.config.ts` + `output/cultivation-icon-harness/`），证据采集完成后已删除，未纳入仓库——符合任务书「不需要额外编写仅验证图标存在的测试」。

## 5. 与并发任务的边界

验收窗口内同一工作树存在任务 B（侧边栏分组顺序与改名）的并发改动，触及 `ProjectTree.tsx` 等文件。本报告第 1 节已将本任务差异限定为两处图标改动；分组顺序、分组命名与截图中的菜单排布属任务 B 范围，以其报告为准。
