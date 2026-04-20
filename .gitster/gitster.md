# Tabularis

## What is Tabularis?

Tabularis is a lightweight, developer-focused database client built with Tauri, Rust, and React. It delivers a fast, native desktop experience for connecting, exploring, querying, and managing databases — with no cloud, no sign-up, and no telemetry. Hackable through a plugin system, with notebooks, AI, and MCP built in.

## Key Features

### 🔌 Multi-Database Support

- Native drivers for **PostgreSQL** (multi-schema), **MySQL / MariaDB** (multi-database selection), and **SQLite**
- Connection profiles with secure local storage; passwords kept in the OS keychain
- Read-only mode to protect production databases at the application layer
- Connection groups and grid/list views on the connections page
- Optional MySQL SSL configuration

### 🔒 SSH Tunneling

- Rust-native tunneling with two automatic backends: **russh** (password auth) and **system SSH** (key-based, honours `~/.ssh/config`)
- Dynamic ephemeral port assignment and automatic readiness detection
- Reusable SSH profiles shared across connections; ProxyJump / multi-hop supported

### ✍️ SQL Editor

- Monaco-based editor with syntax highlighting, autocomplete, and tabbed interface
- Run All, Run Selected, or pick individual statements — results land in independent tabs
- Smart splitting (via `dbgate-query-splitter`) handles stored procedures and `$$`-delimited blocks
- Saved queries, clipboard paste into multi-cursor, floating AI-assist overlay

### 📓 SQL Notebooks

- Mixed SQL + Markdown cells, inline results, and bar/line/pie charts
- Cross-cell variables via `{{cellName.columnName}}` and global `{{$paramName}}` notebook parameters
- Run All with stop-on-error, drag-and-drop reorder, AI-generated cell names
- Auto-save as `.tabularis-notebook`; export to HTML, CSV, or JSON

### 🎨 Visual Query Builder

- Drag-and-drop canvas with ReactFlow — connect columns to define JOINs visually
- Filters, sorting, limits, and aggregate functions (COUNT, SUM, AVG…) without writing SQL
- Live SQL preview; export to the editor

### 🔬 Visual EXPLAIN

- Interactive plan graphs for PostgreSQL, MySQL/MariaDB, and SQLite
- Table, raw, and optional AI-assisted views for spotting expensive scans and join issues

### 📊 Data Grid

- Virtualised grid for large result sets with inline and batch editing
- Row creation, deletion, and multi-row clipboard copy
- One-click export to CSV or JSON; initial spatial (GEOMETRY) support for MySQL

### 🗄️ Schema Management

- Inline editing of table and column properties from the sidebar
- GUI wizards for tables, columns, indexes, and foreign keys
- Interactive **ER Diagram** with pan, zoom, auto-layout, and selective generation
- Views and stored routines browser with full metadata

### 🕘 Query History

- Per-connection history with deduplication, search, and error styling
- Re-run any past query; database context preserved

### 🤖 AI Assistant (Experimental)

- Natural-language to SQL, query explanations, and "Explain selection" modal
- Providers: **OpenAI**, **Anthropic**, **MiniMax**, **OpenRouter**, **Ollama** (fully local), and any **OpenAI-compatible API** (Groq, Perplexity, Azure, LocalAI…)
- Dynamic model fetching with 24h cache; context-aware (sends schema only, never raw data)

### 🧠 MCP Server

- Built-in **Model Context Protocol** server — expose schemas and run queries from Claude Desktop, Cursor, Windsurf, or any MCP agent
- One-click setup wizard writes a ready-to-use config; also launchable via `tabularis --mcp`

### 📦 SQL Dump, Import & Clipboard

- Export full or schema-level dumps to `.sql` with table selection
- Re-import `.sql` files with progress tracking and cancellation; streaming write for large databases
- Clipboard import flow for pasting tabular data directly into tables

### 🪟 Split View

- Open multiple connections side-by-side in resizable panes
- Each pane keeps its own editor, data grid, and connection state

### 📈 Task Manager

- Real-time CPU, RAM, and disk usage for Tabularis and plugin processes
- Child process tree inspection; force-kill or restart any plugin

### 🎨 Themes

- 10+ built-in themes (Dracula, Nord, Monokai, Solarized, One Dark Pro…)
- Syntax highlighting auto-generated from the active UI theme; switch without restarting

### ⌨️ Keyboard Shortcuts

- Fully customisable, platform-aware shortcuts (`Cmd` on macOS, `Ctrl` elsewhere)
- Visual hints in the sidebar and persistent overrides in `keybindings.json`

### 🌍 Internationalisation

- Available in **English**, **Italian**, **Spanish**, **Chinese (Simplified)**, **French**, and **German**
- Automatic language detection with manual override

### 🔄 Seamless Updates

- Startup check against GitHub Releases with one-click install
- Package-manager-aware reminders for AUR, Snap, Homebrew, and winget installs

### 🧩 Plugin System

- Hackable via external plugins — standalone executables speaking **JSON-RPC 2.0** over stdin/stdout, in any language
- Install community drivers from the registry with one click; per-plugin settings UI
- Plugins run in isolated processes, monitored by the Task Manager

## Supported Databases

| Database | Support |
|---|---|
| MySQL / MariaDB | Full (multi-database, SSL) |
| PostgreSQL | Full (multi-schema) |
| SQLite | Full |
| Additional drivers | Via plugins (DuckDB, IBM Db2, Redis, ClickHouse, and more) |

## Available On

- **macOS** — Universal Binary (Intel + Apple Silicon); Homebrew cask (`brew install --cask tabularis` after tapping `TabularisDB/tabularis`)
- **Windows** — 64-bit installer; WinGet (`winget install Debba.Tabularis`)
- **Linux** — AppImage, `.deb`, `.rpm`, Snap, AUR (`tabularis-bin`)

## Links

- **Website:** [tabularis.dev](https://tabularis.dev)
- **Download:** [GitHub Releases](https://github.com/TabularisDB/tabularis/releases)
- **Wiki:** [tabularis.dev/wiki](https://tabularis.dev/wiki)
- **Community:** [Discord Server](https://discord.gg/YrZPHAwMSG)
- **Source Code:** [GitHub Repository](https://github.com/TabularisDB/tabularis)
