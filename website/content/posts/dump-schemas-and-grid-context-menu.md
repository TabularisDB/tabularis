---
title: "Schema Dump, Grid Context Menu, and Stability Fixes: v0.9.5"
date: "2026-03-04T12:00:00"
release: "v0.9.5"
tags: ["release", "data-grid", "dump", "mysql", "postgres", "bugfix", "ux"]
excerpt: "v0.9.5 ships schema-aware dump/import for PostgreSQL, a column header context menu in the data grid, and a focused round of stability fixes for MySQL, PostgreSQL, Monaco, and the auto-updater."
og:
  title: "Schema Dump, Grid Context Menu,"
  accent: "v0.9.5."
  claim: "Dump and restore individual PostgreSQL schemas, copy column names from the grid, and trust your connections and updates again."
  image: "/img/overview.png"
---

# Schema Dump, Grid Context Menu, and Stability Fixes: v0.9.5

**v0.9.5** is a focused release: two quality-of-life features and four targeted bug fixes. No sprawling rewrites — just things that were visibly missing or quietly broken.

---

## Schema-Aware Dump & Import (PostgreSQL)

Dump and import operations now work at the **schema level** for PostgreSQL, not just at the database level.

Previously, the only entry point for dump and import was a right-click on a database node. That worked fine for MySQL, but PostgreSQL workflows tend to be organized around schemas — and grabbing a snapshot of a single schema while leaving the rest of the database untouched wasn't possible from within Tabularis.

Now it is. Right-click any schema node in the sidebar and you'll find **Dump Schema** and **Import into Schema**. Pick a destination file and Tabularis streams the dump to disk with live elapsed-time feedback. Import works the same way — select a `.sql` file and watch the progress bar.

This is especially useful on shared PostgreSQL servers where each application owns its own schema. You can snapshot `billing` at any point without having to touch `inventory`, `reporting`, or any of the others sitting in the same database.

---

## Data Grid: Column Header Context Menu

Right-clicking a column header in the data grid now opens a context menu. The first action is **Copy column name** — it puts the column's exact name on the clipboard as plain text.

Small feature, but a real friction reducer. When writing a query that references a column with a long or oddly-cased name, you no longer have to scroll the grid to find it, read it carefully, and type it by hand. Right-click the header, copy, paste.

More actions will be added to this menu in upcoming releases.

:::newsletter:::

---

## Bug Fixes

### MySQL: Per-Database Connection Pools

MySQL connections were sharing a single connection pool across all selected databases in a multi-database setup. This caused queries issued against `db_a` to occasionally execute against the wrong database when the pool returned a connection that had previously been used for `db_b`.

v0.9.5 introduces per-database pools keyed by both connection ID and database name. Each database in a multi-database connection now gets its own isolated pool — no cross-database bleed.

### PostgreSQL: UUID Columns Now Bind Correctly

String primary keys that happen to contain UUIDs (e.g. `'550e8400-e29b-41d4-a716-446655440000'`) were being sent to PostgreSQL as plain text, which caused type mismatch errors when the column was declared as `uuid`. Tabularis now parses string PKs and casts them to the `uuid` type before binding, so queries against UUID primary keys work without manual intervention.

### Monaco Editor: SQL-Only Bundle

The Monaco editor was importing language support at runtime, pulling in worker scripts for every language Monaco supports (TypeScript, JSON, HTML, CSS, and others) even though Tabularis only needs SQL. v0.9.5 removes the runtime import and configures the bundler to include only the SQL worker. The result is a smaller initial load and no spurious network requests for unused language workers.

### Updater: Stale Cache and Post-Update Restart

The in-app updater had two related issues: it could serve a cached (stale) update manifest after a new release was published, showing "no update available" when one existed; and after a successful update download it didn't restart the app, leaving you on the old version until you manually relaunched.

Both are fixed. The updater now bypasses the cache when checking for updates, and triggers an automatic restart once the new version is installed.

---

:::contributors:::

## What's Next

Tabularis is growing fast — and with growth comes complexity. The roadmap is full, but so is the bug tracker. Stability and polish will always be a priority alongside new features.

This is an open-source project, and every contribution counts: whether it's a bug report, a fix, a translation, or a feature proposal. If something feels off or missing, the best place to start is the [GitHub repository](https://github.com/debba/tabularis). Open an issue, submit a pull request, or just share how you're using the app. Every bit of feedback shapes what gets built next.

---

_v0.9.5 is available now. Update via the in-app updater (which now actually restarts), or download from the releases page._
