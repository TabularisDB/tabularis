---
title: "Connection String Import, Visual Query Builder Fix, and More: v0.9.8"
date: "2026-03-12T12:00:00"
release: "v0.9.8"
tags: ["release", "connections", "plugins", "ux", "bugfix"]
excerpt: "v0.9.8 introduces connection string import for network drivers, fixes drag-and-drop in the Visual Query Builder on Windows, and resolves an SQLite open failure on Windows."
og:
  title: "Connection String Import,"
  accent: "v0.9.8."
  claim: "Import connections from a URL string, improved Windows compatibility, and new plugin capability flags."
  image: "/img/tabularis-task-manager.png"
---

# Connection String Import, Visual Query Builder Fix, and More: v0.9.8

**v0.9.8** is a focused release that brings a highly requested quality-of-life feature — paste a connection URL and have the form filled in for you — along with two important Windows compatibility fixes and new plugin capability flags for connection string support.

---

## Connection String Import

<img src="/img/posts/connection-string-import.png" alt="New Connection modal showing the connection string import field" style="width:100%;border-radius:8px;margin:1rem 0" />

Network-based drivers (PostgreSQL, MySQL, and compatible plugins) now show a **"Import from connection string"** section in the new connection modal. Paste a URL like:

```
postgres://alice:secret@db.example.com:5432/myapp
mysql://root@127.0.0.1:3306/dev
```

and Tabularis parses it instantly — host, port, username, password, and database name are all populated into the form. You can then tweak individual fields before saving.

The parser is fully tested and handles edge cases: URL-encoded credentials, missing ports (falling back to the driver's default), and optional database segments.

### Plugin support for connection string import

Plugins can now declare whether they support connection string import via two new optional capability flags in `manifest.json`:

| Flag | Type | Description |
|------|------|-------------|
| `connection_string` | bool | Set `false` to hide the import UI for this driver. Defaults to `true` for network drivers. File-based and folder-based drivers skip it automatically. |
| `connection_string_example` | string | Placeholder example shown in the import field, e.g. `"clickhouse://user:pass@host:9000/db"`. |

Both flags also accept their camelCase equivalents (`connectionString`, `connectionStringExample`) for plugin compatibility.

:::newsletter:::

Example for a ClickHouse plugin:

```json
{
  "capabilities": {
    "schemas": true,
    "views": true,
    "routines": false,
    "file_based": false,
    "folder_based": false,
    "connection_string": true,
    "connection_string_example": "clickhouse://user:pass@localhost:9000/default",
    "identifier_quote": "\"",
    "alter_primary_key": false
  }
}
```

---

## Bug Fixes

### Visual Query Builder: Drag-and-Drop on Windows

The Visual Query Builder's table drag-and-drop was broken when running inside WebView2 (the browser engine used by Tauri on Windows). The HTML5 `dragstart`/`drop` API is not fully supported by WebView2, causing tables dragged from the sidebar to be silently ignored.

The fix replaces the HTML5 drag API with **pointer events** (`pointerdown`, `pointermove`, `pointerup`), which work consistently across all platforms including WebView2.

### SQLite: SQLITE_CANTOPEN (Error Code 14) on Windows

Opening an SQLite database on Windows could fail with error code 14 (`SQLITE_CANTOPEN`) in certain path configurations. The root cause was constructing the connection URL by string-formatting the file path — on Windows, backslash-separated paths embedded in a `sqlite://` URL are not valid.

The fix switches to `SqliteConnectOptions::new().filename(&path)` instead of parsing a URL string, which correctly handles Windows paths including those with spaces or backslashes.

---

## Summary

| Area | What's new |
|------|-----------|
| Connections | Connection string import for PostgreSQL, MySQL, and compatible plugins |
| Plugins | `connection_string` and `connection_string_example` capability flags |
| Visual Query Builder | Drag-and-drop fixed for WebView2 / Windows |
| Bug fixes | SQLite CANTOPEN on Windows, new connection modal tab reset on close |

---

:::contributors:::

---

_v0.9.8 is available now. Update via the in-app updater, or download from the [releases page](https://github.com/debba/tabularis/releases/tag/v0.9.8)._
