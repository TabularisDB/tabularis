---
title: "Tabularis Goes NoSQL: Redis Ships, MongoDB and ClickHouse Need You"
date: "2026-03-07T12:00:00"
tags: ["nosql", "plugins", "community", "redis", "open-source", "extensibility"]
excerpt: "The plugin ecosystem is growing beyond SQL. Two Redis drivers have already shipped thanks to community contributors. Now we need experts to push DuckDB, MongoDB, and ClickHouse across the finish line."
og:
  title: "Tabularis Goes NoSQL:"
  accent: "Redis Ships, More Coming."
  claim: "Two Redis drivers shipped by the community. DuckDB, MongoDB, and ClickHouse need your expertise."
  image: "/img/tabularis-plugin-manager.png"
---

# Tabularis Goes NoSQL: Redis Ships, MongoDB and ClickHouse Need You

When I shipped the plugin system in v0.9.0, the promise was simple: you should not need to wait for us to support your database. Build a driver, list it in the registry, and Tabularis users can use it today. That promise is being kept — and the NoSQL world is where the community has moved fastest.

## Redis: Two Independent Drivers, Both Excellent

Redis is the first NoSQL database to land in the official plugin registry, and it arrived not once but **twice** — two independent implementations from two different contributors, each with a distinct design philosophy.

### Redis (Go)

The first Redis driver comes from [@gzamboni](https://github.com/gzamboni) and is written in Go. It models Redis as a set of **virtual tables**: Strings, Hashes, Lists, Sets, and ZSets each get their own tab in the Tabularis data grid. Write operations — SET, HSET, LPUSH, and the rest — are available directly from the UI without dropping to a terminal. If your team uses Redis as a primary data store and you want a visual interface for daily operations, this is the driver to reach for.

:::plugin redis:::

### Redis (Rust)

The second implementation comes from [@nicholas-papachriston](https://github.com/nicholas-papachriston) and takes a different approach. Written in Rust, it focuses on **Hash and RedisJSON row storage** — treating Redis keys as structured records rather than raw key-value pairs. If you store JSON documents in Redis and want to query and browse them like rows in a table, this driver fits more naturally.

:::plugin redis-rust:::

Two drivers for the same database is not redundancy — it is a sign that the plugin system is working as intended. Different use cases, different mental models, different implementations. Users can pick the one that matches how they use Redis.

## The Next Frontier: DuckDB, MongoDB, and ClickHouse

Redis proved the model. Now the ecosystem needs to grow into the rest of the NoSQL and analytical space. Three databases are in active development, and all three could use experienced contributors.

### DuckDB

DuckDB is the reference plugin — the first one we ever shipped — but being first does not mean it is finished. The current driver covers the basics: open a local `.db` file, run queries, browse results. What it does not yet handle well: **in-memory databases**, **Parquet and Arrow file sources** passed directly as connection targets, deeper **type fidelity** for DuckDB-native types like `HUGEINT`, `MAP`, and `UNION`, and **ATTACH/DETACH** multi-database workflows. If you know DuckDB internals and want to make the Tabularis integration best-in-class, the codebase is a Rust project with a clean JSON-RPC interface.

:::plugin duckdb:::

### MongoDB

MongoDB is the most-requested NoSQL database on the issue tracker. A driver is in development but has not yet reached a releasable state. The core challenge is the impedance mismatch: MongoDB documents are schema-less and deeply nested, while Tabularis renders data in a tabular grid. Solving this well — flattening documents intelligently, handling arrays, surfacing the right projection controls in the UI — requires someone who has built against the MongoDB wire protocol before.

If you have experience with the MongoDB Rust driver, the Node.js driver, or the Go official driver, and you want to bring full MongoDB support to Tabularis, [open a discussion on GitHub](https://github.com/debba/tabularis) or reach out directly. The JSON-RPC protocol is documented in the [Plugin Guide](https://github.com/debba/tabularis/blob/main/plugins/PLUGIN_GUIDE.md) and a skeleton implementation is included to get you started quickly.

### ClickHouse

The ClickHouse plugin landed in the registry at v0.1.0 — it connects, authenticates, and runs queries. That is a foundation, not a finished product. ClickHouse has a rich type system (tuples, maps, nested arrays, nullable variants), a native HTTP and binary protocol, and features like **distributed tables**, **materialized views**, and **TTL policies** that deserve first-class representation in the UI. The driver today exposes none of that.

If you work with ClickHouse at scale and know what a power user actually needs from a GUI client, the v0.1.0 driver is a starting point. Help shape what v1.0 looks like.

:::plugin clickhouse:::

:::newsletter:::

## How to Contribute

The plugin protocol is language-agnostic. MongoDB contributors have used Go, Rust, Python, and Node.js in existing plugins — pick the runtime you are most productive in. What matters is the JSON-RPC 2.0 interface over stdin/stdout.

Start here:

1. Read the **[Plugin Guide](https://github.com/debba/tabularis/blob/main/plugins/PLUGIN_GUIDE.md)** — covers the full protocol, manifest format, and type system.
2. Clone an existing plugin as a reference. The [DuckDB plugin](https://github.com/debba/tabularis-duckdb-plugin) (Rust) and the [CSV plugin](https://github.com/debba/tabularis-csv-plugin) (Python) are both intentionally simple and well-commented.
3. Open an issue or discussion on the [main repo](https://github.com/debba/tabularis) before starting, so we can coordinate and avoid duplicate work.

The Redis contributions showed what happens when someone with domain expertise builds for their own use case: two production-quality drivers shipped in a matter of weeks. DuckDB, MongoDB, and ClickHouse deserve the same treatment. If you have the expertise, we have the platform.

:::contributors:::
