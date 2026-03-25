---
title: "v0.9.11: 你好 Tabularis"
date: "2026-03-25T07:21:00"
release: "v0.9.11"
tags: ["release", "i18n", "postgres", "ux", "csv", "community"]
excerpt: "Chinese (Simplified) joins the supported languages, PostgreSQL arrays finally work properly, query results are editable inline, and exports got more flexible."
og:
  title: "v0.9.11: 你好 Tabularis"
  accent: "Chinese Support."
  claim: "Chinese (Simplified), PostgreSQL arrays, inline editing, configurable exports."
  image: "/img/tabularis-localization-settings.png"
---

# v0.9.11: 你好 Tabularis

Another community-driven language lands in Tabularis.

---

## Chinese (Simplified)

Back when I built i18n in [v0.6.0](/blog/security-and-i18n), I shipped English and Italian. Spanish came shortly after thanks to [kconfesor](https://github.com/kconfesor)'s contribution in PR [#30](https://github.com/debba/tabularis/pull/30). Now [GTLOLI](https://github.com/GTLOLI) has done the same for Chinese (Simplified) — a full translation, 879 keys, merged in PR [#103](https://github.com/debba/tabularis/pull/103).

So Tabularis now supports **English**, **Italian**, **Spanish**, and **Chinese (Simplified)**. As before, the app picks your system locale automatically, or you can set `"zh"` in `config.json`.

Two out of four languages came from contributors. That's the kind of thing I was hoping for when I made the i18n files plain JSON with no build step. If you want to add your language, the bar is low — just copy one of the existing files and translate.

---

## PostgreSQL Array Types

If you had `integer[]` or `text[]` columns in PostgreSQL, the grid would show raw strings and edits were broken. Fixed now — array columns parse correctly, and writing back works through JSON-to-ARRAY literal conversion. You edit `["a", "b", "c"]` in the cell, the driver generates `ARRAY['a','b','c']`.

All Rust-side, no UI changes.

---

## Inline Editing for Query Results

Running a `SELECT` in the editor used to give you a read-only grid. Now, if the query hits a single table, you can edit rows inline — same double-click behavior as table browsing.

Joins, aggregations, subqueries stay read-only. There's no safe way to map an edited cell back to a source row in those cases, so I'm not pretending there is.

---

## JSON Copy and CSV Delimiter

- You can copy selected rows as **JSON** now. Set it as your default copy format in Settings if you want.
- The **CSV delimiter** is configurable — semicolons, tabs, pipes, whatever you need.

---

## What's Next

I've been on the [UI extensions branch](/blog/plugin-ui-extensions) for a few weeks, testing with the JSON Viewer and Google Sheets plugins. The two open items from the [v0.9.10 post](/blog/v0910-bugfixes-ui-extensions-wip) — error surfaces and theme tokens — are almost done.

I expect to ship UI extensions next week. After that, plugins won't be limited to backend drivers anymore — they'll be able to put components directly in the Tabularis UI.

---

:::contributors:::

---

_v0.9.11 is available now. Update via the in-app updater, or download from the [releases page](https://github.com/debba/tabularis/releases/tag/v0.9.11)._
