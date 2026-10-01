# L0 登记扫描结果

生成时间：2026-10-01T01:42:42.448Z
基线：静态扫描当前工作树（scanner: test/acceptance/inventory/scan-inventory.mjs）

## IPC 面

- 声明的 invoke 通道：**356**；事件通道：**6**
- 实际注册处理器（唯一通道）：**356**（原始注册调用 356 次）

### 交叉核对

- 声明但无处理器：无
- 处理器但无声明（仅字面量）：无
- 结论：PASS: 声明与处理器一一对应

### 处理器分布

- electron/controllers/app-data-controller.ts：7
- electron/controllers/backup-controller.ts：2
- electron/controllers/chapter-lifecycle-controller.ts：4
- electron/controllers/config-controller.ts：2
- electron/controllers/db-controller.ts：204
- electron/controllers/external-file-grant-controller.ts：7
- electron/controllers/finalization-controller.ts：3
- electron/controllers/fs-controller.ts：7
- electron/controllers/import-controller.ts：2
- electron/controllers/kb-controller.ts：17
- electron/controllers/llm-controller.ts：14
- electron/controllers/model-provider-resource-controller.ts：1
- electron/controllers/official-homepage-controller.ts：1
- electron/controllers/phase3-8-controller.ts：5
- electron/controllers/project-controller.ts：11
- electron/controllers/project-documents-controller.ts：11
- electron/controllers/skin-controller.ts：3
- electron/controllers/story-data-controller.ts：15
- electron/controllers/update-controller.ts：6
- electron/controllers/window-controller.ts：4
- electron/controllers/workspace-hub-controller.ts：18
- electron/controllers/world-map-image-controller.ts：3
- electron/mcp/mcp-ipc-bridge.ts：9

## 存储面（SQLite）

- 声明的表：**111**
- 有 DML 使用者的表：**113**

### 待查项（方案要求：无法归属的必须列为待查，不能默认忽略）

- 声明但无使用者（orphan）：
- `character_shared_relationships_name_legacy（声明于 electron/repositories/character-relationship-repository.ts）`
- 使用但未声明（unknown）：
- `import_source_identity`
- `world_map_image`
- `world_map_layers`

## 边界说明

本扫描只覆盖静态一致性。通道→用户入口（F01–F32）、表→事实源核对属行为验收，状态见
features.json 与阶段报告。扫描会读取桌面主进程与 scripts/ 下的实际脚本；注释匹配与动态
SQL/通道仍须人工核对，不能把正则候选数当作运行时完整登记证明。
