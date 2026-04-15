---
category: "Getting Started"
title: "Introduction"
order: 1
excerpt: "Welcome to the Tabularis Wiki. Learn how to get started with the most modern database management tool."
---

# Introduction

**Tabularis** is a desktop database management tool built with **Tauri** (Rust backend) and **React** (frontend). It natively supports PostgreSQL, MySQL, MariaDB, and SQLite, and can be extended to any other database engine via its JSON-RPC plugin system.

## What Tabularis Actually Does

- **Connects** to PostgreSQL, MySQL, MariaDB, and SQLite — including databases behind SSH tunnels.
- **Browses** schemas, tables, views, indexes, foreign keys, and stored procedures/functions.
- **Runs SQL** in a Monaco-based editor with live autocomplete on real table/column names, with multi-statement execution and multi-result tabs.
- **Notebooks** — interactive multi-cell workspaces combining SQL, Markdown, charts, and cross-cell variables.
- **Edits data** inline in a virtualized data grid with pending change tracking.
- **Builds queries visually** with a drag-and-drop canvas that generates SQL in real time.
- **Generates ER diagrams** from your live schema using the Dagre layout engine.
- **Manages schema** — creates tables, alters columns, adds indexes and foreign keys — with a DDL preview before applying.
- **Generates AI SQL** from natural language using OpenAI, Anthropic, OpenRouter, Ollama, or any OpenAI-compatible endpoint.
- **Exports** query results to CSV or JSON (streamed, cancellable).
- **Dumps and imports** databases to/from `.sql` files, with progress tracking and cancellation support.
- **Extends** via plugins: any executable that speaks JSON-RPC over stdin/stdout becomes a new database driver.
- **Runs as an MCP server** so external AI agents (Claude Desktop, Cursor) can query your local databases.

## System Requirements

| Platform | Minimum | Notes |
| :--- | :--- | :--- |
| **macOS** | 10.15+ | Universal Binary (Intel + Apple Silicon) |
| **Windows** | 10/11 | WebView2 required (pre-installed with Edge) |
| **Linux** | Ubuntu 20.04+ | Requires `webkit2gtk-4.1` and `libsecret-1` |

### Linux dependency install

```bash
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libsecret-1-dev

# Arch
sudo pacman -S webkit2gtk libsecret

# Fedora
sudo dnf install webkit2gtk4.1-devel libsecret-devel
```

## Quick Start

### 1. Install

Download the right package from [GitHub Releases](https://github.com/debba/tabularis/releases):
- macOS → `.dmg`
- Windows → `.msi` or `.exe`
- Linux → `.AppImage`, `.deb`, or `.rpm`

### 2. Create a connection

Click `+` in the sidebar (or `Cmd/Ctrl + Shift + N`). Fill in host, port, database, and credentials. If the database is in a private network, enable the SSH tunnel in the SSH tab. Click **Test** to verify before saving. The password is stored in the OS keychain — never in a file.

### 3. Start working

Once connected, the sidebar shows all schemas, tables, views, and routines. Double-click a table to open it in the data grid. Press `Cmd/Ctrl + T` for a new SQL editor tab.

## Interface Overview

The UI has three fixed regions:

1. **Left sidebar** — a two-level navigation area: the narrow primary rail for app sections and open connections, plus the Explorer panel for the active connection. The Explorer is split into **Structure**, **Favorites**, and **History** tabs, so schema browsing, saved queries, and past executions are separated instead of mixed into one long tree. Collapse/expand it with `Cmd/Ctrl + B`.
2. **Tab bar** — each open table or SQL editor is a tab, color-coded by connection.
3. **Main canvas** — shows the active view: data grid, SQL editor, query builder, ER diagram, or schema editor.

## Global Keyboard Shortcuts

| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| Execute query | `Cmd + F5` | `Ctrl + F5` |
| Execute query (in editor) | `Cmd + Enter` | `Ctrl + Enter` |
| Tab switcher | `Ctrl + Tab` | `Ctrl + Tab` |
| Monaco command palette | `F1` | `F1` |

## Local Data Storage

Tabularis stores all data locally. Nothing is sent to external servers except:
- Your chosen database host (the actual connections you make).
- GitHub API (`api.github.com`) for update checks, if enabled.
- Your configured AI provider endpoint, only when you explicitly trigger an AI feature.

| Data type | Location |
| :--- | :--- |
| App config (`config.json`) | `~/Library/Application Support/tabularis/` (macOS) |
| Connection metadata | Same directory, `connections.json` |
| Query history | Same directory, `query_history/<connection-id>.json` |
| SSH profiles | Same directory, `ssh_connections.json` |
| Saved queries | Same directory, per-connection `.sql` files |
| Passwords / API keys | OS keychain only |
| Logs | `~/Library/Logs/tabularis/` (macOS) |

See [Configuration](/wiki/configuration) for platform-specific paths.
