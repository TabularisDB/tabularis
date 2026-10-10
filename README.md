<br />
<p align="center">
  <img src=".github/assets/banner-light.png#gh-light-mode-only" alt="Tabularis" width="100%">
  <img src=".github/assets/banner-dark.png#gh-dark-mode-only" alt="Tabularis" width="100%">
</p>

# Tabularis

Tabularis is an open-source desktop SQL workspace with 3 built-in database drivers and 21 shipped plugins, including DuckDB, ClickHouse, Redis and Firestore. Its built-in MCP server lets Claude, Cursor and Devin (formerly Windsurf) read your schema and run queries in the same app you already use.

<p align="center">
  <b><a href="https://tabularis.dev">Website</a></b> ·
  <b><a href="https://tabularis.dev/wiki">Docs</a></b> ·
  <b><a href="https://tabularis.dev/download">Download</a></b> ·
  <b><a href="./CHANGELOG.md">Changelog</a></b>
</p>

<br />

<p align="center">
  <img src="https://img.shields.io/github/release/TabularisDB/tabularis.svg?style=flat" alt="Release" />
  <img src="https://img.shields.io/github/stars/TabularisDB/tabularis?style=flat" alt="Stars" />
  <img src="https://img.shields.io/github/downloads/TabularisDB/tabularis/total.svg?style=flat" alt="Downloads" />
  <img src="https://github.com/TabularisDB/tabularis/workflows/Release/badge.svg" alt="Build & Release" />
  <a href="https://discord.com/invite/K2hmhfHRSt"><img src="https://img.shields.io/discord/1502944695808950282?color=5865F2&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://gitster.dev/repo/TabularisDB/tabularis"><img src="https://gitster.dev/api/repositories/badge/cmlko1jr60005ne4yh7i7oy3e" alt="Gitster" /></a>
  <br />
  <a href="https://snapcraft.io/tabularis"><img src="https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft" alt="Snap Store" /></a>
  <a href="https://flatpark.org/apps/dev.tabularis.Tabularis/"><img src="https://img.shields.io/badge/flatpak-tabularis-4A90D9?logo=flatpak&logoColor=white" alt="Flatpak (Flatpark)" /></a>
  <a href="https://aur.archlinux.org/packages/tabularis-bin"><img src="https://img.shields.io/badge/AUR-tabularis--bin-1793D1?logo=archlinux&logoColor=white" alt="AUR" /></a>
  <a href="https://winstall.app/apps/Debba.Tabularis"><img src="https://img.shields.io/winget/v/Debba.Tabularis?label=WinGet&logo=windows&color=0078D4" alt="WinGet" /></a>
</p>

<p align="center">
  <a href="https://vercel.com/open-source-program"><img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge-2026.svg" /></a>
</p>

<p align="center">
  <sub>
    <a href="./README.md">English</a> ·
    <a href="./README.it.md">Italiano</a> ·
    <a href="./README.es.md">Español</a> ·
    <a href="./README.zh-CN.md">中文</a> ·
    <a href="./README.fr.md">Français</a> ·
    <a href="./README.de.md">Deutsch</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ru.md">Русский</a> ·
    <a href="./README.tl.md">Tagalog</a> ·
    <a href="./README.ko.md">한국어</a> ·
    <a href="./README.pt-BR.md">Português (Brasil)</a>
  </sub>
</p>

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/TabularisDB/website/main/public/img/overview.gif" alt="Tabularis, a desktop SQL workspace, showing its query editor and data grid" />
</div>

## Download

```bash
winget install Debba.Tabularis    # Windows
brew install --cask tabularis     # macOS
sudo snap install tabularis       # Linux
```

Or grab an installer directly:

- **Windows:** [![Windows](https://img.shields.io/badge/Windows-Download-blue?logo=windows)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_x64-setup.exe)

- **macOS:** [![macOS (Apple Silicon)](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_aarch64.dmg) [![macOS (Intel)](https://img.shields.io/badge/macOS-Intel-black?logo=apple)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_x64.dmg)

- **Linux:** [![Linux AppImage](https://img.shields.io/badge/Linux-AppImage-green?logo=linux)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_amd64.AppImage) [![Linux .deb](https://img.shields.io/badge/Linux-.deb-orange?logo=debian)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis_0.27.0_amd64.deb) [![Linux .rpm](https://img.shields.io/badge/Linux-.rpm-red?logo=redhat)](https://github.com/TabularisDB/tabularis/releases/download/v0.27.0/tabularis-0.27.0-1.x86_64.rpm)

The app UI is available in English, Italian, Spanish, Chinese (Simplified), French, German, Japanese, Russian, Korean, Tagalog and Portuguese (Brazilian).

> [!TIP]
> **Discord:** [Join our Discord server](https://discord.com/invite/K2hmhfHRSt) to talk with the maintainers, share feedback, and get help from the community.

## Table of Contents

- [Why tabularis?](#why-tabularis)
  - [Database support](#database-support)
- [Installation](#installation)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux (Snap)](#linux-snap)
  - [Linux (Flatpak)](#linux-flatpak)
  - [Linux (AppImage)](#linux-appimage)
  - [Arch Linux (AUR)](#arch-linux-aur)
- [Updates](#updates)
- [Discord](#discord)
- [Changelog](#changelog)
- [Features](#features)
  - [Connection Management](#connection-management)
  - [Database Explorer](#database-explorer)
  - [SQL Editor](#sql-editor)
  - [SQL Notebooks](#sql-notebooks)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Visual Query Builder](#visual-query-builder)
  - [Visual EXPLAIN](#visual-explain)
  - [Data Grid](#data-grid)
  - [Plugin System](#plugin-system)
  - [Logging](#logging)
  - [Configuration Storage](#configuration-storage)
  - [AI Features (Optional)](#ai-features-optional)
  - [MCP Server: AI Agent Integration](#mcp-server-ai-agent-integration)
- [Tech Stack](#tech-stack)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Sponsors and supporters](#sponsors-and-supporters)
- [Origin Story](#origin-story)
- [License](#license)

## Why tabularis?

|                                                                    |          **tabularis**           |           DBeaver CE           |     TablePlus      |   Beekeeper Studio    |
| ------------------------------------------------------------------ | :------------------------------: | :----------------------------: | :----------------: | :-------------------: |
| License                                                            |         Apache 2.0, free         | Apache 2.0, free (Pro is paid) |     Commercial     | GPLv3 (paid editions) |
| SQL notebooks (SQL + Markdown cells, cross-cell variables, charts) |                ✅                |               ❌               |         ❌         |          ❌           |
| Built-in MCP server for AI agents                                  |                ✅                |               ❌               |         ❌         |          ❌           |
| Plugins in **any language** (JSON-RPC over stdio)                  |                ✅                |      Java/Eclipse plugins      | JavaScript plugins |          ❌           |
| AI text-to-SQL with **local models** (Ollama)                      |                ✅                |    Cloud-based AI assistant    |         ❌         |          ❌           |
| Visual EXPLAIN with interactive plan graphs                        |                ✅                |               ✅               |         ❌         |          ❌           |
| Databases out of the box                                           | 3 built-in + 21 official plugins |              100+              |        20+         |          ~10          |

> [!NOTE]
> Comparison as of June 2026; features in other tools may have changed since. If you need dozens of drivers, use DBeaver. Tabularis focuses on doing a few databases well.

### Database support

PostgreSQL, MySQL/MariaDB and SQLite ship built in. Everything else is a plugin. The built-in PostgreSQL driver is deprecated in favour of the [PostgreSQL plugin](https://github.com/TabularisDB/tabularis-postgresql-plugin), which Tabularis installs automatically. Current coverage, mirroring the [driver & plugin coverage](https://tabularis.dev/#driver-coverage) on the website:

**Shipped**

| Database                 | Plugin                                                                                          | Database       | Plugin                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| ClickHouse               | [tabularis-clickhouse-plugin](https://github.com/TabularisDB/tabularis-clickhouse-plugin)       | LibSQL / Turso | [tabularis-libsql-plugin](https://github.com/TabularisDB/tabularis-libsql-plugin)               |
| Cloudflare D1            | [tabularis_cloudflare_d1_plugin](https://github.com/josejorge/tabularis_cloudflare_d1_plugin)   | MongoDB        | [tabularis-mongodb-plugin](https://github.com/danielnuld/tabularis-mongodb-plugin)              |
| Cloudflare D1 (HTTP API) | [cloudflare-tabularis](https://github.com/GabrielMalava/cloudflare-tabularis)                   | MongoDB Atlas  | [tabularis-mongodb-plugin](https://github.com/TabularisDB/tabularis-mongodb-plugin)             |
| DM / Dameng              | [tabularis-dameng-plugin](https://github.com/haos666/tabularis-dameng-plugin)                   | Oracle         | [tabularis-oracle-plugin](https://github.com/TabularisDB/tabularis-oracle-plugin)               |
| DuckDB                   | [tabularis-duckdb-plugin](https://github.com/TabularisDB/tabularis-duckdb-plugin)               | Redis (Go)     | [tabularis-redis-plugin-go](https://github.com/gzamboni/tabularis-redis-plugin-go)              |
| DynamoDB                 | [tabularis-dynamodb-plugin](https://github.com/TabularisDB/tabularis-dynamodb-plugin)           | Redis (Rust)   | [tabularis-redis-plugin](https://github.com/nicholas-papachriston/tabularis-redis-plugin)       |
| Elasticsearch            | [tabularis-elasticsearch-plugin](https://github.com/TabularisDB/tabularis-elasticsearch-plugin) | SQL Server     | [tabularis-sqlserver-plugin](https://github.com/TabularisDB/tabularis-sqlserver-plugin)         |
| Firestore                | [firestore-tabularis](https://codeberg.org/NewtTheWolf/firestore-tabularis)                     | CSV Folder     | [tabularis-csv-plugin](https://github.com/TabularisDB/tabularis-csv-plugin)                     |
| IBM Db2                  | [tabularis-db2-plugin](https://github.com/TabularisDB/tabularis-db2-plugin)                     | Google Sheets  | [tabularis-google-sheets-plugin](https://github.com/TabularisDB/tabularis-google-sheets-plugin) |
| IBM Informix             | [tabularis-informix-plugin](https://github.com/danielnuld/tabularis-informix-plugin)            | HackerNews     | [tabularis-hackernews-plugin](https://github.com/TabularisDB/tabularis-hackernews-plugin)       |

**On the bounty board**

| Status      | Databases                                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| Claimed     | Google BigQuery, Meilisearch                                                 |
| Scoped      | Amazon Redshift, CockroachDB, TiDB                                           |
| Coming soon | Snowflake                                                                    |
| Open        | Cassandra, Etcd, Firebird, ScyllaDB, SQL Anywhere, SurrealDB, Trino / Presto |

> [!NOTE]
> **Shipped** drivers are installable from the [plugin registry](https://tabularis.dev/plugins). Everything else is on the [bounty board](https://tabularis.dev/plugins/bounties): claim one, sponsor one, or [request a database](https://github.com/TabularisDB/tabularis/discussions).

## Installation

### Windows

**WinGet (Recommended)**

```bash
winget install Debba.Tabularis
```

**Direct Download**

Download the installer from the [Releases page](https://github.com/TabularisDB/tabularis/releases) and run it:

```
tabularis_x.x.x_x64-setup.exe
```

Follow the on-screen instructions to complete the installation.

### macOS

**Homebrew (Recommended)**

```bash
brew install --cask tabularis
```

[![Homebrew](https://img.shields.io/badge/Homebrew-Repository-orange?logo=homebrew)](https://github.com/debba/homebrew-tabularis)

**Direct Download**

Builds from **v0.13.1** onward are signed and notarized by Apple, so they open without any extra steps.

<details>
<summary>Notes for releases before v0.13.1</summary>

<br />

The notes below only apply to **older releases (before v0.13.1)** downloaded directly:

- You need to allow accessibility access (Privacy & Security) to the tabularis app. If you are upgrading and already have tabularis on the allowed list, remove it manually before accessibility access can be granted to the new version.
- You may need to run `xattr -c /Applications/tabularis.app` after copying the app to the Applications directory.

</details>

### Linux (Snap)

```bash
sudo snap install tabularis
sudo snap connect tabularis:password-manager-service   # allow keychain access for saved credentials
```

> [!IMPORTANT]
> The `password-manager-service` interface is not auto-connected by the Snap Store yet. Without it, saving a connection fails with a `Platform secure storage failure` error.

[![Snap Store](https://img.shields.io/badge/snap-tabularis-blue?logo=snapcraft)](https://snapcraft.io/tabularis)

### Linux (Flatpak)

```bash
flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo
flatpak install flatpark dev.tabularis.Tabularis
```

[![Flatpak (Flatpark)](https://img.shields.io/badge/flatpak-tabularis-4A90D9?logo=flatpak&logoColor=white)](https://flatpark.org/apps/dev.tabularis.Tabularis/)

### Linux (AppImage)

Download the `.AppImage` file from the [Releases page](https://github.com/TabularisDB/tabularis/releases), make it executable and run it:

```bash
chmod +x tabularis_x.x.x_amd64.AppImage
./tabularis_x.x.x_amd64.AppImage
```

### Arch Linux (AUR)

```bash
yay -S tabularis-bin
```

## Updates

Tabularis checks for updates automatically on startup and notifies you when a new version is available. You can also download the latest version directly from the [Releases page](https://github.com/TabularisDB/tabularis/releases).

## Discord

Join our [Discord server](https://discord.com/invite/K2hmhfHRSt) to talk with the maintainers, share feedback, suggest features, or get help from the community.

## Changelog

Every release is documented in [CHANGELOG.md](./CHANGELOG.md).

## Features

### Connection Management

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/connections)</sub>

- Support for **MySQL/MariaDB**, **PostgreSQL** (with multi-schema support) and **SQLite**, with multi-database selection per connection.
- Save, manage, and clone connection profiles, with optional secure password storage in the system **Keychain**.
- **SSH Tunneling** with automatic readiness detection.
- **Per-Connection Appearance:** override the icon ([Lucide](https://lucide.dev/icons/), emoji, or custom image) and accent color of each saved connection.

### Database Explorer

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/schema-management)</sub>

- **Tree View:** Browse tables, columns, keys, indexes, views, and stored routines, with inline editing from the sidebar.
- **ER Diagram:** Interactive Entity-Relationship visualization (pan, zoom, layout) with selective table diagram generation.
- **Context Actions:** Show data, count rows, modify schema, duplicate/delete tables.
- **SQL Dump & Import:** Export and restore databases with a single flow.

### SQL Editor

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/editor)</sub>

- **Monaco Editor** with syntax highlighting and auto-completion, in a tabbed interface with isolated connections per tab and resizable **split view**.
- **Multi-Statement Execution:** Run All, Run Selected, or pick individual queries. Results appear in separate tabs with independent pagination.
- **Smart Query Splitting:** Correctly handles stored procedures, functions, and `$$`-delimited blocks.
- **SQL Files:** Open, edit, and save `.sql`, `.psql`, and `.pgsql` files in editor tabs without executing them.
- **Saved Queries** and an **AI assist overlay** directly in the editor.

### SQL Notebooks

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/notebooks)</sub>

- **Multi-Cell Workspace:** Combine SQL and Markdown cells in a single document, with inline results and bar/line/pie charts.
- **Cross-Cell Variables:** Reference another cell's full result as a table with `{{cell_N}}` (expanded to a CTE at run time), plus global `@paramName` parameters.
- **Run All:** Sequential execution with stop-on-error option and completion summary.
- **Persistence & Export:** Auto-saved as `.tabularis-notebook` files; export as HTML, CSV, or JSON.
- Outline panel, drag & drop cell reordering, and AI-generated cell names.

### Keyboard Shortcuts

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/keyboard-shortcuts)</sub>

- **Built-in shortcuts** for navigation, editor, and data grid actions, platform-aware (`Cmd` on macOS, `Ctrl` on Windows/Linux).
- **Fully customizable:** Remap any non-locked shortcut from **Settings → Keyboard Shortcuts**; overrides persist to `keybindings.json`.
- Hold `Ctrl+Shift` in the sidebar to reveal numbered badges (1–9) for instant connection switching.

### Visual Query Builder

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/visual-query-builder)</sub>

- **Drag-and-Drop:** Build queries visually with ReactFlow.
- **Visual JOINs:** Connect tables to create relationships.
- **Advanced Logic:** WHERE/HAVING filters, aggregates (COUNT, SUM, AVG), sorting, and limits.
- **Real-time SQL:** Instant code generation.

### Visual EXPLAIN

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/visual-explain)</sub>

- **Interactive Plan Graphs:** Inspect execution plans as navigable node graphs instead of raw text.
- **Table, Raw, and AI Views:** Switch between exact node metrics, original database output, and optional AI-assisted analysis.
- **Cross-Database Support:** Works with PostgreSQL, MySQL/MariaDB, and SQLite using the best available `EXPLAIN` format per driver.
- **Faster Optimization Loops:** Spot expensive scans, estimate gaps, join behavior, and optimizer choices without leaving the editor.

### Data Grid

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/data-grid)</sub>

- **Inline & Batch Editing:** Modify cells and commit multiple changes at once; create, delete, and multi-select rows.
- **Export:** Save results as CSV or JSON, or copy selected rows straight to the clipboard.
- **JSON & JSONB Cells:** Syntax-highlighted in the grid, with a dedicated editor window (Tree / Monaco / Raw modes).
- **Spatial Data:** Initial GEOMETRY support for MySQL.

### Plugin System

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/plugins)</sub>

Tabularis is **hackable with an external plugin system**. Plugins are standalone executables that communicate with the app over **JSON-RPC 2.0 via stdin/stdout**, and can be written in any language.

- **Install Plugins:** Browse and install community drivers from **Settings → Available Plugins**, no restart required.
- **Manage Drivers:** View all registered drivers (built-in and plugins) in **Settings → Installed Drivers** and uninstall plugins with one click.
- **Any Database:** Add support for DuckDB, MongoDB, or any other database by writing or installing a plugin.
- **Plugin Registry:** Official plugins are listed in [`plugins/registry.json`](./plugins/registry.json).
- **Developer Guide:** See [`plugins/PLUGIN_GUIDE.md`](./plugins/PLUGIN_GUIDE.md) to build your own driver in any language.
- **Declarative themes (development):** **Settings → Appearance → Manage themes** supports local packages, previews and personal/VS Code imports without executable plugin activation. See the [theme author guide](./packages/create-plugin/THEMES.md) for the separate `tabularis-theme` CLI, packaging and release gates; public runtime/tooling rollout is not implied by this development feature.

### Logging

- Real-time log viewer in Settings, with level filtering and export to `.log` files.
- Automatically expand and inspect SQL queries in logs.
- **CLI Debug Mode:** Start with `tabularis --debug` for verbose logging from launch.

### Configuration Storage

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/configuration)</sub>

Configuration is stored in `~/.config/tabularis/` (Linux), `~/Library/Application Support/tabularis/` (macOS), or `%APPDATA%\tabularis\` (Windows): connection profiles, saved queries, app settings (`config.json`), custom themes, and per-connection editor preferences. You can move this folder from **Settings > Storage** (or with the `TABULARIS_DATA_DIR` environment variable), for example to an iCloud Drive or Dropbox folder to sync connections across machines; installed plugins always stay local. Tabs and queries are restored when you reopen a connection. The wiki covers the full file layout and every `config.json` option, including custom AI model overrides.

<details>
<summary>How Follow System works on Linux</summary>

<br />

On Linux, **Follow System** reads the XDG desktop settings portal's `org.freedesktop.appearance/color-scheme` preference and follows its live updates, including GNOME's dark-mode toggle with the standard Adwaita GTK theme. The resolved light/dark theme is applied explicitly to GTK window decorations and the webview. A portal value of `0` (no preference) resolves to light, so switching back to the desktop default cannot reuse the app's previously forced dark theme. If the portal is unavailable or returns an unsupported value, Tabularis falls back to the native window theme, then the browser media query. The default window capability grants `core:window:allow-set-theme` to allow native theme changes. macOS and Windows use native theme notifications. See [the portal specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html).

Portal command reads reuse one cached D-Bus connection, while the live watcher keeps its own connection. Failed reads discard the cached connection so the next request can reconnect; failed connection attempts are not cached. The existing two-second command timeout also bounds concurrent requests waiting for the cache.

</details>

### AI Features (Optional)

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/ai-assistant)</sub>

Optional Text-to-SQL and query explanation powered by **OpenAI**, **Anthropic**, **MiniMax**, **OpenRouter**, **Ollama** (local models, no API key, full privacy), and any **OpenAI-compatible API** (Groq, Perplexity, Azure OpenAI, LocalAI, ...). Model lists are fetched from your provider and cached locally; custom models can be configured per provider.

### MCP Server: AI Agent Integration

<sub>[Full reference on tabularis.dev →](https://tabularis.dev/wiki/mcp-server)</sub>

Tabularis includes a built-in **MCP (Model Context Protocol) server** that lets AI agents read your database schema and execute queries directly from their chat interface.

```bash
tabularis --mcp
```

**One-click setup** for Claude Desktop, Cursor, and Windsurf: open **Settings → MCP Server Integration**, click **Install Config** next to your client, and restart it. Manual configuration is covered in the wiki.

#### Available tools

Once connected, your AI agent can:

| Tool               | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `list_connections` | List all saved database connections                       |
| `list_databases`   | List all databases available for a connection             |
| `list_tables`      | List tables in a connection (with optional schema filter) |
| `describe_table`   | Get full schema: columns, indexes, foreign keys           |
| `run_query`        | Execute any SQL query and return results                  |

Every tool accepts an optional `output_format` argument. JSON is the default, preserving the existing response format for all clients. You can choose JSON or [TOON](https://toonformat.dev/) as the default under **Settings → MCP Server Integration**; a tool call's `output_format` argument overrides that preference. TOON is especially compact for tabular query results passed to an LLM. MCP transport remains JSON-RPC in either mode; only the text inside the tool result changes.

#### Example prompts

> "Show me all tables in my production database and describe the `orders` table"

> "Write and run a query to find the top 10 customers by total order value this month"

> "Check if there are any missing indexes on the `users` table"

## Tech Stack

| Layer    | Stack                                 |
| -------- | ------------------------------------- |
| Frontend | React 19, TypeScript, Tailwind CSS v4 |
| Backend  | Rust, Tauri v2, SQLx                  |

## Development

**Setup**

```bash
pnpm install
pnpm tauri dev
```

**Build**

```bash
pnpm tauri build
```

## Roadmap

- [x] [Plugin registry platform — OAuth publishing, release sync, download analytics](https://github.com/TabularisDB/tabularis/issues/196)
- [x] [SQL Server driver — implementation roadmap & call for contributors](https://github.com/TabularisDB/tabularis/issues/150)
- [x] [[Feat]: Allow loading of multiple Databases per connection](https://github.com/TabularisDB/tabularis/issues/47)
- [x] [Command Palette](https://github.com/TabularisDB/tabularis/issues/25)
- [x] [JSON/JSONB Editor & Viewer](https://github.com/TabularisDB/tabularis/issues/24)
- [x] [SQL Formatting / Prettier](https://github.com/TabularisDB/tabularis/issues/23)
- [x] [Visual Explain Analyze](https://github.com/TabularisDB/tabularis/issues/22)
- [x] [Plugin System](https://github.com/TabularisDB/tabularis/issues/19)
- [x] [Query History](https://github.com/TabularisDB/tabularis/issues/18)
- [ ] [UI design system & visual identity — call for contributors](https://github.com/TabularisDB/tabularis/issues/195)
- [ ] [Feature: Remote Control](https://github.com/TabularisDB/tabularis/issues/46)
- [ ] [Data Compare / Diff Tool](https://github.com/TabularisDB/tabularis/issues/21)
- [ ] [Team Collaboration](https://github.com/TabularisDB/tabularis/issues/20)
- [ ] [Better SQLite Support](https://github.com/TabularisDB/tabularis/issues/17)
- [ ] [Better PostgreSQL Support](https://github.com/TabularisDB/tabularis/issues/16)

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md). Good places to start:

- [UI design system & visual identity: call for contributors](https://github.com/TabularisDB/tabularis/issues/195)
- Write a driver plugin in any language with the [Plugin Guide](./plugins/PLUGIN_GUIDE.md)

<!-- SPONSORS:START -->

## Sponsors and supporters

- <a href="https://www.serversmtp.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/turbosmtp_compact.png" height="28" alt="turboSMTP" /></a> **[turboSMTP](https://www.serversmtp.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Professional SMTP relay — your emails delivered straight to the inbox, never to spam
- <a href="https://www.kilo.ai/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/kilocode_compact.png" height="28" alt="Kilo Code" /></a> **[Kilo Code](https://www.kilo.ai/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Open source AI coding agent — build, ship, and iterate faster with 500+ models
- <a href="https://openai.com/codex/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/openai_compact.png" height="28" alt="OpenAI" /></a> **[OpenAI](https://openai.com/codex/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Supporting Tabularis through the Codex for Open Source program.
- <a href="https://m.do.co/c/f6ab3d158275?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/digitalocean_compact.png" height="28" alt="DigitalOcean" /></a> **[DigitalOcean](https://m.do.co/c/f6ab3d158275?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Simple, predictable cloud infrastructure for developers and growing teams.
- <a href="https://vercel.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/vercel_compact.svg" height="28" alt="Vercel" /></a> **[Vercel](https://vercel.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — The platform for the modern web — ship, preview, and scale frontend apps with zero config.
- <a href="https://usero.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/usero_compact.png" height="28" alt="Usero" /></a> **[Usero](https://usero.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Feedback becomes code. Automatically.
- <a href="https://devglobe.app/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/devglobe_compact.png" height="28" alt="DevGlobe" /></a> **[DevGlobe](https://devglobe.app/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Connect your IDE, show up on the globe, and showcase your projects to a community of builders.
- <a href="https://tolgee.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/tolgee_compact.svg" height="28" alt="Tolgee" /></a> **[Tolgee](https://tolgee.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Open-source localization platform — translate your app in context, without the spreadsheet chaos.
- <a href="https://1password.com/developers?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/1password_compact.png" height="28" alt="1Password" /></a> **[1Password](https://1password.com/developers?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — The password and secrets manager developers trust — free for open-source projects.
- <a href="https://www.jetbrains.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/jetbrains_compact.png" height="28" alt="JetBrains" /></a> **[JetBrains](https://www.jetbrains.com/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Professional developer tools — IntelliJ IDEA, WebStorm, DataGrip and the rest of the All Products Pack.
- <a href="https://signpath.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor" target="_blank"><img src="https://tabularis.dev/img/logos/sponsors/signpath_compact.png" height="28" alt="SignPath" /></a> **[SignPath](https://signpath.io/?utm_source=tabularis&utm_medium=referral&utm_campaign=sponsor)** — Code signing for open source — signed Windows releases without the certificate bill.

_[Become a sponsor →](https://tabularis.dev/sponsors)_

<!-- SPONSORS:END -->

## Origin Story

Tabularis started as an experiment: how far could AI-assisted development get in building a working tool from scratch? Further than expected: it's now an actively maintained project with regular releases and a plugin ecosystem.

## License

[Apache License 2.0](./LICENSE)

---

<p align="center">
  Like tabularis? <a href="https://github.com/TabularisDB/tabularis">Star the repo</a> ⭐, it helps the project a lot.
</p>

<p align="center">
  <a href="https://repostars.dev/?repos=TabularisDB%2Ftabularis&theme=dark">
    <img src="https://repostars.dev/api/embed?repo=TabularisDB%2Ftabularis&theme=dark" alt="RepoStars" />
  </a>
</p>
