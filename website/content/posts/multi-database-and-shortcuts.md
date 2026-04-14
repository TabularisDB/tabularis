---
title: "Multi-Database, Shortcuts, and a Cleaner Grid: v0.9.4"
date: "2026-03-02T21:33:00"
release: "v0.9.4"
tags: ["release", "mysql", "databases", "keybindings", "ux", "bugfix"]
excerpt: "v0.9.4 brings a full multi-database sidebar for MySQL, a persistent keyboard shortcuts system with visual hints, a redesigned Connections UI, and several targeted bug fixes."
og:
  title: "Multi-Database,"
  accent: "v0.9.4."
  claim: "Navigate multiple databases from a single connection, drive everything from the keyboard, and trust the data grid again."
  image: "/img/overview.png"
---

# Multi-Database, Shortcuts, and a Cleaner Grid: v0.9.4

Three weeks into public development and the daily-driver quality bar keeps moving. **v0.9.4** lands the biggest structural change yet to the sidebar: full multi-database support scoped per panel, a keyboard shortcut system you can actually customize, and a round of fixes that close long-standing data-grid and blob edge cases.

---

## Multi-Database: One Connection, Every Database

The headline feature of v0.9.4 is the new multi-database sidebar — and it changes how Tabularis fits into a real MySQL workflow.

### Why it Matters

MySQL and MariaDB let a single TCP connection read and write across every database on the server. Before v0.9.4, Tabularis didn't reflect that: one connection could only show one database at a time. If you worked across `users_db`, `orders_db`, and `analytics_db`, you needed three separate connections and navigated between them with context switching.

That's gone now.

### The Sidebar Experience

When you create or edit a MySQL (or MariaDB-compatible) connection, a new **Databases** tab appears alongside General and SSH. Click **Load Databases** to fetch everything your user can see, then check the ones you want attached to this connection. A filter box handles the common case of dozens of databases. **Select All** and **Deselect All** buttons cover bulk operations.

Selected databases are saved with the connection. On the next open, Tabularis reconnects to the primary database and lazily loads each database's table list as you expand it — so startup stays fast even when many databases are attached.

Each selected database gets its own collapsible node in the Explorer sidebar — exactly like PostgreSQL schemas. Expand a node to see tables and views. Double-click a table to open it in the editor.

The cross-database resolution is completely transparent: you write queries normally, without prefixing table names with a database identifier. Tabularis resolves the correct database based on which node you opened the table from, adding the fully-qualified `database_name.table_name` reference under the hood only when MySQL requires it.

### APIs Scoped Per Panel

The underlying change is deeper than the UI. **Database APIs are now scoped per panel** — each split view panel tracks its own active connection and database. When you query a table from `analytics_db` in the left panel and edit rows in `users_db` in the right panel, there's no bleed between them. This was a prerequisite for making multi-database work correctly across Tabularis's split-view layout.

The connection name is also now displayed in each panel header, so you always know which database you're looking at without having to open the sidebar.

### Branded Driver Icons

Every built-in driver now renders with its official brand icon and color: the PostgreSQL elephant in blue, the MySQL dolphin in orange, the SQLite cylinder in its characteristic teal. Plugin-provided drivers continue to use a generic icon or whatever they declare in their manifest. The icon system uses the same metadata that drives the Connections grid view introduced in the redesign — so the branding is consistent everywhere the driver appears.

### Backward Compatibility

If you have existing connections with a single database string, nothing changes. The connection format accepts both a string (`"mydb"`) and an array (`["db1", "db2"]`); both paths are handled transparently. File-based drivers (SQLite, DuckDB) and PostgreSQL (which uses schemas rather than database-level switching) are unaffected.

:::newsletter:::

---

## Keyboard Shortcuts: Persistent, Customizable, Visible

v0.9.4 ships a complete keyboard shortcut system — with persistence, display hints, and a settings tab to manage everything.

### What's Available

| Category | Action | macOS | Windows / Linux |
| :--- | :--- | :--- | :--- |
| Navigation | Toggle sidebar | `⌘+B` | `Ctrl+B` |
| Navigation | Open Connections page | `⌘+Shift+C` | `Ctrl+Shift+C` |
| Navigation | New connection modal | `⌘+Shift+N` | `Ctrl+Shift+N` |
| Navigation | Switch to Nth connection | `⌘+Shift+1–9` | `Ctrl+Shift+1–9` |
| Editor | Run query | `⌘+F5` | `Ctrl+F5` |
| Editor | New console tab | `⌘+T` | `Ctrl+T` |
| Data Grid | Next page | `⌘+→` | `Ctrl+→` |
| Data Grid | Previous page | `⌘+←` | `Ctrl+←` |

### Hint Labels in the UI

Every button and menu item that has a bound shortcut now shows the key combination next to it — the same behavior you expect from native desktop apps. Display keys are normalized per platform: `⌘` on macOS, `Ctrl` on Windows/Linux, with special keys rendered as symbols (`←`, `→`, `↑`, `↓`, `⎵`, `⌫`).

### Customization and Persistence

Open **Settings → Keyboard Shortcuts** to see the full table. Rows with a lock icon are system bindings (Monaco editor, OS-level) that can't be reassigned. Everything else shows an **Edit** button.

Click Edit, press your new combination, and it saves immediately. Overrides are written to `keybindings.json` in your OS config directory and survive restarts:

| Platform | Path |
| :--- | :--- |
| macOS | `~/Library/Application Support/tabularis/keybindings.json` |
| Linux | `~/.config/tabularis/keybindings.json` |
| Windows | `%APPDATA%\tabularis\keybindings.json` |

To reset a customized shortcut to its default, click the **↺** button on its row. The file is only created when you make your first override — unmodified installations stay clean.

---

## Redesigned Connections UI

The Connections page has been rebuilt with i18n support across all labels and a tighter visual hierarchy. Two display modes — **grid** and **list** — are switchable from the toolbar. Grid mode shows each connection as a card with driver icon, status badge, host info, and an SSH indicator. List mode lays the same data in compact rows.

A real-time search bar filters by connection name or host, with a clear button that appears only when there's text to dismiss.

---

## Bug Fixes

### Blob: Small UTF-8 Varbinary Values Rendered as Text

MySQL `VARBINARY` columns storing short UTF-8 strings (think slugs, tokens, identifiers) were previously shown as a hex/binary blob preview. v0.9.4 adds a heuristic: if the value is small enough and validates as valid UTF-8, it's rendered as plain text. Larger binary payloads and non-UTF-8 sequences still go through the blob preview path.

### DataGrid: Pending Changes Reflected in Sidebar Row Data

When you edited a row in the data grid, the sidebar row counter and summary panel weren't reflecting the unsaved state — they continued showing the original values until you committed or discarded. The fix ensures pending mutations flow through to the sidebar's row data in real time, so the "rows modified" indicator is always accurate.

---

:::contributors:::

## What's Next

Multi-database support opens the door to **cross-database autocomplete** in the SQL editor and **ER diagrams spanning multiple databases on the same server**. Both are on the roadmap for the next releases.

The keyboard shortcut system will expand to cover more actions — including data grid operations and sidebar context menus — as the binding infrastructure matures.

---

_v0.9.4 is available now. Update via the in-app updater, or download the latest release from the releases page._
