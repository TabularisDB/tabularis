<div align="center">
  <img src="public/logo-sm.png" width="120" height="120" />
</div>

# tabularis

<p align="center">
  
![](https://img.shields.io/github/release/debba/tabularis.svg?style=flat)
![](https://img.shields.io/github/downloads/debba/tabularis/total.svg?style=flat)
![Build & Release](https://github.com/debba/tabularis/workflows/Release/badge.svg)
[![Known Vulnerabilities](https://snyk.io//test/github/debba/tabularis/badge.svg?targetFile=package.json)](https://snyk.io//test/github/debba/tabularis?targetFile=package.json)
[![Discord](https://img.shields.io/discord/1470772941296894128?color=5865F2&logo=discord&logoColor=white)](https://discord.gg/YrZPHAwMSG)
[![Gitster](https://gitster.dev/api/repositories/badge/cmlko1jr60005ne4yh7i7oy3e)](https://gitster.dev/repo/debba/tabularis)

</p>

<p align="center">
  <a href="https://snapcraft.io/tabularis"><img src="https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft" alt="Snap Store" /></a>
  <a href="https://aur.archlinux.org/packages/tabularis-bin"><img src="https://img.shields.io/badge/AUR-tabularis--bin-1793D1?logo=archlinux&logoColor=white" alt="AUR" /></a>
  <a href="https://winstall.app/apps/Debba.Tabularis"><img src="https://img.shields.io/winget/v/Debba.Tabularis?label=WinGet&logo=windows&color=0078D4" alt="WinGet" /></a>
</p>

An open-source desktop client for modern databases. Supports PostgreSQL, MySQL/MariaDB and SQLite and is hackable with plugins, with notebooks, AI, and MCP built in.

**Available in:** English, Italian, Spanish, Chinese (Simplified)

**Discord** - [Join our Discord server](https://discord.gg/YrZPHAwMSG) to talk with the maintainers, share feedback, and get help from the community.

<div align="center">
  <img src="website/public/img/overview.png?v" width="80%" alt="Tabularis" />
</div>

> 💡 **Origin Story:** This project began as an AI-assisted development experiment, exploring how far intelligent agents could accelerate building a fully functional tool from scratch..

## Release Download:

[![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/debba/tabularis/releases/download/v0.9.17/tabularis_0.9.17_x64-setup.exe) [![macOS](https://img.shields.io/badge/macOS-Download-black?logo=apple)](https://github.com/debba/tabularis/releases/download/v0.9.17/tabularis_0.9.17_x64.dmg) [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/debba/tabularis/releases/download/v0.9.17/tabularis_0.9.17_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/debba/tabularis/releases/download/v0.9.17/tabularis_0.9.17_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/debba/tabularis/releases/download/v0.9.17/tabularis-0.9.7-1.x86_64.rpm)

<!-- SPONSORS:START -->

## Sponsors

- <a href="https://www.serversmtp.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="website/public/img/sponsors/turbosmtp_compact.png" height="28" alt="turboSMTP" /></a> **[turboSMTP](https://www.serversmtp.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Professional SMTP relay — your emails delivered straight to the inbox, never to spam
- <a href="https://www.kilo.ai/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="website/public/img/sponsors/kilocode_compact.png" height="28" alt="Kilo Code" /></a> **[Kilo Code](https://www.kilo.ai/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Open source AI coding agent — build, ship, and iterate faster with 500+ models
- <a href="https://usero.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="website/public/img/sponsors/usero_compact.png" height="28" alt="Usero" /></a> **[Usero](https://usero.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Feedback becomes code. Automatically.

_[Become a sponsor →](https://tabularis.dev/sponsors)_

<!-- SPONSORS:END -->

## Table of Contents

- [Sponsors](#sponsors)
- [Installation](#installation)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux (Snap)](#linux-snap)
  - [Linux (AppImage)](#linux-appimage)
  - [Arch Linux (AUR)](#arch-linux-aur)
- [Updates](#updates)
- [Gallery](#gallery)
- [Discord](#discord)
- [Changelog](#changelog)
- [Features](#features)
  - [Connection Management](#connection-management)
  - [Database Explorer](#database-explorer)
  - [SQL Editor](#sql-editor)
  - [SQL Notebooks](#sql-notebooks)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Visual Query Builder](#visual-query-builder)
  - [Data Grid](#data-grid)
  - [Logging](#logging)
  - [Plugin System](#plugin-system)
- [Configuration Storage](#configuration-storage)
  - [AI Features (Optional)](#ai-features-optional)
  - [MCP Server — AI Agent Integration](#mcp-server--ai-agent-integration)
- [Tech Stack](#tech-stack)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

## Installation

### Windows

#### WinGet (Recommended)

```bash
winget install Debba.Tabularis
```

#### Direct Download

Download the installer from the [Releases page](https://github.com/debba/tabularis/releases) and run it:

```
tabularis_x.x.x_x64-setup.exe
```

Follow the on-screen instructions to complete the installation.

### macOS

#### Homebrew (Recommended)

To add our tap, run:

```bash
brew tap debba/tabularis
```

Then install:

```bash
brew install --cask tabularis
```

[![Homebrew](https://img.shields.io/badge/Homebrew-Repository-orange?logo=homebrew)](https://github.com/debba/homebrew-tabularis)

#### Direct Download

When you install tabularis on macOS, you need to allow accessibility access (Privacy & Security) to the tabularis app.

If you are upgrading and you already have tabularis on the allowed list you will need to manually remove them before accessibility access can be granted to the new version.

macOS users who download directly from releases may need to run:

```bash
xattr -c /Applications/tabularis.app
```

after copying the app to the Applications directory.

### Linux (Snap)

```bash
sudo snap install tabularis
```

[![Snap Store](https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft)](https://snapcraft.io/tabularis)

### Linux (AppImage)

Download the `.AppImage` file from the [Releases page](https://github.com/debba/tabularis/releases), make it executable and run it:

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

### Arch Linux (AUR)

```bash
yay -S tabularis-bin
```

## Updates

### Automatic Updates

Tabularis checks for updates automatically on startup. When a new version is available, a notification will appear, allowing you to download and install the update seamlessly.

### Manual Updates

You can also manually check for updates or download the latest version directly from the [Releases page](https://github.com/debba/tabularis/releases).

## Gallery

**View the full gallery at [tabularis.dev](https://tabularis.dev)**

## Discord

Join our [Discord server](https://discord.gg/YrZPHAwMSG) to talk with the maintainers, share feedback, suggest features, or get help from the community.

## [Changelog](./CHANGELOG.md)

## Features

### Connection Management

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/connections)

- Support for **MySQL/MariaDB**, **PostgreSQL** (with multi-schema support) and **SQLite**.
- **Multi-Database Selection:** Select multiple MySQL/MariaDB databases in a single connection — each appears as its own collapsible node in the sidebar.
- Save, manage, and clone connection profiles with secure local persistence.
- **Redesigned Connections Page:** Grid and list view modes, real-time search, branded driver icons (PostgreSQL elephant, MySQL dolphin, SQLite cylinder) in their official colors.
- **Open in Editor:** Right-click any connection in the sidebar to open it directly in the editor via context menu.
- Manage **SSH Connections** from the connection manager.
- Optional secure password storage in system **Keychain**.
- **SSH Tunneling** with automatic readiness detection.

### Database Explorer

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/schema-management)

- **Tree View:** Browse tables, columns, keys, foreign keys, indexes, views, and stored routines.
- **Inline Editing:** Edit table and column properties directly from the sidebar.
- **ER Diagram:** Interactive Entity-Relationship visualization (Pan, Zoom, Layout) with selective table diagram generation.
- **Context Actions:** Show data, count rows, modify schema, duplicate/delete tables.
- **Views Support:** Browse, inspect, and query database views with full metadata.
- **Stored Routines:** View and manage stored procedures and functions with parameter details.
- **Fast Metadata:** Parallel fetching for schema loading.
- **SQL Dump & Import:** Export and restore databases with a single flow.

### SQL Editor

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/editor)

- **Monaco Editor:** Syntax highlighting and auto-completion.
- **Tabbed Interface:** Isolated connections per tab.
- **Split View:** Open multiple database connections side-by-side in a resizable split-pane layout.
- **Multi-Statement Execution:** Run All, Run Selected, or pick individual queries from a multi-statement script. Results from each query appear in separate tabs with independent pagination and error handling.
- **Multi-Result Tabs:** Close, rename, re-run, and manage result tabs via context menu. Query parameters are collected once across all queries.
- **Smart Query Splitting:** Powered by `dbgate-query-splitter` — correctly handles stored procedures, functions, and `$$`-delimited blocks.
- **Saved Queries:** Persist frequently used SQL.
- **AI Assist Overlay:** AI assistance buttons accessible as a floating overlay directly in the editor.

### SQL Notebooks

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/notebooks)

- **Multi-Cell Workspace:** Combine SQL and Markdown cells in a single document.
- **Inline Results & Charts:** View query results directly below each cell, with bar, line, and pie chart visualizations.
- **Cross-Cell Variables:** Reference results from other cells using `{{cellName.columnName}}` syntax with automatic dependency resolution.
- **Notebook Parameters:** Define global `{{$paramName}}` variables substituted across all cells at execution time.
- **Run All:** Sequential execution of all SQL cells with stop-on-error option and completion summary.
- **Drag & Drop:** Reorder cells freely, collapse/expand individual cells or all at once.
- **AI Cell Naming:** Auto-generate descriptive cell names individually or in batch.
- **Persistence & Export:** Auto-saved as `.tabularis-notebook` files. Export as `.tabularis-notebook`, HTML, CSV, or JSON.
- **Outline Panel:** Side panel showing the full notebook structure with click-to-navigate.

### Keyboard Shortcuts

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/keyboard-shortcuts)

- **Built-in shortcuts** for navigation, editor, and data grid actions (e.g. `Ctrl+B` to toggle sidebar, `Ctrl+T` for a new tab, `Ctrl+→/←` to paginate results).
- **Fully customizable:** Remap any non-locked shortcut from **Settings → Keyboard Shortcuts** — press the combo to record it, click ↺ to reset.
- **Platform-aware:** Uses `Cmd` on macOS and `Ctrl` on Windows/Linux throughout.
- **Visual hints:** Hold `Ctrl+Shift` in the sidebar to reveal numbered badges (1–9) for instant connection switching.
- **Persistent overrides:** Saved to `keybindings.json` in the app config directory; can also be edited manually.

### Visual Query Builder

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)

- **Drag-and-Drop:** Build queries visually with ReactFlow.
- **Visual JOINs:** Connect tables to create relationships.
- **Advanced Logic:** WHERE/HAVING filters, aggregates (COUNT, SUM, AVG), sorting, and limits.
- **Real-time SQL:** Instant code generation.

### Data Grid

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/data-grid)

- **Inline & Batch Editing:** Modify cells and commit multiple changes at once.
- **Row Management:** Create, delete, and select multiple rows.
- **Copy Selected Rows:** Export selections straight to the clipboard.
- **Export:** Save results as CSV or JSON.
- **Smart Context:** Read-only mode for aggregates, edit mode for tables.
- **Spatial Data Support:** Initial GEOMETRY support for MySQL with raw SQL function inputs for spatial data.

### Plugin System

> [Full reference on tabularis.dev →](https://tabularis.dev/wiki/plugins)

Tabularis is **hackable with an external plugin system**. Plugins are standalone executables that communicate with the app over **JSON-RPC 2.0 via stdin/stdout**, and can be written in any language.

- **Install Plugins:** Browse and install community drivers from **Settings → Available Plugins** — no restart required.
- **Manage Drivers:** View all registered drivers (built-in and plugins) in **Settings → Installed Drivers** and uninstall plugins with one click.
- **Any Database:** Add support for DuckDB, MongoDB, or any other database by writing or installing a plugin.
- **Plugin Registry:** Official plugins are listed in [`plugins/registry.json`](./plugins/registry.json).
- **Developer Guide:** See [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md) to build your own driver in any language.

### Logging

- **Real-time Monitoring:** View application logs directly in Settings.
- **Level Filtering:** Filter by DEBUG, INFO, WARN, or ERROR severity.
- **In-memory Buffer:** Configurable retention.
- **Query Expansion:** Automatically expand and inspect SQL queries in logs.
- **Export Logs:** Save logs to `.log` files for debugging or audit trails.
- **Toggle Control:** Enable/disable logging and adjust buffer size without restart.
- **CLI Debug Mode:** Start with `tabularis --debug` to enable verbose logging (including internal SQLx queries) from launch.

### Configuration Storage

Configuration is stored in `~/.config/tabularis/` (Linux), `~/Library/Application Support/tabularis/` (macOS), or `%APPDATA%\tabularis\` (Windows).

- `connections.json`: Connection profiles.
- `saved_queries.json`: Saved SQL queries.
- `config.json`: App settings (theme, language, page size).
- `themes/`: Custom themes.
- `preferences/`: Editor preferences per connection (tabs, queries, layout).

#### Editor Preferences

Tabularis automatically saves your editor state for each database connection. When you reopen a connection, you'll see your previously opened tabs with their queries restored.

**Location:** `~/.config/tabularis/preferences/{connectionId}/preferences.json`

**What is saved:**

- Tab titles and types (Console, Table, Visual Query)
- SQL queries and query parameters
- Active table and selected columns
- Filter, sort, and limit clauses
- Visual Query Builder flow state
- Editor visibility state

**What is NOT saved:**

- Query results (you'll need to re-run queries)
- Error messages
- Execution times
- Pending edits or deletions
- Loading states

This approach ensures fast startup times while preserving your workspace layout across sessions.

#### `config.json` options

- `theme`: Theme ID (e.g., `"tabularis-dark"`, `"monokai"`).
- `fontFamily`: Editor font family.
- `fontSize`: Editor font size (px).
- `language`: `"auto"`, `"en"` (English), `"it"` (Italian), `"es"` (Spanish), `"zh"` (Chinese Simplified).
- `resultPageSize`: Default rows per page.
- `aiEnabled`: Enable/Disable AI features.
- `customRegistryUrl`: Custom URL for the plugin registry (overrides the default official registry).

#### Custom AI Models override

You can override or add custom models for AI providers by editing `config.json` and adding the `aiCustomModels` object:

```json
{
  "resultPageSize": 1000,
  "language": "en",
  "aiEnabled": true,
  "aiProvider": "openai",
  "aiCustomModels": {
    "openai": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-5-preview"],
    "anthropic": ["claude-3-opus-20240229", "claude-3-sonnet-20240229"],
    "minimax": ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
    "openrouter": ["google/gemini-pro-1.5", "meta-llama/llama-3-70b-instruct"]
  }
}
```

### AI Features (Optional)

Optional Text-to-SQL and query explanation powered by:

- **OpenAI**
- **Anthropic**
- **MiniMax** (MiniMax-M2.7 and MiniMax-M2.7-highspeed, 204K context)
- **OpenRouter** (access to Gemini, Llama, DeepSeek, etc.)
- **Ollama** (Local LLM support for total privacy)
- **OpenAI-Compatible APIs** (Groq, Perplexity, Azure OpenAI, LocalAI, and more)

#### Local AI (Ollama)

Select "Ollama" as your provider in Settings. Tabularis will automatically detect your local models running on port `11434` (configurable). No API key required.

#### OpenAI-Compatible APIs

Select "OpenAI Compatible" as your provider to connect to any service that implements the OpenAI API format. Configure your custom endpoint URL and model name in Settings. Examples:

- **Groq**: `https://api.groq.com/openai/v1`
- **Perplexity**: `https://api.perplexity.ai`
- **Local servers**: `http://localhost:8000/v1`

#### Dynamic Model Fetching

Tabularis automatically fetches the latest available models from your configured provider.

- **Refresh:** Click the refresh icon in Settings to update the model list from the API.
- **Cache:** Model lists are cached locally for 24h to ensure fast startup.
- **Validation:** Visual feedback if the selected model is not available for the current provider.

### MCP Server — AI Agent Integration

Tabularis includes a built-in **MCP (Model Context Protocol) server** that lets AI agents read your database schema and execute queries directly from their chat interface.

```bash
tabularis --mcp
```

#### Supported clients

| Client | One-click install | Manual config |
|--------|------------------|---------------|
| **Claude Desktop** | Yes (Settings → MCP) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Cursor** | Yes (Settings → MCP) | `~/.cursor/mcp.json` |
| **Windsurf** | Yes (Settings → MCP) | `~/.codeium/windsurf/mcp_config.json` |

#### Setup (one-click)

1. Open **Settings → MCP Server Integration** in Tabularis
2. Click **Install Config** next to your AI client
3. Restart the client

#### Manual setup

Add this to your client's MCP config file:

```json
{
  "mcpServers": {
    "tabularis": {
      "command": "/path/to/tabularis",
      "args": ["--mcp"]
    }
  }
}
```

#### Available tools

Once connected, your AI agent can:

| Tool | Description |
|------|-------------|
| `list_connections` | List all saved database connections |
| `list_tables` | List tables in a connection (with optional schema filter) |
| `describe_table` | Get full schema: columns, indexes, foreign keys |
| `run_query` | Execute any SQL query and return results |

#### Example prompts

> "Show me all tables in my production database and describe the `orders` table"

> "Write and run a query to find the top 10 customers by total order value this month"

> "Check if there are any missing indexes on the `users` table"

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4.
- **Backend:** Rust, Tauri v2, SQLx.

## Development

### Setup

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

## Roadmap

- [x] [[Feat]: Allow loading of multiple Databases per connection](https://github.com/debba/tabularis/issues/47)
- [x] [Visual Explain Analyze](https://github.com/debba/tabularis/issues/22)
- [x] [Plugin System](https://github.com/debba/tabularis/issues/19)
- [ ] [Feature: Remote Control](https://github.com/debba/tabularis/issues/46)
- [ ] [Command Palette](https://github.com/debba/tabularis/issues/25)
- [ ] [JSON/JSONB Editor & Viewer](https://github.com/debba/tabularis/issues/24)
- [ ] [SQL Formatting / Prettier](https://github.com/debba/tabularis/issues/23)
- [ ] [Data Compare / Diff Tool](https://github.com/debba/tabularis/issues/21)
- [ ] [Team Collaboration](https://github.com/debba/tabularis/issues/20)
- [ ] [Query History](https://github.com/debba/tabularis/issues/18)
- [ ] [Better SQLite Support](https://github.com/debba/tabularis/issues/17)
- [ ] [Better PostgreSQL Support](https://github.com/debba/tabularis/issues/16)
## License

Apache License 2.0
