# 剧情画布（Plot Canvas Graph）兼容性与集成说明文档

本目录为 AI Novel Writer 剧情画布提供解耦的图层视觉与交互交付件。为确保主分支与其它子系统在集成时不产生回归或数据破坏，特此制定以下契约与兼容性保证：

---

## 1. 现有事件卡（PlotEventCardNode）平滑升级保证

- **向后兼容机制**：
  `PlotGraphNodeData` 完整继承并保留了原有 `PlotEventCardNodeData` 的所有字段签名：
  - `title: string`
  - `summary: string`
  - `colorKey: PlotCanvasColorKey`
  - `chapterRefs: number[]`
  - `hasPlan: boolean`
  - `subCanvasTitle: string | null`
  - `dimmed: boolean`
  - `searchHit: boolean`
  - `onSplit?: (id: string) => void`
  - `onDelete?: (id: string) => void`
  - `onEnterSubCanvas?: (id: string) => void`
- **默认 Kind 兜底**：
  若输入数据未包含 `kind` 字段，一律兜底解析为 `'plot'`（剧情类别）。现有的剧情事件卡片视觉不会发生任何降级或错位。
- **无数据不编造**：
  卡片若未提供 `summary`，不会显示任何虚构文本或空白占位符；若无 `tags` 或关联章节，相应标签区完全隐藏。

---

## 2. 边（Edge）与连接关系无损保留规则

- **纯视图过滤（Non-destructive View Transformation）**：
  `resolvePlotGraphEdgeVisibility` 是纯函数，仅根据当前节点的显隐状态在内存中计算连线的 `hidden` 与 `dimmed` 状态，**绝不调用删除 API，绝不修改底层的 `edges` 持久化数组**。
- **端点显隐铁律（No Dangling Edges）**：
  - **规则**：当且仅当连线的两端节点（`source` 与 `target`）在当前筛选视图中均处于可见状态时，该连线才会被渲染；
  - **效果**：一旦任一端节点被 10 种类别筛选过滤隐藏，连线自动随之隐藏（`hidden: true`），画布上绝不会出现指向空气的悬空折线；一旦取消过滤，连线立刻无损恢复。

---

## 3. 确定性对照层幽灵节点（PlotProjectionGhostNode）安全隔离

- **只读快照原则**：
  快照（`PlotTreeSnapshot`）从章节蓝图和定稿中确定性投影生成，用于作者对照参考。
- **防反写机制**：
  - 幽灵节点拥有独立类型 `type: 'plot-projection-ghost'`，只允许选择与查阅，不提供连线桩（Handle），不支持拖拽保存；
  - 集成者在遍历画布节点向 IPC（`db:plot-canvas-node-upsert`）同步持久化数据时，必须保持前置断言过滤：
    ```ts
    const nodesToPersist = currentNodes.filter(n => n.type === 'plot-graph-card' || n.type === 'plot-event-card')
    ```
  - 绝不会把幽灵节点写回数据库的剧情画布节点表。

---

## 4. 10 种 Kind 的实体链接与扩展映射

本组件支持的 10 种类别可通过过渡 View Model 与项目现有的实体模型安全映射：
| Kind | 含义 | 对应本地或规划实体 | 推荐实体链接（entityRef.type） |
| :--- | :--- | :--- | :--- |
| `plot` | 剧情事件 | `PlotCanvasNodeData` | - |
| `idea` | 灵感脑洞 | `vela://inspiration/*` | `'idea'` |
| `foreshadow` | 伏笔暗线 | `db:foreshadowing-*` | `'foreshadow'` |
| `character` | 角色出场 | `db:character-*` | `'character'` |
| `location` | 地点环境 | 世界观地点设定词条 | `'location'` |
| `item` | 道具宝物 | 世界观物品设定词条 | `'item'` |
| `faction` | 势力组织 | 世界观势力设定词条 | `'faction'` |
| `skill` | 功法秘技 | 世界观功法设定词条 | `'skill'` |
| `chapter` | 章节归属 | 蓝图与定稿章节号 | `'chapter'` |
| `note` | 便签批注 | 作者自由备忘 | `'note'` |

---

## 5. 集成步骤（Integrator Wiring Guide）

在后续主工作台接线时，仅需两步：
1. **注册 Node Types**：
   ```tsx
   import { PlotGraphCardNode } from './plot-graph'

   const nodeTypes = {
     'plot-graph-card': PlotGraphCardNode,
     'plot-event-card': PlotGraphCardNode, // 兼容替换旧节点
     'plot-projection-ghost': PlotProjectionGhostNodeViewMemo,
   }
   ```
2. **挂载筛选器与详情抽屉**：
   将 `PlotGraphFilter` 置于画布右上角控制区，将 `PlotGraphToolbar` 置于左侧浮动条，将 `PlotNodeDetailPanel` 挂在右侧抽屉，所有动作均由组件的 Props 回调触发本地 IPC。
