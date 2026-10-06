# Storygrove 文档

## 使用与开发

| 文档 | 内容 |
| --- | --- |
| [项目介绍](../README.md) | 功能、源码运行、数据说明与项目入口 |
| [MCP 接入](mcp-server.md) | 外部 AI 的项目绑定、提案、审批与提交 |
| [创作资料填写](creative-content-authoring-guide.md) | 各类 Markdown 资料的对应入口与边界 |
| [开发与发布](development-and-release.md) | 开发检查、安装包构建与正式验收 |
| [贡献指南](../CONTRIBUTING.md) | 问题反馈、修改与验证要求 |
| [来源说明](../UPSTREAM.md) | 原项目与第三方许可 |

## 实现契约

现有 `*-contract.md`、`contracts/`、`product-domain.md` 和 `adr/` 包含数据来源、会话、导入和发布等实现边界。修改相应功能前，应结合当前代码和测试阅读；不会因为品牌迁移而自动失效。

## 历史资料

`handoffs/`、`plans/`、`audits/`、`reviews/`、`research/`、`experiments/` 和 `.release/notes/` 是带背景与时间边界的资料。旧名称、旧链接与旧测试结果仅说明历史，不能作为 Storygrove 当前发布承诺。旧宣传截图不再用于新 README。

新用户说明从本页进入，不再复制原项目的宣传首页、下载徽章或插件推广说明。必要的历史文件保留原位置，避免断开实现契约与现有引用。
