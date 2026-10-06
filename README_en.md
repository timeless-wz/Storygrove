# Storygrove

**English** | [中文](README.md)

[![Download for Windows](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F%20Download-Windows%20x64-2ea44f?style=for-the-badge&logo=github&logoColor=white)](https://github.com/timeless-wz/Storygrove/releases/latest)
[![Release](https://img.shields.io/github/v/release/timeless-wz/Storygrove)](https://github.com/timeless-wz/Storygrove/releases/latest)
[![License](https://img.shields.io/github/license/timeless-wz/Storygrove)](LICENSE)
![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS-blue)

A place for stories to grow.

Storygrove is a local-first, AI-assisted novel-writing workspace with MCP integration. It brings together worldbuilding, character management, outlining, drafting, review, and revision while keeping authors in control of accepted changes.

[Repository](https://github.com/timeless-wz/Storygrove) · [Releases](https://github.com/timeless-wz/Storygrove/releases/latest) · [Issues](https://github.com/timeless-wz/Storygrove/issues) · [Documentation](docs/README.md)

## Why Storygrove

- **Authors own the facts**: Premises, characters, worlds, and outlines are author facts: only you can enter or confirm them. Model output appears as candidates and never silently rewrites your settings.
- **Approval-based AI collaboration**: Proposal, approval, and commit are separate steps. Suggestions from external AI clients never become canon automatically.
- **Local-first**: Projects live in local project directories. There is no cloud storage and your manuscripts are not uploaded.
- **Built for long-form**: Book outline, volume plans, and per-chapter blueprints with timeline, foreshadowing, and information-reveal management support pacing across hundreds of thousands of words.

## Features

### Settings and planning

- **Story settings**: Dedicated entry points for creative direction, writing rules, story premises, worlds, power systems, characters, and locations.
- **Chapter planning**: Book outline, volume plans, and chapter blueprints layered on top of each other; each blueprint states goals, conflicts, events, and involved characters.
- **Narrative threads**: Timelines, foreshadowing, and information reveals in one place, feeding context selection for later chapters.
- **Plot tree**: A read-only progress view derived from outlines, blueprints, and finalized summaries.

### Drafting and revision

- **Multiple drafts**: Generate or write several draft versions per chapter without overwriting each other.
- **Review and revision**: Review notes become revision input only after you confirm them; revised text merges only after a diff confirmation.
- **Traceable finals**: Finalized chapters are bound to their source text; summaries, continuity facts, and character states trace back to real finals.
- **Interruptible generation**: Text received before an interrupted generation is kept locally as a recovery candidate — discard it or recover it.

### Model access and MCP collaboration

- **Bring your own models**: Configure model services yourself; the project includes OpenAI-compatible and Gemini protocol adapters. Quota and API keys are your own.
- **MCP collaboration**: A local STDIO MCP server lets external AI clients bind a project, read blueprints and drafts, and propose changes. Commits require author approval and version validation. See the [MCP guide](docs/mcp-server.md).
- **Prompt contracts**: Core agreements such as language, structured output, and data safety cannot be overridden; creative personas and stage guidance are customizable.

## Writing workflow

```
Organize settings & plans → Generate/write drafts → Review (human-confirmed) → Revise (diff-confirmed) → Finalize (archived with receipts)
```

Story premises describe the core story and conflicts; the book outline, volume plans, and per-chapter arrangement live in chapter blueprints. See the [authoring guide](docs/creative-content-authoring-guide.md) for the boundaries of each entry point.

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

## FAQ

**Is there a subscription?**
The app is free and open source (GPL-3.0). AI inference runs on the provider you configure; quota and API key costs are your own.

**Where is my novel data stored?**
In the local directory you chose when creating the project. There is no cloud storage and your manuscripts are not uploaded.

**Which models are supported?**
Any OpenAI-compatible endpoint or Gemini-protocol service: enter the address and key in settings.

**Will AI change my manuscript directly?**
No. AI output arrives as drafts or proposals; accepting notes, merging revisions, and finalizing always require your confirmation.

**Can it publish my book?**
The app offers no publishing platform or reader community; finalization is the in-project end state, and where you publish is up to you.

## Documentation

| Document | Contents |
| --- | --- |
| [MCP guide](docs/mcp-server.md) | Project binding, proposals, approval, and commits for external AI |
| [Authoring guide](docs/creative-content-authoring-guide.md) | Entry points and boundaries for settings, plans, and manuscripts |
| [Development and release](docs/development-and-release.md) | Development checks, installer builds, and release qualification |
| [Contributing](CONTRIBUTING.md) | Reporting issues, proposing changes, verification requirements |
| [Upstream](UPSTREAM.md) | Original project attribution and third-party licenses |

## Origins and license

Storygrove is derived from AI Novel Writer. See [UPSTREAM.md](UPSTREAM.md) for attribution and [LICENSE](LICENSE) for the retained GPL-3.0 license. Independent plugins, fonts, and dependencies retain their own notices.

See [CONTRIBUTING.md](CONTRIBUTING.md) to report issues or propose changes.
