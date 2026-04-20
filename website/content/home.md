# Why Tabularis

Tabularis started from a simple frustration: too many database clients make routine work feel heavier than it should.

**Tabularis** is an open-source desktop database client. It gives you one fast workspace for everyday SQL work without locking you into a single engine or a bloated UI.

It supports **PostgreSQL**, **MySQL/MariaDB**, and **SQLite** out of the box, and it is **hackable with plugins** when your workflow needs more. Query data, inspect schemas, manage connections, and document analysis without constantly switching tools.

# Capabilities

### 🔌 Multi-Database
Use **PostgreSQL** (with multi-schema support), **MySQL/MariaDB**, and **SQLite** from one consistent interface. Save connection profiles locally and switch contexts quickly.

### 🤖 AI Assistance (Experimental)
Draft SQL from natural language, explain unfamiliar queries, and iterate faster with AI help. Supports OpenAI, Anthropic, OpenRouter, and **Ollama** for local models.

### 🔌 MCP Server
Built-in **Model Context Protocol** support lets compatible AI agents inspect your schemas and work through Tabularis as the database bridge.

### 🎨 Visual Query Builder
Assemble joins, filters, and aggregations visually, then inspect the SQL that gets generated. Useful for exploration and for validating query structure before editing by hand.

### 🧠 Visual EXPLAIN
Turn execution plans into interactive graphs, exact node tables, raw output, and optional AI analysis. Useful for spotting costly scans, estimate gaps, and optimizer choices faster.

### ⌨️ Keyboard Shortcuts & Custom Bindings

Built-in shortcuts cover navigation, the SQL editor, and the data grid. Remap combinations from **Settings → Keyboard Shortcuts**, reset them in one click, or edit `keybindings.json` directly.

### 🔒 SSH Tunneling & Security
Reach remote databases through SSH tunnels directly from the connection manager. Passwords and API keys are stored securely in your system keychain.

### 📝 Modern SQL Editor
Monaco-powered SQL editing with syntax highlighting, multiple tabs, and precise execution controls for selected text or full scripts.

### 📓 SQL Notebooks
Reusable multi-cell workspaces that combine **SQL** and **Markdown**. Keep inline results, simple charts, shared variables, notebook parameters, and repeatable analysis together.

### 🪟 Split View
Open **multiple connections simultaneously** in a resizable split layout and compare queries or data across databases side by side.

### 📋 Clipboard Import
Paste a spreadsheet range, CSV, JSON array, or Markdown table directly into a database table. Tabularis detects the format, infers column types, and lets you review the schema — no SQL required.

### 🗄️ Schema Management
Edit table and column properties inline, then use guided dialogs to create tables, modify columns, and manage indexes or foreign keys.

# Plugins

Tabularis is **hackable with an external plugin system**. Plugins are standalone executables that communicate with the app over **JSON-RPC 2.0 via stdin/stdout**, so database support can evolve independently from the core release cycle.

### 🧩 Language-Agnostic
Write a driver in Rust, Go, Python, Node.js, or any language that can speak JSON-RPC over stdin/stdout. No heavyweight SDK required.

### ⚡ Hot Install
Install, update, and remove plugins from **Settings → Plugins** without restarting the app. New drivers appear immediately in the connection form.

### 🔒 Process Isolation
Each plugin runs in its own process. If a plugin crashes, the failure is isolated to that integration instead of taking down the whole app.

# Themes

Themes are part of the product experience, not an afterthought. Switch instantly between **10+ presets** without restarting, with syntax highlighting generated to stay coherent with the active UI theme.

# Installation

### Windows — WinGet

[![WinGet](https://img.shields.io/winget/v/Debba.Tabularis?label=WinGet&logo=windows&color=0078D4)](https://winstall.app/apps/Debba.Tabularis)

```bash
winget install Debba.Tabularis
```

### macOS — Homebrew

```bash
brew tap debba/tabularis
brew install --cask tabularis
```

If macOS blocks the app after a direct `.dmg` install, run:

```bash
xattr -c /Applications/tabularis.app
```

### Linux — Snap

```bash
sudo snap install tabularis
```

### Linux — Arch (AUR)

```bash
yay -S tabularis-bin
```

### Build from Source

Requires Node.js and Rust installed on your machine.

```bash
git clone https://github.com/debba/tabularis.git
cd tabularis
pnpm install
pnpm tauri build
```
