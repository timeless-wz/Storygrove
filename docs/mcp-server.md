# AI-Novel-Writer 本地 MCP Server

服务使用 STDIO，不监听网络端口，也不会向外暴露 SQLite、LanceDB 或项目文件句柄。启动前必须指定已经初始化的项目目录：

```powershell
$env:AI_NOVEL_PROJECT_PATH = 'D:\ai\AI-Novel-Writer-master\your-project'
$env:AI_NOVEL_PROJECT_ID = 'main'
node scripts/start-story-mcp.mjs
```

在 Codex/Antigravity 的 MCP 配置中，`command` 使用 `node`，`args` 使用项目内 `start-story-mcp.mjs` 的绝对路径，并通过 `env.AI_NOVEL_PROJECT_PATH` 绑定项目。启动器用 Electron 的 Node 运行时启动服务，可与应用共用已构建的 `better-sqlite3`，不改写原生模块。只读工具直接返回来源字段；提案工具只返回 `proposalId`。只有作者确认、会话仍有效且基础版本未变化时，`commit_approved_change` 才允许提交。

必须绑定**应用创建的项目目录**（其中已有 `.vela/vela.db`），不能指向外部小说母稿目录。母稿目录只由工作区扫描器只读访问。

```powershell
# Codex CLI：项目路径替换为实际已初始化的创作项目，而不是小说母稿目录
codex mcp add ai-novel-writer `
  --env 'AI_NOVEL_PROJECT_PATH=D:\your-project' `
  --env 'AI_NOVEL_PROJECT_ID=main' `
  -- node 'D:\ai\AI-Novel-Writer-master\scripts\start-story-mcp.mjs'

# Antigravity CLI
agy mcp add `
  --env 'AI_NOVEL_PROJECT_PATH=D:\your-project' `
  --env 'AI_NOVEL_PROJECT_ID=main' `
  ai-novel-writer node 'D:\ai\AI-Novel-Writer-master\scripts\start-story-mcp.mjs'
```

验收时先在两个客户端执行其 `mcp list`，然后要求客户端调用
`get_project_state`。若嵌入模型未配置，检索会明确降级为 FTS；它不会把候选、
废止或来源无法核验的向量命中提升为正式写作上下文。

服务重启会创建新的短期会话；未提交提案会留在项目数据库中，不会被自动提交。`mcp_audit_log` 记录工具名、项目会话和截断后的输入/结果摘要，不记录 API Key 或完整正文。

## 蓝图与草稿的外部编辑闭环

外部 Agent 先调用 `get_blueprint(chapterNumber)` 或 `get_draft(draftId)`，取得当前内容和 `revision`。
随后调用 `propose_blueprint_update`（传入完整蓝图、章节号和 `baseRevision`）或
`propose_draft_update`（传入未定稿草稿 ID、新正文和 `baseRevision`）。提案不会立刻改动蓝图或正文。

作者在应用的“项目总览 → 外部 AI 提案”对照当前与提案内容，点击“批准”或“拒绝”。
批准后，外部 Agent 使用返回的 `proposalId` 调用 `commit_approved_change`，并传入
`authorApproved: true`。服务在一个数据库事务中复核项目、会话、审批状态和资源版本，
然后写入内容与提交回执。若蓝图或草稿在提案后变化，提交会拒绝，Agent 必须重新读取并提案。
草稿工具只允许修改未定稿且未归档的草稿；事实、事件及审核豁免提案目前仍仅能存为待审记录，
`commit_approved_change` 不会将这些尚未实现的类型假报为已提交。

会话与审批约束：每个服务进程启动时创建一个 1 小时有效的 MCP 会话。会话过期后，该会话的
提案在应用中标记为不可批准（批准按钮禁用），`commit_approved_change` 也会拒绝提交；被作者
拒绝的提案同样无法提交。外部 Agent 需要重启服务（MCP 客户端会重新拉起进程），重新读取
最新内容后再次提案。

提交回执与重试：`commit_approved_change` 在同一事务内写入内容、置状态并保存回执；
同一提案重复提交（如响应丢失后的重试）会原样回放已保存的回执（`alreadyCommitted: true`），
不会二次写入。`get_proposal_receipt(proposalId)` 可在任何会话（包括服务重启后）查询提案
状态与提交回执，但它只是只读查询——旧会话中的待审/已批准提案永远不能在新会话里提交。

项目身份：`AI_NOVEL_PROJECT_ID` 必须等于项目数据库 `project_core.id`（应用创建的项目固定
为 `main`）；服务写库时使用 `.vela/project.json` 清单里的应用项目 UUID 作为行身份，与应用
侧提案审核、提交监听共享同一标识，测试夹具没有清单时回退到绑定的环境变量值。

`codex exec` 这类"每回合新进程"的客户端会在每个回合重启 MCP 会话，因此"提案→作者批准→
提交"必须在同一个回合内完成：Agent 先提案，然后轮询 `get_proposal_receipt` 等待作者在
应用中批准，状态变为 `approved` 后立即提交。交互式（长会话）客户端可以跨回合等待批准。

应用侧变更感知：作者批准提案后，主进程开始监听该提案的提交回执；MCP 提交成功后，应用
收到 `story-data:agent-proposal-committed` 事件，自动刷新项目树、蓝图与草稿列表。已打开
的草稿编辑器若无未保存修改会同步为新内容；若有未保存修改，应用只弹提示，绝不覆盖作者
正在编辑的正文。

直接用普通 `node` 执行 `story-mcp-server.mjs` 时，`better-sqlite3` 必须与 Node ABI 匹配；
开发环境推荐使用上面的启动器，避免在应用运行时替换原生模块。服务只接受已初始化项目中的真实 `project_core.id`。

## Antigravity 参数兼容

每个服务进程在启动时同时绑定 `AI_NOVEL_PROJECT_PATH` 和
`AI_NOVEL_PROJECT_ID`。客户端可以显式传入同值的 `projectId` 作为断言；若
Antigravity 遗漏这个固定值，服务只会注入**当前启动进程已绑定**的项目 ID，
绝不会选择其他项目或回退到全局 `main`。任何显式但不匹配的 `projectId` 仍会被
拒绝。这样既兼容 Antigravity 的 MCP 工具调用，也保留跨项目隔离。
