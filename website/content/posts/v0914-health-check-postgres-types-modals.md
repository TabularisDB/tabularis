---
title: "v0.9.14: Always Connected"
date: "2026-04-07T22:12:00"
release: "v0.9.14"
tags: ["release", "postgres", "health-check", "modals", "community"]
excerpt: "Connection health monitoring lands, PostgreSQL gains 40+ new types from network to geometry, modals get a searchable type picker and keyboard navigation, and autocompletion finally respects multi-database contexts."
og:
  title: "v0.9.14:"
  accent: "Always Connected."
  claim: "Health check pings, 40+ PostgreSQL types, searchable modals, and smarter autocomplete."
  image: "/img/tabularis-connection-manager.png"
---

# v0.9.14: Always Connected

The theme of this release is reliability. Tabularis now monitors every open connection in the background and tells you when something drops. The PostgreSQL type system takes another massive leap forward — this time covering network addresses, geometric shapes, full-text search, and a dozen more families. And the DDL modals get the UX pass they've needed for a while.

---

## Connection Health Check

This is the headline feature. Previously, if a database connection dropped — network hiccup, server restart, idle timeout — you wouldn't find out until your next query failed. Now Tabularis knows before you do.

A background Tokio loop pings every active connection at a configurable interval (default: 30 seconds). Built-in drivers use a pool-level ping — no query is executed, no overhead. Plugin drivers receive a `ping` JSON-RPC call; if the plugin hasn't implemented it, Tabularis falls back to `test_connection` automatically.

After **2 consecutive failures**, the connection is closed, any SSH tunnel is torn down, and a toast notification tells you what happened with a button to jump to the Connections page.

The interval is configurable from **Settings → General → Connection Health Check** — a slider from 0 to 120 seconds. Setting it to 0 disables pings entirely.

For plugin authors: implementing `ping` is optional but recommended if your driver can do a cheaper liveness check than a full `test_connection`. The [Plugin Guide](https://github.com/debba/tabularis/blob/main/plugins/PLUGIN_GUIDE.md) and the [wiki](/wiki/plugins#ping-optional) document the protocol and fallback behavior.

---

## PostgreSQL: 40+ New Types

This is [@dev-void-7](https://github.com/dev-void-7)'s second major contribution in a row. After range, multirange, and enum support in v0.9.13, PR [#114](https://github.com/debba/tabularis/pull/114) lands with binary-level deserialization for an enormous set of PostgreSQL types that were previously opaque. The implementation lives in a dedicated `advanced_types.rs` module — over 1,500 lines of Rust, each type parsed from its binary wire format and serialized to a human-readable JSON representation.

### What's new

**Network types** — `INET`, `CIDR`, `MACADDR`, `MACADDR8`. IP addresses display as `192.168.1.0/24`, MAC addresses as `aa:bb:cc:dd:ee:ff`.

**Geometric types** — `POINT`, `LSEG`, `BOX`, `PATH`, `POLYGON`, `LINE`, `CIRCLE`. Each renders in standard PostgreSQL notation: `(x, y)` for points, `<(cx, cy), r>` for circles, open `[...]` or closed `(...)` for paths.

**Full-text search types** — `TSVECTOR` and `TSQUERY`. Vectors display lexemes with positions and weights. Queries are fully parsed as expression trees — operators, phrase matches, prefix wildcards, weight filters — and serialized back to readable query syntax.

**Time types** — `TIMETZ` with timezone offset, `INTERVAL` with full decomposition into years, months, days, hours, minutes, seconds, and microseconds. Overflow is normalized correctly (e.g. 25 hours → 1 day + 1 hour).

**Money, XML, RefCursor, JsonPath** — `MONEY` renders as a number (stored as i64 cents), `XML` and `REFCURSOR` as strings, `JSONPATH` strips the internal version prefix and returns the path expression.

**System internals** — `PG_LSN` (log sequence numbers), `TXID_SNAPSHOT` / `PG_SNAPSHOT` (transaction snapshots), `AclItem`, `PgNodeTree`, and various statistics types (`PG_MCV_LIST`, `PG_DEPENDENCIES`, `PG_NDISTINCT`).

**Object identifiers** — `XID`, `CID`, `XID8`, `TID`, and all `REG*` types (`REGCLASS`, `REGTYPE`, `REGPROC`, etc.) — returned as their underlying OID or formatted string.

**Bit types** — `BIT` and `VARBIT`, decoded to human-readable binary strings with correct padding.

Along the way, the type picker in the schema editor also gained these types — grouped by category (`network`, `geometric`, `fulltext`, `xml`, `system`, `reg`) — plus extension-aware types: `HSTORE`, `LTREE`/`LQUERY`/`LTXTQUERY`, `CITEXT`, PostGIS types (`GEOMETRY`, `GEOGRAPHY`, and common `GEOMETRY(...)` variants), `INTARRAY`, and common array variants (`INTEGER[]`, `TEXT[]`, `UUID[]`, `JSONB[]`, etc.).

This is the kind of work that turns "PostgreSQL support" from a marketing bullet into a real claim.

:::newsletter:::

---

## Searchable Type Picker in DDL Modals

The raw HTML `<select>` elements in the Create Table and Modify Column modals are gone. They've been replaced with the custom searchable `Select` component — the same one used elsewhere in the app. Start typing and the list filters instantly.

This matters more than it sounds. With the PostgreSQL type list now exceeding 100 entries (thanks to the expansion above), scrolling through a native dropdown was painful. Now you type "geo" and see `GEOMETRY`, `GEOGRAPHY`, `POINT`, `POLYGON` — nothing else.

The column type column in the Create Table modal table has also been widened to accommodate longer type names like `GEOMETRY(Point, 4326)`.

---

## Column Type Parsing and Extension Tracking

A new utility module handles the round-trip between database-reported type strings and the form fields in the schema editor. `parseColumnType` correctly splits `VARCHAR(255)` into type + length, but knows not to strip the parenthesized arguments from PostGIS types like `GEOMETRY(Point, 4326)` where the parentheses are part of the type name.

`buildColumnDefinition` does the reverse — composing a backend-compatible string from form data.

`getRequiredExtensions` scans the columns in a table and returns the deduplicated list of PostgreSQL extensions they need (e.g. `["postgis", "hstore"]`). Each type in the picker now carries an optional `requires_extension` field so the UI can surface this information before you apply the DDL.

---

## SMALLSERIAL Auto-Increment

A missing branch in the PostgreSQL DDL generator. When you enabled auto-increment on a `SMALLINT` column, Tabularis would emit `SERIAL` instead of `SMALLSERIAL` — silently creating a column with a larger type than intended. Fixed. The logic now correctly maps `SMALLINT → SMALLSERIAL`, `INTEGER → SERIAL`, `BIGINT → BIGSERIAL`.

The UI also got a sync pass: enabling auto-increment now forces `NOT NULL` checked and disabled (serial columns are always NOT NULL) and clears the default value field.

---

## Query Selection Modal: Keyboard Navigation

The modal that appears when you execute a script with multiple semicolon-separated queries now supports full keyboard navigation:

- **Arrow Up / Down** — move focus between queries, with auto-scroll
- **Enter** — execute the focused query
- **Number keys 1–9** — directly execute query N

The focused item gets a blue border and a numbered badge. Mouse hover syncs with keyboard focus. All strings are translated (English, Spanish, Italian, Chinese).

---

## Autocompletion Fix for Multiple Databases

This is [@thomaswasle](https://github.com/thomaswasle)'s contribution in PR [#115](https://github.com/debba/tabularis/pull/115). The Monaco autocomplete provider was always using the top-level table list, ignoring which schema or databases were actually active. If you had a PostgreSQL connection with a non-default schema selected, or a MySQL connection with multiple databases checked, the suggestions were wrong.

The fix computes the effective table list based on context: schema tables for schema-aware connections, the union of selected database tables for multi-db connections, or the global list as fallback. The `useEffect` dependency array is corrected to re-register autocomplete when context changes.

---

## ORDER BY Without Swallowing LIMIT / OFFSET

When you click a column header to sort, Tabularis injects or replaces an `ORDER BY` clause in your query. The string manipulation was naive — it would slice from `ORDER BY` to the end of the query, destroying any `LIMIT` or `OFFSET` you had written. Now it detects trailing `LIMIT`/`OFFSET` clauses and preserves them. Fixed across all three built-in drivers (PostgreSQL, MySQL, SQLite).

---

## Smaller Changes

- **CI/CD** — GitHub Actions bumped across all workflows: `actions/checkout` v6, `actions/setup-node` v6, `pnpm/action-setup` v5, `swatinem/rust-cache` v2.9.1.
- **Driver fallback hardened** — the `ping` fallback now catches both `"Method not found"` and `"not implemented"` error strings from plugins.
- **Test coverage** — new tests for `TsQuery`, `TsVector`, advanced types, and the column type parsing utilities (273 lines).

---

:::contributors:::

---

_v0.9.14 is available now. Update via the in-app updater, or download from the [releases page](https://github.com/debba/tabularis/releases/tag/v0.9.14)._
