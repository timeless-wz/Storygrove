# Storygrove

**English** | [中文](README.md)

[![Download for Windows](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F%20Download-Windows%20x64-2ea44f?style=for-the-badge&logo=github&logoColor=white)](https://github.com/timeless-wz/Storygrove/releases/latest)

A place for stories to grow.

Storygrove is a local-first, AI-assisted novel-writing workspace with MCP integration. It brings together worldbuilding, character management, outlining, drafting, review, and revision while keeping authors in control of accepted changes.

[Repository](https://github.com/timeless-wz/Storygrove) · [Releases](https://github.com/timeless-wz/Storygrove/releases/latest) · [Issues](https://github.com/timeless-wz/Storygrove/issues) · [Documentation](docs/README.md)

## Features

- Organize creative direction, writing rules, story premises, worlds, characters, locations, and power systems.
- Maintain book, volume, and chapter plans alongside timelines, foreshadowing, and information reveals.
- Work with drafts, reviews, revisions, and finalized chapters as distinct authoring stages.
- Exchange Markdown through the relevant authoring workflows; distinguish confirmed material, candidates, retired ideas, and legacy content.
- Connect your own model services through the implemented OpenAI-compatible and Gemini adapters.
- Use the local MCP server to read a bound project and propose edits. Supported blueprint and draft commits require author approval and revision checks.

## Build targets

| Platform | Current artifact naming |
| --- | --- |
| Windows x64 | `ai-novel-writer-setup-<version>.exe` |
| macOS Apple Silicon | `ai-novel-writer-mac-arm64-<version>-installer.dmg` |
| macOS Intel | `ai-novel-writer-mac-x64-<version>-installer.dmg` |

These are build targets, not evidence of qualified releases. Disclose Windows artifacts that are not code-signed. The current macOS configuration is ad-hoc signed with no Developer ID signature and is not notarized. Verify and disclose the actual signing state for every release.

## Installation and status

Download qualified installers from this repository's [Releases](https://github.com/timeless-wz/Storygrove/releases/latest). If there is no release yet, use the source instructions below.

The inherited source version is **v1.1.0**, not a claim that a Storygrove installer has been released or qualified. Build configurations include Windows x64, macOS Apple Silicon, and Intel targets; consult each release for available and verified artifacts.

Installer names such as `ai-novel-writer-setup-<version>.exe` and some desktop labels still use the previous name. Application identifiers, project formats, and data locations have not been renamed as part of this documentation migration.

## Development

Use the pnpm version and Node.js requirements declared in `package.json`.

```sh
git clone https://github.com/timeless-wz/Storygrove.git
cd Storygrove
pnpm install --frozen-lockfile
pnpm run dev
```

See [development and release instructions](docs/development-and-release.md). `pnpm run build:win` runs the complete Windows release gate; `pnpm run build` compiles the application only.

## MCP

The repository provides a local STDIO MCP server. Use `scripts/start-story-mcp.mjs` in a source checkout and bind an initialized application project. See the [MCP guide](docs/mcp-server.md) for configuration, supported tools, approval, and commit limitations.

A proposal is not a committed change. Only implemented proposal types can be committed, with persisted approval and version validation.

## Data and models

Project data is stored locally. When you select a cloud model, prompts and relevant context are sent to that provider. Supply your own model credentials and service quota. Do not publish API keys, private manuscripts, or project databases; back up projects before upgrades and migration.

## Origins and license

Storygrove is derived from AI Novel Writer. See [UPSTREAM.md](UPSTREAM.md) for attribution and [LICENSE](LICENSE) for the retained GPL-3.0 license. Independent plugins, fonts, and dependencies retain their own notices.

See [CONTRIBUTING.md](CONTRIBUTING.md) to report issues or propose changes.
