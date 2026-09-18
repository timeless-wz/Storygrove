# AI-Novel-Writer 本地 MCP Server

服务使用 STDIO，不监听网络端口，也不会向外暴露 SQLite、LanceDB 或项目文件句柄。启动前必须指定已经初始化的项目目录：

```powershell
$env:AI_NOVEL_PROJECT_PATH = 'D:\ai\AI-Novel-Writer-master\your-project'
$env:AI_NOVEL_PROJECT_ID = 'main'
node scripts/story-mcp-server.mjs
```

在 Codex/Antigravity 的 MCP 配置中，`command` 使用 `node`，`args` 使用项目内脚本的绝对路径，并通过 `env.AI_NOVEL_PROJECT_PATH` 绑定项目。只读工具直接返回来源字段；提案工具只返回 `proposalId`。只有作者确认、会话仍有效且基础版本未变化时，`commit_approved_change` 才允许提交。

必须绑定**应用创建的项目目录**（其中已有 `.vela/vela.db`），不能指向外部小说母稿目录。母稿目录只由工作区扫描器只读访问。

```powershell
# Codex CLI：项目路径替换为实际已初始化的创作项目，而不是小说母稿目录
codex mcp add ai-novel-writer `
  --env 'AI_NOVEL_PROJECT_PATH=D:\your-project' `
  --env 'AI_NOVEL_PROJECT_ID=main' `
  -- node 'D:\ai\AI-Novel-Writer-master\scripts\story-mcp-server.mjs'

# Antigravity CLI
agy mcp add `
  --env 'AI_NOVEL_PROJECT_PATH=D:\your-project' `
  --env 'AI_NOVEL_PROJECT_ID=main' `
  ai-novel-writer node 'D:\ai\AI-Novel-Writer-master\scripts\story-mcp-server.mjs'
```

验收时先在两个客户端执行其 `mcp list`，然后要求客户端调用
`get_project_state`。若嵌入模型未配置，检索会明确降级为 FTS；它不会把候选、
废止或来源无法核验的向量命中提升为正式写作上下文。

服务重启会创建新的短期会话；未提交提案会留在项目数据库中，不会被自动提交。`mcp_audit_log` 记录工具名、项目会话和截断后的输入/结果摘要，不记录 API Key 或完整正文。

## Antigravity 参数兼容

每个服务进程在启动时同时绑定 `AI_NOVEL_PROJECT_PATH` 和
`AI_NOVEL_PROJECT_ID`。客户端可以显式传入同值的 `projectId` 作为断言；若
Antigravity 遗漏这个固定值，服务只会注入**当前启动进程已绑定**的项目 ID，
绝不会选择其他项目或回退到全局 `main`。任何显式但不匹配的 `projectId` 仍会被
拒绝。这样既兼容 Antigravity 的 MCP 工具调用，也保留跨项目隔离。
