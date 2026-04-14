---
title: "Build Your Own Driver: Tabularis Gets a Plugin System"
date: "2026-02-23T12:00:00"
release: "v0.9.0"
tags: ["plugins", "extensibility", "architecture", "open-source"]
excerpt: "Supporting every database in the world is an impossible task for a small team. So we built a plugin system that lets anyone add a new database driver — in any language."
og:
  title: "Build Your Own Driver:"
  accent: "Plugin System."
  claim: "Supporting every database with a flexible, language-agnostic plugin architecture."
  image: "/img/tabularis-plugin-manager.png"
---

# Build Your Own Driver: Tabularis Gets a Plugin System

PostgreSQL, MySQL, SQLite — those three cover most use cases. But developers live in a world of DuckDB, CockroachDB, ClickHouse, Turso, and a dozen others. Supporting every database in the world is an impossible task for a small team. **v0.9.0** changes that.

## The Problem

Before this release, every new database engine meant a Rust patch to the core app. That's a steep barrier — for us and for contributors. Meanwhile, users kept asking: "Will you add DuckDB support?" "What about ClickHouse?" The queue was growing, and the surface area of the app with it.

## The Solution: JSON-RPC over stdin/stdout

We took inspiration from tools like the Language Server Protocol: define a simple, language-agnostic protocol and let the community implement drivers independently.

In Tabularis v0.9.0, a plugin is just **a process** that speaks JSON-RPC 2.0 over stdin/stdout. Install it, register it in Settings → Plugins, and it appears immediately in the connection form — no restart required.

```json
{
  "jsonrpc": "2.0",
  "method": "connect",
  "params": { "connection_string": "duckdb:///data/analytics.db" },
  "id": 1
}
```

The host app handles the UI, tab management, and data grid. The plugin handles the actual database calls. They talk through a pipe.

## Process Isolation

Each plugin runs as a separate OS process. If it crashes, only the affected connection fails — the rest of the app keeps running. This is a key safety property that lets us trust community plugins without auditing every line.

## Hot Install

No restart required. Open Settings → Plugins, paste a GitHub URL or a local path, and the driver registers immediately. New connection types appear in the form without touching the app binary.

:::newsletter:::

## The First Plugin: DuckDB

We shipped the plugin system alongside a reference implementation: [tabularis-duckdb-plugin](https://github.com/debba/tabularis-duckdb-plugin). DuckDB is an in-process OLAP engine — fast, file-based, no server required. Perfect for analytics on local datasets.

Install it from Settings → Plugins, point it at your `.db` file, and you have full DuckDB support in under a minute.

:::contributors:::

## What's Next

The [plugin guide](https://github.com/debba/tabularis/blob/main/plugins/PLUGIN_GUIDE.md) covers the full JSON-RPC protocol, manifest format, data types, and includes a Rust skeleton to get you started. Build a driver for your database, list it in the registry, and Tabularis users can discover it without waiting for an official release.

The database ecosystem is too large for any one team. Let's build it together.

---

![Plugin Manager in Tabularis v0.9.0](../img/tabularis-plugin-manager.png)
*Plugin Manager — install and manage drivers from Settings without restarting the app.*
