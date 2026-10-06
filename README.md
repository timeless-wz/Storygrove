# Storygrove

[English](README_en.md) | **中文**

让故事从一个念头，生长为一部长篇。

Storygrove 是本地优先的 AI 辅助小说创作工作台，支持设定管理、章节规划、正文写作与修订，并通过 MCP 连接外部 AI 客户端。你维护故事事实与创作方向，AI 协助起草、检查和修改，重要变更由作者审核。

[项目主页](https://github.com/timeless-wz/Storygrove) · [版本发布](https://github.com/timeless-wz/Storygrove/releases/latest) · [问题反馈](https://github.com/timeless-wz/Storygrove/issues) · [文档](docs/README.md)

## 创作能力

- **故事设定**：创作方向、写作规范、故事前提、世界观、力量体系、角色与地点。
- **章节规划**：全书总纲、分卷与章节蓝图，以及时间线、伏笔和信息揭露管理。
- **写作与修订**：草稿、审稿、修稿和定稿分开维护，保留作者确认环节。
- **Markdown 资料**：通过对应业务入口整理和交换设定、规划与正文，区分正式资料、候选、废案和待整理内容。
- **模型接入**：自行配置模型服务；项目中包含 OpenAI-compatible 和 Gemini 协议适配。
- **MCP 协作**：外部 AI 可读取绑定项目、查询蓝图与草稿、提出修改建议；已实现的蓝图及草稿提交需要作者审批和版本校验。

故事前提描述核心故事与冲突；全书总纲、分卷和逐章安排在章节蓝图中维护。各入口的填写边界见[创作资料指南](docs/creative-content-authoring-guide.md)。

## 构建目标

| 平台 | 当前产物命名 |
| --- | --- |
| Windows x64 | `ai-novel-writer-setup-<版本>.exe` |
| macOS Apple Silicon | `ai-novel-writer-mac-arm64-<版本>-installer.dmg` |
| macOS Intel | `ai-novel-writer-mac-x64-<版本>-installer.dmg` |

上述是构建目标，不表示对应平台已有通过验收的发布。Windows 若尚未进行代码签名，应在发布说明中明确披露；macOS 当前配置为 ad-hoc 签名，未使用 Developer ID 签名或公证。最终以每次发布的签名检查结果为准。

## 开始使用

1. 从本仓库的[版本发布页](https://github.com/timeless-wz/Storygrove/releases/latest)下载经过验收的安装包。若尚无 Release，表示尚未发布安装包，可按下方步骤从源码运行。
2. 创建或打开本地创作项目，配置自己的模型服务与凭据。
3. 整理设定与章节规划，再开始生成或手动编写草稿。
4. 审核 AI 建议，确认需要采纳的修改后保存。

当前继承的源码版本号为 **v1.1.0**；它不代表 Storygrove 已发布或已通过完整安装验收。构建配置包含 Windows x64、macOS Apple Silicon 和 Intel 目标，实际可用版本以发布页产物及验证说明为准。

现有安装产物暂沿用 `ai-novel-writer-setup-<版本>.exe` 等文件名，桌面程序部分名称仍为“AI小说作家”。品牌迁移尚未改动应用标识、项目格式或数据目录，避免把文档改名与安装兼容性变更混在一起。

## 从源码运行

使用 `package.json` 指定的 pnpm 版本和受支持的 Node.js 版本。

```sh
git clone https://github.com/timeless-wz/Storygrove.git
cd Storygrove
pnpm install --frozen-lockfile
pnpm run dev
```

常用检查与发布步骤见[开发与发布](docs/development-and-release.md)。Windows 完整打包入口为 `pnpm run build:win`，包含构建及发布验收；普通 `pnpm run build` 只编译。

## MCP 接入

本仓库提供本地 STDIO MCP 服务，无需将项目数据库暴露为网络服务。源码环境推荐使用 `scripts/start-story-mcp.mjs` 启动器，配置示例、审批流程和工具限制见 [MCP 接入指南](docs/mcp-server.md)。

MCP 必须绑定由应用初始化的具体创作项目。读取、提案、审批、提交是不同步骤；外部 AI 的提案不会自动成为正式内容。并非所有提案类型都支持提交，具体以指南和工具返回结果为准。

## 数据与模型

项目资料保存在本地项目目录中。使用云端模型时，相关提示词与上下文会发送给所配置的服务商；“本地优先”不代表所有 AI 推理均在本机完成。

模型额度和 API Key 由使用者自行提供。不要上传凭据、真实项目数据库或未公开小说正文。升级和资料迁移前应备份创作项目。

## 来源与许可证

Storygrove 基于 AI Novel Writer 继续开发。原项目来源与第三方说明集中在[来源说明](UPSTREAM.md)，桌面项目保留 [GPL-3.0 许可证](LICENSE)。独立插件、字体与其他第三方组件保留各自的许可文件。

## 参与开发

请在 [Issues](https://github.com/timeless-wz/Storygrove/issues) 提交最小复现、建议或文档问题，提交修改前阅读[贡献指南](CONTRIBUTING.md)。
